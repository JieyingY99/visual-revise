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
import { parseColor } from '../components/controls/picker.js'

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

const layer = (kind, value) => ({ kind, value })

/**
 * 从 computed 读出层列表，第一项画在最上面。
 * background-color 作为最底层追加（它在 CSS 里就是垫底的那一层）。
 */
export const parseFills = ({ 'background-color': color, 'background-image': image } = {}) => {
  const layers = []

  if (!isNone(image)) {
    for (const part of splitTopLevel(image)) {
      const raw = part.trim()
      if (!raw || NONE.test(raw)) continue
      // 噪点和纹理也写在 background-image 里，但它们归 Effects 管——
      // 在填充列表里再出现一次，用户会以为自己加过一层图
      if (isEffectLayer(raw)) continue
      const solid = solidFromGradient(raw)
      if (solid) layers.push(layer('solid', solid))
      else if (parseGradient(raw)) layers.push(layer('gradient', raw))
      else layers.push(layer('image', raw))
    }
  }

  const c = parseColor(color)
  // 完全透明的底色等于没有填充，不该在列表里占一行
  if (c.valid && c.a > 0) layers.push(layer('solid', color))

  return layers
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

  const image = imageLayers
    .map(l => l.kind === 'solid' ? `linear-gradient(${l.value}, ${l.value})` : l.value)
    .join(', ')

  return {
    'background-color': bottomIsSolid ? last.value : 'transparent',
    'background-image': image || 'none',
  }
}

// 新加一层时的默认值。Figma 加的是一个中性灰，这里跟它一致
export const DEFAULT_FILL = '#c4c4c4'
