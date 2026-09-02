// 在页面元素外面画一圈描边，用于「这一行说的是它」——记录列表和结构树
// 都要用同一个，两处各画一个的话会同时出现两圈框。
const OVERLAY_ID = 'visual-revise-locate-overlay'

const ensureOverlay = () => {
  let el = document.getElementById(OVERLAY_ID)
  if (el) return el

  el = document.createElement('div')
  el.id = OVERLAY_ID
  el.setAttribute('data-visual-revise-ui', '')
  el.style.cssText = `
    position: absolute; z-index: 2147483645; pointer-events: none;
    border: 2px solid #0d99ff; background: rgb(13 153 255 / .12);
    border-radius: 2px; transition: all .12s ease-out; display: none;`
  document.body.appendChild(el)
  return el
}

export const highlight = el => {
  const overlay = ensureOverlay()
  if (!el?.isConnected) { overlay.style.display = 'none'; return }

  const r = el.getBoundingClientRect()
  Object.assign(overlay.style, {
    display: 'block',
    top:    `${r.top + scrollY}px`,
    left:   `${r.left + scrollX}px`,
    width:  `${r.width}px`,
    height: `${r.height}px`,
  })
}

export const clearHighlight = () => {
  const el = document.getElementById(OVERLAY_ID)
  if (el) el.style.display = 'none'
}
