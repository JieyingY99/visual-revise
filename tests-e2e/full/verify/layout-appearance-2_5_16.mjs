// 独立复现脚本 · 清单 2.5.16
// 「四边联动锁开启后改任一边，整体一次 batch」——报告称实际落了两条历史，
// 一次撤销退不回联动前，留下非对称中间态。
// 全程真实鼠标点击（page.mouse / locator.click），不用 element.click() / dispatchEvent。
//
// 注意 history.js 的 MERGE_WINDOW = 400ms：同元素同属性、间隔 <400ms 的
// 单 op 会被合并。锁开启时本身也会给 padding-left 落一条单 op 记录，
// 所以测 depth 增量前必须先静置 >400ms，否则合并会把增量伪装成 +1。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const P = sel => page.locator(`visual-revise-panel ${sel}`)

const SIDES = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']

const styles = (id, props) => page.evaluate(([i, ps]) => {
  const s = document.getElementById(i).style
  return Object.fromEntries(ps.map(p => [p, s.getPropertyValue(p)]))
}, [id, props])

const hist = () => page.evaluate(() => {
  const h = window.__visualRevise.store.history
  return { depth: h.depth, undoLabel: h.undoLabel, canUndo: h.canUndo }
})

const select = async id => {
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  await page.locator(`#${id}`).click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(500)
}

// 真实点击：滚进视口 → 定位中心 → mouse.down/up
const realClick = async loc => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(320)
}

const typeInto = async (sel, text) => {
  const loc = P(sel)
  await loc.scrollIntoViewIfNeeded()
  await loc.fill(text)
  await loc.press('Enter')
  await page.waitForTimeout(400)
}

await page.goto(`${origin}/full/fixtures/layout-appearance.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

console.log('\n=== 2.5.16 四边联动锁 · 独立复现 ===\n')

await select('pad')
console.log('初始 inline      :', JSON.stringify(await styles('pad', SIDES)))

// 步骤 2：展开四边
await realClick(P('.expand-sides[data-kind="padding"]'))

// 被编辑的那个输入框到底挂了哪些属性——两个 change 处理器同时命中的前提
const inputAttrs = await page.evaluate(() => {
  const el = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('input[data-prop="padding-left"]')
  return el ? { prop: el.dataset.prop, hasDataSide: el.hasAttribute('data-side') } : null
})
console.log('padding-left 框  :', JSON.stringify(inputAttrs))

// 步骤 3：开启联动锁（把「上」的 10px 同步进四边）
await realClick(P('.lock[data-lock="padding"]'))
console.log('锁开后 inline    :', JSON.stringify(await styles('pad', SIDES)))
const hLock = await hist()
console.log('锁开后 depth =', hLock.depth, ' undoLabel =', JSON.stringify(hLock.undoLabel),
  '  ← 锁本身没包 batch，两条改动落了两条记录')

// 静置越过 MERGE_WINDOW(400ms)，让接下来的 depth 增量是干净的
await page.waitForTimeout(700)

// 步骤 4：记 depth
const h0 = await hist()
console.log('\n[编辑前] depth =', h0.depth, ' undoLabel =', JSON.stringify(h0.undoLabel))

// 步骤 5：在 padding-left 里键入 30 并回车
await typeInto('input[data-prop="padding-left"]', '30')

// 步骤 6：再读 depth
const h1 = await hist()
const afterEdit = await styles('pad', SIDES)
console.log('[编辑后] depth =', h1.depth, ' undoLabel =', JSON.stringify(h1.undoLabel))
console.log('[编辑后] inline  :', JSON.stringify(afterEdit))
const delta = h1.depth - h0.depth
console.log(`==> depth 增量 = ${delta}（期望 1 = 整体一次 batch）`)

// 步骤 7：真实点击工具条撤销一次
await realClick(page.locator('visual-revise-toolbar .undo'))
const afterUndo = await styles('pad', SIDES)
const h2 = await hist()
console.log('\n[撤销一次后] inline:', JSON.stringify(afterUndo))
console.log('[撤销一次后] depth =', h2.depth, ' undoLabel =', JSON.stringify(h2.undoLabel))

const vals = SIDES.map(p => afterUndo[p])
const allTen = vals.every(v => v === '10px')
const asymmetric = new Set(vals).size > 1
console.log(`==> 一次撤销回到联动前（四边都 10px）? ${allTen}`)
console.log(`==> 出现非对称中间态? ${asymmetric}   四边 = ${JSON.stringify(vals)}`)

// 再撤一次
await realClick(page.locator('visual-revise-toolbar .undo'))
console.log('[再撤一次后] inline:', JSON.stringify(await styles('pad', SIDES)))

console.log(`\n==> BUG 成立判定（depth +2 且一次撤销后非对称）: ${delta === 2 && asymmetric}`)

// ── 对照组 A：紧挨着锁点击（不静置）再编辑，看合并窗口如何伪装 depth
console.log('\n--- 对照组 A：锁刚开就立刻编辑（不越过 400ms 合并窗口）---')
await select('pad')
await realClick(P('.expand-sides[data-kind="padding"]'))
const lockOnA = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('.lock[data-lock="padding"]').hasAttribute('data-on'))
if (!lockOnA) await realClick(P('.lock[data-lock="padding"]'))
const a0 = await hist()
await typeInto('input[data-prop="padding-left"]', '55')
const a1 = await hist()
console.log(`对照组 A depth: ${a0.depth} → ${a1.depth}  增量 = ${a1.depth - a0.depth}`)
await realClick(page.locator('visual-revise-toolbar .undo'))
const aUndo = await styles('pad', SIDES)
console.log('对照组 A 撤销一次后:', JSON.stringify(aUndo),
  ` 非对称? ${new Set(SIDES.map(p => aUndo[p])).size > 1}`)

// ── 对照组 B：关掉联动锁，同一个框做同样的编辑，depth 应当只 +1 且撤销干净
console.log('\n--- 对照组 B：关掉联动锁后，同一个框键入 44 ---')
await select('pad')
await realClick(P('.expand-sides[data-kind="padding"]'))
const lockOnB = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('.lock[data-lock="padding"]').hasAttribute('data-on'))
console.log('对照组 B 开始时 锁 data-on =', lockOnB)
if (lockOnB) await realClick(P('.lock[data-lock="padding"]'))
await page.waitForTimeout(700)

const b0 = await hist()
const bBefore = await styles('pad', SIDES)
await typeInto('input[data-prop="padding-left"]', '44')
const b1 = await hist()
console.log(`对照组 B depth: ${b0.depth} → ${b1.depth}  增量 = ${b1.depth - b0.depth}（期望 1）`)
console.log('对照组 B 编辑后:', JSON.stringify(await styles('pad', SIDES)))
await realClick(page.locator('visual-revise-toolbar .undo'))
const bUndo = await styles('pad', SIDES)
console.log('对照组 B 撤销一次后:', JSON.stringify(bUndo))
console.log('==> 锁关闭时一次撤销就干净:', JSON.stringify(bUndo) === JSON.stringify(bBefore))

await browser.close(); await close()
