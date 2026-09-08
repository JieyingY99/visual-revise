/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// ⌘⇧C（Windows 上 Ctrl+Shift+C）：把选中元素连同子元素复制成一张 PNG 进剪贴板。
// 多选时只出一张图——取所有选中元素外接矩形的并集，元素之间的页面内容照原样带上，
// 这样贴到 Figma / 飞书里看到的就是页面上真实的那一块，而不是几块拼贴。
//
// 这是读操作，不进改动记录。
//
// 两条通道：
//
// 1. 真截图（优先）。页面里的脚本没有任何 API 能拍到自己的像素，只有扩展进程的
//    chrome.tabs.captureVisibleTab 拍得到。于是绕一圈：
//      页面 CustomEvent 'visual-revise:capture-request'（detail 是请求 id 字符串）
//        → content script（extension/toolbar/inject.js）runtime.sendMessage
//        → service worker（extension/visbug.js）captureVisibleTab
//        → 原路回来：'visual-revise:capture-result'（detail 是 JSON 字符串）
//    detail 一律用字符串：跨「隔离世界 ↔ 主世界」传对象要不要被包一层，各浏览器
//    各版本说法不一，字符串没这个问题。id 用来配对，两次请求撞一起也不会串台。
//    通道在不在，看 <html data-visual-revise-capture>——content script 装好监听
//    才会写上。没这个记号就直接走通道 2，不必先把编辑器 UI 藏起来再干等 3 秒超时。
//
// 2. DOM 重绘（没装扩展、或自动化测试里）。把选中元素克隆一份、计算样式内联上去，
//    塞进 SVG <foreignObject> 画到 canvas。保真度低一档（见 renderFallback），
//    但尺寸是准的。
import { isMod } from '../core/hotkey.js'
import { viewportBox } from '../core/zoom.js'

const CAP_REQUEST = 'visual-revise:capture-request'
const CAP_RESULT  = 'visual-revise:capture-result'

// 探路那一次给 3 秒：只是问「通道还在吗」，久等没有意义。
// 拼接长图时每张给足时间——service worker 为了避开配额会主动排队等待。
const PROBE_TIMEOUT = 3000
const TILE_TIMEOUT  = 10000
const MAX_TILES     = 24

const sleep = ms => new Promise(r => setTimeout(r, ms))
// 连等两帧：第一帧只保证样式改动被算进去，第二帧才保证它真的画到了屏幕上
const nextPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('图片解码失败'))
  img.src = src
})

const toBlob = canvas => new Promise((resolve, reject) =>
  canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG 编码失败')), 'image/png'))

// ── 几何 ────────────────────────────────────────────────────

// 选中元素外接矩形的并集，视口坐标系（CSS 像素）
const unionRect = els => {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  for (const el of els) {
    const q = el.getBoundingClientRect()
    if (!(q.width > 0 || q.height > 0)) continue
    l = Math.min(l, q.left); t = Math.min(t, q.top)
    r = Math.max(r, q.right); b = Math.max(b, q.bottom)
  }
  return Number.isFinite(l) ? { left: l, top: t, width: r - l, height: b - t } : null
}

const isOpaque = css => {
  const m = /^rgba?\(([^)]+)\)/.exec(String(css || ''))
  if (!m) return false
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  return parts.length < 4 || parseFloat(parts[3]) > 0.99
}

// 图的底色：从选中元素往上找第一个不透明背景。canvas 默认全透明，
// 而截图和重绘都可能留下没画到的边角（页面外、加载不出来的图片），
// 先铺一层底色，贴出去才不会是一块透明。
const effectiveBg = el => {
  let node = el
  while (node && node.nodeType === 1) {
    const bg = getComputedStyle(node).backgroundColor
    if (isOpaque(bg)) return bg
    node = node.parentElement
  }
  return '#ffffff'
}

// ── 截图前把编辑器自己的 UI 收起来 ──────────────────────────
//
// 用一张临时样式表而不是逐个改 inline style：一是恢复时只要删掉这个 <style>，
// 不用记住每个元素原来的 display；二是 !important 压得住 VisBug 的 guides 工具
// ——它绑在 body 的 mousemove 里会把 gridlines 的 inline display 清掉。
const HIDE_STYLE_ID = 'visual-revise-capture-hide'
const EDITOR_UI = [
  'vis-bug',
  // 上游的覆盖层（与 core/visual-revise.js 的 UI_TAGS 同源，另加几个不常驻的）
  'visbug-handles', 'visbug-label', 'visbug-hover', 'visbug-grip', 'visbug-metatip',
  'visbug-ally', 'visbug-corners', 'visbug-gridlines', 'visbug-distance',
  'visbug-offscreen-label', 'visbug-hotkeys', 'hotkey-map',
  // 本扩展的宿主
  'visual-revise-panel', 'visual-revise-toolbar', 'visual-revise-list',
  'visual-revise-tree', 'visual-revise-comment-layer',
  // 批注钉子、拖拽幽灵、高亮框、各类弹层：挂上去时都带了这个记号
  '[data-visual-revise-ui]', '[data-visual-revise-guide]',
  // 弹层与 toast 挂在 body 上，用 id 前缀兜住
  '[id^="visual-revise-"]',
].join(',')

const hideEditorUI = () => {
  const style = document.createElement('style')
  style.id = HIDE_STYLE_ID
  style.setAttribute('data-visual-revise-ui', '')
  // 选中态的虚线框画在页面元素自己身上（不是覆盖层），只能把描边关掉
  style.textContent =
    `${EDITOR_UI}{display:none!important}` +
    `[data-pseudo-select=true]{outline:none!important}`
  document.head.appendChild(style)
  return () => style.remove()
}

// ── 通道 1：真截图 ──────────────────────────────────────────

const channelReady = () => document.documentElement.dataset.visualReviseCapture === '1'

let seq = 0
const requestCapture = (timeout = PROBE_TIMEOUT) => new Promise(resolve => {
  const id = `vr-cap-${Date.now().toString(36)}-${++seq}`
  let settled = false

  const finish = out => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    window.removeEventListener(CAP_RESULT, onResult)
    resolve(out)
  }

  const onResult = e => {
    let d = e.detail
    if (typeof d === 'string') { try { d = JSON.parse(d) } catch { return } }
    if (!d || d.id !== id) return
    finish(d.dataUrl ? { dataUrl: d.dataUrl } : { error: d.error || '截图失败' })
  }

  window.addEventListener(CAP_RESULT, onResult)
  const timer = setTimeout(() => finish({ error: '截图通道无响应' }), timeout)
  window.dispatchEvent(new CustomEvent(CAP_REQUEST, { detail: id }))
})

// 把一张视口截图里与目标区域相交的部分画进输出画布。
//
// 坐标一律换到「文档坐标 × CSS 像素」再比：截图覆盖的是眼睛看到的那块视口
// （捏合时就是视觉视口，见 core/zoom.js 的 viewportBox），它在文档里的位置
// 是 scroll + viewportBox 的偏移。
//
// 每张图自己算换算比 s = 图宽 / 视口 CSS 宽：captureVisibleTab 给的是设备像素图，
// 页面缩放会同时改 devicePixelRatio 和视口 CSS 宽、捏合只改视觉视口宽——与其把
// 这几个量乘来乘去，不如直接量一次，天然把三者都算进去了。
const drawTile = (g, img, box, doc, scale, sx, sy) => {
  const s = img.width / box.width
  const covL = sx + box.left, covT = sy + box.top
  const x0 = Math.max(doc.left, covL), y0 = Math.max(doc.top, covT)
  const x1 = Math.min(doc.left + doc.width, covL + box.width)
  const y1 = Math.min(doc.top + doc.height, covT + box.height)
  if (!(x1 > x0 && y1 > y0)) return
  g.drawImage(img,
    (x0 - covL) * s, (y0 - covT) * s, (x1 - x0) * s, (y1 - y0) * s,
    (x0 - doc.left) * scale, (y0 - doc.top) * scale, (x1 - x0) * scale, (y1 - y0) * scale)
}

const captureUnion = async (union, bg) => {
  const first = await requestCapture(PROBE_TIMEOUT)
  if (first.error) throw new Error(first.error)

  const img0 = await loadImage(first.dataUrl)
  const box0 = viewportBox()
  if (!(box0.width > 0 && img0.width > 0)) throw new Error('拿不到视口尺寸')
  const scale = img0.width / box0.width

  const canvas = document.createElement('canvas')
  canvas.width  = Math.max(1, Math.round(union.width * scale))
  canvas.height = Math.max(1, Math.round(union.height * scale))
  const g = canvas.getContext('2d')
  g.fillStyle = bg
  g.fillRect(0, 0, canvas.width, canvas.height)

  const sx0 = scrollX, sy0 = scrollY
  const doc = { left: union.left + sx0, top: union.top + sy0, width: union.width, height: union.height }

  const fits = union.left >= box0.left - 0.5
    && union.top >= box0.top - 0.5
    && union.left + union.width  <= box0.left + box0.width  + 0.5
    && union.top  + union.height <= box0.top  + box0.height + 0.5

  // 整块都在视口里：探路那张就是要的那张，不用滚动，页面也不会跳一下
  if (fits) {
    drawTile(g, img0, box0, doc, scale, sx0, sy0)
    return canvas
  }

  // 超出视口：分段滚动多截几张拼起来。
  // 第一版接受 position:fixed 的元素在每段里重复出现——它钉在视口上，滚动时
  // 每一张都会拍到它。要修得在截图前把 fixed 元素逐个改成 absolute 并补上
  // 偏移，那会真的改动页面布局，风险远大于收益，留到有人真被它咬到再说。
  const cols = Math.max(1, Math.ceil(doc.width  / box0.width))
  const rows = Math.max(1, Math.ceil(doc.height / box0.height))
  if (cols * rows > MAX_TILES) throw new Error(`选区太大（要拼 ${cols * rows} 屏）`)

  try {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      // scroll-behavior: smooth 的页面上，不指定 instant 会拍到滚动动画中间那一帧
      window.scrollTo({ left: doc.left + c * box0.width, top: doc.top + r * box0.height, behavior: 'instant' })
      await nextPaint()
      await sleep(160)

      const shot = await requestCapture(TILE_TIMEOUT)
      if (shot.error) throw new Error(shot.error)
      const img = await loadImage(shot.dataUrl)
      // 滚到底 / 滚到右边界时浏览器会夹住，实际停在哪儿以量到的为准
      drawTile(g, img, viewportBox(), doc, scale, scrollX, scrollY)
    }
  } finally {
    window.scrollTo({ left: sx0, top: sy0, behavior: 'instant' })
  }

  return canvas
}

// ── 通道 2：DOM 重绘 ────────────────────────────────────────
//
// 局限（用户看得出来的那些）：
// - <img> 与 background-image: url() 拉不到——<img> 载入的 SVG 一律禁止外部资源，
//   这是浏览器的安全规则，不是可以绕的开关。渐变、纯色背景照常。
// - 伪元素（::before / ::after）、shadow DOM 里的内容不会出现。
// - 字体按名字在本机重新解析，页面用 @font-face 自带的字体会掉回后备字形。
// - 滤镜 / 混合模式 / 层叠上下文的边界情况可能与页面上不完全一致。
// 尺寸是准的：外接矩形怎么量的，画布就多大。
const STYLE_PROPS = [
  'display', 'position', 'float', 'clear', 'z-index',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background-clip', 'background-origin',
  'color', 'opacity', 'visibility', 'overflow-x', 'overflow-y',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-decoration', 'text-transform', 'text-indent', 'text-shadow',
  'white-space', 'word-break', 'overflow-wrap', 'vertical-align',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
  'align-self', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-flow',
  'grid-column', 'grid-row', 'place-items', 'place-content',
  'box-shadow', 'transform', 'transform-origin', 'filter', 'mix-blend-mode',
  'list-style', 'object-fit', 'table-layout', 'border-collapse', 'border-spacing',
]

// 编辑器留在页面元素上的记号，别一起进图
const STRIP_ATTRS = ['data-selected', 'data-pseudo-select', 'data-hover', 'data-measuring', 'contenteditable', 'draggable']
// XMLSerializer 出来的要能当 XML 解析：Vue / Angular 那种 @click、[ngModel]
// 属性名进了 XML 就是语法错误，整张 SVG 会解不出来
const XML_NAME = /^[A-Za-z_:][\w.:-]*$/

const inlineStyles = (src, dst) => {
  if (src.nodeType !== 1 || dst.nodeType !== 1) return

  const cs = getComputedStyle(src)
  let css = ''
  for (const prop of STYLE_PROPS) {
    const v = cs.getPropertyValue(prop)
    if (v) css += `${prop}:${v};`
  }
  // getComputedStyle 的 width / height 一律是内容盒尺寸，即便元素本身是
  // border-box。原样照抄 box-sizing 会让 padding 和边框再被减一遍，元素越描越瘦，
  // 所以统一按 content-box 解释——padding 和边框都已单独内联，加起来正好还原。
  dst.setAttribute('style', css + 'box-sizing:content-box;')

  for (const a of STRIP_ATTRS) dst.removeAttribute(a)
  for (const name of dst.getAttributeNames())
    if (!XML_NAME.test(name)) dst.removeAttribute(name)

  // cloneNode(true) 是逐节点深拷贝，同一层的下标必然对得上
  const sk = src.children, dk = dst.children
  for (let i = 0; i < sk.length && i < dk.length; i++) inlineStyles(sk[i], dk[i])
}

const cloneInlined = el => {
  const clone = el.cloneNode(true)
  inlineStyles(el, clone)
  // 外层的格子已经把它摆到位了，自己别再带 margin 和定位偏移
  clone.style.setProperty('position', 'static')
  clone.style.setProperty('margin', '0')
  for (const side of ['left', 'top', 'right', 'bottom']) clone.style.setProperty(side, 'auto')
  clone.querySelectorAll?.('script, noscript, link, style').forEach(n => n.remove())
  return clone
}

const renderFallback = async (targets, union, bg) => {
  // 页面缩放已经算进 devicePixelRatio 里了（放大到 150% 时它就是 1.5），
  // 不能再乘一遍 zoomFactor
  const scale = Math.max(1, devicePixelRatio || 1)

  const stage = document.createElement('div')
  stage.setAttribute('style',
    `position:relative;overflow:hidden;background:${bg};` +
    `width:${union.width}px;height:${union.height}px`)

  for (const el of targets) {
    const r = el.getBoundingClientRect()
    const slot = document.createElement('div')
    slot.setAttribute('style',
      `position:absolute;left:${r.left - union.left}px;top:${r.top - union.top}px;` +
      `width:${r.width}px;height:${r.height}px`)
    slot.appendChild(cloneInlined(el))
    stage.appendChild(slot)
  }

  const w = Math.max(1, Math.round(union.width * scale))
  const h = Math.max(1, Math.round(union.height * scale))
  // <svg> 的 width/height 给设备像素、viewBox 给 CSS 像素：位图按设备像素栅格化，
  // 拿到 canvas 里就是 1:1，不会先按 CSS 尺寸画完再放大糊掉
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${union.width} ${union.height}">` +
    `<foreignObject x="0" y="0" width="${union.width}" height="${union.height}">` +
    new XMLSerializer().serializeToString(stage) +
    `</foreignObject></svg>`

  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  g.drawImage(img, 0, 0, w, h)
  return canvas
}

// ── 主流程 ──────────────────────────────────────────────────

const run = async targets => {
  const useCapture = channelReady()
  const restore = useCapture ? hideEditorUI() : () => {}

  try {
    // 覆盖层藏掉之后再量：面板这些都是 fixed，本不该影响页面布局，
    // 但真有页面把编辑器 UI 算进流里时，以「截下来的那一刻」为准才不会错位
    if (useCapture) await nextPaint()

    const union = unionRect(targets)
    if (!union || union.width < 1 || union.height < 1)
      throw new Error('选中的元素没有可见区域')

    const bg = effectiveBg(targets[0])
    let canvas = null, mode = 'fallback'

    if (useCapture) {
      try {
        canvas = await captureUnion(union, bg)
        mode = 'capture'
      } catch (err) {
        // 扩展被撤权、service worker 正好在重启、配额撞满……都不该让功能失效，
        // 退回 DOM 重绘，用户至少拿得到一张尺寸正确的图
        console.warn('[Visual Revise] 截图通道不可用，改用 DOM 重绘：', err?.message || err)
      }
    }

    if (!canvas) {
      restore()
      canvas = await renderFallback(targets, union, bg)
    }

    return { blob: await toBlob(canvas), width: canvas.width, height: canvas.height, mode }
  } finally {
    restore()
  }
}

let busy = false

export const onKeydown = (e, ctx) => {
  if (!isMod(e) || !e.shiftKey || e.altKey) return false
  // e.code 是键盘上的物理位置，认它才不会被输入法 / 布局影响；e.key 兜底，
  // 留给拿不到 code 的合成事件
  if (e.code !== 'KeyC' && String(e.key).toLowerCase() !== 'c') return false
  if (ctx.interactive || ctx.mode !== 'select') return false
  // 不查 isEditorUI：点完面板上的按钮（联动、折叠……）焦点还留在面板里，
  // 这时按 ⌘⇧C 照样该出图。面板里没有任何控件会用到这个组合，不会打架。
  // 真正要让路的是「用户正在输入框里打字」，那由 isTypingTarget 兜住
  if (ctx.isTypingTarget(e) || ctx.hasOpenPopup()) return false

  e.preventDefault()
  e.stopPropagation()

  if (busy) return true

  const targets = ctx.engine.selection().filter(el => el?.isConnected && !ctx.isEditorUI(el))
  if (!targets.length) {
    // 没选中任何元素时属性面板整个是空的，panel.toast 找不到落点，消息会无声丢掉。
    // 走 vr-toast：core/visual-revise.js 把它转给工具条，工具条的 toast 挂在
    // body 上，什么都没选中时照样看得见
    document.dispatchEvent(new CustomEvent('vr-toast', {
      bubbles: true, composed: true,
      detail: { message: '先选中要复制成图片的元素', kind: 'error' },
    }))
    return true
  }

  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    ctx.toast('这个浏览器不支持把图片写进剪贴板', 'error')
    return true
  }

  busy = true
  let failure = null
  const job = run(targets).catch(err => { failure = err; throw err })
  const blobJob = job.then(r => r.blob)
  // 这两份的失败都由下面的 clipboard.write 报出来，这里只是别让它们
  // 各自冒成一条未处理拒绝，污染页面控制台
  job.catch(() => {})
  blobJob.catch(() => {})

  // 同步发起写入、把 blob 以 Promise 交出去：等 await 完再调 clipboard.write，
  // 这次按键带来的用户手势早过期了，Chrome 会直接拒
  navigator.clipboard.write([new ClipboardItem({ 'image/png': blobJob })])
    .then(async () => {
      const r = await job
      // 给自动化测试和排查留个观察点：走的是真截图还是 DOM 重绘
      window.__visualReviseCopyImage = { mode: r.mode, width: r.width, height: r.height, at: Date.now() }
      ctx.toast(`已复制 ${r.width}×${r.height} 图片`)
    })
    .catch(err => {
      const reason = failure?.message || err?.message || String(err)
      window.__visualReviseCopyImage = { error: reason, at: Date.now() }
      ctx.toast(failure ? `截图失败：${reason}` : `写入剪贴板失败：${reason}`, 'error')
    })
    .finally(() => { busy = false })

  return true
}
