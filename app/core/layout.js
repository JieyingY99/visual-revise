// Layout 分区的模型，对齐 Figma 的 Auto layout 面板。
//
// Figma 把「这个容器怎么排子元素」收敛成一个 Flow 选择，然后按 Flow 决定
// 显示哪些控件。CSS 里这是 display + flex-direction 两个属性的组合，而且
// display:block 下 justify-content / align-items / gap 全都不生效——面板上
// 留着它们是骗人。

export const FLOWS = ['free', 'vertical', 'horizontal', 'grid']

export const FLOW_LABEL = {
  free:       '自由',
  vertical:   '纵向',
  horizontal: '横向',
  grid:       '网格',
}

export const flowOf = computed => {
  const display = computed?.display || ''
  if (/grid/.test(display)) return 'grid'
  if (/flex/.test(display))
    return /column/.test(computed['flex-direction'] || 'row') ? 'vertical' : 'horizontal'
  return 'free'
}

// 切 Flow 要连带清掉不再生效的属性，否则它们会留在 inline style 里，
// 既污染改动记录，也会在切回来时冒出用户以为自己没设过的值。
export const planFlow = (flow, computed) => {
  if (flow === 'free') {
    return {
      display: 'block',
      'flex-direction': null,
      'flex-wrap': null,
      'justify-content': null,
      'align-items': null,
    }
  }

  if (flow === 'grid') {
    return { display: 'grid', 'flex-direction': null, 'flex-wrap': null }
  }

  return {
    display: /inline/.test(computed?.display || '') ? 'inline-flex' : 'flex',
    'flex-direction': flow === 'vertical' ? 'column' : 'row',
  }
}

export const isFlexFlow = flow => flow === 'vertical' || flow === 'horizontal'

// ── 对齐九宫格 ──────────────────────────────────────────────
// justify-content 管主轴、align-items 管交叉轴，而主轴方向随 Flow 变：横向排列
// 时主轴是水平，纵向排列时主轴是垂直。九宫格是按屏幕方向（左右/上下）给的，
// 所以纵向 Flow 下两个属性要对调——不换的话，点「左上」会得到右上。

const MAIN_VALUES  = ['flex-start', 'center', 'flex-end']
const CROSS_VALUES = ['flex-start', 'center', 'flex-end']

const toIndex = value => {
  const v = (value || '').trim()
  if (/^(flex-start|start|left|normal|stretch)$/.test(v) || !v) return 0
  if (/^(center)$/.test(v)) return 1
  if (/^(flex-end|end|right)$/.test(v)) return 2
  return -1     // space-between 这类没有对应的格子
}

// 返回 { col, row }：屏幕方向上的列（左中右）与行（上中下），-1 表示不落在格子里
export const alignmentOf = (computed, flow) => {
  const jc = toIndex(computed?.['justify-content'])
  const ai = toIndex(computed?.['align-items'])

  return flow === 'vertical'
    ? { col: ai, row: jc }
    : { col: jc, row: ai }
}

export const planAlignment = (col, row, flow) => {
  const [main, cross] = flow === 'vertical' ? [row, col] : [col, row]
  return {
    'justify-content': MAIN_VALUES[main],
    'align-items':     CROSS_VALUES[cross],
  }
}

// ── 间距的两段式 ────────────────────────────────────────────
// Figma 默认只给「水平」「垂直」两个框，点一下才展开成四边独立。四边常年
// 占两行、而且多数时候左右相等、上下相等，压成一行能省下大半个分区的高度。

export const SIDE_SETS = {
  padding: {
    label: '内边距',
    horizontal: ['padding-left', 'padding-right'],
    vertical:   ['padding-top', 'padding-bottom'],
    all: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  },
  margin: {
    label: '外边距',
    horizontal: ['margin-left', 'margin-right'],
    vertical:   ['margin-top', 'margin-bottom'],
    all: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  },
}

// 两边不等时显示「混合」而不是随便挑一个——挑一个会让用户以为两边相同，
// 一敲回车就把另一边悄悄改掉了
export const pairValue = (computed, props) => {
  const values = props.map(p => (computed?.[p] || '').trim())
  return values.every(v => v === values[0]) ? values[0] : ''
}

export const isMixed = (computed, props) => {
  const values = props.map(p => (computed?.[p] || '').trim())
  return !values.every(v => v === values[0])
}
