// 全量 e2e · D 组「On this page」色板 + 变量搜索 = 功能清单 v2 的
// 3.4.9–3.4.16、3.6.9、2.11.12–2.11.16（14 点），对应 PRD 的 AC-6.41a–f / AC-6.42a–b / AC-6.32a2。
//
// 数据源是 app/core/page-colors.js（扫页面）、渲染在 app/components/controls/page-colors.js，
// 两个入口：色盘弹层（visual-revise-color-panel）的「自定义」页、填充弹层
// （visual-revise-fill-panel）的「纯色」页。
//
// 固件 full/fixtures/page-colors.html 是为这一组现造的，采集口径的每一支都在里面留了探针：
//   #123456 × 30（排序第一）、rgba(200,30,40,.5) × 12（半透明分半渲染）、
//   四边同色描边 × 5（只该数 5 处不是 20 处）、四边不同色 × 1、
//   display:none / visbug-* / [data-visual-revise-ui] / alpha=0 / border-style:none /
//   border-width:0（都不该出现）、SVG fill+stroke、容器字色 vs 直接文字的字色。
// 空态另用 full/fixtures/page-colors-empty.html（页面上一个可采集的颜色都没有）。
//
// 注意事项：
//   - 弹层内容在 shadow root 里：page.evaluate 里的 querySelector 不跨 shadow，
//     一律 document.getElementById(id).shadowRoot；Playwright 的 locator 会穿透。
//   - 行 / 页签用 [data-item] / [data-page] / [data-tab] 这类属性做后代选择。
//   - 面板是滚动容器，点之前 scrollIntoViewIfNeeded。
//   - Esc 一次关一个弹层。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/page-colors.html`
const EMPTY = `${origin}/full/fixtures/page-colors-empty.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const covered = new Set()
const T = (id, cond, msg) => { covered.add(id); cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

const COLOR = 'visual-revise-color-panel'
const FILL = 'visual-revise-fill-panel'
const PANEL = 'visual-revise-panel'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const P = sel => page.locator(`${PANEL} ${sel}`)
const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.click(); await page.waitForTimeout(420) }
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(260) }
const openStroke = () => tap(P('section[data-group="stroke"] vr-color[data-prop="border-color"] .swatch'))
const openFill = () => tap(P('section[data-group="fill"] vr-fill[data-layer="0"] .swatch'))

// 弹层里的「On this page」整块：色块、次数、头部、网格样式一次读出来
const board = id => page.evaluate(x => {
  const host = document.getElementById(x)
  if (!host) return { open: false }
  const r = host.shadowRoot
  const pc = r.querySelector('.page-colors')
  const grid = pc?.querySelector('.pc-grid')
  const gs = grid && getComputedStyle(grid)
  const sw = [...r.querySelectorAll('.pc-swatch')]
  return {
    open: true,
    has: !!pc,
    head: pc?.querySelector('.pc-head')?.firstElementChild?.textContent.trim() ?? null,
    headCount: pc?.querySelector('.pc-head')?.lastElementChild?.textContent.trim() ?? null,
    emptyText: grid ? null : pc?.lastElementChild?.textContent.trim() ?? null,
    hasGrid: !!grid,
    cols: gs ? gs.gridTemplateColumns.split(/\s+/).length : null,
    gap: gs?.gap ?? null,
    maxH: gs?.maxHeight ?? null,
    overflowY: gs?.overflowY ?? null,
    scrollable: grid ? grid.scrollHeight > grid.clientHeight + 1 : null,
    n: sw.length,
    colors: sw.map(b => b.dataset.color),
    counts: sw.map(b => +b.dataset.count),
    titles: sw.map(b => b.title),
    inCustom: !!r.querySelector('.sv'),   // 色域面板 = 自定义页
  }
}, id)

const countOf = (b, color) => { const i = b.colors.indexOf(color); return i < 0 ? null : b.counts[i] }

// 色盘控件当前的值（色值框 / 透明度框 / 三个滑块的位置）
const picker = id => page.evaluate(x => {
  const r = document.getElementById(x)?.shadowRoot
  if (!r) return null
  const q = s => r.querySelector(s)
  return {
    val: q('.val')?.value ?? null,
    alphaVal: q('.alpha-val')?.value ?? null,
    svLeft: q('.sv-thumb')?.style.left ?? null,
    hueLeft: q('.hue-thumb')?.style.left ?? null,
    alphaLeft: q('.alpha-thumb')?.style.left ?? null,
  }
}, id)

const varRows = id => page.evaluate(x => {
  const r = document.getElementById(x)?.shadowRoot
  if (!r) return null
  return [...r.querySelectorAll('[data-item]')]
    .filter(i => getComputedStyle(i).display !== 'none').map(i => i.dataset.item)
}, id)

const inline = (elId, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i).style.getPropertyValue(p), [elId, prop])

console.log('\n[全量 e2e · D 组] 「On this page」色板 + 变量搜索\n')

await page.goto(FIXTURE)
await injectVisBug(page, origin)
await page.waitForTimeout(400)
await page.locator('#pc-target').click({ position: { x: 110, y: 48 } })
await page.waitForTimeout(600)

// ── 3.4.9 / 3.4.10：色板的网格规格与采集口径 ──────────────────────────
console.log('── 3.4.9 网格规格 · 3.4.10 采集口径')
await openStroke()
const b0 = await board(COLOR)

T('3.4.9', b0.has && b0.head === 'On this page' && b0.headCount === String(b0.n)
  && b0.cols === 9 && b0.gap === '3px' && b0.maxH === '105px' && b0.overflowY === 'auto',
  `自定义页色盘下面有「On this page」：头部文案「${b0.head}」右侧计数 ${b0.headCount}（= ${b0.n} 个色块），`
  + `网格 ${b0.cols} 列（期望 9）、gap ${b0.gap}（期望 3px）、max-height ${b0.maxH}（期望 105px）、`
  + `overflow-y ${b0.overflowY}（期望 auto）`)

const desc = b0.counts.every((c, i) => i === 0 || c <= b0.counts[i - 1])
T('3.4.9', desc && b0.colors[0] === '#123456' && b0.counts[0] === 30 && b0.inCustom,
  `按出现次数降序：首项 ${b0.colors[0]} × ${b0.counts[0]}（期望 #123456 × 30），`
  + `整串次数 ${b0.counts.join('/')} 单调不增=${desc}`)

T('3.4.10', countOf(b0, '#ab0001') === 5,
  `四边同色的描边只数一次：5 个 border:3px solid #ab0001 的元素数出 ${countOf(b0, '#ab0001')} 处（期望 5，逐边数会是 20）`)

const four = ['#ab0011', '#ab0012', '#ab0013', '#ab0014'].map(c => countOf(b0, c))
T('3.4.10', four.every(c => c === 1),
  `四边不同色的描边四个颜色各数一次：#ab0011/12/13/14 = ${four.join('/')}（期望 1/1/1/1）`)

T('3.4.10', countOf(b0, '#ab0006') === 1 && countOf(b0, '#ab0007') === 1,
  `内联 SVG 的 fill / stroke 都采到：#ab0006（fill）= ${countOf(b0, '#ab0006')}、`
  + `#ab0007（stroke）= ${countOf(b0, '#ab0007')}（期望各 1）`)

T('3.4.10', !b0.colors.includes('#ab0002'),
  `display:none 的元素不算：#ab0002 ${b0.colors.includes('#ab0002') ? '出现了' : '没有出现'}（期望不出现）`)

T('3.4.10', !b0.colors.includes('#ab0003') && !b0.colors.includes('#ab0004')
  && !b0.colors.includes('#ab0005') && !b0.colors.includes('#1e1e1e'),
  `编辑器 UI 不算：visbug-* 的 #ab0003、[data-visual-revise-ui] 的 #ab0004 与其子孙的 #ab0005、`
  + `以及弹层宿主自己的底色 #1e1e1e 都不在名单里（实际命中 `
  + `${['#ab0003', '#ab0004', '#ab0005', '#1e1e1e'].filter(c => b0.colors.includes(c)).join(',') || '无'}）`)

T('3.4.10', !b0.colors.includes('#ab0008'),
  `全透明（alpha=0）不算：rgba(171,0,8,0) 对应的 #ab0008 ${b0.colors.includes('#ab0008') ? '出现了' : '没有出现'}（期望不出现）`)

T('3.4.10', !b0.colors.includes('#ab000c') && !b0.colors.includes('#ab000d'),
  `没画出来的描边不算：border-style:none 的 #ab000c、border-width:0 的 #ab000d 都不在名单里`
  + `（实际命中 ${['#ab000c', '#ab000d'].filter(c => b0.colors.includes(c)).join(',') || '无'}）`)

T('3.4.10', !b0.colors.includes('#ab0009') && countOf(b0, '#ab000a') === 1 && countOf(b0, '#ab000b') === 1,
  `字色只数直接承载文字的元素：只装子元素的容器 #ab0009 不出现、子元素的 #ab000a = ${countOf(b0, '#ab000a')}、`
  + `直接带文字的 #ab000b = ${countOf(b0, '#ab000b')}（期望 不出现 / 1 / 1）`)

// ── 3.4.12 / 3.4.13：色块的画法 ────────────────────────────────────
console.log('── 3.4.12 色块边框与棋盘格 · 3.4.13 半透明分半')
const paint = await page.evaluate(x => {
  const r = document.getElementById(x).shadowRoot
  const all = [...r.querySelectorAll('.pc-swatch')]
  const one = c => all.find(b => b.dataset.color === c)
  const read = el => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const checker = el.querySelector('i')
    const halves = [...el.querySelectorAll('b')].map(b => ({
      bg: getComputedStyle(b).backgroundColor, w: b.getBoundingClientRect().width }))
    return {
      borderStyle: cs.borderTopStyle, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor,
      btnImage: cs.backgroundImage,
      checkerImage: checker ? getComputedStyle(checker).backgroundImage : null,
      checkerSize: checker ? getComputedStyle(checker).backgroundSize : null,
      halves,
    }
  }
  return { opaque: read(one('#123456')), alpha: read(one('#c81e2880')) }
}, COLOR)

T('3.4.12', paint.opaque?.borderStyle === 'solid' && paint.opaque?.borderWidth === '1px'
  && paint.opaque?.borderColor === 'rgb(90, 90, 90)',
  `色块是 1px 实线边框：${paint.opaque?.borderWidth} ${paint.opaque?.borderStyle} ${paint.opaque?.borderColor}`
  + `（期望 1px solid rgb(90, 90, 90)，不是虚线）`)

const gradients = (paint.alpha?.checkerImage?.match(/linear-gradient/g) || []).length
T('3.4.12', gradients === 2 && /^10px 10px(, 10px 10px)?$/.test(paint.alpha?.checkerSize || '')
  && paint.opaque?.btnImage === 'none',
  `棋盘格只画在内层：内层 i 有 ${gradients} 段 linear-gradient（期望 2，两层错开半格）、background-size `
  + `${paint.alpha?.checkerSize}（期望每层 10px 10px）；按钮本体 background-image = `
  + `${paint.opaque?.btnImage}（期望 none，边框才不会被格子切成虚线）`)

const h = paint.alpha?.halves || []
T('3.4.13', h.length === 2 && h[0].bg === 'rgb(200, 30, 40)' && h[1].bg === 'rgba(200, 30, 40, 0.5)'
  && Math.abs(h[0].w - h[1].w) < 1 && paint.opaque?.halves.length === 1,
  `带透明度的 #c81e2880 分两半：左 ${h[0]?.bg} / 右 ${h[1]?.bg}（期望 rgb(200,30,40) / rgba(200,30,40,0.5)），`
  + `两半宽 ${h.map(x => x.w.toFixed(1)).join(' vs ')}（期望相等）；不透明的 #123456 只有 `
  + `${paint.opaque?.halves.length} 块（期望 1）`)

// ── 3.4.14 / 2.11.12 / 2.11.13 / 2.11.14：变量页与搜索 ──────────────
console.log('── 3.4.14 变量页没有色板 · 2.11.12–2.11.14 变量搜索')
await page.locator(`#${COLOR} [data-page="variable"]`).click()
await page.waitForTimeout(400)
const varPage = await page.evaluate(x => {
  const r = document.getElementById(x).shadowRoot
  const input = r.querySelector('.var-search input')
  return {
    pc: !!r.querySelector('.page-colors'),
    input: !!input,
    icon: !!r.querySelector('.var-search svg'),
    placeholder: input?.placeholder ?? null,
    aria: input?.getAttribute('aria-label') ?? null,
    focused: r.activeElement === input,
    focusedTag: r.activeElement?.tagName ?? null,
    total: r.querySelectorAll('[data-item]').length,
  }
}, COLOR)

T('3.4.14', !varPage.pc,
  `变量页没有「On this page」（那是自定义页的东西）：.page-colors 存在=${varPage.pc}（期望 false）`)

T('2.11.12', varPage.input && varPage.icon && varPage.placeholder === '搜索变量'
  && varPage.aria === '搜索变量' && varPage.focused,
  `变量列表顶部有搜索框：放大镜 svg=${varPage.icon}、占位「${varPage.placeholder}」、`
  + `aria-label「${varPage.aria}」，打开即聚焦（activeElement=${varPage.focusedTag}，期望 INPUT）`)

await page.keyboard.type('ink'); await page.waitForTimeout(220)
const hitLower = await varRows(COLOR)
await page.keyboard.press(`${MOD}+a`); await page.keyboard.type('INK'); await page.waitForTimeout(220)
const hitUpper = await varRows(COLOR)
await page.keyboard.press(`${MOD}+a`); await page.keyboard.type('face'); await page.waitForTimeout(220)
const hitMid = await varRows(COLOR)
await page.keyboard.press(`${MOD}+a`); await page.keyboard.type('zzz-no-such'); await page.waitForTimeout(220)
const missState = await page.evaluate(x => {
  const r = document.getElementById(x).shadowRoot
  const m = r.querySelector('.var-miss')
  return {
    shown: [...r.querySelectorAll('[data-item]')].filter(i => getComputedStyle(i).display !== 'none').length,
    hidden: m?.hidden ?? null, display: m ? getComputedStyle(m).display : null, text: m?.textContent ?? null,
  }
}, COLOR)
await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('Backspace'); await page.waitForTimeout(220)
const restored = await varRows(COLOR)

T('2.11.13', hitLower.length >= 7 && hitLower.every(n => n.toLowerCase().includes('ink'))
  && JSON.stringify(hitUpper) === JSON.stringify(hitLower)
  && hitMid.length === 2 && hitMid.every(n => n.includes('surface'))
  && restored.length === varPage.total && restored.length > hitLower.length,
  `输入即按名字过滤（量的是 getComputedStyle(row).display）：ink → ${hitLower.length} 行 `
  + `${hitLower.join(',')}；大写 INK → 同样 ${hitUpper.length} 行（不区分大小写）；`
  + `子串 face → ${hitMid.length} 行 ${hitMid.join(',')}；清空恢复 ${restored.length} 行`
  + `（期望 = 全部 ${varPage.total} 行）`)

T('2.11.14', missState.shown === 0 && missState.hidden === false && missState.display !== 'none'
  && missState.text === '没有匹配「zzz-no-such」的变量',
  `一个都不剩时显示一行提示：可见行 ${missState.shown}（期望 0），提示 hidden=${missState.hidden}、`
  + `display=${missState.display}、文案「${missState.text}」（期望「没有匹配「zzz-no-such」的变量」）`)

// ── 3.4.15：弹层开着期间只扫一次 ────────────────────────────────────
console.log('── 3.4.15 开着只扫一次 / 关掉重开重扫')
// 趁弹层开着往页面塞一个新颜色：切回自定义页不该重扫
await page.evaluate(() => {
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('i')
    d.className = 'pc-sentinel'
    d.style.cssText = 'display:inline-block;width:6px;height:6px;background:#0fca01'
    document.body.appendChild(d)
  }
})
await page.locator(`#${COLOR} [data-page="custom"]`).click()
await page.waitForTimeout(400)
const bCached = await board(COLOR)
T('3.4.15', bCached.inCustom && !bCached.colors.includes('#0fca01')
  && bCached.n === b0.n && bCached.headCount === b0.headCount,
  `弹层开着期间只扫一次：切到变量页再切回来，中途新增的 #0fca01 没被扫进来`
  + `（含=${bCached.colors.includes('#0fca01')}，期望 false），色块数 ${bCached.n}（期望仍是 ${b0.n}）`)

await esc()
await openStroke()
const bRescan = await board(COLOR)
T('3.4.15', bRescan.colors.includes('#0fca01') && countOf(bRescan, '#0fca01') === 3
  && bRescan.n === b0.n + 1,
  `关掉重开重扫：#0fca01 出现且计 ${countOf(bRescan, '#0fca01')} 处（期望 3），`
  + `色块数 ${bRescan.n}（期望 ${b0.n + 1}）`)

// ── 3.4.11：点色块直接应用并载入色盘 ───────────────────────────────
console.log('── 3.4.11 点色块应用 + 载入色盘')
const titleOf = c => bRescan.titles[bRescan.colors.indexOf(c)]
T('3.4.11', titleOf('#123456') === '#123456 · 30 处' && titleOf('#ab0001') === '#ab0001 · 5 处',
  `色块的 title 是「色值 · N 处」：「${titleOf('#123456')}」「${titleOf('#ab0001')}」`
  + `（期望「#123456 · 30 处」「#ab0001 · 5 处」）`)

const before = await picker(COLOR)
await page.locator(`#${COLOR} .pc-swatch[data-color="#c81e2880"]`).click()
await page.waitForTimeout(420)
const after = await picker(COLOR)
const applied = await inline('pc-target', 'border-color')
T('3.4.11', /rgba\(200, 30, 40, 0\.5\)|#c81e2880/i.test(applied)
  && after.val?.toLowerCase() === '#c81e2880' && after.alphaVal === '50'
  && after.alphaLeft === '50%' && after.svLeft !== before.svLeft && after.hueLeft !== before.hueLeft,
  `点半透明色块：元素上写入 border-color=${applied}（期望带 0.5 透明度的原色）；`
  + `色盘同步——色值框 ${before.val} → ${after.val}（期望 #c81e2880）、不透明度 ${before.alphaVal} → `
  + `${after.alphaVal}%（期望 50）、透明度条把手 ${before.alphaLeft} → ${after.alphaLeft}（期望 50%）、`
  + `色域把手 ${before.svLeft} → ${after.svLeft}、色相把手 ${before.hueLeft} → ${after.hueLeft}（都要动）`)

await esc()

// ── 2.11.15：过滤不影响当前绑定项的勾选 ─────────────────────────────
console.log('── 2.11.15 过滤不影响勾选')
await openStroke()
await page.locator(`#${COLOR} [data-page="variable"]`).click(); await page.waitForTimeout(350)
await page.locator(`#${COLOR} [data-item="--pc-ink-deep"]`).click(); await page.waitForTimeout(500)
const bound = await inline('pc-target', 'border-color')
await tap(P('section[data-group="stroke"] .var-chip').first())
const chipPop = await page.evaluate(x => {
  const r = document.getElementById(x)?.shadowRoot
  if (!r) return null
  const cur = r.querySelector('[data-item][data-current]')
  return { pages: r.querySelectorAll('[data-page]').length, current: cur?.dataset.item ?? null,
    check: !!cur?.querySelector('svg'), bg: cur ? getComputedStyle(cur).backgroundColor : null,
    pc: !!r.querySelector('.page-colors') }
}, COLOR)
await page.keyboard.type('surface'); await page.waitForTimeout(220)
const during = await page.evaluate(x => {
  const r = document.getElementById(x).shadowRoot
  const cur = r.querySelector('[data-item][data-current]')
  return { curDisplay: cur ? getComputedStyle(cur).display : null,
    shown: [...r.querySelectorAll('[data-item]')].filter(i => getComputedStyle(i).display !== 'none').map(i => i.dataset.item) }
}, COLOR)
await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('Backspace'); await page.waitForTimeout(250)
const restoredCheck = await page.evaluate(x => {
  const r = document.getElementById(x).shadowRoot
  const cur = r.querySelector('[data-item][data-current]')
  return { current: cur?.dataset.item ?? null, check: !!cur?.querySelector('svg'),
    display: cur ? getComputedStyle(cur).display : null, bg: cur ? getComputedStyle(cur).backgroundColor : null }
}, COLOR)

T('2.11.15', bound === 'var(--pc-ink-deep)' && chipPop?.current === '--pc-ink-deep' && chipPop.check
  && during.curDisplay === 'none' && !during.shown.includes('--pc-ink-deep')
  && restoredCheck.current === '--pc-ink-deep' && restoredCheck.check
  && restoredCheck.display === 'flex' && restoredCheck.bg === 'rgba(13, 153, 255, 0.22)',
  `绑定 --pc-ink-deep 后（inline=${bound}）从 chip 打开变量列表：勾在 ${chipPop?.current} 上；`
  + `敲 surface 把它过滤掉（display=${during.curDisplay}，剩 ${during.shown.join(',')}）；`
  + `清空后勾还在原处（current=${restoredCheck.current}、对勾=${restoredCheck.check}、`
  + `display=${restoredCheck.display}、底色=${restoredCheck.bg}）`)

T('3.4.14', chipPop?.pages === 0 && chipPop?.pc === false,
  `已绑定的格子从 chip 进来只给变量列表：页签数 ${chipPop?.pages}（期望 0）、`
  + `.page-colors 存在=${chipPop?.pc}（期望 false）`)

await esc()
await tap(P('section[data-group="stroke"] [data-unlink="border-color"]'))

// ── 3.6.9 / 2.11.16：填充弹层 ──────────────────────────────────────
console.log('── 3.6.9 填充弹层的纯色页 · 2.11.16 两页并排')
await tap(P('section[data-group="fill"] .add[data-add="fill"]'))
await openFill()
const fb0 = await board(FILL)
const fillPages = await page.evaluate(x => {
  const r = document.getElementById(x)?.shadowRoot
  if (!r) return null
  const btns = [...r.querySelectorAll('[data-page]')]
  return { n: btns.length, labels: btns.map(b => b.textContent.trim()),
    tops: btns.map(b => Math.round(b.getBoundingClientRect().top)),
    display: btns[0] ? getComputedStyle(btns[0].parentElement).display : null }
}, FILL)

T('3.6.9', fb0.has && fb0.n > 1 && fb0.head === 'On this page' && fb0.cols === 9,
  `填充弹层的纯色页同样有「On this page」：${fb0.n} 个色块、头部「${fb0.head}」、${fb0.cols} 列（期望 9）`)

T('2.11.16', fillPages?.n === 2 && new Set(fillPages.tops).size === 1 && fillPages.display === 'flex',
  `填充弹层的「${fillPages?.labels.join(' | ')}」两页并排在同一行：容器 display=${fillPages?.display}`
  + `（期望 flex），两个按钮 top ${fillPages?.tops.join('/')}（期望相等）`)

// 开着时切 tab 不重扫；关掉重开重扫
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('i')
    d.style.cssText = 'display:inline-block;width:6px;height:6px;background:#0fca02'
    document.body.appendChild(d)
  }
})
await page.locator(`#${FILL} [data-tab="gradient"]`).click(); await page.waitForTimeout(350)
await page.locator(`#${FILL} [data-tab="solid"]`).click(); await page.waitForTimeout(350)
const fbCached = await board(FILL)
await esc()
await openFill()
const fbRescan = await board(FILL)
T('3.6.9', !fbCached.colors.includes('#0fca02') && fbRescan.colors.includes('#0fca02')
  && countOf(fbRescan, '#0fca02') === 4,
  `填充弹层同样开着只扫一次、每次 open() 重扫：切「渐变」再切回「纯色」时新增的 #0fca02 不在`
  + `（含=${fbCached.colors.includes('#0fca02')}，期望 false）；关掉重开就在了（${countOf(fbRescan, '#0fca02')} 处，期望 4）`)

// 绑定态整排藏掉、断开后还得是并排的一行（display 不能被清成 ''）
await page.locator(`#${FILL} [data-page="variable"]`).click(); await page.waitForTimeout(350)
await page.locator(`#${FILL} [data-item="--pc-ink-alt"]`).click(); await page.waitForTimeout(500)
await tap(P('section[data-group="fill"] vr-fill[data-layer="0"]').first())
const boundPages = await page.evaluate(x => {
  const r = document.getElementById(x)?.shadowRoot
  if (!r) return null
  const wrap = r.querySelector('.pages')
  return { n: r.querySelectorAll('[data-page]').length, display: wrap ? getComputedStyle(wrap).display : null }
}, FILL)
await esc()
await tap(P('section[data-group="fill"] [data-unlink-layer="0"]'))
await openFill()
const backPages = await page.evaluate(x => {
  const r = document.getElementById(x)?.shadowRoot
  if (!r) return null
  const btns = [...r.querySelectorAll('[data-page]')]
  return { n: btns.length, tops: btns.map(b => Math.round(b.getBoundingClientRect().top)),
    display: btns[0] ? getComputedStyle(btns[0].parentElement).display : null }
}, FILL)
T('2.11.16', boundPages?.n === 0 && boundPages.display === 'none'
  && backPages?.n === 2 && backPages.display === 'flex' && new Set(backPages.tops).size === 1,
  `切换绑定态不破坏并排：绑定后整排藏掉（按钮 ${boundPages?.n} 个 / display=${boundPages?.display}，期望 0 / none）；`
  + `断开绑定再开回来仍是一行两页（${backPages?.n} 个 / display=${backPages?.display} / top `
  + `${backPages?.tops.join('/')}，期望 2 / flex / 相等）`)
await esc()

// ── 3.4.9（续）：最多 54 个、超出内部滚动 ──────────────────────────
console.log('── 3.4.9 上限 54 + 内部滚动')
await page.evaluate(() => {
  const box = document.createElement('div')
  box.id = 'pc-many'
  for (let i = 0; i < 70; i++) {
    const d = document.createElement('i')
    d.style.cssText = `display:inline-block;width:6px;height:6px;background:rgb(${20 + i}, 200, 120)`
    box.appendChild(d)
  }
  document.body.appendChild(box)
})
await openStroke()
const bMany = await board(COLOR)
T('3.4.9', bMany.n === 54 && bMany.headCount === '54' && bMany.scrollable === true,
  `页面上有 70+ 种颜色时最多只排 54 个：色块 ${bMany.n} 个（期望 54）、头部计数 ${bMany.headCount}、`
  + `网格 scrollHeight > clientHeight = ${bMany.scrollable}（期望 true，超出内部滚动）`)

const stayed = await page.evaluate(async x => {
  const r = document.getElementById(x).shadowRoot
  const g = r.querySelector('.pc-grid')
  g.scrollTop = 40
  g.dispatchEvent(new Event('scroll', { bubbles: true }))
  await new Promise(done => setTimeout(done, 260))
  return { top: g.scrollTop, open: !!document.getElementById(x) }
}, COLOR)
T('3.4.9', stayed.top > 0 && stayed.open,
  `在色板网格里滚动不会把弹层关掉：scrollTop=${stayed.top}（期望 > 0）、弹层还开着=${stayed.open}（期望 true）`)

// ── 采集口径的两条边界（对照 3.4.10「只数看得见的」） ─────────────────
console.log('── 3.4.10 边界：display:none 的子孙 / 现代色彩语法')
await esc()
// 先把上一段那 70 个探针撤掉，色板回到没被 54 上限截断的状态，
// 这样「新增 N 个颜色 → 色块多 N 个」的增量判断才成立
await page.evaluate(() => document.getElementById('pc-many')?.remove())
await openStroke()
const bBase = await board(COLOR)
await esc()

await page.evaluate(() => {
  // 藏起来的容器（收起的弹窗 / 折叠菜单是真实页面上最常见的形态）：
  // 里面的颜色一个像素都没画出来
  const box = document.createElement('div')
  box.id = 'pc-hidden-box'
  box.style.cssText = 'display:none'
  box.innerHTML = '<div id="pc-hidden-kid" style="width:20px;height:20px;background:#ab00ff"></div>'
  document.body.appendChild(box)

  // visibility:hidden 同样一个像素都没画出来（AC-6.41a「只数看得见的」）；
  // 但块里显式改回 visibility:visible 的子孙是真画出来的，不能被一起误伤
  const veil = document.createElement('div')
  veil.id = 'pc-veil'
  veil.style.cssText = 'visibility:hidden'
  veil.innerHTML =
    '<div id="pc-veil-kid" style="width:20px;height:20px;background:#ab00ee"></div>'
    + '<div id="pc-veil-shown" style="visibility:visible;width:20px;height:20px;background:#ab00dd"></div>'
  document.body.appendChild(veil)

  // 现代色彩语法：Chrome 的 computed value 保留原色彩空间，不再一律是 rgb()
  const modern = document.createElement('div')
  modern.id = 'pc-modern'
  modern.innerHTML =
    '<i id="pc-oklch" style="display:inline-block;width:12px;height:12px;background:oklch(70% 0.15 200)"></i>'
    + '<i id="pc-p3" style="display:inline-block;width:12px;height:12px;background:color(display-p3 1 0 0)"></i>'
  document.body.appendChild(modern)
})
await openStroke()
const bEdge = await board(COLOR)
const probe = await page.evaluate(() => {
  const el = document.getElementById('pc-hidden-kid')
  const r = el.getBoundingClientRect()
  // 真正画一像素再读回来：canvas 的 fillStyle 序列化同样保留原色彩空间，
  // 只有 getImageData 才给出这颜色落到 sRGB 后的字节
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const hex = css => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
  }
  const veilKid = document.getElementById('pc-veil-kid')
  return {
    display: getComputedStyle(el).display, painted: !!el.offsetParent, w: r.width, h: r.height,
    veilVis: getComputedStyle(veilKid).visibility,
    veilDisplay: getComputedStyle(veilKid).display,
    shownVis: getComputedStyle(document.getElementById('pc-veil-shown')).visibility,
    oklch: getComputedStyle(document.getElementById('pc-oklch')).backgroundColor,
    p3: getComputedStyle(document.getElementById('pc-p3')).backgroundColor,
    oklchHex: hex('oklch(70% 0.15 200)'), p3Hex: hex('color(display-p3 1 0 0)'),
  }
})

T('3.4.10', !bEdge.colors.includes('#ab00ff'),
  `display:none 容器里的子孙也不算（一个像素都没画出来）：#ab00ff `
  + `${bEdge.colors.includes('#ab00ff') ? '被采进色板了' : '没有出现'}（期望不出现）——`
  + `该子元素 getBoundingClientRect ${probe.w}×${probe.h}、offsetParent=${probe.painted}，`
  + `而它自身的 computed display 仍是 ${probe.display}（display 不继承，只看这一个值挡不住子树）`)

T('3.4.10', !bEdge.colors.includes('#ab00ee') && bEdge.colors.includes('#ab00dd'),
  `visibility:hidden 的块里也一个像素都没画出来：#ab00ee `
  + `${bEdge.colors.includes('#ab00ee') ? '被采进色板了' : '没有出现'}（期望不出现，子元素 computed `
  + `visibility=${probe.veilVis}、display 仍是 ${probe.veilDisplay}）；同一块里显式改回 `
  + `visibility:${probe.shownVis} 的子孙是真画出来的，#ab00dd `
  + `${bEdge.colors.includes('#ab00dd') ? '在色板里' : '没有出现'}（期望在，别一起误伤）`)

const modernIn = [probe.oklchHex, probe.p3Hex].filter(h => bEdge.colors.includes(h))
T('3.4.10', modernIn.length === 2 && bEdge.n === bBase.n + 3,
  `oklch / color(display-p3) 画出来的颜色也要采到：computed 分别是 ${probe.oklch} 与 ${probe.p3}，`
  + `落到 sRGB 是 ${probe.oklchHex} 与 ${probe.p3Hex}；色板里命中 ${modernIn.length} 个（期望 2，`
  + `实际 ${modernIn.join(',') || '一个都没有'}）；色块总数 ${bEdge.n}，基线 ${bBase.n}，`
  + `期望 ${bBase.n + 3}（只多这三个真画出来的新颜色：${probe.oklchHex} / ${probe.p3Hex} / #ab00dd）`)

await esc()

// 扫描上限 6000 个元素：排在第 6000 名之后的颜色采不到（这是清单里写死的口径）
await page.evaluate(() => {
  const bulk = document.createElement('div')
  bulk.id = 'pc-bulk'
  const frag = document.createDocumentFragment()
  for (let i = 0; i < 6200; i++) frag.appendChild(document.createElement('span'))
  bulk.appendChild(frag)
  document.body.appendChild(bulk)
  // 排在这 6200 个之后，文档序上越过了上限
  const tail = document.createElement('i')
  tail.id = 'pc-tail'
  tail.style.cssText = 'display:inline-block;width:10px;height:10px;background:#0fca03'
  document.body.appendChild(tail)
})
await openStroke()
const bLimit = await board(COLOR)
T('3.4.10', !bLimit.colors.includes('#0fca03') && bLimit.colors.includes('#123456'),
  `扫描上限 6000 个元素：中间插 6200 个空 span 之后再放的 #0fca03 采不到`
  + `（含=${bLimit.colors.includes('#0fca03')}，期望 false），上限之前的 #123456 照常在`
  + `（含=${bLimit.colors.includes('#123456')}，期望 true）`)
await esc()

// ── 3.4.16：空态 ──────────────────────────────────────────────────
console.log('── 3.4.16 空态')
await page.goto(EMPTY)
await injectVisBug(page, origin)
await page.waitForTimeout(400)
await page.locator('#pc-blank').click({ position: { x: 120, y: 60 } })
await page.waitForTimeout(600)
await openStroke()
const bEmpty = await board(COLOR)
T('3.4.16', bEmpty.has && !bEmpty.hasGrid && bEmpty.n === 0
  && bEmpty.headCount === '0' && bEmpty.emptyText === '页面上没有可采集的颜色',
  `页面上一个可采集的颜色都没有时给空态：网格存在=${bEmpty.hasGrid}（期望 false）、色块 ${bEmpty.n} 个（期望 0）、`
  + `头部计数 ${bEmpty.headCount}（期望 0）、文案「${bEmpty.emptyText}」（期望「页面上没有可采集的颜色」）`)

await browser.close(); await close()
console.log(`\n覆盖的功能点：${[...covered].sort().join(', ')}`)
console.log(`合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
