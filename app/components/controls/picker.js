/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 色盘主体：SV 面板 + 色相条 + 透明度条 + 吸管 + 格式与数值输入。
//
// 纯色填充和渐变里的每一个色标用的是同一套控件，所以抽出来共用。
// 这里只管「一个颜色怎么被编辑」，不管它最终写到哪个 CSS 属性上。

import './select.element.js'

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const round = n => Math.round(n * 100) / 100

// ── 颜色换算 ──────────────────────────────────────────────
export const hsvToRgb = (h, s, v) => {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60  ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export const rgbToHsv = (r, g, b) => {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const d = max - min

  let h = 0
  if (d) {
    const [rr, gg, bb] = [r / 255, g / 255, b / 255]
    h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
    h = (h * 60 + 360) % 360
  }

  return [h, max ? d / max : 0, max]
}

const toHex = n => n.toString(16).padStart(2, '0')

// 解析任意 CSS 颜色：交给浏览器算，比手写正则可靠
export const parseColor = input => {
  const probe = document.createElement('div')
  probe.style.color = ''
  probe.style.color = String(input || '').trim()

  if (!probe.style.color) return { r: 0, g: 0, b: 0, a: 1, valid: false }

  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()

  const m = computed.match(/rgba?\(([^)]+)\)/)
  if (!m) return { r: 0, g: 0, b: 0, a: 1, valid: false }

  const [r, g, b, a = 1] = m[1].split(',').map(v => parseFloat(v))
  return { r, g, b, a, valid: true }
}

export const formatColor = ({ r, g, b, a }, format) => {
  if (format === 'RGB') return a < 1 ? `rgba(${r}, ${g}, ${b}, ${round(a)})` : `rgb(${r}, ${g}, ${b})`

  if (format === 'HSL') {
    const [h, s, v] = rgbToHsv(r, g, b)
    const l = v * (1 - s / 2)
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l)
    const parts = `${Math.round(h)}, ${Math.round(sl * 100)}%, ${Math.round(l * 100)}%`
    return a < 1 ? `hsla(${parts}, ${round(a)})` : `hsl(${parts})`
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(Math.round(a * 255)) : ''}`
}

// ── 通用样式片段 ──────────────────────────────────────────
export const CHECKER = `
  background-image:
    linear-gradient(45deg, #6a6a6a 25%, transparent 25%, transparent 75%, #6a6a6a 75%),
    linear-gradient(45deg, #6a6a6a 25%, transparent 25%, transparent 75%, #6a6a6a 75%);
  background-size: 10px 10px;
  background-position: 0 0, 5px 5px;`

export const PANEL_STYLE = `
  position: fixed; z-index: 2147483647; padding: 12px;
  background: #1e1e1e; border-radius: 12px;
  box-shadow: 0 10px 40px rgb(0 0 0 / .55), inset 0 0 0 1px rgb(255 255 255 / .07);
  font: 400 12px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #fff;`

const EYEDROPPER_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/>
  <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
</svg>`

// ── 色盘主体 ──────────────────────────────────────────────
export const pickerMarkup = ({ svHeight = 170 } = {}) => `
  <div class="sv" style="position:relative;height:${svHeight}px;border-radius:8px;cursor:crosshair;overflow:hidden">
    <div class="sv-thumb" style="position:absolute;width:14px;height:14px;border-radius:50%;
      border:2px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / .45);transform:translate(-50%,-50%);
      pointer-events:none"></div>
  </div>

  <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
    <button class="eye" title="从屏幕上取色"
      style="flex:none;width:28px;height:28px;display:grid;place-items:center;color:#b3b3b3;
             background:transparent;border:none;border-radius:6px;cursor:pointer">${EYEDROPPER_ICON}</button>
    <div style="flex:1;display:grid;gap:10px">
      <div class="hue" style="position:relative;height:12px;border-radius:6px;cursor:pointer;
        background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)">
        <div class="hue-thumb" style="position:absolute;top:50%;width:16px;height:16px;border-radius:50%;
          border:2px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / .45);transform:translate(-50%,-50%);
          pointer-events:none"></div>
      </div>
      <div class="alpha" style="position:relative;height:12px;border-radius:6px;cursor:pointer;${CHECKER}">
        <div class="alpha-fill" style="position:absolute;inset:0;border-radius:6px"></div>
        <div class="alpha-thumb" style="position:absolute;top:50%;width:16px;height:16px;border-radius:50%;
          border:2px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / .45);transform:translate(-50%,-50%);
          pointer-events:none"></div>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:6px;margin-top:12px;align-items:center">
    <vr-select class="format" value="Hex" options='["Hex","RGB","HSL"]' style="flex:0 0 74px"></vr-select>
    <input class="val" style="flex:1;min-width:0;height:30px;padding:0 8px;
      font:400 11px/1 ui-monospace,Menlo,monospace;color:#fff;background:#383838;
      border:1px solid transparent;border-radius:5px;outline:none">
    <div style="flex:0 0 62px;display:flex;align-items:center;background:#383838;border-radius:5px;height:30px">
      <input class="alpha-val" style="width:100%;min-width:0;height:100%;padding:0 4px 0 8px;
        font:400 11px/1 -apple-system,system-ui,sans-serif;color:#fff;background:transparent;
        border:none;outline:none;text-align:right">
      <span style="padding:0 8px 0 2px;color:#8c8c8c">%</span>
    </div>
  </div>`

const drag = (el, onMove, after) => {
  el.addEventListener('pointerdown', e => {
    e.preventDefault()
    el.setPointerCapture(e.pointerId)

    const move = ev => {
      const r = el.getBoundingClientRect()
      onMove(clamp((ev.clientX - r.left) / r.width, 0, 1),
             clamp((ev.clientY - r.top) / r.height, 0, 1))
      after()
    }
    const up = ev => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }

    move(e)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  })
}

// onChange(cssString, rgba) —— 每次用户操作都会调用
export const createPicker = (root, { onChange, format = 'Hex' } = {}) => {
  let hsv = [0, 0, 0]
  let alpha = 1
  let fmt = format

  const q = sel => root.querySelector(sel)

  const rgba = () => {
    const [r, g, b] = hsvToRgb(...hsv)
    return { r, g, b, a: alpha }
  }

  const sync = () => {
    const [h] = hsv
    const { r, g, b } = rgba()

    q('.sv').style.background =
      `linear-gradient(to top, #000, transparent),
       linear-gradient(to right, #fff, transparent),
       hsl(${h}, 100%, 50%)`

    const svThumb = q('.sv-thumb')
    svThumb.style.left = `${hsv[1] * 100}%`
    svThumb.style.top = `${(1 - hsv[2]) * 100}%`
    svThumb.style.background = `rgb(${r},${g},${b})`

    const hueThumb = q('.hue-thumb')
    hueThumb.style.left = `${(h / 360) * 100}%`
    hueThumb.style.background = `hsl(${h}, 100%, 50%)`

    q('.alpha-fill').style.background =
      `linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))`
    const alphaThumb = q('.alpha-thumb')
    alphaThumb.style.left = `${alpha * 100}%`
    alphaThumb.style.background = `rgba(${r},${g},${b},${alpha})`

    // 正在输入的字段不覆盖，否则光标会被顶掉
    const val = q('.val')
    const focused = document.activeElement === val || val.getRootNode?.().activeElement === val
    if (!focused) val.value = formatColor(rgba(), fmt)

    q('.alpha-val').value = Math.round(alpha * 100)
    q('.format').setAttribute('value', fmt)
  }

  const emit = () => {
    onChange?.(formatColor(rgba(), fmt), rgba())
    sync()
  }

  drag(q('.sv'), (x, y) => { hsv = [hsv[0], x, 1 - y] }, emit)
  drag(q('.hue'), x => { hsv = [x * 360, hsv[1], hsv[2]] }, emit)
  drag(q('.alpha'), x => { alpha = x }, emit)

  q('.format').addEventListener('vr-select', e => { fmt = e.detail.value; emit() })

  q('.val').addEventListener('change', e => {
    const c = parseColor(e.target.value)
    if (!c.valid) return sync()
    hsv = rgbToHsv(c.r, c.g, c.b)
    alpha = c.a
    emit()
  })

  q('.alpha-val').addEventListener('change', e => {
    alpha = clamp(parseFloat(e.target.value) / 100 || 0, 0, 1)
    emit()
  })

  const eye = q('.eye')
  if (!window.EyeDropper) {
    eye.disabled = true
    eye.style.opacity = '.35'
    eye.title = '当前浏览器不支持屏幕取色'
  } else {
    eye.addEventListener('click', async () => {
      try {
        const { sRGBHex } = await new EyeDropper().open()
        const c = parseColor(sRGBHex)
        if (!c.valid) return
        hsv = rgbToHsv(c.r, c.g, c.b)
        emit()
      } catch { /* 用户按 Esc 取消 */ }
    })
  }

  return {
    sync,
    get format() { return fmt },
    get rgba() { return rgba() },
    // 载入一个颜色但不触发 onChange——用于外部同步
    set(value) {
      const c = parseColor(value)
      const use = c.valid ? c : { r: 0, g: 0, b: 0, a: 0 }
      hsv = rgbToHsv(use.r, use.g, use.b)
      alpha = use.a
      sync()
    },
  }
}
