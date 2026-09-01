import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[换图测试] 属性改动 / 撤销 / 提示词落盘\n')
await page.goto(origin)
await injectVisBug(page, origin)

// 1×1 PNG，作为「用户挑的新图」
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64')

await page.evaluate(() => {
  const img = document.createElement('img')
  img.className = 'shot'
  img.setAttribute('src', '/assets/hero-original.png')
  img.setAttribute('srcset', '/assets/hero-original@2x.png 2x')
  img.style.cssText = 'width:120px;height:60px;display:block;margin:20px'
  document.querySelector('.hero').appendChild(img)
})

const panel = sel => page.locator(`visual-revise-panel ${sel}`)
await page.locator('.shot').click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(450)

ok(await panel('.swap-image').count() === 1, '图片元素的 Fill 分区有换图按钮')

// ── 换图 ────────────────────────────────────────────────────
page.on('filechooser', async chooser => {
  await chooser.setFiles({ name: 'new-hero.png', mimeType: 'image/png', buffer: PNG })
})
await panel('.swap-image').click()
await page.waitForTimeout(900)

const after = await page.evaluate(() => {
  const el = document.querySelector('.shot')
  return { src: el.getAttribute('src'), srcset: el.getAttribute('srcset') }
})
ok(after.src.startsWith('data:image/png'), '换图后 src 变成新图的 dataUrl')
ok(!after.srcset,
   'srcset 被一并清掉——它的优先级高于 src，留着新图根本不会显示')

// ── 改动记录 ────────────────────────────────────────────────
const stats = await page.evaluate(() => window.__visualRevise.store.stats())
ok(stats.attrs === 2, `属性改动被记录（src + srcset）：attrs=${stats.attrs}`)
ok(stats.total >= 2, `换图计入总数：total=${stats.total}`)

const listed = await page.evaluate(() => {
  const el = document.createElement('div')
  const { edits } = window.__visualRevise.store.read()
  void el
  return edits.map(e => (e.attrs || []).map(a => `${a.attr}:${a.to.slice(0, 12)}`))
})
ok(JSON.stringify(listed).includes('src:data:image/'),
   `改动记录里能看到换图：${JSON.stringify(listed)}`)

// 列表里不能出现整段 base64
await page.evaluate(() => { document.querySelector('visual-revise-list').hidden = false })
await page.waitForTimeout(300)
// 只取列表项：shadowRoot.textContent 会把 <style> 里的 CSS 也算进来
const listText = await page.locator('visual-revise-list')
  .evaluate(el => el.shadowRoot.querySelector('.items').textContent)
ok(listText.includes('换图') && listText.includes('新图片'),
   '改动列表显示「换图 → 新图片」而不是整段 base64')
ok(listText.length < 500, `列表文本没有被 dataUrl 撑爆（${listText.length} 字符）`)

// ── 提示词 ──────────────────────────────────────────────────
const prompt = await page.evaluate(async () => {
  const { buildPrompt } = window.__visualRevise.lib
  return buildPrompt(window.__visualRevise.store.read(), { url: 'http://x/', viewport: '1440 × 900' })
})
ok(prompt.includes('图片替换'), '提示词有独立的「图片替换」段落')
ok(prompt.includes('/assets/hero-original.png'),
   '提示词写出原图地址（AI 靠它在源码里定位是哪张图）')
ok(prompt.includes('srcset') && prompt.includes('连带动作'),
   'srcset 被清空一事有说明，免得 AI 当成用户的需求')
ok(!prompt.includes('iVBORw0KGgo'),
   '提示词里没有整段 base64（几十万字符没法粘贴，AI 也读不了）')
ok(prompt.includes('处图片替换'), `摘要里统计了图片替换：${prompt.split('\n').find(l => l.startsWith('改动：'))}`)

// ── 撤销 ────────────────────────────────────────────────────
const id = await page.evaluate(() => window.__visualRevise.store.read().edits[0].id)
await page.evaluate(i => window.__visualRevise.store.undoAttr(i, 'src'), id)
await page.waitForTimeout(300)
const reverted = await page.evaluate(() => document.querySelector('.shot').getAttribute('src'))
ok(reverted === '/assets/hero-original.png', `单条撤销恢复原 src：${reverted}`)

// 全部重置也要还原属性
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(300)
const resetState = await page.evaluate(() => {
  const el = document.querySelector('.shot')
  return { src: el.getAttribute('src'), srcset: el.getAttribute('srcset') }
})
ok(resetState.src === '/assets/hero-original.png' && resetState.srcset === '/assets/hero-original@2x.png 2x',
   `重置全部改动时属性一并还原：src=${resetState.src} srcset=${resetState.srcset}`)

// ── 背景图换图 ──────────────────────────────────────────────
await page.evaluate(() => {
  const box = document.createElement('div')
  box.className = 'bgbox'
  box.style.cssText =
    'width:120px;height:60px;margin:20px;background-image:url("/assets/bg-original.png")'
  document.querySelector('.hero').appendChild(box)
})
await page.locator('.bgbox').click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(450)
await panel('.swap-image').click()
await page.waitForTimeout(900)

const bgAfter = await page.evaluate(() =>
  document.querySelector('.bgbox').style.getPropertyValue('background-image'))
ok(bgAfter.includes('data:image/png'), '背景图元素换图走 CSS 通道，写进 background-image')

const bgPrompt = await page.evaluate(() => {
  const { buildPrompt } = window.__visualRevise.lib
  return buildPrompt(window.__visualRevise.store.read())
})
ok(bgPrompt.includes('原背景图') && bgPrompt.includes('bg-original.png'),
   '提示词写出原背景图地址')
ok(!bgPrompt.includes('iVBORw0KGgo'),
   '背景图的 dataUrl 也不会整段进提示词（属性表里被替换掉）')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
