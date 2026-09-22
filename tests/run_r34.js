/* kb-toolkit R34 断言：**看板键盘可达性**（boss 选 B —— 只开「卡片菜单的键盘通道」）
 *
 * 背景（R33 取证，业主拍板前的利弊分析）：
 *   · 卡片标题 `<a>` **无 href / 无 tabindex / 无 role**（vendor 1938）→ 键盘够不到；
 *   · 卡片菜单唯一入口 = 右键 + 长按（vendor 2017）；菜单项全是 `div`、只绑 `click`、
 *     无 role / 无 tabindex / 无方向键（vendor 3114）；
 *   · 全仓 `tabindex` 计数 = **0** → 纯键盘用户在这一屏**一张笔记都打不开**。
 *
 * boss 在「给每张卡加 tabindex」与「只开菜单键盘通道」之间选了 **B = 后者**：
 *   不增 Tab 停靠点（一屏 40 张卡就是 40 个停靠点 = 键盘用户掉进沼泽），
 *   只在 cb-root 上加**一个** keydown 委托 + 一个 roving 高亮。
 *
 * 本轮落地（全部在**外层**，vendor 一个字节未改）：
 *   ① `installBoardKeyboard(view)`：root `tabindex="-1"`（不进 Tab 序）+ 委托 keydown
 *   ② 卡片区：↑↓←→ / Home / End 移动高亮 · Enter 打开笔记 · **菜单键 / Shift+F10** 开菜单
 *   ③ 菜单内：↑↓ / Home / End 移动 · Enter 执行（走 `.click()` 实测能触发 vendor 处理器）· Esc 由 vendor 自己收
 *   ④ 高亮：`.kb-key-nav` + `.kb-key-hot`（**只在键盘用过之后**才出现 → 鼠标用户零感知）
 *   ⑤ 收口：包装视图实例的 `onunload` → 视图关闭时摘掉 document 监听（不泄漏）
 *   ⑥ 挂载：包 `registerBasesView` 的 `factory`（每个视图实例各挂一份、随实例销毁）
 *
 * 🔴 铁律：断言按**意图**写（49）；桌面/鼠标行为零变化必须**可验证**；
 *        不依赖 `document.activeElement`（jsdom 里 `div.focus()` 不生效 → 会假红）。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { JSDOM } = require("jsdom");

/* ---------- DOM 桩（照 run_r20b 的做法：宿主自己的 createEl / createDiv ...） ---------- */
const dom = new JSDOM("<body><div id='view'></div></body>");
global.document = dom.window.document;
global.window = dom.window;
const W = dom.window;
W.Element.prototype.createEl = function (tag, opts) {
  opts = opts || {};
  const el = document.createElement(tag);
  if (opts.cls) el.className = opts.cls;
  if (opts.type) el.setAttribute("type", opts.type);
  if (opts.attr) for (const k in opts.attr) el.setAttribute(k, opts.attr[k]);
  if (opts.text != null) el.textContent = opts.text;
  this.appendChild(el);
  return el;
};
W.Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
W.Element.prototype.createSpan = function (o) { return this.createEl("span", o || {}); };
W.Element.prototype.createDiv = function (o) { return this.createEl("div", o || {}); };
W.Element.prototype.addClass = function (c) { this.classList.add(c); return this; };
W.Element.prototype.removeClass = function (c) { this.classList.remove(c); return this; };
W.Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); return this; };
W.Element.prototype.hasClass = function (c) { return this.classList.contains(c); };
W.Element.prototype.setAttr = function (k, v) { this.setAttribute(k, v); return this; };
W.Element.prototype.setText = function (t) { this.textContent = t; return this; };
W.Element.prototype.detach = function () { if (this.parentNode) this.parentNode.removeChild(this); };
W.Text.prototype.setText = function (t) { this.textContent = t; return this; };
if (!W.Element.prototype.scrollIntoView) W.Element.prototype.scrollIntoView = function () {};

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

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL " + n); } }
function eq(a, b, n) { ok(a === b, n + " (got=" + JSON.stringify(a) + " want=" + JSON.stringify(b) + ")"); }
function count(re, s) { return (s.match(re) || []).length; }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ""); }

const read = (f) => fs.readFileSync(path.join(PLUG, f), "utf8");
const src85 = read("src/85_modules_base.js");
const cbCss = stripComments(read("styles_src/cb.css"));
const vendor = read("vendor/creation-board.js");

/* 事件工具 */
function keyOn(el, k, mods) {
  const init = Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {});
  return el.dispatchEvent(new W.KeyboardEvent("keydown", init));
}

console.log("\n=== R34: 看板键盘可达性（boss 选 B：只开卡片菜单的键盘通道） ===");

/* ══════════════ A. vendor 现状取证（证明问题真实存在 + 我们的补偿点选对了） ══════════════ */
console.log("\n-- A. 先证「问题真在 vendor 里」：我们没改 vendor，只在外层补偿 --");

const vTitle = vendor.slice(vendor.indexOf('const titleEl = titleRow.createEl("a"'));
ok(/createEl\("a"[^)]*cb-title/.test(vTitle),
  "A1：卡片标题在 vendor 里是 **`<a>`**（不是 button）");
const vTitleSeg = vTitle.slice(0, vTitle.indexOf("mouseover"));
ok(!/href/.test(vTitleSeg.slice(0, 260)),
  "A2：那个 `<a>` **没有 href**（`createEl(\"a\", {...})` 里只有 cls/text）→ 原生不可聚焦");
eq(count(/tabindex|tabIndex/g, vendor), 0,
  "A3：vendor 全文件 `tabindex` 计数 = **0** —— 全仓没有任何一处建过 Tab 停靠点");
ok(/card\.addEventListener\("contextmenu"/.test(vendor),
  "A4：卡片菜单唯一入口之一是右键（`contextmenu`）");
ok(/this\.bindLongPress\(card, \(x, y, tgt\) =>/.test(vendor),
  "A5：另一个入口是长按（触屏）—— 两个都是**指针**路径，键盘一个都没有");
const vItem = vendor.slice(vendor.indexOf("const item = (label, fn, danger)"));
ok(/menu\.createDiv\(\{ cls: "cb-ctx-item"/.test(vItem),
  "A6：菜单项在 vendor 里是 **`div`**（`cb-ctx-item`）");
const vItemBody = vItem.slice(0, vItem.indexOf("return el;"));
ok(!/tabindex|tabIndex|role/.test(vItemBody),
  "A7：菜单项**无 role / 无 tabindex**，只绑了 `mousedown` + `click` → 键盘 Enter 不触发");

/* ══════════════ B. 我们的补偿：源码级（挂载点 + 零 tabindex 承诺） ══════════════ */
console.log("\n-- B. 补偿方式：包 factory 挂载 · root tabindex=\"-1\" · 卡片零 tabindex --");

const s85 = stripComments(src85);
eq(count(/KB\.modules\.installBoardKeyboard = installBoardKeyboard;/g, s85), 1,
  "B1：installBoardKeyboard 导出恰 1 处（复写病自检）");
ok(/function installBoardKeyboard\(view, opts\)/.test(s85),
  "B2：函数签名 = (view, opts) —— 收**视图实例**（openCardMenu 在视图上，不在插件实例上）");
/* 挂载点：包 reg.factory */
ok(/reg\.__kbKeyFactory/.test(s85) && /reg\.factory = function \(controller, containerEl\)/.test(s85),
  "B3：包 `reg.factory` 挂载 —— 每个视图实例各挂一份，随实例销毁");
ok(/installBoardKeyboard\(v\)/.test(s85),
  "B4：包装里真的调了 installBoardKeyboard（不是只留了个开关）");
ok(/return v;/.test(s85.slice(s85.indexOf("reg.factory = function"))),
  "B5：包装后**原样返回**视图实例（Obsidian 拿它当视图，不能吞）");
/* 零 Tab 停靠点承诺 */
ok(/root\.setAttribute\("tabindex", "-1"\)/.test(s85),
  "B6：🔴 root 只挂 `tabindex=\"-1\"`（可聚焦但**不进 Tab 序**）");
ok(!/"tabindex", "0"/.test(s85) && !/tabIndex = 0/.test(s85),
  "B7：🔴 **没有**任何地方挂 tabindex=\"0\" —— 这就是「不给每张卡加停靠点」的落地");

/* ══════════════ C. 真 DOM：装 → 导航 → 打开 → 菜单 → 执行 ══════════════ */
console.log("\n-- C. 真 DOM 冒烟：装通道 → 方向键 → Enter → 菜单键 → 菜单内导航 --");

(async function main() {
  const Board = KB.modules.CreationBoardPlugin;
  ok(typeof Board === "function", "C0：内嵌创作看板插件类可取得");

  /* 🔴 必须走 **BoardModule.onEnable** 这条路 —— 包装 factory 的挂载点就在
   *    patchViewRegistration 里，而它只在 onEnable 里被调。直接 `new Board(); inst.load()`
   *    会绕过整条链（第一版就踩了这个：全绿是假绿，真机根本没挂上）。 */
  const pluginStub = {
    app: STUB.makeApp(),
    settings: { modules: { "base.boardExclude": "" } },
    manifest: { id: "kb-toolkit" },
  };
  pluginStub.app.plugins = { enabledPlugins: new Set() };
  const BM = KB.modules.BoardModule;
  ok(typeof BM === "function", "C0b：BoardModule 可取得");
  const mod = new BM(pluginStub);
  await mod.onEnable();
  const inst = mod.inst;
  ok(!!inst && !!inst._basesViews && inst._basesViews.length >= 1,
    "C0c：BoardModule.onEnable 后内嵌看板已注册视图");
  const app = pluginStub.app;
  const reg = inst._basesViews[0].def;
  ok(!!reg.__kbKeyFactory, "C1：registerBasesView 时 factory 被我们包过（__kbKeyFactory 标记）");
  const host = document.getElementById("view");
  const v = reg.factory({ app: app, containerEl: host }, host);
  ok(!!v.__kbKeyNav,
    "C2：🔴 用真 factory 建出来的视图**自带** __kbKeyNav —— 挂载链路端到端接上了");
  ok(v.rootEl.getAttribute("tabindex") === "-1",
    "C3：视图 root 已被挂 tabindex=\"-1\"（装通道的副作用之一）");

  v.config = { data: {}, get: () => undefined, set: () => {}, query: { save() {} } };
  await app.vault.createFolder("01_新知识库");
  const files = [];
  for (let i = 1; i <= 3; i++) {
    const f = await app.vault.create("01_新知识库/键盘" + i + ".md", "# " + i);
    f.stat = { size: 3, mtime: 1, ctime: 1 };
    f.cache = { frontmatter: {}, tags: [] };
    files.push(f);
  }
  v.data = { data: files.map((f) => ({ file: f, frontmatter: {}, getValue: () => undefined })), groupedData: null };
  try { if (typeof v.buildSections === "function") v.sections = v.buildSections(); } catch (e) {}
  if (typeof v.repaint === "function") { try { await v.repaint(false); } catch (e) {} }

  const root = v.rootEl;
  const cards = root.querySelectorAll(".cb-card");
  ok(cards.length >= 3, "C4：真建出 ≥3 张卡片（got=" + cards.length + "）");

  /* C5：卡片区**零** tabindex（对比 A3 的 vendor 0，我们也没加） */
  let cardTab = 0;
  for (const el of root.querySelectorAll("*")) if (el.hasAttribute("tabindex") && el !== root) cardTab++;
  eq(cardTab, 0, "C5：🔴 卡片区**没有新增任何 tabindex**（实测 " + cardTab + "）—— 不增 Tab 停靠点");

  /* C6：未按键前鼠标用户零感知 */
  ok(!root.classList.contains("kb-key-nav"),
    "C6：🔴 **未按任何键之前** root 没有 kb-key-nav —— 鼠标用户不会看到任何新样式");

  const first = cards[0];
  /* C7：首次 ArrowDown 落在**第 1 张**（不跳过） */
  keyOn(first, "ArrowDown");
  ok(root.classList.contains("kb-key-nav"), "C7：按过键之后 root 才有 kb-key-nav");
  ok(cards[0].classList.contains("kb-key-hot"), "C8：🔴 首次 ArrowDown 落在**第 1 张**卡（不跳过第一张）");
  /* C9：连按推进 */
  keyOn(first, "ArrowDown");
  ok(cards[1].classList.contains("kb-key-hot") && !cards[0].classList.contains("kb-key-hot"),
    "C9：再按 ↓ → 高亮到第 2 张，第 1 张取消（同时只有一张高亮）");
  eq(root.querySelectorAll(".kb-key-hot").length, 1, "C10：任意时刻**恰 1 张**卡片高亮（roving）");
  /* C11：End / Home */
  keyOn(first, "End");
  ok(cards[cards.length - 1].classList.contains("kb-key-hot"), "C11a：End → 最后一张");
  keyOn(first, "Home");
  ok(cards[0].classList.contains("kb-key-hot"), "C11b：Home → 第一张");
  keyOn(first, "ArrowUp");
  ok(cards[0].classList.contains("kb-key-hot"), "C11c：首张再按 ↑ 不越界（仍停在首张）");
  /* C12：进入方向 —— 未高亮时 ↑ 落在最后一张 */
  v.__kbKeyNav.uninstall(); v.__kbKeyNav = KB.modules.installBoardKeyboard(v);
  keyOn(first, "ArrowUp");
  ok(cards[cards.length - 1].classList.contains("kb-key-hot"),
    "C12：未高亮时首按 ↑ 落在**最后一张**（进入方向语义）");

  /* C13：Enter = 打开笔记（走 vendor 的 openNote） */
  let opened = null;
  const origOpenNote = v.openNote;
  v.openNote = function (e, nt) { opened = [e.file.path, nt]; };
  keyOn(first, "Home");
  keyOn(first, "Enter");
  ok(opened && /键盘1\.md$/.test(opened[0]) && opened[1] === false,
    "C13：🔴 Enter 打开**当前高亮**那张卡对应的笔记（openNote(path,false)）got=" + JSON.stringify(opened));
  v.openNote = origOpenNote;

  /* C14：菜单键 / Shift+F10 = 用 vendor 的 openCardMenu 开菜单 */
  let menuCall = null;
  const origOpenMenu = v.openCardMenu;
  v.openCardMenu = function (card, entry, x, y) { menuCall = { path: entry.file.path, x: x, y: y }; return null; };
  v.closeCardMenu = function () {}; v.cardMenuEl = null;
  keyOn(first, "Home");
  keyOn(first, "ContextMenu");
  ok(menuCall && /键盘1\.md$/.test(menuCall.path),
    "C14：🔴 菜单键 → 开**高亮那张卡**的菜单（复用 vendor 的 openCardMenu，不另造一份）");
  menuCall = null;
  keyOn(first, "F10", { shiftKey: true });
  ok(!!menuCall, "C15：Shift+F10 等效（Windows / Linux 的第二个标准菜单键）");
  menuCall = null;
  keyOn(first, "F10");
  ok(!menuCall, "C16：单按 F10（无 Shift）**不**触发 —— 不误吞系统键");
  v.openCardMenu = origOpenMenu;

  /* C17：菜单内导航 + Enter 执行（用**真的** openCardMenu，验 .click() 通路） */
  const entry = { file: { path: "01_新知识库/键盘1.md", basename: "键盘1" } };
  const menu = v.openCardMenu(null, entry, 50, 50);
  const items = menu.querySelectorAll(".cb-ctx-item");
  ok(items.length >= 5, "C17：真菜单有 ≥5 项（got=" + items.length + "）");
  v.__kbKeyNav.hotItem(0);
  ok(items[0].classList.contains("kb-key-hot"), "C18：hotItem(0) 高亮首项");
  keyOn(items[0], "ArrowDown");
  ok(items[1].classList.contains("kb-key-hot") && !items[0].classList.contains("kb-key-hot"),
    "C19：菜单内 ↓ → 高亮第 2 项（且首项取消）");
  keyOn(items[0], "End");
  ok(items[items.length - 1].classList.contains("kb-key-hot"), "C20：菜单内 End → 末项");
  keyOn(items[0], "Home");
  ok(items[0].classList.contains("kb-key-hot"), "C21：菜单内 Home → 首项");
  /* Enter 执行：菜单首项是「在新标签页中打开」→ openNote(entry,true) */
  let mRun = null;
  v.openNote = function (e, nt) { mRun = [e.file.path, nt]; };
  keyOn(items[0], "Enter");
  ok(mRun && mRun[1] === true,
    "C22：🔴 菜单内 Enter 触发 vendor 的 click 处理器（`.click()` 通路成立）got=" + JSON.stringify(mRun));
  v.openNote = origOpenNote;

  /* ══════════════ D. 边界：输入态放行 / 不越界接管 ══════════════ */
  console.log("\n-- D. 边界：输入态放行 · 不越界接管 --");

  v.closeCardMenu(); v.cardMenuEl = null;
  const inp = document.createElement("input");
  root.appendChild(inp);
  const beforeD = v.__kbKeyNav.currentCard();
  keyOn(inp, "ArrowDown");
  ok(v.__kbKeyNav.currentCard() === beforeD, "D1：焦点在 `<input>` 上时方向键**不**被接管（输入态放行）");
  root.removeChild(inp);

  /* D2：看板外的按键不接管 */
  const outside = document.createElement("div");
  document.body.appendChild(outside);
  const beforeD2 = v.__kbKeyNav.currentCard();
  const ev2 = keyOn(outside, "ArrowDown");
  ok(v.__kbKeyNav.currentCard() === beforeD2 && !ev2.defaultPrevented,
    "D2：焦点在**看板之外**时方向键不接管（不抢全文档）");
  document.body.removeChild(outside);

  /* D3：不装鼠标事件（结构性：源码里 installBoardKeyboard 段内不许有 mouse 监听） */
  const kbSeg = s85.slice(s85.indexOf("function installBoardKeyboard"), s85.indexOf("KB.modules.installBoardKeyboard = installBoardKeyboard;"));
  eq(count(/addEventListener\("(mousedown|mouseup|click|dblclick|contextmenu)"/g, kbSeg), 0,
    "D3：🔴 installBoardKeyboard 里**零鼠标事件监听** —— 鼠标行为逐字节不变");

  /* ══════════════ E. 收口：视图关闭摘监听（不泄漏） ══════════════ */
  console.log("\n-- E. 收口：包视图 onunload → 关视图摘监听 --");

  ok(/view\.__kbKeyUnloadWrapped/.test(s85), "E1：包 onunload 有「只包一次」守卫");
  ok(/var origUnload = view\.onunload;/.test(s85), "E2：真包了（留了原方法引用，调用链不断）");
  ok(/origUnload\.apply\(this, arguments\)/.test(s85), "E3：包装后**仍然调用**原 onunload（vendor 的收尾照跑）");

  /* 真验一遍：调 onunload → __kbKeyNav 被清空 + 类被摘 */
  const v2 = reg.factory({ app: app, containerEl: host }, host);
  const nav2 = v2.__kbKeyNav;
  ok(!!nav2, "E4：第二个视图实例同样装上通道");
  try { v2.onunload(); } catch (e) {}
  ok(v2.__kbKeyNav === null, "E5：🔴 视图 onunload 后 __kbKeyNav 被清（document 监听已摘，不泄漏）");
  ok(!v2.rootEl.classList.contains("kb-key-nav"), "E6：onunload 同时摘掉 kb-key-nav 类");

  /* ══════════════ F. 样式：高亮可见但不喧宾夺主 ══════════════ */
  console.log("\n-- F. 高亮样式（键盘用户看得到自己在哪） --");

  ok(/\.cb-root\.kb-key-nav \.cb-card\.kb-key-hot/.test(cbCss),
    "F1：卡片高亮选择器 = `.kb-key-nav` + `.kb-key-hot` 双门禁（键盘用过才生效）");
  const hotRule = (cbCss.match(/\.cb-root\.kb-key-nav \.cb-card\.kb-key-hot\s*\{[^}]*\}/) || [""])[0];
  ok(/border-color:\s*var\(--interactive-accent\)/.test(hotRule),
    "F2：卡片高亮用 `--interactive-accent`（跟主题走，不写裸色值）");
  ok(!/!important/.test(hotRule), "F3：不用 !important（项目铁律）");
  ok(/\.cb-ctxmenu \.cb-ctx-item\.kb-key-hot/.test(cbCss),
    "F4：菜单项高亮有独立规则（与 .cb-ctx-item:hover 同通道 = 背景色）");
  /* hover 块仍存在（没被高亮规则顶掉） */
  ok(/\.cb-card:hover/.test(cbCss), "F5：原有 :hover 规则仍在（键盘高亮是**叠加**，不是替换）");

  /* ══════════════ G. 桌面/鼠标零影响（可验证） ══════════════ */
  console.log("\n-- G. 桌面 / 鼠标零影响 --");

  eq(count(/@media \(hover: hover\)/, cbCss) >= 1, true,
    "G1：cb.css 的 hover 仍包在 (hover:hover) 里（R33 铁律 74 没被碰）");
  ok(!/kb-key-hot/.test(vendor) && !/kb-key-nav/.test(vendor),
    "G2：🔴 vendor 里**没有**我们任何类名 —— 一个字节没改");
  ok(!/kb-key/.test(read("styles_src/kbt.css")),
    "G3：设置页样式（kbt.css）没被牵连 —— 键盘通道只管看板");

  console.log("\nR34: PASS " + pass + " / FAIL " + fail);
  if (fails.length) { console.log("\n失败项："); fails.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
})();
