// 全量 e2e · 分块「Typography / Fill」——功能清单 docs/plans/feature-inventory.md
// §2.7（2.7.1–2.7.8 + 整块可见性）与 §2.8（2.8.1–2.8.14）。
//
// 断言以清单编号开头，每个编号至少一条。全部走真实交互（locator.click /
// page.mouse / page.keyboard）：这个仓库里 element.click() 那种程序化派发不触发
// pointer 事件链，层拖拽的守卫、弹层的外点关闭都测不到。
// 面板是滚动容器，点行之前先 scrollIntoViewIfNeeded。
// 弹层内容在 shadow root 里：`>` 不跨 shadow，一律用 [data-item] / [data-page] /
// [data-tab] 这类属性做后代选择。Esc 一次只关一层弹层，第二下才取消选中。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const T = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

console.log('\n[全量 e2e] Typography / Fill（§2.7、§2.8）\n')

await page.goto(origin)

// 变量与「样式表里的绑定」要在注入之前铺好：绑定判定读的是声明原文
await page.addStyleTag({ content:
  ':root{--vr-tone:#22cc88;--vr-tone2:#3355ff}'
  + '#t-var{background-color:var(--vr-tone)}' })

await page.evaluate(async () => {
  const paint = (w, h, color) => {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h)
    return c.toDataURL('image/png')
  }
  const PNG40 = paint(40, 20, '#44aaff')
  const PNG30 = paint(30, 15, '#ff5c8a')
  window.__testImages = { PNG40, PNG30 }

  const box = (id, css, html) => {
    const d = document.createElement('div')
    d.id = id
    d.style.cssText = `position:absolute;${css}`
    if (html !== undefined) d.innerHTML = html
    document.body.appendChild(d)
    return d
  }

  // 直接承载文字：Typography 与「文字色」都在
  box('t-text', 'left:24px;top:620px;width:240px;padding:12px;background:#333;color:#dddddd;'
    + 'font-family:Poppins, "PingFang TC", sans-serif;font-size:16px', '排版测试 Typography')
  // 只装着子元素的容器：没有直接文字
  box('t-plain', 'left:290px;top:620px;width:160px;height:90px;background:#444', '<span>子</span>')

  const img = document.createElement('img')
  img.id = 't-img'
  img.src = PNG40
  img.style.cssText = 'position:absolute;left:470px;top:620px;width:120px;height:60px;display:block'
  document.body.appendChild(img)
  await img.decode()

  const video = document.createElement('video')
  video.id = 't-video'
  video.setAttribute('poster', PNG30)
  video.style.cssText = 'position:absolute;left:620px;top:620px;width:120px;height:60px;display:block'
  document.body.appendChild(video)

  box('t-bg', `left:24px;top:730px;width:140px;height:70px;background-image:url("${PNG30}")`)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.id = 't-svg'
  svg.setAttribute('width', '120'); svg.setAttribute('height', '60')
  svg.style.cssText = 'position:absolute;left:190px;top:730px;display:block'
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  text.setAttribute('x', '8'); text.setAttribute('y', '30'); text.textContent = 'label'
  svg.appendChild(text)
  document.body.appendChild(svg)

  // 三层填充：url() 图 + 渐变 + 垫底纯色
  box('t-layers', 'left:330px;top:730px;width:140px;height:70px;background-color:#123456;'
    + `background-image:url("${PNG30}"), linear-gradient(#ff0000, #0000ff)`)

  // 样式表里带 !important 压不住的情况用 inline important 模拟：眼睛存原文要连 priority 一起存
  const imp = box('t-imp', 'left:490px;top:730px;width:140px;height:70px')
  imp.style.setProperty('background-color', 'rgb(255, 0, 0)', 'important')

  // 绑在 CSS 变量上的底色（声明写在样式表里）
  box('t-var', 'left:650px;top:730px;width:140px;height:70px')

  const swap = document.createElement('img')
  swap.id = 't-swap'
  swap.setAttribute('src', '/assets/hero-original.png')
  swap.setAttribute('srcset', '/assets/hero-original@2x.png 2x')
  swap.style.cssText = 'position:absolute;left:24px;top:830px;width:120px;height:60px;display:block'
  document.body.appendChild(swap)

  box('t-bgswap', 'left:190px;top:830px;width:140px;height:60px;'
    + 'background-image:url("/assets/bg-original.png")')
})

await injectVisBug(page, origin)
await page.waitForTimeout(400)

// ── 工具 ───────────────────────────────────────────────────
const P = sel => page.locator(`visual-revise-panel ${sel}`)
const TYPO = 'section[data-group="typography"]'
const FILL = 'section[data-group="fill"]'
const SELECTPOP = 'visual-revise-select-panel'
const FILLPOP = 'visual-revise-fill-panel'

const exists = id => page.evaluate(x => !!document.getElementById(x), id)
const inline = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i).style.getPropertyValue(p), [id, prop])
const priority = (id, prop) => page.evaluate(([i, p]) =>
  document.getElementById(i).style.getPropertyPriority(p), [id, prop])
const attrOf = (id, name) => page.evaluate(([i, a]) =>
  document.getElementById(i).getAttribute(a), [id, name])
const total = () => page.evaluate(() => window.__visualRevise.store.stats().total)

// 选中：先 Esc 清掉上一个选中，否则选中框的把手会拦住点击
const select = async (sel, pos = { x: 6, y: 6 }) => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  await page.locator(sel).first().click({ position: pos })
  await page.waitForTimeout(500)
}
const tap = async loc => {
  await loc.scrollIntoViewIfNeeded()
  await loc.click()
  await page.waitForTimeout(400)
}
// vr-select：点触发器开面板，再点面板里的那一项（面板挂 body，内容在 shadow 里）
const pickOption = async (scope, prop, value) => {
  await tap(P(`${scope} vr-select[data-prop="${prop}"]`))
  await tap(page.locator(`#${SELECTPOP} [data-item="${value}"]`))
}
const typeInto = async (scope, prop, value) => {
  const input = P(`${scope} input[data-prop="${prop}"]`).first()
  await input.scrollIntoViewIfNeeded()
  await input.fill(String(value))
  await input.press('Enter')
  await page.waitForTimeout(350)
}
const toast = () => page.evaluate(() => {
  const t = document.querySelector('visual-revise-panel').shadowRoot.querySelector('.toast')
  return { text: t?.textContent || '', show: !!t?.hasAttribute('data-show') }
})
const sections = () => P('section').evaluateAll(els => els.map(el => el.dataset.group))
// 分区里出现的属性（label 与控件都带 data-prop，会重复；vr-fill 那种复合值不算）
const propsIn = scope => P(`${scope} [data-prop]`)
  .evaluateAll(els => [...new Set(els.map(el => el.dataset.prop))].filter(p => !p.includes(',')))
const fillRowKinds = () => P(`${FILL} .field`).evaluateAll(els => els.map(el => {
  if (el.classList.contains('image-fill')) return `image:${el.dataset.imageKind}`
  if (el.querySelector('.layers')) return 'layers'
  return el.querySelector('[data-prop]')?.dataset.prop || '?'
}))
const layerRows = () => page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot
    .querySelectorAll('section[data-group="fill"] .layers .layer-row')].map(r => {
    const f = r.querySelector('vr-fill')
    return {
      color: f?.getAttribute('color') || '',
      image: f?.getAttribute('image') || '',
      bound: f?.getAttribute('bound') || null,
      off: r.classList.contains('off'),
      eye: !!r.querySelector('[data-layer-eye]'),
      del: !!r.querySelector('[data-layer-del]'),
      // 绑定态的 chip 由 vr-fill 自己渲染，在它的 shadow root 里
      chip: !!f?.shadowRoot?.querySelector('.var-chip'),
      unlink: !!r.querySelector('[data-unlink-layer]'),
    }
  }))

// ═══════════════ §2.7 Typography ═══════════════
console.log('── §2.7 整块可见性（#showTypography）')

await select('#t-img')
const imgSections = await sections()
T('2.7', !imgSections.includes('typography'),
  `[非文字元素隐藏] 选中 <img> 时整个 Typography 分区不渲染（${imgSections.join(' → ')}）`)

await select('#t-plain', { x: 140, y: 70 })
T('2.7', !(await sections()).includes('typography'),
  '只装着子元素的 div（没有直接文本子节点）同样不渲染 Typography')

await select('#t-svg')
T('2.7', (await sections()).includes('typography'),
  '内联 <svg> 单独放行——文字在子 <text> 里，但它确实继承 font-*')

// 兜底：本组已有 dirty 改动时照常渲染（折叠态）。必须排在「选中文字元素」之前，
// 自动展开是面板实例状态，选过一次文字元素后 typography 就不再是折叠态了
await page.evaluate(() => { document.getElementById('t-plain').style.fontSize = '22px' })
await select('#t-plain', { x: 140, y: 70 })
const dirtyGate = await page.evaluate(() => {
  const sec = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="typography"]')
  return { exists: !!sec, folded: sec?.hasAttribute('folded') ?? null }
})
T('2.7', dirtyGate.exists && dirtyGate.folded === true,
  `容器上已有 font-size 改动时，Typography 以折叠态兜底出现（${JSON.stringify(dirtyGate)}）`)
await tap(P(`${TYPO} .undo[data-undo="typography"]`))
T('2.7', await inline('t-plain', 'font-size') === ''
  && !(await sections()).includes('typography'),
  '重置本组后改动没了、兜底出现的分区也随之收回')

console.log('── 2.7.1 字体')
await select('#t-text')
T('2.7', (await sections()).includes('typography'),
  '直接承载文字的元素照常渲染 Typography')

const fontBox = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const sel = sr.querySelector('section[data-group="typography"] vr-select[data-prop="font-family"]')
  return {
    isSelect: !!sel,
    isInput: !!sr.querySelector('section[data-group="typography"] input[data-prop="font-family"]'),
    shown: sel?.getAttribute('value') || '',
    options: JSON.parse(sel?.getAttribute('options') || '[]'),
  }
})
const f0 = await fontBox()
T('2.7.1', f0.isSelect && !f0.isInput && f0.shown === 'Poppins',
  `字体是 vr-select，框里只显示栈首（${f0.shown}）`)
T('2.7.1', f0.options[0] === 'Poppins' && f0.options.includes('Georgia')
  && f0.options.includes('system-ui'),
  `选项 = 当前栈首 + COMMON_FONTS（共 ${f0.options.length} 项，前三：${f0.options.slice(0, 3).join(' / ')}）`)
T('2.7.1', (await P(`${TYPO} .field .with-action vr-select[data-prop="font-family"]`).count()) === 1,
  '字体独占一行（.with-action 里只跟一个读取本地字体的按钮）')

await pickOption(TYPO, 'font-family', 'Georgia')
const fam = await inline('t-text', 'font-family')
T('2.7.1', /^Georgia/.test(fam) && /PingFang TC/.test(fam) && /sans-serif/.test(fam),
  `选字体只替换栈首，后备原样保留（${fam}）`)
T('2.7.1', (await fontBox()).shown === 'Georgia', '写回后框里仍然只显示一个字体名')

console.log('── 2.7.2 读取本地字体')
// 真实的 queryLocalFonts 要用户授权，无头环境点不出授权框——把 API 换成可控替身，
// 三条分支（不支持 / 拒绝 / 成功）都能走真实点击
await page.evaluate(() => {
  Object.defineProperty(window, 'queryLocalFonts', { value: undefined, configurable: true, writable: true })
})
await select('#t-text')
T('2.7.2', (await P(`${TYPO} .load-fonts`).count()) === 0,
  'queryLocalFonts 不可用时不渲染「读取本地字体」按钮（fontsSupported 的门）')

await page.evaluate(() => {
  Object.defineProperty(window, 'queryLocalFonts', {
    configurable: true, writable: true,
    value: async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e },
  })
})
await select('#t-text')
T('2.7.2', (await P(`${TYPO} .load-fonts`).count()) === 1,
  'queryLocalFonts 可用时按钮出现')
await tap(P(`${TYPO} .load-fonts`))
const denied = await toast()
T('2.7.2', denied.show && /拒绝/.test(denied.text),
  `拒绝授权时 toast 说明原因：${denied.text}`)
T('2.7.2', !(await fontBox()).options.includes('Test Local Font A'),
  '失败时不往下拉里塞任何东西')

await page.evaluate(() => {
  Object.defineProperty(window, 'queryLocalFonts', {
    configurable: true, writable: true,
    value: async () => [{ family: 'Test Local Font A' }, { family: 'Test Local Font B' },
                        { family: 'Test Local Font A' }],
  })
})
await tap(P(`${TYPO} .load-fonts`))
const loaded = await toast()
const afterLoad = await fontBox()
T('2.7.2', loaded.show && /已读取 2 个本地字体/.test(loaded.text),
  `成功后 toast 报数（去重后 2 个）：${loaded.text}`)
T('2.7.2', afterLoad.options.includes('Test Local Font A')
  && afterLoad.options.includes('Test Local Font B')
  && afterLoad.options.indexOf('Test Local Font A') < afterLoad.options.indexOf('system-ui'),
  '读到的本地字体补进下拉，排在兜底的 COMMON_FONTS 之前')

console.log('── 2.7.3 字重 / 2.7.4 字号')
await pickOption(TYPO, 'font-weight', '700')
T('2.7.3', await inline('t-text', 'font-weight') === '700',
  `字重下拉写 font-weight，不补单位（${await inline('t-text', 'font-weight')}）`)
const weightOptions = await page.evaluate(() => JSON.parse(
  document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="typography"] vr-select[data-prop="font-weight"]')
    .getAttribute('options')))
T('2.7.3', weightOptions.length === 9 && weightOptions[0] === '100' && weightOptions[8] === '900',
  `字重下拉是 100…900 九档（${weightOptions.join('/')}）`)

await typeInto(TYPO, 'font-size', '28')
T('2.7.4', await inline('t-text', 'font-size') === '28px',
  `字号输入裸数字补 px（${await inline('t-text', 'font-size')}）`)
const sizePrefix = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const p = sr.querySelector('section[data-group="typography"] .prefix[data-prop="font-size"]')
  return { text: p?.textContent.trim(), drag: p?.hasAttribute('data-drag') }
})
T('2.7.4', sizePrefix.text === 'Aa' && sizePrefix.drag,
  `字号前缀是可拖的「Aa」（${JSON.stringify(sizePrefix)}）`)
// 前缀真实拖动：向右 40px → 步进 40
const pb = await P(`${TYPO} .prefix[data-prop="font-size"]`).boundingBox()
await page.mouse.move(pb.x + 4, pb.y + pb.height / 2)
await page.mouse.down()
await page.mouse.move(pb.x + 44, pb.y + pb.height / 2, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(350)
T('2.7.4', parseFloat(await inline('t-text', 'font-size')) > 28,
  `拖字号前缀能调值（28px → ${await inline('t-text', 'font-size')}）`)
const pairShape = await page.evaluate(() => {
  const sec = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="typography"]')
  const p = sec.querySelector('.typo-pair')
  return {
    weight: !!p?.querySelector('vr-select[data-prop="font-weight"]'),
    size: !!p?.querySelector('input[data-prop="font-size"]'),
  }
})
T('2.7.4', pairShape.weight && pairShape.size, '字重与字号并排在同一行（.typo-pair）')

console.log('── 2.7.5 行高 / 2.7.6 字距')
await typeInto(TYPO, 'line-height', '24')
T('2.7.5', await inline('t-text', 'line-height') === '24',
  `行高不补 px——24 是 24 倍行高，与 24px 语义不同（${await inline('t-text', 'line-height')}）`)
await typeInto(TYPO, 'line-height', '1.8')
T('2.7.5', await inline('t-text', 'line-height') === '1.8',
  `小数行高原样写入（${await inline('t-text', 'line-height')}）`)

await typeInto(TYPO, 'letter-spacing', '3')
T('2.7.6', await inline('t-text', 'letter-spacing') === '3px',
  `字距是长度，裸数字补 px（${await inline('t-text', 'letter-spacing')}）`)
const lhPair = await page.evaluate(() => {
  const sec = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="typography"]')
  const rows = [...sec.querySelectorAll('.pair')]
  const row = rows.find(r => r.querySelector('input[data-prop="line-height"]'))
  const labels = [...sec.querySelectorAll('label.name')].map(l => l.textContent.trim())
  return { paired: !!row?.querySelector('input[data-prop="letter-spacing"]'), labels }
})
T('2.7.6', lhPair.paired && lhPair.labels.includes('行高') && lhPair.labels.includes('字距'),
  `行高与字距并排且各带标签（标签：${lhPair.labels.join(' / ')}）`)

console.log('── 2.7.7 对齐')
const alignBtns = await P(`${TYPO} .segment button[data-prop="text-align"]`)
  .evaluateAll(els => els.map(e => e.dataset.value))
T('2.7.7', JSON.stringify(alignBtns) === JSON.stringify(['left', 'center', 'right', 'justify']),
  `对齐是四段按钮：${alignBtns.join(' / ')}`)
await tap(P(`${TYPO} .segment button[data-prop="text-align"][data-value="center"]`))
T('2.7.7', await inline('t-text', 'text-align') === 'center',
  `点「中」写 text-align（${await inline('t-text', 'text-align')}）`)
T('2.7.7', await page.evaluate(() => document.querySelector('visual-revise-panel').shadowRoot
  .querySelector('section[data-group="typography"] button[data-prop="text-align"][data-on]')?.dataset.value)
  === 'center', '选中态 data-on 落到「中」那一格')
await tap(P(`${TYPO} .segment button[data-prop="text-align"][data-value="justify"]`))
T('2.7.7', await inline('t-text', 'text-align') === 'justify',
  `再点「两端」写 justify（${await inline('t-text', 'text-align')}）`)

console.log('── 2.7.8 更多排版设置')
T('2.7.8', (await P(`${TYPO} vr-select[data-prop="text-transform"]`).count()) === 0,
  '大小写 / 装饰线默认收在「更多」里')
await tap(P(`${TYPO} .typo-more`))
T('2.7.8', (await P(`${TYPO} vr-select[data-prop="text-transform"]`).count()) === 1
  && (await P(`${TYPO} vr-select[data-prop="text-decoration-line"]`).count()) === 1,
  '点「更多」同时展开大小写与装饰线两个下拉')
await pickOption(TYPO, 'text-transform', 'uppercase')
T('2.7.8', await inline('t-text', 'text-transform') === 'uppercase',
  `大小写写 text-transform（${await inline('t-text', 'text-transform')}）`)
await pickOption(TYPO, 'text-decoration-line', 'underline')
T('2.7.8', await inline('t-text', 'text-decoration-line') === 'underline',
  `装饰线写 text-decoration-line（${await inline('t-text', 'text-decoration-line')}）`)
// #typoMore 不随元素重置：换一个文字元素回来，「更多」仍是展开的
await select('#t-svg')
await select('#t-text')
T('2.7.8', (await P(`${TYPO} vr-select[data-prop="text-transform"]`).count()) === 1,
  '「更多」的展开状态不随选中元素重置')
await tap(P(`${TYPO} .typo-more`))
T('2.7.8', (await P(`${TYPO} vr-select[data-prop="text-transform"]`).count()) === 0,
  '再点一次收起')

// ═══════════════ §2.8 Fill ═══════════════
console.log('\n── 2.8.1 图片预览行（三种 kind）')
await select('#t-img')
const imgRows = await fillRowKinds()
T('2.8.1', imgRows[0] === 'image:src',
  `[替换元素] <img> 的 Fill 首行是图片预览，kind=src（${imgRows.join(' | ')}）`)
const imgPreview = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const row = sr.querySelector('.image-fill')
  return {
    thumb: row.querySelector('.thumb img')?.getAttribute('src') || '',
    name: row.querySelector('.image-name')?.textContent.trim() || '',
    dim: row.querySelector('.image-dim')?.textContent.trim() || '',
    swap: !!row.querySelector('.swap-image'),
    label: row.querySelector('label.name')?.textContent.trim(),
    real: document.getElementById('t-img').currentSrc,
  }
})
T('2.8.1', imgPreview.thumb === imgPreview.real && imgPreview.swap,
  '左边缩略图就是页面上正在显示的那张图，右边是换图按钮')
T('2.8.1', imgPreview.dim === '40 × 20' && imgPreview.name.includes('内嵌图片'),
  `显示天然尺寸与文件名而不是整段 base64（${imgPreview.dim} · ${imgPreview.name}）`)
T('2.8.1', imgPreview.label === '图片', `kind=src 的标签是「图片」（${imgPreview.label}）`)

await select('#t-video')
const videoRow = await page.evaluate(() => {
  const row = document.querySelector('visual-revise-panel').shadowRoot.querySelector('.image-fill')
  return { kind: row?.dataset.imageKind, label: row?.querySelector('label.name')?.textContent.trim() }
})
T('2.8.1', videoRow.kind === 'poster' && videoRow.label === '封面图',
  `<video poster> 的 kind 是 poster，标签「封面图」（${JSON.stringify(videoRow)}）`)

await select('#t-bg')
const bgRow0 = await fillRowKinds()
await page.waitForTimeout(500)   // 背景图的天然尺寸是异步量的
const bgDim = await P('.image-fill .image-dim').textContent()
T('2.8.1', bgRow0[0] === 'image:background',
  `[有背景图] 的普通 div 同样出预览行，kind=background（${bgRow0.join(' | ')}）`)
T('2.8.1', bgDim.trim() === '30 × 15',
  `背景图的天然尺寸异步补齐（CSS 不暴露，要另加载一次来量）：${bgDim.trim()}`)

await select('#t-plain', { x: 140, y: 70 })
T('2.8.1', !(await fillRowKinds()).some(r => r.startsWith('image:')),
  '既不是替换元素、也没有背景图时不出预览行')

console.log('── 2.8.2 换图')
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64')
let nextFile = { name: 'new-hero.png', mimeType: 'image/png', buffer: PNG_1x1 }
page.on('filechooser', async chooser => { await chooser.setFiles(nextFile) })

await select('#t-swap')
T('2.8.2', (await P('.swap-image').count()) === 1, '图片元素的 Fill 分区有换图按钮')
await tap(P('.swap-image'))
await page.waitForTimeout(700)
const swapped = { src: await attrOf('t-swap', 'src'), srcset: await attrOf('t-swap', 'srcset') }
T('2.8.2', swapped.src.startsWith('data:image/png'),
  '<img> 换图写 src 属性，存的是 dataUrl 而不是 blob URL')
T('2.8.2', !swapped.srcset,
  'srcset 被一并清掉——它的优先级高于 src，留着新图根本不会显示')
const swapToast = await toast()
T('2.8.2', swapToast.show && /已换图：new-hero\.png/.test(swapToast.text),
  `toast 报出新图文件名：${swapToast.text}`)

await select('#t-bgswap')
await tap(P('.swap-image'))
await page.waitForTimeout(700)
T('2.8.2', (await inline('t-bgswap', 'background-image')).includes('data:image/png'),
  `背景图走 CSS 通道，写进 background-image（${(await inline('t-bgswap', 'background-image')).slice(0, 30)}…）`)

// 单张上限 5MB：超了只 toast 原因，不动元素
nextFile = { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }
const beforeHuge = await inline('t-bgswap', 'background-image')
await tap(P('.swap-image'))
await page.waitForTimeout(700)
const hugeToast = await toast()
T('2.8.2', /过大/.test(hugeToast.text) && await inline('t-bgswap', 'background-image') === beforeHuge,
  `超过 5MB 的图被拒且画面不动：${hugeToast.text}`)
nextFile = { name: 'new-hero.png', mimeType: 'image/png', buffer: PNG_1x1 }

console.log('── 2.8.3 / 2.8.3a 文字色行')
await select('#t-text')
const textRows = await fillRowKinds()
const textColorRow = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const field = [...sr.querySelectorAll('section[data-group="fill"] .field')]
    .find(f => f.querySelector('label.name')?.textContent.trim() === '文字色')
  return {
    label: !!field,
    color: !!field?.querySelector('vr-color[data-prop="color"]'),
    eye: !!field?.querySelector('[data-text-eye]'),
    del: !!field?.querySelector('[data-layer-del]'),
    // 层列表不是 .field，位置关系直接问 DOM
    beforeLayers: !!(field && sr.querySelector('section[data-group="fill"] .layers')
      && field.compareDocumentPosition(sr.querySelector('section[data-group="fill"] .layers'))
         & Node.DOCUMENT_POSITION_FOLLOWING),
  }
})
T('2.8.3', textRows[0] === 'color' && textColorRow.color && textColorRow.eye,
  `文字元素的 Fill 首行是「文字色」= vr-color + 眼睛（${textRows.join(' | ')}）`)
T('2.8.3', !textColorRow.del,
  '文字色行没有减号——color 是独立属性，删不掉')
T('2.8.3', textColorRow.beforeLayers, '文字色行排在层列表之前')

await select('#t-plain', { x: 140, y: 70 })
T('2.8.3a', !(await propsIn(FILL)).includes('color'),
  `没有直接文字的 div 连「文字色」那一格都不给：${(await propsIn(FILL)).join(', ')}`)
await select('#t-img')
T('2.8.3a', !(await propsIn(FILL)).includes('color'),
  '[替换元素] 上同样没有文字色（isReplacedElement 拦住）')

console.log('── 2.8.4 文字色眼睛')
await select('#t-text')
const baseTotal = await total()
const colorBefore = await inline('t-text', 'color')
await tap(P(`${FILL} [data-text-eye]`))
const hidden = {
  color: await inline('t-text', 'color'),
  title: await P(`${FILL} [data-text-eye]`).getAttribute('title'),
  off: await page.evaluate(() => !!document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('section[data-group="fill"] .layer-row.off')),
}
T('2.8.4', hidden.color === 'transparent' && hidden.title === '显示文字',
  `关掉时写 color:transparent，按钮 label 变「显示文字」（${JSON.stringify(hidden)}）`)
await tap(P(`${FILL} [data-text-eye]`))
const shown = {
  color: await inline('t-text', 'color'),
  title: await P(`${FILL} [data-text-eye]`).getAttribute('title'),
  total: await total(),
}
T('2.8.4', shown.color === colorBefore && shown.title === '隐藏文字',
  `再开原样放回 inline 原文（${JSON.stringify(colorBefore)} → ${JSON.stringify(shown.color)}）`)
T('2.8.4', shown.total === baseTotal,
  `一开一关不留改动记录（${baseTotal} → ${shown.total}）`)

console.log('── 2.8.5 填充层列表 / 2.8.6 每层眼睛 / 2.8.7 减号')
await select('#t-layers', { x: 120, y: 60 })
const rows0 = await layerRows()
T('2.8.5', rows0.length === 3,
  `url() 图 + 渐变 + 垫底纯色 = 三层，每层一行（${rows0.map(r => r.image === 'none' ? 'solid' : r.image.slice(0, 14)).join(' | ')}）`)
T('2.8.5', rows0.every(r => r.eye && r.del),
  '每一行都是 vr-fill + 眼睛 + 减号')
T('2.8.5', rows0[0].image.startsWith('url(') && /gradient/.test(rows0[1].image)
  && rows0[2].image === 'none' && rows0[2].color.includes('18, 52, 86'),
  `层序 = CSS 里第一层画在最上面，background-color 垫底（${rows0[2].color}）`)
await tap(P(`${FILL} .add[data-add="fill"]`))
const rowsAdd = await layerRows()
T('2.8.5', rowsAdd.length === 4 && rowsAdd[0].color === 'rgb(196, 196, 196)',
  `加号在最上面添一层默认中性灰 #c4c4c4（${rowsAdd[0].color}）`)
await tap(P(`${FILL} [data-layer-del="0"]`))
T('2.8.5', (await layerRows()).length === 3, '减掉刚加的那层，回到三层')

// 眼睛：关掉的层从 CSS 里消失，行还在（.off），再开原样回来
await tap(P(`${FILL} [data-layer-eye="0"]`))
const eyeOff = {
  rows: await layerRows(),
  image: await inline('t-layers', 'background-image'),
  title: await P(`${FILL} [data-layer-eye="0"]`).getAttribute('title'),
}
T('2.8.6', eyeOff.rows.length === 3 && eyeOff.rows[0].off && !eyeOff.image.includes('url(')
  && eyeOff.title === '显示这一层',
  `关掉第一层：CSS 里没了、行还留着并置灰（${eyeOff.image.slice(0, 40)}…）`)
await tap(P(`${FILL} [data-layer-eye="0"]`))
const eyeOn = await layerRows()
T('2.8.6', eyeOn.length === 3 && !eyeOn[0].off && eyeOn[0].image.startsWith('url('),
  `再开原样放回，列表没有凭空多出一行（${eyeOn.length} 行）`)

// 存原文要连 priority 一起存
await select('#t-imp', { x: 120, y: 60 })
T('2.8.6', await priority('t-imp', 'background-color') === 'important',
  '基线：#t-imp 的 background-color 带 !important')
await tap(P(`${FILL} [data-layer-eye="0"]`))
T('2.8.6', await inline('t-imp', 'background-color') === 'transparent',
  '关掉带 important 的那层')
await tap(P(`${FILL} [data-layer-eye="0"]`))
T('2.8.6', await inline('t-imp', 'background-color') === 'rgb(255, 0, 0)'
  && await priority('t-imp', 'background-color') === 'important',
  `再开时值与 priority 一起放回（${await inline('t-imp', 'background-color')} / ${await priority('t-imp', 'background-color')}）`)

// 关掉之后动过别的：原文过期，按当前层列表重写，那一层照样得回来
await select('#t-layers', { x: 120, y: 60 })
await tap(P(`${FILL} [data-layer-eye="0"]`))
const otherText = P(`${FILL} .layers .layer-row`).nth(2).locator('vr-fill').locator('.text')
await otherText.scrollIntoViewIfNeeded()
await otherText.fill('#00ff00'); await otherText.press('Enter')
await page.waitForTimeout(450)
const editedColor = await inline('t-layers', 'background-color')
await tap(P(`${FILL} [data-layer-eye="0"]`))
const revived = await layerRows()
const revivedColor = await inline('t-layers', 'background-color')
T('2.8.6', revived.length === 3 && revived[0].image.startsWith('url('),
  '中途改过别的层之后，被藏的那一层再点眼睛照样回得来')
// 清单：「再开若『关掉之后没动过别的』就原样放回…否则按当前层列表重写」。
// 这里中途把底色改成了 #00ff00，放回的应该是当前列表，而不是关灯那一刻的旧原文
T('2.8.6', revivedColor.includes('0, 255, 0'),
  `中途改过别的层时按当前层列表重写，那次改色不该被回滚（改后 ${editedColor} → 再开 ${revivedColor}）`)

await tap(P(`${FILL} [data-layer-del="1"]`))
const afterDel = await layerRows()
T('2.8.7', afterDel.length === 2 && !afterDel.some(r => /gradient/.test(r.image) && !r.image.includes('rgb'))
  && !(await inline('t-layers', 'background-image')).includes('0, 0, 255'),
  `减号 splice 掉那一层并整体写回（剩 ${afterDel.length} 层，蓝色渐变没了）`)

console.log('── 2.8.8 层拖拽排序')
await page.evaluate(() => {
  const el = document.getElementById('t-layers')
  el.style.backgroundColor = '#123456'
  el.style.backgroundImage = `url("${window.__testImages.PNG30}"), linear-gradient(#ff0000, #0000ff)`
})
await select('#t-layers', { x: 120, y: 60 })
const rowBox = async i => {
  const row = P(`${FILL} [data-fill-row="${i}"]`)
  await row.scrollIntoViewIfNeeded()
  return row.boundingBox()
}
const dragTo = async (from, to, { grabX = 120, slop = 10, peek = false } = {}) => {
  const a = await rowBox(from), b = await rowBox(to)
  await page.mouse.move(a.x + grabX, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + grabX, a.y + a.height / 2 + slop, { steps: 3 })
  await page.mouse.move(b.x + grabX, b.y + b.height / 2, { steps: 8 })
  let drop = null
  if (peek) drop = await page.evaluate(() => {
    const sr = document.querySelector('visual-revise-panel').shadowRoot
    return {
      drop: sr.querySelector('section[data-group="fill"] [data-drop]')?.getAttribute('data-fill-row') ?? null,
      dragging: sr.querySelector('section[data-group="fill"] [data-dragging]')?.getAttribute('data-fill-row') ?? null,
    }
  })
  await page.mouse.up()
  await page.waitForTimeout(500)
  return drop
}

const kinds = async () => (await layerRows()).map(r => r.image === 'none' ? 'solid'
  : r.image.startsWith('url(') ? 'image' : 'gradient')
const before = await kinds()
const peeked = await dragTo(0, 1, { peek: true })
const afterDrag = await kinds()
T('2.8.8', JSON.stringify(before) === JSON.stringify(['image', 'gradient', 'solid'])
  && JSON.stringify(afterDrag) === JSON.stringify(['gradient', 'image', 'solid']),
  `按住行拖到下一行，松手后两层换位（${before.join('>')} → ${afterDrag.join('>')}）`)
T('2.8.8', peeked && peeked.drop === '1' && peeked.dragging === '0',
  `拖动过程中源行 data-dragging、hover 的行 data-drop（${JSON.stringify(peeked)}）`)
T('2.8.8', (await inline('t-layers', 'background-image')).indexOf('gradient')
  < (await inline('t-layers', 'background-image')).indexOf('url('),
  '写回的 background-image 顺序跟着换')

// 越过 4px 才捕获：整个手势只挪 2px，全程不该进入拖拽。
// 抓在 vr-fill 右边那道行间隙上——按在色块上松手是要开填充弹层，不是重排
const gripX = async i => {
  const f = await P(`${FILL} [data-fill-row="${i}"] vr-fill`).boundingBox()
  const r = await rowBox(i)
  return f.x + f.width + 3 - r.x
}
const grip0 = await gripX(0)
const r0 = await rowBox(0)
await page.mouse.move(r0.x + grip0, r0.y + r0.height / 2)
await page.mouse.down()
await page.mouse.move(r0.x + grip0, r0.y + r0.height / 2 + 2, { steps: 2 })
const midTiny = await page.evaluate(() => !!document.querySelector('visual-revise-panel')
  .shadowRoot.querySelector('section[data-group="fill"] [data-dragging]'))
await page.mouse.up()
await page.waitForTimeout(400)
const afterTiny = await kinds()
T('2.8.8', !midTiny && JSON.stringify(afterTiny) === JSON.stringify(afterDrag),
  `位移不到 4px 不进入拖拽态、顺序不变（data-dragging=${midTiny} / ${afterTiny.join('>')}）`)

// 按在 .icon-btn（眼睛）上不起拖
const eyeBox = await P(`${FILL} [data-layer-eye="0"]`).boundingBox()
const rowB = await rowBox(1)
await page.mouse.move(eyeBox.x + eyeBox.width / 2, eyeBox.y + eyeBox.height / 2)
await page.mouse.down()
await page.mouse.move(eyeBox.x + eyeBox.width / 2, rowB.y + rowB.height / 2, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(500)
const afterBtnDrag = await kinds()
T('2.8.8', JSON.stringify(afterBtnDrag) === JSON.stringify(afterDrag),
  `按在眼睛上拖不重排（顺序仍是 ${afterBtnDrag.join('>')}）`)

console.log('── 2.8.9 每一层纯色都能绑变量')
await select('#t-var', { x: 120, y: 60 })
const varRows = await layerRows()
T('2.8.9', varRows.length === 1 && varRows[0].bound === '--vr-tone' && varRows[0].chip,
  `样式表里 background-color: var(--vr-tone) 被认出来，行渲染成 chip（bound=${varRows[0]?.bound}）`)
T('2.8.9', varRows[0].unlink && varRows[0].eye && varRows[0].del,
  '绑定行 = chip + 断开 + 眼睛 + 减号')
await tap(P(`${FILL} .add[data-add="fill"]`))
const afterAdd = await layerRows()
T('2.8.9', afterAdd.length === 2 && afterAdd[1].bound === '--vr-tone'
  && await inline('t-var', 'background-color') === 'var(--vr-tone)',
  `加一层之后底层仍写 var()，绑定没被解析色抹掉（${await inline('t-var', 'background-color')}）`)

await tap(P(`${FILL} [data-fill-row="0"] vr-fill .swatch`))
await tap(page.locator(`#${FILLPOP} [data-page="variable"]`))
await tap(page.locator(`#${FILLPOP} [data-item="--vr-tone2"]`))
const upperImage = await inline('t-var', 'background-image')
T('2.8.9', /linear-gradient\(var\(--vr-tone2\), var\(--vr-tone2\)\)/.test(upperImage),
  `上层纯色绑变量写成 linear-gradient(var, var)——颜色进不了 image 那一栏（${upperImage}）`)
// 选完变量弹层自己就关了，这里不能再补 Esc：没有弹层时那一下会取消选中、连面板一起收掉
T('2.8.9', !(await exists(FILLPOP)), '选中一项后填充弹层自己关掉')
await tap(P(`${FILL} [data-unlink-layer="0"]`))
const afterUnlink = {
  image: await inline('t-var', 'background-image'),
  color: await inline('t-var', 'background-color'),
}
T('2.8.9', !/var\(/.test(afterUnlink.image) && afterUnlink.color === 'var(--vr-tone)',
  `#unlinkLayer 只清这一层，另一层的绑定不受牵连（${afterUnlink.image.slice(0, 40)}… / ${afterUnlink.color}）`)

console.log('── 2.8.10 背景尺寸 / 2.8.11 背景位置')
await select('#t-bg')
const bgProps = await propsIn(FILL)
T('2.8.10', bgProps.includes('background-size'), '[有背景图] 时才出现背景尺寸')
await pickOption(FILL, 'background-size', 'cover')
T('2.8.10', await inline('t-bg', 'background-size') === 'cover',
  `背景尺寸下拉写 background-size（${await inline('t-bg', 'background-size')}）`)
await pickOption(FILL, 'background-size', 'contain')
T('2.8.10', await inline('t-bg', 'background-size') === 'contain',
  `三个选项都能写（${await inline('t-bg', 'background-size')}）`)
await typeInto(FILL, 'background-position', 'right bottom')
T('2.8.11', await inline('t-bg', 'background-position') === 'right bottom',
  `背景位置是自由文本输入（${await inline('t-bg', 'background-position')}）`)
await select('#t-plain', { x: 140, y: 70 })
T('2.8.10', !(await propsIn(FILL)).includes('background-size')
  && !(await propsIn(FILL)).includes('background-position'),
  '没有背景图的元素上这两格都不渲染')

console.log('── 2.8.12 图片适配 / 2.8.13 图片位置')
await select('#t-img')
await pickOption(FILL, 'object-fit', 'cover')
T('2.8.12', await inline('t-img', 'object-fit') === 'cover',
  `[替换元素] 上的图片适配写 object-fit（${await inline('t-img', 'object-fit')}）`)
await pickOption(FILL, 'object-fit', 'scale-down')
T('2.8.12', await inline('t-img', 'object-fit') === 'scale-down',
  `五个选项都能写（${await inline('t-img', 'object-fit')}）`)
await typeInto(FILL, 'object-position', '25% 75%')
T('2.8.13', await inline('t-img', 'object-position') === '25% 75%',
  `图片位置是自由文本输入，原样写进 object-position（${await inline('t-img', 'object-position')}）`)
await typeInto(FILL, 'object-position', 'right bottom')
T('2.8.13', /right bottom|bottom right/.test(await inline('t-img', 'object-position')),
  `关键字写法同样写得进去（${await inline('t-img', 'object-position')}）`)
await select('#t-bg')
T('2.8.12', !(await propsIn(FILL)).includes('object-fit')
  && !(await propsIn(FILL)).includes('object-position'),
  '普通 div 上不出现这两格（它没有自身内容可适配）')

console.log('── 2.8.14 background-image 不再单独给文本框')
const noBgInput = await page.evaluate(() => !!document.querySelector('visual-revise-panel')
  .shadowRoot.querySelector('input[data-prop="background-image"]'))
T('2.8.14', !noBgInput, '有背景图的元素上也没有 background-image 的文本框')
const tracked = await page.evaluate(() => {
  const { edits } = window.__visualRevise.store.read()
  return edits.flatMap(e => (e.changes || []).map(c => c.prop))
})
T('2.8.14', tracked.includes('background-image'),
  `但仍在跟踪：改动记录里有 background-image（共 ${tracked.length} 条属性改动）`)
const prompt = await page.evaluate(() =>
  window.__visualRevise.lib.buildPrompt(window.__visualRevise.store.read()))
T('2.8.14', prompt.includes('background-image'), '导出的提示词里也带着这条属性')

await browser.close(); await close()
console.log(`\n结果：通过 ${passed} / 失败 ${failed}\n`)
