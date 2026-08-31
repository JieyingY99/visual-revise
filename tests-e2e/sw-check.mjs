import { chromium } from 'playwright-core'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHROME, ROOT } from './harness.mjs'

const dir = await mkdtemp(join(tmpdir(), 'vr-sw-'))
const ctx = await chromium.launchPersistentContext(dir, {
  executablePath: CHROME, headless: false,
  args: ['--headless=new', '--enable-unsafe-extension-debugging'],
})
const errors = []
ctx.on('weberror', e => errors.push(String(e.error())))

const cdp = await ctx.browser().newBrowserCDPSession()
const { id } = await cdp.send('Extensions.loadUnpacked', { path: join(ROOT, 'extension') })
console.log('  ✔ 扩展加载成功（语法与 manifest 均通过校验）id=' + id.slice(0, 12) + '…')

// 打开页面并等一会，让 SW 有机会启动并触发那两处顶层调用
const page = await ctx.newPage()
await page.goto('https://example.com', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(4000)

const sws = ctx.serviceWorkers()
console.log(`  · service worker: ${sws.length} 个`)
for (const sw of sws) {
  const err = await sw.evaluate(() => self.__lastError || null).catch(e => e.message)
  console.log(`    ${sw.url().split('/').pop()} — ${err ? '有错误: ' + err : '无未捕获错误'}`)
}
console.log(errors.length ? `  ✘ 页面级错误: ${errors.join('; ')}` : '  ✔ 无页面级错误')
await ctx.close()
