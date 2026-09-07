// 独立复现脚本 · 清单 4.1.3（hover 是否会抛未捕获异常）
//
// 报告称：Shift 取消其中一个选中项之后，此后每次 hover 都抛
//         InvalidStateError: Failed to execute 'showPopover' ... disconnected popover elements
// 怀疑：app/features/selectable.js:120-137 的 unselect —— 只把匹配 data-label-id 的
//       覆盖层节点 .remove() 掉，没有把它们从闭包里的 labels / handles 数组里剔除
//       （`[...labels, ...handles].filter().forEach(remove)` 产生的是新数组，
//        两个原数组没被重新赋值）；
//       app/features/selectable.js:454-460 的 on_hover 末尾「force promote into top layer」
//       仍旧 handles.forEach(...showPopover())，对已断开的节点调用就抛。
//
// 期望依据（查过，没有把「hover 抛异常」写成有意设计的地方）：
//   - docs/PRD.md:86 AC-3.3「hover 时显示悬停框与标签，不影响已选中项」——没有任何异常/降级的说法。
//   - docs/plans/feature-inventory.md:438 对 4.1.3 的描述是「画悬停框 + 标签，不影响已选中项」，
//     :437 对 4.1.2 的描述是「已选中的再 Shift 点则取消它」，都没提会留下断开的覆盖层。
//   - app/features/selectable.js:120-137（unselect）通篇无注释；:454 只有一行
//     `// force promote into top layer`，没有说要容忍已断开的节点。
//
// 本脚本不复用 tests-e2e/full/select-handles-text.mjs 的任何断言，自己重新测；
// 全程真实指针 / 真实键盘（page.mouse + page.keyboard），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/select-handles-text-page.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })

const log = (...a) => console.log(...a)

// 未捕获异常收集（on_hover 是 mousemove 监听器，里面抛出来的就是 window error）
const errs = []
page.on('pageerror', e => errs.push(e.message))
const takeErrs = () => { const out = errs.slice(); errs.length = 0; return out }

const R = id => page.evaluate(i => {
  const b = document.getElementById(i).getBoundingClientRect()
  return { l: b.left, t: b.top, w: b.width, h: b.height,
           cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
}, id)

// 真实点击：按下 / 抬起都带上当前按住的修饰键；点元素中心（把手热区向外扩 12px）
const clickAt = async (x, y, mods = []) => {
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.move(Math.round(x), Math.round(y))
  await page.mouse.down(); await page.mouse.up()
  for (const m of mods) await page.keyboard.up(m)
  await page.waitForTimeout(300)
}
const pick = async (id, mods = []) => { const r = await R(id); await clickAt(r.cx, r.cy, mods) }

// 真实 hover：移到某个元素中心（多走几步，确保真的派发了 mousemove）
const hover = async (id, dx = 0, dy = 0) => {
  const r = await R(id)
  await page.mouse.move(Math.round(r.cx + dx), Math.round(r.cy + dy), { steps: 3 })
  await page.waitForTimeout(180)
}
// 把鼠标移开到页面空白处，让下一次 hover 一定是「换了 target」
const park = async () => { await page.mouse.move(900, 830, { steps: 2 }); await page.waitForTimeout(120) }

const selIds = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(e => e.id || `<${e.tagName.toLowerCase()}>`))

// 页面上真实存在的覆盖层节点数（断开的节点不在 DOM 里，数不到）
const overlays = () => page.evaluate(() => ({
  handles:  document.querySelectorAll('visbug-handles').length,
  labels:   document.querySelectorAll('visbug-label').length,
  hover:    document.querySelectorAll('visbug-hover').length,
  distance: document.querySelectorAll('visbug-distance').length,
}))

const tool = () => page.evaluate(() => {
  const vb = document.querySelector('vis-bug')
  return vb.activeTool?.dataset?.tool ?? vb.activeTool ?? '?'
})

const reload = async () => {
  await page.goto(FIXTURE)
  await injectVisBug(page, origin)
  await page.waitForTimeout(400)
  takeErrs()
}

log('\n=== 4.1.3 hover 是否抛未捕获异常 · 独立复现 ===\n')

// ── A. 报告的原始路径 ───────────────────────────────────────────────
await reload()
log('--- A. 选 #a → Shift 加选 #c → Shift 再点 #c 取消 → hover #d ---')
log('[默认工具] =', await tool())
await pick('a')
log('[点 #a 后]        选中 =', JSON.stringify(await selIds()), ' 覆盖层 =', JSON.stringify(await overlays()))
await pick('c', ['Shift'])
log('[Shift 点 #c 后]  选中 =', JSON.stringify(await selIds()), ' 覆盖层 =', JSON.stringify(await overlays()))
await pick('c', ['Shift'])
log('[Shift 再点 #c 后] 选中 =', JSON.stringify(await selIds()), ' 覆盖层 =', JSON.stringify(await overlays()))
const beforeHover = takeErrs()
log('[hover 之前累计的未捕获异常] =', beforeHover.length, beforeHover.length ? JSON.stringify(beforeHover) : '')

await park()
await hover('d')
const eA = takeErrs()
log('[hover #d 之后] 未捕获异常 =', eA.length, '条')
eA.slice(0, 3).forEach((m, i) => log(`   #${i + 1} ${m}`))
log('[hover #d 之后] 覆盖层 =', JSON.stringify(await overlays()),
    '（guides 工具下 hover 会画测距线 visbug-distance）')

// ── A2. 「此后每次 hover 都会再抛一次」 ──────────────────────────────
log('\n--- A2. 连续 hover 5 次（#texty / #solo / #d / #b / #inner），每次单独计数 ---')
const targets = ['texty', 'solo', 'd', 'b', 'inner']
const perHover = []
for (const t of targets) {
  await park()
  await hover(t)
  const n = takeErrs()
  perHover.push({ t, n: n.length, first: n[0] || '' })
  log(`   hover #${t} → 未捕获异常 ${n.length} 条`)
}

// ── B. 对照组：不做「取消其中一个」这一步 ───────────────────────────
await reload()
log('\n--- B. 对照：只选 #a + Shift 加选 #c（不取消），再 hover #d ---')
await pick('a')
await pick('c', ['Shift'])
log('[两个都选中] 选中 =', JSON.stringify(await selIds()), ' 覆盖层 =', JSON.stringify(await overlays()))
takeErrs()
await park(); await hover('d')
const eB1 = takeErrs()
await park(); await hover('texty')
const eB2 = takeErrs()
log('[hover #d]     未捕获异常 =', eB1.length)
log('[hover #texty] 未捕获异常 =', eB2.length)

// ── C. 对照：Esc 全部取消（unselect_all 会把两个数组清空）后再 hover ──
log('\n--- C. 对照：在 A 的状态上按 Esc 全部取消，再 hover ---')
await reload()
await pick('a'); await pick('c', ['Shift']); await pick('c', ['Shift'])
takeErrs()
await park(); await hover('d')
const eC0 = takeErrs()
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
takeErrs()
await park(); await hover('d')
const eC1 = takeErrs()
await park(); await hover('texty')
const eC2 = takeErrs()
log('[Esc 前 hover #d]  未捕获异常 =', eC0.length)
log('[Esc 后 选中]      =', JSON.stringify(await selIds()), ' 覆盖层 =', JSON.stringify(await overlays()))
log('[Esc 后 hover #d]  未捕获异常 =', eC1.length)
log('[Esc 后 hover #texty] 未捕获异常 =', eC2.length)

// ── D. 连带后果：异常之后再 Shift 加选一个，覆盖层还能画出来吗 ────────
log('\n--- D. 在 A 的坏状态上 Shift 加选 #d，看新选中项的把手 / 标签有没有被异常打断 ---')
await reload()
await pick('a'); await pick('c', ['Shift']); await pick('c', ['Shift'])
takeErrs()
await pick('d', ['Shift'])
const eD = takeErrs()
log('[Shift 加选 #d 后] 选中 =', JSON.stringify(await selIds()),
    ' 覆盖层 =', JSON.stringify(await overlays()))
log('[Shift 加选 #d 后] 未捕获异常 =', eD.length, eD.slice(0, 2).map(m => '\n   ' + m).join(''))

log('\n================ 结论 ================')
log('A  取消 #c 后第一次 hover #d 的未捕获异常数 :', eA.length)
log('A  异常首条                                :', eA[0] || '(无)')
log('A2 连续 5 次 hover 各自的异常数            :',
    JSON.stringify(perHover.map(p => `${p.t}:${p.n}`)))
log('B  不取消（两个都选中）hover 的异常数      :', eB1.length, '/', eB2.length)
log('C  Esc 全部取消后 hover 的异常数           :', eC1.length, '/', eC2.length, '（Esc 前是', eC0.length, '）')
log('D  坏状态下再 Shift 加选 #d 的异常数       :', eD.length)
log('=====================================\n')

await browser.close(); await close()
