import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[评论标注测试]\n')
await page.goto(origin)
await injectVisBug(page, origin)

ok(await page.locator('visual-revise-comment-layer').count() === 1, '评论层已挂载')

// C 进入评论模式
await page.keyboard.press('c')
await page.waitForTimeout(300)
ok(await page.evaluate(() => window.__visualRevise.comments.active), 'C 键进入评论模式')
// 常驻提示条已移除（与工具条重叠），改由工具条高亮表明当前模式
const activeMode = await page.evaluate(() => window.__visualRevise.toolbar.mode)
ok(activeMode === 'comment', `工具条高亮当前模式：${activeMode}`)

// 点击元素起草评论
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-comment-layer .bubble').count() === 1, '点击元素弹出评论输入框')
ok(await page.evaluate(() => window.__visualRevise.comments.active),
   '点击元素后仍留在评论模式——模式是用户选的，不该被一次点击切走')

// 点击不应该选中元素
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0,
   '评论模式下点击不选中元素')

// 输入并保存
await page.locator('visual-revise-comment-layer .editor').fill('鼠标移入时增加悬浮效果，并让卡片变亮')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(300)

const stats = await page.evaluate(() => window.__visualRevise.store.stats())
ok(stats.comments === 1, `评论已保存（${stats.comments} 条）`)
ok(await page.locator('visual-revise-comment-layer .pin').count() === 1, '页面显示评论标记 pin')
ok((await page.locator('visual-revise-comment-layer .pin').textContent()) === '1', 'pin 显示编号 1')

// 连续标注：不需要按住 Shift，模式一直在
await page.locator('.hero-title').click()
await page.waitForTimeout(300)
ok(await page.evaluate(() => window.__visualRevise.comments.active),
   '连着标注第二个元素，模式仍然保持')
await page.locator('visual-revise-comment-layer .editor').fill('标题字号再大一点，字重加粗')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-comment-layer .pin').count() === 2, '第二条评论 pin 出现')

// 点击 pin 编辑
await page.locator('visual-revise-comment-layer .pin').first().click()
await page.waitForTimeout(300)
const draftText = await page.locator('visual-revise-comment-layer .editor').textContent()
ok(draftText.includes('悬浮效果'), '点击 pin 可编辑原评论')
await page.locator('visual-revise-comment-layer .editor').fill('鼠标移入时上浮 4px 并加阴影')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(300)
const updated = await page.evaluate(() => window.__visualRevise.store.read().comments[0].text)
ok(updated.includes('上浮 4px'), `评论已更新：${updated}`)

// Esc 退出模式
await page.keyboard.press('c')
await page.waitForTimeout(200)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
ok(!(await page.evaluate(() => window.__visualRevise.comments.active)), 'Esc 退出评论模式')

// ── 回归：页面输入控件里打字不得被单字母快捷键吞掉 ──
await page.evaluate(() => {
  const input = document.createElement('input')
  input.id = 'vr-typing-probe'
  input.type = 'text'
  document.querySelector('.hero').appendChild(input)

  const editable = document.createElement('div')
  editable.id = 'vr-editable-probe'
  editable.contentEditable = 'true'
  document.querySelector('.hero').appendChild(editable)
})

const probe = page.locator('#vr-typing-probe')
await probe.click()
await probe.type('correct', { delay: 30 })
await page.waitForTimeout(300)

const typed = await page.evaluate(() => ({
  value: document.querySelector('#vr-typing-probe').value,
  comment: window.__visualRevise.comments.active,
  dragging: window.__visualRevise.layoutDrag.dragging,
}))
ok(typed.value === 'correct', `输入框内容完整：「${typed.value}」`)
ok(!typed.comment && !typed.dragging,
   `输入过程中未误触模式、也没起拖（评论=${typed.comment}, 拖拽中=${typed.dragging}）`)

// contenteditable 同样要让路
const editable = page.locator('#vr-editable-probe')
await editable.click()
await editable.type('rc', { delay: 30 })
await page.waitForTimeout(300)
const ce = await page.evaluate(() => ({
  text: document.querySelector('#vr-editable-probe').textContent,
  comment: window.__visualRevise.comments.active,
  dragging: window.__visualRevise.layoutDrag.dragging,
}))
ok(ce.text === 'rc' && !ce.comment && !ce.dragging,
   `contenteditable 内输入正常：「${ce.text}」，未误触模式`)

// 焦点离开输入控件后，快捷键恢复正常
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('c')
await page.waitForTimeout(200)
ok(await page.evaluate(() => window.__visualRevise.comments.active),
   '离开输入控件后 C 仍能正常切换评论模式')
await page.keyboard.press('Escape')
await page.evaluate(() => {
  document.querySelector('#vr-typing-probe')?.remove()
  document.querySelector('#vr-editable-probe')?.remove()
})

// 评论进入提示词
const prompt = await page.evaluate(async (base) => {
  const { buildPrompt } = await import(`${base}/__app/core/prompt-export.js`)
  return buildPrompt(window.__visualRevise.store.read(), { url: 'x', viewport: '1440 × 900' })
}, origin)
ok(prompt.includes('## 交互备注'), '提示词含交互备注段落')
ok(prompt.includes('上浮 4px') && prompt.includes('字重加粗'), '两条评论都进入提示词')
ok(prompt.includes('CSS 无法表达的行为需求'), '提示词向 AI 说明了备注的性质')


// ── 边界检测 ────────────────────────────────────────────────
// 气泡宽 288px，此前只按「锚点 + 12」定位，贴着视口右缘的元素会把它整个
// 推出屏幕；pin 同理。跑到屏幕外的气泡既看不见也点不到。

const boxOf = sel => page.evaluate(s => {
  const root = document.querySelector('visual-revise-comment-layer')?.shadowRoot
  const el = s === ':last-pin'
    ? [...root.querySelectorAll('.pin')].pop()
    : root?.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    vw: document.documentElement.clientWidth,
    vh: document.documentElement.clientHeight,
  }
}, sel)

// 不能只判「在视口内」：溢出到视口下方时，focus() 会把整页往下拽，
// 气泡因此又「回到」视口里，宽松的断言会被这个副作用蒙混过去。
// 所以按夹取后应有的 8px 留白判，半像素容差留给小数布局值。
const EDGE = 8
const inside = b => !!b && b.left >= EDGE - 0.5 && b.top >= EDGE - 0.5
  && b.right <= b.vw - EDGE + 0.5 && b.bottom <= b.vh - EDGE + 0.5

const edgeProbe = (id, css) => page.evaluate(([id, css]) => {
  const d = document.createElement('div')
  d.id = id
  d.style.cssText = `position:fixed;width:120px;height:40px;background:#eee;${css}`
  document.body.appendChild(d)
}, [id, css])

const draftOn = async id => {
  // 直接设值而不按 c：要的是「确保处于评论模式」这个前置条件，
  // 不该顺带把快捷键的行为也测进来
  await page.evaluate(() => window.__visualRevise.setMode('comment'))
  await page.waitForTimeout(150)
  await page.locator(`#${id}`).click()
  await page.waitForTimeout(250)
}

// 右缘：应当翻到锚点左侧
await edgeProbe('vr-edge-r', 'top:300px;right:0')
await draftOn('vr-edge-r')
const atRight = await boxOf('.bubble')
ok(inside(atRight),
   `贴右缘的元素：气泡仍在视口内（right=${Math.round(atRight.right)} ≤ vw=${atRight.vw}）`)
ok(atRight.right < atRight.vw - 50, '气泡翻到了锚点左侧，而不是硬贴右缘')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// 下缘：只夹不翻，纵向仍要留在视口里
await edgeProbe('vr-edge-b', 'bottom:0;left:60px')
await draftOn('vr-edge-b')
const atBottom = await boxOf('.bubble')
ok(inside(atBottom),
   `贴下缘的元素：气泡未被推到视口下方（bottom=${Math.round(atBottom.bottom)} ≤ vh=${atBottom.vh}）`)
// 气泡若溢出到视口外，focus() 会把整页拽下去——页面在用户脚下自己跑了
ok(await page.evaluate(() => scrollY) === 0, '气泡没有把页面拽着滚动')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// 右下角：两个方向同时越界
await edgeProbe('vr-edge-rb', 'bottom:0;right:0')
await draftOn('vr-edge-rb')
ok(inside(await boxOf('.bubble')), '右下角的元素：两个方向同时被约束住')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// pin 同样要夹住——它飞出视口，这条评论就再也点不开了
await draftOn('vr-edge-r')
await page.locator('visual-revise-comment-layer .editor').fill('边界检测')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(250)
const pinAtRight = await boxOf(':last-pin')
ok(inside(pinAtRight),
   `贴右缘元素的 pin 完整可见（right=${Math.round(pinAtRight.right)} ≤ vw=${pinAtRight.vw}）`)

// 但元素整个移出视口时不该夹：那样只会在边上堆一排认不出主人的编号
await page.evaluate(() => {
  const el = document.querySelector('#vr-edge-r')
  el.style.right = 'auto'
  el.style.left = `${document.documentElement.clientWidth + 600}px`
  dispatchEvent(new Event('resize'))
})
await page.waitForTimeout(250)
const pinGone = await boxOf(':last-pin')
ok(pinGone.left > pinGone.vw,
   `元素移出视口后 pin 跟着离场，没被夹回边缘（left=${Math.round(pinGone.left)} > vw=${pinGone.vw}）`)

await page.evaluate(() => {
  for (const id of ['vr-edge-r', 'vr-edge-b', 'vr-edge-rb'])
    document.querySelector(`#${id}`)?.remove()
})

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
