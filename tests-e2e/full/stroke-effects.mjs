/**
 * 全量 e2e 分块：Stroke（§2.9）/ Effects（§2.10）
 *
 * 清单：docs/plans/feature-inventory.md §2.9（2.9.1–2.9.5）、§2.10（2.10.1–2.10.7）
 * 断言全部落在真实结果上：元素的 inline style / 面板 DOM / 改动记录 / 页面几何。
 * 所有触发都走真实指针与键盘，不用程序化 dispatch。
 */
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const T = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

console.log('\n[全量 e2e] Stroke / Effects（§2.9、§2.10）\n')

await page.goto(`${origin}/full/fixtures/stroke-effects-main.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

// ── 通用工具 ────────────────────────────────────────────────
const P = sel => page.locator(`visual-revise-panel ${sel}`)
const S = (group, sel) => P(`section[data-group="${group}"] ${sel}`)

const inline = (id, prop) =>
  page.evaluate(([i, p]) => document.getElementById(i).style.getPropertyValue(p), [id, prop])
const box = id => page.evaluate(i => {
  const el = document.getElementById(i)
  return { w: el.offsetWidth, h: el.offsetHeight }
}, id)
const recorded = (id, prop) => page.evaluate(([i, p]) => {
  const el = document.getElementById(i)
  const entry = window.__visualRevise.store.read().edits.find(e => e.el === el)
  return entry ? (entry.changes.find(c => c.prop === p)?.to ?? null) : null
}, [id, prop])

// 选中一个元素：先把可能开着的弹层 / 选中状态清掉（Esc 一次只关一层），
// 再像用户一样点过去
const select = async id => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  await page.locator(`#${id}`).click({ position: { x: 12, y: 12 } })
  await page.waitForTimeout(450)
}

// Effects 默认折叠（只在选中文字元素时自动展开），非文字元素上要先点标题
const unfoldEffects = async () => {
  const sec = P('section[data-group="effects"]')
  if (await sec.getAttribute('folded') !== null) {
    const title = S('effects', 'h3 .title')
    await title.scrollIntoViewIfNeeded()
    await title.click()
    await page.waitForTimeout(300)
  }
}

const clickIn = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.click(); await page.waitForTimeout(300) }

// 顶层逗号切层：background-image / box-shadow 的每一层里都有 rgba(...) 这种
// 带逗号的函数，按括号深度切才不会把一层劈成两半
const splitTop = s => {
  const out = []
  let depth = 0, start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1 }
  }
  out.push(s.slice(start).trim())
  return out.filter(Boolean)
}

// ── 效果列表读写 ────────────────────────────────────────────
const fxRows = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return [...sr.querySelectorAll('section[data-group="effects"] .effect-row')].map(r => ({
    name: r.querySelector('.effect-name')?.textContent ?? '',
    sum:  r.querySelector('.effect-sum')?.textContent ?? '',
    off:  r.classList.contains('off'),
    eye:  !!r.querySelector('[data-effect-eye]'),
    del:  !!r.querySelector('[data-effect-del]'),
  }))
})

const addFx = async type => {
  const add = S('effects', '.add[data-add="effects"]')
  await add.scrollIntoViewIfNeeded()
  await add.click(); await page.waitForTimeout(320)
  await page.locator(`#visual-revise-menu [data-item="${type}"]`).click()
  await page.waitForTimeout(420)
}

const openFx = async i => {
  const row = S('effects', `[data-effect-open="${i}"]`)
  await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(120)
  await row.click(); await page.waitForTimeout(380)
}
const closePopover = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(220) }
const popoverOpen = () => page.evaluate(() => !!document.getElementById('visual-revise-menu'))

const fxFields = () => page.evaluate(() => {
  const h = document.getElementById('visual-revise-menu')
  return h ? [...h.shadowRoot.querySelectorAll('[data-fx]')].map(n => n.dataset.fx) : []
})
const setFx = async (key, value) => {
  const i = page.locator(`#visual-revise-menu input[data-fx="${key}"]`)
  await i.fill(String(value)); await i.press('Enter'); await page.waitForTimeout(380)
}
const setFxColor = async value => {
  const t = page.locator('#visual-revise-menu vr-color[data-fx="color"] .text')
  await t.fill(value); await t.press('Enter'); await page.waitForTimeout(380)
}

// 层列表的拖拽排序走 pointer 事件（行里铺满 button，HTML5 draggable 发不出 dragstart）
const dragRow = async (from, to) => {
  const A = S('effects', `[data-effect-row="${from}"]`)
  const B = S('effects', `[data-effect-row="${to}"]`)
  await A.scrollIntoViewIfNeeded(); await page.waitForTimeout(150)
  const a = await A.boundingBox(), b = await B.boundingBox()
  await page.mouse.move(a.x + 20, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 20, a.y + a.height / 2 + 8, { steps: 3 })
  await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(450)
}

// ════════════════════════════════════════════════════════════
// §2.9 Stroke（描边）
// ════════════════════════════════════════════════════════════
console.log('── §2.9 Stroke')

await select('plain')

// ── 2.9.1 空状态：只有标题 + 加号 ──
const strokeEmpty = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = sr.querySelector('section[data-group="stroke"]')
  if (!sec) return null
  return {
    title: sec.querySelector('h3 .title')?.textContent ?? '',
    add: !!sec.querySelector('.add[data-add="stroke"]'),
    addDisabled: sec.querySelector('.add[data-add="stroke"]')?.hasAttribute('disabled') ?? null,
    rows: sec.querySelector('.rows')?.children.length ?? -1,
    width: sec.querySelectorAll('input[data-prop="border-width"]').length,
    style: sec.querySelectorAll('vr-select[data-prop="border-style"]').length,
    color: sec.querySelectorAll('vr-color[data-prop="border-color"]').length,
    sizing: sec.querySelectorAll('button[data-prop="box-sizing"]').length,
  }
})
T('2.9.1', strokeEmpty?.title === 'Stroke' && strokeEmpty.add === true && strokeEmpty.rows === 0
  && strokeEmpty.width === 0 && strokeEmpty.style === 0 && strokeEmpty.color === 0 && strokeEmpty.sizing === 0,
  `没有描边时 Stroke 只剩标题 + 加号（行数 ${strokeEmpty?.rows}，粗细/样式/颜色/位置各 ${strokeEmpty?.width}/${strokeEmpty?.style}/${strokeEmpty?.color}/${strokeEmpty?.sizing} 个）`)
T('2.9.1', strokeEmpty?.addDisabled === false, '空状态下加号可点（不是 disabled）')

await clickIn(S('stroke', '.add[data-add="stroke"]'))
const afterAdd = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = sr.querySelector('section[data-group="stroke"]')
  return {
    width: sec.querySelectorAll('input[data-prop="border-width"]').length,
    style: sec.querySelectorAll('vr-select[data-prop="border-style"]').length,
    color: sec.querySelectorAll('vr-color[data-prop="border-color"]').length,
    sizing: sec.querySelectorAll('button[data-prop="box-sizing"]').length,
    addDisabled: sec.querySelector('.add[data-add="stroke"]')?.hasAttribute('disabled'),
    addTitle: sec.querySelector('.add[data-add="stroke"]')?.getAttribute('title'),
  }
})
T('2.9.1', afterAdd.width === 1 && afterAdd.style === 1 && afterAdd.color === 1 && afterAdd.sizing === 2,
  `点加号后四个控件都出现（粗细 ${afterAdd.width} / 样式 ${afterAdd.style} / 颜色 ${afterAdd.color} / 位置 ${afterAdd.sizing}）`)
T('2.9.1', await inline('plain', 'border-style') === 'solid' && await inline('plain', 'border-width') === '1px',
  `加描边写的是 border-style + border-width（${await inline('plain', 'border-style')} / ${await inline('plain', 'border-width')}）`)
T('2.9.1', afterAdd.addDisabled === true && /只有一层/.test(afterAdd.addTitle || ''),
  `已有描边后加号 disabled 并说明原因（title: ${afterAdd.addTitle}）`)

// ── 2.9.2 粗细 ──
const wPrefix = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const inp = sr.querySelector('section[data-group="stroke"] input[data-prop="border-width"]')
  const field = inp?.closest('.field')
  return {
    prefix: inp?.closest('.control')?.querySelector('.prefix')?.textContent?.trim() ?? null,
    paired: !!field?.parentElement?.classList.contains('pair'),
    pairedWith: !!field?.parentElement?.querySelector('vr-select[data-prop="border-style"]'),
  }
})
T('2.9.2', wPrefix.prefix === '▭', `粗细输入框的前缀是 ▭（实得 ${JSON.stringify(wPrefix.prefix)}）`)
T('2.9.2', wPrefix.paired && wPrefix.pairedWith, '粗细与「样式」并排在同一行（FIELD_PAIRS）')

const wInput = S('stroke', 'input[data-prop="border-width"]')
await wInput.scrollIntoViewIfNeeded()
await wInput.fill('6'); await wInput.press('Enter'); await page.waitForTimeout(320)
T('2.9.2', await inline('plain', 'border-width') === '6px',
  `粗细输入 6 → border-width: ${await inline('plain', 'border-width')}（裸数字补 px）`)
T('2.9.2', (await box('plain')).w === 212,
  `页面上真的粗了：content-box 下 200 + 2×6 = ${(await box('plain')).w}px`)
T('2.9.2', await recorded('plain', 'border-width') === '6px',
  `粗细进了改动记录（border-width → ${await recorded('plain', 'border-width')}）`)

// ── 2.9.3 样式 ──
const styleSel = S('stroke', 'vr-select[data-prop="border-style"]')
await styleSel.scrollIntoViewIfNeeded()
await styleSel.click(); await page.waitForTimeout(350)
const styleOpts = await page.evaluate(() => {
  const p = document.getElementById('visual-revise-select-panel')
  return p ? [...p.shadowRoot.children].map(i => i.textContent) : null
})
T('2.9.3', JSON.stringify(styleOpts) === JSON.stringify(['none', 'solid', 'dashed', 'dotted', 'double']),
  `样式下拉给出五项：${(styleOpts || []).join(' / ')}`)
await page.locator('#visual-revise-select-panel [data-item="dotted"]').click(); await page.waitForTimeout(380)
T('2.9.3', await inline('plain', 'border-style') === 'dotted',
  `选 dotted 写 border-style: ${await inline('plain', 'border-style')}`)
T('2.9.3', await styleSel.getAttribute('value') === 'dotted', '下拉触发器显示新值 dotted')

await styleSel.scrollIntoViewIfNeeded(); await styleSel.click(); await page.waitForTimeout(350)
await page.locator('#visual-revise-select-panel [data-item="double"]').click(); await page.waitForTimeout(380)
T('2.9.3', await inline('plain', 'border-style') === 'double',
  `选 double 写 border-style: ${await inline('plain', 'border-style')}`)

await S('stroke', 'vr-select[data-prop="border-style"]').scrollIntoViewIfNeeded()
await S('stroke', 'vr-select[data-prop="border-style"]').click(); await page.waitForTimeout(350)
await page.locator('#visual-revise-select-panel [data-item="none"]').click(); await page.waitForTimeout(420)
const readStroke = () => page.evaluate(() => {
  const sec = document.querySelector('visual-revise-panel').shadowRoot.querySelector('section[data-group="stroke"]')
  return {
    rows: sec.querySelector('.rows')?.children.length ?? -1,
    canAdd: !sec.querySelector('.add[data-add="stroke"]')?.hasAttribute('disabled'),
    addTitle: sec.querySelector('.add[data-add="stroke"]')?.getAttribute('title'),
  }
})
const noneNow = await readStroke()
T('2.9.3', await inline('plain', 'border-style') === 'none',
  `选 none 写 border-style: ${await inline('plain', 'border-style')}`)
// 描边没了（computed border-width 也跟着归 0），分区该当场退回空状态。
// 现在不会：#commit 只对 position / display 重绘（RERENDER_ON），面板停在旧结构上，
// 加号还挂着「CSS 的 border 只有一层，不能再加」的 disabled。
T('2.9.1', noneNow.rows === 0 && noneNow.canAdd,
  `样式选 none 之后分区当场退回空状态（行数 ${noneNow.rows}，加号可点 ${noneNow.canAdd}，title「${noneNow.addTitle}」）`)

// 换一次选中强制重绘，验证 #canAdd 的判定本身是对的
await select('plain')
const noneRedraw = await readStroke()
T('2.9.1', noneRedraw.rows === 0 && noneRedraw.canAdd,
  `重绘后确实是空状态（行数 ${noneRedraw.rows}，加号可点 ${noneRedraw.canAdd}）`)

// 恢复描边，继续测颜色
await clickIn(S('stroke', '.add[data-add="stroke"]'))

// ── 2.9.4 颜色 ──
const colorText = S('stroke', 'vr-color[data-prop="border-color"] .text')
await colorText.scrollIntoViewIfNeeded()
await colorText.fill('#22cc88'); await colorText.press('Enter'); await page.waitForTimeout(380)
// CSSOM 会把 #22cc88 规范成 rgb() 再吐回来，两者是同一个颜色
T('2.9.4', await inline('plain', 'border-color') === 'rgb(34, 204, 136)',
  `颜色框输入 #22cc88 → border-color: ${await inline('plain', 'border-color')}`)
T('2.9.4', /34,\s*204,\s*136|22cc88/i.test(await recorded('plain', 'border-color') || ''),
  `描边色进了改动记录（${await recorded('plain', 'border-color')}）`)

// 不透明度框：色值与 alpha 分开两格，写回合成 rgba
const alphaBox = S('stroke', 'vr-color[data-prop="border-color"] .alpha')
await alphaBox.fill('40'); await alphaBox.press('Enter'); await page.waitForTimeout(380)
T('2.9.4', /rgba\(34,\s*204,\s*136,\s*0?\.4\)/.test(await inline('plain', 'border-color')),
  `不透明度 40% → border-color: ${await inline('plain', 'border-color')}`)

// 可绑变量：分区标题栏的「绑定变量」按 border-color 绑
await clickIn(S('stroke', '.var-btn[data-var="stroke"]'))
const varItems = await page.evaluate(() => {
  const p = document.getElementById('visual-revise-color-panel')
  return p ? [...p.shadowRoot.querySelectorAll('[data-item]')].map(n => n.dataset.item) : null
})
T('2.9.4', Array.isArray(varItems) && varItems.includes('--vr-line'),
  `描边颜色能开变量页（列出 ${(varItems || []).join(' / ') || '空'}）`)
await page.locator('#visual-revise-color-panel [data-item="--vr-line"]').click(); await page.waitForTimeout(450)
const boundChip = await page.evaluate(() => {
  const sec = document.querySelector('visual-revise-panel').shadowRoot.querySelector('section[data-group="stroke"]')
  return sec.querySelector('.var-chip .var-name')?.textContent ?? null
})
T('2.9.4', await inline('plain', 'border-color') === 'var(--vr-line)' && boundChip === '--vr-line',
  `选中变量后写 var()（inline ${await inline('plain', 'border-color')}，chip 显示 ${boundChip}）`)

// ── 2.9.5 位置（box-sizing）──
await select('edged')
const strokeFull = await page.evaluate(() => {
  const sec = document.querySelector('visual-revise-panel').shadowRoot.querySelector('section[data-group="stroke"]')
  const btns = [...sec.querySelectorAll('button[data-prop="box-sizing"]')]
  return {
    labels: btns.map(b => b.textContent.trim()),
    values: btns.map(b => b.dataset.value),
    on: btns.find(b => b.hasAttribute('data-on'))?.dataset.value ?? null,
    fields: sec.querySelectorAll('input[data-prop="border-width"], vr-select[data-prop="border-style"], vr-color[data-prop="border-color"]').length,
  }
})
T('2.9.1', strokeFull.fields === 3, `已有描边的元素上三个字段都渲染（${strokeFull.fields} 个）`)
T('2.9.5', JSON.stringify(strokeFull.labels) === JSON.stringify(['内', '外'])
  && JSON.stringify(strokeFull.values) === JSON.stringify(['border-box', 'content-box']),
  `位置是两段按钮「内 / 外」→ ${strokeFull.values.join(' / ')}`)
T('2.9.5', strokeFull.on === 'content-box',
  `当前值高亮在「外」（页面默认 content-box，实得 ${strokeFull.on}）`)

const before = await box('edged')
await clickIn(S('stroke', 'button[data-prop="box-sizing"][data-value="border-box"]'))
const inner = await box('edged')
T('2.9.5', await inline('edged', 'box-sizing') === 'border-box',
  `点「内」写 box-sizing: ${await inline('edged', 'box-sizing')}`)
T('2.9.5', before.w === 208 && inner.w === 200,
  `「内」把边框吃进尺寸内：外框 ${before.w}px → ${inner.w}px（width:200 + 2×4 边框）`)

await clickIn(S('stroke', 'button[data-prop="box-sizing"][data-value="content-box"]'))
const outer = await box('edged')
T('2.9.5', await inline('edged', 'box-sizing') === 'content-box' && outer.w === 208,
  `点「外」写回 content-box，边框撑大盒子（${inner.w}px → ${outer.w}px）`)
const onNow = await page.evaluate(() => {
  const sec = document.querySelector('visual-revise-panel').shadowRoot.querySelector('section[data-group="stroke"]')
  return [...sec.querySelectorAll('button[data-prop="box-sizing"]')].find(b => b.hasAttribute('data-on'))?.dataset.value ?? null
})
T('2.9.5', onNow === 'content-box', `选中态跟着走（data-on → ${onNow}）`)

// ════════════════════════════════════════════════════════════
// §2.10 Effects（效果）
// ════════════════════════════════════════════════════════════
console.log('\n── §2.10 Effects')

await select('fx1')
await unfoldEffects()

// ── 2.10.1 加号 → 类型菜单 ──
const addBtn = S('effects', '.add[data-add="effects"]')
await addBtn.scrollIntoViewIfNeeded()
await addBtn.click(); await page.waitForTimeout(320)
const menu = await page.evaluate(() => {
  const h = document.getElementById('visual-revise-menu')
  if (!h) return null
  return [...h.shadowRoot.querySelectorAll('[data-item]')].map(n => ({ id: n.dataset.item, label: n.textContent.trim() }))
})
T('2.10.1', menu?.length === 7,
  `加号弹出类型菜单，七项（实得 ${menu?.length}）`)
T('2.10.1', JSON.stringify((menu || []).map(m => m.id))
  === JSON.stringify(['inner-shadow', 'drop-shadow', 'layer-blur', 'background-blur', 'noise', 'texture', 'glass']),
  `七种类型齐全且顺序同 EFFECTS：${(menu || []).map(m => m.label).join(' / ')}`)

await page.locator('#visual-revise-menu [data-item="inner-shadow"]').click(); await page.waitForTimeout(420)
let rows = await fxRows()
T('2.10.1', rows.length === 1 && rows[0].name === '内阴影' && /inset/.test(await inline('fx1', 'box-shadow')),
  `选「内阴影」加一行并写 box-shadow（${(await inline('fx1', 'box-shadow')).slice(0, 46)}）`)
T('2.10.1', /inset/.test(await recorded('fx1', 'box-shadow') || ''),
  `加效果进了改动记录（box-shadow → ${(await recorded('fx1', 'box-shadow') || '').slice(0, 42)}）`)

await addFx('drop-shadow')
rows = await fxRows()
const shadowRaw = await inline('fx1', 'box-shadow')
T('2.10.1', rows.length === 2 && rows[0].name === '投影' && rows[1].name === '内阴影',
  `新效果加在列表最前（${rows.map(r => r.name).join(' → ')}）`)
T('2.10.1', !/inset/.test(splitTop(shadowRaw)[0]) && /inset/.test(shadowRaw),
  `CSS 里也是新的那条排在前面（${shadowRaw.slice(0, 70)}…）`)

// ── 2.10.2 每行的组成 ──
T('2.10.2', rows.every(r => r.name && r.sum && r.eye && r.del),
  `每行都有 类型名 + 摘要 + 眼睛 + 减号（${rows.map(r => `${r.name}「${r.sum}」`).join('，')}）`)
T('2.10.2', rows[0].sum === '0 4 4' && rows[1].sum === '0 4 4',
  `阴影摘要是 x y blur（${rows[0].sum}）`)

// ── 2.10.3 参数弹层：投影 ──
await openFx(0)
T('2.10.3', JSON.stringify(await fxFields()) === JSON.stringify(['x', 'y', 'blur', 'spread', 'color']),
  `投影的参数面板字段：${(await fxFields()).join(' / ')}`)
await setFx('x', 5)
T('2.10.3', /5px 4px 4px 0px/.test(await inline('fx1', 'box-shadow')),
  `投影 X → box-shadow 第一个长度（${(await inline('fx1', 'box-shadow')).slice(0, 46)}）`)
T('2.10.3', await popoverOpen(), '改值不重绘：参数弹层还开着')
await setFx('y', 6)
T('2.10.3', /5px 6px 4px 0px/.test(await inline('fx1', 'box-shadow')), `投影 Y → ${(await inline('fx1', 'box-shadow')).slice(0, 46)}`)
await setFx('blur', 7)
T('2.10.3', /5px 6px 7px 0px/.test(await inline('fx1', 'box-shadow')), `投影 模糊 → ${(await inline('fx1', 'box-shadow')).slice(0, 46)}`)
await setFx('spread', 8)
T('2.10.3', /5px 6px 7px 8px/.test(await inline('fx1', 'box-shadow')), `投影 扩展 → ${(await inline('fx1', 'box-shadow')).slice(0, 46)}`)
const beforeBad = await inline('fx1', 'box-shadow')
await setFx('blur', 'abc')
T('2.10.3', await inline('fx1', 'box-shadow') === beforeBad,
  '非数字输入被 parseFloat 挡住，不写入')
// 色值框只管颜色，alpha 留给旁边那个框：默认的 25% 不该被 #ff0000 悄悄重置成 100%
await setFxColor('#ff0000')
T('2.10.3', /rgba\(255,\s*0,\s*0,\s*0?\.25\)\s*5px 6px 7px 8px/.test(await inline('fx1', 'box-shadow')),
  `投影 颜色 → ${(await inline('fx1', 'box-shadow')).slice(0, 52)}`)
await closePopover()

// ── 2.10.3 参数弹层：内阴影 ──
await openFx(1)
T('2.10.3', JSON.stringify(await fxFields()) === JSON.stringify(['x', 'y', 'blur', 'spread', 'color']),
  `内阴影的参数面板字段：${(await fxFields()).join(' / ')}`)
await setFx('x', 1); await setFx('y', 2); await setFx('blur', 3); await setFx('spread', 4)
await setFxColor('#00ff00')
const innerCss = await inline('fx1', 'box-shadow')
T('2.10.3', /rgba\(0,\s*255,\s*0,\s*0?\.25\)\s*1px 2px 3px 4px inset/.test(innerCss),
  `内阴影五个字段一起写回并带 inset（${splitTop(innerCss).find(p => /inset/.test(p))}）`)
await closePopover()

// 重绘后摘要跟着真实值走
await select('fx1')
rows = await fxRows()
T('2.10.2', rows[0].sum === '5 6 7' && rows[1].sum === '1 2 3',
  `摘要反映改后的真实值（${rows.map(r => r.sum).join(' | ')}）`)

// ── 2.10.3 图层模糊 ──
await select('fx2')
await addFx('layer-blur')
rows = await fxRows()
T('2.10.2', rows.length === 1 && rows[0].sum === '4px', `图层模糊摘要是 blur px（${rows[0].sum}）`)
T('2.10.3', await inline('fx2', 'filter') === 'blur(4px)', `图层模糊写 filter: ${await inline('fx2', 'filter')}`)
await openFx(0)
T('2.10.3', JSON.stringify(await fxFields()) === JSON.stringify(['blur']),
  `图层模糊的参数面板只有「模糊」（${(await fxFields()).join(' / ')}）`)
await setFx('blur', 9)
T('2.10.3', await inline('fx2', 'filter') === 'blur(9px)', `图层模糊 模糊=9 → filter: ${await inline('fx2', 'filter')}`)
await closePopover()

// ── 2.10.3 背景模糊 ──
await select('fx3')
await addFx('background-blur')
rows = await fxRows()
T('2.10.2', rows.length === 1 && rows[0].sum === '4px', `背景模糊摘要是 blur px（${rows[0].sum}）`)
T('2.10.3', await inline('fx3', 'backdrop-filter') === 'blur(4px)',
  `背景模糊写 backdrop-filter: ${await inline('fx3', 'backdrop-filter')}`)
await openFx(0)
T('2.10.3', JSON.stringify(await fxFields()) === JSON.stringify(['blur']),
  `背景模糊的参数面板只有「模糊」（${(await fxFields()).join(' / ')}）`)
await setFx('blur', 11)
T('2.10.3', await inline('fx3', 'backdrop-filter') === 'blur(11px)',
  `背景模糊 模糊=11 → backdrop-filter: ${await inline('fx3', 'backdrop-filter')}`)
await closePopover()

// ── 2.10.3 噪点 ──
await select('fx4')
await addFx('noise')
rows = await fxRows()
const noise0 = await inline('fx4', 'background-image')
T('2.10.2', rows.length === 1 && rows[0].sum === '100%', `噪点摘要是 density%（${rows[0].sum}）`)
T('2.10.3', /vr-noise/.test(noise0) && /baseFrequency='2\.40'/.test(noise0),
  `噪点默认 颗粒 0.5 → baseFrequency 2.40（${/baseFrequency='([^']+)'/.exec(noise0)?.[1]}）`)
await openFx(0)
T('2.10.3', JSON.stringify(await fxFields()) === JSON.stringify(['size', 'density', 'color']),
  `噪点的参数面板字段：${(await fxFields()).join(' / ')}`)
await setFx('size', 2)
const noiseSize = await inline('fx4', 'background-image')
T('2.10.3', /baseFrequency='0\.60'/.test(noiseSize),
  `噪点 颗粒=2 → baseFrequency 1.2/2=0.60（${/baseFrequency='([^']+)'/.exec(noiseSize)?.[1]}）`)
await setFx('density', 50)
const noiseDensity = await inline('fx4', 'background-image')
T('2.10.3', /opacity='0\.50'/.test(noiseDensity),
  `噪点 密度=50% → rect opacity 0.50（${/opacity='([^']+)'/.exec(noiseDensity)?.[1]}）`)
T('2.10.3', /baseFrequency='0\.60'/.test(noiseDensity),
  `改密度不该把刚调好的颗粒冲掉（baseFrequency 仍应是 0.60，实得 ${/baseFrequency='([^']+)'/.exec(noiseDensity)?.[1]}）`)
await setFxColor('#ff0000')
const noiseColor = await inline('fx4', 'background-image')
T('2.10.3', /flood-color='%23ff0000/.test(noiseColor),
  `噪点 颜色 → feFlood flood-color（${/flood-color='([^']+)'/.exec(noiseColor)?.[1]}）`)
await closePopover()

// ── 2.10.3 纹理 ──
await select('fx5')
await addFx('texture')
rows = await fxRows()
const tex0 = await inline('fx5', 'background-image')
T('2.10.2', rows.length === 1 && rows[0].sum === '4', `纹理摘要是 size（${rows[0].sum}）`)
T('2.10.3', /vr-texture/.test(tex0) && /baseFrequency='0\.25'/.test(tex0) && /opacity='0\.40'/.test(tex0),
  `纹理默认 尺寸 4 / 强度 4 → freq 0.25、opacity 0.40（${/baseFrequency='([^']+)'/.exec(tex0)?.[1]} / ${/opacity='([^']+)'/.exec(tex0)?.[1]}）`)
await openFx(0)
T('2.10.3', JSON.stringify(await fxFields()) === JSON.stringify(['size', 'radius']),
  `纹理的参数面板字段：${(await fxFields()).join(' / ')}`)
await setFx('size', 8)
const texSize = await inline('fx5', 'background-image')
T('2.10.3', /baseFrequency='0\.13'/.test(texSize),
  `纹理 尺寸=8 → baseFrequency 1/8=0.13（${/baseFrequency='([^']+)'/.exec(texSize)?.[1]}）`)
await setFx('radius', 5)
const texRadius = await inline('fx5', 'background-image')
T('2.10.3', /opacity='0\.50'/.test(texRadius),
  `纹理 强度=5 → opacity 0.50（${/opacity='([^']+)'/.exec(texRadius)?.[1]}）`)
T('2.10.3', /baseFrequency='0\.13'/.test(texRadius),
  `改强度不该把刚调好的尺寸冲掉（baseFrequency 仍应是 0.13，实得 ${/baseFrequency='([^']+)'/.exec(texRadius)?.[1]}）`)
await closePopover()

// ── 2.10.3 玻璃 ──
await select('fx6')
await addFx('glass')
rows = await fxRows()
T('2.10.2', rows.length === 1 && rows[0].sum === '12px · 180%', `玻璃摘要是 blur px · sat %（${rows[0].sum}）`)
const glass0 = await inline('fx6', 'backdrop-filter')
T('2.10.3', /blur\(12px\)/.test(glass0) && /saturate\((180%|1\.8)\)/.test(glass0),
  `玻璃写 backdrop-filter: ${glass0}`)
T('2.10.3', /rgba\(255,\s*255,\s*255,\s*0?\.4\) 0px 1px 0px( 0px)? inset/.test(await inline('fx6', 'box-shadow')),
  `玻璃补一道 inset 高光（${await inline('fx6', 'box-shadow')}）`)
await openFx(0)
T('2.10.3', JSON.stringify(await fxFields()) === JSON.stringify(['blur', 'saturate', 'highlight']),
  `玻璃的参数面板字段：${(await fxFields()).join(' / ')}`)
await setFx('blur', 20)
T('2.10.3', /blur\(20px\)/.test(await inline('fx6', 'backdrop-filter')),
  `玻璃 模糊=20 → ${await inline('fx6', 'backdrop-filter')}`)
await setFx('saturate', 250)
const glassSat = await inline('fx6', 'backdrop-filter')
T('2.10.3', /saturate\((250%|2\.5)\)/.test(glassSat) && /blur\(20px\)/.test(glassSat),
  `玻璃 饱和=250% → ${glassSat}`)
await setFx('highlight', 80)
T('2.10.3', /rgba\(255,\s*255,\s*255,\s*0?\.8\)/.test(await inline('fx6', 'box-shadow')),
  `玻璃 高光=80% → inset 高光透明度（${await inline('fx6', 'box-shadow')}）`)
await setFx('blur', 25)
T('2.10.3', /rgba\(255,\s*255,\s*255,\s*0?\.8\)/.test(await inline('fx6', 'box-shadow')),
  `改模糊不该把刚调好的高光冲掉（仍应是 0.8，实得 ${await inline('fx6', 'box-shadow')}）`)
await closePopover()

// ── 2.10.3 serialize → parse 往返 ──
// 噪点 / 纹理的参数是原样写进 data URI 的 data-vr 里的，反解才真的可逆。
// 靠 baseFrequency / opacity 倒推有两段夹取死区（纹理 size ≤ 1 一律夹成 freq 1.00、
// 强度 ≥ 10 一律夹成 opacity 1.00），所以这里特意挑落在死区里的值。
const fxValues = () => page.evaluate(() => {
  const h = document.getElementById('visual-revise-menu')
  if (!h) return null
  const out = {}
  for (const n of h.shadowRoot.querySelectorAll('[data-fx]'))
    out[n.dataset.fx] = n.tagName === 'VR-COLOR'
      ? (n.shadowRoot?.querySelector('.text')?.value ?? '')
      : n.value
  return out
})

const roundTrip = async (id, label, params) => {
  await select(id)
  await unfoldEffects()
  await openFx(0)
  for (const [k, v] of Object.entries(params)) {
    if (k === 'color') await setFxColor(v)
    else await setFx(k, v)
  }
  await closePopover()
  // 换一个元素再选回来：面板整块重建，效果列表只能从 CSS 重新派生——这就是 parse 那一半
  await select('plain')
  await select(id)
  await unfoldEffects()
  await openFx(0)
  const got = await fxValues()
  await closePopover()
  const norm = v => String(v ?? '').trim().toLowerCase()
  T('2.10.3', Object.entries(params).every(([k, v]) => norm(got?.[k]) === norm(v)),
    `${label}：serialize → parse 往返每个字段相等（写 ${JSON.stringify(params)} → 读回 ${JSON.stringify(got)}）`)
}

await roundTrip('fx4', '噪点', { size: 0.7, density: 33, color: '#00ff00' })
await roundTrip('fx5', '纹理', { size: 0.5, radius: 12 })
await roundTrip('fx6', '玻璃', { blur: 7, saturate: 140, highlight: 65 })

// ── 2.10.4 每行眼睛 ──
await select('fx7')
await addFx('drop-shadow')
await addFx('layer-blur')
rows = await fxRows()
T('2.10.4', rows.length === 2, `先备好两条效果（${rows.map(r => r.name).join(' / ')}）`)
const shadowOn = await inline('fx7', 'box-shadow')
const eyeIndex = rows.findIndex(r => r.name === '投影')
await clickIn(S('effects', `[data-effect-eye="${eyeIndex}"]`))
rows = await fxRows()
T('2.10.4', rows.length === 2 && rows[eyeIndex].off === true && await inline('fx7', 'box-shadow') === 'none',
  `点眼睛：行压暗留在列表里，box-shadow 变 ${await inline('fx7', 'box-shadow')}`)
T('2.10.4', await inline('fx7', 'filter') === 'blur(4px)', `关掉一条不影响另一条（filter 仍是 ${await inline('fx7', 'filter')}）`)
await clickIn(S('effects', `[data-effect-eye="${eyeIndex}"]`))
rows = await fxRows()
T('2.10.4', rows[eyeIndex].off === false && await inline('fx7', 'box-shadow') === shadowOn,
  `再点一次原样放回（${(await inline('fx7', 'box-shadow')).slice(0, 40)}）`)

// ── 2.10.5 每行减号 ──
const delIndex = (await fxRows()).findIndex(r => r.name === '投影')
await clickIn(S('effects', `[data-effect-del="${delIndex}"]`))
rows = await fxRows()
T('2.10.5', rows.length === 1 && rows[0].name === '图层模糊' && await inline('fx7', 'box-shadow') === 'none',
  `减号删掉那一条（剩 ${rows.map(r => r.name).join('/')}，box-shadow → ${await inline('fx7', 'box-shadow')}）`)
T('2.10.5', await inline('fx7', 'filter') === 'blur(4px)', `没被删的那条不动（filter ${await inline('fx7', 'filter')}）`)
await clickIn(S('effects', '[data-effect-del="0"]'))
rows = await fxRows()
T('2.10.5', rows.length === 0 && await inline('fx7', 'filter') === 'none',
  `删光后列表空、filter 归 ${await inline('fx7', 'filter')}`)

// ── 2.10.6 行拖拽排序 ──
await select('fxdrag')
await addFx('inner-shadow')
await addFx('drop-shadow')
const orderBefore = (await fxRows()).map(r => r.name)
const cssBefore = await inline('fxdrag', 'box-shadow')
await dragRow(0, 1)
const orderAfter = (await fxRows()).map(r => r.name)
const cssAfter = await inline('fxdrag', 'box-shadow')
const firstIsInset = css => /inset/.test(splitTop(css)[0])
T('2.10.6', JSON.stringify(orderBefore) === JSON.stringify(['投影', '内阴影'])
  && JSON.stringify(orderAfter) === JSON.stringify(['内阴影', '投影']),
  `拖第一行到第二行，列表顺序变了（${orderBefore.join('→')} 变成 ${orderAfter.join('→')}）`)
T('2.10.6', firstIsInset(cssBefore) === false && firstIsInset(cssAfter) === true,
  `CSS 里的先后跟着换（box-shadow 第一段 inset：${firstIsInset(cssBefore)} → ${firstIsInset(cssAfter)}）`)

// ── 2.10.7 噪点 / 纹理与填充层共用 background-image ──
await select('fxfill')
const fillRowsCount = () => S('fill', 'vr-fill[data-layer]').count()
const fills0 = await fillRowsCount()
T('2.10.7', fills0 === 2, `固件本来有两层填充（渐变 + 底色），面板列出 ${fills0} 层`)

await addFx('noise')
const mixed = await inline('fxfill', 'background-image')
const parts = splitTop(mixed)
T('2.10.7', /vr-noise/.test(parts[0]) && parts.some(p => /^linear-gradient\(90deg/.test(p)),
  `噪点层排在填充层前面（第 1 段 vr-noise，后面仍有原来的渐变；共 ${parts.length} 段）`)
T('2.10.7', await inline('fxfill', 'background-color') === 'rgb(18, 52, 86)',
  `底色那一层没被吞掉（background-color: ${await inline('fxfill', 'background-color')}）`)
T('2.10.7', await fillRowsCount() === 2 && (await fxRows()).length === 1,
  `噪点只出现在 Effects 里，不冒充填充层（填充 ${await fillRowsCount()} 层 / 效果 ${(await fxRows()).length} 条）`)

await clickIn(S('fill', '.add[data-add="fill"]'))
const mixed2 = await inline('fxfill', 'background-image')
const parts2 = splitTop(mixed2)
T('2.10.7', /vr-noise/.test(parts2[0]) && await fillRowsCount() === 3 && (await fxRows()).length === 1,
  `再加一层填充，噪点仍在最前（${parts2.length} 段；填充 ${await fillRowsCount()} 层 / 效果 ${(await fxRows()).length} 条）`)

const delIdx = (await fxRows()).findIndex(r => r.name === '噪点')
await clickIn(S('effects', `[data-effect-del="${delIdx}"]`))
const afterDel = await inline('fxfill', 'background-image')
T('2.10.7', !/vr-noise/.test(afterDel) && /linear-gradient\(90deg/.test(afterDel) && await fillRowsCount() === 3,
  `删掉噪点只掉那一层，填充层原封不动（填充 ${await fillRowsCount()} 层：${afterDel.slice(0, 60)}…）`)

// ── 收尾 ──
console.log(`\n合计 ${passed + failed} 条：通过 ${passed}，失败 ${failed}\n`)
await browser.close()
await close()
