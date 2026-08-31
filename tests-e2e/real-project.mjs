import { chromium } from 'playwright-core'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHROME, ROOT } from './harness.mjs'

const TARGET = process.env.TARGET_URL || 'http://localhost:3002/f'
const extPath = join(ROOT, 'extension')
const userDataDir = await mkdtemp(join(tmpdir(), 'vr-real-'))

const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROME,
  headless: false,
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  args: ['--headless=new', '--enable-unsafe-extension-debugging'],
})

const cdp = await context.browser().newBrowserCDPSession()
const { id } = await cdp.send('Extensions.loadUnpacked', { path: extPath })
console.log('扩展已加载:', id)

const page = context.pages()[0] || await context.newPage()
await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(2500)

await page.screenshot({ path: join(ROOT, '.screenshots/real-0-原始页面.png') })
console.log('页面标题:', await page.title())

// 列出页面上可供改稿的候选元素
const candidates = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button, a[class], h1, h2, h3, [class*="card"], [class*="Card"], input, [role="button"]')) {
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height < 20 || r.top < 0 || r.top > innerHeight) continue
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 90),
      text,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    })
    if (out.length >= 14) break
  }
  return out
})
console.log('\n候选元素:')
candidates.forEach((c, i) => console.log(`  [${i}] <${c.tag}> "${c.text}" @${c.box.join(',')}\n      class="${c.cls}"`))

await context.close()
