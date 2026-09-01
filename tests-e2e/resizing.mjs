import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[Resizing 测试] 模式判定 / 切换 / 尺寸限制\n')
await page.goto(origin)
await injectVisBug(page, origin)

await page.evaluate(() => {
  const wrap = document.createElement('div')
  wrap.className = 'rz-wrap'
  wrap.style.cssText = 'display:flex;flex-direction:row;gap:8px;width:600px;margin:20px'
  wrap.innerHTML = `
    <div class="rz-auto">auto</div>
    <div class="rz-fixed" style="width:120px">fixed</div>
    <div class="rz-hug" style="width:fit-content">hug</div>
    <div class="rz-grow" style="flex-grow:1">grow</div>`
  document.body.appendChild(wrap)

  const block = document.createElement('div')
  block.className = 'rz-block'
  block.style.cssText = 'margin:20px'
  block.textContent = 'block'
  document.body.appendChild(block)
})

const mode = (sel, axis) => page.evaluate(([s, a]) => {
  const { resizeMode } = window.__visualRevise.lib
  return resizeMode(document.querySelector(s), a)
}, [sel, axis])

const panel = sel => page.locator(`visual-revise-panel ${sel}`)
// 先取消上一次选中：选中框的 handles 浮在页面之上，
// 会挡住紧挨着的下一个目标，Playwright 的可点击性检查会一直重试到超时
const select = async sel => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.locator(sel).first().click({ position: { x: 2, y: 2 } })
  await page.waitForTimeout(400)
}

// ── 模式判定 ────────────────────────────────────────────────
ok(await mode('.rz-fixed', 'width') === 'fixed', 'inline 写了 px → 固定')
ok(await mode('.rz-hug', 'width') === 'hug', 'fit-content → 贴合')
ok(await mode('.rz-grow', 'width') === 'fill',
   'flex 主轴上 flex-grow>0 → 填满（auto 的宽度由 grow 决定，不是由 width 决定）')
ok(await mode('.rz-auto', 'width') === 'hug',
   'flex 主轴上没有 grow → 贴合内容')
ok(await mode('.rz-block', 'width') === 'fill',
   '普通块级元素的 width:auto 是撑满可用宽度 → 填满')
ok(await mode('.rz-block', 'height') === 'hug',
   '高度 auto 由内容决定 → 贴合')

// 样式表里的声明也认（不只看 inline）
await page.evaluate(() => {
  const st = document.createElement('style')
  // 给个高度，否则空 div 高度为 0，Playwright 认为它不可见、点不到
  st.textContent = '.rz-sheet { width: 250px; height: 40px; margin: 16px }'
  document.head.appendChild(st)
  const d = document.createElement('div')
  d.className = 'rz-sheet'
  document.body.appendChild(d)
})
ok(await mode('.rz-sheet', 'width') === 'fixed',
   '样式表里的声明同样能判定——getComputedStyle 只给用后值，分不出 auto 与 fit-content')

// ── 面板上的模式按钮 ────────────────────────────────────────
await select('.rz-fixed')
ok(await panel('.mode[data-axis="width"]').count() === 1, 'W 字段旁有模式按钮')
ok((await panel('.mode[data-axis="width"]').textContent()).trim() === '固定',
   '模式按钮显示当前模式')

// ── 切换到「贴合」 ──────────────────────────────────────────
await panel('.mode[data-axis="width"]').click()
await page.waitForTimeout(350)
ok(await page.locator('#visual-revise-menu').count() === 1, '点模式按钮弹出菜单')

const items = await page.locator('#visual-revise-menu > div').allTextContents()
ok(items.some(t => t.includes('贴合内容')) && items.some(t => t.includes('填满容器')),
   `菜单含三种模式：${items.filter(Boolean).slice(0, 3).join(' / ')}`)
ok(items.some(t => t.includes('添加最小宽度')) && items.some(t => t.includes('添加最大宽度')),
   '菜单里能添加尺寸限制（min/max 不再常年占两行）')

await page.locator('#visual-revise-menu > div').filter({ hasText: '贴合内容' }).first().click()
await page.waitForTimeout(450)
ok(await page.evaluate(() => document.querySelector('.rz-fixed').style.width) === 'fit-content',
   '选「贴合内容」写入 fit-content')

// ── 填满：flex 主轴上写 flex-grow 而不是 100% ───────────────
await panel('.mode[data-axis="width"]').click()
await page.waitForTimeout(300)
await page.locator('#visual-revise-menu > div').filter({ hasText: '填满容器' }).first().click()
await page.waitForTimeout(450)

const filled = await page.evaluate(() => {
  const el = document.querySelector('.rz-fixed')
  return { grow: el.style.flexGrow, width: el.style.width }
})
ok(filled.grow === '1' && !filled.width,
   `flex 主轴上「填满」写 flex-grow:1 而不是 width:100%（后者会把兄弟元素挤出去）：${JSON.stringify(filled)}`)

// 非 flex 主轴则写 100%
await select('.rz-block')
await panel('.mode[data-axis="width"]').click()
await page.waitForTimeout(300)
await page.locator('#visual-revise-menu > div').filter({ hasText: '填满容器' }).first().click()
await page.waitForTimeout(450)
ok(await page.evaluate(() => document.querySelector('.rz-block').style.width) === '100%',
   '非 flex 场景下「填满」写 width:100%')

// ── 填满：样式表里有 width 时也要真的撑开 ───────────────────
// 这是个真实踩过的坑：只清掉 inline 的 width 不够，样式表里那条还在，
// flex-basis 默认 auto 会拿它当伸缩基准，元素照旧按原宽度起算，
// 看起来就是「选了填满却纹丝不动」。
await page.evaluate(() => {
  const st = document.createElement('style')
  st.textContent = '.rz-sheet-w { width: 120px }'
  document.head.appendChild(st)

  const row = document.createElement('div')
  row.className = 'rz-row2'
  row.style.cssText = 'display:flex;width:600px;margin:20px;padding:8px'
  row.innerHTML = '<div class="rz-sheet-w">A</div><div>B</div>'
  document.body.appendChild(row)
})

await select('.rz-sheet-w')
const beforeFill = await page.evaluate(() =>
  Math.round(document.querySelector('.rz-sheet-w').getBoundingClientRect().width))
ok(beforeFill === 120, `起始按样式表的 120px：${beforeFill}`)

await panel('.mode[data-axis="width"]').click()
await page.waitForTimeout(300)
await page.locator('#visual-revise-menu > div').filter({ hasText: '填满容器' }).first().click()
await page.waitForTimeout(500)

const fillWrote = await page.evaluate(() => {
  const s = document.querySelector('.rz-sheet-w').style
  return { grow: s.flexGrow, basis: s.flexBasis, width: s.width }
})
ok(fillWrote.grow === '1' && /^0(px|%)?$/.test(fillWrote.basis),
   `flex 主轴的填满写 flex: 1 1 0%，basis 不能省：${JSON.stringify(fillWrote)}`)

const afterFill = await page.evaluate(() =>
  Math.round(document.querySelector('.rz-sheet-w').getBoundingClientRect().width))
ok(afterFill > beforeFill,
   `元素真的撑开了（${beforeFill} → ${afterFill}），而不是停在样式表的宽度上`)

ok(await mode('.rz-sheet-w', 'width') === 'fill',
   '读回来仍是「填满」——不会被样式表里那条 width 骗回「固定」')

// 切回贴合要清掉 fill 留下的痕迹，否则切回来毫无变化
await panel('.mode[data-axis="width"]').click()
await page.waitForTimeout(300)
await page.locator('#visual-revise-menu > div').filter({ hasText: '贴合内容' }).first().click()
await page.waitForTimeout(500)
const afterHug = await page.evaluate(() => {
  const s = document.querySelector('.rz-sheet-w').style
  return { grow: s.flexGrow, basis: s.flexBasis, width: s.width }
})
ok(!afterHug.grow && !afterHug.basis && afterHug.width === 'fit-content',
   `切回贴合时清掉 grow / basis：${JSON.stringify(afterHug)}`)

// ── flex 交叉轴的填满走 align-self ──────────────────────────
await page.evaluate(() => {
  const col = document.createElement('div')
  col.className = 'rz-col2'
  col.style.cssText = 'display:flex;flex-direction:column;width:400px;margin:20px;padding:8px'
  col.innerHTML = '<div class="rz-cross">A</div>'
  document.body.appendChild(col)
})
await select('.rz-cross')
await panel('.mode[data-axis="width"]').click()
await page.waitForTimeout(300)
await page.locator('#visual-revise-menu > div').filter({ hasText: '填满容器' }).first().click()
await page.waitForTimeout(500)
ok(await page.evaluate(() => document.querySelector('.rz-cross').style.alignSelf) === 'stretch',
   '交叉轴的填满写 align-self:stretch——写 100% 会算错，交叉轴百分比参照的是内容框，遇到 padding 就溢出')

// ── 模式按钮的显示规则 ──────────────────────────────────────
// .rz-fixed 在前面的用例里已被切成别的模式了，改用没动过的 .rz-sheet
await select('.rz-sheet')
const modeBtn = panel('.mode[data-axis="width"]')
ok(await modeBtn.getAttribute('data-mode') === 'fixed', '按钮带当前模式标记')
ok(!(await modeBtn.locator('.mode-name').isVisible()),
   '固定模式不写「固定」二字——框里那个数字本身就说明它是固定的')
ok(await modeBtn.locator('.mode-caret').isVisible(), '固定模式显示下拉箭头')

await select('.rz-hug')
ok(await panel('.mode[data-axis="width"] .mode-name').isVisible(),
   '贴合模式要标出来——框里的数字是量出来的结果而非声明')

// ── 面板滚动位置 ────────────────────────────────────────────
await select('.rz-block')
await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  sr.querySelectorAll('section').forEach(s => s.removeAttribute('folded'))
  sr.querySelector('.scroll').scrollTop = 260
})
await page.waitForTimeout(300)
const scrollBefore = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop)

// 触发一次整块重绘（切模式会 render）
await page.evaluate(() => document.querySelector('visual-revise-panel').render())
await page.waitForTimeout(300)
const scrollAfter = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop)
ok(scrollBefore > 0 && scrollAfter === scrollBefore,
   `重绘后滚动位置不跳回顶部（${scrollBefore} → ${scrollAfter}）`)

// ── 尺寸限制按需出现 ────────────────────────────────────────
ok(await panel('input[data-prop="min-width"]').count() === 0,
   '默认不显示最小宽度字段')

await panel('.mode[data-axis="width"]').click()
await page.waitForTimeout(300)
await page.locator('#visual-revise-menu > div').filter({ hasText: '添加最小宽度' }).first().click()
await page.waitForTimeout(400)

ok(await panel('input[data-prop="min-width"]').count() === 1, '添加后字段出现')
ok(await page.evaluate(() => document.querySelector('.rz-block').style.minWidth) === '',
   '只是把字段显示出来，不凭空写一条 min-width（否则改动记录里会多出用户没做过的改动）')

await panel('input[data-prop="min-width"]').fill('80px')
await panel('input[data-prop="min-width"]').press('Enter')
await page.waitForTimeout(400)
ok(await page.evaluate(() => document.querySelector('.rz-block').style.minWidth) === '80px',
   '填了值才真正写入')

await panel('.drop-limit[data-prop="min-width"]').click()
await page.waitForTimeout(400)
const dropped = await page.evaluate(() => ({
  style: document.querySelector('.rz-block').style.minWidth,
  field: !!document.querySelector('visual-revise-panel')
    .shadowRoot.querySelector('input[data-prop="min-width"]'),
}))
ok(!dropped.style && !dropped.field,
   '移除时连声明一起清掉——只藏字段会留下一条看不见、却会进提示词的改动')

// 本来就有值的限制要自动显示，不能藏掉元素已有的样式
await page.evaluate(() => {
  const d = document.createElement('div')
  d.className = 'rz-hasmin'
  d.style.cssText = 'margin:20px;min-height:64px'
  document.body.appendChild(d)
})
await select('.rz-hasmin')
ok(await panel('input[data-prop="min-height"]').count() === 1,
   '元素本来就有 min-height 时字段自动显示，不用手动添加')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
