/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 自定义下拉：原生 <select> 的弹出层由系统绘制，无法定制样式，
// 在深色浮层里显示为系统浅色菜单，与整体割裂。
// 弹出面板挂到 body 而非 shadow 内——面板本身有 overflow: auto，
// 放在里面会被裁掉。
const PANEL_ID = 'visual-revise-select-panel'

const PANEL_CSS = `
  position: fixed;
  z-index: 2147483647;
  min-width: 160px;
  max-height: 320px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  background: #1e1e1e;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgb(0 0 0 / .55), inset 0 0 0 1px rgb(255 255 255 / .07);
  font: 500 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  color: #fff;
`

const OPTION_CSS = `
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 16px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  color: #fff;
`

let openInstance = null

const closePanel = () => {
  document.getElementById(PANEL_ID)?.remove()
  openInstance?.removeAttribute('data-open')
  openInstance = null
}

document.addEventListener('pointerdown', e => {
  if (!openInstance) return
  const path = e.composedPath?.() || []
  if (path.some(n => n?.id === PANEL_ID || n === openInstance)) return
  closePanel()
}, true)

addEventListener('scroll', () => closePanel(), true)
addEventListener('resize', () => closePanel())

export class VrSelect extends HTMLElement {
  #shadow

  static get observedAttributes() { return ['value', 'options'] }

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.setAttribute('data-visual-revise-ui', '')
    this.#render()
    this.addEventListener('click', () => this.#toggle())
    this.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.#toggle() }
      if (e.key === 'Escape') closePanel()
    })
    this.tabIndex = 0
  }

  disconnectedCallback() {
    if (openInstance === this) closePanel()
  }

  attributeChangedCallback() {
    if (this.#shadow.firstChild) this.#render()
  }

  get value() { return this.getAttribute('value') || '' }
  set value(v) { this.setAttribute('value', v) }

  get options() {
    try { return JSON.parse(this.getAttribute('options') || '[]') } catch { return [] }
  }

  // options 给成 [值, 显示名] 时触发器显示后者。多数属性的值本身就是要显示的
  // 内容（flex、dashed），但像网格轨道类型这种，值是 CSS 写法、显示要用中文。
  #label() {
    const v = this.value
    for (const opt of this.options)
      if (Array.isArray(opt) && opt[0] === v) return opt[1]
    return v || '—'
  }

  #render() {
    this.#shadow.innerHTML = `
      <style>
        :host {
          display: block;
          height: 30px;
          background: #383838;
          border: 1px solid transparent;
          border-radius: 5px;
          cursor: pointer;
          outline: none;
        }
        :host(:hover) { background: #444; }
        :host(:focus-visible), :host([data-open]) { border-color: #0d99ff; }

        .trigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          height: 100%;
          padding: 0 8px;
          font: 400 11px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
          color: #fff;
        }
        .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .caret { flex: none; width: 8px; height: 8px; opacity: .55;
          background: currentColor;
          clip-path: polygon(15% 32%, 50% 68%, 85% 32%, 78% 25%, 50% 54%, 22% 25%); }
      </style>
      <div class="trigger">
        <span class="label">${this.#label()}</span>
        <span class="caret"></span>
      </div>`
  }

  #toggle() {
    if (openInstance === this) return closePanel()
    closePanel()

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.setAttribute('data-visual-revise-ui', '')
    panel.style.cssText = PANEL_CSS

    const current = this.value
    for (const opt of this.options) {
      const [val, label] = Array.isArray(opt) ? opt : [opt, opt]
      const item = document.createElement('div')

      item.style.cssText = OPTION_CSS
      item.textContent = label
      if (val === current) item.style.background = '#0d99ff'

      item.addEventListener('pointerenter', () => {
        if (val !== current) item.style.background = 'rgb(255 255 255 / .09)'
      })
      item.addEventListener('pointerleave', () => {
        if (val !== current) item.style.background = 'transparent'
      })
      item.addEventListener('click', e => {
        e.stopPropagation()
        closePanel()
        this.value = val
        this.dispatchEvent(new CustomEvent('vr-select', {
          bubbles: true, composed: true, detail: { value: val },
        }))
      })

      panel.appendChild(item)
    }

    document.body.appendChild(panel)

    // 定位：默认贴在触发器下方，空间不足时向上翻
    const rect = this.getBoundingClientRect()
    const height = panel.offsetHeight
    const below = innerHeight - rect.bottom

    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`
    panel.style.top = below >= height + 12 || below >= rect.top
      ? `${rect.bottom + 6}px`
      : `${Math.max(8, rect.top - height - 6)}px`
    panel.style.minWidth = `${rect.width}px`

    this.setAttribute('data-open', '')
    openInstance = this
  }
}

customElements.define('vr-select', VrSelect)
