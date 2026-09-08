// 粘贴：焦点在编辑器输入框（面板色值框 / 弹层搜索框）里时，粘贴给那个框，
// 不往选中元素里塞节点；焦点在页面上时仍按上游行为把剪贴板里的元素粘进去
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('[pageerror]', e.message))
console.log('\n[粘贴守卫测试]\n')
await page.goto(origin); await injectVisBug(page, origin); await page.waitForTimeout(300)

await page.locator('.hero-title').click(); await page.waitForTimeout(400)
const before = await page.evaluate(() => document.querySelector('.hero-title').innerHTML)

// 在色值框里派发 paste（剪贴板里是从网页复制来的一段 HTML）
const paste = target => page.evaluate(sel => {
  const host = document.querySelector('visual-revise-panel')
  const input = sel === 'panel'
    ? host.shadowRoot.querySelector('section[data-group="fill"] .field vr-color').shadowRoot?.querySelector('input') ?? host.shadowRoot.querySelector('vr-color input, input')
    : null
  const node = input || document.body
  if (input) input.focus()
  const dt = new DataTransfer()
  dt.setData('text/html', '<span style="color:red">#202020</span>')
  dt.setData('text/plain', '#202020')
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true })
  const notPrevented = node.dispatchEvent(ev)
  return { hasInput: !!input, tag: input?.tagName, notPrevented }
}, target)

const r1 = await paste('panel'); await page.waitForTimeout(400)
const after1 = await page.evaluate(() => document.querySelector('.hero-title').innerHTML)
const inserts1 = await page.evaluate(() => window.__visualRevise.store.read().inserts?.length ?? 0)
ok(r1.hasInput && r1.tag === 'INPUT', `找到面板里的色值输入框（${r1.tag}）`)
ok(r1.notPrevented, '焦点在输入框里：paste 不被拦（浏览器照常贴进框里）')
ok(after1 === before && inserts1 === 0, `焦点在输入框里：选中元素内容不变、没有「粘贴元素」记录（inserts=${inserts1}）`)

// 焦点在页面上（body）：上游行为，剪贴板里的元素粘进选中元素
await page.evaluate(() => document.activeElement?.blur?.())
const r2 = await paste('body'); await page.waitForTimeout(500)
const after2 = await page.evaluate(() => document.querySelector('.hero-title').innerHTML)
const inserts2 = await page.evaluate(() => window.__visualRevise.store.read().inserts?.length ?? 0)
ok(!r2.notPrevented || inserts2 === 1, `焦点在页面上：粘贴被编辑器接管（preventDefault=${!r2.notPrevented}）`)
ok(after2 !== before && inserts2 === 1 && /#202020/.test(after2), `焦点在页面上：元素里多了粘贴来的节点，记录 inserts=${inserts2}`)


// ─── E 组补测：4.1.29 页面自己的输入框 / contenteditable 也归那个框；4.1.30 这条 insert 可撤销 ───
console.log('\n[粘贴守卫 · 补测] 页面输入框 / contenteditable / ⌘Z\n')

// 在页面里造一个 input 和一个 contenteditable（都不是编辑器 UI）
await page.evaluate(() => {
  const wrap = document.createElement('div')
  wrap.innerHTML = '<input id="pg-input" value="x"><div id="pg-ce" contenteditable="true">页面里的富文本</div>'
  document.querySelector('main.hero').appendChild(wrap)
})
await page.waitForTimeout(200)

// 选中 .hero-title 不变（上一段已选中），往页面输入框里粘
const pasteInto = sel => page.evaluate(s => {
  const node = document.querySelector(s)
  node.focus()
  const dt = new DataTransfer()
  dt.setData('text/html', '<span style="color:red">#202020</span>')
  dt.setData('text/plain', '#202020')
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true })
  const notPrevented = node.dispatchEvent(ev)
  return { notPrevented, active: document.activeElement?.id || document.activeElement?.tagName }
}, sel)
const inserts = () => page.evaluate(() => window.__visualRevise.store.read().inserts?.length ?? 0)
const titleHTML = () => page.evaluate(() => document.querySelector('.hero-title').innerHTML)

const selNow = await page.evaluate(() => document.querySelectorAll('.hero-title[data-selected]').length)
ok(selNow === 1, `补测前置：.hero-title 仍是选中状态（期望 1，实际 ${selNow}）`)

const i0 = await inserts(), h0 = await titleHTML()
const r3 = await pasteInto('#pg-input'); await page.waitForTimeout(400)
ok(r3.notPrevented && await inserts() === i0 && await titleHTML() === h0,
  `焦点在页面自己的 input（activeElement=${r3.active}）里：paste 不被拦（期望 true，实际 ${r3.notPrevented}）、insert 记录期望仍是 ${i0}（实际 ${await inserts()}）、选中元素内容不变`)

const r4 = await pasteInto('#pg-ce'); await page.waitForTimeout(400)
ok(r4.notPrevented && await inserts() === i0 && await titleHTML() === h0,
  `焦点在页面的 contenteditable（activeElement=${r4.active}）里：paste 不被拦（期望 true，实际 ${r4.notPrevented}）、insert 记录期望仍是 ${i0}（实际 ${await inserts()}）、选中元素内容不变`)

// 4.1.30：页面上那次粘贴走了 ChangeStore，⌘Z 退得回来
await page.evaluate(() => { document.activeElement?.blur?.(); document.getElementById('pg-ce')?.blur?.() })
await page.waitForTimeout(100)
const label = await page.evaluate(() => window.__visualRevise.store.history.undoLabel)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(400)
const i1 = await inserts(), h1 = await titleHTML()
ok(/粘贴/.test(String(label)) && i1 === i0 - 1 && !/#202020/.test(h1),
  `⌘Z 退回那次粘贴：历史标签期望含「粘贴」（实际「${label}」）、insert 记录期望 ${i0 - 1}（实际 ${i1}）、元素里不再有粘进来的节点`)


// ─── E 组补测（二）：4.1.29 弹层里的输入框；4.1.30 多个目标各粘一份、一次 ⌘Z 全退 ───
{
console.log('\n[粘贴守卫 · 补测二] 弹层输入框 / 多目标粘贴\n')

// 4.1.29：色盘弹层里的输入框同样是「粘贴给那个框」
const swatch = page.locator('visual-revise-panel vr-color .swatch').first()
await swatch.scrollIntoViewIfNeeded(); await swatch.click(); await page.waitForTimeout(500)
const pop = await page.evaluate(() => {
  const p = document.getElementById('visual-revise-color-panel')
  if (!p) return { open: false }
  const root = p.shadowRoot || p.$shadow || p
  const input = root.querySelector('input')
  if (!input) return { open: true, hasInput: false }
  input.focus()
  const dt = new DataTransfer()
  dt.setData('text/html', '<span class="vr-pasted">#202020</span>')
  dt.setData('text/plain', '#202020')
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true })
  return { open: true, hasInput: true, cls: input.className, notPrevented: input.dispatchEvent(ev) }
})
await page.waitForTimeout(400)
const insAfterPop = await page.evaluate(() => window.__visualRevise.store.read().inserts?.length ?? 0)
const pastedInPage = await page.evaluate(() => document.querySelectorAll('.vr-pasted').length)
ok(pop.open && pop.hasInput && pop.notPrevented,
  `焦点在色盘弹层的输入框（.${pop.cls}）里：paste 不被拦（期望 true，实际 ${pop.notPrevented}）`)
ok(insAfterPop === 0 && pastedInPage === 0,
  `焦点在弹层输入框里：不往选中元素里塞节点（期望 insert 记录 0 条 / 页面上 0 个粘贴节点，实际 ${insAfterPop} / ${pastedInPage}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

// 4.1.30：两个目标各粘一份，进同一条批次，一次 ⌘Z 全退
await page.locator('.curve-card').nth(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(300)
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(400)
await page.evaluate(() => document.activeElement?.blur?.())
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('text/html', '<span class="vr-pasted">#202020</span>')
  dt.setData('text/plain', '#202020')
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }))
})
await page.waitForTimeout(600)
const multi = await page.evaluate(() => ({
  inserts: window.__visualRevise.store.read().inserts?.length ?? 0,
  nodes: document.querySelectorAll('.curve-card .vr-pasted').length,
  label: window.__visualRevise.store.history.undoLabel,
}))
ok(multi.inserts === 2 && multi.nodes === 2 && /粘贴到 2 个元素里/.test(String(multi.label)),
  `多选粘贴：两个目标各粘一份（期望 insert 记录 2 条 / 页面上 2 个节点 / 批次标签「粘贴到 2 个元素里」，实际 ${multi.inserts} / ${multi.nodes} / 「${multi.label}」）`)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(500)
const undone = await page.evaluate(() => ({
  inserts: window.__visualRevise.store.read().inserts?.length ?? 0,
  nodes: document.querySelectorAll('.curve-card .vr-pasted').length,
}))
ok(undone.inserts === 0 && undone.nodes === 0,
  `一次 ⌘Z 把两份粘贴一起退掉（期望 insert 记录 0 条 / 页面上 0 个节点，实际 ${undone.inserts} / ${undone.nodes}）`)
}

console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
await browser.close(); await close()
