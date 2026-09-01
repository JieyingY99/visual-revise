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
      // URL 必须保持稳定，不能加时间参数防缓存：module 是按 URL 去重的，
    // 每次换 URL 就会重新执行整个 bundle，customElements.define 第二次
    // 必然抛「已定义」，上面那套幂等判断也就白做了。
    // chrome-extension:// 的资源本来就不走 HTTP 缓存，扩展重载后会读到新文件。
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
