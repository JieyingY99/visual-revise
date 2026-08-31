import { ChangeStore } from './change-store.js'
import { copyPrompt } from './prompt-export.js'
import '../components/props-panel/props-panel.element.js'
import '../components/change-list/change-list.element.js'
import '../components/comment-layer/comment-layer.element.js'
import { createLayoutDrag } from './layout-drag.js'
import { pageElementAt, isEditorUI } from './dom-utils.js'
import { buildPrompt } from './prompt-export.js'
import { exportJSON, importJSON, downloadJSON, pickAndImport } from './json-io.js'
import { fingerprint, findSharedElements } from './shared-elements.js'
import { loadLocalFonts, isSupported as fontsSupported } from './local-fonts.js'
import { clearHighlight } from '../components/change-list/change-list.element.js'

const UI_TAGS = 'visbug-handles, visbug-label, visbug-hover, visbug-grip, visbug-metatip, visbug-ally, visbug-corners, visbug-gridlines'

export const mountVisualRevise = visbug => {
  const engine = visbug.selectorEngine
  if (!engine) return null

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

  const layoutDrag = createLayoutDrag({
    onDone: ({ ordered }) => panel.toast(`已重排 ${ordered.length} 个元素`),
  })

  let interactive = false
  let suspended = []
  let listWasOpen = false

  const onSelected = els => {
    if (interactive) return
    panel.setTargets(els)
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
    setCommentMode(false)
    setReorderMode(false)
    clearHighlight()
  }

  const exitInteractive = () => {
    if (!interactive) return
    interactive = false
    engine.resume()
    document.querySelectorAll(UI_TAGS).forEach(el => { el.style.display = '' })
    panel.hidden = false
    list.hidden = !listWasOpen
    comments.hidden = false
    suspended.filter(el => el.isConnected).forEach(el => engine.select(el))
    panel.setTargets(engine.selection())
  }

  const toggleInteractive = () => interactive ? exitInteractive() : enterInteractive()

  // capture 阶段拦截，抢在 hotkeys-js 的 document 监听之前
  const onKeydown = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (isEditorUI(e)) return   // 面板内部按键归面板（Tab 切焦点、Esc 关弹窗）

    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      toggleInteractive()
      return
    }

    if (e.key === 'r' && !interactive) {
      e.preventDefault()
      e.stopPropagation()
      setReorderMode(!layoutDrag.active)
      return
    }

    if (e.key === 'c' && !interactive) {
      e.preventDefault()
      e.stopPropagation()
      setCommentMode(!comments.active)
      return
    }

    if (e.key === 'Escape') {
      if (comments.hasDraft) { e.preventDefault(); e.stopPropagation(); comments.cancelDraft(); return }
      if (comments.active)   { e.preventDefault(); e.stopPropagation(); setCommentMode(false); return }
      if (layoutDrag.active) { e.preventDefault(); e.stopPropagation(); setReorderMode(false) }
    }
  }

  const setCommentMode = on => {
    if (on) setReorderMode(false)
    comments.setActive(on)
    panel.setCommentMode(on)
  }

  // 拖拽重排与评论模式互斥：两者都要接管页面上的指针事件
  const setReorderMode = on => {
    if (on) {
      comments.setActive(false)
      panel.setCommentMode(false)
    }
    layoutDrag.setActive(on)
    panel.setReorderMode(on)
  }

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

  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('keydown', onKeydown, true)

  const doCopy = async () => {
    const result = await copyPrompt(ChangeStore.read())
    result.ok
      ? panel.toast(`已复制 ${ChangeStore.stats().total} 项改动`)
      : panel.toast(result.reason === 'empty' ? '还没有任何改动' : '复制失败，请检查剪贴板权限', 'error')
    return result
  }

  panel.addEventListener('vr-copy', doCopy)
  list.addEventListener('vr-copy', doCopy)

  // 面板的 × 等同关闭整个编辑器：只藏面板会让用户以为关不掉，
  // 而页面上其实还挂着选择引擎在拦截点击。
  panel.addEventListener('vr-close', () => visbug.remove())
  panel.addEventListener('vr-comment-toggle', () => setCommentMode(!comments.active))
  panel.addEventListener('vr-reorder-toggle', () => setReorderMode(!layoutDrag.active))
  list.addEventListener('vr-toast', e => panel.toast(e.detail.message, e.detail.kind))

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
    layoutDrag,
    setCommentMode,
    setReorderMode,
    enterInteractive,
    exitInteractive,
    toggleInteractive,
    get interactive() { return interactive },
    destroy() {
      document.removeEventListener('keydown', onKeydown, true)
      document.removeEventListener('click', onClickCapture, true)
      engine.removeSelectedCallback(onSelected)
      panel.remove()
      list.remove()
      comments.remove()
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
  }
  window.__visualRevise = api
  return api
}
