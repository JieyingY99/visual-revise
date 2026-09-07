// 独立复现 4.6.13：在上游 Search 输入框里打字是否会丢字符
//
// 只做三件事：
//   A 对照组——页面上一个普通 <input> 里打 "images"，验证「用户正在输入时
//     单字母热键让路」（AC-4.2）在 light DOM 下确实生效；
//   B 复现组——⌘/ 唤出上游工具条，真实鼠标点 search 按钮，往它的输入框里
//     打同一串 "images"，读回值；
//   C 旁证——记录 keydown 被 defaultPrevented 的键，以及 'l' 是否顺手把
//     改动记录面板掀开了。
//
// 一律真实指针 / 真实键盘：按钮位置用 getBoundingClientRect 量，点击走
// page.mouse.click，输入走 page.keyboard.type，不碰 element.click()。
import { serve, launch, injectVisBug, ok } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const T = (cond, msg) => ok(cond, msg)

await page.goto(`${origin}/full/fixtures/drag-guides-upstream-tools.html`)
await injectVisBug(page, origin)
await page.waitForFunction(() => !!window.__visualRevise, null, { timeout: 10000 })
await page.waitForTimeout(300)

// 记录哪些按键被 Visual Revise 吞掉。探针也挂在 document 捕获阶段：
// 它注册得比 Visual Revise 晚，所以在同一节点上排在它后面跑；
// stopPropagation 不影响同节点的后续监听，defaultPrevented 已经能读到。
// （挂冒泡阶段读不到——stopPropagation 让事件根本传不到那一步。）
await page.evaluate(() => {
  window.__eaten = []
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented) window.__eaten.push(e.key)
  }, true)
})

// ── A 对照组：页面里的普通输入框 ────────────────────────────
await page.evaluate(() => {
  const i = document.createElement('input')
  i.id = 'plain'
  i.style.cssText = 'position:fixed; left:400px; top:600px; width:220px; height:32px; z-index:10'
  document.body.appendChild(i)
})
{
  const b = await page.locator('#plain').boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await page.waitForTimeout(200)
  await page.keyboard.type('images', { delay: 40 })
  await page.waitForTimeout(300)
  const v = await page.evaluate(() => document.getElementById('plain').value)
  T(v === 'images', `A 对照组：页面 light DOM 输入框里打 images → 框里是「${v}」`)
  await page.evaluate(() => { document.getElementById('plain').blur(); document.getElementById('plain').remove() })
  await page.waitForTimeout(150)
}

// ── B 复现组：上游工具条的 search 输入框 ────────────────────
await page.evaluate(() => { window.__eaten = [] })
await page.keyboard.press('Meta+Slash')
await page.waitForFunction(() => document.querySelector('vis-bug').style.display === 'block',
  null, { timeout: 3000, polling: 30 })
// 工具条是滑进来的，动画没停就去量位置会量到屏幕外
await page.waitForFunction(() => {
  const vb = document.querySelector('vis-bug')
  const li = vb.$shadow.querySelector('li[data-tool="guides"]')
  const running = (vb.getAnimations?.() || []).some(a => a.playState === 'running')
  return !running && li.getBoundingClientRect().left >= 0
}, null, { timeout: 5000, polling: 30 })

const p = await page.evaluate(() => {
  const li = document.querySelector('vis-bug').$shadow.querySelector('li[data-tool="search"]')
  const r = li.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await page.mouse.click(p.x, p.y)
await page.waitForFunction(() => document.querySelector('vis-bug').activeTool === 'search',
  null, { timeout: 3000, polling: 30 })
await page.waitForTimeout(300)

const shadowRootIsClosed = await page.evaluate(() => document.querySelector('vis-bug').shadowRoot === null)
const focused = await page.evaluate(() => {
  const input = document.querySelector('vis-bug').$shadow.querySelector('li[data-tool="search"] input')
  return !!input && document.querySelector('vis-bug').$shadow.activeElement === input
})
T(focused, `search 激活后输入框拿到焦点（activeElement 就是它：${focused}）`)
T(shadowRootIsClosed, `<vis-bug> 的 shadow root 是 closed（element.shadowRoot === null：${shadowRootIsClosed}）`)

// 事件跨 closed shadow 边界后，document 上看到的 composedPath()[0] 是谁？
const seen = await page.evaluate(() => new Promise(resolve => {
  const input = document.querySelector('vis-bug').$shadow.querySelector('li[data-tool="search"] input')
  const probe = e => {
    document.removeEventListener('keydown', probe, true)
    resolve({
      pathHead: e.composedPath()[0]?.tagName || String(e.composedPath()[0]),
      target: e.target?.tagName,
      pathLen: e.composedPath().length,
    })
  }
  document.addEventListener('keydown', probe, true)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }))
}))
T(seen.pathHead === 'VIS-BUG',
  `document 捕获阶段读到的 composedPath()[0] = ${seen.pathHead}（target=${seen.target}，路径长 ${seen.pathLen}）`
  + ` → isTypingTarget 判 INPUT/TEXTAREA/contentEditable 一个都判不中`)

const searchValue = () => page.evaluate(() => document.querySelector('vis-bug').$shadow
  .querySelector('li[data-tool="search"] input')?.value ?? '')

const listHiddenBefore = await page.evaluate(() =>
  document.querySelector('visual-revise-list')?.hidden ?? null)

await page.keyboard.type('images', { delay: 60 })
await page.waitForTimeout(500)

const got = await searchValue()
const eaten = await page.evaluate(() => window.__eaten)
const listHiddenAfter = await page.evaluate(() =>
  document.querySelector('visual-revise-list')?.hidden ?? null)

T(got === 'images', `B 复现组：上游 search 输入框里打 images → 框里是「${got}」`)
console.log(`  · 被 preventDefault 掉的键：${JSON.stringify(eaten)}`)
console.log(`  · 打字后当前模式：${await page.evaluate(() => window.__visualRevise?.mode ?? '(读不到)')}`)

// ── C 逐键旁证：a / f / v / c / l / p 各自会被吞掉吗 ───────────
const perKey = {}
for (const k of ['a', 'f', 'v', 'c', 'l', 'p', 'b', 'g']) {
  // 每轮先把输入框清空、重新聚焦（模式热键可能已经把焦点搬走了）
  await page.evaluate(() => {
    const i = document.querySelector('vis-bug').$shadow.querySelector('li[data-tool="search"] input')
    i.value = ''
    i.focus()
  })
  await page.waitForTimeout(120)
  await page.keyboard.type(k, { delay: 40 })
  await page.waitForTimeout(180)
  perKey[k] = await searchValue()
}
console.log(`  · 逐键打进 search 框后框里的内容：${JSON.stringify(perKey)}`)

const swallowed = Object.entries(perKey).filter(([k, v]) => v !== k).map(([k]) => k)
const survived = Object.entries(perKey).filter(([k, v]) => v === k).map(([k]) => k)
T(swallowed.length === 0,
  `每个字母都应原样落进输入框——被吞掉的：[${swallowed.join(' ')}]，正常的：[${survived.join(' ')}]`)
console.log(`  · 改动记录面板 hidden：${listHiddenBefore} → ${listHiddenAfter}`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
