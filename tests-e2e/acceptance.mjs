// PRD 验收：按 docs/PRD.md 的 AC 编号逐条真实执行。
//
// 与其它套件的分工——那些按技术模块组织（fill / grid / resizing…），跟着实现
// 一路加，天然偏向「已实现的那条路径」；这一套按用户目标组织，专门用来暴露
// 「功能存在，但没人真的走过这条路」以及「写 PRD 才发现根本没做」。
//
// 无法在无头环境里真实触发的（扩展图标点击、浏览器级快捷键、受限页面），
// 明确打 SKIP 并说明原因，不假装覆盖过。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

let passed = 0, failed = 0, skipped = 0
const AC = (id, cond, msg) => {
  cond ? passed++ : failed++
  ok(cond, `${id}  ${msg}`)
}
const SKIP = (id, why) => {
  skipped++
  console.log(`  ○ ${id}  跳过：${why}`)
}

console.log('\n[PRD 验收] docs/PRD.md · 批次 1：唤起 / 模式 / 选择 / 快捷键 / 摆位\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

const vr = () => page.evaluate(() => ({
  mode: window.__visualRevise?.mode,
  interactive: window.__visualRevise?.interactive,
  toolbarShown: !document.querySelector('visual-revise-toolbar')?.hidden,
  panelShown: !document.querySelector('visual-revise-panel')?.hidden,
  commentsShown: !document.querySelector('visual-revise-comment-layer')?.hidden,
  total: window.__visualRevise?.store.stats().total,
}))
const selCount = () => page.evaluate(() => document.querySelectorAll('[data-selected]').length)
const setMode = m => page.evaluate(x => window.__visualRevise.setMode(x), m)
const clickBody = () => page.locator('body').click({ position: { x: 4, y: 4 } })

// ── 1. 安装与唤起 ───────────────────────────────────────────
console.log('\n── 1. 安装与唤起')

SKIP('AC-1.1', '扩展图标点击需要浏览器 UI，无头环境触发不了；manifest 侧由 extension.mjs 覆盖')
SKIP('AC-1.2', '同上，Alt+Shift+D 走的是 chrome.commands')
SKIP('AC-1.4', '受限页面（chrome://）无法在测试服上重现')

// 先造一条改动，用来验证收起再唤起后它还在
await page.evaluate(() => {
  const el = document.querySelector('.curve-card')
  window.__visualRevise.store.applyProp(el, 'padding-top', '37px')
})
const beforeEject = (await vr()).total

// eject.js 的实质：移除 vis-bug（动画在无头环境不可靠，直接 remove）
await page.evaluate(() => document.querySelectorAll('vis-bug').forEach(n => n.remove()))
await page.waitForTimeout(300)
AC('AC-1.1b', await page.evaluate(() => !document.querySelector('visual-revise-panel')),
   '收起后编辑器 UI 一并卸载（vis-bug 的 disconnectedCallback → destroy）')

// restore.js 的实质：bundle 已在，只重新创建 vis-bug
await page.evaluate(() => {
  const el = document.createElement('vis-bug')
  el.setAttribute('tutsBaseURL', '/__ext/tuts')
  document.body.prepend(el)
})
await page.waitForTimeout(600)
const afterRestore = await vr()
AC('AC-1.3', afterRestore.total === beforeEject && beforeEject > 0,
   `收起再唤起后改动记录仍在（${afterRestore.total} / ${beforeEject}）`)
AC('AC-1.3b', await page.evaluate(() => document.querySelector('.curve-card').style.paddingTop) === '37px',
   '画面上的改动也还在，不只是记录')

// 重复注入
await page.evaluate(() => {
  const el = document.createElement('vis-bug')
  el.setAttribute('tutsBaseURL', '/__ext/tuts')
  document.body.prepend(el)
})
await page.waitForTimeout(500)
const dup = await page.evaluate(() => ({
  bars: document.querySelectorAll('visual-revise-toolbar').length,
  panels: document.querySelectorAll('visual-revise-panel').length,
}))
AC('AC-1.5', dup.bars === 1 && dup.panels === 1,
   `重复注入不叠出第二套 UI（工具条 ${dup.bars}、面板 ${dup.panels}）`)
await page.evaluate(() => {
  const all = document.querySelectorAll('vis-bug')
  for (let i = 1; i < all.length; i++) all[i].remove()
})

// 死元素自愈：有 vis-bug 但没有编辑器 UI（bundle 曾加载失败）
// 造法要对：不能删掉 vis-bug 再新建一个——bundle 已加载，新建的会被立刻升级，
// 根本不是死元素。真正的坏状态是「vis-bug 还在、编辑器 UI 没了」，
// 只删 UI 就是。
await page.evaluate(() => {
  document.querySelectorAll('visual-revise-toolbar, visual-revise-panel, visual-revise-comment-layer, visual-revise-tree, visual-revise-list')
    .forEach(n => n.remove())
})
await page.waitForTimeout(200)
const healed = await page.evaluate(() => {
  // restore.js 的判据：有 vis-bug 但没有 visual-revise-toolbar → 清掉重来
  const mounted = document.querySelector('visual-revise-toolbar')
  const existing = document.querySelector('vis-bug')
  if (existing && !mounted) existing.remove()
  if (!document.querySelector('vis-bug')) {
    const el = document.createElement('vis-bug')
    el.setAttribute('tutsBaseURL', '/__ext/tuts')
    document.body.prepend(el)
    return true
  }
  return false
})
await page.waitForTimeout(600)
AC('AC-1.6', healed && await page.evaluate(() => !!document.querySelector('visual-revise-toolbar')),
   '注入失败留下的死元素能被清掉重来，不会永久挡住唤起')

// ── 2. 模式体系 ─────────────────────────────────────────────
console.log('\n── 2. 模式体系')

await setMode('select'); await page.waitForTimeout(200)
await clickBody()   // 只点这一次把焦点交回页面；循环里再点，评论模式那轮会起草稿
// 键位：V 让开页面、C 评论；选择元素拆成 A（属性）与 F（结构）两个入口，
// 直接落到面板的两个 tab 上。B 与 R 已释放。
for (const [key, mode] of [['v', 'browse'], ['c', 'comment'], ['a', 'select']]) {
  await page.keyboard.press(key)
  await page.waitForTimeout(250)
  AC(`AC-2.1${key}`, (await vr()).mode === mode, `按 ${key.toUpperCase()} 进入 ${mode}`)
}

await page.keyboard.press('c'); await page.waitForTimeout(200)
await page.keyboard.press('c'); await page.waitForTimeout(250)
AC('AC-2.2', (await vr()).mode === 'comment', '连按 C 仍停在评论模式，不 toggle 回选择态')

await setMode('browse'); await page.waitForTimeout(250)
await page.locator('.curve-card').first().click()
await page.waitForTimeout(250)
AC('AC-2.3', await selCount() === 0, '浏览模式下点击页面不会选中元素')
const browsing = await vr()
AC('AC-2.4', !browsing.commentsShown, '浏览模式下评论 pin 隐藏，不挡住该位置的点击')
AC('AC-2.5', browsing.toolbarShown, '浏览模式下工具条保留')

await page.mouse.move(340, 300)
await page.mouse.move(560, 430)
await page.waitForTimeout(350)
const rulers = await page.evaluate(() =>
  [...document.querySelectorAll('visbug-gridlines, visbug-distance')]
    .filter(el => getComputedStyle(el).display !== 'none').length)
AC('AC-2.6', rulers === 0, `浏览模式下移动鼠标不画标尺线（实得 ${rulers}）`)

await page.keyboard.press('Escape'); await page.waitForTimeout(250)
await page.keyboard.press('Tab'); await page.waitForTimeout(300)
const stealth = await vr()
AC('AC-2.7', stealth.interactive && !stealth.toolbarShown, 'Tab 进入隐身态，工具条一起藏')
await page.keyboard.press('c')
await page.keyboard.press('l')
await page.waitForTimeout(250)
const stillStealth = await vr()
AC('AC-2.8', stillStealth.interactive && !stillStealth.toolbarShown,
   '隐身态下单字母放行给页面，不切模式也不开列表')
await page.keyboard.press('Tab'); await page.waitForTimeout(300)
AC('AC-2.7b', (await vr()).mode === 'select', '再按 Tab 回到原模式')

// 前一步 Tab 把焦点留在工具条上，那里的 Esc 被当作面板内 Esc 放行。
// 必须在进评论模式之前点回页面——进了评论模式再点，点的就是「起草评论」。
await clickBody(); await page.waitForTimeout(150)
await setMode('comment'); await page.waitForTimeout(200)
const snap29 = () => page.evaluate(() => ({
  mode: window.__visualRevise.mode,
  active: document.activeElement?.tagName?.toLowerCase(),
  hasDraft: !!window.__visualRevise.comments?.hasDraft,
  interactive: window.__visualRevise.interactive,
}))
const s29a = await snap29()
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
const s29b = await snap29()
AC('AC-2.9', s29b.mode === 'select',
   `Esc 从任何模式回到选择态（前 ${JSON.stringify(s29a)} → 后 ${JSON.stringify(s29b)}）`)

const beforeSwitch = (await vr()).total
await setMode('comment'); await page.waitForTimeout(200)
await setMode('select'); await page.waitForTimeout(200)
AC('AC-2.11', (await vr()).total === beforeSwitch,
   `来回切模式不丢改动记录（${(await vr()).total} / ${beforeSwitch}）`)

console.log(`\n批次 1 前半：${passed} 通过 / ${failed} 失败 / ${skipped} 跳过`)
await page.evaluate(() => window.__visualRevise.store.clear())

// ── 3. 元素选择 ─────────────────────────────────────────────
console.log('\n── 3. 元素选择')
await setMode('select'); await page.waitForTimeout(200)
await page.keyboard.press('Escape'); await page.waitForTimeout(150)

const selTags = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(el =>
    el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '')))
const card = n => page.locator('.curve-card').nth(n)
// 面板贴着选中元素放，会盖住它右边的邻居（PRD §5 记的已知取舍）。
// 需要保持选中再点第二张时，挑一张没被盖住的。
// 判据要和 Playwright 一样：看「点击点」(左上角 +4,+4) 落在谁身上，
// 不是整张卡片有没有和面板矩形相交——竖排时下面每张都相交，但左上角多半是空的。
const freeCard = exclude => page.evaluate(ex => {
  const cards = [...document.querySelectorAll('.curve-card')]
  for (let i = 0; i < cards.length; i++) {
    if (i === ex) continue
    const r = cards[i].getBoundingClientRect()
    // 探顶部正中，别探角：卡片有圆角，(+4,+4) 在被切掉的那块里，会穿到父级
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12)
    if (hit && cards[i].contains(hit)) return i
  }
  return -1
}, exclude)

// 卡片横排，面板贴着选中项放会盖住邻居。先选最右那张，面板翻到左边，
// 最左那张留给多选和 hover 用。
const LAST = (await page.locator('.curve-card').count()) - 1
await card(LAST).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(300)
const one = await page.evaluate(() => ({
  sel: document.querySelectorAll('[data-selected]').length,
  handles: !!document.querySelector('visbug-handles'),
  label: !!document.querySelector('visbug-label'),
}))
const vbEls = await page.evaluate(() => [...document.querySelectorAll('*')].map(e => e.tagName.toLowerCase()).filter(t => t.startsWith('visbug-')).filter((t, i, a) => a.indexOf(t) === i))
AC('AC-3.1', one.sel === 1 && one.handles, `单击选中，显示选中框（${JSON.stringify(one)}；页面上的 visbug 元素：${vbEls.join(', ')}）`)

const second = await freeCard(LAST)
await card(second).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(250)
AC('AC-3.2', await selCount() === 2, `Shift+单击多选（${await selCount()} 个，用的第 ${second} 张）`)
await card(second).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(250)
AC('AC-3.2b', await selCount() === 1, `再 Shift+单击已选中的元素则取消它（剩 ${await selCount()} 个）`)

await card(await freeCard(LAST)).hover(); await page.waitForTimeout(250)
const hov = await page.evaluate(() => ({
  hover: !!document.querySelector('visbug-hover'),
  sel: document.querySelectorAll('[data-selected]').length,
}))
AC('AC-3.3', hov.hover && hov.sel === 1, `hover 显示悬停框，不影响已选中项（${JSON.stringify(hov)}）`)

// 点一个没有副作用的位置：.redo 此时是禁用态。不能点 (8,8)——那是布局切换钮
await page.locator('visual-revise-toolbar .redo').click({ force: true }); await page.waitForTimeout(250)
AC('AC-3.4', !(await page.evaluate(() => !!document.querySelector('visual-revise-toolbar[data-selected], visual-revise-panel[data-selected]')))
   && await selCount() === 1,
   '点插件自身 UI 不会把它选中，也不清掉已有选中')

// 上游 VisBug 的层级导航——这一批以前没有任何套件走过
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(250)
const parentTag = (await selTags())[0]
await page.keyboard.press('Enter'); await page.waitForTimeout(250)
const afterEnter = await selTags()
AC('AC-3.5', afterEnter.length >= 1 && afterEnter[0] !== parentTag,
   `Enter 下钻到子元素（${parentTag} → ${afterEnter.join(', ')}）`)
await page.keyboard.press('Shift+Enter'); await page.waitForTimeout(250)
const afterShiftEnter = await selTags()
AC('AC-3.5b', afterShiftEnter[0] === parentTag,
   `Shift+Enter 上浮回父元素（${afterShiftEnter.join(', ')}）`)

await page.keyboard.press("Shift+'"); await page.waitForTimeout(250)
const afterQuote = await selTags()
// 上游语义是「向外扩展」：父级加进选中集，原来的子级仍留着——不是替换
AC('AC-3.6', afterQuote.length === 2 && afterQuote.includes(parentTag) && afterQuote.some(t => t !== parentTag),
   `Shift+' 把父元素加进选中集，子级仍在（${afterQuote.join(' + ')}）`)

await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(250)
const kidCount = await page.evaluate(() => document.querySelector('.curve-card').children.length)
await page.keyboard.press('Meta+Shift+Enter'); await page.waitForTimeout(250)
AC('AC-3.7', await selCount() === kidCount && kidCount > 1,
   `⌘⇧Enter 选中全部 ${kidCount} 个子元素（实得 ${await selCount()}）`)

await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(250)
await page.keyboard.press('Meta+e'); await page.waitForTimeout(250)
const afterE = await selCount()
await page.keyboard.press('Meta+Shift+e'); await page.waitForTimeout(250)
const afterShiftE = await selCount()
const cardTotal = await page.locator('.curve-card').count()
AC('AC-3.8', afterE === 2 && afterShiftE === cardTotal,
   `⌘E 加选下一个同类（${afterE}），⌘⇧E 全选同类（${afterShiftE} / ${cardTotal}）`)

await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(250)
const beforeDup = await page.locator('.curve-card').count()
await page.keyboard.press('Meta+d'); await page.waitForTimeout(300)
const afterDup = await page.locator('.curve-card').count()
AC('AC-3.9', afterDup === beforeDup + 1, `⌘D 原地复制（${beforeDup} → ${afterDup}）`)
await page.evaluate(() => { const c = document.querySelectorAll('.curve-card'); c[1]?.remove() })

// 复制 / 粘贴样式：给 A 一个显眼的样式，复制，贴到 B 上
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
// getStyles 只复制 design-properties 白名单里的属性，outline 不在、backgroundColor 在
await page.evaluate(() => { document.querySelectorAll('.curve-card')[0].style.backgroundColor = 'rgb(255, 0, 255)' })
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(250)
await page.keyboard.press('Meta+Alt+c'); await page.waitForTimeout(250)
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await card(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(250)
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(400)
const pasted = await page.evaluate(() => getComputedStyle(document.querySelectorAll('.curve-card')[1]).backgroundColor)
AC('AC-3.10', pasted === 'rgb(255, 0, 255)', `⌘⌥C / ⌘⌥V 复制粘贴样式（B 的背景变成 ${pasted}）`)
await page.evaluate(() => document.querySelectorAll('.curve-card').forEach(c => c.style.backgroundColor = ''))

await page.keyboard.press('Escape'); await page.waitForTimeout(250)
AC('AC-3.11', await selCount() === 0, 'Esc 取消全部选中')

await card(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const beside = await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[1].getBoundingClientRect()
  const p = document.querySelector('visual-revise-panel')
  if (p.hidden) return { hidden: true }
  const r = p.getBoundingClientRect()
  const overlap = !(r.right <= el.left || r.left >= el.right || r.bottom <= el.top || r.top >= el.bottom)
  return { hidden: false, overlap, left: Math.round(r.left), elRight: Math.round(el.right) }
})
AC('AC-3.12', !beside.hidden && !beside.overlap, `选中后属性面板出现在元素旁边且不盖住它（${JSON.stringify(beside)}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(150)

// ── 4. 快捷键 ───────────────────────────────────────────────
console.log('\n── 4. 快捷键')
await setMode('select'); await page.keyboard.press('Escape'); await page.waitForTimeout(150)
// store.clear() 的语义是「忘掉记录」，不清历史栈；不清的话撤销会退回 AC-1.3 留下的那条
await page.evaluate(() => {
  window.__visualRevise.store.clear()
  window.__visualRevise.store.history?.clear?.()
  // clear 的语义是「忘掉记录」，不把元素放回去；AC-1.3 写的 37px 还在 inline 上
  document.querySelector('.curve-card').style.paddingTop = ''
})
await clickBody(); await page.waitForTimeout(100)

const cardPad = () => page.evaluate(() => document.querySelector('.curve-card').style.paddingTop)
await page.evaluate(() => window.__visualRevise.store.applyProp(document.querySelector('.curve-card'), 'padding-top', '41px'))
await page.waitForTimeout(100)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(250)
const undone = await cardPad()
await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(250)
const redone = await cardPad()
AC('AC-4.1', undone === '' && redone === '41px', `⌘Z 撤销、⌘⇧Z 重做（撤销后 "${undone}"，重做后 "${redone}"）`)

// 页面自己的输入框：单字母不能被吃，⌘Z 要让给浏览器的文本撤销
await page.evaluate(() => {
  const i = document.createElement('input'); i.id = 'page-input'; i.style.cssText = 'position:fixed;left:8px;bottom:8px'
  document.body.appendChild(i)
})
await page.locator('#page-input').click(); await page.keyboard.type('cbr')
await page.waitForTimeout(200)
const typed = await page.evaluate(() => ({ v: document.getElementById('page-input').value, mode: window.__visualRevise.mode }))
AC('AC-4.2', typed.v === 'cbr' && typed.mode === 'select', `输入框里打 c/b/r 不触发模式切换，字符正常输入（"${typed.v}"，mode=${typed.mode}）`)
const totalBefore = (await vr()).total
await page.keyboard.press('Meta+z'); await page.waitForTimeout(250)
AC('AC-4.3', (await vr()).total === totalBefore, `输入框里 ⌘Z 让给文本撤销，改动记录不动（${(await vr()).total} / ${totalBefore}）`)
await page.evaluate(() => document.getElementById('page-input').remove())

// 焦点停在插件面板内（比如刚点过工具条按钮），单字母仍归插件
await page.locator('visual-revise-toolbar .undo').click({ force: true }); await page.waitForTimeout(150)
await page.keyboard.press('c'); await page.waitForTimeout(250)
AC('AC-4.4', (await vr()).mode === 'comment', `焦点在工具条上时按 C 仍切到评论模式（${(await vr()).mode}）`)
await setMode('select'); await page.waitForTimeout(150)

// 面板内的 Tab / Esc 归面板：Tab 在字段间跳，不触发隐身
await card(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
await page.locator('visual-revise-panel input[data-prop]').first().focus()
await page.keyboard.press('Tab'); await page.waitForTimeout(200)
const tabbed = await vr()
AC('AC-4.5', !tabbed.interactive && tabbed.toolbarShown, '面板内按 Tab 是切字段焦点，不进隐身态')
await page.keyboard.press('Escape'); await page.waitForTimeout(200)

// 上游 13 个工具热键已解绑：按 g / i 不该在背后画出网格或弹出 metatip
await clickBody(); await page.keyboard.press('Escape'); await page.waitForTimeout(100)
await page.keyboard.press('g'); await page.keyboard.press('i'); await page.keyboard.press('m')
await page.waitForTimeout(300)
const ghost = await page.evaluate(() =>
  [...document.querySelectorAll('visbug-gridlines, visbug-metatip, visbug-boxmodel')].filter(e => getComputedStyle(e).display !== 'none').length)
AC('AC-4.6', ghost === 0 && (await vr()).mode === 'select', `按 g / i / m 不会在背后切上游工具（可见的上游 UI ${ghost} 个，mode=${(await vr()).mode}）`)

await page.keyboard.press('l'); await page.waitForTimeout(250)
const listOpen = await page.evaluate(() => !document.querySelector('visual-revise-list').hidden)
await page.keyboard.press('l'); await page.waitForTimeout(250)
const listClosed = await page.evaluate(() => document.querySelector('visual-revise-list').hidden)
AC('AC-4.7', listOpen && listClosed, 'L 开合改动记录')
await page.keyboard.press('p'); await page.waitForTimeout(400)
const toast = await page.evaluate(() => document.getElementById('visual-revise-toast')?.textContent?.trim() || '')
AC('AC-4.7b', toast.length > 0, `P 复制提示词（toast：「${toast.slice(0, 20)}」）`)

await page.evaluate(() => {
  const s = document.createElement('div'); s.id = 'del-wrap'
  s.innerHTML = '<p class="del-me">1</p><p class="del-me">2</p><p class="del-me">3</p>'
  document.body.appendChild(s)
})
await page.locator('.del-me').nth(1).click(); await page.waitForTimeout(250)
await page.keyboard.press('Delete'); await page.waitForTimeout(300)
const left = await page.locator('.del-me').count()
AC('AC-4.8', left === 2, `Delete 只删一个（3 → ${left}）——上游 del/delete 双别名会删两个`)
await page.evaluate(() => document.getElementById('del-wrap')?.remove())
await page.keyboard.press('Escape'); await page.waitForTimeout(150)

// ── 5. 面板摆位 ─────────────────────────────────────────────
console.log('\n── 5. 面板摆位')
const rect = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }, sel)
const overlaps = (a, b) => !(a.r <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b)
const vw = () => page.evaluate(() => ({ w: innerWidth, h: innerHeight }))

await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const p0 = await rect('visual-revise-panel'), c0 = await rect('.curve-card')
AC('AC-5.1', !overlaps(p0, c0) && p0.l >= c0.r, `贴左的元素：面板出现在它右边、不盖住它（面板 left=${Math.round(p0.l)} ≥ 元素 right=${Math.round(c0.r)}）`)

await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await card(LAST).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const pL = await rect('visual-revise-panel'), cL = await page.evaluate(() => { const r = document.querySelectorAll('.curve-card'); return r[r.length - 1].getBoundingClientRect().left })
const v = await vw()
AC('AC-5.2', pL.r <= v.w, `空间不足时翻到另一侧（面板 right=${Math.round(pL.r)} ≤ 视口 ${v.w}）`)
AC('AC-5.3', pL.l >= 0 && pL.t >= 0 && pL.r <= v.w && pL.b <= v.h, `面板不超出视口（${Math.round(pL.l)},${Math.round(pL.t)} – ${Math.round(pL.r)},${Math.round(pL.b)}）`)
AC('AC-5.4', !overlaps(pL, await rect('visual-revise-toolbar')), '面板不盖住工具条')

// 拖动后钉住
const head = page.locator('visual-revise-panel > #root > header, visual-revise-panel header:not(.tree-head)')
const hb = await head.boundingBox()
await page.mouse.move(hb.x + 40, hb.y + 12); await page.mouse.down()
await page.mouse.move(hb.x - 200, hb.y + 120, { steps: 6 }); await page.mouse.up()
await page.waitForTimeout(250)
const pinned = await rect('visual-revise-panel')
await page.keyboard.press('Escape'); await page.waitForTimeout(100)
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const afterReselect = await rect('visual-revise-panel')
AC('AC-5.5', Math.abs(afterReselect.l - pinned.l) < 2 && Math.abs(afterReselect.t - pinned.t) < 2,
   `手动拖过后钉住，换选元素不再自动摆位（${Math.round(pinned.l)},${Math.round(pinned.t)} → ${Math.round(afterReselect.l)},${Math.round(afterReselect.t)}）`)
await page.locator('visual-revise-panel .close').click(); await page.waitForTimeout(250)
await card(LAST).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const unpinned = await rect('visual-revise-panel')
AC('AC-5.5b', Math.abs(unpinned.l - pinned.l) > 20, `关闭面板后解除钉住，重新按元素摆（${Math.round(unpinned.l)} vs 钉住时 ${Math.round(pinned.l)}）`)

// 结构树已并进面板，跟着面板一起摆位，不再单独占一块
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
await page.locator('visual-revise-panel .tab[data-tab="structure"]').click(); await page.waitForTimeout(400)
const tp = await rect('visual-revise-panel')
AC('AC-5.6', tp.l >= 0 && tp.t >= 0 && tp.r <= v.w && tp.b <= v.h && !overlaps(tp, await rect('visual-revise-toolbar')),
   '结构 tab 打开时面板仍在视口内、不盖工具条')
await page.locator('visual-revise-panel .tab[data-tab="props"]').click(); await page.waitForTimeout(300)
await page.keyboard.press('Escape'); await page.waitForTimeout(150)

await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const beforeScroll = await rect('visual-revise-panel')
await page.mouse.wheel(0, 300); await page.waitForTimeout(400)
const afterScroll = await rect('visual-revise-panel')
AC('AC-5.7', Math.abs(afterScroll.t - beforeScroll.t) < 2, `滚动页面时面板不跟着重算位置（top ${Math.round(beforeScroll.t)} → ${Math.round(afterScroll.t)}）`)
await page.mouse.wheel(0, -300); await page.keyboard.press('Escape'); await page.waitForTimeout(200)

// 5.8–5.11 纵向工具条
await page.locator('visual-revise-toolbar .layout').click(); await page.waitForTimeout(500)
const vert = await page.evaluate(() => {
  const bar = document.querySelector('visual-revise-toolbar'), sr = bar.shadowRoot
  const t = sr.querySelector('.segment .thumb').getBoundingClientRect(), on = sr.querySelector('.segment button[data-on]').getBoundingClientRect()
  return {
    vertical: bar.hasAttribute('vertical'),
    stored: localStorage.getItem('visual-revise:orientation'),
    labelHidden: getComputedStyle(sr.querySelector('.copy .label')).display === 'none',
    thumbFits: Math.abs(t.top - on.top) <= 1 && Math.abs(t.left - on.left) <= 1,
    tall: bar.getBoundingClientRect().height > bar.getBoundingClientRect().width,
  }
})
AC('AC-5.8', vert.vertical && vert.tall && vert.stored === 'vertical', `工具条切成竖排并记进 localStorage（${vert.stored}）`)
AC('AC-5.9', vert.labelHidden, '竖排时按钮文字收进 hover 气泡')
AC('AC-5.10', vert.thumbFits, '竖排时分段滑块沿纵轴贴合当前模式')
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
AC('AC-5.11', !overlaps(await rect('visual-revise-panel'), await rect('visual-revise-toolbar')), '竖排时面板同样让开工具条')
await page.keyboard.press('Escape')
await page.locator('visual-revise-toolbar .layout').click(); await page.waitForTimeout(400)

globalThis.__acc = { passed, failed, skipped }

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败 / ${skipped} 跳过\n`)
process.exitCode = failed ? 1 : 0
