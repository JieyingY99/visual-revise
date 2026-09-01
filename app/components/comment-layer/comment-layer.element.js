import { ChangeStore } from '../../core/change-store.js'
import {
  imagesFromDataTransfer, pickImages, canRenderDataUrl, fmtBytes,
} from '../../core/image-assets.js'
import { default as layer_css } from './comment-layer.element.css'

const esc = v => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const extOf = img =>
  (img.mime || '').split('/')[1]?.replace('+xml', '').toUpperCase() || 'IMG'

// 视口边界留白，以及气泡 / pin 与锚点之间的呼吸位
const EDGE = 8
const GAP = 12
const PIN_GAP = 10
const PIN_R = 10   // pin 是 20×20 且 translate(-50%,-50%)，所以坐标就是圆心

// 用 clientWidth 而不是 innerWidth：后者含滚动条宽度，按它算会把东西
// 推到滚动条底下去，视觉上仍是「跑到边界外」
const vw = () => document.documentElement.clientWidth || innerWidth
const vh = () => document.documentElement.clientHeight || innerHeight

const onScreen = r =>
  r.bottom > 0 && r.top < vh() && r.right > 0 && r.left < vw()

// 可用空间比要摆的东西还小时（窄窗口）退回下界，而不是算出一个比下界
// 还小的上界，把元素推到视口左上角之外
const fit = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi))

export class CommentLayer extends HTMLElement {
  #shadow
  #active = false
  #draft = null          // { el, x, y, editingId, text, images }
  #unsubscribe = null
  #reposition = null
  #frame = null
  #thumbOk = true        // 页面 CSP 是否允许 data: 图片预览

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

    // 有些页面禁掉了 img-src data:，缩略图会静默变成裂图。
    // 探一次，拿不到预览就退化成「类型 + 体积」的文字条目。
    canRenderDataUrl().then(ok => {
      if (this.#thumbOk === ok) return
      this.#thumbOk = ok
      this.schedule()
    })

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
    this.#draft = {
      el, x: clientX + scrollX, y: clientY + scrollY,
      editingId: null, text: '', images: [],
    }
    this.render()
    this.#focusDraft()
  }

  editComment(id) {
    const c = ChangeStore.read().comments.find(c => c.id === id)
    if (!c) return
    const r = c.el.getBoundingClientRect()
    this.#draft = {
      el: c.el, x: r.right + scrollX, y: r.top + scrollY,
      editingId: id, text: c.text, images: (c.images || []).slice(),
    }
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

  // innerHTML 整块重建会把 textarea 连同它里面的内容一起换掉。scroll 与
  // resize 都会走到 render，不先把正在输入的内容接住，用户滚一下页面就白打了。
  // 图片说明走 input 事件实时写回数据，这里只需接住焦点。
  #captureInput() {
    const shadow = this.#shadow
    const ta = shadow.querySelector('textarea')
    if (!this.#draft) return () => {}

    if (ta) this.#draft.text = ta.value

    const active = shadow.activeElement
    const isTa = active === ta
    const noteId = active?.classList?.contains('ref-note') ? active.dataset.id : null
    const start = active?.selectionStart ?? null
    const end = active?.selectionEnd ?? null

    return () => {
      const next = isTa
        ? shadow.querySelector('textarea')
        : noteId ? shadow.querySelector(`.ref-note[data-id="${noteId}"]`) : null
      if (!next) return
      next.focus()
      if (start != null) { try { next.setSelectionRange(start, end) } catch { /* 类型不支持 */ } }
    }
  }

  render() {
    const root = this.#shadow.querySelector('#root')
    if (!root) return

    const restore = this.#captureInput()
    const { comments } = ChangeStore.read()

    const pins = comments.map(c => {
      const r = c.el.getBoundingClientRect()
      if (!r.width && !r.height) return ''

      // 默认挪到元素外侧，避开选中框右上角的手柄；右边塞不下就收进元素
      // 内侧的右上角。宁可贴着元素，也不要直接飞到视口边缘——那样就看不出
      // 它在标注谁了。
      const roomOutside = r.right + PIN_GAP + PIN_R <= vw() - EDGE
      let x = r.right + (roomOutside ? PIN_GAP : -PIN_GAP) + scrollX
      let y = r.top - 2 + scrollY

      // 元素整个滚出视口时不夹：pin 本就该跟着一起离场，夹住只会让一排
      // 无主的编号堆在边上，点开还得先猜它标的是谁
      if (onScreen(r)) {
        x = fit(x, scrollX + EDGE + PIN_R, scrollX + vw() - EDGE - PIN_R)
        y = fit(y, scrollY + EDGE + PIN_R, scrollY + vh() - EDGE - PIN_R)
      }

      const active = this.#draft?.editingId === c.id ? ' data-active' : ''
      const withImages = c.images?.length ? ' data-has-images' : ''
      return `<div class="pin" data-id="${c.id}" style="left:${x}px;top:${y}px"
                title="${esc(c.text)}"${active}${withImages}>${c.seq}</div>`
    }).join('')

    // 不再画常驻提示条：它会与顶部工具条重叠，而工具条本身
    // 已经高亮显示当前处于评论模式，操作提示改由工具条 toast 给出一次
    const bubble = this.#draft ? this.#renderBubble() : ''

    root.innerHTML = pins + bubble
    this.#bind()
    this.#placeBubble()
    restore()
  }

  // 气泡宽度是 CSS 定值，高度却随参考图数量变化（加一张就长一截），
  // 所以位置只能在渲染之后按实测尺寸算。同步做完、不等下一帧，
  // 用户看不到它先画错再跳回来。
  #placeBubble() {
    const bubble = this.#shadow.querySelector('.bubble')
    if (!bubble || !this.#draft) return

    const { x, y } = this.#draft
    const { width: w, height: h } = bubble.getBoundingClientRect()

    // 气泡是 absolute，而宿主贴在文档原点，所以这里一律用文档坐标
    const minX = scrollX + EDGE
    const maxX = scrollX + vw() - EDGE - w
    const minY = scrollY + EDGE
    const maxY = scrollY + vh() - EDGE - h

    // 右边放不下就翻到锚点左侧。翻边比硬贴右缘好：贴住边缘往往正好盖住
    // 被标注的元素本身，而那正是用户此刻要看的东西。
    const left = x + GAP > maxX ? x - GAP - w : x + GAP

    // 纵向只夹不翻——上下翻会让气泡离开锚点所在的那一行，认不出在标注谁
    bubble.style.left = `${fit(left, minX, maxX)}px`
    bubble.style.top = `${fit(y, minY, maxY)}px`
  }

  #renderRefs() {
    const images = this.#draft.images || []
    if (!images.length) return ''

    return `<div class="refs">${images.map(img => {
      const thumb = this.#thumbOk
        ? `<span class="ref-thumb"><img src="${esc(img.dataUrl)}" alt=""></span>`
        : `<span class="ref-thumb ref-noimg" title="本页禁止内嵌图片预览">${extOf(img)}</span>`

      const size = img.w ? `${img.w}×${img.h}` : fmtBytes(img.bytes || 0)

      return `<div class="ref" data-id="${img.id}">
        ${thumb}
        <span class="ref-body">
          <span class="ref-name" title="${esc(img.name)}">${esc(img.name)}</span>
          <input class="ref-note" data-id="${img.id}" value="${esc(img.note || '')}"
            placeholder="这张图说明什么（可留空）">
        </span>
        <span class="ref-size">${size}</span>
        <button class="ref-del" data-id="${img.id}" title="移除这张图">×</button>
      </div>`
    }).join('')}</div>`
  }

  #renderBubble() {
    const { el, x, y, editingId, text = '' } = this.#draft
    const tag = el.tagName.toLowerCase()
    const cls = Array.from(el.classList).slice(0, 2).join('.')

    return `<div class="bubble" style="left:${x + 12}px;top:${y}px">
      <span class="sel">${tag}${cls ? '.' + cls : ''}</span>
      <textarea placeholder="描述想要的效果，例如：鼠标移入时上浮并变亮">${esc(text)}</textarea>
      ${this.#renderRefs()}
      <div class="ref-add">
        <button class="add-image" type="button">+ 参考图</button>
        <span class="ref-hint">可直接粘贴截图，或把图拖进来</span>
      </div>
      <div class="actions">
        <button class="save">${editingId ? '保存' : '添加'}</button>
        <button class="cancel">取消</button>
      </div>
      <div class="hint">⌘/Ctrl + Enter 快速保存</div>
    </div>`
  }

  // 图片入口有三个（选文件 / 粘贴 / 拖拽），收敛到这里，
  // 免得三处各写一份体积校验与错误提示
  async #addImages(result) {
    const { assets, errors } = result
    if (errors?.length) this.#toast(errors[0])

    if (!assets?.length) return
    if (!this.#draft) return

    this.#draft.images = [...(this.#draft.images || []), ...assets]
    this.render()
  }

  #toast(message) {
    this.dispatchEvent(new CustomEvent('vr-toast', {
      bubbles: true, composed: true, detail: { message, kind: 'error' },
    }))
  }

  #commitDraft() {
    const ta = this.#shadow.querySelector('textarea')
    const text = (ta?.value ?? this.#draft?.text ?? '').trim()
    const images = this.#draft?.images || []

    // 只有图没有字也是一条有效备注——「照这张改」本身就是需求
    if (!text && !images.length) { this.#draft = null; this.render(); return }

    this.#draft.editingId
      ? ChangeStore.updateComment(this.#draft.editingId, text, images)
      : ChangeStore.addComment(this.#draft.el, text, images)

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

    on('.add-image', 'click', async e => {
      e.preventDefault()
      this.#addImages(await pickImages())
    })

    // 粘贴截图：剪贴板里有图就吃掉这次粘贴，没有就放行让文字正常粘进去
    on('textarea', 'paste', async e => {
      const hasImage = Array.from(e.clipboardData?.items || [])
        .some(i => i.kind === 'file' && /^image\//.test(i.type))
      if (!hasImage) return

      e.preventDefault()
      this.#addImages(await imagesFromDataTransfer(e.clipboardData))
    })

    // 拖拽：必须在 dragover 上 preventDefault，否则浏览器会当成导航，
    // 把整个页面替换成那张图
    const bubble = shadow.querySelector('.bubble')
    if (bubble) {
      bubble.addEventListener('dragover', e => {
        if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return
        e.preventDefault()
        bubble.setAttribute('data-drop', '')
      })
      bubble.addEventListener('dragleave', () => bubble.removeAttribute('data-drop'))
      bubble.addEventListener('drop', async e => {
        e.preventDefault()
        bubble.removeAttribute('data-drop')
        this.#addImages(await imagesFromDataTransfer(e.dataTransfer))
      })
    }

    on('.ref-del', 'click', e => {
      e.preventDefault()
      const id = e.currentTarget.dataset.id
      this.#draft.images = (this.#draft.images || []).filter(i => i.id !== id)
      this.render()
    })

    // 说明实时写回数据：重绘由 scroll/resize 触发，靠数据兜底才不会丢
    on('.ref-note', 'input', e => {
      const img = (this.#draft?.images || []).find(i => i.id === e.currentTarget.dataset.id)
      if (img) img.note = e.currentTarget.value
    })

    on('.ref-note', 'keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.#commitDraft() }
    })
  }
}

customElements.define('visual-revise-comment-layer', CommentLayer)
