// 全量 e2e · 分块「页面拖拽 / 参考线 / 上游工具」
// 覆盖 docs/plans/feature-inventory.md 的 §4.4（页面上直接拖拽移动元素）、
// §4.5（标尺线 / 测距）、§4.6（上游 VisBug 工具）。
//
// 全部走真实指针 / 键盘：locator 只用来量位置，点击一律 page.mouse.click，
// 断言落在 inline style / DOM 结构 / ChangeStore 记录 / 覆盖层 DOM 上。
//
// 起拖为什么要小步走：Chrome 会在 mousedown 之后按自己的阈值把手势升级成
// 原生 HTML5 拖放（dragstart → pointercancel），一旦升级，pointermove /
// pointerup 就再也不派发给页面，layout-drag 的这一次拖拽既提交不了也收不了尾。
// 一步跨 30px 时这件事约 1/30 的概率发生——tests-e2e/advanced.mjs 里
// 「向后拖落在期望位置」偶发失败就是它。这里的 startDrag() 先用 3 / 7 / 12px
// 三小步越过 4px 阈值，让 layout-drag 在第一时间 preventDefault 掉后续的
// 兼容鼠标事件，再一路 waitForFunction 等真实状态，而不是睡固定毫秒。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const T = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id} ${msg}`) }

const FIX = `${origin}/full/fixtures`

// ── 公用小工具 ───────────────────────────────────────────────
const box = async sel => {
  const b = await page.locator(sel).boundingBox()
  if (!b) throw new Error(`量不到 ${sel} 的位置`)
  return b
}
const mid = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const stats = () => page.evaluate(() => window.__visualRevise.store.stats())
const kidsOf = id => page.evaluate(x =>
  [...document.getElementById(x).children].map(n => n.id || n.tagName.toLowerCase()).join(','), id)
const inline = (sel, prop) => page.evaluate(([s, p]) =>
  document.querySelector(s).style.getPropertyValue(p), [sel, prop])
const computed = (sel, prop) => page.evaluate(([s, p]) =>
  getComputedStyle(document.querySelector(s)).getPropertyValue(p), [sel, prop])
const selectedIds = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(n => n.id || n.tagName.toLowerCase()))
const toastText = () => page.evaluate(() =>
  document.getElementById('visual-revise-toast')?.textContent || '')

const load = async file => {
  await page.goto(`${FIX}/${file}`)
  await injectVisBug(page, origin)
  await page.waitForFunction(() => !!window.__visualRevise, null, { timeout: 10000 })
  await page.waitForTimeout(250)
}

// ── 拖拽原语 ─────────────────────────────────────────────────
const dragState = () => page.evaluate(() => {
  const g = document.getElementById('visual-revise-drag-ghost')
  const bar = document.getElementById('visual-revise-drop-indicator')
  const t = document.querySelector('[data-vr-drop-target]')
  return {
    dragging: window.__visualRevise.layoutDrag.dragging,
    ghost: g && {
      tag: g.tagName, cls: g.className, text: g.textContent.trim(),
      left: parseFloat(g.style.left), top: parseFloat(g.style.top),
      ownUI: g.hasAttribute('data-visual-revise-ui'),
      pointerEvents: g.style.pointerEvents,
      border: g.style.border, background: g.style.background,
    },
    indicator: bar && { display: bar.style.display, width: bar.style.width, height: bar.style.height },
    dropTarget: t && (t.id || t.tagName),
    dropTargetInlineStyle: t?.getAttribute('style') || '',
    hintStyle: !!document.getElementById('visual-revise-drag-hints'),
  }
})

const startDrag = async (x, y, button = 'left') => {
  await page.mouse.move(x, y)
  await page.mouse.down({ button })
  for (const d of [3, 7, 12]) {
    await page.mouse.move(x + d, y + d)
    await page.waitForTimeout(20)
  }
}

const waitDragging = () =>
  page.waitForFunction(() => window.__visualRevise.layoutDrag.dragging,
    null, { timeout: 3000, polling: 30 })

// 移到落点后等「应用真的认了这个落点」，而不是睡固定毫秒
const waitDropTarget = expect =>
  page.waitForFunction(id => {
    const t = document.querySelector('[data-vr-drop-target]')
    if (id === null) return !t
    return !!t && (t.id === id || t.tagName === id)
  }, expect, { timeout: 3000, polling: 30 })

// 一次完整的「按下 → 越过阈值 → 移到落点」。被原生拖放劫持时收拾干净重来。
const dragToward = async (from, to, expectDrop, tries = 4) => {
  for (let i = 1; i <= tries; i++) {
    try {
      const f = typeof from === 'function' ? await from() : from
      await startDrag(f.x, f.y)
      await waitDragging()
      const t = typeof to === 'function' ? await to() : to
      await page.mouse.move(t.x, t.y, { steps: 6 })
      await waitDropTarget(expectDrop)
      return
    } catch (err) {
      await page.mouse.up().catch(() => {})
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      if (i === tries) throw err
    }
  }
}

const dropAndWait = async (fn, arg) => {
  await page.mouse.up()
  await page.waitForFunction(fn, arg, { timeout: 3000, polling: 30 })
}

// 长页面下半段：body 被扩展撑成 min-height:100vh，滚过它之后视口里全是 <html>
const scrollDeep = async () => {
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, 1400)
  await page.waitForFunction(() => window.scrollY > 1300, null, { timeout: 3000, polling: 30 })
  await page.waitForTimeout(150)
}
const scrollTop = async () => {
  await page.mouse.wheel(0, -1600)
  await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 3000, polling: 30 })
  await page.waitForTimeout(150)
}

const reset = async () => {
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const vr = window.__visualRevise
    if (vr.layoutDrag.dragging) vr.layoutDrag.cancelDrag()
    vr.store.undoEverything()
    vr.store.history.clear()
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}

// ══════════════════════════════════════════════════════════════
// §4.4 页面上直接拖拽移动元素
// ══════════════════════════════════════════════════════════════
console.log('\n[页面拖拽 / 参考线 / 上游工具] §4.4 页面拖拽\n')
await load('drag-guides-upstream-drag.html')

// 观察通道说明：
// 选择模式下 selectable.js 会在 body 的捕获阶段 stopPropagation 掉每一次页面
// click，所以页面自己的 click 处理器本来就收不到事件，拿它判断「被吞没吞」
// 是判不出来的。拖拽的吞噬钩子挂在 **document 的捕获阶段**，比 body 早一层：
// 因此在 body 捕获阶段挂一个计数器——普通点击数得到，被吞掉的点击数不到。
await page.evaluate(() => {
  window.__bodyClicks = 0
  window.__selectstart = []
  document.body.addEventListener('click', () => { window.__bodyClicks++ }, true)
  // 冒泡阶段读 defaultPrevented，才反映得出捕获阶段那次 preventDefault
  document.addEventListener('selectstart', e => window.__selectstart.push(e.defaultPrevented))
})

// ── 4.4.1 谁响应起拖 ──
console.log('── 4.4.1 起拖条件')
await reset()

// (1) 没有选中任何元素（面板收着）时也能拖
{
  const r1 = mid(await box('#r1'))
  await startDrag(r1.x, r1.y)
  await waitDragging()
  const st = await dragState()
  T('4.4.1', st.dragging, '没有选中元素、面板收着时按住页面元素就能起拖')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}

// (2) 属性 tab 下能拖，(3) 结构 tab 下也能拖
{
  const b = await box('#r1')
  await page.mouse.click(b.x + 10, b.y + 10)
  await page.waitForTimeout(300)
  const tabProps = await page.evaluate(() => document.querySelector('visual-revise-panel').tab)
  const r1 = mid(b)
  await startDrag(r1.x, r1.y)
  await waitDragging()
  T('4.4.1', tabProps === 'props' && (await dragState()).dragging,
    `属性 tab（${tabProps}）下拖拽可用`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  await page.mouse.click(b.x + 10, b.y + 10)
  await page.waitForTimeout(250)
  await page.keyboard.press('f')
  await page.waitForTimeout(300)
  const tabTree = await page.evaluate(() => document.querySelector('visual-revise-panel').tab)
  await startDrag(r1.x, r1.y)
  await waitDragging()
  T('4.4.1', tabTree === 'structure' && (await dragState()).dragging,
    `结构 tab（${tabTree}）下拖拽同样可用`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.keyboard.press('a')
  await page.waitForTimeout(200)
}

// (4) <body> 空白处按下不响应
{
  await reset()
  const hit = await page.evaluate(() => document.elementFromPoint(1200, 16)?.tagName)
  await startDrag(1200, 16)
  const st = await dragState()
  await page.mouse.up()
  await page.waitForTimeout(150)
  T('4.4.1', hit === 'BODY' && !st.dragging && !st.ghost,
    `在 <body>（命中 ${hit}）上按下拖动不起拖`)
}

// (5) canDrag 为假（命中 <html>）不响应
// 扩展自己给 body 加了 min-height:100vh，所以只有把长页面滚到下半段、
// body 整个跑到视口上方时，视口里点下去才真的命中 <html>。
{
  await scrollDeep()
  const hit = await page.evaluate(() => document.elementFromPoint(600, 700)?.tagName)
  await startDrag(600, 700)
  const st = await dragState()
  await page.mouse.up()
  await page.waitForTimeout(150)
  T('4.4.1', hit === 'HTML' && !st.dragging && !st.ghost,
    `命中 <html>（canDrag 为假）不起拖（命中 ${hit}）`)
  await scrollTop()
}

// (6) 编辑器自己的 UI 上按下不响应
{
  const b = await box('#r1')
  await page.mouse.click(b.x + 10, b.y + 10)
  await page.waitForTimeout(300)
  const panel = await page.evaluate(() => {
    const r = document.querySelector('visual-revise-panel').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await startDrag(panel.x + panel.w / 2, panel.y + panel.h - 6)
  const st = await dragState()
  await page.mouse.up()
  await page.waitForTimeout(150)
  T('4.4.1', !st.dragging && !st.ghost, '在属性面板（编辑器 UI）上按下拖动不会起拖页面元素')
  await reset()
}

// (7) 右键不响应
{
  const r1 = mid(await box('#r1'))
  await startDrag(r1.x, r1.y, 'right')
  const st = await dragState()
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(150)
  T('4.4.1', !st.dragging && !st.ghost, '右键按下拖动不起拖（只认左键）')
  await reset()
}

// ── 4.4.2 4px 起拖阈值 ──
console.log('── 4.4.2 起拖阈值')
{
  await reset()
  const b = await box('#r0')
  await page.mouse.move(b.x + 60, b.y + 35)
  await page.mouse.down()
  await page.mouse.move(b.x + 62, b.y + 36)   // 2px，没到 4px
  await page.waitForTimeout(120)
  const during = await dragState()
  await page.mouse.up()
  await page.waitForTimeout(350)
  const s = await stats()
  T('4.4.2', !during.dragging && !during.ghost, '按下后只挪 2px 不算拖拽（没有拖影）')
  T('4.4.2', (await selectedIds()).join() === 'r0' && s.moves === 0,
    `2px 内松手仍是「选中」（选中 ${(await selectedIds()).join()}，moves=${s.moves}）`)
  await reset()
}

// ── 4.4.3 / 4.4.4 拖影 ──
console.log('── 4.4.3 / 4.4.4 拖影与压暗')
{
  await reset()
  const r1 = mid(await box('#r1'))
  const r0 = await box('#r0')
  await startDrag(r1.x, r1.y)
  await waitDragging()
  await page.mouse.move(r0.x + 20, r0.y + 35, { steps: 6 })
  await waitDropTarget('row')
  const st = await dragState()
  T('4.4.3', st.ghost?.tag === 'DIV' && st.ghost.cls === 'cell' && st.ghost.text === 'R1',
    `拖影是被拖元素的克隆（<${st.ghost?.tag} class="${st.ghost?.cls}">${st.ghost?.text}）`)
  T('4.4.3', (await inline('#r1', 'opacity')) === '0.25',
    `源元素被压暗到 opacity ${await inline('#r1', 'opacity')}`)
  T('4.4.3', st.hintStyle, '注入了落点提示样式 <style id="visual-revise-drag-hints">')
  T('4.4.4', st.ghost?.ownUI && st.ghost?.pointerEvents === 'none',
    '拖影标记为编辑器 UI 且 pointer-events:none（不会命中自己）')

  const before = { left: st.ghost.left, top: st.ghost.top }
  await page.mouse.move(r0.x + 20, r0.y + 60, { steps: 4 })
  await page.waitForTimeout(120)
  const st2 = await dragState()
  T('4.4.4', st2.ghost.top > before.top,
    `拖影跟随指针（top ${before.top} → ${st2.ghost.top}）`)

  await page.keyboard.press('Escape')
  await reset()
}

// 超大元素的拖影退化成蓝色轮廓框
{
  const hb = await box('#hugewrap')
  await startDrag(hb.x + 60, hb.y + 60)
  await waitDragging()
  const st = await dragState()
  const size = await page.evaluate(() => {
    const r = document.getElementById('huge').getBoundingClientRect()
    return Math.round(r.width * r.height)
  })
  T('4.4.3', st.ghost?.tag === 'DIV' && st.ghost.text === ''
    && /2px solid/.test(st.ghost.border) && /13, 153, 255|13 153 255/.test(st.ghost.background),
    `${size} px² > 1600×1200 的元素退化成蓝色轮廓框（border="${st.ghost?.border}"）`)
  await page.keyboard.press('Escape')
  await reset()
}

// ── 4.4.5 三档落点 + 4.4.6 视觉反馈 + 4.4.7 提交 ──
console.log('── 4.4.5 / 4.4.6 / 4.4.7 三档落点、指示线、提交')

// 前 1/3 → 插到它前面（横排容器）
{
  await reset()
  const clicksBefore = await page.evaluate(() => window.__bodyClicks)
  const r2 = mid(await box('#r2'))
  const r0 = await box('#r0')
  await dragToward(r2, { x: r0.x + 18, y: r0.y + 35 }, 'row')
  const st = await dragState()
  T('4.4.6', st.dropTarget === 'row' && st.indicator.display === 'block' && st.indicator.width === '3px',
    `横排容器画竖条指示线（落点=${st.dropTarget}，width=${st.indicator.width}）`)
  T('4.4.6', !/outline/.test(st.dropTargetInlineStyle),
    `落点高亮不写 inline style（#row style="${st.dropTargetInlineStyle}"）`)
  await dropAndWait(() =>
    [...document.getElementById('row').children].map(n => n.id).join() === 'r2,r0,r1')
  T('4.4.5', await kidsOf('row') === 'r2,r0,r1', `拖到目标前 1/3 → 插到它前面（#row = ${await kidsOf('row')}）`)
  const s = await stats()
  T('4.4.7', s.moves === 1 && s.props === 0, `松手提交为一条移动（moves=${s.moves} props=${s.props}）`)
  T('4.4.7', (await selectedIds()).join() === 'r2', `提交后宿主重新选中被移动的元素（${(await selectedIds()).join()}）`)
  T('4.4.7', /^已移动到 .+ 里$/.test(await toastText()), `toast 报出落点容器：「${await toastText()}」`)
  T('4.4.10', (await page.evaluate(() => window.__bodyClicks)) === clicksBefore,
    `松手后那次 click 被 document 捕获阶段吞掉，没往下传（body 捕获计数仍是 ${clicksBefore}）`)
  const cleaned = await dragState()
  T('4.4.6', cleaned.indicator.display === 'none' && !cleaned.dropTarget,
    '松手后指示线与落点高亮都收掉')
  await reset()
}

// 后 1/3 → 插到它后面（advanced.mjs「向后拖」那条回归，连跑 4 次）
{
  let okAll = true, seen = []
  for (let i = 0; i < 4; i++) {
    await reset()
    const r0 = mid(await box('#r0'))
    const r1 = await box('#r1')
    await dragToward(r0, { x: r1.x + r1.width - 12, y: r1.y + 35 }, 'row')
    await dropAndWait(() =>
      [...document.getElementById('row').children].map(n => n.id).join() === 'r1,r0,r2')
    const kids = await kidsOf('row')
    seen.push(kids)
    if (kids !== 'r1,r0,r2') okAll = false
  }
  T('4.4.5', okAll, `拖到目标后 1/3 → 插到它后面，连跑 4 次都稳定（${seen.join(' / ')}）`)
  await reset()
}

// 中段 → 放进它里面（空容器，跨容器落点之一）
{
  await reset()
  const r0 = mid(await box('#r0'))
  const empty = mid(await box('#empty'))
  await dragToward(r0, empty, 'empty')
  const st = await dragState()
  T('4.4.6', st.indicator.display === 'none',
    '落点是「放进容器里」时只描容器边框、不画插入线')
  await dropAndWait(() => document.getElementById('empty').children.length === 1)
  T('4.4.5', await kidsOf('empty') === 'r0' && await kidsOf('row') === 'r1,r2',
    `跨容器 · 中段放进空容器（#empty = ${await kidsOf('empty')}，#row = ${await kidsOf('row')}）`)
  await reset()
}

// 跨容器 · 竖排容器的前 1/3
{
  await reset()
  const r0 = mid(await box('#r0'))
  const c0 = await box('#c0')
  await dragToward(r0, { x: c0.x + 90, y: c0.y + 8 }, 'col')
  const st = await dragState()
  T('4.4.6', st.indicator.display === 'block' && st.indicator.height === '3px',
    `竖排容器画横条指示线（height=${st.indicator.height}）`)
  await dropAndWait(() =>
    [...document.getElementById('col').children].map(n => n.id).join() === 'r0,c0,c1')
  T('4.4.5', await kidsOf('col') === 'r0,c0,c1', `跨容器 · 竖排前 1/3 插到目标前（#col = ${await kidsOf('col')}）`)
  await reset()
}

// 跨容器 · 竖排容器的后 1/3
{
  await reset()
  const r0 = mid(await box('#r0'))
  const c1 = await box('#c1')
  await dragToward(r0, { x: c1.x + 90, y: c1.y + c1.height - 8 }, 'col')
  await dropAndWait(() =>
    [...document.getElementById('col').children].map(n => n.id).join() === 'c0,c1,r0')
  T('4.4.5', await kidsOf('col') === 'c0,c1,r0', `跨容器 · 竖排后 1/3 插到目标后（#col = ${await kidsOf('col')}）`)
  await reset()
}

// 跨容器 · 落到某个非空容器「里面」（中段命中 #c0 本身）
{
  await reset()
  const r0 = mid(await box('#r0'))
  const c0 = await box('#c0')
  await dragToward(r0, { x: c0.x + 90, y: c0.y + c0.height / 2 }, 'c0')
  await dropAndWait(() => document.getElementById('c0').children.length === 1)
  T('4.4.5', await kidsOf('c0') === 'r0', `跨容器 · 中段放进目标元素里面（#c0 = ${await kidsOf('c0')}）`)
  await reset()
}

// ── 4.4.8 Esc 取消 ──
console.log('── 4.4.8 Esc 取消这一次拖拽')
{
  await reset()
  const r0 = mid(await box('#r0'))
  const empty = mid(await box('#empty'))
  await dragToward(r0, empty, 'empty')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(250)
  const st = await dragState()
  const s = await stats()
  T('4.4.8', await kidsOf('row') === 'r0,r1,r2' && await kidsOf('empty') === '',
    `Esc 取消后 DOM 回到拖之前（#row = ${await kidsOf('row')}，#empty 空）`)
  T('4.4.8', !st.ghost && st.indicator.display === 'none' && !st.dropTarget
    && (await inline('#r0', 'opacity')) === '',
    '取消后拖影 / 指示线 / 落点高亮 / 压暗全部收掉')
  T('4.4.8', s.total === 0, `取消不落下任何改动（total=${s.total}）`)
  await reset()
}

// ── 4.4.9 selectstart 被压制 ──
console.log('── 4.4.9 拖拽期间压制文本选择')
{
  await reset()
  const r0 = mid(await box('#r0'))
  const r2 = await box('#r2')
  // 对照：没越过 4px 阈值时不拦，浏览器照常起框选——证明这条观察通道是通的
  await page.evaluate(() => { window.__selectstart = [] })
  await page.mouse.move(r0.x - 20, r0.y)
  await page.mouse.down()
  await page.mouse.move(r0.x - 17, r0.y)
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForTimeout(150)
  const belowSlop = await page.evaluate(() => window.__selectstart)
  T('4.4.9', belowSlop.length > 0 && belowSlop.every(v => v === false),
    `没越过 4px 阈值时不拦 selectstart（收到 ${belowSlop.length} 次，均未被拦）`)
  await page.mouse.click(r0.x, r0.y)
  await page.waitForTimeout(200)

  await startDrag(r0.x, r0.y)
  await waitDragging()
  await page.evaluate(() => { window.__selectstart = [] })
  await page.mouse.move(r2.x + 60, r2.y + 35, { steps: 8 })
  await page.mouse.move(r0.x, r0.y, { steps: 8 })
  await page.waitForTimeout(150)
  const seen = await page.evaluate(() => window.__selectstart)
  const selection = await page.evaluate(() => window.getSelection().toString())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  T('4.4.9', seen.length === 0 || seen.every(Boolean),
    `拖拽期间的 selectstart 一律被 preventDefault（收到 ${seen.length} 次，全部拦下=${seen.every(Boolean)}）`)
  T('4.4.9', selection === '', `拖过一串文字也没选中任何文本（选区="${selection}"）`)
  await reset()
}

// ── 4.4.10 吞掉松手后那次 click（补两条：选中不被顶掉 + 吞完还能正常点） ──
console.log('── 4.4.10 吞掉松手后的 click')
{
  await reset()
  // 松手落在 #empty 上：click 若放行，selectable 会拿松手处坐标改选 #empty
  const r0 = mid(await box('#r0'))
  const empty = mid(await box('#empty'))
  await dragToward(r0, empty, 'empty')
  await dropAndWait(() => document.getElementById('empty').children.length === 1)
  T('4.4.10', (await selectedIds()).join() === 'r0',
    `松手落在别的容器上，选中的仍是被搬的元素而不是松手处那个（${(await selectedIds()).join()}）`)

  const before = await page.evaluate(() => window.__bodyClicks)
  const b = await box('#r1')
  await page.mouse.click(b.x + 10, b.y + 10)
  await page.waitForTimeout(250)
  const after = await page.evaluate(() => window.__bodyClicks)
  T('4.4.10', after === before + 1 && (await selectedIds()).join() === 'r1',
    `搬完一次之后页面照样点得动（body 捕获计数 ${before} → ${after}，选中 ${(await selectedIds()).join()}）`)
  await reset()
}

// ── 4.4.11 模式关掉时取消而非提交 ──
console.log('── 4.4.11 setActive(false) 取消当前拖拽')
{
  await reset()
  const r0 = mid(await box('#r0'))
  const empty = mid(await box('#empty'))
  await dragToward(r0, empty, 'empty')
  await page.keyboard.press('v')     // 切浏览模式 → layoutDrag.setActive(false)
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(250)
  const st = await dragState()
  const s = await stats()
  T('4.4.11', await kidsOf('row') === 'r0,r1,r2' && s.moves === 0,
    `切到浏览模式时取消而非提交（#row = ${await kidsOf('row')}，moves=${s.moves}）`)
  T('4.4.11', !st.hintStyle && !st.ghost && !st.dropTarget,
    '停用后落点提示样式、拖影、落点标记都清掉')
  await page.keyboard.press('a')
  await page.waitForTimeout(300)
  T('4.4.11', await page.evaluate(() => window.__visualRevise.layoutDrag.active),
    '回到选择模式后拖拽重新启用')
  await reset()
}

// ── 4.4.12 只搬 DOM，不写 order ──
console.log('── 4.4.12 不写 CSS order')
{
  await reset()
  const r2 = mid(await box('#r2'))
  const r0 = await box('#r0')
  await dragToward(r2, { x: r0.x + 18, y: r0.y + 35 }, 'row')
  await dropAndWait(() =>
    [...document.getElementById('row').children].map(n => n.id).join() === 'r2,r0,r1')
  const orders = await page.evaluate(() =>
    [...document.querySelectorAll('#row > *, #col > *, #empty > *')].map(el => el.style.order).join('|'))
  T('4.4.12', /^\|*$/.test(orders) && await kidsOf('row') === 'r2,r0,r1',
    `移动只改 DOM 顺序，一个 order 都没写（order="${orders}"）`)
  await reset()
}

// ── 4.4.13 拒绝非法落点 ──
console.log('── 4.4.13 拒绝非法落点')
{
  // 自己的后代
  await reset()
  const nest = await box('#nest')
  const n0 = mid(await box('#n0'))
  await startDrag(nest.x + 6, nest.y + 6)     // 按在 #nest 自己的 padding 上
  await waitDragging()
  await page.mouse.move(n0.x, n0.y, { steps: 6 })
  await page.waitForTimeout(200)
  const st = await dragState()
  const legal = await page.evaluate(() => {
    const t = document.querySelector('[data-vr-drop-target]')
    const nest = document.getElementById('nest')
    return !t || (t !== nest && !nest.contains(t))
  })
  T('4.4.13', legal, `拖到自己的后代上时落点绝不落在自己或后代里（落点=${st.dropTarget}）`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // <html>：滚到长页面下半段，被拖的元素周围全是 <html>
  await reset()
  await scrollDeep()
  const d0 = mid(await box('#d0'))
  await startDrag(d0.x, d0.y)
  await waitDragging()
  await page.mouse.move(600, 700, { steps: 8 })
  await waitDropTarget(null)
  const st2 = await dragState()
  T('4.4.13', !st2.dropTarget && st2.indicator.display === 'none',
    '悬停在 <html> 上时既不标落点也不画指示线')
  await page.mouse.up()
  await page.waitForTimeout(300)
  const s = await stats()
  T('4.4.13', await kidsOf('deepzone') === 'd0,d1' && s.moves === 0,
    `在 <html> 上松手不产生移动（#deepzone = ${await kidsOf('deepzone')}，moves=${s.moves}）`)
  await scrollTop()
  await reset()
}

// ── 4.4.1（续）<img> 也满足 canDrag：起拖之后必须能收尾 ──
// 放在 §4.4 最后：这一段会把 layout-drag 卡在「正在拖」的状态里，
// 留在中间会污染后面的用例。
console.log('── 4.4.1 <img> 起拖后的收尾')
{
  await reset()
  const p = mid(await box('#pic'))
  const t = mid(await box('#empty'))
  const draggable = await page.evaluate(() => {
    const el = document.getElementById('pic')
    return !!el.parentElement && el.parentElement !== document.documentElement
  })
  // 「确实起过拖」只能在页面里当场取：浏览器把手势升级成原生 HTML5 拖放时会
  // 发 pointercancel，这一次拖拽在同一个任务里就正确收尾了，跨进程再回来读到
  // 的永远是收尾之后的状态。
  // pointermove 挂冒泡阶段：layout-drag 的处理器在捕获阶段，轮到这里时
  // beginDrag 已经跑完。
  await page.evaluate(() => {
    window.__began = { dragging: false, ghost: false }
    window.__snapDrag = () => {
      if (!window.__visualRevise.layoutDrag.dragging) return
      window.__began = { dragging: true, ghost: !!document.getElementById('visual-revise-drag-ghost') }
    }
    document.addEventListener('pointermove', window.__snapDrag)
    document.addEventListener('dragstart', window.__snapDrag, true)
  })
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  // 2px 一步：让 layout-drag 在 4px 处先起拖（beginDrag），
  // 浏览器随后才把手势升级成原生 HTML5 拖放
  for (const d of [2, 4, 6, 8, 10]) {
    await page.mouse.move(p.x + d, p.y)
    await page.waitForTimeout(40)
  }
  const began = await page.evaluate(() => {
    document.removeEventListener('pointermove', window.__snapDrag)
    document.removeEventListener('dragstart', window.__snapDrag, true)
    return window.__began
  })
  await page.mouse.move(t.x, t.y, { steps: 8 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(500)
  const after = await dragState()
  const picOpacity = await inline('#pic', 'opacity')
  T('4.4.1', draggable && began.dragging && !!began.ghost,
    `<img> 满足 canDrag，按下越过阈值后确实起了拖（dragging=${began.dragging}，拖影=${!!began.ghost}）`)
  T('4.4.1',
    !after.dragging && !after.ghost && picOpacity === '' && after.indicator.display === 'none',
    `松手后这次拖拽必须收尾：dragging=${after.dragging}、拖影=${!!after.ghost}、`
    + `#pic opacity="${picOpacity}"、指示线=${after.indicator.display}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// ══════════════════════════════════════════════════════════════
// §4.5 标尺线 / 测距
// ══════════════════════════════════════════════════════════════
console.log('\n[页面拖拽 / 参考线 / 上游工具] §4.5 标尺线 / 测距\n')
await load('drag-guides-upstream-guides.html')

const gridlineState = () => page.evaluate(() => {
  const all = [...document.querySelectorAll('visbug-gridlines')]
  return { count: all.length, visible: all.filter(g => g.style.display !== 'none').length }
})
const distanceState = () => page.evaluate(() =>
  [...document.querySelectorAll('visbug-distance')].map(d => ({
    q: d.style.getPropertyValue('--quadrant').trim(),
    d: d.shadowRoot?.querySelector('figcaption')?.textContent.trim(),
    hidden: d.style.display === 'none',
  })))
const fmt = list => list.map(m => `${m.q}:${m.d}`).sort().join(' ')

// ── 4.5.1 hover 画对齐辅助线 ──
{
  const ga = mid(await box('#ga'))
  await page.mouse.move(ga.x, ga.y)
  await page.waitForFunction(() => {
    const g = document.querySelector('visbug-gridlines')
    return !!g && g.style.display !== 'none'
  }, null, { timeout: 3000, polling: 30 })
  const g = await gridlineState()
  T('4.5.1', g.count === 1 && g.visible === 1,
    `hover 页面元素画出 <visbug-gridlines>（${g.count} 个，可见 ${g.visible} 个）`)
}

// ── 4.5.2 移开 / 滚动时收起 ──
{
  const tb = await page.evaluate(() => {
    const r = document.querySelector('visual-revise-toolbar').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.move(tb.x, tb.y, { steps: 6 })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('visbug-gridlines')].every(g => g.style.display === 'none'),
    null, { timeout: 3000, polling: 30 })
  T('4.5.2', (await gridlineState()).visible === 0, '鼠标移出页面元素（挪到工具条上）后标尺线收起')

  const ga = mid(await box('#ga'))
  await page.mouse.move(ga.x, ga.y)
  await page.waitForFunction(() =>
    [...document.querySelectorAll('visbug-gridlines')].some(g => g.style.display !== 'none'),
    null, { timeout: 3000, polling: 30 })
  await page.mouse.wheel(0, 200)
  await page.waitForFunction(() =>
    [...document.querySelectorAll('visbug-gridlines')].every(g => g.style.display === 'none'),
    null, { timeout: 3000, polling: 30 })
  T('4.5.2', (await gridlineState()).visible === 0, '页面滚动后标尺线收起')
  await page.mouse.wheel(0, -200)
  await page.waitForTimeout(250)
}

// ── 4.5.3 五种几何关系的测距数值 ──
console.log('── 4.5.3 测距的五种几何分支')
{
  const ga = await box('#ga')
  await page.mouse.click(ga.x + 10, ga.y + 10)
  await page.waitForTimeout(350)

  const hoverMeasure = async sel => {
    const b = await box(sel)
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 })
    await page.waitForFunction(() => document.querySelectorAll('visbug-distance').length > 0,
      null, { timeout: 3000, polling: 30 })
    await page.waitForTimeout(120)
    return distanceState()
  }

  const right = await hoverMeasure('#gr')
  T('4.5.3', fmt(right) === 'right:120', `右侧不相交：一条 right 标签，距离 120（实得 ${fmt(right)}）`)

  const left = await hoverMeasure('#gl')
  T('4.5.3', fmt(left) === 'left:100', `左侧不相交：一条 left 标签，距离 100（实得 ${fmt(left)}）`)

  const top = await hoverMeasure('#gt')
  T('4.5.3', fmt(top) === 'top:90', `正上方：一条 top 标签，距离 90（实得 ${fmt(top)}）`)

  const bottom = await hoverMeasure('#gb')
  T('4.5.3', fmt(bottom) === 'bottom:100', `正下方：一条 bottom 标签，距离 100（实得 ${fmt(bottom)}）`)

  // 包含关系：锚完全裹住目标，左右 + 上下共四条内距
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const gw = await box('#gw')
  await page.mouse.click(gw.x + 10, gw.y + gw.height - 10)
  await page.waitForTimeout(350)
  const inside = await hoverMeasure('#gi')
  T('4.5.3', fmt(inside) === 'bottom:40 left:120 right:60 top:100',
    `包含关系：四条内距 left120 / right60 / bottom40 / top100（实得 ${fmt(inside)}）`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// ── 4.5.4 选中第 2 个元素时测距线被粘住 ──
console.log('── 4.5.4 粘住测距线')
{
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const ga = await box('#ga')
  await page.mouse.click(ga.x + 10, ga.y + 10)
  await page.waitForTimeout(300)

  const gl = await box('#gl')
  await page.mouse.move(gl.x + 50, gl.y + 50, { steps: 4 })
  await page.waitForFunction(() => document.querySelectorAll('visbug-distance').length > 0,
    null, { timeout: 3000, polling: 30 })
  const beforeStick = await distanceState()

  await page.keyboard.down('Shift')
  await page.mouse.click(gl.x + 50, gl.y + 50)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(350)
  const picked = await selectedIds()

  const gr = await box('#gr')
  await page.mouse.move(gr.x + 50, gr.y + 50, { steps: 4 })
  await page.waitForFunction(() => document.querySelectorAll('visbug-distance').length > 1,
    null, { timeout: 3000, polling: 30 }).catch(() => {})
  const afterStick = await distanceState()

  T('4.5.4', picked.length === 2 && afterStick.length > beforeStick.length,
    `选中第 2 个元素（${picked.join()}）后原测距线被粘住：${beforeStick.length} → ${afterStick.length} 条`)
  T('4.5.4', fmt(afterStick).includes('left:100') && afterStick.length === beforeStick.length + 1,
    `粘住的那条（left:100）在 clearMeasurements 之后仍在，新测距叠加上来（${fmt(afterStick)}）`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// ── 4.5.5 浏览模式 / 隐身态下不画 ──
console.log('── 4.5.5 浏览模式与隐身态下不画标尺线')
{
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.keyboard.press('v')
  await page.waitForTimeout(350)
  const ga = mid(await box('#ga'))
  await page.mouse.move(ga.x, ga.y, { steps: 4 })
  await page.mouse.move(ga.x + 30, ga.y + 20, { steps: 4 })
  await page.waitForTimeout(400)
  const browse = await gridlineState()
  const browseDist = await distanceState()
  T('4.5.5', browse.visible === 0 && browseDist.every(d => d.hidden),
    `浏览模式下 hover 不画标尺线（可见 ${browse.visible} 条，测距全部隐藏=${browseDist.every(d => d.hidden)}）`)

  await page.keyboard.press('a')
  await page.waitForTimeout(300)
  await page.keyboard.press('Tab')            // 隐身态
  await page.waitForTimeout(350)
  await page.mouse.move(ga.x + 60, ga.y + 40, { steps: 4 })
  await page.mouse.move(ga.x + 20, ga.y + 10, { steps: 4 })
  await page.waitForTimeout(400)
  const stealth = await gridlineState()
  T('4.5.5', stealth.visible === 0, `隐身态（Tab）下 hover 同样不画标尺线（可见 ${stealth.visible} 条）`)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
}

// ══════════════════════════════════════════════════════════════
// §4.6 上游 VisBug 工具
// ══════════════════════════════════════════════════════════════
console.log('\n[页面拖拽 / 参考线 / 上游工具] §4.6 上游 VisBug 工具\n')
await load('drag-guides-upstream-tools.html')

const visbugVisible = () => page.evaluate(() => document.querySelector('vis-bug').style.display)
const activeTool = () => page.evaluate(() => document.querySelector('vis-bug').activeTool)
const toolPoint = tool => page.evaluate(t => {
  const li = document.querySelector('vis-bug').$shadow.querySelector(`li[data-tool="${t}"]`)
  if (!li) return null
  const r = li.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, tool)
// 上游工具条是 translateX(-200%) 起手、靠 present-yourself 动画滑进来的，
// 而 display:none → block 会把这段动画整个重放一遍。动画没跑完就去量按钮位置，
// 量到的是屏幕外的坐标，点过去自然什么都没发生。等它真的停在原地再点。
const settleToolbar = () => page.waitForFunction(() => {
  const vb = document.querySelector('vis-bug')
  if (vb.style.display === 'none') return true
  const li = vb.$shadow.querySelector('li[data-tool="guides"]')
  const running = (vb.getAnimations?.() || []).some(a => a.playState === 'running')
  return !running && li.getBoundingClientRect().left >= 0
}, null, { timeout: 5000, polling: 30 })

const activate = async tool => {
  await settleToolbar()
  const p = await toolPoint(tool)
  if (!p) return null
  await page.mouse.click(p.x, p.y)
  await page.waitForFunction(t => document.querySelector('vis-bug').activeTool === t,
    tool, { timeout: 3000, polling: 30 }).catch(() => {})
  await page.waitForTimeout(200)
  return activeTool()
}
const useTool = async (id, tool, label) => {
  const got = await activate(tool)
  T(id, got === tool, `点工具条按钮激活 ${label}（activeTool=${got}）`)
  return got
}
const pick = async (sel, dx = 8, dy = 8) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  const b = await box(sel)
  await page.mouse.click(b.x + dx, b.y + dy)
  await page.waitForTimeout(300)
}
// 在元素上来回蹭鼠标，直到条件成立。metatip / a11y 浮层不是「一动就出」，
// 第一批 mousemove 常常只走到「擦掉旧浮层」那条分支。
const hoverJiggle = async (sel, fn, tries = 10) => {
  const b = await box(sel)
  for (let i = 0; i < tries; i++) {
    await page.mouse.move(b.x + 24 + (i % 4) * 8, b.y + 10 + (i % 3) * 5, { steps: 2 })
    await page.waitForTimeout(140)
    if (await page.evaluate(fn)) return true
  }
  return false
}
// 每一步之间必须等够 0.15s：扩展给选中元素加了 transition: all .15s ease
// （bundle.css），而上游工具读的是 getComputedStyle——过渡还在跑时读到的是
// 中间值，下一步就在错误的基数上加减。
const tap = async (...keys) => {
  for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(320) }
}

// §1.8 的入口：⌘/ 唤出隐藏的上游工具条
{
  const before = await visbugVisible()
  await page.keyboard.press('Meta+Slash')
  await page.waitForFunction(() => document.querySelector('vis-bug').style.display === 'block',
    null, { timeout: 3000, polling: 30 })
  await settleToolbar()
  const tools = await page.evaluate(() =>
    [...document.querySelector('vis-bug').$shadow.querySelectorAll('li[data-tool]')].map(li => li.dataset.tool))
  T('4.6.1', before === 'none' && (await visbugVisible()) === 'block' && tools.length === 13,
    `⌘/ 唤出上游工具条（${before} → block），13 个工具：${tools.join(' ')}`)
  T('4.6.1', (await activeTool()) === 'guides'
    && await page.evaluate(() => document.querySelector('vis-bug').$shadow
      .querySelector('li[data-tool="guides"]').dataset.active) === 'true',
    'Guides 是默认工具，按钮上带 data-active')

  await hoverJiggle('#para', () =>
    [...document.querySelectorAll('visbug-gridlines')].some(g => g.style.display !== 'none'))
  T('4.6.1', await page.evaluate(() =>
    [...document.querySelectorAll('visbug-gridlines')].some(g => g.style.display !== 'none')),
    'Guides 激活时 hover 仍画对齐辅助线（同 §4.5）')
}

// ── 4.6.2 Inspect ──
console.log('── 4.6.2 Inspect（metatip）')
{
  await useTool('4.6.2', 'inspector', 'Inspect')
  const b = await box('#para')
  await hoverJiggle('#para', () => document.querySelectorAll('visbug-metatip').length > 0)
  // metatip 的 shadow 是 closed，读不到 shadowRoot，只能走元素自己挂的 $shadow
  const tipText = await page.evaluate(() =>
    document.querySelector('visbug-metatip')?.$shadow?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200) || '')
  T('4.6.2', /px/.test(tipText), `hover 弹出计算样式浮层：「${tipText.slice(0, 60)}…」`)

  await page.mouse.click(b.x + 40, b.y + 20)
  await page.waitForTimeout(350)
  T('4.6.2', await page.evaluate(() => !!document.querySelector('[data-metatip]')),
    '点击把浮层「钉住」（元素上出现 data-metatip）')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const cleared = await page.evaluate(() => ({
    tips: document.querySelectorAll('visbug-metatip').length,
    pinned: document.querySelectorAll('[data-metatip]').length,
  }))
  T('4.6.2', cleared.tips === 0 && cleared.pinned === 0,
    `Esc 清空钉住的浮层（浮层 ${cleared.tips} 个，钉住 ${cleared.pinned} 个）`)
}

// ── 4.6.3 Accessibility ──
console.log('── 4.6.3 Accessibility')
{
  await useTool('4.6.3', 'accessibility', 'Accessibility')
  const b = await box('#para')
  await hoverJiggle('#para', () => document.querySelectorAll('visbug-ally').length > 0)
  const tipText = await page.evaluate(() =>
    document.querySelector('visbug-ally')?.$shadow?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200) || '')
  T('4.6.3', tipText.length > 0, `hover 弹出 a11y / 对比度浮层：「${tipText.slice(0, 60)}…」`)

  await page.mouse.click(b.x + 40, b.y + 20)
  await page.waitForTimeout(350)
  T('4.6.3', await page.evaluate(() => !!document.querySelector('[data-allytip]')),
    '点击钉住 a11y 浮层（元素上出现 data-allytip）')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const cleared = await page.evaluate(() => ({
    tips: document.querySelectorAll('visbug-ally').length,
    pinned: document.querySelectorAll('[data-allytip]').length,
  }))
  T('4.6.3', cleared.tips === 0 && cleared.pinned === 0,
    `Esc 清空钉住的 a11y 浮层（浮层 ${cleared.tips} 个，钉住 ${cleared.pinned} 个）`)
}

// ── 4.6.5 Margin ──
console.log('── 4.6.5 Margin')
{
  await pick('#t2')
  await useTool('4.6.5', 'margin', 'Margin')
  await tap('ArrowRight')
  T('4.6.5', (await inline('#t2', 'margin-right')) === '1px',
    `→ 让对应边 +1px（margin-right=${await inline('#t2', 'margin-right')}）`)
  await tap('Shift+ArrowRight')
  T('4.6.5', (await inline('#t2', 'margin-right')) === '11px',
    `shift+→ 一次 +10px（margin-right=${await inline('#t2', 'margin-right')}）`)
  await tap('Alt+ArrowRight')
  T('4.6.5', (await inline('#t2', 'margin-right')) === '10px',
    `alt+→ 减 1px（margin-right=${await inline('#t2', 'margin-right')}）`)
  await tap('Meta+ArrowUp')
  const four = await page.evaluate(() => {
    const s = document.getElementById('t2').style
    return ['top', 'right', 'bottom', 'left'].map(k => s.getPropertyValue('margin-' + k)).join('/')
  })
  T('4.6.5', four === '1px/11px/1px/1px', `⌘↑ 四边同时 +1（margin ${four}）`)
  await tap('Alt+ArrowUp', 'Alt+ArrowUp', 'Alt+ArrowUp')
  T('4.6.5', (await inline('#t2', 'margin-top')) === '0px',
    `减到负数时钳在 0（margin-top=${await inline('#t2', 'margin-top')}）`)
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await page.waitForTimeout(200)
}

// ── 4.6.6 Padding ──
console.log('── 4.6.6 Padding')
{
  await pick('#t2')
  await useTool('4.6.6', 'padding', 'Padding')
  const start = parseInt(await computed('#t2', 'padding-bottom'), 10)
  await tap('ArrowDown')
  T('4.6.6', (await inline('#t2', 'padding-bottom')) === `${start + 1}px`,
    `↓ 对应边 +1px（padding-bottom ${start} → ${await inline('#t2', 'padding-bottom')}）`)
  await tap('Shift+ArrowDown')
  T('4.6.6', (await inline('#t2', 'padding-bottom')) === `${start + 11}px`,
    `shift+↓ 一次 +10px（padding-bottom=${await inline('#t2', 'padding-bottom')}）`)
  await tap('Alt+ArrowDown')
  T('4.6.6', (await inline('#t2', 'padding-bottom')) === `${start + 10}px`,
    `alt+↓ 减 1px（padding-bottom=${await inline('#t2', 'padding-bottom')}）`)
  await tap('Meta+ArrowUp')
  const four = await page.evaluate(() => {
    const s = document.getElementById('t2').style
    return ['top', 'right', 'bottom', 'left'].map(k => s.getPropertyValue('padding-' + k)).join('/')
  })
  T('4.6.6', four === `${start + 1}px/${start + 1}px/${start + 11}px/${start + 1}px`,
    `⌘↑ 四边同时 +1（padding ${four}）`)
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await page.waitForTimeout(200)
}

// ── 4.6.7 Flexbox Align ──
console.log('── 4.6.7 Flexbox Align')
{
  await pick('#board', 6, 6)
  await useTool('4.6.7', 'align', 'Flexbox Align')
  await tap('ArrowRight')
  T('4.6.7', (await inline('#board', 'display')) === 'flex'
    && (await inline('#board', 'justify-content')) === 'center',
    `→ 循环 justify-content 并强制 display:flex（${await inline('#board', 'justify-content')}）`)
  await tap('ArrowLeft')
  T('4.6.7', (await inline('#board', 'justify-content')) === 'flex-start',
    `← 反向循环 justify-content（${await inline('#board', 'justify-content')}）`)
  await tap('ArrowDown')
  T('4.6.7', (await inline('#board', 'align-items')) === 'center',
    `↓ 循环 align-items（${await inline('#board', 'align-items')}）`)
  await tap('ArrowUp')
  T('4.6.7', (await inline('#board', 'align-items')) === 'flex-start',
    `↑ 反向循环 align-items（${await inline('#board', 'align-items')}）`)
  await tap('Shift+ArrowRight')
  T('4.6.7', (await inline('#board', 'justify-content')) === 'space-between',
    `shift+→ 循环分布（${await inline('#board', 'justify-content')}）`)
  await tap('Shift+ArrowDown')
  T('4.6.7', (await inline('#board', 'align-content')) === 'space-between',
    `shift+↓ 循环 align-content（${await inline('#board', 'align-content')}）`)
  await tap('Meta+ArrowDown')
  T('4.6.7', (await inline('#board', 'flex-direction')) === 'column',
    `⌘↓ 直接切 column（${await inline('#board', 'flex-direction')}）`)
  await tap('Meta+ArrowRight')
  T('4.6.7', (await inline('#board', 'flex-direction')) === 'row',
    `⌘→ 直接切 row（${await inline('#board', 'flex-direction')}）`)
  await tap('Meta+Shift+ArrowLeft')
  T('4.6.7', (await inline('#board', 'flex-direction')) === 'row-reverse',
    `⌘⇧← 在四种 direction 里循环（${await inline('#board', 'flex-direction')}）`)
  await tap('Meta+Shift+ArrowDown')
  T('4.6.7', (await inline('#board', 'flex-wrap')) === 'wrap',
    `⌘⇧↓ 切 flex-wrap（${await inline('#board', 'flex-wrap')}）`)
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await page.waitForTimeout(200)
}

// ── 4.6.11 Font Styles ──
console.log('── 4.6.11 Font Styles')
{
  await pick('#para', 40, 20)
  await useTool('4.6.11', 'font', 'Font Styles')
  await tap('ArrowUp')
  T('4.6.11', (await inline('#para', 'font-size')) === '17px',
    `↑ 字号 +1（font-size=${await inline('#para', 'font-size')}）`)
  await tap('Shift+ArrowUp')
  T('4.6.11', (await inline('#para', 'line-height')) === '25px',
    `shift+↑ 行高 +1（line-height=${await inline('#para', 'line-height')}）`)
  await tap('ArrowRight')
  T('4.6.11', ['center', 'right', 'justify'].includes(await inline('#para', 'text-align')),
    `→ 循环 text-align（${await inline('#para', 'text-align')}）`)
  await tap('Shift+ArrowRight')
  T('4.6.11', /-?[\d.]+px/.test(await inline('#para', 'letter-spacing')),
    `shift+→ 改字距（letter-spacing=${await inline('#para', 'letter-spacing')}）`)
  await tap('Meta+ArrowUp')
  T('4.6.11', (await inline('#para', 'font-weight')) !== '' && (await inline('#para', 'font-weight')) !== '400',
    `⌘↑ 字重上一档（font-weight=${await inline('#para', 'font-weight')}）`)
  await tap('Meta+b')
  T('4.6.11', (await inline('#para', 'font-weight')) === 'bold',
    `⌘B 粗体开关（font-weight=${await inline('#para', 'font-weight')}）`)
  await tap('Meta+i')
  T('4.6.11', (await inline('#para', 'font-style')) === 'italic',
    `⌘I 斜体开关（font-style=${await inline('#para', 'font-style')}）`)
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await page.waitForTimeout(200)
}

// ── 4.6.10 Box Shadows ──
console.log('── 4.6.10 Box Shadows')
{
  await pick('#shadowbox', 20, 20)
  await useTool('4.6.10', 'boxshadow', 'Box Shadows')
  T('4.6.10', (await inline('#shadowbox', 'box-shadow')) === '', '起手元素上没有 box-shadow')
  await tap('ArrowRight')
  const seeded = await inline('#shadowbox', 'box-shadow')
  T('4.6.10', seeded !== '' && /1px/.test(seeded), `→ 先播种一条阴影再改 x 偏移（${seeded}）`)
  await tap('ArrowDown')
  const withY = await inline('#shadowbox', 'box-shadow')
  T('4.6.10', withY !== seeded, `↓ 改 y 偏移（${withY}）`)
  await tap('Alt+ArrowUp')
  const withBlur = await inline('#shadowbox', 'box-shadow')
  T('4.6.10', withBlur !== withY && /1px 1px 1px/.test(withBlur),
    `⌥↑ 改模糊（${withBlur}）——从 0 往下减会写出非法的负模糊，整条声明被 CSS 丢掉`)
  await tap('Alt+ArrowRight')
  const withSpread = await inline('#shadowbox', 'box-shadow')
  T('4.6.10', withSpread !== withBlur, `⌥→ 改扩展（${withSpread}）`)
  await tap('Meta+ArrowDown')
  T('4.6.10', /inset/.test(await inline('#shadowbox', 'box-shadow')),
    `⌘↓ 加 inset（${await inline('#shadowbox', 'box-shadow')}）`)
  await tap('Meta+ArrowUp')
  T('4.6.10', !/inset/.test(await inline('#shadowbox', 'box-shadow')),
    `⌘↑ 去掉 inset（${await inline('#shadowbox', 'box-shadow')}）`)
  await tap('Meta+ArrowRight')
  T('4.6.10', (await inline('#shadowbox', 'box-shadow')) !== withSpread,
    `⌘→ 改不透明度（${await inline('#shadowbox', 'box-shadow')}）`)
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await page.waitForTimeout(200)
}

// ── 4.6.9 Hue Shift ──
console.log('── 4.6.9 Hue Shift')
{
  await pick('#huebox', 20, 20)
  await useTool('4.6.9', 'hueshift', 'Hue Shift')
  const bg0 = await computed('#huebox', 'background-color')
  await tap('ArrowUp')
  const bg1 = await inline('#huebox', 'background-color')
  T('4.6.9', bg1 !== '' && bg1 !== bg0, `↑ 改明度，写在 background-color 上（${bg0} → ${bg1}）`)
  await tap('ArrowRight')
  T('4.6.9', (await inline('#huebox', 'background-color')) !== bg1,
    `→ 改饱和度（${await inline('#huebox', 'background-color')}）`)
  const bg2 = await inline('#huebox', 'background-color')
  await tap('Meta+ArrowUp')
  T('4.6.9', (await inline('#huebox', 'background-color')) !== bg2,
    `⌘↑ 改色相（${await inline('#huebox', 'background-color')}）`)
  const bg3 = await inline('#huebox', 'background-color')
  await tap('Meta+ArrowLeft')
  T('4.6.9', /,\s*0\.\d+\)/.test(await inline('#huebox', 'background-color'))
    && (await inline('#huebox', 'background-color')) !== bg3,
    `⌘← 改 alpha（${await inline('#huebox', 'background-color')}）——⌘→ 是加 alpha，`
    + `不透明的元素本来就是 1，加不动`)

  const bgBefore = await inline('#huebox', 'background-color')
  await tap(']')
  await tap('ArrowUp')
  T('4.6.9', (await inline('#huebox', 'border-color')) !== ''
    && (await inline('#huebox', 'background-color')) === bgBefore,
    `] 把作用目标切到边框（border-color=${await inline('#huebox', 'border-color')}，背景没动）`)
  const borderBefore = await inline('#huebox', 'border-color')
  await tap('[')
  await tap('ArrowUp')
  T('4.6.9', (await inline('#huebox', 'background-color')) !== bgBefore
    && (await inline('#huebox', 'border-color')) === borderBefore,
    `[ 切回背景（背景又开始变、边框停住）`)
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await page.waitForTimeout(200)
}

// ── 4.6.4 Position ──
console.log('── 4.6.4 Position')
{
  await pick('#s0', 20, 20)
  await useTool('4.6.4', 'position', 'Position')
  await tap('ArrowRight')
  T('4.6.4', (await inline('#s0', 'position')) === 'relative' && (await inline('#s0', 'left')) === '1px',
    `→ 强制 position:relative 并把 left +1（left=${await inline('#s0', 'left')}）`)
  await tap('Shift+ArrowRight')
  T('4.6.4', (await inline('#s0', 'left')) === '11px', `shift+→ 一次 10px（left=${await inline('#s0', 'left')}）`)
  await tap('ArrowDown')
  T('4.6.4', (await inline('#s0', 'top')) === '1px', `↓ 改 top（top=${await inline('#s0', 'top')}）`)
  await tap('ArrowLeft')
  T('4.6.4', (await inline('#s0', 'left')) === '10px', `← 反向（left=${await inline('#s0', 'left')}）`)

  // 鼠标拖动元素改位置
  const before = { left: await inline('#s0', 'left'), top: await inline('#s0', 'top') }
  const b = await box('#s0')
  await page.mouse.move(b.x + 60, b.y + 30)
  await page.mouse.down()
  for (const d of [4, 12, 24, 40]) {
    await page.mouse.move(b.x + 60 + d, b.y + 30 + d)
    await page.waitForTimeout(40)
  }
  const during = await dragState()
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = { left: await inline('#s0', 'left'), top: await inline('#s0', 'top') }
  T('4.6.4', after.left !== before.left && after.top !== before.top,
    `鼠标拖动应改 left/top（${before.left}/${before.top} → ${after.left}/${after.top}）；`
    + `此刻 Visual Revise 自己的页面拖拽 dragging=${during.dragging}、拖影=${!!during.ghost}`)
  await page.keyboard.press('Escape')
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await page.waitForTimeout(250)
}

// ── 4.6.8 Move ──
console.log('── 4.6.8 Move')
{
  await pick('#t1', 20, 20)
  await useTool('4.6.8', 'move', 'Move')
  const grips = await page.evaluate(() => ({
    grips: document.querySelectorAll('visbug-grip').length,
    draggables: document.querySelectorAll('#board > [draggable="true"]').length,
  }))
  T('4.6.8', grips.grips >= 1 && grips.draggables === 3,
    `单选且有 ≥2 个兄弟时出现 grip 手柄（${grips.grips} 个 grip，${grips.draggables} 个兄弟可拖）`)

  await tap('ArrowLeft')
  T('4.6.8', await kidsOf('board') === 't1,t0,t2', `← 与前一兄弟换位（#board = ${await kidsOf('board')}）`)
  await tap('ArrowRight')
  T('4.6.8', await kidsOf('board') === 't0,t1,t2', `→ 与后一兄弟换位（#board = ${await kidsOf('board')}）`)
  await tap('ArrowUp')
  T('4.6.8', await page.evaluate(() => document.getElementById('t1').parentElement.id) === 'stage'
    && await kidsOf('board') === 't0,t2',
    `↑ 提升为父级的兄弟（#t1 现在挂在 #${await page.evaluate(() => document.getElementById('t1').parentElement.id)} 下）`)
  const s = await stats()
  T('4.6.8', s.moves === 0 && s.props === 0,
    `Move 是纯 DOM 搬动，不写 CSS、也不进改动记录（moves=${s.moves} props=${s.props}）`)

  // ↓ 沉入下一兄弟
  await pick('#s0', 20, 20)
  await tap('ArrowDown')
  T('4.6.8', await page.evaluate(() => document.getElementById('s0').parentElement.id) === 's1',
    `↓ 沉入下一个有孩子的兄弟（#s0 现在挂在 #${await page.evaluate(() => document.getElementById('s0').parentElement.id)} 下）`)
}
await page.reload()
await injectVisBug(page, origin)
await page.waitForFunction(() => !!window.__visualRevise, null, { timeout: 10000 })
await page.waitForTimeout(300)
await page.keyboard.press('Meta+Slash')
await page.waitForTimeout(300)

// ── 4.6.16 shift+/ 快捷键帮助浮层 ──
console.log('── 4.6.16 shift+/ 快捷键浮层')
{
  await activate('margin')
  // 焦点回页面 + 清掉选中：有选中时 Esc 会先被 Visual Revise 拿去取消选中，
  // 根本传不到 hotkeys-js 那条 esc 绑定上
  const sb = await box('#shadowbox')
  await page.mouse.click(sb.x + 20, sb.y + 20)
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('[data-selected]').length === 0,
    null, { timeout: 3000, polling: 30 })

  const mapDisplay = tool => page.evaluate(t => {
    const host = document.querySelector('vis-bug').$shadow.querySelector('visbug-hotkeys')
    return host.querySelector(`hotkeys-${t}`)?.style.display || ''
  }, tool)
  const waitMap = want => page.waitForFunction(w => {
    const host = document.querySelector('vis-bug').$shadow.querySelector('visbug-hotkeys')
    return (host.querySelector('hotkeys-margin')?.style.display || '') === w
  }, want, { timeout: 3000, polling: 30 })

  await page.keyboard.press('Shift+Slash')
  await waitMap('flex').catch(() => {})
  T('4.6.16', (await mapDisplay('margin')) === 'flex',
    `shift+/ 显示当前工具（margin）的快捷键图（display=${await mapDisplay('margin')}）`)

  await page.keyboard.press('Shift+Slash')
  await waitMap('none').catch(() => {})
  T('4.6.16', (await mapDisplay('margin')) === 'none',
    `再按一次收起（display=${await mapDisplay('margin')}）`)

  await page.keyboard.press('Shift+Slash')
  await waitMap('flex').catch(() => {})
  await page.keyboard.press('Escape')
  await waitMap('none').catch(() => {})
  T('4.6.16', (await mapDisplay('margin')) === 'none',
    `没有选中元素时 Esc 同样收起（display=${await mapDisplay('margin')}）`)

  // ⚠️ 工具条收起时按它：浮层渲染在 display:none 的 <vis-bug> 里，看不见任何东西
  await page.keyboard.press('Meta+Slash')
  await page.waitForFunction(() => document.querySelector('vis-bug').style.display === 'none',
    null, { timeout: 3000, polling: 30 })
  await page.keyboard.press('Shift+Slash')
  await waitMap('flex').catch(() => {})
  const blind = await page.evaluate(() => {
    const vb = document.querySelector('vis-bug')
    const map = vb.$shadow.querySelector('visbug-hotkeys').querySelector('hotkeys-margin')
    return { host: vb.style.display, map: map.style.display, rects: map.getClientRects().length }
  })
  T('4.6.16', blind.host === 'none' && blind.map === 'flex' && blind.rects === 0,
    `未唤出工具条时按 shift+/ 什么也看不见（<vis-bug> display=${blind.host}，`
    + `浮层 style.display=${blind.map} 但 ${blind.rects} 个可见矩形）`)

  // 收拾干净：浮层收回去、工具条重新唤出，免得它盖住页面把后面的用例连坐
  for (let i = 0; i < 3 && (await mapDisplay('margin')) !== 'none'; i++) {
    await page.keyboard.press('Shift+Slash')
    await waitMap('none').catch(() => {})
  }
  await page.keyboard.press('Meta+Slash')
  await page.waitForFunction(() => document.querySelector('vis-bug').style.display === 'block',
    null, { timeout: 3000, polling: 30 })
  await settleToolbar()
}

// ── 4.6.12 Edit Text ──
console.log('── 4.6.12 Edit Text')
{
  await pick('#para', 40, 20)
  await useTool('4.6.12', 'text', 'Edit Text')
  const attrs = await page.evaluate(() => {
    const el = document.getElementById('para')
    return { editable: el.getAttribute('contenteditable'), spell: el.getAttribute('spellcheck') }
  })
  T('4.6.12', attrs.editable === 'true' && attrs.spell === 'true',
    `选中元素进入 contenteditable（contenteditable=${attrs.editable} spellcheck=${attrs.spell}）`)
  // 点回页面别处让它 blur：contenteditable 一直聚焦时 hotkeys-js 会把之后
  // 所有快捷键都过滤掉（⌘/、shift+/ 全哑），后面的用例就全成了连锁失败
  const sb = await box('#shadowbox')
  await page.mouse.click(sb.x + 20, sb.y + 20)
  await page.waitForFunction(() => !document.getElementById('para').hasAttribute('contenteditable'),
    null, { timeout: 3000, polling: 30 })
  T('4.6.12', await page.evaluate(() => !document.getElementById('para').isContentEditable),
    '点到别处后编辑态解除（contenteditable 被摘掉）')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

// ── 4.6.15 Screenshot（未实现） ──
console.log('── 4.6.15 Screenshot')
{
  const present = await page.evaluate(() =>
    !!document.querySelector('vis-bug').$shadow.querySelector('li[data-tool="screenshot"]'))
  T('4.6.15', !present,
    'Screenshot 未实现：工具条里没有它的按钮，alert("Coming Soon!") 这条路径够不着')
}

// ── 4.6.17 只有 TRACKED_PROPS 里的属性才进改动记录 ──
console.log('── 4.6.17 上游工具的写入与改动记录')
{
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await pick('#t2')
  await activate('margin')
  const before = (await stats()).props
  await tap('ArrowRight')
  const afterMargin = (await stats()).props
  T('4.6.17', (await inline('#t2', 'margin-right')) === '1px' && afterMargin === before + 1,
    `margin-right 在 TRACKED_PROPS 里 → 进改动记录（props ${before} → ${afterMargin}）`)

  await activate('font')
  await tap('Meta+i')
  const afterItalic = (await stats()).props
  T('4.6.17', (await inline('#t2', 'font-style')) === 'italic' && afterItalic === afterMargin,
    `font-style 写进了 inline 却不在 TRACKED_PROPS 里 → 静默丢失（props 仍是 ${afterItalic}）`)

  await activate('align')
  await tap('Shift+ArrowDown')
  const afterAlignContent = (await stats()).props
  T('4.6.17', (await inline('#t2', 'align-content')) !== ''
    && afterAlignContent === afterItalic + 1,
    `align-content 同样不被跟踪，这一步只记下随手写的 display:flex（props ${afterItalic} → ${afterAlignContent}）`)
  await page.evaluate(() => { window.__visualRevise.store.undoEverything(); window.__visualRevise.store.history.clear() })
  await page.waitForTimeout(200)
}

// ── 4.6.14 图片拖放换图 ──
console.log('── 4.6.14 imageswap 拖放换图')
{
  await activate('guides')      // Move 工具会关掉 imageswap 的监听，先切回来
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const srcs0 = await page.evaluate(() => ({
    a: document.getElementById('picA').getAttribute('src'),
    b: document.getElementById('picB').getAttribute('src'),
  }))
  const a = mid(await box('#picA'))
  const b = mid(await box('#picB'))
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (const d of [6, 20, 40]) { await page.mouse.move(a.x + d, a.y); await page.waitForTimeout(40) }
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(500)
  const srcs1 = await page.evaluate(() => ({
    a: document.getElementById('picA').getAttribute('src'),
    b: document.getElementById('picB').getAttribute('src'),
  }))
  T('4.6.14', srcs0.a !== srcs0.b && srcs1.b === srcs0.a,
    `把一张图拖到另一张图上换掉它的 src（B 的 src 变成了 A 的：${srcs1.b === srcs0.a}）`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// ── 4.6.13 Search（放在最后：它会把焦点留在输入框里） ──
console.log('── 4.6.13 Search')
{
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await useTool('4.6.13', 'search', 'Search')
  const shown = await page.evaluate(() => {
    const li = document.querySelector('vis-bug').$shadow.querySelector('li[data-tool="search"]')
    const s = li.querySelector('.search')
    return { has: !!s, display: s?.style.display, focused: !!s?.querySelector('input') }
  })
  T('4.6.13', shown.has && shown.display === 'block' && shown.focused,
    `激活后工具条里出现搜索输入框（display=${shown.display}）`)

  const searchValue = () => page.evaluate(() => document.querySelector('vis-bug').$shadow
    .querySelector('li[data-tool="search"] input')?.value ?? '')

  // img / button 这两个查询里一个字母都不撞 Visual Revise 的模式热键
  await page.keyboard.type('img')
  await page.waitForFunction(() => document.querySelectorAll('img[data-selected]').length === 2,
    null, { timeout: 4000, polling: 50 }).catch(() => {})
  T('4.6.13', (await page.evaluate(() => document.querySelectorAll('img[data-selected]').length)) === 2,
    `CSS 选择器 img 批量选中两张图（输入框里是「${await searchValue()}」，`
    + `选中 ${await page.evaluate(() => document.querySelectorAll('img[data-selected]').length)} 张）`)

  await page.keyboard.press('Meta+a')
  await page.keyboard.type('button')
  await page.waitForFunction(() => document.querySelectorAll('button[data-selected]').length === 1,
    null, { timeout: 4000, polling: 50 }).catch(() => {})
  T('4.6.13', (await page.evaluate(() => document.querySelectorAll('button[data-selected]').length)) === 1
    && (await searchValue()) === 'button',
    `别名 / 选择器换成 button 也能批量选中（输入框里是「${await searchValue()}」，`
    + `选中 ${await page.evaluate(() => document.querySelectorAll('button[data-selected]').length)} 个）`)

  // 搜索框在 vis-bug 的 closed shadow 里，composedPath() 到宿主就断了，
  // isTypingTarget 认不出「用户正在输入」——a / f / v / c / l / p 这些
  // 模式热键于是照样抢走按键，字符直接丢在半路上。
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('images')
  await page.waitForTimeout(400)
  T('4.6.13', (await searchValue()) === 'images',
    `在搜索框里打字不该丢字符（打了 images，框里是「${await searchValue()}」）`)
}

console.log(`\n通过 ${passed} · 失败 ${failed}`)
await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
