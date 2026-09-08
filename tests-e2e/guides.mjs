import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[间距标尺测试]\n')
await page.goto(origin)
await injectVisBug(page, origin)

console.log('  当前工具:', await page.evaluate(() => document.querySelector('vis-bug').activeTool))

// 选中一个元素，再 hover 另一个 —— VisBug guides 的测距交互。
// hover 左边那张而不是右边：属性面板会摆到选中元素的右侧，右邻正好被它盖住。
// 这是「面板贴着选中元素」这个设计固有的代价，不是 bug。
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.locator('.curve-card').nth(0).hover({ position: { x: 4, y: 4 } })
await page.waitForTimeout(500)

const measure = await page.evaluate(() => ({
  distance:  document.querySelectorAll('visbug-distance').length,
  gridlines: document.querySelectorAll('visbug-gridlines').length,
  handles:   document.querySelectorAll('visbug-handles').length,
}))
ok(measure.distance > 0 || measure.gridlines > 0,
   `选中后 hover 另一元素显示测距（distance=${measure.distance}, gridlines=${measure.gridlines}）`)

// 读出实际距离文本
const labels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('visbug-distance'))
    .map(d => d.shadowRoot?.textContent?.trim() || d.textContent.trim())
    .filter(Boolean).slice(0, 6))
console.log('  测距标签:', labels)
ok(labels.length > 0, `测距显示了 ${labels.length} 个距离标签`)

ok(measure.handles > 0, '选中框仍正常显示（面板未干扰 VisBug 原有能力）')


// ─── E 组补测：4.5.6 标尺线半透明 / 4.5.7 拖出的参考线 / 4.5.8 测距线本体半透明 ───
console.log('\n[线的透明度 · 补测] 标尺线 / 参考线 / 测距线\n')

// 4.5.6：visbug-gridlines 整块 opacity .5
const gridOpacity = await page.evaluate(() => {
  const g = document.querySelector('visbug-gridlines')
  return g ? getComputedStyle(g).opacity : null
})
ok(gridOpacity === '0.5', `标尺线 visbug-gridlines 整块透明度期望 0.5（实际 ${gridOpacity ?? '找不到元素'}）`)

// 4.5.8：测距线本体（figure 里的 span / div）opacity .5，数字标签 figcaption 保持实色
const dist = await page.evaluate(() => {
  const d = document.querySelector('visbug-distance')
  const root = d?.$shadow || d?.shadowRoot
  if (!root) return null
  const op = sel => [...root.querySelectorAll(sel)].map(el => getComputedStyle(el).opacity)
  return { lines: op('figure span, figure div'), tags: [...root.querySelectorAll('figure span, figure div')].map(el => el.tagName.toLowerCase()),
    caps: op('figure figcaption'), capText: root.querySelector('figure figcaption')?.textContent.trim() ?? '' }
})
ok(dist && dist.lines.length > 0 && dist.lines.every(o => o === '0.5'),
  `测距线本体（figure 里的 ${dist ? dist.tags.join('/') : '?'}）透明度期望全部 0.5（实际 ${dist ? dist.lines.join(',') || '一条线都没有' : '找不到 visbug-distance'}）`)
ok(dist && dist.caps.length > 0 && dist.caps.every(o => o === '1'),
  `线上的数字标签 figcaption 保持实色，透明度期望 1（实际 ${dist ? dist.caps.join(',') : '找不到'}，文字「${dist?.capText}」）`)

// 4.5.7：拖出的参考线。createGuide() 在 app/features/guides.js 里，本分支没有任何
// UI 路径调它（打包时被摇掉），运行时造不出这条线，只能对源码断言它的底色与标记
const guideSrc = await (await import('node:fs/promises'))
  .readFile(new URL('../app/features/guides.js', import.meta.url), 'utf8')
const bg = guideSrc.match(/background:\s*hsla\(330,\s*100%,\s*71%,\s*(\d+)%\)/)
ok(bg && bg[1] === '50',
  `参考线底色从 70% 降到 50%：期望 hsla(330, 100%, 71%, 50%)（实际 ${bg ? bg[0] : '没匹配到 background 声明'}）`)
ok(/guide\.dataset\.visualReviseGuide\s*=/.test(guideSrc),
  `参考线带上 data-visual-revise-guide 标记（期望源码里有 guide.dataset.visualReviseGuide 赋值，实际 ${/guide\.dataset\.visualReviseGuide\s*=/.test(guideSrc)}）`)

// 这个标记要能被 --vr-inv-zoom 的规则命中：页面缩放到 2 倍时它拿到 0.5
const inv = await page.evaluate(async () => {
  const d = document.createElement('div')
  d.dataset.visualReviseGuide = ''
  document.body.appendChild(d)
  const before = getComputedStyle(d).getPropertyValue('--vr-inv-zoom').trim()
  document.documentElement.dataset.visualReviseZoom = '2'
  dispatchEvent(new Event('visual-revise:zoom'))
  await new Promise(r => setTimeout(r, 200))
  const after = getComputedStyle(d).getPropertyValue('--vr-inv-zoom').trim()
  // 复位要显式写回 1：属性被删掉时 acceptAttr 会原样保留上一次的绝对倍数
  document.documentElement.dataset.visualReviseZoom = '1'
  dispatchEvent(new Event('visual-revise:zoom'))
  await new Promise(r => setTimeout(r, 200))
  const restored = getComputedStyle(d).getPropertyValue('--vr-inv-zoom').trim()
  d.remove()
  delete document.documentElement.dataset.visualReviseZoom
  return { before, after, restored }
})
ok(inv.before === '' && inv.after === '0.5' && inv.restored === '',
  `[data-visual-revise-guide] 命中 --vr-inv-zoom 规则：1 倍时期望没有变量（实际「${inv.before}」）、2 倍时期望 0.5（实际「${inv.after}」）、复位后期望又没有（实际「${inv.restored}」）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
