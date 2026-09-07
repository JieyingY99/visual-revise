// 独立复现脚本 · 清单 5.1.16（改动记录面板的列表区滚动 / 滚轮）
//
// 报告称：改动记录条目一多，.items 不出现纵向滚动，行高被均分压扁到几像素，
// 内容被 .item 的 overflow:hidden 裁掉，滚轮也因此完全无效。
// 怀疑：app/components/change-list/change-list.element.css:65 的
//       `.items{display:grid; align-content:start}` + `:69-75` 的 `.item{overflow:hidden}`
//       让 min-height:auto 解析为 0，负剩余空间时行按 0 基准被压缩；
//       app/core/dom-utils.js:58 的 containScroll 里 max<=0 直接 return。
//
// 期望依据：
//   - docs/plans/feature-inventory.md 5.1.16「列表内滚轮不穿透」——`containScroll`
//     的注释（dom-utils.js:47-51）写的是「滚轮应该滚浮层」，即浮层自己要能滚。
//   - docs/PRD.md AC-8.1 改动记录列表要能按元素分组浏览；AC-2.15 对结构树写明
//     「树可纵向滚动」。PRD / 代码注释里没有任何地方把「行高被压扁」写成有意设计。
//
// 本脚本不复用 tests-e2e/full/history-changes.mjs 的任何断言，全部自己重新测；
// 全程真实指针（locator.click / page.mouse.wheel），不用 element.click() / dispatchEvent。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/history-changes-lab.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const log = (...a) => console.log(...a)

await page.goto(FIXTURE)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

log('\n=== 5.1.16 改动记录列表的滚动 / 滚轮 · 独立复现 ===\n')

const settle = () => page.evaluate(() =>
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

// 真实点工具条上的「改动记录」按钮打开列表
await page.locator('visual-revise-toolbar .list').click()
await page.waitForTimeout(400)
log('[列表已打开] hidden =',
  await page.evaluate(() => document.querySelector('visual-revise-list').hidden))

const addComments = n => page.evaluate(k => {
  const s = window.__visualRevise.store
  const ttl = document.getElementById('ttl')
  const base = s.stats().comments
  for (let i = 0; i < k; i++) s.addComment(ttl, `占位评论 ${base + i + 1}`)
}, n)

// 一次量清楚：容器能不能滚、行有多高、行里的内容自然要多高、按钮还在不在框里
const measure = () => page.evaluate(() => {
  const root = document.querySelector('visual-revise-list').shadowRoot
  const items = root.querySelector('.items')
  const rows = [...root.querySelectorAll('.item')]
  const cs = getComputedStyle(items)
  const first = rows[0]
  const head = first?.querySelector('.item-head')
  const del = first?.querySelector('.del-comment')
  const r = el => { const b = el.getBoundingClientRect(); return { y: +b.y.toFixed(1), h: +b.height.toFixed(1) } }
  const ib = items.getBoundingClientRect()

  // × 按钮的中心点落在哪一层？（被裁掉的话 shadow 命中的不会是这个按钮）
  let hit = null, inView = null
  if (del) {
    const b = del.getBoundingClientRect()
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    inView = b.height > 0 && cy >= ib.y && cy <= ib.y + ib.height
    const top = root.elementFromPoint(cx, cy)
    hit = top ? top.tagName.toLowerCase() + '.' + (top.className || '') : 'nothing'
  }

  return {
    count: rows.length,
    display: cs.display, overflowY: cs.overflowY, alignContent: cs.alignContent,
    scrollHeight: items.scrollHeight, clientHeight: items.clientHeight,
    canScroll: items.scrollHeight - items.clientHeight,
    firstItemH: first ? r(first).h : null,
    firstHeadH: head ? r(head).h : null,          // 头部自然高度（被裁前）
    firstItemScrollH: first ? first.scrollHeight : null,  // 行内内容真正需要的高度
    delBtnInViewport: inView,
    delBtnHit: hit,
  }
})

const wheelTest = async () => {
  const box = await page.evaluate(() => {
    const b = document.querySelector('visual-revise-list').shadowRoot
      .querySelector('.items').getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(120)
  await page.mouse.move(box.x, box.y)
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(350)
  return page.evaluate(() => ({
    listScrollTop: document.querySelector('visual-revise-list').shadowRoot
      .querySelector('.items').scrollTop,
    pageScrollY: window.scrollY,
  }))
}

// ── A. 少量条目：基线 ──────────────────────────────────
log('--- A. 3 条（基线）---')
await addComments(3)
await settle()
const a = await measure()
log('[3 条]', JSON.stringify(a))

// ── B. 中等条目：开始出现压缩 ─────────────────────────
log('\n--- B. 12 条 ---')
await addComments(9)
await settle()
const b = await measure()
log('[12 条]', JSON.stringify(b))

// ── C. 大量条目：报告说的那一档 ───────────────────────
log('\n--- C. 40 条 ---')
await addComments(28)
await settle()
const c = await measure()
log('[40 条]', JSON.stringify(c))

log('\n--- D. 40 条时在列表上滚轮 ---')
const d = await wheelTest()
log('[滚轮后]', JSON.stringify(d))

// ── E. 对照：只给 .item 补 min-height:max-content（不改仓库文件，运行时注入）──
log('\n--- E. 对照组：运行时给 .item 注入 min-height:max-content ---')
await page.evaluate(() => {
  const root = document.querySelector('visual-revise-list').shadowRoot
  const s = document.createElement('style')
  s.id = '__probe'
  s.textContent = '.item { min-height: max-content; }'
  root.appendChild(s)
})
await settle()
const e = await measure()
log('[打补丁后]', JSON.stringify(e))
const e2 = await wheelTest()
log('[打补丁后滚轮]', JSON.stringify(e2))

// ── F. 对照：把补丁摘掉，确认压缩会回来（排除「只是渲染时机」）──
log('\n--- F. 摘掉补丁 ---')
await page.evaluate(() => document.querySelector('visual-revise-list')
  .shadowRoot.getElementById('__probe')?.remove())
await settle()
const f = await measure()
log('[摘掉后]', JSON.stringify(f))

// ── G. 真实鼠标点第一条的 ×：40 条压扁态 vs 3 条正常态 ──
const seqs = () => page.evaluate(() =>
  window.__visualRevise.store.read().comments.map(c => c.seq))

const clickFirstDel = async () => {
  const box = await page.evaluate(() => {
    const b = document.querySelector('visual-revise-list').shadowRoot
      .querySelector('.item .del-comment').getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  await page.mouse.move(box.x, box.y)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(400)
}

log('\n--- G. 压扁态下真实点第一条的 × ---')
const gBefore = await seqs()
await clickFirstDel()
const gAfter = await seqs()
const gDeleted = gBefore.filter(s => !gAfter.includes(s))
log(`[40 条] 点前 ${gBefore.length} 条 → 点后 ${gAfter.length} 条，被删掉的是 #${gDeleted.join(',') || '（无）'}（本该是 #${gBefore[0]}）`)

log('\n--- H. 对照：把评论减到 3 条，同样真实点第一条的 × ---')
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.read().comments.slice(3).forEach(c => s.removeComment(c.id))
})
await settle()
const h0 = await measure()
log('[3 条时]', JSON.stringify(h0))
const hBefore = await seqs()
await clickFirstDel()
const hAfter = await seqs()
const hDeleted = hBefore.filter(s => !hAfter.includes(s))
log(`[3 条] 点前 ${hBefore.length} 条 → 点后 ${hAfter.length} 条，被删掉的是 #${hDeleted.join(',') || '（无）'}（本该是 #${hBefore[0]}）`)

log('\n================ 结论 ================')
log('A 3 条   行高 / 可滚距离      :', a.firstItemH, '/', a.canScroll)
log('B 12 条  行高 / 可滚距离      :', b.firstItemH, '/', b.canScroll)
log('C 40 条  行高 / 可滚距离      :', c.firstItemH, '/', c.canScroll)
log('C 40 条  行内内容需要的高度   :', c.firstItemScrollH, '（头部单独就要', c.firstHeadH, '）')
log('C 40 条  × 按钮还在可视区内   :', c.delBtnInViewport, '命中：', c.delBtnHit)
log('D 40 条  滚轮后 列表/页面     :', d.listScrollTop, '/', d.pageScrollY)
log('E 补丁后 行高 / 可滚距离      :', e.firstItemH, '/', e.canScroll, ' 滚轮后 listScrollTop =', e2.listScrollTop)
log('F 摘掉后 行高 / 可滚距离      :', f.firstItemH, '/', f.canScroll)
log('G 40 条压扁态点第一条 ×       :', `${gBefore.length}→${gAfter.length} 条，删掉 #${gDeleted.join(',') || '无'}（应为 #${gBefore[0]}）`)
log('H 3 条正常态点第一条 ×        :', `${hBefore.length}→${hAfter.length} 条，删掉 #${hDeleted.join(',') || '无'}（应为 #${hBefore[0]}）`)
log('容器计算样式                  :', c.display, c.overflowY, c.alignContent)
log('=====================================\n')

await browser.close(); await close()
