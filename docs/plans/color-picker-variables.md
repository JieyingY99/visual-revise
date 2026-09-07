# 颜色选择器的「Custom | 变量」两页 + 文字属性只给文字元素 + `!important` 写入（v3）

> 关联：需求见 `../PRD.md` §6（AC-6.24 系列、新增 AC-6.31–6.35）；变量绑定的判定逻辑见 `app/core/cascade.js`；
> v1 / v2 的评审见 [color-picker-variables.review.md](color-picker-variables.review.md)（13 + 11 条必改全部吸收进本版，**评审文件里的「代码事实」段落是实施时的约束**）；
> 上一份方案 `cross-container-reorder.md`（同样的 plan → review → 执行 → 验收流程）。
> 本方案涉及的控件在全量功能清单里的位置：[feature-inventory.md](feature-inventory.md) §2.11（变量绑定）、§3.4–3.6（色盘 / 填充弹层）——实施完成后要回写这两处。

## 0. 用户原话（2026-09-07）

> 这个颜色选择器没办法选择 CSS 颜色变量。我需要你在所有的颜色选择器上都加上
> `Custom` 跟 `变量`（替换掉 Figma 的 Libraries）这两个选项：点 Custom 就是现在的
> 颜色选择器，点变量就展示变量 panel。填充的选择器也是，上面要加一行 Custom 跟 variable。
>
> 我选中什么元素就应该只展示这个元素对应的 properties，不要显示子元素的。
> 选中一个 div，这个 div 没有文字色这个 property，就不该出现文字色。
>
> 选中文字的时候，点击 unlink 文字色的 variable 没有反应。

已确认的三个决定：Typography 分区同样只在元素直接含文字时显示；在「变量」页选中
一个变量后弹层关闭；打开弹层时按当前状态停页（已绑定 → 变量页并勾着当前项，
否则 Custom）。

## 1. 现状与根因

| 现象 | 根因 |
|---|---|
| 色盘里选不了变量 | 变量只有一个入口：Fill / Stroke 标题栏的「绑定变量」按钮弹 `openMenu` 菜单。`vr-color` / `vr-fill` 本身不知道变量的存在 |
| unlink 没反应 | `.wall-line { color: var(--role-text) !important }`。`#unlink` 把解析色写进 inline，inline 不带 `!important` 压不过样式表；画面不变、`#varBinding` 仍判成绑定。**不只 unlink**：面板对这条属性的任何写入都静默失败，眼睛按钮（`#toggleSection` / `#toggleLayer` / `#toggleTextColor`）也一样 |
| 容器上出现文字属性 | 「文字色」行已按 `isTextElement`（元素自己有非空白文本节点）渲染；**Typography 分区对所有元素都渲染**（默认折叠） |
| 变量列表可能是空的 | `cssVariables()`（`resizing.js:220`）只扫每张表**顶层**的 `:root` / `html` 规则：`@layer` / `@media` / `@supports` / `adoptedStyleSheets` / 容器作用域（`.theme-dark { --x }`）全部漏掉。`cascade.js` 的遍历是完整的，两套口径 |
| 填充层的绑定活不过一次编辑 | `#writeFillLayers → #writeBackground` 每次用 `serializeFills(parseFills(computed))` 整体重写 `background-color` + `background-image`，`var()` 被写回解析色；隐藏层的侧存储（`props-panel:1133`）只留 `kind` / `value` 两个字段 |

## 2. 方案

执行顺序（依赖关系）：2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8。

### 2.1 `!important` 写入（`change-store.js`、`history.js`、`snapshot.js`、`prompt-export.js`、`json-io.js`）

**判定放在 `applyProp`，按 `(el, prop)` 算一次并缓存在 track 快照上，存进历史记录；`writeProp` 只做落地。**

```js
// change-store.js
const writeProp = (el, prop, value, important = false) => {
  value === '' ? el.style.removeProperty(prop)
               : el.style.setProperty(prop, value, important ? 'important' : '')
}

// 这条属性要不要带 important：样式表里的赢家是 important，或 inline 已经是 important。
// winningDeclaration 把 inline 也放进层叠比较，所以一次调用两种情况都覆盖；
// 结果缓存在 track(el) 的快照上（snap.sheetImportant: Map<prop, boolean>），
// 拖动时每帧一次写入不再跑全表 el.matches。
const needsImportant = (el, prop) => {
  const snap = snapshots.get(el)
  const cache = snap.sheetImportant ??= new Map()
  if (!cache.has(prop)) cache.set(prop, !!winningDeclaration(el, prop)?.important)
  return cache.get(prop) || el.style.getPropertyPriority(prop) === 'important'
}

const applyProp = (el, prop, value, { important: forced } = {}) => {
  track(el)
  const before = el.style.getPropertyValue(prop)
  const beforeImportant = el.style.getPropertyPriority(prop) === 'important'
  const after = value == null ? '' : String(value)
  const afterImportant = forced ?? needsImportant(el, prop)
  if (before === after && beforeImportant === afterImportant) return
  writeProp(el, prop, after, afterImportant)
  history.push({ kind: 'prop', el, prop, before, after, beforeImportant, afterImportant }, prop)
  notify()
}
```

- **不能**用 `before === ''` 当「要不要问层叠」的代理：页面自己写了 inline（不带 important）+ 样式表 important 的元素（`<p style="color:red">` + `.x { color: blue !important }`）会永远算不出 important。
- `applyOp(op, dir)`：`dir === 'undo'` 用 `before` + `beforeImportant`，否则 `after` + `afterImportant`。重放不再依赖当时的样式表。
- `history.js:43` 的合并分支同时更新 `last.ops[0].afterImportant = ops[0].afterImportant`（`before` / `beforeImportant` 保留最早那次）。
- `readInline`（`snapshot.js:80`）返回并行的 `important: Set<prop>`（或 `{ value, important }`，实现时二选一并全仓统一）；`captureLive` 原样透传；`replayOnto`（`change-store.js:509`）按它调 `writeProp(el, prop, value, important)`。`reconcile` 本身不碰 `writeProp`，不用改。
- `captureAll` / `restoreAll` 存的是整串 cssText（天然带 priority，还能还原未跟踪属性）——**不改**。`revertProp`（`snapshot.js:211`）已用探针的 `getPropertyPriority` 还原——**不改**。
- `diffSnapshot`（`snapshot.js:133`）的比较口径加上 important：值不变、只翻转 important 也算一条改动；产出的 change 记录加 `important: true` 字段，**不拼进 value 字符串**。
- 三处「存原文再写回」的眼睛按钮（`#toggleSection:2032` / `#toggleLayer:1215` / `#toggleTextColor:1256`）的 restore 结构改成 `{ value, important }`，写回时 `applyProp(el, p, value, { important })`。
- `prompt-export.js`：单条属性行渲染成 `prop: value !important`；`collapseShorthand` 只在四条都不带 important 时折叠，否则逐条输出。
- `json-io.js`：导出带 `important` 字段；导入 `ChangeStore.applyProp(el, prop, value, { important })`。`SCHEMA_VERSION` 升到 4，**`SUPPORTED` 同时加 4**；读旧版本时 `important` 缺省 false。`tests-e2e/acceptance-export.mjs:152` 与 `advanced.mjs:121` 的 `schema === 3` 断言改成 4。
- `#unlink` 的逻辑不动：`applyProp(el, prop, resolved)` 现在压得过了。

### 2.2 填充层的绑定模型（`fills.js`、`cascade.js`、`picker.js`、`props-panel`）

**层读原文，不读 computed。**

- `cascade.js` 的 `SHORTHANDS` 补 `'background-image': ['background']`。回落到简写时，顶层逗号切出来的每一段是完整的 `<bg-layer>`（image 与 position / size / repeat / attachment / origin / clip 混在一段里），要先从该段里摘出 `<image>` 部分（`linear-gradient(...)` / `url(...)` / `none` 这一个函数或关键字 token）再匹配。
- `picker.js` 导出 `sameColor(a, b)`（从 `props-panel.element.js:109` 挪过去，props-panel 改为引用）。
- `fills.js`：`parseFills(computed)` 每层带上 `slot`（它在 computed `background-image` 逗号列表里的下标，效果层跳过但下标照数；底层 `background-color` 的 `slot = 'color'`）。
- `fills.js` 新增 `bindFills(el, layers)`：
  - `winningDeclaration(el, 'background-image')` → 原文按顶层逗号切分（复用 `gradient.js` 里的顶层切分工具）→ 取第 `slot` 段的 `<image>` 部分 → 若是 `linear-gradient(var(--x), var(--x))`（两端同一个 `var()`，允许空格差异）→ `layers[i].bound = '--x'`。
  - 底层：`winningDeclaration(el, 'background-color')`（含 `background` 简写回落）→ `wholeVar` / 单 token → `bound`。
  - 每个 `bound` 都要过 `sameColor(解析值, computed 该层的颜色)` 核对，不过就不算绑定。
- `serializeFills(layers)`：`bound` 的纯色层输出 `var(--x)`（底层写 `background-color: var(--x)`，非底层写 `linear-gradient(var(--x), var(--x))`），没绑的照旧。`#writeBackground` 因此天然保留绑定。
- 隐藏层的侧存储（`props-panel:1133`）改成 `hidden.push({ at, layer: { ...l, hidden: undefined } })`，跟 `#writeEffects`（`:1172`）对齐——否则眼睛一关一开绑定就没了。
- `#fillLayers()` = `bindFills(this.target, parseFills(this.#computed))`。`#varBinding('background-color')` 不再被填充层使用（其它调用方不变）。
- `#renderFillLayers` 的绑定行（见 2.5 的 (a) 方案）：行仍是 `<div class="layer-row bound" data-layer="${i}" data-fill-row="${i}">`，里面放一个 `vr-fill`（带 `bound` 属性时自己把触发器渲染成 chip：圆点 + 变量名，圆点取该层解析色）+ `unlink` 按钮（`data-unlink-layer="${i}"`）+ 眼睛 + 减号。删掉现有的「只有最后一层纯色才判绑定」分支。
- `#unlinkLayer(i)`：清掉该层的 `bound` → `#writeFillLayers`（**不是** `#unlink(prop)`，那会把整条 `background-image` 拍平）。
- `#bindRowDrag`（`:1386`）的守卫加 `e.target.closest('.var-chip')` 也 return：绑定行能拖、能当落点，但按在 chip 上手抖超过 `DRAG_SLOP` 不能变成重排。
- `#renderBoundRow(prop, binding, tail, { dot, unlinkAttr })` 参数化圆点颜色与 unlink 目标（文字色 / 描边色沿用默认）。

### 2.3 变量数据源（`cascade.js`、`resizing.js`、`visual-revise.js`）

- `cascade.js` 导出 `declaredVariables(root)`：复用模块私有的 `flatten` 走全部规则（含 `@layer` / `@media` / `@supports` / `@import` / `adoptedStyleSheets`），不限选择器，收集所有 `--*` 声明名；加上 `documentElement.style` 里的。`flatten` 本身不导出。
- `props-panel.#colorVariables()`：`declaredVariables(document)`（目标在 shadow root 里时并上它的 root）→ `getComputedStyle(this.target).getPropertyValue(name)` 解析取值 → 去掉空值 → `varKind === 'color'` → 按名排序 → `[{ name, value }]`。结果按 `this.target` 缓存到本次 render 结束（render 开头清空）。注释里写明：`cascade.js` 自己还有 50ms 的 flatten 缓存，两层叠加后 DevTools 里改样式表最长要等 50ms + 一次 render 才反映。
- `resizing.js` 的 `cssVariables()` 改成调用 `declaredVariables(document)` 并改名 `declaredVariables`；`visual-revise.js:625` 的 `api.lib` 里保留 `cssVariables` 旧名做别名。

### 2.4 共享颜色弹层 `app/components/controls/color-popover.js`

```js
openColorPopover(anchor, {
  value, format,            // Custom 页初值
  variables,                // [{ name, value }]；null 表示没有变量页（效果参数面板用）
  bound,                    // 当前绑定的变量名或 null
  page,                     // 'custom' | 'variable'；缺省 bound ? 'variable' : 'custom'
  align,                    // 'left' | 'right'
  onColor(css, format),     // Custom 页每次变化（沿用现有 vr-color 的回吐）
  onVariable(name),         // 变量页选中 → 调用方负责写入；弹层随即关闭
  onClose(),
}) → { close, setValue }
```

- 挂载走 `mountPopover(PANEL_ID='visual-revise-color-panel')`，shadow 隔离不变。
- 顶部一行 `Custom | 变量`，属性名 **`data-page`**（跟填充弹层的 `data-tab` 分开）。样式同 `S.tabBtn`。`variables === null` 时不渲染这一行。
- 变量页：`renderVariableList(container, { variables, bound, onPick })` 导出给填充弹层复用。行结构 `色圈(16px 圆) | 名 | 值(截 18) | ✓(最右)`，`data-item="<name>"`，当前项 `data-current`。`max-height: 300px; overflow: auto; overscroll-behavior: contain`。空列表一行压暗文字「页面上没有颜色变量（另有 N 个其它类型的）」。点当前已勾项：不做事、不关。
- `menu.js` 的 `swatch` / `checkAt` 删掉（唯一调用方是要退掉的变量菜单）；`[data-item]` 保留。
- 从 `vr-color` 搬过来并保留的耦合：`#format` 由 picker 回吐、`attributeChangedCallback` 时 `openInstance === this` 才 `setValue`、`disconnectedCallback` 关弹层、点 INPUT 不弹层的 `composedPath` 守卫（AC-6.20）、定位在 `createPicker` 之后、切页后重新夹回视口（抽一个 `place()`，同 `vr-fill#place`）。
- 外点关闭：`SIBLING_PANELS = ['visual-revise-select-panel', 'visual-revise-fill-panel', 'visual-revise-menu']` 进白名单（现存 bug：色盘里的格式下拉一点就把色盘关了）。
- 滚动关闭：页面 / 面板滚动关，自身内部滚动放行（同 `menu.js`）。
- 锚点标记：打开时给 anchor 打 `data-menu-open`，关时摘掉（chip 的激活态 CSS 依赖它）。
- **变量数据不走属性**（几十个变量的 JSON 序列化进每个控件，还会触发 `attributeChangedCallback` 整块重建 trigger）。改成「打开时回问」：面板 render 之后给每个 `vr-color` / `vr-fill` 实例挂 `el.variablesProvider = () => ({ variables, bound })`；控件在 `.swatch` 点击时调用它拿数据再开弹层；没挂 provider 的（效果参数面板里的 `vr-color[data-fx]`）→ `variables: null` → 只有 Custom 页。`observedAttributes` 不加新项。
- 选中变量的写入顺序（面板里）：关弹层 → `#commit(prop, \`var(${name})\`, { coerce: false })` → `this.render()` → `#toast`。多选时写 `#scope()` 全部元素，chip 只反映 `this.target`；unlink 逐元素取各自解析色（现状）。

### 2.5 填充弹层加同一行（`fill.element.js`）

- 顶部 `Custom | 变量`（`data-page`），`Custom` 下才是现有的 `无 | 纯色 | 渐变 | 图片`（`data-tab` 不动）。
- 变量页复用 `renderVariableList`。纯色层列变量；渐变 / 图片层显示一行说明「渐变和图片层不能绑定变量」。
- 选中 → 发 `vr-fill-variable { name }` 事件（层下标面板从 `e.currentTarget.dataset.layer` 取，事件里不带）→ 面板：关弹层 → 层对象 `bound = name` → `#writeFillLayers` → render → toast。
- **绑定层的 chip 就是 `vr-fill` 的触发器**（方案 (a)）：`vr-fill` 有 `bound` 属性时把触发器渲染成 chip 样式（`.var-chip` 类名与文字色 chip 一致），点击仍走自己的 `#toggle`，打开时停在变量页并勾着当前项。`bound` 由面板在 `#renderFillLayers` 里以属性写入（这一项是每层一个短字符串，不是列表，走属性没有 2.4 说的代价），`observedAttributes` 加 `bound`。
- 打开时按当前层状态停页。

### 2.6 统一入口（`props-panel`）

| 入口 | 改后 |
|---|---|
| Fill 标题栏「绑定变量」 | 目标是文字元素 → 开 `color` 的颜色弹层变量页；否则开底层填充层的填充弹层变量页（没有层时先加一层默认纯色再开，即触发该层 `vr-fill` 的打开）。贴右缘 |
| Stroke 标题栏「绑定变量」 | 空状态时先按 `#addLayer('stroke')` 写 `border-style: solid; border-width: 1px`，再开 `border-color` 的颜色弹层变量页 |
| 已绑定 chip（文字色 / 描边色 / 任意颜色控件） | `openColorPopover` 变量页、勾着当前项，贴 chip 左缘 |
| 已绑定 chip（填充层） | 就是该层 `vr-fill` 的触发器，走它自己的弹层 |
| 描边色的 `vr-color` | 走通用 `#renderControl`，那里已有 `#varBinding → #renderBoundRow` 分支，只需挂 provider |

- 删 `#varMenu` / `#openVarMenu`；事件绑定改成 `[data-var]`（标题栏）/ `[data-var-chip]`（颜色 chip）/ `[data-unlink-layer]`（填充层 unlink）。
- `#syncValues` 里 `VR-FILL` 分支（`:400-405`）是死代码（层的 `vr-fill` 带 `data-layer` 不带 `data-prop`），顺手删掉。

### 2.7 Typography 只给文字元素（`props-panel`）

- 判定是 props-panel 的方法（要读 `this.#dirtyProps`）：
  `#showTypography(el) = !isTextlessElement(el) && (isTextElement(el) || el.tagName.toLowerCase() === 'svg' || GROUP_TYPOGRAPHY.props.some(p => this.#dirtyProps.has(p)))`。
  `render()` 在 `:495` 先算好 `this.#dirtyProps` 再拼 HTML，`#renderGroup` 里直接读它，不要再调 `#dirtySet()`。
  - 内联 `<svg>` 保留（`isTextlessElement` 刻意不含 svg，它里面可以有 `<text>`，`image-fill.mjs:91-94` 有守卫用例）。
  - 「本组有 dirty 改动」兜底：VisBug 快捷键能在任意元素上改字号，改动记录里有一条 `font-size` 却在面板上找不到地方改回去，不可接受。
- 条件不成立时 `#renderGroup` 直接返回空串（整段不出现）。`#folded` / 自动展开 / `hideMapFor` / `#resetGroup` / `#refreshDirty` 都只遍历现存 section，不需要改。
- 「文字色」行规则不变。**不用 `isReplacedElement`**。

### 2.8 验收（e2e）与 PRD

新增（全部真实点击）：

| AC | 内容 |
|---|---|
| 6.31a | 描边色 / 文字色的 `vr-color` 打开后顶部有 `Custom \| 变量`（`[data-page]`），未绑定时默认 Custom；效果参数面板里的阴影色**没有**这一行 |
| 6.31b | 变量页只列颜色变量（字体栈 / `12px` / 纯数字不出现），行结构 `色圈 \| 名 \| 值 \| ✓`，色圈 16px 圆、颜色等于变量在选中元素上的解析值；定义在 `@media` / `@layer` / 容器类里的变量也在列表里 |
| 6.31c | 变量页点一项 → 弹层关闭、inline 写 `var(--x)`、格子变 chip、改动记录 +1 |
| 6.31d | 已绑定的格子点 chip → 弹层开在变量页、当前项勾着、锚点带 `data-menu-open`；点标题栏「绑定变量」同样 |
| 6.31e | 弹层里 Esc 关、点外面关、在列表里滚动不关、**在色盘里点格式下拉切到 RGB 后色盘仍在** |
| 6.32a | 填充弹层顶部 `Custom \| 变量`，`Custom` 下是 `无 \| 纯色 \| 渐变 \| 图片`（现有 `data-tab` 集合不变） |
| 6.32b | 底层纯色绑变量写 `background-color: var()`；再加一层、开关眼睛、改另一层之后绑定仍在 |
| 6.32c | 上层纯色绑变量写 `linear-gradient(var(--x), var(--x))`，面板认作 chip；页面样式表用 `background:` 简写写的同样认得；unlink 后只有这一层变回解析色，其它层不动 |
| 6.32d | 渐变 / 图片层的变量页是说明文字，不列变量 |
| 6.32e | 绑定层能拖拽排序、能当落点；按在 chip 上拖不会触发重排 |
| 6.33 | `#visual-revise-menu` 里不再出现变量列表；Effects 添加菜单、Resizing 模式菜单不受影响（AC-6.26 改挂到 Effects 添加菜单上） |
| 6.34a | 样式表 `color: var(--x) !important` 的元素：unlink 后 inline 是 `rgb(...)` 且 `getPropertyPriority === 'important'`，chip 消失，computed 不变 |
| 6.34b | 同一元素通过面板改 `font-weight`（样式表带 important）能生效；连改两次第二次也生效；undo 后恢复；页面自带 inline（不带 important）+ 样式表 important 的元素同样生效；眼睛按钮在这类元素上能关能开；导出的提示词里这条带 ` !important`；padding 四边带 important 时不折叠成简写；JSON 导出再导入后 priority 还在 |
| 6.35a | 选中没有直接文字的 div：面板里没有 Typography 分区、没有「文字色」行 |
| 6.35b | 选中 `<p>`：两者都有；内联 `<svg>` 仍有 Typography |
| 6.35c | 用快捷键在容器上改了字号之后，Typography 分区出现（折叠态）且能重置本组 |

改写：

- `acceptance-panel.mjs`：6.9 系列目标换成一个有直接文字的元素（给 `#rich` 加一段直接文字即可）；AC-6.10c 同；AC-6.24b / b2 / e / c / d / i / j / i2 全部改走颜色弹层的变量页；AC-6.23c 改成「Fill / Stroke 标题栏有绑定变量按钮，Effects 没有」（入口仍是 `.var-btn`，只是点了开弹层）。
- `acceptance-popover.mjs`：AC-6.26 改挂到 Effects 添加菜单；6.27 前置的绑定改用颜色弹层变量页。
- `acceptance-export.mjs:152`、`advanced.mjs:121`：schema 断言改 4。
- `fill.mjs:69-73, 90-96`：tab 集合断言改成只看 `[data-tab]`。
- `typography.mjs:49-53`、`figma.mjs:29-41, 198-215`、`image-fill.mjs:62-63, 146-152`、`panel.mjs:116-145`：按 2.7 的新行为改目标元素或断言（评审文件【会挂的测试】(A) 表逐条对照）。
- PRD：AC-6.15 重写（非文字元素上 Typography 不存在，而不是折叠）；AC-6.9 说明目标是文字元素；AC-6.24c/d 的入口描述更新；AC-6.26 条文改成 Effects 添加菜单；新增 6.31–6.35。
- `docs/plans/feature-inventory.md` §2.11、§3.4–3.6 按新行为回写。

### 2.9 真实页面验证

`vibe-builder/apps/web/.next/standalone` 起 Next 服务加载扩展，验两条：
(a) `.wall-line` 的 unlink（important）；(b) `.wall-card` 的 Fill 是否显示 `--role-bg-elevated` chip——
若不显示，按两个分支排查：token 定义在 `@layer` / `@media` / 容器类里（2.3 应已修）；或该元素底色透明、颜色来自某个 gradient 层（2.2 的 slot 对齐）。

## 3. 不做的

- 阴影 / 滤镜变量（Effects 没有变量入口，效果模型从 computed 反解，绑不住）。
- 变量页里新建 / 编辑变量。
- `@layer` 内 important 反转、`@container` 条件求值。
- 填充弹层抽成模块级函数（选了 2.5 的 (a) 方案）。

## 4. 影响面

`components/controls/{color.element,fill.element,picker,menu,popover-host}.js`、新增 `color-popover.js`、
`core/{change-store,history,fills,snapshot,prompt-export,json-io,cascade,resizing,visual-revise}.js`、`props-panel.element.{js,css}`、
`docs/PRD.md`、`docs/plans/feature-inventory.md`、
`tests-e2e/{acceptance-panel,acceptance-popover,acceptance-ui,acceptance-export,advanced,controls,fill,typography,panel,figma,image-fill,history}.mjs`。
