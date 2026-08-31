import { takeSnapshot, diffSnapshot, revertProp, revertAll, elementId } from './snapshot.js'
import { collectAnchors } from './anchors.js'

const createStore = () => {
  const snapshots = new Map()
  const comments  = new Map()
  const listeners = new Set()
  let commentSeq  = 0

  const notify = () => listeners.forEach(fn => fn(read()))

  // 元素首次进入编辑视野时立即快照，晚于此的快照会把用户改动误当原始值
  const track = el => {
    const id = elementId(el)
    if (!snapshots.has(id)) snapshots.set(id, takeSnapshot(el))
    return snapshots.get(id)
  }

  const styleEdits = () =>
    Array.from(snapshots.values())
      .map(snap => ({
        id:      snap.id,
        el:      snap.el,
        anchors: snap.anchors,
        changes: diffSnapshot(snap),
      }))
      .filter(entry => entry.changes.length > 0)

  const commentList = () =>
    Array.from(comments.values())
      .filter(c => c.el.isConnected)
      .sort((a, b) => a.seq - b.seq)

  const read = () => ({
    edits:    styleEdits(),
    comments: commentList(),
  })

  const applyProp = (el, prop, value) => {
    track(el)
    value === '' || value == null
      ? el.style.removeProperty(prop)
      : el.style.setProperty(prop, value)
    notify()
  }

  const addComment = (el, text) => {
    track(el)
    const seq = ++commentSeq
    const id  = `c-${seq}`
    comments.set(id, { id, seq, el, text, anchors: collectAnchors(el) })
    notify()
    return id
  }

  const updateComment = (id, text) => {
    const c = comments.get(id)
    if (!c) return
    c.text = text
    notify()
  }

  const removeComment = id => {
    comments.delete(id)
    notify()
  }

  const undoProp = (id, prop) => {
    const snap = snapshots.get(id)
    if (!snap) return
    revertProp(snap, prop)
    notify()
  }

  const undoElement = id => {
    const snap = snapshots.get(id)
    if (!snap) return
    revertAll(snap)
    notify()
  }

  const undoEverything = () => {
    snapshots.forEach(revertAll)
    comments.clear()
    commentSeq = 0
    notify()
  }

  const clear = () => {
    snapshots.clear()
    comments.clear()
    commentSeq = 0
    notify()
  }

  const stats = () => {
    const { edits, comments: cs } = read()
    return {
      elements: edits.length,
      props:    edits.reduce((n, e) => n + e.changes.length, 0),
      comments: cs.length,
      total:    edits.reduce((n, e) => n + e.changes.length, 0) + cs.length,
    }
  }

  return {
    track, applyProp,
    addComment, updateComment, removeComment,
    undoProp, undoElement, undoEverything, clear,
    read, stats,
    snapshots,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

export const ChangeStore = createStore()
export { createStore }
