// 独立复现脚本 · 清单 1.2.5
// 报告称：从评论模式点工具条「选择元素」按钮回到 select 模式，属性面板停在「结构」tab，
// 不会像按 A 那样回到「选择元素」(props) tab。
// 清单 1.2.5 原文：「点『选择元素』或按 A → setMode('select') 且面板切到 props tab；
//                    按 F → 同样进 select 但切到 structure tab」
// 全程真实交互（locator.click / page.keyboard），不用 element.click() / dispatchEvent。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const card = () => page.locator('.curve-card').first()

const tab = () => page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  if (!p) return '(无面板)'
  const on = p.shadowRoot.querySelector('.tab[data-on]')
  return on ? on.dataset.tab : '(无 data-on 的 tab)'
})

// 面板上那个 tab 按钮的可见文字 —— 用来说明它跟工具条按钮同名
const tabLabel = () => page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  const on = p?.shadowRoot?.querySelector('.tab[data-on]')
  return on ? on.textContent.trim() : '(无)'
})

const panelState = () => page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  return { hidden: !!p?.hidden, target: p?.target?.className || null }
})

const toolbarMode = () => page.evaluate(() => {
  const t = document.querySelector('visual-revise-toolbar')
  const on = t?.shadowRoot?.querySelector('button[data-mode][data-on]')
  return on ? on.dataset.mode : '(无)'
})

// 工具条按钮的 tooltip 文案（清单说它印着「选择元素  A / F」）
const selectBtnTip = () => page.evaluate(() => {
  const t = document.querySelector('visual-revise-toolbar')
  const btn = t?.shadowRoot?.querySelector('button[data-mode="select"]')
  const tip = t?.shadowRoot?.querySelector('.tip, [data-tip-label]')
  return { dataTip: btn?.dataset.tip || null, tipText: tip?.textContent?.trim() || null }
})

const blur = () => page.evaluate(() => document.activeElement?.blur?.())

const clickMode = async mode => {
  await page.locator(`visual-revise-toolbar button[data-mode="${mode}"]`).click()
  await page.waitForTimeout(350)
}

const selectCard = async () => {
  await card().click({ position: { x: 200, y: 6 } })
  await page.waitForTimeout(400)
}

await page.goto(`${origin}/fixture.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

console.log('\n=== 1.2.5 工具条「选择元素」按钮是否把面板带回 props tab · 独立复现 ===\n')
console.log('[工具条 select 按钮 tooltip 数据]', JSON.stringify(await selectBtnTip()))

// ══════════════════════════════════════════════════════════
// 场景 A：报告的复现步骤（评论模式 → 点「选择元素」按钮 → 重新选中）
// ══════════════════════════════════════════════════════════
console.log('\n--- A. 报告步骤：F 切到结构 → 点「评论」→ 点「选择元素」→ 重新选中 ---')

await selectCard()
console.log('[1] 选中一个 .curve-card  →  面板', JSON.stringify(await panelState()),
  ' tab =', await tab(), `(${await tabLabel()})`)

await blur()
await page.keyboard.press('f')
await page.waitForTimeout(350)
console.log('[2] 按 F                 →  tab =', await tab(), `(${await tabLabel()})`,
  ' 工具条高亮 =', await toolbarMode())

await clickMode('comment')
console.log('[3] 点工具条「评论」     →  工具条高亮 =', await toolbarMode(),
  ' 面板 =', JSON.stringify(await panelState()), ' tab =', await tab())

await clickMode('select')
console.log('[4] 点工具条「选择元素」 →  工具条高亮 =', await toolbarMode(),
  ' 面板 =', JSON.stringify(await panelState()), ' tab =', await tab())

await selectCard()
const tabAfterButton = await tab()
console.log('[5] 重新选中 .curve-card →  tab =', tabAfterButton, `(${await tabLabel()})`,
  ' 面板 =', JSON.stringify(await panelState()))
console.log(`==> 点按钮回 select 后 tab = '${tabAfterButton}'（清单 1.2.5 期望 'props'）`)

// ══════════════════════════════════════════════════════════
// 场景 B：同样的路径，最后一步改成按 A（对照组）
// ══════════════════════════════════════════════════════════
console.log('\n--- B. 对照：同样路径，最后用键盘 A 回来 ---')

await blur()
await page.keyboard.press('f')
await page.waitForTimeout(350)
console.log('[1] 按 F 回到结构 tab    →  tab =', await tab())

await clickMode('comment')
console.log('[2] 点工具条「评论」     →  工具条高亮 =', await toolbarMode(), ' tab =', await tab())

await blur()
await page.keyboard.press('a')
await page.waitForTimeout(350)
console.log('[3] 按 A                 →  工具条高亮 =', await toolbarMode(),
  ' 面板 =', JSON.stringify(await panelState()), ' tab =', await tab())

await selectCard()
const tabAfterKeyA = await tab()
console.log('[4] 重新选中 .curve-card →  tab =', tabAfterKeyA, `(${await tabLabel()})`)
console.log(`==> 按 A 回 select 后 tab = '${tabAfterKeyA}'（清单 1.2.5 期望 'props'）`)

// ══════════════════════════════════════════════════════════
// 场景 C：不离开 select 模式，直接点「选择元素」按钮（幂等点击）
//         —— 用户在结构 tab 上想「回属性」时最自然的一下
// ══════════════════════════════════════════════════════════
console.log('\n--- C. 停在 select 模式，直接点「选择元素」按钮 ---')

await blur()
await page.keyboard.press('f')
await page.waitForTimeout(350)
console.log('[1] 按 F                 →  tab =', await tab())

await clickMode('select')
const tabIdempotent = await tab()
console.log('[2] 点「选择元素」按钮   →  工具条高亮 =', await toolbarMode(), ' tab =', tabIdempotent)
console.log(`==> 同模式下点按钮 tab = '${tabIdempotent}'`)

// ══════════════════════════════════════════════════════════
// 场景 D：走浏览模式（V）绕一圈再点按钮 —— 换一条离开 select 的路
// ══════════════════════════════════════════════════════════
console.log('\n--- D. 换一条路：select(结构) → 浏览 → 点「选择元素」 ---')

await selectCard()
await blur()
await page.keyboard.press('f')
await page.waitForTimeout(350)
console.log('[1] 选中 + 按 F          →  tab =', await tab())

await clickMode('browse')
console.log('[2] 点「浏览页面」       →  工具条高亮 =', await toolbarMode())

await clickMode('select')
await selectCard()
const tabViaBrowse = await tab()
console.log('[3] 点「选择元素」+ 重新选中 →  tab =', tabViaBrowse, `(${await tabLabel()})`)
console.log(`==> 经浏览模式绕回后 tab = '${tabViaBrowse}'`)

// ══════════════════════════════════════════════════════════
// 场景 E：panel.target 还在时，按钮 vs 键盘 A 的正面对照
//         （清单 1.2.6：target 为空时「只切模式不切 tab」，所以要先保证有选中）
// ══════════════════════════════════════════════════════════
console.log('\n--- E. 有选中元素时，按钮 vs A 正面对照 ---')

await selectCard()
await blur()
await page.keyboard.press('f')
await page.waitForTimeout(350)
console.log('[E1] 选中 + 按 F         →  tab =', await tab(),
  ' panel.target =', (await panelState()).target)

await clickMode('select')
const eBtn = await tab()
console.log('[E2] 点「选择元素」按钮  →  tab =', eBtn,
  ' panel.target =', (await panelState()).target)

await blur()
await page.keyboard.press('f')
await page.waitForTimeout(350)
console.log('[E3] 按 F 回到结构       →  tab =', await tab())

await blur()
await page.keyboard.press('a')
await page.waitForTimeout(350)
const eKey = await tab()
console.log('[E4] 按 A                →  tab =', eKey,
  ' panel.target =', (await panelState()).target)
console.log(`==> 有选中时：按钮 = '${eBtn}'，A = '${eKey}'，一致? ${eBtn === eKey}`)

// 报告步骤里点按钮 / 按 A 的那一刻，panel.target 到底是不是空的？
console.log('\n--- 报告步骤第 4/5 步时 panel.target 的状态复核 ---')
await clickMode('comment')
const targetInComment = await panelState()
console.log('[复核] 进评论模式后 panel =', JSON.stringify(targetInComment),
  '  ← 清单 1.2.6：target 为空时 A/F 只切模式、不切 tab')

console.log('\n================ 结论 ================')
console.log(`A 报告步骤（点按钮回来）   tab = '${tabAfterButton}'  期望 'props'  → ${tabAfterButton === 'props' ? '符合' : '不符合'}`)
console.log(`B 对照（按 A 回来）        tab = '${tabAfterKeyA}'  期望 'props'  → ${tabAfterKeyA === 'props' ? '符合' : '不符合'}`)
console.log(`C 同模式点按钮             tab = '${tabIdempotent}'`)
console.log(`D 经浏览模式绕回           tab = '${tabViaBrowse}'`)
console.log(`E 有选中时  按钮 = '${eBtn}'  /  A = '${eKey}'`)
console.log(`报告步骤里按钮与 A 落点是否一致：${tabAfterButton === tabAfterKeyA}`)
console.log('=====================================\n')

await browser.close(); await close()
