/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { ChangeStore } from './change-store.js'
import { resolveElement } from './anchors.js'

// v2 起带上图片：换图的属性改动与图片资产本身（base64 内嵌）。
// 内嵌而不是只存文件名，是因为这份 JSON 的用途就是交给别人导入——
// 图丢了，换图那条记录也就没意义了。
// v3 起带上移动：重排从写 CSS order 换成了真的搬 DOM 节点。
export const SCHEMA_VERSION = 3

// 老版本导出的文件缺字段也能正常导入，所以照收
const SUPPORTED = new Set([1, 2, 3])

export const exportJSON = (meta = {}) => {
  const { edits, comments, removals, moves } = ChangeStore.read()

  return {
    schema:     SCHEMA_VERSION,
    tool:       'visual-revise',
    url:        meta.url ?? location.href,
    viewport:   meta.viewport ?? `${innerWidth} × ${innerHeight}`,
    exportedAt: new Date().toISOString(),
    edits: edits.map(e => ({
      selector: e.anchors.selector,
      anchors:  e.anchors,
      changes:  e.changes,
      attrs:    e.attrs || [],
    })),
    comments: comments.map(c => ({
      seq:      c.seq,
      selector: c.anchors.selector,
      anchors:  c.anchors,
      text:     c.text,
      images:   (c.images || []).map(i => i.id),
    })),
    // 移动存三方锚点：元素自己、原容器与后邻、新容器与后邻。
    // 主锚点用移动**之前**那一份——导入方页面上的元素还在原位，
    // 拿移动后的选择器去找必然落空。
    moves: moves.map(m => ({
      seq:      m.seq,
      selector: (m.fromAnchors || m.anchors).selector,
      anchors:  m.fromAnchors || m.anchors,
      tag:      m.tag,
      text:     m.text,
      from: { anchors: m.fromParentAnchors, next: m.fromNextAnchors, atEnd: m.fromAtEnd },
      to:   { anchors: m.toParentAnchors,   next: m.toNextAnchors,   atEnd: m.toAtEnd },
    })),
    // 删除只存定位信息：DOM 节点本身带不走，导入方要按锚点重新找到它再删
    removals: removals.map(r => ({
      seq:      r.seq,
      selector: r.anchors.selector,
      anchors:  r.anchors,
      tag:      r.tag,
      text:     r.text,
    })),
    // 图片只存一份，改动与评论都按 id 引用它
    assets: ChangeStore.allAssets(),
  }
}

export const estimateBytes = data => {
  try {
    return new Blob([JSON.stringify(data)]).size
  } catch {
    return JSON.stringify(data).length
  }
}

export const downloadJSON = (meta) => {
  const data = exportJSON(meta)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = data.exportedAt.slice(0, 19).replace(/[:T]/g, '-')

  a.href = url
  a.download = `visual-revise-${stamp}.json`
  a.click()

  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return data
}

export const importJSON = (data, { apply = true } = {}) => {
  if (!data || !SUPPORTED.has(data.schema))
    return { ok: false, reason: `不支持的文件格式（schema=${data?.schema}）` }

  const report = {
    ok: true, matched: [], missing: [], failed: [],
    comments: 0, viaText: 0, images: 0, attrs: 0, removals: 0, moves: 0,
  }

  // 资产要先入库：后面的换图记录与评论都按 id 引用它们
  const assetById = new Map()
  for (const asset of data.assets || []) {
    if (!asset?.id) continue
    ChangeStore.addAsset(asset)
    assetById.set(asset.id, asset)
    report.images++
  }

  // 单条记录出问题不应连累其余：逐条隔离，失败的计入 failed 并继续
  report.failed = []

  for (const record of data.edits || []) {
    try {
      const { el, via } = resolveElement(record)

      if (!el) { report.missing.push(record.selector); continue }
      if (via === 'text') report.viaText++

      ChangeStore.track(el)
      if (apply) {
        record.changes.forEach(c => ChangeStore.applyProp(el, c.prop, c.to))
        // 属性改动要在样式之后应用：换图会连带清 srcset，
        // 顺序颠倒的话清空动作会被原值覆盖回去
        ;(record.attrs || []).forEach(a => {
          ChangeStore.applyAttr(el, a.attr, a.to)
          report.attrs++
        })
      }

      report.matched.push({
        selector: record.selector, via,
        count: record.changes.length + (record.attrs?.length || 0),
      })
    } catch (err) {
      report.failed.push({ selector: record.selector, reason: err?.message || String(err) })
    }
  }

  // 移动排在删除之前：先把元素搬到位，再删该删的。
  // 反过来的话，被搬进某个已删容器的元素就再也放不进去了。
  for (const record of data.moves || []) {
    try {
      const { el } = resolveElement(record)
      if (!el) { report.missing.push(record.selector); continue }

      const parent = record.to?.anchors ? resolveElement({ anchors: record.to.anchors }).el : null
      if (!parent) { report.missing.push(record.to?.anchors?.selector || record.selector); continue }

      // atEnd 时本来就没有后邻。不看这个标志的话，「放到末尾」和
      // 「后邻没找着」分不出来，只能一律 append——两者恰好同解，但换成
      // 中间位置就会静默落错地方。
      const next = record.to?.atEnd || !record.to?.next
        ? null
        : resolveElement({ anchors: record.to.next }).el

      if (apply) ChangeStore.moveElement(el, parent, next?.parentElement === parent ? next : null)
      report.moves++
    } catch (err) {
      report.failed.push({ selector: record.selector, reason: err?.message || String(err) })
    }
  }

  // 删除放在样式与移动之后、评论之前：先把该改的改完，再动结构。
  // 顺序反了的话，样式记录会去找一个已经被删掉的元素。
  for (const record of data.removals || []) {
    try {
      const { el } = resolveElement(record)
      if (!el) { report.missing.push(record.selector); continue }

      if (apply) {
        ChangeStore.recordRemoval([el])
        el.remove()
      }
      report.removals++
    } catch (err) {
      report.failed.push({ selector: record.selector, reason: err?.message || String(err) })
    }
  }

  for (const record of data.comments || []) {
    try {
      const { el } = resolveElement(record)
      if (!el) { report.missing.push(record.selector); continue }

      const id = ChangeStore.addComment(el, record.text)
      // 图按 id 引用；找不到的（导出方漏带 assets）就跳过，不让整条评论失败
      const images = (record.images || [])
        .map(imgId => assetById.get(imgId))
        .filter(Boolean)
      if (images.length) ChangeStore.setCommentImages?.(id, images)

      report.comments++
    } catch (err) {
      report.failed.push({ selector: record.selector, reason: err?.message || String(err) })
    }
  }

  return report
}

export const pickAndImport = () => new Promise(resolve => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'

  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return resolve({ ok: false, reason: '未选择文件' })

    try {
      resolve(importJSON(JSON.parse(await file.text())))
    } catch (err) {
      resolve({ ok: false, reason: `文件解析失败：${err.message}` })
    }
  }

  input.click()
})
