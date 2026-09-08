// 选中框把手拖改尺寸：进改动记录，也进历史栈（⌘Z / 工具条撤销退得回来）
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('[pageerror]', e.message))
console.log('\n[手柄拖改尺寸撤销测试]\n')
await page.goto(origin); await injectVisBug(page, origin); await page.waitForTimeout(300)

await page.locator('.curve-card').first().click({ position: { x: 20, y: 10 } }); await page.waitForTimeout(400)
const handleBox = placement => page.evaluate(pl => {
  // 上游组件用 closed shadow root，自己那份挂在 $shadow 上
  const hs = document.querySelector('visbug-handles')
  const h = (hs?.$shadow || hs?.shadowRoot)?.querySelector(`visbug-handle[placement="${pl}"]`)
  const btn = (h?.$shadow || h?.shadowRoot)?.querySelector('button')
  if (!btn) return null
  const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, placement)
const inline = () => page.evaluate(() => { const el = document.querySelector('.curve-card'); return { w: el.style.width, h: el.style.height, t: el.style.translate, cw: Math.round(el.getBoundingClientRect().width) } })
const store = () => page.evaluate(() => { const s = window.__visualRevise.store; const e = s.read().edits.find(x => x.el === document.querySelector('.curve-card')); return { canUndo: s.canUndo, label: s.history.undoLabel, props: e ? e.changes.map(c => c.prop) : [] } })

const before = await inline()
const hb = await handleBox('middle-end')
ok(!!hb, '找到右侧中点把手')
await page.mouse.move(hb.x, hb.y); await page.mouse.down()
await page.mouse.move(hb.x + 60, hb.y, { steps: 8 }); await page.waitForTimeout(50)
await page.mouse.move(hb.x + 80, hb.y, { steps: 4 }); await page.waitForTimeout(50)
await page.mouse.up(); await page.waitForTimeout(300)
const after = await inline(); const st1 = await store()
ok(after.w && after.cw >= before.cw + 70, `拖右把手 80px：width 行内 ${after.w}（盒宽 ${before.cw}→${after.cw}）`)
ok(st1.props.includes('width'), `改动记录里有 width（${st1.props.join(',')}）`)
ok(st1.canUndo && /宽度|尺寸/.test(String(st1.label)), `历史栈有条目可撤销（${st1.label}）`)

// 工具条撤销按钮可用；⌘Z 退回
const undoEnabled = await page.evaluate(() => !document.querySelector('visual-revise-toolbar').shadowRoot.querySelector('.undo').disabled)
ok(undoEnabled, '工具条撤销按钮可用')
await page.keyboard.press('Meta+z'); await page.waitForTimeout(300)
const undone = await inline(); const st2 = await store()
ok(undone.w === before.w && undone.cw === before.cw, `⌘Z 后 width 行内回到「${undone.w || '(无)'}」、盒宽回到 ${undone.cw}`)
ok(!st2.props.includes('width'), `撤销后改动记录里没有 width 了（${st2.props.join(',') || '空'}）`)
const handlesFollow = await page.evaluate(() => { const el = document.querySelector('.curve-card').getBoundingClientRect(); const h = document.querySelector('visbug-handles').getBoundingClientRect(); return Math.abs(h.width - el.width) < 2 })
ok(handlesFollow, '撤销后选中框跟着元素缩回去')
// 重做
await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(300)
const redone = await inline()
ok(redone.w === after.w, `⌘⇧Z 重做回到 ${redone.w}`)

// 角把手：宽高 + translate 一起进一条批次
await page.keyboard.press('Meta+z'); await page.waitForTimeout(200)
const tl = await handleBox('top-start')
await page.mouse.move(tl.x, tl.y); await page.mouse.down()
await page.mouse.move(tl.x - 30, tl.y - 20, { steps: 6 }); await page.waitForTimeout(50)
await page.mouse.up(); await page.waitForTimeout(300)
const corner = await inline(); const st3 = await store()
ok(corner.w && corner.h && corner.t && ['width', 'height', 'translate'].every(p => st3.props.includes(p)), `拖左上角：width/height/translate 都记了（${st3.props.join(',')}）`)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(300)
const cornerUndone = await inline()
ok(!cornerUndone.w && !cornerUndone.h && !cornerUndone.t, `一次 ⌘Z 三条一起退回（${JSON.stringify(cornerUndone)}）`)


// ─── E 组补测：4.2.5 事件本身 / 4.2.6 只记真的变了的那几条 / 4.2.9 重做后选中框也跟着走 ───
console.log('\n[手柄拖改尺寸 · 补测] resized 事件 / 只记变了的 / 重做跟随\n')

const stillSelected = await page.evaluate(() => document.querySelectorAll('.curve-card[data-selected]').length)
ok(stillSelected === 1, `补测前置：第一张卡仍是选中状态（期望 1，实际 ${stillSelected}）`)

// 先给它一个「拖之前就有的行内宽度」，这样 before 里的值不是空串，撤销要退回的也是它
await page.evaluate(() => window.__visualRevise.store.applyProp(document.querySelector('.curve-card'), 'width', '300px'))
await page.waitForTimeout(300)
await page.evaluate(() => {
  window.__vrResized = []
  window.__vrPointerUp = null
  document.addEventListener('pointerup', () => { window.__vrPointerUp = performance.now() }, true)
  document.addEventListener('visual-revise:resized', e => {
    window.__vrResized.push({ at: performance.now(), cls: e.detail.el?.className || '', before: { ...e.detail.before } })
  })
})
const w0 = await inline()
const boxH0 = await page.evaluate(() => Math.round(document.querySelector('.curve-card').getBoundingClientRect().height))
ok(w0.w === '300px', `拖之前的行内宽度期望 300px（实际「${w0.w || '(无)'}」）`)

// 底边中点把手：只该改 height，width / translate 不动
const bc = await handleBox('bottom-center')
ok(!!bc, '找到底边中点把手')
await page.mouse.move(bc.x, bc.y); await page.mouse.down()
await page.mouse.move(bc.x, bc.y + 40, { steps: 6 }); await page.waitForTimeout(50)
await page.mouse.move(bc.x, bc.y + 60, { steps: 4 }); await page.waitForTimeout(50)
await page.mouse.up(); await page.waitForTimeout(400)

const ev = await page.evaluate(() => ({ n: window.__vrResized.length, e: window.__vrResized[0], up: window.__vrPointerUp }))
ok(ev.n === 1 && ev.e && ev.e.at >= ev.up,
  `松手后派发了 1 次 visual-revise:resized（期望 1 次、时间戳 ≥ pointerup 的 ${Math.round(ev.up)}，实际 ${ev.n} 次 / ${Math.round(ev.e?.at ?? -1)}）`)
ok(ev.e && ev.e.before.width === '300px' && ev.e.before.height === '' && ev.e.before.translate === '',
  `detail.before 是拖之前的行内值（期望 width=300px / height=空 / translate=空，实际 ${JSON.stringify(ev.e?.before)}）`)

const st4 = await store(); const afterH = await inline()
ok(String(st4.label) === '拖改高度' && st4.props.slice().sort().join(',') === 'height,width',
  `只把真的变了的那条记进历史：本次批次标签期望「拖改高度」（实际「${st4.label}」）、改动记录里期望只多出 height（实际 ${st4.props.slice().sort().join(',') || '空'}）`)
ok(afterH.w === '300px' && /px$/.test(afterH.h) && parseFloat(afterH.h) >= boxH0 + 50,
  `拖底边 60px：行内 width 期望仍是 300px（实际 ${afterH.w}）、height 期望 ≥ ${boxH0 + 50}px（实际 ${afterH.h}）`)

// ⌘Z：退回拖之前的行内值（宽度那条 300px 不受牵连）
await page.keyboard.press('Meta+z'); await page.waitForTimeout(400)
const undoneH = await inline(); const st5 = await store()
ok(undoneH.h === '' && undoneH.w === '300px' && !st5.props.includes('height'),
  `⌘Z 退回拖之前的行内值：height 期望空（实际「${undoneH.h || '(无)'}」）、width 期望仍是 300px（实际「${undoneH.w}」）、记录里期望没有 height（实际 ${st5.props.join(',') || '空'}）`)

// 4.2.9：重做之后选中框同样跟着元素长回去
await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(400)
const redoneH = await inline()
const follow = await page.evaluate(() => {
  const el = document.querySelector('.curve-card').getBoundingClientRect()
  const h = document.querySelector('visbug-handles').getBoundingClientRect()
  return { dh: Math.abs(h.height - el.height), dw: Math.abs(h.width - el.width) }
})
ok(redoneH.h !== '' && follow.dh < 2 && follow.dw < 2,
  `⌘⇧Z 重做后 height 回到 ${redoneH.h || '(无)'}，选中框跟着元素长回去（高差期望 <2px，实际 ${follow.dh.toFixed(1)}；宽差 ${follow.dw.toFixed(1)}）`)

// 4.2.10：重做之后工具条的重做按钮该变回不可用、撤销按钮仍可用
const btns = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-toolbar').shadowRoot
  return { undo: !r.querySelector('.undo').disabled, redo: !r.querySelector('.redo').disabled }
})
ok(btns.undo === true && btns.redo === false,
  `重做之后工具条撤销按钮仍可用、重做按钮变回不可用（期望 undo=true / redo=false，实际 undo=${btns.undo} / redo=${btns.redo}）`)

console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
await browser.close(); await close()
