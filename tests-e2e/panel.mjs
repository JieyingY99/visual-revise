import { serve, launch, injectVisBug, ok } from './harness.mjs'

const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })

console.log('\n[面板集成测试]\n')
await page.goto(origin)
await injectVisBug(page, origin)

ok(await page.locator('visual-revise-panel').count() === 1, '属性面板已挂载')
ok(await page.evaluate(() => !!window.__visualRevise), '集成 API 已暴露')

// 打开后的第一屏只有工具条，属性面板要等选中元素才出现
ok(await page.locator('visual-revise-toolbar').count() === 1, '工具条已挂载')
ok(await page.locator('visual-revise-panel').evaluate(el => el.hidden),
   '未选中元素时属性面板不出现（工具条才是入口）')

// 选中元素
const card = page.locator('.curve-card').nth(1)
await card.click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(400)

const tag = await page.locator('visual-revise-panel .tag').textContent()
ok(tag.includes('article.curve-card'), `面板显示选中元素：${tag}`)

ok(!(await page.locator('visual-revise-panel').evaluate(el => el.hidden)),
   '选中元素后属性面板出现')
const groups = await page.locator('visual-revise-panel section').count()
ok(groups >= 5, `渲染了 ${groups} 个属性分组`)

// 面板不能被自己选中
await page.locator('visual-revise-panel header .tag').click({ force: true })
await page.waitForTimeout(200)
const tagAfter = await page.locator('visual-revise-panel .tag').textContent()
ok(tagAfter.includes('article.curve-card'), '点击面板自身不会改变选中（isOffBounds 生效）')

// 改属性
const radiusInput = page.locator('visual-revise-panel input[data-prop="border-radius"]')
await radiusInput.fill('12px')
await radiusInput.press('Enter')
await page.waitForTimeout(300)

const applied = await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].style.borderRadius)
ok(applied === '12px', `面板输入写入页面：border-radius = ${applied}`)

// 数值上下键微调
// 间距默认收成「水平 / 垂直」两项，四边独立字段要先展开才存在
const expandPadding = async () => {
  const btn = page.locator('visual-revise-panel .expand-sides[data-kind="padding"]')
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(300) }
}
await expandPadding()

const padTop = page.locator('visual-revise-panel input[data-prop="padding-top"]')
await padTop.focus()
await padTop.press('ArrowUp')
await page.waitForTimeout(200)
const padded = await page.evaluate(() =>
  document.querySelectorAll('.curve-card')[1].style.paddingTop)
ok(padded === '16px', `上下键微调生效：padding-top = ${padded}（15px → 16px）`)

// 改动记录
const stats = await page.evaluate(() => window.__visualRevise.store.stats())
ok(stats.props === 2, `改动记录 = ${stats.props} 项属性`)

// dirty 标记
const dirtyCount = await page.locator('visual-revise-panel label.name[data-dirty]').count()
ok(dirtyCount >= 2, `改动过的属性有高亮标记（${dirtyCount} 个）`)

// Tab 切换交互态（先让焦点离开面板——面板内的 Tab 用于切换输入焦点）
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
const inInteractive = await page.evaluate(() => ({
  mode:        window.__visualRevise.interactive,
  panelHidden: document.querySelector('visual-revise-panel').hidden,
  visbugHidden: document.querySelector('vis-bug').style.display,
  handles:     Array.from(document.querySelectorAll('visbug-handles')).every(el => el.style.display === 'none'),
}))
ok(inInteractive.mode === true, 'Tab 进入交互态')
ok(inInteractive.panelHidden === true, '交互态下面板隐藏')
ok(inInteractive.handles, '交互态下选中框隐藏（不遮挡页面）')

// 交互态下页面原生事件应可用
const clickable = await page.evaluate(() => {
  let fired = false
  const btn = document.querySelector('.btn-primary')
  btn.addEventListener('click', () => { fired = true }, { once: true })
  btn.click()
  return fired
})
ok(clickable, '交互态下页面原生 click 可正常触发')

// Tab 切回
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
const back = await page.evaluate(() => ({
  mode:      window.__visualRevise.interactive,
  selected:  document.querySelectorAll('[data-selected]').length,
  radius:    document.querySelectorAll('.curve-card')[1].style.borderRadius,
}))
ok(back.mode === false, 'Tab 退出交互态')
ok(back.radius === '12px', '切换过程中改动完整保留')

// 复制提示词（全局动作现在归工具条）
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
await page.locator('visual-revise-toolbar .copy').click()
await page.waitForTimeout(500)
const clip = await page.evaluate(() => navigator.clipboard.readText())
ok(clip.includes('# 页面视觉修改需求'), '复制提示词到剪贴板')
ok(clip.includes('border-radius'), '提示词含改动属性')
ok(clip.includes('Thinking Five'), '提示词含文本锚点')

// ── 回归：无单位属性不得被补上 px ──
const nudge = async (prop, key = 'ArrowDown') => {
  const input = page.locator(`visual-revise-panel input[data-prop="${prop}"]`)
  if (!(await input.count())) return { skipped: true }
  // 字段可能落在折叠的分区里（Typography 对非文字元素默认折叠）。
  // 折叠只隐藏 .rows，input 仍在 DOM 中但无法聚焦，按键会静默落空。
  await input.evaluate(el => el.closest('section')?.removeAttribute('folded'))
  await input.focus()
  await input.press(key)
  await page.waitForTimeout(200)
  return {
    field: await input.inputValue(),
    applied: await page.evaluate(p => {
      const el = window.__visualRevise.panel.target
      return el.style.getPropertyValue(p)
    }, prop),
  }
}

const opacity = await nudge('opacity')
ok(opacity.applied === '0.95' && !opacity.field.includes('px'),
   `opacity 按 ↓ 得到合法值：字段=${opacity.field} 生效=${opacity.applied}`)

const zIndex = await nudge('z-index', 'ArrowUp')
ok(!zIndex.skipped ? !String(zIndex.field).includes('px') : true,
   `z-index 不补单位：${zIndex.skipped ? '（当前元素不适用，已跳过）' : zIndex.field}`)

const lineHeight = await nudge('line-height', 'ArrowUp')
ok(lineHeight.applied !== '' && !/NaN|normal\d/.test(String(lineHeight.field)),
   `line-height 从 normal 回落到计算值再步进：字段=${lineHeight.field} 生效=${lineHeight.applied}`)

await expandPadding()
const padding = await nudge('padding-top', 'ArrowUp')
ok(padding.applied.endsWith('px'),
   `长度类属性仍正常补 px：${padding.applied}`)

await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.waitForTimeout(200)

// ── 回归：反复切换编辑态/交互态不得累积快捷键处理器 ──
// ⌘⇧Enter 是「选中所有子元素」。处理器若累积 N 份，一次按键会连续
// 下钻 N 层，选中的就不再是直接子元素。
await page.evaluate(() => window.__visualRevise.store.undoEverything())
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 }, force: true })
await page.waitForTimeout(400)

for (let i = 0; i < 3; i++) {
  await page.evaluate(() => document.activeElement?.blur?.())
  await page.keyboard.press('Tab')      // 进入交互态
  await page.waitForTimeout(200)
  await page.keyboard.press('Tab')      // 回到编辑态
  await page.waitForTimeout(200)
}

const beforeDrill = await page.evaluate(() =>
  window.__visualRevise.panel.target?.tagName)

await page.keyboard.press('Meta+Shift+Enter')
await page.waitForTimeout(400)

const drilled = await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll('[data-selected]'))
  const card = document.querySelectorAll('.curve-card')[1]
  return {
    count: sel.length,
    allDirectChildren: sel.every(el => el.parentElement === card),
    tags: [...new Set(sel.map(el => el.tagName))],
  }
})

ok(beforeDrill === 'ARTICLE', `三轮切换后选中仍在原元素（${beforeDrill}）`)
ok(drilled.allDirectChildren,
   `⌘⇧Enter 只下钻一层：选中 ${drilled.count} 个 [${drilled.tags}]，均为直接子元素`)

// ── 回归：面板上滚动不得穿透到页面 ──
await page.locator('.curve-card').nth(1).click({ position: { x: 130, y: 8 }, force: true })
await page.waitForTimeout(400)

// 先把页面撑高，确保它本身可滚动
await page.evaluate(() => {
  const spacer = document.createElement('div')
  spacer.id = 'vr-scroll-spacer'
  spacer.style.height = '3000px'
  document.body.appendChild(spacer)
  scrollTo(0, 0)
})
await page.waitForTimeout(200)

const panelBox = await page.locator('visual-revise-panel').boundingBox()
const before = await page.evaluate(() => ({
  page: scrollY,
  panel: document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop,
}))

// 在面板正中滚动
await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2)
await page.mouse.wheel(0, 400)
await page.waitForTimeout(400)

const afterPanel = await page.evaluate(() => ({
  page: scrollY,
  panel: document.querySelector('visual-revise-panel').shadowRoot.querySelector('.scroll').scrollTop,
}))

ok(afterPanel.page === before.page,
   `面板上滚动不带动页面（页面 scrollY ${before.page} → ${afterPanel.page}）`)
ok(afterPanel.panel > before.panel,
   `面板内容确实滚动了（scrollTop ${before.panel} → ${afterPanel.panel}）`)

// 在面板 header（非滚动区）滚动，同样不该带动页面
await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + 12)
await page.mouse.wheel(0, 300)
await page.waitForTimeout(300)
ok(await page.evaluate(() => scrollY) === before.page,
   '在面板头部滚动同样不穿透')

// 页面本身仍可正常滚动
await page.mouse.move(200, 500)
await page.mouse.wheel(0, 400)
await page.waitForTimeout(300)
ok(await page.evaluate(() => scrollY) > before.page, '面板之外的区域页面照常滚动')

await page.evaluate(() => {
  document.getElementById('vr-scroll-spacer')?.remove()
  scrollTo(0, 0)
})


// ── 摆位 ────────────────────────────────────────────────────
// 面板写死在右上角的话，选到页面右侧的元素时正好把它盖住——
// 而改属性的全部意义就是看着它变。

await page.evaluate(() => {
  for (const [id, css] of [['vr-left', 'left:20px'], ['vr-right', 'right:20px']]) {
    const d = document.createElement('div')
    d.id = id
    d.textContent = id
    d.style.cssText = `position:fixed;top:300px;width:160px;height:80px;background:#ddd;z-index:1;${css}`
    document.body.append(d)
  }
})

const placement = async sel => {
  await page.locator(sel).click()
  await page.waitForTimeout(400)
  return page.evaluate(s => {
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const p = document.querySelector('visual-revise-panel').getBoundingClientRect()
    const t = document.querySelector(s).getBoundingClientRect()
    const bar = document.querySelector('visual-revise-toolbar').getBoundingClientRect()
    return {
      onRightOfTarget: p.left >= t.right,
      onLeftOfTarget: p.right <= t.left,
      inside: p.left >= -0.5 && p.top >= -0.5
        && p.right <= document.documentElement.clientWidth + 0.5
        && p.bottom <= document.documentElement.clientHeight + 0.5,
      overlapsTarget: hit(p, t),
      overlapsToolbar: hit(p, bar),
      left: Math.round(p.left),
    }
  }, sel)
}

const left = await placement('#vr-left')
ok(left.onRightOfTarget, `贴左的元素：面板出现在它右边（left=${left.left}）`)
ok(left.inside && !left.overlapsTarget, '完整落在视口内，且没盖住选中的元素')
ok(!left.overlapsToolbar, '也没被工具条压住')

const right = await placement('#vr-right')
ok(right.onLeftOfTarget, `贴右的元素：面板翻到它左边（left=${right.left}）`)
ok(right.inside && !right.overlapsTarget, '同样完整在视口内、不盖住元素')

// 手动拖过之后不再自动摆位：那是用户明确的意图
const dragged = await page.evaluate(async () => {
  const panel = document.querySelector('visual-revise-panel')
  const header = panel.shadowRoot.querySelector('header')
  const r = header.getBoundingClientRect()
  const opts = { bubbles: true, composed: true, pointerId: 1, button: 0 }
  header.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: r.left + 40, clientY: r.top + 10 }))
  header.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 300, clientY: 500 }))
  header.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: 300, clientY: 500 }))
  await new Promise(r => setTimeout(r, 100))
  return { pinned: panel.hasAttribute('data-user-placed'), left: Math.round(panel.getBoundingClientRect().left) }
})
ok(dragged.pinned, '拖动后面板被钉住')

await page.locator('#vr-left').click()
await page.waitForTimeout(400)
const afterPin = await page.evaluate(() =>
  Math.round(document.querySelector('visual-revise-panel').getBoundingClientRect().left))
ok(afterPin === dragged.left,
   `钉住之后选别的元素也不再自动移动（${dragged.left} → ${afterPin}）`)

await page.evaluate(() => {
  document.querySelector('#vr-left')?.remove()
  document.querySelector('#vr-right')?.remove()
  const p = document.querySelector('visual-revise-panel')
  p.removeAttribute('data-user-placed')
})

// ── 面板的 × ────────────────────────────────────────────────
// 它只收起面板。退出整个编辑器是工具条上那个 × 的事——两个 × 干同一件事
// 的话，想收起面板继续看页面就没有办法了。
await page.locator('.curve-card').first().click()
await page.waitForTimeout(300)
ok(!(await page.locator('visual-revise-panel').isHidden()), '选中元素后面板出现')

const modeBeforeClose = await page.evaluate(() => window.__visualRevise.mode)
await page.locator('visual-revise-panel .close').click()
await page.waitForTimeout(300)
ok(await page.locator('visual-revise-panel').isHidden(), '× 收起面板')
ok(await page.locator('vis-bug').count() === 1, '编辑器仍在，没有被一并关掉')
ok(await page.locator('visual-revise-toolbar').count() === 1, '工具条也还在')
ok(await page.evaluate(() => document.querySelectorAll('[data-selected]').length) === 0,
   '同时取消了选中——只藏不取消的话，下次选中面板又冒出来，× 看着像没生效')

// × 是「收起这块面板」，不是「退出当前模式」。用户多半还想接着选下一个元素，
// 把他从选择模式踢到浏览模式是自作主张。
const modeAfterClose = await page.evaluate(() => window.__visualRevise.mode)
ok(modeAfterClose === modeBeforeClose,
   `× 不改变当前模式（${modeBeforeClose} → ${modeAfterClose}）`)

// 而且模式还活着：随手再点一个元素，面板应该照常回来
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(350)
ok(!(await page.locator('visual-revise-panel').isHidden()),
   '收起后再选一个元素，面板照常回来——说明选择模式没被 × 关掉')

// ── 点插件 UI 不该惊动页面 ──────────────────────────────────
// 前面的用例收了面板、也改过页面元素，这一段从干净状态起
await page.reload()
await injectVisBug(page, origin)
await page.waitForTimeout(400)

// 页面上的 popover / dropdown / modal 普遍靠「点在外面就关掉」收起自己，
// 那是一个绑在 document 上的 pointerdown / click 监听器。我们的面板就在
// 页面 DOM 里，事件照样冒到 document，页面于是判定「点在外面」，
// 把用户正看着的菜单关掉了。
const openPagePopover = () => page.evaluate(() => {
  document.getElementById('page-popover')?.remove()
  const menu = document.createElement('div')
  menu.id = 'page-popover'
  menu.textContent = '钉选专案 / 删除'
  menu.style.cssText = 'position:fixed;left:8px;bottom:8px;padding:8px;background:#fff;z-index:9'
  document.body.appendChild(menu)
  window.__pagePopoverOpen = true

  // 页面侧最常见的两种写法都装上
  const closeIfOutside = e => {
    if (menu.contains(e.target)) return
    window.__pagePopoverOpen = false
    menu.remove()
  }
  document.addEventListener('pointerdown', closeIfOutside)
  document.addEventListener('click', closeIfOutside)
})
const popoverOpen = () => page.evaluate(() => window.__pagePopoverOpen === true)

// 先把面板开出来
await page.locator('.curve-card').nth(1).click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(350)

await openPagePopover()
await page.locator('visual-revise-panel .tag').click()
await page.waitForTimeout(250)
ok(await popoverOpen(), '点属性面板的标题栏，页面上的菜单不会被关掉')

await page.locator('visual-revise-panel').click({ position: { x: 20, y: 200 } })
await page.waitForTimeout(250)
ok(await popoverOpen(), '点面板身上任意位置同样不影响页面')

await page.locator('visual-revise-toolbar').click({ position: { x: 8, y: 8 } })
await page.waitForTimeout(250)
ok(await popoverOpen(), '工具条也一样')

// 反过来必须仍然管用：隔离只针对插件 UI，页面自己的「点外面关闭」不能被废掉。
// 先收起面板，否则它浮在上面，这一点就落在插件 UI 上、验不到页面行为。
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const spot = await page.evaluate(() => {
  const r = document.querySelector('.curve-card').getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})
await page.mouse.click(spot.x, spot.y)
await page.waitForTimeout(250)
ok(!(await popoverOpen()),
   '点页面自己的区域时，页面的 outside-click 照常生效——隔离不是把页面功能一起掐了')

// 而且那一下点击本身要照常起作用：选中元素、面板跟着刷新
const tagReselected = await page.locator('visual-revise-panel .tag').textContent()
ok(/\w/.test(tagReselected) && !tagReselected.includes('visual-revise'),
   `同一下点击仍正常选中页面元素（命中最内层，这里是卡片里的标题）：${tagReselected}`)


// ── 「重置本组」不能把用户原本的短属性删掉 ────────────────────
// parseInlineStyle 遍历 CSSStyleDeclaration 只得到长属性，border-radius: 8px
// 在表里是四个 border-*-radius；revertProp 按 'border-radius' 查不到就 remove，
// 用户原本写的圆角就没了。padding / margin / border / gap 同理。
await page.reload(); await injectVisBug(page, origin); await page.waitForTimeout(400)
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'sh'
  d.style.cssText = 'position:absolute;left:30px;top:600px;width:160px;height:60px;border-radius:8px;padding:12px;background:#345'
  document.body.appendChild(d)
})
await page.locator('#sh').click({ position: { x: 80, y: 30 } }); await page.waitForTimeout(450)
const radius = page.locator('visual-revise-panel input[data-prop="border-radius"]')
await radius.fill('20'); await radius.press('Enter'); await page.waitForTimeout(250)
await page.locator('visual-revise-panel .acts .undo[data-undo="appearance"]').click(); await page.waitForTimeout(300)
const sh = await page.evaluate(() => { const s = document.getElementById('sh').style; return { radius: s.borderRadius, padding: s.padding } })
ok(sh.radius === '8px', `重置本组把短属性 border-radius 还原到原值，而不是删掉（"${sh.radius}"）`)
ok(sh.padding === '12px', `没动过的短属性 padding 原样保留（"${sh.padding}"）`)

await browser.close(); await close()
console.log(process.exitCode ? '\n结果：有失败项\n' : '\n结果：全部通过\n')
