// 把参考图落到磁盘，并尽可能拿回**绝对路径**，供提示词内联给 AI。
//
// 为什么非要落盘：剪贴板一次只能携带纯文本，或一张图，带不了「文本 + 多张图」。
// 而 base64 内联会让提示词膨胀到没法粘贴，多数 AI 也不解析提示词里的 data URI。
// 「落盘 + 绝对路径」是唯一能让 AI 真正看到多张参考图的通道。
//
// 两条路径，运行时自适应而不是构建期赌一个结论：
//   扩展通道 —— background 调 chrome.downloads 下载，再查回真实绝对路径。
//               只有这条拿得到确切路径。
//   页面通道 —— 直接 <a download>。浏览器不告诉页面文件落在哪，只能按默认下载
//               目录推测；提示词里会标注这一点，免得 AI 拿着一个不存在的路径去读图。

export const REF_DIR = 'visual-revise-refs'
const TIMEOUT = 10000

export const hasExtensionChannel = () => {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function'
  } catch {
    return false
  }
}

const pad = n => String(n).padStart(2, '0')

export const stampFolder = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
}

// 文件名要能被人和 AI 一眼对上号，同时不能带路径分隔符或奇怪字符
const safeName = (asset, i) => {
  const ext = EXT_BY_MIME[asset.mime] || (asset.name?.split('.').pop() || 'png').toLowerCase()
  const base = (asset.name || '').replace(/\.[^.]*$/, '').replace(/[^\w一-龥-]+/g, '-').slice(0, 40)
  return `${String(i + 1).padStart(2, '0')}-${base || 'ref'}.${ext}`
}

// 家目录写不进提示词里的真实路径，但给个约定俗成的位置总比什么都不说强。
// 只在降级路径上用，且一定会连带标注「推测」。
const guessHome = () => {
  const ua = navigator.userAgent || ''
  if (/Windows/i.test(ua)) return '%USERPROFILE%\\Downloads'
  return '~/Downloads'
}

const joinPath = (...parts) =>
  /Windows/i.test(navigator.userAgent || '') ? parts.join('\\') : parts.join('/')

const viaExtension = (dir, files) => new Promise(resolve => {
  let settled = false
  const done = v => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } }

  // background 可能已被回收、或消息通道断掉。复制这个动作必须在有限时间内
  // 给出结果，不能因为等一个永远不来的回调把整次复制挂死。
  const timer = setTimeout(() => done(null), TIMEOUT)

  try {
    chrome.runtime.sendMessage({ type: 'vr-save-refs', dir, files }, res => {
      if (chrome.runtime.lastError) return done(null)
      done(res && res.ok ? res : null)
    })
  } catch {
    done(null)
  }
})

// 页面通道：逐个触发下载。浏览器会把它们放进默认下载目录，
// 但不会告诉我们放在哪，也不保证子目录（多数浏览器会忽略 download 属性里的路径）
const viaPage = async (dir, files) => {
  for (const f of files) {
    const a = document.createElement('a')
    a.href = f.dataUrl
    a.download = f.name
    a.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 连续触发多个下载时，浏览器可能只认第一个；隔开一点
    await new Promise(r => setTimeout(r, 120))
  }

  return {
    ok: true,
    exact: false,
    dir: guessHome(),
    files: files.map(f => ({ id: f.id, name: f.name, path: joinPath(guessHome(), f.name) })),
  }
}

// assets: image-assets.js 产出的那种对象数组
export const saveRefImages = async (assets, { stamp = stampFolder() } = {}) => {
  const list = (assets || []).filter(a => a?.dataUrl)
  if (!list.length) return { ok: true, exact: true, dir: '', files: [] }

  const dir = `${REF_DIR}/${stamp}`
  const files = list.map((a, i) => ({
    id: a.id,
    name: safeName(a, i),
    dataUrl: a.dataUrl,
  }))

  if (hasExtensionChannel()) {
    const res = await viaExtension(dir, files)
    // 扩展通道失败就退到页面通道，而不是让用户拿不到图。
    // 但要如实把 exact=false 传下去，提示词才会标注路径不确定。
    if (res?.files?.length) return { ...res, exact: res.exact !== false }
  }

  return viaPage(dir, files)
}
