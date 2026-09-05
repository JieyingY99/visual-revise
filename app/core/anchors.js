/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
const HASHY = /^[a-z]*[-_]?[a-z0-9]{5,}$/i
const FRAMEWORK_NOISE = /^(ng-|v-|svelte-|jsx-|css-|sc-|emotion-|chakra-|mui-)/i

const isStableClass = name =>
  name
  && !FRAMEWORK_NOISE.test(name)
  && !(HASHY.test(name) && /\d/.test(name) && !/-/.test(name))

export const stableClasses = el =>
  Array.from(el.classList).filter(isStableClass)

const nthOfType = el => {
  const siblings = Array.from(el.parentElement?.children || [])
    .filter(sib => sib.tagName === el.tagName)
  return siblings.length > 1 ? siblings.indexOf(el) + 1 : 0
}

const segment = el => {
  const tag = el.tagName.toLowerCase()

  if (el.id && !HASHY.test(el.id))
    return `#${el.id}`

  const classes = stableClasses(el)
  const base = classes.length ? `${tag}.${classes.join('.')}` : tag
  const nth = nthOfType(el)

  return nth ? `${base}:nth-of-type(${nth})` : base
}

export const buildSelector = el => {
  const parts = []
  let node = el

  while (node && node.nodeType === 1 && node !== document.body) {
    parts.unshift(segment(node))
    if (node.id && !HASHY.test(node.id)) break
    node = node.parentElement
  }

  return parts.join(' > ')
}

const clip = (text, limit) =>
  text.length > limit ? text.slice(0, limit) + '…' : text

// 只取元素自己的文本节点，不含后代。容器元素会返回空字符串——
// 这是刻意的：把整棵子树的文本拼成一坨，AI 拿去搜索必然落空。
export const directText = (el, limit = 80) => {
  const text = Array.from(el.childNodes)
    .filter(n => n.nodeType === 3)
    .map(n => n.textContent.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')

  return clip(text, limit)
}

export const ownText = (el, limit = 80) =>
  directText(el, limit)
  || clip(el.textContent.trim().replace(/\s+/g, ' '), limit)

// 供 AI 在代码库中检索的锚点：宁可多给几条短文本，
// 也不要一条长文本——短文本才搜得到。
export const textLandmarks = (el, max = 3) => {
  const own = directText(el, 60)
  if (own) return [own]

  const seen = new Set()
  const found = []

  for (const child of el.querySelectorAll('*')) {
    const text = directText(child, 40)
    if (!text || seen.has(text)) continue
    seen.add(text)
    found.push(text)
    if (found.length >= max) break
  }

  return found
}

export const domPath = (el, depth = 5) => {
  const parts = []
  let node = el

  while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < depth) {
    const classes = stableClasses(node)
    parts.unshift(classes.length
      ? `${node.tagName.toLowerCase()}.${classes[0]}`
      : node.tagName.toLowerCase())
    node = node.parentElement
  }

  return parts.join(' > ')
}

const describePosition = el => {
  const parent = el.parentElement
  if (!parent) return ''

  const peers = Array.from(parent.children).filter(sib => sib.tagName === el.tagName)
  const index = peers.indexOf(el)
  const notes = []

  if (peers.length > 1)
    notes.push(`同级第 ${index + 1} 个（共 ${peers.length} 个）`)

  const prev = peers[index - 1]
  const prevText = prev && (textLandmarks(prev, 1)[0] || '').slice(0, 30)
  if (prevText) notes.push(`紧邻「${prevText}」之后`)

  return notes.join('，')
}

export const collectAnchors = el => ({
  selector:  buildSelector(el),
  tag:       el.tagName.toLowerCase(),
  classes:   stableClasses(el),
  id:        el.id || null,
  text:      textLandmarks(el),
  domPath:   domPath(el),
  position:  describePosition(el),
  attrs:     ['data-testid', 'data-test', 'aria-label', 'name', 'role', 'href', 'alt']
                .reduce((acc, key) => {
                  const val = el.getAttribute(key)
                  if (val) acc[key] = val
                  return acc
                }, {}),
})

// ── 重新定位 ────────────────────────────────────────────────
// 记录挂的是 DOM 节点引用，而框架重渲染会把节点整个换掉——引用随之悬空。
// 导入他人的 JSON 时同理：选择器在另一次构建后可能已经失效。
// 两处用的是同一套回退：选择器 → 文本特征 → DOM 路径。

// 任何一次 querySelector 都可能因选择器语法非法而抛错：Tailwind 的类名
// 常含 CSS 保留字符（hover:bg-blue-500、w-1/2、top-[3px]）。一次抛错若
// 逸出，整轮重定位会中断，前面已改绑的记录既不回滚也不上报。
export const query = selector => {
  if (!selector) return null
  try { return document.querySelector(selector) } catch { return null }
}

export const queryAll = selector => {
  if (!selector) return []
  try { return Array.from(document.querySelectorAll(selector)) } catch { return [] }
}

// 回退档必须唯一命中才认。一屏相似的列表行里猜错一行，会把改动贴到隔壁
// 元素上——那比丢失更糟：导出的提示词是错的，而用户不会发现。
const only = list => (list.length === 1 ? list[0] : null)

export const resolveElement = (record, { exclude } = {}) => {
  const anchors = record?.anchors || record || {}
  const selector = record?.selector || anchors.selector
  const usable = el => el && el.isConnected && !exclude?.has(el)

  const direct = query(selector)
  if (usable(direct)) return { el: direct, via: 'selector' }

  const wanted = anchors.text?.[0]
  if (wanted) {
    const byText = queryAll(anchors.tag || '*')
      .filter(el => usable(el) && textLandmarks(el, 1)[0] === wanted)
    if (only(byText)) return { el: byText[0], via: 'text' }
  }

  if (anchors.domPath) {
    const byPath = queryAll(anchors.domPath.split(' > ').pop()).filter(usable)
    if (only(byPath)) return { el: byPath[0], via: 'path' }
  }

  return { el: null, via: null }
}
