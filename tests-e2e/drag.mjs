import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[拖拽重排测试] 独立套件——指针时序敏感，不与其他用例共享状态\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.evaluate(() => window.__visualRevise.setReorderMode(true))
await page.waitForTimeout(300)

const orders = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.order))
const dragState = () => page.evaluate(() => ({
  indicator: document.getElementById('visual-revise-drop-indicator')?.style.display ?? '无元素',
  opacity:   document.querySelectorAll('.curve-card')[2].style.opacity,
  props:     window.__visualRevise.store.stats().props,
}))

// ── 进入模式后可拖区域必须可见 ──
const hints = await page.evaluate(() => ({
  droppable: document.querySelectorAll('[data-vr-droppable]').length,
  draggable: document.querySelectorAll('[data-vr-draggable]').length,
  styleTag:  !!document.getElementById('visual-revise-drag-hints'),
  cardsMarked: document.querySelector('.cards')?.hasAttribute('data-vr-droppable'),
  // 标记不能写进 inline style，否则会被当成用户改动
  noInlinePollution: Array.from(document.querySelectorAll('.curve-card'))
    .every(c => !c.getAttribute('style')),
}))
ok(hints.styleTag, '已注入可拖区域的提示样式')
ok(hints.cardsMarked, 'flex 容器被标记为可拖放区域')
ok(hints.draggable >= 3, `可拖子元素已标记（${hints.draggable} 个）`)
ok(hints.noInlinePollution, '标记不写 inline style，不污染改动记录')
ok((await page.evaluate(() => window.__visualRevise.store.stats().props)) === 0,
   '进入模式本身不产生任何改动记录')

// ── 拖拽中途取消：必须完整收尾，且不落下重排 ──
const box = await page.locator('.curve-card').nth(2).boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + 8)
await page.mouse.down()
await page.mouse.move(box.x - 200, box.y + 8, { steps: 8 })
await page.waitForTimeout(200)

const mid = await dragState()
ok(mid.indicator === 'block' && mid.opacity === '0.25',
   `拖拽进行中：指示线 ${mid.indicator}，被拖元素压暗 ${mid.opacity}`)

// 拖影必须存在并跟随指针
const ghost1 = await page.evaluate(() => {
  const g = document.getElementById('visual-revise-drag-ghost')
  return g ? { left: parseFloat(g.style.left), top: parseFloat(g.style.top),
               width: parseFloat(g.style.width), tag: g.tagName,
               isOwnUI: g.hasAttribute('data-visual-revise-ui'),
               pointerEvents: g.style.pointerEvents } : null
})
ok(!!ghost1, '拖拽时生成拖影')
ok(ghost1?.tag === 'ARTICLE', `拖影是被拖元素的克隆（${ghost1?.tag}）`)
ok(ghost1?.isOwnUI && ghost1?.pointerEvents === 'none',
   '拖影标记为编辑器 UI 且不拦截指针（不会被自己选中）')

await page.mouse.move(box.x - 320, box.y + 60, { steps: 4 })
await page.waitForTimeout(120)
const ghost2 = await page.evaluate(() => {
  const g = document.getElementById('visual-revise-drag-ghost')
  return g ? { left: parseFloat(g.style.left), top: parseFloat(g.style.top) } : null
})
ok(ghost2 && ghost2.left < ghost1.left && ghost2.top > ghost1.top,
   `拖影跟随指针移动（${ghost1.left},${ghost1.top} → ${ghost2.left},${ghost2.top}）`)

await page.evaluate(() => window.__visualRevise.setReorderMode(false))
await page.waitForTimeout(200)

const cancelled = await dragState()
ok(cancelled.indicator === 'none', '取消后指示线隐藏')
ok(cancelled.opacity === '', '取消后元素透明度还原')
ok(await page.evaluate(() => !document.getElementById('visual-revise-drag-ghost')),
   '取消后拖影已移除')
ok(cancelled.props === 0, `取消不落下重排（改动 ${cancelled.props} 项）`)
ok((await orders()).every(o => o === ''), '取消后无 order 写入')

// 残留的 pointerup 不应再触发已取消的拖拽
await page.mouse.up()
await page.waitForTimeout(200)
ok((await orders()).every(o => o === ''), '取消后残留的 pointerup 不再生效')

// ── 取消之后重新拖拽仍然正常（监听未被清空过头）──
await page.evaluate(() => window.__visualRevise.setReorderMode(true))
await page.waitForTimeout(200)

const b0 = await page.locator('.curve-card').nth(0).boundingBox()
const b2 = await page.locator('.curve-card').nth(2).boundingBox()
await page.mouse.move(b2.x + b2.width / 2, b2.y + 8)
await page.mouse.down()
await page.mouse.move(b0.x + 24, b0.y + 8, { steps: 10 })
await page.waitForTimeout(150)
await page.mouse.up()
await page.waitForTimeout(300)

const after = await orders()
ok(after.join(',') === '1,2,0', `取消后重新拖拽仍正常：order = [${after}]`)

// ── 反复中断不累积副作用 ──
// 每次中断若留下未解绑的 pointermove/pointerup，后续每个指针事件都会
// 白跑一遍旧处理器；这里断言十轮中断后 store 与 DOM 均无残留。
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(200)

for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.__visualRevise.setReorderMode(true))
  await page.waitForTimeout(50)
  const b = await page.locator('.curve-card').nth(1).boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + 8)
  await page.mouse.down()
  await page.mouse.move(b.x - 40, b.y + 8, { steps: 3 })
  await page.waitForTimeout(50)
  await page.evaluate(() => window.__visualRevise.setReorderMode(false))
  await page.mouse.up()
  await page.waitForTimeout(50)
}

const residue = await page.evaluate(() => ({
  props:     window.__visualRevise.store.stats().props,
  orders:    Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.order),
  opacities: Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.opacity),
  indicator: document.getElementById('visual-revise-drop-indicator')?.style.display,
  active:    window.__visualRevise.layoutDrag.active,
}))

ok(residue.props === 0, `十轮中断后无改动残留（${residue.props} 项）`)
ok(residue.orders.every(o => o === ''), `十轮中断后无 order 残留`)
ok(residue.opacities.every(o => o === ''), `十轮中断后无透明度残留`)
ok(await page.evaluate(() => !document.getElementById('visual-revise-drag-ghost')),
   '十轮中断后无拖影残留')
ok(residue.indicator === 'none', `十轮中断后指示线已隐藏`)
ok(residue.active === false, `十轮中断后模式已关闭`)
ok(await page.evaluate(() => document.querySelectorAll('[data-vr-droppable]').length) === 0,
   '关闭模式后可拖标记已清除')

// 之后仍能正常拖拽
await page.evaluate(() => window.__visualRevise.setReorderMode(true))
await page.waitForTimeout(300)
const d0 = await page.locator('.curve-card').nth(0).boundingBox()
const d2 = await page.locator('.curve-card').nth(2).boundingBox()
await page.mouse.move(d2.x + d2.width / 2, d2.y + 8)
await page.mouse.down()
await page.mouse.move(d0.x + 24, d0.y + 8, { steps: 10 })
await page.waitForTimeout(150)
await page.mouse.up()
await page.waitForTimeout(300)

// 断言重排结果本身，而不是改动条数：落回 order:0 的元素与默认值相同，
// 会被"等值不记录"正确过滤掉，条数取决于最终落位
const revived = await page.evaluate(() => ({
  orders: Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.order),
  recorded: window.__visualRevise.store.read().edits
    .flatMap(e => e.changes).filter(c => c.prop === 'order').length,
}))
ok(revived.orders.join(',') === '1,2,0',
   `十轮中断之后拖拽仍能正常提交重排：order = [${revived.orders}]`)
ok(revived.recorded === 2,
   `落回默认值的那一项不计入改动（记录 ${revived.recorded} 条，写入 3 个 order）`)

// ── 提示词必须表达「顺序意图」，而不是一串 order 数值 ──
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const title = document.querySelector('.hero-title')
  s.track(title)
  s.applyProp(title, 'font-size', '52px')   // 混入一条普通样式改动
})
await page.waitForTimeout(300)

const prompt = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))

ok(prompt.includes('## 元素重新排序'), '提示词含「元素重新排序」段落')
ok(/调整后的顺序（从前到后）/.test(prompt), '给出调整后的顺序')
ok(/原顺序：/.test(prompt), '同时给出原顺序供对照')

const orderSection = prompt.slice(prompt.indexOf('## 元素重新排序'))
ok(/1\. 「Thinking Nine」/.test(orderSection),
   `新顺序首位是被拖动的元素：${orderSection.split('\n').find(l => l.startsWith('1.'))?.trim()}`)
ok(!/「[^」]{40,}」/.test(orderSection), '元素名取短文本，不是整棵子树拼成的长串')

ok(!/\| order \|/.test(prompt) && !/order.*→/.test(prompt.split('## 元素重新排序')[0]),
   'order 数值不再出现在属性改动表里')
ok(prompt.includes('不建议改用 CSS `order`') && prompt.includes('键盘 Tab'),
   '说明了直接改源码顺序的理由（order 会破坏键盘与读屏顺序）')
ok(prompt.includes('font-size'), '同时存在的普通样式改动不受影响')
ok(/改动：1 处元素样式，1 处顺序调整/.test(prompt),
   `摘要分别统计两类改动：${prompt.split('\n').find(l => l.startsWith('改动：'))}`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
