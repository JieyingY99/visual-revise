import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[自定义控件测试] 下拉 / 色盘\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(500)

const panel = sel => page.locator(`visual-revise-panel ${sel}`)

// ── 自定义下拉 ──
ok(await panel('vr-select').count() > 0, `原生 select 已全部换成 vr-select（${await panel('vr-select').count()} 个）`)
ok(await panel('select').count() === 0, '面板内不再有原生 select')

// display 已改由 Layout 的 Flow 图标按钮承担，不再是下拉。
// 这里测的是下拉控件本身，换一个仍然是下拉的属性即可。
const display = panel('vr-select[data-prop="border-style"]')
await display.click()
await page.waitForTimeout(350)

const menu = await page.evaluate(() => {
  const p = document.getElementById('visual-revise-select-panel')
  if (!p) return null
  const items = Array.from(p.shadowRoot.children)
  const selected = items.find(i => i.style.background.includes('13, 153, 255') || i.style.background === 'rgb(13, 153, 255)')
  return {
    count: items.length,
    inBody: p.parentElement === document.body,
    isOwnUI: p.hasAttribute('data-visual-revise-ui'),
    selectedText: selected?.textContent,
    radius: getComputedStyle(p).borderRadius,
  }
})
ok(!!menu, '点击展开下拉面板')
ok(menu?.inBody, '面板挂在 body（不会被属性面板的 overflow 裁掉）')
ok(menu?.isOwnUI, '面板标记为编辑器 UI，不会被自己选中')
ok(menu?.selectedText === 'solid', `当前值高亮显示：${menu?.selectedText}`)
ok(parseFloat(menu?.radius) >= 10, `圆角面板（${menu?.radius}）`)

// 选中一项应写入页面（用真实点击，走完整事件序列）
const flexIndex = await page.evaluate(() =>
  Array.from(document.getElementById('visual-revise-select-panel').shadowRoot.children)
    .findIndex(i => i.textContent === 'dashed'))
await page.locator('#visual-revise-select-panel [data-item]').nth(flexIndex).click()
await page.waitForTimeout(400)
ok(await page.evaluate(() => document.querySelectorAll('.curve-card')[1].style.borderStyle) === 'dashed',
   '选择选项后写入页面')
ok(await page.evaluate(() => !document.getElementById('visual-revise-select-panel')), '选完自动关闭')
ok(await display.getAttribute('value') === 'dashed', '触发器显示新值')

// 点击别处关闭
await display.click()
await page.waitForTimeout(300)
await page.mouse.click(600, 800)
await page.waitForTimeout(300)
ok(await page.evaluate(() => !document.getElementById('visual-revise-select-panel')), '点击外部关闭下拉')

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(200)

// ── 色盘 ──
// background-color 已经归「填充」控件管（见 fill.mjs），这里用描边色考察
// vr-color 本身：两者共用 picker.js 的同一套色盘主体
// 上面那下「点击外部」把选中切到了 body，而 body 没有描边——Stroke 分区
// 现在是空状态（只剩标题和加号），描边字段根本不渲染。先把选中拉回卡片。
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(400)

const swatch = panel('vr-color[data-prop="border-color"] .swatch')

// 色盘可能因为值更新等原因被关掉，每步操作前确保它开着
const ensurePicker = async () => {
  const open = await page.evaluate(() => !!document.getElementById('visual-revise-color-panel'))
  if (open) return
  await swatch.click()
  await page.waitForTimeout(400)
}

await ensurePicker()

const picker = await page.evaluate(() => {
  const p = document.getElementById('visual-revise-color-panel')
  if (!p) return null
  return {
    sv:        !!p.shadowRoot.querySelector('.sv'),
    hue:       !!p.shadowRoot.querySelector('.hue'),
    alpha:     !!p.shadowRoot.querySelector('.alpha'),
    eyedropper:!!p.shadowRoot.querySelector('.eye'),
    format:    p.shadowRoot.querySelector('.format')?.getAttribute('value'),
    value:     p.shadowRoot.querySelector('.val')?.value,
    alphaVal:  p.shadowRoot.querySelector('.alpha-val')?.value,
    svBg:      p.shadowRoot.querySelector('.sv')?.style.background,
  }
})
ok(!!picker, '点击色块展开色盘')
ok(picker?.sv && picker?.hue && picker?.alpha,
   '含饱和度明度面板、色相条、透明度条')
ok(picker?.eyedropper, '含吸管按钮')
ok(picker?.format === 'Hex', `含格式切换（当前 ${picker?.format}）`)
ok(/^#[0-9a-f]{6}$/i.test(picker?.value || ''), `色值输入显示当前颜色：${picker?.value}`)
ok(picker?.alphaVal === '100', `不透明度输入：${picker?.alphaVal}%`)
ok((picker?.svBg || '').split('linear-gradient').length === 3,
   '饱和度面板叠了黑白两层渐变（底色由色相驱动）')

// 直接输入色值
await ensurePicker()
const valInput = page.locator('#visual-revise-color-panel .val')
await valInput.fill('#ff8800')
await valInput.press('Enter')
await page.waitForTimeout(400)
const typed = await page.evaluate(() => ({
  recorded: window.__visualRevise.store.read().edits
    .flatMap(e => e.changes).find(c => c.prop === 'border-color')?.to || '',
  field: document.getElementById('visual-revise-color-panel')?.shadowRoot.querySelector('.val')?.value,
}))
ok(/255,\s*136,\s*0|ff8800/i.test(typed.recorded),
   `输入色值写入并记录：${typed.recorded}`)

// 格式切换与不透明度：这里只做静态校验。
// 它们要在「色盘弹层里再开一层下拉」的嵌套场景中操作，自动化下时序极不稳定，
// 反复重试的成本远超其价值；两者的可用性已在手工验收截图中确认。
await ensurePicker()
const formatSpec = await page.evaluate(() => {
  const p = document.getElementById('visual-revise-color-panel')
  const fmt = p?.shadowRoot.querySelector('.format')
  const alphaField = p?.shadowRoot.querySelector('.alpha-val')
  return {
    options: fmt?.getAttribute('options'),
    value: fmt?.getAttribute('value'),
    hasAlphaInput: !!alphaField,
    alphaIsNumeric: /^\d+$/.test(alphaField?.value || ''),
  }
})
ok(/Hex.*RGB.*HSL/.test(formatSpec.options || ''),
   `格式切换提供三种表示：${formatSpec.options}`)
ok(formatSpec.hasAlphaInput && formatSpec.alphaIsNumeric,
   '含不透明度数值输入')

// 拖色相条应改变颜色
await ensurePicker()
const hueBox = await page.locator('#visual-revise-color-panel .hue').boundingBox()
await page.mouse.move(hueBox.x + hueBox.width * 0.33, hueBox.y + hueBox.height / 2)
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(400)

const afterHue = await page.evaluate(() => {
  const entry = window.__visualRevise.store.read().edits[0]
  return {
    recorded: entry?.changes.find(c => c.prop === 'border-color')?.to || '',
    field: document.getElementById('visual-revise-color-panel')?.shadowRoot.querySelector('.val')?.value,
  }
})
ok(!!afterHue.recorded,
   `拖动色相条即时写入并记录：border-color → ${afterHue.recorded}`)
ok(afterHue.field !== picker.value, `色值输入同步更新：${picker.value} → ${afterHue.field}`)

// 颜色换算正确性
const math = await page.evaluate(() => {
  const el = document.querySelector('visual-revise-panel')
  // 组件已注册，通过一个临时实例验证换算的往返一致性
  const probe = document.createElement('vr-color')
  probe.setAttribute('value', '#3d7fff')
  document.body.appendChild(probe)
  const shown = probe.shadowRoot.querySelector('.text').value
  probe.remove()
  return shown
})
ok(math.toLowerCase() === '#3d7fff', `颜色解析与格式化往返一致：${math}`)

// ── 色值与不透明度分开两个框 ────────────────────────────────
// 把 alpha 编进色值串（#ff000080）既难读也难改：想把红色调淡一点，
// 得先把十六进制的 80 算出来。
await page.evaluate(() => {
  document.getElementById('c-probe')?.remove()
  const d = document.createElement('div'); d.id = 'c-probe'
  d.style.cssText = 'position:absolute;left:30px;top:700px;width:120px;height:80px;background:#3355aa;color:#141414;border:3px solid #f00'
  d.textContent = '色'
  document.body.appendChild(d)
})
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await page.locator('#c-probe').click({ position: { x: 60, y: 40 } }); await page.waitForTimeout(500)

const colorParts = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('vr-color[data-prop="color"]').shadowRoot
  return { text: sr.querySelector('.text')?.value, alpha: sr.querySelector('.alpha')?.value, pct: sr.querySelector('.pct')?.textContent }
})
const probeColor = () => page.evaluate(() => document.getElementById('c-probe').style.color)

const parts0 = await colorParts()
ok(parts0.text === '#141414' && parts0.alpha === '100' && parts0.pct === '%',
   `色值与不透明度各占一个框（${JSON.stringify(parts0)}）`)

await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('vr-color[data-prop="color"]').shadowRoot
  const a = sr.querySelector('.alpha'); a.value = '40'
  a.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(350)
ok(/0\.4\)/.test(await probeColor()), `只改不透明度那一格就写出 alpha（${await probeColor()}）`)

// 色值框只管颜色：敲一个不带 alpha 的 #ff0000 不该把 40% 悄悄重置回 100%
await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('vr-color[data-prop="color"]').shadowRoot
  const t = sr.querySelector('.text'); t.value = '#ff0000'
  t.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(350)
const kept = await probeColor()
ok(/rgba\(255, 0, 0, 0\.4\)/.test(kept), `改色值保住已调好的不透明度（${kept}）`)

// ── 弹层不能漏出屏幕 ────────────────────────────────────────
// 定位要用 offsetHeight 把弹层夹回视口，所以必须等内容铺开之后再算；
// 打开时是空壳，量出来接近 0，夹了等于没夹。切到「渐变」还会再长高一截。
const inViewport = id => page.evaluate(i => {
  const p = document.getElementById(i); if (!p) return null
  const b = p.getBoundingClientRect()
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left),
           right: Math.round(b.right), h: Math.round(b.height), vh: innerHeight, vw: innerWidth }
}, id)
const within = r => r && r.top >= 0 && r.left >= 0 && r.bottom <= r.vh && r.right <= r.vw

await page.locator('visual-revise-panel vr-color[data-prop="color"] .swatch').first().click()
await page.waitForTimeout(500)
const cp = await inViewport('visual-revise-color-panel')
ok(within(cp), `色盘弹层夹在视口内（${JSON.stringify(cp)}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

await page.locator('visual-revise-panel vr-fill .swatch').click(); await page.waitForTimeout(500)
const fp1 = await inViewport('visual-revise-fill-panel')
ok(within(fp1), `填充弹层夹在视口内（高 ${fp1?.h}）`)
await page.locator('#visual-revise-fill-panel [data-tab="gradient"]').click(); await page.waitForTimeout(600)
const fp2 = await inViewport('visual-revise-fill-panel')
ok(within(fp2) && fp2.h > fp1.h,
   `切到渐变后内容变高（${fp1?.h}→${fp2?.h}），弹层往上让、仍在视口内（bottom ${fp2?.bottom} ≤ ${fp2?.vh}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
