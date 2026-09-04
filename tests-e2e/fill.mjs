import { serve, launch, injectVisBug, ok } from './harness.mjs'
import {
  parseGradient, serializeGradient, setAngle, setType, reverseStops, readAngle,
} from '../app/core/gradient.js'

console.log('\n[填充测试] 渐变解析 / 标签切换 / 色标编辑\n')

// ── 渐变解析与序列化（纯逻辑，不用起浏览器）────────────────
const round1 = g => serializeGradient(parseGradient(g))

ok(round1('linear-gradient(45deg, rgb(196, 196, 196) 0%, rgb(94, 94, 94) 100%)')
   === 'linear-gradient(45deg, rgb(196, 196, 196) 0%, rgb(94, 94, 94) 100%)',
   '带角度与百分比的渐变原样往返')

ok(round1('linear-gradient(#4f46e5, #0ea5e9)') === 'linear-gradient(180deg, #4f46e5 0%, #0ea5e9 100%)',
   '省略方向时按 CSS 默认补成 180deg，省略位置补成 0%/100%')

ok(round1('conic-gradient(from 90deg, red, yellow, red)')
   === 'conic-gradient(from 90deg, red 0%, yellow 50%, red 100%)',
   '中间色标按 CSS 规则均分：yellow 落在 50%')

ok(parseGradient('linear-gradient(135deg, rgba(0, 0, 0, 0.5) 10%, #fff 40%, blue)').stops.length === 3,
   'rgba() 里的逗号不会被当成色标分隔符')

ok(parseGradient('url("x.png")') === null && parseGradient('none') === null,
   'url() 与 none 不是渐变')

// to top right 的真实角度取决于盒子宽高比，折成固定角度会改变渲染结果
const corner = parseGradient('linear-gradient(to top right, #fff, #000)')
ok(serializeGradient(corner).includes('to top right'), '不动角度时「角」关键字原样写回，不折成 45deg')
ok(serializeGradient(setAngle(corner, 90)).startsWith('linear-gradient(90deg'), '改了角度才换成度数')
ok(serializeGradient(setType(corner, 'radial')) === 'radial-gradient(#fff 0%, #000 100%)',
   '换成径向时丢掉线性专用的方向写法')

ok(serializeGradient(reverseStops(parseGradient('linear-gradient(90deg, red 0%, blue 30%, lime 100%)')))
   === 'linear-gradient(90deg, lime 0%, blue 30%, red 100%)',
   '反转只换颜色不换位置')

ok(readAngle('0.5turn') === 180 && readAngle('200grad') === 180 && readAngle('to left') === 270,
   'turn / grad / 关键字都能换算成度数')

// ── 面板交互 ──────────────────────────────────────────────
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

await page.goto(origin)
await injectVisBug(page, origin)
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(500)

const panel = sel => page.locator(`visual-revise-panel ${sel}`)
const style = prop => page.evaluate(
  p => document.querySelectorAll('.curve-card')[1].style.getPropertyValue(p), prop)

const fillPanel = '#visual-revise-fill-panel'
const openFill = async () => {
  if (await page.evaluate(id => !!document.getElementById(id), 'visual-revise-fill-panel')) return
  await panel('vr-fill').click()
  await page.waitForTimeout(350)
}
const tab = async name => {
  await openFill()
  await page.locator(`${fillPanel} [data-tab="${name}"]`).click()
  await page.waitForTimeout(350)
}

ok(await panel('vr-fill').count() === 1, 'Fill 分区用一个填充控件作入口')
ok(await panel('vr-color[data-prop="background-color"]').count() === 0,
   '背景色不再是独立字段，已并入填充控件')
// 背景图那行文本框已去掉：vr-fill 同时管着 background-color 与
// background-image，两处编辑同一件事只会让人犹豫该改哪个。属性仍在跟踪。
ok(await panel('input[data-prop="background-image"]').count() === 0,
   '背景图不再单独给一行文本框，统一走填充控件')

ok((await panel('vr-fill .label').textContent()).includes('#101014'),
   `触发器显示当前填充：${await panel('vr-fill .label').textContent()}`)

await openFill()
const tabs = await page.locator(`${fillPanel} [data-tab]`).evaluateAll(
  els => els.map(e => e.dataset.tab))
ok(JSON.stringify(tabs) === JSON.stringify(['none', 'solid', 'gradient']),
   `弹层三个标签：${tabs.join(' / ')}`)
ok(await page.evaluate(id => {
  const p = document.getElementById(id)
  return p.parentElement === document.body && p.hasAttribute('data-visual-revise-ui')
}, 'visual-revise-fill-panel'), '弹层挂在 body 且标记为编辑器 UI')

// ── 无 ──
await tab('none')
ok(await style('background-color') === 'transparent' && await style('background-image') === 'none',
   `「无」同时清掉两条属性：${await style('background-color')} / ${await style('background-image')}`)

// ── 纯色 ──
await tab('solid')
ok(await page.locator(`${fillPanel} .sv`).count() === 1, '纯色标签里是完整色盘')

const val = page.locator(`${fillPanel} .val`)
await val.fill('#3d7fff')
await val.press('Enter')
await page.waitForTimeout(400)
ok(await style('background-color') === 'rgb(61, 127, 255)',
   `纯色写入 background-color：${await style('background-color')}`)
ok(await style('background-image') === 'none', '纯色会清掉 background-image，否则会被盖住')

// ── 渐变 ──
await tab('gradient')
const g1 = await style('background-image')
ok(/^linear-gradient\(/.test(g1), `「渐变」写入 background-image：${g1}`)
ok(await page.locator(`${fillPanel} [data-row]`).count() === 2, '默认两档色标')
ok(g1.includes('rgb(61, 127, 255)'),
   '新建渐变时用当前的纯色做第一档，不是凭空给两个灰')

// 类型
await page.locator(`${fillPanel} [data-type="radial"]`).click()
await page.waitForTimeout(350)
ok(/^radial-gradient\(/.test(await style('background-image')),
   `切径向：${await style('background-image')}`)
ok(await page.locator(`${fillPanel} .angle`).count() === 0, '径向渐变没有角度可调，这一行会收起来')

await page.locator(`${fillPanel} [data-type="linear"]`).click()
await page.waitForTimeout(350)

// 角度
const angle = page.locator(`${fillPanel} .angle`)
await angle.fill('90')
await angle.press('Enter')
await page.waitForTimeout(350)
ok((await style('background-image')).includes('90deg'), `改角度：${await style('background-image')}`)

// 新增色标：点色标条的中间
const bar = await page.locator(`${fillPanel} .bar-fill`).boundingBox()
await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2)
await page.waitForTimeout(350)
ok(await page.locator(`${fillPanel} [data-row]`).count() === 3, '点色标条中间新增一档')

const mid = await page.locator(`${fillPanel} [data-pos="1"]`).inputValue()
ok(Math.abs(parseFloat(mid) - 50) < 6, `新色标落在点击位置附近：${mid}%`)

// 改色标位置
const posInput = page.locator(`${fillPanel} [data-pos="1"]`)
await posInput.fill('25')
await posInput.press('Enter')
await page.waitForTimeout(350)
ok((await style('background-image')).includes('25%'),
   `改色标位置写回页面：${await style('background-image')}`)

// 改色标颜色
const hexInput = page.locator(`${fillPanel} [data-hex="1"]`)
await hexInput.fill('#ff0066')
await hexInput.press('Enter')
await page.waitForTimeout(400)
ok((await style('background-image')).includes('255, 0, 102') ||
   (await style('background-image')).includes('#ff0066'),
   `改色标颜色写回页面：${await style('background-image')}`)

// 反转
const before = await style('background-image')
await page.locator(`${fillPanel} .reverse`).click()
await page.waitForTimeout(350)
const after = await style('background-image')
ok(before !== after && after.includes('25%'),
   '反转换的是颜色顺序，色标位置不动')

// 删除色标
await page.locator(`${fillPanel} [data-del="1"]`).click()
await page.waitForTimeout(350)
ok(await page.locator(`${fillPanel} [data-row]`).count() === 2, '删掉中间那档')
ok(await page.locator(`${fillPanel} [data-del="0"]`).isDisabled(),
   '只剩两档时禁止再删——渐变至少要两个色标')

// ── 有背景图时的提示 ──
await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[1]
  window.__visualRevise.store.applyProp(el, 'background-image', 'url("data:image/gif;base64,R0lGODlhAQABAAAAACw=")')
})
await page.waitForTimeout(300)
await tab('solid')
ok((await page.locator(`${fillPanel}`).textContent()).includes('背景图'),
   '元素上有背景图时，纯色标签会先说明它会被清掉')
ok((await style('background-image')).startsWith('url('),
   '光是切到纯色标签不动背景图——点进来看看不该把人家的图清掉')

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(300)

// ── 导出 ──
await tab('gradient')
const md = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
ok(md.includes('background-image') && md.includes('gradient'),
   '渐变作为一条 background-image 改动进入提示词')
ok(md.includes('填充'), '归到「填充」分区名下')

// 背景图不再单独给一行文本框：vr-fill 已经同时管着 background-color 与
// background-image，两处编辑同一件事只会让人犹豫该改哪个。仍然继续跟踪。
const fillFields = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    labels: [...sr.querySelectorAll('label.name')].map(l => l.textContent.trim()),
    bgInput: !!sr.querySelector('input[data-prop="background-image"]'),
    hasFill: !!sr.querySelector('vr-fill'),
  }
})
ok(!fillFields.labels.includes('背景图') && !fillFields.bgInput && fillFields.hasFill,
   `背景图不再单独成行，填充控件仍在（标签：${fillFields.labels.join(' / ')}）`)

await browser.close()
await close()
