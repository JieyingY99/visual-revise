// PRD 批次 4 验收：记录与导出（列表 / 单条撤销 / 历史栈 / 评论 / 参考图 / 提示词 / JSON / 重锚 / 重置）。见 docs/PRD.md §8。
import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))
let passed = 0, failed = 0
const AC = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }
const stats = () => page.evaluate(() => window.__visualRevise.store.stats())
const setMode = m => page.evaluate(x => window.__visualRevise.setMode(x), m)
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(150) }
// 切 browse 再切回来不清选中——浏览模式退出时会把选中集原样恢复
// （去看一眼效果、回来继续编辑同一个元素）。取消选中的正路是 Esc。
const deselect = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250) }
const card = n => page.locator('.curve-card').nth(n)
const inline = (n, p) => page.evaluate(([i, q]) => document.querySelectorAll('.curve-card')[i].style.getPropertyValue(q), [n, p])
const write = async (prop, v) => { const i = page.locator(`visual-revise-panel input[data-prop="${prop}"]`).first(); await i.fill(String(v)); await i.press('Enter'); await page.waitForTimeout(250) }
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG = Buffer.from(B64, 'base64')

console.log('\n[PRD 验收] 批次 4：记录与导出\n')
await page.goto(origin); await injectVisBug(page, origin); await page.waitForTimeout(400)

// ── 8.1 记录列表 ──
console.log('── 8.1 记录列表')
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(450)
await write('border-radius', 25)   // 卡片自带 18px，写相等值会被值等价判断跳过
await write('opacity', 80)   // 面板里是百分比
await deselect(); await setMode('comment'); await page.waitForTimeout(200)
await card(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
await page.locator('visual-revise-comment-layer .editor').click(); await page.keyboard.type('hover 时上浮 4px')
await page.locator('visual-revise-comment-layer .save').click(); await page.waitForTimeout(300)
await setMode('select'); await esc()
await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(350)
const items = await page.locator('visual-revise-list .item').count()
const tabs = (await page.locator('visual-revise-list .tabs').textContent()).replace(/\s+/g, ' ').trim()
// 计数按元素：改了 1 个元素 + 1 条评论 = 全部 2
// 列表项按元素分组（1 个改过的元素 + 1 条评论 = 2 项），
// 而标签计数按「条」：radius + opacity 两条配置 + 1 条评论 = 全部 3
AC('AC-8.1a', items === 2 && /全部\s*3/.test(tabs) && /配置\s*2/.test(tabs) && /评论\s*1/.test(tabs),
   `列表按元素分组、标签按条计数（${items} 项；tabs「${tabs}」）`)
await page.locator('visual-revise-list .item').first().hover(); await page.waitForTimeout(250)
const hl = await page.evaluate(() => { const o = document.getElementById('visual-revise-locate-overlay'); return o ? getComputedStyle(o).display : 'none' })
AC('AC-8.1b', hl !== 'none', `hover 列表项在页面上高亮该元素（overlay display=${hl}）`)

// ── 8.2 单条撤销 ──
console.log('── 8.2 单条撤销')
await page.locator('visual-revise-list .undo-prop').first().click(); await page.waitForTimeout(300)
const left = { radius: await inline(0, 'border-radius'), opacity: await inline(0, 'opacity') }
AC('AC-8.2', (left.radius === '' || left.opacity === '') && !(left.radius === '' && left.opacity === ''), `撤销一条，另一条不受影响（radius="${left.radius}" opacity="${left.opacity}"）`)
await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(150)

// ── 8.3 历史栈 ──
console.log('── 8.3 撤销 / 重做')
await page.evaluate(() => { window.__visualRevise.store.clear(); window.__visualRevise.store.history?.clear?.(); document.querySelectorAll('.curve-card').forEach(c => c.removeAttribute('style')) })
await deselect(); await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
await write('border-radius', 9); await write('opacity', 60)
await page.locator('body').click({ position: { x: 4, y: 4 } }); await page.waitForTimeout(100)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(250)
const afterOne = { r: await inline(0, 'border-radius'), o: await inline(0, 'opacity') }
await page.keyboard.press('Meta+z'); await page.waitForTimeout(250)
const afterTwo = { r: await inline(0, 'border-radius'), o: await inline(0, 'opacity') }
AC('AC-8.3a', afterOne.r === '9px' && afterOne.o === '' && afterTwo.r === '' && afterTwo.o === '', `不同属性各自入栈，两次 ⌘Z 依次退回（${JSON.stringify(afterOne)} → ${JSON.stringify(afterTwo)}）`)
await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
await page.locator('visual-revise-panel button[data-flow="vertical"]').click(); await page.waitForTimeout(300)
const flowOn = { d: await inline(0, 'display'), fd: await inline(0, 'flex-direction') }
await deselect(); await page.keyboard.press('Meta+z'); await page.waitForTimeout(250)
const flowOff = { d: await inline(0, 'display'), fd: await inline(0, 'flex-direction') }
AC('AC-8.3b', flowOn.d === 'flex' && flowOn.fd === 'column' && flowOff.d === '' && flowOff.fd === '', `切排列是一个动作，一次 ⌘Z 整体退回（${JSON.stringify(flowOn)} → ${JSON.stringify(flowOff)}）`)

// ── 8.4 评论 ──
console.log('── 8.4 评论')
await page.evaluate(() => window.__visualRevise.store.clear())
await deselect(); await setMode('comment'); await page.waitForTimeout(200)
await card(2).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
AC('AC-8.4a', await page.locator('visual-revise-comment-layer .bubble').isVisible(), '评论模式点元素弹出输入框')
await page.locator('visual-revise-comment-layer .editor').click(); await page.keyboard.type('这里加个悬浮效果')
await page.locator('visual-revise-comment-layer .save').click(); await page.waitForTimeout(300)
const pin = page.locator('visual-revise-comment-layer .pin')
AC('AC-8.4b', await pin.count() === 1 && (await pin.first().textContent()).trim() === '1' && (await stats()).comments === 1, `保存后页面出 pin 并编号 1（comments=${(await stats()).comments}）`)
await pin.first().click(); await page.waitForTimeout(300)
AC('AC-8.4c', (await page.locator('visual-revise-comment-layer .editor').textContent()).includes('悬浮效果'), '点 pin 可编辑原评论')
await deselect(); await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(300)
await page.locator('visual-revise-list .del-comment').first().click(); await page.waitForTimeout(300)
AC('AC-8.4d', (await stats()).comments === 0 && await pin.count() === 0, '列表里删除评论，pin 一并消失')
await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(150)

// ── 8.5 参考图 ──
console.log('── 8.5 参考图')
await setMode('comment'); await page.waitForTimeout(200)
await card(2).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
page.on('filechooser', c => c.setFiles({ name: 'target.png', mimeType: 'image/png', buffer: PNG }))
await page.locator('visual-revise-comment-layer .add-image').click(); await page.waitForTimeout(600)
const ref = () => page.locator('visual-revise-comment-layer .ref').count()
const n1 = await ref()
await page.evaluate(b => { const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'image.png', { type: 'image/png' })); const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor'); ed.focus(); ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, B64); await page.waitForTimeout(600)
const n2 = await ref()
await page.evaluate(b => { const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' })); document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.bubble').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })) }, B64); await page.waitForTimeout(600)
const n3 = await ref()
AC('AC-8.5a', n1 === 1 && n2 === 2 && n3 === 3, `选文件 / 粘贴 / 拖入三条路都能加图（${n1} → ${n2} → ${n3}）`)
await page.locator('visual-revise-comment-layer .ref-del').first().click(); await page.waitForTimeout(250)
await page.locator('visual-revise-comment-layer .ref-note, visual-revise-comment-layer .ref textarea, visual-revise-comment-layer .ref input').first().fill('目标样式').catch(() => {})
await page.locator('visual-revise-comment-layer .editor').click(); await page.keyboard.type('参考这两张')
await page.locator('visual-revise-comment-layer .save').click(); await page.waitForTimeout(300)
const saved = await page.evaluate(() => { const c = window.__visualRevise.store.read().comments[0]; return { n: c?.images?.length, note: c?.images?.[0]?.note ?? '' } })
AC('AC-8.5b', saved.n === 2, `逐张移除后带 ${saved.n} 张参考图一起保存（说明「${saved.note}」）`)
await deselect()

// ── 8.6 提示词 ──
console.log('── 8.6 提示词')
await page.evaluate(() => { const w = document.createElement('div'); w.id = 'dw'; w.style.cssText = 'position:absolute;left:30px;top:700px'; w.innerHTML = '<p class="dm">要删的段落</p>'; document.body.appendChild(w) })
await page.locator('.dm').click(); await page.waitForTimeout(250); await page.keyboard.press('Delete'); await page.waitForTimeout(300)
await deselect(); await page.locator('.card-title').first().click(); await page.waitForTimeout(300)
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('text')); await page.waitForTimeout(300)
await page.keyboard.press('End'); await page.keyboard.type('X'); await page.waitForTimeout(300); await esc(); await page.evaluate(() => document.activeElement?.blur?.())
await page.evaluate(() => { const img = document.createElement('img'); img.id = 'pic'; img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; img.style.cssText = 'position:absolute;left:300px;top:700px;width:60px;height:40px'; document.body.appendChild(img) })
await deselect(); await page.locator('#pic').click({ position: { x: 30, y: 20 } }); await page.waitForTimeout(400)
await page.locator('visual-revise-panel .swap-image').click(); await page.waitForTimeout(600)
await page.evaluate(() => {
  const w = document.createElement('div')
  w.id = 'mw'
  w.style.cssText = 'position:absolute;left:400px;top:700px'
  w.innerHTML = '<div id="mw-a"><p class="mm">搬走的段落</p></div><div id="mw-b"></div>'
  document.body.appendChild(w)
  window.__visualRevise.store.moveElement(w.querySelector('.mm'), document.getElementById('mw-b'), null)
})
await page.waitForTimeout(300)
const md = await page.evaluate(() => window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
const has = t => md.includes(t)
AC('AC-8.6', has('文案改动') && has('删除的元素') && has('图片替换') && has('移动的元素')
   && /改动：/.test(md) && has('要删的段落'),
   `提示词含文案 / 删除 / 图片替换 / 移动段落与摘要（${md.length} 字符；${['文案改动', '删除的元素', '图片替换', '移动的元素'].map(t => `${t}:${has(t) ? '✓' : '✗'}`).join(' ')}）`)
const moveBlock = md.slice(md.indexOf('## 移动的元素'))
AC('AC-8.6b', /- 从：.*mw-a/.test(moveBlock) && /- 到：.*mw-b/.test(moveBlock) && /处移动/.test(md),
   `移动段落里 from / to 两头都能定位（${moveBlock.split('\n').filter(l => l.startsWith('- 从：') || l.startsWith('- 到：')).join(' ／ ')}）`)

// ── 8.7 JSON ──
console.log('── 8.7 JSON')
// 给一个干净场景：上一段删掉的元素已不在页面上，导入时按锚点找不回它，
// 那是合理行为，不该拿来判定导入是否工作。
await page.evaluate(() => { window.__visualRevise.store.clear(); window.__visualRevise.store.history?.clear?.(); document.querySelectorAll('.curve-card').forEach(c => c.removeAttribute('style')) })
await deselect(); await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(450)
await write('border-radius', 22); await write('opacity', 70)
await deselect()
const before = await stats()
const data = await page.evaluate(() => window.__visualRevise.lib.exportJSON({ note: 'acc' }))
await page.evaluate(() => { window.__visualRevise.store.clear(); document.querySelectorAll('.curve-card').forEach(c => c.removeAttribute('style')) })
const mid = await stats()
await page.evaluate(d => window.__visualRevise.lib.importJSON(d), data); await page.waitForTimeout(500)
const after = await stats()
const applied = await inline(0, 'border-radius')
AC('AC-8.7', data.schema >= 5 && mid.total === 0 && after.total === before.total && applied === '22px',
   `导出 schema v${data.schema}；清空后导入，记录回到 ${after.total} 条（导出时 ${before.total}）且样式重新应用（radius=${applied}）`)

// 移动只出不进的话，「导入后记录数一致」就是假的
await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  window.__visualRevise.store.history?.clear?.()
  document.getElementById('ez')?.remove()
  const z = document.createElement('div')
  z.id = 'ez'
  z.style.cssText = 'position:absolute;left:560px;top:700px'
  z.innerHTML = '<div id="ez-a"><p class="ee">搬我一次</p></div><div id="ez-b"></div>'
  document.body.appendChild(z)
  window.__visualRevise.store.moveElement(z.querySelector('.ee'), document.getElementById('ez-b'), null)
})
await page.waitForTimeout(300)
const withMove = await page.evaluate(() => window.__visualRevise.lib.exportJSON())
await page.evaluate(() => window.__visualRevise.store.undoEverything()); await page.waitForTimeout(300)
const backHome = await page.evaluate(() => document.getElementById('ez-a').textContent.trim())
const imported = await page.evaluate(d => {
  const r = window.__visualRevise.lib.importJSON(d)
  return { moves: r.moves, b: document.getElementById('ez-b').textContent.trim(),
           recorded: window.__visualRevise.store.stats().moves }
}, withMove)
AC('AC-8.7b', Array.isArray(withMove.moves) && withMove.moves.length === 1
   && backHome === '搬我一次' && imported.moves === 1 && imported.b === '搬我一次' && imported.recorded === 1,
   `JSON 带 moves，导入后元素重新搬到位（${JSON.stringify(imported)}）`)
await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  document.getElementById('ez')?.remove()
  window.__visualRevise.store.clear()
})

// ── 8.8 跨重渲染 ──
console.log('── 8.8 重渲染重锚')
await page.evaluate(() => { window.__visualRevise.store.clear(); document.querySelectorAll('.curve-card').forEach(c => c.removeAttribute('style')) })
await deselect(); await card(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
await write('border-radius', 33); await deselect()
await page.evaluate(() => { const el = document.querySelector('.curve-card'); const fresh = el.cloneNode(true); fresh.removeAttribute('style'); el.replaceWith(fresh) })
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.waitForTimeout(200)
const healed = { props: (await stats()).props, radius: await inline(0, 'border-radius'), twin: await inline(1, 'border-radius') }
AC('AC-8.8', healed.props === 1 && healed.radius === '33px' && healed.twin === '',
   `节点被换掉后改动一帧内找回并施加到新节点，长得一样的邻居不受牵连（${JSON.stringify(healed)}）`)

// ── 8.9 重置 ──
console.log('── 8.9 重置')
await page.evaluate(() => {
  document.getElementById('rz')?.remove()
  const z = document.createElement('div')
  z.id = 'rz'
  z.style.cssText = 'position:absolute;left:700px;top:700px'
  z.innerHTML = '<div id="rz-a"><p class="rr">回来</p></div><div id="rz-b"></div>'
  document.body.appendChild(z)
  window.__visualRevise.store.moveElement(z.querySelector('.rr'), document.getElementById('rz-b'), null)
})
await page.waitForTimeout(300)
await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(300)
await page.locator('visual-revise-list .reset').click(); await page.waitForTimeout(400)
const homed = await page.evaluate(() => document.getElementById('rz-a').textContent.trim())
AC('AC-8.9', (await stats()).total === 0 && (await inline(0, 'border-radius')) === '' && homed === '回来',
   `重置清掉全部记录、恢复页面并把搬走的元素放回原位（total=${(await stats()).total}，inline radius="${await inline(0, 'border-radius')}"，#rz-a = ${homed}）`)

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
