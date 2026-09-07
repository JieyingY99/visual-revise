# 全量 e2e 修复实施报告

> 关联：方案见 [full-e2e-fixes.md](full-e2e-fixes.md) §1（甲：核心 / 上游路径）；
> 评审见 [full-e2e-fixes.review.md](full-e2e-fixes.review.md)；
> bug 清单与复现证据见 [full-e2e-report.md](full-e2e-report.md) §3（B01–B27）；
> 功能点编号见 [feature-inventory.md](feature-inventory.md)。

---

## 甲：核心 / 上游路径 · 待并入 PRD 的 AC

共 17 条，按 PRD 现有分区编号续排（3.x 选择与快捷键 / 4.x 按键让路与把手 /
7.x 拖拽 / 8.x 改动记录与导出）。下面是可直接粘进 `docs/PRD.md` 对应表格的原始行：

```markdown
| AC-3.13 | `⌘G` 把选中项包进一个新 `<div>`：外壳插在原位置（兄弟顺序不变），记成「1 条新增 + n 条移动」，一次 `⌘Z` 整体退回 |
| AC-3.14 | `⌘⇧G` 拆掉外壳，子元素按正序回到原容器；外壳若是本次会话造出来的，对消那条新增记录而不是记一条「删除的元素」 |
| AC-3.15 | `⌘C` / `⌘X` / `⌘D` 产出的 HTML 不含编辑器内部记号（`data-selected`、`data-label-id`、`data-vr-*`、`contenteditable` 等）；`data-label-id` 由单调递增计数器发号，粘贴 / 复制出来的副本永不与后来的选中项撞号 |
| AC-3.16 | `⌘X` 走与 Delete 同一条记账通道：删除进改动记录、可从记录里放回、能进提示词；`⌘V` 粘进来的元素记成一条「新增」 |
| AC-3.17 | `⌥Delete` / `⌥Backspace` 清空选中元素的 inline style：每条声明单独进改动记录，一次 `⌘Z` 全部回来；对编辑器注入之后才出现的元素同样有效；焦点在任意输入框内时不接管（保留「往回删一个词」） |
| AC-3.18 | Shift+单击取消其中一个选中项后，后续 hover 不抛异常（被摘掉的把手 / 标签同时从内部数组里剔除） |
| AC-4.9 | 上游工具条自己的输入框（closed shadow root 内）打字时，单字母模式热键让路，字符原样落进输入框 |
| AC-4.10 | 编辑文案时按一次 `Escape` 退出编辑态（摘掉 `contenteditable` / `spellcheck`、光标离开），第二次 `Escape` 才取消选中；焦点在面板输入框里时 `Escape` 仍是关弹层 / 取消选中 |
| AC-4.11 | 在面板里横向拖数值、越过面板边缘才松手：数值照常算，当前选中的元素不被换掉 |
| AC-4.12 | 缩放把手写的是 CSS 独立属性 `translate`（不是 `transform`）：进改动记录、进提示词的「定位」段；松手再拖第二次在上一次的位移上累加，不回弹 |
| AC-7.11 | 浏览器把手势升级成原生 HTML5 拖放（`pointercancel`）时，这一次页面拖拽必须收尾：`dragging` 归 false、拖影移除、源元素 opacity 复原、指示线与落点高亮清掉；此后的普通点击不会被当成落点提交 |
| AC-7.12 | 激活会自己吃鼠标的上游工具（Position / Move）时，页面拖拽不接管指针，工具的鼠标交互正常工作 |
| AC-8.10 | 提示词里有「## 新增的元素」段：用锚点描述位置（在哪个容器里、排在谁之前 / 末尾）并给出精简 outerHTML（超长截断并注明） |
| AC-8.11 | 导出 JSON `schema = 5`，带 `inserts`；导入顺序固定 edits → inserts → moves → removals → comments；`SUPPORTED` 仍收 1–5，旧文件照常导入 |
| AC-8.12 | 「重置全部」之后 `⌘Z` 把文案改动一并救回来（记录数与重置前一致） |
| AC-8.13 | 图片入口（评论参考图 / 换图）执行会话累计上限 20 MB：超出的图被拒并给出可见的 toast，而不是静默丢弃 |
| AC-8.14 | 「新增的元素」记录里的 HTML 反映该元素在页面上此刻的样子（分组的外壳含已搬进去的子元素），而不是它刚被创建那一刻的空壳 |
```

---

## 甲：核心 / 上游路径

### 1. 两个衔接问题的答复

#### B09：`pickImages()` 有没有把 `base` 透传给 `readImageList`？

**有，已在实施时补上。** `app/core/image-assets.js` 的三个入口全部收 `opts` 并往下传：

```js
export const readImageList = async (files, { base = 0 } = {}) => { … }
export const imagesFromDataTransfer = (dt, opts) => readImageList(all, opts)
export const pickImages = opts => new Promise(resolve => {
  …
  input.onchange = async () => resolve(await readImageList(input.files, opts))
})
```

`readImageList` 用 `base` 当会话累计基数，逐张累加后与 `MAX_TOTAL` 比较，超出的图不读取、
把「已超出会话累计上限（20.0 MB）」推进 `errors`。所以 props-panel 里的
`pickImages({ base: totalBytes(ChangeStore.allAssets()) })` 直接生效；评论层的三个入口
（选文件 / 粘贴 / 拖拽）同样传了这个基数（`comment-layer.element.js` 的 `usedBytes()`）。

`base` 由调用方传入而不是让 `image-assets.js` 自己去问 store：这是个纯函数模块，
反向依赖 store 是更糟的耦合。

**复跑**：`node tests-e2e/full/export-comments-misc.mjs` → 通过 151，失败 0
（含 7.2.10 的两条：单张超限有可见 toast、一次会话累计 21.5 MB 被拦下）。

#### insert 记录的 `html`：是否改成了插入之后再采样？

**是，改成了「导出时延迟采样」。** 没有选「batch 结束再采一次」，而是在 `insertList()` 里现采：

```js
const insertList = () =>
  Array.from(inserts.values())
    .sort((a, b) => a.seq - b.seq)
    // html 要现采，不能只留插入那一刻的：分组是「先插一个空 <div>、再把子元素
    // 搬进去」，插入那一刻它还是 `<div></div>`——提示词照着它写，AI 建出来的
    // 就是个空壳。粘进来的那一块之后也可能继续被编辑。
    .map(r => {
      if (r.el.isConnected) r.html = outerHtmlOf(r.el)
      return r
    })
```

选延迟采样而不是 batch 收尾采样，是因为它一次覆盖三种情况：分组的后置填充、
粘进来的那块之后被继续编辑、以及后续对新增元素调的样式。「batch 结束采一次」只覆盖第一种。
元素还连在页面上就以页面上那份为准并回写进记录——被 ⌘Z 摘出 DOM 之后就只剩记录里这一份。
代价是 `read()` 每次多克隆一遍新增元素的子树，量级是「本次会话的新增记录数」（通常 0–3）。

实测（⌘G 分组 `#b` 之后）：

```
insert.html        = <div><div class="item" id="b">B<em class="deep">deep</em></div></div>
提示词 ```html 块  = 同上
json.inserts.html  = 同上
再给 wrapper 调背景色后 = <div style="background-color: rgb(1, 2, 3);"><div class="item" id="b">…</div></div>
```

已补断言防回归：`4.1.13 新增记录里的 HTML 是搬完之后的样子，不是那个空壳`。

---

### 2. 待并入 PRD 的 AC

见本文开头的「甲：核心 / 上游路径 · 待并入 PRD 的 AC」一节。

---

### 3. 改了哪些文件

**源码**：`app/core/{change-store,json-io,prompt-export,tracked-props,image-assets,layout-drag,visual-revise,dom-utils}.js`、
**新增** `app/core/editor-marks.js`、`app/features/selectable.js`、
`app/components/selection/handle.element.js`、`app/components/comment-layer/comment-layer.element.js`。

**测试**：`tests-e2e/full/{select-handles-text,drag-guides-upstream,history-changes,export-comments-misc}.mjs`、
`tests-e2e/{advanced,acceptance-export,acceptance-variables}.mjs`。

未碰乙的任何文件，也未碰 `all.mjs` / `harness.mjs` / `fixture.html` / `docs/PRD.md` / 工作日志；未 commit。

---

### 4. 测试结果

`node tests-e2e/all.mjs` → **`合计：1027 通过 / 0 失败 / 0 个套件异常退出`**

| full 套件 | 结果 |
|---|---|
| select-handles-text | 全部通过 |
| drag-guides-upstream | 通过 146 · 失败 0 |
| history-changes | 72 通过 / 0 失败 |
| export-comments-misc | 通过 151，失败 0 |

（乙的 `panel-head-position` 顺带实跑：152 / 0，B12 那条已绿。）

---

### 5. 逐条 B 编号

| 编号 | 状态 |
|---|---|
| B01 | 已修 · `pointercancel` 与 move/up 一起注册、`disarm` 对称移除，原生拖放接管时干净收尾 |
| B04 | 已修 · `⌘G`/`⌘⇧G` 走 `ChangeStore.groupElements/ungroupElement`，记「1 条 insert + n 条 move」，一次 ⌘Z 整体退回 |
| B05 | 已修 · `stripEditorMarks` 用于 copy / cut / duplicate；`select()` 改单调计数器发号，双层治本 |
| B07 | 已修 · `isTypingTarget` 沿 `shadowRoot` / `$shadow` 下钻到真正的 activeElement |
| B08 | 已修 · `vr-toast` 监听提到 `document`，任何组件冒泡上来都有人显示 |
| B09 | 已修 · `readImageList(files, { base })`，评论层与面板都传 `totalBytes(allAssets())` |
| B10 | 已修 · `captureAll` / `restoreAll` 补 `textNodes`（失联 `frozen` 那条路按方案不做） |
| B12 | 已修 · `on_click` 对本 fork 的面板早退，不吃 `visbug-*` 覆盖层 |
| B14 | 已修 · 外壳插在原位（实测下标不变） |
| B15 / B16 | 已修 · `⌥Delete` 收进 `onKeydown`，逐条 `applyProp` 入账、一次 ⌘Z 全回；三处上游绑定一并删除 |
| B17 | 已修 · `⌘X` 走 `removeElements` |
| B18 | 已修 · `unselect` 按元素引用剔除，不留 null 槽位 |
| B19 | 已修 · 把手改写 `translate`，基数读 `initialStyle.translate`，进 TRACKED_PROPS |
| B20 | 已修 · Escape 分支按 `composedPath()[0].isContentEditable` 自行退编辑态 |
| B22 | 已修 · `createLayoutDrag({ activeTool })` + `MOUSE_TOOLS` 在 pointerdown 早退 |

`insert` 记录形状严格按方案 §1.1：`{ kind:'insert', id, el, parentAnchors, nextAnchors, atEnd, html, label }`，
`read().inserts` / `stats().inserts` / `stats().total` 已计入；schema 升 5，`SUPPORTED = [1..5]`，
导入顺序 edits → inserts → moves → removals → comments。

---

### 6. 改了哪些既有断言

1. `advanced.mjs:121`、`acceptance-export.mjs:152`、`acceptance-variables.mjs:483`、
   `full/history-changes.mjs:1099`、`full/export-comments-misc.mjs:512`：`schema === 4` → `5`（本方案明确升版）。
2. `full/history-changes.mjs:1116-1123`、`full/export-comments-misc.mjs` 的 schemaProbe：
   v5 由「被拒」改成「接受」，改测 v6 被拒。
3. `full/select-handles-text.mjs`：8 个把手断言从 `style.transform` 改读 `style.translate`
   （`tr()` 解析器改写，y 为 0 时 CSSOM 会省略第二个值）；
   「transform 不在 TRACKED_PROPS」「提示词里没有 transform」两条方向反转成
   「translate 进记录 / 进提示词」——它们锁的正是本方案要改掉的旧行为。
4. `full/drag-guides-upstream.mjs` 4.4.1「确实起了拖」的探针搬进页面
   （起拖与收尾落在同一个任务里，跨进程读到的永远是收尾之后的状态）。断言本身没放宽。
5. `drag.mjs:56,129,187,214` 与 `acceptance-content.mjs:138` 按方案要求实跑，全绿，一字未改。

**新增断言（走真实交互）**：⌘G 的 inserts / moves 计数、提示词「新增的元素」段、
新增记录的 HTML 非空壳、⌘⇧G 无假删除记录、一次 ⌘Z 整体退回、⌘V 入账、
把手第二次拖累加、inserts 的 JSON 往返。

---

### 7. 与方案的偏离

1. **外壳插在最靠前那个选中元素之前**（方案写 `nextElementSibling`）。这样子元素的 `fromNext`
   仍是它真正的原后邻，`⌘⇧G` 时 `moveElement` 命中「回到原位」分支自动对消；
   否则会残留一条指向外壳的假移动。最终下标两种写法一致。
2. `stripEditorMarks` 放在**新建的零依赖模块** `app/core/editor-marks.js`。
   放进 `dom-utils.js` 会让 `change-store.js` 的 import 链带上 `blingblingjs` 裸说明符，
   `tests-e2e/core.mjs` / `comment.mjs` 直接从源码 import 时整套异常退出（已实测到并修正）。
3. **B08 用一条 `document` 级监听**替代「给 comments 补一条」：所有 `vr-toast` 都是
   `bubbles + composed`，一条即可，且给 `selectable.js` 的粘贴失败提示留了出口；
   `destroy()` 里对称移除。
4. **B01 没有加 `dragstart` 的 `preventDefault`**（报告里那半修法）。加了会打死上游 imageswap
   （`4.6.14 拖图换 src` 变红）。只收 `pointercancel` 即满足「不能卡住」的期望；
   代价是那一次手势的移动不提交（`moves = 0`），与报告的期望「提交或取消都行」一致。
5. `⌘D` 只做了剥记号，未记 insert（方案没要求）。
6. `createLabel` / `createHandle` 去掉了 `!labels[id]` / `!handles[id]` 去重守卫——
   那条守卫只在「id === 数组下标」时才成立，改用计数器之后下标早已对不上。

---

### 8. 行为变更（需周知）

- 把手写 `translate` 从「整条覆盖页面原有 transform」变成**叠加**：
  页面本身带 transform 的元素，视觉结果与以前不同。
- `⌘X` 从「只删 `selected[0]`」扩成**删全部选中**。
- 跨父节点 `⌘G` 会把元素**跨容器**搬走（上游行为，现在会真的写进提示词）。
- `⌥Delete` 多选时一次清空所有选中元素的 inline style。
- 面板里不会多出「位移」字段（没加 `CONTROLS['translate']`），
  提示词「定位」段出现的是 `| translate | none | 40px 30px |`。

---

### 9. 发现但没处理

- `captureAll` 的失联（`frozen`）快照仍不带文案，那条路的文案救不回（方案 §1.12 明说不做）。
- `undoElement(id)`（「还原此元素全部改动」）不覆盖 insert 状态：
  对新增出来的元素点它只还原样式，不会把它撤掉。
- `insertList()` 与 `moveList()` 一样不过滤已被页面删掉的节点，记录会指向一个已断开的节点。
- 分组的外壳是无样式匿名 `<div>`：跨父节点分组时布局会真的变（上游行为）。
- `⌘D` 副本仍不进改动记录（方案未覆盖）。

---

## 乙：面板 / 控件 / 列表（摘自 agent 报告）

改动：`change-list.element.{js,css}`、`props-panel.element.js`、`controls/picker.js`、`tree/tree.element.{js,css}`、`core/controls.js`、`core/effects.js`；测试 `list.mjs`、`full/{tree,stroke-effects}.mjs`。

- B02 `.items` 加 `grid-auto-rows: max-content`；B03 `[data-drag]` 与方向键按 `data-pair` 解出两条属性一个 batch 提交；B06 参数原样写进 SVG 根 `data-vr='k=v;k=v'`（`;` 分隔、值 `encodeURIComponent`），玻璃高光从 inset 高光 alpha 取回，往返断言含死区值；B09 fill 侧 `pickImages({ base })`；B11 联动锁开时通用 change 早退，`.lock` 四次 commit 包 batch；B13 单位取 框内 → 计算值 → `coerce('1')` → px；B21 关灯那次在写入后再落记录并存 `after`，再开先比对，`#writeBackground` 末尾清 `#layerRestore`；B23 `isRelevant('overflow')` 门控；B24 `stepValue` 夹 min/max；B25 非法色值直接写回；B26 `RERENDER_ON` 加 `border-style`；B27 删按钮、事件与 CSS；§2.0 `#renderInsert` + `#elementOf` 分支 + 「配置」计数 `+ stats.inserts`。
- 偏离：pair 拖拽是「每变一步一个 batch」（`history.js` 的合并只对单 op 生效，那是甲的文件），加了 `next === last` 去重；手输（非步进）仍不受 min/max 约束。
- 六个 full 套件 720 / 0；旧套件 991 / 0（当时 core / comment 因甲的 import 链异常退出，甲随后改成零依赖的 `editor-marks.js`）。

## 编号并入 PRD 时的改动

乙的色盘非法输入 → AC-3.14；甲的 ⌘G 系列 → AC-3.15–3.20；乙的列表三条 → AC-8.10–8.12；甲的导出 / 导入 / 重置 / 图片上限 / 延迟采样 → AC-8.13–8.17。

