// 独立复现脚本 · 清单 4.1.13（⌘G 分组 / ⌘⇧G 取消分组 是否改变兄弟顺序）
//
// 报告称：对 #list 的第 2 个子项 #b 按 ⌘G，新 <div> 被 prepend 到 #list 最前，
//         子项顺序从 a b c d 变成 (新分组) a c d；⌘⇧G 取消分组同样往前塞。
// 怀疑：app/features/selectable.js:331 `selected[0].parentNode.prepend(...)`
//       与 :324 `el.parentNode.prepend(node)`（无条件插到父级最前，而不是原位）。
//
// 期望依据（查过，没有把「跳到最前」写成有意设计的地方）：
//   - docs/PRD.md 全文没有 ⌘G / 分组快捷键的任何 AC（只有「面板分组」「按元素分组」等同名词）。
//   - docs/plans/feature-inventory.md:448 对 4.1.13 的描述是「把选中项包进新 <div> / 拆掉外壳」，
//     AC 覆盖一栏写的是「无」；:736 也只提「不走 ChangeStore，很可能不进记录」，
//     没有任何一处说「分组会顺带把元素移到父容器最前」。
//   - app/features/selectable.js:312-340 的 on_group 通篇没有注释。
//
// 本脚本不复用 tests-e2e/full/select-handles-text.mjs 的任何断言，自己重新测；
// 全程真实指针 / 真实键盘（page.mouse.click + page.keyboard.press），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/select-handles-text-page.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const log = (...a) => console.log(...a)

// #list 的子项快照：有 id 的报 id，没 id 的（新建的分组 div）报 <div:[里面装了谁]>
const listOrder = () => page.evaluate(() =>
  [...document.getElementById('list').children].map(el =>
    el.id
      ? el.id
      : `<${el.tagName.toLowerCase()}:[${[...el.children].map(c => c.id || c.tagName.toLowerCase()).join(',')}]>`))

const R = id => page.evaluate(i => {
  const b = document.getElementById(i).getBoundingClientRect()
  return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
}, id)

// 真实鼠标点元素中心（把手热区在四边外扩 12px，中心是最安全的落点）
const pick = async id => {
  const r = await R(id)
  await page.mouse.move(Math.round(r.cx), Math.round(r.cy))
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(320)
}
const selIds = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(e => e.id || `<${e.tagName.toLowerCase()}>`))

const reload = async () => {
  await page.goto(FIXTURE)
  await injectVisBug(page, origin)
  await page.waitForTimeout(400)
}

const press = async combo => { await page.keyboard.press(combo); await page.waitForTimeout(350) }

log('\n=== 4.1.13 ⌘G 分组 / ⌘⇧G 取消分组 是否搬动兄弟顺序 · 独立复现 ===\n')

// ── A. 报告的原始路径：选 #b（第 2 个子项，0-based index 1）后 ⌘G ────────────
await reload()
log('--- A. 选 #b（index 1）后 ⌘G ---')
const a0 = await listOrder()
log('[⌘G 前] #list 子项 =', JSON.stringify(a0))
await pick('b')
log('[已选中]', JSON.stringify(await selIds()))
await press('Meta+g')
const a1 = await listOrder()
const aWrapIdx = a1.findIndex(s => s.startsWith('<div:'))
const aInside = await page.evaluate(() => {
  const b = document.getElementById('b')
  const p = b?.parentElement
  return { bParent: p ? (p.id || `<${p.tagName.toLowerCase()}>`) : null,
           bParentIsNewDiv: !!p && !p.id && p.parentElement?.id === 'list' }
})
log('[⌘G 后] #list 子项 =', JSON.stringify(a1))
log('[⌘G 后] 新 div 落在 index =', aWrapIdx, ' #b 的父节点 =', JSON.stringify(aInside))
log('        #b 原来在 index 1，现在包着它的壳在 index', aWrapIdx,
    aWrapIdx === 1 ? '（原位，符合期望）' : '（被搬走了）')

// 这次搬位有没有被记下来 / 能不能撤销？（决定严重度：是「看得见的错」还是「看得见且回不去」）
const aRec = await page.evaluate(() => ({
  canUndo: window.__visualRevise.store.canUndo,
  stats: window.__visualRevise.store.stats(),
}))
log('[⌘G 后] 改动记录 =', JSON.stringify(aRec))

// ── B. 对照：选 #a（本来就在 index 0）后 ⌘G ──────────────────────────────
//    如果这一组顺序不变，就说明键送到了、功能跑了，A 的错位不是「键没生效」。
await reload()
log('\n--- B. 对照：选 #a（本来就在 index 0）后 ⌘G ---')
log('[⌘G 前] #list 子项 =', JSON.stringify(await listOrder()))
await pick('a')
await press('Meta+g')
const b1 = await listOrder()
log('[⌘G 后] #list 子项 =', JSON.stringify(b1))
log('        新 div 落在 index =', b1.findIndex(s => s.startsWith('<div:')),
    '　后面的兄弟顺序 =', JSON.stringify(b1.slice(1)))

// ── C. 对照：选最后一个 #d（index 3）后 ⌘G ───────────────────────────────
await reload()
log('\n--- C. 对照：选 #d（index 3，最后一个）后 ⌘G ---')
log('[⌘G 前] #list 子项 =', JSON.stringify(await listOrder()))
await pick('d')
await press('Meta+g')
const c1 = await listOrder()
log('[⌘G 后] #list 子项 =', JSON.stringify(c1), ' 新 div 落在 index =',
    c1.findIndex(s => s.startsWith('<div:')))

// ── D. ⌘⇧G 取消分组：能不能把 #b 放回 index 1 ────────────────────────────
await reload()
log('\n--- D. #b 先 ⌘G 再 ⌘⇧G，看能否回到 index 1 ---')
log('[初始]   #list 子项 =', JSON.stringify(await listOrder()))
await pick('b')
await press('Meta+g')
log('[⌘G 后] #list 子项 =', JSON.stringify(await listOrder()),
    '　当前选中 =', JSON.stringify(await selIds()))
await press('Meta+Shift+g')
const d2 = await listOrder()
log('[⌘⇧G 后] #list 子项 =', JSON.stringify(d2))
log('         #b 现在 index =', d2.indexOf('b'), '（原始是 1）')

// ── E. 取消分组的另一条路：给容器里本来就有多个子项的壳做 ungroup ─────────
//    直接对 #list 自己按 ⌘⇧G：拆掉 #list，把 a b c d 塞进 body。
//    看 body 里这四个的相对顺序还在不在（prepend 循环是不是把顺序也搅了）。
await reload()
log('\n--- E. 对 #list 自己按 ⌘⇧G（拆壳），看 a/b/c/d 相对顺序 ---')
const bodyOrderBefore = await page.evaluate(() =>
  [...document.body.children].map(e => e.id || `<${e.tagName.toLowerCase()}>`))
log('[拆前] body 直接子元素 =', JSON.stringify(bodyOrderBefore))
// #list 下半部有一条只属于容器自己的空白带，点那里才不会命中子项
const lr = await page.evaluate(() => {
  const b = document.getElementById('list').getBoundingClientRect()
  return { x: b.left + b.width * 0.5, y: b.top + b.height * 0.85 }
})
await page.mouse.move(Math.round(lr.x), Math.round(lr.y))
await page.mouse.down(); await page.mouse.up()
await page.waitForTimeout(320)
log('[已选中]', JSON.stringify(await selIds()))
await press('Meta+Shift+g')
const bodyOrderAfter = await page.evaluate(() =>
  [...document.body.children].map(e => e.id || `<${e.tagName.toLowerCase()}>`))
log('[拆后] body 直接子元素 =', JSON.stringify(bodyOrderAfter))
const abcd = bodyOrderAfter.filter(x => ['a','b','c','d'].includes(x))
log('        a/b/c/d 在 body 里的相对顺序 =', JSON.stringify(abcd),
    JSON.stringify(abcd) === JSON.stringify(['a','b','c','d']) ? '（保持）' : '（被打乱）')
log('        它们落在 body 的最前面吗？前 4 项 =', JSON.stringify(bodyOrderAfter.slice(0, 4)))

log('\n================ 结论 ================')
log('A 选 #b(index1) ⌘G  :', JSON.stringify(a0), '→', JSON.stringify(a1),
    ' 壳的 index =', aWrapIdx)
log('B 选 #a(index0) ⌘G  :', JSON.stringify(b1))
log('C 选 #d(index3) ⌘G  :', JSON.stringify(c1), ' 壳的 index =',
    c1.findIndex(s => s.startsWith('<div:')))
log('D ⌘G 后再 ⌘⇧G       :', JSON.stringify(d2), ' #b 回到 index =', d2.indexOf('b'))
log('E 拆 #list 后 body   :', JSON.stringify(bodyOrderAfter))
log('=====================================\n')

await browser.close(); await close()
