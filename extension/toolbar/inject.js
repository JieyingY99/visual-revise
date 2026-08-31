var platform = typeof browser === 'undefined'
  ? chrome
  : browser

// 幂等保护以页面里是否已有 <vis-bug> 为准——DOM 是隔离世界与主世界共享的，
// 而 customElements 各世界一套 registry，在这里查主世界的注册情况既查不到，
// 某些上下文下 customElements 还可能为 null。
// 重复插入同 URL 的 module script 也不会重复执行（module map 保证）。
try {
  if (!document.querySelector('vis-bug')) {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = platform.runtime.getURL('toolbar/bundle.min.js')
    document.body.appendChild(script)

    const visbug = document.createElement('vis-bug')
    const src_path = platform.runtime.getURL(`tuts/guides.gif`)
    visbug.setAttribute('tutsBaseURL', src_path.slice(0, src_path.lastIndexOf('/')))

    document.body.prepend(visbug)
  }
} catch (err) {
  console.warn('[Visual Revise] 注入失败：', err?.message || err)
}

platform.runtime.onMessage.addListener(request => {
  const visbug = document.querySelector('vis-bug')
  if (!visbug) return

  if (request.action === 'COLOR_MODE')
    visbug.setAttribute('color-mode', request.params.mode)
  else if (request.action === 'COLOR_SCHEME')
    visbug.setAttribute('color-scheme', request.params.mode)
})
