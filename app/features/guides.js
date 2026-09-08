import $ from 'blingblingjs'
import { isOffBounds, deepElementFromPoint } from '../utilities/'
import { clearMeasurements, takeMeasurementOwnership } from './measurements'

const state = {
  gridlines:    null,
  measurements: null,
  stuck:        {
    count:        0,
    measurements: [],
  },
}

export function Guides(visbug) {
  $('body').on('mousemove', on_hover)
  $('body').on('mouseout', on_hoverout)

  window.addEventListener('scroll', hideGridlines)
  visbug.onSelectedUpdate(stickGuide)

  return () => {
    $('body').off('mousemove', on_hover)
    $('body').off('mouseout', on_hoverout)

    window.removeEventListener('scroll', hideGridlines)
    visbug.removeSelectedCallback(stickGuide)

    clearMeasurements()
    hideGridlines()
  }
}

const on_hover = e => {
  const target = deepElementFromPoint(e.clientX, e.clientY)
  // 坐标落在视口外时拿不到元素（拖到边缘、鼠标甩出窗口），当作没命中
  if (!target) return
  if (isOffBounds(target)) return
  showGridlines(target)
}

export function createGuide(vert = true) {
  let guide = document.createElement('div')
  let styles = `
    position: absolute;
    top: 0;
    left: 0;
    background: hsla(330, 100%, 71%, 50%);
    pointer-events: none;
    z-index: 2147483643;
  `

  // 线宽乘 --vr-inv-zoom：页面放大时参考线保持 1 屏幕像素（core/zoom.js 维护）
  vert 
    ? styles += `
        width: calc(1px * var(--vr-inv-zoom, 1));
        height: 100vh;
        transform: rotate(180deg);
      `
    : styles += `
        height: calc(1px * var(--vr-inv-zoom, 1));
        width: 100vw;
      `

  guide.style = styles
  guide.dataset.visualReviseGuide = ''

  return guide
}

const stickGuide = els => {
   if (!els.length) return

  if (state.stuck.count >= els.length) {
    state.stuck.measurements.forEach(el => el.remove())
    state.stuck.measurements = []
    state.stuck.count = 0
  }

  state.stuck.count++

  if (els.length > 1) {
    state.stuck.measurements = [
      ...state.stuck.measurements,
      ...takeMeasurementOwnership(),
    ]
  }

  state.gridlines && state.gridlines.remove()
  state.gridlines = null
}

const on_hoverout = () =>
  hideGridlines()

const showGridlines = node => {
  if (state.gridlines) {
    state.gridlines.style.display = null
    state.gridlines.update = node.getBoundingClientRect()
  }
  else {
    state.gridlines = document.createElement('visbug-gridlines')
    state.gridlines.position = node.getBoundingClientRect()

    document.body.appendChild(state.gridlines)
  }
}

const hideGridlines = () => {
  if (!state.gridlines) return
  state.gridlines.style.display = 'none'
}
