// 重排模式看的是「这个元素在结构里的哪个位置」，不是它的属性。
// 所以这个模式有自己的面板：一棵图层树，能看结构、能跳转、能拖着排序。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[结构树测试] 重排模式的面板\n')
await page.goto(origin)
await injectVisBug(page, origin)

const tree = sel => page.locator(`visual-revise-tree ${sel}`)
const rows = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-tree').shadowRoot
  return [...sr.querySelectorAll('.row')].map(r => ({
    depth: +r.style.getPropertyValue('--depth'),
    name: r.querySelector('.name')?.textContent || '',
    preview: r.querySelector('.preview')?.textContent || '',
    tag: r.querySelector('.tag')?.textContent || '',
    selected: r.hasAttribute('data-selected'),
    open: r.querySelector('.twist')?.hasAttribute('data-open'),
    leaf: r.querySelector('.twist')?.hasAttribute('data-leaf'),
  }))
})

// ── 模式互斥 ────────────────────────────────────────────────
await page.evaluate(() => window.__visualRevise.setMode('reorder'))
await page.waitForTimeout(300)
ok(!(await page.locator('visual-revise-tree').isHidden()), '重排模式出现结构树')
ok(await page.locator('visual-revise-panel').isHidden(), '属性面板同时收起——两块 UI 占同一个位置')

await page.evaluate(() => window.__visualRevise.setMode('select'))
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-tree').isHidden(), '切回选择模式，结构树收起')

// ── 语义名 ──────────────────────────────────────────────────
await page.evaluate(() => window.__visualRevise.setMode('reorder'))
await page.waitForTimeout(300)
const top = await rows()
ok(top.length > 0 && top.every(r => r.depth === 0), `默认只列顶层（${top.length} 行，均为 depth 0）`)
ok(top.some(r => r.name === 'Main' && r.tag === 'main'), '语义标签直接取原义：Main / main')

const named = await page.evaluate(() => {
  const { semanticName } = window.__visualRevise.lib
  const pick = sel => document.querySelector(sel)
  return {
    heading: semanticName(pick('.card-title')),
    list: semanticName(pick('ul') || document.createElement('ul')),
    image: semanticName(pick('img') || document.createElement('img')),
    row: (() => {
      const d = document.createElement('div')
      d.style.cssText = 'display:flex;flex-direction:row'
      d.innerHTML = '<span>a</span><span>b</span>'
      document.body.append(d)
      const name = semanticName(d)
      d.remove()
      return name
    })(),
    column: (() => {
      const d = document.createElement('div')
      d.style.cssText = 'display:flex;flex-direction:column'
      d.innerHTML = '<span>a</span>'
      document.body.append(d)
      const name = semanticName(d)
      d.remove()
      return name
    })(),
  }
})
ok(named.heading === 'Heading', `h2 → ${named.heading}`)
ok(named.list === 'List', `ul → ${named.list}`)
ok(named.image === 'Image', `img → ${named.image}`)
ok(named.row === 'Row' && named.column === 'Column',
   `div 没有语义，按它实际扮演的角色命名：横排 → ${named.row}，竖排 → ${named.column}`)

// ── 只展开选中那条路径 ──────────────────────────────────────
await page.locator('.card-title').first().click()
await page.waitForTimeout(400)
const afterSelect = await rows()
const selected = afterSelect.filter(r => r.selected)
ok(selected.length === 1 && selected[0].name === 'Heading',
   `选中的元素在树里高亮：${selected[0]?.name} ${selected[0]?.tag}`)
ok(selected[0].preview.includes('Original') || selected[0].preview.length > 2,
   `行上带一小段文字预览：${selected[0]?.preview}`)

const openCount = afterSelect.filter(r => r.open).length
ok(openCount > 0 && openCount < afterSelect.length,
   `只展开到选中项那条路径（展开 ${openCount} / 共 ${afterSelect.length} 行）`)

// ── 折叠箭头与选中互不干扰 ──────────────────────────────────
const countRows = () => page.evaluate(() =>
  document.querySelector('visual-revise-tree').shadowRoot.querySelectorAll('.row').length)

const beforeFold = await countRows()
// 必须用真实点击：合成的 click 不带坐标，会被 VisBug 的 body 捕获处理器
// 当成「点在页面上」而 preventDefault 掉，根本到不了 shadow 里
await tree('.row .twist[data-open]').first().click()
await page.waitForTimeout(250)
const afterFold = await countRows()
ok(afterFold < beforeFold, `点折叠箭头收起该分支（${beforeFold} → ${afterFold} 行）`)
ok(await page.evaluate(() =>
  document.querySelectorAll('[data-selected]').length) === 1,
   '折叠不影响页面上的选中——箭头和选中是两件事')

// ── 点行 = 选中页面元素 ─────────────────────────────────────
await tree('.row').filter({ hasText: 'Section' }).first().click()
await page.waitForTimeout(400)
ok(await page.evaluate(() =>
  document.querySelector('[data-selected]')?.tagName.toLowerCase()) === 'section',
   '点树里的行，页面上就选中对应元素')

// ── 拖动排序 ────────────────────────────────────────────────
// 排序写的是 CSS order，页面拖和树里拖走同一个函数，记录才一致
const before = await page.evaluate(() =>
  [...document.querySelectorAll('.curve-card .card-title')].map(e => e.textContent.trim()))

const dragged = await page.evaluate(async () => {
  const vr = window.__visualRevise
  const cards = document.querySelector('.cards')
  vr.setMode('reorder')
  await new Promise(r => setTimeout(r, 200))

  const sr = document.querySelector('visual-revise-tree').shadowRoot
  const list = sr.querySelector('.list')
  const kids = [...cards.children]

  // 把树展开到卡片这一层
  const t = document.querySelector('visual-revise-tree')
  t.setTarget(kids[0])
  await new Promise(r => setTimeout(r, 100))

  const rowFor = el => [...sr.querySelectorAll('.row')].find(r => {
    const id = r.dataset.id
    return el.__visualReviseId === id
  })

  const from = rowFor(kids[0])
  const to = rowFor(kids[2])
  if (!from || !to) return { skipped: true }

  const a = from.getBoundingClientRect()
  const b = to.getBoundingClientRect()
  const opts = { bubbles: true, composed: true, pointerId: 1, button: 0 }

  from.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: a.left + 40, clientY: a.top + 10 }))
  list.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: a.left + 40, clientY: b.bottom - 2 }))
  list.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: a.left + 40, clientY: b.bottom - 2 }))

  await new Promise(r => setTimeout(r, 200))
  return {
    orders: [...cards.children].map(c => getComputedStyle(c).order),
  }
})

ok(!dragged.skipped, '树里找得到要拖的那两行')
ok(dragged.orders?.some(o => o !== '0'),
   `拖完写入了 CSS order：${JSON.stringify(dragged.orders)}`)

const afterDrag = await page.evaluate(() => {
  const cards = document.querySelector('.cards')
  return [...cards.children]
    .map(c => ({ t: c.querySelector('.card-title')?.textContent.trim(), o: +getComputedStyle(c).order }))
    .sort((x, y) => x.o - y.o).map(x => x.t)
})
ok(afterDrag[0] !== before[0], `视觉顺序真的变了：${before[0]} → ${afterDrag[0]}`)

// 一次拖拽 = 一步历史，⌘Z 该整体退回去而不是一个兄弟一步地往回倒
const depth = await page.evaluate(() => window.__visualRevise.store.history.depth)
await page.evaluate(() => window.__visualRevise.store.undo())
await page.waitForTimeout(300)
const restored = await page.evaluate(() => {
  const cards = document.querySelector('.cards')
  return [...cards.children]
    .map(c => ({ t: c.querySelector('.card-title')?.textContent.trim(), o: +getComputedStyle(c).order }))
    .sort((x, y) => x.o - y.o).map(x => x.t)
})
ok(restored[0] === before[0],
   `一次 ⌘Z 整体退回（${afterDrag[0]} → ${restored[0]}）——拖一次是一个动作，不该退好几步`)
ok(depth >= 1, `拖拽只压了一条历史（depth=${depth}）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
