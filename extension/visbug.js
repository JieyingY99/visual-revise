/**
 * Modified from Project VisBug (https://github.com/GoogleChromeLabs/ProjectVisBug),
 * Copyright Google LLC and its contributors, licensed under the Apache License 2.0.
 *
 * Modifications Copyright 2026 Jieying Yang.
 * This file has been changed from the original. See NOTICE for details.
 */
import {gimmeToggle, createLauncherMenu} from "./contextmenu/launcher.js"
import {getColorMode, createColorModeMenus} from "./contextmenu/colormode.js"
import {getColorScheme, createColorSchemeMenus} from "./contextmenu/colorscheme.js"

const state = {
  loaded:   {},
  injected: {},
}

var platform = typeof browser === 'undefined'
  ? chrome
  : browser

// activeTab 在这些页面上无效，注入必然被拒绝
const RESTRICTED = /^(chrome|edge|brave|about|devtools|view-source|chrome-extension|moz-extension):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/

// MV3 的 action.* 返回 Promise：同步 try/catch 拦不住异步拒绝，
// 延时清除那次调用更是整个落在 try 之外。标签页在这 2.6 秒内被关闭时
// 会抛 "No tab with id"，正是本文件要消灭的那类未处理拒绝。
const quiet = result => {
  if (result && typeof result.catch === 'function') result.catch(() => {})
  return result
}

const flashBadge = (tab_id, text, color) => {
  quiet(platform.action.setBadgeText({tabId: tab_id, text}))
  quiet(platform.action.setBadgeBackgroundColor({tabId: tab_id, color}))

  // 不预判标签页是否还在：受限页面根本不会写入 state，
  // 那样判断会让徽标永远留着。拒绝由 quiet 兜住即可。
  setTimeout(() => quiet(platform.action.setBadgeText({tabId: tab_id, text: ''})), 2600)
}

// 每次点击都注册一个新 listener 会不断累积，改为全局注册一次。
// 必须按 changeInfo 过滤：SPA 更新 document.title 也会触发 onUpdated，
// 若据此把 loaded 置否而 injected 仍为真，下次点击就会走「全新注入」
// 分支，在已经挂着编辑器的页面上再注入一份——两套面板、两个 vis-bug，
// window.__visualRevise 只指向后一个。
//
// 只有真正的导航（status=loading 或 url 变化）才会清掉页面里已注入的
// 脚本，此时两个状态一起重置。
platform.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const navigated = changeInfo.status === 'loading' || typeof changeInfo.url === 'string'
  if (!navigated) return
  if (!(tabId in state.loaded)) return

  state.loaded[tabId]   = false
  state.injected[tabId] = false
})

platform.tabs.onRemoved.addListener(tabId => {
  delete state.loaded[tabId]
  delete state.injected[tabId]
})

// 网页缩放倍数只有扩展进程拿得到：页面里的脚本没有任何 API 能读 tabs.getZoom。
// 注入完发一次，之后每次变化再发；inject.js 把它写到 <html> 上，bundle 据此把
// 面板 / 工具条 / 弹层反向缩回屏幕原大（见 app/core/zoom.js）。
const sendZoom = async (tab_id, zoom) => {
  try {
    if (zoom === undefined) zoom = await platform.tabs.getZoom(tab_id)
    await platform.tabs.sendMessage(tab_id, {action: 'ZOOM', params: {zoom}})
  } catch {
    // 标签页已关、或内容脚本还没装好：下一次 onZoomChange 会再发
  }
}

// 不看 state.loaded：MV3 的 service worker 闲置半分钟就被杀，醒来时 state 是
// 空的，按它判断就永远不发了。没注入过的标签页里没人收，sendMessage 拒绝，
// sendZoom 里兜住
platform.tabs.onZoomChange.addListener(({tabId, newZoomFactor}) => {
  sendZoom(tabId, newZoomFactor)
})

const toggleIn = async tab => {
  const tab_id = tab.id

  if (RESTRICTED.test(tab.url || '')) {
    flashBadge(tab_id, '✕', '#c0392b')
    console.warn('[Visual Revise] 浏览器不允许在此页面注入脚本：', tab.url)
    return
  }

  try {
    // toggle out: it's currently loaded and injected
    if (state.loaded[tab_id] && state.injected[tab_id]) {
      await platform.scripting.executeScript({
        target: {tabId: tab_id},
        files: ['toolbar/eject.js'],
      })
      state.injected[tab_id] = false
      return
    }

    // toggle in: it's loaded and needs injected
    if (state.loaded[tab_id] && !state.injected[tab_id]) {
      await platform.scripting.executeScript({
        target: {tabId: tab_id},
        files: ['toolbar/restore.js'],
      })
      state.injected[tab_id] = true
    }

    // fresh start in tab
    else {
      await platform.scripting.insertCSS({
        target: {tabId: tab_id},
        files: ['toolbar/bundle.css'],
      })
      await platform.scripting.executeScript({
        target: {tabId: tab_id},
        files: ['toolbar/inject.js'],
      })

      state.loaded[tab_id]   = true
      state.injected[tab_id] = true
    }

    sendZoom(tab_id)
    getColorMode()
    getColorScheme()
  } catch (err) {
    // 注入失败的原因不由本扩展决定（页面 CSP、文件协议未授权、
    // 标签页已导航走等）。冒成 unhandled rejection 只会污染扩展错误页，
    // 这里转成一次可见的角标提示。
    state.loaded[tab_id]   = false
    state.injected[tab_id] = false
    flashBadge(tab_id, '✕', '#c0392b')
    console.warn('[Visual Revise] 注入失败：', err?.message || err)
  }
}

// 右键菜单只在安装/更新时建立一次。先 removeAll 清空，避免更新后
// 残留的旧菜单与新建的撞 id；两处调用都吞掉预期内的 lastError。
platform.runtime.onInstalled.addListener(() => {
  platform.contextMenus.removeAll(() => {
    void platform.runtime.lastError
    createLauncherMenu()
    createColorModeMenus()
    createColorSchemeMenus()
  })
})

gimmeToggle(toggleIn)

// ── 参考图落盘 ──────────────────────────────────────────────
// 提示词里要写图片的**绝对路径**，AI 才能自己去读图。但页面拿不到这个路径：
// 浏览器从不告诉网页它把下载文件放在了哪里。downloads API 只在扩展上下文
// 可用，所以这一步必须绕到 background 来做。
//
// 若 downloads 因任何原因不接受（权限被撤、data: URL 被策略拦、磁盘写失败），
// 这里如实返回失败，content script 会退回页面下载通道，并在提示词里把路径
// 标注成「推测」——绝不能让 AI 拿着一个看似确切、实则不存在的路径去读图。

const settleDownload = id => new Promise(resolve => {
  const deadline = Date.now() + 15000
  const poll = () => {
    platform.downloads.search({ id }, ([item]) => {
      void platform.runtime.lastError
      if (item && item.state !== 'in_progress') return resolve(item)
      if (Date.now() > deadline) return resolve(item || null)
      setTimeout(poll, 120)
    })
  }
  poll()
})

const downloadOne = ({ dataUrl, name }, dir) => new Promise(resolve => {
  try {
    platform.downloads.download({
      url: dataUrl,
      filename: `${dir}/${name}`,
      conflictAction: 'uniquify',
      saveAs: false,
    }, async id => {
      // 参数被拒时 id 是 undefined，原因只在 lastError 里
      const err = platform.runtime.lastError
      if (err || id == null) return resolve({ path: null, error: err?.message || '下载未开始' })

      const item = await settleDownload(id)
      resolve(item?.state === 'complete' && item.filename
        ? { path: item.filename }
        : { path: null, error: item?.error || item?.state || '未完成' })
    })
  } catch (err) {
    resolve({ path: null, error: err?.message || String(err) })
  }
})

const saveRefs = async ({ dir, files = [] }) => {
  const out = []
  // 串行：并发触发多个下载时 Chrome 会把它们判成「多文件下载」而弹权限提示
  for (const f of files) {
    const { path, error } = await downloadOne(f, dir)
    out.push({ id: f.id, name: f.name, path: path || null, error })
  }

  return {
    ok:    out.some(f => f.path),
    exact: out.length > 0 && out.every(f => f.path),
    dir,
    files: out,
  }
}

platform.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'vr-save-refs') return

  saveRefs(msg)
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }))

  // 同步返回 true 才能保住消息通道等异步结果
  return true
})

// ── 截图通道 ────────────────────────────────────────────────
// 页面里的脚本拍不到自己的像素，只有扩展进程的 captureVisibleTab 拍得到。
// content script 把请求转到这里，dataURL 原路送回（见 app/features/copy-image.js）。
//
// captureVisibleTab 有配额（每秒 2 次）。选区超出一屏时页面会连着要好几张，
// 撞上配额就整批失败——所以这里排队：两次调用之间至少隔 CAPTURE_GAP，
// 真撞上了再退避重试几次。等待发生在扩展进程，页面那头等得起。
const CAPTURE_GAP = 550
let lastCaptureAt = 0

const captureOnce = async window_id => {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCaptureAt + CAPTURE_GAP - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    lastCaptureAt = Date.now()

    try {
      return await platform.tabs.captureVisibleTab(window_id, { format: 'png' })
    } catch (err) {
      const msg = err?.message || String(err)
      // 配额之外的原因（没权限、页面受限、标签页没了）重试也没用，直接抛
      if (attempt >= 3 || !/MAX_CAPTURE|quota|rate/i.test(msg)) throw err
    }
  }
}

// 多个标签页同时要图时也串起来，免得互相把对方挤进配额上限
let captureQueue = Promise.resolve()
const enqueueCapture = task => {
  const next = captureQueue.then(task, task)
  captureQueue = next.then(() => {}, () => {})
  return next
}

platform.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'vr-capture') return

  enqueueCapture(async () => {
    const tab = sender?.tab
    if (!tab) throw new Error('拿不到发起截图的标签页')
    // captureVisibleTab 拍的是那个窗口当前显示的标签页。请求方要是已经切到
    // 后台，拍回去的会是别人的画面——宁可如实报错，也不能给一张错的图
    if (tab.active === false) throw new Error('标签页已切到后台')

    const dataUrl = await captureOnce(tab.windowId)
    if (!dataUrl) throw new Error('截图为空')
    return dataUrl
  })
    .then(dataUrl => sendResponse({ ok: true, dataUrl }))
    .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }))

  // 同步返回 true 才能保住消息通道等异步结果
  return true
})
