// ── 颜色换算 ──────────────────────────────────────────────
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const round = n => Math.round(n * 100) / 100

export const hsvToRgb = (h, s, v) => {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60  ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export const rgbToHsv = (r, g, b) => {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const d = max - min

  let h = 0
  if (d) {
    const [rr, gg, bb] = [r / 255, g / 255, b / 255]
    h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
    h = (h * 60 + 360) % 360
  }

  return [h, max ? d / max : 0, max]
}

const toHex = n => n.toString(16).padStart(2, '0')

// 解析任意 CSS 颜色：交给浏览器算，比手写正则可靠
export const parseColor = input => {
  const probe = document.createElement('div')
  probe.style.color = ''
  probe.style.color = String(input || '').trim()

  if (!probe.style.color) return { r: 0, g: 0, b: 0, a: 1, valid: false }

  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()

  const m = computed.match(/rgba?\(([^)]+)\)/)
  if (!m) return { r: 0, g: 0, b: 0, a: 1, valid: false }

  const [r, g, b, a = 1] = m[1].split(',').map(v => parseFloat(v))
  return { r, g, b, a, valid: true }
}

export const formatColor = ({ r, g, b, a }, format) => {
  if (format === 'RGB') return a < 1 ? `rgba(${r}, ${g}, ${b}, ${round(a)})` : `rgb(${r}, ${g}, ${b})`

  if (format === 'HSL') {
    const [h, s, v] = rgbToHsv(r, g, b)
    const l = v * (1 - s / 2)
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l)
    const parts = `${Math.round(h)}, ${Math.round(sl * 100)}%, ${Math.round(l * 100)}%`
    return a < 1 ? `hsla(${parts}, ${round(a)})` : `hsl(${parts})`
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(Math.round(a * 255)) : ''}`
}

// ── 色盘面板 ──────────────────────────────────────────────
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

const EYEDROPPER_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/>
  <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
</svg>`

const CHECKER = `
  background-image:
    linear-gradient(45deg, #6a6a6a 25%, transparent 25%, transparent 75%, #6a6a6a 75%),
    linear-gradient(45deg, #6a6a6a 25%, transparent 25%, transparent 75%, #6a6a6a 75%);
  background-size: 10px 10px;
  background-position: 0 0, 5px 5px;`

export class VrColor extends HTMLElement {
  #shadow
  #hsv = [0, 0, 0]
  #alpha = 1
  #format = 'Hex'
  #panel = null

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
    if (openInstance === this) this.#syncPanel()
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

    const { r, g, b, a } = this.#rgba
    this.#hsv = rgbToHsv(r, g, b)
    this.#alpha = a

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.setAttribute('data-visual-revise-ui', '')
    panel.style.cssText = `
      position: fixed; z-index: 2147483647; width: 264px; padding: 12px;
      background: #1e1e1e; border-radius: 12px;
      box-shadow: 0 10px 40px rgb(0 0 0 / .55), inset 0 0 0 1px rgb(255 255 255 / .07);
      font: 400 12px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #fff;`

    panel.innerHTML = `
      <div class="sv" style="position:relative;height:170px;border-radius:8px;cursor:crosshair;overflow:hidden">
        <div class="sv-thumb" style="position:absolute;width:14px;height:14px;border-radius:50%;
          border:2px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / .45);transform:translate(-50%,-50%);
          pointer-events:none"></div>
      </div>

      <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
        <button class="eye" title="从屏幕上取色"
          style="flex:none;width:28px;height:28px;display:grid;place-items:center;color:#b3b3b3;
                 background:transparent;border:none;border-radius:6px;cursor:pointer">${EYEDROPPER_ICON}</button>
        <div style="flex:1;display:grid;gap:10px">
          <div class="hue" style="position:relative;height:12px;border-radius:6px;cursor:pointer;
            background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)">
            <div class="hue-thumb" style="position:absolute;top:50%;width:16px;height:16px;border-radius:50%;
              border:2px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / .45);transform:translate(-50%,-50%);
              pointer-events:none"></div>
          </div>
          <div class="alpha" style="position:relative;height:12px;border-radius:6px;cursor:pointer;${CHECKER}">
            <div class="alpha-fill" style="position:absolute;inset:0;border-radius:6px"></div>
            <div class="alpha-thumb" style="position:absolute;top:50%;width:16px;height:16px;border-radius:50%;
              border:2px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / .45);transform:translate(-50%,-50%);
              pointer-events:none"></div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:6px;margin-top:12px;align-items:center">
        <vr-select class="format" value="${this.#format}"
          options='["Hex","RGB","HSL"]' style="flex:0 0 74px"></vr-select>
        <input class="val" style="flex:1;min-width:0;height:30px;padding:0 8px;
          font:400 11px/1 ui-monospace,Menlo,monospace;color:#fff;background:#383838;
          border:1px solid transparent;border-radius:5px;outline:none">
        <div style="flex:0 0 62px;display:flex;align-items:center;background:#383838;border-radius:5px;height:30px">
          <input class="alpha-val" style="width:100%;min-width:0;height:100%;padding:0 4px 0 8px;
            font:400 11px/1 -apple-system,system-ui,sans-serif;color:#fff;background:transparent;
            border:none;outline:none;text-align:right">
          <span style="padding:0 8px 0 2px;color:#8c8c8c">%</span>
        </div>
      </div>`

    document.body.appendChild(panel)
    this.#panel = panel

    const rect = this.getBoundingClientRect()
    const h = panel.offsetHeight
    panel.style.left = `${clamp(rect.left - 274, 8, innerWidth - 272)}px`
    panel.style.top = `${clamp(rect.top, 8, innerHeight - h - 8)}px`

    this.#bindPanel(panel)
    this.#syncPanel()

    this.setAttribute('data-open', '')
    openInstance = this
  }

  #syncPanel() {
    const panel = this.#panel
    if (!panel) return

    const [h, s, v] = this.#hsv
    const [r, g, b] = hsvToRgb(h, s, v)

    panel.querySelector('.sv').style.background =
      `linear-gradient(to top, #000, transparent),
       linear-gradient(to right, #fff, transparent),
       hsl(${h}, 100%, 50%)`

    panel.querySelector('.sv-thumb').style.left = `${s * 100}%`
    panel.querySelector('.sv-thumb').style.top = `${(1 - v) * 100}%`
    panel.querySelector('.sv-thumb').style.background = `rgb(${r},${g},${b})`

    panel.querySelector('.hue-thumb').style.left = `${(h / 360) * 100}%`
    panel.querySelector('.hue-thumb').style.background = `hsl(${h}, 100%, 50%)`

    panel.querySelector('.alpha-fill').style.background =
      `linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))`
    panel.querySelector('.alpha-thumb').style.left = `${this.#alpha * 100}%`
    panel.querySelector('.alpha-thumb').style.background = `rgba(${r},${g},${b},${this.#alpha})`

    const active = panel.querySelector('.val')
    if (document.activeElement !== active && active.getRootNode?.().activeElement !== active)
      active.value = formatColor({ r, g, b, a: this.#alpha }, this.#format)

    panel.querySelector('.alpha-val').value = Math.round(this.#alpha * 100)
  }

  #apply() {
    const [h, s, v] = this.#hsv
    const [r, g, b] = hsvToRgb(h, s, v)
    this.#commit(formatColor({ r, g, b, a: this.#alpha }, this.#format))
    this.#syncPanel()
  }

  #drag(el, onMove) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault()
      el.setPointerCapture(e.pointerId)

      const move = ev => {
        const r = el.getBoundingClientRect()
        onMove(clamp((ev.clientX - r.left) / r.width, 0, 1),
               clamp((ev.clientY - r.top) / r.height, 0, 1))
        this.#apply()
      }
      const up = ev => {
        el.releasePointerCapture(ev.pointerId)
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }

      move(e)
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    })
  }

  #bindPanel(panel) {
    this.#drag(panel.querySelector('.sv'), (x, y) => {
      this.#hsv = [this.#hsv[0], x, 1 - y]
    })
    this.#drag(panel.querySelector('.hue'), x => {
      this.#hsv = [x * 360, this.#hsv[1], this.#hsv[2]]
    })
    this.#drag(panel.querySelector('.alpha'), x => { this.#alpha = x })

    panel.querySelector('.format').addEventListener('vr-select', e => {
      this.#format = e.detail.value
      this.#apply()
    })

    panel.querySelector('.val').addEventListener('change', e => {
      const c = parseColor(e.target.value)
      if (!c.valid) return this.#syncPanel()
      this.#hsv = rgbToHsv(c.r, c.g, c.b)
      this.#alpha = c.a
      this.#apply()
    })

    panel.querySelector('.alpha-val').addEventListener('change', e => {
      this.#alpha = clamp(parseFloat(e.target.value) / 100 || 0, 0, 1)
      this.#apply()
    })

    const eye = panel.querySelector('.eye')
    if (!window.EyeDropper) {
      eye.disabled = true
      eye.style.opacity = '.35'
      eye.title = '当前浏览器不支持屏幕取色'
    } else {
      eye.addEventListener('click', async () => {
        try {
          const { sRGBHex } = await new EyeDropper().open()
          const c = parseColor(sRGBHex)
          if (!c.valid) return
          this.#hsv = rgbToHsv(c.r, c.g, c.b)
          this.#apply()
        } catch { /* 用户按 Esc 取消 */ }
      })
    }
  }
}

customElements.define('vr-color', VrColor)
