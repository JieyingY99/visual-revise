/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { parseFills } from './fills.js'

// 控件规格：决定属性面板里每个 CSS 属性用什么控件呈现。
// type 说明：
//   num     数值输入（label 可横向拖动调值）
//   sides   四值编辑（上右下左，带联动锁）
//   select  下拉
//   segment 分段按钮
//   color   颜色
//   text    自由文本

const LENGTH_KEYWORDS = ['auto', 'none', 'inherit', 'initial', 'unset', 'fit-content', 'max-content', 'min-content']

export const isLengthLike = value => {
  const v = String(value).trim().toLowerCase()
  return !LENGTH_KEYWORDS.includes(v) && /^-?[\d.]+/.test(v)
}

// 用户输入 24 时补 px，输入 1rem / 50% / auto 时原样保留
export const coerceLength = raw => {
  const v = String(raw).trim()
  if (!v) return ''
  if (LENGTH_KEYWORDS.includes(v.toLowerCase())) return v
  if (/^-?[\d.]+$/.test(v)) return `${v}px`
  return v
}

export const coerceNumber = raw => {
  const v = String(raw).trim()
  return v === '' ? '' : v
}

// 不透明度在面板里按百分比走（Figma 的写法：1 就是 100%）。框里敲的是 0–100，
// 写进 CSS 的是 0–1；末尾带不带 % 都认，越界夹回 0–100。
export const coercePercent = raw => {
  const v = String(raw).trim().replace(/%$/, '').trim()
  if (v === '') return ''
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return v
  const clamped = Math.min(100, Math.max(0, n))
  return String(Math.round(clamped * 1000) / 1000 / 100)
}

// 字距按字号的百分比走（Figma 的写法）。CSS 的 letter-spacing 不收百分比，em 正好是
// 「相对字号」：5% → 0.05em；0 写回 normal（写 0em 会在改动里留一条什么都没做的记录）。
// 带明确单位的原样放行。
export const coerceLetterSpacing = raw => {
  const v = String(raw).trim().replace(/%$/, '').trim()
  if (v === '') return ''
  if (!/^-?[\d.]+$/.test(v)) return v
  const n = parseFloat(v)
  if (!Number.isFinite(n) || n === 0) return 'normal'
  return `${Math.round(n / 100 * 10000) / 10000}em`
}

// 计算值（px）→ 百分比：字距 ÷ 当前字号。normal 就是 0。em 值（步进算出来的中间值）直接乘 100
export const letterSpacingPercent = (value, computed) => {
  const v = String(value ?? '').trim()
  if (!v || v === 'normal') return '0'
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return v
  if (/em$/i.test(v)) return String(Math.round(n * 1000) / 10)
  const fs = parseFloat(computed?.['font-size']) || 16
  return String(Math.round(n / fs * 1000) / 10)
}

// CSS 的 0–1 → 面板显示的 0–100
export const fractionToPercent = value => {
  const n = parseFloat(value)
  return Number.isFinite(n) ? String(Math.round(n * 100 * 100) / 100) : String(value ?? '')
}

// 角度：裸数字补 deg；'none' 与各种写法的 0 都视为「没有旋转」，
// 写成 0deg 会在改动列表里留下一条什么都没做的记录
export const coerceAngle = raw => {
  const v = String(raw).trim()
  if (!v || /^none$/i.test(v)) return ''
  if (/^-?0(\.0+)?(deg|rad|turn|grad)?$/i.test(v)) return ''
  if (/^-?[\d.]+$/.test(v)) return `${v}deg`
  return v
}

const num  = (label, opts = {}) => ({ type: 'num',  label, coerce: coerceLength, ...opts })
const plain = (label, opts = {}) => ({ type: 'num', label, coerce: coerceNumber, ...opts })
const sel  = (label, options, extra = {}) => ({ type: 'select', label, options, ...extra })
const seg  = (label, options)    => ({ type: 'segment', label, options })
const col  = label               => ({ type: 'color', label })
const txt  = label               => ({ type: 'text', label })
const ang  = (label, opts = {}) => ({ type: 'num', label, coerce: coerceAngle, ...opts })

export const CONTROLS = {
  // 布局
  'display':          sel('显示', ['block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'inline-block', 'inline', 'none']),
  'flex-direction':   seg('方向', [['row', '横向'], ['column', '纵向'], ['row-reverse', '横向反'], ['column-reverse', '纵向反']]),
  'flex-wrap':        seg('换行', [['nowrap', '不换'], ['wrap', '换行']]),
  'justify-content':  sel('主轴对齐', ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']),
  'align-items':      sel('交叉轴对齐', ['stretch', 'flex-start', 'center', 'flex-end', 'baseline']),
  'gap':              num('间隔'),
  'row-gap':          num('行间隔'),
  'column-gap':       num('列间隔'),
  'order':            plain('排序'),

  // 尺寸
  'width':      num('宽'),
  'height':     num('高'),
  'min-width':  num('最小宽'),
  'min-height': num('最小高'),
  'max-width':  num('最大宽'),
  'max-height': num('最大高'),

  // 间距（由 sides 控件统一处理，此处仅供 diff 与导出识别）
  'padding-top': num('上'), 'padding-right': num('右'),
  'padding-bottom': num('下'), 'padding-left': num('左'),
  'margin-top': num('上'), 'margin-right': num('右'),
  'margin-bottom': num('下'), 'margin-left': num('左'),

  // 定位
  'position': sel('定位', ['static', 'relative', 'absolute', 'fixed', 'sticky']),
  'top':      num('上'), 'right': num('右'), 'bottom': num('下'), 'left': num('左'),
  'z-index':  plain('层级'),
  // 独立的 rotate 属性而不是 transform: rotate()：计算值直接就是 '45deg'，
  // 而 transform 的计算值是 matrix(...)，要反解角度且和缩放/倾斜混在一起
  'rotate':   ang('旋转'),

  // 文字
  'font-family':    txt('字体'),
  'font-size':      num('字号'),
  'font-weight':    sel('字重', ['100', '200', '300', '400', '500', '600', '700', '800', '900']),
  'line-height':    plain('行高'),
  'letter-spacing': num('字距', { unit: '%', step: 1, coerce: coerceLetterSpacing, toDisplay: letterSpacingPercent }),
  'text-align':     seg('对齐', [['left', '左'], ['center', '中'], ['right', '右'], ['justify', '两端']]),
  'text-transform': sel('大小写', ['none', 'uppercase', 'lowercase', 'capitalize']),
  'text-decoration-line': sel('装饰线', ['none', 'underline', 'line-through', 'overline']),

  // 外观
  'opacity':       plain('不透明度', { step: 1, min: 0, max: 100, unit: '%', coerce: coercePercent, toDisplay: fractionToPercent }),
  'border-radius': num('圆角'),
  // 四角独立（Figma 的 Independent corners）：只在圆角行展开时渲染，见 HIDDEN_FIELDS
  'border-top-left-radius':     num('左上'),
  'border-top-right-radius':    num('右上'),
  'border-bottom-left-radius':  num('左下'),
  'border-bottom-right-radius': num('右下'),
  // 四边独立粗细（Figma 的 Individual strokes）：只在粗细行展开时渲染
  'border-top-width':    num('上'),
  'border-right-width':  num('右'),
  'border-bottom-width': num('下'),
  'border-left-width':   num('左'),
  'overflow':      sel('溢出', ['visible', 'hidden', 'scroll', 'auto', 'clip']),

  // 填充
  // color 归在这里而不是「文字」段：实测 Figma 里文本图层的 fills[0] 就是字色，
  // Fill 是「这个图层被什么填充」的统一抽象，对文字/图片/形状分别是字色/图/背景色
  'color':            col('文字色'),
  'background-color': col('背景色'),
  'background-image': txt('背景图'),
  'background-size':     sel('背景尺寸', ['auto', 'cover', 'contain']),
  'background-position': txt('背景位置'),
  // 对应 Figma 图片填充的 scaleMode（Fill / Fit / Crop / Tile）
  'object-fit':       sel('图片适配', ['fill', 'contain', 'cover', 'none', 'scale-down']),
  'object-position':  txt('图片位置'),

  // 描边
  'border-width': num('粗细'),
  // preview: 'border' 让下拉把线型直接画出来（solid 一条实线、dashed 一条虚线），不只写名字
  'border-style': sel('样式', ['none', 'solid', 'dashed', 'dotted', 'double'], { preview: 'border' }),
  'border-color': col('颜色'),
  // Figma 的 Stroke position（inside/outside/center）在 CSS 里就是 box-sizing：
  // border-box 边框吃进尺寸内 = 内描边，content-box 边框撑大盒子 = 外描边。
  // center 没有对应写法，故只给两项。
  'box-sizing':   seg('位置', [['border-box', '内'], ['content-box', '外']]),

  // 效果
  'box-shadow':      txt('阴影'),
  'filter':          txt('滤镜'),
  'backdrop-filter': txt('背景滤镜'),
}

// Figma 把成对的字段并排放：X/Y、W/H、水平/垂直内边距。
// 这里声明哪些属性构成一对，渲染时合并到同一行的两列里。
// width/height 不在此列——它们用带比例锁的连体控件单独渲染。
// 面板上不再单独给这两个留字段——Figma 的 Position 只给 X/Y，
// 右/下在实际改稿里几乎用不到，却常年占着一整行。
//
// 只是不渲染，仍然留在 tracked-props 里继续跟踪：那个数组是双重职责
// （渲染顺序 + 跟踪清单），从那里删掉的话，用户在别处改的 right / bottom
// 就不会进改动记录、也不会导出到提示词，那是另一回事。
// 圆角的四个角：展开态的 2×2 网格里按这个顺序排（左上 右上 / 左下 右下）
export const CORNER_PROPS = [
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
]

// 粗细的四条边：展开态的 2×2 网格按 Figma 的顺序排（左 上 / 右 下）
export const SIDE_WIDTH_PROPS = [
  'border-left-width', 'border-top-width',
  'border-right-width', 'border-bottom-width',
]

export const HIDDEN_FIELDS = new Set([
  'right', 'bottom',
  // 四个角 / 四条边由圆角行、粗细行自己按展开状态渲染，不走默认的逐字段列表
  ...CORNER_PROPS, ...SIDE_WIDTH_PROPS,
  // 背景图不再单独给一行文本框：填充控件（vr-fill）已经同时管着
  // background-color 与 background-image，两处编辑同一件事只会让人犹豫
  // 该改哪个。仍然继续跟踪——换图走的就是这条属性。
  'background-image',
])

// 一个标签罩住两个字段。Figma 的 Position 面板就是一个「位置」配 X / Y 两个框，
// 不给每个框单独起名——框里的前缀已经说清楚了谁是谁，再各配一个「左」「上」
// 是重复标注，还白占一行的宽度。
export const LABELED_PAIRS = [
  { label: '位置', props: ['left', 'top'] },
]

export const FIELD_PAIRS = [
  ['left', 'top'],
  ['right', 'bottom'],
  // 旋转在前：它比 z-index 常用，Figma 的 Position 也是把旋转摆在显眼处
  ['rotate', 'z-index'],
  ['justify-content', 'align-items'],
  ['min-width', 'min-height'],
  ['max-width', 'max-height'],
  ['row-gap', 'column-gap'],
  ['font-size', 'line-height'],
  ['letter-spacing', 'font-weight'],
  ['opacity', 'border-radius'],
  // 样式在左、粗细在右：粗细右侧还要挂「四边独立」按钮
  ['border-style', 'border-width'],
]

// 输入框内嵌的前缀标识，替代冗长的中文标签
export const FIELD_PREFIX = {
  'width': 'W', 'height': 'H',
  'min-width': 'W', 'min-height': 'H',
  'max-width': 'W', 'max-height': 'H',
  'left': 'X', 'top': 'Y', 'right': 'R', 'bottom': 'B',
  'padding-top': '↑', 'padding-right': '→', 'padding-bottom': '↓', 'padding-left': '←',
  'margin-top': '↑', 'margin-right': '→', 'margin-bottom': '↓', 'margin-left': '←',
  'gap': '↔', 'row-gap': '↕', 'column-gap': '↔',
  'font-size': 'Aa', 'line-height': '↕', 'letter-spacing': 'AV',
  'opacity': '◍', 'border-radius': '◜', 'z-index': 'Z', 'order': '#',
  'border-top-left-radius': '◜', 'border-top-right-radius': '◝',
  'border-bottom-left-radius': '◟', 'border-bottom-right-radius': '◞',
  'border-top-width': '▭', 'border-right-width': '▭', 'border-bottom-width': '▭', 'border-left-width': '▭',
  'border-width': '▭', 'rotate': '∠',
}

// 计算值里这些关键字等同「没设置」，直接显示在输入框里只会碍事
const BLANK_WHEN = {
  'rotate': ['none'],
  'background-image': ['none'],
  'box-shadow': ['none'],
  'filter': ['none'],
  'backdrop-filter': ['none'],
}

// px 是这些字段的默认单位，写在框里只是噪音——Figma 的尺寸/间距框里就只有
// 数字。写回时 coerceLength 会把裸数字补回 px，来回是等价的。
//
// 只对「会自动补 px」的字段这么做。line-height 这类接受纯数字的属性不能碰：
// 24px 与 24 语义完全不同（后者是 24 倍行高），去掉单位等于改了含义。
// 非 px 的写法（1rem / 50% / auto / calc(...)）一律原样显示。
const PX_ONLY = /^-?[\d.]+px$/

export const stripDefaultUnit = (prop, value) => {
  const v = String(value ?? '').trim()
  if (!PX_ONLY.test(v)) return value ?? ''
  return CONTROLS[prop]?.coerce === coerceLength ? v.slice(0, -2) : value
}

// computed：有的换算要看别的属性（字距的百分比按字号算）
export const displayValue = (prop, value, computed) =>
  (BLANK_WHEN[prop] || []).includes(String(value ?? '').trim())
    ? ''
    : CONTROLS[prop]?.toDisplay
      ? CONTROLS[prop].toDisplay(value, computed)
      : stripDefaultUnit(prop, value)

// 间距组用合并控件呈现，不逐条渲染
export const SIDE_GROUPS = [
  { base: 'padding', label: '内边距', props: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] },
  { base: 'margin',  label: '外边距', props: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] },
]

export const SIDE_PROPS = new Set(SIDE_GROUPS.flatMap(g => g.props))

// 仅在容器为 flex/grid 时才有意义的属性，避免面板堆满无效控件
export const FLEX_ONLY = new Set([
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
  'gap', 'row-gap', 'column-gap',
])

// order 作用在 flex/grid 子项上，取决于父容器而非自身
export const FLEX_CHILD_ONLY = new Set(['order'])

// 这些属性接受纯数字，补上单位会让声明非法而被 CSSOM 静默丢弃
export const UNITLESS = new Set([
  'opacity', 'z-index', 'order', 'font-weight', 'flex-grow', 'flex-shrink',
])

// line-height 既可以是纯数字，也可以是长度或 normal
const UNITLESS_OR_LENGTH = new Set(['line-height'])

// 关键字值没有确定数值，但用户按方向键时期待「能开始调」。
// 给这类属性一个明确的首次落点，之后按常规步进。
const KEYWORD_START = {
  'line-height': '1.5',
  'rotate': '0deg',
}

// CONTROLS 里声明的 min / max 一直是两个没人读的死键，于是不透明度能按到
// -0.1、拖一把到 -4.9，浏览器渲染时自己夹到 0（画面看不出来），导出的提示词里
// 却是一个非法区间的数字。所有步进都从这里出，夹一次就够。
const clampToSpec = (prop, n) => {
  const spec = CONTROLS[prop]
  if (!spec) return n
  if (typeof spec.min === 'number' && n < spec.min) return spec.min
  if (typeof spec.max === 'number' && n > spec.max) return spec.max
  return n
}

// 这条属性的默认单位：拿它自己的 coerce 去问，而不是在这里再抄一份属性名清单
// （coerceAngle('1') === '1deg'、coerceLength('1') === '1px'、coerceNumber 不补）。
const defaultUnit = prop => {
  const coerce = CONTROLS[prop]?.coerce
  if (typeof coerce !== 'function') return ''
  return String(coerce('1')).match(/[a-z%]+$/i)?.[0] || ''
}

// 面板会写出去的单位就这些。正则从文本尾巴上抠出来的东西不校验就直接拼回值里，
// 框里一旦被污染（"45degdeg" —— 框里留着原文 45deg 又拼上 data-unit 的 deg）
// 就会写出 46degdeg：一条被 CSSOM 静默丢弃的声明，元素不动而框里的数字照常往上走。
// 认不出来的单位宁可不动，也好过让界面说谎。
const STEP_UNITS = new Set([
  // 长度
  'px', 'em', 'rem', 'ex', 'ch', 'cap', 'ic', 'lh', 'rlh',
  'vw', 'vh', 'vmin', 'vmax', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh',
  'cm', 'mm', 'q', 'in', 'pt', 'pc',
  // 百分比 / 角度 / 时间 / 栅格
  '%', 'deg', 'rad', 'grad', 'turn', 's', 'ms', 'fr',
])

const knownUnit = text => {
  const u = String(text ?? '').match(/[a-z%]+$/i)?.[0]
  return u && STEP_UNITS.has(u.toLowerCase()) ? u : ''
}

// 步进一个数值：无法数值化的值（normal / auto / inherit）回落到计算值；
// 仍无法数值化时，要么落到 KEYWORD_START，要么返回 null
// 表示这次按键应当忽略，而不是写入一个会被 CSSOM 丢弃的垃圾值。
export const stepValue = (prop, raw, delta, fallback = '', computed) => {
  const usable = v => /^-?[\d.]/.test(String(v ?? '').trim())
  // 步进在「面板显示」的空间里算：不透明度的框里是 0–100，计算值却是 0–1，
  // fallback 得先换到显示空间，min / max 也是按显示空间声明的
  const shown = CONTROLS[prop]?.toDisplay ? CONTROLS[prop].toDisplay(fallback, computed) : fallback
  const source = usable(raw) ? String(raw).trim() : String(shown ?? '').trim()

  if (!usable(source)) return KEYWORD_START[prop] ?? null

  const num = parseFloat(source)
  if (!Number.isFinite(num)) return KEYWORD_START[prop] ?? null

  const next = clampToSpec(prop, Math.round((num + delta) * 1000) / 1000)

  // 显示空间里算完，交出去的得是 CSS 值：不透明度 31 → 0.31。调用方拿它直接
  // 写（coerce: false），再用 displayValue 换回框里显示的 31
  if (CONTROLS[prop]?.toDisplay) return CONTROLS[prop].coerce(String(next))
  if (UNITLESS.has(prop)) return String(next)

  // 框里的文本推不出单位时不能一律补 px：旋转框在 Enter 之后仍聚焦，#syncValues
  // 跳过聚焦中的字段，框里留着用户敲的裸数字「45」，补 px 就写出 rotate:46px——
  // 非法声明被 CSSOM 静默丢弃，元素纹丝不动而框里显示 46px，此后怎么敲都写不进去。
  // 所以先看 fallback（计算值 '45deg'）带的单位，再问这条属性的 coerce 该补什么。
  const fallbackText = String(fallback ?? '').trim()
  // 框里的单位不认识就整步作废：拼一个 46degdeg 出去只会被 CSSOM 丢掉，
  // 而框里的数字还是会往上走一格 —— 那正是「界面在说谎」的样子
  const typed = source.match(/[a-z%]+$/i)?.[0]
  if (typed && !STEP_UNITS.has(typed.toLowerCase())) return null
  const unit = typed
    || (usable(fallbackText) ? knownUnit(fallbackText) : '')
    || defaultUnit(prop)
  if (!unit) return UNITLESS_OR_LENGTH.has(prop) ? String(next) : `${next}px`

  return `${next}${unit}`
}

export const stepSize = (prop, shift) => {
  const base = CONTROLS[prop]?.step ?? 1
  return shift ? base * 10 : base
}

// ── 对齐按钮组 ────────────────────────────────────────────────
// Figma 的对齐改的是画布上的绝对坐标。CSS 里「只挪自己、不动兄弟」这件事
// 只有在 flex / grid 父容器下才有确定写法：grid 用 *-self，flex 的交叉轴用
// align-self、主轴只能靠 auto 外边距。父容器是普通 block 时没有通用做法
// （margin:auto 还要求元素有确定宽度），所以那种情况直接不给这组按钮。
export const alignSupported = el => {
  const parent = el?.parentElement
  if (!parent) return false
  return /flex|grid/.test(getComputedStyle(parent).display)
}

const SELF_VALUE = { start: 'start', center: 'center', end: 'end' }
const FLEX_VALUE = { start: 'flex-start', center: 'center', end: 'flex-end' }

// 返回 [{prop, value}]，value 为 '' 表示清掉这条 inline 声明
export const alignPlan = (el, axis, where) => {
  const parent = el?.parentElement
  if (!parent) return []

  const pcs = getComputedStyle(parent)
  if (/grid/.test(pcs.display))
    return [{ prop: axis === 'h' ? 'justify-self' : 'align-self', value: SELF_VALUE[where] }]

  const dir      = pcs.flexDirection || 'row'
  const mainIsH  = dir.startsWith('row')
  const reversed = dir.endsWith('-reverse')

  // 交叉轴
  if ((axis === 'h') !== mainIsH)
    return [{ prop: 'align-self', value: FLEX_VALUE[where] }]

  // 主轴：flex 容器里唯一只影响自身的手段是 auto 外边距
  const [a, b] = axis === 'h'
    ? ['margin-left', 'margin-right']
    : ['margin-top', 'margin-bottom']
  const [head, tail] = reversed ? [b, a] : [a, b]

  if (where === 'start') return [{ prop: head, value: '' },     { prop: tail, value: 'auto' }]
  if (where === 'end')   return [{ prop: head, value: 'auto' }, { prop: tail, value: '' }]
  return [{ prop: head, value: 'auto' }, { prop: tail, value: 'auto' }]
}

// object-fit 只对「替换元素」有意义——普通 div 没有自身内容可供适配，
// 写上去是空转。background-size/position 同理，没有背景图时无从谈起。
const REPLACED_ONLY = new Set(['object-fit', 'object-position'])
const BG_IMAGE_ONLY = new Set(['background-size', 'background-position'])

export const isReplacedElement = el =>
  /^(img|video|canvas|svg|iframe|embed|object)$/i.test(el?.tagName || '')

// 内容由外部资源决定、自身不承载任何文字的元素。排版属性对它们没有作用对象，
// 显示出来只会占位置——Figma 里图片图层同样不渲染 Typography 分区。
//
// 内联 <svg> 刻意不在此列：它里面可以有 <text>，而且确实会继承 font-* 属性，
// 隐藏就错了。这也是它与 isReplacedElement 的唯一差别。
//
// 已知取舍：<img> 加载失败时，浏览器用这些排版属性渲染 alt 文字。隐藏之后
// 就调不了那个状态的字体。改稿场景里图片基本正常加载，这个取舍值得。
export const isTextlessElement = el =>
  /^(img|video|canvas|iframe|embed|object)$/i.test(el?.tagName || '')

// 排版属性 + 字色：都需要一个「文字」作为作用对象
const NEEDS_TEXT = new Set([
  'font-family', 'font-size', 'font-weight', 'line-height',
  'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'color',
])

// 「有没有背景图」不能只看 background-image 非 none。多层填充下纯色层会被
// 写成 linear-gradient(c, c)（那一栏只收 <image>，颜色进不去），噪点和纹理
// 也占着同一条属性——它们都不是图片，铺法无从谈起。只有真的出现 url() 才算。
// 「有没有可以调铺法的背景」不能只看 background-image 非 none。多层填充下
// 纯色层会被写成 linear-gradient(c, c)（那一栏只收 <image>，颜色进不去），
// 噪点和纹理也占着同一条属性——它们都不是「一张图」，铺法无从谈起。
// 真渐变和 url() 都算：渐变一样吃 background-size / position。
// parseFills 已经把效果层滤掉、把伪装的纯色还原成 solid，直接用它的结论。
export const hasBackgroundImage = computed =>
  parseFills(computed).some(l => l.kind !== 'solid')

export const isRelevant = (prop, computed, el) => {
  if (REPLACED_ONLY.has(prop)) return isReplacedElement(el)
  if (BG_IMAGE_ONLY.has(prop)) return hasBackgroundImage(computed)

  if (NEEDS_TEXT.has(prop)) return !isTextlessElement(el)

  // 替换元素的内容不会溢出盒子，裁切由 object-fit 管——overflow 对 <img> 无效
  if (prop === 'overflow') return !isTextlessElement(el)

  if (FLEX_CHILD_ONLY.has(prop)) {
    const parentDisplay = el?.parentElement && getComputedStyle(el.parentElement).display
    return /flex|grid/.test(parentDisplay || '')
  }

  if (FLEX_ONLY.has(prop))
    return /flex|grid/.test(computed['display'] || '')

  if (['top', 'right', 'bottom', 'left', 'z-index'].includes(prop))
    return (computed['position'] || 'static') !== 'static'

  return true
}
