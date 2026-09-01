import { ChangeStore } from '../../core/change-store.js'
import { default as bar_css } from './toolbar.element.css'

// 线性图标，24×24 视框、2px 描边、圆角端点——与 Lucide 同一套几何规范，
// 保证并排时视觉重量一致。stroke 用 currentColor，由按钮状态驱动颜色。
const icon = (paths, { size = 17, fill = '' } = {}) => `
  <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true">${fill}${paths}</svg>`

const ICONS = {
  // 品牌：页面框内有一个被选中的元素
  brand: icon(
    `<rect x="3" y="3" width="18" height="18" rx="4"/>`,
    { fill: `<rect x="7.5" y="7.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" opacity=".92"/>` }),

  // 选择元素：框 + 指针（Lucide square-mouse-pointer）
  select: icon(`
    <path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/>
    <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z"/>`),

  // 评论：方形气泡
  comment: icon(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`),

  // 重排：上下双向箭头
  reorder: icon(`
    <path d="m21 16-4 4-4-4"/><path d="M17 20V4"/>
    <path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>`),

  // 记录：列表
  list: icon(`
    <path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>
    <path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>`),

  // 复制
  undo: icon(`<path d="M3 10h11a5 5 0 0 1 0 10H9"/><path d="M7 6 3 10l4 4"/>`),
  redo: icon(`<path d="M21 10H10a5 5 0 0 0 0 10h5"/><path d="M17 6l4 4-4 4"/>`),
  copy: icon(`
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`),

  close: icon(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
}

const MODES = [
  { id: 'select',  label: '选择元素', icon: ICONS.select,  hint: '点击页面元素，在右侧面板调整样式' },
  { id: 'comment', label: '评论',     icon: ICONS.comment, hint: '在元素上写交互需求（C）' },
  { id: 'reorder', label: '重排',     icon: ICONS.reorder, hint: '拖动子元素调整顺序（R）' },
]

export class ReviseToolbar extends HTMLElement {
  #shadow
  #mode = 'select'
  #unsubscribe = null
  #frame = null

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.setAttribute('data-visual-revise-ui', '')
    this.addEventListener('keydown', e => e.stopPropagation())

    this.#shadow.innerHTML = `
      <style>${bar_css}</style>
      <div class="bar">
        <div class="brand" title="Visual Revise">${ICONS.brand}</div>
        <div class="sep"></div>
        ${MODES.map(m => `
          <button data-mode="${m.id}" title="${m.hint}">${m.icon}<span>${m.label}</span></button>
        `).join('')}
        <div class="sep"></div>
        <button class="list" title="查看全部改动记录">
          ${ICONS.list}<span>记录</span><span class="count" data-empty>0</span>
        </button>
        <button class="copy" title="把全部改动整理成提示词复制到剪贴板">
          ${ICONS.copy}<span>复制提示词</span>
        </button>
        <div class="sep"></div>
        <button class="undo icon-only" title="撤销（⌘Z）" disabled>${ICONS.undo}</button>
        <button class="redo icon-only" title="重做（⌘⇧Z）" disabled>${ICONS.redo}</button>
        <div class="sep"></div>
        <button class="close icon-only" title="关闭编辑器">${ICONS.close}</button>
      </div>
      `

    this.#bind()
    this.#unsubscribe = ChangeStore.subscribe(() => this.#schedule())
    this.setMode('select')
    this.#syncStats()
  }

  disconnectedCallback() {
    this.#unsubscribe?.()
    if (this.#frame) cancelAnimationFrame(this.#frame)
    clearTimeout(this.__t)
    document.getElementById('visual-revise-toast')?.remove()
  }

  #schedule() {
    if (this.#frame) return
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null
      this.#syncStats()
    })
  }

  #syncStats() {
    const { total } = ChangeStore.stats()
    const count = this.#shadow.querySelector('.count')
    // 按钮上写清将要撤销的是什么：只画一个灰掉的箭头，用户没法判断
    // 点下去会发生什么，也就不敢点
    for (const [cls, can, label, key] of [
      ['.undo', ChangeStore.canUndo, ChangeStore.history.undoLabel, '⌘Z'],
      ['.redo', ChangeStore.canRedo, ChangeStore.history.redoLabel, '⌘⇧Z'],
    ]) {
      const btn = this.#shadow.querySelector(cls)
      if (!btn) continue
      btn.disabled = !can
      const action = cls === '.undo' ? '撤销' : '重做'
      btn.title = can ? `${action}：${label || '上一步'}（${key}）` : `没有可${action}的操作`
    }

    const copy = this.#shadow.querySelector('.copy')

    count.textContent = total
    total ? count.removeAttribute('data-empty') : count.setAttribute('data-empty', '')
    total ? copy.setAttribute('data-ready', '') : copy.removeAttribute('data-ready')
  }

  get mode() { return this.#mode }

  // 由宿主统一驱动：点击按钮与快捷键最终都汇到这里，保证高亮与实际模式一致
  setMode(mode) {
    this.#mode = mode
    this.#shadow.querySelectorAll('button[data-mode]').forEach(btn =>
      btn.dataset.mode === mode
        ? btn.setAttribute('data-on', '')
        : btn.removeAttribute('data-on'))
  }

  // toast 必须挂在 body 而不是工具条的 shadow 里：:host 上的
  // transform: translateX(-50%) 会创建包含块，使内部 position: fixed
  // 相对工具条而非视口定位——写 bottom 反而跑到了工具条上方。
  #ensureToast() {
    let el = document.getElementById('visual-revise-toast')
    if (el) return el

    el = document.createElement('div')
    el.id = 'visual-revise-toast'
    el.setAttribute('data-visual-revise-ui', '')
    el.style.cssText = `
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%) translateY(6px);
      z-index: 2147483647;
      padding: 9px 16px;
      font: 500 13px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      white-space: nowrap;
      color: #fff;
      background: #1c1c1c;
      border-radius: 10px;
      box-shadow: 0 6px 20px rgb(0 0 0 / .34), inset 0 0 0 1px rgb(255 255 255 / .07);
      opacity: 0;
      pointer-events: none;
      transition: opacity .16s ease, transform .16s ease;`

    document.body.appendChild(el)
    return el
  }

  toast(message, kind = 'info') {
    const el = this.#ensureToast()

    el.textContent = message
    el.style.color = kind === 'error' ? '#ff8f8f' : '#fff'
    el.style.opacity = '1'
    el.style.transform = 'translateX(-50%) translateY(0)'

    clearTimeout(this.__t)
    this.__t = setTimeout(() => {
      el.style.opacity = '0'
      el.style.transform = 'translateX(-50%) translateY(6px)'
    }, 2400)
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }))
  }

  #bind() {
    const shadow = this.#shadow
    const on = (sel, fn) => shadow.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn))

    on('button[data-mode]', e =>
      this.#emit('vr-mode', { mode: e.currentTarget.dataset.mode }))

    on('.undo', () => this.#emit('vr-undo'))
    on('.redo', () => this.#emit('vr-redo'))
    on('.list', () => this.#emit('vr-open-list'))
    on('.copy', () => this.#emit('vr-copy'))
    on('.close', () => this.#emit('vr-close'))

    this.#makeDraggable(shadow.querySelector('.bar'))
  }

  #makeDraggable(handle) {
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return

      e.preventDefault()
      handle.setPointerCapture(e.pointerId)

      const rect = this.getBoundingClientRect()
      const offX = e.clientX - rect.left
      const offY = e.clientY - rect.top

      const move = ev => {
        // 拖动后脱离居中定位，改为绝对坐标
        this.style.transform = 'none'
        this.style.left = `${ev.clientX - offX}px`
        this.style.top = `${ev.clientY - offY}px`
      }
      const up = ev => {
        handle.releasePointerCapture(ev.pointerId)
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
    })
  }
}

customElements.define('visual-revise-toolbar', ReviseToolbar)
