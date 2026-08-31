// CSS 渐变的解析与序列化。
//
// 编辑器内部一律用「百分比色标」表示：
//   { type, angle, head, stops: [{ color, pos }] }
//
// 省略位置的色标按 CSS 自己的规则补全（首个 0%、末个 100%、中间在已知邻居之间
// 均分），这一步是精确的。少数用 px / em 写死位置的渐变会被折算成百分比——
// 那是近似，但把它们原样留着就没法在一根固定长度的色标条上拖动。

const round = n => Math.round(n * 100) / 100

// 顶层逗号切分：rgba(0, 0, 0, .5) 里的逗号不是分隔符
export const splitTopLevel = (input, sep = ',') => {
  const out = []
  let depth = 0
  let start = 0

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === sep && depth === 0) { out.push(input.slice(start, i)); start = i + 1 }
  }
  out.push(input.slice(start))

  return out.map(s => s.trim()).filter(Boolean)
}

const GRADIENT_RE = /^(repeating-)?(linear|radial|conic)-gradient\s*\(([\s\S]*)\)$/i

// 角度关键字。注意 to top right 这类「角」关键字的真实角度取决于盒子的宽高比，
// 45° 只是正方形下的值——所以解析时保留原始写法（head），只要用户不动角度，
// 序列化时原样写回，不会因为过一遍编辑器就把渐变方向改掉。
const CORNER_ANGLE = {
  'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
  'to top right': 45, 'to right top': 45,
  'to bottom right': 135, 'to right bottom': 135,
  'to bottom left': 225, 'to left bottom': 225,
  'to top left': 315, 'to left top': 315,
}

const ANGLE_UNITS = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }

export const readAngle = input => {
  const s = String(input || '').trim().toLowerCase()

  const keyword = CORNER_ANGLE[s.replace(/\s+/g, ' ')]
  if (keyword !== undefined) return keyword

  const m = s.match(/^(-?[\d.]+)(deg|grad|rad|turn)?$/)
  if (!m) return null

  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null

  return ((n * (ANGLE_UNITS[m[2] || 'deg']) % 360) + 360) % 360
}

// 首段是「方向/形状」还是第一个色标
const HEAD_RE = {
  linear: /^(to\s|-?[\d.]+(deg|grad|rad|turn)\s*$)/i,
  conic:  /^(from\s|at\s)/i,
  radial: /^(circle|ellipse|at\s|closest-|farthest-)/i,
}

const POS_RE = /\s+(-?[\d.]+)(%|px|r?em|v[wh]|ch|pt)\s*$/i

const parseStop = part => {
  let color = part.trim()
  let pos = null
  let exact = true

  const m = color.match(POS_RE)
  if (m) {
    color = color.slice(0, m.index).trim()
    if (m[2] === '%') pos = parseFloat(m[1])
    else exact = false          // px / em 等写死的位置，下面按均分折算
  }

  return color ? { color, pos, exact } : null
}

// 位置留空的色标按 CSS 规则补：首 0%、末 100%、中间在已知邻居之间均分
const fillPositions = stops => {
  const out = stops.map(s => ({ ...s }))
  if (!out.length) return out

  if (out[0].pos === null) out[0].pos = 0
  if (out[out.length - 1].pos === null) out[out.length - 1].pos = 100

  let i = 0
  while (i < out.length) {
    if (out[i].pos !== null) { i++; continue }

    const prev = i - 1
    let next = i
    while (next < out.length && out[next].pos === null) next++

    const span = out[next].pos - out[prev].pos
    const steps = next - prev
    for (let k = i; k < next; k++) out[k].pos = out[prev].pos + (span * (k - prev)) / steps

    i = next
  }

  // 色标位置在 CSS 里是单调不减的：后一个比前一个小时会被夹到前一个上
  let max = -Infinity
  return out.map(s => {
    const pos = Math.max(max, s.pos)
    max = pos
    return { color: s.color, pos: round(pos) }
  })
}

export const parseGradient = input => {
  const value = String(input || '').trim()
  const m = value.match(GRADIENT_RE)
  if (!m) return null

  const [, repeating, rawType, body] = m
  const type = rawType.toLowerCase()
  const parts = splitTopLevel(body)
  if (parts.length < 2) return null

  let head = null
  let angle = type === 'linear' ? 180 : 0

  if (HEAD_RE[type].test(parts[0])) {
    head = parts.shift()
    const deg = readAngle(type === 'conic' ? head.replace(/^from\s+/i, '') : head)
    if (deg !== null) angle = deg
  }

  const stops = parts.map(parseStop).filter(Boolean)
  if (stops.length < 2) return null

  return {
    type,
    repeating: !!repeating,
    angle,
    // 原始首段留着：用户不动角度和类型时原样写回，
    // `to top right` 这类依赖盒子宽高比的写法就不会被折成一个固定角度
    head,
    stops: fillPositions(stops),
  }
}

export const serializeGradient = g => {
  const stops = g.stops
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map(s => `${s.color} ${round(s.pos)}%`)
    .join(', ')

  const fn = `${g.repeating ? 'repeating-' : ''}${g.type}-gradient`

  const head = g.head != null ? g.head
    : g.type === 'linear' ? `${round(g.angle)}deg`
    : g.type === 'conic'  ? `from ${round(g.angle)}deg`
    : null                                    // 径向不写头部就是 CSS 默认的 ellipse at center

  return head ? `${fn}(${head}, ${stops})` : `${fn}(${stops})`
}

// 改角度就必须丢掉原始 head——否则写回去的还是老方向
export const setAngle = (g, angle) => ({
  ...g,
  angle: ((Math.round(angle) % 360) + 360) % 360,
  head: null,
})

// 换类型同样要丢 head：`to right` 之于径向渐变是非法的
export const setType = (g, type) => ({ ...g, type, head: null })

export const reverseStops = g => ({
  ...g,
  stops: g.stops
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map((s, i, all) => ({ color: all[all.length - 1 - i].color, pos: s.pos })),
})

// Figma 新建渐变时的默认两档灰
export const DEFAULT_STOPS = [
  { color: '#C4C4C4', pos: 0 },
  { color: '#5E5E5E', pos: 100 },
]

export const createGradient = (from = null) => ({
  type: 'linear',
  repeating: false,
  angle: 180,
  head: null,
  stops: from
    ? [{ color: from, pos: 0 }, { color: DEFAULT_STOPS[1].color, pos: 100 }]
    : DEFAULT_STOPS.map(s => ({ ...s })),
})

// 色标条的预览始终画成从左到右的线性渐变，和实际类型无关——
// 它表示的是「颜色沿渐变轴怎么走」，不是最终形状
export const stopsPreview = stops =>
  `linear-gradient(to right, ${stops
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map(s => `${s.color} ${round(s.pos)}%`)
    .join(', ')})`

export const TYPE_LABELS = [
  ['linear', '线性'],
  ['radial', '径向'],
  ['conic', '锥形'],
]
