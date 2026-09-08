# 功能清单 v2（用于第二轮全量 e2e）

> 关联：
> - [feature-inventory.md](feature-inventory.md) —— v1 清单（374 点 / §0–§9）。本篇是它的增量续篇，
>   **§1–§7 的编号体系、条件标记、阅读约定全部沿用 v1，不复制原文**；这里只列 v1 之后新增或改写的功能点。
> - [../PRD.md](../PRD.md) —— 验收条目（AC-x.y）。本轮新增的 AC 主要是 AC-2.11、AC-5.11–5.15、
>   AC-6.6b/6.6c、AC-6.37–6.43、AC-7.13–7.14、AC-8.18–8.20、AC-9.12–9.13。
> - [figma-shortcuts.md](figma-shortcuts.md) —— 三组 Figma 风格快捷键的实现方案（对应本篇 §4.7，实现中）。
> - [full-e2e-report.md](full-e2e-report.md) —— 上一轮全量 e2e（按 v1 清单）的结果，套件在 `tests-e2e/full/`。
> - [color-picker-variables.md](color-picker-variables.md) —— 变量绑定与色盘的设计背景（本篇 §2.11、§3.4 的上位文档）。
>
> **规模**：本篇新增 **109 个功能点**、改写 **2 个**（2.5.15、2.5.16），跨 1 个全新一级分区（§10 网页缩放）、
> 2 个全新二级分区（§2.14 面板视觉规格、§4.7 Figma 风格快捷键）。覆盖状态：
> **70 点已覆盖 / 11 点部分覆盖 / 23 点待测 / 7 点实现中**——需要补断言的合计 **34 点**
> （§4.7 的 7 个「实现中」要等模块落地才谈得上测，另有 4.7.8 已归入待测）。
>
> ⚠️ 本篇对应的代码**尚未提交**（工作区改动，基线提交 `f9ce7ed`）。跑测试前先 `npm run extension:build`。

---

## 0. 阅读约定（相对 v1 的补充）

- **编号**：`N.M.K` 沿用 v1 的体系。§1–§7 里新增的点接着该二级分区的最后一个编号往下排；
  §8（覆盖矩阵）/ §9（缺口清单）在 v1 里是**元信息分区**，不放功能点，所以新一级分区从 **§10** 开始。
- **覆盖标记**（每条末尾）：
  - `覆盖：<文件> <断言标识>` —— 已有断言。断言标识用套件里实际打印的编号（`AC-6.37a`）或断言文案首句。
  - `部分覆盖：…（缺 X）` —— 有断言但没覆盖到这一条的全部语义。
  - `待测` —— 零断言。
  - `实现中` —— 代码是占位桩，行为按 [figma-shortcuts.md](figma-shortcuts.md) 的方案描述。
- **新的条件标记**：
  - `[k≠1]` 只在网页缩放倍数不为 1（或触控板捏合）时出现的行为
  - `[展开态]` 只在拆分行（四角 / 四边）展开后出现
- **新增源文件**：`app/core/zoom.js`（168 行）、`app/core/page-colors.js`（54 行）、
  `app/core/hotkey.js`（23 行）、`app/components/controls/page-colors.js`（68 行）、
  `app/features/{copy-props,copy-image,replace-element}.js`（各 8 行，桩）。
- **新增测试套件**：`tests-e2e/{zoom,keymove,paste,list-follow,resize-undo}.mjs`（分别 24 / 11 / 5 / 8 / 11 = **59 条断言**），
  已进 `all.mjs`；`all.mjs` 里另有三个**尚未创建**的套件名 `copy-props` / `copy-image` / `replace-element`。

---

## §1–§7：同 v1

编号 1.0.1 – 7.6.2 的全部功能点见 [feature-inventory.md](feature-inventory.md)，本篇不复制。
下面只列 **v1 之后新增或改写的**条目，按 v1 的分区归位。

---

## v1 之后新增 / 变更

### 2.3 「选择元素」tab — 分区通用行为（新增 2.3.14–2.3.19）

代码：`app/components/props-panel/props-panel.element.js` 的 `#renderControl` / `#showValue` /
`#numSource` / `splitUnit`，`app/core/controls.js` 的 `displayValue` / `stepValue`。

- **2.3.14** 数值框的**单位只做展示、放在框外最右**：`22.5px` 拆成框里的 `22.5` 和右侧压淡的 `px` 后缀，
  后缀不参与编辑；px 这种默认单位仍不显示（`stripDefaultUnit` 早就剥掉了），拆的是行高的 px、
  旋转的 deg（显示为 `°`）、em、% 这类。（AC-6.39a）　覆盖：`tests-e2e/acceptance-panel.mjs` `AC-6.39a`
- **2.3.15** 只敲数字沿用当前单位：框里的真实单位记在 `data-unit` 上，提交时若框内只有裸数字就把它补回去
  （`22.5` → `30` 写 `30px`）；敲带单位的值就换单位（`1.5em`）。（AC-6.39b）
  覆盖：`acceptance-panel.mjs` `AC-6.39b`
- **2.3.16** 步进（方向键 / 拖标签）按框里当前的单位走：`stepValue` 收到的是 `input.value + data-unit`，
  不再回落到计算值的 px（`1.5em` ↑ 一步是 `2.5em`，不是 `24.5px`）。（AC-6.39b）
  覆盖：`acceptance-panel.mjs` `AC-6.39b`（`lh3`）
- **2.3.17** 数值框的显示源优先取元素自己的 **inline**（`#numSource`），没有才用计算值——计算值永远是 px，
  用户敲的 `1.5em` 一经回读就变成 `22.5px`、单位后缀跟着丢；`var()` / `calc()` / `min()` / `max()` /
  `clamp()` 这类非数值 inline 不拿来显示，退回计算值。（AC-6.39b）　待测
- **2.3.18** 提交后框仍聚焦时 `#syncValues` 会跳过它，`change` 处理器自己再刷一次数字与后缀——
  否则敲完 `1.5em` 框里留着 `1.5em`、后缀还挂着 `px`，下一次步进拼成 `1.5empx`。　待测
- **2.3.19** `.suffix:empty { display: none }`：没有后缀的框不留 26px 右内边距，
  只有 `.control:has(.suffix:not(:empty))` 才让位。（AC-6.39a）　待测

### 2.5 分区 2：Layout（改写 2.5.15 / 2.5.16，新增 2.5.19–2.5.21）

代码：`props-panel.element.js` 的 `#renderSides(sg, kind)`、`#renderSideField`；
样式 `props-panel.element.css` 的 `.sides`。

- **2.5.15 ⟳改写** 内 / 外边距展开成四边后，四个框的前缀从 `↑ → ↓ ←` **字符**换成
  「虚线框 + 一条实边」的**方向图标**（`EDGE.left/top/right/bottom`，12px，与描边四边共用同一套），
  且前缀带 `data-drag` 可横向拖着调值。（AC-6.6c）
  部分覆盖：`tests-e2e/full/layout-appearance.mjs` `2.5.15`（只验了「四个前缀都是 svg」，缺拖动调值）
- **2.5.16 ⟳改写** **四边联动锁取消**：展开态下四边各自独立，改一边只动那一边、一条历史、
  ⌘Z 只退回那一边。原来的 `.lock[data-lock]` 按钮、`input[data-side]` 的联动 batch 处理器全部删除。
  （AC-6.6b）　覆盖：`full/layout-appearance.mjs` `2.5.16` 三条（「改左边只动左边」「一次编辑一条历史」
  「⌘Z 退回那一边」）
- **2.5.19** 展开 / 收回按钮换成与圆角、粗细同一个「四边独立」图标（`ICON.sides`，四条互不相连的边），
  展开态下按钮 `data-on` 高亮，落在网格的**第一行第三列**（`grid-area: 1 / 3`，32×32）。（AC-6.6c）
  覆盖：`full/layout-appearance.mjs` `2.5.15`（「展开后没有联动锁，收回按钮在网格右上、处于高亮」）、
  `2.5.16`（「点网格里的收回按钮回到两段式」）
- **2.5.20** 展开网格与收起态的两段式用同一套三列模板 `1fr 1fr minmax(32px, auto)`、gap 4px，
  四个框与上一行的两个框左右边缘对齐。（AC-6.6c、AC-9.12）
  覆盖：`tests-e2e/acceptance-ui.mjs` `AC-9.12`
- **2.5.21** 网格顺序改为 **左 上 / 右 下**（`['left','top','right','bottom']` 重排 `sg.props`）：
  左列管左右、右列管上下，跟收起态「水平 | 垂直」的左右位置一致，展开前后同一列改的是同一组边。（AC-6.6c）
  部分覆盖：`full/layout-appearance.mjs` `2.5.16`（改第一格动的是 `padding-left`，间接证明第一格是「左」；
  缺四格顺序的直接断言）

### 2.6 分区 3：Appearance（新增 2.6.3–2.6.10）

代码：`props-panel.element.js` 的 `SPLIT_ROWS['border-radius']` / `#renderSplitRow` / `#partsDiffer`，
`core/controls.js` 的 `CORNER_PROPS`，`core/snapshot.js` 的 `SYNTH`。

- **2.6.3** 圆角行右侧多一个「四角独立」按钮（`ICON.corners`，四个圆角括弧，13px；
  按钮 32×32、1:1，与内 / 外边距展开钮同规格）；四角相等时收起，单框显示当前值。（AC-6.37a）
  覆盖：`acceptance-panel.mjs` `AC-6.37a`；行结构变化另见 `full/layout-appearance.mjs` `2.6.2`
  （「不透明度与圆角并排在 `.radius-row`，右侧是四角独立按钮」「圆角前缀是圆角弧图标」）
- **2.6.4** `[展开态]` 点按钮展开成 2×2：**左上 右上 / 左下 右下**，四格各带自己那一角的圆弧前缀图标；
  按钮 `data-on` 高亮，再点收回。（AC-6.37b）　覆盖：`acceptance-panel.mjs` `AC-6.37b`
- **2.6.5** `[展开态]` 改某一个角只写那一条长手（`border-top-left-radius` 等），其余三条不动；
  改动记录 / 导出 / 撤销**仍只有一条 `border-radius`**——快照从四条长手合成简写
  （相等一个值，不等按「左上 右上 右下 左下」四个值）。（AC-6.37c）
  覆盖：`acceptance-panel.mjs` `AC-6.37c`
- **2.6.6** 收起态下四角不等：单框留空、占位「混合」（`placeholder="混合"`）。（AC-6.37d）
  覆盖：`acceptance-panel.mjs` `AC-6.37d`
- **2.6.7** 收起态单框敲值写 `border-radius` 简写，四角一起变，占位当场撤掉。（AC-6.37e）
  覆盖：`acceptance-panel.mjs` `AC-6.37e`
- **2.6.8** 页面本身四角不等的元素第一次显示就**默认展开**，四个框各显示自己的值；
  之后开合由用户决定，切换元素时按新元素重判（`state.for !== this.target` 就重算）。（AC-6.37e）
  覆盖：`acceptance-panel.mjs` `AC-6.37f`
- **2.6.9** `[展开态]` 四格支持拖前缀标签调值与方向键步进（`#renderControl(p, { dragPrefix: true })`）。
  （AC-6.37b）　待测
- **2.6.10** `[展开态]` 一次 ⌘Z 只退回改过的那一个角（合成简写只落一条历史条目）。（AC-6.37c）
  部分覆盖：`acceptance-panel.mjs` 6.37 段末的 `Meta+z`（没有独立断言文案锁住「只退回那一角」）

### 2.7 分区 4：Typography（新增 2.7.9）

代码：`core/controls.js` 的 `coerceLetterSpacing` / `letterSpacingPercent`。

- **2.7.9** 字距按**字号的百分比**显示与输入（Figma 的写法）：`normal` 显示 `0` 带 `%` 后缀；
  敲 `5` 写 `letter-spacing: 0.05em`（CSS 不收百分比，em 正是相对字号），敲 `0` 写回 `normal`
  （不是 `0em`，免得留一条什么都没做的记录）；↑ / ↓ 一步 1%、Shift 10%；
  计算值（px）回读时除以当前字号换算。（AC-6.40）
  覆盖：`acceptance-panel.mjs` `AC-6.40`、`full/typography-fill.mjs` `2.7.6`（裸数字 3 → `0.03em`）

### 2.9 分区 6：Stroke（新增 2.9.6–2.9.14）

代码：`props-panel.element.js` 的 `SPLIT_ROWS['border-width']` / `#canAdd`，
`core/controls.js` 的 `SIDE_WIDTH_PROPS` / `FIELD_PAIRS` / `CONTROLS['border-style'].preview`。

- **2.9.6** 分区内字段顺序改成**「样式」在左、「粗细」在右**（`FIELD_PAIRS` 里
  `['border-width','border-style']` → `['border-style','border-width']`）——粗细右侧还要挂按钮。（AC-6.38a）
  覆盖：`acceptance-panel.mjs` `AC-6.38a`、`full/stroke-effects.mjs` `2.9.2`（`.split-row`）
- **2.9.7** 粗细右侧多一个「四边独立」按钮（`ICON.sides`，32×32、1:1）；四边相等时收起，
  单框显示当前值。（AC-6.38a）　覆盖：`acceptance-panel.mjs` `AC-6.38a`
- **2.9.8** `[展开态]` 展开成 2×2：**左 上 / 右 下**（Figma 的顺序），四格各带
  「虚线框 + 一条实边」的方向图标；按钮高亮，再点收回。（AC-6.38b）
  覆盖：`acceptance-panel.mjs` `AC-6.38b`
- **2.9.9** `[展开态]` 改某一边只写那一条长手（`border-left-width` 等）；改动记录 / 导出 / 撤销
  **仍只有一条 `border-width`**（四条长手合成简写：相等一个值，不等按「上 右 下 左」四个值；
  没在 inline 里写的那一边取计算值）。（AC-6.38c）　覆盖：`acceptance-panel.mjs` `AC-6.38c`
- **2.9.10** 收起态下四边不等：单框留空、占位「混合」。（AC-6.38d）
  覆盖：`acceptance-panel.mjs` `AC-6.38d`
- **2.9.11** 收起态单框敲值写 `border-width` 简写，四边一起变，占位当场撤掉。（AC-6.38e）
  覆盖：`acceptance-panel.mjs` `AC-6.38e`
- **2.9.12** 页面本身四边不等的元素第一次显示就默认展开，四框各显示自己的值。（AC-6.38e）
  覆盖：`acceptance-panel.mjs` `AC-6.38f`
- **2.9.13** 空状态判定改成「**任一边**有宽度就算有描边」：`#canAdd` 取四条长手与简写的最大值
  （原来只看简写的第一个值，四边不等时简写读成空串，整个分区会误退回空状态、加号变可点）。（AC-6.38e）
  待测
- **2.9.14** 「样式」下拉把线型**画出来**：触发器和每个选项前都有一段线，由 `border-top` 让浏览器
  自己渲染 solid / dashed / dotted / double（double 3px 才画得出两条），`none` 留空白占位对齐；
  名字保留在线后面。触发器线宽 ≥16px、选项线宽 24px。（AC-6.43）
  覆盖：`acceptance-panel.mjs` `AC-6.43` ×2（触发器 / 下拉每项）

### 2.11 CSS 变量绑定（新增 2.11.12–2.11.16）

代码：`app/components/controls/color-popover.js` 的 `renderVariableList`、`fill.element.js` 的 `#renderPages`。

- **2.11.12** 变量列表顶部有搜索框（放大镜图标 + 占位「搜索变量」，`aria-label="搜索变量"`），
  打开变量页即 `requestAnimationFrame` 自动聚焦（`autofocus` 默认 true）。（AC-6.42a）
  覆盖：`tests-e2e/acceptance-variables.mjs` `AC-6.42a`
- **2.11.13** 输入即按名字过滤（不区分大小写的子串）；过滤要**肉眼看得见**——行自带行内
  `display:flex`，只设 `hidden` 属性压不住，得同时改 `row.style.display`。清空恢复全部。（AC-6.42b）
  覆盖：`acceptance-variables.mjs` `AC-6.42b`（验的是 `getComputedStyle(row).display`）
- **2.11.14** 一个都不剩时显示一行「没有匹配「x」的变量」。（AC-6.42b）
  覆盖：`acceptance-variables.mjs` `AC-6.42b`
- **2.11.15** 过滤不影响当前绑定项的勾选状态（清空后勾还在原处）。（AC-6.42b）
  覆盖：`acceptance-variables.mjs` `AC-6.42b`（`restore`）
- **2.11.16** 填充弹层的「自定义 | 变量」两页**并排在同一行**：容器的 `display:flex` 写在行内样式里，
  切换绑定态时不能把它清成 `''`（清了会竖着排）。（AC-6.32a2）
  覆盖：`acceptance-variables.mjs` `AC-6.32a2`

### 2.14 面板视觉规格（新增二级分区，2.14.1–2.14.3）

v1 把 AC-9.x 只记在覆盖矩阵里、没有拆成功能点。本轮新增两条 AC，在这里补上编号，便于测试引用。
代码：`props-panel.element.css`、`change-list.element.css`、`comment-layer.element.css`、
`controls/{color,fill}.element.js`。

- **2.14.1** **全局间距统一 4px**（原 6px）：`.pair` / `.layers` / `.layer-row` / `.dims` / `.side-pair` /
  `.limits` / `.split-row` / `.with-action` / `.flow-row` / `.typo-align` / `.typo-pair` / `.track` /
  `header` / `.sides` 以及 `vr-color` / `vr-fill` 宿主的 gap 全部 4px；字段行距（`.rows` 12px）
  与标签到框（5px）不在此列。（AC-9.13）　覆盖：`acceptance-ui.mjs` `AC-9.13`
- **2.14.2** 拆分网格（四角 / 四边 / 内外边距四边）与上面那一行用同一套三列模板
  （`1fr 1fr minmax(32px, auto)`，第三列在网格里留空），每一格与上一行两个输入框的左右边缘
  对齐（±0.5px）。（AC-9.12）　覆盖：`acceptance-ui.mjs` `AC-9.12`
- **2.14.3** 改动列表（`.items` / `.item-head` / `footer`）与评论气泡（`.refs` / `.ref-head` /
  `.actions`）的间距同步到 4px。（AC-9.13）
  部分覆盖：`acceptance-ui.mjs` `AC-9.13` 只量属性面板；改动列表与评论气泡待测

### 3.1 `vr-select` 下拉（新增 3.1.12）

- **3.1.12** 新增 `preview` 属性：`preview="border"` 时触发器与每个选项前渲染一段
  `border-top` 画的线（`linePreview`）；选项行 gap 12px、触发器 gap 8px；标签走 `esc()` 转义。
  `observedAttributes` 加入 `preview`。（AC-6.43）　覆盖：`acceptance-panel.mjs` `AC-6.43` ×2

### 3.4 色盘主体（新增 3.4.9–3.4.16）

代码：`app/core/page-colors.js`（数据源）、`app/components/controls/page-colors.js`（渲染）、
`color-popover.js` 的 `renderCustom`。

- **3.4.9** 色盘（自定义页）下面有「On this page」：页面上出现过的颜色按出现次数**降序**排成色块，
  一行 9 个（`repeat(9,1fr)`、gap 3px），最多 54 个，`max-height:105px` 超出内部滚动；
  头部右侧显示总数。（AC-6.41a）　覆盖：`acceptance-variables.mjs` `AC-6.41a`
- **3.4.10** 采集口径：只数看得见的——**直接承载文字**的元素的字色、不透明的背景色、
  真的画出来的描边色（宽度 > 0 且 style ≠ none，**四边同色只数一次**）、SVG 的 fill / stroke；
  编辑器自己的 UI（`EDITOR_UI` 选择器 + `visbug-*` 标签）与 `display:none` 的元素不算；
  全透明（alpha = 0）的不算；扫描上限 6000 个元素。（AC-6.41a）
  部分覆盖：`acceptance-variables.mjs` `AC-6.41a`（验了排序与首项、`inCustom`；
  缺「四边同色只数一次」「编辑器 UI 不算」「display:none 不算」「SVG fill/stroke」四条分支）
- **3.4.11** 点色块直接应用到当前属性**并载入色盘**（色值框、色域、透明度条一起同步，
  走 `picker.set(css)` + `onColor`）；`title` 是「色值 · N 处」。（AC-6.41b）
  覆盖：`acceptance-variables.mjs` `AC-6.41b`
- **3.4.12** 色块是 1px **实线**边框（`#5a5a5a`，不是虚线——半透明边压在棋盘格上会被切成一段一段），
  透明色底下垫棋盘格（`CHECKER`，只画在内层）。（AC-6.41e）
  覆盖：`acceptance-variables.mjs` `AC-6.41e`
- **3.4.13** 带透明度的颜色（`#rrggbbaa`）色块分两半：**左半**画去掉透明度的实色（`color.slice(0,7)`），
  **右半**画真实渲染（透过棋盘格）；不透明的色整块一色。点击应用的仍是带透明度的原色。（AC-6.41f）
  覆盖：`acceptance-variables.mjs` `AC-6.41f` ×2（分半渲染 / 点击应用原色）
- **3.4.14** 变量页**没有**这一块（它是色盘自定义页的东西）。（AC-6.41c）
  覆盖：`acceptance-variables.mjs` `AC-6.41c`
- **3.4.15** 弹层开着期间只扫一次页面（结果缓存在 `state.pageColors` / `this.#pageColors`，
  在自定义页与变量页之间来回切不重扫）；关掉重开重扫。（AC-6.41c）　待测
- **3.4.16** 页面上一个可采集颜色都没有时给空态「页面上没有可采集的颜色」（不渲染网格）。　待测

### 3.6 `vr-fill` 填充控件（新增 3.6.9）

- **3.6.9** 填充弹层的**纯色页**同样有「On this page」；每次 `open()` 把 `#pageColors` 置 null 重扫。
  （AC-6.41d）　覆盖：`acceptance-variables.mjs` `AC-6.41d`

### 4.1 选择元素 / 键盘（新增 4.1.20–4.1.30）

代码：`core/visual-revise.js` 的 `onKeydown` 方向键分支（`ARROW_TOOLS` / `POPOVER_IDS`）、
`app/features/selectable.js` 的 `on_paste`。

**↑ / ↓ 在父级里换位（AC-7.13）**

- **4.1.20** 选中元素后按 ↑ / ↓ 在**同一个父级**里换一位（↑ 到前一个兄弟之前，↓ 到后一个兄弟之后），
  走 `ChangeStore.moveElement`：进改动记录、导出里有这条移动。（AC-7.13）
  覆盖：`tests-e2e/keymove.mjs`（「↑ 挪到第一位」「↓ 两下到最后一位」）
- **4.1.21** 已在头 / 尾时不动、不记，也不跨出容器。（AC-7.13）
  覆盖：`keymove.mjs`（「已在第一位时 ↑ 不动，也不产生记录」「已在最后一位时 ↓ 不动」）
- **4.1.22** 同一个元素反复挪只留**一条**移动记录（from 取第一次、to 取最后一次）；
  `⌘Z` 退回上一步。（AC-7.13）　覆盖：`keymove.mjs` 2 条
- **4.1.23** 挪完选中不变，选中框（`visbug-handles` / `visbug-label`）跟到新位置；
  「结构」tab 下树里的高亮行跟着上移一行。（AC-7.13）　覆盖：`keymove.mjs` 2 条
- **4.1.24** 焦点在输入框里时方向键归输入框（做数值步进），元素不动。（AC-7.13）
  覆盖：`keymove.mjs`（「焦点在输入框里时 ↓ 是步进，元素不动」）
- **4.1.25** 有弹层开着时不接管（四个 `POPOVER_IDS`：菜单 / 色盘 / 填充 / 下拉）。（AC-7.13）
  覆盖：`keymove.mjs`（「有弹层开着时 ↓ 不接管」）
- **4.1.26** 上游那些自己用方向键的工具激活时不接管：`ARROW_TOOLS` =
  position / move / margin / padding / align / font / boxshadow / hueshift / text。（AC-7.13）　待测
- **4.1.27** 多选时各自挪一位；**相邻的两个都选中**时按边界处理、不让它们互相跳过换位
  （`picked` 集合 + 往上按文档顺序、往下倒序处理）；编辑器自己的节点（面板、工具条）
  不算兄弟，跳过。（AC-7.13）　待测
- **4.1.28** 只在选择模式接管：浏览 / 评论模式、交互态（`interactive`）、
  焦点在编辑器 UI 内（`isEditorUI`）时全部放行；带任一修饰键（⌘/Ctrl/⌥/⇧）也不接管。（AC-7.13）　待测

**粘贴守卫（AC-7.14）**

- **4.1.29** 焦点在编辑器或页面的输入框 / contenteditable 里时，⌘V 是给那个框的：
  `on_paste` 开头 `isTypingTarget(e)` 直接 return——不 `preventDefault`、不往选中元素里塞节点、
  不产生「粘贴元素」记录。（AC-7.14）
  覆盖：`tests-e2e/paste.mjs` 3 条（「找到面板里的色值输入框」「paste 不被拦」「选中元素内容不变、
  没有 insert 记录」）
- **4.1.30** 焦点在页面上时仍按上游行为：把剪贴板里的 HTML 粘进选中元素并记一条 insert。（AC-7.14）
  覆盖：`paste.mjs` 2 条

### 4.2 选中框上的 8 个缩放把手（新增 4.2.5–4.2.10）

代码：`app/components/selection/handle.element.js` 的 `before` 快照 + `visual-revise:resized` 事件，
`core/visual-revise.js` 的 `RESIZE_PROPS` 监听。**这是 v1 §9.3 列的第二大缺口，本轮已补实现与断言。**

- **4.2.5** 松手后（在下一帧，等最后一次 rAF 写入落地）派发 `visual-revise:resized`，
  detail 带 `{ el, before }`，`before` 是拖之前的 `width` / `height` / `translate` **行内**值。
  （AC-8.20）　覆盖：`tests-e2e/resize-undo.mjs`（间接，全套前置）
- **4.2.6** 宿主收到后把三条里真的变了的逐条走 `applyProp` 记进历史：先把行内值退回拖之前的，
  再正式写一次；一次拖动一条批次，标签「拖改宽度 / 高度 / 位置 / 尺寸」。（AC-8.20）
  覆盖：`resize-undo.mjs`（「改动记录里有 width」「历史栈有条目可撤销（标签含宽度/尺寸）」）
- **4.2.7** `⌘Z` 退回拖之前的行内值、盒宽复原、改动记录里对应条目消失；`⌘⇧Z` 重做。（AC-8.20）
  覆盖：`resize-undo.mjs` 3 条
- **4.2.8** 角把手一次改 width + height + translate，三条进**同一条**批次，一次 ⌘Z 三条一起退。
  （AC-8.20）　覆盖：`resize-undo.mjs` 2 条
- **4.2.9** 撤销 / 重做把尺寸、位置改回去之后选中框跟着元素走
  （`ChangeStore.subscribe` → rAF → `on_window_resize()`）。（AC-8.20）
  覆盖：`resize-undo.mjs`（「撤销后选中框跟着元素缩回去」）
- **4.2.10** 拖改之后工具条的撤销按钮变可用（历史栈真的有条目，不只是快照 diff 看得见）。（AC-8.20）
  覆盖：`resize-undo.mjs`（「工具条撤销按钮可用」）

### 4.5 标尺线 / 测距 / 参考线（新增 4.5.6–4.5.8）

代码：`selection/gridlines.element.css`、`selection/distance.element.css`、`app/features/guides.js`。

- **4.5.6** 标尺线（`visbug-gridlines`）整块 `opacity: .5`——实色的线正好压在元素边缘上，
  看不清底下的东西。（AC-2.11）　覆盖：`tests-e2e/zoom.mjs`（「参考线 visbug-gridlines opacity .5」）
- **4.5.7** 拖出的参考线背景从 `hsla(330 100% 71% / 70%)` 降到 `50%`，并带上
  `data-visual-revise-guide` 标记（供 `--vr-inv-zoom` 规则命中，见 10.6.1）。（AC-2.11）　待测
- **4.5.8** 测距线本体（`:host > figure` 里的 `<span>` / `<div>` 线）`opacity: .5`，
  线上的**数字标签保持实色**、要读得清。（AC-2.11）　待测

### 4.7 Figma 风格快捷键（新增二级分区，4.7.1–4.7.8，**全部实现中**）

方案：[figma-shortcuts.md](figma-shortcuts.md)。骨架已就位：
- `app/core/hotkey.js`：`isMac`（按 `userAgentData.platform || navigator.platform` 判，**模块加载时算一次**）、
  `isMod(e)`（Mac 看 ⌘ 且 Ctrl 没按、其它看 Ctrl 且 ⌘ 没按）、`MOD` / `ALT` / `SHIFT` / `combo()` 显示文案。
- `app/features/{copy-props,copy-image,replace-element}.js`：各导出 `onKeydown(e, ctx) → boolean`（当前是返回 false 的桩）。
- `core/visual-revise.js` 的 `onKeydown` **最前面**按 copy-props → copy-image → replace-element 顺序调用，
  `ctx = { engine, panel, list, comments, toolbar, interactive, mode, hasOpenPopup, isTypingTarget, isEditorUI, toast }`。
- `tests-e2e/all.mjs` 已注册套件名 `copy-props` / `copy-image` / `replace-element`（**文件尚未创建**，
  现在跑 `all.mjs` 这三个会异常退出）。

- **4.7.1** `⌥⌘C`（Win `Ctrl+Alt+C`）复制选中元素的属性到剪贴板。　实现中
  **验收要点**：只在 `mode === 'select'`、`!interactive`、`!isTypingTarget(e)`、`!isEditorUI(e)`、
  `!hasOpenPopup()` 时接管；接了 `preventDefault()` + `stopPropagation()` 并返回 true；
  未选中元素时不接管（或给 toast 并不产生记录）。
- **4.7.2** `⌥⌘V`（Win `Ctrl+Alt+V`）把剪贴板里的属性粘到选中元素。　实现中
  **验收要点**：写入必须走 `ChangeStore.applyProp`（进改动记录、⌘Z 可退、进提示词）；
  多个属性包成一条 `history.batch`，一次 ⌘Z 整体退回；多选 / `panel.scope()` 联动集合各自写一份；
  剪贴板里不是本工具产出的内容时不写、给 toast。
- **4.7.3** 与上游 VisBug 已有的 `⌘⌥C` / `⌘⌥V`「复制 / 粘贴样式」（AC-3.10，`selectable.js` 里的
  `copy_styles` / `paste_styles`）**同键位**：需明确由谁接管、上游那条是否一并解绑。　实现中（待定）
  **验收要点**：同一次按键只产生一次效果，不能两条路都跑（会写两遍、留两条历史）。
- **4.7.4** `⌘⇧C`（Win `Ctrl+Shift+C`）把选中元素复制为图片放进剪贴板。　实现中
  **验收要点**：必须排在 `onKeydown` 里那道「带主修饰键就 return」的 ⌘Z 分支**之前**
  （否则永远走不到）；写图需 `clipboard-write` 权限；成功 / 失败都走 `ctx.toast`；
  不产生改动记录（它不改页面）。
- **4.7.5** `⌘⇧R`（Win `Ctrl+Shift+R`）用剪贴板内容替换选中元素。　实现中
  **验收要点**：与浏览器原生「硬刷新」同键位，**必须 preventDefault**，否则页面直接重载、
  所有改动丢失；插入 + 删除都走 `ChangeStore`（`insertElement` / `removeElements`），
  包在一条 `history.batch` 里，一次 ⌘Z 整体退回；新元素在改动记录里按「新增元素」成行（AC-8.11）。
- **4.7.6** **Windows 变体**：三组键在 Windows / Linux 上用 `Ctrl` 触发、`⌘` 不触发；Mac 上反之。　实现中
  **验收要点**：`isMac` 是**模块加载时**算的，测试要在注入 bundle **之前**用
  `page.addInitScript` 覆写 `navigator.platform`（`Object.defineProperty(navigator, 'platform', {get:()=>'Win32'})`）
  并用 `page.evaluate` 派发带 `ctrlKey:true` 的 `KeyboardEvent`；同时验「Mac 上按 Ctrl+Alt+C 不触发」
  与「Win 上按 Meta+Alt+C 不触发」两个反向条件（`isMod` 要求另一边没按）。
- **4.7.7** 提示文案按平台显示：`combo()` 在 Mac 上连写（`⌥⌘C`）、其它平台加号连接（`Ctrl+Alt+C`）；
  toast / tooltip 里出现的键位文案都走它。　实现中
- **4.7.8** 三个模块在 `SHORTCUT_HANDLERS` 里按顺序调用，任一返回 true 就短路、不再往下走
  （也不落到 ⌘Z / 方向键 / ⌥Delete 那几道分支）。　待测（骨架已就位，桩全返回 false）

### 5.1 改动记录面板（新增 5.1.17–5.1.25）

代码：`app/components/change-list/change-list.element.js` 的 `setSelected` / `#applySelection` /
`attributeChangedCallback`，`core/visual-revise.js` 的 `onSelected` 与 `vr-locate` 分支。

**列表跟着选中（AC-8.18）**

- **5.1.17** 页面上选中元素时，改动列表里这个元素的那组条目持续高亮：`data-selected` →
  蓝边 + `inset 0 0 0 1px` 蓝边 + 淡蓝底 `rgb(13 153 255 / .10)`。（AC-8.18）
  覆盖：`tests-e2e/list-follow.mjs` 2 条
- **5.1.18** 不在列表可见区就把**第一组**滚到中间；直接改 `box.scrollTop`，
  不用 `scrollIntoView`（后者会连页面一起滚，列表是 fixed 的、页面不该动）。（AC-8.18）
  覆盖：`list-follow.mjs` 2 条（「打开时按当前选中高亮并滚进可见区」「换选后滚到可见」）
- **5.1.19** 换选高亮移走；取消选中清掉；多选全亮。（AC-8.18）
  部分覆盖：`list-follow.mjs`（换选、取消各 1 条；**多选全亮待测**）
- **5.1.20** 列表关着时选中，打开后（`hidden` 属性变化触发 `attributeChangedCallback`）
  再高亮并滚到位——关着时算不出滚动量。（AC-8.18）　覆盖：`list-follow.mjs`
- **5.1.21** 记录变化引起的重渲染**不抢滚动位置**：`#follow` 只在「选中变了」或「列表刚打开」
  时置位，`render()` 里的 `#applySelection()` 只套高亮不滚。（AC-8.18）
  覆盖：`list-follow.mjs`（「记录变化后重渲染：高亮保留、滚动位置不动」）
- **5.1.22** 选中一个没有改动记录的元素：列表里没有任何高亮。（AC-8.18）　覆盖：`list-follow.mjs`
- **5.1.23** 只做「选中 → 列表」**单向**：列表里的滚动 / hover 不反过来改页面选中。（AC-8.18）　待测

**点条目的分流（AC-8.19）**

- **5.1.24** 点**评论**条目打开的是那条评论的编辑框（内容、图片都带上，走 `comments.editComment(id)`），
  **不**选中元素、**不**打开属性面板——`vr-locate` 的 detail 加了 `kind` / `id`。（AC-8.19）
  覆盖：`list-follow.mjs` 2 条
- **5.1.25** 其它条目仍是选中元素并 `scrollIntoView` 滚到它、打开属性面板。（AC-8.19）
  部分覆盖：`tests-e2e/list.mjs` 5.1.11（v1 已有；缺「加了 kind 分流之后非评论条目行为不变」的回归断言）

### 5.5 `!important` / 快照合成（新增 5.5.7）

代码：`app/core/snapshot.js` 的 `SYNTH` / `SKIP_INLINE` / `synthShorthand` / `readInline` /
`readInlineImportant`。

- **5.5.7** `border-radius` / `border-width` 的四条长手**不进 inline 快照**，统一从长手合成一条简写：
  四条都有且相等 → 一个值；否则按简写顺序四个值，**没在 inline 里写的那一边取计算值**
  （合成出来的才是元素此刻真实的样子，撤销 / 导入写回去不会把那一边归零）；
  `important` 也按「任一长手带 important 就算这条简写带」聚合。改动记录、导出、撤销都只认这一条。
  （AC-6.37c、AC-6.38c）
  部分覆盖：`acceptance-panel.mjs` `AC-6.37c` / `AC-6.38c`（验了改动记录里的合成值）；
  **快照往返（导出 JSON → 导入 → 四边值还原）与 important 聚合待测**

---

## 10. 网页缩放与视觉视口（全新一级分区）

代码：`app/core/zoom.js`（168 行，唯一真源）；消费方 `core/placement.js`、`toolbar.element.js`、
`change-list.element.js`、`controls/popover-host.js`、各 `selection/*.css`、`features/guides.js`；
倍数来源 `extension/visbug.js`（`tabs.getZoom` / `onZoomChange`）→ `extension/toolbar/inject.js`（`ZOOM` 消息）。

核心契约：**页面放大到 k 倍时，fixed 的编辑器 UI 反向 `scale(1/k)`、贴边距离除以 k，屏幕上纹丝不动**；
**贴在页面元素上的物件跟着元素走，但它们的线宽 / 圆点 / 字号乘 `--vr-inv-zoom` 保持屏幕原大**。

### 10.1 倍数来源与判定

- **10.1.1** 扩展进程注入后发一次 `tabs.getZoom(tabId)`，`tabs.onZoomChange` 每次变化再发；
  **不看 service worker 内存里的 `state.loaded`**（MV3 SW 闲置半分钟就被杀，醒来 state 是空的）；
  标签页没装内容脚本时 `sendMessage` 抛错被兜住。（AC-5.12①）　待测（需真实扩展环境）
- **10.1.2** content script 收到 `{action:'ZOOM'}` 后写 `<html data-visual-revise-zoom>` 并抛
  `visual-revise:zoom` 事件；bundle 还没跑起来也没关系——它启动时 `fromAttr()` 读这个属性。（AC-5.12①）
  覆盖：`tests-e2e/zoom.mjs`（`zoom(k)` 就是模拟这条路，全套 24 条断言的前置）
- **10.1.3** 属性变化除了事件还有 `MutationObserver`（`attributeFilter: ['data-visual-revise-zoom']`）
  兜底——只改属性不抛事件也认。　待测
- **10.1.4** 页面自己察觉：`devicePixelRatio` 与 `innerWidth` **同时反向**变化（容差
  `2 + w * 0.01`）才算缩放。没有任何扩展消息时（旧 content script、SW 已死）面板也要缩回去。（AC-5.12②）
  覆盖：`zoom.mjs`（「无扩展消息：DPR×1.5 且视口÷1.5 → 认作缩放 1.5」）
- **10.1.5** 只有 DPR 变、宽度不变 = 窗口挪到了另一块屏：**倍数不变**，只换锚点。（AC-5.12②）
  覆盖：`zoom.mjs`（「只改 DPR 不改视口：视为换屏，倍数不变」）
- **10.1.6** 只有宽度变、DPR 不变 = 拉窗口：倍数不变，只更新宽度锚点。（AC-5.12②）　待测
- **10.1.7** 绝对值以扩展最后一次告知的为锚（`acceptAttr` 重置 `state.dpr` / `state.w`），
  没告知过按 1。（AC-5.12②）　部分覆盖：`zoom.mjs`（「DPR 回 1 且视口回原：倍数回 1」，间接）
- **10.1.8** 触控板捏合是**视觉视口**缩放：CSS 像素与 DPR 都不变，倍数再乘 `visualViewport.scale`
  （`zoomFactor() = state.k × pinchScale()`）。（AC-5.12③）　覆盖：`zoom.mjs` 捏合各条
- **10.1.9** 换屏用 `matchMedia('(resolution: Ndppx)')` 的 `change` 补监听（`resize` 不一定触发），
  每次触发后重新挂一个新的 mq（`{ once: true }` + 递归）。　待测

### 10.2 属性面板（`core/placement.js`）

- **10.2.1** `[k≠1]` 面板 `transform: scale(1/k)`；**未拖过**时 `transformOrigin: top right`
  （样式表里是 top/right 定位）；k 回 1 时 `transform` 清空。（AC-5.11、AC-5.14）
  覆盖：`zoom.mjs` 3 条（缩放 1 无 transform / 缩放 1.5 scale + 原点右上 / 缩回 1 transform 清空）
- **10.2.2** `[k≠1]` 未拖过时贴边距离按倍数换算：`top = topOf(88, k)`、`right = rightOf(16, k)`，
  屏幕上的右上角位置与宽度都不变。（AC-5.11）
  覆盖：`zoom.mjs` 2 条（「面板屏幕宽度不变」「面板右上角屏幕位置不变」）
- **10.2.3** `[k≠1]` `max-height` 里的 `100vh` 乘回 k（`viewportMaxHeight(k, 104)`），
  否则面板在屏幕上只有原来的 1/k 高；k=1 且没捏合时写空串还给样式表。（AC-5.11）　待测
- **10.2.4** 拖过之后 `savePlacement` 存的是**屏幕坐标**（`screenPos`，CSS 坐标 × k，
  相对视觉视口左上角），`applyPlacement` 换成 `transformOrigin: top left` 并按
  `fromScreen(pos)` 还原：150% 下拖到屏幕某处，缩回 100% / 缩到 80% 它在屏幕上还在那一处；
  `localStorage['visual-revise:panel-pos']` 里记的同样是屏幕坐标。（AC-5.13）
  覆盖：`zoom.mjs` 3 条（1.5 下拖到 (200,30) / 缩回 1 停在 (300,45) / 缩到 0.8 停在 (375,56)）
- **10.2.5** `moveTo` 的夹取改成夹在**视觉视口框**里（`viewportBox()` 的 left/top/width/height），
  不是布局视口——捏合时它比布局视口小、还可能偏着。（AC-5.12③）
  部分覆盖：`zoom.mjs`（「捏合 ×2 + 记忆位置」间接；缺「捏合时拖到视口外被夹回」的直接断言）
- **10.2.6** `[捏合]` 未拖过时贴**视觉视口**的右上角（`offsetLeft/Top` + `width/height`），
  捏合后平移（`visualViewport` 的 `scroll` 事件）也跟着走；捏合复原后回到布局视口右上角。（AC-5.12③）
  覆盖：`zoom.mjs` 3 条（捏合 ×2 贴角 / 捏合复原 / 捏合并偏移后贴视觉视口右上角）

### 10.3 工具条（`toolbar.element.js` 的 `syncZoom`）

- **10.3.1** `[k≠1]` 未拖过：`transform: translateX(-50%) scale(1/k)`、`transformOrigin: top center`、
  `left` 取**视觉视口中线**（`b.left + b.width/2`，捏合平移后它不在 50%）、`top = topOf(20, k)`；
  屏幕高度不变。（AC-5.11、AC-5.14）
  覆盖：`zoom.mjs` 4 条（1.5 下的组合 transform 与原点 / 仍居中且顶边 20÷1.5 /
  捏合 ×2 居视觉视口中线 / 捏合并偏移仍居其中线）
- **10.3.2** 拖过之后记屏幕坐标（`#screen = screenPos(this)`），`syncZoom` 换成
  `transformOrigin: top left` + `scale(1/k)` 并按屏幕坐标还原；拖动过程中也保留 scale
  （原来是硬写 `transform: 'none'`，缩放着拖会突然变大）。（AC-5.13）　待测
- **10.3.3** k 回 1 且视觉视口没偏时 `transform` / `left` / `top` 全部清空，回到样式表的 top 20 居中。
  覆盖：`zoom.mjs`（「缩回 1：工具条 transform 清空、回到 top 20」）

### 10.4 改动记录列表（`change-list.element.js` 的 `syncZoom`）

- **10.4.1** `[k≠1]` 未拖过：`scale(1/k)`、`transformOrigin: top right`、
  `top = topOf(88, k)`、`right = rightOf(304, k)`。（AC-5.11）
  覆盖：`zoom.mjs`（「缩放 1.5：改动列表 scale、右上角 304/1.5、88/1.5」）
- **10.4.2** 拖过之后记屏幕坐标（`#screen`），左上角原点还原；拖动过程中把
  `transformOrigin` 切到 `top left`。（AC-5.13）　待测
- **10.4.3** `max-height` 按 `viewportMaxHeight(k, 104)` 乘回；`connectedCallback` 里
  `syncZoom()` + `onZoom()` 订阅，`disconnectedCallback` 里退订。（AC-5.11）　待测

### 10.5 四个弹层（`controls/popover-host.js`）

- **10.5.1** `[k≠1]` 弹层宿主挂上时读**一次**倍数（弹层活不过一次交互，不订阅变化），
  k≠1 就 `transformOrigin: top left` + `scale(1/k)`——定位用的是锚点的视口坐标，
  缩完左上角还贴着锚点。四个弹层（菜单 / 填充 / 色盘 / 下拉）共用这一条。（AC-5.11）
  覆盖：`zoom.mjs` 2 条（缩放 1.5 下打开颜色弹层 / 捏合 ×2 下打开）

### 10.6 贴在页面元素上的物件（`--vr-inv-zoom`）

- **10.6.1** `--vr-inv-zoom`（= 1/k，k 含页面缩放与捏合）写在编辑器自己的
  `<style id="visual-revise-zoom-vars" data-visual-revise-ui>` 里，选择器只命中
  `visbug-handles, visbug-hover, visbug-corners, visbug-label, visbug-distance, visbug-gridlines,
  [data-visual-revise-guide]`；**k=1 时整条规则移除**、页面上不留痕迹；
  退出编辑器 `clearZoomStyles()` 清掉；**不碰页面的行内样式**。（AC-5.15）
  覆盖：`zoom.mjs` 2 条（「把手圆点 8px→5.33、描边不超过 1px、标签字号 12.8→8.53」
  「缩回 1：把手圆点回 8px、变量样式表移除」）
- **10.6.2** 把手：圆点 `0.5rem × (1/k)`、边框 `1px × (1/k)`、命中区 `inset: -0.5rem × (1/k)`。
  （AC-5.15）　覆盖：`zoom.mjs`（同上第一条）
- **10.6.3** 其余物件同样乘 `--vr-inv-zoom`：标签字号 16px + 内边距 2px/6px、
  hover 描边 2px、角标 5×5 与 1px 描边、测距线粗细 1px 与 16px 字号、
  标尺线描边 1px、拖出的参考线 1px。（AC-5.15）
  部分覆盖：`zoom.mjs` 只验了把手圆点 + 标签字号；**hover / corners / distance / gridlines /
  guide 五处待测**
- **10.6.4** 选中框、参考线、批注钉子的**位置**不反向缩放——它们贴在页面元素上，
  本来就该跟着页面一起放大。（AC-5.14）　待测

---

## 11. 建议的测试分组

六组，每组可由一个独立的 Playwright 测试 agent 在一个套件文件里覆盖，互不抢文件。
公共前置（**每组都要**）：

- `npm run extension:build`（跑测试前必须，bundle 是构建产物）
- `import { serve, launch, injectVisBug, ok } from './harness.mjs'`；
  `serve()` 起本地静态服务、`launch({ headless: true })` 用**系统 Chrome**
  （`playwright-core` 不自带浏览器，路径可用 `CHROME_PATH` 覆盖）
- 断言打 `✔` / `✘`（汇总器 `all.mjs` 只认这两个符号）
- 页面里可用 `window.__visualRevise.store`（ChangeStore）

| 组 | 覆盖的功能点 | 套件文件 | 夹具 | 特殊前置 |
|---|---|---|---|---|
| **A. 网页缩放与视觉视口** | §10 全部（10.1.1–10.6.4，26 点） | 扩写 `tests-e2e/zoom.mjs`（现 24 条） | `tests-e2e/fixture.html` | **CDP**：`page.context().newCDPSession(page)` → `Emulation.setDeviceMetricsOverride`（DPR + 视口，模拟浏览器缩放）与 `Emulation.setPageScaleFactor`（模拟捏合）；模拟扩展消息用 `document.documentElement.dataset.visualReviseZoom` + `visual-revise:zoom` 事件。10.1.1 需**真实扩展**（`launchPersistentContext` + `--enable-unsafe-extension-debugging` + CDP `Extensions.loadUnpacked`，照 `tests-e2e/extension.mjs` 的写法），建议单独放进 `extension.mjs` 或明确 SKIP |
| **B. 拆分行（四角 / 四边 / 内外边距）** | 2.5.15、2.5.16、2.5.19–2.5.21、2.6.3–2.6.10、2.9.6–2.9.13、2.14.2、5.5.7（23 点） | 新建 `tests-e2e/full/split-rows.mjs`（或续写 `acceptance-panel.mjs` 的 6.37/6.38 段） | **新建** `tests-e2e/full/fixtures/split-rows.html`：需要「四角不等」（如 `border-radius: 4px 12px 20px 0`）与「四边不等」（`border-width: 1px 2px 3px 4px`）两个元素——现在 `acceptance-panel.mjs` 是运行时 `page.evaluate` 造 `#uneven-b`，落成固件更稳 | 无特殊权限。需要验快照往返的话再加一次「导出 JSON → 重置 → 导入」的往返（走改动列表的导出 / 导入按钮，导入用 `page.setInputFiles`） |
| **C. 数值框单位 / 字距百分比 / 线型预览** | 2.3.14–2.3.19、2.7.9、2.9.14、3.1.12（9 点） | 续写 `acceptance-panel.mjs`（6.39/6.40/6.43 段）或新建 `tests-e2e/units.mjs` | `tests-e2e/fixture.html`（`.card-body` 的 `line-height: 1.5` 计算出 22.5px 正好用来验后缀拆分；`.hero-eyebrow` 的 `letter-spacing: .18em` 用来验百分比回读） | 无特殊权限 |
| **D. 「On this page」色板 + 变量搜索** | 3.4.9–3.4.16、3.6.9、2.11.12–2.11.16（14 点） | 续写 `tests-e2e/acceptance-variables.mjs`（本轮已加 11 条） | 需要一个采集口径能验全的页面：`:root { --ink / --surface … }` 多个颜色变量（验搜索过滤要 ≥10 个、名字里有共同子串如 `ink`）+ 半透明色（`rgba(200,30,40,.5)`）+ 内联 `<svg fill/stroke>` + 四边同色的描边元素 + 一个 `display:none` 的元素。可扩 `tests-e2e/full/fixtures/variables-grid.html` 或新建 | 无特殊权限。注意色盘 / 填充弹层的色块在各自 shadow root 里，`querySelector` 不跨 shadow；弹层被工具条盖住时用 `page.evaluate` 派发 `click`（弹层只认 click，不认坐标） |
| **E. 键盘换位 / 粘贴守卫 / 把手撤销 / 列表跟随 / 线的透明度** | 4.1.20–4.1.30、4.2.5–4.2.10、4.5.6–4.5.8、5.1.17–5.1.25、2.14.1、2.14.3（31 点） | 补齐已有的 `tests-e2e/keymove.mjs`（8 条）/ `paste.mjs`（5 条）/ `resize-undo.mjs`（11 条）/ `list-follow.mjs`（8 条），线的透明度并进 `guides.mjs` | `tests-e2e/fixture.html`（`.curve-card ×3` 做同父级换位；`.hero-title` 做列表跟随的「条目在最底下」；`.hero-bar button ×2` 做多选换位） | paste 用页内派发 `ClipboardEvent` + `DataTransfer` 构造，**不需要**剪贴板权限；若改用真实剪贴板则需 `page.context().grantPermissions(['clipboard-read','clipboard-write'], { origin })`。把手在上游组件的 **closed shadow root** 里，得从组件实例的 `$shadow` 上取（见 `resize-undo.mjs` 的写法）。4.1.26 需要先 `⌘/` 唤出上游工具条再激活 Position / Move 工具 |
| **F. Figma 风格快捷键（实现中）** | 4.7.1–4.7.8（8 点） | **新建** `tests-e2e/copy-props.mjs` / `copy-image.mjs` / `replace-element.mjs`（`all.mjs` 已注册这三个名字，文件不建的话跑批会异常退出） | `tests-e2e/fixture.html` | **必须** `page.context().grantPermissions(['clipboard-read','clipboard-write'], { origin })`（⌘⇧C 写图、⌥⌘V / ⌘⇧R 读剪贴板）。**Windows 变体**：用 `page.addInitScript` 在 `injectVisBug` **之前**覆写 `navigator.platform`（`isMac` 是模块加载时算的），再 `page.evaluate` 派发带 `ctrlKey:true` 的 `KeyboardEvent`；同时验两个反向条件（Mac 上 Ctrl 组合不触发、Win 上 Meta 组合不触发）。⌘⇧R 与浏览器硬刷新同键位，测试里要断言页面**没有**重新导航（比如挂一个 `page.on('framenavigated')` 计数）。三个 agent 各自只改自己名下的文件，不碰 `all.mjs` / `harness.mjs` / `docs/PRD.md` |

**分组理由**：A 是唯一需要 CDP 的一组，隔离出来免得别的套件被 `Emulation.*` 的残留污染；
B / C 都在属性面板但 B 要新固件、C 只要现成固件，分开可并行；D 全在弹层里、共用一套颜色固件；
E 是四个已有小套件的补测，改动分散但都不需要新固件；F 依赖三个还没写的模块，
必须等实现 agent 完成后才能跑，单独一组不阻塞前五组。

**跑批顺序建议**：B → C → D 可并行（同一进程内互不干扰的三个套件）；A 单独跑；
E 并行；F 最后（依赖实现）。全部就绪后把新套件补进 `tests-e2e/full/all.mjs` 的 `SUITES`。

---

## 12. 本轮的已知风险

- `tests-e2e/all.mjs` 里 `copy-props` / `copy-image` / `replace-element` 三个套件名已注册但**文件不存在**，
  现在跑 `npm run test:e2e` 这三个会以非 0 退出、计入「套件异常退出」。跑全量前要么先建桩文件，要么临时摘掉。
- `app/features/{copy-props,copy-image,replace-element}.js` 目前全是 `return false` 的桩，
  §4.7 的 8 个点在实现落地前**全部不可测**。
- 全部改动**尚未提交**（基线 `f9ce7ed`）。v1 清单的 §8 覆盖矩阵与 §9 缺口清单仍描述提交前的状态，
  其中 §9.1 的「4.2.1–4.2.4 选中框把手零覆盖」已由本轮的 4.2.5–4.2.10 + `resize-undo.mjs` 部分补上，
  §9.2 的「4.5.1–4.5.5 标尺线只有 3 条断言」仍然成立（本轮只加了透明度，几何断言未补）。
