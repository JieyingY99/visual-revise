/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
import { ChangeStore } from '../../core/change-store.js'
import { highlight, clearHighlight } from '../../core/highlight.js'
import { downloadJSON, pickAndImport } from '../../core/json-io.js'
import { containScroll } from '../../core/dom-utils.js'
import { fileNameOf, parseCssUrl } from '../../core/image-source.js'
import { default as list_css } from './change-list.element.css'


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

// 记录还在、元素没了。这条必须看得见——静默丢弃正是「标注被清空」的成因。
// fighting 是另一回事：页面一直把删掉的元素渲染回来，我们已经停手了。
const GONE_BADGE = rec =>
  rec.fighting  ? '<span class="badge" data-kind="gone" title="页面持续把它渲染回来，已停止重复删除">页面在还原</span>'
  : rec.orphaned ? '<span class="badge" data-kind="gone" title="元素已从页面上消失，改动仍保留在记录里">元素已消失</span>'
  : ''

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
    // inserts 是后加的第五种记录（分组 / 粘贴造出来的新元素）。给它一个 [] 默认值，
    // 这样在还没有这种记录的版本上也不会整块渲染不出来
    const { edits, comments, removals, moves, inserts = [] } = ChangeStore.read()
    const stats = ChangeStore.stats()

    // 「配置」这一栏原本漏算了换图与删除，数字对不上列表里的条数
    const label = {
      all:     `全部 ${stats.total}`,
      style:   `配置 ${stats.props + stats.texts + stats.attrs + stats.removals + stats.moves + (stats.inserts || 0)}`,
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
      // 新增、移动和删除都是结构改动，归在「配置」这一栏。
      // 新增排在移动前面：分组是「先造 wrapper 再把子元素搬进去」，
      // 按这个顺序读下来才讲得通
      ...(showStyles ? inserts.map(i => this.#renderInsert(i)) : []),
      ...(showStyles ? moves.map(m => this.#renderMove(m)) : []),
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

    return `<div class="item" data-id="${entry.id}" data-kind="style"${entry.orphaned ? ' data-orphaned' : ''}>
      <div class="item-head">
        <span class="sel" title="${entry.anchors.selector}">${shortSelector(entry.anchors)}</span>
        ${GONE_BADGE(entry)}
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

    return `<div class="item" data-id="${r.id}" data-kind="removal"${r.fighting ? ' data-fighting' : ''}>
      <div class="item-head">
        <span class="sel" title="${esc(r.anchors.selector)}">${shortSelector(r.anchors)}</span>
        ${GONE_BADGE(r)}
        <span class="badge" data-kind="removal">已删除</span>
        <button class="icon-btn restore" data-id="${r.id}"${restorable ? '' : ' disabled'}
          title="${restorable ? '放回原位' : '父元素已不在页面上，放不回去'}">↺</button>
      </div>
      <div class="comment-text">${esc(detail)}</div>
    </div>`
  }

  // 分组 / 粘贴造出来的新元素。它在原页面里根本不存在，所以既没有「改了什么」
  // 可列，也不该显示成「已删除」——用户要认的是「加了个什么」和「加在哪儿」。
  #renderInsert(r) {
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

    // 位置照 move 那条的写法说人话：有 nextAnchors 就是「插在谁前面」，
    // atEnd 就是「放在容器末尾」
    const parent = r.parentAnchors ? shortSelector(r.parentAnchors) : '（容器已失联）'
    const where = r.atEnd || !r.nextAnchors
      ? `放在 ${esc(parent)} 末尾`
      : `插在 ${esc(parent)} 里的 ${esc(shortSelector(r.nextAnchors))} 之前`

    // outerHTML 可以是整棵子树，列表里只留开头一截够认出是什么
    const html = String(r.html ?? '').replace(/\s+/g, ' ').trim()
    const brief = html.length > 60 ? html.slice(0, 60) + '…' : html

    return `<div class="item" data-id="${esc(r.id)}" data-kind="insert"${r.orphaned ? ' data-orphaned' : ''}>
      <div class="item-head">
        <span class="sel" title="${esc(brief)}">${esc(brief) || '新元素'}</span>
        ${GONE_BADGE(r)}
        <span class="badge" data-kind="insert">${esc(r.label || '新增元素')}</span>
        <button class="icon-btn remove-insert" data-id="${esc(r.id)}"
          title="移除这个新增的元素">↺</button>
      </div>
      <div class="comment-text">${where}</div>
    </div>`
  }

  #renderMove(m) {
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    // 「搬到哪儿了」才是用户要认的东西——一条只写元素名的记录，
    // 和它旁边那条样式改动长得一模一样
    const to = m.toParentAnchors ? shortSelector(m.toParentAnchors) : '（容器已失联）'
    const back = ChangeStore.canMoveBack(m)

    return `<div class="item" data-id="${esc(m.id)}" data-kind="move"${m.orphaned ? ' data-orphaned' : ''}>
      <div class="item-head">
        <span class="sel" title="${esc(m.anchors.selector)}">${shortSelector(m.anchors)}</span>
        ${GONE_BADGE(m)}
        <span class="badge" data-kind="move">已移动</span>
        <button class="icon-btn move-back" data-id="${esc(m.id)}"${back ? '' : ' disabled'}
          title="${back ? '搬回原来的位置' : '原来的容器已不在页面上，搬不回去'}">↺</button>
      </div>
      <div class="comment-text">移动到 ${esc(to)} 里</div>
    </div>`
  }

  #renderComment(c) {
    const n = c.images?.length || 0
    const imageTag = n
      ? `<span class="badge" data-kind="image" title="带 ${n} 张参考图">🖼 ${n}</span>`
      : ''

    return `<div class="item" data-id="${c.id}" data-kind="comment"${c.orphaned ? ' data-orphaned' : ''}>
      <div class="item-head">
        <span class="sel" title="${c.anchors.selector}">${shortSelector(c.anchors)}</span>
        ${GONE_BADGE(c)}
        ${imageTag}
        <span class="badge" data-kind="comment">#${c.seq}</span>
        <button class="icon-btn del-comment" data-id="${c.id}" title="删除评论">×</button>
      </div>
      <div class="comment-text">${(c.text || '（仅参考图）').replace(/</g, '&lt;')}</div>
    </div>`
  }

  #elementOf(id, kind) {
    const { edits, comments, removals, moves, inserts = [] } = ChangeStore.read()
    if (kind === 'comment') return comments.find(c => c.id === id)?.el
    // 已删除的元素不在 DOM 上，高亮与回跳都会因 isConnected 为假而自然跳过
    if (kind === 'removal') return removals.find(r => r.id === id)?.el
    if (kind === 'move') return moves.find(m => m.id === id)?.el
    if (kind === 'insert') return inserts.find(i => i.id === id)?.el
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
          (report.moves ? ` + ${report.moves} 处移动` : '') +
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

    // 走既有的 removeElements：那条路对「本会话新增的元素」是把 insert 记录对消掉
    // （原页面里它从来不存在，记一条「删除的元素」会给下游一条执行不了的指令）
    on('.remove-insert', 'click', e => {
      e.stopPropagation()
      const el = this.#elementOf(e.currentTarget.dataset.id, 'insert')
      if (el) ChangeStore.removeElements([el])
    })

    on('.move-back', 'click', e => {
      e.stopPropagation()
      const ok = ChangeStore.moveBack(e.currentTarget.dataset.id)
      if (!ok) this.dispatchEvent(new CustomEvent('vr-toast', {
        bubbles: true, composed: true,
        detail: { message: '原来的容器已不在页面上，这个元素搬不回去了', kind: 'error' },
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
