import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serve, launch, injectVisBug, ok, ROOT } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[冒烟测试] fork 后的 VisBug 基础能力\n')

await page.goto(origin)
ok(await page.locator('.curve-card').count() === 3, '测试固件加载正常（3 张卡片）')

await injectVisBug(page, origin)

ok(await page.locator('vis-bug').count() === 1, 'vis-bug 元素已注入')
ok(await page.evaluate(() => !!customElements.get('vis-bug')), 'vis-bug 自定义元素已注册')
ok(await page.evaluate(() => document.querySelector('vis-bug').shadowRoot === null),
   'shadow DOM 为 closed（扩展 UI 与页面隔离）')

// 悬停应产生 hover 指示
const card = page.locator('.curve-card').nth(1)
await card.hover()
await page.waitForTimeout(300)
const hoverEls = await page.evaluate(() =>
  document.querySelectorAll('visbug-hover, visbug-metatip, visbug-handles').length)
ok(hoverEls > 0, `悬停产生视觉反馈（找到 ${hoverEls} 个 visbug-* 元素）`)

// 点击应选中
await card.click()
await page.waitForTimeout(300)
const selected = await page.evaluate(() => ({
  handles: document.querySelectorAll('visbug-handles').length,
  labeled: document.querySelectorAll('[data-label-id]').length,
}))
ok(selected.handles > 0, `点击选中元素（handles=${selected.handles}, 标记元素=${selected.labeled}）`)

// 验证「所有改动都落 inline style」——快照 diff 方案的前提
await page.evaluate(() => {
  const card = document.querySelectorAll('.curve-card')[1]
  card.style.paddingTop = '24px'
})
const inline = await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].getAttribute('style'))
ok(inline?.includes('padding-top'),
   `样式写入 inline style（style="${inline}"）—— 快照 diff 方案成立`)

// VisBug 原有的工具系统仍可用（fork 未破坏上游能力）
const toolOk = await page.evaluate(() => {
  const vb = document.querySelector('vis-bug')
  vb.toolSelected('inspector')
  const after = vb.activeTool
  vb.toolSelected('guides')
  return { switched: after, restored: vb.activeTool }
})
ok(toolOk.switched === 'inspector' && toolOk.restored === 'guides',
   `VisBug 工具切换仍正常（${toolOk.switched} → ${toolOk.restored}）`)

// ── 回归：重复注入不得叠出第二套编辑器 ──
const idempotent = await page.evaluate(() => {
  const before = {
    visbug: document.querySelectorAll('vis-bug').length,
    panel:  document.querySelectorAll('visual-revise-panel').length,
    list:   document.querySelectorAll('visual-revise-list').length,
  }

  // 模拟状态机脱节导致的二次注入
  document.body.prepend(document.createElement('vis-bug'))

  return {
    before,
    after: {
      visbug: document.querySelectorAll('vis-bug').length,
      panel:  document.querySelectorAll('visual-revise-panel').length,
      list:   document.querySelectorAll('visual-revise-list').length,
    },
  }
})
ok(idempotent.after.panel === 1 && idempotent.after.list === 1,
   `二次注入不叠加面板与列表（面板 ${idempotent.before.panel}→${idempotent.after.panel}，` +
   `列表 ${idempotent.before.list}→${idempotent.after.list}）`)

// ── 回归：inject.js 的真实执行路径 ──
// 此前所有用例都直接执行 bundle，绕过了 inject.js，
// 于是它里面跨世界访问 customElements 的缺陷一直没被测到。
const injectSrc = await readFile(join(ROOT, 'extension/toolbar/inject.js'), 'utf8')

const injectResult = await page.evaluate(async ([src, base]) => {
  // 清空已有编辑器，模拟首次注入
  document.querySelectorAll('vis-bug').forEach(el => el.remove())

  const errors = []
  const onErr = e => errors.push(e.message || String(e.error))
  addEventListener('error', onErr)

  // 模拟扩展环境：inject.js 跑在隔离世界，只能拿到 chrome.runtime
  window.chrome = {
    runtime: {
      getURL: path => `${base}/__ext/${path}`,
      onMessage: { addListener: () => {} },
    },
  }

  const run = () => { try { new Function(src)() } catch (e) { errors.push(e.message) } }

  run()                       // 首次注入
  await new Promise(r => setTimeout(r, 600))
  const afterFirst = document.querySelectorAll('vis-bug').length

  run()                       // 重复注入：必须幂等
  await new Promise(r => setTimeout(r, 400))
  const afterSecond = document.querySelectorAll('vis-bug').length

  removeEventListener('error', onErr)
  return { afterFirst, afterSecond, errors }
}, [injectSrc, origin])

ok(injectResult.errors.length === 0,
   `inject.js 执行无异常${injectResult.errors.length ? '：' + injectResult.errors.join('; ') : ''}`)
ok(injectResult.afterFirst === 1, `首次注入创建一个 vis-bug（${injectResult.afterFirst} 个）`)
ok(injectResult.afterSecond === 1,
   `重复注入保持幂等，不叠出第二个（${injectResult.afterSecond} 个）`)

// ── 回归：上次注入失败留下的死元素必须能自愈 ──
// 这正是「点了没反应、刷新前一直卡住」的成因：页面上残留一个从未升级的
// <vis-bug>，而幂等检查只看它存在就跳过注入。
const healed = await page.evaluate(async ([src, base]) => {
  // 造出「有 vis-bug 元素、但编辑器 UI 没起来」的坏状态
  document.querySelectorAll('visual-revise-toolbar, visual-revise-panel, visual-revise-list, visual-revise-comment-layer')
    .forEach(el => el.remove())

  const before = {
    visbug:  document.querySelectorAll('vis-bug').length,
    toolbar: document.querySelectorAll('visual-revise-toolbar').length,
  }

  window.chrome = {
    runtime: {
      getURL: path => `${base}/__ext/${path}`,
      onMessage: { addListener: () => {} },
    },
  }

  const errors = []
  try { new Function(src)() } catch (e) { errors.push(e.message) }
  await new Promise(r => setTimeout(r, 800))

  return {
    before,
    after: {
      visbug:  document.querySelectorAll('vis-bug').length,
      toolbar: document.querySelectorAll('visual-revise-toolbar').length,
    },
    errors,
  }
}, [injectSrc, origin])

ok(healed.before.visbug >= 1 && healed.before.toolbar === 0,
   `坏状态已构造：有 ${healed.before.visbug} 个 vis-bug 但无编辑器 UI`)
ok(healed.errors.length === 0,
   `自愈过程无异常${healed.errors.length ? '：' + healed.errors.join('; ') : ''}`)
ok(healed.after.visbug === 1 && healed.after.toolbar === 1,
   `死元素被清掉并重新注入成功（vis-bug ${healed.after.visbug}，工具条 ${healed.after.toolbar}）`)

// 版本要落到 DOM 上，inject.js 才有得比。
// 它跑在隔离世界，读不到主世界的 window.__visualRevise，
// 但 DOM 是两个世界共用的——这是整套自检的支点。
const buildMark = await page.evaluate(() => ({
  api: window.__visualRevise?.build,
  dom: document.documentElement.dataset.visualReviseBuild,
}))
ok(!!buildMark.dom && buildMark.dom === buildMark.api,
   `构建版本同时写在 api 和 <html> 上，供隔离世界比对（${buildMark.dom}）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
