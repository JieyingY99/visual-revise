// 独立复现脚本 · 清单 2.13.1
//
// 报告称：结构树头部的关闭 × 是死按钮 —— 点它只 #emit('vr-tree-close')
// （app/components/tree/tree.element.js:154-155），全仓没有任何
// addEventListener('vr-tree-close')，点下去 UI 毫无变化。
//
// 期望依据：docs/PRD.md AC-2.10 —— 「属性面板与结构树的 × 都只收起自己那块
// UI，不改变当前模式」。也就是说这个 × 按 PRD 本该起作用，不是「有意留空」。
//
// 本脚本不复用 tests-e2e/full/tree.mjs 的任何断言，全部自己重新测；
// 全程真实指针（locator.click / page.mouse），不用 element.click() / dispatchEvent。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const log = (...a) => console.log(...a)

await page.goto(`${origin}/fixture.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

log('\n=== 2.13.1 结构树头部的 × · 独立复现 ===\n')

// ══════════════════════════════════════════════════════════
// A. 产品形态：树只以 embedded 挂在属性面板里，树头是否可见
// ══════════════════════════════════════════════════════════
log('--- A. 产品里的真实形态（embedded）---')
await page.locator('.card-title').first().click({ position: { x: 8, y: 8 } })
await page.waitForTimeout(500)

// 切到「结构」tab（F），让树真的挂上来
await page.keyboard.press('f')
await page.waitForTimeout(500)

const embedded = await page.evaluate(() => {
  const panel = document.querySelector('visual-revise-panel')
  const t = panel?.shadowRoot?.querySelector('visual-revise-tree')
  if (!t) return { mounted: false }
  const head = t.shadowRoot.querySelector('.tree-head')
  const btn = t.shadowRoot.querySelector('.tree-close')
  const hb = btn?.getBoundingClientRect()
  return {
    mounted: true,
    embeddedAttr: t.hasAttribute('embedded'),
    headDisplay: getComputedStyle(head).display,
    btnExists: !!btn,
    btnBox: hb ? { w: hb.width, h: hb.height } : null,
    // 用户的鼠标落在那个坐标上，命中的是谁（藏起来的按钮 hit-test 不到）
    hitTest: hb && hb.width
      ? (document.elementFromPoint(hb.x + hb.width / 2, hb.y + hb.height / 2)?.tagName ?? null)
      : 'no-box',
  }
})
log('[embedded 树头]', JSON.stringify(embedded))
log(`==> A：产品形态下树头${embedded.headDisplay === 'none' ? '不可见（用户点不到这个 ×）' : '可见'}`)

// ══════════════════════════════════════════════════════════
// B. 独立浮层形态：真实点那个 ×，看事件与 UI
// ══════════════════════════════════════════════════════════
log('\n--- B. 独立浮层形态（非 embedded），真实鼠标点 × ---')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await page.evaluate(() => {
  window.__vrClose = 0
  window.__vrCloseOnDoc = 0
  // 文档级监听：证明事件确实 bubbles+composed 冒到了宿主能看到的层
  document.addEventListener('vr-tree-close', () => window.__vrCloseOnDoc++)
  const t = document.createElement('visual-revise-tree')
  t.id = 'vr-solo-tree'
  t.addEventListener('vr-tree-close', () => window.__vrClose++)
  document.body.appendChild(t)
})
await page.waitForTimeout(400)

const before = await page.evaluate(() => {
  const t = document.getElementById('vr-solo-tree')
  const cs = getComputedStyle(t)
  return {
    isConnected: t.isConnected,
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    hiddenAttr: t.hasAttribute('hidden'),
    rows: t.shadowRoot.querySelectorAll('.row').length,
    box: (b => ({ w: Math.round(b.width), h: Math.round(b.height) }))(t.getBoundingClientRect()),
  }
})
log('[点之前]', JSON.stringify(before))

// 真实鼠标：拿到 × 的屏幕坐标，mouse.move + down + up
const btnBox = await page.evaluate(() => {
  const b = document.getElementById('vr-solo-tree').shadowRoot
    .querySelector('.tree-close').getBoundingClientRect()
  return { x: b.x, y: b.y, w: b.width, h: b.height }
})
log('[× 的屏幕坐标]', JSON.stringify(btnBox))
const cx = btnBox.x + btnBox.w / 2
const cy = btnBox.y + btnBox.h / 2
log('[鼠标落点命中]', await page.evaluate(([x, y]) => {
  const top = document.elementFromPoint(x, y)
  let n = top, path = []
  while (n) { path.push(n.tagName + (n.className && typeof n.className === 'string' ? '.' + n.className : '')); n = n.shadowRoot?.elementFromPoint?.(x, y) ?? null }
  return path.join(' > ')
}, [cx, cy]))

await page.mouse.move(cx, cy)
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(600)

const after = await page.evaluate(() => {
  const t = document.getElementById('vr-solo-tree')
  if (!t) return { fired: window.__vrClose, onDoc: window.__vrCloseOnDoc, gone: true }
  const cs = getComputedStyle(t)
  return {
    fired: window.__vrClose,
    onDoc: window.__vrCloseOnDoc,
    gone: false,
    isConnected: t.isConnected,
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    hiddenAttr: t.hasAttribute('hidden'),
    rows: t.shadowRoot.querySelectorAll('.row').length,
    box: (b => ({ w: Math.round(b.width), h: Math.round(b.height) }))(t.getBoundingClientRect()),
  }
})
log('[点之后]', JSON.stringify(after))

const fired = after.fired === 1 && after.onDoc === 1
const stillVisible = !after.gone && after.isConnected &&
  after.display !== 'none' && after.visibility !== 'hidden' &&
  !after.hiddenAttr && after.box.h > 0
log(`==> B1：× 确实派发了 vr-tree-close（自身 ${after.fired} 次 / 冒泡到 document ${after.onDoc} 次）= ${fired}`)
log(`==> B2：点完树仍原样挂着、可见 = ${stillVisible}`)

// ══════════════════════════════════════════════════════════
// C. 对照：不挂自己的监听时也一样 —— 证明「宿主里没人接」
// ══════════════════════════════════════════════════════════
log('\n--- C. 对照组：一个谁都不挂监听的独立树 ---')
await page.evaluate(() => document.getElementById('vr-solo-tree')?.remove())
await page.evaluate(() => {
  const t = document.createElement('visual-revise-tree')
  t.id = 'vr-bare-tree'
  document.body.appendChild(t)          // 只挂进 body，不加任何监听
})
await page.waitForTimeout(400)
const bareBox = await page.evaluate(() => {
  const b = document.getElementById('vr-bare-tree').shadowRoot
    .querySelector('.tree-close').getBoundingClientRect()
  return { x: b.x, y: b.y, w: b.width, h: b.height }
})
await page.mouse.move(bareBox.x + bareBox.w / 2, bareBox.y + bareBox.h / 2)
await page.mouse.down(); await page.mouse.up()
await page.waitForTimeout(600)
const bare = await page.evaluate(() => {
  const t = document.getElementById('vr-bare-tree')
  if (!t) return { gone: true }
  const cs = getComputedStyle(t)
  return {
    gone: false, isConnected: t.isConnected, display: cs.display,
    hiddenAttr: t.hasAttribute('hidden'),
    h: Math.round(t.getBoundingClientRect().height),
  }
})
log('[裸树点完]', JSON.stringify(bare))
const bareStill = !bare.gone && bare.isConnected && bare.display !== 'none' && !bare.hiddenAttr && bare.h > 0
log(`==> C：宿主自己没有任何 vr-tree-close 处理，树纹丝不动 = ${bareStill}`)

// ══════════════════════════════════════════════════════════
// D. 对照：属性面板的 × 派发 vr-close，宿主是接的（同款按钮该有的样子）
// ══════════════════════════════════════════════════════════
log('\n--- D. 对照：属性面板头部的 × 点了有没有效果 ---')
await page.evaluate(() => document.getElementById('vr-bare-tree')?.remove())
await page.locator('.card-title').first().click({ position: { x: 8, y: 8 } })
await page.waitForTimeout(500)
const panelBefore = await page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  return p ? { there: true, h: Math.round(p.getBoundingClientRect().height), hidden: p.hasAttribute('hidden') } : { there: false }
})
log('[面板 · 点前]', JSON.stringify(panelBefore))
const pbtn = await page.evaluate(() => {
  const b = document.querySelector('visual-revise-panel')?.shadowRoot
    ?.querySelector('header .icon-btn.close')?.getBoundingClientRect()
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null
})
if (pbtn) {
  await page.mouse.move(pbtn.x + pbtn.w / 2, pbtn.y + pbtn.h / 2)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(600)
  const panelAfter = await page.evaluate(() => {
    const p = document.querySelector('visual-revise-panel')
    return p ? { there: true, h: Math.round(p.getBoundingClientRect().height), hidden: p.hasAttribute('hidden') } : { there: false }
  })
  log('[面板 · 点后]', JSON.stringify(panelAfter))
  log(`==> D：面板的 × 真的收起了面板 = ${!panelAfter.there || panelAfter.hidden || panelAfter.h === 0}`)
} else {
  log('[跳过] 面板头部没找到 .icon-btn.close')
}

log('\n================ 结论 ================')
log('A  产品形态（embedded）树头 display  :', embedded.headDisplay)
log('B1 × 点下去确实派发 vr-tree-close    :', fired)
log('B2 点完树仍在、仍可见（没人接）      :', stillVisible)
log('C  裸树（无任何监听）同样纹丝不动    :', bareStill)
log('=====================================\n')

await browser.close(); await close()
