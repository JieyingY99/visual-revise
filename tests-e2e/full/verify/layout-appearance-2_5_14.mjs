// 独立复现脚本 · 清单 2.5.14
// 「两段式内 / 外边距的前缀拖拽只改输入框数字，一条声明都不写」
// 全程真实指针事件（page.mouse），不用 element.click() / dispatchEvent。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const P = sel => page.locator(`visual-revise-panel ${sel}`)

const styles = (id, props) => page.evaluate(([i, ps]) => {
  const s = document.getElementById(i).style
  return Object.fromEntries(ps.map(p => [p, s.getPropertyValue(p)]))
}, [id, props])

// 改动记录：展开成 "元素 → prop: from → to" 的扁平列表
const record = () => page.evaluate(() => {
  const st = window.__visualRevise.store
  const { edits } = st.read()
  return {
    depth: st.history.depth,
    props: edits.flatMap(e => e.changes.map(c => `${e.el.id || e.el.tagName}#${c.prop}: ${c.from} → ${c.to}`)),
  }
})

// 真实指针拖拽：按下 → 分 8 步右移 dx → 松开
const dragBy = async (loc, dx) => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(320)
}

const select = async id => {
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  await page.locator(`#${id}`).click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(500)
}

await page.goto(`${origin}/full/fixtures/layout-appearance.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

console.log('\n=== 2.5.14 两段式间距前缀拖拽 · 独立复现 ===\n')

await select('pad')

// 手柄本身的属性：确认它到底挂了什么
const handleAttrs = await page.evaluate(() => {
  const h = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('.prefix[data-drag][data-pair="padding:vertical"]')
  return h ? { pair: h.dataset.pair, prop: h.dataset.prop ?? '(无 data-prop)' } : null
})
console.log('手柄属性        :', JSON.stringify(handleAttrs))

const before = await styles('pad', ['padding-top', 'padding-bottom'])
const inBefore = await P('input[data-pair="padding:vertical"]').inputValue()
const recBefore = await record()
console.log('拖之前 元素 inline:', JSON.stringify(before))
console.log('拖之前 输入框     :', JSON.stringify(inBefore))
console.log('拖之前 history 深度:', recBefore.depth)

// ── 被测行为：拖两段式「垂直」前缀 +40px（= 20 步 → 10 应变 30）
await dragBy(P('.prefix[data-drag][data-pair="padding:vertical"]'), 40)

const after = await styles('pad', ['padding-top', 'padding-bottom'])
const inAfter = await P('input[data-pair="padding:vertical"]').inputValue()
const recAfter = await record()
console.log('\n拖之后 元素 inline:', JSON.stringify(after))
console.log('拖之后 输入框     :', JSON.stringify(inAfter))
console.log('拖之后 history 深度:', recAfter.depth)
console.log('拖之后 改动记录   :', JSON.stringify(recAfter.props))

// 元素身上有没有多出一条名字奇怪的声明（applyProp 拿到 undefined 时可能写歪）
const rawStyle = await page.evaluate(() => document.getElementById('pad').getAttribute('style'))
console.log('拖之后 style 全文 :', JSON.stringify(rawStyle))

const uiSaysChanged  = inAfter !== inBefore
const elReallyChanged = after['padding-top'] !== before['padding-top']
                     || after['padding-bottom'] !== before['padding-bottom']
console.log(`\n[A] 输入框数字变了？ ${uiSaysChanged}   [B] 元素真的变了？ ${elReallyChanged}`)
console.log(`==> 界面与元素不一致（bug 成立）: ${uiSaysChanged && !elReallyChanged}`)

// ── 对照组 1：同一套拖拽手势，用在 data-prop 齐全的手柄（W 前缀）上
console.log('\n--- 对照组 1：宽度 W 前缀（有 data-prop）同样拖 +40px ---')
const wBefore = await styles('pad', ['width'])
await dragBy(P('.prefix[data-drag][data-prop="width"]'), 40)
const wAfter = await styles('pad', ['width'])
console.log('width:', JSON.stringify(wBefore), '→', JSON.stringify(wAfter))
console.log('==> 对照组手势本身有效:', wAfter.width !== wBefore.width)

// ── 对照组 2：同一个两段式输入框，改用键入（走 input[data-pair] change 那条路）
console.log('\n--- 对照组 2：同一个两段式框改用键入 "33" ---')
const pv = P('input[data-pair="padding:vertical"]')
await pv.scrollIntoViewIfNeeded(); await pv.fill('33'); await pv.press('Enter')
await page.waitForTimeout(340)
const typed = await styles('pad', ['padding-top', 'padding-bottom'])
console.log('键入后 元素 inline:', JSON.stringify(typed))
console.log('==> 键入这条路正常:', typed['padding-top'] === '33px' && typed['padding-bottom'] === '33px')

await browser.close(); await close()
