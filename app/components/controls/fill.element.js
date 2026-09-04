// 填充控件：把 background-color 与 background-image 合成一个入口，
// 点开是带标签栏的弹层 —— 无 / 纯色 / 渐变。
//
// CSS 里「填充」是两个属性叠出来的：background-image 画在 background-color 上面。
// 所以：
//   无   → color: transparent + image: none
//   纯色 → 写 color，并清掉 image（否则渐变或图片会盖住刚选的颜色）
//   渐变 → 只写 image，不动 color（透明色标下面透出来的就是它，这是 CSS 的本意）

import {
  CHECKER, PANEL_STYLE, clamp, parseColor, formatColor,
  pickerMarkup, createPicker,
} from './picker.js'
import {
  parseGradient, serializeGradient, setAngle, setType,
  reverseStops, createGradient, stopsPreview, TYPE_LABELS,
} from '../../core/gradient.js'

const PANEL_ID = 'visual-revise-fill-panel'
const SIBLING_PANELS = ['visual-revise-select-panel', 'visual-revise-color-panel']

let openInstance = null

const closePanel = () => {
  document.getElementById(PANEL_ID)?.remove()
  openInstance?.removeAttribute('data-open')
  openInstance = null
}

document.addEventListener('pointerdown', e => {
  if (!openInstance) return
  const path = e.composedPath?.() || []
  // 弹层里还会再开下拉和色盘，它们挂在 body 上、不在本弹层的 DOM 里
  if (path.some(n => n === openInstance || n?.id === PANEL_ID || SIBLING_PANELS.includes(n?.id))) return
  closePanel()
}, true)

const round = n => Math.round(n * 100) / 100

const ICON = {
  none: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3">
    <circle cx="8" cy="8" r="5.6"/><path d="M4.2 11.8 11.8 4.2"/></svg>`,
  solid: `<svg viewBox="0 0 16 16" width="13" height="13"><rect x="2.6" y="2.6" width="10.8" height="10.8"
    rx="2.2" fill="currentColor"/></svg>`,
  gradient: `<svg viewBox="0 0 16 16" width="13" height="13">
    <defs><linearGradient id="vrg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="currentColor" stop-opacity="1"/>
      <stop offset="1" stop-color="currentColor" stop-opacity=".15"/>
    </linearGradient></defs>
    <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2.2" fill="url(#vrg)"/></svg>`,
  swap: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.5 5.5h11l-2.5-2.5"/><path d="M13.5 10.5h-11l2.5 2.5"/></svg>`,
  minus: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="1.4" stroke-linecap="round"><path d="M3.5 8h9"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>`,
}

const TABS = [
  ['none', '无', ICON.none],
  ['solid', '纯色', ICON.solid],
  ['gradient', '渐变', ICON.gradient],
]

const isNone = v => !v || String(v).trim() === 'none'

// 在渐变的某个位置上取插值颜色——点击色标条新增色标时用，
// 新色标要接上原来那条线，而不是凭空冒出一个别的颜色
const mixAt = (stops, pos) => {
  const sorted = stops.slice().sort((a, b) => a.pos - b.pos)
  const before = sorted.filter(s => s.pos <= pos).pop() || sorted[0]
  const after = sorted.find(s => s.pos >= pos) || sorted[sorted.length - 1]

  const c1 = parseColor(before.color)
  const c2 = parseColor(after.color)
  if (!c1.valid || !c2.valid) return before.color

  const span = after.pos - before.pos
  const t = span ? (pos - before.pos) / span : 0
  const at = k => Math.round(c1[k] + (c2[k] - c1[k]) * t)

  return formatColor({ r: at('r'), g: at('g'), b: at('b'), a: round(c1.a + (c2.a - c1.a) * t) }, 'Hex')
}

const S = {
  tabBtn: `flex:1;display:flex;align-items:center;justify-content:center;gap:5px;height:26px;
    font:400 11px/1 -apple-system,system-ui,sans-serif;color:#9b9b9b;background:transparent;
    border:none;border-radius:5px;cursor:pointer`,
  // min-width:0 不能省：flex 子项的 min-width 默认是 auto，会取 input 自己的
  // 固有最小宽度（约 20 个字符宽），把 flex-basis 直接顶掉，整行撑出面板
  field: `height:28px;min-width:0;padding:0 8px;font:400 11px/1 ui-monospace,Menlo,monospace;color:#fff;
    background:#383838;border:1px solid transparent;border-radius:5px;outline:none`,
  iconBtn: `width:28px;height:28px;display:grid;place-items:center;color:#9b9b9b;background:transparent;
    border:none;border-radius:5px;cursor:pointer;flex:none`,
}

export class VrFill extends HTMLElement {
  #shadow
  #panel = null
  #picker = null
  #tab = 'none'
  #grad = null          // 渐变编辑中的模型
  #stop = 0             // 当前选中的色标下标
  #format = 'Hex'

  static get observedAttributes() { return ['color', 'image'] }

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.setAttribute('data-visual-revise-ui', '')
    this.#renderTrigger()
    this.addEventListener('click', e => {
      // 在 host 上监听时 e.target 会被 retarget 成 host 本身，shadow 里到底
      // 点在哪个元素上要靠 composedPath 才看得到
      if (e.composedPath().some(n => n?.tagName === 'INPUT')) return
      this.#toggle()
    })
  }

  disconnectedCallback() { if (openInstance === this) closePanel() }

  attributeChangedCallback() {
    if (this.#shadow.firstChild) this.#renderTrigger()
  }

  get color() { return this.getAttribute('color') || '' }
  get image() { return this.getAttribute('image') || '' }

  // 当前值落在哪个标签上
  get #kind() {
    if (parseGradient(this.image)) return 'gradient'
    if (!isNone(this.image)) return 'image'      // url(...)：本控件不编辑，交给「背景图」字段
    const c = parseColor(this.color)
    return !c.valid || c.a === 0 ? 'none' : 'solid'
  }

  #summary() {
    const kind = this.#kind
    if (kind === 'gradient') {
      const g = parseGradient(this.image)
      return `${TYPE_LABELS.find(([t]) => t === g.type)?.[1] || g.type}渐变 · ${g.stops.length} 档`
    }
    if (kind === 'image') return '背景图'
    if (kind === 'none') return '无填充'
    const c = parseColor(this.color)
    return formatColor(c, 'Hex')
  }

  #preview() {
    const kind = this.#kind
    if (kind === 'gradient') return stopsPreview(parseGradient(this.image).stops)
    if (kind === 'image') return this.image
    if (kind === 'none') return 'transparent'
    return this.color
  }

  #renderTrigger() {
    const solid = this.#kind === 'solid'
    const c = solid ? parseColor(this.color) : null

    // 纯色态下这个控件跟「文字色」（vr-color）表示的是同一种东西——一个颜色，
    // 就该长一样、也一样能直接敲：色值一个框、不透明度一个框。
    // 另外三态没有单一色值可填（「无填充」没有值，渐变是一串色标，背景图是张图），
    // 那时才退回只读摘要，编辑交给点开的弹层。
    const fields = solid
      ? `<div class="fields">
           <input class="text" value="${formatColor({ ...c, a: 1 }, this.#format)}" title="色值">
           <i class="sep"></i>
           <input class="alpha" value="${Math.round(c.a * 100)}" title="不透明度（%）">
           <span class="pct">%</span>
         </div>`
      : `<span class="label">${this.#summary()}</span>`

    this.#shadow.innerHTML = `
      <style>
        :host { display: flex; gap: 6px; align-items: center; cursor: pointer; }
        .swatch {
          flex: none; box-sizing: border-box;
          width: 30px; height: 30px; border-radius: 5px; border: 1px solid #3d3d3d;
          position: relative; overflow: hidden; ${CHECKER}
        }
        .swatch i { position: absolute; inset: 0; background-size: cover; }
        .label {
          flex: 1; min-width: 0; height: 30px; display: flex; align-items: center; padding: 0 8px;
          font: 400 11px/1 ui-monospace, Menlo, monospace; color: #fff;
          background: #383838; border-radius: 5px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        :host(:hover) .label { background: #444; }

        /* 下面这一段跟 vr-color 的触发行是同一套尺寸和配色，故意逐条对齐：
           两个控件在面板里上下相邻，差一个像素都看得出来 */
        .fields {
          flex: 1; min-width: 0; display: flex; align-items: center;
          height: 30px; background: #383838; border-radius: 5px;
          border: 1px solid transparent;
        }
        :host(:hover) .fields { background: #444; }
        .fields:focus-within { border-color: #0d99ff; background: #383838; }
        .text, .alpha {
          min-width: 0; height: 100%; padding: 0 8px;
          font: 400 11px/1 ui-monospace, Menlo, monospace;
          color: #fff; background: transparent;
          border: none; outline: none; cursor: text;
        }
        .text { flex: 1; }
        .alpha { flex: none; width: 38px; text-align: right; padding-right: 2px; }
        .sep { flex: none; width: 1px; height: 16px; background: #4a4a4a; }
        .pct { flex: none; padding: 0 8px 0 3px; font-size: 10px; color: #6f6f6f; }
      </style>
      <span class="swatch" title="打开填充"><i style="background:${this.#preview()}"></i></span>
      ${fields}`

    if (solid) this.#bindFields(c)
  }

  #bindFields(c) {
    const $ = sel => this.#shadow.querySelector(sel)

    // 色值框只管颜色，alpha 由旁边那个框决定——否则在色值里敲一个不带 alpha 的
    // #ff0000 会把已经调好的不透明度悄悄重置回 100%
    $('.text').addEventListener('change', e => {
      const next = parseColor(e.target.value.trim())
      if (!next.valid) return this.#renderTrigger()
      this.#commitParts(next, c.a)
    })

    $('.alpha').addEventListener('change', e => {
      const pct = parseFloat(e.target.value)
      if (!Number.isFinite(pct)) return this.#renderTrigger()
      this.#commitParts(c, clamp(pct, 0, 100) / 100)
    })
  }

  // 纯色提交要连带清掉 image：CSS 里 background-image 画在 background-color 上面，
  // 不清的话刚敲进去的颜色会被原来的渐变或图片整个盖住（见文件顶部那三条规则）
  #commitParts({ r, g, b }, a) {
    this.#commit(formatColor({ r, g, b, a: clamp(a, 0, 1) }, this.#format), 'none')
  }

  #commit(color, image) {
    this.dispatchEvent(new CustomEvent('vr-fill', {
      bubbles: true, composed: true, detail: { color, image },
    }))
  }

  // ── 弹层 ────────────────────────────────────────────────
  #toggle() {
    if (openInstance === this) return closePanel()
    closePanel()

    const kind = this.#kind
    this.#tab = kind === 'image' ? 'solid' : kind
    this.#grad = parseGradient(this.image) || null
    this.#stop = 0

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.setAttribute('data-visual-revise-ui', '')
    panel.style.cssText = `${PANEL_STYLE} width: 264px;
      max-height: min(560px, calc(100vh - 32px)); overflow: auto;`
    panel.innerHTML = `
      <div class="tabs" style="display:flex;gap:2px;padding:2px;background:#2a2a2a;border-radius:7px"></div>
      <div class="body" style="margin-top:12px"></div>`

    document.body.appendChild(panel)
    this.#panel = panel

    // 先铺内容再定位：定位要用 panel.offsetHeight 把弹层夹回视口内，
    // 而此刻它还是个空壳，量出来接近 0，夹了等于没夹。
    this.#renderTabs()
    this.#renderBody()
    this.#place()

    this.setAttribute('data-open', '')
    openInstance = this
  }

  // 内容一变高就得重新夹一次。切到「渐变」会多出一整排色标编辑，
  // 打开时算好的位置到那时早就把弹层顶出屏幕底部了。
  #place() {
    const panel = this.#panel
    if (!panel) return
    const rect = this.getBoundingClientRect()
    const w = panel.offsetWidth || 272
    const h = panel.offsetHeight
    panel.style.left = `${clamp(rect.left - w - 2, 8, Math.max(8, innerWidth - w - 8))}px`
    panel.style.top = `${clamp(rect.top, 8, Math.max(8, innerHeight - h - 8))}px`
  }

  #renderTabs() {
    const tabs = this.#panel.querySelector('.tabs')
    tabs.innerHTML = TABS.map(([id, label, icon]) => {
      const on = id === this.#tab
      return `<button data-tab="${id}" style="${S.tabBtn}${on
        ? ';background:#454545;color:#fff'
        : ''}">${icon}${label}</button>`
    }).join('')

    tabs.querySelectorAll('[data-tab]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.#tab = btn.dataset.tab
        this.#renderTabs()
        this.#renderBody()
        this.#applyTab()
        this.#place()
      }))
  }

  // 新建渐变时拿元素当前的填充色做第一档，比凭空给两个灰更接得上
  #ensureGradient() {
    if (!this.#grad) {
      const c = parseColor(this.color)
      this.#grad = createGradient(c.valid && c.a > 0 ? formatColor(c, 'Hex') : null)
    }
    return this.#grad
  }

  // 切标签即写入，和 Figma 一样：选了「无」马上就没了，不用再确认一次
  #applyTab() {
    if (this.#tab === 'none') return this.#commit('transparent', 'none')

    if (this.#tab === 'solid') {
      const c = parseColor(this.color)
      const color = c.valid && c.a > 0 ? formatColor(c, this.#format) : '#c4c4c4'

      // 元素上挂着 url() 背景图时，光是切到这个标签还不动它——
      // 只是点进来看看就把人家的背景图清掉太狠了。等真的选了颜色再清。
      const keepImage = !isNone(this.image) && !parseGradient(this.image)
      return this.#commit(color, keepImage ? null : 'none')
    }

    this.#commit(null, serializeGradient(this.#ensureGradient()))
  }

  #renderBody() {
    const body = this.#panel.querySelector('.body')
    this.#picker = null

    if (this.#tab === 'none') {
      body.innerHTML = `<div style="padding:22px 8px;text-align:center;color:#8c8c8c;line-height:1.7">
        没有填充<br><span style="font-size:11px">background-color: transparent</span></div>`
      return
    }

    if (this.#tab === 'solid') return this.#renderSolid(body)
    this.#renderGradient(body)
  }

  // ── 纯色 ────────────────────────────────────────────────
  #renderSolid(body) {
    const warn = !isNone(this.image) && !parseGradient(this.image)
      ? `<div style="margin-bottom:10px;padding:8px 10px;background:#3a3320;border-radius:6px;
           color:#e8c46a;font-size:11px;line-height:1.5">
           当前有背景图，选定颜色后它会被清掉</div>`
      : ''

    body.innerHTML = warn + pickerMarkup()

    this.#picker = createPicker(body, {
      format: this.#format,
      onChange: css => {
        this.#format = this.#picker.format
        this.#commit(css, 'none')
      },
    })
    this.#picker.set(this.color || '#c4c4c4')
  }

  // ── 渐变 ────────────────────────────────────────────────
  #renderGradient(body) {
    const g = this.#ensureGradient()
    this.#stop = clamp(this.#stop, 0, g.stops.length - 1)

    const angleRow = g.type === 'radial' ? '' : `
      <div style="display:flex;gap:6px;align-items:center;margin-top:8px">
        <span style="flex:none;color:#8c8c8c">角度</span>
        <input class="angle" value="${round(g.angle)}" style="${S.field};flex:1;min-width:0">
        <button class="reverse" title="反转色标顺序" style="${S.iconBtn}">${ICON.swap}</button>
      </div>`

    body.innerHTML = `
      <div class="types" style="display:flex;gap:2px;padding:2px;background:#2a2a2a;border-radius:6px">
        ${TYPE_LABELS.map(([id, label]) => `<button data-type="${id}"
          style="${S.tabBtn}${id === g.type ? ';background:#454545;color:#fff' : ''}">${label}</button>`).join('')}
      </div>

      ${angleRow}

      <div class="bar" style="position:relative;height:26px;margin-top:12px;border-radius:6px;${CHECKER}">
        <div class="bar-fill" style="position:absolute;inset:0;border-radius:6px;cursor:copy"></div>
        <!-- 手柄层铺满整条，必须让点击穿过去，否则点空白处加色标会被它吃掉 -->
        <div class="handles" style="position:absolute;inset:0;pointer-events:none"></div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin:12px 0 6px">
        <span style="color:#8c8c8c">色标</span>
        <button class="add" title="新增色标" style="${S.iconBtn};width:22px;height:22px">${ICON.plus}</button>
      </div>
      <div class="stops" style="display:grid;gap:4px"></div>

      <div style="height:1px;background:#333;margin:12px 0"></div>
      <div class="pick">${pickerMarkup({ svHeight: 132 })}</div>`

    this.#bindGradient(body)
    this.#refreshGradient()

    this.#picker = createPicker(body.querySelector('.pick'), {
      format: this.#format,
      onChange: css => {
        this.#format = this.#picker.format
        this.#grad.stops[this.#stop].color = css
        this.#refreshGradient()
        this.#commit(null, serializeGradient(this.#grad))
      },
    })
    this.#picker.set(g.stops[this.#stop].color)
  }

  #emitGradient() {
    this.#refreshGradient()
    this.#commit(null, serializeGradient(this.#grad))
  }

  // 色标数量没变时一律原地改，不重建 DOM。两个原因：
  //   拖动中的手柄正捕获着指针，被重建掉就一拖即断；
  //   输入框被换掉会打断正在打字的人。
  #refreshGradient() {
    const panel = this.#panel
    const g = this.#grad
    if (!panel || !g) return

    const fill = panel.querySelector('.bar-fill')
    if (!fill) return
    fill.style.background = stopsPreview(g.stops)

    const handles = panel.querySelector('.handles')
    const rows = panel.querySelector('.stops')

    if (handles.children.length !== g.stops.length) {
      handles.innerHTML = g.stops.map((_, i) => `
        <button data-handle="${i}" style="position:absolute;top:50%;width:14px;height:14px;padding:0;
          border-radius:50%;cursor:ew-resize;pointer-events:auto;transform:translate(-50%,-50%);
          border:2px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / .45)"></button>`).join('')

      rows.innerHTML = g.stops.map((_, i) => `
        <div data-row="${i}" style="display:flex;min-width:0;gap:4px;align-items:center;padding:2px;border-radius:5px">
          <input data-pos="${i}" style="${S.field};flex:0 0 46px;text-align:center">
          <span style="flex:none;width:20px;height:20px;border-radius:4px;border:1px solid #3d3d3d;
            ${CHECKER}"><i style="display:block;width:100%;height:100%;border-radius:3px"></i></span>
          <input data-hex="${i}" style="${S.field};flex:1;min-width:0">
          <button data-del="${i}" title="删除色标"
            style="${S.iconBtn};width:22px;height:22px${g.stops.length <= 2 ? ';opacity:.3' : ''}"
            ${g.stops.length <= 2 ? 'disabled' : ''}>${ICON.minus}</button>
        </div>`).join('')

      this.#bindStopRows()
    }

    g.stops.forEach((s, i) => {
      const handle = handles.children[i]
      handle.style.left = `${round(s.pos)}%`
      handle.style.background = s.color
      handle.style.borderColor = i === this.#stop ? '#0d99ff' : '#fff'

      const row = rows.children[i]
      row.style.background = i === this.#stop ? 'rgb(13 153 255 / .16)' : ''
      row.querySelector('i').style.background = s.color

      const pos = row.querySelector('[data-pos]')
      const hex = row.querySelector('[data-hex]')
      if (document.activeElement !== pos) pos.value = round(s.pos)
      if (document.activeElement !== hex) hex.value = s.color
    })
  }

  #select(i) {
    this.#stop = i
    this.#refreshGradient()
    this.#picker?.set(this.#grad.stops[i].color)
  }

  #bindStopRows() {
    const panel = this.#panel

    panel.querySelectorAll('[data-handle]').forEach(h => {
      h.addEventListener('pointerdown', e => {
        e.preventDefault()
        e.stopPropagation()
        const i = +h.dataset.handle
        this.#select(i)

        const bar = panel.querySelector('.bar')
        const knob = panel.querySelector(`[data-handle="${i}"]`)
        knob.setPointerCapture(e.pointerId)

        const move = ev => {
          const r = bar.getBoundingClientRect()
          this.#grad.stops[i].pos = round(clamp((ev.clientX - r.left) / r.width, 0, 1) * 100)
          this.#emitGradient()
        }
        const up = ev => {
          knob.releasePointerCapture?.(ev.pointerId)
          knob.removeEventListener('pointermove', move)
          knob.removeEventListener('pointerup', up)
        }
        knob.addEventListener('pointermove', move)
        knob.addEventListener('pointerup', up)
      })
    })

    panel.querySelectorAll('[data-row]').forEach(row =>
      row.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return
        this.#select(+row.dataset.row)
      }))

    panel.querySelectorAll('[data-pos]').forEach(input =>
      input.addEventListener('change', e => {
        const i = +input.dataset.pos
        const n = parseFloat(e.target.value)
        if (!Number.isFinite(n)) return this.#refreshGradient()
        this.#grad.stops[i].pos = clamp(n, 0, 100)
        this.#emitGradient()
      }))

    panel.querySelectorAll('[data-hex]').forEach(input =>
      input.addEventListener('change', e => {
        const i = +input.dataset.hex
        if (!parseColor(e.target.value).valid) return this.#refreshGradient()
        this.#grad.stops[i].color = e.target.value.trim()
        this.#select(i)
        this.#commit(null, serializeGradient(this.#grad))
      }))

    panel.querySelectorAll('[data-del]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (this.#grad.stops.length <= 2) return
        this.#grad.stops.splice(+btn.dataset.del, 1)
        this.#stop = clamp(this.#stop, 0, this.#grad.stops.length - 1)
        this.#emitGradient()
        this.#picker?.set(this.#grad.stops[this.#stop].color)
      }))
  }

  #addStop(pos) {
    const at = clamp(round(pos), 0, 100)
    this.#grad.stops.push({ color: mixAt(this.#grad.stops, at), pos: at })
    this.#grad.stops.sort((a, b) => a.pos - b.pos)
    this.#stop = this.#grad.stops.findIndex(s => s.pos === at)
    this.#emitGradient()
    this.#picker?.set(this.#grad.stops[this.#stop].color)
  }

  #bindGradient(body) {
    body.querySelectorAll('[data-type]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.#grad = setType(this.#grad, btn.dataset.type)
        this.#renderGradient(body)
        this.#commit(null, serializeGradient(this.#grad))
      }))

    body.querySelector('.angle')?.addEventListener('change', e => {
      const n = parseFloat(e.target.value)
      if (!Number.isFinite(n)) return
      this.#grad = setAngle(this.#grad, n)
      e.target.value = round(this.#grad.angle)
      this.#commit(null, serializeGradient(this.#grad))
    })

    body.querySelector('.reverse')?.addEventListener('click', () => {
      this.#grad = reverseStops(this.#grad)
      this.#emitGradient()
      this.#picker?.set(this.#grad.stops[this.#stop].color)
    })

    // 点击色标条空白处新增一档，颜色取当前渐变在该位置的插值
    body.querySelector('.bar-fill').addEventListener('pointerdown', e => {
      const r = e.currentTarget.getBoundingClientRect()
      this.#addStop(((e.clientX - r.left) / r.width) * 100)
    })

    body.querySelector('.add').addEventListener('click', () => {
      const sorted = this.#grad.stops.slice().sort((a, b) => a.pos - b.pos)
      this.#addStop((sorted[0].pos + sorted[sorted.length - 1].pos) / 2)
    })
  }
}

customElements.define('vr-fill', VrFill)
