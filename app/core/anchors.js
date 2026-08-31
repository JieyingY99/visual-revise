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
