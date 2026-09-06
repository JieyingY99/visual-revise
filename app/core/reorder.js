/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { isOffBounds } from '../utilities/common.js'

const SKIP = /^(SCRIPT|STYLE|TEMPLATE|LINK|META|NOSCRIPT|BR)$/

// 页面上「同一层里的元素」。插件自己的 UI、以及不参与布局的标签一律排除。
//
// 移动改的是 DOM 顺序，但页面自己可能用 CSS order 排过版：那时 DOM 顺序
// 和用户看到的顺序不是一回事。树的行序、拖拽的落点都得按用户看到的来，
// 否则「插到我看到的这一行前面」会落到别处。
export const orderedChildren = parent => {
  const kids = Array.from(parent?.children || [])
    .filter(el => !SKIP.test(el.tagName) && !isOffBounds(el))

  const display = parent ? getComputedStyle(parent).display : ''
  if (!/flex|grid/.test(display)) return kids

  return kids
    .map((el, i) => ({ el, i, order: parseInt(getComputedStyle(el).order, 10) || 0 }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(x => x.el)
}

// 能不能拖。搬 DOM 节点不挑父级的 display，也不要求有兄弟——把唯一的
// 一个孩子拖进别的容器同样是合法意图。只有 <html> 的直接子节点例外：
// 那一层只有 <head> / <body>，动它没有任何产品意义。
export const canDrag = el =>
  !!el?.parentElement && el.parentElement !== document.documentElement
