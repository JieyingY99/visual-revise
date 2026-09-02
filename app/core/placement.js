// 面板摆在哪，取决于你选中了什么。写死在右上角的话，选到页面右侧的元素时
// 面板正好盖住它——而改属性的全部意义就是看着它变。

const EDGE = 8    // 与视口边缘的最小留白
const GAP = 12    // 与被避开元素之间的呼吸位

const vw = () => document.documentElement.clientWidth || innerWidth
const vh = () => document.documentElement.clientHeight || innerHeight

// 可用空间比要摆的东西还小时退回下界，而不是算出一个比下界还小的上界
const fit = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi))

const overlaps = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

// 用户自己拖过之后就不再自动摆位：那是他明确的意图，不该被下一次选中覆盖
export const PINNED_ATTR = 'data-user-placed'
export const pinPlacement = el => el?.setAttribute(PINNED_ATTR, '')
export const unpinPlacement = el => el?.removeAttribute(PINNED_ATTR)

export const placeBeside = (panel, target, { avoid = [] } = {}) => {
  if (!panel || panel.hidden || panel.hasAttribute(PINNED_ATTR)) return null
  if (!target?.isConnected) return null

  // 尺寸要实测：面板高度随内容变，而 max-height 又跟视口挂钩
  const p = panel.getBoundingClientRect()
  const t = target.getBoundingClientRect()
  if (!p.width || !p.height) return null

  const roomRight = vw() - t.right - GAP - EDGE
  const roomLeft = t.left - GAP - EDGE

  // 优先右侧；右边塞不下就翻到左边。两边都不够宽时选空间大的那侧，
  // 剩下的交给夹取——窄视口下少量重叠躲不掉，但总好过整块跑到屏幕外
  const side = roomRight >= p.width ? 'right'
    : roomLeft >= p.width ? 'left'
    : roomRight >= roomLeft ? 'right' : 'left'

  const left = fit(
    side === 'right' ? t.right + GAP : t.left - GAP - p.width,
    EDGE, vw() - EDGE - p.width)

  // 纵向对齐元素顶部：面板上半部分是最常改的几项，让它们跟元素平齐
  let top = fit(t.top, EDGE, vh() - EDGE - p.height)

  // 工具条浮在顶部中间，撞上就压到它下面——不然选中页面上方的元素时，
  // 面板标题会被工具条盖住
  for (const box of avoid) {
    if (!box) continue
    const rect = { left, top, right: left + p.width, bottom: top + p.height }
    if (overlaps(rect, box))
      top = fit(box.bottom + GAP, EDGE, vh() - EDGE - p.height)
  }

  // CSS 里写的是 right，不清掉的话 left 会被它拉扯
  panel.style.left = `${Math.round(left)}px`
  panel.style.top = `${Math.round(top)}px`
  panel.style.right = 'auto'

  return { left, top, side }
}
