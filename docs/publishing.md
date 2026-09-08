# Chrome Web Store 上架清单

> 关联：产品说明见 [../README.md](../README.md)；打包脚本 `scripts/package-extension.sh`（`npm run extension:package`）；验收条目见 [PRD.md](PRD.md)。

## 一、已就绪（本仓库当前状态）

| 项 | 状态 | 说明 |
|---|---|---|
| Manifest V3 | ✅ | `extension/manifest.json`，service worker 为 module |
| 图标 16 / 32 / 48 / 128 | ✅ | `extension/icons/icon-*.png`，由 `assets/logo.png`（512）生成 |
| `minimum_chrome_version` | ✅ 114 | 把手用 `popover="manual"`（114+）、`checkVisibility`（105+）、独立 `translate` 属性（104+） |
| 无远程代码 | ✅ | bundle 内无 CDN 地址；上游插件系统（unpkg / jsdelivr 动态 import）未打包 |
| 无 `host_permissions` | ✅ | 只靠 `activeTab`，点图标 / 右键 / Alt+Shift+D 才注入当前页 |
| 打包 | ✅ | `npm run extension:package` → `dist/visual-revise-v<version>.zip`，manifest 在根目录、带 LICENSE 与 NOTICE、排除 `.DS_Store` / `._*` / build |
| 上游归属 | ✅ | 名称不含 VisBug / Google；README 与 NOTICE 注明基于 VisBug（Apache-2.0） |

## 二、还需要准备

### 1. 开发者账号
- Google 账号开通 [Chrome Web Store 开发者](https://chrome.google.com/webstore/devconsole)，一次性注册费 5 美元，需开启两步验证。
- 若以团队发布，先建 Publisher group（否则是个人名义）。

### 2. 商店素材
| 素材 | 规格 | 备注 |
|---|---|---|
| 商店图标 | 128×128 PNG | 直接用 `extension/icons/icon-128.png` |
| 截图 | 1280×800 或 640×400，1–5 张 | 建议：① 选中元素 + 属性面板；② 改动记录列表；③ 复制提示词的结果；④ 评论 / 参考图；⑤ 变量绑定 / On this page |
| 小型宣传图 | 440×280 | 推荐提供（列表页展示） |
| 大型宣传图 | 1400×560 | 可选（首页推荐位） |
| 视频 | YouTube 链接 | 可选 |

### 3. 商店文案（草稿）
- **一句话简介**（≤132 字符）：在任何网页上像用 Figma 一样选元素、调样式、写批注，改动自动记成结构化记录，一键复制成 AI 能照着改代码的提示词。
- **类别**：Developer Tools。
- **语言**：zh-CN（可再加 en）。
- **详细描述**：可从 README「功能」段落整理；末尾注明「基于 Google Chrome Labs 的开源项目 VisBug（Apache-2.0）二次开发，与 Google 无隶属关系」。

### 4. 隐私与合规（审核必填）
- **单一用途声明**：帮助设计师 / 产品在网页上可视化标注修改意见并导出给 AI 或开发者。
- **权限理由**（逐条填写）：
  - `activeTab`：用户点击图标或快捷键后，仅在当前标签页注入编辑器。
  - `scripting`：向当前页注入编辑器的脚本与样式。
  - `contextMenus`：右键菜单里提供「开始改稿」与颜色模式切换。
  - `storage`：记住用户选择的颜色模式 / 配色方案偏好（`storage.sync`）。
  - `downloads`：把改动记录导出为 JSON 文件、把参考图落盘。
  - `web_accessible_resources` 匹配 `<all_urls>`：页面需要加载扩展自带的 bundle；不是权限，但审核可能问。
- **数据使用披露表**：勾「不收集、不出售、不传输用户数据」；网页内容只在本地处理，不上传任何服务器（代码里没有网络请求）。剪贴板仅在用户按快捷键时读写。
- **隐私政策 URL**：审核要求提供可访问的网址。仓库根已准备 [`PRIVACY.md`](../PRIVACY.md)，把它发布到 GitHub Pages 或直接填 GitHub 上的文件链接即可。

### 5. 提交前自测
- 用 `dist/*.zip` 解包后以「加载已解压的扩展程序」安装到一个干净的 Chrome 配置文件跑一遍主流程；隐身模式下也试一次。
- Windows 上核对 Ctrl 系快捷键；Mac 上核对 ⌥⌘C 是否被「检查元素」抢走、⌘⇧C 是否能靠点图标授予的 activeTab 截图。
- `package.json` 与 `manifest.json` 的 `version` 一致（打包脚本会拦）。每次重新提交必须升版本号。
- 审核通常 1–3 个工作日；含 `scripting` 的扩展可能触发人工审核，权限理由写具体。

### 6. 可选的减重
`extension/tuts` 是上游工具条的教程 GIF（解包约 6MB）。本产品用自己的工具条，若确认上游教程气泡不再展示，可把 `extension:copy` 里的 `cp -R app/tuts/` 去掉并从 `web_accessible_resources` 删除 `tuts/*.gif`，包体积降到 8MB 以内。
