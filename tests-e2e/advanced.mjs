import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[批次 3 测试] 共享元素 / 拖拽移动 / JSON / 本地字体\n')
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
await op.fill('50')   // 面板里是百分比
await op.dispatchEvent('change')
await page.waitForTimeout(300)
const opacities = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.curve-card')).map(c => c.style.opacity || ''))
ok(opacities.filter(Boolean).length === 1, `关闭共享后只改选中元素（${opacities.length - opacities.filter(Boolean).length} 个未受影响）`)

// ── 拖拽移动 ──
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
ok(await page.evaluate(() => window.__visualRevise.layoutDrag.active), '选择模式下页面拖拽可用')

const titles = () => page.evaluate(() =>
  [...document.querySelectorAll('.cards > .curve-card .card-title')].map(t => t.textContent.trim()))
const before = await titles()

// 落点取上边缘偏左：卡片有 18px 圆角，角落 4px 处会穿透命中到父容器；
// 横排容器按 x 分三段，左 1/3 就是「插到它前面」
const box0 = await page.locator('.curve-card').nth(0).boundingBox()
const box2 = await page.locator('.curve-card').nth(2).boundingBox()
await page.mouse.move(box2.x + box2.width / 2, box2.y + 8)
await page.mouse.down()
await page.mouse.move(box0.x + 24, box0.y + 8, { steps: 12 })
await page.waitForTimeout(200)
const indicatorShown = await page.evaluate(() =>
  document.getElementById('visual-revise-drop-indicator')?.style.display)
ok(indicatorShown === 'block', '拖拽时显示插入位置指示线')
await page.mouse.up()
await page.waitForTimeout(350)

const moved = await titles()
ok(moved[0] === before[2], `被拖的第 3 张卡片排到最前（${before[0]} → ${moved[0]}）`)
ok(await page.evaluate(() =>
  [...document.querySelectorAll('.curve-card')].every(c => !c.style.order)),
   '移动改的是 DOM 顺序，不写 CSS order')
ok((await page.evaluate(() => window.__visualRevise.store.stats().moves)) === 1,
   '移动被记入改动列表（可导出给 AI）')

// 回归：向后拖。落点取的是「目标行的下一个元素」，取成目标本身会整体偏一位。
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(250)
const base = await titles()
const boxes = []
for (let i = 0; i < 3; i++) boxes.push(await page.locator('.curve-card').nth(i).boundingBox())

// 把第 1 张拖到第 2 张的右 1/3：插到第 2 张之后、第 3 张之前
await page.mouse.move(boxes[0].x + boxes[0].width / 2, boxes[0].y + 8)
await page.mouse.down()
await page.mouse.move(boxes[1].x + boxes[1].width - 20, boxes[1].y + 8, { steps: 12 })
await page.waitForTimeout(200)
await page.mouse.up()
await page.waitForTimeout(350)

const backward = await titles()
ok(backward.join(' | ') === [base[1], base[0], base[2]].join(' | '),
   `向后拖落在期望位置：${backward.join(' | ')}（期望 ${[base[1], base[0], base[2]].join(' | ')}）`)

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.evaluate(() => window.__visualRevise.setReorderMode(false))
await page.waitForTimeout(200)

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

ok(exported.schema === 5, `JSON 含 schema 版本：${exported.schema}`)
ok(Array.isArray(exported.assets),
   'v2 带 assets 字段（图片 base64 内嵌，导入方才拿得到换图用的那张图）')
ok(Array.isArray(exported.moves), 'v3 带 moves 字段（移动只出不进的话导入端记录数会对不上）')
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

  // 模拟另一次构建后类名被重新哈希，用完恢复以免污染后续用例
  const cards = Array.from(document.querySelectorAll('.curve-card'))
  const originals = cards.map(c => c.className)
  cards.forEach((c, i) => { c.className = `css-x${i}k9f` })

  const r = importJSON(data)

  cards.forEach((c, i) => { c.className = originals[i] })
  return { via: r.matched[0]?.via, matched: r.matched.length, viaText: r.viaText }
}, exported)
ok(fallback.matched === 1 && fallback.via === 'text',
   `选择器失效时靠文本特征回退匹配成功（via=${fallback.via}）`)

// 回归：含 CSS 非法字符的选择器不得中断整个导入
const tolerant = await page.evaluate(() => {
  const { importJSON } = window.__visualRevise.lib
  window.__visualRevise.store.undoEverything()

  // 故意用 v1 载荷：老版本导出的文件必须还能导入（v1 没有 attrs/assets 字段）
  const payload = {
    schema: 1,
    edits: [
      { selector: 'section.cards > article.curve-card:nth-of-type(2)',
        anchors: { tag: 'article', text: ['Thinking Five'], domPath: 'body > section.cards > article.curve-card' },
        changes: [{ prop: 'border-radius', from: '18px', to: '6px' }] },
      // Tailwind 风格类名：: / [ ] 在选择器里非法
      { selector: 'div.hover:bg-blue-500',
        anchors: { tag: 'div', text: ['不存在的文本锚点'], domPath: 'div.w-1/2 > div.top-[3px]' },
        changes: [{ prop: 'padding-top', from: '0px', to: '8px' }] },
      { selector: 'h1.hero-title',
        anchors: { tag: 'h1', text: ['A Gallery of Mathematical Loading Animations'], domPath: 'body > main.hero > h1.hero-title' },
        changes: [{ prop: 'font-size', from: '40px', to: '48px' }] },
    ],
    comments: [
      { seq: 1, selector: 'div.w-1/2', anchors: { tag: 'div', text: ['同样不存在'], domPath: 'div.top-[3px]' }, text: '这条也定位不到' },
    ],
  }

  const r = importJSON(payload)
  return {
    report: r,
    radius: document.querySelectorAll('.curve-card')[1].style.borderRadius,
    fontSize: document.querySelector('.hero-title').style.fontSize,
  }
})

ok(tolerant.report.ok, '非法选择器不再让整个导入抛错')
ok(tolerant.report.matched.length === 2,
   `可定位的记录全部应用（${tolerant.report.matched.length}/3）`)
ok(tolerant.radius === '6px' && tolerant.fontSize === '48px',
   `非法记录之后的记录仍被处理：radius=${tolerant.radius}, font-size=${tolerant.fontSize}`)
ok(tolerant.report.missing.length === 2,
   `定位不到的记录如实上报（${tolerant.report.missing.length} 条）`)

await page.evaluate(() => window.__visualRevise.store.undoEverything())

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
