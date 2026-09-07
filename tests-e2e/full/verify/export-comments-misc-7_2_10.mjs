// 独立复现脚本 · 清单 7.2.10（参考图体积超限时的 toast 报错）
//
// 报告称：评论里加一张超过 5MB 的图时，图被静默丢弃——参考图清单不变，
// 页面上 #visual-revise-toast 从未出现，用户得不到任何解释。
// 期望（feature-inventory §7.2.10：「体积限制：单张 5MB、会话累计 20MB，
// 超限 toast 报错」；image-assets.js readImageFile 已经算好了 reason 文案；
// comment-layer #addImages `if (errors?.length) this.#toast(errors[0])`）。
//
// 本脚本不复用 tests-e2e/comment-refs.mjs 的断言，自己起 fixture、自己读状态。
// 「+ 加图」「导入」都是真实 locator.click() + filechooser；粘贴 / 拖拽只能用
// 合成 ClipboardEvent / DragEvent（Playwright 无法把本地文件塞进真剪贴板），
// 这与仓库既有 comment-refs.mjs 的做法一致。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const SMALL_PNG = Buffer.from(B64, 'base64')
const HUGE_PNG = Buffer.alloc(6 * 1024 * 1024)          // 6.0 MB > 上限 5.0 MB

// 一个 filechooser 处理器，按 nextFiles 决定这次给什么文件
let nextFiles = null
page.on('filechooser', async c => {
  if (nextFiles) await c.setFiles(nextFiles)
  else await c.setFiles([])
})

await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(300)

// ── 只观察、不改应用：在 document 上记下所有冒泡上来的 vr-toast ──
await page.evaluate(() => {
  window.__seen = []
  document.addEventListener('vr-toast', e => {
    window.__seen.push({
      message: e.detail?.message,
      kind: e.detail?.kind,
      from: e.composedPath()[0]?.tagName?.toLowerCase?.() || String(e.target),
    })
  })
})

const layer = sel => page.locator(`visual-revise-comment-layer ${sel}`)

// 页面上现在到底有没有 toast、写着什么
const toastState = () => page.evaluate(() => {
  const el = document.getElementById('visual-revise-toast')
  return el
    ? { exists: true, text: el.textContent, opacity: el.style.opacity, color: el.style.color }
    : { exists: false, text: null, opacity: null, color: null }
})

const refState = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-comment-layer')?.shadowRoot
  if (!sr) return { refs: 0, names: [], chips: 0 }
  return {
    refs: sr.querySelectorAll('.ref').length,
    names: [...sr.querySelectorAll('.ref-name')].map(n => n.textContent.trim()),
    chips: sr.querySelectorAll('.editor .chip').length,
  }
})

// 「用户此刻真的看见了超限报错」= toast 可见（opacity 1）且写着 readImageFile 那句
const errShown = t => t.exists && t.opacity === '1' && (t.text || '').includes('图片过大')

const seen = () => page.evaluate(() => window.__seen.slice())
const clearSeen = () => page.evaluate(() => { window.__seen.length = 0 })

const startDraft = async () => {
  await page.evaluate(() => window.__visualRevise.setMode('comment'))
  await page.waitForTimeout(250)
  await page.locator('.curve-card').first().click({ position: { x: 6, y: 6 } })
  await page.waitForTimeout(400)
}

console.log('\n=== 7.2.10 参考图超过 5MB 时有没有报错提示 · 独立复现 ===\n')

await startDraft()
console.log('[起草] 气泡在? ', await layer('.editor').count() === 1)

// ───────────────────────────────────────────────────────────
// 对照 0：正常小图走「+」按钮，确认整条加图链路本身是通的
// ───────────────────────────────────────────────────────────
console.log('\n--- 对照 0：真实点「+」选一张 1×1 的合法 PNG ---')
nextFiles = [{ name: 'ok-shot.png', mimeType: 'image/png', buffer: SMALL_PNG }]
await layer('.add-image').click()
await page.waitForTimeout(900)
console.log('[小图] 参考图 =', JSON.stringify(await refState()))
console.log('[小图] toast =', JSON.stringify(await toastState()))
const baseline = await refState()

// ───────────────────────────────────────────────────────────
// A. 「+」按钮选一张 6MB 的图（报告里「用户点了 + 选了图」的那条路）
// ───────────────────────────────────────────────────────────
console.log('\n--- A. 真实点「+」选一张 6.0 MB 的 huge.png ---')
await clearSeen()
nextFiles = [{ name: 'huge.png', mimeType: 'image/png', buffer: HUGE_PNG }]
await layer('.add-image').click()
await page.waitForTimeout(1500)
const aRefs = await refState()
const aToast = await toastState()
const aSeen = await seen()
console.log('[6MB · 选文件] 参考图 =', JSON.stringify(aRefs))
console.log('[6MB · 选文件] toast =', JSON.stringify(aToast))
console.log('[6MB · 选文件] 冒泡到 document 的 vr-toast =', JSON.stringify(aSeen))
const aRejected = aRefs.refs === baseline.refs && aRefs.chips === baseline.chips
const aSilent = !errShown(aToast)
console.log(`==> A：图确实被拒（清单没变）? ${aRejected}；页面上没有出现超限报错? ${aSilent}`
  + `（toast 里那句是进评论模式时的旧提示，opacity=${aToast.opacity} 已经淡出）`)

// ───────────────────────────────────────────────────────────
// B. 报告原步骤：往 .editor 派发一个带 6MB File 的 paste
// ───────────────────────────────────────────────────────────
console.log('\n--- B. 往 .editor 派发 paste（6MB File，报告原步骤）---')
await clearSeen()
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' }))
  const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')
  ed.focus()
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(1500)
const bRefs = await refState()
const bToast = await toastState()
const bSeen = await seen()
console.log('[6MB · 粘贴] 参考图 =', JSON.stringify(bRefs))
console.log('[6MB · 粘贴] toast =', JSON.stringify(bToast))
console.log('[6MB · 粘贴] 冒泡到 document 的 vr-toast =', JSON.stringify(bSeen))
const bRepro = bRefs.refs === baseline.refs && !errShown(bToast)
console.log(`==> B 复现（图没进清单 + 页面上没有任何 toast）? ${bRepro}`)

// ───────────────────────────────────────────────────────────
// C. 第三个入口：把 6MB 文件拖进气泡
// ───────────────────────────────────────────────────────────
console.log('\n--- C. 往气泡上 drop 一个 6MB 文件 ---')
await clearSeen()
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(new File([new Uint8Array(6 * 1024 * 1024)], 'huge2.png', { type: 'image/png' }))
  const bubble = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.bubble')
  bubble.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(1500)
const cRefs = await refState()
const cToast = await toastState()
const cSeen = await seen()
console.log('[6MB · 拖拽] 参考图 =', JSON.stringify(cRefs))
console.log('[6MB · 拖拽] toast =', JSON.stringify(cToast))
console.log('[6MB · 拖拽] 冒泡到 document 的 vr-toast =', JSON.stringify(cSeen))
const cRepro = cRefs.refs === baseline.refs && !errShown(cToast)
console.log(`==> C 复现（拖拽入口同样静默）? ${cRepro}`)

// ───────────────────────────────────────────────────────────
// D. 对照：改动列表那条路的 toast 能不能正常显示（真实点击「导入」+ 选一个
//    坏文件 → json-io 会回一个 reason，change-list 派 vr-toast）
// ───────────────────────────────────────────────────────────
console.log('\n--- D. 对照：真实点改动列表「导入」，选一个坏 JSON ---')
await clearSeen()
await page.locator('visual-revise-toolbar .list').click()
await page.waitForTimeout(500)
console.log('[对照] 改动列表打开了? ', await page.evaluate(() =>
  !document.querySelector('visual-revise-list')?.hidden))
nextFiles = [{ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"nope"}') }]
await page.locator('visual-revise-list .import').click()
await page.waitForTimeout(1200)
const dToast = await toastState()
const dSeen = await seen()
console.log('[对照] toast =', JSON.stringify(dToast))
console.log('[对照] 冒泡到 document 的 vr-toast =', JSON.stringify(dSeen))
const dWorks = dToast.exists && !!dToast.text
console.log(`==> D：同一套 toast 机制在「改动列表」这条路上正常显示? ${dWorks}`)

// ───────────────────────────────────────────────────────────
// E. 直接对比：同一条 CustomEvent，从 list 派 vs 从评论层派
// ───────────────────────────────────────────────────────────
console.log('\n--- E. 同一条 vr-toast，分别从 <visual-revise-list> 与 <visual-revise-comment-layer> 派发 ---')
const fromList = await page.evaluate(async () => {
  const el = document.getElementById('visual-revise-toast')
  if (el) { el.textContent = ''; el.style.opacity = '0' }
  document.querySelector('visual-revise-list').dispatchEvent(new CustomEvent('vr-toast', {
    bubbles: true, composed: true, detail: { message: '探针：来自 list', kind: 'error' },
  }))
  await new Promise(r => setTimeout(r, 300))
  const t = document.getElementById('visual-revise-toast')
  return { text: t?.textContent ?? null, opacity: t?.style.opacity ?? null }
})
console.log('[探针 · list 派发] toast =', JSON.stringify(fromList))

const fromLayer = await page.evaluate(async () => {
  const el = document.getElementById('visual-revise-toast')
  if (el) { el.textContent = ''; el.style.opacity = '0' }
  document.querySelector('visual-revise-comment-layer').dispatchEvent(new CustomEvent('vr-toast', {
    bubbles: true, composed: true, detail: { message: '探针：来自评论层', kind: 'error' },
  }))
  await new Promise(r => setTimeout(r, 300))
  const t = document.getElementById('visual-revise-toast')
  return { text: t?.textContent ?? null, opacity: t?.style.opacity ?? null }
})
console.log('[探针 · 评论层派发] toast =', JSON.stringify(fromLayer))
const asym = fromList.text === '探针：来自 list' && fromLayer.text !== '探针：来自评论层'
console.log(`==> E：list 的事件被接住、评论层的没人接? ${asym}`)

console.log('\n================ 结论 ================')
console.log('对照 0 小图正常入列                     :', baseline.refs === 1)
console.log('A「+」选 6MB：被拒 + 没有超限报错       :', aRejected && aSilent)
console.log('B 粘贴 6MB：被拒 + 没有超限报错（报告步骤）:', bRepro)
console.log('C 拖拽 6MB：被拒 + 没有超限报错         :', cRepro)
console.log('三条入口都派出了 vr-toast 但没人接住     :',
  [aSeen, bSeen, cSeen].every(l => l.length === 1 && l[0].message.includes('图片过大')))
console.log('D 改动列表那条路的 toast 正常           :', dWorks)
console.log('E 同一事件 list 接得住、评论层接不住     :', asym)
console.log('=====================================\n')

await browser.close(); await close()
