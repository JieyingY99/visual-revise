import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[Figma 排版测试] 分区顺序 / 对齐 / 连体尺寸 / 分区操作\n')
await page.goto(origin)
await injectVisBug(page, origin)

const panel = sel => page.locator(`visual-revise-panel ${sel}`)
const card  = () => page.evaluate(() => document.querySelectorAll('.curve-card')[1])
const style = prop => page.evaluate(
  p => document.querySelectorAll('.curve-card')[1].style.getPropertyValue(p), prop)

const select = async (prop, value) => {
  await panel(`vr-select[data-prop="${prop}"]`).click()
  await page.waitForTimeout(300)
  const i = await page.evaluate(v =>
    Array.from(document.getElementById('visual-revise-select-panel').children)
      .findIndex(x => x.textContent === v), value)
  await page.locator('#visual-revise-select-panel > div').nth(i).click()
  await page.waitForTimeout(350)
}

await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(500)

// ── 分区顺序 ────────────────────────────────────────────────
const ids = await panel('section').evaluateAll(els => els.map(el => el.dataset.group))
// 实测 Figma Desktop：选中文本图层时 Typography 插在 Appearance 与 Fill 之间，
// 不是排在最后。这里对所有元素都用同一顺序——顺序随选中跳动会毁掉肌肉记忆。
const EXPECTED = ['position', 'layout', 'appearance', 'typography', 'fill', 'stroke', 'effects']
ok(JSON.stringify(ids) === JSON.stringify(EXPECTED), `分区顺序：${ids.join(' → ')}`)

const titles = await panel('section h3 .title').evaluateAll(els => els.map(el => el.textContent))
ok(titles[0] === 'Position' && titles.at(-1) === 'Effects',
   `分区标题用 Figma 命名：${titles.join(' / ')}`)
ok(titles.indexOf('Typography') === titles.indexOf('Appearance') + 1 &&
   titles.indexOf('Typography') === titles.indexOf('Fill') - 1,
   'Typography 夹在 Appearance 与 Fill 之间（Figma 的位置）')

// ── Position 分区内容 ──────────────────────────────────────
const posProps = await panel('section[data-group="position"] [data-prop]')
  .evaluateAll(els => els.map(el => el.dataset.prop))
ok(posProps.includes('position'), 'Position 含定位类型')
ok(posProps.includes('rotate'), 'Position 含旋转')
ok(!posProps.includes('z-index'),
   'static 元素不显示 z-index（改了也没有效果，不该占位置）')

await select('position', 'relative')
const posProps2 = await panel('section[data-group="position"] [data-prop]')
  .evaluateAll(els => els.map(el => el.dataset.prop))
ok(posProps2.includes('z-index') && posProps2.includes('left') && posProps2.includes('top'),
   '改成 relative 后 X / Y / z-index 出现')

const xPrefix = await panel('section[data-group="position"] input[data-prop="left"]')
  .evaluate(el => el.parentElement.querySelector('.prefix').textContent)
ok(xPrefix === 'X', `left 的前缀显示为 X（Figma 命名）：${xPrefix}`)

// ── 旋转 ────────────────────────────────────────────────────
const rot = panel('input[data-prop="rotate"]')
ok(await rot.inputValue() === '', 'rotate 未设置时输入框留空，而不是显示 none')
await rot.fill('45')
await rot.press('Enter')
await page.waitForTimeout(300)
ok(await style('rotate') === '45deg', `裸数字自动补单位：rotate = ${await style('rotate')}`)

await rot.fill('0')
await rot.press('Enter')
await page.waitForTimeout(300)
ok(await style('rotate') === '',
   '填 0 视为「没有旋转」，清掉声明而不是留下一条 rotate: 0deg 的空改动')

// ── Stroke：描边位置 = box-sizing ──────────────────────────
const boxSizing = panel('section[data-group="stroke"] button[data-prop="box-sizing"]')
ok(await boxSizing.count() === 2, 'Stroke 分区有「内 / 外」描边位置分段按钮')
await boxSizing.nth(1).click()
await page.waitForTimeout(300)
ok(await style('box-sizing') === 'content-box',
   `选「外」写入 box-sizing = ${await style('box-sizing')}`)
await boxSizing.nth(0).click()
await page.waitForTimeout(300)

// ── 连体尺寸 + 比例锁 ──────────────────────────────────────
ok(await panel('.dims').count() === 1, 'Layout 里 W / H 用连体控件呈现')
// 括号已随设计稿去掉：W / H 直接接到比例锁上。它原本占的那几像素
// 正是让尺寸行和下面几行分界错开的原因之一。
ok(await panel('.dims .bracket').count() === 0, '右侧不再有连接括号')
ok(await panel('.dims input[data-prop="width"]').count() === 1 &&
   await panel('.dims input[data-prop="height"]').count() === 1, '连体控件内是 W 与 H')

const before = await page.evaluate(() => {
  const r = document.querySelectorAll('.curve-card')[1].getBoundingClientRect()
  return { w: r.width, h: r.height, ratio: r.width / r.height }
})

await panel('.dims .ratio').click()
await page.waitForTimeout(300)
ok(await panel('.dims .ratio').evaluate(el => el.hasAttribute('data-on')), '比例锁已开启')

const wInput = panel('.dims input[data-prop="width"]')
await wInput.fill('130px')
await wInput.press('Enter')
await page.waitForTimeout(400)

const after = await page.evaluate(() => {
  const r = document.querySelectorAll('.curve-card')[1].getBoundingClientRect()
  return { w: r.width, h: r.height, ratio: r.width / r.height }
})
ok(Math.abs(after.w - 130) <= 1, `宽度改为 130（实测 ${after.w.toFixed(1)}）`)
ok(Math.abs(after.ratio - before.ratio) < 0.02,
   `高度跟随比例：${before.w.toFixed(0)}×${before.h.toFixed(0)} → ${after.w.toFixed(0)}×${after.h.toFixed(0)}，` +
   `比例 ${before.ratio.toFixed(3)} → ${after.ratio.toFixed(3)}`)

// W 前缀本身可以横向拖着调值
const dragged = await page.evaluate(async () => {
  const p = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('.dims .prefix[data-drag]')
  return { drag: p?.dataset.drag !== undefined, prop: p?.dataset.prop }
})
ok(dragged.drag && dragged.prop === 'width', 'W 前缀可拖动调值（Figma 手感）')

await panel('.dims .ratio').click()   // 解锁，避免影响后面的用例
await page.waitForTimeout(200)
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(300)

// ── 对齐按钮组 ──────────────────────────────────────────────
ok(await panel('.align').count() === 1, '父容器是 flex 时显示对齐按钮组')
ok(await panel('.align button').count() === 6, '六个方向：水平三个 + 垂直三个')

await panel('.align button[data-align="v:center"]').click()
await page.waitForTimeout(300)
ok(await style('align-self') === 'center',
   `交叉轴对齐写 align-self = ${await style('align-self')}`)

await panel('.align button[data-align="h:center"]').click()
await page.waitForTimeout(300)
const margins = { l: await style('margin-left'), r: await style('margin-right') }
ok(margins.l === 'auto' && margins.r === 'auto',
   `主轴上 flex 只能靠 auto 外边距对齐自己：margin ${margins.l} / ${margins.r}`)

await panel('.align button[data-align="h:end"]').click()
await page.waitForTimeout(300)
ok(await style('margin-left') === 'auto' && await style('margin-right') === '',
   '靠右对齐只留左侧 auto，右侧声明被清掉而不是写成 0')

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(300)

// 父容器不是 flex/grid 时不给这组按钮：CSS 里没有对应的确定写法
await page.locator('.card-title').nth(1).click()
await page.waitForTimeout(500)
ok(await panel('.tag').textContent().then(t => t.includes('card-title')), '改选 h2.card-title')
ok(await panel('.align').count() === 0,
   '父容器是普通 block 时不显示对齐按钮组（margin:auto 还要求元素有确定宽度，做不到确定行为）')

await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 } })
await page.waitForTimeout(500)

// ── 层级眼睛：关掉某一层填充 ───────────────────────────────
// Fill 改成可增删的层列表后，可见性下放到每一行（Figma 就是这样）：
// 分区标题上只剩 variable 和加号，眼睛跟着它管的那一层走。
ok(await panel('section[data-group="fill"] .acts .eye').count() === 0,
   'Fill 分区标题不再有分区级眼睛（下放到每一层）')
ok(await panel('section[data-group="fill"] .layer-row .layer-eye').count() === 1,
   '这个元素有一层填充，那一行上有自己的眼睛')
ok(await panel('section[data-group="layout"] .eye').count() === 0,
   'Layout 没有眼睛（布局属性没有「关掉」这个语义）')

const bgBefore = await style('background-color')
await panel('section[data-group="fill"] [data-layer-eye="0"]').click()
await page.waitForTimeout(400)
ok(await style('background-color') === 'transparent',
   `关掉这一层：background-color = ${await style('background-color')}`)
ok(await panel('section[data-group="fill"] .layer-row').evaluate(el => el.classList.contains('off')),
   '那一行压暗，但仍留在列表里——它随时能开回来，删掉才是真的没了')

await panel('section[data-group="fill"] [data-layer-eye="0"]').click()
await page.waitForTimeout(400)
ok(await style('background-color') === bgBefore,
   `再点一次还原回原值（${bgBefore || '没有 inline 声明'}）`)

// ── 分区重置 ────────────────────────────────────────────────
const appearance = panel('section[data-group="appearance"]')
ok(!(await appearance.evaluate(el => el.hasAttribute('data-dirty'))), '未改动时分区不标脏')
ok(!(await panel('section[data-group="appearance"] .undo').isVisible()),
   '未改动时不显示「重置本组」')

const radius = panel('input[data-prop="border-radius"]')
await radius.fill('4px')
await radius.press('Enter')
await page.waitForTimeout(400)
ok(await appearance.evaluate(el => el.hasAttribute('data-dirty')), '改动后 Appearance 标脏')
ok(await panel('section[data-group="appearance"] .undo').isVisible(), '「重置本组」出现')

// 另一组的改动不应被这次重置牵连
const fontSize = panel('input[data-prop="font-size"]')
await fontSize.fill('20px')
await fontSize.press('Enter')
await page.waitForTimeout(400)

await panel('section[data-group="appearance"] .undo').click()
await page.waitForTimeout(400)
ok(await style('border-radius') === '', '重置 Appearance 后圆角改动被撤销')
ok(await style('font-size') === '20px', 'Typography 的改动不受影响')
ok(await page.evaluate(() => window.__visualRevise.store.stats().props) === 1,
   '改动记录只剩另一组的 1 项')

// ── 导出的提示词仍用中文分区名 ─────────────────────────────
const md = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
ok(md.includes('文字'), '导出的提示词用中文分区名，面板用 Figma 英文名')
ok(!md.includes('Typography'), '英文分区名不会漏进中文文档')

await browser.close()
await close()
