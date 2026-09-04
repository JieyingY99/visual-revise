// 重排模式看的是「这个元素在结构里的哪个位置」，不是它的属性。
// 所以这个模式有自己的面板：一棵图层树，能看结构、能跳转、能拖着排序。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[结构树测试] 重排模式的面板\n')
await page.goto(origin)
await injectVisBug(page, origin)

const tree = sel => page.locator(`visual-revise-panel visual-revise-tree ${sel}`)
const rows = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot.querySelector('visual-revise-tree').shadowRoot
  return [...sr.querySelectorAll('.row')].map(r => ({
    depth: +r.style.getPropertyValue('--depth'),
    name: r.querySelector('.name')?.textContent || '',
    preview: r.querySelector('.preview')?.textContent || '',
    tag: r.querySelector('.node-tag')?.textContent || '',
    selected: r.hasAttribute('data-selected'),
    open: r.querySelector('.twist')?.hasAttribute('data-open'),
    leaf: r.querySelector('.twist')?.hasAttribute('data-leaf'),
  }))
})

// ── 结构是面板里的一个 tab ──────────────────────────────────
// 重排以前是独立模式（按 R 弹一个单独的树浮层）。现在同一个元素的属性和它
// 在结构里的位置在一处看，不用在两块 UI 之间来回对。
const openStructure = async () => {
  if (!(await page.evaluate(() => !!document.querySelector('visual-revise-panel').target)))
    await page.locator('.curve-card').first().click({ position: { x: 120, y: 12 } })
  await page.waitForTimeout(400)
  await page.locator('visual-revise-panel .tab[data-tab="structure"]').click()
  await page.waitForTimeout(400)
}
const tabState = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return { tab: sr.querySelector('.tab[data-on]')?.dataset.tab, treeShown: !sr.querySelector('.structure')?.hidden,
           propsShown: !sr.querySelector('.scroll')?.hidden }
})

ok(await page.evaluate(() => document.querySelectorAll('visual-revise-tree').length) === 0,
   '未选中元素时没有结构树——面板本身就还没出现')

await openStructure()
const t1 = await tabState()
ok(t1.tab === 'structure' && t1.treeShown && !t1.propsShown,
   `切到「结构」tab 显示结构树、隐藏属性分组（${JSON.stringify(t1)}）`)

await page.locator('visual-revise-panel .tab[data-tab="props"]').click()
await page.waitForTimeout(350)
const t2 = await tabState()
ok(t2.tab === 'props' && !t2.treeShown && t2.propsShown, '切回「选择元素」tab，属性分组回来')

// ── 语义名 ──────────────────────────────────────────────────
await openStructure()
const top = await rows()
// 树列的是整页结构，并自动展开到当前选中的元素（和 DevTools 一致），
// 所以这里不再是「只有顶层」——顶层仍在，选中项那一支也展开着。
ok(top.some(r => r.depth === 0) && top.some(r => r.selected),
   `整页结构 + 展开到选中项（${top.length} 行，最深 depth ${Math.max(...top.map(r => r.depth))}）`)
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
  document.querySelector('visual-revise-panel').shadowRoot.querySelector('visual-revise-tree').shadowRoot.querySelectorAll('.row').length)

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
  // 面板只在选中元素后出现，树活在它的「结构」tab 里
  vr.setMode('select')
  const panel = document.querySelector('visual-revise-panel')
  if (!panel.target) {
    const first = cards.children[0]
    first.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await new Promise(r => setTimeout(r, 300))
  }
  panel.setTab('structure')
  await new Promise(r => setTimeout(r, 300))

  const sr = document.querySelector('visual-revise-panel').shadowRoot.querySelector('visual-revise-tree').shadowRoot
  const list = sr.querySelector('.list')
  const kids = [...cards.children]

  // 把树展开到卡片这一层
  const t = document.querySelector('visual-revise-panel').shadowRoot.querySelector('visual-revise-tree')
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

// ── 深层嵌套不能把面板撑爆 ──────────────────────────────────
// flex 子项默认按内容算最小宽度。树的行在深层缩进下很宽，没有 min-width:0
// 就会把整条链顶开：面板宽度失控、标题栏和 tab 被挤出视口，纵向滚动也一起没了。
await page.evaluate(() => {
  document.getElementById('deepwrap')?.remove()
  const w = document.createElement('div')
  w.id = 'deepwrap'
  w.style.cssText = 'position:absolute;left:20px;top:560px'
  const build = d => d === 0 ? '<span>底</span>'
    : `<div class="lv" style="display:flex">${build(d - 1)}${'<div class="sib" style="display:flex"><span>x</span></div>'.repeat(4)}</div>`
  w.innerHTML = build(12)
  document.body.appendChild(w)
})
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await page.locator('#deepwrap .lv').first().click(); await page.waitForTimeout(450)
await page.locator('visual-revise-panel .tab[data-tab="structure"]').click(); await page.waitForTimeout(600)
await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  sr.querySelectorAll('.twist:not([data-open]):not([data-leaf])').forEach(t => t.click())
})
await page.waitForTimeout(600)

const deep = await page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel'), sr = p.shadowRoot
  const pr = p.getBoundingClientRect()
  const treeSr = sr.querySelector('visual-revise-tree').shadowRoot
  const list = treeSr.querySelector('.list')
  const head = sr.querySelector('header').getBoundingClientRect()
  const tabs = sr.querySelector('.tabs').getBoundingClientRect()
  return {
    width: Math.round(pr.width),
    inViewport: pr.top >= 0 && pr.bottom <= innerHeight,
    headVisible: head.top >= 0 && head.bottom <= innerHeight,
    tabsVisible: tabs.top >= 0 && tabs.bottom <= innerHeight,
    rows: treeSr.querySelectorAll('.row').length,
    scrollable: list.scrollHeight > list.clientHeight,
  }
})
ok(deep.width === 300, `深层嵌套下面板宽度仍是 300（实得 ${deep.width}）`)
ok(deep.inViewport && deep.headVisible && deep.tabsVisible,
   '标题栏与 tab 没有被挤出视口')
ok(deep.rows > 30 && deep.scrollable,
   `内容超出时树可纵向滚动（${deep.rows} 行）`)
await page.evaluate(() => document.getElementById('deepwrap')?.remove())

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
