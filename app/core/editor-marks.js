/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 编辑器往页面元素上挂的记号：选中态、把手编号、拖拽落点标记。
// 它们只在编辑期间有意义，一旦跟着 outerHTML 走出去（⌘C / ⌘X / ⌘D，或者存进
// insert 记录）就会和之后的选中项撞号——缩放把手按 `[data-label-id="N"]` 取拖动
// 目标，撞号时它取的是文档顺序靠前的那个，于是去改了另一个元素。
//
// 单独一个模块、不 import 任何东西：change-store 要用它，而 change-store 会被
// 测试直接从源码 import 到页面里，链路上出现裸模块说明符（blingblingjs）就加载不了。
const EDITOR_MARKS = new Set([
  'data-selected', 'data-selected-hide', 'data-label-id', 'data-pseudo-select',
  'data-measuring', 'data-outward',
  'contenteditable', 'spellcheck',
])

const isEditorMark = name =>
  EDITOR_MARKS.has(name) || name.startsWith('data-vr-') || name.startsWith('data-visual-revise')

// 就地剥掉整棵子树上的编辑器记号。传进来的应当是克隆体——页面上那份还在用它们。
export const stripEditorMarks = root => {
  if (!root || root.nodeType !== 1) return root

  for (const el of [root, ...root.querySelectorAll('*')])
    for (const name of el.getAttributeNames())
      if (isEditorMark(name)) el.removeAttribute(name)

  return root
}
