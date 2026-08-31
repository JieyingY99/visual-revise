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

const num  = (label, opts = {}) => ({ type: 'num',  label, coerce: coerceLength, ...opts })
const plain = (label, opts = {}) => ({ type: 'num', label, coerce: coerceNumber, ...opts })
const sel  = (label, options)    => ({ type: 'select', label, options })
const seg  = (label, options)    => ({ type: 'segment', label, options })
const col  = label               => ({ type: 'color', label })
const txt  = label               => ({ type: 'text', label })

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

  // 文字
  'font-family':    txt('字体'),
  'font-size':      num('字号'),
  'font-weight':    sel('字重', ['100', '200', '300', '400', '500', '600', '700', '800', '900']),
  'line-height':    plain('行高'),
  'letter-spacing': num('字距'),
  'text-align':     seg('对齐', [['left', '左'], ['center', '中'], ['right', '右'], ['justify', '两端']]),
  'text-transform': sel('大小写', ['none', 'uppercase', 'lowercase', 'capitalize']),
  'color':          col('文字色'),

  // 外观
  'opacity':       plain('不透明度', { step: 0.05, min: 0, max: 1 }),
  'border-radius': num('圆角'),
  'overflow':      sel('溢出', ['visible', 'hidden', 'scroll', 'auto', 'clip']),

  // 填充
  'background-color': col('背景色'),
  'background-image': txt('背景图'),

  // 描边
  'border-width': num('粗细'),
  'border-style': sel('样式', ['none', 'solid', 'dashed', 'dotted', 'double']),
  'border-color': col('颜色'),

  // 效果
  'box-shadow':      txt('阴影'),
  'filter':          txt('滤镜'),
  'backdrop-filter': txt('背景滤镜'),
}

// Figma 把成对的字段并排放：X/Y、W/H、水平/垂直内边距。
// 这里声明哪些属性构成一对，渲染时合并到同一行的两列里。
export const FIELD_PAIRS = [
  ['width', 'height'],
  ['min-width', 'min-height'],
  ['max-width', 'max-height'],
  ['row-gap', 'column-gap'],
  ['top', 'right'],
  ['bottom', 'left'],
  ['font-size', 'line-height'],
  ['letter-spacing', 'font-weight'],
  ['opacity', 'border-radius'],
  ['border-width', 'border-style'],
]

// 输入框内嵌的前缀标识，替代冗长的中文标签
export const FIELD_PREFIX = {
  'width': 'W', 'height': 'H',
  'min-width': 'W', 'min-height': 'H',
  'max-width': 'W', 'max-height': 'H',
  'top': 'T', 'right': 'R', 'bottom': 'B', 'left': 'L',
  'padding-top': '↑', 'padding-right': '→', 'padding-bottom': '↓', 'padding-left': '←',
  'margin-top': '↑', 'margin-right': '→', 'margin-bottom': '↓', 'margin-left': '←',
  'gap': '↔', 'row-gap': '↕', 'column-gap': '↔',
  'font-size': 'Aa', 'line-height': '↕', 'letter-spacing': 'AV',
  'opacity': '◍', 'border-radius': '◜', 'z-index': 'Z', 'order': '#',
  'border-width': '▭',
}

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
}

// 步进一个数值：无法数值化的值（normal / auto / inherit）回落到计算值；
// 仍无法数值化时，要么落到 KEYWORD_START，要么返回 null
// 表示这次按键应当忽略，而不是写入一个会被 CSSOM 丢弃的垃圾值。
export const stepValue = (prop, raw, delta, fallback = '') => {
  const usable = v => /^-?[\d.]/.test(String(v ?? '').trim())
  const source = usable(raw) ? String(raw).trim() : String(fallback ?? '').trim()

  if (!usable(source)) return KEYWORD_START[prop] ?? null

  const num = parseFloat(source)
  if (!Number.isFinite(num)) return KEYWORD_START[prop] ?? null

  const next = Math.round((num + delta) * 1000) / 1000

  if (UNITLESS.has(prop)) return String(next)

  const unit = source.match(/[a-z%]+$/i)?.[0]
  if (!unit) return UNITLESS_OR_LENGTH.has(prop) ? String(next) : `${next}px`

  return `${next}${unit}`
}

export const stepSize = (prop, shift) => {
  const base = CONTROLS[prop]?.step ?? 1
  return shift ? base * 10 : base
}

export const isRelevant = (prop, computed, el) => {
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
