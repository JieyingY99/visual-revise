import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[Grid 测试] 轨道解析 / 可视化选择 / 二级设置\n')
await page.goto(origin)
await injectVisBug(page, origin)

await page.evaluate(() => {
  const mk = (cls, css) => {
    const d = document.createElement('div')
    d.className = cls
    d.style.cssText = css + ';padding:12px 20px;margin:16px'
    d.innerHTML = '<span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>'
    document.querySelector('.hero').appendChild(d)
  }
  mk('gr-3', 'display:grid;grid-template-columns:repeat(3, 1fr);gap:10px')
  mk('gr-mixed', 'display:grid;grid-template-columns:200px 1fr auto;gap:10px')
})

const panel = sel => page.locator(`visual-revise-panel ${sel}`)
const select = async sel => {
  await page.locator(sel).first().click({ position: { x: 2, y: 2 } })
  await page.waitForTimeout(450)
}
const tracks = sel => page.evaluate(s => {
  const { parseTracks } = window.__visualRevise.lib
  return parseTracks(document.querySelector(s).style.gridTemplateColumns)
}, sel)

// ── 轨道解析 ────────────────────────────────────────────────
const lib = await page.evaluate(() => {
  const { parseTracks, serializeTracks } = window.__visualRevise.lib
  return {
    repeat: parseTracks('repeat(3, 1fr)'),
    mixed:  parseTracks('200px 1fr auto'),
    minmax: parseTracks('minmax(100px, 1fr) 1fr'),
    none:   parseTracks('none'),
    roundTrip: serializeTracks(parseTracks('repeat(3, 1fr)')),
    mixedOut:  serializeTracks(parseTracks('200px 1fr auto')),
  }
})
ok(lib.repeat.length === 3 && lib.repeat.every(t => t.type === 'fill'),
   'repeat(3, 1fr) 展开成 3 条等分轨道')
ok(JSON.stringify(lib.mixed.map(t => t.type)) === '["fixed","fill","hug"]',
   `混合轨道各归其类：${lib.mixed.map(t => t.type).join(' / ')}`)
ok(lib.minmax.length === 2,
   'minmax(100px, 1fr) 算一条轨道——按空格切分时要跳过括号内的空格')
ok(lib.none.length === 0, 'none 解析成空')
ok(lib.roundTrip === 'repeat(3, 1fr)',
   `全部相同的轨道写回 repeat()，那是人手写 CSS 的样子：${lib.roundTrip}`)
ok(lib.mixedOut === '200px 1fr auto', `不同的逐条列出：${lib.mixedOut}`)

// ── 面板入口 ────────────────────────────────────────────────
await select('.gr-3')
ok(await panel('.grid-shape').count() === 1, 'grid 元素显示网格形状入口')
ok((await panel('.grid-shape').textContent()).includes('3 ×'),
   `形状按钮显示当前行列：${(await panel('.grid-shape').textContent()).trim()}`)

// ── 可视化选择 ──────────────────────────────────────────────
await panel('.grid-shape').click()
await page.waitForTimeout(400)
ok(await page.locator('#visual-revise-menu .gp-dots').count() === 1, '点开出现点阵选择器')

await page.locator('#visual-revise-menu .gp-dot[data-c="4"][data-r="2"]').hover()
await page.waitForTimeout(250)
ok((await page.locator('#visual-revise-menu .gp-hint').textContent()).trim() === '4 × 2',
   'hover 时提示将要设定的行列数')
const hot = await page.locator('#visual-revise-menu .gp-dot[data-hot]').count()
ok(hot === 8, `高亮的是左上到当前格的整块矩形（4×2=8 格，实际 ${hot}）`)

await page.locator('#visual-revise-menu .gp-dot[data-c="4"][data-r="2"]').click()
await page.waitForTimeout(500)

const applied = await page.evaluate(() => {
  const s = document.querySelector('.gr-3').style
  return { cols: s.gridTemplateColumns, rows: s.gridTemplateRows }
})
ok(applied.cols === 'repeat(4, 1fr)' && applied.rows === 'repeat(2, 1fr)',
   `点击写入行列：${JSON.stringify(applied)}`)

// 行留空表示交给隐式网格
await panel('.grid-shape').click()
await page.waitForTimeout(350)
await page.locator('#visual-revise-menu .gp-n[data-axis="rows"]').fill('')
await page.locator('#visual-revise-menu .gp-n[data-axis="columns"]').fill('2')
await page.locator('#visual-revise-menu .gp-n[data-axis="columns"]').press('Enter')
await page.waitForTimeout(500)
const implicit = await page.evaluate(() => {
  const s = document.querySelector('.gr-3').style
  return { cols: s.gridTemplateColumns, rows: s.gridTemplateRows }
})
ok(implicit.cols === 'repeat(2, 1fr)' && !implicit.rows,
   `行数留空 = 交给隐式网格，不写 grid-template-rows：${JSON.stringify(implicit)}`)

// ── 二级设置面板 ────────────────────────────────────────────
await panel('.grid-shape').click()
await page.waitForTimeout(350)
await page.locator('#visual-revise-menu .gp-settings').click()
await page.waitForTimeout(500)

ok((await panel('.tag').textContent()).includes('网格设置'), '进入二级面板')
ok(await panel('.track').count() === 2, `列出当前的 2 条列轨道：${await panel('.track').count()}`)
ok(await panel('vr-select[data-track]').first().getAttribute('value') === 'fill',
   '轨道类型读出为等分')

// 加一条
await panel('.add-track[data-axis="columns"]').click()
await page.waitForTimeout(450)
ok((await tracks('.gr-3')).length === 3, '＋ 添加一条轨道')

// 改类型：换成固定，值要跟着换成该类型的默认写法
await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sel = sr.querySelectorAll('vr-select[data-track]')[2]
  sel.value = 'fixed'
  sel.dispatchEvent(new CustomEvent('vr-select', {
    bubbles: true, composed: true, detail: { value: 'fixed' },
  }))
})
await page.waitForTimeout(450)
const afterType = await tracks('.gr-3')
ok(afterType[2].type === 'fixed' && afterType[2].value === '100px',
   `换类型时值换成该类型的默认写法，而不是把 1fr 留在「固定」上：${JSON.stringify(afterType[2])}`)

// 改值
await panel('.track-v[data-axis="columns"][data-i="2"]').fill('240')
await panel('.track-v[data-axis="columns"][data-i="2"]').press('Enter')
await page.waitForTimeout(450)
ok((await tracks('.gr-3'))[2].value === '240px', '裸数字补 px')

// 删一条
await panel('.del-track[data-axis="columns"][data-i="2"]').click()
await page.waitForTimeout(450)
ok((await tracks('.gr-3')).length === 2, '− 删掉一条轨道')

// ── 返回上级 ────────────────────────────────────────────────
await panel('.back').click()
await page.waitForTimeout(450)
ok(await panel('section[data-group="layout"]').count() === 1, '× 回到属性面板')
ok(await panel('.track').count() === 0, '二级面板已退出')

// 换元素时不该停在上一个元素的网格设置里
await panel('.grid-shape').click()
await page.waitForTimeout(300)
await page.locator('#visual-revise-menu .gp-settings').click()
await page.waitForTimeout(400)
await select('.gr-mixed')
ok(await panel('section[data-group="layout"]').count() === 1,
   '换元素自动退回主面板——停在上一个元素的网格设置里会很怪')

// 混合轨道的元素读出来类型正确
await panel('.grid-shape').click()
await page.waitForTimeout(300)
await page.locator('#visual-revise-menu .gp-settings').click()
await page.waitForTimeout(450)
const types = await panel('vr-select[data-track]').evaluateAll(els => els.map(e => e.getAttribute('value')))
ok(JSON.stringify(types) === '["fixed","fill","hug"]',
   `样式表里写的 200px 1fr auto 逐条读出类型：${types.join(' / ')}`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
