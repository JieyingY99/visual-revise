// C 组：数值框单位 / 字距百分比 / 线型预览
// 覆盖功能清单 v2 的 2.3.14–2.3.19、2.7.9、2.9.14、3.1.12（PRD AC-6.39 / 6.40 / 6.43）
// 断言全部落在「面板里看到的数字 + 后缀」与「元素 inline style」两端——
// 前者是用户读到的，后者是工具真正写出去的，两者对不上就是 bug。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const AC = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

console.log('\n[C 组] 数值框单位 · 字距百分比 · 线型预览\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

// ── 夹具：现成 fixture.html 之外再摆几个专门验单位的元素 ─────────────
await page.evaluate(() => {
  document.documentElement.style.setProperty('--u-lh', '1.75')
  const mk = (id, tag, css, text) => {
    const el = document.createElement(tag)
    el.id = id
    el.style.cssText = css
    if (text) el.textContent = text
    document.body.appendChild(el)
    return el
  }
  // 行高 22.5px（15 × 1.5）拆后缀；字距 normal 验百分比 0
  mk('u-txt', 'p', 'position:absolute;left:24px;top:520px;margin:0;width:260px;font-size:15px;line-height:22.5px;letter-spacing:normal;color:#eee', '单位后缀 unit suffix')
  // 旋转 deg → ° ；圆角 20px 用来验「同一个数字换单位」
  mk('u-box', 'div', 'position:absolute;left:320px;top:520px;width:120px;height:80px;background:#345;rotate:45deg;border-radius:20px', '')
  // inline 是 var() / calc() / clamp()：不该把这串文本塞进数值框
  mk('u-var', 'p', 'position:absolute;left:24px;top:640px;margin:0;width:240px;font-size:20px;line-height:var(--u-lh);color:#eee', 'var 行高')
  mk('u-calc', 'p', 'position:absolute;left:300px;top:640px;margin:0;width:240px;font-size:20px;line-height:calc(1em + 5px);color:#eee', 'calc 行高')
  mk('u-clamp', 'div', 'position:absolute;left:24px;top:720px;width:120px;height:60px;background:#345;border-radius:clamp(4px, 10px, 12px)', '')
  // 尺寸框 / 间隔框：inline 用 em（字号 10px → 计算值 200px / 20px），
  // 首次渲染与回读后必须是同一条显示源，不能第一眼 px、点一下别处就跳成 em
  mk('u-dim', 'div', 'position:absolute;left:560px;top:520px;font-size:10px;width:20em;height:6em;background:#345;display:flex;gap:2em', '')
})

const P = sel => page.locator(`visual-revise-panel ${sel}`)
// pos 传 null 时点几何中心：旋转过的元素其外接框左上角落在元素之外，会被页面别的块拦下
const pick = async (id, pos = { x: 8, y: 8 }) => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.locator(`#${id}`).click(pos ? { position: pos } : {})
  await page.waitForTimeout(450)
}
const unfold = async title => {
  const sec = page.locator('visual-revise-panel section', { has: page.locator('h3 .title', { hasText: title }) })
  if (await sec.count() && await sec.getAttribute('folded') !== null) {
    await sec.locator('h3 .title').click(); await page.waitForTimeout(250)
  }
}
// 面板里一个数值框的全部可见事实：框里的数字、data-unit、右侧后缀、后缀是否占位
const field = prop => page.evaluate(p => {
  const sr = document.querySelector('visual-revise-panel')?.shadowRoot
  const i = sr?.querySelector(`input[data-prop="${p}"]`)
  if (!i) return null
  const suf = i.parentElement?.querySelector('.suffix')
  const cs = suf && getComputedStyle(suf)
  return {
    v: i.value,
    unit: i.dataset.unit ?? null,
    suffix: suf ? suf.textContent : null,
    hasSuffixEl: !!suf,
    sufDisplay: cs ? cs.display : null,
    sufPointer: cs ? cs.pointerEvents : null,
    sufOutsideInput: suf ? !i.contains(suf) : null,
    sufAtRight: suf && cs ? cs.position === 'absolute' && cs.right !== 'auto' : null,
    padRight: getComputedStyle(i).paddingRight,
  }
}, prop)
const inline = (id, prop) => page.evaluate(([i, p]) => document.getElementById(i).style.getPropertyValue(p), [id, prop])
const write = async (prop, value) => {
  const i = P(`input[data-prop="${prop}"]`).first()
  await i.scrollIntoViewIfNeeded()
  await i.fill(String(value)); await i.press('Enter'); await page.waitForTimeout(280)
}
const stepKey = async (prop, key, mods = '') => {
  const i = P(`input[data-prop="${prop}"]`).first()
  await i.scrollIntoViewIfNeeded()
  await i.click(); await page.waitForTimeout(80)
  await i.press(mods ? `${mods}+${key}` : key); await page.waitForTimeout(280)
}
const blurField = async prop => {
  await P(`input[data-prop="${prop}"]`).first().blur(); await page.waitForTimeout(200)
}

// ══ 2.3.14 单位只做展示、放在框外最右 ══════════════════════════════
console.log('── 2.3.14 单位只做展示、放框外最右')
await pick('u-txt', { x: 20, y: 8 })
await unfold('Typography')
{
  const lh = await field('line-height')
  AC('2.3.14a', !!lh && lh.v === '22.5' && lh.unit === 'px' && lh.suffix === 'px',
     `行高 22.5px 拆开：期望 框="22.5" data-unit="px" 后缀="px"，实际 框="${lh?.v}" data-unit="${lh?.unit}" 后缀="${lh?.suffix}"`)
  AC('2.3.14b', !!lh && lh.sufOutsideInput === true && lh.sufPointer === 'none' && lh.sufAtRight === true,
     `后缀不参与编辑：期望 在 input 之外 / pointer-events=none / 绝对定位贴右，实际 在外=${lh?.sufOutsideInput} pointer-events=${lh?.sufPointer} 贴右=${lh?.sufAtRight}`)
  const ls = await field('letter-spacing')
  AC('2.3.14c', !!ls && ls.suffix === '%',
     `字距是固定 % 单位：期望 后缀="%"，实际 后缀="${ls?.suffix}"`)
  // 字号也是数值框，就在行高左边同一行——它没有后缀位，非 px 单位无处可显示
  await write('font-size', '1.5em')
  const fs = await field('font-size')
  const fsCss = await inline('u-txt', 'font-size')
  AC('2.3.14d', !!fs && fs.hasSuffixEl && fs.suffix === 'em',
     `字号框的单位也要放框外最右：inline="${fsCss}" 期望 框="1.5" 有后缀元素且后缀="em"（与同行的行高一致），实际 框="${fs?.v}" 有后缀元素=${fs?.hasSuffixEl} 后缀=${fs?.suffix === null ? '(没有后缀元素)' : `"${fs?.suffix}"`}`)
  // 承接上一条：单位看不见但仍挂在 data-unit 上，下一次裸数字会被补上它。
  // 不预设该补 em 还是 px，只要求「框里看得见的东西能推出写进去的单位」二者必居其一
  await write('font-size', '20')
  const fsAfter = await inline('u-txt', 'font-size')
  const fsPx = await page.evaluate(() => getComputedStyle(document.getElementById('u-txt')).fontSize)
  const fsUnit = (await field('font-size'))?.unit
  AC('2.3.15d', fsAfter === '20px' || fs?.suffix === 'em',
     `敲裸数字 20 时，写进去的单位必须是框里看得见的那个：期望 要么框里显示过 em（则写 20em）、要么按默认单位写 "20px"，实际 框里的单位标识=${fs?.suffix === null || fs?.suffix === undefined ? '(没有后缀元素)' : `"${fs.suffix}"`} 写出 "${fsAfter}"（字号 ${fsPx}，data-unit="${fsUnit}"）`)
  await write('font-size', '15px')
}
{
  await pick('u-box', null)
  const rot = await field('rotate')
  AC('2.3.14e', !!rot && rot.v === '45' && rot.unit === 'deg' && rot.suffix === '°',
     `旋转 45deg 显示成度符号：期望 框="45" data-unit="deg" 后缀="°"，实际 框="${rot?.v}" data-unit="${rot?.unit}" 后缀="${rot?.suffix}"`)
  const left = await field('left')
  AC('2.3.14f', !!left && left.v === '320' && left.unit === '' && left.suffix === '',
     `px 是默认单位不显示：X=320px 期望 框="320" 后缀=""，实际 框="${left?.v}" 后缀="${left?.suffix}"`)
  const op = await field('opacity')
  AC('2.3.14g', !!op && op.suffix === '%',
     `不透明度是固定 % 单位：期望 后缀="%"，实际 后缀="${op?.suffix}"`)
  // 圆角单框（拆分行自己渲染，不走 #renderControl）：单位混在框里、没有后缀位
  const rad = await field('border-radius')
  AC('2.3.14h', !!rad && rad.hasSuffixEl && rad.v === '20' && rad.suffix === '',
     `圆角 20px 期望 框="20" 且有后缀位（换成 % 时单位有地方放），实际 框="${rad?.v}" 有后缀元素=${rad?.hasSuffixEl}`)
  // 换成 % 之后：写入路径（#showValue）与重新渲染路径（#renderSplitRow）都要拆成「20 + %」
  await write('border-radius', '20%')
  const radWrite = await field('border-radius')
  await pick('u-box', null)                       // 重新选中 → 走一次完整重绘
  const radFresh = await field('border-radius')
  AC('2.3.14i', radWrite.v === '20' && radWrite.suffix === '%' && radFresh.v === '20' && radFresh.suffix === '%',
     `圆角 20% 单位要放框外：期望 两条路径都是 框="20" 后缀="%"，实际 写入后 框="${radWrite.v}" 后缀=${radWrite.suffix === null ? '(没有后缀元素)' : `"${radWrite.suffix}"`}；重绘后 框="${radFresh.v}" 后缀=${radFresh.suffix === null ? '(没有后缀元素)' : `"${radFresh.suffix}"`}`)
}

// ══ 2.3.19 .suffix:empty 不占位 ═══════════════════════════════════
console.log('── 2.3.19 空后缀不占位')
{
  const left = await field('left')                // X=320px：px 剥掉后没有后缀
  const rot = await field('rotate')               // 45deg：后缀 °
  AC('2.3.19a', !!left && left.hasSuffixEl && left.suffix === '' && left.sufDisplay === 'none',
     `空后缀隐藏：X 框的 .suffix 期望 display=none，实际 ="${left?.sufDisplay}"（后缀文本 "${left?.suffix}"）`)
  AC('2.3.19b', !!left && parseFloat(left.padRight) < 26,
     `空后缀的框不留 26px 右内边距：期望 < 26px，实际 ${left?.padRight}`)
  AC('2.3.19c', !!rot && rot.sufDisplay !== 'none' && parseFloat(rot.padRight) === 26,
     `有后缀的框让位：旋转框期望 后缀可见 + padding-right=26px，实际 display=${rot?.sufDisplay} padding-right=${rot?.padRight}`)
}

// ══ 2.3.15 只敲数字沿用当前单位 / 敲带单位的换单位 ══════════════════
console.log('── 2.3.15 只敲数字沿用当前单位')
{
  await pick('u-txt', { x: 20, y: 8 })
  await unfold('Typography')
  await write('line-height', '30')
  const css1 = await inline('u-txt', 'line-height')
  AC('2.3.15a', css1 === '30px',
     `框里单位是 px，只敲 30：期望 inline line-height="30px"，实际 "${css1}"`)
  await write('line-height', '1.5em')
  const css2 = await inline('u-txt', 'line-height')
  const f2 = await field('line-height')
  AC('2.3.15b', css2 === '1.5em' && f2.v === '1.5' && f2.unit === 'em' && f2.suffix === 'em',
     `敲带单位的换单位：期望 inline="1.5em" 框="1.5" 后缀="em"，实际 inline="${css2}" 框="${f2.v}" 后缀="${f2.suffix}"`)
  await write('line-height', '2')
  const css3 = await inline('u-txt', 'line-height')
  AC('2.3.15c', css3 === '2em',
     `换单位后再只敲数字，沿用新单位 em：期望 inline="2em"，实际 "${css3}"`)
}

// ══ 2.3.16 步进按框里当前的单位走 ═══════════════════════════════════
console.log('── 2.3.16 步进按当前单位')
{
  await write('line-height', '1.5em')
  await stepKey('line-height', 'ArrowUp')
  const cssUp = await inline('u-txt', 'line-height')
  const fUp = await field('line-height')
  AC('2.3.16a', cssUp === '2.5em' && fUp.v === '2.5',
     `1.5em ↑ 一步按 em 走（不是回落到计算值 px）：期望 inline="2.5em" 框="2.5"，实际 inline="${cssUp}" 框="${fUp.v}"`)
  await blurField('line-height')

  // 拖标签调值走的是同一条 stepValue，单位也得跟着框里的走
  const label = P('label.name[data-prop="line-height"]').first()
  await label.scrollIntoViewIfNeeded()
  const lb = await label.boundingBox()
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
  await page.mouse.down()
  await page.mouse.move(lb.x + lb.width / 2 + 20, lb.y + lb.height / 2, { steps: 6 })
  await page.waitForTimeout(120)
  await page.mouse.up(); await page.waitForTimeout(250)
  const cssDrag = await inline('u-txt', 'line-height')
  AC('2.3.16a2', cssDrag === '12.5em',
     `拖标签右移 20px（10 步）也按 em 走：2.5em 期望 inline="12.5em"，实际 "${cssDrag}"`)

  await pick('u-box', null)
  await stepKey('rotate', 'ArrowUp')
  const rotUp = await inline('u-box', 'rotate')
  AC('2.3.16b', rotUp === '46deg',
     `45deg ↑ 一步按 deg 走：期望 inline rotate="46deg"，实际 "${rotUp}"`)
  await blurField('rotate')

  await write('border-radius', '30%')            // 上一段留下的是 20%，这里换个值确保真的提交
  await stepKey('border-radius', 'ArrowUp')
  const radUp = await inline('u-box', 'border-radius')
  AC('2.3.16c', radUp === '31%',
     `30% ↑ 一步按 % 走（不是补成 px）：期望 inline border-radius="31%"，实际 "${radUp}"`)
  await blurField('border-radius')
}

// ══ 2.3.17 显示源：inline 优先，var()/calc()/clamp() 退回计算值 ═════
console.log('── 2.3.17 inline 优先 · var()/calc() 不显示')
{
  await pick('u-txt', { x: 20, y: 8 })
  await unfold('Typography')
  await write('line-height', '1.5em')            // 计算值是 22.5px，inline 是 1.5em
  const f = await field('line-height')
  AC('2.3.17a', f.v === '1.5' && f.unit === 'em',
     `inline 优先于计算值：inline=1.5em 计算值=22.5px，期望 框="1.5" 后缀="em"，实际 框="${f.v}" 后缀="${f.suffix}"`)

  await pick('u-var', { x: 20, y: 8 })
  await unfold('Typography')
  const fv = await field('line-height')
  const computedVar = await page.evaluate(() => getComputedStyle(document.getElementById('u-var')).lineHeight)
  AC('2.3.17b', !!fv && !/var\(/.test(fv.v) && fv.v === String(parseFloat(computedVar)) && fv.unit === 'px',
     `inline 是 var(--u-lh) 时退回计算值：期望 框="${parseFloat(computedVar)}" 后缀="px"，实际 框="${fv?.v}" 后缀="${fv?.suffix}"`)

  await pick('u-calc', { x: 20, y: 8 })
  await unfold('Typography')
  const fc = await field('line-height')
  const computedCalc = await page.evaluate(() => getComputedStyle(document.getElementById('u-calc')).lineHeight)
  AC('2.3.17c', !!fc && !/calc\(/.test(fc.v) && fc.v === String(parseFloat(computedCalc)),
     `inline 是 calc(1em + 5px) 时退回计算值：期望 框="${parseFloat(computedCalc)}"，实际 框="${fc?.v}"`)

  await pick('u-clamp', { x: 10, y: 10 })
  const fk = await field('border-radius')
  const computedClamp = await page.evaluate(() => getComputedStyle(document.getElementById('u-clamp')).borderTopLeftRadius)
  AC('2.3.17d', !!fk && !/clamp\(|min\(|max\(/.test(fk.v) && fk.v === String(parseFloat(computedClamp)),
     `inline 是 clamp(...) 时退回计算值：期望 框="${parseFloat(computedClamp)}"，实际 框="${fk?.v}"`)
}

// 尺寸框与间隔框自己拼模板，显示源要跟 #syncValues 的回读同一条：
// 取计算值的话，第一眼是 200 / 20（px），点一下别处回读就当场跳成 20em / 2em
{
  await pick('u-dim', { x: 8, y: 8 })
  await unfold('Layout')
  const w0 = await field('width')
  const g0 = await field('gap')
  await P('input[data-prop="width"]').first().click()
  await P('input[data-prop="height"]').first().click()   // 上一个框失焦 → #syncValues 回读
  await page.waitForTimeout(320)
  const w1 = await field('width')
  const g1 = await field('gap')
  AC('2.3.17e', w0?.v === '20' && w0?.suffix === 'em' && w1?.v === '20' && w1?.suffix === 'em',
     `尺寸框第一眼就取 inline 的 20em、回读后不跳变：期望 两次都是 框="20" 后缀="em"，实际 首次 框="${w0?.v}" 后缀=${w0?.suffix === null ? '(没有后缀元素)' : `"${w0?.suffix}"`}，回读后 框="${w1?.v}" 后缀=${w1?.suffix === null ? '(没有后缀元素)' : `"${w1?.suffix}"`}`)
  AC('2.3.17f', g0?.v === '2' && g0?.suffix === 'em' && g1?.v === '2' && g1?.suffix === 'em',
     `间隔框同理（gap: 2em，计算值 20px）：期望 两次都是 框="2" 后缀="em"，实际 首次 框="${g0?.v}" 后缀=${g0?.suffix === null ? '(没有后缀元素)' : `"${g0?.suffix}"`}，回读后 框="${g1?.v}" 后缀=${g1?.suffix === null ? '(没有后缀元素)' : `"${g1?.suffix}"`}`)
  await blurField('height')
}

// ══ 2.3.18 提交后框仍聚焦：数字与后缀当场刷新 ═══════════════════════
console.log('── 2.3.18 提交后框仍聚焦时刷新数字与后缀')
{
  await pick('u-txt', { x: 20, y: 8 })
  await unfold('Typography')
  await write('line-height', '30')               // 回到 px
  const focusedBefore = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    return sr.activeElement?.dataset?.prop || null
  })
  await write('line-height', '1.5em')            // 提交后不失焦
  const focusedAfter = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    return sr.activeElement?.dataset?.prop || null
  })
  const f = await field('line-height')
  AC('2.3.18a', focusedBefore === 'line-height' && focusedAfter === 'line-height' && f.v === '1.5' && f.unit === 'em' && f.suffix === 'em',
     `Enter 后框仍聚焦（${focusedAfter}），框里不留 "1.5em" 原文：期望 框="1.5" data-unit="em" 后缀="em"，实际 框="${f.v}" data-unit="${f.unit}" 后缀="${f.suffix}"`)
  await stepKey('line-height', 'ArrowUp')        // 紧接着步进，不能拼成 1.5empx
  const cssStep = await inline('u-txt', 'line-height')
  AC('2.3.18b', cssStep === '2.5em',
     `提交后紧接着步进不拼错单位：期望 inline="2.5em"（不是 1.5empx 被 CSSOM 丢弃），实际 "${cssStep}"`)
  await blurField('line-height')
}

// ══ 2.3.18 的反面之一：外部改动（撤销）后，后缀 / data-unit 也要跟着回退 ══
// 用旋转框做：它由 #renderControl 渲染、后缀位齐全，能把「后缀过期」这件事单独拎出来。
// 45deg → 45turn 数字不变、单位变了，撤销回 45deg 时 #syncValues 只比数字就会漏掉后缀。
console.log('── 2.3.18 外部撤销后后缀回退')
{
  await pick('u-box', null)
  await write('rotate', '45')                    // 基线：45deg
  await blurField('rotate')
  const base = await field('rotate')
  await write('rotate', '45turn')                // 数字不变、单位变了
  await blurField('rotate')
  const turn = await field('rotate')
  AC('2.3.18c', base.v === '45' && base.suffix === '°' && turn.v === '45' && turn.suffix === 'turn' && turn.unit === 'turn',
     `同一个数字换单位：45deg 期望 框="45" 后缀="°"（实际 "${base.v}"/"${base.suffix}"）→ 45turn 期望 框="45" 后缀="turn"（实际 "${turn.v}"/"${turn.suffix}"）`)
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(450)
  const cssBack = await inline('u-box', 'rotate')
  const after = await field('rotate')
  AC('2.3.18d', cssBack === '45deg' && after.suffix === '°' && after.unit === 'deg',
     `⌘Z 退回 45deg 后后缀要跟着回退：期望 inline="45deg" 框="45" 后缀="°" data-unit="deg"，实际 inline="${cssBack}" 框="${after.v}" 后缀="${after.suffix}" data-unit="${after.unit}"`)
  await stepKey('rotate', 'ArrowUp')
  const cssAfterStep = await inline('u-box', 'rotate')
  AC('2.3.18e', cssAfterStep === '46deg',
     `撤销后再步进要按真实单位 deg 走：期望 inline rotate="46deg"，实际 "${cssAfterStep}"（46turn = 16560°，差了 360 倍）`)
  await blurField('rotate')
}

// ══ 2.3.18 的反面之二：敲进一个与当前值相同的写法时，框也要刷回「数字 + 后缀」══
// change 处理器在 sameValue 时早退，框里留着用户敲的 "45deg" 原文，data-unit 还是 deg，
// 下一次步进就拼成 45degdeg —— 非法声明被 CSSOM 丢弃，元素不动而框里的数字照常往上走。
console.log('── 2.3.18 重复输入同一个值后框要刷新')
{
  await pick('u-box', null)
  await write('rotate', '45deg')                 // 先真的把值改成 45deg
  await blurField('rotate')
  await pick('u-box', null)                      // 重新渲染，框回到干净的「45 + °」
  const clean = await field('rotate')
  await write('rotate', '45deg')                 // 与当前值等价：不该提交，但框要刷回拆分形态
  const same = await field('rotate')
  AC('2.3.18f0', clean.v === '45' && clean.suffix === '°',
     `重新渲染后的基线：期望 框="45" 后缀="°"，实际 框="${clean.v}" 后缀="${clean.suffix}"`)
  AC('2.3.18f', same.v === '45' && same.suffix === '°' && same.unit === 'deg',
     `敲进等价写法后框要刷回「数字 + 后缀」：期望 框="45" 后缀="°"，实际 框="${same.v}" 后缀="${same.suffix}" data-unit="${same.unit}"`)
  await stepKey('rotate', 'ArrowUp')
  const cssStep = await inline('u-box', 'rotate')
  const box = await field('rotate')
  AC('2.3.18g', cssStep === '46deg' && box.v === '46' && box.suffix === '°',
     `紧接着步进不能拼出非法单位：期望 inline rotate="46deg" 框="46" 后缀="°"，实际 inline="${cssStep}" 框="${box.v}" 后缀="${box.suffix}"`)
  await blurField('rotate')
}

// ══ 2.7.9 字距按字号的百分比显示与输入 ══════════════════════════════
console.log('── 2.7.9 字距百分比')
{
  // .hero-eyebrow: font-size 12px, letter-spacing .18em → 计算值 2.16px → 18%
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.locator('.hero-eyebrow').click({ position: { x: 10, y: 6 } })
  await page.waitForTimeout(450)
  await unfold('Typography')
  const back = await field('letter-spacing')
  const fs = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-eyebrow')).fontSize)
  const lsPx = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-eyebrow')).letterSpacing)
  AC('2.7.9a', !!back && back.v === '18' && back.suffix === '%',
     `计算值 px 回读时除以字号：${lsPx} ÷ ${fs} 期望 框="18" 后缀="%"，实际 框="${back?.v}" 后缀="${back?.suffix}"`)

  await pick('u-txt', { x: 20, y: 8 })
  await unfold('Typography')
  const zero = await field('letter-spacing')
  AC('2.7.9b', zero.v === '0' && zero.suffix === '%',
     `letter-spacing:normal 显示 0：期望 框="0" 后缀="%"，实际 框="${zero.v}" 后缀="${zero.suffix}"`)
  await write('letter-spacing', '5')
  const w5 = await inline('u-txt', 'letter-spacing')
  const f5 = await field('letter-spacing')
  AC('2.7.9c', w5 === '0.05em' && f5.v === '5',
     `敲 5 写 em：期望 inline="0.05em" 框回读="5"，实际 inline="${w5}" 框="${f5.v}"`)
  await stepKey('letter-spacing', 'ArrowUp')
  const up1 = await inline('u-txt', 'letter-spacing')
  const fUp1 = await field('letter-spacing')
  AC('2.7.9d', up1 === '0.06em' && fUp1.v === '6',
     `↑ 一步 1%：期望 inline="0.06em" 框="6"，实际 inline="${up1}" 框="${fUp1.v}"`)
  await stepKey('letter-spacing', 'ArrowUp', 'Shift')
  const up10 = await inline('u-txt', 'letter-spacing')
  const fUp10 = await field('letter-spacing')
  AC('2.7.9e', up10 === '0.16em' && fUp10.v === '16',
     `Shift+↑ 一步 10%：期望 inline="0.16em" 框="16"，实际 inline="${up10}" 框="${fUp10.v}"`)
  await blurField('letter-spacing')
  await write('letter-spacing', '0')
  const zeroCss = await inline('u-txt', 'letter-spacing')
  const fZero = await field('letter-spacing')
  AC('2.7.9f', zeroCss === 'normal' && fZero.v === '0',
     `敲 0 写回 normal（不是 0em）：期望 inline="normal" 框="0"，实际 inline="${zeroCss}" 框="${fZero.v}"`)
}

// ══ 2.9.14 / 3.1.12 「样式」下拉把线型画出来 ═════════════════════════
console.log('── 2.9.14 / 3.1.12 线型预览')
{
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.locator('.curve-card').first().click({ position: { x: 20, y: 10 } })
  await page.waitForTimeout(450)
  const sel = P('vr-select[data-prop="border-style"]').first()
  const count = await sel.count()
  AC('2.9.14a', count > 0, `选中带描边的 .curve-card 后有「样式」下拉：期望 1 个 vr-select[data-prop=border-style]，实际 ${count} 个`)
  await sel.scrollIntoViewIfNeeded()
  const trig = await page.evaluate(() => {
    const el = document.querySelector('visual-revise-panel').shadowRoot.querySelector('vr-select[data-prop="border-style"]')
    const i = el.shadowRoot.querySelector('.label i[data-line]')
    const cs = i && getComputedStyle(i)
    return {
      value: el.value, preview: el.getAttribute('preview'), line: i?.dataset.line,
      style: cs?.borderTopStyle, width: cs?.width, gap: getComputedStyle(el.shadowRoot.querySelector('.label')).gap,
      text: el.shadowRoot.querySelector('.label').textContent.trim(),
    }
  })
  AC('2.9.14b', trig.preview === 'border' && trig.line === trig.value && trig.style === trig.value && parseFloat(trig.width) >= 16,
     `触发器前画出当前线型：值="${trig.value}" 期望 preview="border" 线 border-top-style="${trig.value}" 宽≥16px，实际 preview="${trig.preview}" style="${trig.style}" 宽=${trig.width}`)
  AC('3.1.12a', trig.gap === '8px' && trig.text === trig.value,
     `触发器 gap 8px、名字保留在线后面：期望 gap="8px" 文本="${trig.value}"，实际 gap="${trig.gap}" 文本="${trig.text}"`)

  await sel.click(); await page.waitForTimeout(350)
  const items = await page.evaluate(() => {
    const r = document.getElementById('visual-revise-select-panel')?.shadowRoot
    if (!r) return null
    return [...r.querySelectorAll('[data-item]')].map(row => {
      const i = row.querySelector('i[data-line]')
      const cs = i && getComputedStyle(i)
      return { v: row.dataset.item, style: cs?.borderTopStyle, w: cs?.borderTopWidth, width: cs?.width, gap: getComputedStyle(row).gap, label: row.textContent.trim() }
    })
  })
  const byV = Object.fromEntries((items || []).map(x => [x.v, x]))
  const styleOk = items && ['solid', 'dashed', 'dotted', 'double'].every(v => byV[v]?.style === v)
  AC('2.9.14c', styleOk, `下拉每项前的线型对得上：期望 solid/dashed/dotted/double 各画各的，实际 ${(items || []).map(x => `${x.v}=${x.style}`).join(' ')}`)
  AC('2.9.14d', !!byV.double && byV.double.w === '3px' && byV.solid?.w === '2px' && byV.none?.w === '0px',
     `double 要 3px 才画得出两条、none 留空白：期望 double=3px solid=2px none=0px，实际 double=${byV.double?.w} solid=${byV.solid?.w} none=${byV.none?.w}`)
  AC('2.9.14e', items && items.every(x => x.width === '24px'),
     `选项线宽 24px（none 也占位对齐）：期望 全部 24px，实际 ${(items || []).map(x => `${x.v}=${x.width}`).join(' ')}`)
  AC('3.1.12b', items && items.every(x => x.gap === '12px') && items.every(x => x.label === x.v),
     `选项行 gap 12px、名字保留：期望 全部 gap=12px 且文本=值，实际 ${(items || []).map(x => `${x.v}:${x.gap}/${x.label}`).join(' ')}`)

  // 选一项：触发器的线要跟着换
  await page.evaluate(() => {
    const r = document.getElementById('visual-revise-select-panel')?.shadowRoot
    r?.querySelector('[data-item="dashed"]')?.click()
  })
  await page.waitForTimeout(350)
  const after = await page.evaluate(() => {
    const el = document.querySelector('visual-revise-panel').shadowRoot.querySelector('vr-select[data-prop="border-style"]')
    const i = el.shadowRoot.querySelector('.label i[data-line]')
    return { value: el.value, style: i && getComputedStyle(i).borderTopStyle, css: document.querySelector('.curve-card').style.borderStyle }
  })
  AC('2.9.14f', after.value === 'dashed' && after.style === 'dashed' && after.css === 'dashed',
     `选 dashed 后触发器的线跟着换：期望 value/线型/inline 都是 dashed，实际 value="${after.value}" 线="${after.style}" inline="${after.css}"`)

  // preview 进了 observedAttributes：后加的属性也要触发重绘
  const attrLive = await page.evaluate(() => {
    const el = document.createElement('vr-select')
    el.setAttribute('options', JSON.stringify(['solid', 'dashed']))
    el.setAttribute('value', 'dashed')
    document.body.appendChild(el)
    const before = !!el.shadowRoot.querySelector('i[data-line]')
    el.setAttribute('preview', 'border')
    const i = el.shadowRoot.querySelector('i[data-line]')
    const after = { has: !!i, style: i && getComputedStyle(i).borderTopStyle }
    el.remove()
    return { before, after, observed: (customElements.get('vr-select').observedAttributes || []).includes('preview') }
  })
  AC('3.1.12c', attrLive.observed && attrLive.before === false && attrLive.after.has && attrLive.after.style === 'dashed',
     `preview 属性可动态生效：期望 observedAttributes 含 preview、加属性前无线段、加后画 dashed，实际 observed=${attrLive.observed} 加前有线=${attrLive.before} 加后=${attrLive.after.has}/${attrLive.after.style}`)

  // 标签走 esc() 转义
  const escaped = await page.evaluate(() => {
    const el = document.createElement('vr-select')
    el.setAttribute('options', JSON.stringify(['<b>x</b>', 'solid']))
    el.setAttribute('value', '<b>x</b>')
    el.setAttribute('preview', 'border')
    document.body.appendChild(el)
    const label = el.shadowRoot.querySelector('.label > span')
    const out = { text: label.textContent, injected: !!el.shadowRoot.querySelector('b') }
    el.remove()
    return out
  })
  AC('3.1.12d', escaped.text === '<b>x</b>' && !escaped.injected,
     `标签走 esc() 转义：期望 文本="<b>x</b>" 且不生成 <b> 元素，实际 文本="${escaped.text}" 生成了 b=${escaped.injected}`)
}

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
