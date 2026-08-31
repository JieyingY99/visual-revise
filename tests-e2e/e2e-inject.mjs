import { chromium } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve, CHROME, ROOT, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const dir = await mkdtemp(join(tmpdir(), 'vr-e2e-'))

console.log('\n[端到端注入链路] service worker → executeScript → 工具条\n')

const ctx = await chromium.launchPersistentContext(dir, {
  executablePath: CHROME,
  headless: false,
  viewport: { width: 1440, height: 900 },
  args: ['--headless=new', '--enable-unsafe-extension-debugging'],
})

const swErrors = []
ctx.on('serviceworker', sw => {
  sw.on('console', m => { if (m.type() === 'error') swErrors.push(m.text()) })
})

const cdp = await ctx.browser().newBrowserCDPSession()
const { id } = await cdp.send('Extensions.loadUnpacked', { path: join(ROOT, 'extension') })
ok(!!id, `扩展已加载 id=${id.slice(0, 10)}…`)

// onInstalled 会唤起 service worker
let sw = ctx.serviceWorkers()[0]
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null)
ok(!!sw, sw ? 'service worker 已启动' : 'service worker 未能启动（无法验证 SW 层）')

const page = ctx.pages()[0] || await ctx.newPage()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))
await page.goto(origin, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

if (sw) {
  // 模拟点击扩展图标：执行 toggleIn 的等价动作
  const injected = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab) return { error: '拿不到活动标签页' }
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['toolbar/bundle.css'] })
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['toolbar/inject.js'] })
      return { ok: true, url: tab.url }
    } catch (e) {
      return { error: e.message }
    }
  }).catch(e => ({ error: 'SW 调用失败: ' + e.message }))

  ok(!injected.error, `SW 注入成功${injected.error ? '：' + injected.error : `（${injected.url}）`}`)
  await page.waitForTimeout(2000)

  ok(await page.locator('vis-bug').count() === 1, 'vis-bug 已注入页面')
  ok(await page.locator('visual-revise-toolbar').count() === 1, '★ 工具条已出现')
  ok(await page.evaluate(() => !!window.__visualRevise), '运行时 API 可用')

  const barText = await page.locator('visual-revise-toolbar').textContent().catch(() => '')
  ok(barText.includes('选择元素'), `工具条内容正确：${barText.replace(/\s+/g, ' ').trim().slice(0, 40)}`)
}

ok(pageErrors.length === 0, `页面无异常${pageErrors.length ? '：' + pageErrors.join('; ') : ''}`)
ok(swErrors.length === 0, `service worker 无错误${swErrors.length ? '：' + swErrors.join('; ') : ''}`)

await ctx.close(); await close()
await rm(dir, { recursive: true, force: true })
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
