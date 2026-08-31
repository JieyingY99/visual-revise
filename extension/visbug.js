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
