/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 弹层挂到 body 上，内容包进 shadow root。
//
// 菜单 / 填充 / 色盘 / 下拉四个弹层都得挂在 body 上——属性面板本身
// overflow:auto，放在里面会被裁掉。直接挂在 body 上就意味着页面自己的 CSS
// 能碰到它：弹层里的 tab 条叫 .tabs，页面恰好也有 .tabs { border-bottom }，
// 那条线就漏进来了。换任何一个站，button { } / .row { } / * { box-sizing }
// 都可能漏，漏进来的东西还随站点变——同一个弹层在两个页面上长得不一样。
//
// 宿主是弹层的盒子：id、定位、尺寸、滚动都在它身上，document.getElementById
// 判断有没有开着、composedPath 里认自己人、量 offsetHeight 夹回视口，
// 都跟以前一样。行内 all:initial 打头，页面的 div { } / * { } 碰不到它的
// 任何属性（inline 压过所有非 important 的样式表规则）。内容放在 shadow root
// 里，页面选择器根本进不来；从宿主继承下来的字体、字色由宿主自己的行内
// 样式定，不再随页面变。
//
// 内容里的 box-sizing 以前靠页面的 * { box-sizing: border-box } 给——
// 有的站有、有的站没有，输入框就时而 28 时而 30。现在自己带一份，走
// adoptedStyleSheets：调用方 root.innerHTML = ... 冲不掉它。
let baseSheet = null
const base = () => {
  if (baseSheet) return baseSheet
  baseSheet = new CSSStyleSheet()
  baseSheet.replaceSync(`
    *, *::before, *::after { box-sizing: border-box }
    button, input, select { font: inherit; color: inherit }
  `)
  return baseSheet
}

export const mountPopover = (id, css) => {
  const host = document.createElement('div')
  host.id = id
  host.setAttribute('data-visual-revise-ui', '')
  host.style.cssText = `all: initial; display: block; box-sizing: border-box; ${css}`

  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [base()]

  // 按键到此为止。弹层里的输入框在 shadow root 里，事件冒到 document 时
  // 目标已经被 retarget 成宿主 div，VisBug 那套快捷键（hotkeys-js）按
  // target.tagName 判断「在不在打字」就认不出来——在色值框里敲 Enter 会变成
  // 「进入子元素」，清空输入框会变成「删除选中元素」。属性面板和结构树
  // 的宿主上也是这么挡的。全局 capture 阶段的监听（Esc 关弹层、下拉的
  // 上下键）在这之前就跑完了，不受影响。
  host.addEventListener('keydown', e => e.stopPropagation())

  document.body.appendChild(host)
  return { host, root }
}
