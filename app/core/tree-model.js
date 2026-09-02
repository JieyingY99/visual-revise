import { orderedChildren } from './reorder.js'
import { directText } from './anchors.js'

// 语义标签直接映射：它们本身就说明了「这是个什么」
const BY_TAG = {
  section: 'Section', article: 'Article', nav: 'Nav', header: 'Header',
  footer: 'Footer', main: 'Main', aside: 'Aside', form: 'Form', fieldset: 'Fieldset',
  ul: 'List', ol: 'List', li: 'List item', dl: 'List', table: 'Table',
  thead: 'Table head', tbody: 'Table body', tr: 'Row', td: 'Cell', th: 'Cell',
  img: 'Image', picture: 'Image', svg: 'Icon', video: 'Video', audio: 'Audio',
  canvas: 'Canvas', iframe: 'Frame', button: 'Button', a: 'Link',
  input: 'Input', textarea: 'Input', select: 'Select', label: 'Label',
  p: 'Paragraph', blockquote: 'Quote', pre: 'Code', code: 'Code',
  h1: 'Heading', h2: 'Heading', h3: 'Heading',
  h4: 'Heading', h5: 'Heading', h6: 'Heading',
}

// div / span 本身没有语义，只能看它实际扮演什么角色——这正是 Figma 图层名
// 的做法：横着排的容器叫 Row，竖着排的叫 Column，只裹着一段文字的叫 Text。
// 比清一色的「div」有用得多。
const roleOf = el => {
  const cs = getComputedStyle(el)
  if (/grid/.test(cs.display)) return 'Grid'
  if (/flex/.test(cs.display))
    return /column/.test(cs.flexDirection || 'row') ? 'Column' : 'Row'

  if (!orderedChildren(el).length && (el.textContent || '').trim()) return 'Text'
  return 'Frame'
}

export const semanticName = el =>
  BY_TAG[el.tagName.toLowerCase()] || roleOf(el)

// 预览取元素**自己**的文字，不取后代的：整段合并起来会把一个 section
// 的全文塞进一行，既看不清也没法区分兄弟节点
export const previewText = (el, limit = 24) => directText(el, limit)

export const describeNode = el => ({
  name: semanticName(el),
  preview: previewText(el),
  tag: el.tagName.toLowerCase(),
})

export const childrenOf = orderedChildren

// 从 body 到该元素的祖先链，用来把树展开到选中项
export const pathTo = el => {
  const chain = []
  let node = el?.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    chain.unshift(node)
    node = node.parentElement
  }
  return chain
}
