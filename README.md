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

唤起后页面顶部出现一条工具条，它是全部操作的入口：

```
◇ Visual Revise │ 选择元素   评论   重排 │ 记录 3   复制提示词 │ ✕
                 └── 三个互斥模式 ──┘      └── 出口 ──┘
```

- **选择元素**（默认）— 点击页面元素，右侧出现属性面板
- **评论** — 在元素上写 CSS 表达不了的交互需求
- **重排** — 拖动 flex / grid 容器里的子元素调整顺序
- **记录** — 打开改动列表，可回跳定位、单条撤销、导入导出 JSON
- **复制提示词** — 把全部改动整理成提示词送进剪贴板

工具条可拖动。属性面板只在真正选中元素后出现，排版参照 Figma 的设计面板：
分区标题独立成行、字段标签在控件上方、成对字段并排两列（宽/高、上/右内边距等）、
输入框内嵌前缀标识。

分区顺序对齐 Figma 实测结果：

```
Position → Layout → Appearance → Typography → Fill → Stroke → Effects
```

`Typography` 的位置是实测 Figma Desktop 得来的——选中文本图层时它插在
`Appearance` 与 `Fill` 之间，而不是排在最后。它默认折叠，**选中文字元素时自动展开**。

**什么时候不显示它**：`<img>` / `<video>` / `<canvas>` / `<iframe>` 这类内容由外部资源
决定、自身不承载文字的元素，整个 `Typography` 分区连同 `color`、`overflow` 一起隐藏——
它们没有作用对象，留着只占位置。这一点与 Figma 一致（图片图层不渲染 Typography）。

内联 `<svg>` 刻意不在此列：它里面可以放 `<text>`，而且确实继承 `font-*`。

**什么时候保留**：普通容器仍然显示，哪怕它自己没有直接文字。这是与 Figma 的一处
刻意偏离——Figma 没有继承，而 CSS 里在容器上设 `font-size` 让子元素继承是常见写法，
隐藏它会让「给整张卡片调字号」无法表达。分区位置也固定不随选中变动，顺序跳来跳去
会毁掉肌肉记忆。

### Fill 随元素类型变形

Figma 的 Fill 是「这个图层被什么填充」的多态槽位：图片图层是那张图，文本图层是字色，
形状是背景色。CSS 把这三件事拆成了互不相干的属性，面板按元素类型决定谁排最前：

| 选中的元素 | Fill 第一行 |
|---|---|
| `<img>` / `<video>` | 图片预览（缩略图 + 天然尺寸 + 文件名）+ 换图按钮 |
| 有 `background-image` | 背景图预览 + 换图按钮 |
| 文字元素 | 字色（`color`） |
| 其它 | 背景填充（色 / 渐变） |

`color` 因此归入 Fill 而不是 Typography——这也是 Figma 的建模：文本图层的 `fills[0]`
就是字色。

鼠标悬停在面板或改动列表上时滚轮只滚动浮层本身，不会带动底下的页面。

| 快捷键 | 作用 |
|---|---|
| `Alt+Shift+D` | 唤起 / 关闭编辑器 |
| `Tab` | 切换编辑态 ↔ 交互态（验证 hover、点击等原生交互） |
| `C` | 评论模式（在元素上写交互需求，`Shift` 点击可连续添加） |
| `R` | 拖拽重排模式（在页面上直接拖动子元素调整顺序） |
| `Esc` | 逐层退出：草稿 → 模式 → 选中 |
| `↑` `↓` | 数值微调（按住 `Shift` 步进 10） |

面板顶部还有 `⧉` 共享元素联动（改一个同步页面中所有同构元素）、折叠与关闭。

数值输入框左边的标签可以**横向拖动**调值，和 Figma 一样；聚焦后按 `↑` `↓` 微调，
`Shift` 加速十倍。opacity、z-index、font-weight 这类无单位属性不会被误加 `px`。

### 图片：换图与参考图

两处入口，共用同一条通路：

- **换图** — 选中图片元素，点 Fill 分区里的换图按钮，挑一张本地图
- **参考图** — 评论气泡里点「+ 参考图」，或直接**粘贴截图**、把图**拖进气泡**；
  每张可以单独写一句说明（AI 拿到「这张图说明什么」才知道该看图里的哪部分）

只有图、没写文字的评论同样能保存——「照这张改」本身就是需求。

**图片是怎么交到 AI 手里的**：剪贴板一次只能带纯文本或一张图，带不了「文本 + 多张图」；
base64 内联又会把提示词撑到没法粘贴，多数 AI 也不解析提示词里的 data URI。所以走
「落盘 + 绝对路径」——复制提示词时把图写进下载目录的 `visual-revise-refs/<时间戳>/`，
正文里只写路径，AI 自己去读图：

```markdown
## 交互备注

- **「Get started」**
  - 选择器：`button.btn.btn-primary`
  - 需求：悬停时整卡上浮 4px
  - 参考图：`/Users/you/Downloads/visual-revise-refs/2026-09-01-134500/01-hover-state.png` —— 目标 hover 效果

> 参考图是用户想要的目标效果，请先用读图工具打开看过再动手，
```

落盘有两条路，运行时自适应：扩展通道（`chrome.downloads`）能查回**真实绝对路径**；
拿不到时退回页面下载，路径只能按默认下载目录推测，此时提示词里会明确标注
「路径为推测」。**绝不能让 AI 拿着一个看似确切、实则不存在的路径去读图**——
那会让它报错，或者干脆编造图片内容。复制后的 toast 会告诉你走的是哪条路。

页面若禁用了 `img-src data:`（CSP），缩略图会退化成「类型 + 体积」的文字条目，
换图后画面也不会更新——但改动记录与提示词不受影响，工具会 toast 说明这一点。

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
npm run test:e2e      # 全量回归（17 个套件，404 项断言）
npm run test:ext      # 真实扩展加载与产物完整性
npm run test:live     # 真实线上站点（example.com / MDN）
npm run test:locate   # 端到端定位能力（CSS Modules 哈希场景）
npm run zip           # 打包成可分发的 zip
```

测试需要系统已安装 Chrome（`playwright-core` 不自带浏览器）。
路径按平台自动推断，也可显式指定：

```bash
CHROME_PATH=/path/to/chrome npm run test:e2e
DEMO_URL=http://localhost:3000 node tests-e2e/real-demo.mjs   # 在自己的站点上跑一遍并截图
node tests-e2e/shots.mjs                                      # 重新生成 .screenshots/
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
│   ├── toolbar/            顶部工具条（模式切换与全局动作入口）
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
本项目在其上新增：Figma 式属性面板（分区顺序与 Fill 多态对齐 Figma 实测）、改动记录与撤销、AI 提示词导出、评论标注与参考图、图片替换、
共享元素联动、拖拽重排、JSON 导入导出。

对上游文件的修改仅三处，均为必要的能力缺口：

- `app/utilities/common.js` — `isOffBounds` 增加穿透 shadow 边界的追溯（原实现的 `closest` 不跨 shadow root，会把本扩展自己的 UI 当成页面元素选中）
- `app/features/selectable.js` — 导出可逆的 `pause` / `resume`（原 `disconnect` 单向不可恢复），
  释放 `Tab` 键给编辑态切换，并把绑定/解绑收敛到同一份 `HOTKEYS` 清单
  （原先两处手写已经漂移，导致每次 resume 累积一批快捷键处理器）
- `app/components/vis-bug/vis-bug.element.js` — 三行挂载调用
- `extension/visbug.js`、`extension/toolbar/{inject,restore}.js`、
  `extension/contextmenu/{colormode,colorscheme}.js` — service worker 相关修复：
  向尚未注入编辑器的标签页 `sendMessage` 会抛 `Could not establish connection`
  并冒成 Uncaught；`tabs.onUpdated` 未按 `changeInfo` 过滤会让状态机与页面脱节，
  导致在已有编辑器的页面上重复注入。改为静默忽略「无接收方」、注入后再发消息、
  仅在真正导航时重置状态，并以页面里是否已有 `<vis-bug>` 作幂等判据。

新增代码全部隔离在 `app/core/` 与 `app/components/{props-panel,change-list,comment-layer}/`，便于日后 rebase 上游。

上游原始说明见 [UPSTREAM-README.md](./UPSTREAM-README.md)，许可证见 [LICENSE](./LICENSE)。

> 注：macOS 文件系统不区分大小写，本项目的 `README.md` 会覆盖上游的 `readme.md`，
> 因此上游说明另存为 `UPSTREAM-README.md`。
