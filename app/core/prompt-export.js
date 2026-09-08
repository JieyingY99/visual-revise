/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { PROP_GROUP, GROUPS, sameValue } from './tracked-props.js'
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
    // 只要有一条带 important 就逐条输出：折叠成简写就得把 !important 拼进值里，
    // `padding: 4px !important 8px !important …` 是一条非法声明
    if (parts.some(p => p.important)) continue

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
  // important 在这里才拼回值里：AI 拿到的要是一条能直接抄进样式表的声明，
  // 而记录和 JSON 里它一直是独立字段（拼进字符串会毁掉简写折叠与导入）
  ...changes.map(c =>
    `| ${c.prop}${c.note ? ` <sub>${c.note}</sub>` : ''} `
    + `| \`${displayValue(c.from, refs)}\` `
    + `| \`${displayValue(c.to, refs)}${c.important ? ' !important' : ''}\` |`),
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

// 删除单独成段：它改的是源码结构，和调样式、换文案都不是一类操作。
// 混进属性表 AI 会照着写成 display:none —— 那是藏起来，不是删掉。
// 一次替换（⌘⇧R）落成「新增 + 删除」一对记录，新增那条带 replaced 指回旧元素。
// 认亲用两把钥匙：本会话内用元素编号（id）精确对上；从 JSON 导入的记录换了一个
// 页面、编号早已不同，只剩 identity（标签 + 稳定类名 + 首条文本）可以对。
const replacedKeysOf = inserts =>
  new Set((inserts || []).flatMap(r => [r.replaced?.id, r.replaced?.identity]).filter(Boolean))

const isReplaced = (removal, keys) =>
  keys.has(removal.id) || (!!removal.identity && keys.has(removal.identity))

// 被替换掉的元素仍然留在「删除的元素」这一段，因为 AI 要在源码里找到并删掉的
// 就是它，锚点只有这里有；但必须点明是替换，否则读起来像「又加了一个又删了
// 一个」两件独立的事。
const removalSection = (removals, replacedKeys = new Set()) => {
  if (!removals.length) return ''

  const blocks = removals.map((r, i) => [
    `### ${i + 1}. ${describeElement(r.anchors)}`,
    '',
    isReplaced(r, replacedKeys)
      ? '- 这是一次**替换**：它被「新增的元素」里对应的那一项取代了，删掉它的同时要把新的写在原位'
      : '',
    anchorBlock(r.anchors),
    r.childCount ? `- 含 ${r.childCount} 个子元素，是整块一起删掉的` : '',
    '',
  ].filter(Boolean).join('\n'))

  return [
    '---',
    '',
    '## 删除的元素',
    '',
    '以下元素已从页面上移除：',
    '',
    blocks.join('\n'),
    '> 请在源码里删掉这些元素本身，不要用 `display:none` 或 `visibility:hidden`',
    '> 把它们藏起来——那样 DOM 里还在，读屏与 Tab 顺序仍会读到它们。',
    '>',
    '> 若该元素是由数据驱动渲染出来的（列表项、配置项、菜单项），',
    '> 请改数据源或渲染条件，而不是把 JSX / 模板里的循环体删掉。',
    '',
  ].join('\n')
}

// 「在谁里面、排在谁前面」——两头都给选择器，AI 才定位得到搬家的起点和终点。
// 落在末尾时没有后邻可写，必须显式说明：resolveElement 找不到元素时同样返回
// 空，光看「之前：（空）」分不出是末尾还是没找着。
const placeLine = (parentAnchors, nextAnchors, atEnd) => {
  const container = parentAnchors ? `\`${parentAnchors.selector}\`` : '（容器已失联）'
  const where = atEnd || !nextAnchors
    ? '末尾'
    : `${describeElement(nextAnchors)}（\`${nextAnchors.selector}\`）之前`
  return `${container} 里的${where}`
}

// 移动单独成段：它改的是源码结构，和调样式、换文案都不是一类操作。
// 混进属性表 AI 会照着写成 CSS —— 那只是看起来挪了位置。
const moveSection = moves => {
  if (!moves.length) return ''

  const blocks = moves.map((m, i) => [
    // 定位信息用移动**之前**的锚点：AI 要在源码里找的是它原来待的地方
    `### ${i + 1}. ${describeElement(m.fromAnchors || m.anchors)}`,
    '',
    anchorBlock(m.fromAnchors || m.anchors),
    `- 从：${placeLine(m.fromParentAnchors, m.fromNextAnchors, m.fromAtEnd)}`,
    `- 到：${placeLine(m.toParentAnchors, m.toNextAnchors, m.toAtEnd)}`,
    '',
  ].join('\n'))

  return [
    '---',
    '',
    '## 移动的元素',
    '',
    '以下元素被搬到了页面上的另一个位置：',
    '',
    blocks.join('\n'),
    '> 请在源码里把元素本身挪过去（改 JSX / 模板里的书写位置，或改渲染',
    '> 这段结构的数据），不要用 CSS `order` 或绝对定位去模拟：那只改变视觉',
    '> 位置，DOM 顺序不变，键盘 Tab 顺序与读屏顺序仍然是旧的。',
    '',
  ].join('\n')
}

// 新增单独成段：页面上多出了一个原来没有的元素，AI 要做的是「把它写出来」，
// 既不是改样式也不是搬家。位置复用 placeLine，跟移动那一段说的是同一种话。
const INSERT_HTML_LIMIT = 400

const insertSection = inserts => {
  if (!inserts.length) return ''

  const blocks = inserts.map((r, i) => {
    const html = r.html || ''
    // 粘一整块页面进来时 outerHTML 可能有几十 KB，整段塞进提示词会把真正要说
    // 的改动淹掉。截断并注明，AI 至少知道自己看到的不是全部。
    const snippet = html.length > INSERT_HTML_LIMIT
      ? `${html.slice(0, INSERT_HTML_LIMIT)}…（已截断，原文共 ${html.length} 字符）`
      : html

    // 替换（⌘⇧R）：一句「把 X 换成 Y」比「新增了 Y」+「删除了 X」两条准确得多。
    // 后者读起来是两件事，AI 很可能把新的追加到末尾、再去别处删一个
    const old = r.replaced
    const oldBrief = old
      ? [`\`<${old.tag}>\``, old.text ? `「${old.text}」` : ''].filter(Boolean).join(' ')
      : ''

    return [
      old
        ? `### ${i + 1}. 替换：把 ${oldBrief} 换成下面这段`
        : `### ${i + 1}. ${r.label || '新增元素'}：${describeElement(r.anchors || {})}`,
      '',
      old
        ? `- 位置：${oldBrief} 原来所在的位置（${placeLine(r.parentAnchors, r.nextAnchors, r.atEnd)}）`
        : `- 位置：${placeLine(r.parentAnchors, r.nextAnchors, r.atEnd)}`,
      old ? '- 被换掉的那个元素的完整定位信息见下方「删除的元素」，那两条说的是同一次操作' : '',
      '',
      '```html',
      snippet,
      '```',
      '',
    ].filter(Boolean).join('\n')
  })

  const hasReplace = inserts.some(r => r.replaced)

  return [
    '---',
    '',
    '## 新增的元素',
    '',
    '以下元素是在页面上新加出来的，原页面里没有：',
    '',
    blocks.join('\n'),
    '> 请在源码里真的把这些元素写出来（JSX / 模板 / 组件），不要用伪元素或',
    '> 脚本注入去模拟——那样 DOM 里没有它，读屏与 Tab 顺序也读不到。',
    ...(hasReplace
      ? ['>',
         '> 标着「替换」的那几项是**一次**操作：把原来那个元素整个换掉，新的写在',
         '> 它原来的位置上（同一个父节点、同一个下标），不要追加到容器末尾。']
      : []),
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
  // inserts 要给默认值：老调用点（以及测试里手搓的 state）没有这个键，
  // 少了默认值这里直接抛错，整条导出通道断掉
  const { edits = [], comments = [], removals = [], moves = [], inserts = [] } = state
  if (!edits.length && !comments.length && !removals.length && !moves.length && !inserts.length)
    return ''

  // 面板里手动改的 order 照常进属性表：它是一条普通样式改动，
  // 和「移动元素」是两回事——后者改的是 DOM 结构，单独成段。
  const styleEdits = edits

  const url      = meta.url      || (typeof location !== 'undefined' ? location.href : '')
  const viewport = meta.viewport || (typeof innerWidth !== 'undefined' ? `${innerWidth} × ${innerHeight}` : '')

  const head = ['# 页面视觉修改需求', '']
  if (url)      head.push(`来源：${url}`)
  if (viewport) head.push(`视口：${viewport}`)

  // 一条记录可能只有文案、只有样式，或两者都有，所以分开数
  const textCount  = styleEdits.filter(e => e.text).length
  const styleCount = styleEdits.filter(e => e.changes.length).length
  const imageCount = styleEdits.filter(e => e.attrs?.length).length

  // 一次替换会落成「新增 + 删除」两条记录。摘要里照实分开数就成了
  // 「1 处新增，1 处删除」——读的人算不出这其实是一次替换，还会以为改动更多。
  // 单独列一项「N 处替换」，新增与删除各自减去它们那一半
  const replacedKeys = replacedKeysOf(inserts)
  const replaceCount = inserts.filter(r => r.replaced).length
  const insertCount  = inserts.length - replaceCount
  const removalCount = removals.filter(r => !isReplaced(r, replacedKeys)).length

  const summary = []
  if (styleCount) summary.push(`${styleCount} 处元素样式`)
  if (textCount)  summary.push(`${textCount} 处文案`)
  if (imageCount) summary.push(`${imageCount} 处图片替换`)
  if (replaceCount)      summary.push(`${replaceCount} 处替换`)
  if (insertCount)       summary.push(`${insertCount} 处新增`)
  if (moves.length)      summary.push(`${moves.length} 处移动`)
  if (removalCount)      summary.push(`${removalCount} 处删除`)
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

  const hasRefImages = comments.some(c => c.images?.length)

  const commentSection = comments.length ? [
    '---',
    '',
    '## 交互备注',
    '',
    hasRefImages
      ? '这些是样式表达不了的需求（行为、交互，或「照着参考图改」）：'
      : '这些是 CSS 无法表达的行为需求，请实现对应的交互逻辑：',
    '',
    ...comments.map(c => {
      const idx = styleEdits.findIndex(e => e.el === c.el)
      const same = idx >= 0 ? `（同上述第 ${idx + 1} 项）` : ''

      const lines = [
        `- **${describeElement(c.anchors)}**${same}`,
        `  - 选择器：\`${c.anchors.selector}\``,
      ]
      if (c.text) lines.push(`  - 需求：${c.text}`)

      // 编号必须和需求文本里的 [图N] 一致：用户是把图插在句子的具体位置上的，
      // 只列一堆路径的话，那层「这句话说的是这张图」的信息就丢了
      ;(c.images || []).forEach((img, i) => {
        const file = refs?.files?.find(f => f.id === img.id)
        const note = img.note ? ` —— ${img.note}` : ''
        const tag = `[图${i + 1}]`

        lines.push(file?.path
          ? `  - ${tag} \`${file.path}\`${refs?.exact === false ? '（路径为推测）' : ''}${note}`
          : `  - ${tag} ${img.name}${note}（落盘失败，请向用户索取此文件）`)
      })

      return lines.join('\n')
    }),
    '',
    ...(hasRefImages
      ? ['> 参考图是用户想要的目标效果，请先用读图工具打开看过再动手。',
         '> 需求文本里的 `[图1]`、`[图2]` 指的就是紧随其后列出的同号参考图——',
         '> 用户把图插在句子的哪个位置，说的就是那一处。', '']
      : []),
  ].join('\n') : ''

  // 结尾的分隔线和 FOOTER 要拼成一段：filter(Boolean) 会把中间那个空行滤掉，
  // 让 --- 和下一个标题贴在一起
  // 新增排在移动之前：分组是「先造出外壳、再把子元素搬进去」，
  // 读的人得先知道那个容器是哪儿来的
  return [head.join('\n'), ...sections, insertSection(inserts), moveSection(moves),
    removalSection(removals, replacedKeys), commentSection, refSection(refs), `---\n\n${FOOTER}\n`]
    .filter(Boolean).join('\n')
}

export const copyPrompt = async (state, meta) => {
  const { edits = [], comments = [], removals = [], moves = [], inserts = [] } = state || {}
  if (!edits.length && !comments.length && !removals.length && !moves.length && !inserts.length)
    return { ok: false, reason: 'empty' }

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
