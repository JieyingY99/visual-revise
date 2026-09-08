/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 色盘下面的「On this page」：页面上出现过的颜色按次数排成一排排色块，点一下就用。
// 色盘和填充弹层共用这一块——Figma 那个位置放的就是它。

import { pageColors } from '../../core/page-colors.js'
import { CHECKER } from './picker.js'

const S = {
  wrap: `margin-top:12px;padding-top:12px;border-top:1px solid rgb(255 255 255 / .08)`,
  head: `display:flex;align-items:center;justify-content:space-between;height:28px;padding:0 8px;
    background:#383838;border-radius:5px;font:400 11px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#fff`,
  // 9 列：264 宽的弹层去掉 24 内边距是 240，9 × 24 + 8 × 3 = 240，跟 Figma 一样一行 9 个
  grid: `display:grid;grid-template-columns:repeat(9,1fr);gap:3px;margin-top:8px;
    max-height:105px;overflow:auto;overscroll-behavior:contain`,
  // 边框要不透明的实线：半透明边压在棋盘格底上会被格子切成一段一段，看着像虚线。
  // 棋盘格只画在内层，颜色再叠在棋盘格上面（半透明色才看得出透明度）
  swatch: `aspect-ratio:1;padding:0;border:1px solid #5a5a5a;border-radius:4px;cursor:pointer;background:none;overflow:hidden`,
  checker: `display:flex;width:100%;height:100%;${CHECKER}`,
  color: `display:block;flex:1;height:100%`,
  empty: `margin-top:8px;font:400 11px/1.5 -apple-system,system-ui,sans-serif;color:#8c8c8c;text-align:center`,
}

// colors 可以传进来复用（弹层开着期间不必每切一次页就重新扫一遍页面）
export const renderPageColors = (container, { onPick, colors: cached } = {}) => {
  // 调用方第一次传的是 null（还没扫过），默认参数只认 undefined，这里自己兜
  const colors = cached || pageColors()
  const box = document.createElement('div')
  box.className = 'page-colors'
  box.style.cssText = S.wrap
  box.innerHTML = `
    <div class="pc-head" style="${S.head}"><span>On this page</span><span style="opacity:.45">${colors.length}</span></div>
    ${colors.length
      ? `<div class="pc-grid" style="${S.grid}"></div>`
      : `<div style="${S.empty}">页面上没有可采集的颜色</div>`}`

  const grid = box.querySelector('.pc-grid')
  if (grid) {
    for (const { color, count } of colors) {
      const b = document.createElement('button')
      b.className = 'pc-swatch'
      b.dataset.color = color
      b.dataset.count = count
      b.title = `${color} · ${count} 处`
      b.style.cssText = S.swatch
      const checker = document.createElement('i')
      checker.style.cssText = S.checker
      // 带透明度的色（#rrggbbaa）：左半画去掉透明度的实色，右半画真实渲染
      // （透过棋盘格）。Figma 就是这么画的——只画半透明的话，
      // rgba(0 0 0 / .1) 和 rgba(255 255 255 / .1) 在棋盘格上几乎分不出来
      const parts = color.length === 9 ? [color.slice(0, 7), color] : [color]
      for (const c of parts) {
        const i = document.createElement('b')
        i.style.cssText = S.color
        i.style.background = c
        checker.appendChild(i)
      }
      b.appendChild(checker)
      b.addEventListener('click', e => { e.stopPropagation(); onPick?.(color) })
      grid.appendChild(b)
    }
  }

  container.appendChild(box)
  return colors
}
