import { serve, launch, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[核心逻辑测试] 快照 / diff / 锚点 / 提示词\n')
await page.goto(origin)

const result = await page.evaluate(async (base) => {
  const { ChangeStore } = await import(`${base}/__app/core/change-store.js`)
  const { buildPrompt }  = await import(`${base}/__app/core/prompt-export.js`)
  const { collectAnchors } = await import(`${base}/__app/core/anchors.js`)

  const card  = document.querySelectorAll('.curve-card')[1]
  const title = document.querySelector('.hero-title')

  // 关键：先 track（快照），再改动
  ChangeStore.track(card)
  ChangeStore.track(title)

  ChangeStore.applyProp(card, 'padding-top', '24px')
  ChangeStore.applyProp(card, 'padding-right', '24px')
  ChangeStore.applyProp(card, 'padding-bottom', '24px')
  ChangeStore.applyProp(card, 'padding-left', '24px')
  ChangeStore.applyProp(card, 'border-radius', '12px')
  ChangeStore.applyProp(title, 'font-size', '56px')
  ChangeStore.addComment(card, '鼠标移入时增加悬浮效果，并让卡片变亮')

  const state = ChangeStore.read()
  return {
    anchors:   collectAnchors(card),
    stats:     ChangeStore.stats(),
    editCount: state.edits.length,
    cardChanges: state.edits.find(e => e.el === card)?.changes.map(c => `${c.prop}:${c.from}→${c.to}`),
    prompt:    buildPrompt(state, { url: 'http://example.test/page', viewport: '1440 × 900' }),
    // 验证撤销
    afterUndo: (() => {
      const id = state.edits.find(e => e.el === card).id
      ChangeStore.undoProp(id, 'border-radius')
      return getComputedStyle(card).borderRadius
    })(),
  }
}, origin)

ok(result.anchors.selector.includes('curve-card'), `选择器生成：${result.anchors.selector}`)
ok(result.anchors.text.some(t => t.includes('Thinking Five')),
   `文本特征采集：${JSON.stringify(result.anchors.text)}`)
ok(result.anchors.position.includes('第 2 个'), `位置描述：${result.anchors.position}`)
ok(result.editCount === 2, `改动元素数 = ${result.editCount}（期望 2）`)
ok(result.stats.props === 6, `改动属性数 = ${result.stats.props}（期望 6）`)
ok(result.stats.comments === 1, `评论数 = ${result.stats.comments}`)
ok(result.cardChanges.some(c => c.startsWith('padding-top:15px→24px')),
   `diff 原值取快照计算值：${result.cardChanges[0]}`)
ok(result.afterUndo === '18px', `单条撤销还原到原值：border-radius = ${result.afterUndo}`)

const p = result.prompt
ok(p.includes('# 页面视觉修改需求'), '提示词有标题')
ok(p.includes('| padding |') && p.includes('`15px`') && p.includes('`24px`'),
   'padding 四值合并为简写')
ok(p.includes('文本特征') && p.includes('Thinking Five'), '提示词含文本特征锚点')
ok(p.includes('## 交互备注') && p.includes('悬浮效果'), '提示词含交互备注')
ok(p.includes('优先用「文本特征」在代码库中搜索'), '提示词含给 AI 的定位建议')

console.log('\n───── 生成的提示词 ─────\n')
console.log(result.prompt)
console.log('───────────────────────\n')

await browser.close(); await close()
console.log(process.exitCode ? '结果：有失败项\n' : '结果：全部通过\n')
