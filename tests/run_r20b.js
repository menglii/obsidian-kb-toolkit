/* R20b 看板「真 DOM 冒烟」：用 jsdom 跑**出货代码**里的内嵌创作看板
 *   （vendor/creation-board.js 经 build 内嵌进 main.js，KB.modules.CreationBoardPlugin）
 * 目的：run_r20 的看板断言是**源码级正则**，抓不到「改完当场抛异常」这类运行时错。
 *   这里把视图真造出来，把顶栏齿轮 / 板块设置面板 / 板块编辑行真渲染一遍并点击。
 * R21 追加：「卡片」组那一行「文件宽度 [拉杆] ＋ 自动 [开关]」也真渲染真点
 *   （拨开关 / 推拉杆 → 验 config 写回 + 面板不崩 + 拉杆置灰解除）。
 * 只读：不写任何笔记、不落盘。 */
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<body><div id='view'></div></body>");
global.document = dom.window.document;
global.window = dom.window;
const W = dom.window;
dom.window.Element.prototype.createEl = function (tag, opts) {
  opts = opts || {};
  const el = document.createElement(tag);
  if (opts.cls) el.className = opts.cls;
  if (opts.type) el.setAttribute("type", opts.type);   /* 桩要保真：type 必须落到属性上 */
  if (opts.attr) for (const k in opts.attr) el.setAttribute(k, opts.attr[k]);
  if (opts.text != null) el.textContent = opts.text;
  this.appendChild(el);
  return el;
};
dom.window.Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
dom.window.Element.prototype.createSpan = function (o) { return this.createEl("span", o || {}); };
dom.window.Element.prototype.createDiv = function (o) { return this.createEl("div", o || {}); };
dom.window.Element.prototype.addClass = function (c) { this.classList.add(c); return this; };
dom.window.Element.prototype.removeClass = function (c) { this.classList.remove(c); return this; };
dom.window.Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); return this; };
dom.window.Element.prototype.hasClass = function (c) { return this.classList.contains(c); };
dom.window.Element.prototype.setAttr = function (k, v) { this.setAttribute(k, v); return this; };
dom.window.Element.prototype.setText = function (t) { this.textContent = t; return this; };
dom.window.Element.prototype.detach = function () { if (this.parentNode) this.parentNode.removeChild(this); };
dom.window.Text.prototype.setText = function (t) { this.textContent = t; return this; };

const STUB = require("./stub_obsidian.js");
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return STUB;
  if (request === "jsdom") return require("jsdom");
  return origLoad.apply(this, arguments);
};

const PLUG = path.join(__dirname, "..");
require(path.join(PLUG, "main.js"));
const KB = globalThis.KB;

const SVGNS = "http://www.w3.org/2000/svg";
let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL " + n); } }
function eq(a, b, n) { ok(a === b, n + " (got=" + JSON.stringify(a) + " want=" + JSON.stringify(b) + ")"); }
function click(el) { el.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true })); }
function fire(el, type) { el.dispatchEvent(new W.Event(type, { bubbles: true, cancelable: true })); }
function key(el, k) { el.dispatchEvent(new W.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); }
function head(t) { console.log("\n== " + t); }

const SAVES = [];
function makeConfig(obj) {
  const o = Object.assign({}, obj);
  const q = { formulas: null, saveCount: 0, save() { q.saveCount++; } };
  return {
    data: o, query: q,
    get(k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; },
    set(k, v) {
      SAVES.push({ key: k, val: v === null ? null : JSON.parse(JSON.stringify(v)) });
      if (v === null) delete o[k]; else o[k] = v;
      q.save();
    },
    getOrder() { return []; }, getSort() { return []; },
  };
}

(async function main() {
  const app = STUB.makeApp();
  const Board = KB.modules.CreationBoardPlugin;
  ok(typeof Board === "function", "内嵌创作看板插件类可取得（KB.modules.CreationBoardPlugin）");
  const inst = new Board(app, { id: "creation-board", dir: ".obsidian/plugins/kb-toolkit/embed-creation-board" });
  inst.data = {};
  await inst.load();
  eq(inst._basesViews.length, 1, "registerBasesView 被调用 1 次（视图类型 = " + (inst._basesViews[0] || {}).id + "）");
  const reg = inst._basesViews[0].def;
  ok(typeof reg.factory === "function", "视图 factory 可取得");

  const host = document.getElementById("view");
  const v = reg.factory({ app: app, containerEl: host }, host);
  v.config = makeConfig({
    "板块": [
      { "名称": "收件箱", "数据源": "folder", "路径": "01_新知识库", "递归深度": 1, "上限": 30 },
      { "名称": "收容所", "数据源": "catchall" },
    ],
  });
  v.data = { data: [], groupedData: [] };
  /* 灌两篇虚拟笔记进桩的库（不碰真库）+ 造 Bases 条目 —— 这样板块头才会真渲染出来，
     板块标题旁的齿轮才有得验。条目形状按 Bases 的契约（file / frontmatter / getValue）。 */
  await app.vault.createFolder("01_新知识库");
  for (const [p, fm] of [["01_新知识库/笔记1.md", { 简介: "甲", 状态: "在做" }],
                         ["01_新知识库/笔记2.md", { 简介: "乙" }]]) {
    const f = await app.vault.create(p, "正文内容");
    f.stat = { size: 4, mtime: 1, ctime: 1 };
    f.cache = { frontmatter: fm, tags: [] };
  }
  v.data = {
    data: ["01_新知识库/笔记1.md", "01_新知识库/笔记2.md"].map(p => ({
      file: {
        path: p, name: p.split("/").pop(), basename: p.split("/").pop().replace(/\.md$/, ""),
        extension: "md", parent: { path: p.split("/").slice(0, -1).join("/") }, stat: { mtime: 1, size: 4 },
      },
      frontmatter: (p.indexOf("笔记1") >= 0) ? { 简介: "甲", 状态: "在做" } : { 简介: "乙" },
      getValue() { return null; },
    })),
    groupedData: [],
  };
  v.repaint(false);
  eq(v.secs.length, 2, "配置读回 2 个板块（folder + catchall）");
  eq(v.sections.length, 1, "默认只渲染出 1 个 —— 收容所默认隐藏（没配过时跟随插件设置）");
  eq(v.sections[0].entries.length, 2, "folder 板块命中 2 篇（条目从 Bases 结果来）");

  /* ---------- ① 顶栏齿轮：自绘 SVG ---------- */
  head("需求3 · 顶栏齿轮是自绘 SVG");
  const gearBtn = v.rootEl.querySelector("button.cb-gear");
  ok(!!gearBtn, "顶栏 .cb-gear 按钮已建");
  const svg = gearBtn.querySelector("svg");
  ok(!!svg, "按钮里真有 <svg> 元素（createElementNS 在 jsdom 里也成）");
  ok(svg && svg.namespaceURI === SVGNS, "svg 在 SVG 命名空间里（namespaceURI=" + (svg && svg.namespaceURI) + "）");
  ok(svg && svg.querySelector("circle") && svg.querySelector("path"), "图标 = 圆环 + 轮齿两段");
  ok(svg && svg.getAttribute("stroke") === "currentColor" && svg.getAttribute("width") === "14",
    "stroke=currentColor / 14px（跟文字色走，深浅主题都不突兀）");
  eq(gearBtn.textContent, "板块", "按钮文字只剩「板块」（emoji 已不在文本里）");

  /* ---------- ② 打开面板：三段式 ---------- */
  head("需求4-② · 面板三段式 + 开关化");
  ok(v.panelEl.hasClass("is-hidden"), "面板默认收着");
  click(gearBtn);
  ok(v.panelOpen && !v.panelEl.hasClass("is-hidden"), "点齿轮 → 面板打开");
  const kids = [...v.panelBodyEl.children];
  eq(kids.length, 4, "面板正文正好 4 段（卡片 / 看板行为 / 板块 / 高级）");
  const grpLabels = [...v.panelBodyEl.querySelectorAll(".cb-grp > .cb-grp-lb")].map(e => e.textContent);
  eq(grpLabels.join(","), "卡片,看板行为,板块", "前三段的段落名（高级那段是 <details>，不带小标签）");
  eq(kids[3].tagName, "DETAILS", "第四段是 <details>（高级，默认折叠）");
  eq(kids[3].querySelector("summary").textContent, "高级", "高级组 summary 只留「高级」两字");

  /* ---------- ②' R21：宽度 + 自动并成一行（真 DOM，源码正则抓不到抛异常） ---------- */
  head("R21 · 「卡片」组：文件宽度 [拉杆] ＋ 自动 [开关] 一行");
  const cardGrp = kids[0];
  ok(cardGrp.hasClass("cb-grp"), "第一段就是「卡片」组");
  const wrow = cardGrp.querySelector(".cb-grp-body > .cb-wrow");
  ok(!!wrow, "组里就是一行 .cb-wrow");
  const wrange = wrow && wrow.querySelector("input.cb-wrange");
  const wautoSw = wrow && wrow.querySelector(".cb-wauto .checkbox-container");
  ok(!!wrange && !!wautoSw, "拉杆与「自动」开关落在**同一行**里（原生视图选项面板做不到）");
  eq(wrow && wrow.querySelector(".cb-wlb").textContent, "文件宽度", "行首标签 = 文件宽度");
  eq(wrange && wrange.getAttribute("type"), "range", "宽控件是 range 拉杆");
  eq(wrange && [wrange.getAttribute("min"), wrange.getAttribute("max"), wrange.getAttribute("step")].join("/"),
    "160/480/10", "拉杆范围 160–480 step 10（原 360 放宽）");
  eq(wrow && wrow.querySelector(".cb-wauto-lb").textContent, "自动", "开关标签就两个字：自动");
  const wautoBox = wrow && wrow.querySelector(".cb-wauto input.cb-opt-box");
  ok(wautoBox && wautoBox.checked === true, "「自动」默认开（＝R14 铺满整行行为）");
  ok(wrange && wrange.disabled === true, "自动开着 → 拉杆置灰（不做假控件）");
  eq(wrow && wrow.querySelector(".cb-wval").textContent, "240 px", "数值回显跟着拉杆（默认 240 px）");

  /* 关「自动」→ 真写回 config；键名一个没改，.base 老配置照认 */
  wautoBox.checked = false;
  fire(wautoBox, "change");
  ok(SAVES.some(s => s.key === "空位铺满整行" && s.val === false),
    "关「自动」→ 写回「空位铺满整行」= false（键名不变）");
  eq(v.cfgGet("空位铺满整行", true), false, "config 读回 false（不是只改了 DOM）");

  /* 拉杆松手 → 写回「卡片最小宽度」，且此刻拉杆已解除置灰 */
  const wr2 = v.panelEl.querySelector(".cb-wrow input.cb-wrange");
  ok(!!wr2 && wr2.disabled === false, "重绘后拉杆可用（「自动」关掉 → 置灰解除）");
  wr2.value = "360";
  fire(wr2, "change");
  ok(SAVES.some(s => s.key === "卡片最小宽度" && s.val === 360),
    "拉杆松手 → 写回「卡片最小宽度」= 360（键名不变，.base 老配置照认）");
  ok(v.panelOpen && !v.panelEl.hasClass("is-hidden"), "两次重绘后面板都还开着（没被自己关掉）");

  const behSwitches = [...v.panelBodyEl.querySelectorAll(".cb-grp-body > .cb-opt")];
  eq(behSwitches.length, 5, "「看板行为」段 5 个开关（R23 加了「属性默认展开」）");
  eq(behSwitches.map(e => e.getAttribute("data-key")).join(","),
    "允许重复,显示收容所,显正文,属性默认展开,只读",
    "开关顺序（键名不变，.base 老配置照样认）");
  ok(behSwitches.every(e => {
    const sw = e.querySelector(".checkbox-container");
    const box = sw && sw.querySelector("input.cb-opt-box[type=checkbox]");
    const lab = e.querySelector(".cb-opt-label");
    return sw && box && lab && lab.textContent.length <= 6;
  }), "每个开关 = 原生胶囊 .checkbox-container + 勾选框 + 短标签");
  ok(behSwitches.every(e => (e.getAttribute("title") || "").length > 4),
    "说明文字一条没丢 —— 全在 title 悬浮提示里");
  eq(behSwitches[0].querySelector(".cb-opt-label").textContent, "允许重复", "第一个开关标签");
  ok(behSwitches[0].querySelector("input.cb-opt-box").checked === true, "「允许重复」默认开");

  /* 点一下开关 → 真写回 config，且面板没有崩 */
  const dupBox = behSwitches[0].querySelector("input.cb-opt-box");
  dupBox.checked = false;
  fire(dupBox, "change");
  ok(SAVES.some(s => s.key === "允许重复" && s.val === false), "点开关 → 写回「允许重复」= false");
  ok(v.panelOpen && !v.panelEl.hasClass("is-hidden"), "重绘后面板还开着（没有被自己关掉）");
  eq(v.cfgGet("允许重复", true), false, "config 读回 false（不是只改了 DOM）");

  const secRows = [...v.panelBodyEl.querySelectorAll(".cb-panel-list .cb-row")];
  eq(secRows.length, 2, "「板块」段列出 2 个板块行");
  eq(secRows.map(r => r.querySelector(".cb-row-name").textContent).join(","), "收件箱,收容所", "行名 = 板块名");
  eq(v.panelBodyEl.querySelector(".cb-add-wrap .cb-add-btn").textContent, "＋ 添加", "添加按钮文案极简");

  const adv = kids[3];
  eq(adv.querySelectorAll(".cb-opt-row > .cb-opt").length, 3, "高级组里 3 个开关（YAML / 双链 / 拖动搬文件）");
  ok(!!adv.querySelector("details.cb-io"), "配置搬运折在高级组里面（默认折叠）");
  ok(/配置搬运/.test(adv.querySelector("details.cb-io summary").textContent), "搬运组 summary 说清做什么");

  /* ---------- ③ 板块编辑行：三态并排按钮 ---------- */
  head("需求4-③ · 板块编辑行三态改按钮组");
  click(secRows[0].querySelector(".cb-editbtn"));
  const box = v.panelEl.querySelector("div.cb-edit[data-idx='0']");
  ok(!!box, "点 ✎ → 编辑行就地展开");
  eq([...box.querySelectorAll(".cb-edit-sep")].map(e => e.textContent).join(","), "基础,显示",
    "仍分「基础 / 显示」两段");
  const segs = [...box.querySelectorAll(".cb-seg")];
  eq(segs.length, 4, "4 个三态控件（属性展开 / 显正文 / 显示 YAML / 显示结尾双链）");
  eq(segs.map(s => String(s.className).replace("cb-seg ", "")).join(","),
    "cb-seg-propsopen,cb-seg-body,cb-seg-yaml,cb-seg-links",
    "顺序跟右键小窗一致（属性展开在最前，两个台面同序）");
  ok(segs.every(s => s.querySelectorAll(".cb-seg-btn").length === 3), "每个都是 3 个并排小按钮");
  eq([...segs[0].querySelectorAll(".cb-seg-btn")].map(b => b.textContent).join(","), "继承,开,关",
    "三态文案 = 继承 / 开 / 关");
  ok(segs.every(s => s.querySelectorAll(".cb-seg-btn.is-on").length === 1),
    "每个控件恰好一个当前态高亮");
  /* 按下标取控件太脆（R24 在最前面插了一行就全错位）→ 一律按类名定位 */
  const segBody = box.querySelector(".cb-seg-body");
  ok(!!segBody, "拿得到「显正文」那一行（.cb-seg-body）");
  eq(segBody.querySelector(".cb-seg-btn.is-on").textContent, "继承", "没设过 → 停在「继承」");
  ok(segBody.querySelector(".cb-seg-btn.is-on").getAttribute("title").indexOf("视图默认") >= 0,
    "「继承」的 title 说明它继承的是什么");
  eq([...box.querySelectorAll("select")].map(s => s.className).join("|"),
    "cb-input cb-select-src|cb-input cb-select-sort",
    "只剩「数据源 / 排序」两个真下拉（三态下拉已全删）");

  /* 点「关」→ 写回 body=false 并重绘 */
  click([...segBody.querySelectorAll(".cb-seg-btn")].find(b => b.textContent === "关"));
  eq(v.secs[0].body, false, "点「关」→ 该板块 显正文 = false（显式指定，不再继承）");
  const box2 = v.panelEl.querySelector("div.cb-edit[data-idx='0']");
  const segBody2 = box2.querySelector(".cb-seg-body");
  eq(segBody2.querySelector(".cb-seg-btn.is-on").textContent, "关",
    "重绘后当前态跟着走到「关」");
  click([...segBody2.querySelectorAll(".cb-seg-btn")].find(b => b.textContent === "继承"));
  eq(v.secs[0].body, null, "点回「继承」→ body 回到 null（不污染手写配置）");

  /* ---------- ④ R24：板块标题旁的 ⚙ 撤了 → 双击改名 + 右键弹设置小窗 ---------- */
  head("R24 · 板块标题：撤 ⚙ / 双击改名 / 右键小窗");
  eq(v.listEl.querySelectorAll("button.cb-sec-gear").length, 0,
    "板块标题旁不再有 .cb-sec-gear（R24 把那块齿轮撤了）");
  let secHead = v.listEl.querySelector(".cb-section .cb-section-head");
  let nameEl = secHead && secHead.querySelector(".cb-section-name");
  ok(!!nameEl, "板块标题里有 .cb-section-name（改名入口）");
  eq(nameEl && nameEl.textContent, "收件箱", "标题写着板块名");
  ok(nameEl && nameEl.hasClass("cb-sec-name-edit"), "可配置的板块 → 名字带「可编辑」标记（hover 有手感）");
  ok((nameEl.getAttribute("title") || "").indexOf("双击改名") >= 0, "title 说明「双击改名 + 拖动排序」");

  /* 双击 → 就地换输入框；Enter 提交 → 改内存 + 写回 .base「板块」段 */
  fire(nameEl, "dblclick");
  let rin = secHead.querySelector("input.cb-sec-rename-input");
  ok(!!rin, "双击板块名 → 就地把名字换成输入框");
  eq(rin && rin.value, "收件箱", "输入框预填当前板块名");
  rin.value = "收件箱2";
  key(rin, "Enter");
  eq(v.secs[0].name, "收件箱2", "敲 Enter → 板块名真的改了");
  ok(SAVES.some(s => s.key === "板块" && Array.isArray(s.val)
    && s.val.some(x => x && x["名称"] === "收件箱2")),
    "改名写回 config「板块」段（.base 真落盘，不是只改内存）");
  nameEl = v.listEl.querySelector(".cb-section .cb-section-name");
  eq(nameEl && nameEl.textContent, "收件箱2", "重绘后标题跟着走 → 改名即时生效");

  /* Esc → 放弃改动（名字不动） */
  fire(nameEl, "dblclick");
  rin = v.listEl.querySelector("input.cb-sec-rename-input");
  ok(!!rin, "再次双击 → 输入框又出来");
  rin.value = "别改我";
  key(rin, "Escape");
  eq(v.secs[0].name, "收件箱2", "敲 Esc → 放弃改动（名字不变）");
  eq(v.listEl.querySelector(".cb-section .cb-section-name").textContent, "收件箱2", "标题也回原名");

  /* 改名要顺手迁移「折叠」状态（折叠键 = 板块名 —— 不迁就凭空丢） */
  v.cfgSet("折叠", { "收件箱2": true });
  v.repaint(false);
  fire(v.listEl.querySelector(".cb-section .cb-section-name"), "dblclick");
  let r2 = v.listEl.querySelector("input.cb-sec-rename-input");
  r2.value = "收件箱3";
  key(r2, "Enter");
  const foldNow = v.cfgGet("折叠", null);
  ok(foldNow && foldNow["收件箱3"] === true && foldNow["收件箱2"] === undefined,
    "改名把「折叠」状态从旧名迁到新名（折叠键 = 板块名的坑）");
  /* 改回原名，后面断言照旧 */
  fire(v.listEl.querySelector(".cb-section .cb-section-name"), "dblclick");
  r2 = v.listEl.querySelector("input.cb-sec-rename-input");
  r2.value = "收件箱";
  key(r2, "Enter");
  eq(v.secs[0].name, "收件箱", "改回原名（后面断言照旧）");
  v.cfgSet("折叠", null);
  v.repaint(false);

  /* 右键板块 → 鼠标处弹设置小窗（Windows 右键菜单那种） */
  secHead = v.listEl.querySelector(".cb-section .cb-section-head");
  secHead.dispatchEvent(new W.MouseEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 130, clientY: 96 }));
  let menu = document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  ok(!!menu, "右键板块 → 弹 .cb-secmenu 小窗");
  eq([...menu.querySelectorAll(".cb-ctx-head .cb-ctx-head-lb")].map(e => e.textContent).join(","),
    "通用设置,笔记内容,文件操作", "三组标题 = 老板列的三组");
  const triRows = [...menu.querySelectorAll(".cb-ctx-tri")];
  eq(triRows.map(r => r.getAttribute("data-field")).join(","), "propsOpen,body,yaml,links",
    "4 个**板块级**三态行（属性展开 / 内容展开 / 显示 YAML / 显示双链）");
  ok(triRows.every(r => r.querySelectorAll(".cb-seg-btn").length === 3), "每行都是「继承 / 开 / 关」三态");
  ok(triRows.every(r => r.querySelectorAll(".cb-seg-btn.is-on").length === 1), "每行恰一个当前态高亮");
  eq(triRows[0].querySelector(".cb-seg-btn.is-on").textContent, "继承", "没设过 → 停在「继承」");
  const ctxChks = [...menu.querySelectorAll(".cb-ctx-item.cb-ctx-chk")];
  eq(ctxChks.map(e => e.getAttribute("data-key")).join(","),
    "拖动搬文件,文件隐藏显示,查看隐藏的文件", "文件操作 3 个打勾项（视图级，不冒充板块级）");
  ok(!!menu.querySelector(".cb-sec-help.is-hidden"), "「显示帮助」的说明块默认藏着（点了才展开）");
  const acts = [...menu.querySelectorAll(".cb-ctx-item")].map(e => e.getAttribute("data-act")).filter(Boolean);
  eq(acts[0], "刷新", "菜单第一项就是「刷新」");
  /* R24：没覆盖时文案会带后缀「（已是默认）」→ 一律用前缀匹配，别写死整串 */
  ok(acts.some(a => a.indexOf("重置设置") === 0), "通用设置里有「重置设置」");
  ok(acts.indexOf("显示帮助") >= 0, "通用设置里有「显示帮助」");
  ok((menu.style.left || "").indexOf("px") >= 0 && (menu.style.top || "").indexOf("px") >= 0,
    "小窗落在鼠标处（left/top 真写了）");

  /* 真点「内容展开 · 关」→ 只改这一个板块 */
  click([...triRows[1].querySelectorAll(".cb-seg-btn")].find(b => b.textContent === "关"));
  eq(v.secs[0].body, false, "点「内容展开 · 关」→ 该板块 body = false（只改这一块）");
  ok(SAVES.some(s => s.key === "板块"), "跟着写回 config「板块」段");
  ok(!document.body.querySelector(".cb-ctxmenu.cb-secmenu"), "点完一项 → 小窗自动收起（跟 Windows 一致）");

  /* 真点「属性展开 · 关」→ 卡片属性区当场折叠（验板块级 propsOpen 真接了线） */
  ok(!v.listEl.querySelector(".cb-card .cb-props").hasClass("cb-pros-fold"), "设之前属性区展开（继承视图默认）");
  secHead = v.listEl.querySelector(".cb-section .cb-section-head");
  secHead.dispatchEvent(new W.MouseEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 130, clientY: 96 }));
  menu = document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  const poRow = [...menu.querySelectorAll(".cb-ctx-tri")].find(r => r.getAttribute("data-field") === "propsOpen");
  click([...poRow.querySelectorAll(".cb-seg-btn")].find(b => b.textContent === "关"));
  eq(v.secs[0].propsOpen, false, "点「属性展开 · 关」→ 该板块 propsOpen = false");
  ok(v.listEl.querySelector(".cb-card .cb-props").hasClass("cb-pros-fold"),
    "这个板块的卡片属性区真的折叠了（板块级 propsOpen 接线无误）");
  eq(v.propsOpenDefault(), true, "视图级默认没被动过（板块覆盖与视图默认是两层）");

  /* 「重置设置」→ 把这个板块的板块级覆盖全清掉；没覆盖时置灰 */
  secHead = v.listEl.querySelector(".cb-section .cb-section-head");
  secHead.dispatchEvent(new W.MouseEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 130, clientY: 96 }));
  menu = document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  let rst = [...menu.querySelectorAll(".cb-ctx-item")].find(e => (e.getAttribute("data-act") || "").indexOf("重置设置") === 0);
  ok(!!rst && !rst.hasClass("is-disabled"), "有覆盖 → 「重置设置」可点");
  click(rst);
  eq(v.secs[0].propsOpen, null, "重置后 属性展开 回 null（继承视图）");
  eq(v.secs[0].body, null, "重置后 内容展开 回 null");
  ok(!v.listEl.querySelector(".cb-card .cb-props").hasClass("cb-pros-fold"), "重置后卡片属性区又展开了");
  secHead = v.listEl.querySelector(".cb-section .cb-section-head");
  secHead.dispatchEvent(new W.MouseEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 130, clientY: 96 }));
  menu = document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  rst = [...menu.querySelectorAll(".cb-ctx-item")].find(e => (e.getAttribute("data-act") || "").indexOf("重置设置") === 0);
  ok(rst.hasClass("is-disabled"), "已是默认 → 「重置设置」置灰（不做假按钮）");
  v.closeSecMenu();

  /* 「显示帮助」点一下 → 说明块露出来（带上这个板块的名字） */
  secHead = v.listEl.querySelector(".cb-section .cb-section-head");
  secHead.dispatchEvent(new W.MouseEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 130, clientY: 96 }));
  menu = document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  click([...menu.querySelectorAll(".cb-ctx-item")].find(e => e.getAttribute("data-act") === "显示帮助"));
  const hlp = document.body.querySelector(".cb-ctxmenu.cb-secmenu .cb-sec-help");
  ok(!!hlp && !hlp.hasClass("is-hidden"), "点「显示帮助」→ 说明块露出来");
  ok(hlp && /收件箱/.test(hlp.textContent), "说明里带上这个板块的名字（不是通用废话）");

  /* 「刷新」点一下不炸（绕开 computeSig 强制重画） */
  const rfBtn = [...document.body.querySelectorAll(".cb-ctxmenu.cb-secmenu .cb-ctx-item")]
    .find(e => e.getAttribute("data-act") === "刷新");
  ok(!!rfBtn, "菜单里能拿到「刷新」");
  click(rfBtn);
  ok(!document.body.querySelector(".cb-ctxmenu.cb-secmenu"), "点「刷新」→ 没抛异常且小窗收起");
  eq(v.listEl.querySelectorAll(".cb-section").length, 1, "刷新后板块照旧渲染（没被刷没）");

  /* 「查看隐藏的文件」打勾 → 写回视图级 config；隐藏 / 恢复一篇 */
  secHead = v.listEl.querySelector(".cb-section .cb-section-head");
  secHead.dispatchEvent(new W.MouseEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 130, clientY: 96 }));
  menu = document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  const chkShow = [...menu.querySelectorAll(".cb-ctx-chk")].find(e => e.getAttribute("data-key") === "查看隐藏的文件");
  eq(chkShow.querySelector(".cb-ctx-tick").textContent, "", "默认没打勾");
  click(chkShow);
  eq(v.cfgGet("查看隐藏的文件", false), true, "点一下 → 写回 config「查看隐藏的文件」= true");

  v.cfgSet("查看隐藏的文件", null);
  v.repaint(false);
  eq(v.listEl.querySelectorAll(".cb-card").length, 2, "先 2 张卡");
  v.toggleHidden("01_新知识库/笔记1.md");
  eq(v.listEl.querySelectorAll(".cb-card").length, 1, "收起来一篇 → 只渲染 1 张（「查看隐藏的文件」关着）");
  eq(v.listEl.querySelectorAll(".cb-badge-hidden").length, 1, "板块头出现「已隐藏 1」徽标");
  ok(/已隐藏 1/.test(v.listEl.querySelector(".cb-badge-hidden").textContent), "徽标文案带上条数");
  v.cfgSet("查看隐藏的文件", true);
  v.repaint(false);
  eq(v.listEl.querySelectorAll(".cb-card").length, 2, "打开「查看隐藏的文件」→ 卡片回来");
  ok(!!v.listEl.querySelector(".cb-card.is-cb-hidden"), "回来的那张带 .is-cb-hidden（淡出 + 虚线，仍可右键恢复）");
  v.toggleHidden("01_新知识库/笔记1.md");
  v.cfgSet("查看隐藏的文件", null);
  v.repaint(false);
  eq(v.listEl.querySelectorAll(".cb-card").length, 2, "取消隐藏 → 恢复原样（不残留）");

  /* ---------- ⑤ R24：收容所也走同一套（它是「配置给的板块」，不是自动分组） ---------- */
  head("R24 · 收容所：同样可改名 / 可单设，且板块级**隔离**");
  const catchBox = behSwitches[1].querySelector("input.cb-opt-box");
  catchBox.checked = true;
  fire(catchBox, "change");
  eq(v.sections.length, 2, "打开「显示收容所」→ 2 个板块都渲染");
  const catchHead = [...v.listEl.querySelectorAll(".cb-section")][1].querySelector(".cb-section-head");
  const catchName = catchHead.querySelector(".cb-section-name");
  ok(!!catchName && catchName.hasClass("cb-sec-name-edit"),
    "收容所是配置给的板块 → 同样可双击改名（跟自动分组 / 公式组区分开）");
  eq(v.listEl.querySelectorAll("button.cb-sec-gear").length, 0, "收容所板块旁也没有齿轮（全都撤了）");
  catchHead.dispatchEvent(new W.MouseEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 70, clientY: 210 }));
  const cmenu = document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  ok(!!cmenu, "右键收容所 → 一样弹小窗");
  eq(cmenu.querySelectorAll(".cb-ctx-tri").length, 4, "收容所同样有 4 个板块级三态行");
  ok(!cmenu.querySelector(".cb-ctx-note"), "它不是「不能单独设置」那类 → 不出现说明块");
  eq(cmenu.querySelectorAll(".cb-ctx-item.cb-ctx-chk").length, 3, "文件操作 3 项照旧（视图级，每个板块都在）");
  ok(!![...cmenu.querySelectorAll(".cb-ctx-item")].find(e => e.getAttribute("data-act") === "刷新"),
    "「刷新」对收容所照样有");

  /* 🔴 老板的核心诉求：改收容所只能改到收容所那一份，别连坐第一个板块 */
  const ci = v.secs.findIndex(s => s.source === "catchall");
  ok(ci >= 0, "收容所在 secs 里按 source 找得到（secIndexOf 的 catchall 分支）");
  const cRow = [...cmenu.querySelectorAll(".cb-ctx-tri")].find(r => r.getAttribute("data-field") === "body");
  click([...cRow.querySelectorAll(".cb-seg-btn")].find(b => b.textContent === "关"));
  eq(v.secs[ci].body, false, "右键改收容所「内容展开」→ 只写进收容所那一份");
  eq(v.secs[0].body, null, "第一个板块（收件箱）没被连坐 —— 板块级隔离成立");
  ok(!document.body.querySelector(".cb-ctxmenu.cb-secmenu"), "点完自动收起");
  v.resetSection(ci);
  eq(v.secs[ci].body, null, "（收拾现场）把收容所那份覆盖清回去");

  /* 面板里的收容所编辑行照旧能开（点板块行 ✎，等价于原来「点齿轮」那条路） */
  const secRows2 = [...v.panelBodyEl.querySelectorAll(".cb-panel-list .cb-row")];
  eq(secRows2.length, 2, "面板板块段仍列 2 行");
  click(secRows2[1].querySelector(".cb-editbtn"));
  const cx = v.panelEl.querySelector("div.cb-edit[data-idx='1']");
  ok(!!cx, "点收容所那行 ✎ → 编辑行就地展开");
  eq([...cx.querySelectorAll(".cb-seg")].length, 4, "三态控件 4 个（R24 又加了「属性展开」）");
  ok(!!cx.querySelector(".cb-seg-propsopen") && !!cx.querySelector(".cb-seg-body"),
    "「属性展开」也进了编辑行（两个台面能力一致，不是只有右键菜单有）");
  ok(cx.textContent.indexOf("上限") < 0, "收容所不显示「上限」（语义如此，不是漏渲染）");
  ok(/收容所固定排最后/.test(cx.textContent), "收容所给出归属说明");
  eq(cx.querySelector(".cb-select-src").value, "catchall", "数据源下拉停在「收容所」");
  click(cx.querySelector(".cb-btn-done"));
  eq(v.editIdx, -1, "点「完成」→ 编辑行收起");
  ok(v.panelOpen, "（准备态）面板仍开着 —— 交给 ⑥ 验遮罩跟着窗");

  /* ---------- ⑥ R22：板块设置 = 悬浮小窗（遮罩 + ✕ + 点遮罩收起） ---------- */
  head("R22 · 面板改悬浮小窗");
  const mask = v.rootEl.querySelector(".cb-mask");
  ok(!!mask, "窗外有 .cb-mask 遮罩（不是把看板挤下去的一行）");
  ok(v.panelOpen && !mask.hasClass("is-hidden"), "面板开着时遮罩一起露出来");
  const xBtn = v.panelEl.querySelector(".cb-panel-head .cb-panel-x");
  ok(!!xBtn, "窗头有 ✕ 关闭按钮");
  eq(xBtn && xBtn.getAttribute("title"), "关闭", "✕ 带悬浮说明");
  ok(v.panelEl.getAttribute("role") === "dialog"
    && v.panelEl.getAttribute("aria-label") === "板块设置",
    "窗本体 role=dialog + aria-label（无障碍名说清是什么窗）");

  click(xBtn);
  ok(!v.panelOpen, "点 ✕ → 面板收起");
  ok(v.panelEl.hasClass("is-hidden") && mask.hasClass("is-hidden"),
    "✕ 之后窗与遮罩一起藏（不会留一层灰罩住看板、点哪儿都没反应）");

  click(gearBtn);
  ok(v.panelOpen && !mask.hasClass("is-hidden"), "再点齿轮 → 窗与遮罩一起回来");

  fire(mask, "mousedown");
  ok(!v.panelOpen, "点遮罩 → 收起（复用「点外面就收起」那套，没另写一份）");
  ok(v.panelEl.hasClass("is-hidden") && mask.hasClass("is-hidden"), "遮罩跟着一起收");

  click(gearBtn);
  ok(v.panelOpen, "齿轮再点一下又开");
  click(gearBtn);
  ok(!v.panelOpen && mask.hasClass("is-hidden"),
    "开着时再点齿轮 = 收起（走同一个 closePanel；真机上这一下先落在遮罩上，结果一样是关）");

  /* ---------- ⑦ R23：面板里真有一个「属性默认展开」开关，真拨一下看卡片 ---------- */
  head("R23 · 「属性默认展开」开关（真拨）");
  click(gearBtn);
  ok(v.panelOpen, "重新打开面板");
  const prosRow = v.panelEl.querySelector('.cb-grp-body > .cb-opt[data-key="属性默认展开"]');
  ok(!!prosRow, "「看板行为」组里出现「属性默认展开」这一行");
  eq(prosRow.querySelector(".cb-opt-label").textContent, "属性默认展开", "标签就写「属性默认展开」");
  const prosBox = prosRow.querySelector("input.cb-opt-box[type=checkbox]");
  ok(!!prosBox, "是原生胶囊开关（.checkbox-container + input.cb-opt-box）");
  ok(prosBox.checked === true, "默认开（＝属性区默认展开，R9 以来的行为）");
  ok((prosRow.getAttribute("title") || "").length > 4, "说明在 title 里，面板正文不铺小字");

  const cardA = v.listEl.querySelector(".cb-card");
  const prosA = cardA && cardA.querySelector(".cb-props");
  ok(!!prosA, "卡片上真有属性区（.cb-props，来自条目前言）");
  ok(!!prosA && !prosA.hasClass("cb-pros-fold"), "拨之前：属性区是展开的");
  eq(cardA.querySelector(".cb-pros-toggle") && cardA.querySelector(".cb-pros-toggle").textContent,
    "属性 ▾", "旁标写着「属性 ▾」");

  /* 真关掉 → 写回配置 + 卡片属性区当场折叠（这一刀才验得到 computeSig 认没认它） */
  prosBox.checked = false;
  fire(prosBox, "change");
  ok(SAVES.some(s => s.key === "属性默认展开" && s.val === false),
    "关掉开关 → 写回 config「属性默认展开」= false（键名不变，.base 老配置照认）");
  eq(v.cfgGet("属性默认展开", true), false, "config 读回 false（不是只改了 DOM）");
  eq(v.propsOpenDefault(), false, "propsOpenDefault() 跟着变 false（真读了这份配置）");

  const cardB = v.listEl.querySelector(".cb-card");
  const prosB = cardB && cardB.querySelector(".cb-props");
  ok(!!prosB && prosB.hasClass("cb-pros-fold"),
    "关掉后 → 卡片属性区真的折叠了（sig 认这个键 → 拨完即时重绘）");
  eq(cardB.querySelector(".cb-pros-toggle").textContent, "属性 ▸", "折叠后旁标变「属性 ▸」");

  /* 拨回来：恢复默认展开（配置可逆，别把默认值改坏） */
  const prosBox2 = v.panelEl.querySelector(
    '.cb-grp-body > .cb-opt[data-key="属性默认展开"] input.cb-opt-box');
  ok(!!prosBox2, "重绘后面板里的这一行还在（拨一下没把面板搞崩）");
  prosBox2.checked = true;
  fire(prosBox2, "change");
  ok(SAVES.some(s => s.key === "属性默认展开" && s.val === true), "拨回来 → 写回 true");
  const prosC = v.listEl.querySelector(".cb-card .cb-props");
  ok(!!prosC && !prosC.hasClass("cb-pros-fold"), "拨回后属性区重新展开");
  /* 卡片上那个「属性 ▸」单卡开关照旧能用（只是默认值变了，能力没被砍） */
  ok(!!v.listEl.querySelector(".cb-card .cb-pros-toggle"), "单卡「属性 ▾ / ▸」按钮仍在（没被这轮砍掉）");

  console.log("\nR20-看板DOM冒烟: PASS " + pass + " / FAIL " + fail
    + (fail ? "\n" + fails.join("\n") : ""));
  process.exit(fail ? 1 : 0);
})();
