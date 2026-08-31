const storagekey = 'visbug-color-mode'
const defaultcolormode = 'hex'

const color_options = [
  'hsl',
  'hex',
  'rgb',
  // 'hsv',
  // 'lch',
  // 'lab',
  // 'hcl',
  // 'cmyk',
  // 'gl',
  // 'as authored',
]

const colormodestate = {
  mode: defaultcolormode
}

var platform = typeof browser === 'undefined'
  ? chrome
  : browser

// 页面尚未注入编辑器时没有接收方，这是预期情况而非错误。
// MV3 的 sendMessage 返回 Promise，不接住就会变成 Uncaught (in promise)。
const postToTab = (tabId, message) => {
  try {
    const result = platform.tabs.sendMessage(tabId, message)
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch { /* 标签页已关闭或无接收方 */ }
}

const sendColorMode = () => {
  platform.tabs.query({active: true, currentWindow: true}, ([tab]) => {
    if (tab) postToTab(tab.id, {
      action: 'COLOR_MODE',
      params: {mode:colormodestate.mode},
    })
  })
}

export const getColorMode = () => {
  platform.storage.sync.get([storagekey], value => {
    let found_value = value[storagekey]

    const is_default = found_value
      ? value[storagekey] === defaultcolormode
      : false

    // first run
    if (!found_value && !is_default) {
      found_value = defaultcolormode
      platform.storage.sync.set({[storagekey]: defaultcolormode})
    }

    // migrate old choices
    if (found_value === 'hsla') {
      found_value = 'hsl'
      platform.storage.sync.set({[storagekey]: found_value})
    }
    if (found_value === 'rgba') {
      found_value = 'rgb'
      platform.storage.sync.set({[storagekey]: found_value})
    }

    // update checked state of color contextmenu radio list
    color_options.forEach(option => {
      // 首次安装、菜单尚未建立时 update 会失败，属预期情况
      platform.contextMenus.update(option, { checked: option === found_value },
        () => void platform.runtime.lastError)
    })

    // send visbug user preference
    colormodestate.mode = found_value
    sendColorMode()

    return found_value
  })
}

// load synced color choice on load
getColorMode()

export const createColorModeMenus = () => {
  platform.contextMenus.create({
    id:     'color-mode',
    title:  'Colors',
    contexts: ['all'],
  })

  color_options.forEach(option => {
    platform.contextMenus.create({
      id:       option,
      parentId: 'color-mode',
      title:    ' '+option,
      checked:  false,
      type:     'radio',
      contexts: ['all'],
    })
  })
}

platform.contextMenus.onClicked.addListener(({parentMenuItemId, menuItemId}, tab) => {
  if (parentMenuItemId !== 'color-mode') return

  platform.storage.sync.set({[storagekey]: menuItemId})
  colormodestate.mode = menuItemId

  sendColorMode()
})
