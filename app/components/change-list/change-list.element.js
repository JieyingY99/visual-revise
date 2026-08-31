import { ChangeStore } from '../../core/change-store.js'
import { downloadJSON, pickAndImport } from '../../core/json-io.js'
import { default as list_css } from './change-list.element.css'

const OVERLAY_ID = 'visual-revise-locate-overlay'

const ensureOverlay = () => {
  let el = document.getElementById(OVERLAY_ID)
  if (el) return el

  el = document.createElement('div')
  el.id = OVERLAY_ID
  el.setAttribute('data-visual-revise-ui', '')
  el.style.cssText = `
    position: absolute; z-index: 2147483645; pointer-events: none;
    border: 2px solid #0d99ff; background: rgb(13 153 255 / .12);
    border-radius: 2px; transition: all .12s ease-out; display: none;`
  document.body.appendChild(el)
  return el
}

const highlight = el => {
  const overlay = ensureOverlay()
  if (!el?.isConnected) { overlay.style.display = 'none'; return }

  const r = el.getBoundingClientRect()
  Object.assign(overlay.style, {
    display: 'block',
    top:    `${r.top + scrollY}px`,
    left:   `${r.left + scrollX}px`,
    width:  `${r.width}px`,
    height: `${r.height}px`,
  })
}

const clearHighlight = () => {
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) overlay.style.display = 'none'
}

const shortSelector = anchors => {
  const parts = anchors.selector.split(' > ')
  return parts[parts.length - 1]
}

export class ChangeList extends HTMLElement {
  #shadow
  #tab = 'all'
  #unsubscribe = null

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.setAttribute('data-visual-revise-ui', '')
    this.addEventListener('keydown', e => e.stopPropagation())
    this.#shadow.innerHTML = `<style>${list_css}</style><div id="root"></div>`
    this.#unsubscribe = ChangeStore.subscribe(() => this.render())
    this.render()
  }

  disconnectedCallback() {
    this.#unsubscribe?.()
    clearHighlight()
  }

  render() {
    const root = this.#shadow.querySelector('#root')
    if (!root) return

    const { edits, comments } = ChangeStore.read()
    const stats = ChangeStore.stats()

    const showStyles   = this.#tab === 'all' || this.#tab === 'style'
    const showComments = this.#tab === 'all' || this.#tab === 'comment'

    const items = [
      ...(showStyles ? edits.map(e => this.#renderEdit(e)) : []),
      ...(showComments ? comments.map(c => this.#renderComment(c)) : []),
    ]

    root.innerHTML = `
      <header>
        <div class="tabs">
          <button data-tab="all"${this.#tab === 'all' ? ' data-on' : ''}>全部 ${stats.total}</button>
          <button data-tab="style"${this.#tab === 'style' ? ' data-on' : ''}>配置 ${stats.props}</button>
          <button data-tab="comment"${this.#tab === 'comment' ? ' data-on' : ''}>评论 ${stats.comments}</button>
        </div>
        <button class="icon-btn close" title="关闭">×</button>
      </header>
      <div class="items">
        ${items.length ? items.join('') : '<div class="empty">还没有任何改动<br>在页面上选中元素并调整属性</div>'}
      </div>
      <footer>
        <button class="primary copy"${stats.total ? '' : ' disabled'}>复制提示词</button>
        <button class="ghost export"${stats.total ? '' : ' disabled'} title="导出为 JSON，交给开发导入">导出</button>
        <button class="ghost import" title="导入他人导出的 JSON 配置">导入</button>
        <button class="ghost danger reset" title="撤销全部改动">重置</button>
      </footer>`

    this.#bind()
  }

  #renderEdit(entry) {
    return `<div class="item" data-id="${entry.id}" data-kind="style">
      <div class="item-head">
        <span class="sel" title="${entry.anchors.selector}">${shortSelector(entry.anchors)}</span>
        <span class="badge">${entry.changes.length}</span>
        <button class="icon-btn undo-el" data-id="${entry.id}" title="撤销此元素全部改动">↺</button>
      </div>
      <div class="changes">
        ${entry.changes.map(c => `
          <div class="change">
            <span><code>${c.prop}</code> <span class="from">${c.from || '—'}</span> → <span class="to">${c.to}</span></span>
            <button class="undo-prop" data-id="${entry.id}" data-prop="${c.prop}" title="撤销这一项">×</button>
          </div>`).join('')}
      </div>
    </div>`
  }

  #renderComment(c) {
    return `<div class="item" data-id="${c.id}" data-kind="comment">
      <div class="item-head">
        <span class="sel" title="${c.anchors.selector}">${shortSelector(c.anchors)}</span>
        <span class="badge" data-kind="comment">#${c.seq}</span>
        <button class="icon-btn del-comment" data-id="${c.id}" title="删除评论">×</button>
      </div>
      <div class="comment-text">${c.text.replace(/</g, '&lt;')}</div>
    </div>`
  }

  #elementOf(id, kind) {
    const { edits, comments } = ChangeStore.read()
    return kind === 'comment'
      ? comments.find(c => c.id === id)?.el
      : edits.find(e => e.id === id)?.el
  }

  #bind() {
    const shadow = this.#shadow
    const on = (sel, evt, fn) => shadow.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn))

    on('.tabs button', 'click', e => {
      this.#tab = e.currentTarget.dataset.tab
      this.render()
    })

    on('.close', 'click', () => { this.hidden = true; clearHighlight() })
    on('.copy', 'click', () => this.dispatchEvent(new CustomEvent('vr-copy', { bubbles: true, composed: true })))

    on('.export', 'click', () => {
      downloadJSON()
      this.dispatchEvent(new CustomEvent('vr-toast', {
        bubbles: true, composed: true,
        detail: { message: `已导出 ${ChangeStore.stats().total} 项改动` },
      }))
    })

    on('.import', 'click', async () => {
      const report = await pickAndImport()
      const message = report.ok
        ? `导入 ${report.matched.length} 处改动` +
          (report.comments ? ` + ${report.comments} 条评论` : '') +
          (report.viaText ? `（${report.viaText} 处靠文本特征匹配）` : '') +
          (report.missing.length ? `，${report.missing.length} 处未找到对应元素` : '')
        : report.reason
      this.dispatchEvent(new CustomEvent('vr-toast', {
        bubbles: true, composed: true,
        detail: { message, kind: report.ok ? 'info' : 'error' },
      }))
    })

    on('.reset', 'click', () => {
      ChangeStore.undoEverything()
      clearHighlight()
    })

    on('.item', 'mouseenter', e =>
      highlight(this.#elementOf(e.currentTarget.dataset.id, e.currentTarget.dataset.kind)))

    on('.item', 'mouseleave', clearHighlight)

    on('.item', 'click', e => {
      if (e.target.closest('button')) return
      const el = this.#elementOf(e.currentTarget.dataset.id, e.currentTarget.dataset.kind)
      if (!el?.isConnected) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      this.dispatchEvent(new CustomEvent('vr-locate', {
        bubbles: true, composed: true, detail: { el },
      }))
    })

    on('.undo-prop', 'click', e => {
      e.stopPropagation()
      ChangeStore.undoProp(e.currentTarget.dataset.id, e.currentTarget.dataset.prop)
    })

    on('.undo-el', 'click', e => {
      e.stopPropagation()
      ChangeStore.undoElement(e.currentTarget.dataset.id)
    })

    on('.del-comment', 'click', e => {
      e.stopPropagation()
      ChangeStore.removeComment(e.currentTarget.dataset.id)
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
}

customElements.define('visual-revise-list', ChangeList)
export { highlight, clearHighlight }
