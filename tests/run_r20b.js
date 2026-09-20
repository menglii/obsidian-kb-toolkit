/* R20b 看板「真 DOM 冒烟」：用 jsdom 跑**出货代码**里的内嵌创作看板
 *   （vendor/creation-board.js 经 build 内嵌进 main.js，KB.modules.CreationBoardPlugin）
 * 目的：run_r20 的看板断言是**源码级正则**，抓不到「改完当场抛异常」这类运行时错。
 *   这里把视图真造出来，把顶栏齿轮 / 板块设置面板 / 板块编辑行真渲染一遍并点击。
 * R21 追加：「卡片」组那一行「文件宽度 [拉杆] ＋ 自动 [开关]」也真渲染真点
 *   （拨开关 / 推拉杆 → 验 config 写回 + 面板不崩 + 拉杆置灰解除）。
 * R28 追加：兜底「全部」板块默认上限 50 + 「显示全部（慎用）」按钮 + 正文渲染限并发
   —— 造 120 篇 + 清空板块配置，量「真只建 50 张卡」「按钮真写 .base」「并发峰值 ≤ 2」。
 * 只读：不写任何笔记、不落盘（config.set 落在桩的 SAVES 里，不碰真库）。 */
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
  /* R27：「内容」组插在「看板行为」与「板块」之间 → 正文从 4 段变 5 段 */
  eq(kids.length, 5, "面板正文正好 5 段（卡片 / 看板行为 / 内容 / 板块 / 高级）");
  const grpLabels = [...v.panelBodyEl.querySelectorAll(".cb-grp > .cb-grp-lb")].map(e => e.textContent);
  eq(grpLabels.join(","), "卡片,看板行为,内容,板块", "各段的段落名（高级那段是 <details>，不带小标签）");
  /* 不按下标抓 —— 段数以后还会变，按**标签名**找才稳 */
  const advRow = kids.find((e) => e.tagName === "DETAILS");
  ok(!!advRow, "最后一段是 <details>（高级，默认折叠）");
  eq(advRow && advRow.querySelector("summary").textContent, "高级", "高级组 summary 只留「高级」两字");

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
  /* R27：本段又加了一个「隐藏空板块」（一条笔记都没有的板块不渲染） */
  eq(behSwitches.length, 6, "「看板行为」段 6 个开关（R23 属性默认展开 + R27 隐藏空板块）");
  eq(behSwitches.map(e => e.getAttribute("data-key")).join(","),
    "允许重复,显示收容所,隐藏空板块,显正文,属性默认展开,只读",
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

  const adv = kids.find((e) => e.tagName === "DETAILS");
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
  ok((nameEl.getAttribute("title") || "").indexOf("点一下改名") >= 0,
    "title 说明「点一下改名 + 拖动排序」（R26 从双击改成单击，dblclick 仍保留）");

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
  /* R25：菜单里又插了「本板块」（新建文件 / 删除板块）与「新建板块」两组。
     R24 那三组的**相对顺序一个没变**，「文件操作」仍然压在最下面。 */
  const grpTitles = [...menu.querySelectorAll(".cb-ctx-head .cb-ctx-head-lb")].map(e => e.textContent);
  eq(grpTitles.join(","), "通用设置,笔记内容,本板块,新建板块,文件操作",
    "5 组标题（R24 那三组顺序不变，R25 插了 本板块 / 新建板块）");
  ok(grpTitles.indexOf("文件操作") === grpTitles.length - 1,
    "「文件操作」仍是最后一组（整个看板那组永远压底）");
  const triRows = [...menu.querySelectorAll(".cb-ctx-tri")];
  eq(triRows.map(r => r.getAttribute("data-field")).join(","), "propsOpen,body,yaml,links",
    "4 个**板块级**三态行（属性展开 / 内容展开 / 显示 YAML / 显示双链）");
  ok(triRows.every(r => r.querySelectorAll(".cb-seg-btn").length === 3), "每行都是「继承 / 开 / 关」三态");
  ok(triRows.every(r => r.querySelectorAll(".cb-seg-btn.is-on").length === 1), "每行恰一个当前态高亮");
  eq(triRows[0].querySelector(".cb-seg-btn.is-on").textContent, "继承", "没设过 → 停在「继承」");
  /* R25：菜单里多了一个打勾项「跟随看板」（板块级宽度那个），所以这里只数
     **文件操作那一组**的 —— 用 :not(.cb-ctx-follow) 把新加的那项排除掉。 */
  const ctxChks = [...menu.querySelectorAll(".cb-ctx-item.cb-ctx-chk:not(.cb-ctx-follow)")];
  eq(ctxChks.map(e => e.getAttribute("data-key")).join(","),
    "拖动搬文件,文件隐藏显示,查看隐藏的文件", "文件操作 3 个打勾项（视图级，不冒充板块级）");
  ok(!!menu.querySelector(".cb-ctx-item.cb-ctx-chk.cb-ctx-follow"),
    "「跟随看板」也是打勾项，但它是**板块级**的（跟文件操作那组不是一个作用域）");
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
  /* R27（boss 第 3 条）：改完设置**不关窗** —— 就地重开一份，接着还能改下一项。
     所以这里断言的是「窗还在」+「顶上多一条回执」+「当前态真的挪到『关』」（不是只留旧 DOM）。 */
  ok(!!document.body.querySelector(".cb-ctxmenu.cb-secmenu"),
    "点完一项 → 小窗**不关**（R27 起就地刷新，不用重新右键）");
  const st1 = document.body.querySelector(".cb-ctxmenu.cb-secmenu .cb-ctx-status");
  ok(!!st1 && /内容展开/.test(st1.textContent), "顶上多一条回执：说清刚改的是哪一项");
  const tri2 = [...document.body.querySelectorAll(".cb-ctxmenu.cb-secmenu .cb-ctx-tri")]
    .find(r => r.getAttribute("data-field") === "body");
  eq(tri2.querySelector(".cb-seg-btn.is-on").textContent, "关", "重画后当前态挪到「关」（控件状态是真重算的）");

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
    "收容所是配置给的板块 → 同样可点一下改名（跟自动分组 / 公式组区分开）");
  eq(v.listEl.querySelectorAll("button.cb-sec-gear").length, 0, "收容所板块旁也没有齿轮（全都撤了）");
  catchHead.dispatchEvent(new W.MouseEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 70, clientY: 210 }));
  const cmenu = document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  ok(!!cmenu, "右键收容所 → 一样弹小窗");
  eq(cmenu.querySelectorAll(".cb-ctx-tri").length, 4, "收容所同样有 4 个板块级三态行");
  ok(!cmenu.querySelector(".cb-ctx-note"), "它不是「不能单独设置」那类 → 不出现说明块");
  eq(cmenu.querySelectorAll(".cb-ctx-item.cb-ctx-chk:not(.cb-ctx-follow)").length, 3,
    "文件操作 3 项照旧（视图级，每个板块都在）");
  ok(!![...cmenu.querySelectorAll(".cb-ctx-item")].find(e => e.getAttribute("data-act") === "刷新"),
    "「刷新」对收容所照样有");

  /* 🔴 老板的核心诉求：改收容所只能改到收容所那一份，别连坐第一个板块 */
  const ci = v.secs.findIndex(s => s.source === "catchall");
  ok(ci >= 0, "收容所在 secs 里按 source 找得到（secIndexOf 的 catchall 分支）");
  const cRow = [...cmenu.querySelectorAll(".cb-ctx-tri")].find(r => r.getAttribute("data-field") === "body");
  click([...cRow.querySelectorAll(".cb-seg-btn")].find(b => b.textContent === "关"));
  eq(v.secs[ci].body, false, "右键改收容所「内容展开」→ 只写进收容所那一份");
  eq(v.secs[0].body, null, "第一个板块（收件箱）没被连坐 —— 板块级隔离成立");
  ok(!!document.body.querySelector(".cb-ctxmenu.cb-secmenu"), "点完不关窗（R27 起就地刷新）");
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

  /* ---------- (8) R25：菜单里新建文件 / 新建板块 / 删除板块 + 板块级「文件宽度」 ---------- */
  head("R25 · 右键菜单：新建文件 / 新建板块 / 删除板块 + 板块级文件宽度");
  if (v.panelOpen) v.closePanel();

  function openSecMenu(which) {
    const h = [...v.listEl.querySelectorAll(".cb-section")][which || 0].querySelector(".cb-section-head");
    h.dispatchEvent(new W.MouseEvent("contextmenu",
      { bubbles: true, cancelable: true, clientX: 130, clientY: 96 }));
    return document.body.querySelector(".cb-ctxmenu.cb-secmenu");
  }

  /* --- ① 「文件宽度」：拉杆一行 + 「跟随看板」打勾项 --- */
  menu = openSecMenu(0);
  ok(!!menu, "右键板块 → 小窗照旧能弹（加了两组也没炸）");
  const sWrow = menu.querySelector(".cb-ctx-wrow");
  ok(!!sWrow, "通用设置里出现「文件宽度」那一行");
  ok(sWrow.hasClass("cb-wrow"), "这一行复用 .cb-wrow（跟面板那条同一个样式底座）");
  const wrg = sWrow.querySelector("input.cb-wrange[type=range]");
  ok(!!wrg, "是原生拉杆（.cb-wrange）");
  eq(wrg && wrg.getAttribute("min"), "160", "拉杆下限 160");
  eq(wrg && wrg.getAttribute("max"), "480", "拉杆上限 480");
  eq(wrg && wrg.getAttribute("step"), "10", "步长 10（跟看板那条同一档）");
  /* ⚠️ 不能写死 240：R21 段已把看板那条拖到 360 —— 按 config 当前值推 */
  const viewWNow = String(v.optNum("卡片最小宽度", 240));
  eq(wrg && wrg.value, viewWNow, "没覆盖时拉杆停在看板那条的当前值（" + viewWNow + "）");
  const fkItem = menu.querySelector(".cb-ctx-item.cb-ctx-follow");
  ok(!!fkItem, "「跟随看板」是一项**打勾项**（与「文件操作」那组同一套语言，没另造控件）");
  eq(fkItem && fkItem.querySelector(".cb-ctx-tick").textContent, "✓", "没覆盖 → 默认打勾（＝跟随看板）");
  eq(wrg && wrg.disabled, true, "跟随看板时拉杆置灰（不做假控件）");
  eq(sWrow.querySelector(".cb-wval").textContent, viewWNow + " px", "右边显示当前像素值");

  /* 点掉「跟随看板」→ 真的写进这一块，别的板块一个不动 */
  click(fkItem);
  eq(v.secs[0].secW, Number(viewWNow), "取消跟随 → secW 写进去（值就是当前拉杆值）");
  ok(SAVES.some(s => s.key === "板块" && Array.isArray(s.val)
    && s.val.some(x => x && x["文件宽度"] === Number(viewWNow))),
    "写回 .base「板块」段里的「文件宽度」（真落盘，不是只改内存）");
  ok(!!document.body.querySelector(".cb-ctxmenu.cb-secmenu"), "拨完不关窗（R27 起就地刷新）");
  const fk2 = document.body.querySelector(".cb-ctxmenu.cb-secmenu .cb-ctx-item.cb-ctx-follow");
  eq(fk2 && fk2.querySelector(".cb-ctx-tick").textContent, "",
    "重画后「跟随看板」的勾没了 —— 勾是按 secW 现状重算的，不是留着旧 DOM");
  let secEls = [...v.listEl.querySelectorAll(".cb-section")];
  eq(secEls[0].style.getPropertyValue("--cb-card-w"), viewWNow + "px",
    "🔴 变量写在**这个** .cb-section 上（后代 .cb-grid 靠继承）");
  eq(secEls[1].style.getPropertyValue("--cb-card-w"), "",
    "🔴 另一个板块没被连坐 —— 板块级隔离成立");

  /* 拉杆拖到 420（**跟看板那条拉开**，才验得出板块覆盖真分叉了） */
  menu = openSecMenu(0);
  eq(menu.querySelector(".cb-ctx-follow .cb-ctx-tick").textContent, "", "有覆盖 → 打勾项不勾");
  const wrg2 = menu.querySelector("input.cb-wrange");
  eq(wrg2.disabled, false, "有覆盖 → 拉杆可拖（置灰解除）");
  wrg2.value = "420";
  fire(wrg2, "input");
  eq([...v.listEl.querySelectorAll(".cb-section")][0].style.getPropertyValue("--cb-card-w"), "420px",
    "拖动中即时写这一个板块的变量（不动 DOM 树）");
  eq([...v.listEl.querySelectorAll(".cb-section")][1].style.getPropertyValue("--cb-card-w"), "",
    "拖动中也只染这一块（隔壁板块变量还是空的）");
  fire(wrg2, "change");
  eq(v.secs[0].secW, 420, "松手 → secW = 420（跟看板的 " + viewWNow + " 分叉了）");
  eq(v.secs.length > 1 ? v.secs[1].secW : null, null, "隔壁板块的 secW 仍是空（没被带上）");

  /* 勾回「跟随看板」→ 覆盖被真删掉，落盘里也不留这把键 */
  menu = openSecMenu(0);
  click(menu.querySelector(".cb-ctx-item.cb-ctx-follow"));
  eq(v.secs[0].secW, null, "勾回「跟随看板」→ secW = null（真删覆盖，不是写个等于默认的数）");
  const lastSecSave = [...SAVES].reverse().find(s => s.key === "板块");
  ok(!!lastSecSave && !lastSecSave.val.some(x => x && x["文件宽度"] !== undefined),
    "落盘里这把键被删干净（继承 = 不写，别人手写的值不会被钉死）");
  eq([...v.listEl.querySelectorAll(".cb-section")][0].style.getPropertyValue("--cb-card-w"), "",
    "跟随看板后不再写死变量（改看板那条拉杆又能拉动这一块了）");
  ok(!v.listEl.querySelector(".cb-card").style.getPropertyValue("--cb-card-w"),
    "单张卡片上也没有内联宽度（宽度是板块级的，不是逐卡设的）");

  /* --- ② 新建文件：复用板块级「＋」那套 --- */
  const mkCalls = [];
  const origCreate = v.createInSection;
  v.createInSection = function (sec, child, grid) {
    mkCalls.push({ name: sec && sec.name, child: child, grid: grid });
    return Promise.resolve(null);
  };
  menu = openSecMenu(0);
  const mkItem = [...menu.querySelectorAll(".cb-ctx-item")].find(e => e.getAttribute("data-act") === "新建文件");
  ok(!!mkItem, "「本板块」组里有「新建文件」");
  ok(!mkItem.hasClass("is-disabled"), "可编辑状态下「新建文件」可点");
  click(mkItem);
  eq(mkCalls.length, 1, "点一下 → 走 createInSection（复用板块级「＋」，没另写一份新建流程）");
  eq(mkCalls[0].child, "", "落点按板块这一层算");
  ok(!!mkCalls[0].grid && String(mkCalls[0].grid.className).indexOf("cb-grid") >= 0,
    "把本板块的栅格传进去了（临时卡片才插得进去）");
  ok(!document.body.querySelector(".cb-ctxmenu.cb-secmenu"), "点完收起小窗");
  v.createInSection = origCreate;

  /* --- ③ 删除板块：两下确认 --- */
  const keep0 = JSON.parse(JSON.stringify(v.secs[0]));
  const namesBefore = v.secs.map(s => s.name);
  const nBefore = v.secs.length;
  menu = openSecMenu(0);
  const delEl = [...menu.querySelectorAll(".cb-ctx-item")].find(e => e.getAttribute("data-act") === "删除板块");
  ok(!!delEl, "有「删除板块」");
  ok(delEl.hasClass("cb-ctx-danger"), "删除项带危险色（与卡片菜单「删除文件」同一套 .cb-ctx-danger）");
  eq(delEl.textContent, "删除「收件箱」", "文案带上要删的板块名（说清删的是谁）");
  click(delEl);
  eq(v.secs.length, nBefore, "🔴 第一下**不删**（只进待确认）");
  eq(delEl.textContent, "再点一次确认删除", "第一下把文案换成「再点一次确认删除」");
  ok(delEl.hasClass("is-armed"), "第一下加 .is-armed（跟第一下视觉上分得开）");
  ok(!!document.body.querySelector(".cb-ctxmenu.cb-secmenu"),
    "🔴 第一下**不收小窗**（收起了就没法点第二下）");
  click(delEl);
  eq(v.secs.length, nBefore - 1, "🔴 第二下真的删掉了");
  eq(v.secs.map(s => s.name).join(","), namesBefore.filter((n, i) => i !== 0).join(","),
    "删掉的正好是右键那一块，其余板块一个不动");
  ok(!document.body.querySelector(".cb-ctxmenu.cb-secmenu"), "删完收起小窗");
  /* 收拾现场：把板块塞回去（后面没别的断言，但收尾要干净） */
  v.secs.splice(0, 0, keep0);
  v.afterChange();   /* ⚠️ 必须走 afterChange：repaint 会按 config 重建 secs，手动 splice 会被盖回去 */
  eq(v.secs.length, nBefore, "（收拾现场）板块塞回去了");

  /* --- ④ 新建板块：4 个数据源按钮，加完就地翻开面板 --- */
  menu = openSecMenu(0);
  const addRow = menu.querySelector(".cb-ctx-addrow");
  ok(!!addRow, "有「新建板块」那一行");
  const typeBtns = [...addRow.querySelectorAll("button.cb-add-type")];
  eq(typeBtns.map(b => b.getAttribute("data-type")).join(","), "folder,tag,formula,catchall",
    "4 个数据源按钮（与顶栏面板「＋ 添加」同一套 ADDABLE）");
  eq(typeBtns.map(b => b.textContent).join(","), "文件夹,标签,公式,收容所", "按钮文案走 SOURCE_LABEL");
  const n0 = v.secs.length;
  click(typeBtns[0]);
  eq(v.secs.length, n0 + 1, "点「文件夹」→ 真的多了一个板块");
  const fresh = v.secs.find(s => s.name === "新板块");
  ok(!!fresh && fresh.source === "folder", "新板块是文件夹源");
  eq(fresh && fresh.secW, null, "新板块的宽度初值 = null（跟随看板）");
  eq(v.panelOpen, true, "🔴 加完就地翻开顶栏面板（「新建」紧接着「配置」）");
  const freshIdx = v.secs.indexOf(fresh);
  ok(!!v.panelEl.querySelector("div.cb-edit[data-idx='" + freshIdx + "']"),
    "面板里就地展开的正是新板块那一行");
  /* 收拾现场 */
  v.deleteSection(freshIdx);
  v.closePanel();
  v.repaint(false);
  eq(v.secs.length, n0, "（收拾现场）新板块删掉了");

  /* ---------- ④b R26：单击改名 / 菜单「卡片高度」行 / 任务勾选直接点 / 长按 ---------- */
  head("R26 · 单击改名 / 卡片高度行 / 任务勾选 / 长按");
  const sleep26 = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ① 单击板块名 → 就地换输入框（R26 从双击放宽到单击；dblclick 仍保留） */
  secHead = v.listEl.querySelector(".cb-section .cb-section-head");
  nameEl = secHead && secHead.querySelector(".cb-section-name");
  fire(nameEl, "click");
  const rin26 = secHead.querySelector("input.cb-sec-rename-input");
  ok(!!rin26, "单击板块名 → 就地换输入框（不用再双击）");
  key(rin26, "Escape");
  eq(nameEl.textContent, "收件箱", "（收拾现场）Esc 放弃改名");

  /* ② 右键菜单：宽 / 高两行并存 + 两个打勾项 */
  menu = openSecMenu(0);
  const wrows26 = menu.querySelectorAll(".cb-ctx-wrow");
  eq(wrows26.length, 2, "菜单里宽 / 高两行并存（文件宽度 + 卡片高度）");
  const hrow26 = wrows26[1];
  const hlb26 = hrow26.querySelector(".cb-wlb");
  const hrg26 = hrow26.querySelector("input.cb-wrange");
  ok(!!hlb26 && hlb26.textContent === "卡片高度", "第二行标签 = 卡片高度");
  ok(!!hrg26 && hrg26.getAttribute("min") === "120" && hrg26.getAttribute("max") === "480"
     && hrg26.getAttribute("step") === "10", "高度拉杆 120–480 / step 10");
  eq(menu.querySelectorAll(".cb-ctx-item.cb-ctx-follow").length, 2,
    "两个打勾项：跟随看板（宽）+ 跟随内容（高）");
  const followH26 = menu.querySelectorAll(".cb-ctx-item.cb-ctx-follow")[1];
  ok(followH26.getAttribute("data-key") === "跟随内容", "第二个打勾项 data-key = 跟随内容");
  ok(followH26.textContent.indexOf("跟随内容") >= 0, "文案 = 跟随内容");
  /* 取消「跟随内容」→ secH 落盘（拉杆默认显示 260） */
  followH26.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true }));
  eq(v.secs[0].secH, 260, "取消跟随 → secH = 260（拉杆显示值落盘）");
  v.repaint(false);
  const wrapNow26 = v.listEl.querySelector(".cb-section");
  eq(wrapNow26.style.getPropertyValue("--cb-card-h"), "260px",
    "重绘后板块容器真写 --cb-card-h: 260px");
  /* 拨回去 */
  menu = openSecMenu(0);
  const fkBack26 = menu.querySelectorAll(".cb-ctx-item.cb-ctx-follow")[1];
  fkBack26.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true }));
  eq(v.secs[0].secH, null, "（收拾现场）拨回「跟随内容」→ secH 清空");
  v.closeSecMenu();
  v.repaint(false);

  /* ③ 任务勾选直接点：真 bindTaskToggles + 真 toggleTaskLine（vault.process 桩） */
  const mkFakeBox = () => {
    const b = document.createElement("input");
    b.type = "checkbox";
    b.setAttribute("disabled", "");
    return b;
  };
  const fakeBoxes26 = [mkFakeBox(), mkFakeBox()];
  const fakeBody26 = {
    querySelectorAll: (sel) => sel === "input.task-list-item-checkbox" ? fakeBoxes26 : [],
  };
  const TASK_RAW26 = ["# 标题", "", "- 普通项", "- [ ] 任务一", "- [x] 任务二", "尾巴"].join("\n");
  let procCalls26 = 0, procOut26 = null;
  const realVault26 = v.app.vault;
  v.app.vault = {
    process: async (file, fn) => { procCalls26++; procOut26 = fn(TASK_RAW26); return procOut26; },
  };
  const fakeFile26 = { path: "x/任务.md", stat: { mtime: 0 } };
  v.bindTaskToggles(fakeBody26, fakeFile26, TASK_RAW26);
  ok(fakeBoxes26[0].getAttribute("disabled") === null, "任务框的 disabled 真被摘了（能点了）");
  /* 对不上号：框(3) 比任务行(2) 多 → 整批不绑，别勾错行 */
  const boxes3 = [mkFakeBox(), mkFakeBox(), mkFakeBox()];
  v.bindTaskToggles(
    { querySelectorAll: (s2) => s2 === "input.task-list-item-checkbox" ? boxes3 : [] },
    fakeFile26, TASK_RAW26);
  ok(boxes3.every((b) => b.getAttribute("disabled") !== null),
    "框比任务行多 → 整批不绑（宁可点不动也别勾错行）");
  /* 勾第 1 个框 → change → process 拿到翻面后的全文 */
  fakeBoxes26[0].checked = true;
  fakeBoxes26[0].dispatchEvent(new W.Event("change", { bubbles: true }));
  await sleep26(30);
  eq(procCalls26, 1, "勾一下 → 真写文件（vault.process 恰 1 次）");
  ok(procOut26.indexOf("- [x] 任务一") >= 0 && procOut26.indexOf("- [x] 任务二") >= 0,
    "写回 = 任务一翻 [x]、任务二保持 [x]（顺序映射没错位、没误翻别的行）");
  v.app.vault = realVault26;

  /* ④ 长按：550ms 触发 / 位移取消 / 提前松手不弹 */
  const lpEl26 = document.createElement("div");
  let lpFired26 = 0, lpAt26 = null;
  v.bindLongPress(lpEl26, (x, y) => { lpFired26++; lpAt26 = [x, y]; });
  const touchEvt26 = (type, x, y) => {
    const e = new W.Event(type, { bubbles: true, cancelable: true });
    e.touches = [{ clientX: x, clientY: y }];
    return e;
  };
  lpEl26.dispatchEvent(touchEvt26("touchstart", 30, 40));
  await sleep26(650);
  eq(lpFired26, 1, "长按 550ms → 菜单回调恰好触发 1 次");
  ok(lpAt26 && lpAt26[0] === 30 && lpAt26[1] === 40, "触点坐标原样交出去（菜单在手指处弹）");
  lpEl26.dispatchEvent(touchEvt26("touchstart", 10, 10));
  lpEl26.dispatchEvent(touchEvt26("touchmove", 60, 10));
  await sleep26(650);
  eq(lpFired26, 1, "手指动了 50px = 在滚动 → 取消（不误弹）");
  lpEl26.dispatchEvent(touchEvt26("touchstart", 10, 10));
  lpEl26.dispatchEvent(new W.Event("touchend", { bubbles: true }));
  await sleep26(650);
  eq(lpFired26, 1, "没按够 550ms 就松手 → 不弹");

  /* ⑤ 渲染层：secH 有覆盖才写变量（继承 = 不写死，同宽度那把尺子） */
  /* 🔴 必须走 afterChange()（persist + repaint）：repaint 第一步 loadSecs() 会从 .base 重读，
   * 直接改 secs[0] 再 repaint = 白改（②那条「取消跟随」能过，靠的就是 afterChange）。 */
  v.secs[0].secH = 200;
  v.afterChange();
  const wrapA26 = v.listEl.querySelector(".cb-section");
  eq(wrapA26.style.getPropertyValue("--cb-card-h"), "200px", "secH=200 → 板块容器真写 --cb-card-h");
  v.secs[0].secH = null;
  v.afterChange();
  const wrapB26 = v.listEl.querySelector(".cb-section");
  eq(wrapB26.style.getPropertyValue("--cb-card-h"), "", "secH=null → 一个字都不写（继承 = 不写死）");

  /* --- ⑤ 只读模式：按钮该禁的禁、该换说明的换说明 --- */
  v.cfgSet("只读", true);
  v.repaint(false);
  menu = openSecMenu(0);
  const mkItem2 = [...menu.querySelectorAll(".cb-ctx-item")].find(e => e.getAttribute("data-act") === "新建文件");
  ok(!!mkItem2 && mkItem2.hasClass("is-disabled"), "只读模式：「新建文件」置灰（点了也不会真建）");
  ok(!menu.querySelector(".cb-ctx-addrow button.cb-add-type"), "只读模式：不摆那排数据源按钮（免得点了没反应）");
  ok(!!menu.querySelector(".cb-ctx-addrow-note"), "只读模式：如实说明「先点工具条 ✎」");
  const fkRO = menu.querySelector(".cb-ctx-item.cb-ctx-follow");
  ok(!!fkRO && !fkRO.hasClass("is-disabled"),
    "只读只挡「编辑笔记」，不挡视图配置（「跟随看板」仍可拨）");
  v.closeSecMenu();
  v.cfgSet("只读", null);
  v.repaint(false);
  ok(!v.readonly(), "（收拾现场）只读关掉");

  /* ---------- (10) R27：不关窗就地刷新 / 新建描边 / 收起本板块 / 面板填空 ---------- */
  head("R27 · 不关窗就地刷新 + 新建描边 + 收起本板块 + 面板填空");
  const sleep27 = (ms) => new Promise((r) => setTimeout(r, ms));
  const secAt = (i) => v.sections.find((s) => s.srcIndex === i);
  const actsOf = (m) => [...m.querySelectorAll(".cb-ctx-item")]
    .map((e) => e.getAttribute("data-act")).filter(Boolean);
  const grpOf = (label) => [...v.panelEl.querySelectorAll(".cb-grp")]
    .find((g) => g.querySelector(".cb-grp-lb").textContent === label);
  const wrowOf = (grp, label) => [...grp.querySelectorAll(".cb-grp-body > .cb-wrow")]
    .find((r) => r.querySelector(".cb-wlb").textContent === label);

  /* --- ① 「收起本板块」就在「刷新」下面，点完真收起 + 不关窗 --- */
  menu = openSecMenu(0);
  const acts27 = actsOf(menu);
  eq(acts27[0], "刷新", "第一项仍是「刷新」");
  eq(acts27[1], "收起本板块", "第 2 项就是「收起本板块」（老板点名的位置）");
  eq(v.isCollapsed(secAt(0), null, false), false, "起始状态：这一块是展开的");
  click([...menu.querySelectorAll(".cb-ctx-item")].find((e) => e.getAttribute("data-act") === "收起本板块"));
  eq(v.isCollapsed(secAt(0), null, false), true, "点了真收起（写进 K_FOLD 折叠表）");
  ok(!!document.body.querySelector(".cb-ctxmenu.cb-secmenu"), "收起完小窗**还开着**（改完不关窗）");
  ok(!!v.listEl.querySelector(".cb-grid.is-collapsed"), "看板上那一块真的收起来了");
  eq(actsOf(document.body.querySelector(".cb-ctxmenu.cb-secmenu"))[1], "展开本板块",
    "重画后第 2 项翻成「展开本板块」（标签跟着状态走，不是写死的）");
  click([...document.body.querySelectorAll(".cb-ctxmenu.cb-secmenu .cb-ctx-item")]
    .find((e) => e.getAttribute("data-act") === "展开本板块"));
  eq(v.isCollapsed(secAt(0), null, false), false, "（收拾现场）展开回来");
  v.closeSecMenu();
  v.repaint(false);

  /* --- ② 顶上那条回执：说清「刚改的是哪一项」，而不是 persist 的通用文案 --- */
  menu = openSecMenu(0);
  ok(!menu.querySelector(".cb-ctx-status"), "刚右键时没有回执（回执说的是「刚刚」）");
  const triB27 = [...menu.querySelectorAll(".cb-ctx-tri")].find((r) => r.getAttribute("data-field") === "body");
  click([...triB27.querySelectorAll(".cb-seg-btn")].find((b) => b.textContent === "关"));
  const st27 = document.body.querySelector(".cb-ctxmenu.cb-secmenu .cb-ctx-status");
  ok(!!st27, "改完设置 → 顶上出现一条回执");
  ok(!!st27 && /内容展开/.test(st27.textContent) && /关/.test(st27.textContent),
    "回执说的是具体那一项（「….内容展开 → 关」）");
  ok(!!st27 && st27.textContent.indexOf("已写入") < 0,
    "🔴 不是被 persist() 覆写过的通用文案（只写 saveState 就会变成这句废话）");
  eq(v.secs[0].body, false, "（顺带核一下）覆盖真写进这块了");
  v.secs[0].body = null;
  v.afterChange();
  v.closeSecMenu();

  /* --- ③ 新建后的描边闪：挂得上 / 重绘冲不掉 / 到点自己摘 --- */
  v.repaint(false);
  const card27 = v.listEl.querySelector(".cb-card");
  const fp27 = card27 && card27.getAttribute("data-path");
  ok(!!fp27, "拿到一张真卡的 data-path");
  const same27 = [...v.listEl.querySelectorAll(".cb-card")]
    .filter((c) => c.getAttribute("data-path") === fp27).length;
  v.flashNewCard(fp27);
  eq(v.listEl.querySelectorAll(".cb-card.cb-flash").length, same27,
    "flashNewCard → 同路径的卡都挂上 .cb-flash（描边闪起来）");
  eq(v.flashPath, fp27, "flashPath 记着它（给紧跟的那次重绘补类用）");
  v.repaint(false);
  eq(v.listEl.querySelectorAll(".cb-card.cb-flash").length, same27,
    "🔴 重绘之后描边还在（不是只闪一帧就被重绘冲掉）");
  await sleep27(1750);
  eq(v.listEl.querySelectorAll(".cb-card.cb-flash").length, 0, "~1.6s 后自己摘掉（不留常驻描边）");
  eq(v.flashPath, null, "flashPath 也清干净了（不留脏状态）");

  /* --- ④ 面板：摘要条跟着开关走 --- */
  head("R27 · 面板：摘要条 / 内容组 / 一键全收 / 已自定义");
  if (!v.panelOpen) click(v.rootEl.querySelector("button.cb-gear"));
  ok(v.panelOpen, "面板打开");
  const sub27 = v.panelEl.querySelector(".cb-panel-sub");
  ok(!!sub27, "窗头下面多了一条摘要（.cb-panel-sub）");
  ok(!!sub27 && /篇笔记/.test(sub27.textContent) && /个板块/.test(sub27.textContent),
    "摘要里有「N 篇笔记 · M 个板块」");
  ok(!!sub27 && /正文/.test(sub27.textContent) && /可编辑|只读/.test(sub27.textContent),
    "还报了正文开关与读写态");
  const bodySw27 = v.panelEl.querySelector('.cb-opt[data-key="显正文"] input.cb-opt-box');
  bodySw27.checked = true;
  fire(bodySw27, "change");
  ok(/正文开/.test(v.panelEl.querySelector(".cb-panel-sub").textContent),
    "拨「显正文」→ 摘要当场跟着变（不是打开面板才算一次）");
  const bodySw27b = v.panelEl.querySelector('.cb-opt[data-key="显正文"] input.cb-opt-box');
  bodySw27b.checked = false;
  fire(bodySw27b, "change");
  ok(/正文关/.test(v.panelEl.querySelector(".cb-panel-sub").textContent), "（收拾现场）拨回来 → 正文关");

  /* --- ⑤ 面板：四段 + 「内容」组真接线 --- */
  eq([...v.panelEl.querySelectorAll(".cb-grp > .cb-grp-lb")].map((e) => e.textContent).join(","),
    "卡片,看板行为,内容,板块", "四段段落名（R27 多了「内容」）");
  const contentGrp = grpOf("内容");
  ok(!!contentGrp, "「内容」组在面板里");
  const propsInp = contentGrp && contentGrp.querySelector("input.cb-props-text");
  ok(!!propsInp, "「内容」组里有「显示属性」文本框");
  eq(propsInp && propsInp.placeholder, "简介, 平台, 状态", "给了示例 placeholder");
  const charsRow = contentGrp && [...contentGrp.querySelectorAll(".cb-wrow")]
    .find((r) => r.querySelector(".cb-wlb").textContent === "正文上限");
  ok(!!charsRow, "「内容」组里有「正文上限」拉杆");
  eq(charsRow && charsRow.querySelector("input.cb-wrange").getAttribute("min"), "0",
    "正文上限从 0 起（0 = 不截断）");

  /* --- ⑥ 面板：「卡片」组三行（宽度 / 间距 / 高度） + 间距真写变量 --- */
  const cardGrp27 = grpOf("卡片");
  eq([...cardGrp27.querySelectorAll(".cb-grp-body > .cb-wrow .cb-wlb")].map((e) => e.textContent).join(","),
    "文件宽度,网格间距,卡片高度", "「卡片」组三行（R27 补了间距与默认高度）");
  const gapRow27 = wrowOf(cardGrp27, "网格间距");
  const gapRg27 = gapRow27.querySelector("input.cb-wrange");
  eq([gapRg27.getAttribute("min"), gapRg27.getAttribute("max"), gapRg27.getAttribute("step")].join("/"),
    "0/24/2", "间距拉杆 0–24 step 2");
  gapRg27.value = "16";
  fire(gapRg27, "change");
  eq(v.rootEl.style.getPropertyValue("--cb-gap"), "16px", "拨间距 → .cb-root 真写 --cb-gap: 16px");
  ok(SAVES.some((s) => s.key === "网格间距" && s.val === 16), "真落盘「网格间距」= 16");
  v.panelOpen = true;
  v.renderPanel();
  const gapRg27b = wrowOf(grpOf("卡片"), "网格间距").querySelector("input.cb-wrange");
  gapRg27b.value = "8";
  fire(gapRg27b, "change");
  ok(SAVES.some((s) => s.key === "网格间距" && s.val === 8), "（收拾现场）拨回 8");
  const hRow27 = wrowOf(grpOf("卡片"), "卡片高度");
  ok(!!hRow27 && hRow27.textContent.indexOf("跟随内容") >= 0,
    "「卡片高度」行带「跟随内容」打勾项（跟宽度的「跟随看板」同一套语言）");

  /* --- ⑦ 面板：「全部收起 / 全部展开」真生效 --- */
  const bulk27 = v.panelEl.querySelector(".cb-bulk");
  ok(!!bulk27, "「板块」组里有那一行一键操作");
  click(bulk27.querySelector(".cb-bulk-shut"));
  eq(v.isCollapsed(secAt(0), null, false), true, "点「全部收起」→ 板块真收起来（写的是同一张 K_FOLD）");
  ok(!!v.listEl.querySelector(".cb-grid.is-collapsed"), "看板上也真收了");
  click(v.panelEl.querySelector(".cb-bulk .cb-bulk-open"));
  eq(v.isCollapsed(secAt(0), null, false), false, "点「全部展开」→ 展开回来");
  ok(!!v.panelEl.querySelector(".cb-panel-msg"), "一键操作后那个面板状态行还在（没被重绘漏掉）");

  /* --- ⑧ 面板：有覆盖的行才挂「已自定义」徽标 --- */
  v.secs[0].secW = 300;
  v.afterChange();
  if (v.panelOpen) v.renderPanel();
  eq(v.panelEl.querySelectorAll(".cb-badge-ovr").length, 1, "有覆盖 → 恰一行标「已自定义」");
  ok(/已自定义/.test(v.panelEl.querySelector(".cb-badge-ovr").textContent), "徽标文案 = 已自定义");
  v.secs[0].secW = null;
  v.afterChange();
  if (v.panelOpen) v.renderPanel();
  eq(v.panelEl.querySelectorAll(".cb-badge-ovr").length, 0, "（收拾现场）覆盖清掉 → 徽标没了（不是每行都挂）");

  /* --- ⑨ 「隐藏空板块」真跳过 + 万一全空给人话 --- */
  const isEmptySec = (s) => !(s.total > 0) && !(s.entries && s.entries.length)
    && !(s.children && s.children.length);
  const shownBefore27 = v.listEl.querySelectorAll(".cb-section").length;
  const empties27 = v.sections.filter(isEmptySec).length;
  v.cfgSet("隐藏空板块", true);
  v.sig = null;
  v.onDataUpdated();
  const shownAfter27 = v.listEl.querySelectorAll(".cb-section").length;
  eq(shownAfter27, shownBefore27 - empties27,
    "开「隐藏空板块」→ 空的块真的不渲染了（本地空板块 " + empties27 + " 个）");
  if (shownAfter27 === 0) ok(!!v.listEl.querySelector(".cb-empty"), "全空时给一句人话（不留一片白）");
  v.cfgSet("隐藏空板块", null);
  v.sig = null;
  v.onDataUpdated();
  eq(v.listEl.querySelectorAll(".cb-section").length, shownBefore27, "（收拾现场）开关关掉 → 板块数复原");
  /* ================= R28：兜底「全部」加限 + 显示全部 + 正文限并发 ================= */
  head("R28 · 兜底「全部」：默认上限 50 + 显示全部 + 限并发");

  /* —— ① 造 120 篇 + 清空板块配置 → 正是老板的现场（板块被删空）—— */
  const many = [];
  for (let i = 1; i <= 120; i++) {
    const p = "01_新知识库/大量" + i + ".md";
    many.push({
      file: {
        path: p, name: "大量" + i + ".md", basename: "大量" + i,
        extension: "md", parent: { path: "01_新知识库" }, stat: { mtime: i, size: 10 },
      },
      frontmatter: {}, getValue() { return null; },
    });
  }
  v.data = { data: many, groupedData: [] };
  v.cfgSet("板块", null);            // ← 老板的现场：板块被删空 → 走兜底分支
  v.sig = null;
  v.repaint(true);
  eq(v.secs.length, 0, "板块配置清空");
  eq(v.sections.length, 1, "兜底只出一个「全部」块");
  eq(v.allCap(), 50, "兜底默认上限 = 50（插件级默认，老板拍板的值）");
  const allSec = v.sections[0];
  eq(allSec.source, "all", "兜底块 source = all（按钮的判据）");
  eq(allSec.total, 120, "total 报**真实总数** 120（不虚报）");
  eq(allSec.shownCount, 50, "shownCount = 50（上限真生效）");
  eq(v.allCappedCount, 70, "截断数如实记账 = 70");
  eq(allSec.entries.length, 50, "交给渲染的 entries 只有 50 条 —— 这就是不卡的原因");
  eq(v.listEl.querySelectorAll(".cb-card").length, 50, "看板上**真只建了 50 张卡**");
  ok(/全部板块超上限截断 70 篇/.test(v.countEl.textContent),
    "工具条如实写「全部板块超上限截断 70 篇」（不静默截断）");
  eq(v.listEl.querySelector(".cb-section-count").textContent, "50 / 120 条",
    "标题条数写「50 / 120 条」（显示数 / 总数）");
  const allBtn = v.listEl.querySelector(".cb-sec-allbtn");
  ok(!!allBtn, "兜底块标题旁真有「显示全部」按钮");
  eq(allBtn.textContent, "显示全部 120 篇（慎用）", "按钮文案带真实总数");

  /* —— ② 点「显示全部」→ 真写 .base + 真放开 —— */
  const savesBefore = SAVES.length;
  click(allBtn);
  const wrote = SAVES.slice(savesBefore).filter((s) => s.key === "全部板块上限");
  eq(wrote.length, 1, "点一下只写一次「全部板块上限」");
  eq(wrote[0].val, 0, "写的是 0 = 不限（不是硬写某个数）");
  eq(v.allCap(), 0, "读回来也是不限");
  eq(v.listEl.querySelectorAll(".cb-card").length, 120, "放开后 120 张卡全在");
  eq(v.listEl.querySelector(".cb-section-count").textContent, "120 条", "标题回到「120 条」（不再写 N / M）");
  eq(v.listEl.querySelector(".cb-sec-allbtn").textContent, "恢复上限 50 篇",
    "按钮变成「恢复上限 50 篇」—— 是**可逆**的门，不是单向开关");

  /* —— ③ 点「恢复上限」→ 删键，回插件默认 —— */
  click(v.listEl.querySelector(".cb-sec-allbtn"));
  eq(SAVES[SAVES.length - 1].key, "全部板块上限", "再点写的是同一个键");
  eq(SAVES[SAVES.length - 1].val, null, "写 null = 删键（回插件默认，不是硬写 50）");
  eq(v.allCap(), 50, "删键后读到插件默认 50");
  eq(v.listEl.querySelectorAll(".cb-card").length, 50, "卡数回到 50");

  /* —— ④ 上限可调（不是硬编码 50）—— */
  v.cfgSet("全部板块上限", 10);
  v.sig = null;
  v.repaint(true);
  eq(v.listEl.querySelectorAll(".cb-card").length, 10, "把上限拨到 10 → 只渲 10 张");
  eq(v.allCappedCount, 110, "截断数跟着变 = 110");
  eq(v.listEl.querySelector(".cb-sec-allbtn").textContent, "显示全部 120 篇（慎用）",
    "按钮文案仍是真实总数（不跟着上限走）");
  v.cfgSet("全部板块上限", null);
  v.sig = null;
  v.repaint(true);

  /* —— ⑤ 配了板块 → 兜底块不存在，按钮不该冒出来（回归护栏）—— */
  v.cfgSet("板块", [{ "名称": "收件箱", "数据源": "folder", "路径": "01_新知识库", "递归深度": 1, "上限": 30 }]);
  v.sig = null;
  v.repaint(true);
  eq(v.sections.length, 1, "配了板块 → 走正常路径");
  eq(v.listEl.querySelectorAll(".cb-sec-allbtn").length, 0, "不是兜底块 → **没有**「显示全部」按钮");
  eq(v.allCappedCount, 0, "非兜底路径 allCappedCount 归 0（不吃上一轮残留）");
  eq(v.listEl.querySelectorAll(".cb-card").length, 30, "普通板块的「上限 30」照旧（没被 R28 碰坏）");

  /* —— ⑥ 只读模式不给按钮（它要写配置）—— */
  v.cfgSet("板块", null);
  v.cfgSet("只读", true);
  v.sig = null;
  v.repaint(true);
  eq(v.listEl.querySelectorAll(".cb-sec-allbtn").length, 0, "只读模式不给「显示全部」按钮");
  v.cfgSet("只读", null);
  v.sig = null;
  v.repaint(true);

  /* —— ⑦ 正文限并发：真跑 pumpBody，量「同时在飞」的峰值 —— */
  v.bodyConcurrency = 2;
  v.bodyYieldMs = 0;                 // 金标：延时是实例字段 → 测试不让帧
  let inflight = 0, peak = 0;
  const doneOrder = [];
  v.loadBody = async function (item) {
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 4));
    inflight--;
    doneOrder.push(item.tag);
  };
  const mkBodyItem = (tag) => ({
    tag, file: { path: "x/" + tag + ".md" }, bodyEl: document.createElement("div"),
    chars: 0, state: "queued", card: null, showYaml: false, showLinks: true,
  });
  v.bodyItems = [];
  for (let i = 1; i <= 7; i++) { const it = mkBodyItem(i); v.bodyItems.push(it); v.bodyQueue.push(it); }
  await v.pumpBody();
  eq(peak, 2, "同时在飞的正文渲染峰值 = 2（并发被压住）");
  eq(doneOrder.length, 7, "7 篇全部渲染完（让帧 ≠ 丢活）");
  eq(v.bodyQueue.length, 0, "队列跑空");
  eq(v.bodyItems.filter((i) => i.state === "done").length, 7, "7 篇状态都推进到 done");
  ok(/正文 7\/7/.test(v.countEl.textContent), "工具条「正文 7/7」（进度是真算出来的）");

  /* —— ⑧ 并发可调：调到 1 → 峰值只能是 1 —— */
  inflight = 0; peak = 0; doneOrder.length = 0;
  v.bodyConcurrency = 1;
  v.bodyItems = [];
  for (let i = 1; i <= 4; i++) { const it = mkBodyItem(i); v.bodyItems.push(it); v.bodyQueue.push(it); }
  await v.pumpBody();
  eq(peak, 1, "并发调到 1 → 峰值 1（可调，不是硬编码）");
  eq(doneOrder.length, 4, "4 篇照样全跑完");

  /* —— ⑨ 单篇抛异常不能卡住队列（原来那一篇永远停在 rendering → 后面全堵）—— */
  v.bodyConcurrency = 2;
  v.bodyItems = [];
  doneOrder.length = 0;
  v.loadBody = async function (item) {
    if (item.tag === 2) throw new Error("这一篇炸了");
    doneOrder.push(item.tag);
  };
  for (const it of [mkBodyItem(1), mkBodyItem(2), mkBodyItem(3)]) { v.bodyItems.push(it); v.bodyQueue.push(it); }
  await v.pumpBody();
  eq(v.bodyItems.filter((i) => i.state === "done").length, 3, "炸了一篇 → 三篇都到 done（不卡在 rendering）");
  eq(v.bodyQueue.length, 0, "队列照旧跑空");
  eq(doneOrder.length, 2, "另外两篇真的渲了（不是被一起吞掉）");
  ok(/正文 3\/3/.test(v.countEl.textContent), "工具条「正文 3/3」（计数不会永远差一个）");

  console.log("\nR20-看板DOM冒烟: PASS " + pass + " / FAIL " + fail
    + (fail ? "\n" + fails.join("\n") : ""));
  process.exit(fail ? 1 : 0);
})();
