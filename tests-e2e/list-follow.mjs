// 改动列表跟着选中：选中元素 → 它的条目高亮并滚进可见区；换选移走；取消选中清掉；
// 列表关着时选中，打开后再高亮并滚到位；记录变化引起的重渲染不抢滚动
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('[pageerror]', e.message))
console.log('\n[改动列表联动选中测试]\n')
await page.goto(origin); await injectVisBug(page, origin); await page.waitForTimeout(300)

// 给 12 个元素各造一条改动，列表长到要滚；最后一个是 .hero-title
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const els = [...document.querySelectorAll('.curve-card, .card-title, .card-body, .card-tag, .hero-bar, .hero-bar *')].slice(0, 15)
  els.forEach((el, i) => { s.track(el); s.applyProp(el, 'padding-top', `${10 + i}px`) })
  const t = document.querySelector('.hero-title'); s.track(t); s.applyProp(t, 'letter-spacing', '0.1em')
})
await page.waitForTimeout(200)
const state = () => page.evaluate(() => {
  const list = document.querySelector('visual-revise-list')
  const r = list.shadowRoot
  const box = r.querySelector('.items'); const b = box.getBoundingClientRect()
  const sel = [...r.querySelectorAll('.item[data-selected]')]
  return { hidden: list.hidden, count: r.querySelectorAll('.item').length, selected: sel.length,
    scrollTop: box.scrollTop, scrollable: box.scrollHeight > box.clientHeight,
    visible: sel.map(it => { const q = it.getBoundingClientRect(); return q.top >= b.top - 1 && q.bottom <= b.bottom + 1 }),
    names: sel.map(it => it.querySelector('.name, .item-head')?.textContent.trim().slice(0, 40)) }
})

// 列表关着时选中 hero-title（它的条目在最底下）
await page.locator('.hero-title').click(); await page.waitForTimeout(400)
// 打开列表
await page.locator('visual-revise-toolbar button.list').click()
await page.waitForTimeout(400)
const s1 = await state()
ok(!s1.hidden && s1.count >= 12 && s1.scrollable, `列表打开，${s1.count} 条，超出高度可滚`)
ok(s1.selected === 1 && s1.visible[0], `打开时按当前选中高亮 1 条并滚进可见区（scrollTop=${Math.round(s1.scrollTop)}，${s1.names[0]}）`)

// 换选第一张卡片（条目在最上面）：高亮移过去、滚回顶部
await page.locator('.curve-card').first().click({ position: { x: 20, y: 10 } }); await page.waitForTimeout(400)
const s2 = await state()
ok(s2.selected === 1 && s2.visible[0] && s2.scrollTop < s1.scrollTop, `换选后高亮移到新元素并滚到可见（scrollTop ${Math.round(s1.scrollTop)}→${Math.round(s2.scrollTop)}）`)

// 记录变化（再改一个属性）：高亮还在，列表不抢滚动
await page.evaluate(() => { const box = document.querySelector('visual-revise-list').shadowRoot.querySelector('.items'); box.scrollTop = 200 })
await page.waitForTimeout(100)
await page.evaluate(() => { const s = window.__visualRevise.store; const el = document.querySelector('.curve-card'); s.applyProp(el, 'padding-top', '99px') })
await page.waitForTimeout(300)
const s3 = await state()
ok(s3.selected === 1 && Math.abs(s3.scrollTop - 200) < 2, `记录变化后重渲染：高亮保留、滚动位置不动（scrollTop=${Math.round(s3.scrollTop)}）`)

// 取消选中：清掉
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
const s4 = await state()
ok(s4.selected === 0, '取消选中后没有高亮条目')

// 没有改动的元素：无高亮
await page.locator('.hero-eyebrow').click({ position: { x: 10, y: 5 } }); await page.waitForTimeout(400)
const s5 = await state()
ok(s5.selected === 0, '选中没有改动记录的元素：列表里没有高亮')

// 评论条目：点它打开的是那条评论的编辑框，不是属性面板
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await page.evaluate(() => { const s = window.__visualRevise.store; s.addComment(document.querySelector('.hero-title'), '标题要再大一点') })
await page.waitForTimeout(300)
// 列表条目可能被工具条盖住一角，Playwright 的真实点击会被拦；条目只认 click，页内派发即可
await page.evaluate(() => document.querySelector('visual-revise-list').shadowRoot.querySelector('.item[data-kind="comment"]').click()); await page.waitForTimeout(500)
const c1 = await page.evaluate(() => {
  const layer = document.querySelector('visual-revise-comment-layer').shadowRoot
  const editor = layer.querySelector('.editor')
  return { editor: !!editor, text: editor?.textContent.trim() ?? editor?.value ?? null,
    panelHidden: document.querySelector('visual-revise-panel').hidden, selected: document.querySelectorAll('[data-selected]').length }
})
ok(c1.editor && /标题要再大一点/.test(c1.text || ''), `点评论条目：打开那条评论的编辑框（内容「${c1.text}」）`)
ok(c1.panelHidden && c1.selected === 0, `点评论条目：不选中元素、不打开属性面板（panel hidden=${c1.panelHidden}，选中 ${c1.selected}）`)
await page.locator('visual-revise-comment-layer .cancel').click(); await page.waitForTimeout(200)


// ─── E 组补测：5.1.17 高亮样式 / 5.1.18 只滚列表不滚页面 / 5.1.19 多选全亮 /
//                5.1.23 单向 / 5.1.25 非评论条目 / 2.14.1 + 2.14.3 间距 4px ───
console.log('\n[改动列表 · 补测] 高亮样式 / 只滚列表 / 多选 / 单向 / 条目分流 / 4px 间距\n')

const pageSel = () => page.evaluate(() => [...document.querySelectorAll('[data-selected]')]
  .filter(el => !el.tagName.startsWith('VISUAL-REVISE')).map(el => el.className).join('|'))

// ── 5.1.19：多选时这些元素的条目全亮 ──
await page.locator('.curve-card').nth(0).click({ position: { x: 20, y: 10 } }); await page.waitForTimeout(300)
await page.locator('.curve-card').nth(1).click({ position: { x: 20, y: 10 }, modifiers: ['Shift'] }); await page.waitForTimeout(500)
const s6 = await state()
ok(s6.selected === 2, `多选两个有改动的元素：列表里期望 2 组高亮（实际 ${s6.selected}）`)

// ── 5.1.17：高亮样式是蓝边 + inset 蓝边 + 淡蓝底 ──
const style = await page.evaluate(() => {
  const it = document.querySelector('visual-revise-list').shadowRoot.querySelector('.item[data-selected]')
  const cs = getComputedStyle(it)
  return { border: cs.borderTopColor, shadow: cs.boxShadow, bg: cs.backgroundColor }
})
ok(style.border === 'rgb(13, 153, 255)',
  `高亮条目边框期望蓝色 rgb(13, 153, 255)（实际 ${style.border}）`)
ok(/inset/.test(style.shadow) && /13,\s*153,\s*255/.test(style.shadow),
  `高亮条目带 inset 蓝边（期望 box-shadow 含 inset + 13,153,255，实际 ${style.shadow}）`)
ok(/rgba\(13,\s*153,\s*255,\s*0\.1\)/.test(style.bg),
  `高亮条目淡蓝底期望 rgba(13, 153, 255, 0.1)（实际 ${style.bg}）`)

// ── 5.1.18：滚的是列表自己的 scrollTop，页面不跟着滚 ──
// 先让页面真的能滚，并停在一个已知的位置
await page.evaluate(() => {
  if (!document.getElementById('vr-spacer')) {
    const d = document.createElement('div'); d.id = 'vr-spacer'; d.style.height = '1600px'
    document.querySelector('section.cards').after(d)
  }
  scrollTo(0, 300)
})
await page.waitForTimeout(300)
// 列表滚到底，再选一个条目在最上面的元素：列表该自己滚回去，页面不该动
await page.evaluate(() => { const box = document.querySelector('visual-revise-list').shadowRoot.querySelector('.items'); box.scrollTop = box.scrollHeight })
await page.waitForTimeout(200)
const beforeScroll = await page.evaluate(() => ({
  y: Math.round(scrollY),
  top: Math.round(document.querySelector('visual-revise-list').shadowRoot.querySelector('.items').scrollTop) }))
// 用引擎直接选中，避免 Playwright 的点击自己把页面滚走
await page.evaluate(() => {
  const e = document.querySelector('vis-bug').selectorEngine
  e.unselect_all(); e.select(document.querySelector('.hero-bar'))
})
await page.waitForTimeout(500)
const afterScroll = await page.evaluate(() => ({
  y: Math.round(scrollY),
  top: Math.round(document.querySelector('visual-revise-list').shadowRoot.querySelector('.items').scrollTop) }))
const s7 = await state()
ok(s7.selected === 1 && s7.visible[0] && afterScroll.top !== beforeScroll.top,
  `换选后列表自己滚到可见（scrollTop ${beforeScroll.top} → ${afterScroll.top}，高亮 ${s7.selected} 组、在可见区=${s7.visible[0]}）`)
ok(afterScroll.y === beforeScroll.y,
  `列表滚动没有把页面一起滚走（页面 scrollY 期望仍是 ${beforeScroll.y}，实际 ${afterScroll.y}）`)

// ── 5.1.23：只做「选中 → 列表」单向，列表里的 hover / 滚动不反过来改页面选中 ──
const selBefore = await pageSel()
await page.evaluate(() => {
  const r = document.querySelector('visual-revise-list').shadowRoot
  const items = [...r.querySelectorAll('.item')]
  const other = items.find(it => !it.hasAttribute('data-selected'))
  other.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
  r.querySelector('.items').scrollTop = 0
  r.querySelector('.items').dispatchEvent(new Event('scroll', { bubbles: true }))
})
await page.waitForTimeout(400)
const selAfter = await pageSel()
const s8 = await state()
ok(selAfter === selBefore && s8.selected === 1,
  `在列表里 hover 别的条目并滚动：页面选中期望不变（「${selBefore}」→「${selAfter}」）、高亮仍只有 1 组（实际 ${s8.selected}）`)

// ── 5.1.25：点非评论条目仍是选中元素 + 打开属性面板（不是打开评论编辑框）──
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await page.evaluate(() => { document.querySelector('visual-revise-panel').hidden = true })
const clicked = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-list').shadowRoot
  const it = [...r.querySelectorAll('.item')].find(x => x.dataset.kind === 'style')
  const sel = it.querySelector('.sel')?.textContent.trim() ?? ''
  it.click()
  return { kind: it.dataset.kind, sel }
})
await page.waitForTimeout(600)
const after = await page.evaluate(() => ({
  panelHidden: document.querySelector('visual-revise-panel').hidden,
  selected: [...document.querySelectorAll('[data-selected]')].filter(el => !el.tagName.startsWith('VISUAL-REVISE')).length,
  editor: !!document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor'),
}))
ok(after.selected === 1 && after.panelHidden === false,
  `点样式条目（${clicked.sel}）：期望选中元素 1 个、属性面板打开（实际 选中 ${after.selected} 个 / panel hidden=${after.panelHidden}）`)
ok(after.editor === false, `点样式条目不该打开评论编辑框（期望 false，实际 ${after.editor}）`)

// ── 2.14.3：改动列表与评论气泡的间距同步到 4px ──
// 评论气泡的编辑框是按需建的，先把它打开再量
await page.evaluate(() => document.querySelector('visual-revise-list').shadowRoot
  .querySelector('.item[data-kind="comment"]').click())
await page.waitForTimeout(500)
const gaps = await page.evaluate(() => {
  const read = (root, sel) => {
    const el = root.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    return `${cs.rowGap}/${cs.columnGap}`
  }
  const listRoot = document.querySelector('visual-revise-list').shadowRoot
  const cmtRoot = document.querySelector('visual-revise-comment-layer').shadowRoot
  // .ref-head 只在有配图的评论里才渲染，读它的规则声明
  const ruleGap = (root, sel) => {
    const css = [...root.querySelectorAll('style')].map(s => s.textContent).join('\n')
    const m = css.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{[^}]*?gap:\\s*([^;]+);'))
    return m ? m[1].trim() : null
  }
  return {
    items: read(listRoot, '.items'),
    itemHead: read(listRoot, '.item-head'),
    footer: read(listRoot, 'footer'),
    refs: read(cmtRoot, '.refs'),
    actions: read(cmtRoot, '.actions'),
    refHead: ruleGap(cmtRoot, '.ref-head'),
  }
})
await page.locator('visual-revise-comment-layer .cancel').click(); await page.waitForTimeout(200)
const four = v => v === '4px/4px'
ok(four(gaps.items) && four(gaps.itemHead) && four(gaps.footer),
  `改动列表间距 4px：.items 期望 4px/4px（实际 ${gaps.items}）、.item-head（${gaps.itemHead}）、footer（${gaps.footer}）`)
ok(four(gaps.refs) && four(gaps.actions) && gaps.refHead === '4px',
  `评论气泡间距 4px：.refs 期望 4px/4px（实际 ${gaps.refs}）、.actions（${gaps.actions}）、.ref-head 规则（${gaps.refHead}）`)

// ── 2.14.1：属性面板里那几行的 gap 同样是 4px ──
const panelGaps = await page.evaluate(() => {
  const root = document.querySelector('visual-revise-panel').shadowRoot
  const out = {}
  for (const sel of ['.pair', '.layers', '.dims', '.sides', '.limits', '.side-pair', 'header']) {
    const el = root.querySelector(sel)
    if (!el) continue
    const cs = getComputedStyle(el)
    out[sel] = `${cs.rowGap}/${cs.columnGap}`
  }
  return out
})
const found = Object.entries(panelGaps)
const bad = found.filter(([, v]) => v !== '4px/4px')
ok(found.length >= 3 && bad.length === 0,
  `属性面板全局间距 4px：量到 ${found.length} 处（${found.map(([k, v]) => k + '=' + v).join('，')}），期望全部 4px/4px，不合格 ${bad.length} 处`)


// ─── E 组补测（二）：5.1.18 滚到「中间」 / 5.1.24 评论条目把图片也带进编辑框 ───
{
console.log('\n[改动列表 · 补测二] 滚到中间 / 评论带图\n')

// 5.1.18：列表滚到顶，再选一个条目靠后的元素，它该被滚到列表可见区的正中
await page.evaluate(() => { document.querySelector('visual-revise-list').shadowRoot.querySelector('.items').scrollTop = 0 })
await page.waitForTimeout(200)
await page.evaluate(() => {
  const e = document.querySelector('vis-bug').selectorEngine
  e.unselect_all(); e.select(document.querySelectorAll('.curve-card')[1].querySelector('.card-body'))
})
await page.waitForTimeout(500)
const center = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-list').shadowRoot
  const box = r.querySelector('.items'), it = r.querySelector('.item[data-selected]')
  if (!it) return null
  const b = box.getBoundingClientRect(), q = it.getBoundingClientRect()
  return { delta: Math.round((q.top + q.height / 2) - (b.top + b.height / 2)),
    scrollTop: Math.round(box.scrollTop), maxScroll: Math.round(box.scrollHeight - box.clientHeight),
    idx: [...r.querySelectorAll('.item')].indexOf(it), n: r.querySelectorAll('.item').length }
})
ok(center && Math.abs(center.delta) <= 3,
  `不在可见区就把那一组滚到列表正中：条目中心与可见区中心的偏差期望 ≤3px（实际 ${center?.delta}px，第 ${center?.idx + 1}/${center?.n} 条，scrollTop=${center?.scrollTop}/${center?.maxScroll}）`)

// 5.1.24：带图的评论，点条目打开的编辑框里内容与图片都要带上
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
await page.evaluate(png => {
  window.__visualRevise.store.addComment(document.querySelector('.hero-eyebrow'), '这行想换成小标题',
    [{ id: 'vr-img-1', name: 'ref-shot.png', dataUrl: png, w: 1, h: 1, bytes: 70, note: '照这张的留白' }])
}, PNG)
await page.waitForTimeout(400)
const opened = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-list').shadowRoot
  const it = [...r.querySelectorAll('.item[data-kind="comment"]')]
    .find(x => /这行想换成小标题/.test(x.textContent))
  if (!it) return false
  it.click(); return true
})
await page.waitForTimeout(600)
const ed = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-comment-layer').shadowRoot
  const refs = r.querySelector('.refs')
  return {
    text: r.querySelector('.editor')?.textContent ?? '',
    refsHidden: refs ? refs.hidden : null,
    refCount: refs ? refs.querySelectorAll('.ref').length : 0,
    name: refs?.querySelector('.ref-name')?.textContent ?? '',
    thumb: (refs?.querySelector('.ref-thumb img')?.getAttribute('src') || '').slice(0, 22),
    note: refs?.querySelector('.ref-note')?.value ?? '',
  }
})
ok(opened && /这行想换成小标题/.test(ed.text),
  `点带图的评论条目：编辑框里带上原文（期望含「这行想换成小标题」，实际「${ed.text.trim().slice(0, 30)}」）`)
ok(ed.refsHidden === false && ed.refCount === 1 && ed.name === 'ref-shot.png' && ed.thumb.startsWith('data:image/png'),
  `点带图的评论条目：图片也带上（说明区期望可见 1 张、文件名 ref-shot.png、缩略图是 dataUrl；实际 hidden=${ed.refsHidden} / ${ed.refCount} 张 / 「${ed.name}」/ 「${ed.thumb}…」）`)
ok(ed.note === '照这张的留白',
  `图片上那句说明一起带回来（期望「照这张的留白」，实际「${ed.note}」）`)
await page.locator('visual-revise-comment-layer .cancel').click(); await page.waitForTimeout(200)
}


// ─── 5.1.19 边界：⇧ 把某个元素移出多选之后，它那组条目的高亮该跟着撤掉 ───
{
console.log('\n[改动列表 · 补测三] 移出多选后的高亮\n')
const lit = () => page.evaluate(() => [...document.querySelector('visual-revise-list').shadowRoot
  .querySelectorAll('.item[data-selected]')].map(it => it.querySelector('.sel')?.textContent.trim() ?? it.dataset.kind))
await page.locator('.curve-card').nth(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(300)
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(500)
const lit2 = await lit()
ok(lit2.length === 2, `两张卡都选中时：期望 2 组条目高亮（实际 ${lit2.length} 组：${lit2.join('、')}）`)
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(600)
const lit1 = await lit()
const domSel = await page.evaluate(() => document.querySelectorAll('.curve-card[data-selected]').length)
ok(lit1.length === 1,
  `⇧ 把第二张移出多选后（页面上只剩 ${domSel} 个 data-selected）：期望只剩 1 组高亮（实际 ${lit1.length} 组：${lit1.join('、')}）`)
}

console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
await browser.close(); await close()
