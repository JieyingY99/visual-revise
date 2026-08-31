import { GROUPS, sameValue } from '../../core/tracked-props.js'
import { CONTROLS, SIDE_GROUPS, SIDE_PROPS, isRelevant, coerceLength, stepValue, stepSize } from '../../core/controls.js'
import { ChangeStore } from '../../core/change-store.js'
import { readComputed } from '../../core/snapshot.js'
import { stableClasses } from '../../core/anchors.js'
import { findSharedElements, describeShared } from '../../core/shared-elements.js'
import { loadLocalFonts, isSupported as fontsSupported } from '../../core/local-fonts.js'
import { default as panel_css } from './props-panel.element.css'

const rgbToHex = value => {
  const m = String(value).match(/rgba?\(([^)]+)\)/)
  if (!m) return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#000000'
  const [r, g, b] = m[1].split(',').map(n => parseInt(n, 10))
  return '#' + [r, g, b].map(n => (n || 0).toString(16).padStart(2, '0')).join('')
}

const isTransparent = value =>
  !value || value === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(value)

const describeTarget = el => {
  const classes = stableClasses(el)
  return `${el.tagName.toLowerCase()}${classes.length ? '.' + classes.join('.') : ''}`
}

export class PropsPanel extends HTMLElement {
  #shadow
  #targets = []
  #computed = {}
  #folded = new Set(['position', 'effects'])
  #unsubscribe = null
  #dirtyProps = new Set()
  #shared = false
  #sharedEls = []

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    // 自定义元素规范禁止在 constructor 中设置属性
    this.setAttribute('data-visual-revise-ui', '')

    // 面板内的按键归面板：Enter/Tab/Delete 等都是 VisBug 的全局快捷键，
    // 漏出去会在输入时误触发元素遍历、删除等操作。
    this.addEventListener('keydown', e => e.stopPropagation())

    this.#shadow.innerHTML = `<style>${panel_css}</style><div id="root"></div>`
    this.#unsubscribe = ChangeStore.subscribe(() => {
      this.#syncValues()
      this.#refreshDirty()
    })
    this.render()
  }

  disconnectedCallback() {
    this.#unsubscribe?.()
  }

  // 由宿主在选中变化时调用
  setTargets(els) {
    this.#targets = (els || []).filter(el => el?.isConnected)
    this.#computed = this.#targets.length ? readComputed(this.#targets[0]) : {}
    this.#targets.forEach(el => ChangeStore.track(el))
    this.#sharedEls = this.#shared && this.target ? findSharedElements(this.target) : []
    this.#sharedEls.forEach(el => ChangeStore.track(el))
    this.render()
  }

  get target() { return this.#targets[0] || null }

  #applyToAll(prop, value) {
    const targets = this.#shared
      ? [...new Set([...this.#targets, ...this.#sharedEls])]
      : this.#targets

    targets.forEach(el => ChangeStore.applyProp(el, prop, value))
    if (this.target) this.#computed = readComputed(this.target)
  }

  setShared(on) {
    this.#shared = on
    this.#sharedEls = on && this.target ? findSharedElements(this.target) : []

    const btn = this.#shadow.querySelector('.shared')
    if (btn) on ? btn.setAttribute('data-on', '') : btn.removeAttribute('data-on')

    if (on) {
      this.#sharedEls.forEach(el => ChangeStore.track(el))
      this.#toast(describeShared(this.#sharedEls.length))
    }
    this.#refreshDirty()
    return this.#sharedEls.length
  }

  get sharedCount() { return this.#shared ? this.#sharedEls.length : 0 }

  #dirtySet() {
    const target = this.target
    if (!target) return new Set()
    const entry = ChangeStore.read().edits.find(e => e.el === target)
    return new Set(entry ? entry.changes.map(c => c.prop) : [])
  }

  // 改动可能来自面板之外：改动列表的撤销、整体重置、JSON 导入。
  // 只刷新 dirty 标记而不回读值，会让字段停留在已被撤销的旧数字上，
  // 下一次拖动标签就从那个旧数字继续，等于把撤销掉的改动又加回去。
  #syncValues() {
    const target = this.target
    if (!target?.isConnected) return

    this.#computed = readComputed(target)
    const active = this.#shadow.activeElement

    for (const el of this.#shadow.querySelectorAll('[data-prop]')) {
      if (el === active) continue          // 不打断正在输入的字段

      const prop = el.dataset.prop
      if (!prop || prop.includes(',')) continue

      const value = this.#computed[prop] ?? ''

      if (el.tagName === 'SELECT') {
        if (el.value !== value) el.value = value
        continue
      }

      if (el.tagName === 'BUTTON') {       // segment 分段按钮
        el.dataset.value === value
          ? el.setAttribute('data-on', '')
          : el.removeAttribute('data-on')
        continue
      }

      if (el.tagName !== 'INPUT') continue

      if (el.dataset.color !== undefined) {
        const hex = rgbToHex(value)
        if (el.value !== hex) el.value = hex
        const swatch = el.closest('.swatch')?.querySelector('i')
        if (swatch) swatch.style.background = isTransparent(value) ? 'transparent' : value
        continue
      }

      // 颜色行里的文本输入与颜色选择器共用 data-prop
      const isColorText = el.type === 'text' && el.closest('.color-row')
      const next = isColorText && isTransparent(value) ? '' : value
      if (el.value !== next) el.value = next
    }
  }

  #refreshDirty() {
    const dirty = this.#dirtySet()
    this.#dirtyProps = dirty

    this.#shadow.querySelectorAll('label.name[data-prop]').forEach(label => {
      const prop = label.dataset.prop
      const isDirty = prop.includes(',')
        ? prop.split(',').some(p => dirty.has(p))
        : dirty.has(prop)
      isDirty ? label.setAttribute('data-dirty', '') : label.removeAttribute('data-dirty')
    })

    const stats = ChangeStore.stats()
    const copyBtn = this.#shadow.querySelector('.copy')
    const listBtn = this.#shadow.querySelector('.list')
    if (copyBtn) copyBtn.disabled = stats.total === 0
    if (listBtn) listBtn.textContent = `记录 ${stats.total}`
    const sub = this.#shadow.querySelector('.sub')
    if (sub && this.target) sub.textContent = this.#subtitle()
  }

  #subtitle() {
    const count = this.#dirtyProps.size
    const multi = this.#targets.length > 1 ? `已选 ${this.#targets.length} 个 · ` : ''
    const shared = this.#shared && this.#sharedEls.length
      ? ` · 联动 ${this.#sharedEls.length + 1} 个`
      : ''
    return `${multi}${count ? `${count} 项改动` : '未改动'}${shared}`
  }

  render() {
    const root = this.#shadow.querySelector('#root')
    if (!root) return

    this.#dirtyProps = this.#dirtySet()

    root.innerHTML = this.target
      ? this.#renderPanel()
      : `<header><div class="target"><span class="tag">未选中元素</span></div>
           <button class="icon-btn close" title="关闭">×</button></header>
         <div class="empty">点击页面上的任意元素开始编辑<br><kbd>Tab</kbd> 临时退出编辑态<br><kbd>Esc</kbd> 取消选中</div>`

    this.#bind()
    this.#refreshDirty()
  }

  #renderPanel() {
    const sections = GROUPS.map(group => this.#renderGroup(group)).filter(Boolean).join('')
    return `
      <header>
        <div class="target">
          <span class="tag">${describeTarget(this.target)}</span>
          <span class="sub">${this.#subtitle()}</span>
        </div>
        <button class="icon-btn comment" title="评论模式（C）：在元素上添加交互说明">💬</button>
        <button class="icon-btn reorder" title="拖拽重排（R）：在页面上拖动子元素调整顺序">⇅</button>
        <button class="icon-btn shared"${this.#shared ? ' data-on' : ''}
          title="共享元素：同步修改页面中结构相同的元素">⧉</button>
        <button class="icon-btn fold" title="折叠面板">▾</button>
        <button class="icon-btn close" title="关闭">×</button>
      </header>
      <div class="scroll">${sections}</div>
      <div class="toast"></div>
      <footer>
        <button class="primary copy">复制提示词</button>
        <button class="ghost list">记录 0</button>
      </footer>`
  }

  #renderGroup(group) {
    const sideGroup = SIDE_GROUPS.find(s => group.props.includes(s.props[0]))
    const rows = []

    if (sideGroup)
      SIDE_GROUPS.forEach(sg => rows.push(this.#renderSides(sg)))

    group.props
      .filter(prop => !SIDE_PROPS.has(prop))
      .filter(prop => isRelevant(prop, this.#computed, this.target))
      .forEach(prop => rows.push(this.#renderControl(prop)))

    if (!rows.filter(Boolean).length) return ''

    const folded = this.#folded.has(group.id) ? ' folded' : ''
    return `<section data-group="${group.id}"${folded}>
      <h3>${group.label}</h3>
      <div class="rows">${rows.filter(Boolean).join('')}</div>
    </section>`
  }

  #renderSides(sg) {
    const values = sg.props.map(p => this.#computed[p] || '')
    const linked = values.every(v => v === values[0])
    return `<div class="row">
      <label class="name" data-prop="${sg.props.join(',')}">${sg.label}</label>
      <div class="sides">
        ${sg.props.map((p, i) => `<input type="text" data-prop="${p}" data-side
            value="${values[i]}" title="${p}">`).join('')}
        <button class="icon-btn lock" data-lock="${sg.base}" ${linked ? 'data-on' : ''}
          title="四边联动">⛓</button>
      </div>
    </div>`
  }

  #renderControl(prop) {
    const spec = CONTROLS[prop]
    if (!spec) return ''
    const value = this.#computed[prop] ?? ''

    const field = (() => {
      switch (spec.type) {
        case 'select':
          return `<select data-prop="${prop}">
            ${!spec.options.includes(value) ? `<option value="${value}" selected>${value || '—'}</option>` : ''}
            ${spec.options.map(o => `<option value="${o}"${o === value ? ' selected' : ''}>${o}</option>`).join('')}
          </select>`

        case 'segment':
          return `<div class="segment">${spec.options.map(([val, label]) =>
            `<button data-prop="${prop}" data-value="${val}"${val === value ? ' data-on' : ''}>${label}</button>`
          ).join('')}</div>`

        case 'color': {
          const hex = rgbToHex(value)
          const shown = isTransparent(value) ? '' : value
          return `<div class="color-row">
            <button class="swatch" title="选择颜色">
              <i style="background:${isTransparent(value) ? 'transparent' : value}"></i>
              <input type="color" data-prop="${prop}" data-color value="${hex}">
            </button>
            <input type="text" data-prop="${prop}" value="${shown}" placeholder="transparent">
          </div>`
        }

        case 'text': {
          const field = `<input type="text" data-prop="${prop}" value="${String(value).replace(/"/g, '&quot;')}">`
          return prop === 'font-family' && fontsSupported()
            ? `<div class="color-row">${field}
                 <button class="icon-btn load-fonts" title="读取本地已安装字体">⤓</button>
               </div>`
            : field
        }

        default:
          return `<input type="text" data-prop="${prop}" data-num value="${value}">`
      }
    })()

    const draggable = spec.type === 'num' ? ' data-drag' : ''
    return `<div class="row">
      <label class="name" data-prop="${prop}"${draggable} title="${prop}">${spec.label}</label>
      ${field}
    </div>`
  }

  #toast(message, kind = 'info') {
    const el = this.#shadow.querySelector('.toast')
    if (!el) return
    el.textContent = message
    el.dataset.kind = kind
    el.setAttribute('data-show', '')
    clearTimeout(this.__toastTimer)
    this.__toastTimer = setTimeout(() => el.removeAttribute('data-show'), 2200)
  }

  #commit(prop, raw, { coerce = true } = {}) {
    const spec = CONTROLS[prop]
    const value = coerce && spec?.coerce ? spec.coerce(raw) : raw
    this.#applyToAll(prop, value)
    this.dispatchEvent(new CustomEvent('vr-change', { bubbles: true, composed: true }))
  }

  #bind() {
    const shadow = this.#shadow
    const on = (sel, evt, fn) => shadow.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn))

    on('h3', 'click', e => {
      const section = e.currentTarget.closest('section')
      const id = section.dataset.group
      this.#folded.has(id) ? this.#folded.delete(id) : this.#folded.add(id)
      section.toggleAttribute('folded')
    })

    on('.close', 'click', () => this.dispatchEvent(new CustomEvent('vr-close', { bubbles: true, composed: true })))
    on('.fold', 'click', () => this.toggleAttribute('collapsed'))
    on('.shared', 'click', () => {
      const count = this.setShared(!this.#shared)
      this.dispatchEvent(new CustomEvent('vr-shared-toggle', {
        bubbles: true, composed: true, detail: { on: this.#shared, count },
      }))
    })
    on('.comment', 'click', () => this.dispatchEvent(new CustomEvent('vr-comment-toggle', { bubbles: true, composed: true })))
    on('.reorder', 'click', () => this.dispatchEvent(new CustomEvent('vr-reorder-toggle', { bubbles: true, composed: true })))
    on('.load-fonts', 'click', async e => {
      const btn = e.currentTarget
      btn.textContent = '…'
      const result = await loadLocalFonts()
      btn.textContent = '⤓'

      if (!result.ok) { this.#toast(result.reason, 'error'); return }

      const input = this.#shadow.querySelector('input[data-prop="font-family"]')
      let dl = this.#shadow.querySelector('#vr-font-list')
      if (!dl) {
        dl = document.createElement('datalist')
        dl.id = 'vr-font-list'
        this.#shadow.querySelector('#root').appendChild(dl)
      }
      dl.innerHTML = result.fonts.map(f => `<option value="${f}"></option>`).join('')
      input?.setAttribute('list', 'vr-font-list')
      this.#toast(`已读取 ${result.fonts.length} 个本地字体`)
    })
    on('.copy', 'click', () => this.dispatchEvent(new CustomEvent('vr-copy', { bubbles: true, composed: true })))
    on('.list', 'click', () => this.dispatchEvent(new CustomEvent('vr-open-list', { bubbles: true, composed: true })))

    // 聚焦中的字段在同步时被跳过（不打断输入），失焦时补一次，
    // 否则外部撤销发生在用户正编辑该字段时，它会一直停在旧值上
    on('input[data-prop]', 'blur', () => this.#syncValues())

    on('input[data-prop]', 'change', e => {
      const el = e.currentTarget
      if (el.dataset.color) return

      const prop = el.dataset.prop
      const next = CONTROLS[prop]?.coerce?.(el.value) ?? el.value

      // 与当前实际值相同就不是一次编辑。程序同步字段值后浏览器可能
      // 补发 change，若照单提交会把刚被外部撤销的改动又写回去。
      if (sameValue(next, this.#computed[prop])) return

      this.#commit(prop, el.value)
    })

    on('input[data-color]', 'input', e => {
      const el = e.currentTarget
      this.#commit(el.dataset.prop, el.value, { coerce: false })
      const swatch = el.closest('.swatch')?.querySelector('i')
      if (swatch) swatch.style.background = el.value
      const text = el.closest('.color-row')?.querySelector('input[type=text]')
      if (text) text.value = el.value
    })

    on('select[data-prop]', 'change', e =>
      this.#commit(e.currentTarget.dataset.prop, e.currentTarget.value, { coerce: false }))

    on('.segment button', 'click', e => {
      const btn = e.currentTarget
      btn.parentElement.querySelectorAll('button').forEach(b => b.removeAttribute('data-on'))
      btn.setAttribute('data-on', '')
      this.#commit(btn.dataset.prop, btn.dataset.value, { coerce: false })
    })

    on('.lock', 'click', e => {
      const btn = e.currentTarget
      btn.toggleAttribute('data-on')
      if (!btn.hasAttribute('data-on')) return
      const base = btn.dataset.lock
      const first = shadow.querySelector(`input[data-prop="${base}-top"]`)
      const value = coerceLength(first?.value || '0')
      ;['top', 'right', 'bottom', 'left'].forEach(side => {
        const input = shadow.querySelector(`input[data-prop="${base}-${side}"]`)
        if (input) input.value = value
        this.#commit(`${base}-${side}`, value)
      })
    })

    // 四边联动：锁开启时改一个同步四个
    on('input[data-side]', 'change', e => {
      const input = e.currentTarget
      const base = input.dataset.prop.replace(/-(top|right|bottom|left)$/, '')
      const lock = shadow.querySelector(`.lock[data-lock="${base}"]`)
      if (!lock?.hasAttribute('data-on')) return
      const value = coerceLength(input.value)
      ;['top', 'right', 'bottom', 'left'].forEach(side => {
        const sib = shadow.querySelector(`input[data-prop="${base}-${side}"]`)
        if (sib && sib !== input) sib.value = value
        this.#commit(`${base}-${side}`, value)
      })
    })

    // Figma 式：拖动标签横向调数值
    on('label.name[data-drag]', 'pointerdown', e => {
      const label = e.currentTarget
      const prop = label.dataset.prop
      const input = shadow.querySelector(`input[data-prop="${prop}"]`)
      if (!input) return

      e.preventDefault()
      label.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const origin = input.value
      const unitStep = stepSize(prop, false)

      const move = ev => {
        const steps = Math.round((ev.clientX - startX) / 2)
        const next = stepValue(prop, origin, steps * unitStep, this.#computed[prop])
        if (next === null) return
        input.value = next
        this.#commit(prop, next, { coerce: false })
      }
      const up = ev => {
        label.releasePointerCapture(ev.pointerId)
        label.removeEventListener('pointermove', move)
        label.removeEventListener('pointerup', up)
      }
      label.addEventListener('pointermove', move)
      label.addEventListener('pointerup', up)
    })

    // 数值输入支持上下键微调
    on('input[data-num], input[data-side]', 'keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()

      const input = e.currentTarget
      const prop = input.dataset.prop
      const delta = stepSize(prop, e.shiftKey) * (e.key === 'ArrowUp' ? 1 : -1)
      const next = stepValue(prop, input.value, delta, this.#computed[prop])

      if (next === null) return   // normal / auto 等无法步进的值
      input.value = next
      this.#commit(prop, next, { coerce: false })
    })

    this.#makeDraggable(shadow.querySelector('header'))
  }

  #makeDraggable(handle) {
    if (!handle) return
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return
      e.preventDefault()
      handle.setPointerCapture(e.pointerId)
      const rect = this.getBoundingClientRect()
      const offX = e.clientX - rect.left
      const offY = e.clientY - rect.top

      const move = ev => {
        this.style.left = `${ev.clientX - offX}px`
        this.style.top = `${ev.clientY - offY}px`
        this.style.right = 'auto'
      }
      const up = ev => {
        handle.releasePointerCapture(ev.pointerId)
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
    })
  }

  toast(msg, kind) { this.#toast(msg, kind) }

  setCommentMode(on) {
    const btn = this.#shadow.querySelector('.comment')
    if (!btn) return
    on ? btn.setAttribute('data-on', '') : btn.removeAttribute('data-on')
  }

  setReorderMode(on) {
    const btn = this.#shadow.querySelector('.reorder')
    if (!btn) return
    on ? btn.setAttribute('data-on', '') : btn.removeAttribute('data-on')
  }
}

customElements.define('visual-revise-panel', PropsPanel)
