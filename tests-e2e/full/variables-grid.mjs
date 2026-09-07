// 全量 e2e · 分块「CSS 变量绑定 / 网格设置」
// 对应功能清单 docs/plans/feature-inventory.md 的 §2.11（2.11.1–2.11.11）与
// §2.12（2.12.1–2.12.9）。每个编号至少一条断言，断言落在元素的 inline style /
// 面板 DOM / 改动记录上，不是「没报错」。
//
// 全部走真实交互（locator.click / mouse / keyboard）——这个仓库里
// element.click() 那种程序化派发不触发 pointer 链。面板是滚动容器，点行之前
// 先 scrollIntoViewIfNeeded。弹层内容在 shadow root 里，用 [data-item] /
// [data-page] 这类属性做后代选择（`>` 不跨 shadow）。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const T = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

const COLORPOP = 'visual-revise-color-panel'
const FILLPOP = 'visual-revise-fill-panel'
const MENU = 'visual-revise-menu'
const SELECTPOP = 'visual-revise-select-panel'

const P = sel => page.locator(`visual-revise-panel ${sel}`)
const exists = id => page.evaluate(x => !!document.getElementById(x), id)
const inline = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i).style.getPropertyValue(p), [id, prop])
const priority = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i).style.getPropertyPriority(p), [id, prop])
const computed = (id, prop) => page.evaluate(([i, p]) =>
  getComputedStyle(document.getElementById(i)).getPropertyValue(p), [id, prop])
const total = () => page.evaluate(() => window.__visualRevise.store.stats().total)

// 选中：先 Esc（有弹层就先关弹层），再真实点一下页面元素
const select = async (sel, pos = { x: 8, y: 8 }) => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  await page.locator(sel).first().click({ position: pos })
  await page.waitForTimeout(450)
}
const tap = async (loc, wait = 400) => {
  await loc.scrollIntoViewIfNeeded()
  await loc.click()
  await page.waitForTimeout(wait)
}
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(220) }

// 弹层里的变量行（都在 shadow root 里）
const popItems = id => page.evaluate(x => {
  const host = document.getElementById(x)
  return host ? [...host.shadowRoot.querySelectorAll('[data-item]')].map(r => r.dataset.item) : null
}, id)
const popPages = id => page.evaluate(x => {
  const host = document.getElementById(x)
  return host ? [...host.shadowRoot.querySelectorAll('[data-page]')].map(b => b.textContent.trim()) : null
}, id)
// 面板里的 chip（vr-color 那一侧：chip 直接长在面板的 shadow 里）
const chipOf = group => page.evaluate(g => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const chip = sr.querySelector(`section[data-group="${g}"] .var-chip[data-var-chip]`)
  if (!chip) return null
  return {
    prop: chip.dataset.varChip,
    name: chip.querySelector('.var-name')?.textContent ?? null,
    title: chip.getAttribute('title'),
    dot: getComputedStyle(chip.querySelector('.var-dot')).backgroundColor,
  }
}, group)
const toastText = () => page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot.querySelector('.toast')?.textContent ?? '')

console.log('\n[全量 e2e] §2.11 CSS 变量绑定 / §2.12 网格设置\n')

await page.goto(`${origin}/full/fixtures/variables-grid.html`)
// adoptedStyleSheets 也是变量来源之一（Web Component / CSS-in-JS 常走这条）
await page.evaluate(() => {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(':root{--vg-adopted:#00ddaa}')
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
})
await injectVisBug(page, origin)
await page.waitForTimeout(400)

// ── 2.11.1 / 2.11.2 ───────────────────────────────────────────────
console.log('── 2.11.1 绑定行换成 chip · 2.11.2 读声明原文挑层叠赢家')
await select('#vg-text')

const textChip = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const row = sr.querySelector('section[data-group="fill"] .layer-row.bound')
  if (!row) return null
  const chip = row.querySelector('.var-chip[data-var-chip="color"]')
  return {
    hasChip: !!chip,
    name: chip?.querySelector('.var-name')?.textContent ?? null,
    dotSize: (() => { const d = chip?.querySelector('.var-dot'); return d ? [d.offsetWidth, d.offsetHeight] : null })(),
    // chip 行里不该再有色值 / 不透明度输入，也不该还留着 vr-color
    inputs: row.querySelectorAll('input').length,
    colorControl: !!sr.querySelector('section[data-group="fill"] vr-color[data-prop="color"]'),
    unlink: !!row.querySelector('[data-unlink="color"]'),
    eye: !!row.querySelector('[data-text-eye]'),
  }
})
T('2.11.1', !!textChip?.hasChip && textChip.name === '--vg-media'
  && textChip.inputs === 0 && !textChip.colorControl && textChip.unlink
  && JSON.stringify(textChip.dotSize) === '[16,16]',
  `字色绑了变量：整行换成 chip（圆点 16px + ${textChip?.name}），没有色值 / 不透明度输入，`
  + `旁边是 unlink（${JSON.stringify(textChip)}）`)

// 页面上 #vg-text 只有样式表里的两条声明（id 的 --vg-media 写在前，class 的
// --vg-ink 写在后）。只读 inline 的话一条都认不出；只按文档顺序挑会挑到 --vg-ink
T('2.11.2', await inline('vg-text', 'color') === '' && textChip?.name === '--vg-media'
  && await computed('vg-text', 'color') === 'rgb(51, 85, 255)',
  `inline 里什么都没有，绑定来自样式表；同时命中 #id 与 .class 两条时按层叠挑 id 那条`
  + `（chip=${textChip?.name}，computed=${await computed('vg-text', 'color')}）`)

// 点 chip 换绑成 --vg-layer：inline 写进去之后要压过样式表那条
const beforeRebind = await total()
await tap(P('section[data-group="fill"] .var-chip[data-var-chip="color"]'))
const rebindPages = await popPages(COLORPOP)
await tap(page.locator(`#${COLORPOP} [data-item="--vg-layer"]`))
const rebound = await chipOf('fill')
// 从 chip 打开：没有页签，只有变量列表
T('2.11.2b', Array.isArray(rebindPages) && rebindPages.length === 0
  && await inline('vg-text', 'color') === 'var(--vg-layer)'
  && rebound?.name === '--vg-layer' && await total() === beforeRebind + 1,
  `点 chip 换绑：写 inline var(--vg-layer)，inline 赢过样式表那条，chip 跟着变`
  + `（${rebound?.name}，改动 +1）`)

// ── 2.11.9 变量页的行 ─────────────────────────────────────────────
console.log('── 2.11.9 变量页的行形状 / 当前项')
await tap(P('section[data-group="fill"] .var-chip[data-var-chip="color"]'))
const rowShape = await page.evaluate(x => {
  const root = document.getElementById(x).shadowRoot
  const row = root.querySelector('[data-item="--vg-long"]')
  const cur = root.querySelector('[data-item][data-current]')
  if (!row) return null
  const kids = [...row.children]
  const dot = kids[0]
  return {
    kids: kids.length,
    full: getComputedStyle(document.documentElement).getPropertyValue('--vg-long').trim(),
    dot: { w: dot.offsetWidth, h: dot.offsetHeight, radius: getComputedStyle(dot).borderRadius,
           bg: getComputedStyle(dot).backgroundColor },
    name: kids[1].textContent,
    value: kids[2].textContent,
    // 对勾在最右：最后一个孩子里才有 svg，前面几个都没有
    checkIsLast: kids.at(-1).querySelector('svg') === null && cur?.children.length === 4
      && !!cur.children[3].querySelector('svg')
      && ![...cur.children].slice(0, 3).some(k => k.querySelector('svg')),
    current: cur?.dataset.item ?? null,
  }
}, COLORPOP)
const beforeSame = await total()
await tap(page.locator(`#${COLORPOP} [data-item="--vg-layer"]`))
const stillOpen = await exists(COLORPOP)
T('2.11.9', rowShape?.kids === 4 && rowShape.dot.w === 16 && rowShape.dot.h === 16
  && rowShape.dot.radius === '50%' && rowShape.name === '--vg-long'
  && rowShape.full.length > 18 && rowShape.value === rowShape.full.slice(0, 18)
  && rowShape.checkIsLast && rowShape.current === '--vg-layer'
  && stillOpen && await total() === beforeSame,
  `行是「16px 色圈 | 变量名 | 色值截 18 | 对勾在最右」，当前项勾着；`
  + `点已勾那一项不写改动也不关弹层（value="${rowShape?.value}"，弹层仍在=${stillOpen}）`)
await esc()

// ── 2.11.4 继承 ───────────────────────────────────────────────────
console.log('── 2.11.4 字色继承')
await select('#vg-child', { x: 20, y: 8 })
const inherited = await chipOf('fill')
T('2.11.4', inherited?.name === '--vg-ink'
  && /^继承自 <div#vg-parent\.box>：#vg-parent \{ color: var\(--vg-ink\) \}/.test(inherited?.title || '')
  && await inline('vg-child', 'color') === ''
  && await computed('vg-child', 'color') === 'rgb(34, 204, 136)',
  `子元素自己没写 color，顺祖先找到第一条声明；chip title 写清来自谁`
  + `（${inherited?.name} · ${(inherited?.title || '').slice(0, 34)}…）`)

// ── 2.11.3 简写里的一段 ───────────────────────────────────────────
console.log('── 2.11.3 简写里的一个 var()')
await select('#vg-sh')
const shChip = await chipOf('stroke')
T('2.11.3', shChip?.name === '--vg-line' && shChip.prop === 'border-color'
  && await inline('vg-sh', 'border-color') === '',
  `border: 2px solid var(--vg-line) 这条简写里的那一段也算绑定（${shChip?.name}）`)

await select('#vg-sh2')
const sh2 = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    chip: !!sr.querySelector('section[data-group="stroke"] .var-chip'),
    control: !!sr.querySelector('section[data-group="stroke"] vr-color[data-prop="border-color"]'),
  }
})
T('2.11.3b', sh2.chip === false && sh2.control === true,
  `整条简写里有两个 var()（border: var(--vg-w) solid var(--vg-line)）时分不清哪个是颜色，`
  + `不算绑定、仍显示色块（chip=${sh2.chip} / vr-color=${sh2.control}）`)

await select('#vg-sh3')
const sh3 = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    chip: !!sr.querySelector('section[data-group="stroke"] .var-chip'),
    control: !!sr.querySelector('section[data-group="stroke"] vr-color[data-prop="border-color"]'),
  }
})
T('2.11.3c', sh3.chip === false && sh3.control === true,
  `简写里只有一个 var() 但它解析出来是长度（border: var(--vg-w) solid #8899aa），`
  + `不是颜色也不算绑定（chip=${sh3.chip} / vr-color=${sh3.control}）`)

// ── 2.11.5 颜色核对这道保险 ───────────────────────────────────────
console.log('── 2.11.5 解析色对不上就当没绑定')
await select('#vg-guard')
const guard = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    chip: !!sr.querySelector('section[data-group="fill"] .var-chip'),
    value: sr.querySelector('section[data-group="fill"] vr-color[data-prop="color"]')?.getAttribute('value') ?? null,
  }
})
T('2.11.5', guard.chip === false && await computed('vg-guard', 'color') === 'rgb(0, 128, 0)'
  && /rgb\(0, 128, 0\)/.test(guard.value || ''),
  `@container 的条件 cascade 算不了、按成立处理，挑出来的 var(--vg-red) 与 computed 的绿对不上，`
  + `于是当没绑定、老老实实显示色值（${guard.value}）`)

// 反面：真绑上去的半透明变量必须认得出来——这道核对不能把带 alpha 的颜色误伤
await select('#vg-sh3')
await tap(P('section[data-group="fill"] .var-btn[data-var="fill"]'))
await tap(page.locator(`#${COLORPOP} [data-item="--vg-long"]`))
const alphaBound = {
  inline: await inline('vg-sh3', 'color'),
  computed: await computed('vg-sh3', 'color'),
  chip: (await chipOf('fill'))?.name ?? null,
}
T('2.11.5b', alphaBound.inline === 'var(--vg-long)' && alphaBound.chip === '--vg-long'
  && alphaBound.computed === 'rgba(255, 128, 64, 0.5)',
  `核对只挡假绑定：带 alpha 的 rgba() 变量绑上去照样认得出来（${JSON.stringify(alphaBound)}）`)

// ── 2.11.8 变量数据源 ─────────────────────────────────────────────
console.log('── 2.11.8 变量数据源：五种写法都收得到、只留颜色、按名排序')
await select('#vg-scoped')
await tap(P('section[data-group="fill"] .var-btn[data-var="fill"]'))
const items = await popItems(COLORPOP)
const sorted = items && JSON.stringify(items) === JSON.stringify([...items].sort())
const sources = ['--vg-media', '--vg-layer', '--vg-supports', '--vg-import', '--vg-adopted', '--vg-scoped']
const missing = (items || []).length ? sources.filter(n => !items.includes(n)) : sources
const leaked = (items || []).filter(n => /--vg-(w|len|num|font)$/.test(n))
T('2.11.8', !!items && missing.length === 0 && leaked.length === 0 && sorted,
  `@media / @layer / @supports / @import / adoptedStyleSheets / 容器类选择器里的变量都收得到`
  + `（缺 ${missing.join(',') || '无'}），长度 / 数字 / 字体被 varKind 挡在外面`
  + `（漏进来 ${leaked.join(',') || '无'}），按名排序=${sorted}`)

// 色圈按选中元素取值：.vg-scope 把 --vg-ink 就地改成了 #ffcc00
const scopedDot = await page.evaluate(x => {
  const row = document.getElementById(x).shadowRoot.querySelector('[data-item="--vg-ink"]')
  return row ? getComputedStyle(row.children[0]).backgroundColor : null
}, COLORPOP)
T('2.11.9b', scopedDot === 'rgb(255, 204, 0)',
  `色圈的颜色从选中元素身上读——.vg-scope 里 --vg-ink 是 #ffcc00 而不是 :root 的 #22cc88`
  + `（${scopedDot}）`)

// ── 2.11.7 入口：分区标题栏的「绑定变量」 ─────────────────────────
console.log('── 2.11.7 两个入口 / 按分区首行决定绑哪条属性 / 弹层贴边')
const btnBox = await P('section[data-group="fill"] .var-btn[data-var="fill"]').boundingBox()
const popBoxFromBtn = await page.evaluate(x => {
  const r = document.getElementById(x).getBoundingClientRect()
  return { x: r.x, w: r.width }
}, COLORPOP)
await tap(page.locator(`#${COLORPOP} [data-item="--vg-scoped"]`))
const scopedBound = {
  color: await inline('vg-scoped', 'color'),
  bg: await inline('vg-scoped', 'background-color'),
  chip: (await chipOf('fill'))?.name ?? null,
}
T('2.11.7', scopedBound.color === 'var(--vg-scoped)' && scopedBound.bg === ''
  && scopedBound.chip === '--vg-scoped',
  `文字元素上点标题栏「绑定变量」绑的是 color 而不是背景（color=${scopedBound.color} / `
  + `background-color=${scopedBound.bg || '（没动）'}）`)

// 贴边：标题栏按钮走 align:right（弹层右缘对齐按钮右缘），chip 走 align:left
// （弹层右缘贴在 chip 左缘外 2px）
await tap(P('section[data-group="fill"] .var-chip[data-var-chip="color"]'))
const chipBox = await P('section[data-group="fill"] .var-chip[data-var-chip="color"]').boundingBox()
const popBoxFromChip = await page.evaluate(x => {
  const r = document.getElementById(x).getBoundingClientRect()
  return { x: r.x, w: r.width }
}, COLORPOP)
const near = (a, b) => Math.abs(a - b) <= 2
T('2.11.7b', near(popBoxFromBtn.x + popBoxFromBtn.w, btnBox.x + btnBox.width)
  && near(popBoxFromChip.x + popBoxFromChip.w, chipBox.x - 2),
  `弹层贴标题栏按钮右缘（${Math.round(popBoxFromBtn.x + popBoxFromBtn.w)} vs `
  + `${Math.round(btnBox.x + btnBox.width)}）、贴 chip 左缘`
  + `（${Math.round(popBoxFromChip.x + popBoxFromChip.w)} vs ${Math.round(chipBox.x - 2)}）`)
await esc()

// 容器：标题栏「绑定变量」开的是垫底那一层填充的弹层
await select('#vg-plain', { x: 150, y: 60 })
await tap(P('section[data-group="fill"] .var-btn[data-var="fill"]'))
const fillFromTitle = {
  fill: await exists(FILLPOP),
  color: await exists(COLORPOP),
  onVariable: ((await popItems(FILLPOP)) || []).includes('--vg-ink'),
}
T('2.11.7c', fillFromTitle.fill && !fillFromTitle.color && fillFromTitle.onVariable,
  `没有直接文字的容器上，同一个按钮开的是底层填充的弹层并停在变量页`
  + `（${JSON.stringify(fillFromTitle)}）`)

// ── 2.11.1b 填充层的 chip 是那一层 vr-fill 自己 ───────────────────
await tap(page.locator(`#${FILLPOP} [data-item="--vg-ink"]`))
const layerChip = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const f = sr.querySelector('section[data-group="fill"] vr-fill[bound]')
  if (!f) return null
  const s = f.shadowRoot
  return {
    bound: f.getAttribute('bound'),
    name: s.querySelector('.var-chip .var-name')?.textContent ?? null,
    inputs: s.querySelectorAll('input').length,
    swatch: !!s.querySelector('.swatch'),
    unlink: !!sr.querySelector('section[data-group="fill"] [data-unlink-layer]'),
    // 面板 shadow 里没有第二个 chip：填充层不走 #renderBoundRow
    panelChip: !!sr.querySelector('section[data-group="fill"] .var-chip[data-var-chip]'),
  }
})
await tap(P('section[data-group="fill"] vr-fill[bound]'))
const reopened = { open: await exists(FILLPOP), onVariable: ((await popItems(FILLPOP)) || []).length > 0 }
await esc()
T('2.11.1b', layerChip?.bound === '--vg-ink' && layerChip.name === '--vg-ink'
  && layerChip.inputs === 0 && !layerChip.swatch && layerChip.unlink && !layerChip.panelChip
  && reopened.open && reopened.onVariable
  && await inline('vg-plain', 'background-color') === 'var(--vg-ink)',
  `填充层的 chip 就是那一层 vr-fill 自己的触发器：色值 / 不透明度框和色块都没了，`
  + `点它还能再开这一层的变量页（${JSON.stringify({ ...layerChip, ...reopened })}）`)

// ── 2.11.11 变量列表不走属性，由 provider 现问现给 ────────────────
console.log('── 2.11.11 variablesProvider')
// vr-color 那一侧另找一个还没绑变量的文字元素看
await select('#vg-guard')
const colorProvider = await page.evaluate(() => {
  const c = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('vr-color[data-prop="color"]')
  return { type: typeof c?.variablesProvider, names: c ? c.getAttributeNames() : [] }
})

await select('#vg-plain', { x: 150, y: 60 })
const providerBefore = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const f = sr.querySelector('vr-fill[data-layer]')
  window.__vgCalls = 0
  const wrap = el => { const p = el.variablesProvider; el.variablesProvider = () => { window.__vgCalls++; return p() } }
  if (f) wrap(f)
  return {
    fillProvider: typeof f?.variablesProvider,
    // 几十项的列表不该被序列化进控件属性
    attrs: [...sr.querySelectorAll('vr-color[data-prop], vr-fill[data-layer]')]
      .flatMap(el => el.getAttributeNames()).filter(n => /variable/i.test(n)),
    calls: window.__vgCalls,
  }
})
await tap(P('section[data-group="fill"] vr-fill[bound]'))
const callsAfter = await page.evaluate(() => window.__vgCalls)
await esc()
T('2.11.11', colorProvider.type === 'function' && providerBefore.fillProvider === 'function'
  && providerBefore.attrs.length === 0
  && !colorProvider.names.some(n => /variable/i.test(n))
  && providerBefore.calls === 0 && callsAfter >= 1,
  `面板 render 之后给每个 vr-color / vr-fill 挂 variablesProvider，列表不走属性`
  + `（vr-color 上的属性只有 ${colorProvider.names.join(',')}）；`
  + `渲染时不问（${providerBefore.calls} 次），点开才问（${callsAfter} 次）`)

// 没挂 provider 的（效果参数面板里的 vr-color[data-fx]）只有 Custom 页
await tap(P('.add[data-add="effects"]'))
await tap(page.locator(`#${MENU} [data-item="drop-shadow"]`))
await tap(P('section[data-group="effects"] [data-effect-open="0"]'))
await tap(page.locator(`#${MENU} vr-color[data-fx="color"] .swatch`))
const fxPages = await popPages(COLORPOP)
T('2.11.11b', (fxPages?.length ?? -1) === 0 && await exists(COLORPOP),
  `没挂 provider 的 vr-color[data-fx] 拿到 variables: null，弹层上只有色盘、没有「变量」页`
  + `（pages=${JSON.stringify(fxPages)}）`)
await esc(); await esc()
await select('#vg-plain', { x: 150, y: 60 })
await tap(P('section[data-group="effects"] [data-effect-del="0"]'))

// ── 2.11.6 unlink ────────────────────────────────────────────────
console.log('── 2.11.6 unlink：换成解析色、画面不变')
// 先加一层，验证 unlinkLayer 只解那一层
await tap(P('section[data-group="fill"] .add[data-add="fill"]'))
const beforeUnlinkLayer = {
  color: await inline('vg-plain', 'background-color'),
  image: await inline('vg-plain', 'background-image'),
  painted: await computed('vg-plain', 'background-color'),
}
await tap(P('section[data-group="fill"] [data-unlink-layer="1"]'))
const afterUnlinkLayer = {
  color: await inline('vg-plain', 'background-color'),
  image: await inline('vg-plain', 'background-image'),
  painted: await computed('vg-plain', 'background-color'),
  bound: await page.evaluate(() => !!document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="fill"] vr-fill[bound]')),
}
T('2.11.6', beforeUnlinkLayer.color === 'var(--vg-ink)'
  && afterUnlinkLayer.color === 'rgb(34, 204, 136)' && !afterUnlinkLayer.bound
  && afterUnlinkLayer.painted === beforeUnlinkLayer.painted
  && afterUnlinkLayer.image === beforeUnlinkLayer.image,
  `填充层 unlink 只解这一层：var() 换成解析色、绑定断开、画面不变，上面那层原样不动`
  + `（${beforeUnlinkLayer.color} → ${afterUnlinkLayer.color}）`)

// 样式表带 !important 的那条：写回去也得带 important，否则压不过、点了没反应
await select('#vg-imp')
const impChip = (await chipOf('fill'))?.name ?? null
const impBefore = await computed('vg-imp', 'color')
await tap(P('section[data-group="fill"] [data-unlink="color"]'))
const impAfter = {
  inline: await inline('vg-imp', 'color'),
  priority: await priority('vg-imp', 'color'),
  computed: await computed('vg-imp', 'color'),
  chip: (await chipOf('fill'))?.name ?? null,
}
T('2.11.6b', impChip === '--vg-ink' && impAfter.inline === 'rgb(34, 204, 136)'
  && impAfter.priority === 'important' && impAfter.chip === null
  && impAfter.computed === impBefore,
  `样式表里写着 !important 的绑定，unlink 写回的解析色也带 important，画面不变`
  + `（${JSON.stringify(impAfter)}）`)

// 简写里绑的描边色：unlink 写的是 border-color 长手，画面同样不变
await select('#vg-sh')
const strokePaintBefore = await computed('vg-sh', 'border-top-color')
await tap(P('section[data-group="stroke"] [data-unlink="border-color"]'))
const strokeUnlinked = {
  inline: await inline('vg-sh', 'border-color'),
  painted: await computed('vg-sh', 'border-top-color'),
  chip: (await chipOf('stroke'))?.name ?? null,
}
T('2.11.6c', strokeUnlinked.inline === 'rgb(255, 136, 0)' && strokeUnlinked.chip === null
  && strokeUnlinked.painted === strokePaintBefore,
  `简写 border 里绑着的描边色 unlink 后写成 border-color 长手的解析色，画面不变`
  + `（${strokeUnlinked.inline} / ${strokeUnlinked.painted}）`)

// 继承来的绑定：unlink 落在选中的那个元素身上，不去改祖先
await select('#vg-child', { x: 20, y: 8 })
const childPaintBefore = await computed('vg-child', 'color')
await tap(P('section[data-group="fill"] [data-unlink="color"]'))
const childUnlinked = {
  inline: await inline('vg-child', 'color'),
  parent: await inline('vg-parent', 'color'),
  painted: await computed('vg-child', 'color'),
  chip: (await chipOf('fill'))?.name ?? null,
}
T('2.11.6d', childUnlinked.inline === 'rgb(34, 204, 136)' && childUnlinked.parent === ''
  && childUnlinked.chip === null && childUnlinked.painted === childPaintBefore,
  `继承来的绑定 unlink 只写选中的这一个元素，祖先原样不动`
  + `（child=${childUnlinked.inline} / parent="${childUnlinked.parent}"）`)

// ── 2.11.7d 描边空状态：先立起描边再绑 ───────────────────────────
console.log('── 2.11.7d 描边空状态')
await select('#vg-nostroke')
const strokeEmpty = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return sr.querySelectorAll('section[data-group="stroke"] vr-color').length
})
await tap(P('section[data-group="stroke"] .var-btn[data-var="stroke"]'))
const strokeAfterEntry = {
  style: await inline('vg-nostroke', 'border-style'),
  width: await inline('vg-nostroke', 'border-width'),
  popup: await exists(COLORPOP),
  onVariable: ((await popItems(COLORPOP)) || []).length > 0,
}
await tap(page.locator(`#${COLORPOP} [data-item="--vg-line"]`))
const strokeBound = {
  color: await inline('vg-nostroke', 'border-color'),
  chip: (await chipOf('stroke'))?.name ?? null,
  painted: await computed('vg-nostroke', 'border-top-width'),
}
T('2.11.7d', strokeEmpty === 0 && strokeAfterEntry.style === 'solid' && strokeAfterEntry.width === '1px'
  && strokeAfterEntry.popup && strokeAfterEntry.onVariable
  && strokeBound.color === 'var(--vg-line)' && strokeBound.chip === '--vg-line'
  && strokeBound.painted === '1px',
  `Stroke 空状态下点「绑定变量」先写 border-style: solid / border-width: 1px 再绑，`
  + `否则 border-color 绑了也看不见（${JSON.stringify({ ...strokeAfterEntry, ...strokeBound })}）`)

// ── 2.11.10 写 inline var() / 多选 / toast ───────────────────────
console.log('── 2.11.10 选中后写 inline var()：多选写全部、unlink 逐元素解析')
await select('#vg-m1')
await page.locator('#vg-m2').click({ modifiers: ['Shift'], position: { x: 8, y: 8 } })
await page.waitForTimeout(450)
const multi = await page.evaluate(() =>
  document.querySelectorAll('[data-selected]').length)
const beforeBind = await total()
await tap(P('section[data-group="fill"] .var-btn[data-var="fill"]'))
await tap(page.locator(`#${COLORPOP} [data-item="--vg-ink"]`))
const bindResult = {
  popClosed: !(await exists(COLORPOP)),
  m1: await inline('vg-m1', 'color'),
  m2: await inline('vg-m2', 'color'),
  chip: (await chipOf('fill'))?.name ?? null,
  targetId: await page.evaluate(() => document.querySelector('visual-revise-panel').target?.id ?? null),
  toast: await toastText(),
  added: await total() - beforeBind,
}
T('2.11.10', multi === 2 && bindResult.popClosed
  && bindResult.m1 === 'var(--vg-ink)' && bindResult.m2 === 'var(--vg-ink)'
  && bindResult.chip === '--vg-ink' && ['vg-m1', 'vg-m2'].includes(bindResult.targetId)
  && bindResult.toast === 'color → var(--vg-ink)' && bindResult.added === 2,
  `多选两个元素时 #scope() 里每个都写 inline var()，chip 反映 this.target，`
  + `顺序是关弹层 → 写入 → 重绘 → toast「${bindResult.toast}」（${JSON.stringify(bindResult)}）`)

// 同一个变量再选一次：不重复写
const beforeSameVar = await total()
await tap(P('section[data-group="fill"] .var-chip[data-var-chip="color"]'))
await tap(page.locator(`#${COLORPOP} [data-item="--vg-ink"]`))
const sameVar = { open: await exists(COLORPOP), added: await total() - beforeSameVar }
await esc()
// 改动记录 / 提示词里存的是 var(--x) 原文，AI 拿到的是变量名而不是一个死色值
const promptHasVar = await page.evaluate(() => {
  const md = window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read())
  return { var: md.includes('var(--vg-ink)'), resolved: /rgb\(34, 204, 136\)/.test(md) }
})
T('2.11.10c', promptHasVar.var,
  `绑定写进改动记录后，导出的提示词里是 var(--vg-ink) 原文而不是解析后的死色值`
  + `（var=${promptHasVar.var}）`)
// unlink：两个元素上 --vg-ink 解析出的颜色不一样，各写各的
const resolvedBefore = { m1: await computed('vg-m1', 'color'), m2: await computed('vg-m2', 'color') }
await tap(P('section[data-group="fill"] [data-unlink="color"]'))
const unlinked = { m1: await inline('vg-m1', 'color'), m2: await inline('vg-m2', 'color') }
T('2.11.10b', sameVar.added === 0 && sameVar.open
  && resolvedBefore.m1 !== resolvedBefore.m2
  && unlinked.m1 === resolvedBefore.m1 && unlinked.m2 === resolvedBefore.m2,
  `选中当前那一项不重复写（改动 +${sameVar.added}）；unlink 逐元素取各自的解析色`
  + `（${unlinked.m1} / ${unlinked.m2}）`)

// 样式表里带 !important 的死色值：绑变量写 inline 也得带 important，
// 否则压不过去——画面不动、chip 还显示着样式表里的东西，看着像点了没反应
await select('#vg-imp2')
await tap(P('section[data-group="fill"] .var-btn[data-var="fill"]'))
await tap(page.locator(`#${COLORPOP} [data-item="--vg-line"]`))
const impBind = {
  inline: await inline('vg-imp2', 'color'),
  priority: await priority('vg-imp2', 'color'),
  computed: await computed('vg-imp2', 'color'),
  chip: (await chipOf('fill'))?.name ?? null,
}
T('2.11.10d', impBind.inline === 'var(--vg-line)' && impBind.priority === 'important'
  && impBind.computed === 'rgb(255, 136, 0)' && impBind.chip === '--vg-line',
  `样式表里 color 带 !important 的元素上绑变量，写进去的 var() 也带 important，画面真的变了`
  + `（${JSON.stringify(impBind)}）`)

// ── 2.11.8b 没有颜色变量时的空态 · 2.11.8c 旧名别名 ───────────────
const libNames = await page.evaluate(() => {
  const { declaredVariables, cssVariables } = window.__visualRevise.lib
  return {
    alias: typeof cssVariables === 'function' && cssVariables === declaredVariables,
    names: declaredVariables(document).filter(n => n.startsWith('--vg-')),
  }
})
T('2.11.8c', libNames.alias && libNames.names.includes('--vg-adopted')
  && libNames.names.includes('--vg-import'),
  `api.lib 里 cssVariables 是 declaredVariables 的别名，两者同一个函数`
  + `（收到 ${libNames.names.length} 个 --vg- 变量）`)

const page2 = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page2.on('pageerror', e => console.log('  [页面异常 2]', e.message))
await page2.goto(`${origin}/full/fixtures/variables-grid-empty.html`)
await injectVisBug(page2, origin)
await page2.waitForTimeout(400)
await page2.locator('#ev-text').click({ position: { x: 8, y: 8 } })
await page2.waitForTimeout(450)
const emptyBtn = page2.locator('visual-revise-panel section[data-group="fill"] .var-btn[data-var="fill"]')
await emptyBtn.scrollIntoViewIfNeeded(); await emptyBtn.click(); await page2.waitForTimeout(450)
const emptyState = await page2.evaluate(x => {
  const host = document.getElementById(x)
  if (!host) return null
  return {
    items: host.shadowRoot.querySelectorAll('[data-item]').length,
    text: host.shadowRoot.textContent.replace(/\s+/g, ' ').trim(),
  }
}, COLORPOP)
await page2.close()
T('2.11.8b', emptyState?.items === 0 && /页面上没有颜色变量（另有 3 个其它类型的）/.test(emptyState?.text || ''),
  `页面上一个颜色变量都没有时，列表位置是一行压暗文字并数清其它类型的个数`
  + `（"${(emptyState?.text || '').slice(-30)}"）`)

// ── 2.12 网格设置 ────────────────────────────────────────────────
console.log('\n── 2.12 二级视图：网格设置')
const tracks = (id, axis) => page.evaluate(([i, a]) => {
  const { parseTracks } = window.__visualRevise.lib
  const prop = a === 'columns' ? 'grid-template-columns' : 'grid-template-rows'
  return parseTracks(document.getElementById(i).style.getPropertyValue(prop))
}, [id, axis])
const openGridSettings = async () => {
  await tap(P('.grid-shape'), 350)
  await tap(page.locator(`#${MENU} .gp-settings`), 500)
}

await select('#vg-grid', { x: 4, y: 4 })
const settingsBtn = await page.locator(`#${MENU} .gp-settings`).count()
await tap(P('.grid-shape'), 350)
const btnText = (await page.locator(`#${MENU} .gp-settings`).textContent())?.trim()
await tap(page.locator(`#${MENU} .gp-settings`), 500)
const entered = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    tag: sr.querySelector('header .tag')?.textContent ?? null,
    layout: !!sr.querySelector('section[data-group="layout"]'),
    menu: !!document.getElementById('visual-revise-menu'),
  }
})
T('2.12.1', settingsBtn === 0 && btnText === '打开网格设置'
  && entered.tag === '网格设置' && !entered.layout && !entered.menu,
  `点阵弹层底部的「${btnText}」把面板整块换成二级视图（原来的分区没了 / 弹层随之关闭）`)

const header = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    tag: sr.querySelector('header .tag')?.textContent ?? null,
    sub: sr.querySelector('header .sub-target')?.textContent ?? null,
    back: !!sr.querySelector('header .back'),
  }
})
await tap(P('header .back'))
const backHome = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return { layout: !!sr.querySelector('section[data-group="layout"]'), tracks: sr.querySelectorAll('.track').length }
})
T('2.12.2', header.tag === '网格设置' && header.sub === 'div.gridbox' && header.back
  && backHome.layout && backHome.tracks === 0,
  `头部是「网格设置 + ${header.sub} + 返回 ×」，点 × 回到属性面板`)

await openGridSettings()
const shape = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = a => sr.querySelector(`section[data-group="grid-${a}"]`)
  const rows = a => [...sec(a).querySelectorAll('.track')].map(t => ({
    n: t.querySelector('.track-n').textContent,
    type: t.querySelector('vr-select[data-track]').getAttribute('value'),
    label: t.querySelector('vr-select[data-track]').shadowRoot.querySelector('.label').textContent,
    value: t.querySelector('.track-v').value,
    disabled: t.querySelector('.track-v').disabled,
    del: !!t.querySelector('.del-track'),
  }))
  return {
    titles: [sec('columns')?.querySelector('.title')?.textContent,
             sec('rows')?.querySelector('.title')?.textContent],
    cols: rows('columns'),
    rows: rows('rows'),
  }
})
T('2.12.3', JSON.stringify(shape.titles) === JSON.stringify(['列', '行'])
  && shape.cols.length === 3 && shape.rows.length === 2
  && JSON.stringify(shape.cols.map(r => r.type)) === '["fixed","fill","hug"]'
  && JSON.stringify(shape.cols.map(r => r.label)) === '["固定","等分","贴合"]'
  && JSON.stringify(shape.cols.map(r => r.n)) === '["1","2","3"]'
  && shape.cols[0].value === '200px' && shape.cols[1].value === '1fr'
  && shape.cols[2].disabled === true && shape.cols[0].disabled === false
  && shape.cols.every(r => r.del),
  `两个分区「列 / 行」，每条轨道一行：序号 + 类型（${shape.cols.map(r => r.label).join('/')}）`
  + ` + 值输入（贴合那条 disabled） + 删除 −`)

await tap(P('.add-track[data-axis="rows"]'))
const added = await tracks('vg-grid', 'rows')
T('2.12.4', added.length === 3 && added[2].type === 'fill' && added[2].value === '1fr'
  && await inline('vg-grid', 'grid-template-rows') === 'repeat(3, 1fr)',
  `＋ 加一条等分轨道（grid-template-rows: ${await inline('vg-grid', 'grid-template-rows')}）`)

await tap(P('.del-track[data-axis="rows"][data-i="2"]'))
const deleted = await tracks('vg-grid', 'rows')
T('2.12.5', deleted.length === 2 && await inline('vg-grid', 'grid-template-rows') === 'repeat(2, 1fr)',
  `− 删掉刚加的那条（回到 ${await inline('vg-grid', 'grid-template-rows')}）`)

// 换类型：真实点开下拉再点选项
await tap(P('vr-select[data-track="columns:1"]'), 350)
const options = await page.locator(`#${SELECTPOP} [data-item]`).evaluateAll(els =>
  els.map(e => [e.dataset.item, e.textContent]))
await tap(page.locator(`#${SELECTPOP} [data-item="fixed"]`))
const retyped = await tracks('vg-grid', 'columns')
T('2.12.6', JSON.stringify(options) === JSON.stringify([['fill', '等分'], ['fixed', '固定'], ['hug', '贴合']])
  && retyped[1].type === 'fixed' && retyped[1].value === '100px'
  && await inline('vg-grid', 'grid-template-columns') === '200px 100px auto',
  `换类型时值一起换成该类型的默认写法，1fr 不会被留在「固定」上`
  + `（${await inline('vg-grid', 'grid-template-columns')}）`)

// 「贴合」这一档：值换成 auto，值输入同时被禁掉——auto 没有可填的数
await tap(P('vr-select[data-track="rows:1"]'), 350)
await tap(page.locator(`#${SELECTPOP} [data-item="hug"]`))
const hug = await page.evaluate(() => {
  const t = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('.track[data-axis="rows"][data-i="1"]')
  return { value: t.querySelector('.track-v').value, disabled: t.querySelector('.track-v').disabled }
})
T('2.12.6b', hug.value === 'auto' && hug.disabled === true
  && await inline('vg-grid', 'grid-template-rows') === '1fr auto',
  `换成「贴合」写 auto 并把值输入禁掉（grid-template-rows: `
  + `${await inline('vg-grid', 'grid-template-rows')}）`)

const vin = P('.track-v[data-axis="columns"][data-i="1"]')
await vin.scrollIntoViewIfNeeded()
await vin.click()
await vin.fill('240')
await vin.press('Enter')
await page.waitForTimeout(400)
const revalued = await tracks('vg-grid', 'columns')
T('2.12.7', revalued[1].value === '240px'
  && await inline('vg-grid', 'grid-template-columns') === '200px 240px auto',
  `裸数字补 px（240 → ${revalued[1].value}）`)

// 带单位 / 带函数的原样留着，不该被当成裸数字
await vin.click(); await vin.fill('30%'); await vin.press('Enter'); await page.waitForTimeout(400)
const pct = await tracks('vg-grid', 'columns')
T('2.12.7b', pct[1].value === '30%' && await inline('vg-grid', 'grid-template-columns') === '200px 30% auto',
  `已经带单位的原样留着，不会被补成 30%px（${await inline('vg-grid', 'grid-template-columns')}）`)

// 全删空
await select('#vg-grid3', { x: 4, y: 4 })
await openGridSettings()
for (let i = 0; i < 3; i++) await tap(P('.del-track[data-axis="columns"][data-i="0"]'))
const emptied = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = sr.querySelector('section[data-group="grid-columns"]')
  return {
    tracks: sec.querySelectorAll('.track').length,
    empty: sec.querySelector('.empty-track')?.textContent ?? null,
    inline: document.getElementById('vg-grid3').style.getPropertyValue('grid-template-columns'),
    attr: /grid-template-columns/.test(document.getElementById('vg-grid3').getAttribute('style') || ''),
  }
})
T('2.12.8', emptied.tracks === 0 && emptied.inline === '' && !emptied.attr
  && emptied.empty === '还没有列',
  `轨道全删空时写空串、把声明整条清掉（inline="${emptied.inline}"，空态文案「${emptied.empty}」）`)

// 换元素自动退回（此刻还停在 #vg-grid3 的网格设置里）
const inSub = await page.evaluate(() => !!document.querySelector('visual-revise-panel')
  .shadowRoot.querySelector('section[data-group="grid-columns"]'))
await select('#vg-grid2', { x: 4, y: 4 })
const afterSwitch = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    grid: !!sr.querySelector('section[data-group="grid-columns"]'),
    layout: !!sr.querySelector('section[data-group="layout"]'),
    tag: sr.querySelector('header .tag')?.textContent ?? null,
  }
})
T('2.12.9', inSub && !afterSwitch.grid && afterSwitch.layout && afterSwitch.tag !== '网格设置',
  `换选元素自动退回主面板，不会停在上一个元素的网格设置里（tag=${afterSwitch.tag}）`)

// 只声明了列、行交给隐式网格的元素：行分区是空态而不是一堆假轨道
await openGridSettings()
const implicit = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = a => sr.querySelector(`section[data-group="grid-${a}"]`)
  return {
    cols: sec('columns').querySelectorAll('.track').length,
    rows: sec('rows').querySelectorAll('.track').length,
    empty: sec('rows').querySelector('.empty-track')?.textContent ?? null,
  }
})
T('2.12.3b', implicit.cols === 2 && implicit.rows === 0 && implicit.empty === '还没有行',
  `只声明了 grid-template-columns 的元素，行分区显示空态而不是按子元素数编出几条轨道`
  + `（列 ${implicit.cols} 条 / 行「${implicit.empty}」）`)

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
