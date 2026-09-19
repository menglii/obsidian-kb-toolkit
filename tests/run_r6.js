/* kb-toolkit R6 断言：真机试玩反馈的三条修线。
 *   ② 侧边栏图标（装上就有入口，点击打开设置控制台）
 *   ④ 模块开关守卫（关掉 ① 之后：命令不注册 / 已注册的摘掉 / 残留入口一律拒绝执行 / 设置页按钮消失）
 *   ⑤ 操作日志笔记实体（预览/执行/回滚各落一篇可读 Markdown，详细度与字段齐备）
 * 期望值一律动态推算（命令数、表格行数、目录名都从 settings / plan 现算，不写死）。 */
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

const PLUG = path.join(__dirname, "..");
const SRC = path.join(PLUG, "src");
const sha = t => require("crypto").createHash("sha256").update(String(t), "utf8").digest("hex");
/** 剥注释（静态守卫不该被注释里的说明文字满足） */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/* ---- 场景搭建 ---- */
async function freshApp(dirs, files) {
  STUB.VIRTUAL.clear();
  const app = STUB.makeApp();
  for (const d of dirs) await app.vault.createFolder(d);
  for (const f of files) await app.vault.create(f.path, f.content);
  return app;
}
async function boot(app, modules) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit" });
  plugin.data = { modules: modules, wizardDone: true };
  await plugin.onload();
  return plugin;
}
function tree() {
  const out = {};
  for (const [k, v] of STUB.VIRTUAL.entries()) out[k] = v.children === undefined ? sha(v.content) : "<dir>";
  return out;
}
function treeDiff(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join("|") !== kb.join("|")) {
    const onlyA = ka.filter(k => !(k in b)), onlyB = kb.filter(k => !(k in a));
    return "多出=[" + onlyB.join(",") + "] 少了=[" + onlyA.join(",") + "]";
  }
  for (const k of ka) if (a[k] !== b[k]) return "内容差异 " + k;
  return null;
}
function eqTree(a, b, name) { const d = treeDiff(a, b); ok(d === null, name + (d ? " → " + d : "")); }
/* 按名字从已渲染的设置页里取 Setting（stub 把 Setting 挂在 el._setting 上） */
function findSetting(containerEl, name) {
  for (const el of containerEl.querySelectorAll("div")) if (el._setting && el._setting._name === name) return el._setting;
  return null;
}
function btnTexts(containerEl) {
  /* 🔴 R11 修：旧写法「每个节点都 querySelectorAll + 递归子级」会把同一颗按钮
   * 按祖先深度重复计数（以前断言全是 0 没暴露；R11 按钮改为常驻占位才现形）。 */
  const out = [];
  for (const b of containerEl.querySelectorAll("button")) out.push(b.textContent);
  return out;
}
function renderTab(plugin) {
  const tab = new KB.modules.SettingTab(plugin.app, plugin);
  tab.containerEl = dom.window.document.createElement("div");
  tab.display();
  return tab;
}
const tick = () => new Promise(r => setTimeout(r, 20));

(async function main() {
  const KBplugin = require("../main.js");
  const KB = globalThis.KB;
  const D = KB.services.settings.DEFAULTS;
  const META = D.paths.metaDir;
  const LOGBASE = "/" + META + "/05_操作日志/";
  const src = {};
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith(".js")).sort())
    src[f] = fs.readFileSync(path.join(SRC, f), "utf8");

  /* ================= A. 指令 ②：侧边栏图标 ================= */
  let app = await freshApp([".obsidian", "01_新知识库", "01_新知识库/" + META + "/05_操作日志"],
    [{ path: "01_新知识库/笔记.md", content: "x" }, { path: "a.md", content: "A" }]);
  let plugin = await boot(app, { rebuild: true, base: false });
  const ribs = plugin._ribbons || [];
  eq(ribs.length, 1, "A：装上插件就有 1 个侧边栏图标");
  eq(ribs[0].icon, KB.modules.RIBBON_ICON, "A：图标名与入口常量一致（" + ribs[0].icon + "）");
  ok(ribs[0].title.indexOf("知识库工具集") >= 0, "A：图标 title 说明用途");
  eq(typeof ribs[0].click, "function", "A：图标带点击回调");
  const beforeClick = { opened: app.setting._opened, tab: app.setting._lastTab };
  ribs[0].click();
  eq(app.setting._opened, beforeClick.opened + 1, "A：点击 → 打开设置面板");
  eq(app.setting._lastTab, "kb-toolkit", "A：定位到本插件的设置页（用 manifest.id，不写死）");
  eq(plugin._ribbons.length, 1, "A：只加一个图标（不重复堆叠）");

  /* 没有设置页 API 的环境 → 退回 Notice，不抛异常 */
  const noTabApp = await freshApp([".obsidian"], []);
  delete noTabApp.setting;
  const pNoTab = await boot(noTabApp, { rebuild: false });
  const n0 = STUB.Notice.all.length;
  pNoTab._ribbons[0].click();
  ok(STUB.Notice.all.slice(n0).some(m => m.indexOf("设置") >= 0), "A：拿不到设置页 API → 给一句提示（不静默失败）");
  await pNoTab.onunload();

  /* ================= B. 指令 ④：运行时关模块 → 立即停手 ================= */
  const cmdIds = k => k._commands.map(c => c.id).sort();
  const REBUILD_CMDS = cmdIds(plugin).filter(id => id.indexOf("rebuild-") === 0);
  eq(REBUILD_CMDS.length, 3, "B：① 开启时注册 3 条命令（R13：执行/查看状态收进设置页，命令面板只留高频）");
  ok(cmdIds(plugin).indexOf("open-settings") >= 0, "B：插件级「打开设置」总入口在场（R13）");
  ok(REBUILD_CMDS.every(id => id.indexOf("rebuild-") === 0), "B：命令都在 rebuild- 命名空间下");
  ok(!!plugin.registry.active.rebuild, "B：① 开启时模块实例在跑");
  const liveMod = plugin.registry.active.rebuild;

  const beforeOff = tree();
  plugin.settings.modules.rebuild = false;                 /* 等价于用户在设置页拨掉开关 */
  const changed = await plugin.registry.refresh();
  eq(changed.join(","), "-rebuild", "B：refresh 只停掉 rebuild 一个模块（动态回报变更）");
  ok(!plugin.registry.active.rebuild, "B：模块实例真的被停掉（这正是老板报的 bug 根因）");
  const removedIds = (app.commands._removed || []).slice();
  eq(removedIds.length, REBUILD_CMDS.length, "B：5 条命令全部从命令表摘掉");
  eq(removedIds.map(s => s.replace(/^kb-toolkit:/, "")).sort().join(","), REBUILD_CMDS.join(","),
    "B：摘掉的 id 与注册的对得上");
  eq((await plugin.registry.refresh()).length, 0, "B：再 refresh 无事可做（幂等）");

  /* 残留入口（旧实例被别处攥着）也必须拒绝执行 */
  const n1 = STUB.Notice.all.length;
  const rp = await liveMod.runPreview();
  eq(rp.reason, "module-off", "B：关掉后 runPreview 拒绝执行");
  eq((await liveMod.runExecute({ confirmed: true, cloudSynced: true })).reason, "module-off", "B：关掉后 runExecute 拒绝执行");
  eq((await liveMod.runRollback({ confirmed: true, cloudSynced: true })).reason, "module-off", "B：关掉后 runRollback 拒绝执行");
  eq((await liveMod.startConfirm("execute")).reason, "module-off", "B：关掉后连确认弹窗都不弹");
  eq((await liveMod.runStatus(true)).reason, "module-off", "B：关掉后 runStatus 也拒绝");
  eq(await liveMod.openLog(), false, "B：关掉后打开报告被拒");
  ok(!liveMod.lastModal, "B：没有弹出过任何确认框");
  eqTree(beforeOff, tree(), "B：整轮拒绝里库一个字节都没动");
  ok(STUB.Notice.all.slice(n1).every(m => m.indexOf("已关闭") >= 0), "B：每次拒绝都说明「已关闭」而不是静默");

  /* 拨回去 → 立刻复活 */
  plugin.settings.modules.rebuild = true;
  eq((await plugin.registry.refresh()).join(","), "+rebuild", "B：拨回来 → 模块重新启用");
  eq(cmdIds(plugin).filter(id => id.indexOf("rebuild-") === 0).length, 3, "B：命令重新注册（R13 起 3 条）");

  /* 设置页按钮随开关消失/出现（同一实例重画） */
  const tabB = renderTab(plugin);
  ok(btnTexts(tabB.containerEl).indexOf("执行") >= 0, "B：① 开着 → 设置页有「执行」");
  const tg = findSetting(tabB.containerEl, "新建知识库");   /* R16：标题去掉 ① 序号 */
  ok(!!tg && !!tg._toggle, "B：找得到 ① 的开关");
  eq(tg._toggle.value, true, "B：开关反映当前配置（开）");
  tg._toggle.onChange(false);
  await tick();
  eq(plugin.settings.modules.rebuild, false, "B：拨开关写进 settings");
  ok(!plugin.registry.active.rebuild, "B：拨开关当场停模块（不用重载插件）");
  const txtOff = tabB.containerEl.textContent || "";
  const btnsOff = btnTexts(tabB.containerEl);
  /* R11（boss：不做自动收起）：关掉的段落照常渲染（占位），整段置灰禁用 —— 布局零变化不跳位。
   * 「不可执行」由两层保证：CSS pointer-events:none + 命令硬门控（C 段验证）。 */
  eq(btnsOff.filter(t => ["执行", "回滚", "生成预览报告", "打开最近一篇"].indexOf(t) >= 0).length, 4,
    "B（R11/R13）：① 关掉 → 4 个按钮照常占位渲染（不收起；状态并入横幅，报告降为内联钮）");
  ok(!!tabB._sectionBoxes && tabB._sectionBoxes.rebuild.classList.contains("kb-module-disabled"),
    "B（R11）：关掉的段落整段置灰禁用（点不动）");
  ok(txtOff.indexOf("模块已关闭") >= 0, "B：给出一句「已关闭」说明，不是无声消失");
  eq(tabB.containerEl.textContent.indexOf("知识库根目录") >= 0, true, "B：别的组照常渲染（只藏 ① 的操作区）");
  findSetting(tabB.containerEl, "新建知识库")._toggle.onChange(true);
  await tick();
  eq(plugin.settings.modules.rebuild, true, "B：拨回来写进 settings");
  ok(!!plugin.registry.active.rebuild, "B：拨回来模块当场复活");
  ok(btnTexts(tabB.containerEl).indexOf("执行") >= 0, "B：按钮随开关回来");
  await plugin.onunload();

  /* ================= C. 从没开过：命令根本不注册 ================= */
  app = await freshApp([".obsidian", "01_新知识库"], [{ path: "a.md", content: "A" }]);
  plugin = await boot(app, { rebuild: false, base: false, automation: false });
  eq(cmdIds(plugin).filter(id => id.indexOf("rebuild-") === 0).length, 0, "C：① 没开 → 一条 rebuild 命令都不注册（命令面板里查不到）");
  ok(!plugin.registry.active.rebuild, "C：① 没开 → 没有模块实例");
  const tabC = renderTab(plugin);
  eq(btnTexts(tabC.containerEl).filter(t => t === "执行").length, 1, "C（R11）：① 没开 → 「执行」按钮占位渲染但整段置灰禁用");
  ok(!!tabC._sectionBoxes && tabC._sectionBoxes.rebuild.classList.contains("kb-module-disabled"),
    "C（R11）：没开过的段落同样置灰禁用");
  ok((tabC.containerEl.textContent || "").indexOf("模块已关闭") >= 0, "C：① 没开 → 设置页明说已关闭");
  await plugin.onunload();

  /* ================= D. 关掉 ② / ③ 也各有交代 ================= */
  app = await freshApp([".obsidian"], []);
  plugin = await boot(app, { rebuild: false, automation: false, base: false });
  const tabD = renderTab(plugin);
  const dTxt = tabD.containerEl.textContent || "";
  eq((dTxt.match(/模块已关闭/g) || []).length, 3, "D：①②③ 全关 → 三组各一句「已关闭」");
  await plugin.onunload();

  /* ================= E. 指令 ⑤：报告 Markdown 的详细度与确定性 ================= */
  app = await freshApp([".obsidian", "01_新知识库", "01_新知识库/" + META + "/05_操作日志", "02_旧知识库"],
    [{ path: "a.md", content: "内容A" }, { path: "b.md", content: "内容B" },
     { path: "01_新知识库/已存在.md", content: "会被冲突跳过吗" }]);
  plugin = await boot(app, { rebuild: true, base: false });
  const svc = new KB.services.rebuild(app);
  const cfg = plugin.settings.rebuild;
  const plan = await svc.plan(cfg);
  const st = await svc.detectState(cfg);
  const NOW = new Date(2026, 8, 17, 9, 30);            /* 固定时刻 → 报告必须逐字节可复现 */
  const opt = { now: NOW, paths: plugin.settings.paths, pluginDir: ".obsidian/plugins/kb-toolkit" };

  const rep = svc.reportMarkdown("preview", { plan: plan, state: st }, opt);
  eq(rep.title, "新建知识库 · 预览报告", "E：预览报告标题");
  eq(rep.fileName, "2026-09-17 0930 新建知识库·预览.md", "E：文件名 = 时间戳 + 种类（无冒号，可直接当文件名）");
  const md = rep.markdown;
  ok(/^---\n/.test(md) && md.indexOf("类型: 操作日志") >= 0, "E：报告带 YAML 前言（类型=操作日志）");
  ok(md.indexOf("tags:") >= 0 && md.indexOf("- 操作日志") >= 0, "E：带 tags，能被 Base 检索到");
  ok(md.indexOf("# 新建知识库 · 预览报告") >= 0, "E：一级标题");
  ok(md.indexOf("| 操作 |") >= 0 && md.indexOf("| 时间 | 2026-09-17 09:30 |") >= 0, "E：概览表带操作与时间");
  ok(md.indexOf("| 当前状态 |") >= 0, "E：概览表带当前状态");
  ok(md.indexOf(plan.root) >= 0 && md.indexOf(plan.oldFolder) >= 0, "E：点名新建根与旧文件区");
  ok(md.indexOf("rebuild-preview.json") >= 0 && md.indexOf("rebuild-manifest.json") >= 0, "E：指出机器可读报告位置");
  /* 搬运表：列齐（源/目标/类型/字节/sha256）+ 行数 = moves 数 */
  ok(md.indexOf("| # | 源 | → 目标 | 类型 | 字节 | sha256 |") >= 0, "E：搬运表列齐（源/目标/类型/字节/sha256）");
  const mvSection = md.slice(md.indexOf("## 1. 计划搬运"), md.indexOf("## 2. 将新建目录"));
  const moveRows = mvSection.split(/\r?\n/).filter(l => /^\| \d+ \|/.test(l));
  eq(moveRows.length, plan.moves.length, "E：搬运行数 = 计划搬运项数（动态复算）");
  const mvFile = plan.moves.filter(m => m.type !== "folder")[0];
  const mvFold = plan.moves.filter(m => m.type === "folder")[0];
  ok(!!mvFile, "E：确实有文件搬运项（断言没空跑）");
  ok(md.indexOf("`" + mvFile.from + "`") >= 0 && md.indexOf("`" + mvFile.to + "`") >= 0, "E：文件项源与目标都在表里");
  ok(md.indexOf(mvFile.sha256.slice(0, 8)) >= 0, "E：文件项带 sha256 短哈希（可核对）");
  if (mvFold) {
    const foldRow = mvSection.split(/\r?\n/).find(l => l.indexOf("`" + mvFold.from + "`") >= 0);
    ok(!!foldRow && foldRow.indexOf("| 文件夹 |") >= 0 && foldRow.indexOf("—") >= 0,
      "E：文件夹项标类型、字节列留 —（不编造大小）");
  }
  ok(/B \||KB \|/.test(md), "E：字节列有人可读的单位");
  /* 目录 / 种子 / 冲突 / 排除 / 下一步 五节齐备 */
  ok(md.indexOf("## 1. 计划搬运") >= 0 && md.indexOf("## 2. 将新建目录") >= 0, "E：1·2 节齐");
  ok(md.indexOf("## 3. 将写入种子文件") >= 0 && md.indexOf("## 4. 冲突") >= 0, "E：3·4 节齐");
  ok(md.indexOf("## 5. 排除") >= 0 && md.indexOf("## 6. 下一步") >= 0, "E：5·6 节齐");
  ok(md.indexOf("```") >= 0, "E：目录清单用代码块（可整段复制）");
  ok(md.indexOf("关联笔记") >= 0 && md.indexOf("[[MOC_知识地图]]") >= 0, "E：尾部双链回中心（不被清成孤岛）");
  const rep2 = svc.reportMarkdown("preview", { plan: plan, state: st }, opt);
  eq(rep2.markdown, md, "E：同输入同时间 → 报告逐字节可复现");

  /* 目录名从 settings 现算：改 metaDir 后落点跟着走 */
  const paths2 = JSON.parse(JSON.stringify(plugin.settings.paths));
  paths2.metaDir = "97_系统";
  eq(KB.services.report.logFolder(paths2, "某库"), "某库/97_系统/05_操作日志", "E：日志目录 = <库根>/<元目录>/05_操作日志（跟随配置）");
  eq(KB.services.report.logFolder(plugin.settings.paths), plugin.settings.paths.knowledgeBase + LOGBASE.slice(0, -1),
    "E：不给库根 → 退回默认库根");

  /* 执行报告（成功 / 中断）与回滚报告的关键差异 */
  const exDone = svc.reportMarkdown("execute", { manifest: plan.manifest,
    result: { status: "done", skipped: [], blocked: [] } }, opt);
  ok(exDone.markdown.indexOf("# 新建知识库 · 执行报告") >= 0, "E：执行报告标题");
  ok(exDone.markdown.indexOf("| 结果 | **完成** |") >= 0, "E：执行报告标「完成」");
  ok(exDone.markdown.indexOf("| 新建目录 | " + (plan.manifest.creates || []).length + " 个 |") >= 0, "E：执行报告列出新建目录数（动态）");
  const exFail = svc.reportMarkdown("execute", { manifest: plan.manifest,
    result: { status: "failed", failedAt: "move:a.md", error: "沙盒注入失败", skipped: [], blocked: [] } }, opt);
  ok(exFail.markdown.indexOf("**中断**（失败即停）") >= 0, "E：中断报告标「中断」");
  ok(exFail.markdown.indexOf("move:a.md") >= 0 && exFail.markdown.indexOf("沙盒注入失败") >= 0, "E：中断报告写明停在哪、为什么");
  const rbRep = svc.reportMarkdown("rollback", { journal: { root: plan.root, oldFolder: plan.oldFolder, entries: [] },
    result: { ok: true, total: 3, restored: ["a.md", "b.md"], skipped: [], blocked: [], errors: [] },
    verify: { ok: true, bad: [] } }, opt);
  ok(rbRep.markdown.indexOf("# 新建知识库 · 回滚报告") >= 0, "E：回滚报告标题");
  ok(rbRep.markdown.indexOf("| 已还原 | 2 项 |") >= 0, "E：回滚报告列出还原项数（动态）");
  ok(rbRep.markdown.indexOf("## 4. 自检结论") >= 0 && rbRep.markdown.indexOf("sha256 一致") >= 0, "E：回滚报告有自检结论（R8 起前面插了「回滚时保留」一节 → 编号后移）");
  const rbBad = svc.reportMarkdown("rollback", { journal: { entries: [] },
    result: { ok: false, total: 1, restored: [], skipped: [], blocked: [{ path: "a.md", reason: "原位置已有内容" }], errors: [] },
    verify: { ok: false, bad: ["a.md 未回原位"] } }, opt);
  ok(rbBad.markdown.indexOf("**未通过**") >= 0 && rbBad.markdown.indexOf("a.md 未回原位") >= 0, "E：自检不过时如实写明细");

  /* ================= F. 走真链路：报告变成库里的笔记实体 ================= */
  const before = tree();
  const p3 = await plugin.registry.active.rebuild.runPreview();
  const logs1 = Object.keys(tree()).filter(k => k.indexOf(LOGBASE) >= 0);
  eq(logs1.length, 1, "F：预览后库里多 1 篇报告笔记");
  ok(logs1[0].indexOf("01_新知识库" + LOGBASE) === 0, "F：预览报告落在原库根的操作日志目录");
  ok(STUB.VIRTUAL.get(logs1[0]).content.indexOf("# 新建知识库 · 预览报告") >= 0, "F：笔记实体内容 = 报告正文");
  ok(logs1[0].indexOf("新建知识库·预览.md") > 0, "F：文件名带「新建知识库·预览」");
  const extra = Object.keys(tree()).filter(k => !(k in before));
  eq(extra.length, 1, "F：预览除这一篇报告外没多出任何东西（笔记零改动）");
  ok(p3.counts.moves > 0, "F：确实有东西要搬（断言没空跑）");

  await plugin.registry.active.rebuild.runExecute({ confirmed: true, cloudSynced: true, now: NOW });
  const xLogsF = Object.keys(tree()).filter(k => k.indexOf(plan.root + LOGBASE) === 0);
  eq(xLogsF.length, 1, "F：执行报告写进新建根的操作日志目录");
  const jrn = JSON.parse(app.vault.adapter._files.get(".obsidian/plugins/kb-toolkit/rebuild-journal.json"));
  eq(jrn.entries.filter(e => e.op === "log").length, 1, "F：执行报告登记为可逆（回滚要先删它才能删干净新建根）");
  ok(jrn.entries[jrn.entries.length - 1].op === "log", "F：登记排在末位（逆序回滚时最先处理）");

  const rb = await plugin.registry.active.rebuild.runRollback({ confirmed: true, cloudSynced: true });
  eq(rb.ok, true, "F：回滚成功");
  /* R7：库根名 = 新建根名 → 回滚把归档的旧库搬回来了，所以「根在」是正确的（不再是「必须为空」） */
  ok(!!app.vault.getAbstractFileByPath(plan.root + "/已存在.md"), "F：归档的旧库整体回到库根原位（新建的空壳已清干净）");
  ok(app.vault.getAbstractFileByPath("旧文件/" + plan.root) === null, "F：旧文件区里的同名归档已搬回，无残留");
  const finLogs = Object.keys(tree()).filter(k => k.indexOf(LOGBASE) >= 0);
  eq(finLogs.length, 2, "F：回滚后留 2 篇报告（预览 + 回滚；执行报告已随新建根删掉）");
  ok(finLogs.every(k => k.indexOf(plan.root + LOGBASE) === 0), "F：留下的报告都在库根的操作日志目录");
  eqTree(Object.keys(before).reduce((o, k) => { if (k.indexOf(LOGBASE) < 0) o[k] = before[k]; return o; }, {}),
    Object.keys(tree()).reduce((o, k) => { if (k.indexOf(LOGBASE) < 0) o[k] = tree()[k]; return o; }, {}),
    "F：除操作日志外，笔记侧与执行前逐字节一致");
  ok(STUB.Notice.all.some(m => m.indexOf("报告") >= 0 || m.indexOf("日志") >= 0), "F：Notice 里给出报告路径（不只是转圈）");
  await plugin.onunload();

  /* ================= G. 静态守卫（防以后又把这个口子放开） ================= */
  const r82 = strip(src["82_modules_rebuild.js"]);
  for (const fn of ["runPreview", "runExecute", "runRollback", "runStatus", "startConfirm", "openLog"]) {
    const m = r82.match(new RegExp("prototype\\." + fn + " = async function[^]*?\\n  \\};"));
    ok(!!m && m[0].indexOf("requireOn") >= 0, "G：" + fn + " 首段调用 requireOn（关掉后拒绝执行）");
  }
  ok(/onEnable = async function[\s\S]{0,400}modules\.rebuild !== true/.test(r82),
    "G：onEnable 里有关掉即不注册命令的守卫");
  ok(/onDisable[\s\S]{0,300}removeCommands/.test(r82), "G：onDisable 里会摘命令");
  const r75 = strip(src["75_core_settingTab.js"]);
  ok(/S\.modules\.rebuild !== true/.test(r75), "G：设置页 ① 操作区受模块开关包裹");
  ok(/registry\.refresh/.test(r75), "G：拨开关会调 registry.refresh（即时生效，不需重载）");
  ok(!/01_新知识库|02_旧知识库|99_Meta\s*\//.test(r75 + r82), "G：R6 新代码没有引入顶层路径字面量");
  const r90 = strip(src["90_entry.js"]);
  ok(/addRibbonIcon/.test(r90), "G：入口注册了侧边栏图标");
  ok(/openSettings/.test(r90), "G：图标点击有落点（打开设置页）");
  const r10 = strip(src["10_core_registry.js"]);
  ok(/prototype\.refresh = async function/.test(r10) && /prototype\.enable = async function/.test(r10)
    && /prototype\.disable = async function/.test(r10), "G：注册表提供 enable/disable/refresh");
  ok(/isEnabled/.test(r75) || /registry\.refresh/.test(r75), "G：设置页与注册表开关口径一致");

  /* ================= H. 文档与版本（本轮不改版本号：收尾轮才 bump） ================= */
  const man = JSON.parse(fs.readFileSync(path.join(PLUG, "manifest.json"), "utf8"));
  eq(man.version, "1.0.0", "H：非收尾轮不动版本号（避免与 R5 断言打架）");
  const chg = fs.readFileSync(path.join(PLUG, "CHANGELOG.md"), "utf8");
  ok(chg.indexOf("## 1.0.0") >= 0, "H：CHANGELOG 仍有 1.0.0 段");
  ok(/R6/.test(chg), "H：CHANGELOG 记下 R6 的改动");

  console.log("R6 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exitCode = 2; });
