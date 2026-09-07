# 评审：`color-picker-variables.md`（只读评审，未改动任何代码）

> 关联：被评审的方案见 `color-picker-variables.md`；需求条目见 `../PRD.md` §6（AC-6.9 / AC-6.15 / AC-6.23c / AC-6.24 系列 / AC-6.26）；
> 层叠判定见 `../../app/core/cascade.js`，写入原语见 `../../app/core/change-store.js`。
> 同一套 plan → review → 执行 → 验收流程的上一份：`cross-container-reorder.md`。

评审范围：方案 §2.1–§2.7 对照真实代码的事实核对。所有行号基于评审当时的工作副本。

---

## 【必须改】

### 1. §2.4 的 important 判定条件写反了，第二次写入起就失效

**方案**：`const priority = win && win.source === 'sheet' && win.important ? 'important' : ''`。

**代码事实**：`winningDeclaration` 把 inline 声明也放进同一场层叠竞争——`cascade.js:179-180` 把 `el.style` 里的声明以 `{ inline: true, source: 'inline', specificity: 0, order: Infinity }` 参与比较，`cascade.js:164` 的 `score` 顺序是 `[important, inline, !layered, specificity, order]`，important 权重最高、inline 次之。

后果链条：

- 第一次写入时样式表赢家带 important → `source === 'sheet'` 成立 → 写进 `!important`，正确。
- 第二次写入时 **inline 自己已经带 important**，它同时满足 important=1 与 inline=1，稳赢样式表 → `source === 'inline'` → priority 变成 `''` → `setProperty(prop, v, '')` 把 important 标志摘掉 → 样式表那条重新赢回去，这次写入静默失效。
- 拖动滑块 / 拖标签调值是每个 pointermove 一次 `#commit`（`props-panel.element.js:2466-2472`），也就是「第一帧生效、之后整段拖动全部无效」。
- undo/redo 走 `applyOp` → `writeProp(op.el, op.prop, before)`（`change-store.js:142-148`），此刻 inline 仍带 important，同样判成 inline → 丢 priority。方案里「`before` 有值时经 `writeProp` 重新判定，自然带回 important」**不成立**。

**改法**：条件放宽成 `win?.important`（不再区分 source），或并上 `el.style.getPropertyPriority(prop) === 'important'`。更稳妥的是按第 2 条把判定挪出 `writeProp`。

---

### 2. §2.4 把 `winningDeclaration` 塞进 `writeProp` 的位置错了

**代码事实**：`writeProp`（`change-store.js:38-42`）是**重放原语**，注释自己写明「这几个只管把值落到 DOM，不记历史。undo / redo 直接用它们回放」。它的调用方有三处：

| 调用点 | 位置 | 语义 |
|---|---|---|
| `applyProp` | `change-store.js:766-777` | 用户发起的写入，之后 push history |
| `applyOp`（`kind: 'prop'`） | `change-store.js:142-148` | undo / redo 回放 |
| `replayOnto` | `change-store.js:509-523` | 框架换掉节点后把改动重贴到新节点 |

（`restoreAll`（`:91-129`）与 `revertProp`（`snapshot.js:211-220`）走的是 `setAttribute('style', cssText)` / 探针 `getPropertyPriority`，本身已经保住 important，不受影响——这一点方案说对了。）

两个问题：

1. **重放不再确定**。undo 的结果会依赖「重放那一刻页面样式表长什么样」，而不是历史 op 里记下的数据。`history.js` 的整个设计前提是「每条历史用**数据**描述而不是闭包」（`history.js:6-8`），把层叠查询塞进回放路径违背了这条。
2. **性能**。`cascade.js` 的 50ms 缓存（`:102-107`）只省掉 `flatten` 一次铺平，**没有省掉 `el.matches(rule.selectorText)` 对全部规则的逐条匹配**（`:185-196`）。而写入是高频的：拖动每帧一次；`#writeBackground` 一次写 5 条属性（`props-panel.element.js:1149-1159`）；四边联动一次写 4 条（`:2427-2431`）；`#batch` 里的排列/对齐一次写一整个 patch（`:2082-2084`）。在规则数以千计的真实页面上，这是可见的掉帧。

**改法**：在 `applyProp` 里算一次 priority，随 op 一起存进 history（`before`/`after` 各带自己的 priority），把 `writeProp` 的签名扩成 `writeProp(el, prop, value, priority)`，只负责落地。

---

### 3. §2.4「值后面带 ` !important`」会破坏简写折叠与 JSON 导入

**方案**：`readInline` / 快照 / 导出在 `getPropertyPriority === 'important'` 时给值加 ` !important` 后缀；导入时识别后缀写回 priority。

**代码事实**：

- `prompt-export.js:14-41` 的 `collapseShorthand` 会把 padding / margin 四条边的值 `tos.join(' ')` 拼成一条简写。值里带后缀就会拼出 `padding: 4px !important 8px !important 4px !important 8px !important`——一条非法声明直接写进给 AI 的提示词。
- `json-io.js:117` 的导入路径是 `record.changes.forEach(c => ChangeStore.applyProp(el, c.prop, c.to))`，也就是 `writeProp` → `setProperty(prop, "rgb(0,0,0) !important")`。CSSOM 的 `setProperty` **不接受 value 参数里含 `!important`**，整条声明被丢弃，表现为**静默 no-op**。方案说「导入 JSON 时识别 ` !important` 后缀写回 priority」，但没说这一步发生在哪一层——它必须发生在 `writeProp` / `applyProp` 里，`json-io` 自己那条路径根本碰不到值。
- 口径不一致：`readInline`（`snapshot.js:80-87`）改了之后，`diffSnapshot`（`:133-147`）的基线和当前值都带后缀，而 `applyProp` 的 `before` 用的是不带 priority 的 `el.style.getPropertyValue(prop)`（`change-store.js:769`），两套比较基准会漂移；`sameValue` / `normalizeValue`（`tracked-props.js:114+`）也不认这个后缀。

**改法**：priority 单独存成结构化字段（例如 `change.important: true`），提示词渲染时再拼成后缀，JSON 里也作为独立字段往返。不要把它拼进 value 字符串。

---

### 4. §2.6 的 AC-6.31a 与 §3「不做阴影变量」自相矛盾，且 box-shadow 本来就绑不住

**方案**：§3 明写「不做：阴影 / 滤镜变量（Effects 已去掉变量入口）」，但 §2.6 的 AC-6.31a 又要求「任一 `vr-color`（描边色、**效果参数面板的阴影色**）打开后顶部有 Custom | 变量 两页」。

**代码事实**（即使想做也做不成）：

- 写：`serializeEffects` 用 `shadowCss` 拼 `${x}px ${y}px ${blur}px ${spread}px ${color}`（`effects.js:61-62`）。`var(--x)` 拼进去语法合法，CSS 也能解析。
- 读：`parseEffects` 读的是 **computed**——`props-panel.element.js:1164` 的 `#effectList()` 调 `parseEffects(this.#computed)`，而 `#computed = readComputed(target)`（`:313`、`:396`）就是 `getComputedStyle`（`snapshot.js:66-78`），var() 早已解析成 rgb()。
- 更硬的一层：`parseShadow` 的颜色正则是 `/(rgba?\([^)]*\)|#[0-9a-f]{3,8}|\b[a-z]+\b(?!\s*\())/i`（`effects.js:119`），末尾的 `(?!\s*\()` **刻意排除后面跟括号的 token**，`var(--x)` 匹配不上；于是颜色回落到默认值，`var(--x)` 的字符还会被 `lens` 当成长度串解析出 NaN。
- 参数面板的写入路径 `patch()` 每次都重新 `this.#effectList()`（`props-panel.element.js:1338-1343`），所以绑定活不过一次写入。
- PRD `docs/PRD.md:182` 的 AC-6.23c 也明写「**Effects 标题栏没有「绑定变量」**」。

**改法**：二选一。

- （推荐）`openColorPopover` 支持 `variables: null` / `tabs: ['custom']`，让 `vr-color[data-fx]`（`props-panel.element.js:1333`）只有 Custom 页；AC-6.31a 的举例改成「描边色 / 文字色」。
- 或者真做：效果模型必须改成保存声明原文而非从 computed 反解，那是另一个方案的体量，不该塞进这一份。

---

### 5. §2.2 的 `linear-gradient(var(--x), var(--x))` 永远读不回来

**方案**：非底层纯色写成 `linear-gradient(var(--x), var(--x))`，`fills.js` 的解析加一条「两端都是同一个 `var(--x)` 的 linear-gradient 认作绑定了变量的纯色层」。

**代码事实**：`parseFills` 的入参是 **computed**，不是 inline，也不是声明原文——`props-panel.element.js:1120` 的 `#fillLayers()` 调 `parseFills(this.#computed)`，`#computed` 就是 `readComputed`（`snapshot.js:66-78`）。computed 里 `background-image` 的 var() 早已被浏览器解析成 `linear-gradient(rgb(a, b, c), rgb(a, b, c))`。**在 `fills.js` 加的那条规则永远不会被触发**。

顺带纠正一个方案里没提但值得知道的细节：`parseColor` 是拿探针元素交给浏览器解析的（`picker.js:45-61`），`probe.style.color = 'var(--x)'` 是合法赋值，探针挂到 body 后若 `--x` 在 `:root` 有定义，computed 会解析出真实颜色 → `parseColor('var(--x)').valid === true`。也就是说 `solidFromGradient`（`fills.js:28-35`）**本来就可能认得** `linear-gradient(var(--x), var(--x))` 并原样返回 `'var(--x)'`。问题 100% 出在数据源是 computed，不在 `fills.js` 的解析逻辑。

**改法**：层的绑定判定必须另开一条「读声明原文」的路，而且要处理三个错位：

1. `winningDeclaration(el, 'background-image')`（`cascade.js:174-202`）取原文 → `splitTopLevel` 切层（`gradient.js:17-31`）。
2. 跳过 `isEffectLayer` 的噪点 / 纹理层（`fills.js:52`、`effects.js:58`）——面板的层下标里没有它们。
3. 垫底的 `background-color` 在面板层列表里是**最后一项**（`fills.js:60-62`），而 `background-image` 的下标从 0 开始，两套下标要对齐。

最后仍要拿解析结果和 computed 核对（沿用 `#bindingFrom` 的兜底思路，`props-panel.element.js:1475-1478`）。这是 §2.2 的主要工作量，方案里被一句话带过了。

---

### 6. §2.2 / §2.3 的绑定会被下一次填充编辑静默抹掉

**代码事实**：`#writeFillLayers` → `#writeBackground`（`props-panel.element.js:1131-1160`）每次都用 `serializeFills(parseFills(computed))` 的结果把 `background-color` + `background-image` + 三条效果属性**整体重写一遍**。`serializeFills`（`fills.js:72-88`）写的 `background-color: last.value`，而 `last.value` 来自 `parseFills(computed)`，是解析后的 rgb()。

所以：底层纯色即使绑了 `var(--x)`，用户只要动了别的层、加一条效果、开关一次层的眼睛、拖一次层序，`background-color` 就被写回死色值，绑定静默消失。

这个洞现在就存在（`#renderFillLayers:1535-1537` 是唯一入口，触发面窄），但 §2.2 把绑定搬进填充弹层、成为常规操作之后会天天踩。

**改法**：层模型带上 `bound: '--x'` 字段，`serializeFills` 遇到 `bound` 时输出 `var(--x)`（底层写 `background-color`，非底层写 `linear-gradient(var(--x), var(--x))`），而不是输出解析色。

---

### 7. §2.3 的变量数据源 `cssVariables()` 覆盖不全，变量页很可能是空的

**方案**：「变量数据的准备（`cssVariables()` + `varKind` 过滤 + 按 `this.target` 解析值）收成一个 `#colorVariables()`」——也就是原样沿用现有的 `cssVariables()`。

**代码事实**：`cssVariables()` 在 `resizing.js:220-242`，它只做两件事：

```js
for (const sheet of Array.from(document.styleSheets || [])) {
  let rules
  try { rules = sheet.cssRules } catch { continue }
  for (const rule of Array.from(rules || [])) {
    if (!rule.selectorText || !rule.style) continue
    if (!/^(:root|html)\b/.test(rule.selectorText)) continue
    ...
  }
}
for (const name of Array.from(document.documentElement.style || [])) { ... }
```

四处盲区：

1. **不递归 at-rule**。只遍历每张表的**顶层**规则；`@media` / `@layer` / `@supports` / `@import` 里面的 `:root { --x }` 一个都收不到。对比 `cascade.js:105-149` 的 `flatten` 是完整递归的（`CSSMediaRule` / `CSSSupportsRule` / `CSSImportRule` / `CSSLayerBlockRule` 都处理了）——**同一个仓库里两套口径**，chip 能认出的绑定，变量菜单里却列不出来。
2. **不扫 `adoptedStyleSheets`**。`cascade.js:145` 扫了，这里没有。
3. **只认 `:root` / `html` 选择器**。容器作用域上的 token（`.theme-dark { --role-bg: … }`、`[data-theme="dark"] { … }`）全部丢失。而 `#openVarMenu` 又特意「按 `this.target` 解析值」（`props-panel.element.js:1596`），说明作者本来就知道变量会被容器重新赋值——收集端却没跟上。
4. `@media (prefers-color-scheme: dark) { :root { … } }` 这种最常见的暗色 token 写法，正好同时命中盲区 1。

现代设计系统的 token 大多写在 `@layer base { :root { … } }` 或 `@media` 里。这直接决定新变量页有没有内容——而**变量页是整个方案的核心交付物**。

顺带：这也很可能就是方案 §2.7 想验证的那个现象的真因。方案在 §2.7 里怀疑「`.wall-card` 的 Fill 显示的是 `#f0eee6`，要确认是旧 bundle 还是层叠判定漏了 `background` 简写里的什么写法」——**不是**旧 bundle，也**不是**简写没处理：`cascade.js:18-26` 的 `SHORTHANDS` 已经把 `background-color` 映到 `background`，`declIn`（`:155-162`）在长手读不到值时会回落到简写（`background: var(--x)` 这种含 var() 的简写，CSSOM 对长手返回空串、对简写返回原文，正好走通这条回落）。真正的候选原因是本条（token 定义在 `@layer` / `@media` / 容器类里，`cssVariables` 收不到）或第 5/6 条（层下标判定 + 写回抹除）。

**改法**：`#colorVariables()` 不要直接包 `cssVariables()`，改成复用 `cascade.js` 的 `flatten` 走一遍全部规则、收集所有 `--*` 声明名（不限选择器），再用 `getComputedStyle(this.target)` 逐个解析取值去重。顺手把 `resizing.js` 那个也换过去，消掉两套口径。

---

### 8. §2.5 用 `isReplacedElement` 判定会误伤内联 `<svg>`

**方案**：`group.id === 'typography' && !(isTextElement(target) && !isReplacedElement(target))` → 不渲染。

**代码事实**：`isReplacedElement` 的正则含 `svg`（`controls.js:318-319`），而 `isTextlessElement`（当前真正在管 Typography 可见性的那个，`controls.js:329-330`）**刻意不含 svg**，上面的注释写得很明确：

> 内联 `<svg>` 刻意不在此列：它里面可以有 `<text>`，而且确实会继承 font-* 属性，隐藏就错了。这也是它与 `isReplacedElement` 的唯一差别。（`controls.js:324-325`）

方案的条件对 svg 是双重否定：内联 `<svg>` 的文字在子 `<text>` 里，不是 `<svg>` 的直接文本子节点，所以 `isTextElement` 本来就是 `false`（`dom-utils.js:84`）→ 整段被砍。`image-fill.mjs:91-94, 109-113` 有专门为这个取舍写的守卫用例。

**改法**：条件写成 `!isTextlessElement(el) && (isTextElement(el) || 内联 svg)`，或直接复用 `isTextlessElement` 再叠一层 `isTextElement`，别引入 `isReplacedElement`。

---

### 9. §2.5 漏了要改的 PRD 条目

**代码事实**：

- `docs/PRD.md:202` 的 **AC-6.15**：「Typography 与 Effects 默认折叠，减少首屏噪音；选中**文字元素**时 Typography 自动展开」。非文字元素上「默认折叠」这半句在新行为下不再成立（分区整个不存在），这条必须重写。
- **AC-6.9** 系列的验收目前在 `#rich`（`acceptance-panel.mjs:18-23` 建的容器 div）上跑 Typography，要连带换目标元素。

方案 §2.6 只说了改测试（「`acceptance-panel` 的 `#rich` 若要测 Typography，给它加一段直接文字」），§4 影响面里列了 `docs/PRD.md`，但没具体点出 AC-6.15 / AC-6.9 这两处要改。建议在方案里写死。

---

### 10. §2.3 退掉 `openMenu` 会连带丢掉两条现有能力

**代码事实**：

1. **滚动关闭**。`menu.js:85-89` 在页面或面板滚动时关掉菜单（锚点跟着走了，菜单留在原地就成了孤儿），并特意放行菜单自身内部的滚动。`color.element.js` 只有 Esc（`:28-33`）和 pointerdown 外点（`:35-40`），**没有 scroll 关闭**。改后从分区标题栏或 chip 打开的色盘，面板一滚就变成一个悬在半空、和锚点脱节的浮层。
2. **`data-menu-open` 标记**。`props-panel.element.css:261` 有 `.var-chip:hover, .var-chip[data-menu-open] { background: var(--vr-field-hi) }`，依赖 `openMenu` 给锚点打的 `data-menu-open`（`menu.js:193`）。色盘打的是 `data-open`（`color.element.js:183`），换过去之后 chip 的「菜单开着」激活态直接失效。

**改法**：色盘弹层补上 scroll 关闭（放行自身滚动），并给锚点打同名标记；或同步改 CSS 选择器。

---

### 11. 弹层嵌套：`vr-color` 的外点关闭判定漏了 `SIBLING_PANELS`（现存 bug，§2.1 会放大它）

**代码事实**：三个弹层的外点关闭判定不一致——

| 组件 | 位置 | 是否带兄弟弹层白名单 |
|---|---|---|
| `fill.element.js` | `:26` `SIBLING_PANELS = ['visual-revise-select-panel', 'visual-revise-color-panel']`，`:51` 使用 | ✔ |
| `menu.js` | `:16-20` 三个 id 全在，`:67` 使用 | ✔ |
| `color.element.js` | `:35-40` 只有 `n?.id === PANEL_ID \|\| n === openInstance` | ✘ |

后果：色盘里的格式切换是 `<vr-select class="format" options='["Hex","RGB","HSL"]'>`（`picker.js:126`），它的下拉面板挂在 body 上、id 是 `visual-revise-select-panel`（`select.element.js:11, 187`）。点它的选项时，`composedPath` 是 `[option, selectShadowRoot, selectPanelHost, body, html, document]`，里面**没有色盘宿主**→ `color.element.js:39` 的 `closePanel()` 触发，色盘当场被移除；而 `select` 的 `pick()` 挂在 `click` 上（`select.element.js:207`），在 pointerdown 之后才跑，等于对着一个已脱离 DOM 的 picker 提交，`sync()` 写进空气。

`controls.mjs:123-126` 的注释已经承认这块没测：

> 格式切换与不透明度：这里只做静态校验。它们要在「色盘弹层里再开一层下拉」的嵌套场景中操作，自动化下时序极不稳定……

也就是**这个 bug 从来没被覆盖过**。而 §2.1 要在色盘顶部再加一排 tab、并从 chip / 分区标题栏 / 填充弹层多个位置打开它，嵌套只会更多、更常触发。

**改法**：给 `vr-color` 补 `SIBLING_PANELS`（至少含 `visual-revise-select-panel` / `visual-revise-fill-panel` / `visual-revise-menu` 三个 id），并把 AC-6.31e 写成真的去点一次格式下拉、断言色盘仍在。

---

### 12. §2.3 的 `onVariable` 写入路径缺两步，AC-6.31c 不成立

**方案**：`onVariable(name)` → `this.#commit(prop, \`var(${name})\`, { coerce: false })`。

**代码事实**：现有的 `#openVarMenu` 回调是三步（`props-panel.element.js:1617-1622`）：

```js
if (name === current) return
this.#commit(prop, `var(${name})`, { coerce: false })
this.render()
this.#toast(`${prop} → var(${name})`)
```

`#commit`（`:1953-1965`）**对颜色属性不触发 render**——`RERENDER_ON` 只有 `position` / `display`（`:183`）。不 render 就不会把格子换成 chip，AC-6.31c 的「格子变 chip」直接不成立。另外 `#syncValues`（`:431-435`）在外部改动（撤销 / 导入 / 改动列表）触发时，会把 `vr-color` 的 `value` 用 computed 的解析色盖回去。

**改法**：在方案里写死顺序——`onVariable` → 关弹层 → `#commit` → `render()` → `#toast`；并说明「点当前已勾项什么都不做」的短路（现有 `:1618`）保留在哪一层。

---

### 13. §2.2 / §2.3 三个没交代的边界

1. **多选 / 联动**：`#varBinding` 只看 `this.target`（`:1443-1445`，即 `#targets[0]`），而 `#commit` → `#applyToAll` 写的是 `#scope()` 全部元素（`:1360-1363`、`:351-355`，开了「共享元素」还会带上 `findSharedElements` 的结果）。多选时 chip 只反映第一个元素的绑定状态，但绑定/换绑会写进所有元素；`#unlink`（`:1510-1522`）则是逐元素取各自的 computed 解析色。这套行为要在方案里写清楚，否则实现时容易两边不一致。
2. **Stroke 的空状态**：没有边框时整组只剩加号，`border-color` 那一行根本不渲染（`#defaultRows:1030`「没有描边时 Stroke 是空状态」），但分区标题栏的 `.var-btn` 仍然会把变量绑到 `border-color` 上（`#varMenu:1582`）。绑完什么都看不见（`border-width: 0` / `border-style: none` 时 `border-color` 不可见）。§2.3 保留这个入口的话要么禁用、要么连带写 `border-style: solid`。
3. **描边色的 `vr-color` 在哪渲染**：它走的是通用的 `#renderControl`（`:1899-1900`，`spec.type === 'color'` 分支），而 `#renderControl` **已经有** `#varBinding` → `#renderBoundRow` 的分支（`:1877-1880`）。§2.1 只需要把 `vr-color` 的触发器换成 `openColorPopover`，不需要为描边色再写一遍绑定分支——方案没点明这一点，实现时容易重复造。

---

## 【建议】

1. **AC-6.26 没进方案清单**。`docs/PRD.md:193` 的 AC-6.26（「`openMenu` 菜单同上（滚动 / 滚到底 / 选中 / Esc）」）正是拿变量菜单来验 `openMenu` 通用行为的。变量菜单一撤，AC-6.26 应改挂到仍在使用 `openMenu` 的两个消费者上——Effects 添加菜单（`props-panel.element.js:1295`）或 Resizing 模式菜单（`:1815`）——否则 `openMenu` 的滚动 / Esc / 选中就彻底没有测试覆盖了。

2. **`menu.js` 的 `swatch` 与 `checkAt` 会变成没有调用方的死代码**。全仓检索，`swatch:`（`menu.js:153, 159`）和 `checkAt: 'end'`（`:128, 152, 157`）**只有 `#openVarMenu`（`props-panel.element.js:1615, 1622`）一个调用方**。方案说「保留（通用能力，成本为零）」——实际成本是无测试覆盖的死代码。要么删掉，要么在新的变量列表渲染里复用它（`renderVariableList` 完全可以生成同构的行）。`[data-item]` 确实要保留，`select.element.js:195` 和 `openMenu`（`:145`）都在用，测试也在用（`controls.mjs:48`、`figma.mjs:22`、`resizing.mjs`、`grid.mjs`）——这一点方案说对了。

3. **§2.7 的排查方向要修正**。见【必须改】7 末尾：`.wall-card` 显示死色值**不是**「旧 bundle」也**不是**「层叠判定漏了 `background` 简写」（`cascade.js:18-26` + `:155-162` 已经处理了简写回落）。建议把 §2.7 的待验证项改写成两条具体分支：(a) token 定义在 `@layer` / `@media` / 容器类里，`cssVariables` 收不到；(b) `#renderFillLayers:1535` 的「只有最后一层纯色才判绑定」在该元素上不成立（比如底色透明、颜色来自某个 gradient 层）。

4. **Typography 整段消失后，改动没有回退入口**。VisBug 的快捷键可以在任意元素上改字号 / 字重，这些改动会进改动记录；但面板里的「重置本组」只对渲染出来的 `section` 可达（`#resetGroup:2042`，`#refreshDirty:463-467` 也只遍历现存 section）。用户会看到改动记录里有一条 `font-size`，却在面板上找不到任何地方改回去。建议加一条兜底：本组有 dirty 改动时仍然渲染分区（折叠态）。

5. **§2.1 抽 `openColorPopover` 时要一并搬走的耦合不止 `#toggle`**：
   - 实例级 `#format` 状态（`color.element.js:44`），它由 picker 回吐（`:166-170` 的 `this.#format = this.#picker.format`），也参与触发行的渲染（`:122`）与 `#commitParts`（`:146-148`）。
   - `attributeChangedCallback` 里的 `openInstance === this` 判断 + `#picker?.set(this.value)` 外部同步（`:69-72`）。
   - `disconnectedCallback` 的 `closePanel`（`:67`）——面板 render 会换掉 `vr-color` 实例，这条是弹层不留孤儿的关键。
   - 点 INPUT 不弹层的 `composedPath` 守卫（`:58-64`，对应 PRD AC-6.20）。
   - 定位必须在 `createPicker` 之后（`:173-180` 的注释解释了为什么），加 tab 之后高度会变，切页要重新夹回视口（方案提到了，但要注意 `vr-color` 现在用的是 `panel.style.left/top` 直接算，没有像 `vr-fill` 那样抽出 `#place()`，`fill.element.js:311-319`）。

6. **§2.2 的两层 tab 会打破填充弹层的精确断言**。`fill.mjs:90-96` 对 `TABS`（`fill.element.js:85-90`）做的是全等 JSON 比较，`fill.mjs:69-73` 的 `tab()` 助手也假设了 `[data-tab]` 的集合。建议把断言改成包含式白名单，并给新的一排 tab 用不同的属性名（例如 `data-page="custom|variable"`），避免和现有 `data-tab` 混在一个选择器空间里。

---

## 【会挂的测试】

### (A) Typography 只给文字元素

| 文件:行 | 用例 | 原因 |
|---|---|---|
| `typography.mjs:10-11` | 助手 `section(id)` / `isFolded(id)` | 对 0 个匹配的 locator 调 `evaluate` → 30s 超时，不是干净失败 |
| `typography.mjs:49-53` | 「选中非文字元素时 Typography 默认折叠」（目标 `.swatch`，空 div） | 分区已不存在，`isFolded` 挂住 |
| `figma.mjs:29-34` | 「分区顺序」 | `EXPECTED` 硬编码含 `typography`，在 `.curve-card`（容器）上比对失败 |
| `figma.mjs:36-41` | 「Typography 夹在 Appearance 与 Fill 之间」 | `indexOf('Typography')` 变 -1 |
| `figma.mjs:198-202` | 前置：在 `.curve-card` 上 `input[data-prop="font-size"].fill('20px')` | 控件不再渲染 → `fill()` 超时，后续整段中断 |
| `figma.mjs:207` | 「Typography 的改动不受影响」 | 依赖上面那次写入 |
| `figma.mjs:208-209` | 「改动记录只剩另一组的 1 项」 | `stats().props` 变 0 |
| `figma.mjs:211-215` | 「导出的提示词用中文分区名」/「英文分区名不会漏进中文文档」 | 依赖被记录的 `font-size` 改动 |
| `acceptance-panel.mjs:31-35` | 助手 `unfold(title)` | 对缺失分区 `getAttribute` → 超时 |
| `acceptance-panel.mjs:140-142` | `── 6.9 Typography` 的 `unfold('Typography')`（目标 `#rich`，容器） | 挂住后**整个套件后续用例都不再执行** |
| `acceptance-panel.mjs:145-146` | **AC-6.9a** 字体只换栈首、后备保留 | `vr-select[data-prop="font-family"]` 不存在 |
| `acceptance-panel.mjs:147-150` | **AC-6.9b** 字重 / 字号 / 行高 / 字距 | 四个控件全没了 |
| `acceptance-panel.mjs:151-154` | **AC-6.9c** 对齐四段逐个点过 | `button[data-prop="text-align"]` 没了 |
| `acceptance-panel.mjs:155-160` | **AC-6.9d** 「更多」展开后 text-transform / text-decoration-line | `.typo-more` 没了 |
| `acceptance-panel.mjs:177-178` | **AC-6.10c** 在 `#rich` 上写 `color` | 文字色行同样按 `isTextElement` 判（`props-panel.element.js:1042`），`color()` 助手（`:46-51`）没有 null 守卫 → `TypeError` |
| `image-fill.mjs:91-94, 109-113` | 「内联 `<svg>` 仍有 Typography」 | **真实回归**，见【必须改】8 |
| `image-fill.mjs:62-63, 146-152` | 「普通容器的 color 沉底」（`.test-plain`） | `indexOf('color')` 变 -1，`length - 1` ≥ 0 → 失败 |
| `panel.mjs:116-133, 143-145` | line-height 从 normal 回落再步进（目标 `.curve-card`） | 不报红但**静默空转**：`nudge()` 走 `{skipped:true}`，两个断言真空通过，日志打 `字段=undefined 生效=undefined`；`:120-121` 的注释也变陈旧 |

变成真空通过、失去区分度（建议一并复核）：`panel.mjs:29-30`（`groups >= 5`，7→6 仍成立）、`image-fill.mjs:96-107`（`<img>` 的两条断言现在对所有容器都成立）。

不受影响：`typography.mjs:56-120, 123-218`（目标是 `.card-title` / `.card-body` / `#font-probe`，都是真文字元素）、`acceptance-popover.mjs:20-26`（目标 `.card-title`，`fixture.html:35` 是 `<h2 class="card-title">Original Thinking</h2>`，有直接文本节点——**方案 §2.6 说「`acceptance-popover` 6.25 的字体下拉用例改选一个文字元素」这句是多余的，它本来就是**）、`acceptance-panel.mjs:463-475`（AC-6.15 用 `#txt`）、`controls.mjs:178-233`（`#c-probe` 有 `textContent='色'`）、`acceptance-ui.mjs:36-43` 与 `resizing.mjs:198`（`unfoldAll` 遍历现存 section，且目标是文字元素）。

### (B) 退掉变量菜单

| 文件:行 | 用例 | 原因 |
|---|---|---|
| `acceptance-panel.mjs:282-291` | **AC-6.24b** 菜单内滚动不关 | 经 `section[data-group="fill"] .var-btn` 开菜单并量 `#visual-revise-menu` 的框，两者都没了 → 走 else 分支硬判 false |
| `acceptance-panel.mjs:293-296` | **AC-6.23c** Fill 有「绑定变量」、Effects 没有 | 断言 fill 里 `.var-btn` 数量 === 1，而这正是被替换掉的入口 |
| `acceptance-panel.mjs:303-306` | **AC-6.24b2** Esc 关菜单 | 变成真空通过，断言失去意义 |
| `acceptance-panel.mjs:307-317` | **AC-6.24e** 变量菜单按类型过滤 | 读 `document.getElementById('visual-revise-menu').shadowRoot.children` → null |
| `acceptance-panel.mjs:319-343` | **AC-6.24c** 绑定后是 chip、不再有可编辑色值框 | 绑定动作靠点 `#visual-revise-menu [data-item]` 完成 → `count() === 0` → 硬判 false |
| `acceptance-panel.mjs:320-322, 344-349` | **AC-6.24d** unlink 用解析值顶替 var() | 同一个 else 分支；`:346` 要点的 `[data-unlink]` 也只有绑定成功后才渲染 |
| `acceptance-panel.mjs:398-420` | **AC-6.24i** 点 chip 重开菜单、当前项勾着、对勾在最右 | `menuRows === null`；还编码了 `checkAt` 的版式 |
| `acceptance-panel.mjs:421-423` | **AC-6.24j** 菜单项最左是 16px 色圈 | 读菜单行的 `data-swatch` 子节点 |
| `acceptance-panel.mjs:425-435` | **AC-6.24i2** 从菜单挑别的变量换绑 | `accentRow` undefined |
| `acceptance-popover.mjs:61-68` | **AC-6.26a/b/c** 打开 / 在视口内 / 菜单内滚动不关 | 经 `.var-btn` 开 `#visual-revise-menu` |
| `acceptance-popover.mjs:69-74` | **AC-6.26d/e** 滚到底最后一项可见 / 选中生效并关闭 | 点 `#visual-revise-menu > div` 里的 `--c39`，断言 `.card-title` 的 `color === 'var(--c39)'` |
| `acceptance-popover.mjs:75-77` | **AC-6.26f** Esc 关闭 | 同一个菜单 |
| `acceptance-popover.mjs:79-143` | **AC-6.27a–e / AC-6.28a–e / AC-6.30** | **连锁**：`:82` 要点 AC-6.26e 绑出来的 `[data-unlink]` 才能拿到 `vr-color`。绑定没发生 → `[data-unlink]` 不渲染 → click 超时 → 色盘、填充弹层、页面 CSS 隔离三段全部陪葬 |
| `fill.mjs:69-73, 90-96` | 填充弹层四个标签的全等断言 | 加了 `Custom \| 变量` 之后 tab 集合变化 |

不受影响（都是 `openMenu` / `openPopover` 的其它消费者，保留）：`acceptance-panel.mjs:205-209, 210, 219, 277`（`addFx` / Effects 添加菜单）、`acceptance-ui.mjs:280-286, 406-409`（同上）、`resizing.mjs:77-79, 85, 93, 107, 135, 156, 176, 219, 342-347`（尺寸模式菜单；其中 `:339-347` 断言尺寸菜单里**没有**「使用 CSS 变量」项，方向与本方案一致）、`grid.mjs:64-73, 86-88, 100, 147, 156`（网格点阵弹层）、`controls.mjs:48` 与 `figma.mjs:22`（是 `visual-revise-**select**-panel`，另一个弹层）。另外 `acceptance-panel.mjs:352-396`（AC-6.24f / f2 / g / h）只验样式表 var() 的 **chip 显示**，只要 `.var-chip` / `[data-unlink]` 的渲染保留、只换入口，就不受影响。

**汇总**：`tests-e2e/all.mjs:3-12` 的套件清单里，`typography` / `figma` / `panel` / `image-fill` / `fill` / `acceptance-panel` / `acceptance-popover` 七个中的**六个会变红**（`fill` 只在加 tab 后才红）。

---

## 总评

**不能按现状执行。**

- §2.5（Typography 只给文字元素）方向正确，除【必须改】8 的 svg 判定要换个谓词、【必须改】9 的 PRD 条目要一起改之外，基本可落地。
- §2.1 / §2.3（抽共享弹层、统一入口）方向对，但漏了三处耦合：弹层嵌套的外点关闭判定（【必须改】11，一个从没被测过的现存 bug）、滚动关闭与 `data-menu-open` 的 CSS 依赖（【必须改】10）、写入回调缺 render/toast（【必须改】12）。
- **§2.2 和 §2.4 是两处方向性错误**：前者整个建立在「`parseFills` 能看到 `var()`」这个不成立的前提上（它读的是 computed，`var()` 早已被解析），而且即便读到了，`#writeBackground` 的全量重写也会把绑定抹掉（【必须改】5、6）；后者的 important 判定条件在第二次写入时就自我否定（【必须改】1），还放错了层——把 undo/redo 的重放原语变成了依赖当前样式表的非确定操作，并给每次写入都加上一次全表选择器匹配（【必须改】2），导出/导入的后缀方案还会产出非法简写和静默 no-op（【必须改】3）。
- §2.6 的 AC-6.31a 与 §3「不做阴影变量」以及 PRD AC-6.23c 三方打架，而且 box-shadow 在现有 parse/serialize 模型下**技术上就绑不住**（【必须改】4）。
- 最后，整个方案的核心交付物「变量页」的数据源 `cssVariables()` 覆盖不全（【必须改】7），在用 `@layer` / `@media` / 容器作用域组织 token 的页面上会直接空白——这也很可能是 §2.7 想验证的那个现象的真因。

**建议的返工顺序**：先重写 §2.2 的层级绑定读写模型（读原文 + 层带 `bound` 字段）与 §2.4 的 priority 存储位置（挪到 `applyProp` + 进 history op），再处理 §2.6 与 §3 的自相矛盾，最后补 `cssVariables` 的覆盖面。这四项定下来之后，§2.1 / §2.3 / §2.5 才是可以并行推进的实现工作。

---

## v2 增量评审

只针对 v2 新引入的设计做核对。v1 的 13 条必改与 6 条建议已确认吸收，方向性问题（important 挪进 `applyProp` 并进历史、层读原文 + `slot`、`declaredVariables`、svg 保留、效果面板不给变量页、`SIBLING_PANELS` + `data-menu-open`）都改对了，以下全部是新设计的落地细节。

### 【必须改】

**v2-1. §2.1 `afterImportant` 的 `before === ''` 门槛太窄，原 bug 换个入口照样复现**

方案：`afterImportant = forced ?? (beforeImportant || (before === '' && !!winningDeclaration(el, prop)?.important))`。

代码事实：这个条件把「要不要问层叠」代理成了「inline 是不是空的」。漏掉的场景是**页面自己写了 inline（不带 important）、样式表又有 important**——`<p style="color:red">` + `.x { color: blue !important }`。此时 `before === 'red'` 非空、`beforeImportant === false` → `afterImportant` 恒为 `false` → 面板写入永远压不过样式表，正是 §1 要修的那个静默失败。

同一个洞还会传染给三处「存原文再写回」：`#toggleSection`（`props-panel.element.js:2032`）、`#toggleLayer`（`:1215`）、`#toggleTextColor`（`:1256`）存的都是 `el.style.getPropertyValue(p)`（不带 priority），关闭时写 `transparent` 走 `applyProp` → 同样算不出 important → **眼睛按钮在这类元素上点了没反应**。

改：把「这条属性在样式表里的赢家是否 important」按 `(el, prop)` 算一次并缓存，而不是用 `before === ''` 当代理。`applyProp` 开头已经 `track(el)`（`change-store.js:767`），snapshot 是现成的挂载点（`snapshots` map，`change-store.js:214+`）——在 snapshot 上放一个 `sheetImportant: Map<prop, boolean>`，第一次问、之后复用；页面样式表变了的极端情况由 `cascade.js` 自己的 50ms 缓存兜不住，但那和现状一致。顺带把上面三处的 restore 结构也改成 `{ value, important }`。

**v2-2. §2.1 历史合并只更新 `after`，`afterImportant` 会被粘住**

代码事实：`history.js:43` 的合并分支是
```js
last.ops[0].after = ops[0].after
last.time = Date.now()
```
`mergeable`（`history.js:29-35`）对同 el 同 prop、400ms 内的连续 `prop` op 合并。新增字段不跟着更新，就会保留**第一次**写入的 `afterImportant`。

改：`last.ops[0].afterImportant = ops[0].afterImportant` 一起更新（`before` / `beforeImportant` 保留最早那次，语义不变）。

**v2-3. §2.1「`replayOnto` / `reconcile` 从记录里取 `afterImportant`」搞错了数据源**

代码事实：这两条路**不读 history op**。`reconcile`（`change-store.js:650`）走 `rebindSnapshot`（`:543`）→ `captureLive`（`:503-507`）→ `replayOnto`（`:509-523`），而 `captureLive.props` 来自 `readInline(snap.el)`（`snapshot.js:80-87`），`replayOnto` 的写入是 `for (const [prop, value] of Object.entries(live.props)) writeProp(el, prop, value)`（`:512`）。

改：priority 要从 `readInline` 这一侧带出来（返回并行结构或改成 `{ value, important }`），`captureLive` 原样透传，`replayOnto` 按它调 `writeProp(el, prop, value, important)`。方案里「`replayOnto` / `reconcile`：同样从记录里取 `afterImportant`」这句要改写；`reconcile` 本身完全不碰 `writeProp`，不该单列。

**v2-4. §2.1「`restoreAll` 经 `writeProp(el, prop, value, important)`」是错的，照做会造成回归**

代码事实：`captureAll` 存的是整串 cssText——`change-store.js:71` `{ el, cssText: snap.el.getAttribute('style'), attrs }`；`restoreAll` 是 `el.setAttribute('style', cssText)`（`:93`）。**cssText 本来就完整保留 `!important`**，而且它还能还原 `TRACKED_PROPS` 之外的属性。改成逐属性 `writeProp` 会把未跟踪属性丢掉，是净损失。

改：这条删掉，改成「`captureAll` / `restoreAll` 无需改动（cssText 天然带 priority）」。同理 `revertProp`（`snapshot.js:211-220`）已经用探针的 `getPropertyPriority` 还原，也无需改动——v1 评审里已确认过，v2 又把它们写进了改动清单。

**v2-5. §2.1 SCHEMA 升版要改两处常量，并会挂掉两个测试（其中一个不在影响面清单里）**

代码事实：`json-io.js:12` `export const SCHEMA_VERSION = 3`，`:15` `const SUPPORTED = new Set([1, 2, 3])`——升到 4 必须两处都改，只改前者会导致自己导出的文件自己不认。

会挂的断言：
- `tests-e2e/acceptance-export.mjs:152-153`：`data.schema === 3`
- `tests-e2e/advanced.mjs:121`：`exported.schema === 3`

`advanced.mjs` **不在 §4 影响面清单里**，要补上。（`advanced.mjs:172` 那份 `schema: 1` 的旧版本夹具只要 1 还在 `SUPPORTED` 里就不受影响。）

**v2-6. §2.2 `winningDeclaration(el, 'background-image')` 在 `background` 简写下拿不到原文**

代码事实：`cascade.js:18-26` 的 `SHORTHANDS` 只有
```js
'background-color': ['background'],
'border-color': ['border'],
...
```
**没有 `'background-image'` 这一项**。含 `var()` 的简写在 CSSOM 里对长手返回空串，`declIn`（`cascade.js:155-162`）先试 `background-image`（空）→ 没有简写可回落 → 返回 `null`。页面只要写的是 `background: linear-gradient(var(--a), var(--a)), url(x.png)`（很常见），`bindFills` 就一层都认不出来。

改：(a) `SHORTHANDS` 补 `'background-image': ['background']`；(b) 注意回落到简写之后，顶层逗号切出来的每一段是完整的 `<bg-layer>`（image 和 position / size / repeat / attachment / origin / clip 混在一段里），「第 `slot` 段是不是 `linear-gradient(var(--x), var(--x))`」不能对整段做匹配，要先从该段里摘出 `<image>` 部分。方案里「原文按顶层逗号切分 → 第 `slot` 段若是 …」这句只对长手成立，要补上简写分支。

**v2-7. §2.2 隐藏层的侧存储会把 `bound` 丢掉**

代码事实：`props-panel.element.js:1133` 是显式白名单，只留两个字段：
```js
all.forEach((l, at) => { if (l.hidden) hidden.push({ at, layer: { kind: l.kind, value: l.value } }) })
```
再插回时是 `{ ...layer, hidden: true }`（`:1121-1122`）。所以「隐藏层存在侧存储里的是层对象，带着 `bound` 走」在当前代码下不成立——眼睛一关一开，绑定就没了。

改：`hidden.push({ at, layer: { ...l, hidden: undefined } })`，跟旁边 `#writeEffects` 的写法（`:1172`）对齐。

**v2-8. §2.2 层级 chip 缺 unlink 与拖拽两条线**

三处都要动，方案只提了 chip 的属性名：

1. **unlink**：`#renderBoundRow`（`:1494-1506`）写死 `data-unlink="${prop}"`，而 `#unlink(prop)`（`:1510-1522`）做的是把 `getComputedStyle(el).getPropertyValue(prop)` 整条写进 inline。对填充层来说，这会把整条 `background-image`（所有层）拍平成解析后的字符串。AC-6.32c 写了「unlink 后变回解析色」，实现路径没交代。需要一条 `#unlinkLayer(i)`：清掉该层的 `bound` → `#writeFillLayers`。
2. **圆点颜色**：`#renderBoundRow` 的色点取 `this.#computed[prop]`（`:1495`）。层级要取该层的解析色，签名得参数化（现在只有 `(prop, binding, tail)`）。
3. **拖拽**：绑定行是 `<div class="layer-row bound">`（`:1496`），**没有 `data-fill-row`**；`#bindRowDrag('fill')` 按 `[data-fill-row]` 收集 rows（`:1375-1376`），命中落点也只在 rows 里找（`:1401-1406`）。结果是绑定层既不能拖、也不能当落点。补上 `data-fill-row="${i}"` 之后又会引出新问题：`:1386` 的守卫只挡 `.icon-btn`，`.var-chip` 不是 `.icon-btn`（`:1497`），手抖超过 `DRAG_SLOP`（4px，`:121`）就变成重排而不是打开弹层。改：守卫里加 `e.target.closest('.var-chip')` 也 return。

**v2-9. §2.6「已绑定 chip（填充层）→ 填充弹层变量页」在 §2.2 的渲染下打不开**

代码事实：填充弹层是 `VrFill` 的**实例方法** `#toggle()`（`fill.element.js:280-307`），全部状态挂在实例上（`#tab` / `#grad` / `#stop` / `#host` / `#panel` / `#picker`，`:126-133`），模块外没有任何入口。而 §2.2 把绑定层整行换成 `#renderBoundRow` 的 chip——**行里没有 `vr-fill` 实例**，chip 的点击无处可去。

改：二选一，方案要明确写死。
- (a) 绑定行里保留一个 `vr-fill`（外观换成 chip 样式，或让 `vr-fill` 自己在有 `bound` 时把触发器渲染成 chip），点击仍走它自己的 `#toggle`；
- (b) 像 `openColorPopover` 那样把填充弹层也抽成模块级 `openFillPopover(anchor, {...})`。
(b) 的工作量远大于 (a)，而 §4 的影响面按 (a) 的规模写的。

**v2-10. §2.2 `bindFills` 要用的 `sameColor` 目前不可复用**

代码事实：`sameColor` 是 `props-panel.element.js:109-112` 里的模块私有常量，没有 export。而方案要求 `bindFills`（放在 `fills.js`）「每个 `bound` 都要过 `sameColor` 核对」。

改：把它挪到 `picker.js`（`parseColor` 就在那里，`:45-61`）或 `fills.js` 并导出，props-panel 改为引用。依赖方向没问题：`fills.js` 现在引 `gradient.js` / `effects.js` / `picker.js`，再引 `cascade.js` 不成环（`cascade.js` 不 import 本仓任何模块）。

**v2-11. §2.4/2.5 用 `variables` JSON 属性传列表，代价和副作用都不划算**

代码事实：
- 面板是一次性拼 `root.innerHTML`（`props-panel.element.js:497-500`、`:532`）。一个页面几十个颜色变量的 JSON，会被序列化进 HTML **每一个** `vr-color` / `vr-fill` 上（文字色 1 个 + 描边色 1 个 + 每个填充层 1 个），同一份数据重复好几遍。
- `vr-color` 的 `observedAttributes` 现在只有 `['value']`（`color.element.js:48`）。要让新属性生效就得加进去，而 `attributeChangedCallback`（`:69-72`）会跑 `#renderTrigger()`——整块重建 shadow DOM 并重绑两个 change 监听（`:86-141`）。`vr-fill` 同理（`:134`、`:154-156`）。

改：不要走属性。改成「打开时回问」——`.swatch` 点击时先派发一个 `vr-color-open` 事件（或由面板在 render 之后给实例挂 `el.variablesProvider = () => this.#colorVariables()`），面板同步填 `variables` / `bound` 再开弹层。零序列化、零额外 `attributeChanged`，也天然拿到最新数据。

---

### 【建议】

**v2-b1. AC 编号无冲突，但 AC-6.26 的 PRD 条文要一起改。** `docs/PRD.md` 现有最大编号是 AC-6.30（`:198`），6.31–6.35 全部空闲，§2.8 的新编号可用。不过 AC-6.33 把「AC-6.26 改挂到 Effects 添加菜单」写进了验收项，PRD 里 AC-6.26 的条文本身（`docs/PRD.md:193`）也要同步改写，别只改测试。

**v2-b2. §2.3 的导出方案是安全的（已核对）。** `flatten` 是模块私有（`cascade.js:105`），方案只导出 `declaredVariables`、不导出 `flatten`，这个选择是对的。`cssVariables` 目前只有两个消费者：`props-panel.element.js:29 / :1598`（本次要删）和 `visual-revise.js:21 / :625`（挂到 `api.lib` 供调试与测试）；`resizing.js` 自己不使用它，**没有任何代码或测试依赖「只列 `:root`」的行为**（`tests-e2e` 全文检索无 `cssVariables`）。唯一的语义变化是 `api.lib.cssVariables()` 会开始返回容器作用域的变量。建议换实现时顺手改名为 `declaredVariables`，在 `api.lib` 里保留旧名做别名。

**v2-b3. §2.3 的缓存要写清两层叠加。** `cascade.js` 自己已有 50ms 的 flatten 缓存（`:102-107`），再叠一层「按 target 缓存到本次 render 结束」之后，用户在 DevTools 里改样式表最长要等 50ms + 一次 render 才反映。可接受，但请在注释里写明，免得后来人当 bug 排查。

**v2-b4. §2.5 的 `vr-fill-variable { layer, name }` 里 `layer` 可以省。** 面板侧已经从 `e.currentTarget.dataset.layer` 取下标（`props-panel.element.js:2297`），事件再带一份就多了一个可能不一致的来源。

**v2-b5. §2.7 的 dirty 查询可行，但 `showTypography` 不能放在 `controls.js`。** `#dirtySet()`（`:382-387`）返回 `Set<prop>`，`#refreshDirty` 已经在用 `group.props.some(p => dirty.has(p))`（`:465`）这个形状；而且 `render()` 在 `:495` 先算好 `this.#dirtyProps`、`:497` 才拼 HTML，所以 `#renderGroup` 里直接读 `this.#dirtyProps` 就是新鲜的（别再调一次 `#dirtySet()`）。但正因为它要读面板状态，`showTypography` 只能是 props-panel 的方法，不能是 `controls.js` 里的纯函数——§2.7 标题写的「`props-panel`、`controls.js`」要收敛成「判定在 props-panel，`isTextlessElement` / `isTextElement` 继续从 `controls.js` / `dom-utils.js` 引入」。

**v2-b6. §2.6 的「`#syncValues` 对绑定态的格子不回写」是句空话。** 绑定态渲染的是 `span.var-chip`（`#renderBoundRow:1497`），本来就没有 `[data-prop]`，`#syncValues` 的循环（`:399`）根本扫不到。顺带一提：`#syncValues` 里的 `VR-FILL` 分支（`:400-405`）目前已是死代码——每层的 `vr-fill` 带的是 `data-layer` 不是 `data-prop`（`:1542`），而唯一带 `data-prop` 的 `#renderWidget('fill')`（`:1706`）被 `:1061` 的 `group.id === 'fill' ? [] : group.widgets` 排除了。要不要顺手清掉，方案可以定个调。

**v2-b7. 只翻转 important、值不变的写入不会进改动记录。** `diffSnapshot`（`snapshot.js:133-147`）只比 value。页面自带 inline `color: rgb(0, 0, 0)`、面板把它改成带 important 时，画面变了但改动列表和导出里看不到，undo 也无从下手。建议把 important 一起纳入 `diffSnapshot` 的比较口径（这和 §2.1「change 记录加 `important` 字段」是同一处改动，顺手做掉即可）。

**v2-b8. §4 影响面漏两处。** `tests-e2e/advanced.mjs`（schema 断言，见 v2-5）；`docs/plans/feature-inventory.md`（§2.11 变量绑定、§3.4–3.6 色盘/填充弹层的描述会随本次改动失效——本方案自己在顶部关联了它）。

---

### 总评

**不能执行**——v2 的设计方向已经全部正确，但 v2-1（important 判定门槛太窄，原 bug 换个入口就复现，还会连带打断三处眼睛按钮）、v2-6（`background` 简写下拿不到原文，`bindFills` 整条链路失效）、v2-9（填充层的绑定 chip 根本打不开填充弹层）这三条会让对应功能直接不工作，把上面 11 条落进方案后即可执行。
