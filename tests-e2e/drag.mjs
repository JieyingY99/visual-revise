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

// ── 拖拽中途取消：必须完整收尾，且不落下重排 ──
const box = await page.locator('.curve-card').nth(2).boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + 8)
await page.mouse.down()
await page.mouse.move(box.x - 200, box.y + 8, { steps: 8 })
await page.waitForTimeout(200)

const mid = await dragState()
ok(mid.indicator === 'block' && mid.opacity === '0.4',
   `拖拽进行中：指示线 ${mid.indicator}，被拖元素半透明 ${mid.opacity}`)

await page.evaluate(() => window.__visualRevise.setReorderMode(false))
await page.waitForTimeout(200)

const cancelled = await dragState()
ok(cancelled.indicator === 'none', '取消后指示线隐藏')
ok(cancelled.opacity === '', '取消后元素透明度还原')
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
ok(residue.indicator === 'none', `十轮中断后指示线已隐藏`)
ok(residue.active === false, `十轮中断后模式已关闭`)

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

const revived = await page.evaluate(() =>
  window.__visualRevise.store.read().edits.flatMap(e => e.changes).filter(c => c.prop === 'order').length)
ok(revived === 3, `十轮中断之后拖拽仍能正常提交重排（写入 ${revived} 个 order）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
