var platform = typeof browser === 'undefined'
  ? chrome
  : browser

var toggleIt

export const gimmeToggle = toggleIn => {
  toggleIt = toggleIn
  platform.action.onClicked.addListener(toggleIt)
}

// 菜单在 MV3 中是持久化的，只需在安装/更新时建一次。
// 放模块顶层会随 service worker 的每次休眠—重启反复执行，
// 每次都抛 "Cannot create item with duplicate id"。
export const createLauncherMenu = () => {
  platform.contextMenus.create({
    id:     'launcher',
    title:  'Show/Hide',
    contexts: ['all'],
  })
}

platform.contextMenus.onClicked.addListener(({menuItemId}, tab) => {
  if (menuItemId === 'launcher')
    toggleIt(tab)
})
