// 独立复现脚本 · 清单 4.2.2（缩放把手写的 transform 不进改动记录 / 提示词）
//
// 报告称：动态建 220×140 的 #probe，选中后拖 top-start 把手 +40/+30，
//         元素被写上 width / height / transform 三条 inline 声明，
//         但 store.read().edits 里那条记录只有 width、height，
//         buildPrompt 出来的提示词里搜不到 transform。
// 怀疑：app/core/tracked-props.js:22-33（Position 组只有 rotate，没有 transform）
//       app/core/snapshot.js:67-88（readComputed / readInline 只遍历 TRACKED_PROPS）
//       app/components/selection/handle.element.js:71-155（把手写 sourceEl.style.transform）
//
// 期望依据（查过，没有把「transform 不进记录」写成有意设计的地方）：
//   - docs/PRD.md:259「工具的终点是一段 AI 能拿去改源码的提示词。记录必须完整、可回退、可带走。」
//   - docs/PRD.md:268 AC-8.6「提示词：包含元素定位、属性改动、…」——没有任何「某些属性有意不导出」的口径。
//   - docs/PRD.md 全文没有 TRACKED_PROPS / 把手 / 缩放 这几个词，也没有为 transform 开的例外。
//   - app/core/tracked-props.js 的 Position 组注释只解释了「为什么用 rotate 而不是 transform: rotate()」
//     （controls.js:85-86：计算值好解析），没说 translate 类位移可以丢。
//   - docs/plans/feature-inventory.md:462 与 :769-772 反过来把这条写成「会**静默丢改动**的路径」
//     和「三块最大的缺口」之一——文档口径是缺口，不是有意设计。
//
// 本脚本不复用 tests-e2e/full/select-handles-text.mjs 的任何断言，自己重新测；
// 全程真实指针（page.mouse.down/move/up），不用 element.click()。
// 除了「记录里有没有 transform」，还量了这条丢失在几何上值多少像素：
// 把记录里真正存下来的那几条属性重放到一个干净副本上，看它跟用户看到的框差多远。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/select-handles-text-page.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })

const log = (...a) => console.log(...a)
const PROBE_W = 220, PROBE_H = 140
const PROBE_L = 640, PROBE_T = 560

const R = id => page.evaluate(i => {
  const b = document.getElementById(i).getBoundingClientRect()
  return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height,
           cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
}, id)

// 真实点击：点元素中心（把手热区向外扩 12px，中心是唯一抢不走的位置）
const pick = async id => {
  const r = await R(id)
  await page.mouse.move(Math.round(r.cx), Math.round(r.cy))
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(320)
}
const clearSel = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(220) }

const makeProbe = async () => {
  await clearSel()
  await page.evaluate(([w, h, l, t]) => {
    document.getElementById('probe')?.remove()
    const d = document.createElement('div')
    d.id = 'probe'
    d.style.cssText = `position:absolute;left:${l}px;top:${t}px;width:${w}px;height:${h}px;background:#2a2a33;border:1px solid #444`
    document.body.appendChild(d)
  }, [PROBE_W, PROBE_H, PROBE_L, PROBE_T])
  await page.waitForTimeout(200)
  await pick('probe')
}

const resetStore = () => page.evaluate(() => {
  window.__visualRevise.store.clear()
  window.__visualRevise.store.history?.clear?.()
})

// 按住元素外接框左上角往右下拖
const dragTopStart = async (dx, dy) => {
  const r = await R('probe')
  const hx = Math.round(r.l), hy = Math.round(r.t)
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.waitForTimeout(120)
  await page.mouse.move(hx + dx, hy + dy, { steps: 6 })
  await page.waitForTimeout(220)
  await page.mouse.up()
  await page.waitForTimeout(300)
}

// 记录里那条 #probe 的全部改动（prop / from / to 都要，不只属性名）
const probeChanges = () => page.evaluate(() => {
  const rec = window.__visualRevise.store.read().edits.find(e => e.el?.id === 'probe')
  if (!rec) return null
  return {
    props: (rec.changes || []).map(c => c.prop),
    detail: (rec.changes || []).map(c => `${c.prop}: ${c.from} → ${c.to}`),
  }
})

const inlineOf = () => page.evaluate(() => {
  const e = document.getElementById('probe')
  return { style: e.getAttribute('style'), w: e.style.width, h: e.style.height,
           tr: e.style.transform, left: e.style.left, top: e.style.top }
})

const prompt = () => page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))

const exported = () => page.evaluate(() => {
  try { return JSON.stringify(window.__visualRevise.lib.exportJSON()) } catch (e) { return 'ERR ' + e.message }
})

const reload = async () => {
  await page.goto(FIXTURE)
  await injectVisBug(page, origin)
  await page.waitForTimeout(400)
}

// ══════════════════════════════════════════════════════════
const runOnce = async label => {
  log(`\n=== ${label} ===`)
  await reload()
  await makeProbe()
  // store.clear() 会把快照一并丢掉（change-store.js:1006 snapshots.clear()），
  // 而快照是选中时由属性面板 ChangeStore.track(el) 建的。
  // 所以先清，再重新选一次，让 #probe 带着干净的起点快照进入这一轮。
  await resetStore()
  await clearSel()
  await pick('probe')
  log('[起点] 快照已重建 =', await page.evaluate(() =>
    !!window.__visualRevise.store.read().edits || true))

  const before = await inlineOf()
  const boxBefore = await R('probe')
  log('[拖前] inline =', before.style)
  log('[拖前] 视觉框 =', JSON.stringify({ l: boxBefore.l, t: boxBefore.t, r: boxBefore.r, b: boxBefore.b }))

  await dragTopStart(40, 30)

  const after = await inlineOf()
  const boxAfter = await R('probe')
  log('[拖后] inline =', after.style)
  log('[拖后] 把手写出的三条 →  width =', after.w, ' height =', after.h, ' transform =', after.tr || '(空)')
  log('[拖后] left / top 没被碰过 →  left =', after.left, ' top =', after.top)
  log('[拖后] 视觉框 =', JSON.stringify({ l: boxAfter.l, t: boxAfter.t, r: boxAfter.r, b: boxAfter.b }),
      '（右下角固定，左上角跟着指针走 = 用户看到「变小并挪了位置」）')

  const ch = await probeChanges()
  log('[改动记录] #probe 那条 =', ch ? JSON.stringify(ch.props) : '(没有这条记录)')
  if (ch) ch.detail.forEach(d => log('           ', d))

  const p = await prompt()
  const hasTransform = /transform/.test(p)
  const hasWidth = /width/.test(p)
  const hasHeight = /height/.test(p)
  log('[提示词] 长度', p.length, ' 含 width =', hasWidth, ' 含 height =', hasHeight, ' 含 transform =', hasTransform)
  const promptLines = p.split('\n').filter(l => /probe|width|height|transform/.test(l))
  promptLines.slice(0, 12).forEach(l => log('           |', l))

  const ex = await exported()
  log('[exportJSON] 含 "transform" =', /transform/.test(ex), ' 含 "width" =', /width/.test(ex))

  // 只把记录里存下来的属性重放到一个干净副本上，量丢失值多少像素
  const replay = await page.evaluate(props => {
    const src = document.getElementById('probe')
    const clone = document.createElement('div')
    clone.id = 'probe-replay'
    // 原始声明（拖之前的那份）+ 记录里存下来的改动
    clone.style.cssText = 'position:absolute;left:640px;top:560px;width:220px;height:140px;background:#2a2a33;border:1px solid #444'
    for (const { prop, to } of props) clone.style.setProperty(prop, to)
    document.body.appendChild(clone)
    const a = src.getBoundingClientRect(), b = clone.getBoundingClientRect()
    clone.remove()
    return {
      user:   { l: a.left, t: a.top, r: a.right, b: a.bottom },
      replay: { l: b.left, t: b.top, r: b.right, b: b.bottom },
      dl: b.left - a.left, dt: b.top - a.top, dr: b.right - a.right, db: b.bottom - a.bottom,
    }
  }, await page.evaluate(() => {
    const rec = window.__visualRevise.store.read().edits.find(e => e.el?.id === 'probe')
    return (rec?.changes || []).map(c => ({ prop: c.prop, to: c.to }))
  }))
  log('[重放对比] 用户看到的框   =', JSON.stringify(replay.user))
  log('[重放对比] 只按记录重放的框 =', JSON.stringify(replay.replay))
  log('[重放对比] 四条边的偏差   = Δleft', replay.dl, ' Δtop', replay.dt, ' Δright', replay.dr, ' Δbottom', replay.db)

  // 撤销这条路是否还能救回来（快照存的是整段 style attr）
  await page.evaluate(() => window.__visualRevise.store.undoEverything())
  await page.waitForTimeout(300)
  const undone = await inlineOf()
  log('[undoEverything 后] inline =', undone.style, ' transform =', undone.tr || '(空)')

  return {
    inlineTransform: after.tr || '',
    recordedProps: ch ? ch.props : null,
    recordHasTransform: !!ch && ch.props.includes('transform'),
    promptHasTransform: hasTransform,
    promptHasWidth: hasWidth,
    exportHasTransform: /transform/.test(ex),
    drift: { dl: replay.dl, dt: replay.dt, dr: replay.dr, db: replay.db },
  }
}

const r1 = await runOnce('第 1 次：动态建 220×140 的 #probe → 选中 → 拖左上把手 +40/+30')
const r2 = await runOnce('第 2 次：同样步骤，重新加载页面从头再来一遍')

log('\n================ 结论 ================')
for (const [i, r] of [r1, r2].entries()) {
  log(`第 ${i + 1} 次：`)
  log('   把手真的写了 transform      :', r.inlineTransform || '(没写)')
  log('   改动记录里的属性            :', JSON.stringify(r.recordedProps))
  log('   记录里含 transform          :', r.recordHasTransform)
  log('   提示词里含 width / transform:', r.promptHasWidth, '/', r.promptHasTransform)
  log('   exportJSON 里含 transform   :', r.exportHasTransform)
  log('   只按记录重放的四边偏差      :', JSON.stringify(r.drift))
}
const stable = r1.recordHasTransform === r2.recordHasTransform
           && r1.promptHasTransform === r2.promptHasTransform
           && !!r1.inlineTransform && !!r2.inlineTransform
log('两次结果一致（稳定复现）:', stable)
log('=====================================\n')

await browser.close(); await close()
