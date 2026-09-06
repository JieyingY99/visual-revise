// 记录挂的是 DOM 节点引用。框架重渲染会把节点整个换掉，引用随之悬空——
// 这正是「点了一下侧栏开关，之前的标注全没了」的成因。
// 这里固化的是：改动跨重渲染活下来，且不会以「猜错元素」为代价。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[重新锚定测试] 框架重渲染后改动不丢\n')
await page.goto(origin)
await injectVisBug(page, origin)

// 模拟框架重渲染：同样的内容，换一个全新的 DOM 节点
const rerender = (selector, { stripStyle = true } = {}) => page.evaluate(([sel, strip]) => {
  const el = document.querySelector(sel)
  const fresh = el.cloneNode(true)
  if (strip) fresh.removeAttribute('style')
  el.replaceWith(fresh)
}, [selector, stripStyle])

const settle = () => page.evaluate(() =>
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

const stats = () => page.evaluate(() => window.__visualRevise.store.stats())

// ── 样式：记录与画面都要活下来 ──────────────────────────────
await page.evaluate(() => {
  const el = document.querySelector('.curve-card')
  window.__visualRevise.store.applyProp(el, 'padding-top', '40px')
})
ok((await stats()).props === 1, '起点：一条样式改动')

await rerender('.curve-card')
await settle()
const healed = await stats()

ok(healed.props === 1, '节点被换掉后，记录一帧之内自己找了回来')
ok(await page.evaluate(() => document.querySelector('.curve-card').style.paddingTop) === '40px',
   '改动被重新贴到新节点上——光救回记录、不救画面等于没救')

// 同一元素不能因为改绑而裂成两条记录
ok(healed.elements === 1, `改绑没有把一个元素变成两条记录（elements=${healed.elements}）`)

// ── 评论 ────────────────────────────────────────────────────
await page.evaluate(() => {
  window.__visualRevise.store.addComment(document.querySelector('.hero-title'), '这里要上浮')
})
await rerender('.hero-title')
await settle()
const afterComment = await stats()
ok(afterComment.comments === 1, '评论同样跟着新节点走')
ok(await page.evaluate(() =>
  window.__visualRevise.store.read().comments[0].el === document.querySelector('.hero-title')),
   '评论绑定到的是页面上当前那个节点，而不是内存里的死节点')

// ── 文案 ────────────────────────────────────────────────────
await page.evaluate(() => {
  const el = document.querySelector('.card-title')
  window.__visualRevise.store.markEdited(el)
  el.childNodes[0].nodeValue = '改过的标题'
})
await rerender('.card-title')
await settle()
ok(await page.evaluate(() => document.querySelector('.card-title').textContent.trim()) === '改过的标题',
   '文案改动也重新贴了回去')

// ── 找不回来时：留下记录，而不是静默清空 ────────────────────
const before = await stats()
await page.evaluate(() => document.querySelector('.curve-card').remove())
await settle()
const orphan = await page.evaluate(() => {
  const { edits } = window.__visualRevise.store.read()
  return { total: window.__visualRevise.store.stats().total, orphaned: edits.filter(e => e.orphaned).length }
})
ok(orphan.orphaned === 2,
   `元素真的没了，记录标成 orphaned 留在列表里（卡片与卡片内的标题各一条，实得 ${orphan.orphaned}）`)
ok(orphan.total === before.total,
   `记录数没有莫名往下掉（${before.total} → ${orphan.total}）——静默丢弃正是原来那个 bug`)

// ── 不能猜错元素 ────────────────────────────────────────────
// 一屏结构相同的行里，锚点回退档必须唯一命中才认，宁可标成失联
const ambiguous = await page.evaluate(() => {
  const store = window.__visualRevise.store
  const host = document.createElement('div')
  host.id = 'vr-rows'
  host.innerHTML = '<p class="row">一样的文字</p><p class="row">一样的文字</p>'
  document.body.append(host)

  const [first, second] = host.querySelectorAll('.row')
  store.applyProp(first, 'padding-top', '12px')
  first.remove()                              // 只删掉第一行
  return { survivor: second.style.paddingTop }
})
await settle()
const guessed = await page.evaluate(() => {
  const { edits } = window.__visualRevise.store.read()
  const row = edits.find(e => e.anchors.classes?.includes('row'))
  return {
    survivor: document.querySelector('#vr-rows .row').style.paddingTop,
    rowOrphaned: !!row?.orphaned,
    rowKept: !!row,
  }
})
ok(guessed.survivor === '', '没有把改动贴到长得一样的隔壁那行上')
ok(guessed.rowKept && guessed.rowOrphaned,
   '认不准就标成失联并留在记录里——猜错比丢失更糟，导出的提示词会是错的')

// ── 删除：页面把元素渲回来就再删一次 ────────────────────────
await page.evaluate(() => {
  const host = document.querySelector('#vr-rows')
  host.innerHTML = '<p class="gone-row">删我</p>'
  window.__visualRevise.store.removeElements([host.querySelector('.gone-row')])
})
ok(await page.locator('#vr-rows .gone-row').count() === 0, '起点：元素已删除')

await page.evaluate(() => {
  const p = document.createElement('p')
  p.className = 'gone-row'
  p.textContent = '删我'
  document.querySelector('#vr-rows').append(p)      // 应用又渲染回来了
})
await settle()
ok(await page.locator('#vr-rows .gone-row').count() === 0, '页面渲回来的元素被再次删掉')

// 但删除只认身份、不认位置：不能顺手把结构相同的隔壁一起删了
const cascade = await page.evaluate(async () => {
  const host = document.querySelector('#vr-rows')
  host.innerHTML = '<p class="gone-row">删我</p><p class="gone-row">别删我</p>'
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  return [...host.querySelectorAll('.gone-row')].map(p => p.textContent)
})
ok(!cascade.includes('删我') && cascade.includes('别删我'),
   `只删身份相同的那个，没有级联：剩下 ${JSON.stringify(cascade)}`)

await page.evaluate(() => document.querySelector('#vr-rows')?.remove())

// ── 移动：源容器被重渲染后，搬过家的元素要跟着重放 ────────────
// 这里和删除的模型不一样：框架把源容器 innerHTML 重写后，被移动的元素会在
// 原位置重新出现一份，而我们先前搬过去的那一份还留在目标容器里——页面上
// 两份。重放必须是「认出新的那份、丢掉旧的、把新的搬过去」。
await page.evaluate(() => {
  document.getElementById('vr-move')?.remove()
  const host = document.createElement('div')
  host.id = 'vr-move'
  host.innerHTML = '<div id="mv-src"><p class="mv-item">搬我</p><p class="mv-other">别动我</p></div>'
    + '<div id="mv-dst"></div>'
  document.body.append(host)
  window.__visualRevise.store.moveElement(
    host.querySelector('.mv-item'), document.getElementById('mv-dst'), null)
})
await settle()
ok(await page.evaluate(() => document.getElementById('mv-dst').textContent.trim()) === '搬我',
   '起点：元素已搬进目标容器')

await page.evaluate(() => {
  // 框架重渲染：源容器整块重写，被搬走的元素又长回来了
  document.getElementById('mv-src').innerHTML =
    '<p class="mv-item">搬我</p><p class="mv-other">别动我</p>'
})
await settle()
const replayed = await page.evaluate(() => ({
  dst:    document.getElementById('mv-dst').textContent.trim(),
  src:    [...document.getElementById('mv-src').children].map(n => n.textContent.trim()).join(','),
  copies: document.querySelectorAll('.mv-item').length,
  moves:  window.__visualRevise.store.stats().moves,
}))
ok(replayed.dst === '搬我' && replayed.src === '别动我',
   `重渲染后移动被重放（目标容器 = ${replayed.dst}，源容器 = ${replayed.src}）`)
ok(replayed.copies === 1, `页面上只剩一份，没有留下重影（${replayed.copies} 份）`)
ok(replayed.moves === 1, `记录仍是一条，没有裂成两条（moves=${replayed.moves}）`)

// 目标容器整个没了：记录留着并标成失联，而不是静默丢弃
await page.evaluate(() => document.getElementById('mv-dst').remove())
await page.evaluate(() => {
  document.getElementById('mv-src').innerHTML =
    '<p class="mv-item">搬我</p><p class="mv-other">别动我</p>'
})
await settle()
ok((await page.evaluate(() => window.__visualRevise.store.stats().moves)) === 1,
   '目标容器失联时记录仍在（提示词照常导出）')

// 只收走 DOM，记录留给下面那组「重置」用例——它要的正是一堆失联记录
await page.evaluate(() => document.getElementById('vr-move')?.remove())
await settle()


// ── 重置要连失联记录一起清 ──────────────────────────────────
// 失联记录的改动冻结在 frozen 里、不跟着 DOM 走，页面还原了它们也不会消失。
// 点了重置却还剩一屏「元素已消失」，等于没重置。
const beforeReset = await stats()
ok(beforeReset.total > 0, `重置前还有 ${beforeReset.total} 条记录（含失联的）`)

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await settle()
const afterReset = await stats()
ok(afterReset.total === 0, `重置后一条不剩（实得 ${afterReset.total}）`)

// 撤销这次重置，失联的那些也要回来——否则重置就成了不可逆操作
await page.evaluate(() => window.__visualRevise.store.undo())
await settle()
const restored = await stats()
ok(restored.total === beforeReset.total,
   `⌘Z 撤销重置后连失联记录一起回来（${restored.total} / ${beforeReset.total}）`)

// 单条「还原」同样要能消掉失联的那一行：它展示的是冻结快照而不是实时 diff，
// 不重算的话页面已经还原了、列表里那行还杵着
const one = await page.evaluate(() => {
  const store = window.__visualRevise.store
  const target = store.read().edits.find(e => e.orphaned)
  if (!target) return null
  store.undoElement(target.id)
  return {
    id: target.id,
    stillListed: store.read().edits.some(e => e.id === target.id),
  }
})
ok(one && !one.stillListed, '点单条「还原」，失联的那一行也会消失')

// ── 观察器的生命周期 ────────────────────────────────────────
// 重锚靠一个 MutationObserver。它早先是 `new MutationObserver(...).observe(...)`
// 一行写完的，谁也拿不到引用——用户点 × 关掉插件之后它仍在观察整个文档树，
// React 每渲染一次就白跑一轮。现在 destroy 会断开它，重新挂载再接回来。
await page.evaluate(() => {
  window.__visualRevise.store.clear()
  window.__visualRevise.destroy()
  document.querySelector('vis-bug')?.remove()
})
await page.waitForTimeout(300)
ok(await page.evaluate(() => !document.querySelector('visual-revise-panel')),
   'destroy 之后面板已卸载')

// 关掉期间发生的 DOM 变动不该再被处理
await rerender('.curve-card')
await settle()

// 重新挂载：observe 是幂等的，接回来之后重锚要照常工作
await page.evaluate(() => {
  const el = document.createElement('vis-bug')
  el.setAttribute('tutsBaseURL', '/__ext/tuts')
  document.body.prepend(el)
})
await page.waitForTimeout(500)
ok(await page.evaluate(() => !!document.querySelector('visual-revise-panel')),
   '重新挂载后面板回来了')

await page.evaluate(() => {
  const el = document.querySelector('.curve-card')
  window.__visualRevise.store.applyProp(el, 'padding-top', '32px')
})
await rerender('.curve-card')
await settle()
const afterRemount = await stats()
ok(afterRemount.props === 1,
   `重新挂载后重锚照常工作（props=${afterRemount.props}）——观察器接回来了`)
ok(await page.evaluate(() => document.querySelector('.curve-card').style.paddingTop) === '32px',
   '改动也重新贴回了新节点')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
