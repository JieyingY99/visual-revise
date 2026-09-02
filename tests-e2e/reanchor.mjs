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

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
