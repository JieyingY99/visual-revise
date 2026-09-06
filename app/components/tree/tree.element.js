/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { ChangeStore } from '../../core/change-store.js'
import { elementId } from '../../core/snapshot.js'
import { childrenOf, describeNode, pathTo } from '../../core/tree-model.js'
import { canDrag, orderedChildren } from '../../core/reorder.js'
import { highlight, clearHighlight } from '../../core/highlight.js'
import { containScroll } from '../../core/dom-utils.js'
import { default as tree_css } from './tree.element.css'

const esc = v => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// 真实页面里一个容器塞几千个子节点是常事（长列表、表格）。全铺出来既卡又
// 没法看，超出的折叠成一行提示。
const MAX_SIBLINGS = 200

// 按下多少像素才算拖拽。不设阈值的话，想点一行选中它，手指微抖就变成了排序
const DRAG_SLOP = 4

export class ReviseTree extends HTMLElement {
  #shadow
  #expanded = new Set()
  #target = null
  #rows = []              // 当前渲染出来的行：{ id, el, depth }
  #drag = null
  #unsubscribe = null
  #untrap = null
  #frame = null

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.setAttribute('data-visual-revise-ui', '')
    this.addEventListener('keydown', e => e.stopPropagation())

    this.#shadow.innerHTML = `
      <style>${tree_css}</style>
      <div class="tree-head">
        <span class="title">结构</span>
        <span class="hint">拖动行可移动</span>
        <button class="tree-close" title="关闭">×</button>
      </div>
      <div class="list"><div class="drop-line" hidden></div></div>`

    this.#bind()
    // 移动改的是 DOM 结构，改完树得跟着重画
    this.#unsubscribe = ChangeStore.subscribe(() => this.schedule())
    this.#untrap = containScroll(this, () => this.#shadow.querySelector('.list'))
    this.render()
  }

  disconnectedCallback() {
    this.#unsubscribe?.()
    this.#untrap?.()
    if (this.#frame) cancelAnimationFrame(this.#frame)
    clearHighlight()
  }

  schedule() {
    if (this.#frame) return
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null
      this.render()
    })
  }

  // 只展开到选中项那条路径，其余保持折叠：一上来就铺开整棵树，
  // 用户要找的那一行反而淹了
  setTarget(el) {
    this.#target = el?.isConnected ? el : null
    if (this.#target) pathTo(this.#target).forEach(node => this.#expanded.add(elementId(node)))
    this.render()
    this.#revealTarget()
  }

  get target() { return this.#target }

  // 树在 display:none 下算不出滚动（clientHeight 为 0，滚了等于没滚）。
  // 面板刚显示出来、或刚从属性 tab 切过来时，得由外面补叫一次。
  reveal() { this.#revealTarget() }

  #revealTarget() {
    if (!this.#target) return
    const row = this.#shadow.querySelector(`.row[data-id="${CSS.escape(elementId(this.#target))}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }

  #collect() {
    const rows = []

    const walk = (parent, depth) => {
      const kids = childrenOf(parent)

      for (const el of kids.slice(0, MAX_SIBLINGS)) {
        const id = elementId(el)
        rows.push({ id, el, depth, hasChildren: childrenOf(el).length > 0 })
        if (this.#expanded.has(id)) walk(el, depth + 1)
      }

      if (kids.length > MAX_SIBLINGS)
        rows.push({ overflow: kids.length - MAX_SIBLINGS, depth })
    }

    walk(document.body, 0)
    return rows
  }

  render() {
    const list = this.#shadow.querySelector('.list')
    if (!list) return

    const scrollTop = list.scrollTop
    this.#rows = this.#collect()

    const html = this.#rows.map(row => {
      if (row.overflow)
        return `<div class="more" style="--depth:${row.depth}">还有 ${row.overflow} 个未列出</div>`

      const { name, preview, tag } = describeNode(row.el)
      const selected = row.el === this.#target ? ' data-selected' : ''
      const open = this.#expanded.has(row.id) ? ' data-open' : ''

      return `<div class="row" data-id="${esc(row.id)}" style="--depth:${row.depth}"${selected}>
        <button class="twist"${row.hasChildren ? open : ' data-leaf'}></button>
        <span class="name">${esc(name)}</span>
        ${preview ? `<span class="preview">${esc(preview)}</span>` : ''}
        <span class="node-tag">${esc(tag)}</span>
      </div>`
    }).join('')

    list.innerHTML = `${html}<div class="drop-line" hidden></div>`
    list.scrollTop = scrollTop
  }

  #rowOf(target) {
    const id = target?.closest?.('.row')?.dataset.id
    return this.#rows.find(r => r.id === id) || null
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }))
  }

  #bind() {
    const shadow = this.#shadow
    const list = shadow.querySelector('.list')

    shadow.querySelector('.tree-close').addEventListener('click', () =>
      this.#emit('vr-tree-close'))

    // 折叠箭头单独处理：它和「选中这一行」是两件事，不能互相触发
    list.addEventListener('click', e => {
      const twist = e.target.closest?.('.twist')
      if (twist) {
        e.stopPropagation()
        const row = this.#rowOf(e.target)
        if (!row?.hasChildren) return
        this.#expanded.has(row.id) ? this.#expanded.delete(row.id) : this.#expanded.add(row.id)
        this.render()
        return
      }

      const row = this.#rowOf(e.target)
      if (row?.el) this.#emit('vr-tree-select', { el: row.el })
    })

    list.addEventListener('pointerover', e => {
      const row = this.#rowOf(e.target)
      if (row?.el) highlight(row.el)
    })
    list.addEventListener('pointerleave', () => clearHighlight())

    list.addEventListener('pointerdown', e => this.#startDrag(e))
  }

  // ── 拖动移动 ──
  // 落点可以是任意一行：插到它前面、插到它后面、或者放进它里面。
  // 移动改的是 DOM 结构本身，不再受「同一个 flex 父级」的限制。
  #startDrag(e) {
    if (e.button !== 0 || e.target.closest?.('.twist')) return

    const row = this.#rowOf(e.target)
    if (!row?.el || !canDrag(row.el)) return

    const list = this.#shadow.querySelector('.list')

    // 指针捕获推迟到真的越过 slop 之后（见 #onDragMove）。在 pointerdown 就
    // 捕获的话，后续 click 的 target 会被重定向到 .list，#rowOf 拿不到那一行，
    // 「点一下选中」这条路整个失效——而且只在可拖的行上失效（不可拖的行
    // 压根走不到这里），看起来就像树时灵时不灵。
    this.#drag = {
      row,
      startY: e.clientY,
      pointerId: e.pointerId,
      moved: false,
      drop: null,
    }

    const move = ev => this.#onDragMove(ev)
    const up = ev => {
      // 没捕获过就别放：releasePointerCapture 对未捕获的 id 会抛 NotFoundError
      if (list.hasPointerCapture?.(ev.pointerId)) list.releasePointerCapture(ev.pointerId)
      list.removeEventListener('pointermove', move)
      list.removeEventListener('pointerup', up)
      this.#endDrag()
    }
    list.addEventListener('pointermove', move)
    list.addEventListener('pointerup', up)
  }

  #onDragMove(e) {
    const drag = this.#drag
    if (!drag) return

    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_SLOP) return
      drag.moved = true
      const list = this.#shadow.querySelector('.list')
      // 到这里才捕获：从此刻起指针移出树也能继续收到 move，
      // 而在此之前的单纯点击不会被捕获改写 target
      list.setPointerCapture(drag.pointerId)
      list.setAttribute('data-dragging', '')
    }

    this.#updateDrop(drag, e.clientY)
  }

  // 一行分三段：上 1/3 插到它前面，下 1/3 插到它后面，中间 1/3 放进它里面。
  // 中段只对容器成立——把一段文字塞进另一段文字里没有意义。
  #dropAt(drag, clientY) {
    for (const row of this.#rows) {
      if (!row.el) continue
      // 不能拖进自己或自己的后代：DOM 会抛错，语义上也是个死结
      if (row.el === drag.row.el || drag.row.el.contains(row.el)) continue

      const node = this.#shadow.querySelector(`.row[data-id="${CSS.escape(row.id)}"]`)
      if (!node) continue

      const r = node.getBoundingClientRect()
      if (clientY < r.top || clientY >= r.bottom) continue

      const third = r.height / 3
      const inside = clientY >= r.top + third && clientY < r.bottom - third
        && (row.hasChildren || /^(block|flex|grid|inline-flex|inline-grid)$/.test(getComputedStyle(row.el).display))

      if (inside) return { row, where: 'inside' }
      return clientY < r.top + r.height / 2
        ? { row, where: 'before', y: r.top }
        : { row, where: 'after',  y: r.bottom }
    }
    return null
  }

  // 落点从「视觉上的那一行」翻译成 DOM 上的 { toParent, toNext }。
  // 行序是 orderedChildren 给的（按 CSS order 排过），所以后邻也必须从
  // 同一个序列里取——直接用 nextElementSibling 会在带 order 的容器里落错位置。
  #resolveDrop(drop) {
    const el = drop.row.el

    if (drop.where === 'inside')
      return { toParent: el, toNext: null }

    const toParent = el.parentElement
    if (!toParent || toParent === document.documentElement) return null

    if (drop.where === 'before') return { toParent, toNext: el }

    const kids = orderedChildren(toParent)
    return { toParent, toNext: kids[kids.indexOf(el) + 1] || null }
  }

  #updateDrop(drag, clientY) {
    const list = this.#shadow.querySelector('.list')
    const line = this.#shadow.querySelector('.drop-line')

    list.querySelectorAll('.row[data-drop-inside]')
      .forEach(n => n.removeAttribute('data-drop-inside'))

    const drop = this.#dropAt(drag, clientY)
    drag.drop = drop && this.#resolveDrop(drop) ? drop : null

    if (!drag.drop) { line.hidden = true; return }

    if (drop.where === 'inside') {
      line.hidden = true
      this.#shadow.querySelector(`.row[data-id="${CSS.escape(drop.row.id)}"]`)
        ?.setAttribute('data-drop-inside', '')
      return
    }

    const listRect = list.getBoundingClientRect()
    line.hidden = false
    line.style.top = `${drop.y - listRect.top + list.scrollTop}px`
  }

  #endDrag() {
    const drag = this.#drag
    this.#drag = null

    const list = this.#shadow.querySelector('.list')
    list.removeAttribute('data-dragging')
    this.#shadow.querySelector('.drop-line').hidden = true
    list.querySelectorAll('.row[data-drop-inside]')
      .forEach(n => n.removeAttribute('data-drop-inside'))

    if (!drag?.moved || !drag.drop) return

    const target = this.#resolveDrop(drag.drop)
    if (!target) return

    // 放进一个折叠着的容器：先展开它，否则用户看不到自己刚放进去的东西
    if (drag.drop.where === 'inside') this.#expanded.add(drag.drop.row.id)

    // 只上报意图，不自己落笔：这一次移动要不要同步到同构容器，
    // 是面板才知道的事（共享开关和同构兄弟都在它那儿）。
    this.#emit('vr-tree-move', { el: drag.row.el, ...target })
    this.render()
  }
}

customElements.define('visual-revise-tree', ReviseTree)
