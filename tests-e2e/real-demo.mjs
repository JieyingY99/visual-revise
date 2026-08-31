import { chromium } from 'playwright-core'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHROME, ROOT } from './harness.mjs'

const extPath = join(ROOT, 'extension')
const dir = await mkdtemp(join(tmpdir(), 'vr-demo-'))
const context = await chromium.launchPersistentContext(dir, {
  executablePath: CHROME, headless: false,
  viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2,
  args: ['--headless=new', '--enable-unsafe-extension-debugging'],
})
const cdp = await context.browser().newBrowserCDPSession()
const { id } = await cdp.send('Extensions.loadUnpacked', { path: extPath })

const page = context.pages()[0] || await context.newPage()
await page.goto('http://localhost:3002/f', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(2000)

// 以扩展的真实注入方式启动编辑器
await page.evaluate(async extId => {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `chrome-extension://${extId}/toolbar/bundle.css`
  document.head.appendChild(link)
}, id)
const bundle = await (await import('node:fs/promises')).readFile(join(ROOT, 'app/bundle.min.js'), 'utf8')
await page.evaluate(async js => {
  new Function(js)()
  await customElements.whenDefined('vis-bug')
  document.body.prepend(document.createElement('vis-bug'))
}, bundle)
await page.waitForTimeout(1200)

const panel = sel => page.locator(`visual-revise-panel ${sel}`)
const setProp = async (prop, value) => {
  const sel = panel(`select[data-prop="${prop}"]`)
  if (await sel.count()) {
    await sel.selectOption(value)
  } else {
    const input = panel(`input[data-prop="${prop}"]`)
    await input.fill(value)
    await input.dispatchEvent('change')
  }
  await page.waitForTimeout(250)
}
const log = m => console.log(`  ${m}`)

console.log('\n【真实改稿演示】Kuse 登录页\n')

// ① 标题：字号加大
console.log('① 选中主标题「Chaos in, Genius out」')
await page.locator('h1.auth-tagline').click()
await page.waitForTimeout(600)
log(`面板显示: ${await panel('.tag').textContent()}`)
log(`当前字号: ${await panel('input[data-prop="font-size"]').inputValue()}`)
await setProp('font-size', '52px')
await setProp('letter-spacing', '0.5px')
log('→ 字号 44px → 52px，字距 +0.5px')

// ② 邮箱输入框：圆角与高度
console.log('\n② 选中邮箱输入框')
await page.locator('input.form-input-field').first().click()
await page.waitForTimeout(600)
log(`面板显示: ${await panel('.tag').textContent()}`)
await setProp('border-radius', '12px')
await setProp('height', '44px')
log('→ 圆角 12px，高度 44px')

// ③ Sign up 链接：字重与颜色
console.log('\n③ 选中「Sign up」链接')
await page.locator('text=Sign up').first().click()
await page.waitForTimeout(600)
log(`面板显示: ${await panel('.tag').textContent()}`)
await setProp('font-weight', '600')
log('→ 字重 600')

// ④ Tailwind 元素：Debug 按钮
console.log('\n④ 选中 Debug 按钮（Tailwind 工具类）')
await page.locator('button:has-text("Debug")').first().click()
await page.waitForTimeout(600)
log(`面板显示: ${await panel('.tag').textContent()}`)
await setProp('border-radius', '999px')
log('→ 圆角改为全圆')

// ⑤ 交互评论
console.log('\n⑤ 给邮箱输入框加一条交互说明')
await page.evaluate(() => window.__visualRevise.setCommentMode(true))
await page.locator('input.form-input-field').first().click()
await page.waitForTimeout(500)
await page.locator('visual-revise-comment-layer textarea').fill('鼠标移入时上浮 2px 并加柔和阴影，过渡 150ms')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(400)
log('→ 已添加')

// ⑥ Tab 验证交互态
console.log('\n⑥ 按 Tab 验证原生交互')
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Tab')
await page.waitForTimeout(500)
log(`交互态: ${await page.evaluate(() => window.__visualRevise.interactive)}`)
await page.locator('input.form-input-field').first().hover()
await page.waitForTimeout(300)
await page.screenshot({ path: join(ROOT, '.screenshots/real-1-交互态验证.png') })
await page.keyboard.press('Tab')
await page.waitForTimeout(500)
log(`回到编辑态，改动保留: ${await page.evaluate(() =>
  getComputedStyle(document.querySelector('h1.auth-tagline')).fontSize)}`)

// ⑦ 打开记录并截图
await page.locator('visual-revise-panel .list').click()
await page.waitForTimeout(600)
await page.screenshot({ path: join(ROOT, '.screenshots/real-2-改稿结果.png') })

const stats = await page.evaluate(() => window.__visualRevise.store.stats())
console.log(`\n共 ${stats.elements} 个元素 / ${stats.props} 项属性 / ${stats.comments} 条评论`)

const prompt = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
await writeFile(join(ROOT, '.screenshots/real-提示词.md'), prompt)
console.log('提示词已写入 .screenshots/real-提示词.md')

await context.close()
