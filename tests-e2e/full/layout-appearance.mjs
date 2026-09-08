// 全量 e2e · 分块「Layout / Appearance」
// 覆盖 docs/plans/feature-inventory.md 的 §2.5（2.5.1–2.5.18）与 §2.6（2.6.1–2.6.2）。
// 每条断言以清单编号开头，全部走真实交互（locator.click / page.mouse / page.keyboard），
// 断言落在元素的 inline style / DOM 结构 / 改动记录 / 面板 DOM 上。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const T = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

console.log('\n[全量 e2e] Layout / Appearance（§2.5 / §2.6）\n')

await page.goto(`${origin}/full/fixtures/layout-appearance.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

// ── 工具 ────────────────────────────────────────────────────
const P = sel => page.locator(`visual-revise-panel ${sel}`)
const M = sel => page.locator(`#visual-revise-menu ${sel}`)

const style = (id, prop) =>
  page.evaluate(([i, p]) => document.getElementById(i).style.getPropertyValue(p), [id, prop])

const styles = (id, props) => page.evaluate(([i, ps]) => {
  const s = document.getElementById(i).style
  return Object.fromEntries(ps.map(p => [p, s.getPropertyValue(p)]))
}, [id, props])

const toast = () => page.evaluate(() => {
  const t = document.querySelector('visual-revise-panel').shadowRoot.querySelector('.toast')
  return { text: (t?.textContent || '').trim(), kind: t?.dataset.kind || '', shown: !!t?.hasAttribute('data-show') }
})

const depth = () => page.evaluate(() => window.__visualRevise.store.history.depth)

// 选中：先把面板里的焦点放掉（不然 Esc 被面板的 stopPropagation 吃掉），
// Esc 两下——第一下关弹层，第二下才取消选中——再真实点击目标
const select = async id => {
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  await page.locator(`#${id}`).click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(480)
}

const tap = async loc => {          // 面板是滚动容器，点之前先滚进来
  await loc.scrollIntoViewIfNeeded()
  await loc.click()
  await page.waitForTimeout(340)
}

const write = async (prop, value) => {
  const i = P(`input[data-prop="${prop}"]`).first()
  await i.scrollIntoViewIfNeeded()
  await i.fill(String(value))
  await i.press('Enter')
  await page.waitForTimeout(340)
}

// 真实指针拖拽某个手柄（标签 / 前缀），每 2px 一步
const dragBy = async (loc, dx) => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(320)
}

// 菜单行在 shadow root 里；分隔线不是 [data-item]，得整块读出来
const menuRows = () => page.evaluate(() => {
  const host = document.getElementById('visual-revise-menu')
  if (!host) return null
  return [...host.shadowRoot.children].filter(n => n.tagName !== 'STYLE').map(n =>
    n.dataset.item !== undefined
      ? {
          id: n.dataset.item,
          text: n.textContent.replace(/\s+/g, ''),
          disabled: /not-allowed/.test(n.getAttribute('style') || ''),
          checked: !!(n.firstElementChild?.innerHTML || '').trim(),
        }
      : { separator: true })
})

const menuOpen = () => page.locator('#visual-revise-menu').count()

// ════════════════════════════════════════════════════════════
// 2.5.1 排列（Flow）四态
// ════════════════════════════════════════════════════════════
console.log('── 2.5.1 排列 Flow')
await select('free')
T('2.5.1', await P('.segment.flow button[data-flow]').count() === 4, '排列是四个分段按钮：自由 / 纵向 / 横向 / 网格')

const d0 = await depth()
await tap(P('button[data-flow="vertical"]'))
let s = await styles('free', ['display', 'flex-direction'])
T('2.5.1', s.display === 'flex' && s['flex-direction'] === 'column',
  `排列切到纵向写 display:flex + flex-direction:column（${JSON.stringify(s)}）`)
T('2.5.1', (await toast()).text === '排列：纵向', `切排列 toast「排列：纵向」（实际「${(await toast()).text}」）`)
T('2.5.1', (await depth()) - d0 === 1, `一次切排列是一条历史（depth ${d0} → ${await depth()}）`)

await tap(P('button[data-flow="horizontal"]'))
s = await styles('free', ['display', 'flex-direction'])
T('2.5.1', s.display === 'flex' && s['flex-direction'] === 'row',
  `排列切到横向写 flex-direction: row（${JSON.stringify(s)}）`)

await tap(P('button[data-flow="grid"]'))
s = await styles('free', ['display', 'flex-direction', 'flex-wrap'])
T('2.5.1', s.display === 'grid' && !s['flex-direction'] && !s['flex-wrap'],
  `排列切到网格写 display:grid，并清掉 flex-direction / flex-wrap（${JSON.stringify(s)}）`)

// 先把 justify-content 写上，验证切回自由时它被清掉
await tap(P('button[data-flow="horizontal"]'))
await tap(P('.align-cell[data-col="1"][data-row="1"]'))
await tap(P('button[data-flow="free"]'))
s = await styles('free', ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items'])
T('2.5.1', s.display === 'block' && !s['flex-direction'] && !s['flex-wrap'] && !s['justify-content'] && !s['align-items'],
  `排列切回自由写 display:block，并清掉不再生效的 flex 属性（${JSON.stringify(s)}）`)
T('2.5.1', await P('button[data-flow="free"][data-on]').count() === 1, '当前排列按钮带 data-on 高亮')

// inline 元素的 flex 写法要保持 inline
await select('inline')
await tap(P('button[data-flow="horizontal"]'))
T('2.5.1', await style('inline', 'display') === 'inline-flex',
  `display:inline-block 的元素切横向写 inline-flex 而不是 flex（${await style('inline', 'display')}）`)

// ════════════════════════════════════════════════════════════
// 2.5.2 换行钮
// ════════════════════════════════════════════════════════════
console.log('── 2.5.2 换行')
await select('row')
T('2.5.2', !(await P('.wrap-toggle').isDisabled()), 'flex 排列下换行钮可用')
await tap(P('.wrap-toggle'))
T('2.5.2', await style('row', 'flex-wrap') === 'wrap', `点换行钮写 flex-wrap:wrap（${await style('row', 'flex-wrap')}）`)
T('2.5.2', await P('.wrap-toggle[data-on]').count() === 1, '换行开启时按钮带 data-on')
await tap(P('.wrap-toggle'))
T('2.5.2', await style('row', 'flex-wrap') === 'nowrap', `再点切回 flex-wrap:nowrap（${await style('row', 'flex-wrap')}）`)

await select('free')     // 此时是 display:block
T('2.5.2', await P('.wrap-toggle').isDisabled(), '自由排列下换行钮 disabled')
T('2.5.2', (await P('.wrap-toggle').getAttribute('title')) === '仅 flex 排列可换行',
  `禁用时 title 说明原因（${await P('.wrap-toggle').getAttribute('title')}）`)
await select('grid3')
T('2.5.2', await P('.wrap-toggle').isDisabled(), '网格排列下换行钮也 disabled——flex-wrap 在 grid 上不生效')

// ════════════════════════════════════════════════════════════
// 2.5.3 尺寸 W / H
// ════════════════════════════════════════════════════════════
console.log('── 2.5.3 尺寸 W / H')
await select('dims')
T('2.5.3', await P('input[data-prop="width"]').inputValue() === '200' &&
           await P('input[data-prop="height"]').inputValue() === '80',
  `固定模式下框里是声明值（W=${await P('input[data-prop="width"]').inputValue()} H=${await P('input[data-prop="height"]').inputValue()}）`)

await write('width', 260)
await write('height', 120)
s = await styles('dims', ['width', 'height'])
T('2.5.3', s.width === '260px' && s.height === '120px',
  `W / H 写 width / height，裸数字补 px（${JSON.stringify(s)}）`)

// 前缀 W 可横向拖：右移 40px = 20 步 = +20px
await dragBy(P('.prefix[data-drag][data-prop="width"]'), 40)
T('2.5.3', parseFloat(await style('dims', 'width')) > 260,
  `W 前缀可横向拖着调值（260 → ${await style('dims', 'width')}）`)

await select('hug')
const hugShown = await P('input[data-prop="width"]').inputValue()
const hugReal = await page.evaluate(() => Math.round(document.getElementById('hug').getBoundingClientRect().width))
T('2.5.3', await style('hug', 'width') === 'fit-content' && Math.abs(parseFloat(hugShown) - hugReal) <= 1,
  `非固定模式下框里是实测值而非声明值（声明 fit-content，框里 ${hugShown}，实测 ${hugReal}）`)

// ════════════════════════════════════════════════════════════
// 2.5.4 尺寸模式下拉
// ════════════════════════════════════════════════════════════
console.log('── 2.5.4 尺寸模式菜单')
await select('dims')
await tap(P('.mode[data-axis="width"]'))
let rows = await menuRows()
T('2.5.4', !!rows && rows.filter(r => !r.separator).length === 5,
  `点尺寸模式按钮弹出菜单，五项（${(rows || []).filter(r => !r.separator).map(r => r.id).join(' / ')}）`)
T('2.5.4', rows.some(r => r.id === 'fixed' && /固定宽度/.test(r.text) && /px/.test(r.text)),
  `「固定宽度」的 hint 是当前 px（${rows.find(r => r.id === 'fixed')?.text}）`)
T('2.5.4', rows.some(r => r.id === 'hug' && /贴合内容fit-content/.test(r.text)),
  `「贴合内容」的 hint 是 fit-content（${rows.find(r => r.id === 'hug')?.text}）`)
T('2.5.4', rows.some(r => r.id === 'fill' && /填满容器100%/.test(r.text)),
  `非 flex 主轴的「填满容器」hint 是 100%（${rows.find(r => r.id === 'fill')?.text}）`)
T('2.5.4', rows.filter(r => r.separator).length === 1 &&
           rows.findIndex(r => r.separator) === 3,
  `第 4 位是分隔线，把三种模式与「添加限制」分开（${rows.map(r => r.separator ? '—' : r.id).join(' ')}）`)
T('2.5.4', rows.some(r => r.id === 'min' && /添加最小宽度/.test(r.text)) &&
           rows.some(r => r.id === 'max' && /添加最大宽度/.test(r.text)),
  '菜单末尾是「添加最小宽度…」「添加最大宽度…」')
T('2.5.4', rows.find(r => r.id === 'fixed')?.checked === true,
  '当前模式（固定）带勾选标记')

await tap(M('[data-item="hug"]'))
T('2.5.4', await style('dims', 'width') === 'fit-content',
  `选「贴合内容」写 width:fit-content（${await style('dims', 'width')}）`)
T('2.5.4', (await toast()).text === '宽：贴合', `切模式 toast「宽：贴合」（实际「${(await toast()).text}」）`)

await tap(P('.mode[data-axis="height"]'))
await tap(M('[data-item="fill"]'))
T('2.5.4', await style('dims', 'height') === '100%',
  `高度选「填满容器」（父级非 flex）写 height:100%（${await style('dims', 'height')}）`)

await tap(P('.mode[data-axis="width"]'))
await tap(M('[data-item="fixed"]'))
T('2.5.4', /^\d+(\.\d+)?px$/.test(await style('dims', 'width')),
  `选「固定宽度」写下当前实测像素（${await style('dims', 'width')}）`)

// ════════════════════════════════════════════════════════════
// 2.5.5 「添加最小 / 最大」只显示字段，不写声明
// ════════════════════════════════════════════════════════════
console.log('── 2.5.5 添加尺寸限制')
T('2.5.5', await P('input[data-prop="min-width"]').count() === 0, '默认不显示最小宽度字段')
await tap(P('.mode[data-axis="width"]'))
await tap(M('[data-item="min"]'))
T('2.5.5', await P('input[data-prop="min-width"]').count() === 1, '选「添加最小宽度…」后字段出现')
T('2.5.5', await style('dims', 'min-width') === '',
  `只把字段显示出来，不写任何声明（min-width inline = "${await style('dims', 'min-width')}"）`)
const focused = await page.evaluate(() => {
  const a = document.querySelector('visual-revise-panel').shadowRoot.activeElement
  return a?.dataset?.prop || null
})
T('2.5.5', focused === 'min-width', `焦点移进新出现的字段（activeElement = ${focused}）`)

await tap(P('.mode[data-axis="width"]'))
rows = await menuRows()
T('2.5.5', rows.find(r => r.id === 'min')?.disabled === true,
  '已有该限制时「添加最小宽度…」变 disabled')
await tap(M('[data-item="max"]'))       // 顺便再加一条，用于下面的移除
T('2.5.5', await P('input[data-prop="max-width"]').count() === 1 &&
           await style('dims', 'max-width') === '',
  '「添加最大宽度…」同样只显示字段')

// ════════════════════════════════════════════════════════════
// 2.5.6 限制字段的 ×（drop-limit）
// ════════════════════════════════════════════════════════════
console.log('── 2.5.6 移除尺寸限制')
await write('min-width', 80)
T('2.5.6', await style('dims', 'min-width') === '80px', `填了值才真正写入（${await style('dims', 'min-width')}）`)
await tap(P('.drop-limit[data-prop="min-width"]'))
T('2.5.6', await style('dims', 'min-width') === '' && await P('input[data-prop="min-width"]').count() === 0,
  'inline 来的限制：× 清掉声明，字段一并收起')
T('2.5.6', (await toast()).text === '已移除最小宽度限制', `toast「已移除最小宽度限制」（实际「${(await toast()).text}」）`)

// 来自样式表的限制：清 inline 之后值还在，必须写 LIMIT_RESET 盖掉
await select('sheetmin')
T('2.5.6', await P('input[data-prop="min-height"]').count() === 1,
  '样式表里声明过 min-height 时字段自动显示（不能把元素已有的样式藏掉）')
await tap(P('.drop-limit[data-prop="min-height"]'))
const sheetMin = await style('sheetmin', 'min-height')
T('2.5.6', /^0(px)?$/.test(sheetMin),
  `样式表来的限制：清不掉就写初始值 0 盖住（min-height inline = "${sheetMin}"）`)
T('2.5.6', await P('input[data-prop="min-height"]').count() === 0, '盖掉之后字段收起')
T('2.5.6', (await toast()).text === '已移除最小高度限制', `toast「已移除最小高度限制」（实际「${(await toast()).text}」）`)

// ════════════════════════════════════════════════════════════
// 2.5.7 比例锁
// ════════════════════════════════════════════════════════════
console.log('── 2.5.7 比例锁')
await select('ratio')
const boxRatio = () => page.evaluate(() => {
  const e = document.getElementById('ratio')
  return e.offsetWidth / e.offsetHeight
})
const r0 = await boxRatio()
await tap(P('.ratio'))
T('2.5.7', await P('.ratio[data-on]').count() === 1, '点比例锁后按钮进入开启态')
T('2.5.7', (await toast()).text === `已锁定宽高比 ${r0.toFixed(2)} : 1`,
  `toast 报出锁定的比例（${(await toast()).text}）`)
await write('width', 480)
const r1 = await boxRatio()
T('2.5.7', Math.abs(r1 - r0) < 0.03 && parseFloat(await style('ratio', 'height')) > 100,
  `锁开着改 W → H 自动跟随（比例 ${r0.toFixed(3)} → ${r1.toFixed(3)}，H = ${await style('ratio', 'height')}）`)
await tap(P('.ratio'))
T('2.5.7', await P('.ratio[data-on]').count() === 0 && (await toast()).text === '已解除宽高比锁定',
  `再点解除（${(await toast()).text}）`)
const hBefore = await style('ratio', 'height')
await write('width', 300)
T('2.5.7', await style('ratio', 'height') === hBefore, '解除后改 W 不再带动 H')

// 元素没有可用尺寸时报错而不是锁一个 NaN
await select('zero')
await page.evaluate(() => {
  document.getElementById('zero').style.cssText = 'width:0;height:0;padding:0;border:0;margin:0'
})
await page.waitForTimeout(200)
await tap(P('.ratio'))
const zeroToast = await toast()
T('2.5.7', zeroToast.text === '元素当前没有可用尺寸，无法锁定比例' && zeroToast.kind === 'error',
  `尺寸为 0 时 toast 报错而不是锁定（${zeroToast.text} / ${zeroToast.kind}）`)

// ════════════════════════════════════════════════════════════
// 2.5.8 比例锁绑在具体元素上，换元素即作废
// ════════════════════════════════════════════════════════════
console.log('── 2.5.8 比例锁随元素作废')
await select('ratio')
await tap(P('.ratio'))
T('2.5.8', await P('.ratio[data-on]').count() === 1, '在 #ratio 上锁住比例')
await select('dims')
T('2.5.8', await P('.ratio[data-on]').count() === 0, '换到另一个元素后比例锁按钮回到未锁态')
const dimsH = await style('dims', 'height')
await write('width', 320)
T('2.5.8', await style('dims', 'height') === dimsH,
  `换元素后改 W 不再按上一个元素的比例带动 H（H 保持 ${dimsH}）`)

// ════════════════════════════════════════════════════════════
// 2.5.9 对齐九宫格
// ════════════════════════════════════════════════════════════
console.log('── 2.5.9 对齐九宫格')
await select('row')
T('2.5.9', await P('.align-grid').count() === 1 && await P('.align-cell').count() === 9,
  'flex 排列下渲染 3×3 共 9 个对齐按钮')
await tap(P('.align-cell[data-col="1"][data-row="1"]'))
s = await styles('row', ['justify-content', 'align-items'])
T('2.5.9', s['justify-content'] === 'center' && s['align-items'] === 'center',
  `横向排列点正中 → justify-content/align-items 都是 center（${JSON.stringify(s)}）`)
await tap(P('.align-cell[data-col="0"][data-row="2"]'))
s = await styles('row', ['justify-content', 'align-items'])
T('2.5.9', s['justify-content'] === 'flex-start' && s['align-items'] === 'flex-end',
  `横向排列点左下 → justify 管左右、align 管上下（${JSON.stringify(s)}）`)

await select('col')
await tap(P('.align-cell[data-col="0"][data-row="2"]'))
s = await styles('col', ['justify-content', 'align-items'])
T('2.5.9', s['justify-content'] === 'flex-end' && s['align-items'] === 'flex-start',
  `纵向排列同一格要翻转轴向（${JSON.stringify(s)}）`)
T('2.5.9', await page.evaluate(() => {
  const c = document.querySelector('visual-revise-panel').shadowRoot.querySelector('.align-cell[data-on]')
  return c?.dataset.col === '0' && c?.dataset.row === '2'
}), '纵向下高亮回读的仍是刚点的那一格')

await select('grid3')
T('2.5.9', await P('.align-grid').count() === 0, '网格排列下不渲染对齐九宫格')
await select('free')
T('2.5.9', await P('.align-grid').count() === 0, '自由排列下不渲染对齐九宫格')

// ════════════════════════════════════════════════════════════
// 2.5.10 间隔 gap
// ════════════════════════════════════════════════════════════
console.log('── 2.5.10 间隔 gap')
T('2.5.10', await P('input[data-prop="gap"]').count() === 0, '[flex/grid 自身] 不成立：自由排列下没有间隔字段')
await select('row')
T('2.5.10', await P('input[data-prop="gap"]').count() === 1, 'flex 自身上出现间隔字段')
await write('gap', 24)
T('2.5.10', await style('row', 'gap') === '24px', `间隔写 gap，裸数字补 px（${await style('row', 'gap')}）`)
await dragBy(P('label.name[data-prop="gap"][data-drag]'), 40)
T('2.5.10', parseFloat(await style('row', 'gap')) > 24,
  `间隔标签可横向拖着调值（24 → ${await style('row', 'gap')}）`)
await select('grid3')
T('2.5.10', await P('input[data-prop="gap"]').count() === 0 &&
            await P('input[data-prop="column-gap"]').count() === 1,
  'grid 自身上间隔拆成列 / 行两个，不再有单一的 gap 字段')

// ════════════════════════════════════════════════════════════
// 2.5.11 网格行
// ════════════════════════════════════════════════════════════
console.log('── 2.5.11 网格行')
await select('grid0')
T('2.5.11', (await P('.grid-shape').textContent()).trim() === '未设置',
  `没有轨道声明时形状按钮显示「未设置」（${(await P('.grid-shape').textContent()).trim()}）`)
await select('grid3')
T('2.5.11', (await P('.grid-shape').textContent()).trim() === '3 × 自动',
  `只声明了列时显示「N × 自动」（${(await P('.grid-shape').textContent()).trim()}）`)
await select('grid32')
T('2.5.11', (await P('.grid-shape').textContent()).trim() === '3 × 2',
  `行列都声明时显示「N × M」（${(await P('.grid-shape').textContent()).trim()}）`)
T('2.5.11', await P('input[data-prop="column-gap"]').count() === 1 &&
            await P('input[data-prop="row-gap"]').count() === 1,
  '网格行右侧是列间隔 / 行间隔两个输入')
await write('column-gap', 18)
await write('row-gap', 6)
s = await styles('grid32', ['column-gap', 'row-gap'])
T('2.5.11', s['column-gap'] === '18px' && s['row-gap'] === '6px',
  `列间隔 / 行间隔分别写 column-gap / row-gap（${JSON.stringify(s)}）`)
T('2.5.11', await P('.grid-shape').count() === 1 && await P('.grid-shape').isEnabled(),
  '网格行只在 grid 排列下渲染（非 grid 元素上面已断言无 .grid-shape）')
await select('row')
T('2.5.11', await P('.grid-shape').count() === 0, 'flex 排列下不渲染网格行')

// ════════════════════════════════════════════════════════════
// 2.5.12 网格点阵弹层
// ════════════════════════════════════════════════════════════
console.log('── 2.5.12 网格点阵弹层')
await select('grid3')
await tap(P('.grid-shape'))
T('2.5.12', await M('.gp-dots').count() === 1 && await M('.gp-dot').count() === 144,
  `点形状按钮弹出 12×12 点阵（${await M('.gp-dot').count()} 个点）`)
await M('.gp-dot[data-c="5"][data-r="3"]').hover()
await page.waitForTimeout(250)
T('2.5.12', (await M('.gp-hint').textContent()).trim() === '5 × 3' &&
            await M('.gp-dot[data-hot]').count() === 15,
  `hover 预览左上到当前格的矩形并显示 C × R（hint=${(await M('.gp-hint').textContent()).trim()}，高亮 ${await M('.gp-dot[data-hot]').count()} 格）`)
await tap(M('.gp-dot[data-c="5"][data-r="3"]'))
T('2.5.12', await menuOpen() === 0, '点击格子后弹层关闭')
s = await styles('grid3', ['grid-template-columns', 'grid-template-rows'])
T('2.5.12', s['grid-template-columns'] === 'repeat(5, 1fr)' && s['grid-template-rows'] === 'repeat(3, 1fr)',
  `点击定下 5 × 3（${JSON.stringify(s)}）`)

// change 只应用不关闭
await tap(P('.grid-shape'))
await M('.gp-n[data-axis="columns"]').fill('4')
await M('.gp-n[data-axis="columns"]').press('Tab')
await page.waitForTimeout(420)
T('2.5.12', await menuOpen() === 1 && await style('grid3', 'grid-template-columns') === 'repeat(4, 1fr)',
  `顶部数字输入的 change 应用但不关闭弹层（cols=${await style('grid3', 'grid-template-columns')}，弹层还在=${await menuOpen() === 1}）`)

// Enter 应用并关闭
await M('.gp-n[data-axis="rows"]').fill('2')
await M('.gp-n[data-axis="rows"]').press('Enter')
await page.waitForTimeout(420)
T('2.5.12', await menuOpen() === 0 && await style('grid3', 'grid-template-rows') === 'repeat(2, 1fr)',
  `Enter 应用并关闭（rows=${await style('grid3', 'grid-template-rows')}）`)

// Esc 关闭
await tap(P('.grid-shape'))
await M('.gp-n[data-axis="columns"]').click()
await page.keyboard.press('Escape')
await page.waitForTimeout(320)
T('2.5.12', await menuOpen() === 0, 'Esc 关闭点阵弹层')

// 底部「打开网格设置」进二级视图
await tap(P('.grid-shape'))
await tap(M('.gp-settings'))
T('2.5.12', (await P('header .tag').textContent()).trim() === '网格设置',
  `底部按钮进入二级视图「网格设置」（${(await P('header .tag').textContent()).trim()}）`)
await tap(P('.back'))
T('2.5.12', await P('.grid-shape').count() === 1, '返回后回到属性面板')

// ════════════════════════════════════════════════════════════
// 2.5.13 #setGridShape 批量写轨道
// ════════════════════════════════════════════════════════════
console.log('── 2.5.13 写网格轨道')
const gd0 = await depth()
await tap(P('.grid-shape'))
await tap(M('.gp-dot[data-c="2"][data-r="2"]'))
s = await styles('grid3', ['grid-template-columns', 'grid-template-rows'])
T('2.5.13', s['grid-template-columns'] === 'repeat(2, 1fr)' && s['grid-template-rows'] === 'repeat(2, 1fr)',
  `批量写 grid-template-columns / rows（${JSON.stringify(s)}）`)
T('2.5.13', (await toast()).text === '网格：2 × 2', `toast「网格：2 × 2」（实际「${(await toast()).text}」）`)
T('2.5.13', (await depth()) - gd0 === 1, `列与行是一条历史（depth ${gd0} → ${await depth()}）`)

await tap(P('.grid-shape'))
await M('.gp-n[data-axis="rows"]').fill('')
await M('.gp-n[data-axis="columns"]').fill('3')
await M('.gp-n[data-axis="columns"]').press('Enter')
await page.waitForTimeout(420)
s = await styles('grid3', ['grid-template-columns', 'grid-template-rows'])
T('2.5.13', s['grid-template-columns'] === 'repeat(3, 1fr)' && s['grid-template-rows'] === '',
  `行数留空 = 隐式网格，rows 被清掉（${JSON.stringify(s)}）`)
T('2.5.13', (await toast()).text === '网格：3 × 自动', `toast「网格：3 × 自动」（实际「${(await toast()).text}」）`)

// ════════════════════════════════════════════════════════════
// 2.5.14 内边距 / 外边距 两段式
// ════════════════════════════════════════════════════════════
console.log('── 2.5.14 间距两段式')
await select('pad')
T('2.5.14', await P('input[data-pair="padding:horizontal"]').count() === 1 &&
            await P('input[data-pair="padding:vertical"]').count() === 1 &&
            await P('input[data-pair="margin:horizontal"]').count() === 1 &&
            await P('input[data-pair="margin:vertical"]').count() === 1,
  '内边距 / 外边距默认各收成「水平 / 垂直」两个框')
T('2.5.14', await P('input[data-pair="padding:horizontal"]').inputValue() === '20' &&
            await P('input[data-pair="padding:vertical"]').inputValue() === '10' &&
            await P('input[data-pair="margin:horizontal"]').inputValue() === '30' &&
            await P('input[data-pair="margin:vertical"]').inputValue() === '5',
  `左右 / 上下分别读出（padding ${await P('input[data-pair="padding:horizontal"]').inputValue()}/${await P('input[data-pair="padding:vertical"]').inputValue()}，margin ${await P('input[data-pair="margin:horizontal"]').inputValue()}/${await P('input[data-pair="margin:vertical"]').inputValue()}）`)
T('2.5.14', await P('.prefix[data-drag][data-pair="padding:horizontal"]').count() === 1,
  '两段式的前缀是可拖的横线 / 竖线图标')

const pairIn = P('input[data-pair="margin:horizontal"]')
// 固件里的 margin 简写已经把 margin-top 展开成 5px，比较前后而不是比较空值
const mtBefore = await style('pad', 'margin-top')
await pairIn.fill('0, 138'); await pairIn.press('Enter'); await page.waitForTimeout(340)
s = await styles('pad', ['margin-left', 'margin-right', 'margin-top'])
T('2.5.14', s['margin-left'] === '0px' && s['margin-right'] === '138px' && s['margin-top'] === mtBefore,
  `支持 "0, 138" 双值写法，分别写给左右，另一轴不受影响（${JSON.stringify(s)}）`)
await pairIn.fill('16'); await pairIn.press('Enter'); await page.waitForTimeout(340)
s = await styles('pad', ['margin-left', 'margin-right'])
T('2.5.14', s['margin-left'] === '16px' && s['margin-right'] === '16px',
  `只填一个值时两边一起写（${JSON.stringify(s)}）`)
const padVIn = P('input[data-pair="padding:vertical"]')
const pvBefore = await padVIn.inputValue()
await dragBy(P('.prefix[data-drag][data-pair="padding:vertical"]'), 40)
s = await styles('pad', ['padding-top', 'padding-bottom'])
const pvAfter = await padVIn.inputValue()
T('2.5.14', parseFloat(s['padding-top']) > 10 && s['padding-top'] === s['padding-bottom'],
  `前缀可横向拖着同时调两条声明（框里 ${pvBefore} → ${pvAfter}，元素 ${JSON.stringify(s)}）`)

// ════════════════════════════════════════════════════════════
// 2.5.15 展开四边 / 收回
// ════════════════════════════════════════════════════════════
console.log('── 2.5.15 展开四边')
await select('pad')
T('2.5.15', await P('input[data-prop="padding-top"]').count() === 0, '默认没有四边独立字段')
await tap(P('.expand-sides[data-kind="padding"]'))
const sideProps = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']
let sideCount = 0
for (const p of sideProps) sideCount += await P(`input[data-prop="${p}"]`).count()
T('2.5.15', sideCount === 4, `展开后出现四个独立输入（上右下左，实际 ${sideCount} 个）`)
const prefixes = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return [...sr.querySelectorAll('.sides .control .prefix')].map(n => n.textContent.trim())
})
// 四边前缀换成「虚线框 + 一条实边」的方向图标（跟粗细四边一致），不再是 ↑→↓← 字符
const prefixSvgs = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return [...sr.querySelectorAll('.sides .control .prefix')].map(n => !!n.querySelector('svg'))
})
T('2.5.15', prefixSvgs.length === 4 && prefixSvgs.every(Boolean), `四边前缀是方向图标（${prefixSvgs.length} 个 svg）`)
// 展开就是为了分别改：没有联动锁；收回按钮在网格第三列、高亮
T('2.5.15', await P('.lock[data-lock="padding"]').count() === 0 && await P('.sides .collapse-sides[data-kind="padding"][data-on]').count() === 1,
  '展开后没有联动锁，收回按钮在网格右上、处于高亮')
T('2.5.15', await P('input[data-pair="padding:horizontal"]').count() === 0,
  '展开状态下两段式的框让位')
T('2.5.15', await P('input[data-pair="margin:horizontal"]').count() === 1,
  '只展开内边距，外边距仍是两段式')
await tap(P('.collapse-sides[data-kind="padding"]'))
T('2.5.15', await P('input[data-pair="padding:horizontal"]').count() === 1 &&
            await P('input[data-prop="padding-top"]').count() === 0,
  '.collapse-sides 收回两段式')
await tap(P('.expand-sides[data-kind="padding"]'))
await select('free')
await select('pad')
T('2.5.15', await P('input[data-prop="padding-top"]').count() === 0,
  '展开状态绑在元素上，换元素即收起')

// ════════════════════════════════════════════════════════════
// 2.5.16 展开后四边各自独立（没有联动锁）
// ════════════════════════════════════════════════════════════
console.log('── 2.5.16 四边独立')
await select('pad')
await page.evaluate(() => { document.getElementById('pad').style.padding = '10px 20px' })
await select('free'); await select('pad')
await tap(P('.expand-sides[data-kind="padding"]'))
const ld0 = await depth()
const leftIn = P('input[data-prop="padding-left"]')
await leftIn.scrollIntoViewIfNeeded()
await leftIn.fill('30'); await leftIn.press('Enter'); await page.waitForTimeout(400)
s = await styles('pad', sideProps)
T('2.5.16', s['padding-left'] === '30px' && s['padding-top'] === '10px' && s['padding-right'] === '20px' && s['padding-bottom'] === '10px',
  `改左边只动左边，其余三边不动（${JSON.stringify(s)}）`)
const ld1 = await depth()
T('2.5.16', ld1 - ld0 === 1, `一次编辑一条历史（depth ${ld0} → ${ld1}）`)
await tap(page.locator('visual-revise-toolbar .undo'))
s = await styles('pad', sideProps)
T('2.5.16', s['padding-left'] === '20px', `⌘Z 退回那一边（${s['padding-left']}）`)
await tap(P('.sides .collapse-sides[data-kind="padding"]'))
T('2.5.16', await P('input[data-pair="padding:horizontal"]').count() === 1, '点网格里的收回按钮回到两段式')

// ════════════════════════════════════════════════════════════
// 2.5.17 裁剪内容
// ════════════════════════════════════════════════════════════
console.log('── 2.5.17 裁剪内容')
await select('pad')
await P('.clip-toggle').scrollIntoViewIfNeeded()
await P('.clip-toggle').check()
await page.waitForTimeout(340)
T('2.5.17', await style('pad', 'overflow') === 'hidden',
  `勾选裁剪内容写 overflow:hidden（${await style('pad', 'overflow')}）`)
await P('.clip-toggle').uncheck()
await page.waitForTimeout(340)
T('2.5.17', await style('pad', 'overflow') === '',
  `取消是清掉声明而不是写 visible（overflow inline = "${await style('pad', 'overflow')}"）`)
await select('pic')
T('2.5.17', await P('.clip-toggle').count() === 0,
  '[非文字元素隐藏]：<img> 上不渲染裁剪内容（overflow 对替换元素无效）')

// ════════════════════════════════════════════════════════════
// 2.5.18 排序 order
// ════════════════════════════════════════════════════════════
console.log('── 2.5.18 排序 order')
await select('kid')
T('2.5.18', await P('input[data-prop="order"]').count() === 1,
  '[flex 子项] 父级是 flex 时出现排序字段')
await write('order', 3)
T('2.5.18', await style('kid', 'order') === '3',
  `排序写 order 且不补单位（${await style('kid', 'order')}）`)
await select('gridkid')
T('2.5.18', await P('input[data-prop="order"]').count() === 1,
  '[grid 子项] 父级是 grid 时同样出现排序字段')
await select('blockkid')
T('2.5.18', await P('input[data-prop="order"]').count() === 0,
  '父级是普通块级容器时不出现排序字段——order 在那里不生效')

// ════════════════════════════════════════════════════════════
// 2.6.1 / 2.6.2 外观：不透明度 + 圆角
// ════════════════════════════════════════════════════════════
console.log('── 2.6 外观')
await select('appear')
const appear = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = [...sr.querySelectorAll('section')]
    .find(x => x.querySelector('h3 .title')?.textContent.trim() === 'Appearance')
  if (!sec) return null
  const op = sec.querySelector('input[data-prop="opacity"]')
  const br = sec.querySelector('input[data-prop="border-radius"]')
  return {
    hasBoth: !!op && !!br,
    opPrefix: op?.closest('.control')?.querySelector('.prefix')?.textContent.trim() || '',
    // 圆角前缀现在是 SVG 图标（一个圆角的弧），不再是字符
    brPrefix: br?.closest('.control')?.querySelector('.prefix svg') ? 'svg' : (br?.closest('.control')?.querySelector('.prefix')?.textContent.trim() || ''),
    // 不透明度 | 圆角 | 四角独立按钮 三格一行（.radius-row）
    samePair: !!op && !!br && op.closest('.radius-row') !== null && op.closest('.radius-row') === br.closest('.radius-row'),
  }
})
T('2.6.1', appear?.hasBoth && appear.opPrefix === '◍',
  `不透明度在 Appearance 分区，前缀 ◍（实际「${appear?.opPrefix}」）`)
// 面板里不透明度是百分比（Figma 的写法）：敲 50 → opacity: 0.5
await write('opacity', 50)
T('2.6.1', parseFloat(await style('appear', 'opacity')) === 0.5 && !/px/.test(await style('appear', 'opacity')),
  `不透明度百分比输入 50 → opacity 0.5 且不补单位（${await style('appear', 'opacity')}）`)
const opIn = P('input[data-prop="opacity"]')
await opIn.scrollIntoViewIfNeeded(); await opIn.click()
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(280)
T('2.6.1', Math.abs(parseFloat(await style('appear', 'opacity')) - 0.51) < 1e-6,
  `ArrowUp 步进 1%（0.5 → ${await style('appear', 'opacity')}）`)
await page.keyboard.press('Shift+ArrowDown'); await page.waitForTimeout(280)
T('2.6.1', Math.abs(parseFloat(await style('appear', 'opacity')) - 0.41) < 1e-6,
  `Shift 时步长 ×10（0.51 → ${await style('appear', 'opacity')}）`)
// CONTROLS['opacity'] 声明了 min:0 / max:100（百分比空间），步进不该越过它们
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(240)
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(280)
T('2.6.1', parseFloat(await style('appear', 'opacity')) >= 0,
  `步进不越过声明的下界 min:0（${await style('appear', 'opacity')}）`)
await write('opacity', 60)

T('2.6.2', appear?.brPrefix === 'svg', `圆角前缀是圆角弧图标（实际「${appear?.brPrefix}」）`)
await write('border-radius', 12)
T('2.6.2', await style('appear', 'border-radius') === '12px',
  `圆角写 border-radius，裸数字补 px（${await style('appear', 'border-radius')}）`)
T('2.6.2', appear?.samePair === true, '不透明度与圆角并排在同一行（.radius-row，右侧是四角独立按钮）')

// ── 收尾 ────────────────────────────────────────────────────
console.log(`\n通过 ${passed} · 失败 ${failed}\n`)
await browser.close(); await close()
console.log(process.exitCode ? '结果：有失败项\n' : '结果：全部通过\n')
