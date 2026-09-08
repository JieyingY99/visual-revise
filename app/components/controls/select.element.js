/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 自定义下拉：原生 <select> 的弹出层由系统绘制，无法定制样式，
// 在深色浮层里显示为系统浅色菜单，与整体割裂。
// 弹出面板挂到 body 而非 shadow 内——面板本身有 overflow: auto，
// 放在里面会被裁掉。
import { mountPopover, visibleSize, popoverBounds } from './popover-host.js'

const PANEL_ID = 'visual-revise-select-panel'

const PANEL_CSS = `
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
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

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// preview="border" 时每个选项前画一段线：用 border-top 让浏览器自己渲染
// solid / dashed / dotted / double（double 要 3px 才画得出两条），
// 看一眼就知道选的是什么，比读 dashed 这个词快。none 留一段空白占位对齐
const linePreview = (kind, val, width) => {
  if (kind !== 'border') return ''
  const style = val === 'none'
    ? 'border-top:0'
    : `border-top:${val === 'double' ? 3 : 2}px ${esc(val)} currentColor`
  return `<i data-line="${esc(val)}" style="flex:none;display:inline-block;width:${width}px;height:0;${style}"></i>`
}

let openInstance = null
// 当前打开的下拉里的选项（{ el, pick }）与键盘高亮的下标。
// 鼠标悬停和上下键改的是同一个下标，Enter 选的就是高亮的那一项。
let items = []
let active = -1

const highlight = i => {
  if (!items.length) return
  active = (i + items.length) % items.length
  items.forEach(({ el, isCurrent }, k) => {
    // 当前值那一项始终是蓝底，其余只有高亮的那一项有浅底
    el.style.background = isCurrent ? '#0d99ff' : k === active ? 'rgb(255 255 255 / .09)' : 'transparent'
  })
  items[active].el.scrollIntoView({ block: 'nearest' })
}

// 上下键在下拉里移动、Enter 选中。字体列表几百项，没有键盘只能拖滚动条一个个找。
addEventListener('keydown', e => {
  if (!openInstance || !items.length) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation()
    highlight(active + (e.key === 'ArrowDown' ? 1 : -1))
  } else if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation()
    items[active]?.pick()
  }
}, true)

const closePanel = () => {
  items = []; active = -1
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

// 页面或面板滚动时关掉：锚点跟着走了，下拉留在原地就成了孤儿。
// 但下拉自己内部的滚动不算——字体列表有几百项、自带滚动条，
// 一滚就关等于永远只能选到最上面几个。跟 menu.js 那条是同一个坑。
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

addEventListener('scroll', e => {
  const panel = document.getElementById(PANEL_ID)
  if (panel && e.target instanceof Node && panel.contains(e.target)) return
  closePanel()
}, true)
addEventListener('resize', () => closePanel())

export class VrSelect extends HTMLElement {
  #shadow

  static get observedAttributes() { return ['value', 'options', 'preview'] }

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
          height: 32px;
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
        .label { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; }
        .label > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .caret { flex: none; width: 8px; height: 8px; opacity: .55;
          background: currentColor;
          clip-path: polygon(15% 32%, 50% 68%, 85% 32%, 78% 25%, 50% 54%, 22% 25%); }
      </style>
      <div class="trigger">
        <span class="label">${linePreview(this.getAttribute('preview'), this.value, 20)}<span>${esc(this.#label())}</span></span>
        <span class="caret"></span>
      </div>`
  }

  #toggle() {
    if (openInstance === this) return closePanel()
    closePanel()

    const { host: panel, root } = mountPopover(PANEL_ID, PANEL_CSS)

    const current = this.value
    items = []
    this.options.forEach((opt, i) => {
      const [val, label] = Array.isArray(opt) ? opt : [opt, opt]
      const item = document.createElement('div')
      // 行在 shadow root 里，外面按 [data-item] 找（`>` 子代选择器不跨 shadow）
      item.dataset.item = String(val)
      item.style.cssText = OPTION_CSS + 'gap:12px;'
      item.innerHTML = linePreview(this.getAttribute('preview'), val, 24) + `<span>${esc(label)}</span>`

      const pick = () => {
        closePanel()
        this.value = val
        this.dispatchEvent(new CustomEvent('vr-select', {
          bubbles: true, composed: true, detail: { value: val },
        }))
      }
      item.addEventListener('pointerenter', () => highlight(i))
      item.addEventListener('click', e => { e.stopPropagation(); pick() })

      items.push({ el: item, pick, isCurrent: val === current })
      root.appendChild(item)
    })
    // 键盘起点落在当前值上，没有当前值就从第一项开始
    highlight(Math.max(0, items.findIndex(x => x.isCurrent)))

    // 定位：默认贴在触发器下方，空间不足时向上翻。
    //
    // minWidth 要先写：它会把面板撑宽，之后的左右夹取才量得到真实宽度。
    // rect 来自触发器，而触发器活在被 placement.js 缩了 1/k 的属性面板里，
    // 所以 rect.width 已经是「缩过的屏幕宽」；minWidth 落在弹层宿主的布局盒上，
    // 宿主随后又会被 popover-host 缩一次 1/k——直接写 rect.width 等于缩了两次，
    // 屏幕上的下拉恒比触发器窄 k 倍。写回布局宽 rect.width × k 才与触发器同宽。
    // 下限保住 PANEL_CSS 的 min-width:160px，免得触发器很窄时把设计下限顶掉。
    const rect = this.getBoundingClientRect()
    const { k } = visibleSize(panel)
    panel.style.minWidth = `${Math.max(160, rect.width * k)}px`

    // 尺寸一律用可见尺寸（offsetWidth/k），别拿没缩过的布局盒去配缩过的视口坐标
    const { w, h } = visibleSize(panel)
    const b = popoverBounds()

    panel.style.left = `${Math.max(b.minLeft, Math.min(rect.left, b.maxLeft(w)))}px`
    const below = b.below(rect.bottom)
    panel.style.top = below >= h + 12 || below >= rect.top
      ? `${rect.bottom + 6}px`
      : `${Math.max(b.minTop, rect.top - h - 6)}px`

    this.setAttribute('data-open', '')
    openInstance = this
  }
}

customElements.define('vr-select', VrSelect)
