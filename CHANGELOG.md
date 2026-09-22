# Changelog

本文件记录 kb-toolkit 每个轮次的可验收交付。版本号只在收尾轮 bump。

## 未发布 — R33（与 Claude Code 交叉评审后的「界面 / 交互打磨轮」）

**老板拍板（2026-09-22）**：① **不扩** —— R30 ⑤ 保持 `body.is-mobile` 单一口径，本项结案。
**老板要求**：开启 Claude 的前端设计 skill，和 Claude 合作，对插件手机 / 电脑端各个界面和交互进行优化打磨。

### 流程（照 R31 立的规矩，不让它当唯一信息源）

| 步 | 做了什么 |
| --- | --- |
| 派活 | Claude 本体（`@anthropic-ai/claude-code` 2.1.278，后端 DeepSeek）加载 **`design-review`** skill，拆两路**只读**评审：A 视觉一致性 / 排版层级（41,485 B）、B 交互反馈 / 两端一致性（32,156 B） |
| 独立基线 | 我自己先跑量化事实（`tmp/base_r33*.py`），**先于**读它的结论 |
| 对撞 | 两边对上才落地：它报「kbt 没做 hover 复位、复位只清两个属性」，我量到「33 条 hover、触屏只复位 5 条、**26 个选择器漏网**」 |
| 复核 | 每条回源码逐环核对（行号 + 链路），复核为真的才动手；落地即写成断言 |

### 我自己的基线（对撞用）

| 量到的事实 | 数 |
| --- | --- |
| 三个 CSS 的 `:hover` 规则 | **33 条** |
| `@media (hover: none)` 里实际被复位的 | **5 条** → 26 个选择器在触屏会粘住 |
| 手机端触控下限 | cb `30px` / kbt `34px` · 卡片按钮 `36px` —— **三个数** |
| 全项目 `:active` | **1 条**（还是 `cursor: grabbing`，看不见） |
| `ns.css` 的 `.is-mobile` / `@media(hover:none)` | **0 / 0**（内容流四轮适配一次没跟上） |
| 硬编码颜色 | 1 处（`#d08b2c`），`var()` 用了 595 次 —— 这块是干净的 |

### 落地的 9 项

**① P0 —— 状态浮层把手机端卡死**（它报、我逐环复核为真）
`75_core_settingTab.js:474` 唯独状态浮层把宿主传成段落盒 `box`，而 `box` 在模块关闭时带 `.kb-module-disabled`（`ns.css:220` 的 `pointer-events:none` 是**继承**属性）→ 遮罩和 ✕ 都收不到点击，`kbt.css:375` 只放行了**触发者**、没放行它打开的窗 → 手机端**没有任何出口**。改回 `containerEl`（与帮助 / 关于同口径），并给所有小窗补 **Esc**（`bindEscClose`，全 document 只挂一次，避免设置页每渲染一遍泄漏一批监听）。

**② 触屏 hover —— 根治，不再往复位白名单里补**
原来「在 `hover:none` 里逐条复位」是白名单：R31 复了 5 类，实测漏 26 个（设置页 6 条、内容流 2 条**一条都没复**），而且只清 `background` / `box-shadow`，`color` / `border-color` 留着 → 触屏点完是**透明底 + 亮字**（「属性 ▾」最典型，它恰好是操作完不重绘的那个，粘得最久）。
改法：把 **30 条顶层 `:hover` 规则就地包进 `@media (hover: hover)`**（`tmp/patch_r33_hover.py`）—— 触屏根本不加载，而不是生效后再打补丁。就地包裹（不搬到文件尾）→ **层叠顺序一字不变 → 桌面行为零变化**。→ **立铁律 74**。

**③ 触控兜底扩面**：`button` → **按可点语义** `:is(button, .cb-add-type, .checkbox-container, .cb-prop-val, .cb-tree-node, .cb-grip, .cb-sec-allbtn, .cb-mini, .cb-pros-toggle)`；拉杆 `input.cb-wrange` 热区 16px → 34px（轨道仍 5px，thumb 圆心不歪）；菜单里那条 `max-width:92px` 放宽；就地编辑浮层（挂 `body`、不在 `.cb-root` 里）单独补一条。

**④ 触屏 `:active` 按下反馈**：原来全项目只有 1 处 `:active`（还是 cursor）。补上，且**只改背景色、不碰尺寸**（卡片高亮那条注释要求「绝不让卡片跳一下」），放在 `(hover:none)` 里 → 桌面鼠标零命中。

**⑤ 触控下限口径统一 = 34px**：cb 30 / kbt 34·36 → 三文件同值（`run_r33.js` C8~C11 盯着）。

**⑥ kbt 尺寸类从 `@media(max-width:700px)` 搬进 `.is-mobile`**：700 量的是**视口宽**，手机横屏 844~932px > 700 → 整块不命中，同一台设备上看板吃着兜底、设置页却退回桌面小尺寸。搬走后横竖屏一致，桌面窄窗不再被撑胖鼠标目标。

**⑦ 面板回执截断**：`.cb-panel-msg` 是 `nowrap + margin-left:auto`，长回执会把右边的 **✕ 挤出面板外被裁掉** → 补 `min-width:0 + overflow:hidden + ellipsis` 三件套。

**⑧ `ns.css` 内容流补手机端**：此前 `is-mobile` / `hover:none` **都是 0**，看板做了 R29~R32 四轮它一次没跟。补兜底 + `:active`（`.bns-title` 是行内 `<a>`，抬 `min-height` 必须换 `inline-flex` 才吃高度）。

**⑨ 触屏气泡（R32 ③）作用域扩到右键菜单** `.cb-ctxmenu`（vendor 把菜单挂 `body`，原来不在范围内）。

### 复核后**不改的**（附理由，不是漏了）

| 它报的 | 我的复核 | 决定 |
| --- | --- | --- |
| A-P0-1：2 处 `!important` 违反约束 | 真存在（cb.css:1174 / 1182），压的是 Obsidian 原生 `.view-header` / `.metadata-container` 的 display —— 去掉会被原生盖回去，视图头会露出来 | **不改**（AGENTS 记一句「有意」） |
| A-P1-1：4 处硬编码 px 字号（9/9/10/11px） | 真存在，但全是徽标 / 代码块（`.cb-dirty` / `.cb-conflict` / `.cb-prop-name` / `.cb-body pre`），改成变量会撑坏紧凑布局 | **不改**（收益 < 风险） |
| B-P0-2：键盘够不到「打开笔记」 | 真（vendor 的 `<a>` 没 href/tabindex），但补 tabindex = 往 Tab 序里塞进**每张卡片一个**停靠点 | **报老板定**（风险中） |
| B-P1-12：桌面窄分屏最右按钮被静默裁掉 | 真，但**正是老板刚拍板「不扩」的那条边界** | **报老板定**，本轮没碰 |

### 我自己造的两个坑（都当场修了）

1. 🔴 **Python 写文件把 LF 全转成 CRLF**（`open(..., "w")` 默认按平台翻译换行）→ 项目 `.gitattributes` 锁 `eol=lf`。已用 `tmp/fix_eol_r33.py` 改回（cb.css 2249 处 CRLF → 0，另 kbt/ns/src85 同修）。
2. **6 条字面计数断言被撞假红**（`30px` 写死、hover 块数写死、r28 段切片一路切到文件尾、r27 的「`{` 后 260 字符内」）→ 按铁律 49 **按意图重写断言**，不是改代码迁就。

### 验证

| 项 | 数 |
| --- | --- |
| `run_all.js 3` | **2616/轮 · 7848/0**（R32 基线 2568/轮，本轮 +48） |
| `run_r33.js`（新增） | **48/0** |
| 真引擎几何层 | **59/0**（桌面零变化的回归保护） |
| 像素层 | 23/0 |
| `main.js` | 585,148 → **586,492 B** |
| `styles.css` | 87,305 → **92,185 B** |

## 未发布 — R32（R31 遗留 4 条，老板拍板「剩下 5 项也全做」+ 1 条框架重构）

**老板拍板**（2026-09-22）：范围 = **剩下 5 项全做**；① 先给影响说明、**之后再确认一轮**
（→ 本轮 ① **零代码改动**）；④ 极窄屏工具条 = **缩短按钮文案**（不做横向滚动）。

### ① 只出影响说明（本轮一行代码都没动）

把 R30 ⑤ 的 `body.is-mobile` 扩成 `@media (max-width: 700px)`（窄桌面窗口也照做）会发生什么：

| 项 | 现状（`.is-mobile`） | 改成 700px 媒体查询后 |
| --- | --- | --- |
| 桌面命中 | **永不命中**（桌面 body 没有这个 class） | 窗口拖到 <700px（分屏 / 外接小屏 / 系统缩放 200%）**立刻命中** |
| `.setting-item` | 手机端恢复横排 | 窄桌面窗口下也横排 —— 与 Obsidian 原生 `@container<400px` 的**竖排**相反，长名字会挤按钮 |
| 按钮 / 控件宽度 | 手机端 `width:auto` 不铺满 | 同上：原生让它们铺满，我们改成不铺满 |
| 「桌面零影响」这条边界 | **可验证**（几何层有 1080px 桌面对照页） | **没了** —— 以后每个窄窗改动都要重新解释「这算桌面还是手机」 |
| 与 cb.css 已有的 700px 块 | 各管各的 | 设置页规则也进 700px 块 → 同文件两块 700px 并存（**R30 就因两块 700px 打架栽过一次**） |

**我的建议：不扩。** 真要做，更稳的是加一个 `body.is-narrow-window` 类（JS 按宽度打），
而不是直接用媒体查询 —— 桌面 / 手机两套口径就能分别开关、分别断言。

🟢 **老板拍板（2026-09-22）：不扩 —— 本项结案，后续不再提。**
`body.is-mobile` 保持单一口径；「桌面零命中」这条可验证边界继续保留（几何层 1080px 对照页）。

### ② `.cb-prop-val` 的 hover：复位 + 常驻提示顶上（R31 曾有意留着没动）

| 事实 | 处理 |
| --- | --- |
| 触屏没有 hover → 点过之后灰底/光环**粘住**，看着像「还开着」 | `@media (hover: none)` 里复位（跟 R31 那 6 类同机制） |
| 但那块灰底是「这里能点、能改」的**唯一**提示，光复位会把提示弄丢 | 补一条**常驻**虚线下划线：`.cb-root:has(.cb-ro:not(.is-on)) .cb-prop-val:not(.is-empty)` |
| 下划线会不会撑高卡片 | 不会 —— `text-decoration` 不进盒模型；且只在**可编辑态**（只读开关没开）出现，空值不给 |

### ③ 42 个 `title` 在触屏等于没有 → 自绘触屏气泡 `.cb-tip`

| 事实 | 取证 |
| --- | --- |
| 看板里 42 处说明全写在 `title` 上 | `vendor/creation-board.js` 里 `setAttr("title"` 计数 |
| 触屏没有 hover → 这些说明一个都看不见 | 同上 |
| 系统 tooltip 也救不了：vendor 的长按（550ms）会 `preventDefault` | vendor:2984 |

做法（`src/85_modules_base.js`，**不碰 vendor 一个字节**）：按住 ≈400ms 弹一个自绘气泡；
抬手 / 手指移动 >10px / 滚动 / 下一次触摸 立刻撤；最多活 1.2 秒。四条边界：
① 只认 `.cb-root / .cb-panel / .cb-ed-pop` 之内，不接管整篇文档；
② 气泡 `pointer-events: none`，绝不挡手指；
③ `z-index: 30` < 浮层遮罩 40 < 长按菜单 `--layer-modal(100)` —— 菜单出来盖住它，不打架；
④ 桌面（有 hover）**压根不装**，`installTouchTips()` 直接返回 `null`。

### ④ 极窄屏（≤360px）工具条：✎可编辑 / ↻重载 只留图标

| 事实 | 取证 |
| --- | --- |
| grid 的 `max-content` 列**永不收缩** → 字号一被系统放大，最右那颗被**静默裁掉**（没滚动条、没省略号） | 真引擎 320px 实测 |
| 文字是 vendor 直接塞进 `<button>` 的**文本节点**，没有子元素可以 `display:none` | vendor:763 / 783 |
| 所以：`font-size: 0` 让文本节点不占宽 + `::before` 把图标字形补回来 | 真引擎实测 font-size 计算值 = 0px |
| 🔴 光 `font-size:0` **不够**：`.cb-ro` 所在的列跟第二行 `.cb-mode` **共用列宽**，盒子还是被拉满 | 320 + 1.5× 字号实测 126px |
| → 补 `justify-self: start`，盒子才收得住 | 同上：126 → 40px |

真引擎实测（`tmp/render_r30.py` ⑦⑧ 段，320px 视口 + 系统字体放大 1.5× 的对照页）：

| 档位 | 做了 ④ | 不做 ④（对照组） |
| --- | --- | --- |
| ro / gear / refresh 宽度 | 40 / 58 / **36** | 99 / 58 / **77** |
| 工具条**余量** | **161.9px** | **62.1px** |
| 是否越界 | 否 | 否（但只剩 62px，再大一档字体或再窄一档机器就会静默裁掉最右那颗） |

⚠️ 说清楚：320px 正常字号下**不做 ④ 也不越界**（余量 130px）。④ 买的是**余量**，不是修一个
已经在发生的裁切。`⚙板块` 的「板块」二字**留着** —— 它是看板设置的唯一入口，且 vendor
没给它 `title`（气泡也救不回来）。

### ⑤ 中央表重算收进 `applySettingsChange`（R31 说要独立做的那条）

原来 87（向导保存）/ 75（改路径）两处各自手写 `router.util.applySettings(S)` ——
**任何新的**配置改动调用点都极易漏（漏了 = 中心页双链仍按老库根推导，得重载插件才对）。
现在收口进 `applySettingsChange`：调用方只管改 settings，重算统一在这里做，顺序 =
先重算 → 落盘 → refresh → reapply。**`onload` 那条留着不动**：开机没有「配置变更」可收口，
走收口函数会白白多一次 `saveSettings`。

### 验证（改前备份 `.workbuddy/backup/kb-toolkit-R32-2026-09-22/`，16 个文件 sha256 回读核对）

| 层 | R31 基线 | R32 |
| --- | --- | --- |
| `run_all.js 3` | 2510/轮 · 7530 | **2568/轮 · 7704**（+58 = 全新 `run_r32` 56 + `run_r29` D1 段 +2） |
| `run_r32.js` | — | **56 / 0**（全新：⑤ 框架 8 + ③ 源码 14 + ③ **真 DOM 冒烟 12** + ② 8 + ④ 10 + ① 2） |
| `run_r29.js` | 86 | **88**（D1a~D1d 按意图重写：从「断点值只有一种」改成「恰 2 档 + 360 只一块 + 360 块不许长成第二套手机端口径」） |
| `run_r30.js` | 40 | 40（本轮未动） |
| 真引擎几何 | 42 / 0 | **59 / 0**（+17 = ⑦ 极窄 320 档 6 条 + ⑧ 极窄 + 1.5× 字号**对照页** 11 条） |
| 真引擎像素 | 23 / 0 | **23 / 0** |
| `main.js` | 579,809 B | **585,148 B** |
| `styles.css` | 83,746 B | **87,305 B** |

## 未发布 — R31（与 Claude Code 交叉验证 → 框架 + 手机/电脑端界面交互优化）

**老板原话**：和 claude code 对项目进行交叉验证，通过启用 claude 的开发优化 skill 的方式，
对项目代码框架和手机电脑端操作界面，交互方式进行优化。

### 怎么做（不是「让另一个模型夸一遍」）

| 步骤 | 做法 |
| --- | --- |
| 两条只读评审 | A 路径 = 架构 / 依赖方向 / 重复实现 / 可维护性；B 路径 = 手机·电脑端一致性 / 断点与魔数 / 选择器冲突 / 交互反馈。**只读，不许改文件**（vendor 冻结套件更不许碰） |
| 交叉模型 | 本机 Claude Code v2.1.278 非交互模式（后端是 DeepSeek，所以「交叉」= 我 vs 另一个模型） |
| 我自己一份独立基线 | 长函数 / 跨文件重复中文字面量 / 空 catch / 大文件，先有自己的数，再拿它的结论对撞 |
| 逐条复核 | 它给的每条都回源码 / asar / probe JSON 验一遍。**验出来是假的就不做**（本轮无一条造假，但我的 R30 自查漏了它抓到的 P0） |

⚠️ 踩到的坑：`--permission-mode plan` 会把正文写进 `~/.claude/plans/` 而 stdout 只剩一句指针
（B 路径 39 KB 正文就这么丢了）。第二次显式要求「别用 ExitPlanMode、别写 plan 文件、把完整
分级评审打在最终回答里」才拿到全文。

### A 路径落地（代码框架，4 条）

| # | 问题 | 改法 |
| --- | --- | --- |
| 1 | `80_modules_automation.js` 写补全报告时，库根不存在也照样 `ensureFolder` → **逐级建出一个空的「假库根」**，之后向导建真库就撞名 | 与 `82` 的 `root-missing` 守卫同口径：根不在 → 不写报告（只 `console.warn`） |
| 2 | 插件目录字面量 `".obsidian/plugins/kb-toolkit"` 在 66 / 80 / 82 各写一遍 | 收回 `00_prelude.js` 的 `KB.PLUGIN_DIR` 唯一出口 |
| 3 | `66_services_report.js` 的 `logFolder` 写死默认 `"99_Meta"` —— 而 `run_r5` 的硬编码守卫要求 `99_Meta/`（**带斜杠**），裸字面量正好从缝里漏过去 | 默认值改在**调用时**取 `settings.DEFAULTS.paths`（本文件编号 66 < 70，定义时拿不到）；`run_r5` 补一条按意图的断言堵住这道缝 |
| 4 | `80` 的 `_cmdIds` 恒为空、`removeCommands()` 每次 disable 白跑一趟（R13 收进设置页后本模块零 `addCommand`）；`catch (e) { this.stats.blocked++ }` 而 `stats` 全插件无人读 = 把异常吞掉 | 删死代码；catch 补 `console.warn` 留痕（不 rethrow —— 单篇失败不该中断整批补全） |

**没做的那条**：`90_entry.js` 的 `applySettingsChange` 缺「中央表重算」，导致 `90` / `87` / `75`
三处手写 `router.util.applySettings(S)`。合并要动三个调用点，属于独立重构，**留给老板定**。

### B 路径落地（界面 / 交互，9 条）

| # | 问题（实测数） | 改法 |
| --- | --- | --- |
| **P0** | R30 ①② 的作用域 `[data-type="creation-board"]` **真机根本不命中** —— leaf 的 `data-type` = `View.getViewType()` = 原生 `"bases"`（asar @1808481），`registerBasesView` 注册的是 Bases **内部**视图类型，不会出现在 leaf 上 | 改成 `[data-type="bases"]:has(.cb-root)`：锁真机值 + 用 `.cb-root` 收窄到我们的看板（顺带修掉「任何 Bases 视图都被打」的越界） |
| 2 | `cb.css` 里两个 `@media (max-width:700px)` 块隔 128 行互相打架（grid 之后 `flex-wrap/row-gap` 成死声明、`.cb-mode` 的 max-width 写了两遍） | 合并成**唯一一块**（`run_r30` G1 钉住） |
| 3 | 触控目标是 14 条**逐个点名**的白名单，漏了 `.cb-plus`(19px) / `.cb-panel-x`(≈19) / `.cb-pros-toggle`(≈19) / `.cb-add-type`(≈20) / `.cb-title`(≈23) | 改**兜底式**：`.is-mobile .cb-root button, .is-mobile .cb-add-type { min-height: 30px }`；写死 `height` 的 `.cb-plus` 先 `height: auto`（min-height 打不过 height） |
| 4 | ⚙板块 **18px** vs ✎/↻ **30px**，y 也不齐（12 vs 6）；⚙ 是看板设置面板的唯一入口 | 三颗**同档**（min-height 30 + padding 5px 10px） |
| 5 | `.cb-refresh` 还留着桌面的 `margin-left: 6px` → ⚙↻ 间距 **14** 而不是列距 8，看着不像一组 | 手机端清 0（实测 14.0 → 8.0） |
| 6 | `.cb-mode` 的 `max-width: 100%` 在 `max-content` 列里等于**没上限**，长文案把第二行统计挤没 | 改绝对长度 `45vw` |
| 7 | `@media (hover: none)` 只复位了 `.cb-card` 一家，其余 21 条 hover 在触屏上**粘住** | 按机制扩到 6 类选择器。🟡 **有意不复位 `.cb-prop-val`** —— 那块灰底是「这里能点/能改」的唯一提示，粘住的代价小于提示丢失，**待老板拍板** |
| 8 | R30 ⑤ 把卡片**横向**内边距压成 12px（桌面是 14px）→ 手机比电脑**更贴**白框，与老板诉求相反（注释还写「8px→12px」，可桌面本来就是 14） | 改成**只覆盖纵向**（2px → 4px），横向沿用桌面 14px（几何层实测手机 = 桌面 = 14px） |
| 9 | 设置页三个主标签手机端只有 **27px** 高、彼此隔 2px（同屏 ghost 按钮 34px） | `.is-mobile .kbt-tab { min-height: 34px }` + `.kbt-tabs { gap: 8px }` |

### 验证（改前备份 `.workbuddy/backup/kb-toolkit-R31-2026-09-22/`，9 个文件 sha256 回读核对）

| 层 | R30 基线 | R31 |
| --- | --- | --- |
| `run_all.js 3` | 2501 / 0（7503） | **2510 / 0（7530）** |
| `run_r30.js` | 32 | **40**（+8 条 G 段 R31 归并断言） |
| `run_r29.js` | 86 | **86**（段锚点失效导致的 11 条假红已按铁律 49 重写） |
| `run_r5.js` | 103 | **104**（+1 堵裸字面量的缝） |
| 真引擎几何 | 41 / 0 | **42 / 0**（+1 对照页） |
| 真引擎像素 | 23 / 0 | **23 / 0** |
| `main.js` | 577,991 B | **579,809 B** |
| `styles.css` | 79,575 B | **83,746 B** |

### 待老板定（4 条，本轮**故意没动**）

🟢 **R32 已收尾**（老板拍板「剩下 5 项也全做」）：②③④⑤ 见上面 **R32** 段；
① 按老板要求本轮**只出影响说明、零代码改动**，仍在等下一轮拍板。以下原文留档。

1. R30 ⑤ 用的是 `body.is-mobile`，窄桌面窗口（`@media 700px`）要不要也照做？—— 碰「桌面零影响」这条边界，不敢替老板扩。
2. `.cb-prop-val` 的 hover 到底复不复位（见上表 #7）。
3. 42 个 `title` 属性在触屏上等于没有（长按 `preventDefault` 会掐掉原生 tooltip），要不要改成气泡/提示条（牵涉 vendor 回调）。
4. 极窄屏时工具条 `max-content` 永不折行 → 静默裁切，是加横向滚动还是缩短按钮文案。

## 未发布 — R30（老板五条：手机端排版与手感专项）

**老板五条**（2026-09-20，一句话原文 + 附加要求「不要影响电脑端界面，保证代码清晰度和可维护性」）：

> 1. 界面上方 base 路径在手机竖屏模式下显示不全，要求只留下 base 自己的名字
> 2. 创作看板和 344 个结果字样显示不全，要求手机端页面不够时，创作看板只留下图标，不显示文字，344 个结果字样直接不显示
> 3. 可编辑，板块和重载图标在手机端有错位，要求可编辑图标在靠左，板块和重载图标靠右
> 4. 插件设置界面，手机端顶部的日志，关于，帮助小字放知识库，笔记，base 按钮的下面，小字靠左显示
> 5. 插件手机端设置界面选项小框中，以预览报告为例，生成预览报告的按钮太大，把文字挤到上面去了。而且按钮和文字靠边上的白色框框太近了，稍微保持一点距离

🔴 **本轮 100% CSS**（`main.js` 一个字节都没变，构建产物仍是 577,991 B），
五条全部**只写进手机 / 窄窗作用域**，桌面对照组一条都不命中（真引擎 1080px 逐条验过）。

### ① 面包屑只留本名

| 事实 | 位置 |
| --- | --- |
| 父目录每一段是**独立元素** `.view-header-title-parent` | asar 取证 @230998 |
| 该元素自带 `:empty { display: none }` → 末段的**文件名**不是 parent，藏不掉也不该藏 | 同上 |
| 手机上三段父目录把标题挤没 | 老板截图 ① |

```css
body.is-phone .workspace-leaf-content[data-type="creation-board"] .view-header-title-parent { display: none; }
```

只作用于**看板这一片叶子**（`data-type="creation-board"`），**笔记页顶上的路径照旧完整**——
老板要的是「看板上别显示路径」，不是「全局别显示路径」。

### ② 「创作看板」只留图标 / 「344 个结果」不显示

asar 取证 @524236 / @526121：原生 `@container (width < 540px)` 把 `--bases-toolbar-label-display`
设成 `none`，但**只对 `views-menu` 和 `result-count` 之外**的项生效 —— 恰恰就是老板点名的这两个
「在别的项都收起之后，它们的文字留下来把行撑爆」。补两条：

```css
body.is-phone .bases-toolbar .bases-toolbar-views-menu .text-button-label { display: none; }
body.is-phone .bases-toolbar .bases-toolbar-result-count { display: none; }
```

视图名**只剩图标**（切换视图还点得动），计数整条不占位。

### ③ 工具条归位：✎ 靠左，⚙ / ↻ 靠右 —— 用 grid 钉死

🔴 **flex 方案两连败**（详见铁律 70）：桌面 `.cb-ro` / `.cb-gear` 自带 `margin-left: auto`
→ 手机上 ✎ 飘到行中间（实测 x=213）；`flex-wrap` 的折行按 **flex-basis 假想宽度**算，
长统计 `.cb-count` 会把整行挤乱。改用 **`grid-template-areas` 把两行写死**：

```css
@media (max-width: 700px) {
  .cb-bar {
    display: grid;
    grid-template-columns: max-content 1fr max-content max-content;
    grid-template-areas:
      "ro mid gear refresh"
      "mode count count count";
  }
  .cb-ro  { grid-area: ro;      margin-left: 0; }   /* 🔴 清掉桌面的 auto */
  .cb-gear{ grid-area: gear;    margin-left: 0; }   /* 「靠右」交给中间那列 1fr */
  .cb-count{ grid-area: count; text-overflow: ellipsis; }  /* 太长就省略号，不抢行 */
}
```

### ④ 设置页：日志 / 关于 / 帮助 换到标签行下面、靠左

`.kbt-tabs` 允许折行 + 三个小字 `order: 2; flex-basis: 100%; justify-content: flex-start`。
桌面那条 `margin-left: auto`（r18-211 立的「小字靠右」）**一行没动**，只在窄窗媒体查询里清。

### ⑤ 核心操作：名字左 / 按钮右，不再铺满，内容和白框留点距离

原生 `@container (max-width: 400px)`（asar 取证 @251792）让 `.setting-item` **竖排**且按钮 `width: 100%`
—— 这就是「生成预览报告的按钮太大、把文字挤到上面」的根因。用**双类 + `body.is-mobile`** 压回去
（特异性 (0,5,x) > 原生的 (0,3,1) / (0,4,1)，**不用 `!important`**）：

```css
.is-mobile .kbt-sec.kbt-core-actions .setting-item { flex-direction: row; align-items: center; }
.is-mobile .kbt-sec.kbt-core-actions .setting-item-control button:not(.clickable-icon) { width: auto; }
```

🔴 **只作用于 `.kbt-core-actions`**（预览 / 执行 / 回滚三行没有说明文字，横排放得下）；
「辅助」等**带说明文字**的行保持原生竖排 —— 一刀切横排会把说明挤没。
卡片内边距 `8px → 12px`（内容和白框之间留一圈）。

### 验证

| 层 | 结果 |
| --- | --- |
| 全量回归 `run_all.js 3` | **7503 通过 / 0 失败**（2501 / 轮，33 套件） |
| 新增 `run_r30.js` | **32 / 0**（五条的 CSS 规则 + 作用域 + 桌面零命中 + grid 模板文本 + `!important` 计数为 0 + 复写病自检） |
| `run_r29.js` | 85 → **86**（D1 按铁律 49 改成量**断点值唯一**而非「出现 1 次」——R30 多写一个 700px 块，字面计数会假红） |
| 真引擎几何层 `tmp/render_r30.py` | **41 / 0**（390×844 vs 1080×800 双视口；父目录 `display:none` 且本名还在 / label 与计数 none 且图标还在 / grid 两行、✎ 贴左、↻ 贴右、⚙↻ 成组 gap 6–16 / 小字在标签下方靠左 / 横排且按钮 < 卡片 55% / 内边距 12px vs 桌面 14px） |
| 真引擎像素层 `tmp/check_r30_shots.py` | **23 / 0**（面包屑墨量手机 278 vs 桌面 1451 / 工具条墨迹跨度手机 30px vs 桌面 200px / 手机墨迹纵向跨度 62px vs 桌面 31px = 真换行 / 小字墨迹首行 45 > 标签末行 30 / 内容墨起点 x=11 ≥ 卡片内边距） |

构建：`main.js` **577,991 B（未变，本轮纯 CSS）** / `styles.css` 75,031 → **79,575 B**。

## 未发布 — R29（老板三条：改名保位 + 浮层字号 Ctrl+滚轮 + 手机端适配）

**老板三条**（2026-09-20，一句话原文）：

> 1. 当我更改文件名字后，保留原文件位置，不要让文件改完名条最后面去了
> 2. 文件点进去以悬浮小窗状态显示时，可以通过 Ctrl 加鼠标滚轮的方式缩放字体大小
> 3. 优化手机端此插件适配

### ① 改名保位 —— 根因是「顺序表存的是路径」

| 事实 | 位置 |
| --- | --- |
| 手动顺序（拖动排序的结果）存的是**文件路径**：`{板块键: [路径, …]}` | `onCardDrop()` / `loadManualOrder()` |
| 改名会**换掉路径** | `beginRename()` → `fileManager.renameFile()` |
| 排序时「表里没点名的条目」一律兜底成 `BIG = MAX_SAFE_INTEGER` → **甩到最末** | `applyManualOrder()` |

三者相接就是老板看到的现象：**改完名这张卡跑到板块最后面去了**（不是它动了，是它在顺序表里"失联"了）。

**修复**：`beginRename()` 在调 `renameFile()` **之前**先留一份旧路径（`renameFile` 是**就地改** `entry.file.path` 的），
改名 / 搬目录之后调 `migrateManualOrderPath(oldPath, newPath)` —— 把顺序表里所有取值等于旧路径的格子**就地换成新路径**。

🔴 只动**取值、不动键**：键是「数据源:路径」（板块级、与笔记名无关），动它反而错位（`run_r24` B20 守着这条）。
三个改名入口（`beginRename` 提交 / `moveFileToFolder` / `promptMoveToFolder`）全部接上；`lastRename` 记 from/to 供诊断。

### ② 编辑浮层字号：`--cb-ed-fs` 是唯一入口

- 新的视图级键 `K_ED_FS`（`编辑浮层字号`，10–32 px，`null` = **跟随主题**）。
- CSS：把原来写死的 `font-size: var(--font-ui-smaller)` **就地改成** `font-size: var(--cb-ed-fs)`，
  并在**原来那条** `.cb-ed-pop` 规则里声明初值 `--cb-ed-fs: var(--font-ui-smaller)`
  —— 不新开第二条规则覆盖（两条规则打架 = 以后改哪条都失效）。
- 浮层里 **Ctrl/Cmd + 滚轮** 拨号（一档 1 px，`passive:false` 才能 `preventDefault`；不按修饰键的滚轮照旧滚页面）；
  标题条加一枚 **`A 跟随` 徽标**回显当前值，**双击徽标**回「跟随主题」（给条明路）。
- 一并覆盖 `--font-text-size` —— 表格 / 属性 / 内嵌块跟着一起缩，不然只有正文变。
- 顶栏面板「内容」组新增同名拉杆（与滚轮**同一个键**，两个台面不漂）。
- 导出/导入都带上 `K_ED_FS`（只导出**显式设过**的值，别把默认固化进 `.base`）。

🔴 **顺带修掉一个自相矛盾**：面板改字号时如果调 `repaint(false)`，会走 `repaint → renderBoard → unmountEditor(false)`
把老板**正开着的那个浮层直接收掉** —— 那「当场刷开着的浮层」就没意义了。所以这条 commit 里**故意不 repaint**
（字号只影响浮层本身，看板那层没有东西要吃它）。

### ③ 手机端适配：两条适配互不干扰

- `@media (max-width: 700px)`：工具条 / 板块头 `flex-wrap: wrap`；`.cb-root` 左右内边距收到 6px；
  卡片栅格 `minmax(min(var(--cb-card-w), 100%), var(--cb-card-max, 1fr))`（**卡片比屏宽时的唯一挡板**）；
  浮层 / 面板宽 `96vw`；跟手小窗 `max-width: 92vw` + `max-height: calc(100vh - 16px)` + 自己滚。
- `.is-mobile`（Obsidian 移动端本体）：触控目标放大 —— 菜单项 `padding: 8px 12px`、`.cb-mini` / `.cb-seg-btn`
  `min-height: 30px`、浮层 ✕ / 徽标内边距、折叠三角 `1.6em`、板块名升到 `--font-ui-medium`、卡片标题 +2px。
- `@media (hover: none)`：触屏没有 hover → 卡片悬停边框 / 阴影复位，别白占提示位。
- 🔴 **桌面一个字节都不受影响**（真引擎对照组：1080px 下这些声明一条都不命中）。

### 验证

| 层 | 结果 |
| --- | --- |
| 全量回归 `run_all.js 3` | **7404 通过 / 0 失败**（2468 / 轮，32 套件） |
| 新增 `run_r29.js` | **85 / 0**（改名保位取值迁移 ×1 + 只动值不动键 + 三个调用点 + 旧路径先于 renameFile 取；`K_ED_FS` + 常量 + 夹取 + 滚轮修饰键 + `passive:false` + 徽标双击复位；CSS 单入口 + 断点单条 + 手机两条适配共存 + 顶层 `.cb-ed-pop` 仍只一条 + 复写病自检） |
| `run_r20b.js`（真 DOM 冒烟） | 340 → **386**（真 `renameFile` 改名保位 + 真渲染反证「不迁就被甩到最后」 + 桩补 `WorkspaceLeaf`/`MarkdownView` 后**真跑 `mountEditor`**：Ctrl 滚轮写键 / 不按修饰键不写 / 到顶不刷盘 / 双击徽标复位 / 面板拉杆当场刷开着的浮层且**不关窗**） |
| 真引擎几何层 `tmp/render_r29.py` | **92 / 0**（徽标布局 + `--cb-ed-fs` 真吃变量 + 390×844 下 96vw / 折行 / 无横向滚动条 / `.is-mobile` 触控目标 / 桌面对照组） |
| 真引擎像素层 `tmp/check_r29_shots.py` | **33 / 0**（徽标 1px 边框真画出来 + 文字真在框里 + **12px → 12 行墨 / 22px → 22 行墨**（比值 1.83 = 22/12）+ 工具条墨迹跨度 40 → 85 行） |
| 独立套件 / 沙盒 | bases-preview 45/0 · 沙盒 229/0 · 真库副本 247/0 全绿 |

构建：`main.js` 577,991 B / `styles.css` 75,031 B。

## 未发布 — R28（老板报障：删光板块后兜底「全部」看板把整个库拖卡）

**老板报障**（2026-09-20）：

> 当删除看板后，默认显示的全部看板会导致整个数据库卡住，各类操作都变得很卡甚至不响应

**根因 = 两层叠加，缺一不成灾**

| 层 | 事实 | 后果 |
| --- | --- | --- |
| ① 兜底「全部」板块**没有 limit** | `buildSections()` 在「未配置任何板块」时直接 `return { id:"all", source:"all", entries: all }` —— **全库 N 篇一次性全渲**，绕开了普通板块的默认 50 条上限与 totalCap | 真库 344 篇卡片一口气铺满 DOM |
| ② 卡片正文里的 ` ```base ` **真渲染** | `loadBody()` 走真 `MarkdownRenderer.render` → 正文里嵌了 ` ```base ` 的 MOC 会**各起一个独立的 Bases 引擎** | 滚进多篇 MOC 时一次并发起一串引擎，主线程冻住 |

叠加起来就是老板看到的现象：**删光板块 → 兜底「全部」全库裸奔 → 卡片滚到哪起一串 Bases 引擎 → 整个 Obsidian 卡死**。

**修复**（两点均按老板 prior 拍板：兜底与普通板块同口径；内嵌看板照渲但限并发）

| 要点 | 落地 |
| --- | --- |
| ① 兜底「全部」**加默认上限 50** | 新常量 `DEFAULT_ALL_CAP = 50`；新视图键 `K_ALL = "全部板块上限"`（`null` = 跟随插件设置 `allCap`，`0` = 不限）。`buildSections()` 兜底分支：`lim = this.allCap(); if (lim>0 && all.length>lim) { allCappedCount = all.length - lim; entries = all.slice(0, lim) }` —— **与普通板块口径完全一致**（默认只渲 50 条），并把 `shownCount` 一起带上 |
| ①b 工具条**如实报截断** + 「显示全部（慎用）」按钮 | 板块头条数写 `shownCount / total 条`；`allCappedCount > 0` 时工具条追加 `· 全部板块超上限截断 N 篇`；板块头右侧给 `.cb-sec-allbtn` 药丸按钮 —— 点它 `cfgSet(K_ALL, 0)` **真放开**（按钮文案变「恢复上限 50 篇」），再点 `cfgSet(K_ALL, null)` 回插件默认。**只读视图不给这个按钮** |
| ② 卡片正文内嵌看板**照渲但限并发** | `pumpBody()` 重写为限并发 + 让帧：一次最多起 `BODY_CONCURRENCY = 2` 个正文任务（`Promise.all` 等这批完），批与批之间 `await this.bodyYield()`（`setTimeout`，`BODY_YIELD_MS = 16`，不用 rAF 免得后台标签页不触发）让出主线程；单篇渲染挪进 `runBodyJob(item)` 带 `try/catch` —— **出错也推 done**，绝不把队列卡死 |
| ③ 配置搬运 + 设置页 | `exportConfig` / `applyConfig` 带上 `K_ALL`（否则导出再导入静默丢设置）；设置页新「性能护栏 · 全部板块上限」`int` 项（默认 50）；`loadSettings` 归一 `allCap` |

**验证**（全绿，实测数字）

- `run_all.js 3` → **2337 通过 / 轮 × 3 = 7011 全绿**
- 新增 `tests/run_r28.js` **69**（配置层 / 兜底加限 / 按钮 / 搬运设置 / 限并发 / CSS / 出货一致性）；`tests/run_r20b.js`（真 DOM 冒烟）298 → **340**（造 120 篇 + 走兜底 → 量卡数 50/60、工具条、标题、按钮**真点真写** `.base`、`pumpBody` 并发峰值 ≤2、出错不卡队列）
- R28 **真引擎几何 49 + 像素 24**：按钮真出现且**仅兜底块上**、小药丸**不撑高**板块头、淡底 ≠ 页面底且字色可读、两条文案分支、卡数**真被限住 50 / 真能放开 60**、深色主题淡底跟着主题走
- 独立套件 **45** + 真文件沙盒 **229** + 真库副本 **247** 全绿
- 构建 `main.js` **568,083 B** / `styles.css` **70,862 B**

**真机验收 2 条**：①在没有配置任何板块的看板上（或**把板块全删光**后）看兜底「全部」那一块 —— 是否**只渲 50 条**、板块头是否写「**50 / N 条**」、旁边是否有「**显示全部 N 篇（慎用）**」小按钮；点它是否**当场放开到全部**（按钮变成「恢复上限 50 篇」）、再点是否回到 50 条。②滚进**正文里含 ` ```base ` 的 MOC** 卡片，是否**不再一次冻住**（最多同时起 2 个引擎、批间让帧）。

**🔴 本轮新踩的环境坑（记账，不是代码问题）**：WorkBuddy 沙箱注入的 `node-safe-delete-shim` **拦截 `fs.rmSync`** → `run_r5.js` 的 J 段（调 `scripts/make_sample_vault.js`，第一句就是 `rmSync` 示例库）当场崩 → `catch` 住后 5 条断言全跳 + 1 条失败，表现成 `PASS 103 / FAIL 1`（而不是 108/0）。**不是代码回归**。跑全量回归 / 示例库生成器必须 `dangerouslyDisableSandbox`（关沙箱后复跑 = 7011/0）。

## 未发布 — R27（老板五条：帮助换行 + 新建描边闪 + 菜单不关窗 + 收起本板块 + 全体面板填空）

**老板要求**（2026-09-20）：

> 1. 右键菜单里的提示文字（显示帮助）展开后加个换行
> 2. 右键新建文件后，新建的文件加一小段时间的描边
> 3. 右键菜单里进行设置后界面自动刷新挺好，但右键菜单别关闭了
> 4. 右键菜单的刷新下面加个收起当前板块
> 5. 对于全体板块的设置界面（顶栏「板块设置」面板）稍稍有点空，在简洁有层次的排版基础上，对全体板块的设置选项进行新增优化
> 6. 在以上建议基础上延伸，加入自己的优化方案，开始优化

| 老板原话 | 落地 |
| --- | --- |
| ① 帮助换行 | `.cb-sec-help { white-space: pre-line }` —— 「显示帮助」展开后每条说明各占一行（不再挤成一大坨） |
| ② 新建描边闪 | `flashNewCard(cardEl)`：右键新建成功后给新卡片挂 `.cb-card.cb-flash`，1.6s 后自己摘掉。`.cb-flash` **只动 `border-color` + `box-shadow`**（走 `@keyframes cb-flash-ring`），**宽高一个像素不变**（几何层实证：闪卡与同排普通卡 top/height 完全一致） |
| ③ 菜单不关窗 | 菜单里所有设置项改走 `itemStay()` —— **窗不关**，就地重画那一行的当前态 + 顶上多一条回执行回执（「刷新」也留在窗内） |
| ④ 收起本板块 | 「刷新」下面新增一项，按当前态显示「收起本板块 / 展开本板块」，复用已有的折叠逻辑（收的是**这一个**板块，不是全收） |
| ⑤ 全体面板填空 | `renderPanel` 三段 → **四段**：窗头下加**摘要条**（`N 篇笔记 · N 个板块 · 正文开 · 隐藏空板块 · 可编辑`）；新开「**内容**」组（属性默认展开 · 正文默认展开，从原生视图选项搬来）；「卡片」组补**网格间距**（新键 `K_GAP`）与**卡片默认高度**（新键 `K_CARD_H`，带「跟随内容」）；「板块」组加**一键全收 / 全展开**（`.cb-bulk`）与每行的「**已自定义**」淡紫徽标（`.cb-badge-ovr`）；另加「**隐藏空板块**」打勾项（新键 `K_HIDE_EMPTY`） |
| ⑥ 延伸 | ①~⑤ 之外自查出 4 个真问题（见下），外加把只有 CSS 说得清的 4 处外观补上几何 + 像素两层取证 |

**阿盘自查出的真问题（全是「断言全绿但不生效」，只有真 DOM / 几何层抓得到）**

1. 🔴 **回执被 `persist()` 覆写**：菜单里改完写 `this.saveState = "…"`，紧接着 `afterChange() → persist()` 把 `saveState` 改成「已写入 .base」→ 顶上那条回执成了废话。修 = 新开 `note(msg)` **专用通道**（`secMenuStatus` + `saveState` 一起写），重画时优先读 `secMenuStatus`。
2. 🔴 **`refreshSecMenu()` 拿错板块**：重画时按下标写 `this.sections[a.si]` —— `sections`（渲染顺序，含「收容所」「公式」另起的一条）**不等于** `secs`（配置顺序）→ 下标错位会把设置写到别的板块上。修 = 按身份找：`sections.find(s => s.srcIndex === a.si)`。
3. 🔴 **配置搬运漏 3 键**：`exportConfig()` / 导入 `kinds` 表没带 `K_GAP` / `K_CARD_H` / `K_HIDE_EMPTY` → 导出再导入**静默丢设置**。修 = 导出（`K_GAP`/`K_CARD_H` 只在显式设过时导，`K_HIDE_EMPTY` 总导）+ 导入三个 kinds 补齐。
4. 🔴 **回执行把菜单撑胖**：回执行不封顶时把菜单从 232 顶到 246。修 = `.cb-ctx-status { max-width: 200px }`（菜单里最宽的那行不能再是它）。
6. 🔴 **帮助开 pre-line 会把菜单撑胖**（这条是**新断言当场抓到的回归**）：`
   `white-space: pre-line` 之后，「最长的那一行」成了菜单 max-content 的新驱动者 ——
   实测不封顶时菜单从 232 被撑到 **278**，把老板认可的那个窄窗撑胖了。修 =
   `.cb-sec-help { max-width: 200px }`（与 `.cb-ctx-status` 同值，稳在既有最宽行 219.2 之下），
   并补一条几何断言「展开帮助后菜单内容宽仍 ≤233」+ 两条源码守卫（C5b/C5c）钉死。
   🔴 教训：**给浮层里的文本加换行 = 换了 max-content 的驱动者**（铁律 60 的新面孔）。

5. 🔴 **像素隔离页要真隔离**：面板 / 遮罩是 `.cb-root` 的**直接子元素**（而 `.cb-root` 在 `#board` 里），`px_panel` 模式写 `#board{display:none}` 会**连面板一起藏** → 那张页是空白（png 只剩 4.3KB，看着像"出图了"）。修 = 藏「看板那一摊」而不是整个容器（`.cb-root > *:not(.cb-panel):not(.cb-mask){display:none}`）；**出图后先看文件大小**。

**落地清单（`vendor/creation-board.js` 191,393 → 204,844 字符；构建 `main.js` 561,105 B / `styles.css` 69,810 B）**

- `vendor/creation-board.js`：`note()` / `flashNewCard()` / `panelSummary()` / `setAllCollapsed()` / `addCardHeightRow()` / `addPropsRow()` / `addCharsRow()` / `_sliderRow()` / `bulkRow()`；新键 `网格间距`(`K_GAP`) / `卡片默认高度`(`K_CARD_H`) / `隐藏空板块`(`K_HIDE_EMPTY`) —— 三者都进 `computeSig()`（铁律 56，否则拨了不生效）；`getViewOptions()` 只留 `K_BODY` 一条（其余全搬进面板）
- `styles_src/cb.css`：`--cb-gap` 变量化（`.cb-grid { gap: var(--cb-gap, 8px) }`）；`.cb-sec-help{white-space:pre-line}`；`.cb-ctx-status`（2px 强调色左竖条 + 浅底 + `max-width:200px`）；`.cb-card.cb-flash` + `@keyframes cb-flash-ring`；`.cb-panel-sub`；`.cb-bulk` / `.cb-mini`；`.cb-badge-ovr`
- 测试：`run_r27.js` **125**（新）；`run_r20b` 248 → **298**（补 R27 真 DOM 段 9 条）；老断言按铁律 49 按意图重写 r15 / r20 / r21 / r23 / r24 / r25 / r26（面板四段、原生只剩 `K_BODY`、`--cb-card-max` 改走 `applyRootVars`、`readBool` 成死代码摘除）

**验证**：`run_all.js 3` → **2226/轮 × 3 = 6678 全绿**；`run_r20b` **298**；R27 **真引擎几何 62 + 像素 68**（描边环 343×260 正好贴住卡片边界、只闪一张、环内空；回执竖条 2×22 在行最左；摘要条 518×29 且上下都是主题底；淡紫徽标底与灰徽标色距 13.4、字是强调色）；R22 几何 76 / R24 44+8 / R25 110+12 / R26 55+19 **全数复跑全绿**；沙盒 229 + 真库副本 247 + 独立套件 45 全绿。**真机验收 5 条**：①右键板块名 → 「显示帮助」展开后是否一条一行；②菜单里「新建文件」后新卡片是否描一圈边再淡出；③在菜单里改任意一项（如「内容展开」）窗是否**不关**且顶上一行回执；④「刷新」下面是否有「收起本板块」；⑤点顶栏齿轮看面板是否多了摘要条 / 「内容」组 / 网格间距 / 卡片默认高度 / 一键全收 / 「已自定义」徽标。

## 未发布 — R26（老板五条：等高留白 + 卡片高度 + 勾选框直点 + 滑块圆圈 + 手机长按 + 单击改名）

**老板要求**（2026-09-20，五条带截图）：

> 1. 笔记长度不够会导致同一排窗格上下参差不齐 → 统一窗格高度，不够就留白；右键菜单加「窗口显示高度」设置
> 2. 可勾选的框希望直接点就能勾，不必点进笔记
> 3. 滑块的圆圈图标歪了，修一下
> 4. 手机端长按任务栏自动呼出右键菜单，要确保手机端体验
> 5. 板块重命名改成微软重命名文件那种：悬停在名字上，左键按一下就开始改

| 老板原话 | 落地 |
| --- | --- |
| ① 等高 + 留白 | `.cb-grid` 加 `align-items: stretch`（本就是栅格默认，明确写出）+ `.cb-card { height: var(--cb-card-h, auto) }`。**默认（不设高度）= 同一行拉伸等高、短的留白**——老板要的主行为不设开关直接生效 |
| ① 卡片高度设置 | 右键菜单「通用设置」组新增板块级「**卡片高度**」：拉杆 120–480 / step 10 + px 回显 + **「跟随内容」打勾项**（勾上 = 等高留白；不勾 = 固定高，长文在卡片里滚）。新键 `卡片高度`（`K_SEC_H`）存在板块数组里，null = 跟随；只在有覆盖时写回，老配置一个字不动 |
| ② 勾选框直点 | `bindTaskToggles()`：把 MarkdownRenderer 渲出的 `.task-list-item-checkbox` 的 `disabled` 摘掉，第 n 个框 ↔ 全文第 n 个任务行，`change` 时 `vault.process` 原子翻面那一行。**框比任务行多就对不上号 → 宁可不绑也别勾错行**；readonly 不绑；点框 `stopPropagation`（别把就地编辑浮层带出来） |
| ③ 滑块圆圈歪 | 🔴 **根因（asar 取证）**：原生 `input[type=range]`（特异性 0,1,1）把裸 `.cb-wrange`（0,1,0）**整条压掉**——height 被压成 4px、thumb 吃原生 `height:18px + top: var(--slider-thumb-y)=-6px` 再叠我们的 `margin-top:-5px` → 双重偏移圆圈上天。harness 没喂原生 CSS 所以「harness 正、真机歪」（**铁律 50 第三次**）。修 = 全部升到 `input.cb-wrange`（打平 0,1,1，源码顺序在后）+ thumb 显式 `top:0` |
| ④ 手机长按 | `bindLongPress(el, onFire)`：touchstart 起 550ms 定时器、位移 ≤10px 才触发，`preventDefault` 掐掉系统长按；动了（滚动/拖动）立刻取消。**板块标题条 → 板块右键菜单；卡片 → 笔记操作菜单**（链接/输入框/按钮上不抢）。桌面端没有 touch，零感知 |
| ⑤ 单击改名 | 板块名从**双击**改**单击**触发 `beginRenameSection`（Windows 手感）；拖动排序走 `dragstart` 不产生 click，互不打架；`__cbRenaming` 防重入。**dblclick 保留**（老习惯不破） |

**阿盘补的几条（都写进 vendor 注释）**

1. 「统一高度」的正确默认就是**栅格的 stretch**：不该做成开关，短的留白本来就是老板要的；「卡片高度」是**覆盖项**，设了才固定。
2. 勾选框翻面走 `vault.process`（原子），老接口退 `read/modify`；都失败时把框视图翻回去，**视图不许骗人**。
3. 🔴 **像素层抓到 harness 自身的雷**：`#probe` 用 `left:-9999px` 藏——R26 的 JSON 宽度**超过 9999px**，元素右端**缩回视口里**把截图污染了（R24/R25 的 JSON 短才没炸）。**负 left 挡不住超宽内容**，改 `opacity:0 + 收窄 + overflow:hidden`（→ 铁律 63）。
4. 🔴 `getComputedStyle(el, "::-webkit-slider-thumb")` 在 Chrome 里返回的是**元素自身**样式（实测 width=100px = 原生 input 宽）——**伪元素读不到**，圆圈的几何只能**数像素**（`check_r26_shots.py`：value=120 → 轨道整条底色，强调色只可能来自圆圈，扫出来圈心 40.5 vs 杆心 40、直径 15）。
5. 主题变量不再依赖桌面那张效果图（被清掉就 FileNotFoundError）——抽成插件目录自包含的 `tmp/obsidian_theme_vars.css`。

**落地清单（`vendor/creation-board.js` 191,393 字符 → 构建 `main.js` 543,396 B / `styles.css` 65,116 B）**

- `vendor/creation-board.js`：`K_SEC_H`/`secHeight()`/`secHeightOf()`/normalize·toRaw·secHasOverride·resetSection 认 `secH`（同 `secW` 一套规矩）；`renderSection` 有覆盖才写 `--cb-card-h`；`hrowSec()`（跟 R25 `wrowSec` 同一个两行套路）；`bindLongPress()`/`bindTaskToggles()`/`toggleTaskLine()`；板块名 click→`beginRenameSection`；卡片长按→`openCardMenu`
- `styles_src/cb.css`：`--cb-card-h:auto` 默认；`.cb-grid` stretch；`.cb-card height: var(--cb-card-h, auto)`；`.cb-body min-height:0`；拉杆全组升 `input.cb-wrange` + thumb `top:0`；`.cb-body input.task-list-item-checkbox`（pointer / accent-color / middle）
- 测试：`run_r26.js` **85**（新）；老断言按铁律 49 重写（r3b 白名单收 `--cb-card-h`、r24/r25 改名/菜单组文案、r20b 补 R26 真 DOM 段 19 条）

**验证**：`run_all.js 3` → **2050/轮 × 3 = 6150 全绿**；`run_r20b` 227→**248**；真引擎几何 **55** + 像素 **19**（圆圈圈心 40.5 vs 杆心 40、直径 15；轨道 5px；短卡底部 46px 干净留白）；R24 几何 44 + 像素 8、R25 几何 110 + 像素 12（harness 修掉 `left:-9999px` 雷与桌面 MOCK 依赖后**全数复跑**）；沙盒 229 + 真库副本 247 + 独立套件 45 全绿。**真机验收 5 条**：同行卡片是否等高留白 → 「卡片高度」不勾「跟随内容」后是否只有这块固定高 → 卡片里勾任务是否直接生效且不弹编辑器 → 拉杆圆圈是否回正 → 手机长按是否呼出菜单（桌面查：单击板块名直接改名）。

## 未发布 — R25（老板一条：「右键菜单里新增新建文件；删除板块；新建板块；新增对单个板块内文件宽度的设置」）

**老板要求**（2026-09-19，紧接着 R24 的验收反馈）：

> 之前的排版样式非常好！右键菜单里新增新建文件；删除板块；新建板块；新增对单个板块内文件宽度的设置

「排版样式非常好」= **R24 那套就地小窗的观感一动不许动**（232px 窄窗、五组分组、组头写作用域）。
所以这轮是「在**不撑宽、不重排**的前提下往里塞 4 件事」。

| 老板原话 | 落地 |
| --- | --- |
| 新建文件 | 新增「**本板块**」组第一项。**复用看板右上角那个 `+` 的老逻辑** `createInSection(sec, "", sec.__gridEl)`，一行没重写 —— 落点与模板/`templaterFolderRule` 让路规则完全一致。`readonly()` 时置灰 |
| 删除板块 | 「本板块」组第二项，**两段式确认**：第一下只变文案「再点一次确认删除」+ 红底加粗（`.is-armed`），第二下才真删。删的逻辑从顶栏面板的 `askDelete()` 里**提取**成 `deleteSection(i)`（一次 `splice`），**面板与菜单共用同一条路** |
| 新建板块 | 新增「**新建板块**」组（组头写「整个看板」）：4 个数据源按钮（文件夹 / 标签 / 公式 / 收容所）**一行排开**，点完直接**打开顶栏面板并定位到新板块那行**继续填配置（不然新板块是个空壳） |
| 单个板块内文件宽度 | 「通用设置」组第一行：拉杆 160–480 / step 10 + px 回显 + **「跟随看板」打勾项**。新键 `文件宽度`（`K_SEC_W`）存在**板块数组里**，null = 继承视图级 `卡片最小宽度`；`sectionToRaw` 只在有覆盖时写回（老配置一个字不动） |

**阿盘补的几条意见（都写进 vendor 注释了）**

1. **板块级宽度是新能力，但键的位置必须跟 `body/yaml/links/propsOpen` 一致**：都放在 `secs[i]` 里、都用 `null` 表示继承、`secHasOverride/resetSection` 一起认。这样「重置设置」不用改就知道要清它。
2. **`computeSig` 不用动**：`secW` 在 `CONFIG_KEY`（整个板块数组）里，而 sig 已经 `JSON.stringify` 了整串 —— 但**渲染时只在有覆盖时才写 CSS 变量**（`secWidthOf(sec) !== null` 才 `setProperty("--cb-card-w", …)`），没覆盖的板块**一个字都不写**，真继承（几何层实测：块1 写 420px、块2 空、栅格解析 420/360）。
3. **🔴 窄窗里塞不下「标签 + 拉杆 + px + 开关」一整行**：真引擎一量就把 232px 的窗撑到 268px（原生 range 的 intrinsic 宽 129px）。**拆成两行** —— 拉杆行（标签/拉杆/px）+ 独立的「跟随看板」打勾项；再给拉杆 `max-width: 92px` 封顶（= 232 - 菜单 padding10 - 边框2 - 行 padding20 - 两个 gap12 - 标签52 - px 回显43.2），让这一行的 max-content 停在 219.2 < 220，**窗回到 232**。
4. **删除是 destructive**：两段式确认，且第一下**不关窗**（走 `itemStay()` 那条路，否则刚变色就被摘掉 —— 铁律 58）。
5. **组头的作用范围继续写清楚**：「本板块」组写 `只对「<板块名>」`，「新建板块」组写 `整个看板`。跟 R24 的规矩一致，不让人以为「新建文件」是给整个看板建的。

**落地清单（`vendor/creation-board.js` 183,160 字符 → 构建 `main.js` 533,308 B / `styles.css` 62,829 B）**

- `K_SEC_W = "文件宽度"`（板块级）+ `secWidth(v)`（0/负数/NaN 一律当**没设**，不夹到 160）+ `secWidthOf(sec)`。
- `normalizeSection` 读 `secW`、`sectionToRaw` 只在非 null 时写、`secHasOverride`/`resetSection` 一起认。
- `renderSection` 里 `sec.__wrapEl` / `sec.__gridEl` 存下来 → 有覆盖时给**板块容器**写 `--cb-card-w`（`K_FILL` 关时连 `--cb-card-max` 一起写）。
- `addSection(type)` 返回 `idx`（原来返回 void）→ 「新建板块」按钮能立刻 `editIdx = idx` 打开面板。
- `askDelete(i)` 与菜单共用 `deleteSection(i)`。
- `openSecMenu`：`item()` 支持 `tip`；`wrowSec()` 画宽度行（两行版）；「本板块」/「新建板块」两组；删除两段式。

**验证（`tests/run_r25.js` 122 条 + 真引擎几何 110 条 + 像素 12 条）**

- 全套 `run_all.js 3` → **1944/轮 × 3 = 5832 全绿**（新增 `run_r25` 122 条）；`run_r20b.js` 真 DOM 冒烟 **167 → 227**。
- 🔴 **真引擎几何**（`tmp/dump_r25_menu.js` → `render_r25.py`）：菜单 **232px**（最宽子行 max-content 219.2 ≤ 220）、拉杆行三项同一行、**「跟随看板」排在拉杆行下面**、4 个数据源按钮同一行、删除项红底 `rgba(214,64,64,0.24)`、矮窗靠 `max-height + overflow-y:auto` 兜住且按真视口重算 clamp 后完全在屏内、块1/块2 的宽度**真隔离**（420 vs 继承 360）。
- 🔴 **像素统计**（`tmp/check_r25_shots.py`）：轨道填充 **77.2%**（420 → 理论 81.3%，thumb 占几列）、尾部 8 列 0 命中、删除项 r-g = 54.1（普通项 -0.3）、未打勾的框里 0 个非背景像素。
- R24 几何层**回灌**了「按真视口重算 clamp」这招后，拿**当前 DOM** 重跑仍 **44/0**；R24 像素 8/0、R22 几何 76/0、R22 截图 OK、沙盒 229/0、真库副本 247/0、独立套件 45/0。

## 未发布 — R24（老板一条：「单个板块的设置应只对单独板块生效」）

**老板要求**（2026-09-19，1 张真机截图 + 一段结构化描述）：

> 单个板块的设置应只对单独板块生效！…修改每个板块的设置 点击板块名字可以设置名字
> 1. 鼠标双击板块名可以设置板块名
> 2. 拖动板块可以直接对各个板块排序
> 3. 去掉单独板块的设置键，右键小板块在鼠标处弹出设置小窗，类似 windows 右键菜单，可以进行一些简单的设置功能
> 刷新 / 1.通用设置：属性展开、内容展开、重置设置、显示帮助 / 2.笔记内容：显示 YAML、显示双链 / 3.文件操作：拖动搬文件、文件隐藏显示、查看隐藏的文件
> 不同板块间画一条简单的线

**这轮是在「修一个语义错误」**：R20 起板块标题旁挂了个 ⚙，点它打开的其实是**整个看板的设置面板**（只是顺手定位到那一行编辑区）——
老板要的是「**只对这块生效**」。所以整轮的动作是「把板块级设置从全局面板里**摘出来**，放到右键就地小窗」。

| 老板原话 | 落地 |
| --- | --- |
| 双击板块名可以设置板块名 | `.cb-section-name` 独立成元素 + `dblclick` → **就地换输入框**（Enter 提交 / Esc 放弃 / 失焦也算提交）。原来只能去顶栏面板的编辑行里改 |
| 拖动板块排序 | **R12 就有的能力，原样保留**（拖动排序走 `handleManualMove` 那条老路，本轮一个字没动） |
| 去掉单独板块的设置键 | 板块标题旁那块 ⚙ **连 CSS 一起删**（`.cb-sec-gear` 规则也不留）。顶栏那个齿轮是**整个看板**的入口，保留 |
| 右键小板块 → 鼠标处弹设置小窗 | `head.contextmenu` → `openSecMenu(sec, clientX, clientY)`：复用卡片右键菜单那套 `.cb-ctxmenu`（跟手定位 + clamp 在视口内 + 点外面 / Esc 收起） |
| 通用设置：属性展开 / 内容展开 / 重置设置 / 显示帮助 | 4 项全有。**「属性展开」从视图级升成板块级三态**（`propsOpen`：继承 / 开 / 关）—— 这就是老板要的「只对这块生效」 |
| 笔记内容：显示 YAML / 显示双链 | 板块级三态（R12 就有，本轮搬到菜单里，键与语义不变） |
| 文件操作：拖动搬文件 / 文件隐藏显示 / 查看隐藏的文件 | 3 项全有。**🔴 这一组是「整个看板」共用的**（不是按板块设的）→ 用**打勾项**、组头明写「整个看板」，免得让人以为能按板块设 |
| 不同板块间画一条简单的线 | `.cb-section + .cb-section { border-top: 1px solid var(--background-modifier-border); padding-top: 14px }` |

**阿盘补的几条意见（都写进 vendor 注释了）**

1. **作用域要一眼看出来**：三态行只用于「只对这块生效」的项；视图级项一律打勾项 + 组头写「整个看板」。两组组头分别写 `只对「<板块名>」` / `整个看板`。
2. **「重置设置」只清这个板块的覆盖**（`body/yaml/links/propsOpen/属性清单/排序` → 全回 null），**绝不碰视图级键**；没有覆盖时置灰并改文案为「重置设置（已是默认）」。
3. **列表项与「能按板块设」的项分开**：「拖动搬文件」跟着「文件隐藏显示 / 查看隐藏的文件」一起归到「文件操作（整个看板）」组 —— 它本来就是视图级键（`K_MOVE`）。
4. **「属性展开」同时补进顶栏面板的板块编辑行**（`mkTri("属性展开", "cb-seg-propsopen", "propsOpen", …)`）—— 同一件事两个台面能力不一致，老板一定会撞上「这边怎么没有」。
5. **新增能力：把某篇笔记从看板上「收起来」**（卡片右键 → 隐藏这篇）。这是「文件隐藏显示」开关的落点，没有它那两个开关就是空的：默认关着「查看隐藏的文件」→ 被收起的卡片**完全不渲染**（不是 `display:none`），板块头显示「已隐藏 N」；打开后卡片带 `.is-cb-hidden`（虚线 + 淡出）回来，再右键「取消隐藏」。
6. **分隔线用相邻兄弟选择器**（`.cb-section + .cb-section`）—— 子板块（`.cb-sub`）在板块体内、不是兄弟，天然不受影响（真引擎量到 `.cb-sub` 上边框 = 0px）。

**落地清单（`vendor/creation-board.js` 174,849 B）**

- 新键：`K_HIDDEN_ON`("文件隐藏显示", 默认 true) / `K_HIDDEN_SHOW`("查看隐藏的文件", 默认 false) / `K_HIDDEN`("隐藏的文件", 数组，路径)。
- `KNOWN_KEYS` 收进 `"属性展开"`；`normalizeSection` 加 `propsOpen: tri(o,"属性展开","propsOpen")`；`sectionToRaw` 只在 `true/false` 时写键（null = 不写 = 回继承，与 `body/yaml/links` 同规格）；`addSection` 初始化 `propsOpen: null`。
- `propsOpenOn(sec)`：**板块级优先 → 回落视图默认**。卡片属性区（`const dfltOpen = this.propsOpenOn(sec)`）与就地编辑浮层（`this.propsOpenOn(card ? card.__cbSec : null)`）都改走它。
- 新方法（各恰 1 次）：`secConfigurable` / `secIndexOf`（catchall 走 `source` 匹配）/ `secHasOverride` / `resetSection` / `refreshBoard` / `hiddenOn` / `showHidden` / `hiddenPaths` / `isHidden` / `toggleHidden` / `closeSecMenu` / `openSecMenu` / `beginRenameSection` / `renameSection`。
- 🔴 **`computeSig()` 补 3 个键**：`K_HIDDEN_ON` / `K_HIDDEN_SHOW` / `K_HIDDEN` —— 不补就是「拨了不生效但全绿」（铁律 56）。板块级三态走的是整份 `CONFIG_KEY`("板块")，那一条本来就在 sig 里。
- 🔴 **改名要迁「折叠」状态**：`foldKey` 就是**板块名**，`renameSection()` 把 `K_FOLD` 里的 `旧名` 与 `旧名/子板块名` 前缀一起搬到新名；手动顺序的键是「数据源:路径」，与名字无关，**不动**。
- 配置搬运：`exportConfig` 带 3 个新键，`kinds` 表 `bool/bool/raw`。

**这轮踩到的三件事（都已修）**

1. **点「显示帮助」会把小窗关掉** —— 菜单项统一走 `run(fn)`（先 `closeSecMenu()` 再执行）→ 说明块刚展开就跟着窗一起被摘掉。修法 = 新增 `itemStay()`（同款外观、**不关窗**），「显示帮助」走它。真 DOM 冒烟抓到的。
2. **兜底估算值偏小** —— 跟手定位要 `menu.getBoundingClientRect()`，真浏览器里 append 后同步可读（用真 rect）；万一量到 0 会退到 250×380 的经验值。真引擎**实测窗高 390.6 > 380** → 兜底抬到 **250×420**。
3. **我一开始把收容所当成「不能单独设置」**（测试里断言它不可改名、没有三态行）—— 错。收容所是 `secs` 里**配置给的板块**（老板用「＋添加」加的），`secIndexOf` 对它有专门的 `source === "catchall"` 分支，本来就该能改名 / 能单设。断言按事实重写成「收容所也走同一套」，并顺手加了一条**真正的隔离验证**：右键改收容所的「内容展开」→ 只写进收容所那一份，第一个板块 `body` 仍为 null。

**验证（六道）**

1. **`tests/run_r24.js` 147 条**：A 撤 ⚙（且 R12 拖动排序没被带塌）7 · B 双击改名（含 `K_FOLD` 迁移、不碰手动顺序）20 · C 右键小窗结构 33 · D 板块级三态真接线 12 · **E 铁律 56（3 个新键进 sig）8** · F 刷新/重置/隐藏逻辑 28 · G 分隔线与新样式零裸色 16 · H 配置搬运 + main.js 同源 7 · I 复写病自检 8 · J 出处 3。
2. **真 DOM 冒烟 `tests/run_r20b.js` 104 → 167 条**（R24 段 63 条）：真右键板块 → 数三组标题 / 4 个三态行 × 3 按钮 / 3 个打勾项 → **真点「内容展开·关」**（核只改这一块 + 写完自动收窗）→ **真点「属性展开·关」核卡片属性区当场折叠** → 「重置设置」可点/置灰两态 → 「显示帮助」就地展开且带板块名 → 「刷新」不抛异常 → **真双击改名（Enter 提交 + Esc 放弃 + 折叠态迁移）** → 隐藏 / 取消隐藏一张卡的全过程 → 收容所**板块级隔离**（改它不连坐第一个板块）。
3. **真引擎几何层（本轮新增）`tmp/render_r24.py` 44 条**：真 DOM + 真 cb.css + 本机 Chrome `--dump-dom` 量 —— 分隔线（第 1 块上边框 0px / 第 2 块 1px solid / 上下留白 16 vs 14 对称 / `.cb-sub` 不被命中）、改名输入框（真 201×22、1px 强调色边框、挂在 `.cb-section-name` 下）、右键小窗（`position:fixed`、真宽 232、inline left/top 就是最终落点、常规点完全在视口内）、**clamp**（贴右下角请求 1040,vh-20 → 被推回 802,132 且仍在视口内）、窗内 3 组标题 / 4 三态行 / 3 打勾项的**真渲染数量**。
4. **截图像素统计 `tmp/check_r24_shots.py` 8 条**（本模型读不了 PNG，用数字替「人眼看」）：浅色分隔线对比度 **26.0**、深色 **22.0**（都在 sec2 上边缘 ±3px 内）；改名输入框框内命中强调色 **426 / 422 px**（浅/深）；右键小窗那一块与旁边看板的亮度差 **4.6 / 14.0**。
5. **R22 真引擎几何层重跑 76 / 0**（面板本体没动，当回归）。
6. **连带按意图重写老断言（铁律 49）**：`run_r9` I（浮层改走 `propsOpenOn`）、`run_r12` C2（`KNOWN_KEYS` 多一项）、`run_r20` C7→C7/C7b（板块齿轮撤了）、`run_r20` F4（编辑行三态 3 → 4）、`run_r20` G4（`gearIcon` 调用 3 → 2）、`run_r23` D3 + D6→D6/D6b/D6c（`"属性展开"` 这个字面量现在**合法存在**了 —— 它是板块级三态键，与视图级 `"属性默认展开"` 是两个键两层）、`run_r3b` R12。

**全套**：**1762 断言 / 失败 0 × 3 轮 = 5286**（R23 基线 1549 → +213 = `run_r24` 147 + `run_r20b` 63 + `run_r20` 1 + `run_r23` 2）；
沙盒真文件演练 **229 / 0**、真库副本 **247 / 0**、bases-preview 独立套件 **45 / 0**、`run_r3b` 零裸色 **19 / 0**；
复写病自检：20 个 src 文件各恰 1 个 `KB.define`、10 个新方法各恰 1 次调用点；
构建 BUILD-OK（main.js **522,317** B / styles.css **60,218** B）；实验库 SYNC-OK bad=0。

**R24 存档**：`.workbuddy/backup/kb-toolkit-R24-2026-09-19/`（**87 文件 / verify_bad=0**，`_manifest.json` 记 sha256；
`vendor/creation-board.js` = `f357a7be…`、`styles_src/cb.css` = `faf5240c…`）。

## 未发布 — R23（老板一条：「加一个开关控制笔记的属性是否默认展开」）

**老板要求**（2026-09-19，1 张真机截图 —— 截图里面板已经是 R22 那个居中悬浮小窗）：

> 「加一个开关控制笔记的属性是否默认展开」

**这活儿不用新造能力**：键 `属性默认展开`（`K_PROS_OPEN`）R9 就有，`propsOpenDefault()` 也一直在（默认 true）。
真正的问题是它**只出现在 Bases 原生视图选项面板**里 —— 那条路要点「视图标题 → 找选项」，老板找不到。

| 改前 | 改后 |
| --- | --- |
| 只能去 Bases 原生视图选项面板里改（视图标题那个入口），面板里看不见 | ⚙ 面板「看板行为」组多一个开关，**紧跟「显正文」**（一个管正文区、一个管属性区；v2 效果图里「属性展开」与「内容展开」本来就是一对） |

**落地**

- `vendor/creation-board.js`
  - `renderPanel()`：`this.addToggle(behBox, K_PROS_OPEN, true, "属性默认展开", …)` —— 排在「显正文」之后、「只读」之前；走统一的 `addToggle`（原生胶囊 `.cb-opt`），说明文字进 `title`，面板正文不铺小字。
  - `getViewOptions()`：摘掉那条 descriptor（4 → **3** 项）。**键与语义一个没变** —— 老 `.base` 里写过 `属性默认展开` 的照认。
  - 🔴 **`computeSig()` 补上 `String(this.optBool(K_PROS_OPEN, true))`** —— 本轮真正的坑。控件从原生面板搬进自绘面板后触发路径变了，而 `onDataUpdated()` 里 `sig === this.sig` 会**短路**；不补进 sig 就是「拨了不生效但全绿」。
  - 三条注释同步改口径（键注释 / `propsOpenDefault()` / 卡片属性区那段），不再说「视图选项」。

**验证（四道）**

1. **`tests/run_r23.js` 33 条**：A 落点与顺序 8 · B 原生面板摘干净 6 · C **sig 认它** 5 · D 键与语义没变 7 · E 注释交代去向 3 · F 样式复用 4。
2. **真 DOM 冒烟 `tests/run_r20b.js` 86 → 104 条**（R23 段 18 条）：真找 `.cb-opt[data-key="属性默认展开"]` → 默认开 → **真关掉** → 核「写回 config」+「`propsOpenDefault()` 变 false」+「**卡片属性区当场带上 `.cb-pros-fold`、旁标变「属性 ▸」**」→ 再拨回来。这一刀是唯一能抓「sig 漏认」的。
3. **真引擎几何层**（R22 那层）重跑 **76 / 0** 当回归：窗 520×436.8 居中（误差 0）、z 序 41>40、矮视口顶到上限并逼出正文滚动。窗高从 R22 的 414.8 涨到 436.8 = **正好多一行**（约 22px），反证新开关确实渲染进了窗里。
4. **连带按意图重写老断言（铁律 49）**：`run_r9` I 段（原断「原生面板里出现它」→ 改断「原生面板里没有了、⚙ 面板里出现了」）、`run_r20` D2 拆分 + D2c、`run_r21` D5 + D5b、`run_r20b`「看板行为」**4 → 5 个开关**。

**全套**：**1549 断言 / 失败 0 × 3 轮 = 4647**（R22 基线 1499 → +50 = `run_r23` 33 + `run_r20b` 18 − 1（r9 三条并两条））；沙盒 **229 / 0**、真库副本 **247 / 0**、bases-preview 独立套件 **45 / 0**、`run_r3b` 零裸色 **19 / 0**；构建 BUILD-OK（main.js **504,918** B / styles.css 57,841 B）；实验库 SYNC-OK bad=0。

**R23 备份**：`.workbuddy/backup/kb-toolkit-R23-2026-09-19/`（85 文件 / verify_bad=0，`_manifest.json` 记 sha256；`vendor/creation-board.js` = `42e04d2e…`、`styles_src/cb.css` = `3705c742…`）。

## 未发布 — R22（老板一条：「板块设置」面板改成**悬浮窗**）

**老板要求**（2026-09-19，1 张截图 + 指定参考 `桌面/看板设置界面设计v2-效果图.html`）：

> 「继续弄完，弄成悬浮窗，参考 html」

| 改前 | 改后 |
| --- | --- |
| 面板 `display:flex` 挤在**工具条与看板之间**，占整行、把看板往下推；板块多了整页变长 | 面板 = **居中悬浮小窗**：遮罩铺满可视区 + 窗 `position:fixed` 浮在看板上 + 窗头（标题 / 状态字 / ✕）+ 正文自己滚、窗高封顶。**看板位置一点没动**（开/关面板量到的 `.cb-list` top 完全一致） |

**落地（照效果图的 `.mask` / `.win` 那套）**

- `.cb-mask`：`position:fixed; inset:0; z-index:40; background:var(--background-modifier-cover)` —— 遮罩**就是**「窗外」，所以第 5 轮那套「点外面就收起」原样复用，没有第二份逻辑。
- `.cb-panel`：`fixed; z-index:41; left/top:50%; translate(-50%,-50%)`，宽 `min(520px,94vw)`、高 `min(84vh,720px)`、`overflow:hidden`、`--radius-l`、`--background-primary`、`--shadow-s`。
- `.cb-panel-head`：`flex:0 0 auto` + `align-items:center`（**原来 baseline** —— ✕ 是按钮，按 baseline 会飘）+ `border-bottom` + `--size-4-*` 内边距；状态字 `margin-left:auto` 把 ✕ 顶到最右。
- `.cb-panel-x`：素色 ✕（无边框 / 透明底 / hover 有反馈），`title="关闭"`。
- `.cb-panel-body`：`flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain` + `--size-4-3` 内边距。
- **收起路径收敛成一条** `closePanel()`：✕ / 点遮罩 / 点窗外 / 再点一下 ⚙ —— 四处都走它（原来那段复位逻辑写在 closer 里，与齿轮各一份）。

**验证（三道，都要真东西）**

1. **源码级 `tests/run_r22.js` 48 条**（A 结构 7 · B 收起路径 12 · C 样式 29）：遮罩/窗/✕ 的 DOM 与顺序、`closePanel` 只定义一次（复写病自检）、四条收起路径都指向它、CSS 每条关键属性、R22 段零裸色。
2. **真 DOM 冒烟 `tests/run_r20b.js` 74 → 86 条**（新增 12 条）：真起视图 → 真点齿轮 → 真点 ✕ → 再开 → **在遮罩上真发 `mousedown`** → 核「窗与遮罩同开同关」。
3. **真引擎几何取证（本轮新加的一层）**：`tmp/dump_r22_panel.js` 把**出货代码**在 jsdom 里真起出来的面板 DOM 原样 dump，`tmp/render_r22.py` 用**本机 Chrome** 加载「真 DOM + 真 `styles_src/cb.css` + 真 Obsidian 变量」，再用 `--dump-dom` 把 `getBoundingClientRect` / `getComputedStyle` 读回来，`tmp/check_r22_geo.py` **76 条**逐项核对三个用例（浅色 1058×522 / 深色同尺寸 / 矮视口 878×242）。关键读数：

   | 项 | 实到 |
   | --- | --- |
   | 窗水平/垂直居中误差 | **0.0 px / 0.0 px** |
   | 遮罩 | (0,0) 起，尺寸 == 视口，`rgba(0,0,0,0.42)` |
   | z 序 | 窗 41 > 遮罩 40 |
   | 窗宽 | 522 px（= min(520,94vw) + 两侧 1px 描边） |
   | 窗高 | 414.8（上限 438.5 = 84vh）；矮视口用例顶到上限 205.3 → **正文 scrollHeight(377) > clientHeight(377→封顶后超出)** |
   | 窗头子元素序 | `cb-panel-title, cb-panel-msg, cb-panel-x`（✕ 在最右，与窗头中线差 ≤1.5px） |
   | 面板开/关时 `.cb-list` top | **完全一致** → 证明面板不再占一行 |

   ⚠️ 两个 harness 保真度坑（记下来，别再踩）：漏 `*{box-sizing:border-box}` 会让 `max-height` 量出「内容盒 + 2px 边框」（以为超限）；「浮在看板上」要量**开关面板前后列表位置是否一致**，不能量「列表 top < 窗头 top」（矮视口下窗头跑到列表上面去了）。

顺手出了三张离屏截图（浅色 / 深色 / 矮视口）供肉眼复核，像素亮度对得上：浅色窗内 249–253 vs 窗外遮罩 148；深色 32–36 vs 11。

**全套**：**1499 断言 / 失败 0 × 3 轮 = 4497**（R21 基线 1439 → +60 = r22 48 + r20b 12）；沙盒 **229 / 0**、真库副本 **247 / 0**、bases-preview 独立套件 **45 / 0**、`run_r3b` 零裸色 **19 / 0**；构建 BUILD-OK（main.js 504,085 B / styles.css 57,841 B）；实验库 SYNC-OK bad=0。

**R22 备份**：`.workbuddy/backup/kb-toolkit-R22-2026-09-19/`（84 文件 / verify_bad=0，`_manifest.json` 记 sha256；`vendor/creation-board.js` = `d955a194…`、`styles_src/cb.css` = `91137215…`）。

## 未发布 — R21（老板一条：「空位铺满整行」并入「卡片最小宽度」那一行，缩成「自动」+ 开关）

**老板要求**（2026-09-19，2 张截图）：

| # | 老板原话 | 落地 |
| --- | --- | --- |
| ① | 「这个［空位铺满整行］移到［卡片最小宽度］同一行后面，缩成"自动"+按钮。开始修改插件」 | 两个控件**并成一行**：「文件宽度 `[拉杆]` 240 px　自动 `[开关]`」。整行搬进**看板顶栏齿轮面板**新开的「卡片」组（自绘 DOM）。键与语义**一个没改**（`卡片最小宽度` / `空位铺满整行`） |

**为什么必须换台面**：这两项原来在 **Bases 原生视图选项面板**（点看板标题进的）里，各占一行。`static getViewOptions()` 返回的是**扁平描述项数组**，Bases 拿它逐条渲染成「标签 + 控件」一行 —— 一条 descriptor 只能占一行，**没法把滑杆和开关合进同一行**（已核实核心 cards/list/table 的写法）。顶栏齿轮面板是自绘 DOM，不存在这个限制。两个入口读写的是**同一份 `.base` 视图块**（`config.get/set`），所以只是换了台面，老配置照旧被读到。

**这一行长什么样**：`文件宽度`（行首标签）+ `160 – 480 px` 拉杆（step 10）+ `240 px` 数值回显 + `自动` + 原生胶囊开关。
- 「自动」= 原「空位铺满整行」，默认**开**（＝R14 铺满整行行为）；**开时拉杆置灰**（数值回显一起变淡）—— 不做假控件。
- 拉杆拖动中只直写 CSS 变量（`--cb-card-w`，同 r15 编辑器保护思路，不动 DOM 树），**松手**才 `cfgSet(卡片最小宽度, n)` + 重绘；落盘前夹到 160–480 并对齐 10 的整数倍。
- 自动**关着**时拖动**同时**写 `--cb-card-max` —— 否则 `minmax(w, max)` 的 max 还是旧值，表现为「只能缩小、不能放大」。
- 点胶囊、点「自动」两个字都能切（与 R20 看板行为那排同款交互）。

**原生视图选项面板**：`getViewOptions()` 从 6 项减到 **4 项**（显示属性 / 显正文 / 正文字数上限 / 属性默认展开）；两项移走但**键没删**，`view[K_*]` 导出与配置搬运照旧带全部键。

**踩到的真 bug（被真 DOM 冒烟抓住，源码正则全绿）**：模块级的 `num(v, dflt)` 只在 `typeof v === "number"` 时返回 v，而 `input[type=range].value` **永远是字符串** → 直接喂 `num(rg.value, 240)` 恒回 240，于是**拖动预览、轨道填充百分比、松手落盘全被钉死在 240**。修法 = 在 `addWidthRow` 内加 `wnum(s)`（照本文件 `optNum` 的写法：`parseFloat` + `isFinite` 兜底），三处调用全换掉，并在 `run_r21.js` C11 钉一条回归断言。

**验证**：新增 `tests/run_r21.js` **57 条**（A 落点 5 · B 行组成 10 · C 交互 11 · D 键语义不变 15 · E CSS 零裸色与 `--cb-wpct` 声明 10 · F 设置页文案 6）；`tests/run_r20b.js` 看板真 DOM 冒烟 **59 → 74 条**（R21 段 15 条：真起视图 → 抓 `.cb-wrow` → 验拉杆与开关**确在同一行**、置灰、数值回显 → 真点开关验 config 写回 `空位铺满整行=false` → 真推拉杆验写回 `卡片最小宽度=360` → 面板不崩）。连带按意图重写 r15（A2/A3 —— 描述项已挪走，改验新落点）、r18（⑤-5 文案「卡片宽度」→「文件宽度」+ 顶栏齿轮）、r20（D2 拆出 D2b 验两项已移出原生面板 · E2 段数 2→3 · E3 补「卡片」组）。全套 **1439 断言 / 失败 0 × 3 轮 = 4317**（R20 基线 1367 → +72 = r21 57 + r20b 15）；沙盒 **229 / 0**、真库副本 **247 / 0**、bases-preview 独立套件 **45 / 0**、`run_r3b` 零裸色 **19 / 0**（新加的 `--cb-wpct` 已在 CSS 里声明 → 过变量白名单）、看板 DOM 冒烟 **74 / 0**；构建 BUILD-OK（main.js 502,903 B / styles.css 56,521 B）；复写病自检 —— `addWidthRow` 全域恰好 2 处（1 定义 + 1 调用）；实验库 SYNC-OK bad=0。

**R21 备份**：`.workbuddy/backup/kb-toolkit-R21-2026-09-19/`（82 文件 / 1.67 MB，`_manifest.json` 记 sha256；`vendor/creation-board.js` = `b4b8a202…`）。

## 未发布 — R20（老板四条：状态只留是否启用 + 帮助入口挪顶栏 + 自绘齿轮 + 看板设置界面重做）

**老板要求**（2026-09-19，9 张截图，四组）：

| # | 老板原话 | 落地 |
| --- | --- | --- |
| ① | 「当前状态的小字部分通通去掉，只留下是否启用的信息」 | `statusLine(box, tip)`：删掉 `.kbt-status-sub` 副行与 `.kbt-status-main` 的「当前状态 ·」前缀，主行只报 **已启用 / 未启用**，前面加一颗状态圆点 `.kbt-led`（开 = `--color-green`，关 = `--text-faint`）。**细节一条没丢** —— 仍在原来的状态悬浮窗里（整栏可点 / ⓘ 可点，两个入口照旧） |
| ② | 「每页这个直接去掉，在顶部日志，关于右边加个帮助按钮」 | 页底那栏「帮助」**整栏撤掉**（`helpRow()` → `helpPop()`，只留小窗本体；kbt.css 里 `.kbt-help-row` 规则一并删干净，不留死代码）。顶栏 `.kbt-ghost-btns` 变成 **日志 → 关于 → 帮助** 三个按钮；点「帮助」按**当前标签页**拼键（`tab._tab + ":help"`），所以切页后点它开的是那一页的窗 |
| ③ | 「创作看板的板块设置图标自己绘制一个极简黑色图标」 | 两处齿轮原来都是 emoji「⚙」（颜色/字形/大小全由系统字体决定，截图里是淡紫、跟界面不搭）。新增模块级 `gearIcon(parent)`：`createElementNS` 画 14px 线描齿轮（`circle r=4.1` + 8 齿 `path`），`stroke="currentColor"` → **跟按钮文字色走**（浅色主题下就是极简黑）。顶栏按钮 = 图标 + 「板块」文字；每个板块标题旁同一个函数 |
| ④ | 「重新设计大幅简化创作看板设置界面，改成开关样式」+ 三个入口分工：「最顶部通过点击创作看板进入的设置用于快速调节，仅保留必要模块；顶栏设置按钮用于设置整个创作看板；板块边上的设置按钮用于对单个板块进行操作」+「操作界面清晰简洁，板块划分合理，无冗余文字说明」 | 见下 |

**④ 三个入口的职责划分（本轮把「谁管什么」钉死）**

| 入口 | 谁打开 | 管什么 | 本轮改动 |
| --- | --- | --- | --- |
| **视图标题** | 点看板标题（Bases 原生视图选项面板） | 快速调节 —— **只看显示外观** | `getViewOptions()` 从 11 项砍到 **6 项**：卡片最小宽度 / 空位铺满整行 / 显示属性 / 显正文 / 正文字数上限 / 属性默认展开。**移走**（只读 / 允许重复 / 显示收容所 / 排除目录 / 总条数上限）—— 键与语义一个不改，仍在顶栏面板里读写，老 `.base` 配置不失效 |
| **顶栏齿轮** | 点工具条上的「⚙ 板块」 | **整个创作看板** | `renderPanel()` 重做成**三段式**：`看板行为`（允许重复 / 显示收容所 / 显正文 / 只读）→ `板块`（板块行 + ＋添加）→ `高级`（显示 YAML 前言 / 显示结尾双链 / 拖动搬文件 + 配置搬运）。开关走 **Obsidian 原生胶囊** `.checkbox-container`（不再是默认勾选框）；**所有括号解释从标签里删掉，改挂 `title` 悬浮提示**；新增 `addGroup(label)` 建段落 |
| **板块标题旁齿轮** | 点某个板块标题旁的齿轮 | **只操作这一个板块** | `renderEditRow()` 里三态（显正文 / 显示 YAML / 显示结尾双链）从**下拉换成并排小按钮组** `.cb-seg`（继承 / 开 / 关，当前态高亮 —— 一眼看清是哪个状态）。键与语义不变（`null` = 继承视图默认）；标签去冗长（「目录（点选）」→「目录」，「属性（逗号分隔；留空 = …）」→「属性」+ title）；仍分「基础 / 显示」两段 |

**为什么不担心「移走的选项没了」**：顶栏面板（`renderPanel`）与视图标题面板（`getViewOptions`）读写的是**同一份 `.base` 视图块**（`config.get/set`），所以只是把入口挪了个地方，配置格式、键名、默认值全都没动；`view[K_*]` 的导出/搬运也照旧带全部键。

**验证**：新增 `tests/run_r20.js` **73 条**（① 状态 9 · ② 帮助 12 · ③ 齿轮 8 · ④-① 视图配置 11 · ④-② 面板 13 · ④-③ 编辑行 11 · 三入口分工 4 · 另含样式底线）；**另新增 `tests/run_r20b.js`「看板真 DOM 冒烟」59 条** —— 源码级正则抓不到「改完当场抛异常」，这里用 jsdom 把内嵌看板真造出来（`KB.modules.CreationBoardPlugin` → 取 `registerBasesView` 的 `factory` → 喂 Bases 形状的条目），真渲染面板 / 真点开关 / 真开编辑行 / 真点三态按钮 / 真点板块齿轮，逐项核 DOM。连带按意图重写 r13（C2/D9/F2b/G1）、r14（A4/A5/B3）、r16（A3~A5/D5/E 组/F6）、r18（④-1 栏目 12→9 + ⑥ 组 + ⑦-9）、r19（③-1 新签名）。全套 **1367 断言 / 失败 0 × 3 轮 = 4101**；真文件沙盒 **229 / 0**、真库副本 **247 / 0**、bases-preview 独立套件 **45 / 0**、看板 DOM 冒烟 **59 / 0**、「零裸色」审计过（`run_r3b`：新加的 `.cb-grp* / .cb-opt .checkbox-container / .cb-seg*` 全部走白名单变量，裸色仍为 0）；构建 BUILD-OK（main.js 499,114 B / styles.css 52,786 B，选择器 221 条）；复写病自检 —— 新增符号在 src/vendor/main.js 里各只出现 **1 次**；实验库 SYNC-OK bad=0。

## 未发布 — R19（老板五条：找回「文件位置」属性 + 开关扶正 + 状态成栏 + 按钮素色 + 提示精简）

**老板要求**（2026-09-19，8 张截图，五组）：

| # | 老板原话 | 落地 |
| --- | --- | --- |
| ① | 「原本有个功能：标签里可以直接选择文件位置，文件便自动跳转过去，并同步更新链接和 YAML，把这个功能加回来，并让新笔记创建时默认带有此属性」 | 新增 `AutomationModule.patchLocationKey()`：被 Templater 接管的目录里，新笔记**正文照样让路**，但本插件补上「文件位置」这一个键（**只加不覆盖**、值**留空**）→ 属性面板里重新出现可点的候选值下拉 |
| ② | 「这里按钮里的小圆圈是歪的，另外给这几栏加个框」 | 圆点歪的元凶是 Obsidian 原生 `:after` 自带的 `margin-top` 与关闭态 `translate3d` —— 旧 CSS 只覆盖了 top/left/width/height，没清这两条。现显式 `margin:0; transform:none; border-radius:50%`，轨道 `border-radius:999px`；模块栏加 `1px solid --background-modifier-border` 边框 |
| ③ | 「这些说明文字各自弄成一栏，点击可查看当前状态信息，以悬浮窗显示」 | `statusLine()` 重写成**独立一栏**（栏目名「当前状态」+ 卡片 + 行尾「详情 ›」），**整栏可点**打开悬浮窗；窗内是「键 + 说明」逐条列出实时状态。三页各一栏（rebuild / automation / base） |
| ④ | 「上面这种按钮颜色去掉，改成和下面一种样式」 | 删掉 `.kbt-card .mod-cta`（紫）/ `.kbt-card .mod-warning`（红）两条单开配色，改为栏内按钮统一素色（`--background-primary` 底 + hover）。核心三钮（生成预览报告 / 执行 / 回滚）与「高级」里的模板钮一起统一；页头「旧插件收编」横幅的**红色警示底保留**（它是提示横幅，不是操作按钮） |
| ⑤ | 「各栏的提示信息简短易读一些」 | `MOD_TIP` 三条均 ≤18 字；向导 / 操作日志 / 补全开关 / 移动同步 / 一键补全 / 映射表 / 两个路径说明全部砍成一句；顺手清掉说明文字里的 Markdown 反引号（`setDesc` 是纯文本，反引号会原样显示） |

**① 的关键取舍（为什么「值留空」）**：路由判定是「文件位置**非空** → 以它为准；**为空** → 按标签归位」。若把值填成当前目录，新笔记会原地不动、不再按标签归位 —— 那不是旧插件的表现。留空 = 属性行在面板里可见（可点出候选值下拉选目录），但路由仍走标签。另：`writeBack` 关掉时一律不碰前言；`tplDeferMs`（默认 800）做成**实例字段**，测试设 0 即可不必真等。

**验证**：新增 `tests/run_r19.js` **51 条**（① 源码 4 + 行为 9 · ② 开关 CSS 7 · ③ 成栏/悬浮窗 13 · ④ 素色 6 · ⑤ 精简 12）；连带按意图重写 r13（D5 三钮素色）、r16（G4 栏内按钮统一素色）、r18（④-1 栏目数 12 + 新增 ④-1b；⑦-10/⑦-11 素色）与 r6/r7 的「已启用/已关闭」计数锚点（状态小窗里改称「打开着 / 关着」这一中性措辞）。全套 **1233 断言 / 失败 0 × 3 轮 = 3699**（R18 是 1182/轮，+51 全为 r19 新增）；真文件沙盒 **229 / 0**、真库副本 **247 / 0**、bases-preview 独立套件 **45 / 0**、「零裸色」审计过（`run_r3b` 19/0）；构建 BUILD-OK（main.js 497,332 B / styles.css 49,857 B）；实验库 SYNC-OK bad=0。

## 未发布 — R18（设置页排版 v3：照《设置页排版方案v3-交互效果图》重做显示效果）

**老板要求**（2026-09-19，附桌面上的 `设置页排版方案v3-交互效果图.html`）：「参考此效果图，对插件设置界面进行优化，帮助栏集合成一栏」；随后澄清 —— 「帮助栏点开后**还是悬浮小窗**，只是当前的显示效果和之前 HTML 给出的效果有差距，要重新修改」。→ **交互不变，改的是排版与视觉**（那份 HTML 就是权威设计稿）。

**逐条对效果图**

| 效果图 | 落地 |
| --- | --- |
| 页头 = 标题 + 右上角版本号（`.hd`） | `h3` + `.kbt-ver`（取 `manifest.version`） |
| 「日志 / 关于」在**标签行右端**（`.tbs > .ghs`） | 从页头挪进 `.kbt-tabs` 的 `.kbt-ghost-btns`（`margin-left:auto`） |
| 搜索框 = 整行输入框（`.sr`） | 去掉「搜索设置」标题行，只留输入框（占位文案照抄效果图） |
| 命中提示条（`.hint`，可点跳转） | **不再自动跳页** —— 提示「当前页无命中，其他页：「笔记」N 处」+ 可点链接（不打断当前屏） |
| 模块头 = 名字 + 开关一行（`.mrow`） | 同；ⓘ **从模块头挪到状态行**（效果图把提示放在 `.mstat` 里） |
| 短横（`.mline` 26×2） | `.kbt-rule` 改主题色 + opacity |
| 栏目 = 卡片外小标签 + 卡片（`.sec > .lb + .card`） | 新增 `.kbt-sec` / `.kbt-lb`；栏目名从卡片内 `h5` 挪到卡片外 |
| 卡片 = 次级底色、行间淡分隔线（`.card` / `.row`） | `.kbt-card` 改 `--background-secondary` 且无边框；`.kbt-card .setting-item` 每行 12px + 底边线（末行无线） |
| 核心操作 = 一行一件事（`.row`×3） | 从「一行三钮」改成三行：预览报告 / 执行 / 回滚 |
| 辅助 = 向导 + 操作日志 | 「操作日志」并入辅助栏；原报告提示行 `.kbt-report-line` 删除（说明进帮助栏） |
| 看板范围 = 排除目录 | 从「高级」提到 Base 页独立一栏 |
| 高级（`details.adv`，`›`/`⌄` 由 CSS 画） | 三处 summary 统一为「高级」两字，箭头用 `::before` 画，内容进卡片 |
| 按钮低饱和淡底（`.btn-p` / `.btn-w`） | `color-mix(主题色, --background-primary)`，**前一行留 `--background-secondary` 兜底**（零裸色，铁律 6） |
| 帮助栏（`.sec 帮助` + `.hrow` 键/说明） | 页底一栏「帮助」入口 → 点开**仍是悬浮小窗**（老板明确保留）；小窗条目改成「键 + 说明」一行一条 |

**有意与效果图不同的一处**：效果图把「卡片宽度（滑杆 160–480）/ 空位铺满整行（开关）」画进 Base 高级。这两个是**视图级**选项（存在 `.base` 的视图块里，R15 交付，跟着笔记走），放全局开关会把用户为每个看板单独调好的值一把压平 → **不做全局控件**，改在高级里放一条指路说明，并在帮助栏里解释这两项。

**顺带修的两处**
- `tests/run_r3b.js` 原先只把 `cb.css` + `ns.css` 纳入「零裸色 / 变量白名单」检查，**kbt.css 漏在检查外**（kbt.css 是 R13 才进来的）→ 补进 `all`，一起管住。
- 独立版套件里第 2 条「透传真库」的假红：`02_Areas/内容创作/未命名.md`、`未命名 1.md` 让防撞名给出「未命名 2.md」→ 断言改为只比「目录 + 名字前缀」（与 R17 修过的那条同款）。该套件只读退役归档 + 真库，与本次改动无关。

**验证**：新增 `tests/run_r18.js` **45 条**（页头 / 搜索 / 模块头 / 栏目 / 高级 / 帮助 / 样式七组）；改 r13（D 段重写 + F2 改成 CSS 依据）、r14（A7 / C3）、r16（A2–A5 / C4 / C6b / D 段 / E4b / H 段）与 r2/r5/r6/r7/r8 的文案锚点。全套 **1180 断言 / 失败 0 × 3 轮 = 3540**（R17 是 1123/轮），真文件沙盒 **229/0**、真库副本 **247/0**、内容流 **45/0**、独立版 **717/12**（冻结基线存量旧账，见铁律 46）；构建 BUILD-OK（main.js 490,171 B / styles.css 48,010 B）；实验库 SYNC-OK bad=0。

## 未发布 — R17（Templater 模板不再被原样倒进笔记 + 三个自研插件退役）

**报障**（2026-09-19 老板截图）：新建的笔记「标签没成功创建」。打开一看，笔记正文里躺着 `T_内容作品.md` 的**逐字节副本** —— `<%* … %>` 脚本块、`<% topic %>` 占位符原封不动，`---` 不在第 1 行 → Obsidian 不认前言 → 标签 / 属性全废。中招三篇：`00_Inbox/未命名.md`、`未命名 1.md`、`02_Areas/游戏研究/1999/未锈铠.md`（都跟模板文件**同尺寸同内容**，`cmp` 逐字节相同）。

**病根（取证链）**：kb-toolkit 的「当前模板」被指到了模板库的 `T_内容作品.md` —— 那是 **Templater 脚本模板**（首行 `<%* … %>---`）。本插件只替换自己的六个 `{{占位符}}`，于是把 Templater 语法原样写盘。而 Templater 的 `on_file_creation`（2.18.1 源码取证）**只在「剥前言后正文为空」时才套目录模板**、且先等 300ms —— 本插件抢先写了脏数据，它便不再接手。两个插件抢同一篇新笔记，谁先写谁定局。

**修法三条**
1. **模板含 Templater 语法 → 先求值再落盘**：走 Templater 的 `parse_template({template_file, target_file, run_mode:0, active_file}, 全文)`（asar 取证：runningConfig 结构 + `RunMode.CreateNewFromTemplate = 0`）。求值失败、或求值结果里仍带 `<%` → **拒写**：笔记保持空白 + 弹一次说明，绝不写半成品。
2. **目录已被 Templater 目录规则接管 → 让路**：该目录配在 Templater 的 `folder_templates` 里（且开着「新建文件触发」）→ 创建补全直接放弃这篇，整个交给 Templater（消除抢写）。
3. **落盘唯一收口** `templates.materialize()`：创建补全与一键补全都必须过它，「产出的文本里不许再有 `<% %>`」是硬底线。

**顺手修好的损伤**
- **5 篇中心笔记**（`_收件箱` / `_项目中心` / `_领域中心` / `_资源中心` / `_归档中心`）被追加的尾巴里，所属中心被写成模板里硬编码的 `_领域中心` → 改成**自身**（= `router.util.centerFor` 的结果）；并删掉那条对中心笔记而言是假话的「由 Templater 自动生成 · 已自动进入内容创作看板」页脚。
- **3 篇模板副本**按 T_内容作品 的语义求值（吃掉 `<%* %>`、替换 `<% title %>`/`<% topic %>`/`<% today %>`），`---` 回到第 1 行、`tags` 真的进前言。
- 全部改前备份：`.workbuddy/backup/kb-note-repair-2026-09-19/`（含 `_manifest.json` 记改前/改后指纹）。

**三个自研插件退役**（老板要求「移除（留个档）」）：`note-locator` / `creation-board` / `bases-preview` —— 功能已在 kb-toolkit 的 ②③ 模块里。归档 `.workbuddy/backup/retired-plugins-2026-09-19/`（9 文件逐个 sha256 校验通过后才删原目录；整目录复制回去即可复原）。`community-plugins.json` 本来就只剩 kb-toolkit / templater / nutstore-sync。

**随退役做的工程收尾**：三处「与独立版原件字节对照」的断言改成「原地找不到 → 读退役归档冻结基线」（`tests/run_r3.js`、`run_r8.js`、`run_r9.js` + 两个旧套件）；两个旧套件头部注明「测的是冻结基线，不再代表出货代码」。另修掉独立版套件里一条**不密封**的断言 —— 它把「文件是否已存在」透传到真库，被老板那两篇 `未命名.md` 顶成 `未命名 2.md`，于是断言改为只比「落点目录 + 文件名前缀」。

**验证**：新增 `tests/run_r17.js` **36 条**（A 源码级 7 · B 语法识别 6 · C 无 Templater→拒写 3 · D 有 Templater→求值落盘 8 · E 目录让路 5 · F 异常/兜底 5 · G 普通模板回归 2）；其中 C 与 D 是**同一脚手架下的对立结果**（不写 vs 写、空 vs 有前言），互相证伪，不空跑。jsdom 全套 **3369 断言 / 失败 0**（每轮 1123）×3 遍 + 真文件沙盒 **229 / 0** + 真库副本 **247 / 0** + 内容流 **45 / 0** + 独立版 718/11（存量旧账）；构建 BUILD-OK；实验库 SYNC-OK bad=0。

## 未发布 — R16b（复写病：抓到现行 + 上自动断言）

**抓到现行**：R16 收尾复查时发现 `src/36_services_templates.js` 与 `src/60_services_mover.js` 各被**整份叠写两遍**（`KB.define` 各 2 次）。取证链：

- **逐轮备份比对**（`.workbuddy/backup/kb-toolkit-R<轮>/`）：R10 / R11 / R13 / R14 / R15 的备份里 36 号文件恒为 **22,541 B、define ×1**；而 **R16 开工前备份（今天 17:24 —— 本轮第一行代码之前）突变 45,378 B、define ×2**。→ 复写发生在 **R15 收工到 R16 开工之间的空档期**，不是本轮写代码写出来的。
- **两份副本内容不同**：前一份缺 R15 的 `hasOwnProperty` 修复（`{{constructor}}` 原型链防御），后一份才有。按 `KB.reg.forEach` 全部实例化、`KB.service` 后注册覆盖前注册的语义，**运行时用的本来就是后一份**，前一份是死代码 —— 但它会悄悄吃掉未来的编辑（本轮一次注释改动就落在了死代码上），是雷不是灰。

**处理**：脚本 `.workbuddy/tmp/dedupe_src.py` 按「保留最后一个 define 块」去重，清理前原文存 `.workbuddy/backup/kb-toolkit-R16-dedupe-2026-09-18/src/`。36 号 1104 → 553 行、60 号 75 → 38 行；重构建后 main.js **504,398 → 480,213 B（−24,185，就是死代码的重量）**，20 个 src 文件的 `KB.define` 各 1 次。

**上自动化守卫**（`tests/run_r16.js` I 段 7 条，人工 `grep` 自检到此为止）：I1 每个 src 文件 define ≤1 · I2 总数 = 文件数 − 1 · I3 无整段复写（文件头部片段只出现一次）· I4 src 无临时文件残留 · I5 main.js 的 define 次数与 src 一致 · I6 main.js 只实例化一次 · I7 main.js ≈ src + vendor（差值 >4KB 即产物也被复写）。

**两个附带更正**：① R15 那条「OneDrive 复写病」已改称**复写病**（2026-09-18 复查：OneDrive 已排除，真凶仍待抓）；② 备份目录里的副本在 `.obsidian/` **打头的隐藏子目录**下，`ls` 默认看不见 —— 别误判成「备份空了」，用 `find <备份目录> -type f | wc -l` 数。

证据：jsdom 全套 **3243 断言 / 失败 0**（每轮 1081 = 1074 + I 段 7）×3 遍 + 真文件沙盒 **229 / 0** + 真库副本 **247 / 0** + 内容流 **45 / 0** + 独立版 718/11（存量，未变差）；构建 BUILD-OK；实验库 SYNC-OK bad=0。

## 未发布 — R16（设置页三标签改版：知识库 / 笔记 / Base）

**① 三标签导航**（boss 方案：仿坚果云三标签；标签下第一个是搜索框）
- 顶部「知识库 / 笔记 / Base」三个标签，每个标签上一颗小圆点 = 该模块开关状态（薄荷 / 奶油 / 藕荷，模块关了转灰）。
- 页头右侧「日志」「关于」并排靠右；「关于」点开是一个可上下滑动的小窗（版本 / 三个模块 / 安全底线 / 旧插件收编）。
- 搜索支持跨标签：命中别的标签页会**自动跳过去**，不会再让人以为「搜不到」。

**② 模块头三层**（boss：去掉说明小字、标题下加短横、状态行去掉背景色）
- 第一层：模块标题 + **圆角长条滑动开关**（不再打勾）+ 一个 ⓘ（悬停出提示）；
- 第二层：标题左边一条 26px 短横（不用很长的分隔线）；
- 第三层：素色「当前状态」行（callout 背景已压掉），主行粗体 + 副行细节。
- ①②③ 序号全部去掉（boss 第 5 条），顺序不变。

**③ 帮助收成一栏 + 悬浮小窗**（boss：ⓘ 太多 → 减少数量、底下新增帮助栏）
- ⓘ 只留「每模块 1 个 + 核心操作 1 个」；其余说明全部收进每页底部的「帮助」一栏。
- 点「查看提示」弹出**悬浮小窗**，可上下滑动；条目之间只用几条分隔线，**不分栏**。
- 模块关着时整段置灰，但「帮助」仍能点开（样式里单独放行），说明随时查得到。

**④ 配色降饱和 + 手机端浏览**（boss：饱和度太高、要保证手机端体验）
- 主色 / 警示色按钮改成**描边**（不再实心抢眼）；马卡龙色取自 Obsidian 主题色变量（`--color-green/yellow/purple`），样式里零裸色值（铁律 6 守着）。
- 手机端：`@media (max-width: 700px)` + `.is-mobile` 双重适配 —— 开关加大到 42×26、ⓘ 加大到 24px、标签可横向滑动、小窗宽度 `min(420px, 92vw)` 且限高可滚、触屏不叠 tooltip（改成点 ⓘ 直接开小窗）。

**⑤ 顺手清账**：删掉 `36_services_templates.js` 里 extract 的 no-op `replace`（R15 的 C3 断言一直在红的存量旧账，行为完全等价）。

**验证**：新增 `tests/run_r16.js` **51 条**断言（页头 / 三标签 / 模块头三层 / 栏目卡片 / 帮助小窗 / 手机端 / 配色 / 跨标签搜索）；全量 `run_all.js 3` = **3222 通过 / 0 失败**（每轮 1074，R15 基线 1022）；真文件沙盒 229/229、真库副本演练 247/247、内容流 45/45、独立版创作看板 718/11（存量旧账，未变差）。

## 未发布 — R15（卡片宽度真可调 + 主库收编就绪 + 整体排查修复 15 处）

**① 卡片宽度真可调**（boss 报「我需要卡牌宽度可调」）
- 根因不是没这功能——`卡片最小宽度` 滑杆（160–480，step 10）一直在，但 **R14 的「空位铺满整行」用 `1fr` 把卡片撑满轨道**：板块里卡片少时，滑杆拖了卡也不变宽（截图里「知识地图」那张超宽卡就是症状）。
- 新增视图选项 **「空位铺满整行」**（默认开 = R14 行为）：关掉后卡片固定为滑杆宽度、一行排不下才换行——滑杆从此真正可调（栅格 `minmax(--cb-card-w, --cb-card-max)`，整页重绘与「编辑器开着」两条路都即时写 CSS 变量）。
- 顺手修：就地编辑器开着时宽度变更原来会被「编辑器保护」整条吞掉，现在纯样式选项直写 CSS 变量即时生效、不动编辑器 DOM。

**② 主库收编就绪**（Obsidian 运行中不碰启用清单，交付三步操作序列）
- 证据链：真库 `内容创作看板.base` 用的视图类型 = `creation-board` / `note-stream`（kb-toolkit 内嵌同名注册，停旧插件不断供）；creation-board / bases-preview 无 data.json（配置全在 .base 视图块）；note-locator 的 data.json（property / excluded 路由）由 ② 模块启用时自动迁移并 retire。
- **操作序列（三步，全部可逆，旧插件目录不删）**：主库启用「知识库工具集」→ 开 ②（note-locator + auto-note-mover 自动停用）→ 开 ③（创作看板 + 内容流自动停用）。

**③ 整体排查修复 15 处**（两个只读代理通读 src 20 文件 + vendor 4600 行，逐条人工核实后修）
- **P1 ×3**：拖动搬文件同目录退化分支引用不存在的 `srcCard/targetCard`（ReferenceError 被 catch 吞成「移动失败」——两个板块的笔记同住一个目录时拖动必炸）/ 公式分组手动顺序**写读键不同源**（写 `formula:<名>`、读 `s<i>_<k>` 位置键，拖动排序落盘即被打回）/ 自写属性落盘 → mtime 变 → 整页重绘毁掉正在敲字的属性输入框（输入框开着就暂缓重绘、blur 后补）。
- **P2 ×12**：事件总线 MAX_WAIT 封「从首次入队算起」总期限 · 回滚阶段 B 尊重 `quarantine:false` · 补全报告撞名按序号循环 · 路由库根拼正则先转义 · 路由认路补原始大小写候选 · routes/excluded 非数组归一 · 模板占位符 hasOwnProperty（`{{constructor}}` 防御）· 删 no-op 死代码 · lastDraggedPath 用完即清 · 滚动锚点记板块名（允许重复不钉错副本）· 还原预览显式传 sourcePath · detach 前冲编辑器保存 · reveal 定时器可清 · 配置搬运补「属性默认展开」· ``` 与 ~~~ 围栏分开数 · 收编停用 await。

**工程事故与修复**：**复写病**（铁律 47；2026-09-18 复查：**OneDrive 已排除** —— 该机无 OneDrive 安装/进程/Run 项，真凶待查）—— build.js、src/quiet、src/eventBus、src/router、sandbox run.js 共 5 个文件被整文件复写两遍（症状：`fs already declared`、模块注册两次、断言假绿）。全部按开工备份 cmp 定位分界、保留含最新修复的一份；未改动文件与备份逐字节一致（13/13 OK）。

证据：jsdom 全套 **1022 断言 / 失败 0**（991 + r15 = 31）×3 遍稳定 + 真文件沙盒 **229 / 0** + 真库副本演练 **247 / 0** + verify_bases_preview **45 / 0**；构建 BUILD-OK（main.js 468392 B，styles.css 35891 B）；实验库 SYNC-OK bad=0。

## 未发布 — R14（界面美化：设置页 + 看板 + 内容流，11 条）

**背景**：老板四张截图报「整个界面很丑」，先诊断后拍板（优先级=全都要 / 密度=紧凑 / 面板结构=纵向分组），11 条整改分三组落地。原则不变：全原生变量、不加新依赖、行为零变化只动观感。

**A. 设置页（5 条）**
- 组标题与模块开关**合并成一行**（`setHeading` 挂进 Setting 行）——R13 的「组标题 h4 + 下面重复一遍名称+说明」双份文案清掉；① 的锚点类跟到标题行走，keepAnchor 机制不丢。
- ① 状态横幅升级为**原生 info callout**，分主行（粗体「当前状态…」）/ 副行（细节 + 下一步引导）两层。
- 全设置页**清除 Markdown 星号残留**（R13 的 `**再次执行**` 在真机显示为字面 `**`，共 3 处改纯文本）。
- 核心操作行允许换行（窄窗口三按钮不挤出界）；搜索框说明压成一行。

**B. 看板（vendor/creation-board.js，3 条）**
- 板块编辑表单加**分段小标题**（「基础」/「显示」），名称、文件夹、每页条数与显示细节不再糊成一坨。
- 底部按钮**靠右**（完成/删除分离视觉权重）。
- 「配置搬运」（裸 JSON 文本框）收进**默认折叠的高级组** `<details class="cb-io cb-panel-adv">`——正常使用永远不需要看见它。

**C. 看板 + 内容流（样式 + vendor/bases-preview.js，3 条）**
- 看板栅格 `auto-fill` → **`auto-fit`**：板块少时空轨道坍缩，卡片铺满整行不再右侧留白（R14「很丑」截图的主因）。
- 内容流正文**截断 2 行**（`-webkit-line-clamp`），长文不再把卡片撑成瀑布；头部徽章**最多 2 个**、其余进「+N」（vendor 有意分叉，r3/r8 断言同步）。
- 设置页组容器加**轻量卡片边界**（`--radius-m` + `--background-secondary`）；目录点选树限高 220px 滚动；板块标题区垂直居中。

**工程**：新增 `tests/run_r14.js` 17 条（A 设置页结构 / B vendor 源级 / C 样式源级）；r3/r8 的 bases-preview 分叉断言同步（R14 起**两个 vendor 都有意分叉**）；备份 `backup_kbt_r14.py`（69 文件 sha256 校验 0 缺失）。

证据：jsdom 全套 **991 断言 / 失败 0**（r1~r9 = 852、r10 = 46、r11 = 14、r12 = 29、r13 = 33、r14 = 17）×3 遍稳定 + 真文件沙盒 **229 / 0** + 真库副本演练 **247 / 0** + verify_bases_preview **45 / 0**；构建 BUILD-OK（main.js 458950 B，styles.css 35642 B）。已同步实验库（SYNC-OK bad=0）。

⚠️ 遗留（非本轮引入）：`verify_creation_board.js`（独立版旧套件）718/11 —— mtime 证明套件 09:03、独立版构建 14:36 都早于本轮开工；11 条全是独立版 R13 有意变更（新增「总条数上限」选项 9→10、属性默认展开、拖动亮条左右）未同步旧套件期望，归入「独立版收编」待办。

## 未发布 — R13（界面翻新：操作界面 + 设置界面）

**三条核心设计思路**（老板拍板的方案落地）：①「三段式」替代「一锅炖」——按使用频率分层，核心操作常驻第一屏、低频项收进「高级」折叠；②所有操作回到「有主之地」——命令面板只留 4 条高频，其余操作只在设置页（带状态、带确认）；③空状态即路标——未配置时给下一步引导。

**设置界面**
- 顶部新增**搜索框**：输入关键字即时过滤设置项，命中「高级」组自动展开该组；无结果给出建议词（路径 / 模板 / 回滚 / 排除 / 向导）；清空即复位。
- 三个模块改成**分组结构**（组标题 + 一句组说明 + 开关 + 操作段落），顶层的「知识库路径」「模板与套用规则」「看板排除目录」三块低频配置分别收进各组 **「高级：…」折叠面板**（原生 `<details>`，默认收起，样式全走原生变量）。
- 「首次使用向导」移到 ① 组内、**段落之外** —— 模块关着（整段置灰）也能点，新手永远有入口。
- R10 拨开关只重画本段、R11 关=置灰不收起、R8 失焦落库、R7 锚点补偿四套机制原样保留。

**操作界面（① 重建操作区）**
- 新增**状态横幅**：自动读取当前库状态（不再是「查看当前状态」按钮），还没建库时第一句就是下一步引导（先看预览 / 用向导初始化）。
- **三步主操作条**：一个原生 Setting 行放「生成预览报告（主色）/ 执行（警示色）/ 回滚（警示色）」三个按钮，顺序即流程；危险色只给危险动作。
- 「打开报告」从独立行降为底部提示行 + 内联小按钮；「查看当前状态」并入状态横幅 —— 重复入口清掉。

**操作界面（③ 看板视图设置面板）**
- 面板选项重排：常用开关（允许重复 / 收容所 / 显正文）留在外层，**YAML / 结尾双链 / 拖动搬文件**三个进阶开关收进「高级：正文细节与拖动行为」折叠组（键与默认值不变，r12 断言守着）。

**命令面板裁剪（4 条）**
- 保留：`打开知识库工具集设置`（新增，插件总入口，不随模块开关变化）、`生成预览报告`、`回滚`、`打开最近一次操作日志`。
- 移除：`执行`（危险操作必须在设置页走勾选确认弹窗，不该从命令面板一键触发）、`查看状态`（并入状态横幅）、`一键补全`（设置页按钮同款入口）。功能一个不少，入口各归其位。

**工程**：新增 `tests/run_r13.js` 33 条（分组骨架 / 搜索过滤 / 状态横幅 / 主操作条 / 命令清单 / 面板高级组）；新增 `styles_src/kbt.css`（全原生变量，无裸色值），build.js 改为动态合并 styles_src/*.css，r3/r3b 的头注释与选择器守恒断言改动态枚举；stub 的 Setting 补上真机同款 `setting-item` 类。受结构影响的 r1/r3/r3b/r4b/r6/r7/r8/r10 断言已同步更新（r4b 场景 G 改从设置页按钮同款入口 `startConfirm` 走全链路）。

证据：jsdom 全套 **972 断言 / 失败 0**（r1~r9 = 850、r10 = 46、r11 = 14、r12 = 29、r13 = 33）×3 遍稳定 + 真文件沙盒 **229 / 0**；构建 BUILD-OK（main.js 457700 B，styles.css 33035 B，SYNTAX-OK）。

## 未发布 — R12（第七轮真机反馈，7 条）

**① 第 1 条「文件移动改成鼠标直接拖动，不需要 Alt（全部视角里移动不了）」**
- R11 的 Alt+拖动升级为**默认行为**：跨目录拖卡片 = 直接搬文件（`moveCardToFolderOfCard`，YAML 领域 / tags / 文件位置与正文双链同步跟随）；Alt+拖 = 强制纯排序（退回 R11 前语义）。同板块内拖动仍是调顺序，行为不变。
- 「全部」板块搬不动是**结构性限制**：`全部` 是聚合视角，卡片背后没有一个「源文件夹板块」可参照落点 —— 拖到哪一格都定不了目标目录。要搬文件请在文件夹板块之间拖，或在文件管理器里拖（rename = 手动搬移，R11 已保证不回弹）。视图设置面板里新增 **「拖动搬文件」开关**（默认开），关掉即退回旧版「Alt+拖动才搬文件」。

**② 第 2 条「板块设置：单独调整板块名称和板块内文件显示方式」**
- 板块标题旁新增 **⚙**（仅文件夹 / 标签板块，原生板块和公式板块不提供）。点开是板块配置面板，改的是**这一个板块**，不影响其它板块：
  - 板块名称（只改显示名，.base 源文件里的 key 同步重写，重开不丢）
  - 文件显示方式：**列表 / 卡片**、每页条数、**显正文**、排序方式（沿用 R10 落地的 renderPanel，本轮补齐入口）

**③ 第 3 条「笔记视窗自主选择是否查看 YAML 和结尾双链（加到板块设置）」**
- 板块配置面板新增两个三态选项：**显示 YAML**（默认关）、**显示结尾双链**（默认开）。「跟随视图」= 用视图级默认（视图默认也是这两个键，板块没写就用默认）。
- 实现：`stripForPreview` 增加 `keepYaml`（true 时保留前言）；`cutLinksTail` 按「关联笔记」标题把结尾双链段整段剪掉；板块行加 `YAML` / `无双链` 徽标提示覆写状态。

**④ 第 4 条「板块可以直接拖动实现排序」**
- 板块标题区可按住**拖动整块**：拖动中板块半透明、目标位置留蓝色落点线，松手即按新顺序写回视图配置（`sig=null` 强制重建，铁律 30）。原生板块（公式 / 表格源）参与排序；拖动只调顺序，不改任何数据源。

**⑤⑥ 第 5/6 条「手机支持（坚果云同步 + 插件整体在手机可用）」**
- 移动端审计（D 组 7 项断言）：IntersectionObserver（懒加载有守卫，无则全量渲染）、`crypto.getRandomValues`（try/catch 回退 Math.random）、`navigator.clipboard`（typeof 守卫 + Notice 提示手动复制）、`openWithDefaultApp` / `showInFolder` / `openPopoutLeaf`（全部 `typeof === "function"` 才调用）、触屏拖放（HTML5 DnD 在手机上不可用 —— 板块排序在手机上暂以配置面板代替，卡片拖动搬文件仍是桌面功能）。
- manifest `isDesktopOnly: false` 已在位；坚果云同步的是库文件（笔记 / .base / 插件目录），手机端 Obsidian 打开同一库即可看到看板与内容流视图。

**⑦ 第 7 条「已安装插件只一个，第三方插件却显示两个 —— 去掉创作看板一栏」**
- 真因（R11 只清了目录，没断根）：内嵌看板本体 3943 行自调 `this.addSettingTab(...)`，设置页导航名取自**内嵌 manifest.name**（「创作看板」）—— 幽灵栏来自这里，不是残留目录。
- 修法：内嵌实例加载前 `suppressSettingTab()`（打标 + 把 `addSettingTab` 换成空操作），两个内嵌视图（看板 / 内容流）都不再注册设置页。
- 复活目录断根：内嵌看板 data.json 落盘位置从 `.obsidian/plugins/creation-board/`（无 manifest → 列表不显示，但 OneDrive 把它同步复活）迁到 **`.obsidian/plugins/kb-toolkit/embed-creation-board/`**（内容流 → `embed-bases-preview/`）。实验库残留的幽灵目录已再清一次（回收站），新构建不会再写回旧路径。

**工程**：`tests/run_r12.js` 新增 29 条（A ⑦ 内嵌禁注册设置页 + data.json 挪家 / B ① 拖动=搬文件与板块拖动 / C ②③ YAML·双链·拖动搬文件三组配置键 / D ⑤⑥ 移动端审计）；r3b 的选择器守恒从硬编码 187 改为动态复算（生产 CSS 数 = cb + note-stream 之和）并补 R12 规则检查；`styles_src/cb.css` 追加板块拖动与 ⚙ 样式（生产 styles 同步重编）。

证据：jsdom 全套 **937 断言 / 失败 0**（r1~r11 = 908 + r12 = 29）×3 遍稳定 + 真文件沙盒 **229 / 0**；构建 BUILD-OK（main.js 454249 B，SYNTAX-OK）。

## 未发布 — R11（第六轮真机反馈，4 条）

**① 第 1 条「没法直接在目录里拖动移动」**
- 根因：手动拖动 = `vault.rename` 事件，旧实现把 rename 也喂给路由 `handle()` —— 属性「文件位置」还写着旧目录（writeBack 写的），路由一看「属性 ≠ 当前目录」就把文件搬回原位。自动化在跟老板抢文件。
- 修法（两层）：
  - 事件总线给 rename 透传 `oldPath`；`rename` 改走新方法 `handleManualMove()`：**属性跟随新目录**（writeBack 开着时）+ 正文「所属中心」双链跟随（fixCenterLink 开着时），**绝不调用路由搬家**。拖出库根 / 锁定 / 排除目录 → 什么都不写。
  - 路由 `resolveTarget` 废除「镜像让位 tags」规则，改为**属性优先**：属性非空 → 以属性为准（= 当前目录 → 不动；认不出 → 宁可不动）；属性为空 → 才看标签。否则拖完同步的属性会在下一次 `changed` 时又被标签搬回去。
- 语义变化说明：旧镜像规则下「属性镜像 + 路由标签指向别处」的笔记会被标签反复拖走；现在属性是「人最后一次的意图」，标签只管属性为空的新笔记。

**② 第 2 条「关闭后又跳了 → 实现不了保持位置就不做自动收起了」**
- 根因：R10-③ 已做到「拨开关只重画本段」，但模块关掉后该段**收起成一行**，下方内容整体上移 —— 老板看到的跳位就是这段高度差。
- 修法（按老板拍板）：**取消自动收起**。模块关掉时段落照常渲染（按钮占位），整段加 `.kb-module-disabled`（opacity 0.55 + pointer-events:none）+ 一行「模块已关闭」说明。开/关布局零变化，一个像素都不跳。硬门控不变：命令照旧不注册、按钮点不动（禁用替代隐藏，「不可执行」仍成立）。

**③ 第 3 条「看板里笔记拖动没法移动」**
- 取证：老板的看板（未命名.base）只有一个「全部」板块 —— 看板的「拖动 = 搬文件」只在文件夹板块之间生效；同板块内拖动是调顺序（.base 里的「手动顺序」证明排序是好用的）。所以拖了文件不动。
- 修法（老板三选一拍板 **Alt+拖动搬文件**）：`drop` 处理器加 `evt.altKey` 分支 → `moveCardToFolderOfCard()`：把文件搬进**目标卡片所在目录**（复用原搬文件逻辑，YAML 领域/tags/文件位置与正文双链同步）。普通拖动一字不变：同板块调顺序、跨板块搬文件；同目录内 Alt+拖自动退化为调顺序。
- vendor/creation-board.js 与独立插件**有意分叉**（r3/r8/r9 的字节比对断言已改为「分叉 + 含新实现」）；bases-preview 仍字节一致。

**④ 第 4 条「只装一个插件却显示两个」**
- 根因：R10-⑧ 清实验库时保留了插件目录，旧 `creation-board/` 残留 —— Obsidian 按「目录在 = 已安装」列出两条。
- 修法：残留目录整份进**回收站**（可还原，脚本记了 sha256 指纹）；第三方插件列表只剩「知识库工具集」。顺手把 manifest 描述里的「知识库重建」改成「新建知识库」。

**顺手**：r6 测试帮手 `btnTexts` 修掉「逐层 querySelectorAll 重复计数」的老毛病（以前断言恒为 0 没暴露）；实验库根补回更新版 `操作说明.md`（旧版随老板的重建归档进了 `旧文件/`）。

证据：jsdom 全套 **907 断言 / 失败 0**（新增 `tests/run_r11.js` 14 条）+ 真文件沙盒 **229 / 0**。

## 未发布 — R10（第五轮真机反馈，8 条）

**① 第 1 条「像主库一样，能直接在属性里选文件存储位置」**
- 根因：主库能选是因为旧 **note-locator** 给 `metadataCache.getFrontmatterPropertyValuesForKey` 打了补丁；Obsidian 原生只从「库内已有笔记的属性值」收集候选，空目录落点（01_执行中…）和没用过的状态永远不出现。kb-toolkit 里 `automation.propertyOptions` **配置一直都在**（R2 还做了 note-locator 迁移），但**没人接到 UI**。
- 修法：② 模块新增 `patchPropertySuggestions()`（幂等包装原函数，候选 = 原生 ∪ `propertyOptions[key]`，zh-Hans-CN 数值序）；`onConfigure()` 就地刷新，停用 `unpatchPropertySuggestions()` 摘掉。

**② 第 2 条「改了知识库根目录名，重建后名字还是原来那一套」**
- 根因（现场时间戳取证：15:14 改名落盘 → 15:17 执行，新建根仍是旧名）：`runExecute` 直接复用**上次预览落盘的 `rebuild-manifest.json`**，而 manifest 里记的 `root` 是改名之前算的；配置变更对执行完全不可见。
- 修法：`plan()` 给 manifest 写 `cfgFingerprint`（rootName / oldFolder / 分代名 / keepTop / excludedTop / 模板 dirs+seeds 的哈希）；执行前重算比对，不一致 → **按当前配置整体重算 manifest** 并 Notice 告知。
- 🔴 顺序坑：**先验结构、再比指纹**。反过来的话，坏 manifest 会被当成「配置变了」去重算，「坏 manifest 必须拒绝执行」这条硬门槛就失效了（r4b D 段抓到）。

**③ 第 3 条「关掉开关后『启用模块』跳到下面去了」**
- 修法（顺带 ⑦ 的框架整理）：三个模块段落各装进**自己的固定 div**（`kb-module-section`），拨开关只 `empty()` + 重画**那一段**；上面的「启用模块」与其它段落一个节点都不动，滚动位置天然不跳。段渲染函数用参数名 `containerEl` **遮蔽**外层同名变量，段内代码零改动。锚点补偿 `keepAnchor` 保留给**按钮触发的整页重画**。

**④ 第 4 条「新建知识库后附带默认模板」**
- `execute` 新增步骤 3b：把内置 4 套模板（PARA / 轻量收件 / 项目笔记 / 资料收集）落进 `<新根>/<元目录>/02_模板库/Templater/`，走 `vop.createText` **进 journal**（回滚能清干净），目录里已有模板则整段跳过。
- 🔴 目录必须挂在 **`manifest.root`（本轮新建的根）** 下：再次重建时新库是 `<库根>1`，照 `settings.paths.knowledgeBase` 算会写到被原地保留的旧库去、父目录还可能不存在（r8 D2 现场：执行直接 failed）。
- 执行报告如实加一行「默认模板 N 套」。

**⑤ 第 5 条 全量排查 → 两个真 bug**
- **配置改动不落盘**：`applySettingsChange()` 只 refresh+reapply，而设置页三处（路径 / 模块开关 / 看板排除目录）都因本函数存在而跳过了自己的 `saveSettings` → 改动只活在内存里，重载插件就丢。现在收口处先落盘（失败不阻断重配）。
- **旧插件横幅永不出现**：`plugin.legacyFound || 现查` —— onload 存下的**空数组也是真值**，短路之后用户回头再开旧插件，横幅再也不提示。改成 `legacyCheck` 开着就每次现查。

**⑥ 第 6 条 零散插件收编**
- 设置页顶部横幅新增「一键停用并收编」：对检测到的旧插件逐个 `disablePluginAndSave`（可手动开回来，不删文件）。能力对照：note-locator → ②（含 ① 的候选值补丁）、creation-board / bases-preview → ③。

**⑦ 第 3/7 条 界面与文案**
- 模块名全量改名：**「知识库重建」→「新建知识库」**（设置页 / 命令 / Notice / 报告标题 / 向导，共 79 处；命令 id 不动）；去掉「（R4 上线）」这类内部记号；模块描述改写成人话。
- 首次使用向导重写三步文案（叫什么 / 开哪几个模块 / 现场只读检测）。

**⑧ 实验库交付**
- 清空「插件实验」库（走回收站可还原）→ 同步新构建 → 重置 `data.json`（下次打开会走一遍新向导）→ 只留 `操作说明.md` 一篇。

证据：jsdom 全套 **883 断言 / 失败 0**（新增 `tests/run_r10.js` 45 条）+ 真文件沙盒 **229** + 真库副本预演 **247**。

## 未发布 — R9（第四轮真机反馈，6 条）

**① 第 3 条「似乎会自动创建数据库，然后报出提示」**
- 根因（asar 取证）：`Plugin.registerBasesView(id, reg)` 的实现在注册之后把**注销动作**挂到 `Component` 的 `_events` 上 —— 而 `_events` 里的清理函数**只有 `load()` / `unload()` 才会执行**。旧实现拨开关时只调 `inst.onload()` / `inst.onunload()`，`deregisterView` 从没跑过 → 视图 id 一直在；再插回来就撞名。而 `BasesView.registerView` 遇同名 id **不覆盖**，只弹一句 `Unable to add new Bases view "<id>". A view with this ID already exists.`。
- 修法：内嵌实例改走 `inst.load()` / `inst.unload()`（真生命周期）；注册前先 `deregisterView` 同名 id 兜底（`patchViewRegistration`）；把注册过的 id 记在 `plugin.kbRegisteredViews` 上，停用时逐个摘掉。
- 证据：离线断言「连拨两轮开关 → `bases._errors` 恒为 0、注册表恒只有一份」。

**② 第 4 条 把 note-locator 的「文件位置 → 按标签/属性搬文件」能力并入 ②**
- 该能力（`router` / `mover` / 回填 / 中心链）现在**只依赖 ② 是否打开**，与 ① 重建完全解耦：只开 ② 时，改一篇笔记的 `文件位置` 就会按路由表把它搬进目标目录（断言 J）。
- `routes` 仍由一张相对表派生（`REL_ROUTES`）+ `withRoot(库根)`，换库根名不用改代码。

**③ 第 5/6/7 条 回滚不是「无法完成」就是「有文件没迁移整理」**
- 根因（真机现场取证）：回滚阶段 A 把外来户 `rename` 进 `回滚保留-<戳>/`，这条 **rename 事件**喂给了 ② 的路由 → 路由照着笔记的 `文件位置` 立刻把它**搬回新库** → 收容白做、新建目录仍旧非空 → 回滚卡在「目录非空」，自检报「新建根仍存在」。**第 5、6、7 条是同一个上游 bug 的三种表现。**
- 修法四件套：
  - **静默窗口**（新服务 `services/quiet`）：执行/回滚全程开窗，事件总线在**入队**与**到点派发**两处都校验（`SETTLE_MS = 1200ms` > 事件总线封顶延时 800ms，关窗用 `end()` 延后放行，让排队的批次自然过期）；② 的三个入口（`handler` / `handle` / `tryCreateFill`）也各自首段再挡一道。
  - **默认排除收容区**：`defaultExcluded()` 新增 `^回滚保留` 一条；`normalize()` 会把**没被手改过**的旧 3 条默认值就地升级成新 4 条（逐字比对照 `defaultExcluded(paths, null)`，用户自己配过的原样保留）。
  - **幂等搬运照样写可逆日志**：源已不在原位、目标位已有同名（= 上一次执行搬过）→ 旧实现只记一条跳过、`journal` 里没有逆操作 → 回滚**搬不回来**（自检报「缺件 R7-试玩说明.md」）。现在照样登记 `op:"move"` + `preexisting:true`，回滚据此搬回原位。
  - **空目录补删**：`sweepEmptyDirs()` 收尾扫一遍本轮 `mkdir` / `mkdirOld` 的目录，空则删（深→浅），非空计入 `kept` 如实写进报告。
- 另修：**`preflight` 不再把「源已全部不在原位」当异常**，只在报告里说明；`verifyRestored` 的「新建根仍存在」判据补上 `!keepRoot`（再次重建时新根是该存在的）。

**④ 第 6 条的另一半：同一轮里第二次执行会丢掉第一次的记录**
- 根因：第一次执行中途失败 → 第二次执行新建一份 `journal` 把上一份**覆盖**掉，于是第一次记下的「旧文件区是本轮建的（`mkdirOld`）」丢了 → 回滚删不掉那个空目录，留下残渣。
- 修法：`execute` 接受 `opts.carry`，把**同一轮里上一份未被回滚的** `journal` 记录**继承过来并按 `op + 路径` 去重**（先到的胜出 —— 第一次的真搬记录比第二次的 `preexisting` 更完整）。库根不一致或状态已是 `rolled-back` 的一律不继承。
- 回归：`jsdom` 单元 3 条边界 + 真文件沙盒 S7（第一次注入失败 → 重跑 → 回滚，末了 `旧文件/` 是**空的且被删掉**）。

**⑤ 第 8 条 属性默认展开**
- 看板卡片与就地编辑浮层里的属性区**默认展开**；新增视图选项「属性默认展开」（`toggle`，默认 `true`），关掉才回到原来的折叠行为。
- 记忆口径改对了：旧实现存的是「展开集合」（`prosOpenPaths`），默认展开之后要存的是「**与默认不同**的集合」（`prosToggledPaths`）。
- `vendor/creation-board.js` 与独立插件 `creation-board/main.js` **仍然字节等价**（断言抽回比对），两处同步改。

**⑥ 报告如实对账**
- 执行报告不再把 manifest 里的**计划**搬运项当成**已搬**列出：按 `journal` 的 `op:"move"` 条目分出「真搬成」（**排除** `preexisting` 的），再单列「已在目标位」与「未搬成」，并在「计划有搬运项但一项没搬」时显式警示。
- 回滚收容表修了两个列取值 bug：`_quarantineMove` 在 `rename` **之前**抄下原位路径（`renameFile` 会**就地**把 `file.path` 改成目标位，事后读就是收容路径 → 两列一模一样）。

## R8（第三轮真机反馈，7 条）

**① 创建补全提速（体感「半秒到一秒」）**
- 根因一：`eventBus` 把 `create` 的等待写死成 800ms（当年为了等 Templater 落笔），**每一次**新建都得先干等 0.8 秒。
- 根因二：`handler` 里 `tryCreateFill` 没有 `await`，补全与路由并行跑 —— 补全还在写文件时路由已经把文件搬走了（白写一次），而且两处各写一遍前言（一篇新笔记写盘 2~3 次）。
- 现在 `create` **起步只等 180ms**；这期间同一条路径又来事件（Templater 落笔 → `metadataCache.changed`）就按事件自己的延时续期，累计封顶仍是 800ms（`MAX_WAIT`）。于是「安静的新建」180ms 就补完，「热闹的新建」照样等得住。旧的 `STEP` 固定步长已删。
- `handler` 改成 `await tryCreateFill` → `await handle` 串行：路由看到的是**补全后**的前言，绝大多数情况直接判定「已是想要的样子」，不再重复写盘。
- 实测（离线真链路）：端到端补全 < 760ms，且新笔记里只写了一份前言（旧版两处各写一次）。

**② 回滚不再被「重建后才出现的笔记」卡住**
- 根因：重建之后老板又往新库里写了笔记 → 回滚要删的新建目录**非空** → 删不掉 → 整条回滚半途而废。
- 新增回滚阶段 A「收容」：`quarantineForeign` / `_sweepForeign` / `_quarantineMove` 把「本轮新建目录里不属于本轮的东西」整体挪到顶层的 `回滚保留-<时间戳>/`（**保留它原本在库里的相对路径**），目录这才空得下来，回滚一路走完。
- 底线不变：只扫本轮 `mkdir` 出来的目录（**绝不扫旧文件区** —— 那里躺着正等着搬回原位的老库）；收容是**移动不是删除**，老板的笔记一篇不丢；回滚报告多一节「回滚时保留」。
- Notice 与确认弹窗都写清了：「回滚前才出现在新库里的笔记不会丢，会被请进 `回滚保留-<戳>/`」。

**③ 设置页输入框「一次只能打一个字符」**
- 根因（asar 取证）：Obsidian `TextComponent.onChange` 挂在 **`input` 事件**上 = **每按一个键**都回调；旧实现一回调就走 `refreshSettingTab()` 重画整页 → 输入框元素被换掉、焦点丢了 → 下一个字符落空。**按几下就只能进几个字符里的最后一个**。
- 新增 `commitOnBlur(t, apply)`：按键期间只记草稿，**失焦或回车才落库**，且就地更新说明文字（不重画整页）。路径输入框与③组的「排除目录」都改走它。
- 测试桩按 asar 事实修正：`addText`/`addTextArea` 的 `onChange` 同时挂 `input` + `change`，并新增 `typeFire`（敲键）/`blurFire`（失焦）—— 旧桩只挂 `change`，把这个 bug 掩盖了两轮。

**④ 再次重建：已有库原地保留 + 并列新库 + 旧文件区分代归档**
- 老板要的语义：在「已经有旧文件区 + 已有知识库」的状态下再重建 → 把这两者**之外**的顶层文件全部移入旧文件区，再建一个**与已有知识库并列**的新库。
- `plan()` 新增 `reRebuild` / `keepRoot` / `archive{prior,incoming}`：旧文件区已有内容 → 判定「再次重建」；顶层已有同名知识库 → **原地保留不搬**，新库取编号名（`01_新知识库1`）与它并列。
- 旧文件区下建两个子文件夹：`先前已有-<戳>/`（装再次创建**之前**就躺在旧文件区里的东西）+ `本次移入-<戳>/`（装这次搬进来的）。**第一次重建不建这两个子文件夹**（没有旧文件就不创建），搬运目标就是 `旧文件/<原名>`。
- 撞名判据改成「目标位此刻存不存在」：分代归档之后正常路径产不出撞名，两篇同名内容都留住。`execute` 第 0.5 步补建搬运目标的父目录（记 `mkdirOld` → 回滚统一「空了就删」）。

**⑤ 补全模板升级为「模板库里的 .md 文件」+ 套用规则**
- 模板从「配置项」改成**文件**：`<库根>/<元目录>/02_模板库/Templater/*.md`（`id` 前缀 `file:`）。在设置里改、在 Obsidian 里直接改，**都是同一份**；创建后自动落盘到此处，用户也可以直接在这儿改。
- 设置页现在能：看当前模板（下拉）/ 预览并编辑模板正文 / 保存 / 另存为 / 从笔记提取 / 把内置四套写入模板库 / 删除（走回收站）。
- 新增**套用规则**：`<文件夹>` 或 `<标签>` → 用哪套模板。优先级 **标签规则 → 文件夹规则（最长前缀）→ 「当前模板」兜底**；都不中时如实报 `why = null`，不谎报规则。规则可在设置页逐条增删。

**⑥ 创作看板默认展示整个笔记库**
- 看板自带的默认是 `excludeFolders: "99_Meta"`（会挡掉元目录）。**不动 vendor 一个字节**，改成把 kb-toolkit 设置里的值推给内嵌实例（写它自己的 data.json → 重载它的设置），默认值 = 空串 = 不排除任何目录。
- 设置页新增「创作看板 · 排除目录」（留空 = 整个笔记库；填了目录段才挡），改完当场推下去。
- 🔴 短路判据必须是「data.json 里有没有这个键」，不能是「取出来的值等不等于想要的」—— 没有这个键时读出来也是空串，就此 return 等于没压掉看板的内部默认，「默认整个库」会落空（本轮踩过一次，有断言守着）。
- 参数只在 `.base` 视图块 / 插件设置里，**两个 vendor 文件仍然字节等价**（断言抽回比对）。

**⑦ 一键补全（扫描全库，只加不删）**
- 设置页②组新增「一键补全（扫描整个知识库）」按钮，命令面板新增 `笔记自动化：一键补全`（同样走模块关闭即不注册的硬门控）。
- 流程：**先只读扫一遍**列出要动的笔记 → 弹确认框（列条数 + 前 8 篇要补什么）→ 确认后才逐篇写 → 落一篇操作日志报告。**不许静默批量改库。**
- 补法：空笔记套整套模板；有正文的**只在缺的位置补** —— 开头补 YAML、结尾补「关联笔记」双链。**原有正文一个字符不动。** 已经完整的笔记、模板库里的 `.md`、排除目录（含 `02_旧知识库`）一律跳过。
- 幂等：补过之后再扫 → 0 篇待补，不重复写。

**验收证据**
- `tests/run_r8.js`（137 断言）：事件总线三档延时实测（安静 180ms / 续期 < 800ms / 续期封顶）与端到端补全耗时 / 回滚收容（外来文件夹 + 新库子目录里的单篇，各归各位且原库复原）/ 输入框按键不落库·失焦落完整的串·页面不重画 / 首次重建不分代 vs 再次重建两个分代子文件夹内容各就各位 / 模板文件化 + 套用规则端到端（目录命中·标签优先·兜底）/ 看板默认整个库（含「看板自带默认是 99_Meta」的证伪前提）/ 一键补全（扫描口径·只读预演零写入·只加不删·幂等·确认门槛·报告落库·命令摘除）/ vendor 字节等价 / 静态守卫。
- 回归：r1~r7 606 断言 0 失败（r4b 110→127：撞名场景改为「服务层直喂 manifest」—— R8 之后 plan 正常路径已产不出撞名；r7 116→131：输入框语义改为「按键不落库 + 失焦落库」）；creation-board 729/729；bases-preview 45/45；**真文件沙盒 171/171（六场景 × 两遍，比 R7 多两个场景）**；真库快照 diff = 0（334 文件，增 0 / 删 0 / 改 0）。
- 🔴 沙盒抓到两个 jsdom 桩盖住的真 bug：① 收容移动没建目标位的**父目录**（`回滚保留-<戳>/<库根>/<子目录>/…` 这条路径上除了收容区本身全不存在）→ 真机上回滚直接 4 条 blocked、整条半途而废；② 看板「排除目录」的短路判据看错对象（见下）。两条都已修。

## 未发布 — R8（第三轮真机反馈，7 条）

**① 创建补全提速（体感「半秒到一秒」）**
- 根因一：`eventBus` 把 `create` 的等待写死成 800ms（当年为了等 Templater 落笔），**每一次**新建都得先干等 0.8 秒。
- 根因二：`handler` 里 `tryCreateFill` 没有 `await`，补全与路由并行跑 —— 补全还在写文件时路由已经把文件搬走了（白写一次），而且两处各写一遍前言（一篇新笔记写盘 2~3 次）。
- 现在 `create` **起步只等 180ms**；这期间同一条路径又来事件（Templater 落笔 → `metadataCache.changed`）就按事件自己的延时续期，累计封顶仍是 800ms（`MAX_WAIT`）。于是「安静的新建」180ms 就补完，「热闹的新建」照样等得住。旧的 `STEP` 固定步长已删。
- `handler` 改成 `await tryCreateFill` → `await handle` 串行：路由看到的是**补全后**的前言，绝大多数情况直接判定「已是想要的样子」，不再重复写盘。
- 实测（离线真链路）：端到端补全 < 760ms，且新笔记里只写了一份前言（旧版两处各写一次）。

**② 回滚不再被「重建后才出现的笔记」卡住**
- 根因：重建之后老板又往新库里写了笔记 → 回滚要删的新建目录**非空** → 删不掉 → 整条回滚半途而废。
- 新增回滚阶段 A「收容」：`quarantineForeign` / `_sweepForeign` / `_quarantineMove` 把「本轮新建目录里不属于本轮的东西」整体挪到顶层的 `回滚保留-<时间戳>/`（**保留它原本在库里的相对路径**），目录这才空得下来，回滚一路走完。
- 底线不变：只扫本轮 `mkdir` 出来的目录（**绝不扫旧文件区** —— 那里躺着正等着搬回原位的老库）；收容是**移动不是删除**，老板的笔记一篇不丢；回滚报告多一节「回滚时保留」。
- Notice 与确认弹窗都写清了：「回滚前才出现在新库里的笔记不会丢，会被请进 `回滚保留-<戳>/`」。

**③ 设置页输入框「一次只能打一个字符」**
- 根因（asar 取证）：Obsidian `TextComponent.onChange` 挂在 **`input` 事件**上 = **每按一个键**都回调；旧实现一回调就走 `refreshSettingTab()` 重画整页 → 输入框元素被换掉、焦点丢了 → 下一个字符落空。**按几下就只能进几个字符里的最后一个**。
- 新增 `commitOnBlur(t, apply)`：按键期间只记草稿，**失焦或回车才落库**，且就地更新说明文字（不重画整页）。路径输入框与③组的「排除目录」都改走它。
- 测试桩按 asar 事实修正：`addText`/`addTextArea` 的 `onChange` 同时挂 `input` + `change`，并新增 `typeFire`（敲键）/`blurFire`（失焦）—— 旧桩只挂 `change`，把这个 bug 掩盖了两轮。

**④ 再次重建：已有库原地保留 + 并列新库 + 旧文件区分代归档**
- 老板要的语义：在「已经有旧文件区 + 已有知识库」的状态下再重建 → 把这两者**之外**的顶层文件全部移入旧文件区，再建一个**与已有知识库并列**的新库。
- `plan()` 新增 `reRebuild` / `keepRoot` / `archive{prior,incoming}`：旧文件区已有内容 → 判定「再次重建」；顶层已有同名知识库 → **原地保留不搬**，新库取编号名（`01_新知识库1`）与它并列。
- 旧文件区下建两个子文件夹：`先前已有-<戳>/`（装再次创建**之前**就躺在旧文件区里的东西）+ `本次移入-<戳>/`（装这次搬进来的）。**第一次重建不建这两个子文件夹**（没有旧文件就不创建），搬运目标就是 `旧文件/<原名>`。
- 撞名判据改成「目标位此刻存不存在」：分代归档之后正常路径产不出撞名，两篇同名内容都留住。`execute` 第 0.5 步补建搬运目标的父目录（记 `mkdirOld` → 回滚统一「空了就删」）。

**⑤ 补全模板升级为「模板库里的 .md 文件」+ 套用规则**
- 模板从「配置项」改成**文件**：`<库根>/<元目录>/02_模板库/Templater/*.md`（`id` 前缀 `file:`）。在设置里改、在 Obsidian 里直接改，**都是同一份**；创建后自动落盘到此处，用户也可以直接在这儿改。
- 设置页现在能：看当前模板（下拉）/ 预览并编辑模板正文 / 保存 / 另存为 / 从笔记提取 / 把内置四套写入模板库 / 删除（走回收站）。
- 新增**套用规则**：`<文件夹>` 或 `<标签>` → 用哪套模板。优先级 **标签规则 → 文件夹规则（最长前缀）→ 「当前模板」兜底**；都不中时如实报 `why = null`，不谎报规则。规则可在设置页逐条增删。

**⑥ 创作看板默认展示整个笔记库**
- 看板自带的默认是 `excludeFolders: "99_Meta"`（会挡掉元目录）。**不动 vendor 一个字节**，改成把 kb-toolkit 设置里的值推给内嵌实例（写它自己的 data.json → 重载它的设置），默认值 = 空串 = 不排除任何目录。
- 设置页新增「创作看板 · 排除目录」（留空 = 整个笔记库；填了目录段才挡），改完当场推下去。
- 🔴 短路判据必须是「data.json 里有没有这个键」，不能是「取出来的值等不等于想要的」—— 没有这个键时读出来也是空串，就此 return 等于没压掉看板的内部默认，「默认整个库」会落空（本轮踩过一次，有断言守着）。
- 参数只在 `.base` 视图块 / 插件设置里，**两个 vendor 文件仍然字节等价**（断言抽回比对）。

**⑦ 一键补全（扫描全库，只加不删）**
- 设置页②组新增「一键补全（扫描整个知识库）」按钮，命令面板新增 `笔记自动化：一键补全`（同样走模块关闭即不注册的硬门控）。
- 流程：**先只读扫一遍**列出要动的笔记 → 弹确认框（列条数 + 前 8 篇要补什么）→ 确认后才逐篇写 → 落一篇操作日志报告。**不许静默批量改库。**
- 补法：空笔记套整套模板；有正文的**只在缺的位置补** —— 开头补 YAML、结尾补「关联笔记」双链。**原有正文一个字符不动。** 已经完整的笔记、模板库里的 `.md`、排除目录（含 `02_旧知识库`）一律跳过。
- 幂等：补过之后再扫 → 0 篇待补，不重复写。

**验收证据**
- `tests/run_r8.js`（137 断言）：事件总线三档延时实测（安静 180ms / 续期 < 800ms / 续期封顶）与端到端补全耗时 / 回滚收容（外来文件夹 + 新库子目录里的单篇，各归各位且原库复原）/ 输入框按键不落库·失焦落完整的串·页面不重画 / 首次重建不分代 vs 再次重建两个分代子文件夹内容各就各位 / 模板文件化 + 套用规则端到端（目录命中·标签优先·兜底）/ 看板默认整个库（含「看板自带默认是 99_Meta」的证伪前提）/ 一键补全（扫描口径·只读预演零写入·只加不删·幂等·确认门槛·报告落库·命令摘除）/ vendor 字节等价 / 静态守卫。
- 回归：r1~r7 606 断言 0 失败（r4b 110→127：撞名场景改为「服务层直喂 manifest」—— R8 之后 plan 正常路径已产不出撞名；r7 116→131：输入框语义改为「按键不落库 + 失焦落库」）；creation-board 729/729；bases-preview 45/45；**真文件沙盒 171/171（六场景 × 两遍，比 R7 多两个场景）**；真库快照 diff = 0（334 文件，增 0 / 删 0 / 改 0）。
- 🔴 沙盒抓到两个 jsdom 桩盖住的真 bug：① 收容移动没建目标位的**父目录**（`回滚保留-<戳>/<库根>/<子目录>/…` 这条路径上除了收容区本身全不存在）→ 真机上回滚直接 4 条 blocked、整条半途而废；② 看板「排除目录」的短路判据看错对象（见下）。两条都已修。

## 未发布 — R7（第二轮真机反馈 + 模板系统）

**⑤ 自定义知识库名称真的生效（根因级修复）**
- 根因：`rebuild.rootName` 被写死成 `"知识库"`，与 `paths.knowledgeBase` 是两个互不相干的概念 → 重建建出「知识库」，而插件自己的路由/排除/中心链全指着「01_新知识库」。**插件认不出自己刚建出来的库**。
- 现在**一个概念一个名字**：新建根名 = 库根名，由 `70_core_settings.js` 的 `normalize()` 在加载与改路径时无条件对齐（老 `data.json` 里的写死值会被就地纠正）。
- `classify()` 不再把根名当排除项（同名旧库必须可搬 —— 搬走它、再建同名空库正是这套流程的本意）；只有 `<根名>1`/`<根名>2` 这类**同名编号残留**才排除。
- `detectState` 判据改为「旧文件区 + 库根 + 顶层杂物」：真库里库根本来就在，不能拿它当「重建过」。新增 `rootWillMove` 说明「旧库将整体归档、再建同名空库」。
- `verifyRestored` 不再拿「根必须消失」当判据（同名前提前它自己就是搬运源，那条是自造假警报）。

**⑥ 新建笔记真的自动补全（两个根因）**
- 根因一：事件总线按**路径**去重时，后来的 `changed` 会把还没到点的 `create` 顶掉 → 真机「新建笔记」= `create` + `metadataCache.changed`，`tryCreateFill` 那一支**永远不执行**。改为按**种类集合**合并 + 取最长延时 + 派发时按 `create > rename > changed` 取优先级（每次路径仍然只派发一次，风暴照样合并）。
- 根因二：改了库根名之后，正在跑的 ② 还攥着老库根。新增 `ModuleRegistry.reapply()` + `AutomationModule.onConfigure()`，「改配置 → 就地重配」而不是等下次启动。
- 新增 `applySettingsChange()`：向导保存 / 设置页改路径 / 拨开关三条路走同一个收口（`refresh` 启停 + `reapply` 重配 + 重画设置页）。

**① 向导保存当场生效**
- 旧版只写 `settings`，模块实例与设置页都还是老的，Notice 还写着「请重新打开插件或重载 Obsidian 生效」。现在保存即生效，Notice 明确写「已保存并已生效」。

**② ②③ 模块关掉后栏目收起**
- 与 ① 一个规矩：关掉就整段收起，只留一句「模块已关闭 → 打开上方同名开关即可展开」，不再出现「开关关了选项还摊着」。

**③ 「查看路由条数」真响应**
- 点开弹表：每条路由的**可识别写法**（标签 / 属性值）+ 体检结论 ——「前缀不是当前库根的 N 条」「目标目录在当前库里找不到的 N 条」。这正是「路由此刻指着一个不存在的库」时最该看到的话。

**④ 拨开关不再甩滚动位置**
- 整页重画时用「启用模块」标题当锚点，重画前后把滚动容器补一个差值回去（幂等，再量一次差值为 0 就不动）。模块开关板块前后的位置保持不动。

**⑦ 创建补全模板系统（`36_services_templates.js`）**
- 内置四套：PARA 待整理（默认，与 R2~R6 写死的输出**逐字节一致**）/ 轻量收件 / 项目笔记 / 资料收集。
- 六个占位符：`{{title}}` `{{date}}` `{{folder}}` `{{center}}` `{{moc}}` `{{kb}}`；只替换认识的，写错的占位符原样留着（看得见才好修）。
- 设置页可切换、可改正文、可「保存模板」「另存为新模板」「恢复内置 / 删除此模板」。
- **从笔记提取模板**：拿一篇写好的笔记当样板，标题/日期/文件位置/中心链/返回链自动换成占位符，正文原样保留，提取结果可手改再存。

**验收证据**
- `tests/run_r7.js`：向导保存即生效 / 老配置根名对齐 / 事件合并语义（create 不被顶掉）/ **4 篇 0 字节新笔记现场复现并全部补全** / 反例（关开关·非空白·认不出中心）/ ②③ 收起与展开 / 路由弹表与体检 / 锚点补偿 / 模板渲染逐字节等价·覆盖·恢复·自建·提取·UI 全链路 / 静态守卫。
- 回归：r1~r6 452 断言 0 失败（r4 24→28、r4b 109→110、r6 109→110，期望值全部改为从配置现算而非写死「知识库」）；creation-board 729/729；bases-preview 45/45；真库快照 diff = 0。

## 未发布 — R6（真机试玩反馈修线）

**② 侧边栏入口**
- `addRibbonIcon`（图标 `library`，title「知识库工具集：打开控制台」）：装上插件即在左侧栏出现入口，点击打开本插件设置页；环境拿不到设置页 API 时退回一句 Notice，不静默失败。

**④ 模块开关守卫（老板报的 bug）**
- 根因：设置页拨开关只改了 `settings.modules`，**模块实例还在跑** → ① 关了照样能执行/回滚。
- `ModuleRegistry` 新增 `enable/disable/refresh/isActive`：拨开关**当场**启停模块，不必重载插件。
- `RebuildModule.onEnable` 守卫：模块没开就一条命令都不注册；`onDisable` 把已注册命令从命令表摘掉。
- 六个公开入口（`runPreview` / `runExecute` / `runRollback` / `runStatus` / `startConfirm` / `openLog`）首段一律 `requireOn()`，关掉后拒绝执行并说明原因 —— 命令面板、残留回调、别处代码都堵死。
- 设置页：① 关闭时整段操作区不再渲染（只留一句「模块已关闭」），②③ 关闭时各给一句提示。

**⑤ 操作日志笔记实体（`66_services_report.js`）**
- 预览 / 执行 / 回滚各落一篇**可读 Markdown**到 `<库根>/<元目录>/05_操作日志/`：YAML 前言（类型=操作日志、tags）+ 概览表 + 分节明细（搬运表带源/目标/类型/字节/sha256、目录清单、种子清单、冲突、排除、跳过、阻止、自检结论）+ 下一步 + 尾部双链回 `MOC_知识地图`。
- 报告位置按「笔记当前实际所在」选根：原库根 → 旧文件区里的原库根 → 新建根。执行报告写进新建根时登记为可逆（`op:"log"`）→ 回滚先删它，新建根才能干净移除；写在别处的中断报告属于**留档**，回滚不抹。
- 新增命令「知识库重建：打开最近一次操作日志」与设置页「打开报告」按钮；三种操作的 Notice 从一行变成多行明细（含报告路径）。
- 报告确定性：同输入 + 同一时刻 → 逐字节可复现（断言守着）。

**验收证据**
- `tests/run_r6.js`：侧栏图标链路 / 三层开关守卫（不注册·摘命令·残留入口拒绝）/ 设置页随开关消失与恢复 / 报告字段与确定性 / 真链路笔记实体 / 静态守卫（防口子被重新放开）。
- 回归：r1~r5 228 断言 0 失败；r4b 从 90 升到 109 断言（日志笔记单独记账，不再是"树被污染"）。

## 1.0.0 — 2026-09-17（R5 分享收尾）

**配置化**
- 顶层路径零硬编码：`01_新知识库` / `99_Meta` 只作为 `70_core_settings.js` 里的**默认值常量**出现一次，默认路由表、排除规则、MOC 链接全部由它们派生。
- 区域中心表（`00_Inbox`→`_收件箱` 等）不再写死前缀：只登记「中心目录名 + 中心页名」，前缀从**真实路径**回构 —— 库根改名后中心链自动跟随。
- 种子文件内容（MOC / 目录说明 / 各中心页）由结构模板的 `dirs` 与 `seedFiles` 推导。
- 新增 `reapplyPaths()`：改库根名 / 元目录名时重算派生字段；**只重算仍是默认值的字段**，用户手改过的路由表与排除规则原样保留。

**新增**
- **首次使用向导**：未走过时自动弹一次（点「以后再说」后不再自动弹，设置页可随时重开）。三步定目录名、模块开关，并现场检测库根/旧文件区/顶层待搬项。
- 设置页「知识库路径」组：根目录、元数据目录名可改，含向导入口。
- `README.md`（含旧插件迁移说明）、`CHANGELOG.md`、`versions.json`、`samples/示例库.zip`（空 PARA 结构 + 示例 `.base`，供开箱试用）。

**验收证据**
- `tests/run_r5.js`：路径配置化 / 中心表回构 / reapplyPaths 保守性 / 向导生命周期 / 版本一致性 / 示例库结构一致性。
- 回归：r1~r4b 212 断言 0 失败；creation-board 729/729；bases-preview 45/45；真文件沙盒 67×2；全库快照 diff = 0。

## 0.4.0 — 2026-09-17（R4b 执行 + 回滚 + 幂等）

- `VaultOps`（`62_services_vaultops.js`）：带 journal 逆操作的原子文件操作（`ensureFolder` / `createText` / `rename` / `remove`），撞名 blocked 不覆盖。
- `RebuildService`：`detectState`（fresh / partial / done）、`preflight`（硬门槛 + 提醒）、`seedContent`、`execute`（建旧文件区 → 搬顶层 → 建目录 → 写种子，每步落盘 journal，失败即停）、`rollback`（倒序逆操作）、`verifyRestored`（sha256 自证）。
- **幂等三层**：状态判定短路 / 条目级「已搬过」识别 / 重复确认不二次破坏。`already-rebuilt` 分支不覆盖上一份有效日志。
- 回滚删除走 `fileManager.trashFile`（1.13.7 按 `trashOption` 分流，不弹窗，asar 取证）。
- 4 条命令 + 确认弹窗（勾「坚果云已同步完成」才解锁）+ manifest/journal 落插件目录。
- 断言 90 项；真文件沙盒四场景 × 两遍 67 项。

## 0.3.0 — 2026-09-17（R4a 只读预览）

- 结构模板 JSON（从现库现状提炼，可导出导入）、dry-run 扫描报告、manifest 生成器（源→目标 + sha256）。
- 全流程只读：规划不落库，预览报告写 `rebuild-preview.json`。
- 断言 24 项。

## 0.2.0 — 2026-09-17（R3 Base 视图整合 + 样式收口）

- `creation-board` / `note-stream` 以**字节级内嵌**方式搬入 `vendor/`，`VIEW_TYPE` 不变 → 存量 `.base` 零迁移。
- `styles.css` 全部 CSS 变量化，裸色值清零（断言守着）。
- 断言 22 + 16 项；继承旧插件 729 + 45 项断言随字节等价自动通过。

## 0.1.0 — 2026-09-17（R1 骨架 / R2 笔记自动化）

- R1：三分法设置页 + 模块注册制（级联开关）+ 服务层抽取（frontmatter / router / mover / links / eventBus）+ 旧插件检测横幅。
- R2：创建补全（仅空白新文件）、移动同步、标签路由；`note-locator` `data.json` 一次性迁移；开新停旧。
- 断言 36 + 24 项。
