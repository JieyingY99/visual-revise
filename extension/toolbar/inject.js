var platform = typeof browser === 'undefined'
  ? chrome
  : browser

// 幂等保护：状态机一旦与页面实际情况脱节，重复注入会重复执行
// customElements.define（抛 already defined）并在页面上叠出第二套 UI。
// 以页面里是否已有 <vis-bug> 为准，它才是真实状态。
if (!document.querySelector('vis-bug')) {
  if (!customElements.get('vis-bug')) {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = platform.runtime.getURL('toolbar/bundle.min.js')
    document.body.appendChild(script)
  }

  const visbug = document.createElement('vis-bug')

  const src_path = platform.runtime.getURL(`tuts/guides.gif`)
  visbug.setAttribute('tutsBaseURL', src_path.slice(0, src_path.lastIndexOf('/')))

  document.body.prepend(visbug)
}

platform.runtime.onMessage.addListener(request => {
  const visbug = document.querySelector('vis-bug')
  if (!visbug) return

  if (request.action === 'COLOR_MODE')
    visbug.setAttribute('color-mode', request.params.mode)
  else if (request.action === 'COLOR_SCHEME')
    visbug.setAttribute("color-scheme", request.params.mode)
})
