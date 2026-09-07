import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[改动列表测试]\n')
await page.goto(origin)
await injectVisBug(page, origin)

// 造几条改动
await page.evaluate(() => {
  const s = window.__visualRevise.store
  const card  = document.querySelectorAll('.curve-card')[1]
  const title = document.querySelector('.hero-title')
  s.track(card); s.track(title)
  s.applyProp(card, 'border-radius', '12px')
  s.applyProp(card, 'padding-top', '24px')
  s.applyProp(title, 'font-size', '56px')
  s.addComment(card, '鼠标移入时上浮并变亮')
})
await page.waitForTimeout(200)

// 打开列表
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.locator('visual-revise-toolbar .list').click()
await page.waitForTimeout(300)

ok(!(await page.locator('visual-revise-list').getAttribute('hidden')), '点击「记录」打开列表')

const items = await page.locator('visual-revise-list .item').count()
ok(items === 3, `列表渲染 ${items} 项（2 个元素 + 1 条评论）`)

const allTab = await page.locator('visual-revise-list .tabs button[data-tab="all"]').textContent()
ok(allTab.includes('4'), `全部标签计数：${allTab.trim()}`)

// tab 过滤
await page.locator('visual-revise-list .tabs button[data-tab="comment"]').click()
await page.waitForTimeout(200)
const commentOnly = await page.locator('visual-revise-list .item').count()
ok(commentOnly === 1, `评论标签只显示评论（${commentOnly} 项）`)
ok((await page.locator('visual-revise-list .comment-text').textContent()).includes('上浮'), '评论内容正确')

await page.locator('visual-revise-list .tabs button[data-tab="all"]').click()
await page.waitForTimeout(200)

// hover 高亮
await page.locator('visual-revise-list .item').first().hover()
await page.waitForTimeout(300)
const overlay = await page.evaluate(() => {
  const el = document.getElementById('visual-revise-locate-overlay')
  return el ? { display: el.style.display, width: el.style.width } : null
})
ok(overlay?.display === 'block', `hover 列表项高亮页面元素（overlay ${overlay?.width}）`)

// 单条属性撤销
await page.locator('visual-revise-list .undo-prop[data-prop="border-radius"]').click()
await page.waitForTimeout(300)
const afterUndoProp = await page.evaluate(() =>
  getComputedStyle(document.querySelectorAll('.curve-card')[1]).borderRadius)
ok(afterUndoProp === '18px', `单条撤销还原：border-radius = ${afterUndoProp}`)

const remaining = await page.evaluate(() => window.__visualRevise.store.stats())
ok(remaining.props === 2, `撤销后剩 ${remaining.props} 项属性改动`)

// 点击定位并选中
await page.locator('visual-revise-list .item[data-kind="style"]').first().click()
await page.waitForTimeout(400)
const located = await page.locator('visual-revise-panel .tag').textContent()
ok(located.includes('curve-card') || located.includes('hero-title'),
   `点击列表项定位并选中元素：${located}`)

// 删除评论
await page.locator('visual-revise-list .del-comment').click()
await page.waitForTimeout(300)
ok((await page.evaluate(() => window.__visualRevise.store.stats())).comments === 0, '删除评论生效')

// 全部重置
await page.locator('visual-revise-list .reset').click()
await page.waitForTimeout(300)
const afterReset = await page.evaluate(() => ({
  stats: window.__visualRevise.store.stats(),
  cardStyle: document.querySelectorAll('.curve-card')[1].getAttribute('style'),
  titleSize: getComputedStyle(document.querySelector('.hero-title')).fontSize,
}))
ok(afterReset.stats.total === 0, '重置后记录清空')
ok(afterReset.titleSize === '40px', `重置后页面还原：font-size = ${afterReset.titleSize}`)

// ── 回归：外部撤销后面板字段必须回读真实值 ──
// force：此时选中框覆盖层还在，Playwright 的可操作性检查会拒绝点击，
// 而真实用户点击时 VisBug 用 deepElementFromPoint 能穿透覆盖层
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 }, force: true })
await page.waitForTimeout(400)

const radius = page.locator('visual-revise-panel input[data-prop="border-radius"]')
// 填裸数字：长度字段只显示数字，px 由 coerceLength 在写入时补回
await radius.fill('30')
await radius.dispatchEvent('change')
await page.waitForTimeout(300)
const afterEdit = await radius.inputValue()
const writtenStyle = await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].style.borderRadius)

// 从面板之外触发撤销（reset 按钮的点击路径已由上面的用例覆盖，
// 这里要验证的是面板对外部 store 变更的响应）
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(400)

// 聚焦中的字段在同步时被有意跳过；失焦后应补上
const focusedStill = await radius.inputValue()
await page.evaluate(() => document.activeElement?.blur?.())
await page.waitForTimeout(300)

const afterReset2 = await radius.inputValue()
const realValue = await page.evaluate(() =>
  getComputedStyle(document.querySelectorAll('.curve-card')[1]).borderRadius)

ok(afterEdit === '30', `改动后字段显示新值：${afterEdit}`)
ok(writtenStyle === '30px', `写进样式的仍是带单位的值：${writtenStyle}`)
ok(focusedStill === '30',
   `外部撤销时不打断正在编辑的字段（仍显示 ${focusedStill}）`)
ok(afterReset2 === realValue.replace(/px$/, ''),
   `字段失焦后回读真实值：字段=${afterReset2} 实际=${realValue}`)

const dirtyLeft = await page.locator('visual-revise-panel label.name[data-dirty]').count()
ok(dirtyLeft === 0, `重置后 dirty 标记已清空（${dirtyLeft} 个）`)

// ── 回归：高频更新不得重建 header/footer，否则拖动手势会被摧毁 ──
await page.evaluate(() => {
  const list = window.__visualRevise.list
  list.hidden = false
  list.render()
})
await page.waitForTimeout(300)

const stability = await page.evaluate(async () => {
  const list   = window.__visualRevise.list
  const store  = window.__visualRevise.store
  const shadow = list.shadowRoot

  const header = shadow.querySelector('header')
  const footer = shadow.querySelector('footer')
  const copyBtn = shadow.querySelector('.copy')

  const el = document.querySelectorAll('.curve-card')[1]
  store.track(el)

  // 模拟拖动标签：以指针事件的频率连续提交
  for (let i = 0; i < 30; i++) store.applyProp(el, 'padding-top', `${20 + i}px`)

  await new Promise(r => requestAnimationFrame(r))
  await new Promise(r => requestAnimationFrame(r))

  return {
    sameHeader: shadow.querySelector('header') === header,
    sameFooter: shadow.querySelector('footer') === footer,
    sameCopy:   shadow.querySelector('.copy') === copyBtn,
    tabText:    shadow.querySelector('.tabs button[data-tab="all"]').textContent,
    items:      shadow.querySelectorAll('.item').length,
    applied:    el.style.paddingTop,
  }
})

ok(stability.sameHeader && stability.sameFooter && stability.sameCopy,
   `30 次连续更新后 header/footer/按钮均为同一节点（拖动手势不会被打断）`)
ok(stability.items === 1 && stability.applied === '49px',
   `列表内容正常更新：${stability.items} 项，最终值 ${stability.applied}`)
ok(stability.tabText.includes('1'), `计数同步更新：${stability.tabText.trim()}`)

await page.evaluate(() => window.__visualRevise.store.undoEverything())

// ── 移动记录：列表里要看得见、点得到、搬得回 ──────────────
await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  window.__visualRevise.store.history.clear()
  document.getElementById('lz')?.remove()
  const z = document.createElement('div')
  z.id = 'lz'
  z.style.cssText = 'position:absolute;left:30px;top:640px'
  z.innerHTML = '<div id="lz-a"><p class="ll">搬我</p></div><div id="lz-b"></div>'
  document.body.appendChild(z)
  window.__visualRevise.store.moveElement(z.querySelector('.ll'), document.getElementById('lz-b'), null)
  const list = window.__visualRevise.list
  list.hidden = false
  list.render()
})
await page.waitForTimeout(400)

const moveRow = page.locator('visual-revise-list .item[data-kind="move"]')
ok(await moveRow.count() === 1, `列表里出现一条「移动」记录（${await moveRow.count()} 条）`)
ok((await moveRow.textContent()).includes('移动到'),
   `记录写明搬到哪儿了：「${(await moveRow.textContent()).replace(/\s+/g, ' ').trim()}」`)

const counts = (await page.locator('visual-revise-list .tabs').textContent()).replace(/\s+/g, ' ').trim()
ok(/全部\s*1/.test(counts) && /配置\s*1/.test(counts),
   `移动计入「全部」与「配置」两个计数（${counts}）`)

// 点整行定位到页面上那个元素
await moveRow.first().scrollIntoViewIfNeeded()
await moveRow.first().click({ position: { x: 30, y: 26 } })
await page.waitForTimeout(400)
ok(await page.evaluate(() =>
  document.querySelector('[data-selected]')?.textContent.trim()) === '搬我',
   '点这条记录能定位并选中被移动的元素')

// 单独搬回去：记录随之消失
await page.locator('visual-revise-list .move-back').first().scrollIntoViewIfNeeded()
await page.locator('visual-revise-list .move-back').first().click()
await page.waitForTimeout(400)
const backHome = await page.evaluate(() => ({
  a: document.getElementById('lz-a').textContent.trim(),
  b: document.getElementById('lz-b').children.length,
  moves: window.__visualRevise.store.stats().moves,
}))
ok(backHome.a === '搬我' && backHome.b === 0 && backHome.moves === 0,
   `「搬回」把元素放回原位，记录也随之消失（${JSON.stringify(backHome)}）`)
ok(await moveRow.count() === 0, '列表里那一行没了')

await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  document.getElementById('lz')?.remove()
})

// ── 新增记录：分组造出来的元素也要看得见、点得到、撤得掉 ──────
// ⌘G 是「insert 一个 wrapper + n 条 move」，改动列表以前只认四种记录，
// 新造出来的元素一行都渲染不出来，用户看不到自己刚做了什么。
await page.evaluate(() => {
  const store = window.__visualRevise.store
  store.undoEverything()
  store.history.clear()
  document.getElementById('lg')?.remove()
  const g = document.createElement('div')
  g.id = 'lg'
  g.style.cssText = 'position:absolute;left:30px;top:760px'
  g.innerHTML = '<p class="gg" id="gg1">甲</p><p class="gg" id="gg2">乙</p>'
  document.body.appendChild(g)
  store.groupElements([document.getElementById('gg1'), document.getElementById('gg2')])
  const list = window.__visualRevise.list
  list.hidden = false
  list.render()
})
await page.waitForTimeout(400)

const insertRow = page.locator('visual-revise-list .item[data-kind="insert"]')
ok(await insertRow.count() === 1, `列表里出现一条「新增」记录（${await insertRow.count()} 条）`)
const insertText = (await insertRow.textContent()).replace(/\s+/g, ' ').trim()
ok(/分组|新增元素/.test(insertText) && /(放在|插在)/.test(insertText),
   `记录写明加了什么、加在哪儿：「${insertText}」`)

const gCounts = await page.evaluate(() => ({
  tabs: document.querySelector('visual-revise-list').shadowRoot
    .querySelector('.tabs').textContent.replace(/\s+/g, ' ').trim(),
  stats: window.__visualRevise.store.stats(),
}))
ok(new RegExp(`全部\\s*${gCounts.stats.total}`).test(gCounts.tabs) &&
   new RegExp(`配置\\s*${gCounts.stats.total}`).test(gCounts.tabs),
   `「全部」「配置」两个计数都跟 stats() 对得上（${gCounts.tabs}；total=${gCounts.stats.total} inserts=${gCounts.stats.inserts} moves=${gCounts.stats.moves}）`)

// 点整行定位到那个新造出来的元素
await insertRow.first().scrollIntoViewIfNeeded()
await insertRow.first().click({ position: { x: 30, y: 26 } })
await page.waitForTimeout(400)
ok(await page.evaluate(() => {
  const sel = document.querySelector('[data-selected]')
  return !!sel && sel.parentElement?.id === 'lg' && sel.querySelectorAll('.gg').length === 2
}), '点这条记录能定位并选中新造出来的容器')

// ↺ 把这个新增元素撤掉：记录对消，不该留下一条「已删除」的假记录
await page.locator('visual-revise-list .remove-insert').first().scrollIntoViewIfNeeded()
await page.locator('visual-revise-list .remove-insert').first().click()
await page.waitForTimeout(400)
const afterUndoInsert = await page.evaluate(() => window.__visualRevise.store.stats())
ok(afterUndoInsert.inserts === 0 && afterUndoInsert.removals === 0,
   `撤掉新增元素时对消那条 insert，不记成「删除的元素」（inserts=${afterUndoInsert.inserts} removals=${afterUndoInsert.removals}）`)
ok(await insertRow.count() === 0, '列表里那一行没了')

await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  document.getElementById('lg')?.remove()
})

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
