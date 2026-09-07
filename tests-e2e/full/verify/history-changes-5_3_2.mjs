// 独立复现脚本 · 清单 5.3.2
// 报告称：点改动记录底部的「重置」之后按 ⌘Z，属性 / 换图 / 删除 / 移动 / 评论都回来了，
//         唯独「文案改动」有去无回——页面停在原文，stats().texts 从 1 掉到 0，
//         total 比重置前少一条，而且重做链里也没有它。
// 清单 5.3.2 原文：「⌘Z 能把这次重置连同移动一起救回来。（AC-8.9）」
// PRD AC-8.9：「重置：清掉所有记录（含已失联的），页面恢复——包括把搬过家的元素放回原位；
//               ⌘Z 能把这次重置连同移动一起救回来」
// 全程真实交互（locator.click / page.keyboard），不用 element.click() / dispatchEvent。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const FIXTURE = `${origin}/full/fixtures/history-changes-lab.html`
const { browser, page } = await launch({ headless: true })
await page.setViewportSize({ width: 1440, height: 900 })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const BAR = sel => page.locator(`visual-revise-toolbar ${sel}`)
const LIST = sel => page.locator(`visual-revise-list ${sel}`)

const settle = () => page.evaluate(() =>
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

// 焦点可能停在 shadow root 里的输入框上；⌘Z 之前先失焦（照报告的复现步骤）
const blur = () => page.evaluate(() => {
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  el?.blur?.()
})
const undo = async () => { await blur(); await page.keyboard.press('Meta+z'); await page.waitForTimeout(400) }
const redo = async () => { await blur(); await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(400) }

const openList = async () => {
  const hidden = await page.evaluate(() => document.querySelector('visual-revise-list').hidden)
  if (hidden) { await BAR('.list').click(); await page.waitForTimeout(400) }
}

// 页面 + 记录的完整现场：断言全落在这上面
const snap = () => page.evaluate(() => {
  const s = window.__visualRevise.store
  const st = s.stats()
  const edits = s.read().edits
  return {
    stats: st,
    txt:   document.getElementById('txt').textContent.trim(),
    p1:    document.getElementById('p1').style.paddingTop,
    src:   document.getElementById('pic').getAttribute('src').slice(-14),
    dgo:   !!document.querySelector('#dw .row'),           // 被删的还在不在页面上
    dst:   document.getElementById('dst').textContent.trim(),
    // 记录里带 text 字段的那些（改动记录列表里的「文案」行）
    textEdits: edits.filter(e => e.text).map(e => `${e.text.from} → ${e.text.to}`),
    hist:  { depth: s.history.depth, canUndo: s.history.canUndo, canRedo: s.history.canRedo,
             undoLabel: s.history.undoLabel, redoLabel: s.history.redoLabel },
  }
})

const line = (tag, o) => console.log(`[${tag}]`,
  `文案=「${o.txt}」`,
  `texts=${o.stats.texts}`, `props=${o.stats.props}`, `attrs=${o.stats.attrs}`,
  `removals=${o.stats.removals}`, `moves=${o.stats.moves}`, `comments=${o.stats.comments}`,
  `total=${o.stats.total}`,
  `| p1=${o.p1 || '(无)'} src…${o.src} #dw有行=${o.dgo} #dst=「${o.dst}」`,
  `| 历史 depth=${o.hist.depth} undo=${o.hist.undoLabel ?? '-'} redo=${o.hist.redoLabel ?? '-'}`)

// 真实打字改文案：双击手势在自动化里驱动不了（同坐标第二次点击会被吞），
// 双击处理器本身只做 toolSelected('text')，所以走它——测的仍是同一条编辑态路径。
const typeIntoText = async () => {
  await page.locator('#txt').click({ force: true })
  await page.waitForTimeout(300)
  await page.evaluate(() => document.querySelector('vis-bug').toolSelected('text'))
  await page.waitForTimeout(350)
  const editable = await page.locator('#txt').evaluate(el => el.isContentEditable)
  await page.keyboard.press('End')
  await page.keyboard.type('（改过）')
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  return editable
}

const round = async (n, { realTyping = false } = {}) => {
  console.log(`\n════════ 第 ${n} 轮${realTyping ? '（文案用真实键盘输入）' : ''} ════════`)
  await page.goto(FIXTURE)
  await injectVisBug(page, origin)
  await page.waitForTimeout(400)

  if (realTyping) {
    const editable = await typeIntoText()
    console.log(`    进入编辑态 contenteditable=${editable}，键入后页面文案=`,
      `「${await page.locator('#txt').textContent()}」`)
  }

  // ── 造改动：文案 + 一批别的（属性 / 换图 / 删除 / 移动 / 评论），便于对比 ──
  await page.evaluate(realTyping => {
    const s = window.__visualRevise.store
    if (!realTyping) {
      const txt = document.getElementById('txt')
      s.markEdited(txt); txt.childNodes[0].nodeValue = '被改过的文案'; s.touch()
    }
    s.applyProp(document.getElementById('p1'), 'padding-top', '40px')
    s.applyAttr(document.getElementById('pic'), 'src', 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw=')
    s.removeElements([document.getElementById('dgo')])
    s.moveElement(document.getElementById('mvr'), document.getElementById('dst'), null)
    s.addComment(document.getElementById('ttl'), '标题要更大')
  }, realTyping)
  await settle(); await page.waitForTimeout(400)

  const before = await snap()
  line('1 改完', before)

  // ── 真实点击改动记录底部的「重置」 ──
  await openList()
  await LIST('.reset').click()
  await page.waitForTimeout(700)
  const afterReset = await snap()
  line('2 重置后', afterReset)

  // ── 失焦后按 ⌘Z ──
  await undo()
  const rescued = await snap()
  line('3 ⌘Z 后', rescued)
  console.log('    记录里的文案行 =', JSON.stringify(rescued.textEdits))

  // ── 再 ⌘⇧Z / ⌘Z 走一圈：这条文案改动还找不找得回来 ──
  await redo()
  const afterRedo = await snap()
  line('4 ⌘⇧Z 后', afterRedo)
  await undo()
  const again = await snap()
  line('5 再 ⌘Z 后', again)

  // 真实打字那轮，历史栈里「改文案」还是一条独立记录（undoLabel 就是它）。
  // 试试再往回退一格、再前进一格，看这条文案改动能不能从这条路捞回来。
  const extra = []
  if (realTyping) {
    await undo(); const back2 = await snap(); line('6 再往回一格', back2); extra.push(back2)
    await redo(); const fwd = await snap();  line('7 ⌘⇧Z 前进一格', fwd);  extra.push(fwd)
  }

  const edited = before.txt                       // 重置前页面上的文案
  const textBack = rescued.txt === edited && rescued.stats.texts === 1
  const othersBack = rescued.p1 === '40px' && rescued.stats.attrs === 1
    && rescued.stats.removals === 1 && rescued.stats.moves === 1 && rescued.stats.comments === 1
  const everBack = [rescued, afterRedo, again, ...extra].some(o => o.txt === edited)

  console.log(`\n  → 别的改动救回来了吗：${othersBack ? '是' : '否'}`)
  console.log(`  → 文案救回来了吗：    ${textBack ? '是' : '否'}`)
  console.log(`  → total 对得上吗：    ${rescued.stats.total} / 重置前 ${before.stats.total}`)
  console.log(`  → 后续任何一步救回过文案吗：${everBack ? '是' : '否'}`)

  return { before, afterReset, rescued, afterRedo, again, textBack, othersBack, everBack }
}

// ── 补充场景：文案改动的那条历史被 HISTORY_LIMIT 挤出栈之后 ──
// 第 3 轮说明「真实打字」那条 `改文案` 历史还在栈里，多按一次 ⌘Z 再 ⌘⇧Z 能把文案捞回来。
// 但 history.js 的 past 上限是 100（满了 `past.shift()` 丢最旧的）。
// 改稿改久一点，早先那次改文案就被挤出去了——那时「重置 + ⌘Z」还救得回来吗？
const evictedRound = async () => {
  console.log('\n════════ 第 4 轮（改文案的那条历史被 HISTORY_LIMIT 挤出栈）════════')
  await page.goto(FIXTURE)
  await injectVisBug(page, origin)
  await page.waitForTimeout(400)

  const editable = await typeIntoText()
  // 「改文案」是 beginText/endText 圈出来的一条，退出编辑态才入栈——
  // 必须先确认它真的进了栈，后面攒的历史才谈得上把它挤出去
  await page.evaluate(() => document.querySelector('vis-bug').toolSelected('inspector'))
  await page.locator('#ttl').click({ force: true }); await page.waitForTimeout(500)
  const committed = await page.evaluate(() => {
    const h = window.__visualRevise.store.history
    return { depth: h.depth, undoLabel: h.undoLabel }
  })
  console.log(`    真实键盘输入，contenteditable=${editable}，页面文案=「${await page.locator('#txt').textContent()}」`)
  console.log(`    退出编辑态后：depth=${committed.depth} 栈顶=「${committed.undoLabel}」（这条就是要被挤掉的那条）`)

  // 再攒满 110 条互不合并的历史（不同属性 → mergeable 为假），把「改文案」挤出去
  const filled = await page.evaluate(() => {
    const s = window.__visualRevise.store
    const els = ['p1', 'p2', 'p3'].map(i => document.getElementById(i))
    const props = ['padding-top', 'padding-bottom', 'padding-left', 'padding-right',
                   'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
                   'border-radius', 'border-top-width']
    let n = 0
    for (let i = 0; i < 110; i++) {
      const before = s.history.depth
      s.applyProp(els[i % 3], props[i % props.length], `${10 + i}px`)
      if (s.history.depth !== before) n++
    }
    return { depth: s.history.depth, pushed: n, undoLabel: s.history.undoLabel }
  })
  await page.waitForTimeout(400)
  const beforeReset = await snap()
  console.log(`    攒了 ${filled.pushed} 条历史后 depth=${filled.depth}（HISTORY_LIMIT=100），`
    + `栈顶=「${filled.undoLabel}」——「改文案」已被 past.shift() 挤出`)
  line('1 改完', beforeReset)

  await openList()
  await LIST('.reset').click(); await page.waitForTimeout(700)
  line('2 重置后', await snap())

  await undo()
  const rescued = await snap()
  line('3 ⌘Z 后', rescued)

  // 把整个历史栈走遍：先一路 ⌘Z 到栈底，再一路 ⌘⇧Z 回到栈顶。
  // 第 3 轮就是靠「往回一格再前进一格」把文案捞回来的，所以两个方向都得走到。
  const txtNow = () => page.evaluate(() => document.getElementById('txt').textContent.trim())
  let seen = false, back = 0, fwd = 0
  while (back < 140 && await page.evaluate(() => window.__visualRevise.store.history.canUndo)) {
    await blur(); await page.keyboard.press('Meta+z'); await page.waitForTimeout(40); back++
    if (await txtNow() === beforeReset.txt) { seen = true; break }
  }
  while (!seen && fwd < 140 && await page.evaluate(() => window.__visualRevise.store.history.canRedo)) {
    await blur(); await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(40); fwd++
    if (await txtNow() === beforeReset.txt) { seen = true; break }
  }
  console.log(`    走遍整个历史栈（⌘Z ${back} 步到底 + ⌘⇧Z ${fwd} 步回顶）：`
    + `任何一步出现过「${beforeReset.txt}」吗 → ${seen ? '是' : '否'}`)
  const bottom = await snap()
  line('4 栈底', bottom)

  const lost = rescued.txt !== beforeReset.txt && rescued.stats.texts === 0 && !seen
  console.log(`\n  → 「改文案」被挤出历史后，重置 + ⌘Z 的文案改动${lost ? '彻底找不回来了' : '还能找回来'}`)
  return { beforeReset, rescued, bottom, seen, lost }
}

console.log('\n=== 5.3.2 「重置全部」后 ⌘Z 是否连文案改动一起救回 · 独立复现 ===')

const r1 = await round(1)
const r2 = await round(2)
// 第 3 轮换成真实键盘输入改文案，排除「是 markEdited/touch 这套合成 API 的锅」
const r3 = await round(3, { realTyping: true })
const r4 = await evictedRound()
const r4b = await evictedRound()

// 核心缺陷：⌘Z 撤销「重置全部」这一步，本身从来救不回文案
const coreStable = [r1, r2, r3].every(r =>
  r.othersBack && !r.textBack
  && r.rescued.stats.texts === 0
  && r.rescued.stats.total === r.before.stats.total - 1)
// 永久丢失只在「改文案那条历史不在栈里」时成立
const lossStable = [r4, r4b].every(r => r.lost)

console.log('\n────────────────────────────────')
console.log(coreStable
  ? `✘ 三轮都稳定复现（含真实键盘输入那轮）：⌘Z 撤销「重置全部」救回了属性/换图/删除/移动/评论，唯独文案没回来\n`
    + `   （页面停在「${r1.rescued.txt}」，texts ${r1.before.stats.texts} → ${r1.rescued.stats.texts}，`
    + `total ${r1.rescued.stats.total}/${r1.before.stats.total}）`
  : '✔ 核心现象未稳定复现')
console.log(r3.everBack
  ? `⚠ 但报告里「此后再也找不回来」说过头了：真实打字会留下一条独立的「改文案」历史，\n`
    + `   多按一次 ⌘Z 再 ⌘⇧Z 就能把文案捞回来（第 3 轮 [6]→[7]）`
  : '   报告的「再也找不回来」在真实打字流程下也成立')
console.log(lossStable
  ? `✘ 不过那条救命历史被 HISTORY_LIMIT=100 挤出栈后（第 4 轮，两次一致），文案就真的没了：\n`
    + `   ⌘Z 后停在「${r4.rescued.txt}」，texts=${r4.rescued.stats.texts}，一路 ⌘Z 到栈底也没再出现过`
  : '   历史被挤出栈的场景下文案仍能找回')
console.log('────────────────────────────────\n')

await browser.close(); await close()
