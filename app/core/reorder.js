/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { ChangeStore } from './change-store.js'
import { isOffBounds } from '../utilities/common.js'

const SKIP = /^(SCRIPT|STYLE|TEMPLATE|LINK|META|NOSCRIPT|BR)$/

// 页面上「同一层里的元素」。插件自己的 UI、以及不参与布局的标签一律排除。
//
// 关键在排序：重排落在 CSS order 上，它只改变视觉顺序，DOM 顺序原地不动。
// 按 DOM 顺序列出来的话，拖完一次树里纹丝不动，看起来像没生效；拖拽的落点
// 索引也会和用户看到的位置对不上。
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

// 只有 flex / grid 容器里的子元素才排得动：order 对其它 display 无效
export const canReorder = el => {
  const parent = el?.parentElement
  if (!parent) return false
  return /flex|grid/.test(getComputedStyle(parent).display)
    && orderedChildren(parent).length > 1
}

// 重排落到 order 上：纯 CSS、能被快照 diff 捕获、不改动 DOM 结构。
// 页面上直接拖和树里拖走的是同一个函数，两个入口写出的记录才一致。
export const applyOrder = (others, dragged, targetIndex) => {
  const ordered = [...others.slice(0, targetIndex), dragged, ...others.slice(targetIndex)]

  // 合成一条历史：一次拖拽是一个动作，⌘Z 该整体退回去，
  // 而不是一个兄弟一步地往回倒
  ChangeStore.history.batch('重排', () => {
    ordered.forEach((node, i) => {
      ChangeStore.track(node)
      ChangeStore.applyProp(node, 'order', String(i))
    })
  })

  return ordered
}
