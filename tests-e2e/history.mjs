import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[撤销 / 重做测试] 粒度合并 / 批量 / 快捷键\n')
await page.goto(origin)
await injectVisBug(page, origin)

const panel = sel => page.locator(`visual-revise-panel ${sel}`)
const bar = sel => page.locator(`visual-revise-toolbar ${sel}`)
const styleOf = (sel, prop) => page.evaluate(([s, p]) =>
  document.querySelector(s).style.getPropertyValue(p), [sel, prop])
const hist = () => page.evaluate(() => {
  const h = window.__visualRevise.store.history
  return { depth: h.depth, canUndo: h.canUndo, canRedo: h.canRedo, label: h.undoLabel }
})
// 焦点留在面板输入框里时 ⌘Z 本就该让路给浏览器的文本撤销，
// 所以按快捷键之前要先真的失焦——焦点可能藏在 shadow root 里，得逐层往下找
const blur = () => page.evaluate(() => {
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  el?.blur?.()
})
const undo = async () => { await blur(); await page.keyboard.press('Meta+z'); await page.waitForTimeout(350) }
const redo = async () => { await blur(); await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(350) }

const card = '.curve-card:nth-of-type(2)'
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)

// ── 一次改动 → 撤销 → 重做 ──────────────────────────────────
await panel('input[data-prop="border-radius"]').fill('40')
await panel('input[data-prop="border-radius"]').press('Enter')
await page.waitForTimeout(400)
ok(await styleOf(card, 'border-radius') === '40px', '改了圆角')
ok((await hist()).depth === 1, `入栈一条：depth=${(await hist()).depth}`)

await undo()
ok(await styleOf(card, 'border-radius') === '', `⌘Z 撤回：${await styleOf(card, 'border-radius') || '（空）'}`)
ok((await hist()).canRedo, '撤销后可重做')

await redo()
ok(await styleOf(card, 'border-radius') === '40px', '⌘⇧Z 重做')

// ── 连续调值合并成一条 ──────────────────────────────────────
await page.evaluate(() => window.__visualRevise.store.history.clear())
await page.evaluate(() => {
  // 模拟拖动：短时间内对同一属性连写多次
  const el = document.querySelectorAll('.curve-card')[1]
  for (let v = 10; v <= 30; v++) window.__visualRevise.store.applyProp(el, 'border-radius', `${v}px`)
})
await page.waitForTimeout(300)
const merged = await hist()
ok(merged.depth === 1,
   `21 次连续同属性写入合并成 1 条（拖一次标签能产生上百次，不合并的话 ⌘Z 要按上百下）：depth=${merged.depth}`)

await undo()
ok(await styleOf(card, 'border-radius') === '40px',
   `撤回到这串连续改动之前，而不是退一格：${await styleOf(card, 'border-radius')}`)

// 不同属性不合并
await page.evaluate(() => window.__visualRevise.store.history.clear())
await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[1]
  const s = window.__visualRevise.store
  s.applyProp(el, 'opacity', '0.5')
  s.applyProp(el, 'border-radius', '8px')
})
await page.waitForTimeout(300)
ok((await hist()).depth === 2, '不同属性各自入栈，不会被合并掉')

// ── 批量操作一次撤完 ────────────────────────────────────────
await page.evaluate(() => window.__visualRevise.store.history.clear())
await page.evaluate(() => {
  const d = document.createElement('div')
  d.className = 'h-box'
  d.style.cssText = 'padding:12px;margin:16px;border:1px solid #ccc'
  d.innerHTML = '<span>a</span><span>b</span>'
  document.querySelector('.hero').appendChild(d)
})
await page.keyboard.press('Escape')
await page.locator('.h-box').click({ position: { x: 2, y: 2 } })
await page.waitForTimeout(400)

await panel('[data-flow="horizontal"]').click()
await page.waitForTimeout(450)
const flowWrote = await page.evaluate(() => {
  const s = document.querySelector('.h-box').style
  return { display: s.display, dir: s.flexDirection }
})
ok(flowWrote.display === 'flex' && flowWrote.dir === 'row', '切排列写了多条属性')
ok((await hist()).depth === 1,
   `切排列一次写 display + flex-direction 等多条，但只入栈一条：depth=${(await hist()).depth}`)

await undo()
const flowUndone = await page.evaluate(() => {
  const s = document.querySelector('.h-box').style
  return { display: s.display, dir: s.flexDirection }
})
ok(!flowUndone.display && !flowUndone.dir,
   `一次 ⌘Z 全部撤完，不会只撤一半：${JSON.stringify(flowUndone)}`)

// ── 删除可撤回 ──────────────────────────────────────────────
await page.evaluate(() => window.__visualRevise.store.history.clear())
const beforeDel = await page.evaluate(() => document.querySelectorAll('.curve-card').length)
await page.keyboard.press('Escape')
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.keyboard.press('Delete')
await page.waitForTimeout(450)
ok(await page.evaluate(() => document.querySelectorAll('.curve-card').length) === beforeDel - 1, '删掉一个')

await undo()
const backTitles = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.curve-card .card-title')).map(e => e.textContent.trim()))
ok(backTitles.length === beforeDel && backTitles[1] === 'Thinking Five',
   `⌘Z 把元素放回原位：${backTitles.join(' | ')}`)
ok((await page.evaluate(() => window.__visualRevise.store.stats())).removals === 0,
   '删除记录也一并撤销，不会留下一条「已删除」的幽灵')

// ── 移动元素：撤销 / 重做 / 守卫 ────────────────────────────
// 重排不再写 CSS order，而是真的搬 DOM 节点。历史栈必须整条整条地退，
// 且任何一个非法落点都不能让 insertBefore 抛出去——history 的重放循环
// 一旦抛错就会跳过这条历史剩下的 op，栈从此和页面对不上。
await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  window.__visualRevise.store.history.clear()
  document.getElementById('mv')?.remove()
  const box = document.createElement('div')
  box.id = 'mv'
  box.innerHTML = '<div id="mv-a"><i class="mv-x">x1</i><i class="mv-y">y1</i></div><div id="mv-b"></div>'
  document.querySelector('.hero').appendChild(box)
})
const where = () => page.evaluate(() => ({
  a: [...document.querySelectorAll('#mv-a > i')].map(n => n.className).join(','),
  b: [...document.querySelectorAll('#mv-b > i')].map(n => n.className).join(','),
}))

await page.evaluate(() => {
  const x = document.querySelector('.mv-x')
  window.__visualRevise.store.moveElement(x, document.getElementById('mv-b'), null)
})
await page.waitForTimeout(250)
ok((await where()).b === 'mv-x', `跨容器移动真的改了 DOM（#mv-b 里现在是 ${(await where()).b}）`)
ok((await page.evaluate(() => window.__visualRevise.store.stats().moves)) === 1,
   '移动记入 moves 一条')
ok((await hist()).depth === 1, `一次移动压一条历史：depth=${(await hist()).depth}`)

await undo()
ok((await where()).a === 'mv-x,mv-y' && (await where()).b === '',
   `⌘Z 一次撤回整次移动（#mv-a = ${(await where()).a}）`)
ok((await page.evaluate(() => window.__visualRevise.store.stats().moves)) === 0,
   '撤销后移动记录也消失')

await redo()
ok((await where()).b === 'mv-x', '⌘⇧Z 重做移动')
ok((await page.evaluate(() => window.__visualRevise.store.stats().moves)) === 1,
   '重做后记录回来')

// 移回原位 → 这条记录该消失，而不是留下一条「从 A 到 A」
await page.evaluate(() => {
  const x = document.querySelector('.mv-x')
  window.__visualRevise.store.moveElement(x, document.getElementById('mv-a'),
    document.querySelector('.mv-y'))
})
await page.waitForTimeout(250)
ok((await where()).a === 'mv-x,mv-y', '手动移回原位')
ok((await page.evaluate(() => window.__visualRevise.store.stats().moves)) === 0,
   '移回原位后改动记录里那条消失')

// 守卫：拖进自己 / 拖进自己的后代 / 拖到 <html> 下，一律拒绝且不抛错
const guards = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const a = document.getElementById('mv-a')
  const x = document.querySelector('.mv-x')
  return {
    self:  s.moveElement(a, a, null),
    child: s.moveElement(a, x, null),
    root:  s.moveElement(a, document.documentElement, null),
    noop:  s.moveElement(x, a, document.querySelector('.mv-y')),   // 已经就在这儿
  }
})
ok(!guards.self && !guards.child && !guards.root,
   `拒绝非法落点（自己=${guards.self} 后代=${guards.child} <html>=${guards.root}）`)
ok(!guards.noop, '原地放下不记一条移动')

// toNext 失联时退化成 append，不能抛 NotFoundError
const orphanNext = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const b = document.getElementById('mv-b')
  const ghost = document.createElement('i')      // 从来没进过 #mv-b
  try {
    const ok = s.moveElement(document.querySelector('.mv-y'), b, ghost)
    return { ok, b: [...b.children].map(n => n.className).join(',') }
  } catch (err) { return { error: err.message } }
})
ok(orphanNext.b === 'mv-y', `toNext 不是目标容器的孩子时退化成 append（${JSON.stringify(orphanNext)}）`)

// 「重置全部」之后 ⌘Z 要能把移动一起救回来
await page.evaluate(() => window.__visualRevise.store.history.clear())
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.moveElement(document.querySelector('.mv-x'), document.getElementById('mv-b'), null)
})
await page.waitForTimeout(250)
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(300)
ok((await where()).a.startsWith('mv-x') && (await page.evaluate(() =>
  window.__visualRevise.store.stats().moves)) === 0, '「重置全部」把移动过的元素放回原位')

await undo()
ok((await where()).b.split(',').includes('mv-x'),
   `⌘Z 撤销「重置全部」后移动也回来了（#mv-b = ${(await where()).b}）`)

await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  window.__visualRevise.store.history.clear()
  document.getElementById('mv')?.remove()
})
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// ── 「重置全部」可撤回 ──────────────────────────────────────
await page.evaluate(() => window.__visualRevise.store.history.clear())
await page.keyboard.press('Escape')
await page.locator('.curve-card').nth(0).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await panel('input[data-prop="border-radius"]').fill('24')
await panel('input[data-prop="border-radius"]').press('Enter')
await page.waitForTimeout(400)

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(400)
ok(await styleOf('.curve-card:nth-of-type(1)', 'border-radius') === '', '重置全部清掉了改动')

await undo()
ok(await styleOf('.curve-card:nth-of-type(1)', 'border-radius') === '24px',
   `⌘Z 能把「重置全部」救回来——误点了重置却没法反悔，比不能撤销更糟：${await styleOf('.curve-card:nth-of-type(1)', 'border-radius')}`)

// ── 新操作断掉重做链 ────────────────────────────────────────
await undo()
ok((await hist()).canRedo, '撤销后有重做链')
await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[0]
  window.__visualRevise.store.applyProp(el, 'opacity', '0.8')
})
await page.waitForTimeout(300)
ok(!(await hist()).canRedo, '新操作断掉重做链（所有编辑器的通行约定）')

// ── 输入框里让路 ────────────────────────────────────────────
await page.evaluate(() => {
  const i = document.createElement('input')
  i.className = 'h-input'
  i.value = 'abc'
  document.querySelector('.hero').appendChild(i)
})
const depthBefore = (await hist()).depth
await page.locator('.h-input').click()
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
ok((await hist()).depth === depthBefore,
   '在页面输入框里按 ⌘Z 不动我们的历史——用户想退一个字符，不该把整次改稿撤掉')

// ── 工具条按钮 ──────────────────────────────────────────────
await page.keyboard.press('Escape')
ok(!(await bar('.undo').isDisabled()), '有历史时撤销按钮可用')
await bar('.undo').hover()
await page.waitForTimeout(200)
const tip = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const box = sr.querySelector('.tip')
  return box?.hidden ? null : {
    label: box.querySelector('.tip-label').textContent,
    key: box.querySelector('.tip-key').textContent,
  }
})
ok(tip?.label.includes('撤销：'), `hover 气泡写明将撤销什么：${tip?.label}`)
ok(tip?.key === '⌘Z', `气泡里带着快捷键：${tip?.key}`)

await page.evaluate(() => window.__visualRevise.store.history.clear())
await page.waitForTimeout(300)
ok(await bar('.undo').isDisabled() && await bar('.redo').isDisabled(), '没有历史时两个按钮都灰掉')

// ── 上限 100 条 ─────────────────────────────────────────────
await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[0]
  const s = window.__visualRevise.store
  // 每次换属性，避免被合并
  const props = ['opacity', 'border-radius', 'z-index']
  for (let i = 0; i < 130; i++) s.applyProp(el, props[i % 3], String(1 + i % 7) + (i % 3 === 1 ? 'px' : ''))
})
await page.waitForTimeout(400)
ok((await hist()).depth === 100,
   `栈满 100 条后丢最旧的（每条都持有 DOM 引用，不设上限改稿一小时能攒下几千条）：depth=${(await hist()).depth}`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
