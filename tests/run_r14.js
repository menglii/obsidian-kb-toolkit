/* kb-toolkit R14 断言：界面美化（boss 四张截图报「很丑」后的整改）。
 *   A. 设置页 —— 组标题与开关行合并（不再重复两遍）/ 状态横幅改 callout 且全文无 Markdown 星号
 *      / 核心操作栏在 / 锚点随标题行走
 *   B. vendor 源级 —— 内容流徽章上限 2 个（有意分叉）/ 板块编辑表单分「基础/显示」两段
 *      / 配置搬运 JSON 收进默认折叠的高级组
 *   C. 样式源级 —— 看板 auto-fit（空轨道坍缩）/ 内容流正文截断 2 行 / 栏目卡片边界
 *      / 目录树限高 / 完成删除按钮靠右
 *   R18 注：外框从「模块组」挪到「栏目卡片」（.kbt-card），模块组改由分隔线区分 —— C3 已随改。 */
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
  const all = containerEl.querySelectorAll("*");
  for (const el of all) {
    const s = el._setting;
    if (s && s._name === name) return el;
  }
  return null;
}

(async function main() {
  /* ================= A. 设置页 ================= */
  {
    const app = STUB.makeApp();
    const plugin = await boot(app, { rebuild: true, automation: true, base: true });
    const tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();

    eq(tab.containerEl.querySelectorAll(".kbt-group > h4").length, 0,
      "A1：裸 h4 组标题已取消（R13 的重复文案根因）");
    /* R16（boss 第 5 条）：模块标题去掉 ①②③ 序号 */
    const headEl = findSettingEl(tab.containerEl, "新建知识库");
    ok(!!headEl && headEl.classList.contains(KB.modules.ANCHOR_CLS),
      "A2：① 标题行（setHeading）带锚点类 —— keepAnchor 机制跟标题行走");
    for (const name of ["笔记自动化", "更多的 Base"])
      ok(!!findSettingEl(tab.containerEl, name), "A2：标题行「" + name + "」存在");
    ok((tab.containerEl.textContent || "").indexOf("①") === -1,
      "A2b：设置页全文不再出现 ①②③ 序号（R16 去序号）");

    const statusBox = tab.containerEl.querySelector(".kbt-status");
    ok(!!statusBox && statusBox.classList.contains("callout")
      && statusBox.getAttribute("data-callout") === "info",
      "A3：状态横幅是 info callout（不再裸文本）");
    ok(!!statusBox.querySelector(".kbt-status-main") && !!statusBox.querySelector(".kbt-status-sub"),
      "A4：横幅分主行（粗体）/ 副行（细节+引导）两层");
    await sleep(30);
    const mainTxt = statusBox.querySelector(".kbt-status-main").textContent || "";
    ok(mainTxt.indexOf("当前状态") === 0, "A5：主行自动读取状态");
    eq((tab.containerEl.textContent || "").indexOf("**"), -1,
      "A6：设置页全文不再出现 Markdown 星号（R13 的 `**再次执行**` 硬伤）");

    /* R18：核心操作从「一行三钮」改成「一行一件事」—— 卡片带 kbt-core-actions，内含三行 */
    const coreCard = tab.containerEl.querySelector(".kbt-core-actions");
    ok(!!coreCard && coreCard.querySelectorAll(".setting-item").length === 3,
      "A7：核心操作栏在（R18：三行三钮，卡片自身带 kbt-core-actions）");
    await plugin.onunload();
  }

  /* ================= B. vendor 源级 ================= */
  {
    const bp = fs.readFileSync(path.join(PLUG, "vendor", "bases-preview.js"), "utf8");
    ok(bp.indexOf("bns-chip-more") >= 0 && bp.indexOf('ci < 2') >= 0,
      "B1：内容流徽章最多 2 个、其余进「+N」");
    const cb = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8");
    eq((cb.match(/cb-edit-sep/g) || []).length >= 2, true,
      "B2：板块编辑表单有分段小标题（基础 / 显示 两处）");
    ok(cb.indexOf('createEl("details", { cls: "cb-io cb-panel-adv" })') >= 0
      && cb.indexOf("高级：配置搬运") >= 0,
      "B3：配置搬运（裸 JSON）收进默认折叠的高级组");
  }

  /* ================= C. 样式源级 ================= */
  {
    const cbCss = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
    const nsCss = fs.readFileSync(path.join(PLUG, "styles_src", "ns.css"), "utf8");
    const kbtCss = fs.readFileSync(path.join(PLUG, "styles_src", "kbt.css"), "utf8");
    ok(/\.cb-grid\s*{[^}]*auto-fit/.test(cbCss), "C1：看板栅格 auto-fit（空轨道坍缩，卡片铺满整行）");
    ok(/\.bns-body\s*{[^}]*-webkit-line-clamp:\s*2/.test(nsCss), "C2：内容流正文截断 2 行");
    ok(/\.kbt-card\s*{[^}]*var\(--radius-m\)/.test(kbtCss)
      && /\.kbt-card\s*{[^}]*var\(--background-secondary\)/.test(kbtCss),
      "C3：栏目卡片是次级底 + 圆角（R18：外框从模块组挪到卡片，仍走原生变量）");
    ok(/\.cb-tree\s*{[^}]*max-height:\s*220px/.test(cbCss), "C4：目录点选树限高滚动");
    ok(/\.cb-edit-foot\s*{[^}]*justify-content:\s*flex-end/.test(cbCss), "C5：完成/删除按钮靠右");
  }

  console.log("\nR14 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
})();
