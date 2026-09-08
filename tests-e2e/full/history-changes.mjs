// 全量 e2e · 分块「改动记录 / 撤销重做 / 重置 / 重锚定」= 功能清单 §5（5.1–5.5）。
//
// 约定（与 full/ 下其它分块一致）：
//   - 改动记录面板的宿主是 <visual-revise-list>，内容在它的 shadow root 里；
//     Playwright 的后代选择器能穿开放 shadow，所以一律用
//     `visual-revise-list .item` 这种后代式写法，不用 `>`。
//   - 全部走真实交互（locator.click / page.mouse / page.keyboard）——这个仓库里
//     element.click() 那种程序化派发不触发 pointer 链。
//   - 列表是滚动容器，点行之前先 scrollIntoViewIfNeeded()。
//   - 断言落在真实结果上：元素 inline style / DOM 结构 / 改动记录
//     window.__visualRevise.store / 导出文本 / 面板 DOM，而不是「没报错」。
//
// 固件：full/fixtures/history-changes-lab.html（含一块单独的 <style id="impsheet">
// 供 §5.5 摘掉，验证「历史里存着 priority，不依赖重放那一刻的样式表」）。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()          // 默认服务 tests-e2e 目录
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/history-changes-lab.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const covered = new Set()
const T = (id, cond, msg) => { covered.add(id); cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

const LIST = 'visual-revise-list'
const L = sel => page.locator(`${LIST} ${sel}`)
const P = sel => page.locator(`visual-revise-panel ${sel}`)
const BAR = sel => page.locator(`visual-revise-toolbar ${sel}`)

const boot = async () => {
  await page.goto(FIXTURE)
  await injectVisBug(page, origin)
  await page.waitForTimeout(350)
}

const settle = () => page.evaluate(() =>
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

const stats = () => page.evaluate(() => window.__visualRevise.store.stats())
const hist = () => page.evaluate(() => {
  const h = window.__visualRevise.store.history
  return { depth: h.depth, canUndo: h.canUndo, canRedo: h.canRedo,
           undoLabel: h.undoLabel, redoLabel: h.redoLabel }
})
const inline = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i)?.style.getPropertyValue(p) ?? null, [id, prop])
const priority = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i)?.style.getPropertyPriority(p) ?? null, [id, prop])
const computed = (id, prop) => page.evaluate(([i, p]) =>
  getComputedStyle(document.getElementById(i)).getPropertyValue(p), [id, prop])
const toastText = () => page.evaluate(() =>
  document.getElementById('visual-revise-toast')?.textContent ?? '')

// 焦点可能停在 shadow root 里的输入框上，⌘Z 那时本该让路给浏览器
const blur = () => page.evaluate(() => {
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  el?.blur?.()
})
const undo = async () => { await blur(); await page.keyboard.press('Meta+z'); await page.waitForTimeout(350) }
const redo = async () => { await blur(); await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(350) }
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(180) }

const openList = async () => {
  const hidden = await page.evaluate(() => document.querySelector('visual-revise-list').hidden)
  if (hidden) { await BAR('.list').click(); await page.waitForTimeout(350) }
}
const closeList = async () => {
  const hidden = await page.evaluate(() => document.querySelector('visual-revise-list').hidden)
  if (!hidden) { await BAR('.list').click(); await page.waitForTimeout(250) }
}

// 面板输入框：填裸数字 + Enter，单位由 coerceLength 补
const write = async (prop, value) => {
  const i = P(`input[data-prop="${prop}"]`).first()
  await i.fill(String(value)); await i.press('Enter'); await page.waitForTimeout(300)
}
const selectEl = async (id, pos = { x: 6, y: 6 }) => {
  await esc(); await esc()
  await page.locator(`#${id}`).click({ position: pos, force: true })
  await page.waitForTimeout(420)
}

// 列表条目的结构快照：断言要落在「用户看得见的那几段字」上
const itemDump = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-list')?.shadowRoot
  if (!sr) return []
  return [...sr.querySelectorAll('.item')].map(it => ({
    id: it.dataset.id,
    kind: it.dataset.kind,
    orphaned: it.hasAttribute('data-orphaned'),
    fighting: it.hasAttribute('data-fighting'),
    sel: it.querySelector('.sel')?.textContent ?? '',
    selTitle: it.querySelector('.sel')?.getAttribute('title') ?? '',
    badges: [...it.querySelectorAll('.badge')].map(b => ({
      kind: b.dataset.kind || '', text: b.textContent.trim(), title: b.getAttribute('title') || '',
    })),
    hasUndoEl: !!it.querySelector('.undo-el'),
    restore: it.querySelector('.restore')
      ? { disabled: it.querySelector('.restore').disabled, title: it.querySelector('.restore').title } : null,
    moveBack: it.querySelector('.move-back')
      ? { disabled: it.querySelector('.move-back').disabled, title: it.querySelector('.move-back').title } : null,
    detail: it.querySelector('.comment-text')?.textContent.trim() ?? null,
    changes: [...it.querySelectorAll('.change')].map(c => ({
      isText: c.hasAttribute('data-text'),
      isAttr: c.hasAttribute('data-attr'),
      code: c.querySelector('code')?.textContent ?? '',
      from: c.querySelector('.from')?.textContent ?? '',
      to: c.querySelector('.to')?.textContent ?? '',
      btn: c.querySelector('button')?.className ?? '',
    })),
  }))
})

const tabsText = async () =>
  (await L('.tabs').textContent()).replace(/\s+/g, ' ').trim()

console.log('\n[全量·改动记录 / 撤销重做 / 重置 / 重锚定] 功能清单 §5\n')

// ════════════════════════════════════════════════════════════
// 第 1 幕：改动记录面板（5.1.x）
// ════════════════════════════════════════════════════════════
console.log('── 5.1 改动记录面板')
await boot()

// 空状态下的底部四个按钮（5.1.3 的一半）
await openList()
const emptyFooter = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-list').shadowRoot
  const pick = c => { const b = sr.querySelector(c); return b ? { text: b.textContent.trim(), disabled: b.disabled, title: b.title } : null }
  return {
    copy: pick('.copy'), export: pick('.export'), import: pick('.import'), reset: pick('.reset'),
    empty: sr.querySelector('.empty')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
  }
})
T('5.1.3', !!emptyFooter.copy && !!emptyFooter.export && !!emptyFooter.import && !!emptyFooter.reset
  && emptyFooter.copy.disabled && emptyFooter.export.disabled
  && !emptyFooter.import.disabled && !emptyFooter.reset.disabled,
  `底部四个按钮齐全，无改动时「复制提示词」「导出」灰掉、「导入」「重置」仍可用（`
  + `${['copy', 'export', 'import', 'reset'].map(k => `${emptyFooter[k].text}:${emptyFooter[k].disabled ? '灰' : '亮'}`).join(' ')}）`)
await closeList()

// ── 造改动：属性走面板真实输入 ──
await selectEl('p1', { x: 40, y: 8 })
await write('opacity', 50)   // 面板里是百分比
await write('border-radius', 6)
await esc(); await esc()
T('5.1.4', await inline('p1', 'opacity') === '0.5' && await inline('p1', 'border-radius') === '6px',
  `起点：面板真实输入写出两条属性改动（opacity=${await inline('p1', 'opacity')} radius=${await inline('p1', 'border-radius')}）`)

// 文案：走 VisBug 的文字编辑态（真实键盘输入）
await selectEl('txt', { x: 40, y: 8 })
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('text'))
await page.waitForTimeout(300)
await page.keyboard.press('End'); await page.keyboard.type('·改过')
await page.waitForTimeout(350)
await esc()
await page.evaluate(() => document.activeElement?.blur?.())
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('guides'))
await page.waitForTimeout(250)

// 换图 / srcset / 长值 / URL 值：这几条没有独立 UI 入口，走 store 的同一个写入口
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const pic = document.getElementById('pic')
  s.applyAttr(pic, 'src', 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw=')
  s.applyAttr(pic, 'srcset', 'https://cdn.example.com/img/hero-banner.png')
  const span = document.querySelector('#deep .tagme')
  s.applyProp(span, 'background-image', 'url("https://cdn.example.com/img/hero-banner.png")')
  s.applyProp(span, 'font-family', 'Zzzzzzzzzz-Yyyyyyyyyy-Xxxxxxxxxx-Wwwwwwwwww-Vvvv')
  s.addComment(document.getElementById('ttl'), '这里要加悬浮态', [
    { id: 'ref-1', name: 'ref.png', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
  ])
})
await page.waitForTimeout(300)

await openList()
const dump1 = await itemDump()
const st1 = await stats()

// 5.1.1 三个 tab 的计数口径
const tabs1 = await tabsText()
T('5.1.1', new RegExp(`全部\\s*${st1.total}`).test(tabs1)
  && new RegExp(`配置\\s*${st1.props + st1.texts + st1.attrs + st1.removals + st1.moves}`).test(tabs1)
  && new RegExp(`评论\\s*${st1.comments}`).test(tabs1),
  `三个 tab 的计数：「${tabs1}」（props=${st1.props} texts=${st1.texts} attrs=${st1.attrs} `
  + `removals=${st1.removals} moves=${st1.moves} comments=${st1.comments}）`)

// 「配置」只显示非评论条目，「评论」只显示评论
await L('.tabs button[data-tab="style"]').click(); await page.waitForTimeout(250)
const styleOnly = await itemDump()
await L('.tabs button[data-tab="comment"]').click(); await page.waitForTimeout(250)
const commentOnly = await itemDump()
await L('.tabs button[data-tab="all"]').click(); await page.waitForTimeout(250)
T('5.1.1', styleOnly.every(i => i.kind !== 'comment') && styleOnly.length === dump1.filter(i => i.kind !== 'comment').length
  && commentOnly.length === 1 && commentOnly[0].kind === 'comment',
  `切 tab 真的过滤：配置 ${styleOnly.length} 项（无评论）／评论 ${commentOnly.length} 项`)

// 5.1.4 样式条目的结构
const p1Item = dump1.find(i => i.sel === '#p1')
const spanItem = dump1.find(i => i.sel === 'span.tagme')
const picItem = dump1.find(i => i.sel === '#pic')
const txtItem = dump1.find(i => i.sel === '#txt')
T('5.1.4', !!p1Item && p1Item.hasUndoEl
  && p1Item.badges.some(b => b.text === String(p1Item.changes.length))
  && p1Item.changes.length === 2
  && p1Item.changes.every(c => c.btn.includes('undo-prop') && c.from !== '' && c.to !== ''),
  `样式条目：头部是选择器末段 + 条数徽章 + ↺，下面每条 prop from→to + ×（`
  + `${p1Item ? p1Item.changes.map(c => `${c.code} ${c.from}→${c.to}`).join('；') : '缺'}）`)
T('5.1.4', !!spanItem && spanItem.selTitle === '#deep > span.tagme',
  `头部只显示选择器末段（title 里才是全路径：「${spanItem?.selTitle}」→ 显示「${spanItem?.sel}」）`)
T('5.1.4', !!txtItem && txtItem.changes.some(c => c.isText && c.code === '文案' && c.to.includes('·改过')),
  `文案行标「文案」并写出前后文（${txtItem?.changes.find(c => c.isText)?.from} → ${txtItem?.changes.find(c => c.isText)?.to}）`)
T('5.1.4', !!picItem
  && picItem.changes.some(c => c.isAttr && c.code === '换图')
  && picItem.changes.some(c => c.isAttr && c.code === 'srcset')
  && picItem.changes.every(c => !c.isAttr || c.btn.includes('undo-attr')),
  `属性行：src 标「换图」、其它属性标属性名（${picItem?.changes.filter(c => c.isAttr).map(c => c.code).join('、')}）`)

// 5.1.5 长值缩短
const attrSrc = picItem?.changes.find(c => c.code === '换图')
const attrSrcset = picItem?.changes.find(c => c.code === 'srcset')
const bgRow = spanItem?.changes.find(c => c.code === 'background-image')
const fontRow = spanItem?.changes.find(c => c.code === 'font-family')
T('5.1.5', attrSrc?.from === '新图片' && attrSrc?.to === '新图片'
  && attrSrcset?.to === 'hero-banner.png'
  && bgRow?.to === 'hero-banner.png'
  && fontRow?.to.length === 38 && fontRow.to.endsWith('…'),
  `长值缩短：data: → 「${attrSrc?.to}」；URL 只留文件名 →「${bgRow?.to}」/「${attrSrcset?.to}」；`
  + `>40 字符截断 →「${fontRow?.to}」（${fontRow?.to.length} 字）`)

// 5.1.8 评论条目
const cItem = dump1.find(i => i.kind === 'comment')
T('5.1.8', !!cItem
  && cItem.badges.some(b => b.kind === 'comment' && b.text === '#1')
  && cItem.badges.some(b => b.kind === 'image' && /🖼\s*1/.test(b.text))
  && cItem.detail === '这里要加悬浮态'
  && !!cItem.id,
  `评论条目：编号「${cItem?.badges.find(b => b.kind === 'comment')?.text}」+ 文本「${cItem?.detail}」`
  + ` + 参考图徽章「${cItem?.badges.find(b => b.kind === 'image')?.text}」`)
const delBtn = await L('.del-comment').count()
T('5.1.8', delBtn === 1, `评论条目带一个删除按钮 ×（${delBtn} 个）`)

// 5.1.3 有改动之后两个按钮亮起来
const readyFooter = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-list').shadowRoot
  return { copy: sr.querySelector('.copy').disabled, export: sr.querySelector('.export').disabled }
})
T('5.1.3', !readyFooter.copy && !readyFooter.export,
  `有改动后「复制提示词」「导出」变可用（copy.disabled=${readyFooter.copy} export.disabled=${readyFooter.export}）`)

// 5.1.10 hover 高亮 / 移开清掉
const p1Row = L(`.item[data-id="${p1Item.id}"]`)
await p1Row.scrollIntoViewIfNeeded()
await p1Row.hover(); await page.waitForTimeout(300)
const hlOn = await page.evaluate(() => {
  const o = document.getElementById('visual-revise-locate-overlay')
  const r = document.getElementById('p1').getBoundingClientRect()
  return o ? { display: o.style.display, w: o.style.width, want: `${r.width}px` } : null
})
await page.mouse.move(400, 860); await page.waitForTimeout(300)
const hlOff = await page.evaluate(() =>
  document.getElementById('visual-revise-locate-overlay')?.style.display)
T('5.1.10', hlOn?.display === 'block' && hlOn.w === hlOn.want && hlOff === 'none',
  `hover 条目 → 页面上按该元素的尺寸画高亮框（${hlOn?.w} / 实际 ${hlOn?.want}），移开就清掉（display=${hlOff}）`)

// 5.1.11 点条目（非按钮区）→ 滚过去 + 选中 + 面板出现
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(200)
await selectEl('p1', { x: 40, y: 8 })   // 先选中别的，验证点条目会改选中
await openList()
const spanRow = L(`.item[data-id="${spanItem.id}"]`)
await spanRow.scrollIntoViewIfNeeded()
await spanRow.click({ position: { x: 60, y: 8 } })
await page.waitForTimeout(900)
const located = await page.evaluate(() => ({
  selected: document.querySelector('[data-selected]')?.textContent.trim() ?? null,
  panelHidden: document.querySelector('visual-revise-panel').hidden,
  scrolled: window.scrollY,
}))
T('5.1.11', located.selected === '末段' && located.panelHidden === false && located.scrolled > 0,
  `点条目 → 页面滚到该元素（scrollY=${located.scrolled}）、选中它（${located.selected}）并显示面板`)

// 5.1.14 header / footer 只建一次（拖动手势不会被打断）
const stable = await page.evaluate(async () => {
  const sr = document.querySelector('visual-revise-list').shadowRoot
  const header = sr.querySelector('header'), footer = sr.querySelector('footer')
  const copy = sr.querySelector('.copy'), tabAll = sr.querySelector('.tabs button[data-tab="all"]')
  const el = document.getElementById('p1')
  const s = window.__visualRevise.store
  for (let i = 0; i < 30; i++) s.applyProp(el, 'padding-top', `${10 + i}px`)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  return {
    sameHeader: sr.querySelector('header') === header,
    sameFooter: sr.querySelector('footer') === footer,
    sameCopy: sr.querySelector('.copy') === copy,
    sameTab: sr.querySelector('.tabs button[data-tab="all"]') === tabAll,
    applied: el.style.paddingTop,
  }
})
T('5.1.14', stable.sameHeader && stable.sameFooter && stable.sameCopy && stable.sameTab
  && stable.applied === '39px',
  `30 次连续通知后 header/footer/按钮/tab 仍是同一批节点（只重建条目区；最终值 ${stable.applied}）`)

// 5.1.15 同一帧内的多次通知合并成一次渲染（rAF）
const renders = await page.evaluate(async () => {
  const sr = document.querySelector('visual-revise-list').shadowRoot
  const items = sr.querySelector('.items')
  let n = 0
  const mo = new MutationObserver(recs => { for (const r of recs) if (r.type === 'childList') n++ })
  mo.observe(items, { childList: true })
  const el = document.getElementById('p1')
  const s = window.__visualRevise.store
  // 30 次写入 = 30 次 notify；不合并的话就是 30 次全量重建
  for (let i = 0; i < 30; i++) s.applyProp(el, 'letter-spacing', `${i / 10}px`)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  mo.disconnect()
  return { n, applied: el.style.letterSpacing }
})
T('5.1.15', renders.n >= 1 && renders.n <= 2 && renders.applied === '2.9px',
  `30 次通知只触发 ${renders.n} 次条目区重建（rAF 合并；最终值 ${renders.applied}）`)

// 5.1.16 列表里滚轮不穿透到页面
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const ttl = document.getElementById('ttl')
  for (let i = 0; i < 40; i++) s.addComment(ttl, `占位评论 ${i + 1}`)
  window.scrollTo(0, 0)
})
await page.waitForTimeout(500)
const listBox = await page.evaluate(() => {
  const items = document.querySelector('visual-revise-list').shadowRoot.querySelector('.items')
  const first = items.children[0]
  const r = items.getBoundingClientRect()
  return {
    x: r.x + r.width / 2, y: r.y + r.height / 2, top: items.scrollTop,
    n: items.children.length,
    itemH: first ? first.getBoundingClientRect().height : 0,
    headH: first?.querySelector('.item-head') ? first.querySelector('.item-head').getBoundingClientRect().height : 0,
    scrollH: items.scrollHeight, clientH: items.clientHeight,
  }
})
await page.mouse.move(listBox.x, listBox.y)
await page.mouse.wheel(0, 400)
await page.waitForTimeout(400)
const afterWheel = await page.evaluate(() => ({
  items: document.querySelector('visual-revise-list').shadowRoot.querySelector('.items').scrollTop,
  page: document.scrollingElement.scrollTop,
  pageScrollable: document.documentElement.scrollHeight > innerHeight,
}))
T('5.1.16', afterWheel.pageScrollable && afterWheel.page === 0,
  `光标停在列表上滚轮时页面纹丝不动（页面本身可滚 ${afterWheel.pageScrollable}，scrollTop=${afterWheel.page}）`)
// 但「不穿透」的前提是列表自己滚得起来。40 条记录时 .items 反而把每一行压扁：
// scrollHeight 恒等于 clientHeight，containScroll 的 max<=0 直接 return，滚轮什么也没做。
T('5.1.16', listBox.scrollH > listBox.clientH && afterWheel.items > 0,
  `列表内容本身也该滚起来（${listBox.n} 条记录：scrollHeight=${listBox.scrollH} clientHeight=${listBox.clientH}，`
  + `单条高度被压到 ${listBox.itemH.toFixed(1)}px / 头部就占 ${listBox.headH}px；scrollTop ${listBox.top} → ${afterWheel.items}）`)

// 5.1.2 头部可拖动（不落盘）+ × 关闭
const beforeStore = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))
const grip = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-list').shadowRoot
  const t = sr.querySelector('.tabs').getBoundingClientRect()
  const c = sr.querySelector('.close').getBoundingClientRect()
  const host = document.querySelector('visual-revise-list').getBoundingClientRect()
  return { x: (t.right + c.left) / 2, y: (t.top + t.bottom) / 2, hostX: host.x, hostY: host.y }
})
await page.mouse.move(grip.x, grip.y)
await page.mouse.down()
await page.mouse.move(grip.x - 140, grip.y + 60, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
const dragged = await page.evaluate(() => {
  const host = document.querySelector('visual-revise-list')
  const r = host.getBoundingClientRect()
  return { left: host.style.left, top: host.style.top, right: host.style.right, x: r.x, y: r.y }
})
const afterStore = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))
T('5.1.2', dragged.left !== '' && dragged.top !== '' && dragged.right === 'auto'
  && Math.abs(dragged.x - (grip.hostX - 140)) < 6 && Math.abs(dragged.y - (grip.hostY + 60)) < 6,
  `拖头部真的把面板搬走了（${Math.round(grip.hostX)},${Math.round(grip.hostY)} → ${Math.round(dragged.x)},${Math.round(dragged.y)}）`)
T('5.1.2', beforeStore === afterStore,
  `拖动位置不落盘（localStorage 前后一致：${beforeStore.length} 字节）`)
await L('.close').click(); await page.waitForTimeout(300)
const closedNow = await page.evaluate(() => ({
  hidden: document.querySelector('visual-revise-list').hidden,
  overlay: document.getElementById('visual-revise-locate-overlay')?.style.display,
}))
T('5.1.2', closedNow.hidden === true && closedNow.overlay === 'none',
  `头部 × 关掉列表并清掉高亮（hidden=${closedNow.hidden} overlay=${closedNow.overlay}）`)

// 位置搬回默认，免得影响后面的点击
await page.evaluate(() => {
  const host = document.querySelector('visual-revise-list')
  host.style.left = ''; host.style.top = ''; host.style.right = ''
  window.__visualRevise.store.undoEverything()
  window.__visualRevise.store.history.clear()
})
await page.waitForTimeout(300)

// ── 5.1.12 每个 × / ↺ 各自调对了方法 ──
console.log('── 5.1.12 逐个按钮')
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const p1 = document.getElementById('p1')
  const txt = document.getElementById('txt')
  const pic = document.getElementById('pic')
  s.applyProp(p1, 'opacity', '0.4')
  s.applyProp(p1, 'border-radius', '9px')
  s.markEdited(txt)
  txt.childNodes[0].nodeValue = '换过的文案'
  s.touch()
  s.applyAttr(pic, 'src', 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw=')
  s.addComment(document.getElementById('ttl'), '删我这条评论')
})
await page.waitForTimeout(300)
await openList()

// undo-prop：只撤一条，另一条不动
await L('.undo-prop[data-prop="opacity"]').first().scrollIntoViewIfNeeded()
await L('.undo-prop[data-prop="opacity"]').first().click(); await page.waitForTimeout(350)
T('5.1.12', await inline('p1', 'opacity') === '' && await inline('p1', 'border-radius') === '9px',
  `× 撤销单条属性走 undoProp（opacity="${await inline('p1', 'opacity')}" 圆角仍是 ${await inline('p1', 'border-radius')}）`)

// undo-text
await L('.undo-text').first().scrollIntoViewIfNeeded()
await L('.undo-text').first().click(); await page.waitForTimeout(350)
T('5.1.12', await page.evaluate(() => document.getElementById('txt').textContent.trim()) === '原始文案',
  `文案行的 × 走 undoText（回到「${await page.evaluate(() => document.getElementById('txt').textContent.trim())}」）`)

// undo-attr
await L('.undo-attr').first().scrollIntoViewIfNeeded()
await L('.undo-attr').first().click(); await page.waitForTimeout(350)
T('5.1.12', await page.evaluate(() => document.getElementById('pic').getAttribute('src'))
  === 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  `换图行的 × 走 undoAttr（src 回到原图）`)

// undo-el：撤销此元素全部改动
await L(`.undo-el`).first().scrollIntoViewIfNeeded()
await L(`.undo-el`).first().click(); await page.waitForTimeout(350)
T('5.1.12', await inline('p1', 'border-radius') === ''
  && (await stats()).props === 0,
  `头部 ↺ 走 undoElement，把这个元素的改动一次清完（props=${(await stats()).props}）`)

// del-comment
await L('.del-comment').first().scrollIntoViewIfNeeded()
await L('.del-comment').first().click(); await page.waitForTimeout(350)
T('5.1.12', (await stats()).comments === 0,
  `评论行的 × 走 removeComment（comments=${(await stats()).comments}）`)

// ════════════════════════════════════════════════════════════
// 第 2 幕：删除 / 移动条目 + 失联 + 重锚定（5.1.6/5.1.7/5.1.9/5.1.13、5.4.x）
// ════════════════════════════════════════════════════════════
console.log('\n── 5.1.6 / 5.1.7 / 5.1.9 / 5.1.13 与 5.4 重锚定')
await boot()

// 删除：有文字的走文字特征，没文字的走 <tag> + 子元素数
await selectEl('dgo', { x: 40, y: 8 })
await page.keyboard.press('Delete'); await page.waitForTimeout(450)
await page.evaluate(() => window.__visualRevise.store.removeElements([document.getElementById('sil')]))
await page.waitForTimeout(300)
await openList()
const rem = (await itemDump()).filter(i => i.kind === 'removal')
const withText = rem.find(i => i.sel === '#dgo')
const noText = rem.find(i => i.sel === '#sil')
T('5.1.6', rem.length === 2
  && withText?.detail === '删我'
  && noText?.detail === '<div> · 2 个子元素'
  && rem.every(i => i.badges.some(b => b.kind === 'removal' && b.text === '已删除'))
  && rem.every(i => i.restore && !i.restore.disabled && i.restore.title === '放回原位'),
  `删除条目：有文字显示文字「${withText?.detail}」，没文字显示 <tag> + 子元素数「${noText?.detail}」，↺ 可用`)

// ↺ 放回原位
await L(`.restore[data-id="${withText.id}"]`).scrollIntoViewIfNeeded()
await L(`.restore[data-id="${withText.id}"]`).click(); await page.waitForTimeout(400)
const restored = await page.evaluate(() => ({
  back: document.querySelector('#dw .row')?.textContent.trim() ?? null,
  removals: window.__visualRevise.store.stats().removals,
}))
T('5.1.6', restored.back === '删我' && restored.removals === 1,
  `点 ↺ 走 restoreRemoval 把元素放回原位（#dw 里现在是「${restored.back}」，剩 ${restored.removals} 条删除记录）`)
T('5.1.12', restored.back === '删我', `删除条目的 ↺ 走 restoreRemoval`)

// 父元素在渲染之后消失：这一下点下去只能失败，且要说清楚为什么
await page.evaluate(() => document.getElementById('sw').remove())
await settle(); await page.waitForTimeout(250)
await L(`.restore[data-id="${noText.id}"]`).scrollIntoViewIfNeeded()
await L(`.restore[data-id="${noText.id}"]`).click(); await page.waitForTimeout(400)
T('5.1.13', (await toastText()).includes('父元素已不在页面上'),
  `放不回去时 toast 说明原因：「${await toastText()}」`)

// 重新渲染一次（切 tab），按钮该变灰并写清 title
await L('.tabs button[data-tab="style"]').click(); await page.waitForTimeout(250)
await L('.tabs button[data-tab="all"]').click(); await page.waitForTimeout(250)
const goneParent = (await itemDump()).find(i => i.id === noText.id)
T('5.1.6', goneParent?.restore?.disabled === true
  && goneParent.restore.title === '父元素已不在页面上，放不回去',
  `父元素没了之后 ↺ 变灰并写清原因（disabled=${goneParent?.restore?.disabled} title「${goneParent?.restore?.title}」）`)

// ── 移动条目 ──
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.undoEverything(); s.history.clear()
  s.moveElement(document.getElementById('mvr'), document.getElementById('dst'), null)
})
await page.waitForTimeout(350)
const mv = (await itemDump()).find(i => i.kind === 'move')
T('5.1.7', !!mv && mv.detail === '移动到 #dst 里'
  && mv.badges.some(b => b.kind === 'move' && b.text === '已移动')
  && mv.moveBack && !mv.moveBack.disabled,
  `移动条目写明搬到哪儿了：「${mv?.detail}」，徽章「${mv?.badges.find(b => b.kind === 'move')?.text}」，↺ 可用`)

await L('.move-back').first().scrollIntoViewIfNeeded()
await L('.move-back').first().click(); await page.waitForTimeout(400)
const homed = await page.evaluate(() => ({
  src: document.getElementById('src').textContent.trim(),
  dst: document.getElementById('dst').children.length,
  moves: window.__visualRevise.store.stats().moves,
}))
T('5.1.7', homed.src === '搬我' && homed.dst === 0 && homed.moves === 0,
  `↺ 走 moveBack 把元素搬回原位，记录随之消失（#src=「${homed.src}」 #dst 子元素 ${homed.dst} moves=${homed.moves}）`)
T('5.1.12', homed.moves === 0, `移动条目的 ↺ 走 moveBack`)

// 原容器在渲染之后消失
await page.evaluate(() => {
  window.__visualRevise.store.moveElement(
    document.getElementById('mvr'), document.getElementById('dst'), null)
})
await page.waitForTimeout(350)
await page.evaluate(() => document.getElementById('src').remove())
await settle(); await page.waitForTimeout(250)
await L('.move-back').first().scrollIntoViewIfNeeded()
await L('.move-back').first().click(); await page.waitForTimeout(400)
T('5.1.13', (await toastText()).includes('原来的容器已不在页面上'),
  `搬不回去时 toast 说明原因：「${await toastText()}」`)
await L('.tabs button[data-tab="style"]').click(); await page.waitForTimeout(250)
await L('.tabs button[data-tab="all"]').click(); await page.waitForTimeout(250)
const mvGone = (await itemDump()).find(i => i.kind === 'move')
T('5.1.7', mvGone?.moveBack?.disabled === true
  && mvGone.moveBack.title === '原来的容器已不在页面上，搬不回去',
  `原容器没了之后 ↺ 变灰并写清原因（title「${mvGone?.moveBack?.title}」）`)

// ── 5.1.9 / 5.4.2 失联徽章 ──
await boot()
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.applyProp(document.getElementById('p1'), 'padding-top', '30px')
  document.getElementById('p1').remove()
})
await settle(); await page.waitForTimeout(300)
await openList()
const orphan = (await itemDump()).find(i => i.orphaned)
T('5.1.9', !!orphan && orphan.badges.some(b => b.kind === 'gone' && b.text === '元素已消失'),
  `元素真的没了 → 条目压暗并挂「${orphan?.badges.find(b => b.kind === 'gone')?.text}」徽章，记录留在列表里`)
T('5.4.2', (await stats()).props === 1,
  `认不准时不静默丢弃：记录数仍是 ${(await stats()).props}`)

// 长得一样的隔壁不能被认错
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.undoEverything(); s.history.clear()
  const host = document.createElement('div')
  host.id = 'twins'
  host.innerHTML = '<p class="twin">一样的文字</p><p class="twin">一样的文字</p>'
  document.getElementById('stg').appendChild(host)
  const [first] = host.querySelectorAll('.twin')
  s.applyProp(first, 'padding-top', '18px')
  first.remove()
})
await settle(); await page.waitForTimeout(300)
const twin = await page.evaluate(() => ({
  survivor: document.querySelector('#twins .twin').style.paddingTop,
  orphaned: window.__visualRevise.store.read().edits.filter(e => e.orphaned).length,
  total: window.__visualRevise.store.stats().total,
}))
T('5.4.2', twin.survivor === '' && twin.orphaned === 1 && twin.total === 1,
  `认不准就标失联留在记录里，绝不贴到长得一样的隔壁（隔壁 padding-top="${twin.survivor}"，orphaned=${twin.orphaned}）`)

// ── 5.4.3 fighting：页面反复把删掉的元素渲染回来 ──
await boot()
const fight = await page.evaluate(async () => {
  const s = window.__visualRevise.store
  const wrap = document.getElementById('fw')
  s.removeElements([document.getElementById('fgt')])
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  let killed = 0
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('p')
    p.className = 'row'; p.id = 'fgt'; p.textContent = '页面在还原我'
    wrap.appendChild(p)
    await frame()
    if (!document.getElementById('fgt')) killed++
  }
  const rec = s.read().removals[0]
  return { killed, fighting: !!rec?.fighting, stillThere: !!document.getElementById('fgt'),
           removals: s.stats().removals }
})
await openList()
const fightRow = (await itemDump()).find(i => i.kind === 'removal')
T('5.4.3', fight.killed >= 25 && fight.fighting === true && fight.stillThere && fight.removals === 1,
  `页面反复渲染回来时先删 ${fight.killed} 次，超预算后停手并标 fighting（元素留在页面上=${fight.stillThere}）`)
T('5.1.9', fightRow?.fighting === true
  && fightRow.badges.some(b => b.kind === 'gone' && b.text === '页面在还原'),
  `fighting 的条目挂「${fightRow?.badges.find(b => b.kind === 'gone')?.text}」徽章，和「元素已消失」区分开`)

// ── 5.4.1 / 5.4.4 各自的重放路径 ──
await boot()
const rerender = id => page.evaluate(x => {
  const el = document.getElementById(x)
  const fresh = el.cloneNode(true)
  fresh.removeAttribute('style')
  el.replaceWith(fresh)
}, id)

await page.evaluate(() => {
  window.__visualRevise.store.applyProp(document.getElementById('txt'), 'padding-top', '26px')
})
await rerender('txt'); await settle(); await page.waitForTimeout(250)
const healed = await page.evaluate(() => ({
  props: window.__visualRevise.store.stats().props,
  elements: window.__visualRevise.store.stats().elements,
  applied: document.getElementById('txt').style.paddingTop,
}))
T('5.4.1', healed.props === 1 && healed.elements === 1 && healed.applied === '26px',
  `节点被换掉后一帧内按 identity 找回并把改动重放到新节点（props=${healed.props} 新节点 padding-top=${healed.applied}）`)

// 5.4.4a 删除的重放路径
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.removeElements([document.getElementById('dgo')])
})
await page.waitForTimeout(200)
await page.evaluate(() => {
  const p = document.createElement('p')
  p.className = 'row'; p.id = 'dgo'; p.textContent = '删我'
  document.getElementById('dw').appendChild(p)
})
await settle(); await page.waitForTimeout(250)
const reRemoved = await page.evaluate(() => ({
  gone: !document.getElementById('dgo'),
  removals: window.__visualRevise.store.stats().removals,
}))

// 5.4.4b 移动的重放路径
await page.evaluate(() => {
  window.__visualRevise.store.moveElement(
    document.getElementById('mvr'), document.getElementById('dst'), null)
})
await page.waitForTimeout(250)
await page.evaluate(() => {
  document.getElementById('src').innerHTML = '<p class="row" id="mvr">搬我</p>'
})
await settle(); await page.waitForTimeout(300)
const reMoved = await page.evaluate(() => ({
  dst: document.getElementById('dst').textContent.trim(),
  src: document.getElementById('src').textContent.trim(),
  copies: document.querySelectorAll('.row').length,
  moves: window.__visualRevise.store.stats().moves,
}))

// 5.4.4c 评论的重绑路径
await page.evaluate(() => window.__visualRevise.store.addComment(document.getElementById('ttl'), '标题要更大'))
await rerender('ttl'); await settle(); await page.waitForTimeout(250)
const reBound = await page.evaluate(() => {
  const c = window.__visualRevise.store.read().comments[0]
  return { comments: window.__visualRevise.store.stats().comments,
           live: c?.el === document.getElementById('ttl'), orphaned: !!c?.orphaned }
})
T('5.4.4', reRemoved.gone && reRemoved.removals === 1
  && reMoved.dst === '搬我' && reMoved.src === '' && reMoved.moves === 1
  && reBound.comments === 1 && reBound.live && !reBound.orphaned,
  `删除 / 移动 / 评论各走自己的重放路径（渲回来的又被删掉=${reRemoved.gone}；`
  + `移动重放后 #dst=「${reMoved.dst}」#src=「${reMoved.src}」不留重影；评论绑到新节点=${reBound.live}）`)

// ── 5.4.5 观察器的生命周期 ──
await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  window.__visualRevise.store.clear()
  window.__visualRevise.destroy()
  document.querySelector('vis-bug')?.remove()
})
await page.waitForTimeout(400)
const afterDestroy = await page.evaluate(() => ({
  panel: !!document.querySelector('visual-revise-panel'),
  list: !!document.querySelector('visual-revise-list'),
}))
await page.evaluate(() => {
  const el = document.createElement('vis-bug')
  el.setAttribute('tutsBaseURL', '/__ext/tuts')
  document.body.prepend(el)
})
await page.waitForTimeout(600)
await page.evaluate(() => {
  window.__visualRevise.store.applyProp(document.getElementById('p2'), 'padding-top', '22px')
})
await rerender('p2'); await settle(); await page.waitForTimeout(250)
const remount = await page.evaluate(() => ({
  panel: !!document.querySelector('visual-revise-panel'),
  props: window.__visualRevise.store.stats().props,
  applied: document.getElementById('p2').style.paddingTop,
}))
T('5.4.5', !afterDestroy.panel && !afterDestroy.list && remount.panel
  && remount.props === 1 && remount.applied === '22px',
  `destroy 后 UI 卸载、观察器断开；重新挂载后重锚照常工作（props=${remount.props} 重贴值=${remount.applied}）`)

// ════════════════════════════════════════════════════════════
// 第 3 幕：撤销 / 重做栈（5.2.x）
// ════════════════════════════════════════════════════════════
console.log('\n── 5.2 撤销 / 重做栈')
await boot()

// 5.2.1 上限 100
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const el = document.getElementById('p1')
  const props = ['opacity', 'border-radius', 'z-index']
  for (let i = 0; i < 130; i++)
    s.applyProp(el, props[i % 3], String(1 + i % 7) + (i % 3 === 1 ? 'px' : ''))
})
await page.waitForTimeout(400)
T('5.2.1', (await hist()).depth === 100,
  `栈满 100 条后丢最旧的（depth=${(await hist()).depth}）`)

// 5.2.2 合并窗口 + 新操作断掉重做链（两者同在 commit()）
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.undoEverything(); s.history.clear()
})
await page.waitForTimeout(250)
const mergeNear = await page.evaluate(async () => {
  const s = window.__visualRevise.store
  const el = document.getElementById('p1')
  for (let v = 10; v <= 30; v++) s.applyProp(el, 'border-radius', `${v}px`)
  return { depth: s.history.depth, value: el.style.borderRadius }
})
T('5.2.2', mergeNear.depth === 1 && mergeNear.value === '30px',
  `同元素同属性、400ms 内的 21 次连写合并成 1 条（depth=${mergeNear.depth}，终值 ${mergeNear.value}）`)
const mergeFar = await page.evaluate(async () => {
  const s = window.__visualRevise.store
  const el = document.getElementById('p1')
  await new Promise(r => setTimeout(r, 520))     // 超出 MERGE_WINDOW(400)
  s.applyProp(el, 'border-radius', '31px')
  return s.history.depth
})
T('5.2.2', mergeFar === 2,
  `隔了 400ms 之外再写同一属性就另起一条（depth=${mergeFar}）`)

await undo()
T('5.2.2', (await hist()).canRedo === true, `撤销后有重做链（canRedo=${(await hist()).canRedo}）`)
await page.evaluate(() => window.__visualRevise.store.applyProp(document.getElementById('p2'), 'opacity', '0.3'))
await page.waitForTimeout(300)
T('5.2.2', (await hist()).canRedo === false, `有新操作即断掉重做链（canRedo=${(await hist()).canRedo}）`)

// 5.2.3 撤销时反序执行 ops：一次批量删掉两个相邻兄弟，⌘Z 要还原成原顺序
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.undoEverything(); s.history.clear()
  s.removeElements([document.getElementById('p1'), document.getElementById('p2')])
})
await page.waitForTimeout(350)
const afterBatchDel = await page.evaluate(() =>
  [...document.querySelectorAll('#pair > p')].map(p => p.id).join(','))
await undo()
const reversed = await page.evaluate(() => ({
  order: [...document.querySelectorAll('#pair > p')].map(p => p.id).join(','),
  removals: window.__visualRevise.store.stats().removals,
  depth: window.__visualRevise.store.history.depth,
}))
T('5.2.3', afterBatchDel === 'p3' && reversed.order === 'p1,p2,p3' && reversed.removals === 0,
  `一次批量删两个相邻兄弟（剩 ${afterBatchDel}），⌘Z 反序执行 ops 才还原得出原顺序：${reversed.order}`)

// 5.2.4 undoLabel / redoLabel 供 tooltip 与 toast
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.undoEverything(); s.history.clear()
  s.applyProp(document.getElementById('p1'), 'letter-spacing', '3px')
})
await page.waitForTimeout(300)
const labels = await hist()
await BAR('.undo').hover(); await page.waitForTimeout(300)
const tipUndo = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  return { data: sr.querySelector('.undo').dataset.tipLabel,
           shown: sr.querySelector('.tip')?.hidden ? null : sr.querySelector('.tip-label').textContent }
})
await BAR('.undo').click(); await page.waitForTimeout(400)
const undoToast = await toastText()
await BAR('.redo').hover(); await page.waitForTimeout(300)
const tipRedo = await page.evaluate(() =>
  document.querySelector('visual-revise-toolbar').shadowRoot.querySelector('.redo').dataset.tipLabel)
await BAR('.redo').click(); await page.waitForTimeout(400)
const redoToast = await toastText()
T('5.2.4', labels.undoLabel === 'letter-spacing'
  && tipUndo.data === '撤销：letter-spacing' && tipUndo.shown === '撤销：letter-spacing'
  && undoToast === '已撤销：letter-spacing'
  && tipRedo === '重做：letter-spacing' && redoToast === '已重做：letter-spacing',
  `undoLabel/redoLabel 同时喂给气泡与 toast（气泡「${tipUndo.shown}」→ toast「${undoToast}」→ 「${redoToast}」）`)

// 没有可撤销时的兜底文案
await page.evaluate(() => window.__visualRevise.store.history.clear())
await page.waitForTimeout(300)
const emptyTip = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  return { undo: sr.querySelector('.undo').dataset.tipLabel, disabled: sr.querySelector('.undo').disabled }
})
T('5.2.4', emptyTip.undo === '没有可撤销的操作' && emptyTip.disabled === true,
  `没有历史时气泡写「${emptyTip.undo}」且按钮灰掉`)

// 5.2.5 undo / redo 自身写回 DOM 时不再入栈
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.undoEverything(); s.history.clear()
  s.applyProp(document.getElementById('p1'), 'opacity', '0.2')
  s.applyProp(document.getElementById('p2'), 'opacity', '0.3')
})
await page.waitForTimeout(300)
const d0 = (await hist()).depth
await undo(); const d1 = (await hist()).depth
await undo(); const d2 = (await hist()).depth
await redo(); const d3 = (await hist()).depth
await redo(); const d4 = (await hist()).depth
T('5.2.5', d0 === 2 && d1 === 1 && d2 === 0 && d3 === 1 && d4 === 2,
  `undo/redo 自身的 DOM 写回被 muted，栈只增减不重复入栈（${[d0, d1, d2, d3, d4].join(' → ')}）`)

// ════════════════════════════════════════════════════════════
// 第 4 幕：重置全部（5.3.x）
// ════════════════════════════════════════════════════════════
console.log('\n── 5.3 重置全部')
await boot()

// 一次把样式 / 文案 / 属性 / 删除 / 移动 / 评论 / 失联记录全凑齐
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.applyProp(document.getElementById('p1'), 'padding-top', '40px')
  const txt = document.getElementById('txt')
  s.markEdited(txt); txt.childNodes[0].nodeValue = '被改过的文案'; s.touch()
  s.applyAttr(document.getElementById('pic'), 'src', 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw=')
  s.removeElements([document.getElementById('dgo')])
  s.moveElement(document.getElementById('mvr'), document.getElementById('dst'), null)
  s.addComment(document.getElementById('ttl'), '这条评论也该被清掉')
  // 再造一条失联记录：它的改动冻结在 frozen 里，不跟着 DOM 走
  s.applyProp(document.getElementById('p2'), 'opacity', '0.25')
  document.getElementById('p2').remove()
})
await settle(); await page.waitForTimeout(400)
const beforeReset = await stats()
const orphanCount = await page.evaluate(() =>
  window.__visualRevise.store.read().edits.filter(e => e.orphaned).length)
T('5.3.1', beforeReset.total >= 6 && orphanCount === 1,
  `重置前：${beforeReset.total} 条记录（含 ${orphanCount} 条失联）`)

await openList()
await L('.reset').click(); await page.waitForTimeout(600)
const afterReset = await page.evaluate(() => ({
  stats: window.__visualRevise.store.stats(),
  p1: document.getElementById('p1').getAttribute('style'),
  txt: document.getElementById('txt').textContent.trim(),
  src: document.getElementById('pic').getAttribute('src'),
  dgo: document.querySelector('#dw .row')?.textContent.trim() ?? null,
  src2: document.getElementById('src').textContent.trim(),
  dst: document.getElementById('dst').children.length,
  items: document.querySelector('visual-revise-list').shadowRoot.querySelectorAll('.item').length,
}))
T('5.3.1', afterReset.stats.total === 0 && afterReset.items === 0
  && !afterReset.p1 && afterReset.txt === '原始文案'
  && afterReset.src === 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
  && afterReset.dgo === '删我' && afterReset.src2 === '搬我' && afterReset.dst === 0,
  `点「重置」一次还原样式 / 文案 / 属性、放回删除的、把搬家的搬回、清空评论与失联记录`
  + `（total=${afterReset.stats.total}，列表 ${afterReset.items} 项，#dw=「${afterReset.dgo}」#src=「${afterReset.src2}」）`)

// 5.3.2 ⌘Z 把这次重置连同移动一起救回来
await undo()
const rescued = await page.evaluate(() => ({
  stats: window.__visualRevise.store.stats(),
  p1: document.getElementById('p1').style.paddingTop,
  txt: document.getElementById('txt').textContent.trim(),
  dst: document.getElementById('dst').textContent.trim(),
  dgo: !!document.querySelector('#dw .row'),
}))
T('5.3.2', rescued.p1 === '40px' && rescued.dst === '搬我' && !rescued.dgo
  && rescued.stats.moves === 1 && rescued.stats.removals === 1
  && rescued.stats.comments === 1 && rescued.stats.attrs === 1 && rescued.stats.props === 2,
  `⌘Z 撤销「重置全部」：样式 / 属性 / 删除 / 移动 / 评论都回来了`
  + `（props=${rescued.stats.props} attrs=${rescued.stats.attrs} removals=${rescued.stats.removals} `
  + `moves=${rescued.stats.moves} comments=${rescued.stats.comments}，#dst=「${rescued.dst}」）`)
// captureAll 只存了 cssText + attrs，没存文本节点；而 undoEverything 里的 revertAll 会把文案改回去。
// 于是「重置 → ⌘Z」之后文案改动有去无回，记录数也跟着少一条。
T('5.3.2', rescued.txt === '被改过的文案' && rescued.stats.texts === 1
  && rescued.stats.total === beforeReset.total,
  `⌘Z 撤销「重置全部」也该把文案救回来（页面上是「${rescued.txt}」，texts=${rescued.stats.texts}，`
  + `记录 ${rescued.stats.total}/${beforeReset.total} 条）`)

// ════════════════════════════════════════════════════════════
// 第 5 幕：!important 写入（5.5.x）
// ════════════════════════════════════════════════════════════
console.log('\n── 5.5 !important 写入')
await boot()

// 间距是合并控件（左右 / 上下两段）；先按展开钮摊成四条，才写得到单独一条
const expandPadding = async () => {
  if (await P('input[data-prop="padding-top"]').count() === 0) {
    await P('.expand-sides[data-kind="padding"]').click()
    await page.waitForTimeout(350)
  }
}

const sheetSays = await computed('imp', 'padding-top')
await selectEl('imp', { x: 40, y: 24 })
await expandPadding()
await write('padding-top', 40)
await write('padding-bottom', 12)
const impWrite = {
  inline: await inline('imp', 'padding-top'),
  priority: await priority('imp', 'padding-top'),
  computed: await computed('imp', 'padding-top'),
  bottomPriority: await priority('imp', 'padding-bottom'),
  bottomComputed: await computed('imp', 'padding-bottom'),
}
T('5.5.1', sheetSays === '20px' && impWrite.inline === '40px'
  && impWrite.priority === 'important' && impWrite.computed === '40px',
  `样式表里 padding-top:20px!important 时，面板写入自动带 important，画面真的跟着变`
  + `（computed ${sheetSays} → ${impWrite.computed}）`)
T('5.5.1', impWrite.bottomPriority === '' && impWrite.bottomComputed === '12px',
  `没被样式表 important 压着的那条不多带 important（padding-bottom priority="${impWrite.bottomPriority}"，`
  + `computed=${impWrite.bottomComputed}）`)

// 5.5.2 判定在 applyProp 做一次并缓存在快照上
const cache = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const el = document.getElementById('imp')
  let snap = null
  for (const v of s.snapshots.values()) if (v.el === el) snap = v
  return {
    isMap: snap?.sheetImportant instanceof Map,
    top: snap?.sheetImportant?.get('padding-top'),
    bottom: snap?.sheetImportant?.get('padding-bottom'),
    keys: snap ? [...snap.sheetImportant.keys()] : [],
  }
})
T('5.5.2', cache.isMap && cache.top === true && cache.bottom === false,
  `判定结果按 (el, prop) 缓存在快照的 sheetImportant 上（${cache.keys.join('/')} → top=${cache.top} bottom=${cache.bottom}）`)

// 缓存真的生效：先写一次 opacity（样式表里也带 important）→ ⌘Z 撤掉，让 inline 上不留 priority；
// 再把整块样式表摘掉。此时层叠里已经没有任何 important，只有快照上那条缓存还记得。
await write('opacity', 50)   // 面板里是百分比
const opFirst = await priority('imp', 'opacity')
await undo()
const opCleared = { v: await inline('imp', 'opacity'), p: await priority('imp', 'opacity') }
await page.evaluate(() => document.getElementById('impsheet').remove())
await settle(); await page.waitForTimeout(200)
const liveSaysNo = await page.evaluate(() =>
  !window.__visualRevise.lib.winningDeclaration
  || !window.__visualRevise.lib.winningDeclaration(document.getElementById('imp'), 'opacity')?.important)
await write('opacity', 40)
T('5.5.2', opFirst === 'important' && opCleared.v === '' && opCleared.p === ''
  && await priority('imp', 'opacity') === 'important',
  `摘掉样式表、inline 上也没有 priority 之后再写同一 (el, prop)，仍按快照缓存写成 important`
  + `（写入 priority="${await priority('imp', 'opacity')}"；此刻层叠里已无 important=${liveSaysNo}）`)

// 5.5.3 priority 随 op 存进历史，重放不依赖「此刻的样式表」
await page.evaluate(() => {
  const s = window.__visualRevise.store
  // 清掉快照（连同 sheetImportant 缓存），只留历史
  s.clear()
})
await page.waitForTimeout(250)
await undo()
const undone = { v: await inline('imp', 'opacity'), p: await priority('imp', 'opacity') }
await redo()
const redone = { v: await inline('imp', 'opacity'), p: await priority('imp', 'opacity') }
T('5.5.3', undone.v === '' && undone.p === ''
  && redone.v === '0.4' && redone.p === 'important',
  `样式表已摘、快照缓存已清，undo/redo 仍照 op 里存的 priority 回放`
  + `（undo → "${undone.v}"；redo → ${redone.v} !${redone.p}）`)

// 合并分支也要更新 afterImportant，否则合并后粘着第一次的判定
await boot()
const mergedImportant = await page.evaluate(async () => {
  const s = window.__visualRevise.store
  const el = document.getElementById('p1')        // 样式表里没有 important
  s.applyProp(el, 'letter-spacing', '2px')                          // afterImportant = false
  s.applyProp(el, 'letter-spacing', '4px', { important: true })     // 400ms 内，合并
  return { depth: s.history.depth, v: el.style.letterSpacing,
           p: el.style.getPropertyPriority('letter-spacing') }
})
await undo()
const mergedUndone = { v: await inline('p1', 'letter-spacing'), p: await priority('p1', 'letter-spacing') }
await redo()
const mergedRedone = { v: await inline('p1', 'letter-spacing'), p: await priority('p1', 'letter-spacing') }
T('5.5.3', mergedImportant.depth === 1 && mergedImportant.p === 'important'
  && mergedUndone.v === '' && mergedRedone.v === '4px' && mergedRedone.p === 'important',
  `合并分支同步更新 afterImportant：两次写入合成 1 条（depth=${mergedImportant.depth}），`
  + `redo 回放的是最后那次的 priority（${mergedRedone.v} !${mergedRedone.p}）`)

// 5.5.4 important 是改动记录上的独立字段，不拼进值字符串
await boot()
await selectEl('imp', { x: 40, y: 24 })
await expandPadding()
await write('padding-top', 40)
await write('padding-bottom', 12)
await esc(); await esc()
const rec = await page.evaluate(() => {
  const e = window.__visualRevise.store.read().edits.find(x => x.anchors.selector === '#imp')
  const top = e?.changes.find(c => c.prop === 'padding-top')
  const bottom = e?.changes.find(c => c.prop === 'padding-bottom')
  return { top, bottom }
})
T('5.5.4', rec.top?.important === true && rec.top.to === '40px' && !/!important/.test(rec.top.to)
  && rec.bottom && rec.bottom.important === undefined,
  `改动记录上 important 是独立字段：padding-top {to:"${rec.top?.to}", important:${rec.top?.important}}，`
  + `padding-bottom 不带这个字段（${rec.bottom?.important}）`)

// 框架换节点后的重贴要照样带 priority
await page.evaluate(() => {
  const el = document.getElementById('imp')
  const fresh = el.cloneNode(true)
  fresh.removeAttribute('style')
  el.replaceWith(fresh)
})
await settle(); await page.waitForTimeout(300)
T('5.5.4', await inline('imp', 'padding-top') === '40px'
  && await priority('imp', 'padding-top') === 'important'
  && await computed('imp', 'padding-top') === '40px',
  `节点被换掉后重贴照样带 priority（${await inline('imp', 'padding-top')} !${await priority('imp', 'padding-top')}）`)

// 5.5.5 三处「存原文再写回」存的是 { value, important }
await boot()
// 文字色眼睛：inline 是普通声明、样式表赢家带 important。
// 只存值不存 priority 的话，一开一关会把 blue 写成 blue !important，画面就变了。
await selectEl('tc', { x: 40, y: 8 })
const tcBefore = { computed: await computed('tc', 'color'), inline: await inline('tc', 'color'),
                   priority: await priority('tc', 'color') }
const eyeCount = await P('[data-text-eye]').count()
await P('[data-text-eye]').first().click(); await page.waitForTimeout(400)
const tcOff = { computed: await computed('tc', 'color'), priority: await priority('tc', 'color') }
await P('[data-text-eye]').first().click(); await page.waitForTimeout(400)
const tcOn = { computed: await computed('tc', 'color'), inline: await inline('tc', 'color'),
               priority: await priority('tc', 'color') }
T('5.5.5', eyeCount === 1 && tcBefore.computed === 'rgb(255, 0, 0)'
  && tcOff.priority === 'important' && /transparent|rgba\(0, 0, 0, 0\)/.test(tcOff.computed)
  && tcOn.inline === 'rgb(0, 0, 255)' && tcOn.priority === ''
  && tcOn.computed === tcBefore.computed,
  `文字色眼睛存的是 { value, important }：关掉时按 important 写 transparent，`
  + `打开时原样放回普通声明（inline ${tcOn.inline} priority="${tcOn.priority}"，computed 回到 ${tcOn.computed}）`)

// 填充层眼睛：同一套「存原文 / 原样放回」
await selectEl('fil', { x: 40, y: 8 })
const filBefore = { computed: await computed('fil', 'background-color'),
                    inline: await inline('fil', 'background-color'),
                    priority: await priority('fil', 'background-color') }
const layerEyes = await P('[data-layer-eye]').count()
let filOn = null, filOff = null
if (layerEyes) {
  await P('[data-layer-eye]').first().click(); await page.waitForTimeout(400)
  filOff = { computed: await computed('fil', 'background-color'),
             priority: await priority('fil', 'background-color') }
  await P('[data-layer-eye]').first().click(); await page.waitForTimeout(400)
  filOn = { computed: await computed('fil', 'background-color'),
            inline: await inline('fil', 'background-color'),
            priority: await priority('fil', 'background-color') }
}
T('5.5.5', layerEyes > 0 && filOn?.inline === 'rgb(0, 0, 255)' && filOn.priority === ''
  && filOn.computed === filBefore.computed,
  `填充层眼睛同样存 { value, important }：一开一关后 inline 仍是普通声明 `
  + `${filOn?.inline}（priority="${filOn?.priority}"），computed 回到 ${filOn?.computed}`)

const sectionEyes = await P('[data-eye]').count()
T('5.5.5', sectionEyes === 0,
  `分区级眼睛（#toggleSection）在当前 UI 里不渲染（[data-eye] ${sectionEyes} 个）——`
  + `第三处「存原文再写回」目前没有可达入口，只能靠上面两处锁住这条契约`)

// 5.5.6 导出
await boot()
await selectEl('imp', { x: 40, y: 24 })
await expandPadding()
await write('padding-top', 40)
await write('padding-right', 12)
await write('padding-bottom', 12)
await write('padding-left', 12)
await esc(); await esc()
const four = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const e = s.read().edits.find(x => x.anchors.selector === '#imp')
  return Object.fromEntries(e.changes.map(c => [c.prop, { to: c.to, important: !!c.important }]))
})
const md = await page.evaluate(() => window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
const impRow = md.split('\n').filter(l => l.includes('padding-top'))
T('5.5.6', Object.keys(four).length >= 4
  && /40px !important/.test(md) && !/^\|\s*padding\s/m.test(md)
  && ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].every(p => md.includes(p)),
  `提示词里才把 important 拼回值（「${impRow[0]?.trim()}」），四条边有一条带 important 就不折叠成 padding 简写`
  + `（记录里的四条：${Object.entries(four).map(([p, v]) => `${p}=${v.to}${v.important ? '!' : ''}`).join(' ')}）`)

const json = await page.evaluate(() => window.__visualRevise.lib.exportJSON())
const jsonTop = json.edits[0].changes.find(c => c.prop === 'padding-top')
T('5.5.6', json.schema >= 6 && jsonTop.important === true && jsonTop.to === '40px',
  `JSON SCHEMA_VERSION=${json.schema}，important 是独立字段往返（to="${jsonTop.to}" important=${jsonTop.important}）`)

const roundTrip = await page.evaluate(data => {
  const s = window.__visualRevise.store
  s.undoEverything(); s.clear(); s.history.clear()
  const before = document.getElementById('imp').getAttribute('style')
  const r = window.__visualRevise.lib.importJSON(data)
  const el = document.getElementById('imp')
  return { ok: r.ok, before, v: el.style.getPropertyValue('padding-top'),
           p: el.style.getPropertyPriority('padding-top'),
           bottomP: el.style.getPropertyPriority('padding-bottom') }
}, json)
T('5.5.6', roundTrip.ok && !roundTrip.before && roundTrip.v === '40px'
  && roundTrip.p === 'important' && roundTrip.bottomP === '',
  `清空后导入同一份 JSON，important 逐条还原（padding-top !${roundTrip.p}，padding-bottom priority="${roundTrip.bottomP}"）`)

const schemas = await page.evaluate(() => ({
  v1: window.__visualRevise.lib.importJSON({ schema: 1, edits: [] }).ok,
  v4: window.__visualRevise.lib.importJSON({ schema: 4, edits: [] }).ok,
  v5: window.__visualRevise.lib.importJSON({ schema: 5, edits: [] }).ok,
  v6: window.__visualRevise.lib.importJSON({ schema: 6, edits: [] }).ok,
  v7: window.__visualRevise.lib.importJSON({ schema: 7, edits: [] }),
}))
// schema 6 是替换记录（replaced 字段）带来的升版；比当前更高的仍要挡下
T('5.5.6', schemas.v1 === true && schemas.v4 === true && schemas.v5 === true && schemas.v6 === true
  && schemas.v7.ok === false && /schema=7/.test(schemas.v7.reason),
  `SUPPORTED 收 1–6（v1=${schemas.v1} v4=${schemas.v4} v5=${schemas.v5} v6=${schemas.v6}），更高的挡下并说明原因：「${schemas.v7.reason}」`)

// ── 覆盖自检 ──
const ALL = [
  '5.1.1', '5.1.2', '5.1.3', '5.1.4', '5.1.5', '5.1.6', '5.1.7', '5.1.8',
  '5.1.9', '5.1.10', '5.1.11', '5.1.12', '5.1.13', '5.1.14', '5.1.15', '5.1.16',
  '5.2.1', '5.2.2', '5.2.3', '5.2.4', '5.2.5',
  '5.3.1', '5.3.2',
  '5.4.1', '5.4.2', '5.4.3', '5.4.4', '5.4.5',
  '5.5.1', '5.5.2', '5.5.3', '5.5.4', '5.5.5', '5.5.6',
]
const missing = ALL.filter(id => !covered.has(id))
ok(missing.length === 0, `覆盖自检：${ALL.length} 个功能点全部有断言${missing.length ? `（缺 ${missing.join('、')}）` : ''}`)

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
