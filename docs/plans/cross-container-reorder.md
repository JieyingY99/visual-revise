# 跨容器重排 — 实施计划（v2，已按评审修正）

> 关联：产品验收见 [../PRD.md](../PRD.md) §7；工作日志见 [../../.work-log-可视化改稿扩展.md](../../.work-log-可视化改稿扩展.md)。
> 本方案涉及的交互在全量功能清单里的位置：[feature-inventory.md](feature-inventory.md) §2.13（结构树拖拽）、§4.4（页面直接拖拽）。
> 仓库：`/Volumes/Jieying/OPC 探索/插件开发/visual-revise`。基线提交 `709df66`，全量回归 910 通过 / 0 失败。

## 0. 一句话

重排从「写 CSS `order`、只能在同一个 flex/grid 父级里换位」改成「真的移动 DOM 节点、可以拖进任何容器」；
同时页面上的直接拖拽在**所有 tab** 下都能用，不再只在结构 tab 下激活。

## 1. 为什么

- 用户在属性 tab 下按住页面元素拖，`pointerdown` 走的是 VisBug 的选择，拖不动——上上批把重排并进结构 tab 时把 `layoutDrag.setActive(mode === 'select' && panel.tab === 'structure')` 绑死了。
- 跨容器一直没实现：`layout-drag.js` 和 `tree.element.js` 都限制在 `el.parentElement` 且父级 `display` 为 flex/grid。CSS `order` 本身就做不到跨父级——那需要动 DOM。

## 2. 现状（实施前必读的接口）

| 文件 | 相关 |
|---|---|
| `app/core/reorder.js` | `orderedChildren(parent)`（按 computed `order` 排序的子元素列表）、`canReorder(el)`、`applyOrder(others, dragged, targetIndex)`——**唯一写 `order` 的地方**，页面拖拽和树拖拽共用 |
| `app/core/layout-drag.js` | 页面直接拖拽。`onPointerDown` 在按下那一刻就 `preventDefault + stopPropagation`（无 slop）；`dropIndexAt(others, x, y, row)` 只在同级里算落点；`endDrag({commit})` 调 `applyOrder`；`markDroppables()` 给 flex/grid 容器打 `data-vr-droppable` |
| `app/components/tree/tree.element.js` | 树拖拽（pointer 事件，捕获推迟到越过 `DRAG_SLOP`）。`#onDragMove` 只把同父级的行当落点；`#endDrag` 只 emit `vr-tree-reorder {container, others, dragged, index}`，不自己写 |
| `app/components/props-panel/props-panel.element.js` | `#applyReorder(detail)` 接树的事件，`#shared` 开着时按下标映射到每个同构容器（`findSharedElements`），调 `applyOrder` |
| `app/core/visual-revise.js` | 四处 `layoutDrag.setActive(...)`（第 288 / 369 / 394 / 550 行附近） |
| `app/core/change-store.js` | 记录类型 `prop / attr / dom / comment / text / element / all`。**`dom` 类型最接近 move**：`{kind:'dom', id, el, parent, nextSibling, beforeAttached, afterAttached, beforeRecord, afterRecord}`，用 `putBack(rec)` 插回 `parent.insertBefore(el, nextSibling)`。`applyOp(op, dir)` 是 undo/redo 的执行器。`reconcile()` 是框架重渲染后的重锚定：先 `reapplyRemoval` 再 `rebindSnapshot`。`read()` 返回 `{edits, comments, removals}`；`stats()` 统计 |
| `app/core/history.js` | `push(op, label)`、`batch(label, fn)`、undo/redo |
| `app/core/prompt-export.js` | 按元素分组描述 `edits`；`removalSection(removals)` 单独成段（第 262 行起）；第 389 行起是总装配 |
| `app/core/anchors.js` | `collectAnchors(el)`、`resolveElement(record, {exclude})`——按锚点找回元素 |
| `app/core/dom-utils.js` | `pageElementAt(x, y)`、`isEditorUI(e)` |
| `app/core/tree-model.js` | `childrenOf = orderedChildren`——树的行序是**按 CSS `order` 排过的** |
| `app/core/json-io.js` | `SCHEMA_VERSION = 2`、`SUPPORTED`；`importJSON` 有 edits / removals / comments 三个导入循环（:95 / :124 / :139）与 `report` 计数器（:78-81） |
| `app/components/change-list/change-list.element.js` | `items` 数组、`#elementOf`（:192-202）、`.restore` 按钮与处理器（:222-228, :312-319）、「配置 N」计数（:114）、`.copy/.export` 的 `disabled = stats.total === 0`（:123-124） |
| `app/features/selectable.js` | **VisBug 的选中挂在 `click`（:60 `page.addEventListener('click', on_click, true)`），不是 pointerdown。** `on_click` 用 `deepElementFromPoint` 重新命中并 `unselect_all + select`（:99-117） |
| 测试（评审实数） | `drag.mjs` ≈23 条、`acceptance-content.mjs` 5 条（AC-7.4-pre/7.4a/7.4b/7.4c/7.5，:119 硬依赖 `lib.applyOrder`）、`advanced.mjs` 4 条、`tree.mjs` 5 条、`comment.mjs` 2 条（:94/:107 断言 `!layoutDrag.active`，原因是 A 不是 order）、`shots.mjs` :56 `setMode('reorder')` 早已失效。合计 **≈39 条断言 + 6 处 `setReorderMode` 脚手架**。`toolbar.mjs` / `comment-refs.mjs` 与本改动无关 |

### 2.1 评审核对出、v1 漏列的调用点（全部要改）

- `app/core/visual-revise.js:72-74` `createLayoutDrag({ onDone: ({ ordered }) => toast })`——入参形状要换成 `{el, toParent, toNext}`
- `app/core/visual-revise.js:535-536` `vr-tree-reorder` 的第二个监听（toast）
- `app/core/visual-revise.js:621` `api.lib` 导出 `applyOrder`——`tests-e2e/acceptance-content.mjs:119` 直接调它
- `app/core/layout-drag.js:8`、`props-panel.element.js:19`、`visual-revise.js:25` 三处 `import { applyOrder }`——**删函数前不改这三处，rollup 直接报缺失导出，构建失败**
- `app/core/prompt-export.js` 的 order 导出链：`orderOf` / `collectReorders`(:304) / `reorderSection`(:345) / `:392` / `:398 changes.filter(c => c.prop !== 'order')` / `:417 摘要` / `:447` / `:494`——删 `applyOrder` 后全是死代码，要一并清；但 **`:398` 那行不能只删段落不删过滤**，否则用户在面板里手动改的 `order`（props-panel:720 仍渲染这个字段）会从导出里消失
- `app/components/props-panel/props-panel.element.js:2425-2429` `setReorderMode(on)` 查 `.reorder` 按钮——模板里早没这个类，死代码，顺手清
- `app/core/change-store.js:472` `reapplyRemoval(rec)` 调用时没传 `taken`（签名 :440 收这个参数）——新写 `reapplyMove` 别照抄

## 3. 设计

### A. 页面拖拽随时可用（加 slop）

`layout-drag.js`：
- `onPointerDown` 不再立刻抢事件。只记录 `{el, startX, startY, pointerId}`，挂 `pointermove` / `pointerup`。**去掉 pointerdown 的 `preventDefault` 后页面会开始原生文本选区拖选**，所以 pointerdown 时先挂一个一次性 `selectstart` 拦截（越过 slop 后 `preventDefault`；没越过就在 pointerup 时解绑）。
- `pointermove` 越过 **4px** 才真正开始拖：此时才 `preventDefault`、创建 ghost、给悬停容器打 `data-vr-drop-target`、通过 `onDragStart` 回调让 `visual-revise.js` 去 `engine.unselect_all()`（现在 `setReorderMode` 里那段「`visbug-handles` 会挡住拖动所以先清选择」就是干这个的，复用它）。
- **VisBug 的选中挂在 `click` 上（`selectable.js:60`，capture 阶段挂在 body）。** 拖完松手后浏览器仍会派发一次 click，`on_click` 会用落点坐标重新命中并选中——跨容器后那多半是**别的**元素。所以越过 slop 的那一刻要在 `document` 上挂一次性 **capture 阶段** click 拦截（`document` 早于 `body`，才拦得住），`stopPropagation + preventDefault`，用完即卸。然后在 `onDone` 里 `engine.select(el)` 重新选中被移动的元素。
- 没越过 slop 的 `pointerup`：解绑所有临时监听、什么都不做，VisBug 的 click 照常选中。
- `visual-revise.js` 四处 `setActive`：288 / 369 / 550 三处统一成 `mode === 'select'`。**第 394 行在 `setReorderMode(on)` 内部**，这个函数现在是"结构 tab 开关拖拽"的遗留，改成：`setReorderMode` 保留函数名（`drag.mjs:71/117`、`advanced.mjs:103` 靠它取消拖拽），语义改为「`on=false` 时 `layoutDrag.cancelDrag()` 并 `setActive(false)`；`on=true` 时 `setActive(mode === 'select')`」。
- `comment.mjs:94/107` 那两条 `!layoutDrag.active` 断言的真正意图是「输入过程中没进重排模式」，新模型下拖拽不再是模式，改成断言「输入过程中 `layoutDrag.dragging === false`」。

### B. 移动的核心：`ChangeStore.moveElement(el, toParent, toNext)`

在 `change-store.js` 新增，**完全照 `dom` 类型的模式**（`removeElements` / `putBack` / `restoreRemoval` / `applyOp case 'dom'`）：

```js
// moves Map：id → { id, seq, el,
//   fromParent, fromNext, fromAnchors, fromParentAnchors, fromNextAnchors, fromAtEnd,
//   toParent,   toNext,   toParentAnchors,   toNextAnchors,   toAtEnd,
//   anchors,          // el 自己的锚点，移动前采集，成功重放后用 collectAnchors 刷新
//   orphaned, fighting, replayCount }
//
// history op：{ kind:'move', id, el,
//   fromParent, fromNext, toParent, toNext,
//   beforeRecord, afterRecord }   // ← 跟 dom 一样，undo/redo 靠这两个同步 moves Map
```

- **执行前守卫**（缺一条历史栈就会损坏——`applyOp` 抛异常会让 `history.js:89` 那个循环跳过剩余 op、但 entry 仍进 `future`）：
  - `toParent.isConnected`，否则跳过
  - `toNext` 必须仍是 `toParent` 的子节点：`toNext?.isConnected && toNext.parentElement === toParent ? insertBefore(el, toNext) : appendChild(el)`——复用 `putBack` 的写法
  - 拒绝 `el === toParent || el.contains(toParent)`
  - 拒绝 `toParent === document.documentElement`
- **值没变就不记**：`toParent === el.parentElement && toNext === el.nextElementSibling`。**是 `nextElementSibling` 不是 `nextSibling`**，后者会命中空白文本节点，原地拖拽会被记成一条真实 move。
- **`applyOp` 加 `case 'move'`**：undo → 用同样的守卫把 `el` 放回 `fromParent/fromNext`；redo → 放到 `toParent/toNext`；然后 `record ? moves.set(op.id, {...record}) : moves.delete(op.id)`（照 `dom` 的 :135）。
- **合并规则**：同一个元素移动多次只保留一条（from 取第一次、to 取最后一次）；移回原位就删掉这条。`beforeRecord/afterRecord` 存的是**合并后**的 moves 条目，不是原始 from/to。
- **锚点采集时机**：`from*` 三份锚点在**移动前**采集（重放时靠它们定位）；`to*` 两份在移动前采集目标容器和后邻；移动成功后立刻 `collectAnchors(el)` 刷新 `anchors`（`reapplyRemoval` 在 :448 就是这么做的）。选择器含 `:nth-of-type`，移动会改变两个容器下所有同类兄弟的下标，采集时机错了重锚定就会命中顶替上来的邻居。
- **`toAtEnd` / `fromAtEnd` 显式布尔**：`resolveElement` 找不到时返回 `{el:null}`，跟「本来就在末尾」无法区分。
- `track(el)` 首次采集时多记 `originParent / originNext(Element) / originAtEnd`。
- **`captureAll` / `restoreAll` 带上 `moves` Map 的深拷贝 + 每个被移动元素的当前 `parent / nextElementSibling`**；`restoreAll` 时按守卫放回。否则「重置全部」之后 ⌘Z 撤不回移动（AC-8.9 会假通过）。
- **`captureElement` / `case 'element'`（`undoElement` 那条路）同样带位置**，否则「还原元素」不会把它放回去。
- `read()` 多返回 `moves: moveList()`；`moveList` 的过滤规则参照 `removalList`（:258-263）：元素已不在 DOM 上但记录仍是用户意图的要留着。
- `stats()` 的 `total` 计入 `moves.length`，并暴露 `moves` 计数。
- **与 removals 的交互**：先移动再删除——`removeElements` 会把移动后的 parent 记进 removal，撤销顺序是先放回再移回，靠 history 顺序天然成立，但 `restoreAll` 里要先处理 moves 再处理 removals。删掉一个曾被移入元素的容器——那条 move 的 `toParent` 失联，`moveList` 照 `removalList` 的规则留着它。
- `moveElement` 进 `api.lib`，`applyOrder` 从 `api.lib` 移除。

### C. 重锚定（框架重渲染后）

`reconcile()` 里在 `reapplyRemoval` 之后、`rebindSnapshot` 之前加一轮 `reapplyMove(rec, taken)`。**三道现有守卫一条都不能少**，缺任何一条都会复现已修过的 bug：
- `sameIdentity`（:393）：拦"隔壁那个刚好挪到了这个位置"（`:nth-of-type` 级联误伤，注释 :437-439 有说明）
- `overBudget` / `REPLAY_BUDGET` / `fighting`（:382-389）：移动的重放同时产生 removedNodes + addedNodes，比删除更容易触发下一轮 `reconcile`，无预算会跟框架无限拉锯
- `claimedBy`（:319）：move 是第三个维度，不能和 snapshots / comments 抢同一个元素；`taken` 参数要传

**重放模型跟 `reapplyRemoval` 不同**：框架把 `fromParent.innerHTML` 重写后，被移动元素会在**原位置重新出现一份**，而先前移过去的那份**还留在 `toParent` 里**——页面上两份。重放必须是：找到新出现的那一份（`resolveElement(rec.fromAnchors...)`，`exclude` 掉旧引用）→ 把旧引用 `remove()` → 把新的移到 `toParent`（`toParent` 同样可能被换掉，用 `toParentAnchors` 找回）→ 更新 `rec.el` 并刷新 `anchors`。不是简单 `insertBefore`。

找不到目标容器 → 标 `orphaned`，记录留着、提示词照常导出，跟现有失联机制一致。

### D. 树的跨容器落点

`tree.element.js`：
- `#startDrag`：去掉 `canReorder` 限制，任何行都能拖（包括 body 的直接子元素——把整个 `<section>` 换位是最常见的场景）。**限制加在落点上**：`toParent !== document.documentElement`。
- `#onDragMove`：落点候选是**所有可见行**（不再过滤同父级），排除自己和自己的后代。对指针所在的行，按纵向位置分三段：
  - 上 1/3 → `before`：插到该行元素之前
  - 下 1/3 → `after`：插到该行元素之后
  - 中 1/3 且该行元素是容器（`hasChildren`，或 display 为 block/flex/grid 的元素）→ `inside`：成为它的最后一个子元素
- 指示器：`before` / `after` 用现有的 `.drop-line`；`inside` 给那一行加 `data-drop-inside` 高亮整行。
- `#endDrag` emit **`vr-tree-move { el, toParent, toNext }`**（`vr-tree-reorder` 事件删掉，`visual-revise.js:535` 那个 toast 监听一起改）。
- **行序 vs DOM 序**：`#rows` 由 `childrenOf = orderedChildren` 产出，是按 CSS `order` 排过的。带非零 `order` 的 flex 容器里，"插到我看到的这一行之前"算出的 DOM 位置和视觉位置不一致。处理：落点算 `toNext` 时用 `orderedChildren(toParent)` 里目标行的下一个元素，并在这类容器（任一子元素 computed `order !== 0`）上 toast 一句「此容器用了 CSS order，视觉顺序可能与 DOM 顺序不同」。
- `inside` 落到**折叠的**容器：先 `#expanded.add(id)` 展开它再插入，否则用户看不到自己刚放进去的东西。

### E. 页面拖拽的跨容器落点

`layout-drag.js`：
- **`markDroppables()` 的五处守卫**（`children.length < 2` :46、flex/grid :49、可见 :50、给每个子元素打 `data-vr-draggable` :53-55、`onPointerDown` 里的 flex/grid :194 和 `siblings.length < 2` :196）——全部拆掉。但**不要**把 `data-vr-droppable` 打到全页（放宽后等于给几乎每个元素加 `outline: 1px dashed`，几千个节点一起闪）。改成：拖拽开始时不预标记任何容器，`pointermove` 时只给**当前悬停的落点容器**打 `data-vr-drop-target`，移走即清。`HINT_CSS` 里 `[data-vr-droppable]` 和 `[data-vr-draggable]` 两条规则删掉，只留 `[data-vr-drop-target]` 的高亮。
- `dropIndexAt` 换成 `dropTargetAt(x, y)`：用 `pageElementAt` 找指针下的页面元素——**被拖元素本身仍在流中（只是 `opacity:.25`），会把自己命中，要跳过**（临时 `pointer-events: none` 或 `exclude`）；向上找到第一个「非插件 UI、非 `<html>`」的容器；在该容器的子元素里按指针位置（行容器看 x、列容器看 y、其余看 y）定 `before / after`，指针在容器空白处 → append。排除自己和自己的后代。
- 指示器：现有的横/竖线放到落点处。
- `endDrag({commit})` 调 `ChangeStore.moveElement`；`onDone({el, toParent, toNext})`。

### F. 面板接手树的事件

`props-panel.element.js`：
- `#applyReorder` 改成 `#applyMove({el, toParent, toNext})`。
- 共享元素联动：**只在同父级内移动时联动**（对每个同构容器按下标做同样的移动）；跨容器移动不联动，toast 一句「跨容器移动只作用于当前元素」。跨容器的同构映射（在另一个副本里找到对应的目标容器）不在本次范围。

### G. `applyOrder` 的去留

- 删掉 `applyOrder`。**必须和它的三个 importer（`layout-drag.js:8`、`props-panel.element.js:19`、`visual-revise.js:25`）以及 `api.lib`（`visual-revise.js:621`）在同一步内改完**，否则 rollup 报缺失导出、构建失败、后续步骤全部无法验证。
- `orderedChildren` 保留。`canReorder` 改名 `canDrag(el)`：`!!el?.parentElement && el.parentElement !== document.documentElement`。
- `prompt-export.js` 的 order 导出链（§2.1 列的 8 处）一并清掉。`:398` 的 `changes.filter(c => c.prop !== 'order')` 改成不过滤——面板里手动改的 `order` 要照常导出。

### H. 提示词导出 + JSON

`prompt-export.js`：
- 加 `moveSection(moves)`，跟 `removalSection` 平级、单独成段：
```
## 移动的元素
1. `<selector>`（<描述>）
   - 从：`<fromParent selector>` 里、`<fromNext selector>` 之前   ← fromAtEnd 时写「末尾」
   - 到：`<toParent selector>` 里、`<toNext selector>` 之前
```
- **两处空判断**（:390 `if (!edits.length && !comments.length && !removals.length) return ''`、:501 `return {ok:false, reason:'empty'}`）都要加 `moves.length`——只做了移动没做别的时，现在 `buildPrompt` 返回空串、复制按钮报 empty。
- 总结行加 `N 处移动`。

`json-io.js`：
- `SCHEMA_VERSION` 2 → 3，`SUPPORTED` 加 3。
- 导出带 `moves`（用锚点而不是元素引用）。
- **导入端**：`importJSON` 加第四个循环处理 `moves`（按锚点 `resolveElement` 找回三方，找到就 `moveElement`），`report` 加计数。只出不进 AC-8.7「导入后记录数一致」会挂。

### I. 改动记录面板

`change-list.element.js`：
- 加 `#renderMove(rec)`：显示「移动到 `<toParent 描述>` 里」，可点定位（`#elementOf` 加 `kind === 'move'` 分支）。
- 把 moves 塞进 `items` 数组。
- 「配置 N」计数（:114 `stats.props + stats.texts + stats.attrs + stats.removals`）加 `stats.moves`。
- 加一个类似 `.restore` 的「移回」按钮及 `on('.move-back', ...)` 处理器：调 `moveElement(el, fromParent, fromNext)`；`fromParent` 失联时 toast 失败。
- `.copy / .export` 的 `disabled = stats.total === 0` 依赖 B 里 `total` 已计入 moves。

## 4. 实施顺序

仓库没有 change-store 的单测入口（`npm test` 是 ava，只扫 `app/features/*.test.js`）。所有验证都走 Playwright，**每一步改完 `app/` 都要 `npm run extension:build`**。

1. **B** `moveElement` + `applyOp case 'move'` + `moves` Map + `captureAll/restoreAll/captureElement` 带位置 + `read/stats` + `api.lib`。在 `tests-e2e/history.mjs` 加用例验：移动、撤销、重做、移回原位删记录、拒绝移进自己、`toNext` 失联时 append 不抛、「重置全部」后 ⌘Z 能撤回移动。
2. **G + 三个 importer + `api.lib` + prompt-export 的 order 链**一步改完，构建必须通过。此时 drag / tree / acceptance-content / advanced 会挂，先别修。
3. **D** 树跨容器 + **F** 面板接手 + `visual-revise.js:535` 的 toast → 改 `tree.mjs` 5 条，加跨容器 before/after/inside 三条。
4. **A** slop + click 拦截 + `selectstart` + `setReorderMode` 新语义 + **E** 页面跨容器 → 改 `drag.mjs` ≈23 条、`advanced.mjs` 4 条、`comment.mjs` 2 条、`shots.mjs:56`，加 slop 与跨容器用例。
5. **C** 重锚定（三道守卫 + 两份模型）→ `reanchor.mjs` 加「innerHTML 重写后移动被重放、页面上只有一份」用例。
6. **H** 提示词 + JSON 出/入 → `acceptance-export.mjs` 加用例；`acceptance-content.mjs` 的 AC-7.4-pre/7.4a/7.4b/7.4c/7.5 重写。
7. **I** 改动记录面板 → `list.mjs` 加用例。
8. PRD §7：**AC-7.4 和 AC-7.5**（都写死了 `order`）重写；新增跨容器、slop、共享联动边界、重锚定的 AC。§8 的 AC-8.6（提示词段落清单）和 AC-8.9（重置）补「移动」。
9. 清死代码：`props-panel.element.js:2425-2429` 的 `setReorderMode`。
10. 全量 `node tests-e2e/all.mjs` 0 失败 0 异常；`acceptance-ui.mjs` 0 失败。
11. 工作日志追加一个 Session（文件在仓库根 `.work-log-可视化改稿扩展.md`，格式照前几个 Session）。

## 5. 验收标准（交付时逐条自证）

1. 属性 tab 下，页面上按住元素拖 ≥4px 能重排；按下不动松开仍是选中
2. 树里把一行拖进另一个容器：before / after / inside 三种落点都能落，DOM 真的动了
3. 页面上把元素拖进另一个容器（非 flex/grid 也行）
4. ⌘Z 一次撤回一整次移动；⌘⇧Z 重做
5. 移回原位后改动记录里那条消失
6. 不能把元素拖进自己或后代；不能拖到 `<html>` 下
7. 共享开关开着：同父级内移动联动到同构容器；跨容器只动当前元素并有 toast
8. 改动记录面板显示「移动」，可定位、可单独撤销
9. 导出提示词有「移动的元素」段，from/to 都能定位；JSON 导出带 moves
10. 模拟框架重渲染（`tests-e2e/reanchor.mjs` 的套路：把子树 `innerHTML` 重写）后，移动被重放
11. 全量回归 0 失败、0 套件异常；UI 套件 0 失败
12. 拖动过程中按 Esc 取消（现有 `cancelDrag` 保留）

## 6. 约束与已知的坑

- **改完 `app/` 必须 `npm run extension:build`**，测试加载的是 `extension/toolbar/bundle.min.js`。
- **程序化 `.click()` 在测试环境不派发事件**，一律用 Playwright 真实点击；展开折叠的分区也是。
- **拖拽用 pointer 事件，不用 HTML5 draggable**（行里有 `<button>` 时 `dragstart` 不发；自动化也驱动不了）。`setPointerCapture` 必须推迟到越过 slop 之后，否则 click 的 target 被重定向。
- 面板是滚动容器：测试里点某行前先 `scrollIntoViewIfNeeded()`。
- 已选中的元素再点会被 top-layer 的 `visbug-handles` 拦，要换元素或先 Esc。
- 新文件加版权头，格式照 `app/core/fills.js` 顶部。
- 注释解释「为什么」，不复述代码；不要留死代码、不要留未使用的导入。
- `deepElementFromPoint` 在视口外返回 null，用它的地方都要判空（上一批刚修过）。
- 不要动 `docs/PRD.md` §1–6、§8、§9 已有条目，只改 §7。

## 7. 不做

- 跨容器移动的共享元素同构映射
- 拖到 `<html>` / `<head>` 下
- 移动 `<script>` / `<style>` 等非布局节点
