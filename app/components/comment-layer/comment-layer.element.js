import { ChangeStore } from '../../core/change-store.js'
import { default as layer_css } from './comment-layer.element.css'

export class CommentLayer extends HTMLElement {
  #shadow
  #active = false
  #draft = null          // { el, x, y, editingId }
  #unsubscribe = null
  #reposition = null
  #frame = null

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.setAttribute('data-visual-revise-ui', '')
    this.addEventListener('keydown', e => e.stopPropagation())
    this.#shadow.innerHTML = `<style>${layer_css}</style><div id="root"></div>`
    this.#unsubscribe = ChangeStore.subscribe(() => this.schedule())

    // scroll 与 resize 会以远高于帧率的频率触发，而每次 render 都要为
    // 每个 pin 取一次 getBoundingClientRect（强制重排）并重建 innerHTML。
    // 合并到同一帧只渲染一次。
    this.#reposition = () => this.schedule()
    addEventListener('scroll', this.#reposition, { passive: true })
    addEventListener('resize', this.#reposition, { passive: true })

    this.render()
  }

  disconnectedCallback() {
    this.#unsubscribe?.()
    if (this.#frame) cancelAnimationFrame(this.#frame)
    removeEventListener('scroll', this.#reposition)
    removeEventListener('resize', this.#reposition)
  }

  schedule() {
    if (this.#frame) return
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null
      this.render()
    })
  }

  get active() { return this.#active }

  // 草稿的生命周期独立于模式开关：点击元素后模式关闭，
  // 但那条刚起草的评论必须留在屏幕上等用户写完。
  setActive(on) {
    this.#active = on
    this.render()
    this.dispatchEvent(new CustomEvent('vr-comment-mode', {
      bubbles: true, composed: true, detail: { on },
    }))
  }

  cancelDraft() {
    if (!this.#draft) return false
    this.#draft = null
    this.render()
    return true
  }

  get hasDraft() { return !!this.#draft }

  startDraft(el, clientX, clientY) {
    this.#draft = { el, x: clientX + scrollX, y: clientY + scrollY, editingId: null }
    this.render()
    this.#focusDraft()
  }

  editComment(id) {
    const c = ChangeStore.read().comments.find(c => c.id === id)
    if (!c) return
    const r = c.el.getBoundingClientRect()
    this.#draft = { el: c.el, x: r.right + scrollX, y: r.top + scrollY, editingId: id, text: c.text }
    this.render()
    this.#focusDraft()
  }

  #focusDraft() {
    requestAnimationFrame(() => {
      const ta = this.#shadow.querySelector('textarea')
      ta?.focus()
      if (ta && this.#draft?.text) ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }

  render() {
    const root = this.#shadow.querySelector('#root')
    if (!root) return

    const { comments } = ChangeStore.read()

    const pins = comments.map(c => {
      const r = c.el.getBoundingClientRect()
      if (!r.width && !r.height) return ''
      // 往元素外侧挪开，避免和选中框右上角的手柄重叠
      const x = r.right + scrollX + 10
      const y = r.top + scrollY - 2
      const active = this.#draft?.editingId === c.id ? ' data-active' : ''
      return `<div class="pin" data-id="${c.id}" style="left:${x}px;top:${y}px"
                title="${c.text.replace(/"/g, '&quot;')}"${active}>${c.seq}</div>`
    }).join('')

    const bubble = this.#draft ? this.#renderBubble() : ''
    const banner = this.#active && !this.#draft
      ? '<div class="banner">评论模式：点击任意元素添加说明 · 按住 Shift 连续添加 · Esc 退出</div>'
      : ''

    root.innerHTML = pins + bubble + banner
    this.#bind()
  }

  #renderBubble() {
    const { el, x, y, editingId, text = '' } = this.#draft
    const tag = el.tagName.toLowerCase()
    const cls = Array.from(el.classList).slice(0, 2).join('.')
    return `<div class="bubble" style="left:${x + 12}px;top:${y}px">
      <span class="sel">${tag}${cls ? '.' + cls : ''}</span>
      <textarea placeholder="描述想要的效果，例如：鼠标移入时上浮并变亮">${text}</textarea>
      <div class="actions">
        <button class="save">${editingId ? '保存' : '添加'}</button>
        <button class="cancel">取消</button>
      </div>
      <div class="hint">⌘/Ctrl + Enter 快速保存</div>
    </div>`
  }

  #commitDraft() {
    const ta = this.#shadow.querySelector('textarea')
    const text = ta?.value.trim()
    if (!text) { this.#draft = null; this.render(); return }

    this.#draft.editingId
      ? ChangeStore.updateComment(this.#draft.editingId, text)
      : ChangeStore.addComment(this.#draft.el, text)

    this.#draft = null
    this.render()
  }

  #bind() {
    const shadow = this.#shadow
    const on = (sel, evt, fn) => shadow.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn))

    on('.pin', 'click', e => {
      e.stopPropagation()
      this.editComment(e.currentTarget.dataset.id)
    })

    on('.save', 'click', () => this.#commitDraft())
    on('.cancel', 'click', () => { this.#draft = null; this.render() })

    on('textarea', 'keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.#commitDraft() }
      if (e.key === 'Escape') { e.preventDefault(); this.#draft = null; this.render() }
    })
  }
}

customElements.define('visual-revise-comment-layer', CommentLayer)
