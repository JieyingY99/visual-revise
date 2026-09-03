// PRD 批次 3 验收：内容操作（文案 / 换图 / 删除恢复 / 页面重排 / 树重排 / 共享元素）。见 docs/PRD.md §7。
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
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG = Buffer.from(B64, 'base64')

console.log('\n[PRD 验收] 批次 3：内容操作\n')
await page.goto(origin); await injectVisBug(page, origin); await page.waitForTimeout(400)

// ── 7.1 文案 ──
console.log('── 7.1 文案')
const title = () => page.locator('.card-title').first()
const origText = (await title().textContent()).trim()
await title().click(); await page.waitForTimeout(300)
// 真实用法是双击；自动化里同一坐标连点会被吞，双击处理器只做 toolSelected('text')，直接走它
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('text')); await page.waitForTimeout(300)
AC('AC-7.1a', await title().evaluate(el => el.isContentEditable), '进入编辑态（元素变 contenteditable）')
await page.keyboard.press('End'); await page.keyboard.type('！'); await page.waitForTimeout(400)
const s71 = await stats()
const rec = await page.evaluate(() => window.__visualRevise.store.read().edits?.[0] ?? window.__visualRevise.store.read().styles?.[0] ?? null)
AC('AC-7.1b', s71.texts === 1 && s71.props === 0, `文案改动单独计数，不混进样式（texts=${s71.texts} props=${s71.props}）`)
await esc(); await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(200)
// 用工具条的「记录」钮开列表：L 键要求焦点不在插件 UI 上，这里刚点过面板
await deselect(); await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(350)
await page.locator('visual-revise-list .undo-text').first().click(); await page.waitForTimeout(300)
AC('AC-7.1c', (await title().textContent()).trim() === origText, `列表里「撤销文案」回到原文（「${(await title().textContent()).trim()}」）`)
await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(150)

// ── 7.2 换图 ──
console.log('── 7.2 换图')
await page.evaluate(b => {
  const img = document.createElement('img'); img.id = 'pic'; img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; img.style.cssText = 'position:absolute;left:30px;top:600px;width:80px;height:60px;background:#888'
  document.body.appendChild(img)
  const bg = document.createElement('div'); bg.id = 'bgbox'; bg.style.cssText = 'position:absolute;left:140px;top:600px;width:80px;height:60px;background-image:url("data:image/gif;base64,R0lGODlhAQABAAAAACw=")'
  document.body.appendChild(bg)
}, B64)
page.on('filechooser', c => c.setFiles({ name: 'new.png', mimeType: 'image/png', buffer: PNG }))
await deselect(); await page.locator('#pic').click({ position: { x: 40, y: 30 } }); await page.waitForTimeout(450)
AC('AC-7.2a', await page.locator('visual-revise-panel .swap-image').count() === 1, '图片元素的 Fill 组有换图按钮')
await page.locator('visual-revise-panel .swap-image').click(); await page.waitForTimeout(700)
const src = await page.evaluate(() => document.getElementById('pic').getAttribute('src'))
AC('AC-7.2b', src.startsWith('data:image/png'), `选文件后 src 变成新图（${src.slice(0, 22)}…）`)
await deselect()
await page.locator('#bgbox').click({ position: { x: 40, y: 30 } }); await page.waitForTimeout(450)
await page.locator('visual-revise-panel .swap-image').click(); await page.waitForTimeout(700)
AC('AC-7.2c', (await page.evaluate(() => document.getElementById('bgbox').style.backgroundImage)).includes('data:image/png'), '背景图元素换图走 background-image 通道')
await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(300)
// 判据是「列表里不出现 dataUrl 原文」。整个 shadowRoot 的 textContent 本就
// 包含面板全部文案，拿总长度卡阈值只会误伤。
const listText = await page.evaluate(() => document.querySelector('visual-revise-list').shadowRoot.textContent)
const dataUrlRun = listText.match(/data:image\/[a-z]+;base64,\S{40,}/)
AC('AC-7.2d', !dataUrlRun, `记录列表里不出现 dataUrl 原文（${listText.length} 字符${dataUrlRun ? `，命中 ${dataUrlRun[0].slice(0, 30)}…` : ''}）`)
await page.locator('visual-revise-toolbar .list').click(); await deselect()

// ── 7.3 删除 → 恢复 ──
console.log('── 7.3 删除与恢复')
await page.evaluate(() => { const w = document.createElement('div'); w.id = 'dw'; w.style.cssText = 'position:absolute;left:30px;top:700px'; w.innerHTML = '<p class="dm">甲</p><p class="dm">乙 <b>粗</b></p><p class="dm">丙</p>'; document.body.appendChild(w) })
await page.locator('.dm').nth(1).click(); await page.waitForTimeout(250)
await page.keyboard.press('Delete'); await page.waitForTimeout(300)
const r = await page.evaluate(() => { const [x] = window.__visualRevise.store.read().removals; return x ? { tag: x.tag, text: x.text, kids: x.childCount, id: x.id } : null })
AC('AC-7.3a', await page.locator('.dm').count() === 2 && r?.tag === 'p' && /乙/.test(r.text || '') && r.kids === 1,
   `Delete 删掉选中项并记下特征（<${r?.tag}> "${r?.text}" 子元素 ${r?.kids}）`)
await page.locator('visual-revise-toolbar .list').click(); await page.waitForTimeout(300)
const restoreBtn = page.locator('visual-revise-list .restore')
const viaButton = await restoreBtn.count() > 0
if (viaButton) { await restoreBtn.first().click() } else { await page.evaluate(i => window.__visualRevise.store.restoreRemoval(i), r.id) }
await page.waitForTimeout(300)
const order = await page.evaluate(() => [...document.querySelectorAll('.dm')].map(p => p.textContent.trim()[0]).join(''))
AC('AC-7.3b', order === '甲乙丙' && (await stats()).removals === 0, `${viaButton ? '列表里的恢复钮' : 'restoreRemoval'} 把元素放回原位（顺序 ${order}，removals=${(await stats()).removals}）`)
await page.locator('visual-revise-toolbar .list').click(); await deselect()

// ── 7.4 页面拖拽重排 ──
console.log('── 7.4 页面拖拽')
await page.evaluate(() => { const z = document.createElement('div'); z.id = 'dz'; z.style.cssText = 'position:absolute;left:30px;top:780px;display:flex;gap:8px'; z.innerHTML = '<div class="k" style="width:90px;height:40px;background:#a55">k0</div><div class="k" style="width:90px;height:40px;background:#5a5">k1</div><div class="k" style="width:90px;height:40px;background:#55a">k2</div>'; document.body.appendChild(z) })
const orders = () => page.evaluate(() => [...document.querySelectorAll('#dz .k')].map(k => k.style.order))
await setMode('reorder'); await page.waitForTimeout(400)
const k2 = await page.locator('#dz .k').nth(2).boundingBox(), k0 = await page.locator('#dz .k').nth(0).boundingBox()
// 中途取消
await page.mouse.move(k2.x + 45, k2.y + 8); await page.mouse.down(); await page.mouse.move(k0.x + 10, k0.y + 8, { steps: 6 })
await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(250)
AC('AC-7.4a', (await orders()).every(o => o === ''), `拖到一半 Esc 取消，不留任何 order（${JSON.stringify(await orders())}）`)
await setMode('reorder'); await page.waitForTimeout(250)
await page.mouse.move(k2.x + 45, k2.y + 8); await page.mouse.down(); await page.mouse.move(k0.x + 10, k0.y + 8, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(350)
const o = await orders()
AC('AC-7.4b', o.every(x => x !== '') && +o[2] < +o[0], `把 k2 拖到最前，落点写 order（${JSON.stringify(o)}）`)
AC('AC-7.4c', (await stats()).props >= 1, `重排进了改动记录（props=${(await stats()).props}）`)

// ── 7.5 结构树重排（树→页面契约；拖拽手势由 tree.mjs 覆盖）──
console.log('── 7.5 结构树')
await page.evaluate(() => { document.querySelectorAll('#dz .k').forEach(k => k.style.order = ''); window.__visualRevise.store.clear(); window.__visualRevise.store.history?.clear?.() })
// 树的拖拽落点最终就是这一句（tree.element.js:251 先 applyOrder 再 emit —
// 事件只是通知，重排在此之前已经发生）。拖拽手势本身由 tree.mjs 覆盖，
// 这里验的是「树给出的新顺序确实落到页面 order 上」这个契约。
await page.evaluate(() => {
  const ks = [...document.querySelectorAll('#dz .k')]
  window.__visualRevise.lib.applyOrder([ks[0], ks[2]], ks[1], 0)   // k1 移到最前
}); await page.waitForTimeout(350)
const o5 = await orders()
AC('AC-7.5', o5.every(x => x !== '') && +o5[1] < +o5[0] && +o5[0] < +o5[2],
   `树里给出的新顺序落到页面 order（${JSON.stringify(o5)}，期望 k1 最前）`)
await deselect()

// ── 7.6 共享元素 ──
console.log('── 7.6 共享元素')
await page.evaluate(() => { window.__visualRevise.store.clear(); document.querySelectorAll('.curve-card').forEach(c => { c.style.paddingTop = ''; c.style.opacity = '' }) })
await page.locator('.curve-card').nth(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(450)
await page.locator('visual-revise-panel .shared').click(); await page.waitForTimeout(300)
const sub = await page.locator('visual-revise-panel .sub').textContent()
AC('AC-7.6a', /联动\s*3/.test(sub), `开启共享后面板显示联动数量（「${sub.trim()}」）`)
const padIn = page.locator('visual-revise-panel .side-pair').first().locator('input').nth(1)
await padIn.fill('20'); await padIn.press('Enter'); await page.waitForTimeout(300)
const pads = await page.evaluate(() => [...document.querySelectorAll('.curve-card')].map(c => c.style.paddingTop))
AC('AC-7.6b', pads.every(p => p === '20px'), `改一处，三张同构卡片同步（${JSON.stringify(pads)}）`)
await page.locator('visual-revise-panel .shared').click(); await page.waitForTimeout(300)
const op = page.locator('visual-revise-panel input[data-prop="opacity"]')
await op.fill('0.5'); await op.press('Enter'); await page.waitForTimeout(300)
const ops = await page.evaluate(() => [...document.querySelectorAll('.curve-card')].map(c => c.style.opacity))
AC('AC-7.6c', ops[0] === '0.5' && ops.filter(Boolean).length === 1, `关闭共享后只改选中项（${JSON.stringify(ops)}）`)

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
