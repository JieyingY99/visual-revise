/**
 * 全量 e2e 分组 B：拆分行（四角 / 四边 / 内外边距）
 *
 * 清单：docs/plans/feature-inventory-v2.md
 *   2.5.15、2.5.16、2.5.19–2.5.21（内 / 外边距展开成四边）
 *   2.6.3–2.6.10（圆角的四角独立）
 *   2.9.6–2.9.13（描边粗细的四边独立）
 *   2.14.2（拆分网格与上一行同一套三列模板、逐格对齐）
 *   5.5.7（四条长手不进 inline 快照，合成一条简写；important 聚合；导出 / 导入往返）
 * PRD：AC-6.6b/6.6c、AC-6.37a–e、AC-6.38a–e、AC-9.12
 *
 * 断言全部落在真实结果上：元素的 inline / 计算样式、面板 shadow DOM 的几何与属性、
 * ChangeStore 的记录与历史深度、导出 JSON。触发尽量走真实指针与键盘。
 */
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const T = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

console.log('\n[全量 e2e · B 组] 拆分行：四角 / 四边 / 内外边距\n')

await page.goto(`${origin}/full/fixtures/split-rows.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(500)

// ── 通用工具 ────────────────────────────────────────────────
const P = sel => page.locator(`visual-revise-panel ${sel}`)

const inline = (id, prop) =>
  page.evaluate(([i, p]) => document.getElementById(i).style.getPropertyValue(p), [id, prop])

const inlines = (id, props) => page.evaluate(([i, ps]) => {
  const s = document.getElementById(i).style
  return Object.fromEntries(ps.map(p => [p, s.getPropertyValue(p)]))
}, [id, props])

const computed = (id, props) => page.evaluate(([i, ps]) => {
  const cs = getComputedStyle(document.getElementById(i))
  return Object.fromEntries(ps.map(p => [p, cs.getPropertyValue(p).trim()]))
}, [id, props])

const depth = () => page.evaluate(() => window.__visualRevise.store.history.depth)

const record = (id, prop) => page.evaluate(([i, p]) => {
  const el = document.getElementById(i)
  const edit = window.__visualRevise.store.read().edits.find(e => e.el === el)
  return edit?.changes.find(c => c.prop === p) ?? null
}, [id, prop])

const recordedProps = id => page.evaluate(i => {
  const el = document.getElementById(i)
  const edit = window.__visualRevise.store.read().edits.find(e => e.el === el)
  return (edit?.changes || []).map(c => c.prop)
}, id)

// 选中：先把面板里的焦点放掉（不然 Esc 被面板的 stopPropagation 吃掉），
// Esc 两下——第一下关弹层，第二下才取消选中——再真实点击目标
const select = async id => {
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  await page.locator(`#${id}`).click({ position: { x: 150, y: 26 } })
  await page.waitForTimeout(520)
}

const tap = async loc => {          // 面板是滚动容器，点之前先滚进来
  await loc.scrollIntoViewIfNeeded()
  await loc.click()
  await page.waitForTimeout(360)
}

const write = async (prop, value) => {
  const i = P(`input[data-prop="${prop}"]`).first()
  await i.scrollIntoViewIfNeeded()
  await i.fill(String(value))
  await i.press('Enter')
  await page.waitForTimeout(360)
}

// 真实指针拖拽某个手柄（前缀），每 2px 一步
const dragBy = async (loc, dx) => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(360)
}

const undo = async () => {
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await tap(page.locator('visual-revise-toolbar .undo'))
}

// 拆分行（圆角 / 粗细）的整体状态
const splitState = main => page.evaluate(m => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const row = sr.querySelector(`.split-row:has([data-split="${m}"])`)
  const btn = sr.querySelector(`[data-split="${m}"]`)
  const single = sr.querySelector(`input[data-prop="${m}"]`)
  const grid = row?.parentElement?.querySelector('.split-grid') || null
  const r = btn?.getBoundingClientRect()
  const cells = grid ? [...grid.querySelectorAll('.control')] : []
  return {
    hasRow: !!row,
    hasBtn: !!btn,
    on: btn ? btn.hasAttribute('data-on') : null,
    title: btn?.getAttribute('title') ?? null,
    btnW: r ? +r.width.toFixed(1) : null,
    btnH: r ? +r.height.toFixed(1) : null,
    btnIcon: btn ? btn.innerHTML.replace(/\s+/g, ' ').trim() : null,
    single: single?.value ?? null,
    placeholder: single?.getAttribute('placeholder') ?? null,
    gridProps: cells.map(c => c.querySelector('input')?.dataset.prop ?? null),
    gridValues: cells.map(c => c.querySelector('input')?.value ?? null),
    prefixIsSvg: cells.map(c => !!c.querySelector('.prefix svg')),
    prefixIcons: cells.map(c => (c.querySelector('.prefix')?.innerHTML || '').replace(/\s+/g, ' ').trim()),
    prefixDrag: cells.map(c => {
      const p = c.querySelector('.prefix')
      return p?.hasAttribute('data-drag') ? p.dataset.prop : null
    }),
    // 2×2 的实际几何：每格中心，用来验「左上 右上 / 左下 右下」这类排布
    cellCenters: cells.map(c => {
      const b = c.getBoundingClientRect()
      return { x: +(b.left + b.width / 2).toFixed(1), y: +(b.top + b.height / 2).toFixed(1) }
    }),
  }
}, main)

// 内 / 外边距：两段式 + 展开态四边
const sidesState = kind => page.evaluate(k => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const grid = sr.querySelector(`.sides:has(.collapse-sides[data-kind="${k}"])`)
  const pairBtn = sr.querySelector(`.expand-sides[data-kind="${k}"]`)
  const collapseBtn = grid?.querySelector('.collapse-sides') || null
  const cells = grid ? [...grid.querySelectorAll('.control')] : []
  const cb = collapseBtn?.getBoundingClientRect()
  const cbs = collapseBtn ? getComputedStyle(collapseBtn) : null
  return {
    expanded: !!grid,
    hasLock: !!sr.querySelector(`.lock[data-lock="${k}"]`),
    pairInputs: [...sr.querySelectorAll(`input[data-pair^="${k}:"]`)].map(i => i.dataset.pair),
    expandIcon: pairBtn ? pairBtn.innerHTML.replace(/\s+/g, ' ').trim() : null,
    collapseIcon: collapseBtn ? collapseBtn.innerHTML.replace(/\s+/g, ' ').trim() : null,
    collapseOn: collapseBtn ? collapseBtn.hasAttribute('data-on') : null,
    collapseW: cb ? +cb.width.toFixed(1) : null,
    collapseH: cb ? +cb.height.toFixed(1) : null,
    collapseArea: cbs ? `${cbs.gridRowStart} / ${cbs.gridColumnStart}` : null,
    gridProps: cells.map(c => c.querySelector('input')?.dataset.prop ?? null),
    gridValues: cells.map(c => c.querySelector('input')?.value ?? null),
    prefixIsSvg: cells.map(c => !!c.querySelector('.prefix svg')),
    prefixIcons: cells.map(c => (c.querySelector('.prefix')?.innerHTML || '').replace(/\s+/g, ' ').trim()),
    prefixDrag: cells.map(c => {
      const p = c.querySelector('.prefix')
      return p?.hasAttribute('data-drag') ? p.dataset.prop : null
    }),
    cellCenters: cells.map(c => {
      const b = c.getBoundingClientRect()
      return { x: +(b.left + b.width / 2).toFixed(1), y: +(b.top + b.height / 2).toFixed(1) }
    }),
  }
}, kind)

// 2×2 排布判定：四格的中心落成「左上 右上 / 左下 右下」
const isTwoByTwo = centers => {
  if (centers.length !== 4) return false
  const [a, b, c, d] = centers
  return a.x < b.x && c.x < d.x                      // 每行左格在左
    && Math.abs(a.y - b.y) < 2 && Math.abs(c.y - d.y) < 2   // 同行等高
    && c.y - a.y > 8 && d.y - b.y > 8                // 第二行在下
    && Math.abs(a.x - c.x) < 2 && Math.abs(b.x - d.x) < 2   // 同列对齐
}

// ════════════════════════════════════════════════════════════
// 2.6.3 圆角行的「四角独立」按钮（四角相等时收起）
// ════════════════════════════════════════════════════════════
console.log('── 2.6.3 圆角行的四角独立按钮')
await select('corners-even')
let r = await splitState('border-radius')
T('2.6.3', r.hasRow && r.hasBtn && r.on === false && r.gridProps.length === 0,
  `四角相等时按钮在、处于收起态（on=${r.on}，网格 ${r.gridProps.length} 格）`)
T('2.6.3', r.single === '8' && r.placeholder === null,
  `收起态单框显示当前圆角 8（实际「${r.single}」，placeholder=${r.placeholder}）`)
T('2.6.3', r.btnW === 32 && r.btnH === 32,
  `按钮 32×32、1:1（实际 ${r.btnW}×${r.btnH}）`)
{
  const icon = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const svg = sr.querySelector('[data-corners] svg')
    return svg ? { w: svg.getAttribute('width'), paths: svg.querySelectorAll('path').length } : null
  })
  T('2.6.3', icon && icon.w === '13' && icon.paths === 4,
    `按钮图标是 13px 的四个圆角括弧（width=${icon?.w}，${icon?.paths} 段路径）`)
  T('2.6.3', r.title === '分别设置四个角', `收起态 title「${r.title}」`)
}

// 单框「显示当前值」在非 px 单位下也得说得清：数字在框里、单位在框外最右（2.3.14）
{
  await select('corners-em')
  const read = () => page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const inp = sr.querySelector('input[data-prop="border-radius"]')
    const ctrl = inp?.closest('.control')
    return {
      value: inp?.value ?? null,
      unit: inp?.dataset.unit ?? null,
      hasSuffix: !!ctrl?.querySelector('.suffix'),
      suffix: ctrl?.querySelector('.suffix')?.textContent ?? null,
    }
  })
  const first = await read()
  // 真实交互触发一次回读：点进框再点走（blur → #syncValues）
  await P('input[data-prop="border-radius"]').first().click()
  await P('input[data-prop="opacity"]').first().click()
  await page.waitForTimeout(320)
  const synced = await read()
  T('2.6.3', first.hasSuffix === true,
    `圆角单框跟其它数值框一样带单位后缀元素（.suffix 存在=${first.hasSuffix}）`)
  T('2.6.3', synced.value === '1.5' && synced.suffix === 'em',
    `border-radius: 1.5em 的元素，框里是 1.5、框外后缀是 em（实际 value="${synced.value}" 后缀「${synced.suffix}」，首次渲染是 "${first.value}"）`)
}

// ════════════════════════════════════════════════════════════
// 2.6.4 展开成 2×2：左上 右上 / 左下 右下，各带自己那一角的圆弧图标
// ════════════════════════════════════════════════════════════
console.log('── 2.6.4 四角展开 2×2')
await select('corners-even')
await tap(P('[data-corners]'))
r = await splitState('border-radius')
T('2.6.4', JSON.stringify(r.gridProps) === JSON.stringify(
    ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius']),
  `展开后四格按「左上 右上 / 左下 右下」排（${r.gridProps.join(' | ')}）`)
T('2.6.4', isTwoByTwo(r.cellCenters),
  `四格真的落成 2×2（各格中心 ${JSON.stringify(r.cellCenters)}）`)
T('2.6.4', r.on === true && r.title === '合并成一个圆角',
  `按钮高亮且 title 换成收回（on=${r.on}，title「${r.title}」）`)
T('2.6.4', r.prefixIsSvg.length === 4 && r.prefixIsSvg.every(Boolean) && new Set(r.prefixIcons).size === 4,
  `四格各带自己那一角的圆弧图标（4 个 svg，互不相同：${new Set(r.prefixIcons).size} 种）`)
await tap(P('[data-corners]'))
T('2.6.4', (await splitState('border-radius')).gridProps.length === 0 && (await splitState('border-radius')).on === false,
  '再点一次收回（网格消失、按钮不再高亮）')

// ════════════════════════════════════════════════════════════
// 2.6.5 改一个角只写那一条长手；记录仍只有一条 border-radius
// 2.6.10 一次撤销只退回改过的那一个角
// ════════════════════════════════════════════════════════════
console.log('── 2.6.5 / 2.6.10 逐角改写与撤销')
await select('corners-work')
await tap(P('[data-corners]'))
const cornerProps = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
const d0 = await depth()
await write('border-top-left-radius', 20)
let ci = await inlines('corners-work', [...cornerProps, 'border-radius'])
T('2.6.5', ci['border-top-left-radius'] === '20px'
  && !ci['border-top-right-radius'] && !ci['border-bottom-right-radius'] && !ci['border-bottom-left-radius'],
  `改左上只写 border-top-left-radius，其余三条长手没被写（${JSON.stringify(ci)}）`)
let cc = await computed('corners-work', cornerProps)
T('2.6.5', cc['border-top-left-radius'] === '20px' && cc['border-top-right-radius'] === '6px'
  && cc['border-bottom-right-radius'] === '6px' && cc['border-bottom-left-radius'] === '6px',
  `页面上只有左上变了（${Object.values(cc).join(' / ')}）`)
{
  const props = await recordedProps('corners-work')
  const rec = await record('corners-work', 'border-radius')
  T('2.6.5', props.length === 1 && props[0] === 'border-radius',
    `改动记录里只有一条 border-radius（实际 ${JSON.stringify(props)}）`)
  T('2.6.5', rec?.to === '20px 6px 6px 6px',
    `记录值按「左上 右上 右下 左下」合成简写（实际「${rec?.to}」）`)
}
T('2.6.10', (await depth()) - d0 === 1, `逐角改一次只落一条历史（depth ${d0} → ${await depth()}）`)
await undo()
cc = await computed('corners-work', cornerProps)
T('2.6.10', cc['border-top-left-radius'] === '6px' && cc['border-top-right-radius'] === '6px'
  && cc['border-bottom-right-radius'] === '6px' && cc['border-bottom-left-radius'] === '6px',
  `一次撤销退回那一个角、其余不受影响（${Object.values(cc).join(' / ')}）`)

// ════════════════════════════════════════════════════════════
// 2.6.9 展开态四格支持拖前缀调值与方向键步进
// ════════════════════════════════════════════════════════════
console.log('── 2.6.9 拖前缀 / 方向键')
await select('corners-work')
r = await splitState('border-radius')
if (r.gridProps.length === 0) await tap(P('[data-corners]'))
T('2.6.9', (await splitState('border-radius')).prefixDrag.every(p => !!p),
  `四格前缀都带 data-drag（${JSON.stringify((await splitState('border-radius')).prefixDrag)}）`)
await dragBy(P('.split-grid.corners .prefix[data-prop="border-top-left-radius"]'), 40)
{
  const v = await computed('corners-work', ['border-top-left-radius', 'border-top-right-radius'])
  T('2.6.9', parseFloat(v['border-top-left-radius']) > 6 && v['border-top-right-radius'] === '6px',
    `拖左上前缀只调左上（6px → ${v['border-top-left-radius']}，右上仍 ${v['border-top-right-radius']}）`)
}
{
  const i = P('input[data-prop="border-top-right-radius"]')
  await i.scrollIntoViewIfNeeded(); await i.click()
  const before = (await computed('corners-work', ['border-top-right-radius']))['border-top-right-radius']
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(320)
  const after = (await computed('corners-work', ['border-top-right-radius']))['border-top-right-radius']
  T('2.6.9', parseFloat(after) - parseFloat(before) === 1,
    `右上框方向键步进 1（${before} → ${after}）`)
}

// ════════════════════════════════════════════════════════════
// 2.6.6 / 2.6.7 收起态四角不等：留空 + 占位「混合」；敲值写简写
// ════════════════════════════════════════════════════════════
console.log('── 2.6.6 / 2.6.7 收起态的「混合」')
await tap(P('[data-corners]'))       // 收回（此刻四角已不等）
r = await splitState('border-radius')
T('2.6.6', r.on === false && r.gridProps.length === 0 && r.single === '' && r.placeholder === '混合',
  `收起态四角不等：单框留空并占位「混合」（value="${r.single}" placeholder=${r.placeholder}）`)
await write('border-radius', 10)
r = await splitState('border-radius')
cc = await computed('corners-work', cornerProps)
T('2.6.7', await inline('corners-work', 'border-radius') === '10px'
  && cornerProps.every(p => cc[p] === '10px'),
  `单框敲 10 写 border-radius 简写、四角一起变（${Object.values(cc).join(' / ')}）`)
T('2.6.7', r.placeholder === null && r.single === '10',
  `占位当场撤掉、框里换成 10（placeholder=${r.placeholder}，value="${r.single}"）`)

// ════════════════════════════════════════════════════════════
// 2.6.8 页面本身四角不等的元素第一次显示就默认展开；切换元素重判
// ════════════════════════════════════════════════════════════
console.log('── 2.6.8 四角不等默认展开')
await select('corners-mixed')
r = await splitState('border-radius')
T('2.6.8', r.on === true && JSON.stringify(r.gridValues) === JSON.stringify(['4', '12', '0', '20']),
  `页面四角不等的元素默认展开，四框各显示自己的值（左上/右上/左下/右下 = ${r.gridValues.join(' / ')}）`)
await tap(P('[data-corners]'))       // 用户手动收起
T('2.6.8', (await splitState('border-radius')).on === false, '用户手动收起后保持收起')
await select('corners-even')
await select('corners-mixed')
T('2.6.8', (await splitState('border-radius')).on === true,
  '切走再切回按新元素重判，又变回默认展开')

// ════════════════════════════════════════════════════════════
// 2.9.6 / 2.9.7 Stroke：样式在左、粗细在右，粗细右侧是「四边独立」按钮
// ════════════════════════════════════════════════════════════
console.log('── 2.9.6 / 2.9.7 描边粗细行')
await select('sides-even')
{
  const order = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const row = sr.querySelector('.split-row.width-row')
    if (!row) return null
    const fields = [...row.querySelectorAll(':scope > .field')]
    return {
      first: fields[0]?.querySelector('vr-select')?.dataset.prop ?? fields[0]?.querySelector('input')?.dataset.prop ?? null,
      second: fields[1]?.querySelector('input')?.dataset.prop ?? null,
      thirdIsBtn: !!fields[2]?.querySelector('[data-sides]'),
      labels: fields.slice(0, 2).map(f => f.querySelector('.name')?.textContent.trim()),
    }
  })
  T('2.9.6', order && order.first === 'border-style' && order.second === 'border-width',
    `粗细行三格：样式在左、粗细在右（${JSON.stringify(order?.labels)}）`)
  T('2.9.7', order?.thirdIsBtn === true, '粗细右侧第三格是「四边独立」按钮')
}
let w = await splitState('border-width')
T('2.9.7', w.on === false && w.gridProps.length === 0 && w.single === '2',
  `四边相等时收起、单框显示当前粗细 2（on=${w.on}，value="${w.single}"）`)
T('2.9.7', w.btnW === 32 && w.btnH === 32, `按钮 32×32、1:1（实际 ${w.btnW}×${w.btnH}）`)
// 记下描边这一侧的「四边独立」图标，下面验内外边距的展开 / 收回钮跟它是同一个
const strokeSidesIcon = w.btnIcon

// ════════════════════════════════════════════════════════════
// 2.9.8 展开成 2×2：左 上 / 右 下，各带「虚线框 + 一条实边」图标
// ════════════════════════════════════════════════════════════
console.log('── 2.9.8 四边展开 2×2')
await tap(P('[data-sides]'))
w = await splitState('border-width')
T('2.9.8', JSON.stringify(w.gridProps) === JSON.stringify(
    ['border-left-width', 'border-top-width', 'border-right-width', 'border-bottom-width']),
  `展开后四格按 Figma 的「左 上 / 右 下」排（${w.gridProps.join(' | ')}）`)
T('2.9.8', isTwoByTwo(w.cellCenters), `四格真的落成 2×2（${JSON.stringify(w.cellCenters)}）`)
T('2.9.8', w.on === true && w.title === '合并成一个粗细',
  `按钮高亮、title 换成收回（on=${w.on}，title「${w.title}」）`)
T('2.9.8', w.prefixIsSvg.every(Boolean) && new Set(w.prefixIcons).size === 4,
  `四格各带自己那一边的方向图标（互不相同：${new Set(w.prefixIcons).size} 种）`)
await tap(P('[data-sides]'))
T('2.9.8', (await splitState('border-width')).gridProps.length === 0, '再点一次收回')

// ════════════════════════════════════════════════════════════
// 2.9.9 改一边只写那一条长手；记录仍只有一条 border-width（上 右 下 左）
// ════════════════════════════════════════════════════════════
console.log('── 2.9.9 逐边改写')
await select('sides-work')
await tap(P('[data-sides]'))
const sideProps = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']
await write('border-left-width', 6)
{
  const si = await inlines('sides-work', [...sideProps, 'border-width'])
  T('2.9.9', si['border-left-width'] === '6px'
    && !si['border-top-width'] && !si['border-right-width'] && !si['border-bottom-width'],
    `改左边只写 border-left-width（${JSON.stringify(si)}）`)
  const sc = await computed('sides-work', sideProps)
  T('2.9.9', sc['border-left-width'] === '6px' && sc['border-top-width'] === '3px'
    && sc['border-right-width'] === '3px' && sc['border-bottom-width'] === '3px',
    `页面上只有左边粗了（上/右/下/左 = ${sideProps.map(p => sc[p]).join(' / ')}）`)
  const props = await recordedProps('sides-work')
  const rec = await record('sides-work', 'border-width')
  T('2.9.9', props.filter(p => /border-.*width/.test(p)).length === 1 && props.includes('border-width'),
    `改动记录里粗细只有一条 border-width（实际 ${JSON.stringify(props)}）`)
  T('2.9.9', rec?.to === '3px 3px 3px 6px',
    `记录值按「上 右 下 左」合成，没写 inline 的三边取计算值（实际「${rec?.to}」）`)
}

// ════════════════════════════════════════════════════════════
// 2.9.10 / 2.9.11 收起态四边不等：留空 + 占位「混合」；敲值写简写
// ════════════════════════════════════════════════════════════
console.log('── 2.9.10 / 2.9.11 收起态的「混合」')
await tap(P('[data-sides]'))
w = await splitState('border-width')
T('2.9.10', w.on === false && w.gridProps.length === 0 && w.single === '' && w.placeholder === '混合',
  `收起态四边不等：单框留空并占位「混合」（value="${w.single}" placeholder=${w.placeholder}）`)
await write('border-width', 5)
w = await splitState('border-width')
{
  const sc = await computed('sides-work', sideProps)
  T('2.9.11', await inline('sides-work', 'border-width') === '5px' && sideProps.every(p => sc[p] === '5px'),
    `单框敲 5 写 border-width 简写、四边一起变（${sideProps.map(p => sc[p]).join(' / ')}）`)
  T('2.9.11', w.placeholder === null && w.single === '5',
    `占位当场撤掉、框里换成 5（placeholder=${w.placeholder}，value="${w.single}"）`)
}

// ════════════════════════════════════════════════════════════
// 2.9.12 页面本身四边不等的元素第一次显示就默认展开
// ════════════════════════════════════════════════════════════
console.log('── 2.9.12 四边不等默认展开')
await select('sides-mixed')
w = await splitState('border-width')
T('2.9.12', w.on === true && JSON.stringify(w.gridValues) === JSON.stringify(['4', '1', '2', '3']),
  `border-width: 1px 2px 3px 4px 的元素默认展开，左/上/右/下 = ${w.gridValues.join(' / ')}`)

// ════════════════════════════════════════════════════════════
// 2.9.13 空状态判定：任一边有宽度就算有描边
// ════════════════════════════════════════════════════════════
console.log('── 2.9.13 空状态判定')
const strokeShape = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = [...sr.querySelectorAll('section[data-group="stroke"]')][0]
  if (!sec) return null
  const add = sec.querySelector('.add[data-add="stroke"]')
  return {
    rows: sec.querySelectorAll('.rows .field').length,
    hasWidth: !!sec.querySelector('input[data-prop="border-width"], .split-grid input[data-prop$="-width"]'),
    addDisabled: add ? add.hasAttribute('disabled') : null,
  }
})
{
  const s = await strokeShape()
  T('2.9.13', s?.hasWidth === true && s.addDisabled === true,
    `四边不等（1/2/3/4）不退回空状态：粗细字段在、加号 disabled（rows=${s?.rows}）`)
}
await select('sides-one')
{
  const s = await strokeShape()
  T('2.9.13', s?.hasWidth === true && s.addDisabled === true,
    `只有左边 6px（简写读成空串）也算有描边（字段在=${s?.hasWidth}，加号 disabled=${s?.addDisabled}）`)
  const st = await splitState('border-width')
  T('2.9.13', st.on === true && st.gridValues[0] === '6' && st.gridValues.slice(1).every(v => v === '0'),
    `四边不等所以默认展开，左 6 其余 0（${st.gridValues.join(' / ')}）`)
}
await select('sides-none')
{
  const s = await strokeShape()
  T('2.9.13', s?.hasWidth === false && s.addDisabled === false,
    `真的没有描边时才退回空状态、加号可点（字段在=${s?.hasWidth}，加号 disabled=${s?.addDisabled}）`)
}

// ════════════════════════════════════════════════════════════
// 2.5.15 / 2.5.16 / 2.5.19 / 2.5.21 内外边距展开成四边
// ════════════════════════════════════════════════════════════
console.log('── 2.5.15 内外边距展开成四边')
await select('pad-work')
let sd = await sidesState('padding')
T('2.5.15', sd.expanded === false && sd.pairInputs.length === 2,
  `默认是两段式（水平 | 垂直，${sd.pairInputs.join(' | ')}）`)
await tap(P('.expand-sides[data-kind="padding"]'))
sd = await sidesState('padding')
T('2.5.21', JSON.stringify(sd.gridProps) === JSON.stringify(
    ['padding-left', 'padding-top', 'padding-right', 'padding-bottom']),
  `网格顺序是「左 上 / 右 下」（${sd.gridProps.join(' | ')}）`)
T('2.5.21', isTwoByTwo(sd.cellCenters), `四格真的落成 2×2（${JSON.stringify(sd.cellCenters)}）`)
T('2.5.15', sd.prefixIsSvg.every(Boolean) && new Set(sd.prefixIcons).size === 4,
  `四边前缀是「虚线框 + 一条实边」的方向图标，四个各不相同（${new Set(sd.prefixIcons).size} 种）`)
{
  // 与粗细四边共用同一套 EDGE 图标：左边那一格的图标应当和粗细的「左」完全一致
  const same = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const pad = sr.querySelector('.sides .control:nth-of-type(1) .prefix')?.innerHTML.replace(/\s+/g, ' ').trim()
    return { pad }
  })
  T('2.5.15', !!same.pad && /stroke-dasharray/.test(same.pad),
    '左边格的图标是虚线框 + 实边（含 stroke-dasharray）')
}
T('2.5.15', JSON.stringify(sd.prefixDrag) === JSON.stringify(sd.gridProps),
  `四个前缀都带 data-drag 且指向自己那一边（${JSON.stringify(sd.prefixDrag)}）`)
// 2.5.15 缺的那半条：前缀真的能横向拖着调值
{
  const before = await computed('pad-work', ['padding-left', 'padding-top', 'padding-right', 'padding-bottom'])
  await dragBy(P('.sides .prefix[data-prop="padding-left"]'), 40)
  const after = await computed('pad-work', ['padding-left', 'padding-top', 'padding-right', 'padding-bottom'])
  T('2.5.15', parseFloat(after['padding-left']) > parseFloat(before['padding-left'])
    && after['padding-top'] === before['padding-top']
    && after['padding-right'] === before['padding-right']
    && after['padding-bottom'] === before['padding-bottom'],
    `拖左边前缀只调左边（左 ${before['padding-left']} → ${after['padding-left']}，其余 ${['padding-top', 'padding-right', 'padding-bottom'].map(p => after[p]).join('/')}）`)
}

console.log('── 2.5.16 四边各自独立')
T('2.5.16', sd.hasLock === false, '展开后没有联动锁（.lock[data-lock] 已删除）')
{
  const pd0 = await depth()
  await write('padding-top', 33)
  const after = await computed('pad-work', ['padding-top', 'padding-bottom', 'padding-left', 'padding-right'])
  T('2.5.16', after['padding-top'] === '33px' && after['padding-bottom'] === '10px',
    `改上边只动上边、下边不跟（上 ${after['padding-top']} 下 ${after['padding-bottom']}）`)
  const pd1 = await depth()
  T('2.5.16', pd1 - pd0 === 1, `一次编辑一条历史（depth ${pd0} → ${pd1}）`)
  await undo()
  const back = await computed('pad-work', ['padding-top', 'padding-bottom'])
  T('2.5.16', back['padding-top'] === '10px' && back['padding-bottom'] === '10px',
    `一次撤销退回那一边（上 ${back['padding-top']}）`)
}

console.log('── 2.5.19 展开 / 收回按钮')
sd = await sidesState('padding')
{
  // 内边距此刻是展开态（只剩收回钮），拿仍是两段式的外边距那颗展开钮来比
  const mg = await sidesState('margin')
  T('2.5.19', !!mg.expandIcon && mg.expandIcon === sd.collapseIcon && /path/.test(sd.collapseIcon || ''),
    '展开钮与收回钮是同一个「四边独立」图标')
  T('2.5.19', !!strokeSidesIcon && strokeSidesIcon === sd.collapseIcon,
    '与描边粗细的「四边独立」按钮共用同一个图标')
}
T('2.5.19', sd.collapseOn === true && sd.collapseArea === '1 / 3',
  `展开态下收回钮高亮、落在网格第一行第三列（grid-area ${sd.collapseArea}）`)
T('2.5.19', sd.collapseW === 32 && sd.collapseH === 32,
  `收回钮 32×32（实际 ${sd.collapseW}×${sd.collapseH}）`)
T('2.5.19', (await sidesState('margin')).expanded === false,
  '只展开内边距，外边距仍是两段式')

// ════════════════════════════════════════════════════════════
// 2.5.20 展开网格与收起态的两段式同一套三列模板；展开前后同一列改同一组边
// ════════════════════════════════════════════════════════════
console.log('── 2.5.20 同一套三列模板')
{
  const tmpl = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const sides = sr.querySelector('.sides')
    const pair = sr.querySelector('.side-pair')
    const g = el => el ? { cols: getComputedStyle(el).gridTemplateColumns, gap: getComputedStyle(el).gap } : null
    return { sides: g(sides), pair: g(pair) }
  })
  const tracks = s => (s || '').split(/\s+/).length
  T('2.5.20', tmpl.sides && tmpl.pair && tmpl.sides.cols === tmpl.pair.cols && tracks(tmpl.sides.cols) === 3,
    `四边网格与两段式的列模板一致、都是三列（${tmpl.sides?.cols} vs ${tmpl.pair?.cols}）`)
  T('2.5.20', tmpl.sides?.gap === '4px' && tmpl.pair?.gap === '4px',
    `两者 gap 都是 4px（${tmpl.sides?.gap} / ${tmpl.pair?.gap}）`)
}
{
  // 展开前后同一列改的是同一组边：收起态左格 = 水平（左右），展开态左列 = 左 / 右
  const cols = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const sides = [...sr.querySelectorAll('.sides .control')].map(c => ({
      prop: c.querySelector('input')?.dataset.prop,
      left: +c.getBoundingClientRect().left.toFixed(1),
    }))
    const pair = [...sr.querySelectorAll('.side-pair .control')].map(c => ({
      pair: c.querySelector('input')?.dataset.pair,
      left: +c.getBoundingClientRect().left.toFixed(1),
    }))
    return { sides, pair }
  })
  const hz = cols.pair.find(p => /horizontal$/.test(p.pair || ''))
  const leftCol = cols.sides.filter(s => Math.abs(s.left - (hz?.left ?? -999)) < 0.5).map(s => s.prop)
  T('2.5.21', JSON.stringify(leftCol) === JSON.stringify(['padding-left', 'padding-right']),
    `展开前后同一列改同一组边：收起态「水平」那一列，展开后是左 / 右（${leftCol.join(' + ')}）`)
}

// 展开四边后，框里该显示作者写在 inline 上的写法（2em），不是浏览器算出来的 px；
// 否则点一下别处触发回读，四个框的数字会当场跳变
{
  await select('pad-em')
  await tap(P('.expand-sides[data-kind="padding"]'))
  const read = () => page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    return [...sr.querySelectorAll('.sides .control')].map(c => ({
      value: c.querySelector('input')?.value,
      suffix: c.querySelector('.suffix')?.textContent ?? '',
    }))
  })
  const first = await read()
  await P('.sides input[data-prop="padding-left"]').click()
  await P('.sides input[data-prop="padding-top"]').click()
  await page.waitForTimeout(320)
  const synced = await read()
  T('2.5.15', JSON.stringify(first) === JSON.stringify(synced),
    `展开后的四个框第一眼与回读后一致（首次 ${JSON.stringify(first.map(f => f.value + f.suffix))}，回读后 ${JSON.stringify(synced.map(f => f.value + f.suffix))}）`)
  T('2.5.15', first.every(f => f.value === '2' && f.suffix === 'em'),
    `padding: 2em 的元素展开后框里是作者写的 2em，不是算出来的 28px（实际 ${JSON.stringify(first.map(f => f.value + f.suffix))}）`)
}

// ════════════════════════════════════════════════════════════
// 2.14.2 三种拆分网格都与上一行的两个输入框左右对齐（±0.5px）
// ════════════════════════════════════════════════════════════
console.log('── 2.14.2 逐格对齐')
{
  // 内 / 外边距：展开的 .sides 四格 vs 仍是两段式的外边距 .side-pair 两格
  const off = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const cells = [...sr.querySelectorAll('.sides .control')].map(c => c.getBoundingClientRect())
    const ref = [...sr.querySelectorAll('.side-pair .control')].map(c => c.getBoundingClientRect())
    if (!cells.length || ref.length < 2) return ['没找到参照行']
    const bad = []
    cells.forEach((c, i) => {
      const r = ref[i % 2]
      if (Math.abs(c.left - r.left) > 0.5 || Math.abs(c.right - r.right) > 0.5)
        bad.push(`第 ${i + 1} 格 ${c.left.toFixed(1)}–${c.right.toFixed(1)} vs ${r.left.toFixed(1)}–${r.right.toFixed(1)}`)
    })
    return bad
  })
  T('2.14.2', off.length === 0, off.length ? `内外边距四边网格没对齐：${off.join('; ')}` : '内外边距四边网格逐格与两段式左右对齐')
}
await select('corners-mixed')
{
  const off = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const row = sr.querySelector('.split-row.radius-row')
    const above = [...row.querySelectorAll(':scope > .field')].slice(0, 2).map(f => f.getBoundingClientRect())
    const cells = [...sr.querySelectorAll('.split-grid.corners .control')].map(c => c.getBoundingClientRect())
    const bad = []
    cells.forEach((c, i) => {
      const r = above[i % 2]
      if (Math.abs(c.left - r.left) > 0.5 || Math.abs(c.right - r.right) > 0.5)
        bad.push(`第 ${i + 1} 格 ${c.left.toFixed(1)}–${c.right.toFixed(1)} vs ${r.left.toFixed(1)}–${r.right.toFixed(1)}`)
    })
    return bad
  })
  T('2.14.2', off.length === 0, off.length ? `四角网格没对齐：${off.join('; ')}` : '四角网格逐格与「不透明度 | 圆角」那一行左右对齐')
}
await select('sides-mixed')
{
  const off = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const row = sr.querySelector('.split-row.width-row')
    const above = [...row.querySelectorAll(':scope > .field')].slice(0, 2).map(f => f.getBoundingClientRect())
    const cells = [...sr.querySelectorAll('.split-grid.sides-grid .control')].map(c => c.getBoundingClientRect())
    const bad = []
    cells.forEach((c, i) => {
      const r = above[i % 2]
      if (Math.abs(c.left - r.left) > 0.5 || Math.abs(c.right - r.right) > 0.5)
        bad.push(`第 ${i + 1} 格 ${c.left.toFixed(1)}–${c.right.toFixed(1)} vs ${r.left.toFixed(1)}–${r.right.toFixed(1)}`)
    })
    return bad
  })
  T('2.14.2', off.length === 0, off.length ? `四边网格没对齐：${off.join('; ')}` : '四边粗细网格逐格与「样式 | 粗细」那一行左右对齐')
}

// ════════════════════════════════════════════════════════════
// 5.5.7 快照合成：长手不进 inline，统一合成一条简写
// ════════════════════════════════════════════════════════════
console.log('── 5.5.7 快照合成 / important 聚合 / 导入往返')
{
  const snap = await page.evaluate(async base => {
    const m = await import(`${base}/__app/core/snapshot.js`)
    const read = id => {
      const el = document.getElementById(id)
      return { inline: m.readInline(el), important: [...m.readInlineImportant(el)] }
    }
    // 四条长手都写在 inline 上、值相等 → 合成一个值
    const even = document.getElementById('sides-work')
    even.style.borderTopWidth = even.style.borderRightWidth =
      even.style.borderBottomWidth = even.style.borderLeftWidth = '4px'
    return {
      partial: read('corners-partial'),
      important: read('corners-important'),
      evenSynth: m.readInline(even)['border-width'],
      evenKeys: Object.keys(m.readInline(even)).filter(k => /border-.*-width/.test(k)),
    }
  }, origin)
  T('5.5.7', !Object.keys(snap.partial.inline).some(k => /^border-(top|bottom)-(left|right)-radius$/.test(k)),
    `四条长手不进 inline 快照（快照里的圆角键：${Object.keys(snap.partial.inline).filter(k => /radius/.test(k)).join(', ') || '（无）'}）`)
  T('5.5.7', snap.partial.inline['border-radius'] === '9px 0px 0px 0px',
    `只有左上写在 inline 时，其余三角取计算值合成简写（期望「9px 0px 0px 0px」，实际「${snap.partial.inline['border-radius']}」）`)
  T('5.5.7', snap.evenSynth === '4px' && snap.evenKeys.length === 0,
    `四条长手相等时合成一个值（期望「4px」，实际「${snap.evenSynth}」；长手键 ${snap.evenKeys.length} 个）`)
  T('5.5.7', snap.important.important.includes('border-radius')
    && !snap.important.important.some(p => /-radius$/.test(p) && p !== 'border-radius'),
    `任一长手带 important 就算这条简写带（important 集合：${JSON.stringify(snap.important.important)}）`)
}

// 5.5.7 导出 → 重置 → 导入：四角 / 四边的值要原样回来
{
  // 先把此前攒的改动清空，导出的 JSON 里只留这一条，断言才能落在它身上
  await page.evaluate(() => {
    const s = window.__visualRevise.store
    s.undoEverything(); s.clear(); s.history.clear()
  })
  await page.waitForTimeout(300)
  await select('corners-mixed')
  if ((await splitState('border-radius')).gridProps.length === 0) await tap(P('[data-corners]'))
  await write('border-top-left-radius', 18)
  const round = await page.evaluate(() => {
    const el = document.getElementById('corners-mixed')
    const data = window.__visualRevise.lib.exportJSON({ url: 'http://test.local', viewport: '1440 × 900' })
    const change = data.edits.flatMap(e => e.changes).find(c => c.prop === 'border-radius')
    const store = window.__visualRevise.store
    store.undoEverything(); store.clear(); store.history.clear()
    const afterReset = getComputedStyle(el).borderRadius
    const report = window.__visualRevise.lib.importJSON(data)
    const cs = getComputedStyle(el)
    return {
      exported: change?.to ?? null,
      afterReset,
      ok: report?.ok ?? null,
      corners: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
        .map(p => cs[p]),
      longhandChanges: data.edits.flatMap(e => e.changes).filter(c => /^border-(top|bottom)-(left|right)-radius$/.test(c.prop)).length,
    }
  })
  T('5.5.7', round.exported === '18px 12px 20px 0px' && round.longhandChanges === 0,
    `导出的 JSON 里只有合成的 border-radius（值「${round.exported}」，长手条目 ${round.longhandChanges} 条）`)
  T('5.5.7', round.afterReset === '4px 12px 20px 0px',
    `重置回到页面原样（期望「4px 12px 20px 0px」，实际「${round.afterReset}」）`)
  T('5.5.7', round.ok === true && JSON.stringify(round.corners) === JSON.stringify(['18px', '12px', '20px', '0px']),
    `导入重放后四个角原样回来（期望 18/12/20/0，实际 ${round.corners.join(' / ')}）`)
}

// 5.5.7 「没在 inline 里写的那一边取计算值 → 撤销 / 导入写回去不会把那一边归零」
{
  await select('corners-partial')
  if ((await splitState('border-radius')).gridProps.length === 0) await tap(P('[data-corners]'))
  const before = await computed('corners-partial', ['border-top-left-radius'])
  await write('border-top-right-radius', 15)
  await undo()
  const after = await computed('corners-partial',
    ['border-top-left-radius', 'border-top-right-radius'])
  T('5.5.7', after['border-top-left-radius'] === before['border-top-left-radius']
    && after['border-top-right-radius'] === '0px',
    `撤销只退回改过的那一角，作者原本写在 inline 的左上 ${before['border-top-left-radius']} 不该被抹掉（实际左上 ${after['border-top-left-radius']}，右上 ${after['border-top-right-radius']}）`)
}

// 5.5.7 改动列表里对合成的 border-radius 点「还原」：只该退回改过的那一角，
// 作者原本写在 inline 上的那一角不该被一起抹掉
{
  await page.evaluate(() => {
    const s = window.__visualRevise.store
    s.undoEverything(); s.clear(); s.history.clear()
  })
  await page.waitForTimeout(300)
  await select('corners-partial')
  if ((await splitState('border-radius')).gridProps.length === 0) await tap(P('[data-corners]'))
  const authored = (await computed('corners-partial', ['border-top-left-radius']))['border-top-left-radius']
  await write('border-top-right-radius', 15)
  // 打开改动列表（面板里有焦点时 L 会被输入框吃掉，先失焦）
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  if (await page.evaluate(() => document.querySelector('visual-revise-list').hidden)) {
    await page.keyboard.press('l'); await page.waitForTimeout(400)
  }
  const rows = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-list').shadowRoot
    return [...sr.querySelectorAll('.undo-prop')].map(b => b.dataset.prop)
  })
  T('5.5.7', JSON.stringify(rows) === JSON.stringify(['border-radius']),
    `改动列表里只有一条 border-radius 可还原（实际 ${JSON.stringify(rows)}）`)
  await tap(page.locator('visual-revise-list .undo-prop[data-prop="border-radius"]'))
  const back = await computed('corners-partial', ['border-top-left-radius', 'border-top-right-radius'])
  T('5.5.7', back['border-top-left-radius'] === authored && back['border-top-right-radius'] === '0px',
    `点「还原」退回改动前的样子：左上仍是作者写的 ${authored}（实际 ${back['border-top-left-radius']}），右上回到 0px（实际 ${back['border-top-right-radius']}）`)
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await page.keyboard.press('l'); await page.waitForTimeout(300)
}

// ── 收尾 ────────────────────────────────────────────────────
console.log(`\n通过 ${passed} · 失败 ${failed}\n`)
await browser.close(); await close()
console.log(process.exitCode ? '结果：有失败项\n' : '结果：全部通过\n')
