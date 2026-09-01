// 元素身上的「图」在 CSS 里有两个互不相干的来源：<img>/<video> 自己的 src，
// 和任意元素的 background-image。Figma 里这两者是同一件事——图层的 Fill 是
// 一张图。面板要一视同仁地把它显示出来，否则用户根本看不出自己选中的是哪张图。

const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/

// background-image 的值可能是渐变、多层背景、或 none。只认第一层 url()。
export const parseCssUrl = value => {
  if (!value || value === 'none') return null
  const m = URL_RE.exec(value)
  return m && m[2] ? m[2] : null
}

export const fileNameOf = url => {
  if (!url) return ''

  // data URI 没有文件名，退而给出类型——总比显示一整段 base64 强
  if (/^data:/i.test(url)) {
    const mime = /^data:([^;,]+)/i.exec(url)?.[1] || 'image'
    return `内嵌图片 · ${mime}`
  }
  if (/^blob:/i.test(url)) return '本地图片'

  try {
    const name = new URL(url, location.href).pathname.split('/').pop()
    return decodeURIComponent(name) || url
  } catch {
    return url
  }
}

// 用户看到的那张图的地址。<img> 要取 currentSrc 而不是 src：srcset / picture
// 场景下真正渲染的是前者，拿 src 会指向一张根本没显示的图。
export const imageSourceOf = (el, computed) => {
  if (!el || el.nodeType !== 1) return null

  const tag = el.tagName.toLowerCase()

  if (tag === 'img') {
    const url = el.currentSrc || el.getAttribute('src') || ''
    if (!url) return null
    return {
      kind: 'src',
      url,
      label: fileNameOf(url),
      natural: el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null,
      // srcset 命中了别的候选图时，src 与实际渲染的不是同一张，导出提示词
      // 要把两者都写上，否则 AI 去源码里搜 src 会对不上眼前看到的图
      declaredSrc: el.getAttribute('src') || '',
    }
  }

  if (tag === 'video') {
    const url = el.getAttribute('poster') || el.currentSrc || el.getAttribute('src') || ''
    if (!url) return null
    return {
      kind: el.getAttribute('poster') ? 'poster' : 'src',
      url,
      label: fileNameOf(url),
      natural: el.videoWidth ? { w: el.videoWidth, h: el.videoHeight } : null,
      declaredSrc: el.getAttribute('src') || '',
    }
  }

  const bg = computed?.['background-image'] ?? getComputedStyle(el).backgroundImage
  const url = parseCssUrl(bg)
  if (!url) return null

  return {
    kind: 'background',
    url,
    label: fileNameOf(url),
    natural: null,          // 背景图的天然尺寸要异步量，见面板里的 measureNatural
    declaredSrc: '',
  }
}

// 背景图量不到天然尺寸（CSS 不暴露），只能另外加载一次。浏览器缓存已经有了
// 这张图，代价接近于零。失败时静默——量不到尺寸不该让整行显示不出来。
export const measureNatural = url => new Promise(resolve => {
  if (!url) return resolve(null)
  const img = new Image()
  img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
  img.onerror = () => resolve(null)
  img.src = url
})

export const describeSize = natural =>
  natural && natural.w ? `${natural.w} × ${natural.h}` : ''
