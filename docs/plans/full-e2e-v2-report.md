# 全量 e2e 第二轮报告（按功能清单 v2）

> 关联：清单见 [feature-inventory-v2.md](feature-inventory-v2.md)（§11 分组）；上一轮报告见 [full-e2e-report.md](full-e2e-report.md)；验收条目见 [../PRD.md](../PRD.md)；修复方案见 [full-e2e-v2-fixes.md](full-e2e-v2-fixes.md)（待写）。

**流程**：6 个 opus 测试 agent 按分组写 / 扩套件并上报疑似 bug（只写测试，不改源码）；每条疑似 bug 由「独立复现」与「对照规范」两个 opus 核验 agent 独立判定。共 38 个 agent，53 分钟。

## 各组结果

| 组 | 通过 | 失败 | 疑似 bug | 覆盖点 | 未测点 | 文件 |
|---|---|---|---|---|---|---|
| A. 网页缩放与视觉视口（功能清单 v2 §10 | 77 | 5 | 3 | 26 | 2 | tests-e2e/zoom.mjs |
| B. 拆分行（四角 / 四边 / 内外边距） | 77 | 5 | 3 | 23 | 0 | tests-e2e/full/split-rows.mjs, tests-e2e/full/fixtures/split-rows.html |
| C. 数值框单位 / 字距百分比 / 线型预览 | 40 | 8 | 4 | 9 | 0 | tests-e2e/units.mjs |
| D. 「On this page」色板 + 变量 | 31 | 2 | 2 | 14 | 0 | tests-e2e/page-colors.mjs, tests-e2e/full/fixtures/page-colors.html, tests-e2e/full/fixtures/page-colors-empty.html |
| E. 键盘换位 / 粘贴守卫 / 把手撤销 /  | 110 | 3 | 1 | 31 | 1 | tests-e2e/keymove.mjs, tests-e2e/paste.mjs, tests-e2e/resize-undo.mjs, tests-e2e/list-follow.mjs, tests-e2e/guides.mjs |
| F. Figma 风格快捷键复核（⌥⌘C/V 属 | 138 | 4 | 3 | 8 | 1 | tests-e2e/copy-props.mjs, tests-e2e/copy-image.mjs, tests-e2e/replace-element.mjs |

合计 473 通过 / 27 失败；疑似 16，**确认 16 / 争议 0 / 否决 0**。

## 未能覆盖的点

- **A.** 10.1.1 的「注入后发一次 tabs.getZoom」那半句：sendZoom(tab_id) 只在 toggleIn() 末尾调用，而 toggleIn 挂在 chrome.action.onClicked / commands 上，Playwright 与 CDP 都无法派发扩展图标点击。已改测同一函数的另一条入口（tabs.onZoomChange → sendZoom）并单独验证了 tabs.getZoom 在现有 manifest 权限下可用、sendMessage 失败被兜住，其余语义全覆盖。
- **A.** 10.6.3 的「拖出的参考线」在产品里目前不可达：app/features/guides.js 的 createGuide() 被 export 但全仓无调用方（grep 只有定义处），页面上从不会出现 [data-visual-revise-guide] 元素。断言改为按 createGuide 的产物形态构造同款 div 验 CSS 契约（选择器命中 + 线宽乘 --vr-inv-zoom）。
- **E.** 4.5.7（「拖出参考线」这一交互本身的运行时路径）：createGuide() 在本分支是死代码——app/features/guides.js 里导出了它，但全仓库（app/ 与 extension/ 打包产物）都没有任何调用点，rollup 已把它摇出 bundle.min.js（`grep -c visualReviseGuide extension/toolbar/bundle.min.js` = 0），页面里根本拖不出这条线。改为两条替代断言：① node 侧读 app/features/guides.js 源码，断言底色是 hsla(330, 100%, 71%, 50%)（不是 70%）且有 guide.dataset.visualReviseGuide 赋值；② 运行时造一个带 data-visual-revise-guide 的节点，把缩放倍数打到 2，断言它确实被 core/zoom.js 的 SCALED 规则命中拿到 --vr-inv-zoom: 0.5。
- **F.** 4.7.4 的「真 captureVisibleTab 截图通道」那一半：headless + addScriptTag 注入的环境里没有扩展进程，channelReady() 恒为 false，只跑得到 DOM 重绘退路（已有断言 mode=fallback 锁住这一点）。要验真通道得 launchPersistentContext + --load-extension（照 tests-e2e/extension.mjs 的写法），不属于本组文件范围。4.7.4 本身的验收要点（键位可达、权限、成功/失败都走 toast、不产生改动记录）已全部有断言。

## 确认的 bug（按严重度）

### B-3 · high · 改动列表里「还原」合成的 border-radius / border-width，会把作者原本只写了一部分的长手一起抹掉

- **清单点**：5.5.7（快照合成 / 撤销）· AC-6.37c、AC-6.38c
- **复现**：1) 页面上有一个只写了部分角长手的元素，例如 style="border-top-left-radius: 9px"（设计稿导出的 `border-bottom-left-radius: 0` 这类覆盖很常见）；2) 注入编辑器后选中它——四角不等，圆角拆分行默认展开；3) 把「右上」改成 15；4) 按 L 打开改动列表，列表里只有一条 border-radius（符合 AC-6.37c）；5) 点这条记录右侧的「×（撤销这一项）」。border-width 同理（元素只写 border-left-width 时）。
- **期望**：退回改动前的样子：四角 9px / 0px / 0px / 0px。5.5.7 明确写着「没在 inline 里写的那一边取计算值……撤销 / 导入写回去不会把那一边归零」。
- **实际**：四角变成 0px / 0px / 0px / 0px——用户没碰过的、作者原本写在 inline 上的左上 9px 被一起删掉，页面落到一个从未存在过的状态。根因在 app/core/snapshot.js 的 revertProp：它把快照里的原始 style 字符串灌进探针再 getPropertyValue('border-radius')，四条长手不齐时 CSSOM 序列化不出简写、返回空串，于是走 el.style.removeProperty('border-radius')，一次删掉四条长手。border-width 的探针同样返回空串。工具条 ⌘Z（history 栈）不受影响，只有改动列表逐条「还原」→ ChangeStore.undoProp → revertProp 这条路中招。
- **证据**：套件断言：✘ 5.5.7  点「还原」退回改动前的样子：左上仍是作者写的 9px（实际 0px），右上回到 0px（实际 0px）
独立复现脚本输出：
  CSSOM：只写了一条长手时 getPropertyValue("border-radius") = ""
  CSSOM：同理 border-width                              = ""
  改动前 四角（左上/右上/右下/左下） 9px / 0px / 0px / 0px
  改右上为 15 之后 四角           9px / 15px / 0px / 0px
  改动列表里的条目                [ 'border-radius' ]
  点「还原」之后 四角             0px / 0px / 0px / 0px
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-B-3.mjs`
- **核验（high）**：独立复现成功，两次运行结果完全一致，且与上报完全吻合。我的脚本 /private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/verify-B-3-repro.mjs 从零写：自建 fixture 页面 + 自建 http server，注入仓库里现成的 app/bundle.min.js（build 2026-09-07T18:23:19.412Z，比 snapshot.js/change-store.js 都新，没有 rebuild），真实点击选中元素，再点改动列表 shadowRoot 里那个 .undo-prop 的「×」按钮，没有引用上报者的任何测试文件。

圆角（元素 style="border-top-left-radius: 9px"）：
- 改动前 四角 9px / 0px / 0px / 0px，inline = "border-top-left-radius: 9px;"
- 把「右上」改成 15px 后 四角 9px / 15px / 0px / 0px
- 改动列表里确实只有一条 border-radius（符合 AC-6.37c）
- 点「×」之后 四角 0px / 0px / 0px / 0px，inline 变成空串 —— 用户从未碰过、作者原本写在 inline 上的左上 9px 被一起删掉

描边（元素 style="border-left-width: 6px"，样式表 border-
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/core/snapshot.js 第 263-272 行的 revertProp：

  const probe = document.createElement('div')
  probe.style.cssText = inlineStyle || ''
  const original = probe.style.getPropertyValue(prop)
  original ? el.style.setProperty(...) : el.style.removeProperty(prop)

探针只灌了快照时的原始 inline 字符串。按 CSSOM 的简写序列化规则，四条长手不齐时简写读不出来（返回空串），于是走 else 分支 el.style.removeProperty('border-radius') —— 而对简写调 removeProperty 会一次删掉全部四条长手，包括作者原本写在 inline 上、用户根本没碰过的那一条。border-width 同理。

唯一调用者是 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/core/change-store.js 第 1173 行的 undoProp，正是改动列表 .undo-prop「×」按钮绑定的动作（app/components/change-list/change-list.element.js 第 429-432 行）。revertAll（undoElement / 重置）整体写回 style 属性，不受影响；history 栈的 ⌘Z 用 op.before/after 回放，也不受影响。

修复方向：revertProp 对 SYNTH 里的 border-radius / border-width 不能走裸 getPropertyValue + removeProperty，应该直接用快照里已经合成好的 snapshot.inline
- **核验（high）**：真 bug，且期望完全符合规范。(1) 规范原文站在报告这边：docs/PRD.md:275 AC-6.38c 明写「改动记录 / 导出 / 撤销仍只有一条 border-width（……没在 inline 里写的那一边取计算值）」，docs/plans/feature-inventory-v2.md:385-389 的 5.5.7 更是逐字写着「撤销 / 导入写回去不会把那一边归零」；同一句话还被抄在 app/core/snapshot.js 的 SYNTH 注释里，是作者自己写下的意图。(2) 复现成立：跑上报者的 repro-B-3.mjs 得到「改动前 9px/0/0/0 → 改右上 15 → 列表只有一条 border-radius → 点还原后 0px/0px/0px/0px」，与上报一致。(3) 我另跑一个脚本拿到工具自己导出的改动记录是「border-radius: 9px 0px 0px 0px → 9px 15px 0px 0px」，即它自己记录的前值就是 9px 0px 0px 0px，点这条记录的「还原」却落到 0 0 0 0，并且还原后元素 style 属性里作者原写的 border-top-left-radius:9px 直接消失——这是与它自身记录的自相矛盾，不依赖任何规范解读。(4) border-width 同样中招：模块级验证里，只写 border-left-width:6px 的元素在 revertProp(snap,'border-width') 之后从 3px/3px/3px/6px 变成 3px/3px/3px/3px，作者的 6px
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/core/snapshot.js 第 263-272 行 revertProp：它把快照的 inlineStyle 字符串灌进探针后用 probe.style.getPropertyValue(prop) 取原值。对 SYNTH 里的两条合成简写（border-radius / border-width），CSSOM 只在四条长手都存在时才序列化出简写，作者只写了一部分长手时返回空串，于是走 else 分支 el.style.removeProperty(prop)——移除简写会一次删掉四条长手，把用户从没碰过、作者原本写在 inline 上的那一角/那一边一起抹掉。修法应与同文件的 readInline / synthShorthand 对称：revertProp 遇到 SYNTH 键时优先用快照里已经算好的 snapshot.inline[prop]（本例就是 "9px 0px 0px 0px"），或按 synthShorthand 的规则从探针 + snapshot.computed 重新合成，再把四条长手写回去，而不是 removeProperty。附带要一起修 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/core/change-store.js 第 1166-1181 行 undoProp：它用简写的 getPropertyValue 做 before/after 比对，长手不齐时两边同为空串导致不入 history，ChangeStore 的还原动作因此进不了撤销栈、⌘Z 救不回来；这里应改成比对四条长手（或用合成值）来判定是否发生变化。

### C-1 · high · 字号数值框没有单位后缀位：非 px 单位在界面上完全不可见，隐藏的 data-unit 又被补进下一次的裸数字（20 → 20em，字号 24px→320px）

- **清单点**：2.3.14 / 2.3.15（AC-6.39a、AC-6.39b）
- **复现**：1) 注入面板，选中一个 font-size:15px 的文字元素（tests-e2e/units.mjs 里的 #u-txt）；2) 展开 Typography，在字号框里敲 `1.5em` + Enter；3) 看字号框：框里是 1.5，右侧没有任何单位标识（同一行右边的行高框敲 1.5em 后会显示 “em” 后缀）；4) 在同一个字号框里敲裸数字 `20` + Enter。
- **期望**：字号框和它同一行的行高框一样，把单位放在框外最右：框="1.5"、后缀="em"（2.3.14）。用户据此敲 20 得到 20em；若界面上根本不显示单位，则裸数字应按默认单位写成 20px——两者必居其一，框里看得见的东西必须能推出写进去的单位。
- **实际**：字号框由 #renderTypography 的 typo-pair 手写模板渲染（props-panel.element.js:844-848），整段没有 `<span class="suffix">`，也没有初始 data-unit；提交后 #showValue 只能把单位塞进看不见的 data-unit="em"。于是框里显示 "1.5" 而没有任何单位，紧接着敲 20 写出 `font-size: 20em`，计算字号从 24px 跳到 320px。同一行的行高框（走 #renderControl）行为正确。
- **证据**：套件断言原文：
  ✘ 2.3.14d  字号框的单位也要放框外最右：inline="1.5em" 期望 框="1.5" 有后缀元素且后缀="em"（与同行的行高一致），实际 框="1.5" 有后缀元素=false 后缀=(没有后缀元素)
  ✘ 2.3.15d  敲裸数字 20 时，写进去的单位必须是框里看得见的那个：期望 要么框里显示过 em（则写 20em）、要么按默认单位写 "20px"，实际 框里没有任何单位标识却写出 "20em"（字号 320px，单位来自看不见的 data-unit="em"）
独立脚本输出：
  初始       fontSize {box:"15", unit:"(无 data-unit)", suffixEl:false} / lineHeight {box:"22.5", unit:"px", suffix:"px"}
  敲 1.5em   fontSize {box:"1.5", unit:"em", suffixEl:false} → 计算字号 24px
  再敲 20    fontSize {box:"20", unit:"em"} → inline "20em"、计算字号 320px
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-C-1.mjs`
- **核验（high）**：独立复现成功，两轮结果完全一致（自写 fixture #mytext font-size:15px、自写脚本 verify-C-1-repro.mjs，未参考上报者的 units.mjs / repro-C-1.mjs）：字号框的 .control 里只有 "Aa" 前缀和 input，没有 .suffix 元素，初始也没有 data-unit；敲 1.5em 后框里显示 "1.5"、隐藏的 data-unit="em"、界面上任何位置都看不到单位（同一行、同样列宽的行高框敲 1.5em 后正常显示后缀 "em"）；紧接着敲裸数字 20，change 处理器把不可见的 data-unit 补回去，写出 inline font-size:20em，计算字号从 24px 跳到 320px。用户界面上能看见的只有 "1.5"/"20"，推不出写进去的单位，属于界面在说谎、且造成 13 倍的意外放大。不是测试臆造的验收点：docs/plans/feature-inventory-v2.md:55 的 2.3.14 明确要求「数值框的单位只做展示、放在框外最右」（对象是「数值框」而非只有 #renderControl 的框），:58 的 2.3.15 定义 data-unit 回填；代码自己的注释（props-panel.element.js:2265-2266、2656-2659）也写着「单位在后缀里、不在框里」，即回填逻辑的前提就是后缀可见。构建产物不背锅：extension/toolbar/bundle.min.js（Sep 8 02:23）比源码（01:40）新，且 bundle
  - 根因线索：app/components/props-panel/props-panel.element.js 的 #typographyRows()（约 838-849 行）手写了字号那个 .control 模板：`<div class="control"><span class="prefix" data-drag data-prop="font-size">Aa</span><input type="text" data-prop="font-size" data-num value="${displayValue('font-size', this.#computed['font-size'])}" title="font-size"></div>` —— 既没有 `<span class="suffix">`，也没有初始 `data-unit=""`，而且 value 取的是 #computed 而不是 #numSource。对照 #renderControl（2204-2255，尤其 2249-2250 行）生成的是 `input ... data-unit="${shown.unit}"` + `<span class="suffix">`。于是 #showValue（2266-2274）里 `input.dataset.unit = shown.unit` 照常写，但 `input.parentElement?.querySelector('.suffix')` 取不到节点、单位无处显示；再由 change 处理器（2656-2659）`if (el.hasAttribute('data-num') && el.dataset.unit && /^-?[\d.]+$/.test(raw)) raw = raw.trim() + el.dataset.unit` 把这个不可见单位补进裸数字。同一处遗漏还在 #renderAlignGap 的 gap（约 943-945）、#renderDims 的 min/max 宽高（约 2108-2110）以及 width/hei
- **核验（high）**：对照 PRD 确认「期望」就是规范要求，不是测试理解错。AC-6.39a（docs/PRD.md:278）把「数值框的单位只做展示、放最右」写成通用规则，并明确点名要拆出来的单位里包含 em；docs/plans/feature-inventory-v2.md 的 §2.3「分区通用行为」同样把 2.3.14 定为所有数值框的行为，没有任何一条把字号框排除在外。字号框走的是 #typographyRows() 里手写的 typo-pair 模板（props-panel.element.js:838-849），整段既没有 <span class="suffix"> 也没有 data-unit，而同一行的行高框走 #renderControl 就有——同一份 AC 下两个相邻控件行为不一致，本身就说明是遗漏而非有意设计（CONTROLS['font-size'] 是普通 num('字号')，FIELD_PREFIX 里也有 'Aa'，直接用 #renderControl 渲染就能得到一模一样的外观）。我重跑了上报者的 repro-C-1.mjs，现象逐条复现：初始 fontSize{box:"15", 无 data-unit, suffixEl:false}；敲 1.5em 后 box="1.5"、data-unit="em"、仍无后缀元素（计算字号 24px）；再敲裸数字 20 写出 inline font-size:20em，计算字号 320px；对照组行高框敲 1.5em 正确显示后缀 em。我另写了一个脚本核验重绘路径，发现同一处模板还有第二个偏差：元素 inline 是 
  - 根因线索：主因：app/components/props-panel/props-panel.element.js 的 #typographyRows()（约 838-849 行）手写 typo-pair 模板，渲染 `<input data-prop="font-size" data-num value="${displayValue('font-size', this.#computed['font-size'])}">` —— 既没有兄弟节点 `<span class="suffix">`，也没有 data-unit 初值，且显示源用 #computed 而不是 #numSource（后者才是 2.3.17 要求的 inline 优先）。放大它的是 #showValue（2266-2274 行）：它无条件写 input.dataset.unit = shown.unit，但更新后缀那一句被 `if (suffix)` 守卫吞掉，缺后缀元素时静默跳过，于是单位只存在于隐藏属性里；随后 change 处理器（约 2653-2657 行）`if (el.hasAttribute('data-num') && el.dataset.unit && /^-?[\d.]+$/.test(raw.trim())) raw = raw.trim() + el.dataset.unit` 把这个看不见的 em 补进裸数字，写出 font-size: 20em。修法方向：把 typo-pair 里的字号控件换成 this.#renderControl('font-size', { dragPrefix: true })（spec 与 FIELD_PREFIX 已齐备，输出等价且自带 data-unit + .suffix，.suffix:empty{display:none} 保证 px 时不占位），或至少给该模板补上 data-unit 与 .suffix 并改用 #numSource。同一类遗漏还在 #renderSplitRow 的收起态单框（1178 行，border-radius /

### C-4 · high · 外部改动（⌘Z 撤销）换成「同数字、不同单位」时 #syncValues 只比数字就整条跳过，后缀与 data-unit 停在旧单位；再按一次 ↑ 写出差 360 倍的 46turn

- **清单点**：2.3.18 / 2.3.14（AC-6.39a、AC-6.39b）
- **复现**：1) 页面上放一个 `rotate: 45deg` 的元素，选中它；2) 在旋转框里敲 `45turn` + Enter，失焦——框="45"、后缀="turn"；3) 按 ⌘Z 撤销（焦点不在框里）——元素回到 45deg；4) 点回旋转框按一次 ↑。
- **期望**：第 3 步撤销后面板跟着回退：框="45"、后缀="°"、data-unit="deg"；第 4 步写出 `rotate: 46deg`。
- **实际**：#syncValues 里 `if (el.value !== value)` 才调 #showValue（props-panel.element.js:538-542）——数字都是 "45" 没变，整条判断被跳过，后缀与 data-unit 停在 turn 上。撤销后元素是 45deg，面板却写着 45 turn；再按一次 ↑ 写出 `rotate: 46turn`（计算值 16560deg），元素猛转，与用户看到的「46°」差 360 倍。同类场景还包括导入快照、重置本组等一切走 ChangeStore 回写的外部改动。
- **证据**：套件断言原文：
  ✘ 2.3.18d  ⌘Z 退回 45deg 后后缀要跟着回退：期望 inline="45deg" 框="45" 后缀="°" data-unit="deg"，实际 inline="45deg" 框="45" 后缀="turn" data-unit="turn"
  ✘ 2.3.18e  撤销后再步进要按真实单位 deg 走：期望 inline rotate="46deg"，实际 "46turn"（46turn = 16560°，差了 360 倍）
独立脚本输出：
  起点 45deg   {框:"45", data_unit:"deg",  后缀:"°",    inline:"45deg"}
  改成 45turn  {框:"45", data_unit:"turn", 后缀:"turn", inline:"45turn"}
  ⌘Z 撤销后   {框:"45", data_unit:"turn", 后缀:"turn", inline:"45deg"}   ← 元素回到 45deg，面板还写着 turn
  再按一次 ↑   {框:"46", data_unit:"turn", 后缀:"turn", inline:"46turn"}  计算值 16560deg
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-C-4.mjs`
- **核验（high）**：独立复现成功，且稳定（同一脚本跑两次结果完全一致，无时序依赖）。按上报的四步、用自己从零写的脚本（新建一个 rotate:45deg 的 div，而不是套件的夹具元素）：敲 45turn 后面板 data-unit/后缀变成 turn；⌘Z 后元素 inline 回到 45deg，但面板仍是 框="45" data-unit="turn" 后缀="turn"；再按一次 ↑ 写出 inline rotate="46turn"（computed 16560deg），与用户在面板上看到的「46」差 360 倍。对照实验进一步锁死机制：把改动换成数字也变的 30turn，⌘Z 后后缀/data-unit 正确回退成 °/deg、↑ 写出 46deg——说明失效条件正是「数字相同、只有单位变了」。泛化实验显示这不是只有 turn 这种罕见单位才踩得到：width 100px → 敲 100% → ⌘Z → ↑ 同样写出 101%（元素实为 100px），属于日常操作。源码层面也对得上：#syncValues 里给数值框算出的 value 只是数字部分（第 505 行 splitUnit(...).num），所以第 538 行 `if (el.value !== value)` 在单位变化时判等成立，整条 #showValue 被跳过，data-unit 与 .suffix 停在旧单位；随后 ↑ 的处理（第 2887 行 `input.value + input.dataset.unit`）和 change 提交（第 2658 行）都拿这个陈旧单位拼字符串，于是写出错误单位的合法 CSS，
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/props-panel/props-panel.element.js 的 #syncValues（第 479 行起）。第 503-505 行给 data-num 输入框算出的比较值只有数字部分：`isNum ? (CONTROLS[prop]?.unit ? displayValue(...) : splitUnit(displayValue(prop, css, this.#computed)).num) : ...`；第 538-541 行用 `if (el.value !== value)` 作为唯一闸门去调 #showValue(el, prop, css)。单位变了但数字没变时（45deg↔45turn、100px↔100%），el.value 与 value 都是 "45"/"100"，整条分支被跳过，#showValue（第 2266-2274 行，负责写 input.dataset.unit 与 .suffix.textContent）根本不执行，面板的单位状态停在旧值。这条路只在「只发通知不重绘」的外部回写上暴露：connectedCallback 第 371-374 行 `ChangeStore.subscribe(() => { this.#syncValues(); this.#refreshDirty() })`，⌘Z/⌘⇧Z（app/core/visual-revise.js:262-273 的 doUndo）走的正是它；而 #resetGroup（第 2403-2417 行）因为额外调了 this.render() 所以不受影响（上报里说「重置本组」同样中招，这一点实测不成立）。下游放大点：方向键步进 handler 第 2887 行 `stepValue(prop, input.value + (input.dataset.unit || ''), ...)`，以及 change handler 第 2657-2659 行同
- **核验（high）**：真 bug，已独立复现并对照规范核实。(1) 源码机制与上报一致：props-panel.element.js:540 的 `if (el.value !== value)` 对 data-num 输入框只比较数字部分——line 500 拿到的 `value` 是 `splitUnit(displayValue(...)).num`，单位存在 `el.dataset.unit` 和 `.suffix` 里，二者都不参与比较，而它们只由 `#showValue`（2266-2274）写。数字没变就整条跳过，后缀与 data-unit 停在旧单位。(2) `#syncValues` 正是外部改动的入口（371-374 `ChangeStore.subscribe`），⌘Z / 导入 / 重置本组都走这里；`#structureKey()`（479-482）只在 Stroke 有无时整块重绘，不会兜住这个漏。(3) 期望符合规范，不是测试理解错：AC-6.39a（docs/PRD.md:278）规定后缀就是元素真实单位的展示，AC-6.39b（:279）规定步进按框里当前单位走，AC-6.6a（:262）「界面数字不得领先于元素实际值」，AC-6.36e（:228）已把撤销/重做/导入点名为面板必须跟随的外部改动；`#syncValues` 自己在 511-513 的注释也写明「外部改动确实发生了」。它同步了数字却漏了单位，是实现缺口而非规范分歧。(4) 跑了上报者的复现脚本（未改动），输出与上报逐行一致：⌘Z 后 inline=45deg 而面板 data_unit/后缀=tur
  - 根因线索：主因：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/props-panel/props-panel.element.js 的 #syncValues（479-543），脏值判断 `if (el.value !== value)`（538-541）对 data-num 输入框只比数字——line 500 的 `value` 是 `splitUnit(displayValue(prop, css, this.#computed)).num`，单位落在 `el.dataset.unit` 与同级 `.suffix` 上，只由 #showValue（2266-2274）写入，从不参与比较。修复方向：对 isNum 且未聚焦的输入框，把单位一并纳入比较（例如比 `el.value + (el.dataset.unit || '')` 与完整 displayValue，或比 `splitUnit(displayValue(...)).unit !== el.dataset.unit`），任一不等就调 #showValue；注意 CONTROLS[prop].unit 固定单位那一支（opacity / letter-spacing）data-unit 为空，别误判成一直不等而每次重写。次因（同一处修好即消失）：方向键步进处 props-panel.element.js:2887 用 `input.value + (input.dataset.unit || '')` 拼步进源，让过期的 data-unit 盖过元素真实计算值 45deg，把「后缀显示错」放大成写出差 360 倍的 46turn；对照 app/core/controls.js:358-366 stepValue 的单位优先级（框内文本 → fallback 计算值 → coerce 默认）可见，只要 data-unit 是对的，这条路径本身没问题。

### E-1 · high · ⇧ 点击把元素移出多选后它仍留在选择引擎里：方向键换位、属性面板改样式、改动列表高亮全都还算上它

- **清单点**：4.1.27（多选换位）/ 5.1.19（多选全亮、换选高亮移走）；根因在 app/features/selectable.js 的 unselect()
- **复现**：1. 起 tests-e2e/fixture.html，injectVisBug 注入编辑器（默认 guides 工具、select 模式）
2. 点第 1 张 .curve-card 选中
3. ⇧ 点第 2 张 .curve-card（两张都选中，页面上 2 个 data-selected、2 个 visbug-handles）
4. 再 ⇧ 点一次第 2 张，把它移出多选——它的 data-selected 被清掉、选中框消失，界面上看起来已经不选它了
5. 按 ↓（键盘换位）；或在属性面板里把不透明度改成 50%
- **期望**：第 4 步之后选择引擎里只剩 1 个元素：engine.selection().length === 1；按 ↓ 只把仍被选中的那一张往后挪一位、只产生 1 条移动记录；面板改的不透明度只落到那一张；改动列表里只有那一张的条目还高亮。
- **实际**：第 4 步之后 engine.selection().length 仍是 2（DOM 上只剩 1 个 data-selected、1 个 visbug-handles，两者已经对不上）。按 ↓ 把两张卡都挪了、产生 2 条移动记录（顺序 Original|Five|Nine → Nine|Original|Five）；面板改不透明度时被移出选中的那张也一起被写成 0.5；改动列表里两组条目都还亮着。

根因：app/features/selectable.js:165-177，先把节点上的 data-label-id 清成 null，再用同一个属性把它从 selected 里过滤出去——

    selected.filter(node => node.getAttribute('data-label-id') === id)
      .forEach(node => $(node).attr({ ..., 'data-label-id': null, ... }))   // ← id 已被抹掉
    selected = selected.filter(node => node.getAttribute('data-label-id') !== id)  // ← 永远为真，节点从没被摘掉

随后的 tellWatchers() 于是把陈旧的 selected 广播出去，面板 setTargets / 列表 setSelected / onKeydown 的 engine.selection() 全部受影响（⌥Delete 清样式、Delete 删元素、⌘V 粘贴走的也是同一个 selection）。
- **证据**：keymove.mjs 断言输出：
  ✔ ⇧ 再点一次把第二张移出多选：页面上 data-selected 期望从 2 个变成 1 个（实际 2 → 1）
  ✘ 移出多选后选择引擎里也该只剩 1 个（engine.selection() 期望 1，实际 2）
  ✘ 移出多选后 ↓ 只该挪仍被选中的那一张：期望「Thinking Five | Original Thinking | Thinking Nine」/ 1 条移动记录（起点「Original Thinking | Thinking Five | Thinking Nine」，实际「Thinking Nine | Original Thinking | Thinking Five」/ 2 条）

list-follow.mjs 断言输出：
  ✔ 两张卡都选中时：期望 2 组条目高亮（实际 2 组：article.curve-card:nth-of-type(1)、article.curve-card:nth-of-type(2)）
  ✘ ⇧ 把第二张移出多选后（页面上只剩 1 个 data-selected）：期望只剩 1 组高亮（实际 2 组：article.curve-card:nth-of-type(1)、article.curve-card:nth-of-type(2)）

独立复现脚本输出：
  两个都选中      {"domSelected":2,"engineSelection":2,"handles":2}
  ⇧ 取消第二张后  {"domSelected":1,"engineSelection":2,"handles":1}   ← engineSelection 期望 1
  ↓ 之后 [ 'Thinking Nine', 'Original Thinking', 'Thinking Five' ]  ← 期望只有第一张往后挪一位
  移动记录 2 条  ← 期望 1
  面板改不透明度后各卡片的行内 opacity = [ '(无)', '0.5', '0.5' ]  ← 期望只有仍被选中的那一张有值
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-E-1.mjs`
- **核验（high）**：独立复现成功，3 次运行结果完全一致（确定性，不依赖时序）。我没有看上报者的测试代码，只按复现步骤从零写了 /private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/verify-E-1-repro.mjs：

关键输出（三次运行相同）：
- ⇧ 点第 2 张后：domSelected=2 / engineSelection=2 / handles=2，labelIds=["2","1"]
- 再 ⇧ 点第 2 张后：domSelected=1 / handles=1，但 engineSelection 仍是 2，labelIds=[null,"1"] ← 残留项的 data-label-id 已被抹成 null，正是「先清属性再按同一属性过滤」的指纹
- 按 ↓：顺序从 Original|Five|Nine 变成 Nine|Original|Five，store.read().moves = 2 条（期望只挪仍选中的那张、1 条记录，结果应为 Five|Original|Nine）
- 对 engine.selection() 写 opacity:0.5 后，三张卡的行内 opacity = ["(无)","0.5","0.5"]（重排后对应 Nine 无值、Original 0.5、被移出选中的 Five 也被写成 0.5）

泛化验证（verify-E-1-general.mjs）：换元素类型和位置都一样——两个
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/features/selectable.js:165-177，unselect(id) 里两步的先后顺序写反了：

    selected.filter(node => node.getAttribute('data-label-id') === id)   // 165-166 先按 id 挑出目标
      .forEach(node => $(node).attr({ ..., 'data-label-id': null, ... })) // 167-175 顺手把 id 抹掉
    selected = selected.filter(node => node.getAttribute('data-label-id') !== id) // 177 再按已被抹掉的属性过滤 → 恒为 true

blingblingjs 的 attr(attr, null) 走 removeAttribute（node_modules/blingblingjs/src/index.js:16-21），所以到 line 177 时目标节点的 data-label-id 已是 null，`null !== "2"` 恒真，selected 一个都没摘掉；line 179 的 tellWatchers() 随即把这份陈旧数组广播给所有 selectedCallbacks。

对照写法在同文件 line 513 的 unselect_all()：它先 forEach 清属性、再无条件 `selected = []`，不靠属性做判定，所以没这个问题。

修法方向：先把要摘的节点按引用捞出来（`const gone = selected.filter(n => n.getAttribute('data-label-id') === id)`），用 `selected = selected.filter(n => !gone.includes(n))` 收缩数组，再对 gone 清属性——和上
- **核验（high）**：真 bug，且上报的「期望」正是 PRD 的规范要求，不是测试理解错。规范侧：docs/PRD.md AC-3.2「Shift 单击多选；再次 Shift 单击已选中的元素则取消它」——「取消」就是退出选择集；AC-7.13「多选各自挪一位」与 AC-8.18「换选移走，取消选中清掉，多选全亮」都以选择集为准，所以 ⇧ 取消后方向键换位、面板改样式、列表高亮都不该再算上它。代码侧：app/features/selectable.js:165-177 的 unselect(id) 先用 $(node).attr({'data-label-id': null}) 清属性（blingblingjs 的 attr(key,null) 走 removeAttribute，见 node_modules/blingblingjs/dist/index.js:26），再用同一个属性做 `selected = selected.filter(node => node.getAttribute('data-label-id') !== id)`——此刻这些节点的属性已是 null，null !== '2' 恒真，节点从未被摘掉；其上的 labels/handles 清理因为跑在清属性之前所以有效，这正解释了「DOM 掉了 1 个、引擎还是 2 个」的错位。随后 tellWatchers() 把陈旧数组广播给所有 onSelectedUpdate 订阅者。该缺陷同样存在于 e2e harness 实际加载的产物 extension/toolbar/bundle.min.js（压缩后逻辑一致：r=r.
  - 根因线索：app/features/selectable.js:165-177，unselect(id) 内部的语句顺序错误：先把命中节点的 data-label-id 用 $(node).attr({...,'data-label-id':null,...}) 清成 null（blingblingjs 的 attr(key,null) = removeAttribute），再用同一个属性做 `selected = selected.filter(node => node.getAttribute('data-label-id') !== id)`，谓词恒真，节点永远摘不掉；紧接着的 tellWatchers() 把陈旧 selected 广播出去。修法：先按属性把要摘的节点取成引用数组，再清属性，最后按引用（而非属性）从 selected 里剔除，例如 `const removed = selected.filter(n => n.getAttribute('data-label-id') === id); removed.forEach(n => $(n).attr({...null...})); selected = selected.filter(n => !removed.includes(n))`。注意该缺陷同样固化在 extension/toolbar/bundle.min.js 里，修完需重新 bundle 才能让 e2e harness 验证到。

### A-1 · medium · 网页缩放 ≠100% 时右对齐的菜单弹层与锚点脱开，150% 下差 90 设备像素

- **清单点**：10.5.1（AC-5.11「四个弹层的屏幕尺寸与位置都不随页面缩放改变」）
- **复现**：1) 任意页面唤起编辑器，选中一个元素（如 .hero-title）；2) 浏览器缩放到 150%（⌘+ 两下，或 chrome.tabs.setZoom(tabId,1.5)）；3) 点属性面板 Layout 分区「尺寸」那行宽度右侧的尺寸模式按钮 .mode[data-axis="width"]，打开菜单。
- **期望**：菜单是 align:'right'，右缘应始终贴着触发按钮的右缘（100% 下就是这样），屏幕上的位置不随缩放改变。
- **实际**：菜单整体向左偏出 w·(1−1/k)：k=1 差 0px，k=1.5 差 60 CSS px（屏幕 90px），k=2 差 90 CSS px（屏幕 180px）。菜单明显飘在按钮左边、与锚点断开。根因在 app/components/controls/menu.js 的 openMenu 定位段：`const rect = anchor.getBoundingClientRect()`（锚点在已 scale(1/k) 的面板里，拿到的是缩过的视口坐标）与 `const w = panel.offsetWidth` / `const h = panel.offsetHeight`（弹层宿主的布局盒，scale 之前，比屏幕上大 k 倍）混用，`left = rect.right - w` 因此偏 w−w/k。同一段的 `Math.min(left, innerWidth - w - 8)` 夹取、以及 `below >= h + 12 ? rect.bottom + 6 : rect.top - h - 6` 的「向上翻」判断与落位用的都是没缩过的 h，向上翻时会在锚点上方留出 h·(1−1/k) 的空档（这两处由读码得出，未单独断言）。
- **证据**：套件输出：`✘ 10.5.1 缩放 1.5：右对齐菜单的右缘仍贴锚点右缘（屏幕上的位置不随缩放变） ← [疑似 BUG A-1] 期望菜单右缘 1314.0，实际 1254.0（差 60.0 CSS px = 屏幕上 90.0px）`。真实扩展 + chrome.tabs.setZoom(1.5) 复核：`✘ BUG A-1 真实缩放复核：150% 下菜单右缘应仍贴锚点右缘 ← 期望 834.2，实际 774.2（差 60.0 CSS px ≈ 屏幕 90.0px）`，同一脚本里 100% 那条通过。截图 /private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/bug-A-1-k1.5.png 可见菜单浮在按钮左侧。
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-A-1.mjs`
- **核验（high）**：独立复现成功且完全确定性：我按复现步骤从零写了 /private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/verify-A-1-repro.mjs（只用 tests-e2e/harness.mjs 的通用基建，没有看上报者的 repro-A-1.mjs 或其套件），两条互相独立的缩放通路各跑两遍共 4 次，结果每次一致：k=1 时菜单右缘与锚点右缘完全重合（1251.0 vs 1251.0），k=1.5 差 −60 CSS px（屏幕 90px），k=2 差 −90 CSS px（屏幕 180px），与 w·(1−1/k)（w=180 布局宽）逐位相符。第二条通路用 CDP 同时改 DPR 与视口 CSS 宽（DPR×k、innerWidth÷k），不写 data-visual-revise-zoom 属性、不发事件，走的是 zoom.js「页面自己察觉」那条路，等价于真实浏览器缩放；它 k=1.5 的读数（anchor.right=834.0 / menu.right=774.0）与上报者用真实扩展 + chrome.tabs.setZoom 复核的 834.2 / 774.2 吻合。读码也印证机制：popover-host.js 给弹层宿主加了 transform: scale(1/k) + transformOrigin: top left，所以渲染右缘是 left + w/k，而 menu.js 用 left 
  - 根因线索：app/components/controls/menu.js 的 openMenu 定位段（179-187 行）：rect = anchor.getBoundingClientRect() 拿的是 scale 之后的视口 CSS 坐标，而 h = panel.offsetHeight / w = panel.offsetWidth 拿的是 scale 之前的布局盒——弹层宿主在 app/components/controls/popover-host.js:45-49 被加了 transform: scale(1/zoomFactor()) 且 transformOrigin: top left，屏幕上的宽高是 w/k、h/k。四处都得按 k 折算：右对齐的 left = rect.right − w（应为 rect.right − w/k）、夹回视口的 Math.min(left, innerWidth − w − 8)（应为 innerWidth − w/k − 8）、向上翻的判断 below >= h + 12 || below >= rect.top、以及向上翻的落位 rect.top − h − 6（应为 h/k；另外 6px 间距在 k≠1 时屏幕上会变成 6k px）。同一段在同文件 openPopover（211-219 行）里逐字重复了一遍，Grid 之类的自定义弹层同病；app/components/controls/select.element.js:231-234、fill.element.js:434-435、color-popover.js:284-285 也用未折算的 offsetWidth/offsetHeight 做夹取，属同一类，建议抽一个共用的「按 zoomFactor() 折算后的弹层尺寸」定位函数一并修。
- **核验（high）**：真 bug，且上报者的「期望」就是规范本身。PRD AC-5.11（docs/PRD.md:154）明写四个弹层「屏幕尺寸与位置都不随页面缩放改变」，功能清单 10.5.1（docs/plans/feature-inventory-v2.md:474）把实现约束写成「scale(1/k) + transformOrigin top left，缩完左上角还贴着锚点」。popover-host.js:45-49 给宿主加了 scale(1/k)，因此宿主在屏幕上的可见宽度是 offsetWidth/k；而 menu.js:179-186 定位时把「已缩过」的 anchor.getBoundingClientRect() 和「没缩过」的 panel.offsetWidth 混用：align:'right' 下 left = rect.right - w，可见右缘落在 rect.right - w + w/k，恒定偏左 w·(1-1/k)。min-width:180px 正好给出 k=1.5 差 60 CSS px、k=2 差 90 CSS px。align:'left' 之所以没事，是因为 rect.left 配 top-left 原点本来就与缩放无关——说明这段只考虑了左对齐。原样跑上报者的 repro-A-1.mjs 复现：k=1 差 0.0、k=1.5 差 60.0（屏幕 90.0px）、k=2 差 90.0（屏幕 180.0px），与套件与真实扩展 chrome.tabs.setZoom 的数字完全一致。我另外核过这次偏移不是视口夹取造成的：实测 left=1134 未触到 
  - 根因线索：app/components/controls/menu.js 的 openMenu 定位段（约 179-186 行）坐标系混用：`const rect = anchor.getBoundingClientRect()` 是变换后的可视坐标（锚点在已 scale(1/k) 的属性面板里），而 `const w = panel.offsetWidth` / `const h = panel.offsetHeight` 是 popover-host.js:45-49 加 scale 之前的布局盒（屏幕上比可见尺寸大 k 倍）。修法是先取 `const k = zoomFactor()`（app/core/zoom.js 已导出，menu.js 目前没 import），一律用可见尺寸 w/k、h/k 参与运算：`left = align === 'right' ? rect.right - w / k : rect.left`；同段的 `Math.min(left, innerWidth - w - 8)` 夹取与 `below >= h + 12 ? rect.bottom + 6 : rect.top - h - 6` 的向上翻判断/落位同样要换成 w/k、h/k（否则近右缘会多夹 w(1-1/k)，向上翻时锚点上方留 h(1-1/k) 的空档），且 innerWidth/innerHeight 应改成 zoom.js 的 viewportBox() 以覆盖捏合。openPopover（menu.js:211-218）是同一段代码的逐字副本，props-panel.element.js:1575 的 align:'right' 弹层同病，需一并改。

### A-2 · medium · 网页缩放 ≠100% 时 vr-select 下拉在屏幕上比触发器窄 k 倍

- **清单点**：10.5.1（AC-5.11「弹层的屏幕尺寸不随页面缩放改变」；亦违反 3.1.2「minWidth 跟触发器同宽」）
- **复现**：1) 唤起编辑器，选中 .hero-title；2) 浏览器缩放到 150%（或 200%）；3) 点属性面板 Position 分区的 vr-select[data-prop="position"] 打开下拉。
- **期望**：下拉的 minWidth 应与触发器同宽，屏幕上看下拉不窄于触发器；100% 下确实如此（274px 触发器配 274px 下拉）。
- **实际**：屏幕宽度按 1/k 缩水：k=1.5 时 274px 的触发器只配了 182.7px 的下拉；k=2 时只有 137.0px。根因在 app/components/controls/select.element.js 的 #toggle 定位段：`panel.style.minWidth = `${rect.width}px`` 里的 rect 是锚点已 scale(1/k) 后的屏幕宽，写到弹层宿主的布局盒上，而宿主随后又被 popover-host 统一 scale(1/k)，于是被缩了两次。同段的 `Math.min(rect.left, innerWidth - panel.offsetWidth - 8)` 与 `below >= height + 12` 同样混用了缩过 / 没缩过的两套尺寸。
- **证据**：套件输出：`✘ 10.5.1 缩放 1.5：下拉的屏幕宽度不小于触发器（minWidth 应与触发器同宽） ← [疑似 BUG A-2] 期望 ≥ 触发器宽 182.67 CSS px，实际 121.77（屏幕上 274.0px 的触发器配了 182.7px 的下拉）`。真实扩展 + tabs.setZoom(1.5)：`✘ BUG A-2 真实缩放复核：150% 下拉宽度应仍 ≥ 触发器宽度 ← 期望 ≥ 183.11，实际 122.07（屏幕上触发器 274.7px、下拉 183.1px）`，同脚本 100% 那条通过。repro 输出：k=1 → 274.0/274.0，k=1.5 → 274.0/182.7，k=2 → 274.0/137.0。
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-A-2.mjs`
- **核验（high）**：独立复现成功，且稳定、确定性、与夹具无关。我从零写的脚本（verify-A-2-repro.mjs）只按复现步骤走：起本地静态服 → 页面挂 <vis-bug> + app/bundle.min.js → 点选 .hero-title → 缩放到 k → 打开 vr-select[data-prop="position"] → 量 getBoundingClientRect().width（含 transform）。三轮结果完全一致：k=1 触发器/下拉都是 276 屏幕 px；k=1.5 → 触发器 276、下拉 184；k=2 → 触发器 276、下拉 138；k 回到 1 后又恢复 276/276。比值恰好是 1/k（0.667 / 0.500），与上报数字（274 → 182.7 → 137.0）在同一条曲线上，差异只是我的夹具面板宽 276 而非 274。

关键是我用了两条互相独立的缩放通道，结果逐位相同：(a) 写 <html data-visual-revise-zoom> + 抛 visual-revise:zoom，即 extension/toolbar/inject.js 收到 ZOOM 消息时的真实做法；(b) --real 模式走 CDP Emulation.setDeviceMetricsOverride（DPR ×k、CSS 视口 ÷k，完全不碰那个属性），触发 app/core/zoom.js 里「页面自己察觉 DPR 与 innerWidth 反向变化」那条路。也就是说，这不是测试用某种取巧方式伪造缩放造成的假象——真·浏览器缩放的几何条件下同
  - 根因线索：app/components/controls/select.element.js 第 230-238 行（VrSelect 的 #toggle 定位段）。

第 230 行 `const rect = this.getBoundingClientRect()`：触发器在属性面板里，而属性面板已被 app/core/placement.js:85（`panel.style.transform = k === 1 ? '' : scale(${1 / k})`，配合第 69 行的 transformOrigin: 'top left'）整体缩了 1/k，所以 rect.width 是「已经缩过的视觉 CSS 宽」= 布局宽 / k。

第 238 行 `panel.style.minWidth = `${rect.width}px`` 把这个视觉宽当作布局宽写到弹层宿主上；宿主随后在 app/components/controls/popover-host.js:45-49 又被统一 `transform: scale(1/k)`。于是宽度被缩了两次：屏幕宽 = 布局宽 / k，恰好比触发器窄 k 倍。修的方向是写回布局尺寸，例如 `${rect.width * zoomFactor()}px`（zoom.js 已导出 zoomFactor），或改用触发器的未缩布局宽（offsetWidth）。注意这行还会把 PANEL_CSS 里的 min-width:160px 顶掉，k=2 时布局 minWidth 只剩 138px，连设计下限都破了。

同段还有两处单位混用（次生，非主症状）：
- 第 234 行 `Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))`：panel.offsetWidth 是未缩的布局宽，innerWidth / rect.left 是已缩的 CSS 视口坐标，右边界多留了约 k 倍的余量；两个 8 也是 CSS px 而非屏幕 px。
- 第 231-237 行
- **核验（high）**：对照规范成立，且我用两条互相独立的缩放通道各复现了一次。

规范侧（不是测试理解错）：
- docs/PRD.md:154 AC-5.11 明写「属性面板、工具条、改动列表、四个弹层（菜单 / 填充 / 色盘 / 下拉）的屏幕尺寸与位置都不随页面缩放改变」。下拉的屏幕宽度实测 k=1 时 274.0px、k=1.5 时 182.7px、k=2 时 137.0px —— 直接违反这条 AC 的字面要求。
- docs/plans/feature-inventory.md:341（3.1.2）「minWidth 跟触发器同宽」；docs/plans/feature-inventory-v2.md:474（10.5.1）「缩完左上角还贴着锚点」。代码只做到「数值上等于 rect.width」，视觉上在 k≠1 时不同宽。全仓没有任何「已知取舍」注记为这个行为背书。

机制（纯几何推导，与模拟方式无关）：属性面板宿主被 app/core/placement.js:79-86 的 applyPlacement 打上 scale(1/k)，所以面板内 vr-select 触发器的 getBoundingClientRect().width 已经是 W/k（屏幕上仍是 W）。select.element.js 把这个已缩过的值写进弹层宿主的布局盒 minWidth，popover-host.js mountPopover 随后又给宿主 scale(1/k)，于是屏幕宽 = W/k，即恒为触发器的 1/k。

复现 1（上报者脚本，走 data-visual-revise-zoom + vis
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/controls/select.element.js —— `#toggle()` 末尾的定位段（`const rect = this.getBoundingClientRect()` 之后到 `this.setAttribute('data-open','')` 之前那 6 行）整段混用了两套坐标系：

    const rect = this.getBoundingClientRect()        // 已被 scale(1/k) 缩过的视口 CSS px
    const height = panel.offsetHeight                // 没缩过的布局 px
    const below = innerHeight - rect.bottom          // 视口 CSS px
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`
    panel.style.top  = below >= height + 12 || below >= rect.top ? ... : `${Math.max(8, rect.top - height - 6)}px`
    panel.style.minWidth = `${rect.width}px`

配套的另一半在 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/controls/popover-host.js 的 `mountPopover`（k = zoomFactor(); k!==1 时 host.style.transform = `scale(1/k)`，transformOrigin: top left）—— 宿主的布局盒之后一定会再被缩

### B-1 · medium · 圆角 / 粗细拆分行的单框没有单位后缀元素，50% / em 这类非 px 单位回读后彻底消失

- **清单点**：2.6.3 / 2.9.7（拆分行单框「显示当前值」）；牵连 2.3.14、2.3.19
- **复现**：1) 选中一个 border-radius: 50%、border-width: 0.5em、border-style: solid 的元素（四角 / 四边相等，两条拆分行都是收起态）；2) 看 Appearance 的「圆角」单框与 Stroke 的「粗细」单框；3) 点进圆角框，再点别的框（失焦触发 #syncValues 回读）。
- **期望**：按 2.3.14：数字进框、单位放在框外最右的 .suffix 里。圆角框显示 50 + 后缀 %，粗细框显示 0.5 + 后缀 em——跟同一面板里走 #renderControl 的其它数值框（如不透明度）一致。
- **实际**：这两个单框的 .control 里根本没有 .suffix 元素、渲染时也没有 data-unit：首次渲染圆角框里是「50%」（单位挤在框里，违反 2.3.14），粗细框里是「8」（em 被换算成 px）；失焦回读后 #showValue 把单位挪进 data-unit、去 .control 里找 .suffix 找不到就静默跳过，框里只剩「50」和「0.5」，框里框外都没有任何单位——用户读成 50px / 0.5px。根因：props-panel.element.js 的 #renderSplitRow 自己拼 single 那段 .control HTML，没有 <span class="suffix">、也没有 data-unit，没有复用 #renderControl。
- **证据**：套件断言：
  ✘ 2.6.3  圆角单框跟其它数值框一样带单位后缀元素（.suffix 存在=false）
  ✘ 2.6.3  border-radius: 1.5em 的元素，框里是 1.5、框外后缀是 em（实际 value="1.5" 后缀「null」，首次渲染是 "21"）
独立复现脚本输出：
  元素真实计算值             { radius: '50%', width: '8px' }
  首次渲染 border-radius     { value: '50%', dataUnit: null, hasSuffix: false, suffixText: null }
  回读后   border-radius     { value: '50',  dataUnit: '%',  hasSuffix: false, suffixText: null }
  首次渲染 border-width      { value: '8',   dataUnit: null, hasSuffix: false, suffixText: null }
  回读后   border-width      { value: '0.5', dataUnit: 'em', hasSuffix: false, suffixText: null }
  对照 opacity（普通数值框）  { value: '90',  dataUnit: '',   hasSuffix: true,  suffixText: '%' }
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-B-1.mjs`
- **核验（high）**：从零写的独立脚本（自己在默认 fixture 里现造 border-radius:50% / border:0.5em solid 的元素，自己点选、自己读 shadow DOM）4 次运行结果完全一致、逐字节相同，无时序或固件依赖。事实链：(1) 圆角/粗细拆分行单框的 .control 里确实没有 <span class="suffix"> 节点，渲染时也没有 data-unit——innerHTML 直接可见，而同一面板里走 #renderControl 的不透明度框有 suffix「%」；(2) props-panel.element.css:366-371 只给 .suffix 出样式，没有任何 [data-unit]::after 之类兜底，单位在 DOM 里没有第二处可显示；(3) 首次渲染圆角框是「50%」（单位挤在框内，与 2.3.14 不一致）、粗细框是「8」（0.5em 已被换算成 px，违反 2.3.17 用 #numSource 保住用户单位的初衷，另测 1.5em 显示为 24）；(4) 任何一次 #syncValues 回读后（失焦触发，或仅仅改了别的属性走 ChangeStore.subscribe→#syncValues 也会触发，我另写脚本验证过），#showValue 把单位挪进 data-unit、去找 .suffix 找不到就静默跳过，框里只剩「50」「0.5」，框内框外都无单位，用户只能读成 50px / 0.5px。即便把「后缀放框外」当成只约束 #renderControl 的排版偏好，回读后单框显示「50」也直接违反 2.6.3
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/props-panel/props-panel.element.js 两处：(1) #renderSplitRow（约 1160-1181 行）手拼 single 那段 .control HTML——1174-1180 行的模板里只有 prefix + input，没有 <span class="suffix">、input 上也没有 data-unit；而且 1170 行 `const value = differ ? '' : displayValue(main, this.#computed[main] ?? '')` 取的是计算值（永远是 px）而不是 #numSource(main)，也没走 splitUnit 拆单位。正解是复用 #renderControl(main)（它在 2249-2250 行同时输出 data-unit 和 .suffix），只把 placeholder="混合" / 拖拽标签这些拆分行特有的部分叠上去。(2) #showValue（2266-2274 行）第 2272 行 `const suffix = input.parentElement?.querySelector('.suffix'); if (suffix) ...`——.suffix 不存在时静默跳过，于是单位只写进 data-unit、界面上彻底消失；即使 (1) 不改，这里也该在缺 suffix 时有可见兜底或直接报错，而不是无声吞掉。CSS 侧 props-panel.element.css:366-371 只认 .suffix，没有 [data-unit] 的显示路径。
- **核验（high）**：规范确实要求这个行为，不是测试理解错了。PRD 的 AC-6.39a（清单 2.3.14）写死「数值框的单位只做展示、放最右：22.5px 拆成框里的 22.5 和右侧压淡的 px 后缀……拆的是行高的 px、旋转的 deg、em、% 这类」，对拆分行的收起态单框没有任何豁免；AC-6.37a / AC-6.38a（2.6.3 / 2.9.7）只补了「四角/四边相等时收起、单框显示当前值」，与 6.39a 并列而非覆盖它。清单 2.3.17 还额外要求数值框显示源优先取 inline（#numSource），理由正是「用户敲的 1.5em 一经回读就变成 22.5px、单位后缀跟着丢」——正是本条复现的现象。代码侧：#renderSplitRow 自己拼 single 的 .control，既没有 <span class="suffix"> 也没有 data-unit，值还取自 this.#computed[main] 而不是 #numSource(main)；同一文件里 #renderControl 和 #renderSides 都带 suffix + data-unit，而且同一个拆分行「展开后的 2×2」走 #renderControl 是有后缀的——收起/展开切换会改变单位是否可见，这种不对称说明是遗漏而非有意设计。我重跑了上报者的复现脚本，输出与上报完全一致：首次渲染圆角框是 "50%"（单位挤在框内，违反 2.3.14）、粗细框是 "8"（0.5em 被换算成 px，违反 2.3.17）；失焦回读后 #showValue 把单位塞进 data-unit、去 .con
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/props-panel/props-panel.element.js 的 #renderSplitRow（约 L1160–1195）：收起态单框那段 .control 是手写的，没有复用 #renderControl —— 三处缺陷叠在一起：(1) 模板里没有 <span class="suffix">；(2) <input data-prop data-num> 上没有 data-unit；(3) 值取 `displayValue(main, this.#computed[main] ?? '')` 而不是 `#numSource(main)`，导致 inline 的 0.5em 首次渲染就被计算值 8px 顶掉（违反清单 2.3.17）。下游放大：#syncValues（L541）对拆分行单框调 #showValue，而 #showValue（L2266–2274）用 `input.parentElement?.querySelector('.suffix')` 取后缀，取不到就 `if (suffix)` 静默跳过，于是单位只进了 data-unit、界面上彻底消失。对照实现：#renderControl（L2244–2251，default 分支）与 #renderSides（L2185–2196）都同时输出 data-unit 和 <span class="suffix">。修法方向是让 #renderSplitRow 的 single 复用 #renderControl（或至少补齐 splitUnit + data-unit + .suffix 并改用 #numSource），注意保留 differ 时留空 + placeholder="混合" 的分支，以及 CSS 里 `.suffix:empty { display:none }` / `.control:has(.suffix:not(:empty)) input { padding-ri

### B-2 · medium · 内外边距展开四边后四个框先显示计算出来的 px，点一下别处当场跳成作者写的 em

- **清单点**：2.5.15（内 / 外边距展开成四边）；牵连 2.3.17
- **复现**：1) 选中一个 style="padding: 2em"（font-size 14px，计算值 28px）的元素；2) 点内边距行右侧的「四边独立」按钮展开成四边；3) 记下四个框里的数字；4) 点进「左」那个框，再点「上」那个框（第一个框失焦 → #syncValues 回读全部字段）。
- **期望**：按 2.3.17，数值框的显示源优先取元素自己的 inline（#numSource）：展开后的四个框一开始就该是 2 + 后缀 em，且不该因为一次失焦回读就变数。
- **实际**：首次渲染四个框是 ["28","28","28","28"]（计算值 px、后缀为空），点一下别处后当场变成 ["2em","2em","2em","2em"]——用户什么都没改，面板上的数字自己跳了一次。根因：props-panel.element.js 的 #renderSides 直接用 this.#computed[p] 取初值（还硬写 data-unit=""），而 #syncValues 对同一批框走的是 #numSource(prop)，两条路的显示源不一致。
- **证据**：套件断言：
  ✘ 2.5.15  展开后的四个框第一眼与回读后一致（首次 ["28","28","28","28"]，回读后 ["2em","2em","2em","2em"]）
  ✘ 2.5.15  padding: 2em 的元素展开后框里是作者写的 2em，不是算出来的 28px（实际 ["28","28","28","28"]）
独立复现脚本输出：
  元素 inline               padding: 2em（计算值 28px）
  展开四边 · 首次渲染        [ '28', '28', '28', '28' ]
  点一下别处（回读）之后      [ '2em', '2em', '2em', '2em' ]
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-B-2.mjs`
- **核验（high）**：独立复现成功且完全确定性：我按复现步骤从零写了 /private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/verify-B-2-repro.mjs（自建 fixture，未参考上报者测试），完整跑了两遍，4 个场景 8/8 全部复现，数值与上报一字不差：padding:2em（font-size 14px，计算 28px）展开四边后首次渲染四个框是 ["28","28","28","28"]（input.value=28、data-unit=""、suffix 空），点进「左」框再点「上」框（或直接 blur）后当场变成 value="2" + suffix "em"。换单位也成立：margin:1.5rem 首次 ["24"×4] → ["1.5rem"×4]。用户什么都没改，面板数字自己跳了一次。

不是时序/夹具偶发：两种失焦方式（点另一个框 / 直接 blur）、两个属性组（padding / margin）、两种单位（em / rem）、两次完整运行结果一致；也没有定时器会自动纠正，错误显示会一直停在那里，直到一次 blur 或任意 ChangeStore 变更触发 #syncValues。

代码上两条路确实不同源，读源码可直接对上：#renderSides（L2191-2192）用 displayValue(p, this.#computed[p]) 并硬写 data-unit=""、suffix 留空；
  - 根因线索：主因（上报者定位正确）：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/props-panel/props-panel.element.js 的 #renderSides（约 L2178-2199），四个边框的初值走 `value="${esc(displayValue(p, this.#computed[p] || ''))}"`（L2192），并硬写 `data-unit=""`、`<span class="suffix"></span>` 留空；而 #syncValues 对同一批 `data-num` 输入取 `this.#numSource(prop)`（L497）再走 #showValue（L541 → L2265-2274）把 inline 拆成 num + data-unit + suffix。两条路显示源不同 → 首次渲染 px 计算值、一次失焦回读就跳成 inline 写法。修法应与 #renderControl（L2213）一致：初值用 #numSource(p)，并把 splitUnit 后的 unit 写进 data-unit、把后缀写进 .suffix（否则 data-unit 为空还会连带影响 L2887 的步进拼接与 L2657 的 change 补单位逻辑）。

同因但更大范围（只修 #renderSides 会漏）：同一文件里另外几条渲染路径也直接用 this.#computed，在同一次失焦里一起跳变（我在 probe 里实测到）：
- #renderDims / 尺寸轴（L2073、L2108）：width 280 → 20em、height 73 → 17
- #renderSplitRow（L1170）：border-radius 21 → 1.5em、border-width 7 → 0.5em
- gap 控件（L944）：28 → 2em
- 收起态的间距两段式 #renderSidePair 的 cell（L1130，pairDisplay(this.
- **核验（high）**：复现成立且与规范一致，是产品真 bug。(1) 规范依据：PRD 里没有编号 2.5.15/2.3.17，这两个是 docs/plans/feature-inventory-v2.md 的功能清单编号，分别映射 PRD AC-6.6c 与 AC-6.39a/b。清单 2.3.17（第 64 行，对应 AC-6.39b）原文就是「数值框的显示源优先取元素自己的 inline（#numSource），没有才用计算值」，2.3.14/AC-6.39a 要求 em、% 这类拆成框内数字 + 右侧后缀。展开后的四个框就是普通 data-num 数值框（#syncValues 本来就按 #numSource 回读它们），并无「这四个框走计算值」的例外条款，所以上报的期望是规范要求，不是测试理解错。(2) 代码依据：props-panel.element.js 里只有 #renderSides 一条路直接用 this.#computed[p] 并硬写 data-unit="" + 空 suffix；#renderControl(2213)、#syncValues(497)、change 处理器(2669) 全走 #numSource(2259)。圆角 / 描边粗细的同类 2×2 网格经 #renderSplitRow → #renderControl 走的是正确路径，说明这是遗漏而非设计。(3) 现象核对：先确认 extension/toolbar/bundle.min.js 里就是同一段 data-side data-unit="" + this.#I[e]，不存在旧构建干扰；跑上报者脚本
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/props-panel/props-panel.element.js 的 #renderSides（约 2178–2199 行）：四个侧边框的初值写成 value="${esc(displayValue(p, this.#computed[p] || ''))}"，并硬编码 data-unit="" 与空的 <span class="suffix"></span>，绕开了同文件 #numSource(prop)（2259 行）+ splitUnit/#showValue 这条统一路径；而 #syncValues（479–544，取值在 497 行）对同一批 input[data-prop][data-num] 走的是 #numSource，两条显示源不一致，失焦回读时数字当场跳变。附带影响在 2830–2895 行的拖标签 / 方向键步进：origin = input.value + (input.dataset.unit || '')，data-unit 为空就回落到计算值的 px。修法参照同文件 #renderSplitRow（1160–1196）——圆角 / 粗细网格用 this.#renderControl(p, { dragPrefix: true }) 渲染每一格；#renderSides 改成同样调用 #renderControl（或至少用 #numSource(p) + splitUnit 填 value/data-unit/suffix）即可两处同源。

### C-2 · medium · 圆角 / 粗细的「单框」（拆分行）同样没有后缀位：同一个 20% 在重绘路径里混进框内文本、在写入路径里单位彻底消失

- **清单点**：2.3.14 / 2.3.17（AC-6.39a）
- **复现**：1) 页面上放一个 `border-radius: 20%` 的元素，选中它；2) 看外观分区的圆角框——框里是 `20%`（单位混在可编辑文本里）；3) 改一下别的属性（例如 X）触发一次 #syncValues；4) 再看圆角框——变成 `20`，界面上没有任何地方写着 %；5) 把它当 px 敲一个 `8` + Enter。
- **期望**：两条路径一致，都拆成「框="20" + 框外后缀="%"」（2.3.14）；显示源优先取 inline（2.3.17）。
- **实际**：#renderSplitRow（props-panel.element.js:1174-1180）手写的 single 模板既没有 `.suffix` 也没有 data-unit，且用的是 `this.#computed[main]` 而不是 #numSource：初次渲染把整串 `20%` 塞进 input；#syncValues 之后 #showValue 把它拆成 20 + data-unit=%，但没有 .suffix 承接，单位从界面上消失。第 5 步敲 8 写出 `border-radius: 8%` 而不是 8px。同一个 CSS 值，只因为动过别的字段，框里的文本就从 "20%" 变成 "20"。
- **证据**：套件断言原文：
  ✘ 2.3.14h  圆角 20px 期望 框="20" 且有后缀位（换成 % 时单位有地方放），实际 框="20" 有后缀元素=false
  ✘ 2.3.14i  圆角 20% 单位要放框外：期望 两条路径都是 框="20" 后缀="%"，实际 写入后 框="20" 后缀=(没有后缀元素)；重绘后 框="20%" 后缀=(没有后缀元素)
独立脚本输出：
  初次渲染（inline 20%） radius {box:"20%", unit:"(无 data-unit)", suffix:"(没有后缀元素)"}
  同步一次之后           radius {box:"20",  unit:"%",           suffix:"(没有后缀元素)"}
  框里看到 20 敲成 8     radius {box:"8", unit:"%"} → 实际圆角 8%
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-C-2.mjs`
- **核验（high）**：独立复现成功，且完全确定（每个场景各跑 2 轮，结果逐字一致，无时序/夹具依赖）。用自写脚本按复现步骤走：给 .curve-card 加 inline border-radius:20% → 选中 → 圆角单框显示 "20%"（单位混在可编辑文本里，无 data-unit，控件里根本没有 .suffix 元素）；随便改个别的字段（width）触发一次 #syncValues → 同一个框变成 "20" + data-unit="%"，而 % 在界面上无处可见（该行可见文本只有 opacity 自己的 %）；此时敲 8+Enter 写出 border-radius: 8%，而在同步之前敲同样的 8 写出的是 8px。即同一个框、同一次击键，写出的 CSS 只取决于「有没有动过别的字段」。附加核验：20px 时单框同样 hasSuffixEl=false（换单位时没有地方放单位）；inline 1.5em 时单框显示 "24"（计算值 px），而同一行展开后的四角格子（走 #renderControl）显示 "1.5"+后缀 "em"，证明单框读的是 #computed 而不是 #numSource（2.3.17 的 inline 优先没生效）。对照组：同一行的 opacity 有 .suffix "%"，展开的 2×2 角格子有 .suffix，只有 split-row 的单框没有；border-width 单框同病。断言的期望与面板其它所有数值控件的既有行为一致，不是测试自造的标准。
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/props-panel/props-panel.element.js 的 #renderSplitRow（约 1160-1195 行，single 模板在 1172-1180）自己手写了合并框的 HTML，没有复用 #renderControl（约 2240-2252 行的 default 分支）：(1) input 上没有 data-unit=""，(2) .control 里没有 <span class="suffix">，(3) value 取 displayValue(main, this.#computed[main] ?? '')（1171 行）而不是 #numSource(main)（2259-2262 行，inline 优先）。后果链：初次渲染整串 "20%" 进 input；#syncValues（479-541 行，541 行调 #showValue）后 #showValue（2266-2273 行）把值拆成 num + dataset.unit，但 input.parentElement.querySelector('.suffix') 取到 null，单位从界面消失；change 处理（2656-2660 行）又会把这个不可见的 data-unit 拼回用户敲的纯数字。修法应是让 #renderSplitRow 的单框走 #renderControl（或补齐 data-unit + .suffix 并改用 #numSource），并保持 differ 时的「混合」占位逻辑。
- **核验（high）**：规范确实这么要求，现象也复现了，且比上报的更严重。① 规范：docs/PRD.md:278（AC-6.39a）把「单位只做展示、放框外最右」写成对**数值框**的通用规则（拆的是 deg/em/% 这类，px 剥掉），docs/plans/feature-inventory-v2.md:55（2.3.14）与 :64（2.3.17「显示源优先取 inline #numSource」）复述同一条，并点名 #renderControl/#showValue/#numSource/splitUnit 为实现处；AC-6.37a/6.38a 只说「单框显示当前值」，没有给拆分行任何豁免，而这个单框就是普通的 input[data-num]。② 代码：props-panel.element.js:1170 用 this.#computed[main] 而非 #numSource（还漏传第三个 computed 参数）；1174-1180 手写的 single 模板既无 data-unit 也无 <span class="suffix">，而同文件 #renderControl 默认分支（2249-2250）和 #renderSides（2191-2193）都带；#showValue（2266-2274）无条件写 dataset.unit 但 suffix 只在元素存在时才写，于是单位沦为不可见状态；提交路径 2658-2659 又把这个不可见单位补回裸数字。③ 复现：跑了上报脚本，结果与其一致（20% → 同步后 20 + 隐形 %，敲 8 写出 8%）。我另写脚本加验：border-r
  - 根因线索：app/components/props-panel/props-panel.element.js 的 #renderSplitRow：第 1170 行 `const value = differ ? '' : displayValue(main, this.#computed[main] ?? '')` 用了计算值而非 #numSource(main)（并漏传 computed 参数），第 1174-1180 行手写的 single 模板缺 `data-unit` 与 `<span class="suffix">`。修法是照 #renderControl 默认分支（2249-2250 行 `splitUnit(displayValue(prop, this.#numSource(prop), this.#computed))` → value=shown.num / data-unit=shown.unit / .suffix=spec.unit||UNIT_LABEL[unit]||unit）或 #renderSides（2191-2193 行）重建这段模板；顺带 #showValue（2266-2274 行）在没有 .suffix 元素时静默丢单位，可考虑加防呆。附带同源问题：font-size（846 行）、gap（944 行）、min/max 宽高（2108 行）这几处手写数值框同样没有 .suffix，属同一类遗漏。

### C-3 · medium · 敲进「与当前值等价」的写法后 change 早退、框不刷新，紧接着按 ↑ 拼出非法单位 45degdeg：元素纹丝不动，框里的数字却照常往上走

- **清单点**：2.3.18（AC-6.39b）
- **复现**：1) 页面上放一个 `rotate: 45deg` 的元素，选中它——面板旋转框是「45」+ 后缀「°」；2) 在框里敲 `45deg` + Enter（与当前值等价的写法）；3) 不失焦，按一次 ↑。
- **期望**：第 2 步即使判定「值没变、不提交」，也要像正常提交那样把框刷回「数字 + 后缀」（框="45"、后缀="°"，2.3.18 的原话是「change 处理器自己再刷一次数字与后缀」）；第 3 步写出 `rotate: 46deg`，框="46"、后缀="°"。
- **实际**：change 处理器在 `sameValue(next, this.#computed[prop])` 时直接 return（props-panel.element.js:2664），跳过了后面那句 #showValue，框里留着用户敲的原文 "45deg"、data-unit 仍是 deg。按 ↑ 时 stepValue 收到 `input.value + data-unit` = "45degdeg" → 得到 "46degdeg"，非法声明被 CSSOM 静默丢弃（inline 仍是 45deg、计算值 45deg），而 #showValue 照样把框刷成 46、后缀刷成 "degdeg"。界面在说谎。
- **证据**：套件断言原文：
  ✘ 2.3.18f  敲进等价写法后框要刷回「数字 + 后缀」：期望 框="45" 后缀="°"，实际 框="45deg" 后缀="°" data-unit="deg"
  ✘ 2.3.18g  紧接着步进不能拼出非法单位：期望 inline rotate="46deg" 框="46" 后缀="°"，实际 inline="45deg" 框="46" 后缀="degdeg"
独立脚本输出：
  干净状态         {框:"45",   data_unit:"deg",    后缀:"°",      inline:"45deg"}
  敲了等价的 45deg {框:"45deg", data_unit:"deg",   后缀:"°",      inline:"45deg"}
  再按一次 ↑       {框:"46",   data_unit:"degdeg", 后缀:"degdeg", inline:"45deg"}  计算值 45deg
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-C-3.mjs`
- **核验（high）**：独立复现成功，3 次运行结果完全一致（deterministic，非时序/夹具依赖）。我按复现步骤从零写了 verify-C-3-repro.mjs（未参考上报者的 units.mjs 断言），拿到与上报完全相同的数字：敲 45deg+Enter 后框停在 "45deg"、data-unit 仍 "deg"；按 ↑ 后框="46"、后缀="degdeg"、inline 与计算值都还是 45deg —— 元素纹丝不动而界面显示 46，即「界面在说谎」属实。控制实验佐证了因果：同一个框敲「不等价」的 50deg 时 change 正常提交，框刷回 "50"+"°"，随后 ↑ 正确写出 51deg；唯一差别就是 sameValue 早退跳过了 #showValue。另外补充两点上报没写的事实：脏状态会持续累积（再按 ↑ 变 47、48…元素始终不动），失焦时 #syncValues 把框拍回 45，用户这几下按键静默蒸发。期望值也站得住：feature-inventory-v2.md 的 2.3.18 原话就是「change 处理器自己再刷一次数字与后缀——否则……下一次步进拼成 1.5empx」，本例正是它要防的那个失败。触发路径合理：敲带单位的值换单位是 2.3.15 明示支持的功能，而后缀显示的是「°」不是「deg」，用户敲 deg 很自然。严重度中等（失焦可自愈、不产生错误的改动记录），但「框里数字往上走、元素不动」这个说谎行为是真的。
  - 根因线索：主因：app/components/props-panel/props-panel.element.js:2664 的 input[data-prop] 'change' 处理器里，`if (sameValue(next, this.#computed[prop])) return` 这条早退位于 :2669 的 `if (el.hasAttribute('data-num') && el.isConnected) this.#showValue(el, prop, this.#numSource(prop))` 之前。于是「值没变、不提交」这条路径顺带跳过了 2.3.18 要求的重新显示，框里留着用户敲的原文（"45deg"）而 data-unit 仍是 "deg"，两者的和不再是一个合法 CSS 值。修法形状：在早退分支上也执行同一次 #showValue（先刷新再 return），让 input.value / data-unit / .suffix 回到规范的「数字 + 单位」拆分。次因（纵深防御）：app/core/controls.js:338 的 stepValue 用 `source.match(/[a-z%]+$/i)?.[0]` 从 `input.value + data-unit` 里抠单位却不校验，"45degdeg" 直接得出单位 "degdeg" 并返回 "46degdeg"，而不是像它对无法数值化的值那样返回 null；controls.js:355-359 的注释显示作者已经预见到这类「非法声明被 CSSOM 静默丢弃」的失败，但只守住了「推不出单位」那一半，没守住「单位重复」这一半。
- **核验（high）**：对照规范成立，且现场复现一致。规范面：docs/PRD.md:265 AC-6.1a 明确要求「数值步进的单位取自框内文本…直接步进必须写出合法角度，不得…被 CSSOM 丢弃」；docs/PRD.md:279 AC-6.39b 要求「步进按框里当前的单位走」；docs/plans/feature-inventory-v2.md 的 2.3.18 也把「change 处理器自己再刷一次数字与后缀」的理由写死为「否则…下一次步进拼成 1.5empx」。代码面：props-panel.element.js:2664 的 `if (sameValue(next, this.#computed[prop])) return` 在 2669 的 #showValue 之前早退，框里留着用户敲的原文而 data-unit 仍是 deg；步进路径（keydown 2887、拖标签 2850）无条件 `input.value + (input.dataset.unit||'')`，只有在框里是裸数字时才成立，于是拼出 "45degdeg"；controls.js:338 stepValue 的单位正则 /[a-z%]+$/i 贪婪吃下 "degdeg" 并原样吐回 "46degdeg"，splitUnit（props-panel.element.js:114）再把它拆成框 46 + 后缀 degdeg。我跑了上报者的脚本并做了加长版：clean {框45,°,inline 45deg} → 敲 45deg {框"45deg" 原文保留} → ↑ 一次 {框46,后缀degdeg,inline 
  - 根因线索：主因：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/props-panel/props-panel.element.js:2664 的 change 处理器 `if (sameValue(next, this.#computed[prop])) return` 早退，跳过了 2669 行的 `this.#showValue(el, prop, this.#numSource(prop))`，导致「值等价但写法不同」的输入后框里残留原文（"45deg"）而 data-unit 仍为 "deg"。放大器（同一文件）：keydown 步进 2887 行与拖标签 2850 行都无条件 `input.value + (input.dataset.unit || '')`，隐含「框里只会是裸数字」这一前提；再加 app/core/controls.js:338 stepValue 里 `source.match(/[a-z%]+$/i)` 对 "45degdeg" 取出 "degdeg" 并原样回写，以及 props-panel.element.js:114 splitUnit 把 "46degdeg" 拆成 46 + degdeg 显示出去。修法二选一（或都做）：早退前先 `#showValue` 刷一次数字/后缀；或让步进路径从框内文本自身解析单位（框里已带单位就不再追加 data-unit），并让 stepValue 拒绝无法识别的单位而返回 null。参考断言：tests-e2e/units.mjs 的 2.3.18f / 2.3.18g（其中 2.3.18f 略偏实现细节，2.3.18g 是 AC-6.1a/AC-6.39b 的直接量化）。

### D-1 · medium · display:none 容器里的子孙元素，颜色照样被「On this page」采走

- **清单点**：3.4.10（AC-6.41a：「只数看得见的……display:none 的元素不算」）
- **复现**：1) 任意页面上有一块 display:none 的容器（收起的下拉菜单 / 没打开的弹窗 / 移动端导航——真实站点上极常见），容器内的子元素带背景色或字色；2) 注入扩展，选中任意元素；3) 打开描边或填充的色盘，停在「自定义」页；4) 看下面「On this page」的色块。
最小复现：node /private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-D-1.mjs（用仓库自带的 tests-e2e/fixture.html，不依赖本组新固件）
- **期望**：隐藏子树里的颜色一个像素都没画出来，不该进色板：#ff00aa / #00ffaa / #aa00ff 都不出现（子元素 getBoundingClientRect 为 0×0、offsetParent 为 null）
- **实际**：三个隐藏色全部进了色板，且排在中间位置（本例第 7 / 10 / 11 位）。页面上藏着的组件越多，可见颜色越容易被挤出 54 个的上限
- **证据**：套件断言原文：`✘ 3.4.10  display:none 容器里的子孙也不算（一个像素都没画出来）：#ab00ff 被采进色板了（期望不出现）——该子元素 getBoundingClientRect 0×0、offsetParent=false，只是它自身的 computed display 仍是 block（代码只看这一个值）`。
独立脚本输出：`色板里的颜色： #eeeeee #8a8a94 #101014 #1e1e24 #a5a5ae #4f46e5 #00ffaa #17171c #2c2c33 #aa00ff #ff00aa` / `藏起来的菜单里泄漏进色板的： #ff00aa #00ffaa #aa00ff`。
成因：app/core/page-colors.js 里 `if (cs.display === 'none') continue` 只看元素自身的 computed display，而 display:none 不会传递给子孙的 computed display（子孙仍解析成 block），于是整棵隐藏子树照常被采集。
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-D-1.mjs`
- **核验（high）**：独立复现成功，两次运行输出完全一致，确定性 100%。我从零写的脚本（verify-D-1-repro.mjs）只用仓库自带的 tests-e2e/fixture.html + harness.mjs，运行时往页面塞一个 display:none 的收起菜单（子孙分别带 background:#ff00aa、color:#00ffaa、border 2px solid #aa00ff），然后注入构建产物、选中 .card-title、点开面板里 vr-color 的色盘，从 #visual-revise-color-panel 的 shadow root 里读 .pc-swatch[data-color]——走的是用户真实看到的那条 UI 路径，不是直接调内部函数。结果：11 个色块里 #00ffaa / #aa00ff / #ff00aa 分列第 7 / 10 / 11 位，与上报完全吻合。关键的对照组证据：把 display:none 直接打在带色元素自己身上（#123456），它被正确排除掉了——说明守卫本身没坏，坏的是「只挡自己、不挡子树」。探针也确认这三个子元素 getBoundingClientRect 为 0x0、offsetParent 为 null、getClientRects().length 为 0，一个像素都没画出来，但 computed display 仍是 list-item（不是 none）。不是测试问题：全程没用上报方的任何夹具或断言代码，泄漏体现在真实渲染出来的弹层 DOM 上；且 extension/toolbar/bundle.min.js
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/core/page-colors.js 第 38 行，pageColors() 的采集循环里：`for (const el of document.querySelectorAll('body *')) { ... const cs = getComputedStyle(el); if (cs.display === 'none') continue }`。这是一次扁平遍历 + 只看元素自身 computed display 的守卫。display 不继承，且 display:none 盒子的子孙其 computed display 仍是各自的指定值（我的探针里是 list-item，上报里是 block），所以整棵隐藏子树照常被 bump(cs.color) / bump(cs.backgroundColor) / 边框色 / SVG fill·stroke 采走。消费方 app/components/controls/page-colors.js:29 的 renderPageColors 只是渲染 pageColors() 的返回值，本身无过滤，色盘（color-popover.js:254）和填充弹层（fill.element.js:547）两个入口共用同一份数据，所以两处都受影响。修法方向已在同一版 Chrome 上验证可行：在循环里换成 `if (!el.checkVisibility()) continue`（对 display:none 的子孙返回 false、对真正绘制的元素返回 true，验证脚本 verify-D-1-fixcheck.mjs），或改用在 display:none 处剪枝的 TreeWalker。不要用 getClientRects().length === 0 单独判断——它会误杀零尺寸但可见的情况。改完需重新跑 npm run extension:build，因为 extension/toolbar/bundle.min.js 里是同一
- **核验（high）**：AC-6.41a (docs/PRD.md:281) requires the swatch board to count 「只数看得见的」 colors and explicitly excludes display:none; app/core/page-colors.js repeats that intent in its own header comment. A descendant of a display:none container paints zero pixels, so excluding it is what the AC asks for — the tester is not over-reading the wording. The code's only guard is `if (cs.display === 'none') continue` on a flat `document.querySelectorAll('body *')` walk, and display:none does not propagate into descendants' computed display (they still compute `block`), so the entire hidden subtree is collected. I re-ran the reporter's independent repro script against the repo's own tests-e2e/fixture.html and confir
  - 根因线索：app/core/page-colors.js — the element loop in `pageColors()` (line 34 `for (const el of document.querySelectorAll('body *'))`, guard at line 38 `if (cs.display === 'none') continue`). The guard tests only the element's own computed display, which stays `block` for descendants of a display:none ancestor, so hidden subtrees are still sampled for color/backgroundColor/border colors/SVG fill+stroke. Fix belongs at this guard: use an actual paint check (e.g. `el.checkVisibility({ checkVisibilityCSS: true })`, or skip the whole subtree when an ancestor is hidden rather than only the hidden root). Note the same guard also lets `visibility:hidden` / `opacity:0` / 0×0 elements through, though AC-6.41a only names display:none. Existing coverage gap: tests-e2e/full/fixtures/page-colors.html:65 only exercises display:none on the colored element itself (#ab0002), matching the assertion at tests-e2e/p

### D-2 · medium · 页面用 oklch() / color(display-p3) / color-mix 上色时，「On this page」一个颜色都采不到（纯 oklch 的站点直接退化成空态）

- **清单点**：3.4.10 / 3.4.9（AC-6.41a：「页面上出现过的颜色」的采集口径）
- **复现**：1) 页面上用现代色彩语法上色（Tailwind v4 默认调色板就是 oklch），例如 background:oklch(70% 0.15 200)、background:color(display-p3 1 0 0)、color:oklch(30% 0.02 260)；2) 注入扩展，选中任意元素；3) 打开描边或填充的色盘「自定义」页；4) 看「On this page」。
最小复现：node /private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-D-2.mjs
- **期望**：这些颜色是实打实画在屏幕上的，应当进色板（落到 sRGB 分别是 #00b9c3 / #d40f0c / #ff0000）；本组套件里加了两个现代语法探针后，色块总数应从基线 16 涨到 18
- **实际**：一个都没进色板（色块总数只从 16 涨到 17，涨的那一个还是 D-1 里那个本不该算的隐藏色）；如果整站颜色都写成 oklch，色板会命中「页面上没有可采集的颜色」的空态
- **证据**：套件断言原文：`✘ 3.4.10  oklch / color(display-p3) 画出来的颜色也要采到：computed 分别是 oklch(0.7 0.15 200) 与 color(display-p3 1 0 0)，落到 sRGB 是 #00b9c3 与 #ff0000；色板里命中 0 个（期望 2，实际 一个都没有）；色块总数 17，基线 16，期望 18`。
独立脚本输出：`品牌色的 computed 值： oklch(0.7 0.15 200) | oklch(0.55 0.22 29) | rgba(0, 0, 0, 0) | color(display-p3 1 0 0)` / `它们落到 sRGB 是： #00b9c3 #d40f0c #ff0000` / 色板里这三个一个都没有。
成因：app/core/page-colors.js 的 `toHex` 正则只认 `rgb()/rgba()`，文件顶部的注释「计算值在 Chrome 里一律是 rgb()/rgba()，直接正则拆，不走探针」在 Chrome 111+ 已不成立——非 legacy 语法的 computed value 保留原色彩空间（`oklch(...)`、`lab(...)`、`color(display-p3 ...)`；连 `color-mix(in srgb, red, blue)` 都序列化成 `color(srgb 0.5 0 0.5)`）。同仓库 app/components/controls/picker.js 的 `parseColor` 已经是走探针解析任意 CSS 颜色的现成写法。
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-D-2.mjs`
- **核验（high）**：独立复现成功，3 次运行结果完全一致（Chrome 152.0.7977.76），且走的是真实 UI 路径（注入 extension/toolbar/bundle.min.js → 选中元素 → 点面板 vr-color 色块 → 从 visual-revise-color-panel 的 shadow root 读 .pc-swatch），不是只跑源码函数。场景 1（传统色 + 现代语法色混排）：oklch / color(display-p3) / color-mix / lab 五个探针，Chrome 的 computed 分别是 oklch(0.7 0.15 200)、color(display-p3 1 0 0)、color(srgb 0.5 0 0.5)、oklch(0.3 0.02 260)、lab(55 70 -60)，落到 sRGB 是 #00b9c3 / #ff0000 / #800080 / #282e38 / #cd45ee；色板实际只有 #000000 #00000080 #0ac81e #123456 #abcdef #ff00ff #ff8800 —— 现代语法命中 0/5，而同一页的传统语法对照组命中 2/2。场景 2（整站只用 oklch / display-p3 上色）：pageColors() 返回 []，弹层渲染出「页面上没有可采集的颜色」空态，与报告一致。不是测试问题：该功能自己的契约（文件头注释「页面上出现过的颜色…只数用户看得见的那几处」）就要求采集真实画出来的颜色，而 Tailwind v4 默认调色板即 oklch，属于主流真实
  - 根因线索：主因：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/core/page-colors.js 第 13 行的 toHex —— `String(css||'').match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/)`，不匹配就 return null，于是 pageColors() 里的 bump() 把所有非 legacy 语法的 computed 颜色静默丢弃。文件第 9 行注释「计算值在 Chrome 里一律是 rgb()/rgba()，直接正则拆，不走探针」是错误前提：Chrome 111+ 起，非 legacy 色彩语法的 computed value 保留原色彩空间（oklch(...) / lab(...) / color(display-p3 ...)，color-mix(in srgb, red, blue) 序列化成 color(srgb 0.5 0 0.5)）。同一条正则也存在于已构建的 extension/toolbar/bundle.min.js，故线上生效。

修复方向修正（上报者的线索不准）：app/components/controls/picker.js:45-61 的 parseColor 虽然走探针，但第 56 行对 computed 又套了同一条 rgb-only 正则 `computed.match(/rgba?\(([^)]+)\)/)`，我实测它对 oklch(70% 0.15 200)、color(display-p3 1 0 0)、color-mix(in srgb, red, blue)、lab(55% 70 -60) 全部返回 valid:false —— 它不是现成答案，而是同一个 bug 的第二处（色值输入框敲现代语法会被判「这不是颜色」）。真正可用的转换：canvas 2D 的 ctx.fillStyle 赋值后读像素（实测 oklch(0.7 0.15 200)→rg
- **核验（high）**：规范站在上报者这边，现象也独立复现了。PRD AC-6.41a 与清单 3.4.10（docs/plans/feature-inventory-v2.md:213）定义采集口径时只讲「哪个元素的哪个属性、看不看得见」（承载文字的字色 / 不透明背景色 / 真画出来的描边色 / SVG fill·stroke；排除编辑器 UI、display:none、alpha=0），从没按 CSS 颜色语法或色彩空间划过界——一块用 oklch 画出来的不透明背景，就是「页面上出现过的颜色」。跑上报者的 repro-D-2.mjs（HeadlessChrome 152）输出与上报一致：computed 保持 oklch(0.7 0.15 200) / color(display-p3 1 0 0)，落到 sRGB 是 #00b9c3 #d40f0c #ff0000，色板里 8 个色一个都不是它们。我另写了 verify-d2.mjs 做矩阵核验：oklch / lab / color(display-p3) / color(srgb) / color-mix(in srgb,…)（序列化成 color(srgb 0.5 0 0.5)）的 computed 值全部保留原色彩空间，page-colors.js 的 toHex 一律不匹配（返回 null，bump 直接丢弃）；只有 #hex / hsl() / rgba() / light-dark() 才回落成 rgb()。所以 app/core/page-colors.js:9 那句「计算值在 Chrome 里一律是 rgb()/rgba()
  - 根因线索：主因：app/core/page-colors.js 的 toHex（第 13-20 行），正则 /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/ 只认 legacy rgb()/rgba()；非 legacy 语法的 computed value 在 Chrome 111+ 保留原色彩空间（oklch(...) / lab(...) / color(display-p3 ...) / color(srgb ...)），匹配失败返回 null，pageColors 里的 bump() 就静默丢掉这个颜色。文件顶部第 9 行的注释「计算值在 Chrome 里一律是 rgb()/rgba()，直接正则拆，不走探针」正是这个错误前提的出处。修法需要真正做一次到 sRGB 的转换（canvas 2d fillStyle + getImageData 最稳，repro 脚本里那段 hex() 就是现成写法），并保留原有的 alpha=0 丢弃、#rrggbbaa 输出格式（渲染层按 color.length === 9 判断半透明分半绘制，见 app/components/controls/page-colors.js:52）。

注意：上报者建议「照抄 app/components/controls/picker.js 的 parseColor」是不成立的——parseColor（picker.js:45-61）虽然走了探针，但第 56 行 computed.match(/rgba?\(([^)]+)\)/) 同样只认 rgb()，我实测它在 oklch / display-p3 上一样返回 {valid:false}。也就是说色盘的取色/解析链路存在同源缺陷（可能是另一条独立 bug）。同一 rgb-only 假设还散落在 app/features/copy-image.js:68 与 app/core/effects.js:189,199，修的时候建议一起抽成一个公共的「任意 CSS 颜

### F-1 · medium · 没有选中元素时 ⌥⌘C / ⌥⌘V 吃掉按键却没有任何提示——panel.toast 在空选中时没有落点

- **清单点**：4.7.1（顺带 4.7.2）
- **复现**：1. 起本地服务打开 tests-e2e/fixture.html，注入 bundle（injectVisBug）
2. 不选中任何元素（页面刚打开就是这个状态，document.querySelectorAll('[data-selected]').length === 0）
3. 按 ⌥⌘C
4. 再按 ⌥⌘V
5. 分别检查属性面板 shadowRoot 里的 .toast 与 body 上的 #visual-revise-toast
- **期望**：按清单 4.7.1「未选中元素时不接管（或给 toast 并不产生记录）」：要么把按键原样放行，要么给出一条看得见的提示（「先选中一个元素再复制属性」/「先选中要粘贴的元素」）。对照组 ⌘⇧C 就是这么做的——copy-image.js 专门改走 vr-toast，空选中时提示照样看得见。
- **实际**：两次按键都被 preventDefault 吃掉，但没有任何可见反馈：未选中元素时属性面板整个不渲染，shadowRoot 里根本没有 .toast 元素（props-panel 的 #toast() 里 `if (!el) return` 直接吞掉），body 上的 vr-toast 也没有被触发。用户按下去是「完全没反应」。改动记录确实没被污染（history.depth 保持 0），但反馈这一半整个丢了。
代码位置：app/features/copy-props.js:79 `ctx.toast('先选中一个元素再复制属性','error')`、:97 `ctx.toast('先选中要粘贴的元素','error')`——两处都走 ctx.toast → panel.toast；对照 app/features/copy-image.js:408 走 document.dispatchEvent(new CustomEvent('vr-toast'))。
- **证据**：tests-e2e/copy-props.mjs 断言原文：
  ✘ 4.7.1 没有选中元素时 ⌥⌘C 该给一条看得见的提示，期望「先选中一个元素再复制属性」，实际面板 toast「」/ body toast「」
  ✘ 4.7.1 没有选中元素时 ⌥⌘V 该给一条看得见的提示，期望「先选中要粘贴的元素」，实际面板 toast「」/ body toast「」
（同一段里 ✔ 4.7.1 没有选中元素时 ⌥⌘C 仍然接管了这次按键（preventDefault=true）、✔ …不产生任何改动记录（history.depth=0））
独立复现脚本输出：
  选中元素数： 0
  ⌥⌘C 被接管(preventDefault)： true
  ⌥⌘C 后的可见反馈： {"面板toast存在":false,"面板toast":"","bodytoast":""}   期望：「先选中一个元素再复制属性」
  ⌥⌘V 被接管(preventDefault)： true
  ⌥⌘V 后的可见反馈： {"面板toast存在":false,"面板toast":"","bodytoast":""}   期望：「先选中要粘贴的元素」
  对照 ⌘⇧C 的反馈： {"面板toast存在":false,"面板toast":"","bodytoast":"先选中要复制成图片的元素"}
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-F-1.mjs`
- **核验（high）**：从零写的独立脚本 2/2 轮稳定复现，无时序依赖、无夹具特异性。空选中时 ⌥⌘C / ⌥⌘V 都 defaultPrevented=true（按键被吃掉），但属性面板 shadowRoot 里根本不存在 .toast 元素（面板 #root 渲染的是「未选中元素」空态），body 上的 #visual-revise-toast 连创建都没有——用户侧是「完全没反应」。三组对照把因果钉死：(a) 同一空选中状态下按 ⌘⇧C，body toast 立刻出现「先选中要复制成图片的元素」opacity=1，说明 toast 通道本身是通的，只是 copy-props 没走；(b) 选中 .hero-title 后再按 ⌥⌘C，面板 toast 正常显示「已复制 63 项属性」，说明 ctx.toast 调用链在有选中时没问题，坏的只是空选中分支；(c) history.depth 全程 0，改动记录确实没被污染——上报者说的「记录那半是对的、反馈那半整个丢了」属实。不是测试问题：期望的两条文案就是 copy-props.js 自己的字面量，代码明确打算提示却提示不出来；而且 copy-image.js:405-411 的注释原文就写着「没选中任何元素时属性面板整个是空的，panel.toast 找不到落点，消息会无声丢掉」，并为此专门改走 vr-toast，等于仓库自己已经确认了这个失效模式，只是没同步到 copy-props。行为对清单 4.7.1 的两个分支都不满足：既接管了按键（不是「不接管」），又没有给出 toast。
  - 根因线索：反馈通道选错落点。链路：app/features/copy-props.js:79 `ctx.toast('先选中一个元素再复制属性','error')` 与 :97 `ctx.toast('先选中要粘贴的元素','error')`（都在 :154-155 的 e.preventDefault()/e.stopPropagation() 之后）→ app/core/visual-revise.js:254 `toast: (msg, kind) => panel.toast(msg, kind)` → app/components/props-panel/props-panel.element.js:2298-2300 `const el = this.#shadow.querySelector('.toast'); if (!el) return` 静默吞掉。而 :2299 找不到元素的原因在 props-panel.element.js:602-608 的 render()：`<div class="toast"></div>` 只出现在 #renderPanel()（:655）和 #renderGridSettings()（:1108）里，`!this.target` 的空态分支整段没有 .toast，所以没选中元素时面板 toast 根本没有 DOM 落点。修法有三条，最贴合仓库既有做法的是第一条：(1) 照抄 app/features/copy-image.js:405-411 的对照实现，把这两处空选中分支改成 document.dispatchEvent(new CustomEvent('vr-toast', {bubbles:true, composed:true, detail:{message, kind:'error'}}))，由 visual-revise.js:719 的 onToast 转给挂在 body 上的 toolbar.toast；(2) 把 .toast 从 #root 的每套模板里提出来，放进 props-panel.elemen
- **核验（high）**：规范原文站在上报者这边，不是测试理解错。docs/plans/feature-inventory-v2.md:320-323（§4.7.1 验收要点）写的是「未选中元素时不接管（或给 toast 并不产生记录）」——两条路二选一。实际实现两条都没走到：app/features/copy-props.js:155-157 无条件 preventDefault + stopPropagation + return true（接管了），而 :79 / :97 的 ctx.toast 在空选中时被静默吞掉。链路已逐段读实：visual-revise.js:254 把 ctx.toast 接到 panel.toast；props-panel.element.js:602-608 在 this.target 为空时渲染「未选中元素」空态模板，里面根本没有 .toast 节点（.toast 只存在于 :655 的 #renderPanel() 和 :1108 的网格子视图）；props-panel.element.js:2298-2300 的 #toast() 里 `if (!el) return` 直接丢消息，公开的 toast()（:2924）也没有兜底。我另加的探针还发现空选中时面板宿主本身就是 hidden / display:none，所以「往空态模板里补一个 .toast」也救不回来，消息必须离开面板。同仓库自己已经记录过这个坑：copy-image.js:404-412 的注释原文就是「没选中任何元素时属性面板整个是空的，panel.toast 找不到落点，消息会无声丢掉。走 
  - 根因线索：主因在 toast 路由：app/core/visual-revise.js:254 `toast: (msg, kind) => panel.toast(msg, kind)` 把所有 Figma 快捷键模块的反馈接到属性面板，而 app/components/props-panel/props-panel.element.js:602-608 的空态模板不含 .toast，:2298-2300 的 #toast() `if (!el) return` 会把消息吞掉（面板宿主此时还是 hidden/display:none）。触发点是 app/features/copy-props.js:79（`ctx.toast('先选中一个元素再复制属性','error')`）与 :97（`ctx.toast('先选中要粘贴的元素','error')`），配合 :155-157 的无条件 preventDefault/stopPropagation/return true。修法有两条：要么照抄 app/features/copy-image.js:404-412 的做法，空选中分支改 `document.dispatchEvent(new CustomEvent('vr-toast', {bubbles:true, composed:true, detail:{message, kind}}))`（visual-revise.js:719-720 会转给 toolbar.toast，挂 body 上一定看得见）；要么一次性修根，把 visual-revise.js:254 的 ctx.toast 改成「面板没有 target / 没挂 .toast 时自动回落到 vr-toast」，顺带治好 app/features/replace-element.js:136 同样的空选中静默（那条目前也是 ctx.toast，一样会丢）。注意别只往空态模板里补 .toast 节点——宿主 display:none，补了也看不见。

### F-2 · medium · 没有选中元素时 ⌘⇧R 仍然 preventDefault，吞掉浏览器的硬刷新，而且同样一条提示都没有

- **清单点**：4.7.5（顺带 4.7.1）
- **复现**：1. 起本地服务打开 tests-e2e/fixture.html，注入 bundle
2. page.on('framenavigated') 挂计数器并清零
3. 不选中任何元素
4. 派发 ⌘⇧R（KeyboardEvent key='R' code='KeyR' metaKey shiftKey，cancelable），看返回值是否为 false（= 被 preventDefault）
5. 检查 framenavigated 次数与两处 toast
- **期望**：选中集是同步就能判定的：没有可替换的元素时，这次按键该原样放行、让浏览器自己的硬刷新照常（replace-element.js 顶部注释也写着「条件不满足时**绝不能**拦」）；退一步说，至少要给一条看得见的「先选中要被替换的元素」提示。二者必居其一。
- **实际**：onKeydown 在 e.preventDefault() 之后才异步进 run() 去读剪贴板、才发现没有选中元素——按键已经被吃掉了，framenavigated=0（硬刷新没发生），随后 run() 里的 ctx.toast('先选中要被替换的元素') 又因为空选中时属性面板不渲染而丢失。结果是：用户想硬刷新，按下去既没刷新也没有任何提示，页面像死了一样。
代码位置：app/features/replace-element.js:192 `e.preventDefault()` 排在 run() 里 :132 的 selection 检查之前；:136 的 toast 走 ctx.toast → panel.toast（同 F-1 的落点问题）。
- **证据**：tests-e2e/replace-element.mjs 断言原文：
  ✘ 4.7.5 没有选中元素时要么放行给浏览器硬刷新、要么给一条看得见的提示；实际 preventDefault=true、面板 toast「」、body toast「」
（同段 ✔ 4.7.5 没有选中元素时不会误替换任何东西（三张卡都在）、✔ 4.7.5 前置：页面上没有任何选中元素（0 个））
独立复现脚本输出：
  选中元素数： 0
  ⌘⇧R 被接管(preventDefault)： true   期望：false（该放行给浏览器硬刷新）
  可见反馈： {"面板toast":null,"bodytoast":""}   期望：至少一处写着「先选中要被替换的元素」
  页面导航次数： 0 （0 = 硬刷新确实被吃掉了）
  页面还在不在： 3 张卡
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-F-2.mjs`
- **核验（high）**：独立复现成功，两轮结果完全一致（脚本 /private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/verify-F-2-repro.mjs）。没有任何选中元素时按 ⌘⇧R：preventDefault=true，同时页面上（含所有 shadow root 递归扫描）找不到任何含「先选中」/「剪贴板」的文本，props-panel 空态 shadow 里根本没有 .toast 节点，body 上的 #visual-revise-toast 也从未被创建 —— 按键被吃掉且零反馈，两个缺陷叠加成用户视角的「完全没反应」。

对照实验（verify-F-2-control.mjs）把拦截精确归因到 replace-element：空选中下 ⌘R=false、⌘⇧K=false、⌥⌘⇧R=false、输入框内 ⌘⇧R=false，只有 ⌘⇧R 命中=true，正好匹配 onKeydown 的守卫集合。另一组对照证明 toast 机制本身没坏：选中一张卡片后同样按 ⌘⇧R，面板 toast 正常渲染出「剪贴板里没有可用的内容（支持元素、图片、文本）」并带 data-show —— 说明消息丢失恰恰只发生在空选中这一种情况，因为那时面板走的是空态模板。

真实按键（verify-F-2-realkey.mjs，page.keyboard.press('Meta+Shift+R')）落到页面时是 {code:"KeyR", meta:
  - 根因线索：两处叠加，都在产品代码里：

1) 主因 —— /Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/features/replace-element.js
   onKeydown（:173 起）的守卫只覆盖 ctx.interactive / ctx.mode / isTypingTarget / hasOpenPopup（:187-189），随后无条件执行 :192 e.preventDefault() 与 :193 e.stopPropagation()，:196 才调 run(ctx)。而 run()（:131）的第一条语句 :135 `if (!selection.length) return ctx.toast('先选中要被替换的元素','error')` 是纯同步判定，完全可以上提到 preventDefault 之前 —— 与文件顶部注释「条件不满足时**绝不能**拦」的自述契约相矛盾。修法：把 selection 为空的判定并入 onKeydown 的守卫链，为空时 return false 放行给浏览器硬刷新。

2) 帮凶（与 F-1 同一落点问题）—— toast 被静默丢弃
   app/core/visual-revise.js:254 `toast: (msg, kind) => panel.toast(msg, kind)`；
   app/components/props-panel/props-panel.element.js:2298 `#toast()` 开头 `const el = this.#shadow.querySelector('.toast'); if (!el) return`；
   而 render()（:579）在 `this.target` 为空时走 :606 的「未选中元素」空态模板，该模板里没有 `<div class="toast"></div>`（只有 :655 的 #renderPanel 和 :1108 的网格模板才有）。于是「空选中」正是唯一一种 ctx
- **核验（high）**：真 bug，但上报者的「期望」只有一半站得住，结论仍然成立（断言是「二者必居其一」，而两条都挂了）。

对照规范：
- ⌘⇧R 的守卫口径在 docs/plans/figma-shortcuts.md:22 写死为 `!ctx.interactive` / `mode==='select'` / `!isTypingTarget` / `!hasOpenPopup`，**不含**「有没有选中元素」。PRD.md:133 AC-4.15 的「条件不满足时不 preventDefault」指的就是这几道守卫；feature-inventory-v2.md:335-338（4.7.5 验收要点）反过来强调「与浏览器硬刷新同键位，**必须 preventDefault**」。所以「没选中就该放行给硬刷新」不是 4.7.5 的规范要求，上报者把 4.7.1（⌥⌘C，line 320-323「未选中元素时不接管（或给 toast 并不产生记录）」）的口径搬了过来，这一半属于过度主张。
- 但另一半是硬伤：replace-element.js:136 自己就写了 `ctx.toast('先选中要被替换的元素','error')`，代码意图明确要给反馈，而这条反馈在「空选中」这个场景下**必然**看不见。

实测复核（我自己的对照脚本 verify-F-2.mjs）：
- 无选中：panelHidden=true、面板 shadow 里 hasToastNode=false（空态 render 分支根本没有 `<div class="toast">`）→ #toast() 的 `if (!el
  - 根因线索：主根因（该修这条）：app/core/visual-revise.js:254 `toast: (msg, kind) => panel.toast(msg, kind)` —— ctx.toast 只路由到属性面板。而同文件 :116 `panel.hidden = !(els && els.length)` 在空选中时把面板整个隐藏，app/components/props-panel/props-panel.element.js:579 render() 的空态分支（约 :605-608，只输出 header + .empty）又不渲染 `<div class="toast">`，于是 :2298-2300 的 `#toast()` 撞上 `if (!el) return` 静默返回。结论：空选中状态下 ctx.toast 是 100% no-op。
修法建议：把 ctx.toast 改走始终存在的 body 级 toast —— toolbar.toast（app/components/toolbar/toolbar.element.js:274 #ensureToast 挂在 document.body 上的 #visual-revise-toast），或复用 visual-revise.js:719-720 已有的 `vr-toast` document 事件通道；面板可见时再叠加面板内 toast。

次根因（设计取舍，不算规范违反，二选一即可）：app/features/replace-element.js:192 `e.preventDefault()` 排在 run() 内 :135-136 的 selection 检查之前。若采纳 4.7.1 的口径，可在 :192 之前加一道同步的 `ctx.engine.selection()` 非空检查、空则 `return false` 放行；但注意 feature-inventory-v2.md:335 对 4.7.5 明写「必须 preventDefault」，所以更安全的是保留 preventDefa

### A-3 · low · visbug-grip 的 --vr-inv-zoom 是条死变量：CSS 乘了它，zoom.js 的选择器没带它，Move 工具的抓手描边不随缩放缩回屏幕原大

- **清单点**：10.6.1 / 10.6.3（--vr-inv-zoom 的选择器集合）
- **复现**：1) 唤起编辑器，选中一个元素；2) 缩放到 150%；3) 用 ⌘/ 唤出上游工具条并激活 Position / Move 工具，元素上会画出 visbug-grip 抓手（脚本里直接 document.createElement('visbug-grip') 再喂 position 即可复现同一渲染）。
- **期望**：app/components/selection/grip.element.css 第 13 行写的是 `stroke-width: calc(1px * var(--vr-inv-zoom, 1))`，与 hover / corners / label / distance / gridlines 同一套写法，意图就是页面放大时抓手描边保持 1 屏幕像素：k=1.5 时应为 0.667px。
- **实际**：抓手宿主上取不到 --vr-inv-zoom（计算值是空串），calc 落回默认 1，描边恒为 1px —— k=1.5 时屏幕上是 1.5 设备像素、k=2 时是 2 设备像素，比同屏的 hover 描边（正确缩到 1.334px / 1px）粗。根因：app/core/zoom.js 第 92 行的 SCALED 选择器串是 'visbug-handles, visbug-hover, visbug-corners, visbug-label, visbug-distance, visbug-gridlines, [data-visual-revise-guide]'，漏了 visbug-grip（该标签在 core/visual-revise.js 的 UI_TAGS、features/copy-image.js 的排除表里都在列，只有这里没带）。
- **证据**：套件输出：`✘ 10.6.3 缩放 1.5：visbug-grip 的描边也按 --vr-inv-zoom 缩回屏幕原大 ← [疑似 BUG A-3] ... 期望 0.667px，实际 1px（宿主上 --vr-inv-zoom=""）`。repro 输出（同一页同一时刻的对照）：k=1 → grip 1px / hover 2px；k=1.5 → grip 1px / hover 1.334px；k=2 → grip 1px / hover 1px。
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-A-3.mjs`
- **核验（high）**：独立复现成功，5 次运行结果完全一致，且与上报数字逐位吻合。我没有读上报者的 tests-e2e/zoom.mjs，从零写了两个脚本（/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/verify-A-3-repro.mjs 与 verify-A-3-repro-e2e.mjs），自建静态服务器 + playwright-core 起本机 Chrome，注入 extension/toolbar/bundle.min.js 并插入 <vis-bug>。

脚本 1（直接构造 grip，2 轮 + 第三种触发路径）：
- 路径1（zoom.js 注释里说的第 1 条：给 <html> 写 data-visual-revise-zoom 再抛 visual-revise:zoom）与路径2（CDP Emulation.setDeviceMetricsOverride 真改 DPR=1.5/2 + 视口宽，走 zoom.js 的「页面自己察觉」分支）结果相同。
- k=1.25/1.5/2 时 zoom.js 都正确写出了 <style id="visual-revise-zoom-vars">，规则串是 `visbug-handles, visbug-hover, visbug-corners, visbug-label, visbug-distance, visbug-gridlines, [data-visual
  - 根因线索：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/core/zoom.js 第 92 行的 SCALED 常量：

const SCALED = 'visbug-handles, visbug-hover, visbug-corners, visbug-label, visbug-distance, visbug-gridlines, [data-visual-revise-guide]'

applyVar()（同文件 93-105 行）把 `${SCALED} { --vr-inv-zoom: ${round(1/k)} }` 写进 <style id="visual-revise-zoom-vars">，这是全仓库唯一写入 --vr-inv-zoom 的地方。选择器集合漏了 visbug-grip。

为什么漏了就一定取不到（而不是继承得到）：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/features/move.js 第 242-246 行 createGripUI 是 `document.createElement('visbug-grip')` 后 `document.body.appendChild(grip)` —— grip 是 body 的直接子元素，和 visbug-handles/visbug-hover 是兄弟而非后代（我的 e2e 脚本实测三个 grip 的 parentElement 都是 <body>），自定义属性沿 DOM 树继承，所以拿不到任何 SCALED 宿主上的值。

受影响的样式：/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/selection/grip.element.css 第 13 行 `stroke-width: calc(1px * var(--vr-inv-zoom, 1))` 永远退化成 1px。（同文件 rect 上的 vector-effect: 
- **核验（high）**：真 bug，且是产品自身代码内部矛盾，不是测试理解错。三条证据互相印证：(1) app/components/selection/grip.element.css:13 明确写了 `stroke-width: calc(1px * var(--vr-inv-zoom, 1))`，与 hover/corners/label/distance/gridlines/handle 完全同一套写法，作者意图就是让抓手描边保持屏幕原大；(2) app/core/zoom.js:92 的 SCALED 选择器串是 'visbug-handles, visbug-hover, visbug-corners, visbug-label, visbug-distance, visbug-gridlines, [data-visual-revise-guide]'，唯独漏了 visbug-grip，而 zoom.js:103 只把 --vr-inv-zoom 写给 SCALED 命中的宿主；(3) app/features/move.js:243-246 的 createGripUI 是 document.createElement('visbug-grip') 后直接 document.body.appendChild，抓手是 body 级独立宿主，不是 visbug-handles 的后代，所以 CSS 自定义属性的继承救不了它（对比 visbug-handle 同样不在 SCALED 里却没事，因为它活在 visbug-handles 的 shadow 树内部，10.6.2 的 8px 圆点用
  - 根因线索：根因在 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/core/zoom.js 第 92 行的 SCALED 常量：选择器集合漏了 visbug-grip，导致第 103 行 `style.textContent = `${SCALED} { --vr-inv-zoom: ${round(1 / k)} }`` 生成的规则命中不到抓手宿主，/Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/components/selection/grip.element.css 第 13 行的 calc 落回默认值 1。之所以继承救不了，是因为 /Volumes/Jieying/OPC 探索/插件开发/visual-revise/app/features/move.js 第 243-246 行的 createGripUI 把 visbug-grip 直接 appendChild 到 document.body（而非挂在 visbug-handles 之下）。对齐修法是在 zoom.js:92 的串里补上 'visbug-grip'（该标签在 app/core/visual-revise.js:33 的 UI_TAGS、app/features/copy-image.js:96、app/utilities/common.js:103、app/utilities/strings.js:47 里都已在列，只有这一处漏）。附带提醒：相邻用例 tests-e2e/zoom.mjs:141 标题写「只命中 7 个编辑器标签」，但断言实际是 SCALED.every(s => varStyle.text.includes(s)) 的子集检查，所以补上 visbug-grip 不会把它弄红。

### F-3 · low · 快捷键提示文案写死 Mac 符号「⌥⌘C」，没有走 combo()；hotkey.js 的 combo/MOD/ALT/SHIFT 全库零引用

- **清单点**：4.7.7
- **复现**：1. page.addInitScript 在注入 bundle **之前**同时覆写 navigator.platform='Win32' 与 navigator.userAgentData.platform='Windows'（isMac 是 hotkey.js 模块加载时算的）
2. 打开 fixture.html、注入 bundle
3. navigator.clipboard.writeText('随便一段不是属性的文字')（让剪贴板里不是本工具产出的 JSON）
4. 选中 .curve-card 第一张
5. 派发 Ctrl+Alt+V（ctrlKey+altKey，code='KeyV'）
6. 读属性面板 shadowRoot 里 .toast 的文本
- **期望**：4.7.7：「toast / tooltip 里出现的键位文案都走 combo()」。Windows 上应显示「没有可粘贴的属性，先按 Ctrl+Alt+C 复制一个元素」（combo() 在非 Mac 上用加号连接）。
- **实际**：显示「没有可粘贴的属性，先按 ⌥⌘C 复制一个元素」——Windows 用户看到的是 Mac 的 ⌥/⌘ 符号，而且这两个键在 Windows 键盘上根本不存在。根因是 app/features/copy-props.js:103 把键位写死在字符串里；grep 全库确认 core/hotkey.js 导出的 combo / MOD / ALT / SHIFT 一处都没被引用（三个 feature 模块都只 `import { isMod }`）。
- **证据**：tests-e2e/copy-props.mjs 断言原文：
  ✘ 4.7.7 Windows 上提示里的键位文案该是 Ctrl+Alt+C（combo() 加号连接），实际「没有可粘贴的属性，先按 ⌥⌘C 复制一个元素」
独立复现脚本输出：
  平台： Windows
  实际提示： "没有可粘贴的属性，先按 ⌥⌘C 复制一个元素"
  期望提示： "没有可粘贴的属性，先按 Ctrl+Alt+C 复制一个元素"
引用统计（grep app --include=*.js，排除 bundle）：
  app/features/copy-props.js:11:import { isMod } from '../core/hotkey.js'
  app/features/copy-image.js:27:import { isMod } from '../core/hotkey.js'
  app/features/replace-element.js:11:import { isMod } from '../core/hotkey.js'
  → combo / MOD / ALT / SHIFT 零引用
- **复现脚本**：`/private/tmp/claude-501/-Volumes-Jieying-OPC-----------ui----/6c85771d-0229-41d6-9138-09b22bf556c9/scratchpad/repro-F-3.mjs`
- **核验（high）**：独立复现成功，跑了 2 轮、每轮 3 个子场景，结果完全一致、无时序/夹具依赖。Windows（addInitScript 在注入 bundle 前覆写 navigator.platform='Win32' 与 userAgentData.platform='Windows'）下派发 Ctrl+Alt+V，visual-revise-panel 的 shadowRoot .toast 文本为「没有可粘贴的属性，先按 ⌥⌘C 复制一个元素」。两个对照实验证明这不是覆写没生效：(a) Mac 平台下按 Ctrl+Alt+V 完全不触发（isMod 正确拒绝，说明 isMac 确实按覆写值算了一次）；(b) Mac 平台下按 ⌥⌘V 触发，得到的是同一个字符串——即文案与平台无关，就是硬编码常量。源码 app/features/copy-props.js:103 直接写死 '⌥⌘C'；core/hotkey.js 导出的 combo / MOD / ALT / SHIFT 全库零引用（三个 feature 模块只 import { isMod }）；已构建的 extension/toolbar/bundle.min.js（与源码同一时间戳）含该字面量、零个 'Ctrl+Alt'。期望值与 docs/plans/feature-inventory-v2.md:344 的 4.7.7 原文（「toast / tooltip 里出现的键位文案都走它」）以及 hotkey.js 自己的头注释（「提示文字写死 ⌘，Windows 用户看不懂」——正是该模块存在的理由）一致，不是测试自造的标准。
  - 根因线索：主因：app/features/copy-props.js:103，paste() 里剪贴板没有可用属性时的 toast 把键位写死成 Mac 字形：`return ctx.toast('没有可粘贴的属性，先按 ⌥⌘C 复制一个元素', 'error')`，没有调用 app/core/hotkey.js:19-24 导出的 combo/MOD/ALT。同类缺陷还有 app/components/toolbar/toolbar.element.js:98-100 的 TIPS，硬编码 '⌘Z' / '⌘⇧Z'（4.7.7 里 tooltip 的那一半）。修复时的坑：app/core/hotkey.js:24 的 `combo = (...parts) => isMac ? parts.join('') : parts.join('+')` 按传入顺序拼接，而 Mac 习惯 ⌥ 在 ⌘ 前、Windows 习惯 Ctrl 在 Alt 前——combo(ALT, MOD, 'C') 得到 ⌥⌘C ✓ / Alt+Ctrl+C ✗，combo(MOD, ALT, 'C') 得到 ⌘⌥C ✗ / Ctrl+Alt+C ✓，单个调用点无法同时满足两边期望。combo() 本身需要按平台归一化修饰键顺序，否则只会把「字形错」换成「顺序错」。
- **核验（high）**：上报属实，且期望有规范背书（不是测试理解错）。docs/PRD.md 的 AC-4.13 明文要求「提示文案按平台显示 ⌘ / Ctrl、⌥ / Alt、⇧ / Shift」，docs/plans/feature-inventory-v2.md:344（4.7.7）进一步规定「combo() 在 Mac 上连写（⌥⌘C）、其它平台加号连接（Ctrl+Alt+C）；toast / tooltip 里出现的键位文案都走它」。源码 app/features/copy-props.js:103 把 '⌥⌘C' 写死在 toast 字符串里；grep 全 app/ 确认 hotkey.js 导出的 combo / MOD / ALT / SHIFT 零引用（margin.js:58、padding.js:58 的 combo 是同名局部变量，无关）。重跑上报者的复现脚本得到「平台： Windows / 实际提示： 没有可粘贴的属性，先按 ⌥⌘C 复制一个元素」。平台伪装确已生效：isMod 在真 Mac 上要求 metaKey，ctrlKey+altKey 事件会被 return false、根本弹不出 toast；toast 出现即证明 isMac === false，走的就是真实 Windows 分支。测试注入前用 addInitScript 同时覆写 navigator.platform 与 userAgentData.platform，正是 4.7.6 验收要点自己规定的做法，方法无误。测试用的 bundle（extension/toolbar/bundle.min.js，02:
  - 根因线索：主因：app/features/copy-props.js:103 的 `ctx.toast('没有可粘贴的属性，先按 ⌥⌘C 复制一个元素', 'error')` 把键位写死，未引用 app/core/hotkey.js:18-23 导出的 MOD / ALT / SHIFT / combo（该 4 个导出全库零 import，只有 isMod 被 copy-props.js:11、copy-image.js:27、replace-element.js:11 引用）。同类漏网点（同一次修复应一并处理）：app/components/toolbar/toolbar.element.js:97-100 的 TIPS undo/redo/close 三条 tooltip，以及 app/core/visual-revise.js:354 的「⌘Z 可撤销」toast。修复注意：combo(...parts) 目前是固定参数序 join，单一参数序无法同时产出 Mac 的 ⌥⌘C 与 Win 的 Ctrl+Alt+C —— combo(MOD, ALT, 'C') 在 Win 上得 Ctrl+Alt+C（满足测试正则）但 Mac 上得 ⌘⌥C；combo(ALT, MOD, 'C') 则 Mac 对、Win 上得 Alt+Ctrl+C。app/core/hotkey.js:23 的 combo 需要按平台重排顺序，而不只是换连接符。

## 各组备注

- **A. 网页缩放与视觉视口（功能清单 v2 §10**：## 交付物

- **主套件**：`/Volumes/Jieying/OPC 探索/插件开发/visual-revise/tests-e2e/zoom.mjs`，从 26 条扩到 **71 条**（68 通过 / 3 失败，3 条全是上报的疑似 bug，两次连跑结果一致）。已改用 harness 的 `ok()` 打 ✔/✘，本地仍统计 pass/fail 并按失败数设 exitCode。**未改动 app/ 与 extension/ 下任何源码，未跑 extension:build，未碰 all.mjs / harness.mjs / PRD.md / 其它组的文件。**
- **真实扩展脚本**（10.1.1 专用，不进 all.mjs）：`scratchpad/ext-zoom-a.mjs`，11 条（9 通过 / 2 失败，失败的两条正是 A-1、A-2 在真实浏览器缩放下的复核）。用 Chrome for Testing + `launchPersistentContext --load-extension` 加载 `scratchpad/ext-a`（extension 的副本，manifest 加了 `host_permissions: ["<all_urls>"]`），profile 在 `scratchpad/ext-a-profile`。
- 结构化字段里的 77 通过 / 5 失败 = 两个文件之和（68+9 / 3+2）；两个失败集合是同两个 bug 在模拟路径与真实路径上的各一次命中。

## 套件结构（新增段落）

§A 倍数 1 基线 → §B 倍数 1.5 三块 fixed UI → §C 贴页面物件的 `--vr-inv-zoom` → §D 四个弹层 → §E MutationObserver 兜底 → §F 拖面板 + localStorage → §G CDP 真改 DPR/视口 → §H 可配置 devicePixelRatio/innerWidth 精确验 observe 分支 → §I 捏合 → §J 拖工具条/拖列表 → §K 参考线透明度 + destroy 清样式 → §L 新页面验启动读属性与 (resolution) 重挂。

## 踩到的测试环境坑（已在文件里写成注释，供后续维护）

1. **CDP 的 `Emulation.setDeviceMetricsOverride` 只有本进程第一次调用会把 DPR 与视口宽放在同一次 resize 里交出来**；之后再 override，`observe()` 常常先读到「只改了宽」，把真正的缩放误判成换屏，倍数就不动了。所以 §G 的自察三连必须是第一次 override，更细的分支（只改 DPR / 只改宽 / acceptAttr 重置锚点）改用 `Object.defineProperty(window,'devicePixelRatio'|'innerWidth')` 喂值 + 手动派发 resize（§H），确定性 100%。注意这两个是 window 的**自有可配置访问器**，用完必须用存下来的原始描述符装回去，`delete` 会把全局变量整个抹掉（第一版就栽在这里）。
2. **CDP 模拟下 `(resolution: Ndppx)` 的 change 只在版面也跟着变时才派发**：只改 deviceScaleFactor、宽高不变的话，连测试自己挂的对照组监听都不触发（`scratchpad/repro-A-mq.mjs` 验证过）。所以 10.1.9 的「重挂新查询」那条要连视口尺寸一起改；一开始误判成产品 bug，对照组一挂就澄清了，属于测试问题，已自行修掉。
3. **工具条的拖动不能按 `.bar` 的左边缘下手**（会落在按钮上，`e.target.closest('button')` 直接 return，拖不动且 `#screen` 不落），要按 `.sep` 分隔线 —— 与 `tests-e2e/full/toolbar.mjs` 的 `dragBarTo` 同款。
4. 工具条 / 改动列表的 `#screen` 一旦记下就没有复位入口，所以所有「未拖过」的断言（含捏合那一整段）必须排在拖动段之前。
5. `visbug-corners` / `visbug-label` 在默认工具下不出现，按组件契约直接 `createElement` + 喂 `position` / `text` 驱动渲染；`visbug-distance` / `visbug-gridlines` / `visbug-hover` 走真实路径（选中一张卡片再 hover 另一张）。

## 另外两点观察（不算 bug，供参考）

- **A-1 / A-2 是同一个根因的两副面孔**：弹层定位既用锚点「已缩过」的视口坐标，又用弹层「没缩过」的 `offsetWidth/offsetHeight`。除了上报的两处，`menu.js` 与 `select.element.js` 里的「下方装不下就向上翻」判断（`below >= h + 12`）、向上翻的落位（`rect.top - h - 6`）、以及左右夹取（`Math.min(left, innerWidth - w - 8)`）用的都是没缩过的尺寸，缩放下同样会偏。修的时候建议在 `popover-host.js` 里把定位一并接管，或者把 `offsetWidth/Height` 统一除以 `zoomFactor()` 之后再算。
- **`rightOf()` 用 `innerWidth` 当基准，理论上会被经典滚动条宽度污染**（`innerWidth` 含滚动条，fixed 的 `right` 从不含滚动条的 ICB 右缘算起，`viewportBox().width` 也不含）。本机 macOS 是覆盖式滚动条，`innerWidth === documentElement.clientWidth`，即使把 body 撑到 4000px 高也测不出差异，所以没有断言、也没上报；在 Windows / Linux 那种占位滚动条上值得复验一次（k≠1 时面板会额外左移约一个滚动条宽度）。
- **B. 拆分行（四角 / 四边 / 内外边距）**：跑法：`node tests-e2e/full/split-rows.mjs`（未动 tests-e2e/full/all.mjs，需要的话由你注册）。连跑两次结果完全一致（77 ✔ / 5 ✘），5 条失败全部指向上面 3 个已独立复现的产品缺陷，其余 77 条通过。没有改动 app/ 与 extension/ 下任何文件，也没有重建 bundle。

固件 tests-e2e/full/fixtures/split-rows.html 覆盖了要求的三类「不等」元素：四角不等（border-radius: 4px 12px 20px 0）、四边不等（border-width: 1px 2px 3px 4px）、内外边距四边不等（padding: 4px 8px 12px 16px / margin: 6px 10px 18px 22px），另加「只有一条边有宽度」（验 2.9.13 的空状态判定）、「只有一角写在 inline」「一条长手带 !important」（验 5.5.7 的合成与聚合）、以及 em 单位的圆角 / 内边距（B-1、B-2 的复现载体）。

补上的空白：
- 2.5.15 原先「只验了四个前缀都是 svg、缺拖动调值」的那半条已补：真实指针拖「左」前缀 40px，元素 padding-left 20px → 40px 且其余三边纹丝不动。
- 2.5.21 原先只有间接证据，现在有直接断言：四格 data-prop 顺序为 left/top/right/bottom，四格中心真的落成 2×2，并且用几何比对证明「收起态『水平』那一列，展开后正好是左 + 右」。
- 5.5.7 的两块待测都补上了：(a) 快照合成——直接从 /__app/core/snapshot.js 调 readInline / readInlineImportant，验了长手不进快照、部分 inline 时按计算值补齐（9px 0px 0px 0px）、四条相等折成一个值、important 按「任一长手带就算简写带」聚合；(b) 导出 → undoEverything+clear → importJSON 往返，四个角 18/12/20/0 原样回来，导出 JSON 里没有任何长手条目。
- 2.14.2 三种网格（.corners / .sides-grid / .sides）都逐格量了与上一行两个输入框的左右边缘（±0.5px），acceptance-ui 的 AC-9.12 原先只量前两种。

观察到但判定「不算缺陷、未上报」的一处：收起态显示「混合」时，在空的单框上按 ↑ 或拖标签，stepValue 会拿计算值简写的第一个数字 +1 写成简写（如 4px 12px 20px 0px → border-radius: 5px），四边一起被拍平。清单 2.6.6 只要求「留空 + 占位混合」、2.6.7 允许在单框敲值写简写，行为上说得通，故未计入 bug。
- **C. 数值框单位 / 字距百分比 / 线型预览**：套件：新建 tests-e2e/units.mjs（48 条断言，40 通过 / 8 失败），只用现成的 tests-e2e/fixture.html，另在页面里临时造 5 个元素（#u-txt 行高 22.5px/字距 normal、#u-box rotate:45deg+圆角、#u-var line-height:var()、#u-calc line-height:calc()、#u-clamp border-radius:clamp()）。连跑 4 次结果完全一致，没有 flaky。没有改 app/ 与 extension/ 下任何文件，没有重建 bundle，没有碰 all.mjs / harness.mjs / PRD。units.mjs 尚未注册进 tests-e2e/all.mjs（该文件不归我改），需要跑批的话请自行加进 SUITES。

8 条失败全部归到上面 4 个疑似 bug，其余 40 条通过，覆盖情况逐点如下：
- 2.3.14（单位只做展示、放框外最右）：a 行高 22.5px 拆成 22.5+px；b 后缀在 input 之外、pointer-events:none、绝对定位贴右；c 字距固定 %；e 旋转 45deg → 后缀 °（UNIT_LABEL 映射）；f X=320px 不显示默认单位；g 不透明度固定 %。d/h/i 失败 → C-1、C-2。
- 2.3.15（只敲数字沿用当前单位）：a 30 → 30px；b 1.5em 换单位且后缀跟着换；c 换单位后再敲裸数字 2 → 2em。d 失败 → C-1。
- 2.3.16（步进按框里当前的单位）：a 方向键 1.5em ↑ → 2.5em（不回落 px）；a2 拖标签右移 20px（10 步）→ 12.5em，拖拽路径与方向键走同一条 stepValue；b rotate 45deg ↑ → 46deg；c border-radius 30% ↑ → 31%。全通过。
- 2.3.17（inline 优先、var()/calc()/min()/max()/clamp() 退回计算值）：a inline 1.5em 压过计算值 22.5px；b var(--u-lh) → 显示计算值 35px；c calc(1em+5px) → 25；d clamp(4px,10px,12px) → 10。全通过（注意这条只在走 #renderControl 的框上成立，字号框与圆角单框不走 #numSource，见 C-1 / C-2）。
- 2.3.18（提交后框仍聚焦时刷新数字与后缀）：a/b 正常提交路径没问题（Enter 后仍聚焦、框刷成 1.5+em、紧接着 ↑ 得 2.5em 而不是 1.5empx）；c 基线（45deg→45turn 时后缀跟着换）通过。d/e/f/g 失败 → C-4、C-3：正常提交这条路走通了，但「外部改动回写」和「值没变所以早退」两条旁路都漏掉了同一次刷新。
- 2.3.19（.suffix:empty 不占位）：a 空后缀 display:none；b 空后缀框 padding-right=8px（<26）；c 有后缀框 padding-right=26px。全通过（`:has()` 在 shadow root 里工作正常）。
- 2.7.9（字距按字号百分比）：a .hero-eyebrow 计算值 2.16px ÷ 12px → 框 18 后缀 %；b normal → 0；c 敲 5 → 0.05em；d ↑ 一步 1% → 0.06em；e Shift+↑ 一步 10% → 0.16em；f 敲 0 → normal（不是 0em）。全通过。
- 2.9.14 / 3.1.12（线型预览）：触发器 preview=\"border\"、线宽 20px（≥16）、border-top-style 跟当前值走、gap 8px、名字保留；下拉每项 solid/dashed/dotted/double 各画各的、double 3px、solid 2px、none 0px 但仍占 24px 宽对齐、行 gap 12px；选 dashed 后触发器的线跟着换且写进 inline；preview 进了 observedAttributes（动态加属性即生效）；标签走 esc() 转义（options 里放 `<b>x</b>` 只出文本、不生成元素）。全通过，这两点实现得很干净。

几点补充观察（不算 bug，供参考）：
1) C-1 / C-2 是同一族问题的两个发生地：凡是绕开 #renderControl 手写的数值框都没有 `.suffix` 位。除字号、圆角/粗细单框外，尺寸 W/H 格（#renderDims 的 cell()）与尺寸限制格（limitCols()）也是同样的模板，只是 W/H 那格设计上用「模式按钮」代替了后缀、语义另说，我没有为它们单独立断言（2.3.14 的「px 默认不显示」改用 X/left 框验的）。真要修的话建议让这几处复用 #renderControl 的 `.control` 模板。
2) C-3 / C-4 也是同一族：单位的真值存在 data-unit 上，而刷新 data-unit 的唯一入口是 #showValue；两条旁路（change 的 sameValue 早退、#syncValues 的 `el.value !== value` 判断）都会跳过它，于是 data-unit 与元素实际单位脱钩。#syncValues 那条建议把比较项从「数字」换成「数字 + 单位」。
3) 跑测试时页面里那条 `[page error] Failed to load resource: 404` 是 injectVisBug 里 tutsBaseURL='/__ext/tuts' 造成的既有噪音，与本组无关。
- **D. 「On this page」色板 + 变量**：跑法：`node tests-e2e/page-colors.mjs`（仓库根目录）。连跑 3 次结果完全一致（31 ✔ / 2 ✘），两条 ✘ 就是上面两个疑似 bug，其余全绿。没有改动 app/ 与 extension/ 下任何文件，没有 npm run extension:build，没有碰 all.mjs / harness.mjs / PRD.md / 别组文件，也没做 git 操作。套件未注册进 tests-e2e/full/all.mjs 的 SUITES（那个文件不归本组改）。

新建了两个固件（都是本组独有的新文件，不与其它组重名）：
- tests-e2e/full/fixtures/page-colors.html：12 个颜色变量（其中 7 个名字含 ink，含一个大写 --pc-INK-CAPS 用来验不区分大小写）+ 3 个非颜色变量；#123456 × 30（验降序与首项）、rgba(200,30,40,.5) × 12（验半透明分半）、四边同色描边 × 5（验只数一次，逐边数会是 20）、四边不同色 × 1、display:none / visbug-* / [data-visual-revise-ui] 及其子孙 / alpha=0 / border-style:none / border-width:0 六种「不该出现」的探针、内联 SVG 的 fill+stroke、容器字色 vs 直接文字字色。
- tests-e2e/full/fixtures/page-colors-empty.html：页面上一个可采集颜色都没有（唯一元素透明背景 + 透明描边 + 无直接文字），用来走 3.4.16 的空态分支——这条不靠打桩，走的是真实采集路径。

覆盖细节（14 点全部有断言，共 33 条）：
- 3.4.9（4 条）：9 列 / gap 3px / max-height 105px / overflow auto / 头部计数 = 色块数；按次数降序且首项是 30 处的 #123456；页面上放 70 种颜色时截到 54 个且网格内部可滚；在网格里滚动不会误触发弹层的 scroll 关闭（走的是「弹层内部滚动不算」那条白名单）。
- 3.4.10（9 条）：四边同色只数一次（5 而非 20）、四边不同色各数一次、SVG fill/stroke、display:none 不算、编辑器 UI 不算（含弹层宿主自己的底色 #1e1e1e——它带 data-visual-revise-ui，是真编辑器元素而不只是合成探针）、alpha=0 不算、没画出来的描边不算、字色只数直接承载文字的元素、扫描上限 6000（插 6200 个空 span 后再放的颜色采不到，上限之前的照常在）。另两条是上面报的 D-1 / D-2。
- 3.4.11：title 是「色值 · N 处」；点半透明色块写入的是带 0.5 透明度的原色，同时色值框 / 不透明度框 / 透明度条把手 / 色域把手 / 色相把手全部同步。
- 3.4.12 / 3.4.13：1px solid rgb(90,90,90) 实线边框、棋盘格只画在内层（按钮本体 background-image 为 none）、半透明色左实色右真实渲染且两半等宽、不透明色整块一色。
- 3.4.15 / 3.6.9：趁弹层开着往页面塞新颜色，色盘在自定义↔变量之间切一圈不重扫、关掉重开才重扫；填充弹层在纯色↔渐变之间切也不重扫、每次 open() 重扫。
- 2.11.12–2.11.16：搜索框（放大镜 svg / 占位 / aria-label / 打开即聚焦）；小写 ink 与大写 INK 命中同样 7 行、子串 face 命中 2 行、清空恢复 12 行（都量 getComputedStyle(row).display）；无匹配时的提示文案逐字比对；绑定 --pc-ink-deep 后从 chip 打开、过滤把它藏掉再清空，勾、对勾 svg、蓝底都还在原处；填充弹层两页并排（容器 display=flex + 两按钮 top 相等），并补了「绑定后整排藏掉 → 断开后重开仍是并排一行」的往返，正是 2.11.16 那个「不能把 display 清成 ''」的坑。

一处规格歧义（没当 bug 报）：3.4.9 说「头部右侧显示总数」，实现显示的是截断后的数量——页面上有 70 种颜色时头部写 54 而不是 70。断言按「头部计数 = 色块数」写。若产品意图是显示未截断的总数，这里需要改口径。

排查过程中确认为「测试自身问题」并自行修掉的两处：色块内层棋盘格是两层渐变，background-size 会序列化成 `10px 10px, 10px 10px`（最初按单层写死断言）；canvas 的 fillStyle 同样保留现代色彩语法，取 sRGB 期望值必须真画一像素再 getImageData（最初直接读 fillStyle）。
- **E. 键盘换位 / 粘贴守卫 / 把手撤销 / **：跑法：`node tests-e2e/<file>.mjs`（各自独立起 serve + Chrome）。三次连跑结果完全一致（keymove 42✔/2✘、paste 13✔/0✘、resize-undo 21✔/0✘、list-follow 25✔/1✘、guides 9✔/0✘），没有 flake。3 条 ✘ 全部指向同一个根因（bug E-1），除此之外全绿。未改 app/ 与 extension/ 任何源码，未跑 extension:build，未动 all.mjs / harness.mjs / PRD / 其它组文件；只在各文件末尾追加，已有断言一字未动。

各点的新增覆盖要点：
· 4.1.20 补了「导出里有这条移动」：exportJSON().moves 的 from.atEnd/to.atEnd 与 buildPrompt() 里的「## 移动的元素」段。
· 4.1.22 补了端点语义（fromNext 取第一次的后邻、toNext=null/toAtEnd 取最后一次）、「挪回原位那条记录自己对消」、以及三步 ⌘Z 把顺序与记录一起复原到 canUndo=false。
· 4.1.23 的 visbug-label 那一半：默认 guides 工具下上游 overlayMetaUI 的 no_label 为 true，根本不建 label；改用会建 label 的 search 工具验，且 label 的可见框在 :host > span（host 自己 position:initial，rect 是 0×0，直接量 host 会误判成「没跟过去」）。跟过去是对的（靠 selectable 的 parentObserver → setLabel，不靠 on_window_resize——visbug-label 上根本没有这个方法）。
· 4.1.26 按建议先 ⌘/ 唤出上游工具条（注意：一显示它就是全屏 popover，会拦住页面点击，所以必须先选中元素再唤出），再 toolSelected('position')；除了断言不换位，还断言 ↓ 确实落给了上游 Position 工具（行内 top 变成 1px），证明是「让路」而不是「被吃掉」。
· 4.1.27 覆盖了四种形态：非相邻多选各挪一位且相对顺序不变、相邻两个都选中且已在头部时谁都不动、body 直属元素的编辑器邻居（面板/列表/工具条/vis-bug）不算兄弟、两个不同父级各自在自己父级里挪。
· 4.1.28 覆盖 Shift/Alt/Meta/Control 四种修饰键 + 评论模式 + 浏览模式（interactive=true）+ 焦点落在编辑器 UI（工具条按钮）内。另外顺手验过 Tab 隐身态同样不接管、Tab 回来后选中与换位都正常（没写进断言，避免套件再拉长）。
· 4.1.29 补了页面自己的 input、页面 contenteditable、以及色盘弹层里的 input（.val）三种落点。
· 4.2.5 直接挂 document 监听抓 visual-revise:resized：断言只派发 1 次、时间戳晚于 pointerup、detail.before 是拖之前的行内值（特意先给元素一个 300px 的行内宽度，让 before 不是空串）。
· 4.2.6 用底边中点把手只改 height，断言批次标签是「拖改高度」而不是「拖改尺寸」，且 width 那条既有记录不受牵连。
· 5.1.18 补了「滚到中间」的量化断言（条目中心与可见区中心偏差 0px）和「只滚列表不滚页面」（页面 scrollY 300 保持不变）。
· 5.1.24 补了带图评论：用 store.addComment(el, text, [{id,name,dataUrl,w,h,bytes,note}]) 造一条，点条目后编辑框里正文、.refs 缩略图、文件名、图注全都带上了。
· 2.14.1 / 2.14.3 用 getComputedStyle 量 rowGap/columnGap：改动列表 .items/.item-head/footer、评论气泡 .refs/.actions 都是 4px；.ref-head 只在有配图的评论里才渲染，改为读 shadow 里 <style> 的规则声明。属性面板这边只量到 .dims/.side-pair/header 三处（.pair/.layers 在卡片这类元素的面板里不出现），AC-9.13 的完整覆盖在 acceptance-ui.mjs。

排查过但确认「不是 bug」的几处，留个记录免得别人重走：
· paste 事件 dispatchEvent 返回 true（看起来没被 preventDefault）：on_paste 是 async，preventDefault 排在 await navigator.clipboard.readText() 之后。焦点在 body 上时本来就没有默认粘贴动作，用户侧无感知；焦点落在能编辑的地方时 isTypingTarget 会先 return。已有断言的容忍写法是对的。
· 面板不透明度输入框填 0.5 得到 opacity 0.005：这个框是百分比框（core/controls.js:140，unit '%'、fractionToPercent），0.5 就是 0.5%。属 C 组口径，非 bug。
· 列表滚到一半时用面板改属性 / ⌘Z / 拖把手，滚动位置都不被抢（5.1.21 成立）；只有「再点一次同一个元素」会把列表滚回去——那是用户主动点击触发的一次选中事件，不属于「记录变化引起的重渲染」。
· 测距线这次只渲染出 div 线、没有 span 线，所以 4.5.8 的断言按 figure 内 span+div 合并来量（都要 0.5），figcaption 单独断言保持 1。
- **F. Figma 风格快捷键复核（⌥⌘C/V 属**：## 交付状态

三个套件都跑到「除疑似 bug 外全部通过」，连跑两轮结果完全一致（无 flaky）：

| 套件 | 通过 | 失败 | 备注 |
|---|---|---|---|
| tests-e2e/copy-props.mjs | 45 | 3 | 失败 = F-1（2 条）+ F-3（1 条） |
| tests-e2e/copy-image.mjs | 38 | 0 | 全绿 |
| tests-e2e/replace-element.mjs | 55 | 1 | 失败 = F-2 |

只改了本组名下这三个文件；没有动 app/ 与 extension/ 下任何源码，没有 `npm run extension:build`（已核对 extension/toolbar/bundle.min.js 02:23 晚于 app/features/copy-props.js 02:22，bundle 是最新的），没碰 all.mjs / harness.mjs / PRD.md / 其它组文件，没有 git 操作。

## 逐点复核结果（§4.7 八个点，对照的是断言语义不是名字）

原有 20+25+44 = 89 条断言里，真正覆盖到清单验收要点的比想象的少，补了 49 条。逐点账：

- **4.7.1 ⌥⌘C**——原有只覆盖了「面板输入框不接管」「面板按钮仍接管」「浏览模式不接管（且只测了 V）」。补：`interactive` 守卫、`hasOpenPopup` 守卫、接管即 preventDefault+stopPropagation、**未选中元素时的行为 → F-1**。
- **4.7.2 ⌥⌘V**——原有覆盖记录 / ⌘Z / 联动集合。补：**进导出提示词**（走 applyProp 的真正意义所在）、**真多选（Shift 点两个，联动关着）各写一份且仍只有一条历史**、**剪贴板里不是本工具产出的 JSON 时不写并给提示**（这三条原来一条都没有）。
- **4.7.3 与上游 ⌘⌥C/V 同键位**——原来零断言。补：一次 ⌥⌘V 只落一条历史（depth +1）、历史标签是「粘贴属性」（本扩展写的而非上游 paste_styles）、改动记录里每条属性只出现一次（没被写两遍）。代码侧另已核对 `app/features/selectable.js` 的 HOTKEYS 已把 `${metaKey}+alt+c/v` 摘掉（注释写明「归 features/copy-props.js 接管了」），上游那条确实解绑了。
- **4.7.4 ⌘⇧C**——原有覆盖尺寸 / 像素 / UI 恢复 / 滚动回位。补：**不产生改动记录、也不改 inline 样式**（这是它作为「读操作」的核心约束，原来完全没验）、**失败路径也走 ctx.toast**（把选中元素改成 display:none 触发「选中的元素没有可见区域」）、mode/interactive/popup 三道守卫。
- **4.7.5 ⌘⇧R**——原有只在 Windows 分支验了 prevented。补：**Mac 真实按键路径上挂 framenavigated 计数、断言 0 次导航 + 页面 window 标记存活**（清单 §11 F 行点名要求的那条）、AC-8.11 新增元素在改动列表里成行且认得出是谁、interactive/popup/browse 三道守卫、**未选中时的行为 → F-2**。
- **4.7.6 Windows 变体**——三个套件原来都只有「Windows 上 ⌘ 组合不触发」这一半。补齐另一半反向条件：**Mac 上 Ctrl+Alt+C / Ctrl+Alt+V / Ctrl+Shift+C / Ctrl+Shift+R 全都不触发**（isMod 要求另一边没按）。
- **4.7.7 平台文案**——原来零断言。补一条 → **F-3**。
- **4.7.8 短路**——原来零断言（清单标「待测」）。用 document 冒泡监听验：capture 阶段 stopPropagation 之后，被接管的 ⌥⌘C / ⌘⇧C / ⌘⇧R 在 document 冒泡阶段收不到；同时各配一个对照组（⌥⌘X / ⌘⇧X / ⌘⇧Q）证明监听本身有效。这也就同时锁住了「不会再落到 ⌘Z / 方向键 / ⌥Delete 那几道分支」。

## 一处清单与实现的口径分歧（不是 bug，不上报）

清单 4.7.1 的验收要点写着守卫包含 `!isEditorUI(e)`，但实现**刻意去掉了**这一条——`docs/plans/figma-shortcuts.md` 的「守卫口径（统筹决定）」写明：三组键与 ⌥Delete 只让路「正在打字」（isTypingTarget），不再看 isEditorUI，因为「点完面板按钮紧接着按快捷键是最常见的顺序」。三个模块的源码注释也各自复述了这个决定。我按**已决定的口径**写断言（「焦点在面板按钮上仍触发」「焦点在面板输入框里让路」），没有按清单原文去判失败。清单 §4.7 这一行的措辞建议同步一下。

## 测试自身踩到的坑（已自行修掉，供其它组参考）

1. **已选中的元素点不动**：选中态元素身上盖着上游的 `visbug-handles`（popover=manual），Playwright 的 locator.click 会判定 pointer events 被拦、一直重试到超时。解法是点之前先按两下 Esc（第一下关弹层、第二下取消选中）把覆盖层撤掉，再点；或者改点另一个没被选中的元素。copy-image.mjs 原文件里已有一句注释提到过这件事，replace-element / copy-image 的新增段都按这个模式加了 `pickOne()` / `clearSelection()` 助手。
2. **交互态退出后选中集会原样恢复**，紧接着的 locator.click 又会撞上第 1 条，退出 interactive 之后要先 clearSelection。
3. **模块内存优先于剪贴板**：copy-props 的 `paste()` 是 `clipboard || await readClipboardProps()`，只要这一页按过一次 ⌥⌘C，模块里那份就永远赢——想验「剪贴板里是普通文本」这条分支，必须开一个从来没按过 ⌥⌘C 的新页面。
4. **平台伪装必须覆两个字段**：`isMac` 优先读 `navigator.userAgentData.platform`，只改 `navigator.platform` 不够；而且要在 `injectVisBug` **之前** `addInitScript`（isMac 是模块加载时算一次的）。
5. **弹层守卫用哪个下拉**：`.curve-card` 是 article，属性面板里没有 typography 分区，`vr-select[data-prop="font-family"]` 取不到；用 `vr-select[data-prop="position"]` 才稳（它开出来的就是 POPUP_IDS 里的 `visual-revise-select-panel`）。

## 三个 bug 的关系

F-1 与 F-2 同一个根因（`ctx.toast` → `panel.toast`，而空选中时属性面板不渲染、`.toast` 元素不存在，消息被 `if (!el) return` 静默吞掉），但分开报：F-1 的修法是照 copy-image.js:408 的样子改走 `vr-toast`；F-2 除了提示还多一层危害——`e.preventDefault()` 排在同步就能做的 selection 检查之前，把浏览器的硬刷新一并吃掉了，修法是把 selection 判空提到 preventDefault 之前。F-3 独立，改 `app/features/copy-props.js:103` 用 `combo(ALT, MOD, 'C')` 即可（顺带 `app/components/toolbar/toolbar.element.js:98-100` 的 ⌘Z / ⌘⇧Z / ⌥⇧D tooltip 也是写死的，不在 §4.7 范围内，留给相应分组）。
## 修复结果

16 条全部修复（方案与落地勘误见 [full-e2e-v2-fixes.md](full-e2e-v2-fixes.md)）。修复后全量回归：旧套件 41 套 **1471 通过 / 0 失败**（含本轮新增的 units、page-colors 与扩写的 zoom / keymove / paste / resize-undo / list-follow / guides / copy-*）；全量 13 套 **1404 通过 / 0 失败**（含新增的 split-rows；唯一一处红是工具条「重做」气泡从「⌘⇧Z」改为 Apple 规范序「⇧⌘Z」后的旧期望，已更新）。
