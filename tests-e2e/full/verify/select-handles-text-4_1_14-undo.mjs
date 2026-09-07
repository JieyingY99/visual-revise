// 独立复现脚本 · 清单 4.1.14（⌥Delete / ⌥Backspace 清空 inline style 是否进历史栈）
//
// 注：同目录下的 select-handles-text-4_1_14.mjs 是另一份针对 4.1.14 的**不同**报告
// （.attr is not a function）。本文件是「清空 style 不进历史栈、⌘Z 救不回来」那一条，
// 沿用仓库里 4_1_13-record-undo / 7_2_10-max-total 的加后缀命名法，不覆盖别人的脚本。
//
// 报告称：选中带 style="opacity: 0.95" 的 #form，先改一条属性，再按 ⌥Backspace 清空
//         inline style，然后 ⌘Z —— style 回不来，而且这一次 ⌘Z 被拿去撤销了上一条
//         无关操作（第 2 步那次属性修改）。
// 怀疑：app/features/selectable.js:189-191
//         const on_clearstyles = e => selected.forEach(el => el.attr('style', null))
//       直接改 DOM，不经 ChangeStore.applyProp，也没有 history.push。
//
// 期望依据（查过，没有把「清空 style 不可撤销」写成有意设计的地方）：
//   - docs/PRD.md AC-4.1「⌘Z / ⌘⇧Z 撤销重做」是无条件的；PRD 全文没有 ⌥Delete /
//     ⌥Backspace / 「清空 inline style」的任何 AC，也没有一处说这个键不可撤销。
//   - docs/plans/feature-inventory.md:449 对 4.1.14 只写「清空 inline `style` 属性」，
//     AC 覆盖一栏是「无」；:737 把它列进「完全没覆盖」的清单，问题原文正是
//     「有没有进历史栈？⌘Z 救不救得回来？」——待验证的开放问题，不是既定设计。
//   - app/features/selectable.js:189-191 通篇没有注释；同文件/同仓库里凡是有意为之的
//     取舍（如 4.1.18 删除接管、text 编辑绕过 store）都写了成段的理由。
//   - app/core/change-store.js:727-753 的 MutationObserver 只观察 childList/subtree，
//     不观察 attributes —— 直接改 style 属性对 store 完全不可见。
//
// 本脚本不复用 tests-e2e/full/select-handles-text.mjs 的任何断言与工具，自己读状态；
// 全程真实指针 / 真实键盘（page.mouse + page.keyboard + locator.fill），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/select-handles-text-page.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
const pageErrors = []
page.on('pageerror', e => { pageErrors.push(e.message); console.log('  [页面异常]', e.message) })

const log = (...a) => console.log(...a)

const reload = async () => {
  await page.goto(FIXTURE)
  await injectVisBug(page, origin)
  await page.waitForTimeout(400)
}

const press = async combo => { await page.keyboard.press(combo); await page.waitForTimeout(320) }

// 报告给的落点：元素左边 + 95% 宽、纵向中线。#form 宽 340、内含宽 280 的 input，
// 95%≈323 落在 input 右侧的内边距上；把手热区在四边外扩 12px（>=328），也够不着。
const clickAt = async (id, fx, fy) => {
  const p = await page.evaluate(([i, x, y]) => {
    const b = document.getElementById(i).getBoundingClientRect()
    return { x: Math.round(b.left + b.width * x), y: Math.round(b.top + b.height * y) }
  }, [id, fx, fy])
  await page.mouse.move(p.x, p.y)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(320)
  return p
}

const selIds = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(e => e.id || `<${e.tagName.toLowerCase()}>`))

const styleOf = id => page.evaluate(i => {
  const el = document.getElementById(i)
  return { attr: el?.getAttribute('style'), connected: !!el?.isConnected }
}, id)

// 历史栈与改动记录一次读全
const state = () => page.evaluate(() => {
  const s = window.__visualRevise.store
  const r = s.read()
  return {
    depth: s.history.depth,
    canUndo: s.canUndo,
    canRedo: s.canRedo,
    undoLabel: s.history.undoLabel,
    redoLabel: s.history.redoLabel,
    stats: s.stats(),
    edits: r.edits.map(e => ({
      el: e.el?.id || e.el?.tagName?.toLowerCase() || '?',
      changes: (e.changes || []).map(c => `${c.prop}: ${c.from} → ${c.to}`),
    })),
  }
})

// 工具条 toast：⌘Z 到底撤了哪一条，界面上就写在这里
const toast = () => page.evaluate(() => {
  const t = document.querySelector('visual-revise-toolbar')?.shadowRoot?.querySelector('.toast')
  return t ? t.textContent.trim() : null
})

log('\n=== 4.1.14 ⌥Backspace 清空 inline style 与 ⌘Z 的关系 · 独立复现 ===\n')

// ── A. 报告的原始路径：真实面板改一条属性 → ⌥Backspace → ⌘Z ──────────────
await reload()
log('--- A. 面板改 border-radius → ⌥Backspace → ⌘Z（全程真实输入）---')
log('[初始] #form style =', JSON.stringify((await styleOf('form')).attr))
const pa = await clickAt('form', 0.95, 0.5)
log('[点击落点]', JSON.stringify(pa), ' 选中 =', JSON.stringify(await selIds()))

const radius = page.locator('visual-revise-panel input[data-prop="border-radius"]')
log('[面板里有 border-radius 输入框吗]', (await radius.count()) > 0)
await radius.first().fill('12')
await page.keyboard.press('Enter')
await page.waitForTimeout(350)
const a1 = await styleOf('form')
const s1 = await state()
log('[改完属性] #form style =', JSON.stringify(a1.attr))
log('           历史 depth =', s1.depth, ' undoLabel =', JSON.stringify(s1.undoLabel),
    ' 改动记录 =', JSON.stringify(s1.edits))

await press('Alt+Backspace')
const a2 = await styleOf('form')
const s2 = await state()
log('[⌥Backspace 后] #form style =', JSON.stringify(a2.attr),
    ' 元素还在 DOM 上 =', a2.connected)
log('               历史 depth =', s2.depth, '（清空 style 有没有多出一条？）',
    ' undoLabel =', JSON.stringify(s2.undoLabel))
log('               改动记录 =', JSON.stringify(s2.edits))
log('               stats =', JSON.stringify(s2.stats))

await press('Meta+z')
const a3 = await styleOf('form')
const s3 = await state()
log('[⌘Z 后] #form style =', JSON.stringify(a3.attr))
log('        toast =', JSON.stringify(await toast()))
log('        历史 depth =', s3.depth, ' canUndo =', s3.canUndo,
    ' redoLabel =', JSON.stringify(s3.redoLabel))
log('        改动记录 =', JSON.stringify(s3.edits))
log('        >> opacity: 0.95 回来了吗 =', /opacity/.test(a3.attr || '') ? '是' : '否')
log('        >> 这次 ⌘Z 撤掉的是不是第 2 步那条 border-radius =',
    `depth ${s2.depth} → ${s3.depth}，redoLabel=${JSON.stringify(s3.redoLabel)}`)

// 再多按两次 ⌘Z，看有没有别的路子把 style 救回来
await press('Meta+z'); await press('Meta+z')
const a4 = await styleOf('form')
log('[再按两次 ⌘Z] #form style =', JSON.stringify(a4.attr),
    ' toast =', JSON.stringify(await toast()))

// ── B. 完全照报告的写法（store.applyProp 触发那一步）做一次交叉验证 ──────────
await reload()
log('\n--- B. 交叉验证：改动那一步用 store.applyProp 触发（报告原文写法）---')
await clickAt('form', 0.95, 0.5)
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.applyProp(document.getElementById('form'), 'border-radius', '12px')
})
await page.waitForTimeout(300)
const b1 = await styleOf('form'); const bs1 = await state()
log('[applyProp 后] style =', JSON.stringify(b1.attr), ' depth =', bs1.depth)
await press('Alt+Backspace')
const b2 = await styleOf('form'); const bs2 = await state()
log('[⌥Backspace 后] style =', JSON.stringify(b2.attr), ' depth =', bs2.depth,
    ' 改动记录 =', JSON.stringify(bs2.edits))
await press('Meta+z')
const b3 = await styleOf('form'); const bs3 = await state()
log('[⌘Z 后] style =', JSON.stringify(b3.attr), ' depth =', bs3.depth,
    ' toast =', JSON.stringify(await toast()))
log('        >> opacity 回来了吗 =', /opacity/.test(b3.attr || '') ? '是' : '否')

// ── C. 更糟的一支：元素从没被面板碰过（store 里没有它的快照）就按 ⌥Backspace ──
//    这时连改动记录都不会有这一条，⌘Z 会去撤销另一个元素上的无关操作。
await reload()
log('\n--- C. 没被面板碰过的元素直接 ⌥Backspace，⌘Z 会撤到谁头上 ---')
await clickAt('solo', 0.5, 0.5)
log('[已选中]', JSON.stringify(await selIds()))
const r2 = page.locator('visual-revise-panel input[data-prop="border-radius"]')
await r2.first().fill('20')
await page.keyboard.press('Enter')
await page.waitForTimeout(350)
const c0 = await state()
log('[#solo 改完] #solo style =', JSON.stringify((await styleOf('solo')).attr),
    ' 历史 depth =', c0.depth, ' undoLabel =', JSON.stringify(c0.undoLabel))

await clickAt('form', 0.95, 0.5)
log('[改选]', JSON.stringify(await selIds()),
    ' #form style =', JSON.stringify((await styleOf('form')).attr))
await press('Alt+Backspace')
const c1 = await styleOf('form'); const cs1 = await state()
log('[⌥Backspace 后] #form style =', JSON.stringify(c1.attr),
    ' 历史 depth =', cs1.depth, '（还是 #solo 那一条）')
log('               改动记录 =', JSON.stringify(cs1.edits), ' stats =', JSON.stringify(cs1.stats))
log('               >> 改动记录里有 #form 这一条吗 =',
    cs1.edits.some(e => e.el === 'form') ? '有' : '没有')

await press('Meta+z')
const c2 = await styleOf('form'); const c2solo = await styleOf('solo'); const cs2 = await state()
log('[⌘Z 后] #form style =', JSON.stringify(c2.attr),
    '　#solo style =', JSON.stringify(c2solo.attr))
log('        toast =', JSON.stringify(await toast()), ' depth =', cs2.depth)
log('        >> ⌘Z 救回 #form 了吗 =', /opacity/.test(c2.attr || '') ? '是' : '否')
log('        >> ⌘Z 反而撤掉了 #solo 的圆角吗 =',
    /border-radius/.test(c2solo.attr || '') ? '没有' : '是')

// ── D. 还有别的路子能救回来吗：被 track 过的元素走「重置全部改动」──────────
await reload()
log('\n--- D. 被 track 过之后，改动记录的「重置全部改动」能不能救回 opacity ---')
await clickAt('form', 0.95, 0.5)
const r3 = page.locator('visual-revise-panel input[data-prop="border-radius"]')
await r3.first().fill('12')
await page.keyboard.press('Enter')
await page.waitForTimeout(350)
await press('Alt+Backspace')
log('[⌥Backspace 后] style =', JSON.stringify((await styleOf('form')).attr))
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(300)
const d1 = await styleOf('form')
log('[undoEverything 后] style =', JSON.stringify(d1.attr),
    ' >> opacity 回来了吗 =', /opacity/.test(d1.attr || '') ? '是' : '否')

log('\n================ 结论 ================')
log('A 真实面板改属性 → ⌥Backspace → ⌘Z :',
    'style', JSON.stringify(a1.attr), '→', JSON.stringify(a2.attr), '→', JSON.stringify(a3.attr))
log('  历史 depth', s1.depth, '→', s2.depth, '→', s3.depth)
log('B store.applyProp 路径          :',
    JSON.stringify(b1.attr), '→', JSON.stringify(b2.attr), '→', JSON.stringify(b3.attr),
    ' depth', bs1.depth, '→', bs2.depth, '→', bs3.depth)
log('C 未被 track 的元素             : #form', JSON.stringify(c1.attr),
    ' ⌘Z 后 #form', JSON.stringify(c2.attr), ' #solo', JSON.stringify(c2solo.attr))
log('D 重置全部改动能否救回          :', /opacity/.test(d1.attr || '') ? '能' : '不能',
    JSON.stringify(d1.attr))
log('页面异常 =', JSON.stringify(pageErrors))
log('=====================================\n')

await browser.close(); await close()
