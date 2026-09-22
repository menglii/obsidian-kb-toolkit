/* kb-toolkit R32 断言：R31 遗留的 4 条（老板拍板「剩下 5 项也全做」）+ 1 条框架重构
 *
 * 老板拍板（2026-09-22）：
 *   · 范围 = 剩下 5 项全做
 *   · ① 先给影响说明，**之后再确认一轮** → 本轮**零代码改动**（F 段钉住「没擅自扩」）
 *   · ④ 极窄屏工具条 = **缩短按钮文案**（不做横向滚动）
 *
 * 本轮 5 项：
 *   ② .cb-prop-val 的 hover 复位（R31 有意留着没复位，怕「这里能改」的提示丢了）
 *      → 复位 + 补一条常驻虚线下划线顶上
 *   ③ 42 个 title 在触屏等于没有 → 自绘触屏气泡 .cb-tip（按住 ≈400ms 弹）
 *   ④ 极窄屏（≤360px）工具条 max-content 列永不收缩 → ✎可编辑 / ↻重载 只留图标
 *   ⑤ applySettingsChange 缺中央表重算 → 收口进去，87/75 两处手写调用删掉
 *   ① 只出影响说明，不动代码
 *
 * 🔴 铁律：
 *   · 断言按**意图**写（铁律 49）：不数「有几行 CSS」，而验「机制在不在」
 *   · 正则前剥注释
 *   · ④ 的图标字形必须与 vendor 原文同源 → 用断言盯着 vendor，不靠注释记着
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
/** 取某个完整 CSS 块（{...} 配平）—— 媒体查询 / 普规则通用 */
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
function segOf(text, mark, endMark) {
  const i = text.indexOf(mark);
  if (i < 0) return "";
  if (!endMark) return text.slice(i);
  const j = text.indexOf(endMark, i + 1);
  return j < 0 ? text.slice(i) : text.slice(i, j);
}

const read = (f) => fs.readFileSync(path.join(PLUG, f), "utf8");
const cbCss = read("styles_src/cb.css");
const kbtCss = read("styles_src/kbt.css");
const stylesCss = read("styles.css");
const vendor = read("vendor/creation-board.js");
const src85 = read("src/85_modules_base.js");
const src90 = read("src/90_entry.js");
const src87 = read("src/87_modules_wizard.js");
const src75 = read("src/75_core_settingTab.js");
const cbCode = stripComments(cbCss);

/* ══════════════ A. ⑤ 中央表重算收口（框架） ══════════════ */
console.log("\n== R32 · ⑤ 中央表重算收进 applySettingsChange ==");

const fnApply = segOf(src90, "function applySettingsChange(plugin, opts) {", "\n  }");
ok(fnApply.length > 200, "A0：取到了 applySettingsChange 本体（有界切片没切空）");
ok(/P\["router\.util"\]\.applySettings\(plugin\.settings\)/.test(fnApply),
  "A1：🔴 收口函数里重算中央表 —— 调用方只管改 settings，不再各自手写");
const c87 = stripComments(src87), c75 = stripComments(src75), c90 = stripComments(src90);
eq(count(/router\.util"\]\.applySettings\(/g, c87), 0,
  "A2：87（向导保存）的手写调用已删（原来 1 处）");
eq(count(/router\.util"\]\.applySettings\(/g, c75), 0,
  "A3：75（改路径）的手写调用已删（原来 1 处）");
eq(count(/router\.util"\]\.applySettings\(/g, c90), 2,
  "A4：90 里剩 2 处 —— 收口函数 1 处 + **onload 那条开机路径 1 处**");
ok(/applySettings\(this\.settings\)/.test(c90),
  "A5：🔴 onload 那条留着（开机没有「配置变更」可收口，走收口函数会白白多一次 saveSettings）");
ok(/开机路径/.test(src90), "A6：为什么留着写进注释了（下一个人不会以为漏了）");
const iRecalc = stripComments(fnApply).indexOf('router.util"].applySettings');
const iSave = stripComments(fnApply).indexOf("saveSettings");
ok(iRecalc > 0 && iSave > 0 && iRecalc < iSave,
  "A7：顺序 = 先重算中央表 → 再落盘 → 再 refresh/reapply（顺序错了等于白算）");
ok(/R32 ⑤/.test(src87) && /R32 ⑤/.test(src75),
  "A8：两处删掉的地方都留了一句「去哪儿了」（不是凭空消失）");

/* ══════════════ B. ③ 触屏气泡（源码级） ══════════════ */
console.log("\n== R32 · ③ 触屏气泡 title 替身（源码级） ==");

eq(count(/KB\.modules\.installTouchTips = installTouchTips;/g, stripComments(src85)), 1,
  "B1：导出恰 1 处（复写病自检）");
eq(count(/this\.touchTip = installTouchTips\(\);/g, stripComments(src85)), 1,
  "B2：BoardModule.onEnable 装 1 处");
eq(count(/this\.touchTip\.uninstall\(\);/g, stripComments(src85)), 1,
  "B3：BoardModule.onDisable 卸 1 处（模块一关，监听器一个不留）");
const fnTip = segOf(src85, "function installTouchTips(opts) {", "\n    return {");
ok(/if \(opts\.force !== true\)/.test(fnTip) && /\(hover: none\)/.test(fnTip) && /return null/.test(fnTip),
  "B4：🔴 桌面守卫 —— 不是 (hover:none) 直接 return null：桌面零监听器、零开销");
ok(/\.cb-root, \.cb-panel, \.cb-ed-pop/.test(src85),
  "B5：只认看板自己的 DOM（.cb-root / 面板 / 编辑浮层），不接管整篇文档");
eq(count(/doc\.addEventListener\(/g, fnTip), 5,
  "B6：5 条监听（touchstart / touchmove / touchend / touchcancel / scroll）");
/* 🔴 R34 修正：原来数的是**整个 src85 文件**的 doc.removeEventListener —— 只要同文件里
 *    任何**别的**模块也摘 document 监听（R34 的看板键盘通道就是这么干的），这条就假红。
 *    断言意图是「installTouchTips 把 5 条全摘」，故限定到**该函数体**（它内部只有
 *    uninstall 一处会摘监听；B6 已验过同一段里有 5 条 add）。 */
const fnTipBody = segOf(src85, "function installTouchTips(opts) {", "KB.modules.installTouchTips = installTouchTips;");
eq(count(/doc\.removeEventListener\(/g, stripComments(fnTipBody)), 5,
  "B7：uninstall 里 5 条**全摘**（漏一条 = 模块关了还在弹）");
ok(/TIP_HOLD_MS = 400/.test(src85) && /550ms/.test(src85),
  "B8：按住 400ms 出气泡 —— 故意 < vendor 长按的 550ms（先出说明，菜单后来者居上）");
ok(/TIP_LIFE_MS = 1200/.test(src85),
  "B9：气泡自己会走（长按是一直按着不放的，不能只靠抬手收）");
const tipRule = blockOf(cbCss, ".cb-tip {");
ok(/pointer-events:\s*none;/.test(tipRule),
  "B10：🔴 气泡 pointer-events:none —— 绝不能挡手指（它就在指尖上方）");
const zTip = parseInt((tipRule.match(/z-index:\s*(\d+)/) || [])[1] || "0", 10);
const zMask = parseInt(((blockOf(cbCss, ".cb-mask {") || "").match(/z-index:\s*(\d+)/) || [])[1] || "0", 10);
ok(zTip === 30 && zMask > zTip,
  "B11：🔴 z-index " + zTip + " < 浮层遮罩 " + zMask + " < 长按菜单 --layer-modal(100)"
  + " —— 菜单出来盖住它，两者不打架");
ok(/--layer-modal/.test(blockOf(cbCss, ".cb-ctxmenu {")),
  "B12：长按菜单确实走 --layer-modal（高层级），气泡不会被它反过来压住");
ok(tipRule.indexOf("position: fixed") > 0,
  "B13：position:fixed —— 挂在 body 上，不进看板的滚动容器（第七轮教训：挂卡片里会被裁）");
const nTitles = count(/setAttr\("title"/g, vendor);
ok(nTitles >= 40,
  "B14：vendor 里确有 %d 处 title（触屏没有 hover → 这些说明原本一个都看不见）".replace("%d", nTitles));

/* ══════════════ C. ③ 真 DOM 冒烟（jsdom，跑出货 main.js） ══════════════ */
console.log("\n== R32 · ③ 真 DOM 冒烟（jsdom） ==");

const { JSDOM } = require("jsdom");
const dom = new JSDOM(
  "<body><div class='cb-root' id='r'>"
  + "<button id='b1' title='点一下就地改这个属性'>v</button>"
  + "<button id='b2'>no title</button></div>"
  + "<button id='b3' title='看板外'>out</button></body>");
const doc = dom.window.document;
global.document = doc;
global.window = dom.window;
const Module = require("module");
const STUB = require("./stub_obsidian.js");
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return STUB;
  return origLoad.apply(this, arguments);
};
require(path.join(PLUG, "main.js"));
const KB = globalThis.KB;
const install = KB.modules.installTouchTips;
ok(typeof install === "function", "C0：出货 main.js 里能取到 installTouchTips（构建产物 = 源码）");

function touch(el, type, x, y) {
  const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
  e.touches = [{ clientX: x, clientY: y }];
  el.dispatchEvent(e);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  const h = install({ force: true, holdMs: 5, doc: doc, win: dom.window });
  ok(h && typeof h.uninstall === "function", "C1：触屏（force）装上，返回句柄");

  touch(doc.getElementById("b1"), "touchstart", 120, 300);
  await wait(80);
  const tip1 = doc.body.querySelector(".cb-tip");
  ok(!!tip1, "C2：🔴 按住看板内带 title 的按钮 → 气泡真的出来");
  eq(tip1 && tip1.textContent, "点一下就地改这个属性", "C3：气泡文本 = 那个 title（不是别的）");
  eq(tip1 && tip1.getAttribute("role"), "tooltip", "C4：带 role=tooltip（读屏能读）");
  ok(tip1 && tip1.parentNode === doc.body,
    "C5：🔴 挂在 body 上，不在 .cb-root 里（跟 position:fixed 配套，不会被滚动容器裁）");
  ok(tip1 && /px$/.test(tip1.style.top) && parseFloat(tip1.style.top) >= 4,
    "C6：定位自校准（top 带 px 且 ≥4，不写死坐标）");

  touch(doc.getElementById("b1"), "touchend", 120, 300);
  ok(!doc.body.querySelector(".cb-tip"), "C7：抬手 → 立刻撤（不留残影）");

  touch(doc.getElementById("b3"), "touchstart", 40, 40);
  await wait(80);
  ok(!doc.body.querySelector(".cb-tip"),
    "C8：🔴 看板**外面**的带 title 按钮 → 不弹（只认 .cb-root / .cb-panel / .cb-ed-pop）");

  touch(doc.getElementById("b2"), "touchstart", 60, 200);
  await wait(80);
  ok(!doc.body.querySelector(".cb-tip"), "C9：看板内但**没有 title** → 不弹（空气泡没意义）");

  touch(doc.getElementById("b1"), "touchstart", 100, 100);
  touch(doc.getElementById("b1"), "touchmove", 100, 140);   /* 位移 40px > 10px */
  await wait(80);
  ok(!doc.body.querySelector(".cb-tip"),
    "C10：🔴 手指移动 >10px（要滚动/拖动）→ 撤，不误弹（跟 vendor 长按同口径）");

  h.uninstall();
  touch(doc.getElementById("b1"), "touchstart", 100, 100);
  await wait(80);
  ok(!doc.body.querySelector(".cb-tip"), "C11：uninstall 之后再摸 → 一条都不弹（监听器真摘干净了）");

  const desk = install({
    doc: doc, win: {
      matchMedia: function () { return { matches: false }; },
      setTimeout: dom.window.setTimeout.bind(dom.window),
      clearTimeout: dom.window.clearTimeout.bind(dom.window),
      innerWidth: 1024,
    },
  });
  eq(desk, null,
    "C12：🔴 桌面（(hover:none) 不匹配）→ 返回 null，一个监听器都不装");
  Module._load = origLoad;

  /* ══════════════ D. ② .cb-prop-val 的 hover 复位 ══════════════ */
  console.log("\n== R32 · ② .cb-prop-val：hover 复位 + 常驻提示顶上 ==");

  const hoverBlock = blockOf(cbCss, "@media (hover: none) {");
  ok(hoverBlock.length > 100, "D0：取到 @media (hover:none) 整块（配平切片）");
  eq(count(/\.cb-prop-val:hover/g, hoverBlock), 1,
    "D1：🔴 hover:none 块里复位 .cb-prop-val 恰 1 处（复写病自检）");
  const pvRule = blockOf(hoverBlock, ".cb-prop-val:hover {");
  ok(/background-color:\s*transparent/.test(pvRule) && /box-shadow:\s*none/.test(pvRule),
    "D2：复位了灰底 + 光环 —— 触屏点过之后不再粘住（看着像「还开着」）");
  const everRule = blockOf(hoverBlock, ".cb-root:has(.cb-ro:not(.is-on)) .cb-prop-val:not(.is-empty) {");
  ok(everRule.length > 50 && /text-decoration:\s*underline/.test(everRule),
    "D3：🔴 补一条**常驻**下划线 —— 复位之后「这里能改」不能跟着没了");
  ok(/not\(\.is-on\)/.test(everRule),
    "D4：只在**可编辑态**出现（.cb-ro.is-on = 只读开启，那时候本来就改不动）");
  ok(/not\(\.is-empty\)/.test(everRule), "D5：空值不给（空值点了也没东西改）");
  ok(/text-underline-offset/.test(everRule), "D6：下划线不压字（有 offset）");
  ok(count(/\.cb-prop-val:hover/g, cbCode) === 2,
    "D7：全文件 .cb-prop-val:hover 恰 2 处 = 桌面基础 1 + 触屏复位 1（桌面那条没被改）");
  ok(blockOf(cbCss, ".cb-prop-val:hover {").indexOf("background-modifier-hover") > 0,
    "D8：🔴 桌面对照：hover 灰底原样还在（本轮只动触屏）");

  /* ══════════════ E. ④ 极窄屏缩短按钮文案 ══════════════ */
  console.log("\n== R32 · ④ 极窄屏（≤360px）工具条只留图标 ==");

  eq(count(/@media \(max-width: 360px\)/g, cbCode), 1,
    "E1：极窄块恰 1 处（不新开第二块跟自己打架）");
  const narrow = blockOf(cbCss, "@media (max-width: 360px) {");
  ok(/font-size:\s*0/.test(narrow),
    "E2：🔴 font-size:0 压掉文本节点 —— vendor 把文字直接塞进 <button>（vendor:763/783），"
    + "没有子元素可以 display:none，只能让文本节点不占宽");
  ok(/content:\s*"✎"/.test(narrow) && /content:\s*"↻"/.test(narrow),
    "E3：再用 ::before 把图标字形补回来（只留图标 = 老板拍板的「缩短文案」）");
  /* 🔴 图标字形与 vendor 文案同源：改 vendor 文案 → 这里立刻假红，不会静默失配 */
  const roText = (vendor.match(/cls:\s*"cb-ro",\s*text:\s*"([^"]+)"/) || [])[1] || "";
  const rfText = (vendor.match(/cls:\s*"cb-refresh",\s*text:\s*"([^"]+)"/) || [])[1] || "";
  ok(roText.indexOf("✎") === 0 && rfText.indexOf("↻") === 0,
    "E4：🔴 字形与 vendor 原文同源（vendor 现文：%s / %s）—— 改文案会假红".replace("%s", roText).replace("%s", rfText));
  ok(!/overflow-x:\s*(auto|scroll)/.test(narrow) && !/\.cb-bar[\s\S]{0,200}overflow/.test(narrow),
    "E5：不做横向滚动（老板选的是缩短文案，不是加滚动条）");
  ok(!/\.cb-gear-text/.test(narrow),
    "E6：🔴 ⚙板块 的「板块」二字**留着** —— 它是看板设置的唯一入口，且 vendor 没给它 title（气泡也救不回来）");
  ok(!/\.kbt-/.test(narrow), "E7：极窄块只动看板，不碰插件设置页（各自守各自的台面）");
  ok(stylesCss.indexOf('content: "✎"') > 0 && stylesCss.indexOf("@media (max-width: 360px)") > 0,
    "E8：构建产物 styles.css 同步带上（出货 = 源码）");
  ok(blockOf(cbCss, ".cb-ro {").indexOf("font-size: var(--font-ui-smaller)") > 0,
    "E9：🔴 桌面基础 .cb-ro 字号原样（极窄规则只在 ≤360px 命中）");
ok(/justify-self:\s*start/.test(narrow),
    "E10：🔴 光 font-size:0 不够 —— 盒子还会被 grid 列拉满（第一列跟第二行 .cb-mode 共用列宽），"
    + "必须 justify-self:start 才收得住（真机实测：126px → 40px）");

  /* ══════════════ F. ① 本轮不动（只出影响说明，等老板下轮确认） ══════════════ */
  console.log("\n== R32 · ① 本轮**不动**：R30 ⑤ 的作用域没被擅自扩大 ==");

  const kbtIsMobile = segOf(kbtCss, "R30（boss 第 5 条）", "Obsidian 移动端（body.is-mobile）");
  ok(/\.is-mobile/.test(kbtIsMobile) && !/@media/.test(kbtIsMobile),
    "F1：🔴 R30 ⑤ 仍是 body.is-mobile 作用域，**没有**被扩成 @media(max-width:700px) 的窄桌面窗口"
    + " —— 老板说「先说明影响，之后再确认一轮」，本轮一行不动");

  console.log("\nR32: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exit(fail ? 1 : 0);
})();
