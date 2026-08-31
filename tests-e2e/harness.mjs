import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(__dirname, '..')
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif', '.png': 'image/png' }

export async function serve(dir = __dirname, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      const p = url.pathname === '/' ? '/fixture.html' : url.pathname
      const file = p.startsWith('/__ext/')
        ? join(ROOT, 'extension', p.slice('/__ext/'.length))
        : p.startsWith('/__app/')
          ? join(ROOT, 'app', p.slice('/__app/'.length))
          : join(dir, p)
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404); res.end('not found')
    }
  })
  await new Promise(r => server.listen(port, '127.0.0.1', r))
  return { server, port: server.address().port, close: () => new Promise(r => server.close(r)) }
}

export async function launch({ headless = true } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', m => { if (m.type() === 'error') console.log('  [page error]', m.text()) })
  page.on('pageerror', e => console.log('  [page exception]', e.message))
  return { browser, page }
}

// 模拟扩展 service worker 的注入行为（绕过必须点击扩展图标的限制）
export async function injectVisBug(page, origin) {
  await page.addStyleTag({ path: join(ROOT, 'extension/toolbar/bundle.css') })
  await page.addScriptTag({ url: `${origin}/__ext/toolbar/bundle.min.js`, type: 'module' })
  await page.waitForFunction(() => !!customElements.get('vis-bug'), null, { timeout: 10000 })
  await page.evaluate(() => {
    const el = document.createElement('vis-bug')
    el.setAttribute('tutsBaseURL', '/__ext/tuts')
    document.body.prepend(el)
  })
  await page.waitForTimeout(400)
}

export function ok(cond, msg) {
  console.log(`  ${cond ? '✔' : '✘'} ${msg}`)
  if (!cond) process.exitCode = 1
  return cond
}
