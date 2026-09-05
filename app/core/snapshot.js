/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { TRACKED_PROPS, sameValue } from './tracked-props.js'
import { collectAnchors } from './anchors.js'

let nextId = 1
const KEY = '__visualReviseId'

export const elementId = el => {
  if (!el[KEY]) el[KEY] = `vr-${nextId++}`
  return el[KEY]
}

// 记录改绑到重渲染出来的新节点时，要把原来的 id 一并过继过去。
// 不然 track() 会按新节点算出另一个 id，同一个元素冒出两条记录。
export const adoptId = (el, id) => {
  el[KEY] = id
  return el
}

// 文案比对用归一化后的 textContent：源码里的换行和缩进不是用户的改动
export const readText = el => (el.textContent || '').replace(/\s+/g, ' ').trim()

export const textNodesOf = el => {
  const out = []
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walk.nextNode())) out.push(node)
  return out
}

// innerHTML 只是还原不了文本节点时的兜底，给它设个上限，
// 免得选中一个大区块就把整棵子树的字符串留在内存里
const HTML_LIMIT = 50000

// 快照必须在元素被改动之前采集：记录原始 inline style、
// 全部关注属性的计算值（用户看到的实际起点），以及原始文案。
export const takeSnapshot = el => {
  const html = el.innerHTML
  return {
    id:          elementId(el),
    el,
    inlineStyle: el.getAttribute('style'),
    inline:      readInline(el),
    computed:    readComputed(el),
    text:        readText(el),
    textNodes:   textNodesOf(el).map(n => n.nodeValue),
    attrs:       readAttrs(el),
    // 只有真正进过编辑态的元素才比对文案，见 diffText
    edited:      false,
    html:        html.length <= HTML_LIMIT ? html : null,
    anchors:     collectAnchors(el),
    takenAt:     Date.now(),
  }
}

// VisBug 给选中元素加了 transition: all .15s（让键盘微调看起来跟手）。
// 副作用是：刚写完样式马上读计算值，读到的是过渡中的中间值——通常就是旧值。
// 面板每次改动后都要回读来刷新字段，读慢半拍就会把旧值显示出来、甚至拿旧值
// 去做下一步计算（新建渐变接不上当前填充色就是这么来的）。
//
// 读之前先把过渡关掉再还原。代价是正在跑的过渡会被取消，也就是面板发起的改动
// 变成立刻生效而不是渐变过去——对一个改稿工具来说这反而是对的。
export const readComputed = el => {
  const prev = el.style?.transition
  if (el.style) el.style.transition = 'none'

  const style = getComputedStyle(el)
  const out = TRACKED_PROPS.reduce((acc, prop) => {
    acc[prop] = style.getPropertyValue(prop).trim()
    return acc
  }, {})

  if (el.style) prev ? (el.style.transition = prev) : el.style.removeProperty('transition')
  return out
}

export const readInline = el => {
  const style = el.style
  return TRACKED_PROPS.reduce((acc, prop) => {
    const val = style.getPropertyValue(prop)
    if (val) acc[prop] = val.trim()
    return acc
  }, {})
}

// <img> 的 src 不是 CSS 属性，上面那套快照/diff 只覆盖 CSS，换图要改的正是它。
// 所以单独记一份。只记真正会被换掉的那几个——不做全属性快照，那既没意义，
// 也会把 class 这类被框架频繁改写的属性卷进改动记录里。
export const TRACKED_ATTRS = ['src', 'srcset', 'poster']

export const readAttrs = el => TRACKED_ATTRS.reduce((acc, name) => {
  if (el.hasAttribute?.(name)) acc[name] = el.getAttribute(name)
  return acc
}, {})

export const diffAttrs = (snapshot, { detached = false } = {}) => {
  const { el, attrs: original = {} } = snapshot
  if (!detached && !el?.isConnected) return []

  const current = readAttrs(el)
  const names = new Set([...Object.keys(original), ...Object.keys(current)])

  const out = []
  for (const name of names) {
    const from = original[name] ?? ''
    const to   = current[name] ?? ''
    if (from !== to) out.push({ attr: name, from, to })
  }
  return out
}

export const revertAttr = (snapshot, attr) => {
  const { el, attrs: original = {} } = snapshot
  if (!el?.isConnected) return
  original[attr] !== undefined
    ? el.setAttribute(attr, original[attr])
    : el.removeAttribute(attr)
}

const revertAllAttrs = snapshot => {
  for (const { attr } of diffAttrs(snapshot)) revertAttr(snapshot, attr)
}

// 基准必须是快照时的 inline 声明，不能是计算值：页面作者写的
// style="width:50%" 计算出来是 640px，拿两者相比会把元素原有的
// 样式当成用户的改动，凭空产出没人做过的改动记录。
//
// 前值优先取原始 inline 值（那是作者在源码里写的表达，AI 好对应），
// 该属性原本没有 inline 声明时才回落到计算值（用户在屏幕上看到的起点）。
export const diffSnapshot = (snapshot, { detached = false } = {}) => {
  const { el, computed, inline: original = {} } = snapshot
  if (!detached && !el.isConnected) return []

  const current = readInline(el)
  const changes = []

  for (const [prop, value] of Object.entries(current)) {
    if (sameValue(value, original[prop])) continue
    changes.push({
      prop,
      from: original[prop] || computed[prop] || '',
      to:   value,
    })
  }

  // 原本有 inline 声明、之后被移除的属性同样是一次改动。
  // 后值要读当前计算值——移除声明后元素回落到样式表，
  // 快照里的计算值是移除前的，不是用户现在看到的。
  const removed = Object.keys(original).filter(prop => !(prop in current))
  if (removed.length) {
    const now = getComputedStyle(el)
    removed.forEach(prop => changes.push({
      prop,
      from: original[prop],
      to:   now.getPropertyValue(prop).trim(),
    }))
  }

  // 前后值相等的不是改动。批量写入时很容易产生这种项：
  // 重排会给每个兄弟元素都写 order，其中恰好落回原位的那个
  // 会得到一条 "0→0" 的记录，既污染改动列表也污染提示词。
  return changes
    .filter(c => !sameValue(c.from, c.to))
    .sort((a, b) => TRACKED_PROPS.indexOf(a.prop) - TRACKED_PROPS.indexOf(b.prop))
}

// 双击页面文字会进入 VisBug 的编辑态，改动直接落在 DOM 上、不经过 applyProp，
// 所以文案要单独比。
//
// 只看真正被放进编辑态的元素（edited）。拿容器比会得到两类假货：容器的
// textContent 跟着子孙一起变，改一句话时所有祖先都报一条；而编辑途中才被
// 跟踪的祖先更糟——它的「原文」本身就已经是改了一半的样子。
export const diffText = (snapshot, { detached = false } = {}) => {
  const { el, text, edited } = snapshot
  if (!edited || text === undefined || (!detached && !el.isConnected)) return null

  const now = readText(el)
  return now === text ? null : { from: text, to: now }
}

// 还原文案优先按「文本节点逐个写回」，而不是整段 innerHTML：
// 在一段文字中间打字不会改变节点结构，这条路径能原样恢复且不动任何元素——
// 换成 innerHTML 会把子元素全部重建，它们身上的样式改动和快照就一起失联了。
// 只有结构真的变了（删掉整个 <strong>、回车分段）才退回 innerHTML。
export const revertText = snapshot => {
  const { el, text, textNodes, html, edited } = snapshot
  if (!edited || text === undefined) return false
  if (readText(el) === text) return false          // 没改过就别动 DOM

  const now = textNodesOf(el)
  if (textNodes && now.length === textNodes.length) {
    now.forEach((node, i) => { node.nodeValue = textNodes[i] })
    return true
  }

  if (html == null) return false                   // 内容超限，当时没存
  el.innerHTML = html
  return true
}

// 单条撤销：把某个属性还原到快照状态
// 原值从探针上按名取，而不是查 parseInlineStyle 的表：那张表是遍历
// CSSStyleDeclaration 得来的，只有长属性——border-radius: 8px 在里面是四个
// border-*-radius，查 'border-radius' 永远 undefined，结果就是把用户原本
// 写的圆角 remove 掉。padding / margin / border / gap / background / inset / flex
// 全都是这种短属性。探针的 getPropertyValue 会由浏览器从长属性合成短属性，
// 长短都认，!important 也一并保住。
export const revertProp = (snapshot, prop) => {
  const { el, inlineStyle } = snapshot
  const probe = document.createElement('div')
  probe.style.cssText = inlineStyle || ''
  const original = probe.style.getPropertyValue(prop)

  original
    ? el.style.setProperty(prop, original, probe.style.getPropertyPriority(prop))
    : el.style.removeProperty(prop)
}

// 全部重置：恢复原始 inline style 与原始文案
export const revertAll = snapshot => {
  revertText(snapshot)
  revertAllAttrs(snapshot)

  const { el, inlineStyle } = snapshot
  inlineStyle === null
    ? el.removeAttribute('style')
    : el.setAttribute('style', inlineStyle)
}

// 交给浏览器自己的 CSS 解析器。按裸分号切分会截断合法值里的分号，
// 例如 url("data:image/svg+xml;base64,...")——单条撤销时会把原样式
// 还原成一个被切碎的非法 url()，等于毁掉而不是恢复。
export const parseInlineStyle = cssText => {
  if (!cssText) return {}

  const probe = document.createElement('div')
  probe.style.cssText = cssText

  const out = {}
  for (const prop of probe.style) out[prop] = probe.style.getPropertyValue(prop)
  return out
}
