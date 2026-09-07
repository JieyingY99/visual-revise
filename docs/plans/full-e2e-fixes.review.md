# `full-e2e-fixes.md` 只读评审（v1）

> 关联：被评审的方案 [full-e2e-fixes.md](full-e2e-fixes.md)；bug 证据与复现脚本见 [full-e2e-report.md](full-e2e-report.md) §3；
> 功能点编号见 [feature-inventory.md](feature-inventory.md)。
> 本次评审**未修改任何文件**。所有行号来自 2026-09-07 的工作区。

**总评：不能按现状执行。** 三处事实错误（§1.1 的「改动列表按 kind 通用渲染」、§1.1 的 `parentPath` 字段、
§1.10 的 `visual-revise.js:74`）、一处自相矛盾（§1.4「放在 altKey 放行之前」vs「跟 Delete 同一处」）、
`insert` 地基有五个必改落地面方案没提，以及 14 处会被打红/打断的既有断言未列入分工。
把【必须改】里的 1 2 3 4 9 12 13 15 16 17 23 24 修进方案，其余作实施注记，即可并行开工。

---

## 【必须改】

### 1. §1.1 「改动列表按 `kind` 通用渲染」——不存在这样的机制，`insert` 记录会一行都渲染不出来

- **方案**：§1.1 末段「改动列表按 `kind` 通用渲染，甲**不改**它」。
- **代码事实**：`app/components/change-list/change-list.element.js:108`
  `const { edits, comments, removals, moves } = ChangeStore.read()`；
  `:130-134` 是四条写死的映射（`edits.map(#renderEdit)` / `moves.map(#renderMove)` /
  `removals.map(#renderRemoval)` / `comments.map(#renderComment)`）；
  `:242-248` 的 `#elementOf` 同样是四路 `if`；
  `:114`「配置」计数写死为 `stats.props + stats.texts + stats.attrs + stats.removals + stats.moves`。
  **没有任何按 `kind` 分发的路径。**
- **后果**：§3 验收里「⌘G → 改动列表一条『分组』」「新增元素能点到、能单条撤销」在甲不动 change-list 的前提下**不可能达成**，
  方案的分工前提与自己的验收标准直接冲突。
- **建议**：把 change-list 的 `inserts` 渲染 + `#elementOf` 分支 + 计数一并划给乙，作为 B04/B05/B14/B17 的**同批依赖**；
  否则把 §3 验收改成「history 一次 ⌘Z 整体退回 + 提示词里有『新增元素』段」，并写明列表侧留待后补。

### 2. §1.1 `insert` 的落地面漏了五处，全在甲自己的文件里

| 位置 | 现状 | 不改的后果 |
|---|---|---|
| `change-store.js:1029` `read()` | 返回 `{edits, comments, removals, moves}` | 下游（change-list / prompt-export / json-io）一律看不到 inserts |
| `change-store.js:1013-1027` `stats()` | `total` 是显式求和 | 新增元素不计数，`stats().total` 与实际改动对不上 |
| `prompt-export.js:355-356` `buildPrompt` | 解构四项 + `if (!edits.length && !comments.length && !removals.length && !moves.length) return ''` | **只粘贴了一个元素时提示词直接返回空串** |
| `prompt-export.js:459-461` `copyPrompt` | 同样的四项空判 | 同上，「复制提示词」报 empty |
| `change-store.js` `undoEverything`（:965-1000） | 显式清 removals / moves / snapshots / comments 并把 seq 归零 | 「重置全部」之后粘贴/分组造出的元素还留在页面上，而记录已清空——B10 的同类症状 |

另：`tests-e2e/removal.mjs:141` 传的是手搓的 `{edits:[], comments:[], removals}`（**没有 `inserts` 键**），
所以 `buildPrompt` 的解构必须写成 `inserts = []`，否则该套件抛错、异常退出。

### 3. §1.1 `insert` 记录用 `parentPath` / `index` 与仓库的锚点体系不兼容

- **方案**：json-io「加 `inserts` 数组（`parentPath`、`index`、`html`），导入时按 `resolveElement` 找父节点再插回」。
- **代码事实**：`resolveElement(record)` 吃的是 `{anchors}` / `{selector, anchors}`（用法见 `json-io.js:118,150,155,160`），
  仓库里**没有 `parentPath` 这个概念**。`moves` 存的是 `toParentAnchors` / `toNextAnchors` / `toAtEnd`
  （`json-io.js:44-53`、`change-store.js:377-383`），`prompt-export.js:300-306` 的 `placeLine` 就是照这三样写的；
  `change-store.js:379-380` 的注释明写「目标那两份锚点必须在移动之前采，选择器里带 `:nth-of-type`，
  一次移动会改变两个容器下所有同类兄弟的下标」——「位置序号」正是这条注释否掉的做法。
- **建议**：`insert` 照 `move` 存 `{parentAnchors, nextAnchors, atEnd, html}`，
  导出复用 `placeLine`，导入复用 `json-io.js:157-162` 的 `atEnd` 分支。

### 4. §1.1 导入顺序：`inserts` 必须排在 `moves` 之前

- **代码事实**：`json-io.js:141` 已有先例注释「移动排在删除之前：先把元素搬到位，再删该删的」。
- **问题**：分组产生的是「先 insert wrapper，再把子元素 move 进 wrapper」。导入时若 moves 先跑，
  wrapper 还不存在，`resolveElement({anchors: record.to.anchors})` 必然落空（`json-io.js:152`），
  整组分组静默丢失、只记进 `report.missing`。
- **建议**：固定为 `edits → inserts → moves → removals → comments`，并把理由写进注释。

### 5. §1.1 undo 掉 `insert` 之后，被插入子树上的快照会变成「元素已消失」的幽灵记录

- **代码事实**：`reconcile()` 的快照循环里对删除有显式豁免——
  `if (removals.has(snap.id)) continue`（`change-store.js:689` 一带，注释「这个元素是被我们删掉的，
  它的快照不该再去页面上找替代品」）。**`insert` 没有对应豁免。**
  undo 把 wrapper `el.remove()` 之后 MutationObserver（`:727-753`）会排一轮 reconcile，
  `rebindSnapshot`（`:549-575`）对断连快照走 `freezeEdits` + `orphaned = true`，
  改动列表里就多出一条「元素已消失」。用户在 wrapper 上调过样式（分组之后调样式正是这个功能的用途）必然命中。
- **建议**：`inserts` Map 也在快照循环里豁免（`if (inserts.has(snap.id)) continue`）。
- **回答方案里那个担心**：「undo 时 `el.remove()` 会不会让后续 prop 记录在 redo 时失联」——**不会**。
  `applyOp` 用的是 `op.el` **节点引用**（`change-store.js:139-200`），undo 只是把节点摘出 DOM、
  记录仍持有它，redo `putBack` 放回的是同一个节点，后面那些 prop op 照样写得进去。
  真正的问题是上面这条幽灵记录，以及第 7 条的记录语义。

### 6. §1.1 `captureAll` / `restoreAll` 需要一份跟 `detached` 对称的名单

- **代码事实**：`captureAll()`（`change-store.js:65-88`）用 `detached` 记「哪些删除记录此刻不在 DOM 上」，
  `restoreAll`（`:90-127`）据此「该在的放回去、该不在的移走」。
- **建议**：inserts 加一份 `attached` 名单走同一套逻辑；注意 `captureAll().styles` 只收 `isConnected` 的快照（`:69`），
  被 undo 摘掉的插入节点不在其中。

### 7. §1.2 取消分组会给「这次才造出来的 wrapper」记一条 `dom` 删除记录

- **代码事实**：`removeElements`（`change-store.js:264-303`）无条件 `history.push({kind:'dom'…})` 并写进 `removals`，
  于是 `removalList()` → 改动列表「已删除」徽章（`change-list.element.js:197`）+
  提示词「## 删除的元素 … 请在源码里删掉这些元素本身」（`prompt-export.js:283-289`）。
  **而这个 `<div>` 在原页面里从来不存在**，等于给 AI 下了一条无法执行的指令。
- **建议**：`removeElements` 之前先查该元素是否在 `inserts` 里——是就把那条 insert 记录**对消**，而不是记一条删除。
- **附**（回答方案里的另一个担心）：子元素已经先搬空，`childCount: el.children.length`（`:290`）会是 0，
  **不会**把搬出去的子元素算进删除记录；撤销顺序也对——`history.js:85-87` 的 undo 反向重放，
  先 `putBack` wrapper 再把子元素 move 回去。这一点没问题。

### 8. §1.2 `moveElement` 移进刚 insert 的 wrapper——能，但三处细节方案没写

- **守卫层面能过**：`canMoveInto`（`change-store.js:60-63`）只要求
  `parent.nodeType===1 && parent.isConnected && el!==parent && !el.contains(parent) && parent!==document.documentElement`。
  wrapper 先 `insertElement` 进 DOM 就满足；**不要求 `toParent` 被 `track` 过**。方案可行 ✓
- **(a) 「文档顺序最靠前」拿不到**：`selected` 是 `unshift` 出来的**选中顺序倒序**（`selectable.js:488`），
  而且现有 `on_group` 里 `selected.reverse()` 会**原地改数组**（`:333`）。必须显式 `compareDocumentPosition` 排序，
  不能拿 `selected[0]`。
- **(b) 取消分组的落点锚点会指向一个马上要被删的节点**：`moveElement(child, wrapper.parentElement, wrapper)`
  记下的 `toNextAnchors = collectAnchors(wrapper)`（`:381`），随后 wrapper 就被 `removeElements` 删了。
  导出的提示词会写「移到 `div:nth-of-type(k)` 之前」，而那个 div 在结果页面里不存在。
  建议改用 wrapper 的 `nextElementSibling` 当落点，或把「取消分组」整体表达成 insert 的对消（见第 7 条）。
- **(c) 跨父节点分组**：多个选中元素父节点不同时，锚定到「最靠前那个」会把其余元素**跨容器**搬走。
  上游行为如此，但接进记录后会真的写进提示词，值得在最终报告里点名。

### 9. §1.2 「selectable.js 拿不到 ChangeStore，要注入，不要 import 造成循环依赖」——理由不成立，且注入点不在任何人的文件清单里

- **代码事实**：`change-store.js:5-14` 只 import `snapshot / cascade / anchors / history`，**没有一条指回 `app/features/*`**。
  `selectable.js` 直接 `import { ChangeStore } from '../core/change-store.js'` **不会成环**——
  `visual-revise.js:6` 就是这么 import 的。
- **反面**：真要注入，`Selectable(visbug)` 的构造点在 `app/visbug.element.js`
  （**不在甲也不在乙的可改清单里**），而 `Selectable` 返回的对象（`selectable.js:806-815`：
  `select / selection / unselect_all / onSelectedUpdate / removeSelectedCallback / disconnect / pause / resume`）
  也没有任何注入口。方案说的「已有先例看 `text.js` 的宿主接管方式」不成立：`text.js` 全文 37 行，
  只 export 了 `EditText(elements)`，没有任何宿主注入。
- **建议**：直接 import，删掉这条约束；§1.3 / §1.4 统一走同一条路。

### 10. §1.3 `⌘V` 的目标对，但有三个坑

- **上游行为**：`on_paste`（`selectable.js:223-234`）是
  `selected.forEach(el => el.appendChild(htmlStringToDom(potentialHTML)))`——
  **append 进选中元素内部**，且每个选中元素各粘一份。方案「插进 target」「多个选中目标时逐个粘一份」与上游一致 ✓
- **坑 1**：`htmlStringToDom`（`app/utilities/common.js:89-91`）返回的是 `body.firstChild`，
  **可能是文本节点**（剪贴板 HTML 前面有换行/空白时）。`insertElement` 若按 `nodeType===1` 守卫会静默不插。
  用 `body.firstElementChild`，或在插入前过滤。
- **坑 2（测试怎么绕）**：`on_paste` 第一行之后无条件 `await navigator.clipboard.readText()`（`:225`），
  **没有 try/catch**——无权限时 promise reject，整个 handler 中断，连 `e.clipboardData` 那条路都走不到。
  报告 §6 `select-handles-text` 第 3 条已经写明解法：
  `page.context().grantPermissions(['clipboard-read','clipboard-write'], { origin })`。
  代码侧也必须包 try/catch，才谈得上方案说的「拿不到时 toast 说明，不静默」。
- **坑 3（行为扩大）**：`on_cut`（`:213-221`）现在只删 `selected[0]`；方案的 `removeElements(selected)`
  变成「删全部选中」。`full/select-handles-text.mjs:384` 断言 `cutStats.removals === 1`，单选场景仍绿，
  但这是有意扩大行为，要在最终报告里写明。

### 11. §1.3 只治了 B05 的一半：`on_duplicate` 有一模一样的 bug

- **代码事实**：`on_duplicate`（`selectable.js:176-183`）`deep_clone.removeAttribute('data-selected')`，
  **没摘 `data-label-id`**。⌘D 复制出来的副本同样会跟后来的选中撞号，
  `handle.element.js:42` 的 `$('[data-label-id="${id}"]')[0]` 同样取到文档顺序靠前的那个副本。
- 报告 B05 给的「治本」建议（`select()` 别用 `handles.length` 现发号 + 把手直接持源元素引用）方案里一个字没提。
- **建议**：至少把 `stripEditorMarks(clone)` 也用到 `on_duplicate` 上（同一文件、零额外成本）；
  治本那条写进最终报告的遗留项。

### 12. §1.4 「放在 altKey 放行之前，跟 Delete 的接管同一处」自相矛盾，而且会吃掉输入框里的 ⌥Backspace

- **代码事实**：`visual-revise.js:222` `if (e.metaKey || e.ctrlKey || e.altKey) return`；
  Delete 的接管在 **`:260`**，在 222 **之后**。「altKey 放行之前」与「跟 Delete 同一处」指的不是同一行。
- **更要紧的**：`:242` `if (isTypingTarget(e) && e.key !== 'Escape') return`、
  `:229` `if (isEditorUI(e) && e.key === 'Tab') return` 也都在 222 之后。
  把 ⌥Delete 分支放到 222 之前，就绕过了这两道守卫——面板输入框与页面输入框里的
  **⌥Backspace（删一个词）会被吃掉**，还会顺手去清页面选中元素的样式。
- **建议**：新分支放在 `:222` 之前，但自带守卫：
  `if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace')
   && !interactive && !isTypingTarget(e) && !isEditorUI(e))`。
- **解绑 `on_clearstyles` 的做法**：`HOTKEYS(metaKey)`（`selectable.js:32-43`）是 bind/unbind **共用**的清单，
  注释明写「两处手写会漂移，解绑遗漏的快捷键会在每次 resume 后累积一份处理器」。
  所以要**同时**删 `:76` 的 `hotkeys('alt+del,alt+backspace', on_clearstyles)`、
  HOTKEYS 里 `:37` 那一行 `'alt+del,alt+backspace'`，以及 `on_clearstyles` 本体（`:189-191`）。
  **只 `unbind` 一条不行**——`listen()` 在编辑态往返时会重新绑回来。两处都在甲的文件里，可行 ✓

### 13. §1.5 null 槽位会把 `unselect` 自己和另外三处 forEach 打挂，而且 `labels`/`handles` 不是平行数组

- **代码事实 A**：`unselect`（`selectable.js:119-123`）
  `[...labels, ...handles].filter(node => node.getAttribute('data-label-id') === id)`——
  展开**显式 `null`** 之后这句直接 `TypeError`。
- **代码事实 B**：同样不设防的还有 `:456`、`:625`、`:665` 的
  `handles.forEach(handle => handle.hidePopover && handle.hidePopover())`——
  `forEach` **会**访问显式 `null`（不像真稀疏洞会被跳过）。
- **代码事实 C**：`labels` 与 `handles` **不平行**。`createLabel` 只在 `no_label === false` 时才被调
  （`select()` `:465-478`，而默认工具是 `guides`、正落在 `no_label` 名单里，见报告 §6 `select-handles-text` 第一条），
  两个数组各自 `labels[labels.length] = label`（`:663`）/ `handles[handles.length] = handle`（`:682`）独立增长。
  `labels[i] = handles[i] = null` 里的 `i` 对 `labels` 往往越界，会把 `labels` 撑成稀疏数组。
- **旧套件**：`tests-e2e/acceptance.mjs:230-231`（AC-3.2b「再 Shift+单击已选中的元素则取消它」）
  是唯一走这条路的断言，改坏必红，并连累其后的 AC-3.3 / AC-3.4。
- **建议**：要么全部改 null 安全（`node?.getAttribute`、`handle?.hidePopover?.()` 四处一起改），
  要么更干脆——`unselect` 里按**元素引用**把被摘的那个从两个数组里剔掉，
  同时给 `select()` 换一个独立的单调计数器发号（别再用 `handles.length`），顺带把第 11 条的撞号一起治本。

### 14. §1.6 可行，但早退条件不能把 `visbug-handles` 一起吃掉

- **代码事实**：`on_click`（`selectable.js:99-104`）现在先 `deepElementFromPoint(e.clientX, e.clientY)`，
  再 `if (isOffBounds($target) && !selected.filter(el => el == $target).length) return`。
- `isOffBounds`（`app/utilities/common.js:111-122`）会沿 `getRootNode()` 一路爬 shadow host，
  闭合 shadow 的 `composedPath()[0]` 直接就是宿主元素 → 判定成立 ✓
- **已逐条核对，旧套件不受影响**：`panel.mjs:341`（面板 × → 取消选中）走 `visual-revise.js:550-555` 的 `vr-close`；
  `toolbar.mjs:62` 走模式切换里的 `unselect_all`（`:272/:384`）；`list.mjs:68`、`tree.mjs:128` 走各自的行处理器——
  都不经 `on_click`。「选中被保留」那一侧 `panel.mjs:393,397,401` 也保持绿。
- **唯一要留神**：`panel.mjs:418-420`「同一下点击仍正常选中页面元素」——
  早退条件必须只认编辑器 UI，别把「`composedPath()[0]` 是浮在选中元素上的 `visbug-handles`」这种情况一起吃掉。

### 15. §1.7 改写 `translate` 之后，第二次拖会把上一次的位移清零

- **代码事实**：`handle.element.js:50` `const initialTransform = new DOMMatrix(initialStyle.transform)`，
  五个分支（`top-start` :75 / `top-center` :86 / `top-end` :97 / `middle-start` :108 / `bottom-start` :127，
  **正好五个**，方案数对了 ✓）用 `initialTransform.translate(dx,dy).transformPoint()` 在此基础上累加。
- **问题**：`getComputedStyle().transform` **只解析 `transform` 属性，不含独立的 `translate`/`rotate`/`scale`**。
  改写成 `translate:` 之后，下一次 pointerdown 读到的 `transform` 是 `none`，累加基数归零——
  松手再拖第二次，元素会先跳回原点再重新位移。
- **建议**：基数改读 `initialStyle.translate`（值形如 `'none'` / `'40px'` / `'40px 30px'`），自己解析 x/y 再累加。
- **「跟页面原有 transform 叠加会不会双重位移」**：**会，而且是一次有意的行为变更**。
  今天写 `transform` 是**整条覆盖**掉页面原有的 `transform`（页面的 rotate/scale 一起没了）；
  改成 `translate` 之后变成**叠加**。对大多数页面这是更对的结果，但对「页面本身就有 `transform: translate(...)`」的元素，
  视觉结果与今天不同，要在最终报告里写明。
- **「上游 Move 工具会不会互相覆盖」**：**不会**。Move 工具（方向键）写的是 `left/top`，
  不是 transform——报告 B22 实测 `ArrowRight → #s0 的 inline left 变成 1px`。方案「不动它」成立 ✓
- **`readComputed` 对 `translate`**：`snapshot.js:67-80` 逐条 `getPropertyValue(prop).trim()`，
  拿到 `'none'` 或 `'40px 30px'`；`normalizeValue`（`tracked-props.js:115-124`）不破坏它；
  `changeTable`（`prompt-export.js:109-118`）直接照抄字符串 ✓ 提示词里会出现
  `| translate | none | 40px 30px |`，归在「定位」分区下。
- **方案里「`prompt-export` 的分区文案表加对应中文」指向错了**：分区中文名在 `tracked-props.js` 的
  `GROUPS[].zh`（`prompt-export.js:50-59` 的 `groupLabels` 读它），`position` 组已经是「定位」，
  **prompt-export 里没有任何需要改的表**。而 §3 验收说的「提示词里有『位移』」——
  属性名那一列出的是 `translate` 原文，要出现「位移」两个字得另做一层属性级中文表，方案里没有这层。

### 16. §1.8 Escape 退编辑态：四个具体事实

- **(a) `isTypingTarget` 不会提前放行**：`visual-revise.js:242` 写的是
  `if (isTypingTarget(e) && e.key !== 'Escape') return`——Escape 是**显式豁免**的，
  能顺利走到 `:328` 的 Escape 分支。方案这一点没问题 ✓
- **(b) 清理函数叫 `cleanup`，但没 export**：`text.js:15-18` 的 `cleanup` 与 `:5-11` 的 `removeEditability`
  **都不是导出符号**（`:20` 只 export 了 `EditText`）。要从 visual-revise.js 调必须先加 export。
- **(c) 直接复用 `cleanup` 会有副作用**：`removeEditability` 里有一句
  **`hotkeys.unbind('escape,esc')`（`text.js:10`）**，它会把全局所有 `escape,esc` 绑定一起解掉——
  包括 `selectable.js:74` 的 `hotkeys('esc', on_esc)` 和快捷键帮助浮层自己的 esc
  （报告 §6 `drag-guides-upstream` 末尾已经点名这个交叉影响）。
  建议在 visual-revise.js 里自己做那三件事（`blur()` + 摘 `contenteditable`/`spellcheck` +
  `getSelection().empty()`），或把 `hotkeys.unbind` 从 `removeEditability` 里拆出去。
- **(d) 判据必须是「事件 target 自身 `isContentEditable`」，不能是 `isTypingTarget`**：
  - `tests-e2e/text.mjs:172-173` 测的就是「编辑过文案之后按**一次** Esc 仍能取消选中」，
    且 `:151-154` 的注释把「改完一句话之后 Esc 不再取消选中」明写成 bug。流程是
    `toolSelected('text')` → 打字 → **点另一张卡离开编辑态** → 一次 Esc。
    若离开编辑态时 `blur` 已触发 `removeEditability` 摘掉 `contenteditable`，这条仍绿；
    判据一旦放宽到「页面上还存在 contenteditable」就会红。
  - `tests-e2e/toolbar.mjs:293-295`（焦点在面板 `<input>` 时 Esc 仍要取消选中）与 `:306-308`
    （Esc 先关弹层、选中还在）——**判据若用 `isTypingTarget` 两条一起红**。

### 17. §1.10 B22：代码位置写错，而且 `mode` 与「上游工具」是两个维度

- **代码事实**：`visual-revise.js:74` 是 `const layoutDrag = createLayoutDrag({`，**那里没有 `setActive`**。
  真正的调用点有四处：`:84` `setActive(true)`（初始化）、`:298`（a/f 键分支）、
  `:380`（`setMode`）、`:400`（`setReorderMode`）。报告 B22 自己写的也是「判据（:298、:380、:400）」。
- **更根本**：`mode` 只有 `select | browse | comment`（`:87`），跟 `visbug.activeTool`
  （`position` / `move` / …）是两个维度，`setActive(mode === 'select')` 里塞不进工具判断而不引入新状态位。
- **`toolSelected()` 不在任何人的文件清单里**：它定义在 `<vis-bug>` 元素上（`app/visbug.element.js`），
  甲乙都没有权限动。「切工具时重算一次」要么 monkey-patch，要么就做不了。
- **建议采纳报告给的第二条修法**（更小、完全落在甲的文件里）：
  在 `layout-drag.js` 的 `onPointerDown`（`:235-248`）开头加一句
  `if (MOUSE_TOOLS.has(visbug?.activeTool)) return`，把工具判断放在「按下那一刻」而不是靠状态位同步。
  这样四个 `setActive` 调用点一个都不用动。

### 18. §1.11 B01：位置准确，补两条确认

- `onPointerDown` 的三条注册在 `layout-drag.js:245-247`，`disarm()` 在 `:228-232` 对称移除 ✓ 方案行号准确。
- `endDrag`（`:285-301`）在 `!drag` 时先 `disarm()` 再 return，
  所以「还没越过 slop 就 pointercancel」这条路也安全 ✓
- `armClickSwallow` 挂的 `click`/`pointerdown`（`:218-225`）由 `endDrag → disarmClickSwallow` 收，
  pointercancel 走 `endDrag({commit:false})` 会一并收掉 ✓

### 19. §1.12 B10：可行，写法照 `captureElement`

- `captureAll().styles`（`change-store.js:68-71`）现在是 `{el, cssText, attrs}`；
  `captureElement`（`:128-134`）已经有 `textNodes: textNodesOf(el).map(n => n.nodeValue)`，
  `applyOp case 'element'`（`:181-186`）有「节点数相同才逐个写回」的现成写法，照抄即可 ✓
- **注意**：`captureAll().styles` 只收 `isConnected` 的快照（`:69`），失联的走 `frozen`（`:83-85`）——
  文案改动在失联那条路上仍然救不回来，属于同一 bug 的次要分支，可写进报告不做。

### 20. §1.13 B08/B09

- **B08 准确 ✓**：`comment-layer.element.js:589-590` 已经 `if (errors?.length) this.#toast(errors[0])`，
  `#toast`（`:643-645`）派发 `vr-toast`；缺的只是 `visual-revise.js` 的监听
  （现在只有 `list` 那一条，`:558`）。
- **B09 有个做不到的地方**：`MAX_TOTAL`（`image-assets.js:12`）与 `totalBytes`（`:147`）都已导出，
  `readImageList`（`:106-117`）一次都没用 ✓ 诊断对。但**「基数含已入库资产」在 image-assets.js 里做不到**——
  那是个纯函数模块，拿不到 `ChangeStore.allAssets()`。
  **建议**：给 `readImageList(files, { base = 0 })` 加个参数，由调用方
  （`comment-layer.element.js:482/510`、fill 那一侧）传 `totalBytes(ChangeStore.allAssets())`，
  别让工具模块反向依赖 store。方案没说选哪条，会让实施者临场决定。

### 21. §2.7 B21：两个动作有先后顺序问题，且「关灯那一次除外」没有机制

- **代码事实**：`#toggleLayer` 是**先**设 `#layerRestore`（`props-panel.element.js:1248`）
  **再** `#writeFillLayers(all)`（`:1256`）。方案要的「写入后的 inline 快照」只能在 `:1256` **之后**补采，
  方案没写这一步。
- 「`#writeBackground` / `#writeFillLayers` 里（关灯那一次写入除外）清掉 `#layerRestore`」——
  `:1256` 关灯那次自己就调 `#writeFillLayers`，需要一个显式的「本次是关灯」标记（参数或临时字段），方案没给机制。
- 另外 `:1243` 那条 `return this.#writeFillLayers(all)`（`saved.index !== i` 的分支）也该清 `#layerRestore`。
- 现有守卫确认：`:1223` `if (saved && saved.index === i)` **只比下标**，从不检查「关掉之后有没有动过别的」——
  与报告 C 段的结论一致（那条 else 在下标不同时照常走），方案措辞跟着走对了 ✓

### 22. §2.8 B06：两段夹取死区解不出来，URI 里塞参数有 XML 陷阱

- **`serializeEffects`（`effects.js:82-95`）的可逆性逐项核对**：

| 字段 | 正向 | 反解 | 结论 |
|---|---|---|---|
| noise `density` | `opacity = (density/100).toFixed(2)` | `density = opacity*100` | **可逆**（整数 0-100 ↔ 2 位小数）✓ |
| noise `size` | `freq = (1.2/max(0.1,size)).toFixed(2)` | `size = 1.2/freq` | **有精度损失**：size=0.7 → freq 1.71 → size 0.7017… |
| noise `color` | `feFlood flood-color='…'` | 正则取回 | 可逆，但 `#` 已被 `%23` 转义（`:55`），要先反转义 |
| texture `size` | `freq = (1/max(1,size)).toFixed(2)` | `size = 1/freq` | **`size ≤ 1` 全被夹成 freq=1.00 → 不可逆** |
| texture `radius` | `opacity = min(1, radius/10).toFixed(2)` | `radius = opacity*10` | **`radius ≥ 10` 全被夹成 1.00 → 不可逆** |
| glass `highlight` | `inset 0 1px 0 rgba(255,255,255,(h/100).toFixed(2))`（`:99`） | 从那条高光的 alpha 取回 | 可逆 ✓（注意 `0.4*100 = 40.000000000000006`，要 `Math.round`） |

- **回答「density 和 radius 是不是同一个数推出来的」**：**不是**。
  noise 的 `density` 与 texture 的 `radius` 各自走 `rect opacity` 那一路，
  noise 的 `size` 与 texture 的 `size` 各自走 `baseFrequency` 那一路——四个都独立可推，
  但有上表两段夹取死区。
- **所以方案的「serialize → parse 往返每个字段相等」单测在这些区间必然红。**
  要么把参数原样写进 URI（推荐），要么把断言限定在可逆区间并把死区写进报告。
- **glass 那条可行 ✓**：`parseShadow` 的 `isHighlight`（`:124`）已经能认出那条高光、`:140` 直接 `continue`；
  反解只要在 continue 之前把它的 alpha 收起来，`:154` 用它替掉硬写的 `highlight: 40` 即可。
- **`isEffectLayer` 兼容 ✓**：`effects.js:58` 是 `/vr-noise|vr-texture/.test(String(v||''))`，
  **纯子串匹配**，记号后面挂参数不影响它。
- **但有个 XML 陷阱**：记号现在是 SVG 根元素的 `id='vr-noise'`（`:52`）。往里塞 `key=value` 时
  **绝不能用 `&` 分隔**——`&` 在 XML 属性值里是实体起始符，会让整段 SVG 解析失败、噪点层直接不显示。
  用 `;` 或 `,`；同时要考虑 `getComputedStyle` 回读时浏览器可能对 data URI 再做一次百分号编码，
  反解的正则要容忍 `%3B` 之类。

### 23. §2.11 B27 会打挂 `tree.mjs` 里三条现在是绿的断言，其中一条会让整个套件中断

- `tests-e2e/full/tree.mjs:670` 探针读 `.tree-head .tree-close` 的 title；
  `:676` `head.closeTitle === '关闭'`（与 title/hint 合成一条断言）；
  **`:691` `await page.locator('#solo-tree .tree-close').click()`——按钮没了会超时抛错，
  `:706` 的 `await browser.close(); await close()` 跑不到，套件异常退出**；
  `:701` `closed.fired === 1`（断言「× 确实派发了 vr-tree-close」）。
- 方案只写「那条断言改成『头部没有关闭按钮』」，把上面四处算成了一条。
  最终报告里要写清改动范围：`:670/:676` 改成断言不存在，`:684-701` 整段删掉或改写。
- 旧套件 `tests-e2e/*.mjs` 里**没有任何** `tree-close` / `vr-tree-close` 引用 ✓ 不受影响。

### 24. schema 5：旧套件三条硬红，`SUPPORTED` 必须保留 1-4，而且这三个文件谁都没被授权改

- `tests-e2e/advanced.mjs:121` `ok(exported.schema === 4, …)`
- `tests-e2e/acceptance-export.mjs:152` `AC('AC-8.7', data.schema === 4 && …)`
- `tests-e2e/acceptance-variables.mjs:483` `AC('AC-6.34e', roundTrip.schema === 4 && …)`
- 方案只说了「`tests-e2e/full/history-changes.mjs` / `export-comments-misc.mjs` 与旧套件里的 `schema === 4` 断言改 5」，
  但没点名这三个文件，而 §0 的测试归属表里**只列了 `tests-e2e/full/*`**——这三个文件在两人的清单里都没有。
- `advanced.mjs:172` 手搓了一份 `schema: 1` 的 payload，`:197-203` 四条断言依赖它能被导入
  （`:170` 注释明写 v1 必须还能导入）→ **`SUPPORTED` 必须是 `new Set([1,2,3,4,5])`**，不能只留新版本。

---

## 【所有权越界】

| bug | 需要动的对方 / 无主文件 | 现归属 | 建议 |
|---|---|---|---|
| B04 B05 B14 B17（`insert` 记录要在改动列表里看得见 / 点得到 / 能单条撤销） | `app/components/change-list/change-list.element.js:108, 114, 130-134, 242-248` | **乙** | 划给乙，与甲同批交付；否则删掉 §3 验收里「改动列表一条『分组』」那条 |
| B19（`translate` 要在面板里出现「位移」标签） | `app/core/controls.js`（`CONTROLS` 声明，`:55-138`）；连带 `HIDDEN_FIELDS`（`:140-146`） | **乙** | **可以不越界**：`#renderField` / `#renderControl`（`props-panel.element.js:2024,1974`）在 `CONTROLS[prop]` 缺失时都 `return ''`，行会被 `:658` 的 `filter(Boolean)` 丢掉——所以只加 `GROUPS.position.props` 不会让面板多出控件、也不会动版面。**代价是面板里没有「位移」这个字段，§1.7 的「标签「位移」」是个空承诺，§3 验收「提示词里有『位移』」也不成立**。要么接受（推荐，并改掉这两句话），要么把 `CONTROLS['translate']` 划给乙——但那样 Position 分区会真多一行，`acceptance-ui.mjs` 的版面审计要重跑 |
| B22（`toolSelected()` 切工具时重算） | `app/visbug.element.js`（`toolSelected` / `activeTool` 定义处） | **两人都没有** | 改用「在 `layout-drag.js` 的 `onPointerDown` 里查 `visbug.activeTool`」，完全落在甲的文件里，避免跨界 |
| B04/B14（`Selectable(visbug)` 的 ChangeStore 注入点） | `app/visbug.element.js` | **两人都没有** | 直接 `import { ChangeStore }`——无循环依赖（见【必须改】9），不需要注入 |
| schema 5（旧套件断言） | `tests-e2e/advanced.mjs:121,172,197-203`、`acceptance-export.mjs:152`、`acceptance-variables.mjs:483` | **两人都没有** | 归甲（改的是甲的 `json-io.js`），并在 §0 测试表里补上 |
| §1.8 Escape（旧套件断言） | `tests-e2e/text.mjs:172-173`、`toolbar.mjs:293-295,306-308` | **两人都没有** | 归甲；`text.mjs` 那条与新行为**意图相反**，需要一次明确决定，不是简单加一次 `press('Escape')` |
| §1.5 unselect（旧套件断言） | `tests-e2e/acceptance.mjs:230-231` | **两人都没有** | 归甲 |
| §1.7 translate（旧套件断言） | `tests-e2e/drag.mjs:129`、`acceptance-content.mjs:138`、`acceptance-ui.mjs:153,322-342` | **两人都没有** | 归甲 |
| B12 的断言在 `panel-head-position.mjs:798` | `tests-e2e/full/panel-head-position.mjs` | 乙 | 方案 §0 已声明「甲只改 selectable.js、那条断言自然转绿」——**成立** ✓ 无需调整 |

> 27 条 bug 的「分块 → 实际断言文件」经全目录反查 **100% 一致**，没有一条跨 full 套件文件。
> 唯一的例外性质是 **B19**：它的两条断言（`full/select-handles-text.mjs:587,590`）是**反向锁住现状**的，
> 现在**通过**而不是失败——27 条里唯一没有失败断言的一条，只靠 `verify/select-handles-text-4_2_2.mjs` 证伪。

---

## 【会挂的旧测试】

### 一定红（或直接中断）

| 文件:行 | 断言 | 原因 |
|---|---|---|
| `tests-e2e/advanced.mjs:121` | `exported.schema === 4` | §1.1 bump 到 5 |
| `tests-e2e/acceptance-export.mjs:152` | `AC-8.7 … data.schema === 4 && …` | 同上 |
| `tests-e2e/acceptance-variables.mjs:483` | `AC-6.34e … roundTrip.schema === 4 && …` | 同上 |
| `tests-e2e/full/select-handles-text.mjs:576-577`（循环 8 次，`:554-561` 的期望表 + `:49`/`:516` 探针） | 八个把手各断言 `e.style.transform === translate(x,y)` | §1.7 改写 `translate:` 后全红。**方案只点名了 `:587`/`:590` 两条** |
| `tests-e2e/full/select-handles-text.mjs:587-588`、`:590-591` | 「transform 不在 TRACKED_PROPS」「提示词里没有 transform」 | 方案已列 ✓ |
| `tests-e2e/full/tree.mjs:670,676` | 树头 × 的 title | §2.11 删按钮 |
| **`tests-e2e/full/tree.mjs:691`** | `page.locator('#solo-tree .tree-close').click()` | **元素不存在 → 超时抛错 → 套件异常退出，`:706` 的 close 跑不到** |
| `tests-e2e/full/tree.mjs:701` | `closed.fired === 1` | §2.11 删事件 |
| `tests-e2e/acceptance.mjs:230-231`（AC-3.2b），连累 `:236` 之后的 AC-3.3/3.4 | Shift+单击取消其中一个 | §1.5 的 null 槽位让 `selectable.js:120` 的 `[...labels,...handles].filter(node => node.getAttribute(…))` 抛 TypeError |

### 条件红（必须实测确认）

| 文件:行 | 断言 | 触发条件 |
|---|---|---|
| `tests-e2e/removal.mjs:141` | `buildPrompt({edits:[],comments:[],removals})` | 手搓 state 没有 `inserts` 键；`buildPrompt` 解构不给 `= []` 默认值就抛错、套件异常退出 |
| `tests-e2e/text.mjs:172-173` | 「编辑过文案之后 Esc **仍能**取消选中」 | §1.8 判据若不严格限定为「事件 target 自身 `isContentEditable`」就红；**这条的意图与新行为相反** |
| `tests-e2e/toolbar.mjs:293-295`、`:306-308` | 焦点在面板 input 时 Esc 仍取消选中 / Esc 先关弹层 | §1.8 判据若用 `isTypingTarget` 则两条一起红 |
| `tests-e2e/drag.mjs:129`、`tests-e2e/acceptance-content.mjs:138`（AC-7.4d） | `moves === 1 && props === 0` | 起拖点就在 `visbug-handles` 上（`drag.mjs:78` 注释写明）。今天 `props === 0` **靠的正是「transform 不被跟踪」**；`translate` 进 TRACKED_PROPS 后，只要把手通路在同一手势里写过一次 translate 就红。**上线前必须实跑这两条** |
| `tests-e2e/drag.mjs:56,187,214`、`acceptance-content.mjs` 同形 | `total === 0` | 同上 |
| `tests-e2e/acceptance-ui.mjs:153,322-324,326,342` | 面板版面审计（同行等高 / 长宽比 / 居中） | 仅当乙加了 `CONTROLS['translate']` 导致 Position 多一行时 |
| `tests-e2e/list.mjs:33,36,196-197` | 列表条目数 / 「全部 N」「配置 N」计数 | 仅当 change-list 真的渲染 inserts、且 `stats().total` 计入 inserts 时。**两者必须同时改或同时不改**，否则「全部」与「配置」两个计数会对不上 |
| `tests-e2e/figma.mjs:234` | `!md.includes('Typography')` | 新增「新增元素」段若输出英文分区名会红 |
| `tests-e2e/advanced.mjs:197-203` | v1 payload 导入的四条 | 仅当 `SUPPORTED` 丢掉 1-4 时 |

### 确认不受影响（已逐条核对，无需改）

- `tree-close` / `vr-tree-close`：旧套件 `tests-e2e/*.mjs` 零引用。
- `clearstyles` / `alt+del` / `alt+backspace` / ⌥：旧套件零引用（`acceptance.mjs:295-300` 的 `Meta+Alt+c/v` 是**样式**剪贴板 AC-3.10，别混淆）。
- ⌘G / 分组：旧套件零引用。
- §1.6 `on_click` 早退：`panel.mjs:341`、`toolbar.mjs:62`、`list.mjs:68`、`tree.mjs:128` 都走各自的处理器，不经 `on_click`。
- 两个跑批入口互不包含：`tests-e2e/all.mjs:3-15` 硬编码 31 个顶层套件（不含 `full/`）；
  `tests-e2e/full/all.mjs:9-11` 硬编码 12 个 full 套件（不含 `verify/`）。方案 §3 的验收命令成立 ✓

---

## 【建议】

1. **把 §1.1 从「甲的一节」提升成两人的共同前置**：甲出 change-store / history / json-io / prompt-export，
   乙同批出 change-list 的 `inserts` 渲染与计数。否则 B04/B05/B14/B17 交付的是一条「用户看不见」的记录。
2. **给 `ChangeStore` 加语义入口**：`groupElements(els)` / `ungroupElement(wrapper)`，
   把「insert + n×move」和「n×move + 对消 insert」封在 store 里，`selectable.js` 只调一句。
   这样记录语义（不生成「删除一个本次新增元素」的假记录、不留指向已删 wrapper 的落点锚点）才有地方收敛。
3. **§1.5 顺手治本**：把 `select()` 的 `handles.length` 发号换成单调计数器，
   B05 的「治本」那半（以及 ⌘D `on_duplicate` 的撞号路径）一起解决。
4. **§2.3 顺手记一条**：`.lock` 点击处理器（`props-panel.element.js:2555-2565`）四次 `#commit` **没包 batch**，
   与 B11 是同一类问题、同一个分区，乙改 B11 时顺手可解。写进最终报告即可。
5. **§2.8 直接把参数写进 data URI**（另加一个 `data-vr='size=0.5;density=100'` 之类的属性，`;` 分隔），
   比反解 `baseFrequency` 稳，也避开两段夹取死区；`isEffectLayer` 的子串匹配不受影响。
6. **§0 的测试归属表补一列「旧套件」**：本轮可能被碰到的是
   `advanced / acceptance-export / acceptance-variables / removal / text / toolbar / acceptance / drag / acceptance-content / acceptance-ui / figma / list`
   共 12 个文件，现在两个 agent 谁都没被授权改。
7. **§3 验收里两条要改**：
   - 「⌘G → 改动列表一条『分组』」——见【必须改】1，先确定 change-list 的归属；
     即便归了乙，分组产生的是「1 条 insert + n 条 move」，不是「一条」。
   - 「把手拖动后提示词里有『位移』」——见【必须改】15，提示词里出的是 `translate` 原文 + 分区名「定位」。

---

## 总评

**不能执行**（按现状）。修进上述 1 2 3 4 9 12 13 15 16 17 23 24 之后**可以执行**。
