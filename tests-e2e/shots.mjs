import { chromium } from 'playwright-core'
import { serve, injectVisBug, CHROME, ROOT } from './harness.mjs'
import { join } from 'node:path'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const shot = n => page.screenshot({ path: join(ROOT, '.screenshots', n) })

await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(600)

// 1. 打开后的第一屏：只有工具条
await shot('1-工具条.png')

// 2. 选中元素后属性面板出现
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(600)
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const card = document.querySelectorAll('.curve-card')[1]
  const title = document.querySelector('.hero-title')
  s.track(card); s.track(title)
  ;['top','right','bottom','left'].forEach(d => s.applyProp(card, `padding-${d}`, '24px'))
  s.applyProp(card, 'border-radius', '12px')
  s.applyProp(title, 'font-size', '52px')
})
await page.waitForTimeout(500)
await shot('2-选中与面板.png')

// 3. 评论模式
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.addComment(document.querySelectorAll('.curve-card')[1], '鼠标移入时上浮 4px 并加阴影')
  s.addComment(document.querySelector('.btn-primary'), '点击后显示加载态，禁用重复提交')
  window.__visualRevise.setMode('comment')
})
await page.waitForTimeout(600)
await shot('3-评论模式.png')

// 4. 改动记录
await page.evaluate(() => {
  window.__visualRevise.setMode('select')
  const list = window.__visualRevise.list
  list.hidden = false
  list.render()
})
await page.waitForTimeout(600)
await shot('4-改动记录.png')

// 5. 页面拖拽：拖影 + 落点高亮 + 插入指示线
await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  window.__visualRevise.setMode('select')
})
await page.waitForTimeout(500)

const rb0 = await page.locator('.curve-card').nth(0).boundingBox()
const rb2 = await page.locator('.curve-card').nth(2).boundingBox()
await page.mouse.move(rb2.x + rb2.width / 2, rb2.y + 8)
await page.mouse.down()
await page.mouse.move(rb0.x + 30, rb0.y + 60, { steps: 12 })
await page.waitForTimeout(400)
await shot('5-拖拽移动.png')
await page.mouse.up()

await browser.close(); await close()
console.log('✔ 截图已生成')
