// 独立复现脚本 · 清单 2.8.6（填充层眼睛的「再开」语义）
//
// 报告称：藏着某一填充层期间改了别的层的颜色，再点开那只眼睛会把关灯那一刻
// 存下的整段 inline 原文原样写回，中途那次改色被静默回滚。
// 期望（feature-inventory §2.8.6 + props-panel.element.js:1221-1223 的注释）：
// 「再开若『关掉之后没动过别的』就原样放回…否则按当前层列表重写」。
//
// 本脚本不复用 tests-e2e/full/typography-fill.mjs 的任何断言与工具，自己搭 fixture、
// 自己读状态。全程真实指针 / 键盘（locator.click / fill+Enter），不用 element.click()。
import { serve, launch, injectVisBug } from '../../harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
page.on('pageerror', e => console.log('  [页面异常]', e.message))

await page.goto(origin)

// 三层填充的元素：url() 图（最上）+ linear-gradient + 垫底 background-color
await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = 30; c.height = 15
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ff5c8a'; ctx.fillRect(0, 0, 30, 15)
  const png = c.toDataURL('image/png')
  const mk = id => {
    const d = document.createElement('div')
    d.id = id
    d.style.cssText = 'position:absolute;left:330px;top:730px;width:140px;height:70px;'
      + 'background-color:#123456;'
      + `background-image:url("${png}"), linear-gradient(#ff0000, #0000ff)`
    document.body.appendChild(d)
    return d
  }
  const a = mk('vx-a')
  const b = mk('vx-b'); b.style.left = '500px'
  const d = mk('vx-c'); d.style.left = '670px'
  const e = mk('vx-d'); e.style.left = '840px'
})

await injectVisBug(page, origin)
await page.waitForTimeout(400)

const FILL = 'visual-revise-panel section[data-group="fill"]'
const P = sel => page.locator(`${FILL} ${sel}`)

const select = async id => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  await page.keyboard.press('Escape'); await page.waitForTimeout(170)
  await page.locator(`#${id}`).click({ position: { x: 120, y: 60 } })
  await page.waitForTimeout(520)
}
const tap = async loc => {
  await loc.scrollIntoViewIfNeeded()
  await loc.click()
  await page.waitForTimeout(420)
}
// 面板层列表现在的样子
const rows = () => page.evaluate(() =>
  [...document.querySelector('visual-revise-panel').shadowRoot
    .querySelectorAll('section[data-group="fill"] .layers .layer-row')].map(r => {
      const f = r.querySelector('vr-fill')
      return {
        color: f?.getAttribute('color') || '',
        image: (f?.getAttribute('image') || '').slice(0, 22),
        off: r.classList.contains('off'),
      }
    }))
// 元素真实状态：inline 原文 + computed
const el = id => page.evaluate(i => {
  const e = document.getElementById(i)
  const cs = getComputedStyle(e)
  return {
    inlineColor: e.style.getPropertyValue('background-color'),
    inlineImageHead: e.style.getPropertyValue('background-image').slice(0, 30),
    hasUrl: e.style.getPropertyValue('background-image').includes('url('),
    computedColor: cs.backgroundColor,
  }
}, id)
// 面板记下来的改动（导出给 AI 的就是这一份）
const recorded = id => page.evaluate(i => {
  const st = window.__visualRevise?.store
  if (!st) return null
  const e = st.read().edits.find(x => x.el?.id === i)
  return {
    total: st.stats().total,
    changes: e ? e.changes.map(c => `${c.prop}=${String(c.value ?? c.to ?? '').slice(0, 26)}`) : [],
  }
}, id)
// 第 i 行 vr-fill 里的色值输入框（在它的 shadow root 里）
const layerText = i => P('.layers .layer-row').nth(i).locator('vr-fill').locator('.text')
const setLayerColor = async (i, hex) => {
  const t = layerText(i)
  await t.scrollIntoViewIfNeeded()
  await t.fill(hex)
  await t.press('Enter')
  await page.waitForTimeout(480)
}

console.log('\n=== 2.8.6 藏着一层期间改别的层，再开会不会回滚那次改动 · 独立复现 ===\n')

// ───────────────────────────────────────────────────────────
// A. 对照组：关掉之后什么都不动，直接再开 —— 这条路该原样放回
// ───────────────────────────────────────────────────────────
console.log('--- A. 对照：关掉 → 立刻再开（中途没动过别的）---')
await select('vx-a')
console.log('[初始] 行 =', JSON.stringify(await rows()))
console.log('[初始] 元素 =', JSON.stringify(await el('vx-a')))
await tap(P('[data-layer-eye="0"]'))
console.log('[关掉第 0 层] 元素 =', JSON.stringify(await el('vx-a')))
await tap(P('[data-layer-eye="0"]'))
const aBack = await el('vx-a')
const aRows = await rows()
console.log('[再开] 行 =', JSON.stringify(aRows))
console.log('[再开] 元素 =', JSON.stringify(aBack))
const aOk = aRows.length === 3 && aBack.hasUrl && aBack.computedColor === 'rgb(18, 52, 86)'
console.log(`==> A 对照组正常（图回来了、底色没动）? ${aOk}`)

// ───────────────────────────────────────────────────────────
// B. 复现：关掉第 0 层 → 改第 2 层（垫底纯色）→ 再开第 0 层
// ───────────────────────────────────────────────────────────
console.log('\n--- B. 复现：关掉第 0 层 → 把垫底纯色改成 #00ff00 → 再开第 0 层 ---')
await select('vx-b')
await tap(P('[data-layer-eye="0"]'))
const bHidden = await el('vx-b')
console.log('[关掉第 0 层] 元素 =', JSON.stringify(bHidden))
console.log('[关掉第 0 层] 行 =', JSON.stringify(await rows()))

await setLayerColor(2, '#00ff00')
const bEdited = await el('vx-b')
const bEditedRec = await recorded('vx-b')
console.log('[改完底色] 元素 =', JSON.stringify(bEdited))
console.log('[改完底色] 行 =', JSON.stringify(await rows()))
console.log('[改完底色] 记录 =', JSON.stringify(bEditedRec))
const bEditLanded = bEdited.computedColor === 'rgb(0, 255, 0)'
console.log(`    改色确实落地了? ${bEditLanded}`)

await tap(P('[data-layer-eye="0"]'))
const bBack = await el('vx-b')
const bRows = await rows()
const bBackRec = await recorded('vx-b')
console.log('[再开第 0 层] 元素 =', JSON.stringify(bBack))
console.log('[再开第 0 层] 行 =', JSON.stringify(bRows))
console.log('[再开第 0 层] 记录 =', JSON.stringify(bBackRec))

// 再多等一会儿并重新选一次，排除「只是这一帧还没重绘」
await page.waitForTimeout(900)
await select('vx-a'); await select('vx-b')
const bSettled = await el('vx-b')
console.log('[等 0.9s + 换选中再选回] 元素 =', JSON.stringify(bSettled))
console.log('[等 0.9s + 换选中再选回] 行 =', JSON.stringify(await rows()))

const bReverted = bEditLanded
  && bSettled.computedColor === 'rgb(18, 52, 86)'
  && bBack.hasUrl
console.log(`==> B 复现（被藏的层回来了，但那次改色被回滚成 rgb(18, 52, 86)）? ${bReverted}`)

// ───────────────────────────────────────────────────────────
// C. 判定依据是下标而不是「动过没动过」：先关 0，改底色，再关 1，
//    这时 #layerRestore.index 被改写成 1，开 0 就走 else 分支
// ───────────────────────────────────────────────────────────
console.log('\n--- C. 中间插一次「关掉另一层」，把 #layerRestore.index 顶掉，再开第 0 层 ---')
await select('vx-c')
await tap(P('[data-layer-eye="0"]'))
await setLayerColor(2, '#00ff00')
const cEdited = await el('vx-c')
console.log('[关 0 + 改底色] 元素 =', JSON.stringify(cEdited))
await tap(P('[data-layer-eye="1"]'))   // 关掉渐变层 → #layerRestore 变成 {index:1}
console.log('[再关第 1 层] 元素 =', JSON.stringify(await el('vx-c')))
await tap(P('[data-layer-eye="0"]'))   // 开第 0 层：saved.index(1) !== 0 → else 分支
const cBack = await el('vx-c')
console.log('[开第 0 层] 元素 =', JSON.stringify(cBack))
console.log('[开第 0 层] 行 =', JSON.stringify(await rows()))
const cKept = cEdited.computedColor === 'rgb(0, 255, 0)' && cBack.computedColor === 'rgb(0, 255, 0)'
console.log(`==> C：换个下标走 else 分支时改色就保住了? ${cKept}`
  + '（说明守卫看的是下标，不是「有没有动过别的」）')

// ───────────────────────────────────────────────────────────
// D. 同一条路的另一种损失：藏着第 0 层期间「减掉」垫底纯色那一层，
//    再开第 0 层看那次删除还在不在
// ───────────────────────────────────────────────────────────
console.log('\n--- D. 关掉第 0 层 → 减掉第 2 层 → 再开第 0 层 ---')
await select('vx-d')
await tap(P('[data-layer-eye="0"]'))
await tap(P('[data-layer-del="2"]'))
const dDeleted = await el('vx-d')
const dRowsAfterDel = await rows()
console.log('[减掉第 2 层] 元素 =', JSON.stringify(dDeleted))
console.log('[减掉第 2 层] 行 =', JSON.stringify(dRowsAfterDel))
await tap(P('[data-layer-eye="0"]'))
const dBack = await el('vx-d')
const dRows = await rows()
console.log('[再开第 0 层] 元素 =', JSON.stringify(dBack))
console.log('[再开第 0 层] 行 =', JSON.stringify(dRows))
const dReverted = dDeleted.computedColor === 'rgba(0, 0, 0, 0)'
  && dBack.computedColor === 'rgb(18, 52, 86)' && dRows.length === 3
console.log(`==> D 复现（删掉的那一层被静默还原回来）? ${dReverted}`)

console.log('\n================ 结论 ================')
console.log('A 对照组（没动过别的，原样放回）正常     :', aOk)
console.log('B 改过别的层之后再开，那次改色被回滚     :', bReverted)
console.log('C 同样情形、只是 index 被顶掉，改色保住  :', cKept)
console.log('D 藏着一层时删掉的层，再开被静默还原     :', dReverted)
console.log('=====================================\n')

await browser.close(); await close()
