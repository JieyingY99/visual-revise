/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { stableClasses } from './anchors.js'
import { isOffBounds } from '../utilities/common.js'

// 结构指纹：同一个组件的多个实例，标签、类名与子结构应当一致，
// 而文本内容和具体数值不同。深度取 2 层足以区分卡片、按钮、列表项，
// 又不会因为深层文本差异而误判。
export const fingerprint = (el, depth = 2) => {
  const tag = el.tagName.toLowerCase()
  const classes = stableClasses(el).sort().join('.')
  const self = classes ? `${tag}.${classes}` : tag

  if (depth <= 0) return self

  const children = Array.from(el.children)
    .filter(child => !isOffBounds(child))
    .map(child => fingerprint(child, depth - 1))
    .join(',')

  return `${self}(${children})`
}

// 兄弟优先：同一个父节点下的同构元素几乎必然是同一组件的重复渲染。
// 找不到兄弟时再放宽到全页扫描。
export const findSharedElements = (el, { scope = document.body } = {}) => {
  if (!el?.isConnected) return []

  const target = fingerprint(el)
  const parent = el.parentElement

  const siblings = parent
    ? Array.from(parent.children).filter(sib =>
        sib !== el && !isOffBounds(sib) && fingerprint(sib) === target)
    : []

  if (siblings.length) return siblings

  const tag = el.tagName
  return Array.from(scope.querySelectorAll(tag)).filter(node =>
    node !== el && !isOffBounds(node) && fingerprint(node) === target)
}

export const describeShared = count =>
  count > 0 ? `同步 ${count + 1} 个同构元素` : '未找到同构元素'
