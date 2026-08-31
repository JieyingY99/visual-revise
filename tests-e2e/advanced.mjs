import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[批次 3 测试] 共享元素 / 拖拽重排 / JSON / 本地字体\n')
await page.goto(origin)
await injectVisBug(page, origin)

// ── 共享元素联动 ──
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)

const fp = await page.evaluate(() => {
  const { fingerprint, findSharedElements } = window.__visualRevise.lib
  const card = document.querySelectorAll('.curve-card')[1]
  return {
    same:   fingerprint(card) === fingerprint(document.querySelectorAll('.curve-card')[0]),
    differs: fingerprint(card) !== fingerprint(document.querySelector('.hero-title')),
    found:  findSharedElements(card).length,
  }
})
ok(fp.same, '同构卡片指纹相同')
ok(fp.differs, '不同结构元素指纹不同')
ok(fp.found === 2, `找到 ${fp.found} 个同构兄弟元素`)

await page.locator('visual-revise-panel .shared').click()
await page.waitForTimeout(300)
const radius = page.locator('visual-revise-panel input[data-prop="border-radius"]')
await radius.fill('20px')
await radius.dispatchEvent('change')
await page.waitForTimeout(300)

const allCards = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.borderRadius))
ok(allCards.every(r => r === '20px'), `共享模式：3 张卡片同步（${allCards.join(', ')}）`)

const sub = await page.locator('visual-revise-panel .sub').textContent()
ok(sub.includes('联动 3 个'), `面板显示联动数量：${sub}`)

// 关闭共享后只改当前元素
await page.locator('visual-revise-panel .shared').click()
await page.waitForTimeout(200)
const op = page.locator('visual-revise-panel input[data-prop="opacity"]')
await op.fill('0.5')
await op.dispatchEvent('change')
await page.waitForTimeout(300)
const opacities = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.opacity || ''))
ok(opacities.filter(Boolean).length === 1, `关闭共享后只改选中元素（${opacities.length - opacities.filter(Boolean).length} 个未受影响）`)

// ── 拖拽重排 ──
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.evaluate(() => window.__visualRevise.setReorderMode(true))
await page.waitForTimeout(200)
ok(await page.evaluate(() => window.__visualRevise.layoutDrag.active), '拖拽重排模式已开启')

// 落点取上边中点：卡片有 18px 圆角，角落 4px 处会穿透命中到父容器
const box0 = await page.locator('.curve-card').nth(0).boundingBox()
const box2 = await page.locator('.curve-card').nth(2).boundingBox()
await page.mouse.move(box2.x + box2.width / 2, box2.y + 8)
await page.mouse.down()
// 停在 card0 左侧（而非正中点）才明确表示"插到它前面"
await page.mouse.move(box0.x + 24, box0.y + 8, { steps: 12 })
await page.waitForTimeout(200)
const indicatorShown = await page.evaluate(() =>
  document.getElementById('visual-revise-drop-indicator')?.style.display)
ok(indicatorShown === 'block', '拖拽时显示插入位置指示线')
await page.mouse.up()
await page.waitForTimeout(300)

const orders = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.order))
ok(orders.every(o => o !== ''), `重排写入 order：[${orders.join(', ')}]`)
ok(orders[2] === '0', `被拖动的第 3 张卡片排到最前（order=${orders[2]}）`)

const orderRecorded = await page.evaluate(() =>
  window.__visualRevise.store.read().edits.some(e => e.changes.some(c => c.prop === 'order')))
ok(orderRecorded, 'order 改动被记入改动列表（可导出给 AI）')

// 回归：向后拖。索引若算在含被拖元素的序列上会整体偏一位。
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(200)
const boxes = []
for (let i = 0; i < 3; i++) boxes.push(await page.locator('.curve-card').nth(i).boundingBox())

// 把第 1 张拖到第 2 张与第 3 张之间：落点在两者中点之间
const between = (boxes[1].x + boxes[1].width / 2 + boxes[2].x + boxes[2].width / 2) / 2
await page.mouse.move(boxes[0].x + boxes[0].width / 2, boxes[0].y + 8)
await page.mouse.down()
await page.mouse.move(between, boxes[0].y + 8, { steps: 12 })
await page.waitForTimeout(200)
await page.mouse.up()
await page.waitForTimeout(300)

const backward = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.order))
ok(backward.join(',') === '1,0,2',
   `向后拖落在期望位置：order = [${backward.join(', ')}]（期望 1,0,2）`)

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.evaluate(() => window.__visualRevise.setReorderMode(false))

// ── JSON 导出 / 导入 ──
await page.evaluate(() => window.__visualRevise.store.undoEverything())
const exported = await page.evaluate(() => {
  const { exportJSON } = window.__visualRevise.lib
  const s = window.__visualRevise.store
  const card = document.querySelectorAll('.curve-card')[1]
  s.track(card)
  s.applyProp(card, 'border-radius', '12px')
  s.applyProp(card, 'padding-top', '28px')
  s.addComment(document.querySelector('.hero-title'), '标题加粗一点')
  return exportJSON({ url: 'http://example.test', viewport: '1440 × 900' })
})

ok(exported.schema === 1, 'JSON 含 schema 版本')
ok(exported.edits.length === 1 && exported.edits[0].changes.length === 2, 'JSON 含改动记录')
ok(exported.comments.length === 1, 'JSON 含评论')
ok(!!exported.edits[0].anchors.text?.length, 'JSON 含文本锚点（供跨环境匹配）')

// 重置后导入还原
const report = await page.evaluate(data => {
  const { importJSON } = window.__visualRevise.lib
  window.__visualRevise.store.undoEverything()
  const r = importJSON(data)
  return {
    report: r,
    radius: document.querySelectorAll('.curve-card')[1].style.borderRadius,
    padding: document.querySelectorAll('.curve-card')[1].style.paddingTop,
    comments: window.__visualRevise.store.stats().comments,
  }
}, exported)

ok(report.report.ok && report.report.matched.length === 1, '导入匹配到目标元素')
ok(report.radius === '12px' && report.padding === '28px',
   `导入还原改动：radius=${report.radius}, padding=${report.padding}`)
ok(report.comments === 1, '导入还原评论')

// 类名被改写时靠文本特征回退匹配
const fallback = await page.evaluate(data => {
  const { importJSON } = window.__visualRevise.lib
  window.__visualRevise.store.undoEverything()
  // 模拟另一次构建后类名被重新哈希
  document.querySelectorAll('.curve-card').forEach((c, i) => { c.className = `css-x${i}k9f` })
  const r = importJSON(data)
  return { via: r.matched[0]?.via, matched: r.matched.length, viaText: r.viaText }
}, exported)
ok(fallback.matched === 1 && fallback.via === 'text',
   `选择器失效时靠文本特征回退匹配成功（via=${fallback.via}）`)

// ── 本地字体降级 ──
const fontResult = await page.evaluate(async () => {
  const { loadLocalFonts, fontsSupported } = window.__visualRevise.lib
  return { supported: fontsSupported(), result: await loadLocalFonts() }
})
ok(typeof fontResult.supported === 'boolean', `本地字体 API 支持检测：${fontResult.supported}`)
ok(fontResult.result.ok || !!fontResult.result.reason,
   `未授权/不支持时给出可读原因并降级：${fontResult.result.reason || '已授权'}`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
