/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 找出一条 CSS 属性在某个元素上「赢下层叠的那条声明」的原文。
//
// 面板要知道一格颜色是不是绑在 CSS 变量上。getComputedStyle 把 var() 解析成
// 最终色值，从它身上看不出来；inline 原文能看出来，但绝大多数页面的变量引用
// 写在样式表里（.card { background: var(--surface) }），只读 inline 就把它们
// 全当成了死色值。所以这里把样式表翻一遍：命中这个元素的规则里，谁声明了这条
// 属性（或它的简写），再按层叠规则挑出赢家。
//
// 不追求跟浏览器的层叠引擎逐字一致：@layer 里 important 的反转、all / revert、
// @container 的条件求值都没做。上层还有一道保险——挑出来的变量解析出的颜色
// 必须等于 computed，对不上就当没绑定，宁可显示色值也不显示一个错的变量名。

// 简写也能把颜色带进来：border: 1px solid var(--line) 是写描边最常见的写法
const SHORTHANDS = {
  'background-color': ['background'],
  // 含 var() 的简写在 CSSOM 里对长手返回空串，只有简写读得到原文。
  // `background: linear-gradient(var(--a), var(--a)), url(x.png)` 这种写法很常见，
  // 不回落到简写的话填充层一层都认不出绑定
  'background-image': ['background'],
  'border-color': ['border'],
  'border-top-color': ['border-top', 'border-color', 'border'],
  'border-right-color': ['border-right', 'border-color', 'border'],
  'border-bottom-color': ['border-bottom', 'border-color', 'border'],
  'border-left-color': ['border-left', 'border-color', 'border'],
  'outline-color': ['outline'],
}

// 把一段值里所有 var(--x, fallback) 挑出来。fallback 里可能再套括号
// （var(--a, rgb(0 0 0))），正则数不清，得配对着数
export const varTokens = value => {
  const out = []
  const s = String(value || '')
  let i = 0
  while ((i = s.indexOf('var(', i)) !== -1) {
    let depth = 0, j = i + 3
    for (; j < s.length; j++) {
      if (s[j] === '(') depth++
      else if (s[j] === ')' && --depth === 0) break
    }
    const inner = s.slice(i + 4, j)
    const comma = inner.indexOf(',')
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim()
    if (/^--[\w-]+$/.test(name)) out.push({ name, fallback, raw: s.slice(i, j + 1) })
    i = j + 1
  }
  return out
}

// 整条值就是一个 var()：绑定判定用的形态
export const wholeVar = value => {
  const v = String(value || '').trim()
  const tokens = varTokens(v)
  return tokens.length === 1 && tokens[0].raw === v ? tokens[0] : null
}

// 选择器优先级，算成一个可比的整数。:where 不计分，:not/:is/:has 取括号里
// 的（近似：按里面写的全算，不取最大的那一支）
export const specificity = selector => {
  let s = String(selector || '')
    .replace(/:where\([^)]*\)/g, '')
    .replace(/:(not|is|has|matches)\(/g, '(')
  const ids = (s.match(/#[\w-]+/g) || []).length
  s = s.replace(/#[\w-]+/g, ' ')
  const attrs = (s.match(/\[[^\]]*\]/g) || []).length
  s = s.replace(/\[[^\]]*\]/g, ' ')
  const pseudoEls = (s.match(/::[\w-]+/g) || []).length
  s = s.replace(/::[\w-]+/g, ' ')
  const classes = (s.match(/\.[\w-]+/g) || []).length + (s.match(/:[\w-]+/g) || []).length
  s = s.replace(/[.:][\w-]+(\([^)]*\))?/g, ' ')
  const types = (s.match(/(^|[\s>+~(,])[a-zA-Z][\w-]*/g) || []).length
  return ids * 10000 + (classes + attrs) * 100 + (types + pseudoEls)
}

// 列表选择器 a, b 命中了，优先级按真正命中的那一支算
const matchedSpecificity = (el, selectorText) => {
  const parts = splitTop(selectorText, ',')
  const hit = parts.filter(p => { try { return el.matches(p) } catch { return false } })
  return Math.max(0, ...(hit.length ? hit : parts).map(specificity))
}

const splitTop = (s, sep) => {
  const out = []
  let depth = 0, start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1 }
  }
  out.push(s.slice(start).trim())
  return out.filter(Boolean)
}

// 样式表铺平成一条规则列表，顺序就是文档顺序。@media / @supports 按当前
// 环境求值，不成立的整块跳过；@layer 里的记一笔（层叠里输给没分层的）。
// 跨域样式表读 cssRules 会抛 SecurityError，跳过。
//
// 一次 render 会连着问四五条属性，每问一次都铺一遍太浪费；铺好的列表留
// 几十毫秒，同一帧里的几次查询共用。用户下一次操作早就过了这个窗口，
// 不会读到过期的规则。
let cache = null
const CACHE_MS = 50

const flatten = root => {
  const now = performance.now()
  if (cache && cache.root === root && now - cache.at < CACHE_MS) return cache.list

  const list = []
  const walkSheet = sheet => {
    let rules
    try { rules = sheet.cssRules } catch { return }
    walk(rules, false)
  }
  const walk = (rules, layered) => {
    for (const rule of Array.from(rules || [])) {
      if (rule.selectorText !== undefined && rule.style) {
        list.push({ rule, layered, order: list.length })
        continue
      }
      if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.media.mediaText).matches) walk(rule.cssRules, layered)
        continue
      }
      if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) walk(rule.cssRules, layered)
        continue
      }
      if (rule instanceof CSSImportRule) {
        const media = rule.media?.mediaText
        if (rule.styleSheet && (!media || matchMedia(media).matches)) walkSheet(rule.styleSheet)
        continue
      }
      if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
        walk(rule.cssRules, true)
        continue
      }
      if (rule instanceof CSSKeyframesRule || rule instanceof CSSFontFaceRule) continue
      // @container / @scope 这类：条件算不了，按成立处理，靠上层的颜色核对兜底
      if (rule.cssRules) walk(rule.cssRules, layered)
    }
  }

  for (const sheet of Array.from(root.styleSheets || [])) walkSheet(sheet)
  for (const sheet of root.adoptedStyleSheets || []) walkSheet(sheet)

  cache = { root, list, at: now }
  return list
}

// 页面上声明过的全部 CSS 自定义属性名。
//
// 不限选择器：容器作用域上的 token（.theme-dark { --role-bg }、
// [data-theme="dark"] { … }）跟 :root 上的一样是用户会想绑的东西，而现代设计
// 系统的 token 大多写在 @layer base / @media (prefers-color-scheme) 里——只扫每
// 张表顶层的 :root / html 会把它们整片漏掉，变量列表就是空的。
//
// 走的是跟 winningDeclaration 同一份铺平结果，所以 chip 认得出的绑定，列表里
// 一定也列得出来，不会再有两套口径。
export const declaredVariables = (root = document) => {
  const out = new Set()

  for (const { rule } of flatten(root))
    for (const name of Array.from(rule.style))
      if (name.startsWith('--')) out.add(name)

  const inline = (root.documentElement || document.documentElement)?.style
  for (const name of Array.from(inline || []))
    if (name.startsWith('--')) out.add(name)

  return Array.from(out).sort()
}

// 一个声明块里，这条属性（或它的简写）写了什么。
//
// 长手优先：块里同时有 background 和 background-color 时，CSSOM 已经按块内
// 顺序算好了——后写的长手会有值，被后写的简写盖掉的长手读出来是空串。
const declIn = (style, prop) => {
  for (const p of [prop, ...(SHORTHANDS[prop] || [])]) {
    const value = style.getPropertyValue(p)
    if (!value) continue
    return { prop: p, value: value.trim(), important: style.getPropertyPriority(p) === 'important' }
  }
  return null
}

const score = c => [c.important ? 1 : 0, c.inline ? 1 : 0, c.layered ? 0 : 1, c.specificity, c.order]
const later = (a, b) => {
  const sa = score(a), sb = score(b)
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i]
  return false
}

// 这条属性在这个元素上赢下层叠的声明：
// { prop, value, important, source: 'inline' | 'sheet', selector? }。
// 什么都没声明（纯继承 / 初始值）返回 null。
export const winningDeclaration = (el, prop) => {
  if (!el || el.nodeType !== 1) return null
  let best = null
  const consider = c => { if (!best || later(c, best)) best = c }

  const inline = el.style && declIn(el.style, prop)
  if (inline) consider({ ...inline, inline: true, source: 'inline', specificity: 0, order: Infinity })

  const root = el.getRootNode()
  const roots = root instanceof ShadowRoot ? [root, document] : [document]
  for (const r of roots) {
    for (const { rule, layered, order } of flatten(r)) {
      let hit
      try { hit = el.matches(rule.selectorText) } catch { hit = false }
      if (!hit) continue
      const d = declIn(rule.style, prop)
      if (!d) continue
      consider({
        ...d, inline: false, source: 'sheet', layered, order,
        selector: rule.selectorText,
        specificity: matchedSpecificity(el, rule.selectorText),
      })
    }
  }

  if (!best) return null
  const { prop: p, value, important, source, selector } = best
  return { prop: p, value, important, source, selector }
}
