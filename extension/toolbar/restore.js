var platform = typeof browser === 'undefined'
  ? chrome
  : browser

try {
  if (!document.querySelector('vis-bug')) {
    const visbug = document.createElement('vis-bug')
    const src_path = platform.runtime.getURL(`tuts/guides.gif`)

    visbug.setAttribute('tutsBaseURL', src_path.slice(0, src_path.lastIndexOf('/')))
    document.body.prepend(visbug)
  }
} catch (err) {
  console.warn('[Visual Revise] 恢复失败：', err?.message || err)
}
