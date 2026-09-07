// 全量 e2e · 分块：属性面板头部 / tab / 分区通用行为 / Position
// 对应功能清单 docs/plans/feature-inventory.md 的 §2.1 §2.2 §2.3 §2.4。
//
// 每条断言以清单编号开头。全部走真实交互（locator.click / page.mouse /
// page.keyboard），断言落在元素 inline style、面板 DOM、改动记录、localStorage 上。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIX = `${origin}/full/fixtures/panel-head-position-main.html`

const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const T = (cond, msg) => { cond ? passed++ : failed++; ok(cond, msg) }

const pause = ms => page.waitForTimeout(ms)
const P = sel => page.locator(`visual-revise-panel ${sel}`)
const sect = id => P(`section[data-group="${id}"]`)

const inline = (sel, prop) =>
  page.evaluate(([s, p]) => document.querySelector(s)?.style.getPropertyValue(p) ?? null, [sel, prop])
const inlineAll = sel =>
  page.evaluate(s => document.querySelector(s)?.getAttribute('style') || '', sel)
const panelBox = () => page.locator('visual-revise-panel').boundingBox()
const storedPos = () =>
  page.evaluate(() => { try { return JSON.parse(localStorage.getItem('visual-revise:panel-pos')) } catch { return null } })
const clearStored = () =>
  page.evaluate(() => { try { localStorage.removeItem('visual-revise:panel-pos') } catch { /* 无痕 */ } })
const stats = () => page.evaluate(() => window.__visualRevise.store.stats())
const toastText = async () => (await P('.toast').textContent())?.trim()

// 取消选中：焦点可能在面板里（此时第一下 Esc 归弹层），保险按两下
const deselect = async () => {
  await page.keyboard.press('Escape'); await pause(140)
  await page.keyboard.press('Escape'); await pause(140)
}

const select = async (selector, opts = {}) => {
  await deselect()
  const loc = page.locator(selector)
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ force: true, ...opts })
  await pause(450)
  // 容器的几何中心常常落在子元素上，选错了后面整段都跑偏——出声提醒
  if (selector.startsWith('#') && !selector.includes(' ')) {
    const got = await page.evaluate(() => window.__visualRevise.panel.target?.id ?? '')
    if (got !== selector.slice(1)) console.log(`  [选中偏移] 想选 ${selector}，实得 #${got || '(空)'}`)
  }
}

// 前缀 span 只有在「一个标签罩两个框」时才带 data-prop，其余场合要顺着输入框找
const prefixOf = prop => page.evaluate(p => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return sr.querySelector(`input[data-prop="${p}"]`)?.closest('.control')
    ?.querySelector('.prefix')?.textContent.trim() ?? null
}, prop)

const clickIn = async (selector, opts = {}) => {
  const loc = P(selector).first()
  await loc.scrollIntoViewIfNeeded()
  await loc.click(opts)
  await pause(300)
}

const write = async (prop, value) => {
  const i = P(`input[data-prop="${prop}"]`).first()
  await i.scrollIntoViewIfNeeded()
  await i.fill(String(value))
  await i.press('Enter')
  await pause(320)
}

const pickFrom = async (hostId, label) => {
  const items = page.locator(`#${hostId} [data-item]`)
  const n = await items.count()
  for (let i = 0; i < n; i++) {
    const txt = (await items.nth(i).textContent())?.trim()
    if (txt === label) { await items.nth(i).click(); await pause(400); return true }
  }
  return false
}

const chooseSelect = async (prop, value) => {
  await clickIn(`vr-select[data-prop="${prop}"]`)
  const found = await pickFrom('visual-revise-select-panel', value)
  await pause(300)
  return found
}

const unfold = async id => {
  if (await sect(id).getAttribute('folded') !== null) {
    const t = sect(id).locator('h3 .title')
    await t.scrollIntoViewIfNeeded(); await t.click(); await pause(260)
  }
}

console.log('\n[全量 e2e] 面板头部 / tab / 分区通用行为 / Position（§2.1–§2.4）\n')

await page.goto(FIX)
await clearStored()
await injectVisBug(page, origin)
await pause(400)

// ══════════════════════════════════════════════════════════════
// §2.1 头部
// ══════════════════════════════════════════════════════════════
console.log('── §2.1 头部')

// ── 2.1.1 元素名 = tagname.class1.class2（只留稳定类名）
await select('#fk1')
T((await P('.tag').textContent()).trim() === 'div.kid',
  `2.1.1 元素名 = tag + 稳定类名（${(await P('.tag').textContent()).trim()}）`)
await select('#para')
T((await P('.tag').textContent()).trim() === 'p',
  `2.1.1 无类名时只显示标签名（${(await P('.tag').textContent()).trim()}）`)
await select('#relbox')
const relTag = (await P('.tag').textContent()).trim()
T(relTag === 'div.panel-card.is-wide',
  `2.1.1 多类名用 . 连接、框架噪音类名（css-1a2b3c）被滤掉（${relTag}）`)

// ── 2.1.2 副标题：已选 N 个 / N 项改动 / 联动 N 个
await select('#fk1')
T((await P('.sub').textContent()).trim() === '未改动',
  `2.1.2 未改动时副标题为「未改动」（${(await P('.sub').textContent()).trim()}）`)
await write('rotate', '5')
T((await P('.sub').textContent()).trim() === '1 项改动',
  `2.1.2 改一项后副标题变「1 项改动」（${(await P('.sub').textContent()).trim()}）`)
await page.locator('#fk2').click({ force: true, modifiers: ['Shift'] })
await pause(450)
const subMulti = (await P('.sub').textContent()).trim()
T(subMulti.startsWith('已选 2 个 · '),
  `2.1.2 多选时副标题前缀「已选 N 个 · 」（${subMulti}）`)

// ── 2.1.3 共享元素按钮
await select('#fk0')
T(await P('.shared').getAttribute('data-on') === null, '2.1.3 共享按钮默认未开启')
await clickIn('.shared')
T(await P('.shared').getAttribute('data-on') !== null, '2.1.3 点一下共享按钮 → 按钮加 data-on')
const sharedToast = await toastText()
T(/3/.test(sharedToast || ''),
  `2.1.3 开启时 toast 报出联动数量（「${sharedToast}」）`)
const subShared = (await P('.sub').textContent()).trim()
T(/联动 3 个/.test(subShared), `2.1.3 副标题带「· 联动 3 个」（${subShared}）`)
await write('rotate', '7')
const rAll = await page.evaluate(() =>
  ['#fk0', '#fk1', '#fk2'].map(s => document.querySelector(s).style.rotate))
T(rAll.join(',') === '7deg,7deg,7deg',
  `2.1.3 开启后写入落到同构全集（rotate = ${rAll.join(' / ')}）`)
await clickIn('.shared')
T(await P('.shared').getAttribute('data-on') === null, '2.1.3 再点一下关闭共享')
await write('rotate', '9')
const rAfter = await page.evaluate(() =>
  ['#fk0', '#fk1', '#fk2'].map(s => document.querySelector(s).style.rotate))
T(rAfter.join(',') === '9deg,7deg,7deg',
  `2.1.3 关闭后写入只落到当前元素（rotate = ${rAfter.join(' / ')}）`)

// ── 2.1.4 折叠按钮：只收内容，标题栏与 tab 条留着
await select('#fk1')
T(await P('.scroll').isVisible(), '2.1.4 折叠前内容区可见')
await clickIn('.fold')
const folded = await page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  return { attr: p.hasAttribute('collapsed') }
})
T(folded.attr, '2.1.4 点折叠 → 宿主上出现 collapsed 属性')
T(!(await P('.scroll').isVisible()), '2.1.4 折叠后内容区（.scroll）隐藏')
T(await P('header').isVisible() && await P('.tabs').isVisible(),
  '2.1.4 折叠只收内容，标题栏与 tab 条仍在')
await clickIn('.fold')
T(await P('.scroll').isVisible(), '2.1.4 再点一下展开')

// ── 2.1.10 面板内 keydown 一律 stopPropagation
await page.evaluate(() => {
  window.__docKeys = []
  document.addEventListener('keydown', e => window.__docKeys.push(e.key))
})
await select('#pad20')
await page.keyboard.press('x')
await pause(150)
T((await page.evaluate(() => window.__docKeys)).includes('x'),
  '2.1.10 对照组：焦点在页面上时按键正常冒泡到 document')
await page.evaluate(() => { window.__docKeys = [] })
const rotInput = P('input[data-prop="rotate"]').first()
await rotInput.scrollIntoViewIfNeeded(); await rotInput.click(); await pause(150)
await rotInput.press('Delete'); await pause(200)
await rotInput.press('Enter'); await pause(200)
const leaked = await page.evaluate(() => window.__docKeys)
T(leaked.length === 0,
  `2.1.10 面板内按 Delete / Enter 一个都不漏给 document（漏出 ${JSON.stringify(leaked)}）`)
T(await page.evaluate(() => !!document.getElementById('pad20')),
  '2.1.10 在面板输入框里按 Delete 不会删掉选中元素')
T((await stats()).removals === 0, '2.1.10 也没有留下一条删除记录')

// ── 2.1.9 未选中元素时的空态
await deselect()
await pause(300)
const empty = await page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  const box = p.shadowRoot.querySelector('.empty')
  return { text: box?.textContent || '', kbd: box?.querySelectorAll('kbd').length || 0, hidden: p.hidden }
})
T(/点击页面上的任意元素开始编辑/.test(empty.text)
  && /临时退出编辑态/.test(empty.text) && /取消选中/.test(empty.text) && empty.kbd === 2,
  `2.1.9 未选中时渲染空态三行文案（kbd ${empty.kbd} 个）`)

// ── 2.1.11 面板内滚轮不穿透到页面
await select('#fk1')
await page.evaluate(() => scrollTo(0, 0))
await pause(200)
const wBox = await panelBox()
const wBefore = await page.evaluate(() => ({
  page: scrollY,
  panel: document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop,
}))
await page.mouse.move(wBox.x + wBox.width / 2, wBox.y + wBox.height / 2)
await page.mouse.wheel(0, 400)
await pause(400)
const wAfter = await page.evaluate(() => ({
  page: scrollY,
  panel: document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop,
}))
T(wAfter.page === wBefore.page,
  `2.1.11 面板上滚轮不带动页面（scrollY ${wBefore.page} → ${wAfter.page}）`)
T(wAfter.panel > wBefore.panel,
  `2.1.11 滚的是面板自己（scrollTop ${wBefore.panel} → ${wAfter.panel}）`)
await page.mouse.move(wBox.x + wBox.width / 2, wBox.y + 12)
await page.mouse.wheel(0, 300)
await pause(300)
T(await page.evaluate(() => scrollY) === wBefore.page,
  '2.1.11 在非滚动区（标题栏）滚同样不穿透')

// ── 2.1.12 重渲染保留滚动位置（同一元素才保留）
const keepTop = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop)
await page.locator('#fk1').click({ force: true })   // 再点同一个元素 → setTargets → render
await pause(500)
const afterSame = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop)
T(keepTop > 0 && Math.abs(afterSame - keepTop) <= 2,
  `2.1.12 同一元素重渲染保留滚动位置（${keepTop} → ${afterSame}）`)
await select('#gk0')
const afterOther = await page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop)
T(afterOther === 0, `2.1.12 换了元素则从头看起（scrollTop = ${afterOther}）`)

// ── 2.1.7 面板固定位置，不跟着选中元素跑
await page.evaluate(() => scrollTo(0, 0))
await select('#title', { position: { x: 8, y: 8 } })   // h1 的中心被工具条盖着，点它的左上角
const atTop = await panelBox()
await select('#deepkid')
const atBottom = await panelBox()
T(Math.round(atTop.x) === Math.round(atBottom.x) && Math.round(atTop.y) === Math.round(atBottom.y),
  `2.1.7 选页首 / 页尾元素，面板都在同一处（${Math.round(atTop.x)},${Math.round(atTop.y)} / ${Math.round(atBottom.x)},${Math.round(atBottom.y)}）`)

// ── 2.1.5 关闭 ×：取消选中，但不改模式、不改位置
await page.evaluate(() => scrollTo(0, 0))
await select('#fk1')
const beforeClose = { mode: await page.evaluate(() => window.__visualRevise.mode), box: await panelBox() }
await clickIn('.close')
await pause(300)
T(await page.locator('visual-revise-panel').isHidden(), '2.1.5 点 × 收起面板')
T(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0,
  '2.1.5 同时取消选中（vr-close → engine.unselect_all）')
T(await page.evaluate(() => window.__visualRevise.mode) === beforeClose.mode,
  `2.1.5 × 不改变当前模式（${beforeClose.mode}）`)
await select('#fk1')
const afterClose = await panelBox()
T(Math.round(afterClose.x) === Math.round(beforeClose.box.x)
  && Math.round(afterClose.y) === Math.round(beforeClose.box.y),
  '2.1.5 × 也不改变面板位置（重新选中后回到原处）')

// ── 2.1.6 拖动头部移动面板 + 位置记忆
await clearStored()
await select('#fk1')
const home = await panelBox()
const dragHeader = async (toX, toY) => {
  const b = await panelBox()
  await page.mouse.move(b.x + 40, b.y + 12)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps: 10 })
  await page.mouse.up()
  await pause(300)
}
await dragHeader(420, 60)   // 抓点在 (+40,+12)，落点即 (380, 48)；纵向仍在夹取范围内
const moved = await panelBox()
T(Math.abs(moved.x - 380) < 3 && Math.abs(moved.y - 48) < 3,
  `2.1.6 拖标题栏能移动面板（${Math.round(moved.x)},${Math.round(moved.y)}）`)
T(moved.x !== home.x || moved.y !== home.y, '2.1.6 面板确实离开了默认位置')
const saved = await storedPos()
T(saved && Math.abs(saved.left - moved.x) < 2 && Math.abs(saved.top - moved.y) < 2,
  `2.1.6 松手时落盘到 localStorage['visual-revise:panel-pos']（${JSON.stringify(saved)}）`)

// 按在 <button> 上不触发拖动
const btnBox = await P('.fold').boundingBox()
const beforeBtnDrag = await panelBox()
await page.mouse.move(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2)
await page.mouse.down()
await page.mouse.move(btnBox.x + 160, btnBox.y + 140, { steps: 8 })
await page.mouse.up()
await pause(300)
const afterBtnDrag = await panelBox()
T(Math.round(afterBtnDrag.x) === Math.round(beforeBtnDrag.x)
  && Math.round(afterBtnDrag.y) === Math.round(beforeBtnDrag.y),
  '2.1.6 按在标题栏按钮上拖不会移动面板')
if (await page.evaluate(() => document.querySelector('visual-revise-panel').hasAttribute('collapsed')))
  await clickIn('.fold')

// moveTo 把面板夹在视口内
await dragHeader(3000, 3000)
const clamped = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-panel').getBoundingClientRect()
  return { right: r.right, bottom: r.bottom,
    vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight }
})
T(clamped.right <= clamped.vw - 7 && clamped.bottom <= clamped.vh - 7,
  `2.1.6 拖出视口时被夹回来（right ${Math.round(clamped.right)} / ${clamped.vw}，bottom ${Math.round(clamped.bottom)} / ${clamped.vh}）`)

// 记忆：重选 / 关开 / 刷新
await dragHeader(360, 60)
const parked = await panelBox()
await select('#gk1')
const afterReselect = await panelBox()
T(Math.round(afterReselect.x) === Math.round(parked.x)
  && Math.round(afterReselect.y) === Math.round(parked.y),
  `2.1.6 换选元素后仍停在拖过的位置（${Math.round(afterReselect.x)},${Math.round(afterReselect.y)}）`)

await clickIn('.close')
await pause(250)
await select('#fk1')
const afterReopen = await panelBox()
T(Math.round(afterReopen.x) === Math.round(parked.x)
  && Math.round(afterReopen.y) === Math.round(parked.y),
  `2.1.6 关掉再打开仍停在原位（${Math.round(afterReopen.x)},${Math.round(afterReopen.y)}）`)

await page.reload()
await injectVisBug(page, origin)
await pause(400)
await select('#fk1')
const afterReload = await panelBox()
T(Math.round(afterReload.x) === Math.round(parked.x)
  && Math.round(afterReload.y) === Math.round(parked.y),
  `2.1.6 刷新后按 localStorage 恢复位置（${Math.round(afterReload.x)},${Math.round(afterReload.y)}）`)

// ── 2.1.8 窗口 resize 时重新夹取位置
// 展开态的面板本来就占满视口高度，纵向没有可夹的余量；先折叠成一条矮标题栏
await clickIn('.fold')
await dragHeader(600, 700)
const beforeResize = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-panel').getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, height: r.height }
})
T(beforeResize.bottom > 420,
  `2.1.8 先把面板拖到视口下方（bottom = ${Math.round(beforeResize.bottom)}）`)
await page.setViewportSize({ width: 1440, height: 420 })
await pause(500)
const afterResize = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-panel').getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, vh: document.documentElement.clientHeight }
})
T(afterResize.top < beforeResize.top && afterResize.bottom <= afterResize.vh - 7,
  `2.1.8 窗口变矮后重新夹取，面板整块回到视口内（top ${Math.round(beforeResize.top)} → ${Math.round(afterResize.top)}，bottom ${Math.round(afterResize.bottom)} ≤ ${afterResize.vh}）`)
await page.setViewportSize({ width: 1440, height: 900 })
await pause(400)
await clickIn('.fold')

// 收拾：清掉位置记忆，回到默认摆位，后面的用例才点得到页面元素
await clearStored()
await page.reload()
await injectVisBug(page, origin)
await pause(400)

// ══════════════════════════════════════════════════════════════
// §2.2 tab 切换
// ══════════════════════════════════════════════════════════════
console.log('\n── §2.2 tab 切换')

await select('#deepkid')
await page.evaluate(() => {
  window.__vrTabs = []
  document.querySelector('visual-revise-panel')
    .addEventListener('vr-tab', e => window.__vrTabs.push(e.detail.tab))
})

// ── 2.2.1 两个 tab、点击切换、派发 vr-tab
const tabLabels = await P('.tabs .tab').allTextContents()
T(tabLabels.map(s => s.trim()).join('|') === '选择元素|结构',
  `2.2.1 两个 tab：${tabLabels.map(s => s.trim()).join(' / ')}`)
T(await P('.tab[data-tab="props"]').getAttribute('data-on') !== null,
  '2.2.1 默认停在「选择元素」tab')
await clickIn('.tab[data-tab="structure"]')
T(await P('.tab[data-tab="structure"]').getAttribute('data-on') !== null
  && await P('.tab[data-tab="props"]').getAttribute('data-on') === null,
  '2.2.1 点「结构」→ 高亮转移')
T(await P('.structure').isVisible() && !(await P('.scroll').isVisible()),
  '2.2.1 结构 tab 下显示结构树、收起属性列表')
T((await page.evaluate(() => window.__vrTabs)).join(',') === 'structure',
  '2.2.1 切换时派发 vr-tab 事件（detail.tab = structure）')
await clickIn('.tab[data-tab="structure"]')
T((await page.evaluate(() => window.__vrTabs)).join(',') === 'structure',
  '2.2.1 点当前 tab 不重复派发')

// ── 2.2.2 切到 structure 时补滚到选中行
const reveal = await page.evaluate(() => {
  const tree = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  const list = tree.querySelector('.list')
  const row = tree.querySelector('.row[data-selected]')
  if (!row) return null
  const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect()
  return {
    scrollTop: list.scrollTop,
    scrollHeight: list.scrollHeight,
    clientHeight: list.clientHeight,
    inView: rr.top >= lr.top - 1 && rr.bottom <= lr.bottom + 1,
  }
})
T(!!reveal && reveal.scrollHeight > reveal.clientHeight && reveal.scrollTop > 0,
  `2.2.2 树本身可滚且已滚动（scrollTop = ${reveal?.scrollTop}）`)
T(!!reveal && reveal.inView, '2.2.2 选中行被补滚进可视区')

// ── 2.2.3 快捷键 A / F
await page.locator('#fk1').click({ force: true })
await pause(400)
await page.keyboard.press('f')
await pause(400)
T(await page.evaluate(() => document.querySelector('visual-revise-panel').tab) === 'structure',
  '2.2.3 按 F → 面板切到「结构」tab')
await page.keyboard.press('a')
await pause(400)
T(await page.evaluate(() => document.querySelector('visual-revise-panel').tab) === 'props',
  '2.2.3 按 A → 面板切回「选择元素」tab')
T(await page.evaluate(() => window.__visualRevise.mode) === 'select',
  '2.2.3 A / F 同时保证处在选择模式')

// ── 2.2.4 页面直接拖拽在整个选择模式下都开着，不随 tab 开关
const order = () => page.evaluate(() =>
  [...document.getElementById('flexrow').children].map(n => n.id).join(','))
// 把最后一个孩子拖到第一个孩子的左三分之一 = 插到最前，两轮都必然换位
const dragLastToFront = async () => {
  const before = await order()
  const ids = before.split(',')
  await page.locator(`#${ids[ids.length - 1]}`).click({ force: true })
  await pause(350)
  const src = await page.locator(`#${ids[ids.length - 1]}`).boundingBox()
  const dst = await page.locator(`#${ids[0]}`).boundingBox()
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
  await page.mouse.down()
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 - 12, { steps: 4 })
  await page.mouse.move(dst.x + 6, dst.y + dst.height / 2, { steps: 8 })
  await pause(150)
  await page.mouse.up()
  await pause(500)
  return { before, after: await order(), moves: (await stats()).moves }
}
await page.keyboard.press('a'); await pause(300)
const dragProps = await dragLastToFront()
T(dragProps.after === 'fk2,fk0,fk1' && dragProps.moves === 1,
  `2.2.4 属性 tab 下页面拖拽照常生效（${dragProps.before} → ${dragProps.after}，moves ${dragProps.moves}）`)
await page.keyboard.press('f'); await pause(400)
T(await page.evaluate(() => document.querySelector('visual-revise-panel').tab) === 'structure',
  '2.2.4 切到结构 tab')
const dragStruct = await dragLastToFront()
T(dragStruct.after === 'fk1,fk2,fk0' && dragStruct.moves === 2,
  `2.2.4 结构 tab 下页面拖拽同样生效（${dragStruct.before} → ${dragStruct.after}，moves ${dragStruct.moves}）`)
await page.keyboard.press('a'); await pause(300)

// 拖拽把 DOM 顺序改了，后面的用例按 id 找元素，先复位
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await pause(300)
await page.reload()
await injectVisBug(page, origin)
await pause(400)

// ══════════════════════════════════════════════════════════════
// §2.3 「选择元素」tab — 分区通用行为
// ══════════════════════════════════════════════════════════════
console.log('\n── §2.3 分区通用行为')

const readGroups = () => page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot.querySelectorAll('section[data-group]')]
    .map(s => s.dataset.group))

// ── 2.3.2 Typography 与 Effects 默认折叠
// 必须排在「选中文字元素」之前：#folded 是面板级的一份状态，选过一次文字元素
// 之后 typography 就被永久摘出去了。纯容器上 Typography 整块不渲染，
// 要看到「渲染了但默认折叠」得站在内联 svg 上（#showTypography 放行它，
// 而它不是文字元素，不触发自动展开）
await select('#svgbox')
T(await sect('typography').count() === 1
  && await sect('typography').getAttribute('folded') !== null,
  '2.3.2 Typography 渲染出来时默认是折叠的（内联 svg）')
T(await sect('effects').getAttribute('folded') !== null, '2.3.2 Effects 默认折叠')
T(await sect('position').getAttribute('folded') === null
  && await sect('fill').getAttribute('folded') === null,
  '2.3.2 其余分区默认展开')

// ── 分区顺序（清单 §2.3 开头声明的固定顺序）。七组齐全要站在文字元素上：
// 纯容器上 Typography 整块不渲染（#showTypography）
await select('#para')
const groupIds = await readGroups()
T(groupIds.join(',') === 'position,layout,appearance,typography,fill,stroke,effects',
  `2.3.1 七个分区固定顺序：${groupIds.join(' → ')}`)

await select('#svgbox')
T(await sect('typography').getAttribute('folded') === null,
  '2.3.2 选过一次文字元素后，Typography 的折叠状态是面板级的，不会随元素重新折回')

await select('#blockbox', { position: { x: 4, y: 4 } })
const containerGroups = await readGroups()
T(containerGroups.join(',') === 'position,layout,appearance,fill,stroke,effects',
  `2.3.1 纯容器上顺序不变，只是少了 Typography：${containerGroups.join(' → ')}`)

// ── 2.3.1 点分区标题折叠 / 展开
await sect('position').locator('h3 .title').click(); await pause(250)
T(await sect('position').getAttribute('folded') !== null, '2.3.1 点标题 → 分区折叠')
T(!(await sect('position').locator('.rows').isVisible()), '2.3.1 折叠后字段区隐藏')
await sect('position').locator('h3 .title').click(); await pause(250)
T(await sect('position').getAttribute('folded') === null, '2.3.1 再点一下 → 展开')

// ── 2.3.3 选中文字元素时 Typography 自动展开
await select('#para')
T(await sect('typography').getAttribute('folded') === null,
  '2.3.3 选中文字元素时 Typography 自动展开')
await sect('typography').locator('h3 .title').click(); await pause(250)
T(await sect('typography').getAttribute('folded') !== null, '2.3.3 用户可以手动把它折回去')
await chooseSelect('position', 'relative')   // RERENDER_ON，整块重绘
T(await sect('typography').getAttribute('folded') !== null,
  '2.3.3 同一元素重绘不会把手动折叠弹开')
await select('#blockbox', { position: { x: 4, y: 4 } })
await select('#para')
T(await sect('typography').getAttribute('folded') === null,
  '2.3.3 换个元素再选回来，自动展开重新生效')

// ── 2.3.6 分区级「临时关闭本组」眼睛在当前 UI 里不渲染
const eyes = await page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot.querySelectorAll('section h3 [data-eye]')]
    .map(b => b.dataset.eye))
T(eyes.length === 0,
  `2.3.6 HIDEABLE 三组都是层列表分区，标题级眼睛一个都不渲染（找到 ${eyes.length} 个）`)

// ── 2.3.7 hideMapFor：fill 分区对 [文字] 元素额外关掉 color
// 它只被 #toggleSection 调用，而 #toggleSection 的唯一入口就是上面那个
// 「当前 UI 里不渲染」的分区级眼睛 —— 没有任何真实交互能触达，故标 not_testable
console.log('  · 2.3.7 hideMapFor 只被 #toggleSection 调用，而后者唯一入口（分区级眼睛）不渲染 → not_testable')

// ── 2.3.8 绑定变量按钮只在 fill / stroke 出现
await select('#blockbox', { position: { x: 4, y: 4 } })
const varBtns = await page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot.querySelectorAll('[data-var]')]
    .map(b => b.dataset.var))
T(varBtns.includes('fill') && varBtns.includes('stroke') && !varBtns.includes('effects'),
  `2.3.8 变量按钮出现在 ${varBtns.join(' / ')}，Effects 没有`)

// 容器：绑到 background-color
await clickIn('.var-btn[data-var="fill"]')
await pause(350)
T(await page.locator('#visual-revise-fill-panel [data-item="--vr-brand"]').count() > 0,
  '2.3.8 容器上点 fill 变量按钮 → 打开填充弹层的变量页')
await page.locator('#visual-revise-fill-panel [data-item="--vr-brand"]').click()
await pause(450)
T(await inline('#blockbox', 'background-color') === 'var(--vr-brand)',
  `2.3.8 容器（非文字）绑到 background-color（${await inline('#blockbox', 'background-color')}）`)
T(await inline('#blockbox', 'color') === '',
  '2.3.8 容器上不会去动 color（那一行根本没渲染）')

// 文字元素：绑到 color
await select('#para')
await clickIn('.var-btn[data-var="fill"]')
await pause(300)
T(await page.locator('#visual-revise-color-panel [data-item="--vr-ink"]').count() > 0,
  '2.3.8 文字元素上打开的是颜色弹层的变量页')
await page.locator('#visual-revise-color-panel [data-item="--vr-ink"]').click()
await pause(450)
T(await inline('#para', 'color') === 'var(--vr-ink)',
  `2.3.8 [文字] 元素绑到 color（${await inline('#para', 'color')}）`)
T(await inline('#para', 'background-color') === '',
  '2.3.8 [文字] 元素上不会误绑 background-color')

// stroke：绑到 border-color（空描边时先把描边立起来）
await select('#nostroke')
await clickIn('.var-btn[data-var="stroke"]')
await pause(350)
T(await page.locator('#visual-revise-color-panel [data-item="--vr-brand"]').count() > 0,
  '2.3.8 stroke 变量按钮打开颜色弹层的变量页')
await page.locator('#visual-revise-color-panel [data-item="--vr-brand"]').click()
await pause(450)
T(await inline('#nostroke', 'border-color') === 'var(--vr-brand)',
  `2.3.8 stroke 绑到 border-color（${await inline('#nostroke', 'border-color')}）`)

// ── 2.3.9 加号只在 fill / stroke / effects 出现
await select('#barebox', { position: { x: 4, y: 4 } })
const addBtns = await page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot.querySelectorAll('[data-add]')]
    .map(b => b.dataset.add))
T(addBtns.sort().join(',') === 'effects,fill,stroke',
  `2.3.9 加号只在 ${addBtns.join(' / ')} 三个分区`)

// ── 2.3.12 fill / stroke / effects 空状态也渲染（标题 + 加号）
for (const id of ['fill', 'stroke', 'effects']) {
  T(await sect(id).count() === 1 && await sect(id).locator(`[data-add="${id}"]`).count() === 1,
    `2.3.12 ${id} 分区空状态仍渲染标题与加号`)
}

// fill 加号 → 一层纯色 #c4c4c4
T(await inline('#barebox', 'background-color') === '', '2.3.9 加填充前 barebox 没有 inline 背景')
await clickIn('.add[data-add="fill"]')
const bareFill = await inline('#barebox', 'background-color')
T(/#c4c4c4|rgb\(196,\s*196,\s*196\)/i.test(bareFill),
  `2.3.9 fill 加号 → 加一层纯色 #c4c4c4（${bareFill}）`)

// stroke 加号 → border-style:solid + border-width:1px，不碰 border-color
await clickIn('.add[data-add="stroke"]')
const strokeStyle = await inline('#barebox', 'border-style')
const strokeWidth = await inline('#barebox', 'border-width')
const strokeColor = await inline('#barebox', 'border-color')
T(strokeStyle === 'solid' && strokeWidth === '1px',
  `2.3.9 stroke 加号 → border-style:${strokeStyle} / border-width:${strokeWidth}`)
T(strokeColor === '', '2.3.9 stroke 加号不碰 border-color（留给 currentColor）')

// effects 加号 → 先弹类型菜单
await clickIn('.add[data-add="effects"]')
const fxItems = await page.locator('#visual-revise-menu [data-item]').allTextContents()
T(fxItems.length >= 5,
  `2.3.9 effects 加号先弹类型菜单（${fxItems.length} 项：${fxItems.map(s => s.trim()).join(' / ')}）`)
await page.keyboard.press('Escape'); await pause(250)

// ── 2.3.11 stroke 已有描边时加号 disabled，title 变文案
T(await sect('stroke').locator('[data-add="stroke"]').isDisabled(),
  '2.3.11 已经有描边后 stroke 加号 disabled')
T(await sect('stroke').locator('[data-add="stroke"]').getAttribute('title')
  === 'CSS 的 border 只有一层，不能再加',
  '2.3.11 disabled 时 title 说明「CSS 的 border 只有一层，不能再加」')
await select('#nostroke')
await select('#barekid')
T(!(await sect('stroke').locator('[data-add="stroke"]').isDisabled())
  && await sect('stroke').locator('[data-add="stroke"]').getAttribute('title') === '添加描边',
  '2.3.11 没有描边的元素上加号可用、title 为「添加描边」')

// ── 2.3.10 在收起的分区上点加号会自动展开
await select('#barekid')
await sect('fill').locator('h3 .title').click(); await pause(250)
T(await sect('fill').getAttribute('folded') !== null, '2.3.10 先把 Fill 分区收起来')
await clickIn('.add[data-add="fill"]')
T(await sect('fill').getAttribute('folded') === null,
  '2.3.10 在收起的分区上点加号 → 自动展开')

// ── 2.3.13 改过的字段标签变「已改」色
await select('#relbox')
T(await P('label.name[data-prop="left,top"][data-dirty]').count() === 0,
  '2.3.13 未改动时「位置」标签没有 data-dirty')
await write('left', '24')
T(await P('label.name[data-prop="left,top"][data-dirty]').count() === 1,
  '2.3.13 改过 left 之后「位置」标签带上 data-dirty')

// ── 2.3.5 重置本组 ↺：只在该组真的改过时出现
await select('#gk1')
T(await sect('position').getAttribute('data-dirty') === null
  && !(await sect('position').locator('[data-undo="position"]').isVisible()),
  '2.3.5 未改动的分区上「重置本组」不可见')
await write('rotate', '30')
T(await sect('position').getAttribute('data-dirty') !== null
  && await sect('position').locator('[data-undo="position"]').isVisible(),
  '2.3.5 该组改过之后「重置本组」出现')
await sect('position').locator('[data-undo="position"]').click(); await pause(400)
T(await inline('#gk1', 'rotate') === '',
  `2.3.5 点 ↺ 把本组的改动清掉（rotate = 「${await inline('#gk1', 'rotate')}」）`)
T(/已重置 Position/.test((await toastText()) || ''),
  `2.3.5 toast 报出「已重置 Position」（${await toastText()}）`)
T(await sect('position').getAttribute('data-dirty') === null,
  '2.3.5 重置后本组的脏标记消失')

// ── 2.3.4 标题栏按钮上的 click 不冒泡到 h3
await select('#gk1')
await write('rotate', '20')
T(await sect('position').getAttribute('folded') === null, '2.3.4 点按钮之前 Position 是展开的')
await sect('position').locator('[data-undo="position"]').click(); await pause(350)
T(await sect('position').getAttribute('folded') === null,
  '2.3.4 点「重置本组」不会顺带把分区折叠掉')
await clickIn('.var-btn[data-var="fill"]')
await page.keyboard.press('Escape'); await pause(250)
T(await sect('fill').getAttribute('folded') === null,
  '2.3.4 点标题栏的变量按钮同样不折叠分区')

// ══════════════════════════════════════════════════════════════
// §2.4 分区 1：Position
// ══════════════════════════════════════════════════════════════
console.log('\n── §2.4 Position')

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await pause(300)
await select('#bk0')

// ── 2.4.1 定位下拉：五个选项 + 改它整块重绘
const posOptions = await page.evaluate(() =>
  JSON.parse(document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('vr-select[data-prop="position"]').getAttribute('options')))
T(['static', 'relative', 'absolute', 'fixed', 'sticky'].every(v => posOptions.includes(v)),
  `2.4.1 定位下拉给出 static / relative / absolute / fixed / sticky（${posOptions.join(',')}）`)
T(await P('input[data-prop="left"]').count() === 0
  && await P('input[data-prop="z-index"]').count() === 0,
  '2.4.1 static 时 X / Y / 层级不渲染')
await chooseSelect('position', 'relative')
T(await inline('#bk0', 'position') === 'relative',
  `2.4.1 选 relative 写入 position（${await inline('#bk0', 'position')}）`)
T(await P('input[data-prop="left"]').count() === 1
  && await P('input[data-prop="z-index"]').count() === 1,
  '2.4.1 改 position 触发整块重绘，X / Y / 层级立刻出现（不用重新选中）')

// ── 2.4.2 / 2.4.3 位置 X / Y
T(await P('label.name[data-prop="left,top"]').count() === 1
  && (await P('label.name[data-prop="left,top"]').textContent()).trim() === '位置',
  '2.4.3 X / Y 共用一个「位置」标签（LABELED_PAIRS）')
const prefixes = await page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot
    .querySelectorAll('.pair .control .prefix[data-prop]')]
    .filter(s => ['left', 'top'].includes(s.dataset.prop))
    .map(s => `${s.dataset.prop}:${s.textContent.trim()}`))
T(prefixes.join(',') === 'left:X,top:Y',
  `2.4.2/2.4.3 两个框的前缀分别是 X / Y（${prefixes.join(' ')}）`)
T(await P('.prefix[data-drag][data-prop="left"]').count() === 1,
  '2.4.2 X 前缀带 data-drag（可横向拖调值）')

await write('left', '33')
T(await inline('#bk0', 'left') === '33px', `2.4.2 裸数字补 px（left = ${await inline('#bk0', 'left')}）`)
await write('top', '44')
T(await inline('#bk0', 'top') === '44px', `2.4.3 位置 Y 写 top（top = ${await inline('#bk0', 'top')}）`)
await write('left', '1rem')
T(await inline('#bk0', 'left') === '1rem', `2.4.2 1rem 原样保留（${await inline('#bk0', 'left')}）`)
await write('left', '50%')
T(await inline('#bk0', 'left') === '50%', `2.4.2 50% 原样保留（${await inline('#bk0', 'left')}）`)
await write('left', 'auto')
T(await inline('#bk0', 'left') === 'auto', `2.4.2 auto 原样保留（${await inline('#bk0', 'left')}）`)
await write('left', '33')

// ── 2.4.4 旋转
T((await P('.pair .field label.name[data-prop="rotate"]').textContent()).trim() === '旋转',
  '2.4.4 旋转字段标签为「旋转」')
const rotPrefix = await prefixOf('rotate')
T(rotPrefix === '∠', `2.4.4 旋转前缀是 ∠（${rotPrefix}）`)
await write('rotate', '45')
T(await inline('#bk0', 'rotate') === '45deg', `2.4.4 裸数字补 deg（${await inline('#bk0', 'rotate')}）`)
await write('rotate', 'none')
T(await inline('#bk0', 'rotate') === '', '2.4.4 none → 清掉声明，不留空改动')
await write('rotate', '45')
await write('rotate', '0')
T(await inline('#bk0', 'rotate') === '', '2.4.4 0 也视为「没有旋转」，清掉声明')
await write('rotate', '0.5turn')
T(await inline('#bk0', 'rotate') === '0.5turn',
  `2.4.4 带单位的写法原样保留（${await inline('#bk0', 'rotate')}）`)
await write('rotate', 'none')

// ── 2.4.5 层级
T((await P('label.name[data-prop="z-index"]').textContent()).trim() === '层级',
  '2.4.5 层级字段标签为「层级」')
const zPrefix = await prefixOf('z-index')
T(zPrefix === 'Z', `2.4.5 层级前缀是 Z（${zPrefix}）`)
await write('z-index', '5')
T(await inline('#bk0', 'z-index') === '5',
  `2.4.5 层级不补单位（UNITLESS）：${await inline('#bk0', 'z-index')}`)

// ── 2.4.7 ArrowUp / Down 步进 ±1，shift ×10
const leftInput = P('input[data-prop="left"]').first()
await leftInput.scrollIntoViewIfNeeded(); await leftInput.click(); await pause(150)
await leftInput.press('ArrowUp'); await pause(250)
T(await inline('#bk0', 'left') === '34px', `2.4.7 ↑ 步进 +1（${await inline('#bk0', 'left')}）`)
await leftInput.press('ArrowDown'); await leftInput.press('ArrowDown'); await pause(300)
T(await inline('#bk0', 'left') === '32px', `2.4.7 ↓ 步进 -1（${await inline('#bk0', 'left')}）`)
await leftInput.press('Shift+ArrowUp'); await pause(250)
T(await inline('#bk0', 'left') === '42px', `2.4.7 shift + ↑ 步进 +10（${await inline('#bk0', 'left')}）`)
await leftInput.press('Shift+ArrowDown'); await pause(250)
T(await inline('#bk0', 'left') === '32px', `2.4.7 shift + ↓ 步进 -10（${await inline('#bk0', 'left')}）`)

// ── 2.4.8 拖前缀 / 拖标签调值：每 2px 一步
const dragBy = async (locator, dx) => {
  const b = await locator.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 6 })
  await page.mouse.up()
  await pause(300)
}
await dragBy(P('.prefix[data-drag][data-prop="left"]').first(), 20)
T(await inline('#bk0', 'left') === '42px',
  `2.4.8 拖 X 前缀右移 20px → +10（每 2px 一步）：${await inline('#bk0', 'left')}`)
await dragBy(P('.prefix[data-drag][data-prop="left"]').first(), -16)
T(await inline('#bk0', 'left') === '34px',
  `2.4.8 反向拖 16px → -8：${await inline('#bk0', 'left')}`)

// X 前缀离面板左缘只有 21px，把数值往小里调很容易就拖出了面板。
// 指针被 handle 捕获，数值算得没问题；但松手那一下的 click 仍按坐标命中页面，
// 选中被换掉，用户手上正在改的元素当场丢失
await dragBy(P('.prefix[data-drag][data-prop="left"]').first(), -40)
T(await inline('#bk0', 'left') === '14px',
  `2.4.8 拖出面板边界时数值照常算（${await inline('#bk0', 'left')}）`)
const keptTarget = await page.evaluate(() => window.__visualRevise.panel.target?.id ?? '(空)')
T(keptTarget === 'bk0',
  `2.4.8 拖到面板外松手不该换掉选中（现在选中的是 #${keptTarget}）`)

await select('#bk0')
await write('rotate', '45')
// 先把焦点挪出旋转框：聚焦中的字段不会被 #syncValues 回填，框里留着用户
// 敲的裸数字「45」，拖拽就从那个没有单位的字符串起步
await P('input[data-prop="z-index"]').first().click(); await pause(200)
await dragBy(P('label.name[data-drag][data-prop="rotate"]').first(), 20)
T(await inline('#bk0', 'rotate') === '55deg',
  `2.4.8 拖「旋转」标签同样调值，且保留原单位：${await inline('#bk0', 'rotate')}`)

// 刚敲完裸数字、焦点还在框里就直接拖标签：框里是「55」没有单位，
// stepValue 按长度补了 px，rotate: 55px 被 CSSOM 丢弃 → 元素纹丝不动
await write('rotate', '45')
await dragBy(P('label.name[data-drag][data-prop="rotate"]').first(), 20)
const rotAfterTyped = await inline('#bk0', 'rotate')
const rotFieldTyped = await P('input[data-prop="rotate"]').first().inputValue()
T(rotAfterTyped === '55deg',
  `2.4.8 刚输入裸数字后直接拖标签，写出的仍应是合法角度（元素 = ${rotAfterTyped}，框里 = ${rotFieldTyped}）`)
await write('rotate', 'none')

// ── 2.4.9 无法步进的关键字
await select('#relbox')
const relZ = P('input[data-prop="z-index"]').first()
await relZ.scrollIntoViewIfNeeded(); await relZ.click(); await pause(150)
T(await relZ.inputValue() === 'auto', `2.4.9 未设层级时框里就是关键字 auto（${await relZ.inputValue()}）`)
await relZ.press('ArrowUp'); await pause(300)
T(await inline('#relbox', 'z-index') === '' && await relZ.inputValue() === 'auto',
  '2.4.9 auto 无法步进 → 该次按键被忽略，不写垃圾值')
const relRot = P('input[data-prop="rotate"]').first()
await relRot.scrollIntoViewIfNeeded(); await relRot.click(); await pause(150)
await relRot.press('ArrowUp'); await pause(300)
T(await inline('#relbox', 'rotate') === '0deg',
  `2.4.9 rotate 有明确落点 0deg（${await inline('#relbox', 'rotate')}）`)
// #bk0 被前面几条挪出去了（left/top），它现在正压在 #para 上；先整体撤销
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await pause(350)
await select('#para')
await unfold('typography')
const lh = P('input[data-prop="line-height"]').first()
await lh.scrollIntoViewIfNeeded(); await lh.click(); await pause(150)
await lh.press('ArrowUp'); await pause(300)
T(await inline('#para', 'line-height') === '1.5',
  `2.4.9 line-height 从 normal 落到 1.5（${await inline('#para', 'line-height')}）`)

// ── 2.4.6 对齐按钮组
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await pause(300)

await select('#bk0')
T(await P('.align').count() === 0,
  '2.4.6 父级是普通 block 时不给对齐按钮组')

await select('#fk1')
T(await P('.align').count() === 1 && await P('.align button[data-align]').count() === 6,
  `2.4.6 父级是 flex 时出现 6 个对齐按钮（${await P('.align button[data-align]').count()} 个）`)
const alignKeys = await page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot.querySelectorAll('.align button[data-align]')]
    .map(b => b.dataset.align))
T(alignKeys.join(',') === 'h:start,h:center,h:end,v:start,v:center,v:end',
  `2.4.6 六个按钮 = 左/水平中/右 · 顶/垂直中/底（${alignKeys.join(' ')}）`)

// flex 横向：h 是主轴 → auto 外边距
await clickIn('.align button[data-align="h:end"]')
T(await inline('#fk1', 'margin-left') === 'auto' && await inline('#fk1', 'margin-right') === '',
  `2.4.6 flex 主轴右对齐 → margin-left:auto（${await inlineAll('#fk1')}）`)
await clickIn('.align button[data-align="h:center"]')
T(await inline('#fk1', 'margin-left') === 'auto' && await inline('#fk1', 'margin-right') === 'auto',
  '2.4.6 flex 主轴居中 → 两侧都是 auto 外边距')
await clickIn('.align button[data-align="h:start"]')
T(await inline('#fk1', 'margin-left') === '' && await inline('#fk1', 'margin-right') === 'auto',
  '2.4.6 flex 主轴左对齐 → margin-right:auto')
// flex 横向：v 是交叉轴 → align-self
await clickIn('.align button[data-align="v:center"]')
T(await inline('#fk1', 'align-self') === 'center',
  `2.4.6 flex 交叉轴居中 → align-self:center（${await inline('#fk1', 'align-self')}）`)
await clickIn('.align button[data-align="v:end"]')
T(await inline('#fk1', 'align-self') === 'flex-end',
  `2.4.6 flex 交叉轴底对齐 → align-self:flex-end（${await inline('#fk1', 'align-self')}）`)

// flex 纵向：主轴与交叉轴对调
await select('#ck0')
await clickIn('.align button[data-align="h:center"]')
T(await inline('#ck0', 'align-self') === 'center',
  `2.4.6 纵向 flex 里水平居中走交叉轴 align-self（${await inline('#ck0', 'align-self')}）`)
await clickIn('.align button[data-align="v:start"]')
T(await inline('#ck0', 'margin-top') === '' && await inline('#ck0', 'margin-bottom') === 'auto',
  `2.4.6 纵向 flex 里顶对齐走主轴 auto 外边距（${await inlineAll('#ck0')}）`)

// grid：走 *-self
await select('#gk0')
await clickIn('.align button[data-align="h:start"]')
T(await inline('#gk0', 'justify-self') === 'start',
  `2.4.6 grid 子项水平对齐走 justify-self（${await inline('#gk0', 'justify-self')}）`)
await clickIn('.align button[data-align="v:end"]')
T(await inline('#gk0', 'align-self') === 'end',
  `2.4.6 grid 子项垂直对齐走 align-self（${await inline('#gk0', 'align-self')}）`)
T(await inline('#gk0', 'margin-left') === '' && await inline('#gk0', 'margin-top') === '',
  '2.4.6 grid 分支不写 auto 外边距')

console.log(`\n通过 ${passed} / 失败 ${failed}\n`)

await browser.close()
await close()
process.exit(failed ? 1 : 0)
