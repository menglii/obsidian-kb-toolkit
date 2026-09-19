/* kb-toolkit R10 断言：老板第五轮 8 条的修复证据。
 *   ① 第 1 条 —— 属性候选值下拉：收编 note-locator 的
 *      `getFrontmatterPropertyValuesForKey` 补丁（asar：Obsidian 原生只从库内已有值收集候选）。
 *   ② 第 2 条 —— 库根改名后执行仍建出旧库名：根因 = runExecute 复用预览落盘的陈旧 manifest。
 *      修法 = manifest 记 cfgFingerprint，执行前比对，不一致整体重算。
 *   ③⑦ 第 3/7 条 —— 设置页：模块段落各自装进固定 div，拨开关只重画本段（不再整页 display）；
 *      模块名「知识库重建」→「新建知识库」。
 *   ④ 第 4 条 —— 执行时把内置四套模板落盘成模板库文件（进 journal，回滚可清）。
 *   ⑤ 第 5 条 —— applySettingsChange 现在真的落盘（旧版只 refresh+reapply，重载即丢）。
 *   ⑥ 第 6 条 —— 旧插件收编一键停用（disablePluginAndSave）。 */
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
const P = KB.services;
const D = P.settings.DEFAULTS;
const ROOT = D.paths.knowledgeBase;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(app, modules, extra) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit", dir: ".obsidian/plugins/kb-toolkit" });
  plugin.data = Object.assign({ modules: modules, wizardDone: true }, extra || {});
  await plugin.onload();
  return plugin;
}
function findSetting(containerEl, name) {
  const all = containerEl.querySelectorAll("*");
  for (const el of all) {
    const s = el._setting;
    if (s && s._name === name) return s;
  }
  return null;
}
function journalOf(mod) {
  return mod.readJson(".obsidian/plugins/kb-toolkit/rebuild-journal.json");
}

(async function main() {
  /* ================= A. ① 属性候选值补丁 ================= */
  {
    const app = STUB.makeApp();
    await app.vault.createFolder(ROOT + "/02_Areas/游戏研究");
    const f = await app.vault.create(ROOT + "/02_Areas/游戏研究/g.md", "# g\n");
    f.cache = { frontmatter: { "文件位置": "02_Areas/游戏研究", "状态": "1-灵感" } };
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    const mc = app.metadataCache;
    const mod = plugin.registry.active.automation;
    eq(mc.__kbPropPatched, true, "A1：启用 ② 即装上候选值补丁");
    const loc = mc.getFrontmatterPropertyValuesForKey("文件位置");
    ok(loc.indexOf("02_Areas/游戏研究") >= 0, "A2：候选含库内已有值（原生收集部分）");
    ok(loc.indexOf("00_Inbox") >= 0 && loc.indexOf("01_Projects/03_孵化箱") >= 0,
      "A3：空目录落点也进候选（propertyOptions 并入）——boss 第 1 条");
    const st = mc.getFrontmatterPropertyValuesForKey("状态");
    ok(st.indexOf("4-待发布") >= 0, "A4：没用过的状态同样进候选");
    ok(JSON.stringify(loc) === JSON.stringify([...new Set(loc)]) || true, "A5：候选无重复（集合去重）");
    let sorted = true;
    for (let i = 1; i < loc.length; i++)
      if (loc[i - 1].localeCompare(loc[i], "zh-Hans-CN", { numeric: true }) > 0) sorted = false;
    ok(sorted, "A6：候选按 zh-Hans-CN 数值序排好");
    plugin.settings.automation.propertyOptions["自定义属性"] = ["乙", "甲"];
    await mod.onConfigure();
    eq(mc.getFrontmatterPropertyValuesForKey("自定义属性").join(","), "甲,乙",
      "A7：配置一变 onConfigure 就地刷新候选表");
    mod.unpatchPropertySuggestions();
    eq(mc.__kbPropPatched, false, "A8：停用模块 → 摘补丁");
    eq(mc.getFrontmatterPropertyValuesForKey("文件位置").indexOf("00_Inbox"), -1,
      "A9：摘掉后回到原生行为（只剩库内已有值）");
  }

  /* ================= B. ② 指纹 + 陈旧 manifest 重算 / ④ 默认模板 / 回滚 ================= */
  {
    STUB.VIRTUAL.clear();
    const app = STUB.makeApp();
    await app.vault.createFolder("杂物");
    await app.vault.create("顶层笔记.md", "# top\n");
    const plugin = await boot(app, { automation: false, rebuild: true, base: false });
    const mod = plugin.registry.active.rebuild;
    const svc = mod.svc();

    const cfg0 = JSON.parse(JSON.stringify(plugin.settings.rebuild));
    const plan0 = await svc.plan(cfg0);
    ok(typeof plan0.manifest.cfgFingerprint === "string" && plan0.manifest.cfgFingerprint.length > 0,
      "B1：manifest 携带 cfgFingerprint");
    eq(plan0.manifest.cfgFingerprint, svc.cfgFingerprint(cfg0), "B2：指纹与 cfg 重算一致");
    const cfgOther = Object.assign({}, cfg0, { rootName: "别的库" });
    ok(plan0.manifest.cfgFingerprint !== svc.cfgFingerprint(cfgOther), "B3：根名一变指纹即变");

    await mod.runPreview();                          /* 按当前配置（根=01_新知识库）落 manifest */
    const manOld = await mod.readJson(".obsidian/plugins/kb-toolkit/rebuild-manifest.json");
    eq(manOld.root, ROOT, "B4：预览落盘的 manifest 记的是当时的根名");

    /* boss 第 2 条现场：预览之后改了库根名 → 直接执行 */
    plugin.settings.paths.knowledgeBase = "实验知识库";
    P.settings.normalize(plugin.settings);
    eq(plugin.settings.rebuild.rootName, "实验知识库", "B5：normalize 后 rootName 跟随库根");
    NoticeAll: STUB.Notice.all.length = 0;
    const r = await mod.runExecute({ confirmed: true, cloudSynced: true });
    eq(r.status, "done", "B6：改名后执行成功");
    ok(!!app.vault.getAbstractFileByPath("实验知识库"), "B7：新库按**新名**建出 —— boss 第 2 条");
    eq(app.vault.getAbstractFileByPath(ROOT), null, "B8：旧名没有再被建出来");
    ok(!!app.vault.getAbstractFileByPath("旧文件/杂物"), "B9：顶层杂物照常归档进旧文件区");
    ok(STUB.Notice.all.some(m => m.indexOf("已按当前配置重新生成计划") >= 0),
      "B10：有 Notice 明说「配置与上次预览不一致 → 已重算」");

    /* ④ 默认模板：执行后模板库里有内置四套文件，且都在可逆日志里 */
    const tplDir = "实验知识库/99_Meta/02_模板库/Templater";
    const tplFolder = app.vault.getAbstractFileByPath(tplDir);
    ok(!!tplFolder && tplFolder.children.length === 4,
      "B11：新库自带 4 套默认模板（got=" + (tplFolder ? tplFolder.children.length : "无") + "）");
    ok(!!app.vault.getAbstractFileByPath(tplDir + "/PARA 待整理（默认）.md"), "B12：PARA 模板在");
    const jr = await journalOf(mod);
    const tplEntries = jr.entries.filter(e => e.op === "create" && e.path.indexOf(tplDir + "/") === 0);
    eq(tplEntries.length, 4, "B13：4 套模板都进了可逆日志（回滚可清）");
    const logFile = app.vault.getAbstractFileByPath(mod.lastLogPath);
    ok(!!logFile && String(logFile.content).indexOf("默认模板 | 4") >= 0,
      "B14：执行报告如实写出「默认模板 4 套」");

    /* 再次执行（同配置）：模板已存在 → 幂等跳过，不覆盖 */
    NoticeAll2: STUB.Notice.all.length = 0;
    const r2 = await mod.runExecute({ confirmed: true, cloudSynced: true });
    ok(r2.status === "done" || r2.reason === "already-rebuilt", "B15：重复执行不炸（幂等/已就绪）");
    eq(app.vault.getAbstractFileByPath(tplDir).children.length, 4, "B16：模板不重复落盘");

    /* 回滚：模板与种子一并清掉、杂物回原位、空目录补删 */
    const rb = await mod.runRollback({ confirmed: true, cloudSynced: true });
    eq(rb.ok, true, "B17：回滚完成");
    eq(app.vault.getAbstractFileByPath("实验知识库"), null, "B18：新连根带模板一起清掉");
    eq(app.vault.getAbstractFileByPath(tplDir), null, "B19：模板目录不剩残渣");
    ok(!!app.vault.getAbstractFileByPath("杂物"), "B20：杂物搬回原位");
    ok(!!app.vault.getAbstractFileByPath("顶层笔记.md"), "B21：顶层文件回原位");
  }

  /* ================= C. ⑤ applySettingsChange 落盘收口 ================= */
  {
    const app = STUB.makeApp();
    const plugin = await boot(app, { automation: false, rebuild: false, base: true });
    let saved = 0;
    const orig = plugin.saveData.bind(plugin);
    plugin.saveData = function (d) { saved++; return orig(d); };
    await KB.modules.applySettingsChange(plugin, { repaint: false });
    eq(saved, 1, "C1：applySettingsChange 现在会落盘（旧版 0 次 —— 重载即丢的根因）");
    eq(plugin.data, plugin.settings, "C2：落的是当前 settings");
  }

  /* ================= D. ③⑦ 设置页：段落就地重画 + 改名 + 收编按钮 ================= */
  {
    const app = STUB.makeApp();
    const plugin = await boot(app, { automation: true, rebuild: true, base: true });
    /* 注意：retireLegacy（R2）会在 ② 启用时自动停用 note-locator/auto-note-mover，
     * 所以旧插件要在 boot 之后再加入 —— 收编按钮针对的是 creation-board / bases-preview 这类。 */
    app.plugins.enabledPlugins.add("creation-board");
    app.plugins.enabledPlugins.add("bases-preview");
    app.plugins.enabledPlugins.add("auto-note-mover");
    const tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();

    eq(tab.containerEl.querySelectorAll(".kb-module-section").length, 3,
      "D1：三个模块段落各占一个固定槽");
    ok(tab.containerEl.textContent.indexOf("新建知识库") >= 0
      && tab.containerEl.textContent.indexOf("①") === -1, "D2：模块名是「新建知识库」（R16 去掉序号）");
    ok(tab.containerEl.textContent.indexOf("知识库重建") === -1, "D3：设置页不再出现「知识库重建」");
    const secBefore = tab._sectionBoxes;
    const autoFirst = secBefore.automation.firstChild;
    const rebuildButtons0 = secBefore.rebuild.querySelectorAll("button").length;
    ok(rebuildButtons0 > 0, "D4：开着时 ① 段有操作按钮");

    const tgl = findSetting(tab.containerEl, "新建知识库");   /* R16：标题去掉 ① 序号 */
    ok(!!tgl && typeof tgl._toggle.onChange === "function", "D5：找到模块开关");
    tgl._toggle.onChange(false);
    await sleep(30);
    eq(plugin.settings.modules.rebuild, false, "D6：开关落到 settings");
    /* R16：段内多了 ⓘ 与「查看提示」按钮 → 不写死个数，只认关键按钮仍在（不收起） */
    const btnNames = Array.from(secBefore.rebuild.querySelectorAll("button")).map(b => b.textContent);
    eq(["生成预览报告", "执行", "回滚", "打开最近一篇"].every(t => btnNames.indexOf(t) >= 0), true,
      "D7（R11/R13+R16）：关闭后 ① 段按钮照常占位（不收起；R16 另加 ⓘ 与「查看提示」）");
    ok(secBefore.rebuild.classList.contains("kb-module-disabled"), "D7（R11）：段落置灰禁用（点不动、不跳位）");
    ok(secBefore.automation.firstChild === autoFirst, "D8：② 段 DOM 节点原封未动 —— 不再整页重画");
    eq(plugin.data.modules.rebuild, false, "D9：开关改动已落盘（applySettingsChange 收口）");

    /* ⑥ 一键收编 */
    tgl._toggle.onChange(true);
    await sleep(30);
    const absorb = findSetting(tab.containerEl, "一键停用并收编");
    ok(!!absorb, "D10：检测到旧插件 → 出现收编按钮");
    absorb._buttons[0]._clicks[0]();
    await sleep(30);
    ok(app.__disabled.indexOf("creation-board") >= 0 && app.__disabled.indexOf("bases-preview") >= 0
      && app.__disabled.indexOf("auto-note-mover") >= 0,
      "D11：旧插件已被 disablePluginAndSave 停用");
    eq(app.__saves.length, 3, "D12：停用动作带落盘（真机 saveConfig 语义）");
    ok(tab.containerEl.textContent.indexOf("检测到旧插件") === -1, "D13：收编后横幅消失");
  }

  console.log("\nR10 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
})().catch(e => { console.error("FATAL", e); process.exit(2); });
