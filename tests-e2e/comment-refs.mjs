import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[评论参考图测试] 三种入口 / 说明 / 提示词 / 输入不丢\n')
await page.goto(origin)
await injectVisBug(page, origin)

const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG = Buffer.from(B64, 'base64')
const layer = sel => page.locator(`visual-revise-comment-layer ${sel}`)

const startDraft = async (target = '.curve-card') => {
  await page.keyboard.press('c')
  await page.waitForTimeout(250)
  await page.locator(target).first().click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(350)
}

await startDraft()
ok(await layer('.add-image').count() === 1, '气泡里有「+ 参考图」入口')
ok((await layer('.ref-hint').textContent()).includes('粘贴'), '提示了可以粘贴 / 拖拽')

// ── 入口 1：选文件 ──────────────────────────────────────────
page.on('filechooser', async c => {
  await c.setFiles({ name: 'target-look.png', mimeType: 'image/png', buffer: PNG })
})
await layer('.add-image').click()
await page.waitForTimeout(700)
ok(await layer('.ref').count() === 1, '选文件后出现一条参考图')
ok((await layer('.ref-name').textContent()).includes('target-look'), '显示文件名')

// ── 入口 2：粘贴 ────────────────────────────────────────────
await page.evaluate(b64 => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'pasted-shot.png', { type: 'image/png' }))
  const ta = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('textarea')
  ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
}, B64)
await page.waitForTimeout(700)
ok(await layer('.ref').count() === 2, '粘贴截图直接进参考图列表')

// ── 入口 3：拖拽 ────────────────────────────────────────────
await page.evaluate(b64 => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
  const bubble = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.bubble')
  bubble.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
}, B64)
await page.waitForTimeout(700)
ok(await layer('.ref').count() === 3, '拖入文件也能添加')

// ── 删除 ────────────────────────────────────────────────────
await layer('.ref-del').first().click()
await page.waitForTimeout(400)
ok(await layer('.ref').count() === 2, '可以逐张移除')

// ── 输入不丢（修的既有 bug）─────────────────────────────────
await layer('textarea').fill('悬停时整卡上浮，并显示这张图里的角标')
await layer('.ref-note').first().fill('目标角标样式')
// scroll / resize 会触发整块重绘，textarea 与说明都不能被冲掉
await page.evaluate(() => dispatchEvent(new Event('resize')))
await page.waitForTimeout(400)

const kept = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  return {
    text: sr.querySelector('textarea').value,
    note: sr.querySelector('.ref-note').value,
  }
})
ok(kept.text.includes('悬停时整卡上浮'),
   `重绘不会冲掉正在输入的文字：${kept.text.slice(0, 16)}…`)
ok(kept.note === '目标角标样式', `图片说明同样保住：${kept.note}`)

// ── 保存 ────────────────────────────────────────────────────
await layer('.save').click()
await page.waitForTimeout(400)

const saved = await page.evaluate(() => {
  const [c] = window.__visualRevise.store.read().comments
  return { text: c.text, images: (c.images || []).map(i => ({ name: i.name, note: i.note })) }
})
ok(saved.images.length === 2, `评论带着 2 张参考图保存：${saved.images.map(i => i.name).join(', ')}`)
ok(saved.images[0].note === '目标角标样式', '图片说明一并保存')

ok(await layer('.pin[data-has-images]').count() === 1,
   'pin 上有标记，不点开也知道里面带图')

const stats = await page.evaluate(() => window.__visualRevise.store.stats())
ok(stats.refImages === 2 && stats.comments === 1,
   `参考图单独计数、不冒充改动条目：refImages=${stats.refImages} comments=${stats.comments}`)

// ── 提示词 ──────────────────────────────────────────────────
const prompt = await page.evaluate(() => {
  const { buildPrompt } = window.__visualRevise.lib
  const state = window.__visualRevise.store.read()
  // 模拟落盘结果：真实链路里这一步由 copyPrompt 完成
  const refs = {
    exact: true, dir: '/Users/x/Downloads/visual-revise-refs/2026-01-01-000000',
    files: state.comments[0].images.map((i, n) => ({
      id: i.id, name: i.name,
      path: `/Users/x/Downloads/visual-revise-refs/2026-01-01-000000/0${n + 1}-${i.name}`,
    })),
  }
  return buildPrompt(state, {}, refs)
})
ok(prompt.includes('参考图：'), '提示词里挂出了参考图')
ok(prompt.includes('/Users/x/Downloads/visual-revise-refs/'), '写的是绝对路径而不是图本身')
ok(prompt.includes('目标角标样式'), '图片说明进了提示词，AI 才知道这张图是干嘛的')
ok(prompt.includes('## 参考图文件'), '有独立的参考图文件清单段落')
ok(prompt.includes('读图工具'), '明确要求 AI 打开图看过再动手')
ok(!prompt.includes('iVBORw0KGgo'), '提示词里没有 base64')

// 路径不确定时必须标注
const guessy = await page.evaluate(() => {
  const { buildPrompt } = window.__visualRevise.lib
  const state = window.__visualRevise.store.read()
  return buildPrompt(state, {}, {
    exact: false, dir: '~/Downloads',
    files: state.comments[0].images.map(i => ({ id: i.id, name: i.name, path: `~/Downloads/${i.name}` })),
  })
})
ok(guessy.includes('推测'),
   '拿不到确切路径时如实标注——不能让 AI 拿着不存在的路径去读图')

// ── 只有图、没有文字也算一条需求 ────────────────────────────
await startDraft('.card-title')
page.removeAllListeners('filechooser')
page.on('filechooser', async c => {
  await c.setFiles({ name: 'only-image.png', mimeType: 'image/png', buffer: PNG })
})
await layer('.add-image').click()
await page.waitForTimeout(700)
await layer('.save').click()
await page.waitForTimeout(400)

const two = await page.evaluate(() => window.__visualRevise.store.read().comments.length)
ok(two === 2, '只有参考图、没写文字的评论同样能保存（「照这张改」本身就是需求）')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
