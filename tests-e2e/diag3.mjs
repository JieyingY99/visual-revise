import { serve, launch, injectVisBug } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
await page.goto(origin)
await injectVisBug(page, origin)
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)

console.log('面板几何:', await page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  const r = p.getBoundingClientRect()
  const cs = getComputedStyle(p)
  return { top: r.top, bottom: r.bottom, height: r.height,
           maxHeight: cs.maxHeight, display: cs.display, viewportH: innerHeight }
}))

console.log('footer 几何:', await page.evaluate(() => {
  const f = document.querySelector('visual-revise-panel').shadowRoot.querySelector('footer')
  const r = f.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, viewportH: innerHeight }
}))

// 验证 change vs input 事件
console.log('--- 事件测试 ---')
const evented = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const input = sr.querySelector('input[data-prop="border-radius"]')
  const log = []
  input.addEventListener('input',  () => log.push('input'))
  input.addEventListener('change', () => log.push('change'))
  input.value = '12px'
  input.dispatchEvent(new Event('input',  { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return { log, styleAfter: document.querySelectorAll('.curve-card')[1].style.borderRadius }
})
console.log('手动派发 change:', evented)

// Playwright fill 会触发哪些事件？
const viaFill = await page.evaluate(() => {
  window.__evlog = []
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const input = sr.querySelector('input[data-prop="opacity"]')
  input.addEventListener('input',  () => window.__evlog.push('input'))
  input.addEventListener('change', () => window.__evlog.push('change'))
  return true
})
await page.locator('visual-revise-panel input[data-prop="opacity"]').fill('0.5')
console.log('fill 触发的事件:', await page.evaluate(() => window.__evlog))
await page.locator('visual-revise-panel input[data-prop="opacity"]').press('Enter')
console.log('fill+Enter 后事件:', await page.evaluate(() => window.__evlog))
console.log('opacity 写入结果:', await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].style.opacity))

await browser.close(); await close()
