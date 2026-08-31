import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[评论标注测试]\n')
await page.goto(origin)
await injectVisBug(page, origin)

ok(await page.locator('visual-revise-comment-layer').count() === 1, '评论层已挂载')

// C 进入评论模式
await page.keyboard.press('c')
await page.waitForTimeout(300)
ok(await page.evaluate(() => window.__visualRevise.comments.active), 'C 键进入评论模式')
const banner = await page.locator('visual-revise-comment-layer .banner').textContent().catch(() => '')
ok(banner.includes('评论模式'), `显示模式提示条：${banner.slice(0, 20)}…`)

// 点击元素起草评论
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-comment-layer .bubble').count() === 1, '点击元素弹出评论输入框')
ok(!(await page.evaluate(() => window.__visualRevise.comments.active)),
   '非 Shift 点击后自动退出评论模式')

// 点击不应该选中元素
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0,
   '评论模式下点击不选中元素')

// 输入并保存
await page.locator('visual-revise-comment-layer textarea').fill('鼠标移入时增加悬浮效果，并让卡片变亮')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(300)

const stats = await page.evaluate(() => window.__visualRevise.store.stats())
ok(stats.comments === 1, `评论已保存（${stats.comments} 条）`)
ok(await page.locator('visual-revise-comment-layer .pin').count() === 1, '页面显示评论标记 pin')
ok((await page.locator('visual-revise-comment-layer .pin').textContent()) === '1', 'pin 显示编号 1')

// Shift 连续添加
await page.keyboard.press('c')
await page.waitForTimeout(200)
await page.locator('.hero-title').click({ modifiers: ['Shift'] })
await page.waitForTimeout(300)
ok(await page.evaluate(() => window.__visualRevise.comments.active),
   'Shift 点击后保持评论模式（可连续添加）')
await page.locator('visual-revise-comment-layer textarea').fill('标题字号再大一点，字重加粗')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-comment-layer .pin').count() === 2, '第二条评论 pin 出现')

// 点击 pin 编辑
await page.locator('visual-revise-comment-layer .pin').first().click()
await page.waitForTimeout(300)
const draftText = await page.locator('visual-revise-comment-layer textarea').inputValue()
ok(draftText.includes('悬浮效果'), '点击 pin 可编辑原评论')
await page.locator('visual-revise-comment-layer textarea').fill('鼠标移入时上浮 4px 并加阴影')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(300)
const updated = await page.evaluate(() => window.__visualRevise.store.read().comments[0].text)
ok(updated.includes('上浮 4px'), `评论已更新：${updated}`)

// Esc 退出模式
await page.keyboard.press('c')
await page.waitForTimeout(200)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
ok(!(await page.evaluate(() => window.__visualRevise.comments.active)), 'Esc 退出评论模式')

// 评论进入提示词
const prompt = await page.evaluate(async (base) => {
  const { buildPrompt } = await import(`${base}/__app/core/prompt-export.js`)
  return buildPrompt(window.__visualRevise.store.read(), { url: 'x', viewport: '1440 × 900' })
}, origin)
ok(prompt.includes('## 交互备注'), '提示词含交互备注段落')
ok(prompt.includes('上浮 4px') && prompt.includes('字重加粗'), '两条评论都进入提示词')
ok(prompt.includes('CSS 无法表达的行为需求'), '提示词向 AI 说明了备注的性质')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
