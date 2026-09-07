// 独立复现脚本 · 清单 4.3.7
//
// 报告称：双击进入文字编辑态后按 Escape 退不出来 —— contenteditable / spellcheck
// 都还在，还能接着打字；text.js:37 的 hotkeys('escape,esc', cleanup) 被
// hotkeys-js 的默认 filter（target.isContentEditable → 不派发）整个挡掉，
// 是死代码。Escape 被宿主 visual-revise.js:344-354 拿去做「取消选中」。
//
// 本脚本不复用 tests-e2e/full/select-handles-text.mjs 的任何断言，全部重测。
// 特别要**推翻**报告，所以额外验三件事：
//   1) 现有 full 测试里那条 4.3.7 是不是靠「按 Escape 之前焦点已经跑掉、
//      blur 顺手摘了 contenteditable」而假通过的 —— 所以这里全程不碰面板、
//      不 evaluate 抢焦点，按 Escape 之前先确认 activeElement 就是 #texty。
//   2) 第一次 Escape 会被宿主 stopPropagation（选中数 > 0 时），
//      但第二、三次选中已经是 0、宿主不再拦，事件能冒泡到 document ——
//      在 document 冒泡阶段挂一个探针，若探针收到了 Escape，说明
//      hotkeys 的 keydown listener 也收到了，那么没执行 cleanup 只能是
//      filter 挡的（= 报告说的死代码），而不是被 stopPropagation 掐掉。
//   3) 对照组：点别处失焦这条路必须真的能退出编辑态，
//      否则问题不是「Escape 失灵」而是「编辑态根本摘不掉」。
// 全程真实指针 / 键盘（page.mouse / page.keyboard），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))

const log = (...a) => console.log(...a)

await page.goto(`${origin}/full/fixtures/select-handles-text-page.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(500)

log('\n=== 4.3.7 Escape 退出文字编辑态 · 独立复现 ===\n')

// ── 工具 ────────────────────────────────────────────────────
const R = id => page.evaluate(i => {
  const r = document.getElementById(i).getBoundingClientRect()
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
}, id)

// 编辑态全景：只读，不碰焦点
const state = () => page.evaluate(() => {
  const e = document.getElementById('texty')
  const vb = document.querySelector('vis-bug')
  return {
    ce: e.isContentEditable,
    spellcheck: e.getAttribute('spellcheck'),
    ceAttr: e.getAttribute('contenteditable'),
    active: document.activeElement?.id || document.activeElement?.tagName?.toLowerCase(),
    selCount: document.querySelectorAll('[data-selected]').length,
    text: e.textContent,
    tool: vb?.activeTool?.dataset?.tool ?? vb?.activeTool ?? null,
    mode: window.__visualRevise?.mode ?? null,
  }
})

const clickCenter = async id => {
  const b = await R(id)
  await page.mouse.move(b.cx, b.cy)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(350)
}

const enterEdit = async id => {
  const b = await R(id)
  await page.mouse.dblclick(Math.round(b.cx), Math.round(b.cy))
  await page.waitForTimeout(450)
}

// document 冒泡阶段探针：Escape 到底有没有走到 hotkeys 的 listener 那一层
const installProbe = () => page.evaluate(() => {
  window.__esc = []
  window.__probe && document.removeEventListener('keydown', window.__probe)
  window.__probe = e => { if (e.key === 'Escape') window.__esc.push({
    phase: 'document-bubble',
    target: e.target?.id || e.target?.tagName?.toLowerCase(),
    targetIsContentEditable: e.target?.isContentEditable === true,
    defaultPrevented: e.defaultPrevented,
  }) }
  document.addEventListener('keydown', window.__probe)   // 冒泡阶段
})
const probeLog = () => page.evaluate(() => window.__esc)

// ══════════════════════════════════════════════════════════
// 1. 进编辑态（真实双击），并确认焦点确实还在 #texty 上
// ══════════════════════════════════════════════════════════
log('--- 1. 双击 #texty 进入编辑态 ---')
await enterEdit('texty')
const s0 = await state()
log('  [进入后]', JSON.stringify(s0))
const entered = s0.ce && s0.spellcheck === 'true' && s0.active === 'texty'
log(`  ==> 1 编辑态成立且焦点在 #texty = ${entered}`)

// 真的能打字（证明这是活的编辑态，后面的「还能打字」才有意义）
await page.keyboard.press('End')
await page.keyboard.type('!!')
await page.waitForTimeout(300)
log('  [键入 !! 之后 text]', JSON.stringify((await state()).text))

await installProbe()

// ══════════════════════════════════════════════════════════
// 2. 连按 3 次 Escape，每次都读状态（按之前先确认焦点没跑）
// ══════════════════════════════════════════════════════════
log('\n--- 2. 连按 3 次 Escape ---')
const after = []
for (let i = 1; i <= 3; i++) {
  const pre = await state()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  const post = await state()
  after.push(post)
  log(`  Esc#${i} 按之前 active=${pre.active} sel=${pre.selCount} ce=${pre.ce}`)
  log(`  Esc#${i} 按之后 ${JSON.stringify(post)}`)
}
const esc = await probeLog()
log('  [document 冒泡阶段探针]', JSON.stringify(esc))

const stillEditing = after[2].ce === true && after[2].spellcheck === 'true'
log(`  ==> 2A 三次 Escape 之后仍是编辑态（ce=${after[2].ce} spellcheck=${after[2].spellcheck}）= ${stillEditing}`)
log(`  ==> 2B 焦点仍在 #texty = ${after[2].active === 'texty'}`)
log(`  ==> 2C 选中数 ${s0.selCount} → ${after[0].selCount} → ${after[1].selCount} → ${after[2].selCount}`)

// ══════════════════════════════════════════════════════════
// 3. Escape 之后还能不能继续输入（用户视角的「没退出」）
// ══════════════════════════════════════════════════════════
log('\n--- 3. Escape 之后继续打字 ---')
const beforeType = (await state()).text
await page.keyboard.press('End')
await page.keyboard.type('ZZ')
await page.waitForTimeout(350)
const afterType = (await state()).text
log(`  [打字前] ${JSON.stringify(beforeType)}  →  [打字后] ${JSON.stringify(afterType)}`)
const stillTypable = afterType !== beforeType && /ZZ$/.test(afterType)
log(`  ==> 3 Escape 之后元素还能继续输入 = ${stillTypable}`)

// ══════════════════════════════════════════════════════════
// 4. 机制判定：Escape 有没有走到 hotkeys 的那一层
//    第 2、3 次按时选中已经是 0，宿主的 Escape 分支不会 stopPropagation，
//    事件应当冒泡到 document —— 探针收到了就说明 hotkeys 的 listener 也收到了，
//    cleanup 仍然没跑 ⇒ 是 filter（target.isContentEditable）挡的。
// ══════════════════════════════════════════════════════════
log('\n--- 4. 机制判定 ---')
const reachedBubble = esc.filter(x => x.targetIsContentEditable)
log(`  Escape 冒泡到 document 的次数 = ${esc.length}（其中 target 是 contenteditable 的 ${reachedBubble.length} 次）`)
log(`  ==> 4 事件到过 hotkeys 那一层但 cleanup 没跑（= filter 挡掉、死代码）= ${reachedBubble.length > 0 && stillEditing}`)

// ══════════════════════════════════════════════════════════
// 5. 对照组：点别处失焦，编辑态必须能退出
// ══════════════════════════════════════════════════════════
log('\n--- 5. 对照：点 #solo 失焦 ---')
await clickCenter('solo')
const s5 = await state()
log('  [失焦后]', JSON.stringify(s5))
const blurWorks = s5.ce === false && s5.spellcheck === null
log(`  ==> 5 点别处失焦能退出编辑态 = ${blurWorks}`)

// ══════════════════════════════════════════════════════════
// 6. 反向对照：不在编辑态时，Escape 走的是「取消选中」
//    （证明宿主那条 Escape 链路本身是通的，问题只在编辑态）
// ══════════════════════════════════════════════════════════
log('\n--- 6. 反向对照：普通选中态按 Escape ---')
await clickCenter('list')
const sel6a = (await state()).selCount
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const sel6b = (await state()).selCount
log(`  选中数 ${sel6a} → ${sel6b}`)
log(`  ==> 6 非编辑态 Escape 能取消选中 = ${sel6a > 0 && sel6b === 0}`)

// ══════════════════════════════════════════════════════════
// 7. 复现二遍（同一进程内重进编辑态再按一次，排除一次性巧合）
// ══════════════════════════════════════════════════════════
log('\n--- 7. 二次复现：重新进编辑态再按 Escape ---')
await enterEdit('texty')
const s7a = await state()
await page.keyboard.press('Escape')
await page.waitForTimeout(350)
const s7b = await state()
log('  [进入]', JSON.stringify(s7a))
log('  [Esc]', JSON.stringify(s7b))
log(`  ==> 7 第二轮同样退不出 = ${s7a.ce === true && s7b.ce === true}`)

log('\n================ 结论 ================')
log('1 双击进入编辑态且焦点在 #texty        :', entered)
log('2 三次 Escape 之后仍 contenteditable   :', stillEditing)
log('3 Escape 之后仍能继续输入              :', stillTypable)
log('4 事件到过 hotkeys 层但 cleanup 未跑    :', reachedBubble.length > 0 && stillEditing)
log('5 点别处失焦能退出（唯一可行出口）      :', blurWorks)
log('6 非编辑态 Escape 取消选中正常          :', sel6a > 0 && sel6b === 0)
log('7 第二轮复现同样退不出                 :', s7a.ce === true && s7b.ce === true)
log('页面异常                               :', pageErrors.length ? pageErrors.join(' / ') : '无')
log('=====================================\n')

await browser.close(); await close()
