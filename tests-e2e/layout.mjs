import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[Layout 测试] Flow / 对齐九宫格 / 两段式间距\n')
await page.goto(origin)
await injectVisBug(page, origin)

await page.evaluate(() => {
  const mk = (cls, css, html = '<span>a</span><span>b</span>') => {
    const d = document.createElement('div')
    d.className = cls
    d.style.cssText = css + ';margin:16px'
    d.innerHTML = html
    document.querySelector('.hero').appendChild(d)
  }
  mk('lo-block', 'border:1px solid #ccc;padding:10px')
  mk('lo-row', 'display:flex;flex-direction:row;gap:8px;padding:12px 20px')
  // 都留出 padding：点 (2,2) 才落在容器自己身上而不是子元素上
  mk('lo-col', 'display:flex;flex-direction:column;gap:8px;padding:12px 20px')
  mk('lo-grid', 'display:grid;gap:8px;padding:12px 20px')
})

const panel = sel => page.locator(`visual-revise-panel ${sel}`)
const select = async sel => {
  await page.locator(sel).first().click({ position: { x: 2, y: 2 } })
  await page.waitForTimeout(400)
}
const styleOf = (sel, prop) => page.evaluate(([s, p]) =>
  document.querySelector(s).style.getPropertyValue(p), [sel, prop])
const activeFlow = () => panel('[data-flow][data-on]').getAttribute('data-flow')

// ── Flow 判定 ───────────────────────────────────────────────
await select('.lo-block')
ok(await activeFlow() === 'free', '普通块级元素 → 自由')
await select('.lo-row')
ok(await activeFlow() === 'horizontal', 'flex + row → 横向')
await select('.lo-col')
ok(await activeFlow() === 'vertical', 'flex + column → 纵向')
await select('.lo-grid')
ok(await activeFlow() === 'grid', 'grid → 网格')

// ── 按 Flow 显示控件 ────────────────────────────────────────
await select('.lo-block')
ok(await panel('.align-grid').count() === 0,
   'display:block 下不显示对齐九宫格——justify-content / align-items 在那里根本不生效')
ok(await panel('input[data-prop="gap"]').count() === 0, 'block 下也不显示间隔')
ok(await panel('.side-pair').count() === 2, '内边距 / 外边距照常显示')

await select('.lo-row')
ok(await panel('.align-grid').count() === 1, 'flex 下出现对齐九宫格')
ok(await panel('input[data-prop="gap"]').count() === 1, 'flex 下出现间隔')

await select('.lo-grid')
ok(await panel('input[data-prop="column-gap"]').count() === 1,
   'grid 下间隔拆成列 / 行两个')

// ── 切换 Flow ───────────────────────────────────────────────
await select('.lo-block')
await panel('[data-flow="horizontal"]').click()
await page.waitForTimeout(450)
ok(await styleOf('.lo-block', 'display') === 'flex' &&
   await styleOf('.lo-block', 'flex-direction') === 'row',
   '切到横向写入 display:flex + flex-direction:row')

await panel('[data-flow="free"]').click()
await page.waitForTimeout(450)
const cleaned = await page.evaluate(() => {
  const s = document.querySelector('.lo-block').style
  return { display: s.display, dir: s.flexDirection, jc: s.justifyContent }
})
ok(cleaned.display === 'block' && !cleaned.dir && !cleaned.jc,
   `切回自由时清掉不再生效的属性：${JSON.stringify(cleaned)}`)

// ── 九宫格：横向 ────────────────────────────────────────────
await select('.lo-row')
await panel('.align-cell[data-col="2"][data-row="0"]').click()
await page.waitForTimeout(400)
const rowAlign = await page.evaluate(() => {
  const s = document.querySelector('.lo-row').style
  return { jc: s.justifyContent, ai: s.alignItems }
})
ok(rowAlign.jc === 'flex-end' && rowAlign.ai === 'flex-start',
   `横向排列：右上 → justify-content:flex-end + align-items:flex-start（${JSON.stringify(rowAlign)}）`)

// ── 九宫格：纵向要翻转轴向 ──────────────────────────────────
await select('.lo-col')
await panel('.align-cell[data-col="2"][data-row="0"]').click()
await page.waitForTimeout(400)
const colAlign = await page.evaluate(() => {
  const s = document.querySelector('.lo-col').style
  return { jc: s.justifyContent, ai: s.alignItems }
})
ok(colAlign.jc === 'flex-start' && colAlign.ai === 'flex-end',
   `纵向排列：同一格「右上」要翻转轴向——主轴变成垂直，所以 justify 管上下、align 管左右（${JSON.stringify(colAlign)}）`)

// 选中态回读也要跟着翻转，否则点完格子高亮会跳到别处
const litCell = await panel('.align-cell[data-on]').evaluate(el =>
  ({ col: el.dataset.col, row: el.dataset.row }))
ok(litCell.col === '2' && litCell.row === '0',
   `纵向下高亮的仍是刚点的那一格：${JSON.stringify(litCell)}`)

// ── 换行 ────────────────────────────────────────────────────
await select('.lo-row')
await panel('.wrap-toggle').click()
await page.waitForTimeout(400)
ok(await styleOf('.lo-row', 'flex-wrap') === 'wrap', '换行按钮写入 flex-wrap:wrap')

await select('.lo-block')
ok(await panel('.wrap-toggle').isDisabled(), '非 flex 排列时换行按钮禁用')

// ── 两段式间距 ──────────────────────────────────────────────
await select('.lo-row')
const padH = panel('input[data-pair="padding:horizontal"]')
const padV = panel('input[data-pair="padding:vertical"]')
ok(await padH.count() === 1 && await padV.count() === 1,
   '内边距默认收成「水平 / 垂直」两个框，而不是四行')
ok(await padH.inputValue() === '20' && await padV.inputValue() === '12',
   `左右 / 上下分别读出（只显示数字，px 由写入时补回）：${await padH.inputValue()} / ${await padV.inputValue()}`)

await padH.fill('32')
await padH.press('Enter')
await page.waitForTimeout(400)
const bothSides = await page.evaluate(() => {
  const s = document.querySelector('.lo-row').style
  return { l: s.paddingLeft, r: s.paddingRight, t: s.paddingTop }
})
ok(bothSides.l === '32px' && bothSides.r === '32px' && bothSides.t === '12px',
   `一个框写两条声明，另一轴不受影响：${JSON.stringify(bothSides)}`)

// 两边不等时把两个值都写出来，而不是一句「混合」
await page.evaluate(() => { document.querySelector('.lo-row').style.paddingLeft = '4px' })
await select('.lo-grid'); await select('.lo-row')
ok(await padH.inputValue() === '4, 32',
   `左右不等时两个值都显示（"混合"只说明不一样，具体多少还得展开四边才看得到）：${await padH.inputValue()}`)

// 显示成什么样就能照着改回去
await padH.fill('8, 40')
await padH.press('Enter')
await page.waitForTimeout(400)
const pairWrote = await page.evaluate(() => {
  const s = document.querySelector('.lo-row').style
  return { l: s.paddingLeft, r: s.paddingRight }
})
ok(pairWrote.l === '8px' && pairWrote.r === '40px',
   `输入 "8, 40" 分别写给左右两条：${JSON.stringify(pairWrote)}`)

await padH.fill('16')
await padH.press('Enter')
await page.waitForTimeout(400)
const single = await page.evaluate(() => {
  const s = document.querySelector('.lo-row').style
  return { l: s.paddingLeft, r: s.paddingRight }
})
ok(single.l === '16px' && single.r === '16px', '只填一个值时两边一起写')

// ── 展开成四边 ──────────────────────────────────────────────
ok(await panel('input[data-prop="padding-top"]').count() === 0, '默认没有四边独立字段')
await panel('.expand-sides[data-kind="padding"]').click()
await page.waitForTimeout(400)
ok(await panel('input[data-prop="padding-top"]').count() === 1, '展开后出现四边独立字段')
await panel('.collapse-sides[data-kind="padding"]').click()
await page.waitForTimeout(400)
ok(await panel('input[data-pair="padding:horizontal"]').count() === 1, '可以收回两段式')

// ── 裁剪内容 ────────────────────────────────────────────────
await panel('.clip-toggle').check()
await page.waitForTimeout(400)
ok(await styleOf('.lo-row', 'overflow') === 'hidden', '勾选裁剪内容写入 overflow:hidden')
await panel('.clip-toggle').uncheck()
await page.waitForTimeout(400)
ok(await styleOf('.lo-row', 'overflow') === '',
   '取消勾选是清掉声明，而不是写 visible——写死会盖掉样式表里本来的 overflow')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
