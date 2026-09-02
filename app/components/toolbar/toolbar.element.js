import { ChangeStore } from '../../core/change-store.js'
import { default as bar_css } from './toolbar.element.css'

// 线性图标，24×24 视框、圆角端点——与 Lucide 同一套几何规范，保证并排时
// 视觉重量一致。描边 1.5 而不是 2：并排一整排时 2px 会糊成一团黑，
// 细一档、尺寸再放大一点，观感才清爽。stroke 用 currentColor，由按钮状态驱动。
const icon = (paths, { size = 18, fill = '' } = {}) => `
  <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
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

// 标签藏起来之后，功能名只剩 tooltip 承载，所以名称与快捷键必须成对定义，
// 免得两处各写一份、改了一处忘另一处。
const MODES = [
  { id: 'select',  label: '选择元素', key: 'V', icon: ICONS.select },
  { id: 'comment', label: '评论',     key: 'C', icon: ICONS.comment },
  { id: 'reorder', label: '重排',     key: 'R', icon: ICONS.reorder },
]

// 关闭没有自定义快捷键：⌥⇧D 是浏览器命令，按一下就把编辑器收起来，
// 本来就是唤起用的那个键
const TIPS = {
  brand: ['Visual Revise', ''],
  list:  ['改动记录', 'L'],
  copy:  ['复制提示词', 'P'],
  undo:  ['撤销', '⌘Z'],
  redo:  ['重做', '⌘⇧Z'],
  close: ['关闭编辑器', '⌥⇧D'],
}

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
        <div class="brand" data-tip="brand">${ICONS.brand}</div>
        <div class="sep"></div>
        ${MODES.map(m => `
          <button data-mode="${m.id}" data-tip="mode:${m.id}">${m.icon}</button>
        `).join('')}
        <div class="sep"></div>
        <button class="list" data-tip="list">
          ${ICONS.list}<span class="count" data-empty>0</span>
        </button>
        <button class="copy" data-tip="copy">${ICONS.copy}</button>
        <div class="sep"></div>
        <button class="undo" data-tip="undo" disabled>${ICONS.undo}</button>
        <button class="redo" data-tip="redo" disabled>${ICONS.redo}</button>
        <div class="sep"></div>
        <button class="close" data-tip="close">${ICONS.close}</button>
      </div>
      <div class="tip" hidden><span class="tip-label"></span><span class="tip-key"></span></div>
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
    for (const [cls, can, label] of [
      ['.undo', ChangeStore.canUndo, ChangeStore.history.undoLabel],
      ['.redo', ChangeStore.canRedo, ChangeStore.history.redoLabel],
    ]) {
      const btn = this.#shadow.querySelector(cls)
      if (!btn) continue
      btn.disabled = !can
      const action = cls === '.undo' ? '撤销' : '重做'
      // 写进 dataset 而不是 title：气泡由我们自己画，留着 title
      // 会让原生提示和自定义气泡一起冒出来，叠成两层
      btn.dataset.tipLabel = can ? `${action}：${label || '上一步'}` : `没有可${action}的操作`
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

  // 标签藏起来之后，功能名和快捷键全靠这个气泡。名称取自 MODES / TIPS，
  // 撤销这类内容会变的则读 dataset —— 定义只有一份，不会两处走样。
  #tipFor(el) {
    const kind = el.dataset.tip || ''
    if (kind.startsWith('mode:')) {
      const mode = MODES.find(m => m.id === kind.slice(5))
      return mode ? [mode.label, mode.key] : null
    }
    const preset = TIPS[kind]
    if (!preset) return null
    return [el.dataset.tipLabel || preset[0], preset[1]]
  }

  #showTip(el) {
    const tip = this.#shadow.querySelector('.tip')
    const entry = this.#tipFor(el)
    if (!tip || !entry) return

    const [label, key] = entry
    tip.querySelector('.tip-label').textContent = label
    tip.querySelector('.tip-key').textContent = key || ''
    tip.hidden = false

    // 宿主与 .bar 同尺寸，所以按钮中心换算到宿主坐标即可
    const host = this.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const center = r.left + r.width / 2 - host.left

    tip.style.left = `${center}px`
    tip.style.setProperty('--arrow-x', '0px')

    // 工具条可以拖到贴边，气泡比按钮宽得多，不夹一下会跑出视口
    const box = tip.getBoundingClientRect()
    const vw = document.documentElement.clientWidth || innerWidth
    const shift = box.left < 8 ? 8 - box.left
      : box.right > vw - 8 ? vw - 8 - box.right
      : 0

    if (shift) {
      tip.style.left = `${center + shift}px`
      // 气泡整体挪开了，箭头要往回挪同样的距离才还指着那个按钮
      tip.style.setProperty('--arrow-x', `${-shift}px`)
    }
  }

  #hideTip() {
    const tip = this.#shadow.querySelector('.tip')
    if (tip) tip.hidden = true
  }

  #bind() {
    const shadow = this.#shadow
    const on = (sel, fn) => shadow.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn))

    const bar = shadow.querySelector('.bar')
    bar.addEventListener('pointerover', e => {
      const target = e.target.closest?.('[data-tip]')
      target ? this.#showTip(target) : this.#hideTip()
    })
    bar.addEventListener('pointerleave', () => this.#hideTip())
    // 点下去就把气泡收掉：按钮多半会切换状态，留着一个说着旧状态的提示很怪
    bar.addEventListener('pointerdown', () => this.#hideTip())

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
