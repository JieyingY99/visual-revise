/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 颜色弹层：顶上两页 `自定义 | 变量`，自定义是原来那套色盘，变量是页面上已
// 定义的颜色变量列表。
//
// 抽成模块级函数而不是留在 vr-color 里，是因为要从三个地方打开同一个弹层：
// 颜色控件的色块、已绑定的 chip、分区标题栏的「绑定变量」。后两个不是
// vr-color，够不到它的实例方法。
//
// 变量数据不走属性传进来：一个页面几十个变量的 JSON 会被序列化进每一个控件，
// 还会触发 attributeChangedCallback 把触发行整块重建。改成打开时由调用方现问
// 现给（面板给每个控件挂 variablesProvider），零序列化也天然拿到最新数据。

import { PANEL_STYLE, clamp, pickerMarkup, createPicker } from './picker.js'
import { mountPopover, visibleSize, popoverBounds } from './popover-host.js'
import { renderPageColors } from './page-colors.js'

const PANEL_ID = 'visual-revise-color-panel'

// 弹层里还会再开下拉（色盘的格式切换）、旁边可能开着菜单或填充弹层，
// 它们各自挂在 body 上、不在本弹层的 DOM 里。少了这份白名单，点一下格式
// 下拉的选项就会把色盘当场关掉——select 的 pick 挂在 click 上，等它跑的时候
// picker 已经脱离 DOM，那次提交写进空气。
const SIBLING_PANELS = [
  'visual-revise-select-panel',
  'visual-revise-fill-panel',
  'visual-revise-menu',
]

const CHECK = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>`

const SEARCH_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.2"/><path d="m10.3 10.3 3 3"/></svg>`

const S = {
  pages: `display:flex;gap:2px;padding:2px;margin-bottom:12px;background:#2a2a2a;border-radius:7px`,
  // 变量搜索：放大镜 + 输入即过滤，Figma 变量面板顶上那一条
  search: `display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;margin-bottom:6px;
    background:#383838;border-radius:5px;color:#8c8c8c`,
  searchInput: `flex:1;min-width:0;height:100%;padding:0;font:400 12px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    color:#fff;background:transparent;border:none;outline:none`,
  pageBtn: `flex:1;display:flex;align-items:center;justify-content:center;gap:5px;height:26px;
    font:400 11px/1 -apple-system,system-ui,sans-serif;color:#9b9b9b;background:transparent;
    border:none;border-radius:5px;cursor:pointer`,
  // 变量列表自带滚动：几十项的页面很常见，让整个弹层长到屏幕外还不如内部滚
  list: `max-height:300px;overflow:auto;overscroll-behavior:contain;display:grid;gap:2px`,
  row: `display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;
    border-radius:6px;cursor:pointer;white-space:nowrap`,
  dot: `flex:none;width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(255 255 255 / .18)`,
  name: `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
    font:400 12px/1 ui-monospace,Menlo,monospace`,
  hint: `flex:none;opacity:.45;font:400 11px/1 ui-monospace,Menlo,monospace`,
  check: `flex:none;width:12px;display:grid;place-items:center`,
  empty: `padding:14px 8px;text-align:center;color:#8c8c8c;line-height:1.6`,
}

// 当前开着的那个弹层。同一时刻只有一个，跟原来 vr-color 的 openInstance 一样。
let live = null

export const closeColorPopover = () => {
  document.getElementById(PANEL_ID)?.remove()
  const gone = live
  live = null
  if (gone) {
    gone.anchor?.removeAttribute('data-open')
    gone.anchor?.removeAttribute('data-menu-open')
    gone.onClose?.()
  }
}

export const isColorPopoverOpen = () => !!document.getElementById(PANEL_ID)

// 谁开的这个弹层。vr-color 用它判断「再点一次是关掉」，也用它决定
// 外部值变化时要不要同步进色盘。
export const colorPopoverAnchor = () => live?.anchor || null

// Esc 关掉弹层。面板那边的 Esc 分支只是「有弹层时把这一下让给弹层」，
// 让完之后并没有人接手——焦点在弹层的输入框里时 Esc 毫无作用；焦点在
// 别处时则一路走到「取消选中」，面板整个收起、弹层跟着被动消失，看着像
// 关了其实是选中没了。stopPropagation 是必须的，不拦住就会继续走到取消选中。
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !isColorPopoverOpen()) return
  e.preventDefault()
  e.stopPropagation()
  closeColorPopover()
}, true)

document.addEventListener('pointerdown', e => {
  if (!live) return
  const path = e.composedPath?.() || []
  if (path.some(n =>
    n === live.anchor || n?.id === PANEL_ID || SIBLING_PANELS.includes(n?.id))) return
  closeColorPopover()
}, true)

// 页面或面板滚动时关掉：锚点跟着走了，弹层留在原地就成了孤儿。
// 但弹层自己内部的滚动不算——变量列表有几十项、自带滚动条，一滚就关等于
// 只能选到最上面几项。跟 menu.js 那条是同一个坑。
addEventListener('scroll', e => {
  const panel = document.getElementById(PANEL_ID)
  if (!panel || !(e.target instanceof Node)) return closeColorPopover()
  if (panel.contains(e.target) || panel.shadowRoot?.contains(e.target)) return
  closeColorPopover()
}, true)
addEventListener('resize', () => closeColorPopover())

/**
 * 变量列表。填充弹层也用同一份，两边的行长得一样。
 * variables: [{ name, value }]；bound: 当前绑着的变量名；others: 被类型过滤掉的个数
 */
export const renderVariableList = (container, { variables, bound, others = 0, onPick, autofocus = true } = {}) => {
  const list = variables || []
  if (!list.length) {
    container.innerHTML = `<div style="${S.empty}">${others
      ? `页面上没有颜色变量（另有 ${others} 个其它类型的）`
      : '页面上没有定义 CSS 变量'}</div>`
    return
  }

  // 搜索：几十个变量靠滚动找太慢，敲几个字母就过滤；打开时直接聚焦，手不用离开键盘
  const search = document.createElement('div')
  search.className = 'var-search'
  search.style.cssText = S.search
  search.innerHTML = `${SEARCH_ICON}<input type="text" placeholder="搜索变量" style="${S.searchInput}" aria-label="搜索变量">`
  const input = search.querySelector('input')

  const box = document.createElement('div')
  box.style.cssText = S.list

  for (const { name, value } of list) {
    const on = name === bound
    const row = document.createElement('div')
    // 行在 shadow root 里，外面按 [data-item] 找（`>` 子代选择器不跨 shadow）
    row.dataset.item = name
    if (on) row.dataset.current = ''
    row.style.cssText = S.row
    // 对勾在最右：左边已经有色圈了，勾再挤在最左就成了两列图标
    row.innerHTML =
      `<span data-swatch style="${S.dot}"></span>` +
      `<span style="${S.name}"></span>` +
      `<span style="${S.hint}"></span>` +
      `<span style="${S.check}">${on ? CHECK : ''}</span>`
    // 颜色和变量名都来自页面，走属性赋值而不是拼进 HTML
    row.querySelector('[data-swatch]').style.background = value
    row.children[1].textContent = name
    row.children[2].textContent = value.slice(0, 18)

    if (on) row.style.background = 'rgb(13 153 255 / .22)'
    else {
      row.addEventListener('pointerenter', () => { row.style.background = 'rgb(255 255 255 / .09)' })
      row.addEventListener('pointerleave', () => { row.style.background = 'transparent' })
    }

    // 点当前已勾的那一项：不做事、也不关——用户多半只是想确认自己绑的是哪个
    row.addEventListener('click', e => {
      e.stopPropagation()
      if (on) return
      onPick?.(name)
    })

    box.appendChild(row)
  }

  // 输入即过滤：按名字做不区分大小写的子串匹配；一个都不剩时给一行提示
  const miss = document.createElement('div')
  miss.className = 'var-miss'
  miss.style.cssText = S.empty
  miss.hidden = true
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase()
    let shown = 0
    for (const row of box.children) {
      const hit = !q || row.dataset.item.toLowerCase().includes(q)
      // 行的行内样式写着 display:flex，hidden 属性（UA 的 display:none）压不过它——
      // 第一版只设 hidden，肉眼看列表纹丝不动。display 要直接改
      row.hidden = !hit
      row.style.display = hit ? 'flex' : 'none'
      if (hit) shown++
    }
    miss.hidden = shown > 0
    miss.style.display = shown ? 'none' : ''
    miss.textContent = shown ? '' : `没有匹配「${input.value.trim()}」的变量`
  })

  container.innerHTML = ''
  container.append(search, box, miss)
  if (autofocus) requestAnimationFrame(() => input.focus())
}

/**
 * openColorPopover(anchor, {
 *   value, format,          // Custom 页初值
 *   variables,              // [{ name, value }]；null 表示没有变量页
 *   others,                 // 被类型过滤掉的变量个数，空列表时的提示语要用
 *   bound,                  // 当前绑定的变量名或 null
 *   page,                   // 'custom' | 'variable'，缺省按 bound 停页
 *   align,                  // 'left' | 'right'
 *   onColor(css, format), onVariable(name), onClose(),
 * }) → { close, setValue }
 */
export const openColorPopover = (anchor, opts = {}) => {
  closeColorPopover()

  // 自己是滚动容器（跟填充弹层一样）：矮屏上变量页装不下时在弹层内部滚，
  // 而不是把滚动传给页面——页面一滚锚点就跑了，弹层会被 scroll 那条关掉
  const { host, root } = mountPopover(PANEL_ID, `${PANEL_STYLE} width: 264px;
    max-height: min(560px, calc(100vh - 32px)); overflow: auto; overscroll-behavior: contain;`)
  // 已绑定的格子（从 chip 进来）只给变量列表，不出两页：绑了变量，色值就不该
  // 在这里改，「自定义」那一页对它没有意义——要改颜色先 unlink。
  const hasPages = Array.isArray(opts.variables) && !opts.bound

  const state = {
    anchor, host, root,
    page: opts.page || (opts.bound ? 'variable' : 'custom'),
    format: opts.format || 'Hex',
    picker: null,
    onClose: opts.onClose,
  }
  live = state

  root.innerHTML = `${hasPages ? `<div class="pages" style="${S.pages}"></div>` : ''}
    <div class="body"></div>`

  const body = root.querySelector('.body')

  const renderBody = () => {
    state.picker = null
    if (state.page === 'variable') {
      renderVariableList(body, {
        variables: opts.variables, bound: opts.bound, others: opts.others,
        onPick: name => {
          // 先关再回调：回调里往往要重绘面板，锚点节点会被换掉
          closeColorPopover()
          opts.onVariable?.(name)
        },
      })
      return
    }

    body.innerHTML = pickerMarkup()
    state.picker = createPicker(body, {
      format: state.format,
      onChange: css => {
        state.format = state.picker.format
        opts.onColor?.(css, state.format)
      },
    })
    state.picker.set(opts.value)

    // 色盘下面：页面上出现过的颜色。弹层开着期间只扫一次，切页回来不重扫
    state.pageColors = renderPageColors(body, {
      colors: state.pageColors,
      onPick: css => {
        state.picker.set(css)
        opts.onColor?.(css, state.format)
      },
    })
  }

  const renderPages = () => {
    const pages = root.querySelector('.pages')
    if (!pages) return
    pages.innerHTML = [['custom', '自定义'], ['variable', '变量']].map(([id, label]) =>
      `<button data-page="${id}" style="${S.pageBtn}${id === state.page
        ? ';background:#454545;color:#fff' : ''}">${label}</button>`).join('')

    pages.querySelectorAll('[data-page]').forEach(btn =>
      btn.addEventListener('click', () => {
        state.page = btn.dataset.page
        renderPages()
        renderBody()
        place()
      }))
  }

  // 两页高矮差得多，切一次就得重新夹一次视口，否则从变量页切回色盘会
  // 直接漏出屏幕底部。定位必须在内容铺开之后：空壳的 offsetHeight 接近 0，
  // 夹了等于没夹。
  const place = () => {
    // 宿主被 popover-host 加了 scale(1/k)：offsetWidth/offsetHeight 是缩之前的
    // 布局盒，rect 却是缩过的视口坐标。右对齐的 left = rect.right − w 用没缩过的
    // w 会让右缘恒定偏出 w·(1−1/k)，夹取也会多留一圈边——一律换成可见尺寸。
    // 视口边界走 popoverBounds()（viewportBox()），捏合放大时才夹得住。
    const rect = anchor.getBoundingClientRect()
    const { w, h } = visibleSize(host, { w: 272 })
    const b = popoverBounds()
    const left = opts.align === 'right' ? rect.right - w : rect.left - w - 2
    host.style.left = `${clamp(left, b.minLeft, b.maxLeft(w))}px`
    host.style.top = `${clamp(rect.top, b.minTop, b.maxTop(h))}px`
  }

  renderPages()
  renderBody()
  place()

  // data-open 是控件自己的激活态，data-menu-open 是 chip 的（CSS 里那条
  // .var-chip[data-menu-open] 依赖它）。两个都打上，调用方不用各记一套。
  anchor.setAttribute('data-open', '')
  anchor.setAttribute('data-menu-open', '')

  return {
    close: closeColorPopover,
    setValue: v => state.picker?.set(v),
    get format() { return state.format },
  }
}
