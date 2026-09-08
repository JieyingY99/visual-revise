// ⌘⇧R：用剪贴板里的东西替换选中的元素（Figma 的 Paste to replace）。
// 三种来源（HTML / 图片 / 纯文本）、位置与选中态、⌘Z 一次退回、多选、
// JSON 往返、输入框里不抢浏览器的硬刷新、Windows 变体。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [page exception]', e.message))

console.log('\n[替换元素测试] ⌘⇧R Paste to replace\n')

// 读剪贴板要权限，写也要——两边都给
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
await page.bringToFront()
await page.goto(origin)
await injectVisBug(page, origin)

const evalp = fn => page.evaluate(fn)
const reload = async () => { await page.goto(origin); await injectVisBug(page, origin) }

// .cards 的孩子里混着编辑器自己的节点时，下标就对不上了，先滤掉
const kids = () => evalp(() =>
  Array.from(document.querySelector('.cards').children)
    .filter(el => !/^(VIS-BUG|VISBUG-|VISUAL-REVISE-)/.test(el.tagName))
    .map(el => el.className || el.tagName.toLowerCase()))

const store = fn => page.evaluate(fn)

// ── 剪贴板写入 ──────────────────────────────────────────────
const putHTML = html => page.evaluate(async src => {
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([src], { type: 'text/html' }),
  })])
}, html)

const putPNG = () => page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 120; c.height = 60
  const g = c.getContext('2d')
  g.fillStyle = '#ff3366'; g.fillRect(0, 0, 120, 60)
  const blob = await new Promise(r => c.toBlob(r, 'image/png'))
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
})

const putText = text => page.evaluate(async t => {
  await navigator.clipboard.write([new ClipboardItem({
    'text/plain': new Blob([t], { type: 'text/plain' }),
  })])
}, text)

// 选中一张卡片。position 避开子元素，点到 article 自己身上
const pickCard = async n => {
  await page.locator('.curve-card').nth(n).click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(300)
}

const hitReplace = async () => {
  await page.keyboard.press('Meta+Shift+KeyR')
  await page.waitForTimeout(700)
}

// ── 环境自检：剪贴板 API 在这个 headless 里真的能用吗 ────────
await pickCard(0)
await putHTML('<div class="probe">x</div>')
const clip = await evalp(async () => {
  try {
    const items = await navigator.clipboard.read()
    return { ok: true, types: Array.from(items[0]?.types || []) }
  } catch (err) { return { ok: false, why: String(err?.message || err) } }
})
ok(clip.ok, `剪贴板 read() 可用：${clip.ok ? clip.types.join(', ') : clip.why}`)

// ── 1. HTML 替换 ────────────────────────────────────────────
await reload()
const before = await kids()
ok(before.length === 3, `起始 3 张卡片：${before.join(' | ')}`)

await pickCard(1)
await putHTML('<div class="new-box">NEW BOX</div>')
await hitReplace()

const afterHTML = await kids()
ok(afterHTML.length === 3 && afterHTML[1] === 'new-box',
   `新元素落在原来那个下标上（同父同位）：${afterHTML.join(' | ')}`)
ok((await evalp(() => document.querySelectorAll('.curve-card').length)) === 2,
   '被替换的卡片离开了 DOM')
ok((await evalp(() => document.querySelector('.new-box')?.textContent)) === 'NEW BOX',
   '新元素的内容来自剪贴板里的 HTML')
ok((await evalp(() => document.querySelector('.new-box')?.hasAttribute('data-selected'))) === true,
   '替换完新元素被选中（接着调样式不会落空）')

// ── 记录 ────────────────────────────────────────────────────
const rec = await store(() => {
  const s = window.__visualRevise.store.read()
  const ins = s.inserts[0]
  return {
    inserts:  s.inserts.length,
    removals: s.removals.length,
    label:    ins?.label,
    replaced: ins?.replaced && { tag: ins.replaced.tag, text: ins.replaced.text?.slice(0, 20) },
    // 落点锚点必须指向替换之后仍然存在的元素（第三张卡片），
    // 指向旧元素的话导入方会按老下标删错人
    next:     ins?.nextAnchors?.selector,
    atEnd:    ins?.atEnd,
  }
})
ok(rec.inserts === 1 && rec.removals === 1,
   `一次替换落成「新增 + 删除」一对记录：inserts=${rec.inserts} removals=${rec.removals}`)
ok(rec.replaced?.tag === 'article',
   `新增记录带 replaced 指回旧元素：<${rec.replaced?.tag}> ${rec.replaced?.text}…`)
ok(rec.label === '替换元素', `记录标签是「${rec.label}」`)
ok(!!rec.next && !/new-box/.test(rec.next),
   `落点锚点指向替换后仍在页面上的元素：${rec.next}`)

// ── 改动列表 ────────────────────────────────────────────────
await page.locator('visual-revise-toolbar .list').click()
await page.waitForTimeout(400)
const listText = await page.locator('visual-revise-list .items').innerText()
ok(listText.includes('替换'), `列表里认得出这是一次替换：${listText.split('\n').filter(Boolean).slice(0, 4).join(' / ')}`)
ok(listText.includes('原来是'), '列表写明了「原来是 X」')
await page.locator('visual-revise-toolbar .list').click()
await page.waitForTimeout(250)

// ── 提示词 ──────────────────────────────────────────────────
const prompt = await store(() => {
  const { buildPrompt } = window.__visualRevise.lib
  return buildPrompt(window.__visualRevise.store.read(), { url: 'http://x/' })
})
ok(/### \d+\. 替换：把/.test(prompt), '提示词把这一项写成「替换：把 X 换成…」')
ok(prompt.includes('处替换'), `摘要里单列替换：${prompt.split('\n').find(l => l.startsWith('改动：'))}`)
ok(prompt.includes('这是一次**替换**'), '删除那一段点明了它是替换的另一半')

// ── 2. 一次 ⌘Z 整条退回、⌘⇧Z 重做 ──────────────────────────
await page.keyboard.press('Meta+z')
await page.waitForTimeout(500)
const undone = await kids()
ok(JSON.stringify(undone) === JSON.stringify(before),
   `一次 ⌘Z 退回原元素（不是两次）：${undone.join(' | ')}`)
ok((await store(() => {
  const s = window.__visualRevise.store.read()
  return s.inserts.length + s.removals.length
})) === 0, '撤销后两条记录一起消失')

await page.keyboard.press('Meta+Shift+z')
await page.waitForTimeout(500)
const redone = await kids()
ok(JSON.stringify(redone) === JSON.stringify(afterHTML),
   `⌘⇧Z 重做回替换后的样子：${redone.join(' | ')}`)

// ── 3. 图片替换 ─────────────────────────────────────────────
await reload()
await pickCard(0)
const slotWidth = await evalp(() =>
  Math.round(document.querySelectorAll('.curve-card')[0].getBoundingClientRect().width))
await putPNG()
await hitReplace()

const img = await evalp(() => {
  const el = document.querySelector('.cards > img')
  return el && {
    src:   el.getAttribute('src')?.slice(0, 22),
    w:     Number(el.getAttribute('width')),
    h:     Number(el.getAttribute('height')),
    index: Array.from(el.parentElement.children).indexOf(el),
    selected: el.hasAttribute('data-selected'),
  }
})
ok(!!img && img.src?.startsWith('data:image/png'),
   `图片替换造出 <img src="dataURL">：${img?.src}…`)
ok(img.index === 0 && (await evalp(() => document.querySelectorAll('.curve-card').length)) === 2,
   `图片落在第 0 张卡片的位置上：index=${img?.index}`)
ok(img.w === slotWidth,
   `宽度锁原元素的槽位（${slotWidth}px），不用图片原始尺寸把布局撑变形：width=${img?.w}`)
ok(img.h === Math.round(slotWidth * 60 / 120),
   `高度按图片自己的比例算，不被挤扁：height=${img?.h}（期望 ${Math.round(slotWidth * 60 / 120)}）`)
ok(img.selected, '换上来的图片被选中')

// ── 4. 纯文本替换 ───────────────────────────────────────────
await reload()
await pickCard(2)
await putText('这里以后放一段说明')
await hitReplace()

const span = await evalp(() => {
  const el = document.querySelector('.cards > span')
  return el && { text: el.textContent, index: Array.from(el.parentElement.children).indexOf(el) }
})
ok(span?.text === '这里以后放一段说明' && span.index === 2,
   `纯文本装进 <span> 并落在原位：index=${span?.index} 「${span?.text}」`)

// ── 5. 多选一次替换两处 ─────────────────────────────────────
await reload()
await pickCard(0)
await page.locator('.curve-card').nth(2).click({ position: { x: 4, y: 4 }, modifiers: ['Shift'] })
await page.waitForTimeout(300)
const picked = await evalp(() => document.querySelectorAll('.curve-card[data-selected]').length)
ok(picked === 2, `选中了 2 张卡片：${picked}`)

await putHTML('<div class="new-box">NEW BOX</div>')
await hitReplace()

const multi = await kids()
ok(multi[0] === 'new-box' && multi[2] === 'new-box' && multi[1] === 'curve-card',
   `两处各自在原位被替换、中间那张没动：${multi.join(' | ')}`)
ok((await store(() => window.__visualRevise.store.read().inserts.length)) === 2,
   '两条新增记录')

await page.keyboard.press('Meta+z')
await page.waitForTimeout(500)
ok(JSON.stringify(await kids()) === JSON.stringify(before),
   '多选替换也是一次 ⌘Z 整条退回')
await page.keyboard.press('Meta+Shift+z')
await page.waitForTimeout(500)

// ── 6. JSON 往返 ────────────────────────────────────────────
const json = await store(() => window.__visualRevise.lib.exportJSON())
ok(json.schema === 6, `schema 升到 6（替换字段是纯增）：${json.schema}`)
ok(json.inserts?.length === 2 && json.inserts.every(i => i.replaced?.tag === 'article'),
   `导出的新增记录带 replaced：${JSON.stringify(json.inserts?.[0]?.replaced)}`)
ok(json.inserts.every(i => i.replaced.id === undefined),
   'replaced 里不带本会话的元素编号（换个页面它指不到任何东西）')

await reload()
const report = await page.evaluate(data => window.__visualRevise.lib.importJSON(data), json)
await page.waitForTimeout(600)
const imported = await kids()
ok(report.inserts === 2 && report.removals === 2,
   `导入回放了 2 新增 + 2 删除：${JSON.stringify({ i: report.inserts, r: report.removals, missing: report.missing.length })}`)
ok(JSON.stringify(imported) === JSON.stringify(multi),
   `导入后页面和导出时一模一样：${imported.join(' | ')}`)

const afterImport = await store(() => {
  const s = window.__visualRevise.store.read()
  const { buildPrompt } = window.__visualRevise.lib
  return {
    inserts:  s.inserts.length,
    replaced: s.inserts.filter(i => i.replaced).length,
    prompt:   buildPrompt(s, { url: 'http://x/' }),
  }
})
ok(afterImport.replaced === 2, `导入后两条新增仍标着替换：${afterImport.replaced}/${afterImport.inserts}`)
ok(/### \d+\. 替换：把/.test(afterImport.prompt) && afterImport.prompt.includes('这是一次**替换**'),
   '导入后重新导出的提示词仍然说得出「把 X 换成 Y」（靠 identity 重新配对）')

// ── 7. 焦点在输入框里：不抢浏览器的硬刷新 ───────────────────
await reload()
await pickCard(1)
await putHTML('<div class="new-box">NEW BOX</div>')

const typing = await evalp(() => {
  const input = document.createElement('input')
  input.className = 'probe-input'
  document.querySelector('.hero').appendChild(input)
  input.focus()

  const ev = new KeyboardEvent('keydown', {
    key: 'R', code: 'KeyR', metaKey: true, shiftKey: true,
    bubbles: true, cancelable: true, composed: true,
  })
  return { notPrevented: input.dispatchEvent(ev) }
})
await page.waitForTimeout(500)
ok(typing.notPrevented, '焦点在输入框里：事件没有被 preventDefault（浏览器的硬刷新照常）')
ok((await evalp(() => document.querySelectorAll('.curve-card').length)) === 3,
   '焦点在输入框里：什么都没被替换')

// ── 7b. 焦点在面板按钮上：照样触发 ──────────────────────────
// 点完「联动」这类面板按钮，焦点就留在面板里。守卫只挡「正在打字」，
// 不挡「焦点在编辑器 UI 上」——面板里没有控件用得到 ⌘⇧R，
// 拦下来只会让刚点过面板这个状态莫名其妙地把快捷键吃掉
await reload()
await pickCard(1)
await page.locator('visual-revise-panel .shared').click()
await page.waitForTimeout(400)

const focus = await evalp(() => {
  const host = document.activeElement
  const inner = host?.shadowRoot?.activeElement
  return { host: host?.tagName, inner: inner?.className }
})
ok(focus.host === 'VISUAL-REVISE-PANEL' && /shared/.test(focus.inner || ''),
   `焦点确实留在面板的「联动」按钮上：${focus.host} › .${focus.inner}`)

await putHTML('<div class="new-box">NEW BOX</div>')
await hitReplace()
const fromPanel = await kids()
ok(fromPanel[1] === 'new-box',
   `焦点在面板按钮上时 ⌘⇧R 仍然生效：${fromPanel.join(' | ')}`)

// ══ §4.7 复核补测（4.7.1 守卫 / 4.7.5 / 4.7.6 反向 / 4.7.8）════
// 这一段必须排在下面的「伪装 Windows」之前：addInitScript 一装上就回不去了

let navCount = 0
page.on('framenavigated', () => navCount++)

const fireOn = init => page.evaluate(i => ({
  notPrevented: document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...i })),
}), init)
const feedback = () => page.evaluate(() => {
  const inPanel = document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector('.toast')
  const onBody = document.getElementById('visual-revise-toast')
  return {
    panel: inPanel?.hasAttribute('data-show') ? inPanel.textContent.trim() : '',
    body: onBody && onBody.style.opacity === '1' ? onBody.textContent.trim() : '',
  }
})
const clearSelection = async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
}

// ── 4.7.5 与浏览器硬刷新同键位：接管了就绝不能让页面重新导航 ──
await reload()
await pickCard(1)
await putHTML('<div class="new-box">NEW BOX</div>')
await evalp(() => { window.__vrAlive = 'yes' })
navCount = 0
await hitReplace()
ok(navCount === 0 && (await evalp(() => window.__vrAlive)) === 'yes',
   `4.7.5 ⌘⇧R 被 preventDefault 挡住了浏览器硬刷新：这一段里 framenavigated 触发 ${navCount} 次（期望 0）、页面上的标记还在`)
ok((await kids())[1] === 'new-box', `4.7.5 同一次按键完成了替换：${(await kids()).join(' | ')}`)

// ── AC-8.11 新增元素在改动列表里单独成行 ────────────────────
await page.locator('visual-revise-toolbar .list').click()
await page.waitForTimeout(400)
const rowText = await page.locator('visual-revise-list .items').innerText()
ok(/new-box/.test(rowText),
   `AC-8.11 新增的元素在改动列表里按「新增元素」成行、认得出是谁：${rowText.split('\n').filter(Boolean)[0]}`)
await page.locator('visual-revise-toolbar .list').click()
await page.waitForTimeout(250)

// ── 4.7.8 接管后 stopPropagation，不再往下走 ────────────────
await reload()
await pickCard(1)
await putHTML('<div class="new-box">NEW BOX</div>')
await evalp(() => {
  window.__vrSeen = []
  document.addEventListener('keydown', e => window.__vrSeen.push(e.code || e.key))
})
await hitReplace()
const seenR = await evalp(() => window.__vrSeen)
ok(!seenR.includes('KeyR'),
   `4.7.8 ⌘⇧R 被接管后 stopPropagation，document 冒泡阶段收不到（收到 ${JSON.stringify(seenR)}）`)
await page.keyboard.press('Meta+Shift+KeyQ'); await page.waitForTimeout(300)
ok((await evalp(() => window.__vrSeen)).includes('KeyQ'),
   '4.7.8 对照组：没人接管的 ⌘⇧Q 照常冒泡到 document（证明监听本身有效）')

// ── 4.7.6 反向条件：Mac 上按 Windows 的 Ctrl+Shift+R 不接管 ──
await reload()
await pickCard(1)
await putHTML('<div class="new-box">NEW BOX</div>')
const macCtrlR = await fireOn({ key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true })
await page.waitForTimeout(700)
ok(macCtrlR.notPrevented && (await evalp(() => document.querySelectorAll('.curve-card').length)) === 3,
   `4.7.6 Mac 上 Ctrl+Shift+R 不接管（isMod 只认 ⌘）：事件原样放行=${macCtrlR.notPrevented}、三张卡一张没换`)

// ── 4.7.1 守卫：交互态 / 弹层 / 浏览模式 ────────────────────
await evalp(() => window.__visualRevise.enterInteractive()); await page.waitForTimeout(300)
const inInteractive = await fireOn({ key: 'R', code: 'KeyR', metaKey: true, shiftKey: true })
await page.waitForTimeout(700)
ok(inInteractive.notPrevented && (await evalp(() => document.querySelectorAll('.curve-card').length)) === 3,
   `4.7.1 交互态下 ⌘⇧R 不接管、放行给浏览器（notPrevented=${inInteractive.notPrevented}、卡片仍是 3 张）`)
await evalp(() => window.__visualRevise.exitInteractive()); await page.waitForTimeout(400)

// 交互态退出时选中集原样恢复，卡片身上又盖回了 visbug-handles，
// 直接点会被判定拦截——先取消选中再点
await clearSelection()
await pickCard(1)
await page.locator('visual-revise-panel vr-select[data-prop="position"]').click(); await page.waitForTimeout(400)
ok(await evalp(() => !!document.getElementById('visual-revise-select-panel')),
   '4.7.1 前置：position 下拉已打开')
const inPopup = await fireOn({ key: 'R', code: 'KeyR', metaKey: true, shiftKey: true })
await page.waitForTimeout(700)
ok(inPopup.notPrevented && (await evalp(() => document.querySelectorAll('.curve-card').length)) === 3,
   `4.7.1 有弹层开着时 ⌘⇧R 不接管（notPrevented=${inPopup.notPrevented}、卡片仍是 3 张）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await evalp(() => document.activeElement?.blur?.())

await evalp(() => window.__visualRevise.setMode('browse')); await page.waitForTimeout(400)
const inBrowse = await fireOn({ key: 'R', code: 'KeyR', metaKey: true, shiftKey: true })
await page.waitForTimeout(700)
ok(inBrowse.notPrevented && (await evalp(() => document.querySelectorAll('.curve-card').length)) === 3,
   `4.7.1 浏览模式下 ⌘⇧R 不接管（notPrevented=${inBrowse.notPrevented}、卡片仍是 3 张）`)
await evalp(() => window.__visualRevise.setMode('select')); await page.waitForTimeout(400)

// ── 4.7.1 / 4.7.5 没有选中元素时：要么放行、要么给可见提示 ──
await reload()
await putHTML('<div class="new-box">NEW BOX</div>')
await clearSelection()
ok((await evalp(() => document.querySelectorAll('[data-selected]').length)) === 0,
   `4.7.5 前置：页面上没有任何选中元素（${await evalp(() => document.querySelectorAll('[data-selected]').length)} 个）`)
const noSel = await fireOn({ key: 'R', code: 'KeyR', metaKey: true, shiftKey: true })
await page.waitForTimeout(800)
const noSelFeedback = await feedback()
ok((await evalp(() => document.querySelectorAll('.curve-card').length)) === 3,
   '4.7.5 没有选中元素时不会误替换任何东西（三张卡都在）')
ok(noSel.notPrevented || !!(noSelFeedback.panel || noSelFeedback.body),
   `4.7.5 没有选中元素时要么放行给浏览器硬刷新、要么给一条看得见的提示；实际 preventDefault=${!noSel.notPrevented}、面板 toast「${noSelFeedback.panel}」、body toast「${noSelFeedback.body}」`)
// 「选中集为空」是同步就能判定的，不该等 run() 里 await 完剪贴板才发现：
// 那时 preventDefault 已经把浏览器的硬刷新吃掉了
ok(noSel.notPrevented,
   `4.7.5 没有选中元素时这一键原样放行，浏览器的硬刷新照常（notPrevented=${noSel.notPrevented}）`)
// 面板空态里没有 .toast 落点，提示只能挂在 body 上才看得见
ok(/先选中要被替换的元素/.test(noSelFeedback.body || noSelFeedback.panel),
   `4.7.5 放行的同时仍给一条看得见的提示（body toast「${noSelFeedback.body}」/ 面板 toast「${noSelFeedback.panel}」）`)

// ── 8. Windows 变体：Ctrl+Shift+R ───────────────────────────
// isMac 是模块加载时算出来的，平台伪装必须赶在注入 bundle 之前
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
  Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'Windows' }) })
})
await reload()
ok((await evalp(() => navigator.userAgentData?.platform)) === 'Windows', '平台已伪装成 Windows')

await pickCard(1)
await putHTML('<div class="new-box">NEW BOX</div>')
const win = await evalp(() => {
  const ev = new KeyboardEvent('keydown', {
    key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true,
    bubbles: true, cancelable: true, composed: true,
  })
  return { prevented: !document.body.dispatchEvent(ev) }
})
await page.waitForTimeout(700)
ok(win.prevented, 'Windows 上 Ctrl+Shift+R 被接管（preventDefault 挡住硬刷新）')
const winKids = await kids()
ok(winKids[1] === 'new-box', `Windows 变体同样完成替换：${winKids.join(' | ')}`)

// Mac 上的 ⌘⇧R 在伪装成 Windows 之后不该再被接管
await reload()
await pickCard(0)
const macOnWin = await evalp(() => {
  const ev = new KeyboardEvent('keydown', {
    key: 'R', code: 'KeyR', metaKey: true, shiftKey: true,
    bubbles: true, cancelable: true, composed: true,
  })
  return { notPrevented: document.body.dispatchEvent(ev) }
})
await page.waitForTimeout(400)
ok(macOnWin.notPrevented && (await evalp(() => document.querySelectorAll('.curve-card').length)) === 3,
   'Windows 上按 ⌘⇧R 不接管（另一边的修饰键按着不算，见 hotkey.js 的 isMod）')

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
