/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 面板固定出现在一个地方，不跟着选中的元素跑。
//
// 早先的版本按元素矩形算左右侧，本意是别盖住正在改的东西。结果每换一个元素
// 面板就跳一次位置——眼睛每次都得重新找它，比偶尔被挡住更累。现在只有两个
// 可能的位置：默认那个（样式表里的右上角），或者用户自己拖过去的那个。

const KEY = 'visual-revise:panel-pos'
const EDGE = 8    // 与视口边缘的最小留白

const vw = () => document.documentElement.clientWidth || innerWidth
const vh = () => document.documentElement.clientHeight || innerHeight

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

export const savePlacement = panel => {
  if (!panel) return null
  const r = panel.getBoundingClientRect()
  if (!r.width) return null
  const pos = { left: Math.round(r.left), top: Math.round(r.top) }
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

  const x = fit(left, EDGE, vw() - EDGE - w)
  const y = fit(top, EDGE, vh() - EDGE - h)

  // 样式表里写的是 right，不清掉的话 left 会被它拉扯
  panel.style.left = `${Math.round(x)}px`
  panel.style.top = `${Math.round(y)}px`
  panel.style.right = 'auto'

  return { left: x, top: y }
}

// 把面板放回记住的位置。没有记忆就什么都不做：样式表里的默认位置本身就是
// 「固定出现的那个地方」，写 inline 只会把那条 right 定位顶掉。
export const applyPlacement = panel => {
  const pos = readPlacement()
  if (!panel || panel.hidden || !pos) return null
  return moveTo(panel, pos.left, pos.top)
}
