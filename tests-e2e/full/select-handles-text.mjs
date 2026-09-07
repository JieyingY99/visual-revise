// 全量 e2e · 分块「选择元素 / 缩放把手 / 文字编辑」
// 覆盖 docs/plans/feature-inventory.md 的 §4.1（4.1.1–4.1.19）、§4.2（4.2.1–4.2.4）、§4.3（4.3.1–4.3.8）。
//
// 全部走真实指针 / 键盘：page.mouse + page.keyboard，不用 element.click()。
// 断言落在元素的 inline style / DOM 结构 / window.__visualRevise.store 的改动记录上。
//
// 两条环境笔记（都验证过，不是猜的）：
//   1) 选中后 <visbug-handles> 是 top-layer popover，8 个把手的点击热区（button + ::before）
//      向元素外扩 12px。Playwright 的 locator.click() 会判定「被覆盖层拦截」而超时，
//      所以页面元素一律用 page.mouse.click(x, y) 点在**元素中心**（离把手最远）。
//   2) <visbug-handles> / <visbug-handle> 的 shadow root 都是 closed，
//      Playwright 选择器进不去；把手只能按几何位置（元素外接框的 4 角 + 4 边中点）真实按下去。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))

// 元素级剪贴板（⌘C/⌘X/⌘V）要读写 navigator.clipboard
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })

console.log('\n[全量 e2e] §4.1 选择元素 / §4.2 缩放把手 / §4.3 文字编辑\n')
await page.goto(`${origin}/full/fixtures/select-handles-text-page.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

// ── 工具 ────────────────────────────────────────────────────
const sel = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(e => e.id || e.tagName.toLowerCase()))
const selCount = async () => (await sel()).length
const stats = () => page.evaluate(() => window.__visualRevise.store.stats())
const edits = () => page.evaluate(() => window.__visualRevise.store.read().edits.map(e => ({
  id: e.el?.id || '', tag: e.anchors?.tag, orphaned: !!e.orphaned,
  props: (e.changes || []).map(c => c.prop), text: e.text,
})))
const canUndo = () => page.evaluate(() => window.__visualRevise.store.canUndo)
const mode = () => page.evaluate(() => window.__visualRevise.mode)
const tool = () => page.evaluate(() => {
  const vb = document.querySelector('vis-bug')
  return vb.activeTool?.dataset?.tool ?? vb.activeTool ?? '?'
})
const toastText = () => page.evaluate(() =>
  document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector('.toast')?.textContent || '')
const inlineOf = id => page.evaluate(i => {
  const e = document.getElementById(i)
  return e ? { w: e.style.width, h: e.style.height, tr: e.style.translate, all: e.getAttribute('style') } : null
}, id)

const R = id => page.evaluate(i => {
  const b = document.getElementById(i).getBoundingClientRect()
  return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height,
           cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
}, id)

// 真实点击：按下 / 抬起都带上当前按住的修饰键
const clickAt = async (x, y, mods = []) => {
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.click(Math.round(x), Math.round(y))
  for (const m of mods) await page.keyboard.up(m)
  await page.waitForTimeout(320)
}
// 点元素中心：把手热区在四边外扩 12px，中心是唯一一定不会被它们抢走的位置
const pick = async (id, mods = []) => { const r = await R(id); await clickAt(r.cx, r.cy, mods) }
// 点容器自身：中心多半落在某个子项上，改点容器下半部那条空白带
const pickIn = async (id, fx, fy, mods = []) => {
  const r = await R(id)
  await clickAt(r.l + r.w * fx, r.t + r.h * fy, mods)
}
const clearSel = async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  if (await selCount()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200) }
}
// 测试脚手架：把记录与历史栈清干净，让下一段的断言只反映这一段的操作
const resetStore = () => page.evaluate(() => {
  window.__visualRevise.store.clear()
  window.__visualRevise.store.history.clear()
})

// ════════════════════════════════════════════════════════════
console.log('── §4.1 选择元素')

// 4.1.1 单击选中：选中框 + 8 个把手
await pick('solo')
const one = await page.evaluate(() => {
  const el = document.getElementById('solo')
  const h = document.querySelector('visbug-handles')
  return {
    selected: el.getAttribute('data-selected'),
    labelId: el.getAttribute('data-label-id'),
    handles: !!h,
    handlesId: h?.getAttribute('data-label-id'),
    label: !!document.querySelector('visbug-label'),
  }
})
ok(one.selected === 'true' && one.labelId !== null && await selCount() === 1,
   `4.1.1 单击页面元素选中它（data-selected=${one.selected} / label-id=${one.labelId}）`)
ok(one.handles && one.handlesId === one.labelId,
   `4.1.1 画出选中框 <visbug-handles>，data-label-id 与元素对上（${one.handlesId}）`)
// 8 个把手：按几何位置逐个命中测试（closed shadow 进不去，只能验热区）
const hotspots = await page.evaluate(() => {
  const b = document.getElementById('solo').getBoundingClientRect()
  const P = {
    'top-start': [b.left, b.top], 'top-center': [b.left + b.width / 2, b.top], 'top-end': [b.right, b.top],
    'middle-start': [b.left, b.top + b.height / 2], 'middle-end': [b.right, b.top + b.height / 2],
    'bottom-start': [b.left, b.bottom], 'bottom-center': [b.left + b.width / 2, b.bottom], 'bottom-end': [b.right, b.bottom],
  }
  const out = {}
  for (const [k, [x, y]] of Object.entries(P))
    out[k] = (document.elementFromPoint(Math.round(x), Math.round(y)) || {}).tagName
  return out
})
ok(Object.values(hotspots).filter(t => t === 'VISBUG-HANDLES').length === 8,
   `4.1.1 选中框四角 + 四边中点共 8 个把手热区都命中（${Object.values(hotspots).filter(t => t === 'VISBUG-HANDLES').length}/8）`)

// 4.1.2 Shift 加选 / 再 Shift 取消
await clearSel(); await pick('a')
await pick('c', ['Shift'])
const two = await sel()
ok(two.length === 2 && two.includes('a') && two.includes('c'),
   `4.1.2 Shift+单击加选（${two.join(' + ')}）`)
await pick('c', ['Shift'])
const back = await sel()
ok(back.length === 1 && back[0] === 'a',
   `4.1.2 再 Shift+单击已选中的元素则取消它（剩 ${back.join(',') || '空'}）`)

// 4.1.3 hover 画悬停框，不影响已选中项
const errsBeforeHover = pageErrors.length
const rc = await R('c')
await page.mouse.move(Math.round(rc.cx), Math.round(rc.cy))
await page.waitForTimeout(300)
// 上面刚做过一次「Shift 点掉已选中项」，hover 必须仍然干净地跑完
const hoverErrs = pageErrors.slice(errsBeforeHover)
ok(hoverErrs.length === 0,
   `4.1.3 hover 过程中不抛异常（${hoverErrs.length ? hoverErrs.join(' / ') : '无'}）`)
const hov = await page.evaluate(() => ({
  hover: !!document.querySelector('visbug-hover'),
  pseudo: !!document.querySelector('[data-pseudo-select]'),
  sel: document.querySelectorAll('[data-selected]').length,
}))
ok(hov.hover, `4.1.3 hover 页面元素画出悬停框 <visbug-hover>（${JSON.stringify(hov)}）`)
ok(hov.sel === 1, `4.1.3 hover 不影响已选中项（仍是 ${hov.sel} 个）`)

// 4.1.4 点插件自身 UI 不会被选中
const beforeUI = await selCount()
await page.locator('visual-revise-toolbar .redo').click({ force: true })
await page.waitForTimeout(300)
const uiSel = await page.evaluate(() => ({
  onUI: !!document.querySelector('visual-revise-toolbar[data-selected], visual-revise-panel[data-selected], vis-bug[data-selected]'),
  n: document.querySelectorAll('[data-selected]').length,
}))
ok(!uiSel.onUI && uiSel.n === beforeUI,
   `4.1.4 点插件自己的 UI 不会被选中，也不清掉已有选中（插件 UI 被选=${uiSel.onUI}，选中数 ${beforeUI}→${uiSel.n}）`)

// 4.1.5 / 4.1.6 / 4.1.7 层级导航
await clearSel(); await pickIn('list', 0.5, 0.85)
ok((await sel())[0] === 'list', `4.1.5 前置：先选中容器 #list（实得 ${(await sel()).join(',')}）`)
await page.keyboard.press('Enter'); await page.waitForTimeout(280)
const down = await sel()
ok(down.length === 1 && down[0] === 'a', `4.1.5 Enter 下钻到第一个子元素（${down.join(',')}）`)
await page.keyboard.press('Shift+Enter'); await page.waitForTimeout(280)
const up = await sel()
ok(up.length === 1 && up[0] === 'list', `4.1.6 Shift+Enter 上浮回父元素（${up.join(',')}）`)

await clearSel(); await pick('a')
await page.keyboard.press("Shift+'"); await page.waitForTimeout(280)
const outward = await sel()
ok(outward.length === 2 && outward.includes('list') && outward.includes('a'),
   `4.1.7 Shift+' 把父元素加进选中集，子级仍保留（${outward.join(' + ')}）`)

// 4.1.8 ⌘⇧Enter 选中全部直接子元素
await clearSel(); await pickIn('list', 0.5, 0.85)
await page.keyboard.press('Meta+Shift+Enter'); await page.waitForTimeout(300)
const kids = await sel()
ok(kids.length === 4 && ['a', 'b', 'c', 'd'].every(k => kids.includes(k)),
   `4.1.8 ⌘⇧Enter 选中全部 4 个直接子元素（${kids.sort().join(',')}）`)

// 4.1.9 ⌘E 加选下一个同类 / ⌘⇧E 全选同类
await clearSel(); await pick('a')
await page.keyboard.press('Meta+e'); await page.waitForTimeout(300)
const e1 = await sel()
await page.keyboard.press('Meta+Shift+e'); await page.waitForTimeout(300)
const e2 = await sel()
ok(e1.length === 2 && e1.includes('a'), `4.1.9 ⌘E 加选下一个同类（${e1.sort().join(',')}）`)
ok(e2.length === 4, `4.1.9 ⌘⇧E 一次全选同类（${e2.length}/4：${e2.sort().join(',')}）`)

// 4.1.10 ⌘D 原地深拷贝并插在其后
await clearSel(); await pick('b')
const dupBefore = await page.evaluate(() => document.querySelectorAll('#list > .item').length)
await page.keyboard.press('Meta+d'); await page.waitForTimeout(350)
const dup = await page.evaluate(() => {
  const items = [...document.querySelectorAll('#list > .item')]
  const src = items[1]
  const next = src.nextElementSibling
  return {
    n: items.length,
    nextIsCopy: !!next && next.className === src.className && next.innerHTML === src.innerHTML,
    deepChild: !!next?.querySelector('.deep'),
  }
})
ok(dup.n === dupBefore + 1 && dup.nextIsCopy,
   `4.1.10 ⌘D 原地复制并插在原元素之后（${dupBefore} → ${dup.n}，紧邻的下一个就是副本）`)
ok(dup.deepChild, '4.1.10 是深拷贝：副本里带着子元素 .deep')
await page.evaluate(() => document.querySelectorAll('#list > .item')[2].remove())
await page.waitForTimeout(150)

// 4.1.11 ⌘⌥C / ⌘⌥V 复制粘贴样式（含多来源轮转）
await clearSel()
await page.evaluate(() => {
  document.getElementById('a').style.backgroundColor = 'rgb(255, 0, 255)'
  document.getElementById('b').style.backgroundColor = 'rgb(0, 255, 0)'
})
await pick('a'); await page.keyboard.press('Meta+Alt+c'); await page.waitForTimeout(300)
await clearSel(); await pick('c'); await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(400)
const pastedOne = await page.evaluate(() => getComputedStyle(document.getElementById('c')).backgroundColor)
ok(pastedOne === 'rgb(255, 0, 255)', `4.1.11 ⌘⌥C / ⌘⌥V 把来源的样式贴到目标上（#c 背景 = ${pastedOne}）`)

await clearSel(); await pick('a'); await pick('b', ['Shift'])
await page.keyboard.press('Meta+Alt+c'); await page.waitForTimeout(300)
await page.evaluate(() => {
  document.getElementById('c').style.backgroundColor = ''
  document.getElementById('d').style.backgroundColor = ''
})
await clearSel(); await pick('c'); await pick('d', ['Shift'])
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(450)
const rot = await page.evaluate(() => ({
  c: getComputedStyle(document.getElementById('c')).backgroundColor,
  d: getComputedStyle(document.getElementById('d')).backgroundColor,
}))
const SRC = ['rgb(255, 0, 255)', 'rgb(0, 255, 0)']
ok(rot.c !== rot.d && SRC.includes(rot.c) && SRC.includes(rot.d),
   `4.1.11 两个来源时轮转分配，两个目标各拿一份不同的样式（c=${rot.c} / d=${rot.d}）`)
await page.evaluate(() => ['a', 'b', 'c', 'd'].forEach(i => { document.getElementById(i).style.backgroundColor = '' }))
await resetStore()

// 4.1.12 Esc 取消全部选中
await clearSel(); await pick('a'); await pick('c', ['Shift'])
ok(await selCount() === 2, '4.1.12 前置：选中两个元素')
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
ok(await selCount() === 0, `4.1.12 Esc 取消全部选中（剩 ${await selCount()} 个）`)

// 4.1.13 ⌘G 分组 / ⌘⇧G 取消分组
await resetStore()
await pick('b')
const gOrderBefore = await page.evaluate(() =>
  [...document.getElementById('list').children].map(e => e.id))
await page.keyboard.press('Meta+g'); await page.waitForTimeout(400)
const grouped = await page.evaluate(() => {
  const b = document.getElementById('b')
  const p = b.parentElement
  return {
    wrapped: p.tagName === 'DIV' && p.id === '' && p.parentElement?.id === 'list',
    wrapperChildren: p.children.length,
    order: [...document.getElementById('list').children].map(e => e.id || '(新分组)'),
    indexOfGroup: [...document.getElementById('list').children].indexOf(p),
  }
})
ok(grouped.wrapped && grouped.wrapperChildren === 1,
   `4.1.13 ⌘G 把选中项包进一个新 <div>（包住 ${grouped.wrapperChildren} 个）`)
// 「包进一个 div」不该顺手把它搬到容器最前面：那是一次用户没要求、也看不见来源的重排
ok(grouped.indexOfGroup === gOrderBefore.indexOf('b'),
   `4.1.13 ⌘G 应把新 <div> 插在原位置（原来 #b 排第 ${gOrderBefore.indexOf('b')}，分组后排第 ${grouped.indexOfGroup}：${grouped.order.join(' ')}）`)
const gStats = await stats()
const gUndo = await canUndo()
ok(gStats.total > 0 || gUndo,
   `4.1.13 ⌘G 改了 DOM 结构，应进改动记录或至少可撤销（记录 total=${gStats.total} / canUndo=${gUndo}）`)
// 分组的本质是「造一个外壳 + 把选中项搬进去」，两件事都要记下来，
// 提示词才说得清那个 <div> 是哪儿来的
ok(gStats.inserts === 1 && gStats.moves === 1,
   `4.1.13 ⌘G 记成一条新增 + 一条移动（inserts=${gStats.inserts} moves=${gStats.moves}）`)
const gPrompt = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
ok(/## 新增的元素/.test(gPrompt) && /- 位置：/.test(gPrompt),
   `4.1.13 提示词里有「新增的元素」段并写明位置（${(gPrompt.match(/- 位置：.*/) || ['没有位置行'])[0]}）`)
// 分组是「先插一个空 <div>、再把子元素搬进去」：记录里的 HTML 若停在插入那一刻，
// 提示词让 AI 建出来的就是个空壳
const gHtml = await page.evaluate(() => window.__visualRevise.store.read().inserts[0]?.html || '')
ok(/id="b"/.test(gHtml),
   `4.1.13 新增记录里的 HTML 是搬完之后的样子，不是那个空壳（${gHtml}）`)
await page.keyboard.press('Meta+Shift+g'); await page.waitForTimeout(400)
const ungrouped = await page.evaluate(() => ({
  parent: document.getElementById('b').parentElement.id,
  wrappers: [...document.getElementById('list').children].filter(e => !e.id).length,
}))
ok(ungrouped.parent === 'list' && ungrouped.wrappers === 0,
   `4.1.13 ⌘⇧G 拆掉外壳，元素回到原容器（parent=#${ungrouped.parent}，残留的空壳 ${ungrouped.wrappers} 个）`)
// 那个外壳是本次会话自己造出来的，原页面里从来不存在。记成「删除的元素」
// 等于给 AI 下一条执行不了的指令，正确做法是把那条新增记录对消掉。
const ugStats = await stats()
ok(ugStats.removals === 0 && ugStats.inserts === 0 && ugStats.moves === 0,
   `4.1.13 ⌘⇧G 不留假记录：外壳是本次才造的，该对消而不是记一条删除`
   + `（removals=${ugStats.removals} inserts=${ugStats.inserts} moves=${ugStats.moves}）`)
await page.evaluate(() => {
  // 上游的分组把新 <div> prepend 到父级，顺序会变；后面的用例依赖 a/b/c/d 的原顺序
  const list = document.getElementById('list')
  ;['a', 'b', 'c', 'd'].forEach(id => list.appendChild(document.getElementById(id)))
})
await resetStore()

// 分组是一个动作，不是 1 + n 个：一次 ⌘Z 要整体退回
await clearSel(); await pick('b')
await page.keyboard.press('Meta+g'); await page.waitForTimeout(400)
const gLabel = await page.evaluate(() => window.__visualRevise.store.history.undoLabel)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(450)
const backOrder = await page.evaluate(() =>
  [...document.getElementById('list').children].map(e => e.id || '(新分组)'))
const backStats = await stats()
ok(gLabel === '分组' && backOrder.join(' ') === 'a b c d' && backStats.total === 0,
   `4.1.13 一次 ⌘Z（「${gLabel}」）把分组整体退回（${backOrder.join(' ')}，记录 ${backStats.total} 条）`)
await resetStore()

// 4.1.14 ⌥Delete / ⌥Backspace 清空 inline style
// (a) 页面里本来就有的元素：#form 的 style 写在标签上，再叠一条工具改的
await clearSel()
await pickIn('form', 0.95, 0.5)
ok((await sel())[0] === 'form', `4.1.14 前置：选中 #form（实得 ${(await sel()).join(',')}）`)
await page.evaluate(() => window.__visualRevise.store.applyProp(document.getElementById('form'), 'border-radius', '12px'))
await page.waitForTimeout(300)
const beforeClear = await inlineOf('form')
ok(/opacity/.test(beforeClear.all || '') && /border-radius/.test(beforeClear.all || ''),
   `4.1.14 前置：元素上既有作者写的 inline style，也有工具刚写的一条（${beforeClear.all}）`)
await page.keyboard.press('Alt+Backspace'); await page.waitForTimeout(400)
const afterClear = await inlineOf('form')
ok(!afterClear.all,
   `4.1.14 ⌥Backspace 清空 inline style 属性（现在是 ${JSON.stringify(afterClear.all)}）`)
if (!afterClear.all) {
  // 只有真的清掉了，「进不进记录 / ⌘Z 救不救得回」才有得验
  const statsAfterClear = await stats()
  ok(statsAfterClear.props > 0,
     `4.1.14 一键抹掉的这些声明要进改动记录（清空后记录里的属性数 ${statsAfterClear.props}）`)
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(450)
  const undone = await inlineOf('form')
  ok(/opacity/.test(undone.all || ''),
     `4.1.14 ⌘Z 能把被 ⌥Backspace 抹掉的 inline style 救回来（撤销后 style=${JSON.stringify(undone.all)}）`)
} else {
  console.log('     ↳ style 根本没被清掉，「进记录 / 可撤销」这两条无从验证')
}
await page.evaluate(() => document.getElementById('form').setAttribute('style', 'opacity: 0.95'))
await resetStore()

// (b) 编辑器注入之后才出现的元素（SPA 路由渲染、懒加载列表、弹窗……都是这种）。
//     这里必须动态建，不能改用固件里的静态元素：区别正在于「有没有被 blingblingjs 的
//     $() 摸过」——静态元素在注入时就被摸过，动态元素没有。
await clearSel()
await page.evaluate(() => {
  document.getElementById('styled')?.remove()
  const d = document.createElement('div')
  d.id = 'styled'
  d.setAttribute('style', 'position:absolute;left:640px;top:60px;width:200px;height:90px;background:rgb(60,60,80);opacity:0.9')
  document.body.appendChild(d)
})
await page.waitForTimeout(200)
await pick('styled')
ok((await sel())[0] === 'styled', `4.1.14 前置：选中注入后才加进页面的 #styled（实得 ${(await sel()).join(',')}）`)
const errsBefore = pageErrors.length
await page.keyboard.press('Alt+Backspace'); await page.waitForTimeout(400)
const afterDyn = await inlineOf('styled')
ok(!afterDyn.all,
   `4.1.14 对注入后才出现的元素同样要清空 inline style（现在是 ${JSON.stringify(afterDyn.all)}；期间的页面异常：${pageErrors.slice(errsBefore).join(' / ') || '无'}）`)
await page.evaluate(() => document.getElementById('styled')?.remove())
await resetStore()

// 4.1.15 ⌘C / ⌘X / ⌘V 元素级剪贴板
await clearSel(); await pick('a')
await page.keyboard.press('Meta+c'); await page.waitForTimeout(450)
const copied = await page.evaluate(() => window.copy_backup || '')
ok(/^<div[^>]*class="item"/.test(copied) && />A</.test(copied) && !/data-selected/.test(copied),
   `4.1.15 ⌘C 把选中元素的 outerHTML 存下来，且去掉 data-selected（${copied.slice(0, 60)}）`)
// data-label-id 是选择引擎的内部编号（select() 用 handles.length 现取，取消选中后从 0 重来）。
// 让它跟着 outerHTML 进剪贴板，粘出来的节点就会和之后某个选中项撞号——
// 缩放把手按 $('[data-label-id=N]')[0] 取目标（handle.element.js:41），撞号就会去改另一个元素。
ok(!/data-label-id/.test(copied),
   `4.1.15 ⌘C 存下来的 outerHTML 不该带编辑器的内部记号 data-label-id（${copied}）`)

await clearSel(); await pick('c')
await page.keyboard.press('Meta+v'); await page.waitForTimeout(700)
const pasted = await page.evaluate(() => ({
  childOfC: document.querySelectorAll('#c .item').length,
  cText: document.getElementById('c').textContent,
}))
ok(pasted.childOfC === 1,
   `4.1.15 ⌘V 把剪贴板内容粘成选中元素的子节点（#c 里多了 ${pasted.childOfC} 个 .item）`)
// 粘出来的是页面上原本没有的元素，跟删除、移动一样要入账，
// 否则导出给 AI 的提示词里完全看不到这块新内容
const pasteStats = await stats()
ok(pasteStats.inserts === 1,
   `4.1.15 ⌘V 粘进来的元素进改动记录（inserts=${pasteStats.inserts}）`)
// 粘完之后再去缩放另一个元素：把手必须作用在**当前选中**的那个上
await clearSel(); await pick('d')
const rd = await R('d')
await page.mouse.move(Math.round(rd.r), Math.round(rd.cy))
await page.mouse.down()
await page.mouse.move(Math.round(rd.r) + 50, Math.round(rd.cy), { steps: 5 })
await page.waitForTimeout(200)
await page.mouse.up(); await page.waitForTimeout(300)
const misfire = await page.evaluate(() => ({
  d: document.getElementById('d').style.width,
  clone: document.querySelector('#c .item')?.style.width || '',
  dupes: document.querySelectorAll('[data-label-id="0"]').length,
}))
ok(!!misfire.d && !misfire.clone,
   `4.1.15 粘贴之后拖选中元素的把手，改的必须是选中的那个（#d 宽=${misfire.d || '没变'}，被误改的粘贴副本宽=${misfire.clone || '没变'}，页面上 data-label-id="0" 的节点有 ${misfire.dupes} 个）`)
await page.evaluate(() => {
  document.querySelectorAll('#c .item').forEach(e => e.remove())
  document.getElementById('d').style.width = ''
})

await resetStore()
await clearSel(); await pick('d')
await page.keyboard.press('Meta+x'); await page.waitForTimeout(600)
const cut = await page.evaluate(() => ({
  gone: !document.getElementById('d'),
  backup: (window.copy_backup || '').includes('>D<'),
}))
ok(cut.gone && cut.backup, `4.1.15 ⌘X 剪切：元素离开 DOM，outerHTML 进剪贴板（${JSON.stringify(cut)}）`)
const cutStats = await stats()
const cutUndo = await canUndo()
ok(cutStats.removals === 1,
   `4.1.15 ⌘X 删掉的元素要走 ChangeStore.removeElements 进改动记录（removals=${cutStats.removals}，可撤销=${cutUndo}）`)
await page.evaluate(() => {
  if (!document.getElementById('d')) {
    const d = document.createElement('div'); d.className = 'item'; d.id = 'd'; d.textContent = 'D'
    document.getElementById('list').appendChild(d)
  }
})
await resetStore()

// 4.1.16 按住 Ctrl 临时隐藏所有选中覆盖层
await clearSel(); await pick('a')
const rb = await R('b')
await page.mouse.move(Math.round(rb.cx), Math.round(rb.cy)); await page.waitForTimeout(250)
const overlays = () => page.evaluate(() =>
  [...document.querySelectorAll('visbug-handles, visbug-label, visbug-hover, visbug-grip')]
    .map(e => `${e.tagName.toLowerCase()}:${e.style.display || '-'}`))
const ovBefore = await overlays()
await page.keyboard.down('Control'); await page.waitForTimeout(250)
const ovDuring = await overlays()
await page.keyboard.up('Control'); await page.waitForTimeout(250)
const ovAfter = await overlays()
ok(ovBefore.length > 0 && ovDuring.length === ovBefore.length && ovDuring.every(s => s.endsWith(':none')),
   `4.1.16 按住 Ctrl 隐藏全部选中覆盖层（${ovBefore.join(' ')} → ${ovDuring.join(' ')}）`)
ok(ovAfter.every(s => s.endsWith(':-')),
   `4.1.16 松开 Ctrl 覆盖层恢复（${ovAfter.join(' ')}）`)
ok((await stats()).total === 0,
   `4.1.16 隐藏覆盖层只动插件自己的 UI，不产生任何改动记录（total=${(await stats()).total}）`)

// 4.1.17 双击文字进入编辑态
await clearSel()
const rt = await R('texty')
await page.mouse.dblclick(Math.round(rt.cx), Math.round(rt.cy)); await page.waitForTimeout(500)
const dbl = await page.evaluate(() => {
  const e = document.getElementById('texty')
  return { ce: e.isContentEditable, tool: (() => { const vb = document.querySelector('vis-bug'); return vb.activeTool?.dataset?.tool ?? vb.activeTool })() }
})
ok(dbl.ce && dbl.tool === 'text',
   `4.1.17 双击文字进入文字编辑态（contenteditable=${dbl.ce}，活动工具=${dbl.tool}）`)
await pick('solo'); await page.waitForTimeout(300)   // 失焦退出编辑态
await clearSel(); await resetStore()

// 4.1.18 Delete / Backspace 由 Visual Revise 完全接管
await pick('c')
const delBefore = await page.evaluate(() => document.querySelectorAll('#list > .item').length)
await page.keyboard.press('Delete'); await page.waitForTimeout(450)
const delAfter = await page.evaluate(() => document.querySelectorAll('#list > .item').length)
const delStats = await stats()
ok(delAfter === delBefore - 1,
   `4.1.18 按一次 Delete 只删一个元素（${delBefore} → ${delAfter}，上游的 del/delete 双别名不会删两个）`)
ok(delStats.removals === 1, `4.1.18 删除进改动记录（removals=${delStats.removals}）`)
ok((await sel()).length === 1, `4.1.18 删完自动选中邻居（现在选中 ${(await sel()).join(',')}）`)
ok(/已删除 1 个元素/.test(await toastText()), `4.1.18 toast 提示「已删除 N 个元素 · 可在记录里放回」（${await toastText()}）`)
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(400)
ok(await page.evaluate(() => !!document.getElementById('c')), '4.1.18 记录里能把删掉的元素放回来')
await resetStore()

// 4.1.19 页面输入框里打字时单字母键不触发插件功能
await clearSel()
const rf = await R('typer')
await clickAt(rf.cx, rf.cy)
const focused = await page.evaluate(() => document.activeElement?.id)
await page.keyboard.type('vlpc')
await page.waitForTimeout(400)
const typed = await page.evaluate(() => ({
  value: document.getElementById('typer').value,
  mode: window.__visualRevise.mode,
  listHidden: window.__visualRevise.list ? window.__visualRevise.list.hidden : true,
}))
ok(focused === 'typer' && typed.value === 'vlpc',
   `4.1.19 真实点击后焦点在页面输入框里，字符原样进去（focus=${focused} value=${typed.value}）`)
ok(typed.mode === 'select' && typed.listHidden,
   `4.1.19 打字期间 v/l/p/c 都不触发插件功能（模式仍是 ${typed.mode}，记录列表 hidden=${typed.listHidden}）`)
await page.evaluate(() => { document.getElementById('typer').value = ''; document.getElementById('typer').blur() })
await resetStore()

// ════════════════════════════════════════════════════════════
console.log('\n── §4.2 选中框上的 8 个缩放把手')

const PROBE_W = 220, PROBE_H = 140
const PLACEMENTS = ['top-start', 'top-center', 'top-end', 'middle-start', 'middle-end',
                    'bottom-start', 'bottom-center', 'bottom-end']
const CURSORS = {
  'top-start': 'nw-resize', 'top-center': 'ns-resize', 'top-end': 'ne-resize',
  'middle-start': 'ew-resize', 'middle-end': 'ew-resize',
  'bottom-start': 'sw-resize', 'bottom-center': 'ns-resize', 'bottom-end': 'se-resize',
}
const makeProbe = async () => {
  await clearSel()
  await page.evaluate(([w, h]) => {
    document.getElementById('probe')?.remove()
    const d = document.createElement('div')
    d.id = 'probe'
    d.style.cssText = `position:absolute;left:640px;top:560px;width:${w}px;height:${h}px;background:#2a2a33;border:1px solid #444`
    document.body.appendChild(d)
  }, [PROBE_W, PROBE_H])
  await page.waitForTimeout(200)
  await pick('probe')
}
const resetProbe = async () => {
  await clearSel()
  await page.evaluate(([w, h]) => {
    const d = document.getElementById('probe')
    d.style.cssText = `position:absolute;left:640px;top:560px;width:${w}px;height:${h}px;background:#2a2a33;border:1px solid #444`
  }, [PROBE_W, PROBE_H])
  await page.waitForTimeout(200)
  await pick('probe')
}
const pointOf = (r, p) => ({
  'top-start': [r.l, r.t], 'top-center': [r.cx, r.t], 'top-end': [r.r, r.t],
  'middle-start': [r.l, r.cy], 'middle-end': [r.r, r.cy],
  'bottom-start': [r.l, r.b], 'bottom-center': [r.cx, r.b], 'bottom-end': [r.r, r.b],
}[p])
const dragHandle = async (placement, dx, dy) => {
  const r = await R('probe')
  const [hx, hy] = pointOf(r, placement).map(Math.round)
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.waitForTimeout(100)
  const during = await page.evaluate(() => ({
    cursor: document.body.style.cursor,
    userSelect: document.body.style.userSelect,
    transition: document.getElementById('probe').style.transition,
  }))
  await page.mouse.move(hx + dx, hy + dy, { steps: 6 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(250)
  const after = await page.evaluate(() => {
    const e = document.getElementById('probe')
    return {
      w: e.style.width, h: e.style.height, tr: e.style.translate,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
      transition: e.style.transition,
    }
  })
  return { during, after }
}
const px = v => v ? Math.round(parseFloat(v)) : null
// 独立属性 translate 的值形如 `40px 30px`（不是 transform 的 `translate(40px, 30px)`）。
// y 是 0 时 CSSOM 会把它省掉，只剩 `40px`——那也是「y 方向没位移」。
const tr = v => {
  const m = /^\s*(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s*$/.exec(v || '')
  return m ? [Math.round(+m[1]), Math.round(m[2] === undefined ? 0 : +m[2])] : null
}

await makeProbe()
await resetStore()

// 4.2.1 八个 placement 都在
const cursorsSeen = {}
for (const p of PLACEMENTS) {
  await resetProbe()
  const r = await R('probe')
  const [hx, hy] = pointOf(r, p).map(Math.round)
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.waitForTimeout(120)
  cursorsSeen[p] = await page.evaluate(() => document.body.style.cursor)
  await page.mouse.up()
  await page.waitForTimeout(150)
}
const cursorHits = PLACEMENTS.filter(p => cursorsSeen[p] === CURSORS[p])
ok(cursorHits.length === 8,
   `4.2.1 8 个 placement 都真实存在且各自的 --cursor 对得上（${cursorHits.length}/8：${PLACEMENTS.map(p => `${p}=${cursorsSeen[p] || '空'}`).join(' ')}）`)

// 4.2.2 每个把手拖一次：写 width / height，带 start / top 的同时写 translate 固定对边
// w / h 写 null 表示「这个把手不碰这条属性」——探针本来就带 inline 的
// width / height，所以判据是「值没被改动」，不是「属性不存在」。
const EXPECT = {
  'top-start':    { dx:  40, dy:  30, w: PROBE_W - 40, h: PROBE_H - 30, tr: [40, 30] },
  'top-center':   { dx:   0, dy:  30, w: null,         h: PROBE_H - 30, tr: [0, 30] },
  'top-end':      { dx:  40, dy:  30, w: PROBE_W + 40, h: PROBE_H - 30, tr: [0, 30] },
  'middle-start': { dx:  40, dy:   0, w: PROBE_W - 40, h: null,         tr: [40, 0] },
  'middle-end':   { dx:  40, dy:   0, w: PROBE_W + 40, h: null,         tr: null },
  'bottom-start': { dx:  40, dy:  30, w: PROBE_W - 40, h: PROBE_H + 30, tr: [40, 0] },
  'bottom-center':{ dx:   0, dy:  30, w: null,         h: PROBE_H + 30, tr: null },
  'bottom-end':   { dx:  40, dy:  30, w: PROBE_W + 40, h: PROBE_H + 30, tr: null },
}
const dragResults = {}
for (const p of PLACEMENTS) {
  await resetProbe()
  const exp = EXPECT[p]
  const expW = exp.w ?? PROBE_W, expH = exp.h ?? PROBE_H
  const { during, after } = await dragHandle(p, exp.dx, exp.dy)
  dragResults[p] = { during, after }
  const gotW = px(after.w), gotH = px(after.h), gotTr = tr(after.tr)
  const trOK = exp.tr === null
    ? !after.tr
    : !!gotTr && gotTr[0] === exp.tr[0] && gotTr[1] === exp.tr[1]
  ok(gotW === expW && gotH === expH,
     `4.2.2 拖 ${p}（Δ${exp.dx},${exp.dy}）实时写 width/height：期望 ${expW}×${expH}${exp.w === null ? '（宽不动）' : exp.h === null ? '（高不动）' : ''}，实得 ${after.w || '无'}×${after.h || '无'}`)
  ok(trOK,
     `4.2.2 拖 ${p} 的 translate（带 start / top 的把手要写它来固定对边）：期望 ${exp.tr ? `${exp.tr[0]}px ${exp.tr[1]}px` : '不写'}，实得 ${after.tr || '不写'}`)
}

// 4.2.2 附：把手写出去的三条声明（width / height / translate）都要能导出。
// 位移量以前写的是 transform，而 transform 的计算值是 matrix(...)，解析不回来，
// 所以它一直不在 TRACKED_PROPS 里——用户拖完看着「变小并挪了位置」，
// 交给 AI 的却只有尺寸变化，对边固定的那半信息静默丢失。
await resetStore()
await resetProbe()
await dragHandle('top-start', 40, 30)
const probeEdit = (await edits()).find(e => e.id === 'probe')
ok(!!probeEdit && probeEdit.props.includes('width') && probeEdit.props.includes('height'),
   `4.2.2 拖把手写出的 width / height 进改动记录（${probeEdit ? probeEdit.props.join(',') : '没有这条记录'}）`)
ok(!!probeEdit && probeEdit.props.includes('translate'),
   `4.2.2 位移量（translate）也要进改动记录（记录里的属性：${probeEdit ? probeEdit.props.join(',') : '—'}）`)
const prompt = await page.evaluate(() => window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
ok(/translate/.test(prompt) && /width/.test(prompt),
   `4.2.2 提示词里 width 和 translate 都在（拖完位置变了，导出给 AI 的信息不能少一半）`)

// 第二次拖必须在第一次的位移上继续，不能先跳回原点：
// 基数要读 translate 自己，getComputedStyle().transform 里不含独立的 translate
await dragHandle('top-start', 20, 10)
const twice = await inlineOf('probe')
ok(tr(twice.tr)?.[0] === 60 && tr(twice.tr)?.[1] === 40,
   `4.2.2 松手再拖一次，位移在上一次的基础上累加（期望 60px 40px，实得 ${twice.tr || '不写'}）`)

// 4.2.3 拖动时换 body 光标 + userSelect:none，收尾还原
const ds = dragResults['bottom-end']
ok(ds.during.cursor === 'se-resize' && ds.during.userSelect === 'none',
   `4.2.3 拖动时 body 换成把手的 --cursor 且 userSelect:none（cursor=${ds.during.cursor} userSelect=${ds.during.userSelect}）`)
ok(!ds.after.cursor && !ds.after.userSelect,
   `4.2.3 pointerup 收尾还原 body 的 cursor / userSelect（cursor=${JSON.stringify(ds.after.cursor)} userSelect=${JSON.stringify(ds.after.userSelect)}）`)

// 4.2.4 拖动期间元素 transition:none，收尾还原
ok(ds.during.transition === 'none',
   `4.2.4 拖动期间元素 transition:none（实得 ${JSON.stringify(ds.during.transition)}）`)
ok(!ds.after.transition,
   `4.2.4 收尾把 transition 还原成原值（实得 ${JSON.stringify(ds.after.transition)}）`)

await page.evaluate(() => document.getElementById('probe')?.remove())
await clearSel(); await resetStore()

// ════════════════════════════════════════════════════════════
console.log('\n── §4.3 文字编辑')

const ORIGINAL = 'Editable Paragraph'
const textyText = () => page.evaluate(() => document.getElementById('texty').textContent)
const enterEdit = async id => {
  await clearSel()
  const r = await R(id)
  await page.mouse.dblclick(Math.round(r.cx), Math.round(r.cy))
  await page.waitForTimeout(450)
}

// 4.3.1 双击 → contenteditable + spellcheck
await enterEdit('texty')
const edit1 = await page.evaluate(() => {
  const e = document.getElementById('texty')
  return { ce: e.isContentEditable, sc: e.getAttribute('spellcheck'), focused: document.activeElement === e }
})
ok(edit1.ce && edit1.sc === 'true' && edit1.focused,
   `4.3.1 双击页面文字 → contenteditable + spellcheck 并拿到焦点（${JSON.stringify(edit1)}）`)

// 4.3.2 focusin 时把原文赶在第一个按键之前快照
await page.keyboard.press('End')
await page.keyboard.type('!!')
await page.waitForTimeout(400)
const snap = (await edits()).find(e => e.text)
ok(snap?.text?.from === ORIGINAL,
   `4.3.2 focusin 时原文已进快照，改完能报出原文（from=${snap?.text?.from}）`)
ok(snap?.text?.to === `${ORIGINAL}!!`, `4.3.2 新文案也对得上（to=${snap?.text?.to}）`)

// 4.3.3 编辑中的按键不外泄，不误触工具热键
const beforeKeys = { mode: await mode(), list: await page.evaluate(() => window.__visualRevise.list ? window.__visualRevise.list.hidden : true) }
await page.keyboard.type('vclp')
await page.waitForTimeout(400)
const afterKeys = await page.evaluate(() => ({
  mode: window.__visualRevise.mode,
  list: window.__visualRevise.list ? window.__visualRevise.list.hidden : true,
  text: document.getElementById('texty').textContent,
}))
ok(afterKeys.mode === 'select' && afterKeys.list === beforeKeys.list,
   `4.3.3 编辑中按 v/c/l/p 不切模式也不开记录列表（mode=${afterKeys.mode} listHidden=${afterKeys.list}）`)
ok(afterKeys.text === `${ORIGINAL}!!vclp`,
   `4.3.3 这些字符原样落进文案（${afterKeys.text}）`)

// 4.3.4 input 200ms 防抖后广播一次
await page.evaluate(() => {
  window.__n = 0
  window.__unsub?.()
  window.__unsub = window.__visualRevise.store.subscribe(() => { window.__n++ })
})
await page.keyboard.type('abcdef', { delay: 5 })
await page.waitForTimeout(600)
const notified = await page.evaluate(() => window.__n)
ok(notified >= 1 && notified <= 3,
   `4.3.4 连打 6 个字符只广播 ${notified} 次（200ms 防抖，不是逐键重排）`)
await page.evaluate(() => window.__unsub?.())
// 面板 / 记录列表真的跟上了
await page.evaluate(() => { const l = window.__visualRevise.list; l.hidden = false; l.render() })
await page.waitForTimeout(300)
const listRow = await page.locator('visual-revise-list .change[data-text]').count()
ok(listRow === 1, `4.3.4 广播之后改动列表里出现这条文案改动（${listRow} 条）`)
await page.evaluate(() => { window.__visualRevise.list.hidden = true })

// 4.3.7 Escape 退出所有编辑态
await page.keyboard.press('Escape'); await page.waitForTimeout(350)
const esc1 = await page.evaluate(() => {
  const e = document.getElementById('texty')
  return { ce: e.isContentEditable, sc: e.getAttribute('spellcheck'), sel: document.querySelectorAll('[data-selected]').length }
})
ok(!esc1.ce && esc1.sc === null,
   `4.3.7 Escape 退出编辑态：contenteditable / spellcheck 都被摘掉（ce=${esc1.ce} spellcheck=${esc1.sc}）`)

// 4.3.5 / 4.3.6 blur 收尾：一整段编辑算一次操作，工具交还给 guides
await pick('solo'); await page.waitForTimeout(450)
const undoLabel = await page.evaluate(() => window.__visualRevise.store.history.undoLabel)
ok(undoLabel === '改文案', `4.3.5 blur 收尾把一整段编辑压成一条历史（下一步撤销的是「${undoLabel}」）`)
ok(await tool() === 'guides', `4.3.6 编辑结束后活动工具切回 guides（${await tool()}）`)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(450)
ok(await textyText() === ORIGINAL,
   `4.3.5 一次 ⌘Z 把整段编辑退回原文（现在是「${await textyText()}」）`)
ok((await stats()).texts === 0, `4.3.5 撤销后文案记录清空（texts=${(await stats()).texts}）`)

// 4.3.8 文案单独计数、不混进样式属性；祖先与后代都报时只留最内层
await resetStore()
await clearSel()
await pick('nest')                       // 先选中父元素，让它也进快照
await page.waitForTimeout(200)
await enterEdit('inner')
await page.keyboard.press('End')
await page.keyboard.type('。')
await page.waitForTimeout(450)
await pick('solo'); await page.waitForTimeout(350)
const nestEdits = await edits()
const texted = nestEdits.filter(e => e.text)
ok(texted.length === 1 && texted[0].tag === 'p',
   `4.3.8 祖先与后代都被跟踪时，文案只记最内层那条（${texted.length} 条，落在 <${texted[0]?.tag}> 上）`)
ok(texted[0]?.props.length === 0 && (await stats()).texts === 1,
   `4.3.8 文案改动单独计数，不混进样式属性（该条的样式属性 ${texted[0]?.props.length} 个，texts=${(await stats()).texts}）`)

await browser.close()
await close()
if (pageErrors.length) console.log(`\n页面异常 ${pageErrors.length} 条：\n  ${pageErrors.join('\n  ')}`)
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
