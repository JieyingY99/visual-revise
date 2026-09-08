// ↑ / ↓ 在父级里换位：选中一个元素，方向键把它跟兄弟换位置，不跨容器，进改动记录、⌘Z 退回。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

console.log('\n[方向键换位] ↑ / ↓ 在父级里挪一位\n')
await page.goto(origin); await injectVisBug(page, origin); await page.waitForTimeout(400)

// 给第二张卡打个记号，之后按它在兄弟里的下标判断位置
await page.evaluate(() => document.querySelectorAll('.curve-card')[1].setAttribute('data-t', 'mid'))
const indexOf = () => page.evaluate(() => [...document.querySelectorAll('.curve-card')].findIndex(c => c.dataset.t === 'mid'))
const moves = () => page.evaluate(() => window.__visualRevise.store.read().moves.length)
const total = () => page.evaluate(() => window.__visualRevise.store.stats().total)
const P = sel => page.locator(`visual-revise-panel ${sel}`)

await page.locator('[data-t="mid"]').click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(450)
ok(await indexOf() === 1, '起点：选中三张卡里中间那张（下标 1）')

// ↑：到第一位
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(350)
ok(await indexOf() === 0 && await moves() === 1, `↑ 挪到第一位（下标 ${await indexOf()}，移动记录 ${await moves()} 条）`)
// 选中框跟着元素走
const box = await page.evaluate(() => {
  const el = document.querySelector('[data-t="mid"]').getBoundingClientRect()
  const h = document.querySelector('visbug-handles')?.getBoundingClientRect()
  return h ? { dl: Math.abs(h.left - el.left), dt: Math.abs(h.top - el.top), sel: !!document.querySelector('[data-t="mid"][data-selected]') } : null
})
ok(box && box.sel && box.dl < 2 && box.dt < 2, `挪完选中不变、选中框跟到新位置（偏差 ${box?.dl?.toFixed(1)} / ${box?.dt?.toFixed(1)}）`)
// 已经在第一位再按 ↑：不动、不记
const m1 = await moves(), t1 = await total()
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300)
ok(await indexOf() === 0 && await moves() === m1 && await total() === t1, '已在第一位时 ↑ 不动，也不产生记录')

// ↓ 两下到最后
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
ok(await indexOf() === 2, `↓ 两下到最后一位（下标 ${await indexOf()}）`)
const m2 = await moves()
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
ok(await indexOf() === 2 && await moves() === m2, '已在最后一位时 ↓ 不动（不跨出容器）')
// 同一个元素来回挪只留一条移动记录（from 取第一次、to 取最后一次）
ok(await moves() === 1, `同一个元素反复挪只有一条移动记录（${await moves()}）`)

// ⌘Z 退回上一步
await page.keyboard.press('Meta+z'); await page.waitForTimeout(350)
ok(await indexOf() === 1, `⌘Z 退回上一步（下标 ${await indexOf()}）`)

// 结构树高亮跟着走
await page.locator('visual-revise-panel .tab[data-tab="structure"]').click(); await page.waitForTimeout(400)
const treeSel = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot.querySelector('visual-revise-tree').shadowRoot
  const rows = [...sr.querySelectorAll('.row')]
  const i = rows.findIndex(r => r.hasAttribute('data-selected'))
  return { i, prevName: rows[i - 1]?.querySelector('.name')?.textContent || '' }
})
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(350)
const treeSel2 = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot.querySelector('visual-revise-tree').shadowRoot
  const rows = [...sr.querySelectorAll('.row')]
  return rows.findIndex(r => r.hasAttribute('data-selected'))
})
ok(await indexOf() === 0 && treeSel2 === treeSel.i - 1, `结构 tab 下同样生效，树里高亮行跟着上移一行（${treeSel.i} → ${treeSel2}）`)
await page.locator('visual-revise-panel .tab[data-tab="props"]').click(); await page.waitForTimeout(300)

// 焦点在面板输入框里：方向键归输入框，元素不动
const opIn = P('input[data-prop="opacity"]').first()
await opIn.scrollIntoViewIfNeeded(); await opIn.click(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
const opacity = await page.evaluate(() => document.querySelector('[data-t="mid"]').style.opacity)
ok(await indexOf() === 0 && opacity === '0.99', `焦点在输入框里时 ↓ 是步进（opacity=${opacity}），元素不动`)
await opIn.blur()

// 有弹层开着：方向键不接管。开弹层后把焦点从面板挪走（面板内的键本来就不接管），再按
const sw = P('section[data-group="stroke"] vr-color[data-prop="border-color"] .swatch').first()
await sw.scrollIntoViewIfNeeded(); await sw.click(); await page.waitForTimeout(400)
await page.evaluate(() => document.activeElement?.blur?.())
const popOpen = await page.evaluate(() => !!document.getElementById('visual-revise-color-panel'))
const before = await indexOf()
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
ok(popOpen && await indexOf() === before, `有弹层开着时 ↓ 不接管（弹层开=${popOpen}，下标 ${before} → ${await indexOf()}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(200)


// ─── E 组补测：4.1.20 导出 / 4.1.22 端点 / 4.1.23 label / 4.1.26 / 4.1.27 / 4.1.28 ───
// 每段前重新载入一次，拿干净的选中与记录状态（上面那段已经攒了一条移动记录）
const titles = () => page.evaluate(() => [...document.querySelectorAll('.curve-card .card-title')].map(e => e.textContent.trim()))
const nMoves = () => page.evaluate(() => window.__visualRevise.store.read().moves.length)
const bodyKids = () => page.evaluate(() => [...document.body.children]
  .map(e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')).join(','))
const reload = async () => { await page.goto(origin); await injectVisBug(page, origin); await page.waitForTimeout(400) }

console.log('\n[方向键换位 · 补测] 导出 / 端点 / 上游工具 / 多选 / 模式守卫\n')

// ── 4.1.20 + 4.1.22：一条记录，from 取第一次、to 取最后一次，导出里有这条移动 ──
await reload()
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300)
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
const o1 = await titles()
ok(o1.join('|') === 'Original Thinking|Thinking Nine|Thinking Five',
  `中间那张 ↑↓↓ 之后顺序期望「Original Thinking | Thinking Nine | Thinking Five」（实际「${o1.join(' | ')}」）`)
const mv = await page.evaluate(() => {
  const [m] = window.__visualRevise.store.read().moves
  if (!m) return { n: 0 }
  return {
    n: 1,
    // 第一次挪之前它的后邻是第三张卡；最后一次挪完它到了末尾
    fromNext: m.fromNext?.querySelector('.card-title')?.textContent.trim() ?? null,
    fromAtEnd: m.fromAtEnd, toAtEnd: m.toAtEnd, toNext: m.toNext,
    idx: [...document.querySelectorAll('.curve-card')].indexOf(m.el),
  }
})
ok(mv.n === 1 && mv.fromNext === 'Thinking Nine' && mv.fromAtEnd === false,
  `移动记录只有 1 条，起点取第一次：fromNext 期望「Thinking Nine」、fromAtEnd 期望 false（实际 ${mv.n} 条 / 「${mv.fromNext}」/ ${mv.fromAtEnd}）`)
ok(mv.toAtEnd === true && mv.toNext === null && mv.idx === 2,
  `终点取最后一次：toAtEnd 期望 true、toNext 期望 null、当前下标期望 2（实际 ${mv.toAtEnd} / ${mv.toNext} / ${mv.idx}）`)
const exp = await page.evaluate(() => {
  const j = window.__visualRevise.lib.exportJSON()
  const p = window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read())
  return { n: j.moves.length, fromAtEnd: j.moves[0]?.from?.atEnd, toAtEnd: j.moves[0]?.to?.atEnd,
    sel: j.moves[0]?.selector ?? '', hasSection: /##\s*移动的元素/.test(p) }
})
ok(exp.n === 1 && exp.fromAtEnd === false && exp.toAtEnd === true,
  `导出 JSON 里有这条移动：moves 期望 1 条 / from.atEnd 期望 false / to.atEnd 期望 true（实际 ${exp.n} / ${exp.fromAtEnd} / ${exp.toAtEnd}）`)
ok(exp.hasSection && /curve-card/.test(exp.sel),
  `提示词里有「## 移动的元素」段、选择器指向这张卡（段落=${exp.hasSection}，selector=${exp.sel}）`)
// 4.1.23：visbug-label 也跟到新位置。默认的 guides 工具上游不建 label（no_label），
// 换成会建 label 的 search 工具验这一半；label 的可见框在 closed shadow 里的 <span> 上
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('search')); await page.waitForTimeout(300)
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(500)
const labelBox = () => page.evaluate(() => {
  const el = document.querySelector('.curve-card[data-selected]')?.getBoundingClientRect()
  const host = document.querySelector('visbug-label')
  const span = (host?.$shadow || host?.shadowRoot)?.querySelector('span')?.getBoundingClientRect()
  return el && span ? { left: Math.round(span.left), dl: Math.round(span.left - el.left), el: Math.round(el.left) } : null
})
const lab0 = await labelBox()
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(500)
const lab1 = await labelBox()
ok(lab0 && lab1 && lab0.dl === 0 && lab1.dl === 0 && lab1.left !== lab0.left,
  `挪完 visbug-label 跟到新位置：标签左边缘期望始终对齐元素（偏差 ${lab0?.dl} → ${lab1?.dl}，标签 left ${lab0?.left} → ${lab1?.left}）`)
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('guides')); await page.waitForTimeout(200)

// ── 4.1.27：多选各自挪一位；相邻的两个都选中时按边界处理；编辑器节点不算兄弟 ──
await reload()
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(300)
await page.locator('.curve-card').nth(2).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(400)
const selN = await page.evaluate(() => document.querySelectorAll('.curve-card[data-selected]').length)
ok(selN === 2, `多选：两张卡同时选中（期望 2，实际 ${selN}）`)
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400)
const o2 = await titles(), n2 = await nMoves()
ok(o2.join('|') === 'Thinking Five|Thinking Nine|Original Thinking' && n2 === 2,
  `多选 ↑：两个各挪一位、相对顺序不变，期望「Thinking Five | Thinking Nine | Original Thinking」/ 2 条记录（实际「${o2.join(' | ')}」/ ${n2} 条）`)
// 现在这两个正好占住头两位、彼此相邻：再 ↑ 谁都不该动（不互相跳过换位）
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400)
const o3 = await titles(), n3 = await nMoves()
ok(o3.join('|') === o2.join('|') && n3 === 2,
  `相邻两个都选中且已在头部：再 ↑ 顺序不变、不新增记录（期望「${o2.join(' | ')}」/ 2 条，实际「${o3.join(' | ')}」/ ${n3} 条）`)
// 编辑器自己的节点不算兄弟：section.cards 的后邻全是面板 / 列表 / 工具条
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await page.evaluate(() => document.querySelector('vis-bug').selectorEngine.select(document.querySelector('section.cards')))
await page.waitForTimeout(400)
const k0 = await bodyKids(), mBefore = await nMoves()
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400)
const k1 = await bodyKids(), mAfter = await nMoves()
ok(k1.replace(',visbug-handles', '') === k0.replace(',visbug-handles', '') && mAfter === mBefore,
  `body 直属的 section.cards ↓：后邻只剩编辑器节点，期望不动也不记（body 顺序 ${k0} → ${k1}，记录 ${mBefore} → ${mAfter}）`)
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400)
const k2 = await bodyKids()
ok(/^vis-bug,section\.cards,main\.hero/.test(k2),
  `同一元素 ↑ 与真正的兄弟 main.hero 换位（期望 vis-bug,section.cards,main.hero…，实际 ${k2}）`)
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400)
const k3 = await bodyKids()
ok(k3 === k2, `再 ↑：前邻是 vis-bug（编辑器节点），期望不动（实际 ${k3}）`)

// ── 4.1.26：上游那些自己用方向键的工具激活时不接管 ──
await reload()
// 先选中再唤出上游工具条：工具条一显示就是全屏 popover，会挡住页面点击
await page.locator('.curve-card').first().click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const disp0 = await page.evaluate(() => document.querySelector('vis-bug').style.display)
await page.keyboard.press('Meta+Slash'); await page.waitForTimeout(300)
const disp1 = await page.evaluate(() => document.querySelector('vis-bug').style.display)
ok(disp0 === 'none' && disp1 === 'block', `⌘/ 唤出上游工具条（display 期望 none → block，实际 ${disp0} → ${disp1}）`)
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('position')); await page.waitForTimeout(300)
const tool = await page.evaluate(() => document.querySelector('vis-bug').activeTool)
const o4 = await titles(), n4 = await nMoves()
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400)
const posStyle = await page.evaluate(() => document.querySelectorAll('.curve-card')[0].style.top)
const o5 = await titles(), n5 = await nMoves()
ok(tool === 'position' && o5.join('|') === o4.join('|') && n5 === n4,
  `Position 工具激活（activeTool=${tool}）时 ↓ 不接管换位：顺序期望不变、移动记录期望 ${n4}（实际「${o5.join(' | ')}」/ ${n5} 条）`)
ok(posStyle === '1px', `↓ 落给了上游 Position 工具本身：行内 top 期望 1px（实际「${posStyle || '(无)'}」）`)
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('guides'))
await page.keyboard.press('Meta+Slash'); await page.waitForTimeout(300)
const disp2 = await page.evaluate(() => document.querySelector('vis-bug').style.display)
ok(disp2 === 'none', `再按 ⌘/ 收起上游工具条（display 期望 none，实际 ${disp2}）`)

// ── 4.1.28：带修饰键 / 浏览模式 / 评论模式 / 焦点在编辑器 UI 内都不接管 ──
await reload()
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const base = (await titles()).join('|')
for (const mod of ['Shift', 'Alt', 'Meta', 'Control']) {
  await page.keyboard.press(`${mod}+ArrowUp`); await page.waitForTimeout(250)
  const t = (await titles()).join('|'), m = await nMoves()
  ok(t === base && m === 0, `${mod}+↑ 不接管：顺序期望不变、移动记录期望 0（实际「${t}」/ ${m} 条）`)
}
// 评论模式
await page.keyboard.press('c'); await page.waitForTimeout(400)
const modeC = await page.evaluate(() => window.__visualRevise.mode)
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300)
const tC = (await titles()).join('|'), mC = await nMoves()
ok(modeC === 'comment' && tC === base && mC === 0,
  `评论模式（mode=${modeC}）↑ 不接管：顺序期望不变、移动记录期望 0（实际「${tC}」/ ${mC} 条）`)
// 上一步带着选中按 C，评论编辑框已经直接开在那张卡上、焦点也进了编辑框
//（「先选中、再评论」，见 comment.mjs）。下面要用 V 切浏览模式，键得落在页面上
// 才算数，所以先把这条空草稿收掉——留着的话 V 只会被打进编辑框里。
await page.evaluate(() => window.__visualRevise.comments.cancelDraft()); await page.waitForTimeout(200)
// 浏览模式（interactive）
await page.keyboard.press('v'); await page.waitForTimeout(400)
const st = await page.evaluate(() => ({ mode: window.__visualRevise.mode, interactive: window.__visualRevise.interactive }))
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300)
const tV = (await titles()).join('|'), mV = await nMoves()
ok(st.mode === 'browse' && st.interactive === true && tV === base && mV === 0,
  `浏览模式（mode=${st.mode}，interactive=${st.interactive}）↑ 不接管：顺序期望不变、移动记录期望 0（实际「${tV}」/ ${mV} 条）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(400)
// 焦点在编辑器 UI 内（工具条按钮，不是输入框）
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const focusTag = await page.evaluate(() => {
  document.querySelector('visual-revise-toolbar').shadowRoot.querySelector('button.list').focus()
  return document.activeElement?.tagName ?? ''
})
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300)
const tF = (await titles()).join('|'), mF = await nMoves()
ok(focusTag === 'VISUAL-REVISE-TOOLBAR' && tF === base && mF === 0,
  `焦点在编辑器 UI（${focusTag}）内 ↑ 不接管：顺序期望不变、移动记录期望 0（实际「${tF}」/ ${mF} 条）`)


// ─── E 组补测（二）：4.1.22 回到原位 / 撤销链；4.1.24 页面自己的输入框；
//                    4.1.25 下拉弹层；4.1.27 两个不同父级各挪各的 ───
{
console.log('\n[方向键换位 · 补测二] 原位对消 / 撤销链 / 页面输入框 / 下拉弹层 / 跨父级多选\n')
await reload()
const cards = () => page.evaluate(() => [...document.querySelectorAll('.curve-card .card-title')].map(e => e.textContent.trim()))
const btns = () => page.evaluate(() => [...document.querySelectorAll('.hero-bar button')].map(e => e.textContent.trim()))
const mv = () => page.evaluate(() => window.__visualRevise.store.read().moves.length)
const hist = () => page.evaluate(() => ({ canUndo: window.__visualRevise.store.canUndo, label: window.__visualRevise.store.history.undoLabel }))

await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
const c0 = (await cards()).join('|')
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300)
const cUp = (await cards()).join('|'), mUp = await mv()
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
const cHome = (await cards()).join('|'), mHome = await mv()
ok(cUp !== c0 && mUp === 1 && cHome === c0 && mHome === 0,
  `↑ 之后再 ↓ 回到原位：顺序期望回到「${c0}」（实际「${cHome}」）、移动记录期望从 1 条对消到 0 条（实际 ${mUp} → ${mHome}）`)

// 再挪一次，然后一路 ⌘Z：顺序与记录一起复原
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
const cDown = (await cards()).join('|')
const h1 = await hist()
ok(cDown !== c0 && await mv() === 1 && /下移一位/.test(String(h1.label)),
  `再 ↓ 一次：顺序变为「${cDown}」、记录 1 条、历史标签期望「下移一位」（实际「${h1.label}」）`)
for (let i = 0; i < 3; i++) { await page.keyboard.press('Meta+z'); await page.waitForTimeout(300) }
const cUndo = (await cards()).join('|'), mUndo = await mv(), h2 = await hist()
ok(cUndo === c0 && mUndo === 0 && h2.canUndo === false,
  `⌘Z 三下把三步全退掉：顺序期望「${c0}」（实际「${cUndo}」）、移动记录期望 0（实际 ${mUndo}）、期望没有可撤销的了（实际 canUndo=${h2.canUndo}）`)

// ── 4.1.24：焦点在页面自己的输入框里，方向键归那个框 ──
await page.evaluate(() => {
  const i = document.createElement('input'); i.id = 'vr-page-input'; i.value = 'abc'
  document.querySelector('main.hero').appendChild(i)
})
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(400)
await page.evaluate(() => document.getElementById('vr-page-input').focus())
const cBefore = (await cards()).join('|')
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
const cAfter = (await cards()).join('|')
ok(cAfter === cBefore && await mv() === 0,
  `焦点在页面自己的 input 里 ↓ 不接管：顺序期望不变（「${cBefore}」→「${cAfter}」）、移动记录期望 0（实际 ${await mv()}）`)
await page.evaluate(() => document.getElementById('vr-page-input').blur())

// ── 4.1.25：下拉弹层（visual-revise-select-panel）开着时也不接管 ──
const trigger = page.locator('visual-revise-panel vr-select .trigger').first()
await trigger.scrollIntoViewIfNeeded(); await trigger.click(); await page.waitForTimeout(400)
await page.evaluate(() => document.activeElement?.blur?.())
const dropOpen = await page.evaluate(() => !!document.getElementById('visual-revise-select-panel'))
const cDrop0 = (await cards()).join('|')
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300)
const cDrop1 = (await cards()).join('|')
ok(dropOpen && cDrop1 === cDrop0 && await mv() === 0,
  `下拉弹层开着（visual-revise-select-panel=${dropOpen}）时 ↓ 不接管：顺序期望不变（「${cDrop0}」→「${cDrop1}」）、移动记录期望 0（实际 ${await mv()}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

// ── 4.1.27：选中两个不同父级里的元素，各自在自己的父级里挪一位 ──
await reload()
await page.locator('.hero-bar button').nth(0).click(); await page.waitForTimeout(300)
await page.locator('.curve-card').nth(0).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(400)
const b0 = (await btns()).join('|'), k0 = (await cards()).join('|')
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500)
const b1 = (await btns()).join('|'), k1 = (await cards()).join('|'), m1x = await mv()
ok(b1 === 'Documentation|Get started' && k1 === 'Thinking Five|Original Thinking|Thinking Nine' && m1x === 2,
  `跨父级多选 ↓：按钮期望「Documentation | Get started」（实际「${b1.replace(/\|/g, ' | ')}」）、卡片期望「Thinking Five | Original Thinking | Thinking Nine」（实际「${k1.replace(/\|/g, ' | ')}」）、移动记录期望 2 条（实际 ${m1x}）`)
ok(b0 === 'Get started|Documentation' && k0 === 'Original Thinking|Thinking Five|Thinking Nine',
  `跨父级多选的起点确实是默认顺序（按钮「${b0.replace(/\|/g, ' | ')}」、卡片「${k0.replace(/\|/g, ' | ')}」）`)
}


// ─── 4.1.27 边界：⇧ 再点一次把某个元素移出多选之后，方向键只该挪剩下的那一个 ───
{
console.log('\n[方向键换位 · 补测三] ⇧ 取消其中一个之后的换位\n')
await reload()
const cards3 = () => page.evaluate(() => [...document.querySelectorAll('.curve-card .card-title')].map(e => e.textContent.trim()))
const mv3 = () => page.evaluate(() => window.__visualRevise.store.read().moves.length)
await page.locator('.curve-card').nth(0).click({ position: { x: 120, y: 12 } }); await page.waitForTimeout(300)
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(400)
const both = await page.evaluate(() => document.querySelectorAll('.curve-card[data-selected]').length)
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] }); await page.waitForTimeout(500)
const after = await page.evaluate(() => ({
  dom: document.querySelectorAll('.curve-card[data-selected]').length,
  engine: document.querySelector('vis-bug').selectorEngine.selection().length,
}))
ok(both === 2 && after.dom === 1,
  `⇧ 再点一次把第二张移出多选：页面上 data-selected 期望从 2 个变成 1 个（实际 ${both} → ${after.dom}）`)
ok(after.engine === 1,
  `移出多选后选择引擎里也该只剩 1 个（engine.selection() 期望 1，实际 ${after.engine}）`)
const before3 = (await cards3()).join('|')
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500)
const after3 = (await cards3()).join('|'), m3x = await mv3()
ok(after3 === 'Thinking Five|Original Thinking|Thinking Nine' && m3x === 1,
  `移出多选后 ↓ 只该挪仍被选中的那一张：期望「Thinking Five | Original Thinking | Thinking Nine」/ 1 条移动记录（起点「${before3.replace(/\|/g, ' | ')}」，实际「${after3.replace(/\|/g, ' | ')}」/ ${m3x} 条）`)
}

await browser.close(); await close()
console.log(process.exitCode ? '结果：有失败项\n' : '结果：全部通过\n')
