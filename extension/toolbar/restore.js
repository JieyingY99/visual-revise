var platform = typeof browser === 'undefined'
  ? chrome
  : browser

try {
  const mounted = document.querySelector('visual-revise-toolbar')
  const existing = document.querySelector('vis-bug')

  if (existing && !mounted) existing.remove()

  if (!document.querySelector('vis-bug')) {
    // bundle 可能从未成功加载过（状态机与页面实际情况脱节），
    // 重新挂一次；module map 保证已加载过时不会重复求值
    if (!document.querySelector('script[data-visual-revise-bundle]')) {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = platform.runtime.getURL('toolbar/bundle.min.js')
      script.setAttribute('data-visual-revise-bundle', '')
      document.body.appendChild(script)
    }

    const visbug = document.createElement('vis-bug')
    const src_path = platform.runtime.getURL(`tuts/guides.gif`)

    visbug.setAttribute('tutsBaseURL', src_path.slice(0, src_path.lastIndexOf('/')))
    document.body.prepend(visbug)
  }
} catch (err) {
  console.warn('[Visual Revise] 恢复失败：', err?.message || err)
}
