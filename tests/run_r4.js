/* kb-toolkit R4a 断言：新建知识库只读预览（计划正确性 + manifest 校验 + 只读保证）。
 * 期望值动态推算（根名序号、冲突数、模板目录数均从输入推导）。 */
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

const sha = t => crypto.createHash("sha256").update(t, "utf8").digest("hex");

(async function main() {
  const KBplugin = require("../main.js");
  const KB = globalThis.KB;
  /* R7：新建根名 = 库根名（唯一真源）。不再写死「知识库」—— 所以期望值也从配置推。 */
  const KBR = KB.services.settings.DEFAULTS.paths.knowledgeBase;

  /* ---- 场景 A：干净库（无知识库/旧文件） ---- */
  const app = STUB.makeApp();
  const plugin = new KBplugin(app, { id: "kb-toolkit" });
  plugin.data = { modules: { rebuild: true } };
  await plugin.onload();
  const mod = plugin.registry.active.rebuild;
  ok(!!mod, "rebuild 模块已启用");
  ok(plugin._commands.some(c => c.id === "rebuild-preview"), "注册了预览命令");

  /* 搭场景 A：顶层 2 文件 + 2 文件夹 + 系统目录 */
  const fileA = { path: "a.md", name: "a.md", basename: "a", extension: "md", parent: { path: "/" }, content: "内容A", children: undefined };
  const fileB = { path: "b.md", name: "b.md", basename: "b", extension: "md", parent: { path: "/" }, content: "内容B", children: undefined };
  const fProjects = new STUB.TFolder(KBR);
  const fOld = new STUB.TFolder("02_旧知识库");
  const fSys = new STUB.TFolder(".obsidian");
  STUB.VIRTUAL.set("a.md", fileA); STUB.VIRTUAL.set("b.md", fileB);
  STUB.VIRTUAL.set(KBR, fProjects); STUB.VIRTUAL.set("02_旧知识库", fOld);
  STUB.VIRTUAL.set(".obsidian", fSys);
  app.__root.children.push(fileA, fileB, fProjects, fOld, fSys);

  const cfg = JSON.parse(JSON.stringify(plugin.settings.rebuild));
  const tplDirs = cfg.template.dirs.length, tplSeeds = cfg.template.seedFiles.length;
  const plan = await mod.runPreview();

  /* 根名与移动清单 */
  eq(cfg.rootName, KBR, "A：新建根名由配置派生（= 库根名，不写死）");
  eq(plan.root, KBR, "A：根名 = 库根名（同名旧库会被归档，名字原地复用）");
  eq(plan.counts.moves, 4, "A：移动 4 项（2 文件 + 2 文件夹，系统目录排除）");
  eq(plan.counts.fileMoves, 2, "A：文件移动 2");
  eq(plan.counts.folderMoves, 2, "A：文件夹移动 2");
  const moveTo = plan.moves.map(m => m.to).sort().join("|");
  eq(moveTo, ["旧文件/" + KBR, "旧文件/02_旧知识库", "旧文件/a.md", "旧文件/b.md"].sort().join("|"),
    "A：移动目标全部进旧文件（含同名旧库本体）");
  eq(plan.counts.excluded, 1, "A：排除 1（.obsidian）");
  ok(plan.moves.every(m => m.type === "file" ? (m.sha256 && m.sha256.length === 64) : m.sha256 === null), "A：文件带 sha256、文件夹无");
  eq(plan.moves.find(m => m.from === "a.md").sha256, sha("内容A"), "A：sha256 正确");

  /* 模板与种子 */
  eq(plan.counts.creates, tplDirs, "A：建目录数=模板目录数（" + tplDirs + "）");
  eq(plan.creates[0], KBR + "/00_Inbox", "A：目录挂在库根下");
  eq(plan.counts.seeds, tplSeeds, "A：种子数=模板种子数（" + tplSeeds + "）");
  ok(plan.seeds.some(s => s.indexOf("MOC_知识地图") >= 0), "A：种子含 MOC");

  /* 只读保证：plan 不写库 */
  ok(STUB.VIRTUAL.get("旧文件") === undefined && STUB.VIRTUAL.get(KBR) === fProjects, "A：规划不落库");
  eq(fileA.path, "a.md", "A：原文件路径未动");

  /* 报告落盘在插件目录 */
  const report = app.vault.adapter._files.get(".obsidian/plugins/kb-toolkit/rebuild-preview.json");
  ok(!!report && JSON.parse(report).root === KBR, "A：报告写 rebuild-preview.json");

  /* ---- 场景 B：旧文件已存在 + 撞名 + 同名编号残留 ---- */
  const app2 = STUB.makeApp();
  const p2 = new KBplugin(app2, { id: "kb-toolkit" });
  p2.data = { modules: { rebuild: true } };
  await p2.onload();
  const mod2 = p2.registry.active.rebuild;
  const fKb = new STUB.TFolder(KBR);
  const fKbNum = new STUB.TFolder(KBR + "1");            /* 上次中断留下的空壳 */
  const fOld2 = new STUB.TFolder("旧文件");
  const clash = { path: "旧文件/a.md", name: "a.md", basename: "a", extension: "md", parent: { path: "旧文件" }, content: "旧的A", children: undefined };
  STUB.VIRTUAL.set(KBR, fKb); STUB.VIRTUAL.set(KBR + "1", fKbNum);
  STUB.VIRTUAL.set("旧文件", fOld2); STUB.VIRTUAL.set("旧文件/a.md", clash);
  fOld2.children.push(clash);
  const fileA2 = { path: "a.md", name: "a.md", basename: "a", extension: "md", parent: { path: "/" }, content: "新的A", children: undefined };
  STUB.VIRTUAL.set("a.md", fileA2);
  app2.__root.children.push(fileA2, fKb, fKbNum, fOld2);

  const plan2 = await mod2.runPreview();
  /* R8 改了这里的语义（老板要求）：旧文件区里**已经有内容** → 这是「再次重建」，
   * 已有知识库原地保留（不再搬进旧文件），新库取下一个编号名与它并列；
   * 本次搬入走「旧文件/本次移入-<戳>/」，旧文件区原有内容先归入「旧文件/先前已有-<戳>/」。 */
  eq(plan2.root, KBR + "2", "B：库根原地保留 → 新库取下一个编号名（" + KBR + " / " + KBR + "1 都占着）");
  ok(plan2.mergeOld === true, "B：旧文件已存在 → 并入模式");
  ok(plan2.keepRoot === true, "B：已有知识库原地保留（R8 语义）");
  ok(plan2.reRebuild === true, "B：旧文件区有内容 → 判定为再次重建");
  eq(plan2.counts.conflicts, 0, "B：本次搬入走独立子文件夹 → 与旧文件区原有同名不再冲突（两篇都留住）");
  eq(plan2.counts.priorMoves, 1, "B：旧文件区原有内容先归入「先前已有-<戳>」（1 项）");
  ok(plan2.archive.prior.indexOf("/先前已有-") > 0 && plan2.archive.incoming.indexOf("/本次移入-") > 0,
    "B：分代子文件夹名带时间戳");
  ok(plan2.moves.some(m => m.from === "a.md" && m.to.indexOf(plan2.archive.incoming + "/") === 0),
    "B：顶层项搬到「本次移入-<戳>/」下");
  eq(plan2.counts.excluded, 3, "B：同名编号残留 + 旧文件区 + 被保留的库根 均列入排除");
  ok(plan2.excluded.some(e => e.path === KBR + "1"), "B：编号残留真的被点名排出去了");
  ok(plan2.excluded.some(e => e.path === KBR && /保留/.test(e.reason)), "B：库根被点名「原地保留」");
  ok(plan2.manifestValid === true, "B：manifest 校验通过");

  /* 首次重建（旧文件区不存在）仍走老语义：库根本体搬走 + 名字原地复用 —— 见场景 A。 */

  /* uniqueRoot 仍是安全网：真·撞名时顺次编号 */
  const svcU = new KB.services.rebuild(app2);
  eq(svcU.uniqueRoot(KBR), KBR + "2", "B：uniqueRoot 撞名时顺次编号（01_新知识库 / 01_新知识库1 都已存在）");
  eq(svcU.uniqueRoot("还没建的目录"), "还没建的目录", "B：uniqueRoot 没撞名就原样返回");

  /* ---- 场景 C：manifest 校验器抓坏输入 ---- */
  const svc2 = new KB.services.rebuild(app2);
  const bad = { version: 1, root: KBR, oldFolder: "旧文件",
    moves: [{ from: "a.md", to: "旧文件/a.md" }, { from: "b.md", to: "旧文件/a.md" }],
    creates: ["旧文件/c"], seeds: [] };
  const v = svc2.validateManifest(bad);
  ok(v.ok === false && v.errors.length >= 2, "C：重复目标/目录撞车被抓");
  const good = await svc2.plan(cfg);
  ok(svc2.validateManifest(good.manifest).ok === true, "C：plan 产出的 manifest 自校验通过");
  await plugin.onunload(); await p2.onunload();

  console.log("R4 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exitCode = 2; });
