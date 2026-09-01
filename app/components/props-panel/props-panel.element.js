import { GROUPS, sameValue } from '../../core/tracked-props.js'
import {
  CONTROLS, SIDE_GROUPS, FIELD_PAIRS, FIELD_PREFIX,
  isRelevant, coerceLength, stepValue, stepSize, displayValue,
  alignSupported, alignPlan, isReplacedElement,
} from '../../core/controls.js'
import { ChangeStore } from '../../core/change-store.js'
import { readComputed, elementId } from '../../core/snapshot.js'
import { stableClasses } from '../../core/anchors.js'
import { findSharedElements, describeShared } from '../../core/shared-elements.js'
import { loadLocalFonts, isSupported as fontsSupported } from '../../core/local-fonts.js'
import { containScroll, isTextElement } from '../../core/dom-utils.js'
import { imageSourceOf, measureNatural, describeSize } from '../../core/image-source.js'
import { pickImages, canRenderDataUrl } from '../../core/image-assets.js'
import {
  AXES, MODES, resizeMode, planResize, currentSize, isMainAxis, cssVariables,
} from '../../core/resizing.js'
import { openMenu, openPopover, closeMenu } from '../controls/menu.js'
import {
  TRACK_TYPES, TRACK_LABEL, DEFAULT_VALUE,
  readTracks, serializeTracks, trackProp, makeTracks, gridShape,
} from '../../core/grid.js'
import {
  FLOWS, FLOW_LABEL, flowOf, planFlow, isFlexFlow,
  alignmentOf, planAlignment, SIDE_SETS, pairDisplay, parsePair,
} from '../../core/layout.js'
import '../controls/select.element.js'
import '../controls/color.element.js'
import '../controls/fill.element.js'
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
  swap:     svg('<path d="M2.5 5.5h11l-2.5-2.5"/><path d="M13.5 10.5h-11l2.5 2.5"/>', 13),
  wrap:     svg('<path d="M2.5 4.5h9a2.5 2.5 0 0 1 0 5H4"/><path d="M6 7.5 4 9.5l2 2"/>', 13),
  expand:   svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M6 6h4v4H6z"/>', 13),
  collapse2: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M4.5 8h7"/>', 13),
  more:     svg('<circle cx="5" cy="5" r="1.2" fill="currentColor" stroke="none"/><circle cx="11" cy="5" r="1.2" fill="currentColor" stroke="none"/><circle cx="5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="11" cy="11" r="1.2" fill="currentColor" stroke="none"/>', 13),
}

// Flow 的四个图标，对应 Figma 的 Freeform / Vertical / Horizontal / Grid
const FLOW_ICON = {
  free:       svg('<rect x="2" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="8.5" y="5.5" width="5" height="5" rx="1"/><rect x="3" y="9.5" width="3.5" height="3.5" rx="1"/>'),
  vertical:   svg('<rect x="2.5" y="2.5" width="7" height="4" rx="1"/><rect x="2.5" y="8" width="7" height="4" rx="1"/><path d="M12.5 3v9m0 0-1.6-1.6M12.5 12l1.6-1.6"/>'),
  horizontal: svg('<rect x="2.5" y="2.5" width="4" height="7" rx="1"/><rect x="8" y="2.5" width="4" height="7" rx="1"/><path d="M3 12.5h9m0 0-1.6-1.6M12 12.5l-1.6 1.6"/>'),
  grid:       svg('<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>'),
}

// 间距的两段式图标：一个表示左右，一个表示上下
const SIDE_ICON = {
  horizontal: svg('<path d="M3 3.5v9M13 3.5v9"/><path d="M5.5 8h5"/>', 12),
  vertical:   svg('<path d="M3.5 3h9M3.5 13h9"/><path d="M8 5.5v5"/>', 12),
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

// 解除尺寸限制时写回的初始值。CSS 里「没有限制」不是空字符串，
// 而是 min 为 0、max 为 none——样式表里那条声明只能被盖掉，删不掉。
const LIMIT_RESET = {
  'min-width': '0', 'min-height': '0',
  'max-width': 'none', 'max-height': 'none',
}

// 这两个属性决定了别的属性有没有意义：position 决定 X/Y/z-index 是否生效，
// display 决定 flex 那一组是否生效。改了它们必须整块重画，
// 否则刚变得可用的字段要等下次重新选中才看得见。
const RERENDER_ON = new Set(['position', 'display'])

// 这些属性的编辑界面在分区的 widget 里，不再单独渲染成一行字段。
// background-image 不在此列——它还留着原来的文本框，那是 url(...) 的去处，
// 也是渐变编辑器产物的原始值视图。
const WIDGET_OWNED = new Set([
  'background-color',
  // min/max 收进 Resizing 行的下拉里，按需才出现——它们常年空着却占两整行，
  // 这也是 Figma 的做法（Add min width… / Add max width…）
  'min-width', 'min-height', 'max-width', 'max-height',
])

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
  // Typography 默认折叠：非文字元素上它多半没用，Figma 干脆不渲染这个分区。
  // 选中文字元素时会自动展开（见 setTargets）。
  #folded = new Set(['effects', 'typography'])
  #autoExpandedFor = null
  // 用户主动「添加」出来的尺寸限制。本来就有值的不用记，靠读值判断。
  #limits = new Set()
  // 哪些间距被展开成四边独立编辑。绑在元素上，换元素即收起。
  #expandedSides = new Set()
  // 二级视图（目前只有网格设置）。有值时面板整体切过去，× 回到上级。
  #subview = null
  // 上一次渲染针对的是哪个元素，用来判断该不该接着上次的滚动位置
  #renderedFor = null
  // Typography 的「更多」是否展开（大小写、装饰线）
  #typoMore = false
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

    // 比例锁、分区隐藏、临时展开的尺寸限制都绑在具体元素上，换元素就作废
    this.#ratio = null
    this.#hiddenSections.clear()
    this.#limits.clear()
    this.#expandedSides.clear()
    // 换了元素还停在上一个元素的网格设置里会很怪，退回主面板
    this.#subview = null

    // 选中文字元素时自动展开 Typography。只在目标真的换了才做一次：
    // 每次 render 都强制展开的话，用户手动折叠后会被下一帧原地弹开。
    // 反向不成立——不会因为选中非文字元素就把它折回去，那是用户的选择。
    if (this.target !== this.#autoExpandedFor) {
      this.#autoExpandedFor = this.target
      if (this.target && isTextElement(this.target)) this.#folded.delete('typography')
    }

    this.render()
  }

  get target() { return this.#targets[0] || null }

  #scope() {
    return this.#shared
      ? [...new Set([...this.#targets, ...this.#sharedEls])]
      : this.#targets
  }

  // 一个动作写多条属性时包一层，⌘Z 才会一次撤完而不是撤到一半
  #batch(label, fn) { return ChangeStore.history.batch(label, fn) }

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
      if (el.tagName === 'VR-FILL') {
        for (const [attr, p] of [['color', 'background-color'], ['image', 'background-image']]) {
          const next = this.#computed[p] ?? ''
          if (el.getAttribute(attr) !== next) el.setAttribute(attr, next)
        }
        continue
      }

      const prop = el.dataset.prop
      if (!prop || prop.includes(',')) continue

      const value = displayValue(prop, this.#computed[prop] ?? '')

      // 正在输入的字段不能覆盖。但外部改动确实发生了，得记一笔：
      // 失焦时浏览器会补发一个带着「用户离开前的值」的 change，
      // 照单提交就等于把刚被撤销的改动又写回去。
      if (el === active) {
        if (el.tagName === 'INPUT' && el.value !== value) {
          el.dataset.vrPending = value
          el.dataset.vrSeen = el.value
        }
        continue
      }

      delete el.dataset.vrPending
      delete el.dataset.vrSeen

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

    // 整块重建会把滚动容器一起换掉，位置归零。用户在面板中段改一个值，
    // 视图「唰」地跳回顶部，还得再滚回来找刚才那一行——每改一次都跳一次。
    //
    // 只在还是同一个元素时才接着滚：换了元素就该从头看起，
    // 保持上一个元素的滚动位置反而莫名其妙。
    const sameTarget = this.#renderedFor === this.target
    const scrollTop = sameTarget ? (this.#shadow.querySelector('.scroll')?.scrollTop || 0) : 0
    this.#renderedFor = this.target

    this.#dirtyProps = this.#dirtySet()

    root.innerHTML = this.#subview === 'grid' && this.target
      ? this.#renderGridSettings()
      : this.target
      ? this.#renderPanel()
      : `<header><div class="target"><span class="tag">未选中元素</span></div>
           <button class="icon-btn close" title="关闭">${ICON.close}</button></header>
         <div class="empty">点击页面上的任意元素开始编辑<br><kbd>Tab</kbd> 临时退出编辑态<br><kbd>Esc</kbd> 取消选中</div>`

    this.#bind()
    this.#refreshDirty()
    this.#fillImageDims()

    this.#restoreScroll(scrollTop)
  }

  // 内容变短时（收起展开的四边、切到属性更少的排列方式）浏览器会自动夹住，
  // 不用自己算上限。但反过来——面板里有异步才撑起来的部分（图片缩略图、
  // 本地字体列表）——第一帧的 scrollHeight 可能还不够高，scrollTop 会被夹小。
  // 下一帧再补一次。
  #restoreScroll(top) {
    if (!top) return

    const write = () => {
      const scroller = this.#shadow.querySelector('.scroll')
      if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top
    }

    write()
    requestAnimationFrame(write)
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
    // Layout 完全自定义渲染：它的控件是按 Flow 组织的，不是一条属性一行，
    // 通用循环表达不了（见 #layoutRows）
    const rows =
      group.id === 'layout'     ? this.#layoutRows()
      : group.id === 'typography' ? this.#typographyRows()
      : this.#defaultRows(group)

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

  // ── Typography：紧凑排布 ────────────────────────────────────
  // Figma 的排版面板不给每个字段配一行标签：字体独占一行，字重与字号并排，
  // 行高与字距才带小标签。省下的高度在一个十来行的面板里很关键。
  #typographyRows() {
    const el = this.target
    if (!el) return []
    if (!isRelevant('font-family', this.#computed, el)) return []

    const rows = []

    // 字体：占满一行，不加标签——一眼就知道那是字体
    const fontsBtn = fontsSupported()
      ? `<button class="icon-btn load-fonts" title="读取本地已安装字体">${ICON.download}</button>`
      : ''
    rows.push(`<div class="field">
      <div class="with-action">
        <div class="control">
          <input type="text" data-prop="font-family"
            value="${esc(displayValue('font-family', this.#computed['font-family'] ?? ''))}"
            title="font-family">
        </div>
        ${fontsBtn}
      </div>
    </div>`)

    // 字重 + 字号：Figma 把这两个放一行，也不加标签
    rows.push(`<div class="field">
      <div class="typo-pair">
        <vr-select data-prop="font-weight"
          value="${esc(displayValue('font-weight', this.#computed['font-weight'] ?? ''))}"
          options='${JSON.stringify(CONTROLS['font-weight'].options)}'></vr-select>
        <div class="control">
          <span class="prefix" data-drag data-prop="font-size">Aa</span>
          <input type="text" data-prop="font-size" data-num
            value="${esc(displayValue('font-size', this.#computed['font-size'] ?? ''))}"
            title="font-size">
        </div>
      </div>
    </div>`)

    // 行高 + 字距：这两个名字不带标签认不出来
    rows.push(`<div class="pair">
      ${this.#renderField('line-height')}${this.#renderField('letter-spacing')}
    </div>`)

    // 对齐 + 更多
    const align = this.#computed['text-align'] || ''
    rows.push(`<div class="field">
      <label class="name" data-prop="text-align">对齐</label>
      <div class="typo-align">
        <div class="segment">
          ${CONTROLS['text-align'].options.map(([val, label]) =>
            `<button data-prop="text-align" data-value="${val}"${val === align ? ' data-on' : ''}>${label}</button>`
          ).join('')}
        </div>
        <button class="icon-btn typo-more"${this.#typoMore ? ' data-on' : ''}
          title="更多排版设置">${ICON.more}</button>
      </div>
    </div>`)

    if (this.#typoMore)
      rows.push(`<div class="pair">
        ${this.#renderField('text-transform')}${this.#renderField('text-decoration-line')}
      </div>`)

    return rows
  }

  // ── Layout：按 Flow 组织 ────────────────────────────────────
  #layoutRows() {
    const el = this.target
    if (!el) return []

    const flow = flowOf(this.#computed)
    const rows = [this.#renderFlow(flow), this.#renderDims()]

    // display:block 下 justify-content / align-items / gap 全都不生效，
    // 留着这些控件只会让人以为改了有用
    if (isFlexFlow(flow)) rows.push(this.#renderAlignGap(flow))
    if (flow === 'grid') rows.push(this.#renderGridRow())

    rows.push(this.#renderSidePair('padding'), this.#renderSidePair('margin'))
    rows.push(this.#renderClip())

    // order 属于「这个元素在父容器里排第几」，重排功能会写它
    if (isRelevant('order', this.#computed, el)) rows.push(this.#renderField('order'))

    return rows
  }

  #renderFlow(flow) {
    const wrapped = !/^nowrap$/.test((this.#computed['flex-wrap'] || 'nowrap').trim())
    const canWrap = isFlexFlow(flow)

    return `<div class="field">
      <label class="name">排列</label>
      <div class="flow-row">
        <div class="segment flow">
          ${FLOWS.map(f => `<button data-flow="${f}"${f === flow ? ' data-on' : ''}
            title="${FLOW_LABEL[f]}">${FLOW_ICON[f]}</button>`).join('')}
        </div>
        <button class="icon-btn wrap-toggle"${wrapped ? ' data-on' : ''}
          ${canWrap ? '' : 'disabled'}
          title="${canWrap ? '换行 (flex-wrap)' : '仅 flex 排列可换行'}">${ICON.wrap}</button>
      </div>
    </div>`
  }

  #renderAlignGap(flow) {
    const { col, row } = alignmentOf(this.#computed, flow)

    const cells = []
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        cells.push(`<button class="align-cell" data-col="${c}" data-row="${r}"
          ${c === col && r === row ? 'data-on' : ''}
          title="${['左', '中', '右'][c]}${['上', '中', '下'][r]}对齐"></button>`)

    return `<div class="align-gap">
      <div class="field">
        <label class="name">对齐</label>
        <div class="align-grid" data-flow="${flow}">${cells.join('')}</div>
      </div>
      <div class="field">
        <label class="name" data-prop="gap" data-drag>间隔</label>
        <div class="control">
          <input type="text" data-prop="gap" data-num
            value="${esc(displayValue('gap', this.#computed.gap ?? ''))}" title="gap">
        </div>
      </div>
    </div>`
  }

  #renderGridRow() {
    const shape = this.target ? gridShape(this.target) : { cols: 0, rows: 0, implicitRows: true }
    const label = shape.cols
      ? `${shape.cols} × ${shape.implicitRows ? '自动' : shape.rows}`
      : '未设置'

    return `<div class="align-gap">
      <div class="field">
        <label class="name">网格</label>
        <button class="grid-shape" title="点击拖出行列">${label}</button>
      </div>
      <div class="field">
        <label class="name" data-prop="column-gap,row-gap">间隔</label>
        <div class="pair">
          ${this.#renderField('column-gap')}${this.#renderField('row-gap')}
        </div>
      </div>
    </div>`
  }

  // 拖出行列的点阵。和 Figma 一样：hover 高亮左上到当前格的矩形，
  // 点击定下 N × M；底部进二级设置逐条调轨道类型。
  #gridPicker() {
    const el = this.target
    const anchor = this.#shadow.querySelector('.grid-shape')
    if (!el || !anchor) return

    const MAX = 12
    const shape = gridShape(el)

    openPopover(anchor, (panel, close) => {
      panel.innerHTML = `
        <div class="gp">
          <div class="gp-head">
            <input class="gp-n" data-axis="columns" value="${shape.cols || 1}" inputmode="numeric">
            <span class="gp-x">×</span>
            <input class="gp-n" data-axis="rows" value="${shape.implicitRows ? '' : shape.rows}"
              placeholder="自动" inputmode="numeric">
          </div>
          <div class="gp-dots"></div>
          <div class="gp-hint"></div>
          <button class="gp-settings">打开网格设置</button>
        </div>`

      const dots = panel.querySelector('.gp-dots')
      const hint = panel.querySelector('.gp-hint')

      for (let r = 1; r <= MAX; r++)
        for (let c = 1; c <= MAX; c++) {
          const b = document.createElement('button')
          b.className = 'gp-dot'
          b.dataset.c = c
          b.dataset.r = r
          if (c <= shape.cols && r <= (shape.implicitRows ? 0 : shape.rows)) b.dataset.on = ''
          dots.appendChild(b)
        }

      const preview = (c, r) => {
        for (const d of dots.children) {
          const on = +d.dataset.c <= c && +d.dataset.r <= r
          on ? d.setAttribute('data-hot', '') : d.removeAttribute('data-hot')
        }
        hint.textContent = c ? `${c} × ${r}` : ''
      }

      dots.addEventListener('pointerover', e => {
        const d = e.target.closest('.gp-dot')
        if (d) preview(+d.dataset.c, +d.dataset.r)
      })
      dots.addEventListener('pointerleave', () => preview(0, 0))

      dots.addEventListener('click', e => {
        const d = e.target.closest('.gp-dot')
        if (!d) return
        close()
        this.#setGridShape(+d.dataset.c, +d.dataset.r)
      })

      // 改完列数往往还要接着改行数，所以 change 只应用不关闭；
      // 关闭留给 Enter 与点击点阵。
      const applyInputs = shouldClose => {
        const cols = +panel.querySelector('.gp-n[data-axis="columns"]').value || 1
        const rowsRaw = panel.querySelector('.gp-n[data-axis="rows"]').value.trim()
        if (shouldClose) close()
        this.#setGridShape(cols, rowsRaw ? +rowsRaw : 0)
      }

      panel.querySelectorAll('.gp-n').forEach(input => {
        input.addEventListener('change', () => applyInputs(false))
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); applyInputs(true) }
          if (e.key === 'Escape') { e.preventDefault(); close() }
        })
      })

      panel.querySelector('.gp-settings').addEventListener('click', () => {
        close()
        this.#subview = 'grid'
        this.render()
      })
    }, { align: 'left', width: 260 })
  }

  #setGridShape(cols, rows) {
    if (!this.target) return

    this.#batch(`网格 ${cols} × ${rows || '自动'}`, () => {
      this.#applyToAll('grid-template-columns', serializeTracks(makeTracks(cols)))
      // 行数留空表示交给隐式网格——那正是 Figma 里的 "N × 自动"
      this.#applyToAll('grid-template-rows', rows ? serializeTracks(makeTracks(rows)) : '')
    })

    this.#computed = readComputed(this.target)
    this.render()
    this.#toast(`网格：${cols} × ${rows || '自动'}`)
  }

  // ── 二级视图：网格设置 ──────────────────────────────────────
  #renderGridSettings() {
    const el = this.target
    if (!el) return ''

    const axisSection = (axis, title) => {
      const tracks = readTracks(el, axis)

      const rows = tracks.map((t, i) => `
        <div class="track" data-axis="${axis}" data-i="${i}">
          <span class="track-n">${i + 1}</span>
          <vr-select data-track="${axis}:${i}" value="${t.type}"
            options='${JSON.stringify(TRACK_TYPES.map(k => [k, TRACK_LABEL[k]]))}'></vr-select>
          <input class="track-v" data-axis="${axis}" data-i="${i}"
            value="${esc(t.value)}"${t.type === 'hug' ? ' disabled' : ''}>
          <button class="del-track" data-axis="${axis}" data-i="${i}" title="删除这条">−</button>
        </div>`).join('')

      return `<section data-group="grid-${axis}">
        <h3>
          <span class="title">${title}</span>
          <span class="acts">
            <button class="icon-btn add-track" data-axis="${axis}" title="添加一条">＋</button>
          </span>
        </h3>
        <div class="rows">${rows || `<div class="empty-track">还没有${title}</div>`}</div>
      </section>`
    }

    return `
      <header>
        <div class="target">
          <span class="tag">网格设置</span>
          <span class="sub-target">${describeTarget(el)}</span>
        </div>
        <button class="icon-btn back" title="返回属性面板">${ICON.close}</button>
      </header>
      <div class="scroll">
        ${axisSection('columns', '列')}
        ${axisSection('rows', '行')}
      </div>
      <div class="toast"></div>`
  }

  #writeTracks(axis, tracks) {
    this.#applyToAll(trackProp(axis), tracks.length ? serializeTracks(tracks) : '')
    this.#computed = readComputed(this.target)
    this.render()
  }

  // Figma 的间距默认只给「水平」「垂直」两个框，点一下才展开成四边独立。
  // 四边常年占两整行，而多数时候左右相等、上下相等。
  #renderSidePair(kind) {
    const set = SIDE_SETS[kind]
    const expanded = this.#expandedSides.has(kind)

    if (expanded) {
      const sideGroup = SIDE_GROUPS.find(sg => sg.props.join() === set.all.join())
      return `<div class="field sides-expanded" data-kind="${kind}">
        ${sideGroup ? this.#renderSides(sideGroup) : ''}
        <button class="icon-btn collapse-sides" data-kind="${kind}"
          title="合并成水平 / 垂直两项">${ICON.collapse2}</button>
      </div>`
    }

    const cell = dir => {
      const props = set[dir]
      const value = pairDisplay(this.#computed, props, v => displayValue(props[0], v))

      return `<div class="control">
        <span class="prefix" data-drag data-pair="${kind}:${dir}">${SIDE_ICON[dir]}</span>
        <input type="text" data-pair="${kind}:${dir}" data-num
          value="${esc(value)}"
          title="${props.join(' / ')}">
      </div>`
    }

    return `<div class="field">
      <label class="name" data-prop="${set.all.join(',')}">${set.label}</label>
      <div class="side-pair">
        ${cell('horizontal')}${cell('vertical')}
        <button class="icon-btn expand-sides" data-kind="${kind}"
          title="分别设置四边">${ICON.expand}</button>
      </div>
    </div>`
  }

  #renderClip() {
    const on = /^(hidden|clip)$/.test((this.#computed.overflow || '').trim())
    return `<label class="field checkbox-field">
      <input type="checkbox" class="clip-toggle"${on ? ' checked' : ''}>
      <span>裁剪内容<code>overflow: hidden</code></span>
    </label>`
  }

  #defaultRows(group) {
    const rows = []
    const consumed = new Set()

    // Fill 分区的第一行随元素类型变。Figma 里 Fill 的首行就是这个图层的主填充：
    // 对图片图层是那张图，对文本图层是字色，对形状是背景色。CSS 把这三件事拆成
    // 了互不相干的属性（src / color / background-*），所以这里按元素类型决定谁
    // 排最前，而不是写死一个顺序。
    if (group.id === 'fill') {
      const preview = this.#renderImageFill()
      if (preview) rows.push(preview)

      // 文字元素的主填充是字色；替换元素（img/video）的主填充是上面那张图，
      // 此时 color 没有意义，仍按默认序沉到末尾。
      if (this.target && isTextElement(this.target) && !isReplacedElement(this.target)) {
        rows.push(this.#renderField('color'))
        consumed.add('color')
      }
    }

    for (const name of group.widgets || []) {
      const widget = this.#renderWidget(name)
      if (widget) rows.push(widget)
    }

    const props = group.props
      .filter(prop => !WIDGET_OWNED.has(prop))
      .filter(prop => isRelevant(prop, this.#computed, this.target))

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

    return rows
  }

  // 图片预览行：Figma 的图片填充那一行，左边就是图本身的缩略图。
  // 这里显示的 URL 就是页面已经加载并渲染出来的那张图，CSP 的 img-src 既然
  // 放行了它，再显示一次同样放行——不会出现「页面上看得见、面板里是裂图」。
  #renderImageFill() {
    const el = this.target
    if (!el) return ''

    const src = imageSourceOf(el, this.#computed)
    if (!src) return ''

    const KIND_LABEL = { src: '图片', poster: '封面图', background: '背景图' }
    const dims = describeSize(src.natural)

    return `<div class="field image-fill" data-image-kind="${src.kind}">
      <label class="name">${KIND_LABEL[src.kind] || '图片'}</label>
      <div class="image-row" title="${esc(src.url)}">
        <span class="thumb"><img src="${esc(src.url)}" alt="" loading="lazy"></span>
        <span class="image-meta">
          <span class="image-name">${esc(src.label)}</span>
          <span class="image-dim">${dims}</span>
        </span>
        <button class="icon-btn swap-image" title="换成本地图片">${ICON.swap}</button>
      </div>
    </div>`
  }

  // 换图：把用户挑的本地图写进元素。存的是 dataUrl 而不是 blob URL——后者
  // 绑在文档生命周期上，页面一刷新就失效，而改动记录要能导出成 JSON 交给别人。
  // 真正交给 AI 的是落盘后的绝对路径，那一步在导出提示词时才做。
  async #swapImage() {
    const el = this.target
    if (!el) return

    const { assets, errors } = await pickImages()
    if (errors.length) this.toast(errors[0], 'error')

    const asset = assets[0]
    if (!asset) return

    ChangeStore.addAsset(asset)

    const src = imageSourceOf(el, this.#computed)
    if (src?.kind === 'background') {
      ChangeStore.applyProp(el, 'background-image', `url("${asset.dataUrl}")`)
    } else {
      // srcset 的优先级高于 src：不清掉它，换上去的图根本不会被显示出来
      if (el.hasAttribute('srcset')) ChangeStore.applyAttr(el, 'srcset', '')
      ChangeStore.applyAttr(el, src?.kind === 'poster' ? 'poster' : 'src', asset.dataUrl)
    }

    this.#computed = readComputed(el)
    this.render()

    // 页面若禁了 img-src data:，换上去的图会静默变成空白。这不是坏了，
    // 改动记录和提示词照常——但不说一声，用户只会以为功能失灵。
    const renderable = await canRenderDataUrl()
    this.toast(renderable
      ? `已换图：${asset.name}`
      : `已记录换图，但本页 CSP 禁止内嵌图片，画面上不会更新（提示词不受影响）`,
      renderable ? 'info' : 'error')
  }

  // 背景图的天然尺寸 CSS 不暴露，只能另加载一次来量。渲染完再异步补上，
  // 避免为了一行尺寸把整个面板的渲染卡成异步。
  #fillImageDims() {
    const row = this.#shadow.querySelector('.image-fill[data-image-kind="background"] .image-dim')
    if (!row || row.textContent) return

    const src = imageSourceOf(this.target, this.#computed)
    if (!src) return

    measureNatural(src.url).then(natural => {
      // 量完时用户可能已经选了别的元素，别把尺寸写到不相干的行上
      if (!this.isConnected || imageSourceOf(this.target, this.#computed)?.url !== src.url) return
      const still = this.#shadow.querySelector('.image-fill[data-image-kind="background"] .image-dim')
      if (still) still.textContent = describeSize(natural)
    })
  }

  #renderWidget(name) {
    if (name === 'fill') {
      return `<div class="field">
        <label class="name" data-prop="background-color,background-image">填充</label>
        <vr-fill data-prop="background-color,background-image"
          color="${esc(this.#computed['background-color'])}"
          image="${esc(this.#computed['background-image'])}"></vr-fill>
      </div>`
    }

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
  // 尺寸限制是否该出现：本来就有值的一定显示（不能把元素已有的样式藏掉），
  // 其余等用户从下拉里主动添加
  #hasLimit(prop) {
    if (this.#limits.has(prop)) return true

    const v = (this.#computed[prop] || '').trim()
    if (!v) return false
    if (prop.startsWith('max')) return v !== 'none'
    return v !== '0px' && v !== '0' && v !== 'auto'
  }

  #renderDims() {
    const el = this.target
    const size = el ? currentSize(el) : { width: 0, height: 0 }

    const cell = axis => {
      const mode = el ? resizeMode(el, axis, this.#computed) : 'fixed'
      // 固定尺寸时输入框里就是那个数字；其余模式下数字是实测值，
      // 真正生效的是模式，所以把模式名摆在旁边，不让人以为那个数字是写死的
      const value = mode === 'fixed'
        ? displayValue(axis, this.#computed[axis])
        : `${size[axis]}`

      return `<div class="control resize-cell" data-axis="${axis}">
        <span class="prefix" data-drag data-prop="${axis}">${AXES[axis].prefix}</span>
        <input type="text" data-prop="${axis}" data-num value="${esc(value)}" title="${axis}">
        <button class="mode" data-axis="${axis}" data-mode="${mode}"
          title="${MODES[mode].label}｜点击切换尺寸模式">
          <span class="mode-name">${MODES[mode].label}</span>
          <i class="mode-caret"></i>
        </button>
      </div>`
    }

    const limitRow = kind => {
      const props = [AXES.width[kind], AXES.height[kind]]
      if (!props.some(p => this.#hasLimit(p))) return ''

      const one = prop => this.#hasLimit(prop)
        ? `<div class="control limit">
             <span class="prefix" data-drag data-prop="${prop}">${FIELD_PREFIX[prop]}</span>
             <input type="text" data-prop="${prop}" data-num
               value="${esc(displayValue(prop, this.#computed[prop]))}" title="${prop}">
             <button class="drop-limit" data-prop="${prop}" title="移除这条限制">×</button>
           </div>`
        : '<div class="control limit is-empty"></div>'

      return `<div class="limit-row" data-kind="${kind}">
        <span class="limit-label">${kind === 'min' ? '最小' : '最大'}</span>
        ${one(props[0])}${one(props[1])}
      </div>`
    }

    return `<div class="field">
      <label class="name" data-prop="width,height">尺寸</label>
      <div class="dims">
        ${cell('width')}${cell('height')}
        <i class="bracket"></i>
        <button class="icon-btn ratio"${this.#ratio ? ' data-on' : ''}
          title="锁定宽高比">${ICON.link}</button>
      </div>
      ${limitRow('min')}
      ${limitRow('max')}
    </div>`
  }

  #resizeMenu(axis) {
    const el = this.target
    if (!el) return

    const anchor = this.#shadow.querySelector(`.mode[data-axis="${axis}"]`)
    if (!anchor) return

    const mode = resizeMode(el, axis, this.#computed)
    const size = currentSize(el)
    const A = AXES[axis]
    const mainAxis = isMainAxis(el, axis)

    openMenu(anchor, [
      { id: 'fixed', label: `固定${A.label}度`, hint: `${size[axis]}px`, checked: mode === 'fixed' },
      { id: 'hug',   label: '贴合内容', hint: 'fit-content', checked: mode === 'hug' },
      { id: 'fill',  label: '填满容器', hint: mainAxis ? 'flex: 1' : '100%', checked: mode === 'fill' },
      { separator: true },
      { id: 'min', label: `添加最小${A.label}度…`, disabled: this.#hasLimit(A.min) },
      { id: 'max', label: `添加最大${A.label}度…`, disabled: this.#hasLimit(A.max) },
      { separator: true },
      { id: 'var', label: '使用 CSS 变量…' },
    ], id => this.#applyResizePick(axis, id), { align: 'right' })
  }

  #applyResizePick(axis, id) {
    const el = this.target
    if (!el) return
    const A = AXES[axis]

    if (id === 'min' || id === 'max') {
      // 只是把字段显示出来，不写任何声明——凭空写一条 min-width:0 会在改动
      // 记录里留下一条用户没做过的改动
      this.#limits.add(A[id])
      this.render()
      requestAnimationFrame(() =>
        this.#shadow.querySelector(`input[data-prop="${A[id]}"]`)?.focus())
      return
    }

    if (id === 'var') return this.#varMenu(axis)

    const patch = planResize(el, axis, id, this.#computed)
    this.#batch(`${A.label}：${MODES[id].label}`, () => {
      for (const [prop, value] of Object.entries(patch)) this.#applyToAll(prop, value ?? '')
    })

    this.#computed = readComputed(el)
    this.render()
    this.toast(`${A.label}：${MODES[id].label}`)
  }

  #varMenu(axis) {
    const anchor = this.#shadow.querySelector(`.mode[data-axis="${axis}"]`)
    if (!anchor) return

    const names = cssVariables()
    if (!names.length) {
      this.toast('页面上没有定义在 :root 的 CSS 变量', 'error')
      return
    }

    openMenu(anchor, names.slice(0, 60).map(n => ({ id: n, label: n })), name => {
      this.#applyToAll(axis, `var(${name})`)
      this.#computed = readComputed(this.target)
      this.render()
      this.toast(`${AXES[axis].label}：var(${name})`)
    }, { align: 'right' })
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
            <input type="text" data-prop="${p}" data-side
              value="${esc(displayValue(p, values[i]))}" title="${p}">
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
    // 写进样式的是带单位的值，显示给人看的不带——两者不是同一件事
    if (input) input.value = displayValue(other, `${value}px`)
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
    on('.swap-image', 'click', e => { e.stopPropagation(); this.#swapImage() })

    on('.mode', 'click', e => { e.stopPropagation(); this.#resizeMenu(e.currentTarget.dataset.axis) })

    // ── Layout ──
    on('[data-flow]', 'click', e => {
      const flow = e.currentTarget.dataset.flow
      const patch = planFlow(flow, this.#computed)
      this.#batch(`排列：${FLOW_LABEL[flow]}`, () => {
        for (const [prop, value] of Object.entries(patch)) this.#applyToAll(prop, value ?? '')
      })
      this.render()
      this.#toast(`排列：${FLOW_LABEL[flow]}`)
    })

    on('.wrap-toggle', 'click', e => {
      const on = e.currentTarget.hasAttribute('data-on')
      this.#applyToAll('flex-wrap', on ? 'nowrap' : 'wrap')
      this.render()
    })

    on('.align-cell', 'click', e => {
      const { col, row } = e.currentTarget.dataset
      const flow = flowOf(this.#computed)
      const patch = planAlignment(+col, +row, flow)
      this.#batch('对齐', () => {
        for (const [prop, value] of Object.entries(patch)) this.#applyToAll(prop, value ?? '')
      })
      this.render()
    })

    on('.expand-sides', 'click', e => {
      this.#expandedSides.add(e.currentTarget.dataset.kind)
      this.render()
    })

    on('.collapse-sides', 'click', e => {
      this.#expandedSides.delete(e.currentTarget.dataset.kind)
      this.render()
    })

    // 两段式间距：一个框写两条声明
    on('input[data-pair]', 'change', e => {
      const [kind, dir] = e.currentTarget.dataset.pair.split(':')
      const props = SIDE_SETS[kind]?.[dir]
      if (!props) return

      // 输入支持 "0, 138" 这种写法：显示成什么样就能照着改回去。
      // 只填一个值时两边一起写。
      const [a, b] = parsePair(e.currentTarget.value)
      this.#batch(SIDE_SETS[kind].label, () => {
        this.#commit(props[0], coerceLength(a))
        this.#commit(props[1], coerceLength(b))
      })
      this.render()
    })

    // ── Grid ──
    on('.typo-more', 'click', () => { this.#typoMore = !this.#typoMore; this.render() })

    on('.grid-shape', 'click', e => { e.stopPropagation(); this.#gridPicker() })

    on('.back', 'click', () => { this.#subview = null; this.render() })

    on('.add-track', 'click', e => {
      const axis = e.currentTarget.dataset.axis
      const tracks = readTracks(this.target, axis)
      tracks.push({ type: 'fill', value: DEFAULT_VALUE.fill })
      this.#writeTracks(axis, tracks)
    })

    on('.del-track', 'click', e => {
      const { axis, i } = e.currentTarget.dataset
      const tracks = readTracks(this.target, axis)
      tracks.splice(+i, 1)
      this.#writeTracks(axis, tracks)
    })

    on('vr-select[data-track]', 'vr-select', e => {
      const [axis, i] = e.currentTarget.dataset.track.split(':')
      const tracks = readTracks(this.target, axis)
      const track = tracks[+i]
      if (!track) return

      track.type = e.detail.value
      // 换类型就把值换成该类型的默认写法：把 1fr 留在「固定」上没有意义
      track.value = DEFAULT_VALUE[track.type]
      this.#writeTracks(axis, tracks)
    })

    on('.track-v', 'change', e => {
      const { axis, i } = e.currentTarget.dataset
      const tracks = readTracks(this.target, axis)
      const track = tracks[+i]
      if (!track) return

      const raw = e.currentTarget.value.trim()
      track.value = /^-?[\d.]+$/.test(raw) ? `${raw}px` : raw
      this.#writeTracks(axis, tracks)
    })

    on('.clip-toggle', 'change', e => {
      // 取消勾选时清掉声明而不是写 visible：写死 visible 会盖掉样式表里
      // 本来就有的 overflow，那不是用户的意思
      this.#applyToAll('overflow', e.currentTarget.checked ? 'hidden' : '')
      this.render()
    })

    on('.drop-limit', 'click', e => {
      e.stopPropagation()
      const prop = e.currentTarget.dataset.prop
      const el = this.target
      if (!el) return

      this.#limits.delete(prop)

      this.#batch(`移除 ${prop}`, () => {
        // 先清掉 inline 声明：如果这条限制是用户自己加的，到这一步就干净了，
        // 改动记录里也不会留下痕迹
        this.#applyToAll(prop, '')

        // 清完再看一眼。值还在，说明它来自样式表——那就不是「清掉声明」能
        // 解除的，必须写一个初始值把它盖掉。不这么做的话，字段下一帧照旧
        // 冒出来，用户看到的就是「点了 × 毫无反应」。
        this.#computed = readComputed(el)
        if (this.#hasLimit(prop)) this.#applyToAll(prop, LIMIT_RESET[prop])
      })

      this.#computed = readComputed(el)
      this.render()
      this.#toast(`已移除${prop.startsWith('min') ? '最小' : '最大'}${prop.endsWith('width') ? '宽度' : '高度'}限制`)
    })

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

    on('input[data-prop]', 'focus', e => {
      delete e.currentTarget.dataset.vrPending
      delete e.currentTarget.dataset.vrSeen
    })

    on('input[data-prop]', 'change', e => {
      const el = e.currentTarget
      const prop = el.dataset.prop

      // 这个字段在聚焦期间被外部改动覆盖过（撤销、重置、导入）。
      // 用户此后没再动过它，就采纳外部结果；动过才算一次真的编辑。
      const pending = el.dataset.vrPending
      if (pending !== undefined) {
        const untouched = el.value === el.dataset.vrSeen
        delete el.dataset.vrPending
        delete el.dataset.vrSeen
        if (untouched) { el.value = pending; return }
      }

      const next = CONTROLS[prop]?.coerce?.(el.value) ?? el.value

      // 与当前实际值相同就不是一次编辑。程序同步字段值后浏览器可能
      // 补发 change，若照单提交会把刚被外部撤销的改动又写回去。
      if (sameValue(next, this.#computed[prop])) return

      this.#commit(prop, el.value)
    })

    // 填充控件一次可能改两条属性；detail 里为 null 的那条表示「不动它」
    on('vr-fill', 'vr-fill', e => {
      const { color, image } = e.detail
      if (color != null) this.#applyToAll('background-color', color)
      if (image != null) this.#applyToAll('background-image', image)
      this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
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
      this.#batch(base === 'padding' ? '内边距' : '外边距', () => {
        ;['top', 'right', 'bottom', 'left'].forEach(side => {
          const sib = shadow.querySelector(`input[data-prop="${base}-${side}"]`)
          if (sib && sib !== input) sib.value = value
          this.#commit(`${base}-${side}`, value)
        })
      })
    })

    // Figma 式：横向拖动标签（或 W/H 前缀）调数值
    on('[data-drag]', 'pointerdown', e => {
      const handle = e.currentTarget
      const prop = handle.dataset.prop
      // 两段式间距的标签管的是一对属性，输入框按 data-pair 找
      const input = prop
        ? shadow.querySelector(`input[data-prop="${prop}"]`)
        : shadow.querySelector(`input[data-pair="${handle.dataset.pair}"]`)
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
        input.value = displayValue(prop, next)
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
      input.value = displayValue(prop, next)
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
