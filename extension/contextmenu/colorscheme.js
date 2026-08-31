const schemestoragekey = 'visbug-color-scheme';
const defaultcolorscheme = 'auto';

const scheme_option = [
  'auto',
  'light',
  'dark',
]

const colorschemestate = {
  mode: defaultcolorscheme
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

const sendColorScheme = () => {
  platform.tabs.query({active: true, currentWindow: true}, ([tab]) => {
    if (tab) postToTab(tab.id, {
      action: 'COLOR_SCHEME',
      params: {mode:colorschemestate.mode},
    })
  })
}

export const getColorScheme = () => {
  platform.storage.sync.get([schemestoragekey], value => {
    let found_value = value[schemestoragekey];

    // first run
    if (!found_value) {
      found_value = defaultcolorscheme;
      platform.storage.sync.set({ [schemestoragekey]: defaultcolorscheme });
    }

    // update checked state of scheme contextmenu radio list
    scheme_option.forEach(option => {
      platform.contextMenus.update(option, {
        checked: option === found_value
      })
    })

    // send visbug user preference
    colorschemestate.mode = found_value
    sendColorScheme()

    return found_value
  })
}

// load synced scheme choice on load
getColorScheme()

platform.contextMenus.create({
  id:     'color-scheme',
  title:  'Theme',
  contexts: ['all'],
})

scheme_option.forEach(option => {
  platform.contextMenus.create({
    id:       option,
    parentId: 'color-scheme',
    title:    ' '+option,
    checked:  false,
    type:     'radio',
    contexts: ['all'],
  })
})

platform.contextMenus.onClicked.addListener(({parentMenuItemId, menuItemId}, tab) => {
  if (parentMenuItemId !== 'color-scheme') return

  platform.storage.sync.set({[schemestoragekey]: menuItemId})
  colorschemestate.mode = menuItemId

  sendColorScheme()
})
