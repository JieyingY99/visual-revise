/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 效果列表：把 Figma 的 Effects 面板映射到 CSS。
//
// 七种里有四种是一一对应的（两种阴影 + 两种模糊），另外三种 CSS 没有原生对应，
// 只能拼出近似的：
//   噪点 / 纹理 —— SVG 的 feTurbulence 生成一张图，当成 background-image 的
//     一层铺在最上面。它跟 Fill 共用 background-image，所以两边必须讲好谁写
//     哪几层：这里生成的层在 data URI 里带一个记号（vr-noise / vr-texture），
//     fills.js 解析时按记号跳过，面板写回时把效果层放在填充层前面（画在上面）。
//   玻璃 —— backdrop-filter 的模糊加饱和，再补一道 inset 高光。Figma 的
//     Refraction / Depth / Dispersion / Frost / Splay 是它自己渲染器里的折射
//     运算，CSS 里没有任何东西对得上，所以那几个滑块这里没有，不做假的。
//
// Figma 的 Shader 需要 WebGL 或 Houdini paint worklet，不在这一层的能力范围内。

import { splitTopLevel } from './gradient.js'

export const EFFECTS = [
  { type: 'inner-shadow',    label: '内阴影',  channel: 'box-shadow' },
  { type: 'drop-shadow',     label: '投影',    channel: 'box-shadow' },
  { type: 'layer-blur',      label: '图层模糊', channel: 'filter' },
  { type: 'background-blur', label: '背景模糊', channel: 'backdrop-filter' },
  { type: 'noise',           label: '噪点',    channel: 'background-image' },
  { type: 'texture',         label: '纹理',    channel: 'background-image' },
  { type: 'glass',           label: '玻璃',    channel: 'backdrop-filter' },
]

export const EFFECT_LABEL = Object.fromEntries(EFFECTS.map(e => [e.type, e.label]))

const DEFAULTS = {
  'inner-shadow':    { x: 0, y: 4, blur: 4, spread: 0, color: 'rgba(0, 0, 0, 0.25)' },
  'drop-shadow':     { x: 0, y: 4, blur: 4, spread: 0, color: 'rgba(0, 0, 0, 0.25)' },
  'layer-blur':      { blur: 4 },
  'background-blur': { blur: 4 },
  'noise':           { size: 0.5, density: 100, color: 'rgba(0, 0, 0, 0.25)' },
  'texture':         { size: 4, radius: 4 },
  'glass':           { blur: 12, saturate: 180, highlight: 40 },
}

export const defaultsFor = type => ({ ...DEFAULTS[type] })

// ── 噪点 / 纹理 ────────────────────────────────────────────
// baseFrequency 越大颗粒越细。噪点走高频（细密的沙），纹理走低频（粗颗粒）。
//
// 用户填的原始参数额外原样写进 SVG 根元素的 data-vr 上。不这么做就只能从
// baseFrequency / opacity 倒推，而正向那两步都有夹取——纹理的 size ≤ 1 全被夹成
// freq=1.00、radius ≥ 10 全被夹成 opacity=1.00——在那两段区间里根本不可逆，
// 于是「改第二个字段把第一个静默改回默认值」。
// 分隔符只能用 `;`（或 `,`）：`&` 在 XML 属性值里是实体起始符，会让整段 SVG
// 解析失败、噪点层直接不显示。
const encodeParams = params => Object.entries(params)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
  .join(';')

const turbulence = (mark, { freq, opacity, color }, params) => {
  const tint = color
    ? `<feFlood flood-color='${color}' result='t'/><feComposite in='t' in2='n' operator='in'/>`
    : ''
  const meta = params ? ` data-vr='${encodeParams(params)}'` : ''
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' id='${mark}'${meta}>` +
    `<filter id='f'><feTurbulence type='fractalNoise' baseFrequency='${freq}' result='n'/>${tint}</filter>` +
    `<rect width='100%' height='100%' filter='url(%23f)' opacity='${opacity}'/></svg>`
  return `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/"/g, "'")}")`
}

export const isEffectLayer = v => /vr-noise|vr-texture/.test(String(v || ''))

// ── 序列化 ────────────────────────────────────────────────
const shadowCss = ({ x, y, blur, spread, color }, inset) =>
  `${inset ? 'inset ' : ''}${x}px ${y}px ${blur}px ${spread}px ${color}`

/**
 * 效果列表 → 各条 CSS 属性。backgroundLayers 单独返回：它要跟填充层拼在一起，
 * 由调用方决定顺序（效果层在前，画在填充上面）。
 */
export const serializeEffects = list => {
  const on = (list || []).filter(e => !e.hidden)
  const shadows = []
  const filters = []
  const backdrops = []
  const backgroundLayers = []

  for (const e of on) {
    const p = { ...DEFAULTS[e.type], ...e }
    switch (e.type) {
      case 'inner-shadow': shadows.push(shadowCss(p, true)); break
      case 'drop-shadow':  shadows.push(shadowCss(p, false)); break
      case 'layer-blur':   filters.push(`blur(${p.blur}px)`); break
      case 'background-blur': backdrops.push(`blur(${p.blur}px)`); break
      case 'noise':
        backgroundLayers.push(turbulence('vr-noise', {
          freq: (1.2 / Math.max(0.1, p.size)).toFixed(2),
          opacity: (p.density / 100).toFixed(2),
          color: p.color,
        }, { size: p.size, density: p.density, color: p.color }))
        break
      case 'texture':
        backgroundLayers.push(turbulence('vr-texture', {
          freq: (1 / Math.max(1, p.size)).toFixed(2),
          opacity: Math.min(1, p.radius / 10).toFixed(2),
          color: null,
        }, { size: p.size, radius: p.radius }))
        break
      case 'glass':
        backdrops.push(`blur(${p.blur}px)`, `saturate(${p.saturate}%)`)
        // 顶部一道内高光，玻璃的厚度感基本来自这条
        shadows.push(`inset 0 1px 0 rgba(255, 255, 255, ${(p.highlight / 100).toFixed(2)})`)
        break
    }
  }

  return {
    'box-shadow': shadows.length ? shadows.join(', ') : 'none',
    'filter': filters.length ? filters.join(' ') : 'none',
    'backdrop-filter': backdrops.length ? backdrops.join(' ') : 'none',
    backgroundLayers,
  }
}

// ── 解析 ──────────────────────────────────────────────────
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

// 浏览器把 data URI 回读出来时可能再做一次百分号编码（`;` 变 %3B、`=` 变 %3D、
// `%` 变 %25），所以解码要能连着剥几层，剥不动就停手。
const decodeAll = v => {
  let s = String(v)
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(s); i++) {
    try {
      const next = decodeURIComponent(s)
      if (next === s) break
      s = next
    } catch { break }
  }
  return s
}

const NUMERIC_PARAMS = new Set(['size', 'density', 'radius'])

// data-vr='size=0.5;density=100;color=…' → { size: 0.5, density: 100, color: '…' }
const readParams = raw => {
  const m = String(raw).match(/data-vr=(['"]|%22|%27)([\s\S]*?)\1/i)
  if (!m) return null
  const out = {}
  for (const pair of m[2].split(/;|%3B/i)) {
    const [key, ...rest] = pair.split(/=|%3D/i)
    if (!key || !rest.length) continue
    const value = decodeAll(rest.join('='))
    out[key.trim()] = NUMERIC_PARAMS.has(key.trim()) ? num(value) : value
  }
  return Object.keys(out).length ? out : null
}

const attr = (raw, name) => {
  const m = String(raw).match(new RegExp(`${name}=(['"]|%22|%27)([\\s\\S]*?)\\1`, 'i'))
  return m ? decodeAll(m[2]) : ''
}

// 没有 data-vr 的旧值（这次改动之前写下的、或用户手抄过去的）只能按
// baseFrequency / opacity / flood-color 倒推。两段夹取区间在这里推不回来：
// 纹理 size ≤ 1 一律读成 1、radius ≥ 10 一律读成 10——尽力而为，
// 至少比每次都重置成默认值强。
const legacyParams = (raw, type) => {
  const freq = parseFloat(attr(raw, 'baseFrequency'))
  const opacity = parseFloat(attr(raw, 'opacity'))
  const round2 = n => Math.round(n * 100) / 100

  if (type === 'noise') {
    const out = {}
    if (Number.isFinite(freq) && freq > 0) out.size = round2(1.2 / freq)
    if (Number.isFinite(opacity)) out.density = Math.round(opacity * 100)
    const color = attr(raw, 'flood-color')
    if (color) out.color = color
    return out
  }

  const out = {}
  if (Number.isFinite(freq) && freq > 0) out.size = round2(1 / freq)
  if (Number.isFinite(opacity)) out.radius = round2(opacity * 10)
  return out
}

// 玻璃那道 inset 高光的 alpha 就是「高光」这个字段（写进去时是 highlight / 100）
const alphaOf = color => {
  const m = String(color).match(/rgba?\(([^)]*)\)/i)
  if (!m) return null
  const a = parseFloat(m[1].split(/[,/]/)[3])
  return Number.isFinite(a) ? a : 1
}

const parseShadow = raw => {
  const inset = /(^|\s)inset(\s|$)/.test(raw)
  const body = raw.replace(/(^|\s)inset(\s|$)/, ' ').trim()
  // 颜色可能在前也可能在后，先摘掉它再读剩下的长度
  const colorMatch = body.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8}|\b[a-z]+\b(?!\s*\())/i)
  const color = colorMatch ? colorMatch[0] : 'rgba(0, 0, 0, 0.25)'
  const lens = body.replace(color, ' ').trim().split(/\s+/).filter(Boolean).map(num)
  const [x = 0, y = 0, blur = 0, spread = 0] = lens
  // 只有一条 inset、零偏移、极短模糊的，是玻璃那道高光，不当成内阴影读回来
  const isHighlight = inset && x === 0 && y === 1 && blur === 0 && spread === 0
  return { type: isHighlight ? 'glass-highlight' : (inset ? 'inner-shadow' : 'drop-shadow'), x, y, blur, spread, color }
}

// 读回的顺序按 CSS 属性分组，不是用户当初添加的顺序：七种效果分散在
// box-shadow / filter / backdrop-filter / background-image 四条属性里，
// 跨属性的先后关系在 CSS 里根本没有记录，也就还原不出来。同一条属性内部的
// 顺序是保留的（两条阴影谁在上、两个 filter 谁先算），而那正是顺序真正影响
// 渲染结果的地方——跨属性之间本来就互不干扰。
export const parseEffects = (computed = {}) => {
  const list = []

  // 玻璃那条高光由 backdrop 侧统一还原，但它的 alpha 得先在这里收起来——
  // 以前 backdrop 那边硬写 highlight: 40，改一次模糊就把用户刚调的高光冲回默认值
  let highlight = null

  const shadow = (computed['box-shadow'] || '').trim()
  if (shadow && shadow !== 'none') {
    for (const raw of splitTopLevel(shadow)) {
      const s = parseShadow(raw.trim())
      if (s.type === 'glass-highlight') {
        const a = alphaOf(s.color)
        if (a !== null) highlight = Math.round(a * 100)
        continue
      }
      list.push(s)
    }
  }

  const blur = (computed['filter'] || '').match(/blur\(([^)]+)\)/)
  if (blur) list.push({ type: 'layer-blur', blur: num(blur[1]) })

  const bd = (computed['backdrop-filter'] || '')
  const bdBlur = bd.match(/blur\(([^)]+)\)/)
  const bdSat = bd.match(/saturate\(([^)]+)\)/)
  // computed 会把 saturate(180%) 归一化成 saturate(1.8)，读回来要还原成百分数，
  // 否则面板上会显示「饱和 1.8%」——一个用户从来没输入过的数
  const pct = raw => { const n = num(raw); return String(raw).includes('%') ? n : n * 100 }
  if (bdBlur && bdSat) list.push({
    type: 'glass', blur: num(bdBlur[1]), saturate: Math.round(pct(bdSat[1])),
    highlight: highlight ?? DEFAULTS.glass.highlight,
  })
  else if (bdBlur) list.push({ type: 'background-blur', blur: num(bdBlur[1]) })

  const image = computed['background-image'] || ''
  if (image && image !== 'none') {
    for (const raw of splitTopLevel(image)) {
      // data-vr 里存着用户填的原值，优先用它；没有的旧值才去倒推
      if (/vr-noise/.test(raw))
        list.push({ type: 'noise', ...DEFAULTS.noise, ...(readParams(raw) || legacyParams(raw, 'noise')) })
      else if (/vr-texture/.test(raw))
        list.push({ type: 'texture', ...DEFAULTS.texture, ...(readParams(raw) || legacyParams(raw, 'texture')) })
    }
  }

  return list
}

// 每种效果在参数面板里有哪几格。只列 CSS 真的做得到的——
// 给一个调了没反应的滑块，比不给更糟。
export const FIELDS = {
  'inner-shadow':    [['x', 'X', 'px'], ['y', 'Y', 'px'], ['blur', '模糊', 'px'], ['spread', '扩展', 'px'], ['color', '颜色', 'color']],
  'drop-shadow':     [['x', 'X', 'px'], ['y', 'Y', 'px'], ['blur', '模糊', 'px'], ['spread', '扩展', 'px'], ['color', '颜色', 'color']],
  'layer-blur':      [['blur', '模糊', 'px']],
  'background-blur': [['blur', '模糊', 'px']],
  'noise':           [['size', '颗粒', ''], ['density', '密度', '%'], ['color', '颜色', 'color']],
  'texture':         [['size', '尺寸', ''], ['radius', '强度', '']],
  'glass':           [['blur', '模糊', 'px'], ['saturate', '饱和', '%'], ['highlight', '高光', '%']],
}
