import {
  takeSnapshot, diffSnapshot, diffText, diffAttrs,
  revertProp, revertText, revertAttr, revertAll, elementId,
} from './snapshot.js'
import { collectAnchors } from './anchors.js'

const createStore = () => {
  const snapshots = new Map()
  const comments  = new Map()
  const listeners = new Set()
  // 用户带进来的图（换图、评论参考图）。改动记录里只留 dataUrl，导出提示词时
  // 要按 dataUrl 反查回资产本身去落盘，所以正查反查都留一份索引。
  const assets     = new Map()   // id      → asset
  const assetByUrl = new Map()   // dataUrl → asset
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
      attrs:   diffAttrs(snap),
    }))

    // 改一句话会让它所有祖先的 textContent 都跟着变。祖先和后代都报文案改动时
    // 只留最内层那个——它才是用户真正动的元素，外层那条是连带的。
    const texted = entries.filter(e => e.text)
    for (const entry of texted)
      if (texted.some(other => other !== entry && entry.el.contains(other.el)))
        entry.text = null

    return entries.filter(entry => entry.changes.length > 0 || entry.text || entry.attrs.length > 0)
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

  // src/poster 这类 HTML 属性不经过 CSS 通道，单独走这里
  const applyAttr = (el, attr, value) => {
    track(el)
    value === '' || value == null
      ? el.removeAttribute(attr)
      : el.setAttribute(attr, value)
    notify()
  }

  const addAsset = asset => {
    if (!asset?.id) return asset
    assets.set(asset.id, asset)
    if (asset.dataUrl) assetByUrl.set(asset.dataUrl, asset)
    return asset
  }

  const getAsset    = id  => assets.get(id) || null
  const assetForUrl = url => (url ? assetByUrl.get(url) || null : null)
  const allAssets   = ()  => Array.from(assets.values())

  const addComment = (el, text, images = []) => {
    track(el)
    const seq = ++commentSeq
    const id  = `c-${seq}`
    images.forEach(addAsset)
    comments.set(id, { id, seq, el, text, images: images.slice(), anchors: collectAnchors(el) })
    notify()
    return id
  }

  // images 省略时不动原有的图——调用方只想改文字的场景占多数
  const updateComment = (id, text, images) => {
    const c = comments.get(id)
    if (!c) return
    c.text = text
    if (images) {
      images.forEach(addAsset)
      c.images = images.slice()
    }
    notify()
  }

  const setCommentImages = (id, images = []) => {
    const c = comments.get(id)
    if (!c) return
    images.forEach(addAsset)
    c.images = images.slice()
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

  const undoAttr = (id, attr) => {
    const snap = snapshots.get(id)
    if (!snap) return
    revertAttr(snap, attr)
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
    // 资产跟着改动一起作废：改动都撤了，那些图也没有任何记录引用得到
    assets.clear()
    assetByUrl.clear()
    notify()
  }

  // 文字编辑绕过 applyProp 直接改 DOM，store 无从感知，
  // 由编辑态的输入事件调这个方法广播一次
  const touch = () => notify()

  const clear = () => {
    snapshots.clear()
    comments.clear()
    assets.clear()
    assetByUrl.clear()
    commentSeq = 0
    notify()
  }

  const stats = () => {
    const { edits, comments: cs } = read()
    const props = edits.reduce((n, e) => n + e.changes.length, 0)
    const texts = edits.filter(e => e.text).length
    const attrs  = edits.reduce((n, e) => n + (e.attrs?.length || 0), 0)
    // 参考图不单独计入 total：它是评论的附属物，不是一条独立改动
    const refImages = cs.reduce((n, c) => n + (c.images?.length || 0), 0)

    return {
      elements: edits.length,
      props,
      texts,
      attrs,
      refImages,
      comments: cs.length,
      total:    props + texts + attrs + cs.length,
    }
  }

  return {
    track, markEdited, applyProp, applyAttr,
    addAsset, getAsset, assetForUrl, allAssets,
    addComment, updateComment, removeComment, setCommentImages,
    undoProp, undoText, undoAttr, undoElement, undoEverything, clear,
    read, stats, touch,
    snapshots,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

export const ChangeStore = createStore()
export { createStore }
