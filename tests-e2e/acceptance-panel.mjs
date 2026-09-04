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

// 一个能让 7 组都显示的元素
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'rich'
  d.style.cssText = 'position:absolute;left:20px;top:400px;width:300px;height:120px;display:flex;gap:8px;padding:12px;background:#456;border:2px solid #789;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);font-size:14px;color:#fff;opacity:.95;font-family:Poppins, "PingFang TC", sans-serif'
  d.innerHTML = '<span>子 A</span><span>子 B</span>'
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
await write('opacity', 0.5); await write('border-radius', 13)
AC('AC-6.8', await inline('opacity') === '0.5' && await inline('border-radius') === '13px', `不透明度 ${await inline('opacity')} · 圆角 ${await inline('border-radius')}`)

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
console.log('── 6.12 Effects')
await unfold('Effects')
await write('box-shadow', '0 4px 12px rgba(0,0,0,.5)')
await write('filter', 'blur(2px)')
await write('backdrop-filter', 'blur(4px)')
AC('AC-6.12', /12px/.test(await inline('box-shadow')) && await inline('filter') === 'blur(2px)' && await inline('backdrop-filter') === 'blur(4px)',
   `阴影 ${(await inline('box-shadow')).slice(0, 22)} · 滤镜 ${await inline('filter')} · 背景滤镜 ${await inline('backdrop-filter')}`)

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
const eye = P('.eye[data-eye="effects"]')
if (await eye.count()) {
  await eye.click(); await page.waitForTimeout(250)
  const on = await eye.getAttribute('data-on')
  await eye.click(); await page.waitForTimeout(250)
  AC('AC-6.14c', on !== null && (await eye.getAttribute('data-on')) === null, '「临时关闭本组」可开可关')
} else AC('AC-6.14c', false, 'Effects 组没有「临时关闭」眼睛钮')

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

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
