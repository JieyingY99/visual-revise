// ⌥⌘C / ⌥⌘V：复制选中元素的全部属性，整套粘到别的元素上（Figma 的 Copy / Paste properties）。
// 覆盖：属性搬过去、进改动记录、一次 ⌘Z 全退、联动集合一起粘、面板输入框 / 浏览模式下不接管、
// 系统剪贴板里留了一份 JSON、换个标签页只靠这份 JSON 也能粘、Windows 的 Ctrl+Alt+C/V 同样生效。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

console.log('\n[属性复制/粘贴] ⌥⌘C 复制属性 · ⌥⌘V 粘贴属性\n')

// 剪贴板要在导航前授权，⌥⌘C 才写得进去、测试才读得出来
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
await page.goto(origin); await injectVisBug(page, origin); await page.waitForTimeout(400)

// 被搬的那几条：卡片 2 上先造出跟卡片 1 不一样的值。
// 走 store.applyProp 而不是直接写 el.style——跟真实链路一致，也顺带证明
// ⌥⌘C 读的是计算值（inline 与样式表两种来源都要能读到）
const PROBES = ['color', 'padding-left', 'padding-top', 'border-radius', 'width', 'height']
const readCard = (target, i) => target.evaluate(([i, probes]) => {
  const c = getComputedStyle(document.querySelectorAll('.curve-card')[i])
  return probes.reduce((o, p) => (o[p] = c.getPropertyValue(p), o), {})
}, [i, PROBES])
const card = i => readCard(page, i)
const select = i => page.locator('.curve-card').nth(i).click({ position: { x: 120, y: 12 } })
const toast = () => page.evaluate(() =>
  document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector('.toast')?.textContent?.trim() || '')
const recordOf = i => page.evaluate(i => {
  const el = document.querySelectorAll('.curve-card')[i]
  const entry = window.__visualRevise.store.read().edits.find(e => e.el === el)
  return entry ? entry.changes.map(c => c.prop) : []
}, i)
// 焦点留在面板里时快捷键不接管（isEditorUI 守卫），点完面板按钮要先挪开焦点
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[1]
  const s = window.__visualRevise.store
  s.history.batch('造样例', () => {
    s.applyProp(el, 'color', 'rgb(255, 0, 0)')
    s.applyProp(el, 'padding-left', '32px')
    s.applyProp(el, 'padding-top', '28px')
    s.applyProp(el, 'border-radius', '4px')
    s.applyProp(el, 'width', '320px')
    s.applyProp(el, 'height', '200px')
  })
})
await page.waitForTimeout(200)

const source = await card(1)
const origin1 = await card(0)
ok(PROBES.every(p => source[p] !== origin1[p]),
   `起点：卡片 2 的 ${PROBES.length} 条属性都跟卡片 1 不同（${source.width}×${source.height} vs ${origin1.width}×${origin1.height}）`)

// ── ⌥⌘C 复制 ───────────────────────────────────────────────
await select(1); await page.waitForTimeout(400)
await page.keyboard.press('Meta+Alt+c'); await page.waitForTimeout(300)
const copyToast = await toast()
ok(/^已复制 \d+ 项属性$/.test(copyToast), `⌥⌘C 提示「${copyToast}」`)

// 系统剪贴板里留了一份带信封的 JSON（跨标签页改稿时模块内存是断的）
const clip = await page.evaluate(async () => {
  try { return JSON.parse(await navigator.clipboard.readText()) } catch (e) { return { error: String(e) } }
})
ok(clip?.['visual-revise'] === 'props' && clip.props?.width === '320px' && clip.props?.height === '200px',
   `剪贴板里是 {"visual-revise":"props"} 的 JSON（width=${clip?.props?.width} · height=${clip?.props?.height}）`)
ok(clip?.props && !('left' in clip.props) && !('top' in clip.props)
   && !('position' in clip.props) && !('z-index' in clip.props) && !('translate' in clip.props),
   '位置量（position / left / top / z-index / translate）不进复制集：粘贴不该把元素挪走')

// ── ⌥⌘V 粘贴到卡片 1 ──────────────────────────────────────
await select(0); await page.waitForTimeout(400)
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(400)
const pasted = await card(0)
ok(PROBES.every(p => pasted[p] === source[p]),
   `⌥⌘V 后卡片 1 的计算值等于卡片 2（color=${pasted.color} · radius=${pasted['border-radius']} · padding-left=${pasted['padding-left']}）`)
ok(pasted.width === '320px' && pasted.height === '200px',
   `尺寸（width / height）也一起搬过去（${pasted.width}×${pasted.height}，原先 ${origin1.width}×${origin1.height}）`)
const pasteToast = await toast()
ok(/^已粘贴到 \d+ 个元素$/.test(pasteToast), `⌥⌘V 提示「${pasteToast}」`)

const rec = await recordOf(0)
ok(PROBES.every(p => rec.includes(p)),
   `改动记录里卡片 1 有对应条目（${rec.length} 条，含 ${PROBES.join(' / ')}）`)
// 值本来就一样的不写进记录：三张卡共用一套样式表，只有真变了的那几条该入账
ok(rec.length === PROBES.length && !rec.includes('display') && !rec.includes('font-family'),
   `跟目标当前值相同的属性被跳过（63 项里只落下 ${rec.length} 条）`)

// ── 一次 ⌘Z 全退 ──────────────────────────────────────────
await page.keyboard.press('Meta+z'); await page.waitForTimeout(400)
const undone = await card(0)
ok(PROBES.every(p => undone[p] === origin1[p]),
   `一次 ⌘Z 把整次粘贴退回（${undone.width}×${undone.height} · color=${undone.color}）`)
ok((await recordOf(0)).length === 0, '退回后卡片 1 在改动记录里没有残留条目')

// ── 联动：开着 .shared 粘贴，三张卡一起变 ────────────────────
await select(0); await page.waitForTimeout(400)
await page.locator('visual-revise-panel .shared').click(); await page.waitForTimeout(400)
await blur()
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(500)
const all3 = [await card(0), await card(1), await card(2)]
ok(all3.every(c => PROBES.every(p => c[p] === source[p])),
   `开着联动粘贴，三张卡的 ${PROBES.length} 条属性都等于源（尺寸 ${all3.map(c => `${c.width}×${c.height}`).join(' / ')}）`)
ok((await recordOf(2)).length > 0, `第三张卡也进了改动记录（${(await recordOf(2)).length} 条）`)

await page.keyboard.press('Meta+z'); await page.waitForTimeout(400)
ok((await card(2)).width === '260px', `⌘Z 把联动那次也一起退回（卡片 3 宽度 ${(await card(2)).width}）`)

// ── 焦点在面板输入框里：不接管 ──────────────────────────────
const opIn = page.locator('visual-revise-panel input[data-prop="opacity"]').first()
await opIn.scrollIntoViewIfNeeded(); await opIn.click(); await page.waitForTimeout(200)
const beforeTyping = await card(0)
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(400)
const afterTyping = await card(0)
ok(PROBES.every(p => beforeTyping[p] === afterTyping[p])
   && (await recordOf(0)).filter(p => p !== 'opacity').length === 0,
   `焦点在面板输入框里按 ⌥⌘V 不触发（宽度仍是 ${afterTyping.width}）`)
await opIn.blur(); await blur()

// ── 焦点在面板按钮上（刚点完联动那种）：仍接管 ───────────────
// 只 focus 不 click：click 会把联动打开，粘贴范围就变成三张卡了
await page.evaluate(() => document.querySelector('visual-revise-panel').shadowRoot.querySelector('.shared').focus())
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(400)
const afterBtn = await card(0)
ok(PROBES.every(p => afterBtn[p] === source[p]),
   `焦点在面板按钮上按 ⌥⌘V 仍触发（宽度 ${afterBtn.width}）`)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(400)
await blur()

// ── 浏览模式下不接管 ────────────────────────────────────────
await page.evaluate(() => window.__visualRevise.setMode('browse')); await page.waitForTimeout(300)
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(400)
ok((await card(0)).width === origin1.width && (await recordOf(0)).filter(p => p !== 'opacity').length === 0,
   `浏览模式下 ⌥⌘V 不接管（宽度仍是 ${(await card(0)).width}）`)
await page.evaluate(() => window.__visualRevise.setMode('select')); await page.waitForTimeout(300)

// ── 换个标签页：模块内存是空的，只靠剪贴板里那份 JSON 也能粘 ──
// 顺带就是 Windows 那一轮：isMac 是 hotkey.js 模块加载时算的，
// 平台伪装必须赶在注入 bundle 之前。新 context 要自己再授权一次剪贴板。
const winCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await winCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
const win = await winCtx.newPage()
win.on('pageerror', e => console.log('  [Windows 页异常]', e.message))
await win.addInitScript(() => {
  Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'Windows' }), configurable: true })
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true })
})
await win.goto(origin); await injectVisBug(win, origin); await win.waitForTimeout(400)

const winKey = (key, mods) => win.evaluate(([key, mods]) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, composed: true, ...mods,
  })), [key, mods])
const winSelect = i => win.locator('.curve-card').nth(i).click({ position: { x: 120, y: 12 } })

await winSelect(0); await win.waitForTimeout(400)

// 先证明平台伪装真的生效：Windows 上 ⌘ 不是主修饰键，⌥⌘V 应该什么都不做
await winKey('v', { metaKey: true, altKey: true }); await win.waitForTimeout(300)
ok((await readCard(win, 0)).width === '260px',
   `伪装成 Windows 后 ⌥⌘V 不再接管（宽度仍是 ${(await readCard(win, 0)).width}）`)

await winKey('v', { ctrlKey: true, altKey: true }); await win.waitForTimeout(500)
const winPasted = await readCard(win, 0)
ok(PROBES.every(p => winPasted[p] === source[p]),
   `新标签页里 Ctrl+Alt+V 只靠剪贴板 JSON 就粘上了（${winPasted.width}×${winPasted.height} · color=${winPasted.color}）`)

// Ctrl+Alt+C 也要能复制：在这一页里重新造一份源再粘
await win.evaluate(() => window.__visualRevise.store.applyProp(
  document.querySelectorAll('.curve-card')[2], 'width', '400px'))
await winSelect(2); await win.waitForTimeout(400)
await winKey('c', { ctrlKey: true, altKey: true }); await win.waitForTimeout(300)
await winSelect(1); await win.waitForTimeout(400)
await winKey('v', { ctrlKey: true, altKey: true }); await win.waitForTimeout(500)
ok((await readCard(win, 1)).width === '400px',
   `Windows 上 Ctrl+Alt+C 也生效（卡片 2 宽度 ${(await readCard(win, 1)).width}）`)


// ══ 以下为 §4.7 复核补测（4.7.1 / 4.7.2 / 4.7.3 / 4.7.6 / 4.7.7 / 4.7.8）═══

// ── Windows 页：提示文案该按平台走 combo()（4.7.7）──────────
// 新开一页而不是复用上面那页：上面已经按过 Ctrl+Alt+C，模块内存里有属性了，
// 走不到「没有可粘贴的属性」那条提示
const winMsgCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await winMsgCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
const winMsg = await winMsgCtx.newPage()
winMsg.on('pageerror', e => console.log('  [Windows 文案页异常]', e.message))
await winMsg.addInitScript(() => {
  Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'Windows' }), configurable: true })
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true })
})
await winMsg.goto(origin); await injectVisBug(winMsg, origin); await winMsg.waitForTimeout(400)
await winMsg.evaluate(() => navigator.clipboard.writeText('随便一段不是属性的普通文字'))
await winMsg.locator('.curve-card').nth(0).click({ position: { x: 120, y: 12 } })
await winMsg.waitForTimeout(400)
await winMsg.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'v', code: 'KeyV', ctrlKey: true, altKey: true, bubbles: true, cancelable: true, composed: true })))
await winMsg.waitForTimeout(500)
const winToast = await winMsg.evaluate(() =>
  document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector('.toast')?.textContent?.trim() || '')
ok(/没有可粘贴的属性/.test(winToast),
   `4.7.2 剪贴板里不是本工具产出的 JSON 时不写入、给提示（「${winToast}」）`)
ok((await readCard(winMsg, 0)).width === '260px',
   `4.7.2 剪贴板是普通文本时目标元素一条属性都没被改（宽度仍是 ${(await readCard(winMsg, 0)).width}）`)
ok(/Ctrl\+Alt\+C/.test(winToast) && !/⌥|⌘/.test(winToast),
   `4.7.7 Windows 上提示里的键位文案该是 Ctrl+Alt+C（combo() 加号连接），实际「${winToast}」`)
await winMsg.close(); await winMsgCtx.close()

// ── 无选中：不接管这次按键，但要给一条看得见的提示（4.7.1）──
// 新开一页：模块内存里的那份属性会让 ⌥⌘V 走到别的分支
const bareCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await bareCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
const bare = await bareCtx.newPage()
bare.on('pageerror', e => console.log('  [空选中页异常]', e.message))
await bare.goto(origin); await injectVisBug(bare, origin); await bare.waitForTimeout(400)

const bareFeedback = () => bare.evaluate(() => {
  const inPanel = document.querySelector('visual-revise-panel')?.shadowRoot?.querySelector('.toast')
  const onBody = document.getElementById('visual-revise-toast')
  return {
    panel: inPanel?.hasAttribute('data-show') ? inPanel.textContent.trim() : '',
    body: onBody && onBody.style.opacity === '1' ? onBody.textContent.trim() : '',
  }
})
const bareFire = init => bare.evaluate(i => ({
  notPrevented: document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...i })),
}), init)

ok((await bare.evaluate(() => document.querySelectorAll('[data-selected]').length)) === 0,
   '4.7.1 起点：新页面里没有任何选中元素')
const bareCopy = await bareFire({ key: 'c', code: 'KeyC', metaKey: true, altKey: true })
await bare.waitForTimeout(500)
ok(bareCopy.notPrevented,
   `4.7.1 没有选中元素时 ⌥⌘C 不接管，事件原样放行（notPrevented=${bareCopy.notPrevented}）`)
ok((await bare.evaluate(() => window.__visualRevise.store.history.depth)) === 0,
   `4.7.1 没有选中元素时 ⌥⌘C 不产生任何改动记录（history.depth=${await bare.evaluate(() => window.__visualRevise.store.history.depth)}）`)
const copyFeedback = await bareFeedback()
ok(/先选中一个元素再复制属性/.test(copyFeedback.panel || copyFeedback.body),
   `4.7.1 没有选中元素时 ⌥⌘C 给了一条看得见的提示，期望「先选中一个元素再复制属性」，实际面板 toast「${copyFeedback.panel}」/ body toast「${copyFeedback.body}」`)
// 面板空态里根本没有 .toast 落点，提示只能挂在 body 上才看得见
ok(!!copyFeedback.body,
   `4.7.1 这条提示挂在 body 的 #visual-revise-toast 上（不是被面板空态吞掉）：「${copyFeedback.body}」`)

const barePaste = await bareFire({ key: 'v', code: 'KeyV', metaKey: true, altKey: true })
await bare.waitForTimeout(500)
ok(barePaste.notPrevented,
   `4.7.1 没有选中元素时 ⌥⌘V 同样不接管，事件原样放行（notPrevented=${barePaste.notPrevented}）`)
const pasteFeedback = await bareFeedback()
ok(/先选中要粘贴的元素/.test(pasteFeedback.panel || pasteFeedback.body),
   `4.7.1 没有选中元素时 ⌥⌘V 给了一条看得见的提示，期望「先选中要粘贴的元素」，实际面板 toast「${pasteFeedback.panel}」/ body toast「${pasteFeedback.body}」`)
ok((await bare.evaluate(() => window.__visualRevise.store.history.depth)) === 0,
   `4.7.1 没有选中元素时 ⌥⌘V 也不产生任何改动记录（history.depth=${await bare.evaluate(() => window.__visualRevise.store.history.depth)}）`)
await bare.close(); await bareCtx.close()

// ── 回到主页面：守卫、平台反向条件、短路、多选、提示词 ──────
// 先把历史退干净，再原样重新造一次样例，后面的期望值才跟 source 对得上
await page.bringToFront()
await blur()
for (let i = 0; i < 40 && (await page.evaluate(() => window.__visualRevise.store.history.depth)) > 0; i++) {
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(120)
}
ok((await page.evaluate(() => window.__visualRevise.store.history.depth)) === 0,
   `4.7.3 前置：历史已退到 0（depth=${await page.evaluate(() => window.__visualRevise.store.history.depth)}）`)
await page.evaluate(() => {
  const el = document.querySelectorAll('.curve-card')[1]
  const s = window.__visualRevise.store
  s.history.batch('造样例', () => {
    s.applyProp(el, 'color', 'rgb(255, 0, 0)')
    s.applyProp(el, 'padding-left', '32px')
    s.applyProp(el, 'padding-top', '28px')
    s.applyProp(el, 'border-radius', '4px')
    s.applyProp(el, 'width', '320px')
    s.applyProp(el, 'height', '200px')
  })
})
await page.waitForTimeout(200)

const fire = init => page.evaluate(i => ({
  notPrevented: document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...i })),
}), init)
const depth = () => page.evaluate(() => window.__visualRevise.store.history.depth)
const undoLabel = () => page.evaluate(() => window.__visualRevise.store.history.undoLabel)

// 联动可能还开着（上面点过 .shared），关掉，后面才验得了「多选各写一份」
await select(0); await page.waitForTimeout(400)
if (await page.evaluate(() => document.querySelector('visual-revise-panel')
  .shadowRoot.querySelector('.shared')?.hasAttribute('data-on'))) {
  await page.locator('visual-revise-panel .shared').click(); await page.waitForTimeout(400)
}
await blur()
ok((await page.evaluate(() => window.__visualRevise.panel.scope().length)) === 1,
   `4.7.2 前置：联动已关，scope() 只剩当前选中（${await page.evaluate(() => window.__visualRevise.panel.scope().length)} 个）`)

// 4.7.1 守卫：拖拽 / 缩放进行中（interactive）不接管
await page.evaluate(() => window.__visualRevise.enterInteractive()); await page.waitForTimeout(300)
const inInteractive = await fire({ key: 'c', code: 'KeyC', metaKey: true, altKey: true })
ok(inInteractive.notPrevented,
   `4.7.1 交互态（interactive）下 ⌥⌘C 不接管，事件原样放行（notPrevented=${inInteractive.notPrevented}）`)
await page.evaluate(() => window.__visualRevise.exitInteractive()); await page.waitForTimeout(400)

// 4.7.1 守卫：有弹层开着不接管
await select(0); await page.waitForTimeout(400)
await page.locator('visual-revise-panel vr-select[data-prop="position"]').click(); await page.waitForTimeout(400)
ok(await page.evaluate(() => !!document.getElementById('visual-revise-select-panel')),
   '4.7.1 前置：position 下拉已打开')
const widthBeforePopup = (await card(0)).width
const inPopup = await fire({ key: 'v', code: 'KeyV', metaKey: true, altKey: true })
await page.waitForTimeout(400)
ok(inPopup.notPrevented && (await card(0)).width === widthBeforePopup,
   `4.7.1 有弹层开着时 ⌥⌘V 不接管（notPrevented=${inPopup.notPrevented}，宽度仍是 ${(await card(0)).width}）`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await blur()

// 4.7.6 反向条件：Mac 上按 Windows 的 Ctrl 组合不触发
await select(1); await page.waitForTimeout(400)
const macCtrlC = await fire({ key: 'c', code: 'KeyC', ctrlKey: true, altKey: true })
await page.waitForTimeout(300)
ok(macCtrlC.notPrevented,
   `4.7.6 Mac 上 Ctrl+Alt+C 不触发（isMod 只认 ⌘），事件原样放行（notPrevented=${macCtrlC.notPrevented}）`)
await select(0); await page.waitForTimeout(400)
const widthBeforeCtrlV = (await card(0)).width
const macCtrlV = await fire({ key: 'v', code: 'KeyV', ctrlKey: true, altKey: true })
await page.waitForTimeout(400)
ok(macCtrlV.notPrevented && (await card(0)).width === widthBeforeCtrlV,
   `4.7.6 Mac 上 Ctrl+Alt+V 不触发（notPrevented=${macCtrlV.notPrevented}，宽度仍是 ${(await card(0)).width}）`)

// 4.7.8 短路：接管的按键 preventDefault + stopPropagation，不再往下走。
// document 上挂一个冒泡监听——capture 阶段 stopPropagation 之后它收不到
await page.evaluate(() => {
  window.__vrSeen = []
  document.addEventListener('keydown', e => window.__vrSeen.push(e.code || e.key))
})
await select(1); await page.waitForTimeout(400)
await page.keyboard.press('Meta+Alt+c'); await page.waitForTimeout(300)
await page.keyboard.press('Meta+Alt+x'); await page.waitForTimeout(300)
const seen = await page.evaluate(() => window.__vrSeen)
ok(!seen.includes('KeyC'),
   `4.7.8 ⌥⌘C 被接管后 stopPropagation，document 冒泡阶段收不到（收到的是 ${JSON.stringify(seen)}）`)
ok(seen.includes('KeyX'),
   '4.7.8 对照组：没人接管的 ⌥⌘X 照常冒泡到 document（证明监听本身是有效的）')

// 4.7.3 与上游 ⌘⌥C / ⌘⌥V 同键位：只跑一条路，只留一条历史
const copyToast2 = await toast()
ok(/^已复制 \d+ 项属性$/.test(copyToast2), `4.7.3 上面那次 ⌥⌘C 走的是本扩展这条路（提示「${copyToast2}」）`)
await select(0); await page.waitForTimeout(400)
const depthBefore = await depth()
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(600)
const depthAfter = await depth()
ok(depthAfter === depthBefore + 1,
   `4.7.3 一次 ⌥⌘V 只落一条历史（depth ${depthBefore} → ${depthAfter}，期望 +1）`)
ok((await undoLabel()) === '粘贴属性', `4.7.3 这条历史的标签是「${await undoLabel()}」（本扩展写的，不是上游的 paste_styles）`)
const recOnce = await recordOf(0)
ok(recOnce.length === new Set(recOnce).size,
   `4.7.3 改动记录里每条属性只出现一次，没有被写两遍（${recOnce.length} 条 / 去重后 ${new Set(recOnce).size} 条）`)

// 4.7.2 走 applyProp → 进得了提示词
const promptText = await page.evaluate(() => window.__visualRevise.lib.buildPrompt(
  window.__visualRevise.store.read(), { url: 'http://x/' }))
ok(promptText.includes('320px') && promptText.includes('width'),
   `4.7.2 粘贴的属性进了导出提示词（提示词里找得到 width / 320px：${promptText.includes('width')} / ${promptText.includes('320px')}）`)

// 4.7.2 多选：联动关着时，选中的每一个都各写一份
await page.keyboard.press('Meta+z'); await page.waitForTimeout(400)
await select(0); await page.waitForTimeout(400)
await page.locator('.curve-card').nth(2).click({ position: { x: 120, y: 12 }, modifiers: ['Shift'] })
await page.waitForTimeout(400)
const picked = await page.evaluate(() => document.querySelectorAll('.curve-card[data-selected]').length)
ok(picked === 2, `4.7.2 前置：Shift 点第三张，选中 ${picked} 张卡（期望 2）`)
const depthBeforeMulti = await depth()
await page.keyboard.press('Meta+Alt+v'); await page.waitForTimeout(600)
const multiA = await card(0), multiC = await card(2)
ok(PROBES.every(p => multiA[p] === source[p]) && PROBES.every(p => multiC[p] === source[p]),
   `4.7.2 多选时两个目标各写一份（卡片 1 ${multiA.width}×${multiA.height} · 卡片 3 ${multiC.width}×${multiC.height}，期望都是 ${source.width}×${source.height}）`)
ok((await recordOf(0)).length > 0 && (await recordOf(2)).length > 0,
   `4.7.2 两个目标在改动记录里各自成条（${(await recordOf(0)).length} 条 / ${(await recordOf(2)).length} 条）`)
ok((await depth()) === depthBeforeMulti + 1,
   `4.7.2 多选粘贴仍然只有一条历史（depth ${depthBeforeMulti} → ${await depth()}）`)
await page.keyboard.press('Meta+z'); await page.waitForTimeout(500)
ok((await card(2)).width === '260px',
   `4.7.2 一次 ⌘Z 把多选那次整体退回（卡片 3 宽度 ${(await card(2)).width}）`)

await win.close(); await winCtx.close()
await browser.close(); await close()
console.log(process.exitCode ? '结果：有失败项\n' : '结果：全部通过\n')
