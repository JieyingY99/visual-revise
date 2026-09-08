/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// ⌘⇧R（Windows 上 Ctrl+Shift+R）：用剪贴板里的东西替换选中的元素。
// 对标 Figma 的 Paste to replace——新东西落在旧元素占的那个位置上，旧的消失。
//
// 这个组合浏览器自己占着（硬刷新）。接管的条件一旦满足就必须 preventDefault，
// 否则页面当场重载，一次改稿全没了；反过来，条件不满足时**绝不能**拦，
// 用户在输入框里按 ⌘⇧R 想的就是刷新页面。
import { isMod } from '../core/hotkey.js'
import { ChangeStore } from '../core/change-store.js'

// 剪贴板 HTML 前面常带换行 / 注释，body.firstChild 会是文本节点或注释节点——
// 那种节点进不了 insertElement 的守卫，会静默地什么都不发生。同 selectable.js
const parseHTML = html =>
  new DOMParser().parseFromString(String(html || ''), 'text/html').body.firstElementChild

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload  = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
  reader.readAsDataURL(blob)
})

const naturalSizeOf = dataUrl => new Promise(resolve => {
  const img = new Image()
  img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
  img.onerror = () => resolve(null)
  img.src = dataUrl
})

// 图片的宽高怎么定：锁**原元素的宽**，高按图片自己的比例算出来。
//
// 直接用图片原始尺寸不行——截图动辄两三千像素宽，贴进一张 260px 的卡片位置上
// 会把整行布局撑变形，用户看到的是「替换把页面搞烂了」。
// 直接用原元素的宽高也不行——那是把图按卡片的比例挤扁，替换完第一眼就是错的。
// 只锁一边、另一边按比例走，两个毛病都没有。原元素量不出宽度（display:none、
// 零宽容器）时才退回图片自己的尺寸，那时没有「位置」可保。
const sizeForImage = (natural, oldEl) => {
  if (!natural?.w || !natural?.h) return null

  const slot = Math.round(oldEl?.getBoundingClientRect?.().width || 0)
  if (!slot) return { w: natural.w, h: natural.h }

  return { w: slot, h: Math.max(1, Math.round(slot * natural.h / natural.w)) }
}

// 纯文本装进 <span>：文本节点自己进不了 insertElement（它要的是元素），
// 而 <span> 是唯一不带任何默认样式与语义的容器，不会替用户做决定
const textNode = text => {
  const span = document.createElement('span')
  span.textContent = text
  return span
}

// 剪贴板里那份东西，读成一个「怎么造节点」的工厂。
// 造节点而不是造一个节点：多选时每个目标都要拿到自己的一份副本，
// 共用同一个节点的话，第二次插入会把第一次那份从页面上搬走。
const readClipboard = async () => {
  let items = null

  // navigator.clipboard.read() 拿得到 HTML 与图片，readText 只有纯文本。
  // 没权限 / 非安全上下文 / 文档没聚焦时它会 reject，逐级退回而不是整个中断
  try {
    items = await navigator.clipboard.read()
  } catch {
    items = null
  }

  if (items?.length) {
    for (const item of items) {
      const types = Array.from(item.types || [])

      if (types.includes('text/html')) {
        const html = await (await item.getType('text/html')).text()
        // 解析不出元素（只有一段裸文本 / 注释）时不算数，往下继续找图片和纯文本
        if (parseHTML(html)) return { kind: 'html', make: () => parseHTML(html) }
      }

      const imageType = IMAGE_TYPES.find(t => types.includes(t))
      if (imageType) {
        const dataUrl = await blobToDataUrl(await item.getType(imageType))
        const natural = await naturalSizeOf(dataUrl)
        return {
          kind: 'image',
          make: oldEl => {
            const img = document.createElement('img')
            img.src = dataUrl
            const size = sizeForImage(natural, oldEl)
            if (size) { img.width = size.w; img.height = size.h }
            // 图片替换掉的可能是任何东西，alt 只能给一句中性的说明；
            // 导出的提示词里 AI 会看到它，知道这里需要一句真正的替代文本
            img.alt = ''
            return img
          },
        }
      }

      if (types.includes('text/plain')) {
        const text = await (await item.getType('text/plain')).text()
        if (text.trim()) return { kind: 'text', make: () => textNode(text) }
      }
    }
  }

  // 到这儿说明 clipboard.read() 用不了（无权限），或者剪贴板里没有我们认得的
  // 格式。退回内存里最近一次 ⌘C 的那份元素副本——selectable.js 的 on_copy 会把
  // outerHTML 存进 window.copy_backup，那正是用户刚刚复制的元素
  try {
    const text = await navigator.clipboard.readText()
    if (text?.trim()) {
      const node = parseHTML(text)
      return node
        ? { kind: 'html', make: () => parseHTML(text) }
        : { kind: 'text', make: () => textNode(text) }
    }
  } catch {
    // 读不到就往下走
  }

  const backup = window.copy_backup
  if (backup && parseHTML(backup))
    return { kind: 'backup', make: () => parseHTML(backup) }

  return null
}

// 可替换的元素：还在页面上、不是编辑器自己的 UI、有父节点（页面根元素替换不了）。
// 纯同步，所以 onKeydown 里就能拿它决定「这一键归不归我们管」
const replaceable = ctx => ctx.engine.selection()
  .filter(el => el?.isConnected && !ctx.isEditorUI(el) && el.parentElement)

// 空选中时属性面板整个是隐藏的，它的空态模板里没有 .toast 节点，
// panel.toast 会把消息无声吞掉。走 vr-toast：core/visual-revise.js 转给工具条，
// 工具条的 toast 挂在 body 上，什么都没选中时照样看得见。
// 对照 features/copy-image.js 的同一处理
const bodyToast = (message, kind = 'error') =>
  document.dispatchEvent(new CustomEvent('vr-toast', {
    bubbles: true, composed: true, detail: { message, kind },
  }))

const run = async (ctx, selection) => {
  // 父与子同时选中时只替换最外层：替换父元素会把子元素一起带走，
  // 轮到子元素时它已经不在 DOM 上了，只会白白多出一条失败
  const targets = selection.filter(el => !selection.some(o => o !== el && o.contains(el)))

  const source = await readClipboard()
  if (!source)
    return ctx.toast('剪贴板里没有可用的内容（支持元素、图片、文本）', 'error')

  // 选中的元素在读剪贴板那段 await 里可能已经没了（页面自己重渲染）
  const alive = targets.filter(el => el.isConnected && el.parentElement)
  if (!alive.length)
    return ctx.toast('选中的元素已不在页面上', 'error')

  const inserted = []
  ChangeStore.history.batch(
    alive.length > 1 ? `替换 ${alive.length} 个元素` : '替换元素',
    () => {
      for (const el of alive) {
        const node = source.make(el)
        if (!node) continue
        if (ChangeStore.replaceElement(el, node, '替换元素')) inserted.push(node)
      }
    })

  if (!inserted.length)
    return ctx.toast('这些元素替换不了（页面根元素不能被替换）', 'error')

  // 选中换成新元素：替换完接着调样式是常态，还停在已经不存在的旧元素上
  // 只会让下一次操作静默失败
  ctx.engine.unselect_all()
  inserted.filter(n => n.isConnected).forEach(n => ctx.engine.select(n))

  ctx.toast(`已替换 ${inserted.length} 个元素`)
}

export const onKeydown = (e, ctx) => {
  if (!isMod(e) || !e.shiftKey || e.altKey) return false
  // 认物理键位而不是 e.key：带修饰键时 e.key 会变（⌥ 组合在 macOS 上直接变成
  // 死键字符），布局非拉丁时更对不上。e.key 只做兜底，给那些不带 code 的
  // 合成事件留条路
  if (e.code ? e.code !== 'KeyR' : (e.key || '').toLowerCase() !== 'r') return false

  // 这几道守卫不满足就原样放行，让浏览器自己的 ⌘⇧R（硬刷新）照常生效。
  //
  // 这里**不**看 isEditorUI：点完面板上的按钮（联动、对齐…）焦点就留在面板里，
  // 那时按 ⌘⇧R 想的仍然是替换选中的元素。面板里没有任何控件会用到这个组合，
  // 拦下来只会让「刚点过面板」这个状态莫名其妙地把快捷键吃掉。
  // 真正该让路的只有「正在打字」，isTypingTarget 会下钻到 shadow 里的
  // activeElement，面板自己的输入框也算数。
  if (ctx.interactive || ctx.mode !== 'select') return false
  if (ctx.isTypingTarget(e) || ctx.hasOpenPopup()) return false

  // 「有没有可替换的元素」同样是同步就能定的，所以并进守卫链，而不是等
  // run() 里 await 完剪贴板才发现。原先那个顺序是两头落空：按键已经被
  // preventDefault 吃掉（浏览器的硬刷新没了），提示又因为面板空态丢掉，
  // 用户按下去像页面死了。没有目标时原样放行，让浏览器自己的 ⌘⇧R 照常生效
  const selection = replaceable(ctx)
  if (!selection.length) {
    // 提示归提示，但不拦事件：这一帧之后页面就会硬刷新，toast 大概率只闪一下，
    // 那也比「既不刷新也没反馈」强
    bodyToast('先选中要被替换的元素')
    return false
  }

  // 读剪贴板是异步的，但拦不拦这次按键必须在这一帧里定下来——
  // 等 await 回来再 preventDefault，页面早就刷新掉了
  e.preventDefault()
  e.stopPropagation()

  // 异步里抛出去没人接，只会变成一条控制台报错；用户那边是「按了没反应」
  run(ctx, selection).catch(err => {
    console.warn('[Visual Revise] 替换元素失败', err)
    ctx.toast(`替换失败：${err?.message || err}`, 'error')
  })

  return true
}
