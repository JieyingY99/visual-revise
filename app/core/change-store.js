import {
  takeSnapshot, diffSnapshot, diffText, diffAttrs,
  revertProp, revertText, revertAttr, revertAll, elementId, adoptId, readText,
  readInline, readAttrs, TRACKED_ATTRS, textNodesOf,
} from './snapshot.js'
import {
  collectAnchors, resolveElement, stableClasses, textLandmarks,
} from './anchors.js'
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
    // 失联记录不在 styles 里（那里只收还连着的），单独存一份，
    // 否则撤销重置时它们回不来
    frozen:     Array.from(snapshots.values()).filter(s => s.frozen)
                  .map(s => ({ id: s.id, frozen: s.frozen, orphaned: s.orphaned })),
  })

  const restoreAll = state => {
    for (const { el, cssText, attrs } of state.styles) {
      cssText === null ? el.removeAttribute('style') : el.setAttribute('style', cssText)
      for (const name of TRACKED_ATTRS) writeAttr(el, name, attrs[name] ?? '')
    }

    for (const snap of snapshots.values()) {
      snap.frozen = null
      snap.orphaned = false
    }
    for (const { id, frozen, orphaned } of state.frozen || []) {
      const snap = snapshots.get(id)
      if (!snap) continue
      snap.frozen = frozen
      snap.orphaned = orphaned
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
    const entries = Array.from(snapshots.values()).map(snap => snap.frozen ? {
      id:      snap.id,
      el:      snap.el,
      anchors: snap.anchors,
      orphaned: true,
      ...snap.frozen,
    } : {
      id:      snap.id,
      el:      snap.el,
      anchors: snap.anchors,
      changes: diffSnapshot(snap),
      text:    diffText(snap),
      attrs:   diffAttrs(snap),
    })

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
            identity:    identityOf(el),
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
      // fighting 的元素此刻正躺在页面上（我们已经停止重复删除），
      // 但那条记录依然是用户的意图，必须留在列表里说明情况
      .filter(r => !r.el.isConnected || r.fighting)
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
      // 失联但没被重定位回来的不能直接丢：那正是「标注莫名其妙消失」的成因。
      // 留在列表里标成 orphaned，用户至少知道发生了什么。
      .filter(c => c.el.isConnected || c.orphaned)
      .map(c => (c.el.isConnected ? c : { ...c, orphaned: true }))
      .sort((a, b) => a.seq - b.seq)

  // ── 重新锚定 ────────────────────────────────────────────────
  // 记录挂的是 DOM 节点引用。框架（React / Vue…）重渲染时会把节点整个换掉，
  // 引用随之悬空，所有挂在上面的改动就静默消失了——用户看到的是「标注被清空」。
  //
  // 没有「切回来」这样一个可以挂钩子的时刻：重渲染发生在 hover、请求返回、
  // 任意一次 state 变化时。所以这里是持续对账：DOM 一变就找回失联的记录，
  // 按锚点重新绑定，并把用户的改动重新贴回新节点。

  // 身份 ≠ 位置。标签 + 稳定类名 + 首条文本特征，足以区分「同一个东西回来了」
  // 和「隔壁那个刚好挪到了这个位置」。
  const identityOf = el =>
    `${el.tagName}|${stableClasses(el).join('.')}|${textLandmarks(el, 1)[0] || ''}`

  // 从别处导入的记录没有 identity 字段（那是这次才加的）。锚点里存着同样的
  // 三样东西，推得出来——不然守卫会被静默跳过，级联删除就又回来了。
  const identityOfRecord = rec => rec.identity || [
    (rec.anchors?.tag || '').toUpperCase(),
    (rec.anchors?.classes || []).join('.'),
    rec.anchors?.text?.[0] || '',
  ].join('|')

  // 同类记录之间不能抢同一个元素。但样式记录和评论是两个维度——同一个元素
  // 上既有改动又有备注是正常的，混在一个集合里会让后处理的那类被判成失联。
  const claimedBy = map => {
    const set = new Set()
    for (const rec of map.values()) if (rec.el?.isConnected) set.add(rec.el)
    return set
  }

  // 「元素被换掉了」和「元素被删掉了」，从记录的角度看是同一个现象：引用悬空。
  // 区别只在 DOM 有没有同时长出替代品。观察器知道哪些节点是新增的，拿它当
  // 候选范围，就不必靠选择器去猜——猜错会把改动贴到隔壁那个长得一样的元素上。
  // 「被换掉」和「被删掉」需要的证据不一样，所以要两个池子：
  //
  //   改绑（样式 / 评论）要**替换**的证据——新节点必须出现在「同一个父节点
  //   刚刚失去过子节点」的位置上。少了这一条，「删掉两行里的第一行」会被当成
  //   「第一行被换成了第二行」，改动就贴到隔壁去了。
  //
  //   删除重放要的是**重新出现**的证据——应用把元素渲染回来时并不会伴随任何
  //   删除，任何新增节点都得算候选。
  let pool = { appeared: new Set(), replaced: new Set() }
  let scanning = { appeared: new Set(), replaced: new Set() }

  const within = (set, el) => {
    for (const root of set)
      if (root === el || root.contains?.(el)) return true
    return false
  }
  const reappeared = el => within(scanning.appeared, el)
  const replacedIn = el => within(scanning.replaced, el)

  // 元素被换掉之前，用户到底改了什么。这一步必须赶在丢弃旧节点前做完：
  // 旧节点一旦释放，改动就无从得知了。
  const freezeEdits = snap => ({
    changes: diffSnapshot(snap, { detached: true }),
    text:    diffText(snap, { detached: true }),
    attrs:   diffAttrs(snap, { detached: true }),
  })

  const captureLive = snap => ({
    props:     readInline(snap.el),
    attrs:     readAttrs(snap.el),
    textNodes: snap.edited ? textNodesOf(snap.el).map(n => n.nodeValue) : null,
  })

  // 新节点是框架照自己的 state 渲出来的，身上没有我们写过的任何东西。
  // 光改绑只能救回记录、救不回画面，所以要把改动重新贴上去。
  const replayOnto = (el, live) => {
    for (const [prop, value] of Object.entries(live.props)) writeProp(el, prop, value)

    // 属性要逐个覆盖而不是只写有值的：用户把 srcset 清空过的话，
    // 只写有值的那些会让新节点带着自己的 srcset 把换的图盖回去
    for (const name of TRACKED_ATTRS) writeAttr(el, name, live.attrs[name] ?? '')

    if (live.textNodes) {
      const nodes = textNodesOf(el)
      if (nodes.length === live.textNodes.length)
        nodes.forEach((node, i) => { node.nodeValue = live.textNodes[i] })
    }
  }

  // 重贴会引发新的 DOM 变化，观察器不挡住就会自己触发自己
  let replaying = false
  // 应用如果坚持把元素渲染回来，我们就会反复删它。这是必然的拉锯，
  // 给个上限：超过就停手并标记，让用户看见「在跟页面打架」，
  // 而不是页面闪成一团、CPU 跑满。
  const REPLAY_BUDGET = 30

  const overBudget = rec => {
    rec.replays = (rec.replays || 0) + 1
    if (rec.replays <= REPLAY_BUDGET) return false
    rec.fighting = true
    return true
  }

  // 身份对不上就不是同一个东西。这一关拦的是「隔壁那个刚好挪到了这个位置」，
  // 选择器里的 nth-of-type 分辨不出这种情况。
  const sameIdentity = (el, rec) => identityOf(el) === identityOfRecord(rec)

  const rebindSnapshot = (snap, taken) => {
    const wasOrphan = !!snap.orphaned
    const live = captureLive(snap)

    // 先冻结再尝试找回。无论后面走哪条失败分支，改动都已经留住了——
    // 直接丢掉的话记录数会莫名往下掉，而用户会以为是自己没保存。
    snap.frozen = freezeEdits(snap)
    snap.orphaned = true

    const { el } = resolveElement(snap, { exclude: taken })
    // 返回 !wasOrphan：这一轮刚变成失联也是一次状态变化，要通知 UI 去标灰
    if (!el || !replacedIn(el) || !sameIdentity(el, snap)) return !wasOrphan
    if (overBudget(snap)) return !wasOrphan

    adoptId(el, snap.id)                       // 过继 id，免得同一元素冒出两条记录
    const fresh = takeSnapshot(el)
    Object.assign(snap, fresh, { id: snap.id, edited: snap.edited })
    snap.frozen = null
    snap.orphaned = false
    replayOnto(el, live)
    taken.add(el)
    return true
  }

  const rebindComment = (c, taken) => {
    const wasOrphan = !!c.orphaned
    const { el } = resolveElement(c, { exclude: taken })
    if (!el || !replacedIn(el) || !sameIdentity(el, c)) {
      c.orphaned = true
      return !wasOrphan
    }

    c.el = el
    c.anchors = collectAnchors(el)
    c.orphaned = false
    taken.add(el)
    return true
  }

  // 删除记录反过来：元素本就该不在 DOM 上。应用把它渲染回来了，
  // 就再删一次，并把父节点与后邻更新到新位置——否则「放回」会插错地方。
  //
  // 这里只认身份、不认位置。选择器里带 nth-of-type，而删除本身会让后面的
  // 兄弟节点整体前移一位——照选择器匹配的话，删掉一个之后下一个正好顶上来，
  // 于是被连着删掉，一路级联。
  const reapplyRemoval = (rec, taken) => {
    const { el } = resolveElement(rec)
    if (!el || el === rec.el || !reappeared(el) || !sameIdentity(el, rec)) return false
    if (overBudget(rec)) return false

    rec.el = el
    rec.parent = el.parentElement
    rec.nextSibling = el.nextElementSibling
    rec.anchors = collectAnchors(el)
    el.remove()
    return true
  }

  const reconcile = () => {
    if (replaying) return 0
    replaying = true
    let changed = 0
    scanning = pool
    pool = { appeared: new Set(), replaced: new Set() }

    try {
      const canRebind = scanning.replaced.size > 0

      // 删除先跑：被删的元素同时也有一条样式快照（removeElements 会 track 它），
      // 快照要是先把重新出现的节点认领走，删除重放就找不到目标了。
      //
      // 不做失败退避：应用可能在下一帧就把元素渲染回来，退避会正好错过它。
      // 成本本来就有两道闸——观察器只在有增删时才排一轮，rAF 又把一帧内的
      // 多次变动合并成一次。
      if (scanning.appeared.size)
        for (const rec of removals.values()) {
          if (rec.fighting) continue
          if (reapplyRemoval(rec)) changed++
        }

      const takenSnaps = claimedBy(snapshots)
      for (const snap of snapshots.values()) {
        // 这个元素是被我们删掉的，它的快照不该再去页面上找替代品
        if (removals.has(snap.id)) continue
        if (snap.el.isConnected || snap.fighting) continue
        // 已经标成失联、这一轮又没冒出任何替代品，就没什么可试的
        if (snap.orphaned && !canRebind) continue
        if (rebindSnapshot(snap, takenSnaps)) changed++
      }

      const takenComments = claimedBy(comments)
      for (const c of comments.values()) {
        if (c.el.isConnected) continue
        if (c.orphaned && !canRebind) continue
        if (rebindComment(c, takenComments)) changed++
      }
    } finally {
      replaying = false
      scanning = { appeared: new Set(), replaced: new Set() }
    }

    if (changed) notify()
    return changed
  }

  // 观察器只看 childList：节点被整个换掉是这次要解决的情况，而框架重渲染
  // 同一个节点时并不会清掉我们写的 inline 属性（它只管自己声明过的那些）。
  // 加上属性监听会让开销高一个量级，收益却极小。
  let frame = null
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => { frame = null; reconcile() })
  }

  // 存引用才断得掉。早先是 `new MutationObserver(...).observe(...)` 一行写完，
  // 谁也拿不到它——用户点 × 关掉插件之后，它仍在观察整个 documentElement 的
  // subtree，React 每渲染一次就白跑一轮重锚。
  let domObserver = null

  const observe = () => {
    if (typeof MutationObserver === 'undefined' || !document.documentElement) return
    if (domObserver) return   // 幂等：重新挂载时不叠第二个
    domObserver = new MutationObserver(records => {
      if (replaying) return

      // 先记下哪些父节点在这一批里失去过子节点，同一批里加到这些父节点下的
      // 新节点才算「替换」。React 提交时的 removeChild / insertBefore 是两条
      // 记录、同一个父节点，正好落在这个判定里。
      const lostChildren = new Set()
      for (const rec of records)
        if (rec.removedNodes.length) lostChildren.add(rec.target)

      for (const rec of records)
        for (const node of rec.addedNodes) {
          if (node.nodeType !== 1) continue
          pool.appeared.add(node)
          if (lostChildren.has(rec.target)) pool.replaced.add(node)
        }

      // 有新增才可能找回，有删除才需要把改动冻结下来，两者都没有就无事可做。
      // 早先只在「有新增」时排一轮，结果元素被单纯删掉的那一批里没有新增，
      // reconcile 压根不跑，记录直接从 isConnected 过滤里掉了——又成了静默丢弃。
      if (!pool.appeared.size && !lostChildren.size) return
      schedule()
    })
    domObserver.observe(document.documentElement, { childList: true, subtree: true })
  }

  const unobserve = () => {
    domObserver?.disconnect()
    domObserver = null
    // 已经排上队的那一轮也要撤，否则断开后还会再跑一次
    if (frame) { cancelAnimationFrame(frame); frame = null }
    pool = { appeared: new Set(), replaced: new Set() }
  }

  observe()

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
    refreeze(snap)
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
    refreeze(snap)
    notify()
  }

  // 失联记录展示的是 frozen 里的快照，不是实时 diff。任何「还原」动作之后
  // 都得重算一次，否则页面已经还原了，列表里那一行还杵着。
  const refreeze = snap => {
    if (!snap.orphaned) return
    const next = freezeEdits(snap)
    snap.frozen = next
    if (!next.changes.length && !next.text && !next.attrs.length) {
      snap.frozen = null
      snap.orphaned = false
    }
  }

  const undoProp = (id, prop) => {
    const snap = snapshots.get(id)
    if (!snap) return

    const before = snap.el.style.getPropertyValue(prop)
    revertProp(snap, prop)
    const after = snap.el.style.getPropertyValue(prop)

    if (before !== after)
      history.push({ kind: 'prop', el: snap.el, prop, before, after }, `还原 ${prop}`)
    refreeze(snap)
    notify()
  }

  const undoElement = id => {
    const snap = snapshots.get(id)
    if (!snap) return

    const before = captureElement(snap.el)
    revertAll(snap)
    history.push({ kind: 'element', el: snap.el, before, after: captureElement(snap.el) }, '还原元素')
    refreeze(snap)
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

    // 失联记录的改动是「冻结」在 frozen 里的，不跟着 DOM 走。不显式清掉的话，
    // 页面已经还原了，列表里那一堆「元素已消失」却还杵着——点了重置等于没重置。
    for (const snap of snapshots.values()) {
      snap.frozen = null
      snap.orphaned = false
    }

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
    read, stats, touch, reconcile, observe, unobserve,
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
