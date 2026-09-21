/* kb-toolkit R29 断言：三条老板需求
 *
 * 老板原话（2026-09-20）：
 *   1. 当我更改文件名字后，保留原文件位置，不要让文件改完名条最后面去了
 *   2. 文件点进去以悬浮小窗状态显示时，可以通过 Ctrl 加鼠标滚轮的方式缩放字体大小
 *   3. 优化手机端此插件适配
 *
 * 🔴 本轮要钉的坑：
 *   ① **「手动顺序」里存的是文件路径**：`{板块键: [路径, …]}`。改名 / 搬文件之后旧路径失配，
 *      `applyManualOrder()` 会把「顺序表里没点名」的条目一律甩到最后（兜底 BIG）——
 *      老板看到的就是「改完名这张卡跑到最后面去了」。所以改名后必须**就地换路径**。
 *      🔴 但只换**取值**，不换**键**（键是「数据源:路径」，跟笔记名无关 —— run_r24 B20 钉着）。
 *   ② `renameFile` 会**就地改掉** `entry.file.path` → 旧路径必须**在调用之前**留一份，
 *      不然迁移函数拿到的是新路径（自己换自己，等于没换）。
 *   ③ 浮层字号要「没设过 = 主题默认」：CSS 里必须给 `--cb-ed-fs` 一个
 *      `var(--font-ui-smaller)` 的初值，否则老用户升上来会看到浮层字突然变小/变大。
 *   ④ 换台面不破配置：K_ED_FS 要进 export / import，否则导出再导入静默丢设置。
 *   ⑤ 手机端只准**加**媒体查询 / `.is-mobile`，桌面桌面那一套一行不许动
 *      （所以顶层 `.cb-grid` 仍然只许有一条）。
 *
 * 段切片一律**有界**（起止两个标记），不切到文件尾 —— R29 就是被「切到文件尾」误伤过
 * （r27 的 D4 假报）。真 DOM 那一刀加在 tests/run_r20b.js 的 R29 段。
 */
const path = require("path");
const fs = require("fs");

const PLUG = path.join(__dirname, "..");
let pass = 0, fail = 0; const fails = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; fails.push(name); console.log("  FAIL " + name); }
}
function eq(a, b, name) {
  ok(a === b, name + " (got=" + JSON.stringify(a) + " want=" + JSON.stringify(b) + ")");
}
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function count(re, s) { return (s.match(re) || []).length; }
function bodyOf(text, header) {
  const i = text.indexOf(header);
  if (i < 0) return "";
  const j = text.indexOf("{", i + header.length - 1);
  if (j < 0) return "";
  let depth = 0, k = j;
  for (; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}") { depth--; if (depth === 0) { k++; break; } }
  }
  return text.slice(j, k);
}
/** 有界段切片：从 mark 到 nextMark 之前的最后一个 /* 开始处（不切到文件尾） */
function segOf(text, mark, nextMark) {
  const i = text.indexOf(mark);
  if (i < 0) return "";
  if (!nextMark) return text.slice(i);
  const j = text.indexOf(nextMark, i + 1);
  if (j < 0) return text.slice(i);
  const k = text.lastIndexOf("/*", j);
  return text.slice(i, k > i ? k : j);
}

const cbRaw = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8");
const cb = stripComments(cbRaw);
const cssRaw = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
const mainJs = fs.readFileSync(path.join(PLUG, "main.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(PLUG, "styles.css"), "utf8");

const CSS_BADGE_MARK = "R29（boss 第 2 条）：就地编辑浮层 —— 字号徽标";
const CSS_MOBILE_MARK = "R29（boss 第 3 条）：手机端适配";
const badgeCss = segOf(cssRaw, CSS_BADGE_MARK, CSS_MOBILE_MARK);
const mobileCss = segOf(cssRaw, CSS_MOBILE_MARK);

/* ================= A. 改名保位（boss 第 1 条） ================= */
console.log("\n== R29 · 改名保位：手动顺序里的旧路径就地换新 ==");

eq(count(/  migrateManualOrderPath\(oldPath, newPath\) \{/g, cb), 1,
  "A1：migrateManualOrderPath 只定义 1 次（复写病自检）");
const migBody = bodyOf(cb, "migrateManualOrderPath(oldPath, newPath) {");
ok(migBody.length > 0, "A2：能取到函数体（锚点没抓成调用点）");
ok(/if \(!from \|\| !to \|\| from === to\) return false;/.test(migBody),
  "A3：旧新同路径 / 空路径直接退出（不做无意义写盘）");
ok(/arr\[i\] = to;/.test(migBody), "A4：命中就**换取值**（arr[i] = to）");
ok(/hit \+= 1;/.test(migBody), "A5：命中计数 hit（诊断 / 早退都靠它）");
ok(!/o\[[^\]]+\]\s*=/.test(migBody),
  "A6：🔴 只改取值、**不碰键**（键是「数据源:路径」，动它会串板块 —— run_r24 B20 守着同一条）");
ok(/if \(!hit\) return false;/.test(migBody),
  "A7：一次都没命中就不写盘（没拖过排序的库零副作用）");
ok(/this\.config\.set\("手动顺序", o\)/.test(migBody),
  "A8：写回的是视图块顶层键「手动顺序」");
ok(/this\.manualOrder = o;/.test(migBody),
  "A9：内存那份也换掉 —— 不换的话本次重绘仍按旧表算，白改");

/* 三个入口都要接上：标题改名 / 拖动搬文件 / 「将文件移动到…」 */
eq(count(/this\.migrateManualOrderPath\(/g, cb), 3,
  "A10：三个改名/搬文件入口都接了迁移（改名 + 拖动搬 + 移动到…）");

const rbBody = bodyOf(cb, "    const commit = async () => {");
const iOld = rbBody.indexOf("const oldPath = str(entry.file.path);");
const iRen = rbBody.indexOf("await this.app.fileManager.renameFile(entry.file, newPath);");
ok(iOld >= 0 && iRen >= 0 && iOld < iRen,
  "A11：🔴 旧路径**在 renameFile 之前**留一份（renameFile 会就地改掉 file.path）");
ok(/this\.lastRename = \{ from: oldPath, to: newPath \};/.test(rbBody),
  "A12：lastRename 的 from 是**旧路径**（原来写成改后的 path，名不副实）");
ok(/if \(newPath === oldPath\) return;/.test(rbBody),
  "A13：文件名没真变就别折腾");

const mvBody = bodyOf(cb, "async moveFileToFolder(file, tgtFolder, srcCard, targetCard) {");
ok(/const oldPathMv = str\(file\.path\);/.test(mvBody)
  && /this\.migrateManualOrderPath\(oldPathMv, target\);/.test(mvBody),
  "A14：拖动搬文件（跨板块）也迁移 —— 别在顺序表里留一条死路径");
const pmBody = bodyOf(cb, "const done = (commit) => {");
ok(/const oldPathPm = str\(file\.path\);/.test(pmBody)
  && /this\.migrateManualOrderPath\(oldPathPm, target\);/.test(pmBody),
  "A15：「将文件移动到…」这条右键路径同样迁移（三个入口一个口径）");

ok(/const BIG = Number\.MAX_SAFE_INTEGER;/.test(cb)
  && /idx\.has\(pa\) \? idx\.get\(pa\) : BIG/.test(cb),
  "A16：钉住「为什么必须迁移」的机制 —— 顺序表里查不到的条目兜底成 BIG（= 排到最后）");
ok(/parts\.push\(\(e && e\.file \? e\.file\.path : "\?"\)/.test(cb),
  "A17：改名会改路径 → computeSig 因此变化 → 触发重绘（迁移完立刻见效，不用手动刷新）");

const renSecBody = bodyOf(cb, "renameSection(i, nv) {");
ok(renSecBody.indexOf("手动顺序") < 0,
  "A18（run_r24 B20 的意图仍在）：**板块改名**照样不碰手动顺序 —— 两码事");

/* ================= B. 浮层字号（boss 第 2 条） ================= */
console.log("\n== R29 · 就地编辑浮层：Ctrl/Cmd + 滚轮 缩放字号 ==");

eq(count(/const K_ED_FS = "编辑浮层字号";/g, cbRaw), 1, "B1：K_ED_FS 只定义 1 次");
eq(count(/const ED_FS_MIN = 10;/g, cb), 1, "B2：ED_FS_MIN = 10");
eq(count(/const ED_FS_MAX = 32;/g, cb), 1, "B3：ED_FS_MAX = 32");
eq(count(/const ED_FS_STEP = 1;/g, cb), 1, "B4：ED_FS_STEP = 1（滚轮一档 1px）");
eq(count(/const ED_FS_DEFAULT = 14;/g, cb), 1, "B5：ED_FS_DEFAULT 兜底起点（量不到真字宽时用）");

eq(count(/  editorFontSize\(\) \{/g, cb), 1, "B6：editorFontSize() 只定义 1 次");
const efsBody = bodyOf(cb, "editorFontSize() {");
ok(/this\.cfgGet\(K_ED_FS, null\)/.test(efsBody), "B7：读的是 K_ED_FS，缺省 null = 跟随主题");
ok(/if \(v === null \|\| v === undefined \|\| v === ""\) return null;/.test(efsBody),
  "B8：空值一律当「跟随主题」（不许把 0 / 空串当成字号）");
ok(/Math\.max\(ED_FS_MIN, Math\.min\(ED_FS_MAX, n\)\)/.test(efsBody),
  "B9：🔴 无论从哪来（配置被手改过）都夹到 10–32");

eq(count(/  applyEditorFont\(pop\) \{/g, cb), 1, "B10：applyEditorFont(pop) 只定义 1 次");
const aefBody = bodyOf(cb, "applyEditorFont(pop) {");
ok(/pop\.style\.removeProperty\("--cb-ed-fs"\)/.test(aefBody)
  && /pop\.style\.removeProperty\("--font-text-size"\)/.test(aefBody),
  "B11：跟随主题 = 摘掉自定义变量（回落 CSS 初值，R28 行为一字不差）");
ok(/pop\.style\.setProperty\("--cb-ed-fs", fs \+ "px"\)/.test(aefBody),
  "B12：填了值就写到 --cb-ed-fs（CSS 的唯一入口）");
ok(/pop\.style\.setProperty\("--font-text-size", fs \+ "px"\)/.test(aefBody),
  "B13：一并覆盖原生字号变量 —— 表格 / 属性 / 内嵌块跟着缩，不然只有正文变");

const mountBody = bodyOf(cb, "async mountEditor(card, entry, hostEl, yRatio, openPt, anchor) {");
ok(/fsBadge\.setAttr\("title", "按住 Ctrl \/ Cmd 滚轮可缩放字号；双击这里回「跟随主题」"\);/.test(mountBody),
  "B14：徽标带说明（不然没人知道能这么用）");
ok(/pop\.addEventListener\("wheel"/.test(mountBody), "B15：浮层上挂了 wheel 监听");
ok(/if \(!\(evt\.ctrlKey \|\| evt\.metaKey\)\) return;/.test(mountBody),
  "B16：🔴 只认 Ctrl / Cmd + 滚轮 —— 普通滚轮还是滚页面（不许抢）");
ok(/evt\.preventDefault\(\);\s*\n\s*evt\.stopPropagation\(\);/.test(mountBody),
  "B17：拦下默认行为 + 不再冒泡（别让宿主也缩放一次）");
ok(/\{ passive: false \}/.test(mountBody),
  "B18：🔴 必须 passive:false —— 否则 preventDefault 无效（浏览器直接忽略）");
ok(/evt\.deltaY < 0 \? 1 : -1/.test(mountBody), "B19：滚轮向上 = 变大");
ok(/if \(next === this\.editorFontSize\(\)\) return;/.test(mountBody),
  "B20：到顶 / 到底就不再写盘（别刷无谓的 .base 写）");
ok(/pop\.__cbPaintFs = paintEdFs;/.test(mountBody),
  "B21：把重绘徽标的钩子挂在浮层上（面板改字号时要用）");
ok(/fsBadge\.addEventListener\("dblclick"/.test(mountBody)
  && /this\.cfgSet\(K_ED_FS, null\)/.test(mountBody),
  "B22：双击徽标回「跟随主题」（给了条明路，不至于找不到出口）");
ok(/const fsBadge = bar\.createSpan\(\{ cls: "cb-ed-fs" \}\);/.test(mountBody),
  "B23：徽标元素真的是 .cb-ed-fs（与 CSS 对得上）");
ok(/this\.applyEditorFont\(pop\);\s*\n\s*paintEdFs\(\);/.test(mountBody),
  "B24：挂载时先按配置铺一遍（打开就是记忆里的字号）");

/* 面板「内容」组里的拉杆 */
ok(/this\.addEditorFontRow\(contentBox\);/.test(cb),
  "B25：面板「内容」组挂上了字号拉杆（浮层之外也能设）");
eq(count(/  addEditorFontRow\(parent\) \{/g, cb), 1, "B26：addEditorFontRow 只定义 1 次");
const aefrBody = bodyOf(cb, "addEditorFontRow(parent) {");
ok(/this\._sliderRow\(parent, "编辑浮层字号"/.test(aefrBody),
  "B27：复用既有 _sliderRow（与宽度 / 间距 / 高度同一套观感）");
ok(/ED_FS_MIN, ED_FS_MAX, 1,/.test(aefrBody),
  "B28：拉杆边界与滚轮共用同一对常量（两个台面不许漂）");
ok(/if \(isFollow\(\)\) \{ cb\.checked = isFollow\(\); paint\(\); \}/.test(aefrBody)
  || /face\(\)/.test(aefrBody),
  "B29：有「跟随主题」勾选项（取消 = 不写覆盖）");
ok(/this\.applyEditorFont\(ed\.pop\)/.test(aefrBody) && /__cbPaintFs/.test(aefrBody),
  "B30：🔴 面板改字号要**当场刷开着的浮层**（浮层挂在 body 上，不在面板重绘范围里）");

ok(/if \(this\.editorFontSize\(\) !== null\) view\[K_ED_FS\] = this\.editorFontSize\(\);/.test(cb),
  "B31：导出只在**显式设过**时带 K_ED_FS（没设过别把默认固化进 .base）");
ok(/kinds\[K_ED_FS\] = "num";/.test(cb),
  "B32：导入的 kinds 表也补了 —— 少了这行搬进来的字号会被静默丢掉");

/* ================= C. 浮层字号 CSS ================= */
console.log("\n== R29 · 浮层字号：CSS 的唯一入口 ==");

ok(/\.cb-ed-pop \{[^}]*--cb-ed-fs: var\(--font-ui-smaller\);/.test(cssRaw),
  "C1：🔴 --cb-ed-fs 声明在**原来那条** .cb-ed-pop 规则里，初值 = 主题小字号（老用户升上来观感不变）");
ok(/\.cb-ed-pop \.markdown-source-view,\s*\n\.cb-ed-pop \.cm-editor \{\s*\n\s*font-size: var\(--cb-ed-fs\);/.test(cssRaw),
  "C2：编辑器字号吃变量（**就地改掉**原来写死的 --font-ui-smaller，不是新加一条覆盖）");
ok(!/\.cb-ed-pop[^{]*\{[^}]*font-size: var\(--font-ui-smaller\)/.test(cssRaw),
  "C3：浮层里不再有任何**写死**的小字号（全走 --cb-ed-fs；改了活的，没留死代码）");
ok(/\.cb-ed-fs \{/.test(badgeCss), "C4：徽标样式在 R29 段里");
ok(/margin-left: auto;/.test(badgeCss), "C5：徽标吃 auto 外边距（顶到右边）");
ok(/\.cb-ed-pop \.cb-ed-bar \.cb-ed-close \{\s*\n\s*margin-left: 0;/.test(badgeCss),
  "C6：🔴 ✕ 按钮的 margin-left 归零 —— 两个 auto 会打架，把徽标挤到中间去");
ok(/\.cb-ed-pop\.cb-ed-zooming \.cb-ed-fs \{/.test(badgeCss),
  "C7：缩放中有反馈（.cb-ed-zooming）");
ok(!/width:|height:|padding: \d+px \d+px;[\s\S]{0,40}cb-ed-zooming/.test(badgeCss.split(".cb-ed-zooming")[1] || ""),
  "C8：缩放反馈只动颜色，不动尺寸（不引发布局抖动）");

/* ================= D. 手机端（boss 第 3 条） ================= */
console.log("\n== R29 · 手机端适配 ==");

/* 🔴 R30 修（铁律 49：断言跟着意图走）：D1 原来数「700px 只出现一次」—— 那是 R29 当时的
 *   副产品，真正的意图是「窄屏断点值全项目只有一种、且与设置页 kbt.css 同值」。
 *   R30 追加第二个 700px 块（可编辑靠左）立刻被字面计数误伤。改成按值断言。 */
const cbBps = [...cssRaw.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => m[1]);
eq(new Set(cbBps).size, 1,
  "D1a：cb.css 的窄屏断点值只有一种（不许出现两套窄屏口径）");
eq(cbBps[0] || "", "700",
  "D1b：断点 = 700px（与设置页 kbt.css 的 @media (max-width: 700px) 同值）");
eq(count(/@media \(hover: none\)/g, cssRaw), 1, "D2：触屏（无 hover）断点只此一处");
ok(/\.cb-bar \{\s*\n\s*flex-wrap: wrap;/.test(mobileCss), "D3：窄屏工具条可折行（不横向溢出）");
ok(/\.cb-section-head \{\s*\n\s*flex-wrap: wrap;/.test(mobileCss), "D4：窄屏板块头可折行");
ok(/minmax\(min\(var\(--cb-card-w\), 100%\), var\(--cb-card-max, 1fr\)\)/.test(mobileCss),
  "D5：🔴 卡片最小宽比屏还宽时不许撑破页面（min(…, 100%) 兜住）");
ok(/\.cb-ed-pop \{\s*\n\s*width: 96vw;\s*\n\s*height: 86vh;/.test(mobileCss),
  "D6：窄屏浮层贴近全屏");
ok(/\.cb-panel \{\s*\n\s*width: 96vw;/.test(mobileCss), "D7：窄屏设置面板贴近全屏");
ok(/\.cb-ctxmenu \{[\s\S]{0,160}?max-height: calc\(100vh - 16px\);/.test(mobileCss),
  "D8：🔴 跟手小窗给高度上限 + 自己滚（板块菜单分组多，手机上会顶出屏外）");
ok(/overflow-y: auto;/.test(mobileCss), "D9：小窗超出就自己滚");
ok(/\.is-mobile \.cb-ctx-item \{[\s\S]{0,80}?padding: 8px 12px;/.test(mobileCss),
  "D10：移动端菜单项放大到点得准");
ok(count(/\.is-mobile \./g, mobileCss) >= 8,
  "D11：.is-mobile 覆写有 " + count(/\.is-mobile \./g, mobileCss) + " 条（触控目标整体放大）");
ok(/@media \(hover: none\) \{[\s\S]{0,200}?\.cb-card:hover \{/.test(mobileCss),
  "D12：触屏上关掉卡片 hover 阴影（点不出来的效果别装出来）");

/* 桌面那一套不许被动：顶层 .cb-grid 仍只许一条 */
eq(count(/^\.cb-grid \{/gm, cssRaw), 1,
  "D13：🔴 顶层 .cb-grid 只有一条 —— 手机端的改动全在 @media 里（桌面零影响）");
eq(count(/^\.cb-ed-pop \{/gm, cssRaw), 1,
  "D14：顶层 .cb-ed-pop 只有一条（字号靠变量，不是另开一条覆盖）");

/* 变量体检（铁律 59 ③）：R29 段里用到的每个 var 都得有声明或来自主题 */
const used = new Set();
(mobileCss + badgeCss).replace(/var\((--[a-z0-9-]+)/gi, (_, v) => { used.add(v); return _; });
const declared = new Set();
cssRaw.replace(/(--[a-z0-9-]+)\s*:/gi, (_, v) => { declared.add(v); return _; });
const THEME_PREFIX = /^--(background|text|font|radius|shadow|color|interactive|layer|size|checkbox|table|metadata|popover|sidebar|divider|caret|tag|link|titlebar|modal|prompt|tab|icon|scrollbar|blockquote|code|embed|graph|nav|ribbon|status|workspace|h|p|list|indentation|line|file|collapse|header|toggle|slider|input|button|collapse)/;
const unknown = [...used].filter((v) => !declared.has(v) && !THEME_PREFIX.test(v));
eq(unknown.length, 0, "D15：R29 段用到的 CSS 变量全都说得出出处" + (unknown.length ? " → " + unknown.join(", ") : ""));

/* ================= E. 出货一致性 ================= */
console.log("\n== R29 · 出货一致性 ==");

ok(mainJs.indexOf('const K_ED_FS = "编辑浮层字号";') >= 0, "E1：main.js 里真有 K_ED_FS（构建真跑过）");
ok(mainJs.indexOf("migrateManualOrderPath") >= 0, "E2：main.js 里有顺序迁移");
ok(mainJs.indexOf("cb-ed-fs") >= 0, "E3：main.js 里的类名与 CSS 对得上");
ok(mainJs.indexOf('const ED_FS_MIN = 10;') >= 0, "E4：main.js 里有字号常量");
ok(stylesCss.indexOf("@media (max-width: 700px)") >= 0, "E5：styles.css 里有窄屏断点");
ok(stylesCss.indexOf(".is-mobile .cb-ctx-item") >= 0, "E6：styles.css 里有移动端覆写");
ok(/--cb-ed-fs: var\(--font-ui-smaller\);/.test(stylesCss) && /font-size: var\(--cb-ed-fs\)/.test(stylesCss),
  "E7：styles.css 里字号变量声明与使用都在");

console.log("\n== R29 · 复写病自检（新方法各只许定义一次）==");
eq(count(/  migrateManualOrderPath\(oldPath, newPath\) \{/g, cb), 1, "F1：migrateManualOrderPath ×1");
eq(count(/  editorFontSize\(\) \{/g, cb), 1, "F2：editorFontSize ×1");
eq(count(/  applyEditorFont\(pop\) \{/g, cb), 1, "F3：applyEditorFont ×1");
eq(count(/  addEditorFontRow\(parent\) \{/g, cb), 1, "F4：addEditorFontRow ×1");
eq(count(/KB\.define\(/g, mainJs) >= 1, true, "F5：KB.define 仍在（构建产物结构没坏）");

console.log("\nR29: " + pass + " 通过 / " + fail + " 失败"
  + (fail ? "\n" + fails.join("\n") : ""));
process.exit(fail ? 1 : 0);
