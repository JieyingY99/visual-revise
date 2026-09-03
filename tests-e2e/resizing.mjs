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


// ── 尺寸限制的排布 ──────────────────────────────────────────
// 跟着上面的 W / H 分两列：左列管宽度的上下限，右列管高度的，
// 每条限制配自己的标签。原来是「最小 [W][H]」横一行共用一个窄标签，
// 两条限制并存时要在「最小/最大」和「左宽/右高」两个维度之间来回对。
const limitLabels = async css => {
  await page.evaluate(c => {
    document.getElementById('limit-probe')?.remove()
    const d = document.createElement('div')
    d.id = 'limit-probe'
    d.style.cssText = 'width:200px;height:80px;background:#456;' + c
    document.body.appendChild(d)
  }, css)
  await page.locator('#limit-probe').click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(450)
  return page.evaluate(() => {
    const limits = document.querySelector('visual-revise-panel').shadowRoot.querySelector('.limits')
    if (!limits) return null
    return [...limits.querySelectorAll('.limit-col')].map(col =>
      [...col.querySelectorAll('label.name')].map(l => l.textContent.trim()))
  })
}

ok((await limitLabels('')) === null, '一条限制都没加时，不留空的限制区')

const onlyMin = await limitLabels('min-width:100px')
ok(JSON.stringify(onlyMin) === '[["最小宽度"],[]]',
   `只加最小宽度：左列一条、右列空着不铺占位框（${JSON.stringify(onlyMin)}）`)

const both = await limitLabels('min-width:100px;max-width:400px')
ok(JSON.stringify(both) === '[["最小宽度","最大宽度"],[]]',
   `宽度的上下限堆在同一列（${JSON.stringify(both)}）`)

const all4 = await limitLabels('min-width:100px;max-width:400px;min-height:50px;max-height:200px')
ok(JSON.stringify(all4) === '[["最小宽度","最大宽度"],["最小高度","最大高度"]]',
   `四条限制分成宽 / 高两列（${JSON.stringify(all4)}）`)

// Layout 里尺寸 / 限制 / 内边距 / 外边距四行上下相邻，竖直分界必须落在
// 同一条线上。原来三套栅格（1fr 1fr auto auto / 1fr 1fr auto / 1fr 1fr）
// 各差几像素，扫下来是歪的。统一成 1fr 1fr 24px / gap 8——末尾 24px
// 固定给比例锁 / 展开按钮，没有按钮的行也留着这一格，分界才不会漂。
const splits = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = [...sr.querySelectorAll('section')]
    .find(s => s.querySelector('h3 .title')?.textContent.trim() === 'Layout')
  const edges = row => {
    const A = row.children[0].getBoundingClientRect(), B = row.children[1].getBoundingClientRect()
    return `${Math.round(A.right)}→${Math.round(B.left)}`
  }
  const sides = [...sec.querySelectorAll('.side-pair')]
  return {
    dims: edges(sec.querySelector('.dims')),
    limits: edges(sec.querySelector('.limits')),
    padding: edges(sides[0]),
    margin: edges(sides[1]),
    bracket: !!sec.querySelector('.bracket'),
  }
})
ok(splits.dims === splits.limits && splits.limits === splits.padding && splits.padding === splits.margin,
   `尺寸 / 限制 / 内边距 / 外边距四行的分界在同一条线上（${splits.dims}）`)
ok(!splits.bracket, '尺寸行的括号已去掉，设计稿里没有它')

// 尺寸行的模式钮、限制行的 × 钮都要在框内。框改由容器来画、input 透明——
// 原来背景画在 input 上，它后面的兄弟（模式钮、× 钮）全掉在框外，
// 看起来像三个东西并排，而不是一个控件。
const inBox = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const inside = (outer, inner) => {
    const o = outer.getBoundingClientRect(), i = inner.getBoundingClientRect()
    return i.left >= o.left - 0.5 && i.right <= o.right + 0.5
        && i.top >= o.top - 0.5 && i.bottom <= o.bottom + 0.5
  }
  const cell = sr.querySelector('.resize-cell[data-axis="width"]')
  const limit = sr.querySelector('.control.limit')
  return {
    mode: inside(cell, cell.querySelector('.mode')),
    x: inside(limit, limit.querySelector('.drop-limit')),
    icon: !!limit.querySelector('.prefix svg'),
    boxOnContainer: getComputedStyle(cell).backgroundColor !== 'rgba(0, 0, 0, 0)'
      && getComputedStyle(cell.querySelector('input')).backgroundColor === 'rgba(0, 0, 0, 0)',
  }
})
ok(inBox.mode && inBox.boxOnContainer, '尺寸行的模式名 / 箭头在框内（框由容器画，input 透明）')
ok(inBox.x, '限制行的 × 在框内')
ok(inBox.icon, '限制行的前缀是设计稿里的图标（>|< / |↔| 及其竖向版）')

// 尺寸菜单里不再有「使用 CSS 变量…」：页面上定义在 :root 的变量几乎全是
// 颜色（--accent / --background / --border…），列在宽高菜单里点开一屏色名，
// 没有一个能填进 width。这个入口属于颜色控件，不属于这里。
await page.locator('visual-revise-panel .mode[data-axis="width"]').click()
await page.waitForTimeout(350)
const menuTexts = await page.evaluate(() =>
  [...document.querySelectorAll('#visual-revise-menu div')].map(d => d.textContent.trim()).filter(Boolean))
ok(menuTexts.length >= 5 && !menuTexts.some(t => /CSS 变量/.test(t)),
   `尺寸菜单里没有「使用 CSS 变量」（${menuTexts.filter(t => t.length < 12).join(' / ')}）`)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 标签合并不能把调值能力一起合并掉：每条限制的前缀仍可横向拖
const drags = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot
    .querySelectorAll('.limits [data-drag]').length)
ok(drags >= 8, `四条限制的标签与前缀都还能拖着调值（${drags} 个手柄）`)


// ── 比例锁不能被 transform 带偏 ──────────────────────────────
// 原来 measure() 用 getBoundingClientRect，元素一带 rotate，锁住的就是
// 旋转后外接矩形的比例（240×100 转 15° 外接框是 1.62，而元素本身是 2.4），
// 改宽时算出的高怎么校正都收敛不到。改量 offsetWidth / offsetHeight。
await page.evaluate(() => {
  document.getElementById('ratio-probe')?.remove()
  const d = document.createElement('div'); d.id = 'ratio-probe'
  d.style.cssText = 'position:absolute;left:40px;top:640px;width:240px;height:100px;rotate:15deg;background:#654'
  document.body.appendChild(d)
})
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await page.locator('#ratio-probe').click({ position: { x: 120, y: 50 } }); await page.waitForTimeout(400)
const layoutRatio = () => page.evaluate(() => { const e = document.getElementById('ratio-probe'); return e.offsetWidth / e.offsetHeight })
const r0 = await layoutRatio()
await page.locator('visual-revise-panel .ratio').click(); await page.waitForTimeout(200)
const wIn = page.locator('visual-revise-panel input[data-prop="width"]')
await wIn.fill('480'); await wIn.press('Enter'); await page.waitForTimeout(400)
const r1 = await layoutRatio()
ok(Math.abs(r1 - r0) < 0.02,
   `带 rotate 的元素锁比例后改宽，布局盒比例保持（${r0.toFixed(2)} → ${r1.toFixed(2)}）`)
await page.locator('visual-revise-panel .ratio').click(); await page.waitForTimeout(150)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
