import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[工具条测试] 模式互斥 / 状态双向同步 / 计数\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(500)

const bar = sel => page.locator(`visual-revise-toolbar ${sel}`)
const mode = () => page.evaluate(() => window.__visualRevise.mode)
const litMode = () => page.evaluate(() => {
  const btns = window.__visualRevise.toolbar.shadowRoot.querySelectorAll('button[data-mode]')
  return Array.from(btns).filter(b => b.hasAttribute('data-on')).map(b => b.dataset.mode)
})

ok(await page.locator('visual-revise-toolbar').count() === 1, '工具条已挂载')
// 重排已并进属性面板的「结构」tab，不再是一个模式
ok(await bar('button[data-mode]').count() === 3, '三个模式按钮（浏览 / 选择 / 评论）')
ok(await bar('.sep').count() === 4, '分组竖线（撤销 / 重做自成一组）')

// 初始态
ok(await mode() === 'select', '初始为选择模式')
ok((await litMode()).join() === 'select', '选择模式按钮高亮')

// 点击切换模式
await bar('button[data-mode="comment"]').click()
await page.waitForTimeout(300)
ok(await mode() === 'comment', '点击切到评论模式')
ok((await litMode()).join() === 'comment', `高亮跟随且互斥（亮着的：${await litMode()}）`)
ok(await page.evaluate(() => window.__visualRevise.comments.active), '评论层已激活')
ok(!(await page.evaluate(() => window.__visualRevise.layoutDrag.active)), '重排同时被关闭')

await bar('button[data-mode="select"]').click()
await page.waitForTimeout(300)
ok(await mode() === 'select' && (await litMode()).join() === 'select', '切回选择模式，评论自动退出')
ok(!(await page.evaluate(() => window.__visualRevise.comments.active)), '评论层已关闭')

// 快捷键与工具条双向同步
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('c')
await page.waitForTimeout(300)
ok(await mode() === 'comment' && (await litMode()).join() === 'comment',
   '快捷键 C 切换，工具条高亮同步跟随')

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok(await mode() === 'select' && (await litMode()).join() === 'select', 'Esc 回到选择模式')

// 选中元素：面板出现，模式保持 select
await bar('button[data-mode="select"]').click()
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(500)
ok(!(await page.locator('visual-revise-panel').evaluate(el => el.hidden)), '选中后属性面板出现')

// 切到评论模式：面板收起，但选中要留着。
// 旧断言是「同时取消选中」——那时评论模式一进来就清选中，于是用户得在评论模式里
// 把刚挑好的元素重新点一次，而那正是最难点的一步。现在选中框留在原地，编辑框直接
// 开在它身上，所以这条按新行为更新。
await bar('button[data-mode="comment"]').click()
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-panel').evaluate(el => el.hidden), '切到评论模式后面板收起')
ok(await page.evaluate(() =>
  document.querySelectorAll('[data-selected]')[0] === document.querySelectorAll('.curve-card')[1]),
  '选中原样保留——评论要落在刚选好的那个元素上')

// 计数与复制按钮状态
await bar('button[data-mode="select"]').click()
// 这张卡此刻仍是选中态，(130, 8) 正好压在顶边中间那个缩放圆点的点击区上
// （圆点半径 4px，::before 又向外撑了 8px），点它是在拖尺寸而不是选元素。
// 挪到 (30, 8)：同样在卡片自己的 padding 里，但避开了左上与顶中两个圆点。
await page.locator('.curve-card').nth(1).click({ position: { x: 30, y: 8 } })
await page.waitForTimeout(400)

ok((await bar('.count').textContent()).trim() === '0', '初始记录数为 0')
ok(await bar('.copy').evaluate(el => !el.hasAttribute('data-ready')), '无改动时复制按钮压暗')

await page.evaluate(() => {
  const s = window.__visualRevise.store
  const el = document.querySelectorAll('.curve-card')[1]
  s.track(el); s.applyProp(el, 'border-radius', '12px'); s.applyProp(el, 'padding-top', '24px')
})
await page.waitForTimeout(400)
ok((await bar('.count').textContent()).trim() === '2', `记录计数同步：${(await bar('.count').textContent()).trim()}`)
ok(await bar('.copy').evaluate(el => el.hasAttribute('data-ready')), '有改动后复制按钮点亮')

// 复制走工具条
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
await bar('.copy').click()
await page.waitForTimeout(600)
const clip = await page.evaluate(() => navigator.clipboard.readText())
ok(clip.includes('border-radius'), '工具条复制提示词生效')
// toast 挂在 body 而非工具条 shadow 内：:host 的 transform 会创建包含块，
// 放在里面的 fixed 定位会相对工具条而不是视口
const toastState = await page.evaluate(() => {
  const el = document.getElementById('visual-revise-toast')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { opacity: el.style.opacity, bottomGap: Math.round(innerHeight - r.bottom), text: el.textContent }
})
ok(toastState?.opacity === '1', `复制后显示反馈 toast：${toastState?.text}`)
ok(toastState && toastState.bottomGap < 60 && toastState.bottomGap > 0,
   `toast 贴在视口底部而非工具条附近（距底 ${toastState?.bottomGap}px）`)

// 记录按钮开合列表
await bar('.list').click()
await page.waitForTimeout(400)
ok(!(await page.locator('visual-revise-list').evaluate(el => el.hidden)), '记录按钮打开改动列表')

// Tab 交互态：工具条一并隐藏
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
ok(await page.locator('visual-revise-toolbar').evaluate(el => el.hidden), '交互态下工具条隐藏')
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
ok(!(await page.locator('visual-revise-toolbar').evaluate(el => el.hidden)), '退出交互态后工具条恢复')

// 图标是 SVG 而非 emoji
const iconCheck = await page.evaluate(() => {
  const sr = window.__visualRevise.toolbar.shadowRoot
  return {
    svgCount: sr.querySelectorAll('svg').length,
    hasEmoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sr.textContent),
  }
})
ok(iconCheck.svgCount === 9, `全部图标为内联 SVG（${iconCheck.svgCount} 个，含撤销 / 重做）`)
ok(!iconCheck.hasEmoji, '界面文本中不含 emoji')

// ── 纯图标 + hover 气泡 ─────────────────────────────────────
// 标签藏起来之后，功能名只剩气泡承载，所以气泡必须真的出得来、
// 且每个功能都带着自己的快捷键，否则新用户无从知道哪个按钮是哪个。

const barSR = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  return [...sr.querySelectorAll('.bar button')].map(b => b.textContent.trim())
})
// 三个模式与撤销 / 重做只留图标；记录与复制提示词是出口，保留文字
ok((await barSR()).filter(t => t !== '' && !/^记录\s*\d+$/.test(t)
      && t !== '复制提示词').length === 0,
   `除出口两个外只剩图标：${JSON.stringify(await barSR())}`)

const order = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  return [...sr.querySelectorAll('.bar button')].map(b =>
    b.dataset.mode || b.className.split(' ')[0])
})
ok(order.join(',') === 'layout,browse,select,comment,undo,redo,list,copy,close',
   `第一格是布局方向，撤销 / 重做排在出口那组前面：${order.join(' · ')}`)

const tipOf = async sel => {
  await page.locator(`visual-revise-toolbar ${sel}`).hover()
  await page.waitForTimeout(180)
  return page.evaluate(() => {
    const sr = document.querySelector('visual-revise-toolbar').shadowRoot
    const box = sr.querySelector('.tip')
    if (!box || box.hidden) return null
    const r = box.getBoundingClientRect()
    return {
      label: box.querySelector('.tip-label').textContent,
      key: box.querySelector('.tip-key').textContent,
      inside: r.left >= 0 && r.right <= document.documentElement.clientWidth,
    }
  })
}

for (const [sel, label, key] of [
  ['[data-mode="browse"]',  '浏览页面', 'V'],
  ['[data-mode="select"]',  '选择元素', 'A / F'],
  ['[data-mode="comment"]', '评论',     'C'],
  ['.list',                 '改动记录', 'L'],
  ['.copy',                 '复制提示词', 'P'],
  ['.close',                '关闭编辑器', '⌥⇧D'],
]) {
  const tip = await tipOf(sel)
  ok(tip?.label === label && tip.key === key,
     `${sel} 的气泡：${tip?.label} ${tip?.key}`)
}
ok((await tipOf('.close'))?.inside, '贴边的按钮，气泡也被夹在视口内')

// ── 模式分段控件 ────────────────────────────────────────────
// 四个模式是互斥单选，所以长成 segmented control：一条凹进去的轨道，
// 当前项是一块滑块。滑块是独立元素、靠 transform 位移，切换时看得出是
// 「同一块东西移过去了」，而不是「这块灭、那块亮」。
const segShape = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const on = sr.querySelector('.segment button[data-on]')
  return {
    hasTrack: !!sr.querySelector('.segment'),
    hasThumb: !!sr.querySelector('.segment .thumb'),
    buttons:  sr.querySelectorAll('.segment button[data-mode]').length,
    // 选中底色该由滑块提供，按钮自己不能再涂一层，否则两块底叠在一起
    onBtnBg:  on ? getComputedStyle(on).backgroundColor : null,
    // 纯图标，不带文字
    onBtnText: on ? on.textContent.trim() : null,
  }
})
ok(segShape.hasTrack && segShape.hasThumb && segShape.buttons === 3,
   `三个模式在一条轨道里，且有滑块（buttons=${segShape.buttons}）`)
ok(/rgba\(0, 0, 0, 0\)|transparent/.test(segShape.onBtnBg),
   `选中按钮自身不涂底色，交给滑块（实得 ${segShape.onBtnBg}）`)
ok(segShape.onBtnText === '', '分段按钮是纯图标，没有文字')

// 滑块必须停在当前选中项上。这条同时验证了定位算法——
// 落点是按钮的实际布局位置算出来的，不是写死的按钮宽度，
// 图标尺寸或轨道内边距一改也不会错位。
const thumbVsButton = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const t = sr.querySelector('.segment .thumb').getBoundingClientRect()
  const b = sr.querySelector('.segment button[data-on]').getBoundingClientRect()
  return { dx: Math.round(t.left - b.left), tw: Math.round(t.width), bw: Math.round(b.width) }
})

for (const m of ['browse', 'comment', 'select']) {
  await page.evaluate(mode => window.__visualRevise.setMode(mode), m)
  await page.waitForTimeout(400)          // 等滑动动画走完
  const at = await thumbVsButton()
  ok(Math.abs(at.dx) <= 1 && Math.abs(at.tw - at.bw) <= 1,
     `切到 ${m} 后滑块贴合选中项（偏移 ${at.dx}px，宽度 ${at.tw}/${at.bw}）`)
}
await page.evaluate(() => window.__visualRevise.setMode('select'))
await page.waitForTimeout(300)

// ── 布局方向 ────────────────────────────────────────────────
// 竖条贴左边，把顶部让给页面内容。第一格从品牌标记换成了方向切换按钮。
const barBox = () => page.locator('visual-revise-toolbar').boundingBox()
const isVertical = () => page.locator('visual-revise-toolbar')
  .evaluate(el => el.hasAttribute('vertical'))

const wide = await barBox()
await page.locator('visual-revise-toolbar .layout').click()
await page.waitForTimeout(500)
ok(await isVertical(), '点第一格切到纵向')

const tall = await barBox()
ok(tall.height > tall.width && tall.width < wide.width,
   `工具条变成竖条（${Math.round(wide.width)}×${Math.round(wide.height)} → ${Math.round(tall.width)}×${Math.round(tall.height)}）`)

// 滑块的落点在纵向要走 offsetTop / translateY，横向那套算出来会全压在第一格上
const thumbV = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const t = sr.querySelector('.segment .thumb').getBoundingClientRect()
  const b = sr.querySelector('.segment button[data-on]').getBoundingClientRect()
  return { dy: Math.round(t.top - b.top), dx: Math.round(t.left - b.left) }
})
ok(Math.abs(thumbV.dy) <= 1 && Math.abs(thumbV.dx) <= 1,
   `纵向时滑块仍贴合选中项（偏移 ${thumbV.dx},${thumbV.dy}）`)

// A 方案：竖排不留文字，靠 hover 气泡认按钮
const labelHidden = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  return getComputedStyle(sr.querySelector('.copy .label')).display === 'none'
})
ok(labelHidden, '竖排收起按钮文字——留着会宽到挡住页面')

// 气泡也得跟着换边：竖排时按钮下方是另一个按钮，气泡压上去就看不清了
await page.locator('visual-revise-toolbar .copy').hover()
await page.waitForTimeout(350)
const tipSide = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-toolbar').shadowRoot
  const tip = sr.querySelector('.tip').getBoundingClientRect()
  const btn = sr.querySelector('.copy').getBoundingClientRect()
  return { tipLeft: Math.round(tip.left), btnRight: Math.round(btn.right),
           overlapY: tip.top < btn.bottom && tip.bottom > btn.top }
})
ok(tipSide.tipLeft >= tipSide.btnRight && tipSide.overlapY,
   `气泡挪到按钮右侧并与它齐平（tip.left=${tipSide.tipLeft} ≥ btn.right=${tipSide.btnRight}）`)

ok(await page.evaluate(() => localStorage.getItem('visual-revise:orientation')) === 'vertical',
   '方向记进 localStorage，下次注入沿用')

// 竖条也要被面板摆位让开——placeFor 传的是实时矩形，这里验证它确实生效
await page.locator('.curve-card').first().click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)
const clear = await page.evaluate(() => {
  const bar = document.querySelector('visual-revise-toolbar').getBoundingClientRect()
  const panel = document.querySelector('visual-revise-panel').getBoundingClientRect()
  return bar.right <= panel.left || panel.right <= bar.left
      || bar.bottom <= panel.top || panel.bottom <= bar.top
})
ok(clear, '属性面板避开竖条工具条，不重叠')

await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.locator('visual-revise-toolbar .layout').click()
await page.waitForTimeout(500)
ok(!(await isVertical()), '再点一次切回横向')

// ── 面板里的 Esc ────────────────────────────────────────────
// Esc 在面板里只有一个语义：关掉正开着的弹层。没有弹层时不该被面板吃掉——
// 「点一下面板的控件、然后接着用键盘」是最常见的操作顺序，
// 那时按 Esc 想退出当前模式，却什么也不发生，得先点一下页面再按。
await page.locator('.curve-card').first().click({ position: { x: 120, y: 12 } })
await page.waitForTimeout(400)
await page.locator('visual-revise-panel input[data-prop="opacity"]').first().click()
await page.waitForTimeout(200)
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 1,
   '焦点落在面板的输入框里')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0,
   '焦点在面板里时按 Esc 仍能取消选中（此刻没有弹层）')

// 反过来：弹层开着时 Esc 归弹层，先关它而不是退模式
await page.locator('.curve-card').first().click({ position: { x: 120, y: 12 } })
await page.waitForTimeout(400)
await page.locator('visual-revise-panel vr-select[data-prop="position"]').click()
await page.waitForTimeout(300)
ok(await page.evaluate(() => !!document.getElementById('visual-revise-select-panel')),
   '下拉弹层已打开')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok(!(await page.evaluate(() => !!document.getElementById('visual-revise-select-panel')))
   && await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 1,
   'Esc 先关弹层，选中还在——弹层开着时它归弹层')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

// ── 新增的快捷键 ────────────────────────────────────────────
const curMode = () => page.evaluate(() => window.__visualRevise.mode)

await page.keyboard.press('Escape')
await page.keyboard.press('c')
await page.waitForTimeout(200)
ok(await curMode() === 'comment', 'C 进评论模式')

await page.keyboard.press('a')
await page.waitForTimeout(200)
ok(await curMode() === 'select', 'A 回到选择元素')

await page.keyboard.press('v')
await page.waitForTimeout(200)
ok(await curMode() === 'browse', 'V 进浏览模式')
await page.keyboard.press('a')
await page.waitForTimeout(200)

// 重排已并进属性面板的「结构」tab，R 不再是模式键，按了不该切走当前模式
await page.keyboard.press('r')
await page.waitForTimeout(200)
ok(await curMode() === 'select', 'R 不再是模式键，按了仍停在选择模式')
// B 也已释放：浏览改用 V
await page.keyboard.press('b')
await page.waitForTimeout(200)
ok(await curMode() === 'select', 'B 已释放，按了不切模式')

const listHidden = () => page.evaluate(() =>
  document.querySelector('visual-revise-list').hidden)
const wasHidden = await listHidden()
await page.keyboard.press('l')
await page.waitForTimeout(250)
ok(await listHidden() !== wasHidden, 'L 开合改动记录')
await page.keyboard.press('l')
await page.waitForTimeout(250)

await page.evaluate(() => {
  const el = document.querySelector('.curve-card')
  window.__visualRevise.store.applyProp(el, 'opacity', '0.5')
})
await page.keyboard.press('p')
await page.waitForTimeout(600)
const copied = await page.evaluate(() => navigator.clipboard.readText())
ok(copied.includes('opacity'), 'P 复制提示词')

// 页面输入框里打字不能被单字母快捷键吞掉
await page.evaluate(() => {
  const input = document.createElement('input')
  input.id = 'vr-key-probe'
  document.body.append(input)
  input.focus()
})
await page.keyboard.type('vlp')
await page.waitForTimeout(200)
ok(await page.inputValue('#vr-key-probe') === 'vlp',
   '在页面输入框里打 v / l / p 会正常输入，不触发快捷键')
// v 现在是浏览键，模式若被切走这一条就会红
ok(await curMode() === 'select', '输入过程中模式未被误切')
await page.evaluate(() => document.querySelector('#vr-key-probe')?.remove())

// 上游给它那 13 个工具各注册了一个单字母热键，而它的工具条是隐藏的——
// 按 m 会在背后切到 margin 工具，此后方向键就在改间距，界面上毫无提示。
// 用户在页面上随手打个字就可能中招。挂载时已把这些热键解绑，
// 这些键要么归我们，要么原样放行给页面，都不该再碰上游工具。
const upstreamTool = () => page.evaluate(() =>
  document.querySelector('vis-bug').activeTool)
const upstreamKeys = await page.evaluate(() =>
  Object.keys(document.querySelector('vis-bug').toolbar_model))
ok(upstreamKeys.length > 0, `上游确实注册过单字母热键（${upstreamKeys.join(' ')}）`)

await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.waitForTimeout(150)
const toolBefore = await upstreamTool()
for (const k of ['m', 'f', 'h', 'd', 'g', 'i', 'x', 'a', 's']) {
  await page.keyboard.press(k)
  await page.waitForTimeout(60)
}
await page.waitForTimeout(250)
ok(await upstreamTool() === toolBefore,
   `上游单字母热键已解绑，按 m/f/h/d… 不再在背后切工具（仍是 ${toolBefore}）`)
ok(await curMode() === 'select', '这些键也没有误切我们自己的模式')

// 解绑的只是热键，工具本身仍要能被代码直调——
// 浏览模式的停用/恢复走的就是 visbug.guides()
await page.keyboard.press('v')
await page.waitForTimeout(300)
await page.keyboard.press('v')
await page.waitForTimeout(300)
ok(await upstreamTool() === toolBefore, '解绑热键不影响 guides 被代码直调恢复')

// 用鼠标点过工具条之后，键盘还得能用。
// 这是最容易踩中的一条路径——点按钮切模式、接着想用键盘——而 shadow DOM 里的
// button 点完就留住了焦点。早先「事件路径经过插件 UI 就整块让路」的写法会让
// 此后所有快捷键失效，直到用户点回页面；从界面上完全看不出为什么。
// 先回到选择模式并清掉选中：这一段要测的是「焦点留在插件 UI 里时快捷键仍管用」，
// 而带着选中切评论模式现在会直接在选中的元素上开评论编辑框、焦点被编辑框接走
//（那是另一条路径，见 comment.mjs 的「先选中、再评论」）。不清选中的话焦点根本
// 到不了工具条按钮上，下面三条就全测在空气上了。
await page.keyboard.press('Escape')   // 浏览 → 选择
await page.waitForTimeout(250)
await page.keyboard.press('Escape')   // 取消选中
await page.waitForTimeout(250)

await page.locator('visual-revise-toolbar').locator('button[data-mode="comment"]').click()
await page.waitForTimeout(300)
const focusInUI = await page.evaluate(() => {
  const host = document.activeElement
  return host?.tagName === 'VISUAL-REVISE-TOOLBAR'
      && host.shadowRoot?.activeElement?.tagName === 'BUTTON'
})
ok(focusInUI, '点工具条按钮后焦点确实留在面板内（这条不成立则下面测的是空气）')
ok(await curMode() === 'comment', '点按钮切到评论模式')

await page.keyboard.press('a')
await page.waitForTimeout(250)
ok(await curMode() === 'select', '焦点还在工具条上时，A 仍能回到选择元素')

await page.keyboard.press('r')
await page.waitForTimeout(250)
ok(await curMode() === 'select', '焦点还在工具条上时，R 也不再切模式')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// ── 浏览模式 ────────────────────────────────────────────────
// 这个模式把页面完全还给用户：选择引擎暂停、覆盖层收起、评论 pin 也藏起来
// （它们有 pointer-events，留着会挡住页面上那个位置的点击）。
// 工具条留着——不然进去就出不来了。

const vrState = () => page.evaluate(() => ({
  mode: window.__visualRevise.mode,
  interactive: window.__visualRevise.interactive,
  toolbar: !document.querySelector('visual-revise-toolbar').hidden,
  comments: !document.querySelector('visual-revise-comment-layer').hidden,
  panel: !document.querySelector('visual-revise-panel').hidden,
  // 树不再是独立浮层，它活在面板的「结构」tab 里
  tree: !!document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('.structure:not([hidden]) visual-revise-tree'),
}))

// 只数「看得见」的：这些元素被隐藏时仍留在 DOM 里，光数个数会漏掉真问题
const countRulers = () => page.evaluate(() => {
  const visible = sel => Array.from(document.querySelectorAll(sel))
    .filter(el => getComputedStyle(el).display !== 'none').length
  const gridlines = visible('visbug-gridlines')
  const distance  = visible('visbug-distance')
  return { gridlines, distance, total: gridlines + distance }
})

// 先把标尺线造出来，否则后面「浏览模式下没有线」测的是空气
await page.keyboard.press('Escape')
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(250)
await page.locator('.curve-card').nth(0).hover({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)
const ruled = await countRulers()
ok(ruled.total > 0,
   `选择模式下 hover 会画出标尺线（gridlines=${ruled.gridlines}, distance=${ruled.distance}）`)

await page.keyboard.press('v')
await page.waitForTimeout(300)
const browsing = await vrState()
ok(browsing.mode === 'browse' && browsing.interactive, 'V 进入浏览模式')
ok(browsing.toolbar, '工具条留着——藏了就回不来了')
ok(!browsing.comments, '评论 pin 隐藏，不挡住页面上那个位置的点击')

await page.locator('.curve-card').first().click()
await page.waitForTimeout(250)
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0,
   '浏览模式下点击页面不会选中元素，页面照常工作')

// 这一步是整段的重点：必须在「进入浏览模式之后」再动鼠标。
// 旧实现给覆盖层设了 display:none 就收工，但 VisBug 的 guides 工具还绑着
// body 的 mousemove，它的 showGridlines() 里一句 `display = null` 就能把线
// 放回页面。只断言「切进去的瞬间」是干净的，永远测不出这个 bug。
await page.mouse.move(320, 300)
await page.mouse.move(520, 420)
await page.mouse.move(360, 500)
await page.waitForTimeout(400)
const afterMove = await countRulers()
ok(afterMove.total === 0,
   `浏览模式下移动鼠标不会再画出标尺线（gridlines=${afterMove.gridlines}, distance=${afterMove.distance}）`)

// 工具条还在，上面每个按钮都印着快捷键——按下去就得管用，否则 tooltip 在骗人。
// 真正「把页面完全让给网站」的是下面那个 Tab 隐身态。
//
// 模式键是幂等的，不做 toggle：这四个模式是一组 segmented control，
// 连按 B 就该一直停在浏览模式，正如点两次「Work」不会跳回别处。
await page.keyboard.press('v')
await page.waitForTimeout(250)
ok((await vrState()).mode === 'browse', '连按 V 仍停在浏览模式，不会 toggle 回选择态')

const hasBubble = () => page.evaluate(() =>
  document.querySelector('visual-revise-comment-layer')
    .shadowRoot.querySelectorAll('.bubble').length)

await page.keyboard.press('c')
await page.waitForTimeout(300)
ok((await vrState()).mode === 'comment', '浏览模式下 C 直接切到评论')

// 退出浏览模式会把选中原样装回来，于是「切进评论模式就在选中的元素上起草」
// 这条在这里同样成立：编辑框直接开出来，焦点也跟着进了编辑框。
// 下面几条测的是模式键，键必须落在页面上才算数——所以先按一下 Esc 把这条空草稿
// 收掉（Esc 的第一层语义一直是取消草稿，模式不动），键盘才回到编辑器本体手上。
ok(await hasBubble() === 1, '浏览模式退出后选中被装回，C 同样直接在它身上开编辑框')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
const afterEsc = await vrState()
ok(await hasBubble() === 0 && afterEsc.mode === 'comment',
   `Esc 先收掉草稿，模式不动（mode=${afterEsc.mode}）`)

await page.keyboard.press('c')
await page.waitForTimeout(250)
ok((await vrState()).mode === 'comment', '连按 C 也停在评论模式')
ok(await hasBubble() === 0, '第二下 C 不再另起一条草稿——setMode 幂等，只有真正切进来那次才起草')

await page.keyboard.press('a')
await page.waitForTimeout(250)
ok((await vrState()).mode === 'select', 'A 回到选择元素')

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok((await vrState()).mode === 'select', 'Esc 回到选择元素')

// 停用必须是可逆的，否则等于把 VisBug 的测距永久关掉了。
// 判据不能只看「元素还在且可见」——退出时我们刚把它们的 display 恢复成 ''，
// 那只是旧元素露出来，跟工具是否在工作无关。gridlines 的 update setter 会把
// display 写成 'block'，只有 mousemove 真的走到了 guides 才会发生。
await page.evaluate(() =>
  document.querySelectorAll('visbug-gridlines').forEach(el => { el.style.display = '' }))
await page.mouse.move(340, 320)
await page.mouse.move(560, 440)
await page.waitForTimeout(400)
const revived = await page.evaluate(() =>
  Array.from(document.querySelectorAll('visbug-gridlines'))
    .some(el => el.style.display === 'block'))
ok(revived, '退出浏览模式后 VisBug guides 工具重新装回')

// Tab 是另一件事：连工具条一起藏，完全让开
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
const stealth = await vrState()
ok(stealth.interactive && !stealth.toolbar, 'Tab 连工具条一起藏（完全让开）')

// 工具条都藏了，键就不该再归插件——此刻用户是在用这个网站，
// 占着单字母会打坏它自己的快捷键
await page.keyboard.press('c')
await page.keyboard.press('r')
await page.keyboard.press('l')
await page.waitForTimeout(250)
const stillStealth = await vrState()
ok(stillStealth.interactive && !stillStealth.toolbar,
   '隐身态下单字母一律放行给页面，不切模式也不开列表')
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
ok((await vrState()).mode === 'select', '再按 Tab 回到原来的模式')

// 两个 × 的语义不同：
// 属性面板的 × 只收起这块面板，模式不动——用户多半还想接着选下一个元素；
// 结构树的 × 退出的是「重排」这件事本身，所以仍然回到浏览模式。
await page.locator('.curve-card').first().click()
await page.waitForTimeout(300)
ok((await vrState()).panel, '选中元素后属性面板出现')
await page.locator('visual-revise-panel .close').click()
await page.waitForTimeout(300)
ok((await vrState()).mode === 'select', '属性面板的 × 不改变当前模式')
ok(!(await vrState()).panel, '面板确实收起来了')

// 结构不再是一个模式，而是面板里的一个 tab：F 进结构、A 回属性。
// 面板只在选中元素后出现，所以先选一个。
await page.locator('.curve-card').first().click({ position: { x: 120, y: 12 } })
await page.waitForTimeout(400)
await page.keyboard.press('f')
await page.waitForTimeout(400)
ok((await vrState()).tree, 'F 打开面板的「结构」tab')
ok((await vrState()).mode === 'select', '结构是 tab 不是模式，当前仍在选择模式')

await page.keyboard.press('a')
await page.waitForTimeout(400)
ok(!(await vrState()).tree, 'A 切回「选择元素」tab')
ok((await vrState()).panel, '面板本身还在——切 tab 不是关面板')

await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 关闭按钮
await bar('.close').click()
await page.waitForTimeout(500)
ok(await page.locator('vis-bug').count() === 0, '关闭按钮移除整个编辑器')
ok(await page.locator('visual-revise-toolbar').count() === 0, '工具条随之移除')


await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
