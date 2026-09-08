/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// ⌥⌘C / ⌥⌘V：复制选中元素的全部属性，再整套粘到别的元素上——Figma 的
// Copy / Paste properties。Windows 上是 Ctrl+Alt+C / Ctrl+Alt+V，修饰键判断
// 统一走 core/hotkey.js 的 isMod，不再各写各的 `metaKey || ctrlKey`。
//
// 契约：onKeydown(e, ctx) 接了这次按键就返回 true（自己 preventDefault /
// stopPropagation），否则返回 false 让后面的处理继续。
import { isMod, combo } from '../core/hotkey.js'
import { TRACKED_PROPS, sameValue } from '../core/tracked-props.js'
import { ChangeStore } from '../core/change-store.js'

// 位置量不跟着走。Figma 的 Paste properties 同样不搬位置：用户的心智是
// 「让这个元素长得跟那个一样」，不是「让它挪到那儿去」。真把 left/top 拷过来，
// 元素会当场飞走，而且绝对定位的坐标换个父容器根本没有意义。
// transform / inset 不在 TRACKED_PROPS 里，仍列出来——这里声明的是「什么算位置」，
// 以后往 tracked-props 里加了也自动被挡住。
const POSITION_PROPS = new Set([
  'position', 'left', 'top', 'right', 'bottom',
  'translate', 'transform', 'z-index', 'inset',
])

// 尺寸（width / height）反过来是要带的：Figma 的属性粘贴也搬尺寸，
// 「跟那张卡一样宽」是改稿里最常见的诉求之一。
const COPYABLE = TRACKED_PROPS.filter(prop => !POSITION_PROPS.has(prop))

// 剪贴板文本里的信封。加这层是为了让 ⌥⌘V 能分清「这段文本是我自己写的属性集」
// 还是「用户从别处复制来的一段普通文字」——后者不该被当成样式往元素上写。
const ENVELOPE = 'visual-revise'
const KIND = 'props'

// 模块内存里的那一份。存计算值而不是 inline：用户要的是「这个元素看起来的样子」，
// 而 el.style 里只有他手动调过的那几条，源元素本来长什么样一条都不在里面。
let clipboard = null

const readProps = el => {
  const computed = getComputedStyle(el)
  const props = {}
  for (const prop of COPYABLE) {
    const value = computed.getPropertyValue(prop)
    if (value !== '' && value != null) props[prop] = String(value).trim()
  }
  return props
}

// 尽力写一份到系统剪贴板：跨标签页、跨窗口改稿时模块内存是断的，
// 文本剪贴板是唯一能跨过去的通道。写不进去（无权限 / 页面失焦）就算了，
// 模块内存那份已经够用，不该为此弹一个用户无从处理的错误。
const writeClipboardText = props => {
  try {
    navigator.clipboard?.writeText(
      JSON.stringify({ [ENVELOPE]: KIND, props }))?.catch(() => {})
  } catch {}
}

const readClipboardProps = async () => {
  try {
    const text = await navigator.clipboard?.readText()
    const data = JSON.parse(text)
    if (data?.[ENVELOPE] !== KIND || !data.props) return null

    // 剪贴板内容来自页面之外，不能拿它当写入白名单：只收 COPYABLE 里认识的键，
    // 别人伪造一份带 position/left 的 JSON 也搬不动元素
    const props = {}
    for (const prop of COPYABLE)
      if (typeof data.props[prop] === 'string') props[prop] = data.props[prop]
    return Object.keys(props).length ? props : null
  } catch {
    return null
  }
}

// 空选中时的提示只能走 vr-toast，不能走 ctx.toast：什么都没选中时属性面板
// 整个是隐藏的，它的空态模板里根本没有 .toast 节点，panel.toast 会撞上
// `if (!el) return` 把消息无声吞掉，用户那边是「按了完全没反应」。
// vr-toast 由 core/visual-revise.js 转给工具条，工具条的 toast 挂在 body 上，
// 什么都没选中时照样看得见。对照 features/copy-image.js 的同一处理
const bodyToast = (message, kind = 'error') =>
  document.dispatchEvent(new CustomEvent('vr-toast', {
    bubbles: true, composed: true, detail: { message, kind },
  }))

const copySources = ctx => ctx.engine.selection().filter(node => node?.isConnected)

// 多选时取 selection()[0]：上游把新选中的 unshift 到最前，它就是最后点的那个，
// 也正是属性面板此刻显示的那个——复制的是「面板里看到的这份属性」，用户读得懂
const copy = (ctx, [el]) => {
  clipboard = readProps(el)
  writeClipboardText(clipboard)
  ctx.toast(`已复制 ${Object.keys(clipboard).length} 项属性`)
}

// 粘贴范围取面板的 scope()——它是「选中 + 联动」的合集，跟面板里拖字段、
// 调颜色写到的是同一批元素。开着联动却只粘一个，用户会当成 bug。
// 面板还没挂上 / 没有 targets 时退回选中集。
const pasteTargets = ctx => {
  const scope = ctx.panel?.scope?.() || []
  const targets = scope.length ? scope : ctx.engine.selection()
  return targets.filter(el => el?.isConnected && !ctx.isEditorUI(el))
}

const paste = async (ctx, targets) => {
  // 模块内存优先：同一次改稿里它一定比剪贴板文本新，而且用户可能在中途
  // 复制过别的文字，那时剪贴板里已经不是属性了
  const props = clipboard || await readClipboardProps()
  if (!props || !Object.keys(props).length)
    return ctx.toast(`没有可粘贴的属性，先按 ${combo({ mod: true, alt: true }, 'C')} 复制一个元素`, 'error')

  // 先把目标的当前计算值拍下来再进 batch：边写边读的话，前一条属性写下去
  // 会改掉后一条的计算值（写完 font-size，line-height 的 px 就变了），
  // 「跟现在一样就跳过」的判断会依赖写入顺序
  const before = targets.map(el => {
    const computed = getComputedStyle(el)
    const snap = {}
    for (const prop of Object.keys(props)) snap[prop] = computed.getPropertyValue(prop)
    return snap
  })

  let changed = 0
  // 一条 batch：⌥⌘V 在用户眼里是一个动作，⌘Z 就该一次全退回，
  // 而不是几十条属性一条一条往回撤
  ChangeStore.history.batch('粘贴属性', () => {
    targets.forEach((el, i) => {
      let touched = false
      for (const [prop, value] of Object.entries(props)) {
        // 值本来就一样的不写：写进去也是空操作，却会在改动记录和导出的
        // 提示词里塞满「把 display 改成 block」这种噪音
        if (sameValue(before[i][prop], value)) continue
        ChangeStore.applyProp(el, prop, value)
        touched = true
      }
      if (touched) changed++
    })
  })

  ctx.toast(changed
    ? `已粘贴到 ${changed} 个元素`
    : '这些元素的属性已经和复制的一样了')
}

// macOS 上 ⌥ 是死键：⌥C 出来的是 ç、⌥V 是 √，e.key 拿到的就是那个字符。
// e.code 是物理键位，不受修饰键与键盘布局影响，优先用它；非字母键位
// （或合成事件没给 code）再退回 e.key。
const keyOf = e => /^Key[A-Z]$/.test(e.code || '')
  ? e.code.slice(3).toLowerCase()
  : String(e.key || '').toLowerCase()

export const onKeydown = (e, ctx) => {
  if (!isMod(e) || !e.altKey || e.shiftKey) return false

  const key = keyOf(e)
  if (key !== 'c' && key !== 'v') return false

  // 拖拽 / 缩放进行中、浏览与评论模式、焦点在输入框里、有弹层开着——这几种
  // 情况下这组键不归我们管。焦点落在面板的按钮上（刚点完联动）不算：
  // 这组组合键没有任何面板控件会用到，点完按钮紧接着粘贴是最自然的顺序
  if (ctx.interactive || ctx.mode !== 'select') return false
  if (ctx.isTypingTarget(e) || ctx.hasOpenPopup()) return false

  // 「有没有可操作的元素」是同步就能定的，所以并进守卫链、排在 preventDefault
  // 之前：没有目标时这一键根本不该归我们管，吃掉它只会让用户按下去像卡死了。
  // 提示照给（走 bodyToast），但事件原样放行
  const targets = key === 'c' ? copySources(ctx) : pasteTargets(ctx)
  if (!targets.length) {
    bodyToast(key === 'c' ? '先选中一个元素再复制属性' : '先选中要粘贴的元素')
    return false
  }

  e.preventDefault()
  e.stopPropagation()

  // paste 要等剪贴板是异步的，但按键必须同步吃掉，所以不 await；
  // 异常自己吞掉，别变成一条用户看不懂的 unhandled rejection
  key === 'c' ? copy(ctx, targets) : Promise.resolve(paste(ctx, targets)).catch(err => {
    console.warn('[visual-revise] 粘贴属性失败', err)
    ctx.toast('粘贴属性失败', 'error')
  })

  return true
}
