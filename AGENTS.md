## 这是什么

Obsidian 插件「知识库工具集」（id: `kb-toolkit`），三分法模块（boss 定版顺序）：

1. **① 知识库重建** — 一键生成知识库（dry-run 预览 → manifest → 执行 → 回滚，全链路带 journal）
2. **② 笔记自动化** — 创建补全 YAML/尾链 · 移动同步 · 标签路由（移植自 note-locator）
3. **③ 更多的 Base** — 创作看板 + 内容流视图（字节级内嵌 creation-board / bases-preview）

设置页顺序与模块顺序一致：先有知识库 → 再管笔记 → 最后 Base 统一呈现。当前版本 **1.0.0**。

## 目录结构与构建

```
kb-toolkit/
├── main.js            # 构建产物，勿手改
├── styles.css         # 构建产物，勿手改
├── manifest.json      # id/version/minAppVersion
├── versions.json      # version → minAppVersion（发布用）
├── README.md          # 面向使用者：安装/向导/旧插件迁移/安全底线/FAQ
├── CHANGELOG.md       # 面向使用者：每轮可验收交付
├── src/               # 源码（命名空间拼接，无打包器依赖）
│   ├── 00_prelude.js          # KB 命名空间 + define/service + globalThis.KB（供断言）
│   ├── 10_core_registry.js    # 模块注册制（isEnabled 级联：③ 是 base.* 的总闸）+ R6 enable/disable/refresh
│   ├── 15_core_quiet.js       # R9 静默窗口服务：重建/回滚期间让 ② 的事件处理整条让路
│   ├── 20_core_eventbus.js    # vault/metadataCache 事件按文件 debounce（R8：create 起步 180ms、续期封顶 800ms；R9：静默期两处闸门）
│   ├── 30_services_frontmatter.js
│   ├── 36_services_templates.js # R7 模板系统 + R8 文件层（模板=模板库里的 .md + 套用规则）
│   ├── 40_services_router.js  # 标签-目录路由 + 区域中心表（R5 起前缀由真实路径回构）
│   ├── 50_services_links.js   # 「所属中心」跟随目录 + 双链提取
│   ├── 60_services_mover.js   # 移动引擎（uniquePath + blocked 不覆盖）
│   ├── 62_services_vaultops.js# R4b 原子文件操作 + journal 逆操作（create/createFolder/rename/remove）
│   ├── 65_services_rebuild.js # ① 重建：plan/detectState/preflight/seedContent/execute/rollback/verifyRestored
│   ├── 66_services_report.js  # R6 操作日志：把三种操作生成可读 Markdown（挂 RebuildService.prototype，增量文件）
│   ├── 70_core_settings.js    # 🔴 全插件唯一的顶层路径默认值出口 + deepMerge/clone + normalize/reapplyPaths
│   ├── 75_core_settingTab.js  # 设置页（R16 三标签 + 模块头三层 + 帮助悬浮小窗 + 路径组 + 向导入口 + 旧插件横幅 + 重建按钮 + R7 模板区/锚点补偿 + R8 commitOnBlur/一键补全/套用规则）
│   ├── 76_core_settingModals.js # R7 设置页弹窗：路由表与体检 / 命名 / 从笔记提取模板；R8 通用确认框
│   ├── 80_modules_automation.js
│   ├── 82_modules_rebuild.js  # ① 命令 + 确认弹窗 + manifest/journal 落盘 + R6 报告落库（含 requireOn 守卫）
│   ├── 85_modules_base.js     # ③ 两视图模块（retire 旧插件 → 实例化内嵌类；R8 把 boardExclude 推给内嵌看板）
│   ├── 87_modules_wizard.js   # R5 首次使用向导（目录名 / 模块开关 / 现场检测；R7 起保存即生效）
│   └── 90_entry.js            # KbToolkitPlugin（onload：applySettings → 模块 → 侧栏图标 → 向导）+ R7 配置收口
├── vendor/            # creation-board.js（R11 起与独立版有意分叉：R11 Alt 拖动 → R12 拖动默认搬文件 + 板块 ⚙ 配置 + YAML/双链三态 + 板块拖动排序）/ bases-preview.js（仍与独立版字节一致）
├── styles_src/        # 样式权威源（cb.css / ns.css），build 时合并
├── samples/           # 示例库（示例库.zip + _sample_manifest.json + _sample_zip.json）
├── scripts/
│   ├── build.js               # node scripts/build.js → main.js + styles.css
│   ├── make_sample_vault.js   # 生成示例库（种子正文调插件自己的 seedContent）
│   ├── zip_sample_vault.py    # 打包示例库 zip（确定性时间戳，含空目录条目）
│   ├── audit_colors.py        # 颜色/选择器审计（样式轮用）
│   ├── gen_obsidian_vars.py   # 从 obsidian.asar 抽 CSS 变量白名单
│   └── obsidian_vars.txt      # 1127 个本体变量白名单（勿手改）
└── tests/             # run_r1..r15.js（stub obsidian + jsdom，全离线；聚合入口 run_all.js）
```

**构建 + 测试（改完必须全绿才算完成）：**

```bash
NODE="C:/Users/wwwzh/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
export NODE_PATH="C:/Users/wwwzh/.workbuddy/binaries/node/workspace/node_modules"
cd .obsidian/plugins/kb-toolkit
"$NODE" scripts/build.js
"$NODE" tests/run_all.js 3   # r1~r15 共 1022 断言 / 失败 0（×3 遍稳定）
# 旧套件回归（原件未动应恒绿）：
"$NODE" ../../../.workbuddy/tmp/verify_creation_board.js   # 729/729
"$NODE" ../../../.workbuddy/tmp/verify_bases_preview.js    # 45/45
# 沙盒真文件演练（重建执行/回滚必须过这一关）：
"$NODE" ../../../.workbuddy/tmp/sandbox_r4b/run.js          # 229/229（七场景 × 两遍）
# 实验库副本上再演一遍（R9 起；先用 Python 把库拷进工作区，node 读不了库外路径）：
python ../../../.workbuddy/tmp/preplay_lab.py               # 247/247（229 + 真库副本 18）
# 示例库（改了模板/seedContent 后必须重跑，run_r5 的 I/J 段会复算比对）：
"$NODE" scripts/make_sample_vault.js
python scripts/zip_sample_vault.py
# 全库未被碰的证明（快照在 .workbuddy/backup/kb-toolkit-R1-2026-09-17/）：
python .workbuddy/backup/kb-toolkit-R1-2026-09-17/snapshot_vault.py --check
# 同步进桌面实验库（只覆盖 main.js/styles.css/manifest/versions；R12 起不再补 creation-board/main.js）：
python .workbuddy/tmp/sync_plugin_to_sandbox.py
```

测试跑的是 `main.js`（构建产物），**改 src 后必须先 build 再 test**。

## 铁律（违反 = 事故）

1. 🔴 **VIEW_TYPE 原样保留**：`creation-board` / `note-stream`。改一个字，全库存量 .base 变「不支持的源」。
2. 🔴 **vendor/ 内嵌**：测试抽回字节比对 `main.js 内嵌段 == vendor`。R11 起看板 vendor 与独立插件**有意分叉**（新增 Alt 拖动搬文件），**R14 起 bases-preview 也分叉**（徽章上限 2 个 + bns-chip-more）；r3/r8/r9 的比对断言已改成「creation-board 分叉 + 含 moveCardToFolderOfCard；bases-preview 分叉 + 含 bns-chip-more」。改看板/内容流逻辑 → **直接改 vendor/*.js**（独立版已停用等收编，不再反向同步）。
3. 🔴 **每轮动真库前**：`snapshot_vault.py` 跑基线/对比；备份到 `.workbuddy/backup/kb-toolkit-R<N>-<日期>/`（含 `_manifest.json` sha256）；回退脚本默认干跑。
4. 🔴 **测试期望值动态推算**（从真实文件/配置算），不写死；stub 桩必须比真机逼真（见坑清单）。
5. **一次只改一个轮次的范围**；搬运轮不改逻辑，改逻辑轮不搬运。
6. 样式里**不允许出现 var(...) 之外的裸色值**（r3b 断言守着）；变量名必须在白名单或样式内自定义。
7. 🔴 **动真库的三条门槛**（R4b 起）：确认弹窗 + 勾选「坚果云已同步」+ manifest 校验通过。少了任何一条，代码自己会拒绝执行。
8. 🔴 **回滚的底线**：绝不覆盖原位置已有内容；只删「本轮自己建的」且 sha256 未变的文件；目录非空就保留。批量删除一律走 `fileManager.trashFile`（尊重本体「删除文件」设置），**不要**用裸 `vault.delete`。
9. 🔴 **顶层路径字面量只允许出现在 `70_core_settings.js` 的默认值出口**。`01_新知识库` / `02_旧知识库` / `99_Meta/` 等一律由 `DEFAULT_ROOT` / `DEFAULT_META` / `DEFAULT_LEGACY` 派生（routes / excluded / mocLink）。`run_r5.js` 的 A 段会剥注释后全量扫描，其他文件出现一个就红。
10. 🔴 **`plugin.settings` 必须与 `DEFAULTS` 深拷贝隔离**：`deepMerge` 用 `clone()` 起底，绝不让 settings 与 DEFAULTS 共享对象/数组引用 —— 否则向导一改路径就把默认值就地改了（R5 真踩过）。
11. 🔴 **模块开关 = 硬门控，不是提示**（R6 起）：关掉某模块必须同时做到三件事 —— ①命令不注册（`onEnable` 首段守卫）/ 已注册的摘掉（`onDisable` → `removeCommands`）；②模块的每个公开入口首段 `requireOn()`，关掉后一律拒绝并说明原因（命令面板 / 残留回调 / 别处代码全堵死）；③设置页对应的操作区不再渲染按钮。拨开关必须调 `registry.refresh()` 即时生效，**不许要求用户重载插件**。
12. 🔴 **报告类写入属于「库内产物」**：预览/执行/回滚会往 `<库根>/<元目录>/05_操作日志/` 写一篇 Markdown。凡是"除报告外零改动"的断言，要显式剥离 `05_操作日志/` 再比对（`run_r4b.js` 的 `onlyLogsExtra` / `coreTree`），**不要**为了让树相等就把报告塞回插件目录 —— 老板明确要的是「笔记实体」。
13. 🔴 **新建根名 = 库根名（R7）**：`settings.rebuild.rootName` 是 `paths.knowledgeBase` 的**派生字段**，由 `normalize()` 在 load 与改路径时无条件对齐。**不许**给它单独的 UI 或 override 出口 —— 一个概念两个名字的代价就是「插件认不出自己刚建出来的库」（R6 的真事故）。
14. 🔴 **事件总线按「种类集合」合并（R7）**：同一路径的 `create` 绝不能被随后的 `changed` 顶掉。真机新建笔记 = `create` + `metadataCache.changed`，只要把后者当成覆盖，`tryCreateFill` 就永远不执行（老板那 4 篇 0 字节笔记的根因）。改 `enqueue` 时必须保住 `pickKind()` 的 `create > rename > changed` 优先级与"取最长延时"。
15. 🔴 **配置变更只有一个收口**：向导保存 / 设置页改路径 / 拨开关三条路都必须走 `KB.modules.applySettingsChange(plugin)`（= `registry.refresh()` + `registry.reapply()` + 重画设置页）。谁绕过它，谁就会贡献一个「存了像没存」的 bug。
16. 🔴 **设置页的文本输入框一律走 `commitOnBlur(t, apply)`（R8）**：Obsidian `TextComponent.onChange` 挂在 **`input`** 事件上 = 每按一个键回调一次。回调里若调 `applySettingsChange`（默认 `repaint:true`）就会**重画整页** → 输入框元素被换掉 → 焦点丢 → 下一个字符落空，症状是「一次只能打进去一个字符」。要落库又要不重画，就传 `{ repaint: false }`。
17. 🔴 **事件总线的延时是「自适应续期」不是「取最长」（R8）**：`wait = min(old.delay + 本次事件的 delay, capFor(kinds))`。旧的 `max(old.delay, d)` 语义是「每来一个事件就把 deadline 重推 800ms」，白等。「安静的新建」= 只来一条 `create` → 180ms 就补完。续期量必须用**事件自己的 delay**，别用固定步长（否则显式传小延时的调用方行为不可预期）。
18. 🔴 **回滚的收容阶段（R8）**：回滚前先把「本轮新建目录里不属于本轮的东西」挪进顶层 `回滚保留-<戳>/`（保留原相对路径），否则新根非空 → 删不掉 → 回滚半途而废。只扫 `op:"mkdir"` 的目录，**绝不扫旧文件区**（那里躺着正等着搬回原位的老库）。收容是移动不是删除 —— 老板重建之后写的笔记一篇都不许丢。
19. 🔴 **收容/搬运到「新建的顶层文件夹」下时必须逐级建父目录**：`<收容区>/<库根>/<子目录>/…` 这条路径上除了收容区本身全都不存在。jsdom 桩的 `rename` 不校验父目录，会把这个洞盖住；真文件沙盒一跑就现形（`_quarantineMove` 里已补 `ensureFolder(parent)`）。
20. 🔴 **内嵌看板的默认值要「显式压掉」而不是「短路跳过」**：creation-board 自带 `excludeFolders: "99_Meta"`。`applyBoardExclude` 的短路判据必须是 `hasOwnProperty(d, "excludeFolders")`，**不能**是「读出来的值等不等于想要的」—— 键不存在时读出来也是空串，就此 return 等于没压掉看板的内部默认，「默认整个笔记库」直接落空（R8 踩过，有断言守着）。
21. 🔴 **一键补全「只加不删」**：空笔记套整套模板；有正文的只在缺的位置补（开头 YAML / 结尾双链）。写之前必须过确认门槛（`runAutofill({confirmed:false})` 只回清单，一个字节都不写）；模板库目录、排除目录一律跳过。
22. 🔴 **重建/回滚期间必须开静默窗口（R9）**：`KB.services.quiet.begin/end` 包住 `svc.execute` / `svc.rollback` 全程。不开窗的后果是**回滚自己把自己的收容推翻** —— 阶段 A 把外来户 `rename` 进 `回滚保留-<戳>/`，这条 rename 事件喂给 ②，路由照着笔记的 `文件位置` 又把它搬回新库 → 目录非空 → 回滚卡住（第 5/6/7 条同一个根因）。闸门要**两处**：`enqueue` 入队时丢、定时器到点时再校验一次（事件可能在关窗前排队、关窗后到点）。关窗余量 `SETTLE_MS(1200ms)` 必须 > 事件总线封顶延时（800ms），且关窗用 `end()` 把放行时刻往后推，别立刻放行。
23. 🔴 **`op:"move"` 的幂等分支也要写进 journal（R9）**：源已不在原位、目标位已有同名（= 上一次执行搬过）**不是**「无事发生」—— 旧实现只记一条跳过，journal 里没有逆操作，回滚就**搬不回来**（自检报「缺件」）。照样登记 `op:"move"` + `preexisting:true`。反之，「源还在 + 目标位有同内容副本」这种**本轮确实没搬**的，不许写逆操作。
24. 🔴 **同一轮里 `execute` 要继承上一份未回滚 journal（R9）**：第一次执行中途失败 → 第二次执行若新建一份把上一份**覆盖**掉，第一次记的 `mkdirOld`（旧文件区本轮建的）就丢了 → 回滚删不掉那个空目录、留残渣。判据：`carry` 存在、状态不是 `rolled-back`、库根一致；按 `op + (path||from)` 去重，**先到的胜出**（第一次的真搬记录比第二次的 `preexisting` 更完整）。
25. 🔴 **视图注册用真生命周期（R9）**：`Plugin.registerBasesView` 把 `deregisterView` 挂在 Component 的 `_events` 上，**只有 `load()`/`unload()` 才跑**。内嵌实例一律 `inst.load()` / `inst.unload()`，别只调 `onload`/`onunload`（那样 `deregisterView` 永不执行 → 再注册撞名 → 弹「A view with this ID already exists.」）。注册前再 `deregisterView` 同名 id 兜底。
26. 🔴 **报告里的「真搬成」要排除 `preexisting`（R9）**：「已在目标位、本次没动」的那些只写日志供回滚用，算进「真搬成」就又变成把「计划」说成「已搬」。单列成「已在目标位」一节。
27. 🔴 **改名类操作要在 `rename` 之前抄下原位路径（R9）**：`fileManager.renameFile` 会**就地**把 `file.path` 改成目标位，事后读 `file.path` 得到的就是新路径（收容表的「原位置/保留位置」两列会一模一样，`from === to`）。
28. 🔴 **执行不能盲信预览落盘的 manifest（R10）**：`runExecute` 若直接复用 `rebuild-manifest.json`，预览之后改的配置（典型：库根改名）对执行完全不可见 —— 老板 15:14 改名、15:17 执行，建出来的还是旧名。manifest 带 `cfgFingerprint`，执行前重算比对，不一致整体重算。**顺序：先验结构（`validateManifest`）再比指纹**，反了会让「坏 manifest 必须拒绝执行」失效。
29. 🔴 **设置页的模块开关只重画本段（R10）**：段落各自装在固定 `div` 里（`renderFns` + `sectionBoxes`），拨开关 `empty()` + 重画那一段，**不要**整页 `display()`（一整页重画 = 浏览器甩滚动位置 + 焦点丢）。渲染函数用参数名 `containerEl` 遮蔽外层变量，段内代码可零改动搬进去。锚点补偿 `keepAnchor` 只留给按钮触发的整页重画。
30. 🔴 **配置落盘只能在收口里做（R10）**：`applySettingsChange()` 必须先 `saveSettings`。设置页三处（路径 / 开关 / 看板排除）都因「有 apply 就跳过自己的 saveSettings」而漏落盘 → 改动只活在内存、重载即丢。
31. 🔴 **模板/种子目录要挂 `manifest.root`，不是 `settings.paths.knowledgeBase`（R10）**：再次重建时新库是 `<库根>1`，旧库被原地保留 —— 照 settings 算会把模板写进旧库，父目录还可能不存在（r8 D2 现场直接 failed）。
32. 🔴 **空数组也是真值**：`plugin.legacyFound || 现查` 这种短路写法，一旦 onload 存了 `[]` 就永不刷新（旧插件横幅再也不出现）。缓存型字段要用长度/内容判断，或干脆每次现查。
33. 🔴 **rename 事件 = 手动搬移，永不回弹（R11）**：`vault.on("rename")` 走 `handleManualMove`（属性跟随新目录 + 中心链跟随），**绝不**喂给路由 `handle()` —— 旧实现里 rename 也跑路由，属性还写着旧目录 → 拖完立刻被搬回原位（「目录里拖不动」的根因）。自动归位只剩两条通路：`create` / `changed`。
34. 🔴 **路由「属性优先，属性空才看标签」（R11）**：旧「镜像规则」（属性=当前目录镜像时让位 tags）会跟手动拖动打架 —— 拖完属性同步成新目录，下一次 changed 又被标签搬走。改版后属性非空就以属性为准（镜像 = 已在目标 → null）；**「认不出」返回 null，不退回标签**。
35. 🔴 **设置页模块段「不收起，置灰」（R11）**：拨开关只重画本段仍不够 —— 段落收起本身就会让下方内容跳。模块关掉时**照常渲染整段**（按钮占位）+ `.kb-module-disabled`（opacity + pointer-events:none）+ 一行「已关闭」说明。硬门控不变：命令不注册、按钮点不动。「不可执行」靠禁用保证，不靠隐藏。
36. 🔴 **测试帮手自己也可能有 bug**：r6 的 `btnTexts` 曾「每层 querySelectorAll + 递归」把同一颗按钮按祖先深度重复计数 —— 以前断言全是 0 没暴露。修帮手时先想想**为什么以前没发现**（多半是断言恒为 0/空跑）。
37. 🔴 **内嵌插件会自己 `addSettingTab`**（R12）：内嵌看板/内容流本体自带 `addSettingTab`，导航名取自内嵌 manifest.name → 第三方插件列表出「幽灵设置页栏」。内嵌实例 `load()` 之前必须过 `suppressSettingTab()`（打标 + addSettingTab 换空操作）。新增内嵌本体时同理。
38. 🔴 **内嵌插件的 data.json 落点要收进 kb-toolkit 自己的目录**（R12）：旧版把看板 data.json 写到 `.obsidian/plugins/creation-board/` —— 目录在但没 manifest.json，插件列表不显示，**但 OneDrive 会把整个目录同步复活**（R11 清了一次又长回来）。现在落 `.obsidian/plugins/kb-toolkit/embed-creation-board/`（内容流 → `embed-bases-preview/`）。给内嵌本体新增任何落盘位置前，先确认路径不会在 `.obsidian/plugins/` 下自成一个「目录在 = 已安装」的假插件。
39. 🔴 **「全部」板块搬不动是结构性限制，不是 bug**（R12）：聚合视角的卡片没有「源文件夹板块」可参照，拖不出目标目录。别试图给它编一个默认落点 —— 老板要的是「能拖」，答案在文件夹板块里拖或交给 rename（铁律 33）。
40. 🔴 **同一文件的多个 Edit 绝不并行发**（R12 真踩，两条主线同翻车）：同一轮消息里对同一文件发多个 Edit，每个都基于**改动前的原文**做替换再整文件写回 → 后写的把先写的整个吃掉，工具还**每个都报成功**。症状：`grep` 核对时发现一半编辑「凭空消失」。一个文件一轮只发一个 Edit；要改多处就串行发、或一次 Edit 带够上下文。改完必须 grep 复核关键行真的在盘上。
41. 🔴 **测试 prelude 的 polyfill 只补了 createEl/empty**（R13）：src 里用 `createSpan` 会让所有旧测试的段落渲染中途崩掉（paintSection 吞错继续跑 → 后半段元素凭空消失 → 断言全歪）。src 侧一律用 `createEl("span", …)`；真要在桩里加新 API，先想清楚 15 个测试文件谁会路过这段。
42. 🔴 **命令面板只留 4 条高频（R13）**：open-settings（插件总入口）+ rebuild-preview / rebuild-rollback / rebuild-open-report。**「执行」没有命令入口** —— 危险操作必须在设置页走勾选确认弹窗；新增命令前先问「这个动作在设置页是不是已经有带状态的按钮了」。
43. 🔴 **stub 的 Setting 根元素已带 `setting-item` 类**（R13 保真修正）：搜索过滤、样式类断言都靠它。给设置页加新的 DOM 结构性功能（过滤/折叠/分组）时，过滤对象一律选 `.setting-item`，别自己发明容器类再靠它过滤。
44. 🔴 **styles_src/*.css 是动态枚举合并**（R13）：新增样式文件直接放进去即可，build.js 与 r3/r3b 的头注释、选择器守恒断言都是动态算的 —— 但**变量白名单照旧**（--hr 不在白名单，用 --background-modifier-border），新变量先查 `scripts/obsidian_vars.txt`。
45. 🔴 **UI 文案是纯文本，不渲染 Markdown**（R14）：设置页/面板里写 `**加粗**` 会显示成字面星号。同理 CSS 栅格要「空轨道坍缩」用 `auto-fit`，`auto-fill` 会在板块少时留一大片右侧空白（R14 丑的主因）。
46. 🔴 **verify_creation_board.js / verify_bases_preview.js 测的是「冻结基线」**：R17 起三个独立插件已退役（归档 `.workbuddy/backup/retired-plugins-2026-09-19/`），这两个套件改成「原地找不到就读归档」—— 它们**不再代表出货代码**（出货的是 kb-toolkit vendor），红了先看是不是这类陈旧期望。存量 718/11（独立版 R13 的有意变更没同步旧期望）。⚠️ 它们的 vault 桩会把「文件是否存在」透传到**真库** → 断言别依赖真库里有没有同名笔记（R17 踩过）。
47. 🔴🔴 **复写病（R15 实锤 / R16 抓到现行；2026-09-18 复查：OneDrive 已排除，真凶待查）**：整文件被**叠写两遍**（旧版在前、新版在后）。已咬过 7 个文件 —— R15 的 scripts/build.js、src/15_core_quiet.js、src/20_core_eventbus.js、src/40_services_router.js、tmp/sandbox_r4b/run.js；R16 的 src/36_services_templates.js、src/60_services_mover.js。症状 = `fs already declared`、模块注册两次、**编辑落在前一份死代码上（改了不生效却全绿）**、断言假绿。
   - **哪份生效**：`KB.reg.forEach` 把**所有**工厂都跑一遍，`KB.service` 后注册覆盖前注册 → **后一份才是真在跑的**，前一份是死代码（36 号的前一份就缺 R15 的 `hasOwnProperty` 修复）。这也意味着改文件时要确认改的是**最后一份**。
   - **取证套路**：拿 `.workbuddy/backup/kb-toolkit-R<轮>/` 逐轮比对（`grep -c 'KB.define("' <备份>/src/*.js` + 字节数），能定位复写发生在哪两轮之间 —— R16 就是这么查出「发生在 R15 收工到 R16 开工的**空档期**，不是写代码写出来的」。⚠️ 备份副本在 `.obsidian/` **打头的隐藏子目录**下，`ls` 默认看不见（别误判成备份空了），用 `find <备份目录> -type f | wc -l` 数。
   - **防复发已自动化**：`tests/run_r16.js` I 段 7 条断言（每文件 define ≤1 / 总数 = 文件数−1 / 无整段复写 / src 无临时文件残留 / main.js define 次数与 src 一致 / 只实例化一次 / main.js ≈ src+vendor），`run_all.js` 每轮都跑，不用再人肉 grep。
   - **恢复套路**：`dedupe_src.py`（`.workbuddy/tmp/`，`--dry` 预演）按「保留最后一个 define 块」切；或与备份 cmp 定位分界行，保留含最新修复的那一份。
48. 🔴🔴 **Templater 模板绝不原样落盘（R17 报障：新建笔记标签没创建）**：老板把「创建补全模板」指到了模板库里的 `T_*.md` —— 那是 Templater 脚本（首行 `<%* … %>---`），而本插件只认自己的 `{{占位符}}`，于是整段模板被写进新笔记：`---` 不在第 1 行 → Obsidian 不认前言 → 标签 / 属性全废。**Templater 的 `on_file_creation` 只在「剥前言后正文为空」时才套目录模板（先等 300ms）** → 本插件先写脏数据，它就不再接手（抢写，谁先谁定局）。
   - **硬规矩**：模板文本里含 `<%` → 必须先交给 Templater 求值（`parse_template({template_file, target_file, run_mode:0, active_file}, 全文)`，run_mode 0 = CreateNewFromTemplate）再落盘；求不到值就**拒写**（宁可空着），产出的文本里**不许再有 `<% %>`**。收口函数 = `36_services_templates.js` 的 `materialize()`，创建补全与一键补全都要过它。
   - **目录让路**：目录已配在 Templater 的 `folder_templates`（且开着触发）→ 本插件整个放弃这篇（`stats.deferred` 计数），别和它抢。
   - 离线造桩：`tests/run_r17.js` 里的 `fakeTemplater()`（可切 `throwAt` / `echoRaw` 造异常与兜底路径）。
49. 🔴 **改设置页排版要连带改 6 套断言（R18 踩过）**：设置页的结构被 8 个套件盯着 —— 5 个老套件（r2/r5/r6/r7/r8）拿**文案**当锚点，r13/r14/r16 拿**结构/class**当锚点。照效果图一动，连带红的有：① 栏目名从卡片内 `h5` 挪到卡片外 `.kbt-lb`（r16 D 段、r14 C3；`.kbt-group` 也不再是卡片，外框挪到 `.kbt-card`）；② 核心操作「一行三钮」→「三行三钮」（r13 D、r14 A7：`.kbt-core-actions` 由 Setting 行变成卡片 → **不再有 `_setting`**，按 `_buttons` 找会 null 崩）；③ `details` summary 由「高级：xxx」统一成「高级」两字（r5/r6 拿「知识库路径」当锚点 → 改锚「知识库根目录」）；④ 行名精简（「创建时自动补 YAML 与尾部双链」→「创建时自动补全」，r2/r7）；⑤ 「创作看板 · 排除目录」→「排除目录」（r8）；⑥ 搜索命中他页**不再自动跳**（r16 H 段改判「本页计数 0 + 提示条可点」）。**改前先 grep 旧文案/旧 class，一次改齐**，别等全量报红再逐个补。
50. 🔴🔴 **样式改「原生控件的补充态」前，先去 asar 把原生 CSS 抓出来（R19 报障：开关圆点是歪的）**：老板说开关里的小圆圈「歪的」。直觉会去量几何 → 反而误判（我先用 PIL 测 bbox，结论是「椭圆」，错的）。真根因在 `D:\01_ProgramFiles\办公效率\obsidian\resources\obsidian.asar` 的 `.checkbox-container`：原生 `::after` 自带 `margin: var(--toggle-s-border-width) 0 0 0`，且**关闭态**还有 `transform: translate3d(var(--toggle-s-border-width),0,0)`。旧插件 CSS 只覆盖了 `top/left/width/height`，没清这两条 → 圆点被顶下去、还被右推。**修法 = 显式 `margin:0; transform:none;`**（开态再给 `translateX(轨道宽 - 2×边距 - 圆径)`），而不是去调 top/left 凑。同一坑还有第二类：`.kbt-switch` 加 `border` 后要顺手确认 `padding` 不把开关挤变形。**教训：凡是「用 CSS 去改 Obsidian 原生组件外观」的活，先取证原生规则，别靠肉眼量像素。**
51. 🔴 **「让路」不等于「撒手」（R19 报障：「文件位置」属性整个消失）**：R17 为了不跟 Templater 抢写正文，在「目录被接管」时直接 `return false` 整篇放弃 —— 结果连**属性**都没人补了，老板原来「属性面板里选文件位置 → 笔记自动归位」的功能整个消失。正解 = **按写入面拆分让路粒度**：正文让给它，属性（`processFrontMatter`，只加不覆盖）留给自己。做同类「退让」改动时先问一句：我退的是整篇，还是只是它要写的那一部分？另外补属性时值要**留空** —— 路由判定是「文件位置非空则以它为准」，填成当前目录会把「按标签归位」这条路掐死。
52. 🔴 **测试里「等事件落地」的时长必须按事件总线的合并窗口算，别拍一个数（R19 踩过）**：`tests/run_r19.js` 的 `newNote()` 起初只 `sleep(120)`，而 `core/eventbus` 把同路径的 `create(180) + changed(180)` 合并 → **360ms** 才派发 → 断言读到的是「什么都没发生」，表现为「源码明明写了却假红」（当时还去怀疑桩对象身份，白费一轮）。**正确做法：从 `EventBus.DEFAULT_DELAY` / `MAX_WAIT` 反推最坏等待**（r17 用的是 400，r19 用 450）。同理，**异步渲染出来的内容**（如 rebuild 页状态栏要 `await detectState()`）也要在断言前留一次等待，否则计数恒为 0。

53. 🔴🔴 **源码级正则断言抓不到「改完当场抛异常」—— 内嵌 Bases 视图要补一层「真 DOM 冒烟」（R20 立）**：`run_r12`/`run_r13`/`run_r15`/`run_r20` 对 `vendor/creation-board.js` 都是**读源码用正则断言**，因此把 `renderPanel()` 改写成调用 `this.addGroup(...)` 这种「函数名写错 / 少写一个参数」的错，**正则全绿、真机一开面板就崩**。R20 的 `tests/run_r20b.js` 就是补这个洞，玩法（可复用）：
   - 取内嵌实例：`require("main.js")` → `globalThis.KB.modules.CreationBoardPlugin` 是**类**（build.js 把 vendor 包成 IIFE，末行 `KB.modules.<Name> = module.exports`）。
   - 取视图工厂：`new Plugin(app, {id:"creation-board", dir:"…"})` → `inst.data = {}` → `await inst.load()` → **桩** `Plugin.registerBasesView` 会把 `{id, def}` 推进入 `inst._basesViews`（真机走 `app.internalPlugins` 的 bases）→ `def.factory(ctrl, host)`。
   - 视图**不从库读数据**：`this.sections` 来自 `this.data.data`（Bases 结果），所以必须手喂条目 —— 形状 `{ file:{path,name,basename,extension,parent:{path},stat:{mtime}}, frontmatter, getValue(id){} }`；只往桩的 `vault.create` 里灌文件是**没用的**（会渲染成「没有匹配的笔记」空态）。
   - 配置**必须走 `v.config`**（`{get/set/getOrder/getSort/query:{save}}`）再调 `v.repaint(false)`：`repaint` 会 `loadSecs()` 把 `this.secs` **从配置覆盖掉**，手动赋 `v.secs = [...]` 会被冲掉。
   - 桩的 `Element.prototype.createEl` 记得处理 `opts.type`：仓库里几个套件的 polyfill 只认 `text/cls/attr`，于是 `createEl("input",{type:"checkbox"})` **拿不到 type 属性**，`querySelector("input[type=checkbox]")` 永远空 → 断言假红/假绿。
54. 🔴 **自建开关（不走 `Setting.addToggle`）一定要带 `:has(input:checked)` 兜底（R20 踩到坑边）**：`.checkbox-container.is-enabled` 这个类是 Obsidian 的 `ToggleComponent` 自己加的；插件里若是**手搓** `<label class="checkbox-container"><input type="checkbox">`（R20 看板面板就是），`is-enabled` 永远不出现 → 开关点了不变色。kbt.css（R19 设置页）与 cb.css（R20 看板面板）都靠这两条兜住：
   ```css
   .x .checkbox-container:has(input:checked) { background: var(--interactive-accent); }
   .x .checkbox-container:has(input:checked)::after { transform: translateX(15px); }
   ```
   位移量 = 轨道宽 − 2×边距 − 圆径（34−2−15−2 = 15）；并且仍要显式 `margin:0; transform:none`（见铁律 50 的原生 `::after` 那两个默认值）。
55. 🔴🔴 **DOM 里读回来的数字全是字符串 —— 别喂只认 `number` 的转换函数（R21 真 bug，被 `run_r20b` 抓住）**：`vendor/creation-board.js` 有个模块级 `num(v, dflt) { return typeof v === "number" && isFinite(v) ? v : dflt; }` —— 它**不解析字符串**。R21 写「宽度拉杆」时直接 `num(rg.value, 240)`（`input[type=range].value` **永远是字符串**）→ **恒回 240**，于是拖动预览、轨道填充百分比、松手落盘**全被钉死在 240**；而源码级正则断言全绿（正则只看到「写了 `num(rg.value)`」，看不到它恒等于 dflt）。修法 = 照本文件 `optNum` 的写法自己兜一层：
   ```js
   const wnum = (s) => { const n = parseFloat(s); return isFinite(n) ? n : 240; };
   ```
   **通用教训**：凡 `.value` / `dataset.*` / `getAttribute()` 这类 DOM 出口，一律 `parseFloat` + `isFinite` 兜底；`num()` 只留给**已经在 JS 里是 number** 的值（如 `optNum()` 的返回）。这条也再证了铁律 53 —— 「表达式写对了但语义错了」这类错**只有真 DOM 冒烟能抓**，所以新控件务必在 `run_r20b.js` 里补一段真点。
56. 🔴🔴 **控件「换台面」（从原生视图选项搬进自绘面板）必须进 `computeSig()` —— 否则拨了不重绘（R23）**：`onDataUpdated()` 里 `if (sig && sig === this.sig && this.renderedOnce) { this.updateBar(); return; }` 会**短路**。原生面板那一路是「Bases 改 config → 重新触发视图」；自绘面板这一路走 `cfgSet(key,v)` + `repaint(false)` 当场重绘 —— 可**只要 sig 不认这个键，之后每一次 `onDataUpdated()` 都会认定「没变化」**（R23：K_PROS_OPEN 就漏在 sig 外）。判据极简：**凡是能在 ⚙ 面板里改、又影响卡片渲染的键，必须出现在 `computeSig()` 的 parts 里**（K_WIDTH / K_FILL / K_BODY / K_CHARS / K_PROS_OPEN …）。这条同样只能靠 `run_r20b` 那一刀验 —— 拨开关 → 核 `.cb-props` 当场带没带上 `.cb-pros-fold`（源码正则看不见 sig 里漏了谁）。

57. 🔴🔴 **「只对这块生效」的设置要有「作用域一眼可见」的设计（R24）**：同一个面板里混着**两种作用域**的开关时，**绝不能长得一样** —— 老板的原始报障就是「板块 ⚙ 打开的是整个看板的设置面板、只是顺手定位到一行」，于是「改了不知道改的是谁」。
   - 规约：**只对这一块生效**的项 → **三态**（`继承` / `开` / `关`，复用面板那套 `.cb-seg`）；**整个看板共用**的项 → **打勾项**（`.cb-ctx-chk` + `✓`）。
   - 每组的组头必须写清作用域：`只对「<板块名>」` / `整个看板`。这一条是**防呆**，不是装饰。
   - 落点判定：`secConfigurable(sec)` = 有 `spec` + 有 `srcIndex` + 非 `native` + 非 `isFormulaValue`。**收容所算「配置给的板块」（可以单设、可以改名）**，`secIndexOf()` 对它走 `source === "catchall"` 那条；别凭直觉把它归到「自动分组」那类去（R24 我自己就写错过一次断言）。
   - 判完要**真验一次隔离**：改 A 板块 → 核 B 板块的字段没被连坐（`run_r20b` 就有这一条）。
58. 🔴 **板块级设置的三个具体坑（R24）**：
   - **折叠状态的键就是板块名**（`foldKey`）→ **改名必须迁移** `K_FOLD`（含 `旧名/子板块名` 前缀），不迁就是「改个名折叠全乱」。而**手动顺序**的键是「数据源:路径」（`manualKeyOfSpec`），与名字无关 —— **改名时不许动它**，动了反而错位。
   - **右键菜单里的「点完还要看结果」项不能走统一的 `run(fn)`**：`run()` 是先 `closeSecMenu()` 再执行 → 「显示帮助」就地展开的说明块会被连窗一起摘掉（R24 真 DOM 冒烟抓到）。要么单开一个 `itemStay()`（同款外观、不关窗），要么把「展开说明」做成独立区域。
   - **跟手浮层的兜底尺寸要拿真引擎校准**：真浏览器里 append 之后 `getBoundingClientRect()` 是同步可读的（正常路径用真 rect）；只有量到 0 才退兜底。R24 真引擎实测右键窗高 **390.6 px >** 旧兜底 **380** → 兜底抬到 **250×420**，否则退化路径下窗底会探出屏。
59. 🔴 **新增「只有 CSS 能验」的外观项时，补一层「真引擎几何 + 像素统计」（R24 立）**：分隔线、输入框边框、浮层定位这些**在 DOM 里读不出对错**（jsdom 的 rect 恒为 0）。可复用套路（`tmp/dump_r24_board.js` → `tmp/render_r24.py` → `tmp/check_r24_shots.py`）：
   - **① dump**：用**出货代码**（`main.js` 内嵌看板）在 jsdom 里真起视图 → 真开好浮层 / 真进入改名态 → `outerHTML` 原样落盘（**别手抄 DOM**，手抄就是 mock，会掩盖结构错）。
   - **② render**：把 fragment + 真 `styles_src/cb.css` 塞进 harness 页，变量用效果图里那份真 Obsidian 默认值；`Chrome --headless=new --dump-dom` 把探针结果打出来 + `--screenshot` 出 PNG。⚠️ harness 必须做**变量体检**（cb.css 用到的 var 在 harness 里一个都不能缺，否则整条声明被丢弃 → 量到的几何是假的）。
   - **③ 像素统计**：本模型读不了 PNG → 用 PIL 数「分隔线那一行 vs 背景行」的亮度差、「输入框框内命中强调色的像素数」、「窗内 vs 窗外同高度的均值差」。**自校准**：在预期位置 ±6 行里找最暗/最亮那一行，别写死 y（截图尺寸与 `clientWidth` 会差十几像素）。
   - 断言要按**真引擎量到的值**写（例如实测窗高 390.6），别写「应该」。同时保留 `--dump-dom` 的 JSON 探针（`tmp/r24_probe.json`）供回溯。
60. 🔴🔴 **往「shrink-to-fit 浮层」里塞控件前，先算它的 max-content（R25 立）**：右键菜单是 `position:fixed` 且**不给 width** → **宽度 = 最宽子行的 max-content**，再夹进 `[min-width, max-width]`。**所有子行都会被拉到同宽**，所以量 `rect.width` / `scrollWidth` **分不出是谁撑的**（每行都一样宽）。查因要这么量：
   - `el.style.width = "max-content"` → 量 → 还原，逐行比（R25 就是这么抓到「宽度行 256.2 > 220」的）。
   - 塞 `input[type=range]` 尤其危险：**原生 range 的 intrinsic 宽 129px**，光给 `flex: 1 1 80px` 没用（max-content 阶段按 intrinsic 算）→ 必须再给 **`max-width`** 封顶。
   - 装不下就**拆行**（R25：拉杆一行、打勾项单独一行），别靠「把窗放宽」解决 —— 老板认可的正是那个 232px 的窄窗。
   - 断言要写**根因**（最宽子行 max-content ≤ 可用宽），只写「菜单宽 232」是结果不是原因，下次照样被撑。
61. 🔴 **离屏片段里的「位置」是假的，别拿它判「探不探出屏」（R25 立，已回灌 R24 harness）**：片段里的 inline `left/top` 是 **jsdom 时代**按**假视口**算的（那时 `getBoundingClientRect()` 恒为 0，走的是兜底尺寸），跟真窗口的视口对不上。R25 加了两组之后窗高 420 → 506，这个假象立刻暴露成「窗底探出屏 76px」。
   - 正解：**dump 时把「当时请求的鼠标坐标」记到窗上**（`data-wantx/wanty`），render 时用**同一个 clamp 公式 + 真尺寸 + 真视口**重算一次，判 `fits` 用重算值。
   - 顺带：`input.value = "420"` **不会序列化进 `outerHTML`**（快照里读回默认值 320 → 几何是假的）→ dump 时要把 `value` 写成 attribute。

## 坑清单（都已踩过，别再踩）

- Obsidian `Plugin` 是 ES class：继承必须 `class X extends obsidian.Plugin`，`.call(this)` 直接 TypeError。
- 测试里 `process.exit()` 会截断管道 stdout（汇总行丢失）→ 用 `process.exitCode = ...`。
- Python 在 Windows 写文本带 `\r\n` → Node 侧读白名单要 trim。
- 字节数断言用 `Buffer.byteLength`（中文 utf-16 字符数会差 1/3）。
- jsdom 的 `getBoundingClientRect` 全 0（滚动类断言要直调方法）；`Element.createEl/empty` 需 polyfill（tests 里已有）。
- `loadFile` resolve 时 CodeMirror 未排版（scrollHeight≈clientHeight）→ 一次性 scrollTop 计算必为 0，要轮询。
- 构建顺序：prelude 必须在内嵌 vendor 段之前（KB 未定义会炸）；内嵌段抽回比对时要剥头尾包裹。
- Python 生成文本带 `\r`；同一文件一轮内别发多个 Edit。
- 🔴 **服务之间取静态方法**：`KB.services.<id>` 存的是**构造函数**，原型上的方法取不到。要共用就挂静态（`VaultOps.sha256 = sha256`）。
- 🔴 **别把结果对象的同一个字段既当数组又当布尔**（`out.skipped = []` vs `out.skipped = true`）——已踩，改用 `out.reason = "already-rebuilt"`。
- 🔴 **判断「已搬过」要比对目标位内容与 manifest 记的源 sha**，不是拿源文件跟自己比（自比恒等 → 撞名永远不进 blocked）。
- 🔴 **沙盒 fixture 也必须真删真建**：fs 版桩里「删目录漏了 rmSync」会让索引说删了、磁盘还在 —— 这类错只有真文件沙盒能抓（jsdom 桩的 delete 不看 force，掩盖了它）。
- 🔴 **`deepMerge` 旧实现（R5 前）会让 `settings` 与 `DEFAULTS` 共享引用**，且 `reapplyPaths` 是**就地改**数组 → 默认值被污染、种子内容跟着变。修法是 `clone()` 起底 + 深拷贝落 extra。
- 🔴 **`85_modules_base.js` 的视图注册在内嵌实例上**（`registry.active.board.inst._basesViews`），不是 kb-toolkit 插件自己 —— 断言别找错对象。
- 🔴 **审计类断言先剥注释**（`/\/\*[\s\S]*?\*\//g` + 行首 `//`），否则文档注释里的路径示例会被误判成硬编码。
- 🔴 **示例库种子正文必须调 `seedContent()` 现算**，不要手写：这样示例与「重建」产出天然字节一致，模板一改示例跟着对不上就会被 run_r5 抓住。
- 🔴 `Modal` / `Setting.addText` 在 stub 里要自己补（r5 已加 `addText` 含 `setValueAndFire` 便于模拟输入）。
- 🔴 **stub 的 `addCommand` 要按 id 覆盖**（真机命令表以 id 为键）：否则「关模块再打开」会重复堆叠，断言会看到 10 条命令（R6 已修）。
- 🔴 **stub 的 `Setting` 要把自身挂到 `el._setting`**：不然测试没法从 DOM 反查某个开关去 fire `onChange`（R6 已加）。
- 🔴 **`plan.moves` 里的文件夹项没有 `sha256`**（只有文件有）：拿 `moves[0].sha256` 直接 `.slice()` 会 TypeError，要 `.filter(m => m.type !== "folder")` 挑文件项。
- 🔴 **日记账（journal）里 `op:"log"` 那条必须最后 push**：回滚是倒序处理，它要**最先**被处理，否则执行报告留在新建根里 → 目录非空删不掉 → 自检报「新建根仍存在」。
- 🔴 **报告落点要按「笔记此刻实际在哪」挑**：原库根 → 旧文件区里的原库根（`<旧文件>/<库根>`）→ 新建根。只在**新建根**里的执行报告才登记为可逆；早期中断（新根还没建出来）的报告写回原库根/旧文件区，属于**留档，回滚不许抹**。
- 🔴 **Obsidian「受限模式」不是 `.obsidian/` 里的文件**：本体实现是 `isEnabled() { return "true" === localStorage.getItem("enable-plugin-" + app.appId) }`（asar 取证，2026-09-17）。往库里写 `community-plugins.json` 只能决定"启用哪些"，**关不掉受限模式**；只能让用户在界面上点一次「开启社区插件并重载」。别去动 Electron 的 leveldb。
- 🔴 **同一条路径的事件会连续来好几条**（R7）：真机「新建笔记」= `create` → `metadataCache.changed`。按路径去重时若让后来者覆盖前者，`create` 专属的那一支就永不执行。桩里已把 `vault.on/metadataCache.on` 改成可 `fire()`，**端到端断言必须真的按这个顺序发两条**。
- 🔴 **`detectState` 的判据不能是「库根在不在」**（R7）：根名 = 库根名之后，真库里库根本来就在。判据是「旧文件区 + 库根 + 顶层杂物（不含库根本体）」三元组，否则新库一律被误报成「半成品」。
- 🔴 **`verifyRestored` 的「根必须消失」要加条件**（R7）：根名 = 库根名时，库根本身就是搬运源，它「回到原位」正是成功标志。只有 `uniqueRoot` 编号出来的真·新根才要求消失。不加这个条件就是自造假警报（R7 真踩）。
- 🔴 **jsdom 里量不出矩形**：锚点/滚动类断言必须把 `rect/scroller` 注入进去（`tab._anchorApi`），或者直调方法传参；`requestAnimationFrame` 在 Node 里不存在，代码里要 `typeof` 判过再用。
- 🔴 **`Setting.addTextArea` / `addDropdown` 桩里要自己补**（R7 已加，含 `setValueAndFire`）；`addDropdown` 的 `options` 数组可用来断言"套数"。
- 🔴 **桩里造事件必须从元素的 document 取构造函数**（R8）：Node 22 有全局 `Event`（undici 的），`new Event("blur")` 造出来的东西 jsdom `dispatchEvent` 不认（`parameter 1 is not of type 'Event'`）。用 `el.ownerDocument.defaultView.Event`（stub 里已封成 `mkEvent`）。
- 🔴 **`addText`/`addTextArea` 的 `onChange` 要同时挂 `input` + `change`**（R8 按 asar 事实修正）：真机 `TextComponent.onChange` 挂的是 `input`。旧桩只挂 `change`，把「每敲一个字就重画整页」这个 bug 掩盖了两轮。配套新增 `typeFire`（模拟敲键，走 onChange 不落库）与 `blurFire`（模拟失焦）。
- 🔴 **jsdom 桩的 `rename` 不校验父目录、`delete` 不看 `force`**（R8）：所以「目录非空删不掉」「收容目标父目录不存在」这类错**只有真文件沙盒抓得到**。任何"回滚/收容/搬运"相关的改动，都必须过 `sandbox_r4b/run.js`（六场景 × 两遍）。
- 🔴 **`plan()` 走分代归档之后，`conflicts` 正常路径产不出非空**（R8）：撞名护栏只能「服务层直喂 manifest」来验（`run_r4b.js` 场景 C2 / 沙盒 S6）。
- 🔴 **`run_r4b.js` 旧场景 C 的语义已变**（R8）：R7 里「旧文件区已有同名不同内容」= 撞名；R8 里「旧文件区已有内容」= 再次重建 → 分代子文件夹 → 不再撞名。别拿旧期望值去改代码。
- 🔴 **桩的 `metadataCache.getFileCache(f)` 返回 `f.cache || {}`，不解析正文 YAML（R9）**：路由读前言走的是 `cache.frontmatter`，测试里造带前言的笔记**必须手工挂** `f.cache = { frontmatter: {...} }`，否则 `resolveTarget` 拿到空属性 → 永远不搬 → 对照组被验成假阴性（R9 的 C/J 段踩过）。
- 🔴 **桩的 `vault.create` 要求父目录已存在（R9）**：`await app.vault.createFolder(父)` 要先补上，`createFolder` 是幂等的（会逐级建）。桩与真文件沙盒都这样。
- 🔴 **`classify()` 把「旧文件区名」也算非杂物（R9）**：所以「执行后再点一次执行」会走 `detectState → done → already-rebuilt` 短路，**到不了**幂等 `preexisting` 分支。要验那条分支得走「第一次执行中途失败 → 第二次重跑」，或服务层直喂。
- 🔴 **桩里 setup 阶段的事件会污染被测时序（R9）**：`wireEvents` 之后 `vault.create` 会真的广播 `create`，180ms 后就把笔记按属性搬走了。只想验「rename 那一刻」时，要在 setup 之后**清掉 `plugin.eventBus.pending` 的计时器**（别用 `stop()`+`start()` —— 那会把 vault 监听器注册两遍）。
- 🔴 **Node 在本沙箱里读工作区外的路径会被拦（exit 127、无输出）（R9）**：`fs.cpSync` 从 `Desktop\插件实验` 拷库直接 127。**先由 Python 把库拷进工作区**（`shutil.copytree`），再让 node 在副本上玩（见 `.workbuddy/tmp/preplay_lab.py`）。
- 🔴 **切标签不要用 `hidden` 属性（R16）**：`run_r13.js` 的 B7/B9 是按 `.kbt-group[hidden]` 判断搜索命中的。切标签走 class `kbt-hidden`（CSS `display:none`），两套机制互不干扰。
- 🔴 **样式里不能自定义 CSS 变量（R16）**：`run_r3b.js` 的 ② 会剥掉 `var(...)` 内部再查裸色、③ 校验变量名必须在 obsidian 白名单内。想做马卡龙配色只能用白名单里已有的 `--color-green/yellow/purple` 配 `opacity` 降饱和；写 `--kbt-mint: #A8D5BA` 两条断言都会红。
- 🔴 **改设置页结构要连带改 6 个测试文件的期望（R16）**：模块名的 ①②③ 序号散落在 `run_r1/r6/r7/r10/r14`；段落按钮**个数**写死在 `run_r7/r10`（R16 加了 ⓘ 与「查看提示」→ 改成按按钮名判定，别写死数字）。动手前先 `grep -rn "① 新建知识库\|② 笔记自动化\|③ 更多的 Base" tests/`。
- 🔴 **文档也会被整份复写（R16 现场）**：AGENTS.md 出现过「旧版 1-212 行 + 新版 213-458 行」两份叠在一起（判据：两份的进度表不同，旧版只到 R8）。`grep -c "^## 这是什么" AGENTS.md` > 1 就是中招 —— 去重时保留**进度表更新**的那一份，先 `cp` 备份再动手。

## 开发流程约定

- 每轮：备份（**第一行代码之前**）→ 改 src → build → 全套断言 ×5 → 旧套件回归 → 沙盒演练 → 快照 diff=0 → 更新 `.workbuddy/memory/<日期>.md` → boss 真机验收。
- 配置存 `data.json`（带 schemaVersion 迁移链）+ .base 视图块；不要引入新的存储位置。
- 全库路径（`01_新知识库` 等）一律走 `settings.paths`，不许硬编码（铁律 9）。
- 对外分享的前提：路径全配置化 ✅ + 结构模板可导出导入 + 示例库 ✅ + README/CHANGELOG ✅（R5 已交付）。
- 重建的运行时文件都写在插件目录（不碰笔记）：`rebuild-preview.json`（计划）、`rebuild-manifest.json`（执行依据）、`rebuild-journal.json`（可逆日志）。
- 三种操作的**可读报告**写在库内 `<库根>/<元目录>/05_操作日志/`（R6 起，铁律 12）：写的是笔记实体，不是 json。日志目录名由 `settings.paths.metaDir` + `services/report.logFolder()` 现算，别硬编码。
- 备份脚本（`.workbuddy/tmp/backup_kbt_r8.py`）的白名单已补 `README.md`/`CHANGELOG.md`/`versions.json`/`samples/` 并改递归 —— R5/R6 那两版漏了它们（R6 另做了 `backup_kbt_r6_docs.py` 补文档基线）。下次抄脚本记得确认白名单。**跑完用 `find . -type f | wc -l` 数一遍**（`ls` 只看得到子目录，看着像空的一样）。

## 当前进度（2026-09-19）

| 轮次 | 状态 | 内容 |
|---|---|---|
| R1 | ✅ 完成 | 骨架 + 三分法设置页 + 服务层抽取（36 断言） |
| R2 | ✅ 完成（待真机验收②） | 创建补全 + note-locator 迁移 + 开新停旧（24 断言） |
| R3 | ✅ 完成（待真机验收③） | 双视图字节级内嵌 + 样式变量化收口（22+16 断言） |
| R4a | ✅ 完成 | 结构模板 + dry-run 预览 + manifest 生成（只读，24 断言） |
| R4b | ✅ 完成（待真机验收①） | 执行 + 回滚 + 幂等（90 断言 + 沙盒 67 断言 ×2 遍） |
| R5 | ✅ 完成 | 路径全配置化 + 首次使用向导 + README/CHANGELOG + 示例库 + 版本 1.0.0（106 断言） |
| R6 | ✅ 完成（待真机验收①②④⑤） | 侧栏图标 + 模块开关硬门控（registry.refresh / requireOn / 设置页门控）+ 操作日志报告笔记（109 断言；r4b 90→109） |
| R7 | ✅ 完成（待真机验收 7 条） | 向导保存即生效 + ②③ 栏目录起 + 路由弹表体检 + 锚点补偿 + **新建根名=库根名** + **事件按种类合并（创建补全真生效）** + 模板系统（116 断言；r4b 109→110、r6 109→110） |
| R8 | ✅ 完成（待真机验收 7 条） | **①创建补全提速**（事件自适应 180ms 起步/800ms 封顶 + handler 串行）+ **②回滚收容**（`回滚保留-<戳>/`）+ **③输入框 commitOnBlur** + **④再次重建分代归档**（保留已有库 + 并列新库 + 先前已有/本次移入）+ **⑤模板文件化 + 套用规则** + **⑥创作看板默认整个库** + **⑦一键补全**（136→137 断言；r4b 110→127、r7 116→131；沙盒 101→171） |
| R10 | ✅ 完成（待真机验收 8 条） | **①属性候选值下拉**（打补丁给 metadataCache.getFrontmatterPropertyValuesForKey，候选 = 原生 ∪ propertyOptions；收编 note-locator 的能力）+ **②执行不再复用陈旧 manifest**（cfgFingerprint 比对后自动重算；修「库根改名不生效」）+ **③模块段落就地折叠**（各自固定 div，拨开关不再整页重画）+ **④新建库自带 4 套默认模板**（进 journal、回滚可清、挂 manifest.root）+ **⑤修两个真 bug**（applySettingsChange 不落盘 / legacyFound 空数组短路）+ **⑥旧插件一键收编**（disablePluginAndSave）+ **⑦模块改名「新建知识库」+ 文案与向导重写**（79 处）+ **⑧实验库清空 + 同步构建 + 只留操作说明**（835→883 断言；沙盒 229、预演 247 全绿） |
| R11 | ✅ 完成（待真机验收 4 条） | **①目录拖动不再被弹回**（rename 改走 handleManualMove：属性跟随新目录、中心链跟随、永不回弹；路由改「属性优先，属性空才看标签」，废镜像让位规则）+ **②设置页不自动收起**（模块关 = 整段照常渲染 + `.kb-module-disabled` 置灰禁用，开/关布局零变化）+ **③看板 Alt+拖动搬文件**（vendor 分叉：moveCardToFolderOfCard，拖到哪张卡就进它的目录；普通拖动照旧）+ **④实验库幽灵插件条目清除**（残留 creation-board 目录进回收站；manifest 描述同步改名）+ 顺手修 r6 `btnTexts` 重复计数帮手（883→**907** 断言；沙盒 229 全绿） |
| R12 | ✅ 完成（待真机验收 7 条） | **①拖动搬文件成默认**（跨目录拖卡片直接搬文件，Alt+拖=强制纯排序；「全部」板块结构性不支持，如实告知）+ **②板块 ⚙ 设置**（板块名称 / 列表·卡片 / 每页条数 / 显正文 / 排序，只改该板块）+ **③板块级 YAML·结尾双链三态**（显示 YAML 默认关、显示结尾双链默认开，可跟随视图）+ **④板块拖动排序**（标题区拖动整块，写回视图配置 sig=null 重建）+ **⑤⑥移动端审计**（IntersectionObserver/crypto/剪贴板/桌面 API 全守卫，manifest isDesktopOnly:false）+ **⑦幽灵设置页断根**（suppressSettingTab 内嵌禁注册 + data.json 挪进 kb-toolkit/embed-creation-board，OneDrive 复活目录再清一次）（907→**937** 断言；沙盒 229 全绿） |
| R13 | ✅ 完成（待真机验收） | **界面翻新**（boss 拍板方案）：设置页顶部**搜索框**（即时过滤 + 命中高级组自动展开 + 空态建议词）+ **三模块分组**（组标题+说明+开关+段落，路径/模板/排除目录收进各组「高级」details 默认折叠）+ **① 状态横幅**（自动读取，fresh 给下一步引导）+ **三步主操作条**（预览主色/执行·回滚警示色一行三钮）+ 报告降内联钮 + **命令面板裁剪 4 条**（open-settings + 预览/回滚/日志；执行/查看状态/补全入口收进设置页）+ 看板面板「高级」折叠组（YAML/双链/拖动搬文件）+ 新增 styles_src/kbt.css 与 tests/run_r13.js（33 条）（937→**972** 断言；沙盒 229 全绿） |
| R14 | ✅ 完成（待真机验收） | **界面美化 11 条**（boss 四张截图报丑 → 诊断 → 拍板「全都要/紧凑/纵向分组」）：设置页 **A5 条**（组标题与开关行合并 setHeading / 状态横幅升级原生 info callout 分主副两行 / 全页清 `**` 星号残留 / 核心操作行可换行 / 搜索框说明一行）+ 看板 **B3 条**（编辑表单「基础/显示」分段小标题 / 底部按钮靠右 / 配置搬运 JSON 收默认折叠高级组）+ 看板·内容流 **C3 条**（栅格 auto-fill→**auto-fit** 空轨道坍缩 / 正文截断 2 行 + 徽章上限 2 个进「+N」→ bases-preview 也分叉 / 组容器卡片边界 + 目录树限高 220px）+ 新增 tests/run_r14.js（17 条）与 run_all.js 聚合入口（972→**991** 断言；沙盒 229 + 真库副本 247 全绿；独立版旧套件 718/11 为存量旧账见铁律 46） |
| R16 | ✅ 完成（待真机验收 5 条） | **设置页三标签改版**（boss 三轮截图意见）：**①三标签**（知识库/笔记/Base + 马卡龙状态圆点 + 页头「日志/关于」靠右 + 搜索命中他页自动跳过去）+ **②模块头三层**（标题 + 圆角长条滑动开关 + ⓘ → 左边 26px 短横 → 素色状态行；**去掉 ①②③ 序号**）+ **③帮助一栏**（ⓘ 收敛到「每模块 1 + 核心操作 1」，其余说明进悬浮小窗：可上下滑动、条目间只有分隔线不分栏；模块关着也能点开）+ **④配色降饱和**（主/警示按钮改描边；圆点用白名单主题色 `--color-green/yellow/purple`）+ **⑤手机端**（`@media max-width:700px` + `.is-mobile`：开关 42×26、ⓘ 24px、标签可横滑、小窗 `min(420px,92vw)` 限高可滚、触屏不叠 tooltip 改点 ⓘ 开小窗）+ 顺手清账：删 extract 的 no-op replace（r15 C3 存量红）+ **修 AGENTS.md 整份复写两份**（1022→**1074** 断言，新增 `tests/run_r16.js` 51 条；沙盒 229 + 真库副本 247 + 内容流 45 全绿；独立版 718/11 存量旧账未变差） |
| R16b | ✅ 完成（待真机验收） | **复写病抓到现行 + 上自动断言**：36/60 两个 src 被整份叠写两遍（逐轮备份取证：发生在 R15 收工到 R16 开工的空档期，非本轮写出；前一份是缺 R15 hasOwnProperty 修复的死代码） → 清掉后 main.js 504,398 → 480,213 B；新增 r16 I 段 7 条守卫（1081×3 = **3243** 断言全绿；沙盒 229 + 真库副本 247 + 内容流 45 全绿） |
| R17 | ✅ 完成（待真机验收） | **Templater 模板不再原样倒进笔记**（报障：新建笔记标签没创建 —— 模板指向了 Templater 脚本，整段被倒成正文，`---` 不在首行导致前言失效）：求值成功才写 / 求不到就拒写 / 目录被 Templater 接管则让路 + 修复 8 篇受损笔记 + 三个自研插件退役（归档）（+36 = **1123**/轮，全套 3369 全绿） |
| R18 | ✅ 完成（待真机验收） | **设置页排版 v3**（照老板桌面上的《设置页排版方案v3-交互效果图.html》重做显示效果；交互不变 —— 帮助栏点开仍是悬浮小窗）：页头版本号右置 + 日志/关于挪到标签行右端 / 搜索框整行、命中他页改「可点提示」不跳页 / 模块头不再挂 ⓘ（挪进状态行）→ 短横 → 状态行 / 栏目改「卡片外小标签 + 次级底卡片 + 行间淡分隔线」/ 核心操作改一行一件事（预览报告·执行·回滚）/ 操作日志并入辅助栏 / 排除目录提为「看板范围」栏 / 三处高级 summary 统一「高级」+ 箭头 CSS 画 / 按钮淡底走 color-mix（前一行留兜底，零裸色）/ 帮助栏条目改「键 + 说明」。**有意不放**卡片宽度与铺满开关（视图级配置，只放指路说明）+ 补掉 r3b 漏检 kbt.css（+57 = **1180**/轮，三连轮 3540 全绿） |
| R19 | ✅ 完成（待真机验收 5 条） | **老板五条**：① **找回「文件位置」属性**（R17 让路时整篇撒手 → 属性没人补，功能消失；现 `patchLocationKey()`：正文照让、属性照补，`processFrontMatter` 只加不覆盖、值留空、`writeBack` 关则不碰）② **开关圆点扶正**（真根因是原生 `::after` 的 `margin-top` + 关闭态 `translate3d` 没被清 → 显式 `margin:0; transform:none`；轨道 `999px` 胶囊）+ **模块栏加框** ③ **状态说明各自成栏**（`statusLine()` = `.kbt-sec.kbt-status-card` 整栏可点 → 悬浮窗「键 + 说明」逐条，三页各一栏）④ **核心操作按钮去彩底**（删 `.kbt-card .mod-cta/.mod-warning` 单开配色 → 栏内统一素色；页头收编横幅的红色警示保留）⑤ **提示精简**（`MOD_TIP` ≤18 字 + 7 处说明砍一句 + 清 Markdown 反引号残字）（+51 = **1233**/轮，三连轮 3699 全绿；沙盒 229 + 真库副本 247 + bases-preview 45 全绿） |
| R20 | ✅ 完成（待真机验收 4 条） | **老板四条**：① **状态只留是否启用**（`statusLine(box, tip)` 删掉 `.kbt-status-sub` 副行与「当前状态 ·」前缀，主行只报 已启用/未启用 + 一颗 `.kbt-led` 圆点；细节全在原有的状态悬浮窗里）② **帮助入口挪顶栏**（页底「帮助」栏整栏撤掉、`.kbt-help-row` 样式删净；顶栏 = 日志 → 关于 → **帮助**，点它按当前标签页开对应小窗）③ **自绘齿轮图标**（emoji「⚙」→ `gearIcon()`：`createElementNS` 画 14px 线描齿轮，`stroke=currentColor` 跟文字色走；顶栏 + 板块标题两处共用）④ **看板设置界面重做 + 三入口分工钉死**（视图标题 = 快速调节，`getViewOptions` 11→6 项只留显示类；顶栏齿轮 = 整个看板，`renderPanel` 三段式「看板行为/板块/高级」+ 原生胶囊开关 + 说明全进 title；板块齿轮 = 单个板块，三态下拉换 `.cb-seg` 并排按钮组；标签去冗长）（+73 = **1367**/轮，三连轮 4101 全绿；**另加 `run_r20b.js` 看板真 DOM 冒烟 59 条** —— 源码正则抓不到的运行时错在这里兜底；沙盒 229 + 真库副本 247 + bases-preview 45 + DOM 冒烟 59 全绿；复写病自检新增符号各 1 次） |
| R21 | ✅ 完成（待真机验收 1 条） | **老板一条**：「空位铺满整行」并入「卡片最小宽度」那一行、缩成「自动」+ 开关。落地 = 新 `addWidthRow()` 建一行「文件宽度 [拉杆] 160–480 · 240 px · 自动 [开关]」，放进**顶栏齿轮**新开的「卡片」组（排在「看板行为」前）；原「空位铺满整行」= 「自动」，默认开、**开时拉杆置灰**（数值一起变淡）；拖动只直写 `--cb-card-w`（不动 DOM），松手才 `cfgSet` + 重绘并夹到 160–480/对齐 10；自动**关**着时拖动**同时**写 `--cb-card-max`（否则 minmax 只让缩不让放）。`getViewOptions` 6→**4** 项（两项移出但**键没删**，搬运照旧带全）。**为什么换台面**：原生视图选项面板一条 descriptor 只能占一行，合不成「滑杆 + 开关」；顶栏面板是自绘 DOM，两者写同一份 `.base` 视图块。**踩到真 bug**：`num()` 只认 number、`rg.value` 是字符串 → 拖动/百分比/落盘全钉死 240（铁律 55；`run_r20b` 抓住的）。（+57 = **1439**/轮，三连轮 **4317** 全绿；`run_r20b` 59→**74**；沙盒 229 + 真库副本 247 + 独立套件 45 + 零裸色 19 全绿；构建 main.js 502,903 B / styles.css 56,521 B；`addWidthRow` 全域恰 2 处） |
| R22 | ✅ 完成（待真机验收 1 条） | **老板一条**：「板块设置」面板改**悬浮窗**（参考 v2 效果图）—— `.cb-mask`（fixed+inset:0+cover 色，z40）+ `.cb-panel`（fixed+z41+居中+`min(520px,94vw)`+高封顶 `min(84vh,720px)`+`overflow:hidden`+`--radius-l`+`--shadow-s`）+ 窗头（标题/状态字/素色 ✕，`align-items:center` 替掉原来的 baseline）+ 正文自己滚（`flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain`）；**收起路径收敛成一条 `closePanel()`**（✕ / 遮罩 / 点窗外 / 再点 ⚙）。收益：面板**不再占一行把看板挤下去**（真引擎量到开关前后 `.cb-list` top 完全一致）。（+48 = **1499**/轮，三连轮 **4497** 全绿；`run_r20b` 74→**86**；**新增真引擎几何层** 76 条：真 DOM + 真 cb.css + Chrome `--dump-dom` 读 rect/computedStyle，三用例含矮视口逼出滚动；沙盒 229 + 真库副本 247 + 独立套件 45 + 零裸色 19 全绿） |
| R23 | ✅ 完成（待真机验收 1 条） | **老板一条**：「加一个开关控制笔记的属性是否默认展开」（配真机截图）。**不新造能力** —— 键 `属性默认展开`（K_PROS_OPEN）R9 就有、`propsOpenDefault()` 一直在，只是原来只藏在 **Bases 原生视图选项面板**里。落地 = `renderPanel()` 的「看板行为」组加 `this.addToggle(behBox, K_PROS_OPEN, true, "属性默认展开", …)`，**紧跟「显正文」**（一个管正文区、一个管属性区）；`getViewOptions()` 摘掉那条（4→3 项），**键与语义一个没变**（老 `.base` 照认）。🔴 **本轮真坑**：控件换台面后触发路径变了，`onDataUpdated()` 里 `sig === this.sig` 会短路 → **必须把 K_PROS_OPEN 补进 `computeSig()`**，否则「拨了不生效但全绿」（→ 铁律 56）。（+50 = **1549**/轮，三连轮 **4647** 全绿；`run_r20b` 86→**104**；真引擎几何层重跑 76/0，窗高 414.8→436.8 正好多一行；沙盒 229 + 真库副本 247 + 独立套件 45 + 零裸色 19 全绿；构建 main.js 504,918 B / styles.css 57,841 B） |
| R24 | ✅ 完成（待真机验收 1 条） | **老板一条**：「单个板块的设置应只对单独板块生效」（配真机截图 + 结构化描述）。**这轮修的是语义错误** —— R20 起板块标题旁的 ⚙ 打开的其实是**整个看板**的设置面板（只是顺手定位到那行编辑区），老板要的是「只对这块生效」。落地 = ① **撤掉**板块标题旁那块 ⚙（连 `.cb-sec-gear` 样式一起删；顶栏齿轮是另一个东西，保留）② **双击板块名就地改名**（Enter 提交 / Esc 放弃 / 失焦也提交；🔴 `foldKey` 就是板块名 → `renameSection()` 必须把 `K_FOLD` 的 `旧名` 与 `旧名/子板块` 前缀一起迁走，手动顺序键「数据源:路径」不动）③ **右键板块 → 鼠标处弹设置小窗**（`openSecMenu(sec, clientX, clientY)`，复用卡片菜单那套跟手定位 + clamp + 点外面/Esc 收起）：刷新 / 通用设置（**属性展开**·内容展开·重置设置·显示帮助）/ 笔记内容（显示 YAML·显示双链）/ 文件操作（拖动搬文件·文件隐藏显示·查看隐藏的文件）④ **「属性展开」从视图级升成板块级三态**（`propsOpen`：继承/开/关，`propsOpenOn(sec)` 板块优先→回落视图默认；卡片属性区与就地编辑浮层都改走它）+ 同时补进顶栏面板的编辑行（两个台面能力一致）⑤ **新增「把某篇收起来」**（卡片右键 → 隐藏这篇；`K_HIDDEN_ON`/`K_HIDDEN_SHOW`/`K_HIDDEN` 三键，关着就**完全不渲染**、板块头显示「已隐藏 N」，开着带虚线淡出回来）⑥ **板块之间一条 1px 分隔线**（`.cb-section + .cb-section`，子板块在体内不被命中）⑦ 「文件操作」那组是**整个看板**共用的 → 用**打勾项** + 组头明写「整个看板」（不冒充板块级）；「重置设置」只清本板块覆盖、没覆盖时置灰。🔴 **真坑**：菜单项统一走 `run()`（先关窗再执行）→ 「显示帮助」刚展开就被连窗摘掉 → 新开 `itemStay()`（点完不收窗）；兜底尺寸估算 380 < 真引擎实测 **390.6** → 抬到 420。（+213 = **1762**/轮，三连轮 **5286** 全绿；`run_r20b` 104→**167**；**本轮新增真引擎几何层 44 条 + 截图像素统计 8 条**（分隔线对比度 26.0/22.0、输入框命中强调色 426/422px、clamp 把贴角窗从 1040 推回 802）；R22 几何层重跑 76/0；沙盒 229 + 真库副本 247 + 独立套件 45 + 零裸色 19 全绿；构建 main.js 522,317 B / styles.css 60,218 B；存档 87 文件 verify_bad=0） |
| R25 | ✅ 完成（待真机验收 4 条） | **老板一条**：「之前的排版样式非常好！右键菜单里新增新建文件；删除板块；新建板块；新增对单个板块内文件宽度的设置」—— **前提是不许动 R24 那套观感**（232px 窄窗、分组、组头写作用域）。落地 = ① **新建文件**（新「本板块」组；**复用**看板 `+` 的 `createInSection(sec,"",sec.__gridEl)`，一个字没重写，落点与 Templater 让路规则一致；readonly 置灰）② **删除板块**（两段式：第一下只变文案「再点一次确认删除」+ 红底加粗，第二下才删；删的逻辑从 `askDelete()` **提取**成 `deleteSection(i)`，面板与菜单共用一条路）③ **新建板块**（新「新建板块」组，4 个数据源按钮一行排开，点完**直接打开顶栏面板并定位到新板块那行**，不然新板块是空壳；`addSection()` 改为返回 `idx`）④ **板块级文件宽度**（新键 `文件宽度`/`K_SEC_W` 存在**板块数组里**，null = 继承视图级 `卡片最小宽度`；`sectionToRaw` 只在有覆盖时写回，**老配置一个字不动**；`renderSection` 只在有覆盖时给板块容器写 `--cb-card-w`）。🔴 **真坑（真引擎抓到）**：232px 窄窗塞不下「标签+拉杆+px+开关」一整行 → 原生 range 的 intrinsic 129px 把窗撑到 **268** → **拆两行**（拉杆行 + 独立「跟随看板」打勾项）+ 给拉杆 `max-width: 92px` 封顶（行 max-content 219.2 < 220）→ 窗回到 **232**。（+182 = **1944**/轮，三连轮 **5832** 全绿；新增 `run_r25.js` **122**；`run_r20b` 167→**227**；**真引擎几何 110 + 像素 12**；R24 几何层回灌「按真视口重算 clamp」后拿当前 DOM 重跑仍 **44/0**、R24 像素 8/0、R22 几何 76/0、R22 截图 OK；沙盒 229 + 真库副本 247 + 独立套件 45 全绿；构建 main.js **533,308 B** / styles.css **62,829 B**） |
| R15 | ✅ 完成（待真机验收） | **①卡片宽度真可调**（新视图选项「空位铺满整行」默认开=R14；关=卡片固定滑杆宽度——修「板块少时 1fr 撑满吞掉滑杆」；滑杆 160–480；就地编辑器开着时宽度变更也即时生效）+ **②主库收编就绪**（Obsidian 运行中不碰启用清单，boss 走 UI：启用 kb-toolkit → ②③ 模块自动 retire 三个旧插件；.base 视图类型同名注册不断供；note-locator data.json 自动迁移）+ **③排查修复 15 处**（P1×3：拖动搬文件同目录 ReferenceError / 公式分组手动顺序键不同源 / 自写属性重绘毁输入框；P2×12：事件总线总期限、回滚阶段B收容开关、报告撞名循环、路由正则转义、模板占位符原型链、lastDraggedPath 清理、锚点记板块名、还原预览 sourcePath、detach 前保存、reveal 定时器、配置搬运补 K_PROS_OPEN、围栏分开数等）+ **修 OneDrive 复写病**（5 文件被整文件复写两遍：build.js/quiet/eventbus/router/sandbox run.js，铁律 47）（991→**1022** 断言；沙盒 229 + 真库副本 247 全绿） |
| R9 | ✅ 完成（待真机验收 6 条） | **①视图注册走真生命周期**（`inst.load()/unload()` + 注册前 deregisterView；修「拨开关弹同名视图」）+ **②文件位置搬运与重建解耦**（只开 ② 就能用）+ **③静默窗口**（`services/quiet`，重建/回滚期间 ② 整条让路；修第 5/6/7 条回滚被抢文件）+ **④幂等搬运照样写可逆日志**（修「缺件」）+ **⑤journal 继承**（同一轮重跑不丢 `mkdirOld`，修空目录残渣）+ **⑥空目录补删** `sweepEmptyDirs` + **⑦属性默认展开**（看板卡片与浮层）+ **⑧报告如实对账**（真搬成排除 preexisting；收容表 from≠to）（828→835 断言；r5 收口 excluded 4 条；沙盒 171→229，新增 sc7；另加真库副本 sc8 = +18） |

**待 boss 真机验收**：
- ①→②→③ 三个关口（重建真执行+回滚 / 笔记自动化切换 / 双视图打开）+ 首次向导首次弹出体验（R4b/R5 遗留）。
- **R6 四条**：左侧栏图标点开设置页 / 拨掉 ① 后按钮与命令都消失、拨回来当场恢复 / 设置页 ① 组的「打开报告」与命令面板的「打开最近一次操作日志」/ 报告详细度与落点。
- **R7 七条**：向导保存当场生效（不必重载）/ ②③ 关掉后栏目收起 / 「查看路由条数」弹表 / 拨开关位置不跳 / 自定义知识库名称落进重建 / 新建笔记真的补 YAML+双链 / 模板系统（换·改·另存·提取·恢复内置）。
- **R8 七条（就是老板这一轮报的）**：①新建笔记补全是否明显变快 / ②重建后往新库写几篇再回滚，看 `回滚保留-<戳>/` 里东西在不在、原库是不是全回来了 / ③设置页输入框能不能一次打完整串 / ④在「旧文件区已有内容」的状态下再执行一次重建，看是否留旧库、建并列新库、旧文件区出两个分代子文件夹 / ⑤设置页里预览编辑模板 + 设套用规则（文件夹/标签）+ 模板落进 `02_模板库/Templater/` / ⑥创作看板默认是否显示整个库 / ⑦一键补全扫描→确认→补缺。
- **R9 六条（第四轮报的）**：③拨 ③ 的模块开关（关→开→关→开）看是否还弹「已存在同名视图」；④只开 ② 时改一篇笔记的 `文件位置`，看是否按标签/属性搬到位；⑤重建后往新库写几篇 → 回滚，看是否**能走完**、`回滚保留-<戳>/` 里笔记在不在、空的新建根是否删干净（**不留空 `旧文件/` 残渣**）；⑥执行报告是否如实区分「真搬成 / 已在目标位 / 未搬成」、收容表的「原位置」与「保留位置」两列是否不同；⑦回滚收容表里 `from` 是否是**原位**；⑧创作看板卡片与就地编辑浮层里的属性区是否**默认展开**。
- **R12 七条（第七轮报的）**：①文件夹板块之间拖卡片是否直接搬文件（无需 Alt）、Alt+拖是否纯排序、「全部」板块拖动是否有提示；②板块标题 ⚙ 里改名 / 列表·卡片 / 排序是否只对该板块生效、重开不丢；③板块 ⚙ 里「显示 YAML / 显示结尾双链」三态是否生效、行徽标对不对；④板块标题拖动是否能排序、落点线位置对不对；⑤⑥手机坚果云同步后 Obsidian 移动端能否打开看板/内容流（注意：手机上拖动搬文件与板块拖动排序是桌面功能，触屏不可用属预期）；⑦第三方插件列表是否只剩「知识库工具集」一条、设置页是否只剩一栏。
- **R13（界面翻新）**：设置页搜索框过滤是否跟手、命中「高级」是否自动展开；三组「高级」折叠是否默认收起、重开设置页不串状态；① 状态横幅是否自动显示库状态与下一步引导；三步主操作条颜色层级（预览主色 / 执行·回滚警示）是否一眼可辨；命令面板是否只剩 4 条；看板面板「高级」组是否收好且三个开关功能不变。
- **R14（界面美化 11 条）**：设置页组标题与开关是否合并成一行、不再出现两遍文案；状态横幅是否 info callout 且主副分层；全页是否还有字面 `**`；看板板块少时卡片是否铺满整行（不再右侧留白）；编辑表单「基础/显示」分段是否清晰、按钮是否靠右；配置搬运是否收进折叠高级组；内容流长文是否截 2 行、徽章是否 ≤2 个 + 「+N」。
- **R15（宽度可调 + 收编 + 排查）**：看板视图设置里拖「卡片最小宽度」是否**肉眼可见地变宽变窄**（板块卡片少时点开「空位铺满整行」开关再试）；两个标签板块的笔记住同一目录时拖动是否正常（修 ReferenceError）；公式分组里拖动排序是否不再弹回；改属性时连续打字是否不再被重绘打断；**收编三步**：主库启用「知识库工具集」→ 开 ②（note-locator/auto-note-mover 自动停用、路由自动迁移）→ 开 ③（创作看板/内容流自动停用）→ 确认「内容创作看板」.base 的看板与内容流两个页签照常渲染、第三方插件列表只剩 kb-toolkit + templater + nutstore。
- **R23 一条（第十二轮报的）**：在笔记里打开看板 → 点**顶栏齿轮** → 「看板行为」组里是不是多了一个「**属性默认展开**」（就在「显正文」下面）；把它**关掉** → 卡片上的属性区是不是**当场收起来**了（旁标从「属性 ▾」变「属性 ▸」）；再**拨回来** → 属性区是不是又默认展开了。顺带确认卡片上那个「属性 ▾ / ▸」小按钮**还能单独展开某一篇**（开关只管「默认」，不夺单篇的手动权）。
- **R22 一条（第十一轮报的）**：在笔记里打开看板 → 点**顶栏齿轮** → 面板是不是**居中悬浮的小窗**（背后有一层压暗的看板、能隐约看见，但点哪儿都点不动）；窗头右侧有没有 **✕**；点 ✕ / 点窗外 / 再点一下齿轮，三种关法是不是**窗和遮罩一起消失**（不会留一层灰罩着看板）；板块多时窗口是不是**内部滚动**、不再把整页撑长。
- **R21 一条（第十轮报的）**：在笔记里打开看板 → 点**顶栏齿轮** → 「卡片」组里是不是**一行**「文件宽度　[拉杆]　240 px　自动　[开关]」；「自动」默认开着时拉杆是否**置灰**（右侧数值也变淡）；把「自动」关掉后拉杆是否变成可拖、且卡片宽度**肉眼可见地**跟着变宽变窄；「自动」开着时卡片是否铺满整行。顺带确认点**看板标题**进的视图选项里这两项**已经不在**了（都挪到顶栏了，别以为是弄丢了）。
- **R20 四条（第九轮报的）**：① 设置页每个模块的「当前状态」是不是只剩「已启用 / 未启用」一行（点整栏或 ⓘ 仍能开悬浮窗看细节）；② 顶部标签行右端是不是「日志 / 关于 / 帮助」三个按钮、页内底部不再有「帮助」栏、点「帮助」开的是**当前这一页**的小窗；③ 看板工具条上的「⚙ 板块」与板块标题旁的齿轮是不是**自绘的线条图标**（跟文字同色、不再是淡紫 emoji）；④ 看板三个设置入口的分工 —— 点**看板标题**进的视图选项是否只剩显示类几项；点**顶栏齿轮**是否看到「看板行为 / 板块 / 高级」三段、开关是胶囊样式、解释文字悬停才出；点**板块标题齿轮**是否看到「继承 / 开 / 关」三个并排按钮而不是下拉。
- **实验库现状**（`C:\Users\wwwzh\OneDrive\Desktop\插件实验`）：**R23 收尾已同步**（SYNC-OK bad=0）。顶层：`01_111/`（老板重建产物）+ `旧文件/` + `操作说明.md` + `未命名.base`。插件目录：`kb-toolkit/` = main.js(504918) + styles.css(57841) + manifest/versions（与主库构建 sha256 一致）；旧 `creation-board/` 幽灵目录已再次进回收站（R12 构建不再往那里写 data.json，不会复活；内嵌桥改落 `kb-toolkit/embed-creation-board/`）。

## 决策记录（为什么是这样）

- 单插件模块化而非多插件：避免 create/rename 双监听双写。
- 内嵌而非重写：177KB 已验代码，729 项断言随字节等价自动继承。
- 创建补全只对空白新文件：避开 Templater 与粘贴场景。
- 标签切位置做「确认式」：全自动搬文件对大库风险过高。
- 重建四步走（预览/manifest/执行/回滚）+ 幂等：动真库的安全底线。
- **幂等做三层**：①`detectState` 判 done → 整个 plan 短路；②条目级（源不在=已搬过、目标内容同 sha=已搬过、目录/文件已存在=跳过）；③重复点确认不二次破坏。
- **失败即停，不自动回滚**：中断的库是「可读的半成品」，交人看过日志再决定回滚 —— 自动回滚会把「失败原因现场」也抹掉。
- **回滚删除走 `fileManager.trashFile`**：1.13.7 实现体读 `vault.getConfig("trashOption")` 分流到系统回收站 / 本地 .trash / 永久删，且不弹确认框（asar 取证），比裸 `vault.delete` 更符合「改动要有回退的路」。
- **R5 中心表只认目录名、前缀回构**：写死 `01_新知识库/02_Areas` → 换库根就全废；改成「登记 `02_Areas` + `_领域中心`，前缀从真实路径切」后，改名自动跟随且零配置。
- **R5 `reapplyPaths` 保守派生**：只重算「仍等于默认值」的字段；用户手改过的 routes/excluded 一律不动 —— 自动改配置比不改更危险。
- **R5 示例库种子走 `seedContent()`**：手写示例必然与模板漂移；现算则「改名即失效」被断言抓住。
- **R6 模块开关做成硬门控**：boss 报「关了 ① 却仍能执行/回滚」。根因是拨开关只写 `settings.modules`，**模块实例还活着**、按钮还在。修法不是"关掉时弹个提示"，而是三层一起上：命令不注册/摘掉 + 每个入口 `requireOn()` + 设置页不渲染操作区；`registry.refresh()` 让开关**当场**生效（不要求用户重载）。
- **R6 报告要"笔记实体"而不是 json**：boss 要的是能读、能被 Base 检索、能双链的东西 → 落 `<库根>/<元目录>/05_操作日志/*.md`（YAML 前言 + tags + 尾部双链回 MOC），而不是再写一个 json。
- **R6 报告落点按"笔记在哪"选**：原库根 → 旧文件区里的原库根 → 新建根。理由：执行成功后原库整体躺在旧文件区里，硬写原库根会写进不存在的位置（`root-missing`，R6 真踩）。
- **R6 只把「新建根里的执行报告」登记为可逆**：它留着会让新建根删不干净；而写在别处的中断/回滚报告是**留档**，回滚抹掉它等于毁证据。
- **R6 措辞要自洽**：「生成预览报告（只读）」现在会新增一篇报告 → 文案改成「只读：不搬不改任何已有笔记，仅写本报告」，并在 README/设置页同步。别让 UI 说一句代码不认账的话。
- **R7 把「新建根名」并进「库根名」**：旧设计里 rebuild 的产物叫「知识库」，而插件自己的路由/排除/中心链全指向 `paths.knowledgeBase` —— 重建完插件就**认不出自己的库**（老板的⑤：自定义名称没实现；⑥：新笔记不补全）。修法不是再给 rootName 加个 UI，而是**砍掉这个概念**：一个概念一个名字，`normalize()` 强制派生。
- **R7 把同名旧库当「可搬项」**：既然根名 = 库根名，顶层那个同名目录就正是「老库」。它必须可搬（归档进旧文件、再原地建同名空库），只有 `<根名>1`/`<根名>2` 这种编号残留才排除。`uniqueRoot` 因此退化成罕见的安全网。
- **R7 事件合并按种类而非按时间**：原来"后到的事件覆盖先到的"看似是去重，实则专杀 `create`（唯一带"要不要补全"判断的入口）。合并的语义应该是"这条路径发生了哪些种类的事"，派发时再按优先级选一个。
- **R7 加 `reapply` 而不是重启模块**：改库根名后，正在跑的 ② 手里攥着老 root。重启会掉监听、重装命令、丢事件；`onConfigure()` 只换脑子（重建 router），命令与监听原地不动。
- **R7 设置页位置用锚点而不是记 scrollTop**：内容高度会变（关掉 ① 后下方缩短），记 scrollTop 会被浏览器夹断。钉住「启用模块」标题的屏幕 y，差多少补多少，天然幂等。
- **R7 模板只替换认识的六个占位符**：写错的 `{{xxx}}` 原样留着 —— 新笔记里凭空多个洞比看得见一个 typo 更糟。
- **R8 事件延时改成自适应续期而不是「取最长」**：老板的诉求是「新建要等半秒到一秒」。旧的 `max(old.delay, d)` 每来一个事件就把 deadline 重新推到 800ms —— 那不是"等 Templater"，是"每次都在等"。改成起步 180ms + 按事件自己的延时续期 + 累计封顶 800ms：安静的新建 180ms 完事，热闹的新建照样等得住。**封顶是"每次 wait"的上限，不是从首次事件起算的总预算** —— 持续写入仍会不断续期，这是有意的（写入没停就别抢着改文件）。
- **R8 把创建补全的 `handler` 改成串行**：原来 `tryCreateFill` 不 await、`handle` 立刻并行跑 —— 补全还在写文件时路由已经把文件搬走（白写一次），而且两处各写一遍前言（一篇新笔记写盘 2~3 次）。串行之后路由看到的是补全后的前言，绝大多数情况判定「已是想要的样子」直接返回。
- **R8 回滚加"收容"阶段而不是"非空就跳过"**：旧实现遇到新根非空只能 blocked，回滚半途而废。「目录非空就保留」是对的（别删用户东西），但**保留之后还得让回滚继续走完** —— 所以先把外来户请进 `回滚保留-<戳>/`，目录空了继续删。收容只扫本轮 `mkdir` 的目录，不扫旧文件区（那里是等着搬回原位的老库）。
- **R8 「再次重建」的语义分叉**：旧文件区有内容 = 上一轮已经重建过 → 这次不能把已有库再搬一遍（那是把人家的库反复折腾），而要**保留已有库 + 新建一个并列的库**；旧文件区下用「先前已有 / 本次移入」两个带时间戳的子文件夹分代。好处是归档不再混代，也不会因为同名互相挡路。
- **R8 模板从"配置项"改成"文件"**：配置里存模板正文的代价是「设置页改了、Obsidian 里改了」两份真源，用户根本不知道该看哪个。落成 `02_模板库/Templater/*.md` 之后：在哪儿改都是同一份、能被双链/检索、模板本身也有版本历史（坚果云同步）。`id` 用 `file:<名字>` 前缀与内置模板区分。
- **R8 看板的「排除目录」由 kb-toolkit 推给内嵌实例**：看板自带的默认是 `99_Meta`，老板要的是"默认整个库"。解法刻意选了「不改 vendor 一个字节」（硬约束），改成写内嵌实例自己的 `data.json` 再让它 `loadSettings()`。代价是要显式压掉它的默认值（见铁律 20）。
- **R8 一键补全必须走确认门槛**：批量改库这种事，"先只读扫一遍 → 列出来 → 确认" 的三段式是这个插件的既有风格（重建也是这样）。`runAutofill({confirmed:false})` 只回清单不写盘，这条写在代码里而不是靠 UI 挡。
- 称呼：叫「老板」或「boss」，别叫「老板大人」。
