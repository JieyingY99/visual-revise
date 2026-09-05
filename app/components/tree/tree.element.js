/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { ChangeStore } from '../../core/change-store.js'
import { elementId } from '../../core/snapshot.js'
import { childrenOf, describeNode, pathTo } from '../../core/tree-model.js'
import { canReorder } from '../../core/reorder.js'
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
        <span class="hint">拖动行可排序</span>
        <button class="tree-close" title="关闭">×</button>
      </div>
      <div class="list"><div class="drop-line" hidden></div></div>`

    this.#bind()
    // 排序落在 order 上，改完顺序会变，树得跟着重画
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

  // ── 拖动排序 ──
  // 只在同一个父节点内换位。重排写的是 CSS order，跨父节点搬家得真的动
  // DOM 结构，那是另一回事，改动模型也记录不了。
  #startDrag(e) {
    if (e.button !== 0 || e.target.closest?.('.twist')) return

    const row = this.#rowOf(e.target)
    if (!row?.el || !canReorder(row.el)) return

    const list = this.#shadow.querySelector('.list')

    // 指针捕获推迟到真的越过 slop 之后（见 #onDragMove）。在 pointerdown 就
    // 捕获的话，后续 click 的 target 会被重定向到 .list，#rowOf 拿不到那一行，
    // 「点一下选中」这条路整个失效——而且只在可重排的行上失效（不可重排的行
    // 压根走不到这里），看起来就像树时灵时不灵。
    this.#drag = {
      row,
      parent: row.el.parentElement,
      startY: e.clientY,
      pointerId: e.pointerId,
      moved: false,
      index: null,
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

    // 只有同一父节点下的兄弟才是合法落点
    const targets = this.#rows.filter(r =>
      r.el && r.el !== drag.row.el && r.el.parentElement === drag.parent)

    const line = this.#shadow.querySelector('.drop-line')
    if (!targets.length) { line.hidden = true; drag.index = null; return }

    const listRect = this.#shadow.querySelector('.list').getBoundingClientRect()
    let index = targets.length
    let y = null

    for (let i = 0; i < targets.length; i++) {
      const el = this.#shadow.querySelector(`.row[data-id="${CSS.escape(targets[i].id)}"]`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) { index = i; y = r.top; break }
      y = r.bottom
    }

    drag.index = index
    drag.targets = targets.map(t => t.el)

    line.hidden = false
    line.style.top = `${(y ?? listRect.top) - listRect.top + this.#shadow.querySelector('.list').scrollTop}px`
  }

  #endDrag() {
    const drag = this.#drag
    this.#drag = null

    const list = this.#shadow.querySelector('.list')
    list.removeAttribute('data-dragging')
    this.#shadow.querySelector('.drop-line').hidden = true

    if (!drag?.moved || drag.index == null) return

    // 只上报意图，不自己落笔：这一次重排要不要同步到共享元素，
    // 是面板才知道的事（共享开关和同构兄弟都在它那儿）。
    // 树自己调 applyOrder 的话，联动开着也只会改眼前这一个容器。
    this.#emit('vr-tree-reorder', {
      container: drag.parent,
      others: drag.targets,
      dragged: drag.row.el,
      index: drag.index,
    })
    this.render()
  }
}

customElements.define('visual-revise-tree', ReviseTree)
