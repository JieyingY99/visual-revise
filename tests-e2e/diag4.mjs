import { serve, launch, injectVisBug } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
await page.goto(origin)
await injectVisBug(page, origin)
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)

console.log('targets 数量:', await page.evaluate(() =>
  window.__visualRevise.panel.target?.tagName))

// 手动 dispatch（非 Playwright 交互）
console.log('手动 dispatch change 到 opacity:', await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const i = sr.querySelector('input[data-prop="opacity"]')
  i.value = '0.5'
  i.dispatchEvent(new Event('change', { bubbles: true }))
  return document.querySelectorAll('.curve-card')[1].style.opacity
}))

// Playwright fill 前后对比 target 是否还在
await page.locator('visual-revise-panel input[data-prop="border-radius"]').fill('12px')
console.log('fill 后 target:', await page.evaluate(() => window.__visualRevise.panel.target?.tagName))
console.log('fill 后 input 还在吗:', await page.evaluate(() =>
  !!document.querySelector('visual-revise-panel').shadowRoot.querySelector('input[data-prop="border-radius"]')))
await page.locator('visual-revise-panel input[data-prop="border-radius"]').press('Enter')
await page.waitForTimeout(200)
console.log('Enter 后 target:', await page.evaluate(() => window.__visualRevise.panel.target?.tagName))
console.log('Enter 后 style:', await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].style.cssText))
await browser.close(); await close()
