// 独立复现脚本 · 清单 7.2.10 后半句（会话累计 20MB 上限 / MAX_TOTAL）
//
// 注：tests-e2e/full/verify/export-comments-misc-7_2_10.mjs 已被另一份调查占用
// （查的是 7.2.10 前半句「超限 toast 不出现」），这里另起文件名以免覆盖。
//
// 报告称：MAX_TOTAL（20MB 会话累计上限）从未被调用，是死代码；一次粘贴 5 张
// 4.3MB（每张都低于单张 5MB 上限、合计 21.5MB）会被全部收下，没有任何拦截。
// 期望（feature-inventory §7.2.10 +	image-assets.js:12 注释「一次会话累计上限」）：
// 累计超过 20MB 应当拦下超出的图并报错。
//
// 观测手段说明：comment-layer 的 vr-toast 事件在 visual-revise.js 里没有监听方
// （只有 list 挂了），所以「没看到 toast」本身不能证明守卫没跑。本脚本因此把
// **参考图清单条数**作为决定性观测量，并用一张 6MB 图做对照组，证明「守卫会跑
// 时清单确实不涨」这套观测是灵的。
//
// 进评论模式走真实键盘（keyboard.press('c')），起草稿走真实指针（locator.click），
// 不用 element.click()。粘贴只能派发 ClipboardEvent —— Playwright 没有往系统剪贴板
// 塞图片的通道，仓库既有 comment-refs.mjs 同样是这么做的。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

await page.goto(origin)
await injectVisBug(page, origin)
await page.waitForTimeout(400)

const layer = sel => page.locator(`visual-revise-comment-layer ${sel}`)
const refCount = () => layer('.ref').count()

// toast 会自己淡出，事后查一次可能扑空。开局挂观察器 + 轮询，
// 把出现过的每一条 toast 文案都记下来。
await page.evaluate(() => {
  window.__toastLog = []
  const read = () => {
    const t = document.getElementById('visual-revise-toast')?.textContent?.trim()
    if (t && window.__toastLog.at(-1) !== t) window.__toastLog.push(t)
  }
  new MutationObserver(read).observe(document.body, { childList: true, subtree: true, characterData: true })
  setInterval(read, 100)
})
const toasts = () => page.evaluate(() => window.__toastLog.slice())

// 往编辑器派发一次 paste，DataTransfer 里放 n 张 size 字节的 image/png
const pasteBlobs = (n, size, prefix) => page.evaluate(({ n, size, prefix }) => {
  const dt = new DataTransfer()
  for (let i = 1; i <= n; i++)
    dt.items.add(new File([new Uint8Array(size)], `${prefix}-${i}.png`, { type: 'image/png' }))
  const ed = document.querySelector('visual-revise-comment-layer').shadowRoot.querySelector('.editor')
  ed.focus()
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
}, { n, size, prefix })

console.log('\n=== 7.2.10 会话累计 20MB（MAX_TOTAL）是否真的拦得住 · 独立复现 ===\n')

// ── 0. 打包产物里到底有没有这两个常量 ───────────────────────────
const inBundle = await page.evaluate(async o => {
  const src = await (await fetch(`${o}/__ext/toolbar/bundle.min.js`)).text()
  return {
    单张5MB_5242880:  src.includes('5242880'),
    累计20MB_20971520: src.includes('20971520'),
    出现过totalBytes:  /totalBytes/.test(src),
  }
}, origin)
console.log('[打包产物] bundle.min.js 里 =', JSON.stringify(inBundle))

// ── 1. 进评论模式（真实键盘）+ 起草稿（真实点击）─────────────────
await page.locator('body').click({ position: { x: 6, y: 870 } })
await page.keyboard.press('c')
await page.waitForTimeout(300)
console.log('[模式] 按 c 之后 mode =', await page.evaluate(() => window.__visualRevise.mode))

await page.locator('.curve-card').first().click({ position: { x: 6, y: 6 } })
await page.waitForTimeout(400)
console.log('[草稿] 气泡出现? ', (await layer('.bubble').count()) === 1)

// ── 2. 对照组 A：单张 6MB（超单张 5MB 上限）──────────────────────
console.log('\n--- A. 对照：单张 6MB（超过单张 5MB 上限）---')
const beforeA = await refCount()
await pasteBlobs(1, 6_000_000, 'oversize')
await page.waitForTimeout(3000)
const afterA = await refCount()
console.log(`[A] 参考图清单 ${beforeA} → ${afterA}`)
console.log('[A] 至此出现过的 toast =', JSON.stringify(await toasts()))
const aBlocked = afterA === beforeA
console.log(`==> A 单张上限拦住了（清单没涨）? ${aBlocked}`)

// ── 3. 铺底：4 张小图，凑出报告里的「清单 4 条」起点 ──────────────
console.log('\n--- 铺底：先加 4 张 1KB 小图 ---')
await pasteBlobs(4, 1024, 'seed')
await page.waitForTimeout(2500)
console.log('[铺底] 清单 =', await refCount())

// ── 4. 复现：一次粘贴 5 张 4.3MB，合计 21.5MB ────────────────────
console.log('\n--- B. 复现：一次 paste 放 5 张 4.3MB（每张 < 5MB，合计 21.5MB > 20MB）---')
const beforeB = await refCount()
const toastBeforeB = (await toasts()).length
await pasteBlobs(5, 4_300_000, 'bulk')
await page.waitForTimeout(8000)
const afterB = await refCount()
const toastAfterB = await toasts()
console.log(`[B] 参考图清单 ${beforeB} → ${afterB}（新增 ${afterB - beforeB} 条）`)
console.log('[B] 全部 toast =', JSON.stringify(toastAfterB))
console.log(`[B] 这一步新冒出的 toast 条数 = ${toastAfterB.length - toastBeforeB}`)

// ── 5. 保存后看真实落库体积 ──────────────────────────────────────
await layer('.save').click()
await page.waitForTimeout(1500)

const stored = await page.evaluate(() => {
  const st = window.__visualRevise.store
  const c = st.read().comments[0]
  const imgs = c?.images || []
  const sumBytes = imgs.reduce((n, i) => n + (i.bytes || 0), 0)
  const sumB64   = imgs.reduce((n, i) => n + (i.dataUrl?.length || 0), 0)
  const assets   = st.allAssets ? st.allAssets() : []
  return {
    张数: imgs.length,
    原始字节: sumBytes,
    原始MB: +(sumBytes / 1024 / 1024).toFixed(2),
    base64MB: +(sumB64 / 1024 / 1024).toFixed(2),
    导出assets资产数: assets.length,
    导出assets里带dataUrl的: assets.filter(a => a.dataUrl).length,
  }
})
console.log('\n[落库] 这一条评论存下来的参考图 =', JSON.stringify(stored))

const bulkAllAccepted = afterB - beforeB === 5
const overLimit = stored.原始字节 > 20 * 1024 * 1024
const noNewToast = toastAfterB.length === toastBeforeB
console.log(`==> B 复现（5 张全收下 + 累计 ${stored.原始MB}MB > 20MB + 期间无新 toast）? `
  + `${bulkAllAccepted && overLimit && noNewToast}`)

console.log('\n================ 结论 ================')
console.log('bundle 里有单张 5MB 常量(5242880)   :', inBundle.单张5MB_5242880)
console.log('bundle 里有累计 20MB 常量(20971520) :', inBundle.累计20MB_20971520)
console.log('bundle 里出现过 totalBytes          :', inBundle.出现过totalBytes)
console.log('A 单张 6MB 被拦住（观测手段有效）   :', aBlocked)
console.log('B 5×4.3MB 全部收下                  :', bulkAllAccepted)
console.log('B 期间没有任何新 toast              :', noNewToast)
console.log('B 会话累计（MB）                    :', stored.原始MB)
console.log('=====================================\n')

await browser.close(); await close()
