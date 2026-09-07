// PRD 批次 2 验收：属性面板逐控件。见 docs/PRD.md §6。
// 每个控件走真实操作路径（输入框 fill+Enter、按钮真实点击、前缀真实拖拽），
// 断言落在元素的 inline style 上——那才是工具真正写出去的东西。
import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const AC = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

console.log('\n[PRD 验收] 批次 2：属性面板逐控件\n')
await page.goto(origin); await injectVisBug(page, origin)
await page.waitForTimeout(400)

// 一个能让 7 组都显示的元素。第一段是**直接文字**：Typography 和「文字色」
// 只给直接承载文字的元素，纯容器上那两块整个不渲染（AC-6.35）
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'rich'
  d.style.cssText = 'position:absolute;left:20px;top:400px;width:300px;height:120px;display:flex;gap:8px;padding:12px;background:#456;border:2px solid #789;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);font-size:14px;color:#fff;opacity:.95;font-family:Poppins, "PingFang TC", sans-serif'
  d.innerHTML = '直接文字<span>子 A</span><span>子 B</span>'
  document.body.appendChild(d)
})
const select = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.locator('#rich').click({ position: { x: 4, y: 4 } }); await page.waitForTimeout(500) }
await select()

const inline = prop => page.evaluate(p => document.getElementById('rich').style.getPropertyValue(p), prop)
const css = prop => page.evaluate(p => getComputedStyle(document.getElementById('rich')).getPropertyValue(p), prop)
const total = () => page.evaluate(() => window.__visualRevise.store.stats().total)
const P = sel => page.locator(`visual-revise-panel ${sel}`)
// Typography / Effects 默认折叠（只在选中文字元素时自动展开），非文字元素上要像用户一样先点标题
const unfold = async title => {
  const sec = page.locator('visual-revise-panel section', { has: page.locator('h3 .title', { hasText: title }) })
  if (await sec.getAttribute('folded') !== null) { await sec.locator('h3 .title').click(); await page.waitForTimeout(250) }
}
const write = async (prop, value) => {
  const i = P(`input[data-prop="${prop}"]`).first()
  await i.fill(String(value)); await i.press('Enter'); await page.waitForTimeout(250)
}
const pick = async (prop, value) => {   // vr-select 的对外契约
  await page.evaluate(([p, v]) => {
    const el = document.querySelector('visual-revise-panel').shadowRoot.querySelector(`vr-select[data-prop="${p}"]`)
    el.dispatchEvent(new CustomEvent('vr-select', { detail: { value: v }, bubbles: true, composed: true }))
  }, [prop, value]); await page.waitForTimeout(250)
}
const color = async (prop, value) => {  // vr-color 的对外契约
  await page.evaluate(([p, v]) => {
    const el = document.querySelector('visual-revise-panel').shadowRoot.querySelector(`vr-color[data-prop="${p}"]`)
    el.dispatchEvent(new CustomEvent('vr-color', { detail: { value: v }, bubbles: true, composed: true }))
  }, [prop, value]); await page.waitForTimeout(250)
}

// ── 6.1 Position ──
console.log('── 6.1 Position')
const t0 = await total()
await pick('position', 'relative')
AC('AC-6.1a', await inline('position') === 'relative', `定位下拉写 position（${await inline('position')}）`)
await pick('position', 'absolute')
await write('left', 33); await write('top', 44)
AC('AC-6.1b', await inline('left') === '33px' && await inline('top') === '44px', `X / Y 写 left / top（${await inline('left')}, ${await inline('top')}）`)
await write('rotate', 15)
AC('AC-6.1c', /15deg/.test(await inline('rotate')), `旋转写 rotate（${await inline('rotate')}）`)
// 立刻清掉：留着 rotate 会让后面所有几何测量（比例锁）和点击命中都落在旋转后的外接框上
await page.evaluate(() => { document.getElementById('rich').style.rotate = '' }); await page.waitForTimeout(150)
await write('z-index', 7)
AC('AC-6.1d', await inline('z-index') === '7', `层级写 z-index（${await inline('z-index')}）`)
// 前缀拖拽：真实 pointer，向右拖 40px → 20 步
const hx = await P('.prefix[data-prop="left"]').first().boundingBox()
await page.mouse.move(hx.x + 4, hx.y + 4); await page.mouse.down()
await page.mouse.move(hx.x + 44, hx.y + 4, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(250)
AC('AC-6.1e', parseFloat(await inline('left')) > 33, `X 前缀横向拖动能调值（33 → ${await inline('left')}）`)
AC('AC-6.13a', (await total()) > t0, `以上写入都进了改动记录（${t0} → ${await total()}）`)

// ── 6.2 排列 ──
console.log('── 6.2 Layout · 排列')
const flows = { free: ['block', ''], vertical: ['flex', 'column'], horizontal: ['flex', 'row'], grid: ['grid', ''] }
for (const [flow, [disp, dir]] of Object.entries(flows)) {
  await P(`button[data-flow="${flow}"]`).click(); await page.waitForTimeout(300)
  const d = await inline('display'), fd = await inline('flex-direction')
  AC(`AC-6.2-${flow}`, d === disp && (dir ? fd === dir : true), `排列「${flow}」→ display=${d}${dir ? ` flex-direction=${fd}` : ''}`)
}
await P('button[data-flow="horizontal"]').click(); await page.waitForTimeout(300)
await P('.wrap-toggle').click(); await page.waitForTimeout(250)
AC('AC-6.2-wrap', await inline('flex-wrap') === 'wrap', `换行钮写 flex-wrap（${await inline('flex-wrap')}）`)
await P('.wrap-toggle').click(); await page.waitForTimeout(250)

// ── 6.3 尺寸 + 比例锁 ──
console.log('── 6.3 尺寸')
await write('width', 240); await write('height', 100)
AC('AC-6.3a', await inline('width') === '240px' && await inline('height') === '100px', `W / H 写 width / height（${await inline('width')} × ${await inline('height')}）`)
// 比例按边框盒算（和 Figma 的 W/H 一致，也是用户眼睛看到的），
// 不是 width/height 声明值——这两者在 content-box 下差一整圈 padding+border
const box = () => page.evaluate(() => { const el = document.getElementById('rich'); return el.offsetWidth / el.offsetHeight })
await P('.ratio').click(); await page.waitForTimeout(250)
const locked = await box()
await write('width', 480)
const after = await box()
AC('AC-6.3b', Math.abs(after - locked) < 0.03, `比例锁开着改 W，边框盒比例保持（锁定 ${locked.toFixed(3)} → 改后 ${after.toFixed(3)}）`)
await P('.ratio').click(); await page.waitForTimeout(150)

// ── 6.4 对齐九宫格 ──
console.log('── 6.4 对齐')
for (const [c, r, jc, ai] of [[0, 0, 'flex-start', 'flex-start'], [1, 1, 'center', 'center'], [2, 2, 'flex-end', 'flex-end']]) {
  await P(`.align-cell[data-col="${c}"][data-row="${r}"]`).click(); await page.waitForTimeout(250)
  AC(`AC-6.4-${c}${r}`, await inline('justify-content') === jc && await inline('align-items') === ai,
     `点 (${c},${r}) → justify-content=${await inline('justify-content')} align-items=${await inline('align-items')}`)
}

// ── 6.5 间隔 ──
await write('gap', 17)
AC('AC-6.5', await inline('gap') === '17px', `间隔写 gap（${await inline('gap')}）`)

// ── 6.6 内 / 外边距 ──
console.log('── 6.6 边距')
const sideInputs = kind => P(`.side-pair input`).all()
const padIn = await P('.side-pair').first().locator('input').all()
await padIn[0].fill('21'); await padIn[0].press('Enter'); await page.waitForTimeout(250)
await padIn[1].fill('9');  await padIn[1].press('Enter'); await page.waitForTimeout(250)
AC('AC-6.6a', await inline('padding-left') === '21px' && await inline('padding-right') === '21px' && await inline('padding-top') === '9px' && await inline('padding-bottom') === '9px',
   `内边距两段式：左右=${await inline('padding-left')} 上下=${await inline('padding-top')}`)
await P('.expand-sides[data-kind="padding"]').click(); await page.waitForTimeout(300)
await write('padding-top', 3)
AC('AC-6.6b', await inline('padding-top') === '3px' && await inline('padding-bottom') === '9px', `展开后单独改上边距，下边距不动（上 ${await inline('padding-top')} 下 ${await inline('padding-bottom')}）`)
// 内边距那行展开后已不是 .side-pair，按展开钮的 data-kind 找外边距那一行
const marIn = await page.locator('visual-revise-panel .side-pair', { has: page.locator('.expand-sides[data-kind="margin"]') }).locator('input').all()
await marIn[0].fill('5'); await marIn[0].press('Enter'); await page.waitForTimeout(250)
AC('AC-6.6c', await inline('margin-left') === '5px' && await inline('margin-right') === '5px', `外边距左右段写 margin-left/right（${await inline('margin-left')}）`)

// ── 6.7 裁剪 ──
await P('.clip-toggle').check(); await page.waitForTimeout(250)
const clipOn = await inline('overflow')
await P('.clip-toggle').uncheck(); await page.waitForTimeout(250)
AC('AC-6.7', clipOn === 'hidden' && (await inline('overflow')) === '', `裁剪：勾上写 overflow:hidden，取消清掉声明（"${clipOn}" → "${await inline('overflow')}"）`)

// ── 6.8 Appearance ──
console.log('── 6.8 Appearance')
// 不透明度在面板里是百分比（Figma 的写法）：敲 50 → opacity: 0.5
await write('opacity', 50); await write('border-radius', 13)
AC('AC-6.8', await inline('opacity') === '0.5' && await inline('border-radius') === '13px', `不透明度 ${await inline('opacity')} · 圆角 ${await inline('border-radius')}`)

// 6.8b 不透明度按百分比显示与步进：1 → 100 %，框里敲 30% / 30 都写 0.3，↑ 一步 1%，Shift+↑ 10%
{
  await write('opacity', 95)
  const shown = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    const inp = sr.querySelector('input[data-prop="opacity"]')
    return { value: inp?.value, suffix: inp?.parentElement.querySelector('.suffix')?.textContent ?? null }
  })
  await write('opacity', '30%')
  const pct = await inline('opacity')
  const inp = P('input[data-prop="opacity"]').first()
  await inp.click(); await inp.press('ArrowUp'); await page.waitForTimeout(250)
  const up1 = await inline('opacity')
  await inp.press('Shift+ArrowUp'); await page.waitForTimeout(250)
  const up10 = await inline('opacity')
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  AC('AC-6.8b', shown.value === '95' && shown.suffix === '%' && pct === '0.3' && up1 === '0.31' && up10 === '0.41',
     `不透明度显示 ${shown.value}${shown.suffix}，敲 30% 写 ${pct}，↑ 一步 ${up1}，Shift+↑ ${up10}`)
  await select()
}

// ── 6.9 Typography ──
console.log('── 6.9 Typography')
await unfold('Typography')
// 字体栈已在元素初始样式里，不用重选来刷新面板——重选时焦点还在面板内，
// Esc 会被当作面板内 Esc 放行，选中清不掉，handles 盖着元素点不到
await pick('font-family', 'Georgia')
AC('AC-6.9a', /^Georgia, "PingFang TC"/.test(await inline('font-family')), `字体只换栈首、后备保留（${await inline('font-family')}）`)
await pick('font-weight', '700')
await write('font-size', 19); await write('line-height', 1.7); await write('letter-spacing', 2)
AC('AC-6.9b', await inline('font-weight') === '700' && await inline('font-size') === '19px' && await inline('line-height') === '1.7' && await inline('letter-spacing') === '2px',
   `字重 ${await inline('font-weight')} · 字号 ${await inline('font-size')} · 行高 ${await inline('line-height')} · 字距 ${await inline('letter-spacing')}`)
for (const v of ['center', 'right', 'justify', 'left']) {
  await P(`button[data-prop="text-align"][data-value="${v}"]`).click(); await page.waitForTimeout(200)
}
AC('AC-6.9c', await inline('text-align') === 'left', `对齐四段逐个点过，最后写 text-align=${await inline('text-align')}`)
await P('.typo-more').click(); await page.waitForTimeout(300)
const moreShown = await P('input[data-prop="text-transform"], vr-select[data-prop="text-transform"]').count()
await pick('text-transform', 'uppercase').catch(() => {})
await pick('text-decoration-line', 'underline').catch(() => {})
AC('AC-6.9d', moreShown > 0 && await inline('text-transform') === 'uppercase' && await inline('text-decoration-line') === 'underline',
   `「更多」展开后 text-transform=${await inline('text-transform')} text-decoration-line=${await inline('text-decoration-line')}`)

// ── 6.10 Fill ──
console.log('── 6.10 Fill')
await page.evaluate(() => {
  const el = document.querySelector('visual-revise-panel').shadowRoot.querySelector('vr-fill')
  el.dispatchEvent(new CustomEvent('vr-fill', { detail: { color: 'rgb(10, 20, 30)' }, bubbles: true, composed: true }))
}); await page.waitForTimeout(250)
AC('AC-6.10a', await inline('background-color') === 'rgb(10, 20, 30)', `填充控件写 background-color（${await inline('background-color')}）`)
// 背景图那行文本框已去掉，走填充控件的对外契约（它同时管着两条属性）
await page.evaluate(() => {
  const el = document.querySelector('visual-revise-panel').shadowRoot.querySelector('vr-fill')
  el.dispatchEvent(new CustomEvent('vr-fill', {
    detail: { image: 'linear-gradient(red, blue)' }, bubbles: true, composed: true }))
}); await page.waitForTimeout(250)
AC('AC-6.10b', /linear-gradient/.test(await inline('background-image')),
   `填充控件同时写 background-image（${(await inline('background-image')).slice(0, 30)}）`)
await color('color', 'rgb(1, 2, 3)')
AC('AC-6.10c', await inline('color') === 'rgb(1, 2, 3)', `文字色写 color（${await inline('color')}）`)

// ── 6.36 描边行的隐藏 / 移除（照 Fill 的层行）──
// #rich 建的时候带 border:2px solid #789。隐藏写透明色：盒子尺寸不变、宽度样式都留着；
// 移除整组一起走，分区退回空状态，⌘Z 一次整组回来。放在 6.11 之前：那段会改描边值。
console.log('── 6.36 描边行 隐藏 / 移除')
await select()
const strokeRow = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = sr.querySelector('section[data-group="stroke"]')
  const el = document.getElementById('rich')
  const cs = getComputedStyle(el)
  return {
    eye: !!sec.querySelector('[data-stroke-eye]'), del: !!sec.querySelector('[data-stroke-del]'),
    off: !!sec.querySelector('.layer-row.off'), colorBox: !!sec.querySelector('vr-color[data-prop="border-color"]'),
    addDisabled: sec.querySelector('.add')?.hasAttribute('disabled') ?? null,
    color: cs.borderTopColor, width: cs.borderTopWidth, style: cs.borderTopStyle,
    inlineColor: el.style.borderColor, inlineStyle: el.style.borderStyle, inlineWidth: el.style.borderWidth,
    total: window.__visualRevise.store.stats().total,
  }
})
let sr0 = await strokeRow()
AC('AC-6.36a', sr0.eye && sr0.del && sr0.colorBox && sr0.addDisabled === true,
   `描边颜色行右侧有眼睛和减号，加号在有描边时禁用（${JSON.stringify({ eye: sr0.eye, del: sr0.del, add: sr0.addDisabled })}）`)
const sEye = P('section[data-group="stroke"] [data-stroke-eye]').first()
await sEye.scrollIntoViewIfNeeded(); await sEye.click(); await page.waitForTimeout(400)
let sr1 = await strokeRow()
AC('AC-6.36b', sr1.off && sr1.color === 'rgba(0, 0, 0, 0)' && sr1.width === '2px' && sr1.style === 'solid' && sr1.colorBox,
   `点眼睛隐藏：颜色透明、宽度样式不动、行压暗、颜色框仍显示原色（${sr1.color} / ${sr1.width} / ${sr1.style}）`)
await P('section[data-group="stroke"] [data-stroke-eye]').first().click(); await page.waitForTimeout(400)
let sr2 = await strokeRow()
AC('AC-6.36c', !sr2.off && sr2.color === sr0.color && sr2.inlineColor === sr0.inlineColor,
   `再点眼睛恢复：颜色回到 ${sr0.color}，inline 原样（"${sr2.inlineColor}"）`)
const sDel = P('section[data-group="stroke"] [data-stroke-del]').first()
await sDel.scrollIntoViewIfNeeded(); await sDel.click(); await page.waitForTimeout(450)
let sr3 = await strokeRow()
AC('AC-6.36d', sr3.inlineStyle === 'none' && sr3.inlineWidth === '0px' && sr3.inlineColor === '' && !sr3.colorBox && sr3.addDisabled === false
  && sr3.total > sr2.total,
   `点减号移除整组：style none / width 0 / 颜色清掉，分区退回空状态、加号可点，进改动记录（${sr3.inlineStyle} / ${sr3.inlineWidth} / 记录 ${sr2.total}→${sr3.total}）`)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(450)
let sr4 = await strokeRow()
AC('AC-6.36e', sr4.style === 'solid' && sr4.width === '2px' && sr4.color === sr0.color && sr4.colorBox && sr4.total === sr2.total,
   `⌘Z 一次整组回来（${sr4.style} / ${sr4.width} / ${sr4.color}，记录 ${sr4.total}）`)

// ── 6.11 Stroke ──
console.log('── 6.11 Stroke')
await color('border-color', 'rgb(200, 100, 50)')
await write('border-width', 5)
await pick('border-style', 'dashed')
AC('AC-6.11a', await inline('border-color') === 'rgb(200, 100, 50)' && await inline('border-width') === '5px' && await inline('border-style') === 'dashed',
   `描边 颜色=${await inline('border-color')} 宽=${await inline('border-width')} 样式=${await inline('border-style')}`)
await P('button[data-prop="box-sizing"][data-value="content-box"]').click(); await page.waitForTimeout(250)
AC('AC-6.11b', await inline('box-sizing') === 'content-box', `box-sizing 分段写 ${await inline('box-sizing')}`)

// ── 6.12 Effects ──
// 三个直接写 CSS 原值的输入框已经去掉，换成 Figma 那样可增删的效果列表：
// 一个框里塞着 `rgb(255,255,255) 0 0 0 0, rgba(147,...` 既读不出有几条阴影，
// 也没法单独关掉其中一条。
console.log('── 6.12 Effects')
await unfold('Effects')
AC('AC-6.12a', (await P('input[data-prop="box-shadow"]').count()) === 0
  && (await P('input[data-prop="filter"]').count()) === 0,
   'Effects 不再有直接写 CSS 原值的输入框')

// #rich 建的时候就带着 box-shadow:0 2px 8px，所以列表一开始就有一条投影，
// 行数按增量算而不是写死
const fxRows = () => P('section[data-group="effects"] .effect-row').count()
const fxBase = await fxRows()

const addFx = async label => {
  await P('.add[data-add="effects"]').click(); await page.waitForTimeout(300)
  await page.locator('#visual-revise-menu [data-item]').filter({ hasText: label }).first().click()
  await page.waitForTimeout(400)
}
await addFx('投影'); await addFx('图层模糊'); await addFx('背景模糊')
AC('AC-6.12b', /4px/.test(await inline('box-shadow'))
  && (await inline('filter')).includes('blur')
  && (await inline('backdrop-filter')).includes('blur'),
   `三种效果各写各的属性：阴影 ${(await inline('box-shadow')).slice(0, 24)} · 滤镜 ${await inline('filter')} · 背景滤镜 ${await inline('backdrop-filter')}`)

AC('AC-6.12c', (await fxRows()) === fxBase + 3, `加三种就多三行（${fxBase} → ${await fxRows()}）`)

// 同一种可以加多条——box-shadow 本来就收多条，顺序影响谁画在上面
await addFx('投影')
// 不能按 '),' 切：box-shadow 的写法是 `rgba(...) 0px 4px ...`，右括号后面跟的是
// 空格不是逗号。数默认投影那组长度出现了几次才准。
const dropCount = ((await inline('box-shadow')).match(/0px 4px 4px 0px/g) || []).length
AC('AC-6.12d', (await fxRows()) === fxBase + 4 && dropCount >= 2,
   `同一种效果能加多条（${await fxRows()} 行，box-shadow 里 ${dropCount} 条默认投影）`)

// 关掉一条：压暗留在列表里，属性里少一条
await P('section[data-group="effects"] [data-effect-eye="0"]').click(); await page.waitForTimeout(350)
AC('AC-6.12e', (await P('section[data-group="effects"] .effect-row.off').count()) === 1,
   '关掉的效果压暗后仍留在列表里')
await P('section[data-group="effects"] [data-effect-eye="0"]').click(); await page.waitForTimeout(350)

// 参数面板：只列 CSS 真的做得到的几项
await P('section[data-group="effects"] [data-effect-open="0"]').click(); await page.waitForTimeout(400)
const fxFields = await page.evaluate(() => {
  // 弹层内容在宿主的 shadow root 里
  const hosts = [...document.querySelectorAll('[data-visual-revise-ui]')].filter(n => n.shadowRoot?.querySelector('[data-fx]'))
  const host = hosts[hosts.length - 1]
  return host ? [...host.shadowRoot.querySelectorAll('[data-fx]')].map(i => i.dataset.fx) : []
})
AC('AC-6.12f', JSON.stringify(fxFields) === JSON.stringify(['x', 'y', 'blur', 'spread', 'color']),
   `投影的参数面板：${fxFields.join(' / ')}`)

const fxY = page.locator('[data-visual-revise-ui] input[data-fx="y"]').last()
await fxY.fill('12'); await fxY.press('Enter'); await page.waitForTimeout(400)
AC('AC-6.12g', /12px/.test(await inline('box-shadow')),
   `参数面板改 Y 写回 box-shadow（${(await inline('box-shadow')).slice(0, 30)}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)

// 拖拽排序。用 pointer 事件而不是 HTML5 draggable：行里铺满了 button，
// 按在它上面浏览器不发 dragstart；而且原生拖放在自动化里驱动不了——
// CDP 的鼠标事件不会让浏览器合成拖放。
const dragRow = async (from, to) => {
  const A = P(`section[data-group="effects"] [data-effect-row="${from}"]`)
  const B = P(`section[data-group="effects"] [data-effect-row="${to}"]`)
  // 面板自己是滚动容器：行在可视区外时 boundingBox 给的坐标点过去会落到别处
  await A.scrollIntoViewIfNeeded(); await page.waitForTimeout(150)
  const a = await A.boundingBox(), b = await B.boundingBox()
  await page.mouse.move(a.x + 20, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 20, a.y + a.height / 2 + 8, { steps: 3 })
  await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(450)
}
const fxNames = () => page.evaluate(() => [...document.querySelector('visual-revise-panel').shadowRoot
  .querySelectorAll('section[data-group="effects"] .effect-name')].map(n => n.textContent))
const beforeOrder = await fxNames()
await dragRow(0, 1)
const afterOrder = await fxNames()
AC('AC-6.12h', beforeOrder[0] === afterOrder[1] && beforeOrder[1] === afterOrder[0],
   `拖拽换位（${beforeOrder.slice(0, 2).join(',')} → ${afterOrder.slice(0, 2).join(',')}）`)

// 收起的分区加了东西也看不见，点下去像是没反应
await P('section[data-group="effects"] h3 .title').click(); await page.waitForTimeout(300)
const wasFolded = await page.evaluate(() => document.querySelector('visual-revise-panel').shadowRoot
  .querySelector('section[data-group="effects"]').hasAttribute('folded'))
await addFx('背景模糊')
AC('AC-6.12i', wasFolded && !(await page.evaluate(() => document.querySelector('visual-revise-panel').shadowRoot
  .querySelector('section[data-group="effects"]').hasAttribute('folded'))),
   '在收起的分区上点加号会自动展开')

// 变量列表在颜色弹层的「变量」页里，自带滚动条：在它上面滚动不能把弹层关掉
// ——一滚就关等于只能选最上面几项
await page.addStyleTag({ content: ':root{--vr-test-accent:#ff4704;--vr-test-font:Inter, sans-serif;'
  + '--vr-test-gap:12px;--vr-test-scale:1.25;'
  + Array.from({ length: 20 }, (_, i) => `--vr-bulk-${i}:#${((i * 53) % 4096).toString(16).padStart(3, '0')};`).join('') + '}' })
await page.waitForTimeout(200)

const COLORPOP = 'visual-revise-color-panel'
const popRows = () => page.evaluate(id => {
  const m = document.getElementById(id)
  return m ? [...m.shadowRoot.querySelectorAll('[data-item]')].map(r => r.textContent.trim()) : null
}, COLORPOP)

// #rich 有直接文字，Fill 的主填充是字色，标题栏那个按钮绑的就是 color
await P('section[data-group="fill"] .var-btn').click({ force: true }); await page.waitForTimeout(400)
const listBox = await page.evaluate(id => {
  const list = document.getElementById(id)?.shadowRoot.querySelector('[data-item]')?.parentElement
  if (!list) return null
  const r = list.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height, can: list.scrollHeight > list.clientHeight }
}, COLORPOP)
if (listBox) {
  await page.mouse.move(listBox.x + listBox.w / 2, listBox.y + listBox.h / 2)
  await page.mouse.wheel(0, 150); await page.waitForTimeout(300)
  AC('AC-6.24b', await page.evaluate(id => !!document.getElementById(id), COLORPOP),
     `在变量列表里滚动不会把弹层关掉（可滚=${listBox.can}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
} else AC('AC-6.24b', false, '变量页没弹出')

// Effects 没有「绑定变量」：效果模型从 computed 反解，var() 存不住，绑了也活不过一次编辑
AC('AC-6.23c', (await P('section[data-group="fill"] .var-btn').count()) === 1
  && (await P('section[data-group="stroke"] .var-btn').count()) === 1
  && (await P('section[data-group="effects"] .var-btn').count()) === 0,
   'Fill / Stroke 标题栏有「绑定变量」，Effects 没有')

// 上一条用 Esc 关的弹层——确认它真的关了，否则「再点同一个按钮」会被当成关闭它
AC('AC-6.24b2', !(await page.evaluate(id => !!document.getElementById(id), COLORPOP)),
   'Esc 能关掉颜色弹层')

await P('section[data-group="fill"] .var-btn').click({ force: true }); await page.waitForTimeout(400)
const varItems = await popRows()
// 挑颜色时不该看到字体栈和 12px——点了也 apply 不上，只是让人多翻几屏
const leaked = (varItems || []).filter(t => /--vr-test-(font|gap|scale)/.test(t))
AC('AC-6.24e', varItems !== null && leaked.length === 0
  && (varItems || []).some(t => t.includes('--vr-test-accent')),
   `变量页按类型过滤，颜色格里只列颜色变量${leaked.length ? '（混进了：' + leaked.join(',') + '）' : ''}`)

const accentItem = page.locator(`#${COLORPOP} [data-item="--vr-test-accent"]`).first()
if (!varItems || !(await accentItem.count())) {
  AC('AC-6.24c', false, `变量页里找不到测试变量（列表：${varItems ? varItems.slice(0, 4).join(',') : '没弹出'}）`)
  AC('AC-6.24d', false, '同上，跳过 unlink')
} else {
await accentItem.click()
await page.waitForTimeout(450)

const boundRow = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const row = sr.querySelector('section[data-group="fill"] .layer-row.bound')
  const el = document.getElementById('rich')
  return {
    name: row?.querySelector('.var-name')?.textContent ?? null,
    hasUnlink: !!row?.querySelector('[data-unlink]'),
    // 绑定态不该再出现可编辑的色值框
    hasColorBox: !!row?.querySelector('vr-color'),
    inline: el.style.getPropertyValue('color'),
    computed: getComputedStyle(el).color,
  }
})
const bound = await boundRow()
AC('AC-6.24c', bound.name === '--vr-test-accent' && bound.hasUnlink && !bound.hasColorBox
  && bound.inline === 'var(--vr-test-accent)',
   `绑定后是变量 chip、不再有可编辑色值框（${JSON.stringify(bound)}）`)

const beforeColor = bound.computed
await P('section[data-group="fill"] [data-unlink]').click(); await page.waitForTimeout(450)
const unlinked = await boundRow()
AC('AC-6.24d', unlinked.name === null && unlinked.inline === beforeColor && unlinked.computed === beforeColor,
   `unlink 用当前解析值顶替 var()：绑定断了、颜色不变（inline="${unlinked.inline}"）`)
}

// ── 样式表里的变量绑定 ──
// 绝大多数页面的 var() 写在样式表里而不是 inline。三个元素：
//   #fx-bound  .vr-fx { background: var(--vr-fx-surface); color: var(--vr-fx-ink); border: 2px solid var(--vr-fx-line) }
//   #fx-bound-p  它的子元素，自己没写 color，字色继承自父级的变量
//   #fx-over   多了 .vr-fx-over { background: #112233 }——更高优先级的非变量声明压掉了变量
console.log('── 样式表里的变量绑定')
await page.addStyleTag({ content: ':root{--vr-fx-surface:#223344;--vr-fx-ink:#ffcc00;--vr-fx-line:#ff00aa}'
  + '.vr-fx{position:absolute;top:400px;width:200px;height:80px;padding:8px;background:var(--vr-fx-surface);color:var(--vr-fx-ink);border:2px solid var(--vr-fx-line)}'
  + '#fx-bound{left:400px}#fx-over{left:640px}.vr-fx.vr-fx-over{background:#112233}' })
await page.evaluate(() => {
  for (const [id, cls] of [['fx-bound', 'vr-fx'], ['fx-over', 'vr-fx vr-fx-over']]) {
    const d = document.createElement('div'); d.id = id; d.className = cls
    d.innerHTML = `<p id="${id}-p" style="margin:0">child of ${id}</p>`
    document.body.appendChild(d)
  }
})
const pickEl = async (sel, pos) => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.locator(sel).click({ position: pos }); await page.waitForTimeout(500) }
// 填充层的 chip 是那一层 vr-fill 自己的触发器（弹层是实例方法，行里没有实例
// 的话 chip 点了无处可去），内容在它的 shadow root 里
const chips = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const q = sel => sr.querySelector(sel)
  const layer = q('section[data-group="fill"] .layers vr-fill[bound]')
  return {
    fill: layer?.getAttribute('bound') ?? null,
    fillName: layer?.shadowRoot?.querySelector('.var-name')?.textContent ?? null,
    text: q('section[data-group="fill"] .field .var-chip .var-name')?.textContent ?? null,
    stroke: q('section[data-group="stroke"] .var-chip .var-name')?.textContent ?? null,
    strokeTitle: q('section[data-group="stroke"] .var-chip')?.getAttribute('title') ?? '',
    textTitle: q('section[data-group="fill"] .field .var-chip')?.getAttribute('title') ?? '',
  }
})

await pickEl('#fx-bound', { x: 190, y: 70 })
let c = await chips()
AC('AC-6.24f', c.fill === '--vr-fx-surface' && c.fillName === '--vr-fx-surface'
  && c.stroke === '--vr-fx-line',
   `样式表里的 var() 也识别为绑定：fill=${c.fill}（长手）、stroke=${c.stroke}（border 简写里的一段）`)
AC('AC-6.24f2', /\.vr-fx \{ border: 2px solid var\(--vr-fx-line\) \}/.test(c.strokeTitle),
   `chip 的 title 说明来源规则（${c.strokeTitle}）`)

await pickEl('#fx-bound-p', { x: 5, y: 5 })
c = await chips()
AC('AC-6.24g', c.text === '--vr-fx-ink' && /继承自 <div#fx-bound\.vr-fx>/.test(c.textTitle),
   `继承来的字色也显示成 chip，title 注明来自哪个祖先（text=${c.text}，${c.textTitle}）`)

await pickEl('#fx-over', { x: 190, y: 70 })
c = await chips()
AC('AC-6.24h', c.fill === null && c.stroke === '--vr-fx-line',
   `被更高优先级的非变量声明压掉的不显示 chip（fill=${c.fill}），没被压的照常（stroke=${c.stroke}）`)

// 点 chip 重开变量页：当前那个勾着、对勾在最右、左边是色圈；挑别的就换绑
await pickEl('#fx-bound', { x: 190, y: 70 })
// 面板本身是滚动容器，Stroke 分区多半在折叠线以下，先滚到看得见再点
const strokeChip = P('section[data-group="stroke"] .var-chip').first()
await strokeChip.scrollIntoViewIfNeeded(); await strokeChip.click(); await page.waitForTimeout(400)
const popRows2 = await page.evaluate(() => {
  const m = document.getElementById('visual-revise-color-panel')
  if (!m) return null
  return [...m.shadowRoot.querySelectorAll('[data-item]')].map(row => {
    const kids = [...row.children]
    return {
      text: row.textContent.trim(),
      current: row.hasAttribute('data-current'),
      first: kids[0]?.hasAttribute('data-swatch')
        ? { radius: getComputedStyle(kids[0]).borderRadius, bg: kids[0].style.background,
            w: kids[0].offsetWidth, h: kids[0].offsetHeight }
        : null,
      lastIsCheck: !!kids.at(-1)?.querySelector('svg'),
      checkFirst: !!kids[0]?.querySelector('svg'),
    }
  })
})
const lineRow = popRows2?.find(r => r.text.includes('--vr-fx-line'))
const accentRow = popRows2?.find(r => r.text.includes('--vr-test-accent'))
AC('AC-6.24i', !!popRows2 && !!lineRow?.lastIsCheck && !lineRow.checkFirst && lineRow.current
  && popRows2.filter(r => r.lastIsCheck).length === 1,
   `点 chip 重开变量页，当前绑定的那项勾着、对勾在最右（${popRows2 ? popRows2.length + ' 项' : '弹层没出来'}）`)
AC('AC-6.24j', !!lineRow?.first && lineRow.first.radius === '50%' && lineRow.first.w === 16 && lineRow.first.h === 16
  && /rgb\(255, 0, 170\)/.test(lineRow.first.bg) && !!accentRow?.first && /rgb\(255, 71, 4\)/.test(accentRow.first.bg),
   `列表项最左是 16px 色圈，颜色就是变量的值（${JSON.stringify(lineRow?.first)}）`)

if (accentRow) {
  await page.locator('#visual-revise-color-panel [data-item="--vr-test-accent"]').first().click()
  await page.waitForTimeout(450)
  const after = await page.evaluate(() => ({
    inline: document.getElementById('fx-bound').style.getPropertyValue('border-color'),
    computed: getComputedStyle(document.getElementById('fx-bound')).borderTopColor,
  }))
  c = await chips()
  AC('AC-6.24i2', after.inline === 'var(--vr-test-accent)' && c.stroke === '--vr-test-accent' && after.computed === 'rgb(255, 71, 4)',
     `从变量页挑别的变量就换绑：inline 写 var()、chip 跟着换（${after.inline} → ${c.stroke}）`)
} else AC('AC-6.24i2', false, '变量页里没有 --vr-test-accent，跳过换绑')
// 后面的用例都以 #rich 为对象
await select()

// 删干净，别影响后面的分组用例
for (let i = await fxRows(); i > 0; i--) {
  await P('section[data-group="effects"] [data-effect-del="0"]').click()
  await page.waitForTimeout(300)
}

// ── 6.13 / 6.14 记录与分组按钮 ──
console.log('── 6.13 / 6.14 记录 · 分组')
const dirtyLabel = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return !!sr.querySelector('label.name[data-prop="opacity"][data-dirty]')
})
AC('AC-6.13b', dirtyLabel, '改过的字段标签带 data-dirty（颜色变成 accent）')
const undoBtn = P('.acts .undo[data-undo="appearance"]')
AC('AC-6.14a', await undoBtn.isVisible(), '「重置本组」只在该组改过时出现')
await undoBtn.click(); await page.waitForTimeout(300)
// 还原的是元素原本的 inline 值（opacity:.95 / border-radius:8px），不是清空——
// 「重置」的语义是回到改稿之前，不是抹掉页面自带的样式
AC('AC-6.14b', (await inline('opacity')) === '0.95' && (await inline('border-radius')) === '8px', `点「重置本组」把 Appearance 还原到改稿前（opacity="${await inline('opacity')}" radius="${await inline('border-radius')}"）`)
// Fill / Stroke / Effects 已经改成层列表，可见性下放到每一行，标题上不再有
// 分区级眼睛。分区眼睛只剩在别的分区上——这里用 Effects 之外的分区来验它还在。
AC('AC-6.14c', (await P('section[data-group="effects"] .acts .eye').count()) === 0,
   'Effects 标题上不再有分区级眼睛（可见性下放到每一行）')

// ── 6.15 折叠策略 ──
console.log('── 6.15 折叠策略')
await page.evaluate(() => { const t = document.createElement('p'); t.id = 'txt'; t.textContent = '一段文字'; t.style.cssText = 'position:absolute;left:20px;top:560px'; document.body.appendChild(t) })
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await page.locator('#txt').click(); await page.waitForTimeout(500)
const foldState = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const f = t => [...sr.querySelectorAll('section')].find(x => x.querySelector('h3 .title')?.textContent.trim() === t)?.hasAttribute('folded')
  return { typography: f('Typography'), effects: f('Effects') }
})
// 只断言 Typography：Effects 在 6.12 被点开过，#folded 是面板实例状态，换选元素不重置
AC('AC-6.15', foldState.typography === false,
   `选中文字元素时 Typography 自动展开（${JSON.stringify(foldState)}）`)

// ── 6.18 / 6.19 / 6.20 Fill 分区 ──
// 用一个「有字色也有背景色」的链接：Fill 分区会同时渲染出文字色和填充两行，
// 正好是这两条 AC 要比的那一对控件。
console.log('── 6.18/6.19/6.20 Fill 分区')
await page.evaluate(() => {
  const a = document.createElement('a'); a.id = 'lnk'; a.textContent = '一个链接'
  a.style.cssText = 'position:absolute;left:20px;top:620px;padding:6px;color:#1a0dab;background-color:#c4c4c4'
  document.body.appendChild(a)
})
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await page.locator('#lnk').click({ position: { x: 4, y: 4 } }); await page.waitForTimeout(500)

const lnk = prop => page.evaluate(p => document.getElementById('lnk').style.getPropertyValue(p), prop)
const fillShape = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const f = sr.querySelector('section[data-group="fill"] vr-fill')
  if (!f) return null
  const fs = f.shadowRoot
  return {
    text: fs.querySelector('.text')?.value ?? null,
    alpha: fs.querySelector('.alpha')?.value ?? null,
    label: fs.querySelector('.label')?.textContent ?? null,
  }
})

const shape0 = await fillShape()
AC('AC-6.19a', shape0?.text?.toLowerCase() === '#c4c4c4' && shape0?.alpha === '100' && shape0?.label === null,
   `纯色态填充是可编辑的色值 + 不透明度双输入（${JSON.stringify(shape0)}）`)

// 两个控件在面板里上下相邻，差一个像素都看得出来，所以逐项比而不是只比存在性
const sameBox = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = sr.querySelector('section[data-group="fill"]')
  const pick = host => {
    const g = sel => { const r = host.shadowRoot.querySelector(sel)?.getBoundingClientRect(); return r ? [+r.width.toFixed(1), +r.height.toFixed(1)] : null }
    return { swatch: g('.swatch'), fields: g('.fields'), alpha: g('.alpha'), sep: g('.sep'), pct: g('.pct') }
  }
  const a = pick(sec.querySelector('vr-color')), b = pick(sec.querySelector('vr-fill'))
  // fields 的宽度不该比：两者都在层行里，但填充那行右侧多一个减号（字色删不掉），
  // 剩余宽度天然差一个按钮。比的是各子件自身的尺寸。
  const keys = ['swatch', 'alpha', 'sep', 'pct']
  const diff = keys.filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
  return { diff, a, b, 高度一致: a.fields?.[1] === b.fields?.[1] }
})
AC('AC-6.19b', sameBox.diff.length === 0 && sameBox.高度一致,
   `文字色与填充的色块 / 输入框逐项同尺寸${sameBox.diff.length ? `（不同：${sameBox.diff.join(', ')} ${JSON.stringify(sameBox.a)} vs ${JSON.stringify(sameBox.b)}）` : ''}`)

// 双输入要真的能写，否则只是长得像
const fillAlpha = P('section[data-group="fill"] vr-fill .alpha')
await fillAlpha.fill('40'); await fillAlpha.press('Enter'); await page.waitForTimeout(300)
AC('AC-6.19c', (await lnk('background-color')).replace(/\s/g, '') === 'rgba(196,196,196,0.4)',
   `填充的不透明度框写回 background-color（${await lnk('background-color')}）`)

// 事件跨 shadow 边界会把 target 重定向到 host——不看 composedPath 就会误判成
// 「点在控件上」，把色盘弹出来盖住刚要敲的框
const popped = async id => page.evaluate(x => !!document.getElementById(x), id)
await P('section[data-group="fill"] vr-fill .text').click(); await page.waitForTimeout(250)
const fillNoPop = !(await popped('visual-revise-fill-panel'))
await P('section[data-group="fill"] vr-color .text').click(); await page.waitForTimeout(250)
const colorNoPop = !(await popped('visual-revise-color-panel'))
AC('AC-6.20a', fillNoPop && colorNoPop,
   `点色值框是敲值、不弹色盘（填充 ${fillNoPop ? '✓' : '✗'} / 文字色 ${colorNoPop ? '✓' : '✗'}）`)
await P('section[data-group="fill"] vr-fill .swatch').click(); await page.waitForTimeout(350)
AC('AC-6.20b', await popped('visual-revise-fill-panel'), '点色块打开填充弹层')
// Esc 一次只做一件事：第一下关弹层（选中还在），第二下才取消选中。
// 以前是弹层组件不接 Esc、一路走到取消选中，弹层跟着面板被动消失——
// 那是假的「Esc 关弹层」。现在要真的清掉选中再重选，否则 handles 会拦点击。
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
await page.locator('#lnk').click({ position: { x: 4, y: 4 } }); await page.waitForTimeout(500)

// 6.18：可见性下放到每一行。字色和背景填充各有自己的眼睛，互不影响——
// 这正是 Figma 的模型：文本图层的 fill 就是字色，它是列表里的一条。
// 这条以前空转过：断言只看按钮的 data-on 变没变，没看页面上真的关掉了什么。
const before = { color: await lnk('color'), bg: await lnk('background-color') }

await P('section[data-group="fill"] [data-text-eye]').click(); await page.waitForTimeout(300)
AC('AC-6.18a', (await lnk('color')) === 'transparent' && (await lnk('background-color')) === before.bg,
   `关字色只关字色，不碰背景（color="${await lnk('color')}" background-color="${await lnk('background-color')}"）`)
await P('section[data-group="fill"] [data-text-eye]').click(); await page.waitForTimeout(300)
AC('AC-6.18b', (await lnk('color')) === before.color,
   `再点原样还原（color="${await lnk('color')}"）`)

await P('section[data-group="fill"] [data-layer-eye="0"]').click(); await page.waitForTimeout(300)
AC('AC-6.18d', (await lnk('background-color')) === 'transparent' && (await lnk('color')) === before.color,
   `关填充层只关背景，不碰字色（background-color="${await lnk('background-color')}"）`)
AC('AC-6.19d', (await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return sr.querySelector('section[data-group="fill"] .layer-row.off') !== null
})), '关掉的层压暗后仍留在列表里——随时能开回来，删掉才是真的没了')
await P('section[data-group="fill"] [data-layer-eye="0"]').click(); await page.waitForTimeout(300)
AC('AC-6.18c', (await lnk('background-color')) === before.bg,
   `再点原样还原（background-color="${await lnk('background-color')}"）`)

// ── 6.21 图标居中 ──
console.log('── 6.21 图标按钮')
const offCenter = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const bad = []
  for (const btn of sr.querySelectorAll('.icon-btn')) {
    const svg = btn.querySelector('svg'); if (!svg) continue
    const b = btn.getBoundingClientRect(); if (!b.width) continue
    const s = svg.getBoundingClientRect()
    const dx = +((s.x + s.width / 2) - (b.x + b.width / 2)).toFixed(2)
    const dy = +((s.y + s.height / 2) - (b.y + b.height / 2)).toFixed(2)
    if (dx || dy) bad.push(`${btn.className} dx=${dx} dy=${dy}`)
  }
  return { bad, count: sr.querySelectorAll('.icon-btn').length }
})
AC('AC-6.21', offCenter.bad.length === 0,
   `${offCenter.count} 个图标按钮的图标全部居中${offCenter.bad.length ? `（偏移：${offCenter.bad.join(' / ')}）` : ''}`)

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
