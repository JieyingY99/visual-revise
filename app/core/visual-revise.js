import { ChangeStore } from './change-store.js'
import { copyPrompt } from './prompt-export.js'
import '../components/props-panel/props-panel.element.js'
import '../components/change-list/change-list.element.js'
import '../components/comment-layer/comment-layer.element.js'
import '../components/toolbar/toolbar.element.js'
import { createLayoutDrag } from './layout-drag.js'
import { pageElementAt, isEditorUI, isTypingTarget, isTextElement } from './dom-utils.js'
import { buildPrompt } from './prompt-export.js'
import { exportJSON, importJSON, downloadJSON, pickAndImport } from './json-io.js'
import { fingerprint, findSharedElements } from './shared-elements.js'
import { loadLocalFonts, isSupported as fontsSupported } from './local-fonts.js'
import { clearHighlight } from '../components/change-list/change-list.element.js'
import { resizeMode, planResize, currentSize, isMainAxis, cssVariables } from './resizing.js'
import { parseTracks, serializeTracks, readTracks, gridShape } from './grid.js'
import { flowOf, planFlow, alignmentOf, planAlignment } from './layout.js'

const UI_TAGS = 'visbug-handles, visbug-label, visbug-hover, visbug-grip, visbug-metatip, visbug-ally, visbug-corners, visbug-gridlines'

export const mountVisualRevise = visbug => {
  const engine = visbug.selectorEngine
  if (!engine) return null

  // 最后一道幂等防线：注入层已做保护，但若真出现第二个 <vis-bug>
  // （例如页面脚本自行创建），也不该叠出第二套面板、列表和评论层。
  if (document.querySelector('visual-revise-panel'))
    return window.__visualRevise ?? null

  // VisBug 工具栏纵向很高，贴在任何一侧都会盖住页面内容。
  // 属性面板已是主界面，工具栏默认收起，需要时用 ⌘/Ctrl + / 唤出。
  visbug.style.display = 'none'

  const panel = document.createElement('visual-revise-panel')
  document.body.appendChild(panel)

  const list = document.createElement('visual-revise-list')
  list.hidden = true
  document.body.appendChild(list)

  const comments = document.createElement('visual-revise-comment-layer')
  document.body.appendChild(comments)

  const toolbar = document.createElement('visual-revise-toolbar')
  document.body.appendChild(toolbar)

  const layoutDrag = createLayoutDrag({
    onDone: ({ ordered }) => panel.toast(`已重排 ${ordered.length} 个元素`),
  })

  let interactive = false
  let suspended = []
  let listWasOpen = false

  const onSelected = els => {
    if (interactive) return

    panel.setTargets(els)

    // 工具条是入口，属性面板只在真正选中元素后出现，
    // 否则一打开就有两块 UI 抢注意力
    panel.hidden = !(els && els.length)
  }

  engine.onSelectedUpdate(onSelected)

  // 交互态：让页面恢复自己的 hover / click 行为，供用户验证真实交互。
  // 选中集在退出时原样恢复，改动记录不受影响（它活在 ChangeStore 里）。
  const enterInteractive = () => {
    if (interactive) return
    interactive = true
    suspended = engine.selection().slice()
    engine.unselect_all()
    engine.pause()
    document.querySelectorAll(UI_TAGS).forEach(el => { el.style.display = 'none' })
    panel.hidden = true
    listWasOpen = !list.hidden
    list.hidden = true
    comments.hidden = true
    toolbar.hidden = true
    setMode('select')
    clearHighlight()
  }

  const exitInteractive = () => {
    if (!interactive) return
    interactive = false
    engine.resume()
    document.querySelectorAll(UI_TAGS).forEach(el => { el.style.display = '' })
    list.hidden = !listWasOpen
    comments.hidden = false
    toolbar.hidden = false
    suspended.filter(el => el.isConnected).forEach(el => engine.select(el))
    panel.setTargets(engine.selection())
  }

  const toggleInteractive = () => interactive ? exitInteractive() : enterInteractive()

  // capture 阶段拦截，抢在 hotkeys-js 的 document 监听之前
  const doUndo = () => {
    const entry = ChangeStore.undo()
    toolbar.toast(entry ? `已撤销：${entry.label || '上一步'}` : '没有可撤销的操作',
      entry ? 'info' : 'error')
  }

  const doRedo = () => {
    const entry = ChangeStore.redo()
    toolbar.toast(entry ? `已重做：${entry.label || '上一步'}` : '没有可重做的操作',
      entry ? 'info' : 'error')
  }

  const toggleList = () => {
    list.hidden = !list.hidden
    if (!list.hidden) list.render()
  }

  const onKeydown = e => {
    // ⌘Z / ⌘⇧Z（Windows 上 ⌘Y 也认）要在下面那道「带修饰键就放行」之前处理
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return

      // 在输入框里打字时让路给浏览器自己的文本撤销：用户想退一个字符，
      // 不该把整次改稿一起撤掉
      if (isTypingTarget(e)) return

      e.preventDefault()
      e.stopPropagation()
      ;(key === 'y' || e.shiftKey) ? doRedo() : doUndo()
      return
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (isEditorUI(e)) return   // 面板内部按键归面板（Tab 切焦点、Esc 关弹窗）

    // 页面输入控件里打字时让路：单字母快捷键会吞掉字符，
    // Tab 则要保留表单字段间的正常跳转。Esc 仍然接管，
    // 因为它在这里的语义是「退出当前模式」，不与输入冲突。
    if (isTypingTarget(e) && e.key !== 'Escape') return

    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      toggleInteractive()
      return
    }

    // 删除整个接管过来，不再放行给 VisBug 的 hotkeys。
    //
    // 原因是上游有个 bug：它注册的是 hotkeys('backspace,del,delete', …)，
    // 而 del 与 delete 是同一个键的两个别名，回调因此跑两次——第一次删掉选中
    // 元素并自动选中邻居，第二次把那个邻居也删了。按一次 Delete 少两个元素。
    // 以前没有删除记录，这个 bug 看起来只像是「手抖多按了一下」。
    //
    // 记录与删除必须是一件事：元素一旦离开 DOM 就取不到父节点与后邻，
    // 恢复也就无从谈起。
    if ((e.key === 'Delete' || e.key === 'Backspace') && !interactive) {
      const targets = engine.selection().filter(el => el?.isConnected && !isEditorUI(el))
      if (!targets.length) return

      e.preventDefault()
      e.stopPropagation()

      // 删完选中一个邻居，保住上游那份「连续删」的手感。
      // 邻居必须在删除前取，删完就没有兄弟关系可言了。
      const anchor = targets[0]
      const next = anchor.nextElementSibling || anchor.previousElementSibling || anchor.parentElement

      engine.unselect_all()
      ChangeStore.removeElements(targets)

      if (next?.isConnected && next !== document.documentElement && !isEditorUI(next))
        engine.select(next)

      panel.toast(`已删除 ${targets.length} 个元素 · 可在记录里放回`)
      return
    }

    // 工具条上每个功能都有一个键。这些必须真正被我们接管（preventDefault +
    // stopPropagation）：上游 VisBug 给自己的工具也注册了一批单字母热键，
    // 它的工具条虽然藏了，热键却还活着——放行就会切到它的工具去。
    if (!interactive) {
      const key = e.key.toLowerCase()

      const MODE_KEYS = { v: 'select', c: 'comment', r: 'reorder' }
      if (MODE_KEYS[key]) {
        e.preventDefault()
        e.stopPropagation()
        const next = MODE_KEYS[key]
        // 再按一次回到选择态；选择态本身是默认，按 V 就是明确切回来
        setMode(next !== 'select' && mode === next ? 'select' : next)
        return
      }

      if (key === 'l') {
        e.preventDefault()
        e.stopPropagation()
        toggleList()
        return
      }

      if (key === 'p') {
        e.preventDefault()
        e.stopPropagation()
        doCopy()
        return
      }
    }

    if (e.key === 'Escape') {
      if (comments.hasDraft) { e.preventDefault(); e.stopPropagation(); comments.cancelDraft(); return }
      if (mode !== 'select') { e.preventDefault(); e.stopPropagation(); setMode('select') }
    }
  }

  // select / comment / reorder 三态互斥，且都要接管页面指针事件，
  // 因此收敛到单一入口：按钮点击与快捷键最终都走这里，
  // 状态与工具条高亮不会分叉。
  let mode = 'select'

  const MODE_HINTS = {
    comment: '点击任意元素写下需求 · 按住 Shift 连续添加 · Esc 退出',
    reorder: '拖动 flex / grid 容器里的子元素调整顺序 · Esc 退出',
  }

  const setMode = next => {
    const changed = mode !== next
    mode = next

    comments.setActive(next === 'comment')
    layoutDrag.setActive(next === 'reorder')
    toolbar.setMode(next)

    if (next !== 'select') {
      engine.unselect_all()
      panel.hidden = true
    }

    if (changed && MODE_HINTS[next]) toolbar.toast(MODE_HINTS[next])
  }

  // 兼容既有调用点
  const setCommentMode = on => setMode(on ? 'comment' : 'select')
  const setReorderMode = on => setMode(on ? 'reorder' : 'select')

  // 评论模式下点击不选中元素，而是在该元素上起草评论。
  // 用 document capture 抢在 VisBug 的 body capture 监听之前。
  const onClickCapture = e => {
    if (!comments.active || interactive) return

    if (isEditorUI(e)) return

    // 同样绕开覆盖层，取用户真正点到的页面元素
    const target = pageElementAt(e.clientX, e.clientY)
    if (!target || target === document.documentElement) return

    e.preventDefault()
    e.stopPropagation()

    comments.startDraft(target, e.clientX, e.clientY)
    if (!e.shiftKey) setCommentMode(false)
  }

  // ── 文字编辑 ──────────────────────────────────────────────
  // 双击页面文字会进入 VisBug 的编辑态（元素被设成 contenteditable），
  // 改动直接落在 DOM 上，不经过 ChangeStore，所以这里补两件事：
  //   focusin 时确保原文已经进快照（要赶在第一个按键之前）
  //   input 时广播一次，让面板与改动列表跟上
  // 一整段文字编辑算一次操作：逐字入栈的话，⌘Z 得按到手酸才退得回去
  let textMark = null

  const onTextFocus = e => {
    const el = e.target
    if (!(el instanceof HTMLElement) || !el.isContentEditable) return
    if (isEditorUI(el)) return

    ChangeStore.markEdited(el)
    textMark = ChangeStore.beginText(el)
  }

  const onTextBlur = e => {
    const el = e.target
    if (!textMark || el !== textMark.el) return
    ChangeStore.endText(textMark)
    textMark = null
  }

  let textTimer = null
  const onTextInput = e => {
    const el = e.target
    if (!(el instanceof HTMLElement) || !el.isContentEditable) return
    if (isEditorUI(el)) return

    // 逐键广播会让整张改动列表每次击键都重排一遍，攒一小会儿再说
    clearTimeout(textTimer)
    textTimer = setTimeout(() => ChangeStore.touch(), 200)
  }

  document.addEventListener('focusin', onTextFocus, true)
  document.addEventListener('focusout', onTextBlur, true)
  document.addEventListener('input', onTextInput, true)
  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('keydown', onKeydown, true)

  const doCopy = async () => {
    const result = await copyPrompt(ChangeStore.read())

    if (!result.ok) {
      toolbar.toast(result.reason === 'empty' ? '还没有任何改动' : '复制失败，请检查剪贴板权限', 'error')
      return result
    }

    const n = ChangeStore.stats().total
    const files = result.refs?.files || []

    if (!files.length) {
      toolbar.toast(`已复制 ${n} 项改动到剪贴板`)
      return result
    }

    // 图片落盘走两条路（扩展下载 / 页面下载），只有前者拿得到确切路径。
    // 这个差别直接决定 AI 能不能读到图，所以必须让用户看见，
    // 而不是让他粘贴之后才发现 AI 说「路径不存在」。
    const saved  = files.filter(f => f.path).length
    const failed = files.length - saved

    toolbar.toast(
      failed   ? `已复制 ${n} 项改动；${saved} 张图已存，${failed} 张落盘失败`
      : result.refs.exact
                 ? `已复制 ${n} 项改动，${saved} 张图已存入下载目录（提示词含绝对路径）`
                 : `已复制 ${n} 项改动，${saved} 张图已下载；提示词里的路径为推测`,
      failed ? 'error' : 'info')

    return result
  }

  panel.addEventListener('vr-copy', doCopy)
  list.addEventListener('vr-copy', doCopy)
  toolbar.addEventListener('vr-copy', doCopy)

  toolbar.addEventListener('vr-undo', doUndo)
  toolbar.addEventListener('vr-redo', doRedo)
  toolbar.addEventListener('vr-mode', e => setMode(e.detail.mode))
  toolbar.addEventListener('vr-close', () => visbug.remove())
  toolbar.addEventListener('vr-open-list', toggleList)

  // 面板的 × 等同关闭整个编辑器：只藏面板会让用户以为关不掉，
  // 而页面上其实还挂着选择引擎在拦截点击。
  panel.addEventListener('vr-close', () => visbug.remove())
  panel.addEventListener('vr-comment-toggle', () => setCommentMode(!comments.active))
  panel.addEventListener('vr-reorder-toggle', () => setReorderMode(!layoutDrag.active))
  list.addEventListener('vr-toast', e => toolbar.toast(e.detail.message, e.detail.kind))

  panel.addEventListener('vr-open-list', () => {
    list.hidden = !list.hidden
    if (!list.hidden) list.render()
  })

  list.addEventListener('vr-locate', e => {
    const el = e.detail?.el
    if (!el?.isConnected) return
    engine.unselect_all()
    engine.select(el)
    panel.hidden = false
  })

  const api = {
    panel,
    list,
    comments,
    toolbar,
    layoutDrag,
    get mode() { return mode },
    setMode,
    setCommentMode,
    setReorderMode,
    undo: doUndo,
    redo: doRedo,
    enterInteractive,
    exitInteractive,
    toggleInteractive,
    get interactive() { return interactive },
    destroy() {
      clearTimeout(textTimer)
      document.removeEventListener('focusin', onTextFocus, true)
    document.removeEventListener('focusout', onTextBlur, true)
      document.removeEventListener('input', onTextInput, true)
      document.removeEventListener('keydown', onKeydown, true)
      document.removeEventListener('click', onClickCapture, true)
      engine.removeSelectedCallback(onSelected)
      panel.remove()
      list.remove()
      comments.remove()
      toolbar.remove()
      layoutDrag.destroy()
      document.getElementById('visual-revise-locate-overlay')?.remove()
    },
  }

  // 直接挂 api 本身：展开运算符会把 interactive 这个 getter 求值成静态值
  api.store = ChangeStore

  // 打包后的运行时入口，供调试与自动化测试使用——
  // 直接 import 源码会撞上 blingblingjs 等裸模块说明符
  api.lib = {
    buildPrompt, copyPrompt,
    exportJSON, importJSON, downloadJSON, pickAndImport,
    fingerprint, findSharedElements,
    loadLocalFonts, fontsSupported,
    isTextElement,
    resizeMode, planResize, currentSize, isMainAxis, cssVariables,
    parseTracks, serializeTracks, readTracks, gridShape,
    flowOf, planFlow, alignmentOf, planAlignment,
  }
  // 构建时间由 rollup 注入。一句话回答「我这份是不是最新的」——
  // 扩展重载、页面刷新、脚本缓存，三者任缺一环看到的都是上一版，
  // 而界面上分辨不出来。
  api.build = typeof __VR_BUILD__ === 'string' ? __VR_BUILD__ : 'dev'
  console.log(`[Visual Revise] 已就绪 · 构建于 ${api.build}`)

  window.__visualRevise = api
  return api
}
