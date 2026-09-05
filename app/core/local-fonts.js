/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// Local Font Access API 仅在安全上下文可用，且需要用户显式授权。
// 拒绝或不支持时，字体控件退回自由输入。
export const isSupported = () => typeof window.queryLocalFonts === 'function'

let cache = null

export const loadLocalFonts = async () => {
  if (cache) return { ok: true, fonts: cache, cached: true }

  if (!isSupported())
    return { ok: false, reason: '当前浏览器不支持读取本地字体', fonts: [] }

  try {
    const raw = await window.queryLocalFonts()
    const families = [...new Set(raw.map(f => f.family))].sort((a, b) => a.localeCompare(b))
    cache = families
    return { ok: true, fonts: families }
  } catch (err) {
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
    return {
      ok: false,
      reason: denied ? '已拒绝字体访问授权，可手动输入字体名' : `读取失败：${err.message}`,
      fonts: [],
    }
  }
}

export const clearFontCache = () => { cache = null }

// ── font-family 是个后备栈，不是一个字体 ──
// 面板里只展示栈首那一个：整串塞进输入框会被截断成
// 「Poppins, Poppins, "PingFang TC", "Micros…」，读到的反而是最不重要的那截，
// 而真正决定字形的是第一个。

export const primaryFont = stack =>
  String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '')

// 换字体时只换栈首，后备原样留着。
// 直接写死一个字体名会把中文后备字体一起丢掉——英文看着没事，
// 页面上的中文会掉回浏览器默认字形。
export const withPrimaryFont = (stack, next) => {
  const rest = String(stack || '')
    .split(',').slice(1).map(s => s.trim()).filter(Boolean)
  // 带空格的字体名在 CSS 里要引号，否则整条声明作废
  const head = /\s/.test(next) && !/^["']/.test(next) ? `"${next}"` : next
  return [head, ...rest].join(', ')
}

// 没读取本地字体前的兜底选项：各平台都拿得到的那几个，
// 外加 system-ui 这种「跟随系统」的关键字
export const COMMON_FONTS = [
  'system-ui', 'Inter', 'Helvetica Neue', 'Helvetica', 'Arial',
  'Georgia', 'Times New Roman', 'SF Mono', 'Menlo', 'Monaco', 'Courier New',
  'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC',
]
