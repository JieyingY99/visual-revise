import $ from 'blingblingjs'
import { HandleStyles } from '../styles.store'
import { clamp } from '../../utilities/numbers'

// 计算值形如 'none' / '40px' / '40px 30px'（只设了 x 时 y 会省掉）
const parseTranslate = value => {
  if (!value || value === 'none') return { x: 0, y: 0 }
  const [x = '0', y = '0'] = String(value).trim().split(/\s+/)
  return { x: parseFloat(x) || 0, y: parseFloat(y) || 0 }
}

const shift = (base, dx, dy) => `${base.x + dx}px ${base.y + dy}px`

export class Handle extends HTMLElement {

  constructor() {
    super()
    this.$shadow = this.attachShadow({mode: 'closed'})
    this.styles = [HandleStyles]
  }

  connectedCallback() {
    this.$shadow.adoptedStyleSheets = this.styles
    this.$shadow.innerHTML = this.render()
    
    this.button = this.$shadow.querySelector('button')
    this.button.addEventListener('pointerdown', this.on_element_resize_start.bind(this))

    this.placement = this.getAttribute('placement')
  }

  static get observedAttributes() {
    return ['placement']
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'placement') {
      this.placement = newValue
    }
  }

  on_element_resize_start(e) {
    e.preventDefault()
    e.stopPropagation()

    if (e.button !== 0) return

    const placement = this.placement
    const handlesEl = e.composedPath().find(el => el.tagName === 'VISBUG-HANDLES')
    const nodeLabelId = handlesEl.getAttribute('data-label-id')
    const [sourceEl] = $(`[data-label-id="${nodeLabelId}"]`)

    if (!sourceEl) return

    const { x: initialX, y: initialY } = e
    const initialStyle = getComputedStyle(sourceEl)
    const initialWidth = parseFloat(initialStyle.width)
    const initialHeight = parseFloat(initialStyle.height)
    // 固定对边靠的是位移。写 CSS 独立属性 translate，不写 transform：
    //   · transform 的计算值是 matrix(...)，解析不回来，所以它一直没法进
    //     TRACKED_PROPS——用户拖完看着元素挪了位，导出给 AI 的却只有尺寸；
    //   · 写 transform 是整条覆盖，页面自己的 rotate / scale 会一起没掉。
    // translate 的计算值就是 `40px 30px`，既能被跟踪、导出，也和页面原有的
    // transform 叠加而不是顶掉它。
    //
    // 基数必须读 translate 自己：getComputedStyle().transform 不含独立的
    // translate/rotate/scale，拿 transform 当基数的话，松手再拖第二次会先
    // 跳回原点再重新位移。
    const initialTranslate = parseTranslate(initialStyle.translate)

    // 拖之前的行内值。拖动期间直接写 style（每帧一次，走记录太贵），松手后
    // 把「之前 → 之后」交给 visual-revise 记进 ChangeStore：改动记录靠快照
    // 差异本来就看得见这次改动，但历史栈里没有条目，⌘Z 撤不回来
    const before = {
      width: sourceEl.style.width,
      height: sourceEl.style.height,
      translate: sourceEl.style.translate,
    }

    const originalElTransition = sourceEl.style.transition
    const originalDocumentCursor = document.body.style.cursor
    const originalDocumentUserSelect = document.body.style.userSelect
    sourceEl.style.transition = 'none'
    document.body.style.cursor = getComputedStyle(this).getPropertyValue('--cursor')
    document.body.style.userSelect = 'none'

    document.addEventListener('pointermove', on_element_resize_move)

    function on_element_resize_move(e) {
      e.preventDefault()
      e.stopPropagation()

      const newX = clamp(0, e.clientX, document.documentElement.clientWidth)
      const newY = clamp(0, e.clientY, document.documentElement.clientHeight)
    
      const diffX = newX - initialX
      const diffY = newY - initialY

      switch (placement) {
        case 'top-start': {
          const newWidth = initialWidth - diffX
          const newHeight = initialHeight - diffY
          const t = shift(initialTranslate, diffX, diffY)

          requestAnimationFrame(() => {
            sourceEl.style.width = `${newWidth}px`
            sourceEl.style.height = `${newHeight}px`
            sourceEl.style.translate = t
          })
          break
        }
        case 'top-center': {
          const newHeight = initialHeight - diffY
          const t = shift(initialTranslate, 0, diffY)

          requestAnimationFrame(() => {
            sourceEl.style.height = `${newHeight}px`
            sourceEl.style.translate = t
          })
          break
        }
        case 'top-end': {
          const newWidth = initialWidth + diffX
          const newHeight = initialHeight - diffY
          const t = shift(initialTranslate, 0, diffY)

          requestAnimationFrame(() => {
            sourceEl.style.width = `${newWidth}px`
            sourceEl.style.height = `${newHeight}px`
            sourceEl.style.translate = t
          })
          break
        }
        case 'middle-start': {
          const newWidth = initialWidth - diffX
          const t = shift(initialTranslate, diffX, 0)

          requestAnimationFrame(() => {
            sourceEl.style.width = `${newWidth}px`
            sourceEl.style.translate = t
          })
          break
        }
        case 'middle-end': {
          const newWidth = initialWidth + diffX

          requestAnimationFrame(() => {
            sourceEl.style.width = `${newWidth}px`
          })
          break
        }
        case 'bottom-start': {
          const newWidth = initialWidth - diffX
          const newHeight = initialHeight + diffY
          const t = shift(initialTranslate, diffX, 0)

          requestAnimationFrame(() => {
            sourceEl.style.width = `${newWidth}px`
            sourceEl.style.height = `${newHeight}px`
            sourceEl.style.translate = t
          })
          break
        }
        case 'bottom-center': {
          const newHeight = initialHeight + diffY

          requestAnimationFrame(() => {
            sourceEl.style.height = `${newHeight}px`
          })
          break
        }
        case 'bottom-end': {
          const newWidth = initialWidth + diffX
          const newHeight = initialHeight + diffY

          requestAnimationFrame(() => {
            sourceEl.style.width = `${newWidth}px`
            sourceEl.style.height = `${newHeight}px`
          })
          break
        }
      }
    }

    document.addEventListener('pointerup', on_element_resize_end, { once: true })
    document.addEventListener('mouseleave', on_element_resize_end, { once: true })

    function on_element_resize_end() {
      document.removeEventListener('pointermove', on_element_resize_move)
      document.body.style.cursor = originalDocumentCursor
      document.body.style.userSelect = originalDocumentUserSelect
      sourceEl.style.transition = originalElTransition
      // 最后一帧的写入还排在 rAF 里，等它落地再通知，否则读到的是上一帧的值
      requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('visual-revise:resized', {
        detail: { el: sourceEl, before },
      })))
    }
  }

  disconnectedCallback() {
    this.button.removeEventListener('pointerdown', this.on_element_resize_start.bind(this))
  }

  render() {
    return `
      <button type="button" aria-label="Resize"></button>
    `
  }
}

customElements.define('visbug-handle', Handle)
