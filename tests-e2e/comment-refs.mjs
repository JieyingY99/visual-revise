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

// contenteditable 上不能用 fill()：它会先清空，把已经插进去的 chip 一并抹掉。
// 统一走「光标移到末尾再键入」。
const caretToEnd = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const editor = sr.querySelector('.editor')
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  const sel = sr.getSelection ? sr.getSelection() : document.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  editor.focus()
})

const typeInEditor = async text => { await caretToEnd(); await page.keyboard.type(text) }

const editorState = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const editor = sr.querySelector('.editor')
  return {
    chips: [...editor.querySelectorAll('.chip')].map(c => c.dataset.id),
    names: [...editor.querySelectorAll('.chip-name')].map(c => c.textContent),
    text: editor.textContent,
    refs: [...sr.querySelectorAll('.ref')].map(r => r.dataset.id),
  }
})

const startDraft = async (target = '.curve-card') => {
  // 模式常驻之后按 c 是「切换」，已经在评论模式时会把它关掉
  await page.evaluate(() => window.__visualRevise.setMode('comment'))
  await page.waitForTimeout(250)
  await page.locator(target).first().click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(350)
}

await startDraft()
ok(await layer('.add-image').count() === 1, '输入框左下角有 + 入口')
ok((await layer('.add-image').getAttribute('title')).includes('粘贴'),
   '+ 按钮的 tooltip 说明了也能粘贴 / 拖拽')

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
  const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')
  ed.focus()
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
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
await typeInEditor('悬停时整卡上浮，并显示这张图里的角标')
await layer('.ref-note').first().fill('目标角标样式')
// scroll / resize 会重排气泡，正在输入的文字与说明都不能被冲掉
await page.evaluate(() => dispatchEvent(new Event('resize')))
await page.waitForTimeout(400)

const kept = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  return {
    text: sr.querySelector('.editor').textContent,
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
ok(prompt.includes('[图1]') && prompt.includes('[图2]'),
   '提示词里的参考图按 [图N] 编号，和需求文本里的标记对得上')
ok(prompt.includes('指的就是紧随其后列出的同号参考图'),
   '向 AI 说明了编号与句中标记的对应关系')
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


// ── 行内 chip ──────────────────────────────────────────────
// 图片不再只躺在下方列表里，而是作为一个整体插进句子。chip 是「这张图
// 在不在这条评论里」的唯一凭据，两边必须始终对得上。

await startDraft('.hero-title')
page.removeAllListeners('filechooser')
page.on('filechooser', async c => {
  await c.setFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: PNG },
    { name: 'second.png', mimeType: 'image/png', buffer: PNG },
  ])
})

await typeInEditor('这里参考 ')
await layer('.add-image').click()
await page.waitForTimeout(800)
await typeInEditor(' 的处理')

const inline = await editorState()
ok(inline.chips.length === 2, `图片以 chip 的形式插进了句子（${inline.chips.length} 个）`)
ok(inline.names.join(',') === 'first,second',
   `chip 上显示去掉扩展名的文件名：${inline.names.join(', ')}`)
ok(inline.refs.join(',') === inline.chips.join(','), 'chip 与说明区一一对应，顺序一致')
ok(inline.text.startsWith('这里参考') && inline.text.endsWith('的处理'),
   'chip 插在光标处，前后的文字都还在')

// hover 看大图：chip 上只有 16px 缩略图，认不出是哪张
await layer('.chip').first().hover()
await page.waitForTimeout(200)
const hovered = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const box = sr.querySelector('.preview')
  if (!box || box.hidden) return null
  const r = box.getBoundingClientRect()
  const wanted = sr.querySelector('.chip img')?.src
  return {
    shown: r.width > 0 && r.height > 0,
    sameImage: box.querySelector('img').src === wanted,
    inside: r.left >= 0 && r.top >= 0
      && r.right <= document.documentElement.clientWidth
      && r.bottom <= document.documentElement.clientHeight,
  }
})
ok(hovered?.shown && hovered.sameImage, 'hover chip 弹出大图预览，且是这张图')
ok(hovered?.inside, '预览没跑出视口')

// Backspace 删 chip：它是 contenteditable=false，应当整块消失而不是被逐字啃
await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const editor = sr.querySelector('.editor')
  const chip = editor.querySelectorAll('.chip')[1]
  const range = document.createRange()
  range.setStartAfter(chip)
  range.collapse(true)
  const sel = sr.getSelection ? sr.getSelection() : document.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  editor.focus()
})
await page.keyboard.press('Backspace')
await page.waitForTimeout(300)

const afterDel = await editorState()
ok(afterDel.chips.length === 1, `Backspace 一次删掉整个 chip（剩 ${afterDel.chips.length} 个）`)
ok(afterDel.refs.length === 1, '说明区跟着少一条——两边不会各说各话')
ok(!afterDel.names.includes('second'), '删掉的是光标前那一个')

// 反向：说明区点 × ，句子里的 chip 也要消失，不能留一个指向空气的 chip
await layer('.ref-del').first().click()
await page.waitForTimeout(300)
const afterRefDel = await editorState()
ok(afterRefDel.chips.length === 0 && afterRefDel.refs.length === 0,
   '说明区删图，句子里的 chip 同步消失')

// ── 保存 / 还原 ────────────────────────────────────────────
page.removeAllListeners('filechooser')
page.on('filechooser', async c => {
  await c.setFiles({ name: 'kept.png', mimeType: 'image/png', buffer: PNG })
})
await caretToEnd()
await layer('.add-image').click()
await page.waitForTimeout(800)
await layer('.save').click()
await page.waitForTimeout(400)

const savedInline = await page.evaluate(() => {
  const c = window.__visualRevise.store.read().comments.at(-1)
  return { text: c.text, count: (c.images || []).length }
})
ok(savedInline.text.includes('[图1]'),
   `chip 存成序号标记，位置留在句子里：${savedInline.text}`)
ok(savedInline.count === 1, '对应的图片本体也存下来了')

// 重新打开这条评论，标记要还原成 chip，不能变成一串字面量
await layer('.pin').last().click()
await page.waitForTimeout(400)
const reopened = await editorState()
ok(reopened.chips.length === 1, '重新编辑时标记还原成 chip')
ok(!reopened.text.includes('[图1]'), '编辑器里看不到裸的 [图1] 字面量')

// ── 五张以上滚动 ───────────────────────────────────────────
page.removeAllListeners('filechooser')
page.on('filechooser', async c => {
  await c.setFiles([1, 2, 3, 4, 5, 6].map(n => (
    { name: `bulk-${n}.png`, mimeType: 'image/png', buffer: PNG }
  )))
})
await caretToEnd()
await layer('.add-image').click()
await page.waitForTimeout(1200)

const scroller = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const refs = sr.querySelector('.refs')
  const bubble = sr.querySelector('.bubble').getBoundingClientRect()
  return {
    count: sr.querySelectorAll('.ref').length,
    scrollable: refs.scrollHeight > refs.clientHeight + 1,
    bubbleBottom: bubble.bottom,
    vh: document.documentElement.clientHeight,
  }
})
ok(scroller.count === 7, `一次可以加多张（现在 ${scroller.count} 条）`)
ok(scroller.scrollable, '超过五张后说明区自己滚动，而不是把气泡撑长')
ok(scroller.bubbleBottom <= scroller.vh - 7,
   `气泡整体仍在视口内（bottom=${Math.round(scroller.bubbleBottom)} ≤ vh=${scroller.vh}）`)

// ── 说明区行布局 ───────────────────────────────────────────
const rowLayout = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const ref = sr.querySelector('.ref')
  const box = s => ref.querySelector(s).getBoundingClientRect()
  const head = box('.ref-head'), name = box('.ref-name')
  const size = box('.ref-size'), del = box('.ref-del'), note = box('.ref-note')
  return {
    sameRow: Math.abs(name.top - size.top) < 12 && Math.abs(name.top - del.top) < 12,
    noteBelow: note.top >= head.bottom - 1,
    noteFull: note.width >= head.width - 1,
  }
})
ok(rowLayout.sameRow, '文件名、尺寸、× 在同一行')
ok(rowLayout.noteBelow && rowLayout.noteFull, '说明框在下面一行，且占满整宽')

await page.keyboard.press('Escape')
await page.waitForTimeout(200)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
