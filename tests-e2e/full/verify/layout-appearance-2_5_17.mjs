// 独立复现脚本 · 清单 2.5.17
// 报告称：<img> 等替换元素上仍渲染「裁剪内容」复选框，勾了写一条对替换元素
// 无效的 overflow:hidden 进改动记录与提示词。
// 期望（清单 §0 [非文字元素隐藏] + controls.js:356 isRelevant('overflow')）：
//   img/video/canvas/iframe/embed/object 上整块不渲染 → count === 0
// 全程真实交互（page.mouse.down/up、locator.click），不用 element.click() / dispatchEvent。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const P = sel => page.locator(`visual-revise-panel ${sel}`)

const inlineOverflow = id =>
  page.evaluate(i => document.getElementById(i).style.getPropertyValue('overflow'), id)

const stats = () => page.evaluate(() => window.__visualRevise.store.stats())

// 改动记录里这个元素身上到底躺着哪几条属性
const changesFor = id => page.evaluate(i => {
  const el = document.getElementById(i)
  const { edits } = window.__visualRevise.store.read()
  const hit = edits.find(e => e.el === el)
  return hit ? hit.changes.map(c => `${c.prop}: ${c.after ?? c.value ?? ''}`) : []
}, id)

const prompt = () => page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))

// 面板当前选中的是谁 + 各分区渲染情况
const panelState = () => page.evaluate(() => {
  const panel = document.querySelector('visual-revise-panel')
  const root = panel.shadowRoot
  return {
    target: panel.target ? `${panel.target.tagName.toLowerCase()}#${panel.target.id}` : null,
    sections: [...root.querySelectorAll('section[data-group]')].map(s => s.dataset.group),
    clipCount: root.querySelectorAll('.clip-toggle').length,
    clipChecked: root.querySelector('.clip-toggle')?.checked ?? null,
    orderCount: root.querySelectorAll('input[data-prop="order"]').length,
    clipLabel: (root.querySelector('.checkbox-field')?.textContent || '').replace(/\s+/g, ' ').trim(),
  }
})

const select = async id => {
  await page.evaluate(() => document.querySelector('visual-revise-panel')?.shadowRoot?.activeElement?.blur?.())
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  await page.locator(`#${id}`).click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(500)
}

// 真实鼠标点击：滚进视口 → 移到中心 → down/up
const realClick = async loc => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(360)
}

await page.goto(`${origin}/full/fixtures/layout-appearance.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

console.log('\n=== 2.5.17 裁剪内容在替换元素上的渲染 · 独立复现 ===\n')

// ── 对照组：普通 div，复选框本该在 ─────────────────────────
await select('pad')
const divState = await panelState()
console.log('[对照 div#pad]  target =', divState.target,
  ' clip-toggle count =', divState.clipCount, ' 分区 =', divState.sections.join(','))

// ── 目标：<img id="pic">，清单说这里整块不渲染 ────────────
await select('pic')
const picState = await panelState()
const picTag = await page.evaluate(() => document.getElementById('pic').tagName)
console.log('\n[目标 img#pic] tagName =', picTag, ' panel.target =', picState.target)
console.log('[目标 img#pic] 渲染出的分区 =', picState.sections.join(','))
console.log('[目标 img#pic] typography 分区在? =', picState.sections.includes('typography'),
  '  ← 同一条 [非文字元素隐藏] 规则在排版上确实生效')
console.log('[目标 img#pic] .clip-toggle count =', picState.clipCount, '（期望 0）')
console.log('[目标 img#pic] 复选框文案 =', JSON.stringify(picState.clipLabel))
console.log('[目标 img#pic] 复选框初始 checked =', picState.clipChecked,
  '  ← Chrome UA 表给 img 的是 overflow:clip，#renderClip 把它读成「已裁剪」')

const rendered = picState.clipCount > 0

// ── 勾上它，看会不会真的写一条无效声明 ─────────────────────
let wrote = null, recorded = [], promptHasOverflow = null, s0 = null, s1 = null
if (rendered) {
  s0 = await stats()
  console.log('\n[勾选前] store.stats().props =', s0.props, ' total =', s0.total,
    ' #pic inline overflow =', JSON.stringify(await inlineOverflow('pic')))

  // 初始就是勾着的（UA 的 overflow:clip），先点一下变成未勾，再点一下真正「勾上」
  if (picState.clipChecked) {
    await realClick(P('.clip-toggle'))
    const mid = await panelState()
    console.log('[第一次点击后] checked =', mid.clipChecked,
      ' inline overflow =', JSON.stringify(await inlineOverflow('pic')),
      ' props =', (await stats()).props)
  }
  await realClick(P('.clip-toggle'))
  const after = await panelState()
  console.log('[勾上之后] checked =', after.clipChecked)

  wrote = await inlineOverflow('pic')
  s1 = await stats()
  recorded = await changesFor('pic')
  const text = await prompt()
  promptHasOverflow = /overflow/.test(text)

  console.log('[勾选后] #pic inline overflow =', JSON.stringify(wrote))
  console.log('[勾选后] store.stats().props =', s1.props, ' total =', s1.total,
    ` （增量 props ${s1.props - s0.props}）`)
  console.log('[勾选后] 改动记录里 #pic 身上的属性 =', JSON.stringify(recorded))
  console.log('[勾选后] 导出提示词里含 overflow? =', promptHasOverflow)
  const seg = (text.match(/^.*overflow.*$/m) || [''])[0].trim()
  if (seg) console.log('[勾选后] 提示词里那一行 =', JSON.stringify(seg))

  // overflow 对替换元素到底有没有作用：img 的内容由 object-fit 管，
  // 写 hidden 前后渲染盒尺寸 / 可见画面不变
  const effect = await page.evaluate(() => {
    const el = document.getElementById('pic')
    const r = el.getBoundingClientRect()
    return { computedOverflow: getComputedStyle(el).overflow, box: `${r.width}×${r.height}` }
  })
  console.log('[勾选后] computed overflow =', effect.computedOverflow, ' 渲染盒 =', effect.box,
    '  ← 替换元素的内容不溢出盒子，这条声明改不了任何画面')
}

console.log(`\n==> 报告的「实际」是否复现（img 上 .clip-toggle count === 1）: ${rendered}`)
if (rendered)
  console.log(`==> 勾上后确实写进 inline + 改动记录 + 提示词: ${
    wrote === 'hidden' && recorded.some(c => c.startsWith('overflow')) && promptHasOverflow}`)

// ── 其余替换元素：UA 的 overflow 不都是 clip，未勾态下点一下会不会真写进去 ──
console.log('\n--- 其余替换元素（canvas / video / object）---')
await page.evaluate(() => {
  const wrap = document.createElement('div')
  wrap.className = 'box'
  wrap.innerHTML =
    '<canvas id="cv" width="80" height="60" style="background:#ddd"></canvas>' +
    '<video id="vid" width="80" height="60" style="background:#bbb"></video>' +
    '<object id="obj" type="text/plain" style="display:inline-block;width:80px;height:60px;background:#ccc"></object>'
  document.body.appendChild(wrap)
})
await page.waitForTimeout(200)

for (const id of ['cv', 'vid', 'obj']) {
  await select(id)
  const st = await panelState()
  const ua = await page.evaluate(i => getComputedStyle(document.getElementById(i)).overflow, id)
  console.log(`\n[${id}] panel.target = ${st.target}  UA overflow = ${ua}` +
    `  clip-toggle count = ${st.clipCount}（期望 0）  初始 checked = ${st.clipChecked}`)
  if (!st.clipCount) continue

  const before = await stats()
  await realClick(P('.clip-toggle'))
  const after = await stats()
  const inline = await inlineOverflow(id)
  const rec = await changesFor(id)
  const text = await prompt()
  console.log(`[${id}] 点一下之后：inline overflow = ${JSON.stringify(inline)}` +
    `  props ${before.props} → ${after.props}  改动记录 = ${JSON.stringify(rec)}`)
  console.log(`[${id}] 提示词里含 overflow? = ${/overflow/.test(text)}` +
    (/overflow/.test(text) ? `  行 = ${JSON.stringify((text.match(/^.*overflow.*$/m) || [''])[0].trim())}` : ''))
}

// ── 其余替换元素的 UA overflow（不必选中也能读） ──
console.log('\n--- 各替换元素的 UA computed overflow ---')
console.log(await page.evaluate(() => {
  const out = {}
  for (const tag of ['img', 'video', 'canvas', 'iframe', 'embed', 'object']) {
    const el = document.createElement(tag)
    el.style.cssText = 'width:40px;height:30px'
    document.body.appendChild(el)
    out[tag] = getComputedStyle(el).overflow
    el.remove()
  }
  return out
}))

// ── 页面样式表把 img 的 overflow 设成 visible 时，复选框是未勾态，
//    这时点一下会不会真把无效的 overflow:hidden 写进记录与提示词 ──
console.log('\n--- 页面样式 img { overflow: visible } 时 ---')
await page.evaluate(() => {
  const s = document.createElement('style')
  s.textContent = '#pic { overflow: visible }'
  document.head.appendChild(s)
})
await select('free'); await select('pic')
const vis = await panelState()
console.log('[img#pic] computed overflow =',
  await page.evaluate(() => getComputedStyle(document.getElementById('pic')).overflow),
  ' clip-toggle count =', vis.clipCount, ' 初始 checked =', vis.clipChecked)
if (vis.clipCount && vis.clipChecked === false) {
  const b = await stats()
  await realClick(P('.clip-toggle'))
  const a = await stats()
  const text = await prompt()
  console.log('[img#pic] 点一下之后：inline overflow =', JSON.stringify(await inlineOverflow('pic')),
    ` props ${b.props} → ${a.props}`, ' 改动记录 =', JSON.stringify(await changesFor('pic')))
  console.log('[img#pic] 提示词含 overflow? =', /overflow/.test(text),
    /overflow/.test(text) ? ` 行 = ${JSON.stringify((text.match(/^.*overflow.*$/m) || [''])[0].trim())}` : '')
}

await browser.close(); await close()
