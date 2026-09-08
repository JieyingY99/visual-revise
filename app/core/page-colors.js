/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 页面上出现过的颜色，按出现次数排——色盘下面那块「On this page」的数据源。
//
// 只数用户看得见的那几处：直接承载文字的元素的字色、不透明的背景色、真的画出来的
// 描边色（宽度 > 0 且 style 不是 none）、SVG 的 fill / stroke。编辑器自己的 UI 不算，
// 一个像素都没画出来的（display:none 的整棵子树、visibility:hidden）不算。
// 颜色的计算值不一定是 rgb()：Chrome 111+ 起非 legacy 语法保留原色彩空间，正则拆不动，
// 所以正则只当快路径，剩下的交给 canvas 探针换算到 sRGB（见 cssToRgba）。

const EDITOR_UI = 'vis-bug, visual-revise-panel, visual-revise-toolbar, visual-revise-list, visual-revise-tree, visual-revise-comment-layer, [data-visual-revise-ui]'

// ── 任意 CSS 颜色 → sRGB ──────────────────────────────────
// 一次扫页面要换算上万个颜色值，绝大多数又都是 legacy 的 rgb()/rgba()，
// 所以先用正则拆一遍：比走探针便宜一个量级，且不经过 8 位量化，通道值是精确的。
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/

// 正则拆不动的（oklch() / lab() / color(display-p3 …)，color-mix() 也会序列化成
// color(srgb …)）：让浏览器自己把这个颜色真画一个像素再读回来。fillStyle 的序列化同样
// 保留原色彩空间，所以必须走 getImageData 才拿得到落到 sRGB 的字节。
// 代价：画布按预乘 8 位存，半透明的非 legacy 色读回来 r/g/b 会差 1~2（alpha 本身是精确的）。
// 不透明的（页面上绝大多数）没有这个损失，而 1/255 的偏差在色块上看不出来，所以就这么办。
// 探针要建 canvas + 读像素，比正则贵得多，而同一个颜色字符串在一次扫描里会重复上千次，
// 按原字符串缓存结果。
const probed = new Map()
let ctx = null

const probe = css => {
  if (probed.has(css)) return probed.get(css)

  let out = null
  try {
    ctx = ctx || document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    // fillStyle 碰到不是颜色的值（SVG 的 fill:none、url(#grad)）会静默保留旧值而不报错，
    // 所以用两个不同的哨兵各写一次：两次都没被改写，才敢判定「这不是一个颜色」
    ctx.fillStyle = '#000000'
    ctx.fillStyle = css
    let color = ctx.fillStyle !== '#000000'
    if (!color) {
      ctx.fillStyle = '#ffffff'
      ctx.fillStyle = css
      color = ctx.fillStyle !== '#ffffff'
    }
    if (color) {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      out = { r, g, b, a: a / 255 }
    }
  } catch {
    // 取不到 2d 上下文（canvas 被策略禁掉）时安静降级：这个颜色采不到，别拖垮整次扫描
  }

  probed.set(css, out)
  return out
}

// { r, g, b, a }（r/g/b 是 0–255 整数，a 是 0–1）；不是颜色时给 null
export const cssToRgba = css => {
  const s = String(css || '').trim()
  const m = RGB.exec(s)
  if (!m) return probe(s)

  const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]))
  return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a }
}

const toHex = css => {
  const c = cssToRgba(css)
  if (!c || !(c.a > 0)) return null   // 全透明等于没画出来

  const h = n => Math.round(n).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a * 255) : ''}`
}

const hasText = el => Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())

// display 不继承：display:none 容器里的子孙，自身的计算值仍是 block / inline，只看这一个值
// 会把整棵藏起来的子树（收起的下拉菜单、没打开的弹窗）当成可见的采进来。checkVisibility()
// 问的是「这元素到底有没有画出来」，顺带把 visibility:hidden 也挡掉——两者都是一个像素都没画。
// 老浏览器没有这个方法时退回原来的判断。
const isPainted = (el, cs) => typeof el.checkVisibility === 'function'
  ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
  : cs.display !== 'none' && cs.visibility !== 'hidden'

const SIDES = ['Top', 'Right', 'Bottom', 'Left']

export const pageColors = ({ limit = 6000, max = 54 } = {}) => {
  const counts = new Map()
  const bump = css => {
    const hex = toHex(css)
    if (hex) counts.set(hex, (counts.get(hex) || 0) + 1)
  }

  let n = 0
  for (const el of document.querySelectorAll('body *')) {
    if (++n > limit) break
    if (el.tagName.toLowerCase().startsWith('visbug-') || el.closest(EDITOR_UI)) continue
    const cs = getComputedStyle(el)
    if (!isPainted(el, cs)) continue

    if (hasText(el)) bump(cs.color)
    bump(cs.backgroundColor)
    // 四边同色只数一次：一张卡片的描边是「一个颜色」，不是四个
    const edges = new Set()
    for (const side of SIDES) {
      if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') edges.add(cs[`border${side}Color`])
    }
    edges.forEach(bump)
    if (el instanceof SVGElement) { bump(cs.fill); bump(cs.stroke) }
  }

  return Array.from(counts, ([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color))
    .slice(0, max)
}
