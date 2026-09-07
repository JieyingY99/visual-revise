/**
 * Modified from Project VisBug (https://github.com/GoogleChromeLabs/ProjectVisBug),
 * Copyright Google LLC and its contributors, licensed under the Apache License 2.0.
 *
 * Modifications Copyright 2026 Jieying Yang.
 * This file has been changed from the original. See NOTICE for details.
 */
import $ from 'blingblingjs'
import hotkeys from 'hotkeys-js'

import { preferredNotation } from './color'
import { canMoveLeft, canMoveRight, canMoveUp } from './move'
import { watchImagesForUpload } from './imageswap'
import { queryPage } from './search'
import { createMeasurements, clearMeasurements } from './measurements'
import { createMarginVisual } from './margin'
import { createPaddingVisual } from './padding'

import { showTip as showMetaTip, removeAll as removeAllMetaTips } from './metatip'
import { showTip as showAccessibilityTip, removeAll as removeAllAccessibilityTips } from './accessibility'

import {
  metaKey, createClassname, camelToDash,
  isOffBounds, getStyle, getStyles, deepElementFromPoint, getShadowValues,
  isSelectorValid, findNearestChildElement, findNearestParentElement,
  getTextShadowValues, isFixed, onRemove
} from '../utilities/'

// 直接 import 而不是靠宿主注入：change-store 不 import 任何 features，
// 不会成环（visual-revise.js 就是这么引的）；而 Selectable(visbug) 的构造点
// 在 app/visbug.element.js 里，那里没有任何注入口。
import { ChangeStore } from '../core/change-store.js'
import { isEditorUI } from '../core/dom-utils.js'
import { stripEditorMarks } from '../core/editor-marks.js'

// 绑定与解绑必须共用同一份清单：两处手写会漂移，
// listen/unlisten 成对调用（编辑态与交互态来回切换）时，
// 解绑遗漏的快捷键会在每次 resume 后累积一份处理器。
const HOTKEYS = metaKey => [
  `${metaKey}+alt+c`,
  `${metaKey}+alt+v`,
  'esc',
  `${metaKey}+d`,
  'backspace,del,delete',
  // 'alt+del,alt+backspace' 归 visual-revise.js 的 onKeydown 接管了：
  // 这一键要走 ChangeStore 才进得了历史栈。绑定与解绑共用这份清单，
  // 只删 listen() 里那一行不行——listen/unlisten 往返时会重新绑回来。
  `${metaKey}+e,${metaKey}+shift+e`,
  `${metaKey}+g,${metaKey}+shift+g`,
  'enter,shift+enter',
  `${metaKey}+shift+enter`,
  "shift+'",
].join(',')

export function Selectable(visbug) {
  const page              = document.body
  let selected            = []
  let selectedCallbacks   = []
  let labels              = []
  let handles             = []
  // data-label-id 的发号器，只增不减，见 select()
  let labelSeq            = 0

  const hover_state       = {
    target:   null,
    element:  null,
    label:    null,
  }

  // 这个 feature 拿不到工具条（宿主的 toast 在 visual-revise.js 那边），
  // 冒泡一个 vr-toast 上去由宿主统一渲染
  const toast = (message, kind = 'info') =>
    document.body.dispatchEvent(new CustomEvent('vr-toast', {
      bubbles: true, composed: true, detail: { message, kind },
    }))

  const listen = () => {
    page.addEventListener('click', on_click, true)
    page.addEventListener('dblclick', on_dblclick, true)

    page.on('selectstart', on_selection)
    page.on('mousemove', on_hover)
    document.addEventListener('copy', on_copy)
    document.addEventListener('cut', on_cut)
    document.addEventListener('paste', on_paste)

    watchCommandKey()

    hotkeys(`${metaKey}+alt+c`, on_copy_styles)
    hotkeys(`${metaKey}+alt+v`, e => on_paste_styles())
    hotkeys('esc', on_esc)
    hotkeys(`${metaKey}+d`, on_duplicate)
    hotkeys('backspace,del,delete', on_delete)
    hotkeys(`${metaKey}+e,${metaKey}+shift+e`, on_expand_selection)
    hotkeys(`${metaKey}+g,${metaKey}+shift+g`, on_group)
    hotkeys('enter,shift+enter', on_keyboard_traversal)
    hotkeys(`${metaKey}+shift+enter`, on_select_children)
    hotkeys(`shift+'`, on_select_parent)
  }

  const unlisten = () => {
    page.removeEventListener('click', on_click, true)
    page.removeEventListener('dblclick', on_dblclick, true)

    page.off('selectstart', on_selection)
    page.off('mousemove', on_hover)

    document.removeEventListener('copy', on_copy)
    document.removeEventListener('cut', on_cut)
    document.removeEventListener('paste', on_paste)

    hotkeys.unbind(HOTKEYS(metaKey))
  }

  const on_click = e => {
    // 这一下点击是从编辑器自己的面板里发出来的（在面板里横向拖数值，越过
    // 面板边缘才松手）：click 的 target 仍是面板里那个控件，而下面按坐标
    // 命中的却是松手处的页面元素——选中会被悄悄换掉，用户手上正在改的
    // 元素当场丢失。
    // 只早退这一类，不能把浮在选中元素正上方的 visbug-* 覆盖层一起吃掉：
    // 「同一下点击仍要正常选中页面元素」走的就是那条路。
    const path = e.composedPath?.() || []
    if (!String(path[0]?.tagName || '').startsWith('VISBUG-') && isEditorUI(path)) return

    const $target = deepElementFromPoint(e.clientX, e.clientY)
    // 坐标落在视口外时拿不到元素（拖到边缘、鼠标甩出窗口），当作没命中
    if (!$target) return

    if (isOffBounds($target) && !selected.filter(el => el == $target).length)
      return

    e.preventDefault()
    if (!e.altKey) e.stopPropagation()

    if (!e.shiftKey) {
      unselect_all({silent:true})
      clearMeasurements()
    }

    if(e.shiftKey && $target.hasAttribute('data-selected'))
      unselect($target.getAttribute('data-label-id'))
    else
      select($target)
  }

  const unselect = id => {
    const doomed = [...labels, ...handles]
      .filter(node => node.getAttribute('data-label-id') === id)

    doomed.forEach(node => node.remove())

    // 从两个数组里也把它们摘掉，否则 on_hover / setLabel / createLabel 里那三处
    // `handles.forEach(handle => handle.showPopover())` 会对已经离开 DOM 的节点
    // 调用 showPopover，抛「Invalid on disconnected popover elements」——
    // 异常打断的是「把手提升到 top layer」那一整段，此后每次 hover 都炸一次。
    //
    // 按元素引用剔除，不留 null 槽位：labels 与 handles 不是平行数组
    // （createLabel 只在 no_label === false 时才建），下标对不上；而显式 null
    // 会被 forEach 访问到，也会让上面这句 node.getAttribute 直接 TypeError。
    // 压缩数组不再有撞号风险——data-label-id 已改用单调递增计数器发号。
    labels  = labels.filter(node => !doomed.includes(node))
    handles = handles.filter(node => !doomed.includes(node))

    selected.filter(node =>
      node.getAttribute('data-label-id') === id)
      .forEach(node =>
        $(node).attr({
          'data-selected':      null,
          'data-selected-hide': null,
          'data-label-id':      null,
          'data-pseudo-select':         null,
          'data-measuring':     null,
          'data-outward':       null,
      }))

    selected = selected.filter(node => node.getAttribute('data-label-id') !== id)

    tellWatchers()
  }

  const on_dblclick = e => {
    e.preventDefault()
    e.stopPropagation()
    if (isOffBounds(e.target)) return
    visbug.toolSelected('text')
  }

  const watchCommandKey = e => {
    let did_hide = false

    document.onkeydown = function(e) {
      if (hotkeys.ctrl && selected.length) {
        $('visbug-handles, visbug-label, visbug-hover, visbug-grip').forEach(el =>
          el.style.display = 'none')

        did_hide = true
      }
    }

    document.onkeyup = function(e) {
      if (did_hide) {
        $('visbug-handles, visbug-label, visbug-hover, visbug-grip').forEach(el =>
          el.style.display = null)

        did_hide = false
      }
    }
  }

  const on_esc = _ =>
    unselect_all()

  const on_duplicate = e => {
    const root_node = selected[0]
    if (!root_node) return

    // 只摘 data-selected 不够：data-label-id 会跟着副本留在页面上，
    // 和之后某个选中项撞号，缩放把手按 `[data-label-id="N"]` 取目标时
    // 就会去改这个副本。整棵子树一并剥干净。
    const deep_clone = stripEditorMarks(root_node.cloneNode(true))
    root_node.parentNode.insertBefore(deep_clone, root_node.nextSibling)
    e.preventDefault()
  }

  const on_delete = e =>
    selected.length && delete_all()

  // ⌥Delete / ⌥Backspace（清空 inline style）已由 visual-revise.js 的 onKeydown
  // 接管：那一键要逐条走 ChangeStore.applyProp 才进得了历史栈，⌘Z 才救得回来。
  // 上游这里原本是 `el.attr('style', null)`，.attr 是 blingblingjs 用
  // Object.assign 挂在实例上的糖，注入之后才出现的元素身上根本没有它。

  const on_copy = async e => {
    // if user has selected text, dont try to copy an element
    if (window.getSelection().toString().length)
      return

    if (selected[0] && window.node_clipboard !== selected[0]) {
      e.preventDefault()
      // 编辑器的内部记号一个都不能跟着 outerHTML 走出去，见 stripEditorMarks
      const $node = stripEditorMarks(selected[0].cloneNode(true))

      window.copy_backup = $node.outerHTML
      e.clipboardData.setData('text/html', window.copy_backup)

      const {state} = await navigator.permissions.query({name:'clipboard-write'})

      if (state === 'granted')
        await navigator.clipboard.writeText(window.copy_backup)
    }
  }

  const on_cut = e => {
    if (selected[0] && window.node_clipboard !== selected[0]) {
      const $node = stripEditorMarks(selected[0].cloneNode(true))
      window.copy_backup = $node.outerHTML
      e.clipboardData.setData('text/html', window.copy_backup)

      // 走 ChangeStore 而不是 selected[0].remove()：同一个「删元素」动作，
      // Delete 键有账、⌘X 没有的话，用户剪掉一块内容，导出给 AI 的提示词里
      // 一个字都看不到，记录里也没有任何入口能把它放回来。
      // 顺带从「只删 selected[0]」扩成删掉全部选中——上游漏的那半。
      const targets = selected.filter(el => el?.isConnected)
      unselect_all()
      ChangeStore.removeElements(targets)
    }
  }

  // 剪贴板 HTML 前面常带换行 / 空白，body.firstChild 会是文本节点——
  // 那种节点进不了 insertElement 的守卫，会静默地什么都不发生
  const parsePasted = html =>
    new DOMParser().parseFromString(String(html || ''), 'text/html').body.firstElementChild

  const on_paste = async e => {
    const clipData = e.clipboardData.getData('text/html')

    // 上游这里是无条件 await navigator.clipboard.readText()：没权限时 promise
    // reject，整个处理器当场中断，连 e.clipboardData 那条已经拿到的都用不上
    let globalClipboard = ''
    try {
      globalClipboard = await navigator.clipboard.readText()
    } catch (err) {
      globalClipboard = ''
    }

    const potentialHTML = clipData || globalClipboard || window.copy_backup
    if (!selected.length) return

    if (!potentialHTML) {
      toast('读不到剪贴板内容，请检查剪贴板权限', 'error')
      return
    }

    e.preventDefault()

    // 每个目标各粘一份（上游行为），但走 ChangeStore：新增的元素要进改动记录、
    // 能一次 ⌘Z 退回、也要在导出的提示词里说清「请新建这个元素」
    const targets = [...selected]
    ChangeStore.history.batch(
      targets.length > 1 ? `粘贴到 ${targets.length} 个元素里` : '粘贴元素',
      () => targets.forEach(el => {
        const node = parsePasted(potentialHTML)
        if (node) ChangeStore.insertElement(node, el, null, '粘贴元素')
      }))
  }

  const on_copy_styles = async e => {
    e.preventDefault()

    window.copied_styles = selected.map(el =>
      getStyles(el))

    try {
      const colormode = $('vis-bug').attr('color-mode')

      const styles = window.copied_styles[0]
        .map(({prop,value}) => {
          if (prop.includes('color') || prop.includes('background-color') || prop.includes('border-color') || prop.includes('Color') || prop.includes('fill') || prop.includes('stroke'))
            value = preferredNotation(value, colormode)

          if (prop.includes('boxShadow')) {
            const [, color, x, y, blur, spread] = getShadowValues(value)
            value = `${preferredNotation(color, colormode)} ${x} ${y} ${blur} ${spread}`
          }

          if (prop.includes('textShadow')) {
            const [, color, x, y, blur] = getTextShadowValues(value)
            value = `${preferredNotation(color, colormode)} ${x} ${y} ${blur}`
          }
          return {prop,value}
        })
        .reduce((message, item) =>
          [...message, `${camelToDash(item.prop)}: ${item.value};`]
        , []).join('\n')

      const {state} = await navigator.permissions.query({name:'clipboard-write'})

      if (styles && state === 'granted') {
        await navigator.clipboard.writeText(styles)
      }
    } catch(e) {
      console.warn(e)
    }
  }

  const on_paste_styles = async (e, index = 0) => {
    if (window.copied_styles) {
      selected.forEach(el => {
        window.copied_styles[index]
          .map(({prop, value}) =>
            el.style[prop] = value)

        index >= window.copied_styles.length - 1
          ? index = 0
          : index++
      })
    }
    else {
      const potentialStyles = await navigator.clipboard.readText()

      if (selected.length && potentialStyles)
        selected.forEach(el =>
          el.style = potentialStyles)
    }
  }

  const on_expand_selection = (e, {key}) => {
    e.preventDefault()

    const [root] = selected
    if (!root) return

    const query = combineNodeNameAndClass(root)

    if (isSelectorValid(query))
      expandSelection({
        query,
        all: key.includes('shift'),
      })
  }

  // 分组 / 取消分组改了 DOM 结构，跟删除、移动是同一类操作，必须一样入账：
  // 上游那两段只用原生 DOM API，改完的结构在导出的提示词里一个字都没有，
  // ⌘Z 反而会去撤销更早的一条无关操作。
  // 「一次插入 + n 次移动」的记录语义收在 ChangeStore 里（见 groupElements），
  // 这里只负责选中集的进出。
  const on_group = (e, {key}) => {
    e.preventDefault()

    if (key.split('+').includes('shift')) {
      const wrappers = selected.filter(el => el?.isConnected)
      if (!wrappers.length) return

      unselect_all()
      wrappers
        .flatMap(wrapper => ChangeStore.ungroupElement(wrapper) || [])
        .filter(node => node.isConnected)
        .forEach(node => select(node))
      return
    }

    const targets = selected.filter(el => el?.isConnected)
    if (!targets.length) return

    unselect_all()
    const wrapper = ChangeStore.groupElements(targets)
    if (wrapper) select(wrapper)
  }

  const on_selection = e =>
    !isOffBounds(e.target)
    && selected.length
    && selected[0].textContent != e.target.textContent
    && e.preventDefault()

  const on_keyboard_traversal = (e, {key}) => {
    if (!selected.length) return

    e.preventDefault()
    e.stopPropagation()

    const targets = selected.reduce((flat_n_unique, node) => {
      const element_to_left     = canMoveLeft(node)
      const element_to_right    = canMoveRight(node)
      const has_parent_element  = findNearestParentElement(node)
      const has_child_elements  = findNearestChildElement(node)

      if (key.includes('shift')) {
        if (key.includes('tab') && element_to_left)
          flat_n_unique.add(element_to_left)
        else if (key.includes('enter') && has_parent_element)
          flat_n_unique.add(has_parent_element)
        else
          flat_n_unique.add(node)
      }
      else {
        if (key.includes('tab') && element_to_right)
          flat_n_unique.add(element_to_right)
        else if (key.includes('enter') && has_child_elements)
          flat_n_unique.add(has_child_elements)
        else
          flat_n_unique.add(node)
      }

      return flat_n_unique
    }, new Set())

    if (targets.size) {
      unselect_all({silent:true})
      targets.forEach(node => {
        select(node)
        show_tip(node)
      })
    }
  }

  const show_tip = el => {
    const active_tool = visbug.activeTool
    let tipFactory

    if (active_tool === 'accessibility') {
      removeAllAccessibilityTips()
      tipFactory = showAccessibilityTip
    }
    else if (active_tool === 'inspector') {
      removeAllMetaTips()
      tipFactory = showMetaTip
    }

    if (!tipFactory) return

    const {top, left} = el.getBoundingClientRect()
    const { pageYOffset, pageXOffset } = window

    tipFactory(el, {
      clientY:  top,
      clientX:  left,
      pageY:    pageYOffset + top - 10,
      pageX:    pageXOffset + left + 20,
    })
  }

  const on_hover = e => {
    const $target = deepElementFromPoint(e.clientX, e.clientY)
    // 同上：拿不到元素就不算命中
    if (!$target) return
    const tool = visbug.activeTool

    if (isOffBounds($target) || $target.hasAttribute('data-selected') || $target.hasAttribute('draggable')) {
      clearMeasurements()
      return clearHover()
    }

    overlayHoverUI({
      el: $target,
      // no_hover: tool === 'guides',
      no_label:
           (tool === 'guides'
        || tool === 'accessibility'
        || tool === 'margin'
        || tool === 'padding'
        || tool === 'inspector'),
    })

    if (tool === 'guides' && selected.length >= 1 && !selected.includes($target)) {
      $target.setAttribute('data-measuring', true)
      const [$anchor] = selected
      createMeasurements({$anchor, $target})
    }
    else if (tool === 'margin' && !hover_state.element.$shadow.querySelector('visbug-boxmodel')) {
      hover_state.element.$shadow.appendChild(
        createMarginVisual(hover_state.target, true))
    }
    else if (tool === 'padding' && !hover_state.element.$shadow.querySelector('visbug-boxmodel')) {
      hover_state.element.$shadow.appendChild(
        createPaddingVisual(hover_state.target, true))
    }
    else if ($target.hasAttribute('data-measuring') || selected.includes($target)) {
      clearMeasurements()
    }

    // force promote into top layer
    if (tool === 'guides') {
      handles.forEach(handle => {
        handle.hidePopover &&  handle.hidePopover()
        handle.showPopover && handle.showPopover()
      })
    }
  }

  const select = el => {
    // 发号用单调递增计数器，不再用 handles.length：unselect_all 会把数组清空，
    // 下一个选中项又从 0 开始发号，和页面上还留着旧编号的节点（⌘D 副本、
    // ⌘V 粘进来的副本）撞车——缩放把手按 `[data-label-id="N"]` 取拖动目标，
    // 撞号时它取的是文档顺序靠前的那个，于是去改了另一个元素。
    const id = ++labelSeq
    const tool = visbug.activeTool

    el.setAttribute('data-selected', true)
    el.setAttribute('data-label-id', id)

    clearHover()

    overlayMetaUI({
      el,
      id,
      no_label: 
           tool === 'inspector' 
        || tool === 'guides' 
        || tool === 'margin' 
        || tool === 'move' 
        || tool === 'accessibility',
    })

    $('visbug-metatip, visbug-ally').forEach(tip => {
      tip.hidePopover && tip.hidePopover()
      tip.showPopover && tip.showPopover()
    })

    selected.unshift(el)
    tellWatchers()
  }

  const selection = () =>
    selected

  const unselect_all = ({silent = false} = {}) => {
    selected
      .forEach(el =>
        $(el).attr({
          'data-selected':      null,
          'data-selected-hide': null,
          'data-label-id':      null,
          'data-pseudo-select': null,
          'data-outward':       null,
        }))

    $('[data-pseudo-select]').forEach(hover =>
      hover.removeAttribute('data-pseudo-select'))

    Array.from([
      ...$('visbug-handles'),
      ...$('visbug-label'),
      ...$('visbug-hover'),
      ...$('visbug-distance'),
    ]).forEach(el =>
      el.remove())

    labels    = []
    handles   = []
    selected  = []

    !silent && tellWatchers()
  }

  const delete_all = () => {
    const selected_after_delete = selected.map(el => {
      if (canMoveRight(el))     return canMoveRight(el)
      else if (canMoveLeft(el)) return canMoveLeft(el)
      else if (el.parentNode)   return el.parentNode
    })

    Array.from([...selected, ...labels, ...handles]).forEach(el =>
      el.remove())

    labels    = []
    handles   = []
    selected  = []

    selected_after_delete.forEach(el =>
      select(el))
  }

  const expandSelection = ({query, all = false}) => {
    if (all) {
      const unselecteds = $(query + ':not([data-selected])')
      unselecteds.forEach(select)
    }
    else {
      const potentials = $(query)
      if (!potentials) return

      const [anchor] = selected
      const root_node_index = potentials.reduce((index, node, i) =>
        node == anchor
          ? index = i
          : index
      , null)

      if (root_node_index !== null) {
        if (!potentials[root_node_index + 1]) {
          const potential = potentials.filter(el => !el.attr('data-selected'))[0]
          if (potential) select(potential)
        }
        else {
          select(potentials[root_node_index + 1])
        }
      }
    }
  }

  const combineNodeNameAndClass = node =>
    `${node.nodeName.toLowerCase()}${createClassname(node)}`

  const overlayHoverUI = ({el, no_hover = false, no_label = true}) => {
    if (hover_state.target === el) return
    hover_state.target = el

    hover_state.element = no_hover
      ? null
      : createHover(el)

    hover_state.label   = no_label
      ? null
      : createHoverLabel(el, handleLabelText(el, visbug.activeTool))
  }

  const clearHover = () => {
    if (!hover_state.target) return

    hover_state.element && hover_state.element.remove()
    hover_state.label && hover_state.label.remove()

    hover_state.target  = null
    hover_state.element = null
    hover_state.label   = null
  }

  const overlayMetaUI = ({el, id, no_label = true}) => {
    let handle = createHandle({el, id})
    let label  = no_label
      ? null
      : createLabel({
          el,
          id,
          template: handleLabelText(el, visbug.activeTool)
        })

    let observer        = createObserver(el, {handle,label})
    let parentObserver  = createObserver(el, {handle,label})

    observer.observe(el, { attributes: true })
    parentObserver.observe(el.parentNode, { childList:true, subtree:true })

    if (label !== null) {
      onRemove(label, () => {
        observer.disconnect()
        parentObserver.disconnect()
      })
    }
  }

  const setLabel = (el, label) => {
    label.text = handleLabelText(el, visbug.activeTool)
    label.update = {boundingRect: el.getBoundingClientRect(), isFixed: isFixed(el)}

    handles.forEach(handle => {
      handle.hidePopover && handle.hidePopover()
      handle.showPopover && handle.showPopover()
    })
  }

  // id 现在是单调递增的，每次 select 都是新号，不必再用 `!labels[id]` 去重——
  // 那条守卫原本靠「id === 数组下标」成立，改用计数器之后下标早已对不上
  const createLabel = ({el, id, template}) => {
    const label = document.createElement('visbug-label')

    label.text = template
    label.position = {
      boundingRect:   el.getBoundingClientRect(),
      node_label_id:  id,
      isFixed: isFixed(el),
    }

    document.body.appendChild(label)

    $(label).on('query', ({detail}) => {
      if (!detail.text) return

      queryPage('[data-pseudo-select]', el =>
        el.removeAttribute('data-pseudo-select'))

      queryPage(detail.text + ':not([data-selected])', el =>
        detail.activator === 'mouseenter'
          ? el.setAttribute('data-pseudo-select', true)
          : select(el))
    })

    $(label).on('mouseleave', e => {
      e.preventDefault()
      e.stopPropagation()
      queryPage('[data-pseudo-select]', el =>
        el.removeAttribute('data-pseudo-select'))
    })

    labels[labels.length] = label

    handles.forEach(handle => {
      handle.hidePopover && handle.hidePopover()
      handle.showPopover && handle.showPopover()
    })

    return label
  }

  const createHandle = ({el, id}) => {
    const handle = document.createElement('visbug-handles')

    handle.position = { el, node_label_id: id }

    document.body.appendChild(handle)

    handles[handles.length] = handle
    return handle
  }

  const createHover = el => {
    if (!el.hasAttribute('data-pseudo-select') && !el.hasAttribute('data-label-id')) {
      if (hover_state.element)
        hover_state.element.remove()

      hover_state.element = document.createElement('visbug-hover')
      document.body.appendChild(hover_state.element)
      hover_state.element.position = {el}

      return hover_state.element
    }
  }

  const createHoverLabel = (el, text) => {
    if (!el.hasAttribute('data-pseudo-select') && !el.hasAttribute('data-label-id')) {
      if (hover_state.label)
        hover_state.label.remove()

      hover_state.label = document.createElement('visbug-label')
      document.body.appendChild(hover_state.label)

      hover_state.label.text = text
      hover_state.label.position = {
        boundingRect:   el.getBoundingClientRect(),
        node_label_id:  'hover',
      }

      hover_state.label.style.setProperty(`--label-bg`, `hsl(267, 100%, 58%)`)


      return hover_state.label
    }
  }

  const createCorners = el => {
    if (!el.hasAttribute('data-pseudo-select') && !el.hasAttribute('data-label-id')) {
      if (hover_state.element)
        hover_state.element.remove()

      hover_state.element = document.createElement('visbug-corners')
      document.body.appendChild(hover_state.element)
      hover_state.element.position = {el}

      return hover_state.element
    }
  }

  const setHandle = (el, handle) => {
    handle.position = {
      el,
      node_label_id:  el.getAttribute('data-label-id'),
    }
  }

  const createObserver = (node, {label,handle}) =>
    new MutationObserver(list => {
      label && setLabel(node, label)
      handle && setHandle(node, handle)
    })

  const onSelectedUpdate = (cb, immediateCallback = true) => {
    selectedCallbacks.push(cb)
    if (immediateCallback) cb(selected)
  }

  const removeSelectedCallback = cb =>
    selectedCallbacks = selectedCallbacks.filter(callback => callback != cb)

  const tellWatchers = () =>
    selectedCallbacks.forEach(cb => cb(selected))

  const disconnect = () => {
    unselect_all()
    unlisten()
  }

  const on_select_children = (e, {key}) => {
    const targets = selected
      .filter(node => node.children.length)
      .reduce((flat, {children}) =>
        [...flat, ...Array.from(children)], [])

    if (targets.length) {
      e.preventDefault()
      e.stopPropagation()

      unselect_all()
      targets.forEach(node => select(node))
    }
  }

  const on_select_parent = (e, {key}) => {
    const targets = selected.reduce((parents, node) => {
      const parent_element = node.parentElement;

      if (parent_element.hasAttribute('data-outward'))
        return parents

      parent_element.setAttribute('data-outward', true)
      parents.push(parent_element)

      return parents
    }, [])

    if (targets.length) {
      e.preventDefault()
      e.stopPropagation()

      targets.forEach(node => {
        if (node && node !== document.body) {
          select(node)
        }
      })
    }
  }

  watchImagesForUpload()
  listen()

  return {
    select,
    selection,
    unselect_all,
    onSelectedUpdate,
    removeSelectedCallback,
    disconnect,
    pause:  unlisten,
    resume: listen,
  }
}

export const handleLabelText = (el, activeTool) => {
  switch(activeTool) {
    case 'align':
      return getStyle(el, 'display')

    default:
      return `
        <a node>${el.nodeName.toLowerCase()}</a>
        <a>${el.id && '#' + el.id}</a>
        ${createClassname(el).split('.')
          .filter(name => name != '')
          .reduce((links, name) => `
            ${links}
            <a>.${name}</a>
          `, '')
        }
      `
  }
}
