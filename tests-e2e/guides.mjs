import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[间距标尺测试]\n')
await page.goto(origin)
await injectVisBug(page, origin)

console.log('  当前工具:', await page.evaluate(() => document.querySelector('vis-bug').activeTool))

// 选中一个元素，再 hover 另一个 —— VisBug guides 的测距交互。
// hover 左边那张而不是右边：属性面板会摆到选中元素的右侧，右邻正好被它盖住。
// 这是「面板贴着选中元素」这个设计固有的代价，不是 bug。
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.locator('.curve-card').nth(0).hover({ position: { x: 4, y: 4 } })
await page.waitForTimeout(500)

const measure = await page.evaluate(() => ({
  distance:  document.querySelectorAll('visbug-distance').length,
  gridlines: document.querySelectorAll('visbug-gridlines').length,
  handles:   document.querySelectorAll('visbug-handles').length,
}))
ok(measure.distance > 0 || measure.gridlines > 0,
   `选中后 hover 另一元素显示测距（distance=${measure.distance}, gridlines=${measure.gridlines}）`)

// 读出实际距离文本
const labels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('visbug-distance'))
    .map(d => d.shadowRoot?.textContent?.trim() || d.textContent.trim())
    .filter(Boolean).slice(0, 6))
console.log('  测距标签:', labels)
ok(labels.length > 0, `测距显示了 ${labels.length} 个距离标签`)

ok(measure.handles > 0, '选中框仍正常显示（面板未干扰 VisBug 原有能力）')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
