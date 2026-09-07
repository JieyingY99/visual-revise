/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { pageElementAt, isEditorUI } from './dom-utils.js'
import { canDrag, orderedChildren } from './reorder.js'
// 与树里的拖拽共用同一套落点模型与写入口：两个入口写出的记录必须一致
import { ChangeStore } from './change-store.js'

const INDICATOR_ID = 'visual-revise-drop-indicator'
const HINT_STYLE_ID = 'visual-revise-drag-hints'

// 按下多少像素才算拖拽。没有阈值的话，pointerdown 那一刻就得抢走事件，
// 页面上的「点一下选中」就再也点不动了——这正是重排只能待在结构 tab 里的原因。
const DRAG_SLOP = 4

// 这几个上游工具自己用鼠标做事（Position 是按下拖着改 left/top）。页面拖拽
// 一旦 armed，4px 处就会 beginDrag → onDragStart → unselect_all，把这些工具挂
// 在选中项上的 draggable / 监听整套拆掉，手势被整个抢走，工具那边一点反应都没有。
// 判断放在「按下那一刻」而不是靠 setActive 同步一个状态位：mode（select /
// browse / comment）与 visbug.activeTool 是两个维度，而切工具的 toolSelected()
// 定义在 <vis-bug> 元素上，钩不进去。
const MOUSE_TOOLS = new Set(['position', 'move'])

// 用属性 + 全局样式表标记落点容器，而不是写 inline style——
// 后者会被快照 diff 当成用户改动记进提示词。
//
// 只标当前悬停的那一个。早先是拖拽一开始就把全页的 flex/grid 容器都描上虚线，
// 放开跨容器限制后那等于给几千个节点一起加 outline，整页闪成一团。
const HINT_CSS = `
  [data-vr-drop-target] {
    outline: 2px solid rgba(13, 153, 255, .85) !important;
    outline-offset: 1px !important;
  }`

const ensureHintStyle = () => {
  if (document.getElementById(HINT_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = HINT_STYLE_ID
  style.setAttribute('data-visual-revise-ui', '')
  style.textContent = HINT_CSS
  document.head.appendChild(style)
}

const markDropTarget = el => {
  document.querySelectorAll('[data-vr-drop-target]').forEach(node => {
    if (node !== el) node.removeAttribute('data-vr-drop-target')
  })
  el?.setAttribute('data-vr-drop-target', '')
}

const clearDropTarget = () =>
  document.querySelectorAll('[data-vr-drop-target]')
    .forEach(el => el.removeAttribute('data-vr-drop-target'))

const indicator = () => {
  let el = document.getElementById(INDICATOR_ID)
  if (el) return el

  el = document.createElement('div')
  el.id = INDICATOR_ID
  el.setAttribute('data-visual-revise-ui', '')
  el.style.cssText = `
    position: absolute; z-index: 2147483645; pointer-events: none;
    background: #0d99ff; border-radius: 2px; display: none;
    box-shadow: 0 0 6px rgb(13 153 255 / .8);`
  document.body.appendChild(el)
  return el
}

// 横排容器按 x 判前后，其余按 y。非 flex/grid 的容器 flexDirection 恒为
// 'row'，直接读它会把块级容器也当成横排，插入线就画在了左右两侧。
const isRow = container => {
  const cs = getComputedStyle(container)
  return /flex|grid/.test(cs.display) && !/column/.test(cs.flexDirection || 'row')
}

// 能不能把东西放进去。跟树里的中段判定同一条规则，两个入口的手感才一样。
const canHold = el =>
  orderedChildren(el).length > 0
  || /^(block|flex|grid|inline-flex|inline-grid)$/.test(getComputedStyle(el).display)

// 指针底下那个元素分三段：靠前 1/3 插到它前面、靠后 1/3 插到它后面、
// 中间 1/3 放进它里面。和结构树完全一致，用户在哪边拖都是同一套心智模型。
const dropTargetAt = (x, y, dragged) => {
  // 被拖元素还留在文档流里（只是压暗），不让开的话命中的永远是它自己
  const kept = dragged.style.getPropertyValue('pointer-events')
  dragged.style.setProperty('pointer-events', 'none')
  let hit = pageElementAt(x, y)
  kept ? dragged.style.setProperty('pointer-events', kept)
       : dragged.style.removeProperty('pointer-events')

  // 命中被拖元素的后代（它们自己还收事件）时往上退出这棵子树
  while (hit && (hit === dragged || dragged.contains(hit))) hit = hit.parentElement
  if (!hit || hit === document.documentElement) return null

  const rect = hit.getBoundingClientRect()
  const parent = hit.parentElement

  // <body> 没有可用的父级，只能往它里面放
  const holdOnly = !parent || parent === document.documentElement || hit === document.body

  const row = isRow(holdOnly ? hit : parent)
  const pos = row ? x - rect.left : y - rect.top
  const size = row ? rect.width : rect.height
  const third = size / 3

  if (!holdOnly && pos < third)
    return { toParent: parent, toNext: hit, edge: 'before', ref: hit, row }
  if (!holdOnly && pos > size - third) {
    const kids = orderedChildren(parent)
    return { toParent: parent, toNext: kids[kids.indexOf(hit) + 1] || null, edge: 'after', ref: hit, row }
  }
  if (canHold(hit)) return { toParent: hit, toNext: null, edge: 'inside', ref: hit, row }
  if (holdOnly) return null

  const kids = orderedChildren(parent)
  return pos < size / 2
    ? { toParent: parent, toNext: hit, edge: 'before', ref: hit, row }
    : { toParent: parent, toNext: kids[kids.indexOf(hit) + 1] || null, edge: 'after', ref: hit, row }
}

const showIndicator = drop => {
  const bar = indicator()
  markDropTarget(drop.toParent)

  // 放进容器里：整个容器描边就是指示，再画一条线反而看不出放哪儿
  if (drop.edge === 'inside') { bar.style.display = 'none'; return }

  const r = drop.ref.getBoundingClientRect()
  const after = drop.edge === 'after'

  Object.assign(bar.style, drop.row ? {
    display: 'block',
    top:    `${r.top + scrollY}px`,
    left:   `${(after ? r.right : r.left) + scrollX - 1}px`,
    width:  '3px',
    height: `${r.height}px`,
  } : {
    display: 'block',
    top:    `${(after ? r.bottom : r.top) + scrollY - 1}px`,
    left:   `${r.left + scrollX}px`,
    width:  `${r.width}px`,
    height: '3px',
  })
}

const hideIndicator = () => {
  const bar = document.getElementById(INDICATOR_ID)
  if (bar) bar.style.display = 'none'
}

const GHOST_ID = 'visual-revise-drag-ghost'
const GHOST_MAX_AREA = 1600 * 1200   // 超大元素克隆开销过高，退化为轮廓

// 拖影跟随指针，手上才有"拿着东西"的感觉。
// 用克隆而非原元素：原元素要留在原位供插入位置计算，
// 且移动它会触发容器重排，指示线会跟着乱跳。
const createGhost = (el, clientX, clientY) => {
  const rect = el.getBoundingClientRect()
  const oversized = rect.width * rect.height > GHOST_MAX_AREA

  const ghost = oversized ? document.createElement('div') : el.cloneNode(true)

  ghost.id = GHOST_ID
  ghost.setAttribute('data-visual-revise-ui', '')
  ghost.removeAttribute?.('data-vr-drop-target')
  ghost.querySelectorAll?.('[data-vr-drop-target]')
    .forEach(n => n.removeAttribute('data-vr-drop-target'))

  ghost.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.top}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    margin: 0;
    z-index: 2147483646;
    pointer-events: none;
    opacity: .9;
    transform: scale(.97) rotate(-1.2deg);
    transform-origin: center;
    box-shadow: 0 16px 40px rgb(0 0 0 / .38);
    border-radius: ${getComputedStyle(el).borderRadius};
    transition: none;
    ${oversized ? 'background: rgb(13 153 255 / .16); border: 2px solid #0d99ff;' : ''}
  `

  document.body.appendChild(ghost)

  return { ghost, offX: clientX - rect.left, offY: clientY - rect.top }
}

const moveGhost = (ghost, offX, offY, clientX, clientY) => {
  if (!ghost) return
  ghost.style.left = `${clientX - offX}px`
  ghost.style.top  = `${clientY - offY}px`
}

const removeGhost = () => document.getElementById(GHOST_ID)?.remove()

export const createLayoutDrag = ({ onDone, onDragStart, activeTool } = {}) => {
  let active = false
  let armed = null    // 已按下、还没越过 slop
  let drag = null     // 真的在拖了

  // 去掉 pointerdown 的 preventDefault 之后，浏览器会开始原生的文本拖选。
  // 越过 slop 才拦：在此之前用户可能只是想选中一段文字。
  const onSelectStart = e => { if (drag) e.preventDefault() }


  // 松手后浏览器通常还会补一次 click，而 VisBug 的选中就挂在 click 上
  // （selectable.js 在 body 的捕获阶段）。它会拿松手处的坐标重新命中——
  // 跨容器之后那多半是别的元素，用户眼看着自己刚搬完的东西被取消选中。
  // 挂在 document 上才抢得到：同一阶段按注册顺序触发，document 早于 body。
  const swallowClick = e => {
    e.preventDefault()
    e.stopPropagation()
    disarmClickSwallow()
  }

  // 「通常」不等于「一定」：click 的目标是按下与松开两个节点的共同祖先，
  // 而我们恰恰在松开的那一刻把按下的那个节点搬走了——Chrome 于是干脆不派发。
  // 只靠 click 自己摘钩子的话，这个钩子会一直挂着，把用户**下一次**点击吃掉，
  // 表现成「搬完一次之后页面就点不动了」。所以下一次按下也要摘。
  const disarmClickSwallow = () => {
    document.removeEventListener('click', swallowClick, true)
    document.removeEventListener('pointerdown', disarmClickSwallow, true)
  }

  const armClickSwallow = () => {
    document.addEventListener('click', swallowClick, true)
    document.addEventListener('pointerdown', disarmClickSwallow, true)
  }

  const disarm = () => {
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('selectstart', onSelectStart, true)
    armed = null
  }

  const onPointerDown = e => {
    if (!active || e.button !== 0) return
    if (MOUSE_TOOLS.has(activeTool?.())) return
    if (isEditorUI(e)) return

    // 不能用 path[0]：选中框等覆盖层会挡在页面元素前面
    const el = pageElementAt(e.clientX, e.clientY)
    if (!el || el === document.body || !canDrag(el)) return

    // 这里不抢事件：抢了页面就点不动了。等越过 slop 再说。
    armed = { el, startX: e.clientX, startY: e.clientY }
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('selectstart', onSelectStart, true)
  }

  const beginDrag = e => {
    const { el } = armed
    // 选中框（visbug-handles）上的缩放把手浮在元素四角并拦指针，
    // 留着选中会让接下来的拖动手感很怪；这一步交给宿主去清。
    onDragStart?.(el)

    const { ghost, offX, offY } = createGhost(el, e.clientX, e.clientY)
    drag = { el, ghost, offX, offY, drop: null }
    el.style.opacity = '0.25'
    ensureHintStyle()
    armClickSwallow()
  }

  const onPointerMove = e => {
    if (!armed) return

    if (!drag) {
      if (Math.abs(e.clientX - armed.startX) < DRAG_SLOP
        && Math.abs(e.clientY - armed.startY) < DRAG_SLOP) return
      beginDrag(e)
    }

    e.preventDefault()
    moveGhost(drag.ghost, drag.offX, drag.offY, e.clientX, e.clientY)

    const drop = dropTargetAt(e.clientX, e.clientY, drag.el)
    drag.drop = drop

    if (drop) showIndicator(drop)
    else { hideIndicator(); clearDropTarget() }
  }

  // 拖拽的收尾必须与「是否提交移动」分开：中途取消（Esc、模式关闭、
  // destroy）同样要解绑那几个捕获阶段的监听，否则每次中断都留下一组，
  // 此后每个 pointermove 都会白跑一遍，且 destroy 也清不掉。
  const endDrag = ({ commit } = { commit: false }) => {
    disarm()
    hideIndicator()
    clearDropTarget()
    removeGhost()

    if (!drag) return

    drag.el.style.removeProperty('opacity')
    const pending = drag
    drag = null

    if (!commit || !pending.drop) return

    const { toParent, toNext } = pending.drop
    if (ChangeStore.moveElement(pending.el, toParent, toNext))
      onDone?.({ el: pending.el, toParent, toNext })
  }

  const onPointerUp = () => {
    // 没越过 slop：什么都没发生过，VisBug 的 click 照常选中
    if (!drag) { disarm(); return }
    endDrag({ commit: true })
  }

  // 浏览器把这次手势升级成原生 HTML5 拖放时（<img> 和 [draggable] 上很容易
  // 命中）会先发一次 pointercancel，此后 pointermove / pointerup 一次都不再
  // 派发给页面。不收这一条，endDrag 就永远跑不到：dragging 卡在 true、拖影
  // 一直浮在页面上、源元素停在 opacity:.25，而用户下一次普通点击会被
  // onPointerUp 当成这次拖拽的落点，把元素静默搬走。
  // 取消而非提交：手势是被中断的，不该落下一次移动。
  //
  // 这里只退出、不去 preventDefault 那次 dragstart：上游的 imageswap（把一张图
  // 拖到另一张图上换 src）用的正是原生拖放。原生拖放接管时我们干净地让位，
  // 两套手势各归各的，比抢过来更对。
  const onPointerCancel = () => endDrag({ commit: false })

  return {
    get active() { return active },
    // 是否正拖着。Esc 要据此判断该不该抢下这一键——没在拖的时候
    // Esc 有别的活儿（退模式、取消选中）。
    get dragging() { return !!drag },
    // 中途取消：收尾但不提交，页面回到拖之前的样子
    cancelDrag() { endDrag({ commit: false }) },
    setActive(on) {
      active = on
      if (on) {
        ensureHintStyle()
        document.addEventListener('pointerdown', onPointerDown, true)
      } else {
        document.removeEventListener('pointerdown', onPointerDown, true)
        endDrag()   // 取消而非提交：模式被关掉时不应落下一次移动
        document.getElementById(HINT_STYLE_ID)?.remove()
      }
    },
    destroy() {
      this.setActive(false)
      disarmClickSwallow()
      removeGhost()
      document.getElementById(INDICATOR_ID)?.remove()
    },
  }
}
