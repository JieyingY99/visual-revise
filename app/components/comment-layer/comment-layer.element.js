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

// 句子里的图片存成序号标记，而不是文件名：提示词下方的参考图清单用同一套
// 编号，AI 既知道图插在句子的哪个位置，也知道该去读哪个文件。
const MARK = n => `[图${n}]`
const MARK_RE = /\[图(\d+)\]/g

// contenteditable 里回车会生成块级节点，序列化时要还原成换行
const BLOCK = /^(DIV|P|LI|SECTION|ARTICLE|BLOCKQUOTE|H[1-6])$/

const PREVIEW_MAX = 260

export class CommentLayer extends HTMLElement {
  #shadow
  #active = false
  #draft = null          // { el, x, y, editingId, text, images }
  #draftKey = 0          // 每开一次草稿 +1，用来判断气泡该不该重建
  #builtKey = -1
  #refsKey = null        // 参考图集合的签名：只有集合变了才重建说明区
  #lastRange = null      // 编辑器里最后的光标位置（选文件的弹窗会抢走焦点）
  #preview = null
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
    this.#shadow.innerHTML =
      `<style>${layer_css}</style><div id="root"><div id="pins"></div></div>`
    this.#unsubscribe = ChangeStore.subscribe(() => this.schedule())

    // pin 每帧重建，逐个绑事件会一直在装卸监听器；委托一次就够
    this.#shadow.querySelector('#pins').addEventListener('click', e => {
      const pin = e.target.closest?.('.pin')
      if (!pin) return
      e.stopPropagation()
      this.editComment(pin.dataset.id)
    })

    // scroll 与 resize 会以远高于帧率的频率触发，而每次 render 都要为
    // 每个 pin 取一次 getBoundingClientRect（强制重排）。合并到同一帧。
    this.#reposition = () => { this.#hidePreview(); this.schedule() }
    addEventListener('scroll', this.#reposition, { passive: true })
    addEventListener('resize', this.#reposition, { passive: true })

    // 有些页面禁掉了 img-src data:，缩略图会静默变成裂图。
    // 探一次，拿不到预览就退化成「类型 + 体积」的文字条目。
    canRenderDataUrl().then(ok => {
      if (this.#thumbOk === ok) return
      this.#thumbOk = ok
      this.#builtKey = -1        // 让气泡按新的降级形态重建
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
    this.#draftKey++
    this.#draft = {
      el, x: clientX + scrollX, y: clientY + scrollY,
      editingId: null, text: '', images: [],
    }
    this.render()
  }

  editComment(id) {
    const c = ChangeStore.read().comments.find(c => c.id === id)
    if (!c) return
    const r = c.el.getBoundingClientRect()
    this.#draftKey++
    this.#draft = {
      el: c.el, x: r.right + scrollX, y: r.top + scrollY,
      editingId: id, text: c.text, images: (c.images || []).slice(),
    }
    this.render()
  }

  render() {
    if (!this.#shadow.querySelector('#root')) return
    this.#renderPins()
    this.#syncBubble()
  }

  #renderPins() {
    const { comments } = ChangeStore.read()

    this.#shadow.querySelector('#pins').innerHTML = comments.map(c => {
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
  }

  // 气泡按草稿建一次就不再整块重建。输入区是 contenteditable，里面混着
  // chip 节点，每帧重建 innerHTML 再把光标塞回去几乎必错位；改成只重建
  // pin，气泡活着的时候只重新定位。
  #syncBubble() {
    const root = this.#shadow.querySelector('#root')
    const existing = root.querySelector('.bubble')

    if (!this.#draft) {
      existing?.remove()
      this.#hidePreview()
      this.#builtKey = -1
      this.#lastRange = null
      return
    }

    if (!existing || this.#builtKey !== this.#draftKey) {
      existing?.remove()
      this.#hidePreview()
      this.#lastRange = null
      this.#refsKey = null
      root.append(this.#buildBubble())
      this.#builtKey = this.#draftKey
      this.#syncRefs()
      this.#placeBubble()
      this.#focusEditor()
      return
    }

    this.#syncRefs()
    this.#placeBubble()
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

  #buildBubble() {
    const { el, editingId } = this.#draft
    const tag = el.tagName.toLowerCase()
    const cls = Array.from(el.classList).slice(0, 2).join('.')

    const bubble = document.createElement('div')
    bubble.className = 'bubble'
    bubble.innerHTML = `
      <span class="sel">${tag}${cls ? '.' + cls : ''}</span>
      <div class="editor-wrap">
        <div class="editor" contenteditable="true" spellcheck="false"
          data-placeholder="描述想要的效果，例如：鼠标移入时上浮并变亮"></div>
        <div class="editor-bar">
          <button class="add-image" type="button"
            title="添加参考图（也可直接粘贴截图，或把图拖进来）">+</button>
        </div>
      </div>
      <div class="refs" hidden></div>
      <div class="actions">
        <button class="save">${editingId ? '保存' : '添加'}</button>
        <button class="cancel">取消</button>
      </div>
      <div class="hint">⌘/Ctrl + Enter 快速保存</div>`

    this.#fillEditor(bubble.querySelector('.editor'))
    this.#bindBubble(bubble)
    return bubble
  }

  get #editor() { return this.#shadow.querySelector('.editor') }

  // 把「文本 + [图N] 标记」还原成带 chip 的富文本。这次改动之前存下的评论
  // 没有标记，那些图统一补在末尾——否则它们只活在说明区里，编辑时看不出
  // 该插在句子的哪个位置。
  #fillEditor(editor) {
    const { text = '', images = [] } = this.#draft
    const used = new Set()
    let last = 0

    for (const m of text.matchAll(MARK_RE)) {
      const img = images[Number(m[1]) - 1]
      if (!img) continue
      editor.append(text.slice(last, m.index), this.#chip(img))
      used.add(img.id)
      last = m.index + m[0].length
    }
    editor.append(text.slice(last))

    for (const img of images) {
      if (used.has(img.id)) continue
      editor.append(this.#chip(img), ' ')
    }

    this.#syncEmpty(editor)
  }

  #chip(img) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.contentEditable = 'false'
    chip.dataset.id = img.id
    chip.title = img.name

    if (this.#thumbOk) {
      const thumb = document.createElement('img')
      thumb.src = img.dataUrl
      thumb.alt = ''
      chip.append(thumb)
    } else {
      const badge = document.createElement('span')
      badge.className = 'chip-noimg'
      badge.textContent = extOf(img)
      chip.append(badge)
    }

    const name = document.createElement('span')
    name.className = 'chip-name'
    // 去掉扩展名：chip 是行内的，名字越短越不打断句子，完整名在 title 里
    name.textContent = img.name.replace(/\.[^.]+$/, '') || img.name
    chip.append(name)
    return chip
  }

  #syncEmpty(editor = this.#editor) {
    if (!editor) return
    const empty = !editor.querySelector('.chip') && !editor.textContent.trim()
    editor.classList.toggle('is-empty', empty)
  }

  // 编辑器 → 保存文本。chip 写成 [图N]，N 是它在参考图清单里的序号。
  #serialize() {
    const editor = this.#editor
    if (!editor) return this.#draft?.text ?? ''

    const order = new Map((this.#draft?.images || []).map((img, i) => [img.id, i + 1]))
    let out = ''

    const walk = node => {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) { out += n.data; continue }
        if (n.nodeType !== Node.ELEMENT_NODE) continue
        if (n.classList?.contains('chip')) {
          const no = order.get(n.dataset.id)
          if (no) out += MARK(no)
          continue
        }
        if (n.tagName === 'BR') { out += '\n'; continue }
        if (BLOCK.test(n.tagName) && out && !out.endsWith('\n')) out += '\n'
        walk(n)
      }
    }
    walk(editor)

    // contenteditable 会插不换行空格，落到提示词里就是个诡异的不可见字符
    return out.replace(/\u00a0/g, ' ').trim()
  }

  // chip 是「这张图在不在这条评论里」的唯一凭据。Backspace 删 chip、剪切、
  // 全选删除，走的都是这一条路径，不必为每种删法各写一遍。
  #reconcile() {
    const editor = this.#editor
    if (!editor || !this.#draft) return

    const seen = []
    for (const chip of editor.querySelectorAll('.chip')) {
      if (!seen.includes(chip.dataset.id)) seen.push(chip.dataset.id)
    }

    const byId = new Map((this.#draft.images || []).map(i => [i.id, i]))
    const next = seen.map(id => byId.get(id)).filter(Boolean)

    const before = (this.#draft.images || []).map(i => i.id).join(',')
    if (before === next.map(i => i.id).join(',')) return

    this.#draft.images = next
    this.#syncRefs()
    this.#placeBubble()
  }

  #syncRefs() {
    const box = this.#shadow.querySelector('.refs')
    if (!box || !this.#draft) return

    const images = this.#draft.images || []
    const key = images.map(i => i.id).join(',')
    // 集合没变就不重建：说明写到一半被抽掉输入框，等于把用户打的字丢了
    if (key === this.#refsKey) return
    this.#refsKey = key

    box.hidden = !images.length
    box.innerHTML = images.map((img, i) => {
      const thumb = this.#thumbOk
        ? `<span class="ref-thumb"><img src="${esc(img.dataUrl)}" alt=""></span>`
        : `<span class="ref-thumb ref-noimg" title="本页禁止内嵌图片预览">${extOf(img)}</span>`

      const size = img.w ? `${img.w}×${img.h}` : fmtBytes(img.bytes || 0)

      return `<div class="ref" data-id="${img.id}">
        <div class="ref-head">
          ${thumb}
          <span class="ref-no">${MARK(i + 1)}</span>
          <span class="ref-name" title="${esc(img.name)}">${esc(img.name)}</span>
          <span class="ref-size">${size}</span>
          <button class="ref-del" data-id="${img.id}" title="移除这张图">×</button>
        </div>
        <textarea class="ref-note" data-id="${img.id}"
          placeholder="这张图说明什么（可留空）">${esc(img.note || '')}</textarea>
      </div>`
    }).join('')

    this.#bindRefs(box)
  }

  #bindRefs(box) {
    const on = (sel, evt, fn) =>
      box.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn))

    on('.ref-del', 'click', e => {
      e.preventDefault()
      this.#removeImage(e.currentTarget.dataset.id)
    })

    // 说明实时写回数据：保存走的是数据而不是 DOM
    on('.ref-note', 'input', e => {
      const img = (this.#draft?.images || []).find(i => i.id === e.currentTarget.dataset.id)
      if (img) img.note = e.currentTarget.value
    })

    on('.ref-note', 'keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.#commitDraft() }
      if (e.key === 'Escape') { e.preventDefault(); this.cancelDraft() }
    })

    on('.ref-thumb', 'pointerenter', e =>
      this.#showPreview(e.currentTarget, e.currentTarget.closest('.ref').dataset.id))
    on('.ref-thumb', 'pointerleave', () => this.#hidePreview())
  }

  #bindBubble(bubble) {
    const editor = bubble.querySelector('.editor')

    bubble.querySelector('.save').addEventListener('click', () => this.#commitDraft())
    bubble.querySelector('.cancel').addEventListener('click', () => this.cancelDraft())

    bubble.querySelector('.add-image').addEventListener('click', async e => {
      e.preventDefault()
      this.#rememberRange()          // 文件弹窗会抢走焦点，先把光标位置留下
      this.#addImages(await pickImages())
    })

    editor.addEventListener('input', () => {
      this.#syncEmpty(editor)
      this.#reconcile()
      this.#rememberRange()
    })
    editor.addEventListener('keyup', () => this.#rememberRange())
    editor.addEventListener('mouseup', () => this.#rememberRange())

    editor.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.#commitDraft() }
      if (e.key === 'Escape') { e.preventDefault(); this.cancelDraft() }
    })

    // contenteditable 默认会把网页上复制来的富文本连同标签一起吃进去。
    // 一律降级成纯文本；剪贴板里有图则改成插 chip。
    editor.addEventListener('paste', async e => {
      const hasImage = Array.from(e.clipboardData?.items || [])
        .some(i => i.kind === 'file' && /^image\//.test(i.type))
      e.preventDefault()

      if (hasImage) {
        this.#rememberRange()
        this.#addImages(await imagesFromDataTransfer(e.clipboardData))
        return
      }
      const text = e.clipboardData?.getData('text/plain') || ''
      if (text) this.#insertNodes([document.createTextNode(text)])
    })

    // chip 只放得下 16px 缩略图和一个名字，看不清是哪张，hover 给大图
    editor.addEventListener('pointerover', e => {
      const chip = e.target.closest?.('.chip')
      if (chip) this.#showPreview(chip, chip.dataset.id)
    })
    editor.addEventListener('pointerout', e => {
      const chip = e.target.closest?.('.chip')
      if (chip && !chip.contains(e.relatedTarget)) this.#hidePreview()
    })

    // 拖拽：必须在 dragover 上 preventDefault，否则浏览器会当成导航，
    // 把整个页面替换成那张图
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

  #selection() {
    return this.#shadow.getSelection?.() ?? document.getSelection()
  }

  #rememberRange() {
    const editor = this.#editor
    const sel = this.#selection()
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
    if (editor && range && editor.contains(range.startContainer)) {
      this.#lastRange = range.cloneRange()
    }
  }

  // 插到光标处。选文件的弹窗、拖拽都会让编辑器失焦，所以位置得提前记；
  // 记不到就退回末尾，总好过静默什么都不插。
  #insertNodes(nodes) {
    const editor = this.#editor
    if (!editor) return

    let range = this.#lastRange && editor.contains(this.#lastRange.startContainer)
      ? this.#lastRange.cloneRange()
      : null

    if (!range) {
      range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
    }

    range.deleteContents()
    const frag = document.createDocumentFragment()
    nodes.forEach(n => frag.append(n))
    const last = frag.lastChild
    range.insertNode(frag)

    if (last) { range.setStartAfter(last); range.collapse(true) }
    const sel = this.#selection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    this.#lastRange = range.cloneRange()

    editor.focus()
    this.#syncEmpty(editor)
  }

  #focusEditor() {
    requestAnimationFrame(() => {
      const editor = this.#editor
      if (!editor) return
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      const sel = this.#selection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      editor.focus()
      this.#lastRange = range.cloneRange()
    })
  }

  // 说明区删图必须连 chip 一起删，否则句子里留下一个指向空气的 chip
  #removeImage(id) {
    if (!this.#draft) return
    this.#editor?.querySelectorAll(`.chip[data-id="${CSS.escape(id)}"]`)
      .forEach(chip => chip.remove())

    this.#draft.images = (this.#draft.images || []).filter(i => i.id !== id)
    this.#syncEmpty()
    this.#syncRefs()
    this.#placeBubble()
  }

  // 图片入口有三个（选文件 / 粘贴 / 拖拽），收敛到这里，
  // 免得三处各写一份体积校验与错误提示
  async #addImages(result) {
    const { assets, errors } = result
    if (errors?.length) this.#toast(errors[0])
    if (!assets?.length || !this.#draft) return

    this.#draft.images = [...(this.#draft.images || []), ...assets]
    this.#insertNodes(assets.flatMap(img => [this.#chip(img), document.createTextNode(' ')]))
    this.#reconcile()   // 清单顺序跟着 chip 在句子里的先后走
    this.#syncRefs()
    this.#placeBubble()
  }

  #showPreview(anchor, id) {
    const img = (this.#draft?.images || []).find(i => i.id === id)
    if (!img || !this.#thumbOk) return

    let box = this.#preview
    if (!box) {
      box = document.createElement('div')
      box.className = 'preview'
      box.innerHTML = '<img alt="">'
      this.#shadow.querySelector('#root').append(box)
      this.#preview = box
    }

    // 按素材已知的原始尺寸自己算大小，不等图片加载完再量：
    // 那样第一次 hover 会先摆在错的位置，然后跳一下
    const scale = Math.min(PREVIEW_MAX / (img.w || PREVIEW_MAX),
                           PREVIEW_MAX / (img.h || PREVIEW_MAX), 1)
    const thumb = box.querySelector('img')
    thumb.src = img.dataUrl
    thumb.style.width = `${Math.round((img.w || PREVIEW_MAX) * scale)}px`
    thumb.style.height = `${Math.round((img.h || PREVIEW_MAX) * scale)}px`
    box.hidden = false

    const r = anchor.getBoundingClientRect()
    const p = box.getBoundingClientRect()
    const above = r.top - p.height - 8
    const top = (above >= EDGE ? above : r.bottom + 8) + scrollY
    const left = r.left + r.width / 2 - p.width / 2 + scrollX

    box.style.left = `${fit(left, scrollX + EDGE, scrollX + vw() - EDGE - p.width)}px`
    box.style.top = `${fit(top, scrollY + EDGE, scrollY + vh() - EDGE - p.height)}px`
  }

  #hidePreview() {
    if (this.#preview) this.#preview.hidden = true
  }

  #toast(message) {
    this.dispatchEvent(new CustomEvent('vr-toast', {
      bubbles: true, composed: true, detail: { message, kind: 'error' },
    }))
  }

  #commitDraft() {
    if (!this.#draft) return
    const text = this.#serialize()
    const images = this.#draft.images || []

    // 只有图没有字也是一条有效备注——「照这张改」本身就是需求
    if (!text && !images.length) { this.#draft = null; this.render(); return }

    this.#draft.editingId
      ? ChangeStore.updateComment(this.#draft.editingId, text, images)
      : ChangeStore.addComment(this.#draft.el, text, images)

    this.#draft = null
    this.render()
  }
}

customElements.define('visual-revise-comment-layer', CommentLayer)
