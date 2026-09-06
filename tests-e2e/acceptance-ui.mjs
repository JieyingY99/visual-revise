// PRD 验收：面板的 UI 一致性。
//
// 前几批验收都在问「功能对不对」，这一批只问「长得对不对」——间距是否统一、
// 同一行的控件是否等高、图标是否被拉扁、有没有元素被挤出面板。这些问题单看
// 断言永远发现不了：功能全绿，界面照样可以是歪的（本批就是这么抓到眼睛和
// 减号被挤出右边界的）。
import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

let passed = 0, failed = 0
const AC = (id, cond, msg) => { cond ? passed++ : failed++; ok(cond, `${id}  ${msg}`) }

console.log('\n[PRD 验收] 批次 5：面板 UI 一致性\n')
await page.goto(origin); await injectVisBug(page, origin)
await page.waitForTimeout(400)

const P = sel => page.locator(`visual-revise-panel ${sel}`)

// 一个能让所有分区都显示出来的元素
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'ui-probe'
  d.style.cssText = 'position:absolute;left:20px;top:420px;width:320px;height:140px;display:flex;gap:8px;'
    + 'padding:12px;background:#456;border:2px solid #789;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);'
    + 'font-size:14px;color:#fff;opacity:.95'
  d.textContent = '一段文字'
  document.body.appendChild(d)
})
await page.locator('#ui-probe').click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(500)

// 把所有分区展开，否则半数控件量不到
const unfoldAll = async () => {
  const folded = await page.evaluate(() => [...document.querySelector('visual-revise-panel').shadowRoot
    .querySelectorAll('section[folded]')].map(s => s.dataset.group))
  for (const g of folded) {
    await P(`section[data-group="${g}"] h3 .title`).click()
    await page.waitForTimeout(200)
  }
}
await unfoldAll()

// ── 采集器 ───────────────────────────────────────────────
// 只看真正可见、真正占位的元素：display:none 的量出来是 0，比不出所以然
const probe = () => page.evaluate(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const host = document.querySelector('visual-revise-panel').getBoundingClientRect()
  const vis = el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const name = el => el.className && typeof el.className === 'string'
    ? `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}`
    : el.tagName.toLowerCase()

  // ① 图标：svg 的宽高 1:1、viewBox 正方形，而且图形本身要落在 viewBox 中央。
  //    最后一条是前两条盖不住的盲区——宽高比和 viewBox 都对，路径却可以画偏，
  //    在 24px 的按钮里就是肉眼可见的歪。用 getBBox 量真实墨迹范围。
  const icons = []
  for (const svg of sr.querySelectorAll('svg')) {
    if (!vis(svg)) continue
    const r = svg.getBoundingClientRect()
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)

    // 用 svg 根节点的 getBBox：它给的是所有子元素在 viewBox 坐标系下的联合边界，
    // 子元素自己的 transform 已经算进去了。逐个子元素取 getBBox 再合并是错的——
    // 那返回的是各自局部坐标系的边界，外层 <g transform> 的平移根本看不见。
    let off = null
    if (vb.length === 4) {
      let b; try { b = svg.getBBox() } catch { b = null }
      if (b && (b.width || b.height)) off = {
        dx: +((b.x + b.width / 2) - (vb[0] + vb[2] / 2)).toFixed(2),
        dy: +((b.y + b.height / 2) - (vb[1] + vb[3] / 2)).toFixed(2),
      }
    }

    // 上下文：同一行 / 同一分段 / 同一 acts 组里的图标该同尺寸
    const ctxEl = svg.closest('.segment, .acts, .layer-row, .flow-row, .dims, .side-pair, .with-action, .typo-align, .control, header, .tabs, .effect-row')
    const ctx = ctxEl ? (ctxEl.className || ctxEl.tagName).toString().split(' ')[0] : 'other'
    let b2; try { b2 = svg.getBBox() } catch { b2 = null }
    const ink = b2 && vb.length === 4 && vb[2] ? +(Math.max(b2.width, b2.height) / vb[2]).toFixed(2) : null

    icons.push({
      owner: name(svg.parentElement || svg),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      vbSquare: vb.length === 4 ? vb[2] === vb[3] : true,
      off, ctx, ink,
    })
  }

  // ② 同一行里所有并排的东西都该等高，图标按钮也算——按钮矮一截就是没对齐。
  //    只看并排的兄弟：输入框内部的前缀图标和模式按钮是框内装饰，
  //    它们本来就该在框里居中，不参与这条。
  const rows = []
  for (const row of sr.querySelectorAll('.layer-row, .pair, .typo-pair, .dims, .side-pair, .limits, .with-action, .flow-row, .typo-align')) {
    if (!vis(row)) continue
    const kids = [...row.children].filter(vis)
    if (kids.length < 2) continue
    const boxes = kids.map(k => ({ el: name(k), r: k.getBoundingClientRect(), icon: k.classList.contains('icon-btn') }))
    const fields = boxes
    const hs = fields.map(b => +b.r.height.toFixed(1))
    const mids = boxes.map(b => +(b.r.top + b.r.height / 2).toFixed(1))
    // 并排的图标按钮还得是正方形：只拉高不拉宽就是个 24×32 的长方形
    const oblong = boxes.filter(b => b.icon && Math.abs(b.r.width - b.r.height) > 0.5).map(b => `${b.el} ${b.r.width}×${b.r.height}`)
    rows.push({
      row: name(row),
      heights: hs,
      same: new Set(hs).size <= 1,
      centered: Math.max(...mids) - Math.min(...mids) <= 1,
      mids,
      oblong,
    })
  }

  // ③ gap：同类容器的间距应该收敛，不该每处一个值
  const gaps = {}
  for (const el of sr.querySelectorAll('.layers, .layer-row, .pair, .rows, .acts, .tabs')) {
    if (!vis(el)) continue
    const g = getComputedStyle(el).gap
    if (!g || g === 'normal') continue
    const k = name(el)
    ;(gaps[k] ||= new Set()).add(g)
  }

  // ④ 溢出：面板里的元素不该越过面板自己的左右边界
  const overflow = []
  for (const el of sr.querySelectorAll('*')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right > host.right + 0.5 || r.left < host.left - 0.5)
      overflow.push({ el: name(el), left: +r.left.toFixed(1), right: +r.right.toFixed(1) })
  }

  // ②b 跨行一致：同一个列表里每行该一样高，颜色类控件（vr-color / vr-fill）
  //     在面板任何地方都该是同一个高度——它们在界面上就是同一种东西
  const listRows = []
  for (const list of sr.querySelectorAll('.layers')) {
    if (!vis(list)) continue
    const hs = [...list.querySelectorAll('.layer-row')].filter(vis)
      .map(r => +r.getBoundingClientRect().height.toFixed(1))
    if (hs.length > 1) listRows.push({ hs, same: new Set(hs).size === 1 })
  }
  const colorHosts = [...sr.querySelectorAll('vr-color, vr-fill')].filter(vis)
    .map(c => ({ el: c.tagName.toLowerCase(), h: +c.getBoundingClientRect().height.toFixed(1) }))

  // 面板左右内边距要对称。原生滚动条占位会把右边挤窄，headless 用 overlay
  // 滚动条量不出来，所以这里连滚动条宽度一起算：offsetWidth − clientWidth
  const hostBox = document.querySelector('visual-revise-panel').getBoundingClientRect()
  // 取第一个真正可见的 .rows：折叠的分区和空的层列表都是 display:none，rect 全 0
  const firstRows = [...sr.querySelectorAll('section .rows')].map(r => r.getBoundingClientRect()).find(r => r.width > 0)
  const scrollEl = sr.querySelector('.scroll')
  const padding = firstRows ? {
    left: +(firstRows.left - hostBox.left).toFixed(1),
    right: +(hostBox.right - firstRows.right).toFixed(1),
    scrollbar: scrollEl ? scrollEl.offsetWidth - scrollEl.clientWidth : 0,
  } : null

  // 并排行的间距与右缘：行内 gap 该只有一个值；最右的控件要贴到行容器右边缘，
  // 差一点就是跟上下行对不齐（grid 第三列写死 24px 时按钮会探出 6~8px）
  const rowGaps = []
  for (const row of sr.querySelectorAll('.layer-row, .pair, .typo-pair, .dims, .side-pair, .limits, .with-action, .flow-row, .typo-align')) {
    if (!vis(row)) continue
    const kids = [...row.children].filter(vis)
    if (kids.length < 2) continue
    const rr = row.getBoundingClientRect(), bs = kids.map(k => k.getBoundingClientRect())
    rowGaps.push({
      row: name(row),
      gaps: bs.slice(1).map((b, i) => +(b.left - bs[i].right).toFixed(1)),
      rightGap: +(rr.right - bs[bs.length - 1].right).toFixed(1),
      spill: bs.some(b => b.right > rr.right + 0.5 || b.left < rr.left - 0.5),
    })
  }

  return {
    icons, rows, overflow, listRows, colorHosts, padding, rowGaps,
    gaps: Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, [...v]])),
    host: { left: +host.left.toFixed(1), right: +host.right.toFixed(1), width: +host.width.toFixed(1) },
  }
})


// ── 对比度 ────────────────────────────────────────────────
// WCAG 的相对亮度比。阈值分两档：正文 4.5:1，图标和大字 3:1（AA 对
// 「非文本内容」的要求）。半透明的前景要先合成到背景上再算，否则一个
// opacity:.3 的灰按钮会被算成跟不透明时一样清晰。
const CONTRAST_JS = `(() => {
  const sr = document.querySelector('visual-revise-panel').shadowRoot
  const nums = s => (String(s).match(/[\\d.]+/g) || []).map(Number)
  const lum = ([r, g, b]) => {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const over = (fg, bg) => { const a = fg[3] === undefined ? 1 : fg[3]; return [0,1,2].map(i => fg[i] * a + bg[i] * (1 - a)) }
  // 往上找第一个不透明的背景，中途的半透明层依次合成
  const bgOf = el => {
    let n = el, stack = []
    while (n && n !== document) {
      const c = nums(getComputedStyle(n).backgroundColor)
      if (c.length >= 3 && (c[3] === undefined ? 1 : c[3]) > 0) {
        stack.push(c)
        if ((c[3] === undefined ? 1 : c[3]) >= 1) break
      }
      n = n.parentElement || (n.getRootNode() && n.getRootNode().host) || null
    }
    let acc = [255, 255, 255]
    for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc)
    return acc
  }
  const ratio = (a, b) => { const l = [lum(a), lum(b)].sort((x, y) => y - x); return (l[0] + 0.05) / (l[1] + 0.05) }
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }

  const out = []
  const seen = new Set()
  for (const el of sr.querySelectorAll('.icon-btn, .tab, .effect-open, label.name, .title, .layer-row, .segment button, .chev')) {
    if (!vis(el) || seen.has(el)) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    const op = parseFloat(cs.opacity)
    const hasIconEl = !!el.querySelector('svg')
    const textEl = (el.textContent || '').trim()

    // 空元素（既没文字也没 svg）是「用背景画出来的图形」——折叠箭头就是
    // background: currentColor 加 clip-path 切出来的。对它们，前景是自己的
    // 背景色，底色要往父级找；拿 color 当前景会算出 1:1，因为那正是它的背景。
    const painted = !hasIconEl && !textEl
    const op2 = painted ? op : 1
    let fg = nums(painted ? cs.backgroundColor : cs.color)
    if (fg.length < 3) continue
    const bg = bgOf(painted ? (el.parentElement || el) : el)
    const alpha = (fg[3] === undefined ? 1 : fg[3]) * op
    if (alpha < 1) fg = over([fg[0], fg[1], fg[2], alpha], bg)

    const hasIcon = hasIconEl || painted
    const text = textEl
    const size = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight, 10) >= 700
    // 图标按 3:1（非文本内容）；大字（>=18px，或 >=14px 且加粗）也按 3:1
    const need = hasIcon && !text ? 3 : (size >= 18 || (size >= 14 && bold)) ? 3 : 4.5
    out.push({
      el: el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase(),
      kind: hasIcon && !text ? 'icon' : 'text',
      on: el.hasAttribute('data-on'), disabled: !!el.disabled,
      ratio: Math.round(ratio(fg, bg) * 100) / 100,
      need,
    })
  }
  return out
})()`

const contrast = () => page.evaluate(CONTRAST_JS)

// 面板本身也得完整落在视口内
const inViewport = () => page.evaluate(() => {
  const boxes = ['visual-revise-panel', 'visual-revise-toolbar']
    .map(s => ({ s, r: document.querySelector(s)?.getBoundingClientRect() }))
    .filter(b => b.r && b.r.width)
  return boxes.map(({ s, r }) => ({
    el: s,
    ok: r.left >= -0.5 && r.top >= -0.5
      && r.right <= document.documentElement.clientWidth + 0.5
      && r.bottom <= document.documentElement.clientHeight + 0.5,
    box: [+r.left.toFixed(1), +r.top.toFixed(1), +r.right.toFixed(1), +r.bottom.toFixed(1)],
  }))
})

// ── 逐场景检查 ────────────────────────────────────────────
const scenes = []
const check = async label => {
  const p = await probe()
  const v = await inViewport()
  const c = await contrast()
  scenes.push({ label, ...p, viewport: v, contrast: c })
}

await check('属性 tab · 全部展开')

// 加两层填充 + 四种效果，把列表撑起来
await P('section[data-group="fill"] .add').click(); await page.waitForTimeout(350)
for (const l of ['投影', '图层模糊', '噪点', '玻璃']) {
  await P('.add[data-add="effects"]').click(); await page.waitForTimeout(250)
  await page.locator('#visual-revise-menu > div').filter({ hasText: l }).first().click()
  await page.waitForTimeout(300)
}
await check('填充两层 + 效果四条')

await P('.tab[data-tab="structure"]').click(); await page.waitForTimeout(400)
await check('结构 tab')
await P('.tab[data-tab="props"]').click(); await page.waitForTimeout(400)

// 窄视口：最容易把东西挤出去
await page.setViewportSize({ width: 900, height: 640 }); await page.waitForTimeout(500)
await check('窄视口 900×640')
await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(500)

// ── 断言 ─────────────────────────────────────────────────
const badIcons = scenes.flatMap(s => s.icons.filter(i => i.w !== i.h || !i.vbSquare).map(i => `${s.label}/${i.owner} ${i.w}×${i.h}`))
AC('AC-9.1', badIcons.length === 0,
   `所有图标都是 1:1（共 ${scenes[0].icons.length} 个）${badIcons.length ? '，被拉扁的：' + badIcons.slice(0, 6).join('; ') : ''}`)

// 墨迹偏移超过 0.6（viewBox 单位，通常是 16）就已经看得出来了
const skewed = [...new Set(scenes.flatMap(s => s.icons
  .filter(i => i.off && (Math.abs(i.off.dx) > 0.6 || Math.abs(i.off.dy) > 0.6))
  .map(i => `${i.owner} 偏 ${i.off.dx},${i.off.dy}`)))]
AC('AC-9.1b', skewed.length === 0,
   `图形都落在 viewBox 中央${skewed.length ? '，画偏的：' + skewed.slice(0, 8).join('; ') : ''}`)

// 同一上下文里渲染尺寸一致：换行钮 13 挤在四个 14 的 flow 分段旁边就是小一号
const sizeByCtx = {}
for (const s of scenes) for (const i of s.icons) (sizeByCtx[i.ctx] ||= new Set()).add(i.w)
const mixed = Object.entries(sizeByCtx).filter(([, v]) => v.size > 1).map(([k, v]) => `${k}: ${[...v].join('/')}`)
AC('AC-9.1c', mixed.length === 0,
   `同一上下文里图标渲染尺寸一致${mixed.length ? '，混用的：' + mixed.join('; ') : `（${Object.entries(sizeByCtx).map(([k, v]) => `${k}=${[...v][0]}`).join(' ')}）`}`)

// 墨迹占 viewBox 62–78%：太小的跟旁边的比矮一头，太大的顶到边框
const inkOut = [...new Set(scenes.flatMap(s => s.icons.filter(i => i.ink !== null && (i.ink < 0.6 || i.ink > 0.8)).map(i => `${i.owner} ${Math.round(i.ink * 100)}%`)))]
AC('AC-9.1d', inkOut.length === 0,
   `图标墨迹占 viewBox 的 60–80%${inkOut.length ? '，出圈的：' + inkOut.slice(0, 8).join('; ') : ''}`)

const badRows = scenes.flatMap(s => s.rows.filter(r => !r.same).map(r => `${s.label}/${r.row} ${r.heights.join('·')}`))
AC('AC-9.2', badRows.length === 0,
   `同一行的所有控件等高（含图标按钮）${badRows.length ? '，不齐的：' + badRows.slice(0, 6).join('; ') : `（共 ${scenes.reduce((n, s) => n + s.rows.length, 0)} 行）`}`)

const oblongs = [...new Set(scenes.flatMap(s => s.rows.flatMap(r => r.oblong.map(o => `${r.row}/${o}`))))]
AC('AC-9.2e', oblongs.length === 0,
   `并排的图标按钮都是正方形${oblongs.length ? '，长方形的：' + oblongs.slice(0, 6).join('; ') : ''}`)

const gapSet = [...new Set(scenes.flatMap(s => s.rowGaps.flatMap(r => r.gaps)))]
AC('AC-9.10', gapSet.length === 1,
   `并排行内的间距只有一个值${gapSet.length === 1 ? `（${gapSet[0]}px）` : `，出现了 ${gapSet.join('/')}px`}`)
const ragged = [...new Set(scenes.flatMap(s => s.rowGaps.filter(r => r.spill || r.rightGap !== 0).map(r => `${r.row} 右缘差 ${r.rightGap}${r.spill ? ' 溢出' : ''}`)))]
AC('AC-9.11', ragged.length === 0,
   `每行最右的控件都贴到行容器右边缘、不溢出${ragged.length ? '：' + ragged.slice(0, 6).join('; ') : ''}`)

const pads = scenes.map(s => s.padding).filter(Boolean)
const asym = pads.filter(p => Math.abs(p.left - p.right) > 0.5 || p.scrollbar > 0)
AC('AC-9.9', asym.length === 0,
   `面板左右内边距对称、滚动条不占位${asym.length ? `（左 ${asym[0].left} / 右 ${asym[0].right} / 滚动条 ${asym[0].scrollbar}px）` : `（${pads[0]?.left} / ${pads[0]?.right}）`}`)

const offCenter = scenes.flatMap(s => s.rows.filter(r => !r.centered).map(r => `${s.label}/${r.row} 中心线 ${r.mids.join('·')}`))
AC('AC-9.2b', offCenter.length === 0,
   `同一行的控件垂直居中对齐${offCenter.length ? '，没对齐的：' + offCenter.slice(0, 6).join('; ') : ''}`)

const badList = scenes.flatMap(s => s.listRows.filter(r => !r.same).map(r => `${s.label} ${r.hs.join('·')}`))
AC('AC-9.2c', badList.length === 0,
   `同一个层列表里每行等高${badList.length ? '，不齐的：' + badList.join('; ') : ''}`)

const hostHeights = [...new Set(scenes.flatMap(s => s.colorHosts.map(c => c.h)))]
AC('AC-9.2d', hostHeights.length === 1,
   `颜色类控件在面板各处同高${hostHeights.length > 1
     ? `，出现了 ${hostHeights.join(' / ')}：` + scenes[0].colorHosts.map(c => `${c.el}=${c.h}`).join(' ')
     : `（${hostHeights[0]}px）`}`)

const gapKinds = {}
for (const s of scenes) for (const [k, v] of Object.entries(s.gaps)) (gapKinds[k] ||= new Set()).add(...v)
const inconsistent = Object.entries(gapKinds).filter(([, v]) => v.size > 1)
AC('AC-9.3', inconsistent.length === 0,
   `同类容器的间距只有一个值${inconsistent.length ? '，不一致：' + inconsistent.map(([k, v]) => `${k}=${[...v].join('/')}`).join('; ') : `（${Object.entries(gapKinds).map(([k, v]) => `${k}:${[...v][0]}`).join(' ')}）`}`)

const overflowed = scenes.flatMap(s => s.overflow.map(o => `${s.label}/${o.el} ${o.left}–${o.right} 越过 ${s.host.left}–${s.host.right}`))
AC('AC-9.4', overflowed.length === 0,
   `没有元素被挤出面板边界${overflowed.length ? '：' + overflowed.slice(0, 6).join('; ') : ''}`)

const outside = scenes.flatMap(s => s.viewport.filter(v => !v.ok).map(v => `${s.label}/${v.el} ${v.box.join(',')}`))
AC('AC-9.5', outside.length === 0,
   `面板与工具条在每个阶段都完整落在视口内${outside.length ? '：' + outside.join('; ') : `（含窄视口 900×640）`}`)

// ── 对比度 ───────────────────────────────────────────────
// 「禁用」是故意压暗的，本来就该看着不可点，不参与判定
const lowContrast = scenes.flatMap(s => s.contrast
  .filter(c => !c.disabled && c.ratio < c.need)
  .map(c => `${s.label}/${c.el}[${c.kind}${c.on ? ',选中' : ''}] ${c.ratio}:1 < ${c.need}:1`))
const uniq = [...new Set(lowContrast)]
AC('AC-9.6', uniq.length === 0,
   `默认与选中态的文字和图标都达到 WCAG AA${uniq.length ? '，不达标的：' + uniq.slice(0, 8).join('; ') : `（共查 ${scenes.reduce((n, s) => n + s.contrast.length, 0)} 处）`}`)

// hover 态单独走一遍真实悬停：hover 的颜色写在 CSS 伪类里，读不出来，只能真的悬上去
const hoverTargets = ['section[data-group="fill"] .add', '.tab[data-tab="structure"]',
  'section[data-group="effects"] .effect-open', 'h3 .title']
const hoverBad = []
for (const sel of hoverTargets) {
  const loc = P(sel).first()
  if (!(await loc.count())) continue
  await loc.hover(); await page.waitForTimeout(150)
  const got = (await contrast()).filter(c => !c.disabled && c.ratio < c.need)
  for (const c of got) hoverBad.push(`hover ${sel} → ${c.el} ${c.ratio}:1 < ${c.need}:1`)
}
AC('AC-9.7', hoverBad.length === 0,
   `悬停态同样达标${hoverBad.length ? '：' + [...new Set(hoverBad)].slice(0, 6).join('; ') : `（悬停了 ${hoverTargets.length} 类控件）`}`)

// ── 效果参数面板 ───────────────────────────────────────────
// 七种效果各有各的参数，面板是逐行拼出来的——最容易在这里出现「颜色行比别的
// 行宽一截」「不透明度框被挤出去」这类问题：功能全对，但右边缘参差不齐。
console.log('── 效果参数面板')
const KINDS = ['内阴影', '投影', '图层模糊', '背景模糊', '噪点', '纹理', '玻璃']

// 先清空已有的效果，逐种单独加、单独看
let n = await P('section[data-group="effects"] .effect-row').count()
for (let i = n; i > 0; i--) {
  await P('section[data-group="effects"] [data-effect-del="0"]').click()
  await page.waitForTimeout(250)
}

const panelIssues = []
for (const kind of KINDS) {
  await P('.add[data-add="effects"]').click(); await page.waitForTimeout(250)
  await page.locator('#visual-revise-menu > div').filter({ hasText: kind }).first().click()
  await page.waitForTimeout(350)

  const opener = P('section[data-group="effects"] [data-effect-open="0"]')
  await opener.scrollIntoViewIfNeeded(); await page.waitForTimeout(150)
  await opener.click(); await page.waitForTimeout(400)

  const got = await page.evaluate(() => {
    const hosts = [...document.querySelectorAll('[data-visual-revise-ui]')].filter(n => n.querySelector?.('[data-fx]'))
    const host = hosts[hosts.length - 1]
    if (!host) return { missing: true }
    const box = host.getBoundingClientRect()
    const bad = []

    // ① 弹层内没有元素越界
    for (const el of host.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5)
        bad.push(`越界 ${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${r.left.toFixed(0)}–${r.right.toFixed(0)} vs ${box.left.toFixed(0)}–${box.right.toFixed(0)}`)
    }

    // ② 各行的输入区左右边缘要对齐成一列
    const inputs = [...host.querySelectorAll('[data-fx]')].map(i => i.getBoundingClientRect())
    if (inputs.length > 1) {
      const lefts = new Set(inputs.map(r => Math.round(r.left)))
      const rights = new Set(inputs.map(r => Math.round(r.right)))
      if (lefts.size > 1) bad.push(`左边缘不齐 ${[...lefts].join('/')}`)
      if (rights.size > 1) bad.push(`右边缘不齐 ${[...rights].join('/')}`)
    }

    // ③ 输入框里的值不能被框宽截断。#000000 被截成 #00 时功能完全正常，
    //    所有值都写对了，只是看不全——这类问题只有量 scrollWidth 才发现得了
    for (const el of host.querySelectorAll('input')) {
      if (el.scrollWidth > el.clientWidth + 1)
        bad.push(`文本被截断 ${el.dataset.fx || el.className} 内容 ${el.scrollWidth} > 框宽 ${el.clientWidth}`)
    }
    // vr-color 内部的色值框同理
    for (const c of host.querySelectorAll('vr-color')) {
      const t = c.shadowRoot?.querySelector('.text')
      if (t && t.scrollWidth > t.clientWidth + 1)
        bad.push(`色值被截断 ${t.value} 内容 ${t.scrollWidth} > 框宽 ${t.clientWidth}`)
    }

    // ④ 弹层自身也要在视口内
    if (box.left < -0.5 || box.top < -0.5
      || box.right > document.documentElement.clientWidth + 0.5
      || box.bottom > document.documentElement.clientHeight + 0.5)
      bad.push(`弹层越出视口 ${[box.left, box.top, box.right, box.bottom].map(v => v.toFixed(0)).join(',')}`)

    return { bad, fields: host.querySelectorAll('[data-fx]').length }
  })

  if (got.missing) panelIssues.push(`${kind}：参数面板没弹出`)
  else for (const b of got.bad) panelIssues.push(`${kind}：${b}`)

  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await P('section[data-group="effects"] [data-effect-del="0"]').click(); await page.waitForTimeout(300)
}

AC('AC-9.8', panelIssues.length === 0,
   `七种效果的参数面板都对齐、不溢出、值不截断${panelIssues.length ? '：' + panelIssues.slice(0, 8).join('; ') : `（${KINDS.join('/')}）`}`)

await browser.close(); await close()
console.log(`\n合计：${passed} 通过 / ${failed} 失败\n`)
process.exitCode = failed ? 1 : 0
