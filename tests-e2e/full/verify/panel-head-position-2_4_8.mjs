// 独立复现脚本 · 清单 2.4.8 / 2.4.7（旋转框）
// 「在旋转框里敲完裸数字 45 + Enter 后不失焦，直接方向键步进 / 拖标签，
//   会写出 rotate: Npx —— 非法声明被 CSSOM 静默丢弃」
// 全程真实交互（locator.fill / keyboard / page.mouse），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const P = sel => page.locator(`visual-revise-panel ${sel}`)
const ROT = 'input[data-prop="rotate"]'

const elRotate = () =>
  page.evaluate(() => document.getElementById('bk0').style.rotate)
const rawStyle = () =>
  page.evaluate(() => document.getElementById('bk0').getAttribute('style') || '')
const inputVal = () => P(ROT).first().inputValue()
const focused = () => page.evaluate(() => {
  const a = document.querySelector('visual-revise-panel').shadowRoot.activeElement
  return a ? `${a.tagName.toLowerCase()}[data-prop=${a.dataset?.prop}]` : '(无)'
})
const record = () => page.evaluate(() => {
  const st = window.__visualRevise.store
  return st.read().edits.flatMap(e =>
    e.changes.map(c => `${e.el.id || e.el.tagName}#${c.prop}: ${c.from} → ${c.to}`))
})

const deselect = async () => {
  await page.evaluate(() =>
    document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(180)
}
const select = async id => {
  await deselect()
  const loc = page.locator(`#${id}`)
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ position: { x: 4, y: 4 }, force: true })
  await page.waitForTimeout(500)
  const got = await page.evaluate(() => window.__visualRevise.panel.target?.id ?? '')
  if (got !== id) console.log(`  [选中偏移] 想选 #${id}，实得 #${got || '(空)'}`)
}

// 真实横向拖拽：按下 → 分 10 步右移 dx → 松开
const dragBy = async (loc, dx) => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(320)
}

// 在旋转框里键入 45 + Enter（保持焦点不动）
const typeRotate = async v => {
  const i = P(ROT).first()
  await i.scrollIntoViewIfNeeded()
  await i.fill(String(v))
  await i.press('Enter')
  await page.waitForTimeout(340)
}

await page.goto(`${origin}/full/fixtures/panel-head-position-main.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

console.log('\n=== 2.4.8 旋转框：裸数字 Enter 后直接步进 · 独立复现 ===\n')

// ────────────────────────────────────────────── 场景 A：方向键
console.log('--- 场景 A：Enter 后不失焦，直接 ArrowUp ---')
await select('bk0')
console.log('旋转框存在      :', await P(ROT).count())

await typeRotate('45')
const aElAfterEnter  = await elRotate()
const aInAfterEnter  = await inputVal()
const aFocus         = await focused()
console.log('Enter 后 元素 rotate :', JSON.stringify(aElAfterEnter))
console.log('Enter 后 输入框      :', JSON.stringify(aInAfterEnter))
console.log('Enter 后 焦点        :', aFocus)

// 不点别处，直接方向键
await P(ROT).first().press('ArrowUp')
await page.waitForTimeout(320)
const aElAfterStep = await elRotate()
const aInAfterStep = await inputVal()
console.log('ArrowUp 后 元素 rotate:', JSON.stringify(aElAfterStep))
console.log('ArrowUp 后 输入框     :', JSON.stringify(aInAfterStep))
console.log('ArrowUp 后 style 全文 :', JSON.stringify(await rawStyle()))
console.log('ArrowUp 后 改动记录   :', JSON.stringify(await record()))

const aUiMoved  = aInAfterStep !== aInAfterEnter
const aElMoved  = aElAfterStep !== aElAfterEnter
const aExpected = aElAfterStep === '46deg'
console.log(`\n[A] 输入框变了？ ${aUiMoved}  元素变了？ ${aElMoved}  元素 = 46deg？ ${aExpected}`)
console.log(`==> 场景 A bug 成立（框显示 ${aInAfterStep}，元素仍 ${aElAfterEnter}）: ${aUiMoved && !aElMoved}`)

// 继续对着这个框 Enter，看是不是「再也调不动」
await P(ROT).first().press('Enter')
await page.waitForTimeout(320)
console.log('再按一次 Enter 后 元素:', JSON.stringify(await elRotate()),
            ' 输入框:', JSON.stringify(await inputVal()))

// ────────────────────────────────────────────── 场景 B：拖标签
console.log('\n--- 场景 B：Enter 后不失焦，直接拖旋转标签 +40px（= 20 步）---')
await page.reload()
await injectVisBug(page, origin)
await page.waitForTimeout(400)
await select('bk0')
await typeRotate('45')
const bElAfterEnter = await elRotate()
const bInAfterEnter = await inputVal()
console.log('Enter 后 元素 rotate :', JSON.stringify(bElAfterEnter))
console.log('Enter 后 输入框      :', JSON.stringify(bInAfterEnter))

const handle = P(`label.name[data-drag][data-prop="rotate"]`).first()
console.log('拖拽手柄存在      :', await P(`label.name[data-drag][data-prop="rotate"]`).count())
await dragBy(handle, 40)
const bElAfterDrag = await elRotate()
const bInAfterDrag = await inputVal()
console.log('拖后 元素 rotate :', JSON.stringify(bElAfterDrag))
console.log('拖后 输入框      :', JSON.stringify(bInAfterDrag))
console.log('拖后 style 全文  :', JSON.stringify(await rawStyle()))
console.log('拖后 改动记录    :', JSON.stringify(await record()))
console.log(`==> 场景 B bug 成立: ${bInAfterDrag !== bInAfterEnter && bElAfterDrag === bElAfterEnter}`)

// ────────────────────────────────────────────── 对照组 1：先失焦再步进
console.log('\n--- 对照组 1：Enter 后先点别处失焦（框被同步成 45deg），再 ArrowUp ---')
await page.reload()
await injectVisBug(page, origin)
await page.waitForTimeout(400)
await select('bk0')
await typeRotate('45')
// 真失焦：直接 blur 该输入框（header 的 pointerdown 会 preventDefault，点它不掉焦点）
console.log('计算值 rotate     :', JSON.stringify(await page.evaluate(() =>
  getComputedStyle(document.getElementById('bk0')).rotate)))
await P(ROT).first().blur()
await page.waitForTimeout(320)
console.log('失焦后 焦点       :', await focused())
const cInBlur = await inputVal()
console.log('失焦后 输入框     :', JSON.stringify(cInBlur))
await P(ROT).first().click()
await page.waitForTimeout(200)
await P(ROT).first().press('ArrowUp')
await page.waitForTimeout(320)
console.log('ArrowUp 后 元素   :', JSON.stringify(await elRotate()),
            ' 输入框:', JSON.stringify(await inputVal()))

// ────────────────────────────────────────────── 对照组 2：同样手势用在 left（px 属性）上
console.log('\n--- 对照组 2：同一手势用在「位置 X」(left) 上，裸数字 Enter 后 ArrowUp ---')
await page.reload()
await injectVisBug(page, origin)
await page.waitForTimeout(400)
await deselect()
await page.locator('#relbox').scrollIntoViewIfNeeded()
await page.locator('#relbox').click({ position: { x: 180, y: 60 }, force: true })
await page.waitForTimeout(500)
console.log('选中的是          :', await page.evaluate(() => window.__visualRevise.panel.target?.id ?? '(空)'))
const L = 'input[data-prop="left"]'
if (await P(L).count()) {
  const li = P(L).first()
  await li.fill('45'); await li.press('Enter'); await page.waitForTimeout(340)
  const lEl1 = await page.evaluate(() => document.getElementById('relbox').style.left)
  const lIn1 = await li.inputValue()
  await li.press('ArrowUp'); await page.waitForTimeout(320)
  const lEl2 = await page.evaluate(() => document.getElementById('relbox').style.left)
  const lIn2 = await li.inputValue()
  console.log(`left: Enter 后 元素 ${JSON.stringify(lEl1)} 框 ${JSON.stringify(lIn1)}` +
              ` → ArrowUp 后 元素 ${JSON.stringify(lEl2)} 框 ${JSON.stringify(lIn2)}`)
  console.log('==> left 这条路正常（px 属性补 px 恰好合法）:', lEl2 === '46px')
} else {
  console.log('（relbox 上没有 left 字段，跳过）')
}

await browser.close(); await close()
