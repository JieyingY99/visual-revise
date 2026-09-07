// 独立复现脚本 · 清单 2.9.1 / 2.9.3
//
// 报告称：把描边「样式」选成 none 之后，Stroke 分区不当场退回空状态，
// 加号还挂着 disabled + 「CSS 的 border 只有一层，不能再加」的误导 title。
// 期望（feature-inventory §2.9.1 / PRD AC-6.11a、#canAdd :610-617、#defaultRows :1053）：
// border-style 变 none（computed border-width 随之 0px）就等于没有描边，
// 分区应立刻只剩标题 + 加号，且加号可点。
//
// 本脚本不复用 tests-e2e/full/stroke-effects.mjs 的任何断言，全部自己重新测。
// 全程真实指针（locator.click / page.mouse），不用 element.click() / dispatchEvent。
import { serve, launch } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const P = sel => page.locator(`visual-revise-panel ${sel}`)
const S = sel => P(`section[data-group="stroke"] ${sel}`)

// 面板里 Stroke 分区此刻的真实结构
const readStroke = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel')?.shadowRoot
  const sec = sr?.querySelector('section[data-group="stroke"]')
  if (!sec) return null
  const add = sec.querySelector('.add[data-add="stroke"]')
  return {
    rows: sec.querySelector('.rows')?.children.length ?? -1,
    widthInputs: sec.querySelectorAll('input[data-prop="border-width"]').length,
    styleSelects: sec.querySelectorAll('vr-select[data-prop="border-style"]').length,
    colorCtrls: sec.querySelectorAll('vr-color[data-prop="border-color"]').length,
    sizingBtns: sec.querySelectorAll('button[data-prop="box-sizing"]').length,
    addDisabled: add ? add.hasAttribute('disabled') : null,
    addTitle: add ? add.getAttribute('title') : null,
    selectValue: sec.querySelector('vr-select[data-prop="border-style"]')?.getAttribute('value') ?? null,
  }
})

// 元素真实状态：inline 声明 + computed（#canAdd 读的就是 computed）
const elState = id => page.evaluate(i => {
  const el = document.getElementById(i)
  const cs = getComputedStyle(el)
  return {
    inlineStyle: el.style.getPropertyValue('border-style'),
    inlineWidth: el.style.getPropertyValue('border-width'),
    computedStyle: cs.borderTopStyle,
    computedWidth: cs.borderTopWidth,
    offsetW: el.offsetWidth,
  }
}, id)

// #canAdd 的判定复算（源码 :613-616 同款算式），用来证明「面板结论」和「判定」脱节
const canAddByRule = st =>
  !(parseFloat(st.computedWidth) > 0 && st.computedStyle && st.computedStyle !== 'none')

const select = async id => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(140)
  await page.keyboard.press('Escape'); await page.waitForTimeout(160)
  await page.locator(`#${id}`).click({ position: { x: 12, y: 12 } })
  await page.waitForTimeout(500)
}

const clickIn = async loc => {
  await loc.scrollIntoViewIfNeeded()
  await loc.click()
  await page.waitForTimeout(360)
}

// 真实鼠标点（连 disabled 按钮也照点不误：locator.click 会被 disabled 卡住，
// 这里直接用坐标，模拟用户真的把鼠标按在那个加号上）
const mouseClickAt = async loc => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  if (!b) return false
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(380)
  return true
}

const pickStyle = async value => {
  const sel = S('vr-select[data-prop="border-style"]')
  await sel.scrollIntoViewIfNeeded()
  await sel.click(); await page.waitForTimeout(360)
  const opts = await page.evaluate(() => {
    const p = document.getElementById('visual-revise-select-panel')
    return p ? [...p.shadowRoot.children].map(i => i.textContent) : null
  })
  console.log(`  [下拉] 选项 = ${JSON.stringify(opts)}`)
  await page.locator(`#visual-revise-select-panel [data-item="${value}"]`).click()
  await page.waitForTimeout(500)
}

await page.goto(`${origin}/full/fixtures/stroke-effects-main.html`)
const { injectVisBug } = await import('../../harness.mjs')
await injectVisBug(page, origin)
await page.waitForTimeout(400)

console.log('\n=== 2.9.1 「样式」选 none 之后 Stroke 分区是否当场退回空状态 · 独立复现 ===\n')

// ── 声明侧：RERENDER_ON 到底有哪几条 ─────────────────────────
const rr = await page.evaluate(() => {
  const s = window.__visualRevise?.lib?.RERENDER_ON
  return s ? [...s] : null
})
console.log('[声明] 运行时 RERENDER_ON =', JSON.stringify(rr),
  rr ? '' : '（运行时未导出，见 props-panel.element.js:177 源码 new Set([\'position\',\'display\'])）')

// ══════════════════════════════════════════════════════════
// A. #plain（本来没有描边）：加号 → 样式选 none
// ══════════════════════════════════════════════════════════
console.log('\n--- A. #plain：加描边 → 样式选 none ---')
await select('plain')
console.log('[选中] panel.target =', await page.evaluate(() =>
  document.querySelector('visual-revise-panel').target?.id))

const empty0 = await readStroke()
console.log('[初始空状态] ', JSON.stringify(empty0))

await clickIn(S('.add[data-add="stroke"]'))
const added = await readStroke()
const addedEl = await elState('plain')
console.log('[点加号后] 面板 =', JSON.stringify(added))
console.log('[点加号后] 元素 =', JSON.stringify(addedEl))

await pickStyle('none')
const afterNone = await readStroke()
const afterNoneEl = await elState('plain')
console.log('[选 none 后 · 面板] ', JSON.stringify(afterNone))
console.log('[选 none 后 · 元素] ', JSON.stringify(afterNoneEl))
console.log('[选 none 后 · #canAdd 判定复算] canAdd =', canAddByRule(afterNoneEl),
  `（computed border-width=${afterNoneEl.computedWidth}, border-style=${afterNoneEl.computedStyle}）`)

// 再多等一会儿，排除「延迟重绘」
await page.waitForTimeout(1200)
const afterWait = await readStroke()
console.log('[再等 1.2s · 面板] ', JSON.stringify(afterWait))

const staleA = afterWait.rows !== 0 || afterWait.addDisabled === true
console.log(`==> A 复现（分区没退回空状态 / 加号仍 disabled）? ${staleA}`)

// ══════════════════════════════════════════════════════════
// B. 用户影响：此刻那个 disabled 的加号真的点不动吗
// ══════════════════════════════════════════════════════════
console.log('\n--- B. 停在旧结构上的加号，用户点得动吗 ---')
const beforeClick = await elState('plain')
const hit = await mouseClickAt(S('.add[data-add="stroke"]'))
const afterClick = await elState('plain')
console.log('[真实鼠标点加号]', hit ? '已点' : '按钮没有 boundingBox，未点到')
console.log('[点前] ', JSON.stringify(beforeClick))
console.log('[点后] ', JSON.stringify(afterClick))
const addDead = afterClick.computedStyle === 'none' && parseFloat(afterClick.computedWidth) === 0
console.log(`==> 加号点下去毫无反应（用户没法把描边加回来）? ${addDead}`)

// ══════════════════════════════════════════════════════════
// C. 对照：换一次选中强制重绘，看 #canAdd 判定本身对不对
// ══════════════════════════════════════════════════════════
console.log('\n--- C. 点别的元素再点回来（强制 render）---')
await select('edged')
console.log('[中转选中 #edged] 面板 =', JSON.stringify(await readStroke()))
await select('plain')
const redrawn = await readStroke()
console.log('[点回 #plain 后] 面板 =', JSON.stringify(redrawn))
const rightAfterRedraw = redrawn.rows === 0 && redrawn.addDisabled === false
console.log(`==> 重绘后是正确的空状态? ${rightAfterRedraw}（说明 #canAdd 判定没错，缺的只是重绘）`)

// ══════════════════════════════════════════════════════════
// D. 反方向 & 另一个元素：#edged 本来就有 4px 实线，直接选 none
// ══════════════════════════════════════════════════════════
console.log('\n--- D. #edged（fixture 自带 4px solid）直接把样式选成 none ---')
await select('edged')
console.log('[选中 #edged] 面板 =', JSON.stringify(await readStroke()))
await pickStyle('none')
const edgedAfter = await readStroke()
const edgedEl = await elState('edged')
console.log('[选 none 后 · 面板] ', JSON.stringify(edgedAfter))
console.log('[选 none 后 · 元素] ', JSON.stringify(edgedEl))
console.log('[#canAdd 判定复算] canAdd =', canAddByRule(edgedEl))
const staleD = edgedAfter.rows !== 0 || edgedAfter.addDisabled === true
console.log(`==> D 复现? ${staleD}`)

// ══════════════════════════════════════════════════════════
// E. 对照组：RERENDER_ON 里的 position 改了会不会当场重绘
//    （证明「改属性后当场重绘」这条路本身是通的，只是没覆盖 border-style）
// ══════════════════════════════════════════════════════════
console.log('\n--- E. 对照：改 position（在 RERENDER_ON 里）会不会当场重绘 ---')
await select('plain')
const snapPanel = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return {
    positionValue: sr.querySelector('vr-select[data-prop="position"]')?.getAttribute('value') ?? null,
    fields: [...sr.querySelectorAll('[data-prop]')].map(n => n.getAttribute('data-prop')).join('|'),
  }
})
const beforePos = await snapPanel()
console.log('[改前] position =', beforePos.positionValue, ' 字段数 =', beforePos.fields.split('|').length)
const psel = P('vr-select[data-prop="position"]').first()
if (await psel.count()) {
  await psel.scrollIntoViewIfNeeded(); await psel.click(); await page.waitForTimeout(360)
  await page.locator('#visual-revise-select-panel [data-item="static"]').click()
  await page.waitForTimeout(520)
  const afterPos = await snapPanel()
  console.log('[改后] position =', afterPos.positionValue, ' 字段数 =', afterPos.fields.split('|').length)
  console.log('==> position 改完面板结构当场就变了?', beforePos.fields !== afterPos.fields,
    '（RERENDER_ON 覆盖到的属性走的是同一个 #commit，会 render）')
} else {
  console.log('[跳过] 面板上没找到 position 下拉')
}

console.log('\n================ 结论 ================')
console.log('A（#plain 加完再选 none）分区停在旧结构:', staleA)
console.log('B  此刻加号点不动（用户被卡住）      :', addDead)
console.log('C  换选中重绘后是正确空状态          :', rightAfterRedraw)
console.log('D（#edged 直接选 none）同样停在旧结构:', staleD)
console.log('=====================================\n')

await browser.close(); await close()
