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

const readInline = el => {
  const style = el.style
  return TRACKED_PROPS.reduce((acc, prop) => {
    const val = style.getPropertyValue(prop)
    if (val) acc[prop] = val.trim()
    return acc
  }, {})
}

// 与快照对比，得出真正被改动的属性及其前后值。
// 前值取快照时的计算值，因为那是用户实际看到的起点。
export const diffSnapshot = snapshot => {
  const { el, computed } = snapshot
  if (!el.isConnected) return []

  const inline = readInline(el)

  return Object.entries(inline)
    .filter(([prop, value]) => !sameValue(value, computed[prop]))
    .map(([prop, value]) => ({
      prop,
      from: computed[prop] || '',
      to:   value,
    }))
    .sort((a, b) => TRACKED_PROPS.indexOf(a.prop) - TRACKED_PROPS.indexOf(b.prop))
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

export const parseInlineStyle = cssText => {
  if (!cssText) return {}
  return cssText.split(';').reduce((acc, decl) => {
    const idx = decl.indexOf(':')
    if (idx < 0) return acc
    const prop = decl.slice(0, idx).trim()
    const value = decl.slice(idx + 1).trim()
    if (prop) acc[prop] = value
    return acc
  }, {})
}
