// 独立复现脚本 · 清单 2.6.1
// 报告称：Appearance 的不透明度步进不受 CONTROLS['opacity'] 声明的 min:0 / max:1 约束，
// 连按 ArrowDown 能越过 0 写出负值，并进改动记录与导出提示词。
// 期望（feature-inventory §2.6.1「step 0.05，min 0 max 1（controls.js:100）」）：停在 0 / 1。
// 全程真实交互（locator.click / page.keyboard / page.mouse.down-up），不用 element.click() / dispatchEvent。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const P = sel => page.locator(`visual-revise-panel ${sel}`)

// inline 声明原文（不是 computed —— computed 会被浏览器夹到 [0,1]）
const inlineOpacity = () =>
  page.evaluate(() => document.getElementById('appear').style.getPropertyValue('opacity'))

const computedOpacity = () =>
  page.evaluate(() => getComputedStyle(document.getElementById('appear')).opacity)

const inputValue = () =>
  page.evaluate(() => document.querySelector('visual-revise-panel')
    .shadowRoot.querySelector('input[data-prop="opacity"]').value)

// 改动记录里 #appear 身上躺着的属性
const changesFor = () => page.evaluate(() => {
  const el = document.getElementById('appear')
  const { edits } = window.__visualRevise.store.read()
  const hit = edits.find(e => e.el === el)
  return hit ? hit.changes.map(c => `${c.prop}: ${c.after ?? c.value ?? ''}`) : []
})

const prompt = () => page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))

const select = async id => {
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  await page.locator(`#${id}`).click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(500)
}

const write = async (prop, value) => {
  const i = P(`input[data-prop="${prop}"]`).first()
  await i.scrollIntoViewIfNeeded()
  await i.fill(String(value))
  await i.press('Enter')
  await page.waitForTimeout(300)
}

// 真实鼠标点击进输入框（拿到焦点后才收方向键）
const realClick = async loc => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(300)
}

await page.goto(`${origin}/full/fixtures/layout-appearance.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

console.log('\n=== 2.6.1 不透明度步进的 min/max 约束 · 独立复现 ===\n')

// ── 声明侧：CONTROLS['opacity'] 到底声明了什么 ─────────────
const spec = await page.evaluate(() => {
  const c = window.__visualRevise?.lib?.CONTROLS?.['opacity']
  return c ? { step: c.step, min: c.min, max: c.max, type: c.type } : null
})
console.log('[声明] CONTROLS[\'opacity\'] =', JSON.stringify(spec),
  spec ? '' : '（运行时未导出 CONTROLS，见 controls.js:100 源码）')

await select('appear')
console.log('[选中] panel.target =', await page.evaluate(() =>
  document.querySelector('visual-revise-panel').target?.id))

// ══════════════════════════════════════════════════════════
// A. 下界：0.5 一路 ArrowDown 越过 0
// ══════════════════════════════════════════════════════════
console.log('\n--- A. 下界 min:0 ---')
await write('opacity', 0.5)
console.log('[起点] inline opacity =', JSON.stringify(await inlineOpacity()),
  ' 输入框 =', JSON.stringify(await inputValue()))

await realClick(P('input[data-prop="opacity"]').first())
const downTrail = []
for (let i = 1; i <= 12; i++) {
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(160)
  downTrail.push(`${i}:${await inlineOpacity()}`)
}
console.log('[连按 ArrowDown ×12] 轨迹 =', downTrail.join(' → '))

const low = await inlineOpacity()
const lowNum = parseFloat(low)
console.log('[结果] inline opacity =', JSON.stringify(low), ' 数值 =', lowNum,
  ' 输入框 =', JSON.stringify(await inputValue()))
console.log('[结果] computed opacity =', await computedOpacity(),
  '  ← 浏览器渲染时自己夹到 0，所以画面上和 0 没区别')
console.log('[结果] 改动记录 =', JSON.stringify(await changesFor()))

const textLow = await prompt()
const lineLow = (textLow.match(/^.*opacity.*$/m) || [''])[0].trim()
console.log('[结果] 导出提示词里那一行 =', JSON.stringify(lineLow))

const belowMin = Number.isFinite(lowNum) && lowNum < 0
console.log(`==> 越过 min:0 写出负值? ${belowMin}（期望 false，即停在 0）`)

// ══════════════════════════════════════════════════════════
// B. 上界：0.9 一路 ArrowUp 越过 1
// ══════════════════════════════════════════════════════════
console.log('\n--- B. 上界 max:1 ---')
await write('opacity', 0.9)
await realClick(P('input[data-prop="opacity"]').first())
const upTrail = []
for (let i = 1; i <= 8; i++) {
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(160)
  upTrail.push(`${i}:${await inlineOpacity()}`)
}
console.log('[连按 ArrowUp ×8] 轨迹 =', upTrail.join(' → '))

const high = await inlineOpacity()
const highNum = parseFloat(high)
console.log('[结果] inline opacity =', JSON.stringify(high), ' 数值 =', highNum,
  ' computed =', await computedOpacity())
const textHigh = await prompt()
console.log('[结果] 导出提示词里那一行 =',
  JSON.stringify((textHigh.match(/^.*opacity.*$/m) || [''])[0].trim()))

const aboveMax = Number.isFinite(highNum) && highNum > 1
console.log(`==> 越过 max:1 写出 >1? ${aboveMax}（期望 false，即停在 1）`)

// ══════════════════════════════════════════════════════════
// C. 拖标签（另一条走 stepValue 的路径）是否同样不受约束
// ══════════════════════════════════════════════════════════
console.log('\n--- C. 拖前缀 ◍ 调数值（stepValue 的另一个调用点）---')
await write('opacity', 0.1)
const handle = P('[data-drag][data-prop="opacity"]').first()
const hasHandle = await handle.count() > 0
if (hasHandle) {
  const b = await handle.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 - 200, b.y + b.height / 2, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const dragged = await inlineOpacity()
  console.log('[向左拖 200px] inline opacity =', JSON.stringify(dragged),
    ' 数值 =', parseFloat(dragged), ' computed =', await computedOpacity())
  console.log(`==> 拖动同样越过 min:0? ${parseFloat(dragged) < 0}`)
} else {
  console.log('[跳过] 未找到 opacity 的 data-drag 前缀句柄')
}

// ══════════════════════════════════════════════════════════
// D. 对照：CONTROLS 里没声明 min/max 的属性（border-radius）
//    ——负值在那里是完全合法的写法，说明「负数本身」不是问题，
//      问题只在 opacity 声明了区间却没人执行
// ══════════════════════════════════════════════════════════
console.log('\n--- D. 对照 border-radius（未声明 min/max）---')
await write('border-radius', 2)
await realClick(P('input[data-prop="border-radius"]').first())
for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(140) }
console.log('[border-radius 连按 ArrowDown ×5] inline =',
  JSON.stringify(await page.evaluate(() =>
    document.getElementById('appear').style.getPropertyValue('border-radius'))))

console.log('\n================ 结论 ================')
console.log('下界越界（写出负 opacity）:', belowMin)
console.log('上界越界（写出 >1 opacity）:', aboveMax)
console.log('=====================================\n')

await browser.close(); await close()
