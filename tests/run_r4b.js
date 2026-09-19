/* kb-toolkit R4b 断言：执行 / 幂等 / 回滚 / 中途失败恢复 / 撞名不覆盖 / 确认门槛 / 命令真链路。
 * 期望值一律动态推算（journal 条数 = 1 + moves + creates + seeds；目录数取自模板）。
 * 最强断言：回滚后整棵虚拟文件树（路径 + 每个文件 sha256）与执行前**完全相等**。 */
const path = require("path");
const Module = require("module");
const { JSDOM } = require("jsdom");
const crypto = require("crypto");

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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = t => crypto.createHash("sha256").update(String(t), "utf8").digest("hex");

/* ---- 虚拟文件树快照（路径 → sha256 / <dir>） ---- */
function tree() {
  const out = {};
  for (const [k, v] of STUB.VIRTUAL.entries()) {
    out[k] = v.children === undefined ? sha(v.content) : "<dir>";
  }
  return out;
}
function treeDiff(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join("|") !== kb.join("|")) {
    const onlyA = ka.filter(k => !(k in b)), onlyB = kb.filter(k => !(k in a));
    return "路径差异 多出=[" + onlyB.join(",") + "] 少了=[" + onlyA.join(",") + "]";
  }
  for (const k of ka) if (a[k] !== b[k]) return "内容差异 " + k;
  return null;
}
function eqTree(a, b, name) { const d = treeDiff(a, b); ok(d === null, name + (d ? " → " + d : "")); }
function countFolders(rootPath) {
  let n = 0;
  for (const [k, v] of STUB.VIRTUAL.entries())
    if (v.children !== undefined && k.indexOf(rootPath + "/") === 0) n++;
  return n;
}
function kidsOf(app, folderPath) {
  if (folderPath === "/") return app.__root.children.map(c => c.name).sort().join(",");
  const f = app.vault.getAbstractFileByPath(folderPath);
  return f && f.children ? f.children.map(c => c.name).sort().join(",") : null;
}

/* ---- R6：预览/执行/回滚都会在库内写一篇「操作日志」笔记 ----
 * 树比对时把它单独剥离，再显式断言「多出来的只有这些日志，且都落在 <库根>/<元目录>/05_操作日志/ 下」。
 * META 在 main() 里用真实 DEFAULTS 覆盖（不写死目录名）。 */
let META = "99_Meta";
const LOGFOLDER = "05_操作日志";
const isLogPath = k => k.indexOf("/" + META + "/" + LOGFOLDER + "/") >= 0;
function coreTree(t) { const o = {}; for (const k in t) if (!isLogPath(k)) o[k] = t[k]; return o; }
function logTree(t) { const o = {}; for (const k in t) if (isLogPath(k)) o[k] = t[k]; return o; }
function eqTreeCore(a, b, name) { eqTree(coreTree(a), coreTree(b), name); }
function logPaths() { return Object.keys(logTree(tree())).sort(); }
/** 把「只多出日志」这件事讲清楚：这些路径必须全是 .md 且在 05_操作日志/ 下 */
function onlyLogsExtra(a, b, name) {
  const d = treeDiff(coreTree(a), coreTree(b));
  ok(d === null, name + (d ? " → 笔记侧有差异：" + d : ""));
}

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
  plugin.data = modules ? { modules: modules } : null;
  await plugin.onload();
  return plugin;
}
const ADIR = ".obsidian/plugins/kb-toolkit/";
const journalOf = app => app.vault.adapter._files.get(ADIR + "rebuild-journal.json");
const manifestOf = app => app.vault.adapter._files.get(ADIR + "rebuild-manifest.json");

(async function main() {
  const KBplugin = require("../main.js");
  META = global.KB.services.settings.DEFAULTS.paths.metaDir;   /* 元目录名动态取，不写死 */
  /* R7：新建根名 = 库根名（唯一真源），期望值同样从配置推，不再写死「知识库」 */
  const KBR = global.KB.services.settings.DEFAULTS.paths.knowledgeBase;

  /* ============ 场景 A：干净库全流程（预览 → 确认门槛 → 执行 → 幂等 → 回滚） ============ */
  let app = await freshApp([".obsidian", "01_新知识库", "01_新知识库/99_Meta/05_操作日志", "02_旧知识库"],
    [{ path: "a.md", content: "内容A" }, { path: "b.md", content: "内容B" },
     { path: "01_新知识库/笔记1.md", content: "内容1" }, { path: "02_旧知识库/旧1.md", content: "旧内容1" }]);
  let plugin = await boot(app, { rebuild: true });
  let mod = plugin.registry.active.rebuild;
  ok(!!mod, "A：rebuild 模块已启用");
  const cmdIds = plugin._commands.map(c => c.id).sort().join(",");
  eq(cmdIds, "open-settings,rebuild-open-report,rebuild-preview,rebuild-rollback",
    "A：注册 4 条命令（R13：命令面板只留高频 —— 设置/预览/回滚/打开日志；「执行」「查看状态」收进设置页）");
  const cfg = plugin.settings.rebuild;
  eq(cfg.requireCloudSynced, true, "A：默认要求勾选坚果云已同步");

  const before = tree();
  const plan = await mod.runPreview();
  onlyLogsExtra(before, tree(), "A：预览不搬不改任何已有笔记");
  const pLogs = logPaths();
  eq(pLogs.length, 1, "A：预览落下一篇操作日志笔记（R6 老板要求）");
  ok(pLogs[0].indexOf("/" + META + "/" + LOGFOLDER + "/") >= 0,
    "A：日志落在 <库根>/<元目录>/05_操作日志/ 下（" + pLogs[0] + "）");
  const pTxt = STUB.VIRTUAL.get(pLogs[0]).content;
  ok(pTxt.indexOf("# 新建知识库 · 预览报告") >= 0, "A：日志是一篇像样的 Markdown（有标题）");
  ok(pTxt.indexOf("计划搬运") >= 0 && pTxt.indexOf("下一步") >= 0, "A：日志含搬运清单与下一步");
  ok(!!manifestOf(app), "A：预览写出 rebuild-manifest.json");
  eq(plan.state.state, "fresh", "A：预览带状态 fresh");
  /* 1 条旧文件区 + 1 条新建根自身 + 每次搬运 + 每个目录 + 每个种子 */
  /* R10-④：执行还会把内置四套模板落进模板库（进 journal，回滚可清）→ 计数要带上它们。
   * 期望值一律从 BUILTIN 动态推算，不写死 4。 */
  const TPLN = KB.services.templates.BUILTIN.length;
  const expectEntries = 2 + plan.counts.moves + plan.counts.creates + plan.counts.seeds + TPLN;
  /* R6：执行报告也登记进 journal（op:"log"），回滚要先删它，否则新建根非空删不掉 */
  const expectJournal = expectEntries + 1;

  /* 确认门槛：不带确认 / 不带同步勾选 都不许动库 */
  const rQ = await mod.runExecute();
  ok(rQ.needConfirm === true && rQ.ok === false, "A：无确认 → 只回预检，不执行");
  ok(!!rQ.preflight && rQ.preflight.ok === true, "A：预检硬门槛通过");
  onlyLogsExtra(before, tree(), "A：未确认不动库");
  const rHalf = await mod.runExecute({ confirmed: true, cloudSynced: false });
  ok(rHalf.needConfirm === true, "A：confirmed 但不勾坚果云 → 仍不执行");
  onlyLogsExtra(before, tree(), "A：半确认不动库");

  /* 真执行 */
  const r1 = await mod.runExecute({ confirmed: true, cloudSynced: true, date: "2026-09-17" });
  eq(r1.status, "done", "A：执行完成");
  eq(r1.ok, true, "A：执行 ok");
  eq(kidsOf(app, "/"), [".obsidian", KBR, "旧文件"].sort().join(","),
    "A：顶层只剩 系统目录 + 新建根 + 旧文件区");
  eq(kidsOf(app, "旧文件"), [KBR, "02_旧知识库", "a.md", "b.md"].join(","),
    "A：顶层 4 项全部搬进旧文件区（同名旧库整个归档在 旧文件/<库根>）");
  eq(app.vault.getAbstractFileByPath("a.md"), null, "A：原位置已无 a.md");
  ok(app.vault.getAbstractFileByPath("旧文件/" + KBR + "/笔记1.md").content === "内容1",
    "A：文件夹搬家后子孙内容完好（迭代复制路径）");
  eq(countFolders(KBR), plan.counts.creates, "A：新建目录数 = 模板目录数");
  const seedCount = Object.keys(coreTree(tree())).filter(k => k.indexOf(KBR + "/") === 0 && coreTree(tree())[k] !== "<dir>").length;
  eq(seedCount, plan.counts.seeds + TPLN, "A：新建文件数 = 模板种子 + 内置模板（执行报告已从计数里剥离）");
  const xLogs = logPaths().filter(p => p.indexOf(KBR + "/") === 0);
  eq(xLogs.length, 1, "A：执行报告写进新建根下的 05_操作日志/");
  ok(STUB.VIRTUAL.get(xLogs[0]).content.indexOf("# 新建知识库 · 执行报告") >= 0, "A：执行报告标题正确");
  ok(app.vault.getAbstractFileByPath(KBR + "/99_Meta/04_索引与地图/MOC_知识地图.md").content.indexOf("[[_收件箱]]") >= 0,
    "A：MOC 种子内容就位");

  /* journal */
  const j1 = JSON.parse(journalOf(app));
  eq(j1.status, "done", "A：journal 落盘 status=done");
  eq(j1.entries.length, expectJournal, "A：journal 条数 = 1 + moves + creates + seeds + 1 条日志登记");
  eq(j1.entries.filter(e => e.op === "move").length, plan.counts.moves, "A：日志记下每一次搬运");
  eq(j1.entries.filter(e => e.op === "create").length, plan.counts.seeds + TPLN, "A：日志记下每一个新建文件（含内置模板）");
  eq(j1.entries.filter(e => e.op === "mkdirOld").length, 1, "A：旧文件区记为可逆（回滚会删掉它）");
  eq(j1.entries.filter(e => e.op === "mkdir").length, plan.counts.creates + 1,
    "A：目录日志 = 模板目录 + 新建根自身");
  eq(j1.entries.filter(e => e.op === "log").length, 1, "A：执行报告自身也登记为可逆（回滚先删它）");
  eq(j1.entries[j1.entries.length - 1].op, "log", "A：日志登记排在最后（回滚逆序处理时最先执行）");
  const mvA = j1.entries.find(e => e.op === "move" && e.from === "a.md");
  eq(mvA.sha256, sha("内容A"), "A：搬运日志带改前 sha256");

  /* 幂等：第二次执行不做任何事 */
  const done1 = tree();
  const st1 = await mod.runStatus();
  eq(st1.state.state, "done", "A：状态判定为 done");
  const r2 = await mod.runExecute({ confirmed: true, cloudSynced: true });
  eq(r2.reason, "already-rebuilt", "A：重复执行 → 直接提示已重建");
  eqTree(done1, tree(), "A：重复执行不改动任何文件");
  eq(JSON.parse(journalOf(app)).status, "done", "A：重复执行不覆盖上一份有效日志");

  /* 回滚 */
  const rb = await mod.runRollback({ confirmed: true, cloudSynced: true });
  eq(rb.ok, true, "A：回滚成功");
  eq(rb.verify.ok, true, "A：回滚自检（sha256 + 无残留）通过");
  eq(rb.restored.length, expectJournal, "A：逆操作逐条还原（含删掉执行报告那条）");
  eq(app.__trashed.length, expectJournal - plan.counts.moves,
    "A：回滚删除走 fileManager.trashFile（尊重本体回收站设置；搬运项走改名不删）");
  onlyLogsExtra(before, tree(), "A：回滚后笔记侧与执行前完全一致（路径 + sha256）");
  ok(!!app.vault.getAbstractFileByPath(KBR + "/笔记1.md"),
    "A：归档的旧库连同内容回到原位，本轮新建的空根已清干净");
  ok(app.vault.getAbstractFileByPath("旧文件/" + KBR) === null, "A：旧文件区里的同名归档已搬回，无残留");
  const rbLogs = logPaths();
  eq(rbLogs.length, 2, "A：回滚后库里留 2 篇报告（预览 + 回滚；执行报告已随新建根删掉）");
  ok(rbLogs.every(p => p.indexOf(KBR + "/" + META + "/" + LOGFOLDER + "/") === 0),
    "A：留下的报告都在原库根的 05_操作日志/ 下");
  ok(STUB.VIRTUAL.get(rbLogs.find(p => p.indexOf("回滚") >= 0)).content.indexOf("# 新建知识库 · 回滚报告") >= 0,
    "A：回滚报告标题正确");
  eq(JSON.parse(journalOf(app)).status, "rolled-back", "A：journal 标记已回滚");
  const rb2 = await mod.runRollback({ confirmed: true, cloudSynced: true });
  eq(rb2.reason, "already-rolled-back", "A：重复回滚 → 幂等提示");
  onlyLogsExtra(before, tree(), "A：重复回滚不改动任何文件");
  await plugin.onunload();

  /* ============ 场景 B：中途失败 → 失败即停 → 回滚恢复 ============ */
  app = await freshApp([".obsidian", "01_新知识库", "01_新知识库/99_Meta/05_操作日志", "02_旧知识库"],
    [{ path: "a.md", content: "内容A" }, { path: "b.md", content: "内容B" }]);
  plugin = await boot(app, { rebuild: true });
  mod = plugin.registry.active.rebuild;
  const beforeB = tree();
  const planB = await mod.runPreview();
  const fLogs = logPaths();
  eq(fLogs.length, 1, "B：中断场景里预览也留了报告（失败现场之外唯一的多余项）");
  ok(STUB.VIRTUAL.get(fLogs[0]).content.indexOf("新建知识库 · 预览报告") >= 0, "B：预览报告可读");
  const origRename = app.fileManager.renameFile.bind(app.fileManager);
  let calls = 0;
  app.fileManager.renameFile = async (f, p) => {
    calls++;
    if (calls === 2) throw new Error("沙盒注入失败");
    return origRename(f, p);
  };
  const rB = await mod.runExecute({ confirmed: true, cloudSynced: true });
  eq(rB.status, "failed", "B：底层报错 → 状态 failed");
  eq(rB.failedAt, "move:" + planB.manifest.moves[1].from, "B：失败即停在第二条搬运（动态推算）");
  ok(String(rB.error).indexOf("沙盒注入失败") >= 0, "B：错误原因进结果");
  const jB = JSON.parse(journalOf(app));
  eq(jB.status, "failed", "B：中断状态已落盘（可事后回滚）");
  eq(jB.entries.filter(e => e.op !== "log").length, 2, "B：只记下了已完成的两条（1 mkdirOld + 1 move）");
  eq(jB.entries.filter(e => e.op === "log").length, 0,
    "B：早期中断 → 报告落在原库根（留档，不登记为可逆）");
  const bLogs = logPaths();
  eq(bLogs.length, 2, "B：原库根下留 2 篇报告（预览 + 中断）");
  ok(STUB.VIRTUAL.get(bLogs.find(p => p.indexOf("执行") >= 0)).content.indexOf("# 新建知识库 · 执行报告") >= 0,
    "B：中断报告可读且标题正确");
  /* R7：库根名 = 新建根名，旧库被搬进 旧文件/<库根>，所以「报告跟着笔记走」= 落在旧文件区里那份 */
  ok(bLogs.every(p => p.indexOf(KBR + "/" + META + "/" + LOGFOLDER + "/") === 0 ||
                      p.indexOf("旧文件/" + KBR + "/" + META + "/" + LOGFOLDER + "/") === 0),
    "B：早期中断 → 报告写在「旧库现在所在处」（留档），没有登记为可逆");
  ok(app.vault.getAbstractFileByPath(planB.manifest.moves[1].from) !== null, "B：失败项仍留在原位");
  ok(app.vault.getAbstractFileByPath(planB.manifest.moves[0].to) !== null, "B：已搬项在目标位");

  app.fileManager.renameFile = origRename;                 /* 撤掉注入 */
  const rbB = await mod.runRollback({ confirmed: true, cloudSynced: true });
  eq(rbB.ok, true, "B：中断后回滚成功");
  eq(rbB.restored.length, 2, "B：只回滚已完成的两条");
  onlyLogsExtra(beforeB, tree(), "B：中断后回滚 → 笔记侧完全复原");
  ok(logPaths().length >= 2, "B：回滚不抹掉留档的中断记录");
  await plugin.onunload();

  /* ============ 场景 C：再次重建（R8 ④）——已有库原地保留 + 并列新库 + 旧文件区分代 ============ */
  app = await freshApp([".obsidian", "旧文件", KBR, KBR + "/" + META + "/" + LOGFOLDER],
    [{ path: "旧文件/历史.md", content: "上一轮归档" },
     { path: "散记.md", content: "顶层杂物" },
     { path: KBR + "/旧笔记.md", content: "已有库里的笔记" }]);
  plugin = await boot(app, { rebuild: true });
  mod = plugin.registry.active.rebuild;
  const beforeC = tree();
  const planC = await mod.runPreview();
  eq(planC.reRebuild, true, "C：旧文件区已有内容 → 判定为「再次重建」");
  eq(planC.keepRoot, true, "C：顶层已有同名知识库 → 原地保留，不搬走");
  eq(planC.root, KBR + "1", "C：新库与已有库并列（顺次编号，绝不覆盖）");
  eq(planC.conflicts.length, 0, "C：分代归档之后不再有撞名（本次搬入走独立子文件夹）");
  eq(planC.counts.priorMoves, 1, "C：旧文件区原有 1 项 → 归入「先前已有」");
  const cMoves = planC.moves.map(m => m.from + "->" + m.to).sort().join("|");
  ok(cMoves.indexOf("旧文件/历史.md->" + planC.archive.prior + "/历史.md") >= 0,
    "C：旧文件区原有内容 → 先前已有-<戳>/（戳由 plan 现场生成）");
  ok(cMoves.indexOf("散记.md->" + planC.archive.incoming + "/散记.md") >= 0,
    "C：本次移入的文件 → 本次移入-<戳>/");
  ok(planC.excluded.some(e => e.path === KBR && e.reason.indexOf("已有知识库") >= 0),
    "C：已有知识库被明确标为「原地保留」");
  ok(planC.creates.every(d => d.indexOf(planC.root + "/") === 0), "C：新建目录全挂在新库之下");

  const rC = await mod.runExecute({ confirmed: true, cloudSynced: true });
  eq(rC.status, "done", "C：执行完成");
  eq(rC.blocked.length, 0, "C：没有一条被阻止（分代归档后无撞名）");
  eq(kidsOf(app, "/"), [".obsidian", "旧文件", KBR, planC.root].sort().join(","),
    "C：顶层同时存在两个库目录（已有库 + 并列新库）");
  eq(app.vault.getAbstractFileByPath(KBR + "/旧笔记.md").content, "已有库里的笔记",
    "C：已有库连同里面的笔记原封不动");
  eq(kidsOf(app, "旧文件"),
    [planC.archive.prior.split("/").pop(), planC.archive.incoming.split("/").pop()].sort().join(","),
    "C：旧文件区下恰好两个分代子文件夹（先前已有 / 本次移入）");
  eq(app.vault.getAbstractFileByPath(planC.archive.prior + "/历史.md").content, "上一轮归档",
    "C：上一轮的文件进「先前已有」");
  eq(app.vault.getAbstractFileByPath(planC.archive.incoming + "/散记.md").content, "顶层杂物",
    "C：本次搬入的文件进「本次移入」");
  eq(app.vault.getAbstractFileByPath("散记.md"), null, "C：顶层杂物已不在原位");
  eq((await mod.runStatus()).state.state, "done", "C：状态判定为完成（不误报 partial）");

  const rbC = await mod.runRollback({ confirmed: true, cloudSynced: true });
  eq(rbC.ok, true, "C：回滚成功");
  eq(rbC.verify.ok, true, "C：回滚自检通过");
  ok(app.vault.getAbstractFileByPath(KBR + "/旧笔记.md") !== null, "C：回滚不动已有库");
  eq(app.vault.getAbstractFileByPath("散记.md").content, "顶层杂物", "C：回滚把本次搬入的顶层文件送回原位");
  eq(app.vault.getAbstractFileByPath("旧文件/历史.md").content, "上一轮归档",
    "C：旧文件区原有内容回到 旧文件/ 根下");
  eq(kidsOf(app, "旧文件"), "历史.md", "C：两个分代子文件夹空了即清掉，旧文件区不留空壳");
  onlyLogsExtra(beforeC, tree(), "C：再次重建 + 回滚 → 笔记侧完全复原");
  await plugin.onunload();

  /* ============ 场景 C2：撞名不覆盖（服务层直喂 manifest） ============
   * R8 之后 plan 走分代归档，正常路径产不出撞名 → 这条护栏只能在服务层验。
   * 底线不能破：目标位有同名且内容不同，一律跳过、绝不覆盖、不阻塞其他项。 */
  app = await freshApp([".obsidian", "旧文件"],
    [{ path: "a.md", content: "新的A" }, { path: "旧文件/a.md", content: "旧的A" }]);
  const svcC2 = new KB.services.rebuild(app);
  const rC2 = await svcC2.execute({ version: 1, root: KBR, oldFolder: "旧文件",
    moves: [{ from: "a.md", to: "旧文件/a.md", type: "file", sha256: sha("新的A") }],
    creates: [], seeds: [] }, {});
  eq(rC2.status, "done", "C2：执行完成（撞名项跳过，不阻塞整体）");
  eq(rC2.blocked.length, 1, "C2：1 条被阻止");
  eq(rC2.blocked[0].from, "a.md", "C2：被阻止的正是撞名项");
  eq(app.vault.getAbstractFileByPath("旧文件/a.md").content, "旧的A", "C2：旧文件区原有内容未被覆盖");
  eq(app.vault.getAbstractFileByPath("a.md").content, "新的A", "C2：撞名项原地未动");

  /* ============ 场景 D：坏 manifest 拒绝执行 ============ */
  app = await freshApp([".obsidian"], [{ path: "a.md", content: "内容A" }]);
  plugin = await boot(app, { rebuild: true });
  mod = plugin.registry.active.rebuild;
  const beforeD = tree();
  await mod.runPreview();
  const bad = { version: 1, root: KBR, oldFolder: "旧文件",
    moves: [{ from: "a.md", to: "别处/a.md" }], creates: [], seeds: [] };
  await app.vault.adapter.write(ADIR + "rebuild-manifest.json", JSON.stringify(bad));
  const rD = await mod.runExecute({ confirmed: true, cloudSynced: true });
  eq(rD.reason, "invalid-manifest", "D：坏 manifest → 拒绝执行并提示重新预览");
  eqTree(beforeD, tree(), "D：拒绝时没动库");
  const KBsvc = new global.KB.services.rebuild(app);
  const rD2 = await KBsvc.execute(bad, {});
  eq(rD2.status, "invalid", "D：服务层直接喂坏 manifest → invalid");
  ok(rD2.errors.length >= 1, "D：报出校验错误明细");
  await plugin.onunload();

  /* ============ 场景 E：预检提醒（0 字节笔记 + 预览后新增项） ============ */
  app = await freshApp([".obsidian"], [{ path: "a.md", content: "内容A" }, { path: "空.md", content: "" }]);
  plugin = await boot(app, { rebuild: true });
  mod = plugin.registry.active.rebuild;
  await mod.runPreview();
  await app.vault.create("c.md", "预览之后才出现");
  const eE = await mod.runExecute();
  ok(eE.needConfirm === true, "E：仍要确认");
  const w = (eE.preflight.warnings || []).join("｜");
  ok(w.indexOf("0 字节") >= 0, "E：预检提醒 0 字节笔记");
  ok(w.indexOf("多了 1 项") >= 0, "E：预检提醒 manifest 已过期（新增 1 项）");
  ok(w.indexOf("c.md") >= 0, "E：提醒里点名具体新增项");
  await plugin.onunload();

  /* ============ 场景 F：确认弹窗（未勾选 → 拒绝；勾选 → 触发回调） ============ */
  app = await freshApp([".obsidian"], [{ path: "a.md", content: "内容A" }]);
  plugin = await boot(app, { rebuild: true });
  mod = plugin.registry.active.rebuild;
  const eF = await mod.runExecute();
  const modal = mod.buildConfirmModal("execute", eF.preflight);
  ok(!!modal, "F：确认弹窗可构造");
  modal.open();
  const txt = modal.contentEl.textContent;
  ok(txt.indexOf("执行确认") >= 0, "F：弹窗标题正确");
  ok(txt.indexOf("知识库") >= 0 && txt.indexOf("旧文件") >= 0, "F：弹窗列出根名与旧文件区");
  ok(txt.indexOf("坚果云") >= 0, "F：弹窗要求确认坚果云已同步");
  ok(modal.okEl.disabled === true, "F：未勾选时确认按钮禁用");
  let cbArgs = null;
  modal.onConfirm = v => { cbArgs = v; };
  eq(modal.confirm(), false, "F：未勾选 → confirm() 拒绝");
  ok(cbArgs === null, "F：拒绝时不触发回调");
  modal.cloudSynced = true; modal.syncButton();
  ok(modal.okEl.disabled === false, "F：勾选后按钮可用");
  eq(modal.confirm(), true, "F：勾选后 confirm() 通过");
  eq(cbArgs, true, "F：回调收到 cloudSynced=true");
  ok(modal.opened === false, "F：确认后弹窗关闭");
  await plugin.onunload();

  /* ============ 场景 H：老版本没有 trashFile → 退回 vault.delete 兜底 ============ */
  app = await freshApp([".obsidian"], [{ path: "a.md", content: "内容A" }]);
  plugin = await boot(app, { rebuild: true });
  mod = plugin.registry.active.rebuild;
  const beforeH = tree();
  delete app.fileManager.trashFile;                        /* 模拟无此 API 的环境 */
  await mod.runPreview();
  await mod.runExecute({ confirmed: true, cloudSynced: true });
  const rH = await mod.runRollback({ confirmed: true, cloudSynced: true });
  eq(rH.ok, true, "H：无 trashFile 时回滚仍成功（退回 vault.delete）");
  eq(rH.verify.ok, true, "H：兜底路径自检通过");
  eq(app.__trashed.length, 0, "H：确认没走 trashFile 分支");
  eqTree(beforeH, tree(), "H：兜底路径同样完全复原");
  await plugin.onunload();

  /* ============ 场景 G：真链路（设置页「执行」按钮 → 弹窗 → 勾选 → 确认 → 执行） ============
   * R13 起「执行」不再有命令面板入口（危险操作必须在设置页走确认弹窗），按钮调的就是 startConfirm。 */
  app = await freshApp([".obsidian"], [{ path: "a.md", content: "内容A" }, { path: "b.md", content: "内容B" }]);
  plugin = await boot(app, { rebuild: true });
  mod = plugin.registry.active.rebuild;
  const beforeG = tree();
  await mod.startConfirm("execute");
  ok(!!mod.lastModal && mod.lastModal.opened === true, "G：命令打开确认弹窗");
  eqTree(beforeG, tree(), "G：弹窗阶段不动库");
  mod.lastModal.cloudSynced = true;
  mod.lastModal.confirm();
  await sleep(60);
  ok(app.vault.getAbstractFileByPath(KBR) !== null, "G：确认后真的建了根");
  eq(kidsOf(app, "旧文件"), "a.md,b.md", "G：确认后真的搬了文件");
  const jG = JSON.parse(journalOf(app));
  eq(jG.status, "done", "G：真链路日志落盘");
  await plugin.onunload();

  console.log("R4b 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exitCode = 2; });
