# 功能清单（用于全量 e2e）

> 关联：验收条目编号见 [../PRD.md](../PRD.md)（AC-x.y）；变量绑定与色盘的设计背景见
> [color-picker-variables.md](color-picker-variables.md)；跨容器重排的设计背景见
> [cross-container-reorder.md](cross-container-reorder.md)。
> 本篇之后新增 / 改写的功能点见 [feature-inventory-v2.md](feature-inventory-v2.md)（增量续篇，编号沿用本篇）。
> 本篇是「每个 tab 的每个功能都测一遍」的测试集清单，只列**可操作的功能点**，不描述架构。
>
> **规模**：374 个功能点 / 10 个一级分区 / 50 个二级分区。现有 e2e 约 1057 条断言、30 个套件（另有 6 个孤儿脚本不在 `all.mjs` 里）。

> 关联：按本清单构造的全量 e2e 测试集与结果见 [full-e2e-report.md](full-e2e-report.md)（套件 `tests-e2e/full/`）。

## 0. 阅读约定

- **编号**：`N.M.K` 是本清单的功能点编号，测试用例应引用它。`AC-x.y` 是 PRD 里的验收条目。
- **条件标记**：
  - `[文字]` 只在 `isTextElement(el) && !isReplacedElement(el)` 的元素上出现（`core/dom-utils.js:75`、`core/controls.js:318`）
  - `[替换元素]` 只在 `img|video|canvas|svg|iframe|embed|object` 上出现（`core/controls.js:318`）
  - `[flex/grid 自身]` 只在自身 `display` 含 flex/grid 时出现（`core/controls.js:363`）
  - `[flex/grid 子项]` 只在**父级** display 含 flex/grid 时出现（`core/controls.js:358`、`:276`）
  - `[定位非 static]` 只在自身 `position !== static` 时出现（`core/controls.js:366`）
  - `[有背景图]` 只在 `parseFills()` 里存在非 solid 层时出现（`core/controls.js:346`）
  - `[非文字元素隐藏]` `img/video/canvas/iframe/embed/object` 上整块不渲染（`core/controls.js:329`）
- **入口**：扩展图标点击或 `Alt+Shift+D`（`extension/manifest.json:35-43`），注入 `extension/toolbar/inject.js:18-46`，
  挂载入口 `app/core/visual-revise.js:31`。
- **默认位置**：工具条 `top:20 / left:50% / translateX(-50%)`（`toolbar.element.css:16-19`）；
  属性面板 `top:88 / right:16 / width:300`（`props-panel.element.css:17-20`）；
  改动记录 `top:88 / right:304 / width:300`（`change-list.element.css:15-18`）。
- **注意**：`<vis-bug>` 上游工具条默认 `display:none`（`core/visual-revise.js:42`），13 个单字母工具热键被解绑
  （`core/visual-revise.js:51`）。它仍可用 `⌘/`（Mac）/ `Ctrl+/`、`⌘.` / `Ctrl+.` 唤出，见 §1.8。

---

## 1. 工具条（Toolbar）

代码：`app/components/toolbar/toolbar.element.js`（426 行），样式 `toolbar.element.css`。
DOM：`<visual-revise-toolbar>` 挂在 `document.body`，内容全在 shadow root 里。
按钮顺序：`布局方向 | 分段(浏览/选择/评论) | 撤销 重做 | 记录 复制提示词 | 关闭`（`:145-167`）。

### 1.0 唤起 / 收起整个编辑器　快捷键：`Alt+Shift+D`　代码：`extension/manifest.json:35`、`extension/toolbar/inject.js:18`

- **1.0.1** 点扩展图标 → 页面上出现工具条 + `<vis-bug>`（隐藏）；再点一次 → `visbug.remove()` 走 `disconnectedCallback`，UI 全部消失。（AC-1.1）　现有覆盖：`tests-e2e/extension.mjs`（有）
- **1.0.2** `Alt+Shift+D` 与点图标等价。（AC-1.2）　现有覆盖：无（需真实扩展环境）
- **1.0.3** 收起后再次唤起，改动记录仍在（同标签页）。（AC-1.3）　现有覆盖：`tests-e2e/extension.mjs`
- **1.0.4** 重复注入不叠出第二套 UI：`inject.js:25` 判 `document.querySelector('vis-bug')`；`visual-revise.js:37` 判 `visual-revise-panel` 已存在则直接返回。（AC-1.5）
- **1.0.5** 死元素自愈：存在 `<vis-bug>` 但没有 `<visual-revise-toolbar>` 时先 `remove()` 再重注入（`inject.js:19-23`）。（AC-1.6）
- **1.0.6** 页面里跑的是旧 bundle 时 console.warn 版本不一致（`inject.js:57-69`）；就绪日志 `[Visual Revise] 已就绪 · 构建于 X`（`visual-revise.js:635`）；版本写到 `document.documentElement.dataset.visualReviseBuild`（`:639`）。
- **1.0.7** 右键菜单 `Show/Hide` 等价于点图标（`extension/contextmenu/launcher.js:22-30`）。　现有覆盖：无

### 1.1 布局方向切换（第一格）　快捷键：无　代码：`toolbar.element.js:121-129`、`:393`

- **1.1.1** 点一下 → 宿主上 `vertical` 属性开合，工具条在横排 / 竖排间切换。（AC-5.8）　现有覆盖：`tests-e2e/toolbar.mjs`
- **1.1.2** 图标显示的是「点下去会变成的方向」——竖排时显示 `layoutHorizontal`，反之亦然（`:115`）。
- **1.1.3** 选择写入 `localStorage['visual-revise:orientation']`（`:78-88`），下次注入沿用；`localStorage` 抛异常时静默降级为横排（`:81-83`）。（AC-5.8、AC-5.5）
- **1.1.4** 换向后清掉拖过的 `left/top/transform`，回到 CSS 默认摆位（`:126-128`）。
- **1.1.5** 换向后分段滑块重算落点（`#moveThumb`，`:235-259`）；竖排走 `translateY`，横排走 `translateX`（`:246-254`）。（AC-5.10）
- **1.1.6** 换向后已打开的 tooltip 收掉（`:118`）。

### 1.2 模式分段控件　快捷键：`V` / `A`·`F` / `C`　代码：`toolbar.element.js:64-72`、`:385`；`visual-revise.js:288-311`、`:367-389`

三个按钮（`MODES`，`:64-72`）：浏览页面 `V`、选择元素 `A / F`、评论 `C`。**没有**「重排」按钮（结构已并进面板 tab）。

- **1.2.1** 点「浏览页面」或按 `V` → `setMode('browse')` → `enterInteractive()`：暂停选择引擎、`visbug.deactivate_feature()`、把 `UI_TAGS` 里所有覆盖层 `display:none`、面板隐藏、记录列表隐藏、评论层隐藏、清高亮。（`visual-revise.js:123-144`）（AC-2.3/2.4/2.6）　现有覆盖：`tests-e2e/core.mjs`、`acceptance.mjs`
- **1.2.2** 浏览模式下**工具条仍在**（`toolbar.hidden = stealth`，stealth 此时为 false，`:374`）。（AC-2.5）
- **1.2.3** 浏览模式下点页面元素不会被选中；页面自己的 click / hover 正常。（AC-2.3）
- **1.2.4** 退出浏览模式：`exitInteractive()` 恢复选择引擎、恢复之前的 VisBug 工具（**直接调用 `visbug[tool]()`，不走 `toolSelected`**，`:155-156`）、恢复覆盖层、恢复原选中集（`:146-163`）。
- **1.2.5** 点「选择元素」或按 `A` → `setMode('select')` 且面板切到 `props` tab；按 `F` → 同样进 select 但切到 `structure` tab（`visual-revise.js:293-300`）。（AC-2.12）　现有覆盖：`tests-e2e/panel.mjs`、`tree.mjs`
- **1.2.6** 按 `A`/`F` 时若当前没有选中元素（`panel.target` 为空），只切模式不切 tab（`:297`）。（AC-2.13）
- **1.2.7** 点「评论」或按 `C` → `setMode('comment')`，`comments.setActive(true)`，toast「点击任意元素写下需求 · 可连续标注 · Esc 退出」（`:364`、`:388`）。
- **1.2.8** 模式键**幂等**：连按 `C` 一直停在评论模式，不 toggle 回 select（`:305-310` 注释）。（AC-2.2）　现有覆盖：`tests-e2e/core.mjs`
- **1.2.9** 非 select 模式下 `engine.unselect_all()` + `panel.hidden = true`（`:383-386`）。
- **1.2.10** 高亮跟随：`toolbar.setMode()` 给当前按钮加 `data-on`，其余移除，滑块滑到该按钮（`:224-231`）。（AC-2.1）　现有覆盖：`tests-e2e/toolbar.mjs`
- **1.2.11** 只有模式**真的变了**才 toast（`changed && MODE_HINTS[next]`，`:388`）。
- **1.2.12** 切模式不丢改动记录（记录活在 `ChangeStore`）。（AC-2.11）

### 1.3 撤销 / 重做　快捷键：`⌘Z` / `⌘⇧Z`（Win 上 `⌘Y`/`Ctrl+Y` 也认）　代码：`toolbar.element.js:388-389`；`visual-revise.js:180-190`、`:208-220`

- **1.3.1** 点撤销 / `⌘Z` → `ChangeStore.undo()`，toast「已撤销：<label>」；无可撤销时 toast「没有可撤销的操作」且 kind=error（`:180-184`）。（AC-4.1）　现有覆盖：`tests-e2e/history.mjs`
- **1.3.2** 点重做 / `⌘⇧Z` / `⌘Y` → `ChangeStore.redo()`，同上（`:186-190`、`:218`）。
- **1.3.3** 按钮 disabled 状态跟 `ChangeStore.canUndo/canRedo` 走（`:201-212`）。
- **1.3.4** 按钮 tooltip 写出**将要撤销的是什么**：`dataset.tipLabel = "撤销：<label>"` 或「没有可撤销的操作」（`:211`）。
- **1.3.5** 在输入框里打字时 `⌘Z` 让路给浏览器的文本撤销（`isTypingTarget(e)` → return，`:214`）。（AC-4.3）　现有覆盖：`tests-e2e/history.mjs`
- **1.3.6** 一次批量动作（切排列 / 填满 / 网格 N×M / 四边联动 / 移动）是**一条**历史，`⌘Z` 整体退回（`core/history.js:66-82`）。（AC-8.3）
- **1.3.7** 同元素同属性、400ms 内的连续 `applyProp` 合并成一条（`core/history.js:17`、`:29-45`）——拖标签调值后 `⌘Z` 一次退回。

### 1.4 改动记录开关 / 复制提示词　快捷键：`L` / `P`　代码：`toolbar.element.js:390-391`；`visual-revise.js:313-325`

- **1.4.1** 点「记录」或按 `L` → `list.hidden` 取反，显示时 `list.render()`（`:192-195`）。（AC-4.7）　现有覆盖：`tests-e2e/list.mjs`
- **1.4.2** 记录按钮上的计数角标 = `ChangeStore.stats().total`；为 0 时带 `data-empty`（`:216-217`）。
- **1.4.3** 点「复制提示词」或按 `P` → `doCopy()`（§6.1）。（AC-4.7）
- **1.4.4** 有改动时复制按钮带 `data-ready`（`:218`）。

### 1.5 关闭编辑器　代码：`toolbar.element.js:392`；`visual-revise.js:528`

- **1.5.1** 点 `×` → `visbug.remove()` → `destroy()`：解绑所有 document 监听、`ChangeStore.unobserve()`、移除 panel/list/comments/toolbar/layoutDrag/locate-overlay（`visual-revise.js:589-607`）。
- **1.5.2** 工具条的 `×` 关的是**整个编辑器**；面板的 `×` 只收面板（§2.1.5）。（AC-2.10）

### 1.6 Tooltip 气泡　代码：`toolbar.element.js:311-370`、`:377-383`

- **1.6.1** `pointerover` 命中 `[data-tip]` → 显示气泡；`pointerleave` / `pointerdown` → 收起（`:377-383`）。
- **1.6.2** 气泡内容 = 名称 + 快捷键，取自 `MODES` / `TIPS`（`:64-72`、`:90-97`）：布局(无键) / 记录 `L` / 复制提示词 `P` / 撤销 `⌘Z` / 重做 `⌘⇧Z` / 关闭 `⌥⇧D` / 浏览 `V` / 选择 `A / F` / 评论 `C`。
- **1.6.3** 横排时气泡在按钮**下方**沿 x 定位；竖排时在**右侧**沿 y 定位（`:341-347`）。（AC-5.9）
- **1.6.4** 气泡超出视口时整体夹回，箭头往回补同样距离（`:354-364`）。

### 1.7 拖动工具条　代码：`toolbar.element.js:398-423`

- **1.7.1** 在 `.bar` 空白处（**不是按钮上**，`:400`）按下拖动 → `transform:none` + 绝对 `left/top`。
- **1.7.2** 位置**不落盘**（与面板不同，工具条无 `savePlacement`）——刷新回默认位置。

### 1.8 遗留 VisBug 工具条（隐藏入口）　快捷键：`⌘/` 或 `⌘.`（Win：`Ctrl+/` `Ctrl+.`）　代码：`app/components/vis-bug/vis-bug.element.js:135-139`

> 这是 fork 里唯一还能触达上游 13 个工具的路径。`toolbar_model` 的单字母热键已被解绑
> （`visual-revise.js:51`），但 `⌘/` 这条**没有**被解绑，因此 §4.6 里那批工具仍可被激活。

- **1.8.1** 按 `⌘/` 或 `⌘.` → `<vis-bug>` 宿主 `display` 在 `none`/`block` 间切换，上游竖排工具条出现。　现有覆盖：**无**
- **1.8.2** 工具条出现后点任一工具 → `toolSelected()`（`:156-170`）→ 停用旧工具、激活新工具，该工具的方向键 / 鼠标操作生效（§4.6）。　现有覆盖：**无**
- **1.8.3** 默认激活的工具是 `guides`（`vis-bug.element.js:66`）。
- **1.8.4** 上游工具条自身可拖动（`draggable`，`:120-124`）。

---

## 2. 属性面板（Props panel）

代码：`app/components/props-panel/props-panel.element.js`（2534 行）。
DOM：`<visual-revise-panel>` 挂 body，内容在 shadow root。整体结构见 `#renderPanel()`（`:531-551`）。
只在**选择模式且有选中元素**时显示（`visual-revise.js:100-110`）。

### 2.1 头部　代码：`:534-543`

- **2.1.1** 元素名：`describeTarget(el)` = `tagname.class1.class2…`（稳定类名，`:233-236`、`core/anchors.js`）。
- **2.1.2** 副标题 `.sub`：`已选 N 个 · ` + `N 项改动` / `未改动` + ` · 联动 N 个`（`#subtitle()`，`:473-480`）。
- **2.1.3** **共享元素**按钮（菱形图标）：点一下 `setShared()` 开合；开启时找同构兄弟、逐个 track、toast「已联动 N 个」，按钮加 `data-on`（`:365-378`、`:2221-2226`）。之后所有写入落到 `#scope()` 全集（`:351-355`、`:360-363`）。（AC-7.6）　现有覆盖：`tests-e2e/advanced.mjs`
- **2.1.4** **折叠**按钮：`this.toggleAttribute('collapsed')`（`:2220`），CSS 把 `.scroll` 隐藏（`props-panel.element.css:35`）——只收内容，标题栏留着。
- **2.1.5** **关闭 `×`**：派发 `vr-close` → 宿主 `engine.unselect_all()`，**不改变当前模式**、**不改变面板位置**（`:2219`；`visual-revise.js:550-556`）。（AC-2.10）　现有覆盖：`tests-e2e/panel.mjs`
- **2.1.6** **拖动头部**移动面板：`#makeDraggable(header)`（`:2497`、`:2500-2523`），按在 `<button>` 上不触发（`:2503`）；`moveTo()` 实时把面板夹在视口内（`core/placement.js:47-62`）；松手时 `savePlacement()` 写 `localStorage['visual-revise:panel-pos']`（`:2518`、`placement.js:31-38`）。（AC-5.2/5.3）　现有覆盖：`tests-e2e/acceptance-panel.mjs`
- **2.1.7** 面板**固定位置**，不跟着选中元素跑（`visual-revise.js:109` `applyPlacement(panel)`）。（AC-5.1）
- **2.1.8** 窗口 resize 时重新夹取位置（`visual-revise.js:117`）。（AC-5.3）
- **2.1.9** 未选中元素时的空态：「点击页面上的任意元素开始编辑 / `Tab` 临时退出编辑态 / `Esc` 取消选中」（`:501-503`）。
- **2.1.10** 面板内 `keydown` 一律 `stopPropagation`（`:293`）——保证 Enter / Delete 不漏给 hotkeys-js。（AC-6.30）
- **2.1.11** 面板内滚轮不穿透到页面：`containScroll()`（`:296`、`core/dom-utils.js:51`）。
- **2.1.12** 重新渲染时保留滚动位置（同一元素才保留，`:491-492`、`#restoreScroll` `:519-529`）。

### 2.2 tab 切换　代码：`:544-547`、`:2132-2142`、`:342-349`

- **2.2.1** 两个 tab：「选择元素」（`props`）、「结构」（`structure`）。点击切换并派发 `vr-tab` 事件（`:2139-2141`）。
- **2.2.2** 切到 structure 时 `#tree.reveal()` 补滚到选中行（`:348`）。（AC-2.15）
- **2.2.3** 快捷键 `A` → props tab，`F` → structure tab（`visual-revise.js:293-300`）。（AC-2.12）
- **2.2.4** 页面直接拖拽在**整个选择模式**下都开着，不再随 tab 开关（`visual-revise.js:377-380`）。⚠️ 与 AC-2.14 的旧描述不一致，以代码为准。

### 2.3 「选择元素」tab — 分区通用行为

分区定义：`core/tracked-props.js:21-105`（GROUPS）。渲染：`#renderGroup()` `:628-673`。
七个分区固定顺序：**Position / Layout / Appearance / Typography / Fill / Stroke / Effects**。

- **2.3.1** 点分区标题 `h3` → 折叠 / 展开（`section` 上 `folded` 属性 + `#folded` Set）（`:2062-2067`）。
- **2.3.2** Typography 与 Effects **默认折叠**（`:246`）。（AC-6.15）　现有覆盖：`tests-e2e/typography.mjs`
- **2.3.3** 选中**文字元素**时 Typography 自动展开——只在 target 真的换了时做一次，用户手动折叠后不会被弹开（`:329-335`）。（AC-6.15）
- **2.3.4** 标题栏按钮上的 click 不冒泡到 h3，不会顺带折叠（`:2070`）。
- **2.3.5** **重置本组** `↺`：`#resetGroup(id)` 对 scope 里每个元素、该组每条属性调 `ChangeStore.undoProp`，toast「已重置 <Label>」（`:2042-2056`、`:2072`）。仅在该组真的改过时显示（`section[data-dirty]`，`:463-467`）。（AC-6.14）　现有覆盖：`tests-e2e/panel.mjs`
- **2.3.6** **临时关闭本组** 眼睛（仅 Position/Layout/Appearance/Typography… 实际只有 `HIDEABLE` 里的 fill/stroke/effects，且**非层列表**分区才挂；因 fill/stroke/effects 都是层列表分区，标题级眼睛在当前 UI 里实际不渲染）：`#toggleSection(id)` 存 inline 原文再写关闭值，再点原样放回（`:2016-2040`、`:2071`）。（AC-6.14、AC-6.18、AC-6.23）
- **2.3.7** `hideMapFor()`：fill 分区对 `[文字]` 元素额外关掉 `color`；纯容器不动 `color`（`:168-171`）。（AC-6.18）
- **2.3.8** **绑定变量**按钮（四点图标）：只在 fill / stroke 出现，**effects 没有**（`:653-654`）。点开 `#varMenu(groupId)` → 决定绑哪条属性：stroke→`border-color`、`[文字]`→`color`、其余→`background-color`（`:1579-1586`）。（AC-6.23c）　现有覆盖：`tests-e2e/figma.mjs`
- **2.3.9** **加号**：只在 fill / stroke / effects 出现（`LAYERED`，`:83`）。fill→加一层纯色 `#c4c4c4`；stroke→写 `border-style:solid` + `border-width:1px`（**不碰 border-color**）；effects→先弹类型菜单（`#addLayer` `:1552-1572`、`#effectMenu` `:1292-1302`、`:2359-2364`）。（AC-6.10、AC-6.11、AC-6.12）
- **2.3.10** 在**收起的**分区上点加号会自动展开（`#folded.delete(id)`，`:1555`、`:1297`）。（AC-6.23b）
- **2.3.11** stroke 已有描边时加号 `disabled`，title 变「CSS 的 border 只有一层，不能再加」（`#canAdd` `:615-620`、`#addTitle` `:622-626`）。（AC-6.11b）
- **2.3.12** fill / stroke / effects **空状态也渲染**（标题 + 加号）（`:637-639`）。（AC-6.22）
- **2.3.13** 改过的字段标签变「已改」色（`label.name[data-dirty]`，`:454-460`）。（AC-6.13）

### 2.4 分区 1：Position（定位）　代码：`tracked-props.js:22-33`

字段来自 `#defaultRows()`（`:1024-1112`）。`right` / `bottom` 被 `HIDDEN_FIELDS` 挡掉不渲染但仍跟踪（`controls.js:140-146`）。

| # | 控件 | 类型 | 写入 | 条件 / 边界 |
|---|---|---|---|---|
| 2.4.1 | 定位 | `vr-select`：static / relative / absolute / fixed / sticky | `position` | 改它会**整块重绘**（`RERENDER_ON`，`:183`、`:1963`） |
| 2.4.2 | 位置 X | 输入框，前缀 `X` 可横向拖 | `left` | `[定位非 static]`；`coerceLength`：裸数字补 px，`1rem/50%/auto` 原样 |
| 2.4.3 | 位置 Y | 输入框，前缀 `Y` 可横向拖 | `top` | 同上。X/Y 共用一个「位置」标签（`LABELED_PAIRS`，`controls.js:151-153`；`#renderLabeledPair` `:1933-1941`） |
| 2.4.4 | 旋转 | 输入框，前缀 `∠` | `rotate` | `coerceAngle`：裸数字补 `deg`；`none` / 各种 0 写法 → 空（不留空改动）（`controls.js:39-45`） |
| 2.4.5 | 层级 | 输入框，前缀 `Z` | `z-index` | `[定位非 static]`；`coerceNumber` 不补单位（`UNITLESS`，`controls.js:230`） |
| 2.4.6 | 对齐按钮组（6 个） | 按钮：左/水平中/右 · 顶/垂直中/底 | `align-self` / `justify-self` / `margin-*:auto` | **只在父级是 flex/grid 时出现**（`alignSupported`，`controls.js:276-280`）；grid 走 `*-self`，flex 交叉轴走 `align-self`、主轴走 auto 外边距（`alignPlan` `:286-311`）。绑定 `:2073`、执行 `#align()` `:2003-2014` |

- **2.4.7** 数值输入 `ArrowUp/Down` 步进 ±1，`shift` ×10（`:2483-2495`、`stepSize` `controls.js:266-269`）。
- **2.4.8** 拖标签 / 前缀调值：`pointerdown` 捕获指针，每 2px 一步（`:2451-2480`）。（AC-6.1）　现有覆盖：`tests-e2e/panel.mjs`
- **2.4.9** 无法步进的关键字（`normal` / `auto`）返回 `null` → 该次按键忽略；`line-height` 落到 `1.5`、`rotate` 落到 `0deg`（`KEYWORD_START`，`controls.js:239-242`）。

### 2.5 分区 2：Layout（布局）　代码：`#layoutRows()` `:748-767`

- **2.5.1 排列（Flow）** 四个分段按钮：自由 / 纵向 / 横向 / 网格（`FLOWS`，`layout.js:12-19`）。点击 → `planFlow()` 批量写 `display`（block / flex+column / flex+row / grid）（`:2079-2087`）。toast「排列：<名>」。（AC-6.2）　现有覆盖：`tests-e2e/layout.mjs`
- **2.5.2 换行钮**：`flex-wrap` 在 `nowrap` / `wrap` 间切；**只在 flex 排列下可用**，grid/free 下 `disabled`（`:2089-2093`、`:780-782`）。
- **2.5.3 尺寸 W / H**（`#renderDims()` `:1736-1801`）：两个输入框，前缀 `W` / `H` 可拖。写 `width` / `height`。固定模式下框里是声明值，其余模式下是实测值。
- **2.5.4 尺寸模式下拉**（每轴一个 `.mode` 按钮，`:1751-1755`、`#resizeMenu` `:1803-1823`）：菜单五项 —— 固定宽/高度（hint = 当前 px）、贴合内容（`fit-content`）、填满容器（主轴 `flex:1`，否则 `100%`）、分隔线、`添加最小宽/高度…`、`添加最大宽/高度…`。
- **2.5.5** 选「添加最小/最大」只是把字段显示出来、**不写任何声明**，并把焦点移进去（`:1830-1837`）；已有该限制时该项 `disabled`。
- **2.5.6** 限制字段的 `×`（`.drop-limit`）：先清 inline，若值仍在（来自样式表）就写 `LIMIT_RESET`（min→`0`、max→`none`）（`:2194-2217`、`:175-178`）。toast「已移除最小宽度限制」等。
- **2.5.7 比例锁** `.ratio`：点开 → 用 `measure()`（offsetWidth/Height，先关 transition）记比例，toast「已锁定宽高比 X : 1」；元素无尺寸时 toast 报错。再点解除（`:2228-2244`）。锁开着时改 W → H 自动跟随，并做一次实测误差校正（`#applyRatio` `:1974-2001`）。（AC-6.3）　现有覆盖：`tests-e2e/resizing.mjs`
- **2.5.8** 比例锁绑在具体元素上，换元素即作废（`:319`）。
- **2.5.9 对齐九宫格**（`#renderAlignGap` `:787-810`）：3×3 共 9 个按钮，写 `justify-content` / `align-items`（`planAlignment`，`layout.js:80`）。**只在 flex 排列下渲染**（`isFlexFlow`，`:757`）。绑定 `:2095-2103`。（AC-6.4）
- **2.5.10 间隔 gap**：输入框，标签可拖。写 `gap`。`[flex/grid 自身]`（`:802-808`）。（AC-6.5）
- **2.5.11 网格行**（`#renderGridRow` `:812-830`）：**只在 grid 排列下渲染**。左边「网格」+ `N × 自动` / `N × M` / `未设置` 按钮；右边列间隔 / 行间隔两个输入（`column-gap` / `row-gap`）。
- **2.5.12 网格点阵弹层**（`#gridPicker` `:834-913`，绑定 `:2146`）：12×12 点阵，hover 预览左上到当前格的矩形并显示 `C × R`，点击定下形状并关闭；顶部两个数字输入（列 / 行，行留空 = 自动），`change` 应用但不关闭、`Enter` 应用并关闭、`Esc` 关闭；底部「打开网格设置」进二级视图。　现有覆盖：`tests-e2e/grid.mjs`
- **2.5.13** `#setGridShape()` 批量写 `grid-template-columns` / `grid-template-rows`（行数为 0 时清掉 rows = 隐式网格），toast「网格：N × M/自动」（`:915-927`）。
- **2.5.14 内边距 / 外边距 两段式**（`#renderSidePair` `:981-1014`）：默认两个框——水平（左右）、垂直（上下），前缀是横线 / 竖线图标、可拖。支持 `"0, 138"` 双值写法（`parsePair`，`layout.js:119`）；只填一个值时两边一起写（`:2116-2129`）。（AC-6.6）　现有覆盖：`tests-e2e/panel.mjs`
- **2.5.15 展开四边**：`.expand-sides` → 四个独立输入（上右下左，前缀 `↑→↓←`）+ **四边联动锁**；`.collapse-sides` 收回（`:2105-2113`、`#renderSides` `:1850-1867`）。展开状态绑在元素上，换元素即收起（`:322`）。
- **2.5.16 四边联动锁** `.lock`：点开时把「上」的值同步写进四边（`:2420-2432`）；开启后改任一边同步四边，整体一次 batch（`:2435-2448`）。
- **2.5.17 裁剪内容**复选框：勾上写 `overflow:hidden`，取消是**清掉声明**而不是写 `visible`（`#renderClip` `:1016-1022`、`:2187-2192`）。`[非文字元素隐藏]`（`controls.js:356`）。（AC-6.7）
- **2.5.18 排序 order**：输入框，前缀 `#`。`[flex/grid 子项]`（`:764`、`controls.js:227`、`:358-361`）。

### 2.6 分区 3：Appearance（外观）

- **2.6.1 不透明度**：输入框，前缀 `◍`。写 `opacity`。step 0.05，min 0 max 1（`controls.js:100`）；`UNITLESS`。
- **2.6.2 圆角**：输入框，前缀 `◜`。写 `border-radius`。
- 这两个并排一行（`FIELD_PAIRS`，`controls.js:166`）。（AC-6.8）

### 2.7 分区 4：Typography（文字）　代码：`#typographyRows()` `:678-745`

**整块条件**：`#showTypography(el)` —— 只在「排得上版」的元素上渲染，不成立时 `#renderGroup` 返回空串、**整个分区不出现**（不是折叠）：
1. `isTextlessElement`（`img/video/canvas/iframe/embed/object`）→ 不渲染；
2. `isTextElement`（有非空白的直接文本子节点）或内联 `<svg>` → 渲染。svg 的文字在子 `<text>` 里，`isTextElement` 认不出来，但它确实继承 `font-*`，单独放行；
3. 都不成立时看兜底：本组已经有 dirty 改动就照常渲染（折叠态）——VisBug 的字体工具能在任意元素上改字号，改动记录里躺着一条 `font-size` 却在面板上找不到地方改回去，比多显示一个分区糟得多。
（AC-6.35）　现有覆盖：`tests-e2e/acceptance-variables.mjs`、`typography.mjs`、`image-fill.mjs`

- **2.7.1 字体**：`vr-select`，占满一行。选项 = 当前栈首 + 已读本地字体 + `COMMON_FONTS`（`:694`）。写回时**只替换栈首**、后备原样保留（`withPrimaryFont`，`:1960`）。（AC-6.9）　现有覆盖：`tests-e2e/typography.mjs`
- **2.7.2 读取本地字体**按钮（下载图标）：仅在 `queryLocalFonts` 可用时渲染（`fontsSupported()`，`:686`）。点击 → 按钮变 `…` → `loadLocalFonts()`；失败 toast 原因（不支持 / 拒绝授权 / 读取失败），成功后补进下拉并 toast「已读取 N 个本地字体」（`:2246-2259`、`core/local-fonts.js:11-30`）。
- **2.7.3 字重**：`vr-select` 100…900。写 `font-weight`（`UNITLESS`）。
- **2.7.4 字号**：输入框，前缀 `Aa` 可拖。写 `font-size`。与字重并排（`:705-717`）。
- **2.7.5 行高**：输入框，前缀图标 `↕`。写 `line-height`。`coerceNumber`（**不补 px**——`24` 是 24 倍行高，与 `24px` 语义不同，`controls.js:196-198`）。
- **2.7.6 字距**：输入框，前缀图标 `AV`。写 `letter-spacing`。与行高并排。
- **2.7.7 对齐**：四段按钮 左 / 中 / 右 / 两端。写 `text-align`（`:726-737`）。
- **2.7.8 「更多」按钮**（四点图标）：展开 `text-transform`（大小写：none/uppercase/lowercase/capitalize）与 `text-decoration-line`（装饰线：none/underline/line-through/overline）两个下拉（`:734-742`、`:2144`）。状态 `#typoMore`，**不随元素重置**。（AC-6.9）

### 2.8 分区 5：Fill（填充）　代码：`#defaultRows()` `:1036-1050`

首行按元素类型变（Figma 的多态 Fill）：

- **2.8.1 图片预览行**（`#renderImageFill` `:1625-1647`）：`[替换元素]` 或 `[有背景图]` 时出现。左缩略图 + 文件名 + 天然尺寸 + **换图按钮**（双箭头）。kind 三种：`图片`(src) / `封面图`(poster) / `背景图`(background)。背景图的天然尺寸异步补量（`#fillImageDims` `:1687-1700`）。
- **2.8.2 换图**（`.swap-image` → `#swapImage()` `:1652-1683`，绑定 `:2074`）：弹文件选择 → `pickImages()`（`image/*`，单张上限 5MB、会话累计 20MB，`core/image-assets.js:11-12`、`:80-81`）→ 背景图走 `background-image: url(dataUrl)`；`<img>`/`<video>` 走 `src`/`poster` 属性，且**先清掉 `srcset`**（`:1669`）。toast「已换图：<名>」；页面 CSP 禁 `data:` 图时改 toast 提示画面不会更新但记录不受影响。（AC-7.2）　现有覆盖：`tests-e2e/swap-image.mjs`、`image-fill.mjs`
- **2.8.3 文字色行**（`#renderTextColorRow`）：`#showTextColor()`（`isTextElement && !isReplacedElement`）时出现，排在层列表**之前**。`vr-color` + 眼睛。**没有减号**（`color` 是独立属性，删不掉）。（AC-6.10c）
- **2.8.3a 没有直接文字的元素连「文字色」那一格都不给**：`color` 这条属性在 `#defaultRows` 里被 `#showTypography` 过滤掉——它跟排版属性一样需要一个「文字」作为作用对象，选中一个只装着子元素的 div，那一格改的是谁的颜色说不清楚。（AC-6.35a）
- **2.8.4 文字色眼睛**（`#toggleTextColor` `:1245-1264`，绑定 `:2388-2391`）：关 → 存 inline 原文 + 写 `color:transparent`（label「隐藏文字」）；开 → 原样放回（label「显示文字」）。一开一关**不留改动记录**。
- **2.8.5 填充层列表**（`#renderFillLayers` `:1524-1548`）：每层一行 = `vr-fill` + 眼睛 + 减号。层来自 `parseFills(computed)` + 被关掉暂存的层按原下标插回（`#fillLayers` `:1119-1124`）。（AC-6.10、AC-6.10a）　现有覆盖：`tests-e2e/fill.mjs`
- **2.8.6 每层眼睛**（`#toggleLayer`，绑定 `[data-layer-eye]`）：关掉时存 `background-color`/`background-image` 的 inline 原文**与 priority**（`{ value, important }`，样式表带 `!important` 时只写回值压不过去，见 AC-6.34c）；再开若「关掉之后没动过别的」就原样放回并清掉侧存储里那条（不清的话下一次 `#fillLayers()` 会把它当成「还藏着的层」再插一次，列表里凭空多出一行），否则按当前层列表重写。
- **2.8.7 每层减号**：`splice(i,1)` 后 `#writeFillLayers`（`:2398-2405`）。
- **2.8.8 层拖拽排序**（`#bindRowDrag('fill')` `:1374-1430`，绑定 `:2366`）：`pointerdown` 起、越过 4px 才捕获指针；按在 `.icon-btn` 上不起拖（`:1386`）；hover 到的行加 `data-drop`；松手 splice 到目标下标。**用 pointer 事件而不是 HTML5 draggable**。（AC-6.12b、AC-6.12b1）　现有覆盖：`tests-e2e/fill.mjs`
- **2.8.9 每一层纯色都能绑变量**（`bindFills` in `core/fills.js`）：判定读**声明原文**（`winningDeclaration`）并按层的 `slot`（它在 computed `background-image` 逗号列表里的下标，效果层跳过但下标照数；底色是 `'color'`）对齐到具体某一段；底层看 `background-color`，其余层看那一段 `<bg-layer>` 里的 `<image>` 是不是 `linear-gradient(var(--x), var(--x))`。页面用 `background:` 简写写的也认得（`cascade.js` 的 `SHORTHANDS` 补了 `background-image → background`）。最后仍要拿变量解析值跟该层 computed 的颜色核对，对不上就不算绑定。
  - 层模型带 `bound: '--x'`，`serializeFills` 遇到它输出 `var(--x)`（底层写 `background-color`，其余写 `linear-gradient(var, var)`）——`#writeBackground` 每次都整体重写两条属性，写解析色的话加一层 / 开关眼睛 / 改另一层就会把绑定静默抹掉。
  - 绑定行 = `vr-fill[bound]`（它自己把触发行渲染成 chip）+ `data-unlink-layer` + 眼睛 + 减号；行仍带 `data-fill-row`，能拖也能当落点，但按在 chip 上不起拖（`#bindRowDrag` 的守卫按 `composedPath` 找 `.var-chip`——chip 在 vr-fill 的 shadow root 里，`e.target` 会被 retarget 成宿主）。
  - `#unlinkLayer(i)` 只清那一层的 `bound` 再整体写回；走 `#unlink(prop)` 会把整条 `background-image` 拍平。（AC-6.32）　现有覆盖：`tests-e2e/acceptance-variables.mjs`
- **2.8.10 背景尺寸**：`vr-select` auto / cover / contain → `background-size`。`[有背景图]`（`controls.js:316`、`:351`）。
- **2.8.11 背景位置**：文本输入 → `background-position`。`[有背景图]`。
- **2.8.12 图片适配**：`vr-select` fill/contain/cover/none/scale-down → `object-fit`。`[替换元素]`（`controls.js:315`、`:350`）。
- **2.8.13 图片位置**：文本输入 → `object-position`。`[替换元素]`。
- **2.8.14** `background-image` **不再单独渲染文本框**（`HIDDEN_FIELDS`，`controls.js:145`），但仍跟踪。

### 2.9 分区 6：Stroke（描边）

- **2.9.1** 没有描边时**只有标题 + 加号**，三个字段全不渲染（`:1030`）。（AC-6.11a）
- **2.9.2 粗细**：输入框，前缀 `▭` → `border-width`。与「样式」并排（`FIELD_PAIRS`，`controls.js:167`）。
- **2.9.3 样式**：`vr-select` none/solid/dashed/dotted/double → `border-style`。
- **2.9.4 颜色**：`vr-color` → `border-color`。可绑变量。
- **2.9.5 位置**：两段按钮「内」/「外」→ `box-sizing: border-box / content-box`（AC-6.11）。

### 2.10 分区 7：Effects（效果）　代码：`#renderEffectRows()` `:1266-1280`

七种（`EFFECTS`，`core/effects.js:22-28`）：内阴影 / 投影 / 图层模糊 / 背景模糊 / 噪点 / 纹理 / 玻璃。

- **2.10.1 加号 → 类型菜单**（`#effectMenu` `:1292-1302`）：七项，选中后新效果**加在列表最前**。（AC-6.12）　现有覆盖：`tests-e2e/figma.mjs`
- **2.10.2 每行**：类型名 + 摘要（`#effectSummary` `:1283-1290`：阴影显示 `x y blur`、玻璃 `blur px · sat %`、噪点 `density%`、纹理 `size`、其余 `blur px`）+ 眼睛 + 减号。
- **2.10.3 点行 → 参数弹层**（`#effectPanel` `:1305-1357`，绑定 `:2369-2372`）。每种的字段（`core/effects.js` FIELDS）：
  - 内阴影 / 投影：X、Y、模糊、扩展（px）、颜色
  - 图层模糊 / 背景模糊：模糊（px）
  - 噪点：颗粒、密度(%)、颜色
  - 纹理：尺寸、强度
  - 玻璃：模糊(px)、饱和(%)、高光(%)
  数字框 `change` 时 `parseFloat` 校验后写入；`vr-color` 派发 `vr-color` 写入。**改值不重绘**（弹层还开着）。（AC-6.12c、AC-9.8）
- **2.10.4 每行眼睛**：`#toggleEffect` 翻 `hidden`（`:1360-1365`、`:2374-2377`）。
- **2.10.5 每行减号**：`splice` 后 `#writeEffects`（`:2379-2386`）。
- **2.10.6 效果行拖拽排序**：`#bindRowDrag('effects')`（`:2367`），同 2.8.8。
- **2.10.7 CSS 落点**：噪点 / 纹理写进 `background-image` 的**最前面几层**（画在填充之上），与填充层共用同一条属性（`#writeBackground` `:1143-1160`）。（AC-6.12a、AC-6.12d）

### 2.11 CSS 变量绑定（跨分区）　代码：`#varBinding`、`core/cascade.js`、`core/fills.js` 的 `bindFills`

- **2.11.1** 颜色控件绑了变量时整行换成 **chip**（圆点 + 变量名），不再有色值 / 不透明度输入（`#renderBoundRow`）。填充层的 chip 是那一层 `vr-fill` 自己的触发器（弹层是实例方法，行里没有实例的话 chip 点了无处可去）。（AC-6.24c、AC-6.32a）　现有覆盖：`tests-e2e/acceptance-panel.mjs`、`acceptance-variables.mjs`
- **2.11.2** 判定读**声明原文**：inline + 命中的样式表规则，由 `winningDeclaration()` 挑层叠赢家。（AC-6.24f）
- **2.11.3** 简写里的一段（`border: 1px solid var(--line)`）也算，但整条简写里只能有一个 `var()` 且解析出来是颜色（`#bindingFrom`）。`background` 简写同理，见 §2.8.9。
- **2.11.4** 字色**继承**：顺祖先往上找到第一条声明（`INHERITED`）；chip title 写「继承自 `<div#x.card>`：…」。（AC-6.24g）
- **2.11.5** 保险：解析出的颜色必须等于 computed，对不上就当没绑定（`sameColor`，现已挪到 `controls/picker.js` 供 `fills.js` 复用）。（AC-6.24h）
- **2.11.6 unlink 按钮**：把 `var()` 换成当前解析出的实际颜色，绑定断开、画面不变（`#unlink`）。填充层走 `#unlinkLayer(i)`，只解那一层。样式表带 `!important` 时写入也带 `!important`，否则压不过去、点了没反应（§5.5）。（AC-6.24d、AC-6.34a）
- **2.11.7 入口只有两个**：分区标题栏的「绑定变量」（`[data-var]` → `#varEntry`）与已绑定的 chip（`[data-var-chip]`，或填充层那一层的 `vr-fill`）。前者按分区首行显示的是什么决定绑哪条属性：文字元素绑 `color`，容器绑底层填充；Stroke 空状态先写 `border-style: solid; border-width: 1px` 再绑（不然 `border-color` 绑了也看不见）。弹层贴 chip **左**缘、贴标题栏按钮**右**缘。（AC-6.24i、AC-6.31d）
- **2.11.8 变量数据源**：`cascade.js` 的 `declaredVariables(root)` 走完整的规则铺平（`@layer` / `@media` / `@supports` / `@import` / `adoptedStyleSheets`，不限选择器），再按**选中元素**解析取值、按 `varKind` 只留颜色、按名排序（`#colorVariables()`，结果缓存到本次 render 结束）。没有匹配项时列表位置显示一行压暗文字「页面上没有颜色变量（另有 N 个其它类型的）」。`resizing.js` 的 `cssVariables()` 已改名 `declaredVariables` 并转调它，`api.lib` 里保留旧名做别名。（AC-6.24e、AC-6.31b）
- **2.11.9 变量页的行**：最左 16px 色圈、变量名、色值（截 18）、**对勾在最右**（`renderVariableList` in `controls/color-popover.js`，颜色弹层与填充弹层共用）。色圈颜色从**选中元素**身上读，不是 `:root`。点当前已勾那一项：不做事、也不关。（AC-6.24j）
- **2.11.10** 选中后写 inline `var(--x)`，顺序是「关弹层 → `#commit` → `render()` → toast」；选中当前那一项不重复写。多选时写 `#scope()` 的全部元素，chip 只反映 `this.target`；unlink 逐元素取各自的解析色。（AC-6.24、AC-6.31c）
- **2.11.11 变量列表不走属性**：面板在每次 render 之后给每个 `vr-color` / `vr-fill` 实例挂 `el.variablesProvider = () => ({ variables, others, bound })`，控件点开时才回问。几十项的 JSON 序列化进每个控件既浪费，还会触发 `attributeChangedCallback` 把触发行整块重建。没挂 provider 的（效果参数面板里的 `vr-color[data-fx]`）拿到 `variables: null` → 只有 Custom 页。（AC-6.31a）

### 2.12 二级视图：网格设置　代码：`#renderGridSettings()` `:930-971`

- **2.12.1** 从点阵弹层底部「打开网格设置」进入（`:907-911`）；`#subview = 'grid'`，面板整块换掉。
- **2.12.2** 头部：`网格设置` + 元素名 + **返回按钮 `×`**（`.back` → `#subview = null`，`:2148`）。
- **2.12.3** 两个分区：「列」`grid-template-columns`、「行」`grid-template-rows`。每条轨道一行：序号 + 类型 `vr-select`（等分 `1fr` / 固定 `100px` / 贴合 `auto`）+ 值输入（贴合时 `disabled`）+ 删除 `−`。
- **2.12.4 加轨道 `＋`**：push 一条 `fill`（`:2150-2155`）。
- **2.12.5 删轨道 `−`**：`splice`（`:2157-2162`）。
- **2.12.6 换类型**：值同时换成该类型的默认写法（`:2164-2174`）。
- **2.12.7 改值**：裸数字补 `px`（`:2176-2185`）。
- **2.12.8** 轨道全删空时写空串（清掉声明）（`#writeTracks` `:973-977`）。
- **2.12.9** 换选元素时自动退回主面板（`:327`）。

### 2.13 「结构」tab（结构树）　代码：`app/components/tree/tree.element.js`（327 行）

树是**复用的同一个实例**，在两个 tab 间来回切时保留展开 / 滚动状态（`:553-554`、`#mountTree` `:597-610`）。

- **2.13.1** 树头：`结构` + 提示「拖动行可移动」+ 关闭 `×`（派发 `vr-tree-close`，`tree:154-155`）。⚠️ 宿主**未监听** `vr-tree-close` —— 点它当前无效果。
- **2.13.2** 从 `document.body` 起递归渲染整页结构（`#collect` `:94-112`）；每行 = 折叠箭头 + 名称 + 文本预览 + 标签（`describeNode`，`core/tree-model.js`）。
- **2.13.3** 单容器子节点超过 **200** 个时折叠成「还有 N 个未列出」（`MAX_SIBLINGS`，`tree:18`、`:106-107`）。
- **2.13.4 点折叠箭头**：展开 / 收起该行；**不触发选中**（`stopPropagation`，`tree:158-167`）。叶子节点带 `data-leaf`，点了不动。
- **2.13.5 点一行**：派发 `vr-tree-select` → 宿主 `engine.unselect_all()` + `select(el)` + `el.scrollIntoView({behavior:'smooth',block:'center'})`（`tree:169-170`；`visual-revise.js:533-539`）。　现有覆盖：`tests-e2e/tree.mjs`
- **2.13.6 hover 一行**：页面上高亮该元素（`highlight()`，`tree:173-176`）；`pointerleave` 清掉。
- **2.13.7 跟随选中**：`setTarget()` 只展开到选中项那条路径（`pathTo`），并 `scrollIntoView({block:'nearest'})`（`tree:75-92`）。
- **2.13.8 拖行移动**（`#startDrag` `:185-215`）：`pointerdown` 起，越过 **4px** 才捕获指针（否则「点一下选中」会失效）。不可拖的行（`canDrag` = 无父级或父级是 `<html>`）不响应（`core/reorder.js:30`）。
- **2.13.9 三档落点**（`#dropAt` `:236-258`）：一行分三段 —— 上 1/3「插到它前面」、下 1/3「插到它后面」、中间 1/3「放进它里面」。**中段只对容器成立**（有子节点，或 display 是 block/flex/grid/inline-flex/inline-grid）。（AC-7.5）　现有覆盖：`tests-e2e/tree.mjs`、`reanchor.mjs`
- **2.13.10** 不能拖进自己或自己的后代（`:240`）；不能拖到 `<html>` 下（`#resolveDrop` `:270`）。（AC-7.7）
- **2.13.11 视觉反馈**：before/after 显示蓝色 `drop-line`；inside 给目标行加 `data-drop-inside`（`#updateDrop` `:278-300`）。
- **2.13.12 放进折叠着的容器会自动展开它**（`:318`）。（AC-7.5）
- **2.13.13** 后邻按 `orderedChildren()`（已按 CSS `order` 排过）取，不用 `nextElementSibling`（`:274-275`、`core/reorder.js:14-25`）。
- **2.13.14 树只上报意图**，写入在面板 `#applyMove()`（`:561-595`）：共享开着且**同父换位**时按下标映射到同构容器；**跨容器只作用于当前元素**并 toast「跨容器移动只作用于当前元素」（`:587-588`）。（AC-7.9）
- **2.13.15** 目标容器里有元素用了 CSS `order` 时 toast「此容器用了 CSS order，视觉顺序可能与 DOM 顺序不同」（`:591-592`）。
- **2.13.16** 移动成功后宿主 toast「已移动到 <容器名> 里」（`visual-revise.js:541-545`）。
- **2.13.17** 树内滚轮不穿透（`containScroll`，`tree:54`）；树内 keydown 不外泄（`tree:40`）。
- **2.13.18** `ChangeStore` 变化时树重画（rAF 合并，`tree:53`、`:65-71`）。
- **2.13.19** 深层嵌套不撑爆面板：面板宽固定 300，树可纵横滚动。（AC-2.15）　现有覆盖：`tests-e2e/acceptance-ui.mjs`

---

## 3. 弹层（下拉 / 菜单 / 色盘 / 填充）

四个弹层的宿主都挂在**页面 body** 上（面板 `overflow:auto` 会裁掉），内容包在 shadow root 里，
宿主行内 `all: initial` 打头，页面 CSS 漏不进来（`controls/popover-host.js`）。（AC-6.30）
四个 id：`visual-revise-menu` / `visual-revise-select-panel` / `visual-revise-color-panel` / `visual-revise-fill-panel`
（`visual-revise.js:198-203`）。宿主 `keydown` 一律止步。

### 3.1 `vr-select` 下拉　代码：`app/components/controls/select.element.js`

- **3.1.1** 点触发器展开（`:116`）；触发器可聚焦（`tabIndex=0`，`:120`），`Enter` / `Space` 也能展开（`:117-119`）。
- **3.1.2** 面板贴触发器**下方**；下方放不下时向上翻（`:215-224`）；`minWidth` 跟触发器同宽。
- **3.1.3** 当前值那一项**蓝底**（`#0d99ff`），键盘高亮项浅底（`:46-54`）。
- **3.1.4** `ArrowDown` / `ArrowUp` 移动高亮（循环），`Enter` 选中高亮项（`:57-66`）。起点落在当前值上（`:213`）。（AC-6.25）　现有覆盖：`tests-e2e/acceptance-popover.mjs`
- **3.1.5** `pointerenter` 选项 → 高亮跟到那一项（`:206`）。
- **3.1.6** 点选项 → 关闭 + 写回 `value` + 派发 `vr-select`（`:199-207`）。
- **3.1.7** `Esc` 关闭并 `stopPropagation`（`:89-94`）——不会一路走到「取消选中」。（AC-6.29）
- **3.1.8** 点弹层外关闭（`pointerdown` capture，`:75-80`）。
- **3.1.9** **在下拉内部滚动不关闭**；页面 / 面板滚动才关（`:96-100`）。`resize` 也关（`:101`）。（AC-6.25）
- **3.1.10** options 支持 `["a","b"]` 与 `[[值,显示名]]` 两种形态；触发器显示后者（`#label()` `:140-145`）。
- **3.1.11** 当前值不在 options 里时把它插到最前（`#renderControl` `:1887-1889`）。

### 3.2 `openMenu` 菜单　代码：`app/components/controls/menu.js:128-196`

使用点：尺寸模式菜单（§2.5.4）、效果类型菜单（§2.10.1）、变量菜单（§2.11.8）。

- **3.2.1** 同一锚点再点一次 → 关闭（toggle，`:130`）。
- **3.2.2** 项形态：对勾（`checkAt` 决定在最左 / 最右）、色圈 `swatch`、图标 `icon`、`label`、`hint`（`:150-157`）。
- **3.2.3** `separator: true` 渲染分隔线（`:136-141`）。
- **3.2.4** `disabled: true` → `opacity .4`、`cursor:not-allowed`、**不绑任何事件**（`:147`、`:163`）。
- **3.2.5** `checked` 项底色 `rgb(13 153 255 / .22)`（`:161`）；hover 非选中项浅底（`:164-169`）。
- **3.2.6** 点项 → 关闭 + `onPick(id, item)`（`:170-175`）。
- **3.2.7** `Esc` 关闭并 `stopPropagation`（`:78-83`）。（AC-6.26）
- **3.2.8** 点外关闭；但点**兄弟弹层**（select / color / fill）不关（`:63-69`）。
- **3.2.9** 菜单内滚动不关（`:85-89`），页面滚动 / resize 关（`:90`）。（AC-6.24b）
- **3.2.10** `align: 'left' | 'right'` 决定贴锚点哪一边；上下空间不足时向上翻（`:182-191`）。
- **3.2.11** `max-height: 70vh` + `overflow-y:auto` + `overscroll-behavior: contain`（`:27-29`）。

### 3.3 `openPopover` 自定义弹层　代码：`menu.js:199-228`

使用点：网格点阵（§2.5.12）、效果参数面板（§2.10.3）。行为同 3.2 的定位 / 关闭规则，内容由回调自绘，可传 `width`。

### 3.4 色盘主体（picker）　代码：`app/components/controls/picker.js`

被 `vr-color` 与 `vr-fill`（纯色 tab + 渐变 tab 的色标编辑）共用。

- **3.4.1 SV 面板**：拖动改饱和度（x）与明度（1−y）（`:212`、`drag()` `:138-159`）。按下即取值（`move(e)` 在注册监听前先跑一次，`:155`）。
- **3.4.2 色相条**：拖动改 hue 0–360（`:213`）。
- **3.4.3 透明度条**：拖动改 alpha 0–1（`:214`），底下是棋盘格。
- **3.4.4 吸管**（`.eye`）：调 `new EyeDropper().open()`；浏览器不支持时按钮 `disabled` + title「当前浏览器不支持屏幕取色」（`:231-246`）。
- **3.4.5 格式下拉**（`vr-select`）：Hex / RGB / HSL，切换即重新格式化并 emit（`:216`、`formatColor` `:63-75`）。
- **3.4.6 色值输入**：`change` 时 `parseColor` 校验，非法则回滚显示（`:218-224`）。正在输入时不被 sync 覆盖（`:198-201`）。
- **3.4.7 不透明度输入（%）**：`change` 时 clamp 0–100（`:226-229`）。
- **3.4.8** `parseColor` 用浏览器 CSS 引擎解析任意颜色写法；`formatColor` 在 alpha<1 时输出 `rgba/hsla/#rrggbbaa`；`sameColor` 判两个写法是不是同一个颜色（变量绑定的核对用它，`fills.js` / props-panel 都引这一份）。
- 现有覆盖：`tests-e2e/controls.mjs`、`acceptance-popover.mjs`

### 3.4b 颜色弹层　代码：`app/components/controls/color-popover.js`

`vr-color` 的色块、已绑定的 chip、分区标题栏的「绑定变量」三处开的是同一个弹层，所以它是模块级函数而不是控件的实例方法。

- **3.4b.1 两页 `Custom | 变量`**（属性名 `data-page`，跟填充弹层那排 `data-tab` 分开）。`variables === null` 时整排不渲染（效果参数面板的阴影色）。打开时按当前状态停页：已绑定 → 变量页并勾着当前项，否则 Custom。（AC-6.31、AC-6.31a）
- **3.4b.2 `renderVariableList()`** 导出给填充弹层复用，行结构见 §2.11.9；列表 `max-height:300px; overflow:auto; overscroll-behavior:contain`。
- **3.4b.3 关闭**：`Esc`（capture 阶段 + `stopPropagation`，否则会一路走到「取消选中」）、点弹层外、页面 / 面板滚动。弹层自己内部的滚动放行——变量列表几十项，一滚就关等于只能选最上面几项。
- **3.4b.4 兄弟弹层白名单**（`visual-revise-select-panel` / `-fill-panel` / `-menu`）：色盘里的格式下拉挂在 body 上、不在色盘的 DOM 里，少了这份白名单点一下 RGB 就把色盘关掉，而 `vr-select` 的提交挂在 `click` 上，等它跑时 picker 已经脱离 DOM。（AC-6.31e）
- **3.4b.5 锚点标记**：打开时给 anchor 打 `data-open` + `data-menu-open`（`.var-chip[data-menu-open]` 的激活态 CSS 依赖后者），关时都摘掉。
- **3.4b.6 定位**：`place()` 在内容铺开之后算（空壳的 `offsetHeight` 接近 0，夹了等于没夹），切页后重新夹回视口。默认贴触发器左侧，`align:'right'` 时贴右缘。（AC-6.17）

### 3.5 `vr-color` 单色控件　代码：`app/components/controls/color.element.js`

- **3.5.1** 触发行 = 色块（32×32，棋盘格底）+ **色值输入** + 分隔线 + **不透明度输入** + `%`。（AC-6.16）
- **3.5.2** 点**色块**开弹层；点**输入框**不开（用 `composedPath` 看真实 target）。（AC-6.20）　现有覆盖：`tests-e2e/acceptance-panel.mjs`
- **3.5.3** 改色值不重置已调好的 alpha（alpha 由旁边那个框独立决定）。（AC-6.16）
- **3.5.4** 改不透明度：`clamp(pct,0,100)/100`；非数字回滚。
- **3.5.5** alpha=1 时输出 `#rrggbb`，不写 `rgba()`。
- **3.5.6** 弹层交给 `openColorPopover`（§3.4b）；`variablesProvider` 决定有没有变量页。
- **3.5.7** `Esc` / 点外 / 滚动关都在弹层那边；元素被移除时 `disconnectedCallback` 关掉自己的弹层（面板每次 render 都会换掉实例，这条是弹层不留孤儿的关键）。
- **3.5.8** 色盘每次操作派发 `vr-color`（detail 是 CSS 字符串）；变量页选中派发 `vr-color-variable`（detail 是变量名）。

### 3.6 `vr-fill` 填充控件　代码：`app/components/controls/fill.element.js`（650 行）

- **3.6.1 触发行**：色块 + **纯色态**给色值 / 不透明度双输入；其余三态（无 / 渐变 / 图片）退回只读摘要文字（`:189-247`）。摘要文案：`无填充` / `线性渐变 · N 档` / `背景图` / `#RRGGBB`（`#summary` `:169-179`）。（AC-6.19）
- **3.6.1a 绑定态的触发行**：有 `bound` 属性时整块换成 chip（圆点取该层解析色 + 变量名），点它开的还是本控件的弹层，只不过停在变量页。`bound` 走属性传入（每层一个短字符串，没有变量列表那份代价），`observedAttributes` 收了它。（AC-6.32a）
- **3.6.1b 两页 `Custom | 变量`**（`data-page`）：`Custom` 下才是下面那四个 `data-tab`。变量页复用 `renderVariableList`（数据来自面板挂的 `variablesProvider`）；渐变 / 图片层显示一行说明「渐变和图片层不能绑定变量」。选中派发 `vr-fill-variable { name }`，层下标由面板从 `dataset.layer` 取。`openVariables()` 是模块外唯一能直接打开变量页的入口（分区标题栏的「绑定变量」用）。（AC-6.32、AC-6.32d）
- **3.6.2 四个 tab**：无 / 纯色 / 渐变 / 图片（`TABS`）。点击切 tab → `#renderBody()` + `#applyTab()` + 重新定位。（AC-6.10b）
- **3.6.3 「无」**：写 `background-color: transparent` + `background-image: none`（`:351`）。
- **3.6.4 「纯色」**：整块色盘。切进来时若当前有背景图，先显示一条黄条警告「当前有背景图，选定颜色后它会被清掉」（`:410-414`）。**光切 tab 不动图片**——`#applyTab` 在有非渐变图片时传 `image: null`（`:359-360`），面板端把 `image===null` 当「别动图片」（`:2305`）。
- **3.6.5 「图片」**：预览框 + 「从电脑上传」按钮 → 派发 `vr-fill-pick-image`（`:388-390`），面板端读文件、`ChangeStore.addAsset()`、写 `url("dataUrl")`（`:2329-2341`）。
- **3.6.6 「渐变」编辑器**（`#renderGradient` `:429-476`）：
  - **3.6.6a 类型分段**（`TYPE_LABELS`，`core/gradient.js:212`）：线性 / 径向 等。切换即写回（`:616-621`）。
  - **3.6.6b 角度输入**：径向时整行隐藏（`:433`）。`change` 校验数字后 `setAngle`（`:623-629`）。
  - **3.6.6c 反转按钮**：`reverseStops` —— **只换颜色顺序，位置不动**（`:631-635`）。
  - **3.6.6d 色标条**：点空白处按插值新增一档（`:638-641`）；手柄可拖动改位置 0–100%（`:546-570`）。
  - **3.6.6e 加号**：在首尾中点新增一档（`:643-647`）。
  - **3.6.6f 每档一行**：位置输入（%）、色块、色值输入、删除 `−`。至少保留 **2 档**，只剩 2 档时删除按钮 `disabled`（`:511-512`、`:596-603`）。
  - **3.6.6g** 点行选中该档（`:572-576`），选中档在手柄上边框变蓝、行底变蓝（`:522`、`:525`）。
  - **3.6.6h** 下方是完整色盘，改的是**当前选中那一档**的颜色（`:466-475`）。
  - **3.6.6i** 色标数量没变时**原地改不重建 DOM**（拖动中的手柄不会断、输入不会被打断）（`:486-535`）。
- **3.6.7** 弹层贴控件左侧、夹在视口内；切到渐变变高后重新让位（`#place` `:311-319`、`:336`）。（AC-6.17、AC-6.28）
- **3.6.8** `Esc` 关（`:40-45`）；点外关，但点兄弟弹层不关（`:47-53`）。
- 现有覆盖：`tests-e2e/fill.mjs`、`controls.mjs`、`acceptance-popover.mjs`

---

## 4. 页面上的直接操作

### 4.1 选择元素　代码：`app/features/selectable.js`（始终启用）

| # | 操作 | 效果 | 代码 | 覆盖 |
|---|---|---|---|---|
| 4.1.1 | 单击页面元素 | 选中，画选中框 + 元素标签 + 8 个缩放把手 | `selectable.js:98-118` | `acceptance.mjs` AC-3.1 |
| 4.1.2 | `Shift` + 单击 | 加选；已选中的再 Shift 点则取消它 | `:109-117` | AC-3.2 / 3.2b |
| 4.1.3 | hover | 画悬停框 + 标签，不影响已选中项 | `:415-461` | AC-3.3 |
| 4.1.4 | 点插件自身 UI | 不会被选中（`isOffBounds`） | `:103-104` | AC-3.4 |
| 4.1.5 | `Enter` | 选中第一个子元素（下钻） | `:79`、`:348-387` | AC-3.5 |
| 4.1.6 | `Shift+Enter` | 选中父元素（上浮） | 同上 | AC-3.5b |
| 4.1.7 | `Shift+'` | 把父元素**加进**选中集，子级仍保留 | `:81`、`:778-801` | AC-3.6 |
| 4.1.8 | `⌘⇧Enter` | 选中当前元素的所有直接子元素 | `:80`、`:763-776` | AC-3.7 |
| 4.1.9 | `⌘E` / `⌘⇧E` | 选中下一个同类 / 一次全选同类 | `:77`、`:297-310` | AC-3.8 |
| 4.1.10 | `⌘D` | 原地深拷贝选中元素并插在其后 | `:74`、`:176-184` | AC-3.9 |
| 4.1.11 | `⌘⌥C` / `⌘⌥V` | 复制 / 粘贴样式（多个来源时轮转分配） | `:71-72`、`:237-295` | AC-3.10 |
| 4.1.12 | `Esc` | 取消全部选中（由 Visual Revise 接管，见 4.1.16） | `visual-revise.js:350-354` | AC-3.11 |
| 4.1.13 | `⌘G` / `⌘⇧G` | **分组 / 取消分组**：把选中项包进新 `<div>` / 拆掉外壳 | `:78`、`:312-340` | **无** |
| 4.1.14 | `⌥Delete` / `⌥Backspace` | **清空 inline `style` 属性** | `:76`、`:189-191` | **无** |
| 4.1.15 | `⌘C` / `⌘X` / `⌘V`（原生剪贴板事件） | 复制 / 剪切选中元素的 outerHTML；粘贴为每个选中元素的子节点 | `:65-67`、`:193-235` | **无** |
| 4.1.16 | 按住 `Ctrl` 不放 | 临时隐藏所有选中覆盖层（handles/label/hover/grip），松开恢复 | `:151-171` | **无** |
| 4.1.17 | 双击文字 | 进入文字编辑态（`toolSelected('text')`） | `:144-149` | `text.mjs` |

- **4.1.18** `Delete` / `Backspace` 由 Visual Revise **完全接管**（不放行给上游，避免 `del`/`delete` 双别名删两个）：记录 → 删除 → 自动选中邻居 → toast「已删除 N 个元素 · 可在记录里放回」（`visual-revise.js:260-280`）。（AC-4.8、AC-7.3）　现有覆盖：`tests-e2e/removal.mjs`
- **4.1.19** 在页面输入框里打字时单字母键不触发插件功能（`isTypingTarget`，`visual-revise.js:242`）。（AC-4.2）

### 4.2 选中框上的 8 个缩放把手　代码：`app/components/selection/handle.element.js`

- **4.2.1** 8 个 placement：`top-start / top-center / top-end / middle-start / middle-end / bottom-start / bottom-center / bottom-end`（`:71-153`）。
- **4.2.2** `pointerdown` 拖动 → 实时写 `width` / `height`；带 start / top 的把手同时改 `transform: translate(...)` 以固定对边（`:61-155`）。
- **4.2.3** 拖动时 `document.body.cursor` 换成把手的 `--cursor`，`userSelect:none`；`pointerup` / `mouseleave` 收尾还原（`:53-58`、`:157-166`）。
- **4.2.4** 拖动期间元素 `transition:none`（`:55`），收尾还原。
- ⚠️ **`width` / `height` 会进改动记录（它们在 `TRACKED_PROPS` 里），但 `transform` 不在 `TRACKED_PROPS` 里**（只跟踪 `rotate`），所以位移量既不进记录也不进提示词（`core/snapshot.js:80-87`、`core/tracked-props.js:21-105`）。　现有覆盖：**无**

### 4.3 文字编辑　代码：`app/features/text.js`；宿主接管 `visual-revise.js:422-465`

- **4.3.1** 双击页面文字 → 元素被设成 `contenteditable` + `spellcheck`（`text.js:26-29`）。
- **4.3.2** `focusin` 时 `ChangeStore.markEdited()` + `beginText()`，把原文赶在第一个按键之前快照（`visual-revise.js:430-437`）。
- **4.3.3** 编辑中的按键不外泄（`text.js:13`、`:33`）——不会误触工具热键。
- **4.3.4** `input` 时 200ms 防抖后 `ChangeStore.touch()` 广播，面板 / 记录列表跟上（`visual-revise.js:453-461`）。
- **4.3.5** `blur` / `focusout` → `endText()`，**一整段编辑算一次操作**（`:439-442`）。
- **4.3.6** 编辑结束后把活动工具切回 `guides`（`:449`）——否则 Esc 与层级导航都会哑掉。（AC-7.1）　现有覆盖：`tests-e2e/text.mjs`
- **4.3.7** `Escape` 退出所有编辑态（`text.js:37`）。
- **4.3.8** 文案改动单独计数、不混进样式属性；祖先与后代都报时只留最内层（`core/change-store.js:244-249`）。

### 4.4 页面上直接拖拽移动元素　代码：`app/core/layout-drag.js`（335 行）

**整个选择模式下都开着**，不再要求切到某个 tab（`visual-revise.js:377-380`）。

- **4.4.1** `pointerdown`（左键）在页面元素上 → armed；`isEditorUI` 与 `body` 不响应；`canDrag` 为假不响应（`:235-248`、`core/reorder.js:30`）。
- **4.4.2** **4px 起拖阈值**：按下不动松开仍然是「选中」（`:267-269`、`DRAG_SLOP` `:15`）。（AC-7.4b）　现有覆盖：`tests-e2e/drag.mjs`
- **4.4.3** 越过阈值 → 建**拖影**（元素克隆，超过 1600×1200 面积退化成蓝色轮廓框）、源元素 `opacity:.25`、注入落点提示样式、装上「吞掉下一次 click」（`:250-261`、`createGhost` `:152-185`）。
- **4.4.4** 拖影跟随指针；拖影标 `data-visual-revise-ui` 且 `pointer-events:none`（不会命中自己）（`:159`、`:172`、`:187-191`）。
- **4.4.5 三档落点**（`dropTargetAt` `:78-114`）：沿主轴（行容器看 x，列容器看 y）前 1/3「插到它前面」、后 1/3「插到它后面」、中段「放进它里面」（要 `canHold`）。（AC-7.4）
- **4.4.6 视觉反馈**：落点容器加 `data-vr-drop-target`（蓝色 outline，用 `<style>` 注入而**不写 inline**，不污染改动记录）（`:22-43`）；before/after 显示 3px 蓝色指示条，行容器画竖条、列容器画横条（`showIndicator` `:116-139`）。
- **4.4.7** 松手提交 → `ChangeStore.moveElement()`；成功后宿主重新选中该元素并 toast「已移动到 <容器名> 里」（`:299-302`；`visual-revise.js:75-80`）。
- **4.4.8** **`Esc` 取消这一次拖拽**：收尾但不提交，DOM 回到拖之前，不留任何改动（`visual-revise.js:331-336`；`layout-drag.js:316`）。（AC-2.16、AC-7.4）
- **4.4.9** 拖拽期间 `selectstart` 被压制（`:202`）。
- **4.4.10** 松手后那次 `click` 被吞掉（`armClickSwallow` `:208-226`）。
- **4.4.11** `setActive(false)` 时取消（而非提交）当前拖拽，并清掉提示样式（`:317-327`）。
- **4.4.12** 真的搬 DOM 节点，**一个 `order` 都不写**。（AC-7.4）
- **4.4.13** 拒绝非法落点：自己 / 自己的后代 / `<html>`（`:87-88`；`change-store.js:61-66`）。（AC-7.7）

### 4.5 标尺线 / 测距（Guides，默认工具）　代码：`app/features/guides.js`、`app/features/measurements.js`

- **4.5.1** hover 页面元素 → 画 `<visbug-gridlines>` 对齐辅助线（`guides.js:15`、`:33-39`）。
- **4.5.2** `mouseout` / 页面滚动 → 隐藏（`:16`、`:18`）。
- **4.5.3** 选中一个元素后再 hover 另一个 → 画 `<visbug-distance>` 距离标签（`selectable.js:437-441` → `measurements.js`）。　现有覆盖：`tests-e2e/guides.mjs`（仅 3 条）
- **4.5.4** 选中第 2 个及以上元素时测距线被「粘住」保留（`stickGuide` `:68-88`）。
- **4.5.5** 浏览模式 / 隐身态下**不画**任何标尺线（工具被 `deactivate_feature()` 真正解绑，`visual-revise.js:134-135`）。（AC-2.6）

### 4.6 上游 VisBug 工具（需先按 `⌘/` 唤出工具条）

> 入口见 §1.8。这些工具的**单字母切换热键已解绑**，只能点工具条按钮激活；激活后它们各自的方向键 / 鼠标操作生效
> （方向键不被 Visual Revise 拦截，会走到 hotkeys-js）。**现有 e2e 完全没有覆盖这条路径。**

| # | 工具 | 激活后的操作 | 写入 | 代码 |
|---|---|---|---|---|
| 4.6.1 | Guides（默认） | 见 §4.5 | 无 | `features/guides.js` |
| 4.6.2 | Inspect（metatip） | hover 弹计算样式浮层；点击「钉住」；`Esc` 清空 | 无（只读） | `features/metatip.js:25-28` |
| 4.6.3 | Accessibility | hover 弹 a11y / 对比度浮层；点击钉住；`Esc` 清空 | 无（只读） | `features/accessibility.js:22-25` |
| 4.6.4 | Position | 方向键 ±1px（`shift` ±10）改 `left`/`top`；鼠标拖动元素改位置 | `position`(强制 relative)、`left`、`top`；SVG 写 `transform` 属性 | `features/position.js:19-24`、`:46-163` |
| 4.6.5 | Margin | 方向键对应边 +1px；`alt+` −1；`shift+` ±10；`⌘↑/↓` 四边同时 ±1（`⌘⇧` ±10）；下限 0 | `margin-top/right/bottom/left` | `features/margin.js:14-24`、`:54` |
| 4.6.6 | Padding | 同上 | `padding-*` | `features/padding.js:14-24` |
| 4.6.7 | Flexbox Align | `←→` 循环 `justify-content`；`↑↓` 循环 `align-items`；`shift+←→` 循环分布；`shift+↑↓` 循环 `align-content`；`⌘←→` = row、`⌘↑↓` = column；`⌘⇧←→` 循环四种 direction；`⌘⇧↑↓` 切 `flex-wrap` | `display:flex`（强制）、`justify-content`、`align-items`、`align-content`、`flex-direction`、`flex-wrap` | `features/flex.js:14-45` |
| 4.6.8 | Move | `←` 与前一兄弟换位；`→` 与后一兄弟换位；`↑` 提升为父级的兄弟；`↓` 沉入下一兄弟 / 落到父级之后。另有 grip 手柄可拖拽换位（仅单选、非 SVG、≥2 兄弟时出现） | 无 CSS（纯 DOM 搬动） | `features/move.js:23`、`:50-76`、`:93-195` |
| 4.6.9 | Hue Shift | `←→` 饱和度 ∓1%（`shift` 10%）；`↑↓` 明度 ±1%；`⌘←→` alpha ∓；`⌘↑↓` 色相 ±1°；`]` / `[` 切换作用目标（前景 / 背景 / 边框） | `color` / `background-color` / `border-color`（SVG：`stroke`/`fill`/`outline`） | `features/hueshift.js:30-71` |
| 4.6.10 | Box Shadows | `←→` x 偏移；`↑↓` y 偏移；`⌥←→` 扩展；`⌥↑↓` 模糊；`⌘←→` 不透明度 ±0.01；`⌘↑` 去 inset / `⌘↓` 加 inset；`shift` 一律 ×10 | `box-shadow`（没有时先播种一条默认阴影） | `features/boxshadow.js:14-44` |
| 4.6.11 | Font Styles | `←→` 循环 `text-align`；`shift+←→` 字距 ∓0.1px（下限 −2）；`↑↓` 字号 ±1（`shift` ±10，下限 6）；`shift+↑↓` 行高 ±1；`⌘↑↓` 字重上下一档；`⌘B` 粗体开关；`⌘I` 斜体开关 | `text-align`、`letter-spacing`、`font-size`、`line-height`、`font-weight`、`font-style` | `features/font.js:14-52` |
| 4.6.12 | Edit Text | 让选中元素进入 `contenteditable`（同 §4.3） | `contenteditable` / `spellcheck` 属性 | `features/text.js` |
| 4.6.13 | Search | 输入 CSS 选择器 / 别名（`links`/`buttons`/`images`/`text`）批量选中 | 无 | `features/search.js:51-116` |
| 4.6.14 | 图片拖放换图（imageswap，**始终监听**，不属于某个工具） | 把一张 `<img>` 或本地文件拖到另一张图 / 有背景图的元素上 → 换 `src`/`srcset`/`background-image`；`dragover` 时实时预览，`dragleave` 还原 | `background-image`；`src` / `srcset` 属性 | `features/imageswap.js:28-35`、`:59-121` |
| 4.6.15 | Screenshot | **未实现**，`alert('Coming Soon!')` | — | `features/screenshot.js:2` |
| 4.6.16 | `shift+/` 快捷键帮助浮层 | 显示当前工具的快捷键图；`Esc` 或再按一次关闭。⚠️ 全局绑定且**未解绑**，但渲染在 `display:none` 的 `<vis-bug>` 内，未先按 `⌘/` 时按了看不见任何东西 | — | `components/hotkey-map/hotkeys.element.js:44-49` |

- **4.6.17** 以上工具写的都是 inline style；只要元素已被 track（选中过），**改动会通过快照 diff 进改动记录与提示词**（`core/snapshot.js:133-168`）——但只覆盖 `TRACKED_PROPS` 里的属性，`font-style`、`align-content`、`transform` 等不在其中，会静默丢失。

---

## 5. 改动记录 / 撤销重做 / 重置

### 5.1 改动记录面板　代码：`app/components/change-list/change-list.element.js`（385 行）

- **5.1.1** 三个 tab：`全部 N` / `配置 N` / `评论 N`。「配置」= 属性 + 文案 + 属性改动 + 删除 + 移动（`:112-116`、`:256-259`）。　现有覆盖：`tests-e2e/list.mjs`
- **5.1.2** 头部 `×` 关闭列表（`:261`）；头部可拖动（`:358-381`，**不落盘**）。
- **5.1.3** 底部四个按钮：**复制提示词**（无改动时 disabled）、**导出**（无改动时 disabled）、**导入**、**重置**（`:92-97`、`:123-124`）。
- **5.1.4 样式条目**（`#renderEdit` `:145-182`）：头部 = 选择器末段 + 失联徽章 + 条数徽章 + `↺`（撤销此元素全部改动）；下面每条改动一行 `prop  from → to` + `×`（撤销这一条）。文案行标 `文案`，属性行标 `换图` / 属性名。
- **5.1.5** 长值缩短：`data:` → `新图片`；URL → 只留文件名；>40 字符截断（`shortValue` `:15-23`）。（AC-7.2）　现有覆盖：`tests-e2e/swap-image.mjs`
- **5.1.6 删除条目**（`#renderRemoval` `:184-203`）：显示 `<tag>` / 文本特征 + 子元素数；`↺` 放回原位；父元素已不在时按钮 `disabled` + title「父元素已不在页面上，放不回去」。（AC-7.3）　现有覆盖：`tests-e2e/removal.mjs`
- **5.1.7 移动条目**（`#renderMove` `:205-222`）：写明「移动到 <容器> 里」；`↺` 搬回原位，原容器失联时 disabled。（AC-7.8）
- **5.1.8 评论条目**（`#renderComment` `:224-240`）：编号 `#N` + 文本 + 带图时 `🖼 N` 徽章 + `×` 删除。
- **5.1.9 失联徽章**：`元素已消失`（orphaned）/ `页面在还原`（fighting）（`GONE_BADGE` `:27-30`）。　现有覆盖：`tests-e2e/reanchor.mjs`
- **5.1.10 hover 条目** → 页面上高亮该元素；`mouseleave` 清掉（`:299-302`）。（AC-8.1）
- **5.1.11 点条目**（非按钮区）→ `scrollIntoView` + 派发 `vr-locate` → 宿主选中它并显示面板（`:304-312`；`visual-revise.js:565-571`）。
- **5.1.12** 每条 `×` / `↺` 分别调 `undoProp` / `undoText` / `undoAttr` / `undoElement` / `restoreRemoval` / `moveBack` / `removeComment`（`:314-355`）。（AC-8.2）
- **5.1.13** 恢复失败时 toast 明确原因（`:337-350`）。
- **5.1.14** header / footer **只建一次**，只有条目区重建——拖动手势不会被打断（`:79-102`、`:294`）。
- **5.1.15** 通知合并到同一帧（rAF，`:69-75`）。
- **5.1.16** 列表内滚轮不穿透（`:55`）。

### 5.2 撤销 / 重做栈　代码：`app/core/history.js`

- **5.2.1** 上限 **100 条**，满了丢最旧（`:13`、`:49`）。　现有覆盖：`tests-e2e/history.mjs`
- **5.2.2** 有新操作即断掉重做链（`:53`）。
- **5.2.3** 撤销时反序执行 ops（`:88`）。
- **5.2.4** `undoLabel` / `redoLabel` 供工具条 tooltip 与 toast 使用（`:119-120`）。
- **5.2.5** undo/redo 自身写回 DOM 时不再入栈（`muted`，`:27`、`:85-92`）。

### 5.3 重置全部　代码：`change-store.js:934-967`

- **5.3.1** 点「重置」→ `ChangeStore.undoEverything()`：还原全部样式 / 文案 / 属性、放回删除的元素、把搬过家的元素搬回原位、清空评论与失联记录（`change-list:288-291`）。（AC-8.9）　现有覆盖：`tests-e2e/reanchor.mjs`、`history.mjs`
- **5.3.2** `⌘Z` 能把这次重置连同移动一起救回来。（AC-8.9）

### 5.4 跨重渲染的重新锚定　代码：`change-store.js:650-758`

- **5.4.1** MutationObserver 观察整个文档；节点被换掉后一帧内按 `identity` 找回并把改动重放到新节点（`reconcile` `:650-709`）。（AC-8.8）　现有覆盖：`tests-e2e/reanchor.mjs`
- **5.4.2** 认不准时标 `orphaned` 留在记录里，不静默丢弃（`:497-501`）。
- **5.4.3** 页面反复把删掉的元素渲染回来时标 `fighting` 并停止重复删除（`overBudget` `:532-540`）。
- **5.4.4** 移动 / 删除 / 评论各有自己的重放路径（`reapplyMove` `:605`、`reapplyRemoval` `:588`、`rebindComment` `:567`）。（AC-7.10）
- **5.4.5** `destroy()` 后观察器断开，重新挂载时接回（`visual-revise.js:54`、`:600`）。

### 5.5 `!important` 写入　代码：`change-store.js` 的 `applyProp` / `writeProp` / `needsImportant`

- **5.5.1** 面板写入时按需带 `!important`：样式表里 `.x { color: … !important }` 的元素，写普通 inline 声明压不过它——画面纹丝不动，看着就是「点了没反应」（unlink、眼睛按钮、拖标签调值全都静默失败）。
- **5.5.2 判定在 `applyProp` 做一次**：`winningDeclaration` 把 inline 也放进层叠比较，「样式表赢家带 important」与「inline 已经是 important」一次问完。结果按 `(el, prop)` 缓存在快照上（`snap.sheetImportant`）——写入是高频的（拖动每帧一次、写一次背景 5 条属性），而这个查询要对全部规则逐条 `el.matches`。（AC-6.34a）
- **5.5.3 `writeProp` 只落地**：priority 随 op 存进历史（`beforeImportant` / `afterImportant`），undo / redo 不再依赖「重放那一刻页面样式表长什么样」。`history.js` 的合并分支同时更新 `afterImportant`，否则合并后会粘着第一次写入的判定。（AC-6.34b）
- **5.5.4 数据结构**：`readInline` 之外并行一份 `readInlineImportant(el) → Set<prop>`；`captureLive` / `replayOnto`（框架换节点后的重贴）照它带 priority；`diffSnapshot` 把 important 纳入比较口径，change 记录上是**独立字段** `important: true`，不拼进值字符串。`captureAll` / `restoreAll` 走整串 cssText、`revertProp` 走探针的 `getPropertyPriority`，两处天然带 priority，不用改。（AC-6.34d）
- **5.5.5 三处「存原文再写回」**（分区眼睛 / 填充层眼睛 / 文字色眼睛）存的是 `{ value, important }`。（AC-6.34c）
- **5.5.6 导出**：提示词渲染时才拼成 `值 !important`，四条边只要有一条带 important 就不折叠成简写（拼出来是非法声明）；JSON `SCHEMA_VERSION = 4`（`SUPPORTED` 收 1–4），`important` 作为独立字段往返。（AC-6.34d、AC-6.34e）　现有覆盖：`tests-e2e/acceptance-variables.mjs`

---

## 6. 导出（提示词 / JSON / 导入）

### 6.1 复制提示词　入口：工具条按钮 / `P` / 面板 / 记录列表　代码：`core/prompt-export.js`、`visual-revise.js:489-519`

- **6.1.1** 无改动时 toast「还没有任何改动」（kind=error）（`:493`）。
- **6.1.2** 有改动 → `buildPrompt()` → `navigator.clipboard.writeText()`；失败时回退到 `execCommand` 路径，仍失败则 toast「复制失败，请检查剪贴板权限」（`prompt-export.js:452-481`）。
- **6.1.3** 提示词段落（`buildPrompt` `:348-450`）：每个元素一节（定位锚点 + 属性改动表格 + 属性块）、**文案改动**、**移动的元素**（from/to 两头都给容器选择器）、**删除的元素**、**图片替换**、**交互备注**（评论）、**参考图文件**清单、**给 AI 的说明** FOOTER、以及摘要计数。（AC-8.6）　现有覆盖：`tests-e2e/core.mjs`、`drag.mjs`、`removal.mjs`、`swap-image.mjs`、`comment-refs.mjs`、`acceptance-export.mjs`
- **6.1.4** dataUrl 不整段进提示词，替换成落盘后的文件路径（`displayValue` `:160-169`、`findRef` `:144-158`）。
- **6.1.5 参考图落盘**（`core/ref-images.js:95-113`）：优先走扩展 `chrome.downloads` 通道（拿得到**绝对路径**），失败退回页面下载（路径为**推测**）。目录 `visual-revise-refs/<时间戳>`（`:19`、`:32`）。
- **6.1.6 toast 分四种**（`visual-revise.js:500-516`）：无图「已复制 N 项改动到剪贴板」/ 精确路径「…N 张图已存入下载目录（提示词含绝对路径）」/ 推测路径「…提示词里的路径为推测」/ 有失败「…N 张落盘失败」（kind=error）。
- **6.1.7** 只做了移动（没有样式改动）也能生成提示词，不会报 empty。（`drag.mjs` 已覆盖）

### 6.2 导出 JSON　入口：记录列表「导出」　代码：`core/json-io.js:17-85`

- **6.2.1** `downloadJSON()` 触发浏览器下载；toast「已导出 N 项改动」（`change-list:264-270`）。
- **6.2.2** `SCHEMA_VERSION = 3`（`json-io.js:12`）；支持读 1/2/3（`:15`）。v2 起带 `assets`（图片 base64），v3 起带 `moves`。（AC-8.7）　现有覆盖：`tests-e2e/advanced.mjs`
- **6.2.3** 内含改动 / 评论 / 删除 / 移动 / 文本锚点。

### 6.3 导入 JSON　入口：记录列表「导入」　代码：`core/json-io.js:87-214`

- **6.3.1** 选文件 → 解析 → 逐条按锚点定位并重放（样式 / 属性 / 移动 / 删除 / 评论）。
- **6.3.2** 选择器失效时回退**文本特征**匹配，计入 `viaText`（`:113`）。
- **6.3.3** 非法选择器不让整个导入抛错，记进 `failed` 继续处理后续（`:131`）。（AC-8.7）
- **6.3.4** toast 汇总：「导入 N 处改动 + N 处移动 + N 处删除 + N 条评论（N 处靠文本特征匹配），N 处未找到对应元素」；失败时显示 `reason`（`change-list:272-286`）。
- **6.3.5** 不支持的 schema → 「不支持的文件格式（schema=X）」（`:89`）；未选文件 / 解析失败各有独立文案（`:204`、`:209`）。

---

## 7. 评论 / 参考图 / 其它

### 7.1 评论　代码：`app/components/comment-layer/comment-layer.element.js`（666 行）

- **7.1.1** 进入评论模式（`C` 或工具条）后点页面任意元素 → 在该处起草评论（`visual-revise.js:405-420`）。**模式保持不变**，可连续标注（`:417-419`）。　现有覆盖：`tests-e2e/comment.mjs`
- **7.1.2** 评论模式下点击**不选中**元素（`preventDefault + stopPropagation`，`:414-415`）。
- **7.1.3** 起新草稿时若上一条还没保存且有内容，**先自动保存**（`:137`）。
- **7.1.4 气泡结构**（`#buildBubble` `:250-277`）：元素选择器标签 + contenteditable 编辑器（placeholder「描述想要的效果，例如：鼠标移入时上浮并变亮」）+ `+` 加图按钮 + 参考图区 + 「添加/保存」「取消」+ 提示「⌘/Ctrl + Enter 快速保存」。
- **7.1.5** `⌘/Ctrl+Enter` 保存，`Escape` 取消（编辑器 `:468-471`、说明框 `:438-441`；宿主 Esc 分支 `visual-revise.js:340`）。
- **7.1.6** 保存后页面出现编号 **pin**；点 pin 可编辑原评论（`:72-77`、`editComment` `:147-157`）。
- **7.1.7** pin 定位：默认放在元素右外侧，右边塞不下就收进内侧；元素滚出视口时 pin 跟着离场（不夹回边缘）（`#renderPins` `:165-191`）。
- **7.1.8** 带图的 pin 加 `data-has-images` 标记（`:187`）。
- **7.1.9** 气泡定位：右边放不下就**翻到锚点左侧**；纵向只夹不翻（`#placeBubble` `:228-248`）。
- **7.1.10** 气泡按草稿建一次，之后只重新定位、不整块重建（避免打断输入）（`#syncBubble` `:196-223`）。
- **7.1.11** 粘贴富文本一律降级成纯文本（`:475-487`）。
- **7.1.12** 只有图没有文字也是有效评论；两者都空则丢弃草稿（`#commitDraft` `:649-663`）。
- **7.1.13** `scroll` / `resize` 时重新定位（合并到同一帧，`:81-83`）。
- **7.1.14** 浏览模式下评论层整块隐藏（pin 有 `pointer-events`，会挡点击）（`visual-revise.js:142`）。（AC-2.4）

### 7.2 参考图　代码：同上 + `core/image-assets.js`

- **7.2.1 三个入口**：`+` 按钮选文件（`:454-458`）、编辑器内**粘贴**图片（`:475-483`）、往气泡上**拖拽**文件（`:501-511`）。（AC-8.5）　现有覆盖：`tests-e2e/comment-refs.mjs`
- **7.2.2** 图片以 **chip**（缩略图 + 去扩展名的文件名）插在**光标处**（`#chip` `:306-331`、`#insertNodes` `:529-557`）。
- **7.2.3** 序列化时 chip 写成 `[图N]` 标记，N = 它在参考图清单里的序号（`#serialize` `:340-365`）。
- **7.2.4** 重新编辑时 `[图N]` 还原成 chip（`#fillEditor` `:284-304`）。
- **7.2.5** `Backspace` 删 chip / 剪切 / 全选删除，都走 `#reconcile()` 同步清单（`:369-387`、`:462`）。
- **7.2.6** 说明区每张图一行：缩略图 + `[图N]` + 文件名 + 尺寸/体积 + `×` 移除 + 说明 `textarea`（`#syncRefs` `:389-421`）。
- **7.2.7** 说明区删图会连句子里的 chip 一起删（`#removeImage` `:575-584`）。
- **7.2.8** 说明实时写回数据（`:433-436`）。
- **7.2.9** hover chip / 缩略图 → 弹**大图预览**（`popover=manual`，走 top layer，最大 260px）（`#showPreview` `:600-637`）。
- **7.2.10** 体积限制：单张 **5MB**、会话累计 **20MB**，超限 toast 报错（`image-assets.js:11-12`、`:80-81`）。
- **7.2.11** 页面 CSP 禁 `data:` 图时缩略图降级成「类型 + 体积」文字条目（`:87-92`、`:313-323`、`:401-404`）。
- **7.2.12** 剪贴板截图按日期 + 两位序号命名；从 Finder 粘贴的真实文件保留原名（`comment-refs.mjs` 已覆盖）。

### 7.3 交互态 / 隐身态（Tab）　代码：`visual-revise.js:165-177`

- **7.3.1** `Tab` → 隐身态：进 browse 模式**且把工具条一起藏**（`:176`）。（AC-2.7）　现有覆盖：`tests-e2e/toolbar.mjs`、`acceptance.mjs`
- **7.3.2** 隐身态下除 `Tab` 外**所有按键放行给页面**（`if (!stealth)` 包住了模式键，`:288`）。（AC-2.8）
- **7.3.3** 再按 `Tab` 回到进入前的模式（`modeBeforeStealth`，`:168-173`）。
- **7.3.4** `Esc` 也能从隐身态回到选择态（`:339`）。（AC-2.9）
- **7.3.5** 面板内 `Tab` 归面板（切焦点），不进隐身态（`isEditorUI(e) && e.key === 'Tab'` → return，`:229`）。（AC-4.5）

### 7.4 点击隔离　代码：`visual-revise.js:484-487`

- **7.4.1** 点插件 UI 时 `pointerdown/mousedown/click/dblclick/contextmenu` 在 body 冒泡阶段被 `stopPropagation`——页面自己的「点外面关闭」不会被误触发。　现有覆盖：`tests-e2e/panel.mjs`
- **7.4.2** 不拦 `pointerup/mouseup`——缩放把手的收尾监听绑在 document 冒泡阶段，拦了拖拽就结束不了（`:479-483`）。
- **7.4.3** 点页面自己的区域时页面 outside-click 照常生效。

### 7.5 共享元素（同构联动）　代码：`core/shared-elements.js`、`props-panel:365-380`

- **7.5.1** 开启后所有面板写入落到 `#scope()` 全集（`:351-355`、`:360-363`）。（AC-7.6）　现有覆盖：`tests-e2e/advanced.mjs`
- **7.5.2** 指纹按结构算（`fingerprint(el, depth=2)`，`shared-elements.js:11`）。
- **7.5.3** 结构树重排：**同父换位按下标联动**；**跨容器只作用于当前元素**并 toast（`props-panel:561-595`）。（AC-7.9）
- **7.5.4** 面板副标题显示「联动 N 个」（`:476-478`）。
- **7.5.5** 换选元素时重新计算同构集（`:315-316`）。

### 7.6 右键菜单　代码：`extension/contextmenu/*.js`

- **7.6.1** `Show/Hide`：等价于点扩展图标（`launcher.js:22-30`）。　现有覆盖：**无**
- **7.6.2** 颜色格式 / 配色方案菜单：向页面发消息设 `color-mode` / `color-scheme` 属性（`colormode.js`、`colorscheme.js`；`inject.js:71-79`）。　现有覆盖：**无**

---

## 8. 现有 e2e 覆盖矩阵

跑法：`npm run test:e2e`（= `node tests-e2e/all.mjs`）。断言原语只有两个：
`ok(cond, msg)`（`tests-e2e/harness.mjs`）与各 `acceptance-*.mjs` 里本地定义的 `AC(id, cond, msg)`
（就是 `ok` 加了个 AC 编号前缀）。`all.mjs` 按顺序 spawn 30 个套件，统计 `✔`/`✘`。
**合计约 1057 条断言。**

| 文件 | 在 all.mjs | 断言数 | 覆盖本清单的编号 |
|---|---|---|---|
| `smoke.mjs` | ✅ | 16 | 1.0.4、1.0.5、1.0.6、4.1.1、§4.6（仅"工具切换仍正常"一条）、5.x（inline 写入成立） |
| `core.mjs` | ✅ | 20 | 5.4（锚点）、6.1.3、6.1.4、5.1.12、§5 快照 diff 全部边界（原有 inline 不算假改动、写回原值不记、移除声明记为改动） |
| `toolbar.mjs` | ✅ | 89 | §1 几乎全部（1.1.1–1.1.6、1.2.1–1.2.12、1.3.3、1.3.4、1.4.1–1.4.4、1.5.1、1.6.1–1.6.4）、7.3.1–7.3.4、2.1.5、2.2.3、4.1.19 |
| `controls.mjs` | ✅ | 30 | 3.1.1–3.1.3、3.1.6、3.1.8、3.4.1–3.4.8、3.5.1–3.5.7、3.6.7 |
| `panel.mjs` | ✅ | 49 | 2.1.1、2.1.5–2.1.12、2.3.13、2.4.7、2.4.8、2.5.14、2.3.5、4.1.8、7.4.1–7.4.3、6.1.3 |
| `figma.mjs` | ✅ | 42 | 2.3.x（分区顺序 / 命名 / 脏标记 / 重置本组）、2.4.1–2.4.4、2.4.6、2.5.3、2.5.7、2.8.5、2.8.6、2.9.5 |
| `typography.mjs` | ✅ | 32 | 2.3.2、2.3.3、2.7.1–2.7.8、`isTextElement` 判定全部边界 |
| `layout.mjs` | ✅ | 28 | 2.5.1、2.5.2、2.5.9、2.5.10、2.5.14、2.5.15、2.5.17 |
| `grid.mjs` | ✅ | 24 | 2.5.11–2.5.13、2.12.1–2.12.9 |
| `resizing.mjs` | ✅ | 44 | 2.5.3–2.5.8、2.1.12（滚动不跳）、2.4.8 |
| `fill.mjs` | ✅ | 40 | 3.6.1–3.6.6i、2.8.5、2.8.14 |
| `image-fill.mjs` | ✅ | 24 | 2.8.1、2.8.3、2.8.10–2.8.13、`isRelevant` 的全部条件分支、2.7 整块隐藏 |
| `swap-image.mjs` | ✅ | 18 | 2.8.2、5.1.5、6.1.3、6.1.4、5.1.12 |
| `text.mjs` | ✅ | 31 | 4.3.1–4.3.8、5.1.4、5.1.12、6.1.3 |
| `list.mjs` | ✅ | 26 | 5.1.1、5.1.7、5.1.10–5.1.14 |
| `comment.mjs` | ✅ | 28 | 7.1.1–7.1.7、7.1.9、6.1.3 |
| `comment-refs.mjs` | ✅ | 49 | 7.2.1–7.2.12、6.1.5 |
| `removal.mjs` | ✅ | 24 | 4.1.18、5.1.6、5.3.1、6.1.3、6.2.3、6.3.1 |
| `reanchor.mjs` | ✅ | 27 | 5.4.1–5.4.5、5.1.9、5.3.1、5.3.2 |
| `tree.mjs` | ✅ | 29 | 2.2.1、2.2.2、2.13.2–2.13.9、2.13.12、2.13.14、2.13.15、2.13.19 |
| `history.mjs` | ✅ | 38 | 1.3.1、1.3.2、1.3.6、1.3.7、5.2.1–5.2.5、5.3.1、5.3.2、4.4.13 |
| `guides.mjs` | ✅ | **3** | 4.5.3（仅"有测距线"这一条粒度） |
| `drag.mjs` | ✅ | 41 | 4.4.1–4.4.13、2.2.4、6.1.3、6.1.7 |
| `advanced.mjs` | ✅ | 28 | 7.5.1、7.5.2、7.5.4、6.2.2、6.2.3、6.3.1–6.3.3、2.7.2（本地字体降级） |
| `acceptance.mjs` | ✅ | 55 | AC-1.x/2.x/3.x/4.x/5.x → 1.0.1–1.0.5、1.2.x、4.1.1–4.1.12、4.1.19、2.1.6–2.1.8、7.3.x |
| `acceptance-panel.mjs` | ✅ | 69 | AC-6.1–6.24 → 2.4–2.11 逐控件 |
| `acceptance-content.mjs` | ✅ | 20 | AC-7.x → 4.3、2.8.2、4.1.18、4.4、2.13.9、7.5 |
| `acceptance-export.mjs` | ✅ | 18 | AC-8.x → 5.1、5.2、7.1、7.2、6.1、6.2、6.3、5.4 |
| `acceptance-ui.mjs` | ✅ | 19 | AC-9.x → 面板视觉一致性（图标 / 对齐 / 间距 / 对比度 / 效果参数面板） |
| `acceptance-popover.mjs` | ✅ | 29 | AC-6.25–6.30 → 3.1.4、3.1.7、3.1.9、3.2.7、3.2.9、3.4、3.5.7、3.6.7、3.6.8 |
| `e2e-inject.mjs` | ❌ 孤儿 | 9 | 1.0（真实扩展 service worker → executeScript 链路） |
| `extension.mjs` | ❌ 孤儿 | 10 | 1.0.1、1.0.3、1.0.6（真实扩展加载，需 `--enable-unsafe-extension-debugging`） |
| `live.mjs` | ❌ 孤儿 | 5 | 真实站点（example.com / MDN）冒烟 |
| `locate.mjs` | ❌ 孤儿 | 7 | 6.1.3（CSS Modules 哈希类名下靠文本锚点定位源码） |
| `real-demo.mjs` | ❌ 孤儿 | 0 | 演示脚本，需 `DEMO_URL` |
| `shots.mjs` | ❌ 孤儿 | 0 | 截图生成 |

**孤儿说明**：`extension.mjs` / `e2e-inject.mjs` 需真实扩展加载，`live.mjs` 需外网，
`locate.mjs` 依赖 `tests-e2e/mock-project` 这套单独固件，`real-demo.mjs` / `shots.mjs` 无断言。
它们不在 `all.mjs` 里，日常跑不到——`npm run test:ext` / `test:live` / `test:locate` 各有单独入口。

---

## 9. 覆盖缺口清单（按优先级）

### 9.1 完全没有覆盖（零断言）

| 编号 | 功能点 | 为什么值得测 |
|---|---|---|
| **4.6.1–4.6.16** | **上游 13 个 VisBug 工具的全部键鼠操作**（Position / Margin / Padding / Flex Align / Move / Hue Shift / Box Shadow / Font / Search / Inspect / Accessibility / imageswap 拖放换图） | 它们**仍可达**（`⌘/` 唤出工具条 → 点按钮激活，`vis-bug.element.js:135`，这条热键**没被解绑**），且方向键不被 Visual Revise 拦截。一旦激活，方向键会在用户毫不知情的情况下改样式；而这些工具写的属性有一半不在 `TRACKED_PROPS` 里（`font-style`、`align-content`、`transform`），改了也不进提示词 |
| **1.8.1–1.8.4** | `⌘/` / `⌘.` 唤出上游工具条 | 同上，是 4.6 的唯一入口；也是一个用户可能误触的隐藏状态 |
| **4.6.16** | `shift+/` 快捷键帮助浮层 | 全局绑定且未解绑，渲染在 `display:none` 的宿主里——按了「什么都没发生」是 bug 还是设计？ |
| **4.2.1–4.2.4** | **选中框上的 8 个缩放把手** | 这是选中后最显眼的交互之一。当前**一条断言都没有**：拖动写 `width`/`height`/`transform`，其中 `transform` **不在 `TRACKED_PROPS` 里**，位移量既不进改动记录也不进提示词——用户拖完看着变了，导出给 AI 却少一半信息 |
| **4.1.13** | `⌘G` / `⌘⇧G` 分组 / 取消分组 | 会**改 DOM 结构**（插入 / 删除 `<div>`），但不走 `ChangeStore.moveElement`，很可能既不进改动记录也不可撤销 |
| **4.1.14** | `⌥Delete` / `⌥Backspace` 清空 inline style | 一键抹掉该元素全部改稿。有没有进历史栈？`⌘Z` 救不救得回来？ |
| **4.1.15** | `⌘C` / `⌘X` / `⌘V` 元素级剪贴板 | `⌘X` 会删元素但**不走 `ChangeStore.removeElements`**，记录里大概率没有这一条，也放不回去 |
| **4.1.16** | 按住 `Ctrl` 隐藏选中覆盖层 | 直接改 `style.display`，与浏览模式的 `UI_TAGS` 隐藏机制可能打架 |
| **7.6.1、7.6.2** | 右键菜单三项（Show/Hide、颜色格式、配色方案） | 需真实扩展环境；`color-mode` / `color-scheme` 属性对 fork 的新 UI 是否还有意义未验证 |
| **2.13.1** | 结构树头部的关闭 `×` | 派发 `vr-tree-close`，但**宿主没有任何监听**（grep 全仓无 `vr-tree-close` 监听）——点了没反应，是个已存在的死按钮 |
| **1.0.2** | `Alt+Shift+D` 浏览器命令 | 只能在真实扩展环境验证；`acceptance.mjs` 已明确 SKIP |
| **1.0.7** | 右键 `Show/Hide` | 同上 |
| **1.7.1、1.7.2** | 工具条拖动 + 位置不落盘 | 面板拖动有 4 条 AC，工具条一条都没有。「拖到别处后刷新是否回默认位」这个行为差异没有被固定下来 |

### 9.2 只覆盖了「大概」（有断言但粒度太粗）

| 编号 | 功能点 | 现状 | 缺什么 |
|---|---|---|---|
| **4.5.1–4.5.5** | **标尺线 / 测距** | `guides.mjs` 只有 **3 条**断言（"有测距线"、"有 N 个标签"、"选中框仍在"），是全套件里最薄的一个 | 没有验证距离**数值是否正确**、右/左/上/下/重叠五种几何关系分支（`measurements.js:20-128`）、多选时的"粘住"行为（`stickGuide`）、滚动时隐藏 |
| **3.4.4** | 色盘吸管（EyeDropper） | `controls.mjs` 只断言"含吸管按钮" | 不支持时是否 `disabled` + 正确 title；支持时的取色回填路径完全没测 |
| **2.7.2** | 读取本地字体 | `advanced.mjs` 测了 API 检测与降级文案 | 授权成功后「补进下拉 + toast N 个」这条主路径没测 |
| **2.10.3** | 七种效果的参数面板 | `acceptance-ui.mjs` AC-9.8 测了**布局不溢出**；`acceptance-panel.mjs` 测了投影改 Y | 另外六种效果（内阴影 / 图层模糊 / 背景模糊 / 噪点 / 纹理 / 玻璃）的每个字段**写入什么 CSS** 都没逐个验证；`#effectSummary` 五种分支的文案没测 |
| **2.10.7** | 噪点 / 纹理与填充层共用 `background-image` | AC-6.12d 在 PRD 里，但矩阵里找不到对应断言 | 效果层排在填充层之前、填充解析跳过效果层这条互不吞噬的契约没有端到端断言 |
| **2.11.x** | 变量绑定 | `acceptance-panel.mjs` 覆盖较全，但多条断言写着「菜单里找不到测试变量，跳过」 | 固件里没有可用的 CSS 变量时这些断言**自动跳过而非失败**——实际执行率存疑，需要给固件补 `:root { --x }` 并确认真的跑到 |
| **2.3.6、2.3.7** | 分区级「临时关闭本组」眼睛 | `figma.mjs` 断言「Fill 标题不再有分区级眼睛」；`acceptance-panel.mjs` 测了层级眼睛 | `HIDEABLE` 里三个分区都是层列表分区，**标题级眼睛在当前 UI 里实际不渲染**——`#toggleSection` / `hideMapFor` 这两段代码是否还有活的入口，没有测试能回答 |
| **5.1.15、5.1.16、2.1.11** | rAF 合并渲染、滚轮不穿透 | `panel.mjs` 测了面板滚轮不穿透、30 次更新节点不换 | 改动列表与结构树的滚轮隔离没测 |
| **6.1.5、6.1.6** | 参考图落盘的两条通道 | `comment-refs.mjs` 测了「拿不到确切路径时如实标注」 | **扩展通道**（`chrome.downloads` 拿绝对路径）在无头 fixture 里跑不到，四种 toast 文案只验了其中一两种 |
| **6.3.4、6.3.5** | 导入的 toast 汇总与各类错误文案 | `advanced.mjs` 测了 `report` 对象的字段 | UI 层拼出来的那句话（含 moves / removals / comments / viaText / missing 五个可选片段）没有断言 |
| **3.2.2–3.2.5** | `openMenu` 的项形态 | `acceptance-popover.mjs` 测了滚动 / Esc / 选中 | `separator`、`disabled` 不响应点击、`checked` 底色、`swatch` 色圈、`hint` 这五种渲染分支只在变量菜单里间接摸到 |

### 9.3 三块最大的缺口（建议优先补）

1. **上游 VisBug 工具的整条路径（§4.6 + §1.8，零覆盖）**
   —— 13 个工具、约 60 组键鼠组合，通过一个**未解绑**的 `⌘/` 就能进入，且进入后方向键直接改样式。
   这是「功能存在但没人走过」的典型：要么补测（含"改动是否进记录/提示词"），要么明确决定把 `⌘/`
   一并解绑并加一条断言锁住。

2. **选中框缩放把手（§4.2，零覆盖）+ `transform` 不被跟踪**
   —— 用户最容易上手的直接操作之一，8 个把手一条断言都没有；而且它写的 `transform`
   不在 `TRACKED_PROPS` 里，导出的提示词会漏掉位移。这是一条会**静默丢改动**的路径。

3. **结构性 DOM 操作的记录/撤销完整性（§4.1.13–4.1.15，零覆盖）**
   —— `⌘G` 分组、`⌘X` 剪切、`⌥Delete` 清样式三个快捷键都会改 DOM / 抹掉改动，
   但都不走 `ChangeStore` 的对应入口。需要断言它们「要么进记录且可撤销，要么被明确禁用」。

> 附带两个可以顺手锁住的小问题：结构树头部 `×`（§2.13.1）派发的 `vr-tree-close` 无人监听；
> `shift+/`（§4.6.16）在隐藏宿主里渲染帮助浮层，按下去毫无反应。
