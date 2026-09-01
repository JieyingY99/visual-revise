// 分区顺序与命名对齐 Figma 的属性面板：
//   Position → Layout → Appearance → Typography → Fill → Stroke → Effects
//
// Typography 的位置是实测 Figma Desktop 得来的：选中文本图层时它插在
// Appearance 与 Fill 之间，而不是排在最后。偏离 Figma 的一处：Figma 只在
// TEXT 图层渲染这个分区，但 CSS 的字体属性会继承，在容器上设 font-size 是
// 常见写法，隐藏它会让「给整张卡片调字号」无法表达。所以这里对所有元素
// 都保留该分区，只在选中文字元素时自动展开（见 props-panel）。
// 位置固定不随选中变动——顺序跳来跳去会毁掉肌肉记忆。
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
      // 「填满容器」在 flex 主轴上写的是它，不跟踪就不会进改动记录。
      // 由 Resizing 控件写入，面板里不单独渲染字段。
      'flex-grow',
      'gap', 'row-gap', 'column-gap',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      'overflow', 'order',
      // 由 Grid 控件写入，面板里不单独渲染字段
      'grid-template-columns', 'grid-template-rows',
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    zh: '外观',
    props: ['opacity', 'border-radius'],
  },
  {
    id: 'typography',
    label: 'Typography',
    zh: '文字',
    // color 不在这里——见下面 fill 分区的说明
    props: [
      'font-family', 'font-size', 'font-weight', 'line-height',
      'letter-spacing', 'text-align', 'text-transform',
    ],
  },
  {
    id: 'fill',
    label: 'Fill',
    zh: '填充',
    // Figma 的 Fill 是「这个图层被什么填充」的多态槽位，实测：文本图层的
    // fills[0] 是 SOLID（就是字色），图片图层的 fills[0] 是 IMAGE。CSS 把
    // 这件事拆成了三条互不相干的属性，所以这里把它们收进同一个分区，由面板
    // 按元素类型决定谁排在最前（见 props-panel 的 fillOrder）。
    //
    // 填充控件同时管 background-color / background-image：Figma 里「一个填充」
    // 是一件事，CSS 里是两件——background-image 画在 background-color 上面。
    widgets: ['fill'],
    // 这里是默认序：背景是大多数元素的主填充。选中文字元素时面板会把 color
    // 提到最前——那时字色才是主填充（见 props-panel 的 fill 分区特判）。
    props: [
      'background-color', 'background-image',
      'background-size', 'background-position',
      // <img> / <video> 自身内容的适配方式，对应 Figma 图片填充的 scaleMode
      'object-fit', 'object-position',
      'color',
    ],
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
