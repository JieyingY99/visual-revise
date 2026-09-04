import { isOffBounds } from '../utilities/common.js'
import { pageElementAt, isEditorUI } from './dom-utils.js'
// 与树里的拖拽共用一份：两个入口写出的记录必须一致
import { applyOrder } from './reorder.js'

const INDICATOR_ID = 'visual-revise-drop-indicator'
const HINT_STYLE_ID = 'visual-revise-drag-hints'

// 用属性 + 全局样式表标记可拖区域，而不是写 inline style——
// 后者会被快照 diff 当成用户改动记进提示词。
const HINT_CSS = `
  [data-vr-droppable] {
    outline: 1px dashed rgba(13, 153, 255, .5) !important;
    outline-offset: 3px !important;
  }
  [data-vr-draggable] { cursor: grab !important; }
  [data-vr-draggable]:hover {
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

// 扫描整页开销不小，设上限并跳过不可见元素；
// 真实页面里可重排的容器通常只有个位数
const SCAN_LIMIT = 4000

const markDroppables = () => {
  ensureHintStyle()

  let scanned = 0
  for (const el of document.querySelectorAll('body *')) {
    if (++scanned > SCAN_LIMIT) break
    if (el.children.length < 2 || isOffBounds(el)) continue

    const cs = getComputedStyle(el)
    if (!/flex|grid/.test(cs.display)) continue
    if (cs.visibility === 'hidden' || cs.display === 'none') continue

    el.setAttribute('data-vr-droppable', '')
    Array.from(el.children).forEach(child => {
      if (!isOffBounds(child)) child.setAttribute('data-vr-draggable', '')
    })
  }
}

const clearDroppables = () => {
  document.querySelectorAll('[data-vr-droppable]').forEach(el => el.removeAttribute('data-vr-droppable'))
  document.querySelectorAll('[data-vr-draggable]').forEach(el => el.removeAttribute('data-vr-draggable'))
  document.getElementById(HINT_STYLE_ID)?.remove()
}

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

const isRow = container => {
  const cs = getComputedStyle(container)
  return !/column/.test(cs.flexDirection || 'row')
}

const siblingsOf = el =>
  Array.from(el.parentElement?.children || []).filter(node => !isOffBounds(node))

// 索引一律相对「移除被拖元素后的序列」计算。
// 若在含被拖元素的数组上取索引、却 splice 到移除后的数组，
// 向后拖会整体偏移一位，落点也对不上用户看到的指示线。
const dropIndexAt = (others, x, y, row) => {
  for (let i = 0; i < others.length; i++) {
    const r = others[i].getBoundingClientRect()
    const mid = row ? r.left + r.width / 2 : r.top + r.height / 2

    if ((row ? x : y) < mid) return i
  }

  return others.length
}

const showIndicator = (others, index, row) => {
  const bar = indicator()
  if (!others.length) return

  const after = index >= others.length
  const ref = after ? others[others.length - 1] : others[index]
  const r = ref.getBoundingClientRect()

  Object.assign(bar.style, row ? {
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
  ghost.removeAttribute?.('data-vr-draggable')
  ghost.querySelectorAll?.('[data-vr-draggable]')
    .forEach(n => n.removeAttribute('data-vr-draggable'))

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

export const createLayoutDrag = ({ onDone } = {}) => {
  let active = false
  let drag = null

  const onPointerDown = e => {
    if (!active || e.button !== 0) return

    if (isEditorUI(e)) return

    // 不能用 path[0]：选中框等覆盖层会挡在页面元素前面
    const el = pageElementAt(e.clientX, e.clientY)
    if (!el || el === document.body || el === document.documentElement) return

    const parent = el.parentElement
    if (!parent) return
    if (!/flex|grid/.test(getComputedStyle(parent).display)) return

    const siblings = siblingsOf(el)
    if (siblings.length < 2) return

    e.preventDefault()
    e.stopPropagation()

    const others = siblings.filter(node => node !== el)
    const { ghost, offX, offY } = createGhost(el, e.clientX, e.clientY)

    drag = { el, parent, others, row: isRow(parent), index: others.indexOf(el), ghost, offX, offY }
    el.style.opacity = '0.25'
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
  }

  const onPointerMove = e => {
    if (!drag) return

    moveGhost(drag.ghost, drag.offX, drag.offY, e.clientX, e.clientY)
    drag.index = dropIndexAt(drag.others, e.clientX, e.clientY, drag.row)
    showIndicator(drag.others, drag.index, drag.row)
  }

  // 拖拽的收尾必须与「是否提交重排」分开：中途取消（Esc、模式关闭、
  // destroy）同样要解绑这两个捕获阶段的监听，否则每次中断都留下一对，
  // 此后每个 pointermove 都会白跑一遍，且 destroy 也清不掉。
  const endDrag = ({ commit } = { commit: false }) => {
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    hideIndicator()
    removeGhost()

    if (!drag) return

    drag.el.style.opacity = ''
    const pending = drag
    drag = null

    if (!commit) return

    const ordered = applyOrder(pending.others, pending.el, pending.index)
    onDone?.({ container: pending.parent, ordered })
  }

  const onPointerUp = () => endDrag({ commit: true })

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
        markDroppables()
        document.addEventListener('pointerdown', onPointerDown, true)
      } else {
        document.removeEventListener('pointerdown', onPointerDown, true)
        endDrag()   // 取消而非提交：模式被关掉时不应落下一次重排
        clearDroppables()
      }
    },

    // 页面结构变化后重新标记（例如重排完成、或 SPA 切换了视图）
    refresh() {
      if (active) markDroppables()
    },
    destroy() {
      this.setActive(false)
      clearDroppables()
      removeGhost()
      document.getElementById(INDICATOR_ID)?.remove()
    },
  }
}
