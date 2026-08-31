import { serve, launch, injectVisBug } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
await page.goto(origin)
await injectVisBug(page, origin)

const card = page.locator('.curve-card').nth(1)
await card.click()
await page.waitForTimeout(300)

console.log('vis-bug 实例公开方法:', await page.evaluate(() => {
  const el = document.querySelector('vis-bug')
  return Object.getOwnPropertyNames(Object.getPrototypeOf(el)).filter(n => typeof el[n] === 'function')
}))
console.log('selection() 长度:', await page.evaluate(() => {
  try { return document.querySelector('vis-bug').selection().length } catch(e) { return 'ERR: '+e.message }
}))
console.log('activeElement:', await page.evaluate(() => document.activeElement?.tagName))

// 直接在页面里派发键盘事件到 document
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'p', code:'KeyP', keyCode:80, bubbles:true}))
})
await page.waitForTimeout(200)
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp', code:'ArrowUp', keyCode:38, bubbles:true}))
})
await page.waitForTimeout(200)
console.log('派发事件后 inline style:', await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].getAttribute('style')))

// 直接验证核心假设：手动改 style
console.log('直接写 style 验证假设:', await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[1]
  el.style.padding = '24px'
  return el.getAttribute('style')
}))
await browser.close(); await close()
