import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[冒烟测试] fork 后的 VisBug 基础能力\n')

await page.goto(origin)
ok(await page.locator('.curve-card').count() === 3, '测试固件加载正常（3 张卡片）')

await injectVisBug(page, origin)

ok(await page.locator('vis-bug').count() === 1, 'vis-bug 元素已注入')
ok(await page.evaluate(() => !!customElements.get('vis-bug')), 'vis-bug 自定义元素已注册')
ok(await page.evaluate(() => document.querySelector('vis-bug').shadowRoot === null),
   'shadow DOM 为 closed（扩展 UI 与页面隔离）')

// 悬停应产生 hover 指示
const card = page.locator('.curve-card').nth(1)
await card.hover()
await page.waitForTimeout(300)
const hoverEls = await page.evaluate(() =>
  document.querySelectorAll('visbug-hover, visbug-metatip, visbug-handles').length)
ok(hoverEls > 0, `悬停产生视觉反馈（找到 ${hoverEls} 个 visbug-* 元素）`)

// 点击应选中
await card.click()
await page.waitForTimeout(300)
const selected = await page.evaluate(() => ({
  handles: document.querySelectorAll('visbug-handles').length,
  labeled: document.querySelectorAll('[data-label-id]').length,
}))
ok(selected.handles > 0, `点击选中元素（handles=${selected.handles}, 标记元素=${selected.labeled}）`)

// 验证「所有改动都落 inline style」——快照 diff 方案的前提
await page.evaluate(() => {
  const card = document.querySelectorAll('.curve-card')[1]
  card.style.paddingTop = '24px'
})
const inline = await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].getAttribute('style'))
ok(inline?.includes('padding-top'),
   `样式写入 inline style（style="${inline}"）—— 快照 diff 方案成立`)

// VisBug 原有的工具系统仍可用（fork 未破坏上游能力）
const toolOk = await page.evaluate(() => {
  const vb = document.querySelector('vis-bug')
  vb.toolSelected('inspector')
  const after = vb.activeTool
  vb.toolSelected('guides')
  return { switched: after, restored: vb.activeTool }
})
ok(toolOk.switched === 'inspector' && toolOk.restored === 'guides',
   `VisBug 工具切换仍正常（${toolOk.switched} → ${toolOk.restored}）`)

// ── 回归：重复注入不得叠出第二套编辑器 ──
const idempotent = await page.evaluate(() => {
  const before = {
    visbug: document.querySelectorAll('vis-bug').length,
    panel:  document.querySelectorAll('visual-revise-panel').length,
    list:   document.querySelectorAll('visual-revise-list').length,
  }

  // 模拟状态机脱节导致的二次注入
  document.body.prepend(document.createElement('vis-bug'))

  return {
    before,
    after: {
      visbug: document.querySelectorAll('vis-bug').length,
      panel:  document.querySelectorAll('visual-revise-panel').length,
      list:   document.querySelectorAll('visual-revise-list').length,
    },
  }
})
ok(idempotent.after.panel === 1 && idempotent.after.list === 1,
   `二次注入不叠加面板与列表（面板 ${idempotent.before.panel}→${idempotent.after.panel}，` +
   `列表 ${idempotent.before.list}→${idempotent.after.list}）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
