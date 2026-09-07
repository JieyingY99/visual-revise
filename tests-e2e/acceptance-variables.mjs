// PRD 验收：颜色弹层的「Custom | 变量」两页、填充层的变量绑定、!important 写入、
// Typography 只给文字元素。见 docs/PRD.md §6 的 AC-6.31 ~ AC-6.35。
//
// 全部走真实点击（locator.click / mouse）——这个仓库里 element.click() 那种
// 程序化派发不触发 pointer 事件链，绑定行的拖拽守卫、弹层的外点关闭都测不到。
// 面板本身是滚动容器，点行之前先 scrollIntoViewIfNeeded。
// 弹层内容在 shadow root 里：`>` 子代选择器不跨 shadow，一律用 [data-item] /
// [data-page] 这类属性做后代选择。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const AC = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

console.log('\n[PRD 验收] 批次 7：颜色变量 / !important / Typography 可见性\n')
await page.goto(origin)

// 变量故意分散在四种写法里：顶层 :root、@media、@layer、容器类。
// 早先的 cssVariables() 只扫每张表顶层的 :root/html，后三种一个都收不到——
// 而现代设计系统的 token 大多就写在 @layer base / @media 里。
await page.addStyleTag({ content:
  ':root{--vr-ink:#22cc88;--vr-font:Inter, sans-serif;--vr-len:12px;--vr-num:1.25;'
  + Array.from({ length: 18 }, (_, i) => `--vr-bulk-${i}:#${((i * 53) % 4096).toString(16).padStart(3, '0')};`).join('')
  + '}'
  + '@media all{:root{--vr-media-line:#ff8800}}'
  + '@layer base{:root{--vr-layer-bg:#3355ff}}'
  + '.vr-scope{--vr-scoped:#aa22cc}'
  // 样式表里的 !important：面板写 inline 压不过它，这正是 AC-6.34 要修的
  + '#imp{color:var(--vr-ink)!important;font-weight:400!important;padding:4px 8px!important}'
  + '#imp2{color:blue!important}'
  // background 简写里的绑定：含 var() 的简写在 CSSOM 里对长手返回空串
  + '.vr-sh{background:linear-gradient(var(--vr-ink), var(--vr-ink))}' })

await page.evaluate(() => {
  const add = (id, cls, css, html) => {
    const d = document.createElement('div')
    d.id = id
    if (cls) d.className = cls
    d.style.cssText = css
    if (html !== undefined) d.innerHTML = html
    document.body.appendChild(d)
    return d
  }
  // 有直接文字：文字色、Typography 都在
  add('vb', 'vr-scope', 'position:absolute;left:24px;top:640px;width:240px;padding:12px;'
    + 'border:2px solid #888;color:#ddd;background:#333', '变量绑定测试')
  // 只装着子元素的容器：没有直接文字
  add('vplain', '', 'position:absolute;left:300px;top:640px;width:200px;height:90px;background:#444',
    '<span>子</span>')
  add('imp', '', 'position:absolute;left:530px;top:640px;width:180px', '带 important 的一行')
  add('imp2', '', 'position:absolute;left:740px;top:640px;width:180px;color:red', '页面自带 inline')
  add('vsh', 'vr-sh', 'position:absolute;left:24px;top:760px;width:180px;height:60px')
})

await injectVisBug(page, origin)
await page.waitForTimeout(400)

const P = sel => page.locator(`visual-revise-panel ${sel}`)
const COLORPOP = 'visual-revise-color-panel'
const FILLPOP = 'visual-revise-fill-panel'
const MENU = 'visual-revise-menu'
const exists = id => page.evaluate(x => !!document.getElementById(x), id)
const inline = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i).style.getPropertyValue(p), [id, prop])
const priority = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i).style.getPropertyPriority(p), [id, prop])
const computed = (id, prop) => page.evaluate(([i, p]) =>
  getComputedStyle(document.getElementById(i)).getPropertyValue(p), [id, prop])
const total = () => page.evaluate(() => window.__visualRevise.store.stats().total)

// 选中：先 Esc 清掉上一个选中，否则选中框的把手会拦住点击
const select = async (sel, pos = { x: 6, y: 6 }) => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  await page.locator(sel).first().click({ position: pos })
  await page.waitForTimeout(500)
}
const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.click(); await page.waitForTimeout(400) }
// 弹层里的行：内容在 shadow root 里，按属性做后代选择
const popItems = id => page.evaluate(x => {
  const host = document.getElementById(x)
  return host ? [...host.shadowRoot.querySelectorAll('[data-item]')].map(r => r.dataset.item) : null
}, id)
const pages = id => page.evaluate(x => {
  const host = document.getElementById(x)
  return host ? [...host.shadowRoot.querySelectorAll('[data-page]')].map(b => b.textContent.trim()) : null
}, id)

// ── 6.35 Typography 只给文字元素 ─────────────────────────────
console.log('── 6.35 Typography 可见性')
const sections = () => P('section').evaluateAll(els => els.map(el => el.dataset.group))
const fillProps = () => P('section[data-group="fill"] [data-prop]')
  .evaluateAll(els => [...new Set(els.map(el => el.dataset.prop))].filter(p => !p.includes(',')))

await select('#vplain', { x: 150, y: 70 })
const plainSections = await sections()
const plainProps = await fillProps()
AC('AC-6.35a', !plainSections.includes('typography') && !plainProps.includes('color'),
   `没有直接文字的 div：没有 Typography 分区、没有「文字色」行（${plainSections.join(' → ')}）`)

// 面板之外改了字号（VisBug 的字体工具就是直接写 inline）：分区要能回来，
// 否则改动记录里躺着一条 font-size，面板上却找不到任何地方改回去。
// 这一条必须排在「选中文字元素」之前跑：自动展开是面板实例状态，
// 选过一次文字元素之后 typography 就不再是折叠态了
await page.evaluate(() => { document.getElementById('vplain').style.fontSize = '22px' })
await select('#vplain', { x: 150, y: 70 })
const dirtyState = await page.evaluate(() => {
  const sec = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="typography"]')
  return { exists: !!sec, folded: sec?.hasAttribute('folded') ?? null }
})
await tap(P('section[data-group="typography"] .undo[data-undo="typography"]'))
const afterReset = {
  size: await inline('vplain', 'font-size'),
  section: await page.evaluate(() => !!document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="typography"]')),
}
AC('AC-6.35c', dirtyState.exists && dirtyState.folded === true
  && afterReset.size === '' && !afterReset.section,
   `容器上有 font-size 改动时 Typography 以折叠态出现，重置本组后改动没了、分区也随之收回`
   + `（${JSON.stringify(dirtyState)} → ${JSON.stringify(afterReset)}）`)

await select('#vb')
const textSections = await sections()
const textProps = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    typo: !!sr.querySelector('section[data-group="typography"]'),
    color: !!sr.querySelector('section[data-group="fill"] vr-color[data-prop="color"], '
      + 'section[data-group="fill"] .var-chip[data-var-chip="color"]'),
  }
})
// 内联 <svg>：文字在子 <text> 里，isTextElement 认不出来，但它确实继承 font-*
await page.evaluate(() => {
  if (document.querySelector('.vr-svg')) return
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'vr-svg')
  svg.setAttribute('width', '120'); svg.setAttribute('height', '60')
  svg.style.cssText = 'position:absolute;left:240px;top:760px'
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  t.setAttribute('x', '10'); t.setAttribute('y', '30'); t.textContent = 'label'
  svg.appendChild(t)
  document.body.appendChild(svg)
})
await select('.vr-svg')
const svgSections = await sections()
AC('AC-6.35b', textSections.includes('typography') && textProps.typo && textProps.color
  && svgSections.includes('typography'),
   `有直接文字的元素两者都在；内联 <svg> 仍有 Typography（${svgSections.join(' → ')}）`)

// ── 6.31 颜色弹层的两页 ──────────────────────────────────────
console.log('── 6.31 颜色弹层 Custom | 变量')
await select('#vb')

await tap(P('section[data-group="stroke"] vr-color .swatch').first())
const strokePages = await pages(COLORPOP)
const onCustom = await page.evaluate(x =>
  !!document.getElementById(x)?.shadowRoot.querySelector('.sv'), COLORPOP)
AC('AC-6.31a', JSON.stringify(strokePages) === JSON.stringify(['自定义', '变量']) && onCustom,
   `描边色的弹层顶上是 Custom | 变量，未绑定时默认停在 Custom（${strokePages?.join(' | ')}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(200)

// 效果参数面板里的阴影色没有这一行：效果模型从 computed 反解，var() 存不住，
// 给一个绑上去就活不过一次编辑的入口比不给更糟
await tap(P('.add[data-add="effects"]'))
await tap(page.locator(`#${MENU} [data-item="drop-shadow"]`))
await tap(P('section[data-group="effects"] [data-effect-open="0"]'))
await tap(page.locator(`#${MENU} vr-color[data-fx="color"] .swatch`))
AC('AC-6.31a2', (await pages(COLORPOP))?.length === 0,
   '效果参数面板里的阴影色只有色盘，没有「变量」页')
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await select('#vb')
await tap(P('section[data-group="effects"] [data-effect-del="0"]'))

// ── 变量页的内容 ──
await tap(P('section[data-group="stroke"] vr-color .swatch').first())
await tap(page.locator(`#${COLORPOP} [data-page="variable"]`))
const items = await popItems(COLORPOP)
const rowShape = await page.evaluate(x => {
  const row = document.getElementById(x).shadowRoot.querySelector('[data-item="--vr-ink"]')
  if (!row) return null
  const kids = [...row.children]
  const dot = kids[0]
  return {
    kids: kids.length,
    radius: getComputedStyle(dot).borderRadius,
    w: dot.offsetWidth, h: dot.offsetHeight,
    bg: dot.style.background,
    name: kids[1].textContent,
    value: kids[2].textContent,
    lastIsCheck: kids.at(-1).tagName === 'SPAN' && !kids.at(-1).textContent.trim(),
  }
}, COLORPOP)
const leaked = (items || []).filter(n => /--vr-(font|len|num)$/.test(n))
AC('AC-6.31b', !!items && leaked.length === 0
  && items.includes('--vr-ink') && items.includes('--vr-media-line')
  && items.includes('--vr-layer-bg') && items.includes('--vr-scoped')
  && rowShape?.kids === 4 && rowShape.radius === '50%' && rowShape.w === 16 && rowShape.h === 16
  && /rgb\(34, 204, 136\)/.test(rowShape.bg) && rowShape.name === '--vr-ink',
   `变量页只列颜色变量，@media / @layer / 容器类里的也在；行是「色圈 16px | 名 | 值 | ✓」`
   + `${leaked.length ? `（混进了 ${leaked.join(',')}）` : ''}`)

const before31 = await total()
await tap(page.locator(`#${COLORPOP} [data-item="--vr-ink"]`))
const chip31 = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const chip = sr.querySelector('section[data-group="stroke"] .var-chip')
  return chip ? chip.querySelector('.var-name').textContent : null
})
AC('AC-6.31c', !(await exists(COLORPOP)) && (await inline('vb', 'border-color')) === 'var(--vr-ink)'
  && chip31 === '--vr-ink' && (await total()) === before31 + 1,
   `变量页点一项：弹层关闭、inline 写 var()、格子变 chip、改动记录 +1（${chip31}）`)

// 已绑定的格子点 chip → 停在变量页、当前项勾着、锚点带 data-menu-open
await tap(P('section[data-group="stroke"] .var-chip'))
const reopen = await page.evaluate(x => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const host = document.getElementById(x)
  const row = host?.shadowRoot.querySelector('[data-item="--vr-ink"]')
  return {
    open: !!host,
    onVariable: !!host?.shadowRoot.querySelector('[data-item]'),
    current: !!row?.hasAttribute('data-current'),
    marked: !!sr.querySelector('section[data-group="stroke"] .var-chip[data-menu-open]'),
  }
}, COLORPOP)
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await tap(P('section[data-group="stroke"] .var-btn'))
const fromTitle = await page.evaluate(x =>
  !!document.getElementById(x)?.shadowRoot.querySelector('[data-item][data-current]'), COLORPOP)
AC('AC-6.31d', reopen.open && reopen.onVariable && reopen.current && reopen.marked && fromTitle,
   `点 chip 与点标题栏「绑定变量」都停在变量页、当前项勾着、锚点带 data-menu-open（${JSON.stringify(reopen)}）`)

// Esc / 点外 / 列表内滚动 / 色盘里再开一层下拉
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
const escClosed = !(await exists(COLORPOP))
await tap(P('section[data-group="stroke"] .var-chip'))
await P('header .tag').click({ force: true }); await page.waitForTimeout(300)
const outClosed = !(await exists(COLORPOP))

await tap(P('section[data-group="stroke"] .var-chip'))
const listBox = await page.evaluate(x => {
  const list = document.getElementById(x)?.shadowRoot.querySelector('[data-item]')?.parentElement
  if (!list) return null
  const r = list.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height, can: list.scrollHeight > list.clientHeight }
}, COLORPOP)
await page.mouse.move(listBox.x + listBox.w / 2, listBox.y + listBox.h / 2)
await page.mouse.wheel(0, 200); await page.waitForTimeout(300)
const scrollKept = await exists(COLORPOP)

// 已绑定的格子从 chip 打开：只有变量列表，没有「自定义 | 变量」那排——绑了变量，
// 色值就不该在这里改，要改颜色先 unlink
const chipPages = await pages(COLORPOP)
AC('AC-6.31f', Array.isArray(chipPages) && chipPages.length === 0
  && (await page.evaluate(x => document.getElementById(x).shadowRoot.querySelectorAll('[data-item]').length, COLORPOP)) > 0,
   `已绑定时点 chip 打开的弹层没有页签，只有变量列表（页签 ${JSON.stringify(chipPages)}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)

// 色盘里的格式下拉挂在 body 上、不在色盘的 DOM 里。少一份兄弟弹层白名单，
// 点一下 RGB 就把色盘关掉——而 select 的提交挂在 click 上，写进空气。
// 色盘只在未绑定的格子上有：先 unlink，再从色块打开
await tap(P('section[data-group="stroke"] [data-unlink]'))
await tap(P('section[data-group="stroke"] vr-color[data-prop="border-color"] .swatch'))
const unboundPages = await pages(COLORPOP)
await tap(page.locator(`#${COLORPOP} vr-select.format`))
await tap(page.locator('#visual-revise-select-panel [data-item="RGB"]'))
const afterFormat = await exists(COLORPOP)
AC('AC-6.31e', escClosed && outClosed && scrollKept && afterFormat
  && JSON.stringify(unboundPages) === JSON.stringify(['自定义', '变量']),
   `Esc 关 ${escClosed} / 点外关 ${outClosed} / 列表内滚动不关 ${scrollKept}（可滚=${listBox.can}）`
   + ` / unlink 后从色块打开有两页 / 切格式到 RGB 后色盘仍在 ${afterFormat}`)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)

// ── 6.32 填充弹层 ────────────────────────────────────────────
console.log('── 6.32 填充弹层的变量页')
await select('#vplain', { x: 150, y: 70 })
await tap(P('section[data-group="fill"] vr-fill .swatch').first())
const fillPages = await pages(FILLPOP)
const fillTabs = await page.evaluate(x =>
  [...document.getElementById(x).shadowRoot.querySelectorAll('[data-tab]')].map(b => b.dataset.tab), FILLPOP)
AC('AC-6.32a', JSON.stringify(fillPages) === JSON.stringify(['自定义', '变量'])
  && JSON.stringify(fillTabs) === JSON.stringify(['none', 'solid', 'gradient', 'image']),
   `填充弹层顶上是 Custom | 变量，Custom 下仍是无 | 纯色 | 渐变 | 图片（${fillTabs.join(' / ')}）`)

await tap(page.locator(`#${FILLPOP} [data-page="variable"]`))
await tap(page.locator(`#${FILLPOP} [data-item="--vr-ink"]`))
const boundBottom = () => page.evaluate(() =>
  document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="fill"] .layers vr-fill[bound]')?.getAttribute('bound') ?? null)
const b0 = { inline: await inline('vplain', 'background-color'), chip: await boundBottom() }

// 再加一层、开关眼睛、改另一层——绑定都得活下来。#writeBackground 每次都整体
// 重写两条属性，写解析色的话这几步里任何一步都会把绑定静默抹掉
await tap(P('section[data-group="fill"] .add[data-add="fill"]'))
const b1 = await inline('vplain', 'background-color')
await tap(P('section[data-group="fill"] [data-layer-eye="0"]'))
const b2 = await inline('vplain', 'background-color')
await tap(P('section[data-group="fill"] [data-layer-eye="0"]'))
const other = P('section[data-group="fill"] vr-fill').first().locator('.text')
await other.scrollIntoViewIfNeeded()
await other.fill('#00ff00'); await other.press('Enter'); await page.waitForTimeout(400)
const b3 = await inline('vplain', 'background-color')
AC('AC-6.32b', b0.inline === 'var(--vr-ink)' && b0.chip === '--vr-ink'
  && b1 === 'var(--vr-ink)' && b2 === 'var(--vr-ink)' && b3 === 'var(--vr-ink)',
   `底层纯色绑变量写 background-color: var()，加层 / 开关眼睛 / 改另一层之后仍在`
   + `（${b0.inline} → ${b1} → ${b2} → ${b3}）`)

// 上层纯色绑变量：颜色进不了 background-image 那一栏，只能写成
// linear-gradient(var(--x), var(--x))
await tap(P('section[data-group="fill"] vr-fill').first().locator('.swatch'))
await tap(page.locator(`#${FILLPOP} [data-page="variable"]`))
await tap(page.locator(`#${FILLPOP} [data-item="--vr-layer-bg"]`))
const upper = await inline('vplain', 'background-image')
const bothBound = await page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot
    .querySelectorAll('section[data-group="fill"] .layers vr-fill')].map(f => f.getAttribute('bound')))
// 页面样式表用 background 简写写的同样认得
await select('#vsh')
const shBound = await boundBottom()
await select('#vplain', { x: 150, y: 70 })
// unlink 只解这一层，别的层不动
await tap(P('section[data-group="fill"] [data-unlink-layer="0"]'))
const afterUnlink = {
  image: await inline('vplain', 'background-image'),
  color: await inline('vplain', 'background-color'),
}
AC('AC-6.32c', /linear-gradient\(var\(--vr-layer-bg\), var\(--vr-layer-bg\)\)/.test(upper)
  && JSON.stringify(bothBound) === JSON.stringify(['--vr-layer-bg', '--vr-ink'])
  && shBound === '--vr-ink'
  && !/var\(/.test(afterUnlink.image) && afterUnlink.color === 'var(--vr-ink)',
   `上层写 linear-gradient(var, var)；background 简写里的绑定也认得（${shBound}）；`
   + `unlink 后只有这一层变回解析色（${afterUnlink.image.slice(0, 44)}）`)

// 渐变层没有可绑的东西：说明一行，不列变量
await select('.swatch')
await tap(P('section[data-group="fill"] vr-fill .swatch').first())
await tap(page.locator(`#${FILLPOP} [data-page="variable"]`))
const gradPage = await page.evaluate(x => {
  const root = document.getElementById(x).shadowRoot
  return { items: root.querySelectorAll('[data-item]').length, text: root.querySelector('.page').textContent.trim() }
}, FILLPOP)
AC('AC-6.32d', gradPage.items === 0 && /不能绑定变量/.test(gradPage.text),
   `渐变层的变量页是说明文字，不列变量（${gradPage.text}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(200)

// 绑定行能拖、能当落点；按在 chip 上手抖不该变成重排
await select('#vplain', { x: 150, y: 70 })
const rowBox = async i => {
  const row = P(`section[data-group="fill"] [data-fill-row="${i}"]`)
  await row.scrollIntoViewIfNeeded()
  return row.boundingBox()
}
const dragRow = async (from, to, grabX) => {
  const a = await rowBox(from), b = await rowBox(to)
  await page.mouse.move(a.x + grabX, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + grabX, a.y + a.height / 2 + 8, { steps: 3 })
  await page.mouse.move(b.x + grabX, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}
// 绑定行的可抓处：chip（vr-fill 的触发器）右边那道 6px 的行间隙。
// chip 本身按下不算拖——它是弹层入口，手抖超过 4px 不该变成重排
const chipX = async i => {
  const f = await P(`section[data-group="fill"] [data-fill-row="${i}"] vr-fill`).boundingBox()
  const r = await rowBox(i)
  return { grip: f.x + f.width + 3 - r.x, chip: f.x + f.width / 2 - r.x }
}
const boundIndex = () => page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot
    .querySelectorAll('section[data-group="fill"] .layers vr-fill')].findIndex(f => f.hasAttribute('bound')))
const beforeDrag = await boundIndex()
// 先把没绑定的那一行拖到绑定行上：绑定行要能当落点
await dragRow(0, 1, 90)
const afterDrop = await boundIndex()
// 再抓着绑定行自己的行间隙拖回去
const grips = await chipX(afterDrop)
await dragRow(afterDrop, afterDrop === 0 ? 1 : 0, grips.grip)
const afterDrag = await boundIndex()
// 按在 chip 上拖：守卫要拦住，顺序不变
const grips2 = await chipX(afterDrag)
await dragRow(afterDrag, afterDrag === 0 ? 1 : 0, grips2.chip)
const afterChipDrag = await boundIndex()
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
AC('AC-6.32e', beforeDrag === 1 && afterDrop === 0 && afterDrag === 1 && afterChipDrag === 1,
   `绑定层能当落点（${beforeDrag} → ${afterDrop}）、抓行间隙能拖回（→ ${afterDrag}）；`
   + `按在 chip 上拖不重排（仍是 ${afterChipDrag}）`)

// ── 6.33 变量菜单已退役 ──────────────────────────────────────
console.log('── 6.33 openMenu 不再承载变量列表')
await select('#vb')
await tap(P('section[data-group="fill"] .var-btn'))
const noMenu = !(await exists(MENU)) && (await exists(COLORPOP))
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await tap(P('.add[data-add="effects"]'))
const fxMenu = (await popItems(MENU))?.length ?? 0
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await tap(P('.mode[data-axis="width"]'))
const rzMenu = (await popItems(MENU))?.length ?? 0
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
AC('AC-6.33', noMenu && fxMenu === 7 && rzMenu >= 3,
   `「绑定变量」开的是颜色弹层而不是菜单；Effects 添加菜单（${fxMenu} 项）与尺寸模式菜单（${rzMenu} 项）不受影响`)

// ── 6.34 !important 写入 ─────────────────────────────────────
console.log('── 6.34 !important')
await select('#imp')
const impChip = await page.evaluate(() => document.querySelector('visual-revise-panel').shadowRoot
  .querySelector('section[data-group="fill"] .var-chip .var-name')?.textContent ?? null)
const beforeUnlink = await computed('imp', 'color')
await tap(P('section[data-group="fill"] [data-unlink]'))
const afterUnlink34 = {
  inline: await inline('imp', 'color'),
  priority: await priority('imp', 'color'),
  computed: await computed('imp', 'color'),
  chip: await page.evaluate(() => !!document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="fill"] .var-chip')),
}
AC('AC-6.34a', impChip === '--vr-ink' && /^rgb/.test(afterUnlink34.inline)
  && afterUnlink34.priority === 'important' && !afterUnlink34.chip
  && afterUnlink34.computed === beforeUnlink,
   `样式表 !important 的字色：unlink 写进带 important 的解析色、chip 消失、画面不变（${JSON.stringify(afterUnlink34)}）`)

// 连改两次都要生效。第一次写完 inline 自己就带 important 了，判定条件写窄一点
// 第二次就会把 priority 摘掉，样式表那条重新赢回去——整段拖动只有第一帧有效
const weight = async v => {
  await tap(P('section[data-group="typography"] vr-select[data-prop="font-weight"]'))
  await tap(page.locator(`#visual-revise-select-panel [data-item="${v}"]`))
}
await weight('700')
const w1 = await computed('imp', 'font-weight')
await weight('600')
const w2 = await computed('imp', 'font-weight')
await page.locator('body').click({ position: { x: 900, y: 300 } })
await page.waitForTimeout(200)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(400)
const w3 = await computed('imp', 'font-weight')
AC('AC-6.34b', w1 === '700' && w2 === '600' && w3 === '700',
   `样式表带 important 时面板改字重能生效，连改两次第二次也生效，撤销能回去（${w1} → ${w2} → undo → ${w3}）`)

// 页面自带 inline（不带 important）+ 样式表 important：不能拿「inline 是空的」
// 当「要不要问层叠」的代理，那种元素永远算不出 important
await select('#imp2')
await tap(P('section[data-group="fill"] vr-color .swatch').first())
await page.locator(`#${COLORPOP} .val`).fill('#00ff00')
await page.locator(`#${COLORPOP} .val`).press('Enter'); await page.waitForTimeout(400)
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
AC('AC-6.34b2', (await computed('imp2', 'color')) === 'rgb(0, 255, 0)'
  && (await priority('imp2', 'color')) === 'important',
   `页面自带 inline + 样式表 important 的元素上面板照样写得进去（computed=${await computed('imp2', 'color')}）`)

// 眼睛按钮走的是「存原文再写回」，原文不带 priority 的话这类元素上点了没反应
await select('#imp')
const eyeBefore = await computed('imp', 'color')
await tap(P('section[data-group="fill"] [data-text-eye]'))
const eyeOff = await computed('imp', 'color')
await tap(P('section[data-group="fill"] [data-text-eye]'))
const eyeOn = await computed('imp', 'color')
AC('AC-6.34c', eyeOff === 'rgba(0, 0, 0, 0)' && eyeOn === eyeBefore,
   `文字色的眼睛在带 important 的元素上能关能开（${eyeBefore} → ${eyeOff} → ${eyeOn}）`)

// 提示词里 important 才拼回值上；四边 padding 带 important 时不折叠成简写
// ——`padding: 4px !important 8px !important …` 是一条非法声明
const padIn = await P('section[data-group="layout"] .side-pair').first().locator('input').all()
await padIn[0].scrollIntoViewIfNeeded()
await padIn[0].fill('7'); await padIn[0].press('Enter'); await page.waitForTimeout(350)
await padIn[1].fill('9'); await padIn[1].press('Enter'); await page.waitForTimeout(350)
const md = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
const importantCells = (md.match(/`[^`]* !important`/g) || []).length
AC('AC-6.34d', /`\d+px !important`/.test(md) && importantCells >= 4
  && !/\| padding /.test(md) && /\| padding-left /.test(md) && /\| padding-top /.test(md),
   `提示词里带 important 的写成 \`值 !important\`（${importantCells} 处），`
   + `四边 padding 不折叠成简写（拼出来会是一条非法声明）`)

const roundTrip = await page.evaluate(async () => {
  const { exportJSON, importJSON } = window.__visualRevise.lib
  const data = exportJSON({})
  const el = document.getElementById('imp')
  const change = data.edits.flatMap(e => e.changes).find(c => c.prop === 'font-weight')
  el.style.removeProperty('font-weight')
  window.__visualRevise.store.clear()
  importJSON(data)
  return {
    schema: data.schema,
    flagged: !!change?.important,
    priority: el.style.getPropertyPriority('font-weight'),
    value: el.style.getPropertyValue('font-weight'),
  }
})
AC('AC-6.34e', roundTrip.schema === 5 && roundTrip.flagged
  && roundTrip.value === '700' && roundTrip.priority === 'important',
   `JSON 里 important 是独立字段（不拼进值），导出再导入后 priority 还在（${JSON.stringify(roundTrip)}）`)

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
