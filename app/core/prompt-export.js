import { PROP_GROUP, GROUPS, sameValue } from './tracked-props.js'
import { textLandmarks } from './anchors.js'

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

// 编辑器自身的 UI 不算页面结构的一部分
const isOwnUI = el =>
  el.hasAttribute?.('data-visual-revise-ui') || /^(VIS-BUG|VISBUG-)/.test(el.tagName || '')

const orderOf = el => {
  const raw = parseInt(el.style?.order, 10)
  return Number.isFinite(raw) ? raw : 0
}

// 重排产生的是一组 order 数值，但用户的意图是「换个顺序」。
// 把这组数值还原成顺序本身：AI 拿到顺序才能去调数组或 JSX，
// 拿到 order 数值只会照搬成 CSS——那是下策，见段落末尾的说明。
const collectReorders = edits => {
  const containers = new Map()

  for (const entry of edits) {
    if (!entry.changes.some(c => c.prop === 'order')) continue

    const parent = entry.el?.parentElement
    if (!parent || containers.has(parent)) continue

    const siblings = Array.from(parent.children).filter(el => !isOwnUI(el))
    if (siblings.length < 2) continue

    containers.set(parent, {
      parent,
      before: siblings,
      after: siblings.slice().sort((a, b) => orderOf(a) - orderOf(b)),
    })
  }

  return Array.from(containers.values())
    .filter(g => g.before.some((el, i) => el !== g.after[i]))   // 顺序确实变了
}

// 取第一条独立的短文本，而不是把整棵子树拼起来——
// 后者既难读，也无法用来在源码里检索
const textOf = el => textLandmarks(el, 1)[0] || ''

const nameOf = el => {
  const text = textOf(el)
  if (text) return `「${text}」`

  const cls = Array.from(el.classList || []).filter(c => !/^(_|css-)/.test(c))[0]
  return cls ? `${el.tagName.toLowerCase()}.${cls}` : `<${el.tagName.toLowerCase()}>`
}

const containerSelector = el => {
  const tag = el.tagName.toLowerCase()
  const cls = Array.from(el.classList || []).filter(c => !/^(_|css-)/.test(c))
  return cls.length ? `${tag}.${cls[0]}` : tag
}

const reorderSection = groups => {
  if (!groups.length) return ''

  const blocks = groups.map(({ parent, before, after }) => [
    `**容器**：\`${containerSelector(parent)}\``,
    '',
    '调整后的顺序（从前到后）：',
    '',
    ...after.map((el, i) => `${i + 1}. ${nameOf(el)}`),
    '',
    `原顺序：${before.map(nameOf).join(' → ')}`,
  ].join('\n'))

  return [
    '---',
    '',
    '## 元素重新排序',
    '',
    blocks.join('\n\n'),
    '',
    '> 请直接调整源码中元素或数据的顺序（数组顺序、JSX 中的书写顺序等）。',
    '> 不建议改用 CSS `order` 实现：它只改变视觉顺序，DOM 顺序不变，',
    '> 会让键盘 Tab 顺序与读屏顺序和用户看到的不一致。',
    '',
  ].join('\n')
}

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

  const reorders = collectReorders(edits)

  // order 已经由「元素重新排序」段落表达，不再重复列进属性表。
  // 必须先于下面的 summary 定义——它要统计 styleEdits 的数量。
  const styleEdits = edits
    .map(entry => ({ ...entry, changes: entry.changes.filter(c => c.prop !== 'order') }))
    .filter(entry => entry.changes.length)

  const url      = meta.url      || (typeof location !== 'undefined' ? location.href : '')
  const viewport = meta.viewport || (typeof innerWidth !== 'undefined' ? `${innerWidth} × ${innerHeight}` : '')

  const head = ['# 页面视觉修改需求', '']
  if (url)      head.push(`来源：${url}`)
  if (viewport) head.push(`视口：${viewport}`)

  const summary = []
  if (styleEdits.length) summary.push(`${styleEdits.length} 处元素样式`)
  if (reorders.length)   summary.push(`${reorders.length} 处顺序调整`)
  if (comments.length)   summary.push(`${comments.length} 条交互备注`)
  head.push(`改动：${summary.join('，')}`, '')

  const sections = styleEdits.map((entry, i) => {
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

  const reorderBlock = reorderSection(reorders)

  const commentSection = comments.length ? [
    '---',
    '',
    '## 交互备注',
    '',
    '这些是 CSS 无法表达的行为需求，请实现对应的交互逻辑：',
    '',
    ...comments.map(c => {
      const idx = styleEdits.findIndex(e => e.el === c.el)
      const ref = idx >= 0 ? `（同上述第 ${idx + 1} 项）` : ''
      return `- **${describeElement(c.anchors)}**${ref}\n  - 选择器：\`${c.anchors.selector}\`\n  - 需求：${c.text}`
    }),
    '',
  ].join('\n') : ''

  return [head.join('\n'), ...sections, reorderBlock, commentSection, '---', '', FOOTER, '']
    .filter(Boolean).join('\n')
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
