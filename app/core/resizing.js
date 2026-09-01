// W/H 的尺寸模式：对应 Figma 的 Fixed / Hug contents / Fill container。

export const AXES = {
  width:  { size: 'width',  min: 'min-width',  max: 'max-width',  prefix: 'W', label: '宽' },
  height: { size: 'height', min: 'min-height', max: 'max-height', prefix: 'H', label: '高' },
}

export const MODES = {
  fixed:  { id: 'fixed',  label: '固定' },
  hug:    { id: 'hug',    label: '贴合' },
  fill:   { id: 'fill',   label: '填满' },
  custom: { id: 'custom', label: '自定' },
}

const HUG_KEYWORDS = /^(fit-content|max-content|min-content)$/i
const LENGTH_RE = /^-?[\d.]+(px|r?em|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|q)?$/i
const SIZE_PROPS = [
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  // grid 轨道同样问不出声明值：computed 给的是算好的像素（"100px 100px"），
  // repeat(2, 1fr) 到那里就没了
  'grid-template-columns', 'grid-template-rows',
]

// VisBug 给选中元素挂了 transition: all .15s，改样式后立刻量会量到过渡中的
// 中间值。量之前把过渡关掉，量完还原——起点终点相同，不会有可见动画。
const withoutTransition = (el, fn) => {
  const prev = el.style.transition
  el.style.transition = 'none'
  try {
    return fn()
  } finally {
    prev ? (el.style.transition = prev) : el.style.removeProperty('transition')
  }
}

// 判定模式不能问 getComputedStyle——它返回的是**用后值**（像素），auto、
// fit-content、100% 到那里全都变成同一个数字，彼此无法区分。
//
// 曾经改用「行为探测」：把该轴临时设成 fit-content / 100% 看尺寸变不变。那个
// 办法准，但有副作用——改尺寸会触发 VisBug 选中框的 ResizeObserver，handles
// 被撑大后不跟着缩回，从此盖住旁边的元素，连点都点不到。
//
// 最终改成回样式表里读声明值。跨域样式表读不了，那种情况退回按 display 推断。

let ruleCache = null
let cacheKey = -1

const collectRules = (rules, out) => {
  for (const rule of Array.from(rules || [])) {
    // 先收自己。不能写成「有 cssRules 就递归并 continue」——CSS Nesting 之后
    // 普通的 CSSStyleRule 也有 cssRules（多数时候是空列表），那样写会把每一条
    // 普通规则都当成 @media 跳过，一条声明都收不到。
    if (rule.selectorText && rule.style &&
        SIZE_PROPS.some(p => rule.style.getPropertyValue(p)))
      out.push(rule)

    // 再往里找：@media / @supports / @layer，以及 CSS 嵌套的子规则
    if (rule.cssRules) collectRules(rule.cssRules, out)
  }
}

// 只留下真正声明过尺寸的规则。Tailwind 那种上万条的表，过滤完通常只剩几十条，
// 后面逐个 matches 才不至于慢。样式表数量变了就重建（SPA 会动态注入）。
const sizeRules = () => {
  const key = document.styleSheets.length
  if (ruleCache && cacheKey === key) return ruleCache

  ruleCache = []
  for (const sheet of Array.from(document.styleSheets || [])) {
    try { collectRules(sheet.cssRules, ruleCache) } catch { /* 跨域，读不了 */ }
  }
  cacheKey = key
  return ruleCache
}

export const invalidateRuleCache = () => { ruleCache = null; cacheKey = -1 }

export const declaredValue = (el, prop) => {
  const inline = el.style.getPropertyValue(prop).trim()
  if (inline) return inline

  let found = ''
  for (const rule of sizeRules()) {
    const v = rule.style.getPropertyValue(prop)
    if (!v) continue

    let hit = false
    try { hit = el.matches(rule.selectorText) } catch { continue }

    // 近似级联：后出现的规则覆盖先出现的。不算特异性——为了一个模式标签
    // 去实现完整的层叠计算不值得，实际冲突也极少。
    if (hit) found = v.trim()
  }
  return found
}

// 父容器是 flex 且该轴就是主轴时，「填满」的正确写法是 flex-grow 而不是
// width:100%——后者在有兄弟元素的 flex 行里会把它们挤出去。
export const isMainAxis = (el, axis) => {
  const parent = el?.parentElement
  if (!parent) return false

  const ps = getComputedStyle(parent)
  if (!/flex/.test(ps.display)) return false

  const column = /column/.test(ps.flexDirection || 'row')
  return axis === 'width' ? !column : column
}

export const resizeMode = (el, axis = 'width', computed = null) => {
  if (!el?.isConnected) return 'fixed'

  const declared = declaredValue(el, axis)

  if (declared && declared !== 'auto') {
    if (HUG_KEYWORDS.test(declared)) return 'hug'
    if (declared === '100%') return 'fill'
    if (LENGTH_RE.test(declared)) return 'fixed'
    return 'custom'      // calc()、var()、其它百分比
  }

  // 没有声明，或声明的就是 auto —— 行为取决于上下文
  // flex 主轴上，auto 由 flex-grow 决定：撑开还是包裹内容
  if (isMainAxis(el, axis)) {
    const grow = parseFloat(getComputedStyle(el).flexGrow) || 0
    return grow > 0 ? 'fill' : 'hug'
  }

  // 块级元素的宽度 auto 是撑满可用宽度，高度 auto 由内容决定；
  // 行内级两个方向都是收缩包裹。
  const display = computed?.display || getComputedStyle(el).display
  if (axis === 'height') return 'hug'
  return /^(inline|inline-block|inline-flex|inline-grid)$/.test(display) ? 'hug' : 'fill'
}

// 切换模式要写哪些属性。返回 { prop: value } 的补丁，null 表示删除该声明。
export const planResize = (el, axis, mode, computed = null) => {
  const patch = {}

  if (mode === 'hug') {
    patch[axis] = 'fit-content'
    if (isMainAxis(el, axis)) patch['flex-grow'] = null
    return patch
  }

  if (mode === 'fill') {
    if (isMainAxis(el, axis)) {
      // flex 主轴：flex-grow 撑开，尺寸声明要让路
      patch['flex-grow'] = '1'
      patch[axis] = null
    } else {
      patch[axis] = '100%'
    }
    return patch
  }

  // fixed：写下当前实测像素，用户拿到的是一个可继续微调的确切数字
  const rect = withoutTransition(el, () => el.getBoundingClientRect())
  patch[axis] = `${Math.round(rect[axis] * 100) / 100}px`
  if (isMainAxis(el, axis)) patch['flex-grow'] = null
  return patch
}

export const currentSize = el => {
  if (!el?.isConnected) return { width: 0, height: 0 }
  const rect = withoutTransition(el, () => el.getBoundingClientRect())
  return {
    width:  Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  }
}

// 页面上已定义的 CSS 自定义属性，供「使用变量」的候选。
// 只扫 :root / html 上的声明——组件局部变量对别的元素多半用不上，
// 全量扫描的代价也不值得。
export const cssVariables = () => {
  const out = new Set()

  for (const sheet of Array.from(document.styleSheets || [])) {
    let rules
    try { rules = sheet.cssRules } catch { continue }

    for (const rule of Array.from(rules || [])) {
      if (!rule.selectorText || !rule.style) continue
      if (!/^(:root|html)\b/.test(rule.selectorText)) continue

      for (const name of Array.from(rule.style)) {
        if (name.startsWith('--')) out.add(name)
      }
    }
  }

  for (const name of Array.from(document.documentElement.style || [])) {
    if (name.startsWith('--')) out.add(name)
  }

  return Array.from(out).sort()
}
