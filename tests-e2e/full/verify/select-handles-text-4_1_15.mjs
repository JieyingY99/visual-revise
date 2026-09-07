// 独立复现脚本 · 清单 4.1.15（⌘X 剪切选中元素的「记录 / 放回 / 进提示词」这一面）
//
// 报告称：点 #d 选中后按 ⌘X，元素离开了 DOM，但 store.stats().removals 仍是 0、
//        store.canUndo 仍是 false，改动记录里没有这一条，也没有任何入口把它放回来；
//        导出给 AI 的提示词里完全看不到这次删除。
// 怀疑：app/features/selectable.js:213-221 的 on_cut 末尾直接 `selected[0].remove()`，
//      全程没有碰 ChangeStore；对照 app/core/visual-revise.js:260-280，Delete 是
//      先 ChangeStore.removeElements 再删，注释写着「记录与删除必须是一件事」。
//
// 期望依据（先查过，不是脑补的）：
//   - docs/PRD.md 全文 grep「剪切 / ⌘X / clipboard / 剪贴板」零命中——PRD 没有任何一条
//     把「⌘X 不进记录」写成有意设计，也没写「剪切只是复制的顺手删除、不必入账」。
//   - docs/plans/feature-inventory.md:450 这条的「AC 覆盖」栏写的是 **无**；:738 明确把它
//     列为疑点，:773-775 把 §4.1.13–4.1.15 归进「结构性 DOM 操作的记录/撤销完整性」，
//     要求断言它们「要么进记录且可撤销，要么被明确禁用」。
//   - app/features/selectable.js 的 on_cut 上下没有任何注释解释「为什么不入账」。
//
// 本脚本要同时验证报告的两个前提，任何一个不成立报告就站不住：
//   前提一：⌘X 真的会让元素离开 DOM（cut 事件在非可编辑区真的会派发吗？）
//   前提二：离开之后账上确实没有这一条，也没有任何放回入口。
// 全程真实指针 / 真实键盘（page.mouse + page.keyboard），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/select-handles-text-page.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })

const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))

const log = (...a) => console.log(...a)

await page.goto(FIXTURE)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

log('\n=== 4.1.15 ⌘X 剪切元素的记录与放回 · 独立复现 ===\n')
log('[环境] 页面里跑的这份构建于 =',
  await page.evaluate(() => window.__visualRevise.build))

// ── 探针 ────────────────────────────────────────────────────
const stats   = () => page.evaluate(() => window.__visualRevise.store.stats())
const canUndo = () => page.evaluate(() => window.__visualRevise.store.canUndo)
const alive   = id => page.evaluate(i => !!document.getElementById(i), id)
const selIds  = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(e => e.id || `<${e.tagName.toLowerCase()}>`))
const prompt  = () => page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read(), { url: location.href }))
const removalList = () => page.evaluate(() =>
  window.__visualRevise.store.read().removals.map(r => ({ tag: r.tag, text: r.text })))
const listChildren = () => page.evaluate(() =>
  [...document.getElementById('list').children].map(e => e.id || `<${e.tagName.toLowerCase()}>`))

// 观察用：只旁听 cut 事件，不改变任何行为（capture 阶段 + 不 preventDefault）
const installCutProbe = () => page.evaluate(() => {
  window.__cutLog = []
  document.addEventListener('cut', e => {
    window.__cutLog.push({
      target: e.target?.id || e.target?.nodeName,
      hasClipboardData: !!e.clipboardData,
      defaultPrevented: e.defaultPrevented,
    })
  }, true)
})
const cutLog = () => page.evaluate(() => window.__cutLog || [])

// 真实鼠标点元素中心（把手热区向元素外扩 12px，中心是最安全的落点）
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

// 把 store / history 归零（报告的第 1 步）
const zero = async () => {
  await page.evaluate(() => {
    const s = window.__visualRevise.store
    s.read().removals.forEach(r => s.restoreRemoval(r.id))
    s.clear(); s.history.clear()
  })
  await page.waitForTimeout(250)
}

await installCutProbe()

// ══════════════════════════════════════════════════════════
// A. 归零基线
// ══════════════════════════════════════════════════════════
log('--- A. store.clear() + history.clear() 归零 ---')
await zero()
const a = { stats: await stats(), canUndo: await canUndo(), children: await listChildren() }
log('[基线] stats    =', JSON.stringify(a.stats))
log('[基线] canUndo  =', a.canUndo)
log('[基线] #list 子 =', JSON.stringify(a.children))

// ══════════════════════════════════════════════════════════
// B. 真实点击选中 #d，按 ⌘X
// ══════════════════════════════════════════════════════════
log('\n--- B. 真实鼠标点 #d 中心，按 ⌘X ---')
await pick('d')
log('[选中] data-selected =', JSON.stringify(await selIds()))
log('[⌘X 前] #d 在页面上 =', await alive('d'))

const errBefore = pageErrors.length
await press('Meta+x')

const b = {
  aliveD:   await alive('d'),
  stats:    await stats(),
  canUndo:  await canUndo(),
  removals: await removalList(),
  prompt:   await prompt(),
  children: await listChildren(),
  cutLog:   await cutLog(),
  errs:     pageErrors.slice(errBefore),
}
log('[cut 事件旁听]', JSON.stringify(b.cutLog))
log('[⌘X 后] #d 还在页面上 =', b.aliveD)
log('[⌘X 后] #list 子      =', JSON.stringify(b.children))
log('[⌘X 后] stats         =', JSON.stringify(b.stats))
log('[⌘X 后] canUndo       =', b.canUndo)
log('[⌘X 后] 改动记录里的删除条目 =', JSON.stringify(b.removals))
log('[⌘X 后] 导出提示词长度 =', b.prompt.length, b.prompt.length ? '' : '（空串 = 一个字都没有）')
if (b.prompt.length) log('[⌘X 后] 提示词提到 D 吗 =', /\bD\b/.test(b.prompt), '\n---\n' + b.prompt + '\n---')
log('[⌘X 期间的页面异常]', b.errs.length ? b.errs.join(' / ') : '无')

const B_left_dom      = !b.aliveD
const B_no_account    = b.stats.removals === 0 && b.canUndo === false
const B_no_restore_ui = b.removals.length === 0

// ══════════════════════════════════════════════════════════
// C. 剪掉之后还有别的路能放回去吗？（undoEverything / ⌘Z）
// ══════════════════════════════════════════════════════════
log('\n--- C. 试着把 #d 放回来 ---')
await press('Meta+z')
const c1 = { aliveD: await alive('d'), children: await listChildren() }
log('[⌘Z 后] #d 回来了 =', c1.aliveD, ' #list 子 =', JSON.stringify(c1.children))
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(400)
const c2 = { aliveD: await alive('d'), children: await listChildren() }
log('[重置全部后] #d 回来了 =', c2.aliveD, ' #list 子 =', JSON.stringify(c2.children))
const C_unrecoverable = !c1.aliveD && !c2.aliveD

// ══════════════════════════════════════════════════════════
// D. 对照组：同一个固件里按 Delete 删 #c（已知走 ChangeStore.removeElements）
// ══════════════════════════════════════════════════════════
log('\n--- D. 对照组：真实点 #c，按 Delete ---')
await page.goto(FIXTURE)
await injectVisBug(page, origin)
await page.waitForTimeout(400)
await installCutProbe()
await zero()
await pick('c')
log('[选中] data-selected =', JSON.stringify(await selIds()))
await press('Delete')
const d = {
  aliveC:   await alive('c'),
  stats:    await stats(),
  canUndo:  await canUndo(),
  removals: await removalList(),
  prompt:   await prompt(),
}
log('[Delete 后] #c 还在 =', d.aliveC)
log('[Delete 后] stats   =', JSON.stringify(d.stats))
log('[Delete 后] canUndo =', d.canUndo)
log('[Delete 后] 改动记录里的删除条目 =', JSON.stringify(d.removals))
log('[Delete 后] 提示词长度 =', d.prompt.length, ' 含「删除的元素」段落 =',
  d.prompt.includes('## 删除的元素'))
const D_accounted = d.aliveC === false && d.stats.removals === 1 && d.canUndo === true
const D_restorable = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const rec = s.read().removals[0]
  return rec ? s.restoreRemoval(rec.id) : false
})
await page.waitForTimeout(300)
log('[Delete 后] 能从记录里放回 =', D_restorable, ' 放回后 #c 在 =', await alive('c'))

// ══════════════════════════════════════════════════════════
// E. 再来一次 ⌘X（换一个元素 #a），确认 B 不是偶然
// ══════════════════════════════════════════════════════════
log('\n--- E. 复现二遍：真实点 #a，按 ⌘X ---')
await page.goto(FIXTURE)
await injectVisBug(page, origin)
await page.waitForTimeout(400)
await installCutProbe()
await zero()
await pick('a')
await press('Meta+x')
const e = {
  aliveA:   await alive('a'),
  stats:    await stats(),
  canUndo:  await canUndo(),
  removals: await removalList(),
  prompt:   await prompt(),
  cutLog:   await cutLog(),
}
log('[cut 事件旁听]', JSON.stringify(e.cutLog))
log('[⌘X 后] #a 还在 =', e.aliveA, ' stats =', JSON.stringify(e.stats),
  ' canUndo =', e.canUndo, ' 记录条目 =', JSON.stringify(e.removals),
  ' 提示词长度 =', e.prompt.length)
const E_repro = !e.aliveA && e.stats.removals === 0 && e.canUndo === false

// ══════════════════════════════════════════════════════════
// F. 最后一条可能的退路：⌘X 把 outerHTML 放进了剪贴板，⌘V 能贴回来吗？
//    （visual-revise.js:287-301 的单字母块没有 metaKey 守卫，key==='v' 会先
//     preventDefault + setMode('browse')——若属实，paste 事件根本不会派发）
// ══════════════════════════════════════════════════════════
log('\n--- F. ⌘X 之后按 ⌘V 能否贴回 ---')
await page.evaluate(() => {
  window.__pasteLog = []
  document.addEventListener('paste', e => window.__pasteLog.push({
    target: e.target?.id || e.target?.nodeName, defaultPrevented: e.defaultPrevented,
  }), true)
})
const fMode0 = await page.evaluate(() => document.querySelector('vis-bug')?.shadowRoot ? 'ui-ok' : 'ui-missing')
await pick('b')                                   // 给 paste 一个落点（贴进选中元素）
await press('Meta+v')
const f = {
  pasteLog: await page.evaluate(() => window.__pasteLog),
  aliveA:   await alive('a'),
  bHTML:    await page.evaluate(() => document.getElementById('b')?.innerHTML || '(#b 不在)'),
  children: await listChildren(),
  stats:    await stats(),
}
log('[⌘V] paste 事件旁听 =', JSON.stringify(f.pasteLog),
  f.pasteLog.length ? '' : '（一次都没派发 = 按键在到达剪贴板通道前就被吞了）')
log('[⌘V 后] #a 回来了 =', f.aliveA, ' #list 子 =', JSON.stringify(f.children))
log('[⌘V 后] #b 内容 =', JSON.stringify(f.bHTML.slice(0, 120)), ' UI =', fMode0)
log('[⌘V 后] stats =', JSON.stringify(f.stats))
const F_paste_never_fired = f.pasteLog.length === 0
const F_no_way_back = !f.aliveA

// ══════════════════════════════════════════════════════════
log('\n================ 结论 ================')
log('B1 ⌘X 让元素离开了 DOM          :', B_left_dom)
log('B2 ⌘X 后 removals / canUndo     :', b.stats.removals, '/', b.canUndo)
log('B3 ⌘X 后 改动记录条目数         :', b.removals.length)
log('B4 ⌘X 后 提示词字数             :', b.prompt.length)
log('C  ⌘Z / 重置全部都放不回来      :', C_unrecoverable)
log('D  对照 Delete removals/canUndo :', d.stats.removals, '/', d.canUndo,
    ' 提示词字数', d.prompt.length, ' 可放回 =', D_restorable)
log('E  换个元素再剪一次同样不入账   :', E_repro)
log('F  ⌘V 的 paste 事件从未派发     :', F_paste_never_fired, ' 剪掉的 #a 仍回不来 =', F_no_way_back)
log('总判定 报告成立（离开DOM+不入账+放不回）:',
  B_left_dom && B_no_account && B_no_restore_ui && C_unrecoverable && E_repro && D_accounted)
log('=====================================\n')

await browser.close(); await close()
