/* kb-toolkit R33 断言：与 Claude Code（design-review）交叉评审后的**界面 / 交互打磨轮**
 *
 * 流程（照 R31 立的规矩）：Claude 两路只读评审（A 视觉一致性 / B 交互与两端一致性）
 *   + 我自己一份**独立量化基线**，两边对撞上的才落地，落地即写成断言。
 *
 * 本轮落地的 9 项：
 *   ① P0 状态浮层卡死：buildPop 宿主 box → containerEl（模块关闭时整段 pointer-events:none，
 *      ✕ 和遮罩都收不到点击，手机端**没有出口**）；顺带给所有小窗补 Esc
 *   ② 触屏 hover **根治**：30 条顶层 :hover 规则就地包进 @media (hover: hover)
 *      （原来是「hover:none 里逐条复位」的白名单，实测漏 26 个选择器，且只清了
 *       background/box-shadow → 触屏点完是「透明底 + 亮字」）
 *   ③ 触控兜底扩面：只认 <button> → 按可点语义 :is(...)，补上开关胶囊 / 拉杆 / 目录树 /
 *      拖拽手柄 / 属性值；浮层（挂 body）另补一条
 *   ④ 触屏 :active 按下反馈（原来全项目只有 1 处 :active，还是 cursor）
 *   ⑤ 触控下限口径统一：cb 30 / kbt 34·36 三个数 → 统一 34（三文件同值）
 *   ⑥ kbt 尺寸类从 @media(max-width:700px) 搬进 .is-mobile（横屏手机 >700 不命中的坑）
 *   ⑦ 面板回执截断（nowrap 不截断会把 ✕ 挤出面板）
 *   ⑧ ns.css 内容流补手机端兜底（此前 is-mobile / hover:none **一条都没有**）
 *   ⑨ 触屏气泡作用域扩到右键菜单 .cb-ctxmenu
 *
 * 🔴 铁律：断言按**意图**写（49）；正则前剥注释；桌面零影响必须可验证。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const PLUG = path.join(__dirname, "..");
let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL " + n); } }
function eq(a, b, n) { ok(a === b, n + " (got=" + JSON.stringify(a) + " want=" + JSON.stringify(b) + ")"); }
function count(re, s) { return (s.match(re) || []).length; }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ""); }

/** 扫描一段 CSS 里的**直接子块**：每遇 `{` 就整块跳到它的 `}` 之后
 *  → 只返回这一层的块（@media 内部永远扫不到，正好用来区分「顶层」与「嵌在媒体查询里」）。 */
function topBlocks(s) {
  const out = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    if (s[i] !== "{") { i++; continue; }
    let j = i - 1;
    while (j >= 0 && s[j] !== "{" && s[j] !== "}") j--;
    const header = s.slice(j + 1, i);
    let k = i + 1, d = 1;
    while (k < n) {
      if (s[k] === "{") d++;
      else if (s[k] === "}") { d--; if (d === 0) break; }
      k++;
    }
    out.push({ header: header.trim(), body: s.slice(i + 1, k), raw: s.slice(j + 1, k + 1) });
    i = k + 1;
  }
  return out;
}
/** 取某个 header 开头的完整块（含 header 与外层大括号） */
function blockOf(text, header) {
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
function allBlocksOf(text, header) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(header, from);
    if (i < 0) break;
    const j = text.indexOf("{", i + header.length - 1);
    if (j < 0) break;
    let depth = 0, k = j;
    for (; k < text.length; k++) {
      if (text[k] === "{") depth++;
      else if (text[k] === "}") { depth--; if (depth === 0) { k++; break; } }
    }
    out.push(text.slice(i, k));
    from = k;
  }
  return out;
}

const read = (f) => fs.readFileSync(path.join(PLUG, f), "utf8");
const cbCss = stripComments(read("styles_src/cb.css"));
const kbtCss = stripComments(read("styles_src/kbt.css"));
const nsCss = stripComments(read("styles_src/ns.css"));
const src75 = stripComments(read("src/75_core_settingTab.js"));
const src85 = stripComments(read("src/85_modules_base.js"));

console.log("\n=== R33: 打磨轮（与 Claude Code design-review 交叉评审） ===");

/* ---------------- A. 触屏 hover 根治 ---------------- */
console.log("\n-- A. 触屏 hover：让规则**不生效**，而不是生效后再打补丁 --");

const FILES = [["cb.css", cbCss], ["kbt.css", kbtCss], ["ns.css", nsCss]];
let topHover = 0;
for (const [name, s] of FILES) {
  const n = topBlocks(s).filter((b) => b.header.includes(":hover") && !b.header.startsWith("@")).length;
  topHover += n;
  eq(n, 0, "A1-" + name + "：顶层（不在任何 @media 里）的 :hover 规则 = 0 —— 触屏根本不加载");
}
eq(topHover, 0, "A1z：三个文件合计顶层 :hover = 0（R33 前是 30 条）");

const hh = {};
for (const [name, s] of FILES) {
  const blocks = allBlocksOf(s, "@media (hover: hover)");
  hh[name] = blocks;
  ok(blocks.length >= 1, "A2-" + name + "：存在 @media (hover: hover) 块（" + blocks.length + " 块）");
}
// 每条 hover:hover 块内的直接子规则数之和 = 被包裹的条数
function directRules(blockText) {
  const inner = blockText.slice(blockText.indexOf("{") + 1, blockText.lastIndexOf("}"));
  return topBlocks(inner);
}
const wrapped = {};
for (const [name, blocks] of Object.entries(hh)) {
  wrapped[name] = blocks.reduce((a, b) => a + directRules(b).length, 0);
}
eq(wrapped["cb.css"], 20, "A3-cb：cb.css 包进 hover:hover 的 hover 规则 = 20 条");
eq(wrapped["kbt.css"], 8, "A3-kbt：kbt.css = 8 条（设置页此前**一条**复位都没有）");
eq(wrapped["ns.css"], 2, "A3-ns：ns.css = 2 条（内容流此前连 hover:none 块都没有）");

// 抽查：属性没被搬丢（不是只搬了个空壳）
const cbHH = hh["cb.css"].join("\n");
ok(/\.cb-pros-toggle:hover[\s\S]{0,200}interactive-accent/.test(cbHH),
  "A4：.cb-pros-toggle:hover 的 accent 背景在 hover:hover 块里**原样保留**（搬运没丢属性）");
const kbtHH = hh["kbt.css"].join("\n");
ok(/\.kbt-sec\.kbt-status-card:hover/.test(kbtHH),
  "A5：设置页状态卡（整栏可点、点完灰底赖着）也进了 hover:hover");
ok(/\.bns-item:hover/.test(hh["ns.css"].join("\n")), "A6：内容流卡片 hover 同样根治");

// R32 的 ② 不能被破坏：复位块 + 常驻下划线都还在
const cbHN = allBlocksOf(cbCss, "@media (hover: none)").join("\n");
ok(/\.cb-prop-val:hover[\s\S]{0,120}background-color:\s*transparent/.test(cbHN),
  "A7：R32 ② 的 .cb-prop-val 复位仍在（hover:none 块没被搬空）");
ok(/text-decoration:\s*underline dashed/.test(cbHN),
  "A8：R32 ② 的常驻虚线下划线仍在（复位后「这里能改」的提示没丢）");

// 桌面等价性：包裹后层叠顺序不变 —— 不往 hover:hover 块里塞其它口径
let mixScope = 0;
for (const [, blocks] of Object.entries(hh)) {
  for (const b of blocks) if (/\.is-mobile|max-width|is-phone/.test(b)) mixScope++;
}
eq(mixScope, 0, "A9：hover:hover 块内**不混**手机端口径（口径各管各的）");
let nested = 0;
for (const [, blocks] of Object.entries(hh)) {
  for (const b of blocks) {
    const inner = b.slice(b.indexOf("{") + 1, b.lastIndexOf("}"));
    for (const r of topBlocks(inner)) if (r.header.startsWith("@")) nested++;
  }
}
eq(nested, 0, "A10：hover:hover 块内不再嵌套 @media（保持「就地包裹」= 层叠顺序一字不变）");

/* ---------------- B. P0：状态浮层不再把手机端卡死 ---------------- */
console.log("\n-- B. P0：模块关闭时点「当前状态」→ 遮罩点不掉（手机端无出口） --");

eq(count(/buildPop\(\s*box\s*,/g, src75), 0,
  "B1：buildPop 的宿主**不再是段落盒 box**（.kb-module-disabled 的 pointer-events:none 会继承）");
eq(count(/buildPop\(\s*containerEl\s*,/g, src75), 3,
  "B2：帮助 / 关于 / 状态三处浮动窗统一挂 containerEl（与另两处同口径）");
ok(/function\s+bindEscClose/.test(src75), "B3：bindEscClose 存在 —— 浮动窗可以 Esc 关");
ok(/openPop[\s\S]{0,400}bindEscClose\(\)/.test(src75), "B4：openPop 里真的调了 bindEscClose（不是摆设）");
ok(/escBound\s*\|\|/.test(src75) || /if\s*\(\s*escBound/.test(src75),
  "B5：Esc 监听有「只绑一次」的守卫（设置页每渲染一遍重建一批 pop，不然会泄漏）");
ok(/hasAttribute\(\s*"hidden"\s*\)/.test(src75), "B6：Esc 只关**当前开着**的那个（按 hidden 判断）");

/* ---------------- C. 触控兜底扩面 + 口径统一 ---------------- */
console.log("\n-- C. 触控兜底：从「按元素名」改成「按可点语义」 --");

const cbMobile = topBlocks(cbCss).filter((b) => b.header.includes(".is-mobile")).map((b) => b.raw).join("\n");
ok(/:is\([^)]*checkbox-container/.test(cbMobile), "C1：兜底覆盖**开关胶囊**（vendor 用 label 做的，34×19，不是 button）");
ok(/:is\([^)]*cb-prop-val/.test(cbMobile), "C2：兜底覆盖**卡片属性值**（div，≈17px）");
ok(/:is\([^)]*cb-tree-node/.test(cbMobile), "C3：兜底覆盖**目录树行**（div，≈17px）");
ok(/:is\([^)]*cb-grip/.test(cbMobile), "C4：兜底覆盖**拖拽手柄**（span，≈14px）");
ok(/input\.cb-wrange[\s\S]{0,80}height:\s*34px/.test(cbMobile), "C5：拉杆热区抬到 34px（轨道仍是 5px）");
ok(/cb-ctx-wrow[\s\S]{0,60}cb-wrange[\s\S]{0,60}max-width:\s*none/.test(cbMobile),
  "C6：菜单里那条拉杆的 max-width: 92px 放宽");
ok(/\.cb-ed-pop\s+:is\([\s\S]{0,60}cb-ed-fs[\s\S]{0,60}min-height:\s*34px/.test(cbMobile),
  "C7：就地编辑浮层（挂在 body 上、不在 .cb-root 里）单独补了兜底");

// 三文件手机端触控下限必须同值
const cbs = (cbMobile.match(/min-height:\s*(\d+)px/g) || []).map((x) => x.replace(/\D/g, ""));
const kbts = (topBlocks(kbtCss).filter((b) => b.header.includes(".is-mobile")).map((b) => b.raw).join("\n")
  .match(/min-height:\s*(\d+)px/g) || []).map((x) => x.replace(/\D/g, ""));
const nss = (topBlocks(nsCss).filter((b) => b.header.includes(".is-mobile")).map((b) => b.raw).join("\n")
  .match(/min-height:\s*(\d+)px/g) || []).map((x) => x.replace(/\D/g, ""));
const uniq = (a) => Array.from(new Set(a)).sort();
eq(uniq(cbs).join(","), "34", "C8-cb：cb.css 手机端 min-height 只剩 34px（原 30px，与另两个文件不同值）");
eq(uniq(kbts).join(","), "34", "C9-kbt：kbt.css 手机端 = 34px（原 34 / 36 两个数）");
eq(uniq(nss).join(","), "34", "C10-ns：ns.css 手机端 = 34px（新增，此前 0）");
eq(uniq(cbs.concat(kbts, nss)).join(","), "34", "C11：三个文件手机端触控下限**同值 34px**");

// kbt 的尺寸类已搬出 700px 块
const kbt700 = allBlocksOf(kbtCss, "@media (max-width: 700px)").join("\n");
eq(count(/min-height/g, kbt700), 0,
  "C12：kbt 的 @media(700px) 块里已经没有 min-height —— 尺寸类搬到 .is-mobile（手机横屏 >700 也命中）");
ok(/\.kbt-switch\s+\.checkbox-container/.test(topBlocks(kbtCss).filter((b) => b.header.includes(".is-mobile")).map((b) => b.raw).join("\n")),
  "C13：开关胶囊也跟着搬进 .is-mobile");

/* ---------------- D. 触屏按下反馈 ---------------- */
console.log("\n-- D. :active —— 触屏的按下反馈通道 --");

for (const [name, s] of FILES) {
  const hn = allBlocksOf(s, "@media (hover: none)").join("\n");
  ok(/:active/.test(hn), "D1-" + name + "：" + name + " 在 (hover:none) 里有 :active 按下反馈");
}
const actives = FILES.map(([, s]) => allBlocksOf(s, "@media (hover: none)").join("\n")).join("\n");
ok(!/:active[\s\S]{0,300}transform/.test(actives) && !/:active[\s\S]{0,300}width:/.test(actives)
  && !/:active[\s\S]{0,300}height:/.test(actives),
  "D2：:active 只改背景色，不碰尺寸/位移（卡片高亮那条注释要求「绝不让卡片跳一下」）");
// 桌面零命中：块外的 :active 只允许改 cursor，不许有视觉变化
// （cb.css 本来就有一条 .cb-grip:active { cursor: grabbing }，桌面命中也无害）
let activeOutsideVisual = 0;
for (const [, s] of FILES) {
  let outside = s;
  for (const b of allBlocksOf(s, "@media (hover: none)")) outside = outside.replace(b, "");
  for (const r of topBlocks(outside)) {
    if (r.header.includes(":active") && /background-color|background\s*:/.test(r.body)) activeOutsideVisual++;
  }
}
eq(activeOutsideVisual, 0,
  "D3：桌面也会命中的 :active **没有任何视觉变化**（新增的视觉反馈全在 (hover:none) 里）");

/* ---------------- E. 面板回执不再把 ✕ 挤出窗外 ---------------- */
console.log("\n-- E. 面板回执截断 --");

const msg = blockOf(cbCss, ".cb-panel-msg {");
ok(/white-space:\s*nowrap/.test(msg), "E1：仍是一行（nowrap 保留）");
ok(/min-width:\s*0/.test(msg) && /overflow:\s*hidden/.test(msg) && /text-overflow:\s*ellipsis/.test(msg),
  "E2：补上 min-width:0 + overflow:hidden + ellipsis 三件套 —— 长回执不再把 ✕ 挤出面板被裁掉");

/* ---------------- F. 触屏气泡扩到右键菜单 ---------------- */
console.log("\n-- F. 触屏气泡（R32 ③）扩域 --");

const scope = (src85.match(/var\s+TIP_SCOPE\s*=\s*"([^"]*)"/) || [])[1] || "";
ok(/cb-ctxmenu/.test(scope), "F1：气泡作用域含右键菜单 .cb-ctxmenu（vendor 挂 body，原来不在范围内）");
ok(/cb-root/.test(scope) && /cb-panel/.test(scope) && /cb-ed-pop/.test(scope),
  "F2：原来的三个作用域一个都没丢");

/* ---------------- G. 桌面零影响（口径没混） ---------------- */
console.log("\n-- G. 桌面零影响：手机端规则都有门控 --");

const cbBps = (cbCss.match(/@media[^{]*max-width:\s*(\d+)px/g) || []).map((x) => x.replace(/\D/g, ""));
eq(Array.from(new Set(cbBps)).sort().join(","), "360,700",
  "G1：cb.css 窄屏断点仍是 700 + 360 两档（R33 没新增第三档）");
eq(count(/\.is-mobile/g, nsCss) > 0, true,
  "G2：ns.css 现在有 .is-mobile 门控（R33 前是 0 —— 内容流零手机端适配）");
let leak = 0;
for (const [name, s] of FILES) {
  for (const b of topBlocks(s)) {
    if (b.header.startsWith("@")) continue;
    if (/min-height:\s*34px|min-height:\s*30px/.test(b.body) && !/\.is-mobile/.test(b.header)) leak++;
  }
}
eq(leak, 0, "G3：抬触控下限的规则**全部**带 .is-mobile 门控（桌面鼠标目标不被撑胖）");

console.log("\nR33: " + pass + " 通过 / " + fail + " 失败");
if (fail) { console.log("失败项："); fails.forEach((f) => console.log("  - " + f)); process.exitCode = 1; }
