import { GROUPS, sameValue } from '../../core/tracked-props.js'
import {
  CONTROLS, SIDE_GROUPS, FIELD_PAIRS, FIELD_PREFIX,
  isRelevant, coerceLength, stepValue, stepSize, displayValue,
  alignSupported, alignPlan,
} from '../../core/controls.js'
import { ChangeStore } from '../../core/change-store.js'
import { readComputed, elementId } from '../../core/snapshot.js'
import { stableClasses } from '../../core/anchors.js'
import { findSharedElements, describeShared } from '../../core/shared-elements.js'
import { loadLocalFonts, isSupported as fontsSupported } from '../../core/local-fonts.js'
import { containScroll } from '../../core/dom-utils.js'
import '../controls/select.element.js'
import '../controls/color.element.js'
import { default as panel_css } from './props-panel.element.css'

const svg = (body, size = 14) =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor"
    stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

const ICON = {
  shared:   svg('<path d="M8 1.5 14.5 5 8 8.5 1.5 5 8 1.5Z"/><path d="M1.5 8 8 11.5 14.5 8"/>'),
  collapse: svg('<path d="M4 6.5 8 10.5l4-4"/>'),
  close:    svg('<path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"/>'),
  undo:     svg('<path d="M2.5 6.5h7.5a3.5 3.5 0 0 1 0 7H6.5"/><path d="M5.5 3.5 2.5 6.5l3 3"/>', 13),
  eye:      svg('<path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z"/><circle cx="8" cy="8" r="1.9"/>', 13),
  eyeOff:   svg('<path d="M2.5 2.5 13.5 13.5"/><path d="M6.6 6.7a2 2 0 0 0 2.8 2.7"/><path d="M4.4 4.7C2.4 5.9 1 8 1 8s2.6 4.5 7 4.5c1.2 0 2.2-.2 3.1-.7"/><path d="M6.9 3.7A7 7 0 0 1 8 3.5c4.4 0 7 4.5 7 4.5a13 13 0 0 1-2.1 2.6"/>', 13),
  link:     svg('<path d="M6.6 9.4a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 1 0-4-4l-.8.8"/><path d="M9.4 6.6a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 1 0 4 4l.8-.8"/>', 13),
  download: svg('<path d="M8 2v8"/><path d="M4.5 7 8 10.5 11.5 7"/><path d="M2.5 13.5h11"/>', 13),
}

// 对齐图标：一条基准线 + 一个贴住它的方块，和 Figma / Lucide 一致
const ALIGN_ICONS = {
  'h:start':  svg('<path d="M2 1.5v13"/><rect x="4.5" y="4.5" width="9" height="7" rx="1"/>', 13),
  'h:center': svg('<path d="M8 1.5v13"/><rect x="3" y="4.5" width="10" height="7" rx="1"/>', 13),
  'h:end':    svg('<path d="M14 1.5v13"/><rect x="2.5" y="4.5" width="9" height="7" rx="1"/>', 13),
  'v:start':  svg('<path d="M1.5 2h13"/><rect x="4.5" y="4.5" width="7" height="9" rx="1"/>', 13),
  'v:center': svg('<path d="M1.5 8h13"/><rect x="4.5" y="3" width="7" height="10" rx="1"/>', 13),
  'v:end':    svg('<path d="M1.5 14h13"/><rect x="4.5" y="2.5" width="7" height="9" rx="1"/>', 13),
}

const ALIGN_BUTTONS = [
  ['h:start',  '左对齐'], ['h:center', '水平居中'], ['h:end', '右对齐'],
  ['v:start',  '顶对齐'], ['v:center', '垂直居中'], ['v:end', '底对齐'],
]

// 分区级的「临时关闭」：对应 Figma 里每条 Fill / Stroke / Effect 前面的眼睛。
// 关闭时记下当前的 inline 声明，再开时原样写回——包括「原本就没有声明」，
// 这样一开一关是精确的往返，不会凭空给元素添上一条 inline 样式。
const HIDEABLE = {
  fill:    { 'background-color': 'transparent', 'background-image': 'none' },
  stroke:  { 'border-style': 'none' },
  effects: { 'box-shadow': 'none', 'filter': 'none', 'backdrop-filter': 'none' },
}

// 这两个属性决定了别的属性有没有意义：position 决定 X/Y/z-index 是否生效，
// display 决定 flex 那一组是否生效。改了它们必须整块重画，
// 否则刚变得可用的字段要等下次重新选中才看得见。
const RERENDER_ON = new Set(['position', 'display'])

// VisBug 给选中元素加了 transition: all .15s（让微调看起来跟手）。
// 副作用是刚写完样式马上量，量到的是过渡中的中间值——往往就是旧值本身。
// 量之前先把过渡关掉：transition-property 变成 none 会立即取消正在跑的过渡，
// 计算值直接跳到终点；量完还原，此时起点终点相同，不会有可见的动画。
const measure = el => {
  const prev = el.style.transition
  el.style.transition = 'none'
  const rect = el.getBoundingClientRect()
  prev ? (el.style.transition = prev) : el.style.removeProperty('transition')
  return rect
}

const isTransparent = value =>
  !value || value === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(value)

const describeTarget = el => {
  const classes = stableClasses(el)
  return `${el.tagName.toLowerCase()}${classes.length ? '.' + classes.join('.') : ''}`
}

const esc = v => String(v ?? '').replace(/"/g, '&quot;')

export class PropsPanel extends HTMLElement {
  #shadow
  #targets = []
  #computed = {}
  #folded = new Set(['effects'])
  #unsubscribe = null
  #releaseScroll = null
  #dirtyProps = new Set()
  #shared = false
  #sharedEls = []
  #ratio = null           // 宽高比锁：null = 未锁，数字 = 锁定的 w/h
  #ratioBusy = false
  #hiddenSections = new Map()

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    // 自定义元素规范禁止在 constructor 中设置属性
    this.setAttribute('data-visual-revise-ui', '')

    // 面板内的按键归面板：Enter/Tab/Delete 等都是 VisBug 的全局快捷键，
    // 漏出去会在输入时误触发元素遍历、删除等操作。
    this.addEventListener('keydown', e => e.stopPropagation())

    this.#shadow.innerHTML = `<style>${panel_css}</style><div id="root"></div>`
    this.#releaseScroll = containScroll(this, () => this.#shadow.querySelector('.scroll'))

    this.#unsubscribe = ChangeStore.subscribe(() => {
      this.#syncValues()
      this.#refreshDirty()
    })
    this.render()
  }

  disconnectedCallback() {
    this.#unsubscribe?.()
    this.#releaseScroll?.()
  }

  // 由宿主在选中变化时调用
  setTargets(els) {
    this.#targets = (els || []).filter(el => el?.isConnected)
    this.#computed = this.#targets.length ? readComputed(this.#targets[0]) : {}
    this.#targets.forEach(el => ChangeStore.track(el))
    this.#sharedEls = this.#shared && this.target ? findSharedElements(this.target) : []
    this.#sharedEls.forEach(el => ChangeStore.track(el))

    // 比例锁与分区隐藏都是绑定在具体元素上的临时状态，换元素就作废
    this.#ratio = null
    this.#hiddenSections.clear()
    this.render()
  }

  get target() { return this.#targets[0] || null }

  #scope() {
    return this.#shared
      ? [...new Set([...this.#targets, ...this.#sharedEls])]
      : this.#targets
  }

  #applyToAll(prop, value) {
    this.#scope().forEach(el => ChangeStore.applyProp(el, prop, value))
    if (this.target) this.#computed = readComputed(this.target)
  }

  setShared(on) {
    this.#shared = on
    this.#sharedEls = on && this.target ? findSharedElements(this.target) : []

    const btn = this.#shadow.querySelector('.shared')
    if (btn) on ? btn.setAttribute('data-on', '') : btn.removeAttribute('data-on')

    if (on) {
      this.#sharedEls.forEach(el => ChangeStore.track(el))
      this.#toast(describeShared(this.#sharedEls.length))
    }
    this.#refreshDirty()
    return this.#sharedEls.length
  }

  get sharedCount() { return this.#shared ? this.#sharedEls.length : 0 }

  #dirtySet() {
    const target = this.target
    if (!target) return new Set()
    const entry = ChangeStore.read().edits.find(e => e.el === target)
    return new Set(entry ? entry.changes.map(c => c.prop) : [])
  }

  // 改动可能来自面板之外：改动列表的撤销、整体重置、JSON 导入。
  // 只刷新 dirty 标记而不回读值，会让字段停留在已被撤销的旧数字上，
  // 下一次拖动标签就从那个旧数字继续，等于把撤销掉的改动又加回去。
  #syncValues() {
    const target = this.target
    if (!target?.isConnected) return

    this.#computed = readComputed(target)
    const active = this.#shadow.activeElement

    for (const el of this.#shadow.querySelectorAll('[data-prop]')) {
      if (el === active) continue          // 不打断正在输入的字段

      const prop = el.dataset.prop
      if (!prop || prop.includes(',')) continue

      const value = displayValue(prop, this.#computed[prop] ?? '')

      if (el.tagName === 'VR-SELECT' || el.tagName === 'VR-COLOR') {
        const next = el.tagName === 'VR-COLOR' && isTransparent(value) ? '' : value
        if (el.getAttribute('value') !== next) el.setAttribute('value', next)
        continue
      }

      if (el.tagName === 'BUTTON') {       // segment 分段按钮
        el.dataset.value === value
          ? el.setAttribute('data-on', '')
          : el.removeAttribute('data-on')
        continue
      }

      if (el.tagName !== 'INPUT') continue

      if (el.value !== value) el.value = value
    }
  }

  #refreshDirty() {
    const dirty = this.#dirtySet()
    this.#dirtyProps = dirty

    this.#shadow.querySelectorAll('label.name[data-prop]').forEach(label => {
      const prop = label.dataset.prop
      const isDirty = prop.includes(',')
        ? prop.split(',').some(p => dirty.has(p))
        : dirty.has(prop)
      isDirty ? label.setAttribute('data-dirty', '') : label.removeAttribute('data-dirty')
    })

    // 分区标题上的「重置本组」只在这一组真的改过时才出现
    this.#shadow.querySelectorAll('section[data-group]').forEach(section => {
      const group = GROUPS.find(g => g.id === section.dataset.group)
      const has = !!group && group.props.some(p => dirty.has(p))
      has ? section.setAttribute('data-dirty', '') : section.removeAttribute('data-dirty')
    })

    const sub = this.#shadow.querySelector('.sub')
    if (sub && this.target) sub.textContent = this.#subtitle()
  }

  #subtitle() {
    const count = this.#dirtyProps.size
    const multi = this.#targets.length > 1 ? `已选 ${this.#targets.length} 个 · ` : ''
    const shared = this.#shared && this.#sharedEls.length
      ? ` · 联动 ${this.#sharedEls.length + 1} 个`
      : ''
    return `${multi}${count ? `${count} 项改动` : '未改动'}${shared}`
  }

  render() {
    const root = this.#shadow.querySelector('#root')
    if (!root) return

    this.#dirtyProps = this.#dirtySet()

    root.innerHTML = this.target
      ? this.#renderPanel()
      : `<header><div class="target"><span class="tag">未选中元素</span></div>
           <button class="icon-btn close" title="关闭">${ICON.close}</button></header>
         <div class="empty">点击页面上的任意元素开始编辑<br><kbd>Tab</kbd> 临时退出编辑态<br><kbd>Esc</kbd> 取消选中</div>`

    this.#bind()
    this.#refreshDirty()
  }

  #renderPanel() {
    const sections = GROUPS.map(group => this.#renderGroup(group)).filter(Boolean).join('')
    return `
      <header>
        <div class="target">
          <span class="tag">${describeTarget(this.target)}</span>
          <span class="sub">${this.#subtitle()}</span>
        </div>
        <button class="icon-btn shared"${this.#shared ? ' data-on' : ''}
          title="共享元素：同步修改页面中结构相同的元素">${ICON.shared}</button>
        <button class="icon-btn fold" title="折叠面板">${ICON.collapse}</button>
        <button class="icon-btn close" title="关闭">${ICON.close}</button>
      </header>
      <div class="scroll">${sections}</div>
      <div class="toast"></div>`
  }

  #renderGroup(group) {
    const rows = []
    const consumed = new Set()

    for (const name of group.widgets || []) {
      const widget = this.#renderWidget(name)
      if (widget) rows.push(widget)
    }

    const props = group.props.filter(prop => isRelevant(prop, this.#computed, this.target))

    for (const prop of props) {
      if (consumed.has(prop)) continue

      // 四边间距用合并控件，出现在它在 props 里的位置上
      const sideGroup = SIDE_GROUPS.find(sg => sg.props.includes(prop))
      if (sideGroup) {
        sideGroup.props.forEach(p => consumed.add(p))
        rows.push(this.#renderSides(sideGroup))
        continue
      }

      // W/H 是带比例锁的连体控件，不走普通的两列并排
      if (prop === 'width' && props.includes('height')) {
        consumed.add('width'); consumed.add('height')
        rows.push(this.#renderDims())
        continue
      }

      const pair = FIELD_PAIRS.find(([a, b]) =>
        (a === prop && props.includes(b)) || (b === prop && props.includes(a)))

      if (pair && !consumed.has(pair[0]) && !consumed.has(pair[1])) {
        consumed.add(pair[0]); consumed.add(pair[1])
        rows.push(`<div class="pair">${this.#renderField(pair[0])}${this.#renderField(pair[1])}</div>`)
        continue
      }

      consumed.add(prop)
      rows.push(this.#renderField(prop))
    }

    const body = rows.filter(Boolean)
    if (!body.length) return ''

    const folded = this.#folded.has(group.id) ? ' folded' : ''
    const off = this.#hiddenSections.has(group.id)
    const eye = HIDEABLE[group.id]
      ? `<button class="icon-btn eye" data-eye="${group.id}"${off ? ' data-on' : ''}
           title="${off ? '恢复本组' : '临时关闭本组'}">${off ? ICON.eyeOff : ICON.eye}</button>`
      : ''

    return `<section data-group="${group.id}"${folded}>
      <h3>
        <span class="title">${group.label}</span>
        <span class="acts">
          ${eye}
          <button class="icon-btn undo" data-undo="${group.id}" title="重置本组改动">${ICON.undo}</button>
        </span>
        <i class="chev"></i>
      </h3>
      <div class="rows">${body.join('')}</div>
    </section>`
  }

  #renderWidget(name) {
    if (name !== 'align') return ''
    if (!alignSupported(this.target)) return ''

    return `<div class="field">
      <label class="name">对齐</label>
      <div class="align">
        ${ALIGN_BUTTONS.map(([key, title]) =>
          `<button data-align="${key}" title="${title}">${ALIGN_ICONS[key]}</button>`).join('')}
      </div>
    </div>`
  }

  // Figma 的 W/H：两个字段并排，右侧一个括号把它们和比例锁连起来
  #renderDims() {
    const cell = prop => `<div class="control">
      <span class="prefix" data-drag data-prop="${prop}">${FIELD_PREFIX[prop]}</span>
      <input type="text" data-prop="${prop}" data-num value="${esc(this.#computed[prop])}" title="${prop}">
    </div>`

    return `<div class="field">
      <label class="name" data-prop="width,height">尺寸</label>
      <div class="dims">
        ${cell('width')}${cell('height')}
        <i class="bracket"></i>
        <button class="icon-btn ratio"${this.#ratio ? ' data-on' : ''}
          title="锁定宽高比">${ICON.link}</button>
      </div>
    </div>`
  }

  #renderSides(sg) {
    const values = sg.props.map(p => this.#computed[p] || '')
    const linked = values.every(v => v === values[0])

    return `<div class="field">
      <label class="name" data-prop="${sg.props.join(',')}">${sg.label}</label>
      <div class="sides">
        ${sg.props.map((p, i) => `
          <div class="control">
            <span class="prefix">${FIELD_PREFIX[p] || ''}</span>
            <input type="text" data-prop="${p}" data-side value="${values[i]}" title="${p}">
          </div>`).join('')}
        <button class="icon-btn lock" data-lock="${sg.base}" ${linked ? 'data-on' : ''}
          title="四边联动">${ICON.link}</button>
      </div>
    </div>`
  }

  #renderField(prop) {
    const spec = CONTROLS[prop]
    if (!spec) return ''
    const value = displayValue(prop, this.#computed[prop] ?? '')
    const prefix = FIELD_PREFIX[prop]

    const field = (() => {
      switch (spec.type) {
        case 'select': {
          const options = spec.options.includes(value) || !value
            ? spec.options
            : [value, ...spec.options]
          return `<vr-select data-prop="${prop}" value="${esc(value)}"
            options='${JSON.stringify(options).replace(/'/g, '&apos;')}'></vr-select>`
        }

        case 'segment':
          return `<div class="segment">${spec.options.map(([val, label]) =>
            `<button data-prop="${prop}" data-value="${val}"${val === value ? ' data-on' : ''}>${label}</button>`
          ).join('')}</div>`

        case 'color':
          return `<vr-color data-prop="${prop}" value="${isTransparent(value) ? '' : esc(value)}"></vr-color>`

        case 'text': {
          const input = `<div class="control"><input type="text" data-prop="${prop}"
            value="${esc(value)}"></div>`
          return prop === 'font-family' && fontsSupported()
            ? `<div class="with-action">${input}
                 <button class="icon-btn load-fonts" title="读取本地已安装字体">${ICON.download}</button>
               </div>`
            : input
        }

        default:
          return `<div class="control">
            ${prefix ? `<span class="prefix">${prefix}</span>` : ''}
            <input type="text" data-prop="${prop}" data-num value="${esc(value)}">
          </div>`
      }
    })()

    const draggable = spec.type === 'num' ? ' data-drag' : ''
    return `<div class="field">
      <label class="name" data-prop="${prop}"${draggable} title="${prop}">${spec.label}</label>
      ${field}
    </div>`
  }

  #toast(message, kind = 'info') {
    const el = this.#shadow.querySelector('.toast')
    if (!el) return
    el.textContent = message
    el.dataset.kind = kind
    el.setAttribute('data-show', '')
    clearTimeout(this.__toastTimer)
    this.__toastTimer = setTimeout(() => el.removeAttribute('data-show'), 2200)
  }

  #commit(prop, raw, { coerce = true } = {}) {
    const spec = CONTROLS[prop]
    const value = coerce && spec?.coerce ? spec.coerce(raw) : raw
    this.#applyToAll(prop, value)
    this.#applyRatio(prop)
    if (RERENDER_ON.has(prop)) this.render()
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  // 比例锁开着时，改了一边就按锁定时的比例算出另一边。
  // 比例一律按元素实际占的边框盒算（和 Figma 的 W/H 一致，也是用户眼睛看到的），
  // 而不是 getComputedStyle 的内容盒宽高——那两个在 box-sizing 不同时相差
  // 一整圈 padding 和 border。
  //
  // 写进 width/height 的数字在 content-box 下并不等于边框盒尺寸，但二者是
  // 1:1 线性关系，所以「先按目标值写一次、再用实测误差校正一次」就精确收敛。
  #applyRatio(prop) {
    if (!this.#ratio || this.#ratioBusy) return
    if (prop !== 'width' && prop !== 'height') return
    if (!this.target?.isConnected) return

    const other = prop === 'width' ? 'height' : 'width'
    const rect = measure(this.target)
    const desired = prop === 'width' ? rect.width / this.#ratio : rect.height * this.#ratio
    if (!Number.isFinite(desired) || desired <= 0) return

    this.#ratioBusy = true

    let value = Math.round(desired)
    this.#commit(other, `${value}px`, { coerce: false })

    const got = measure(this.target)[other]
    const error = Math.round(desired - got)
    if (error) {
      value += error
      this.#commit(other, `${value}px`, { coerce: false })
    }

    this.#ratioBusy = false

    const input = this.#shadow.querySelector(`input[data-prop="${other}"]`)
    if (input) input.value = `${value}px`
  }

  #align(key) {
    const [axis, where] = key.split(':')
    const targets = this.#scope()
    if (!targets.length) return

    targets.forEach(el =>
      alignPlan(el, axis, where).forEach(({ prop, value }) =>
        ChangeStore.applyProp(el, prop, value)))

    if (this.target) this.#computed = readComputed(this.target)
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  #toggleSection(id) {
    const map = HIDEABLE[id]
    const targets = this.#scope()
    if (!map || !targets.length) return

    const saved = this.#hiddenSections.get(id)
    if (saved) {
      saved.forEach(({ el, props }) =>
        Object.entries(props).forEach(([p, v]) => ChangeStore.applyProp(el, p, v)))
      this.#hiddenSections.delete(id)
    } else {
      this.#hiddenSections.set(id, targets.map(el => ({
        el,
        props: Object.fromEntries(
          Object.keys(map).map(p => [p, el.style.getPropertyValue(p)])),
      })))
      targets.forEach(el =>
        Object.entries(map).forEach(([p, v]) => ChangeStore.applyProp(el, p, v)))
    }

    this.render()
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  #resetGroup(id) {
    const group = GROUPS.find(g => g.id === id)
    const targets = this.#scope()
    if (!group || !targets.length) return

    targets.forEach(el => {
      const eid = elementId(el)
      group.props.forEach(prop => ChangeStore.undoProp(eid, prop))
    })

    this.#hiddenSections.delete(id)
    this.render()
    this.#toast(`已重置 ${group.label}`)
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  #bind() {
    const shadow = this.#shadow
    const on = (sel, evt, fn) => shadow.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn))

    on('h3', 'click', e => {
      const section = e.currentTarget.closest('section')
      const id = section.dataset.group
      this.#folded.has(id) ? this.#folded.delete(id) : this.#folded.add(id)
      section.toggleAttribute('folded')
    })

    // 标题栏上的按钮不应顺带把分区折叠掉
    on('h3 .acts button', 'click', e => e.stopPropagation())
    on('[data-eye]', 'click', e => this.#toggleSection(e.currentTarget.dataset.eye))
    on('[data-undo]', 'click', e => this.#resetGroup(e.currentTarget.dataset.undo))
    on('[data-align]', 'click', e => this.#align(e.currentTarget.dataset.align))

    on('.close', 'click', () => this.dispatchEvent(new CustomEvent('vr-close', { bubbles: true, composed: true })))
    on('.fold', 'click', () => this.toggleAttribute('collapsed'))
    on('.shared', 'click', () => {
      const count = this.setShared(!this.#shared)
      this.dispatchEvent(new CustomEvent('vr-shared-toggle', {
        bubbles: true, composed: true, detail: { on: this.#shared, count },
      }))
    })

    on('.ratio', 'click', e => {
      const btn = e.currentTarget
      if (this.#ratio) {
        this.#ratio = null
        btn.removeAttribute('data-on')
        this.#toast('已解除宽高比锁定')
        return
      }
      const rect = measure(this.target)
      if (!rect.width || !rect.height) {
        this.#toast('元素当前没有可用尺寸，无法锁定比例', 'error')
        return
      }
      this.#ratio = rect.width / rect.height
      btn.setAttribute('data-on', '')
      this.#toast(`已锁定宽高比 ${this.#ratio.toFixed(2)} : 1`)
    })

    on('.load-fonts', 'click', async e => {
      const btn = e.currentTarget
      btn.textContent = '…'
      const result = await loadLocalFonts()
      btn.innerHTML = ICON.download

      if (!result.ok) { this.#toast(result.reason, 'error'); return }

      const input = this.#shadow.querySelector('input[data-prop="font-family"]')
      let dl = this.#shadow.querySelector('#vr-font-list')
      if (!dl) {
        dl = document.createElement('datalist')
        dl.id = 'vr-font-list'
        this.#shadow.querySelector('#root').appendChild(dl)
      }
      dl.innerHTML = result.fonts.map(f => `<option value="${f}"></option>`).join('')
      input?.setAttribute('list', 'vr-font-list')
      this.#toast(`已读取 ${result.fonts.length} 个本地字体`)
    })

    // 聚焦中的字段在同步时被跳过（不打断输入），失焦时补一次，
    // 否则外部撤销发生在用户正编辑该字段时，它会一直停在旧值上
    on('input[data-prop]', 'blur', () => this.#syncValues())

    on('input[data-prop]', 'change', e => {
      const el = e.currentTarget
      const prop = el.dataset.prop
      const next = CONTROLS[prop]?.coerce?.(el.value) ?? el.value

      // 与当前实际值相同就不是一次编辑。程序同步字段值后浏览器可能
      // 补发 change，若照单提交会把刚被外部撤销的改动又写回去。
      if (sameValue(next, this.#computed[prop])) return

      this.#commit(prop, el.value)
    })

    on('vr-color[data-prop]', 'vr-color', e =>
      this.#commit(e.currentTarget.dataset.prop, e.detail.value || '', { coerce: false }))

    on('vr-select[data-prop]', 'vr-select', e =>
      this.#commit(e.currentTarget.dataset.prop, e.detail.value, { coerce: false }))

    on('.segment button', 'click', e => {
      const btn = e.currentTarget
      btn.parentElement.querySelectorAll('button').forEach(b => b.removeAttribute('data-on'))
      btn.setAttribute('data-on', '')
      this.#commit(btn.dataset.prop, btn.dataset.value, { coerce: false })
    })

    on('.lock', 'click', e => {
      const btn = e.currentTarget
      btn.toggleAttribute('data-on')
      if (!btn.hasAttribute('data-on')) return
      const base = btn.dataset.lock
      const first = shadow.querySelector(`input[data-prop="${base}-top"]`)
      const value = coerceLength(first?.value || '0')
      ;['top', 'right', 'bottom', 'left'].forEach(side => {
        const input = shadow.querySelector(`input[data-prop="${base}-${side}"]`)
        if (input) input.value = value
        this.#commit(`${base}-${side}`, value)
      })
    })

    // 四边联动：锁开启时改一个同步四个
    on('input[data-side]', 'change', e => {
      const input = e.currentTarget
      const base = input.dataset.prop.replace(/-(top|right|bottom|left)$/, '')
      const lock = shadow.querySelector(`.lock[data-lock="${base}"]`)
      if (!lock?.hasAttribute('data-on')) return
      const value = coerceLength(input.value)
      ;['top', 'right', 'bottom', 'left'].forEach(side => {
        const sib = shadow.querySelector(`input[data-prop="${base}-${side}"]`)
        if (sib && sib !== input) sib.value = value
        this.#commit(`${base}-${side}`, value)
      })
    })

    // Figma 式：横向拖动标签（或 W/H 前缀）调数值
    on('[data-drag]', 'pointerdown', e => {
      const handle = e.currentTarget
      const prop = handle.dataset.prop
      const input = shadow.querySelector(`input[data-prop="${prop}"]`)
      if (!input) return

      e.preventDefault()
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const origin = input.value
      const unitStep = stepSize(prop, false)

      const move = ev => {
        const steps = Math.round((ev.clientX - startX) / 2)
        const next = stepValue(prop, origin, steps * unitStep, this.#computed[prop])
        if (next === null) return
        input.value = next
        this.#commit(prop, next, { coerce: false })
      }
      const up = ev => {
        handle.releasePointerCapture(ev.pointerId)
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
    })

    // 数值输入支持上下键微调
    on('input[data-num], input[data-side]', 'keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()

      const input = e.currentTarget
      const prop = input.dataset.prop
      const delta = stepSize(prop, e.shiftKey) * (e.key === 'ArrowUp' ? 1 : -1)
      const next = stepValue(prop, input.value, delta, this.#computed[prop])

      if (next === null) return   // normal / auto 等无法步进的值
      input.value = next
      this.#commit(prop, next, { coerce: false })
    })

    this.#makeDraggable(shadow.querySelector('header'))
  }

  #makeDraggable(handle) {
    if (!handle) return
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return
      e.preventDefault()
      handle.setPointerCapture(e.pointerId)
      const rect = this.getBoundingClientRect()
      const offX = e.clientX - rect.left
      const offY = e.clientY - rect.top

      const move = ev => {
        this.style.left = `${ev.clientX - offX}px`
        this.style.top = `${ev.clientY - offY}px`
        this.style.right = 'auto'
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

  toast(msg, kind) { this.#toast(msg, kind) }

  setCommentMode(on) {
    const btn = this.#shadow.querySelector('.comment')
    if (!btn) return
    on ? btn.setAttribute('data-on', '') : btn.removeAttribute('data-on')
  }

  setReorderMode(on) {
    const btn = this.#shadow.querySelector('.reorder')
    if (!btn) return
    on ? btn.setAttribute('data-on', '') : btn.removeAttribute('data-on')
  }
}

customElements.define('visual-revise-panel', PropsPanel)
