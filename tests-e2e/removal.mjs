import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[删除记录测试] 记录 / 恢复 / 边界 / 提示词\n')
await page.goto(origin)
await injectVisBug(page, origin)

const titles = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.curve-card .card-title')).map(e => e.textContent.trim()))
const store = fn => page.evaluate(fn)
const reload = async () => { await page.goto(origin); await injectVisBug(page, origin) }

const before = await titles()
ok(before.length === 3, `起始 3 张卡片：${before.join(' | ')}`)

// ── 按一次 Delete 只删一个 ──────────────────────────────────
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.keyboard.press('Delete')
await page.waitForTimeout(500)

const after = await titles()
ok(after.length === 2,
   `按一次 Delete 只删一个（上游 hotkeys 把 del/delete 注册成两条，回调会跑两次）：${after.join(' | ')}`)
ok(!after.includes('Thinking Five'), '删掉的正是选中的那个')

// ── 记录 ────────────────────────────────────────────────────
const rec = await store(() => {
  const [r] = window.__visualRevise.store.read().removals
  return r && { tag: r.tag, text: r.text, selector: r.anchors.selector, childCount: r.childCount }
})
ok(rec?.tag === 'article', `删除被记录：<${rec?.tag}> ${rec?.text?.slice(0, 20)}…`)
ok(rec.childCount === 4, `记下了子元素数量：${rec.childCount}`)
ok((await store(() => window.__visualRevise.store.stats())).removals === 1, '计入 stats.removals')

// ── 恢复到原位置 ────────────────────────────────────────────
const id = await store(() => window.__visualRevise.store.read().removals[0].id)
await page.evaluate(i => window.__visualRevise.store.restoreRemoval(i), id)
await page.waitForTimeout(300)

const restored = await titles()
ok(JSON.stringify(restored) === JSON.stringify(before),
   `放回原位而不是追加到末尾：${restored.join(' | ')}`)
ok((await store(() => window.__visualRevise.store.read().removals.length)) === 0,
   '恢复后不再列为删除')

// ── 同时选中父与子，只记最外层 ──────────────────────────────
await reload()
await page.evaluate(() => {
  const card = document.querySelectorAll('.curve-card')[0]
  const s = window.__visualRevise.store
  // 真实调用序列就是「先记录、再删」——记录只在元素离开 DOM 后才算数
  s.recordRemoval([card, card.querySelector('.card-title')])
  card.remove()
})
await page.waitForTimeout(300)
const nested = await store(() => window.__visualRevise.store.read().removals.map(r => r.tag))
ok(nested.length === 1 && nested[0] === 'article',
   `父子同选只记最外层（子元素跟着父节点一起回来，分开记会插出重复节点）：${JSON.stringify(nested)}`)

// ── 父元素也被删时无法恢复 ──────────────────────────────────
await reload()
await page.evaluate(() => {
  const card = document.querySelectorAll('.curve-card')[0]
  const title = card.querySelector('.card-title')
  const s = window.__visualRevise.store
  s.recordRemoval([title]); title.remove()      // 先删子
  s.recordRemoval([card]);  card.remove()       // 再删父
})
await page.waitForTimeout(300)

const restorable = await store(() => {
  const s = window.__visualRevise.store
  return s.read().removals.map(r => ({ tag: r.tag, can: s.canRestore(r) }))
})
ok(restorable.find(r => r.tag === 'article')?.can === true, '父元素本身可以放回')
ok(restorable.find(r => r.tag === 'h2')?.can === false,
   '父元素已不在页面上时，子元素标为不可放回，而不是静默失败')

const failed = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const child = s.read().removals.find(r => r.tag === 'h2')
  return s.restoreRemoval(child.id)
})
ok(failed === false, 'restoreRemoval 如实返回 false')

// ── 重置全部把删掉的放回去 ──────────────────────────────────
await reload()
await page.locator('.curve-card').nth(0).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.keyboard.press('Delete')
await page.waitForTimeout(400)
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(400)

const reset = await titles()
ok(JSON.stringify(reset) === JSON.stringify(before),
   `「重置全部」会把删掉的元素放回来：${reset.join(' | ')}`)

// ── 输入框里的 Backspace 不删元素 ───────────────────────────
await reload()
await page.evaluate(() => {
  const input = document.createElement('input')
  input.className = 'probe-input'
  input.value = 'abc'
  document.querySelector('.hero').appendChild(input)
})
await page.locator('.probe-input').click()
await page.keyboard.press('Backspace')
await page.waitForTimeout(300)
ok((await store(() => window.__visualRevise.store.stats())).removals === 0,
   '在输入框里按 Backspace 只删字符，不删元素')
ok((await page.evaluate(() => document.querySelector('.probe-input').value)) === 'ab',
   '字符确实被删了（说明按键没有被我们吞掉）')

// ── 提示词 ──────────────────────────────────────────────────
await reload()
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.keyboard.press('Delete')
await page.waitForTimeout(400)

const prompt = await store(() => {
  const { buildPrompt } = window.__visualRevise.lib
  return buildPrompt(window.__visualRevise.store.read(), { url: 'http://x/' })
})
ok(prompt.includes('## 删除的元素'), '提示词有独立的「删除的元素」段落')
ok(prompt.includes('Thinking Five'), '带文本特征——AI 靠它在源码里找到该删的那段')
ok(prompt.includes('display:none') || prompt.includes('display: none'),
   '明确要求不要用 display:none 藏起来（那样 DOM 里还在，读屏与 Tab 顺序仍会读到）')
ok(prompt.includes('数据驱动') || prompt.includes('渲染条件'),
   '提示了数据驱动的元素应改数据而非删循环体')
ok(prompt.includes('处删除'), `摘要里统计了删除：${prompt.split('\n').find(l => l.startsWith('改动：'))}`)

// 只有删除、没有别的改动时也要能导出
const onlyRemoval = await store(() => {
  const { buildPrompt } = window.__visualRevise.lib
  const state = window.__visualRevise.store.read()
  return buildPrompt({ edits: [], comments: [], removals: state.removals }).length > 0
})
ok(onlyRemoval, '只删了元素、没改样式时，提示词照样出得来')

// ── JSON 往返 ───────────────────────────────────────────────
const json = await store(() => window.__visualRevise.lib.exportJSON())
ok(json.removals?.length === 1, `导出的 JSON 含删除记录：${json.removals?.length} 条`)
ok(json.removals[0].anchors?.text?.length > 0, '删除记录带锚点，导入方才找得回那个元素')

await reload()
const report = await page.evaluate(data => window.__visualRevise.lib.importJSON(data), json)
await page.waitForTimeout(400)
const afterImport = await titles()
ok(report.removals === 1 && afterImport.length === 2,
   `导入后按锚点定位并删除：${afterImport.join(' | ')}`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
