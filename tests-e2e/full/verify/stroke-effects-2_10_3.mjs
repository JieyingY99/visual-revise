// 独立复现脚本 · 清单 2.10.3（效果参数弹层）
//
// 报告称：噪点 / 纹理 / 玻璃高光的参数不从 CSS 回读，在同一个弹层里改第二个字段时，
// 先改的那个会被静默重置回默认值（弹层输入框里却还留着用户敲的数）。
// 期望（feature-inventory §2.10.3「数字框 change 时 parseFloat 校验后写入；改值不重绘」）：
// 同一条效果的多个参数可以叠加调整，先改的那个仍然生效。
//
// 全程真实交互（locator.click / fill+Enter / page.keyboard），不用 element.click() / dispatchEvent。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const P = sel => page.locator(`visual-revise-panel ${sel}`)
const S = (group, sel) => P(`section[data-group="${group}"] ${sel}`)

const inline = (id, prop) =>
  page.evaluate(([i, p]) => document.getElementById(i).style.getPropertyValue(p), [id, prop])

const select = async id => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(140)
  await page.keyboard.press('Escape'); await page.waitForTimeout(140)
  await page.locator(`#${id}`).click({ position: { x: 12, y: 12 } })
  await page.waitForTimeout(480)
}

const addFx = async type => {
  const add = S('effects', '.add[data-add="effects"]')
  await add.scrollIntoViewIfNeeded()
  await add.click(); await page.waitForTimeout(340)
  await page.locator(`#visual-revise-menu [data-item="${type}"]`).click()
  await page.waitForTimeout(440)
}

const openFx = async i => {
  const row = S('effects', `[data-effect-open="${i}"]`)
  await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(140)
  await row.click(); await page.waitForTimeout(400)
}

const closePopover = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(240) }

// 真实键入：点进框 → 全选 → 敲新值 → 回车（走 change 事件那条路）
const setFx = async (key, value) => {
  const i = page.locator(`#visual-revise-menu input[data-fx="${key}"]`)
  await i.click()
  await i.fill(String(value))
  await i.press('Enter')
  await page.waitForTimeout(420)
}

// 弹层里各个框此刻显示什么（弹层不重绘，所以这是用户看到的数）
const fxShown = () => page.evaluate(() => {
  const h = document.getElementById('visual-revise-menu')
  if (!h) return null
  return Object.fromEntries([...h.shadowRoot.querySelectorAll('input[data-fx]')]
    .map(n => [n.dataset.fx, n.value]))
})

// 面板认为的效果列表（parseEffects 的输出，经 #effectList 暴露成行摘要）
const fxRows = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return [...sr.querySelectorAll('section[data-group="effects"] .effect-row')]
    .map(r => `${r.querySelector('.effect-name')?.textContent}=${r.querySelector('.effect-sum')?.textContent}`)
})

const grab = (css, re) => (re.exec(css || '') || [])[1] ?? null

await page.goto(`${origin}/full/fixtures/stroke-effects-main.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

console.log('\n=== 2.10.3 效果参数弹层：多字段叠加调整 · 独立复现 ===\n')

let verdicts = []
const V = (name, broken, detail) => {
  verdicts.push({ name, broken })
  console.log(`==> ${name}：先改的那个被冲掉? ${broken}（期望 false）  ${detail}`)
}

// ══════════════════════════════════════════════════════════
// A. 噪点 #fx4：颗粒 2 → 再改密度 50
// ══════════════════════════════════════════════════════════
console.log('--- A. 噪点（#fx4）颗粒 → 密度 ---')
await select('fx4')
await addFx('noise')
const n0 = await inline('fx4', 'background-image')
console.log('[默认] baseFrequency =', grab(n0, /baseFrequency='([^']+)'/),
  ' opacity =', grab(n0, /opacity='([^']+)'/), ' 行摘要 =', JSON.stringify(await fxRows()))

await openFx(0)
await setFx('size', 2)
const n1 = await inline('fx4', 'background-image')
console.log('[改颗粒=2] baseFrequency =', grab(n1, /baseFrequency='([^']+)'/),
  '（1.2/2=0.60 为正确）  opacity =', grab(n1, /opacity='([^']+)'/))

await setFx('density', 50)
const n2 = await inline('fx4', 'background-image')
const nFreq2 = grab(n2, /baseFrequency='([^']+)'/)
const nOpa2 = grab(n2, /opacity='([^']+)'/)
console.log('[再改密度=50] baseFrequency =', nFreq2, ' opacity =', nOpa2)
console.log('[弹层里此刻显示] =', JSON.stringify(await fxShown()))
console.log('[行摘要] =', JSON.stringify(await fxRows()))
V('噪点 颗粒', nFreq2 !== '0.60', `baseFrequency 期望仍为 0.60，实得 ${nFreq2}（2.40 = 颗粒 0.5 的默认值）`)

// 反过来再验一次：先改密度、再改颗粒，看密度会不会被冲掉
await setFx('size', 3)
const n3 = await inline('fx4', 'background-image')
console.log('[再改颗粒=3] baseFrequency =', grab(n3, /baseFrequency='([^']+)'/),
  '（1.2/3=0.40）  opacity =', grab(n3, /opacity='([^']+)'/), '  ← 刚才的密度 0.50 还在吗')
V('噪点 密度', grab(n3, /opacity='([^']+)'/) !== '0.50',
  `opacity 期望仍为 0.50，实得 ${grab(n3, /opacity='([^']+)'/)}（1.00 = 密度 100 的默认值）`)
await closePopover()

// ══════════════════════════════════════════════════════════
// B. 纹理 #fx5：尺寸 8 → 再改强度 5
// ══════════════════════════════════════════════════════════
console.log('\n--- B. 纹理（#fx5）尺寸 → 强度 ---')
await select('fx5')
await addFx('texture')
const t0 = await inline('fx5', 'background-image')
console.log('[默认] baseFrequency =', grab(t0, /baseFrequency='([^']+)'/),
  ' opacity =', grab(t0, /opacity='([^']+)'/))

await openFx(0)
await setFx('size', 8)
const t1 = await inline('fx5', 'background-image')
console.log('[改尺寸=8] baseFrequency =', grab(t1, /baseFrequency='([^']+)'/), '（1/8=0.13 为正确）')

await setFx('radius', 5)
const t2 = await inline('fx5', 'background-image')
const tFreq2 = grab(t2, /baseFrequency='([^']+)'/)
console.log('[再改强度=5] baseFrequency =', tFreq2, ' opacity =', grab(t2, /opacity='([^']+)'/))
console.log('[弹层里此刻显示] =', JSON.stringify(await fxShown()))
V('纹理 尺寸', tFreq2 !== '0.13', `baseFrequency 期望仍为 0.13，实得 ${tFreq2}（0.25 = 尺寸 4 的默认值）`)
await closePopover()

// ══════════════════════════════════════════════════════════
// C. 玻璃 #fx6：高光 80 → 再改模糊 25；对照组：模糊 → 饱和
// ══════════════════════════════════════════════════════════
console.log('\n--- C. 玻璃（#fx6）高光 → 模糊 ---')
await select('fx6')
await addFx('glass')
console.log('[默认] backdrop-filter =', await inline('fx6', 'backdrop-filter'),
  ' box-shadow =', await inline('fx6', 'box-shadow'))

await openFx(0)
// 对照组：blur 与 saturate 都是能从 backdrop-filter 读回来的字段
await setFx('blur', 20)
await setFx('saturate', 250)
const gCtl = await inline('fx6', 'backdrop-filter')
console.log('[对照组 模糊=20 → 饱和=250] backdrop-filter =', gCtl)
V('玻璃 模糊（对照组）', !/blur\(20px\)/.test(gCtl), `期望仍含 blur(20px)，实得 ${gCtl}`)

await setFx('highlight', 80)
const g1 = await inline('fx6', 'box-shadow')
console.log('[改高光=80] box-shadow =', g1, '（rgba(…,0.8) 为正确）')

await setFx('blur', 25)
const g2 = await inline('fx6', 'box-shadow')
console.log('[再改模糊=25] box-shadow =', g2, ' backdrop-filter =', await inline('fx6', 'backdrop-filter'))
console.log('[弹层里此刻显示] =', JSON.stringify(await fxShown()))
V('玻璃 高光', !/rgba\(255,\s*255,\s*255,\s*0?\.8\)/.test(g2),
  `期望仍为 0.8，实得 ${g2}（0.4 = 高光 40 的默认值）`)
await closePopover()

// ══════════════════════════════════════════════════════════
// D. 对照：投影（能完整读回的一类）连改两个字段
// ══════════════════════════════════════════════════════════
console.log('\n--- D. 对照组：投影（#fx7）X → Y ---')
await select('fx7')
await addFx('drop-shadow')
await openFx(0)
await setFx('x', 9)
await setFx('y', 13)
const sh = await inline('fx7', 'box-shadow')
console.log('[投影 X=9 → Y=13] box-shadow =', sh)
V('投影 X（对照组）', !/9px 13px/.test(sh), `期望 9px 13px 同时在，实得 ${sh}`)
await closePopover()

// ══════════════════════════════════════════════════════════
console.log('\n=== 汇总 ===')
for (const v of verdicts) console.log(`  ${v.broken ? '✘ 被冲掉' : '✔ 保住了'}  ${v.name}`)
const brokenCount = verdicts.filter(v => v.broken).length
console.log(`\n复现结论：${brokenCount} / ${verdicts.length} 项出现「先改的被静默重置」`)

await browser.close()
await close()
