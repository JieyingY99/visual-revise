import { launch, injectVisBug, serve, ok } from './harness.mjs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from './harness.mjs'

const SITES = [
  { name: 'example.com', url: 'https://example.com', pick: 'p' },
  { name: 'MDN',         url: 'https://developer.mozilla.org/en-US/', pick: 'h1' },
]

const { port, close } = await serve()
const localOrigin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[真实站点测试] CSP / 复杂 DOM / 框架页面\n')

// 真实站点没有本地 server，直接把 bundle 内容注入
const bundle = await readFile(join(ROOT, 'app/bundle.min.js'), 'utf8')
const bundleCss = await readFile(join(ROOT, 'extension/toolbar/bundle.css'), 'utf8')

for (const site of SITES) {
  console.log(`\n── ${site.name} ──`)
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 25000 })
  } catch (e) {
    console.log(`  · 跳过（网络不可达：${e.message.split('\n')[0].slice(0, 60)}）`)
    continue
  }

  // bundle 打包后不含 top-level import/export，可当普通脚本执行。
  // page.evaluate 走 CDP，与扩展的 chrome.scripting.executeScript 一样
  // 不受页面 CSP 约束——这正是扩展能在任意站点工作的原因。
  const injected = await page.evaluate(async ([js, css]) => {
    try {
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)

      new Function(js)()

      await customElements.whenDefined('vis-bug')
      document.body.prepend(document.createElement('vis-bug'))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message || String(e) }
    }
  }, [bundle, bundleCss])

  if (!injected.ok) {
    console.log(`  · 注入失败：${injected.error}`)
    process.exitCode = 1
    continue
  }

  await page.waitForTimeout(1200)
  ok(await page.locator('visual-revise-panel').count() === 1, `${site.name}：面板注入成功`)

  const target = page.locator(site.pick).first()
  const box = await target.boundingBox()
  if (!box) { console.log(`  · 未找到目标元素 ${site.pick}`); continue }

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(600)

  const tag = await page.locator('visual-revise-panel .tag').textContent().catch(() => '')
  ok(!!tag && tag !== '未选中元素', `${site.name}：可选中真实页面元素（${tag}）`)

  const anchors = await page.evaluate(() => {
    const t = window.__visualRevise.panel.target
    return t ? window.__visualRevise.lib.fingerprint(t).slice(0, 60) : null
  })
  ok(!!anchors, `${site.name}：可为真实元素生成结构指纹`)

  const applied = await page.evaluate(() => {
    const t = window.__visualRevise.panel.target
    window.__visualRevise.store.applyProp(t, 'outline', '2px solid red')
    window.__visualRevise.store.applyProp(t, 'padding-top', '30px')
    return t.style.paddingTop
  })
  ok(applied === '30px', `${site.name}：可在真实页面写入样式`)

  const prompt = await page.evaluate(() =>
    window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
  ok(prompt.includes('padding-top'), `${site.name}：可生成提示词`)
  console.log(`  提示词片段: ${prompt.split('\n').find(l => l.includes('选择器'))?.trim().slice(0, 70)}`)

  await page.evaluate(() => window.__visualRevise.store.undoEverything())
}

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
