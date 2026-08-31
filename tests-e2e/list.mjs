import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[改动列表测试]\n')
await page.goto(origin)
await injectVisBug(page, origin)

// 造几条改动
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const card  = document.querySelectorAll('.curve-card')[1]
  const title = document.querySelector('.hero-title')
  s.track(card); s.track(title)
  s.applyProp(card, 'border-radius', '12px')
  s.applyProp(card, 'padding-top', '24px')
  s.applyProp(title, 'font-size', '56px')
  s.addComment(card, '鼠标移入时上浮并变亮')
})
await page.waitForTimeout(200)

// 打开列表
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.locator('visual-revise-panel .list').click()
await page.waitForTimeout(300)

ok(!(await page.locator('visual-revise-list').getAttribute('hidden')), '点击「记录」打开列表')

const items = await page.locator('visual-revise-list .item').count()
ok(items === 3, `列表渲染 ${items} 项（2 个元素 + 1 条评论）`)

const allTab = await page.locator('visual-revise-list .tabs button[data-tab="all"]').textContent()
ok(allTab.includes('4'), `全部标签计数：${allTab.trim()}`)

// tab 过滤
await page.locator('visual-revise-list .tabs button[data-tab="comment"]').click()
await page.waitForTimeout(200)
const commentOnly = await page.locator('visual-revise-list .item').count()
ok(commentOnly === 1, `评论标签只显示评论（${commentOnly} 项）`)
ok((await page.locator('visual-revise-list .comment-text').textContent()).includes('上浮'), '评论内容正确')

await page.locator('visual-revise-list .tabs button[data-tab="all"]').click()
await page.waitForTimeout(200)

// hover 高亮
await page.locator('visual-revise-list .item').first().hover()
await page.waitForTimeout(300)
const overlay = await page.evaluate(() => {
  const el = document.getElementById('visual-revise-locate-overlay')
  return el ? { display: el.style.display, width: el.style.width } : null
})
ok(overlay?.display === 'block', `hover 列表项高亮页面元素（overlay ${overlay?.width}）`)

// 单条属性撤销
await page.locator('visual-revise-list .undo-prop[data-prop="border-radius"]').click()
await page.waitForTimeout(300)
const afterUndoProp = await page.evaluate(() =>
  getComputedStyle(document.querySelectorAll('.curve-card')[1]).borderRadius)
ok(afterUndoProp === '18px', `单条撤销还原：border-radius = ${afterUndoProp}`)

const remaining = await page.evaluate(() => window.__visualRevise.store.stats())
ok(remaining.props === 2, `撤销后剩 ${remaining.props} 项属性改动`)

// 点击定位并选中
await page.locator('visual-revise-list .item[data-kind="style"]').first().click()
await page.waitForTimeout(400)
const located = await page.locator('visual-revise-panel .tag').textContent()
ok(located.includes('curve-card') || located.includes('hero-title'),
   `点击列表项定位并选中元素：${located}`)

// 删除评论
await page.locator('visual-revise-list .del-comment').click()
await page.waitForTimeout(300)
ok((await page.evaluate(() => window.__visualRevise.store.stats())).comments === 0, '删除评论生效')

// 全部重置
await page.locator('visual-revise-list .reset').click()
await page.waitForTimeout(300)
const afterReset = await page.evaluate(() => ({
  stats: window.__visualRevise.store.stats(),
  cardStyle: document.querySelectorAll('.curve-card')[1].getAttribute('style'),
  titleSize: getComputedStyle(document.querySelector('.hero-title')).fontSize,
}))
ok(afterReset.stats.total === 0, '重置后记录清空')
ok(afterReset.titleSize === '40px', `重置后页面还原：font-size = ${afterReset.titleSize}`)

// ── 回归：外部撤销后面板字段必须回读真实值 ──
// force：此时选中框覆盖层还在，Playwright 的可操作性检查会拒绝点击，
// 而真实用户点击时 VisBug 用 deepElementFromPoint 能穿透覆盖层
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 }, force: true })
await page.waitForTimeout(400)

const radius = page.locator('visual-revise-panel input[data-prop="border-radius"]')
await radius.fill('30px')
await radius.dispatchEvent('change')
await page.waitForTimeout(300)
const afterEdit = await radius.inputValue()

// 从面板之外触发撤销（reset 按钮的点击路径已由上面的用例覆盖，
// 这里要验证的是面板对外部 store 变更的响应）
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(400)

// 聚焦中的字段在同步时被有意跳过；失焦后应补上
const focusedStill = await radius.inputValue()
await page.evaluate(() => document.activeElement?.blur?.())
await page.waitForTimeout(300)

const afterReset2 = await radius.inputValue()
const realValue = await page.evaluate(() =>
  getComputedStyle(document.querySelectorAll('.curve-card')[1]).borderRadius)

ok(afterEdit === '30px', `改动后字段显示新值：${afterEdit}`)
ok(focusedStill === '30px',
   `外部撤销时不打断正在编辑的字段（仍显示 ${focusedStill}）`)
ok(afterReset2 === realValue,
   `字段失焦后回读真实值：字段=${afterReset2} 实际=${realValue}`)

const dirtyLeft = await page.locator('visual-revise-panel label.name[data-dirty]').count()
ok(dirtyLeft === 0, `重置后 dirty 标记已清空（${dirtyLeft} 个）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
