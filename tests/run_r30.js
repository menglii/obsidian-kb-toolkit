/* kb-toolkit R30 断言：手机端界面排版（老板五条）
 *
 * 老板原话（2026-09-21）：
 *   1. 界面上方 base 路径在手机竖屏模式下显示不全，要求只留下 base 自己的名字
 *   2. 创作看板和 344 个结果字样显示不全，要求手机端页面不够时，创作看板只留下图标，
 *      不显示文字，344 个结果字样直接不显示
 *   3. 可编辑，板块和重载图标在手机端有错位，要求可编辑图标在靠左，板块和重载图标靠右
 *   4. 插件设置界面，手机端顶部的日志/关于/帮助小字放知识库/笔记/base 按钮的下面，小字靠左显示
 *   5. 手机端设置界面选项小框中按钮太大把文字挤到上面去了；按钮和文字离白色框太近
 *
 * 🔴 本轮要钉的坑：
 *   ①② 是 **Obsidian 原生 UI**（view-header 面包屑 / .bases-toolbar），类名按 asar 取证
 *      （view-header-title-parent @230998；bases-toolbar-views-menu / -result-count @526121），
 *      不许凭记忆猜。且 ① 只作用于看板叶子（data-type="creation-board"），笔记页路径不动。
 *   ③ 只改 order，不加新布局 —— ⚙板块 的 margin-left:auto（桌面规则）继续负责「靠右」。
 *   ⑤ 原生 @container(max-width:400px) 把 setting-item 竖排 + 按钮铺满（特异性 0,3,1/0,4,1）
 *      → 覆盖规则用 body.is-mobile + 双类压过（0,5,x），**不用 !important**。
 *   🔴 只准加媒体查询 / .is-mobile / .is-phone，桌面那套一行不许动（r18-211 的
 *      「.kbt-ghost-btns margin-left:auto」桌面规则还在，这里再守一次）。
 *
 * 段切片一律**有界**（铁律 49）：R30 的 cb.css 段 = 「R30（boss 五条」→ 文件尾（当前是最后一段，
 * 下一轮追加后必须把 nextMark 补上）；kbt.css 的 700px 段 = 「手机端 / 窄窗」→ 「Obsidian 移动端」。
 * 真引擎几何 + 像素那两层在 tmp/render_r30.py / tmp/check_r30_shots.py。
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
function count(re, s) { return (s.match(re) || []).length; }
function segOf(text, mark, nextMark) {
  const i = text.indexOf(mark);
  if (i < 0) return "";
  if (!nextMark) return text.slice(i);
  const j = text.indexOf(nextMark, i + 1);
  if (j < 0) return text.slice(i);
  const k = text.lastIndexOf("/*", j);
  return text.slice(i, k > i ? k : j);
}
/** 取某个完整 CSS 规则块（{...} 配平） */
function ruleOf(text, header) {
  const i = text.indexOf(header);
  if (i < 0) return "";
  const j = text.indexOf("{", i + header.length - 1);
  if (j < 0) return "";
  let depth = 0, k = j;
  for (; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}") { depth--; if (depth === 0) { k++; break; } }
  }
  return text.slice(i, k);
}

const cbCss = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
const kbtCss = fs.readFileSync(path.join(PLUG, "styles_src", "kbt.css"), "utf8");
const stylesCss = fs.readFileSync(path.join(PLUG, "styles.css"), "utf8");

/* —— 有界段 —— */
const r30Seg = segOf(cbCss, "R30（boss 五条");            // cb.css 尾段（当前最后一段）
/* kbt.css 700px 媒体块 = 「手机端 / 窄窗」→「R30（boss 第 5 条）」
 * （R30 的 is-mobile 覆盖插在 700px 块和「Obsidian 移动端」老段中间，别让它混进 700px 段） */
const kbtMobile = segOf(kbtCss, "手机端 / 窄窗", "R30（boss 第 5 条）");
/* R30 is-mobile 段 = 「R30（boss 第 5 条）」→ 原有「Obsidian 移动端（body.is-mobile）」段之前（有界） */
const kbtIsMobile = segOf(kbtCss, "R30（boss 第 5 条）", "Obsidian 移动端（body.is-mobile）");
/* 🔴 剥注释：段起点在注释**中间**（标记本身就是注释里的一句话）→ 头上那半截注释
 *   没有配对的注释开头，得先把首个注释结尾之前的残段去掉，再剥成对注释 */
function stripCssComments(s) {
  return s.replace(/^[\s\S]*?\*\//, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
const kbtIsMobileCode = stripCssComments(kbtIsMobile);
const r30SegCode = stripCssComments(r30Seg);

/* ================= A. ① 面包屑只留本名（原生 UI，asar 取证） ================= */
console.log("\n== R30 · ① base 面包屑手机端只留本名 ==");

const crumbSel = 'body.is-phone .workspace-leaf-content[data-type="creation-board"] .view-header-title-parent';
eq(count(new RegExp(crumbSel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), cbCss), 1,
  "A1：面包屑规则恰 1 条（复写病自检）");
ok(ruleOf(cbCss, crumbSel).indexOf("display: none") > 0,
  "A2：作用 = display:none（父目录段整段不渲染；`:empty` 本来就 none，末段文件名不受影响）");
ok(crumbSel.indexOf('data-type="creation-board"') > 0,
  "A3：🔴 只作用于看板叶子 —— 笔记页 / 其它视图的路径**不藏**（老板要的是 base 页）");
ok(r30Seg.indexOf("view-header-title-parent") > 0 && r30Seg.indexOf("bases-toolbar") > 0,
  "A4：两条原生规则都在 R30 段内（有界切片没切漏）");

/* ================= B. ② 原生 Bases 工具条：视图名只留图标、计数不显示 ================= */
console.log("\n== R30 · ② 原生工具条手机端只留图标 ==");

const viewsSel = "body.is-phone .bases-toolbar .bases-toolbar-views-menu .text-button-label";
const cntSel = "body.is-phone .bases-toolbar .bases-toolbar-result-count";
ok(ruleOf(cbCss, viewsSel).indexOf("display: none") > 0,
  "B1：「创作看板」的 .text-button-label 手机端不显示（图标 = svg，不受影响）");
ok(ruleOf(cbCss, cntSel).indexOf("display: none") > 0,
  "B2：「344 个结果」(.bases-toolbar-result-count) 手机端整条不显示");
ok(viewsSel.indexOf("body.is-phone") === 0 && cntSel.indexOf("body.is-phone") === 0,
  "B3：🔴 作用域都是 body.is-phone —— 桌面 / 平板（is-mobile 而非 is-phone）不命中");
eq(count(/bases-toolbar-result-count/g, cbCss), 1, "B4：result-count 选择器只写 1 次");

/* ================= C. ③ 工具条：✎可编辑 最左，⚙板块 / ↻重载 靠右 ================= */
console.log("\n== R30 · ③ 工具条一行排布 ==");

const barMobile = ruleOf(r30Seg, ".cb-bar {");
ok(/display:\s*grid;/.test(barMobile) &&
   /grid-template-areas:[\s\S]{0,80}?"ro mid gear refresh"\s*\n\s*"mode count count count";/.test(barMobile),
  "C1：手机端工具条 = grid 两行模板「[✎可编辑]…[⚙板块][↻重载] / [模式][统计…]」——确定性布局，不赌 flex 折行");
const roMobile = ruleOf(r30Seg, ".cb-ro {");
ok(/grid-area:\s*ro;/.test(roMobile) && /margin-left:\s*0;/.test(roMobile),
  "C1b：.cb-ro 落在 ro 格 + 清掉桌面的 margin-left:auto" +
  "（🔴 不清就飘到行中间 —— 第一版实测 x=213）");
ok(/margin-left:\s*0;/.test(ruleOf(r30Seg, ".cb-gear {")),
  "C1c：⚙板块 同样清掉 auto —— 「靠右」由模板里的空 1fr 列负责（一个能力一条路）");
const cntMobile = ruleOf(r30Seg, ".cb-count {");
ok(/grid-area:\s*count;/.test(cntMobile) && /text-overflow:\s*ellipsis;/.test(cntMobile) &&
   /min-width:\s*0;/.test(cntMobile),
  "C2：自查项 —— 长统计（排除/截断护栏文案）手机端省略号收尾，不把按钮挤下去");
const roTouch = ruleOf(cbCss, ".is-mobile .cb-ro {");
ok(/padding:\s*5px 10px;/.test(roTouch),
  "C3：触控目标 .is-mobile .cb-ro 与 ↻重载同档（5px 10px，R29 的先例）");
const roBase = ruleOf(cbCss, ".cb-ro {");
ok(roBase.indexOf("order") < 0,
  "C4：🔴 桌面主规则 .cb-ro 没有 order —— 桌面一行不受影响");
ok(ruleOf(cbCss, ".cb-gear {").indexOf("margin-left: auto") > 0,
  "C5：🔴 桌面 .cb-gear 的 margin-left:auto 原样保留（手机端才清，桌面零影响）");

/* ================= D. ④ 设置页：日志/关于/帮助 挪到标签下一行、靠左 ================= */
console.log("\n== R30 · ④ 设置页小字挪行 ==");

const ghostMobile = ruleOf(kbtMobile, ".kbt-ghost-btns {");
ok(/flex-basis:\s*100%;/.test(ghostMobile), "D1：手机端三个小字按钮独占一行（flex-basis:100%）");
ok(/justify-content:\s*flex-start;/.test(ghostMobile), "D2：靠左（老板点名）");
ok(/order:\s*2;/.test(ghostMobile), "D3：排在标签后面（order:2，标签默认 0）");
ok(/margin-left:\s*0;/.test(ghostMobile), "D4：吃掉桌面的 margin-left:auto（那招只在桌面上靠右）");
ok(/\.kbt-tabs \{[^}]*flex-wrap:\s*wrap;/.test(kbtMobile),
  "D5：标签行允许折行（小字按钮才能落到第二行）");
const ghostDesk = ruleOf(kbtCss, ".kbt-ghost-btns {");
ok(/margin-left:\s*auto;/.test(ghostDesk),
  "D6：🔴 桌面 .kbt-ghost-btns 依旧 margin-left:auto 靠右（r18-211 守的规则没动）");

/* ================= E. ⑤ 核心操作：名字左 / 按钮右，不铺满、不贴边 ================= */
console.log("\n== R30 · ⑤ 核心操作一行排版 ==");

ok(/flex-direction:\s*row;/.test(ruleOf(kbtIsMobile, ".is-mobile .kbt-sec.kbt-core-actions .setting-item {")),
  "E1：手机端核心操作恢复横排（名字不再被按钮挤到上面）");
ok(/width:\s*auto;/.test(ruleOf(kbtIsMobile, ".is-mobile .kbt-sec.kbt-core-actions .setting-item-control {")),
  "E2：控件不再 width:100%（原生 @container 400px 的铺满被压掉）");
const e3 = ruleOf(kbtIsMobile, ".is-mobile .kbt-sec.kbt-core-actions .setting-item-control button:not(.clickable-icon) {");
ok(/width:\s*auto;/.test(e3) && /flex:\s*0 0 auto;/.test(e3),
  "E3：按钮 width:auto + 不许 flex 拉伸（「生成预览报告」回到自然大小）");
ok(kbtIsMobile.indexOf("kbt-core-actions") > 0 && kbtMobile.indexOf("kbt-core-actions") < 0,
  "E4：核心操作覆盖只落在 is-mobile 段（700px 段不重复写 —— 一个能力一条路）");
ok(/padding:\s*4px var\(--size-4-3\);/.test(ruleOf(kbtMobile, ".kbt-card {")),
  "E5：卡片内边距 8px → 12px（按钮/文字离白框远一点，老板点名）");
eq(count(/!important/g, kbtIsMobileCode) + count(/!important/g, r30SegCode), 0,
  "E7：🔴 本轮新规则零 !important —— 用特异性（body.is-mobile + 双类）压原生，可维护");
ok(!/\.is-mobile \.setting-item \{/.test(kbtCss),
  "E8：🔴 覆盖只压 .kbt-core-actions，没有全局 .setting-item 改写（辅助栏等带说明的行保持原生竖排）");

/* ================= F. 出货一致性（构建产物 = 源码） ================= */
console.log("\n== R30 · 出货一致性 ==");

ok(stylesCss.indexOf("view-header-title-parent") > 0, "F1：styles.css 已带上面包屑规则");
ok(stylesCss.indexOf("bases-toolbar-result-count") > 0, "F2：styles.css 已带上工具条计数规则");
ok(/"ro mid gear refresh"\s*\n\s*"mode count count count"/.test(stylesCss),
  "F3：styles.css 已带上工具条 grid 两行模板");
ok(stylesCss.indexOf("kbt-core-actions .setting-item-control button") > 0,
  "F4：styles.css 已带上核心操作按钮规则");

console.log("\nR30: " + pass + " 通过 / " + fail + " 失败");
if (fail) { process.exitCode = 1; }
