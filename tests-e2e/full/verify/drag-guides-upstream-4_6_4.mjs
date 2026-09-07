// 独立复现脚本 · 清单 4.6.4「Position 工具的鼠标拖动改 left/top」
// 目的：验证「上游 Position 工具激活后，鼠标拖动元素是否真的写 left/top」，
// 以及 Visual Revise 自己的 layout-drag 是否抢走了这个手势。
//
// 全程真实指针：locator 只用来量位置，点击一律 page.mouse.*。
import { serve, launch, injectVisBug, ok } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const inline = (sel, prop) => page.evaluate(([s, p]) =>
  document.querySelector(s).style.getPropertyValue(p), [sel, prop])
const box = async sel => {
  const b = await page.locator(sel).boundingBox()
  if (!b) throw new Error(`量不到 ${sel}`)
  return b
}
const activeTool = () => page.evaluate(() => document.querySelector('vis-bug').activeTool)
const toolPoint = tool => page.evaluate(t => {
  const li = document.querySelector('vis-bug').$shadow.querySelector(`li[data-tool="${t}"]`)
  if (!li) return null
  const r = li.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, tool)
// 工具条 translateX(-200%) 起手、present-yourself 动画滑进来；动画没停就量到屏幕外坐标
const settleToolbar = () => page.waitForFunction(() => {
  const vb = document.querySelector('vis-bug')
  if (vb.style.display === 'none') return true
  const li = vb.$shadow.querySelector('li[data-tool="guides"]')
  const running = (vb.getAnimations?.() || []).some(a => a.playState === 'running')
  return !running && li.getBoundingClientRect().left >= 0
}, null, { timeout: 5000, polling: 30 })

const snap = async () => ({
  left:   await inline('#s0', 'left'),
  top:    await inline('#s0', 'top'),
  pos:    await inline('#s0', 'position'),
  parent: await page.evaluate(() => document.getElementById('s0').parentElement.id),
  // position.js 的 draggable.setup() 写 el.style.transition='none'，teardown() 清掉它。
  // 这条 inline 值就是「这个元素身上还挂没挂着 Position 的鼠标监听」的探针。
  trans:  await inline('#s0', 'transition'),
})

const dragS0 = async () => {
  const b = await box('#s0')
  await page.mouse.move(b.x + 60, b.y + 30)
  await page.mouse.down()
  const seen = []
  for (const d of [4, 12, 24, 40]) {
    await page.mouse.move(b.x + 60 + d, b.y + 30 + d)
    await page.waitForTimeout(40)
    seen.push(await page.evaluate(() => ({
      dragging: window.__visualRevise.layoutDrag.dragging,
      ghost: !!document.getElementById('visual-revise-drag-ghost'),
      trans: document.getElementById('s0').style.getPropertyValue('transition'),
      left: document.getElementById('s0').style.getPropertyValue('left'),
    })))
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
  return seen
}

// ── 场景 A：默认状态（layout-drag 开着，选择模式）──────────────
await page.goto(`${origin}/full/fixtures/drag-guides-upstream-tools.html`)
await injectVisBug(page, origin)
await page.waitForFunction(() => !!window.__visualRevise, null, { timeout: 10000 })
await page.waitForTimeout(250)

await page.keyboard.press('Meta+Slash')
await page.waitForFunction(() => document.querySelector('vis-bug').style.display === 'block',
  null, { timeout: 3000, polling: 30 })
await settleToolbar()

// 真实点击选中 #s0
{
  const b = await box('#s0')
  await page.mouse.click(b.x + 20, b.y + 20)
  await page.waitForTimeout(300)
}
ok(await page.evaluate(() => !!document.getElementById('s0').dataset.selected), 'A · #s0 已被选中')

// 点工具条上的 position 按钮
{
  const p = await toolPoint('position')
  await page.mouse.click(p.x, p.y)
  await page.waitForFunction(() => document.querySelector('vis-bug').activeTool === 'position',
    null, { timeout: 3000, polling: 30 }).catch(() => {})
  await page.waitForTimeout(250)
}
ok((await activeTool()) === 'position', `A · activeTool=${await activeTool()}`)

// 方向键先确认工具是活的
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(320)
ok((await inline('#s0', 'left')) === '1px',
  `A · ArrowRight 写入 left=${await inline('#s0', 'left')}（position=${await inline('#s0', 'position')}）`)

const beforeA = await snap()
const seenA = await dragS0()
const afterA = await snap()
console.log('  A · 拖拽过程：', JSON.stringify(seenA))
console.log(`  A · 拖前 ${JSON.stringify(beforeA)}`)
console.log(`  A · 拖后 ${JSON.stringify(afterA)}`)
ok(afterA.left !== beforeA.left || afterA.top !== beforeA.top,
  `A · 鼠标拖动应改 left/top（${beforeA.left}/${beforeA.top} → ${afterA.left}/${afterA.top}）`)

// ── 场景 B：反事实 —— 关掉 Visual Revise 自己的页面拖拽再拖一次 ──
// 干净重来，避免 A 场景遗留的 DOM 搬动 / 选中状态污染
await page.goto(`${origin}/full/fixtures/drag-guides-upstream-tools.html`)
await injectVisBug(page, origin)
await page.waitForFunction(() => !!window.__visualRevise, null, { timeout: 10000 })
await page.waitForTimeout(250)
await page.keyboard.press('Meta+Slash')
await page.waitForFunction(() => document.querySelector('vis-bug').style.display === 'block',
  null, { timeout: 3000, polling: 30 })
await settleToolbar()
{
  const b = await box('#s0')
  await page.mouse.click(b.x + 20, b.y + 20)
  await page.waitForTimeout(300)
  const p = await toolPoint('position')
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(300)
}
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(320)
await page.evaluate(() => window.__visualRevise.layoutDrag.setActive(false))
await page.waitForTimeout(150)

const beforeB = await snap()
const seenB = await dragS0()
const afterB = await snap()
console.log('  B · 拖拽过程：', JSON.stringify(seenB))
console.log(`  B · 拖前 ${JSON.stringify(beforeB)}`)
console.log(`  B · 拖后 ${JSON.stringify(afterB)}`)
ok(afterB.left !== beforeB.left || afterB.top !== beforeB.top,
  `B · 关掉 layout-drag 后鼠标拖动改 left/top（${beforeB.left}/${beforeB.top} → ${afterB.left}/${afterB.top}）`)

await browser.close()
await close()
