import { serve, launch, injectVisBug } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
await page.goto(origin)
await injectVisBug(page, origin)
await page.evaluate(() => window.__visualRevise.setReorderMode(true))
await page.waitForTimeout(200)

// 在 capture 阶段观察 pointerdown 到底发生了什么
await page.evaluate(() => {
  window.__log = []
  document.addEventListener('pointerdown', e => {
    const stack = document.elementsFromPoint(e.clientX, e.clientY)
    window.__log.push({
      phase: 'observer',
      clientX: e.clientX, clientY: e.clientY,
      button: e.button,
      pathHead: (e.composedPath()[0] || {}).tagName,
      stack: stack.slice(0, 4).map(n => n.tagName + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '')),
    })
  }, true)
})

const box2 = await page.locator('.curve-card').nth(2).boundingBox()
console.log('卡片3 位置:', box2)
await page.mouse.move(box2.x + 4, box2.y + 4)
await page.mouse.down()
await page.waitForTimeout(200)
console.log('pointerdown 观察:', JSON.stringify(await page.evaluate(() => window.__log), null, 2))

console.log('拖拽状态:', await page.evaluate(() => ({
  active: window.__visualRevise.layoutDrag.active,
  indicator: document.getElementById('visual-revise-drop-indicator')?.style.display ?? '无指示线元素',
})))

// 手动验证条件
console.log('条件检查:', await page.evaluate((b) => {
  const el = document.elementsFromPoint(b.x + 4, b.y + 4).find(n => n.nodeType === 1)
  const parent = el?.parentElement
  return {
    hitElement: el?.tagName + '.' + (el?.className || ''),
    parent: parent?.tagName + '.' + (parent?.className || ''),
    parentDisplay: parent ? getComputedStyle(parent).display : null,
    siblingCount: parent ? parent.children.length : 0,
  }
}, box2))

await page.mouse.up()
await browser.close(); await close()
