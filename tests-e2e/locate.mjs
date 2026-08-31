import { launch, ok, ROOT } from './harness.mjs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createServer } from 'node:http'

const PROJ = join(ROOT, 'tests-e2e/mock-project')

// 起一个只服务构建产物的 server
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(PROJ, 'built.html'))
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(body)
  } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// 读取"源码"
const srcDir = join(PROJ, 'src/components')
const files = await readdir(srcDir)
const sources = {}
for (const f of files) sources[f] = await readFile(join(srcDir, f), 'utf8')

const grepSources = needle => Object.entries(sources)
  .filter(([, content]) => content.includes(needle))
  .map(([name]) => name)

const { browser, page } = await launch({ headless: true })
console.log('\n[端到端定位验证] 类名被 CSS Modules 哈希后，提示词能否让 AI 定位到源码\n')

await page.goto(origin)
const bundle = await readFile(join(ROOT, 'app/bundle.min.js'), 'utf8')
await page.evaluate(async js => {
  new Function(js)()
  await customElements.whenDefined('vis-bug')
  document.body.prepend(document.createElement('vis-bug'))
}, bundle)
await page.waitForTimeout(1000)

// 在构建产物上做改动
const prompt = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const cards = document.querySelectorAll('[class*="curveCard"]')
  const title = document.querySelector('[class*="heroTitle"]')

  s.track(cards[1]); s.track(title)
  s.applyProp(cards[1], 'padding-top', '24px')
  s.applyProp(cards[1], 'padding-right', '24px')
  s.applyProp(cards[1], 'padding-bottom', '24px')
  s.applyProp(cards[1], 'padding-left', '24px')
  s.applyProp(cards[1], 'border-radius', '12px')
  s.applyProp(title, 'font-size', '56px')
  s.addComment(cards[1], '鼠标移入时上浮 4px 并加阴影')

  return window.__visualRevise.lib.buildPrompt(s.read(), {
    url: 'http://localhost:5173/', viewport: '1440 × 900',
  })
})

// ── 定位能力评估 ──
const selectors = [...prompt.matchAll(/- 选择器：`([^`]+)`/g)].map(m => m[1])
const texts     = [...prompt.matchAll(/`"([^"]+)"`/g)].map(m => m[1])

console.log(`  提示词中的选择器：${selectors.length} 个`)
console.log(`  提示词中的文本锚点：${texts.length} 个\n`)

// 选择器里的哈希类名在源码中不存在 —— 这正是设计要解决的问题
const selectorHits = selectors.map(sel => {
  const cls = (sel.match(/\.([\w-]+)/g) || []).map(c => c.slice(1))
  return cls.some(c => grepSources(c).length > 0)
})
ok(selectorHits.every(hit => !hit),
   `选择器中的哈希类名在源码中全部搜不到（${selectors[0]?.slice(0, 40)}…）—— 印证了不能只靠选择器`)

// 文本锚点应当能唯一命中正确的源文件
const cardHit  = grepSources('Thinking Five')
const titleHit = grepSources('A Gallery of Mathematical Loading Animations')
ok(cardHit.length === 1 && cardHit[0] === 'CardGrid.tsx',
   `文本锚点「Thinking Five」唯一命中 ${cardHit.join(', ')}`)
ok(titleHit.length === 1 && titleHit[0] === 'Hero.tsx',
   `文本锚点「A Gallery of…」唯一命中 ${titleHit.join(', ')}`)

// 每个改动项至少有一个可用于源码检索的锚点
const perItem = texts.map(t => ({ text: t, files: grepSources(t) }))
const resolvable = perItem.filter(i => i.files.length > 0)
ok(resolvable.length >= 2,
   `${resolvable.length}/${perItem.length} 个文本锚点可在源码中检索到`)
resolvable.slice(0, 4).forEach(i =>
  console.log(`    「${i.text.slice(0, 34)}」→ ${i.files.join(', ')}`))

// 命中的文件里必须真的含有要改的样式类
const cardCss = sources['CardGrid.module.css']
ok(cardCss.includes('padding: 15px') && cardCss.includes('border-radius: 18px'),
   '命中文件中确实存在待改的原始样式值（padding:15px / border-radius:18px）')

// 提示词给出的原值应与源码一致 —— AI 可据此确认改对了地方
ok(prompt.includes('`15px`') && prompt.includes('`18px`'),
   '提示词给出的原值与源码一致，AI 可交叉验证')

// 交互备注不该被当成样式改动
ok(prompt.includes('## 交互备注') && prompt.includes('上浮 4px'),
   '交互需求单独成段，不混进 CSS 表格')

console.log('\n───── 提示词（节选）─────')
console.log(prompt.split('\n').slice(0, 26).join('\n'))
console.log('  …')

server.close()
await browser.close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
