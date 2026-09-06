// 结构 tab 看的是「这个元素在结构里的哪个位置」，不是它的属性。
// 一棵图层树：能看结构、能跳转、能拖着搬家（跨容器也行）。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[结构树测试] 属性面板的结构 tab\n')
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
// 结构树以前是独立浮层（按 R 弹出来）。现在同一个元素的属性和它在结构里的
// 位置在一处看，不用在两块 UI 之间来回对。
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

// ── 拖动移动 ────────────────────────────────────────────────
// 移动真的搬 DOM 节点，落点分 before / after / inside 三档，可以跨容器。
// 手势必须是真实鼠标事件：合成的 PointerEvent 走不通指针捕获那条路。
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  document.getElementById('tw')?.remove()
  const w = document.createElement('div')
  w.id = 'tw'
  w.style.cssText = 'position:absolute;left:20px;top:620px'
  w.innerHTML = '<div id="tw-a" style="padding:4px"><p class="tn">T1</p><p class="tn">T2</p></div>'
    + '<div id="tw-b" style="padding:4px"><p class="tn">T3</p></div>'
  document.body.appendChild(w)
})

const kidsOf = id => page.evaluate(x =>
  [...document.getElementById(x).children].map(n => n.textContent.trim()).join(','), id)

// 树的行活在两层 shadow 里，取坐标之前先滚进可视区——面板是滚动容器，
// 视口外的行量出来的 rect 用来点会点空
const rowBox = (sel, opts = {}) => page.evaluate(([s, o]) => {
  const el = o.byId ? document.getElementById(s) : document.querySelector(s)
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  const row = [...sr.querySelectorAll('.row')].find(r => r.dataset.id === el.__visualReviseId)
  if (!row) return null
  row.scrollIntoViewIfNeeded ? row.scrollIntoViewIfNeeded() : row.scrollIntoView({ block: 'nearest' })
  const r = row.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}, [sel, opts])

// 把树展开到目标那一层：选中页面元素，树会自动展开这条路径。
// 展开集是累积的，所以依次选中几个元素就能把好几条支展开
const openTreeAt = async (...sels) => {
  for (const sel of sels) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    await page.locator(sel).first().click(); await page.waitForTimeout(400)
  }
  await page.locator('visual-revise-panel .tab[data-tab="structure"]').click()
  await page.waitForTimeout(400)
}

// 把 source 那一行拖到 target 行的某一段上（0 = 上 1/3，.5 = 中段，1 = 下 1/3）
const dragRow = async (source, target, frac) => {
  const a = await rowBox(source)
  const b = await rowBox(target, { byId: /^tw-/.test(target) })
  if (!a || !b) return false
  const y = frac === 0 ? b.top + 2 : frac === 1 ? b.top + b.height - 2 : b.top + b.height / 2
  await page.mouse.move(a.left + 60, a.top + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.left + 60, a.top + a.height / 2 + 6, { steps: 3 })
  await page.mouse.move(a.left + 60, y, { steps: 8 })
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForTimeout(350)
  return true
}

await openTreeAt('#tw-b .tn', '#tw-a .tn')
ok(await rowBox('#tw-a .tn') !== null, '树里找得到要拖的那一行')

// before：插到目标行之前
ok(await dragRow('#tw-a .tn', '#tw-b .tn', 0), '拿到了两行的坐标')
ok(await kidsOf('tw-b') === 'T1,T3' && await kidsOf('tw-a') === 'T2',
   `拖到目标行上 1/3 → 插到它前面（#tw-b = ${await kidsOf('tw-b')}）`)

// 一次拖拽 = 一步历史，⌘Z 整体退回
const depth = await page.evaluate(() => window.__visualRevise.store.history.depth)
await page.evaluate(() => window.__visualRevise.store.undo())
await page.waitForTimeout(300)
ok(await kidsOf('tw-a') === 'T1,T2' && await kidsOf('tw-b') === 'T3',
   `一次 ⌘Z 整体退回（#tw-a = ${await kidsOf('tw-a')}）——拖一次是一个动作`)
ok(depth >= 1, `拖拽只压了一条历史（depth=${depth}）`)

// after：插到目标行之后
await openTreeAt('#tw-b .tn', '#tw-a .tn')
await dragRow('#tw-a .tn', '#tw-b .tn', 1)
ok(await kidsOf('tw-b') === 'T3,T1',
   `拖到目标行下 1/3 → 插到它后面（#tw-b = ${await kidsOf('tw-b')}）`)
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(300)

// inside：放进容器里，成为它的最后一个孩子
await openTreeAt('#tw-b .tn', '#tw-a .tn')
await dragRow('#tw-a .tn', 'tw-b', .5)
ok(await kidsOf('tw-b') === 'T3,T1',
   `拖到容器行中段 → 放进容器里（#tw-b = ${await kidsOf('tw-b')}）`)
ok((await page.evaluate(() => window.__visualRevise.store.stats().moves)) === 1,
   '跨容器移动记入 moves')

await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  document.getElementById('tw')?.remove()
})
await page.waitForTimeout(250)

// ── 共享联动的边界 ──────────────────────────────────────────
// 同一个父级里换位，联动到每个同构容器；跨容器只动当前这一个——
// 另一个副本里「对应的目标容器」是谁靠下标推不出来，猜错就是搬到不相干的地方。
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await page.evaluate(() => {
  document.getElementById('sw')?.remove()
  const w = document.createElement('div')
  w.id = 'sw'
  w.style.cssText = 'position:absolute;left:20px;top:620px'
  w.innerHTML = '<div class="grp" style="padding:4px"><p class="g">A1</p><p class="g">A2</p></div>'
    + '<div class="grp" style="padding:4px"><p class="g">B1</p><p class="g">B2</p></div>'
  document.body.appendChild(w)
})
const groups = () => page.evaluate(() =>
  [...document.querySelectorAll('#sw .grp')]
    .map(g => [...g.children].map(n => n.textContent.trim()).join(',')).join(' / '))
const grpRowBox = n => page.evaluate(i => {
  const el = document.querySelectorAll('#sw .grp')[i]
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  const row = [...sr.querySelectorAll('.row')].find(r => r.dataset.id === el.__visualReviseId)
  if (!row) return null
  row.scrollIntoViewIfNeeded ? row.scrollIntoViewIfNeeded() : row.scrollIntoView({ block: 'nearest' })
  const r = row.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}, n)

await page.locator('#sw .grp').nth(1).locator('.g').first().click(); await page.waitForTimeout(400)
await page.locator('#sw .grp').nth(0).locator('.g').first().click(); await page.waitForTimeout(400)
await page.locator('visual-revise-panel .shared').click(); await page.waitForTimeout(300)
await page.locator('visual-revise-panel .tab[data-tab="structure"]').click(); await page.waitForTimeout(400)

// 同父级换位：A1 拖到 A2 下 1/3 → 两组一起换
await dragRow('#sw .grp:nth-of-type(1) .g:nth-of-type(1)', '#sw .grp:nth-of-type(1) .g:nth-of-type(2)', 1)
ok(await groups() === 'A2,A1 / B2,B1',
   `共享开着时同父级换位联动到同构容器（${await groups()}）`)

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(300)

// 跨容器：只动当前这一个，并且给出提示
const a1 = await rowBox('#sw .grp:nth-of-type(1) .g:nth-of-type(1)')
const g2 = await grpRowBox(1)
if (a1 && g2) {
  await page.mouse.move(a1.left + 60, a1.top + a1.height / 2)
  await page.mouse.down()
  await page.mouse.move(a1.left + 60, a1.top + a1.height / 2 + 6, { steps: 3 })
  await page.mouse.move(a1.left + 60, g2.top + g2.height / 2, { steps: 8 })
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForTimeout(400)
}
ok(await groups() === 'A2 / B1,B2,A1',
   `跨容器移动只作用于当前元素（${await groups()}）`)
const crossToast = await page.evaluate(() => {
  const t = document.querySelector('visual-revise-panel').shadowRoot.querySelector('.toast')
  return t?.hasAttribute('data-show') ? t.textContent : ''
})
ok(crossToast.includes('跨容器'), `并给出提示：「${crossToast}」`)

await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  document.getElementById('sw')?.remove()
})
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

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
