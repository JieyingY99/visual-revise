import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[页面拖拽测试] 独立套件——指针时序敏感，不与其他用例共享状态\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(300)

// 两个纵向容器 + 一个空容器：既能测同容器内换位，也能测搬进别的容器
const buildZone = () => page.evaluate(() => {
  document.getElementById('dz')?.remove()
  const z = document.createElement('div')
  z.id = 'dz'
  z.style.cssText = 'position:absolute;left:30px;top:620px;display:flex;gap:24px'
  z.innerHTML =
    '<div id="dz-a" style="width:200px;padding:10px;background:#1a1a1f">'
    + '<div class="k" style="height:44px;background:#a55">k0</div>'
    + '<div class="k" style="height:44px;background:#5a5">k1</div></div>'
    + '<div id="dz-b" style="width:200px;height:120px;padding:10px;background:#22222a"></div>'
  document.body.appendChild(z)
})

const kidsOf = id => page.evaluate(x =>
  [...document.getElementById(x).children].map(n => n.textContent.trim()).join(','), id)
const stats = () => page.evaluate(() => window.__visualRevise.store.stats())
const reset = async () => {
  await page.evaluate(() => {
    window.__visualRevise.store.undoEverything()
    window.__visualRevise.store.history.clear()
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

await buildZone()

// ── 拖拽在选择模式下就是开着的，不再挂在「结构」tab 上 ──
const idle = await page.evaluate(() => ({
  active:    window.__visualRevise.layoutDrag.active,
  tab:       document.querySelector('visual-revise-panel').tab,
  styleTag:  !!document.getElementById('visual-revise-drag-hints'),
  // 放宽跨容器限制之后不能再预标记整页容器：那等于给几千个节点一起加
  // outline，整页会闪成一团
  premarked: document.querySelectorAll('[data-vr-drop-target]').length,
  legacy:    document.querySelectorAll('[data-vr-droppable],[data-vr-draggable]').length,
  noInlinePollution: [...document.querySelectorAll('#dz .k')].every(k => !k.getAttribute('style')?.includes('opacity')),
}))
ok(idle.active, '选择模式下页面拖拽默认可用（不再要求切到结构 tab）')
ok(idle.styleTag, '已注入落点提示样式')
ok(idle.premarked === 0 && idle.legacy === 0,
   `拖拽开始前不预标记任何容器（落点 ${idle.premarked}，旧标记 ${idle.legacy}）`)
ok(idle.noInlinePollution, '标记不写 inline style，不污染改动记录')
ok((await stats()).total === 0, '进入页面本身不产生任何改动记录')

// ── 按下不动松开：仍然是「选中」，不是拖拽 ──
const k0 = await page.locator('#dz .k').nth(0).boundingBox()
await page.mouse.move(k0.x + 90, k0.y + 22)
await page.mouse.down()
await page.mouse.move(k0.x + 92, k0.y + 23)   // 2px，没到 4px 的阈值
await page.mouse.up()
await page.waitForTimeout(400)

const tapped = await page.evaluate(() => ({
  selected: document.querySelectorAll('[data-selected]').length,
  text:     document.querySelector('[data-selected]')?.textContent.trim(),
  tab:      document.querySelector('visual-revise-panel').tab,
  moves:    window.__visualRevise.store.stats().moves,
}))
ok(tapped.selected === 1 && tapped.text === 'k0',
   `按下不动松开仍是选中（选中了「${tapped.text}」）`)
ok(tapped.tab === 'props', '选中后停在属性 tab——拖拽不再需要切 tab')
ok(tapped.moves === 0, '没越过阈值就不算一次移动')

// ── 属性 tab 下按住拖 ≥4px：同容器内换位 ──
// 刚选中的元素上浮着 visbug-handles，从它身上起拖是最常见的情形
const k1 = await page.locator('#dz .k').nth(1).boundingBox()
await page.mouse.move(k1.x + 90, k1.y + 22)
await page.mouse.down()
await page.mouse.move(k1.x + 90, k1.y + 10, { steps: 4 })
await page.mouse.move(k0.x + 90, k0.y + 4, { steps: 8 })   // k0 的上 1/3
await page.waitForTimeout(200)

const mid = await page.evaluate(() => {
  const g = document.getElementById('visual-revise-drag-ghost')
  const bar = document.getElementById('visual-revise-drop-indicator')
  return {
    ghost:     g ? { left: parseFloat(g.style.left), top: parseFloat(g.style.top), tag: g.tagName,
                     isOwnUI: g.hasAttribute('data-visual-revise-ui'),
                     pointerEvents: g.style.pointerEvents } : null,
    indicator: bar?.style.display,
    opacity:   document.querySelectorAll('#dz .k')[1].style.opacity,
    marked:    [...document.querySelectorAll('[data-vr-drop-target]')].map(el => el.id),
    dragging:  window.__visualRevise.layoutDrag.dragging,
  }
})
ok(mid.dragging && mid.opacity === '0.25',
   `越过阈值才真的开始拖（dragging=${mid.dragging}，被拖元素压暗 ${mid.opacity}）`)
ok(!!mid.ghost && mid.ghost.tag === 'DIV', '拖拽时生成拖影（被拖元素的克隆）')
ok(mid.ghost?.isOwnUI && mid.ghost?.pointerEvents === 'none',
   '拖影标记为编辑器 UI 且不拦截指针（不会被自己命中）')
ok(mid.indicator === 'block', '插入位置有指示线')
ok(mid.marked.join() === 'dz-a', `只高亮当前悬停的落点容器（${JSON.stringify(mid.marked)}）`)

await page.mouse.move(k0.x + 60, k0.y + 2, { steps: 3 })
await page.waitForTimeout(120)
const ghost2 = await page.evaluate(() => {
  const g = document.getElementById('visual-revise-drag-ghost')
  return g ? { left: parseFloat(g.style.left), top: parseFloat(g.style.top) } : null
})
ok(ghost2 && ghost2.left < mid.ghost.left, '拖影跟随指针移动')

await page.mouse.up()
await page.waitForTimeout(400)

const swapped = await page.evaluate(() => ({
  kids:   [...document.getElementById('dz-a').children].map(n => n.textContent.trim()).join(','),
  orders: [...document.querySelectorAll('#dz .k')].map(k => k.style.order).join('|'),
  moves:  window.__visualRevise.store.stats().moves,
  props:  window.__visualRevise.store.stats().props,
  selected: document.querySelector('[data-selected]')?.textContent.trim(),
  indicator: document.getElementById('visual-revise-drop-indicator')?.style.display,
  marked: document.querySelectorAll('[data-vr-drop-target]').length,
}))
ok(swapped.kids === 'k1,k0', `拖到目标上 1/3 → 插到它前面（#dz-a = ${swapped.kids}）`)
ok(/^\|*$/.test(swapped.orders), `真的搬了 DOM 节点，一个 CSS order 都没写（order = "${swapped.orders}"）`)
ok(swapped.moves === 1 && swapped.props === 0,
   `记成一条移动而不是一堆属性改动（moves=${swapped.moves} props=${swapped.props}）`)
ok(swapped.selected === 'k1',
   `松手后被移动的元素仍是选中态（「${swapped.selected}」）——那次 click 被拖拽吞掉了`)
ok(swapped.indicator === 'none' && swapped.marked === 0, '松手后指示线与落点高亮都收掉')

// ⌘Z 一次退回整次移动
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Meta+z')
await page.waitForTimeout(400)
ok(await kidsOf('dz-a') === 'k0,k1', `⌘Z 一次撤回整次移动（#dz-a = ${await kidsOf('dz-a')}）`)
await page.keyboard.press('Meta+Shift+z')
await page.waitForTimeout(400)
ok(await kidsOf('dz-a') === 'k1,k0', '⌘⇧Z 重做')

await reset()

// ── 跨容器：搬进另一个（非 flex/grid 的空）容器 ──
const kk = await page.locator('#dz .k').nth(0).boundingBox()
const zb = await page.locator('#dz-b').boundingBox()
await page.mouse.move(kk.x + 90, kk.y + 22)
await page.mouse.down()
await page.mouse.move(kk.x + 90, kk.y + 34, { steps: 4 })
await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2, { steps: 10 })
await page.waitForTimeout(200)
const overEmpty = await page.evaluate(() =>
  [...document.querySelectorAll('[data-vr-drop-target]')].map(el => el.id).join())
ok(overEmpty === 'dz-b', `悬停在空容器上时它被标成落点（${overEmpty}）`)
await page.mouse.up()
await page.waitForTimeout(400)

ok(await kidsOf('dz-b') === 'k0' && await kidsOf('dz-a') === 'k1',
   `跨容器搬家：#dz-b = ${await kidsOf('dz-b')}，#dz-a = ${await kidsOf('dz-a')}`)
ok((await stats()).moves === 1, '跨容器移动记入 moves')

await reset()

// ── 拖到一半按 Esc 取消 ──
const c0 = await page.locator('#dz .k').nth(0).boundingBox()
await page.mouse.move(c0.x + 90, c0.y + 22)
await page.mouse.down()
await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2, { steps: 8 })
await page.waitForTimeout(150)
await page.keyboard.press('Escape')
await page.mouse.up()
await page.waitForTimeout(300)

const cancelled = await page.evaluate(() => ({
  a: [...document.getElementById('dz-a').children].map(n => n.textContent.trim()).join(','),
  b: document.getElementById('dz-b').children.length,
  ghost: !!document.getElementById('visual-revise-drag-ghost'),
  indicator: document.getElementById('visual-revise-drop-indicator')?.style.display,
  opacities: [...document.querySelectorAll('#dz .k')].map(k => k.style.opacity).join('|'),
  total: window.__visualRevise.store.stats().total,
}))
ok(cancelled.a === 'k0,k1' && cancelled.b === 0, `Esc 取消，DOM 回到拖之前（#dz-a = ${cancelled.a}）`)
ok(!cancelled.ghost && cancelled.indicator === 'none', '取消后拖影与指示线都清掉')
ok(cancelled.opacities === '|', '取消后透明度还原')
ok(cancelled.total === 0, `取消不落下任何改动（${cancelled.total} 项）`)

// ── 反复中断不累积副作用 ──
// 每次中断若留下未解绑的 pointermove/pointerup，后续每个指针事件都会
// 白跑一遍旧处理器；这里断言十轮中断后 store 与 DOM 均无残留。
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.__visualRevise.setReorderMode(true))
  const b = await page.locator('#dz .k').nth(1).boundingBox()
  await page.mouse.move(b.x + 90, b.y + 22)
  await page.mouse.down()
  await page.mouse.move(b.x + 90, b.y - 30, { steps: 3 })
  await page.waitForTimeout(40)
  await page.evaluate(() => window.__visualRevise.setReorderMode(false))
  await page.mouse.up()
  await page.waitForTimeout(40)
}

const residue = await page.evaluate(() => ({
  total:     window.__visualRevise.store.stats().total,
  a:         [...document.getElementById('dz-a').children].map(n => n.textContent.trim()).join(','),
  opacities: [...document.querySelectorAll('#dz .k')].map(k => k.style.opacity).join('|'),
  indicator: document.getElementById('visual-revise-drop-indicator')?.style.display,
  ghost:     !!document.getElementById('visual-revise-drag-ghost'),
  active:    window.__visualRevise.layoutDrag.active,
  marked:    document.querySelectorAll('[data-vr-drop-target]').length,
  styleTag:  !!document.getElementById('visual-revise-drag-hints'),
}))
ok(residue.total === 0 && residue.a === 'k0,k1', `十轮中断后无改动残留（${residue.total} 项）`)
ok(residue.opacities === '|', '十轮中断后无透明度残留')
ok(!residue.ghost && residue.indicator === 'none', '十轮中断后无拖影 / 指示线残留')
ok(residue.active === false && residue.marked === 0 && !residue.styleTag,
   '关掉之后拖拽停用、落点标记与提示样式都清掉')

// 之后仍能正常拖拽
await page.evaluate(() => window.__visualRevise.setReorderMode(true))
await page.waitForTimeout(250)
const r1 = await page.locator('#dz .k').nth(1).boundingBox()
const r0 = await page.locator('#dz .k').nth(0).boundingBox()
await page.mouse.move(r1.x + 90, r1.y + 22)
await page.mouse.down()
await page.mouse.move(r0.x + 90, r0.y + 4, { steps: 10 })
await page.waitForTimeout(150)
await page.mouse.up()
await page.waitForTimeout(400)
ok(await kidsOf('dz-a') === 'k1,k0',
   `十轮中断之后拖拽仍能正常提交（#dz-a = ${await kidsOf('dz-a')}）`)

// ── 不能拖进自己或自己的后代 ──
const nested = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const a = document.getElementById('dz-a')
  return {
    self:  s.moveElement(a, a, null),
    child: s.moveElement(a, a.querySelector('.k'), null),
    root:  s.moveElement(a, document.documentElement, null),
  }
})
ok(!nested.self && !nested.child && !nested.root,
   `拖进自己 / 后代 / <html> 一律拒绝（${JSON.stringify(nested)}）`)

// ── 提示词必须把「搬家」表达成结构改动，而不是一串坐标 ──
await reset()
await buildZone()
await page.evaluate(() => {
  const s = window.__visualRevise.store
  s.moveElement(document.querySelector('#dz-a .k'), document.getElementById('dz-b'), null)
  const title = document.querySelector('.hero-title')
  s.track(title)
  s.applyProp(title, 'font-size', '52px')   // 混入一条普通样式改动
})
await page.waitForTimeout(300)

const prompt = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
ok(prompt.includes('## 移动的元素'), '提示词含「移动的元素」段落')
const moveSection = prompt.slice(prompt.indexOf('## 移动的元素'))
ok(/- 从：.*dz-a/.test(moveSection) && /- 到：.*dz-b/.test(moveSection),
   `from / to 两头都给了容器选择器：${moveSection.split('\n').filter(l => /^- (从|到)：/.test(l)).join(' ／ ')}`)
ok(/- 选择器：/.test(moveSection) && /- 文本特征：/.test(moveSection),
   '被移动的元素本身也给了定位锚点')
ok(prompt.includes('不要用 CSS `order`') && prompt.includes('键盘 Tab'),
   '说明了为什么要改源码结构而不是拿 CSS 模拟')
ok(prompt.includes('font-size'), '同时存在的普通样式改动不受影响')
ok(/改动：1 处元素样式，1 处移动/.test(prompt),
   `摘要分别统计两类改动：${prompt.split('\n').find(l => l.startsWith('改动：'))}`)

// 只做了移动、什么样式都没改时，复制按钮不该报「还没有任何改动」
await reset()
await buildZone()
const onlyMove = await page.evaluate(async () => {
  const s = window.__visualRevise.store
  s.moveElement(document.querySelector('#dz-a .k'), document.getElementById('dz-b'), null)
  const md = window.__visualRevise.lib.buildPrompt(s.read())
  return { len: md.length, hasSection: md.includes('## 移动的元素') }
})
ok(onlyMove.len > 0 && onlyMove.hasSection,
   `只做了移动也能生成提示词（${onlyMove.len} 字符）——否则复制会报 empty`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
