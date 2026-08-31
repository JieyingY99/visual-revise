export const GROUPS = [
  {
    id: 'layout',
    label: '布局',
    props: ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'row-gap', 'column-gap', 'order'],
  },
  {
    id: 'size',
    label: '尺寸',
    props: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
  },
  {
    id: 'spacing',
    label: '间距',
    props: [
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    ],
  },
  {
    id: 'position',
    label: '定位',
    props: ['position', 'top', 'right', 'bottom', 'left', 'z-index'],
  },
  {
    id: 'typography',
    label: '文字',
    props: [
      'font-family', 'font-size', 'font-weight', 'line-height',
      'letter-spacing', 'text-align', 'text-transform', 'color',
    ],
  },
  {
    id: 'appearance',
    label: '外观',
    props: ['opacity', 'border-radius', 'overflow'],
  },
  {
    id: 'fill',
    label: '填充',
    props: ['background-color', 'background-image'],
  },
  {
    id: 'stroke',
    label: '描边',
    props: ['border-width', 'border-style', 'border-color'],
  },
  {
    id: 'effects',
    label: '效果',
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
