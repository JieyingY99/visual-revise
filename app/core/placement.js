/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 面板固定出现在一个地方，不跟着选中的元素跑。
//
// 早先的版本按元素矩形算左右侧，本意是别盖住正在改的东西。结果每换一个元素
// 面板就跳一次位置——眼睛每次都得重新找它，比偶尔被挡住更累。现在只有两个
// 可能的位置：默认那个（样式表里的右上角），或者用户自己拖过去的那个。

import { zoomFactor, screenPos, fromScreen, viewportBox, rightOf, topOf, viewportMaxHeight } from './zoom.js'

const KEY = 'visual-revise:panel-pos'
const EDGE = 8    // 与视口边缘的最小留白
// 样式表里的默认位置（top / right）和 max-height 里扣掉的高度，网页缩放时要按倍数换算
const DEFAULT = { top: 88, right: 16, reserve: 104 }


// 可用空间比要摆的东西还小时退回下界，而不是算出一个比下界还小的上界
const fit = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi))

// localStorage 在无痕窗口或被站点策略禁掉时会直接抛，读写都得兜住——
// 记不住位置只是少个便利，不该让整块面板挂掉。
// 存的是页面自己的 localStorage：bundle 以 <script type="module"> 插进页面、
// 跑在主世界，够不着 chrome.storage，所以这份记忆是按站点隔离的。
export const readPlacement = () => {
  try {
    const pos = JSON.parse(localStorage.getItem(KEY))
    return Number.isFinite(pos?.left) && Number.isFinite(pos?.top) ? pos : null
  } catch { return null }
}

// 记的是屏幕坐标（CSS 坐标 × 网页缩放倍数）：用户在 150% 下把面板拖到某处，
// 缩回 100% 时它在屏幕上还该在那一处，而不是跟着 CSS 像素挪走
export const savePlacement = panel => {
  if (!panel) return null
  const r = panel.getBoundingClientRect()
  if (!r.width) return null
  const at = screenPos(panel)
  const pos = { left: Math.round(at.left), top: Math.round(at.top) }
  try { localStorage.setItem(KEY, JSON.stringify(pos)) }
  catch { /* 记不住就算了 */ }
  return pos
}

export const clearPlacement = () => {
  try { localStorage.removeItem(KEY) } catch { /* 同上 */ }
}

// 视口随时可能比记住位置时更小（换屏、缩窗口、开 devtools），不夹一下
// 面板就会停在屏幕外面——它是 fixed 的，页面滚不到那里，等于再也拖不回来
export const moveTo = (panel, left, top) => {
  if (!panel) return null
  const r = panel.getBoundingClientRect()
  const w = r.width || panel.offsetWidth
  const h = r.height || panel.offsetHeight

  // 夹在眼睛看到的那块视口里（捏合放大时它比布局视口小、还可能偏着）
  const b = viewportBox()
  const x = fit(left, b.left + EDGE, b.left + b.width - EDGE - w)
  const y = fit(top, b.top + EDGE, b.top + b.height - EDGE - h)

  // 样式表里写的是 right，不清掉的话 left 会被它拉扯
  panel.style.left = `${Math.round(x)}px`
  panel.style.top = `${Math.round(y)}px`
  panel.style.right = 'auto'
  // 网页缩放着的话面板带着 scale(1/k)：左上角定位就得以左上角为原点缩，
  // 否则 left 写的是布局盒的位置，眼睛看到的却是绕右上角缩过的另一处
  panel.style.transformOrigin = 'top left'

  return { left: x, top: y }
}

// 把面板放回记住的位置，并按网页缩放倍数反向缩回屏幕原大。
//
// 没有记忆时用样式表里的默认位置（右上角）：那本身就是「固定出现的那个地方」，
// 倍数为 1 时不写 inline，免得把那条 right 定位顶掉；倍数不为 1 时以右上角为
// 原点缩，贴边距离除以 k，屏幕上看还是同一个右上角。记住的坐标是屏幕坐标，
// 换算回 CSS 坐标再放。
export const applyPlacement = panel => {
  if (!panel || panel.hidden) return null
  const k = zoomFactor()
  const pos = readPlacement()
  panel.style.transformOrigin = pos ? 'top left' : 'top right'
  panel.style.transform = k === 1 ? '' : `scale(${1 / k})`
  panel.style.maxHeight = viewportMaxHeight(k, DEFAULT.reserve)
  if (pos) { const at = fromScreen(pos); return moveTo(panel, at.left, at.top) }
  panel.style.left = ''
  const plain = k === 1 && viewportBox().left === 0 && viewportBox().top === 0
  panel.style.top = plain ? '' : `${topOf(DEFAULT.top, k)}px`
  panel.style.right = plain ? '' : `${rightOf(DEFAULT.right, k)}px`
  return null
}
