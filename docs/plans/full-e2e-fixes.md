# 全量 e2e 报出的 27 条 bug 修复方案（v2）

> 关联：bug 清单与复现证据见 [full-e2e-report.md](full-e2e-report.md) §3（编号 B01–B27，本文沿用）；
> v1 的评审见 [full-e2e-fixes.review.md](full-e2e-fixes.review.md)（24 条必改 + 7 条建议全部吸收进本版，**评审里的「代码事实」是实施约束**）；
> 功能点编号见 [feature-inventory.md](feature-inventory.md)。
> 用户决定（2026-09-07）：`⌘G`/`⌘⇧G` 分组、`⌘C`/`⌘X`/`⌘V` 元素剪贴板、`⌥Delete` 清样式**三组都保留，接进改动记录**；其余 24 条一并修。

## 0. 分工与边界

两个实施 agent 并行，**文件所有权严格分开**，互不触碰对方的文件：

| | 甲：核心 / 上游路径 | 乙：面板 / 控件 / 列表 |
|---|---|---|
| 负责 | B01 B04 B05 B07 B08 B09 B10 B12 B14 B15 B16 B17 B18 B19 B20 B22 | B02 B03 B06 B11 B13 B21 B23 B24 B25 B26 B27 + **`insert` 记录在改动列表里的渲染与计数（§2.0）** + B09 的 fill 侧调用（§2.12） |
| 可改的源码 | `app/features/*`、`app/core/{visual-revise,layout-drag,dom-utils,change-store,history,tracked-props,snapshot,prompt-export,json-io,image-assets}.js`、`app/utilities/common.js`、`app/components/selection/*`、`app/components/comment-layer/*` | `app/components/props-panel/*`、`app/components/controls/*`、`app/components/tree/*`、`app/components/change-list/*`、`app/core/{controls,effects,fills,gradient}.js` |
| 可改的 full 套件 | `tests-e2e/full/{select-handles-text,drag-guides-upstream,history-changes,export-comments-misc}.mjs` 及其 fixtures | `tests-e2e/full/{layout-appearance,panel-head-position,stroke-effects,typography-fill,popovers,tree}.mjs` 及其 fixtures |
| 可改的旧套件 | `tests-e2e/{advanced,acceptance-export,acceptance-variables,removal,text,toolbar,acceptance,drag,acceptance-content,acceptance-ui,figma}.mjs` | `tests-e2e/list.mjs` |

- 谁都不动：`app/visbug.element.js`、`tests-e2e/all.mjs`、`tests-e2e/harness.mjs`、`fixture.html`、`docs/PRD.md`、工作日志。要加的 AC 条文写进最终报告，由主线程合并。不 commit。
- 断言规则：full 套件里对应的失败断言必须转绿，**不能改弱**；只有断言本身写错、或它锁的是本方案明确要改掉的旧行为（例如「transform 不被跟踪」「树头有关闭钮」「schema === 4」）才能改，报告里逐条说明。
- 完成标准：各自负责的 full 套件 0 失败（不可测项除外）；`node tests-e2e/all.mjs` 0 失败 / 0 异常退出（`advanced` 的拖拽偶发已知，单跑通过即可）。
- 两人共用的接口只有一处：甲在 `change-store.js` 里新增的 `insert` 记录种类与 `read().inserts` / `stats()`（§1.1），乙按 §1.1 写死的形状渲染，不等甲完成也能先写。

## 1. 甲：核心 / 上游路径

### 1.1 新记录种类 `insert`（B04 B14 B05 B17 的地基）——按 `move` 的写法

- `ChangeStore.insertElement(el, parent, next = null, label = '新增元素')`：插到 `parent` 的 `next` 之前（null 则 append）。记录 `{ kind: 'insert', id, el, parentAnchors, nextAnchors, atEnd, html }`——**锚点照 `moveElement`（`change-store.js:377-383`）的做法，插入前采**；不要 `parentPath` / `index`（仓库没有这套概念，`:nth-of-type` 会随插入漂移）。`html` 是剥掉编辑器记号后的 outerHTML。
- `applyOp case 'insert'`：redo = 按 `op.el` 节点引用放回（`next` 失联时 append，同 `move` 的守卫）；undo = `el.remove()`，节点留在记录里。
- `beforeRecord/afterRecord` 维护 `inserts` Map；`read()` 返回 `inserts`（`:1029`）；`stats()` 的 `total` 计入 `inserts.size`（`:1013-1027`）；`undoEverything`（`:965-1000`）把插入的节点摘掉并清 Map；`reconcile` 的快照循环对 `inserts` 豁免（跟 `removals` 那条 `:689` 一样，否则 undo 后会多出「元素已消失」幽灵记录）；`captureAll/restoreAll` 加一份跟 `detached` 对称的 `attached` 名单（`:65-127`）。
- **对消**：`removeElements` 遇到本会话 `insert` 出来的元素，不记 `dom` 删除、而是撤掉那条 insert 记录（原页面里它从来不存在，「删除的元素」段会给 AI 一条无法执行的指令）。
- 语义入口（评审建议 2）：`ChangeStore.groupElements(els)` / `ungroupElement(wrapper)`，把「insert + n×move」「n×move + 对消」封在 store 里，`selectable.js` 只调一句。
- `prompt-export.js`：`buildPrompt` / `copyPrompt` 的解构与空判加 `inserts = []`（`:355-356`、`:459-461`；`tests-e2e/removal.mjs:141` 手搓的 state 没有这个键，缺默认值会异常退出）；新段标题用中文「## 新增的元素」（`figma.mjs:234` 断言提示词里没有英文分区名），每条复用 `placeLine` 写位置 + 精简 outerHTML（超过 400 字截断并注明）。
- `json-io.js`：导出 `inserts: [{ parentAnchors, nextAnchors, atEnd, html }]`；导入顺序固定 **edits → inserts → moves → removals → comments**（分组是先 insert wrapper 再 move 子元素进去，moves 先跑 wrapper 还不存在），复用 `:157-162` 的 `atEnd` 分支插回。`SCHEMA_VERSION` 5，**`SUPPORTED = new Set([1,2,3,4,5])`**（`advanced.mjs:172` 的 v1 夹具必须还能导入）。改 `advanced.mjs:121`、`acceptance-export.mjs:152`、`acceptance-variables.mjs:483` 的 `schema === 4` 为 5。

### 1.2 B04 + B14 `⌘G` / `⌘⇧G`

- `selectable.js` **直接 `import { ChangeStore } from '../core/change-store.js'`**（`change-store` 不 import features，无环；`visual-revise.js:6` 就是这么引的）。不要注入——`Selectable(visbug)` 的构造点在谁都不能改的 `app/visbug.element.js`。
- `groupElements(els)`：先按 `compareDocumentPosition` 排成文档顺序（`selected` 是选中倒序，现有代码还 `selected.reverse()` 原地改数组），以最靠前那个的 `parent` + `nextElementSibling` 为锚 `insertElement(wrapper)`，再逐个 `moveElement(el, wrapper, null)`；整个包在 `history.batch('分组')` 里。跨父节点分组会把元素跨容器搬走（上游如此），最终报告里点名。
- `ungroupElement(wrapper)`：先记 `wrapperNext = wrapper.nextElementSibling`，子元素正序 `moveElement(child, wrapper.parentElement, wrapperNext)`（**落点不能是 wrapper 自己**，那个节点马上要没了，提示词会指向不存在的元素），最后对消 / `removeElements([wrapper])`；`history.batch('取消分组')`。
- 结束后选中 wrapper / 原子元素；一次 `⌘Z` 整体退回。

### 1.3 B05 + B17 `⌘C` / `⌘X` / `⌘V` + `⌘D`

- `stripEditorMarks(clone)`：剥 `data-selected`、`data-label-id`、`data-visual-revise-*`、`data-vr-*`、`contenteditable`、`spellcheck`（抽出 `unselect_all` 那份清单）。`on_copy` / `on_cut` / **`on_duplicate`**（`:176-183` 一模一样的撞号 bug）都用它。
- `on_cut`：`ChangeStore.removeElements(selected)`（从「只删 `selected[0]`」扩成删全部选中——有意的行为扩大，报告里写明）再写剪贴板。
- `on_paste`：`navigator.clipboard.readText()` 包 try/catch，失败时 toast「读不到剪贴板」不静默；解析用 `body.firstElementChild`（`htmlStringToDom` 返回的 `firstChild` 可能是文本节点）；每个选中元素 `insertElement(node, el, null, '粘贴元素')`（上游是 append 进内部），多目标包一个 batch。
- 测试：`page.context().grantPermissions(['clipboard-read','clipboard-write'], { origin })`。

### 1.4 B15 + B16 `⌥Delete` / `⌥Backspace`

- `visual-revise.js` 的 `onKeydown`：新分支放在 `:222` 的 `altKey` 放行**之前**，自带守卫 `e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace') && !interactive && !isTypingTarget(e) && !isEditorUI(e)`（否则会吃掉输入框里删一个词的 ⌥Backspace）。`history.batch('清空样式', …)` 里对每个选中元素的每条 inline 属性 `applyProp(el, p, '')`，important 由 `applyProp` 处理。
- `selectable.js` 三处一起删：`:76` 的 `hotkeys('alt+del,alt+backspace', on_clearstyles)`、`HOTKEYS` 表 `:37` 那行、`on_clearstyles` 本体（`:189-191`）。**只 unbind 一条不行**，`listen()` 往返时会重新绑回。

### 1.5 B18 `unselect` 留下已断开的把手（顺带治本 B05 撞号）

- `unselect` 里按**元素引用**把被摘的 label / handle 从两个数组里剔掉（`labels` 与 `handles` **不平行**，`createLabel` 只在 `no_label === false` 时才建；不要 `labels[i] = handles[i] = null`，`:120` 的 `[...labels, ...handles].filter(node => node.getAttribute(…))` 与 `:456 :625 :665` 的 `forEach` 都会撞 null）。
- `select()` 的 id 改成**单调递增计数器**，不再用 `handles.length` 发号；`handle.element.js:42` 按 id 找元素的路径随之稳定。
- `tests-e2e/acceptance.mjs:230-231`（Shift+单击取消其中一个）必须保持绿。

### 1.6 B12 面板内横向拖越界松手换选中

`selectable.js:99` `on_click` 开头：`composedPath()[0]` 落在编辑器 UI（`isEditorUI`）时早退——但**不能**把浮在选中元素上的 `visbug-handles` / `visbug-handle` 一起吃掉（`panel.mjs:418-420`「同一下点击仍正常选中页面元素」要保持绿）。

### 1.7 B19 缩放把手写 `transform` 不被跟踪

- `handle.element.js` 带 `start/top` 的五个分支（`:75 :86 :97 :108 :127`）改写独立属性 `translate: Xpx Ypx`；**基数改读 `initialStyle.translate`**（`'none'` / `'40px'` / `'40px 30px'`，自己解析 x/y 再累加）——`DOMMatrix(computed.transform)` 不含独立 translate，不改基数第二次拖会先跳回原点。
- `tracked-props.js` Position 组加 `translate`。**不加** `CONTROLS['translate']`（面板不多出控件，`#renderField` 对缺失的 spec 返回空串）；提示词里出现的是 `| translate | none | 40px 30px |` 归「定位」段，没有「位移」二字——接受。
- 行为变更写进报告：以前写 `transform` 是整条覆盖页面原有 transform，现在是叠加。
- 测试：`full/select-handles-text.mjs:554-577`（8 个把手断言 `style.transform`）与 `:587-591` 改成 `translate` 进记录、进提示词；**实跑** `drag.mjs:56,129,187,214` 与 `acceptance-content.mjs:138`（`props === 0` / `total === 0`）：它们的起拖点在 `visbug-handles` 上，今天靠「transform 不被跟踪」才绿。若红，说明页面拖拽手势同时触发了把手写入——这是要修的根因（拖拽接管后把手不该写），**不许改断言**。

### 1.8 B20 编辑文案时 Escape 退不出

- `visual-revise.js:328` Escape 分支、取消选中之前：判据是 **`e.composedPath()[0].isContentEditable`**（不是 `isTypingTarget`，否则 `toolbar.mjs:293-295 / 306-308` 红）→ 自己做三件事：`blur()`、摘 `contenteditable` / `spellcheck`、`getSelection().empty()`，然后 return；第二下 Esc 才取消选中。
- **不要调 `text.js` 的 `cleanup`**：它没 export，而且 `removeEditability` 里的 `hotkeys.unbind('escape,esc')` 会把全局所有 esc 绑定一起解掉。
- `text.mjs:172-173`「编辑过文案之后一次 Esc 仍能取消选中」：那个流程是点另一张卡离开编辑态（`contenteditable` 已摘），严格判据下保持绿；实跑确认。

### 1.9 B07 上游 Search 输入框丢字

`dom-utils.js:37` `isTypingTarget`：从 `composedPath()[0]` 起沿 shadow root 下钻到真正的 `activeElement`（open 的 `shadowRoot.activeElement`，上游 closed 的用元素自挂的 `$shadow`），再判 INPUT / TEXTAREA / SELECT / contentEditable。

### 1.10 B22 Position 工具的拖动被自家页面拖拽抢走

`visual-revise.js:74` 那一行没有 `setActive`（真正的调用点是 `:84 :298 :380 :400`），且 `mode` 与 `visbug.activeTool` 是两个维度，`toolSelected` 在谁都不能改的 `visbug.element.js`。**改法**：`createLayoutDrag` 多收一个 `activeTool: () => visbug.activeTool`，`layout-drag.js` 的 `onPointerDown`（`:235-248`）开头 `if (MOUSE_TOOLS.has(activeTool?.())) return`（`position` / `move`）。四个 `setActive` 调用点都不动。

### 1.11 B01 `pointercancel`

`layout-drag.js:245-247` 跟 move / up 一起注册 `pointercancel`（capture，handler `endDrag({ commit: false })`），`disarm()`（`:228-232`）对称移除。`endDrag` 在 `!drag` 时先 `disarm()` 再 return，slop 之前取消也安全。

### 1.12 B10 「重置全部」丢文案改动

`captureAll` 的每个 styles 快照补 `textNodes: textNodesOf(el).map(n => n.nodeValue)`，`restoreAll` 节点数相同时逐个写回（照 `captureElement` `:128-134` / `applyOp case 'element'` `:181-186`）。失联快照（`frozen`）那条路救不回，报告里注明不做。

### 1.13 B08 + B09 评论参考图

- `visual-revise.js:558` 给 `comments` 补 `vr-toast` 监听。
- `image-assets.js` 是纯函数模块，拿不到 store：`readImageList(files, { base = 0 })` 加参数，累加 `base + Σ 本批` 与 `MAX_TOTAL` 比较，超出的图 `ok:false` + 「已超出会话累计上限（20 MB）」进 errors；`comment-layer.element.js:482/510` 传 `totalBytes(ChangeStore.allAssets())`。fill 侧的调用在乙的文件里，见 §2.12。

## 2. 乙：面板 / 控件 / 列表

### 2.0 `insert` 记录在改动列表里（B04 B05 B14 B17 的用户可见面）

`change-list.element.js` 是四路写死映射（`:108` 解构、`:130-134` 渲染、`:242-248` `#elementOf`、`:114` 计数），没有按 `kind` 分发。加第五路：`inserts.map(#renderInsert)`（行文案「新增元素」/ 按记录 label，显示精简 outerHTML 首 60 字与位置）、`#elementOf` 分支、「全部」/「配置」计数与 `stats()` 一致（`list.mjs:33,36,196-197` 两个计数必须对得上）。单条撤销走既有路径。记录形状按 §1.1：`{ id, el, parentAnchors, nextAnchors, atEnd, html, label }`。

### 2.1 B02 改动列表不滚动

`change-list.element.css:65` `.items` 加 `grid-auto-rows: max-content`。

### 2.2 B03 两段式内 / 外边距前缀拖拽不写声明

`props-panel.element.js:2585` 的 `[data-drag]` pointerdown：`handle.dataset.prop` 缺失时按 `data-pair` 解析出 `SIDE_SETS[kind][dir]` 的两条属性，用第一条驱动 `stepSize` / `stepValue` / 显示，提交时两条一起写在一个 batch 里；方向键路径同样补上。

### 2.3 B11 四边联动改一边产生两条历史（顺带 `.lock`）

`:2373` 通用 `input[data-prop]` change 处理器开头早退：该 input 带 `data-side` 且对应 `.lock[data-lock]` 处于 `data-on` 时直接 return，提交权交给 `:2569` 的联动 batch。顺手把 `.lock` 点击处理器（`:2555-2565`）的四次 `#commit` 包进一个 batch。

### 2.4 B13 旋转框裸数字步进写出 `px`

`controls.js:260-261` `stepValue`：推不出单位时先从 fallback（计算值 `45deg`）取，取不到再按 `CONTROLS[prop].coerce` 决定默认单位（`coerceAngle → deg`），最后才补 `px`。

### 2.5 B24 不透明度步进越界

`controls.js:247` `stepValue` 算完 `next` 后按 `CONTROLS[prop]?.min/max` 夹一次。

### 2.6 B23 替换元素上的「裁剪内容」

`props-panel.element.js:784` → `if (isRelevant('overflow', this.#computed, el)) rows.push(this.#renderClip())`。

### 2.7 B21 隐藏填充层期间的改动被回滚

`#toggleLayer` 现在是先设 `#layerRestore`（`:1248`）再 `#writeFillLayers`（`:1256`）：改成写完之后再采一份 inline 快照存进 `#layerRestore`；再开时（`:1223`）先比对当前 inline 是否仍等于那份快照，不等就不用原文回写、改走层模型重算。`#writeFillLayers` 加一个显式的「本次是关灯」参数，其它写入（含 `:1243` 那条 `saved.index !== i` 分支、`#writeBackground`）都清掉 `#layerRestore`。

### 2.8 B06 噪点 / 纹理 / 玻璃参数不回读

- **参数原样写进 data URI**：SVG 根元素加 `data-vr='size=0.5;density=100;color=%23fff;radius=4'`（`;` 分隔，**绝不能用 `&`**——XML 属性里是实体起始符），`parseEffects` 优先从它反解，容忍浏览器回读时的百分号再编码（`%3B` 等）；没有 `data-vr` 的旧值才退回按 `baseFrequency` / `opacity` 反解（有两段夹取死区：texture `size ≤ 1`、`radius ≥ 10`，报告里注明）。`id='vr-noise'` 记号不动，`isEffectLayer` 的子串匹配不受影响。
- 玻璃：`parseShadow` 已能认出那条 inset 高光（`:124`），在 `continue` 之前把 alpha 收起来，`:154` 用 `Math.round(alpha * 100)` 替掉硬写的 40。
- 加往返验证：serialize → parse 每个字段相等（走 `data-vr` 那条路，全区间可逆）。

### 2.9 B26 描边样式选 none 不退回空状态

`props-panel.element.js:177` `RERENDER_ON` 加 `border-style`（不加 `border-width`）。

### 2.10 B25 色盘色值框非法输入不回滚

`picker.js:227` 非法分支直接写回 `e.target.value = formatColor(rgba(), fmt)`，保留 `:207` 的焦点守卫给外部 sync。

### 2.11 B27 结构树头部的死关闭钮

删 `tree.element.js:47` 的 `<button class="tree-close">` 与 `:154-155` 的 `#emit('vr-tree-close')`。`tests-e2e/full/tree.mjs`：`:670 :676` 改成断言不存在，`:684-701` 整段删掉或改写（`:691` 的 locator 点击会超时中断整个套件）。

### 2.12 B09 的 fill 侧调用

props-panel 里图片填充上传走 `readImageList` 的地方（`#pickImage` 一带），传 `{ base: totalBytes(ChangeStore.allAssets()) }`（`totalBytes` 从 `image-assets.js` 导出）。甲把参数加好之前先按 `{ base }` 形状写，缺省 0 不影响。

## 3. 验收（主线程）

- 两份报告到齐后：重建 bundle，`node tests-e2e/full/all.mjs` 与 `node tests-e2e/all.mjs` 两套 0 失败。
- 抽查：`⌘G` → 改动列表 1 条「分组」插入 + n 条移动，`⌘Z` 一次全退，提示词里有「新增的元素」段且位置用锚点描述；`⌘⇧G` 后没有「删除的元素」假记录；`⌘X` 后有删除记录、`⌘Z` 放回；`⌥Delete` 后每条属性一行、一次 `⌘Z` 全回；把手拖两次不回弹，提示词「定位」段里有 `translate`；`⌘D` 副本不撞号。
- PRD：合并两份报告里的 AC 条文；工作日志由主线程写。
