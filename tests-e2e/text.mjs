import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[文案改动测试] 记录 / 撤销 / 导出\n')
await page.goto(origin)
await injectVisBug(page, origin)

const title = () => page.locator('.card-title').nth(1)
const stats = () => page.evaluate(() => window.__visualRevise.store.stats())
const edits = () => page.evaluate(() =>
  window.__visualRevise.store.read().edits.map(e => ({
    tag: e.anchors.tag,
    text: e.text,
    props: e.changes.map(c => c.prop),
  })))

// 真实用法是双击页面文字。但自动化里驱动不了这个手势：同一坐标上连续两次
// 点击，第二次会被吞掉（点别处再点回来就正常），dblclick 事件根本不产生。
// 双击处理器本身只做一件事——visbug.toolSelected('text')，也就是下面这句，
// 所以这里直接走它，测的仍是同一条编辑态路径。
const enterEditMode = async () => {
  await page.evaluate(() => document.querySelector('vis-bug').toolSelected('text'))
  await page.waitForTimeout(300)
}

// ── 进入编辑态，改文字 ────────────────────────────────────
await title().click()
await page.waitForTimeout(300)
await enterEditMode()

ok(await title().evaluate(el => el.isContentEditable),
   '进入编辑态（VisBug 把元素设成 contenteditable）')
ok((await stats()).total === 0, '刚进编辑态还没改动，记录为空')

await page.keyboard.press('End')
await page.keyboard.type('！')
await page.waitForTimeout(500)

const after = await edits()
ok(after.length === 1, `记录了 ${after.length} 条改动`)
ok(after[0]?.text?.from === 'Thinking Five',
   `原文被快照下来：${after[0]?.text?.from}`)
ok(after[0]?.text?.to === 'Thinking Five！',
   `新文案：${after[0]?.text?.to}`)
ok(after[0]?.props.length === 0, '纯文案改动不会连带记进样式属性')
ok((await stats()).texts === 1, '统计里单独有一项文案计数')

// ── 祖先不重复记账 ────────────────────────────────────────
// 改一句话会让它所有祖先的 textContent 都跟着变，
// 但用户动的是最内层那个，外层是连带的
await page.evaluate(() => {
  const card = document.querySelectorAll('.curve-card')[1]
  window.__visualRevise.store.track(card)
})
await page.waitForTimeout(200)
await page.keyboard.type('！')
await page.waitForTimeout(500)

const nested = await edits()
ok(nested.filter(e => e.text).length === 1,
   `父元素也被跟踪时，文案改动只记最内层那一条（共 ${nested.filter(e => e.text).length} 条）`)
ok(nested.find(e => e.text)?.tag === 'h2',
   `记在 h2 上而不是外层 article：${nested.find(e => e.text)?.tag}`)

// ── 文案 + 样式可以并存 ───────────────────────────────────
await page.evaluate(() => {
  const el = document.querySelectorAll('.card-title')[1]
  window.__visualRevise.store.applyProp(el, 'font-size', '22px')
})
await page.waitForTimeout(300)

const both = (await edits()).find(e => e.text)
ok(both?.props.includes('font-size'),
   '同一个元素上文案与样式并存，互不覆盖')
ok((await stats()).total === 2, `合计 = 文案 1 + 属性 1 = ${(await stats()).total}`)

// ── 导出 ──────────────────────────────────────────────────
const md = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))

ok(md.includes('**文案改动**'), '提示词里文案单独成段')
ok(md.includes('- 原文：`Thinking Five`'), '段落里给出原文')
ok(md.includes('Thinking Five！！'), '段落里给出改后的文案')
ok(md.includes('1 处文案'), `摘要单独统计文案：${md.match(/改动：.*/)?.[0]}`)
ok(md.includes('不要用 CSS 的 content'),
   '提示 AI 改源码里的文案本身，而不是用 CSS 覆盖显示结果')
ok(md.includes('**样式改动**'), '样式表格与文案分开呈现')

// ── 单独撤销文案，样式要留着 ──────────────────────────────
const id = await page.evaluate(() =>
  window.__visualRevise.store.read().edits.find(e => e.text)?.id)
await page.evaluate(i => window.__visualRevise.store.undoText(i), id)
await page.waitForTimeout(300)

ok(await title().textContent() === 'Thinking Five', '撤销文案后页面还原成原文')
ok((await stats()).texts === 0, '文案记录已清空')
ok((await stats()).props === 1, '同元素上的样式改动不受牵连')

// 撤销走的是文本节点原地写回，元素本身不该被重建
ok(await title().evaluate(el => el.tagName === 'H2' && el.isConnected),
   '撤销不重建元素——重建会让子元素身上的改动和快照失联')

// ── 全部重置也要还原文案 ──────────────────────────────────
await title().click()
await enterEditMode()
await page.keyboard.press('End')
await page.keyboard.type('X')
await page.waitForTimeout(400)
ok((await stats()).texts === 1, '再改一次文案')

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(400)
ok(await title().textContent() === 'Thinking Five', '全部重置把文案也还原了')
ok((await stats()).total === 0, '重置后记录清空')

// ── 改动列表里能看到并撤销 ────────────────────────────────
await title().click()
await enterEditMode()
await page.keyboard.press('End')
await page.keyboard.type('Y')
await page.waitForTimeout(400)
await page.evaluate(() => {
  const list = window.__visualRevise.list
  list.hidden = false
  list.render()
})
await page.waitForTimeout(300)

ok(await page.locator('visual-revise-list .change[data-text]').count() === 1,
   '改动列表里有一条文案记录')
ok((await page.locator('visual-revise-list .change[data-text]').textContent()).includes('文案'),
   '标为「文案」而不是某个 CSS 属性名')

await page.locator('visual-revise-list .undo-text').click()
await page.waitForTimeout(400)
ok(await title().textContent() === 'Thinking Five', '列表里的 × 能撤销文案')

// ── 面板自身的输入不该被当成页面文案 ──────────────────────
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(400)
const before = (await stats()).texts
const radius = page.locator('visual-revise-panel input[data-prop="border-radius"]')
await radius.fill('9px')
await radius.press('Enter')
await page.waitForTimeout(300)
ok((await stats()).texts === before, '在属性面板里打字不会被记成页面文案改动')

// ── 编辑结束要把工具交还给选择引擎 ──────────────────────────
// 进入文案编辑会把 VisBug 的活动工具切成 text，selectable 的热键跟着解绑。
// 不切回来的话，用户改完一句话之后 Esc 不再取消选中、层级导航也全哑了，
// 而界面上看不出发生过什么。
await page.reload(); await injectVisBug(page, origin); await page.waitForTimeout(400)
const tool = () => page.evaluate(() => {
  const vb = document.querySelector('vis-bug')
  return vb.activeTool?.dataset?.tool ?? vb.activeTool ?? '?'
})
const selCount = () => page.evaluate(() => document.querySelectorAll('[data-selected]').length)

await page.locator('.card-title').first().click(); await page.waitForTimeout(300)
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('text')); await page.waitForTimeout(300)
await page.keyboard.press('End'); await page.keyboard.type('改'); await page.waitForTimeout(400)
ok(await tool() === 'text', `编辑时活动工具是 text（${await tool()}）`)

// 用户点别的元素离开编辑态
await page.locator('.curve-card').nth(2).click({ position: { x: 120, y: 12 } })
await page.waitForTimeout(450)
ok(await tool() === 'guides', `离开编辑态后工具交还给选择引擎（${await tool()}）`)

await page.keyboard.press('Escape'); await page.waitForTimeout(300)
ok(await selCount() === 0, `编辑过文案之后 Esc 仍能取消选中（剩 ${await selCount()} 个）`)

await browser.close()
await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
