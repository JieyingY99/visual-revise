# 全量 e2e 测试报告（2026-09-07）

> 关联：测试集按 [feature-inventory.md](feature-inventory.md) 的功能点编号构造，每个编号至少一条真实交互断言；
> 套件在 `tests-e2e/full/*.mjs`，`node tests-e2e/full/all.mjs` 跑全部；bug 复现脚本在 `tests-e2e/full/verify/`。
> 本轮改动的方案：[color-picker-variables.md](color-picker-variables.md)。

## 1. 总览

| 项 | 数 |
|---|---|
| 功能点（清单编号） | 399 |
| pass | 346 |
| fail（应用问题，断言原样保留） | 17 |
| not_testable（无头环境做不到，见 §4） | 5 |
| 应用 bug：报出 / 独立复现为真 / 被推翻 | 28 / 27 / 1 |
| 派出的 agent | 40（12 个测试 + 28 个复现），全部 opus |

说明：`select-handles-text` 分块的 agent 没有逐编号回填 results（31 个编号、88 条断言、79 通过 / 9 失败都在套件里），总览里该块按套件计。

## 2. 分块结果

| 分块 | 清单章节 | 功能点 | pass | fail | not_testable | 断言 通过/失败 | bug 真/假 |
|---|---|---|---|---|---|---|---|
| `toolbar` | §1 | 48 | 45 | 1 | 2 | 96 / 1 | 0 / 1 |
| `panel-head-position` | §2.1–2.4 | 38 | 36 | 1 | 1 | 150 / 2 | 2 / 0 |
| `layout-appearance` | §2.5–2.6 | 20 | 16 | 4 | — | 115 / 5 | 4 / 0 |
| `typography-fill` | §2.7–2.8 | 23 | 22 | 1 | — | 95 / 1 | 1 / 0 |
| `stroke-effects` | §2.9–2.10 | 12 | 10 | 2 | — | 88 / 4 | 2 / 0 |
| `variables-grid` | §2.11–2.12 | 20 | 20 | — | — | 41 / 0 | 0 / 0 |
| `tree` | §2.13 | 19 | 18 | 1 | — | 73 / 1 | 1 / 0 |
| `popovers` | §3 | 63 | 62 | 1 | — | 181 / 1 | 1 / 0 |
| `select-handles-text` | §4.1–4.3 | 31 | — | — | — | 79 / 9 | 9 / 0 |
| `drag-guides-upstream` | §4.4–4.6 | 35 | 32 | 3 | — | 143 / 3 | 3 / 0 |
| `history-changes` | §5 | 34 | 32 | 2 | — | 70 / 2 | 2 / 0 |
| `export-comments-misc` | §6–7 | 56 | 53 | 1 | 2 | 146 / 2 | 2 / 0 |

## 3. 核实为真的应用 bug（27）

每条都经独立 agent 用最小脚本稳定复现（连跑两次），并核对过 PRD / 代码注释不是有意设计。按严重度排。

### B01 [high] 4.4.1 layout-drag 不处理 pointercancel：浏览器把手势升级成原生拖放后，这次拖拽永远收不了尾

- 分块：`drag-guides-upstream`　位置：app/core/layout-drag.js:245
- 复现：1. serve() 起 tests-e2e，打开 /full/fixtures/drag-guides-upstream-drag.html，injectVisBug。
2. 按 Escape 清掉选中。
3. 量 #pic（一张普通 <img>，父级是 #pics，canDrag 为真）与 #empty 的位置。
4. page.mouse.move 到 #pic 中心 → page.mouse.down() → 以 2px 为步长连续 move 到 +10px（每步 sleep 40ms）。这样 layout-drag 会先在 4px 处 beginDrag，浏览器随后才在自己的阈值上发 dragstart。
5. 此刻读状态：window.__visualRevise.layoutDrag.dragging === true、#visual-revise-drag-ghost 存在。
6. page.mouse.move 到 #empty 中心（steps:8）→ page.mouse.up()，等 500ms。
7. 再读状态。

同一条时序在普通元素上也会随机命中：用 12 步一次跨 380px 的快拖在 fixture.html 的 .curve-card 上连跑 30 轮，约 1/30 的轮次会看到 dragstart → pointercancel → drop → dragend 而 pointerup 一次都不派发——tests-e2e/advanced.mjs 的「向后拖落在期望位置」偶发失败就是这条。
- 期望：松手后这一次拖拽必须收尾：layoutDrag.dragging 回到 false、拖影移除、源元素的 opacity 恢复、指示线与落点高亮清掉（提交或取消都行，但不能卡住）。
- 实际：pointercancel 之后 pointermove / pointerup 再也不派发给页面，endDrag() 永远不会被调用：dragging 一直是 true、#visual-revise-drag-ghost 一直浮在页面上、#pic 一直停在 opacity:0.25、#visual-revise-drop-indicator 与 [data-vr-drop-target] 也留着；因为 dragging 卡在 true，用户下一次按 Esc 会被当成「取消拖拽」吃掉，做不了取消选中 / 退模式那件本来的事。快拖命中同一分支时还会让一次本该成功的移动静默丢失（DOM 没动、moves=0、也没有任何提示）。
- 复现结论：复现成立，连跑 3 次结果完全一致、确定性命中（不是概率事件）。脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/drag-guides-upstream-4_4_1.mjs

主复现（#pic 是普通 <img>，浏览器默认 draggable）实际输出：
```
  [越过阈值后] dragging=true ghost=true #pic.opacity=0.25
  [移到 #empty 上] dropTargets=[pics] indicator=none
  [松手 + 500ms 后]
    dragging      = true
    拖影存在      = true
    #pic.opacity  = 0.25
    dropTargets   = [pics]
    store.moves   = 0
    #pics 子节点  = pic,p1　#empty 子节点 = (空)
    事件序列: pointermove → pointerdown → pointermove×2 → dragstart → pointercancel → drag → dragover → … → drop → dragend
  [事件面] dragstart=true pointercancel=true pointerup 从未派发=true
```
即：浏览器在 dragstart 后发 pointercancel，此后 pointermove/pointerup 一次都不再派发给页面，endDrag() 永不执行 —— dragging 卡 true、拖影留存、opacity:0.25 未复原、[data-vr-drop-target] 未清、这次移动静默丢失（moves=0，DOM 未动）。

我做了三组反证尝试，全部没能推翻：
- B) 对照组：同一套粗时序拖非 draggable 的普通 div #r0 → #empty，输出 `dragging=false ghost=false #r0.opacity=(空) moves=1`，事件序列是干净的 `pointerdown → pointermove×13 → pointerup → mouseup` —— 说明不是脚本时序/harness 的锅。
- C) 反向对照：同一个 <img> 改用现有测试的 3/7/12px 小步，输出 `dragging=false … moves=0`，事件序列同样 `dragstart → pointercancel`，只是 pointercancel 抢在 4px 之前、drag 压根没起来 —— 所以「小步不出问题」不是代码没坏，只是把这一支躲开了。
- 设计意图核对：docs/PRD.md 全文搜不到 pointercancel；AC-2.16 / AC-7.4 反而明确要求「中途 Esc 取消这一次拖拽，不留任何改动」。app/core/layout-drag.js:282-284 的注释自己写着「拖拽的收尾必须与是否提交移动分开：中途取消同样要解绑那几个捕获阶段的监听」——pointercancel 正是它漏掉的那种中断。唯一提到 pointercancel 的地方是 tests-e2e/full/drag-guides-upstream.mjs:9 的注释，那是测试侧的绕行说明（startDrag 小步 + dragToward 重试恢复），不是 PRD 里写明的有意设计。

另外发现比报告更重的一支（脚本 D2 段）：卡住之后用户只是普通点了一下别的元素，这次早已结束的拖拽会被 onPointerUp 用**当时指针下的落点**提交：
```
    [卡住] dragging=true moves=0 #pics=pic,p1 悬停落点=[pics]
    [点了一下 #r1] dragging=false moves=1
      #pics=p1　#row=r0,r1,r2　#empty=(空)
      #pic 的新父级=r1（拖之前是 pics）　selected=[pic]
```
即一次普通点击把 #pic 静默搬进了 #r1 —— 用户既没按下也没拖，DOM 就被改了并计入了一条 move 记录。报告里说的 Esc 连带损伤也复现（`[直接按 Esc] dragging true→false`，这一次 Esc 被 cancelDrag 吃掉，取消选中/退模式没发生）。
- 修法：在 app/core/layout-drag.js:245-247 的 onPointerDown 里跟 pointermove/pointerup 一起注册 `pointercancel`（捕获阶段，handler 调 `endDrag({ commit: false })`），并在 disarm() 里对称移除；同时在 armed/drag 期间对 `dragstart` 调 preventDefault，从源头挡掉手势被升级成原生 HTML5 拖放。

### B02 [high] 5.1.16 改动记录列表条目一多就不滚动，反而把每一行压扁到几像素

- 分块：`history-changes`　位置：app/components/change-list/change-list.element.css:65（.items 用 display:grid + align-content:start，隐式行是 auto）配合 app/components/change-list/change-list.element.css:69-75（.item{overflow:hidden} 让 min-height:auto 解析为 0，于是负剩余空间时行只按 min-content=0 的基准尺寸分配）；滚轮那侧的表现见 app/core/dom-utils.js:58
- 复现：1) node 起 tests-e2e 静态服务，打开 /full/fixtures/history-changes-lab.html 并注入 bundle；
2) page.evaluate: const s = window.__visualRevise.store; const ttl = document.getElementById('ttl'); for (let i = 0; i < 40; i++) s.addComment(ttl, `占位评论 ${i+1}`);
3) 点工具条 .list 打开改动记录；
4) 读 shadowRoot.querySelector('.items') 的 scrollHeight / clientHeight 与第一个 .item 的 getBoundingClientRect().height；
5) page.mouse.move 到 .items 中心后 page.mouse.wheel(0, 400)，再读 .items.scrollTop。
实测阈值：3 条时行高 65.5px 正常；12 条时已被压到 52.5px；40 条时 9.6~11.5px。给 .item 补一条 min-height: max-content 后 scrollHeight 立刻变成 756 > clientHeight 708，滚轮随即生效。
- 期望：条目总高超过可视区时 .items 出现纵向滚动（scrollHeight > clientHeight），每一行保持自然高度，滚轮在列表上滚动列表内容而不滚页面。
- 实际：scrollHeight 恒等于 clientHeight（708），列表永远不可滚动；行高被均分压缩（40 条时 9.6px，而光 .item-head 就要 35px），内容被 .item 的 overflow:hidden 裁掉，属性行与 × / ↺ 按钮都看不见也点不到。滚轮因为 containScroll 里 max = scrollHeight - clientHeight <= 0 直接 return，什么也不做（页面确实没被穿透，但列表也没滚）。
- 复现结论：复现成立，两次连跑输出逐字一致（脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/history-changes-5_1_16.mjs，真实 locator.click / page.mouse.wheel）。

我的实测输出：
- 3 条：{"scrollHeight":221,"clientHeight":221,"canScroll":0,"firstItemH":65.5}
- 12 条：{"scrollHeight":708,"clientHeight":708,"canScroll":0,"firstItemH":52.5}
- 40 条：{"scrollHeight":708,"clientHeight":708,"canScroll":0,"firstItemH":11.5,"firstItemScrollH":64,"firstHeadH":35,"delBtnHit":"div.item-head"}
scrollHeight 恒等于 clientHeight（708），容器计算样式 `grid auto start` —— 条目再多也永不产生滚动，负剩余空间全部摊到行高上。行内内容自然要 64px、光 .item-head 就 35px，被 `.item{overflow:hidden}` 裁掉。

用户可感知后果（不是纯数字）：40 条压扁态下用真实鼠标点第一条的 ×，「点前 40 条 → 点后 40 条，被删掉的是 #（无）（本该是 #1）」；同一份代码在 3 条正常态下点同一个按钮「点前 3 条 → 点后 2 条，被删掉的是 #1」。按钮中心的 elementFromPoint 命中的是 div.item-head 而不是按钮本身——即 5.1.12 / AC-8.2 的单条撤销与 AC-8.4 的评论删除在条目一多时点不到。滚轮：{"listScrollTop":0,"pageScrollY":0}，列表没滚、页面也没被穿透。

因果对照（运行时注入，未改仓库文件）：给 .item 补 min-height:max-content 后立刻 {"scrollHeight":756,"clientHeight":708,"canScroll":48,"firstItemH":65.5}，滚轮后 listScrollTop=48；摘掉补丁又回到 11.5 / canScroll 0。证明压缩来自 CSS 轨道尺寸，不是渲染时机或 containScroll 逻辑。dom-utils.js:58 那侧行为正确（preventDefault 生效、页面 scrollY 恒为 0），max<=0 只是果不是因。

不是有意设计：docs/PRD.md 全文没有把「行高压扁 / 列表不滚」写成设计（AC-2.15 对结构树明写「树可纵向滚动」，AC-8.1/8.2/8.4 要求逐条浏览与逐条撤销）；change-list.element.css:65 与 :69-75 对 grid / overflow:hidden 无任何注释解释；feature-inventory 5.1.16 的原意与 dom-utils.js:47-51 的注释「滚轮应该滚浮层而不是底下的页面…自行驱动滚动」都预设浮层自己能滚，且 9.2 缺口表已承认「改动列表与结构树的滚轮隔离没测」。
- 修法：给 app/components/change-list/change-list.element.css:65 的 .items 加 `grid-auto-rows: max-content`（实测 scrollHeight 变 2866 > 708、行高恢复 65.5、滚轮生效）；不要用报告建议的 .item{min-height:max-content}——实测 scrollHeight 只有 756 而单行已 65.5，说明行之间发生重叠。

### B03 [high] 2.5.14 两段式内/外边距的前缀拖拽只改输入框数字，一条声明都不写

- 分块：`layout-appearance`　位置：app/components/props-panel/props-panel.element.js:2605（手柄定义在 :1022）
- 复现：1) 打开固件 /full/fixtures/layout-appearance.html 并注入；2) 点击 #pad（inline style: padding:10px 20px）选中它；3) 在面板里定位 visual-revise-panel .prefix[data-drag][data-pair="padding:vertical"]，取 boundingBox；4) page.mouse.move 到该前缀中心 → mouse.down → 向右移动 40px（steps:8）→ mouse.up；5) 读 input[data-pair="padding:vertical"].inputValue() 与 document.getElementById('pad').style.paddingTop。
- 期望：拖 40px = 20 步 → padding-top / padding-bottom 都变成 30px，并进 ChangeStore。
- 实际：输入框显示 "30px"，但元素的 padding-top / padding-bottom 仍是 10px，改动记录里也没有这一条。根因：#renderSidePair 给前缀只挂了 data-pair、没有 data-prop（:1022），而 [data-drag] 的 pointerdown 处理器用 handle.dataset.prop 当属性名去 #commit（:2605），此处 prop 为 undefined，于是 ChangeStore.applyProp(el, undefined, '30px') 什么都没写；同一段代码里 displayValue(undefined, next) 又照常把新值刷进输入框，所以界面在说谎。展开四边后的输入框走的是另一条路径（data-prop 齐全），不受影响。
- 复现结论：复现成立，连跑两次输出逐字相同。我的脚本 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/layout-appearance-2_5_14.mjs（真实 page.mouse.down/move steps:8/up，无 element.click）对 #pad 拖 .prefix[data-drag][data-pair="padding:vertical"] +40px：

手柄属性        : {"pair":"padding:vertical","prop":"(无 data-prop)"}
拖之前 元素 inline: {"padding-top":"10px","padding-bottom":"10px"}  输入框 "10"  history 深度 0
拖之后 元素 inline: {"padding-top":"10px","padding-bottom":"10px"}  输入框 "30px"  history 深度 1
拖之后 改动记录   : []
拖之后 style 全文 : "padding: 10px 20px; margin: 5px 30px;"
[A] 输入框数字变了？ true   [B] 元素真的变了？ false ==> 界面与元素不一致（bug 成立）: true

两组对照排除了「手势没发出去」和「这个框本来就不该写」两种解释：
- 对照组 1（同一套 dragBy 用在有 data-prop 的 W 前缀）：width "" → "912px"，==> 对照组手势本身有效: true
- 对照组 2（同一个两段式框改用键入 "33"，走 input[data-pair] change 那条路）：{"padding-top":"33px","padding-bottom":"33px"}，==> 键入这条路正常: true

范围比报告写的更大：枚举面板里所有 .prefix[data-drag] 得到 padding:horizontal / padding:vertical / margin:horizontal / margin:vertical 四个手柄全部 prop:null，只有 width / height / font-size 有 data-prop——四个间距手柄同源于 #renderSidePair 的同一个 cell()，全坏。

另外报告漏了一点：history 深度 0 → 1，说明 applyProp(el, undefined, "30px") 仍然 push 了一条 history 记录（before "" ≠ after "30px"），只是 diffSnapshot 认不出这个属性名，所以改动记录列表是空的 []。结果是白白吃掉一次 ⌘Z——按一下撤销，页面什么都不会变。

「有意为之」的可能已排除，三处独立证据都指向「本该能拖」：docs/PRD.md AC-6.6 只写了两段式该分别写左右对 / 上下对，没有任何「前缀不可拖」的说明；docs/plans/feature-inventory.md:198 的 2.5.14 明写「前缀是横线 / 竖线图标、可拖」；props-panel.element.js:2588 的代码注释「两段式间距的标签管的是一对属性，输入框按 data-pair 找」本身就是作者为 pair 情形专门加的分支——他把「找输入框」这一半按 data-pair 补上了，却漏了「找属性名」那一半，是半成品而非设计。既有测试 tests-e2e/full/layout-appearance.mjs:490-493 也已经按「拖完 padding-top > 10 且上下相等」断言。

根因与报告一致：props-panel.element.js:1022 只给前缀挂 data-pair、没挂 data-prop；:2587 的 const prop = handle.dataset.prop 因此是 undefined，一路带进 :2602 stepValue(undefined, "10px", 20) → "30px"（照常算出值）、:2604 input.value = displayValue(undefined, next)（照常刷进界面）、:2605 #commit(undefined, next) → ChangeStore.applyProp(el, undefined, "30px") → el.style.setProperty("undefined", ...) 被 CSSOM 丢弃。界面在说谎。
- 修法：在 props-panel.element.js:2585 的 [data-drag] pointerdown 里，当 handle.dataset.prop 缺失时按 data-pair 解析出 SIDE_SETS[kind][dir] 两个属性，用 props[0] 驱动 stepSize/stepValue/displayValue，再在 #batch(SIDE_SETS[kind].label, …) 里对两个属性各 #commit 一次（照抄 :2219-2231 的 input[data-pair] change 那条路）；只给 :1022 补 data-prop 不行，因为一个手柄要写两条声明。

### B04 [high] 4.1.13 ⌘G / ⌘⇧G 改了 DOM 结构，却既不进改动记录也不可撤销

- 分块：`select-handles-text`　位置：app/features/selectable.js:312-340（on_group 全程只用原生 DOM API）；对照 app/core/change-store.js:1042 的 moveElement / removeElements 才是入账通道
- 复现：1. 打开固件，确认 window.__visualRevise.store.stats().total === 0 且 store.canUndo === false
2. 点 #b 中心选中，按 ⌘G
3. 读 store.stats() 与 store.canUndo
- 期望：结构性改动要么走 ChangeStore（记录里有一条、能撤销、能进提示词），要么这个快捷键被明确禁用
- 实际：stats().total 仍是 0、canUndo 仍是 false。分组 / 取消分组直接操作 DOM，完全绕过 ChangeStore.moveElement / history，用户改完的结构在导出的提示词里一个字都没有，⌘Z 也退不回来（⌘Z 反而会去撤销更早的一条无关操作）
- 复现结论：独立复现成功，连跑两次输出完全一致。脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/select-handles-text-4_1_13-record-undo.mjs（同目录已有另一个 agent 写的 select-handles-text-4_1_13.mjs 在测同编号的「兄弟顺序」问题，为不覆盖它我另起了文件名）。全程 page.mouse.down/up + page.keyboard.press，未用 element.click()；页面里跑的是最新构建（脚本打印 [环境] 构建于 = 2026-09-06T18:59:51.695Z，与 extension/toolbar/bundle.min.js 的 mtime 一致，晚于 app/features/selectable.js）。

我的脚本实际输出（两次相同）：
  A 基线                     : total = 0  canUndo = false
  B 真实点 #b 中心            : data-selected = ["b"]
  C ⌘G 改了 DOM 结构         : true （#b 的父节点 list → <div>；#list 子项 ["a","b","c","d"] → ["<div:[b]>","a","c","d"]）
  C ⌘G 后 total / canUndo    : 0 / false
  C ⌘G 后 moves / removals   : 0 / 0
  C ⌘G 后 提示词字数         : 0   ← lib.buildPrompt(store.read()) 返回空串，结构改动一个字都没进提示词
  D ⌘⇧G 后 total / canUndo   : 0 / false  提示词字数 0
  E 对照 Delete total/canUndo: 1 / true  提示词字数 815   ← 同为结构性操作、走 ChangeStore.removeElements 的路径一切正常
  F ⌘Z 退回分组              : false（⌘Z 后结构仍是 ["<div:[b]>","a","c","d"]）
  F ⌘Z 撤掉了无关的旧改动    : true （#solo background rgb(255, 0, 0) → (空)，stats.total 1 → 0）

F 段的做法：先用 store.applyProp（面板改属性走的同一入口）给 #solo 记一条正经改动（total=1、canUndo=true），再选 #b 按 ⌘G（total 仍 1、结构已变），再按 ⌘Z——分组纹丝不动，反而把 #solo 那条无关改动撤没了。报告里「⌘Z 反而会去撤销更早的一条无关操作」这句也成立。

「期望行为」不是报告者自己加的要求，是这个 fork 自己立的规矩：
- docs/PRD.md 全文搜「分组」只命中 AC-6.14（属性面板折叠分组）与 AC-8.1（改动记录按元素分组），跟 ⌘G 的 DOM 分组无关；没有任何一条把「⌘G 不进记录」写成有意设计。
- PRD AC-7.8 明写「移动可撤销：⌘Z 一次退回整次移动」——⌘G 本质就是把 #b 移进一个新 <div>，正落在这条 AC 的语义里。
- app/features/selectable.js:312-340 的 on_group 通篇无注释，没有任何「故意不入账」的说明；相反 app/core/visual-revise.js:257-260 对 Delete 明写「记录与删除必须是一件事」，E 段对照组也证明那条路径确实入账。
- docs/plans/feature-inventory.md:448 该条 AC 覆盖栏是「无」，:736 与 :773-775 把它列进「需要断言『要么进记录且可撤销，要么被明确禁用』」的缺口清单。

根因确认在报告指的位置：selectable.js:312-340 的 on_group 只用 createElement / appendChild / prepend / removeChild，完全不碰 ChangeStore；change-store.js 的 MutationObserver（:727-753）只负责 reconcile 重锚，不会把用户新做的结构改动补记成 move。
- 修法：让 on_group / ungroup 走 ChangeStore.moveElement（新 wrapper 的插入与子节点搬迁包在 history.batch 里，一次 ⌘Z 整体退回）；若分组本就不算这个 fork 支持的功能，就把 `${metaKey}+g,${metaKey}+shift+g` 从 selectable.js 的 HOTKEYS 清单里摘掉并同步解绑。

### B05 [high] 4.1.15 ⌘C / ⌘X 把 data-label-id 一起复制进 outerHTML，粘贴后缩放把手会去改错元素

- 分块：`select-handles-text`　位置：app/features/selectable.js:198-203、213-218（on_copy / on_cut 只剥 data-selected）；app/features/selectable.js:462-464（select() 用 handles.length 现发号，取消选中后从 0 重来）；app/components/selection/handle.element.js:38-43（$('[data-label-id=N]')[0] 取拖动目标）
- 复现：1. 打开固件，点 #a 中心选中（此时 #a 的 data-label-id="0"）
2. 按 ⌘C → window.copy_backup 是 <div class="item" id="a" style="" data-label-id="0">A</div>
3. Esc，点 #c 中心选中，按 ⌘V（副本粘成 #c 的子节点，带着 data-label-id="0"）
4. Esc，点 #d 中心选中（unselect_all 把 handles 清空，select() 的 id = handles.length 又从 0 发号，#d 也拿到 data-label-id="0"，页面上此时有 3 个 label-id=0 的节点）
5. 按住 #d 右边中点的把手向右拖 50px
→ #d.style.width 没变，#c 里那个粘贴副本的 width 变成 146px
- 期望：复制出来的 HTML 只含页面自己的内容；拖谁的把手就改谁
- 实际：on_copy / on_cut 克隆时只 removeAttribute('data-selected')，把 data-label-id 留在了 outerHTML 里；而缩放把手用 $(`[data-label-id="${id}"]`)[0] 按文档顺序取目标，撞号时取到排在前面的粘贴副本，于是缩放作用在一个用户没选中的元素上（且这次改动照样进改动记录，记在错的元素身上）
- 复现结论：独立复现成功，连跑 3 次输出完全一致（脚本 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/select-handles-text-4_1_15-labelid.mjs；同目录已存在的 select-handles-text-4_1_15.mjs 是另一个 agent 针对「⌘X 不进记录」写的，我没覆盖它，另起了文件名）。

先做了对照组排除「其实是没拖到把手」：干净页面上点 #d，在 (503, 439) 按下右中把手拖 +50px → 「[拖后] {"d_inline":"146px","d_box":135}」，同一套坐标确实能拖动 #d。

然后按报告步骤复现：
- 「[window.copy_backup] "<div class=\"item\" id=\"a\" data-label-id=\"0\" style=\"\">A</div>"」——同一次克隆已经剥掉了 data-selected，却把 data-label-id 留在了 outerHTML 里（on_copy 只 removeAttribute('data-selected')，selectable.js:198-203）。
- Esc 后 #a 的 data-label-id 变 null；选 #c 按 ⌘V →「[#c 里的粘贴副本] attrs:["class=\"item\"","id=\"a\"","data-label-id=\"0\"","style=\"\""]」，htmlStringToDom(DOMParser) 原样保留属性，副本带着 label-id=0 进了 DOM。
- Esc 后选 #d，select() 用 handles.length 从 0 重新发号（selectable.js:462-464，unselect_all 在 :499-519 把 handles 清空）→ label-id 全表按文档顺序是「div#a 父=c / div#d 父=list / visbug-handles 父=body」，全部 data-label-id=0。
- 把 handle.element.js:42 那句原样跑一遍：「命中 3 个：["div#a(父=c)","div#d(父=list)","visbug-handles(父=body)"]，它取的 [0] 是 div#a(父=c)」。
- 在同一坐标 (503, 439) 拖 #d 的右中把手 +50px →「[拖后] {"d_inline":"","d_box":96,"clone_inline":"146px","clone_box":146}」。#d 一点没动，被改宽的是 #c 里那个用户根本没选中的粘贴副本，数值 146px 与报告一字不差。全程无页面异常。

设计意图排查：docs/PRD.md 全文没有任何 ⌘C/⌘X/⌘V 元素级剪贴板的 AC（只有 AC-3.9 ⌘D、AC-3.10 ⌘⌥C/⌘⌥V 样式剪贴板），没有一句把「复制出来的 HTML 带编辑器内部记号」写成有意为之；docs/plans/feature-inventory.md:450 该条「覆盖」栏是「无」，:735 把 §4.2 把手列为零覆盖重点，:773-775 明确要求这类结构性 DOM 操作「要么进记录且可撤销，要么被明确禁用」。on_copy / on_cut 上下也没有任何注释解释为什么保留 data-label-id。所以不是有意设计。

对报告的一处修正（我推翻了它的括号内断言）：报告说「这次改动照样进改动记录，记在错的元素身上」——不成立，实际更糟。误改之后「[ChangeStore.edits] []、[store.stats] {"elements":0,...,"total":0}」，而对照组里正常拖 #d 是有记录的（「[{"id":"d","parent":"list","props":["width:undefined→undefined"]}]」）。原因是 ChangeStore.track() 只在 props-panel 锁定选中元素时调用（change-store.js:219-223、props-panel.element.js:317），粘贴副本从没被选中过就没有快照，于是这次误改静默发生：不进记录、⌘Z 救不回、导出给 AI 的提示词里也看不到。
- 修法：on_copy / on_cut 克隆后连同 data-label-id 等编辑器内部 data-* 记号一并剥掉（可复用 unselect_all 那份属性清单）；治本再加一层：select() 别用 handles.length 现发号，改成单调递增的唯一 id，并让 visbug-handles / handle 直接持有源元素引用，而不是每次用 $(`[data-label-id=N]`)[0] 按文档顺序猜目标。

### B06 [high] 2.10.3 噪点 / 纹理 / 玻璃高光的参数不从 CSS 回读，改第二个字段会静默把第一个改回默认

- 分块：`stroke-effects`　位置：app/core/effects.js:160（noise 推 {...DEFAULTS.noise}）、app/core/effects.js:161（texture 推 {...DEFAULTS.texture}）、app/core/effects.js:154（glass 硬写 highlight: 40）；消费方 app/components/props-panel/props-panel.element.js:1379（patch 里的 this.#effectList()）
- 复现：1) 打开 tests-e2e/full/fixtures/stroke-effects-main.html，注入编辑器，点选 #fx4；2) 展开 Effects，点加号选「噪点」；3) 点那一行打开参数弹层，把「颗粒」填 2 回车 —— 此时 inline background-image 里 baseFrequency='0.60'，正确；4) 不关弹层，接着把「密度」填 50 回车；5) 读 document.getElementById('fx4').style.backgroundImage：opacity 变成 '0.50'（对），但 baseFrequency 回到了 '2.40'（颗粒 0.5 的默认值），刚调好的颗粒被冲掉，而弹层里的「颗粒」框仍显示 2。纹理同理（#fx5：尺寸 8 → baseFrequency 0.13，再改强度 5 后回到 0.25）；玻璃的高光同理（#fx6：高光 80 → rgba(255,255,255,0.8)，再改模糊后回到 0.4）。
- 期望：参数弹层里每个字段各改一次后，先改的那个仍然生效——同一条效果的多个参数可以叠加调整（投影 / 内阴影 / 图层模糊 / 背景模糊 / 玻璃的 blur+saturate 都是这样）。
- 实际：噪点的 size/density/color、纹理的 size/radius、玻璃的 highlight 每次 patch 都从默认值重建：#effectPanel 的 patch() 用 this.#effectList() 拿当前列表，而 parseEffects 对这三类只推默认值（background-image 里的 baseFrequency/opacity/flood-color、box-shadow 里那道 inset 高光的 alpha 都没有被解析回来），于是上一次的改动在下一次写回时被覆盖。弹层不重绘，输入框里还留着用户刚敲的数，画面上却已经变回默认，没有任何提示。
- 复现结论：复现成立，连跑两次输出完全一致（4/6 项被冲掉，两个对照组都保住）。脚本 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/stroke-effects-2_10_3.mjs，全程真实指针 + fill/Enter。

噪点 #fx4：
  [改颗粒=2] baseFrequency = 0.60 （1.2/2=0.60 为正确）  opacity = 1.00
  [再改密度=50] baseFrequency = 2.40  opacity = 0.50
  [弹层里此刻显示] = {"size":"2","density":"50"}
  [行摘要] = ["噪点=100%"]
反向也一样（先密度后颗粒）：[再改颗粒=3] baseFrequency = 0.40  opacity = 1.00 —— 刚设的密度 0.50 回到默认 1.00。注意行摘要在写入 density=50 后仍是 100%，说明连面板自己的模型都已经丢了这个值，不只是 CSS。

纹理 #fx5：
  [改尺寸=8] baseFrequency = 0.13 （1/8=0.13 为正确）
  [再改强度=5] baseFrequency = 0.25  opacity = 0.50   ← 0.25 是尺寸 4 的默认值

玻璃 #fx6：
  [改高光=80] box-shadow = rgba(255, 255, 255, 0.8) 0px 1px 0px inset
  [再改模糊=25] box-shadow = rgba(255, 255, 255, 0.4) 0px 1px 0px inset  backdrop-filter = blur(25px) saturate(250%)
  [弹层里此刻显示] = {"blur":"25","saturate":"250","highlight":"80"}

两个对照组证明这不是「弹层 patch 整体坏了」，而是**只坏在读不回来的那几个字段**：
  [对照组 模糊=20 → 饱和=250] backdrop-filter = blur(20px) saturate(250%)   ✔ 保住
  [投影 X=9 → Y=13] box-shadow = rgba(0, 0, 0, 0.25) 9px 13px 4px 0px       ✔ 保住

代码侧与报告一致：#effectPanel 的 patch() 每次都用 this.#effectList()（props-panel.element.js:1377）重新从 CSS 派生列表，而 #applyToAll（:365）在每次写入后都刷新 #computed，所以列表确实是「最新的 CSS」——问题在 parseEffects 对这三类不解析参数：effects.js:160 `list.push({ type: 'noise', ...DEFAULTS.noise })`、:161 texture 同样、:154 glass 硬写 `highlight: 40`（data URI 里的 baseFrequency/opacity/flood-color、inset 高光的 alpha 全都没读回来）。blur/saturate/阴影四个数是真解析的，所以对照组正常。

不是有意设计：docs/PRD.md 只在 AC-6.12b 记了一条「已知限制」，说的是**跨属性顺序**还原不出来，与参数回读无关；AC-6.12a/6.12c/6.12d 与 feature-inventory §2.10.3（「数字框 change 时 parseFloat 校验后写入；改值不重绘」）都没有任何「参数只写不读」的说法，effects.js 里 parseEffects 上方的注释也只解释顺序问题。反倒是 effects.js:150 的注释「玻璃那条由 backdrop 侧统一还原」承诺了要还原高光，而 backdrop 侧写死 40，属于自食其言。
- 修法：让 parseEffects 真的把参数读回来（噪点/纹理从 data URI 反解 baseFrequency→size、rect opacity→density/radius、feFlood flood-color→color，玻璃从那条 inset 高光的 alpha 反解 highlight 而不是硬写 40），或者退一步让 #effectPanel 在弹层生命周期内持有自己的列表副本、patch 时基于副本而非每次从 CSS 重新派生。

### B07 [medium] 4.6.13 在上游 Search 输入框里打字会丢字符：a/f/v/c/l/p 被模式热键抢走

- 分块：`drag-guides-upstream`　位置：app/core/dom-utils.js:38
- 复现：1. 打开 /full/fixtures/drag-guides-upstream-tools.html 并 injectVisBug。
2. 按 ⌘/ 唤出上游工具条，点 search 按钮（激活后输入框自动获得焦点）。
3. page.keyboard.type('images')。
4. 读输入框的值：document.querySelector('vis-bug').$shadow.querySelector('li[data-tool="search"] input').value。
- 期望：输入框里应该是 images。
- 实际：输入框里是 imges——'a' 那一下被 Visual Revise 的 onKeydown 当成「切到 select 模式并把面板切到 props tab」的热键，preventDefault + stopPropagation 掉了。原因是搜索框活在 <vis-bug> 的 closed shadow root 里，事件的 composedPath() 到宿主 VIS-BUG 就断了，isTypingTarget 拿 composedPath()[0] 判 INPUT/TEXTAREA/contentEditable 一个都判不中，于是「用户正在输入」这道让路完全失效。同理 f / v / c / l / p 也会被吃掉（打 l 还会顺手开合改动记录面板）；search.js 自己在 input 上挂的 stopBubbling 救不了——Visual Revise 监听在 document 捕获阶段，比它早。
- 复现结论：复现成立，且不是有意设计。

我的脚本 `/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/drag-guides-upstream-4_6_13.mjs` 连跑三次，输出逐字相同：

```
✔ A 对照组：页面 light DOM 输入框里打 images → 框里是「images」
✔ search 激活后输入框拿到焦点（activeElement 就是它：true）
✔ <vis-bug> 的 shadow root 是 closed（element.shadowRoot === null：true）
✔ document 捕获阶段读到的 composedPath()[0] = VIS-BUG（target=VIS-BUG，路径长 5） → isTypingTarget 判 INPUT/TEXTAREA/contentEditable 一个都判不中
✘ B 复现组：上游 search 输入框里打 images → 框里是「imges」
· 被 preventDefault 掉的键：["a"]
· 打字后当前模式：select
· 逐键打进 search 框后框里的内容：{"a":"","f":"","v":"","c":"","l":"","p":"","b":"b","g":"g"}
✘ 每个字母都应原样落进输入框——被吞掉的：[a f v c l p]，正常的：[b g]
```

三条独立证据把因果链钉死：
1. **对照组排除了 search.js 自身的锅**——同一串 `images` 打进页面 light DOM 的 `<input>` 里一字不差，说明「打字时让路」这条通道本身是通的，只在跨 closed shadow 时断。
2. **机制被直接量到**——`<vis-bug>` 是 `attachShadow({mode:'closed'})`（app/components/vis-bug/vis-bug.element.js:45），从框里发出的 keydown 传到 document 捕获阶段时 `composedPath()[0]` 已经重定向成 `VIS-BUG`，`isTypingTarget`（app/core/dom-utils.js:37-45）只认 path[0] 的 INPUT/TEXTAREA/SELECT/contentEditable，一条都命中不了。`defaultPrevented` 探针也确实抓到了 `"a"`。
3. **被吞的字母集合与代码里的热键集合完全重合**——`a f v c l p` 全丢、`b g` 全过，正好是 visual-revise.js:290-325 里那六个（a/f → select+切 tab、v/c → MODE_KEYS、l → toggleList、p → doCopy）。search.js 在 input 上挂的 `stopBubbling` 救不了，因为 Visual Revise 注册在 `document.addEventListener('keydown', onKeydown, true)`（visual-revise.js:467），捕获阶段先跑。

**不是有意设计**：docs/PRD.md AC-4.2 明写「在输入框里打字时，单字母键不触发插件功能，字符正常输入」；visual-revise.js:228 的注释更是直接给了承诺——「单字母键在面板里没有任何语义，输入框由下面的 isTypingTarget 兜住」，这里正是那句话没兜住。docs/plans/feature-inventory.md 也没有把 §4.6 判死：9.3 只写「要么补测、要么明确决定把 ⌘/ 一并解绑」，没有做出解绑决定，而 AC-4.6 解绑的是那 13 个单字母**工具热键**，点按钮激活这条路仍是支持路径。同一类问题团队自己在别处已经修过（AC-6.30：弹层宿主上 keydown 止步，理由写的就是「按键冒到 document 时目标已是宿主 div，认不出在打字」），上游 vis-bug 宿主漏了这一手。

补充影响：被吃掉的键不是静静消失，而是顺手改了应用状态——打完 `images` 后模式被 `a` 切到了 select，`l` 会掀开/合上改动记录面板，`v` 会切进浏览模式并把焦点搬走。Search 文档里列的三个别名 `links` / `buttons` / `images` 全中招（只有 `text` 幸免）。
- 修法：在 app/core/dom-utils.js:37 的 isTypingTarget 里，先把 composedPath()[0] 这个宿主沿 shadow root（open 的用 shadowRoot、上游 closed 的用元素自挂的 $shadow）逐层下钻到真正的 activeElement 再判类型；或按 AC-6.30 已有的做法，在 &lt;vis-bug&gt; 宿主上给 keydown 加一道 stopPropagation 让它不冒到 document。

### B08 [medium] 7.2.10 评论参考图的错误提示被静默丢弃：图片超限时页面上没有任何反馈

- 分块：`export-comments-misc`　位置：app/core/visual-revise.js:558（只有 list 挂了 vr-toast）+ app/components/comment-layer/comment-layer.element.js:590,643-647（#addImages 报错走 #toast → dispatch vr-toast）
- 复现：1) node 起 tests-e2e 静态服务并注入编辑器（serve + injectVisBug，见 tests-e2e/harness.mjs）；2) page.evaluate(() => window.__visualRevise.setMode('comment'))，点 .curve-card 起草评论；3) 往 .editor 派发一个 paste：new File([new Uint8Array(6*1024*1024)], 'huge.png', {type:'image/png'})；4) 等 1.5s 后读 document.getElementById('visual-revise-toast')。
- 期望：图确实被拒（不进参考图清单），同时 body 上的 #visual-revise-toast 显示 error 型「图片过大（6.0 MB，上限 5.0 MB）」——这是 readImageFile 已经算好的原因文本，用户需要知道为什么选的图没进去。
- 实际：图被静默丢弃：参考图清单条数不变，#visual-revise-toast 始终为空/从未出现。用户点了「+」选了图，界面上什么都没发生，也没有任何解释。根因是 comment-layer 的 #toast() 派发的是冒泡 CustomEvent('vr-toast')，而宿主只在改动列表上挂了这个监听（visual-revise.js:558 `list.addEventListener('vr-toast', ...)`），评论层的这条事件没有任何接收方。同一条链路也影响 imagesFromDataTransfer 返回的其它错误（不支持的类型、读取失败）。
- 复现结论：复现成立，连跑三次输出完全一致。脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/export-comments-misc-7_2_10.mjs

对照 0（真实点「+」选 1×1 合法 PNG）：`[小图] 参考图 = {"refs":1,"names":["ok-shot.png"],"chips":1}` —— 加图链路本身是通的。

A（真实 locator.click 点「+」，filechooser 给 6.0 MB huge.png）：
`[6MB · 选文件] 参考图 = {"refs":1,"names":["ok-shot.png"],"chips":1}`（清单没变，图被拒）
`[6MB · 选文件] toast = {"exists":true,"text":"点击任意元素写下需求 · 可连续标注 · Esc 退出","opacity":"0","color":"rgb(255, 255, 255)"}`
`[6MB · 选文件] 冒泡到 document 的 vr-toast = [{"message":"图片过大（6.0 MB，上限 5.0 MB）","kind":"error","from":"visual-revise-comment-layer"}]`

B（报告原步骤，往 .editor 派 paste 6MB File）与 C（往气泡 drop 6MB）输出同上，三条入口 `==> B 复现? true`、`==> C 复现? true`，「三条入口都派出了 vr-toast 但没人接住 : true」。

需要纠正报告一处措辞：`#visual-revise-toast` 元素其实存在，但里面是进评论模式时那句旧提示且 `opacity:"0"`（已淡出）；超限报错那句文本从未被写进去、从未可见。用户看到的效果与报告一致——点了「+」选了图，界面上什么都没发生。

反证/对照排除了「toast 机制本身坏了」：
D（真实点工具条 .list 打开改动列表 → 真实点「导入」→ 选坏 JSON）：`[对照] toast = {"exists":true,"text":"不支持的文件格式（schema=nope）","opacity":"1","color":"rgb(255, 143, 143)"}`，`==> D ... true`。
E（同一条 CustomEvent 分别从两个元素派发）：`[探针 · list 派发] toast = {"text":"探针：来自 list","opacity":"1"}`；`[探针 · 评论层派发] toast = {"text":"","opacity":"0"}`，`==> E ... true`。

不是有意设计：comment-layer.element.js:588-590 的注释写明三个入口收敛到 #addImages「免得三处各写一份体积校验与错误提示」，且 docs/plans/feature-inventory.md 7.2.10 明写「体积限制：单张 5MB、会话累计 20MB，超限 toast 报错」；docs/PRD.md（AC-8.5）没有任何把静默丢弃写成有意为之的条款。根因与报告一致：comment-layer 的 vr-toast 冒泡到 document 无人接收，visual-revise.js:558 只在 list 上挂了监听（minified bundle 里同样只有一处 addEventListener("vr-toast")，与源码一致）。

附带修正：报告称同链路也影响「不支持的类型」——实际 image-assets.js readImageList 对非图片文件是 `continue` 静默跳过、根本不产生 error，所以经 pickImages/imagesFromDataTransfer 只有「图片过大」和「读取失败」两类 reason 会走到这条断链上。
- 修法：在 app/core/visual-revise.js:558 旁给评论层补一条同样的监听（`comments.addEventListener('vr-toast', e => toolbar.toast(e.detail.message, e.detail.kind))`），或干脆把这条监听提到 document/body 上，让任何组件冒泡上来的 vr-toast 都能被渲染。

### B09 [medium] 7.2.10 会话累计 20MB 上限（MAX_TOTAL）从未被执行，是一段死代码

- 分块：`export-comments-misc`　位置：app/core/image-assets.js:12（MAX_TOTAL 定义）与 :147（totalBytes 定义），二者在 app/ 下无任何引用；readImageFile 只在 :80-81 校验了单张 MAX_BYTES
- 复现：1) 同上进入评论模式并起草；2) 一次性派发 paste，DataTransfer 里放 5 个 new File([new Uint8Array(4_300_000)], `bulk-i.png`, {type:'image/png'})（每张 4.3MB，都低于单张 5MB 上限，合计 21.5MB）；3) 等 8s 后数 .refs 里的 .ref 条数并读 #visual-revise-toast。
- 期望：按清单 §7.2.10 与 image-assets.js:12 的注释，一次会话累计超过 20MB 应当拦下超出的图并 toast 报错。
- 实际：5 张全部收下（清单从 4 条涨到 9 条），没有任何提示，会话内 dataUrl 累计 21.5MB。grep 全仓可见 MAX_TOTAL 与 totalBytes 只在 image-assets.js 里定义、导出，没有任何调用点——上限从未生效。后果是内存与导出 JSON 体积不设防：这些 base64 会原样进 exportJSON 的 assets 字段。
- 复现结论：复现成功，连跑两次输出完全一致。我的脚本 tests-e2e/full/verify/export-comments-misc-7_2_10-max-total.mjs 输出：铺底 4 张小图后，一次 paste 派发 5 张 4.3MB（每张 < 单张 5MB 上限，合计 21.5MB），得到「[B] 参考图清单 4 → 9（新增 5 条）」「[B] 这一步新冒出的 toast 条数 = 0」，保存后「[落库] {"张数":9,"原始字节":21504096,"原始MB":20.51,"base64MB":27.34,"导出assets资产数":9,"导出assets里带dataUrl的":9}」——5 张全部收下，会话累计 20.51MB 已越过 20MB，且 9 份 base64 全部躺在 ChangeStore.allAssets() 里，而 json-io.js:62 的 `assets: ChangeStore.allAssets()` 会把它们原样写进导出 JSON，报告对后果的描述属实。

对照组证明观测手段有效、不是「守卫跑了但我没看见」：单张 6MB（超单张 5MB 上限）时「[A] 参考图清单 0 → 0 ==> A 单张上限拦住了（清单没涨）? true」——同一套 ref 计数在守卫真的触发时确实会不涨。

打包产物是第三条独立证据：脚本 fetch bundle.min.js 后得到「{"单张5MB_5242880":true,"累计20MB_20971520":false,"出现过totalBytes":false}」。rollup 把 MAX_TOTAL 与 totalBytes 整个 tree-shake 掉了——发布产物里根本不存在这两个符号，这只有在 app/ 下零调用点时才会发生。与静态 grep 一致：全仓 `grep -rn "MAX_TOTAL\|totalBytes"` 只命中 image-assets.js:12 与 :147 两行定义本身。

不是有意设计：docs/PRD.md 全文没有任何 5MB/20MB/体积上限/累计的表述，没有给出「故意不做」的理由；唯一的规格是 docs/plans/feature-inventory.md:641「体积限制：单张 5MB、会话累计 20MB，超限 toast 报错」，以及 image-assets.js:12 的注释「一次会话累计上限」。而且 comment-layer.element.js:586-587 的注释写着「图片入口有三个（选文件 / 粘贴 / 拖拽），收敛到这里，免得三处各写一份体积校验与错误提示」——说明作者本就打算在这个汇合点做体积校验，只是累计那一半从未写出来。

对报告方法的一处修正（不影响结论）：报告把「没有任何提示」当作证据之一，但这个观测量是被污染的——comment-layer.element.js:644 派发 vr-toast，而 visual-revise.js:558 只挂了 `list.addEventListener('vr-toast', …)`，评论层这一路没有任何监听方，所以即便 MAX_TOTAL 真的实现了、toast 同样不会出现（那是另一个缺陷，正被另一份 verify 脚本单独调查）。我因此以 ref 条数为准，结论不依赖 toast。
- 修法：在 image-assets.js 的公共汇合点 readImageList 里用已有的 totalBytes 逐张累加并与 MAX_TOTAL 比较（累计基数要含已入库资产、而不只是当前这一批），超出的图返回 ok:false + `已超出会话累计上限（${fmtBytes(MAX_TOTAL)}）` 塞进 errors；同时给 visual-revise.js 补上 `comments.addEventListener('vr-toast', …)`，否则这条错误依旧无人显示。

### B10 [medium] 5.3.2 「重置全部」之后 ⌘Z 救不回文案改动（记录数也悄悄少一条）

- 分块：`history-changes`　位置：app/core/change-store.js:69 captureAll() —— styles 里每个快照只存 { el, cssText, attrs }，没有 textNodes；app/core/change-store.js:92 restoreAll() 相应地只写回 cssText + attrs；而 app/core/change-store.js:985 的 snapshots.forEach(revertAll) 会经 app/core/snapshot.js:245 revertAll → revertText 把文案改回去，两边不对称
- 复现：1) 打开 /full/fixtures/history-changes-lab.html 并注入；
2) page.evaluate: const s = window.__visualRevise.store; const txt = document.getElementById('txt'); s.markEdited(txt); txt.childNodes[0].nodeValue = '被改过的文案'; s.touch();（顺带再造一条属性改动，便于对比）
3) 记下 s.stats()（texts=1）；
4) 点改动记录底部的「重置」（或 s.undoEverything()）——页面文案回到「原始文案」，total=0；
5) 失焦后按 ⌘Z。
实测：属性 / 换图 / 删除 / 移动 / 评论都回来了，唯独 texts 从 1 变 0，页面上仍是「原始文案」，stats().total 6/7。
- 期望：⌘Z 撤销「重置全部」把重置前的状态整体写回，包括文案改动——页面显示「被改过的文案」，stats().texts 回到 1，total 与重置前一致。
- 实际：文案改动有去无回：页面停在「原始文案」，texts=0，记录数比重置前少一条，而且这条改动此后再也找不回来（重做链也没有它）。误点重置就等于永久丢掉这次文案改稿。
- 复现结论：复现成立，但报告里「再也找不回来」一句说过头了，我用更严的场景才把数据丢失这部分坐实。

我的脚本 tests-e2e/full/verify/history-changes-5_3_2.mjs 跑两遍输出完全一致：

第 1、2 轮（照报告的合成 API 造文案改动）：
[1 改完] 文案=「被改过的文案」 texts=1 props=1 attrs=1 removals=1 moves=1 comments=1 total=6
[2 重置后] 文案=「原始文案」 total=0
[3 ⌘Z 后] 文案=「原始文案」 texts=0 props=1 attrs=1 removals=1 moves=1 comments=1 total=5 | 记录里的文案行 = []
→ 别的改动救回来了吗：是 / 文案救回来了吗：否 / total 5 / 重置前 6

第 3 轮我换成真实键盘输入（toolSelected('text') → contenteditable=true → keyboard.type），排除是 markEdited/touch 这套合成 API 的锅，结果一样：
[1 改完] 文案=「原始文案（改过）」 texts=1 … total=6
[3 ⌘Z 后] 文案=「原始文案」 texts=0 … total=5

**但第 3 轮同时推翻了报告的一句话**：真实打字会经 beginText/endText 留下一条独立的「改文案」历史（[3] 的 undoLabel 就是它），多按一次 ⌘Z 再 ⌘⇧Z 就能把文案捞回来：
[6 再往回一格] 文案=「原始文案」 … redo=改文案
[7 ⌘⇧Z 前进一格] 文案=「原始文案（改过）」 texts=1 … total=6
所以「重做链也没有它 / 此后再也找不回来」在一般情况下不成立，存在一条不直观的逃生通道。

**第 4 轮把丢失坐实**：history.js 的 HISTORY_LIMIT=100，满了 past.shift()。我先确认「改文案」确实入栈（depth=1 栈顶=「改文案」），再攒 99 条互不合并的历史，重置那一 push 把它挤出栈：
[2 重置后] depth=100 undo=重置全部改动
[3 ⌘Z 后] 文案=「原始文案」 texts=0 props=27 total=27，undo=border-top-width（「改文案」已不在栈里）
走遍整个历史栈（⌘Z 99 步到底 + ⌘⇧Z 100 步回顶）：任何一步出现过「原始文案（改过）」吗 → 否
两次执行一致。也就是说改稿改久一点、那条救命历史一旦老化出栈，误点「重置」+ ⌘Z 就是永久丢掉这次文案改稿。

**不是有意设计**：
- PRD AC-8.9「重置：清掉所有记录（含已失联的），页面恢复……⌘Z 能把这次重置连同移动一起救回来」，清单 5.3.1 明写重置会「还原全部样式 / 文案 / 属性」——文案是重置动到的东西，撤销重置就该把它写回。没有任何文档说文案被有意排除。
- captureAll 头上的注释自己写的是「存一份整体快照，撤销就是整体写回」，与实际行为矛盾。
- 代码内部三条快照-还原路径里，只有 all 这条漏了文案：captureElement（:1060 附近）存了 textNodes，applyOp 的 case 'element'（change-store.js:188-192）按长度守卫逐个写回 nodeValue，case 'text'（:203）也写；唯独 captureAll（:69）只存 { el, cssText, attrs }、restoreAll（:92）只写回 cssText + attrs，而 undoEverything（:985）的 snapshots.forEach(revertAll) 却经 snapshot.js:245 revertAll → revertText 把文案改回去，两边不对称。
- docs/plans/cross-container-reorder.md:86 有直接先例：同一类遗漏（moves 没进 captureAll/restoreAll）当初被判为 bug —「否则『重置全部』之后 ⌘Z 撤不回移动（AC-8.9 会假通过）」，修法就是给 captureAll/restoreAll 补上。文案只是没跟着补。

报告者对期望行为的理解与 PRD / 清单 / 代码注释一致；怀疑位置也准确。
- 修法：照 captureElement / applyOp case 'element' 的现成写法，给 captureAll 的每个 styles 快照补上 textNodes: textNodesOf(snap.el).map(n => n.nodeValue)，并在 restoreAll 里按「节点数相同才逐个写回 nodeValue」的守卫还原（snap.edited 无需额外处理，文案写回后 diffText 会自动让 texts 复位）。

### B11 [medium] 2.5.16 四边联动改一边会产生两条历史，一次撤销退不回联动前

- 分块：`layout-appearance`　位置：app/components/props-panel/props-panel.element.js:2569（与 :2373 的通用 change 处理器叠加）
- 复现：1) 选中 #pad，令其 padding 为 10px 20px；2) 点 .expand-sides[data-kind="padding"] 展开四边；3) 点 .lock[data-lock="padding"] 开启联动（四边同步成 10px）；4) 记 window.__visualRevise.store.history.depth；5) 在 input[data-prop="padding-left"] 里 fill('30') 并 press('Enter')；6) 再读 depth；7) 真实点击 visual-revise-toolbar .undo 一次，读四条 padding-*。
- 期望：depth 只 +1（整体一次 batch）；一次撤销后四边都回到 10px。
- 实际：depth +2（稳定复现，如 40 → 42）；一次撤销后 padding-top/right/bottom 回到 10px，而 padding-left 仍停在 30px，用户看到一个非对称的中间态。根因：四边输入框同时带 data-prop 与 data-side，通用的 input[data-prop] change 处理器（:2373）先把被编辑的那一边单独 commit 成一条历史，随后 input[data-side] 的联动处理器（:2569）才把四边包成一个 batch，于是同一次编辑落成两条记录。
- 复现结论：独立复现成立，连跑两次输出完全一致。我的脚本 tests-e2e/full/verify/layout-appearance-2_5_16.mjs（真实 page.mouse 点击 + locator.fill/press，无 element.click）：

主场景（选中 #pad → 展开四边 → 开锁 → 静置 700ms → padding-left 填 30 回车）：
  「[编辑前] depth = 2  undoLabel = "padding-left"」
  「[编辑后] depth = 4  undoLabel = "内边距"」
  「==> depth 增量 = 2（期望 1 = 整体一次 batch）」
  真实点击 visual-revise-toolbar .undo 一次后：
  「[撤销一次后] inline: {"padding-top":"10px","padding-right":"10px","padding-bottom":"10px","padding-left":"30px"}」
  「==> 一次撤销回到联动前（四边都 10px）? false」
  「==> 出现非对称中间态? true   四边 = ["10px","10px","10px","30px"]」
  再撤一次才回到四边 10px。

对照组 B（同一个框、锁关闭、填 44）：「增量 = 1（期望 1）」「==> 锁关闭时一次撤销就干净: true」——证明手势和测量本身没问题，多出来的那条只在锁开启时出现。

对报告的一处修正：报告说的「depth 稳定 +2」其实依赖时序。history.js 的 MERGE_WINDOW = 400ms 会把同元素同属性的单 op 记录合并；锁点击本身也会给 padding-left 落一条单 op 记录，紧接着编辑（我的对照组 A 就是这种）时通用处理器那条会被合并进去，depth 读出来是 +1，但一次撤销后依然是「{...,"padding-left":"55px"} 非对称? true」。所以坏的是撤销边界，depth 数字只是它的一个不稳定表征——我加了 700ms 静置才拿到干净的 +2。

根因与报告一致：#renderSides（:1962）给四边输入框同时挂了 data-prop 和 data-side，on() 在 :2163 是给每个元素直接 addEventListener，按注册顺序执行，于是 :2373 的通用 input[data-prop] change 先 this.#commit(prop, el.value) 单独入栈一条，:2569 的 input[data-side] 联动处理器才 #batch 包住四边再提交（batch 里 padding-left 已同值，applyProp 在 :798 判等直接 return，所以 batch 里只有另外三条 op）。撤销时先弹 batch，被编辑的那一边留在新值上。

不是有意设计：PRD AC-8.3 明写「一次拖拽 / 切排列是一个动作，⌘Z 整体退回」，feature-inventory.md:200 对 2.5.16 明写「开启后改任一边同步四边，整体一次 batch」，#batch 自己的注释也写「一个动作写多条属性时包一层，⌘Z 才会一次撤完而不是撤到一半」。三处都与报告的期望一致，没有任何注释把双记录写成刻意行为。

附带发现（同一处、不在报告范围内）：:2553 的 .lock 点击处理器自己也没包 batch，开锁把 padding-right / padding-left 从 20px 同步到 10px 时落了两条独立记录——我的输出「锁开后 depth = 2  undoLabel = "padding-left"」即是（从 depth 0 起算），开锁这一个动作同样需要按两次撤销。
- 修法：在 :2373 的通用 input[data-prop] change 处理器开头早退——当该 input 带 data-side 且对应 .lock[data-lock] 处于 data-on 时直接 return，把提交权完全交给 :2569 的联动 batch（顺带把 :2553 的 .lock 点击那四次 #commit 也包进一个 #batch）。

### B12 [medium] 2.4.8 面板里横向拖数值时越过面板边缘松手，会把当前选中的元素换掉

- 分块：`panel-head-position`　位置：app/features/selectable.js:99（on_click 用 deepElementFromPoint(e.clientX,e.clientY) 按坐标判定命中，而不是看事件 target / 指针捕获），触发点在 app/components/props-panel/props-panel.element.js:2585-2604（[data-drag] 的 pointerdown 处理器捕获了指针，但没有在 pointerup 之后吞掉那一次 click）
- 复现：1) 起服务并注入（serve() + injectVisBug），打开 tests-e2e/full/fixtures/panel-head-position-main.html。
2) 点击 #bk0 选中它；在 Position 的「定位」下拉里选 relative，让 X / Y 字段出现。
3) 记下面板矩形（默认 left=1124）与 X 前缀 .prefix[data-drag][data-prop="left"] 的 boundingBox（实测 x≈1145，离面板左缘只有 21px）。
4) page.mouse.move 到前缀中心 → mouse.down() → mouse.move 到 (中心x - 40, 同y)（此时指针已经在面板外，落在页面上）→ mouse.up()。
5) 读 window.__visualRevise.panel.target?.id。
- 期望：指针在 pointerdown 时已被 handle.setPointerCapture 捕获，整个拖拽属于面板控件；松手后仍应停留在 #bk0 上（数值确实按 -20 步算对了，写成 left:14px）。
- 实际：数值算对了（left: 14px），但选中被换成了 <html>（panel.target.id 为空字符串），用户手上正在改的元素当场丢失，面板整块重绘成另一个目标的属性。
- 复现结论：复现成立，且不是有意设计。

我自己的脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/panel-head-position-2_4_8-selection.mjs（原定路径 panel-head-position-2_4_8.mjs 在我写完后被另一位 agent 并发覆盖成 2.4.8 的「旋转框裸数字」分支，我保留了他们的文件、把自己的改名，没有回退任何人的东西；app/ 与已有测试一行未动）。

连跑 4 次（改名前 2 次 + 改名后 2 次）输出逐字相同：

  面板矩形             : left=1124 top=88 w=300
  X 前缀矩形           : x=1145 y=321 w=6
  前缀中心离面板左缘   : 24px
  拖之前 #bk0 left     : 34px

  [对照组 A] 面板内右拖 20px  1148,328 → 1168,328
    #bk0 left           : 44px
    panel.target        : div#bk0 → div#bk0

  [被测] 左拖 40px 越过面板左缘  1148,328 → 1108,328（面板左缘 1124）
    终点在面板外        : true
    #bk0 left           : 14px （期望 14px：-40px / 2 = -20 步）
    panel.target        : div#bk0 → html
    [data-selected] 元素 : ["div#bk0"] → ["html"]
    松手时的 click 事件  : [{"type":"click","path0":"span","target":"visual-revise-panel","xy":[1108,328]}]
    面板头部元素名      : html · X 输入框还在: false

  结论：数值 = 14px；松手后 panel.target = html
  → 选中被换掉了，复现

三点让我确信这是 bug 而不是设计：

1. 机制与报告者的怀疑完全吻合，且比他写的更能定罪。我在 document 捕获阶段挂的 click 探针显示，松手那一下 click 的 composedPath()[0] 是**面板 shadow root 里的 .prefix span**、e.target 是 **visual-revise-panel**——浏览器把这次 click 归属给了面板自己。是 selectable.js:99 的 `deepElementFromPoint(e.clientX, e.clientY)` 抛开事件 target、改按坐标 (1108,328) 重新命中，才拿到页面的 `<html>`。也就是说 isOffBounds 这道闸（app/utilities/common.js:111，OFF_BOUNDS_SELECTOR 里明确列了 'vis-bug'）本来能挡住，是坐标命中绕过了它。

2. 对照组 A 证明这不是「拖拽必然丢选中」：同一个手柄、同样的 pointerdown/pointercapture，只要终点仍在面板内（右拖 20px），panel.target 稳稳留在 div#bk0。差别只有「松手点是否落在面板外」，正是坐标命中在起作用。

3. PRD 没有把它写成有意为之，反而两处写了相反的意思：AC-3.4「插件自身的 UI（工具条、面板、评论层）永远不可被选中」；AC-6.1 讲 2.4.8 时只说「X 前缀可横向拖着调值」，没有任何选中会变的表述。AC-6.12b1 更直接：团队在填充/效果层的重排上已经把「指针捕获会把后续 click 的 target 重定向」当成必须绕开的坑处理（推迟到 4px 才捕获），说明拖后那一下 click 是已知危险而非设计。selectable.js:99 上方那句注释「坐标落在视口外时拿不到元素（拖到边缘、鼠标甩出窗口），当作没命中」也说明作者已经预见到拖拽甩出来的野 click，但只补了 $target 为 null（拖出视口）那一支，落在视口内、只是越过了面板边缘的这一支没人管——是补漏不全，不是取舍。

可达性不低：X 前缀离面板左缘只有 24px（实测），把 X 往负方向调超过 ~12 步就必然拖出面板。后果是静默的——没有 toast，面板整块重绘成 html 的属性、X 输入框直接消失（脚本里 hasX: false），用户下一次改动会落到错误的元素上。判 medium 不判 high 的理由：本次数值写对了（left: 14px 已落在 #bk0 上），没有数据被破坏，重新点一下元素即可恢复。
- 修法：在 app/features/selectable.js:99 的 on_click 开头先按事件本身判归属——`if (isOffBounds(e.composedPath()[0])) return`——再退回 deepElementFromPoint 的坐标命中（这样面板头部拖拽等其他 [data-drag] 场景一并覆盖）；或退一步，在 props-panel.element.js:2585 的 pointerdown 里于 up 时给 document 挂一次性捕获阶段 click 监听把那一下吞掉。

### B13 [medium] 2.4.8 旋转框里敲完裸数字后直接步进 / 拖标签，会写出 rotate: Npx 被 CSSOM 丢弃

- 分块：`panel-head-position`　位置：app/core/controls.js:260-261（stepValue 里 `const unit = source.match(/[a-z%]+$/i)?.[0]; if (!unit) return … `${next}px``，单位从原始框内文本推断，而 fallback 计算值 45deg 只有在文本完全不可数值化时才会被用到）；调用点 app/components/props-panel/props-panel.element.js:2604-2618（拖拽）与 :2617-2628（方向键），两处都用 { coerce: false } 提交，绕开了 coerceAngle
- 复现：1) 同上打开固件并注入，点击 #bk0 选中。
2) 在 Position 的旋转输入框里 fill('45') 然后 press('Enter') —— 元素写入 rotate: 45deg，但焦点仍在该框里，#syncValues 会跳过聚焦中的字段，框里留着用户敲的裸数字「45」。
3) 不要点别处。直接对同一个框 press('ArrowUp')（或用 page.mouse 横向拖 label.name[data-drag][data-prop="rotate"] 右移 20px）。
4) 读 document.getElementById('bk0').style.rotate 和该输入框的 value。
- 期望：步进应基于这条属性的真实值 45deg，写出 46deg（拖 20px 则是 55deg），框里显示与元素实际值一致。
- 实际：stepValue 从没有单位的框内文本「45」起步，match(/[a-z%]+$/) 取不到单位就按长度补 px，写出 rotate: 46px（拖拽则是 55px）。该声明非法，被 CSSOM 静默丢弃：元素仍是 45deg，输入框却显示 46px / 55px。此后用户对着这个框继续 Enter（coerceAngle 对 '46px' 原样放行）也一直写不进去，看上去就是「旋转调不动了」。改动记录里仍是 45deg，也就是说面板显示的值和记录/页面三者对不上。
- 复现结论：独立复现成立，连跑三次输出完全一致（脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/panel-head-position-2_4_8.mjs）。

场景 A（Enter 后不失焦直接 ArrowUp）实际输出：
  Enter 后 元素 rotate : "45deg"
  Enter 后 输入框      : "45"
  Enter 后 焦点        : input[data-prop=rotate]
  ArrowUp 后 元素 rotate: "45deg"
  ArrowUp 后 输入框     : "46px"
  ArrowUp 后 style 全文 : "rotate: 45deg;"
  ArrowUp 后 改动记录   : ["bk0#rotate: none → 45deg"]
  ==> 场景 A bug 成立（框显示 46px，元素仍 45deg）: true
  再按一次 Enter 后 元素: "45deg"  输入框: "46px"   ← 卡死，后续 Enter 也写不进去（coerceAngle 对 '46px' 原样放行）

场景 B（Enter 后不失焦直接拖 label.name[data-drag][data-prop="rotate"] +40px，真实 page.mouse）：
  拖后 元素 rotate : "45deg"   拖后 输入框 : "65px"   拖后 style 全文 : "rotate: 45deg;"
  ==> 场景 B bug 成立: true
（报告写 20px→55deg，我用 40px→20 步，故期望值是 65deg，实得 65px，性质相同。）

对照组 1（同一步骤，但先真 blur 让 #syncValues 回写字段）：
  计算值 rotate "45deg" → 失焦后 输入框 "45deg" → ArrowUp 后 元素 "46deg" 输入框 "46deg"  ← 正常
对照组 2（同一手势用在 left 上）：
  left: Enter 后 元素 "45px" 框 "45" → ArrowUp 后 元素 "46px" 框 "46"  ← 正常（补 px 恰好合法）
两个对照组共同证明：断点就在 stepValue 的「框内文本无单位 → 一律补 px」这一步，而不是整条交互链路。

不是有意设计，恰恰相反，代码注释把这条写成了要避免的事：
- app/core/controls.js stepValue 上方注释：「…要么返回 null 表示这次按键应当忽略，而不是写入一个会被 CSSOM 丢弃的垃圾值。」
- 同文件 UNITLESS 注释：「这些属性接受纯数字，补上单位会让声明非法而被 CSSOM 静默丢弃」
- KEYWORD_START 里 'rotate': '0deg'，说明 rotate 就该带 deg。
docs/PRD.md 只有 AC-6.1（「旋转写 rotate；X 前缀可横向拖着调值」）没有任何相反约定，且第 151 行明写：「每个控件操作后必须**立刻**落到元素的 inline style 上…任何一处『看起来改了、其实没写』都是最坏的 bug。」

补充两点与报告略有出入的事实（都不推翻结论）：
1) 改动记录没有被写脏，仍是 "none → 45deg"，即三者对不上的是「面板显示」，记录和页面是一致的；
2) 只要发生一次真失焦（点别处 / 换选中元素），字段会被 #syncValues 修回 45deg，卡死状态自动解除——所以是可恢复的功能性中断，不是持久数据损坏。rotate 是 CONTROLS 里唯一用 ang()（非 px 单位）的数值字段，影响面仅此一个控件。
- 修法：app/core/controls.js:260-261：框内文本推不出单位时，先从 fallback（计算值，如 '45deg'）里取单位，取不到再补 px（或按 CONTROLS[prop].coerce 决定默认单位，coerceAngle → deg）；等价做法是让两个步进调用点改走该属性的 coerce 而不是 { coerce: false }。

### B14 [medium] 4.1.13 ⌘G 分组会把新 <div> prepend 到父容器最前，选中项无声跳位

- 分块：`select-handles-text`　位置：app/features/selectable.js:312-340（on_group 的 else 分支 selectedContainer.prepend）
- 复现：1. 打开固件，点 #b（#list 的第 2 个子项）中心选中
2. 按 ⌘G
→ #list 的子项顺序从 a b c d 变成 (新分组) a c d
- 期望：新 <div> 插在被分组元素原来的位置（第 2 位），只多一层包裹，不改变兄弟顺序
- 实际：selected[0].parentNode.prepend(...) 把分组无条件插到父级最前，#b 从第 1 位（0-based）跳到第 0 位。⌘⇧G 取消分组时同样用 prepend 往前塞，顺序也回不去
- 复现结论：复现成立，且比报告写的更糟。我的脚本 tests-e2e/full/verify/select-handles-text-4_1_13.mjs（真实 page.mouse 点击 + page.keyboard.press，不用 element.click）连跑三次输出完全一致：

A 选 #b（index 1）后 ⌘G：
  [⌘G 前] #list 子项 = ["a","b","c","d"]
  [已选中] ["b"]
  [⌘G 后] #list 子项 = ["<div:[b]>","a","c","d"]
  [⌘G 后] 新 div 落在 index = 0  #b 的父节点 = {"bParent":"<div>","bParentIsNewDiv":true}
  → 壳确实只包了 #b（包裹本身是对的），但整包被搬到了 index 0，#b 从 index 1 跳到 0。

对照证明「键送到了、功能确实跑了」，错的只是插入位置：
  B 选 #a(index0) ⌘G → ["<div:[a]>","b","c","d"]（原位就在最前，顺序看不出变化）
  C 选 #d(index3) ⌘G → ["<div:[d]>","a","b","c"]（最后一个被拽到最前，跨了 3 个位）

D ⌘⇧G 也回不去：["<div:[b]>","a","c","d"] → ["b","a","c","d"]，#b 停在 index 0（原始是 1）。

E 额外发现（报告没提，比报告更严重）：对 #list 自己按 ⌘⇧G 拆壳，四个子项落进 body 的相对顺序被彻底打乱：
  a/b/c/d 在 body 里的相对顺序 = ["d","a","c","b"] （被打乱）
原因是 :323 用 `el.childNodes[el.children.length - 1]` 取节点——childNodes 里夹着空白文本节点，用 children 的计数去索引 childNodes，取到的根本不是「最后一个元素」，再配合 prepend 逐个往前塞，顺序就成了乱序。

这次搬位既不进记录也撤不回：
  [⌘G 后] 改动记录 = {"canUndo":false,"stats":{"elements":0,...,"moves":0,"total":0}}
即工具条的撤销按钮是灰的，用户看到元素跳了位却没有任何回退路径。

不是有意设计：docs/PRD.md 全文没有 ⌘G / 分组快捷键的任何 AC（命中的三处「分组」分别是属性面板分组 AC-6.14、改动记录按元素分组 AC-8.1、填充层分组 AC-6.12b，与此无关）；docs/plans/feature-inventory.md:448 对 4.1.13 的描述只写「把选中项包进新 &lt;div&gt; / 拆掉外壳」、AC 覆盖一栏是「无」，:736 也只怀疑「不走 ChangeStore」，没有任何一处把「顺带移到父容器最前」写成预期；app/features/selectable.js:312-340 的 on_group 通篇零注释。
- 修法：在 on_group 里先记住位置再搬：分组分支用一个占位节点（或 DOM 顺序最靠前那个选中元素的 nextSibling）做锚点，把 `selected[0].parentNode.prepend(div)` 换成 `parent.insertBefore(div, anchor)`；取消分组分支改为按正序遍历 `[...el.children]` 并 `el.parentNode.insertBefore(node, el)` 后再删壳（顺手修掉 `childNodes[children.length-1]` 这个索引串台），并让两条路径都走 ChangeStore.moveElement 以便进记录、可撤销。

### B15 [medium] 4.1.14 ⌥Delete / ⌥Backspace 在「编辑器注入之后才出现的元素」上抛 TypeError，style 一个字符都没清

- 分块：`select-handles-text`　位置：app/features/selectable.js:189-191（on_clearstyles: selected.forEach(el => el.attr('style', null))）；node_modules/blingblingjs/dist/index.js（$() 用 Object.assign($el, sugar) 挂 .attr）
- 复现：1. 打开固件并注入编辑器
2. page.evaluate 里 document.createElement('div') 建一个带 style="...opacity:0.9" 的元素 append 到 body（等价于 SPA 路由渲染 / 懒加载 / 弹窗新插进来的节点）
3. 点它中心选中
4. 按 ⌥Backspace（或 ⌥Delete）
→ 控制台抛 TypeError，元素的 style 属性原封不动
- 期望：清空该元素的 inline style 属性
- 实际：Uncaught TypeError: e.attr is not a function。on_clearstyles 对 selected 里的**原生 DOM 元素**调 el.attr('style', null)，而 .attr 是 blingblingjs 用 Object.assign($el, sugar) 挂上去的实例属性——只有被 $() 摸过的元素才有。注入时页面上已有的元素被批量 $() 过所以碰巧能用，注入之后新增的元素没有，功能直接崩。已实测对照：固件里的静态 #form 能清，动态建的 #styled 必崩
- 复现结论：复现成功，连跑两次输出完全一致。我的独立脚本 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/select-handles-text-4_1_14.mjs（真实 page.mouse 点击 + page.keyboard.press，未复用报告者在 select-handles-text.mjs 里的任何断言）实测：

A 动态元素（注入后 document.createElement + appendChild 的 #styled）：
  [按键前 sugar] {"attrType":"undefined","ownAttr":false,"ownOn":false}
  [选中集] ["styled"]
  [按键前 style] "position: absolute; left: 640px; ... opacity: 0.9;"
  [page exception] e.attr is not a function
  [按键后 style] "position: absolute; left: 640px; ... opacity: 0.9;"   ← 一个字符没变
  ⌥Delete 同样：[page exception] e.attr is not a function，style 仍原样。

B 对照，页面 HTML 里就有、此前从未被选中过的静态 #solo：
  [按键前 sugar] {"attrType":"function","ownAttr":true,"ownOn":true}
  [⌥Backspace 期间的页面异常] 无　[按键后 style] null  ← 清干净了

C 关键对照，同一个 #styled 在被 unselect_all 里的 $(el).attr({...}) 摸过一次之后：
  [现在 sugar] {"attrType":"function",...}　[按键后 style] null  ← 立刻就能清了

因果与报告一致，且我补上了报告没写实的那一环：注入时的批量 $() 来自 app/features/imageswap.js:203 的 $('*')（watchImagesForUpload() 在 selectable.js:803 于 listen 时调用），blingblingjs 的 $() 用 Object.assign($el, sugar) 把 .attr 挂成元素的**自有属性**，所以只有注入那一刻已在 DOM 里的元素才有；之后 SPA 渲染 / 懒加载 / 弹窗新插的节点全都没有，selectable.js:189-191 的 selected.forEach(el => el.attr('style', null)) 必炸。

不是有意设计：docs/PRD.md 全文没有 ⌥Delete / 清空 inline style 这一条（§4 快捷键 AC-4.1~4.8 里没有），docs/plans/feature-inventory.md:449 明确把 4.1.14 的效果写成「清空 inline style 属性」、覆盖「无」；selectable.js 的 HOTKEYS 清单里 'alt+del,alt+backspace' 仍在绑定，且 app/core/visual-revise.js 的 onKeydown 里 `if (e.metaKey || e.ctrlKey || e.altKey) return` 是**特意放行**带 alt 的按键给上游 hotkeys 的（Delete/Backspace 的接管分支只在无修饰键时生效），说明这条热键是打算活着的，不是被有意停掉的。

两点如实修正报告：(1) 异常是被 hotkeys-js 的处理器吞在那一次按键里的，不会污染后续交互——同一个会话里 A 炸完，B / C 的 ⌥Backspace 照常工作；(2) 我的 D 组（静态 #nest）不成立但不影响结论：点 #nest 中心命中的是子元素 #inner（[选中集] ["inner"]），测的不是 #nest，B 组已经是干净的对照。
- 修法：selectable.js:189-191 别依赖 blingblingjs 挂在实例上的 sugar，改成原生调用（selected.forEach(el => el.removeAttribute('style'))），最好顺手走 ChangeStore 让这一抹进记录、⌘Z 能救回来。

### B16 [medium] 4.1.14 ⌥Delete 清空 inline style 不进历史栈，⌘Z 救不回来还会误撤销上一步

- 分块：`select-handles-text`　位置：app/features/selectable.js:189-191（on_clearstyles 直接改 DOM，不经 ChangeStore.applyProp / history.push）
- 复现：1. 打开固件，点 #form 右侧内边距（(x=元素左+95%宽, y=中线)，避开输入框和把手热区）选中它——它标签上带 style="opacity: 0.95"
2. 通过面板改一条属性（脚本里用 store.applyProp(el,'border-radius','12px') 等价触发）
3. 按 ⌥Backspace（style 被清空，改动记录里能看到这些声明被移除）
4. 按 ⌘Z
- 期望：⌘Z 把刚被抹掉的整份 inline style 放回来
- 实际：style 仍是空的（只剩 ""）。⌘Z 撤销的是第 2 步那条 applyProp——也就是说这一键把作者写的 opacity:0.95 和用户本次全部改稿一起抹掉，历史栈里没有对应条目，ChangeStore.history 无从回滚；用户按 ⌘Z 想救回来，反而又丢掉上一条无关操作
- 复现结论：复现成立，两次连跑输出完全一致。脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/select-handles-text-4_1_14-undo.mjs（同目录下 select-handles-text-4_1_14.mjs 已被另一个 agent 占用于另一条 4.1.14 报告，故按仓库既有 4_1_13-record-undo / 7_2_10-max-total 的加后缀惯例另起文件名，未覆盖它）。

【核心证据 · B 支，报告原文路径】
  [applyProp 后] style = "opacity: 0.95; border-radius: 12px;"  depth = 1
  [⌥Backspace 后] style = null  depth = 1  改动记录 = [{"el":"form","changes":["opacity: 0.95 → 1"]}]
  [⌘Z 后] style = ""  depth = 0  toast = null
          >> opacity 回来了吗 = 否
清空 style 后历史 depth 仍是 1（没有为这一键新增条目），⌘Z 把 depth 打到 0——被消耗掉的正是第 2 步那条 border-radius，而作者写的 opacity:0.95 一去不回。

【更严重的一支 · C，全程真实鼠标+键盘，无 evaluate 代打】
  [#solo 改完] #solo style = "border-radius: 20px;"  历史 depth = 1  undoLabel = "border-radius"
  [⌥Backspace 后] #form style = null  历史 depth = 1 （还是 #solo 那一条）
  [⌘Z 后] #form style = "" 　#solo style = ""
          >> ⌘Z 救回 #form 了吗 = 否
          >> ⌘Z 反而撤掉了 #solo 的圆角吗 = 是
即报告所述「按 ⌘Z 想救回来，反而又丢掉上一条无关操作」，字面成立。

【机理，与报告的怀疑点一致】
app/features/selectable.js:189-191 `const on_clearstyles = e => selected.forEach(el => el.attr('style', null))` 直接改 DOM；app/core/change-store.js:727-753 的 MutationObserver 只 `observe(documentElement, { childList: true, subtree: true })`，不观察 attributes，store 对这次写入完全无感；history 里自然没有对应 op。

【推翻尝试，均未成功】
1) 设计意图：docs/PRD.md 全文无 ⌥Delete/⌥Backspace/清空 inline style 的任何 AC，AC-4.1「⌘Z / ⌘⇧Z 撤销重做」是无条件的；docs/plans/feature-inventory.md:449 该条 AC 覆盖栏写「无」，:737 原文就是「有没有进历史栈？⌘Z 救不救得回来？」——是待验证的开放问题而非既定设计；selectable.js:189-191 无任何注释（同仓库凡有意取舍处都写了成段理由）。
2) 是否被 4.1.18 的删除接管吞掉：visual-revise.js:219 `if (e.metaKey || e.ctrlKey || e.altKey) return` 在 Delete/Backspace 接管之前就放行了 alt 组合，元素没被删（脚本实测「元素还在 DOM 上 = true」，stats.removals=0），确实走的是 on_clearstyles。
3) 报告复现步骤第 2 步照字面用面板真实打字时（A 支）反而复现不出：`[⌥Backspace 后] style = "opacity: 0.95; border-radius: 12px;"`、depth 1→1→1——因为焦点还停在面板的 border-radius 输入框里，⌥Backspace 被输入框吃掉、⌘Z 按 AC-4.3 让给了浏览器文本撤销。这只说明报告的步骤 2 描述不完整（要先把焦点移回页面，如 C 支那样点一下元素），不影响结论。

【减轻情节，影响 severity 判断】
改动记录里确实留下了这条（`{"el":"form","changes":["opacity: 0.95 → 1"]}`，因为 select 时已 track），且 D 支实测「重置全部改动」能还原：`[undoEverything 后] style = "opacity: 0.95;" >> opacity 回来了吗 = 是`。所以数据不是永久丢失，坏的是 ⌘Z 这条主路径；被误撤销的那条无关操作也还能 ⌘⇧Z 重做（脚本里 depth→0 后 future 非空）。
- 修法：把 ⌥Delete/⌥Backspace 也收进 visual-revise.js 的 onKeydown 接管（在 :219 的 altKey 放行之前），用 `ChangeStore.history.batch('清空样式', () => [...el.style].forEach(p => ChangeStore.applyProp(el, p, '')))` 逐条清，并解绑 selectable.js:76 的上游 hotkey，使这一键成为历史栈里的一条可 ⌘Z 的条目。

### B17 [medium] 4.1.15 ⌘X 剪切删掉元素不走 ChangeStore，记录里没有、也放不回去

- 分块：`select-handles-text`　位置：app/features/selectable.js:213-221（on_cut 直接 selected[0].remove()）；对照 app/core/visual-revise.js:260-280（Delete 走 ChangeStore.removeElements 的正确通道）
- 复现：1. 打开固件，store.clear() + store.history.clear() 归零
2. 点 #d 中心选中
3. 按 ⌘X
4. 读 store.stats().removals 与 store.canUndo
- 期望：和 Delete 键一样走 ChangeStore.removeElements：removals=1、改动记录里有一条、能从记录里放回、能进提示词
- 实际：元素确实离开了 DOM，但 removals=0、canUndo=false。同一个「删元素」动作，Delete 键有账（visual-revise.js:260-280 已接管并记账），⌘X 没有——用户剪掉一块内容，导出给 AI 的提示词里完全看不到，也没有任何入口能放回来
- 复现结论：复现成立（连跑 3 次输出完全一致）。脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/select-handles-text-4_1_15.mjs（真实 page.mouse 点击 + page.keyboard，无 element.click()）。

实际输出（B 段，真实点 #d 中心后按 ⌘X）：
  [cut 事件旁听] [{"target":"d","hasClipboardData":true,"defaultPrevented":false}]
  [⌘X 后] #d 还在页面上 = false
  [⌘X 后] #list 子      = ["a","b","c"]
  [⌘X 后] stats         = {...,"removals":0,"moves":0,"total":0}
  [⌘X 后] canUndo       = false
  [⌘X 后] 改动记录里的删除条目 = []
  [⌘X 后] 导出提示词长度 = 0 （空串 = 一个字都没有）
C 段两条退路都失败：[⌘Z 后] #d 回来了 = false；[重置全部后] #d 回来了 = false。
E 段换 #a 再剪一次，结果同上（removals=0 / canUndo=false / 记录 0 条 / 提示词 0 字）。
D 段同一固件的对照组（真实点 #c 按 Delete）：removals=1、canUndo=true、记录里有 {"tag":"div","text":"C"}、提示词 815 字且含「## 删除的元素」、restoreRemoval 返回 true 且 #c 放回页面。同一个「删元素」动作两条通道，一条有账一条没账，实锤。

不是有意设计：docs/PRD.md 全文 grep「剪切 / ⌘X / clipboard / 剪贴板」零命中，PRD 里根本没有这条功能，更没有把「不入账」写成设计；AC-7.3 反而把删除的契约定成「记录里留下标签/文本特征/子元素数 + 能从记录放回原位」。docs/plans/feature-inventory.md:450 该条 AC 覆盖栏是「无」，:738 与 :773-775 把 §4.1.13–4.1.15 列为待补缺口，要求「要么进记录且可撤销，要么被明确禁用」——即现状两头不靠。app/features/selectable.js:213-221 的 on_cut 上下也没有任何注释解释为何绕开 ChangeStore（对照 visual-revise.js:259-280 Delete 那段注释明写「记录与删除必须是一件事」）。

两处对报告的修正（不影响结论）：
1. 报告说「没有任何入口能放回来」略过头。F 段实测 ⌘V 的 paste 事件确实派发了，#a 被贴了回来——但落点是当前选中元素的子节点而非原位：[⌘V 后] #list 子 = ["b","c","d"]，#b 内容变成 "B<em class=\"deep\">deep</em><div class=\"item\" id=\"a\" ...>A</div>"，且 stats 仍全 0（这次粘贴同样不入账）。所以是「一条会把结构挪错位、且照样不进记录」的野路子，不是可用的放回入口；⌘Z 与「重置全部」两个正式入口确实都无效。
2. 报告怀疑链之外的一点：我原以为 visual-revise.js:287 的单字母块会吞掉 ⌘V，实测不会——:221 有 `if (e.metaKey || e.ctrlKey || e.altKey) return` 守着，⌘X/⌘V 都能正常走到剪贴板通道。
- 修法：在 fork 自己那层（app/core/visual-revise.js，Delete 已在 :260-280 接管的同一处）加一个 capture 阶段的 cut 监听，先 ChangeStore.removeElements(engine.selection()) 再让剪贴板写入，抢在 selectable.js:221 的 selected[0].remove() 之前把元素摘走，使 ⌘X 与 Delete 共用同一条记账/放回通道。

### B18 [medium] 4.1.3 取消其中一个选中项后，此后每次 hover 都抛未捕获异常（handles/labels 数组留着已断开的节点）

- 分块：`select-handles-text`　位置：app/features/selectable.js:120-137（unselect 不清 handles/labels）；app/features/selectable.js:454-460（on_hover 对已断开节点调 showPopover）
- 复现：1. 注入编辑器，打开 tests-e2e/full/fixtures/select-handles-text-page.html
2. 点 #a 中心选中
3. Shift+点 #c 中心（现在选中 2 个）
4. Shift+点 #c 中心（把 #c 取消掉）
5. 鼠标移到 #d 中心
→ 控制台立刻抛 InvalidStateError；此后每次 hover 都会再抛一次
- 期望：hover 只画悬停框 / 测距线，不抛异常
- 实际：Uncaught Failed to execute 'showPopover' on 'HTMLElement': Invalid on disconnected popover elements. —— unselect(id) 把覆盖层从 DOM remove 掉了，却没把它从闭包里的 handles / labels 数组剔除（只做了 [...labels,...handles].filter().forEach(remove)，没有重新赋值这两个数组），on_hover 的 guides 分支仍旧遍历它们调 hidePopover/showPopover。异常抛在 on_hover 末尾，把「把手提升到 top layer」那段整个中断掉
- 复现结论：复现成功，两次连跑输出完全一致，报告者对根因的判断也对。

我的脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/select-handles-text-4_1_3.mjs（真实 page.mouse.move/down/up + page.keyboard，没用 element.click()）。两次运行结论段逐字相同：

```
A  取消 #c 后第一次 hover #d 的未捕获异常数 : 5
A  异常首条 : Failed to execute 'showPopover' on 'HTMLElement': Invalid on disconnected popover elements.
A2 连续 5 次 hover 各自的异常数 : ["texty:5","solo:5","d:5","b:5","inner:5"]
B  不取消（两个都选中）hover 的异常数 : 0 / 0
C  Esc 全部取消后 hover 的异常数 : 0 / 0 （Esc 前是 5 ）
D  坏状态下再 Shift 加选 #d 的异常数 : 1
```
（5 条是因为我一次 mouse.move 带 steps:3，每个 mousemove 事件抛一次 —— 也就是「每动一下鼠标抛一次」，不是每次 hover 只抛一次。）

对照组把因果钉死了：
- B 组只做「选 #a + Shift 加选 #c」，不做取消 → hover 0 异常。
- C 组在同一坏状态上按 Esc（`unselect_all` 会 `labels = []; handles = []` 重新赋值）→ 异常从 5 归 0。
- 也就是说，只有走 `unselect(id)` 这条路才留下脏数组。

代码侧确认（app/features/selectable.js:120-137）：`[...labels, ...handles].filter(...).forEach(node => node.remove())` 只在展开出来的新数组上过滤，`labels` / `handles` 两个闭包变量从未重新赋值；下面只重算了 `selected`。而 `app/components/selection/handles.element.js:16` 给 `<visbug-handles>` 设了 `popover="manual"`，被 `.remove()` 后就是「已断开的 popover」，`app/features/selectable.js:454-460` 的 `// force promote into top layer` 仍旧 `handles.forEach(h => { h.hidePopover(); h.showPopover() })`，`showPopover()` 对未连接元素按规范抛 InvalidStateError。

不是有意设计：
- docs/PRD.md:86 AC-3.3 只写「hover 时显示悬停框与标签，不影响已选中项」，全文没有任何「hover 允许抛异常」的说法；`grep 未捕获|异常|InvalidState` 在 PRD 里 0 命中。
- docs/plans/feature-inventory.md:438 对 4.1.3 的描述同样只有「画悬停框 + 标签，不影响已选中项」。
- selectable.js:120-137 的 unselect 通篇无注释；454 那行注释只说要提升 top layer，没写要容忍断开节点。selectable.js / handles.element.js 里也搜不到任何 isConnected / disconnected 兜底。
- 反证更强：已有的 tests-e2e/full/select-handles-text.mjs:129-137 就是先做「Shift 点掉已选中项」再 hover，然后断言 `ok(hoverErrs.length === 0, '4.1.3 hover 过程中不抛异常')` —— 期望行为早已写进现有测试（我没有改它）。

触达成本极低：`vis-bug.element.js:66` 注入后默认就选中 guides 工具（我的脚本打印 `[默认工具] = guides`），所以走的是默认状态 + 两次文档化的 Shift 点击（4.1.2 / AC-3.2）+ 移动鼠标。

顺带一个我实测到的边界：D 组「坏状态下再 Shift 加选 #d」仍能正常拿到把手（覆盖层 handles:2、选中 ["a","d"]），那 1 条异常来自我点击前的那次 mouse.move（即 hover 路径），不是 select() 另有一处抛点 —— 选中功能本身没被打断。
- 修法：在 selectable.js:120-137 的 `unselect` 里把被 remove 的节点从 `labels` / `handles` 里也清掉，但必须**置空槽位而不是 filter 压缩**（`labels[i] = handles[i] = null`，保住数组长度）——因为 `select()` 用 `const id = handles.length` 当 data-label-id、`createHandle` 用 `!handles[id]` 判重，索引即 id，压缩会让新选中项复用旧 id 与残留把手撞车；同时给 on_hover:454-460、setLabel、createLabel 这三处 `handles.forEach(...showPopover())` 加上 `handle?.isConnected` 过滤，delete_all 的 `[...labels,...handles].forEach(el => el.remove())` 也要跳过空槽。

### B19 [medium] 4.2.2 缩放把手写的 transform 不在 TRACKED_PROPS，位移量既不进改动记录也不进提示词

- 分块：`select-handles-text`　位置：app/core/tracked-props.js:22-33（Position 组只有 rotate，没有 transform）；app/core/snapshot.js:67-88（readComputed / readInline 只遍历 TRACKED_PROPS）；app/components/selection/handle.element.js:71-155（把手写 sourceEl.style.transform）
- 复现：1. 打开固件，动态建一个 220×140 的 #probe，点中心选中
2. 按住左上角把手（元素外接框左上角）向右下拖 40×30
3. 读 store.read().edits 里 #probe 那条的 changes，以及 lib.buildPrompt(store.read())
- 期望：把手写出去的三条 inline 声明（width / height / transform）都能被导出——用户看到的是「变小并挪了位置」
- 实际：记录里只有 width、height；transform: translate(40px, 30px) 不在 TRACKED_PROPS（snapshot 只按 TRACKED_PROPS 读值，Position 组里只跟踪 rotate），提示词里搜不到 transform。用户拖完看着元素挪了位，交给 AI 的却只有尺寸变化，对边固定的那半信息静默丢失。本条清单里已标注（§4.2 ⚠️、§9.3），套件按现状锁住（断言通过），此处只作如实上报
- 复现结论：复现成功，连跑两次输出逐字相同（脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/select-handles-text-4_2_2.mjs，真实 page.mouse.down/move/up 拖左上把手 +40/+30）。

我的脚本实际输出（两次一致）：
  [拖后] inline = ... width: 180px; height: 110px; ...; transform: translate(40px, 30px);
  [拖后] left / top 没被碰过 →  left = 640px  top = 560px
  [拖后] 视觉框 = {"l":680,"t":590,"r":860,"b":700}   ← 拖前是 {"l":640,"t":560,"r":860,"b":700}
  [改动记录] #probe 那条 = ["width","height"]
              width: 220px → 180px
              height: 140px → 110px
  [提示词] 长度 738  含 width = true  含 height = true  含 transform = false
             | | width | `220px` | `180px` |
             | | height | `140px` | `110px` |
  [exportJSON] 含 "transform" = false  含 "width" = true
  两次结果一致（稳定复现）: true

比报告多量了一步「这条丢失值多少像素」：把记录里真正存下来的两条属性重放到干净副本上，
  [重放对比] 用户看到的框    = {"l":680,"t":590,"r":860,"b":700}
  [重放对比] 只按记录重放的框 = {"l":640,"t":560,"r":820,"b":670}
  [重放对比] 四条边的偏差    = Δleft -40  Δtop -30  Δright -40  Δbottom -30
也就是说不只是「少一半信息」：把手本来要固定的那条对边（右/下）在重放里整条移了 40/30px，AI 拿这段提示词改出来的框跟用户看到的完全对不上，而且全程无任何提示。

不是有意设计，三处都查过：
- docs/PRD.md 全文没有 TRACKED_PROPS / 把手 / 缩放 这几个词，也没有为任何属性开「有意不导出」的例外；:259 反而写「记录必须完整、可回退、可带走」，:268 AC-8.6「提示词：包含元素定位、属性改动、…」。
- app/core/tracked-props.js:22-33 的 Position 组注释只解释了 Figma 的 Constraints 为什么换成 position/z-index；controls.js:85-86 解释的是「用独立 rotate 而不是 transform: rotate()，因为计算值好解析」——那是 rotate 的取舍理由，没说 translate 类位移可以丢。
- docs/plans/feature-inventory.md 自己把这条写成缺陷而非设计：:462「⚠️ transform 不在 TRACKED_PROPS…位移量既不进记录也不进提示词」，:769-772 列进「三块最大的缺口（建议优先补）」并明说「这是一条会**静默丢改动**的路径」。

一个减轻情节（报告没提，我顺手验的）：store.undoEverything() 之后 inline 恢复成 `width: 220px; height: 140px`、transform 为空——快照存的是整段 style attr（snapshot.js:44 inlineStyle），所以撤销通道不受影响，丢的只有导出/提示词这一头。
- 修法：照 rotate 的既有取舍（controls.js:85-86：独立属性的计算值好解析，transform 的计算值是 matrix）把 handle.element.js:71-155 五个带 start/top 的分支改写 CSS 独立属性 `translate`（计算值就是 `40px 30px`），并把 'translate' 加进 tracked-props.js 的 Position 组 props。

### B20 [medium] 4.3.7 编辑文案时按 Escape 退不出编辑态（那条 hotkeys 从来没被执行过）

- 分块：`select-handles-text`　位置：app/features/text.js:15-20、37（cleanup 挂在 hotkeys('escape,esc') 上）；app/core/visual-revise.js:242（isTypingTarget 时只对 Escape 放行）、:344-354（Escape 被用来取消选中，没有先关掉编辑态）
- 复现：1. 打开固件，双击 #texty 中心进入文字编辑态（contenteditable=true）
2. 按 Escape（连按 3 次）
3. 读 #texty.isContentEditable / getAttribute('spellcheck')
- 期望：Escape 退出编辑态：摘掉 contenteditable / spellcheck，光标离开元素
- 实际：三次之后 contenteditable 仍是 true、spellcheck 仍是 "true"，元素还能继续输入；Escape 被宿主的 keydown 捕获处理器拿去做「取消选中」了（选中数归 0）。text.js:37 注册的 hotkeys('escape,esc', cleanup) 在 contenteditable 元素上被 hotkeys-js 的默认 filter（target.isContentEditable → 不派发）整个挡掉，这条清理路径实际上是死代码。要退出编辑态目前只能点别处失焦
- 复现结论：复现成立，且报告的因果解释也被我的探针证实。脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/select-handles-text-4_3_7.mjs（真实 page.mouse 双击 + page.keyboard 按键，无 element.click()），连跑两次输出完全一致。

关键输出：
进入编辑态（正常）：`[进入后] {"ce":true,"spellcheck":"true","ceAttr":"true","active":"texty","selCount":1,"tool":"text","mode":"select"}`，键入后 text 变成 "Editable Paragraph!!"，说明这是活的编辑态。

连按 3 次 Escape，每次按之前都确认 `active=texty`（焦点没跑，排除「其实是 blur 干的活」这种假象）：
`Esc#1 按之后 {"ce":true,"spellcheck":"true","active":"texty","selCount":0,...}`
`Esc#2 按之后 {"ce":true,"spellcheck":"true","active":"texty","selCount":0,...}`
`Esc#3 按之后 {"ce":true,"spellcheck":"true","active":"texty","selCount":0,...}`
`==> 2A 三次 Escape 之后仍是编辑态 = true`、`==> 2C 选中数 1 → 0 → 0 → 0`（第一次 Escape 只是把选中干掉了）。
Escape 后继续打字仍然生效：`[打字前] "Editable Paragraph!!" → [打字后] "Editable Paragraph!!ZZ"`，`==> 3 = true`。

机制判定（我加的 document 冒泡阶段探针）：`[document 冒泡阶段探针] [{"target":"texty","targetIsContentEditable":true,...},{"target":"texty","targetIsContentEditable":true,...}]` —— 只有 2 条，正好对应 Esc#2/#3（Esc#1 因为选中数>0 被宿主 visual-revise.js:351-352 preventDefault+stopPropagation 掐在捕获阶段）。也就是说第 2、3 次 Escape **确实冒泡到了 document**、hotkeys-js 的 keydown listener 一定收到了，cleanup 却仍然没跑 ⇒ 只能是 hotkeys-js 默认 filter 挡的。我核对了 node_modules/hotkeys-js/dist/hotkeys.esm.js:217 `if (target.isContentEditable || ...) flag = false`，且全仓 app/ 与 extension/ 里没有任何 `hotkeys.filter` 覆写 —— text.js:37 的 `hotkeys('escape,esc', cleanup)` 在编辑态下是彻底的死代码。

对照组排除「不是 Escape 的锅」：`==> 5 点别处失焦能退出编辑态 = true`（ce=false、spellcheck=null、tool 回到 guides）；`==> 6 非编辑态 Escape 能取消选中 = true`（选中数 1 → 0）。二次复现 `==> 7 第二轮同样退不出 = true`。全程 `页面异常：无`。

不是有意设计：docs/plans/feature-inventory.md:473 明写 **4.3.7 `Escape` 退出所有编辑态（text.js:37）**，把它当成已实现的功能列着；docs/PRD.md 里 Esc 的三条 AC（AC-2.9 回选择态、AC-3.11 取消选中、AC-2.16 取消拖拽）没有任何一条说编辑态下 Escape 应当保持编辑，也没有写任何「故意不接」的理由。反倒是 visual-revise.js:345-349 的注释已经点破「VisBug 那条 hotkeys('esc') 会跳过输入框里的按键」——同一个断点对 text.js 自己那条 escape 绑定同样成立，只是没人补上。

旁证（不是我的判定依据，只是佐证不是我环境的偶然）：已有的 tests-e2e/full/select-handles-text.mjs 跑下来这条本来就是红的 —— `✘ 4.3.7 Escape 退出编辑态：contenteditable / spellcheck 都被摘掉（ce=true spellcheck=true）`，同一文件里其余 4.3.x 全绿。
- 修法：在 app/core/visual-revise.js:328 的 Escape 分支里、于 :350 取消选中之前先加一层：事件 target 是页面上的 contenteditable 元素时，先退出文字编辑态（blur / 摘掉 contenteditable+spellcheck，走 text.js 的 removeEditability 那条清理）并 return，别再指望 text.js:37 的 hotkeys('escape,esc')——hotkeys-js 默认 filter 在 contenteditable 上永不派发。

### B21 [medium] 2.8.6 隐藏某一填充层期间改了别的层，再点开眼睛会把那次改动静默回滚

- 分块：`typography-fill`　位置：app/components/props-panel/props-panel.element.js:1227
- 复现：1) serve(tests-e2e) + launch + goto fixture + injectVisBug；2) page.evaluate 造一个三层填充的 div：`position:absolute;left:330px;top:730px;width:140px;height:70px;background-color:#123456;background-image:url(<canvas 生成的 png dataURL>), linear-gradient(#ff0000, #0000ff)`；3) 真实点击选中它，Fill 分区出现三行；4) 点 `visual-revise-panel section[data-group="fill"] [data-layer-eye="0"]` 关掉最上面那层图；5) 在第三行（垫底纯色）的 `vr-fill .text` 里 fill('#00ff00') + press('Enter')，此时 el.style.backgroundColor === 'rgb(0, 255, 0)'；6) 再点一次 `[data-layer-eye="0"]` 把那层打开。
- 期望：清单 2.8.6：「再开若『关掉之后没动过别的』就原样放回…否则按当前层列表重写」。中途改过别的层，应按当前层列表重写，底色保持 rgb(0, 255, 0)，被藏的那层回来。
- 实际：底色变回 rgb(18, 52, 86)：#toggleLayer 把关灯那一刻存的整段 inline 原文（background-color + background-image）原样写回，用户在此期间对另一层的改色被静默丢弃（被藏的层确实回来了，所以画面看着「只是颜色跳回去了」）。#layerRestore 只在换选中元素（:327）和本次打开（:1224）时清空，没有任何地方在「别的层被改写」时让它作废，所以那条 else 分支实际上永远走不到。
- 复现结论：复现成立，连跑三次结果一致。我自己的脚本 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/typography-fill-2_8_6.mjs（自建 fixture、真实点击/键盘，不复用 typography-fill.mjs 的工具与断言）输出：

A 对照组（关掉第 0 层→立刻再开，中途没动过别的）正常：`[再开] 元素 = {"hasUrl":true,"computedColor":"rgb(18, 52, 86)"}` → true。

B 复现：`[改完底色] 元素 = {"inlineColor":"rgb(0, 255, 0)","computedColor":"rgb(0, 255, 0)"}`、`[改完底色] 记录 = {"total":2,"changes":["background-color=rgb(0, 255, 0)","background-image=linear-gradient(rgb(255, 0"]}`，再点开那只眼睛后 `[再开第 0 层] 元素 = {"inlineColor":"rgb(18, 52, 86)","hasUrl":true,"computedColor":"rgb(18, 52, 86)"}`、`[再开第 0 层] 记录 = {"total":0,"changes":[]}`。等 0.9s 并换选中再选回仍是 `rgb(18, 52, 86)`，不是没重绘。==> B 复现 = true。注意 total 从 2 掉回 0：那次改色不只是画面回滚，连导出给 AI 的改动记录里都一并消失了。

D（同一条路的更重后果）：藏着第 0 层期间用减号删掉垫底纯色层（`[减掉第 2 层] 元素 computedColor = "rgba(0, 0, 0, 0)"`、面板只剩 2 行），再开第 0 层后 `[再开第 0 层] 元素 computedColor = "rgb(18, 52, 86)"`、行数回到 3 —— 那次删除被静默撤销。==> D 复现 = true。

C 反证守卫的判据：关 0 → 改底色 → 再关第 1 层（把 #layerRestore 顶成 {index:1}）→ 开第 0 层，`computedColor` 保持 `rgb(0, 255, 0)`。==> C = true。所以报告里「那条 else 分支永远走不到」这句不准确——下标不同时它照常走；真正的毛病是 :1223 的守卫只比 `saved.index === i`，从不检查「关掉之后有没有动过别的」。

设计意图核对：feature-inventory.md:237 与 props-panel.element.js:1221-1222 的注释都明写「中途改了别的层，那份原文已经过期，只能按当前层列表重新写」；docs/PRD.md 里没有把这个回滚写成有意为之（AC-6.34c 只管存 {value, important}）。实现与自己的注释相悖，不是 by design。
- 修法：让 #layerRestore 在「别的写入动过 background」时作废——在 #writeBackground / #writeFillLayers 里（#toggleLayer 关灯那一次写入除外）清掉它，或在存原文时连同写入后的 inline 快照一起记下、再开时先比对当前 inline 是否仍等于那份快照，不等就走 else 的按当前层列表重写。

### B22 [low] 4.6.4 Position 工具的鼠标拖动被 Visual Revise 自己的页面拖拽抢走，left/top 一点不动

- 分块：`drag-guides-upstream`　位置：app/core/visual-revise.js:74
- 复现：1. 打开 /full/fixtures/drag-guides-upstream-tools.html 并 injectVisBug。
2. 按 ⌘/ 唤出上游工具条（等 present-yourself 动画跑完再量按钮位置）。
3. 点页面元素 #s0 选中它，再点工具条上的 position 按钮（activeTool === 'position'）。
4. 先用方向键确认工具活着：ArrowRight → #s0 的 inline left 变成 1px。
5. page.mouse.move 到 #s0 内部一点 → page.mouse.down() → 以 4/12/24/40px 递增 move（每步 40ms）→ page.mouse.up()。
6. 读 #s0 的 inline left / top。
- 期望：按清单 4.6.4「鼠标拖动元素改位置」，拖完 #s0 的 inline left / top 应该跟着指针改变。
- 实际：left / top 完全没变（10px/1px → 10px/1px）。拖到 4px 时 layout-drag 的 beginDrag 先跑，它调 onDragStart → engine.unselect_all()，Position 的 onNodesSelected 收到空选中集后把每个 draggable teardown 掉（移除了 document 上的 mousemove 监听），于是 position.js 的 onMouseMove 再也收不到事件；同时 layout-drag 还对 pointermove 做了 preventDefault。整个手势变成了「页面拖拽」（拖拽期间 dragging=true、拖影存在），Position 工具的鼠标交互在选择模式下等于失效。
- 复现结论：复现成立，连跑两次输出完全一致。我的独立脚本 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/drag-guides-upstream-4_6_4.mjs 输出：场景 A（默认，layout-drag 开着）「A · ArrowRight 写入 left=1px（position=relative）」证明 Position 工具是活的，随后「A · 拖前 {"left":"1px","top":"","pos":"relative","parent":"stack","trans":"none"} / A · 拖后 {"left":"1px","top":"","pos":"relative","parent":"stack","trans":""} → ✘ A · 鼠标拖动应改 left/top（1px/ → 1px/）」；拖拽过程四个采样点全是 {"dragging":true,"ghost":true,"trans":"","left":"1px"}。我加的 trans 探针直接坐实了机制：position.js 的 draggable.setup() 写 el.style.transition='none'、teardown() 清掉它，而在第一个 4px 采样点上它已经是 ""——说明 layout-drag 的 beginDrag → onDragStart → engine.unselect_all() → Position.onNodesSelected([]) → teardown 已经先跑完，document 上的 mousemove 监听在任何一次 move 到达 position.js 之前就被摘了。反事实场景 B（同一手势、同一固件，只多一句 layoutDrag.setActive(false)）：「✔ B · 关掉 layout-drag 后鼠标拖动改 left/top（1px/ → 41px/40px）」，过程采样 left 依次 5px→13px→25px→41px，证明 Position 的鼠标通路本身完好，唯一的杀手就是 Visual Revise 自己的页面拖拽。不是有意设计：docs/PRD.md AC-4.6 只承诺解绑 13 个单字母工具热键；app/core/visual-revise.js:44-51 的注释明写「只解热键，不动工具本身」；docs/plans/feature-inventory.md:512 把「鼠标拖动元素改位置」列为 4.6.4 的现有能力，§9.1/§9.3 只把整条 §4.6 记为「零测试覆盖」而非「已废弃」；layoutDrag.setActive() 的判据（:298、:380、:400）只有 mode === 'select'，完全不看 visbug.activeTool——没有任何一处把这个冲突写成刻意取舍。
- 修法：让 layout-drag 认识当前激活的上游工具：把 layoutDrag.setActive(mode === 'select') 改成再排除会自己吃鼠标的工具（position / move 等），并在 toolSelected() 切工具时重算一次，或退一步在 layout-drag.js 的 onPointerDown 里对这些 activeTool 直接 return，别让它 armed。

### B23 [low] 2.5.17 <img> 等替换元素上仍渲染「裁剪内容」复选框，勾了也不生效

- 分块：`layout-appearance`　位置：app/components/props-panel/props-panel.element.js:784（判定逻辑在 app/core/controls.js:356）
- 复现：1) 打开固件，选中 #pic（一个 <img>）；2) 断言 visual-revise-panel .clip-toggle 的 count。
- 期望：count === 0——清单 §0 的 [非文字元素隐藏] 说 img/video/canvas/iframe/embed/object 上整块不渲染，isRelevant('overflow', …) 也是这么判的。
- 实际：count === 1，复选框照常出现；勾上会写一条对替换元素毫无作用的 overflow:hidden 进改动记录与提示词。根因：#layoutRows 无条件 rows.push(this.#renderClip())，从没问过 isRelevant('overflow', computed, el)；同一函数里 order 那一行是问过的（:787），只有 clip 漏了。
- 复现结论：复现成立（连跑两次输出一致），但报告对「后果」的描述只对了一半。

我的脚本 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/layout-appearance-2_5_17.mjs（真实 page.mouse.down/up + locator.click，走 harness.mjs 注入的 extension/toolbar/bundle.min.js，构建于 09-07 02:59，晚于源码 mtime）输出：

  [对照 div#pad]  target = div#pad  clip-toggle count = 1
  [目标 img#pic] tagName = IMG  panel.target = img#pic
  [目标 img#pic] 渲染出的分区 = position,layout,appearance,fill,stroke,effects
  [目标 img#pic] typography 分区在? = false   ← 同一条 [非文字元素隐藏] 规则在排版上确实生效
  [目标 img#pic] .clip-toggle count = 1 （期望 0）
  [cv] canvas#cv  UA overflow = clip  clip-toggle count = 1（期望 0）
  [vid] video#vid UA overflow = clip  clip-toggle count = 1（期望 0）
  ==> 报告的「实际」是否复现（img 上 .clip-toggle count === 1）: true

1) 渲染门缺失＝真 bug，且不是有意设计。docs/plans/feature-inventory.md §0 把 `[非文字元素隐藏]` 定义成「img/video/canvas/iframe/embed/object 上整块不渲染」，2.5.17 那条正带着这个标记；controls.js:355-356 还专门写了 `// 替换元素的内容不会溢出盒子，裁切由 object-fit 管——overflow 对 <img> 无效 / if (prop === 'overflow') return !isTextlessElement(el)`。docs/PRD.md 的 AC-6.7 只写勾选语义，没有任何「替换元素上照常显示」的理由。报告者指的根因也核对无误：props-panel.element.js:784 无条件 `rows.push(this.#renderClip())`，紧接着 :787 的 order 却问了 isRelevant。更强的证据是这条守卫是**死代码**：全仓 isRelevant 只有三个调用点（:704 font-family、:787 order、:1095 #defaultRows 的属性过滤），而 layout 组被 :654 特判走 #layoutRows，从不进 #defaultRows，所以 'overflow' 这个分支永远走不到。同一元素上 Typography 分区确实被隐藏了，说明规则本身是通的，只有 clip 这一行漏接。

2) 报告说的「勾上会写一条 overflow:hidden 进改动记录与提示词」在默认场景下**没有复现**。Chrome UA 表给全部替换元素的 overflow 都是 clip（脚本实测 `{img:'clip', video:'clip', canvas:'clip', iframe:'clip', embed:'clip', object:'clip'}`），而 #renderClip:1040 用 `/^(hidden|clip)$/` 判勾选态，于是复选框天生就是**勾着**的：
  [目标 img#pic] 复选框初始 checked = true
  [第一次点击后] checked = true  inline overflow = ""  props = 0
  [勾选后] store.stats().props = 0  total = 0  改动记录里 #pic 身上的属性 = []  提示词里含 overflow? = false
  ==> 勾上后确实写进 inline + 改动记录 + 提示词: false
真实症状比报告写的更「哑」：它显示成「已裁剪」（对 img 来说这句话本身就误导），点一下触发 `#applyToAll('overflow','')` 清声明→render() 又从 computed 读回 clip→复选框弹回勾选，用户点了完全没反应，也没有任何记录。canvas / video 同样如此（props 0 → 0）。

3) 写入路径确实存在，但要页面样式先把 UA 的 clip 盖掉。我加了 `#pic { overflow: visible }` 后：
  [img#pic] computed overflow = visible  clip-toggle count = 1  初始 checked = false
  [img#pic] 点一下之后：inline overflow = "hidden"  props 0 → 1  改动记录 = ["overflow: "]
  [img#pic] 提示词含 overflow? = true  行 = "| overflow | `clip` | `hidden` |"
这时才会把一条对替换元素毫无作用的声明塞进改动记录和交付给下游的提示词。

结论：清单编号 2.5.17 的断言 `count === 0` 应当失败，bug 属实；报告者的期望与代码注释 / 清单 / PRD 一致，根因定位准确，只是把「默认场景下的无声空转」写成了「会写一条无效改动」——后者只在页面样式覆盖了 UA overflow 时才发生。
- 修法：把 props-panel.element.js:784 改成和 :787 的 order 同样的写法——`if (isRelevant('overflow', this.#computed, el)) rows.push(this.#renderClip())`，正好接上 controls.js:355-356 那段现在无人调用的判定。

### B24 [low] 2.6.1 不透明度步进不受 CONTROLS 声明的 min:0 / max:1 约束，可写出负值

- 分块：`layout-appearance`　位置：app/core/controls.js:247（stepValue）与 :266（stepSize），声明在 :100
- 复现：1) 选中 #appear；2) write opacity = 0.5；3) 点进 input[data-prop="opacity"]，连按 ArrowDown 直到越过 0（0.5 → … → 0 → -0.05）；4) 读 document.getElementById('appear').style.opacity。
- 期望：停在 0（CONTROLS['opacity'] 声明了 min:0 / max:1）。
- 实际：写出 opacity:-0.05 并记进改动记录。视觉上和 0 没区别，导出的提示词里却是一个非法区间的数字。根因：stepSize 只读 spec.step，stepValue 从不读 spec.min / spec.max；全仓 grep CONTROLS 的字段访问只有 .step/.coerce/.options/.type/.label——min/max 这两个键从未被任何代码读过。
- 复现结论：复现成立，且比报告说的更严重。脚本 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/layout-appearance-2_6_1.mjs 连跑两次，输出逐字相同（完全确定性）：

A 下界：写 opacity=0.5 后真实点进 input[data-prop="opacity"]，连按 ArrowDown ×12 →
「轨迹 = 1:0.45 → … → 9:0.05 → 10:0 → 11:-0.05 → 12:-0.1」
「[结果] inline opacity = "-0.1" 数值 = -0.1 输入框 = "-0.1"」
「[结果] computed opacity = 0 ← 浏览器渲染时自己夹到 0，所以画面上和 0 没区别」
「[结果] 导出提示词里那一行 = "| opacity | `1` | `-0.1` |"」
==> 越过 min:0 写出负值? true

B 上界（报告没提，同样破）：0.9 起 ArrowUp ×8 → 「1:0.95 → 2:1 → 3:1.05 → … → 8:1.3」，inline = "1.3"，提示词 = "| opacity | `1` | `1.3` |"。

C 拖拽路径（报告没提，危害大得多）：拖前缀 ◍ 向左 200px 一次手势 →「inline opacity = "-4.9" 数值 = -4.9 computed = 0」。按键要连按 11 下才越界，拖一次就到 -4.9。

D 追加验证（我另跑的最小脚本）：直接在框里键入也不夹——「typed -3 → inline opacity = "-3"」「typed 7 → inline opacity = "7"」。所以三条写入路径（ArrowUp/Down、拖标签、键入）全都不受声明约束。

「是否有意为之」的反证做过了，没找到辩护材料：
- app/core/controls.js:100 `'opacity': plain('不透明度', { step: 0.05, min: 0, max: 1 })`——min/max 确实声明了。
- stepValue（:247-263）只有 step/UNITLESS/单位分支，next 算完直接 return，无夹紧；stepSize（:266-269）只读 `.step`。两个调用点 props-panel.element.js:2602（拖拽）与 :2624（方向键）也都没夹。
- 全仓（排除 bundle.min.js / node_modules）grep 控件 spec 的 .min/.max，唯一命中是 props-panel.element.js:1922-1923 的 `A.min`/`A.max`，那是 `AXES[axis]`（min-width/min-height 属性名），跟 CONTROLS 无关。min/max 是两个从没被任何代码读过的死键。
- docs/PRD.md AC-6.8 只说「不透明度写 opacity」，没有任何「刻意不限制范围」的说法；全 PRD 搜「范围/越界/合法/非法/上下界/校验」也没有为此辩护的条目。
- 代码注释反而站在 bug 这边：stepValue 上方注释写「表示这次按键应当忽略，而不是写入一个会被 CSSOM 丢弃的垃圾值」——作者的既定意图就是步进不该吐垃圾值。
- 同一代码库里「不透明度要夹」是既有的、明确的设计：feature-inventory 3.4.7「不透明度输入（%）：change 时 clamp 0–100」、3.5.4「clamp(pct,0,100)/100」。Appearance 这个是唯一漏网的。
- docs/plans/feature-inventory.md:206 也把「min 0 max 1（controls.js:100）」写成了这条的规格描述。

（注：tests-e2e/full/ 整个目录当前是 untracked，:629 那条 `>= 0` 断言是报告者自己新写的，我没拿它当既有规格，判定只依据源码 + PRD + 我自己脚本的输出。）
- 修法：在 app/core/controls.js:247 的 stepValue 里算完 next 后按 `CONTROLS[prop]?.min/max` 夹一次（一处即可同时覆盖 props-panel.element.js:2602 拖拽与 :2624 方向键两个调用点），并在 coerceNumber/#commit 的写入路径上补同样的夹紧，否则手输 -3 / 7 仍然照写。

### B25 [low] 3.4.6 色盘的色值输入框敲进非法颜色后不回滚，一直显示那串非法文字（框里的值和元素实际颜色对不上）

- 分块：`popovers`　位置：app/components/controls/picker.js:227
- 复现：1) serve tests-e2e，打开 /full/fixtures/popovers-page.html（任意页面都行），注入 extension/toolbar/bundle.min.js；2) 点选页面上任意元素（如 #solid）；3) 面板里点「文字色」vr-color 的 .swatch 打开颜色弹层；4) 在弹层 shadowRoot 的 .val 输入框里 fill('rebeccapurple') + Enter —— 页面 color 变成 rgb(102,51,153)、框里显示 #663399；5) 再 fill('这不是颜色') + Enter；6) 读 document.getElementById('visual-revise-color-panel').shadowRoot.querySelector('.val').value；7) 再点一下同弹层的 .alpha-val 让 .val 失焦，重复第 6 步
- 期望：parseColor 校验失败后输入框回滚成当前颜色 #663399（跟 vr-color 触发行的色值框一致——那边 color.element.js:109 走 #renderTrigger() 全量重画，非法值立刻被抹掉）
- 实际：输入框始终显示「这不是颜色」；失焦也不恢复（change 已在 Enter 时发过一次，值没再变就不会二次触发），要等下一次任意色盘操作（拖色相条、改不透明度）触发 sync 才被覆盖。这期间页面颜色其实没变，框里显示的却是一串非颜色文本
- 复现结论：复现成立，连跑三次结果完全一致，且不是有意设计。

我的脚本 tests-e2e/full/verify/popovers-3_4_6.mjs 的实际输出（三次一致）：
- B 段：`[非法值后] 弹层状态 = {"val":"这不是颜色","alphaVal":"100","format":"Hex","shadowActiveIsVal":true,"shadowActiveClass":"val"}` / `[非法值后] 页面 color = rgb(102, 51, 153)` / `emit 次数 前/后 = 1 / 1` —— 非法值确实没提交（页面没动、没多 emit），但框里就是那串「这不是颜色」。
- C 段（点 .alpha-val 让 .val 失焦）：`[失焦后] 弹层状态 = {"val":"这不是颜色", ... "shadowActiveClass":"alpha-val"}` —— 失焦也不回滚（change 已在 Enter 时发过，值没再变不会二次触发）。
- D 段对照：同一份非法输入喂给 vr-color 触发行的 .text，`[对照 后] 触发行 .text = "#663399"`，`==> D ... true` —— 同仓库同类输入（color.element.js:106-109 `if (!next.valid) return this.#renderTrigger()`）会立刻抹掉非法值。
- 结论行：`B: true（非法值没提交: true） / C: true / D: true / 复现成立（B && C && D）: true`。

根因确认在报告怀疑的位置：picker.js:225-231 的 `.val` change 处理器在校验失败时 `return sync()`，本意就是回滚；但 sync() 里 picker.js:205-208 的守卫 `const focused = document.activeElement === val || val.getRootNode?.().activeElement === val; if (!focused) val.value = ...` 在 Enter 触发 change 时焦点仍在 .val 上（我打印的 shadowActiveIsVal=true 直接证实），于是回滚那一句被跳过 —— 这条守卫的注释「正在输入的字段不覆盖，否则光标会被顶掉」针对的是外部 sync，不是这条主动回滚路径。

不是有意为之：docs/plans/feature-inventory.md §3.4.6 白纸黑字写「`change` 时 parseColor 校验，非法则回滚显示（:218-224）」；docs/PRD.md 里没有任何一条把「非法文本留在框里」写成设计。更硬的旁证是仓库自带的 tests-e2e/full/popovers.mjs 跑完 182 条只挂 1 条，挂的就是这条：`✘ 3.4.6  非法值回滚显示（输入框回到 这不是颜色）`（其余 181 条全过）。

顺带纠正报告的一个细节：复现步骤第 7 步之后说「下一次色盘操作（拖色相条）会触发 sync 覆盖它」并不成立。我的 E 段真实拖了色相条，`[拖完色相条] 页面 color = rgb(102, 153, 51)` 而 `[拖完色相条] 弹层状态 = {"val":"rgb(哈哈)", ... "shadowActiveIsVal":true}` —— 拖动的 pointerdown 里 preventDefault，焦点没离开 .val，所以守卫继续生效，非法文本活得比报告说的更久，而且此时框里的文字和元素真实颜色是明确对不上的。只有关掉弹层再重开才恢复（F 段：`[关掉再重开] val = "#112233"`）。
- 修法：在 picker.js:227 的非法分支里直接写回输入框而不是依赖被焦点守卫拦下的 sync()，例如 `if (!c.valid) { e.target.value = formatColor(rgba(), fmt); return }`，保留 :207 那条守卫给外部 sync 用。

### B26 [low] 2.9.1 把描边「样式」选成 none 之后，Stroke 分区不当场退回空状态，加号还挂着误导性的 disabled

- 分块：`stroke-effects`　位置：app/components/props-panel/props-panel.element.js:177（const RERENDER_ON = new Set(['position', 'display'])）、:2065（#commit 里的 if (RERENDER_ON.has(prop)) this.render()）；判定方 :610-617（#canAdd）与 :1053（#defaultRows 的 stroke 空状态分支）
- 复现：1) 打开 tests-e2e/full/fixtures/stroke-effects-main.html，注入编辑器，点选 #plain；2) 点 Stroke 分区的加号（写入 border-style:solid; border-width:1px）；3) 点开「样式」下拉，选 none；4) 不换选中，读面板：section[data-group="stroke"] .rows 仍有 3 个子节点，.add[data-add="stroke"] 仍带 disabled 且 title 是「CSS 的 border 只有一层，不能再加」。改成点一下别的元素再点回 #plain，分区就正确地变成空状态（rows=0、加号可点）。
- 期望：按 §2.9.1 / #canAdd 的定义，border-style 变 none（computed border-width 也随之为 0px）就等于没有描边，分区应立刻回到「只有标题 + 加号」，且加号可点。
- 实际：分区停在旧结构上，加号 disabled 且提示语与实际状态相反（此时明明没有描边）。原因是 #commit 只对 position / display 触发重绘（RERENDER_ON 只有这两条），border-style 改完不 render，面板结构与 #canAdd 的结论脱节，要等下一次 render 才对上。
- 复现结论：独立复现成功，连跑两次结果完全一致（脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/stroke-effects-2_9_1.mjs，真实指针交互，不用 element.click()）。

A. #plain 点加号 → 样式选 none：
[点加号后] 面板 = {"rows":3,...,"addDisabled":true,"addTitle":"CSS 的 border 只有一层，不能再加","selectValue":"solid"}
[选 none 后 · 面板] = {"rows":3,"widthInputs":1,"styleSelects":1,"colorCtrls":1,"sizingBtns":2,"addDisabled":true,"addTitle":"CSS 的 border 只有一层，不能再加","selectValue":"none"}
[选 none 后 · 元素] = {"inlineStyle":"none","inlineWidth":"1px","computedStyle":"none","computedWidth":"0px","offsetW":200}
[#canAdd 判定复算] canAdd = true（computed border-width=0px, border-style=none）
再等 1.2s 面板一模一样，排除延迟重绘 → A 复现 = true。

B. 用户影响（报告没测的一条）：此刻用真实鼠标坐标点那个 disabled 的加号，点前点后元素都是 computedStyle=none / computedWidth=0px —— 加号毫无反应。AC-6.22 写明「加号是添加第一条的唯一入口」，此刻这个入口是死的。

C. 换选中再点回来：[点回 #plain 后] 面板 = {"rows":0,...,"addDisabled":false,"addTitle":"添加描边"} → 说明 #canAdd（:610-617）与 #defaultRows 的空状态分支（:1053）判定本身正确，缺的只是重绘。

D. 另一个元素同样复现：#edged（fixture 自带 4px solid）直接选 none → 面板仍 rows=3 / addDisabled=true / title「CSS 的 border 只有一层，不能再加」，而元素 computedWidth=0px、canAdd=true。

E. 对照证明「当场重绘」这条路是通的：改 position（在 RERENDER_ON 里，走同一个 #commit）→ 面板字段数从 22 变 15，结构当场就变了。

设计意图排查：docs/PRD.md AC-6.11a「没有描边时是空状态，只剩标题和加号」与 feature-inventory §2.9.1 都要求空状态，没有任何地方把「改 border-style 不重绘」写成有意为之。对比之下，§2.10.3 对效果参数明确写了「改值不重绘（弹层还开着）」、PRD AC-6.24i 也明确写了「#commit 对颜色属性不触发重绘」——该项目对刻意不重绘的地方都是显式记录的，border-style 不在其列。RERENDER_ON 自己的注释（:174-177「这两个属性决定了别的属性有没有意义……改了它们必须整块重画，否则刚变得可用的字段要等下次重新选中才看得见」）恰恰正面描述了 border-style 的处境：它决定粗细/颜色/位置三行有没有意义，只是没被放进这个集合。且样式下拉是 pick() 里先 closePanel() 再派发 vr-select，重绘不会打断任何开着的弹层，没有「不能重绘」的技术理由。
- 修法：把 'border-style' 加进 props-panel.element.js:177 的 RERENDER_ON（或更准确地：#commit 里当这次提交翻转了某个 layered 分区的 #canAdd 结论时就 render 一次）；border-width 别一起加，输入框 change 时重绘会把正在编辑的焦点冲掉。

### B27 [low] 2.13.1 结构树头部的关闭 × 是死按钮：派发 vr-tree-close，全仓无人监听

- 分块：`tree`　位置：app/components/tree/tree.element.js:154
- 复现：1) 打开 tests-e2e/fixture.html（或任意页）并注入 bundle；2) 点击页面上任意元素让属性面板出现；3) page.evaluate 造一个独立浮层形态的树：const t = document.createElement('visual-revise-tree'); t.id='solo-tree'; t.addEventListener('vr-tree-close', () => window.__c=(window.__c||0)+1); document.body.appendChild(t)；4) 按 Escape 取消选中让属性面板收起，露出 solo-tree 的树头；5) 真实点击 page.locator('#solo-tree .tree-close')；6) 断言：window.__c === 1（事件确实派发），但 document.getElementById('solo-tree').isConnected 仍为 true 且 display !== 'none' —— 没有任何东西关掉这棵树。
- 期望：点树头的 × 应当关掉/收起结构树（要么宿主监听 vr-tree-close 收起它，要么这个按钮和事件一起删掉，不留一个点了没反应的控件）。
- 实际：tree.element.js:154-155 的 click 只 #emit('vr-tree-close')；grep 全仓（app/ + extension/）只有这一处出现 vr-tree-close，没有任何 addEventListener('vr-tree-close')，宿主 visual-revise.js:533/541 只监听了 vr-tree-select 与 vr-tree-move。点下去事件派发出去后无人接收，UI 毫无变化。产品里树只以 embedded 形态挂在属性面板里，tree.element.css:42 把 .tree-head 整块 display:none，所以用户实际点不到——是死代码 + 死按钮，不是线上可见故障，故记 low。
- 复现结论：复现成立，两次连跑输出完全一致（脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/tree-2_13_1.mjs，真实 page.mouse.move/down/up，未用 element.click / dispatchEvent）。

B 段（独立浮层形态，鼠标落点命中链 `VISUAL-REVISE-TREE > BUTTON.tree-close`）：
  [点之前] {"isConnected":true,"display":"flex","visibility":"visible","hiddenAttr":false,"rows":2,"box":{"w":300,"h":95}}
  [点之后] {"fired":1,"onDoc":1,"gone":false,"isConnected":true,"display":"flex","visibility":"visible","hiddenAttr":false,"rows":2,"box":{"w":300,"h":95}}
  ==> B1：× 确实派发了 vr-tree-close（自身 1 次 / 冒泡到 document 1 次）= true
  ==> B2：点完树仍原样挂着、可见 = true
事件确实 bubbles+composed 冒到了 document（onDoc=1），即宿主层完全看得见它，只是没人接。

C 段对照（一棵谁都不挂监听的裸树，排除「是我自己的监听吃掉了事件」）：
  [裸树点完] {"gone":false,"isConnected":true,"display":"flex","hiddenAttr":false,"h":95} → 纹丝不动。

D 段对照（同款按钮该有的样子）：属性面板头部的 × 派发 vr-close，宿主 app/core/visual-revise.js:550 有监听 →
  [面板 · 点前] {"there":true,"h":300,"hidden":false} / [点后] {"there":true,"h":0,"hidden":true} → 真的收起了。
说明「× 该有效果」是本仓自己的既有约定，不是我强加的期望。

设计意图核对：PRD 并没有把它写成有意为之——docs/PRD.md AC-2.10 明确写「属性面板与结构树的 × 都只收起自己那块 UI，不改变当前模式」，即按 PRD 这个 × 本该起作用。tree.element.css:29-42 的注释只说明 embedded 时标题与关闭钮「归面板的标题栏，这里藏掉」，解释了为什么按钮看不见，没有解释为什么事件无人接收。grep 全仓（排除 bundle/min）确认 vr-tree-close 只出现在 app/components/tree/tree.element.js:155 一处派发，零处 addEventListener；宿主 app/core/visual-revise.js 只有 :533 vr-tree-select 与 :541 vr-tree-move。docs/plans/feature-inventory.md:306/741/777 三处已把它记为「已存在的死按钮」，属于已知未修，不是有意设计。

对报告的一处事实更正：报告称「tree.element.css:42 把 .tree-head 整块 display:none」——该规则是 `:host([embedded]) .tree-head { display: none; }`，只对 embedded 生效，非 embedded 形态下这个树头和 × 是完全可见可点的（我的 B 段就是在那个形态下点到的，按钮 22×22）。产品里之所以点不到，是因为唯一的实例化处 app/components/props-panel/props-panel.element.js:599 总是 setAttribute('embedded')；A 段实测 embedded 树头 headDisplay=none、按钮 boundingBox 0×0、hitTest 拿不到盒子，用户确实无从点击。
- 修法：二选一，都在 app/components/tree/tree.element.js：要么删掉 :47 的 `<button class="tree-close">` 与 :154-155 的 #emit('vr-tree-close')（面板标题栏的 × 已经承担了关闭职责，不留没人接的控件），要么在 props-panel.element.js #mountTree（:595-607，紧挨已有的 vr-tree-move 绑定）补一条 vr-tree-close 监听去收起「结构」tab / 切回「选择元素」tab。

## 4. 无头环境测不到的（5）

- `toolbar` 1.0.2 Alt+Shift+D 与点图标等价：manifest.json:37 的 _execute_action 是浏览器命令，由浏览器直接分发给扩展 service worker，页面里的 keydown 收不到，也没有任何页面可观察的副作用。需真实扩展加载（tests-e2e/extension.mjs 那条路径）。
- `toolbar` 1.0.7 右键菜单 Show/Hide 等价于点图标：contextmenu/launcher.js 走 chrome.contextMenus.onClicked，菜单项由浏览器 chrome 层渲染，Playwright 打不开原生右键菜单，也无法从页面触发。需真实扩展环境。
- `panel-head-position` 2.3.7 hideMapFor()：fill 分区对 [文字] 元素额外关掉 color：hideMapFor 只被 #toggleSection 调用（props-panel.element.js:2135/2138），而 #toggleSection 的唯一 UI 入口就是 2.3.6 里那个不渲染的分区级眼睛。没有任何真实交互能触达这段分支，除非改应用代码或程序化调用私有方法——两者都被本轮约束排除。套件里以 console 备注留痕。
- `export-comments-misc` 7.6.1 右键菜单 Show/Hide 等价于点图标：chrome.contextMenus 与 chrome.action.onClicked 只存在于已安装扩展的 service worker，无头 Playwright 页面里既建不出菜单也点不到；仅靠 stub 一个假 chrome 对象只能验模块内部逻辑，不构成对右键菜单本身的验证
- `export-comments-misc` 7.6.2 右键菜单颜色格式 / 配色方案：同上；且该功能靠 chrome.tabs.sendMessage 送到内容脚本（extension/toolbar/inject.js:71-79，跑在隔离世界）再 setAttribute，这条通道在普通页面里根本不存在

## 5. 被推翻的报告（1）

- `toolbar` 1.2.5 点工具条「选择元素」不会把属性面板带回 props tab（按 A 会）：报告的落点值复现了，但报告的**核心论断（「按 A 会」）被我的对照组证伪**，而观察到的 'structure' 恰恰是清单 1.2.6 / AC-2.13 明确写下的有意设计。

脚本：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/verify/toolbar-1_2_5.mjs（真实 locator.click / page.keyboard，连跑三次输出完全一致）。

1) 严格照报告步骤走（场景 A）：
```
[2] 按 F                 →  tab = structure (结构)  工具条高亮 = select
[3] 点工具条「评论」     →  工具条高亮 = comment  面板 = {"hidden":true,"target":null}
[4] 点工具条「选择元素」 →  工具条高亮 = select  面板 = {"hidden":true,"target":null}
[5] 重新选中 .curve-card →  tab = structure (结构)
```
2) **同一条路径，最后一步换成键盘 A（场景 B，报告没做这一步）**：
```
[3] 按 A                 →  工具条高亮 = select  面板 = {"hidden":true,"target":null}
[4] 重新选中 .curve-card →  tab = structure (结构)
==> 按 A 回 select 后 tab = 'structure'
...
报告步骤里按钮与 A 落点是否一致：true
```
按 A 同样停在「结构」。原因我也当场复核了：
```
[复核] 进评论模式后 panel = {"hidden":true,"target":null}
```
`setMode('comment')` 会 `engine.unselect_all()` → `panel.setTargets([])`（visual-revise.js:105-106、:383-386），所以第 4 步那一刻 `panel.target` 为 null，键盘分支 visual-revise.js:297 的 `if (panel.target)` 直接不成立。清单 1.2.6 原文：「按 A/F 时若当前没有选中元素（`panel.target` 为空），只切模式不切 tab（`:297`）。（AC-2.13）」——报告复现出来的正是这条写明的行为，不是按钮与键盘分叉。

3) 唯一真实存在的按钮/键盘差异在**另一条路径**（场景 E，有选中元素、且不离开 select 模式）：
```
[E2] 点「选择元素」按钮  →  tab = structure  panel.target = curve-card
[E4] 按 A                →  tab = props      panel.target = curve-card
==> 有选中时：按钮 = 'structure'，A = 'props'，一致? false
```
但这既不是报告的复现路径，也有设计依据：docs/PRD.md §2 的模式表只写「`A` 落到面板的「选择元素」tab，`F` 落到「结构」tab」，全篇没有一句要求工具条按钮切 tab；toolbar.element.js:66 注释「选择元素有两个入口：A 进属性、F 进结构，落点是面板的两个 tab」说的是两个**键**——正因为一个按钮承载 A 与 F 两个入口，它的 tooltip 才印成「A / F」，无法单选一个落点。setMode 的注释也把自己的职责限定为「状态与工具条高亮不会分叉」，tab 归面板管；AC-2.10 同样体现「一个控件不去动别人的状态」这条一贯取向。

结论：清单 1.2.5 那句「点『选择元素』**或**按 A → …切到 props tab」是清单把按钮和 A 键并写造成的过度归纳（清单自述是「测试集清单」，验收基准在 PRD 的 AC），紧随其后的 1.2.6 已经给出了报告命中的那个例外。按报告写法判为应用 bug 不成立。

## 6. 各分块 agent 的备注（环境结论、清单需修订处）

### `toolbar`

套件文件：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/toolbar.mjs（97 条断言，覆盖 §1 的 48 个编号中全部 46 个可测项，每个编号 1–5 条）。连跑 4 次结果稳定：96 通过 / 1 失败，唯一失败就是上面那条应用问题，已按要求原样保留。

没有新增 fixture 文件——需要的东西（一个真实 <input> 用于验 ⌘Z 让路、.btn-primary 上的页面自有 click 计数器）都是在 tests-e2e/fixture.html 上用 page.evaluate 临时造的；flex 容器直接用固件里现成的 .hero-bar。

几处值得记下的做法：
· 「有没有再 toast 一次」用探针法：先把 #visual-revise-toast 的文案清空，做动作后看它有没有被重新写上——1.2.11 的正反两面（模式变了 / 没变）都是这么验的，比只看有没有 toast 元素实在。
· <vis-bug> 的 shadow 是 closed，Playwright 进不去，所以 §1.8 全靠真实鼠标坐标：1.8.2 从宿主顶部往下逐点真实点击直到 activeTool 变化（第一项就是已激活的 guides，所以第一次变化必然来自第二个工具）；1.8.4 要抓在 <ol> 上而不是 <li> 上，宿主有 popover 的 UA padding 0.25em + ol 的 1em margin，所以命中点在宿主左缘 +22px，代码里对几个候选偏移做了试探并把命中值打进断言文案。
· 1.0.4 / 1.0.5 / 1.0.6 的警告分支是在页面里用 mock 的 chrome.runtime 真跑 extension/toolbar/inject.js（这是无头环境下唯一能走到那段真实注入逻辑的路）。
· 1.3.1 的错误色断言要同时接受 '#ff8f8f' 和浏览器规范化后的 'rgb(255, 143, 143)'。
· 未选中元素时属性面板渲染的是空态、压根没有 tabs 那一行，所以 1.2.6 读 tab 时以 DOM 的 .tab[data-on] 为先、退回读组件自己的 panel.tab。

标 not_testable 的两条（1.0.2 Alt+Shift+D、1.0.7 右键 Show/Hide）都在套件末尾用 console.log 写明了原因，不占断言数：前者是 manifest 的 _execute_action 浏览器命令，由浏览器直接分发给扩展 service worker，页面里既收不到按键也没有可观察副作用；后者走 chrome.contextMenus，原生右键菜单 Playwright 打不开。两者都只能在 tests-e2e/extension.mjs 那种真实扩展加载环境里验。

顺带观察（不构成本分块的失败，留给相关分块判断）：AC-2.14 说「结构 tab 打开时启用页面直接拖拽、切回选择元素 tab 则关闭」，而现在 layoutDrag 在整个 select 模式下都开着（visual-revise.js:367 的 setMode 里 layoutDrag.setActive(next === 'select')，代码注释里也说明了这是有意改的），PRD 的这条 AC 已经落后于实现。

未改动 app/ 下任何文件，也未动 tests-e2e/harness.mjs、fixture.html、all.mjs 及其它已有套件；没有 git commit。（git status 里 app/ 与 all.mjs 的改动是我进来之前就存在的。）

### `panel-head-position`

新增文件（只动了这两个，app/ 与既有套件、harness.mjs、fixture.html、all.mjs 一律未改，也没有 git commit）：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/panel-head-position.mjs（150 通过 / 2 失败，失败为下述两个应用问题）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/panel-head-position-main.html

固件里为条件分支各准备了一个元素：横向 flex 容器 #flexrow（三个同构 .kid，兼作共享元素联动）、纵向 flex #flexcol、grid #gridbox、普通 block #blockbox、文字元素 #para/#stroked/#nostroke、多类名 + 框架噪音类名的 #relbox、无背景无描边无阴影的 #barebox、内联 #svgbox（唯一能观察到「Typography 渲染了但默认折叠」的元素），外加 :root 上两条颜色变量 --vr-brand/--vr-ink 与一条非颜色变量 --vr-space，以及 30 个 body 直接子节点把结构树的选中行推出可视区。

排查过程中确认、但不算应用缺陷的几点（已写进对应 results 的 note）：
1. 2.1.3 的 toast 实际文案是「同步 3 个同构元素」（core/shared-elements.js:46），清单写的「已联动 N 个」是概述。
2. 2.1.9 的空态 DOM 确实渲染，但宿主在没有选中时一律 panel.hidden = true，所以这段空态在当前架构下永远不可见——与清单 §2 前言一致。
3. 纯容器上 Typography 整块不渲染（#showTypography），清单 §2.3 的「七个分区固定顺序」只在文字元素上完整成立。
4. #folded 是面板级而非按元素维护：选过一次文字元素后，Typography 在其它元素上也不再回到折叠态。用例顺序必须把 2.3.2 排在任何文字元素选中之前，否则会误判。
5. relative 元素的 getComputedStyle().left 在 Chrome 里是解析后的 0px 而不是 auto，验「关键字无法步进」要改用 z-index（计算值真的是 auto）。
6. 写用例时踩到的坑，留给后续分块参考：容器的几何中心常常落在子元素上（.click() 默认点中心会选错元素），套件里给 select() 加了目标校验，选错会打印「[选中偏移]」；页面顶部 h1 的中心被工具条（x 477~962，y 20~64）盖住，必须点它的左上角。

2.3.7 是本分块唯一的 not_testable：hideMapFor 的唯一调用方 #toggleSection 没有活的 UI 入口（分区级眼睛在当前 UI 不渲染），真实交互无法触达。

### `layout-appearance`

新增两个文件，未改 app/ 与任何既有套件：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/layout-appearance.mjs（120 条断言）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/layout-appearance.html（固件，用 serve() 服务 tests-e2e 后以 /full/fixtures/layout-appearance.html 打开）

覆盖方式：全部真实交互（locator.click / page.mouse 的 down-move-up / page.keyboard），面板行点前 scrollIntoViewIfNeeded，select 前先 blur 面板焦点再按两下 Esc。弹层内容在 shadow root 里，统一用 `#visual-revise-menu [data-item]` / `.gp-dot[data-c][data-r]` 这类后代属性选择器，菜单的分隔线 / disabled / checked / hint 通过读 shadowRoot.children 断言。断言落点是元素 inline style、面板 DOM、toast 文案、window.__visualRevise.store.history.depth 与真实撤销后的结果。

条件分支都各造了一个元素验过：flow 四态 + inline-flex；换行钮在 free/grid 两种禁用态；尺寸模式的 flex 主轴与非 flex 两种 fill 写法（非 flex 走 100%，flex 主轴的 flex-grow 分支已由既有 resizing.mjs 覆盖，本套件不重复）；drop-limit 的 inline 与样式表两条路径；gap 的 free/flex/grid 三态；网格形状的「未设置 / N × 自动 / N × M」三种文案；order 的 flex 子项 / grid 子项 / 块容器子项；clip 的普通元素与 <img>。

不适用 / 未测：本分块内没有需要真实扩展 API、EyeDropper、右键菜单或 chrome.downloads 的功能点，因此没有 not_testable 项。2.5.7 的「零尺寸」分支用「先选中再把元素清成 0 尺寸」来造——无头环境里点不到一个 0×0 的元素。

三次连跑结果一致（115 / 5），5 条失败全部指向应用本身，已按要求原样保留失败断言，未改成跳过或反向断言。

### `typography-fill`

新建套件：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/typography-fill.mjs（742 行，96 条断言，未改 app/、harness.mjs、fixture.html、all.mjs 或任何已有套件，未 commit）。固件全部就地用 page.evaluate + addStyleTag 造在 fixture.html 上（#t-text 文字元素 / #t-plain 纯容器 / #t-img / #t-video[poster] / #t-svg 内联 svg / #t-bg 背景图 / #t-layers 三层填充 / #t-imp 带 !important 的底色 / #t-var 样式表里绑变量 / #t-swap 带 srcset 的图 / #t-bgswap 背景图换图），没有额外 fixture 文件。

交互全部真实：vr-select 走「点触发器 → 点 #visual-revise-select-panel 里的 [data-item]」，填充弹层走「点 vr-fill .swatch → [data-page=\"variable\"] → [data-item]」，层拖拽走 page.mouse 的 down/move/up（含拖动中途 evaluate 取 data-drop / data-dragging），换图走 page.on('filechooser')。

三次连跑结果一致（95 / 1），唯一失败就是 app_bugs 里那条，已按要求保留原断言。

除编号断言外另有 5 条 §2.7「整块条件」断言（#showTypography 的三条判据 + dirty 兜底 + 重置本组后分区收回），它们在清单里没有独立编号，故未计入 points_total（23 = 2.7.1–2.7.8 共 8 条 + 2.8.1–2.8.14 含 2.8.3a 共 15 条）。

无头环境确实做不到、因而没有断言的边角（不影响任一编号的整体判定，均已写在对应 note 里）：2.7.2 的真实系统字体授权弹窗与按钮点下瞬间的「…」态；2.8.2 里「页面 CSP 禁 data: 图时改 toast 文案」那条分支（需要另起一个带 CSP 响应头的页面，本轮 serve() 不发那个头）。

调试脚本留在 scratchpad（/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/dbg.mjs），它用干净页面独立复现了 2.8.6 那条 bug，可直接当作最小复现脚本的骨架。

### `stroke-effects`

新增文件（只有这两个，未动 app/ 与任何已有套件）：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/stroke-effects.mjs（92 条断言）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/stroke-effects-main.html

固件说明：12 个绝对定位的空 div，全部落在 x<680 的左半屏，避开工具条与右侧属性面板。刻意不写 * { box-sizing: border-box }，默认 content-box 才能用 offsetWidth 量出 2.9.5 的「内 / 外」真的改了盒模型（border-box 下两者外观一样大，几何断言就成了空转）。:root 里放了 --vr-line / --vr-accent 两个颜色变量供 2.9.4 的变量绑定用。效果按类型分散到 #fx1…#fx7 各自的盒子上，避免「玻璃」与「背景模糊」抢同一条 backdrop-filter、两条 turbulence 抢同一条 background-image 互相吞掉。

交互方式：全部 locator.click / fill+Enter / page.mouse，无一处程序化 dispatch。面板是滚动容器，点行前一律 scrollIntoViewIfNeeded；注意弹层开着时不能再滚面板（menu.js 的 scroll 监听会把弹层关掉），所以 setFx 只在弹层内操作。弹层内容在 shadow root 里，用 #visual-revise-menu / #visual-revise-select-panel / #visual-revise-color-panel 加 [data-item] / [data-fx] / [data-page] 属性做后代选择。

两处测试自身踩过、值得记下的坑：
1) box-shadow 与 background-image 必须按括号深度切顶层逗号——噪点的 data URI 里带 flood-color='rgba(0, 0, 0, 0.25)'，用朴素正则切会把一层劈成三段（一开始误判成「噪点没排在最前」）。套件里有 splitTop() 处理。
2) vr-color 的色值框只管颜色、alpha 归旁边那个框（这是刻意设计），所以在默认色 rgba(0,0,0,0.25) 上填 #ff0000 得到的是 rgba(255, 0, 0, 0.25)，不是 rgb(255, 0, 0)；同理 CSSOM 会把 #22cc88 规范化成 rgb(34, 204, 136)。断言按实际序列化写。

关于 §9.2 点名的两个缺口：七种效果参数面板的每个字段现在都有独立断言（含默认值换算：噪点 freq=1.2/size、纹理 freq=1/size 与 opacity=radius/10、玻璃 saturate 百分数还原），#effectSummary 的五种分支也各测一次；噪点 / 纹理与填充层共用 background-image 的互不吞噬契约有四条端到端断言（效果层在前、底色不被吞、填充列表不把效果层当成一层、加 / 删任一侧另一侧不受影响）。

无 not_testable 项：§2.9、§2.10 没有依赖真实扩展 API / EyeDropper / 右键菜单 / chrome.downloads 的功能点。

运行时那条 `[page error] Failed to load resource: 404` 是浏览器自动请求 /favicon.ico，与被测功能无关。

### `variables-grid`

新增文件（只动了自己的，没碰 app/、harness.mjs、fixture.html、all.mjs 和别的套件，也没 commit）：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/variables-grid.mjs（41 条断言）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/variables-grid.html（主固件）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/variables-grid-import.css（被 @import 的一张 token 表）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/variables-grid-empty.html（只有非颜色变量的页，用来验空态文案）

固件设计的几个关键点（都是为了让断言真的走到分支，而不是「跳过」）：
1. 变量故意分散在 :root / @media / @layer / @supports / @import 的独立表 / .vg-scope 容器类六处，脚本再补一张 adoptedStyleSheets——2.11.8 说的每条来源都各有一个专属变量名，缺一个就能点名。
2. .vg-scope 里把 --vg-ink 就地改成 #ffcc00，.vg-blue 上再改成 #2244ff：用来验「色圈按选中元素取值」和「多选 unlink 逐元素取各自解析色」。
3. 2.11.5 的假绑定用 @container (min-width: 9999px) 造：cascade.js 对算不了的条件按成立处理，会挑中里面的 var(--vg-red)，但页面上没有容器上下文，真实 computed 是绿色——这是「解析色 ≠ computed 就当没绑定」唯一能稳定复现的入口（比拿 @layer 的 important 反转做更确定）。同时补了 2.11.5b 反向断言，确认这道核对不会误伤带 alpha 的 rgba() 变量。
4. 2.12.8 需要一个「清掉 inline 之后没有样式表可回落」的元素，所以 #vg-grid3 的 grid-template-columns 直接写在 style 属性上；#vg-grid / #vg-grid2 的写在样式表里，否则删空后 declaredValue 会立刻把样式表那条读回来，看不出「写空串」。
5. body 加了 96px 上留白、.row 限宽 1000——不然第一排元素会被工具条（top:20 居中）压住，右边会被属性面板（right:16 宽 300）压住，真实点击命中不了。

交互一律走真实事件：locator.click / shift+click 多选 / page.keyboard.press('Escape') / 输入框 click+fill+Enter；vr-select 是「点开触发器 → 点 #visual-revise-select-panel [data-item=…]」而不是派发 vr-select 事件（现有 grid.mjs 那套 dispatchEvent 的写法没走 pointer 链）。弹层内容一律按 [data-item] / [data-page] / [data-tab] 做后代选择。

本轮没有发现应用侧的问题：41 条断言连跑三次全通过、无 flaky。唯一的 console 噪音是 fixture 页取 favicon 的 404，与被测功能无关。
本分块里没有需要标 not_testable 的点——2.11 / 2.12 全部可以在无头 fixture 里真实操作到（不涉及 EyeDropper、chrome.downloads、右键菜单或真实扩展 API）。

### `tree`

新增两个文件，没有动 app/、harness.mjs、fixture.html、all.mjs 或任何已有套件，也没有 commit：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/tree.mjs（套件，707 行 / 74 条断言）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/tree-lab.html（专用固件：alpha/beta/gamma 三个容器、空 block 容器、inline 非容器 span、CSS order 容器、两个同构 .dup 容器、250 个兄弟的 #many、20 层嵌套的 #deep、底部锚点 + 撑高页面的 spacer）

跑法：node tests-e2e/full/tree.mjs（serve() 服务 tests-e2e 目录，页面用 /full/fixtures/tree-lab.html 打开）。连跑三次结果一致，只有 2.13.1 那条失败，其余 73 条全过，没有 flake。

交互方式：全部真实操作（locator.click / page.mouse.move+down+up / page.mouse.wheel / page.keyboard.press），没有一处 element.click() 程序化派发。拖拽用 mouse.move 分两段走（先越过 4px slop 再移到落点），并在松手前插一个回调读 shadow 里的落点指示。page.evaluate 只用来读状态、量 rect、滚行进可视区，以及每个用例之间用 store.undoEverything() 复原固件。

两个「代码里有分支、但从树里到不了」的地方，已按事实断言并写进 results，没有假装通过：
1) reorder.js:30 的 canDrag false 分支——树从 document.body 的孩子开始铺，body 自己没有行，而唯一父级是 <html> 的就是 body，所以树里每一行都可拖；
2) tree.element.js:270 的「toParent === documentElement 就返回 null」——同理不可达，改成反向验它不误伤顶层行的 before/after 落点。

顺带发现一个不在编号内、也不算 bug 的行为（写在这里备查，没有记进 app_bugs）：手动折叠当前选中元素的祖先后，切到「选择元素」tab 再切回「结构」，那条路径会被重新展开——因为 #mountTree 每次都调 setTarget，而 setTarget 无条件把 pathTo(target) 加回展开集（tree.element.js:75-80、props-panel:605-607）。这与「树在两个 tab 间保留展开状态」的说法有点出入，但让选中项始终可见是合理设计。测试因此改用不在选中路径上的 #gamma 来验证实例复用与状态保留。

覆盖度上有一处主动留白：2.13.18 只断言了「store 变化 → 树反映新结构」（删除 + 撤销两个方向），没有单独断言 rAF 合并成一次渲染——面板重渲染会把树整个 append 回新的 .structure 槽位，触发 connectedCallback 重建 shadow，MutationObserver 的计数会被这条路径污染，做不出稳定断言。

not_testable 的功能点：本章节没有。§2.13 里没有依赖真实扩展 API / EyeDropper / 右键菜单 / chrome.downloads 的条目，19 条全部在无头 fixture 里跑到了。

### `popovers`

新增文件（只动了这两个，app/ 与既有套件一律没碰，也没有 git commit）：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/popovers.mjs（182 条断言）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/popovers-page.html（24 个颜色变量 + 2 个非颜色变量；#solid 纯色带文字、#grad 渐变、#img 图片层+纯色层、#flex、#gridbox 显式 2×1 网格、#plain 无直接文字的容器、#mixed background-size 非枚举值、1600px 撑高用于页面滚动）

points_total 计法：§3 里 N.M.K 形式的功能点共 62 条（3.1 十一 / 3.2 十一 / 3.4 八 / 3.4b 六 / 3.5 八 / 3.6 十八），另加 §3.3——它是本章唯一没有 K 级子项的二级分区（正文写「行为同 3.2 的定位 / 关闭规则」），按一条功能点计，合计 63。套件跑完会打印「覆盖编号（63）」，与 results 的 63 行逐一对应。

跑法与稳定性：node tests-e2e/full/popovers.mjs，约 2.5 分钟。连续三轮结果一致（181/1），唯一失败就是上面那条应用缺陷，已按要求保留原始断言、没有改成跳过或反向断言。

几处需要说明的取舍：
1. 格式相关的断言落在控件派发的事件上，不落在 inline style。写进 el.style 之后 CSSOM 会把 #ff000066 归一成 rgba(255,0,0,0.4)，改动记录读的也是归一后的 inline（snapshot.js:166 的 to 取自 readInline），所以「alpha=1 输出 #rrggbb 不写 rgba()」「切 HSL 输出 hsla」这类在那两处根本验不出来。做法是在页面上挂一个 document 级的 vr-color / vr-fill / vr-select 事件旁观者，操作仍然全走真实交互，只是多一个观察点。
2. §3 前言那条「页面 CSS 漏不进弹层」（AC-6.30）没有 K 级编号，四个弹层各验了一次（.tabs/.pages/button/div/input/*/body 六条规则都漏不进），用单独的 T0 打印在二级分区号上，不计进 63 个功能点。
3. 3.2.2：清单列的「色圈 swatch」和「checkAt 决定对勾在最左/最右」已经在 menu.js:124-128 被当作死代码删掉（变量菜单退役），代码里不存在了；icon 形态还在但全仓没有调用方。本条按现存形态（对勾位 + label + hint）验，清单文案该更新。
4. 3.6.1：#summary() 的 #RRGGBB 分支在触发行里不可达——纯色态走的是两个输入框而不是只读摘要。另外三种摘要（无填充 / 背景图 / 径向渐变 · N 档）里，「无填充」在面板里也造不出来（那样的层会被 parseFills 直接丢掉、行都不渲染），这两种用真实 vr-fill 实例渲染验证，不是模拟事件。
5. 3.5.7 的 disconnectedCallback：弹层开着时面板内任何真实点击都会先被 pointerdown 那条关掉弹层，隔离不出「重绘导致实例被换掉」这条路径，所以那一条是调 panel.render() 触发的。同一机制的完全真实路径在 3.6.8 里覆盖了：填充选「无」→ 那一层被删 → 面板重绘 → vr-fill 的弹层被 disconnectedCallback 收走。
6. 3.4.4 吸管：EyeDropper().open() 需要用户在屏幕上真实取色，无头环境做不到；两个代码分支的渲染态都验了（支持时可用；delete window.EyeDropper 后 disabled + title），取色回调本身未验。
7. 3.2.9 / 3.2.10 的「菜单超过 70vh 自己滚」和「向上翻」需要把视口压到 300px 才触发（900px 下 7 项效果菜单只有 222px，70vh=630 装得下），这一小段会临时改视口再改回来。
8. 顺带发现但不属于 §3、也没写进断言：临时目录 /private/tmp/.../scratchpad 是多个并行 agent 共用的，我一度用 probe3.mjs 这种通用名被别的 agent 覆盖过。后续脚本建议一律带前缀。

### `select-handles-text`

新增两个文件（没动 app/、harness.mjs、fixture.html、all.mjs 及任何已有套件）：
- 套件 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/select-handles-text.mjs（88 条断言，31 个功能点每个至少 1 条）
- 固件 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/select-handles-text-page.html（用 serve() 服务 tests-e2e 后以 /full/fixtures/... 打开）
连跑 3 次结果一致（79/9），没有抖动。

三条踩出来的环境结论，写进了套件顶部注释，后来人不必再踩：
1) <visbug-handles> 与 <visbug-handle> 的 shadow root 都是 closed，Playwright 选择器（含 shadow 穿透）进不去。8 个把手只能按几何位置驱动：把手就画在元素外接框的 4 角 + 4 边中点，button 8px 圆点外加 ::before inset:-0.5rem，实际热区 24×24。用 page.mouse.move/down/up 打这些坐标是真实指针交互，命中率 8/8。
2) 因此选中之后，元素四边外扩 12px 的一圈都归把手。locator.click() 会判定「visbug-handles intercepts pointer events」一路重试到超时；点元素中心（page.mouse.click）才可靠。高度小于 24px 的元素连中心都会被上下把手抢走——把手的 pointerdown 调了 preventDefault，会把整串兼容鼠标事件（mousedown/mouseup/click/dblclick）一起吃掉，这正是 tests-e2e/text.mjs 里「双击驱动不了」的真因。固件把文字块做到 120px 高之后，page.mouse.dblclick 就能真实触发 4.1.17 / 4.3.1，不必再退回 toolSelected('text')。
3) 元素级剪贴板要 page.context().grantPermissions(['clipboard-read','clipboard-write'], { origin })，否则 on_paste 里的 navigator.clipboard.readText() 直接 reject，粘贴静默失效。

两处与清单描述有出入、但代码是刻意为之、没当 bug 报：
- 4.1.1 清单写「选中框 + 元素标签 + 8 个把手」，实际默认工具是 guides，select() 的 no_label 对 guides 为真（selectable.js:470-477），<visbug-label> 根本不渲染。断言只锁了选中框与 8 个把手，清单这句描述建议修订。
- 4.2.3 的收尾除 pointerup 外还挂了 document 的 mouseleave（handle.element.js:157-158），无头环境里指针不会离开文档，这条分支没覆盖到。

测试脚手架里用了两处非 UI 调用，都不是被测行为：分段之间 store.clear() + store.history.clear() 归零，以及少数几处用 store.applyProp 代替「在面板里改一条属性」来制造前置状态（面板逐控件由 acceptance-panel.mjs 覆盖）。其余全部走 page.mouse / page.keyboard。

### `drag-guides-upstream`

新增文件（只动了自己的）：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/drag-guides-upstream.mjs
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/drag-guides-upstream-drag.html
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/drag-guides-upstream-guides.html
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/drag-guides-upstream-tools.html
app/、harness.mjs、fixture.html、all.mjs 及其它已有套件一行未改；未 commit。连跑 4 次结果一致（143 通过 / 3 失败），3 条失败全是应用问题，断言原样保留。

—— advanced.mjs「向后拖落在期望位置」的偶发失败，时序原因已定位 ——
不是等待时间不够，而是 **Chrome 偶尔把这次鼠标手势升级成原生 HTML5 拖放**。用 30 轮快拖复现并抓到事件序列：`dragstart → pointercancel → drop → dragend`，其中 **pointerup 一次都没派发**。layout-drag 的 onPointerDown 只挂了 pointermove / pointerup（layout-drag.js:245），没有 pointercancel，所以 endDrag({commit:true}) 永远不跑：那一轮的落点停在第一个 pointermove 算出来的位置（drop.toParent 变成 BODY、指示线画在 section.cards 上），移动静默丢失，页面上还留下拖影与 opacity:.25 的残影。触发条件是「一步跨过很大距离」：advanced.mjs 里 `mouse.down()` 后直接 `mouse.move(..., {steps:12})` 横穿 380px，第一跳就是 32px，远超浏览器自己的拖放阈值，于是浏览器和 4px 的 DRAG_SLOP 抢同一个手势，谁先谁后是竞态。

本套件里对同一行为的更稳写法（startDrag / waitDragging / waitDropTarget / dragToward）：
1. 按下后先用 3 / 7 / 12px 三小步越阈值——让 layout-drag 在第一时间 beginDrag 并 preventDefault 掉后续兼容鼠标事件，浏览器就没机会升级成原生拖放；
2. 每一步都用 waitForFunction 等真实状态（layoutDrag.dragging、[data-vr-drop-target] 的 id、提交后的 DOM 顺序），不睡固定毫秒；
3. 万一还是被劫持，dragToward 会 mouse.up + Esc 收拾干净后重试（最多 4 次）。
「向后拖 → 插到目标后面」那条行为在 4.4.5 里连跑 4 次，4 次都稳定落成 r1,r0,r2。

—— 写用例时踩到、值得记的几处环境事实 ——
- `extension/toolbar/bundle.css` 给 body 加了 `min-height:100vh`，注入之后 <body> 永远铺满视口，`<html>` 命中不了；要测「拒绝非法落点 / canDrag 为假」只能把页面做长再滚到 body 下方。
- 同一份 CSS 给 `[data-selected=true]` 加了 `transition: all .15s ease`，而上游工具读的是 getComputedStyle——两次按键间隔小于 0.15s 时读到的是过渡中间值，加减会落在错误的基数上。本套件按键间隔取 320ms。
- `<vis-bug>` 是 `translateX(-200%)` 起手、靠 present-yourself 动画滑进来的，`display:none → block` 会把动画整个重放；⌘/ 之后必须等动画停下再量按钮坐标，否则量到的是屏幕外的负坐标（这正是一开始所有工具按钮都点不动的原因）。
- vis-bug / metatip / ally / gridlines 的 shadow 都是 closed，`shadowRoot` 读不到，只能走元素自己挂的 `$shadow` 属性。
- 选择模式下 selectable.js 会在 body 捕获阶段 stopPropagation 掉每一次页面 click，所以「拖拽结束那次 click 有没有被吞」不能用页面自己的 click 处理器判断；本套件改成在 **body 捕获阶段**计数（拖拽的吞噬钩子挂在 document 捕获，早一层），普通点击数得到、被吞的数不到。

—— 顺带发现、但不在我这三节编号里的两处交叉影响（未写成断言，供参考）——
- Edit Text 的 removeEditability 调用 `hotkeys.unbind('escape,esc')`（app/features/text.js:10），会把快捷键帮助浮层自己的 esc 绑定一并解掉；用过一次文字编辑之后，shift+/ 浮层就只能靠再按一次关闭，Esc 失效。
- EditText 里 `el.focus()` 之后若只按 Esc（不点别处），元素一直是 contenteditable 且保持焦点，hotkeys-js 的默认 filter 会把此后所有快捷键（含 ⌘/、shift+/）全部过滤掉；必须点到页面别处 blur 才恢复。

### `history-changes`

新增文件（只动了这两个，app/ 与既有套件一律未改，未 commit）：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/history-changes.mjs（72 条断言 + 1 条覆盖自检）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/history-changes-lab.html

固件要点：单独一块 <style id="impsheet"> 放 .imp / .tcimp / .fimp 三条 !important 规则，§5.5 会把整块摘掉，用来验证「历史里存着 priority，重放不依赖此刻的样式表」；#tc / #fil 上还各留了一条**普通** inline 声明，正好制造出「样式表赢家带 important、inline 不带」的差分——只存值不存 priority 的实现会在这里露馅。

写法上遵守了本轮约定：列表按钮、tab、拖动、滚轮、快捷键、面板输入全部走 locator.click / page.mouse / page.keyboard；点条目前先 scrollIntoViewIfNeeded；shadow 内容靠 [data-tab] / [data-id] / [data-prop] 这类属性做后代选择。造数据时对没有独立 UI 入口的几项（srcset、跨容器 moveElement、带图评论、批量删除）走 store 的同一个写入口——它们的 UI 路径分别由 §2.8 / §4.4 / §7.1 / §4.1 的既有套件覆盖，本块要断言的是记录与历史的行为。

两条本块内的口径说明：
- 合并窗口（history.js:17 MERGE_WINDOW=400）在清单里没有独立编号，断言挂在 5.2.2 下——它和「新操作断掉重做链」同在 commit()；带 important 的那一支挂在 5.5.3（清单原文点名了「history.js 的合并分支同时更新 afterImportant」）。
- 5.5.5 说的三处「存原文再写回」里，分区级眼睛 #toggleSection 在当前 UI 里没有渲染入口（面板上 [data-eye] 计数为 0，与清单 §9.2 的判断一致），只能靠文字色眼睛与填充层眼睛两处把 { value, important } 这条契约锁住；这一点写成了一条显式断言，UI 哪天把分区眼睛接回来它会立刻变红提醒补测。

本块没有 not_testable 项（EyeDropper / chrome.downloads / 右键菜单那类不属于 §5）。清单 6.2.2 写的 SCHEMA_VERSION=3 与代码里的 4 对不上，5.5.6 写的才是对的——那条属于 §6，没在本轮改动。

### `export-comments-misc`

新增文件（只动了自己的）：
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/export-comments-misc.mjs（148 条断言）
- /Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/full/fixtures/export-comments-misc-csp.html（7.2.11 专用：CSP img-src 不含 data:）
未改 app/、harness.mjs、fixture.html、all.mjs 及任何既有套件；未 commit。整套耗时约 2 分 05 秒。

两处需要说明的取舍：
1. 6.1.5 / 6.1.6 的「扩展通道」分支：chrome.downloads 在无头页面里不存在，我在页面里临时定义了一个 window.chrome.runtime.sendMessage 桩来喂 ref-images.js 的 viaExtension，被验证的仍是应用自己的代码（saveRefImages 的通道优先级、exact 标记、doCopy 的四种 toast 文案），只有「下载动作本身」是假的。桩用完立即 delete。7.6 的右键菜单没有这么做——那一条整个功能就活在扩展 service worker 里，桩出来的东西没有验证价值，按 not_testable 处理。
2. 4.3 的文案编辑：页面上连续两次同坐标点击第二次会被吞掉，dblclick 事件根本不产生（tests-e2e/text.mjs 里也记了这一点），所以文案改动那段是 visbug.toolSelected('text') + 真实键盘输入，走的是同一条编辑态路径。

清单与代码的两处对不上（不是 bug，是文档滞后，建议顺手改清单）：
- §6.2.2 写「SCHEMA_VERSION = 3；支持读 1/2/3」，实际 json-io.js:17 已是 4，SUPPORTED = {1,2,3,4}，v4 起每条改动带 important 字段。
- §7.1.12 写「只有图没有文字也是有效评论」，实际加图会插一个 chip，序列化后正文是「[图N]」而非空串（#commitDraft 的空判仍成立，因为要 text 和 images 同时为空才丢弃）。断言按实际行为写成「正文只剩图标记」。

另外两处顺带确认的既有行为，写在断言消息里以免误读：
- 点页面元素时 click 不会冒到 document，是 selectable.js:107 的 `if (!e.altKey) e.stopPropagation()` 干的，与 7.4 的点击隔离无关；7.4.3 因此断言在 pointerdown/mousedown/mouseup 上。
- 面板头部按下时会 preventDefault 指针事件（拖动面板），连带压掉 mousedown/mouseup/click 兼容事件，所以 7.4.2 改用面板里的输入框来验「收尾事件不拦」。

