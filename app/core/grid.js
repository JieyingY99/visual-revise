// Grid 轨道模型，对应 Figma 的 Grid 行列设置。
//
// Figma 里每条轨道有三种类型：Fill（等分剩余空间）、Fixed（固定尺寸）、
// Hug（由内容决定）。CSS 的对应写法分别是 1fr / <length> / auto。
//
// 轨道值不能问 getComputedStyle——它给的是算好的像素（"100px 100px 100px"），
// repeat(3, 1fr) 到那里就没了，编辑时会把用户写的 repeat 换成一串死像素。
// 所以走 resizing.js 的 declaredValue，回样式表里读声明。

import { declaredValue } from './resizing.js'

export const TRACK_TYPES = ['fill', 'fixed', 'hug']

export const TRACK_LABEL = { fill: '等分', fixed: '固定', hug: '贴合' }

export const DEFAULT_VALUE = { fill: '1fr', fixed: '100px', hug: 'auto' }

const AXIS_PROP = { columns: 'grid-template-columns', rows: 'grid-template-rows' }

// 按空格切分，但要跳过括号里的空格——minmax(100px, 1fr) 是一条轨道，不是两条
const splitTracks = value => {
  const out = []
  let depth = 0
  let token = ''

  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (token) out.push(token)
      token = ''
      continue
    }
    token += ch
  }
  if (token) out.push(token)
  return out
}

const toTrack = raw => {
  const v = raw.trim()
  if (/fr$/.test(v)) return { type: 'fill', value: v }
  if (/^(auto|min-content|max-content|fit-content)/.test(v)) return { type: 'hug', value: v }
  return { type: 'fixed', value: v }
}

export const parseTracks = value => {
  const v = (value || '').trim()
  if (!v || v === 'none') return []

  // 只展开最外层的 repeat(N, …)；auto-fill / auto-fit 展不开，当成一条轨道原样留着
  const repeat = /^repeat\(\s*(\d+)\s*,\s*([\s\S]+)\)\s*$/.exec(v)
  if (repeat) {
    const n = Math.min(+repeat[1], 24)
    const inner = splitTracks(repeat[2].trim()).map(toTrack)
    const out = []
    for (let i = 0; i < n; i++) out.push(...inner.map(t => ({ ...t })))
    return out
  }

  return splitTracks(v).map(toTrack)
}

// 全部相同的轨道写回 repeat()：那是人手写 CSS 时的样子，也更短
export const serializeTracks = tracks => {
  if (!tracks?.length) return 'none'

  const values = tracks.map(t => t.value || DEFAULT_VALUE[t.type] || 'auto')
  const allSame = values.every(v => v === values[0])

  return allSame && values.length > 1
    ? `repeat(${values.length}, ${values[0]})`
    : values.join(' ')
}

export const readTracks = (el, axis) =>
  parseTracks(declaredValue(el, AXIS_PROP[axis]))

export const trackProp = axis => AXIS_PROP[axis]

// 拖出 N × M 时用：全部按等分算，这是网格最常见的起手式
export const makeTracks = (n, type = 'fill') =>
  Array.from({ length: Math.max(0, n) }, () => ({ type, value: DEFAULT_VALUE[type] }))

// 网格的「几列几行」。列数直接看轨道数；行数在没有显式声明 grid-template-rows
// 时是隐式生成的，只能按子元素数量推算——这正是 Figma 里显示 "1 × Auto" 的情形。
export const gridShape = el => {
  const cols = readTracks(el, 'columns')
  const rows = readTracks(el, 'rows')

  if (!cols.length) return { cols: 0, rows: rows.length, implicitRows: !rows.length }

  const children = Array.from(el.children || []).filter(c =>
    !c.hasAttribute?.('data-visual-revise-ui'))

  return {
    cols: cols.length,
    rows: rows.length || Math.ceil(children.length / cols.length) || 1,
    implicitRows: !rows.length,
  }
}
