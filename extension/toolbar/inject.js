var platform = typeof browser === 'undefined'
  ? chrome
  : browser

// 幂等判据不能只看 <vis-bug> 是否存在：注入若在中途失败（bundle 没加载成功、
// 上一个版本抛错等），页面上会留下一个从未升级的死元素。只看它存在就跳过，
// 用户此后无论点多少次都不会有反应，且刷新前无法自愈。
//
// 真正「活着」的证据是编辑器 UI 已经挂到 body 上——那是自定义元素升级后
// 才会发生的事，且在隔离世界同样可见（DOM 是两个世界共享的）。
try {
  const existing = document.querySelector('vis-bug')
  const mounted  = document.querySelector('visual-revise-toolbar')

  // 死元素：清掉重来，而不是被它挡住
  if (existing && !mounted) existing.remove()

  if (!document.querySelector('vis-bug')) {
    const script = document.createElement('script')
    script.type = 'module'
    // URL 必须保持稳定，不能加时间参数防缓存：module 是按 URL 去重的，
    // 每次换 URL 就会重新执行整个 bundle，customElements.define 第二次
    // 必然抛「已定义」，上面那套幂等判断也就白做了。
    // chrome-extension:// 的资源本来就不走 HTTP 缓存，扩展重载后会读到新文件。
    script.src = platform.runtime.getURL('toolbar/bundle.min.js')
    script.setAttribute('data-visual-revise-bundle', '')
    script.onerror = () =>
      console.error('[Visual Revise] bundle 加载失败，请重新加载扩展')
    document.body.appendChild(script)

    const visbug = document.createElement('vis-bug')
    const src_path = platform.runtime.getURL(`tuts/guides.gif`)
    visbug.setAttribute('tutsBaseURL', src_path.slice(0, src_path.lastIndexOf('/')))

    document.body.prepend(visbug)
  }
} catch (err) {
  console.warn('[Visual Revise] 注入失败：', err?.message || err)
}

// 页面里跑的那份 bundle，是不是磁盘上现在这一份？
//
// bundle 是 ES module，浏览器按 URL 去重：同一个页面只求值一次。所以扩展
// 重载之后，只要这个标签页没有真正重新加载，跑的仍是第一次注入的旧代码——
// 而界面上完全分辨不出来，只会觉得「改了没生效」。
//
// inject.js 每次点图标都由 executeScript 从磁盘重新注入，读到的必然是新的；
// 页面里那份的版本写在 <html data-visual-revise-build> 上（DOM 在隔离世界
// 和主世界之间共用）。两者一比，就能把结论直接说出来，不用让人对着界面猜。
fetch(platform.runtime.getURL('toolbar/build-id.json'))
  .then(res => res.json())
  .then(({ build }) => {
    const running = document.documentElement.dataset.visualReviseBuild
    // 首次注入时 bundle 还没执行完，没有 running，此时无从比较也无需比较
    if (!running || !build || running === build) return
    console.warn(
      `[Visual Revise] 这个页面里跑的是旧代码。\n` +
      `  页面：${running}\n  磁盘：${build}\n` +
      `  扩展已经是新的，但本页的 module 缓存还留着上一版——` +
      `按 ⌘⇧R 硬刷新，或关掉这个标签页重开。`)
  })
  .catch(() => { /* 版本文件缺失不该影响正常注入 */ })

platform.runtime.onMessage.addListener(request => {
  const visbug = document.querySelector('vis-bug')
  if (!visbug) return

  if (request.action === 'COLOR_MODE')
    visbug.setAttribute('color-mode', request.params.mode)
  else if (request.action === 'COLOR_SCHEME')
    visbug.setAttribute('color-scheme', request.params.mode)
})
