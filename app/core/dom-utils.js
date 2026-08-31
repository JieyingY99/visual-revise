import { isOffBounds } from '../utilities/common.js'

// 编辑器的选中框、标尺、评论 pin 都浮在页面之上，事件的 path[0]
// 往往是这些覆盖层而非用户真正指向的页面元素。
// 沿命中栈向下找第一个不属于编辑器的元素。
export const pageElementAt = (clientX, clientY) => {
  const stack = document.elementsFromPoint(clientX, clientY)
  return stack.find(node => node.nodeType === 1 && !isOffBounds(node)) || null
}

export const isEditorUI = eventOrPath => {
  const path = Array.isArray(eventOrPath)
    ? eventOrPath
    : (eventOrPath.composedPath?.() || [])

  return path.some(node =>
    node?.nodeType === 1 && (isOffBounds(node) || node.tagName === 'VIS-BUG'))
}

// 用户正在页面的输入控件里打字时，单字母快捷键必须让路，
// 否则输入 "correct" 会触发评论模式与重排模式。
// VisBug 的双击文本编辑会把普通元素变成 contenteditable，同样要排除。
export const isTypingTarget = event => {
  const node = event.composedPath?.()[0] || event.target
  if (!node || node.nodeType !== 1) return false

  const tag = node.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true

  return node.isContentEditable === true
}
