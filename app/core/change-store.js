import {
  takeSnapshot, diffSnapshot, diffText, diffAttrs,
  revertProp, revertText, revertAttr, revertAll, elementId, readText,
  readAttrs, TRACKED_ATTRS, textNodesOf,
} from './snapshot.js'
import { collectAnchors } from './anchors.js'
import { createHistory } from './history.js'

const createStore = () => {
  const snapshots = new Map()
  const comments  = new Map()
  const listeners = new Set()
  // 用户带进来的图（换图、评论参考图）。改动记录里只留 dataUrl，导出提示词时
  // 要按 dataUrl 反查回资产本身去落盘，所以正查反查都留一份索引。
  const assets     = new Map()   // id      → asset
  const assetByUrl = new Map()   // dataUrl → asset
  // 被删掉的元素。el 引用在移出 DOM 后仍在内存里，整棵子树都跟着，
  // 所以「恢复」是把同一个节点插回去，而不是照着记录重建。
  const removals   = new Map()   // id      → { el, parent, nextSibling, ... }
  let commentSeq  = 0
  let removalSeq  = 0

  const notify = () => listeners.forEach(fn => fn(read()))

  // ── 写入原语 ──
  // 这几个只管把值落到 DOM，不记历史。undo / redo 直接用它们回放，
  // 对外的 applyXxx 则在调用它们之后补一条历史。
  const writeProp = (el, prop, value) => {
    value === '' || value == null
      ? el.style.removeProperty(prop)
      : el.style.setProperty(prop, value)
  }

  const writeAttr = (el, attr, value) => {
    value === '' || value == null
      ? el.removeAttribute(attr)
      : el.setAttribute(attr, value)
  }

  const putBack = ({ el, parent, nextSibling }) => {
    if (!parent?.isConnected) return false
    nextSibling?.isConnected && nextSibling.parentElement === parent
      ? parent.insertBefore(el, nextSibling)
      : parent.appendChild(el)
    return true
  }

  // 「重置全部」这类大动作不适合逐条记：它一次动到所有被跟踪的元素。
  // 存一份整体快照，撤销就是整体写回。低频操作，这点开销值得。
  const captureAll = () => ({
    styles: Array.from(snapshots.values())
      .filter(snap => snap.el.isConnected)
      .map(snap => ({ el: snap.el, cssText: snap.el.getAttribute('style'), attrs: readAttrs(snap.el) })),
    comments:   Array.from(comments.values()).map(c => ({ ...c, images: (c.images || []).slice() })),
    commentSeq,
    removals:   Array.from(removals.values()).map(r => ({ ...r })),
    removalSeq,
    // 被删掉的元素此刻不在 DOM 上，恢复时要按记录插回去
    detached:   Array.from(removals.values()).filter(r => !r.el.isConnected).map(r => r.id),
  })

  const restoreAll = state => {
    for (const { el, cssText, attrs } of state.styles) {
      cssText === null ? el.removeAttribute('style') : el.setAttribute('style', cssText)
      for (const name of TRACKED_ATTRS) writeAttr(el, name, attrs[name] ?? '')
    }

    comments.clear()
    state.comments.forEach(c => comments.set(c.id, { ...c, images: (c.images || []).slice() }))
    commentSeq = state.commentSeq

    removals.clear()
    state.removals.forEach(r => removals.set(r.id, { ...r }))
    removalSeq = state.removalSeq

    // 该在 DOM 上的放回去，该不在的移走
    for (const r of removals.values()) {
      const shouldBeDetached = state.detached.includes(r.id)
      if (shouldBeDetached && r.el.isConnected) r.el.remove()
      if (!shouldBeDetached && !r.el.isConnected) putBack(r)
    }
  }

  const captureElement = el => ({
    cssText:   el.getAttribute('style'),
    attrs:     readAttrs(el),
    textNodes: textNodesOf(el).map(n => n.nodeValue),
  })

  // 一条历史怎么落回 DOM。dir='undo' 取 before，'redo' 取 after。
  const applyOp = (op, dir) => {
    const value = dir === 'undo' ? op.before : op.after

    switch (op.kind) {
      case 'prop':
        writeProp(op.el, op.prop, value)
        break

      case 'attr':
        writeAttr(op.el, op.attr, value)
        break

      case 'comment':
        value ? comments.set(op.id, { ...value, images: (value.images || []).slice() })
              : comments.delete(op.id)
        break

      // 元素在不在 DOM 上，以及它在 removals 里的登记
      case 'dom': {
        const attached = dir === 'undo' ? op.beforeAttached : op.afterAttached
        attached ? putBack(op) : op.el.remove()

        const record = dir === 'undo' ? op.beforeRecord : op.afterRecord
        record ? removals.set(op.id, { ...record }) : removals.delete(op.id)
        break
      }

      // 整个元素的样式 / 属性 / 文案一并回到某个状态（「撤销此元素全部改动」）
      case 'element': {
        const st = value
        st.cssText === null ? op.el.removeAttribute('style') : op.el.setAttribute('style', st.cssText)
        for (const name of TRACKED_ATTRS) writeAttr(op.el, name, st.attrs[name] ?? '')
        if (st.textNodes) {
          const nodes = textNodesOf(op.el)
          if (nodes.length === st.textNodes.length)
            nodes.forEach((n, i) => { n.nodeValue = st.textNodes[i] })
        }
        break
      }

      case 'text': {
        const nodes = textNodesOf(op.el)
        if (nodes.length === value.length) nodes.forEach((n, i) => { n.nodeValue = value[i] })
        break
      }

      case 'all':
        restoreAll(value)
        break
    }
  }

  const history = createHistory({ apply: applyOp, onChange: () => notify() })

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

  // 删除由 VisBug 在按键事件的后续阶段执行，调用这里时元素还在 DOM 上——
  // 我们要的正是此刻的父节点与位置，删完就取不到了。
  // 记录与删除是一件事：元素一旦离开 DOM 就取不到父节点与后邻，
  // 分成两步调用时，中间任何一次重绘都会看到一个「已记录但还在页面上」的状态。
  const removeElements = els => {
    const list = Array.from(els || []).filter(el => el?.nodeType === 1 && el.isConnected)
    if (!list.length) return []

    // 同时选中父与子时，删父会连带把子删掉。只处理最外层那条：子元素跟着
    // 父节点一起回来，单独记会在恢复时插出重复节点。
    const outermost = list.filter(el => !list.some(o => o !== el && o.contains(el)))

    return history.batch(
      outermost.length > 1 ? `删除 ${outermost.length} 个元素` : '删除元素',
      () => {
        const ids = []
        for (const el of outermost) {
          track(el)
          const id = elementId(el)
          const record = {
            id,
            seq:         ++removalSeq,
            el,
            parent:      el.parentElement,
            nextSibling: el.nextElementSibling,
            anchors:     collectAnchors(el),
            tag:         el.tagName.toLowerCase(),
            text:        readText(el).slice(0, 80),
            childCount:  el.children.length,
          }

          removals.set(id, record)
          history.push({
            kind: 'dom', id, el,
            parent: record.parent, nextSibling: record.nextSibling,
            beforeAttached: true,  beforeRecord: null,
            afterAttached: false,  afterRecord: { ...record },
          })
          el.remove()
          ids.push(id)
        }

        notify()
        return ids
      })
  }

  // 兼容旧调用点：只记录、不删除
  const recordRemoval = els => removeElements(els)

  // 已经被放回去的不再算删除
  const removalList = () =>
    Array.from(removals.values())
      .filter(r => !r.el.isConnected)
      .sort((a, b) => a.seq - b.seq)

  const canRestore = rec => !!rec?.parent?.isConnected

  const restoreRemoval = id => {
    const rec = removals.get(id)
    if (!rec) return false

    // 父节点自己也被删了（或页面重渲染换掉了整棵树），没有可插回的位置
    if (!canRestore(rec)) return false

    putBack(rec)
    removals.delete(id)

    history.push({
      kind: 'dom', id, el: rec.el,
      parent: rec.parent, nextSibling: rec.nextSibling,
      beforeAttached: false, beforeRecord: { ...rec },
      afterAttached: true,   afterRecord: null,
    }, '放回元素')

    notify()
    return true
  }

  const commentList = () =>
    Array.from(comments.values())
      .filter(c => c.el.isConnected)
      .sort((a, b) => a.seq - b.seq)

  const read = () => ({
    edits:    styleEdits(),
    comments: commentList(),
    removals: removalList(),
  })

  const applyProp = (el, prop, value) => {
    track(el)

    const before = el.style.getPropertyValue(prop)
    const after = value == null ? '' : String(value)
    // 值没变就不记：面板每次重绘都会回写一遍字段，不挡住的话历史里会塞满空操作
    if (before === after) return

    writeProp(el, prop, after)
    history.push({ kind: 'prop', el, prop, before, after }, prop)
    notify()
  }

  // src/poster 这类 HTML 属性不经过 CSS 通道，单独走这里
  const applyAttr = (el, attr, value) => {
    track(el)

    const before = el.getAttribute(attr) ?? ''
    const after = value == null ? '' : String(value)
    if (before === after) return

    writeAttr(el, attr, after)
    history.push({ kind: 'attr', el, attr, before, after }, attr === 'src' ? '换图' : attr)
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

  const snapComment = c => (c ? { ...c, images: (c.images || []).slice() } : null)

  const addComment = (el, text, images = []) => {
    track(el)
    const seq = ++commentSeq
    const id  = `c-${seq}`
    images.forEach(addAsset)
    const record = { id, seq, el, text, images: images.slice(), anchors: collectAnchors(el) }
    comments.set(id, record)
    history.push({ kind: 'comment', id, before: null, after: snapComment(record) }, '添加评论')
    notify()
    return id
  }

  // images 省略时不动原有的图——调用方只想改文字的场景占多数
  const updateComment = (id, text, images) => {
    const c = comments.get(id)
    if (!c) return

    const before = snapComment(c)
    c.text = text
    if (images) {
      images.forEach(addAsset)
      c.images = images.slice()
    }

    history.push({ kind: 'comment', id, before, after: snapComment(c) }, '修改评论')
    notify()
  }

  const setCommentImages = (id, images = []) => {
    const c = comments.get(id)
    if (!c) return

    const before = snapComment(c)
    images.forEach(addAsset)
    c.images = images.slice()

    history.push({ kind: 'comment', id, before, after: snapComment(c) }, '评论参考图')
    notify()
  }

  const removeComment = id => {
    const before = snapComment(comments.get(id))
    if (!before) return

    comments.delete(id)
    history.push({ kind: 'comment', id, before, after: null }, '删除评论')
    notify()
  }

  // 「按项撤销」本身也是一次操作，同样要能被 ⌘Z 救回来——
  // 误点了重置却没法反悔，比不能撤销更糟。
  const undoText = id => {
    const snap = snapshots.get(id)
    if (!snap) return

    const before = textNodesOf(snap.el).map(n => n.nodeValue)
    revertText(snap)
    const after = textNodesOf(snap.el).map(n => n.nodeValue)

    if (before.join('\u0000') !== after.join('\u0000'))
      history.push({ kind: 'text', el: snap.el, before, after }, '还原文案')
    notify()
  }

  const undoAttr = (id, attr) => {
    const snap = snapshots.get(id)
    if (!snap) return

    const before = snap.el.getAttribute(attr) ?? ''
    revertAttr(snap, attr)
    const after = snap.el.getAttribute(attr) ?? ''

    if (before !== after)
      history.push({ kind: 'attr', el: snap.el, attr, before, after }, '还原图片')
    notify()
  }

  const undoProp = (id, prop) => {
    const snap = snapshots.get(id)
    if (!snap) return

    const before = snap.el.style.getPropertyValue(prop)
    revertProp(snap, prop)
    const after = snap.el.style.getPropertyValue(prop)

    if (before !== after)
      history.push({ kind: 'prop', el: snap.el, prop, before, after }, `还原 ${prop}`)
    notify()
  }

  const undoElement = id => {
    const snap = snapshots.get(id)
    if (!snap) return

    const before = captureElement(snap.el)
    revertAll(snap)
    history.push({ kind: 'element', el: snap.el, before, after: captureElement(snap.el) }, '还原元素')
    notify()
  }

  const undoEverything = () => {
    // 一次动到所有被跟踪的元素，逐条记不划算。存一份整体快照，撤销就是整体写回。
    const before = captureAll()

    // 先把删掉的放回去再还原样式：元素得先在 DOM 上，样式才写得进去。
    // 倒序恢复，让先删的后回——同一父节点下的相对顺序才对得上。
    Array.from(removals.values())
      .sort((a, b) => b.seq - a.seq)
      .forEach(r => { if (canRestore(r)) putBack(r) })
    removals.clear()
    removalSeq = 0

    snapshots.forEach(revertAll)
    comments.clear()
    commentSeq = 0
    // 资产不跟着清：⌘Z 撤回这次重置时，换过的图还得能找回来
    history.push({ kind: 'all', before, after: captureAll() }, '重置全部改动')
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
    // 只丢记录，不把元素放回去——clear 的语义是「忘掉这些改动」，
    // 不是「撤销它们」，那是 undoEverything 的事
    removals.clear()
    commentSeq = 0
    removalSeq = 0
    notify()
  }

  const stats = () => {
    const { edits, comments: cs, removals: rm } = read()
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
      removals: rm.length,
      total:    props + texts + attrs + cs.length + rm.length,
    }
  }

  return {
    track, markEdited, applyProp, applyAttr,
    addAsset, getAsset, assetForUrl, allAssets,
    addComment, updateComment, removeComment, setCommentImages,
    recordRemoval, removeElements, restoreRemoval, canRestore,
    undoProp, undoText, undoAttr, undoElement, undoEverything, clear,
    read, stats, touch,
    snapshots,
    history,
    undo: () => history.undo(),
    redo: () => history.redo(),
    get canUndo() { return history.canUndo },
    get canRedo() { return history.canRedo },
    // 文案编辑绕过 store 直接改 DOM，由编辑态在开始/结束时把这一段圈成一条历史
    beginText(el) {
      return { el, before: textNodesOf(el).map(n => n.nodeValue) }
    },
    endText(mark) {
      if (!mark?.el?.isConnected) return
      const after = textNodesOf(mark.el).map(n => n.nodeValue)
      if (mark.before.join('\u0000') === after.join('\u0000')) return
      history.push({ kind: 'text', el: mark.el, before: mark.before, after }, '改文案')
      notify()
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

export const ChangeStore = createStore()
export { createStore }
