/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 多层填充：把 Figma 的「一个图层可以有好几个 fill」映射到 CSS。
//
// CSS 这边只有一处能叠：background-image 收逗号分隔的多层，第一层画在最上面，
// background-color 永远垫在所有层底下。麻烦在于纯色进不了 background-image
// ——那一栏只收 <image>，颜色不是 image。所以除了最底那一层能用
// background-color 之外，其余纯色层都得写成 linear-gradient(c, c) 才叠得上去。
//
// 实测过的边界（见 docs/PRD.md §6）：
//   - background-image 多层：✔ 原生支持
//   - 视频：✘ url(x.mp4) 语法过得去但解不出画面，element() Chrome 不认
//   - 单层不透明度：CSS 没有。纯色的百分比编进颜色的 alpha；渐变和图片没有
//     对应物，面板上那个百分比框对它们是只读的。

import { splitTopLevel, parseGradient } from './gradient.js'
import { isEffectLayer } from './effects.js'
import { parseColor, sameColor } from '../components/controls/picker.js'
import { winningDeclaration, wholeVar, varTokens } from './cascade.js'

const NONE = /^\s*(none|initial|unset)\s*$/i

export const isNone = v => !v || NONE.test(v)

// linear-gradient(c, c) 是「把一个纯色塞进 image 栏」的标准写法，
// 读回来的时候要还原成纯色，否则用户会看到一条自己没画过的渐变
const solidFromGradient = image => {
  const g = parseGradient(image)
  if (!g || g.type !== 'linear' || g.stops.length !== 2) return null
  const [a, b] = g.stops
  if (a.color.trim().toLowerCase() !== b.color.trim().toLowerCase()) return null
  const c = parseColor(a.color)
  return c.valid ? a.color.trim() : null
}

const layer = (kind, value, slot) => ({ kind, value, slot })

/**
 * 从 computed 读出层列表，第一项画在最上面。
 * background-color 作为最底层追加（它在 CSS 里就是垫底的那一层）。
 *
 * 每层带一个 slot：它在 computed `background-image` 逗号列表里的下标（效果层
 * 跳过但下标照数），底色是 'color'。绑定判定要拿声明原文的第 N 段来比，
 * 而面板的层下标里没有效果层，两套下标必须靠 slot 对上。
 */
export const parseFills = ({ 'background-color': color, 'background-image': image } = {}) => {
  const layers = []

  if (!isNone(image)) {
    splitTopLevel(image).forEach((part, slot) => {
      const raw = part.trim()
      if (!raw || NONE.test(raw)) return
      // 噪点和纹理也写在 background-image 里，但它们归 Effects 管——
      // 在填充列表里再出现一次，用户会以为自己加过一层图
      if (isEffectLayer(raw)) return
      const solid = solidFromGradient(raw)
      if (solid) layers.push(layer('solid', solid, slot))
      else if (parseGradient(raw)) layers.push(layer('gradient', raw, slot))
      else layers.push(layer('image', raw, slot))
    })
  }

  const c = parseColor(color)
  // 完全透明的底色等于没有填充，不该在列表里占一行
  if (c.valid && c.a > 0) layers.push(layer('solid', color, 'color'))

  return layers
}

// 一段 <bg-layer> 里的 <image> 部分。
//
// 回落到 `background` 简写时，顶层逗号切出来的每一段是完整的一层：图片和
// position / size / repeat / attachment / origin / clip 混在一起，对整段做匹配
// 永远匹配不上。按顶层空白与斜杠切成 token（函数里的空格和逗号在括号里，不算
// 分隔符），再挑出那个函数或关键字 token。
const topTokens = seg => {
  const out = []
  let depth = 0, start = 0
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0 && (c === ' ' || c === '\t' || c === '\n' || c === '/')) {
      if (i > start) out.push(seg.slice(start, i))
      start = i + 1
    }
  }
  if (seg.length > start) out.push(seg.slice(start))
  return out.map(t => t.trim()).filter(Boolean)
}

const IMAGE_TOKEN = /^(none$|url\(|image-set\(|cross-fade\(|element\(|[\w-]*gradient\()/i

const imagePart = seg => topTokens(seg).find(t => IMAGE_TOKEN.test(t)) || null

// linear-gradient(var(--x), var(--x)) —— 「把绑了变量的纯色塞进 image 栏」的写法。
// 两端必须是同一个 var()，允许空格差异。
const boundGradientVar = image => {
  const g = parseGradient(image)
  if (!g || g.type !== 'linear' || g.stops.length !== 2) return null
  const [a, b] = g.stops
  const va = wholeVar(a.color), vb = wholeVar(b.color)
  return va && vb && va.name === vb.name ? va : null
}

// 声明原文里的一个 var()：长手要整条值就是它，简写里允许它只是其中一段，
// 但只能有一段（`background: var(--w) var(--c)` 分不清哪个是颜色）
const singleVar = (decl, prop) => {
  if (decl.prop === prop) return wholeVar(decl.value)
  const tokens = varTokens(decl.value)
  return tokens.length === 1 ? tokens[0] : null
}

/**
 * 给层列表补上 `bound`：这一层的颜色是不是绑在某个 CSS 变量上。
 *
 * 判定必须读**声明原文**：`parseFills` 的入参是 computed，浏览器早把 var() 解析
 * 成了 rgb()，从它身上看不出任何绑定。原文由 cascade.js 挑层叠赢家，按 slot 对
 * 齐到具体某一层，最后再拿变量解析出的颜色跟 computed 核对——层叠判定是近似的，
 * 对不上就当没绑定，宁可显示色值也不显示一个错的变量名。
 */
export const bindFills = (el, layers) => {
  if (!el || el.nodeType !== 1 || !layers?.length) return layers || []

  const cs = getComputedStyle(el)
  const resolve = token => (cs.getPropertyValue(token.name) || '').trim() || token.fallback

  const imageDecl = winningDeclaration(el, 'background-image')
  const parts = imageDecl ? splitTopLevel(imageDecl.value) : []
  const colorDecl = winningDeclaration(el, 'background-color')

  return layers.map(l => {
    if (l.kind !== 'solid') return l

    const token = l.slot === 'color'
      ? (colorDecl ? singleVar(colorDecl, 'background-color') : null)
      : (() => {
          const seg = parts[l.slot]
          const image = seg && (imageDecl.prop === 'background-image' ? seg : imagePart(seg))
          return image ? boundGradientVar(image) : null
        })()

    if (!token) return l
    return sameColor(resolve(token), l.value) ? { ...l, bound: token.name } : l
  })
}

/**
 * 层列表 → 要写回的 CSS。返回的两个属性总是成对写，缺一个就会留下上一次的残值。
 * 只有最底层是纯色时才用 background-color：那是它在 CSS 里天然的位置，
 * 也让导出的提示词读起来是「背景色 X」而不是「一条从 X 到 X 的渐变」。
 */
export const serializeFills = layers => {
  const list = (layers || []).filter(l => l && l.value && !NONE.test(l.value))
  if (!list.length) return { 'background-color': 'transparent', 'background-image': 'none' }

  const last = list[list.length - 1]
  const bottomIsSolid = last.kind === 'solid'
  const imageLayers = bottomIsSolid ? list.slice(0, -1) : list

  // 绑了变量的层写回 var() 而不是解析色。#writeBackground 每次都整体重写这两条
  // 属性，写解析色的话用户只要动了别的层、开关一次眼睛、拖一次层序，绑定就
  // 静默消失了。
  const solidOf = l => l.bound ? `var(${l.bound})` : l.value

  const image = imageLayers
    .map(l => l.kind === 'solid' ? `linear-gradient(${solidOf(l)}, ${solidOf(l)})` : l.value)
    .join(', ')

  return {
    'background-color': bottomIsSolid ? solidOf(last) : 'transparent',
    'background-image': image || 'none',
  }
}

// 新加一层时的默认值。Figma 加的是一个中性灰，这里跟它一致
export const DEFAULT_FILL = '#c4c4c4'
