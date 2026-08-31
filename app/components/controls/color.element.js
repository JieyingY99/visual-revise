// 单色控件：一个色块 + 一个文本框，点开挂在 body 上的色盘弹层。
// 色盘主体在 picker.js，渐变里的每个色标共用同一套。
import {
  CHECKER, PANEL_STYLE, clamp, parseColor, formatColor,
  pickerMarkup, createPicker,
} from './picker.js'

export { hsvToRgb, rgbToHsv, parseColor, formatColor } from './picker.js'

const PANEL_ID = 'visual-revise-color-panel'
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

export class VrColor extends HTMLElement {
  #shadow
  #format = 'Hex'
  #panel = null
  #picker = null

  static get observedAttributes() { return ['value'] }

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.setAttribute('data-visual-revise-ui', '')
    this.#renderTrigger()
    this.addEventListener('click', e => {
      if (e.target.closest?.('input')) return
      this.#toggle()
    })
  }

  disconnectedCallback() { if (openInstance === this) closePanel() }

  attributeChangedCallback() {
    if (this.#shadow.firstChild) this.#renderTrigger()
    if (openInstance === this) this.#picker?.set(this.value)
  }

  get value() { return this.getAttribute('value') || '' }
  set value(v) { this.setAttribute('value', v) }

  get #rgba() {
    const c = parseColor(this.value)
    return c.valid ? c : { r: 0, g: 0, b: 0, a: 0 }
  }

  #renderTrigger() {
    const { r, g, b, a } = this.#rgba
    const transparent = a === 0

    this.#shadow.innerHTML = `
      <style>
        :host { display: flex; gap: 6px; align-items: center; }
        .swatch {
          flex: none; width: 30px; height: 30px;
          border-radius: 5px; border: 1px solid #3d3d3d;
          position: relative; overflow: hidden; cursor: pointer;
          ${CHECKER}
        }
        .swatch i { position: absolute; inset: 0; }
        .text {
          flex: 1; min-width: 0; height: 30px; padding: 0 8px;
          font: 400 11px/1 ui-monospace, Menlo, monospace;
          color: #fff; background: #383838;
          border: 1px solid transparent; border-radius: 5px; outline: none;
        }
        .text:hover { background: #444; }
        .text:focus { border-color: #0d99ff; }
      </style>
      <button class="swatch" title="打开色盘">
        <i style="background:${transparent ? 'transparent' : `rgba(${r},${g},${b},${a})`}"></i>
      </button>
      <input class="text" value="${transparent ? '' : formatColor(this.#rgba, this.#format)}"
             placeholder="transparent">`

    this.#shadow.querySelector('.text').addEventListener('change', e => {
      this.#commit(e.target.value.trim())
    })
  }

  #commit(next) {
    this.value = next
    this.dispatchEvent(new CustomEvent('vr-color', {
      bubbles: true, composed: true, detail: { value: next },
    }))
  }

  #toggle() {
    if (openInstance === this) return closePanel()
    closePanel()

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.setAttribute('data-visual-revise-ui', '')
    panel.style.cssText = `${PANEL_STYLE} width: 264px;`
    panel.innerHTML = pickerMarkup()

    document.body.appendChild(panel)
    this.#panel = panel

    const rect = this.getBoundingClientRect()
    const h = panel.offsetHeight
    panel.style.left = `${clamp(rect.left - 274, 8, innerWidth - 272)}px`
    panel.style.top = `${clamp(rect.top, 8, innerHeight - h - 8)}px`

    this.#picker = createPicker(panel, {
      format: this.#format,
      onChange: css => {
        this.#format = this.#picker.format
        this.#commit(css)
      },
    })
    this.#picker.set(this.value)

    this.setAttribute('data-open', '')
    openInstance = this
  }
}

customElements.define('vr-color', VrColor)
