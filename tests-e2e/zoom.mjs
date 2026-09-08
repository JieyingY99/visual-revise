// 网页缩放时编辑器 UI 固定不动：面板 / 工具条 / 改动列表 / 弹层反向缩回屏幕原大，
// 贴边距离按倍数换算；拖过的按屏幕坐标放回。缩放倍数由扩展经
// <html data-visual-revise-zoom> 转交，这里直接改属性、抛事件来模拟。
//
// 对应功能清单 v2 §10（10.1.1–10.6.4）与 PRD 的 AC-5.11 / 5.12 / 5.13 / 5.14 / 5.15。
// 10.1.1（扩展进程 tabs.getZoom / onZoomChange）需要真实扩展环境，
// 走独立脚本（scratchpad/ext-zoom-a.mjs），不进本套件。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('[pageerror]', e.message))
await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(300)

let pass = 0, fail = 0
const T = (name, cond, detail = '') => {
  cond ? pass++ : fail++
  ok(cond, `${name}${cond ? '' : `  ← ${detail}`}`)
}
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol
const r3 = n => Math.round(n * 1000) / 1000

const zoom = k => page.evaluate(k => {
  document.documentElement.dataset.visualReviseZoom = String(k)
  window.dispatchEvent(new CustomEvent('visual-revise:zoom', { detail: k }))
}, k)
const rect = sel => page.evaluate(sel => {
  const el = document.querySelector(sel)
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
    transform: el.style.transform, origin: el.style.transformOrigin, maxHeight: el.style.maxHeight,
    vw: innerWidth, vh: innerHeight }
}, sel)
const P = sel => page.locator(`visual-revise-panel ${sel}`)
const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.click(); await page.waitForTimeout(350) }
// 弹层宿主挂在 body 上，内容在 shadow root 里
const popBox = id => page.evaluate(x => {
  const h = document.getElementById(x)
  if (!h) return null
  const r = h.getBoundingClientRect()
  return { transform: h.style.transform, origin: h.style.transformOrigin,
    left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}, id)
// 面板里的锚点在 shadow root 里，querySelector 不跨 shadow
const anchorBox = sel => page.evaluate(s => {
  const el = document.querySelector('visual-revise-panel').shadowRoot.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }
}, sel)
const closePop = async () => {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => ['visual-revise-menu', 'visual-revise-select-panel',
      'visual-revise-color-panel', 'visual-revise-fill-panel'].some(x => !!document.getElementById(x)))
    if (!open) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  }
}

// ══════════════════════════════════════════════════════════════
// §A 倍数 1：不写任何 inline，交还样式表（10.2.1 / 10.2.3 / 10.6.1）
// ══════════════════════════════════════════════════════════════
await page.locator('.hero-title').click(); await page.waitForTimeout(400)
const p1 = await rect('visual-revise-panel')
const t1 = await rect('visual-revise-toolbar')
T('10.2.1/10.2.2 缩放 1：面板无 transform、右上角贴边 16/88', p1.transform === '' && near(p1.vw - p1.right, 16) && near(p1.top, 88),
  JSON.stringify(p1))
T('10.2.3 缩放 1：面板不写 inline max-height（留给样式表 calc(100vh-104px)）',
  p1.maxHeight === '', `期望 ""，实际 "${p1.maxHeight}"`)
const noVars = await page.evaluate(() => !!document.getElementById('visual-revise-zoom-vars'))
T('10.6.1 缩放 1：不留 visual-revise-zoom-vars 样式表', noVars === false, `期望无该 <style>，实际 ${noVars}`)

// ══════════════════════════════════════════════════════════════
// §B 倍数 1.5：三块 fixed UI 反向缩回屏幕原大（10.2.1–10.2.3 / 10.3.1 / 10.4.1 / 10.4.3）
// ══════════════════════════════════════════════════════════════
await zoom(1.5); await page.waitForTimeout(200)
const p2 = await rect('visual-revise-panel')
T('10.2.1 缩放 1.5：面板 scale(1/1.5)，原点右上', /scale\(0\.66/.test(p2.transform) && p2.origin === 'right top', `${p2.transform} / ${p2.origin}`)
T('10.2.2 缩放 1.5：面板屏幕宽度不变（300/1.5 CSS px）', near(p2.width, p1.width / 1.5), `${p2.width} vs ${p1.width / 1.5}`)
T('10.2.2 缩放 1.5：面板右上角屏幕位置不变（16/1.5、88/1.5）',
  near(p2.vw - p2.right, 16 / 1.5) && near(p2.top, 88 / 1.5), `right gap ${p2.vw - p2.right} top ${p2.top}`)
const wantMaxH = r3(p2.vh * 1.5 - 104)
T('10.2.3 缩放 1.5：面板 max-height 里的 100vh 乘回 k（innerHeight×1.5−104）',
  near(parseFloat(p2.maxHeight), wantMaxH, 1), `期望 ${wantMaxH}px，实际 ${p2.maxHeight}`)
const t2 = await rect('visual-revise-toolbar')
T('10.3.1 缩放 1.5：工具条 translateX(-50%) scale 组合、原点顶部中点',
  /translateX\(-50%\) scale\(0\.66/.test(t2.transform) && t2.origin === 'center top', `${t2.transform} / ${t2.origin}`)
T('10.3.1 缩放 1.5：工具条仍居中、顶边 20/1.5、屏幕高度不变',
  near((t2.left + t2.right) / 2, t2.vw / 2) && near(t2.top, 20 / 1.5) && near(t2.height, t1.height / 1.5),
  `center ${(t2.left + t2.right) / 2} vs ${t2.vw / 2}; top ${t2.top}; h ${t2.height} vs ${t1.height / 1.5}`)

// 选中框的把手、标签：贴着元素走但保持屏幕原大（尺寸乘 1/k）
const marks = () => page.evaluate(() => {
  // 上游组件用 closed shadow root，自己那份挂在 $shadow 上
  const handles = document.querySelector('visbug-handles')
  const h = (handles?.$shadow || handles?.shadowRoot)?.querySelector('visbug-handle')
  const btn = (h?.$shadow || h?.shadowRoot)?.querySelector('button')
  const lab = document.querySelector('visbug-label')
  const label = (lab?.$shadow || lab?.shadowRoot)?.querySelector('span')
  const style = document.getElementById('visual-revise-zoom-vars')
  const before = btn ? getComputedStyle(btn, '::before') : null
  return { grip: btn ? parseFloat(getComputedStyle(btn).width) : null, gripBorder: btn ? parseFloat(getComputedStyle(btn).borderTopWidth) : null,
    inset: before ? parseFloat(before.top) : null,
    label: label ? parseFloat(getComputedStyle(label).fontSize) : null, rule: style?.textContent ?? null }
})
const m15 = await marks()
// 描边算出来 .67px，Chrome 会把边框吸到整设备像素：DPR 1 下显示 1px，真实缩放（DPR 1.5）下正好 1 设备像素
T('10.6.2 缩放 1.5：把手圆点 8px→5.33、描边不超过 1px、标签字号 12.8→8.53（屏幕原大）',
  m15.grip != null && near(m15.grip, 8 / 1.5, .2) && m15.gripBorder <= 1 && (m15.label == null || near(m15.label, 12.8 / 1.5, .3)) && /--vr-inv-zoom: 0\.667/.test(m15.rule || ''),
  JSON.stringify(m15))
T('10.6.2 缩放 1.5：把手命中区 inset 也乘 1/k（-0.5rem×0.667 = -5.336px）',
  m15.inset != null && near(m15.inset, -8 / 1.5, .1), `期望 -5.336px，实际 ${m15.inset}px`)

// 改动列表：显示后应同样贴边 88/304
await page.evaluate(() => { document.querySelector('visual-revise-list').hidden = false })
await page.waitForTimeout(150)
const l2 = await rect('visual-revise-list')
T('10.4.1 缩放 1.5：改动列表 scale、右上角 304/1.5、88/1.5',
  /scale\(0\.66/.test(l2.transform) && near(l2.vw - l2.right, 304 / 1.5) && near(l2.top, 88 / 1.5),
  `${l2.transform} gap ${l2.vw - l2.right} top ${l2.top}`)
T('10.4.3 缩放 1.5：改动列表 max-height 同样乘回 k（innerHeight×1.5−104）',
  near(parseFloat(l2.maxHeight), wantMaxH, 1), `期望 ${wantMaxH}px，实际 ${l2.maxHeight}`)
await page.evaluate(() => { document.querySelector('visual-revise-list').hidden = true })

// ══════════════════════════════════════════════════════════════
// §C 贴在页面元素上的物件：位置跟着页面走、线宽 / 圆点 / 字号乘 --vr-inv-zoom
//    （10.6.1 / 10.6.3 / 10.6.4）
// ══════════════════════════════════════════════════════════════
const varStyle = await page.evaluate(() => {
  const s = document.getElementById('visual-revise-zoom-vars')
  return s && { parent: s.parentElement.tagName, ui: s.hasAttribute('data-visual-revise-ui'), text: s.textContent,
    onPage: getComputedStyle(document.querySelector('.hero-title')).getPropertyValue('--vr-inv-zoom'),
    htmlInline: document.documentElement.getAttribute('style'),
    bodyInline: document.body.getAttribute('style') }
})
const SCALED = ['visbug-handles', 'visbug-hover', 'visbug-corners', 'visbug-label',
  'visbug-distance', 'visbug-gridlines', 'visbug-grip', '[data-visual-revise-guide]']
T('10.6.1 缩放 1.5：变量样式表挂在 <head>、带 data-visual-revise-ui、只命中 8 个编辑器标签',
  varStyle?.parent === 'HEAD' && varStyle.ui === true && SCALED.every(s => varStyle.text.includes(s)),
  JSON.stringify(varStyle?.text))
T('10.6.1 缩放 1.5：不碰页面的行内样式，页面元素上取不到 --vr-inv-zoom',
  varStyle?.onPage === '' && varStyle.htmlInline === null && varStyle.bodyInline === null,
  `page --vr-inv-zoom="${varStyle?.onPage}" html style=${varStyle?.htmlInline} body style=${varStyle?.bodyInline}`)

// 真实路径：选中一张卡片再 hover 另一张 → visbug-distance / visbug-gridlines / visbug-hover
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(300)
await page.locator('.curve-card').nth(0).hover({ position: { x: 4, y: 4 } })
await page.waitForTimeout(600)
const live = await page.evaluate(() => {
  const sh = e => e && (e.$shadow || e.shadowRoot)
  const out = {}
  const d = document.querySelector('visbug-distance')
  if (d) {
    out.distFont = parseFloat(getComputedStyle(d).fontSize)
    const div = sh(d).querySelector('figure div')
    out.distLine = div ? parseFloat(getComputedStyle(div).height) : null
  }
  const g = document.querySelector('visbug-gridlines')
  if (g) {
    const line = sh(g).querySelector('line')
    out.glLine = line ? parseFloat(getComputedStyle(line).strokeWidth) : null
  }
  const h = document.querySelector('visbug-hover')
  if (h) { const r = sh(h).querySelector('rect'); out.hoverStroke = r ? parseFloat(getComputedStyle(r).strokeWidth) : null }
  return out
})
T('10.6.3 缩放 1.5：测距的数字 16px→10.67、线粗 1px→0.67（屏幕原大）',
  live.distFont != null && near(live.distFont, 16 / 1.5, .1) && live.distLine != null && near(live.distLine, 1 / 1.5, .15),
  `期望 font 10.67px / 线 0.667px，实际 ${live.distFont}px / ${live.distLine}px`)
T('10.6.3 缩放 1.5：标尺线（visbug-gridlines）描边 1px→0.67',
  live.glLine != null && near(live.glLine, 1 / 1.5, .05), `期望 0.667px，实际 ${live.glLine}px`)
T('10.6.3 缩放 1.5：hover 描边 2px→1.33',
  live.hoverStroke != null && near(live.hoverStroke, 2 / 1.5, .05), `期望 1.334px，实际 ${live.hoverStroke}px`)

// corners / label 只在特定工具下出现，这里按组件契约直接构造并驱动 position
const built = await page.evaluate(() => {
  const sh = e => e && (e.$shadow || e.shadowRoot)
  const src = document.querySelector('.curve-card')
  const out = {}
  const co = document.createElement('visbug-corners')
  document.body.appendChild(co)
  co.position = { el: src, node_label_id: 'zoom-probe' }
  const cr = sh(co).querySelector('rect')
  out.corner = cr ? [parseFloat(getComputedStyle(cr).width), parseFloat(getComputedStyle(cr).strokeWidth)] : null
  co.remove()

  const lb = document.createElement('visbug-label')
  document.body.appendChild(lb)
  lb.text = 'h1.hero-title'
  lb.position = { boundingRect: src.getBoundingClientRect(), node_label_id: 'zoom-probe', isFixed: false }
  const sp = sh(lb).querySelector('span')
  out.label = sp ? [parseFloat(getComputedStyle(lb).fontSize), parseFloat(getComputedStyle(sp).paddingTop), parseFloat(getComputedStyle(sp).paddingLeft)] : null
  lb.remove()

  // 拖出的参考线（features/guides.js 的 createGuide 产物形态）
  const gd = document.createElement('div')
  gd.dataset.visualReviseGuide = ''
  gd.style = 'position:absolute;top:0;left:0;width:calc(1px * var(--vr-inv-zoom, 1));height:100vh;'
  document.body.appendChild(gd)
  out.guide = parseFloat(getComputedStyle(gd).width)
  gd.remove()

  // visbug-grip：grip.element.css 里同样写了 var(--vr-inv-zoom)
  const gr = document.createElement('visbug-grip')
  document.body.appendChild(gr)
  gr.position = { el: src, node_label_id: 'zoom-probe' }
  const grr = sh(gr)?.querySelector('rect')
  out.grip = grr ? parseFloat(getComputedStyle(grr).strokeWidth) : null
  out.gripVar = getComputedStyle(gr).getPropertyValue('--vr-inv-zoom')
  gr.remove()
  return out
})
T('10.6.3 缩放 1.5：角标 5×5→3.34、描边 1px→0.67',
  built.corner && near(built.corner[0], 5 / 1.5, .05) && near(built.corner[1], 1 / 1.5, .05),
  `期望 [3.335, 0.667]，实际 ${JSON.stringify(built.corner)}`)
T('10.6.3 缩放 1.5：标签字号 16px→10.67、内边距 2/6px→1.33/4.0',
  built.label && near(built.label[0], 16 / 1.5, .05) && near(built.label[1], 2 / 1.5, .05) && near(built.label[2], 6 / 1.5, .05),
  `期望 [10.67, 1.33, 4.0]，实际 ${JSON.stringify(built.label)}`)
T('10.6.3 缩放 1.5：拖出的参考线线宽 1px→0.67',
  built.guide != null && built.guide > 0.4 && built.guide < 0.8, `期望 ≈0.667px，实际 ${built.guide}px`)
T('10.6.3 缩放 1.5：visbug-grip 的描边也按 --vr-inv-zoom 缩回屏幕原大',
  built.grip != null && near(built.grip, 1 / 1.5, .05),
  `grip.element.css 写了 calc(1px * var(--vr-inv-zoom,1))，要靠 zoom.js 的 SCALED 选择器命中 visbug-grip：` +
  `期望 0.667px，实际 ${built.grip}px（宿主上 --vr-inv-zoom="${built.gripVar}"）`)

// 10.6.4 位置不反向缩放：选中框贴着元素，跟页面一起放大
const stuck = await page.evaluate(() => {
  const h = document.querySelector('visbug-handles')
  const hr = h.getBoundingClientRect()
  const sel = document.querySelectorAll('.curve-card')[1].getBoundingClientRect()
  const cl = document.querySelector('visual-revise-comment-layer')
  const gl = document.querySelector('visbug-gridlines')
  return { hTransform: getComputedStyle(h).transform, hr: [hr.left, hr.top, hr.width, hr.height],
    sel: [sel.left, sel.top, sel.width, sel.height],
    comment: cl ? getComputedStyle(cl).transform : 'missing',
    grid: gl ? getComputedStyle(gl).transform : 'missing' }
})
T('10.6.4 缩放 1.5：选中框 / 标尺线 / 批注层的位置不反向缩放（无 scale，选中框仍与元素重合）',
  stuck.hTransform === 'none' && stuck.comment === 'none' && stuck.grid === 'none' &&
  near(stuck.hr[0], stuck.sel[0], 1) && near(stuck.hr[2], stuck.sel[2], 1),
  `handles transform=${stuck.hTransform} 批注层=${stuck.comment} 标尺=${stuck.grid}；` +
  `handles ${JSON.stringify(stuck.hr)} vs 元素 ${JSON.stringify(stuck.sel)}`)

// ══════════════════════════════════════════════════════════════
// §D 四个弹层：挂上时读一次倍数，反向缩回屏幕原大（10.5.1）
// ══════════════════════════════════════════════════════════════
await page.mouse.move(10, 600)
await page.locator('.hero-title').click(); await page.waitForTimeout(400)

// ① 菜单（尺寸模式，align:right）
await tap(P('.mode[data-axis="width"]'))
const menu = await popBox('visual-revise-menu')
const menuAnchor = await anchorBox('.mode[data-axis="width"]')
T('10.5.1 缩放 1.5：菜单弹层 scale(1/1.5)、原点左上',
  !!menu && /scale\(0\.66/.test(menu.transform) && menu.origin === 'left top', JSON.stringify(menu))
T('10.5.1 缩放 1.5：右对齐菜单的右缘仍贴锚点右缘（屏幕上的位置不随缩放变）',
  !!menu && !!menuAnchor && near(menu.right, menuAnchor.right, 2),
  `期望菜单右缘 ${menuAnchor?.right?.toFixed(1)}，实际 ${menu?.right?.toFixed(1)}` +
  `（差 ${((menuAnchor?.right ?? 0) - (menu?.right ?? 0)).toFixed(1)} CSS px = 屏幕上 ${(((menuAnchor?.right ?? 0) - (menu?.right ?? 0)) * 1.5).toFixed(1)}px）：` +
  `openMenu 用锚点的「已缩过」视口坐标减去弹层「没缩过」的 offsetWidth`)
await closePop()

// ② 下拉
await tap(P('vr-select[data-prop="position"]'))
const sel = await popBox('visual-revise-select-panel')
const selAnchor = await anchorBox('vr-select[data-prop="position"]')
T('10.5.1 缩放 1.5：下拉弹层 scale(1/1.5)、原点左上',
  !!sel && /scale\(0\.66/.test(sel.transform) && sel.origin === 'left top', JSON.stringify(sel))
T('10.5.1 缩放 1.5：下拉左上角贴着锚点（左缘对齐、贴在锚点下方 6px）',
  !!sel && !!selAnchor && near(sel.left, selAnchor.left, 1.5) && near(sel.top - selAnchor.bottom, 6, 2.5),
  `弹层 left ${sel?.left?.toFixed(1)} vs 锚点 ${selAnchor?.left?.toFixed(1)}；top−锚点 bottom = ${(sel?.top - selAnchor?.bottom)?.toFixed(1)}`)
T('10.5.1 缩放 1.5：下拉的屏幕宽度不小于触发器（minWidth 应与触发器同宽）',
  !!sel && !!selAnchor && sel.width >= selAnchor.width - 1,
  `期望 ≥ 触发器宽 ${selAnchor?.width?.toFixed(2)} CSS px，实际 ${sel?.width?.toFixed(2)}` +
  `（屏幕上 ${(selAnchor?.width * 1.5).toFixed(1)}px 的触发器配了 ${(sel?.width * 1.5).toFixed(1)}px 的下拉）：` +
  `minWidth 写的是锚点的屏幕宽，却落在弹层「没缩过」的布局盒上`)
await closePop()

// ③ 色盘
const sw = P('section[data-group="fill"] .field vr-color .swatch').first()
await sw.scrollIntoViewIfNeeded(); await sw.click(); await page.waitForTimeout(400)
const pop = await popBox('visual-revise-color-panel')
T('10.5.1 缩放 1.5：颜色弹层宿主 scale(1/1.5)、原点左上',
  !!pop && /scale\(0\.66/.test(pop.transform) && pop.origin === 'left top', JSON.stringify(pop))
// 弹层活不过一次交互，挂上时读一次倍数就够，不订阅变化
await zoom(1); await page.waitForTimeout(300)
const popAfter = await popBox('visual-revise-color-panel')
T('10.5.1 弹层不订阅倍数变化：开着时改倍数，宿主的 scale 保持挂上那一刻的值',
  !!popAfter && popAfter.transform === pop.transform,
  `挂上时 ${pop?.transform}，改倍数后 ${popAfter?.transform}`)
await zoom(1.5); await page.waitForTimeout(200)
await closePop()

// ④ 填充（需要一个有背景的元素）
await page.locator('.swatch').first().click(); await page.waitForTimeout(450)
const openedFill = await page.evaluate(() => {
  const r = document.querySelector('visual-revise-panel').shadowRoot
  const f = r.querySelector('vr-fill')
  const s = f && (f.shadowRoot?.querySelector('.swatch') || f.querySelector('.swatch'))
  if (!s) return false
  s.click(); return true
})
await page.waitForTimeout(450)
const fillPop = await popBox('visual-revise-fill-panel')
T('10.5.1 缩放 1.5：填充弹层 scale(1/1.5)、原点左上',
  openedFill && !!fillPop && /scale\(0\.66/.test(fillPop.transform) && fillPop.origin === 'left top',
  `opened=${openedFill} ${JSON.stringify(fillPop)}`)
await closePop()

// ══════════════════════════════════════════════════════════════
// §E 只改属性不抛事件：MutationObserver 兜底（10.1.3）
// ══════════════════════════════════════════════════════════════
await page.locator('.hero-title').click(); await page.waitForTimeout(400)
await page.evaluate(() => { document.documentElement.dataset.visualReviseZoom = '1.25' })
await page.waitForTimeout(250)
const pMut = await rect('visual-revise-panel')
T('10.1.3 只改 <html data-visual-revise-zoom> 不抛事件：MutationObserver 兜底认到 1.25',
  /scale\(0\.8\)/.test(pMut.transform) && near(pMut.top, 88 / 1.25),
  `期望 scale(0.8) / top 70.4，实际 ${pMut.transform} / top ${pMut.top}`)
await zoom(1.5); await page.waitForTimeout(200)

// ══════════════════════════════════════════════════════════════
// §F 拖过的面板记屏幕坐标（10.2.4）
// ══════════════════════════════════════════════════════════════
const head = page.locator('visual-revise-panel header').first()
const hb = await head.boundingBox()
const before = await rect('visual-revise-panel')
await page.mouse.move(hb.x + 6, hb.y + hb.height / 2)
await page.mouse.down()
// 面板很高，纵向只能停在视口上沿附近，目标 y 取 30 避开下界夹取
await page.mouse.move(hb.x + 6 - (before.left - 200), hb.y + hb.height / 2 - (before.top - 30), { steps: 6 })
await page.mouse.up(); await page.waitForTimeout(150)
const p3 = await rect('visual-revise-panel')
T('10.2.4 缩放 1.5 下拖到 (200,30)：眼睛看到的左上角就是 (200,30)', near(p3.left, 200, 3) && near(p3.top, 30, 3), `${p3.left},${p3.top}`)
const saved = await page.evaluate(() => localStorage.getItem('visual-revise:panel-pos'))
const savedPos = JSON.parse(saved || 'null')
T('10.2.4 localStorage 里记的是屏幕坐标（CSS 坐标 ×1.5 = 300/45），不是 CSS 坐标',
  !!savedPos && near(savedPos.left, 300, 3) && near(savedPos.top, 45, 3),
  `期望 {left:300, top:45}，实际 ${saved}`)
await zoom(1); await page.waitForTimeout(200)
const p4 = await rect('visual-revise-panel')
T('10.2.4 缩回 1：面板停在同一屏幕位置（300,45）、transform 清空',
  near(p4.left, 300, 3) && near(p4.top, 45, 3) && p4.transform === '', `${p4.left},${p4.top} ${p4.transform}`)
T('10.2.2 缩回 1：面板宽度恢复', near(p4.width, p1.width), `${p4.width}`)
const m1 = await marks()
T('10.6.1 缩回 1：把手圆点回 8px、变量样式表移除', m1.grip != null && near(m1.grip, 8, .2) && m1.rule === null, JSON.stringify(m1))
const t4 = await rect('visual-revise-toolbar')
T('10.3.3 缩回 1：工具条 transform 清空、回到 top 20', t4.transform === '' && near(t4.top, 20), `${t4.transform} ${t4.top}`)

// 缩小到 80%：放大 1.25 倍
await zoom(0.8); await page.waitForTimeout(200)
const p5 = await rect('visual-revise-panel')
T('10.2.4 缩放 0.8：面板 scale(1.25)、屏幕位置仍是 (300,45)', /scale\(1\.25/.test(p5.transform) && near(p5.left, 375, 3) && near(p5.top, 56, 3),
  `${p5.transform} ${p5.left},${p5.top}`)
await zoom(1)

// ══════════════════════════════════════════════════════════════
// §G 页面自己察觉（CDP 真改 DPR + 视口）（10.1.4 / 10.1.5 / 10.1.6 / 10.1.7）
//    这一段必须是本进程里第一次 setDeviceMetricsOverride：Chrome 只有首次
//    override 会把 DPR 与视口宽在同一次 resize 里交出来；之后的 override 两者
//    到达顺序不定，observe() 会先读到「只改了宽」。更细的分支放到 §H 用可配置的
//    devicePixelRatio / innerWidth 精确复现。
// ══════════════════════════════════════════════════════════════
await page.evaluate(() => { delete document.documentElement.dataset.visualReviseZoom })
const cdp = await page.context().newCDPSession(page)
const vp0 = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(vp0.w / 1.5), height: Math.round(vp0.h / 1.5), deviceScaleFactor: 1.5, mobile: false })
await page.waitForTimeout(300)
const p6 = await rect('visual-revise-panel')
T('10.1.4 无扩展消息：DPR×1.5 且视口÷1.5 → 认作缩放 1.5，面板 scale(1/1.5)', /scale\(0\.66/.test(p6.transform) && near(p6.vw, vp0.w / 1.5, 2),
  `${p6.transform} vw ${p6.vw}`)
// 扩展随后告知绝对倍数：以它为准，不是在自察结果上再乘
await zoom(2); await page.waitForTimeout(250)
const p6b = await rect('visual-revise-panel')
T('10.1.7 自察到 1.5 后扩展告知 2：取绝对值 2（scale .5），不是 1.5×2',
  /scale\(0\.5\)/.test(p6b.transform), `期望 scale(0.5)，实际 ${p6b.transform}`)
await zoom(1.5); await page.waitForTimeout(250)
// 只改 DPR、视口不变：是换了块屏，不是缩放
await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(vp0.w / 1.5), height: Math.round(vp0.h / 1.5), deviceScaleFactor: 3, mobile: false })
await page.waitForTimeout(300)
const p7 = await rect('visual-revise-panel')
T('10.1.5 只改 DPR 不改视口：视为换屏，倍数不变', /scale\(0\.66/.test(p7.transform), p7.transform)
// 回到 DPR 1 + 原视口：倍数回 1
await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp0.w, height: vp0.h, deviceScaleFactor: 1, mobile: false })
await page.waitForTimeout(300)
const p8 = await rect('visual-revise-panel')
T('10.1.4 DPR 回 1 且视口回原：倍数回 1，transform 清空', p8.transform === '', p8.transform)
await cdp.send('Emulation.clearDeviceMetricsOverride'); await page.waitForTimeout(250)

// 只有宽度变、DPR 不变 = 拉窗口：倍数不变，只更新宽度锚点
await zoom(1.5); await page.waitForTimeout(200)
await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp0.w - 240, height: vp0.h, deviceScaleFactor: 1, mobile: false })
await page.waitForTimeout(300)
const p9a = await rect('visual-revise-panel')
T('10.1.6 只改视口宽、DPR 不变（拉窗口）：倍数仍是 1.5',
  /scale\(0\.66/.test(p9a.transform) && p9a.vw === vp0.w - 240,
  `期望 scale(0.666667) 且 innerWidth=${vp0.w - 240}，实际 ${p9a.transform} / ${p9a.vw}`)
await cdp.send('Emulation.clearDeviceMetricsOverride'); await page.waitForTimeout(300)
const p9b = await rect('visual-revise-panel')
T('10.1.6 窗口宽度改回来：倍数还是 1.5（宽度只是锚点，不改倍数）',
  /scale\(0\.66/.test(p9b.transform) && p9b.vw === vp0.w, `${p9b.transform} / innerWidth ${p9b.vw}`)

// ══════════════════════════════════════════════════════════════
// §H observe() 的三个分支 + acceptAttr 重置锚点（10.1.4 / 10.1.5 / 10.1.6 / 10.1.7）
//    用可配置的 devicePixelRatio / innerWidth 精确喂值，避开 CDP 事件到达顺序。
// ══════════════════════════════════════════════════════════════
// devicePixelRatio / innerWidth 是 window 自己的可配置访问器：先存原始描述符，
// 用完必须原样装回去（delete 会把这两个全局变量整个抹掉）
await page.evaluate(() => {
  window.__vrOrigDesc = {
    dpr: Object.getOwnPropertyDescriptor(window, 'devicePixelRatio'),
    w: Object.getOwnPropertyDescriptor(window, 'innerWidth'),
  }
})
const fake = (dpr, w, resize = true) => page.evaluate(([d, ww, rs]) => {
  if (d != null) Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => d })
  if (ww != null) Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => ww })
  if (rs) dispatchEvent(new Event('resize'))
  return document.querySelector('visual-revise-panel').style.transform
}, [dpr, w, resize])

await zoom(1); await page.waitForTimeout(200)
const f1 = await fake(1.5, Math.round(vp0.w / 1.5)); await page.waitForTimeout(120)
T('10.1.4 DPR 1→1.5 且 innerWidth 同时 ÷1.5：算作缩放 1.5',
  /scale\(0\.66/.test(f1), `期望 scale(0.666667)，实际 ${f1}`)
const f2 = await fake(3, null); await page.waitForTimeout(120)
T('10.1.5 只把 DPR 1.5→3、宽度不动：换屏，倍数仍 1.5',
  /scale\(0\.66/.test(f2), `期望 scale(0.666667)，实际 ${f2}`)
const f3 = await fake(null, 800); await page.waitForTimeout(120)
T('10.1.6 只把宽度改成 800、DPR 不动：拉窗口，倍数仍 1.5',
  /scale\(0\.66/.test(f3), `期望 scale(0.666667)，实际 ${f3}`)
// acceptAttr 重置锚点：先把 DPR / 宽换到别的值但不抛 resize，再让扩展告知绝对倍数
await fake(1.5, 1600, false)
await zoom(2); await page.waitForTimeout(200)
const f4 = await page.evaluate(() => document.querySelector('visual-revise-panel').style.transform)
T('10.1.7 扩展告知 2：倍数取绝对值 2（scale .5）', /scale\(0\.5\)/.test(f4), `期望 scale(0.5)，实际 ${f4}`)
const f5 = await fake(3, 800); await page.waitForTimeout(120)
T('10.1.7 锚点已重置到告知那一刻的 (DPR 1.5 / 宽 1600)：随后 DPR×2、宽÷2 → 2×2=4（scale .25）',
  /scale\(0\.25\)/.test(f5), `期望 scale(0.25)；若锚点没重置会停在 scale(0.5)，实际 ${f5}`)
// 还原真实的 devicePixelRatio / innerWidth
await page.evaluate(() => {
  Object.defineProperty(window, 'devicePixelRatio', window.__vrOrigDesc.dpr)
  Object.defineProperty(window, 'innerWidth', window.__vrOrigDesc.w)
  dispatchEvent(new Event('resize'))
})
await zoom(1); await page.waitForTimeout(200)
await page.evaluate(() => { delete document.documentElement.dataset.visualReviseZoom })
await page.waitForTimeout(150)
const fRestore = await rect('visual-revise-panel')
T('10.1.x 还原真实 DPR / 宽度后倍数回 1（后续断言的前置）',
  fRestore.transform === '' && fRestore.vw === vp0.w, `${fRestore.transform} / innerWidth ${fRestore.vw}`)

// ══════════════════════════════════════════════════════════════
// §I 触控板捏合（视觉视口 pinch zoom）（10.1.8 / 10.2.3 / 10.2.5 / 10.2.6 / 10.3.1 / 10.5.1）
//    CSS 像素、DPR 都不变，visualViewport.scale 变，视口还能在页面上平移。
//    UI 得贴着眼睛看到的那块视口的角落。
// ══════════════════════════════════════════════════════════════
// 先清掉上面拖动留下的记忆位置，看默认贴角；最后再单独看记忆位置的情形
await page.evaluate(() => { localStorage.removeItem('visual-revise:panel-pos'); dispatchEvent(new Event('resize')) }); await page.waitForTimeout(200)
const vvOf = () => page.evaluate(() => ({ s: visualViewport.scale, l: visualViewport.offsetLeft, t: visualViewport.offsetTop, w: visualViewport.width, h: visualViewport.height }))
await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 }); await page.waitForTimeout(300)
const v1 = await vvOf(), p10 = await rect('visual-revise-panel'), t9 = await rect('visual-revise-toolbar')
T('10.1.8/10.2.6 捏合 ×2（无平移）：面板 scale(.5)、右缘贴视觉视口右缘减 16/2、顶 88/2',
  v1.s === 2 && /scale\(0\.5\)/.test(p10.transform) && near(p10.right, v1.l + v1.w - 8) && near(p10.top, v1.t + 44) && near(p10.width, 150),
  `${p10.transform} right ${p10.right} vs ${v1.l + v1.w - 8}; top ${p10.top}; w ${p10.width}`)
T('10.3.1 捏合 ×2：工具条居视觉视口中线、顶 20/2、高减半',
  near((t9.left + t9.right) / 2, v1.l + v1.w / 2) && near(t9.top, v1.t + 10) && near(t9.height, t1.height / 2),
  `cx ${(t9.left + t9.right) / 2} vs ${v1.l + v1.w / 2}; top ${t9.top}; h ${t9.height}`)
const wantPinchMaxH = r3(v1.h * 2 - 104)
T('10.2.3 捏合 ×2：面板 max-height 按视觉视口高乘回 2（vv.height×2−104）',
  near(parseFloat(p10.maxHeight), wantPinchMaxH, 1), `期望 ${wantPinchMaxH}px，实际 ${p10.maxHeight}`)
// 弹层：捏合状态下打开，宿主也缩 1/2。捏合模拟下 Playwright 的鼠标坐标与命中测试对不上，
// 直接在页面里派发 click（弹层只认 click，不认坐标）
const opened = await page.evaluate(() => {
  // 色块在 vr-color / vr-fill 自己的 shadow root 里，querySelector 不跨 shadow
  const r = document.querySelector('visual-revise-panel').shadowRoot
  for (const [tag, id] of [['vr-color', 'visual-revise-color-panel'], ['vr-fill', 'visual-revise-fill-panel']]) {
    const host = r.querySelector(tag)
    const sw = host && (host.shadowRoot?.querySelector('.swatch') || host.querySelector('.swatch'))
    if (sw) { sw.click(); return id }
  }
  return null
})
await page.waitForTimeout(400)
const pop2 = opened && await page.evaluate(id => document.getElementById(id)?.style.transform ?? null, opened)
T('10.5.1 捏合状态下打开弹层：宿主 scale(.5)', /scale\(0\.5\)/.test(pop2 || ''), String(pop2))
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
// 记忆位置远在视口外：moveTo 要夹在「视觉视口框」里，不是布局视口
await page.evaluate(() => { localStorage.setItem('visual-revise:panel-pos', JSON.stringify({ left: 100000, top: 100000 })); dispatchEvent(new Event('resize')) })
await page.waitForTimeout(250)
const vClamp = await vvOf(), pClamp = await rect('visual-revise-panel')
T('10.2.5 捏合时记忆位置在视口外：夹在视觉视口框内（右/下各留 8），不是夹在布局视口',
  near(pClamp.right, vClamp.l + vClamp.w - 8, 1.5) && near(pClamp.bottom, vClamp.t + vClamp.h - 8, 1.5) &&
  pClamp.right < pClamp.vw - 8 - 1,
  `期望 right ${(vClamp.l + vClamp.w - 8).toFixed(1)} / bottom ${(vClamp.t + vClamp.h - 8).toFixed(1)}，` +
  `实际 ${pClamp.right.toFixed(1)} / ${pClamp.bottom.toFixed(1)}（布局视口右缘 ${pClamp.vw}）`)
// 记忆位置（屏幕坐标 300,45）：捏合时停在视觉视口左上角 + (300,45)/2
await page.evaluate(() => { localStorage.setItem('visual-revise:panel-pos', JSON.stringify({ left: 300, top: 45 })); dispatchEvent(new Event('resize')) }); await page.waitForTimeout(200)
const v3 = await vvOf(), p12 = await rect('visual-revise-panel')
T('10.2.4 捏合 ×2 + 记忆位置：停在视觉视口左上角 + (300,45)/2', near(p12.left, v3.l + 150, 2) && near(p12.top, v3.t + 22.5, 2),
  `vv (${v3.l},${v3.t}); panel ${p12.left},${p12.top}`)
await page.evaluate(() => localStorage.removeItem('visual-revise:panel-pos'))
await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await page.waitForTimeout(300)
const p11 = await rect('visual-revise-panel')
T('10.2.6 捏合复原：transform 清空、回到布局视口右上角', p11.transform === '' && near(p11.vw - p11.right, 16) && near(p11.top, 88), `${p11.transform} gap ${p11.vw - p11.right} top ${p11.top}`)
// 在页面右下方捏合（真实手势，触点会落在页面上、可能改变选中，所以放最后）：
// 视口偏到 (500,300) 附近，UI 跟着视口走
await cdp.send('Input.synthesizePinchGesture', { x: 1000, y: 600, scaleFactor: 2, relativeSpeed: 800 }); await page.waitForTimeout(500)
const v2 = await vvOf(), t10 = await rect('visual-revise-toolbar')
const pOff = await page.evaluate(() => { const el = document.querySelector('visual-revise-panel'); const r = el.getBoundingClientRect(); return { hidden: el.hidden, right: r.right, top: r.top } })
T('10.3.1 捏合并偏移：视觉视口偏了，工具条居其中线、顶 20/2', v2.l > 100 && v2.t > 50 && near((t10.left + t10.right) / 2, v2.l + v2.w / 2, 2) && near(t10.top, v2.t + 10, 2),
  `vv (${v2.l},${v2.t}) ${v2.w}×${v2.h}; cx ${(t10.left + t10.right) / 2} vs ${v2.l + v2.w / 2}; top ${t10.top}`)
T('10.2.6 捏合并偏移：面板（若仍显示）贴视觉视口右上角', pOff.hidden || (near(pOff.right, v2.l + v2.w - 8, 2) && near(pOff.top, v2.t + 44, 2)),
  `hidden=${pOff.hidden} right ${pOff.right} vs ${v2.l + v2.w - 8}; top ${pOff.top} vs ${v2.t + 44}`)
await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await page.waitForTimeout(300)

// ══════════════════════════════════════════════════════════════
// §J 拖过的工具条 / 改动列表也记屏幕坐标（10.3.2 / 10.4.2 / 10.4.3）
//    #screen 一旦记下就没有复位入口，所以这一段放在所有「未拖过」的断言之后。
// ══════════════════════════════════════════════════════════════
await page.locator('.hero-title').click(); await page.waitForTimeout(400)
await zoom(1.5); await page.waitForTimeout(250)
const tbState = () => page.evaluate(() => {
  const t = document.querySelector('visual-revise-toolbar'); const r = t.getBoundingClientRect()
  return { left: r.left, top: r.top, transform: t.style.transform, origin: t.style.transformOrigin }
})
const sep = await page.locator('visual-revise-toolbar .sep').first().boundingBox()
await page.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2)
await page.mouse.down()
await page.mouse.move(sep.x + sep.width / 2 - 200, sep.y + sep.height / 2 + 160, { steps: 8 })
const tbMid = await tbState()
await page.mouse.up(); await page.waitForTimeout(250)
const tbAfter = await tbState()
T('10.3.2 缩放 1.5 拖工具条：拖动过程中保留 scale(1/k)、原点换到左上（不再硬写 transform:none）',
  /scale\(0\.66/.test(tbMid.transform) && tbMid.origin === 'left top',
  `期望 scale(0.666667) + left top，实际 ${tbMid.transform} / ${tbMid.origin}`)
await zoom(1); await page.waitForTimeout(250)
const tb1 = await tbState()
T('10.3.2 拖过的工具条缩回 1：停在同一屏幕位置（CSS 坐标 ×1.5）、原点左上',
  near(tb1.left, tbAfter.left * 1.5, 2) && near(tb1.top, tbAfter.top * 1.5, 2) && tb1.origin === 'left top' && tb1.transform === 'none',
  `期望 (${(tbAfter.left * 1.5).toFixed(1)}, ${(tbAfter.top * 1.5).toFixed(1)})，实际 (${tb1.left.toFixed(1)}, ${tb1.top.toFixed(1)}) transform=${tb1.transform}`)
await zoom(0.8); await page.waitForTimeout(250)
const tb2 = await tbState()
T('10.3.2 拖过的工具条缩到 0.8：屏幕位置仍不变（CSS 坐标 = 屏幕坐标 ÷0.8）',
  /scale\(1\.25\)/.test(tb2.transform) && near(tb2.left, tbAfter.left * 1.5 / 0.8, 2) && near(tb2.top, tbAfter.top * 1.5 / 0.8, 2),
  `期望 (${(tbAfter.left * 1.5 / 0.8).toFixed(1)}, ${(tbAfter.top * 1.5 / 0.8).toFixed(1)}) + scale(1.25)，实际 (${tb2.left.toFixed(1)}, ${tb2.top.toFixed(1)}) ${tb2.transform}`)
await zoom(1.5); await page.waitForTimeout(200)

// 改动列表
await page.evaluate(() => { document.querySelector('visual-revise-list').hidden = false })
await page.waitForTimeout(250)
const clState = () => page.evaluate(() => {
  const t = document.querySelector('visual-revise-list'); const r = t.getBoundingClientRect()
  return { left: r.left, top: r.top, transform: t.style.transform, origin: t.style.transformOrigin, right: t.style.right }
})
const lhb = await page.locator('visual-revise-list header').first().boundingBox()
await page.mouse.move(lhb.x + 6, lhb.y + lhb.height / 2)
await page.mouse.down()
await page.mouse.move(lhb.x + 6 - (lhb.x - 100), lhb.y + lhb.height / 2 - (lhb.y - 40), { steps: 6 })
const clMid = await clState()
await page.mouse.up(); await page.waitForTimeout(250)
const clAfter = await clState()
T('10.4.2 缩放 1.5 拖改动列表：拖动中原点切到左上、right 清成 auto、保留 scale',
  clMid.origin === 'left top' && clMid.right === 'auto' && /scale\(0\.66/.test(clMid.transform),
  `期望 left top / auto / scale(0.666667)，实际 ${clMid.origin} / ${clMid.right} / ${clMid.transform}`)
await zoom(1); await page.waitForTimeout(250)
const cl1 = await clState()
T('10.4.2 拖过的改动列表缩回 1：停在同一屏幕位置（CSS 坐标 ×1.5）',
  near(cl1.left, clAfter.left * 1.5, 2) && near(cl1.top, clAfter.top * 1.5, 2) && cl1.origin === 'left top',
  `期望 (${(clAfter.left * 1.5).toFixed(1)}, ${(clAfter.top * 1.5).toFixed(1)})，实际 (${cl1.left.toFixed(1)}, ${cl1.top.toFixed(1)})`)
// connectedCallback 订阅 / disconnectedCallback 退订
const sub = await page.evaluate(() => {
  const l = document.querySelector('visual-revise-list')
  l.remove()
  l.style.transform = 'scale(9)'
  document.documentElement.dataset.visualReviseZoom = '1.25'
  window.dispatchEvent(new CustomEvent('visual-revise:zoom', { detail: 1.25 }))
  const offline = l.style.transform
  document.body.appendChild(l)
  return { offline, online: l.style.transform }
})
T('10.4.3 改动列表移出 DOM 后退订（不再被 syncZoom 改），重新挂上立刻同步到当前倍数',
  sub.offline === 'scale(9)' && /scale\(0\.8\)/.test(sub.online),
  `离线时期望保持 scale(9) 实际 ${sub.offline}；重新挂上期望 scale(0.8) 实际 ${sub.online}`)
await page.evaluate(() => { document.querySelector('visual-revise-list').hidden = true })
await zoom(1); await page.waitForTimeout(200)

// ══════════════════════════════════════════════════════════════
// §K 参考线半透明 + 退出编辑器清样式（10.6.1）
// ══════════════════════════════════════════════════════════════
const guide = await page.evaluate(() => {
  const g = document.createElement('visbug-gridlines'); document.body.appendChild(g)
  const o = getComputedStyle(g).opacity; g.remove(); return o
})
T('4.5.8 参考线 visbug-gridlines opacity .5', guide === '0.5', guide)

await zoom(1.5); await page.waitForTimeout(200)
const teardown = await page.evaluate(() => {
  const before = !!document.getElementById('visual-revise-zoom-vars')
  window.__visualRevise.destroy()
  return { before, after: !!document.getElementById('visual-revise-zoom-vars') }
})
T('10.6.1 退出编辑器（destroy）时 clearZoomStyles 清掉变量样式表',
  teardown.before === true && teardown.after === false,
  `退出前有样式表=${teardown.before}，退出后仍有=${teardown.after}`)

// ══════════════════════════════════════════════════════════════
// §L 新页面：bundle 启动时读属性 + (resolution) 媒体查询的递归重挂
//    （10.1.2 / 10.1.9）
// ══════════════════════════════════════════════════════════════
const page2 = await browser.newPage({ viewport: { width: 1280, height: 820 } })
page2.on('pageerror', e => console.log('[page2 pageerror]', e.message))
await page2.addInitScript(() => {
  window.__mq = []
  const orig = window.matchMedia.bind(window)
  window.matchMedia = q => { window.__mq.push(String(q)); return orig(q) }
})
await page2.goto(origin)
// content script 先写属性，bundle 后到：启动时靠 fromAttr() 认倍数
await page2.evaluate(() => { document.documentElement.dataset.visualReviseZoom = '1.5' })
await injectVisBug(page2, origin)
await page2.locator('.hero-title').click(); await page2.waitForTimeout(500)
const boot = await page2.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  return { t: p.style.transform, top: p.style.top, mq: window.__mq.filter(q => /resolution/.test(q)) }
})
T('10.1.2 属性先于 bundle 就位：启动即认得倍数 1.5（fromAttr），面板一上来就是 scale(1/1.5)',
  /scale\(0\.66/.test(boot.t) && near(parseFloat(boot.top), 88 / 1.5, 1),
  `期望 scale(0.666667) / top 58.67px，实际 ${boot.t} / ${boot.top}`)
T('10.1.9 启动时用 matchMedia((resolution: Ndppx)) 补监听换屏',
  boot.mq.length > 0 && /^\(resolution: [\d.]+dppx\)$/.test(boot.mq[0]),
  `期望注册 (resolution: Ndppx)，实际 ${JSON.stringify(boot.mq)}`)
const cdp2 = await page2.context().newCDPSession(page2)
// 注意：CDP 模拟下 (resolution) 的 change 只在版面也跟着变时才派发，
// 所以这里连视口尺寸一起改（真实换屏同样会重排）
await cdp2.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 2, mobile: false })
await page2.waitForTimeout(800)
const mqAfter = await page2.evaluate(() => window.__mq.filter(q => /resolution/.test(q)))
T('10.1.9 DPR 变过之后重新挂一个新的 (resolution) 查询（{once:true} + 递归）',
  mqAfter.some(q => /\(resolution: 2dppx\)/.test(q)),
  `期望出现 (resolution: 2dppx)，实际 ${JSON.stringify(mqAfter)}`)
await cdp2.send('Emulation.clearDeviceMetricsOverride')

console.log(`\nzoom: ${pass} passed, ${fail} failed`)
console.log('（10.1.1 需真实扩展环境，见 scratchpad/ext-zoom-a.mjs，不在本套件内）')
await browser.close(); await close()
process.exitCode = fail ? 1 : 0
