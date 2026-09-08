/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { GROUPS, sameValue } from '../../core/tracked-props.js'
import { parseFills, serializeFills, bindFills, DEFAULT_FILL } from '../../core/fills.js'
import { EFFECTS, EFFECT_LABEL, FIELDS as EFFECT_FIELDS, parseEffects, serializeEffects, defaultsFor } from '../../core/effects.js'
import { splitTopLevel } from '../../core/gradient.js'
import {
  CONTROLS, SIDE_GROUPS, FIELD_PAIRS, FIELD_PREFIX, HIDDEN_FIELDS, LABELED_PAIRS, CORNER_PROPS, SIDE_WIDTH_PROPS,
  isRelevant, coerceLength, stepValue, stepSize, displayValue,
  alignSupported, alignPlan, isReplacedElement, isTextlessElement,
} from '../../core/controls.js'
import { ChangeStore } from '../../core/change-store.js'
import { moveTo, savePlacement } from '../../core/placement.js'
import { readComputed, elementId } from '../../core/snapshot.js'
import { stableClasses } from '../../core/anchors.js'
import { findSharedElements, describeShared } from '../../core/shared-elements.js'
import { orderedChildren } from '../../core/reorder.js'
import { loadLocalFonts, isSupported as fontsSupported,
  primaryFont, withPrimaryFont, COMMON_FONTS } from '../../core/local-fonts.js'
import { containScroll, isTextElement } from '../../core/dom-utils.js'
import { imageSourceOf, measureNatural, describeSize } from '../../core/image-source.js'
import { pickImages, canRenderDataUrl, totalBytes } from '../../core/image-assets.js'
import {
  AXES, MODES, resizeMode, planResize, currentSize, isMainAxis,
} from '../../core/resizing.js'
import { openMenu, openPopover, closeMenu } from '../controls/menu.js'
import { openColorPopover } from '../controls/color-popover.js'
import { declaredVariables, winningDeclaration, wholeVar, varTokens } from '../../core/cascade.js'
import { parseColor, sameColor } from '../controls/picker.js'
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
  // 两层菱形只占了上半部分（墨迹 y 1.5~11.5，中心 6.5），整体往下推 1.5 才居中。
  // 直接改路径要动六对坐标，一处手滑就又偏了，包一层 translate 更稳。
  // 原来 13 宽画满 81%，缩到 11/16 ≈ 69%，坐标直接按 (8,8) 居中重算，不再套 translate
  shared:   svg('<path d="M8 3.5 13.5 6.5 8 9.5 2.5 6.5 8 3.5Z"/><path d="M2.5 9.5 8 12.5 13.5 9.5"/>'),
  // 下面这几个原来墨迹只占 viewBox 的 50–56%，跟眼睛（88%）并排时小一号。
  // 统一放大到 10/16 ≈ 63%，所有图标的视觉重量才在一个档上。
  collapse: svg('<path d="M3 6 8 11l5-5"/>'),
  close:    svg('<path d="M3 3 13 13M13 3 3 13"/>'),
  undo:     svg('<path d="M2.5 6.5h7.5a3.5 3.5 0 0 1 0 7H6.5"/><path d="M5.5 3.5 2.5 6.5l3 3"/>', 13),
  // 眼睛原来画满 88%，缩到 12/16 = 75%
  eye:      svg('<path d="M2 8s2.3-4 6-4 6 4 6 4-2.3 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.7"/>', 13),
  eyeOff:   svg('<path d="M3 3 13 13"/><path d="M6.8 6.9a1.7 1.7 0 0 0 2.4 2.3"/><path d="M4.8 5C3.2 6 2 8 2 8s2.3 4 6 4c1 0 1.9-.2 2.6-.6"/><path d="M7 4.1c.3 0 .7-.1 1-.1 3.7 0 6 4 6 4a11 11 0 0 1-1.8 2.2"/>', 13),
  // 用 link 那两段（它们本来就关于 (8,8) 点对称）再加一条同样对称的斜杠。
  // 上一版是自己另画的，墨迹落在 2.5~15.3，中心偏到 (8.9, 8.9)，在 24px 的
  // 按钮里就是肉眼可见的偏右下。
  link:     svg('<path d="M6.6 9.4a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 1 0-4-4l-.8.8"/><path d="M9.4 6.6a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 1 0 4 4l.8-.8"/>', 13),
  unlink:   svg('<path d="M6.6 9.4a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 1 0-4-4l-.8.8"/><path d="M9.4 6.6a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 1 0 4 4l.8-.8"/><path d="M4.6 4.6l6.8 6.8"/>', 13),
  download: svg('<path d="M8 2v8"/><path d="M4.5 7 8 10.5 11.5 7"/><path d="M2.5 13.5h11"/>', 13),
  swap:     svg('<path d="M2.5 5.5h11l-2.5-2.5"/><path d="M13.5 10.5h-11l2.5 2.5"/>', 13),
  // 14 而不是 13：它跟 flow 分段控件并排在同一行，那四个是 14
  wrap:     svg('<path d="M2.5 4.5h9a2.5 2.5 0 0 1 0 5H4"/><path d="M6 7.5 4 9.5l2 2"/>'),
  more:     svg('<circle cx="4.5" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="11.5" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.5" cy="11.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="11.5" cy="11.5" r="1.5" fill="currentColor" stroke="none"/>', 13),
  plus:     svg('<path d="M8 3v10M3 8h10"/>', 13),
  minus:    svg('<path d="M3 8h10"/>', 13),
  // 四角独立：四个带圆角的角括弧（Figma 的 Independent corners）
  corners:  svg('<path d="M3 6V5a2 2 0 0 1 2-2h1"/><path d="M10 3h1a2 2 0 0 1 2 2v1"/><path d="M13 10v1a2 2 0 0 1-2 2h-1"/><path d="M6 13H5a2 2 0 0 1-2-2v-1"/>', 13),
  // 四边独立：四条互不相连的边
  sides:    svg('<path d="M5 3h6"/><path d="M13 5v6"/><path d="M5 13h6"/><path d="M3 5v6"/>', 13),
  // Figma 用四个点表示「绑定变量」，这里绑的是页面上已定义的 CSS 自定义属性
  variable: svg('<circle cx="4.5" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="11.5" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.5" cy="11.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="11.5" cy="11.5" r="1.5" fill="currentColor" stroke="none"/>', 13),
}

// Typography 的可见性要按「这一组改过没有」兜底，先把它拎出来
const GROUP_TYPOGRAPHY = GROUPS.find(g => g.id === 'typography')

// 这三个分区改用 Figma 的「可增删的层列表」交互：标题右侧是 variable + 加号，
// 元素本来没有填充/描边/效果时也要把标题和加号显示出来——空状态本身就是入口，
// 整个分区不渲染的话，用户根本没有地方去添加第一条。
const LAYERED = new Set(['fill', 'stroke', 'effects'])

// 变量按值的类型分类。挑颜色的时候把字体栈和 12px 也列出来毫无意义——
// 点了也 apply 不上，只是让人在几十项里多翻几屏。
//
// 先判长度再判颜色：parseColor 拿 CSS 引擎做解析，`12px` 它认不出来所以
// 不会误判，但顺序放前面更省事也更明确。字体放最后兜底：字体栈的特征是
// 带引号或逗号，单个字体名（Inter）跟颜色关键字（red）长得一样，
// 那种只能靠前面的颜色判定先把它挑走。
const varKind = value => {
  const v = String(value || '').trim()
  if (!v) return 'other'
  if (/^-?[\d.]+(px|r?em|%|v[wh]|ch|pt|vmin|vmax)$/i.test(v)) return 'length'
  if (/^-?[\d.]+$/.test(v)) return 'number'
  if (parseColor(v).valid) return 'color'
  if (/[,'"]/.test(v) || /^[A-Za-z][\w -]*$/.test(v)) return 'font'
  return 'other'
}

// 面板管的颜色属性里会继承的只有字色；background / border 都不继承
const INHERITED = new Set(['color'])

// 数值框的单位只做展示、放最右，不混进输入文本：`22.5px` 拆成框里的 22.5 和
// 右侧压淡的 px。像素这种默认单位早在 displayValue 里剥掉了（Figma 也不带 px），
// 这里拆的是 px 之外还留着的：行高的 px、旋转的 deg、em、% 之类。
const UNIT_LABEL = { deg: '°' }
const splitUnit = value => {
  const m = String(value ?? '').trim().match(/^(-?[\d.]+)([a-z%]+)$/i)
  return m ? { num: m[1], unit: m[2] } : { num: String(value ?? ''), unit: '' }
}

// 给 chip 的 title 用：继承来的绑定要说清来自哪个祖先
const describeNode = el => {
  const cls = [...el.classList].slice(0, 2).map(c => `.${c}`).join('')
  return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}>`
}

// 拖过这么多像素才算拖，不然一次轻微的手抖就会把顺序换掉
const DRAG_SLOP = 4

// Flow 的四个图标，对应 Figma 的 Freeform / Vertical / Horizontal / Grid
const FLOW_ICON = {
  free:       svg('<rect x="2" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="8.5" y="5.5" width="5" height="5" rx="1"/><rect x="3" y="9.5" width="3.5" height="3.5" rx="1"/>'),
  // 两块加一个方向箭头，箭头把墨迹拉向一侧，中心落在 (8.3, 7.25) / (7.25, 8.3)
  vertical:   svg('<g transform="translate(-0.3 0.75)"><rect x="2.5" y="2.5" width="7" height="4" rx="1"/><rect x="2.5" y="8" width="7" height="4" rx="1"/><path d="M12.5 3v9m0 0-1.6-1.6M12.5 12l1.6-1.6"/></g>'),
  horizontal: svg('<g transform="translate(0.75 -0.3)"><rect x="2.5" y="2.5" width="4" height="7" rx="1"/><rect x="8" y="2.5" width="4" height="7" rx="1"/><path d="M3 12.5h9m0 0-1.6-1.6M12 12.5l-1.6 1.6"/></g>'),
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
  // 描边隐藏写透明色而不是 border-style: none：none 会把边框宽度一起收掉，
  // 盒子变小、页面跳一下；而且 #canAdd 会把它当成「没有描边」，整行消失、
  // 连恢复的入口都没了。透明色保住占位，眼睛还在原处。
  stroke:  { 'border-color': 'transparent' },
  effects: { 'box-shadow': 'none', 'filter': 'none', 'backdrop-filter': 'none' },
}

// 眼睛按钮该关掉什么，跟着这个分区「这次真的渲染出来的字段」走。
// Fill 对直接承载文字的元素会把字色提到首行（见 #renderGroup 的 fill 特判），
// 那时字色就是这一层的主填充——只关背景等于什么都没关：链接、标题这类元素
// 本来就没有背景，点下去画面纹丝不动，看着就是按钮坏了。
// 反过来纯容器不能动 color：那一行根本没渲染，而 color 还会继承进整棵子树，
// 关一次背景把满屏文字一起抹掉，比不生效更糟。
const hideMapFor = (id, el) =>
  id === 'fill' && el && isTextElement(el) && !isReplacedElement(el)
    ? { ...HIDEABLE.fill, color: 'transparent' }
    : HIDEABLE[id]

// 解除尺寸限制时写回的初始值。CSS 里「没有限制」不是空字符串，
// 而是 min 为 0、max 为 none——样式表里那条声明只能被盖掉，删不掉。
const LIMIT_RESET = {
  'min-width': '0', 'min-height': '0',
  'max-width': 'none', 'max-height': 'none',
}

// 这几个属性决定了别的属性有没有意义：position 决定 X/Y/z-index 是否生效，
// display 决定 flex 那一组是否生效，border-style 选 none 就等于没有描边
// （computed border-width 随之为 0），粗细/颜色/位置三行都不该再留着。
// 改了它们必须整块重画，否则刚变得可用（或刚该消失）的字段要等下次重新选中才对得上——
// 描边那条尤其糟：分区停在旧结构上，加号还 disabled 挂着「只有一层，不能再加」，
// 而此刻明明一条描边都没有，唯一的添加入口是死的。
// border-width 不能一起加：它是输入框，change 时重绘会把正在编辑的焦点冲掉。
const RERENDER_ON = new Set(['position', 'display', 'border-style'])

// 两段式间距的控件（`padding:vertical` 这种 data-pair）背后是一对属性。
// 手柄和输入框都只带 data-pair，不带 data-prop——步进与提交都要先在这里换成属性名。
const pairPropsOf = pair => {
  const [kind, dir] = String(pair || '').split(':')
  return SIDE_SETS[kind]?.[dir] || null
}

// 少数几个前缀用图形比用字符清楚：行高的「↕」和字距的「AV」摆在框里
// 都认不出是什么，Figma 那边这两个位置也是图标。
// 输入框前缀图标统一 12，跟内外边距那组（SIDE_ICON）同一档——它们是框里的辅助标记，
// 不该比按钮里的图标还大
// 带「四边独立」按钮的两行。attr 是给测试留的老名字，rowClass / gridClass 同理
const SPLIT_ROWS = {
  'border-radius': { parts: CORNER_PROPS, icon: 'corners', attr: 'data-corners', rowClass: 'radius-row', gridClass: 'corners',
    openTitle: '分别设置四个角', closeTitle: '合并成一个圆角' },
  'border-width':  { parts: SIDE_WIDTH_PROPS, icon: 'sides', attr: 'data-sides', rowClass: 'width-row', gridClass: 'sides-grid',
    openTitle: '分别设置四边粗细', closeTitle: '合并成一个粗细' },
}

// 虚线三边压淡、实边加粗：12px 下只有对比拉开才分得清是哪一条边
const EDGE = {
  left:   svg('<path d="M3 3h10M3 13h10M13 3v10" stroke-dasharray="1.8 1.4" opacity=".5"/><path d="M3 2.5v11" stroke-width="2.2"/>', 12),
  top:    svg('<path d="M3 3v10M13 3v10M3 13h10" stroke-dasharray="1.8 1.4" opacity=".5"/><path d="M2.5 3h11" stroke-width="2.2"/>', 12),
  right:  svg('<path d="M3 3h10M3 13h10M3 3v10" stroke-dasharray="1.8 1.4" opacity=".5"/><path d="M13 2.5v11" stroke-width="2.2"/>', 12),
  bottom: svg('<path d="M3 3v10M13 3v10M3 3h10" stroke-dasharray="1.8 1.4" opacity=".5"/><path d="M2.5 13h11" stroke-width="2.2"/>', 12),
}

const PREFIX_ICON = {
  // 圆角：一个圆角的轮廓（Figma 的 Corner radius 前缀）；四个角各取自己那一角
  'border-radius':              svg('<path d="M3 13V8a5 5 0 0 1 5-5h5"/>', 12),
  'border-top-left-radius':     svg('<path d="M3 13V7a4 4 0 0 1 4-4h6"/>', 12),
  'border-top-right-radius':    svg('<path d="M3 3h6a4 4 0 0 1 4 4v6"/>', 12),
  'border-bottom-left-radius':  svg('<path d="M3 3v6a4 4 0 0 0 4 4h6"/>', 12),
  'border-bottom-right-radius': svg('<path d="M13 3v6a4 4 0 0 1-4 4H3"/>', 12),
  // 粗细四条边：虚线框 + 那一条实边（Figma 的 Individual strokes 前缀）
  // 四条边（虚线框 + 那一条实边，Figma 的写法）：粗细、内外边距展开后共用
  'border-left-width':   EDGE.left,  'border-top-width':    EDGE.top,
  'border-right-width':  EDGE.right, 'border-bottom-width': EDGE.bottom,
  'padding-left':        EDGE.left,  'padding-top':         EDGE.top,
  'padding-right':       EDGE.right, 'padding-bottom':      EDGE.bottom,
  'margin-left':         EDGE.left,  'margin-top':          EDGE.top,
  'margin-right':        EDGE.right, 'margin-bottom':       EDGE.bottom,
  // 尺寸限制：min 是两个箭头挤向中线，max 是两条边界线夹着一个双向箭头；
  // 高度版本是同一组图形转 90°
  'min-width':  svg('<path d="M2 4l3 4-3 4"/><path d="M8 3v10"/><path d="M14 4l-3 4 3 4"/>', 12),
  'max-width':  svg('<path d="M2 3v10M14 3v10"/><path d="M4 8h8"/><path d="M6.5 5.5 4 8l2.5 2.5M9.5 5.5 12 8l-2.5 2.5"/>', 12),
  'min-height': svg('<path d="M4 2l4 3 4-3"/><path d="M3 8h10"/><path d="M4 14l4-3 4 3"/>', 12),
  'max-height': svg('<path d="M3 2h10M3 14h10"/><path d="M8 4v8"/><path d="M5.5 6.5 8 4l2.5 2.5M5.5 9.5 8 12l2.5-2.5"/>', 12),
  'line-height': svg(
    '<path d="M3.5 3.5v9"/><path d="M2 5 3.5 3.5 5 5"/><path d="M2 11l1.5 1.5L5 11"/>' +
    '<path d="M7 4h6.5M7 8h6.5M7 12h6.5"/>', 12),
  'letter-spacing': svg(
    '<path d="M2 3v10M14 3v10"/><path d="M5.6 11.5 8 5l2.4 6.5M6.4 9.6h3.2"/>', 12),
}

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
// 量的是布局盒（offsetWidth / offsetHeight），不是 getBoundingClientRect：
// 后者给的是 transform 之后的外接矩形，元素一带 rotate / scale，
// 比例锁锁住的就是那个歪掉的外接框比例，改宽时算出的高怎么校正都收敛不到。
// offset 尺寸就是边框盒的布局尺寸，不受 transform 影响，
// 和「比例按边框盒算、与 Figma 的 W/H 一致」的原意正好吻合。
const measure = el => {
  const prev = el.style.transition
  el.style.transition = 'none'
  const rect = { width: el.offsetWidth, height: el.offsetHeight }
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

// 三处眼睛按钮都是「存 inline 原文、再原样写回」。原文包含 priority：
// 样式表里带 important 的元素上，只写回值压不过它，一开一关就回不去了。
const inlineOf = (el, prop) => ({
  value: el.style.getPropertyValue(prop),
  important: el.style.getPropertyPriority(prop) === 'important',
})

// 两份 inline 快照是否已经对不上（元素数量或任何一条声明变了都算）。
// 用来判断「关灯之后有没有别人动过这几条属性」——有就不能再原文写回。
const stale = (before, now) => {
  if (!before || before.length !== now.length) return true
  return before.some((snap, i) => {
    const cur = now[i]
    if (!cur || cur.el !== snap.el) return true
    return Object.entries(snap.props).some(([prop, v]) =>
      cur.props[prop]?.value !== v.value || cur.props[prop]?.important !== v.important)
  })
}

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
  #split = new Map()   // 拆分行（圆角 / 粗细）的展开态：main → { for, expanded }
  // 被眼睛关掉的填充层。CSS 里没有「层可见性」这回事——关掉就是把那一层从
  // background-image 里删掉，所以要连同它原来的位置一起记着，才能原样放回去。
  // 跟比例锁一样绑在具体元素上，换元素即作废。
  #hiddenLayers = new Map()
  // 关掉某一层的那一刻，两条 background 属性的 inline 原文。再打开时原样放回
  #layerRestore = null
  // 文字色那一行的眼睛。字色不是 background 的一层，但它是文本元素的主填充，
  // 在 Figma 里就是 fill 列表里的一条，一样该能关掉
  #textColorRestore = null

  // 二级视图（目前只有网格设置）。有值时面板整体切过去，× 回到上级。
  #subview = null
  // 上一次渲染针对的是哪个元素，用来判断该不该接着上次的滚动位置
  #renderedFor = null
  // Typography 的「更多」是否展开（大小写、装饰线）
  #typoMore = false
  // 面板顶部的两个 tab：props = 属性分组，structure = 整页结构树
  #tab = 'props'
  #tree = null
  #treeScroll = null   // 面板重建前记下的树滚动位置
  // 读过一次本地字体后留着，供字体下拉框列出来
  #localFonts = []
  #unsubscribe = null
  #releaseScroll = null
  #dirtyProps = new Set()
  // 本次 render 里的颜色变量列表。每个颜色控件都会问一遍，铺一次样式表够用了
  #varCache = null
  #shared = false
  #sharedEls = []
  #ratio = null           // 宽高比锁：null = 未锁，数字 = 锁定的 w/h
  #ratioBusy = false
  #hiddenSections = new Map()
  #strokeShown = null   // 描边隐藏时行里该显示的颜色 / 绑定

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
    this.#hiddenLayers.clear()
    this.#layerRestore = null
    this.#textColorRestore = null
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
  get tab() { return this.#tab }
  setTab(next) {
    if (next === this.#tab) return
    this.#tab = next
    this.render()
    // 切到结构：此前树一直是 display:none，那时算的滚动全是 0，
    // 选中行多半在视口外。露出来之后补滚一次。
    if (next === 'structure') this.#tree?.reveal()
  }

  #scope() {
    return this.#shared
      ? [...new Set([...this.#targets, ...this.#sharedEls])]
      : this.#targets
  }

  // 面板外的快捷键（⌥⌘V 粘贴属性）也要写「选中 + 联动」这同一批元素。
  // 开一个只读出口而不是让它自己拼 selection + findSharedElements：
  // 联动开没开只有面板知道，复制一份判断迟早会和面板里的写入分叉。
  scope() { return this.#scope() }

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
  // 分区的「形状」：Stroke 有没有描边。撤销 / 重做 / 导入这些外部改动只回写
  // 已有的输入框，但它们可能让 Stroke 从空状态长出行来（撤销一次「移除描边」），
  // 或反过来——那时输入框根本不存在，只能整块重绘。
  // 只看描边，不看填充层数 / 效果条数：面板自己的写入也会走到这里，切个渐变
  // 就重绘会把正开着的填充弹层关掉（vr-fill 实例被换掉）。
  #structureKey() {
    return String(this.#canAdd('stroke'))
  }

  #syncValues() {
    const target = this.target
    if (!target?.isConnected) return

    const shapeBefore = this.#structureKey()
    this.#computed = readComputed(target)
    if (this.#structureKey() !== shapeBefore) return this.render()
    const active = this.#shadow.activeElement

    // 层里的 vr-fill 带的是 data-layer 不是 data-prop，扫不到这里，也不该扫到：
    // 它的值由 #renderFillLayers 按层写，整条 background 回写会把层序拍平
    for (const el of this.#shadow.querySelectorAll('[data-prop]')) {
      const prop = el.dataset.prop
      if (!prop || prop.includes(',')) continue

      // 字体框里只显示栈首那一个；整串是写回时才拼起来的，
      // 原样同步回去会把下拉框重新撑成「Georgia, "PingFang TC", …」
      const isNum = el.tagName === 'INPUT' && el.hasAttribute('data-num')
      const css = isNum ? this.#numSource(prop) : (this.#computed[prop] ?? '')
      const value = prop === 'font-family'
        ? primaryFont(css)
        // 圆角 / 粗细单框在四边不等时留空（占位「混合」），别把 "8px 0px 0px 0px" 整串塞进去
        : SPLIT_ROWS[prop] && this.#partsDiffer(SPLIT_ROWS[prop].parts)
          ? ''
          // 数值框里只放数字，单位在后缀里
          : isNum
            ? (CONTROLS[prop]?.unit ? displayValue(prop, css, this.#computed) : splitUnit(displayValue(prop, css, this.#computed)).num)
            : displayValue(prop, css, this.#computed)
      // 占位「混合」跟着四边是否相等走：单框敲了值四边一起变，占位得当场撤掉
      if (SPLIT_ROWS[prop])
        this.#partsDiffer(SPLIT_ROWS[prop].parts) ? el.setAttribute('placeholder', '混合') : el.removeAttribute('placeholder')

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

      // 数值框的「值」只有数字，单位落在 data-unit 与 .suffix 上，所以闸门要连单位
      // 一起比：45deg → 45turn、100px → 100% 这类「同数字异单位」的外部改动（撤销 /
      // 导入 / 重置）只比数字就整条跳过，后缀停在旧单位，下一次步进按它拼串（46turn
      // = 16560°，差 360 倍）
      const splitBlank = SPLIT_ROWS[prop] && this.#partsDiffer(SPLIT_ROWS[prop].parts)
      if (isNum && !splitBlank) {
        // 固定单位的字段（不透明度 / 字距的 %）data-unit 一直是空，别把它算成不等
        const unit = CONTROLS[prop]?.unit ? '' : splitUnit(displayValue(prop, css, this.#computed)).unit
        if (el.value !== value || (el.dataset.unit || '') !== unit) this.#showValue(el, prop, css)
      } else if (el.value !== value) el.value = value
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

    // 结构树是持久实例，但 innerHTML 重建会把它连同插槽一起摘下来再挂回去，
    // 重挂那一刻列表的 scrollTop 归零。换了元素也要留住树的位置：在树里点一行
    // 选中，行不该跑到别处去——跟属性 tab「换元素从头看」是两回事。
    // 只在树还挂着时记：在树里点一行会先「取消选中」再「选中新元素」，中间那次
    // 重绘树已经被摘掉了，这时再记就把真正的位置覆盖成空。
    if (this.#tree?.parentNode) this.#treeScroll = this.#tree.scrollOffset

    this.#dirtyProps = this.#dirtySet()
    this.#varCache = null

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
    // root.innerHTML 每次重建都会把树冲掉，所以挂载放在重建之后。
    // 树本身是复用的同一个实例，状态不丢。
    if (this.target) this.#mountTree()

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
      <div class="tabs">
        <button class="tab" data-tab="props"${this.#tab === 'props' ? ' data-on' : ''}>选择元素</button>
        <button class="tab" data-tab="structure"${this.#tab === 'structure' ? ' data-on' : ''}>结构</button>
      </div>
      <div class="scroll"${this.#tab === 'structure' ? ' hidden' : ''}>${sections}</div>
      <div class="structure"${this.#tab === 'structure' ? '' : ' hidden'}></div>
      <div class="toast"></div>`
  }

  // 结构树只建一次，在两个 tab 之间来回切时保留它自己的展开 / 滚动状态。
  // 每次重建的话，改一个属性面板重绘一次，树就会跟着收回顶层，没法用。
  // 树只上报意图，写入在这里：共享开着时，同一次移动要落到每一个同构容器上。
  // 「把第 3 个孩子挪到最前」这件事在结构相同的兄弟容器里是同一件事，
  // 按下标映射过去即可——不能按元素引用找，那些是不同的节点。
  //
  // 联动只覆盖「同一个父级里换位」。跨容器时另一个副本里对应的目标容器是谁，
  // 靠下标推不出来，猜错就是把元素搬到毫不相干的地方，宁可只动当前这一个。
  #applyMove({ el, toParent, toNext } = {}) {
    if (!el || !toParent) return

    const crossed = el.parentElement !== toParent
    const peers = this.#shared && !crossed
      ? findSharedElements(toParent).filter(c => c !== toParent)
      : []

    const kids = orderedChildren(toParent)
    const from = kids.indexOf(el)
    // -1 表示放到末尾。用「第几个孩子」而不是元素引用来映射：
    // 同构容器里的是另一批节点。
    const to = toNext ? kids.indexOf(toNext) : -1

    this.#batch('移动', () => {
      ChangeStore.moveElement(el, toParent, toNext)

      for (const c of peers) {
        const ckids = orderedChildren(c)
        // 同构容器的孩子数可能因内容不同而略有出入，越界就跳过这一个，
        // 而不是把顺序搬歪
        if (from < 0 || from >= ckids.length) continue
        ChangeStore.moveElement(ckids[from], c, to < 0 ? null : ckids[to] || null)
      }
    })

    if (crossed && this.#shared)
      this.#toast('跨容器移动只作用于当前元素')
    // 页面自己用 CSS order 排过版时，DOM 顺序和眼睛看到的顺序不是一回事。
    // 移动改的是 DOM，落点却是按视觉算的——这一句是提醒，不是错误。
    else if (Array.from(toParent.children).some(k => (parseInt(getComputedStyle(k).order, 10) || 0) !== 0))
      this.#toast('此容器用了 CSS order，视觉顺序可能与 DOM 顺序不同')

    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  #mountTree() {
    const slot = this.#shadow.querySelector('.structure')
    if (!slot) return
    if (!this.#tree) {
      this.#tree = document.createElement('visual-revise-tree')
      this.#tree.setAttribute('embedded', '')
      // 绑在树自己身上而不是走 #bind：那里是渲染完立刻扫 shadow，
      // 而树是渲染之后才挂进去的，那时还不存在，扫不到。
      this.#tree.addEventListener('vr-tree-move', e => this.#applyMove(e.detail))
    }
    if (this.#tree.parentNode !== slot) slot.appendChild(this.#tree)
    // 先把重建前的滚动位置还回去，再让树定位：行还在可视区里时 nearest 就是 no-op
    if (this.#treeScroll != null) { this.#tree.scrollOffset = this.#treeScroll; this.#treeScroll = null }
    // 整页结构，当前选中项高亮——和 DevTools 一致
    this.#tree.setTarget(this.target)
  }

  // 能不能再加一层。Fill 能叠（background-image 收逗号多层），Stroke 不能：
  // 实测 border-image-source 不吃逗号多层，写两层整条声明作废，
  // 而且它一旦非 none 就取代颜色绘制，跟 border-color 也叠不起来。
  #canAdd(id) {
    if (id !== 'stroke') return true
    // 四边可能不等（有的边是 0）：任一边有宽度就算有描边
    const w = Math.max(...SIDE_WIDTH_PROPS.map(p => parseFloat(this.#computed[p]) || 0), parseFloat(this.#computed['border-width']) || 0)
    const style = (this.#computed['border-style'] || '').trim()
    return !(w > 0 && style && style !== 'none')
  }

  #addTitle(id) {
    if (id === 'fill') return '添加填充'
    if (id === 'effects') return '添加效果'
    return this.#canAdd(id) ? '添加描边' : 'CSS 的 border 只有一层，不能再加'
  }

  // Typography 只给排得上版的元素。
  //
  // 选中一个只装着子元素的 div，面板给出一整块字体 / 字号 / 行高——那些属性
  // 确实会继承下去，但用户改的是子元素的样子，面板却说这是这个 div 的属性。
  // Figma 里容器图层根本没有 Typography 分区。
  //
  // 内联 <svg> 保留：它里面能放 <text>，也确实继承 font-*，但文字在子 <text>
  // 里而不是它的直接文本子节点，isTextElement 认不出来，得单独放行。
  //
  // 最后一条是兜底：本组已经有改动时照常渲染（折叠态）。VisBug 的快捷键能在
  // 任意元素上改字号，改动记录里躺着一条 font-size 却在面板上找不到地方改回去，
  // 比多显示一个分区糟得多。
  #showTypography(el) {
    if (!el || isTextlessElement(el)) return false
    if (isTextElement(el) || el.tagName.toLowerCase() === 'svg') return true
    return GROUP_TYPOGRAPHY.props.some(p => this.#dirtyProps.has(p))
  }

  // 「文字色」独占一行的条件，跟 hideMapFor 用的是同一条规则
  #showTextColor() {
    const el = this.target
    return !!el && isTextElement(el) && !isReplacedElement(el)
  }

  #renderGroup(group) {
    // Layout 完全自定义渲染：它的控件是按 Flow 组织的，不是一条属性一行，
    // 通用循环表达不了（见 #layoutRows）
    const rows =
      group.id === 'layout'     ? this.#layoutRows()
      : group.id === 'typography'
        ? (this.#showTypography(this.target) ? this.#typographyRows() : [])
      : this.#defaultRows(group)

    const body = rows.filter(Boolean)
    const layered = LAYERED.has(group.id)
    // 层列表分区空着也要出现：那个加号就是添加第一条的唯一入口
    if (!body.length && !layered) return ''

    const folded = this.#folded.has(group.id) ? ' folded' : ''
    const off = this.#hiddenSections.has(group.id)

    // 层列表分区的可见性下放到每一行（Figma 就是这样），标题上不再挂分区级眼睛
    const eye = HIDEABLE[group.id] && !layered
      ? `<button class="icon-btn eye" data-eye="${group.id}"${off ? ' data-on' : ''}
           title="${off ? '恢复本组' : '临时关闭本组'}">${off ? ICON.eyeOff : ICON.eye}</button>`
      : ''

    // variable 平时不占视觉噪音，鼠标进标题栏才出现——跟 Figma 的 default / hover 两态一致。
    // Effects 不给：页面上的 CSS 变量几乎都是颜色，列出来绑到 box-shadow 上
    // 没有意义；阴影变量另有一套（多段值、inset），等真有需求再单独做。
    const varBtn = group.id === 'effects' ? ''
      : `<button class="icon-btn var-btn" data-var="${group.id}" title="使用 CSS 变量">${ICON.variable}</button>`
    const adds = layered
      ? `${varBtn}
         <button class="icon-btn add" data-add="${group.id}"${this.#canAdd(group.id) ? '' : ' disabled'}
           title="${this.#addTitle(group.id)}">${ICON.plus}</button>`
      : ''

    return `<section data-group="${group.id}"${folded}${layered ? ' data-layered' : ''}>
      <h3>
        <span class="title">${group.label}</span>
        <span class="acts">
          ${eye}
          <button class="icon-btn undo" data-undo="${group.id}" title="重置本组改动">${ICON.undo}</button>
          ${adds}
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
    // font-family 是后备栈，框里只展示栈首那一个。
    // 整串塞进去会被截断成「Poppins, Poppins, "PingFang TC", "Micros…」——
    // 读到的反而是最不重要的那截，而决定字形的是第一个。
    const stack = this.#computed['font-family'] ?? ''
    const current = primaryFont(stack)
    const fontOptions = [...new Set([current, ...this.#localFonts, ...COMMON_FONTS].filter(Boolean))]

    rows.push(`<div class="field">
      <div class="with-action">
        <vr-select data-prop="font-family" value="${esc(current)}"
          options='${JSON.stringify(fontOptions).replace(/'/g, '&apos;')}'></vr-select>
        ${fontsBtn}
      </div>
    </div>`)

    // 字重 + 字号：Figma 把这两个放一行，也不加标签。
    // 字号那个框走 #renderControl（前缀 Aa 由 FIELD_PREFIX 给，外观一致），
    // 手写的那份没有后缀位：敲进 1.5em 后界面上只剩 "1.5"，看不见的 em 又会被
    // 补进下一次的裸数字，20 写成 20em、字号从 24px 跳到 320px
    rows.push(`<div class="field">
      <div class="typo-pair">
        <vr-select data-prop="font-weight"
          value="${esc(displayValue('font-weight', this.#computed['font-weight'] ?? ''))}"
          options='${JSON.stringify(CONTROLS['font-weight'].options)}'></vr-select>
        ${this.#renderControl('font-size', { dragPrefix: true })}
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

    // 替换元素（img / video / canvas / iframe…）的内容不会溢出盒子，裁切归 object-fit
    // 管，overflow 对它们无效。这一行以前无条件渲染，在 <img> 上显示成「已裁剪」
    // （UA 表给替换元素的 overflow 就是 clip），点一下毫无反应——isRelevant 里那段
    // 判定一直写着，只是从没人调用。
    if (isRelevant('overflow', this.#computed, el)) rows.push(this.#renderClip())

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

    // 间隔也是数值框：单位拆进 data-unit 与框外后缀，显示源与 #syncValues 同一条
    const gap = this.#numParts('gap', this.#numSource('gap'))

    return `<div class="align-gap">
      <div class="field">
        <label class="name">对齐</label>
        <div class="align-grid" data-flow="${flow}">${cells.join('')}</div>
      </div>
      <div class="field">
        <label class="name" data-prop="gap" data-drag>间隔</label>
        <div class="control">
          <input type="text" data-prop="gap" data-num data-unit="${esc(gap.unit)}"
            value="${esc(gap.num)}" title="gap">
          <span class="suffix">${gap.label}</span>
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
      return sideGroup ? this.#renderSides(sideGroup, kind) : ''
    }

    const cell = dir => {
      const props = set[dir]
      const value = pairDisplay(this.#computed, props, v => displayValue(props[0], v))

      // 两段式的框显示的是一对属性（相等时一个数、不等时 "10, 20"），单位谈不上，
      // 但后缀位得留着：拖手柄 / 方向键步进走的也是 #showValue，没有落点就只能
      // 把单位写进看不见的 data-unit
      return `<div class="control">
        <span class="prefix" data-drag data-pair="${kind}:${dir}">${SIDE_ICON[dir]}</span>
        <input type="text" data-pair="${kind}:${dir}" data-num data-unit=""
          value="${esc(value)}"
          title="${props.join(' / ')}">
        <span class="suffix"></span>
      </div>`
    }

    return `<div class="field">
      <label class="name" data-prop="${set.all.join(',')}">${set.label}</label>
      <div class="side-pair">
        ${cell('horizontal')}${cell('vertical')}
        <button class="icon-btn expand-sides" data-kind="${kind}"
          title="分别设置四边">${ICON.sides}</button>
      </div>
    </div>`
  }

  // 四条长手的计算值是不是不一样
  #partsDiffer(parts) {
    const v = parts.map(p => (this.#computed[p] || '').trim())
    return v.some(x => x !== v[0])
  }

  // 「拆分行」：<别的字段> | <简写字段> | [四边独立]，展开时下面再来一个 2×2。
  // 圆角是 左上 右上 / 左下 右下，粗细是 左 上 / 右 下（Figma 的顺序）。
  // 页面本身四边不等的元素第一次显示就展开——收着的话单框里只能写「混合」，
  // 用户还得先猜到要点那个按钮。之后开合由用户说了算，切换元素时再按新元素重判。
  #renderSplitRow(main, other) {
    const cfg = SPLIT_ROWS[main]
    let state = this.#split.get(main)
    if (!state || state.for !== this.target) {
      state = { for: this.target, expanded: this.#partsDiffer(cfg.parts) }
      this.#split.set(main, state)
    }
    const expanded = state.expanded
    const differ = this.#partsDiffer(cfg.parts)
    const spec = CONTROLS[main]

    // 单框：四边不等时留空、占位「混合」——在里面敲值写的是简写，四边一起变。
    // 控件本体走 #renderControl，不再手写一份：单位后缀 / data-unit / inline 优先的
    // 显示源都在那里，手写的那份漏掉后缀位，50% 和 1.5em 这类单位在界面上直接消失
    const single = `<div class="field">
      <label class="name" data-prop="${main}" data-drag title="${main}">${spec.label}</label>
      ${this.#renderControl(main, { placeholder: differ ? '混合' : '', blank: differ })}
    </div>`

    const grid = expanded ? `<div class="split-grid ${cfg.gridClass}">
      ${cfg.parts.map(p => this.#renderControl(p, { dragPrefix: true })).join('')}
    </div>` : ''

    // 按钮包在一个带占位标签的 field 里：同一行三个子项一样高，按钮落在输入框那一层
    return `<div class="split-block"><div class="split-row ${cfg.rowClass}">
      ${this.#renderField(other)}
      ${single}
      <div class="field corner-cell">
        <span class="name">&nbsp;</span>
        <button class="icon-btn corners-btn" data-split="${main}" ${cfg.attr}${expanded ? ' data-on' : ''}
          title="${expanded ? cfg.closeTitle : cfg.openTitle}">${ICON[cfg.icon]}</button>
      </div>
    </div>${grid}</div>`
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

    // 没有描边时 Stroke 是空状态：颜色/粗细/样式三行留着也没有意义，
    // 它们描述的是一条并不存在的边。加号才是这时唯一该有的东西。
    if (group.id === 'stroke' && this.#canAdd('stroke')) return rows

    // Fill 分区的第一行随元素类型变。Figma 里 Fill 的首行就是这个图层的主填充：
    // 对图片图层是那张图，对文本图层是字色，对形状是背景色。CSS 把这三件事拆成
    // 了互不相干的属性（src / color / background-*），所以这里按元素类型决定谁
    // 排最前，而不是写死一个顺序。
    if (group.id === 'fill') {
      const preview = this.#renderImageFill()
      if (preview) rows.push(preview)

      // 文字元素的主填充是字色。它不是 background 的一层——CSS 里 color 和
      // background 是两件独立的事——所以固定占一行，不参与下面的层列表。
      if (this.#showTextColor()) {
        rows.push(this.#renderTextColorRow())
        consumed.add('color')
      }

      rows.push(this.#renderFillLayers())
      consumed.add('background-color')
      consumed.add('background-image')
    }

    // Stroke 的颜色行照 Fill 的层行：右侧带隐藏和移除。CSS 的 border 只有一层，
    // 所以「移除」是整组一起走（宽度 / 样式 / 颜色），不是删掉某一层。
    if (group.id === 'stroke') {
      rows.push(this.#renderStrokeColorRow())
      consumed.add('border-color')
    }

    // Effects 整块换成效果列表。原来那三个直接写 CSS 原值的输入框去掉了：
    // 一个框里塞着 `rgb(255,255,255) 0 0 0 0, rgba(147,...` 这种东西，
    // 既读不出有几条阴影，也没法单独关掉其中一条。
    if (group.id === 'effects') {
      rows.push(this.#renderEffectRows())
      consumed.add('box-shadow'); consumed.add('filter'); consumed.add('backdrop-filter')
    }

    // fill 的填充控件已经在上面按层渲染，不再走单个 widget
    for (const name of (group.id === 'fill' ? [] : group.widgets || [])) {
      const widget = this.#renderWidget(name)
      if (widget) rows.push(widget)
    }

    const props = group.props
      .filter(prop => !WIDGET_OWNED.has(prop))
      .filter(prop => !HIDDEN_FIELDS.has(prop))
      // 字色跟排版属性一样需要一个「文字」作为作用对象：选中一个只装着子元素
      // 的 div，它自己没有文字，面板上却给一格文字色——改的是谁的颜色说不清楚
      .filter(prop => prop !== 'color' || this.#showTypography(this.target))
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

      // 共享标签的一组要先于普通配对判定：left/top 同时也在 FIELD_PAIRS 里，
      // 谁先匹配谁生效
      const labeled = LABELED_PAIRS.find(g => g.props.includes(prop))
      if (labeled && labeled.props.every(p => props.includes(p))) {
        labeled.props.forEach(p => consumed.add(p))
        rows.push(this.#renderLabeledPair(labeled))
        continue
      }

      const pair = FIELD_PAIRS.find(([a, b]) =>
        (a === prop && props.includes(b)) || (b === prop && props.includes(a)))

      if (pair && !consumed.has(pair[0]) && !consumed.has(pair[1])) {
        consumed.add(pair[0]); consumed.add(pair[1])
        // 圆角 / 粗细行右侧带「四边独立」按钮，展开后下面多一个 2×2 网格
        rows.push(SPLIT_ROWS[pair[1]]
          ? this.#renderSplitRow(pair[1], pair[0])
          : `<div class="pair">${this.#renderField(pair[0])}${this.#renderField(pair[1])}</div>`)
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
  // 面板看到的完整层列表 = CSS 里现存的层 + 被眼睛关掉、暂存在内存里的层，
  // 后者按当初的下标插回原位
  #fillLayers() {
    const all = bindFills(this.target, parseFills(this.#computed))
    for (const { at, layer } of this.#hiddenLayers.get('fill') || [])
      all.splice(Math.min(at, all.length), 0, { ...layer, hidden: true })
    return all
  }

  // 写回时把关掉的层滤掉，同时把它们的新位置记下来——上面加了一层，
  // 下面那些被关掉的层的下标要跟着挪，否则再打开就跑到别处去了。
  //
  // rerender 默认为真，但从色盘里改值那条路必须传 false：重绘会把 vr-fill
  // 整个换掉，而弹层认的是旧那个实例，一重绘正在调的色盘就当场消失。
  #writeFillLayers(all, { rerender = true } = {}) {
    // 整层存下来，不做字段白名单：漏掉 bound 的话眼睛一关一开，
    // 这一层的变量绑定就没了（跟旁边 #writeEffects 的写法对齐）
    const hidden = []
    all.forEach((l, at) => { if (l.hidden) hidden.push({ at, layer: { ...l, hidden: undefined } }) })
    hidden.length ? this.#hiddenLayers.set('fill', hidden) : this.#hiddenLayers.delete('fill')

    this.#writeBackground(all, this.#effectList(), '填充')
    if (rerender) this.render()
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  // 填充层和效果层（噪点 / 纹理）共用同一条 background-image，所以只能一起写。
  // 效果层排在前面——CSS 里第一层画在最上面，噪点本来就该盖在填充之上。
  #writeBackground(fills, effects, label) {
    const f = serializeFills(fills.filter(l => !l.hidden))
    const e = serializeEffects(effects)
    const fillImages = f['background-image'] === 'none'
      ? [] : splitTopLevel(f['background-image']).map(x => x.trim()).filter(Boolean)

    const css = {
      'background-color': f['background-color'],
      'background-image': [...e.backgroundLayers, ...fillImages].join(', ') || 'none',
      'box-shadow': e['box-shadow'],
      'filter': e['filter'],
      'backdrop-filter': e['backdrop-filter'],
    }

    this.#batch(label, () => {
      for (const [prop, value] of Object.entries(css)) this.#applyToAll(prop, value)
    })

    // 任何一次背景写入都让「关灯时存下的那份 inline 原文」过期：它描述的是关灯之前
    // 的状态，再开时原样写回会把这中间对别的层做的改动（改色、删层）静默回滚掉。
    // 关灯自己那一次也会走到这里，所以 #toggleLayer 是在 #writeFillLayers 返回之后
    // 才把这份原文落下来的。
    this.#layerRestore = null
  }

  // 面板看到的效果列表 = CSS 里读出来的 + 关掉后暂存的，按当初的下标插回
  #effectList() {
    const all = parseEffects(this.#computed)
    for (const { at, effect } of this.#hiddenLayers.get('effects') || [])
      all.splice(Math.min(at, all.length), 0, { ...effect, hidden: true })
    return all
  }

  #writeEffects(all, { rerender = true } = {}) {
    const hidden = []
    all.forEach((e, at) => { if (e.hidden) hidden.push({ at, effect: { ...e, hidden: undefined } }) })
    hidden.length ? this.#hiddenLayers.set('effects', hidden) : this.#hiddenLayers.delete('effects')

    this.#writeBackground(this.#fillLayers(), all, '效果')
    if (rerender) this.render()
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  // 层的可见性走「存原文 / 原样放回」，不走重新序列化。
  //
  // 序列化写回去的是 computed 的值，而元素本来可能压根没有 inline 声明——
  // 那样一开一关就凭空多出一条改动记录，用户什么都没改却看到「已改动」。
  // 关掉那一刻把两条属性的 inline 原文存下来，再打开时原样写回（空就是移除），
  // 才是真的还原。跟分区眼睛（#toggleSection）用的是同一套办法。
  #toggleLayer(i) {
    const all = this.#fillLayers()
    if (!all[i]) return

    const KEYS = ['background-color', 'background-image']
    const targets = this.#scope()

    const snapshot = () => targets.map(el => ({
      el,
      props: Object.fromEntries(KEYS.map(p => [p, inlineOf(el, p)])),
    }))

    if (all[i].hidden) {
      all[i] = { ...all[i], hidden: false }
      const saved = this.#layerRestore
      this.#layerRestore = null
      // 只有「关掉之后没动过别的」才能原样放回；中途改了别的层，
      // 那份原文已经过期，只能按当前层列表重新写。
      // 光比下标不够：以前这条守卫只问 saved.index === i，从不问「这中间有没有人
      // 动过 background」，于是关灯期间改的底色、删掉的层，一开眼睛就被原文冲回去
      // （连改动记录里都一并消失）。拿关灯那一刻写入的结果当对照，不等就走重算。
      if (saved && saved.index === i && !stale(saved.after, snapshot())) {
        // 原文写回等于这一层已经回到 CSS 里了，侧存储那条得跟着清掉。
        // 不清的话下一次 #fillLayers() 会把它当成「还藏着的层」再插一次，
        // 列表里凭空多出一行重复的层。
        const rest = (this.#hiddenLayers.get('fill') || []).filter(h => h.at !== i)
        rest.length ? this.#hiddenLayers.set('fill', rest) : this.#hiddenLayers.delete('fill')

        this.#batch('显示填充层', () => {
          saved.entries.forEach(({ el, props }) =>
            Object.entries(props).forEach(([p, { value, important }]) =>
              ChangeStore.applyProp(el, p, value, { important })))
        })
        this.render()
        this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
        return
      }
      return this.#writeFillLayers(all)
    }

    // 存原文要连 priority 一起存：样式表里带 important 的元素上，只写回值
    // 压不过样式表，一开一关就还原不回去了
    const entries = snapshot()
    all[i] = { ...all[i], hidden: true }
    this.#writeFillLayers(all)
    // 写完之后才落这份记录：#writeBackground 会清掉 #layerRestore（那正是「别的写入
    // 让原文过期」的机制），关灯这一次得排在它后面。after 是关灯写入的结果，
    // 再开时拿它跟当时的 inline 比一比就知道中途有没有人动过。
    this.#layerRestore = { index: i, entries, after: snapshot() }
  }

  // 文字色跟填充层长一样、也一样能关：对文本元素来说字色就是它的主填充，
  // 只不过 CSS 把它拆成了 color 这条独立属性，删不掉，所以没有减号。
  #renderTextColorRow() {
    const off = !!this.#textColorRestore
    const eye = `<button class="icon-btn layer-eye" data-text-eye
      title="${off ? '显示文字' : '隐藏文字'}">${off ? ICON.eyeOff : ICON.eye}</button>`

    const bound = this.#varBinding('color')
    const body = bound
      ? this.#renderBoundRow('color', bound, eye)
      : `<div class="layer-row${off ? ' off' : ''}">
           <vr-color data-prop="color" value="${esc(this.#computed.color)}"></vr-color>
           ${eye}
         </div>`

    return `<div class="field">
      <label class="name" data-prop="color">文字色</label>
      ${body}
    </div>`
  }

  // 跟层眼睛一样走「存 inline 原文 / 原样放回」：元素多半没有 inline color，
  // 重新序列化会把 computed 的值写死进去，一开一关白白多出一条改动记录
  #toggleTextColor() {
    const targets = this.#scope()
    if (!targets.length) return

    if (this.#textColorRestore) {
      const saved = this.#textColorRestore
      this.#textColorRestore = null
      this.#batch('显示文字', () => {
        saved.forEach(({ el, color }) =>
          ChangeStore.applyProp(el, 'color', color.value, { important: color.important }))
      })
    } else {
      this.#textColorRestore = targets.map(el => ({ el, color: inlineOf(el, 'color') }))
      this.#batch('隐藏文字', () => {
        targets.forEach(el => ChangeStore.applyProp(el, 'color', 'transparent'))
      })
    }

    this.render()
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  #renderEffectRows() {
    const list = this.#effectList()
    if (!list.length) return ''

    return `<div class="layers" data-layers="effects">${list.map((e, i) => `
      <div class="layer-row effect-row${e.hidden ? ' off' : ''}" data-effect-row="${i}">
        <button class="effect-open" data-effect-open="${i}">
          <span class="effect-name">${EFFECT_LABEL[e.type] || e.type}</span>
          <span class="effect-sum">${esc(this.#effectSummary(e))}</span>
        </button>
        <button class="icon-btn layer-eye" data-effect-eye="${i}"
          title="${e.hidden ? '显示' : '隐藏'}">${e.hidden ? ICON.eyeOff : ICON.eye}</button>
        <button class="icon-btn layer-del" data-effect-del="${i}" title="删掉">${ICON.minus}</button>
      </div>`).join('')}</div>`
  }

  // 行上只显示最能说明问题的那一两个数，细节在点开的参数面板里
  #effectSummary(e) {
    const p = { ...defaultsFor(e.type), ...e }
    if (e.type === 'drop-shadow' || e.type === 'inner-shadow') return `${p.x} ${p.y} ${p.blur}`
    if (e.type === 'glass') return `${p.blur}px · ${p.saturate}%`
    if (e.type === 'noise') return `${p.density}%`
    if (e.type === 'texture') return `${p.size}`
    return `${p.blur}px`
  }

  #effectMenu() {
    const anchor = this.#shadow.querySelector('.add[data-add="effects"]')
    if (!anchor) return
    openMenu(anchor, EFFECTS.map(e => ({ id: e.type, label: e.label })),
      type => {
        this.#folded.delete('effects')
        // 新效果加在列表最前：CSS 的 box-shadow 和 filter 都是前面的先画，
        // 跟 Figma 列表「上面的在上面」是同一个方向
        this.#writeEffects([{ type, ...defaultsFor(type) }, ...this.#effectList()])
      }, { align: 'right' })
  }

  // 参数面板。只列 CSS 真的做得到的几项——给一个调了没反应的滑块比不给更糟。
  #effectPanel(i) {
    const list = this.#effectList()
    const e = list[i]
    if (!e) return
    const row = this.#shadow.querySelector(`[data-effect-open="${i}"]`)
    if (!row) return

    const p = { ...defaultsFor(e.type), ...e }
    const fields = EFFECT_FIELDS[e.type] || []

    // 三列网格而不是逐行 flex：标签、输入区、单位各自对齐成一列。
    // 用 flex 的话颜色行没有单位那一格，输入区就比别的行宽出一截，
    // 右边缘参差不齐；而 vr-color 少了 min-width: 0 还会把自己顶出面板，
    // 后面的不透明度框和百分号直接被裁掉。
    const ROW = 'display:contents'
    const LABEL = 'font-size:11px;color:#9b9b9b;line-height:30px'
    const UNIT = 'font-size:10px;color:#6f6f6f;line-height:30px'
    const INPUT = 'width:100%;min-width:0;height:30px;padding:0 8px;box-sizing:border-box;'
      + 'font:400 11px/1 ui-monospace,Menlo,monospace;color:#fff;background:#383838;'
      + 'border:1px solid transparent;border-radius:5px;outline:none'

    openPopover(row, body => {
      body.innerHTML = `
        <div style="font:600 12px/1 system-ui;margin-bottom:10px;color:#fff">${EFFECT_LABEL[e.type]}</div>
        <div style="display:grid;grid-template-columns:46px minmax(0,1fr) 16px;gap:8px 8px;align-items:center">
          ${fields.map(([key, label, unit]) => `
            <span style="${LABEL}">${label}</span>
            ${unit === 'color'
              ? `<vr-color data-fx="${key}" value="${esc(p[key])}" style="min-width:0"></vr-color>`
              : `<input data-fx="${key}" value="${esc(p[key])}" inputmode="decimal" style="${INPUT}">`}
            <span style="${UNIT}">${unit === 'color' ? '' : unit}</span>`).join('')}
        </div>`

      const patch = (key, value) => {
        const next = this.#effectList()
        if (!next[i]) return
        next[i] = { ...next[i], [key]: value }
        // 不重绘：参数面板还开着，重绘会把锚点连同面板一起换掉
        this.#writeEffects(next, { rerender: false })
      }

      body.querySelectorAll('input[data-fx]').forEach(input =>
        input.addEventListener('change', () => {
          const n = parseFloat(input.value)
          if (Number.isFinite(n)) patch(input.dataset.fx, n)
        }))

      body.querySelectorAll('vr-color[data-fx]').forEach(c =>
        c.addEventListener('vr-color', ev => patch(c.dataset.fx, ev.detail.value)))
      // 264 而不是 232：颜色那一行要装下色块 + 色值 + 不透明度 + 百分号，
      // 232 时色值框只剩 43px，#000000 会被截成 #00。跟色盘弹层同宽。
    }, { align: 'right', width: 264 })
  }

  // 效果的可见性也走「存原文 / 原样放回」——一开一关不该留下改动记录
  #toggleEffect(i) {
    const all = this.#effectList()
    if (!all[i]) return
    all[i] = { ...all[i], hidden: !all[i].hidden }
    this.#writeEffects(all)
  }

  // 层列表的拖拽排序。
  //
  // 不用 HTML5 的 draggable：一是行里铺满了 <button>，按在它上面浏览器根本
  // 不发 dragstart；二是这套原生拖放在自动化里没法可靠驱动——CDP 的鼠标事件
  // 不会让浏览器合成拖放，而 Playwright 自己合成的那套时序有偏差（dragstart
  // 补发时鼠标已经移到目标行上，源被认成了目标）。pointer 事件两个问题都没有，
  // 跟结构树用的也是同一套路子。
  #bindRowDrag(kind) {
    const attr = kind === 'fill' ? 'data-fill-row' : 'data-effect-row'
    const rows = [...this.#shadow.querySelectorAll(`[${attr}]`)]
    if (rows.length < 2) return

    const read = () => kind === 'fill' ? this.#fillLayers() : this.#effectList()
    const write = list => kind === 'fill' ? this.#writeFillLayers(list) : this.#writeEffects(list)

    for (const row of rows) {
      row.addEventListener('pointerdown', e => {
        if (e.button !== 0) return
        // 按在眼睛或减号上是点按钮，不是拖行
        if (e.target.closest?.('.icon-btn')) return
        // 绑定层的 chip 在 vr-fill 的 shadow root 里，e.target 会被 retarget 成
        // 宿主，closest 看不到它——按在 chip 上是要开弹层，手抖超过 DRAG_SLOP
        // 不该变成重排。composedPath 才穿得过 shadow 边界。
        if (e.composedPath?.().some(n => n?.classList?.contains?.('var-chip'))) return

        const from = Number(row.getAttribute(attr))
        const startY = e.clientY
        let moved = false

        const move = ev => {
          if (!moved) {
            if (Math.abs(ev.clientY - startY) < DRAG_SLOP) return
            moved = true
            // 捕获推迟到真的开始拖：pointerdown 就捕获会把后续 click 的 target
            // 重定向到这一行，色块和参数面板就点不开了
            row.setPointerCapture(e.pointerId)
            row.setAttribute('data-dragging', '')
          }
          const hit = rows.find(r => {
            const b = r.getBoundingClientRect()
            return ev.clientY >= b.top && ev.clientY <= b.bottom
          })
          rows.forEach(r => r.removeAttribute('data-drop'))
          if (hit && hit !== row) hit.setAttribute('data-drop', '')
        }

        const up = ev => {
          row.removeEventListener('pointermove', move)
          row.removeEventListener('pointerup', up)
          if (row.hasPointerCapture?.(ev.pointerId)) row.releasePointerCapture(ev.pointerId)
          row.removeAttribute('data-dragging')

          const target = rows.find(r => r.hasAttribute('data-drop'))
          rows.forEach(r => r.removeAttribute('data-drop'))
          if (!moved || !target) return

          const to = Number(target.getAttribute(attr))
          const list = read()
          const [dragged] = list.splice(from, 1)
          list.splice(to, 0, dragged)
          write(list)
        }

        row.addEventListener('pointermove', move)
        row.addEventListener('pointerup', up)
      })
    }
  }

  // 这一格是不是绑在 CSS 变量上。
  //
  // getComputedStyle 会把 var() 解析成最终颜色，从它身上看不出绑定，所以要去
  // 读声明原文。原文不止 inline 一处：绝大多数页面的变量引用写在样式表里
  // （.card { background: var(--surface) }），只看 inline 会把它们全当成死色值。
  // 由 cascade.js 在 inline 和命中的样式表规则里挑出层叠赢家，这里只管判断
  // 赢家是不是 var()。
  //
  // 字色会继承：<p> 自己没写 color，字色来自 .card { color: var(--ink) }。
  // Figma 没有继承这回事，但用户看到的就是「这段字的颜色来自那个变量」，
  // 所以顺着祖先往上找到第一条声明为止。
  #varBinding(prop) {
    const el = this.target
    if (!el) return null

    for (let node = el, depth = 0; node; node = node.parentElement, depth++) {
      const decl = winningDeclaration(node, prop)
      if (decl) {
        // 显式 inherit 只是把问题往上推
        if (decl.value === 'inherit' && INHERITED.has(prop)) continue
        return this.#bindingFrom(el, node, decl, prop, depth)
      }
      if (!INHERITED.has(prop)) return null
    }
    return null
  }

  // 赢家声明 → 绑定信息，不是 var() 或者对不上就 null。
  //
  // 长手（background-color: var(--x)）要整条值就是那个 var()；简写
  // （border: 1px solid var(--line)）允许它只是其中一段，但只能有一段，
  // 而且解析出来得是颜色——border: var(--w) solid red 里的 var 不算。
  //
  // 最后拿解析出的颜色跟 computed 核对：层叠判定是近似的（@layer 的
  // important 反转、@container 条件这些没做），核对不过就当没绑定——
  // 宁可显示色值，也不显示一个错的变量名。
  #bindingFrom(el, node, decl, prop, depth) {
    const token = decl.prop === prop ? wholeVar(decl.value) : (() => {
      const tokens = varTokens(decl.value)
      return tokens.length === 1 ? tokens[0] : null
    })()
    if (!token) return null

    const cs = getComputedStyle(el)
    const resolved = cs.getPropertyValue(token.name).trim() || token.fallback
    if (!parseColor(resolved).valid) return null
    if (!sameColor(resolved, cs.getPropertyValue(prop))) return null

    const where = decl.source === 'inline'
      ? `${decl.prop}: ${decl.value}`
      : `${decl.selector} { ${decl.prop}: ${decl.value} }`
    return {
      name: token.name,
      fallback: token.fallback,
      raw: depth ? `继承自 ${describeNode(node)}：${where}` : where,
      source: decl.source,
      inherited: depth > 0,
    }
  }

  // 绑定态的行：一整块 chip（圆点 + 变量名），不再分色块 / 色值 / 不透明度三段。
  // 绑了变量，色值就不该在这里改——要改是去改那个变量。点 chip 重开变量菜单换绑。
  // dot / unlinkAttr 参数化：填充层的圆点取的是该层的解析色（不是整条属性的
  // computed），unlink 也要落到那一层而不是把整条 background-image 拍平。
  // 描边的颜色行。隐藏态下 computed 已经是透明色、inline 也不再是 var()，
  // 行里显示的颜色和 chip 要从隐藏时记下的那份来，不然一关灯格子就变成
  // 一块透明色、绑定的 chip 也没了，看着像设置被清掉。
  #renderStrokeColorRow() {
    const off = this.#hiddenSections.has('stroke')
    const shown = off ? this.#strokeShown : null
    const tail = `<button class="icon-btn layer-eye" data-stroke-eye
        title="${off ? '显示描边' : '隐藏描边'}">${off ? ICON.eyeOff : ICON.eye}</button>
      <button class="icon-btn layer-del" data-stroke-del title="移除描边">${ICON.minus}</button>`

    const bound = off ? shown?.bound : this.#varBinding('border-color')
    const color = off ? (shown?.color || 'transparent') : this.#computed['border-color']
    const body = bound
      ? this.#renderBoundRow('border-color', bound, tail, { dot: color })
          .replace('class="layer-row bound"', `class="layer-row bound${off ? ' off' : ''}"`)
      : `<div class="layer-row${off ? ' off' : ''}">
           <vr-color data-prop="border-color" value="${esc(color)}"></vr-color>
           ${tail}
         </div>`

    return `<div class="field">
      <label class="name" data-prop="border-color">颜色</label>
      ${body}
    </div>`
  }

  // 移除描边：整组一起走。style 写 none 让它真的消失，width 归零让导出的
  // 提示词一眼看出「这条边没了」，inline 的 border-color 清掉——再点加号是
  // 一条新描边，不该带着旧颜色。一个 batch，⌘Z 一次整组回来。
  #removeStroke() {
    const targets = this.#scope()
    if (!targets.length) return
    this.#hiddenSections.delete('stroke')
    this.#batch('移除描边', () => {
      this.#applyToAll('border-style', 'none')
      this.#applyToAll('border-width', '0')
      targets.forEach(el => ChangeStore.applyProp(el, 'border-color', ''))
    })
    this.render()
    this.#toast('已移除描边')
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  #renderBoundRow(prop, binding, tail, { dot, unlinkAttr } = {}) {
    const shown = dot || this.#computed[prop] || 'transparent'
    return `<div class="layer-row bound">
      <span class="var-chip" role="button" data-var-chip="${prop}"
        title="${esc(binding.raw)}（点击换绑）">
        <span class="var-dot" style="background:${esc(shown)}"></span>
        <span class="var-name">${esc(binding.name)}</span>
      </span>
      <button class="icon-btn unlink" ${unlinkAttr || `data-unlink="${prop}"`}
        title="断开绑定（保留当前颜色）">${ICON.unlink}</button>
      ${tail}
    </div>`
  }

  // 断开绑定：把 var() 换成它此刻解析出来的实际颜色。绑定没了，画面不变——
  // 这正是 Figma 那个 unlink 的语义，不是「清空这一格」。
  #unlink(prop) {
    const targets = this.#scope()
    if (!targets.length) return

    this.#batch('断开变量绑定', () => {
      targets.forEach(el => {
        const resolved = getComputedStyle(el).getPropertyValue(prop).trim()
        if (resolved) ChangeStore.applyProp(el, prop, resolved)
      })
    })
    this.render()
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  #renderFillLayers() {
    const layers = this.#fillLayers()
    if (!layers.length) return ''

    return `<div class="layers" data-layers="fill">${layers.map((l, i) => {
      const tail = `<button class="icon-btn layer-eye" data-layer-eye="${i}"
          title="${l.hidden ? '显示这一层' : '隐藏这一层'}">${l.hidden ? ICON.eyeOff : ICON.eye}</button>
        <button class="icon-btn layer-del" data-layer-del="${i}" title="删掉这一层">${ICON.minus}</button>`

      // 绑定态的触发器就是这一层的 vr-fill（带 bound 时它自己渲染成 chip），
      // 点它开的还是填充弹层，只不过停在变量页——行里没有 vr-fill 实例的话，
      // chip 的点击无处可去（填充弹层是实例方法，模块外没有入口）。
      const bound = l.bound ? ` bound="${esc(l.bound)}"` : ''
      const unlink = l.bound
        ? `<button class="icon-btn unlink" data-unlink-layer="${i}"
             title="断开绑定（保留当前颜色）">${ICON.unlink}</button>`
        : ''

      // 每层的色值和不透明度由 vr-fill 自己渲染：纯色态给两个能敲的框，
      // 渐变和图片退回只读摘要——它们没有单一色值，也没有单层不透明度可填
      return `<div class="layer-row${l.hidden ? ' off' : ''}${l.bound ? ' bound' : ''}"
        data-layer="${i}" data-fill-row="${i}">
        <vr-fill data-layer="${i}"${bound}
          color="${esc(l.kind === 'solid' ? l.value : 'transparent')}"
          image="${esc(l.kind === 'solid' ? 'none' : l.value)}"></vr-fill>
        ${unlink}
        ${tail}
      </div>`
    }).join('')}</div>`
  }

  // 断开某一层的绑定：只清这一层的 bound 再整体写回。
  // 不能走 #unlink('background-image')——那会把整条属性（所有层）拍平成
  // 解析后的一长串，别的层跟着遭殃。
  #unlinkLayer(i) {
    const all = this.#fillLayers()
    if (!all[i]?.bound) return
    all[i] = { ...all[i], bound: null }
    this.#batch('断开变量绑定', () => this.#writeFillLayers(all))
    this.#toast(`已断开 ${all.length > 1 ? `第 ${i + 1} 层` : '填充'}的变量绑定`)
  }

  // Figma 把新层加在最上面，CSS 的 background-image 第一层也画在最上面，
  // 两边的「第一条」是同一个意思，直接 unshift
  #addLayer(id) {
    if (!this.#canAdd(id)) return
    // 收起的分区加了东西也看不见，点下去像是没反应
    this.#folded.delete(id)

    if (id === 'fill') {
      this.#writeFillLayers([{ kind: 'solid', value: DEFAULT_FILL }, ...this.#fillLayers()])
      return
    }

    // 描边只有一条。CSS 里「有描边」是三条属性同时成立，缺一条都画不出来：
    // 宽度为 0 或 style 为 none 时，border-color 写了也看不见。
    // 只写宽度和样式，不碰 border-color：它默认取 currentColor，新描边跟着
    // 元素字色走本来就是合理的起点。写死一个灰反而把用户原有的配色抹掉了。
    this.#batch('添加描边', () => {
      this.#applyToAll('border-style', 'solid')
      this.#applyToAll('border-width', '1px')
    })
    this.render()
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  // 分区标题栏的「绑定变量」：先定绑到哪条属性上，再开那一处的变量页。
  //
  // 跟分区首行显示的是什么保持一致：文字元素的主填充是字色（见 #defaultRows
  // 的 fill 特判），绑 background-color 就绑错了地方——用户看着「文字色」
  // 那一行点的变量，结果染的是背景。
  #varEntry(groupId) {
    const anchor = this.#shadow.querySelector(`.var-btn[data-var="${groupId}"]`)
    if (!anchor) return

    if (groupId === 'stroke') {
      // 空状态下 border-color 绑了也看不见（border-width: 0 / style: none），
      // 先把描边立起来再绑，否则点完什么都没发生
      if (this.#canAdd('stroke')) {
        this.#addLayer('stroke')
        const fresh = this.#shadow.querySelector('.var-btn[data-var="stroke"]')
        if (!fresh) return
        return this.#openColorVariables('border-color', fresh, 'right')
      }
      return this.#openColorVariables('border-color', anchor, 'right')
    }

    if (this.#showTextColor()) return this.#openColorVariables('color', anchor, 'right')

    // 容器：绑的是垫底那一层填充。一层都没有时先加一层默认纯色——
    // 没有层就没有那一行，也就没有能承载 chip 的地方
    if (!this.#fillLayers().length) this.#addLayer('fill')
    const fills = this.#shadow.querySelectorAll('section[data-group="fill"] vr-fill[data-layer]')
    fills[fills.length - 1]?.openVariables()
  }

  // 变量列表：页面上声明过的全部自定义属性，按选中元素解析取值，只留颜色。
  //
  // 值从 this.target 身上读而不是 :root——同一个变量可能在某个容器里被重新
  // 赋值，色圈要显示的是它在这个元素上实际的颜色。
  //
  // 结果缓存到本次 render 结束（render 开头清空）：一次渲染里每个颜色控件都会
  // 问一遍，每次都铺一遍全部样式表太浪费。注意 cascade.js 自己还有 50ms 的
  // flatten 缓存，两层叠加后在 DevTools 里改样式表最长要等 50ms + 一次 render
  // 才反映——那不是 bug。
  #colorVariables() {
    if (this.#varCache) return this.#varCache
    const el = this.target
    if (!el) return { variables: [], others: 0 }

    // 目标在 shadow root 里时，它自己那份样式表也算数
    const roots = [document]
    const root = el.getRootNode()
    if (root instanceof ShadowRoot) roots.push(root)

    const cs = getComputedStyle(el)
    const all = [...new Set(roots.flatMap(r => declaredVariables(r)))]
      .map(name => ({ name, value: (cs.getPropertyValue(name) || '').trim() }))
      .filter(v => v.value)

    // 挑颜色的时候把字体栈和 12px 也列出来毫无意义——点了也 apply 不上，
    // 只是让人在几十项里多翻几屏
    const variables = all.filter(v => varKind(v.value) === 'color')
      .sort((a, b) => a.name.localeCompare(b.name))

    this.#varCache = { variables, others: all.length - variables.length }
    return this.#varCache
  }

  // 打开某条颜色属性的弹层并停在变量页。chip 和标题栏按钮都走这里。
  #openColorVariables(prop, anchor, align) {
    const { variables, others } = this.#colorVariables()
    openColorPopover(anchor, {
      value: this.#computed[prop] || '',
      variables, others,
      bound: this.#varBinding(prop)?.name || null,
      page: 'variable',
      align,
      onColor: css => this.#commit(prop, css, { coerce: false }),
      onVariable: name => this.#bindVariable(prop, name),
    })
  }

  // 「绑定变量」= 把这一格的值写成 var(--x)。写的是 inline，所以它压过样式表
  // 里原有的引用；改动记录和导出的提示词里存的都是 var(--x) 原文，AI 拿到的
  // 是变量名而不是一个死色值。
  //
  // 顺序不能变：关弹层（renderVariableList 已经关了）→ 写入 → render → toast。
  // #commit 对颜色属性不触发重绘（RERENDER_ON 只有 position / display），
  // 不显式 render 的话格子不会换成 chip。
  //
  // 多选时写的是 #scope() 的全部元素，chip 只反映 this.target。
  #bindVariable(prop, name) {
    if (!name || this.#varBinding(prop)?.name === name) return
    this.#commit(prop, `var(${name})`, { coerce: false })
    this.render()
    this.#toast(`${prop} → var(${name})`)
  }

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

    // base 是这一会话已经入库的素材总量：20MB 的上限是「一次会话累计」，
    // 不带基数的话每一批都从 0 起算，上限等于形同虚设
    const { assets, errors } = await pickImages({ base: totalBytes(ChangeStore.allAssets()) })
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
      // 固定尺寸时输入框里就是那个数字（显示源与 #syncValues 同一条：inline 优先，
      // 单位拆进 data-unit 与后缀，否则 width:20em 先显示 280、一回读又跳成 20）；
      // 其余模式下数字是实测值，真正生效的是模式，所以把模式名摆在旁边
      const { num, unit, label } = mode === 'fixed'
        ? this.#numParts(axis, this.#numSource(axis))
        : { num: `${size[axis]}`, unit: '', label: '' }

      return `<div class="control resize-cell" data-axis="${axis}">
        <span class="prefix" data-drag data-prop="${axis}">${AXES[axis].prefix}</span>
        <input type="text" data-prop="${axis}" data-num value="${esc(num)}" data-unit="${esc(unit)}" title="${axis}">
        <span class="suffix">${label}</span>
        <button class="mode" data-axis="${axis}" data-mode="${mode}"
          title="${MODES[mode].label}｜点击切换尺寸模式">
          <span class="mode-name">${MODES[mode].label}</span>
          <i class="mode-caret"></i>
        </button>
      </div>`
    }

    // 尺寸限制按需出现，排布跟着上面的 W / H 两列走：
    // 左列管宽度的上下限，右列管高度的，每条限制配自己的标签。
    //
    // 原来是「最小 [W][H]」横一行、共用一个窄标签。两条限制同时存在时，
    // 得在「最小 / 最大」和「左边是宽、右边是高」两个维度之间来回对，
    // 而且和内边距 / 外边距那种「一行一件事」的节奏也不一致。
    // 现在每条限制自己一格、自己一个名字，扫一眼就知道是谁。
    const limitCols = () => {
      const kinds = ['min', 'max']
      const has = (axis, kind) => this.#hasLimit(AXES[axis][kind])
      if (!['width', 'height'].some(a => kinds.some(k => has(a, k)))) return ''

      const col = axis => {
        const items = kinds.filter(k => has(axis, k)).map(kind => {
          const prop = AXES[axis][kind]
          const label = `${kind === 'min' ? '最小' : '最大'}${AXES[axis].label}度`
          const shown = this.#numParts(prop, this.#numSource(prop))
          return `<div class="field">
            <label class="name" data-prop="${prop}" data-drag title="${prop}">${label}</label>
            <div class="control limit">
              <span class="prefix is-icon" data-drag data-prop="${prop}">${PREFIX_ICON[prop] || FIELD_PREFIX[prop]}</span>
              <input type="text" data-prop="${prop}" data-num data-unit="${esc(shown.unit)}"
                value="${esc(shown.num)}" title="${prop}">
              <span class="suffix">${shown.label}</span>
              <button class="drop-limit" data-prop="${prop}" title="移除这条限制">×</button>
            </div>
          </div>`
        })
        // 空列不铺占位框：只加了最小宽度时，右边就该是空的
        return `<div class="limit-col">${items.join('')}</div>`
      }

      return `<div class="limits">${col('width')}${col('height')}</div>`
    }

    return `<div class="field">
      <label class="name" data-prop="width,height">尺寸</label>
      <div class="dims">
        ${cell('width')}${cell('height')}
        <button class="icon-btn ratio"${this.#ratio ? ' data-on' : ''}
          title="锁定宽高比">${ICON.link}</button>
      </div>
      ${limitCols()}
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

    const patch = planResize(el, axis, id, this.#computed)
    this.#batch(`${A.label}：${MODES[id].label}`, () => {
      for (const [prop, value] of Object.entries(patch)) this.#applyToAll(prop, value ?? '')
    })

    this.#computed = readComputed(el)
    this.render()
    this.toast(`${A.label}：${MODES[id].label}`)
  }

  #renderSides(sg, kind = null) {
    // 展开就是为了分别改：四边各自独立，没有联动锁——要联动就不会把它们拆开。
    // 按钮跟圆角 / 粗细的「四边独立」同一个图标，展开时高亮，再点收回两段式。
    // 网格顺序 左 上 / 右 下：左列管左右、右列管上下，跟收起态「水平 | 垂直」两段
    // 的左右位置一致，展开前后同一列改的是同一组边（也是粗细四边的顺序）。
    const order = ['left', 'top', 'right', 'bottom'].map(side => sg.props.find(p => p.endsWith(`-${side}`)))

    return `<div class="field">
      <label class="name" data-prop="${sg.props.join(',')}">${sg.label}</label>
      <div class="sides">
        ${order.map(p => {
          // 显示源与 #syncValues 同一条：inline 优先、单位拆进 data-unit 与后缀。
          // 这里若用计算值，padding:2em 展开后先显示 28，点一下别处回读又跳回 2em
          const { num, unit, label } = this.#numParts(p, this.#numSource(p))
          return `
          <div class="control">
            <span class="prefix is-icon" data-drag data-prop="${p}">${PREFIX_ICON[p] || ''}</span>
            <input type="text" data-prop="${p}" data-num data-side data-unit="${esc(unit)}"
              value="${esc(num)}" title="${p}">
            <span class="suffix">${label}</span>
          </div>`
        }).join('')}
        ${kind ? `<button class="icon-btn collapse-sides" data-kind="${kind}" data-on
          title="合并成水平 / 垂直两项">${ICON.sides}</button>` : ''}
      </div>
    </div>`
  }

  // 控件本体，不带标签。拆出来是为了让「一个标签罩两个字段」那种排布
  // （Figma 的 Position = 一个「位置」配 X/Y 两个框）能复用同一套控件。
  // dragPrefix：标签被合并掉之后，拖着调值的手柄改由前缀承担。
  // blank / placeholder：拆分行的收起态单框在四边不等时留空、占位「混合」，
  // 除此之外与普通数值框一模一样，所以由这里出，而不是再手写一份模板
  #renderControl(prop, { dragPrefix = false, placeholder = '', blank = false } = {}) {
    const spec = CONTROLS[prop]
    if (!spec) return ''

    // 颜色类字段绑了变量就换成 chip：色值不再由这里改，要改是去改那个变量
    if (spec.type === 'color') {
      const bound = this.#varBinding(prop)
      if (bound) return this.#renderBoundRow(prop, bound, '')
    }
    const css = spec.type === 'num' ? this.#numSource(prop) : (this.#computed[prop] ?? '')
    const value = displayValue(prop, css, this.#computed)
    const prefix = FIELD_PREFIX[prop]
    // 固定单位（不透明度 / 字距的 %）由 spec.unit 给；其它按当前值拆。
    // 留空的框没有值也就没有单位，后缀跟着空
    const shown = blank ? { num: '', unit: '', label: '' } : this.#numParts(prop, css)

    return (() => {
      switch (spec.type) {
        case 'select': {
          const options = spec.options.includes(value) || !value
            ? spec.options
            : [value, ...spec.options]
          return `<vr-select data-prop="${prop}" value="${esc(value)}"${spec.preview ? ` preview="${spec.preview}"` : ''}
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
            ${prefix ? `<span class="prefix${PREFIX_ICON[prop] ? ' is-icon' : ''}"${dragPrefix && spec.type === 'num' ? ` data-drag data-prop="${prop}"` : ''}>${PREFIX_ICON[prop] || prefix}</span>` : ''}
            <input type="text" data-prop="${prop}" data-num value="${esc(shown.num)}" data-unit="${esc(shown.unit)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>
            <span class="suffix">${shown.label}</span>
          </div>`
      }
    })()
  }

  // 数值框显示用的值：元素自己的 inline 优先，没有才用计算值。计算值永远是 px，
  // 用户敲的 1.5em 一经回读就变成 22.5px，单位后缀跟着丢——inline 里存的才是
  // 用户的写法。var() / calc() 这类不是数值的 inline 不拿来显示。
  #numSource(prop) {
    const inline = (this.target?.style.getPropertyValue(prop) || '').trim()
    // 多段简写（border-radius: 10px 20px）也不是「一个数」：整串塞进数值框只会
    // 把文本摆出来、还拆不出单位——退回计算值，由它给出这一条的那个数字
    return inline && !/\s/.test(inline) && !/\b(var|calc|min|max|clamp)\(/.test(inline)
      ? inline
      : (this.#computed[prop] ?? '')
  }

  // 一个 CSS 值在数值框里的三件套：数字进框、单位记在 data-unit 上、后缀文本放框外。
  // 渲染路径（#renderControl 与几处手写模板）和写入路径（#showValue）都从这里取：
  // 各算各的时候总有一处会漏掉后缀，单位就只剩看不见的 data-unit，界面开始说谎。
  #numParts(prop, css) {
    const spec = CONTROLS[prop]
    const text = displayValue(prop, css, this.#computed)
    const shown = spec?.unit ? { num: text, unit: '' } : splitUnit(text)
    return { ...shown, label: spec?.unit || UNIT_LABEL[shown.unit] || shown.unit }
  }

  // 把一个 CSS 值显示到数值框里：数字进框、单位进右侧的后缀、真正的单位记在
  // data-unit 上——提交时框里若只有数字，就把这个单位补回去
  #showValue(input, prop, css) {
    const { num, unit, label } = this.#numParts(prop, css)
    input.value = num
    input.dataset.unit = unit
    const suffix = input.parentElement?.querySelector('.suffix')
    if (suffix) suffix.textContent = label
    // 缺后缀位就意味着单位只剩看不见的 data-unit：框里写着 1.5、写出去的却是
    // 1.5em，下一次的裸数字还会被补上这个看不见的单位。静默跳过等于放任界面说谎
    else console.warn(`[visual-revise] ${prop} 的数值框缺少 .suffix，单位「${label || '(空)'}」无处显示`)
  }

  #renderField(prop) {
    const spec = CONTROLS[prop]
    if (!spec) return ''
    const draggable = spec.type === 'num' ? ' data-drag' : ''
    return `<div class="field">
      <label class="name" data-prop="${prop}"${draggable} title="${prop}">${spec.label}</label>
      ${this.#renderControl(prop)}
    </div>`
  }

  // 一个标签罩住两个字段：标签说的是「这一组是什么」，
  // 具体哪个是哪个交给框里的前缀（X / Y）——和 Figma 的 Position 一致。
  #renderLabeledPair(group) {
    const controls = group.props
      .map(p => this.#renderControl(p, { dragPrefix: true }))
      .join('')
    return `<div class="field">
      <label class="name" data-prop="${group.props.join(',')}" title="${group.props.join(' / ')}">${group.label}</label>
      <div class="pair">${controls}</div>
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
    let value = coerce && spec?.coerce ? spec.coerce(raw) : raw

    // 下拉框交上来的是单个字体名。写回时只替换栈首，后备原样留着——
    // 直接写死一个名字会把中文后备字体一起丢掉，英文看着没事，
    // 页面上的中文会掉回浏览器默认字形。
    if (prop === 'font-family') value = withPrimaryFont(this.#computed[prop], value)
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
    if (input) this.#showValue(input, other, `${value}px`)
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
        Object.entries(props).forEach(([p, { value, important }]) =>
          ChangeStore.applyProp(el, p, value, { important })))
      this.#hiddenSections.delete(id)
    } else {
      // 描边行在隐藏态还要显示原来的颜色 / chip，关灯前先记下
      if (id === 'stroke') this.#strokeShown = {
        bound: this.#varBinding('border-color'),
        color: this.#computed['border-color'],
      }
      // 每个元素单独求一次 map：联动选中里可能既有文字元素又有容器，
      // 该关字色的关字色，该只关背景的只关背景
      this.#hiddenSections.set(id, targets.map(el => ({
        el,
        props: Object.fromEntries(
          Object.keys(hideMapFor(id, el)).map(p => [p, inlineOf(el, p)])),
      })))
      targets.forEach(el =>
        Object.entries(hideMapFor(id, el)).forEach(([p, v]) => ChangeStore.applyProp(el, p, v)))
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
    on('[data-stroke-eye]', 'click', e => { e.stopPropagation(); this.#toggleSection('stroke') })
    on('[data-stroke-del]', 'click', e => { e.stopPropagation(); this.#removeStroke() })
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

    on('[data-split]', 'click', e => {
      e.stopPropagation()
      const main = e.currentTarget.dataset.split
      const state = this.#split.get(main) || { for: this.target, expanded: false }
      this.#split.set(main, { for: this.target, expanded: !state.expanded })
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
    on('.tab', 'click', e => {
      const next = e.currentTarget.dataset.tab
      if (next === this.#tab) return
      this.#tab = next
      this.render()
      // 页面上直接拖 flex / grid 子元素，只在看着结构时开着——
      // 它会接管页面的指针事件，属性 tab 下开着会挡住正常的选中
      this.dispatchEvent(new CustomEvent('vr-tab', {
        bubbles: true, composed: true, detail: { tab: next },
      }))
    })

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

      // 直接补进下拉框的选项，不再走 datalist 那套自动补全——
      // 现在字体是选出来的，不是敲出来的
      this.#localFonts = result.fonts
      this.render()
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

      // 单位在后缀里、不在框里：只敲了数字就把当前单位补回去（22.5 → 22.5px），
      // 带单位的输入原样放行（换单位）。固定单位的字段（%）由 coerce 自己处理
      let raw = el.value
      if (el.hasAttribute('data-num') && el.dataset.unit && /^-?[\d.]+$/.test(raw.trim()))
        raw = raw.trim() + el.dataset.unit
      const next = CONTROLS[prop]?.coerce?.(raw) ?? raw

      // 与当前实际值相同就不是一次编辑。程序同步字段值后浏览器可能
      // 补发 change，若照单提交会把刚被外部撤销的改动又写回去。
      //
      // 不提交也要把框刷回「数字 + 后缀」：用户敲的可能是等价写法（框里是 45 + °，
      // 他敲 45deg），原文留在框里而 data-unit 还是 deg，下一次步进就拼成 45degdeg
      // —— 非法声明被 CSSOM 丢掉，元素纹丝不动，框里的数字却照常往上走
      if (sameValue(next, this.#computed[prop])) {
        if (el.hasAttribute('data-num') && el.isConnected) this.#showValue(el, prop, this.#numSource(prop))
        return
      }

      this.#commit(prop, raw)
      // 提交后框还聚焦着，#syncValues 会跳过它：这里自己把数字 / 后缀刷新一次，
      // 否则用户敲了 1.5em 之后框里留着 1.5em、后缀还挂着 px，下一次步进就拼成 1.5empx
      if (el.hasAttribute('data-num') && el.isConnected) this.#showValue(el, prop, this.#numSource(prop))
    })

    // 填充控件一次可能改两条属性；detail 里为 null 的那条表示「不动它」
    // 每个填充层一个 vr-fill，回来的 {color, image} 要落回它自己那一层，
    // 而不是整块 background——多层之间互不干扰全靠这个下标
    on('vr-fill[data-layer]', 'vr-fill', e => {
      const i = Number(e.currentTarget.dataset.layer)
      const { color, image } = e.detail
      const all = this.#fillLayers()
      if (!all[i]) return

      // image 为 null 是 vr-fill 的「这一步别动图片」信号：切到纯色标签、
      // 但还没真的选颜色。多层模型下这一层仍是那张图，什么都不该改——
      // 光是点进去看一眼就把人家的背景图换成灰色太狠了。
      if (image === null && all[i].kind !== 'solid') return

      const next = image && image !== 'none'
        ? { kind: parseFills({ 'background-image': image })[0]?.kind || 'image', value: image }
        : { kind: 'solid', value: color }

      // 值被清空（选了「无填充」）等于删掉这一层
      // 删层要重绘（那一行没了），单纯改值不能重绘——色盘还开着
      if (!next.value || next.value === 'transparent') {
        all.splice(i, 1)
        this.#writeFillLayers(all)
      } else {
        all[i] = { ...next, hidden: all[i].hidden }
        this.#writeFillLayers(all, { rerender: false })
        // 不重绘就得手动把新值同步回这个 vr-fill：它读的是自己的 color/image
        // 属性，不同步的话还停在上一次渲染的值上——切去渐变时会拿旧颜色
        // 当第一档，看着就像「刚调的色被忽略了」
        const host = e.currentTarget
        host.setAttribute('color', next.kind === 'solid' ? next.value : 'transparent')
        host.setAttribute('image', next.kind === 'solid' ? 'none' : next.value)
      }
    })

    // 填充弹层里的「从电脑上传」：控件只发意图，读文件和记素材在这边
    on('vr-fill[data-layer]', 'vr-fill-pick-image', async e => {
      const i = Number(e.currentTarget.dataset.layer)
      // 同 #swapImage：累计上限要带上已入库的量当基数
      const { assets, errors } = await pickImages({ base: totalBytes(ChangeStore.allAssets()) })
      if (errors.length) this.toast(errors[0], 'error')
      const asset = assets[0]
      if (!asset) return

      ChangeStore.addAsset(asset)
      const all = this.#fillLayers()
      if (!all[i]) return
      all[i] = { kind: 'image', value: `url("${asset.dataUrl}")`, hidden: all[i].hidden }
      this.#writeFillLayers(all)
    })

    on('[data-unlink]', 'click', e => {
      e.stopPropagation()
      this.#unlink(e.currentTarget.dataset.unlink)
    })

    // 填充层的 unlink 只清这一层的 bound，不能走 #unlink——
    // 那会把整条 background-image 拍平，别的层跟着遭殃
    on('[data-unlink-layer]', 'click', e => {
      e.stopPropagation()
      this.#unlinkLayer(Number(e.currentTarget.dataset.unlinkLayer))
    })

    on('[data-var]', 'click', e => {
      e.stopPropagation()
      this.#varEntry(e.currentTarget.dataset.var)
    })

    // 点已绑定的 chip：重开变量页换绑。弹层贴 chip 左缘——chip 在行的最左边
    on('[data-var-chip]', 'click', e => {
      e.stopPropagation()
      this.#openColorVariables(e.currentTarget.dataset.varChip, e.currentTarget, 'left')
    })

    // 变量页选中一项：颜色控件写 var()，填充层记在自己那一层上
    on('vr-color[data-prop]', 'vr-color-variable', e =>
      this.#bindVariable(e.currentTarget.dataset.prop, e.detail.name))

    on('vr-fill[data-layer]', 'vr-fill-variable', e => {
      const i = Number(e.currentTarget.dataset.layer)
      const all = this.#fillLayers()
      if (!all[i] || all[i].bound === e.detail.name) return
      all[i] = { ...all[i], bound: e.detail.name }
      this.#writeFillLayers(all)
      this.#toast(`填充 → var(${e.detail.name})`)
    })

    // 变量数据打开时才问：几十项的列表走属性会被序列化进每一个控件，
    // 还会触发 attributeChangedCallback 把触发行整块重建。
    // bound 也放在闭包里现算——render 之后每个控件都算一次太浪费。
    for (const c of shadow.querySelectorAll('vr-color[data-prop]'))
      c.variablesProvider = () => ({
        ...this.#colorVariables(),
        bound: this.#varBinding(c.dataset.prop)?.name || null,
      })
    for (const f of shadow.querySelectorAll('vr-fill[data-layer]'))
      f.variablesProvider = () => this.#colorVariables()

    on('[data-add]', 'click', e => {
      e.stopPropagation()
      // 效果不是「加一条默认的」，而是先挑类型——七种效果的参数完全不同
      if (e.currentTarget.dataset.add === 'effects') return this.#effectMenu()
      this.#addLayer(e.currentTarget.dataset.add)
    })

    this.#bindRowDrag('fill')
    this.#bindRowDrag('effects')

    on('[data-effect-open]', 'click', e => {
      e.stopPropagation()
      this.#effectPanel(Number(e.currentTarget.dataset.effectOpen))
    })

    on('[data-effect-eye]', 'click', e => {
      e.stopPropagation()
      this.#toggleEffect(Number(e.currentTarget.dataset.effectEye))
    })

    on('[data-effect-del]', 'click', e => {
      e.stopPropagation()
      const i = Number(e.currentTarget.dataset.effectDel)
      const all = this.#effectList()
      if (!all[i]) return
      all.splice(i, 1)
      this.#writeEffects(all)
    })

    on('[data-text-eye]', 'click', e => {
      e.stopPropagation()
      this.#toggleTextColor()
    })

    on('[data-layer-eye]', 'click', e => {
      e.stopPropagation()
      this.#toggleLayer(Number(e.currentTarget.dataset.layerEye))
    })

    on('[data-layer-del]', 'click', e => {
      e.stopPropagation()
      const i = Number(e.currentTarget.dataset.layerDel)
      const all = this.#fillLayers()
      if (!all[i]) return
      all.splice(i, 1)
      this.#writeFillLayers(all)
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

    // Figma 式：横向拖动标签（或 W/H 前缀）调数值
    on('[data-drag]', 'pointerdown', e => {
      const handle = e.currentTarget
      // 两段式间距的手柄管的是一对属性（上下 / 左右），只挂了 data-pair、没有 data-prop。
      // 以前这里直接拿 handle.dataset.prop 当属性名，undefined 一路带到
      // applyProp(el, undefined, '30px') 被 CSSOM 丢弃，而输入框照常刷成新值——
      // 界面在说谎。这里把一对属性解出来：第一条驱动步长 / 单位 / 显示（两边同值，
      // 取哪条都一样），提交时两条一起写。
      const pair = handle.dataset.prop ? '' : (handle.dataset.pair || '')
      const pairProps = pair ? pairPropsOf(pair) : null
      const prop = handle.dataset.prop || pairProps?.[0]
      const input = handle.dataset.prop
        ? shadow.querySelector(`input[data-prop="${handle.dataset.prop}"]`)
        : shadow.querySelector(`input[data-pair="${pair}"]`)
      if (!input || !prop) return

      e.preventDefault()
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const origin = input.value + (input.dataset.unit || '')
      const unitStep = stepSize(prop, false)
      let last = null

      const move = ev => {
        const steps = Math.round((ev.clientX - startX) / 2)
        const next = stepValue(prop, origin, steps * unitStep, this.#computed[prop], this.#computed)
        if (next === null || next === last) return
        last = next
        this.#showValue(input, prop, next)
        if (!pairProps) return this.#commit(prop, next, { coerce: false })
        // 一步一个 batch：⌘Z 不会把一对属性撤成一半
        this.#batch(SIDE_SETS[pair.split(':')[0]].label, () =>
          pairProps.forEach(p => this.#commit(p, next, { coerce: false })))
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
      // 两段式间距的输入框和它的前缀手柄一样只有 data-pair，方向键这条路
      // 同样得把那一对属性解出来，否则按一下也是往 undefined 上写
      const pairProps = input.dataset.prop ? null : pairPropsOf(input.dataset.pair)
      const prop = input.dataset.prop || pairProps?.[0]
      if (!prop) return
      const delta = stepSize(prop, e.shiftKey) * (e.key === 'ArrowUp' ? 1 : -1)
      // 框里只有数字，单位在 data-unit 上：拼回去再步进，否则会按计算值的单位走
      const next = stepValue(prop, input.value + (input.dataset.unit || ''), delta, this.#computed[prop], this.#computed)

      if (next === null) return   // normal / auto 等无法步进的值
      this.#showValue(input, prop, next)
      if (!pairProps) return this.#commit(prop, next, { coerce: false })
      this.#batch(SIDE_SETS[input.dataset.pair.split(':')[0]].label, () =>
        pairProps.forEach(p => this.#commit(p, next, { coerce: false })))
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

      // moveTo 顺手把面板夹在视口内，免得标题栏被拖出屏幕后再也抓不回来
      const move = ev => moveTo(this, ev.clientX - offX, ev.clientY - offY)
      const up = ev => {
        handle.releasePointerCapture(ev.pointerId)
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        // 只在松手时落一次盘：pointermove 每帧都触发，
        // 每帧写一次 localStorage 是同步 I/O，拖起来会顿
        savePlacement(this)
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
}

customElements.define('visual-revise-panel', PropsPanel)
