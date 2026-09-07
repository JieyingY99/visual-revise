/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 图片资产：把用户从任意入口（选文件 / 拖拽 / 粘贴）给进来的图，规范成
// 同一种结构，供评论参考图与 Fill 换图共用。
//
// 内存里一律存 dataUrl 而不是 blob URL：blob URL 绑在文档生命周期上，页面一
// 刷新就失效，而改动记录要能导出成 JSON 交给别人；dataUrl 是自包含的。

export const MAX_BYTES = 5 * 1024 * 1024      // 单张上限
export const MAX_TOTAL  = 20 * 1024 * 1024    // 一次会话累计上限

const ACCEPTED = /^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/i

export const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
}

let seq = 0
const nextId = () => `im-${++seq}`

// ── 命名 ──
// 剪贴板里的截图没有真名字：Chrome 一律叫 image.png，别的浏览器可能什么都不给。
// 这类名字没有任何信息量，一条评论里贴三张就是三个 image.png，谁也分不清。
// 改用「当天日期 + 两位序号」，至少能看出是哪天的第几张。
//
// 只替换这种占位名。从 Finder 复制一个真实文件再粘贴时 File.name 是真名
// （「设计稿-v3.png」），那种带信息，改掉反而是丢东西。
const PLACEHOLDER_NAME = /^(image|untitled|未命名|blob)(\s*\(\d+\))?(\.[a-z0-9]+)?$/i

const pad2 = n => String(n).padStart(2, '0')

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// 序号只活在内存里，刷新页面就从 01 重来。这不会撞名：
// 导出目录本身带时间戳（visual-revise-refs/<日期-时分秒>/），
// 且落盘时还会再加一层 01- 前缀。
let nameDay = ''
let nameSeq = 0

const datedName = mime => {
  const day = today()
  if (day !== nameDay) { nameDay = day; nameSeq = 0 }   // 跨天归零
  return `${day}-${pad2(++nameSeq)}.${EXT_BY_MIME[mime] || 'png'}`
}

export const assetName = file =>
  file?.name && !PLACEHOLDER_NAME.test(file.name)
    ? file.name
    : datedName(file?.type)

export const isAcceptedImage = file =>
  !!file && ACCEPTED.test(file.type || '')

const readDataUrl = file => new Promise((resolve, reject) => {
  const fr = new FileReader()
  fr.onload  = () => resolve(String(fr.result))
  fr.onerror = () => reject(fr.error || new Error('读取失败'))
  fr.readAsDataURL(file)
})

// 天然尺寸要另外解一次码。SVG 没有固有像素尺寸，量出来可能是 0，
// 那就不写尺寸而不是写 0×0。
const measure = dataUrl => new Promise(resolve => {
  const img = new Image()
  img.onload  = () => resolve(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null)
  img.onerror = () => resolve(null)
  img.src = dataUrl
})

export const readImageFile = async file => {
  if (!isAcceptedImage(file))
    return { ok: false, reason: `不支持的类型：${file?.type || '未知'}` }

  if (file.size > MAX_BYTES)
    return { ok: false, reason: `图片过大（${fmtBytes(file.size)}，上限 ${fmtBytes(MAX_BYTES)}）` }

  try {
    const dataUrl = await readDataUrl(file)
    const natural = await measure(dataUrl)
    return {
      ok: true,
      asset: {
        id:      nextId(),
        name:    assetName(file),
        mime:    file.type,
        dataUrl,
        bytes:   file.size,
        w:       natural?.w || 0,
        h:       natural?.h || 0,
        note:    '',
      },
    }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

// 拖拽与粘贴给的都是 DataTransfer，处理方式一致。
// 逐个隔离：一张读失败不该连累同一批的其它图。
//
// base 是「这次会话已经收下多少字节」，由调用方传进来（一般是
// totalBytes(ChangeStore.allAssets())）。这个模块是纯函数集合，拿不到 store，
// 让它反向依赖 store 才是更糟的耦合；而不给基数的话 MAX_TOTAL 只能管住
// 单批，连着粘三次每次 19MB 照样过——那正是这条上限一直形同虚设的原因。
export const readImageList = async (files, { base = 0 } = {}) => {
  const assets = []
  const errors = []
  let used = Math.max(0, base || 0)

  for (const file of Array.from(files || [])) {
    if (!isAcceptedImage(file)) continue

    if (used + (file.size || 0) > MAX_TOTAL) {
      errors.push(`已超出会话累计上限（${fmtBytes(MAX_TOTAL)}）`)
      continue
    }

    const res = await readImageFile(file)
    if (!res.ok) { errors.push(res.reason); continue }

    assets.push(res.asset)
    used += res.asset.bytes || 0
  }

  return { assets, errors }
}

export const imagesFromDataTransfer = (dt, opts) => {
  if (!dt) return { assets: [], errors: [] }

  // 粘贴来的截图在 items 里，拖进来的文件在 files 里；两边都取一遍再去重
  const fromItems = Array.from(dt.items || [])
    .filter(i => i.kind === 'file')
    .map(i => i.getAsFile())
    .filter(Boolean)

  const all = fromItems.length ? fromItems : Array.from(dt.files || [])
  return readImageList(all, opts)
}

// 选文件对话框。放在这里而不是各组件里，免得三处入口各写一份。
export const pickImages = opts => new Promise(resolve => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = async () => resolve(await readImageList(input.files, opts))
  input.click()
})

export const fmtBytes = n =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB`
  : n >= 1024      ? `${Math.round(n / 1024)} KB`
  : `${n} B`

export const totalBytes = assets =>
  (assets || []).reduce((n, a) => n + (a.bytes || 0), 0)

// 页面的 CSP 可能禁掉 img-src data:，那样缩略图会静默变成裂图。
// 探测一次，结果缓存：拿不到预览时改为只列文件名，功能不受影响。
let dataUrlOk = null
export const canRenderDataUrl = () => {
  if (dataUrlOk !== null) return Promise.resolve(dataUrlOk)

  return new Promise(resolve => {
    const probe = new Image()
    const done = ok => { dataUrlOk = ok; resolve(ok) }
    probe.onload  = () => done(true)
    probe.onerror = () => done(false)
    // 1×1 透明 PNG
    probe.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  })
}

// 仅供测试重置探测缓存
export const __resetDataUrlProbe = () => { dataUrlOk = null }
