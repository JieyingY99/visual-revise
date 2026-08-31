// 分区顺序与命名对齐 Figma 的属性面板：
//   Position → Layout → Appearance → Fill → Stroke → Effects → Typography
//
// Figma 的 Constraints 在 CSS 里没有对应物——那是画布坐标系里「贴住父框哪条边」
// 的概念，CSS 用的是完全不同的一套机制。这里换成真正决定「元素往哪儿放、
// 压在谁上面」的 position 类型与 z-index。
//
// widgets 是没有单一 CSS 属性可对应的复合控件（对齐按钮组），
// 它写入的仍是 props 里声明过的真实属性，渲染在该分区最前面。
export const GROUPS = [
  {
    id: 'position',
    label: 'Position',
    zh: '定位',
    widgets: ['align'],
    props: [
      'position', 'left', 'top', 'right', 'bottom',
      'z-index', 'rotate',
      // 对齐按钮组写入，面板里不单独渲染字段
      'align-self', 'justify-self',
    ],
  },
  {
    id: 'layout',
    label: 'Layout',
    zh: '布局',
    props: [
      'display',
      'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
      'gap', 'row-gap', 'column-gap',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      'overflow', 'order',
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    zh: '外观',
    props: ['opacity', 'border-radius'],
  },
  {
    id: 'fill',
    label: 'Fill',
    zh: '填充',
    // 填充控件同时管这两条：Figma 里「一个填充」是一件事，
    // CSS 里是两件——background-image 画在 background-color 上面
    widgets: ['fill'],
    props: ['background-color', 'background-image'],
  },
  {
    id: 'stroke',
    label: 'Stroke',
    zh: '描边',
    props: ['border-color', 'border-width', 'border-style', 'box-sizing'],
  },
  {
    id: 'effects',
    label: 'Effects',
    zh: '效果',
    props: ['box-shadow', 'filter', 'backdrop-filter'],
  },
  {
    id: 'typography',
    label: 'Typography',
    zh: '文字',
    props: [
      'font-family', 'font-size', 'font-weight', 'line-height',
      'letter-spacing', 'text-align', 'text-transform', 'color',
    ],
  },
]

export const TRACKED_PROPS = GROUPS.flatMap(g => g.props)

export const PROP_GROUP = TRACKED_PROPS.reduce((acc, prop) => {
  acc[prop] = GROUPS.find(g => g.props.includes(prop)).id
  return acc
}, {})

// 值等价判断：'0px' 与 '0'、'rgb(0,0,0)' 与 'rgb(0, 0, 0)' 视为相同
export const normalizeValue = value => {
  if (value == null) return ''
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/^0px$/, '0')
    .replace(/"/g, "'")
}

export const sameValue = (a, b) => normalizeValue(a) === normalizeValue(b)
