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
ok(await bar('button[data-mode]').count() === 4, '四个模式按钮（浏览 / 选择 / 评论 / 重排）')
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

await bar('button[data-mode="reorder"]').click()
await page.waitForTimeout(300)
ok(await mode() === 'reorder' && (await litMode()).join() === 'reorder', '切到重排模式，评论自动退出')
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

// 切到非选择模式时，面板收起且取消选中
await bar('button[data-mode="comment"]').click()
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-panel').evaluate(el => el.hidden), '切到评论模式后面板收起')
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0, '同时取消选中')

// 计数与复制按钮状态
await bar('button[data-mode="select"]').click()
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
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
ok(iconCheck.svgCount === 10, `全部图标为内联 SVG（${iconCheck.svgCount} 个，含撤销 / 重做）`)
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
ok(order.join(',') === 'browse,select,comment,reorder,undo,redo,list,copy,close',
   `撤销 / 重做排在出口那组前面：${order.join(' · ')}`)

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
  ['[data-mode="browse"]',  '浏览页面', 'B'],
  ['[data-mode="select"]',  '选择元素', 'V'],
  ['[data-mode="comment"]', '评论',     'C'],
  ['[data-mode="reorder"]', '重排',     'R'],
  ['.list',                 '改动记录', 'L'],
  ['.copy',                 '复制提示词', 'P'],
  ['.close',                '关闭编辑器', '⌥⇧D'],
]) {
  const tip = await tipOf(sel)
  ok(tip?.label === label && tip.key === key,
     `${sel} 的气泡：${tip?.label} ${tip?.key}`)
}
ok((await tipOf('.close'))?.inside, '贴边的按钮，气泡也被夹在视口内')

// ── 新增的快捷键 ────────────────────────────────────────────
const curMode = () => page.evaluate(() => window.__visualRevise.mode)

await page.keyboard.press('Escape')
await page.keyboard.press('c')
await page.waitForTimeout(200)
ok(await curMode() === 'comment', 'C 进评论模式')

await page.keyboard.press('v')
await page.waitForTimeout(200)
ok(await curMode() === 'select', 'V 切回选择元素')

await page.keyboard.press('r')
await page.waitForTimeout(200)
ok(await curMode() === 'reorder', 'R 进重排模式')
await page.keyboard.press('v')
await page.waitForTimeout(200)

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
ok(await curMode() === 'select', '输入过程中模式未被误切')
await page.evaluate(() => document.querySelector('#vr-key-probe')?.remove())

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
}))

await page.keyboard.press('Escape')
await page.keyboard.press('b')
await page.waitForTimeout(300)
const browsing = await vrState()
ok(browsing.mode === 'browse' && browsing.interactive, 'B 进入浏览模式')
ok(browsing.toolbar, '工具条留着——藏了就回不来了')
ok(!browsing.comments, '评论 pin 隐藏，不挡住页面上那个位置的点击')

await page.locator('.curve-card').first().click()
await page.waitForTimeout(250)
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0,
   '浏览模式下点击页面不会选中元素，页面照常工作')

// 用户此刻在「用」这个网站，占着单字母会把它自己的快捷键打坏
await page.keyboard.press('v')
await page.keyboard.press('c')
await page.keyboard.press('r')
await page.waitForTimeout(250)
ok((await vrState()).mode === 'browse', '浏览模式下单字母按键放行给页面，不切模式')

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok((await vrState()).mode === 'select', 'Esc 回到选择元素')

// Tab 是另一件事：连工具条一起藏，完全让开
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
const stealth = await vrState()
ok(stealth.interactive && !stealth.toolbar, 'Tab 连工具条一起藏（完全让开）')
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
ok((await vrState()).mode === 'select', '再按 Tab 回到原来的模式')

// 两个面板的 × 都是「我不改了，把页面还给我」
await page.locator('.curve-card').first().click()
await page.waitForTimeout(300)
ok((await vrState()).panel, '选中元素后属性面板出现')
await page.locator('visual-revise-panel .close').click()
await page.waitForTimeout(300)
ok((await vrState()).mode === 'browse', '属性面板的 × 去到浏览模式')

await page.evaluate(() => window.__visualRevise.setMode('reorder'))
await page.waitForTimeout(300)
await page.locator('visual-revise-tree .close').click()
await page.waitForTimeout(300)
ok((await vrState()).mode === 'browse', '结构树的 × 同样去到浏览模式')

await page.evaluate(() => window.__visualRevise.setMode('select'))
await page.waitForTimeout(200)

// 关闭按钮
await bar('.close').click()
await page.waitForTimeout(500)
ok(await page.locator('vis-bug').count() === 0, '关闭按钮移除整个编辑器')
ok(await page.locator('visual-revise-toolbar').count() === 0, '工具条随之移除')


await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
