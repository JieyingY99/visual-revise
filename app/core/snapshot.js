import { TRACKED_PROPS, sameValue } from './tracked-props.js'
import { collectAnchors } from './anchors.js'

let nextId = 1
const KEY = '__visualReviseId'

export const elementId = el => {
  if (!el[KEY]) el[KEY] = `vr-${nextId++}`
  return el[KEY]
}

// 快照必须在元素被改动之前采集：记录原始 inline style，
// 以及全部关注属性的计算值（用户看到的实际起点）。
export const takeSnapshot = el => ({
  id:          elementId(el),
  el,
  inlineStyle: el.getAttribute('style'),
  inline:      readInline(el),
  computed:    readComputed(el),
  anchors:     collectAnchors(el),
  takenAt:     Date.now(),
})

export const readComputed = el => {
  const style = getComputedStyle(el)
  return TRACKED_PROPS.reduce((acc, prop) => {
    acc[prop] = style.getPropertyValue(prop).trim()
    return acc
  }, {})
}

export const readInline = el => {
  const style = el.style
  return TRACKED_PROPS.reduce((acc, prop) => {
    const val = style.getPropertyValue(prop)
    if (val) acc[prop] = val.trim()
    return acc
  }, {})
}

// 基准必须是快照时的 inline 声明，不能是计算值：页面作者写的
// style="width:50%" 计算出来是 640px，拿两者相比会把元素原有的
// 样式当成用户的改动，凭空产出没人做过的改动记录。
//
// 前值优先取原始 inline 值（那是作者在源码里写的表达，AI 好对应），
// 该属性原本没有 inline 声明时才回落到计算值（用户在屏幕上看到的起点）。
export const diffSnapshot = snapshot => {
  const { el, computed, inline: original = {} } = snapshot
  if (!el.isConnected) return []

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

  return changes.sort((a, b) =>
    TRACKED_PROPS.indexOf(a.prop) - TRACKED_PROPS.indexOf(b.prop))
}

// 单条撤销：把某个属性还原到快照状态
export const revertProp = (snapshot, prop) => {
  const { el, inlineStyle } = snapshot
  const original = parseInlineStyle(inlineStyle)

  original[prop] !== undefined
    ? el.style.setProperty(prop, original[prop])
    : el.style.removeProperty(prop)
}

// 全部重置：恢复原始 inline style
export const revertAll = snapshot => {
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
