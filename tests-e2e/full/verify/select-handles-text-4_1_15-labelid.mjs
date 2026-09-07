// 独立复现脚本 · 清单 4.1.15（⌘C/⌘X 把 data-label-id 一起复制进 outerHTML 这一面）
//
// 注：本目录下已有 select-handles-text-4_1_15.mjs，测的是**另一个**报告
//     （⌘X 不进 ChangeStore），故本脚本另起文件名，不覆盖它。
//
// 报告称：⌘C / ⌘X 克隆时只 removeAttribute('data-selected')，把编辑器内部记号
// data-label-id 一起写进 window.copy_backup / 剪贴板；⌘V 粘回页面后，
// select() 又用 handles.length 从 0 现发号（unselect_all 会把 handles 清空），
// 于是页面上出现多个 data-label-id="0"；缩放把手 handle.element.js:42 用
// $(`[data-label-id="${id}"]`)[0] 按文档顺序取目标，撞号时取到排在前面的粘贴副本 ——
// 拖 #d 的把手，改的却是 #c 里那个用户没选中的副本。
//
// 期望依据（先查过，不是脑补）：
//   - docs/PRD.md 全文没有 ⌘C/⌘X/⌘V 元素级剪贴板的任何 AC（只有 AC-3.9 ⌘D、
//     AC-3.10 ⌘⌥C/⌘⌥V 样式剪贴板），没有任何一句把「复制出来的 HTML 带编辑器内部
//     记号」写成有意设计。
//   - docs/plans/feature-inventory.md:450 这条「覆盖」栏是 **无**；:735 把 §4.2 把手
//     列为零覆盖重点；:773-775 要求结构性 DOM 操作要么进记录要么被禁用。
//   - app/features/selectable.js 的 on_copy / on_cut 上下没有任何注释解释「为什么要
//     把 data-label-id 留在 outerHTML 里」。
//
// 本脚本不复用 tests-e2e/full/select-handles-text.mjs 的任何断言与 helper，全部重测，
// 并且要主动**推翻**它：
//   反驳点 1：也许拖拽根本没打到把手（那「#d 不变」只能证明"没拖动"，证明不了"改错元素"）
//             → 先跑干净页面的对照组，证明同一套坐标能把 #d 拖宽。
//   反驳点 2：也许 data-label-id 在 clone / DOMParser / 粘贴路径上某一步被剥掉了
//             → 逐步打印 copy_backup 原文与粘贴副本的全部属性。
//   反驳点 3：也许 $()[0] 取到的其实就是 #d（那个选择器还会命中 visbug-handles 自己）
//             → 在页面里把那句选择器原样跑一遍，打印它按文档顺序的解析结果。
// 全程真实指针 / 键盘（page.mouse / page.keyboard），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))

// 元素级剪贴板要读写 navigator.clipboard
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })

const log = (...a) => console.log(...a)

await page.goto(`${origin}/full/fixtures/select-handles-text-page.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(500)

log('\n=== 4.1.15 ⌘C/⌘X/⌘V 带出 data-label-id → 把手改错元素 · 独立复现 ===\n')

// ── 探针（本脚本自备）────────────────────────────────────────
const rect = sel => page.evaluate(s => {
  const e = document.querySelector(s)
  if (!e) return null
  const b = e.getBoundingClientRect()
  return { l: b.left, t: b.top, r: b.right, w: b.width, h: b.height,
           cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
}, sel)

// 真实鼠标点元素中心（把手热区在四边外扩 ~12px，中心离它们最远）
const clickCenter = async sel => {
  const r = await rect(sel)
  await page.mouse.move(Math.round(r.cx), Math.round(r.cy))
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(350)
}

const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300) }

const selectedNow = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-selected]')]
    .map(e => `${e.id || e.tagName.toLowerCase()}@labelid=${e.getAttribute('data-label-id')}`))

// 页面上所有带 data-label-id 的节点，按**文档顺序**列出
// （visbug-handles / visbug-label 自己也带这个属性，一并列出才看得到真实竞争关系）
const labelIdMap = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-label-id]')].map(e => ({
    tag: e.tagName.toLowerCase(),
    id: e.id || '',
    parent: e.parentElement ? (e.parentElement.id || e.parentElement.tagName.toLowerCase()) : '',
    labelId: e.getAttribute('data-label-id'),
  })))

// 原样跑一遍把手取目标的那句：$(`[data-label-id="${id}"]`)[0]
const firstMatchFor = id => page.evaluate(i => {
  const list = [...document.querySelectorAll(`[data-label-id="${i}"]`)]
  const f = list[0]
  const name = el => el
    ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}(父=${el.parentElement?.id || el.parentElement?.tagName.toLowerCase()})`
    : null
  return { count: list.length, first: name(f), all: list.map(name) }
}, id)

const widths = () => page.evaluate(() => {
  const px = el => el ? Math.round(el.getBoundingClientRect().width) : null
  const d = document.getElementById('d')
  const clone = document.querySelector('#c .item')
  return {
    d_inline: d?.style.width || '', d_box: px(d),
    clone_inline: clone?.style.width || '', clone_box: px(clone),
  }
})

// 拖某元素右边中点的把手（middle-end 落在 rect.right、垂直居中）
const dragRightHandle = async (sel, dx) => {
  const r = await rect(sel)
  const hx = Math.round(r.r), hy = Math.round(r.cy)
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.mouse.move(hx + dx, hy, { steps: 6 })
  await page.waitForTimeout(220)
  await page.mouse.up()
  await page.waitForTimeout(350)
  return { hx, hy }
}

const storeEdits = () => page.evaluate(() => {
  const s = window.__visualRevise?.store
  if (!s) return null
  return s.read().edits.map(e => ({
    id: e.el?.id || '(无 id)',
    parent: e.el?.parentElement?.id || '',
    props: (e.changes || []).map(c => `${c.prop}:${c.before}→${c.after}`),
  }))
})

const resetAll = () => page.evaluate(() => {
  window.__visualRevise?.store?.clear()
  window.__visualRevise?.store?.history?.clear()
})

// ══════════════════════════════════════════════════════════
// 0. 对照组：干净页面上，同一套坐标能不能真的把 #d 拖宽？
//    （若这里就拖不动，后面的"#d 没变"只能证明"没拖到"）
// ══════════════════════════════════════════════════════════
log('--- 0. 对照组：页面上没有任何粘贴副本时，拖 #d 右中把手 +50px ---')
await clickCenter('#d')
log('  [选中集]', JSON.stringify(await selectedNow()))
log('  [label-id 全表]', JSON.stringify(await labelIdMap()))
const ctrlBefore = await widths()
const ctrlPt = await dragRightHandle('#d', 50)
const ctrlAfter = await widths()
await page.waitForTimeout(1200)   // 给 ChangeStore 的防抖 / MutationObserver 留足时间
log(`  [按下坐标] (${ctrlPt.hx}, ${ctrlPt.hy})`)
log('  [拖前]', JSON.stringify(ctrlBefore))
log('  [拖后]', JSON.stringify(ctrlAfter))
log('  [对照组的改动记录]', JSON.stringify(await storeEdits()),
    '（正常拖动会不会进记录，是判断第 5 步"误改进没进账"的基准）')
const CONTROL_OK = !!ctrlAfter.d_inline && ctrlAfter.d_inline !== ctrlBefore.d_inline
log(`  ==> 0 对照组：同一套坐标确实拖到了把手、#d 变宽 = ${CONTROL_OK}（#d.style.width=${ctrlAfter.d_inline || '没变'}）`)

// 复原到干净状态
await esc()
await page.evaluate(() => {
  const d = document.getElementById('d')
  d.style.width = ''; d.style.height = ''; d.style.transform = ''
})
await resetAll()
await page.waitForTimeout(250)

// ══════════════════════════════════════════════════════════
// 1. 点 #a 中心选中
// ══════════════════════════════════════════════════════════
log('\n--- 1. 点 #a 中心选中 ---')
await clickCenter('#a')
log('  [选中集]', JSON.stringify(await selectedNow()))
const aLabel = await page.evaluate(() => document.getElementById('a').getAttribute('data-label-id'))
log(`  [#a 的 data-label-id] ${JSON.stringify(aLabel)}`)

// ══════════════════════════════════════════════════════════
// 2. ⌘C → copy_backup 里到底有什么
// ══════════════════════════════════════════════════════════
log('\n--- 2. 按 ⌘C ---')
await page.keyboard.press('Meta+c'); await page.waitForTimeout(500)
const copied = await page.evaluate(() => window.copy_backup || '')
log(`  [window.copy_backup] ${JSON.stringify(copied)}`)
const COPY_LEAKS_LABELID = /data-label-id/.test(copied)
const COPY_STRIPS_SELECTED = copied.length > 0 && !/data-selected/.test(copied)
log(`  ==> 2a copy_backup 带 data-label-id = ${COPY_LEAKS_LABELID}`)
log(`  ==> 2b copy_backup 已剥掉 data-selected = ${COPY_STRIPS_SELECTED}（说明"只剥了一半"）`)

// ══════════════════════════════════════════════════════════
// 3. Esc → 点 #c 中心 → ⌘V
// ══════════════════════════════════════════════════════════
log('\n--- 3. Esc，选 #c，按 ⌘V ---')
await esc()
const aAfterEsc = await page.evaluate(() => document.getElementById('a').getAttribute('data-label-id'))
log(`  [Esc 之后 #a 的 data-label-id] ${JSON.stringify(aAfterEsc)}（取消选中会摘掉，是这条链的前提）`)
await clickCenter('#c')
log('  [选中集]', JSON.stringify(await selectedNow()))
await page.keyboard.press('Meta+v'); await page.waitForTimeout(800)
const cloneInfo = await page.evaluate(() => {
  const cl = document.querySelector('#c .item')
  return cl
    ? { exists: true, outer: cl.outerHTML, attrs: [...cl.attributes].map(a => `${a.name}="${a.value}"`) }
    : { exists: false }
})
log(`  [#c 里的粘贴副本] ${JSON.stringify(cloneInfo)}`)
const PASTE_CARRIES_LABELID = !!cloneInfo.exists && (cloneInfo.attrs || []).some(a => a.startsWith('data-label-id='))
log(`  ==> 3 粘贴副本进了 DOM 且带着 data-label-id = ${PASTE_CARRIES_LABELID}`)

// ══════════════════════════════════════════════════════════
// 4. Esc → 点 #d 中心 → 现在页面上有几个同号节点
// ══════════════════════════════════════════════════════════
log('\n--- 4. Esc，选 #d ---')
await esc()
await clickCenter('#d')
log('  [选中集]', JSON.stringify(await selectedNow()))
log('  [label-id 全表（文档顺序）]')
for (const row of await labelIdMap())
  log(`     ${row.tag}${row.id ? '#' + row.id : ''}  父=${row.parent}  data-label-id=${row.labelId}`)
const dLabel = await page.evaluate(() => document.getElementById('d').getAttribute('data-label-id'))
log(`  [#d 的 data-label-id] ${JSON.stringify(dLabel)}`)
const resolved = await firstMatchFor(dLabel)
log(`  [把手那句 $(\`[data-label-id="${dLabel}"]\`) 的解析] 命中 ${resolved.count} 个：${JSON.stringify(resolved.all)}`)
log(`  [它取的 [0] 是] ${resolved.first}`)
const COLLISION = resolved.count > 1
const FIRST_IS_NOT_D = !!resolved.first && !resolved.first.startsWith('div#d')
log(`  ==> 4a 撞号（同一个 label-id 有多个节点）= ${COLLISION}`)
log(`  ==> 4b 把手会取到的第一个节点**不是** #d = ${FIRST_IS_NOT_D}`)

// ══════════════════════════════════════════════════════════
// 5. 拖 #d 右边中点的把手 +50px：到底改了谁
// ══════════════════════════════════════════════════════════
log('\n--- 5. 拖 #d 右中把手 +50px ---')
const before5 = await widths()
log('  [拖前]', JSON.stringify(before5))
const pt5 = await dragRightHandle('#d', 50)
log(`  [按下坐标] (${pt5.hx}, ${pt5.hy})`)
const after5 = await widths()
log('  [拖后]', JSON.stringify(after5))
const D_UNCHANGED = !after5.d_inline
const CLONE_CHANGED = !!after5.clone_inline
log(`  ==> 5a #d.style.width 没变 = ${D_UNCHANGED}（实得 ${JSON.stringify(after5.d_inline)}）`)
log(`  ==> 5b #c 里的粘贴副本被改宽 = ${CLONE_CHANGED}（实得 ${JSON.stringify(after5.clone_inline)}）`)

// ══════════════════════════════════════════════════════════
// 6. 这次误改有没有进改动记录（记在谁头上）
// ══════════════════════════════════════════════════════════
log('\n--- 6. 改动记录 ---')
await page.waitForTimeout(1200)
log('  [ChangeStore.edits]', JSON.stringify(await storeEdits()))
log('  [store.stats]', JSON.stringify(await page.evaluate(() => window.__visualRevise?.store?.stats())))

log('\n[页面异常]', pageErrors.length ? pageErrors.join(' / ') : '无')

log('\n================ 结论 ================')
log('0  对照组：同坐标能把 #d 拖宽            :', CONTROL_OK)
log('2a ⌘C 的 outerHTML 带 data-label-id      :', COPY_LEAKS_LABELID)
log('2b 同一次克隆已剥掉 data-selected        :', COPY_STRIPS_SELECTED)
log('3  粘贴副本进 DOM 且带 data-label-id     :', PASTE_CARRIES_LABELID)
log('4a 选 #d 后同号撞车                      :', COLLISION)
log('4b 把手取到的第一个节点不是 #d           :', FIRST_IS_NOT_D)
log('5a 拖完 #d 宽度没变                      :', D_UNCHANGED)
log('5b 粘贴副本被改宽（改错元素）            :', CLONE_CHANGED)
log('总判定 报告成立:',
  CONTROL_OK && COPY_LEAKS_LABELID && PASTE_CARRIES_LABELID && COLLISION && FIRST_IS_NOT_D && D_UNCHANGED && CLONE_CHANGED)
log('=====================================\n')

await browser.close(); await close()
