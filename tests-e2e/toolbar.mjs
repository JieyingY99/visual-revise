import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[工具条测试] 模式互斥 / 状态双向同步 / 计数\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(500)

const bar = sel => page.locator(`visual-revise-toolbar ${sel}`)
const mode = () => page.evaluate(() => window.__visualRevise.mode)
const litMode = () => page.evaluate(() => {
  const btns = window.__visualRevise.toolbar.shadowRoot.querySelectorAll('button[data-mode]')
  return Array.from(btns).filter(b => b.hasAttribute('data-on')).map(b => b.dataset.mode)
})

ok(await page.locator('visual-revise-toolbar').count() === 1, '工具条已挂载')
ok(await bar('button[data-mode]').count() === 3, '三个模式按钮')
ok(await bar('.sep').count() === 3, '分组竖线')

// 初始态
ok(await mode() === 'select', '初始为选择模式')
ok((await litMode()).join() === 'select', '选择模式按钮高亮')

// 点击切换模式
await bar('button[data-mode="comment"]').click()
await page.waitForTimeout(300)
ok(await mode() === 'comment', '点击切到评论模式')
ok((await litMode()).join() === 'comment', `高亮跟随且互斥（亮着的：${await litMode()}）`)
ok(await page.evaluate(() => window.__visualRevise.comments.active), '评论层已激活')
ok(!(await page.evaluate(() => window.__visualRevise.layoutDrag.active)), '重排同时被关闭')

await bar('button[data-mode="reorder"]').click()
await page.waitForTimeout(300)
ok(await mode() === 'reorder' && (await litMode()).join() === 'reorder', '切到重排模式，评论自动退出')
ok(!(await page.evaluate(() => window.__visualRevise.comments.active)), '评论层已关闭')

// 快捷键与工具条双向同步
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('c')
await page.waitForTimeout(300)
ok(await mode() === 'comment' && (await litMode()).join() === 'comment',
   '快捷键 C 切换，工具条高亮同步跟随')

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok(await mode() === 'select' && (await litMode()).join() === 'select', 'Esc 回到选择模式')

// 选中元素：面板出现，模式保持 select
await bar('button[data-mode="select"]').click()
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(500)
ok(!(await page.locator('visual-revise-panel').evaluate(el => el.hidden)), '选中后属性面板出现')

// 切到非选择模式时，面板收起且取消选中
await bar('button[data-mode="comment"]').click()
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-panel').evaluate(el => el.hidden), '切到评论模式后面板收起')
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0, '同时取消选中')

// 计数与复制按钮状态
await bar('button[data-mode="select"]').click()
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(400)

ok((await bar('.count').textContent()).trim() === '0', '初始记录数为 0')
ok(await bar('.copy').evaluate(el => !el.hasAttribute('data-ready')), '无改动时复制按钮压暗')

await page.evaluate(() => {
  const s = window.__visualRevise.store
  const el = document.querySelectorAll('.curve-card')[1]
  s.track(el); s.applyProp(el, 'border-radius', '12px'); s.applyProp(el, 'padding-top', '24px')
})
await page.waitForTimeout(400)
ok((await bar('.count').textContent()).trim() === '2', `记录计数同步：${(await bar('.count').textContent()).trim()}`)
ok(await bar('.copy').evaluate(el => el.hasAttribute('data-ready')), '有改动后复制按钮点亮')

// 复制走工具条
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
await bar('.copy').click()
await page.waitForTimeout(600)
const clip = await page.evaluate(() => navigator.clipboard.readText())
ok(clip.includes('border-radius'), '工具条复制提示词生效')
// toast 挂在 body 而非工具条 shadow 内：:host 的 transform 会创建包含块，
// 放在里面的 fixed 定位会相对工具条而不是视口
const toastState = await page.evaluate(() => {
  const el = document.getElementById('visual-revise-toast')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { opacity: el.style.opacity, bottomGap: Math.round(innerHeight - r.bottom), text: el.textContent }
})
ok(toastState?.opacity === '1', `复制后显示反馈 toast：${toastState?.text}`)
ok(toastState && toastState.bottomGap < 60 && toastState.bottomGap > 0,
   `toast 贴在视口底部而非工具条附近（距底 ${toastState?.bottomGap}px）`)

// 记录按钮开合列表
await bar('.list').click()
await page.waitForTimeout(400)
ok(!(await page.locator('visual-revise-list').evaluate(el => el.hidden)), '记录按钮打开改动列表')

// Tab 交互态：工具条一并隐藏
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
ok(await page.locator('visual-revise-toolbar').evaluate(el => el.hidden), '交互态下工具条隐藏')
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
ok(!(await page.locator('visual-revise-toolbar').evaluate(el => el.hidden)), '退出交互态后工具条恢复')

// 图标是 SVG 而非 emoji
const iconCheck = await page.evaluate(() => {
  const sr = window.__visualRevise.toolbar.shadowRoot
  return {
    svgCount: sr.querySelectorAll('svg').length,
    hasEmoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sr.textContent),
  }
})
ok(iconCheck.svgCount === 7, `全部图标为内联 SVG（${iconCheck.svgCount} 个）`)
ok(!iconCheck.hasEmoji, '界面文本中不含 emoji')

// 关闭按钮
await bar('.close').click()
await page.waitForTimeout(500)
ok(await page.locator('vis-bug').count() === 0, '关闭按钮移除整个编辑器')
ok(await page.locator('visual-revise-toolbar').count() === 0, '工具条随之移除')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
