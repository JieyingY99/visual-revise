import { ChangeStore } from './change-store.js'
import { isOffBounds } from '../utilities/common.js'
import { pageElementAt, isEditorUI } from './dom-utils.js'

const INDICATOR_ID = 'visual-revise-drop-indicator'

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

// 按拖拽指针位置算出应插入到第几个位置
const dropIndexAt = (siblings, dragged, x, y, row) => {
  let index = siblings.length

  for (let i = 0; i < siblings.length; i++) {
    const node = siblings[i]
    if (node === dragged) continue

    const r = node.getBoundingClientRect()
    const mid = row ? r.left + r.width / 2 : r.top + r.height / 2
    const pos = row ? x : y

    if (pos < mid) { index = i; break }
  }

  return index
}

const showIndicator = (siblings, index, row) => {
  const bar = indicator()
  const ref = siblings[index] || siblings[siblings.length - 1]
  if (!ref) return

  const r = ref.getBoundingClientRect()
  const after = !siblings[index]

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

// 重排落到 order 上：纯 CSS、可被快照 diff 捕获、不改动 DOM 结构
const applyOrder = (siblings, dragged, targetIndex) => {
  const rest = siblings.filter(node => node !== dragged)
  const ordered = [...rest.slice(0, targetIndex), dragged, ...rest.slice(targetIndex)]

  ordered.forEach((node, i) => {
    ChangeStore.track(node)
    ChangeStore.applyProp(node, 'order', String(i))
  })

  return ordered
}

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

    drag = { el, parent, siblings, row: isRow(parent), index: siblings.indexOf(el) }
    el.style.opacity = '0.4'
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
  }

  const onPointerMove = e => {
    if (!drag) return
    drag.index = dropIndexAt(drag.siblings, drag.el, e.clientX, e.clientY, drag.row)
    showIndicator(drag.siblings, drag.index, drag.row)
  }

  const onPointerUp = () => {
    if (!drag) return

    drag.el.style.opacity = ''
    hideIndicator()
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)

    const ordered = applyOrder(drag.siblings, drag.el, drag.index)
    onDone?.({ container: drag.parent, ordered })
    drag = null
  }

  return {
    get active() { return active },
    setActive(on) {
      active = on
      if (on) {
        document.addEventListener('pointerdown', onPointerDown, true)
      } else {
        document.removeEventListener('pointerdown', onPointerDown, true)
        hideIndicator()
        if (drag) { drag.el.style.opacity = ''; drag = null }
      }
    },
    destroy() {
      this.setActive(false)
      document.getElementById(INDICATOR_ID)?.remove()
    },
  }
}
