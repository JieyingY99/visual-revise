/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 操作历史：past / future 两个栈，撑起 ⌘Z / ⌘⇧Z。
//
// 每条历史是一组 op，用**数据**描述而不是闭包。闭包会悄悄捕获一堆状态，
// 出了问题根本看不出这次撤销到底会做什么；数据可以打印、可以断言。
//
// 具体怎么把一个 op 写回 DOM 由 change-store 提供（它才知道属性、评论、
// 删除各自该怎么落地），这里只管栈、合并与批量。

export const HISTORY_LIMIT = 100

// 同元素同属性、间隔够近的连续改动算一次操作。拖动一次标签会产生上百次
// applyProp，不合并的话 ⌘Z 得按上百次才回得去。
const MERGE_WINDOW = 400

export const createHistory = ({ apply, onChange } = {}) => {
  const past = []
  const future = []

  let batchDepth = 0
  let batchOps = null
  let batchLabel = ''
  // undo / redo 自身写回 DOM 时不能再入栈，否则撤销一次就多一条历史
  let muted = false

  const mergeable = (entry, op) =>
    entry &&
    entry.ops.length === 1 &&
    entry.ops[0].kind === 'prop' &&
    op.kind === 'prop' &&
    entry.ops[0].el === op.el &&
    entry.ops[0].prop === op.prop &&
    Date.now() - entry.time <= MERGE_WINDOW

  const commit = (ops, label) => {
    if (!ops?.length) return

    const last = past[past.length - 1]
    if (ops.length === 1 && mergeable(last, ops[0])) {
      // 合并：起点保留最早那次的 before，终点更新为最新的 after
      last.ops[0].after = ops[0].after
      last.time = Date.now()
    } else {
      past.push({ label, ops, time: Date.now() })
      // 满了丢最旧的。持有 DOM 引用与字符串，不设上限的话改稿一小时就攒下几千条
      if (past.length > HISTORY_LIMIT) past.shift()
    }

    // 有新操作就断掉重做链——这是所有编辑器的通行约定
    future.length = 0
    onChange?.()
  }

  const push = (op, label = '') => {
    if (muted || !op) return
    if (batchDepth > 0) { batchOps.push(op); return }
    commit([op], label)
  }

  // 一个动作写多条属性时包一层：切排列方式会写 display + flex-direction +
  // 对齐好几条，「填满」会写 flex-grow + flex-basis 并清掉 width。
  // 它们是一个动作，得一次撤完。
  const batch = (label, fn) => {
    if (muted) return fn()

    batchDepth++
    if (batchDepth === 1) { batchOps = []; batchLabel = label }

    try {
      return fn()
    } finally {
      batchDepth--
      if (batchDepth === 0) {
        const ops = batchOps
        batchOps = null
        commit(ops, batchLabel)
      }
    }
  }

  const run = (entry, dir) => {
    muted = true
    try {
      // 撤销要反着走：后做的先撤，否则相互依赖的几步会错位
      const ops = dir === 'undo' ? entry.ops.slice().reverse() : entry.ops
      for (const op of ops) apply?.(op, dir)
    } finally {
      muted = false
    }
  }

  const undo = () => {
    const entry = past.pop()
    if (!entry) return null

    run(entry, 'undo')
    future.push(entry)
    onChange?.()
    return entry
  }

  const redo = () => {
    const entry = future.pop()
    if (!entry) return null

    run(entry, 'redo')
    past.push(entry)
    onChange?.()
    return entry
  }

  return {
    push, batch, undo, redo,
    get canUndo()   { return past.length > 0 },
    get canRedo()   { return future.length > 0 },
    get undoLabel() { return past[past.length - 1]?.label || '' },
    get redoLabel() { return future[future.length - 1]?.label || '' },
    get depth()     { return past.length },
    get muted()     { return muted },
    clear() { past.length = 0; future.length = 0; onChange?.() },
  }
}
