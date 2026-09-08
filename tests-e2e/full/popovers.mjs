// 全量 e2e · 分块「弹层（下拉 / 菜单 / 色盘 / 填充）」= 功能清单 §3（3.1–3.6）。
//
// 四个弹层的宿主都挂在页面 body 上、内容包在 shadow root 里，所以：
//   - 宿主用 document.getElementById(id) 拿，内容一律靠 [data-item] / [data-page] /
//     [data-tab] 这类属性做后代选择（`>` 不跨 shadow）；
//   - 全部走真实交互（locator.click / page.mouse / page.keyboard）——这个仓库里
//     element.click() 那种程序化派发不触发 pointer 链，点外关闭、拖动、hover 高亮
//     一条都测不到；
//   - 面板本身是滚动容器，点行之前先 scrollIntoViewIfNeeded；
//   - Esc 一次只关一层弹层，第二下才取消选中。
//
// 断言落在真实结果上：元素 inline style、弹层 DOM / 计算样式、改动记录
// window.__visualRevise.store，而不是「没报错」。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/popovers-page.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const covered = new Set()
const T = (id, cond, msg) => { covered.add(id); cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }
// §3 前言（AC-6.30「页面 CSS 漏不进弹层」）没有 K 级编号，按二级分区号记，
// 不计进「覆盖的功能点编号」那份清单
const T0 = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

const SEL = 'visual-revise-select-panel'
const MENU = 'visual-revise-menu'
const COLOR = 'visual-revise-color-panel'
const FILL = 'visual-revise-fill-panel'
const PANEL = 'visual-revise-panel'

const P = sel => page.locator(`${PANEL} ${sel}`)
const exists = id => page.evaluate(x => !!document.getElementById(x), id)
const rect = sel => page.evaluate(s => {
  const el = s.startsWith('#') ? document.getElementById(s.slice(1)) : document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height,
           vw: innerWidth, vh: innerHeight }
}, sel)
const within = r => !!r && r.top >= -0.5 && r.left >= -0.5 && r.bottom <= r.vh + 0.5 && r.right <= r.vw + 0.5

// 弹层里的行：内容在 shadow root，按属性做后代选择
const rows = id => page.evaluate(x => {
  const host = document.getElementById(x)
  if (!host) return null
  return [...host.shadowRoot.querySelectorAll('[data-item]')].map(r => ({
    id: r.dataset.item, text: r.textContent.trim(),
    bg: r.style.background, opacity: r.style.opacity, cursor: r.style.cursor,
  }))
}, id)
const hostCss = (id, props) => page.evaluate(([x, ps]) => {
  const host = document.getElementById(x)
  if (!host) return null
  const cs = getComputedStyle(host)
  return Object.fromEntries(ps.map(p => [p, cs.getPropertyValue(p)]))
}, [id, props])

const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.click(); await page.waitForTimeout(320) }
const wheelOver = async (sel, dy) => {
  const b = await page.locator(sel).boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 110))
  await page.mouse.wheel(0, dy)
  await page.waitForTimeout(300)
}
const scrollTop = id => page.evaluate(x => document.getElementById(x)?.scrollTop ?? -1, id)
const panelHidden = () => page.evaluate(() => !!document.querySelector('visual-revise-panel')?.hidden)
// 关掉可能开着的弹层（Esc 一次只关一层），再取消选中
const closePopovers = async () => {
  for (let i = 0; i < 3; i++) {
    if (!(await exists(SEL)) && !(await exists(MENU)) && !(await exists(COLOR)) && !(await exists(FILL))) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  }
}
const select = async (sel, pos = { x: 6, y: 6 }) => {
  await closePopovers()
  await page.keyboard.press('Escape'); await page.waitForTimeout(180)
  await page.locator(sel).click({ position: pos })
  await page.waitForTimeout(500)
}
const inline = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i).style.getPropertyValue(p), [id, prop])
// 改动记录里某条属性最后一次写入的值
const recorded = prop => page.evaluate(p => {
  const all = window.__visualRevise.store.read().edits.flatMap(e => e.changes).filter(c => c.prop === p)
  return all.length ? all[all.length - 1].to : null
}, prop)

console.log('\n[全量 e2e] §3 弹层：下拉 / 菜单 / 色盘 / 填充\n')
await page.goto(FIXTURE)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

// 控件对外派发的事件是唯一能看到「写出去的那个 CSS 字符串原文」的地方：
// 落到 inline style 之后 CSSOM 会把 #ff000066 归一成 rgba(255, 0, 0, 0.4)，
// 改动记录读的也是归一后的 inline，格式相关的断言在那两处都验不出来。
// 这里只是挂一个旁观者，操作仍然全走真实交互。
await page.evaluate(() => {
  window.__vrEvents = []
  const log = (t, v) => window.__vrEvents.push([t, v])
  document.addEventListener('vr-color', e => log('vr-color', e.detail.value), true)
  document.addEventListener('vr-color-variable', e => log('vr-color-variable', e.detail.name), true)
  document.addEventListener('vr-fill', e => log('vr-fill', JSON.stringify(e.detail)), true)
  document.addEventListener('vr-fill-variable', e => log('vr-fill-variable', e.detail.name), true)
  document.addEventListener('vr-fill-pick-image', () => log('vr-fill-pick-image', ''), true)
  document.addEventListener('vr-select', e => log('vr-select', e.detail.value), true)
})
const lastEv = type => page.evaluate(t => {
  const l = window.__vrEvents.filter(e => e[0] === t)
  return l.length ? l[l.length - 1][1] : null
}, type)
const countEv = type => page.evaluate(t => window.__vrEvents.filter(e => e[0] === t).length, type)

// ══════════════════════════════════════════════════════════════
// 3.1 vr-select 下拉
// ══════════════════════════════════════════════════════════════
console.log('── 3.1 vr-select 下拉')
await select('#solid')
const BS = 'vr-select[data-prop="border-style"]'
const bs = P(BS)

// 3.1.1 点触发器展开 / 触发器可聚焦 / Enter、Space 也能展开
await tap(bs)
T('3.1.1', await exists(SEL), '点触发器展开下拉面板')
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
T('3.1.1', await page.evaluate(s => document.querySelector('visual-revise-panel')
  .shadowRoot.querySelector(s).tabIndex, BS) === 0, '触发器 tabIndex=0，可聚焦')
await bs.press('Enter'); await page.waitForTimeout(300)
T('3.1.1', await exists(SEL), 'Enter 展开下拉')
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await bs.press(' '); await page.waitForTimeout(300)
T('3.1.1', await exists(SEL), 'Space 展开下拉')

// 3.1.2 贴触发器下方 / 下方放不下时向上翻 / minWidth 同宽
const trigRect = sel => page.evaluate(s => {
  const r = document.querySelector('visual-revise-panel').shadowRoot.querySelector(s).getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }
}, sel)
{
  // 「贴下方」：Position 分区在面板最上面，下方装得下
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  const POS = 'vr-select[data-prop="position"]'
  await tap(P(POS))
  const trig = await trigRect(POS)
  const pan = await rect(`#${SEL}`)
  const mw = await page.evaluate(x => document.getElementById(x).style.minWidth, SEL)
  T('3.1.2', pan.top >= trig.bottom - 0.5 && pan.top - trig.bottom < 20,
    `面板贴在触发器下方（触发器 bottom=${Math.round(trig.bottom)}，面板 top=${Math.round(pan.top)}）`)
  T('3.1.2', Math.abs(parseFloat(mw) - trig.width) < 1,
    `minWidth 跟触发器同宽（${mw} vs ${Math.round(trig.width)}px）`)
  T('3.1.2', within(pan), '面板夹在视口内')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)

  // 「向上翻」：描边样式在面板底部，下方剩不下一整个面板
  await tap(bs)
  const trig2 = await trigRect(BS)
  const pan2 = await rect(`#${SEL}`)
  T('3.1.2', pan2.bottom <= trig2.top + 0.5 && within(pan2),
    `下方放不下时向上翻（触发器 top=${Math.round(trig2.top)}，面板 bottom=${Math.round(pan2.bottom)}，视口 ${pan2.vh}）`)
}

// 3.1.3 当前值蓝底 / 键盘高亮浅底
{
  const list = await rows(SEL)
  const cur = list.find(r => r.id === 'solid')
  T('3.1.3', /13,\s*153,\s*255/.test(cur?.bg || '') && !/0\.22|\/ ?\.22/.test(cur?.bg || ''),
    `当前值那一项蓝底（${cur?.bg}）`)
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150)
  const after = await rows(SEL)
  const lit = after.filter(r => /0\.09/.test(r.bg))
  T('3.1.3', lit.length === 1 && !/13,\s*153,\s*255/.test(lit[0].bg),
    `键盘高亮项是浅底而不是蓝底（${lit[0]?.id} → ${lit[0]?.bg}）`)
  // 3.1.4 起点落在当前值上：solid 是第 2 项，按一下 ↓ 高亮应该到 dashed
  T('3.1.4', lit[0]?.id === 'dashed', `↓ 一次高亮走到当前值的下一项（起点在当前值 solid → ${lit[0]?.id}）`)
}

// 3.1.4 ArrowUp / ArrowDown 循环，Enter 选中高亮项
{
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150)
  let lit = (await rows(SEL)).find(r => /0\.09/.test(r.bg))
  T('3.1.4', lit?.id === 'none', `↑ 两次回到第一项（${lit?.id}）`)
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150)
  lit = (await rows(SEL)).find(r => /0\.09/.test(r.bg))
  T('3.1.4', lit?.id === 'double', `再 ↑ 循环到最后一项（${lit?.id}）`)
  await page.keyboard.press('Enter'); await page.waitForTimeout(350)
  T('3.1.4', !(await exists(SEL)) && await inline('solid', 'border-style') === 'double',
    `Enter 选中高亮项并写回页面（border-style=${await inline('solid', 'border-style')}）`)
}

// 3.1.5 pointerenter → 高亮跟到那一项
{
  await tap(bs)
  const box = await page.locator(`#${SEL} [data-item="dotted"]`).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)
  const lit = (await rows(SEL)).find(r => /0\.09/.test(r.bg))
  T('3.1.5', lit?.id === 'dotted', `鼠标移到某项高亮跟过去（${lit?.id}）`)
}

// 3.1.6 点选项 → 关闭 + 写回 value + 派发 vr-select（表现为页面 inline 被改写）
{
  await page.locator(`#${SEL} [data-item="dashed"]`).click()
  await page.waitForTimeout(400)
  const val = await bs.getAttribute('value')
  T('3.1.6', !(await exists(SEL)), '点选项后下拉关闭')
  T('3.1.6', val === 'dashed', `选中写回触发器 value（${val}）`)
  T('3.1.6', await inline('solid', 'border-style') === 'dashed' && await recorded('border-style') === 'dashed',
    `vr-select 事件落到页面并进改动记录（inline=${await inline('solid', 'border-style')}，记录=${await recorded('border-style')}）`)
}

// 3.1.7 Esc 关闭且 stopPropagation（不会一路走到「取消选中」）
{
  await tap(bs)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  T('3.1.7', !(await exists(SEL)), 'Esc 关闭下拉')
  T('3.1.7', !(await panelHidden()), 'Esc 只关下拉，选中没丢（属性面板还开着）')
}

// 3.1.8 点弹层外关闭
{
  await tap(bs)
  await P('header .tag').click({ force: true }); await page.waitForTimeout(300)
  T('3.1.8', !(await exists(SEL)), '点弹层外（面板标题）关闭下拉')
}

// 3.1.9 下拉内部滚动不关；页面滚动关；resize 关
{
  const fw = P('vr-select[data-prop="font-weight"]')   // 9 项 × 40px > max-height 320
  await tap(fw)
  const canScroll = await page.evaluate(x => {
    const p = document.getElementById(x); return p.scrollHeight > p.clientHeight
  }, SEL)
  await wheelOver(`#${SEL}`, 200)
  T('3.1.9', canScroll && await exists(SEL) && (await scrollTop(SEL)) > 0,
    `在下拉内部滚动不关闭、内容真的滚了（scrollTop=${await scrollTop(SEL)}）`)
  await page.mouse.move(700, 700); await page.mouse.wheel(0, 300); await page.waitForTimeout(350)
  T('3.1.9', !(await exists(SEL)), '页面滚动关闭下拉')
  await page.mouse.wheel(0, -400); await page.waitForTimeout(300)

  await tap(fw)
  await page.setViewportSize({ width: 1400, height: 880 }); await page.waitForTimeout(350)
  T('3.1.9', !(await exists(SEL)), 'resize 关闭下拉')
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(350)
}

// 3.1.11 当前值不在 options 里时插到最前
await select('#mixed', { x: 100, y: 40 })
{
  const bg = P('vr-select[data-prop="background-size"]')
  const val = await bg.getAttribute('value')
  const opts = JSON.parse(await bg.getAttribute('options'))
  await tap(bg)
  const list = await rows(SEL)
  T('3.1.11', opts[0] === val && list[0]?.id === val && opts.length === 4,
    `当前值 ${val} 不在 auto/cover/contain 里，被插到列表最前（options=${JSON.stringify(opts)}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
}

// 3.1.10 options 两种形态：["a","b"] 与 [[值,显示名]]
{
  // 形态一：border-style 用的是纯字符串数组 —— 行文字就是值本身
  await select('#solid')
  await tap(bs)
  const plain = await rows(SEL)
  T('3.1.10', plain.every(r => r.id === r.text) && plain.length === 5,
    `["a","b"] 形态：行文字就是值（${plain.map(r => r.text).join('/')}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
}

// ══════════════════════════════════════════════════════════════
// 3.3 openPopover 自定义弹层（网格点阵）+ 3.1.10 形态二 + 3.2.10 align:left
// ══════════════════════════════════════════════════════════════
console.log('── 3.3 openPopover（网格点阵）')
await select('#gridbox', { x: 8, y: 8 })
{
  T('3.3', await P('.grid-shape').count() === 1, 'display:grid 的元素上出现「网格」触发按钮')
  await tap(P('.grid-shape'))
  T('3.3', await exists(MENU), 'openPopover 复用菜单宿主 id 打开自定义弹层')
  const shape = await page.evaluate(x => {
    const r = document.getElementById(x)?.shadowRoot
    if (!r) return null
    return {
      dots: r.querySelectorAll('.gp-dot').length,
      inputs: [...r.querySelectorAll('.gp-n')].map(i => i.dataset.axis),
      settings: !!r.querySelector('.gp-settings'),
      on: r.querySelectorAll('.gp-dot[data-on]').length,
      cols: r.querySelector('.gp-n[data-axis="columns"]').value,
      rows: r.querySelector('.gp-n[data-axis="rows"]').value,
    }
  }, MENU)
  T('3.3', shape?.dots === 144 && shape.inputs.join(',') === 'columns,rows' && shape.settings,
    `内容由回调自绘（12×12 点阵 ${shape?.dots} 个 + 行列输入 + 二级设置入口）`)
  T('3.3', shape?.on === 2 && shape.cols === '2' && shape.rows === '1',
    `点阵按当前网格（2 列 × 1 行）预点亮 ${shape?.on} 格，行列输入回填 ${shape?.cols}×${shape?.rows}`)

  const anchor = await trigRect('.grid-shape')
  const pop = await rect(`#${MENU}`)
  T('3.2.10', Math.abs(pop.left - anchor.left) < 2 && within(pop),
    `align 默认 left：弹层左缘贴锚点左缘（${Math.round(pop.left)} vs ${Math.round(anchor.left)}）`)

  // 点弹层里的「打开网格设置」进二级视图，那里的轨道类型下拉是 [[值,显示名]] 形态
  await page.locator(`#${MENU} .gp-settings`).click(); await page.waitForTimeout(450)
  T('3.3', !(await exists(MENU)), '点弹层内的按钮后弹层关闭（回调里 close 掉自己）')
  const tt = P('vr-select[data-track="columns:0"]')
  // 触发器的文字在 vr-select 自己的 shadow root 里，宿主上取不到
  const trackLabel = () => page.evaluate(() => document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('vr-select[data-track="columns:0"]').shadowRoot.querySelector('.label').textContent.trim())
  T('3.1.10', await trackLabel() === '等分',
    `[[值,显示名]] 形态：触发器显示的是显示名（${await trackLabel()}）`)
  await tap(tt)
  const pairs = await rows(SEL)
  T('3.1.10', JSON.stringify(pairs.map(r => [r.id, r.text]))
    === JSON.stringify([['fill', '等分'], ['fixed', '固定'], ['hug', '贴合']]),
    `选项行的 data-item 是值、文字是显示名（${pairs.map(r => `${r.id}=${r.text}`).join(' ')}）`)
  await page.locator(`#${SEL} [data-item="fixed"]`).click(); await page.waitForTimeout(450)
  T('3.1.10', await tt.getAttribute('value') === 'fixed'
    && /100px/.test(await inline('gridbox', 'grid-template-columns')),
    `选显示名写回的是值（value=${await tt.getAttribute('value')}，页面 grid-template-columns=${await inline('gridbox', 'grid-template-columns')}）`)
  await tap(P('header .back'))
}

// ══════════════════════════════════════════════════════════════
// 3.2 openMenu 菜单（尺寸模式菜单 / 效果菜单）
// ══════════════════════════════════════════════════════════════
console.log('── 3.2 openMenu 菜单')
await select('#solid')
const MODE_W = '.mode[data-axis="width"]'
const modeW = P(MODE_W)

// 3.2.1 同一锚点再点一次 = 关闭
{
  await tap(modeW)
  T('3.2.1', await exists(MENU), '点尺寸模式按钮打开菜单')
  await tap(modeW)
  T('3.2.1', !(await exists(MENU)), '再点同一个锚点关闭（toggle）')
}

// 3.2.2 项形态：对勾位 + label + hint
{
  await tap(modeW)
  const shape = await page.evaluate(x => {
    const r = document.getElementById(x).shadowRoot
    const row = r.querySelector('[data-item="fixed"]')
    const kids = [...row.children]
    const cs = el => getComputedStyle(el)
    return {
      checkW: cs(kids[0]).width, checkGrow: cs(kids[0]).flexGrow,
      hasCheckSvg: !!kids[0].querySelector('svg'),
      uncheckedEmpty: r.querySelector('[data-item="hug"]').children[0].innerHTML.trim(),
      uncheckedW: cs(r.querySelector('[data-item="hug"]').children[0]).width,
      label: kids[1]?.textContent, labelGrow: cs(kids[1]).flexGrow,
      hint: kids[2]?.textContent, hintOpacity: kids[2]?.style.opacity,
      hugHasHint: r.querySelector('[data-item="hug"]').lastElementChild.textContent,
    }
  }, MENU)
  T('3.2.2', shape.checkW === '12px' && shape.checkGrow === '0' && shape.hasCheckSvg
    && shape.uncheckedEmpty === '' && shape.uncheckedW === '12px',
    `对勾占最左一格（12px 定宽，选中项有 svg、未选中项留空但同宽 ${shape.uncheckedW}）`)
  T('3.2.2', shape.label === '固定宽度' && shape.labelGrow === '1',
    `label 撑满中间（${shape.label}，flex-grow=${shape.labelGrow}）`)
  T('3.2.2', /^\d+(\.\d+)?px$/.test(shape.hint) && shape.hintOpacity === '0.45'
    && shape.hugHasHint === 'fit-content',
    `hint 贴右侧、半透明（固定=${shape.hint}，贴合=${shape.hugHasHint}）`)
}

// 3.2.3 separator 渲染分隔线
{
  const sep = await page.evaluate(x => {
    const kids = [...document.getElementById(x).shadowRoot.children]
    const i = kids.findIndex(k => !k.dataset.item && k.style.height === '1px')
    return { i, before: kids[i - 1]?.dataset.item, after: kids[i + 1]?.dataset.item,
             bg: kids[i]?.style.background }
  }, MENU)
  T('3.2.3', sep.i > 0 && sep.before === 'fill' && sep.after === 'min' && /rgba?\(/.test(sep.bg),
    `separator 渲染成 1px 分隔线，夹在 fill 与 min 之间（bg=${sep.bg}）`)
}

// 3.2.5 checked 项底色 / hover 非选中项浅底
{
  const list = await rows(MENU)
  const fixed = list.find(r => r.id === 'fixed')
  T('3.2.5', /13,\s*153,\s*255,\s*0\.22/.test(fixed.bg), `checked 项底色 rgb(13 153 255 / .22)（${fixed.bg}）`)
  const box = await page.locator(`#${MENU} [data-item="hug"]`).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(200)
  const hovered = (await rows(MENU)).find(r => r.id === 'hug')
  T('3.2.5', /255,\s*255,\s*255,\s*0\.09/.test(hovered.bg), `hover 非选中项浅底（${hovered.bg}）`)
  await page.mouse.move(box.x + box.width / 2, box.y - 40); await page.waitForTimeout(200)
  T('3.2.5', (await rows(MENU)).find(r => r.id === 'hug').bg === 'transparent', '移开后底色收回')
}

// 3.2.10 align:'right' —— 尺寸菜单贴锚点右缘
{
  const anchor = await trigRect(MODE_W)
  const pop = await rect(`#${MENU}`)
  T('3.2.10', Math.abs(pop.right - anchor.right) < 2 && within(pop),
    `align:'right' 贴锚点右缘（${Math.round(pop.right)} vs ${Math.round(anchor.right)}）`)
  T('3.2.10', pop.top >= anchor.bottom - 0.5, `下方装得下就贴下方（菜单 top=${Math.round(pop.top)}）`)
}

// 3.2.11 max-height 70vh + overflow-y auto + overscroll contain
{
  const css = await hostCss(MENU, ['max-height', 'overflow-y', 'overscroll-behavior-y'])
  const vh = await page.evaluate(() => innerHeight)
  T('3.2.11', Math.abs(parseFloat(css['max-height']) - vh * 0.7) < 2
    && css['overflow-y'] === 'auto' && css['overscroll-behavior-y'] === 'contain',
    `max-height 70vh(${css['max-height']}) / overflow-y ${css['overflow-y']} / overscroll ${css['overscroll-behavior-y']}`)
}

// 3.2.6 点项 → 关闭 + onPick 生效
{
  await page.locator(`#${MENU} [data-item="hug"]`).click(); await page.waitForTimeout(450)
  T('3.2.6', !(await exists(MENU)) && await inline('solid', 'width') === 'fit-content',
    `点「贴合内容」关闭菜单并写入页面（width=${await inline('solid', 'width')}）`)
  await tap(modeW)
  await page.locator(`#${MENU} [data-item="fixed"]`).click(); await page.waitForTimeout(450)
  T('3.2.6', /px$/.test(await inline('solid', 'width')), `切回固定写出像素值（${await inline('solid', 'width')}）`)
}

// 3.2.4 disabled 项：变灰、不绑事件
{
  await tap(modeW)
  await page.locator(`#${MENU} [data-item="min"]`).click(); await page.waitForTimeout(450)
  T('3.2.4', await P('input[data-prop="min-width"]').count() === 1, '先点「添加最小宽度…」把那条限制显示出来')
  await tap(modeW)
  const dis = (await rows(MENU)).find(r => r.id === 'min')
  T('3.2.4', dis.opacity === '0.4' && dis.cursor === 'not-allowed',
    `已有限制后该项 disabled：opacity ${dis.opacity} / cursor ${dis.cursor}`)
  const before = await inline('solid', 'min-width')
  await page.locator(`#${MENU} [data-item="min"]`).click(); await page.waitForTimeout(350)
  T('3.2.4', await exists(MENU) && await inline('solid', 'min-width') === before,
    'disabled 项没绑任何事件：点它菜单不关、也不写任何东西')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  await tap(P('.drop-limit[data-prop="min-width"]'))   // 收拾干净，别影响后面的断言
}

// 3.2.7 Esc 关闭并 stopPropagation
{
  await tap(modeW)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  T('3.2.7', !(await exists(MENU)), 'Esc 关闭菜单')
  T('3.2.7', !(await panelHidden()), 'Esc 只关菜单，选中没丢')
}

// 3.2.8 点外关闭
{
  await tap(modeW)
  await P('header .tag').click({ force: true }); await page.waitForTimeout(300)
  T('3.2.8', !(await exists(MENU)), '点弹层外关闭菜单')
}

// 3.2.9 页面滚动 / resize 关闭；菜单上滚动不关（overscroll-behavior:contain 不外传）
{
  await tap(modeW)
  const y0 = await page.evaluate(() => scrollY)
  await wheelOver(`#${MENU}`, 300)
  T('3.2.9', await exists(MENU) && await page.evaluate(() => scrollY) === y0,
    '在菜单上滚动不关闭：overscroll-behavior:contain 把滚动兜住，页面没跟着走')
  await page.mouse.move(700, 700); await page.mouse.wheel(0, 300); await page.waitForTimeout(350)
  T('3.2.9', !(await exists(MENU)), '页面滚动关闭菜单')
  await page.mouse.wheel(0, -400); await page.waitForTimeout(250)
  await tap(modeW)
  await page.setViewportSize({ width: 1400, height: 880 }); await page.waitForTimeout(350)
  T('3.2.9', !(await exists(MENU)), 'resize 关闭菜单')
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(350)
}

// 3.2.9 / 3.2.10 矮屏：菜单本身超过 70vh 时自带滚动条，且下方装不下要向上翻
{
  await page.setViewportSize({ width: 1440, height: 300 }); await page.waitForTimeout(450)
  await select('#solid')
  const addFx = P('.add[data-add="effects"]')
  await tap(addFx)
  const anchor = await trigRect('.add[data-add="effects"]')
  const pop = await rect(`#${MENU}`)
  const canScroll = await page.evaluate(x => {
    const p = document.getElementById(x); return p ? p.scrollHeight > p.clientHeight : false
  }, MENU)
  T('3.2.10', pop && pop.bottom <= anchor.top + 0.5 && within(pop),
    `矮屏下方装不下时菜单向上翻（锚点 top=${Math.round(anchor.top)}，菜单 bottom=${Math.round(pop.bottom)}，视口 ${pop.vh}）`)
  await wheelOver(`#${MENU}`, 200)
  T('3.2.9', canScroll && await exists(MENU) && (await scrollTop(MENU)) > 0,
    `菜单被 70vh 截短后自己滚，滚它不关闭（scrollTop=${await scrollTop(MENU)}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(450)
  await select('#solid')
}

// ══════════════════════════════════════════════════════════════
// 3.5 vr-color 单色控件（触发行）
// ══════════════════════════════════════════════════════════════
console.log('── 3.5 vr-color 触发行')
await select('#solid')
const CSW = 'vr-color[data-prop="color"] .swatch'
const cswatch = P(CSW)
// vr-color 触发行里的三个字段（都在 vr-color 自己的 shadow root 里）
const colorTrigger = (prop = 'color') => page.evaluate(p => {
  const host = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector(`vr-color[data-prop="${p}"]`)
  if (!host) return null
  const r = host.shadowRoot
  const sw = r.querySelector('.swatch')
  const cs = getComputedStyle(sw)
  return {
    swW: cs.width, swH: cs.height, checker: cs.backgroundImage.includes('linear-gradient'),
    text: r.querySelector('.text')?.value, sep: !!r.querySelector('.sep'),
    alpha: r.querySelector('.alpha')?.value, pct: r.querySelector('.pct')?.textContent,
    value: host.getAttribute('value'),
    open: host.hasAttribute('data-open'), menuOpen: host.hasAttribute('data-menu-open'),
  }
}, prop)
const setField = async (prop, field, v) => {
  const i = page.locator(`${PANEL} vr-color[data-prop="${prop}"] .${field}`)
  await i.scrollIntoViewIfNeeded(); await i.fill(String(v)); await i.press('Enter')
  await page.waitForTimeout(350)
}
const cssColor = () => page.evaluate(() => getComputedStyle(document.getElementById('solid')).color)
// 颜色字符串 → [r,g,b,(a)]，十六进制与 rgb()/rgba() 都吃：
// 控件 emit 的是 #rrggbb，落到 inline / DOM style 之后又被 CSSOM 归一成 rgb(...)
const parseRgb = v => {
  const t = String(v || '').trim()
  const m = t.match(/^#([0-9a-f]{3,8})$/i)
  if (!m) return (t.match(/[\d.]+/g) || []).map(Number)
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
  const out = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  if (h.length === 8) out.push(Math.round(parseInt(h.slice(6, 8), 16) / 2.55) / 100)
  return out
}
const rgbStr = a => `rgb(${a[0]}, ${a[1]}, ${a[2]})`
const sameRgb = (a, b) => {
  const x = parseRgb(a), y = parseRgb(b)
  return x.length >= 3 && y.length >= 3 && x[0] === y[0] && x[1] === y[1] && x[2] === y[2]
}
const hueOf = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (!d) return 0
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

// 3.5.1 触发行 = 色块 32×32（棋盘格底）+ 色值 + 分隔线 + 不透明度 + %
{
  const t = await colorTrigger()
  T('3.5.1', t.swW === '32px' && t.swH === '32px' && t.checker,
    `色块 ${t.swW}×${t.swH}，棋盘格底`)
  T('3.5.1', t.text === '#dddddd' && t.sep && t.alpha === '100' && t.pct === '%',
    `色值 ${t.text} | 分隔线 | 不透明度 ${t.alpha}${t.pct}`)
}

// 3.5.2 点色块开弹层；点输入框不开
{
  const textInput = P('vr-color[data-prop="color"] .text')
  await textInput.scrollIntoViewIfNeeded(); await textInput.click(); await page.waitForTimeout(350)
  T('3.5.2', !(await exists(COLOR)), '点色值输入框不弹色盘（composedPath 认出真实 target 是 INPUT）')
  await tap(cswatch)
  T('3.5.2', await exists(COLOR), '点色块打开颜色弹层')
}

// 3.4b.5 锚点标记 data-open + data-menu-open
{
  const t = await colorTrigger()
  T('3.4b.5', t.open && t.menuOpen, '打开时锚点同时打上 data-open 与 data-menu-open')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  const t2 = await colorTrigger()
  T('3.4b.5', !t2.open && !t2.menuOpen, '关闭时两个标记都摘掉')
}

// ══════════════════════════════════════════════════════════════
// 3.4 色盘主体
// ══════════════════════════════════════════════════════════════
console.log('── 3.4 色盘主体')
const cp = () => page.evaluate(x => {
  const h = document.getElementById(x)
  if (!h) return null
  const r = h.shadowRoot
  const eye = r.querySelector('.eye')
  const pageBtns = [...r.querySelectorAll('[data-page]')]
  return {
    pages: pageBtns.map(b => b.dataset.page),
    active: pageBtns.find(b => (b.getAttribute('style') || '').includes('#454545'))?.dataset.page ?? null,
    sv: !!r.querySelector('.sv'), hue: !!r.querySelector('.hue'), alpha: !!r.querySelector('.alpha'),
    alphaChecker: (r.querySelector('.alpha')?.getAttribute('style') || '').includes('linear-gradient(45deg'),
    val: r.querySelector('.val')?.value, alphaVal: r.querySelector('.alpha-val')?.value,
    format: r.querySelector('.format')?.getAttribute('value'),
    eyeDisabled: eye ? eye.disabled : null, eyeTitle: eye?.title ?? null,
    items: [...r.querySelectorAll('[data-item]')].map(i => i.dataset.item),
    listCss: (() => {
      const box = r.querySelector('[data-item]')?.parentElement
      if (!box) return null
      const cs = getComputedStyle(box)
      return { maxH: cs.maxHeight, overflow: cs.overflowY, overscroll: cs.overscrollBehaviorY,
               scrollable: box.scrollHeight > box.clientHeight }
    })(),
  }
}, COLOR)
const openColor = async () => { if (!(await exists(COLOR))) await tap(cswatch) }
const dragBar = async (barSel, fx, fy = 0.5) => {
  const b = await page.locator(`#${COLOR} ${barSel}`).boundingBox()
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(350)
}

await openColor()
{
  const s = await cp()
  T('3.4.1', s.sv && s.hue && s.alpha, '色盘含 SV 面板、色相条、透明度条')
  T('3.4.3', s.alphaChecker, '透明度条底下是棋盘格')
}

// 3.4.1 SV 面板：按下即取值 + 拖动改饱和度 / 明度
{
  const before = await cssColor()
  await dragBar('.sv', 0.98, 0.02)                    // 右上角 → 高饱和高明度
  const after = await cssColor()
  T('3.4.1', after !== before, `SV 面板上按一下就取值（${before} → ${after}）`)
  const b = await page.locator(`#${COLOR} .sv`).boundingBox()
  await page.mouse.move(b.x + b.width * 0.98, b.y + b.height * 0.02)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.9, { steps: 6 })
  await page.mouse.up(); await page.waitForTimeout(350)
  const dragged = parseRgb(await cssColor())
  const mx = Math.max(...dragged), mn = Math.min(...dragged)
  T('3.4.1', mx < 90 && (mx === 0 || (mx - mn) / mx < 0.2),
    `拖到左下角 → 低饱和(x)低明度(1−y)（rgb ${dragged.join(',')}）`)
}

// 3.4.2 色相条：拖动改 hue 0–360
{
  await dragBar('.sv', 0.99, 0.01)                     // 先把饱和度 / 明度拉满，色相才看得出来
  await dragBar('.hue', 1 / 3)
  const h1 = hueOf(parseRgb(await cssColor()))
  T('3.4.2', Math.abs(h1 - 120) < 6, `色相条拖到 1/3 → hue≈120 绿（实测 ${h1.toFixed(1)}°）`)
  await dragBar('.hue', 2 / 3)
  const h2 = hueOf(parseRgb(await cssColor()))
  T('3.4.2', Math.abs(h2 - 240) < 6, `拖到 2/3 → hue≈240 蓝（实测 ${h2.toFixed(1)}°）`)
  await dragBar('.hue', 0.999)
  const h3 = hueOf(parseRgb(await cssColor()))
  T('3.4.2', h3 > 354 || h3 < 6, `拖到最右 → hue≈360 回到红（实测 ${h3.toFixed(1)}°）`)
}

// 3.4.3 透明度条：拖动改 alpha 0–1
{
  await dragBar('.alpha', 0.5)
  const c = await cssColor()
  const a = parseRgb(c)[3]
  T('3.4.3', a !== undefined && Math.abs(a - 0.5) < 0.03, `透明度条拖到一半 → alpha≈0.5（${c}）`)
  T('3.4.3', /^#[0-9a-f]{8}$/i.test(await lastEv('vr-color')),
    `Hex 格式下 alpha<1 emit 出 8 位十六进制（${await lastEv('vr-color')}）`)
  await dragBar('.alpha', 0.999)
  T('3.4.3', (await cp()).alphaVal === '100', `拖到最右 alpha 回到 100%（${(await cp()).alphaVal}）`)
}

// 3.4.4 吸管：支持时可用，不支持时 disabled + title
{
  T('3.4.4', (await cp()).eyeDisabled === false,
    '浏览器支持 EyeDropper 时吸管按钮可用（真实取色要用户在屏幕上点，无头环境不可自动化）')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await page.evaluate(() => { window.__vrEyeDropper = window.EyeDropper; delete window.EyeDropper })
  await openColor()
  const s = await cp()
  T('3.4.4', s.eyeDisabled === true && s.eyeTitle === '当前浏览器不支持屏幕取色',
    `不支持时按钮 disabled + title「${s.eyeTitle}」`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await page.evaluate(() => { window.EyeDropper = window.__vrEyeDropper })
  await openColor()
}

// 3.4.5 格式下拉（嵌套弹层）+ 3.4b.4 兄弟弹层白名单
{
  await setField('color', 'text', '#3388ff')
  await setField('color', 'alpha', '50')
  await openColor()
  await page.locator(`#${COLOR} .format`).click(); await page.waitForTimeout(350)
  T('3.4b.4', await exists(SEL) && await exists(COLOR),
    '色盘里再开格式下拉：两个弹层同时开着（下拉挂在 body 上，不在色盘的 DOM 里）')
  await page.locator(`#${SEL} [data-item="RGB"]`).click(); await page.waitForTimeout(400)
  T('3.4b.4', await exists(COLOR),
    '点下拉的选项不会把色盘一起关掉（兄弟弹层白名单）')
  T('3.4.5', /^rgba\(51,\s*136,\s*255,\s*0?\.5\d*\)$/.test(await lastEv('vr-color'))
    && (await cp()).val === await lastEv('vr-color'),
    `切到 RGB 立即重新格式化并 emit（${await lastEv('vr-color')}，输入框同步）`)
  await page.locator(`#${COLOR} .format`).click(); await page.waitForTimeout(300)
  await page.locator(`#${SEL} [data-item="HSL"]`).click(); await page.waitForTimeout(400)
  T('3.4.5', /^hsla\(\d+,\s*\d+%,\s*\d+%,\s*0?\.5\d*\)$/.test(await lastEv('vr-color')),
    `切到 HSL（${await lastEv('vr-color')}）`)
  T('3.4.8', /^hsla\(/.test(await lastEv('vr-color')) && parseRgb(await cssColor())[3] === 0.5,
    `formatColor 在 alpha<1 时输出 hsla，页面上仍是同一个半透明颜色（${await lastEv('vr-color')} → ${await cssColor()}）`)
  await page.locator(`#${COLOR} .format`).click(); await page.waitForTimeout(300)
  await page.locator(`#${SEL} [data-item="Hex"]`).click(); await page.waitForTimeout(400)
  T('3.4.5', (await cp()).format === 'Hex' && /^#3388ff[0-9a-f]{2}$/i.test(await lastEv('vr-color')),
    `切回 Hex（${await lastEv('vr-color')}）`)
}

// 3.4.6 色值输入：合法即用，非法回滚；正在输入时不被 sync 覆盖
{
  await openColor()
  const val = page.locator(`#${COLOR} .val`)
  await val.fill('rebeccapurple'); await val.press('Enter'); await page.waitForTimeout(400)
  T('3.4.6', /^#663399/i.test(await lastEv('vr-color')) && await cssColor() === 'rgb(102, 51, 153)',
    `合法值即刻生效（rebeccapurple → emit ${await lastEv('vr-color')}，页面 ${await cssColor()}）`)
  T('3.4.8', await cssColor() === 'rgb(102, 51, 153)',
    'parseColor 用浏览器 CSS 引擎解析任意写法（颜色关键字也认）')
  const good = await cssColor()
  const evs = await countEv('vr-color')
  await val.fill('这不是颜色'); await val.press('Enter'); await page.waitForTimeout(400)
  T('3.4.6', await cssColor() === good && await countEv('vr-color') === evs,
    `非法值不提交、页面不动（仍是 ${await cssColor()}）`)
  T('3.4.6', /^#663399/i.test((await cp()).val),
    `非法值回滚显示（输入框回到 ${(await cp()).val}）`)

  // 正在输入时不被 sync 覆盖：色相条 pointerdown 里 preventDefault，焦点还留在色值框
  await val.click(); await val.fill('#0a0b0c')
  await dragBar('.hue', 0.25)
  T('3.4.6', (await cp()).val === '#0a0b0c',
    `正在输入的色值框不被 sync 覆盖（框里仍是 ${(await cp()).val}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
}

// 3.4.7 不透明度输入（%）：clamp 0–100
{
  await openColor()
  const av = page.locator(`#${COLOR} .alpha-val`)
  await av.fill('150'); await av.press('Enter'); await page.waitForTimeout(400)
  T('3.4.7', (await cp()).alphaVal === '100' && /^#[0-9a-f]{6}$/i.test(await lastEv('vr-color')),
    `150 被 clamp 到 100%，alpha=1 时不写 8 位（emit ${await lastEv('vr-color')}）`)
  await av.fill('-20'); await av.press('Enter'); await page.waitForTimeout(400)
  T('3.4.7', (await cp()).alphaVal === '0' && parseRgb(await cssColor())[3] === 0,
    `-20 被 clamp 到 0%（emit ${await lastEv('vr-color')}，页面 ${await cssColor()}）`)
  await av.fill('60'); await av.press('Enter'); await page.waitForTimeout(400)
  T('3.4.7', (await cp()).alphaVal === '60' && Math.abs(parseRgb(await cssColor())[3] - 0.6) < 0.02,
    `正常值原样生效（页面 ${await cssColor()}）`)
}

// 3.4b.3 关闭规则：内部滚动不关、Esc 关、点外关、页面滚动关
console.log('── 3.4b 颜色弹层')
{
  await openColor()
  // 变量页有 24 个颜色变量，列表本身要滚
  await page.locator(`#${COLOR} [data-page="variable"]`).click(); await page.waitForTimeout(400)
  const s = await cp()
  T('3.4b.2', s.items.length === 24 && s.listCss.maxH === '300px'
    && s.listCss.overflow === 'auto' && s.listCss.overscroll === 'contain' && s.listCss.scrollable,
    `变量列表 ${s.items.length} 行，max-height ${s.listCss.maxH} / overflow ${s.listCss.overflow} / overscroll ${s.listCss.overscroll}`)
  const box = await page.evaluate(x => {
    const b = document.getElementById(x).shadowRoot.querySelector('[data-item]').parentElement
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, COLOR)
  await page.mouse.move(box.x, box.y); await page.mouse.wheel(0, 200); await page.waitForTimeout(350)
  const st = await page.evaluate(x => document.getElementById(x)
    .shadowRoot.querySelector('[data-item]').parentElement.scrollTop, COLOR)
  T('3.4b.3', await exists(COLOR) && st > 0, `弹层内部滚动不关闭（列表 scrollTop=${st}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  T('3.4b.3', !(await exists(COLOR)) && !(await panelHidden()), 'Esc 关闭弹层且不会一路走到取消选中')
  await openColor()
  await P('header .tag').click({ force: true }); await page.waitForTimeout(300)
  T('3.4b.3', !(await exists(COLOR)), '点弹层外关闭')
  await openColor()
  await page.mouse.move(700, 780); await page.mouse.wheel(0, 300); await page.waitForTimeout(350)
  T('3.4b.3', !(await exists(COLOR)), '页面滚动关闭')
  await page.mouse.wheel(0, -400); await page.waitForTimeout(250)
}

// 3.4b.6 定位：默认贴触发器左侧、夹在视口内、切页后重新夹
{
  await openColor()
  const a = await trigRect('vr-color[data-prop="color"]')
  const r1 = await rect(`#${COLOR}`)
  T('3.4b.6', Math.abs(r1.right - (a.left - 2)) < 2 && within(r1),
    `默认贴触发器左侧（弹层 right=${Math.round(r1.right)}，触发器 left=${Math.round(a.left)}）`)
  await page.locator(`#${COLOR} [data-page="variable"]`).click(); await page.waitForTimeout(400)
  const r2 = await rect(`#${COLOR}`)
  // 自定义页多了「On this page」之后比变量页高，切页高度只要变了就够，方向不限
  T('3.4b.6', within(r2) && Math.abs(r2.h - r1.h) > 4,
    `切到变量页高度变化（${Math.round(r1.h)}→${Math.round(r2.h)}）后仍夹在视口内（bottom=${Math.round(r2.bottom)} ≤ ${r2.vh}）`)
}

// 3.4b.1 两页 / 停页 + 3.5.8 变量页选中派发 vr-color-variable
{
  const s = await cp()
  T('3.4b.1', JSON.stringify(s.pages) === '["custom","variable"]',
    `有 Custom | 变量 两页（${s.pages.join(' | ')}）`)
  // 选一个变量：写进页面的是 var(--x)，说明派发的是 vr-color-variable 而不是色值
  await page.locator(`#${COLOR} [data-item="--pop-brand"]`).click(); await page.waitForTimeout(500)
  T('3.5.8', await inline('solid', 'color') === 'var(--pop-brand)',
    `变量页选中派发 vr-color-variable，页面写的是变量名（color: ${await inline('solid', 'color')}）`)
  T('3.4.8', await P('[data-var-chip="color"]').count() === 1,
    'sameColor 核对通过：绑定态的 chip 认出这条属性绑在变量上')
  // 已绑定 → 再打开时直接停在变量页并勾着当前项
  await tap(P('[data-var-chip="color"]'))
  const s2 = await cp()
  const checked = await page.evaluate(x => document.getElementById(x).shadowRoot
    .querySelector('[data-item][data-current]')?.dataset.item, COLOR)
  // 已绑定：没有「自定义 | 变量」那排，只有列表、当前项勾着（要改颜色先 unlink）
  T('3.4b.1', s2.pages.length === 0 && checked === '--pop-brand',
    `已绑定时打开只有变量列表、没有页签，当前项勾着（页签 ${JSON.stringify(s2.pages)}，勾 ${checked}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  // 解绑，后面的断言不受 var() 影响；也只有解绑之后从色块打开才有「自定义」页
  await tap(P('[data-unlink="color"]'))
  await openColor()
  T('3.4b.1', (await cp()).active === 'custom' && (await cp()).sv && (await cp()).pages.length === 2,
    'unlink 后从色块打开：两页齐全、停在自定义页、是那套色盘')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
}

// 3.4b.1（variables === null）：效果参数面板里的阴影色没有变量页
// 3.2.8 兄弟弹层：菜单里再开色盘，点色盘不关菜单
{
  await select('#solid')
  await tap(P('section[data-group="effects"] h3 .title'))     // 展开 Effects
  await tap(P('.add[data-add="effects"]'))
  T('3.2.8', await exists(MENU), '效果分区的加号打开 openMenu 菜单')
  await page.locator(`#${MENU} [data-item="drop-shadow"]`).click(); await page.waitForTimeout(500)
  await tap(P('[data-effect-open="0"]'))
  T('3.3', await exists(MENU) && await page.locator(`#${MENU} vr-color[data-fx="color"]`).count() === 1,
    'openPopover 打开效果参数面板，内容（含 vr-color）由回调自绘')
  const w = (await rect(`#${MENU}`)).w
  T('3.3', Math.round(w) === 264, `openPopover 的 width 参数生效（${Math.round(w)}px）`)
  await page.locator(`#${MENU} vr-color[data-fx="color"] .swatch`).click(); await page.waitForTimeout(450)
  T('3.2.8', await exists(MENU) && await exists(COLOR), '在菜单里点色块：色盘开了，菜单没关')
  const s = await cp()
  T('3.4b.1', s.pages.length === 0 && s.sv,
    'variablesProvider 没挂时整排页签不渲染，只有 Custom 那套色盘')
  await page.locator(`#${COLOR} .hue`).click({ position: { x: 20, y: 6 } }); await page.waitForTimeout(400)
  T('3.2.8', await exists(MENU), '点色盘内部（兄弟弹层）不会把菜单关掉')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  T('3.2.8', !(await exists(COLOR)) && !(await exists(MENU)), '两个弹层各按一次 Esc 依次关掉')
}

// ══════════════════════════════════════════════════════════════
// 3.5 vr-color 其余条目
// ══════════════════════════════════════════════════════════════
console.log('── 3.5 vr-color 其余条目')
await select('#solid')
{
  // 3.5.5 alpha=1 输出 #rrggbb
  await setField('color', 'text', '#ff0000')
  T('3.5.5', await lastEv('vr-color') === '#ff0000' && await cssColor() === 'rgb(255, 0, 0)',
    `alpha=1 时输出 #rrggbb 而不是 rgba()（emit ${await lastEv('vr-color')}）`)

  // 3.5.4 改不透明度：clamp 0–100；非数字回滚
  await setField('color', 'alpha', '40')
  T('3.5.4', await lastEv('vr-color') === '#ff000066' && parseRgb(await cssColor())[3] === 0.4,
    `不透明度 40% → clamp(40,0,100)/100（emit ${await lastEv('vr-color')}）`)
  await setField('color', 'alpha', '250')
  T('3.5.4', await lastEv('vr-color') === '#ff0000', `250 被 clamp 到 100（emit ${await lastEv('vr-color')}）`)
  await setField('color', 'alpha', '40')
  const evs5 = await countEv('vr-color')
  await setField('color', 'alpha', 'abc')
  T('3.5.4', await countEv('vr-color') === evs5 && (await colorTrigger()).alpha === '40',
    `非数字不提交、输入框回滚（仍是 ${(await colorTrigger()).alpha}%）`)

  // 3.5.3 改色值不重置已调好的 alpha
  await setField('color', 'text', '#00ff00')
  T('3.5.3', await lastEv('vr-color') === '#00ff0066' && parseRgb(await cssColor())[3] === 0.4,
    `色值框只管颜色，40% 的不透明度保住了（emit ${await lastEv('vr-color')}，页面 ${await cssColor()}）`)

  // 3.5.8 每次操作派发 vr-color，detail 是 CSS 字符串 —— 落到页面与改动记录
  T('3.5.8', await lastEv('vr-color') === '#00ff0066' && await recorded('color') === 'rgba(0, 255, 0, 0.4)',
    `vr-color 的 detail 是 CSS 字符串（${await lastEv('vr-color')}），归一后进改动记录（${await recorded('color')}）`)

  // 3.5.6 弹层交给 openColorPopover；variablesProvider 决定有没有变量页
  await tap(cswatch)
  T('3.5.6', await exists(COLOR) && (await cp()).pages.length === 2,
    '弹层由 openColorPopover 承担，面板挂了 variablesProvider 所以有两页')

  // 3.5.7 元素被移除时 disconnectedCallback 关掉自己的弹层
  await page.evaluate(() => document.querySelector('visual-revise-panel').render())
  await page.waitForTimeout(400)
  T('3.5.7', !(await exists(COLOR)),
    '面板重绘换掉 vr-color 实例后，disconnectedCallback 把弹层收走，不留孤儿')
  await tap(cswatch)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  T('3.5.7', !(await exists(COLOR)) && !(await panelHidden()), 'Esc 关弹层（关闭逻辑都在弹层那边）')
}

// ══════════════════════════════════════════════════════════════
// 3.6 vr-fill 填充控件
// ══════════════════════════════════════════════════════════════
console.log('── 3.6 vr-fill 填充控件')

const fillTrig = (i = 0) => page.evaluate(n => {
  const f = document.querySelector('visual-revise-panel').shadowRoot.querySelectorAll('vr-fill')[n]
  if (!f) return null
  const r = f.shadowRoot
  return {
    color: f.getAttribute('color'), image: (f.getAttribute('image') || '').slice(0, 60),
    bound: f.getAttribute('bound'),
    label: r.querySelector('.label')?.textContent ?? null,
    fields: !!r.querySelector('.fields'), text: r.querySelector('.text')?.value ?? null,
    alpha: r.querySelector('.alpha')?.value ?? null, pct: r.querySelector('.pct')?.textContent ?? null,
    swatch: !!r.querySelector('.swatch'),
    chip: !!r.querySelector('.var-chip'), chipName: r.querySelector('.var-name')?.textContent ?? null,
    chipDot: r.querySelector('.var-dot')?.style.background ?? null,
  }
}, i)

const fp = () => page.evaluate(x => {
  const h = document.getElementById(x)
  if (!h) return null
  const r = h.shadowRoot
  const on = els => els.find(b => (b.getAttribute('style') || '').includes('#454545'))
  const pages = [...r.querySelectorAll('[data-page]')]
  const tabs = [...r.querySelectorAll('[data-tab]')]
  const types = [...r.querySelectorAll('[data-type]')]
  return {
    pages: pages.map(b => b.dataset.page), page: on(pages)?.dataset.page ?? null,
    tabs: tabs.map(b => b.dataset.tab), tab: on(tabs)?.dataset.tab ?? null,
    types: types.map(b => b.dataset.type), type: on(types)?.dataset.type ?? null,
    angleRow: !!r.querySelector('.angle'), angle: r.querySelector('.angle')?.value ?? null,
    warn: /当前有背景图/.test(r.querySelector('.body')?.textContent || ''),
    body: (r.querySelector('.page')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    sv: !!r.querySelector('.sv'), val: r.querySelector('.val')?.value ?? null,
    upload: !!r.querySelector('button.pick'),
    stops: [...r.querySelectorAll('[data-row]')].map(row => ({
      i: +row.dataset.row,
      pos: row.querySelector('[data-pos]').value,
      hex: row.querySelector('[data-hex]').value,
      delDisabled: row.querySelector('[data-del]').disabled,
      bg: row.style.background,
    })),
    handles: [...r.querySelectorAll('[data-handle]')].map(b => ({
      left: b.style.left, border: b.style.borderColor, bg: b.style.background })),
    items: [...r.querySelectorAll('[data-item]')].map(x => x.dataset.item),
  }
}, FILL)

const bgImage = id => page.evaluate(i => document.getElementById(i).style.backgroundImage, id)
const openFill = async (n = 0) => {
  if (await exists(FILL)) return
  const sw = P('vr-fill .swatch').nth(n)
  await sw.scrollIntoViewIfNeeded(); await sw.click(); await page.waitForTimeout(420)
}
const fillTab = async name => {
  await page.locator(`#${FILL} [data-tab="${name}"]`).click(); await page.waitForTimeout(450)
}

// ── #grad：渐变层 ──
await select('#grad', { x: 6, y: 6 })
{
  const t = await fillTrig()
  T('3.6.1', t.label === '线性渐变 · 2 档' && !t.fields && t.swatch,
    `渐变态触发行退回只读摘要（「${t.label}」，没有可敲的输入框）`)
  await openFill()
  const s = await fp()
  T('3.6.1b', JSON.stringify(s.pages) === '["custom","variable"]' && s.page === 'custom',
    `弹层顶上两页 Custom | 变量（当前 ${s.page}）`)
  T('3.6.2', JSON.stringify(s.tabs) === '["none","solid","gradient","image"]' && s.tab === 'gradient',
    `Custom 下四个 tab：${s.tabs.join('/')}，按当前值停在「${s.tab}」`)
  T('3.6.6a', JSON.stringify(s.types) === '["linear","radial","conic"]' && s.type === 'linear',
    `类型分段 ${s.types.join('/')}，当前 ${s.type}`)
  T('3.6.6b', s.angleRow && s.angle === '90', `角度输入回填当前角度（${s.angle}）`)

  // 3.6.1b 渐变层不能绑变量
  await page.locator(`#${FILL} [data-page="variable"]`).click(); await page.waitForTimeout(400)
  const v = await fp()
  T('3.6.1b', v.page === 'variable' && /渐变和图片层不能绑定变量/.test(v.body),
    `渐变层的变量页给的是说明而不是列表（「${v.body}」）`)
  await page.locator(`#${FILL} [data-page="custom"]`).click(); await page.waitForTimeout(400)
  T('3.6.1b', (await fp()).tab === 'gradient', '切回 Custom 页回到那四个 tab')
}

// 3.6.6f 色标行 / 至少两档
{
  const s = await fp()
  T('3.6.6f', s.stops.length === 2 && s.stops.every(x => x.delDisabled)
    && s.stops[0].pos === '0' && s.stops[1].pos === '100',
    `两档时每行有位置 ${s.stops.map(x => x.pos + '%').join('/')}、色值 ${s.stops.map(x => x.hex).join(' ')}，删除按钮 disabled`)
  const before = await bgImage('grad')
  await page.locator(`#${FILL} [data-del="0"]`).click({ force: true }); await page.waitForTimeout(350)
  T('3.6.6f', (await fp()).stops.length === 2 && await bgImage('grad') === before,
    '只剩两档时点删除按钮无效（disabled，事件也守住了）')
}

// 3.6.6e 加号：在首尾中点新增一档
{
  await page.locator(`#${FILL} .add`).click(); await page.waitForTimeout(400)
  const s = await fp()
  T('3.6.6e', s.stops.length === 3 && s.stops.some(x => x.pos === '50'),
    `加号在首尾中点插一档（位置 ${s.stops.map(x => x.pos).join('/')}）`)
  T('3.6.6f', s.stops.every(x => !x.delDisabled), '超过两档后删除按钮可用')
  T('3.6.6e', /50%/.test(await bgImage('grad')), `新档写进页面（${await bgImage('grad')}）`)
}

// 3.6.6d 点色标条空白处按插值新增一档 + 拖手柄改位置
{
  const bar = await page.locator(`#${FILL} .bar-fill`).boundingBox()
  await page.mouse.click(bar.x + bar.width * 0.25, bar.y + bar.height / 2)
  await page.waitForTimeout(400)
  const s = await fp()
  const at25 = s.stops.find(x => Math.abs(parseFloat(x.pos) - 25) < 3)
  T('3.6.6d', s.stops.length === 4 && !!at25,
    `点色标条 25% 处新增一档（位置 ${s.stops.map(x => x.pos).join('/')}）`)
  // 25% 落在 红(0%) → 蓝(100%) 之间，插值出来应该是红多蓝少
  const c = parseRgb(at25.hex)
  T('3.6.6d', c[0] > c[2] && c[0] > 150 && c[2] > 30,
    `新档颜色取的是渐变在该位置的插值而不是凭空一个颜色（${at25.hex}）`)

  // 拖手柄：把 25% 那一档拖到 70%
  const idx = s.stops.indexOf(at25)
  const knob = await page.locator(`#${FILL} [data-handle="${idx}"]`).boundingBox()
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
  await page.mouse.down()
  await page.mouse.move(bar.x + bar.width * 0.7, knob.y + knob.height / 2, { steps: 8 })
  await page.mouse.up(); await page.waitForTimeout(400)
  const moved = (await fp()).stops[idx]
  T('3.6.6d', Math.abs(parseFloat(moved.pos) - 70) < 4 && new RegExp(`${Math.round(parseFloat(moved.pos))}`).test(await bgImage('grad')),
    `拖手柄改位置 25% → ${moved.pos}%，即时写回页面`)
}

// 3.6.6g 点行选中该档：手柄边框变蓝、行底变蓝
{
  await page.locator(`#${FILL} [data-row="0"] [data-pos]`).click(); await page.waitForTimeout(300)
  await page.locator(`#${FILL} [data-row="0"]`).click({ position: { x: 60, y: 8 } }); await page.waitForTimeout(350)
  const s = await fp()
  T('3.6.6g', /13,\s*153,\s*255,\s*0\.16/.test(s.stops[0].bg) && s.handles[0].border === 'rgb(13, 153, 255)'
    && s.stops.slice(1).every(x => !x.bg),
    `点第 1 行选中该档：行底 ${s.stops[0].bg}，手柄边框 ${s.handles[0].border}`)
  T('3.6.6h', s.val && parseRgb(s.val || '').length >= 3 || /^#/.test(s.val || ''),
    `下方色盘载入的是当前选中那一档的颜色（${s.val}）`)
}

// 3.6.6h 下方色盘改的是当前选中那一档
{
  const before = (await fp()).stops[0].hex
  // 渐变编辑到 4 档后弹层高过 max-height、内部滚动，色相条可能在可视区下方——
  // 按坐标点会落到弹层外面把它关掉。先滚到可见再点
  const hue = page.locator(`#${FILL} .hue`)
  await hue.scrollIntoViewIfNeeded()
  const b = await hue.boundingBox()
  await hue.click({ position: { x: b.width * 0.34, y: b.height / 2 } }); await page.waitForTimeout(400)
  const s = await fp()
  T('3.6.6h', !sameRgb(s.stops[0].hex, before) && sameRgb(s.handles[0].bg, s.stops[0].hex),
    `拖色盘改的是选中那一档（第 1 档 ${before} → ${s.stops[0].hex}，手柄同步成 ${s.handles[0].bg}）`)
  const g = hueOf(parseRgb(s.stops[0].hex))
  T('3.6.6h', Math.abs(g - 122) < 12, `改成的确实是色相条上取的那个颜色（hue≈${g.toFixed(0)}°）`)
  T('3.6.6h', (await bgImage('grad')).includes(rgbStr(parseRgb(s.stops[0].hex))),
    `改完即时写回页面的 background-image（含 ${rgbStr(parseRgb(s.stops[0].hex))}）`)
}

// 3.6.6i 色标数量没变时原地改，不重建 DOM
{
  await page.evaluate(x => {
    const r = document.getElementById(x).shadowRoot
    r.querySelectorAll('[data-row]').forEach((n, i) => { n.__mark = `row${i}` })
    r.querySelectorAll('[data-handle]').forEach((n, i) => { n.__mark = `h${i}` })
  }, FILL)
  const pos = page.locator(`#${FILL} [data-pos="1"]`)
  await pos.fill('42'); await pos.press('Enter'); await page.waitForTimeout(400)
  const marks = await page.evaluate(x => {
    const r = document.getElementById(x).shadowRoot
    return { rows: [...r.querySelectorAll('[data-row]')].map(n => n.__mark),
             handles: [...r.querySelectorAll('[data-handle]')].map(n => n.__mark) }
  }, FILL)
  T('3.6.6i', marks.rows.every((m, i) => m === `row${i}`) && marks.handles.every((m, i) => m === `h${i}`),
    `档数没变时行与手柄都是原来那批 DOM 节点（${marks.rows.join(',')}）`)
  T('3.6.6f', (await fp()).stops[1].pos === '42' && /42%/.test(await bgImage('grad')),
    `位置输入直接改这一档（${(await fp()).stops[1].pos}%）`)
}

// 3.6.6c 反转：只换颜色顺序，位置不动
{
  const before = (await fp()).stops
  await page.locator(`#${FILL} .reverse`).click(); await page.waitForTimeout(400)
  const after = (await fp()).stops
  T('3.6.6c', JSON.stringify(after.map(x => x.pos)) === JSON.stringify(before.map(x => x.pos))
    && JSON.stringify(after.map(x => x.hex)) === JSON.stringify(before.map(x => x.hex).reverse()),
    `反转只换颜色顺序、位置不动（位置 ${after.map(x => x.pos).join('/')}）`)
}

// 3.6.6b 角度输入 + 3.6.6a 类型分段
{
  const angle = page.locator(`#${FILL} .angle`)
  await angle.fill('35'); await angle.press('Enter'); await page.waitForTimeout(400)
  T('3.6.6b', /^linear-gradient\(35deg/.test(await bgImage('grad')),
    `角度输入 change 后校验数字并 setAngle（${(await bgImage('grad')).slice(0, 30)}…）`)
  await angle.fill('抽象'); await angle.press('Enter'); await page.waitForTimeout(400)
  T('3.6.6b', /^linear-gradient\(35deg/.test(await bgImage('grad')), '非数字不写')

  await page.locator(`#${FILL} [data-type="radial"]`).click(); await page.waitForTimeout(450)
  T('3.6.6a', /^radial-gradient\(/.test(await bgImage('grad')) && (await fp()).type === 'radial',
    `切到径向即刻写回（${(await bgImage('grad')).slice(0, 28)}…）`)
  T('3.6.6b', !(await fp()).angleRow, '径向时角度整行隐藏')
  await page.locator(`#${FILL} [data-type="conic"]`).click(); await page.waitForTimeout(450)
  T('3.6.6a', /^conic-gradient\(/.test(await bgImage('grad')) && (await fp()).angleRow,
    `切到锥形（${(await bgImage('grad')).slice(0, 26)}…），角度行回来了`)
  await page.locator(`#${FILL} [data-type="linear"]`).click(); await page.waitForTimeout(450)
}

// 3.6.6f 删除色标
{
  const n = (await fp()).stops.length
  await page.locator(`#${FILL} [data-del="1"]`).click(); await page.waitForTimeout(400)
  T('3.6.6f', (await fp()).stops.length === n - 1, `点 − 删掉一档（${n} → ${(await fp()).stops.length}）`)
  while ((await fp()).stops.length > 2) {
    await page.locator(`#${FILL} [data-del="1"]`).click(); await page.waitForTimeout(350)
  }
  T('3.6.6f', (await fp()).stops.every(x => x.delDisabled), '删到只剩两档时删除按钮重新 disabled')
}

// 3.6.8 Esc / 点外 / 兄弟弹层
{
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  T('3.6.8', !(await exists(FILL)) && !(await panelHidden()), 'Esc 关闭填充弹层且不取消选中')
  await openFill()
  await P('header .tag').click({ force: true }); await page.waitForTimeout(300)
  T('3.6.8', !(await exists(FILL)), '点弹层外关闭')
  await openFill()
  // 格式下拉在弹层底部、可视区之外：locator.click 会先滚进来再点，而 scroll 事件
  // 异步落在点击之后，被下拉自己的「滚动即关」收掉。先滚、停一拍，再点
  const fmt = page.locator(`#${FILL} .format`)
  await fmt.scrollIntoViewIfNeeded(); await page.waitForTimeout(150)
  await fmt.click(); await page.waitForTimeout(350)
  T('3.6.8', await exists(SEL) && await exists(FILL), '弹层里再开格式下拉，两个同时开着')
  await page.locator(`#${SEL} [data-item="RGB"]`).click(); await page.waitForTimeout(400)
  T('3.6.8', await exists(FILL) && /^rgb/.test((await fp()).val),
    `点兄弟弹层（下拉）的选项不关填充弹层，格式也真的切了（${(await fp()).val}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
}

// ── #img：图片层 ──
await select('#img', { x: 6, y: 6 })
{
  const t0 = await fillTrig(0), t1 = await fillTrig(1)
  T('3.6.1', t0.label === '背景图' && !t0.fields,
    `图片态触发行摘要「${t0.label}」`)
  T('3.6.1', t1.fields && t1.text === '#224466' && t1.alpha === '100' && t1.pct === '%',
    `纯色态触发行给色值 ${t1.text} + 不透明度 ${t1.alpha}${t1.pct} 双输入`)

  // 3.6.4 有背景图时切到纯色的黄条警告 + 光切 tab 不动图片
  await openFill(0)
  const s = await fp()
  T('3.6.4', s.tab === 'solid' && s.warn && s.sv,
    '图片层打开时落在「纯色」tab，顶上一条黄警告「当前有背景图，选定颜色后它会被清掉」')
  const img0 = await bgImage('img')
  await fillTab('image')
  await fillTab('solid')
  T('3.6.4', await bgImage('img') === img0,
    '光在 tab 之间来回切不动图片（applyTab 传 image:null，面板端当「别动图片」）')
  T('3.6.4', await lastEv('vr-fill') && JSON.parse(await lastEv('vr-fill')).image === null,
    `切到纯色时 emit 的 image 是 null（${await lastEv('vr-fill')}）`)

  // 3.6.5 图片 tab：预览 + 从电脑上传
  await fillTab('image')
  T('3.6.5', (await fp()).upload, '图片 tab 有预览框和「从电脑上传」按钮')
  const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const assetsBefore = await page.evaluate(() => window.__visualRevise.store.allAssets().length)
  page.on('filechooser', c => c.setFiles({ name: 'pop.png', mimeType: 'image/png', buffer: Buffer.from(B64, 'base64') }))
  await page.locator(`#${FILL} button.pick`).click()
  // 读文件 → 进素材表 → 写 background-image 是异步的，等到真的写进去（别用固定睡眠）
  await page.waitForFunction(() => /data:image\/png;base64,iVBOR/
    .test(document.getElementById('img').style.backgroundImage), null, { timeout: 8000 })
    .catch(() => {})
  await page.waitForTimeout(300)
  T('3.6.5', await lastEv('vr-fill-pick-image') !== null, '点按钮派发 vr-fill-pick-image')
  T('3.6.5', /url\("data:image\/png;base64,iVBOR/.test(await bgImage('img'))
    && await page.evaluate(() => window.__visualRevise.store.allAssets().length) > assetsBefore,
    `面板读文件、进素材表、写成 url("dataUrl")（素材 ${assetsBefore} → ${await page.evaluate(() => window.__visualRevise.store.allAssets().length)}）`)
}

// ── #solid：定位 / 绑定 / 无填充 ──
await select('#solid')
{
  // 3.6.1 纯色态触发行
  const t = await fillTrig()
  T('3.6.1', t.fields && t.text === '#3355aa' && !t.label,
    `纯色态给色值 ${t.text} + 不透明度双输入，没有只读摘要`)

  // 3.6.7 贴控件左侧、夹在视口内；切到渐变变高后重新让位
  await openFill()
  const a = await trigRect('vr-fill[data-layer="0"]')
  const r1 = await rect(`#${FILL}`)
  T('3.6.7', Math.abs(r1.right - (a.left - 2)) < 2 && within(r1),
    `弹层贴控件左侧（right=${Math.round(r1.right)}，控件 left=${Math.round(a.left)}）`)
  await fillTab('gradient')
  const r2 = await rect(`#${FILL}`)
  T('3.6.7', r2.h > r1.h && within(r2) && r2.top < r1.top,
    `切到渐变变高（${Math.round(r1.h)}→${Math.round(r2.h)}）后往上让、仍夹在视口内（top ${Math.round(r1.top)}→${Math.round(r2.top)}）`)
  T('3.6.2', (await fp()).tab === 'gradient' && (await fp()).stops.length >= 2
    && /^linear-gradient/.test(await bgImage('solid')),
    `点 tab 切换 = 换内容 + applyTab 立即写入（${(await bgImage('solid')).slice(0, 32)}…）`)
  await fillTab('solid')
  T('3.6.2', (await fp()).sv && await bgImage('solid') === 'none',
    '切回纯色：内容换成色盘，渐变被清掉')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
}

// 3.6.1b / 3.6.1a：分区标题栏「绑定变量」→ openVariables() → 变量页 → chip
// 用没有直接文字的容器：有直接文字时这个按钮绑的是「文字色」（走 vr-color 那条路）
await select('#plain', { x: 200, y: 70 })
{
  await tap(P('.var-btn[data-var="fill"]'))
  T('3.6.1b', await exists(FILL) && (await fp()).page === 'variable',
    'openVariables()：分区标题栏的「绑定变量」直接把填充弹层开在变量页')
  const s = await fp()
  T('3.6.1b', s.items.length === 24 && s.items.includes('--pop-brand'),
    `变量页复用 renderVariableList（${s.items.length} 行）`)
  await page.locator(`#${FILL} [data-item="--pop-accent"]`).click(); await page.waitForTimeout(600)
  T('3.6.1b', await lastEv('vr-fill-variable') === '--pop-accent'
    && await inline('plain', 'background-color') === 'var(--pop-accent)',
    `选中派发 vr-fill-variable，面板按 dataset.layer 写到那一层（background-color: ${await inline('plain', 'background-color')}）`)
  const t = await fillTrig()
  T('3.6.1a', t.bound === '--pop-accent' && t.chip && t.chipName === '--pop-accent'
    && /255,\s*136,\s*0/.test(t.chipDot),
    `绑定态整块换成 chip：圆点取该层解析色 ${t.chipDot}，名字 ${t.chipName}`)
  await tap(P('vr-fill[data-layer="0"] .var-chip'))
  // 已绑定：没有「自定义 | 变量」那排，直接是变量列表（要改颜色先 unlink）
  T('3.6.1a', await exists(FILL) && (await fp()).pages.length === 0
    && (await page.evaluate(x => document.getElementById(x).shadowRoot.querySelectorAll('[data-item]').length, FILL)) > 0,
    '点 chip 开的还是本控件的弹层：没有页签，直接是变量列表')
  const checked = await page.evaluate(x => document.getElementById(x).shadowRoot
    .querySelector('[data-item][data-current]')?.dataset.item, FILL)
  T('3.6.1a', checked === '--pop-accent', `变量页勾着当前绑的那一项（${checked}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await tap(P('[data-unlink-layer="0"]'))
}

// 3.6.3 「无」：写 transparent + none（这一步会把那一层删掉，放最后）
await select('#solid')
{
  await openFill()
  await fillTab('none')
  T('3.6.3', JSON.parse(await lastEv('vr-fill')).color === 'transparent'
    && JSON.parse(await lastEv('vr-fill')).image === 'none',
    `「无」emit 的是 ${await lastEv('vr-fill')}`)
  T('3.6.3', await inline('solid', 'background-color') === 'transparent'
    && await inline('solid', 'background-image') === 'none',
    `页面写成 background-color: ${await inline('solid', 'background-color')} / background-image: ${await inline('solid', 'background-image')}`)
  T('3.6.8', !(await exists(FILL)),
    '这一层被删掉后 vr-fill 随面板重绘消失，disconnectedCallback 收走自己的弹层')
}

// 3.6.1 摘要文案的四种形态（面板里 kind=none 的层不会成行，用真实控件实例验渲染结果）
{
  const summary = (color, image) => page.evaluate(([c, i]) => {
    const el = document.createElement('vr-fill')
    el.setAttribute('color', c); el.setAttribute('image', i)
    document.body.appendChild(el)
    const out = { label: el.shadowRoot.querySelector('.label')?.textContent ?? null,
                  fields: !!el.shadowRoot.querySelector('.fields') }
    el.remove()
    return out
  }, [color, image])
  const none = await summary('transparent', 'none')
  const img = await summary('transparent', 'url("x.png")')
  const rad = await summary('transparent', 'radial-gradient(#fff 0%, #000 50%, #f00 100%)')
  const sol = await summary('#3355aa', 'none')
  T('3.6.1', none.label === '无填充' && img.label === '背景图' && rad.label === '径向渐变 · 3 档'
    && !sol.label && sol.fields,
    `摘要文案：无填充 / ${img.label} / ${rad.label}；纯色态给双输入而不是摘要`)
}

// ══════════════════════════════════════════════════════════════
// 页面 CSS 隔离（§3 开头：宿主行内 all:initial + 内容在 shadow root）
// 放最后：这段样式会污染整页
// ══════════════════════════════════════════════════════════════
console.log('── 页面 CSS 隔离')
await page.addStyleTag({ content:
  '.tabs,.pages{border-bottom:3px solid red!important;padding-bottom:20px!important}'
  + 'button{box-shadow:0 0 0 3px lime!important;letter-spacing:5px!important}'
  + 'div{border-top:2px solid blue}'
  + 'input{background:magenta!important}'
  + '*{box-sizing:content-box}'
  + 'body{text-transform:uppercase;letter-spacing:4px}' })
await page.waitForTimeout(150)
await select('#grad', { x: 6, y: 6 })
{
  const leak = async (id, inner) => page.evaluate(([x, sel]) => {
    const host = document.getElementById(x)
    if (!host) return null
    const el = host.shadowRoot.querySelector(sel)
    const cs = e => getComputedStyle(e)
    return {
      hostBorderTop: cs(host).borderTopWidth, hostTransform: cs(host).textTransform,
      hostSpacing: cs(host).letterSpacing, hostBox: cs(host).boxSizing,
      innerBorder: el ? cs(el).borderBottomWidth : null,
      innerPad: el ? cs(el).paddingBottom : null,
      innerShadow: el ? cs(el).boxShadow : null,
      innerBox: el ? cs(el).boxSizing : null,
      innerTransform: el ? cs(el).textTransform : null,
    }
  }, [id, inner])
  const clean = l => l && l.hostBorderTop === '0px' && l.hostTransform === 'none'
    && l.hostSpacing === 'normal' && l.hostBox === 'border-box'
    && l.innerBorder === '0px' && l.innerShadow === 'none'
    && l.innerBox === 'border-box' && l.innerTransform === 'none'

  await openFill()
  const lf = await leak(FILL, '.tabs button')
  T0('3.6', clean(lf), `§3 前言：页面的 .tabs / button / div / * / body 规则漏不进填充弹层（${JSON.stringify(lf)}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)

  await tap(P('vr-select[data-prop="position"]'))
  const ls = await leak(SEL, '[data-item]')
  T0('3.1', clean(ls), `§3 前言：漏不进下拉面板（${JSON.stringify(ls)}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)

  await tap(P('.mode[data-axis="width"]'))
  const lm = await leak(MENU, '[data-item]')
  T0('3.2', clean(lm), `§3 前言：漏不进菜单（${JSON.stringify(lm)}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)

  await select('#solid')
  await tap(P('vr-color[data-prop="color"] .swatch'))
  const lc = await leak(COLOR, '.sv')
  T0('3.4b', clean(lc), `§3 前言：漏不进色盘（${JSON.stringify(lc)}）`)
  const val = await page.evaluate(x => {
    const cs = getComputedStyle(document.getElementById(x).shadowRoot.querySelector('.val'))
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, spacing: cs.letterSpacing, box: cs.boxSizing }
  }, COLOR)
  T0('3.4b', val.bg === 'rgb(56, 56, 56)' && val.shadow === 'none' && val.spacing === 'normal'
    && val.box === 'border-box',
    `色值输入框没被页面的 input{background:magenta} / button{box-shadow} / *{content-box} 碰到（${JSON.stringify(val)}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
}

await browser.close(); await close()
console.log(`\n覆盖编号（${covered.size}）：${[...covered].sort().join(' ')}`)
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
