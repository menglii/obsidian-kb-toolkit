/* kb-toolkit R13 断言：界面翻新（boss：操作界面 + 设置界面贴合原生、三级分层、新手零门槛）。
 *   A. 设置页三级分层 —— 三个模块组（.kbt-group）+ 三处「高级」<details>（默认折叠）
 *   B. 设置搜索框 —— 输入即过滤、命中高级组自动展开、空结果给建议词、清空复位
 *   C. ① 状态横幅 —— 自动读取（不再要「查看状态」按钮）、fresh 时给下一步引导
 *   D. ① 核心操作 —— R18 起「一行一件事」（预览报告 / 执行 / 回滚），报告入口并进「辅助」栏
 *   E. 命令面板裁剪 —— 只剩 4 条：open-settings + 预览/回滚/打开日志（无执行、无查看状态、无补全）
 *   F. 向导模块关着也能点（R18：收进「辅助」栏，由 CSS 保住指针事件）
 *   G. 看板视图设置面板 —— 「高级：正文细节与拖动行为」折叠组（vendor 源级） */
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
/* R13：src 里用到了 createSpan（Obsidian 给 Element 的扩展），桩里补上 */
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
/* R18：栏目名从卡片内 h5 挪到卡片外的小标签（.kbt-lb）—— 找卡片就按小标签找 */
function cardByLabel(containerEl, label) {
  for (const sec of containerEl.querySelectorAll(".kbt-sec")) {
    const lb = sec.querySelector(".kbt-lb");
    if (lb && lb.textContent === label) return sec.querySelector(".kbt-card");
  }
  return null;
}

(async function main() {
  /* ================= A. 三级分层骨架 ================= */
  let plugin, tab;
  {
    const app = STUB.makeApp();
    plugin = await boot(app, { rebuild: true, automation: true, base: true });
    tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();

    eq(tab.containerEl.querySelectorAll(".kbt-group").length, 3,
      "A1：三个模块组（①②③ 各一个 .kbt-group）");
    const advs = tab.containerEl.querySelectorAll("details.kbt-adv");
    eq(advs.length, 3, "A2：三处「高级」折叠组（路径 / 模板与规则 / 看板显示项）");
    let allClosed = true;
    for (const d of advs) if (d.open) allClosed = false;
    ok(allClosed, "A3：高级组默认全部收起（低频项不抢第一屏）");
    ok(!!tab.containerEl.querySelector(".kbt-search-input"), "A4：顶部有搜索框");
    eq(tab.containerEl.querySelectorAll(".kb-module-section").length, 3,
      "A5：R10 段落机制原样保留（三个固定槽）");
    ok(!!tab.containerEl.querySelector("." + KB.modules.ANCHOR_CLS),
      "A6：keepAnchor 锚点仍在（R7 机制不空跑）");
    await plugin.onunload();
  }

  /* ================= B. 搜索框过滤 ================= */
  {
    const app = STUB.makeApp();
    plugin = await boot(app, { rebuild: true, automation: true, base: true });
    tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();
    const adv1 = tab.containerEl.querySelector("details.kbt-adv");

    eq(tab._applyFilter(""), 0, "B1：空关键字 → 0 条命中（全显示）");
    eq(tab._applyFilter("知识库根目录") > 0, true, "B2：命中「知识库根目录」");
    eq(adv1.open, true, "B3：命中高级组里的项 → 该组自动展开");
    ok(tab.containerEl.querySelector(".kbt-search-empty").hidden === true,
      "B4：有命中 → 不显示空态提示");

    const n0 = tab._applyFilter("完全不存在的关键词xyzzy");
    eq(n0, 0, "B5：乱敲一个词 → 本页 0 条命中");
    const hint = tab.containerEl.querySelector(".kbt-search-empty");
    ok(hint.hidden === false && hint.textContent.indexOf("试试这些词") >= 0,
      "B6：空态给建议词（新手知道该搜什么）");
    ok(!!tab.containerEl.querySelector(".kbt-group[hidden]"),
      "B7：无命中的组整组隐藏（界面不留空壳）");

    tab._applyFilter("");
    eq(adv1.open, false, "B8：清空关键字 → 高级组复位收起");
    ok(!tab.containerEl.querySelector(".kbt-group[hidden]"), "B9：清空 → 所有组恢复显示");
    await plugin.onunload();
  }

  /* ================= C+D. ① 状态横幅 / 核心操作 / 报告入口 ================= */
  {
    const app = STUB.makeApp();
    plugin = await boot(app, { rebuild: true, automation: false, base: false });
    tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();
    const box = tab._sectionBoxes.rebuild;

    const statusEl = box.querySelector(".kbt-status");
    ok(!!statusEl, "C1：状态横幅存在");
    await sleep(30);
    ok(/^(已启用|未启用)/.test(statusEl.textContent || "") && !!statusEl.querySelector(".kbt-led"),
      "C2（R20 需求1）：状态行只报「是否启用」+ 一颗状态圆点（小字副行去掉）");
    ok(findSettingEl(tab.containerEl, "查看当前状态") === null,
      "C3：「查看当前状态」独立行已并入横幅（重复入口移除）");

    /* R18（效果图 核心操作）：一行一件事 —— 三行三钮，顺序 = 预览 → 执行 → 回滚 */
    const coreCard = tab.containerEl.querySelector(".kbt-core-actions");
    ok(!!coreCard, "D1：核心操作栏存在（卡片带 kbt-core-actions）");
    const coreRows = [...coreCard.querySelectorAll(".setting-item")];
    const rowName = el => (el._setting ? el._setting._name : "");
    const rowBtn = el => (el._setting && el._setting._buttons[0]) || {};
    eq(coreRows.length, 3, "D2：三行（预览报告 / 执行 / 回滚）");
    eq(coreRows.map(rowName).join(","), "预览报告,执行,回滚", "D3：行名即操作名，顺序即流程");
    eq(coreRows.map(el => rowBtn(el).text).join(","), "生成预览报告,执行,回滚", "D4：按钮文案");
    eq(coreRows.map(el => (rowBtn(el).cta ? "cta" : (rowBtn(el).warning ? "warn" : "-"))).join(","),
      "-,-,-", "D5：R19 三个按钮一律素色（去掉主色 / 警示底，改成与「打开向导」同款）");

    const auxCard = cardByLabel(tab.containerEl, "辅助");
    ok(!!auxCard && /操作日志/.test(auxCard.textContent || ""),
      "D6：报告入口降级为「辅助」栏里的「操作日志」行（不再单占一行）");
    ok(!!auxCard && [...auxCard.querySelectorAll(".setting-item")]
      .some(el => (el._setting ? el._setting._name : "") === "操作日志"),
      "D7：操作日志行有名字（效果图 辅助栏第二行）");
    ok(findSettingEl(tab.containerEl, "打开最近一次操作日志") === null,
      "D8：原「打开报告」独立行移除（重复入口收敛）");
    ok((tab._pops["rebuild:help"].textContent || "").indexOf("坚果云已同步完成") >= 0,
      "D9（R20 需求2）：确认门槛提示仍在 —— 页内小字挪进顶部「帮助」小窗（安全文案没丢）");
    await plugin.onunload();
  }

  /* ================= E. 命令面板裁剪 ================= */
  {
    const app = STUB.makeApp();
    plugin = await boot(app, { rebuild: true, automation: true, base: true });
    const ids = plugin._commands.map(c => c.id).sort();
    eq(ids.join(","),
      "open-settings,rebuild-open-report,rebuild-preview,rebuild-rollback",
      "E1：命令面板只剩 4 条（设置总入口 + 预览/回滚/打开日志）");
    ok(ids.indexOf("rebuild-execute") === -1, "E2：「执行」不再从命令面板触发（必须走设置页确认弹窗）");
    ok(ids.indexOf("rebuild-status") === -1, "E3：「查看状态」并入设置页横幅");
    ok(ids.indexOf("autofill-scan") === -1, "E4：「一键补全」收进设置页按钮");
    await plugin.onunload();
  }

  /* ================= F. 向导在模块关着时也能点 ================= */
  {
    const app = STUB.makeApp();
    plugin = await boot(app, { rebuild: false, automation: false, base: false });
    tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();
    const wizEl = findSettingEl(tab.containerEl, "首次使用向导");
    ok(!!wizEl, "F1：向导入口存在");
    /* R18：向导按效果图收进「辅助」栏（段落内）—— 模块关着仍可点，靠 CSS 保住指针事件，
     * 而不是靠「摆在段落外」这个结构手段。 */
    ok(!!tab._sectionBoxes.rebuild.contains(wizEl),
      "F2：向导按效果图收进「辅助」栏（与核心操作同处一屏）");
    const kbtCss = fs.readFileSync(path.join(PLUG, "styles_src", "kbt.css"), "utf8");
    ok(/\.kb-module-disabled \.kbt-sec\.is-aux\s*{[^}]*pointer-events:\s*auto/.test(kbtCss)
      && kbtCss.indexOf(".kbt-help-row") < 0,
      "F2b：置灰段落里「辅助」栏仍可点；R20 起页内「帮助」栏整栏撤掉（入口在标签行，永远可点）");
    ok((tab.containerEl.textContent || "").split("模块已关闭").length === 4,
      "F3：三组各一句「已关闭」（R11 不收起机制原样）");
    await plugin.onunload();
  }

  /* ================= G. 看板视图设置面板（vendor 源级） ================= */
  {
    const cb = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    ok(cb.indexOf("cb-panel-adv") >= 0 && /advRow\.createEl\("summary", \{ text: "高级" \}\)/.test(cb)
      && cb.indexOf("addGroup") >= 0,
      "G1（R20 需求4-②）：面板改三段式（看板行为/板块/高级），高级组 summary 只留「高级」两字");
    ok(/const advBody = advRow\.createDiv\(\{ cls: "cb-opt-row" \}\);/.test(cb)
      && /addToggle\(advBody, K_YAML/.test(cb) && /addToggle\(advBody, K_MOVE/.test(cb),
      "G2：三个进阶开关挂进高级组（键与默认值不变）");
  }

  console.log("\nR13 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
})();
