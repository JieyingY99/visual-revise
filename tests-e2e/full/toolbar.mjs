// 全量 e2e · 分块「工具条」：docs/plans/feature-inventory.md §1（1.0–1.8）逐条覆盖。
//
// 断言以清单编号开头。全部走真实交互（locator.click / page.mouse / page.keyboard），
// 落点是真实结果：宿主属性、inline style、ChangeStore、剪贴板、shadow DOM 的实际几何。
//
// 关键约定：
//  · 工具条 shadow 是 open，Playwright 的 `visual-revise-toolbar .x` 能穿透；
//    <vis-bug> 的 shadow 是 closed（smoke.mjs 已断言），所以 §1.8 只能靠真实鼠标坐标点。
//  · toast 挂在 body 上（不是工具条 shadow 里），id = visual-revise-toast。
//  · 「有没有再 toast 一次」用探针法：先把 toast 文案清空，再做动作，看它有没有被重新写上。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serve, launch, injectVisBug, ok, ROOT } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

let passed = 0, failed = 0
const T = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

const consoleLog = []
page.on('console', m => consoleLog.push(`${m.type()}::${m.text()}`))

console.log('\n[全量 · 工具条] feature-inventory §1（1.0–1.8）\n')

await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(600)

// ── helpers ──────────────────────────────────────────────────────────
const UI_TAGS = 'visbug-handles, visbug-label, visbug-hover, visbug-grip, visbug-metatip, visbug-ally, visbug-corners, visbug-gridlines, visbug-distance'

const bar  = sel => page.locator(`visual-revise-toolbar ${sel}`)
const P    = sel => page.locator(`visual-revise-panel ${sel}`)
const mode = () => page.evaluate(() => window.__visualRevise.mode)
const depth = () => page.evaluate(() => window.__visualRevise.store.history.depth)
const total = () => page.evaluate(() => window.__visualRevise.store.stats().total)
const blur  = () => page.evaluate(() => document.activeElement?.blur?.())
const wait  = ms => page.waitForTimeout(ms)

const toast = () => page.evaluate(() => {
  const el = document.getElementById('visual-revise-toast')
  return el ? { text: el.textContent, opacity: el.style.opacity, color: el.style.color } : null
})
// 探针：把 toast 文案清掉，之后如果它又有字，就说明确实又 toast 了一次
const armToast = () => page.evaluate(() => {
  const el = document.getElementById('visual-revise-toast')
  if (el) { el.textContent = '' ; el.style.opacity = '0' }
})

const host = () => page.evaluate(() => {
  const el = document.querySelector('visual-revise-toolbar')
  return {
    vertical: el.hasAttribute('vertical'),
    left: el.style.left, top: el.style.top, transform: el.style.transform,
    hidden: el.hidden,
  }
})

const thumb = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const t = sr.querySelector('.thumb')
  const onBtn = sr.querySelector('button[data-mode][data-on]')
  return { transform: t.style.transform, width: t.style.width, height: t.style.height,
           on: onBtn?.dataset.mode || null }
})

const tipState = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const tip = sr.querySelector('.tip')
  const r = tip.getBoundingClientRect()
  return {
    hidden: tip.hidden,
    label: tip.querySelector('.tip-label').textContent,
    key: tip.querySelector('.tip-key').textContent,
    left: tip.style.left, top: tip.style.top,
    arrowX: tip.style.getPropertyValue('--arrow-x'),
    arrowY: tip.style.getPropertyValue('--arrow-y'),
    box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
  }
})

const btnBox = sel => page.evaluate(s => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const r = sr.querySelector(s).getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}, sel)

const overlays = () => page.evaluate(sel => {
  const els = [...document.querySelectorAll(sel)]
  return {
    count: els.length,
    visible: els.filter(e => getComputedStyle(e).display !== 'none').length,
    inlineNone: els.filter(e => e.style.display === 'none').length,
  }
}, UI_TAGS)

// 未选中元素时面板渲染的是空态，压根没有 tabs 那一行——此时只能读组件自己记着的 tab
const panelTab = () => page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  if (!p) return null
  return p.shadowRoot?.querySelector('.tab[data-on]')?.dataset.tab ?? p.tab ?? null
})
const panelHidden = () => page.evaluate(() =>
  document.querySelector('visual-revise-panel')?.hidden ?? null)
const listHidden = () => page.evaluate(() =>
  document.querySelector('visual-revise-list')?.hidden ?? null)

const selectedCount = () => page.evaluate(() => document.querySelectorAll('[data-selected]').length)
const uiCounts = () => page.evaluate(() => ({
  visbug:  document.querySelectorAll('vis-bug').length,
  toolbar: document.querySelectorAll('visual-revise-toolbar').length,
  panel:   document.querySelectorAll('visual-revise-panel').length,
  list:    document.querySelectorAll('visual-revise-list').length,
  comment: document.querySelectorAll('visual-revise-comment-layer').length,
  toast:   document.getElementById('visual-revise-toast') ? 1 : 0,
}))

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

// 页面自己的东西：一个真的输入框（验 ⌘Z 让路）+ 一个带自身 click 监听的按钮
await page.evaluate(() => {
  const inp = document.createElement('input')
  inp.id = 'vr-typing'
  inp.style.cssText = 'position:fixed;left:24px;bottom:24px;width:220px;z-index:5'
  document.body.appendChild(inp)
  window.__pageClicks = 0
  document.querySelector('.btn-primary').addEventListener('click', () => { window.__pageClicks++ })
})

const dragBarTo = async (dx, dy) => {
  const sep = await bar('.sep').first().boundingBox()
  await page.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2)
  await page.mouse.down()
  await page.mouse.move(sep.x + sep.width / 2 + dx, sep.y + sep.height / 2 + dy, { steps: 10 })
  await page.mouse.up()
  await wait(200)
}

// ── 1.0.6 构建版本自检 ────────────────────────────────────────────────
console.log('\n── 1.0 唤起 / 收起')
const readyLine = consoleLog.find(l => l.includes('[Visual Revise] 已就绪 · 构建于'))
T('1.0.6', !!readyLine, `就绪日志打印了构建时间（${readyLine || '未找到'}）`)
const buildMark = await page.evaluate(() => ({
  api: window.__visualRevise?.build,
  dom: document.documentElement.dataset.visualReviseBuild,
}))
T('1.0.6', !!buildMark.dom && buildMark.dom === buildMark.api,
  `版本同时落在 api.build 与 <html data-visual-revise-build>（${buildMark.dom}）`)

// ── 1.8.3 默认工具 ───────────────────────────────────────────────────
console.log('\n── 1.8 遗留 VisBug 工具条')
const tool0 = await page.evaluate(() => document.querySelector('vis-bug').activeTool)
T('1.8.3', tool0 === 'guides', `挂载后默认激活的上游工具是 guides（实际 ${tool0}）`)
const vbDisplay0 = await page.evaluate(() => document.querySelector('vis-bug').style.display)
T('1.0.1', vbDisplay0 === 'none' && (await uiCounts()).toolbar === 1,
  `注入后工具条出现、<vis-bug> 隐藏（display=${vbDisplay0}）`)

// ── 1.3 空历史下的撤销 / 重做 ─────────────────────────────────────────
console.log('\n── 1.3 撤销 / 重做（空历史）')
T('1.3.3', await bar('.undo').isDisabled() && await bar('.redo').isDisabled(),
  '没有历史时撤销 / 重做按钮都是 disabled')
T('1.3.4', await bar('.undo').getAttribute('data-tip-label') === '没有可撤销的操作' &&
           await bar('.redo').getAttribute('data-tip-label') === '没有可重做的操作',
  'tooltip 文案写明「没有可撤销/重做的操作」')

// kind=error 走的是 #ff8f8f，浏览器把它规范化成 rgb(255, 143, 143)
const ERROR_COLOR = /^(#ff8f8f|rgb\(255,\s*143,\s*143\))$/
await blur(); await armToast()
await page.keyboard.press(`${MOD}+z`); await wait(300)
let tt = await toast()
T('1.3.1', tt?.text === '没有可撤销的操作' && ERROR_COLOR.test(tt.color),
  `空历史按 ⌘Z → 错误色 toast（${tt?.text} / ${tt?.color}）`)

await armToast()
await page.keyboard.press(`${MOD}+Shift+z`); await wait(300)
tt = await toast()
T('1.3.2', tt?.text === '没有可重做的操作' && ERROR_COLOR.test(tt.color),
  `空历史按 ⌘⇧Z → 错误色 toast（${tt?.text} / ${tt?.color}）`)

T('1.4.2', (await bar('.count').textContent()).trim() === '0' &&
           await bar('.count').getAttribute('data-empty') !== null,
  '记录角标初始为 0 且带 data-empty')
T('1.4.4', await bar('.copy').getAttribute('data-ready') === null,
  '无改动时复制按钮不带 data-ready')

// ── 1.6 tooltip（横排）───────────────────────────────────────────────
console.log('\n── 1.6 tooltip 气泡')
await bar('.list').hover(); await wait(200)
let tip = await tipState()
T('1.6.1', tip.hidden === false && tip.label === '改动记录',
  `pointerover 命中 [data-tip] 弹出气泡（${tip.label}）`)

// pointerleave：把指针移到工具条之外
await page.mouse.move(700, 700); await wait(250)
T('1.6.1', (await tipState()).hidden === true, 'pointerleave 后气泡收起')

// pointerdown：按在「选择元素」上（当前已是该模式，点了不会改变状态）
await bar('button[data-mode="select"]').hover(); await wait(200)
T('1.6.1', (await tipState()).hidden === false, '再次悬停又弹出（准备验 pointerdown）')
await page.mouse.down(); await wait(150)
T('1.6.1', (await tipState()).hidden === true, 'pointerdown 立刻收起气泡')
await page.mouse.up(); await wait(200)

const TIPS_EXPECT = [
  ['.layout', '切换布局方向', ''],
  ['.list', '改动记录', 'L'],
  ['.copy', '复制提示词', 'P'],
  ['.undo', '没有可撤销的操作', '⌘Z'],
  ['.redo', '没有可重做的操作', '⇧⌘Z'],
  ['.close', '关闭编辑器', '⌥⇧D'],
  ['button[data-mode="browse"]', '浏览页面', 'V'],
  ['button[data-mode="select"]', '选择元素', 'A / F'],
  ['button[data-mode="comment"]', '评论', 'C'],
]
const tipMismatch = []
for (const [sel, label, key] of TIPS_EXPECT) {
  await page.mouse.move(700, 700); await wait(60)
  // disabled 的按钮收不到 pointerover，用真实指针移到它的几何中心，事件落在 .bar 上也一样命中
  const b = await btnBox(sel)
  await page.mouse.move((b.left + b.right) / 2, (b.top + b.bottom) / 2)
  await wait(160)
  const s = await tipState()
  if (s.hidden || s.label !== label || s.key !== key)
    tipMismatch.push(`${sel} → ${s.hidden ? '未弹出' : `${s.label}/${s.key}`}`)
}
T('1.6.2', tipMismatch.length === 0,
  `九个按钮的气泡文案 = 名称 + 快捷键${tipMismatch.length ? '；不符：' + tipMismatch.join('，') : ''}`)

await page.mouse.move(700, 700); await wait(120)
await bar('.list').hover(); await wait(200)
tip = await tipState()
let lb = await btnBox('.list')
T('1.6.3', tip.left !== '' && tip.top === '' && tip.box.top >= lb.bottom - 1,
  `横排：气泡在按钮下方、沿 x 定位（left=${tip.left}, 气泡顶 ${Math.round(tip.box.top)} ≥ 按钮底 ${Math.round(lb.bottom)}）`)

// ── 1.7.1 拖动工具条 ─────────────────────────────────────────────────
console.log('\n── 1.7 拖动工具条')
await page.mouse.move(700, 700); await wait(120)
const before = await host()
await dragBarTo(-120, 260)
const after = await host()
T('1.7.1', after.transform === 'none' && after.left !== '' && after.top !== '' &&
           after.left !== before.left,
  `.bar 空白处拖动 → transform:none + 绝对 left/top（${after.left} / ${after.top}）`)

// 按钮上按下不能拖：按住「选择元素」拖同样的距离，位置必须纹丝不动
const beforeBtnDrag = await host()
const modeBox = await btnBox('button[data-mode="select"]')
await page.mouse.move((modeBox.left + modeBox.right) / 2, (modeBox.top + modeBox.bottom) / 2)
await page.mouse.down()
await page.mouse.move((modeBox.left + modeBox.right) / 2 + 90, (modeBox.top + modeBox.bottom) / 2 + 40, { steps: 8 })
await page.mouse.up(); await wait(250)
const afterBtnDrag = await host()
T('1.7.1', afterBtnDrag.left === beforeBtnDrag.left && afterBtnDrag.top === beforeBtnDrag.top,
  `按在按钮上拖不移动工具条（仍在 ${afterBtnDrag.left} / ${afterBtnDrag.top}）`)

// ── 1.6.4 气泡夹回视口 ───────────────────────────────────────────────
const rectNow = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-toolbar').getBoundingClientRect()
  return { left: r.left, top: r.top }
})
await dragBarTo(-rectNow.left, 0)     // 把工具条推到贴左边
await page.mouse.move(700, 700); await wait(120)
const layoutBox = await btnBox('.layout')
await page.mouse.move((layoutBox.left + layoutBox.right) / 2, (layoutBox.top + layoutBox.bottom) / 2)
await wait(220)
tip = await tipState()
T('1.6.4', !tip.hidden && tip.box.left >= 7.5 && tip.arrowX !== '0px' && tip.arrowX !== '',
  `贴左边时气泡被夹回视口、箭头往回补（气泡左 ${Math.round(tip.box.left)}，--arrow-x=${tip.arrowX}）`)

// ── 1.1 布局方向切换 ─────────────────────────────────────────────────
console.log('\n── 1.1 布局方向切换')
const iconOf = () => page.evaluate(() =>
  document.querySelector('visual-revise-toolbar').shadowRoot.querySelector('.layout').innerHTML)
const iconH = await iconOf()
T('1.1.2', /rect[^>]*x="9"[^>]*y="3"[^>]*width="6"[^>]*height="18"/.test(iconH),
  '横排时图标画的是竖条（点下去会变成的方向）')

await bar('.layout').click(); await wait(450)
const vHost = await host()
T('1.1.1', vHost.vertical === true, '点一下布局按钮 → 宿主上出现 vertical 属性')
T('1.1.6', (await tipState()).hidden === true, '换向后已打开的 tooltip 被收掉')
T('1.1.4', vHost.left === '' && vHost.top === '' && vHost.transform === '',
  '换向后清掉拖过的 left/top/transform，回到 CSS 默认摆位')
const iconV = await iconOf()
T('1.1.2', /rect[^>]*x="3"[^>]*y="9"[^>]*width="18"[^>]*height="6"/.test(iconV),
  '竖排时图标换成横条')
const thV = await thumb()
T('1.1.5', /translateY\(/.test(thV.transform) && thV.height !== '',
  `竖排滑块走 translateY 并设高度（${thV.transform} / h=${thV.height}）`)
T('1.1.3', await page.evaluate(() => localStorage.getItem('visual-revise:orientation')) === 'vertical',
  'localStorage[visual-revise:orientation] 写成 vertical')

// 1.6.3 竖排：气泡在右侧、沿 y 定位
await page.mouse.move(700, 700); await wait(120)
await bar('.list').hover(); await wait(220)
tip = await tipState()
lb = await btnBox('.list')
T('1.6.3', !tip.hidden && tip.top !== '' && tip.left === '' && tip.box.left >= lb.right - 1,
  `竖排：气泡在按钮右侧、沿 y 定位（top=${tip.top}，气泡左 ${Math.round(tip.box.left)} ≥ 按钮右 ${Math.round(lb.right)}）`)

await bar('.layout').click(); await wait(450)
const hHost = await host()
T('1.1.1', hHost.vertical === false, '再点一下切回横排')
const thH = await thumb()
T('1.1.5', /translateX\(/.test(thH.transform) && thH.height === '',
  `横排滑块走 translateX 且不锁高度（${thH.transform}）`)
T('1.1.3', await page.evaluate(() => localStorage.getItem('visual-revise:orientation')) === 'horizontal',
  'localStorage 跟着写回 horizontal')

// ── 1.2 模式分段控件 ─────────────────────────────────────────────────
console.log('\n── 1.2 模式分段控件')
await page.mouse.move(700, 700); await wait(120)
await page.locator('.curve-card').first().click({ position: { x: 200, y: 6 } })
await wait(500)
T('1.2.10', (await thumb()).on === 'select', '初始高亮落在「选择元素」')
const selCountBefore = await selectedCount()

// 造出覆盖层：悬停页面元素
await page.locator('.curve-card').nth(2).hover(); await wait(350)
const ovBefore = await overlays()
T('1.2.1', ovBefore.visible > 0, `编辑态下页面上有 ${ovBefore.visible} 个可见的 visbug 覆盖层`)

// 打开记录列表，等下验证浏览模式会把它收起来
await page.keyboard.press('l'); await wait(300)
T('1.4.1', (await listHidden()) === false, '按 L 打开改动记录列表')

await blur(); await armToast()
await page.keyboard.press('v'); await wait(500)
T('1.2.1', await mode() === 'browse' && await page.evaluate(() => window.__visualRevise.interactive),
  '按 V → 进入浏览模式（interactive=true）')
const ovBrowse = await overlays()
T('1.2.1', ovBrowse.visible === 0 && (await panelHidden()) === true && (await listHidden()) === true &&
           (await page.evaluate(() => document.querySelector('visual-revise-comment-layer').hidden)) === true,
  `浏览模式收掉全部覆盖层（可见 ${ovBrowse.visible}/${ovBrowse.count}）、面板 / 记录 / 评论层都隐藏`)
tt = await toast()
T('1.2.11', tt?.text === '页面已交还给你，正常点击即可 · Esc 或再点一次回到编辑',
  `模式真的变了才 toast（${tt?.text}）`)

T('1.2.2', (await host()).hidden === false, '浏览模式下工具条仍在（stealth=false）')

// 1.2.6（AC-2.6）：浏览模式下移动鼠标不画标尺线
await page.mouse.move(400, 300); await wait(120)
await page.mouse.move(500, 360, { steps: 6 }); await wait(300)
T('1.2.1', (await overlays()).visible === 0, '浏览模式下移动鼠标不会重新画出覆盖层 / 标尺线')

const clicksBefore = await page.evaluate(() => window.__pageClicks)
await page.locator('.btn-primary').click(); await wait(400)
const clicksAfter = await page.evaluate(() => window.__pageClicks)
T('1.2.3', clicksAfter === clicksBefore + 1 && (await selectedCount()) === 0,
  `浏览模式下点页面：页面自己的 click 照常触发（${clicksBefore}→${clicksAfter}），元素不被选中`)

// 1.2.11 反面：同一个模式再点一次不该再 toast
await armToast()
await bar('button[data-mode="browse"]').click(); await wait(450)
T('1.2.11', (await toast())?.text === '', '模式没变（再点一次浏览）不 toast')

await blur()
await page.keyboard.press('Escape'); await wait(500)
T('1.2.4', await mode() === 'select' && !(await page.evaluate(() => window.__visualRevise.interactive)),
  '退出浏览模式回到选择态')
T('1.2.4', await selectedCount() === selCountBefore && selCountBefore > 0,
  `退出后原选中集被恢复（${selCountBefore} 个）`)
const ovBack = await overlays()
T('1.2.4', ovBack.inlineNone === 0, `覆盖层的 display:none 被清掉（残留 ${ovBack.inlineNone} 个）`)
T('1.2.4', await page.evaluate(() => document.querySelector('vis-bug').activeTool) === 'guides',
  '退出后 VisBug 工具被按原样装回（guides）')
await page.locator('.curve-card').nth(2).hover(); await wait(350)
T('1.2.4', (await overlays()).visible > 0, '恢复后悬停又能画出覆盖层，说明工具真的活过来了')
T('1.4.1', (await listHidden()) === false, '退出浏览模式后记录列表按原样恢复显示')
await page.keyboard.press('l'); await wait(300)   // 收起来，别挡后面的操作
T('1.4.1', (await listHidden()) === true, '再按一次 L 收起列表（list.hidden 取反）')

// 1.2.5 / 1.2.6：A / F 与面板 tab
await page.mouse.move(700, 700); await wait(120)
await page.locator('.curve-card').first().click({ position: { x: 200, y: 6 } })
await wait(450)
await blur()
await page.keyboard.press('f'); await wait(400)
T('1.2.5', await mode() === 'select' && await panelTab() === 'structure',
  `按 F → select 模式 + 面板切到 structure tab（tab=${await panelTab()}）`)
await page.keyboard.press('a'); await wait(400)
T('1.2.5', await mode() === 'select' && await panelTab() === 'props',
  `按 A → select 模式 + 面板切到 props tab（tab=${await panelTab()}）`)

// 没有选中时按 A / F 只切模式不切 tab
await page.keyboard.press('f'); await wait(350)
await page.keyboard.press('Escape'); await wait(350)      // 取消选中，panel.target 变空
T('1.2.6', await selectedCount() === 0, '（前置）Esc 取消选中，panel.target 为空')
await page.keyboard.press('a'); await wait(350)
T('1.2.6', await panelTab() === 'structure',
  `未选中时按 A 只切模式不切 tab（tab 仍是 ${await panelTab()}）`)

// 点「选择元素」按钮只切模式，不切面板 tab：面板停在上一次的 tab（这里是 structure）。
// 清单 1.2.6 / PRD AC-2.13 写明是有意设计——按钮没有 A / F 那层「顺便切 tab」的语义，
// 复现 agent 用对照组证伪了「按 A 会切」这个前提（见 full-e2e-report.md §5）
await bar('button[data-mode="comment"]').click(); await wait(400)
await bar('button[data-mode="select"]').click(); await wait(400)
await page.locator('.curve-card').first().click({ position: { x: 200, y: 6 } })
await wait(500)
T('1.2.5', await mode() === 'select', '点「选择元素」按钮 → select 模式')
T('1.2.5', await panelTab() === 'structure',
  `点「选择元素」按钮不动面板 tab，仍停在 structure（实际 ${await panelTab()}）`)

// 回到 props tab 再往下走
await P('.tab[data-tab="props"]').click(); await wait(300)

// 1.2.7 评论模式
await armToast()
await bar('button[data-mode="comment"]').click(); await wait(450)
T('1.2.7', await mode() === 'comment' &&
           await page.evaluate(() => window.__visualRevise.comments.active) === true,
  '点「评论」→ comment 模式且评论层激活')
T('1.2.7', (await toast())?.text === '点击任意元素写下需求 · 可连续标注 · Esc 退出',
  `评论模式的 toast 文案（${(await toast())?.text}）`)
T('1.2.10', (await thumb()).on === 'comment', '高亮与滑块跟到「评论」')
T('1.2.9', (await panelHidden()) === true && (await selectedCount()) === 0,
  '非 select 模式下取消选中且面板收起')

// 1.2.8 幂等
await blur()
await page.keyboard.press('c'); await wait(300)
await page.keyboard.press('c'); await wait(300)
T('1.2.8', await mode() === 'comment', '连按 C 一直停在评论模式，不 toggle 回 select')

await page.keyboard.press('Escape'); await wait(300)
if (await mode() !== 'select') { await page.keyboard.press('Escape'); await wait(300) }
T('1.2.10', await mode() === 'select' && (await thumb()).on === 'select',
  'Esc 回到选择模式，高亮跟随')

// 1.2.10 滑块真的滑到了那个按钮
const thumbTrack = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const read = () => {
    const t = sr.querySelector('.thumb').getBoundingClientRect()
    const b = sr.querySelector('button[data-mode][data-on]').getBoundingClientRect()
    return Math.abs(t.left - b.left) < 2 && Math.abs(t.width - b.width) < 2
  }
  return read()
})
T('1.2.10', thumbTrack, '滑块的几何落点与当前高亮按钮重合')

// ── 1.3 有历史时的撤销 / 重做 ────────────────────────────────────────
console.log('\n── 1.3 撤销 / 重做（有历史）')
await page.mouse.move(700, 700); await wait(120)
await page.locator('.curve-card').first().click({ position: { x: 200, y: 6 } })
await wait(500)

// 真实操作产生一条历史：拖面板里那个数值字段的标签（Figma 式拖标签调值）
const dragProp = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  for (const p of ['border-radius', 'opacity', 'width', 'padding-top', 'height'])
    if (sr.querySelector(`[data-drag][data-prop="${p}"]`)) return p
  return sr.querySelector('[data-drag][data-prop]')?.dataset.prop ?? null
})
if (dragProp) {
  const handle = P(`[data-drag][data-prop="${dragProp}"]`).first()
  await handle.scrollIntoViewIfNeeded()
  const h = await handle.boundingBox()
  const d0 = await depth()
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(h.x + h.width / 2 + i * 4, h.y + h.height / 2)
  await page.mouse.up(); await wait(350)
  const d1 = await depth()
  const written = await page.evaluate(p =>
    document.querySelector('.curve-card').style.getPropertyValue(p), dragProp)
  T('1.3.7', d1 === d0 + 1 && written !== '',
    `拖标签连改 12 次只攒成一条历史（depth ${d0}→${d1}，写出 ${dragProp}:${written}）`)

  await blur(); await armToast()
  await page.keyboard.press(`${MOD}+z`); await wait(400)
  const back = await page.evaluate(p =>
    document.querySelector('.curve-card').style.getPropertyValue(p), dragProp)
  T('1.3.7', back === '' && await depth() === d0,
    `⌘Z 一次整体退回（${dragProp} 回到「${back}」）`)
  await page.keyboard.press(`${MOD}+Shift+z`); await wait(400)
} else {
  T('1.3.7', false, '面板里找不到任何可拖的数值标签，合并窗口没法验')
}

// 1.3.1 / 1.3.2 / 1.3.3 / 1.3.4：真实按钮 + toast + disabled + tooltip
const d2 = await depth()
T('1.3.3', await bar('.undo').isDisabled() === false, '有历史时撤销按钮可用')
const undoTip = await bar('.undo').getAttribute('data-tip-label')
T('1.3.4', /^撤销：/.test(undoTip || ''), `撤销按钮 tooltip 写出将要撤销什么（${undoTip}）`)

await armToast()
await bar('.undo').click(); await wait(450)
tt = await toast()
T('1.3.1', /^已撤销：/.test(tt?.text || '') && await depth() === d2 - 1,
  `点撤销按钮 → toast「${tt?.text}」且历史深度 ${d2}→${await depth()}`)
T('1.3.3', await bar('.redo').isDisabled() === false, '撤销之后重做按钮解禁')
const redoTip = await bar('.redo').getAttribute('data-tip-label')
T('1.3.4', /^重做：/.test(redoTip || ''), `重做按钮 tooltip 同理（${redoTip}）`)

await armToast()
await bar('.redo').click(); await wait(450)
tt = await toast()
T('1.3.2', /^已重做：/.test(tt?.text || '') && await depth() === d2,
  `点重做按钮 → toast「${tt?.text}」，深度回到 ${await depth()}`)

// 1.3.5 输入框里 ⌘Z 让路
await page.locator('#vr-typing').click()
await page.keyboard.type('hello')
await armToast()
const dBeforeType = await depth()
await page.keyboard.press(`${MOD}+z`); await wait(400)
T('1.3.5', await depth() === dBeforeType && (await toast())?.text === '',
  `在输入框里按 ⌘Z 让路给浏览器（历史深度仍是 ${await depth()}，没有撤销 toast）`)
await blur()

// 1.3.6 一次批量动作只算一条历史：给 flex 容器切「排列」
await page.mouse.move(700, 700); await wait(120)
await page.keyboard.press('Escape'); await wait(200)
await page.locator('.hero-bar').click({ position: { x: 520, y: 18 } })
await wait(550)
const flowBtn = P('button[data-flow="vertical"]').first()
if (await flowBtn.count() > 0) {
  await flowBtn.scrollIntoViewIfNeeded()
  const dBefore = await depth()
  await flowBtn.click(); await wait(450)
  const dAfter = await depth()
  const inlineFlow = await page.evaluate(() => {
    const el = document.querySelector('.hero-bar')
    return { dir: el.style.getPropertyValue('flex-direction'), disp: el.style.getPropertyValue('display') }
  })
  const label = await page.evaluate(() => window.__visualRevise.store.history.undoLabel)
  T('1.3.6', dAfter === dBefore + 1 && inlineFlow.dir === 'column',
    `切排列写了多条声明但只记一条历史（depth ${dBefore}→${dAfter}，flex-direction:${inlineFlow.dir}，label「${label}」）`)
  await blur()
  await page.keyboard.press(`${MOD}+z`); await wait(450)
  const afterUndo = await page.evaluate(() => {
    const el = document.querySelector('.hero-bar')
    return { dir: el.style.getPropertyValue('flex-direction'), disp: el.style.getPropertyValue('display') }
  })
  T('1.3.6', afterUndo.dir === '' && afterUndo.disp === '' && await depth() === dBefore,
    `一次 ⌘Z 把这条批量整体退回（flex-direction「${afterUndo.dir}」/ display「${afterUndo.disp}」）`)
} else {
  T('1.3.6', false, '选中 .hero-bar 后面板里没有「排列」控件，批量历史没法验')
}

// ── 1.4 记录开关 / 复制提示词 ────────────────────────────────────────
console.log('\n── 1.4 改动记录 / 复制提示词')
await page.mouse.move(700, 700); await wait(120)
await page.locator('.curve-card').first().click({ position: { x: 200, y: 6 } })
await wait(450)

const statTotal = await total()
T('1.4.2', (await bar('.count').textContent()).trim() === String(statTotal) &&
           (statTotal > 0 ? await bar('.count').getAttribute('data-empty') === null : true),
  `记录角标 = ChangeStore.stats().total（${statTotal}），有改动时去掉 data-empty`)
T('1.4.4', await bar('.copy').getAttribute('data-ready') !== null, '有改动时复制按钮带 data-ready')

await bar('.list').click(); await wait(450)
T('1.4.1', (await listHidden()) === false &&
           await page.locator('visual-revise-list .item').count() > 0,
  `点「记录」按钮打开列表并 render 出 ${await page.locator('visual-revise-list .item').count()} 条`)
await bar('.list').click(); await wait(350)
T('1.4.1', (await listHidden()) === true, '再点一次「记录」收起列表')

const changedProps = await page.evaluate(() =>
  (window.__visualRevise.store.read().edits || [])
    .flatMap(e => (e.changes || []).map(c => c.prop)))
await blur(); await armToast()
await page.keyboard.press('p'); await wait(900)
const clip = await page.evaluate(() => navigator.clipboard.readText())
tt = await toast()
T('1.4.3', changedProps.length > 0 && changedProps.some(p => clip.includes(p)) &&
           /已复制 \d+ 项改动/.test(tt?.text || ''),
  `按 P 复制提示词（剪贴板 ${clip.length} 字，含 ${changedProps.join('/')}，toast「${tt?.text}」）`)

await armToast()
await bar('.copy').click(); await wait(900)
T('1.4.3', /已复制 \d+ 项改动/.test((await toast())?.text || ''),
  '点「复制提示词」按钮走同一条路径')

// ── 1.2.12 切模式不丢改动记录 ────────────────────────────────────────
const keepBefore = await total()
await bar('button[data-mode="browse"]').click(); await wait(350)
await bar('button[data-mode="comment"]').click(); await wait(350)
await bar('button[data-mode="select"]').click(); await wait(350)
const keepAfter = await total()
T('1.2.12', keepAfter === keepBefore && keepBefore > 0 &&
           (await bar('.count').textContent()).trim() === String(keepAfter),
  `浏览→评论→选择 来回切，改动记录仍是 ${keepAfter} 条`)

// ── 1.8 遗留 VisBug 工具条 ───────────────────────────────────────────
console.log('\n── 1.8 ⌘/ 唤出上游工具条')
await page.mouse.move(700, 700); await wait(120)
await blur()
const PAGE_MOD = await page.evaluate(() => navigator.platform.includes('Mac') ? 'Meta' : 'Control')
await page.keyboard.press(`${PAGE_MOD}+/`); await wait(600)
let vbDisp = await page.evaluate(() => document.querySelector('vis-bug').style.display)
T('1.8.1', vbDisp === 'block', `按 ⌘/ → <vis-bug> 宿主 display: none → ${vbDisp}`)

const vbRect = await page.evaluate(() => {
  const r = document.querySelector('vis-bug').getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})
T('1.8.1', vbRect.w > 20 && vbRect.h > 100,
  `上游竖排工具条真的出现在页面上（${Math.round(vbRect.w)}×${Math.round(vbRect.h)}）`)

// 真实鼠标点：closed shadow 拿不到内部节点，只能按几何扫描。
// 第一个工具就是 guides（已激活，点了不会变），所以第一次真正的变化必然来自第二个工具。
let switchedTo = null
for (let y = vbRect.y + 16; y < vbRect.y + Math.min(vbRect.h, 160); y += 6) {
  await page.mouse.click(vbRect.x + vbRect.w / 2, y)
  await wait(120)
  const t = await page.evaluate(() => document.querySelector('vis-bug').activeTool)
  if (t !== 'guides') { switchedTo = t; break }
}
T('1.8.2', !!switchedTo, `真实点击上游工具条上的工具 → toolSelected 生效（切到 ${switchedTo}）`)

// 点回第一个工具，验证它确实是 guides
for (let y = vbRect.y + 16; y < vbRect.y + 60; y += 4) {
  await page.mouse.click(vbRect.x + vbRect.w / 2, y)
  await wait(100)
  if (await page.evaluate(() => document.querySelector('vis-bug').activeTool) === 'guides') break
}
T('1.8.3', await page.evaluate(() => document.querySelector('vis-bug').activeTool) === 'guides',
  '点第一个工具回到 guides —— 它就是默认那个')

// 1.8.4 上游工具条自身可拖动。
// draggable 的 mousedown 要求 e.target 正好是它注册的 surface（这里是那条 <ol>），
// 而 shadow 是 closed，量不到 ol 的内边界——只能从宿主左边缘往里试几个像素。
// 拖动过程中 ol 跟着宿主一起走，所以指针始终压在同一个 surface 上，mouseup 收得住。
const vbStyle = () => page.evaluate(() => {
  const el = document.querySelector('vis-bug')
  return { left: el.style.left, top: el.style.top }
})
const vbBefore = await vbStyle()
let dragHit = null, vbAfter = vbBefore
for (const dx of [22, 21, 23, 20, 26, 18]) {
  await page.mouse.move(vbRect.x + dx, vbRect.y + 220)
  await page.mouse.down()
  await page.mouse.move(vbRect.x + dx + 130, vbRect.y + 220 + 70, { steps: 10 })
  await page.mouse.up(); await wait(250)
  vbAfter = await vbStyle()
  if (vbAfter.left !== vbBefore.left) { dragHit = dx; break }
}
T('1.8.4', dragHit !== null && parseFloat(vbAfter.left) >= 100 && parseFloat(vbAfter.top) >= 50,
  `上游工具条自身可拖动（抓在宿主左缘 +${dragHit}px，left ${vbBefore.left || '(空)'} → ${vbAfter.left}，top → ${vbAfter.top}）`)

await blur()
await page.keyboard.press(`${PAGE_MOD}+.`); await wait(500)
vbDisp = await page.evaluate(() => document.querySelector('vis-bug').style.display)
T('1.8.1', vbDisp === 'none', `按 ⌘. 再收起（display=${vbDisp}）`)

// ── 1.5 关闭 ─────────────────────────────────────────────────────────
console.log('\n── 1.5 关闭编辑器')
await page.mouse.move(700, 700); await wait(120)
await page.locator('.curve-card').first().click({ position: { x: 200, y: 6 } })
await wait(500)
const modeBeforePanelClose = await mode()
await P('header button.close').first().click()
await wait(450)
const afterPanelClose = await uiCounts()
T('1.5.2', (await panelHidden()) === true &&
           await mode() === modeBeforePanelClose &&
           afterPanelClose.toolbar === 1,
  `面板的 × 只收面板：模式仍是 ${await mode()}，工具条还在`)

// 关闭前先把方向切成竖排、再把工具条拖走——用来验证 1.1.3（方向落盘）与 1.7.2（位置不落盘）
await bar('.layout').click(); await wait(450)
await dragBarTo(60, 120)
const draggedHost = await host()
T('1.7.1', draggedHost.left !== '' && draggedHost.top !== '',
  `（前置）竖排下也能拖走（${draggedHost.left} / ${draggedHost.top}）`)

const changesBeforeClose = await total()
await bar('.close').click(); await wait(600)
const afterClose = await uiCounts()
T('1.5.1', afterClose.visbug === 0 && afterClose.toolbar === 0 && afterClose.panel === 0 &&
           afterClose.list === 0 && afterClose.comment === 0 && afterClose.toast === 0,
  `点 × → 整套 UI 全部移除（${JSON.stringify(afterClose)}）`)
await blur()
await page.keyboard.press('c'); await wait(300)
T('1.5.1', (await uiCounts()).toolbar === 0,
  '关闭后 document 上的键盘监听已解绑（按 C 不再唤起任何 UI）')
// 两个 × 的差别落在同一组计数上：面板的 × 之后编辑器全须全尾，工具条的 × 之后一个不剩
T('1.5.2', afterPanelClose.visbug === 1 && afterPanelClose.toolbar === 1 &&
           afterPanelClose.panel === 1 && afterPanelClose.list === 1 &&
           afterClose.visbug === 0 && afterClose.toolbar === 0 && afterClose.panel === 0,
  `面板 × 之后 UI 还在（${JSON.stringify(afterPanelClose)}），工具条 × 之后全没了（${JSON.stringify(afterClose)}）`)

// ── 1.0.1 / 1.0.3 / 1.1.3 / 1.7.2：再次唤起 ──────────────────────────
console.log('\n── 1.0 再次唤起 / 状态落盘')
const remount = async () => {
  await page.evaluate(() => {
    document.querySelectorAll('vis-bug').forEach(el => el.remove())
    const el = document.createElement('vis-bug')
    el.setAttribute('tutsBaseURL', '/__ext/tuts')   // 与 inject.js 一致，免得教程 gif 404 刷屏
    document.body.prepend(el)
  })
  await wait(700)
}
await remount()
const backUp = await uiCounts()
T('1.0.1', backUp.toolbar === 1 && backUp.panel === 1 && backUp.list === 1 && backUp.comment === 1,
  `再次唤起 → 一套完整 UI 回来（${JSON.stringify(backUp)}）`)
T('1.0.3', await total() === changesBeforeClose && changesBeforeClose > 0 &&
           (await bar('.count').textContent()).trim() === String(changesBeforeClose),
  `收起后再唤起，改动记录仍在（${changesBeforeClose} 条，角标同步）`)

const reHost = await host()
T('1.1.3', reHost.vertical === true, '方向落盘：重新唤起后仍是竖排')
T('1.7.2', reHost.left === '' && reHost.top === '' && reHost.transform === '',
  `位置不落盘：重新唤起后回到 CSS 默认摆位（left「${reHost.left}」top「${reHost.top}」）`)

// localStorage 抛异常时静默降级为横排
await page.evaluate(() => {
  window.__origGet = Storage.prototype.getItem
  Storage.prototype.getItem = function () { throw new Error('denied') }
})
await remount()
const fallbackHost = await host()
await page.evaluate(() => { Storage.prototype.getItem = window.__origGet })
T('1.1.3', fallbackHost.vertical === false,
  'localStorage 读取抛异常时静默降级为横排，工具条照常挂载')

// ── 1.0.4 / 1.0.5 / 1.0.6：inject.js 的真实执行路径 ──────────────────
const injectSrc = await readFile(join(ROOT, 'extension/toolbar/inject.js'), 'utf8')

const idem = await page.evaluate(async ([src, base]) => {
  window.chrome = {
    runtime: {
      getURL: p => `${base}/__ext/${p}`,
      onMessage: { addListener: () => {} },
    },
  }
  const errors = []
  const run = () => { try { new Function(src)() } catch (e) { errors.push(e.message) } }

  const before = {
    visbug: document.querySelectorAll('vis-bug').length,
    panel: document.querySelectorAll('visual-revise-panel').length,
  }
  run(); await new Promise(r => setTimeout(r, 500))
  run(); await new Promise(r => setTimeout(r, 400))
  // 页面脚本自行插了第二个 <vis-bug>：mountVisualRevise 的最后一道幂等防线
  document.body.prepend(document.createElement('vis-bug'))
  await new Promise(r => setTimeout(r, 400))

  return {
    before, errors,
    after: {
      visbug: document.querySelectorAll('vis-bug').length,
      panel: document.querySelectorAll('visual-revise-panel').length,
      toolbar: document.querySelectorAll('visual-revise-toolbar').length,
      list: document.querySelectorAll('visual-revise-list').length,
    },
  }
}, [injectSrc, origin])
T('1.0.4', idem.errors.length === 0 && idem.after.panel === 1 && idem.after.toolbar === 1 &&
           idem.after.list === 1,
  `重复注入 + 页面自造第二个 <vis-bug> 都不叠出第二套 UI（${JSON.stringify(idem.after)}）`)

// 收拾掉那个多余的裸 <vis-bug>，免得干扰下一段
await page.evaluate(() => {
  const all = [...document.querySelectorAll('vis-bug')]
  all.slice(1).forEach(el => el.remove())
})
await wait(300)

const healed = await page.evaluate(async ([src, base]) => {
  document.querySelectorAll('visual-revise-toolbar, visual-revise-panel, visual-revise-list, visual-revise-comment-layer')
    .forEach(el => el.remove())
  const before = {
    visbug: document.querySelectorAll('vis-bug').length,
    toolbar: document.querySelectorAll('visual-revise-toolbar').length,
  }
  window.chrome = {
    runtime: { getURL: p => `${base}/__ext/${p}`, onMessage: { addListener: () => {} } },
  }
  const errors = []
  try { new Function(src)() } catch (e) { errors.push(e.message) }
  await new Promise(r => setTimeout(r, 900))
  return {
    before, errors,
    after: {
      visbug: document.querySelectorAll('vis-bug').length,
      toolbar: document.querySelectorAll('visual-revise-toolbar').length,
    },
  }
}, [injectSrc, origin])
T('1.0.5', healed.before.visbug >= 1 && healed.before.toolbar === 0 &&
           healed.errors.length === 0 &&
           healed.after.visbug === 1 && healed.after.toolbar === 1,
  `死元素（有 vis-bug 无工具条）被清掉并重注入（${JSON.stringify(healed.before)} → ${JSON.stringify(healed.after)}）`)

// 版本不一致时 console.warn
consoleLog.length = 0
await page.evaluate(async ([src, base]) => {
  document.documentElement.dataset.visualReviseBuild = '1999-01-01T00:00:00.000Z'
  window.chrome = {
    runtime: { getURL: p => `${base}/__ext/${p}`, onMessage: { addListener: () => {} } },
  }
  try { new Function(src)() } catch { /* 幂等分支，不该抛 */ }
  await new Promise(r => setTimeout(r, 900))
}, [injectSrc, origin])
await wait(400)
const warned = consoleLog.find(l => l.includes('这个页面里跑的是旧代码'))
T('1.0.6', !!warned && warned.startsWith('warning::'),
  `页面里跑的是旧 bundle 时 console.warn 版本不一致（${warned ? '已警告' : '未警告'}）`)

// ── 无头 fixture 里跑不到的 ──────────────────────────────────────────
console.log('\n── 需真实扩展环境（跳过）')
console.log('  · 1.0.2 Alt+Shift+D 是 manifest 里的 _execute_action 浏览器命令，' +
            '由浏览器分发给扩展 service worker，页面脚本收不到，无头 fixture 无法验证')
console.log('  · 1.0.7 右键菜单 Show/Hide 走 chrome.contextMenus，' +
            'Playwright 打不开原生右键菜单，同样无法验证')

await browser.close(); await close()
console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`)
