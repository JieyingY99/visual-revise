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
