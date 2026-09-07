// PRD 验收：弹层交互。面板里四类弹层——vr-select 下拉、openMenu 菜单、色盘、
// 填充弹层——各自挂在 body 上、各自管关闭。这批检查的是「滚动不关、滚到底
// 能选、Esc 关、点外关、键盘能走」。上次修变量菜单的滚动关闭时漏了 vr-select
// 同样的一行，字体列表几百项滚一下就关，只能选到最上面几个。
import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve(); const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true }); await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))
await page.goto(origin)
await page.addStyleTag({ content: ':root{' + Array.from({ length: 40 }, (_, i) => `--c${i}:#${((i * 37) % 4096).toString(16).padStart(3, '0')};`).join('') + '}' })
await injectVisBug(page, origin)
await page.locator('.card-title').first().click({ position: { x: 4, y: 4 } }); await page.waitForTimeout(500)
const P = 'visual-revise-panel'
let passed = 0, failed = 0
const AC = (id, c, m) => { c ? passed++ : failed++; ok(c, `${id}  ${m}`) }
const exists = id => page.evaluate(x => !!document.getElementById(x), id)
const inView = id => page.evaluate(x => { const r = document.getElementById(x)?.getBoundingClientRect(); return r ? r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth : null }, id)
const wheelIn = async (id, dy) => { const b = await page.locator('#' + id).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120)); await page.mouse.wheel(0, dy); await page.waitForTimeout(300) }
const scrollTop = id => page.evaluate(x => document.getElementById(x)?.scrollTop ?? -1, id)
// 打开 Typography 并给字体下拉塞 60 个选项，模拟加载本地字体后的长列表
if (await page.evaluate(() => document.querySelector('visual-revise-panel').shadowRoot.querySelector('section[data-group="typography"]').hasAttribute('folded')))
  { await page.locator(`${P} section[data-group="typography"] h3 .title`).click(); await page.waitForTimeout(300) }
await page.evaluate(() => {
  const sel = document.querySelector('visual-revise-panel').shadowRoot.querySelector('vr-select[data-prop="font-family"]')
  sel.setAttribute('options', JSON.stringify(['system-ui', ...Array.from({ length: 60 }, (_, i) => `Font ${String(i).padStart(2, '0')}`)]))
})

console.log('\n[PRD 验收] 批次 6：弹层交互\n')

// ── ① vr-select 字体下拉（长列表） ──
console.log('── vr-select 长下拉')
const SEL = 'visual-revise-select-panel'
await page.locator(`${P} vr-select[data-prop="font-family"]`).click(); await page.waitForTimeout(350)
AC('AC-6.25a', await exists(SEL), '点触发器打开下拉')
AC('AC-6.25b', await inView(SEL), '下拉在视口内')
const canScroll = await page.evaluate(x => { const p = document.getElementById(x); return p.scrollHeight > p.clientHeight }, SEL)
AC('AC-6.25c', canScroll, '61 项的列表可滚动（有 max-height）')
await wheelIn(SEL, 400)
AC('AC-6.25d', await exists(SEL) && (await scrollTop(SEL)) > 0, `在下拉里滚动不关闭、内容滚了（scrollTop=${await scrollTop(SEL)}）`)
await wheelIn(SEL, 4000)
const lastItem = page.locator(`#${SEL} > div`).filter({ hasText: 'Font 59' }).first()
AC('AC-6.25e', await lastItem.isVisible(), '滚到底后最后一项可见')
await lastItem.click(); await page.waitForTimeout(350)
AC('AC-6.25f', !(await exists(SEL)), '点选项后下拉关闭')
AC('AC-6.25g', (await page.locator(`${P} vr-select[data-prop="font-family"]`).getAttribute('value') || '').includes('Font 59'), `选中写回触发器（${await page.locator(`${P} vr-select[data-prop="font-family"]`).getAttribute('value')}）`)
await page.locator(`${P} vr-select[data-prop="font-family"]`).click(); await page.waitForTimeout(300)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
AC('AC-6.25h', !(await exists(SEL)), 'Esc 关闭下拉')
await page.locator(`${P} vr-select[data-prop="font-family"]`).click(); await page.waitForTimeout(300)
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150)
// 高亮是浅底（rgb(255 255 255 / .09)），当前值是蓝底；找那个浅底的
const hl = await page.evaluate(x => [...document.getElementById(x).shadowRoot.children].find(c => c.style.background.includes('0.09') || c.style.background.includes('/ 0.09'))?.textContent.trim() ?? null, SEL)
AC('AC-6.25i', hl !== null, `上下键能在下拉里移动高亮（高亮：${hl ?? '没有'}）`)
await page.keyboard.press('Enter'); await page.waitForTimeout(350)
const picked = await page.locator(`${P} vr-select[data-prop="font-family"]`).getAttribute('value')
AC('AC-6.25i2', !(await exists(SEL)) && picked === hl, `Enter 选中高亮项并关闭（${picked}）`)
await page.locator(`${P} vr-select[data-prop="font-family"]`).click(); await page.waitForTimeout(300)
await page.locator(`${P} header .tag`).click({ force: true }); await page.waitForTimeout(300)
AC('AC-6.25j', !(await exists(SEL)), '点弹层外（面板标题）关闭下拉')

// ── ② openMenu 菜单（Effects 添加菜单） ──
// 变量列表已经搬进颜色弹层的「变量」页，openMenu 现在的消费者是效果添加菜单
// 和尺寸模式菜单。通用的打开 / 滚动 / 选中 / Esc 改挂在效果菜单上验，
// 否则 openMenu 这一套就彻底没有覆盖了。
console.log('── openMenu 菜单（Effects 添加）')
const MENU = 'visual-revise-menu'
const addFx = `${P} section[data-group="effects"] .add[data-add="effects"]`
await page.locator(addFx).click({ force: true }); await page.waitForTimeout(350)
AC('AC-6.26a', await exists(MENU), '打开')
AC('AC-6.26b', await inView(MENU), '在视口内')
await wheelIn(MENU, 300)
AC('AC-6.26c', await exists(MENU), '在菜单上滚动不关闭（菜单自己是滚动容器，overscroll 不外传）')
const lastFx = page.locator(`#${MENU} [data-item]`).last()
AC('AC-6.26d', await lastFx.isVisible(), '最后一项可见（七种效果一屏放得下，不需要滚）')
await lastFx.click(); await page.waitForTimeout(400)
const glass = await page.evaluate(() => document.querySelector('.card-title').style.backdropFilter)
AC('AC-6.26e', !(await exists(MENU)) && /blur/.test(glass), `选中最后一项生效并关闭（backdrop-filter=${glass}）`)
await page.locator(addFx).click({ force: true }); await page.waitForTimeout(300)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
AC('AC-6.26f', !(await exists(MENU)), 'Esc 关闭')

// ── ③ 色盘 ──
console.log('── 色盘')
const COLOR = 'visual-revise-color-panel'
await page.locator(`${P} section[data-group="fill"] vr-color .swatch`).first().click(); await page.waitForTimeout(400)
AC('AC-6.27a', await exists(COLOR), '打开色盘')
AC('AC-6.27b', await inView(COLOR), '在视口内')
await wheelIn(COLOR, 200)
AC('AC-6.27c', await exists(COLOR), '在色盘上滚动不关闭')
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
AC('AC-6.27d', !(await exists(COLOR)), 'Esc 关闭色盘')
await page.locator(`${P} section[data-group="fill"] vr-color .swatch`).first().click(); await page.waitForTimeout(300)
await page.locator(`${P} header .tag`).click({ force: true }); await page.waitForTimeout(300)
AC('AC-6.27e', !(await exists(COLOR)), '点弹层外关闭色盘')

// ── ④ 填充弹层 ──
console.log('── 填充弹层')
const FILL = 'visual-revise-fill-panel'
await page.keyboard.press('Escape'); await page.waitForTimeout(150)
await page.locator('.curve-card').first().click({ position: { x: 4, y: 4 } }); await page.waitForTimeout(450)
await page.locator(`${P} section[data-group="fill"] vr-fill .swatch`).first().click(); await page.waitForTimeout(400)
AC('AC-6.28a', await exists(FILL), '打开填充弹层')
await page.locator(`#${FILL} [data-tab="gradient"]`).click(); await page.waitForTimeout(400)
AC('AC-6.28b', await inView(FILL), '切到渐变后仍在视口内')
const fillScroll = await page.evaluate(x => { const p = document.getElementById(x); return { can: p.scrollHeight > p.clientHeight, h: p.clientHeight } }, FILL)
await wheelIn(FILL, 200)
AC('AC-6.28c', await exists(FILL), `在弹层上滚动不关闭（可滚=${fillScroll.can}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
AC('AC-6.28d', !(await exists(FILL)), 'Esc 关闭')
await page.locator(`${P} section[data-group="fill"] vr-fill .swatch`).first().click(); await page.waitForTimeout(300)
await page.locator(`${P} header .tag`).click({ force: true }); await page.waitForTimeout(300)
AC('AC-6.28e', !(await exists(FILL)), '点弹层外关闭')
// ── AC-6.30 页面 CSS 漏不进弹层 ──
// 弹层挂在页面的 body 上，以前内容直接暴露给页面样式：弹层里的 tab 条叫 .tabs，
// 页面恰好也有 .tabs { border-bottom }，那条线就漏进来了。现在内容包在
// shadow root 里、宿主行内 all:initial，页面的类名 / 元素 / 通配规则都碰不到。
console.log('── AC-6.30 页面 CSS 隔离')
await page.addStyleTag({ content: '.tabs{border-bottom:3px solid red!important;padding-bottom:20px}'
  + 'button{box-shadow:0 0 0 3px lime;letter-spacing:5px}'
  + 'div{border-top:2px solid blue}'
  + '*{box-sizing:content-box}'
  + 'body{text-transform:uppercase;letter-spacing:4px}' })
await page.waitForTimeout(100)
{
  // 上一条用点标题栏关掉了弹层，选中还在，直接再开
  await page.locator(`${P} section[data-group="fill"] vr-fill .swatch`).first().click(); await page.waitForTimeout(400)
  const leak = await page.evaluate(x => {
    const host = document.getElementById(x)
    if (!host) return null
    const tabs = host.shadowRoot.querySelector('.tabs')
    const btn = tabs.querySelector('button')
    const cs = el => getComputedStyle(el)
    return {
      tabsBorder: cs(tabs).borderBottomWidth, tabsPad: cs(tabs).paddingBottom,
      btnShadow: cs(btn).boxShadow, btnSpacing: cs(btn).letterSpacing,
      hostBorder: cs(host).borderTopWidth, hostTransform: cs(host).textTransform,
      btnTransform: cs(btn).textTransform, btnBox: cs(btn).boxSizing,
    }
  }, FILL)
  AC('AC-6.30', !!leak && leak.tabsBorder === '0px' && leak.tabsPad === '2px' && leak.btnShadow === 'none'
    && leak.btnSpacing === 'normal' && leak.hostBorder === '0px' && leak.hostTransform === 'none'
    && leak.btnTransform === 'none' && leak.btnBox === 'border-box',
    `页面的 .tabs / button / div / * / body 规则都漏不进填充弹层（${JSON.stringify(leak)}）`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
}

await browser.close(); await close()

console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
