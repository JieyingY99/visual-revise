// 全量 e2e · 分块「导出 / 评论 / 参考图 / 其它」
// 覆盖 docs/plans/feature-inventory.md 的 §6 全部 + §7 全部。
//
// 断言以清单编号开头，落点一律是真实结果：元素 inline style / DOM 结构 /
// window.__visualRevise.store 里的改动记录 / 提示词正文 / 面板 DOM / toast 文案。
// 交互全部走真实指针与键盘；弹层内容在 shadow root 里，用后代选择器穿过去。
import { serve, launch, injectVisBug, ok } from '../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const t = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id} ${msg}`) }
const skip = (id, why) => console.log(`  – ${id} not_testable：${why}`)

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

// 1×1 PNG，当作用户挑的图
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG = Buffer.from(B64, 'base64')
// 换图与「大图预览」要用**内容不同**的图：资产是按 dataUrl 反查的，
// 两张字节完全相同的图会指到同一条记录上。SVG 还能自带 400×300 的天然尺寸。
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">'
  + '<rect width="400" height="300" fill="#4f46e5"/></svg>'
const SVG = Buffer.from(SVG_TEXT)
const SVG_B64 = SVG.toString('base64')

// ── 通用定位 / 工具 ─────────────────────────────────────────
const P = sel => page.locator(`visual-revise-panel ${sel}`)
const LIST = sel => page.locator(`visual-revise-list ${sel}`)
const CM = sel => page.locator(`visual-revise-comment-layer ${sel}`)

const toast = () => page.evaluate(() => {
  const el = document.getElementById('visual-revise-toast')
  if (!el) return { text: '', color: '', shown: false }
  return { text: el.textContent || '', color: el.style.color, shown: el.style.opacity === '1' }
})
const clearToast = () => page.evaluate(() => {
  const el = document.getElementById('visual-revise-toast')
  if (el) { el.textContent = ''; el.style.opacity = '0' }
})
const ERR_COLOR = 'rgb(255, 143, 143)'

const panelToast = () => page.evaluate(() => {
  const el = document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector('.toast')
  return el && el.hasAttribute('data-show') ? el.textContent || '' : ''
})

// 共享开关是个 toggle，跨用例会留状态；按 data-on 判一次再点
const ensureShared = async on => {
  const isOn = await page.evaluate(() => !!document.querySelector('visual-revise-panel')
    .shadowRoot.querySelector('.shared')?.hasAttribute('data-on'))
  if (isOn === on) return
  await page.locator('visual-revise-panel .shared').click()
  await page.waitForTimeout(350)
}

const stats = () => page.evaluate(() => window.__visualRevise.store.stats())
const blurAll = () => page.evaluate(() => {
  let a = document.activeElement
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
  a?.blur?.()
})

const reset = async () => {
  await page.evaluate(() => {
    const vr = window.__visualRevise
    vr.comments.cancelDraft?.()
    vr.setMode('select')
    vr.store.undoEverything()
    document.querySelector('visual-revise-list').hidden = true
  })
  await blurAll()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await clearToast()
}

// filechooser 是一次性的：留着上一条监听会把后面的选择也吃掉
const nextFiles = files => {
  page.removeAllListeners('filechooser')
  page.on('filechooser', async c => { try { await c.setFiles(files) } catch { /* 已关闭 */ } })
}

const select = async sel => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
  await page.locator(sel).first().click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(400)
}

// 面板数字框：真实 fill + Enter（Enter 才触发 change）
const writeField = async (prop, value) => {
  const input = P(`input[data-prop="${prop}"]`).first()
  await input.scrollIntoViewIfNeeded()
  await input.fill(String(value))
  await input.press('Enter')
  await page.waitForTimeout(280)
}
const writePair = async (pair, value) => {
  const input = P(`input[data-pair="${pair}"]`).first()
  await input.scrollIntoViewIfNeeded()
  await input.fill(String(value))
  await input.press('Enter')
  await page.waitForTimeout(280)
}

// 提示词：拿真实 state，配一份「已落盘」的 refs（真实链路里由 copyPrompt 填）
const buildPrompt = (refsExact = true, dir = '/tmp/vr-refs') => page.evaluate(([exact, d]) => {
  const { buildPrompt } = window.__visualRevise.lib
  const store = window.__visualRevise.store
  const files = store.allAssets().map((a, i) => ({
    id: a.id, name: a.name, path: `${d}/${String(i + 1).padStart(2, '0')}-${a.name}`,
  }))
  return buildPrompt(store.read(), { url: 'http://test.local/page', viewport: '1440 × 900' },
    files.length ? { exact, dir: d, files } : null)
}, [refsExact, dir])

const openList = async () => {
  if (!await page.evaluate(() => document.querySelector('visual-revise-list').hidden)) return
  await blurAll()
  await page.keyboard.press('l')
  await page.waitForTimeout(350)
}

console.log('\n[全量 e2e] 导出 / 评论 / 参考图 / 其它（清单 §6 + §7）\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
await page.waitForTimeout(300)

// 落盘走页面通道时会真的触发下载，收掉免得堆积
page.on('download', d => { d.delete().catch(() => {}) })

// ══════════════════════════════════════════════════════════════
console.log('── 6.1 复制提示词')
// ══════════════════════════════════════════════════════════════
await reset()

// 6.1.1 无改动
await blurAll()
await page.keyboard.press('p')
await page.waitForTimeout(400)
let tst = await toast()
t('6.1.1', tst.text === '还没有任何改动' && tst.shown,
  `无改动按 P：toast「${tst.text}」`)
t('6.1.1', tst.color === ERR_COLOR, `该 toast 是 error 型（color=${tst.color}）`)

// ── 攒一份「什么都有」的改动：样式 / 简写 / important / 文案 / 换图 / 移动 / 删除 / 评论带图
await select('.curve-card')
await writeField('border-radius', '20')
t('6.1.2', await page.evaluate(() =>
  document.querySelector('.curve-card').style.borderRadius) === '20px',
  '面板写入落到 inline style（border-radius: 20px）')

// 6.1.2 正常剪贴板通道
await clearToast()
await blurAll()
await page.keyboard.press('p')
await page.waitForTimeout(700)
tst = await toast()
t('6.1.2', /^已复制 \d+ 项改动到剪贴板$/.test(tst.text), `成功文案：「${tst.text}」`)
const clip = await page.evaluate(async () => {
  try { return await navigator.clipboard.readText() } catch (e) { return `ERR:${e.message}` }
})
t('6.1.2', clip.startsWith('# 页面视觉修改需求'),
  `剪贴板里确实是提示词正文（${clip.slice(0, 24).replace(/\n/g, ' ')}…）`)

// 6.1.2 剪贴板 API 失败 → execCommand 兜底，仍然成功
await page.evaluate(() => {
  window.__vrRealWrite = navigator.clipboard.writeText.bind(navigator.clipboard)
  navigator.clipboard.writeText = () => Promise.reject(new Error('denied'))
})
await clearToast()
await blurAll()
await page.keyboard.press('p')
await page.waitForTimeout(700)
tst = await toast()
t('6.1.2', tst.text.startsWith('已复制'),
  `clipboard.writeText 抛错时回退 execCommand，仍报成功：「${tst.text}」`)

// 6.1.2 两条路都断 → 报错文案
await page.evaluate(() => {
  window.__vrRealExec = document.execCommand.bind(document)
  document.execCommand = () => false
})
await clearToast()
await blurAll()
await page.keyboard.press('p')
await page.waitForTimeout(700)
tst = await toast()
t('6.1.2', tst.text === '复制失败，请检查剪贴板权限' && tst.color === ERR_COLOR,
  `两条通道都失败时报错：「${tst.text}」`)
await page.evaluate(() => {
  navigator.clipboard.writeText = window.__vrRealWrite
  document.execCommand = window.__vrRealExec
})

// ── 6.1.3 各分区 ──
// 简写折叠：四边相同 → 一行 padding
await writePair('padding:horizontal', '10')
await writePair('padding:vertical', '10')
let prompt = await buildPrompt()
t('6.1.3', /\|\s*padding\s*\|\s*`15px`\s*\|\s*`10px`\s*\|/.test(prompt),
  'padding 四边同值折叠成一条 padding 声明')
t('6.1.3', !/padding-top/.test(prompt), '折叠后不再逐条列出 padding-top/right/bottom/left')

// 四边不同 → 折叠成简写并标注「上 右 下 左」
await writePair('padding:vertical', '20')
prompt = await buildPrompt()
t('6.1.3', /\|\s*padding\s*<sub>上 右 下 左<\/sub>/.test(prompt),
  '四边不等时折叠成简写并注明「上 右 下 左」')
t('6.1.3', /`20px 10px 20px 10px`/.test(prompt),
  `简写按 上/右/下/左 顺序拼值（${(prompt.match(/`20px[^`]*`/) || [''])[0]}）`)

// !important：样式表里带 important 的属性，面板写入也带，导出时拼回值里
await page.evaluate(() => {
  const s = document.createElement('style')
  s.id = 'vr-imp-sheet'
  s.textContent = '#vr-imp { opacity: 0.3 !important; }'
  document.head.appendChild(s)
  const d = document.createElement('div')
  d.id = 'vr-imp'
  d.style.cssText = 'position:absolute;left:20px;top:520px;width:120px;height:40px;background:#345'
  d.textContent = '重要元素'
  document.body.appendChild(d)
})
await select('#vr-imp')
await writeField('opacity', '60')   // 面板里是百分比
t('6.1.3', await page.evaluate(() =>
  document.getElementById('vr-imp').style.getPropertyPriority('opacity')) === 'important',
  '样式表里带 !important 时，面板写入也带 important')
prompt = await buildPrompt()
t('6.1.3', /`0\.6 !important`/.test(prompt),
  '提示词的新值一栏拼回 !important 后缀（AI 拿到的是可直接抄的声明）')
t('6.1.3', !/!important/.test(JSON.stringify(await page.evaluate(() =>
  window.__visualRevise.store.read().edits.map(e => e.changes)))),
  'important 在记录里仍是独立字段，没有被拼进值字符串')

// 文案改动（双击驱动不了，直接走同一条编辑态路径）
await select('.card-title')
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('text'))
await page.waitForTimeout(300)
await page.keyboard.press('End')
await page.keyboard.type('！')
await page.waitForTimeout(600)
await blurAll()
await page.waitForTimeout(300)
t('6.1.3', (await stats()).texts === 1, `文案改动被记录（texts=${(await stats()).texts}）`)

// 换图
await page.evaluate(() => {
  const img = document.createElement('img')
  img.className = 'vr-shot'
  img.setAttribute('src', '/assets/hero-original.png')
  img.style.cssText = 'width:120px;height:60px;display:block;margin:16px'
  document.querySelector('.hero').appendChild(img)
})
await select('.vr-shot')
nextFiles({ name: 'new-hero.svg', mimeType: 'image/svg+xml', buffer: SVG })
await P('.swap-image').click()
await page.waitForTimeout(900)
t('6.1.3', (await page.evaluate(() =>
  document.querySelector('.vr-shot').getAttribute('src'))).startsWith('data:image/'),
  '换图写进 src（记录里是 dataUrl）')

// 移动：真实拖拽
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const cardTitles = () => page.evaluate(() =>
  [...document.querySelectorAll('.cards > .curve-card .card-title')].map(n => n.textContent.trim()))
const beforeMove = await cardTitles()
const b2 = await page.locator('.curve-card').nth(2).boundingBox()
const b0 = await page.locator('.curve-card').nth(0).boundingBox()
await page.mouse.move(b2.x + b2.width / 2, b2.y + 8)
await page.mouse.down()
await page.mouse.move(b0.x + 24, b0.y + 8, { steps: 12 })
await page.waitForTimeout(180)
await page.mouse.up()
await page.waitForTimeout(450)
const afterMove = await cardTitles()
t('6.1.3', afterMove[0] === beforeMove[2] && (await stats()).moves === 1,
  `拖拽移动被记录（${beforeMove[2]} 排到了最前）`)

// 删除
await select('.hero-eyebrow')
await page.keyboard.press('Delete')
await page.waitForTimeout(400)
t('6.1.3', (await stats()).removals === 1 &&
  await page.locator('.hero-eyebrow').count() === 0,
  '选中后 Delete 真的从页面删掉并记账')

// 评论 + 两张参考图
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.evaluate(() => window.__visualRevise.setMode('comment'))
await page.waitForTimeout(250)
await page.locator('.hero-title').click()
await page.waitForTimeout(400)
nextFiles([
  { name: 'target-a.png', mimeType: 'image/png', buffer: PNG },
  { name: 'target-b.png', mimeType: 'image/png', buffer: PNG },
])
await CM('.add-image').click()
await page.waitForTimeout(1000)
await CM('.ref-note').first().fill('想要的高亮样式')
await page.waitForTimeout(200)
await CM('.save').click()
await page.waitForTimeout(400)
await page.evaluate(() => window.__visualRevise.setMode('select'))
await page.waitForTimeout(250)

const all = await stats()
t('6.1.3', all.comments === 1 && all.refImages === 2,
  `评论带两张参考图（comments=${all.comments} refImages=${all.refImages}）`)

// ── 提示词全文校验 ──
prompt = await buildPrompt()
const has = s => prompt.includes(s)
t('6.1.3', has('# 页面视觉修改需求') && has('来源：http://test.local/page') && has('视口：1440 × 900'),
  '抬头带页面来源与视口')
t('6.1.3', /改动：.*处元素样式.*处文案.*处图片替换.*处移动.*处删除.*条交互备注/.test(prompt),
  `摘要计数把六类都数上：${(prompt.match(/改动：.*/) || [''])[0]}`)
t('6.1.3', has('**定位**') && has('- 选择器：') && has('- 标签：') && has('- 文本特征：') && has('- DOM 路径：'),
  '每个元素一节，含定位锚点（选择器 / 标签 / 文本特征 / DOM 路径）')
t('6.1.3', has('| 属性 | 原值 | 新值 |') && has('**样式改动**'),
  '属性改动是一张「属性 / 原值 / 新值」的表')
t('6.1.3', has('**文案改动**') && has('请改源码里的文案本身'),
  '文案改动单独成段，并说明要改源码字符串而不是 CSS content')
t('6.1.3', has('**图片替换**') && has('- 原图地址：`/assets/hero-original.png`'),
  '图片替换单独成段，定位里补了原图地址')
t('6.1.3', has('## 移动的元素') && (prompt.match(/- 从：`section\.cards`/) || []).length === 1
  && (prompt.match(/- 到：`section\.cards`/) || []).length === 1,
  '移动段落 from / to 两头都给了容器选择器')
t('6.1.3', has('## 删除的元素') && has('不要用 `display:none`'),
  '删除单独成段，并说明不要用 display:none 假删')
t('6.1.3', has('## 交互备注') && has('[图1]') && has('[图2]') && has('想要的高亮样式'),
  '交互备注段落带 [图N] 编号与图片说明')
t('6.1.3', has('## 参考图文件') && has('/tmp/vr-refs/01-'),
  '参考图文件清单单独成段，列的是落盘路径')
t('6.1.3', has('## 给 AI 的说明') && has('优先用「文本特征」在代码库中搜索'),
  'FOOTER「给 AI 的说明」在最后')

// 6.1.4 dataUrl 不整段进提示词
t('6.1.4', !prompt.includes('iVBORw0KGgo') && !prompt.includes('data:image/'),
  '提示词里没有任何 dataUrl / base64')
t('6.1.4', /换成：`\/tmp\/vr-refs\/\d\d-new-hero\.svg`/.test(prompt),
  `换图的新值被替换成落盘后的文件路径（实际：${(prompt.match(/- 换成：.*/) || ['（没有这一行）'])[0]}）`)
const guessy = await buildPrompt(false, '~/Downloads')
t('6.1.4', guessy.includes('路径为推测'),
  '路径不确切时如实标注「推测」，不让 AI 拿着假路径去读图')

// 6.1.5 参考图落盘
const refSave = await page.evaluate(async base => {
  const m = await import(`${base}/__app/core/ref-images.js`)
  const asset = { id: 'x1', name: '设计稿 v3.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAA' }
  const page1 = await m.saveRefImages([asset], { stamp: '2026-01-02-030405' })
  return {
    dir: m.REF_DIR,
    stamp: m.stampFolder(new Date(2026, 0, 2, 3, 4, 5)),
    hasChannel: m.hasExtensionChannel(),
    page1,
  }
}, origin)
t('6.1.5', refSave.dir === 'visual-revise-refs' && refSave.stamp === '2026-01-02-030405',
  `落盘目录是 visual-revise-refs/<时间戳>（${refSave.dir}/${refSave.stamp}）`)
t('6.1.5', refSave.hasChannel === false && refSave.page1.exact === false,
  '没有扩展通道时退回页面下载，并把 exact 标成 false（路径只能推测）')
t('6.1.5', /^\d\d-/.test(refSave.page1.files[0].name) && refSave.page1.files[0].path.includes('Downloads'),
  `文件名带两位序号、路径落在下载目录（${refSave.page1.files[0].path}）`)
const refExt = await page.evaluate(async base => {
  const m = await import(`${base}/__app/core/ref-images.js`)
  window.chrome = { runtime: { id: 'stub', sendMessage: (msg, cb) =>
    cb({ ok: true, exact: true, dir: '/Users/x/Downloads/' + msg.dir,
         files: msg.files.map(f => ({ id: f.id, name: f.name, path: `/Users/x/Downloads/${msg.dir}/${f.name}` })) }) } }
  const res = await m.saveRefImages(
    [{ id: 'x1', name: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAA' }],
    { stamp: '2026-01-02-030405' })
  delete window.chrome
  return res
}, origin)
t('6.1.5', refExt.exact === true && refExt.files[0].path.startsWith('/Users/x/Downloads/visual-revise-refs/'),
  `有扩展通道时优先走它并拿到绝对路径（${refExt.files[0].path}）`)

// 6.1.6 四种 toast
// (a) 无图
await reset()
await select('.curve-card')
await writeField('border-radius', '16')   // 固件默认就是 18px，写 18 等于没改
await clearToast(); await blurAll()
await page.keyboard.press('p'); await page.waitForTimeout(700)
tst = await toast()
t('6.1.6', /^已复制 \d+ 项改动到剪贴板$/.test(tst.text), `无图：「${tst.text}」`)

// (b) 精确路径（模拟扩展下载通道；chrome.downloads 本身无头下跑不到）
const commentWithImages = async (n = 2) => {
  await page.evaluate(() => window.__visualRevise.setMode('comment'))
  await page.waitForTimeout(250)
  await page.locator('.card-body').first().click()
  await page.waitForTimeout(400)
  nextFiles(Array.from({ length: n }, (_, i) => (
    { name: `ref-${i + 1}.png`, mimeType: 'image/png', buffer: PNG })))
  await CM('.add-image').click()
  await page.waitForTimeout(1000)
  await CM('.save').click()
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__visualRevise.setMode('select'))
  await page.waitForTimeout(250)
}
await commentWithImages(2)

const stubChannel = mode => page.evaluate(m => {
  window.chrome = { runtime: { id: 'stub', sendMessage: (msg, cb) => {
    if (m === 'none') return cb(null)
    cb({ ok: true, exact: true, dir: msg.dir,
      files: msg.files.map((f, i) => ({
        id: f.id, name: f.name,
        path: (m === 'partial' && i === 0) ? '' : `/abs/${msg.dir}/${f.name}`,
      })) })
  } } }
}, mode)
const dropChannel = () => page.evaluate(() => { delete window.chrome })

await stubChannel('exact')
await clearToast(); await blurAll()
await page.keyboard.press('p'); await page.waitForTimeout(900)
tst = await toast()
t('6.1.6', /已复制 \d+ 项改动，2 张图已存入下载目录（提示词含绝对路径）/.test(tst.text),
  `精确路径：「${tst.text}」`)

// (c) 推测路径（无扩展通道 → 页面下载）
await dropChannel()
await clearToast(); await blurAll()
await page.keyboard.press('p'); await page.waitForTimeout(1200)
tst = await toast()
t('6.1.6', /已复制 \d+ 项改动，2 张图已下载；提示词里的路径为推测/.test(tst.text),
  `推测路径：「${tst.text}」`)

// (d) 有落盘失败
await stubChannel('partial')
await clearToast(); await blurAll()
await page.keyboard.press('p'); await page.waitForTimeout(900)
tst = await toast()
t('6.1.6', /已复制 \d+ 项改动；1 张图已存，1 张落盘失败/.test(tst.text) && tst.color === ERR_COLOR,
  `有失败：「${tst.text}」（error 型）`)
await dropChannel()

// 6.1.7 只做了移动也能出提示词
await reset()
const t0 = await cardTitles()
const m2 = await page.locator('.curve-card').nth(2).boundingBox()
const m0 = await page.locator('.curve-card').nth(0).boundingBox()
await page.mouse.move(m2.x + m2.width / 2, m2.y + 8)
await page.mouse.down()
await page.mouse.move(m0.x + 24, m0.y + 8, { steps: 12 })
await page.waitForTimeout(180)
await page.mouse.up()
await page.waitForTimeout(450)
const onlyMove = await stats()
await clearToast(); await blurAll()
await page.keyboard.press('p'); await page.waitForTimeout(700)
tst = await toast()
const movePrompt = await buildPrompt()
t('6.1.7', onlyMove.props === 0 && onlyMove.moves === 1 && tst.text.startsWith('已复制'),
  `只有移动、没有样式改动时也能复制：「${tst.text}」`)
t('6.1.7', movePrompt.includes('## 移动的元素') && !movePrompt.includes('**样式改动**'),
  '提示词只有移动段落，不会因为没有样式改动而判空')

// ══════════════════════════════════════════════════════════════
console.log('── 6.2 导出 JSON')
// ══════════════════════════════════════════════════════════════
await reset()
// 攒一份含六类的记录
await select('.curve-card')
await writeField('border-radius', '14')
await select('.card-title')
await page.evaluate(() => document.querySelector('vis-bug').toolSelected('text'))
await page.waitForTimeout(300)
await page.keyboard.press('End'); await page.keyboard.type('？')
await page.waitForTimeout(600); await blurAll(); await page.waitForTimeout(250)
await select('#vr-imp')
await writeField('opacity', '55')
await select('.hero-eyebrow')
await page.keyboard.press('Delete'); await page.waitForTimeout(400)
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
const e2 = await page.locator('.curve-card').nth(2).boundingBox()
const e0 = await page.locator('.curve-card').nth(0).boundingBox()
await page.mouse.move(e2.x + e2.width / 2, e2.y + 8)
await page.mouse.down()
await page.mouse.move(e0.x + 24, e0.y + 8, { steps: 12 })
await page.waitForTimeout(180); await page.mouse.up(); await page.waitForTimeout(450)
await commentWithImages(1)

// 6.2.1 记录列表里点「导出」
await openList()
t('6.2.1', await LIST('.export').isEnabled(), '有改动时「导出」按钮可用')
await clearToast()
const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
await LIST('.export').click()
const download = await dl
await page.waitForTimeout(400)
tst = await toast()
t('6.2.1', /^已导出 \d+ 项改动$/.test(tst.text), `导出 toast：「${tst.text}」`)
t('6.2.1', !!download && /^visual-revise-.*\.json$/.test(download.suggestedFilename() || ''),
  `真的触发了浏览器下载（${download ? download.suggestedFilename() : '无 download 事件'}）`)

// 6.2.2 / 6.2.3 载荷
const exported = await page.evaluate(() =>
  window.__visualRevise.lib.exportJSON({ url: 'http://test.local', viewport: '1440 × 900' }))
t('6.2.2', exported.schema === 6, `SCHEMA_VERSION = ${exported.schema}（清单写的是 3，代码已升到 6：v5 起带「新增的元素」，v6 起新增记录可带 replaced）`)
const refId = exported.comments[0]?.images?.[0]
t('6.2.2', Array.isArray(exported.assets)
  && exported.assets.some(a => a.id === refId && a.dataUrl.startsWith('data:image/')),
  `v2 起带 assets（评论引用的 ${refId} 带着 base64 一起出）`)
t('6.2.2', Array.isArray(exported.moves) && exported.moves.length === 1
  && !!exported.moves[0].to?.anchors, 'v3 起带 moves（含目标容器锚点）')
t('6.2.2', exported.edits.some(e => e.changes.some(c => c.important === true)),
  'v4 起每条改动带 important')
t('6.2.2', Array.isArray(exported.inserts), 'v5 起带 inserts（新增的元素）')
const schemaProbe = await page.evaluate(() => {
  const { importJSON } = window.__visualRevise.lib
  const out = {}
  for (const s of [1, 2, 3, 4, 5, 6, 7])
    out[s] = importJSON({ schema: s, edits: [] }, { apply: false }).ok === true
  return out
})
t('6.2.2', schemaProbe[1] && schemaProbe[2] && schemaProbe[3] && schemaProbe[4] && schemaProbe[5] && schemaProbe[6]
  && !schemaProbe[7],
  `支持读 1/2/3/4/5/6，7 被拒（${JSON.stringify(schemaProbe)}）`)

t('6.2.3', exported.edits.length >= 2 && exported.edits.some(e => e.changes.length),
  `JSON 含样式改动（${exported.edits.length} 个元素）`)
t('6.2.3', exported.comments.length === 1 && exported.comments[0].images.length === 1,
  'JSON 含评论及其参考图 id')
t('6.2.3', exported.removals.length === 1 && !!exported.removals[0].anchors,
  'JSON 含删除记录')
t('6.2.3', !!exported.moves[0].from?.anchors && !!exported.moves[0].anchors,
  'JSON 含移动记录（三方锚点）')
t('6.2.3', exported.edits.every(e => Array.isArray(e.anchors.text)),
  'JSON 含文本锚点（供跨环境匹配）')

// ══════════════════════════════════════════════════════════════
console.log('── 6.3 导入 JSON')
// ══════════════════════════════════════════════════════════════
const importFile = async (obj, name = 'changes.json') => {
  await openList()
  await clearToast()
  nextFiles([{
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)),
  }])
  await LIST('.import').click()
  await page.waitForTimeout(900)
  return toast()
}

// 6.3.1 完整往返
await reset()
await openList()
tst = await importFile(exported)
const replayed = await page.evaluate(() => ({
  // 导入会把移动一并重放，卡片顺序变了，所以按值找而不是按位置找
  radius: [...document.querySelectorAll('.curve-card')].map(c => c.style.borderRadius).join('|'),
  opacity: document.getElementById('vr-imp').style.opacity,
  important: document.getElementById('vr-imp').style.getPropertyPriority('opacity'),
  eyebrow: document.querySelectorAll('.hero-eyebrow').length,
  order: [...document.querySelectorAll('.cards > .curve-card .card-title')].map(n => n.textContent.trim()),
  comments: window.__visualRevise.store.stats().comments,
  refs: window.__visualRevise.store.stats().refImages,
}))
t('6.3.1', replayed.radius.split('|').filter(r => r === '14px').length === 1,
  `导入重放样式改动（三张卡片的 border-radius=${replayed.radius}）`)
t('6.3.1', replayed.important === 'important' && replayed.opacity === '0.55',
  `important 一并重放（opacity=${replayed.opacity} ${replayed.important}）`)
t('6.3.1', replayed.eyebrow === 0, '导入重放删除（.hero-eyebrow 又没了）')
t('6.3.1', replayed.order[0] === beforeMove[2], `导入重放移动（首位=${replayed.order[0]}）`)
t('6.3.1', replayed.comments === 1 && replayed.refs === 1, '导入重放评论及其参考图')

// 6.3.1 新增的元素也要能往返：先在页面上真的造一个，导出再导入
await reset()
const insertRoundTrip = await page.evaluate(() => {
  const s = window.__visualRevise.store
  const cards = document.querySelector('.cards')
  const first = cards.firstElementChild
  const node = document.createElement('aside')
  node.className = 'vr-inserted-probe'
  node.textContent = '新加的一块'
  s.insertElement(node, cards, first, '新增元素')

  const data = window.__visualRevise.lib.exportJSON()
  // 清干净再导入，验证的是「照记录重建」而不是「它本来就还在」
  s.undoEverything(); s.clear(); s.history.clear()
  const gone = !document.querySelector('.vr-inserted-probe')
  const report = window.__visualRevise.lib.importJSON(data)

  const back = document.querySelector('.vr-inserted-probe')
  return {
    exported: data.inserts?.length || 0,
    html: data.inserts?.[0]?.html || '',
    atEnd: data.inserts?.[0]?.atEnd,
    gone,
    imported: report.inserts,
    backIndex: back ? [...cards.children].indexOf(back) : -1,
    text: back?.textContent || '',
  }
})
t('6.2.2', insertRoundTrip.exported === 1
  && /vr-inserted-probe/.test(insertRoundTrip.html) && insertRoundTrip.atEnd === false,
  `v5 的 inserts 存 HTML 原文 + 落点（html=${insertRoundTrip.html.slice(0, 48)}，atEnd=${insertRoundTrip.atEnd}）`)
t('6.3.1', insertRoundTrip.gone && insertRoundTrip.imported === 1
  && insertRoundTrip.backIndex === 0 && insertRoundTrip.text === '新加的一块',
  `导入把新增的元素按锚点重建回原位（清空后不在=${insertRoundTrip.gone}，导入后排第 ${insertRoundTrip.backIndex}）`)
await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  document.querySelectorAll('.vr-inserted-probe').forEach(n => n.remove())
})

// 6.3.2 选择器失效 → 文本特征回退
await reset()
const titleText = await page.locator('.hero-title').textContent()
const byTextPayload = {
  schema: 4,
  edits: [{
    selector: 'h1.hashed-9f3ab',
    anchors: { tag: 'h1', text: [titleText.trim()], domPath: 'body > main.hero > h1.hashed-9f3ab' },
    changes: [{ prop: 'font-size', from: '40px', to: '52px' }],
  }],
}
tst = await importFile(byTextPayload)
t('6.3.2', await page.evaluate(() => document.querySelector('.hero-title').style.fontSize) === '52px',
  '选择器失效时靠文本特征找回元素并应用改动')
t('6.3.2', tst.text.includes('1 处靠文本特征匹配'), `toast 如实标注回退：「${tst.text}」`)

// 6.3.3 单条出错不连累其余
await reset()
const mixedPayload = {
  schema: 4,
  edits: [
    { selector: 'div.hover:bg-blue-500',    // Tailwind 风格，CSS 里非法
      anchors: { tag: 'div', text: ['压根不存在'], domPath: 'div.w-1/2 > div.top-[3px]' },
      changes: [{ prop: 'padding-top', from: '0px', to: '8px' }] },
    { selector: 'h1.hero-title',            // 记录本身坏掉：changes 不是数组
      anchors: { tag: 'h1', text: [titleText.trim()], domPath: 'body > main.hero > h1.hero-title' },
      changes: null },
    { selector: 'article.curve-card',       // 排在坏记录之后，必须照常应用
      anchors: { tag: 'article', text: [], domPath: 'body > section.cards > article.curve-card' },
      changes: [{ prop: 'border-radius', from: '18px', to: '4px' }] },
  ],
}
tst = await importFile(mixedPayload)
t('6.3.3', await page.evaluate(() =>
  document.querySelector('.curve-card').style.borderRadius) === '4px',
  '坏记录之后的记录仍被应用（整个导入没有中断）')
const failReport = await page.evaluate(p => {
  window.__visualRevise.store.undoEverything()
  const r = window.__visualRevise.lib.importJSON(p)
  window.__visualRevise.store.undoEverything()
  return { failed: r.failed.length, missing: r.missing.length, matched: r.matched.length, ok: r.ok }
}, mixedPayload)
t('6.3.3', failReport.ok && failReport.failed === 1 && failReport.missing === 1 && failReport.matched === 1,
  `坏记录记进 failed 而不是抛错（failed=${failReport.failed} missing=${failReport.missing} matched=${failReport.matched}）`)

// 6.3.4 汇总文案
await reset()
const cardText = (await page.locator('.card-title').first().textContent()).trim()
const summaryPayload = {
  schema: 4,
  edits: [{
    selector: 'h1.no-such-class',
    anchors: { tag: 'h1', text: [titleText.trim()], domPath: 'body > main.hero > h1.hero-title' },
    changes: [{ prop: 'letter-spacing', from: 'normal', to: '2px' }],
  }],
  moves: [{
    seq: 1, selector: 'section.cards > article.curve-card:nth-of-type(3)',
    anchors: { tag: 'article', text: [], domPath: 'body > section.cards > article.curve-card' },
    from: { anchors: { tag: 'section', selector: 'section.cards' }, next: null, atEnd: true },
    to:   { anchors: { tag: 'section', selector: 'section.cards' }, next: null, atEnd: true },
  }],
  removals: [{
    seq: 1, selector: 'p.hero-eyebrow',
    anchors: { tag: 'p', selector: 'p.hero-eyebrow', text: [], domPath: 'body > main.hero > p.hero-eyebrow' },
  }],
  comments: [{
    seq: 1, selector: 'h2.card-title',
    anchors: { tag: 'h2', selector: 'h2.card-title', text: [cardText], domPath: 'body > section.cards > article.curve-card > h2.card-title' },
    text: '这里要能点', images: [],
  }],
  edits2: [],
}
summaryPayload.edits.push({
  selector: 'div.definitely-missing',
  anchors: { tag: 'div', text: ['找不到的锚点'], domPath: 'div.nope > div.nope2' },
  changes: [{ prop: 'color', from: 'red', to: 'blue' }],
})
tst = await importFile(summaryPayload)
t('6.3.4', /^导入 1 处改动 \+ 1 处移动 \+ 1 处删除 \+ 1 条评论（1 处靠文本特征匹配），1 处未找到对应元素$/
  .test(tst.text), `汇总文案完整拼出五段：「${tst.text}」`)

// 6.3.5 三种失败文案
await reset()
await openList()
tst = await importFile({ schema: 9, edits: [] })
t('6.3.5', tst.text === '不支持的文件格式（schema=9）' && tst.color === ERR_COLOR,
  `不支持的 schema：「${tst.text}」`)

await clearToast()
nextFiles([])
await LIST('.import').click()
await page.waitForTimeout(800)
tst = await toast()
t('6.3.5', tst.text === '未选择文件' && tst.color === ERR_COLOR, `未选文件：「${tst.text}」`)

tst = await importFile('{ 这不是 JSON', 'broken.json')
t('6.3.5', tst.text.startsWith('文件解析失败：') && tst.color === ERR_COLOR,
  `解析失败：「${tst.text}」`)

await page.evaluate(() => { document.querySelector('visual-revise-list').hidden = true })

// ══════════════════════════════════════════════════════════════
console.log('── 7.1 评论')
// ══════════════════════════════════════════════════════════════
await reset()

// 7.1.1 C 进评论模式，点元素起草，模式保持
await blurAll()
await page.keyboard.press('c')
await page.waitForTimeout(300)
t('7.1.1', await page.evaluate(() => window.__visualRevise.comments.active), 'C 键进入评论模式')
await page.locator('.card-body').first().click()
await page.waitForTimeout(400)
t('7.1.1', await CM('.bubble').count() === 1, '点页面元素在该处起草评论')
t('7.1.1', await page.evaluate(() => window.__visualRevise.comments.active),
  '起草后仍留在评论模式，可以连续标注')

// 7.1.2 点击不选中
t('7.1.2', await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0,
  '评论模式下点击不选中元素')

// 7.1.4 气泡结构
const bubble = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const b = sr.querySelector('.bubble')
  const ed = b.querySelector('.editor')
  return {
    sel: b.querySelector('.sel')?.textContent,
    editable: ed?.getAttribute('contenteditable'),
    placeholder: ed?.dataset.placeholder,
    addImage: !!b.querySelector('.add-image'),
    refs: !!b.querySelector('.refs'),
    save: b.querySelector('.save')?.textContent,
    cancel: b.querySelector('.cancel')?.textContent,
    hint: b.querySelector('.hint')?.textContent,
  }
})
t('7.1.4', bubble.sel === 'p.card-body', `气泡顶部是元素选择器标签：${bubble.sel}`)
t('7.1.4', bubble.editable === 'true'
  && bubble.placeholder === '描述想要的效果，例如：鼠标移入时上浮并变亮',
  `contenteditable 编辑器带 placeholder：${bubble.placeholder}`)
t('7.1.4', bubble.addImage && bubble.refs, '有 + 加图按钮与参考图区')
t('7.1.4', bubble.save === '添加' && bubble.cancel === '取消',
  `新建时按钮是「${bubble.save}」/「${bubble.cancel}」`)
t('7.1.4', bubble.hint === '⌘/Ctrl + Enter 快速保存', `底部提示：${bubble.hint}`)

// 7.1.10 气泡只建一次：打个记号，触发重定位后仍是同一个节点
await page.evaluate(() => {
  document.querySelector('visual-revise-comment-layer').shadowRoot
    .querySelector('.bubble').__vrMark = 'kept'
})
await CM('.editor').click()
await page.keyboard.type('先写一半')
const posBefore = await page.evaluate(() =>
  document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.bubble').style.top)
await page.evaluate(() => dispatchEvent(new Event('resize')))
await page.waitForTimeout(400)
const kept = await page.evaluate(() => {
  const b = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.bubble')
  return { mark: b.__vrMark, text: b.querySelector('.editor').textContent, top: b.style.top }
})
t('7.1.10', kept.mark === 'kept' && kept.text === '先写一半',
  '重定位时气泡只挪位置、不整块重建（正在输入的文字还在）')

// 7.1.3 起新草稿时先自动保存上一条
await page.locator('.card-tag').first().click()
await page.waitForTimeout(450)
const autoSaved = await page.evaluate(() => window.__visualRevise.store.read().comments.map(c => c.text))
t('7.1.3', autoSaved.length === 1 && autoSaved[0] === '先写一半',
  `点下一个元素时上一条草稿被自动保存：「${autoSaved[0]}」`)
t('7.1.3', await CM('.bubble').count() === 1, '同时给新元素开了一个新草稿')

// 7.1.5 ⌘/Ctrl + Enter 保存
await CM('.editor').click()
await page.keyboard.type('这里加个 tooltip')
await page.keyboard.press(`${MOD}+Enter`)
await page.waitForTimeout(400)
const afterCmdEnter = await page.evaluate(() => window.__visualRevise.store.read().comments.length)
t('7.1.5', afterCmdEnter === 2 && await CM('.bubble').count() === 0,
  `${MOD}+Enter 保存并关掉气泡（现在 ${afterCmdEnter} 条）`)

// 7.1.5 Escape 取消
await page.locator('.hero-title').click()
await page.waitForTimeout(400)
await CM('.editor').click()
await page.keyboard.type('这条不要')
await page.keyboard.press('Escape')
await page.waitForTimeout(350)
t('7.1.5', await CM('.bubble').count() === 0
  && await page.evaluate(() => window.__visualRevise.store.read().comments.length) === 2,
  'Escape 取消草稿，不落库')

// 7.1.6 pin 编号 + 点开可编辑
const pins = await page.evaluate(() =>
  [...document.querySelector('visual-revise-comment-layer').shadowRoot.querySelectorAll('.pin')]
    .map(p => p.textContent))
t('7.1.6', pins.join(',') === '1,2', `保存后页面出现编号 pin：${pins.join(', ')}`)
await CM('.pin').first().click()
await page.waitForTimeout(450)
const editing = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  return { text: sr.querySelector('.editor')?.textContent, save: sr.querySelector('.save')?.textContent }
})
t('7.1.6', editing.text === '先写一半' && editing.save === '保存',
  `点 pin 回到原评论继续编辑（按钮变「${editing.save}」）`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// 7.1.7 pin 定位
await page.evaluate(() => {
  const mk = (id, css) => {
    const d = document.createElement('div')
    d.id = id
    d.style.cssText = `position:fixed;width:120px;height:40px;background:#2a2a33;${css}`
    document.body.appendChild(d)
  }
  mk('vr-pin-mid', 'left:200px;top:260px')
  mk('vr-pin-right', 'right:0;top:340px')
})
const draftOn = async id => {
  await page.evaluate(() => window.__visualRevise.setMode('comment'))
  await page.waitForTimeout(200)
  await page.locator(`#${id}`).click()
  await page.waitForTimeout(350)
}
const saveDraft = async text => {
  await CM('.editor').click()
  await page.keyboard.type(text)
  await CM('.save').click()
  await page.waitForTimeout(400)
}
await draftOn('vr-pin-mid');   await saveDraft('中间的')
await draftOn('vr-pin-right'); await saveDraft('右缘的')

const pinGeo = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const pin = n => [...sr.querySelectorAll('.pin')].find(p => p.textContent === String(n))
  const box = el => { const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, right: r.right } }
  return {
    mid: box(pin(3)), midEl: document.getElementById('vr-pin-mid').getBoundingClientRect().right,
    edge: box(pin(4)), edgeEl: document.getElementById('vr-pin-right').getBoundingClientRect().right,
    vw: document.documentElement.clientWidth,
  }
})
t('7.1.7', pinGeo.mid.cx > pinGeo.midEl,
  `空间够时 pin 放在元素右外侧（pin 中心 ${Math.round(pinGeo.mid.cx)} > 元素右缘 ${Math.round(pinGeo.midEl)}）`)
t('7.1.7', pinGeo.edge.cx < pinGeo.edgeEl && pinGeo.edge.right <= pinGeo.vw,
  `右边塞不下时收进元素内侧（pin 中心 ${Math.round(pinGeo.edge.cx)} < 元素右缘 ${Math.round(pinGeo.edgeEl)}）`)
await page.evaluate(() => {
  const el = document.getElementById('vr-pin-right')
  el.style.right = 'auto'
  el.style.left = `${document.documentElement.clientWidth + 500}px`
  dispatchEvent(new Event('resize'))
})
await page.waitForTimeout(350)
const goneGeo = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const p = [...sr.querySelectorAll('.pin')].find(p => p.textContent === '4')
  const r = p.getBoundingClientRect()
  return { left: r.left, vw: document.documentElement.clientWidth }
})
t('7.1.7', goneGeo.left > goneGeo.vw,
  `元素滚出视口时 pin 跟着离场，不被夹回边缘（left=${Math.round(goneGeo.left)} > vw=${goneGeo.vw}）`)

// 7.1.9 气泡定位：右边放不下翻到左侧；纵向只夹不翻
await page.evaluate(() => {
  document.getElementById('vr-pin-right')?.remove()
  const d = document.createElement('div')
  d.id = 'vr-bub-right'
  d.style.cssText = 'position:fixed;right:0;top:300px;width:120px;height:40px;background:#2a2a33'
  document.body.appendChild(d)
  const b = document.createElement('div')
  b.id = 'vr-bub-bottom'
  b.style.cssText = 'position:fixed;bottom:0;left:120px;width:120px;height:40px;background:#2a2a33'
  document.body.appendChild(b)
})
await draftOn('vr-bub-right')
const flipped = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const b = sr.querySelector('.bubble').getBoundingClientRect()
  const a = document.getElementById('vr-bub-right').getBoundingClientRect()
  return { bRight: b.right, bLeft: b.left, aRight: a.right, vw: document.documentElement.clientWidth }
})
t('7.1.9', flipped.bRight <= flipped.vw - 7 && flipped.bLeft < flipped.aRight,
  `右边放不下时气泡翻到锚点左侧（bubble.right=${Math.round(flipped.bRight)} ≤ vw=${flipped.vw}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)

await draftOn('vr-bub-bottom')
const clamped = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const b = sr.querySelector('.bubble').getBoundingClientRect()
  const a = document.getElementById('vr-bub-bottom').getBoundingClientRect()
  return {
    bTop: b.top, bBottom: b.bottom, aTop: a.top,
    vh: document.documentElement.clientHeight, h: b.height,
  }
})
t('7.1.9', clamped.bBottom <= clamped.vh - 7 && clamped.bTop < clamped.aTop
  && clamped.bTop > clamped.aTop - clamped.h - 12,
  `纵向只夹不翻（bubble.top=${Math.round(clamped.bTop)}，锚点 top=${Math.round(clamped.aTop)}）`)
t('7.1.9', await page.evaluate(() => scrollY) === 0, '气泡没有把页面拽着滚动')

// 7.1.11 粘贴富文本降级成纯文本
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('text/html', '<b>加粗</b><i>斜体</i>')
  dt.setData('text/plain', '加粗斜体')
  const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')
  ed.focus()
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(350)
const pasted = await page.evaluate(() => {
  const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')
  return { html: ed.innerHTML, text: ed.textContent }
})
t('7.1.11', pasted.text.includes('加粗斜体') && !/<b>|<i>/i.test(pasted.html),
  `粘贴富文本降级成纯文本（innerHTML=${pasted.html.slice(0, 40)}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)

// 7.1.12 空草稿丢弃 / 只有图也算
const beforeEmpty = (await stats()).comments
await draftOn('vr-bub-bottom')
await CM('.save').click()
await page.waitForTimeout(350)
t('7.1.12', (await stats()).comments === beforeEmpty,
  `文字和图都空的草稿直接丢弃，不冒出空备注（仍是 ${beforeEmpty} 条）`)
await draftOn('vr-bub-bottom')
nextFiles({ name: 'only-pic.png', mimeType: 'image/png', buffer: PNG })
await CM('.add-image').click()
await page.waitForTimeout(900)
await CM('.save').click()
await page.waitForTimeout(400)
const onlyImg = await page.evaluate(() => {
  const cs = window.__visualRevise.store.read().comments
  return { count: cs.length, text: cs.at(-1).text, images: (cs.at(-1).images || []).length }
})
t('7.1.12', onlyImg.count === beforeEmpty + 1 && onlyImg.images === 1
  && /^\[图1\]$/.test(onlyImg.text.trim()),
  `只有参考图、正文只剩图标记的评论同样成立（text=「${onlyImg.text}」images=${onlyImg.images}）`)

// 7.1.8 带图的 pin 有标记
const pinMarks = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const withImg = [...sr.querySelectorAll('.pin[data-has-images]')]
  const last = window.__visualRevise.store.read().comments.at(-1)
  return { count: withImg.length, seq: withImg[0]?.textContent, lastSeq: String(last.seq) }
})
t('7.1.8', pinMarks.count === 1 && pinMarks.seq === pinMarks.lastSeq,
  `只有带图的那条 pin 有 data-has-images（编号 ${pinMarks.seq}，正是刚存的那条）`)

// 7.1.13 scroll / resize 时重新定位
await page.evaluate(() => window.__visualRevise.setMode('select'))
await page.waitForTimeout(200)
// 固件本身不够高，先给页面撑出可滚动空间
await page.evaluate(() => {
  const s = document.createElement('div')
  s.id = 'vr-tall'
  s.style.cssText = 'height:1600px'
  document.body.appendChild(s)
})
await page.waitForTimeout(200)
const pinTop = () => page.evaluate(() => {
  const p = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.pin')
  return p.getBoundingClientRect().top
})
const pinTopBefore = await pinTop()
await page.mouse.wheel(0, 200)
await page.waitForTimeout(500)
const scrolled = await page.evaluate(() => scrollY)
const pinTopAfter = await pinTop()
t('7.1.13', scrolled > 0 && Math.abs((pinTopBefore - scrolled) - pinTopAfter) < 6,
  `滚动 ${scrolled}px 后 pin 跟着元素走（${Math.round(pinTopBefore)} → ${Math.round(pinTopAfter)}）`)
await page.evaluate(() => scrollTo(0, 0))
await page.waitForTimeout(400)
t('7.1.13', Math.abs(await pinTop() - pinTopBefore) < 6, '滚回顶部后 pin 也回到原位')
await page.evaluate(() => document.getElementById('vr-tall')?.remove())
await page.waitForTimeout(200)

// 7.1.14 浏览模式整块隐藏评论层
await blurAll()
await page.keyboard.press('v')
await page.waitForTimeout(400)
t('7.1.14', await page.evaluate(() =>
  document.querySelector('visual-revise-comment-layer').hidden === true),
  '浏览模式下评论层整块隐藏（pin 有 pointer-events，留着会挡点击）')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
t('7.1.14', await page.evaluate(() =>
  document.querySelector('visual-revise-comment-layer').hidden === false),
  '回到选择态后评论层重新显示')

await page.evaluate(() => {
  for (const id of ['vr-pin-mid', 'vr-bub-right', 'vr-bub-bottom'])
    document.getElementById(id)?.remove()
})

// ══════════════════════════════════════════════════════════════
console.log('── 7.2 参考图')
// ══════════════════════════════════════════════════════════════
await reset()

const editorState = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const ed = sr.querySelector('.editor')
  return {
    chips: [...ed.querySelectorAll('.chip')].map(c => c.dataset.id),
    names: [...ed.querySelectorAll('.chip-name')].map(c => c.textContent),
    thumbs: ed.querySelectorAll('.chip img').length,
    text: ed.textContent,
    refs: [...sr.querySelectorAll('.ref')].map(r => r.dataset.id),
  }
})
const caretToEnd = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const ed = sr.querySelector('.editor')
  const range = document.createRange()
  range.selectNodeContents(ed); range.collapse(false)
  const sel = sr.getSelection ? sr.getSelection() : document.getSelection()
  sel.removeAllRanges(); sel.addRange(range)
  ed.focus()
})
const typeIn = async s => { await caretToEnd(); await page.keyboard.type(s) }
const pasteFile = (name, b64 = B64, mime = 'image/png') => page.evaluate(([n, b, m]) => {
  const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], n, { type: m }))
  const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')
  ed.focus()
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
}, [name, b64, mime])

await page.evaluate(() => window.__visualRevise.setMode('comment'))
await page.waitForTimeout(250)
await page.locator('.curve-card').first().click({ position: { x: 6, y: 6 } })
await page.waitForTimeout(400)

// 7.2.1 三个入口
await typeIn('参考 ')
nextFiles({ name: 'from-picker.png', mimeType: 'image/png', buffer: PNG })
await CM('.add-image').click()
await page.waitForTimeout(900)
t('7.2.1', await CM('.ref').count() === 1, '入口 1：+ 按钮选文件')
await pasteFile('from-paste.png')
await page.waitForTimeout(700)
t('7.2.1', await CM('.ref').count() === 2, '入口 2：编辑器内粘贴图片')
await page.evaluate(b => {
  const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'from-drop.png', { type: 'image/png' }))
  const bub = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.bubble')
  bub.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
}, B64)
await page.waitForTimeout(700)
t('7.2.1', await CM('.ref').count() === 3, '入口 3：往气泡上拖文件')

// 7.2.2 chip 插在光标处
await typeIn(' 的效果')
let est = await editorState()
t('7.2.2', est.chips.length === 3 && est.thumbs === 3,
  `图片以 chip（缩略图 + 名字）插进句子（${est.chips.length} 个）`)
t('7.2.2', est.names.join(',') === 'from-picker,from-paste,from-drop',
  `chip 上是去掉扩展名的文件名：${est.names.join(', ')}`)
t('7.2.2', est.text.startsWith('参考') && est.text.endsWith('的效果'),
  'chip 插在光标处，前后文字都在')

// 7.2.6 说明区每张一行
const refRow = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const ref = sr.querySelector('.ref')
  return {
    thumb: !!ref.querySelector('.ref-thumb img'),
    no: ref.querySelector('.ref-no')?.textContent,
    name: ref.querySelector('.ref-name')?.textContent,
    size: ref.querySelector('.ref-size')?.textContent,
    del: ref.querySelector('.ref-del')?.textContent,
    note: ref.querySelector('textarea.ref-note')?.placeholder,
    nos: [...sr.querySelectorAll('.ref-no')].map(n => n.textContent).join(','),
  }
})
t('7.2.6', refRow.thumb && refRow.no === '[图1]' && refRow.name === 'from-picker.png'
  && !!refRow.size && refRow.del === '×' && !!refRow.note,
  `说明区一行含缩略图 / ${refRow.no} / ${refRow.name} / ${refRow.size} / × / 说明框`)
t('7.2.6', refRow.nos === '[图1],[图2],[图3]', `编号依次递增：${refRow.nos}`)

// 7.2.9 hover 出大图预览
await CM('.chip').first().hover()
await page.waitForTimeout(350)
const preview = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const box = sr.querySelector('.preview')
  if (!box) return null
  const r = box.getBoundingClientRect()
  const img = box.querySelector('img')
  return {
    open: box.matches(':popover-open'),
    popover: box.getAttribute('popover'),
    w: r.width, h: r.height,
    imgW: parseFloat(img.style.width), imgH: parseFloat(img.style.height),
    position: getComputedStyle(box).position,
  }
})
t('7.2.9', preview?.open && preview.popover === 'manual' && preview.w > 0,
  `hover chip 弹出大图预览（popover=${preview?.popover}）`)
t('7.2.9', preview.position === 'fixed' && preview.imgW === 1 && preview.imgH === 1,
  `预览按素材原始尺寸算大小、不放大（1×1 的图仍是 ${preview.imgW}×${preview.imgH}），`
  + 'popover 配 position:fixed 才不会在 top layer 里飘')
await page.mouse.move(4, 4)
await page.waitForTimeout(350)
t('7.2.9', await page.evaluate(() => {
  const b = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.preview')
  const r = b.getBoundingClientRect()
  return !b.matches(':popover-open') && r.width === 0 && r.height === 0
}), '移开鼠标后预览真的消失（尺寸归零，不只是状态位）')

// 7.2.8 说明实时写回数据
await CM('.ref-note').nth(1).fill('第二张的说明')
await page.waitForTimeout(250)
await page.evaluate(() => dispatchEvent(new Event('resize')))
await page.waitForTimeout(350)
t('7.2.8', await CM('.ref-note').nth(1).inputValue() === '第二张的说明',
  '说明实时写回数据，重排也不会被冲掉')

// 7.2.3 序列化成 [图N]
await CM('.save').click()
await page.waitForTimeout(450)
const savedComment = await page.evaluate(() => {
  const c = window.__visualRevise.store.read().comments.at(-1)
  return { text: c.text, imgs: (c.images || []).map(i => ({ name: i.name, note: i.note })) }
})
t('7.2.3', /参考\s*\[图1\]\s*\[图2\]\s*\[图3\]\s*的效果/.test(savedComment.text),
  `chip 序列化成 [图N]，N 是它在清单里的序号：「${savedComment.text}」`)
t('7.2.8', savedComment.imgs[1].note === '第二张的说明',
  '说明随评论一起落库（保存走的是数据不是 DOM）')

// 7.2.4 重新编辑时 [图N] 还原成 chip
await CM('.pin').last().click()
await page.waitForTimeout(500)
est = await editorState()
t('7.2.4', est.chips.length === 3 && !est.text.includes('[图1]'),
  `重新编辑时标记还原成 chip，编辑器里没有裸的 [图N]（${est.chips.length} 个 chip）`)

// 7.2.5 Backspace 删 chip → 清单同步
await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  const ed = sr.querySelector('.editor')
  const chip = ed.querySelectorAll('.chip')[2]
  const range = document.createRange()
  range.setStartAfter(chip); range.collapse(true)
  const sel = sr.getSelection ? sr.getSelection() : document.getSelection()
  sel.removeAllRanges(); sel.addRange(range)
  ed.focus()
})
await page.keyboard.press('Backspace')
await page.waitForTimeout(400)
est = await editorState()
t('7.2.5', est.chips.length === 2 && est.refs.length === 2 && !est.names.includes('from-drop'),
  `Backspace 一次删掉整个 chip，说明区同步（剩 ${est.chips.length} 条）`)
await CM('.editor').click()
await page.keyboard.press(`${MOD}+a`)
await page.keyboard.press('Backspace')
await page.waitForTimeout(400)
est = await editorState()
t('7.2.5', est.chips.length === 0 && est.refs.length === 0,
  '全选删除同样走 reconcile，清单一起清空')

// 7.2.7 说明区删图连句子里的 chip 一起删
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.evaluate(() => window.__visualRevise.setMode('comment'))
await page.waitForTimeout(200)
await page.locator('.card-body').nth(1).click()
await page.waitForTimeout(400)
await typeIn('照 ')
nextFiles({ name: 'to-remove.png', mimeType: 'image/png', buffer: PNG })
await CM('.add-image').click()
await page.waitForTimeout(900)
await typeIn(' 改')
est = await editorState()
t('7.2.7', est.chips.length === 1 && est.refs.length === 1, '句子里有一个 chip、说明区一条')
await CM('.ref-del').first().click()
await page.waitForTimeout(400)
est = await editorState()
t('7.2.7', est.chips.length === 0 && est.refs.length === 0 && est.text.includes('照') && est.text.includes('改'),
  '说明区点 × 时句子里的 chip 同步消失，不留指向空气的 chip')

// 7.2.12 命名规则
const d = new Date()
const DAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
await pasteFile('image.png')
await page.waitForTimeout(700)
await pasteFile('image.png')
await page.waitForTimeout(700)
await pasteFile('设计稿-v3.png')
await page.waitForTimeout(700)
const names = await page.evaluate(() =>
  [...document.querySelector('visual-revise-comment-layer').shadowRoot
    .querySelectorAll('.ref-name')].map(n => n.textContent.trim()))
const dated = names.filter(n => n.startsWith(DAY))
t('7.2.12', dated.length === 2 && /-01\.png$/.test(dated[0]) && /-02\.png$/.test(dated[1]),
  `剪贴板占位名换成「日期 + 两位序号」：${dated.join(' / ')}`)
t('7.2.12', names.includes('设计稿-v3.png'), '从 Finder 粘贴的真实文件名原样保留')

// 7.2.9（续）大图要按 260px 上限等比缩，1×1 的图看不出这一条
await pasteFile('big-shot.svg', SVG_B64, 'image/svg+xml')
await page.waitForTimeout(800)
await CM('.chip').last().hover()
await page.waitForTimeout(400)
const bigPreview = await page.evaluate(() => {
  const box = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.preview')
  const img = box?.querySelector('img')
  return { open: box?.matches(':popover-open'), w: parseFloat(img.style.width), h: parseFloat(img.style.height) }
})
t('7.2.9', bigPreview.open && bigPreview.w === 260 && bigPreview.h === 195,
  `400×300 的图按 260px 上限等比缩（${bigPreview.w}×${bigPreview.h}）`)
await page.mouse.move(4, 4)
await page.waitForTimeout(300)

// 7.2.10 体积限制
await clearToast()
const refsBeforeBig = await CM('.ref').count()
await page.evaluate(() => {
  const big = new Uint8Array(6 * 1024 * 1024)
  const dt = new DataTransfer()
  dt.items.add(new File([big], 'huge.png', { type: 'image/png' }))
  const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')
  ed.focus()
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(1500)
const bigRefs = await CM('.ref').count()
tst = await toast()
t('7.2.10', bigRefs === refsBeforeBig,
  `单张超过 5MB 的图不入清单（仍是 ${bigRefs} 条）`)
t('7.2.10', tst.shown && tst.text.includes('图片过大'),
  `超限要有可见的报错 toast（实际：「${tst.text || '（没有任何提示）'}」）`)

await clearToast()
await page.evaluate(() => {
  const dt = new DataTransfer()
  for (let i = 0; i < 5; i++)
    dt.items.add(new File([new Uint8Array(4_300_000)], `bulk-${i}.png`, { type: 'image/png' }))
  const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')
  ed.focus()
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(8000)
const overTotal = await CM('.ref').count()
tst = await toast()
t('7.2.10', overTotal < refsBeforeBig + 5 || (tst.shown && /上限|累计|过大/.test(tst.text)),
  `一次会话累计 21.5MB（上限 20MB）时应当拦下并报错（现在共 ${overTotal} 张，`
  + `toast：「${tst.text || '（无）'}」）`)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// ══════════════════════════════════════════════════════════════
console.log('── 7.3 交互态 / 隐身态')
// ══════════════════════════════════════════════════════════════
await reset()

// 7.3.1 Tab 进隐身态
await blurAll()
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
let st = await page.evaluate(() => ({
  interactive: window.__visualRevise.interactive,
  mode: window.__visualRevise.mode,
  toolbarHidden: document.querySelector('visual-revise-toolbar').hidden,
  panelHidden: document.querySelector('visual-revise-panel').hidden,
}))
t('7.3.1', st.interactive && st.mode === 'browse' && st.toolbarHidden,
  `Tab 进隐身态：browse 模式且工具条一起藏（mode=${st.mode}）`)

// 7.3.2 隐身态下除 Tab 外一律放行给页面
await page.evaluate(() => {
  window.__vrKeys = []
  window.__vrLog = e => window.__vrKeys.push(e.key)
  addEventListener('keydown', window.__vrLog)
})
for (const k of ['c', 'v', 'l', 'p', 'a', 'f']) {
  await page.keyboard.press(k)
  await page.waitForTimeout(80)
}
const passthrough = await page.evaluate(() => ({
  keys: window.__vrKeys.join(''),
  comment: window.__visualRevise.comments.active,
  listOpen: !document.querySelector('visual-revise-list').hidden,
  mode: window.__visualRevise.mode,
}))
t('7.3.2', passthrough.keys === 'cvlpaf' && !passthrough.comment
  && !passthrough.listOpen && passthrough.mode === 'browse',
  `隐身态下按键全部放行给页面、不触发任何工具功能（页面收到「${passthrough.keys}」）`)
await page.evaluate(() => removeEventListener('keydown', window.__vrLog))

// 7.3.3 再按 Tab 回到进入前的模式
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
st = await page.evaluate(() => ({ mode: window.__visualRevise.mode,
  toolbarHidden: document.querySelector('visual-revise-toolbar').hidden }))
t('7.3.3', st.mode === 'select' && !st.toolbarHidden, `再按 Tab 回到进入前的模式（${st.mode}）`)

await blurAll()
await page.keyboard.press('c')
await page.waitForTimeout(300)
await page.keyboard.press('Tab')
await page.waitForTimeout(350)
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
t('7.3.3', await page.evaluate(() => window.__visualRevise.mode) === 'comment',
  '从评论模式进隐身态，出来还是评论模式')

// 7.3.4 Esc 从隐身态回选择态
await page.keyboard.press('Tab')
await page.waitForTimeout(350)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
st = await page.evaluate(() => ({ mode: window.__visualRevise.mode,
  interactive: window.__visualRevise.interactive,
  toolbarHidden: document.querySelector('visual-revise-toolbar').hidden }))
t('7.3.4', st.mode === 'select' && !st.interactive && !st.toolbarHidden,
  `Esc 也能从隐身态回到选择态（mode=${st.mode}，工具条回来了）`)

// 7.3.5 面板内 Tab 归面板
await select('.curve-card')
await P('input[data-prop="border-radius"]').first().focus()
await page.waitForTimeout(200)
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
st = await page.evaluate(() => {
  const panel = document.querySelector('visual-revise-panel')
  let a = document.activeElement
  const inPanel = a === panel
  return {
    mode: window.__visualRevise.mode,
    toolbarHidden: document.querySelector('visual-revise-toolbar').hidden,
    focusInPanel: inPanel && !!panel.shadowRoot.activeElement,
    focusTag: panel.shadowRoot.activeElement?.tagName,
  }
})
t('7.3.5', st.mode === 'select' && !st.toolbarHidden,
  '面板里按 Tab 不进隐身态（模式与工具条都没动）')
t('7.3.5', st.focusInPanel, `Tab 归面板自己（焦点落在 ${st.focusTag}）`)

// ══════════════════════════════════════════════════════════════
console.log('── 7.4 点击隔离')
// ══════════════════════════════════════════════════════════════
await reset()
await select('.curve-card')

const armSpy = () => page.evaluate(() => {
  window.__vrSpy = []
  window.__vrSpyFn = e => window.__vrSpy.push(e.type)
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'pointerup', 'mouseup'])
    document.addEventListener(type, window.__vrSpyFn)
})
const readSpy = () => page.evaluate(() => {
  const out = window.__vrSpy.slice()
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'pointerup', 'mouseup'])
    document.removeEventListener(type, window.__vrSpyFn)
  return out
})

await armSpy()
await P('.sub').click()
await page.waitForTimeout(200)
await P('.sub').click({ button: 'right' })
await page.waitForTimeout(200)
await P('.sub').dblclick()
await page.waitForTimeout(250)
let spy = await readSpy()
t('7.4.1', !spy.includes('pointerdown') && !spy.includes('mousedown')
  && !spy.includes('click') && !spy.includes('dblclick') && !spy.includes('contextmenu'),
  `点面板头部时页面的 document 监听收不到「按下」类事件（收到：${[...new Set(spy)].join(',') || '无'}）`)

// 面板里的输入框不 preventDefault 指针事件，鼠标兼容事件才发得出来，
// 用它来验「收尾事件不拦」这一条（头部有拖拽逻辑，会连 mouseup 一起吃掉）
await armSpy()
const radiusInput = P('input[data-prop="border-radius"]').first()
await radiusInput.scrollIntoViewIfNeeded()
await radiusInput.click()
await page.waitForTimeout(250)
spy = await readSpy()
t('7.4.1', !spy.includes('pointerdown') && !spy.includes('mousedown') && !spy.includes('click'),
  `点面板里的控件同样被隔离（收到：${[...new Set(spy)].join(',') || '无'}）`)
t('7.4.2', spy.includes('pointerup') && spy.includes('mouseup'),
  `pointerup / mouseup 照常放行——拦了缩放拖拽就结束不了（收到：${[...new Set(spy.filter(x => /up$/.test(x)))].join(',') || '无'}）`)

await armSpy()
await page.locator('.card-body').first().click()
await page.waitForTimeout(300)
spy = await readSpy()
t('7.4.3', spy.includes('pointerdown') && spy.includes('mousedown') && spy.includes('mouseup'),
  `点页面自己的区域时按下类事件照常冒到 document，页面的 outside-click 生效`
  + `（收到：${[...new Set(spy)].join(',')}；click 被选择引擎 selectable.js:107 吞掉，那是选中逻辑不是本条隔离）`)

// ══════════════════════════════════════════════════════════════
console.log('── 7.5 共享元素（同构联动）')
// ══════════════════════════════════════════════════════════════
await reset()

// 7.5.2 指纹按结构算
const fp = await page.evaluate(() => {
  const { fingerprint, findSharedElements } = window.__visualRevise.lib
  const cards = [...document.querySelectorAll('.curve-card')]
  const title = document.querySelector('.hero-title')
  const probe = document.createElement('article')
  probe.className = 'curve-card'
  probe.innerHTML = '<div class="swatch"></div><h2 class="card-title">别的字</h2>'
    + '<span class="card-tag">别的标</span><p class="card-body">完全不同的一段话</p>'
  document.querySelector('.cards').appendChild(probe)
  const out = {
    same: fingerprint(cards[0]) === fingerprint(cards[1]),
    textIrrelevant: fingerprint(cards[0]) === fingerprint(probe),
    differs: fingerprint(cards[0]) !== fingerprint(title),
    depth2: fingerprint(cards[0], 2) !== fingerprint(cards[0], 0),
    found: findSharedElements(cards[1]).length,
  }
  probe.remove()
  return out
})
t('7.5.2', fp.same && fp.textIrrelevant && fp.differs,
  '指纹按结构算：同构相同、文本不同不影响、结构不同则不同')
t('7.5.2', fp.depth2 && fp.found === 3,
  `深度 2 会带上子结构，同页找到 ${fp.found} 个同构元素`)

// 7.5.1 / 7.5.4 开启后写入落到全集
await select('.curve-card')
await ensureShared(true)
t('7.5.4', (await P('.sub').textContent()).includes('联动 3 个'),
  `面板副标题显示联动数量：${await P('.sub').textContent()}`)
t('7.5.4', (await panelToast()).includes('同步 3 个同构元素'),
  `开启时给出提示：${await panelToast()}`)
await writeField('border-radius', '9')
const radii = await page.evaluate(() =>
  [...document.querySelectorAll('.curve-card')].map(c => c.style.borderRadius))
t('7.5.1', radii.length === 3 && radii.every(r => r === '9px'),
  `开启后面板写入落到全部同构元素（${radii.join(' / ')}）`)
await ensureShared(false)
await writeField('opacity', '70')
const ops = await page.evaluate(() =>
  [...document.querySelectorAll('.curve-card')].map(c => c.style.opacity || '-'))
t('7.5.1', ops.filter(o => o !== '-').length === 1,
  `关闭后只改当前元素（${ops.join(' / ')}）`)

// 7.5.5 换选元素时重算同构集
await page.evaluate(() => {
  const w = document.createElement('div')
  w.id = 'vr-lone'
  w.style.cssText = 'position:absolute;left:20px;top:700px'
  w.innerHTML = '<p class="lone-kid">独一份</p>'
  document.body.appendChild(w)
})
await select('.curve-card')
await ensureShared(true)
const beforeSwitch = await page.evaluate(() => window.__visualRevise.panel.sharedCount)
await select('.lone-kid')
await page.waitForTimeout(350)
const afterSwitch = await page.evaluate(() => window.__visualRevise.panel.sharedCount)
t('7.5.5', beforeSwitch === 2 && afterSwitch === 0,
  `换选元素时重新计算同构集（卡片 ${beforeSwitch} 个 → 独一份 ${afterSwitch} 个）`)
t('7.5.5', (await P('.sub').textContent()).includes('未改动')
  && !(await P('.sub').textContent()).includes('联动'),
  `没有同构兄弟时副标题不再显示联动：${await P('.sub').textContent()}`)

// 7.5.3 结构树重排：同父按下标联动，跨容器只作用于当前元素
await reset()
await page.evaluate(() => {
  document.getElementById('vr-lone')?.remove()
  document.getElementById('vr-sw')?.remove()
  const w = document.createElement('div')
  w.id = 'vr-sw'
  w.style.cssText = 'position:absolute;left:20px;top:700px'
  w.innerHTML =
    '<div class="grp" style="padding:4px"><p class="g">A1</p><p class="g">A2</p></div>' +
    '<div class="grp" style="padding:4px"><p class="g">B1</p><p class="g">B2</p></div>'
  document.body.appendChild(w)
})
const groups = () => page.evaluate(() =>
  [...document.querySelectorAll('#vr-sw .grp')]
    .map(g => [...g.children].map(k => k.textContent.trim()).join(',')).join(' / '))

const rowBoxOf = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree')?.shadowRoot
  if (!sr) return null
  const row = [...sr.querySelectorAll('.row')].find(r => r.dataset.id === el.__visualReviseId)
  if (!row) return null
  row.scrollIntoViewIfNeeded ? row.scrollIntoViewIfNeeded() : row.scrollIntoView({ block: 'nearest' })
  const r = row.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}, sel)

const dragRow = async (from, to, frac) => {
  const a = await rowBoxOf(from)
  const b = await rowBoxOf(to)
  if (!a || !b) return false
  const y = frac === 0 ? b.top + 2 : frac === 1 ? b.top + b.height - 2 : b.top + b.height / 2
  await page.mouse.move(a.left + 60, a.top + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.left + 60, a.top + a.height / 2 + 6, { steps: 3 })
  await page.mouse.move(a.left + 60, y, { steps: 10 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForTimeout(450)
  return true
}

await select('#vr-sw .grp:nth-of-type(2) .g')
await select('#vr-sw .grp:nth-of-type(1) .g')
await ensureShared(true)
await P('.tab[data-tab="structure"]').click()
await page.waitForTimeout(450)
const dragged = await dragRow('#vr-sw .grp:nth-of-type(1) .g:nth-of-type(1)',
                              '#vr-sw .grp:nth-of-type(1) .g:nth-of-type(2)', 1)
t('7.5.3', dragged && await groups() === 'A2,A1 / B2,B1',
  `共享开着时同父级换位按下标联动到同构容器（${await groups()}）`)

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(400)
const grpBox = await page.evaluate(() => {
  const el = document.querySelectorAll('#vr-sw .grp')[1]
  const sr = document.querySelector('visual-revise-panel').shadowRoot
    .querySelector('visual-revise-tree').shadowRoot
  const row = [...sr.querySelectorAll('.row')].find(r => r.dataset.id === el.__visualReviseId)
  if (!row) return null
  row.scrollIntoViewIfNeeded?.()
  const r = row.getBoundingClientRect()
  return { left: r.left, top: r.top, height: r.height }
})
const a1Box = await rowBoxOf('#vr-sw .grp:nth-of-type(1) .g:nth-of-type(1)')
if (a1Box && grpBox) {
  await page.mouse.move(a1Box.left + 60, a1Box.top + a1Box.height / 2)
  await page.mouse.down()
  await page.mouse.move(a1Box.left + 60, a1Box.top + a1Box.height / 2 + 6, { steps: 3 })
  await page.mouse.move(a1Box.left + 60, grpBox.top + grpBox.height / 2, { steps: 10 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForTimeout(500)
}
t('7.5.3', await groups() === 'A2 / B1,B2,A1',
  `跨容器移动只作用于当前元素（${await groups()}）`)
t('7.5.3', (await panelToast()).includes('跨容器移动只作用于当前元素'),
  `并给出提示：「${await panelToast()}」`)

await page.evaluate(() => {
  window.__visualRevise.store.undoEverything()
  document.getElementById('vr-sw')?.remove()
})
await page.waitForTimeout(300)

// ══════════════════════════════════════════════════════════════
console.log('── 7.2.11 CSP 禁 data: 图片时的降级（独立固件）')
// ══════════════════════════════════════════════════════════════
await page.goto(`${origin}/full/fixtures/export-comments-misc-csp.html`)
await injectVisBug(page, origin)
await page.waitForTimeout(600)
await page.evaluate(() => window.__visualRevise.setMode('comment'))
await page.waitForTimeout(250)
await page.locator('.note').click()
await page.waitForTimeout(400)
nextFiles({ name: 'csp-shot.png', mimeType: 'image/png', buffer: PNG })
await CM('.add-image').click()
await page.waitForTimeout(1200)
const degraded = await page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer').shadowRoot
  return {
    chipImg: sr.querySelectorAll('.chip img').length,
    chipBadge: sr.querySelector('.chip-noimg')?.textContent,
    refImg: sr.querySelectorAll('.ref-thumb img').length,
    refBadge: sr.querySelector('.ref-thumb.ref-noimg')?.textContent,
    refTitle: sr.querySelector('.ref-thumb.ref-noimg')?.getAttribute('title'),
    size: sr.querySelector('.ref-size')?.textContent,
    refs: sr.querySelectorAll('.ref').length,
  }
})
t('7.2.11', degraded.refs === 1 && degraded.chipImg === 0 && degraded.chipBadge === 'PNG',
  `页面禁 data: 图时 chip 降级成类型徽标（${degraded.chipBadge}）`)
t('7.2.11', degraded.refImg === 0 && degraded.refBadge === 'PNG'
  && (degraded.refTitle || '').includes('本页禁止内嵌图片预览') && !!degraded.size,
  `说明区降级成「类型 + 体积」文字条目（${degraded.refBadge} · ${degraded.size}）`)

// ══════════════════════════════════════════════════════════════
console.log('── 7.6 右键菜单')
// ══════════════════════════════════════════════════════════════
skip('7.6.1', '需要真实扩展环境：chrome.contextMenus 注册与 chrome.action.onClicked '
  + '都只存在于已安装扩展的 service worker 里，无头页面里既建不出菜单也点不到它')
skip('7.6.2', '同上；且颜色格式 / 配色方案是经 chrome.tabs.sendMessage 送到内容脚本'
  + '（extension/toolbar/inject.js:71-79，跑在隔离世界），Playwright 页面里没有这条通道')

await browser.close(); await close()
console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`)
