// 独立复现脚本 · 清单 2.4.8（选中丢失分支）
// 「在面板里横向拖数值时越过面板边缘松手，会把当前选中的元素换掉」
// 全程真实指针事件（page.mouse），不用 element.click() / dispatchEvent。
//
// 注：同目录的 panel-head-position-2_4_8.mjs 被另一位 agent 用于 2.4.8 的
// 「旋转框裸数字」分支，这里换个文件名避免互相覆盖。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIX = `${origin}/full/fixtures/panel-head-position-main.html`

const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const pause = ms => page.waitForTimeout(ms)
const P = sel => page.locator(`visual-revise-panel ${sel}`)

const inline = (sel, prop) =>
  page.evaluate(([s, p]) => document.querySelector(s)?.style.getPropertyValue(p) ?? null, [sel, prop])

const target = () => page.evaluate(() => {
  const t = window.__visualRevise?.panel?.target
  if (!t) return '(无选中)'
  return `${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}`
})

const selectedIds = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')]
    .map(n => `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}`))

const deselect = async () => {
  await page.keyboard.press('Escape'); await pause(140)
  await page.keyboard.press('Escape'); await pause(140)
}

const select = async selector => {
  await deselect()
  const loc = page.locator(selector)
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ force: true, position: { x: 4, y: 4 } })
  await pause(450)
}

const chooseSelect = async (prop, value) => {
  const trigger = P(`vr-select[data-prop="${prop}"]`).first()
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click(); await pause(300)
  const items = page.locator('#visual-revise-select-panel [data-item]')
  const n = await items.count()
  for (let i = 0; i < n; i++) {
    if ((await items.nth(i).textContent())?.trim() === value) {
      await items.nth(i).click(); await pause(450); return true
    }
  }
  return false
}

// 真实指针拖拽：按下 → 分 6 步横移 dx → 松开。返回起点/终点坐标。
const dragBy = async (locator, dx) => {
  const b = await locator.boundingBox()
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy, { steps: 6 })
  await page.mouse.up()
  await pause(350)
  return { from: [Math.round(cx), Math.round(cy)], to: [Math.round(cx + dx), Math.round(cy)] }
}

// 记录松手那一下 click 事件到底打在谁身上（document 捕获阶段，与 selectable 同层）
const armClickProbe = () => page.evaluate(() => {
  window.__probe = []
  window.__probeFn = e => {
    const t = e.composedPath()[0]
    window.__probe.push({
      type: e.type,
      path0: t?.tagName ? `${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}` : String(t),
      target: e.target?.tagName ? `${e.target.tagName.toLowerCase()}${e.target.id ? '#' + e.target.id : ''}` : String(e.target),
      xy: [Math.round(e.clientX), Math.round(e.clientY)],
    })
  }
  document.addEventListener('click', window.__probeFn, true)
})
const readProbe = () => page.evaluate(() => {
  document.removeEventListener('click', window.__probeFn, true)
  return window.__probe
})

const panelBox = () => page.locator('visual-revise-panel').boundingBox()

console.log('\n=== 2.4.8 拖数值越过面板边缘 · 独立复现 ===\n')

await page.goto(FIX)
await page.evaluate(() => { try { localStorage.removeItem('visual-revise:panel-pos') } catch {} })
await injectVisBug(page, origin)
await pause(400)

// ── 步骤 2：选中 #bk0，把定位改成 relative 让 X / Y 出现
await select('#bk0')
console.log('选中之后 panel.target :', await target())
const gotSelect = await chooseSelect('position', 'relative')
console.log('定位下拉选 relative   :', gotSelect ? 'ok' : '失败')
console.log('改完之后 panel.target :', await target())

// ── 步骤 3：量面板矩形与 X 前缀矩形
const pb = await panelBox()
const prefix = P('.prefix[data-drag][data-prop="left"]').first()
await prefix.scrollIntoViewIfNeeded()
const xb = await prefix.boundingBox()
console.log(`\n面板矩形             : left=${Math.round(pb.x)} top=${Math.round(pb.y)} w=${Math.round(pb.width)}`)
console.log(`X 前缀矩形           : x=${Math.round(xb.x)} y=${Math.round(xb.y)} w=${Math.round(xb.width)}`)
console.log(`前缀中心离面板左缘   : ${Math.round(xb.x + xb.width / 2 - pb.x)}px`)

// 先给 left 一个已知起点，方便核对步长
await P('input[data-prop="left"]').first().fill('34')
await P('input[data-prop="left"]').first().press('Enter')
await pause(320)
console.log('拖之前 #bk0 left     :', await inline('#bk0', 'left'))

// ── 对照组 A：整段拖拽都留在面板内（右移 20px）
const beforeA = await target()
const moveA = await dragBy(prefix, 20)
console.log(`\n[对照组 A] 面板内右拖 20px  ${moveA.from} → ${moveA.to}`)
console.log('  #bk0 left           :', await inline('#bk0', 'left'))
console.log('  panel.target        :', beforeA, '→', await target())

// ── 被测行为：左移 40px，终点落在面板外的页面上
await P('input[data-prop="left"]').first().fill('34')
await P('input[data-prop="left"]').first().press('Enter')
await pause(320)

const beforeB = await target()
const selBefore = await selectedIds()
await armClickProbe()
const moveB = await dragBy(prefix, -40)
const probe = await readProbe()

console.log(`\n[被测] 左拖 40px 越过面板左缘  ${moveB.from} → ${moveB.to}（面板左缘 ${Math.round(pb.x)}）`)
console.log('  终点在面板外        :', moveB.to[0] < pb.x)
console.log('  #bk0 left           :', await inline('#bk0', 'left'), '（期望 14px：-40px / 2 = -20 步）')
console.log('  panel.target        :', beforeB, '→', await target())
console.log('  [data-selected] 元素 :', JSON.stringify(selBefore), '→', JSON.stringify(await selectedIds()))
console.log('  松手时的 click 事件  :', JSON.stringify(probe))

// 面板重绘成了别人的属性？看看 Position 分区里 X 框还在不在、面板标题是谁
const head = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel')?.shadowRoot
  return {
    tag: sr?.querySelector('.tag')?.textContent?.trim() ?? '(无)',
    hasX: !!sr?.querySelector('input[data-prop="left"]'),
  }
})
console.log('  面板头部元素名      :', head.tag, '· X 输入框还在:', head.hasX)

const finalTarget = await target()
console.log(`\n结论：数值 = ${await inline('#bk0', 'left')}；松手后 panel.target = ${finalTarget}`)
console.log(finalTarget === 'div#bk0'
  ? '→ 选中保住了，未复现'
  : '→ 选中被换掉了，复现')

await browser.close()
await close()
