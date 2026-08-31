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
