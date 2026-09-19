/* kb-toolkit R18 断言：设置页排版 v3（boss：《设置页排版方案v3-交互效果图》）。
 *   ① 页头 = 标题 + 右上角版本号；「日志 / 关于」在标签行右端
 *   ② 搜索框 = 整行输入框 + 一条淡色提示条；命中他页给可点链接（不自动跳页）
 *   ③ 模块头 = 标题 + 开关一行 → 短横 → 状态行（主行 + ⓘ 同行）
 *   ④ 栏目 = 卡片外小标签（.kbt-lb）+ 卡片；卡片内每项一行、行间淡分隔线
 *   ⑤ 「高级」折叠组 summary 只有「高级」两字，箭头由 CSS 画
 *   ⑥ 帮助栏 = 页底一栏入口 + 点开悬浮小窗；小窗条目「键 + 说明」一行一条
 *   ⑦ 样式照 v3：卡片走 --background-secondary、按钮淡底走 color-mix（零裸色）
 * 本套只测「v3 规格」本身，机制类断言在 r13/r14/r16。 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<body></body>");
global.document = dom.window.document;
dom.window.Element.prototype.createEl = function (tag, opts) {
  opts = opts || {};
  const el = document.createElement(tag);
  if (opts.text != null) el.textContent = opts.text;
  if (opts.cls) el.className = opts.cls;
  if (opts.attr) for (const k in opts.attr) el.setAttribute(k, opts.attr[k]);
  this.appendChild(el);
  return el;
};
dom.window.Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
dom.window.Element.prototype.createSpan = function (opts) { return this.createEl("span", opts || {}); };

const STUB = require("./stub_obsidian.js");
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return STUB;
  return origLoad.apply(this, arguments);
};

let pass = 0, fail = 0; const fails = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; fails.push(name); console.log("  FAIL " + name); }
}
function eq(a, b, name) { ok(a === b, name + " (got=" + JSON.stringify(a) + " want=" + JSON.stringify(b) + ")"); }

require("../main.js");
const KB = globalThis.KB;
const PLUG = path.join(__dirname, "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(app, modules, extra) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit", dir: ".obsidian/plugins/kb-toolkit" });
  plugin.data = Object.assign({ modules: modules, wizardDone: true }, extra || {});
  await plugin.onload();
  return plugin;
}
function findSettingEl(containerEl, name) {
  for (const el of containerEl.querySelectorAll("*")) {
    const s = el._setting;
    if (s && s._name === name) return el;
  }
  return null;
}
function secCard(containerEl, label) {
  for (const sec of containerEl.querySelectorAll(".kbt-sec")) {
    const lb = sec.querySelector(".kbt-lb");
    if (lb && lb.textContent === label) return sec.querySelector(".kbt-card");
  }
  return null;
}
function rowNames(card) {
  return [...card.querySelectorAll(".setting-item")]
    .map(el => (el._setting ? el._setting._name : ""))
    .filter(Boolean);
}

(async function main() {
  const app = STUB.makeApp();
  const plugin = await boot(app, { rebuild: true, automation: true, base: true });
  const tab = plugin.settingTab;
  tab.containerEl = document.createElement("div");
  document.body.appendChild(tab.containerEl);
  tab.display();

  /* ---------- ① 页头 ---------- */
  {
    const head = tab.containerEl.querySelector(".kbt-head");
    const wantVer = (plugin.manifest && plugin.manifest.version) || "1.0.0";
    eq(head.querySelector(".kbt-ver").textContent, "v" + wantVer,
      "① -1：版本号 = manifest.version（缺版本时退到 1.0.0）");
    const title = head.querySelector("h3");
    eq((title.textContent || "").indexOf("知识库工具集"), 0, "① -2：标题在最前");
    ok(head.querySelector(".kbt-ghost-btn") === null,
      "① -3：页头里不再塞「日志 / 关于」（挪到标签行）");
  }

  /* ---------- ② 搜索框 ---------- */
  {
    const wrap = tab.containerEl.querySelector(".kbt-search");
    ok(!!wrap, "② -1：有搜索容器");
    eq(wrap.children.length, 1, "② -2：容器里只有输入框本身（不带「搜索设置」标题行）");
    eq(wrap.firstChild.tagName, "INPUT", "② -3：唯一子元素就是输入框");
    const ph = wrap.firstChild.getAttribute("placeholder") || "";
    ok(ph.indexOf("搜索设置") >= 0 && ph.indexOf("卡片宽度") >= 0,
      "② -4：占位文案照效果图（" + ph + "）");
    const hint = tab.containerEl.querySelector(".kbt-search-empty");
    ok(!!hint && hint.hasAttribute("hidden"), "② -5：提示条默认隐藏");
  }

  /* ---------- ③ 模块头 ---------- */
  {
    const heads = [...tab.containerEl.querySelectorAll(".setting-item.kbt-switch")];
    eq(heads.length, 3, "③ -1：三个模块头（命名行 + 开关）");
    eq(heads.map(el => el._setting._name).join(","), "新建知识库,笔记自动化,更多的 Base",
      "③ -2：模块名（无 ①②③）");
    ok(heads.every(el => !!el._setting._toggle), "③ -3：每个模块头右侧都有滑动开关");
    ok(heads.every(el => el.querySelector(".kbt-info") === null),
      "③ -4：模块头里不再挂 ⓘ（提示挪进状态行）");
    eq(tab.containerEl.querySelectorAll(".kbt-rule").length, 3, "③ -5：三个模块头下各一条短横");
    const st = tab._sectionBoxes.rebuild.querySelector(".kbt-status");
    const top = st.querySelector(".kbt-status-top");
    ok(!!top && !!top.querySelector(".kbt-status-main") && !!top.querySelector(".kbt-info"),
      "③ -6：状态行 = 文字 + ⓘ 同一行（效果图 .mstat）");
  }

  /* ---------- ④ 栏目 = 小标签 + 卡片 ---------- */
  {
    const secs = [...tab.containerEl.querySelectorAll(".kbt-sec")];
    eq(secs.length, 12, "④ -1：12 个栏目（R19 起三页各 4 栏 —— 多出「当前状态」栏）");
    eq(secs.filter(s => s.classList.contains("kbt-status-card")).length, 3,
      "④ -1b：三页各有一个「当前状态」栏（R19 需求3：状态独立成栏）");
    ok(secs.every(s => s.querySelector(":scope > .kbt-lb") && s.querySelector(":scope > .kbt-card")),
      "④ -2：每个栏目都是「小标签 + 卡片」两段（标签在卡片外）");
    ok(secs.every(s => !s.querySelector(".kbt-card > h5")),
      "④ -3：栏目名不再放进卡片里（卡片只装设置行）");
    const core = secCard(tab.containerEl, "核心操作");
    eq(rowNames(core).join(","), "预览报告,执行,回滚", "④ -4：核心操作 = 三行（效果图一行一件事）");
    const aux = secCard(tab.containerEl, "辅助");
    eq(rowNames(aux).join(","), "首次使用向导,操作日志", "④ -5：辅助 = 向导 + 操作日志");
    const batch = secCard(tab.containerEl, "批量操作");
    eq(rowNames(batch).join(","), "一键补全,标签-目录映射表",
      "④ -6：映射表按效果图提到「批量操作」栏（不再埋在高级里）");
    const scope = secCard(tab.containerEl, "看板范围");
    eq(rowNames(scope).join(","), "排除目录", "④ -7：Base 页「看板范围」栏 = 排除目录");
  }

  /* ---------- ⑤ 高级折叠组 ---------- */
  {
    const advs = [...tab.containerEl.querySelectorAll("details.kbt-adv")];
    eq(advs.length, 3, "⑤ -1：三处「高级」");
    eq(advs.map(d => d.querySelector("summary").textContent).join(","), "高级,高级,高级",
      "⑤ -2：summary 只有「高级」两字（箭头交给 CSS）");
    ok(advs.every(d => d.querySelector(":scope > .kbt-card")),
      "⑤ -3：高级组内容同样进卡片（收起来时不占位）");
    const kb = rowNames(advs[0].querySelector(".kbt-card"));
    eq(kb.join(","), "知识库根目录,元数据目录名", "⑤ -4：① 的高级 = 根目录 / 元数据目录名");
    const base = advs[2].querySelector(".kbt-card");
    ok(/卡片宽度/.test(base.textContent || ""),
      "⑤ -5：③ 的高级里点明「卡片宽度 / 空位铺满整行」在哪调（视图级选项，不放全局开关）");
  }

  /* ---------- ⑥ 帮助栏（一栏 + 悬浮小窗） ---------- */
  {
    const helpCards = [...tab.containerEl.querySelectorAll(".kbt-sec")].filter(s => {
      const lb = s.querySelector(".kbt-lb");
      return lb && lb.textContent === "帮助";
    });
    eq(helpCards.length, 3, "⑥ -1：每页底部一栏「帮助」");
    ok(rowNames(helpCards[0].querySelector(".kbt-card")).join(",") === "本页提示",
      "⑥ -2：帮助栏只有一行入口");
    const pop = tab._pops.rebuild;
    ok(!!pop && pop.hasAttribute("hidden"), "⑥ -3：点开前小窗是收起的");
    const rows = [...pop.querySelectorAll(".kbt-help-item")];
    ok(rows.length === KB.modules.HELP.rebuild.length,
      "⑥ -4：小窗条目数 = 该页帮助条数（" + rows.length + "）");
    ok(rows.every(r => r.classList.contains("kbt-hrow") && r.querySelector(".kbt-hk") && r.querySelector(".kbt-hv")),
      "⑥ -5：条目结构 = 键 + 说明（效果图 .hrow）");
    const keys = rows.map(r => r.querySelector(".kbt-hk").textContent);
    ok(keys.indexOf("预览报告") >= 0 && keys.indexOf("执行") >= 0 && keys.indexOf("回滚") >= 0,
      "⑥ -6：键名与页内操作对得上（" + keys.join(" / ") + "）");
    ok((pop.textContent || "").indexOf("元数据目录") >= 0,
      "⑥ -7：路径说明是动态拼的（不写死顶层目录名）");
    /* 点开 → 小窗仍可用（交互保持：boss 明确说「帮助栏点开后还是悬浮小窗」） */
    const btn = [...helpCards[0].querySelectorAll("button")].find(b => b.textContent === "查看提示");
    btn.click();
    ok(!pop.hasAttribute("hidden") && !!pop.querySelector(".kbt-pop-body"), "⑥ -8：点开 → 悬浮小窗（交互不变）");
    pop.querySelector(".kbt-pop-x").click();
    ok(pop.hasAttribute("hidden"), "⑥ -9：可关闭");
  }

  /* ---------- ⑦ 样式照 v3（零裸色） ---------- */
  {
    const css = fs.readFileSync(path.join(PLUG, "styles_src", "kbt.css"), "utf8");
    eq((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0, "⑦ -1：kbt.css 零裸 hex");
    ok(/\.kbt-card\s*{[^}]*background:\s*var\(--background-secondary\)/.test(css),
      "⑦ -2：卡片是次级底色（效果图 .card）");
    ok(/\.kbt-card \.setting-item\s*{[^}]*padding:\s*12px 0/.test(css)
      && /\.kbt-card \.setting-item\s*{[^}]*border-bottom:\s*1px solid var\(--background-modifier-border\)/.test(css),
      "⑦ -3：卡片内每行 12px 内边距 + 一条淡分隔线（效果图 .row）");
    ok(/\.kbt-card \.setting-item:last-child\s*{\s*border-bottom:\s*none/.test(css),
      "⑦ -4：末行不留分隔线");
    ok(/\.kbt-group\s*{\s*border:\s*none/.test(css) && /\.kbt-group \+ \.kbt-group\s*{[^}]*border-top/.test(css),
      "⑦ -5：模块组不再套外框，改用一条分隔线（效果图无分组壳）");
    ok(/\.kbt-adv > summary::before\s*{\s*content:\s*"›/.test(css)
      && /\.kbt-adv\[open\] > summary::before\s*{\s*content:\s*"⌄/.test(css),
      "⑦ -6：高级箭头由 CSS 画（› / ⌄）");
    ok(/\.kbt-lb\s*{[^}]*color:\s*var\(--text-faint\)/.test(css), "⑦ -7：小标签是弱化色");
    ok(/\.kbt-hrow\s*{[^}]*display:\s*flex/.test(css) && /\.kbt-hk\s*{\s*flex:\s*none/.test(css),
      "⑦ -8：帮助条目横排、键不换行");
    ok(/\.kbt-ghost-btns\s*{[^}]*margin-left:\s*auto/.test(css), "⑦ -9：两个入口靠右");
    /* R19 需求4：栏内按钮统一素色 → 不再有 cta 淡紫底；但「零裸色」这条底线不能松 */
    ok(/\.kbt-card button:not\(\.kbt-inline-btn\)[^{]*\{[^}]*background:\s*var\(--background-primary\)/.test(css),
      "⑦ -10：R19 按钮统一素色（底色走 --background-primary，零裸色不变）");
    ok(css.indexOf(".kbt-card .mod-cta") < 0 && css.indexOf(".kbt-card .mod-warning") < 0,
      "⑦ -11：栏内不再给 .mod-cta / .mod-warning 单开配色");
  }

  console.log("\nR18 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exitCode = 1; }
})();
