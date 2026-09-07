// 独立复现脚本 · 清单 4.4.1（app/core/layout-drag.js:235-248）
//
// 报告称：layout-drag 只在 pointerdown 时挂 pointermove / pointerup，
// 从不听 pointercancel。浏览器一旦把手势升级成原生 HTML5 拖放
// （dragstart → pointercancel），pointermove / pointerup 就不再派发给页面，
// endDrag() 永远不被调用 —— dragging 卡在 true、拖影留在页面上、
// 源元素停在 opacity:.25、指示线与 [data-vr-drop-target] 也留着；
// 并且因为 dragging 卡在 true，用户下一次 Esc 会被 visual-revise.js:331-336
// 当成「取消拖拽」吃掉，做不了取消选中那件本来的事。
//
// 本脚本不复用 tests-e2e/full/drag-guides-upstream.mjs 的任何断言与原语。
// 特别是**不用**它的 startDrag()（3/7/12 三小步）与 dragToward() 的重试恢复 —— 那两个
// 就是绕开这条路径的测试侧变通，用了等于把要测的东西提前躲掉。
//
// 为了尽量**推翻**报告，额外验四件事：
//   A) 事件探针：确认浏览器确实发了 dragstart + pointercancel，且 pointerup
//      一次都没派发到页面 —— 否则「收不了尾」的原因就不是 pointercancel。
//   B) 对照组：同一套粗时序拖一个**非 draggable** 的普通 div（#r0 → #empty），
//      若它能正常收尾，说明问题不是脚本时序 / harness 的锅。
//   C) 反向对照：同一个 <img> 用小步（3/7/12px）越阈值时能否正常收尾 ——
//      若能，说明代码路径本身没坏，坏的只有被原生拖放劫持的那一支。
//   D) Esc 连带损伤：卡住之后先选中一个元素，再按一次 Esc，看这一次 Esc
//      是不是被当成 cancelDrag 吃掉（选中没被清）。
// 全程真实指针 / 键盘（page.mouse / page.keyboard），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

page.on('pageerror', e => console.log('  [页面异常]', e.message))

const log = (...a) => console.log(...a)
const sleep = ms => page.waitForTimeout(ms)

const box = async sel => {
  const b = await page.locator(sel).boundingBox()
  if (!b) throw new Error(`量不到 ${sel}`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, raw: b }
}

// 页面侧事件探针：记录 pointer / 原生拖放 两套事件的派发顺序
const installProbe = () => page.evaluate(() => {
  window.__probe = []
  const names = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
                 'dragstart', 'drag', 'dragover', 'drop', 'dragend', 'mouseup']
  window.__probeOff?.()
  const fns = names.map(n => {
    const f = e => {
      const last = window.__probe[window.__probe.length - 1]
      // pointermove / drag / dragover 太密，折叠成计数
      if (last && last.type === n && /move|^drag$|dragover/.test(n)) { last.n++; return }
      window.__probe.push({ type: n, n: 1 })
    }
    window.addEventListener(n, f, true)
    return [n, f]
  })
  window.__probeOff = () => fns.forEach(([n, f]) => window.removeEventListener(n, f, true))
})

const probe = () => page.evaluate(() =>
  window.__probe.map(e => e.n > 1 ? `${e.type}×${e.n}` : e.type).join(' → '))

const state = () => page.evaluate(() => ({
  dragging: window.__visualRevise.layoutDrag.dragging,
  ghost: !!document.getElementById('visual-revise-drag-ghost'),
  picOpacity: document.getElementById('pic')?.style.opacity ?? '',
  r0Opacity: document.getElementById('r0')?.style.opacity ?? '',
  indicator: document.getElementById('visual-revise-drop-indicator')?.style.display ?? '(无)',
  dropTargets: [...document.querySelectorAll('[data-vr-drop-target]')].map(n => n.id || n.tagName),
  moves: window.__visualRevise.store.stats().moves,
  picsKids: [...(document.getElementById('pics')?.children || [])].map(n => n.id).join(','),
  rowKids: [...(document.getElementById('row')?.children || [])].map(n => n.id).join(','),
  emptyKids: [...(document.getElementById('empty')?.children || [])].map(n => n.id).join(','),
  selected: [...document.querySelectorAll('[data-selected]')].map(n => n.id || n.tagName),
  picParent: document.getElementById('pic')?.parentElement?.id || '(无)',
}))

const load = async () => {
  await page.goto(`${origin}/full/fixtures/drag-guides-upstream-drag.html`)
  await injectVisBug(page, origin)
  await page.waitForFunction(() => !!window.__visualRevise, null, { timeout: 10000 })
  await sleep(300)
  await page.keyboard.press('Escape')   // 清掉注入时可能带的选中
  await sleep(150)
}

// 报告描述的时序：按下后以 2px 为步长慢慢挪到 +10px。
// layout-drag 在 4px 处 beginDrag，浏览器随后在自己的阈值上发 dragstart。
const slowStart = async (from, stepPx = 2, maxPx = 10, gap = 40) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let d = stepPx; d <= maxPx; d += stepPx) {
    await page.mouse.move(from.x + d, from.y)
    await sleep(gap)
  }
}

let real = 0, refuted = 0
const T = (cond, msg) => { cond ? real++ : refuted++; log(`  ${cond ? '✔' : '✘'} ${msg}`) }

log('\n=== 4.4.1 / pointercancel 收尾 · 独立复现 ===\n')

// ─────────────────────────────────────────────────────────────
// ① 主复现：<img>（原生 draggable）+ 报告给的慢速时序
// ─────────────────────────────────────────────────────────────
await load()
await installProbe()

const pic = await box('#pic')
const empty = await box('#empty')
log(`  #pic 中心 (${pic.x.toFixed(0)}, ${pic.y.toFixed(0)})　#empty 中心 (${empty.x.toFixed(0)}, ${empty.y.toFixed(0)})`)

await slowStart(pic)

const mid = await state()
log(`\n  [越过阈值后] dragging=${mid.dragging} ghost=${mid.ghost} #pic.opacity=${mid.picOpacity || '(空)'}`)
T(mid.dragging === true && mid.ghost, 'layout-drag 确实起了拖（前提成立）')

await page.mouse.move(empty.x, empty.y, { steps: 8 })
await sleep(120)
const overEmpty = await state()
log(`  [移到 #empty 上] dropTargets=[${overEmpty.dropTargets}] indicator=${overEmpty.indicator}`)

await page.mouse.up()
await sleep(500)

const after = await state()
const seq = await probe()
log(`\n  [松手 + 500ms 后]`)
log(`    dragging      = ${after.dragging}`)
log(`    拖影存在      = ${after.ghost}`)
log(`    #pic.opacity  = ${after.picOpacity || '(空)'}`)
log(`    指示线 display= ${after.indicator}`)
log(`    dropTargets   = [${after.dropTargets}]`)
log(`    store.moves   = ${after.moves}`)
log(`    #pics 子节点  = ${after.picsKids}　#empty 子节点 = ${after.emptyKids || '(空)'}`)
log(`\n    事件序列: ${seq}`)

const gotCancel = /pointercancel/.test(seq)
const gotDragstart = /dragstart/.test(seq)
const noPointerup = !/pointerup/.test(seq)
log(`\n  [事件面] dragstart=${gotDragstart} pointercancel=${gotCancel} pointerup 从未派发=${noPointerup}`)

const stuck = after.dragging === true
T(gotDragstart && gotCancel, 'A) 浏览器确实把手势升级成原生拖放（dragstart + pointercancel）')
T(noPointerup, 'A) pointerup 一次都没派发给页面')
T(stuck, '主张：松手后 layoutDrag.dragging 仍为 true（这一次拖拽收不了尾）')
T(after.ghost, '主张：#visual-revise-drag-ghost 仍浮在页面上')
T(after.picOpacity === '0.25', '主张：#pic 仍停在 opacity:0.25')
T(after.dropTargets.length > 0 || after.indicator === 'block',
  '主张：指示线 / [data-vr-drop-target] 未清理')
T(after.moves === 0 && after.emptyKids === '',
  '主张：这次移动被静默丢弃（moves=0、DOM 没动）')

// ─────────────────────────────────────────────────────────────
// ④ Esc 连带损伤：卡住之后，下一次 Esc 被当成 cancelDrag 吃掉
// ─────────────────────────────────────────────────────────────
if (stuck) {
  // D1) 卡住期间拖影跟不跟手？（判断这是不是一个用户看得见的"僵尸"状态）
  await page.mouse.move(400, 700)
  await sleep(150)
  const roam = await state()
  log(`\n  [不按键，只挪鼠标到 (400,700)] ghost=${roam.ghost} dragging=${roam.dragging}`)

  // D2) 报告说下一次 Esc 会被 cancelDrag 吃掉。先看看在碰任何别的东西之前按 Esc。
  const beforeEsc = await state()
  await page.keyboard.press('Escape')
  await sleep(250)
  const esc1 = await state()
  log(`  [直接按 Esc] dragging ${beforeEsc.dragging}→${esc1.dragging}　ghost ${beforeEsc.ghost}→${esc1.ghost}`)
  T(beforeEsc.dragging === true && esc1.dragging === false,
    'D) 卡住之后的第 1 次 Esc 确实被 cancelDrag 吃掉（用户想做的取消选中 / 退模式没发生）')
}

// ─────────────────────────────────────────────────────────────
// D2) 更要命的一支：卡住之后，下一次在页面上按下-松开会用**过期的落点**提交
// ─────────────────────────────────────────────────────────────
log('\n  ── D2) 卡住之后，下一次点击是否用过期落点提交这次拖拽 ──')
await load()
await installProbe()
const pic3 = await box('#pic')
const empty4 = await box('#empty')
await slowStart(pic3)
await page.mouse.move(empty4.x, empty4.y, { steps: 8 })
await sleep(120)
await page.mouse.up()
await sleep(400)
const beforeClick = await state()
log(`    [卡住] dragging=${beforeClick.dragging} moves=${beforeClick.moves} #pics=${beforeClick.picsKids} 悬停落点=[${beforeClick.dropTargets}]`)
if (beforeClick.dragging) {
  const r1b = await box('#r1')
  await page.mouse.click(r1b.x, r1b.y)   // 用户只想点选 #r1
  await sleep(400)
  const afterClick = await state()
  log(`    [点了一下 #r1] dragging=${afterClick.dragging} moves=${afterClick.moves}`)
  log(`      #pics=${afterClick.picsKids}　#row=${afterClick.rowKids}　#empty=${afterClick.emptyKids || '(空)'}`)
  log(`      #pic 的新父级=${afterClick.picParent}（拖之前是 pics）　selected=[${afterClick.selected}]`)
  T(afterClick.moves > beforeClick.moves || afterClick.picsKids !== beforeClick.picsKids,
    'D2) 下一次点击把这次早已结束的拖拽用过期落点提交了（用户只是想点选别的元素）')
}

// ─────────────────────────────────────────────────────────────
// ② 对照组：非 draggable 的普通 div，同一套粗时序
// ─────────────────────────────────────────────────────────────
log('\n  ── 对照组 B) 同样时序拖普通 div #r0 → #empty ──')
await load()
await installProbe()
const r0 = await box('#r0')
const empty2 = await box('#empty')
await slowStart(r0)
await page.mouse.move(empty2.x, empty2.y, { steps: 8 })
await sleep(120)
await page.mouse.up()
await sleep(500)
const ctrl = await state()
const ctrlSeq = await probe()
log(`    dragging=${ctrl.dragging} ghost=${ctrl.ghost} #r0.opacity=${ctrl.r0Opacity || '(空)'} moves=${ctrl.moves}`)
log(`    #row=${ctrl.rowKids}　#empty=${ctrl.emptyKids || '(空)'}`)
log(`    事件序列: ${ctrlSeq}`)
T(ctrl.dragging === false && !ctrl.ghost && ctrl.moves === 1,
  'B) 对照组正常收尾并提交 —— 说明时序 / harness 不是原因')

// ─────────────────────────────────────────────────────────────
// ③ 反向对照：同一个 <img>，用现有测试的小步（3/7/12px）
// ─────────────────────────────────────────────────────────────
log('\n  ── 反向对照 C) 同一个 <img>，改用 3/7/12px 小步越阈值 ──')
await load()
await installProbe()
const pic2 = await box('#pic')
const empty3 = await box('#empty')
await page.mouse.move(pic2.x, pic2.y)
await page.mouse.down()
for (const d of [3, 7, 12]) { await page.mouse.move(pic2.x + d, pic2.y + d); await sleep(20) }
await page.mouse.move(empty3.x, empty3.y, { steps: 6 })
await sleep(120)
await page.mouse.up()
await sleep(500)
const fast = await state()
const fastSeq = await probe()
log(`    dragging=${fast.dragging} ghost=${fast.ghost} #pic.opacity=${fast.picOpacity || '(空)'} moves=${fast.moves}`)
log(`    #pics=${fast.picsKids}　#empty=${fast.emptyKids || '(空)'}`)
log(`    事件序列: ${fastSeq}`)
log(`    → 小步能收尾=${fast.dragging === false}（若能，说明只有被原生拖放劫持的那一支坏）`)

log(`\n=== 结论：支持报告 ${real} 条 / 反驳 ${refuted} 条 ===\n`)

await browser.close()
await close()
