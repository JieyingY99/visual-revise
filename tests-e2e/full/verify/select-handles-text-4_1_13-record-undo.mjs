// 独立复现脚本 · 清单 4.1.13（⌘G 分组 / ⌘⇧G 取消分组 的「记录 / 撤销」这一面）
//
// 注：同目录下已有一份 select-handles-text-4_1_13.mjs，测的是同一编号的另一件事
//     （分组会不会搬动兄弟顺序）。本文件另起一个名字，避免互相覆盖。
//
// 报告称：⌘G 改了 DOM 结构，但 store.stats().total 仍是 0、store.canUndo 仍是 false，
//        结构改动既不进提示词也退不回来；⌘Z 反而会去撤销更早的一条无关操作。
// 怀疑：app/features/selectable.js:312-340 的 on_group 全程只用原生 DOM API
//      （createElement / appendChild / prepend / removeChild），
//      对照 app/core/change-store.js 的 moveElement / removeElements 才是入账通道。
//
// 期望依据（先查过，不是脑补的）：
//   - docs/PRD.md 全文搜「分组」只命中 AC-6.14（属性面板的折叠分组）与 AC-8.1（改动记录按
//     元素分组），跟 ⌘G 的 DOM 分组无关；PRD 没有任何一条把「⌘G 不进记录」写成有意设计。
//   - docs/plans/feature-inventory.md:448 这条的 AC 覆盖栏写的是 **无**；:736 与 :773-775
//     把它列进「需要断言『要么进记录且可撤销，要么被明确禁用』」的清单。
//   - app/features/selectable.js 的 on_group 上下没有任何注释解释「为什么不入账」。
//   - 反面参照：同为结构性操作的 Delete 被 visual-revise.js:259-280 明确接管并走
//     ChangeStore.removeElements，注释写着「记录与删除必须是一件事」——说明「结构改动要入账」
//     是这个 fork 自己立的规矩。本脚本 E 段把这条对照一起跑出来。
//
// 本脚本不复用 tests-e2e/full/select-handles-text.mjs 的任何断言，全部自己重新测。
// 全程真实指针 / 真实键盘（page.mouse + page.keyboard），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/select-handles-text-page.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const log = (...a) => console.log(...a)

await page.goto(FIXTURE)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

log('\n=== 4.1.13 ⌘G / ⌘⇧G 的记录与撤销 · 独立复现 ===\n')
log('[环境] 页面里跑的这份构建于 =',
  await page.evaluate(() => window.__visualRevise.build))

// ── 探针 ────────────────────────────────────────────────────
const stats   = () => page.evaluate(() => window.__visualRevise.store.stats())
const canUndo = () => page.evaluate(() => window.__visualRevise.store.canUndo)
const selIds  = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(e => e.id || `<${e.tagName.toLowerCase()}>`))
const prompt  = () => page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read(), { url: location.href }))

const shape = () => page.evaluate(() => {
  const list = document.getElementById('list')
  const b = document.getElementById('b')
  const name = el => el ? (el.id || `<${el.tagName.toLowerCase()}>`) : '(无)'
  return {
    children: [...list.children].map(el =>
      el.id || `<${el.tagName.toLowerCase()}:[${[...el.children].map(c => c.id || c.tagName.toLowerCase()).join(',')}]>`),
    bParent: name(b?.parentElement),
    bGrandparent: name(b?.parentElement?.parentElement),
  }
})

// 真实鼠标点元素中心（把手热区在四边外扩 12px，中心是最安全的落点）
const pick = async id => {
  const r = await page.evaluate(i => {
    const b = document.getElementById(i).getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  }, id)
  await page.mouse.move(Math.round(r.x), Math.round(r.y))
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(320)
}
const press = async combo => { await page.keyboard.press(combo); await page.waitForTimeout(450) }

// ── A. 基线 ────────────────────────────────────────────────
log('--- A. 基线（刚注入，什么都没做）---')
const a = { stats: await stats(), canUndo: await canUndo(), shape: await shape() }
log('[基线] stats   =', JSON.stringify(a.stats))
log('[基线] canUndo =', a.canUndo)
log('[基线] 结构    =', JSON.stringify(a.shape))

// ── B. 真实点击选中 #b ─────────────────────────────────────
log('\n--- B. 真实鼠标点 #b 中心选中 ---')
await pick('b')
log('[选中] data-selected =', JSON.stringify(await selIds()))

// ── C. ⌘G ──────────────────────────────────────────────────
log('\n--- C. 按 ⌘G 分组 ---')
const beforeG = await shape()
await press('Meta+g')
const afterG = await shape()
const cStats = await stats(), cUndo = await canUndo(), cPrompt = await prompt()
log('[⌘G 前] ', JSON.stringify(beforeG))
log('[⌘G 后] ', JSON.stringify(afterG))
log('[⌘G 后] stats   =', JSON.stringify(cStats))
log('[⌘G 后] canUndo =', cUndo)
log('[⌘G 后] 导出提示词长度 =', cPrompt.length, cPrompt.length ? '' : '（空串 = 一个字都没有）')
if (cPrompt.length) log('[⌘G 后] 提示词全文 >>>\n' + cPrompt + '\n<<<')
const domChanged = JSON.stringify(beforeG.children) !== JSON.stringify(afterG.children)
  || beforeG.bParent !== afterG.bParent
log('[判定] ⌘G 确实改了 DOM 结构 =', domChanged)

// ── D. ⌘⇧G ─────────────────────────────────────────────────
log('\n--- D. 按 ⌘⇧G 取消分组 ---')
await press('Meta+Shift+g')
const afterUG = await shape()
const dStats = await stats(), dUndo = await canUndo(), dPrompt = await prompt()
log('[⌘⇧G 后]', JSON.stringify(afterUG))
log('[⌘⇧G 后] stats   =', JSON.stringify(dStats))
log('[⌘⇧G 后] canUndo =', dUndo, ' 提示词长度 =', dPrompt.length)

// ── E. 对照组：同为结构性改动的 Delete（已知走 ChangeStore.removeElements）──
log('\n--- E. 对照组：Delete 删 #c ---')
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.clear(); s.history.clear()
  const list = document.getElementById('list')
  ;['a', 'b', 'c', 'd'].forEach(id => { const el = document.getElementById(id); if (el) list.appendChild(el) })
  ;[...list.children].filter(e => !e.id).forEach(e => e.remove())
})
await page.waitForTimeout(250)
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
log('[清干净] stats =', JSON.stringify(await stats()), ' canUndo =', await canUndo())
await pick('c')
await press('Delete')
const eStats = await stats(), eUndo = await canUndo(), ePrompt = await prompt()
log('[Delete 后] #c 还在吗 =', await page.evaluate(() => !!document.getElementById('c')))
log('[Delete 后] stats   =', JSON.stringify(eStats))
log('[Delete 后] canUndo =', eUndo, ' 提示词长度 =', ePrompt.length)

// ── F. ⌘Z 的落点：先做一条无关的、确实入账的改动，再 ⌘G，再 ⌘Z ──────
//     applyProp 是面板改属性走的同一条入口。
log('\n--- F. 先改 #solo 背景（入账），再 ⌘G，再 ⌘Z ---')
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.read().removals.forEach(r => s.restoreRemoval(r.id))
  s.clear(); s.history.clear()
})
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
await page.evaluate(() =>
  window.__visualRevise.store.applyProp(document.getElementById('solo'), 'background-color', 'rgb(255, 0, 0)'))
await page.waitForTimeout(350)
const f0 = {
  solo: await page.evaluate(() => document.getElementById('solo').style.backgroundColor),
  stats: await stats(), canUndo: await canUndo(),
}
log('[无关改动后] #solo background =', JSON.stringify(f0.solo),
    ' stats =', JSON.stringify(f0.stats), ' canUndo =', f0.canUndo)

await pick('b')
const fBefore = await shape()
await press('Meta+g')
const fGrouped = await shape()
const f1 = { stats: await stats(), canUndo: await canUndo() }
log('[⌘G 后] 结构 =', JSON.stringify(fGrouped))
log('[⌘G 后] stats =', JSON.stringify(f1.stats), ' canUndo =', f1.canUndo)

await press('Meta+z')
const fUndone = await shape()
const f2 = {
  solo: await page.evaluate(() => document.getElementById('solo').style.backgroundColor),
  stats: await stats(), canUndo: await canUndo(),
}
log('[⌘Z 后] 结构 =', JSON.stringify(fUndone))
log('[⌘Z 后] #solo background =', JSON.stringify(f2.solo), ' stats =', JSON.stringify(f2.stats))
const groupUndone = JSON.stringify(fUndone.children) === JSON.stringify(fBefore.children)
const unrelatedUndone = f2.solo !== f0.solo
log('[判定] ⌘Z 把分组退回去了吗       =', groupUndone)
log('[判定] ⌘Z 反而撤掉了更早那条改动 =', unrelatedUndone)

// ── 结论 ───────────────────────────────────────────────────
log('\n================ 结论 ================')
log('A 基线                     : total =', a.stats.total, ' canUndo =', a.canUndo)
log('C ⌘G 改了 DOM 结构         :', domChanged, `（#b 的父节点 ${beforeG.bParent} → ${afterG.bParent}）`)
log('C ⌘G 后 total / canUndo    :', cStats.total, '/', cUndo)
log('C ⌘G 后 moves / removals   :', cStats.moves, '/', cStats.removals)
log('C ⌘G 后 提示词字数         :', cPrompt.length)
log('D ⌘⇧G 后 total / canUndo   :', dStats.total, '/', dUndo, ' 提示词字数', dPrompt.length)
log('E 对照 Delete total/canUndo:', eStats.total, '/', eUndo, ' 提示词字数', ePrompt.length)
log('F ⌘Z 退回分组              :', groupUndone)
log('F ⌘Z 撤掉了无关的旧改动    :', unrelatedUndone, `（#solo ${f0.solo} → ${f2.solo || '(空)'}）`)
log('=====================================\n')

await browser.close(); await close()
