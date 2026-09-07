// 全量 e2e · 分块「结构树」——功能清单 docs/plans/feature-inventory.md §2.13（2.13.1–2.13.19）
//
// 结构树活在属性面板的「结构」tab 里（embedded），内容在两层 shadow 里：
//   visual-revise-panel#shadow > .structure > visual-revise-tree#shadow > .list > .row
// 断言全部落在真实结果上：页面 DOM 的父子/兄弟顺序、改动记录（store）、
// 面板与工具条的 toast、树自己渲染出来的行。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()          // 默认服务 tests-e2e 目录
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[全量·结构树] 功能清单 §2.13\n')
await page.goto(`${origin}/full/fixtures/tree-lab.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(300)

const TREE = 'visual-revise-panel visual-revise-tree'

// ── 读树 ────────────────────────────────────────────────────
// 行的 data-id 就是 elementId()（元素上的 __visualReviseId），页面元素与行靠它对上
const rowData = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel')?.shadowRoot
    ?.querySelector('visual-revise-tree')?.shadowRoot
  if (!sr) return []
  return [...sr.querySelectorAll('.row')].map(r => ({
    id: r.dataset.id,
    depth: +r.style.getPropertyValue('--depth'),
    name: r.querySelector('.name')?.textContent ?? '',
    preview: r.querySelector('.preview')?.textContent ?? null,
    tag: r.querySelector('.node-tag')?.textContent ?? '',
    selected: r.hasAttribute('data-selected'),
    open: !!r.querySelector('.twist')?.hasAttribute('data-open'),
    leaf: !!r.querySelector('.twist')?.hasAttribute('data-leaf'),
  }))
})

const idOf = sel => page.evaluate(s => document.querySelector(s)?.__visualReviseId ?? null, sel)
const rowSel = async sel => {
  const id = await idOf(sel)
  return id ? `${TREE} .row[data-id="${id}"]` : null
}
const rowOf = async (sel, all) => {
  const id = await idOf(sel)
  return (all || await rowData()).find(r => r.id === id) || null
}
const rowCount = () => page.evaluate(() => document.querySelector('visual-revise-panel')
  ?.shadowRoot?.querySelector('visual-revise-tree')?.shadowRoot
  ?.querySelectorAll('.row').length ?? 0)

// ── 读页面 ──────────────────────────────────────────────────
const kidsOf = id => page.evaluate(x =>
  [...document.getElementById(x).children].map(n => n.id || n.tagName.toLowerCase()).join(','), id)
const selectedId = () => page.evaluate(() =>
  document.querySelector('[data-selected]')?.id ?? null)
const store = fn => page.evaluate(fn)

// 面板自己的 toast（共享 / CSS order 的提示）与宿主工具条的 toast（已移动到 X 里）
const panelToast = () => page.evaluate(() => {
  const t = document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector('.toast')
  return t?.hasAttribute('data-show') ? t.textContent : ''
})
const hostToast = () => page.evaluate(() => {
  const t = document.getElementById('visual-revise-toast')
  return t && t.style.opacity === '1' ? t.textContent : ''
})

// ── 真实操作 ────────────────────────────────────────────────
const selectPage = async (sel, opts = {}) => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  await page.locator(sel).first().click(opts); await page.waitForTimeout(450)
}
const openStructure = async () => {
  await page.locator('visual-revise-panel .tab[data-tab="structure"]').click()
  await page.waitForTimeout(400)
}
const clickTwist = async sel => {
  const s = await rowSel(sel)
  if (!s) return false
  await page.locator(`${s} .twist`).click()
  await page.waitForTimeout(300)
  return true
}
const clickRow = async sel => {
  const s = await rowSel(sel)
  if (!s) return false
  await page.locator(s).click()
  await page.waitForTimeout(500)
  return true
}

// 两行一起量：先各自滚进可视区再取 rect，避免「量完 A 再滚 B 把 A 挤走」
const boxes = (aSel, bSel) => page.evaluate(([sa, sb]) => {
  const sr = document.querySelector('visual-revise-panel')?.shadowRoot
    ?.querySelector('visual-revise-tree')?.shadowRoot
  if (!sr) return null
  const find = s => {
    const el = document.querySelector(s)
    if (!el) return null
    return [...sr.querySelectorAll('.row')].find(r => r.dataset.id === el.__visualReviseId) || null
  }
  const ra = find(sa), rb = find(sb)
  if (!ra || !rb) return null
  ra.scrollIntoViewIfNeeded?.(); rb.scrollIntoViewIfNeeded?.()
  const box = n => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height } }
  return { a: box(ra), b: box(rb) }
}, [aSel, bSel])

// 拖拽中的落点指示（drop-line / data-drop-inside / data-dragging）。
// 传 targetSel 时顺带算出「这条线应该落在哪」——目标行的上/下边缘换算到 .list 的内部坐标
const dropState = (targetSel = null) => page.evaluate(s => {
  const sr = document.querySelector('visual-revise-panel')?.shadowRoot
    ?.querySelector('visual-revise-tree')?.shadowRoot
  if (!sr) return null
  const line = sr.querySelector('.drop-line')
  const list = sr.querySelector('.list')
  const inside = sr.querySelector('.row[data-drop-inside]')

  let want = null
  const el = s ? document.querySelector(s) : null
  const row = el && [...sr.querySelectorAll('.row')].find(r => r.dataset.id === el.__visualReviseId)
  if (row) {
    const rr = row.getBoundingClientRect(), lr = list.getBoundingClientRect()
    want = { top: rr.top - lr.top + list.scrollTop, bottom: rr.bottom - lr.top + list.scrollTop }
  }

  return {
    dragging: list.hasAttribute('data-dragging'),
    lineHidden: !!line.hidden,
    lineTop: parseFloat(line.style.top || 'NaN'),
    insideId: inside?.dataset.id ?? null,
    want,
  }
}, targetSel)

// 行 A 拖到行 B 的某一段：before = 上 1/3，after = 下 1/3，inside = 中段
const dragRow = async (fromSel, toSel, where, mid) => {
  const bx = await boxes(fromSel, toSel)
  if (!bx) return false
  const { a, b } = bx
  const y = where === 'before' ? b.top + 2
    : where === 'after' ? b.top + b.h - 2
    : b.top + b.h / 2
  const x = a.left + Math.min(60, a.w / 2)
  await page.mouse.move(x, a.top + a.h / 2)
  await page.mouse.down()
  await page.mouse.move(x, a.top + a.h / 2 + 8, { steps: 3 })   // 越过 4px slop
  await page.mouse.move(x, y, { steps: 8 })
  await page.waitForTimeout(150)
  if (mid) await mid()
  await page.mouse.up()
  await page.waitForTimeout(450)
  return true
}

const resetStore = async () => {
  await store(() => window.__visualRevise.store.undoEverything())
  await page.waitForTimeout(350)
}

// ══════════════════════════════════════════════════════════════
// 2.13.2 整页递归渲染 + 行的组成
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.2 整页结构 / 行的组成')
await selectPage('#a1')
await openStructure()

const all1 = await rowData()
const depth0 = all1.filter(r => r.depth === 0)
ok(depth0.map(r => r.tag).join(',') === 'main,div,div,div,div',
   `2.13.2 从 document.body 起铺开：顶层行 = body 的元素子节点（${depth0.map(r => r.tag).join(',')}）`)
ok(!all1.some(r => r.tag === 'body' || r.tag === 'html' || r.tag === 'head'),
   '2.13.2 body / html / head 自己不占行——递归从 body 的孩子开始')
ok(!all1.some(r => r.tag === 'script' || r.tag === 'style'),
   '2.13.2 script / style 这类不参与布局的标签不进树')

const rowA1 = await rowOf('#a1', all1)
ok(rowA1 && rowA1.name === 'Paragraph' && rowA1.preview === 'A1' && rowA1.tag === 'p',
   `2.13.2 一行 = 箭头 + 名称 + 文本预览 + 标签（${JSON.stringify(rowA1 && [rowA1.name, rowA1.preview, rowA1.tag])}）`)
const named = await Promise.all(['#alpha', '#sp', '#ordered', '#many', '#title']
  .map(async s => [s, (await rowOf(s, all1))?.name]))
ok(JSON.stringify(named) === JSON.stringify([['#alpha', 'Section'], ['#sp', 'Text'],
  ['#ordered', 'Column'], ['#many', 'Frame'], ['#title', 'Heading']]),
   `2.13.2 describeNode 给的名字：${named.map(([s, n]) => `${s}=${n}`).join(' ')}`)
ok((await rowOf('#alpha', all1))?.preview === null,
   '2.13.2 没有直接文字的容器行不渲染预览段')

// ══════════════════════════════════════════════════════════════
// 2.13.7 跟随选中：只展开那一条路径
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.7 跟随选中')
const openIds = all1.filter(r => r.open).map(r => r.id)
const pathIds = await Promise.all(['#stage', '#alpha'].map(idOf))
ok(openIds.length === 2 && pathIds.every(id => openIds.includes(id)),
   `2.13.7 setTarget 只展开到选中项那条路径（展开 ${openIds.length} 个：#stage/#alpha）`)
ok(all1.filter(r => r.selected).length === 1 && (await rowOf('#a1', all1))?.selected,
   '2.13.7 选中项那一行带 data-selected，且只有一行')
ok((await rowOf('#gamma', all1))?.open === false,
   '2.13.7 不在路径上的容器（#gamma）保持折叠')

// ══════════════════════════════════════════════════════════════
// 2.13.4 折叠箭头：展开 / 收起，且不触发选中
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.4 折叠箭头')
const before4 = await rowCount()
await clickTwist('#alpha')
const afterFold = await rowCount()
ok(afterFold === before4 - 3, `2.13.4 点箭头收起该行（${before4} → ${afterFold} 行，少了 a1/a2/a3）`)
ok(await selectedId() === 'a1', '2.13.4 折叠不触发选中——箭头和选中是两件事（页面仍选中 #a1）')

await clickTwist('#alpha')
ok(await rowCount() === before4, `2.13.4 再点一次展开回来（${await rowCount()} 行）`)

// 树是复用的同一个实例：在两个 tab 之间来回切，手动展开的分支不该被冲掉。
// 用 #gamma——它不在当前选中项（#a1）的路径上，不会被 setTarget 顺手展开
await clickTwist('#gamma')
const rowsWithGamma = await rowCount()
await page.evaluate(() => {
  document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').__probe = 'same-instance'
})
await page.locator('visual-revise-panel .tab[data-tab="props"]').click()
await page.waitForTimeout(350)
await openStructure()
const kept = await page.evaluate(() => document.querySelector('visual-revise-panel')
  .shadowRoot.querySelector('visual-revise-tree').__probe)
ok(kept === 'same-instance' && (await rowOf('#gamma'))?.open === true && await rowCount() === rowsWithGamma,
   `2.13.4 切到属性 tab 再切回来：还是同一个树实例，手动展开的 #gamma 原样保留（${await rowCount()} 行）`)
await clickTwist('#gamma')          // 收回去，2.13.12 要它是折叠的

const leafRow = await rowOf('#a2')
ok(leafRow?.leaf === true, '2.13.4 叶子节点的箭头带 data-leaf')
const beforeLeaf = await rowCount()
await clickTwist('#a2')
ok(await rowCount() === beforeLeaf && await selectedId() === 'a1',
   '2.13.4 点叶子的箭头：既不展开也不选中（行数与选中都没变）')

// ══════════════════════════════════════════════════════════════
// 2.13.5 点一行 = 选中页面元素 + 滚到视口中央
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.5 点行选中')
await clickTwist('#beta')        // 先展开 #beta，它的孩子才有行可点
ok((await rowOf('#b2')) !== null, '2.13.5 前置：展开 #beta 后 #b2 有了自己的一行')
await clickRow('#b2')
ok(await selectedId() === 'b2', `2.13.5 点树里的行，页面上就选中对应元素（${await selectedId()}）`)
ok((await rowOf('#b2'))?.selected === true, '2.13.5 选中回流到树：该行变成 data-selected')

await store(() => window.scrollTo(0, 0))
await page.waitForTimeout(200)
await clickRow('#bottom')
await page.waitForTimeout(700)   // scrollIntoView({behavior:'smooth'})
const centered = await page.evaluate(() => {
  const r = document.getElementById('bottom').getBoundingClientRect()
  return { y: scrollY, mid: r.top + r.height / 2, half: innerHeight / 2 }
})
ok(await selectedId() === 'bottom' && centered.y > 100 && Math.abs(centered.mid - centered.half) < 120,
   `2.13.5 并把它 scrollIntoView 到视口中央（scrollY=${Math.round(centered.y)}，行中心 ${Math.round(centered.mid)} vs 视口中线 ${centered.half}）`)
await store(() => window.scrollTo(0, 0))
await page.waitForTimeout(250)

// ══════════════════════════════════════════════════════════════
// 2.13.6 hover 一行 → 页面上高亮该元素
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.6 hover 高亮')
const hoverBox = await boxes('#b1', '#b1')
await page.mouse.move(hoverBox.a.left + 60, hoverBox.a.top + hoverBox.a.h / 2)
await page.waitForTimeout(250)
const hi = await page.evaluate(() => {
  const o = document.getElementById('visual-revise-locate-overlay')
  const r = document.getElementById('b1').getBoundingClientRect()
  return {
    display: o ? getComputedStyle(o).display : 'missing',
    top: o ? parseFloat(o.style.top) : NaN,
    width: o ? parseFloat(o.style.width) : NaN,
    want: { top: r.top + scrollY, width: r.width },
  }
})
ok(hi.display === 'block' && Math.abs(hi.top - hi.want.top) < 2 && Math.abs(hi.width - hi.want.width) < 2,
   `2.13.6 hover 行 → 页面上那个元素被描边（overlay top=${Math.round(hi.top)} 对上 #b1 的 ${Math.round(hi.want.top)}）`)

// 移到另一行：同一个覆盖层跟着换目标，而不是多画一个框
const hoverBox2 = await boxes('#b3', '#b3')
await page.mouse.move(hoverBox2.a.left + 60, hoverBox2.a.top + hoverBox2.a.h / 2)
await page.waitForTimeout(250)
const hi2 = await page.evaluate(() => {
  const o = document.getElementById('visual-revise-locate-overlay')
  const r = document.getElementById('b3').getBoundingClientRect()
  return {
    count: document.querySelectorAll('#visual-revise-locate-overlay').length,
    top: parseFloat(o.style.top),
    want: r.top + scrollY,
  }
})
ok(hi2.count === 1 && Math.abs(hi2.top - hi2.want) < 2,
   `2.13.6 换一行 hover，同一个覆盖层挪到新元素上（top ${Math.round(hi2.top)} 对上 #b3 的 ${Math.round(hi2.want)}，全页只有 1 个覆盖层）`)

await page.mouse.move(500, 500)
await page.waitForTimeout(250)
ok(await page.evaluate(() => getComputedStyle(
  document.getElementById('visual-revise-locate-overlay')).display) === 'none',
   '2.13.6 指针离开树 → 高亮清掉')

// ══════════════════════════════════════════════════════════════
// 2.13.3 单容器超过 200 个子节点折叠成「还有 N 个未列出」
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.3 兄弟上限 200')
await clickTwist('#many')
await page.waitForTimeout(400)
const many = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  const ids = new Set([...sr.querySelectorAll('.row')].map(r => r.dataset.id))
  const kids = [...document.getElementById('many').children]
  const more = sr.querySelector('.more')
  return {
    total: kids.length,
    shown: kids.filter(k => ids.has(k.__visualReviseId)).length,
    first: ids.has(kids[0].__visualReviseId),
    at199: ids.has(kids[199].__visualReviseId),
    at200: ids.has(kids[200].__visualReviseId),
    moreText: more?.textContent.trim() ?? '',
    moreDepth: more?.style.getPropertyValue('--depth') ?? '',
  }
})
ok(many.total === 250 && many.shown === 200 && many.first && many.at199 && !many.at200,
   `2.13.3 250 个兄弟只铺前 200 个（实际铺出 ${many.shown}，第 201 个没进树）`)
ok(many.moreText === '还有 50 个未列出' && many.moreDepth === '1',
   `2.13.3 剩下的折叠成一行提示：「${many.moreText}」（depth=${many.moreDepth}）`)

// ══════════════════════════════════════════════════════════════
// 2.13.17 树内滚轮不穿透 / 树内 keydown 不外泄
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.17 滚轮与按键不外泄')
await store(() => { window.scrollTo(0, 0) })
await page.evaluate(() => {
  const list = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot.querySelector('.list')
  list.scrollTop = 0
})
const listBox = await page.evaluate(() => {
  const list = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot.querySelector('.list')
  const r = list.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2,
           scrollable: list.scrollHeight > list.clientHeight }
})
ok(listBox.scrollable, '2.13.17 前置：展开 #many 后树本身是可滚的')
await page.mouse.move(listBox.x, listBox.y)
await page.mouse.wheel(0, 300)
await page.waitForTimeout(300)
const wheeled = await page.evaluate(() => ({
  list: document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot.querySelector('.list').scrollTop,
  page: scrollY,
}))
ok(wheeled.list > 100 && wheeled.page === 0,
   `2.13.17 树内滚轮只滚树，不穿透到页面（list.scrollTop=${Math.round(wheeled.list)}，scrollY=${wheeled.page}）`)

await page.evaluate(() => {
  window.__leak = []
  document.addEventListener('keydown', e => window.__leak.push(e.key))   // 冒泡阶段
})
await page.keyboard.press('k')
await page.waitForTimeout(120)
const baseline = await page.evaluate(() => window.__leak.slice())
await page.locator(`${TREE} .row .twist`).first().focus()
await page.evaluate(() => { window.__leak = [] })
await page.keyboard.press('k')
await page.waitForTimeout(150)
const leaked = await page.evaluate(() => window.__leak.slice())
ok(baseline.includes('k') && leaked.length === 0,
   `2.13.17 焦点在树里时 keydown 不冒泡出去（页面上按 k 收到 ${baseline.length} 次，树内按 k 收到 ${leaked.length} 次）`)

await clickTwist('#many')   // 收起，后面的拖拽用短列表
await page.waitForTimeout(300)

// ══════════════════════════════════════════════════════════════
// 2.13.7（续）跟随选中会把那一行滚进可视区
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.7 跟随选中自动滚动')
await clickTwist('#many')                       // 再展开，制造长列表
await page.evaluate(() => {
  const list = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot.querySelector('.list')
  list.scrollTop = 0
})
await page.waitForTimeout(200)
await selectPage('#bottom')
await page.waitForTimeout(400)
const reveal = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  const list = sr.querySelector('.list')
  const row = sr.querySelector('.row[data-selected]')
  if (!row) return null
  const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect()
  return { scrollTop: list.scrollTop, inView: rr.top >= lr.top - 1 && rr.bottom <= lr.bottom + 1 }
})
ok(reveal && reveal.scrollTop > 100 && reveal.inView,
   `2.13.7 选中远处的元素，树自动滚到那一行（scrollTop=${Math.round(reveal?.scrollTop ?? -1)}，行在可视区内=${reveal?.inView}）`)
await clickTwist('#many')
await page.waitForTimeout(300)

// ══════════════════════════════════════════════════════════════
// 2.13.8 拖行移动：4px slop / 谁可拖
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.8 拖拽阈值')
await selectPage('#a1')
await openStructure()
const slopBox = await boxes('#a3', '#b1')
const kidsBefore = await kidsOf('alpha')
await page.mouse.move(slopBox.a.left + 60, slopBox.a.top + slopBox.a.h / 2)
await page.mouse.down()
await page.mouse.move(slopBox.a.left + 60, slopBox.a.top + slopBox.a.h / 2 + 3, { steps: 2 })
await page.waitForTimeout(120)
const underSlop = await dropState()
await page.mouse.up()
await page.waitForTimeout(400)
ok(underSlop.dragging === false && await kidsOf('alpha') === kidsBefore,
   '2.13.8 抖动 3px（< 4px）不算拖拽：list 没有 data-dragging，DOM 没动')
ok(await selectedId() === 'a3',
   '2.13.8 而且「点一下选中」照常生效——指针捕获推迟到越过阈值之后')

const overSlop = await (async () => {
  let seen = null
  await page.mouse.move(slopBox.a.left + 60, slopBox.a.top + slopBox.a.h / 2)
  await page.mouse.down()
  await page.mouse.move(slopBox.a.left + 60, slopBox.a.top + slopBox.a.h / 2 + 10, { steps: 3 })
  await page.waitForTimeout(120)
  seen = await dropState()
  await page.mouse.move(slopBox.a.left + 60, 5, { steps: 6 })   // 移出所有行 → 没有落点
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForTimeout(350)
  return seen
})()
ok(overSlop.dragging === true, '2.13.8 越过 4px 才真正进入拖拽（list 上出现 data-dragging）')
ok(await kidsOf('alpha') === kidsBefore && (await dropState()).dragging === false,
   '2.13.8 松手时没有落点就什么都不做，拖拽态也收干净')

const bodyKid = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  const ids = new Set([...sr.querySelectorAll('.row')].map(r => r.dataset.id))
  return { bodyInTree: ids.has(document.body.__visualReviseId),
           bodyParentIsHtml: document.body.parentElement === document.documentElement }
})
ok(bodyKid.bodyParentIsHtml && !bodyKid.bodyInTree,
   '2.13.8 唯一不可拖的节点（<body>，父级是 <html>）压根不在树里——树里每一行都可拖')

// ══════════════════════════════════════════════════════════════
// 2.13.9 / 2.13.11 / 2.13.16 三档落点、视觉反馈、移动后的 toast
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.9 三档落点')
// before：上 1/3
let mid = null
await dragRow('#a1', '#b1', 'before', async () => { mid = await dropState('#b1') })
ok(await kidsOf('beta') === 'a1,b1,b2,b3',
   `2.13.9 拖到目标行上 1/3 → 插到它前面（#beta = ${await kidsOf('beta')}）`)
ok(mid && mid.lineHidden === false && mid.insideId === null
   && Math.abs(mid.lineTop - mid.want.top) < 1.5,
   `2.13.11 before 落点画一条蓝色 drop-line，正好压在目标行的上边缘（line.top=${mid?.lineTop} vs 行上沿 ${mid?.want?.top}），且不给行加 data-drop-inside`)
ok((await hostToast()).includes('已移动到 Section 里'),
   `2.13.16 移动成功后宿主 toast「${await hostToast()}」`)
ok((await panelToast()) === '',
   '2.13.15 目标容器没有用 CSS order 时不弹那条提示（面板 toast 是空的）')
await resetStore()
ok(await kidsOf('beta') === 'b1,b2,b3' && await kidsOf('alpha') === 'a1,a2,a3',
   '2.13.9 前置：撤销后固件复原')

// after：下 1/3
await dragRow('#a1', '#b1', 'after', async () => { mid = await dropState('#b1') })
ok(await kidsOf('beta') === 'b1,a1,b2,b3',
   `2.13.9 拖到目标行下 1/3 → 插到它后面（#beta = ${await kidsOf('beta')}）`)
ok(mid && mid.lineHidden === false && Math.abs(mid.lineTop - mid.want.bottom) < 1.5,
   `2.13.11 after 落点那条线压在目标行的下边缘（line.top=${mid?.lineTop} vs 行下沿 ${mid?.want?.bottom}）`)
await resetStore()

// inside：中段（目标有子节点）
await dragRow('#a1', '#beta', 'inside', async () => { mid = await dropState() })
ok(await kidsOf('beta') === 'b1,b2,b3,a1',
   `2.13.9 拖到容器行中段 → 放进它里面、排在末尾（#beta = ${await kidsOf('beta')}）`)
const betaId = await idOf('#beta')
ok(mid && mid.lineHidden === true && mid.insideId === betaId,
   '2.13.11 inside 落点不画线，改成给目标行加 data-drop-inside')
ok((await hostToast()).includes('已移动到 Section 里'), '2.13.16 inside 落点同样报出容器名')
await resetStore()

// inside：中段（目标没有子节点，但 display:block 也算容器）
await dragRow('#a1', '#emptybox', 'inside')
ok(await kidsOf('emptybox') === 'a1',
   `2.13.9 空的 block 容器同样吃中段落点（#emptybox = ${await kidsOf('emptybox')}）`)
await resetStore()

// 中段落点对「非容器」不成立：inline 且无子节点 → 退化成 before/after
const beforeSp = await kidsOf('stage')
await dragRow('#a1', '#sp', 'inside')
const spNext = await page.evaluate(() => document.getElementById('sp').nextElementSibling?.id ?? '')
ok(await kidsOf('sp') === '' && spNext === 'a1',
   `2.13.9 中段落在非容器（inline span）上时退化为「插到它后面」（#sp 的后邻 = ${spNext}，它自己仍然没有子节点）`)
await resetStore()
ok(await kidsOf('stage') === beforeSp, '2.13.9 前置：撤销后 #stage 的孩子复原')

// ══════════════════════════════════════════════════════════════
// 2.13.10 不能拖进自己 / 自己的后代
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.10 自环保护')
const movesBase = await store(() => window.__visualRevise.store.stats().moves)
let selfMid = null
await dragRow('#alpha', '#a2', 'inside', async () => { selfMid = await dropState() })
ok(await kidsOf('alpha') === 'a1,a2,a3' && await kidsOf('stage') === beforeSp,
   '2.13.10 把容器拖到自己的后代行上：DOM 一动不动')
ok(selfMid && selfMid.lineHidden === true && selfMid.insideId === null,
   '2.13.10 而且拖拽过程中根本不给出落点指示（线藏着、没有 data-drop-inside）')

await dragRow('#a1', '#a1', 'inside')
ok(await kidsOf('alpha') === 'a1,a2,a3', '2.13.10 拖到自己那一行上也无效')
ok((await store(() => window.__visualRevise.store.stats().moves)) === movesBase,
   `2.13.10 无效拖拽不会在改动记录里留下 move（moves 仍是 ${movesBase}）`)

// 反面：顶层行的 before/after 落在 body 里，不会被「不能拖到 <html> 下」误伤
await dragRow('#a1', '#bottom', 'before')
ok(await page.evaluate(() => document.getElementById('a1').parentElement === document.body),
   '2.13.10 拖到顶层行前面 → 落进 <body>（不是被 <html> 那条护栏挡掉）')
await resetStore()

// ══════════════════════════════════════════════════════════════
// 2.13.12 放进折叠着的容器会自动展开它
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.12 落进折叠容器自动展开')
ok((await rowOf('#gamma'))?.open === false, '2.13.12 前置：#gamma 此刻是折叠的')
await dragRow('#a1', '#gamma', 'inside')
const gammaRow = await rowOf('#gamma')
const g1Row = await rowOf('#g1')
ok(await kidsOf('gamma') === 'g1,g2,a1', `2.13.12 元素放进了 #gamma（${await kidsOf('gamma')}）`)
ok(gammaRow?.open === true && g1Row !== null,
   '2.13.12 落进折叠着的容器后它自动展开，孩子们出现在树里')
await resetStore()

// ══════════════════════════════════════════════════════════════
// 2.13.13 / 2.13.15 后邻按 orderedChildren 取 + CSS order 提示
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.13 CSS order 容器里的后邻')
await selectPage('#o-b')
await openStructure()
const visualOrder = await page.evaluate(() =>
  window.__visualRevise.lib.orderedChildren(document.getElementById('ordered')).map(n => n.id).join(','))
ok(visualOrder === 'o-c,o-b,o-a' && await kidsOf('ordered') === 'o-a,o-b,o-c',
   `2.13.13 前置：DOM 顺序 ${await kidsOf('ordered')}，视觉顺序 ${visualOrder}`)

await dragRow('#b1', '#o-b', 'after')
ok(await kidsOf('ordered') === 'b1,o-a,o-b,o-c',
   `2.13.13 「插到视觉上的 O-B 之后」= 插到 orderedChildren 的下一个（O-A）之前，DOM 变成 ${await kidsOf('ordered')}；用 nextElementSibling 会落成 o-a,o-b,b1,o-c`)
ok((await panelToast()).includes('CSS order'),
   `2.13.15 目标容器用了 CSS order 时给出提示：「${await panelToast()}」`)
ok((await hostToast()).includes('已移动到 Column 里'),
   `2.13.16 容器名按 describeNode 算（flex+column → Column）：「${await hostToast()}」`)
await resetStore()

// ══════════════════════════════════════════════════════════════
// 2.13.14 树只上报意图，写入在面板：共享联动的边界
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.14 共享联动')
const dups = () => page.evaluate(() => [...document.querySelectorAll('#dupwrap .dup')]
  .map(d => [...d.children].map(n => n.textContent).join(',')).join(' / '))

await selectPage('#dup1 .di:nth-child(1)')
await page.locator('visual-revise-panel .shared').click()
await page.waitForTimeout(350)
const sharedOn = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('.shared').hasAttribute('data-on'))
ok(sharedOn, '2.13.14 前置：共享元素开关已打开')
await openStructure()

await dragRow('#dup1 .di:nth-child(1)', '#dup1 .di:nth-child(2)', 'after')
ok(await dups() === 'X2,X1 / Y2,Y1',
   `2.13.14 共享开着 + 同父换位 → 按下标映射到同构容器一起换（${await dups()}）`)
await resetStore()
ok(await dups() === 'X1,X2 / Y1,Y2', '2.13.14 前置：撤销后两个副本都复原')

await dragRow('#dup1 .di:nth-child(1)', '#dup2', 'inside')
ok(await dups() === 'X2 / Y1,Y2,X1',
   `2.13.14 跨容器时只作用于当前元素，另一个副本不动（${await dups()}）`)
ok((await panelToast()).includes('跨容器移动只作用于当前元素'),
   `2.13.14 并明说一句：「${await panelToast()}」`)
ok((await store(() => window.__visualRevise.store.stats().moves)) === 1,
   '2.13.14 跨容器移动只在改动记录里记 1 条 move')
await resetStore()
await page.locator('visual-revise-panel .shared').click()   // 关掉共享
await page.waitForTimeout(300)

// ══════════════════════════════════════════════════════════════
// 2.13.18 ChangeStore 变化时树重画
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.18 store 变化 → 树重画')
await selectPage('#b3')
await openStructure()
ok((await rowOf('#b3')) !== null, '2.13.18 前置：#b3 在树里')
const rowsBefore18 = await rowCount()
await page.keyboard.press('Delete')
await page.waitForTimeout(500)
const after18 = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  return {
    rows: sr.querySelectorAll('.row').length,
    hasB3: [...sr.querySelectorAll('.row .preview')].some(p => p.textContent === 'B3'),
    inPage: !!document.getElementById('b3'),
    removals: window.__visualRevise.store.stats().removals,
  }
})
ok(!after18.inPage && after18.removals === 1 && !after18.hasB3 && after18.rows === rowsBefore18 - 1,
   `2.13.18 删掉一个元素（store 变化）后树立刻少了那一行（${rowsBefore18} → ${after18.rows}）`)

await page.locator('visual-revise-toolbar .undo').click()
await page.waitForTimeout(600)
const b3BackRow = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  return [...sr.querySelectorAll('.row .preview')].some(p => p.textContent === 'B3')
})
ok(await page.evaluate(() => !!document.getElementById('b3')) && b3BackRow,
   '2.13.18 撤销（store 再次变化）后那一行又回到树里')
await resetStore()

// ══════════════════════════════════════════════════════════════
// 2.13.19 深层嵌套不撑爆面板
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.19 深层嵌套')
await selectPage('#deep .tip')
await openStructure()
const deep = await page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  const sr = p.shadowRoot
  const tsr = sr.querySelector('visual-revise-tree').shadowRoot
  const list = tsr.querySelector('.list')
  const rows = [...tsr.querySelectorAll('.row')]
  const head = sr.querySelector('header').getBoundingClientRect()
  const tabs = sr.querySelector('.tabs').getBoundingClientRect()
  const pr = p.getBoundingClientRect()
  return {
    width: Math.round(pr.width),
    maxDepth: Math.max(...rows.map(r => +r.style.getPropertyValue('--depth'))),
    overflowX: getComputedStyle(list).overflowX,
    hScroll: list.scrollWidth > list.clientWidth,
    vScroll: list.scrollHeight > list.clientHeight,
    headVisible: head.top >= 0 && head.bottom <= innerHeight,
    tabsVisible: tabs.top >= 0 && tabs.bottom <= innerHeight,
    inViewport: pr.right <= innerWidth + 1,
  }
})
ok(deep.maxDepth >= 20, `2.13.19 前置：树已展开到第 ${deep.maxDepth} 层`)
ok(deep.width === 300 && deep.inViewport && deep.headVisible && deep.tabsVisible,
   `2.13.19 深层缩进下面板宽度仍是 300、标题栏与 tab 没被挤出去（实得 ${deep.width}）`)
ok(deep.overflowX === 'auto' && deep.hScroll && deep.vScroll,
   `2.13.19 缩进不压扁，改成让树横向 + 纵向滚（overflow-x=${deep.overflowX}，横向溢出=${deep.hScroll}）`)

// ══════════════════════════════════════════════════════════════
// 2.13.1 树头：标题 / 提示 / 关闭 ×
// ══════════════════════════════════════════════════════════════
console.log('── 2.13.1 树头')
const head = await page.evaluate(() => {
  const t = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree')
  const sr = t.shadowRoot
  return {
    title: sr.querySelector('.tree-head .title')?.textContent ?? '',
    hint: sr.querySelector('.tree-head .hint')?.textContent ?? '',
    closeBtns: sr.querySelectorAll('.tree-head .tree-close').length,
    embedded: t.hasAttribute('embedded'),
    display: getComputedStyle(sr.querySelector('.tree-head')).display,
  }
})
ok(head.title === '结构' && head.hint === '拖动行可移动',
   `2.13.1 树头 = 「${head.title}」+ 提示「${head.hint}」`)
// 原断言锁的是「树头有个 title=关闭 的 ×」。那个 × 只派发 vr-tree-close，
// 全仓零监听，点了什么都不会发生；关闭这块 UI 归属性面板标题栏的 ×（宿主监听 vr-close）。
// 按钮与事件已一并删除，断言随之改成「不该有这个控件」。
ok(head.closeBtns === 0,
   `2.13.1 树头不再挂那个没人接的关闭 ×（实得 ${head.closeBtns} 个）`)
ok(head.embedded && head.display === 'none',
   '2.13.1 内嵌进属性面板时整个树头藏起来（标题与关闭交给面板的标题栏）')

// 树头只有在独立浮层形态下才看得见——以前那个死按钮就摆在这里。
// 造一棵独立的树，验证这个形态下树头照样可见、却已经没有关闭钮，
// 也不会再派发那个无人接收的事件。
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
await page.evaluate(() => {
  window.__treeClose = 0
  const t = document.createElement('visual-revise-tree')
  t.id = 'solo-tree'
  t.addEventListener('vr-tree-close', () => window.__treeClose++)
  document.body.appendChild(t)
})
await page.waitForTimeout(300)
const solo = await page.evaluate(() => {
  const t = document.getElementById('solo-tree')
  const sr = t.shadowRoot
  return {
    headDisplay: getComputedStyle(sr.querySelector('.tree-head')).display,
    closeBtns: sr.querySelectorAll('.tree-close').length,
    fired: window.__treeClose,
  }
})
ok(solo.headDisplay !== 'none' && solo.closeBtns === 0,
   `2.13.1 独立浮层形态下树头可见（display=${solo.headDisplay}）但没有关闭钮（${solo.closeBtns} 个）`)
ok(solo.fired === 0, `2.13.1 不再派发无人监听的 vr-tree-close（${solo.fired} 次）`)
await page.evaluate(() => document.getElementById('solo-tree')?.remove())

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
