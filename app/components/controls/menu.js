/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 共享的弹出菜单。Resizing 的模式切换、Grid 的行列类型、往后的各种「⌄」都用它，
// 免得每处各写一份定位、点外关闭、滚动关闭的逻辑。
//
// 面板挂到 body 而不是 shadow 内：属性面板本身有 overflow:auto，
// 放在里面会被裁掉。

import { mountPopover } from './popover-host.js'

const MENU_ID = 'visual-revise-menu'

// 与 select / fill 弹层互斥：同时开两个会互相遮挡
const SIBLING_PANELS = [
  'visual-revise-select-panel',
  'visual-revise-color-panel',
  'visual-revise-fill-panel',
]

const PANEL_CSS = `
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
  min-width: 180px;
  max-height: 70vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  background: #1e1e1e;
  border-radius: 10px;
  box-shadow: 0 10px 40px rgb(0 0 0 / .55), inset 0 0 0 1px rgb(255 255 255 / .07);
  font: 400 12px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  color: #fff;
`

const ITEM_CSS = `
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
`

let anchorEl = null
let onCloseCb = null

export const closeMenu = () => {
  document.getElementById(MENU_ID)?.remove()
  anchorEl?.removeAttribute('data-menu-open')
  anchorEl = null
  const cb = onCloseCb
  onCloseCb = null
  cb?.()
}

export const isMenuOpen = () => !!document.getElementById(MENU_ID)

document.addEventListener('pointerdown', e => {
  if (!anchorEl) return
  const path = e.composedPath?.() || []
  // 菜单里可能再开下拉/色盘，它们挂在 body 上、不在本菜单的 DOM 里
  if (path.some(n => n === anchorEl || n?.id === MENU_ID || SIBLING_PANELS.includes(n?.id))) return
  closeMenu()
}, true)

// 页面或面板滚动时关掉：锚点跟着走了，菜单留在原地就成了孤儿。
// 但菜单自己内部的滚动不算——CSS 变量那种列表有几十项、自带滚动条，
// 一滚就关等于永远只能选到最上面几项。
// Esc 关掉菜单。面板那边的 Esc 分支只是「有弹层时把这一下让给弹层」，
// 让完之后并没有人接手——结果 Esc 对菜单毫无作用，只能靠点别处关掉。
// stopPropagation 是必须的：不拦住的话这一下会继续走到「取消选中」，
// 菜单关了、选中的元素也一起没了。
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !isMenuOpen()) return
  e.preventDefault()
  e.stopPropagation()
  closeMenu()
}, true)

addEventListener('scroll', e => {
  const menu = document.getElementById(MENU_ID)
  if (menu && e.target instanceof Node && menu.contains(e.target)) return
  closeMenu()
}, true)
addEventListener('resize', () => closeMenu())

const CHECK = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>`

// 弹层挂在 body 上，用不到属性面板 shadow 里的样式，自带的内容要自己带样式
const POPOVER_CSS = `
  .gp { display: grid; gap: 8px }
  .gp-head { display: flex; align-items: center; gap: 6px }
  .gp-n {
    flex: 1; min-width: 0; height: 28px; padding: 0 8px;
    font: 400 12px/1 ui-monospace, Menlo, monospace; color: #fff;
    background: #383838; border: 1px solid transparent; border-radius: 5px; outline: none;
  }
  .gp-n:focus { border-color: #0d99ff }
  .gp-n::placeholder { color: #6f6f6f }
  .gp-x { flex: none; color: #8c8c8c }
  .gp-dots {
    display: grid; grid-template-columns: repeat(12, 1fr); gap: 2px;
  }
  .gp-dot {
    aspect-ratio: 1; padding: 0; cursor: pointer;
    background: #333; border: none; border-radius: 2px;
  }
  .gp-dot[data-on] { background: #3d4b57 }
  .gp-dot[data-hot] { background: #0d99ff }
  .gp-hint { height: 14px; font: 400 11px/1 ui-monospace, Menlo, monospace; color: #8c8c8c; text-align: center }
  .gp-settings {
    height: 30px; font: inherit; font-size: 12px; color: #fff;
    background: #383838; border: none; border-radius: 6px; cursor: pointer;
  }
  .gp-settings:hover { background: #454545 }
`

// items: [{ id, label, icon?, checked?, disabled?, hint? } | { separator: true }]
//
// 色圈与「对勾挪到最右」是变量菜单独有的版式，那个菜单已经退役（变量列表搬进了
// 颜色弹层的「变量」页，见 color-popover.js 的 renderVariableList）。留着就是一段
// 没有调用方、也没有测试覆盖的死代码，所以删掉；[data-item] 保留，select 与测试都在用。
export const openMenu = (anchor, items, onPick, { align = 'left' } = {}) => {
  // 点同一个触发器就是关掉它
  if (anchorEl === anchor) return closeMenu()
  closeMenu()

  const { host: panel, root } = mountPopover(MENU_ID, PANEL_CSS)

  for (const item of items) {
    if (item.separator) {
      const hr = document.createElement('div')
      hr.style.cssText = 'height:1px;margin:5px 6px;background:rgb(255 255 255 / .1)'
      root.appendChild(hr)
      continue
    }

    const row = document.createElement('div')
    // 行在 shadow root 里，外面按 [data-item] 找（`>` 子代选择器不跨 shadow）
    row.dataset.item = String(item.id ?? '')
    row.style.cssText = ITEM_CSS
    if (item.disabled) row.style.cssText += ';opacity:.4;cursor:not-allowed'

    // 勾选位固定占宽，有没有勾选文字都不会左右跳
    const check = `<span style="flex:none;width:12px;display:grid;place-items:center">${item.checked ? CHECK : ''}</span>`
    row.innerHTML =
      check +
      (item.icon ? `<span style="flex:none;display:grid;place-items:center;opacity:.75">${item.icon}</span>` : '') +
      `<span style="flex:1">${item.label}</span>` +
      (item.hint ? `<span style="flex:none;opacity:.45">${item.hint}</span>` : '')

    if (item.checked) row.style.background = 'rgb(13 153 255 / .22)'

    if (!item.disabled) {
      row.addEventListener('pointerenter', () => {
        if (!item.checked) row.style.background = 'rgb(255 255 255 / .09)'
      })
      row.addEventListener('pointerleave', () => {
        if (!item.checked) row.style.background = 'transparent'
      })
      row.addEventListener('click', e => {
        e.stopPropagation()
        // 先关再回调：回调里往往要重绘面板，锚点节点会被换掉
        closeMenu()
        onPick?.(item.id, item)
      })
    }

    root.appendChild(row)
  }

  // 定位：默认贴触发器下方，下方装不下就向上翻
  const rect = anchor.getBoundingClientRect()
  const h = panel.offsetHeight
  const w = panel.offsetWidth
  const below = innerHeight - rect.bottom

  const left = align === 'right' ? rect.right - w : rect.left
  panel.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`
  panel.style.top = below >= h + 12 || below >= rect.top
    ? `${rect.bottom + 6}px`
    : `${Math.max(8, rect.top - h - 6)}px`

  anchor.setAttribute('data-menu-open', '')
  anchorEl = anchor
  return panel
}

// 供 Grid 选择器这类自定义内容用：外壳与定位复用，内容自己填
export const openPopover = (anchor, buildContent, { align = 'left', width } = {}) => {
  if (anchorEl === anchor) return closeMenu()
  closeMenu()

  const { host: panel, root } = mountPopover(MENU_ID, PANEL_CSS + (width ? `;width:${width}px` : ''))

  // 内容铺在 shadow root 里：调用方拿到的是 root，innerHTML / querySelector
  // 用法不变。样式要在 buildContent 之后插：调用方多半用 innerHTML 铺内容，
  // 先插会被整块冲掉
  buildContent(root, closeMenu)

  const style = document.createElement('style')
  style.textContent = POPOVER_CSS
  root.appendChild(style)

  const rect = anchor.getBoundingClientRect()
  const h = panel.offsetHeight
  const w = panel.offsetWidth
  const below = innerHeight - rect.bottom

  const left = align === 'right' ? rect.right - w : rect.left
  panel.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`
  panel.style.top = below >= h + 12 || below >= rect.top
    ? `${rect.bottom + 6}px`
    : `${Math.max(8, rect.top - h - 6)}px`

  anchor.setAttribute('data-menu-open', '')
  anchorEl = anchor
  return panel
}
