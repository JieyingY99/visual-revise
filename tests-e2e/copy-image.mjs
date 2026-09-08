// ⌘⇧C（Windows 上 Ctrl+Shift+C）：把选中元素连同子元素复制成一张 PNG 进剪贴板。
// 多选取所有外接矩形的并集，仍然只出一张图。
//
// 这里跑的是 DOM 重绘那条退路：没装扩展就没有截图通道，页面自己把元素重画一遍。
// 真 captureVisibleTab 那条通道要装着扩展才跑得起来（Chrome for Testing +
// --load-extension），不在这个套件里；它的验证脚本在会话 scratchpad 的
// ext-capture.mjs 里，改动这条通道时记得一并跑一遍。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

console.log('\n[⌘⇧C 复制为图片]\n')
await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

// 夹具本身不够高，滚不动就验不出「截完滚回原位」
await page.evaluate(() => {
  const pad = document.createElement('div')
  pad.id = 't-pad'
  pad.style.height = '1400px'
  document.body.appendChild(pad)
  window.scrollTo({ top: 180, behavior: 'instant' })
})
await page.waitForTimeout(200)

const stamp = () => page.evaluate(() => window.__visualReviseCopyImage?.at || 0)
const waitCopy = async before => {
  await page.waitForFunction(t => (window.__visualReviseCopyImage?.at || 0) > t, before, { timeout: 20000 })
  return page.evaluate(() => window.__visualReviseCopyImage)
}
// 提示落在两处：选中了元素时在属性面板的 toast 里，什么都没选中时面板是空的，
// 消息走 vr-toast 到工具条那个挂在 body 上的 toast
const toastText = () => page.evaluate(() => {
  const inPanel = document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector('.toast')
  if (inPanel?.hasAttribute('data-show')) return inPanel.textContent
  const onBody = document.getElementById('visual-revise-toast')
  return onBody && onBody.style.opacity === '1' ? onBody.textContent : ''
})

// 从剪贴板把图读回来解码，顺带统计不透明像素比例与颜色数——
// 尺寸对但一片透明 / 纯色，说明画上去的东西是空的
const readClipboardPng = () => page.evaluate(async () => {
  const items = await navigator.clipboard.read()
  for (const item of items) {
    if (!item.types.includes('image/png')) continue
    const blob = await item.getType('image/png')
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const g = c.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data
    let opaque = 0
    const colors = new Set()
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) opaque++
      if ((i / 4) % 37 === 0 && colors.size < 500)
        colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
    }
    return { w: bmp.width, h: bmp.height, bytes: blob.size, opaque: opaque / (d.length / 4), colors: colors.size }
  }
  return null
})

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

// ── 1. 没选中任何元素 ───────────────────────────────────────
const t0 = await stamp()
await page.keyboard.press('Meta+Shift+C')
await page.waitForTimeout(700)
ok(await stamp() === t0, '没有选中元素时不产出图片')
ok(/先选中/.test(await toastText()), `没有选中元素时提示「${await toastText()}」`)

// ── 2. 单选一张卡 ───────────────────────────────────────────
await page.locator('.curve-card').first().click({ position: { x: 120, y: 8 } })
await page.waitForTimeout(400)
const one = await page.evaluate(() => {
  const sel = [...document.querySelectorAll('[data-selected]')]
  const r = document.querySelector('.curve-card').getBoundingClientRect()
  return { n: sel.length, tag: sel[0]?.className, w: r.width, h: r.height, dpr: devicePixelRatio }
})
ok(one.n === 1 && /curve-card/.test(one.tag || ''), `选中一张卡（${one.n} 个，${one.tag}）`)

const t1 = await stamp()
await page.keyboard.press('Meta+Shift+C')
const r1 = await waitCopy(t1)
ok(r1.mode === 'fallback', `没装扩展时走 DOM 重绘退路（mode=${r1.mode}）`)

const png1 = await readClipboardPng()
ok(!!png1, `剪贴板里拿到 image/png（${png1?.bytes} 字节）`)
ok(png1 && near(png1.w, one.w * one.dpr) && near(png1.h, one.h * one.dpr),
  `图片尺寸 ≈ 元素矩形 × DPR：${png1?.w}×${png1?.h}，期望 ${Math.round(one.w * one.dpr)}×${Math.round(one.h * one.dpr)}`)
ok(png1 && png1.opaque > 0.99, `整张图不透明（不透明像素 ${(png1?.opaque * 100).toFixed(1)}%）`)
ok(png1 && png1.colors > 5, `画进去的是内容不是一块纯色（采样到 ${png1?.colors} 种颜色）`)

// ── 3. 多选两张卡：一张图，尺寸是并集 ──────────────────────
// 第一张已经选中了，直接 Shift 点第二张加进来。
// 不重新点第一张：它自己的 visbug-handles 盖在上面，Playwright 会判定点击被拦
await page.locator('.curve-card').nth(1).click({ position: { x: 120, y: 8 }, modifiers: ['Shift'] })
await page.waitForTimeout(400)
const two = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.curve-card')].slice(0, 2).map(c => c.getBoundingClientRect())
  const l = Math.min(...cards.map(r => r.left)), t = Math.min(...cards.map(r => r.top))
  const rr = Math.max(...cards.map(r => r.right)), b = Math.max(...cards.map(r => r.bottom))
  return { n: document.querySelectorAll('[data-selected]').length, w: rr - l, h: b - t, dpr: devicePixelRatio }
})
ok(two.n === 2, `Shift 点第二张，选中变成 ${two.n} 个`)

const t2 = await stamp()
await page.keyboard.press('Meta+Shift+C')
const r2 = await waitCopy(t2)
const png2 = await readClipboardPng()
ok(png2 && near(png2.w, two.w * two.dpr) && near(png2.h, two.h * two.dpr),
  `多选只出一张图，尺寸 ≈ 并集矩形：${png2?.w}×${png2?.h}，期望 ${Math.round(two.w * two.dpr)}×${Math.round(two.h * two.dpr)}`)
ok(png2 && png2.w > png1.w, `并集比单张宽（${png2?.w} > ${png1?.w}）`)
ok(/已复制 \d+×\d+ 图片/.test(await toastText()), `成功提示「${await toastText()}」`)

// ── 4. 截完之后编辑器 UI 与滚动位置都回来了 ────────────────
const after = await page.evaluate(() => {
  const vis = sel => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).display !== 'none' : null
  }
  const handles = [...document.querySelectorAll('visbug-handles')]
  return {
    hideStyle: !!document.getElementById('visual-revise-capture-hide'),
    panel: vis('visual-revise-panel'),
    toolbar: vis('visual-revise-toolbar'),
    comments: vis('visual-revise-comment-layer'),
    visbug: vis('vis-bug'),
    handles: handles.length,
    handlesShown: handles.every(h => getComputedStyle(h).display !== 'none'),
    scrollY: Math.round(scrollY),
  }
})
ok(!after.hideStyle, '临时的隐藏样式表已经删掉')
ok(after.panel && after.toolbar && after.comments,
  `面板 / 工具条 / 批注层都恢复可见（${after.panel} ${after.toolbar} ${after.comments}）`)
ok(after.handles > 0 && after.handlesShown, `选中框恢复可见（${after.handles} 个 visbug-handles）`)
ok(after.scrollY === 180, `页面滚动位置回到原处（scrollY=${after.scrollY}）`)

// ── 5. 焦点在输入框里不触发 ─────────────────────────────────
await page.evaluate(() => {
  const i = document.createElement('input')
  i.id = 't-input'
  document.body.appendChild(i)
  i.focus()
})
const t3 = await stamp()
await page.keyboard.press('Meta+Shift+C')
await page.waitForTimeout(900)
ok(await stamp() === t3, '焦点在页面输入框里时 ⌘⇧C 不触发')
await page.evaluate(() => document.getElementById('t-input')?.remove())

// ── 5b. 焦点在面板里：按钮上照样触发，输入框里仍然让路 ──────
// 点完面板上的按钮焦点就留在面板里，这时按 ⌘⇧C 该出图；
// 但焦点在面板的输入框里时还是要让给用户打字
const focusInPanel = sel => page.evaluate(s => {
  const el = document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector(s)
  el?.focus()
  return !!el
}, sel)

ok(await focusInPanel('.shared'), '找到面板上的「共享元素」按钮并聚焦')
const t4 = await stamp()
await page.keyboard.press('Meta+Shift+C')
const r4 = await waitCopy(t4)
ok(!!r4 && !r4.error, `焦点在面板按钮上时 ⌘⇧C 仍触发（${r4?.width}×${r4?.height}）`)

ok(await focusInPanel('input'), '找到面板上的输入框并聚焦')
const t5 = await stamp()
await page.keyboard.press('Meta+Shift+C')
await page.waitForTimeout(900)
ok(await stamp() === t5, '焦点在面板输入框里时 ⌘⇧C 不触发')
await page.evaluate(() => document.activeElement?.blur?.())

// ── 6. Windows：只认 Ctrl+Shift+C ───────────────────────────
// isMac 是模块加载时算的，平台得在注入 bundle 之前就伪装好。
// Chrome 优先读 navigator.userAgentData.platform，只改 navigator.platform 不够
const win = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await win.context().grantPermissions(['clipboard-read', 'clipboard-write'])
win.on('pageerror', e => console.log('  [Win 页面异常]', e.message))
await win.addInitScript(() => {
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => ({ platform: 'Windows', brands: [], mobile: false }),
  })
})
await win.bringToFront()
await win.goto(origin)
await injectVisBug(win, origin)
await win.waitForTimeout(400)
await win.locator('.curve-card').first().click({ position: { x: 120, y: 8 } })
await win.waitForTimeout(400)

const fire = mods => win.evaluate(m => document.body.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'C', code: 'KeyC', shiftKey: true, bubbles: true, composed: true, cancelable: true, ...m,
})), mods)
// 合成事件拿不到 code 时靠 e.key 兜底
const fireNoCode = mods => win.evaluate(m => document.body.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'C', shiftKey: true, bubbles: true, composed: true, cancelable: true, ...m,
})), mods)

await fire({ metaKey: true })
await win.waitForTimeout(900)
ok(await win.evaluate(() => !window.__visualReviseCopyImage), 'Windows 上 ⌘⇧C 不接（isMod 只认 Ctrl）')

await fire({ ctrlKey: true })
await win.waitForFunction(() => !!window.__visualReviseCopyImage?.at, null, { timeout: 20000 })
  .catch(() => {})
const rw = await win.evaluate(() => window.__visualReviseCopyImage)
const rect = await win.evaluate(() => {
  const r = document.querySelector('.curve-card').getBoundingClientRect()
  return { w: r.width, h: r.height, dpr: devicePixelRatio }
})
ok(!!rw && !rw.error, `Windows 上 Ctrl+Shift+C 出图（${rw?.width}×${rw?.height}${rw?.error ? ' 错误：' + rw.error : ''}）`)
ok(rw && near(rw.width, rect.w * rect.dpr) && near(rw.height, rect.h * rect.dpr),
  `Windows 出的图尺寸也对（期望 ${Math.round(rect.w * rect.dpr)}×${Math.round(rect.h * rect.dpr)}）`)

const t6 = await win.evaluate(() => window.__visualReviseCopyImage?.at || 0)
await fireNoCode({ ctrlKey: true })
await win.waitForFunction(t => (window.__visualReviseCopyImage?.at || 0) > t, t6, { timeout: 20000 })
  .catch(() => {})
ok(await win.evaluate(() => window.__visualReviseCopyImage?.at || 0) > t6,
  '事件里没有 code 时按 e.key 兜底，依然触发')


// ══ §4.7 复核补测（4.7.1 守卫 / 4.7.4 / 4.7.6 反向 / 4.7.8）════
await page.bringToFront()
await page.waitForTimeout(200)

const fireOn = init => page.evaluate(i => ({
  notPrevented: document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...i })),
}), init)
const depth = () => page.evaluate(() => window.__visualRevise.store.history.depth)
const editCount = () => page.evaluate(() => window.__visualRevise.store.read().edits.length)
// 选中元素身上盖着自己的 visbug-handles，直接点会被判定拦截。
// 先两下 Esc（关弹层 / 取消选中）把覆盖层撤掉，再点
const pickOne = async n => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  await page.locator('.curve-card').nth(n).click({ position: { x: 120, y: 8 } })
  await page.waitForTimeout(400)
}

await pickOne(2)
ok((await page.evaluate(() => document.querySelectorAll('[data-selected]').length)) === 1,
  `4.7.4 前置：只选中一张卡（${await page.evaluate(() => document.querySelectorAll('[data-selected]').length)} 个）`)

// ── 4.7.6 反向条件：Mac 上按 Windows 的 Ctrl+Shift+C 不触发 ──
const t7 = await stamp()
const macCtrl = await fireOn({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })
await page.waitForTimeout(900)
ok(macCtrl.notPrevented && (await stamp()) === t7,
  `4.7.6 Mac 上 Ctrl+Shift+C 不触发（isMod 只认 ⌘）：事件原样放行=${macCtrl.notPrevented}、没有新出图`)

// ── 4.7.1 守卫：交互态 / 弹层 / 浏览模式 ────────────────────
await page.evaluate(() => window.__visualRevise.enterInteractive()); await page.waitForTimeout(300)
const t8 = await stamp()
const inInteractive = await fireOn({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true })
await page.waitForTimeout(900)
ok(inInteractive.notPrevented && (await stamp()) === t8,
  `4.7.1 交互态下 ⌘⇧C 不接管（notPrevented=${inInteractive.notPrevented}、没有新出图）`)
await page.evaluate(() => window.__visualRevise.exitInteractive()); await page.waitForTimeout(400)

await pickOne(2)
await page.locator('visual-revise-panel vr-select[data-prop="position"]').click(); await page.waitForTimeout(400)
ok(await page.evaluate(() => !!document.getElementById('visual-revise-select-panel')),
  '4.7.1 前置：position 下拉已打开')
const t9 = await stamp()
const inPopup = await fireOn({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true })
await page.waitForTimeout(900)
ok(inPopup.notPrevented && (await stamp()) === t9,
  `4.7.1 有弹层开着时 ⌘⇧C 不接管（notPrevented=${inPopup.notPrevented}、没有新出图）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await page.evaluate(() => document.activeElement?.blur?.())

await pickOne(2)
await page.evaluate(() => window.__visualRevise.setMode('browse')); await page.waitForTimeout(400)
const t10 = await stamp()
const inBrowse = await fireOn({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true })
await page.waitForTimeout(900)
ok(inBrowse.notPrevented && (await stamp()) === t10,
  `4.7.1 浏览模式下 ⌘⇧C 不接管（notPrevented=${inBrowse.notPrevented}、没有新出图）`)
await page.evaluate(() => window.__visualRevise.setMode('select')); await page.waitForTimeout(400)

// ── 4.7.4 截图是读操作：不进改动记录、不动页面 ───────────────
// 4.7.8 顺带验短路：接管之后 stopPropagation，document 冒泡阶段收不到，
// 也就落不到 onKeydown 里 ⌘Z / 方向键 / ⌥Delete 那几道分支
await pickOne(2)
await page.evaluate(() => {
  window.__vrSeen = []
  document.addEventListener('keydown', e => window.__vrSeen.push(e.code || e.key))
})
const depth0 = await depth(), edits0 = await editCount()
const styleBefore = await page.evaluate(() =>
  document.querySelector('.curve-card[data-selected]')?.getAttribute('style') || '')
const t11 = await stamp()
await page.keyboard.press('Meta+Shift+C')
await waitCopy(t11)
await page.waitForTimeout(300)
ok((await depth()) === depth0 && (await editCount()) === edits0,
  `4.7.4 ⌘⇧C 不产生改动记录（history.depth ${depth0} → ${await depth()}、edits ${edits0} → ${await editCount()}）`)
ok((await page.evaluate(() =>
  document.querySelector('.curve-card[data-selected]')?.getAttribute('style') || '')) === styleBefore,
  `4.7.4 ⌘⇧C 也没有改到页面元素的 inline 样式（仍是「${styleBefore}」）`)
const seenC = await page.evaluate(() => window.__vrSeen)
ok(!seenC.includes('KeyC'),
  `4.7.8 ⌘⇧C 被接管后 stopPropagation，document 冒泡阶段收不到（收到 ${JSON.stringify(seenC)}）`)
await page.keyboard.press('Meta+Shift+KeyX'); await page.waitForTimeout(300)
ok((await page.evaluate(() => window.__vrSeen)).includes('KeyX'),
  '4.7.8 对照组：没人接管的 ⌘⇧X 照常冒泡到 document（证明监听本身有效）')

// ── 4.7.4 失败也要走 ctx.toast ──────────────────────────────
// 把选中的卡片改成 display:none，外接矩形就量不出来，run() 会抛
await page.evaluate(() => window.__visualRevise.store.applyProp(
  document.querySelector('.curve-card[data-selected]'), 'display', 'none'))
await page.waitForTimeout(300)
const depth1 = await depth()
const t12 = await stamp()
await page.keyboard.press('Meta+Shift+C')
await page.waitForFunction(t => (window.__visualReviseCopyImage?.at || 0) > t, t12, { timeout: 20000 })
  .catch(() => {})
await page.waitForTimeout(400)
const failed = await page.evaluate(() => window.__visualReviseCopyImage)
ok(!!failed?.error, `4.7.4 量不出可见区域时截图失败并记下原因（error=${failed?.error}）`)
ok(/失败/.test(await toastText()),
  `4.7.4 失败同样走 ctx.toast 报出来（「${await toastText()}」）`)
ok((await depth()) === depth1,
  `4.7.4 失败的那次也不产生改动记录（history.depth 仍是 ${await depth()}）`)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(400)

await win.close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
await browser.close()
await close()
