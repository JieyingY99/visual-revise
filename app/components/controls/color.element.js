/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
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
      // 监听器挂在 host 上，事件跨出 shadow 边界时 e.target 会被 retarget 成
      // host 本身——host 上 closest('input') 永远是 null，于是点色值框也会
      // 弹出色盘，把刚要敲的框盖住。composedPath 才看得到 shadow 里的真实目标。
      if (e.composedPath().some(n => n?.tagName === 'INPUT')) return
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
          flex: none; box-sizing: border-box; padding: 0;
          width: 32px; height: 32px;
          border-radius: 5px; border: 1px solid #3d3d3d;
          position: relative; overflow: hidden; cursor: pointer;
          ${CHECKER}
        }
        .swatch i { position: absolute; inset: 0; }
        /* 色值与不透明度是两件事，各给一个框：
           把 alpha 编进色值串（#ff000080）既难读也难改——想把红色调淡一点，
           得先把十六进制的 80 算出来。分开之后两边都能单独敲。 */
        .fields {
          flex: 1; min-width: 0; display: flex; align-items: center;
          height: 32px; box-sizing: border-box; background: #383838; border-radius: 5px;
          border: 1px solid transparent;
        }
        .fields:hover { background: #444; }
        .fields:focus-within { border-color: #0d99ff; background: #383838; }
        .text, .alpha {
          min-width: 0; height: 100%; padding: 0 8px;
          font: 400 11px/1 ui-monospace, Menlo, monospace;
          color: #fff; background: transparent;
          border: none; outline: none;
        }
        .text { flex: 1; }
        .alpha { flex: none; width: 38px; text-align: right; padding-right: 2px; }
        .sep { flex: none; width: 1px; height: 16px; background: #4a4a4a; }
        .pct { flex: none; padding: 0 8px 0 3px; font-size: 10px; color: #6f6f6f; }
      </style>
      <button class="swatch" title="打开色盘">
        <i style="background:${transparent ? 'transparent' : `rgba(${r},${g},${b},${a})`}"></i>
      </button>
      <div class="fields">
        <input class="text" value="${transparent ? '' : formatColor({ ...this.#rgba, a: 1 }, this.#format)}"
               placeholder="transparent" title="色值">
        <i class="sep"></i>
        <input class="alpha" value="${Math.round(a * 100)}" title="不透明度（%）">
        <span class="pct">%</span>
      </div>`

    // 色值框只管颜色，alpha 由旁边那个框决定——否则在色值里敲一个不带 alpha
    // 的 #ff0000 会把已调好的不透明度悄悄重置回 100%
    this.#shadow.querySelector('.text').addEventListener('change', e => {
      const next = parseColor(e.target.value.trim())
      if (!next.valid) return this.#renderTrigger()
      this.#commitParts(next, this.#rgba.a)
    })

    this.#shadow.querySelector('.alpha').addEventListener('change', e => {
      const pct = parseFloat(e.target.value)
      if (!Number.isFinite(pct)) return this.#renderTrigger()
      this.#commitParts(this.#rgba, clamp(pct, 0, 100) / 100)
    })
  }

  // 把颜色和不透明度合成一个 CSS 值再提交。alpha 为 1 时不写 rgba(...)，
  // 保持 #rrggbb 这种更常见、也更好读的形态。
  #commitParts({ r, g, b }, a) {
    this.#commit(formatColor({ r, g, b, a: clamp(a, 0, 1) }, this.#format))
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

    this.#picker = createPicker(panel, {
      format: this.#format,
      onChange: css => {
        this.#format = this.#picker.format
        this.#commit(css)
      },
    })

    // 定位放在 createPicker 之后：它要用 panel.offsetHeight 把弹层夹回视口内，
    // 而在内容铺开之前那还是个空壳，量出来接近 0，夹了等于没夹——
    // 弹层就会从屏幕底部漏出去。
    const rect = this.getBoundingClientRect()
    const w = panel.offsetWidth || 272
    const h = panel.offsetHeight
    panel.style.left = `${clamp(rect.left - w - 2, 8, Math.max(8, innerWidth - w - 8))}px`
    panel.style.top = `${clamp(rect.top, 8, Math.max(8, innerHeight - h - 8))}px`
    this.#picker.set(this.value)

    this.setAttribute('data-open', '')
    openInstance = this
  }
}

customElements.define('vr-color', VrColor)
