import { ChangeStore } from './change-store.js'
import { textLandmarks } from './anchors.js'

// v2 起带上图片：换图的属性改动与图片资产本身（base64 内嵌）。
// 内嵌而不是只存文件名，是因为这份 JSON 的用途就是交给别人导入——
// 图丢了，换图那条记录也就没意义了。
export const SCHEMA_VERSION = 2

// v1 没有 attrs / assets 字段，缺了也能正常导入，所以照收
const SUPPORTED = new Set([1, 2])

export const exportJSON = (meta = {}) => {
  const { edits, comments } = ChangeStore.read()

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

// 任何一次 querySelector 都可能因选择器语法非法而抛错：Tailwind 的类名
// 常含 CSS 保留字符（hover:bg-blue-500、w-1/2、top-[3px]）。一次抛错若
// 逸出，整个导入会中断，而前面已经应用的记录既不回滚也不上报。
const query = selector => {
  if (!selector) return null
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

const queryAll = selector => {
  if (!selector) return []
  try {
    return Array.from(document.querySelectorAll(selector))
  } catch {
    return []
  }
}

// 选择器在另一台机器 / 另一次构建后可能失效（类名被重新哈希），
// 因此按 选择器 → 文本特征 → DOM 路径 的顺序逐级回退。
const resolveElement = record => {
  const { selector, anchors } = record

  const direct = query(selector)
  if (direct) return { el: direct, via: 'selector' }

  const wanted = anchors?.text?.[0]
  if (wanted) {
    const tag = anchors.tag || '*'
    const byText = queryAll(tag).find(el => textLandmarks(el, 1)[0] === wanted)
    if (byText) return { el: byText, via: 'text' }
  }

  if (anchors?.domPath) {
    const byPath = query(anchors.domPath.split(' > ').pop())
    if (byPath) return { el: byPath, via: 'path' }
  }

  return { el: null, via: null }
}

export const importJSON = (data, { apply = true } = {}) => {
  if (!data || !SUPPORTED.has(data.schema))
    return { ok: false, reason: `不支持的文件格式（schema=${data?.schema}）` }

  const report = {
    ok: true, matched: [], missing: [], failed: [],
    comments: 0, viaText: 0, images: 0, attrs: 0,
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
