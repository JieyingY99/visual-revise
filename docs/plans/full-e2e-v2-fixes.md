# 全量 e2e 第二轮 · 16 条确认 bug 的修复方案（v1，待用户批准）

> 关联：bug 详情与核验依据见 [full-e2e-v2-report.md](full-e2e-v2-report.md)；清单见 [feature-inventory-v2.md](feature-inventory-v2.md)；验收条目见 [../PRD.md](../PRD.md)。

## 分派（5 个 opus agent，按文件归属切分，互不抢文件）

| 组 | bug | 名下文件 | 修法要点 |
|---|---|---|---|
| **甲 缩放几何** | A-1 菜单右对齐脱锚、A-2 下拉宽度缩两次、A-3 grip 描边不缩 | `controls/menu.js`、`select.element.js`、`fill.element.js`、`color-popover.js`、`popover-host.js`、`core/zoom.js` | 在 `popover-host.js` 导出一个「弹层可见尺寸」助手（`offsetWidth / k`、`offsetHeight / k`，k = `zoomFactor()`），四个弹层的定位、夹取、向上翻全部改用可见尺寸与 `viewportBox()`；`vr-select` 的 `minWidth` 写回布局宽（`rect.width × k`）且不低于 CSS 的 160px；`SCALED` 选择器补 `visbug-grip` |
| **乙 数值框单位** | B-1 / C-2 拆分行单框无后缀、B-2 四边初值走计算值、C-1 字号框无后缀、C-3 等价写法早退不刷新、C-4 同数字异单位不同步 | `props-panel/props-panel.element.js`、`core/controls.js` | 拆分行单框、四边框、尺寸框、字号框全部走 `#renderControl` 的同一套模板（`data-unit` + `.suffix`，初值取 `#numSource`）；`#showValue` 找不到 `.suffix` 时 `console.warn` 而不是静默；change 早退分支也先 `#showValue` 再 return；`#syncValues` 比较「数字 + 单位」；`stepValue` 抠出的单位必须在允许集合内，否则返回 null |
| **丙 记录与选择引擎** | B-3 逐条还原合成简写抹掉长手、E-1 ⇧点击移出多选后仍留在引擎里 | `core/snapshot.js`、`core/change-store.js`（仅 undoProp 相关）、`features/selectable.js`（仅 `unselect`） | `revertProp` 对 SYNTH 里的合成简写逐条还原四条长手（各自按快照原文写回或删除），不再对简写整体 `removeProperty`；`unselect(id)` 先按 id 过滤 `selected` 再清属性（对齐 `unselect_all` 的顺序） |
| **丁 色板采集** | D-1 display:none 子孙被采、D-2 oklch / display-p3 / color-mix 采不到 | `core/page-colors.js`、`controls/picker.js`（仅 `parseColor`） | 遍历改用 `el.checkVisibility()`（退化到 computed display）；`toHex` 改走探针：任意 CSS 颜色先写到 canvas 2d `fillStyle` 读回（Chrome 会归一化成 `#rrggbb` / `rgba()`），正则只做快路径；`parseColor` 同法 |
| **戊 快捷键反馈与文案** | F-1 空选中无提示、F-2 空选中仍吞硬刷新、F-3 文案写死 Mac 符号 | `features/copy-props.js`、`features/replace-element.js`、`core/hotkey.js`、`components/toolbar/toolbar.element.js`（仅 TIPS） | 空选中的判定并入 `onKeydown` 守卫链、为空时 `return false` 放行；提示统一走 `vr-toast` 事件（面板空态没有落点，对照 `copy-image.js`）；`combo()` 按平台归一化修饰键顺序（Mac ⌥⌘、Windows Ctrl+Alt），所有提示文案与 TIPS 改用它 |

## 验收

- 各 agent 只跑名下相关套件；统筹方跑两套全量（`tests-e2e/all.mjs` 1200+、`tests-e2e/full/all.mjs` 1300+）加本轮新增的 `split-rows / units / page-colors` 与扩写后的 `zoom / keymove / paste / resize-undo / list-follow / guides / copy-*`。
- 修完把新套件补进 `tests-e2e/full/all.mjs` 与 `tests-e2e/all.mjs`。
- PRD 补条目：AC-5.11 弹层定位按可见尺寸；AC-6.39 单位后缀覆盖所有数值框；AC-8.21 逐条还原不抹长手；AC-3.x ⇧点击移出；AC-6.41 采集口径；AC-4.13 combo 顺序。

## 不修 / 待议

- A 组「拖出的参考线」不可达（`createGuide` 无调用方）：上游 guides 工具的功能残留，先不动，记入清单。
- 10.1.1「注入后发一次 tabs.getZoom」与 ⌘⇧C 的 activeTab：headless 点不了扩展图标，只能真机核对。

## 落地勘误（修复 agent 反馈）

- 丁组：canvas `fillStyle` 赋值再读回**不会**把 oklch() / lab() / color(display-p3) / color-mix() 归一化（Chrome 152 实测原样保留色彩空间），必须 `fillRect` + `getImageData` 读像素；半透明 + 现代语法的颜色经预乘 8 位存储会有 1~2 的通道偏差，不透明与 legacy rgb() 零损失，已接受并注释。`display: contents` 的元素 `checkVisibility()` 为 false，本就没画出来，不采是改好。
- 甲组：弹层的 6px 锚点间距、12px 翻转余量、8px 贴边仍是 CSS px，k≠1 时屏幕上是 6k / 8k px；`zoom.mjs` 现有断言把 6 CSS px 当规范，未改。
- 丙组：合成简写的「还原」现在进历史栈；对这条历史「重做」会把简写整条写回（四条长手都变 inline），画面一致但不是作者原来的最小写法；字节级往返要让 history 的 prop op 按长手回放，未做。
- 戊组：Mac 上「重做」气泡从「⌘⇧Z」变为 Apple 规范序「⇧⌘Z」。`ctx.toast` 的根因（面板无目标时静默丢弃）由统筹方在 `visual-revise.js` 的 `shortcutContext` 里修：面板没目标就落到工具条 toast。
