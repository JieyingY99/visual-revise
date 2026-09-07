/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import hotkeys from 'hotkeys-js'
import { ChangeStore } from './change-store.js'
import { copyPrompt } from './prompt-export.js'
import '../components/props-panel/props-panel.element.js'
import '../components/change-list/change-list.element.js'
import '../components/comment-layer/comment-layer.element.js'
import '../components/toolbar/toolbar.element.js'
import '../components/tree/tree.element.js'
import { createLayoutDrag } from './layout-drag.js'
import { pageElementAt, isEditorUI, isTypingTarget, isTextElement } from './dom-utils.js'
import { buildPrompt } from './prompt-export.js'
import { exportJSON, importJSON, downloadJSON, pickAndImport } from './json-io.js'
import { fingerprint, findSharedElements } from './shared-elements.js'
import { loadLocalFonts, isSupported as fontsSupported } from './local-fonts.js'
import { clearHighlight } from './highlight.js'
import { applyPlacement } from './placement.js'
import { resizeMode, planResize, currentSize, isMainAxis, declaredVariables } from './resizing.js'
import { parseTracks, serializeTracks, readTracks, gridShape } from './grid.js'
import { flowOf, planFlow, alignmentOf, planAlignment } from './layout.js'
import { semanticName, describeNode, childrenOf } from './tree-model.js'
import { orderedChildren } from './reorder.js'

// visbug-distance 是「粘住」的测距线：它的所有权已从 measurements 模块转移出去，
// 停用工具时的 clearMeasurements() 清不到它们，只能在这里一并收起。
const UI_TAGS = 'visbug-handles, visbug-label, visbug-hover, visbug-grip, visbug-metatip, visbug-ally, visbug-corners, visbug-gridlines, visbug-distance'

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

  // 上游给它那 13 个工具各注册了一个单字母热键（g i x l m p a v h d f e s），
  // 而工具条默认是隐藏的。于是在页面上随手打个字就可能切到 margin / font /
  // hueshift / boxshadow——界面上没有任何提示，但方向键从此就在改样式了，
  // 连 Tab 隐身态（本该完全让开）也照样中招。
  //
  // 只解热键，不动工具本身：浏览模式靠 visbug.guides() 直调恢复、双击进 text
  // 工具走的是 toolSelected()，都不经过热键；⌘/Ctrl + / 唤出工具条后点击也照常。
  Object.keys(visbug.toolbar_model || {}).forEach(key => hotkeys.unbind(key))

  // 上一次 destroy 会断开重锚观察器，重新挂载时要接回来（内部幂等）
  ChangeStore.observe()

  const panel = document.createElement('visual-revise-panel')
  document.body.appendChild(panel)

  const list = document.createElement('visual-revise-list')
  list.hidden = true
  document.body.appendChild(list)

  const comments = document.createElement('visual-revise-comment-layer')
  document.body.appendChild(comments)

  const toolbar = document.createElement('visual-revise-toolbar')
  document.body.appendChild(toolbar)

  // 结构树不再是独立浮层：它活在属性面板的「结构」tab 里，由面板持有。
  // 树发出的事件带 composed，会从面板的 shadow 冒上来，所以监听挂在面板上。

  const layoutDrag = createLayoutDrag({
    // 有些上游工具自己吃鼠标（Position 是按下拖着改 left/top）。在 pointerdown
    // 那一刻问一次当前工具，比靠 setActive 同步一个状态位可靠——mode 与
    // activeTool 是两个维度，而切工具的 toolSelected() 不在这一层。
    activeTool: () => visbug.activeTool,
    // 选中框浮在元素上方、四角还有拦指针的缩放把手，拖之前先让开
    onDragStart: () => engine.unselect_all(),
    onDone: ({ el, toParent }) => {
      // 松手后那次 click 被拖拽吞掉了，选中得由我们自己接回来——
      // 否则用户刚搬完的元素反而失去了焦点，面板也跟着空掉
      if (el?.isConnected) engine.select(el)
      toolbar.toast(`已移动到 ${describeNode(toParent).name} 里`)
    },
  })
  // 初始模式就是 select，而 setMode 只在切换时才跑。不在这里开一次，
  // 拖拽要等用户先切一次模式才活过来——最常见的那条路径反而是死的。
  layoutDrag.setActive(true)

  let interactive = false
  // 声明要排在 onSelected 之前：engine.onSelectedUpdate 注册时会立刻回调一次，
  // 那时 mode 还在暂时性死区里，读它会直接抛错
  let mode = 'select'
  let suspended = []
  let listWasOpen = false
  // 进浏览模式要真正停掉 VisBug 的工具，退出时按原样装回来
  let suspendedTool = null
  // Tab 的「完全让开」：连工具条一起藏。浏览模式只让开页面，工具条留着，
  // 否则进去就出不来了
  let stealth = false
  let modeBeforeStealth = 'select'


  const onSelected = els => {
    if (interactive) return

    // 先让面板可见，再灌内容：结构树在 display:none 下量不出高度，
    // 那时做的「滚到选中行」等于没做，选中项会停在视口外看不见
    panel.hidden = !(els && els.length)
    panel.setTargets(els)
    // 固定位置：默认那个，或者用户自己拖过去的那个。不跟着选中的元素走——
    // 每换一个元素就跳一次，眼睛每次都得重新找它。
    applyPlacement(panel)
  }

  engine.onSelectedUpdate(onSelected)

  // 窗口变小后，记住的位置可能整块落在视口外——面板是 fixed 的，页面滚不到
  // 那里，等于再也拖不回来。applyPlacement 会拿记住的坐标重新夹一次：
  // 窗口缩小时挤回视口内，重新拉大时又回到原来那个位置。
  addEventListener('resize', () => applyPlacement(panel))

  // 交互态：让页面恢复自己的 hover / click 行为，供用户验证真实交互。
  // 选中集在退出时原样恢复，改动记录不受影响（它活在 ChangeStore 里）。
  // 让开页面：暂停选择引擎、收掉所有覆盖层。工具条藏不藏由 stealth 决定，
  // 这是浏览模式和 Tab「完全让开」唯一的区别。
  const enterInteractive = () => {
    if (interactive) return
    interactive = true
    suspended = engine.selection().slice()
    engine.unselect_all()
    engine.pause()

    // 只给覆盖层设 display:none 不够——VisBug 的 guides 工具仍绑着 body 的
    // mousemove，它的 showGridlines() 里有一句 `gridlines.style.display = null`，
    // 鼠标一动就把我们设的 none 清掉，标尺线又浮回页面上。
    // 要让页面真正干净，必须解绑工具本身。
    suspendedTool = visbug.activeTool
    visbug.deactivate_feature?.()

    document.querySelectorAll(UI_TAGS).forEach(el => { el.style.display = 'none' })
    panel.hidden = true
    listWasOpen = !list.hidden
    list.hidden = true
    // pin 有 pointer-events，留着会挡住页面上那个位置的点击
    comments.hidden = true
    clearHighlight()
  }

  const exitInteractive = () => {
    if (!interactive) return
    interactive = false
    engine.resume()

    // 不能走 toolSelected()：它开头就有一句同名去重
    // （active_tool.dataset.tool === el.dataset.tool 时直接 return），
    // 而 active_tool 在停用后并未清空，恢复同一个工具会被它挡掉。
    // 直接调用工具方法，它内部会重新赋值 deactivate_feature。
    if (suspendedTool && typeof visbug[suspendedTool] === 'function')
      visbug[suspendedTool]()
    suspendedTool = null

    document.querySelectorAll(UI_TAGS).forEach(el => { el.style.display = '' })
    list.hidden = !listWasOpen
    comments.hidden = false
    suspended.filter(el => el.isConnected).forEach(el => engine.select(el))
  }

  // Tab：在当前编辑模式和「完全让开」之间来回。让开时连工具条一起藏，
  // 所以只能靠再按一次 Tab 回来——这正是它和浏览模式的分工。
  const toggleInteractive = () => {
    if (stealth) {
      stealth = false
      setMode(modeBeforeStealth)
      return
    }
    modeBeforeStealth = mode
    stealth = true
    setMode('browse')
    toolbar.hidden = true
  }

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

  // 面板里的弹层：下拉、色盘、填充、右键菜单。它们都挂在 body 上。
  const POPUP_IDS = [
    'visual-revise-menu',
    'visual-revise-select-panel',
    'visual-revise-color-panel',
    'visual-revise-fill-panel',
  ]
  const hasOpenPopup = () => POPUP_IDS.some(id => document.getElementById(id))

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

    // ⌥Delete / ⌥Backspace 清空选中元素的 inline style。
    //
    // 必须排在下面那道「带修饰键就放行」之前，于是它绕过了后面那两道守卫，
    // 所以自己得把它们带上——否则会吃掉输入框里「往回删一个词」的
    // ⌥Backspace，还会顺手把页面上选中元素的样式一起清掉。
    //
    // 从 selectable.js 的 hotkey 接管过来，是为了走 ChangeStore：上游那条
    // 直接改 DOM，历史栈里没有对应条目，用户按 ⌘Z 想救回来，反而又丢掉
    // 上一条无关操作；而且它调的 el.attr() 是 blingblingjs 挂在实例上的糖，
    // 注入之后才出现的元素身上根本没有，功能当场抛错。
    if (e.altKey && !e.metaKey && !e.ctrlKey
      && (e.key === 'Delete' || e.key === 'Backspace')
      && !interactive && !isTypingTarget(e) && !isEditorUI(e)) {
      const targets = engine.selection().filter(el => el?.isConnected && !isEditorUI(el))
      if (!targets.length) return

      e.preventDefault()
      e.stopPropagation()

      // 逐条 applyProp 而不是 removeAttribute('style')：一键抹掉的每条声明都该
      // 在改动记录里看得见，也才 ⌘Z 得回来。important 由 applyProp 自己处理。
      let cleared = 0
      ChangeStore.history.batch(
        targets.length > 1 ? `清空 ${targets.length} 个元素的样式` : '清空样式',
        () => targets.forEach(el => {
          // 先取一份清单再删：边遍历边 removeProperty 会漏掉一半
          for (const prop of [...el.style]) {
            ChangeStore.applyProp(el, prop, '')
            cleared++
          }
        }))

      panel.toast(cleared
        ? `已清空 ${cleared} 条 inline 样式 · ⌘Z 可撤销`
        : '这些元素上没有 inline 样式')
      return
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return

    // 面板内部只让出 Tab 与 Escape——这两个在面板里有自己的语义（切焦点、关弹窗）。
    // 不能整块让路：用鼠标点过工具条按钮后，焦点就停在 shadow DOM 里那个 button 上，
    // 整块让路会让此后所有快捷键失效，直到用户点回页面——而「点按钮切模式，
    // 然后接着用键盘」恰恰是最常见的操作顺序。
    // 单字母键在面板里没有任何语义，输入框由下面的 isTypingTarget 兜住。
    if (isEditorUI(e) && e.key === 'Tab') return

    // Esc 在面板里只有一个语义：关掉正开着的弹层（下拉 / 色盘 / 菜单）。
    // 没有弹层时不该放行——否则用户在面板里点完一个控件、顺手按 Esc 想退出
    // 当前模式，会什么也不发生，得先点一下页面再按，而「点一下面板然后接着
    // 用键盘」恰恰是最常见的操作顺序。
    // 这些弹层都挂在 body 上而不在 shadow 里（要脱离面板的层叠上下文），
    // 所以按 id 找得到。
    if (isEditorUI(e) && e.key === 'Escape' && hasOpenPopup()) return

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
    // 工具条可见时，它上面每个按钮的快捷键都必须管用——tooltip 已经把键印在
    // 那儿了，按下去没反应就是在骗人。真正「把页面完全让给网站」的是 Tab
    // 隐身态：那时工具条也藏起来，除 Tab 外一律放行，两层职责各管一段。
    if (!stealth) {
      const key = e.key.toLowerCase()

      // V 让开页面，C 评论。选择元素拆成两个键，直接落到面板的两个 tab 上：
      // A 看属性、F 看结构——比「先切模式再切 tab」少一步。
      if (key === 'a' || key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        setMode('select')
        if (panel.target) panel.setTab(key === 'f' ? 'structure' : 'props')
        layoutDrag.setActive(mode === 'select')
        return
      }

      const MODE_KEYS = { v: 'browse', c: 'comment' }
      if (MODE_KEYS[key]) {
        e.preventDefault()
        e.stopPropagation()
        // 幂等，不做 toggle：这四个模式是一组 segmented control，
        // 连按 C 就该一直停在评论模式，正如点两次「Work」不会跳回别处。
        // 退出某个模式靠按对应的那个键（多半是 V）或 Esc，不靠再按一次同一个键。
        setMode(MODE_KEYS[key])
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
      // 正拖着的时候，Esc 先取消这一次拖拽——收尾但不提交，页面回到拖之前。
      // 排在最前：此刻用户要撤的是手上这个动作，不是模式，也不是选中。
      if (layoutDrag.dragging) {
        e.preventDefault()
        e.stopPropagation()
        layoutDrag.cancelDrag()
        return
      }

      // 浏览模式与隐身态都用 Esc 回到选择态
      if (interactive) { e.preventDefault(); e.stopPropagation(); setMode('select'); return }
      if (comments.hasDraft) { e.preventDefault(); e.stopPropagation(); comments.cancelDraft(); return }
      if (mode !== 'select') { e.preventDefault(); e.stopPropagation(); setMode('select'); return }

      // 正在编辑文案：Esc 的第一层语义是退出编辑态，第二下才取消选中。
      //
      // 判据是「事件 target 自己就是 contenteditable」，不能放宽成
      // isTypingTarget——焦点在面板输入框里时 Esc 该做的是关弹层 / 取消选中。
      //
      // 自己做这三件事，不调 text.js 的 cleanup：它没 export，而且它里面的
      // removeEditability 有一句 hotkeys.unbind('escape,esc')，会把全局所有
      // esc 绑定（含快捷键帮助浮层自己的）一起解掉。
      // 上游注册的 hotkeys('escape,esc', cleanup) 从来就没执行过：
      // hotkeys-js 的默认 filter 在 contenteditable 上根本不派发。
      const editing = e.composedPath?.()[0]
      if (editing?.isContentEditable && !isEditorUI(editing)) {
        e.preventDefault()
        e.stopPropagation()
        editing.blur()
        editing.removeAttribute('contenteditable')
        editing.removeAttribute('spellcheck')
        getSelection()?.empty?.()
        return
      }

      // 已经在选择态，Esc 的下一层语义是取消选中。
      //
      // 这件事名义上由 VisBug 的 hotkeys('esc') 负责，但那条链路有两个断点：
      // 它会跳过输入框里的按键（用户刚点完面板控件时焦点正在输入框里），
      // 而且跟着活动工具走——编辑过一次文案（工具切到 text）之后就不再响应。
      // 两种情况下用户按 Esc 都毫无反应，界面上也看不出为什么。
      // 所以这里直接接管，不依赖它。
      if (engine.selection().length) {
        e.preventDefault()
        e.stopPropagation()
        engine.unselect_all()
      }
    }
  }

  // select / comment / reorder 三态互斥，且都要接管页面指针事件，
  // 因此收敛到单一入口：按钮点击与快捷键最终都走这里，
  // 状态与工具条高亮不会分叉。

  const MODE_HINTS = {
    browse: '页面已交还给你，正常点击即可 · Esc 或再点一次回到编辑',
    comment: '点击任意元素写下需求 · 可连续标注 · Esc 退出',
  }

  const setMode = next => {
    const changed = mode !== next
    mode = next

    // 浏览模式就是「让开页面」，只是工具条留着
    next === 'browse' ? enterInteractive() : exitInteractive()
    if (next !== 'browse') stealth = false
    toolbar.hidden = stealth

    comments.setActive(next === 'comment')
    // 页面上直接拖元素在整个选择模式下都开着。以前只在「结构」tab 下开，
    // 是因为它在 pointerdown 那一刻就抢事件、会挡住正常的选中；现在有了
    // 4px 的起拖阈值，按下不动仍然是选中，不再需要靠 tab 把它关起来。
    layoutDrag.setActive(next === 'select')
    toolbar.setMode(next)

    if (next !== 'select') {
      engine.unselect_all()
      panel.hidden = true
    }

    if (changed && MODE_HINTS[next]) toolbar.toast(MODE_HINTS[next])
  }

  // 兼容既有调用点
  const setCommentMode = on => setMode(on ? 'comment' : 'select')

  // 拖拽移动不再是一个模式，但「临时关掉 / 打开页面上的拖拽」这件事还在
  // （调用方要的一直是这个语义）。关：把手上这一次拖拽取消掉并停用；
  // 开：回到选择模式并启用。
  const setReorderMode = on => {
    if (!on) { layoutDrag.setActive(false); return }
    if (mode !== 'select') setMode('select')
    layoutDrag.setActive(mode === 'select')
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

    // 模式保持不变：它是用户明确选的，一次点击就把它切走，
    // 连着标注两个元素都得重新按一次 C
    comments.startDraft(target, e.clientX, e.clientY)
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

    // 进入文案编辑会把 VisBug 的活动工具切成 text，而 selectable 的热键是
    // 跟着工具激活/解绑的。编辑结束不切回来的话，此后 Esc 不再取消选中、
    // 层级导航那一组键也全哑了——用户只是改了一句话，整套键盘操作却没了，
    // 而界面上完全看不出发生过什么。
    visbug.toolSelected?.('guides')
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

  // 点插件自己的 UI，不该惊动页面。
  // 页面上的 popover / dropdown / modal 普遍靠「点在外面就关掉」收起自己，
  // 那是一个绑在 document 上的 pointerdown / mousedown / click 监听器。
  // 而我们的面板就在页面 DOM 里，点它时事件照样冒到 document，
  // 页面于是判定「点在外面」，把用户正看着的菜单关掉了。
  //
  // 拦在 body 的冒泡阶段：此刻插件 UI 内部早已处理完自己的事，
  // 而 document 上页面的监听器还没轮到。绑 body 而不是 document，
  // 是因为同一元素同一阶段按注册顺序触发，抢不过页面先注册的那些。
  //
  // 只掐这几个「按下」类事件，不碰 pointerup / mouseup：
  // 元素缩放把手的收尾监听（handle.element.js）绑在 document 的冒泡阶段，
  // 用户完全可能把元素拖到面板上方才松手，掐了它拖拽就再也结束不了。
  // 插件自己那四个「点外面关闭」（color / select / fill / menu）都绑在
  // 捕获阶段，document 先于此处收到事件，同样不受影响。
  const PAGE_ISOLATED = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu']
  const isolateFromPage = e => { if (isEditorUI(e)) e.stopPropagation() }
  for (const type of PAGE_ISOLATED)
    document.body.addEventListener(type, isolateFromPage)

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

  // 点树里的一行等同在页面上选中它：选中状态只有一份，
  // 树和页面各记一套的话，两边迟早对不上
  panel.addEventListener('vr-tree-select', e => {
    const el = e.detail?.el
    if (!el?.isConnected) return
    engine.unselect_all()
    engine.select(el)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  panel.addEventListener('vr-tree-move', e => {
    const el = e.detail?.el
    if (!el?.isConnected) return
    toolbar.toast(`已移动到 ${describeNode(e.detail.toParent).name} 里`)
  })


  // × 只收这块面板，不动当前模式——用户多半还想接着选下一个元素，
  // 把他从选择模式踢到浏览模式是自作主张。退出整个编辑器是工具条上那个 × 的事。
  panel.addEventListener('vr-close', () => {
    // 位置不动：关掉再打开还在原处才叫「记住」。
    // 取消选中就够了：onSelected 里 panel.hidden 跟着选中数走，面板自己会收。
    // 只藏面板而不取消选中的话，下次选中同一个元素时 onSelected 认为没变化，
    // 面板不会重新出现，× 看着就像把面板弄坏了。
    engine.unselect_all()
  })
  panel.addEventListener('vr-comment-toggle', () => setCommentMode(!comments.active))
  // 监听挂在 document 上而不是某一个组件上：vr-toast 全是 bubbles + composed，
  // 挂在 list 上就只有改动列表那一路有人接——评论层图片超限的报错、粘贴读不到
  // 剪贴板的提示都派得出去、没人显示，用户点了「+」选了图，界面上什么都没发生。
  const onToast = e => toolbar.toast(e.detail.message, e.detail.kind)
  document.addEventListener('vr-toast', onToast)

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
      document.removeEventListener('vr-toast', onToast)
      for (const type of PAGE_ISOLATED)
        document.body.removeEventListener(type, isolateFromPage)
      engine.removeSelectedCallback(onSelected)
      // 不断开的话，插件「关掉」之后它仍在观察整个文档树
      ChangeStore.unobserve()
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
  // 树活在面板的 shadow 里，测试与调试从这里拿
  Object.defineProperty(api, 'tree', {
    get: () => panel.shadowRoot?.querySelector('visual-revise-tree') || null,
  })
  api.lib = {
    buildPrompt, copyPrompt,
    exportJSON, importJSON, downloadJSON, pickAndImport,
    fingerprint, findSharedElements,
    loadLocalFonts, fontsSupported,
    isTextElement,
    resizeMode, planResize, currentSize, isMainAxis,
    // cssVariables 是旧名，调试台和外部脚本还在用，留着做别名
    declaredVariables, cssVariables: declaredVariables,
    parseTracks, serializeTracks, readTracks, gridShape,
    flowOf, planFlow, alignmentOf, planAlignment,
    semanticName, describeNode, childrenOf, orderedChildren,
    moveElement: (el, toParent, toNext) => ChangeStore.moveElement(el, toParent, toNext),
  }
  // 构建时间由 rollup 注入。一句话回答「我这份是不是最新的」——
  // 扩展重载、页面刷新、脚本缓存，三者任缺一环看到的都是上一版，
  // 而界面上分辨不出来。
  api.build = typeof __VR_BUILD__ === 'string' ? __VR_BUILD__ : 'dev'
  console.log(`[Visual Revise] 已就绪 · 构建于 ${api.build}`)

  // 把版本落到 DOM 上：inject.js 跑在隔离世界，读不到这里的 window，
  // 但 DOM 是两个世界共用的。它据此判断「页面里跑的这份是不是磁盘上那份」。
  document.documentElement.dataset.visualReviseBuild = api.build

  window.__visualRevise = api
  return api
}
