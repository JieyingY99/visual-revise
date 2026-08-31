import { chromium } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.argv[2]
const extPath = join(ROOT, 'extension')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

for (const mode of [['新headless', ['--headless=new']], ['headed', []]]) {
  const [label, extraArgs] = mode
  const dir = await mkdtemp(join(tmpdir(), 'vr-diag-'))
  try {
    const ctx = await chromium.launchPersistentContext(dir, {
      executablePath: CHROME,
      headless: false,
      args: [...extraArgs, `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
    })
    await new Promise(r => setTimeout(r, 3000))
    const sws = ctx.serviceWorkers()
    const bgs = ctx.backgroundPages?.() || []
    console.log(`${label}: serviceWorkers=${sws.length} backgroundPages=${bgs.length}`)
    if (sws.length) console.log(`  SW url: ${sws[0].url()}`)

    const p = await ctx.newPage()
    await p.goto('chrome://extensions/')
    await p.waitForTimeout(1000)
    const found = await p.evaluate(() => {
      const mgr = document.querySelector('extensions-manager')
      const items = mgr?.shadowRoot?.querySelector('extensions-item-list')
        ?.shadowRoot?.querySelectorAll('extensions-item') || []
      return Array.from(items).map(i => ({
        id: i.id,
        name: i.shadowRoot?.querySelector('#name')?.textContent?.trim(),
      }))
    }).catch(e => 'ERR: ' + e.message)
    console.log(`  chrome://extensions 列出:`, JSON.stringify(found))
    await ctx.close()
  } catch (e) {
    console.log(`${label}: 启动失败 ${e.message.split('\n')[0]}`)
  }
  await rm(dir, { recursive: true, force: true })
}
