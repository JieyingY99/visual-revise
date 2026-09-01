import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[Typography 分区测试] 文字元素判定 / 自动展开\n')
await page.goto(origin)
await injectVisBug(page, origin)

const section = id => page.locator(`visual-revise-panel section[data-group="${id}"]`)
const isFolded = id => section(id).evaluate(el => el.hasAttribute('folded'))

// ── 文字元素判定 ────────────────────────────────────────────
const verdicts = await page.evaluate(() => {
  const { isTextElement } = window.__visualRevise.lib
  const mk = html => {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    return host.firstElementChild
  }
  return {
    h2:        isTextElement(document.querySelector('.card-title')),
    span:      isTextElement(document.querySelector('.card-tag')),
    button:    isTextElement(document.querySelector('.btn')),
    swatch:    isTextElement(document.querySelector('.swatch')),
    article:   isTextElement(document.querySelector('.curve-card')),
    section:   isTextElement(document.querySelector('.cards')),
    inputText: isTextElement(mk('<input value="x">')),
    inputBare: isTextElement(mk('<input type="checkbox">')),
    textarea:  isTextElement(mk('<textarea>hi</textarea>')),
    editable:  isTextElement(mk('<div contenteditable="true"></div>')),
    img:       isTextElement(mk('<img alt="pic">')),
    nullish:   isTextElement(null),
  }
})

ok(verdicts.h2 && verdicts.span && verdicts.button,
   `直接包着文字的元素算文字元素（h2/span/button）`)
ok(!verdicts.swatch, '空 div 不算文字元素')
ok(!verdicts.article && !verdicts.section,
   '只包着子元素的容器不算——判据是「直接子节点有非空文本」，不是 textContent 非空')
ok(verdicts.inputText && verdicts.textarea && verdicts.editable,
   '文本输入控件与 contenteditable 算文字元素')
ok(!verdicts.inputBare, 'checkbox 不算（它没有文字可排版）')
ok(!verdicts.img, '<img> 不算（alt 不是排版对象）')
ok(!verdicts.nullish, 'null 安全返回 false')

// ── 默认折叠 ────────────────────────────────────────────────
await page.locator('.swatch').first().click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)
ok(await isFolded('typography'),
   '选中非文字元素时 Typography 默认折叠（不占视觉空间）')
ok(!await isFolded('appearance'), '其它分区不受影响，仍是展开的')

// ── 文字元素自动展开 ────────────────────────────────────────
await page.locator('.card-title').first().click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)
ok(!await isFolded('typography'), '选中文字元素时 Typography 自动展开')

const typoProps = await page.locator('visual-revise-panel section[data-group="typography"] [data-prop]')
  .evaluateAll(els => els.map(el => el.dataset.prop))
ok(typoProps.includes('font-size') && typoProps.includes('font-family'),
   `展开后字号/字体可直接改：${typoProps.join(', ')}`)
ok(!typoProps.includes('color'),
   'color 不在 Typography 里了（它归 Fill，跟随 Figma 的建模）')

// ── 手动折叠不被弹开 ────────────────────────────────────────
await page.locator('visual-revise-panel section[data-group="typography"] h3').click()
await page.waitForTimeout(300)
ok(await isFolded('typography'), '可以手动折叠')

// 同一元素上再触发一次渲染，不应把用户的折叠弹开
await page.evaluate(() => {
  const p = document.querySelector('visual-revise-panel')
  p.setTargets([document.querySelector('.card-title')])
})
await page.waitForTimeout(300)
ok(await isFolded('typography'),
   '同一元素重复选中不会把手动折叠弹开（自动展开只在目标变化时触发一次）')

// 换到另一个文字元素才重新展开
await page.locator('.card-body').first().click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)
ok(!await isFolded('typography'), '换到另一个文字元素时重新自动展开')

// ── 紧凑排布 ────────────────────────────────────────────────
const typoField = sel => page.locator(`visual-revise-panel section[data-group="typography"] ${sel}`)

ok(await typoField('.typo-pair').count() === 1,
   '字重与字号并排一行——Figma 的排版面板不给这两个配标签，内容本身就说明了是什么')

const labels = await typoField('label.name').evaluateAll(els => els.map(e => e.textContent.trim()))
ok(!labels.includes('字体') && !labels.includes('字号') && !labels.includes('字重'),
   `字体 / 字号 / 字重都不带标签：剩下的标签是 ${JSON.stringify(labels)}`)
ok(labels.includes('行高') && labels.includes('字距'),
   '行高与字距保留标签——光看数字认不出来是哪个')

ok(await typoField('.segment button[data-prop="text-align"]').count() === 4,
   '对齐是一排分段按钮，不是下拉')

// ── 更多排版设置 ────────────────────────────────────────────
ok(await typoField('[data-prop="text-transform"]').count() === 0,
   '大小写默认收起（用得少）')
await typoField('.typo-more').click()
await page.waitForTimeout(350)
ok(await typoField('vr-select[data-prop="text-transform"]').count() === 1, '展开「更多」后出现大小写')
ok(await typoField('vr-select[data-prop="text-decoration-line"]').count() === 1,
   '同时补上了装饰线——Figma 排版面板有这一项，此前项目里没有')

// 只数顶层行：.pair 里嵌着两个 .field，一起数会重复计入
const rowCount = await typoField('.rows > *').count()
ok(rowCount === 5,
   `整个分区连展开的「更多」在内共 ${rowCount} 行（改造前每属性一行，共 7 行且都带标签）`)

// ── 顺序仍然正确 ────────────────────────────────────────────
const ids = await page.locator('visual-revise-panel section')
  .evaluateAll(els => els.map(el => el.dataset.group))
ok(ids.indexOf('typography') === ids.indexOf('appearance') + 1,
   `Typography 紧跟 Appearance：${ids.join(' → ')}`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
