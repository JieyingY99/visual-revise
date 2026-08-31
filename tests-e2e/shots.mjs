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

// 1. 属性面板
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(600)
await shot('1-属性面板.png')

// 2. 改过几个属性 + 改动列表
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const card = document.querySelectorAll('.curve-card')[1]
  const title = document.querySelector('.hero-title')
  s.track(card); s.track(title)
  ;['top','right','bottom','left'].forEach(d => s.applyProp(card, `padding-${d}`, '24px'))
  s.applyProp(card, 'border-radius', '12px')
  s.applyProp(card, 'background-color', 'rgb(23, 23, 32)')
  s.applyProp(title, 'font-size', '52px')
})
await page.waitForTimeout(300)
await page.locator('visual-revise-panel .list').click()
await page.waitForTimeout(600)
await shot('2-改动列表.png')

// 3. 评论标注
await page.locator('visual-revise-list .close').click()
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.addComment(document.querySelectorAll('.curve-card')[1], '鼠标移入时上浮 4px 并加阴影')
  s.addComment(document.querySelector('.btn-primary'), '点击后显示加载态，禁用重复提交')
})
await page.evaluate(() => window.__visualRevise.setCommentMode(true))
await page.waitForTimeout(600)
await shot('3-评论标注.png')

// 4. 拖拽重排指示线
await page.evaluate(() => window.__visualRevise.setCommentMode(false))
await page.evaluate(() => window.__visualRevise.setReorderMode(true))
const b2 = await page.locator('.curve-card').nth(2).boundingBox()
const b0 = await page.locator('.curve-card').nth(0).boundingBox()
await page.mouse.move(b2.x + b2.width / 2, b2.y + 8)
await page.mouse.down()
await page.mouse.move(b0.x + 24, b0.y + 40, { steps: 10 })
await page.waitForTimeout(400)
await shot('4-拖拽重排.png')
await page.mouse.up()

await browser.close(); await close()
console.log('✔ 截图已生成')
