import { serve, launch, injectVisBug } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
await page.goto(origin)
await injectVisBug(page, origin)

const card = page.locator('.curve-card').nth(1)
await card.click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)

console.log('选中后 tag:', await page.locator('visual-revise-panel .tag').textContent())
console.log('选中数:', await page.evaluate(() => document.querySelectorAll('[data-selected]').length))
console.log('有 padding-top input:', await page.evaluate(() =>
  !!document.querySelector('visual-revise-panel').shadowRoot.querySelector('input[data-prop="padding-top"]')))
console.log('全部 input data-prop:', await page.evaluate(() =>
  Array.from(document.querySelector('visual-revise-panel').shadowRoot.querySelectorAll('input[data-prop]'))
    .map(i => i.dataset.prop).slice(0, 12)))

// 观察点击面板时 VisBug 看到的 target
await page.evaluate(() => {
  window.__seen = []
  document.body.addEventListener('click', e => {
    window.__seen.push({
      target: e.target.tagName,
      composedFirst: e.composedPath()[0]?.tagName,
    })
  }, true)
})
await page.locator('visual-revise-panel header .tag').click({ force: true })
await page.waitForTimeout(300)
console.log('点击面板时 body capture 看到:', await page.evaluate(() => window.__seen))
console.log('点击面板后 tag:', await page.locator('visual-revise-panel .tag').textContent().catch(e => 'ERR/空状态'))
console.log('点击面板后选中数:', await page.evaluate(() => document.querySelectorAll('[data-selected]').length))

await browser.close(); await close()
