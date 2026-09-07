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

// ── 非文字元素：整个分区不出现 ──────────────────────────────
// 折叠不够：那些属性确实会继承给子元素，但用户改的是子元素的样子，
// 面板却说这是这个 div 的属性。Figma 里容器图层根本没有 Typography。
await page.locator('.swatch').first().click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)
ok(await section('typography').count() === 0,
   '选中非文字元素时整个 Typography 分区不渲染')
ok(await section('appearance').count() === 1, '其它分区不受影响，仍在')

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


// ── 字体是选出来的，不是敲出来的 ──────────────────────────
// font-family 是个后备栈。整串塞进输入框会被截断成
// 「Poppins, Poppins, "PingFang TC", "Micros…」——读到的反而是最不重要的
// 那截，而真正决定字形的是第一个。所以框里只列栈首那一个。
await page.evaluate(() => {
  document.getElementById('font-probe')?.remove()
  const p = document.createElement('p')
  p.id = 'font-probe'
  p.textContent = '测试 Test'
  p.style.cssText = 'font-family: Poppins, "PingFang TC", "Microsoft YaHei", sans-serif; font-size:16px'
  document.body.appendChild(p)
})
await page.locator('#font-probe').click()
await page.waitForTimeout(500)

const fontBox = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sel = sr.querySelector('vr-select[data-prop="font-family"]')
  return {
    isSelect: !!sel,
    stillInput: !!sr.querySelector('input[data-prop="font-family"]'),
    shown: sel?.getAttribute('value') || '',
    loadBtn: !!sr.querySelector('.load-fonts'),
  }
})
const probeCss = () => page.evaluate(() =>
  getComputedStyle(document.getElementById('font-probe')).fontFamily)

const before = await fontBox()
ok(before.isSelect && !before.stillInput, '字体是下拉框，不再是文本框')
ok(before.shown === 'Poppins', `框里只显示栈首那一个字体（${before.shown}）`)
ok(before.loadBtn, '读取本地字体的按钮还在')

await page.evaluate(() => {
  document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('vr-select[data-prop="font-family"]')
    .dispatchEvent(new CustomEvent('vr-select',
      { detail: { value: 'Georgia' }, bubbles: true, composed: true }))
})
await page.waitForTimeout(450)

ok((await fontBox()).shown === 'Georgia',
   '选完之后框里仍然只显示一个——同步时不能把整串塞回去')

// 字重/字号 与 行高/字距 是上下相邻的两行，分栏必须落在同一条竖线上，
// 否则扫下来是歪的。原来 .typo-pair 用 1fr 96px / gap 6，
// 而 .pair 用 1fr 1fr / gap 8，差出来的那几像素肉眼能看见。
const rowSplits = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sec = [...sr.querySelectorAll('section')]
    .find(s => s.querySelector('h3 .title')?.textContent.trim() === 'Typography')
  const edges = row => {
    const a = row.children[0].getBoundingClientRect()
    const b = row.children[1].getBoundingClientRect()
    return [Math.round(a.right), Math.round(b.left)]
  }
  return {
    ws: edges(sec.querySelector('.typo-pair')),
    lh: edges([...sec.querySelectorAll('.pair')].pop()),
  }
})
ok(rowSplits.ws[0] === rowSplits.lh[0] && rowSplits.ws[1] === rowSplits.lh[1],
   `字重/字号 与 行高/字距 的分栏对齐（${rowSplits.ws.join('→')} vs ${rowSplits.lh.join('→')}）`)

// 字体框要占满整行。从 .control 换成 vr-select 时，.with-action 的伸展
// 规则只认 .control，下拉框缩成了自身内容宽、右边空一大片。
const fontWidths = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const row = sr.querySelector('.with-action')
  const sel = row.querySelector('vr-select[data-prop="font-family"]')
  const btn = row.querySelector('.load-fonts')
  return {
    row: Math.round(row.getBoundingClientRect().width),
    sel: Math.round(sel.getBoundingClientRect().width),
    btn: Math.round(btn.getBoundingClientRect().width),
  }
})
ok(fontWidths.sel > fontWidths.row - fontWidths.btn - 16,
   `字体框撑满整行，只给右边的读取按钮让位（行 ${fontWidths.row} / 框 ${fontWidths.sel} / 按钮 ${fontWidths.btn}）`)

// 行高与字距的前缀是图标不是字符：「↕」和「AV」摆在框里认不出是什么
const iconPrefixes = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  return ['line-height', 'letter-spacing'].map(p => {
    const el = sr.querySelector(`.prefix[data-prop="${p}"], .field .control:has(input[data-prop="${p}"]) .prefix`)
    return { prop: p, isIcon: !!el?.classList.contains('is-icon'), hasSvg: !!el?.querySelector('svg') }
  })
})
ok(iconPrefixes.every(p => p.isIcon && p.hasSvg),
   `行高 / 字距的前缀是图标：${JSON.stringify(iconPrefixes)}`)

// 换字体只换栈首：直接写死一个名字会把中文后备字体一起丢掉，
// 英文看着没事，页面上的中文会掉回浏览器默认字形
const after = await probeCss()
ok(after.startsWith('Georgia') && /PingFang TC/.test(after) && /Microsoft YaHei/.test(after),
   `换字体只替换栈首，后备栈原样留着（${after}）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
