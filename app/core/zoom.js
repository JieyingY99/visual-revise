/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 网页缩放（⌘+ / ⌘−）时，编辑器自己的 UI 不跟着变。
//
// 浏览器缩放是把 CSS 像素整体放大：页面放大到 150%，挂在 body 上的面板、
// 工具条、弹层也跟着长到 1.5 倍，离视口边缘的距离也跟着往外挪——用户放大
// 是想看清页面上的元素，不是想看清面板。所以每块 fixed 的编辑器 UI 都反向
// 缩回去：页面放大到 k 倍时它 scale(1/k)，贴边距离也除以 k，屏幕上看起来
// 就纹丝不动。
//
// 倍数从两条路来，互为保险：
// 1. 扩展进程有 tabs.getZoom / onZoomChange，注入时发一次绝对倍数，之后每次
//    变化再发；inject.js 写到 <html data-visual-revise-zoom> 上并抛事件。
//    但 MV3 的 service worker 闲置半分钟就被杀，页面里的 content script 也
//    可能是重建之前注入的旧版本，这条路不能独自扛。
// 2. 页面自己察觉：浏览器缩放会让 devicePixelRatio 与视口 CSS 宽度同时反向
//    变化（放大到 1.5 倍：DPR ×1.5，innerWidth ÷1.5）。只有 DPR 变、宽度不变
//    是窗口挪到了另一块屏（倍数没变，只换锚点）；只有宽度变是拉窗口。
//    这条路只能算相对变化，绝对值以扩展最后一次告知的为锚，没告知过按 1。
// 测试走第 1 条（改属性、抛事件）或用 CDP 同时改 DPR 与视口来模拟第 2 条。
//
// 触控板双指捏合是另一回事：那是「视觉视口」的 pinch zoom，CSS 像素没变、
// DPR 没变，只是 visualViewport.scale 变大、视口能在页面上平移。fixed 元素
// 钉在布局视口上，会跟着被放大、被平移出屏幕。所以倍数要再乘上 pinch 的
// scale，位置也不能再按布局视口的边算，得贴着视觉视口的角落（见 viewportBox）。
//
// 选中框、参考线、批注钉子这些贴在页面元素上的东西不在此列——它们本来就
// 该跟着页面一起放大。

const ATTR = 'data-visual-revise-zoom'
const EVENT = 'visual-revise:zoom'

const round = k => Math.round(k * 1000) / 1000

const fromAttr = () => {
  const k = parseFloat(document.documentElement.getAttribute(ATTR))
  return Number.isFinite(k) && k > 0 ? k : null
}

// 当前倍数，以及算它时的 DPR / 视口宽（相对变化的锚点）
const state = { k: fromAttr() ?? 1, dpr: devicePixelRatio, w: innerWidth }

// 扩展告知了绝对倍数：以它为准，锚点重置
const acceptAttr = () => {
  const k = fromAttr()
  if (k == null) return
  state.k = k
  state.dpr = devicePixelRatio
  state.w = innerWidth
}

// 页面自己察觉。innerWidth 是取整过的 CSS 像素，1% 的容差够吃掉取整误差，
// 又远小于任何一档缩放（最小一档 90%→100% 也差 10%）
const observe = () => {
  const dpr = devicePixelRatio, w = innerWidth
  if (dpr !== state.dpr && dpr > 0 && state.dpr > 0) {
    const r = dpr / state.dpr
    if (Math.abs(w * r - state.w) <= 2 + state.w * 0.01) state.k = round(state.k * r)
    state.dpr = dpr
  }
  state.w = w
}

const vv = () => window.visualViewport

// 捏合放大的倍数；没捏合（或浏览器不支持 visualViewport）就是 1
const pinchScale = () => {
  const v = vv()
  const s = v ? v.scale : 1
  return Number.isFinite(s) && s > 0 ? round(s) : 1
}

// 屏幕像素 / CSS 像素 = 页面缩放 × 捏合缩放
export const zoomFactor = () => { observe(); return round(state.k * pinchScale()) }

// 眼睛看到的那块视口，在布局视口坐标系里的矩形（CSS 像素）。没捏合时就是
// 整个布局视口。贴边定位的 UI 要贴的是这个框的边，不是 innerWidth 的边
export const viewportBox = () => {
  const v = vv()
  if (!v || !(v.scale > 0)) return { left: 0, top: 0, width: innerWidth, height: innerHeight }
  return { left: v.offsetLeft, top: v.offsetTop, width: v.width, height: v.height }
}

// 贴在页面元素上的编辑器物件（选中框、标签、测距线、参考线）本身要跟着元素
// 走，但把手的圆点、线的粗细、标签字号不该跟着放大——放大是为了看元素，
// 8 个圆点长成一坨反而把元素盖住。它们样式表里的尺寸都乘了 --vr-inv-zoom，
// 这里维护它的值。写进编辑器自己的 <style>，不碰页面的行内样式；倍数为 1
// 时整条规则都不要，页面上不留痕迹
const VAR_STYLE_ID = 'visual-revise-zoom-vars'
// visbug-grip 得单列：move.js 的 createGripUI 是 document.body.appendChild，
// 抓手跟 visbug-handles 是兄弟不是后代，自定义属性的继承够不着它——漏在
// 这份选择器外面，grip.element.css 里的 calc(1px * var(--vr-inv-zoom,1))
// 就永远退化成 1px，放大时描边比同屏的 hover 还粗
const SCALED = 'visbug-handles, visbug-hover, visbug-corners, visbug-label, visbug-distance, visbug-gridlines, visbug-grip, [data-visual-revise-guide]'
const applyVar = () => {
  const k = zoomFactor()
  let style = document.getElementById(VAR_STYLE_ID)
  if (k === 1) { style?.remove(); return }
  if (!style) {
    style = document.createElement('style')
    style.id = VAR_STYLE_ID
    style.setAttribute('data-visual-revise-ui', '')
    document.head.appendChild(style)
  }
  style.textContent = `${SCALED} { --vr-inv-zoom: ${round(1 / k)} }`
}
export const clearZoomStyles = () => document.getElementById(VAR_STYLE_ID)?.remove()

const listeners = new Set()
const notify = () => { applyVar(); for (const fn of listeners) fn() }
let wired = false
const wire = () => {
  if (wired) return
  wired = true
  applyVar()
  addEventListener(EVENT, () => { acceptAttr(); notify() })
  new MutationObserver(() => { acceptAttr(); notify() })
    .observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] })
  // 浏览器缩放一定触发 resize；换屏不一定，用 (resolution) 媒体查询补上
  addEventListener('resize', () => { observe(); notify() })
  // 捏合：scale 变走 resize，捏合后平移走 scroll——平移时倍数没变但贴边的位置变了
  vv()?.addEventListener('resize', notify)
  vv()?.addEventListener('scroll', notify)
  const watchDpr = () => {
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
    mq.addEventListener('change', () => { observe(); notify(); watchDpr() }, { once: true })
  }
  watchDpr()
}

// 倍数或视觉视口的框变了就调一次 handler(k)，没变不报
const key = () => { const b = viewportBox(); return `${zoomFactor()}|${b.left}|${b.top}|${b.width}|${b.height}` }
export const onZoom = handler => {
  wire()
  let last = key()
  const check = () => {
    const now = key()
    if (now === last) return
    last = now
    handler(zoomFactor())
  }
  listeners.add(check)
  return () => listeners.delete(check)
}

// 屏幕坐标：相对眼睛看到的视口左上角，单位屏幕像素（CSS 像素 × 倍数）。
// 拖过的 UI 记这个，换倍数 / 平移后再换算回 CSS 坐标放回去，屏幕上就还在原处
export const screenPos = el => {
  const k = zoomFactor()
  const b = viewportBox()
  const r = el.getBoundingClientRect()
  return { left: (r.left - b.left) * k, top: (r.top - b.top) * k }
}
export const fromScreen = pos => {
  const k = zoomFactor()
  const b = viewportBox()
  return { left: b.left + pos.left / k, top: b.top + pos.top / k }
}

// 贴视觉视口右边的 right 值（CSS 像素）：gap 是屏幕像素
export const rightOf = (gap, k = zoomFactor()) => {
  const b = viewportBox()
  return innerWidth - (b.left + b.width) + gap / k
}
export const topOf = (gap, k = zoomFactor()) => viewportBox().top + gap / k

// 面板这类有 max-height: calc(100vh - Npx) 的：缩到 1/k 后视口高度得乘回去，
// 否则它在屏幕上只有原来的 1/k 高。捏合时视口只有 visualViewport 那么高
export const viewportMaxHeight = (k, reserve) =>
  k === 1 && pinchScale() === 1 ? '' : `${Math.max(0, viewportBox().height * k - reserve)}px`
