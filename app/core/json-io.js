import { ChangeStore } from './change-store.js'
import { textLandmarks } from './anchors.js'

export const SCHEMA_VERSION = 1

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
    })),
    comments: comments.map(c => ({
      seq:      c.seq,
      selector: c.anchors.selector,
      anchors:  c.anchors,
      text:     c.text,
    })),
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

// 选择器在另一台机器 / 另一次构建后可能失效（类名被重新哈希），
// 因此按 选择器 → 文本特征 → DOM 路径 的顺序逐级回退。
const resolveElement = record => {
  const { selector, anchors } = record

  try {
    const direct = document.querySelector(selector)
    if (direct) return { el: direct, via: 'selector' }
  } catch { /* 选择器语法在目标页面无效时忽略 */ }

  const wanted = anchors?.text?.[0]
  if (wanted) {
    const tag = anchors.tag || '*'
    const byText = Array.from(document.querySelectorAll(tag))
      .find(el => textLandmarks(el, 1)[0] === wanted)
    if (byText) return { el: byText, via: 'text' }
  }

  if (anchors?.domPath) {
    const last = anchors.domPath.split(' > ').pop()
    const byPath = document.querySelector(last)
    if (byPath) return { el: byPath, via: 'path' }
  }

  return { el: null, via: null }
}

export const importJSON = (data, { apply = true } = {}) => {
  if (!data || data.schema !== SCHEMA_VERSION)
    return { ok: false, reason: `不支持的文件格式（schema=${data?.schema}）` }

  const report = { ok: true, matched: [], missing: [], comments: 0, viaText: 0 }

  for (const record of data.edits || []) {
    const { el, via } = resolveElement(record)

    if (!el) { report.missing.push(record.selector); continue }
    if (via === 'text') report.viaText++

    ChangeStore.track(el)
    if (apply)
      record.changes.forEach(c => ChangeStore.applyProp(el, c.prop, c.to))

    report.matched.push({ selector: record.selector, via, count: record.changes.length })
  }

  for (const record of data.comments || []) {
    const { el } = resolveElement(record)
    if (!el) { report.missing.push(record.selector); continue }
    ChangeStore.addComment(el, record.text)
    report.comments++
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
