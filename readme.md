# Visual Revise

在任意网页上用 Figma 式属性面板可视化改稿，一键导出 AI 能**精确定位**的提示词。

解决的问题：页面已经做完了，视觉细节不对，但「哪里不对、要改成什么样」用文字说不清。
以前要开 DevTools 找元素、试值、复制选择器、手写描述给 AI，AI 还得自己去代码里猜是哪个组件。

```
在真实网页上可视化改（拖布局 / 调间距 / 换字体 / 加评论）
    ↓ 改动自动累积成结构化记录
一键复制提示词  →  粘给 Claude Code / Cursor / Codex  →  AI 改代码
    或
导出 JSON      →  开发导入后逐项修
```

## 安装

首版不上 Chrome 应用商店，走开发者模式加载：

1. 构建产物

   ```bash
   npm install
   npm run extension
   ```

2. 打开 `chrome://extensions/`
3. 右上角打开 **开发者模式**
4. 点 **加载已解压的扩展程序**，选择本仓库的 `extension/` 目录
5. 在任意网页点击扩展图标，或按 `Alt+Shift+D`

> Chrome 137 起移除了 `--load-extension` 命令行开关，只能用上面的界面方式加载。

## 使用

选中页面元素后，右侧属性面板按 Figma 的分组呈现：布局 / 尺寸 / 间距 / 定位 / 文字 / 外观 / 填充 / 描边 / 效果。

| 快捷键 | 作用 |
|---|---|
| `Alt+Shift+D` | 唤起 / 关闭编辑器 |
| `Tab` | 切换编辑态 ↔ 交互态（验证 hover、点击等原生交互） |
| `C` | 评论模式（在元素上写交互需求，`Shift` 点击可连续添加） |
| `R` | 拖拽重排模式（在页面上直接拖动子元素调整顺序） |
| `Esc` | 逐层退出：草稿 → 模式 → 选中 |
| `↑` `↓` | 数值微调（按住 `Shift` 步进 10） |

面板顶部按钮：`💬` 评论模式、`⇅` 拖拽重排、`⧉` 共享元素联动（改一个同步所有同构元素）、`▾` 折叠、`×` 关闭。

底部 **记录** 打开改动列表，可回跳定位、单条撤销、导出 / 导入 JSON。

数值输入框左边的标签可以**横向拖动**调值，和 Figma 一样。

## 提示词为什么能让 AI 定位准

导出的提示词对每个元素给出多重锚点：

```markdown
**定位**
- 选择器：`section.cards > article.curve-card:nth-of-type(2)`
- 标签：`<article class="curve-card">`
- 文本特征：`"Thinking Five"` `"Custom Rose Trail"`
- DOM 路径：`body > section.cards > article.curve-card`
- 位置：同级第 2 个（共 3 个），紧邻「Original Thinking」之后

**改动**

| 属性 | 原值 | 新值 |
|---|---|---|
| padding | `15px` | `24px` |
| border-radius | `18px` | `12px` |
```

关键是**文本特征**排在选择器之后但优先级最高：Tailwind、CSS Modules、CSS-in-JS 都会改写类名，
选择器里的 `_curveCard_x8f2a` 在源码中根本不存在，而 `"Thinking Five"` 一搜就能命中组件文件。

`tests-e2e/locate.mjs` 用一个类名全部哈希化的 React 项目量化验证了这一点。

## 开发

```bash
npm run extension     # 构建扩展产物到 extension/
npm run test:e2e      # 全量回归（7 个套件）
npm run test:ext      # 真实扩展加载验证
npm run test:live     # 真实线上站点验证
npm run test:locate   # 端到端定位能力验证
npm run zip           # 打包成可分发的 zip
```

代码分层：

```
app/
├── core/                   与 UI 无关的核心逻辑
│   ├── anchors.js          定位锚点采集
│   ├── snapshot.js         元素快照与 diff
│   ├── change-store.js     改动记录状态
│   ├── prompt-export.js    提示词生成
│   ├── json-io.js          JSON 导入导出
│   ├── shared-elements.js  同构元素识别
│   ├── layout-drag.js      拖拽重排
│   ├── local-fonts.js      本地字体读取
│   └── visual-revise.js    集成层（挂载与模式调度）
├── components/
│   ├── props-panel/        Figma 式属性面板
│   ├── change-list/        改动记录列表
│   ├── comment-layer/      评论标记与气泡
│   └── vis-bug/            [上游] 工具栏
└── features/               [上游] 选择引擎与各类工具
```

改动捕获用「快照 + diff」：元素首次被选中时记录原始 inline style 与计算值，
导出时对比得出真正改了什么。因此不必侵入上游的 20 多个 feature，
面板改的、快捷键改的、拖拽改的都能被同一套机制捕获，撤销也天然成立。

## 与 VisBug 的关系

本项目 fork 自 [GoogleChromeLabs/ProjectVisBug](https://github.com/GoogleChromeLabs/ProjectVisBug)（Apache-2.0）。

上游提供了跨页面注入、元素选择引擎、Shadow DOM 隔离、样式读写、间距测量等基础能力。
本项目在其上新增：Figma 式属性面板、改动记录与撤销、AI 提示词导出、评论标注、
共享元素联动、拖拽重排、JSON 导入导出。

对上游文件的修改仅三处，均为必要的能力缺口：

- `app/utilities/common.js` — `isOffBounds` 增加穿透 shadow 边界的追溯（原实现的 `closest` 不跨 shadow root，会把本扩展自己的 UI 当成页面元素选中）
- `app/features/selectable.js` — 导出可逆的 `pause` / `resume`（原 `disconnect` 单向不可恢复），并释放 `Tab` 键给编辑态切换
- `app/components/vis-bug/vis-bug.element.js` — 三行挂载调用

新增代码全部隔离在 `app/core/` 与 `app/components/{props-panel,change-list,comment-layer}/`，便于日后 rebase 上游。

原始 VisBug 说明见 [readme.md](./readme.md)，许可证见 [LICENSE](./LICENSE)。
