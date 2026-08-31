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
  if (!data || data.schema !== SCHEMA_VERSION)
    return { ok: false, reason: `不支持的文件格式（schema=${data?.schema}）` }

  const report = { ok: true, matched: [], missing: [], failed: [], comments: 0, viaText: 0 }

  // 单条记录出问题不应连累其余：逐条隔离，失败的计入 failed 并继续
  report.failed = []

  for (const record of data.edits || []) {
    try {
      const { el, via } = resolveElement(record)

      if (!el) { report.missing.push(record.selector); continue }
      if (via === 'text') report.viaText++

      ChangeStore.track(el)
      if (apply)
        record.changes.forEach(c => ChangeStore.applyProp(el, c.prop, c.to))

      report.matched.push({ selector: record.selector, via, count: record.changes.length })
    } catch (err) {
      report.failed.push({ selector: record.selector, reason: err?.message || String(err) })
    }
  }

  for (const record of data.comments || []) {
    try {
      const { el } = resolveElement(record)
      if (!el) { report.missing.push(record.selector); continue }
      ChangeStore.addComment(el, record.text)
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
