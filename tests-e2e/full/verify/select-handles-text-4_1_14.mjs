// 独立复现脚本 · 清单 4.1.14
//
// 报告称：⌥Delete / ⌥Backspace 在「编辑器注入之后才出现的元素」上抛
// TypeError（e.attr is not a function），inline style 一个字符都没清。
// 怀疑点 app/features/selectable.js:189-191
//   const on_clearstyles = e => selected.forEach(el => el.attr('style', null))
// 而 .attr 是 blingblingjs 的 $() 用 Object.assign($el, sugar) 挂到**元素实例**上的，
// 只有被 $() 摸过的元素才有。
//
// 本脚本不复用 tests-e2e/full/select-handles-text.mjs 的任何断言，全部重新测，
// 并且要**推翻**报告里的因果解释：
//   报告说「注入时页面上已有的元素被批量 $() 过所以碰巧能用」——
//   那就先量一量注入完成的那一刻，静态元素身上到底有没有 .attr。
// 全程真实指针 / 键盘（page.mouse / page.keyboard），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))
page.on('console', m => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text()) })

const log = (...a) => console.log(...a)

await page.goto(`${origin}/full/fixtures/select-handles-text-page.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(500)

log('\n=== 4.1.14 ⌥Delete / ⌥Backspace 清空 inline style · 独立复现 ===\n')

// ── 工具 ────────────────────────────────────────────────────
// 元素身上有没有 blingblingjs 挂的 sugar（.attr / .on / .off 是自有属性）
const sugarOf = id => page.evaluate(i => {
  const el = document.getElementById(i)
  if (!el) return { missing: true }
  return {
    attrType: typeof el.attr,
    ownAttr: Object.prototype.hasOwnProperty.call(el, 'attr'),
    ownOn: Object.prototype.hasOwnProperty.call(el, 'on'),
  }
}, id)

const inline = id => page.evaluate(i =>
  document.getElementById(i)?.getAttribute('style') ?? null, id)

const selectedIds = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')].map(e => e.id || e.tagName.toLowerCase()))

// 真实鼠标点元素中心（把手热区向外扩 12px，中心离它们最远）
const clickCenter = async id => {
  const b = await page.evaluate(i => {
    const r = document.getElementById(i).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, id)
  await page.mouse.move(b.x, b.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(350)
}

// 按一次热键，返回这期间新增的页面异常
const pressAndCatch = async combo => {
  const before = pageErrors.length
  await page.keyboard.press(combo)
  await page.waitForTimeout(450)
  return pageErrors.slice(before)
}

// ══════════════════════════════════════════════════════════
// 0. 注入刚结束：静态元素身上到底有没有 .attr？
//    （报告说「注入时页面上已有的元素被批量 $() 过」——先证伪或证实这一句）
// ══════════════════════════════════════════════════════════
log('--- 0. 注入完成、任何点击之前，静态元素的 sugar 状态 ---')
for (const id of ['solo', 'form', 'nest', 'texty']) {
  log(`  #${id.padEnd(6)}`, JSON.stringify(await sugarOf(id)))
}

// ══════════════════════════════════════════════════════════
// A. 注入之后才建的元素（SPA 路由 / 懒加载 / 弹窗都是这种）
// ══════════════════════════════════════════════════════════
log('\n--- A. 动态建的 #styled（注入之后才 append 进 body）---')
await page.evaluate(() => {
  const d = document.createElement('div')
  d.id = 'styled'
  d.setAttribute('style', 'position:absolute;left:640px;top:60px;width:200px;height:90px;background:rgb(60,60,80);opacity:0.9')
  document.body.appendChild(d)
})
await page.waitForTimeout(250)
log('  [选中前 sugar]', JSON.stringify(await sugarOf('styled')))
await clickCenter('styled')
log('  [选中集]', JSON.stringify(await selectedIds()))
log('  [按键前 sugar]', JSON.stringify(await sugarOf('styled')))
const beforeA = await inline('styled')
log('  [按键前 style]', JSON.stringify(beforeA))
const errA = await pressAndCatch('Alt+Backspace')
const afterA = await inline('styled')
log('  [⌥Backspace 期间的页面异常]', errA.length ? errA.join(' / ') : '无')
log('  [按键后 style]', JSON.stringify(afterA))
const A_threw = errA.some(m => /attr is not a function/.test(m))
const A_untouched = afterA === beforeA && !!beforeA
log(`  ==> A1 抛 "attr is not a function" = ${A_threw}`)
log(`  ==> A2 style 一个字符都没清 = ${A_untouched}`)

// 同一把钥匙的另一个键位：⌥Delete
log('\n--- A(bis). 同一个元素再按 ⌥Delete ---')
const errAd = await pressAndCatch('Alt+Delete')
const afterAd = await inline('styled')
log('  [⌥Delete 期间的页面异常]', errAd.length ? errAd.join(' / ') : '无')
log('  [按键后 style]', JSON.stringify(afterAd))
const Ad_threw = errAd.some(m => /attr is not a function/.test(m))
log(`  ==> A3 ⌥Delete 同样炸 = ${Ad_threw}，style 仍原样 = ${afterAd === beforeA}`)

// ══════════════════════════════════════════════════════════
// B. 注入时就在页面上、但**从未被选中过**的静态元素
//    报告说这种「碰巧能用」。如果它也炸，报告的因果解释就是错的。
// ══════════════════════════════════════════════════════════
log('\n--- B. 静态 #solo（页面 HTML 里就有，此前从未被选中）---')
await page.evaluate(() =>
  document.getElementById('solo').setAttribute('style', 'opacity: 0.9; outline: 1px solid red'))
log('  [选中前 sugar]', JSON.stringify(await sugarOf('solo')))
await clickCenter('solo')          // 这一下会 unselect_all → 给 #styled 挂上 sugar
log('  [选中集]', JSON.stringify(await selectedIds()))
log('  [按键前 sugar]', JSON.stringify(await sugarOf('solo')))
const beforeB = await inline('solo')
log('  [按键前 style]', JSON.stringify(beforeB))
const errB = await pressAndCatch('Alt+Backspace')
const afterB = await inline('solo')
log('  [⌥Backspace 期间的页面异常]', errB.length ? errB.join(' / ') : '无')
log('  [按键后 style]', JSON.stringify(afterB))
const B_threw = errB.some(m => /attr is not a function/.test(m))
const B_cleared = !afterB
log(`  ==> B1 静态元素也抛 = ${B_threw}`)
log(`  ==> B2 静态元素清干净了 = ${B_cleared}`)

// ══════════════════════════════════════════════════════════
// C. 对照组：已经被「选中过又取消过」一次的元素（unselect_all 里
//    $(el).attr({...}) 会把 sugar 永久挂到实例上）
// ══════════════════════════════════════════════════════════
log('\n--- C. 对照：#styled 现在被 unselect_all 摸过了，再来一次 ---')
log('  [现在 sugar]', JSON.stringify(await sugarOf('styled')))
await page.evaluate(() =>
  document.getElementById('styled').setAttribute('style',
    'position:absolute;left:640px;top:60px;width:200px;height:90px;background:rgb(60,60,80);opacity:0.9'))
await clickCenter('styled')
log('  [选中集]', JSON.stringify(await selectedIds()))
const beforeC = await inline('styled')
const errC = await pressAndCatch('Alt+Backspace')
const afterC = await inline('styled')
log('  [⌥Backspace 期间的页面异常]', errC.length ? errC.join(' / ') : '无')
log('  [按键前 style]', JSON.stringify(beforeC))
log('  [按键后 style]', JSON.stringify(afterC))
const C_cleared = !afterC
log(`  ==> C 摸过 sugar 之后同一个动态元素能清干净 = ${C_cleared}`)

// ══════════════════════════════════════════════════════════
// D. 第二个从未被选中过的静态元素，确认 B 不是偶然
// ══════════════════════════════════════════════════════════
log('\n--- D. 静态 #nest（同样从未被选中过）---')
await page.evaluate(() =>
  document.getElementById('nest').setAttribute('style', 'opacity: 0.8'))
log('  [选中前 sugar]', JSON.stringify(await sugarOf('nest')))
await clickCenter('nest')
log('  [选中集]', JSON.stringify(await selectedIds()))
const beforeD = await inline('nest')
const errD = await pressAndCatch('Alt+Backspace')
const afterD = await inline('nest')
log('  [⌥Backspace 期间的页面异常]', errD.length ? errD.join(' / ') : '无')
log('  [按键前 style]', JSON.stringify(beforeD), ' [按键后 style]', JSON.stringify(afterD))
const D_threw = errD.some(m => /attr is not a function/.test(m))
log(`  ==> D 静态 #nest 抛 = ${D_threw}，清干净 = ${!afterD}`)

log('\n================ 结论 ================')
log('A  动态元素 ⌥Backspace 抛 TypeError      :', A_threw)
log('A  动态元素 style 原封不动               :', A_untouched)
log('A3 动态元素 ⌥Delete 同样抛              :', Ad_threw)
log('B  从未选中过的静态元素 抛 / 清掉        :', B_threw, '/', B_cleared)
log('C  被 $() 摸过之后同一动态元素清掉       :', C_cleared)
log('D  另一个从未选中过的静态元素 抛 / 清掉   :', D_threw, '/', !afterD)
log('=====================================\n')

await browser.close(); await close()
