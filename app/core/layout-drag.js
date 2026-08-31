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

// 重排落到 order 上：纯 CSS、可被快照 diff 捕获、不改动 DOM 结构
const applyOrder = (others, dragged, targetIndex) => {
  const ordered = [...others.slice(0, targetIndex), dragged, ...others.slice(targetIndex)]

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

    const others = siblings.filter(node => node !== el)
    drag = { el, parent, others, row: isRow(parent), index: others.indexOf(el) }
    el.style.opacity = '0.4'
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
  }

  const onPointerMove = e => {
    if (!drag) return
    drag.index = dropIndexAt(drag.others, e.clientX, e.clientY, drag.row)
    showIndicator(drag.others, drag.index, drag.row)
  }

  const onPointerUp = () => {
    if (!drag) return

    drag.el.style.opacity = ''
    hideIndicator()
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)

    const ordered = applyOrder(drag.others, drag.el, drag.index)
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
