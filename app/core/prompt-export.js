import { PROP_GROUP, GROUPS, sameValue } from './tracked-props.js'
import { textLandmarks } from './anchors.js'
import { ChangeStore } from './change-store.js'
import { saveRefImages } from './ref-images.js'
import { parseCssUrl, fileNameOf } from './image-source.js'

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

// 面板里的分区标题沿用 Figma 的英文命名，导出的提示词是中文文档，
// 所以这里取分区的中文名（GROUPS[].zh）而不是面板上的 label
const groupLabels = changes => {
  const ids = [...new Set(changes.map(c => PROP_GROUP[c.prop] || 'appearance'))]
  return ids
    .map(id => {
      const g = GROUPS.find(x => x.id === id)
      return g && (g.zh || g.label)
    })
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

// 图片元素的定位补一行原图地址：光有选择器和标签，AI 无从判断改的是哪张图
const imageLine = entry => {
  const original = (entry.attrs || []).find(a => a.attr === 'src' || a.attr === 'poster')
  if (original?.from) return `- 原图地址：\`${original.from}\``

  const bg = (entry.changes || []).find(c => c.prop === 'background-image')
  if (bg?.from && bg.from !== 'none') {
    const url = parseCssUrl(bg.from)
    if (url) return `- 原背景图：\`${url}\`（${fileNameOf(url)}）`
  }
  return ''
}

const changeTable = (changes, refs) => [
  '| 属性 | 原值 | 新值 |',
  '|---|---|---|',
  ...changes.map(c =>
    `| ${c.prop}${c.note ? ` <sub>${c.note}</sub>` : ''} `
    + `| \`${displayValue(c.from, refs)}\` | \`${displayValue(c.to, refs)}\` |`),
].join('\n')

// 文案改动单独成段：它要改的是源码里的字符串或文案数据，
// 和 CSS 属性表不是一类东西，混在同一张表里 AI 容易照着写成 content 之类的样式
const textBlock = ({ from, to }) => [
  '**文案改动**',
  '',
  `- 原文：\`${from || '（空）'}\``,
  `- 改为：\`${to || '（空）'}\``,
  '',
  '> 请改源码里的文案本身（JSX 文本、模板、i18n 词条或数据源），',
  '> 不要用 CSS 的 content 之类的手段覆盖显示结果。',
  '',
]

// ── 图片引用 ────────────────────────────────────────────────
// 用户换上去的图在页面里是一段 data URI。直接写进提示词有两个问题：一是几十万
// 字符没法粘贴，二是 AI 也读不了提示词里的 data URI。所以导出前把这些图落到
// 磁盘，提示词里只写**绝对路径**，让 AI 自己去读图。
//
// refs 是落盘结果：{ exact, dir, files: [{ id, name, path }] }。
// exact=false 意味着路径是按默认下载目录推测的——必须如实标注，否则 AI 会
// 拿着一个看似确切、实则不存在的路径去读图，然后报错或者干脆瞎编。

const isDataUrl = v => /^data:/i.test(String(v || '').trim())

// 值可能是裸 URL（src 属性），也可能是 url("...")（background-image）
const urlOf = value => {
  const v = String(value || '').trim()
  return parseCssUrl(v) || v
}

const findRef = (value, refs) => {
  const url = urlOf(value)
  if (!isDataUrl(url)) return null

  const asset = ChangeStore.assetForUrl?.(url)
  if (!asset) return null

  const file = refs?.files?.find(f => f.id === asset.id)
  return {
    asset,
    path:  file?.path || '',
    exact: !!file?.path && refs?.exact !== false,
  }
}

// 属性表 / 文案里出现 data URI 时，替换成人能读、AI 能用的表述
const displayValue = (value, refs) => {
  const url = urlOf(value)
  if (!isDataUrl(url)) return value || '—'

  const ref = findRef(value, refs)
  if (!ref) return '（内嵌图片）'
  return ref.path
    ? `${ref.path}${ref.exact ? '' : '（路径为推测）'}`
    : `（内嵌图片 ${ref.asset.name}，落盘失败）`
}

const ATTR_LABEL = { src: '图片', srcset: '响应式图片候选', poster: '视频封面' }

// 换图单独成段：它改的是源码里的资源引用，和 CSS 属性表不是一类东西。
// 混进属性表会让 AI 照着写成 CSS，而正确做法是替换 import / src / 静态资源。
const attrBlock = (attrs, refs) => {
  const lines = ['**图片替换**', '']

  for (const { attr, from, to } of attrs) {
    const label = ATTR_LABEL[attr] || attr

    // srcset 被清空是换图的连带动作，不是用户的意图，单独说明免得 AI 当成需求
    if (attr === 'srcset' && !to) {
      lines.push(`- 原有 \`srcset\` 已清除（换图的连带动作：srcset 优先级高于 src，`
        + `留着它新图不会显示。源码里如果有响应式图片集，请一并替换而不是删掉）`, '')
      continue
    }

    const ref = findRef(to, refs)
    lines.push(`- ${label}（\`${attr}\`）`)
    lines.push(`  - 原值：\`${from || '（空）'}\``)

    if (ref?.path) {
      lines.push(`  - 换成：\`${ref.path}\`${ref.exact ? '' : '  ← 路径为推测，若打不开请在下载目录中查找'}`)
      lines.push(`  - 该文件已存在于本机，请用读图工具打开确认内容后，`
        + `把它放进项目的静态资源目录并更新引用`)
    } else if (isDataUrl(urlOf(to))) {
      lines.push(`  - 换成：用户提供的本地图片（${ref?.asset?.name || '未命名'}），但落盘失败，`
        + `请向用户索取该文件`)
    } else {
      lines.push(`  - 换成：\`${to || '（空）'}\``)
    }
    lines.push('')
  }

  return lines
}

// 提示词里要写绝对路径，前提是这些图先落到磁盘。这里收集哪些图需要落盘：
// 换图写进 src / background-image 的，以及评论上挂的参考图。
export const collectRefAssets = state => {
  const seen = new Set()
  const out = []

  const take = value => {
    const url = urlOf(value)
    if (!isDataUrl(url)) return
    const asset = ChangeStore.assetForUrl?.(url)
    if (!asset || seen.has(asset.id)) return
    seen.add(asset.id)
    out.push(asset)
  }

  for (const entry of state.edits || []) {
    for (const a of entry.attrs || []) take(a.to)
    for (const c of entry.changes || []) take(c.to)
  }

  for (const comment of state.comments || []) {
    for (const img of comment.images || []) {
      if (img?.id && !seen.has(img.id)) { seen.add(img.id); out.push(img) }
    }
  }

  return out
}

// 落盘清单单独列一段：AI 需要一眼看到「有哪些图可以读」，
// 而不是从散落在各处的表格里把路径捡出来。
const refSection = refs => {
  if (!refs?.files?.length) return ''

  const exact = refs.exact !== false
  return [
    '---',
    '',
    '## 参考图文件',
    '',
    exact
      ? '以下文件已保存在本机，请用读图工具直接打开查看：'
      : '以下文件已下载到本机，但**路径是按默认下载目录推测的**，'
        + '若打不开请在下载目录里按文件名查找：',
    '',
    ...refs.files.map(f =>
      f.path
        ? `- \`${f.path}\``
        : `- ${f.name}（落盘失败${f.error ? '：' + f.error : ''}，请向用户索取）`),
    '',
  ].join('\n')
}

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
能直接命中组件文件。文案改动请拿「原文」去搜，页面上显示的已经是改后的内容。

读图建议：若上面出现了本机文件路径，请用读图工具打开确认内容，不要仅凭文件名
推测图片内容。图片要放进项目的静态资源目录并更新引用，不要把 data URI 写进源码。

应用建议：若项目使用设计 token、CSS 变量或工具类，请换算为项目现有的表达方式，
不要直接写死像素值破坏既有设计系统。若某项改动与项目规范冲突，请指出并说明原因，
不要静默忽略。`

export const buildPrompt = (state, meta = {}, refs = null) => {
  const { edits = [], comments = [] } = state
  if (!edits.length && !comments.length) return ''

  const reorders = collectReorders(edits)

  // order 已经由「元素重新排序」段落表达，不再重复列进属性表。
  // 必须先于下面的 summary 定义——它要统计 styleEdits 的数量。
  // 只改了文案、没动样式的元素同样要留下（entry.text）。
  const styleEdits = edits
    .map(entry => ({ ...entry, changes: entry.changes.filter(c => c.prop !== 'order') }))
    .filter(entry => entry.changes.length || entry.text || entry.attrs?.length)

  const url      = meta.url      || (typeof location !== 'undefined' ? location.href : '')
  const viewport = meta.viewport || (typeof innerWidth !== 'undefined' ? `${innerWidth} × ${innerHeight}` : '')

  const head = ['# 页面视觉修改需求', '']
  if (url)      head.push(`来源：${url}`)
  if (viewport) head.push(`视口：${viewport}`)

  // 一条记录可能只有文案、只有样式，或两者都有，所以分开数
  const textCount  = styleEdits.filter(e => e.text).length
  const styleCount = styleEdits.filter(e => e.changes.length).length
  const imageCount = styleEdits.filter(e => e.attrs?.length).length

  const summary = []
  if (styleCount) summary.push(`${styleCount} 处元素样式`)
  if (textCount)  summary.push(`${textCount} 处文案`)
  if (imageCount) summary.push(`${imageCount} 处图片替换`)
  if (reorders.length)   summary.push(`${reorders.length} 处顺序调整`)
  if (comments.length)   summary.push(`${comments.length} 条交互备注`)
  head.push(`改动：${summary.join('，')}`, '')

  const sections = styleEdits.map((entry, i) => {
    const changes = collapseShorthand(entry.changes)
    const attrs = entry.attrs || []
    const kinds = [
      entry.text && '文案',
      attrs.length && '图片',
      changes.length && groupLabels(changes),
    ].filter(Boolean)

    return [
      '---',
      '',
      `## ${i + 1}. ${describeElement(entry.anchors)} — ${kinds.join('、')}`,
      '',
      '**定位**',
      '',
      anchorBlock(entry.anchors),
      ...(imageLine(entry) ? [imageLine(entry)] : []),
      '',
      ...(entry.text ? textBlock(entry.text) : []),
      ...(attrs.length ? attrBlock(attrs, refs) : []),
      ...(changes.length ? ['**样式改动**', '', changeTable(changes, refs), ''] : []),
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

  // 结尾的分隔线和 FOOTER 要拼成一段：filter(Boolean) 会把中间那个空行滤掉，
  // 让 --- 和下一个标题贴在一起
  return [head.join('\n'), ...sections, reorderBlock, commentSection, refSection(refs),
    `---\n\n${FOOTER}\n`]
    .filter(Boolean).join('\n')
}

export const copyPrompt = async (state, meta) => {
  const { edits = [], comments = [] } = state || {}
  if (!edits.length && !comments.length) return { ok: false, reason: 'empty' }

  // 落盘要在生成提示词之前：正文里写的就是落盘后的绝对路径。
  // 落盘失败不阻断复制——提示词照出，只是把图标注成「请向用户索取」。
  const assets = collectRefAssets(state)
  const refs = assets.length ? await saveRefImages(assets) : null

  const text = buildPrompt(state, meta, refs)
  if (!text) return { ok: false, reason: 'empty' }

  try {
    await navigator.clipboard.writeText(text)
    return { ok: true, text, refs }
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
      return ok ? { ok: true, text, refs } : { ok: false, reason: err.message, text, refs }
    } catch (e2) {
      return { ok: false, reason: e2.message, text }
    }
  }
}
