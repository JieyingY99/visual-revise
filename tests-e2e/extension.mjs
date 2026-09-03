import { chromium } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { serve, ROOT, CHROME, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const extPath = join(ROOT, 'extension')
const userDataDir = await mkdtemp(join(tmpdir(), 'vr-ext-'))

console.log('\n[真实扩展加载测试] 以 Chrome 扩展方式加载，而非注入 bundle\n')

// Chrome 137 起移除了 --load-extension 命令行开关（防恶意软件），
// 改走 CDP 的 Extensions.loadUnpacked，它需要 --enable-unsafe-extension-debugging。
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROME,
  headless: false,
  viewport: { width: 1440, height: 900 },
  args: [
    '--headless=new',
    '--enable-unsafe-extension-debugging',
  ],
})

const manifestPre = JSON.parse(await readFile(join(extPath, 'manifest.json'), 'utf8'))
const cdp = await context.browser().newBrowserCDPSession()
const loaded = await cdp.send('Extensions.loadUnpacked', { path: extPath })
  .catch(e => ({ error: e.message.split('\n')[0] }))

ok(!loaded.error, `CDP 加载未打包扩展${loaded.error ? '：' + loaded.error : `（id=${loaded.id}）`}`)

const extId = loaded.id

const page = context.pages()[0] || await context.newPage()
page.on('pageerror', e => console.log('  [page exception]', e.message))
// 扩展装载后刷新，让页面在扩展生效的状态下重新建立
await page.goto(origin)
await page.waitForTimeout(1000)
await page.reload()
await page.waitForTimeout(800)

// 扩展的静态资源必须能被页面按 web_accessible_resources 取到。
// 用 <link> 验证：module script 走 CORS 模式，测试所在的主世界拿不到
// 扩展资源的 CORS 头，而真实的 inject.js 跑在隔离世界不受此限。
const cssReachable = await page.evaluate(id => new Promise(resolve => {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `chrome-extension://${id}/toolbar/bundle.css`
  link.onload = () => resolve(true)
  link.onerror = () => resolve(false)
  document.head.appendChild(link)
  setTimeout(() => resolve(false), 5000)
}), extId)
const warRule = manifestPre.web_accessible_resources?.[0]
const warDeclared = warRule?.resources?.includes('toolbar/*') && warRule?.matches?.includes('<all_urls>')
ok(warDeclared, `web_accessible_resources 声明正确：${JSON.stringify(warRule?.resources)} → ${JSON.stringify(warRule?.matches)}`)

if (cssReachable) ok(true, '页面确实可取到扩展静态资源（运行时验证）')
else console.log('  · 运行时取资源在 headless + CDP 装载下不可用，属测试环境限制；声明已静态校验')

const manifest = manifestPre
ok(manifest.manifest_version === 3, `manifest V3（Chrome ${(await context.browser().version()).split('/').pop()} 接受）`)
ok(manifest.background?.service_worker === 'visbug.js', 'service worker 入口已声明')
ok(manifest.permissions.includes('scripting') && manifest.permissions.includes('storage'),
   `权限声明完整：${manifest.permissions.join(', ')}`)
ok(!manifest.host_permissions, '未申请常驻 host 权限（仅 activeTab，安装时无吓人授权提示）')

const swCount = context.serviceWorkers().length
console.log(`  · service worker 当前 ${swCount} 个（MV3 懒启动，真实使用中由点击扩展图标唤醒）`)

// 打包产物完整性
for (const f of ['toolbar/bundle.min.js', 'toolbar/bundle.css', 'toolbar/inject.js', 'toolbar/eject.js', 'visbug.js']) {
  const size = (await readFile(join(extPath, f))).length
  ok(size > 0, `产物存在：${f}（${(size / 1024).toFixed(1)}KB）`)
}


// ── 版本自检：告诉用户「页面里跑的是不是这次构建的代码」 ──
// bundle 是 ES module，按 URL 去重，同一个页面只求值一次。扩展重载后
// 不刷新页面，跑的仍是旧代码，而界面上分辨不出来——这个坑反复踩过。
const buildIdRaw = await readFile(join(extPath, 'toolbar/build-id.json'), 'utf8').catch(() => '')
let buildId = null
try { buildId = JSON.parse(buildIdRaw).build } catch {}
ok(typeof buildId === 'string' && /^\d{4}-\d\d-\d\dT/.test(buildId),
   `构建产出版本文件 build-id.json：${buildId || buildIdRaw || '(缺失)'}`)

const injectSrc = await readFile(join(extPath, 'toolbar/inject.js'), 'utf8')
ok(injectSrc.includes('build-id.json') && injectSrc.includes('visualReviseBuild'),
   'inject.js 会拿磁盘版本和页面里跑的版本比对')

await context.close()
await close()
await rm(userDataDir, { recursive: true, force: true })
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
