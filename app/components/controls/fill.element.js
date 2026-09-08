/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
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

import { mountPopover, visibleSize, popoverBounds } from './popover-host.js'
import { renderPageColors } from './page-colors.js'
import { renderVariableList } from './color-popover.js'

const PANEL_ID = 'visual-revise-fill-panel'
const SIBLING_PANELS = ['visual-revise-select-panel', 'visual-revise-color-panel',
  'visual-revise-menu']

let openInstance = null

const closePanel = () => {
  document.getElementById(PANEL_ID)?.remove()
  openInstance?.removeAttribute('data-open')
  openInstance = null
}

// Esc 关掉弹层。面板那边的 Esc 分支只是「有弹层时把这一下让给弹层」，
// 让完之后并没有人接手——焦点在弹层的输入框里时 Esc 毫无作用；焦点在
// 别处时则一路走到「取消选中」，面板整个收起、弹层跟着被动消失，看着像
// 关了其实是选中没了。stopPropagation 是必须的，不拦住就会继续走到取消选中。
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !document.getElementById(PANEL_ID)) return
  e.preventDefault()
  e.stopPropagation()
  closePanel()
}, true)

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
  image: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="1.3" stroke-linejoin="round">
    <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.6"/>
    <path d="M2.6 10.6 5.8 7.8l2.6 2.3 2.2-1.8 2.8 2.4"/>
    <circle cx="10.4" cy="6.4" r="1" fill="currentColor" stroke="none"/></svg>`,
  swap: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.5 5.5h11l-2.5-2.5"/><path d="M13.5 10.5h-11l2.5 2.5"/></svg>`,
  minus: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="1.4" stroke-linecap="round"><path d="M3.5 8h9"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>`,
}

// 视频这一格 Figma 有、CSS 没有：background-image 收下 url(x.mp4) 的语法但
// 解不出画面，element() 只有 Firefox 认。要做只能往元素里插 <video> 子层，
// 那就不是改样式而是改 DOM 结构了，所以这里只有四格里的三格。
const TABS = [
  ['none', '无', ICON.none],
  ['solid', '纯色', ICON.solid],
  ['gradient', '渐变', ICON.gradient],
  ['image', '图片', ICON.image],
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
  #panel = null   // shadow root，内容都在这里
  #host = null    // 宿主盒子，定位用
  #picker = null
  #tab = 'none'
  #page = 'custom'      // Custom（无 / 纯色 / 渐变 / 图片）还是「变量」
  #grad = null          // 渐变编辑中的模型
  #stop = 0             // 当前选中的色标下标
  #format = 'Hex'

  // 由面板在 render 之后挂上：() => ({ variables, others })。
  // 变量列表几十项，走属性会被序列化进每一个控件、还会触发一次整块重建
  variablesProvider = null
  #pageColors = null   // 本次打开扫到的页面颜色，切 tab 回来复用

  // bound 是每层一个短字符串（变量名），走属性没有列表那份代价，
  // 而且面板重绘时它得跟着层一起更新
  static get observedAttributes() { return ['color', 'image', 'bound'] }

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
  // 这一层的填充绑在哪个 CSS 变量上（没绑就是空串）
  get bound() { return this.getAttribute('bound') || '' }

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
    // 绑了变量的层：触发行整块换成 chip（圆点 + 变量名）。绑了变量色值就不该
    // 在这里改，要改是去改那个变量；点它开的还是本控件的弹层，只不过停在变量页。
    if (this.bound) return this.#renderChip()

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
        :host { display: flex; gap: 4px; align-items: center; cursor: pointer; }
        .swatch {
          flex: none; box-sizing: border-box;
          width: 32px; height: 32px; border-radius: 5px; border: 1px solid #3d3d3d;
          position: relative; overflow: hidden; ${CHECKER}
        }
        .swatch i { position: absolute; inset: 0; background-size: cover; }
        .label {
          flex: 1; min-width: 0; height: 32px; box-sizing: border-box; display: flex; align-items: center; padding: 0 8px;
          font: 400 11px/1 ui-monospace, Menlo, monospace; color: #fff;
          background: #383838; border-radius: 5px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        :host(:hover) .label { background: #444; }

        /* 下面这一段跟 vr-color 的触发行是同一套尺寸和配色，故意逐条对齐：
           两个控件在面板里上下相邻，差一个像素都看得出来 */
        .fields {
          flex: 1; min-width: 0; display: flex; align-items: center;
          height: 32px; box-sizing: border-box; background: #383838; border-radius: 5px;
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

  // 跟面板里文字色 / 描边色的 chip 逐条对齐：同样的高度、底色、圆点尺寸。
  // 三处 chip 上下相邻，差一个像素都看得出来。
  #renderChip() {
    this.#shadow.innerHTML = `
      <style>
        :host { display: flex; gap: 4px; align-items: center; cursor: pointer; }
        .var-chip {
          flex: 1 1 auto; min-width: 0;
          display: flex; align-items: center; gap: 8px;
          height: 32px; padding: 0 10px; box-sizing: border-box;
          background: #383838; border-radius: 5px;
        }
        :host(:hover) .var-chip { background: #444; }
        .var-dot {
          flex: none; width: 16px; height: 16px; border-radius: 50%;
          border: 1px solid rgb(255 255 255 / .18);
        }
        .var-name {
          flex: 1; min-width: 0;
          font: 400 11px/1 ui-monospace, Menlo, monospace; color: #fff;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
      </style>
      <span class="var-chip" role="button" title="绑定到 ${this.bound}（点击换绑）">
        <span class="var-dot"></span>
        <span class="var-name"></span>
      </span>`

    // 颜色和变量名都来自页面，走属性赋值而不是拼进 HTML
    this.#shadow.querySelector('.var-dot').style.background = this.color || 'transparent'
    this.#shadow.querySelector('.var-name').textContent = this.bound
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

  // 面板的分区标题栏「绑定变量」要能直接打开这一层的变量页。弹层是实例方法、
  // 状态全挂在实例上，模块外只有这一个入口进得来。
  openVariables() {
    if (openInstance === this) closePanel()
    this.#toggle('variable')
  }

  // ── 弹层 ────────────────────────────────────────────────
  #toggle(page) {
    if (openInstance === this) return closePanel()
    closePanel()

    const kind = this.#kind
    this.#tab = kind === 'image' ? 'solid' : kind
    this.#grad = parseGradient(this.image) || null
    this.#stop = 0
    // 打开时按当前状态停页：绑着变量就直接看到变量页并勾着当前项
    this.#page = page || (this.bound ? 'variable' : 'custom')
    this.#pageColors = null   // 每次打开重扫一次页面

    // 宿主是盒子（定位、滚动），内容在它的 shadow root 里，页面 CSS 碰不到
    const { host, root } = mountPopover(PANEL_ID, `${PANEL_STYLE} width: 264px;
      max-height: min(560px, calc(100vh - 32px)); overflow: auto;`)
    // data-page 跟填充自己那排 data-tab 分开：两排标签在同一个选择器空间里
    // 会互相串，测试和样式都分不清点的是哪一排
    root.innerHTML = `
      <div class="pages" style="display:flex;gap:2px;padding:2px;background:#2a2a2a;border-radius:7px"></div>
      <div class="page" style="margin-top:12px"></div>`

    this.#host = host
    this.#panel = root

    // 先铺内容再定位：定位要用 panel.offsetHeight 把弹层夹回视口内，
    // 而此刻它还是个空壳，量出来接近 0，夹了等于没夹。
    this.#renderPages()
    this.#renderPage()
    this.#place()

    this.setAttribute('data-open', '')
    openInstance = this
  }

  #renderPages() {
    const pages = this.#panel.querySelector('.pages')
    // 已绑定的层只给变量列表，不出两页：绑了变量，色值就不该在这里改，
    // 要改颜色先 unlink。整排藏掉而不是禁用，免得留一排点不动的按钮。
    if (this.bound) {
      pages.innerHTML = ''
      pages.style.display = 'none'
      return
    }
    // 容器的 flex 写在行内样式里，清空 display 会把它一起清掉、两页竖着排
    pages.style.display = 'flex'
    pages.innerHTML = [['custom', '自定义'], ['variable', '变量']].map(([id, label]) =>
      `<button data-page="${id}" style="${S.tabBtn}${id === this.#page
        ? ';background:#454545;color:#fff' : ''}">${label}</button>`).join('')

    pages.querySelectorAll('[data-page]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.#page = btn.dataset.page
        this.#renderPages()
        this.#renderPage()
        this.#place()
      }))
  }

  #renderPage() {
    const page = this.#panel.querySelector('.page')

    if (this.#page === 'variable') {
      // 渐变和图片层绑不了变量：CSS 里能写 var()，但读回来时层解析认不出它
      // 属于哪一层，绑定活不过一次编辑。给一个点了没反应的列表比不给更糟。
      if (this.#kind === 'gradient' || this.#kind === 'image') {
        page.innerHTML = `<div style="padding:14px 8px;text-align:center;color:#8c8c8c;line-height:1.6">
          渐变和图片层不能绑定变量</div>`
        return
      }
      const { variables = null, others = 0 } = this.variablesProvider?.() || {}
      renderVariableList(page, {
        variables: variables || [], others, bound: this.bound,
        onPick: name => {
          closePanel()
          // 层下标面板从 e.currentTarget.dataset.layer 取，事件里不带——
          // 多一个来源就多一处可能对不上
          this.dispatchEvent(new CustomEvent('vr-fill-variable', {
            bubbles: true, composed: true, detail: { name },
          }))
        },
      })
      return
    }

    page.innerHTML = `
      <div class="tabs" style="display:flex;gap:2px;padding:2px;background:#2a2a2a;border-radius:7px"></div>
      <div class="body" style="margin-top:12px"></div>`
    this.#renderTabs()
    this.#renderBody()
  }

  // 内容一变高就得重新夹一次。切到「渐变」会多出一整排色标编辑，
  // 打开时算好的位置到那时早就把弹层顶出屏幕底部了。
  #place() {
    const panel = this.#host
    if (!panel) return
    // 宿主被 popover-host 加了 scale(1/k)：offsetWidth/offsetHeight 是缩之前的
    // 布局盒，而 rect 是缩过的视口坐标。夹取要用屏幕上真正占的可见尺寸
    // （offsetWidth/k），否则 k≠1 时右下两边各多留 w·(1−1/k) / h·(1−1/k) 的空。
    // 视口边界走 popoverBounds()（viewportBox()），捏合放大时才夹得住。
    const rect = this.getBoundingClientRect()
    const { w, h } = visibleSize(panel, { w: 272 })
    const b = popoverBounds()
    panel.style.left = `${clamp(rect.left - w - 2, b.minLeft, b.maxLeft(w))}px`
    panel.style.top = `${clamp(rect.top, b.minTop, b.maxTop(h))}px`
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

    // 切到图片标签不写任何东西：这一层现在是什么就还是什么，
    // 等用户真的选了一张图再改。跟纯色标签的 keepImage 是同一个道理。
    if (this.#tab === 'image') return

    this.#commit(null, serializeGradient(this.#ensureGradient()))
  }

  // ── 图片 ────────────────────────────────────────────────
  #renderImage(body) {
    const url = !isNone(this.image) && !parseGradient(this.image) ? this.image : ''
    const preview = url
      ? `<div style="height:150px;border-radius:8px;overflow:hidden;${CHECKER}">
           <div style="width:100%;height:100%;background:${url} center/cover no-repeat"></div>
         </div>`
      : `<div style="height:150px;border-radius:8px;display:grid;place-items:center;${CHECKER}">
           <span style="font-size:11px;color:#8a8a8a">还没有图片</span>
         </div>`

    body.innerHTML = `
      ${preview}
      <button class="pick" style="width:100%;margin-top:10px;height:32px;border:none;border-radius:6px;
        background:#0d99ff;color:#fff;font-size:12px;cursor:pointer">从电脑上传</button>`

    // 选图要读本地文件、还要进改动记录的素材表，那是面板那边的事。
    // 控件只负责说一句「用户想换图」，具体怎么读、存到哪由外面决定。
    body.querySelector('.pick').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('vr-fill-pick-image', { bubbles: true, composed: true }))
    })
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
    if (this.#tab === 'image') return this.#renderImage(body)
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

    // 色盘下面：页面上出现过的颜色。弹层开着期间只扫一次
    this.#pageColors = renderPageColors(body, {
      colors: this.#pageColors,
      onPick: css => {
        this.#picker.set(css)
        this.#commit(css, 'none')
      },
    })
  }

  // ── 渐变 ────────────────────────────────────────────────
  #renderGradient(body) {
    const g = this.#ensureGradient()
    this.#stop = clamp(this.#stop, 0, g.stops.length - 1)

    const angleRow = g.type === 'radial' ? '' : `
      <div style="display:flex;gap:4px;align-items:center;margin-top:8px">
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
      // 输入框在 shadow root 里，document.activeElement 只看得到宿主
      const focused = this.#panel.activeElement
      if (focused !== pos) pos.value = round(s.pos)
      if (focused !== hex) hex.value = s.color
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
