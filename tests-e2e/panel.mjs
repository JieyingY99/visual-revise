import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[面板集成测试]\n')
await page.goto(origin)
await injectVisBug(page, origin)

ok(await page.locator('visual-revise-panel').count() === 1, '属性面板已挂载')
ok(await page.evaluate(() => !!window.__visualRevise), '集成 API 已暴露')

// 空状态
const emptyText = await page.locator('visual-revise-panel .empty').textContent().catch(() => '')
ok(emptyText.includes('点击页面上的任意元素'), '未选中时显示空状态引导')

// 选中元素
const card = page.locator('.curve-card').nth(1)
await card.click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)

const tag = await page.locator('visual-revise-panel .tag').textContent()
ok(tag.includes('article.curve-card'), `面板显示选中元素：${tag}`)

const groups = await page.locator('visual-revise-panel section').count()
ok(groups >= 5, `渲染了 ${groups} 个属性分组`)

// 面板不能被自己选中
await page.locator('visual-revise-panel header .tag').click({ force: true })
await page.waitForTimeout(200)
const tagAfter = await page.locator('visual-revise-panel .tag').textContent()
ok(tagAfter.includes('article.curve-card'), '点击面板自身不会改变选中（isOffBounds 生效）')

// 改属性
const radiusInput = page.locator('visual-revise-panel input[data-prop="border-radius"]')
await radiusInput.fill('12px')
await radiusInput.press('Enter')
await page.waitForTimeout(300)

const applied = await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].style.borderRadius)
ok(applied === '12px', `面板输入写入页面：border-radius = ${applied}`)

// 数值上下键微调
const padTop = page.locator('visual-revise-panel input[data-prop="padding-top"]')
await padTop.focus()
await padTop.press('ArrowUp')
await page.waitForTimeout(200)
const padded = await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].style.paddingTop)
ok(padded === '16px', `上下键微调生效：padding-top = ${padded}（15px → 16px）`)

// 改动记录
const stats = await page.evaluate(() => window.__visualRevise.store.stats())
ok(stats.props === 2, `改动记录 = ${stats.props} 项属性`)

// dirty 标记
const dirtyCount = await page.locator('visual-revise-panel label.name[data-dirty]').count()
ok(dirtyCount >= 2, `改动过的属性有高亮标记（${dirtyCount} 个）`)

// Tab 切换交互态（先让焦点离开面板——面板内的 Tab 用于切换输入焦点）
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
const inInteractive = await page.evaluate(() => ({
  mode:        window.__visualRevise.interactive,
  panelHidden: document.querySelector('visual-revise-panel').hidden,
  visbugHidden: document.querySelector('vis-bug').style.display,
  handles:     Array.from(document.querySelectorAll('visbug-handles')).every(el => el.style.display === 'none'),
}))
ok(inInteractive.mode === true, 'Tab 进入交互态')
ok(inInteractive.panelHidden === true, '交互态下面板隐藏')
ok(inInteractive.handles, '交互态下选中框隐藏（不遮挡页面）')

// 交互态下页面原生事件应可用
const clickable = await page.evaluate(() => {
  let fired = false
  const btn = document.querySelector('.btn-primary')
  btn.addEventListener('click', () => { fired = true }, { once: true })
  btn.click()
  return fired
})
ok(clickable, '交互态下页面原生 click 可正常触发')

// Tab 切回
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
const back = await page.evaluate(() => ({
  mode:      window.__visualRevise.interactive,
  selected:  document.querySelectorAll('[data-selected]').length,
  radius:    document.querySelectorAll('.curve-card')[1].style.borderRadius,
}))
ok(back.mode === false, 'Tab 退出交互态')
ok(back.radius === '12px', '切换过程中改动完整保留')

// 复制提示词
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
await page.locator('visual-revise-panel .copy').click()
await page.waitForTimeout(500)
const clip = await page.evaluate(() => navigator.clipboard.readText())
ok(clip.includes('# 页面视觉修改需求'), '复制提示词到剪贴板')
ok(clip.includes('border-radius'), '提示词含改动属性')
ok(clip.includes('Thinking Five'), '提示词含文本锚点')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
