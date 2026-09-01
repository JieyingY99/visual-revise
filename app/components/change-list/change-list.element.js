import { ChangeStore } from '../../core/change-store.js'
import { downloadJSON, pickAndImport } from '../../core/json-io.js'
import { containScroll } from '../../core/dom-utils.js'
import { fileNameOf, parseCssUrl } from '../../core/image-source.js'
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

// dataUrl 有几十万字符，原样塞进列表会把面板撑爆；长 URL 只留文件名，
// 那才是用户认得出的部分
const shortValue = v => {
  const raw = String(v ?? '').trim()
  if (!raw) return '（空）'

  const url = parseCssUrl(raw) || raw
  if (/^data:/i.test(url)) return '新图片'
  if (/^(https?:|blob:|\/)/i.test(url) || url.includes('/')) return fileNameOf(url)
  return raw.length > 40 ? raw.slice(0, 37) + '…' : raw
}

const shortSelector = anchors => {
  const parts = anchors.selector.split(' > ')
  return parts[parts.length - 1]
}

export class ChangeList extends HTMLElement {
  #shadow
  #tab = 'all'
  #unsubscribe = null
  #frame = null
  #built = false
  #releaseScroll = null

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.setAttribute('data-visual-revise-ui', '')
    this.addEventListener('keydown', e => e.stopPropagation())
    this.#shadow.innerHTML = `<style>${list_css}</style><div id="root"></div>`
    this.#buildSkeleton()
    this.#releaseScroll = containScroll(this, () => this.#shadow.querySelector('.items'))
    this.#unsubscribe = ChangeStore.subscribe(() => this.schedule())
    this.render()
  }

  disconnectedCallback() {
    this.#unsubscribe?.()
    this.#releaseScroll?.()
    if (this.#frame) cancelAnimationFrame(this.#frame)
    clearHighlight()
  }

  // 合并同一帧内的多次通知：拖动面板标签时 applyProp 会以指针事件的
  // 频率触发订阅，逐次全量渲染既浪费也会打断交互。
  schedule() {
    if (this.#frame) return
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null
      this.render()
    })
  }

  // header 与 footer 只建一次。它们若随每次通知重建，正在进行的
  // 面板拖动会因为 pointer capture 的目标节点被替换而当场中断。
  #buildSkeleton() {
    const root = this.#shadow.querySelector('#root')

    root.innerHTML = `
      <header>
        <div class="tabs">
          <button data-tab="all">全部 0</button>
          <button data-tab="style">配置 0</button>
          <button data-tab="comment">评论 0</button>
        </div>
        <button class="icon-btn close" title="关闭">×</button>
      </header>
      <div class="items"></div>
      <footer>
        <button class="primary copy" disabled>复制提示词</button>
        <button class="ghost export" disabled title="导出为 JSON，交给开发导入">导出</button>
        <button class="ghost import" title="导入他人导出的 JSON 配置">导入</button>
        <button class="ghost danger reset" title="撤销全部改动">重置</button>
      </footer>`

    this.#bindStatic()
    this.#makeDraggable(root.querySelector('header'))
    this.#built = true
  }

  render() {
    if (!this.#built) return

    const shadow = this.#shadow
    const { edits, comments, removals } = ChangeStore.read()
    const stats = ChangeStore.stats()

    // 「配置」这一栏原本漏算了换图与删除，数字对不上列表里的条数
    const label = {
      all:     `全部 ${stats.total}`,
      style:   `配置 ${stats.props + stats.texts + stats.attrs + stats.removals}`,
      comment: `评论 ${stats.comments}`,
    }
    shadow.querySelectorAll('.tabs button').forEach(btn => {
      const key = btn.dataset.tab
      if (btn.textContent !== label[key]) btn.textContent = label[key]
      key === this.#tab ? btn.setAttribute('data-on', '') : btn.removeAttribute('data-on')
    })

    shadow.querySelector('.copy').disabled   = stats.total === 0
    shadow.querySelector('.export').disabled = stats.total === 0

    const showStyles   = this.#tab === 'all' || this.#tab === 'style'
    const showComments = this.#tab === 'all' || this.#tab === 'comment'

    const items = [
      ...(showStyles ? edits.map(e => this.#renderEdit(e)) : []),
      // 删除是结构改动，归在「配置」这一栏
      ...(showStyles ? removals.map(r => this.#renderRemoval(r)) : []),
      ...(showComments ? comments.map(c => this.#renderComment(c)) : []),
    ]

    const container = shadow.querySelector('.items')
    container.innerHTML = items.length
      ? items.join('')
      : '<div class="empty">还没有任何改动<br>在页面上选中元素并调整属性</div>'

    this.#bindItems()
  }

  #renderEdit(entry) {
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

    const textRow = entry.text ? `
      <div class="change" data-text>
        <span><code>文案</code>
          <span class="from">${esc(entry.text.from) || '（空）'}</span> →
          <span class="to">${esc(entry.text.to) || '（空）'}</span></span>
        <button class="undo-text" data-id="${entry.id}" title="撤销文案改动">×</button>
      </div>` : ''

    const attrRows = (entry.attrs || []).map(a => `
      <div class="change" data-attr>
        <span><code>${a.attr === 'src' || a.attr === 'poster' ? '换图' : esc(a.attr)}</code>
          <span class="from">${esc(shortValue(a.from))}</span> →
          <span class="to">${esc(shortValue(a.to))}</span></span>
        <button class="undo-attr" data-id="${entry.id}" data-attr="${esc(a.attr)}"
          title="撤销这一项">×</button>
      </div>`).join('')

    return `<div class="item" data-id="${entry.id}" data-kind="style">
      <div class="item-head">
        <span class="sel" title="${entry.anchors.selector}">${shortSelector(entry.anchors)}</span>
        <span class="badge">${entry.changes.length + (entry.text ? 1 : 0) + (entry.attrs?.length || 0)}</span>
        <button class="icon-btn undo-el" data-id="${entry.id}" title="撤销此元素全部改动">↺</button>
      </div>
      <div class="changes">
        ${textRow}
        ${attrRows}
        ${entry.changes.map(c => `
          <div class="change">
            <span><code>${c.prop}</code> <span class="from">${esc(shortValue(c.from))}</span> → <span class="to">${esc(shortValue(c.to))}</span></span>
            <button class="undo-prop" data-id="${entry.id}" data-prop="${c.prop}" title="撤销这一项">×</button>
          </div>`).join('')}
      </div>
    </div>`
  }

  #renderRemoval(r) {
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    // 父元素自己也被删掉（或页面重渲染换掉了整棵树）时，没有可插回的位置
    const restorable = ChangeStore.canRestore(r)
    const detail = [
      r.text || `<${r.tag}>`,
      r.childCount ? `${r.childCount} 个子元素` : '',
    ].filter(Boolean).join(' · ')

    return `<div class="item" data-id="${r.id}" data-kind="removal">
      <div class="item-head">
        <span class="sel" title="${esc(r.anchors.selector)}">${shortSelector(r.anchors)}</span>
        <span class="badge" data-kind="removal">已删除</span>
        <button class="icon-btn restore" data-id="${r.id}"${restorable ? '' : ' disabled'}
          title="${restorable ? '放回原位' : '父元素已不在页面上，放不回去'}">↺</button>
      </div>
      <div class="comment-text">${esc(detail)}</div>
    </div>`
  }

  #renderComment(c) {
    const n = c.images?.length || 0
    const imageTag = n
      ? `<span class="badge" data-kind="image" title="带 ${n} 张参考图">🖼 ${n}</span>`
      : ''

    return `<div class="item" data-id="${c.id}" data-kind="comment">
      <div class="item-head">
        <span class="sel" title="${c.anchors.selector}">${shortSelector(c.anchors)}</span>
        ${imageTag}
        <span class="badge" data-kind="comment">#${c.seq}</span>
        <button class="icon-btn del-comment" data-id="${c.id}" title="删除评论">×</button>
      </div>
      <div class="comment-text">${(c.text || '（仅参考图）').replace(/</g, '&lt;')}</div>
    </div>`
  }

  #elementOf(id, kind) {
    const { edits, comments, removals } = ChangeStore.read()
    if (kind === 'comment') return comments.find(c => c.id === id)?.el
    // 已删除的元素不在 DOM 上，高亮与回跳都会因 isConnected 为假而自然跳过
    if (kind === 'removal') return removals.find(r => r.id === id)?.el
    return edits.find(e => e.id === id)?.el
  }

  // header / footer 的事件只绑一次，它们的节点不会被重建
  #bindStatic() {
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
          (report.removals ? ` + ${report.removals} 处删除` : '') +
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
  }

  // 列表项每次渲染都会重建，事件随之重绑
  #bindItems() {
    const shadow = this.#shadow
    const on = (sel, evt, fn) => shadow.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn))

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

    on('.undo-text', 'click', e => {
      e.stopPropagation()
      ChangeStore.undoText(e.currentTarget.dataset.id)
    })

    on('.undo-attr', 'click', e => {
      e.stopPropagation()
      ChangeStore.undoAttr(e.currentTarget.dataset.id, e.currentTarget.dataset.attr)
    })

    on('.undo-el', 'click', e => {
      e.stopPropagation()
      ChangeStore.undoElement(e.currentTarget.dataset.id)
    })

    on('.restore', 'click', e => {
      e.stopPropagation()
      const ok = ChangeStore.restoreRemoval(e.currentTarget.dataset.id)
      if (!ok) this.dispatchEvent(new CustomEvent('vr-toast', {
        bubbles: true, composed: true,
        detail: { message: '父元素已不在页面上，这个元素放不回去了', kind: 'error' },
      }))
    })

    on('.del-comment', 'click', e => {
      e.stopPropagation()
      ChangeStore.removeComment(e.currentTarget.dataset.id)
    })
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
