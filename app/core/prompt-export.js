import { PROP_GROUP, GROUPS, sameValue } from './tracked-props.js'

const SIDES = ['top', 'right', 'bottom', 'left']

// padding-top/right/bottom/left 四条改动合并成一条 padding，
// 让提示词更接近人类写法，也更省 AI 的解析成本。
const collapseShorthand = changes => {
  const out = []
  const byProp = new Map(changes.map(c => [c.prop, c]))
  const consumed = new Set()

  for (const base of ['padding', 'margin']) {
    const parts = SIDES.map(side => byProp.get(`${base}-${side}`))
    if (!parts.every(Boolean)) continue

    const allSame = vals => vals.every(v => sameValue(v, vals[0]))
    const tos   = parts.map(p => p.to)
    const froms = parts.map(p => p.from)

    if (allSame(tos) && allSame(froms)) {
      out.push({ prop: base, from: froms[0], to: tos[0] })
      parts.forEach(p => consumed.add(p.prop))
    } else {
      out.push({
        prop: base,
        from: froms.join(' '),
        to:   tos.join(' '),
        note: '上 右 下 左',
      })
      parts.forEach(p => consumed.add(p.prop))
    }
  }

  changes.forEach(c => { if (!consumed.has(c.prop)) out.push(c) })
  return out
}

const groupLabels = changes => {
  const ids = [...new Set(changes.map(c => PROP_GROUP[c.prop] || 'appearance'))]
  return ids
    .map(id => GROUPS.find(g => g.id === id)?.label)
    .filter(Boolean)
    .join('、')
}

const describeElement = anchors => {
  const text = anchors.text?.[0]
  if (text) return `「${text}」`

  const cls = anchors.classes?.[0]
  if (cls) return `${anchors.tag}.${cls}`

  return `<${anchors.tag}>`
}

const tagLine = anchors => {
  const cls = anchors.classes?.length ? ` class="${anchors.classes.join(' ')}"` : ''
  const id  = anchors.id ? ` id="${anchors.id}"` : ''
  return `<${anchors.tag}${id}${cls}>`
}

const anchorBlock = anchors => {
  const lines = [`- 选择器：\`${anchors.selector}\``, `- 标签：\`${tagLine(anchors)}\``]

  if (anchors.text?.length)
    lines.push(`- 文本特征：${anchors.text.map(t => `\`"${t}"\``).join(' ')}`)

  if (anchors.domPath)
    lines.push(`- DOM 路径：\`${anchors.domPath}\``)

  if (anchors.position)
    lines.push(`- 位置：${anchors.position}`)

  const attrs = Object.entries(anchors.attrs || {})
  if (attrs.length)
    lines.push(`- 属性：${attrs.map(([k, v]) => `\`${k}="${v}"\``).join(' ')}`)

  return lines.join('\n')
}

const changeTable = changes => [
  '| 属性 | 原值 | 新值 |',
  '|---|---|---|',
  ...changes.map(c =>
    `| ${c.prop}${c.note ? ` <sub>${c.note}</sub>` : ''} | \`${c.from || '—'}\` | \`${c.to}\` |`),
].join('\n')

const FOOTER = `## 给 AI 的说明

以上改动是在浏览器中可视化调整后导出的，数值为实测有效值。
请在源码中找到对应元素并应用这些改动。

定位建议：**优先用「文本特征」在代码库中搜索**——选择器里的类名在源码中
可能不存在（Tailwind、CSS Modules、CSS-in-JS 都会改写类名），而文本内容通常
能直接命中组件文件。

应用建议：若项目使用设计 token、CSS 变量或工具类，请换算为项目现有的表达方式，
不要直接写死像素值破坏既有设计系统。若某项改动与项目规范冲突，请指出并说明原因，
不要静默忽略。`

export const buildPrompt = (state, meta = {}) => {
  const { edits = [], comments = [] } = state
  if (!edits.length && !comments.length) return ''

  const url      = meta.url      || (typeof location !== 'undefined' ? location.href : '')
  const viewport = meta.viewport || (typeof innerWidth !== 'undefined' ? `${innerWidth} × ${innerHeight}` : '')

  const head = ['# 页面视觉修改需求', '']
  if (url)      head.push(`来源：${url}`)
  if (viewport) head.push(`视口：${viewport}`)

  const summary = []
  if (edits.length)    summary.push(`${edits.length} 处元素`)
  if (comments.length) summary.push(`${comments.length} 条交互备注`)
  head.push(`改动：${summary.join('，')}`, '')

  const sections = edits.map((entry, i) => {
    const changes = collapseShorthand(entry.changes)
    return [
      '---',
      '',
      `## ${i + 1}. ${describeElement(entry.anchors)} — ${groupLabels(changes)}`,
      '',
      '**定位**',
      '',
      anchorBlock(entry.anchors),
      '',
      '**改动**',
      '',
      changeTable(changes),
      '',
    ].join('\n')
  })

  const commentSection = comments.length ? [
    '---',
    '',
    '## 交互备注',
    '',
    '这些是 CSS 无法表达的行为需求，请实现对应的交互逻辑：',
    '',
    ...comments.map(c => {
      const idx = edits.findIndex(e => e.el === c.el)
      const ref = idx >= 0 ? `（同上述第 ${idx + 1} 项）` : ''
      return `- **${describeElement(c.anchors)}**${ref}\n  - 选择器：\`${c.anchors.selector}\`\n  - 需求：${c.text}`
    }),
    '',
  ].join('\n') : ''

  return [head.join('\n'), ...sections, commentSection, '---', '', FOOTER, ''].filter(Boolean).join('\n')
}

export const copyPrompt = async (state, meta) => {
  const text = buildPrompt(state, meta)
  if (!text) return { ok: false, reason: 'empty' }

  try {
    await navigator.clipboard.writeText(text)
    return { ok: true, text }
  } catch (err) {
    // 剪贴板 API 在部分页面受限时退回 execCommand
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok ? { ok: true, text } : { ok: false, reason: err.message, text }
    } catch (e2) {
      return { ok: false, reason: e2.message, text }
    }
  }
}
