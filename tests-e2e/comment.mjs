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

// 点击要把选中挪到被评论的元素上。
// 旧断言是「评论模式下点击不选中元素」——那是「评论模式一进来就清选中」时代的
// 期望。现在选中框是「我正在说这一个」的视觉凭据，必须跟着正在评论的元素走，
// 所以这条按新行为更新：选中恰好一个，且就是刚点的那张卡。
const selAfterClick = await page.evaluate(() => {
  const sel = [...document.querySelectorAll('[data-selected]')]
  return { n: sel.length, isCard2: sel[0] === document.querySelectorAll('.curve-card')[1] }
})
ok(selAfterClick.n === 1 && selAfterClick.isCard2,
   `评论模式下点击把选中挪到被评论的元素上（选中 ${selAfterClick.n} 个，是第 2 张卡：${selAfterClick.isCard2}）`)

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

// ══ 先选中、再评论 ════════════════════════════════════════════
// 「在 comment 模式下选择元素非常困难」：嵌套容器、hover 覆盖层、pin 全在抢
// 那几个像素。所以把顺序反过来——在选择模式里挑准元素，按 C 时编辑框直接开在
// 它身上；选中框一路跟着正在评论的元素，切回选择模式时面板对着的还是它。

// 焦点可能停在评论层 / 工具条的 shadow 里，那里的 keydown 被组件吞掉，
// 不逐层下钻 blur 的话下面所有快捷键都按不动
const blurAll = () => page.evaluate(() => {
  let a = document.activeElement
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
  a?.blur?.()
})

const cards = n => page.locator('.curve-card').nth(n)
const selInfo = () => page.evaluate(() => {
  const cs = document.querySelectorAll('.curve-card')
  const sel = [...document.querySelectorAll('[data-selected]')]
  const panel = document.querySelector('visual-revise-panel')
  return {
    mode: window.__visualRevise.mode,
    count: sel.length,
    index: sel[0] ? [...cs].indexOf(sel[0]) : -1,
    handles: document.querySelectorAll('visbug-handles').length,
    panelHidden: panel.hidden,
    panelTargetIndex: panel.target ? [...cs].indexOf(panel.target) : -1,
    bubbles: document.querySelector('visual-revise-comment-layer')
      .shadowRoot.querySelectorAll('.bubble').length,
  }
})
// 草稿挂在谁身上，只有存下来才看得到：评论气泡顶部那行 tag.class 三张卡是一样的
const lastCommentIndex = () => page.evaluate(() => {
  const last = window.__visualRevise.store.read().comments.at(-1)
  return last ? [...document.querySelectorAll('.curve-card')].indexOf(last.el) : -1
})

// 前置：回到选择模式、清掉草稿与选中
await page.evaluate(() => {
  window.__visualRevise.comments.cancelDraft?.()
  window.__visualRevise.setMode('select')
})
await blurAll()
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
ok((await selInfo()).count === 0, '（前置）回到选择模式，没有任何选中')

// ① 选中第 2 张卡 → 按 C
await cards(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(400)
const picked = await selInfo()
ok(picked.index === 1 && !picked.panelHidden,
   `（前置）选择模式下选中第 2 张卡、属性面板打开（index=${picked.index}）`)

await blurAll()
await page.keyboard.press('c')
await page.waitForTimeout(450)
const onC = await selInfo()
ok(onC.mode === 'comment', 'C 切到评论模式')
ok(onC.count === 1 && onC.index === 1,
   `切评论模式后选中原样保留，仍是第 2 张卡（选中 ${onC.count} 个，index=${onC.index}）`)
ok(onC.handles === 1, `选中框还在（visbug-handles ${onC.handles} 个）`)
ok(onC.panelHidden, '属性面板收起——此刻在写需求，不是在调样式')
ok(onC.bubbles === 1, '编辑框直接弹在选中的元素上，不必在评论模式里再点一次')

await page.locator('visual-revise-comment-layer .editor').fill('这张卡的圆角再大一点')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(400)
ok(await lastCommentIndex() === 1, '这条草稿确实挂在第 2 张卡上')

// ② 没有选中时切评论模式：不该凭空弹一个编辑框
await blurAll()
await page.keyboard.press('a')
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const cleared = await selInfo()
ok(cleared.mode === 'select' && cleared.count === 0, '（前置）回选择模式并取消选中')

await page.keyboard.press('c')
await page.waitForTimeout(400)
const noSel = await selInfo()
ok(noSel.mode === 'comment' && noSel.bubbles === 0,
   `没有选中时切评论模式：不弹编辑框（气泡 ${noSel.bubbles} 个）`)

// ③ 评论模式下点第 3 张卡：草稿与选中一起挪过去，面板仍收着
await cards(2).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(450)
const onThird = await selInfo()
ok(onThird.bubbles === 1, '点第 3 张卡在它身上起草')
ok(onThird.count === 1 && onThird.index === 2,
   `选中跟着挪到第 3 张卡（选中 ${onThird.count} 个，index=${onThird.index}）`)
ok(onThird.panelHidden, '评论模式下选中换了元素，属性面板仍然收着')

await page.locator('visual-revise-comment-layer .editor').fill('这张卡的标题再大一号')
await page.locator('visual-revise-comment-layer .save').click()
await page.waitForTimeout(400)
ok(await lastCommentIndex() === 2, '草稿换到了第 3 张卡')

// ④ 切回选择模式：选中原样留着，面板对着它重新展开
await blurAll()
await page.locator('visual-revise-toolbar').locator('button[data-mode="select"]').click()
await page.waitForTimeout(450)
const back = await selInfo()
ok(back.mode === 'select', '点工具条切回选择模式')
ok(back.count === 1 && back.index === 2,
   `选中仍是第 3 张卡（选中 ${back.count} 个，index=${back.index}）`)
ok(!back.panelHidden && back.panelTargetIndex === 2,
   `属性面板重新展开且对着第 3 张卡（target index=${back.panelTargetIndex}）`)

// ⑤ 浏览模式绕一圈回来，同样在选中的元素上起草
// 「选中一个元素 → V 让开页面、亲眼看看它的真实交互 → C 把要求写下来」是这套
// 工具最顺的一条路。浏览模式为了把页面完全让开会清掉选中（退出时再原样装回），
// 所以这条路径必须单独钉住：装回来的选中同样算数，C 一样直接开编辑框——
// 否则用户又被推回「在评论模式里重新点中那个元素」这一步。
await blurAll()
await page.keyboard.press('v')
await page.waitForTimeout(400)
const browsing = await selInfo()
ok(browsing.mode === 'browse' && browsing.count === 0,
   `（前置）V 让开页面，选中暂时收起（选中 ${browsing.count} 个）`)

await page.keyboard.press('c')
await page.waitForTimeout(450)
const backFromBrowse = await selInfo()
ok(backFromBrowse.mode === 'comment' && backFromBrowse.count === 1 && backFromBrowse.index === 2,
   `浏览模式退出后选中被装回，仍是第 3 张卡（选中 ${backFromBrowse.count} 个，index=${backFromBrowse.index}）`)
ok(backFromBrowse.bubbles === 1, '装回来的选中同样算数：C 直接在它身上开编辑框')

// ⑥ 编辑框开着时，焦点在编辑框里——这是自动起草的代价，写清楚
// 编辑框一开就自动聚焦（不然「按 C 直接开始打字」这件事不成立），于是此后的
// 单字母键都是在往需求里打字，不再是模式键。退出得先按 Esc 收掉草稿，第二下
// 才退出评论模式。这条不是缺陷而是取舍，钉在这里免得日后被人当 bug「修掉」。
const focusPath = await page.evaluate(() => {
  let a = document.activeElement, path = [a?.tagName]
  while (a?.shadowRoot?.activeElement) { a = a.shadowRoot.activeElement; path.push(a.tagName) }
  return path.join(' > ')
})
ok(focusPath.endsWith('DIV'), `编辑框自动拿到焦点，可以直接打字（${focusPath}）`)

await page.keyboard.press('a')
await page.waitForTimeout(300)
const typedIn = await page.evaluate(() => ({
  mode: window.__visualRevise.mode,
  text: document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')?.textContent,
}))
ok(typedIn.mode === 'comment' && typedIn.text === 'a',
   `草稿开着时 A 是在写需求、不是切模式（打进去的是「${typedIn.text}」）`)

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const esc1 = await selInfo()
ok(esc1.mode === 'comment' && esc1.bubbles === 0, 'Esc 第一下收掉草稿，模式不动')

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok((await selInfo()).mode === 'select', 'Esc 第二下才退出评论模式')

// ⑦ 一个字没写就离开评论模式：空编辑框不许留在页面上
// 自动起草让「凭空多出一个空编辑框」变成常态——用户按了下 C 又改了主意就会遇上。
// 气泡自己吃指针事件，留在选择模式的页面上会把它盖住的那块区域点不动，而用户
// 已经不在评论模式里，根本想不到挡路的是一个自己没写过一个字的输入框。
const bar = sel => page.locator('visual-revise-toolbar').locator(sel)

await blurAll()
await page.keyboard.press('c')
await page.waitForTimeout(450)
ok((await selInfo()).bubbles === 1, '（前置）切评论模式，编辑框开在选中的元素上')
await bar('button[data-mode="select"]').click()
await page.waitForTimeout(400)
const afterLeave = await selInfo()
ok(afterLeave.mode === 'select' && afterLeave.bubbles === 0,
   `一个字没写就切回选择模式：空编辑框跟着收掉，不留在页面上挡点击（气泡 ${afterLeave.bubbles} 个）`)

// 反过来：写了一半的草稿不能被这条规则误伤——静默丢掉用户打的字是最糟的处理
await bar('button[data-mode="comment"]').click()
await page.waitForTimeout(450)
await page.locator('visual-revise-comment-layer .editor').fill('写了一半，还没想好后半句')
await page.waitForTimeout(200)
await bar('button[data-mode="select"]').click()
await page.waitForTimeout(400)
const halfWritten = await page.evaluate(() => ({
  mode: window.__visualRevise.mode,
  bubbles: document.querySelector('visual-revise-comment-layer').shadowRoot.querySelectorAll('.bubble').length,
  text: document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')?.textContent,
}))
ok(halfWritten.mode === 'select' && halfWritten.bubbles === 1
   && halfWritten.text === '写了一半，还没想好后半句',
   `写了一半的草稿照旧留在屏幕上等他写完（「${halfWritten.text}」）`)
await page.evaluate(() => window.__visualRevise.comments.cancelDraft())

// ⑧ 评论模式下从改动列表定位元素：选中跟着走，属性面板仍然收着
// 进入选中的路径不止「在页面上点一下」这一条。改动列表的定位是另一条：它自己
// 也会 select() 一个元素。面板可见性只认 onSelected 一个出口，这条路径才不会
// 在用户正写需求的时候把属性面板顶出来挡住页面和气泡。
await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[0]
  window.__visualRevise.store.track(el)
  window.__visualRevise.store.applyProp(el, 'border-radius', '20px')
})
await page.waitForTimeout(300)
await page.evaluate(() => {
  const l = document.querySelector('visual-revise-list')
  l.hidden = false
  l.render()
})
await page.waitForTimeout(300)
const styleItem = page.locator('visual-revise-list .item').filter({ hasText: 'border-radius' }).first()
ok(await styleItem.count() === 1, '（前置）改动列表里有一条样式改动')

await bar('button[data-mode="comment"]').click()
await page.waitForTimeout(450)
await styleItem.click()
await page.waitForTimeout(400)
const located = await selInfo()
ok(located.mode === 'comment' && located.count === 1 && located.index === 0,
   `评论模式下点改动条目，选中跟着挪到那个元素（index=${located.index}）`)
ok(located.panelHidden,
   '从改动列表定位也不会把属性面板顶出来——面板可见性只认 onSelected 一个出口')

// 切回选择模式，同一条定位路径照旧要把面板打开
await page.evaluate(() => window.__visualRevise.comments.cancelDraft())
await bar('button[data-mode="select"]').click()
await page.waitForTimeout(400)
await styleItem.click()
await page.waitForTimeout(400)
const locatedSel = await selInfo()
ok(!locatedSel.panelHidden && locatedSel.panelTargetIndex === 0,
   `选择模式下同一条路径仍然打开面板并对着它（target index=${locatedSel.panelTargetIndex}）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
