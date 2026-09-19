/* R20b 看板「真 DOM 冒烟」：用 jsdom 跑**出货代码**里的内嵌创作看板
 *   （vendor/creation-board.js 经 build 内嵌进 main.js，KB.modules.CreationBoardPlugin）
 * 目的：run_r20 的看板断言是**源码级正则**，抓不到「改完当场抛异常」这类运行时错。
 *   这里把视图真造出来，把顶栏齿轮 / 板块设置面板 / 板块编辑行真渲染一遍并点击。
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
  eq(kids.length, 3, "面板正文正好 3 段（看板行为 / 板块 / 高级）");
  const grpLabels = [...v.panelBodyEl.querySelectorAll(".cb-grp > .cb-grp-lb")].map(e => e.textContent);
  eq(grpLabels.join(","), "看板行为,板块", "前两段的段落名（高级那段是 <details>，不带小标签）");
  eq(kids[2].tagName, "DETAILS", "第三段是 <details>（高级，默认折叠）");
  eq(kids[2].querySelector("summary").textContent, "高级", "高级组 summary 只留「高级」两字");

  const behSwitches = [...v.panelBodyEl.querySelectorAll(".cb-grp-body > .cb-opt")];
  eq(behSwitches.length, 4, "「看板行为」段 4 个开关");
  eq(behSwitches.map(e => e.getAttribute("data-key")).join(","), "允许重复,显示收容所,显正文,只读",
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

  const adv = kids[2];
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
  eq(segs.length, 3, "3 个三态控件（显正文 / 显示 YAML / 显示结尾双链）");
  ok(segs.every(s => s.querySelectorAll(".cb-seg-btn").length === 3), "每个都是 3 个并排小按钮");
  eq([...segs[0].querySelectorAll(".cb-seg-btn")].map(b => b.textContent).join(","), "继承,开,关",
    "三态文案 = 继承 / 开 / 关");
  ok(segs.every(s => s.querySelectorAll(".cb-seg-btn.is-on").length === 1),
    "每个控件恰好一个当前态高亮");
  eq(segs[0].querySelector(".cb-seg-btn.is-on").textContent, "继承", "没设过 → 停在「继承」");
  ok(segs[0].querySelector(".cb-seg-btn.is-on").getAttribute("title").indexOf("视图默认") >= 0,
    "「继承」的 title 说明它继承的是什么");
  eq([...box.querySelectorAll("select")].map(s => s.className).join("|"),
    "cb-input cb-select-src|cb-input cb-select-sort",
    "只剩「数据源 / 排序」两个真下拉（三态下拉已全删）");

  /* 点「关」→ 写回 body=false 并重绘 */
  const offBtn = [...segs[0].querySelectorAll(".cb-seg-btn")].find(b => b.textContent === "关");
  click(offBtn);
  eq(v.secs[0].body, false, "点「关」→ 该板块 显正文 = false（显式指定，不再继承）");
  const box2 = v.panelEl.querySelector("div.cb-edit[data-idx='0']");
  eq(box2.querySelectorAll(".cb-seg")[0].querySelector(".cb-seg-btn.is-on").textContent, "关",
    "重绘后当前态跟着走到「关」");
  click([...box2.querySelectorAll(".cb-seg")[0].querySelectorAll(".cb-seg-btn")].find(b => b.textContent === "继承"));
  eq(v.secs[0].body, null, "点回「继承」→ body 回到 null（不污染手写配置）");

  /* ---------- ④ 板块标题上的齿轮也是自绘 SVG ---------- */
  head("需求3 · 板块标题旁齿轮");
  const secGears = [...v.listEl.querySelectorAll("button.cb-sec-gear")];
  eq(secGears.length, 1, "渲染出的板块标题旁各有一个 .cb-sec-gear");
  ok(secGears.every(g => {
    const s2 = g.querySelector("svg");
    return s2 && s2.namespaceURI === SVGNS && s2.getAttribute("stroke") === "currentColor";
  }), "每个都是同一个自绘图标（SVG 命名空间 + currentColor）");
  eq(secGears.map(g => g.textContent).join(""), "", "按钮里没有 emoji 文本残留");
  ok((secGears[0].getAttribute("title") || "").indexOf("板块设置") >= 0, "齿轮带悬停说明");

  /* 打开「显示收容所」→ 收容所板块作为配置板块出现，它旁边也有齿轮 */
  const catchBox = behSwitches[1].querySelector("input.cb-opt-box");
  catchBox.checked = true;
  fire(catchBox, "change");
  eq(v.sections.length, 2, "打开「显示收容所」后 → 2 个板块都渲染");
  eq(v.listEl.querySelectorAll("button.cb-sec-gear").length, 2, "收容所板块旁同样有齿轮（都走同一个图标函数）");
  click(v.listEl.querySelectorAll("button.cb-sec-gear")[1]);
  eq(v.editIdx, v.secs.length - 1, "点板块标题齿轮 → 面板打开并定位到该板块的编辑行");
  ok(v.panelOpen, "面板被带开（不是「点了没反应」）");

  /* ---------- ⑤ 收容所板块的编辑行也不炸 ---------- */
  head("需求4-③ · 收容所板块的编辑行");
  const cx = v.panelEl.querySelector("div.cb-edit[data-idx='1']");
  ok(!!cx, "点板块标题齿轮 → 收容所的编辑行已经就地打开（不用再点 ✎）");
  eq([...cx.querySelectorAll(".cb-seg")].length, 3, "三态控件照旧 3 个");
  ok(cx.textContent.indexOf("上限") < 0, "收容所不显示「上限」（语义如此，不是漏渲染）");
  ok(/收容所固定排最后/.test(cx.textContent), "收容所给出归属说明");
  eq(cx.querySelector(".cb-select-src").value, "catchall", "数据源下拉停在「收容所」");
  click(cx.querySelector(".cb-btn-done"));
  eq(v.editIdx, -1, "点「完成」→ 编辑行收起");

  console.log("\nR20-看板DOM冒烟: PASS " + pass + " / FAIL " + fail
    + (fail ? "\n" + fails.join("\n") : ""));
  process.exit(fail ? 1 : 0);
})();
