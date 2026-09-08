# Figma 风格快捷键：⌥⌘C/V 属性、⌘⇧C 截图、⌘⇧R 替换（实现方案 v1）

> 关联：需求验收见 [../PRD.md](../PRD.md)（AC-4.x 快捷键 / AC-7.x 内容操作 / AC-8.x 记录）；功能点编号见
> [feature-inventory-v2.md](feature-inventory-v2.md) §4.7；工作日志见仓库根 `.work-log-可视化改稿扩展.md`。

## 已搭好的骨架（统筹方完成）

- `app/core/hotkey.js`：`isMac`、`isMod(e)`（Mac 看 ⌘、其它看 Ctrl，另一边按着不算）、`MOD / ALT / SHIFT / combo()` 显示文案。
- `app/features/copy-props.js` / `copy-image.js` / `replace-element.js`：各导出 `onKeydown(e, ctx) → boolean`。
- `app/core/visual-revise.js` 的 `onKeydown` 最前面按顺序调用三者；`ctx = { engine, panel, list, comments, toolbar, interactive, mode, hasOpenPopup, isTypingTarget, isEditorUI, toast }`。
  - `engine.selection()` 当前选中；`panel.scope()`（需新增，见 A）联动集合；`mode` 为 `'select' | 'browse' | 'comment'`。
- `tests-e2e/all.mjs` 已注册套件名 `copy-props`、`copy-image`、`replace-element`（文件由各 agent 创建）。
- 勘误（实现中发现）：改动记录的 JSON schema 版本与导入导出在 `app/core/json-io.js`，不在 change-store.js；伪装 Windows 时
  `navigator.userAgentData.platform` 与 `navigator.platform` 都要覆写（`isMac` 优先读前者），且要在注入 bundle 之前用 `addInitScript`。

## 通用约束（每个 agent 都要遵守）

- 只改自己名下的文件；不要碰 `docs/PRD.md`、`.work-log-*`、`tests-e2e/all.mjs`、`tests-e2e/harness.mjs`、其它 agent 的模块。
- 中文注释解释「为什么」；不提交 `app/bundle.min.js` / `extension/toolbar/*`（构建产物）。不要 git commit。
- 跑测试前 `npm run extension:build`。测试用 `tests-e2e/harness.mjs` 的 `serve / launch / injectVisBug / ok`；`ok` 打 ✔/✘（汇总器只认这两个符号）；夹具页 `tests-e2e/fixture.html`（`.hero-title`、`.curve-card ×3`、`.card-title`、`.hero-bar button`）。页面里可用 `window.__visualRevise.store`（ChangeStore）。
- 所有写入走 `ChangeStore`（`applyProp / applyAttr / insertElement / removeElements / history.batch`），保证进改动记录、⌘Z 可退。
- 快捷键判断：`isMod(e)` + `e.altKey` / `e.shiftKey`；`!ctx.interactive`、`ctx.mode === 'select'`、`!ctx.isTypingTarget(e)`、`!ctx.isEditorUI(e)`、`!ctx.hasOpenPopup()`。接了就 `preventDefault()` + `stopPropagation()` 并返回 true。
- 测试里 Mac 上用 `Meta`，另外再模拟一次 Windows：`page.evaluate` 派发 `KeyboardEvent` 带 `ctrlKey:true`，同时把 `navigator.platform` 伪装成 `Win32`（`Object.defineProperty(navigator, 'platform', {get: () => 'Win32'})` 要在注入 bundle 前做，`isMac` 是模块加载时算的）。

## 落地结果（v1 实现完成）

| 功能 | 模块 | 套件 | 备注 |
|---|---|---|---|
| ⌥⌘C / ⌥⌘V 属性 | `features/copy-props.js` + 面板 `scope()` | `copy-props.mjs` 20 项 | 解绑上游同名快捷键；剪贴板 JSON 信封 + 白名单 |
| ⌘⇧C 截图 | `features/copy-image.js` + `extension/visbug.js` `vr-capture` + `inject.js` 中转 | `copy-image.mjs` 21 项 + Chrome for Testing 真实通道 12 项 | `captureVisibleTab` 只认 `<all_urls>` / `activeTab`，线上靠点图标授予的 activeTab；无通道退回 DOM→SVG 重绘 |
| ⌘⇧R 替换 | `features/replace-element.js` + `change-store.replaceElement` + `json-io` schema 6 | `replace-element.mjs` 44 项 | 记录复用「新增 + 删除」，新增带 `replaced`；落点取旧元素后邻 |

守卫口径（统筹决定）：三组键与 ⌥Delete 只让路「正在打字」（`isTypingTarget`），不再看 `isEditorUI`——点完面板按钮紧接着按快捷键是最常见的顺序。

待真机核对：① ⌥⌘C 在 Chrome macOS 上与「检查元素」菜单项同键，页面能否 preventDefault 只能真机验证（Figma 网页版用的就是这组键）；② 线上 `activeTab` 覆盖 `captureVisibleTab` 是按 Chrome 文档推的，headless 点不了工具栏图标。
