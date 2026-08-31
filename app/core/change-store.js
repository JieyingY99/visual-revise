import {
  takeSnapshot, diffSnapshot, diffText, revertProp, revertText, revertAll, elementId,
} from './snapshot.js'
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

  // 元素进入文字编辑态时打个标记：只有它的文案才值得比对
  const markEdited = el => {
    const snap = track(el)
    snap.edited = true
    return snap
  }

  const styleEdits = () => {
    const entries = Array.from(snapshots.values()).map(snap => ({
      id:      snap.id,
      el:      snap.el,
      anchors: snap.anchors,
      changes: diffSnapshot(snap),
      text:    diffText(snap),
    }))

    // 改一句话会让它所有祖先的 textContent 都跟着变。祖先和后代都报文案改动时
    // 只留最内层那个——它才是用户真正动的元素，外层那条是连带的。
    const texted = entries.filter(e => e.text)
    for (const entry of texted)
      if (texted.some(other => other !== entry && entry.el.contains(other.el)))
        entry.text = null

    return entries.filter(entry => entry.changes.length > 0 || entry.text)
  }

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

  const undoText = id => {
    const snap = snapshots.get(id)
    if (!snap) return
    revertText(snap)
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

  // 文字编辑绕过 applyProp 直接改 DOM，store 无从感知，
  // 由编辑态的输入事件调这个方法广播一次
  const touch = () => notify()

  const clear = () => {
    snapshots.clear()
    comments.clear()
    commentSeq = 0
    notify()
  }

  const stats = () => {
    const { edits, comments: cs } = read()
    const props = edits.reduce((n, e) => n + e.changes.length, 0)
    const texts = edits.filter(e => e.text).length

    return {
      elements: edits.length,
      props,
      texts,
      comments: cs.length,
      total:    props + texts + cs.length,
    }
  }

  return {
    track, markEdited, applyProp,
    addComment, updateComment, removeComment,
    undoProp, undoText, undoElement, undoEverything, clear,
    read, stats, touch,
    snapshots,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

export const ChangeStore = createStore()
export { createStore }
