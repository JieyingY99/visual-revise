import { serve, launch, injectVisBug, ok } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[Fill 多态测试] 图片预览 / 字色优先 / 属性相关性\n')
await page.goto(origin)
await injectVisBug(page, origin)

// fixture 里没有图片元素，就地造两个：一个 <img>，一个背景图 div。
// 用 canvas 生成 data URI，尺寸是已知的，好断言。
await page.evaluate(async () => {
  const paint = (w, h, color) => {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, w, h)
    return c.toDataURL('image/png')
  }

  const img = document.createElement('img')
  img.className = 'test-img'
  img.src = paint(40, 20, '#44aaff')
  img.style.cssText = 'width:120px;height:60px;display:block;margin:20px'
  document.body.appendChild(img)
  await img.decode()

  // .swatch 带 linear-gradient，不能用来测「无背景图」
  const plain = document.createElement('div')
  plain.className = 'test-plain'
  plain.style.cssText = 'width:120px;height:60px;margin:20px;border:1px solid #ccc'
  document.body.appendChild(plain)

  const bg = document.createElement('div')
  bg.className = 'test-bg'
  bg.style.cssText =
    `width:120px;height:60px;margin:20px;background-image:url("${paint(30, 15, '#ff5c8a')}")`
  document.body.appendChild(bg)
})

const panel  = sel => page.locator(`visual-revise-panel ${sel}`)
const fillRows = () => page.locator('visual-revise-panel section[data-group="fill"] .field')
  .evaluateAll(els => els.map(el => {
    if (el.classList.contains('image-fill')) return `image:${el.dataset.imageKind}`
    if (el.querySelector('vr-fill')) return 'fill-widget'
    return el.querySelector('[data-prop]')?.dataset.prop || '?'
  }))
// label 与控件都带 data-prop，会重复；vr-fill 的是逗号复合值，不是单个属性
const fillProps = () => page.locator('visual-revise-panel section[data-group="fill"] [data-prop]')
  .evaluateAll(els => [...new Set(els.map(el => el.dataset.prop))].filter(p => !p.includes(',')))

const select = async sel => {
  await page.locator(sel).first().click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(450)
}

// ── <img>：Fill 首行是这张图 ────────────────────────────────
await select('.test-img')
const imgRows = await fillRows()
ok(imgRows[0] === 'image:src',
   `选中 <img> 时 Fill 第一行是图片预览：${imgRows.join(' | ')}`)

const thumb = await panel('.image-fill .thumb img').getAttribute('src')
const real  = await page.evaluate(() => document.querySelector('.test-img').currentSrc)
ok(thumb === real, '缩略图用的就是页面上正在显示的那张图（CSP 已放行过，不会裂图）')

const dim = await panel('.image-fill .image-dim').textContent()
ok(dim.trim() === '40 × 20',
   `显示的是天然尺寸而非显示尺寸（元素被拉伸到 120×60）：${dim.trim()}`)

const name = await panel('.image-fill .image-name').textContent()
ok(name.includes('内嵌图片'), `data URI 显示类型而不是整段 base64：${name.trim()}`)

const imgProps = await fillProps()
ok(imgProps.includes('object-fit'), 'img 上出现 object-fit（对应 Figma 的 scaleMode）')
ok(imgProps.indexOf('color') === imgProps.length - 1,
   'color 沉到最后——图片元素的主填充是那张图，不是字色')

// ── 背景图元素 ──────────────────────────────────────────────
await select('.test-bg')
const bgRows = await fillRows()
ok(bgRows[0] === 'image:background',
   `有 background-image 的元素同样显示预览：${bgRows.join(' | ')}`)

await page.waitForTimeout(400)   // 背景图的天然尺寸是异步量的
const bgDim = await panel('.image-fill .image-dim').textContent()
ok(bgDim.trim() === '30 × 15',
   `背景图的天然尺寸异步补齐（CSS 不暴露，要另加载一次来量）：${bgDim.trim()}`)

const bgProps = await fillProps()
ok(bgProps.includes('background-size') && bgProps.includes('background-position'),
   '有背景图时才出现背景尺寸/位置')
ok(!bgProps.includes('object-fit'), 'div 上不出现 object-fit（它没有自身内容可适配）')

// ── 文字元素：字色排第一 ────────────────────────────────────
await select('.card-title')
const textRows = await fillRows()
ok(textRows[0] === 'color',
   `选中文字元素时 Fill 第一行是字色：${textRows.join(' | ')}`)
ok(!textRows.some(r => r.startsWith('image:')), '文字元素没有图片预览行')

// ── 普通容器：无图，字色沉底 ────────────────────────────────
await select('.test-plain')
const plainRows = await fillRows()
ok(!plainRows.some(r => r.startsWith('image:')), '无图元素不显示图片预览行')
const plainProps = await fillProps()
ok(plainProps.indexOf('color') === plainProps.length - 1,
   `普通容器的 color 沉底（背景才是它的主填充）：${plainProps.join(', ')}`)
ok(!plainProps.includes('background-size'),
   '没有背景图时不显示背景尺寸/位置（避免无意义字段占位）')

// 渐变也是 background-image，它的 size/position 同样有效，该显示
await select('.swatch')
const gradProps = await fillProps()
ok(gradProps.includes('background-size'),
   '渐变背景同样显示背景尺寸/位置（渐变也是 background-image）')
const gradRows = await fillRows()
ok(!gradRows.some(r => r.startsWith('image:')),
   '但渐变不显示图片预览——预览只认 url()，渐变没有「一张图」可看')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
