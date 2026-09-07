// 独立复现脚本 · 清单 3.4.6（色盘色值输入框的非法值回滚）
//
// 报告称：色盘弹层里的 .val 输入框敲进非法颜色 + Enter 之后，框里一直留着那串
// 非法文字，失焦也不回滚，直到下一次任意色盘操作触发 sync 才被覆盖。
// 期望（feature-inventory §3.4.6「`change` 时 parseColor 校验，非法则回滚显示」，
// 以及同仓库里 vr-color 触发行的同类输入 color.element.js:106-109 走
// `if (!next.valid) return this.#renderTrigger()` 全量重画、非法值立刻被抹掉）。
//
// 本脚本不复用 tests-e2e/full/popovers.mjs 的任何断言与工具，自己搭事件旁观者、
// 自己读 DOM 状态。全程真实交互（locator.click / fill+press，不用 element.click()）。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/popovers-page.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

await page.goto(FIXTURE)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

const COLOR = 'visual-revise-color-panel'
const PANEL = 'visual-revise-panel'

// 旁观 vr-color：唯一能看到「控件写出去的 CSS 原文」的地方
await page.evaluate(() => {
  window.__vx = []
  document.addEventListener('vr-color', e => window.__vx.push(e.detail.value), true)
})
const evs = () => page.evaluate(() => window.__vx.slice())

// 色盘弹层内部状态：输入框里的字 + 谁拿着焦点
const pick = () => page.evaluate(id => {
  const host = document.getElementById(id)
  if (!host) return null
  const r = host.shadowRoot
  const val = r.querySelector('.val')
  const focusedInShadow = r.activeElement
  return {
    val: val?.value ?? null,
    alphaVal: r.querySelector('.alpha-val')?.value ?? null,
    format: r.querySelector('.format')?.getAttribute('value') ?? null,
    // 焦点归属：picker.js:207 的守卫就是靠这两条判「正在输入」
    docActiveIsVal: document.activeElement === val,
    shadowActiveIsVal: focusedInShadow === val,
    shadowActiveClass: focusedInShadow?.className ?? null,
    docActiveTag: document.activeElement?.tagName ?? null,
  }
}, COLOR)

// 页面元素真实颜色（框里显示的值到底对不对得上它）
const cssColor = () => page.evaluate(() => getComputedStyle(document.getElementById('solid')).color)
// vr-color 触发行里的色值框（对照组：那边走 #renderTrigger 全量重画）
const trigText = () => page.evaluate(() => {
  const c = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('vr-color[data-prop="color"]')
  return c?.shadowRoot.querySelector('.text')?.value ?? null
})

const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.click(); await page.waitForTimeout(340) }
const exists = () => page.evaluate(id => !!document.getElementById(id), COLOR)

console.log('\n=== 3.4.6 色盘色值框敲非法颜色后到底回不回滚 · 独立复现 ===\n')

// ── 选中 #solid，开「文字色」的色盘弹层 ──────────────────────────
await page.locator('#solid').click({ position: { x: 6, y: 6 } })
await page.waitForTimeout(520)
const swatch = page.locator(`${PANEL} vr-color[data-prop="color"] .swatch`)
await tap(swatch)
console.log('[开弹层] 色盘在? ', await exists())
console.log('[开弹层] 弹层状态 =', JSON.stringify(await pick()))
console.log('[开弹层] 页面 color =', await cssColor())

const val = page.locator(`#${COLOR} .val`)

// ── A. 先敲一个合法值，确定这条路是通的 ──────────────────────────
console.log('\n--- A. 合法值 rebeccapurple + Enter ---')
await val.fill('rebeccapurple')
await val.press('Enter')
await page.waitForTimeout(420)
const aPick = await pick()
const aColor = await cssColor()
console.log('[合法值后] 弹层状态 =', JSON.stringify(aPick))
console.log('[合法值后] 页面 color =', aColor)
console.log('[合法值后] emit 过的值 =', JSON.stringify(await evs()))
const aOk = aColor === 'rgb(102, 51, 153)'
console.log(`==> A：合法值落地了? ${aOk}`)

// ── B. 复现：敲非法值 + Enter ────────────────────────────────────
console.log('\n--- B. 非法值「这不是颜色」+ Enter ---')
const evsBefore = (await evs()).length
await val.fill('这不是颜色')
await val.press('Enter')
await page.waitForTimeout(450)
const bPick = await pick()
const bColor = await cssColor()
const evsAfter = (await evs()).length
console.log('[非法值后] 弹层状态 =', JSON.stringify(bPick))
console.log('[非法值后] 页面 color =', bColor)
console.log('[非法值后] emit 次数 前/后 =', evsBefore, '/', evsAfter)
const notCommitted = bColor === aColor && evsAfter === evsBefore
console.log(`    非法值确实没提交（页面没动、没多 emit）? ${notCommitted}`)
const stuck = bPick.val === '这不是颜色'
console.log(`==> B：Enter 之后框里还是那串非法文字? ${stuck}（期望回滚成 ${aPick.val || '#663399'}）`)

// ── C. 让 .val 失焦（点同弹层的不透明度框），看会不会补回滚 ────────
console.log('\n--- C. 点 .alpha-val 让 .val 失焦 ---')
await page.locator(`#${COLOR} .alpha-val`).click()
await page.waitForTimeout(450)
const cPick = await pick()
console.log('[失焦后] 弹层状态 =', JSON.stringify(cPick))
console.log('[失焦后] 页面 color =', await cssColor())
const stillStuck = cPick.val === '这不是颜色'
console.log(`==> C：失焦之后仍然是非法文字? ${stillStuck}`)

// ── D. 对照组：同一份非法输入喂给 vr-color 触发行的色值框 ─────────
console.log('\n--- D. 对照：vr-color 触发行的 .text 框（走 #renderTrigger 全量重画）---')
await page.keyboard.press('Escape'); await page.waitForTimeout(280)   // 关色盘
console.log('[关色盘] 色盘还在? ', await exists())
const trigBefore = await trigText()
console.log('[对照 前] 触发行 .text =', JSON.stringify(trigBefore))
const t = page.locator(`${PANEL} vr-color[data-prop="color"] .text`)
await t.scrollIntoViewIfNeeded()
await t.fill('这也不是颜色')
await t.press('Enter')
await page.waitForTimeout(450)
const trigAfter = await trigText()
console.log('[对照 后] 触发行 .text =', JSON.stringify(trigAfter))
console.log('[对照 后] 页面 color =', await cssColor())
const trigRolledBack = trigAfter === trigBefore
console.log(`==> D：触发行那个框把非法值抹掉、回到 ${JSON.stringify(trigBefore)}? ${trigRolledBack}`)

// ── E. 报告的后半段：下一次色盘操作（拖色相条）才把非法文字盖掉 ────
console.log('\n--- E. 重新走一遍，然后拖色相条看非法文字什么时候被盖掉 ---')
await tap(swatch)
console.log('[重开弹层] 弹层状态 =', JSON.stringify(await pick()))
const val2 = page.locator(`#${COLOR} .val`)
await val2.fill('#663399'); await val2.press('Enter'); await page.waitForTimeout(400)
await val2.fill('rgb(哈哈)'); await val2.press('Enter'); await page.waitForTimeout(400)
const ePick = await pick()
console.log('[敲 rgb(哈哈) 后] 弹层状态 =', JSON.stringify(ePick))
console.log('[敲 rgb(哈哈) 后] 页面 color =', await cssColor())
// 拖一下色相条（真实指针）
{
  const b = await page.locator(`#${COLOR} .hue`).boundingBox()
  await page.mouse.move(b.x + b.width * 0.25, b.y + b.height / 2)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(420)
}
const eAfterHue = await pick()
console.log('[拖完色相条] 弹层状态 =', JSON.stringify(eAfterHue))
console.log('[拖完色相条] 页面 color =', await cssColor())
const eStuckThenOverwritten = ePick.val === 'rgb(哈哈)' && eAfterHue.val !== 'rgb(哈哈)'
console.log(`==> E：非法文字一直挂着，直到拖色相条才被盖掉? ${eStuckThenOverwritten}`)

// ── F. 更贴近真人：非法值之后直接点页面别处（弹层关掉）再重开 ──────
console.log('\n--- F. 非法值之后点弹层外关掉，再重开看框里是什么 ---')
const val3 = page.locator(`#${COLOR} .val`)
await val3.fill('#112233'); await val3.press('Enter'); await page.waitForTimeout(400)
await val3.fill('nope-not-a-color'); await val3.press('Enter'); await page.waitForTimeout(400)
const fBefore = await pick()
console.log('[非法值后] 弹层状态 =', JSON.stringify(fBefore))
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await tap(swatch)
const fAfter = await pick()
console.log('[关掉再重开] 弹层状态 =', JSON.stringify(fAfter))
console.log('[关掉再重开] 页面 color =', await cssColor())
console.log(`==> F：重开之后框里回到真实色值? ${fAfter.val !== 'nope-not-a-color'}`)

console.log('\n================ 结论 ================')
console.log('A 合法值落地                          :', aOk)
console.log('B Enter 后非法文字留在框里            :', stuck, '（非法值没提交:', notCommitted, '）')
console.log('C 失焦后仍是非法文字                  :', stillStuck)
console.log('D 对照 vr-color 触发行会抹掉非法值    :', trigRolledBack)
console.log('E 要等下一次色盘操作才被盖掉          :', eStuckThenOverwritten)
console.log('F 关掉重开会恢复                      :', fAfter.val !== 'nope-not-a-color')
console.log('复现成立（B && C && D）               :', stuck && stillStuck && trigRolledBack)
console.log('=====================================\n')

await browser.close(); await close()
