/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { isOffBounds } from '../utilities/common.js'

// 编辑器的选中框、标尺、评论 pin 都浮在页面之上，事件的 path[0]
// 往往是这些覆盖层而非用户真正指向的页面元素。
// 沿命中栈向下找第一个不属于编辑器的元素。
export const pageElementAt = (clientX, clientY) => {
  const stack = document.elementsFromPoint(clientX, clientY)
  return stack.find(node => node.nodeType === 1 && !isOffBounds(node)) || null
}

// 三种入参都要认：事件、路径数组、单个元素。
// 早先只处理前两种——传元素时 `el.composedPath?.()` 是 undefined，走 `|| []`
// 之后恒返回 false。它不报错，只是让每一处 `!isEditorUI(el)` 变成永真，
// 守卫形同虚设。传元素的调用点有四个（删除过滤、删除后选邻居、
// 文本编辑的两道守卫），全都靠别的机制侥幸没出事。
export const isEditorUI = eventOrNode => {
  const path = Array.isArray(eventOrNode)
    ? eventOrNode
    : typeof eventOrNode?.composedPath === 'function'
      ? eventOrNode.composedPath()
      // isOffBounds 自己会沿 closest + shadow host 往上找，单个元素就够
      : eventOrNode?.nodeType === 1
        ? [eventOrNode]
        : []

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

// 悬停在浮层上时，滚轮应该滚浮层而不是底下的页面。
// overscroll-behavior 只在滚到边界时起作用；当滚动容器本身不可滚动
// （内容没超出、或指针落在 header 这类非滚动区），事件仍会冒泡到页面。
// 因此统一接管：在浮层范围内一律 preventDefault，自行驱动滚动。
export const containScroll = (host, getScroller) => {
  const onWheel = e => {
    const el = getScroller()
    if (!el) return

    e.preventDefault()

    const max = el.scrollHeight - el.clientHeight
    if (max <= 0) return

    el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + e.deltaY))
  }

  host.addEventListener('wheel', onWheel, { passive: false })
  return () => host.removeEventListener('wheel', onWheel, { passive: false })
}

// 元素是否以文字为主体。判据是「直接子节点里有非空文本」，而不是 textContent
// 非空——后者会让任何一个包着文字的外层容器都算文字元素，判断永远为真也就
// 失去了意义。输入控件没有文本子节点，但它显示的就是文字，单独认。
const TEXT_INPUT_TYPES = new Set([
  '', 'text', 'search', 'url', 'tel', 'email', 'password', 'number',
])

export const isTextElement = el => {
  if (!el || el.nodeType !== 1) return false

  const tag = el.tagName.toLowerCase()
  if (tag === 'textarea') return true
  if (tag === 'input')
    return TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').trim().toLowerCase())
  if (el.isContentEditable) return true

  return Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())
}
