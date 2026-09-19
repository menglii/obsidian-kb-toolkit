/* kb-toolkit R5 断言：路径全配置化 · 首次使用向导 · 版本 1.0 · 示例库一致性。
 * 期望值一律动态推算（从 DEFAULTS / 真实磁盘 / zip 实算），不写死数字。 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const crypto = require("crypto");
const { JSDOM } = require("jsdom");
const { execFileSync } = require("child_process");

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
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
/** 剥掉注释（审计要求：注释里的路径示例不算硬编码） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
function readSrc() {
  const out = {};
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith(".js")).sort())
    out[f] = fs.readFileSync(path.join(SRC, f), "utf8");
  return out;
}

(async function main() {
  const KBplugin = require("../main.js");
  const KB = globalThis.KB;
  const D = KB.services.settings.DEFAULTS;
  const util = KB.services["router.util"];

  /* ================= A. 硬编码审计（静态源码扫描） ================= */
  const src = readSrc();
  /* 该文件是「默认值出口」，顶层路径字面量合法且只允许出现在这里 */
  const DEFAULT_OUTLET = "70_core_settings.js";
  const BANNED = [
    /01_新知识库/, /02_旧知识库/,
    /99_Meta\s*\//, /00_Inbox\s*\//, /01_Projects\s*\//,
    /02_Areas\s*\//, /03_Resources\s*\//, /04_Archives\s*\//
  ];
  const offenders = [];
  for (const f in src) {
    if (f === DEFAULT_OUTLET) continue;
    const code = stripComments(src[f]);
    code.split(/\r?\n/).forEach((line, i) => {
      for (const re of BANNED) if (re.test(line)) {
        offenders.push(f + ":" + (i + 1) + " " + line.trim().slice(0, 70));
        break;
      }
    });
  }
  ok(offenders.length === 0, "A：src 除默认值出口外零顶层路径字面量" +
    (offenders.length ? " → " + offenders.join(" | ") : ""));
  ok(BANNED.some(re => re.test(src[DEFAULT_OUTLET])), "A：默认值出口确实持有路径字面量（审计没空跑）");
  const holders = Object.keys(src).filter(f => BANNED.some(re => re.test(stripComments(src[f]))));
  eq(holders.join(","), DEFAULT_OUTLET, "A：路径字面量只出现在 " + DEFAULT_OUTLET);

  /* ================= B. 默认值派生一致性 ================= */
  const P = D.paths;
  eq(P.knowledgeBase, KB.services.settings.DEFAULT_ROOT, "B：默认库根 = DEFAULT_ROOT");
  eq(P.metaDir, KB.services.settings.DEFAULT_META, "B：默认元目录 = DEFAULT_META");
  eq(P.mocLink, P.knowledgeBase + "/" + P.metaDir + "/04_索引与地图/MOC_知识地图", "B：mocLink 由路径派生");
  const routes = D.automation.routes;
  eq(routes.length, KB.services.settings.REL_ROUTES.length, "B：默认路由条数 = 相对表条数");
  ok(routes.length === 12, "B：默认路由 12 条（与 note-locator 现网一致）");
  ok(routes.every(r => r.folder.indexOf(P.knowledgeBase + "/") === 0), "B：每条默认路由都带默认库根前缀");
  /* R9：排除规则由 3 条变 4 条（多了「回滚收容区」）→ 改成**成员断言**，不再认下标，
     以后再追加规则也不会假失败。 */
  const EX = D.automation.excluded;
  ok(EX.indexOf("^" + P.knowledgeBase + "/" + P.metaDir) >= 0, "B：排除规则含「库根+元目录」");
  ok(EX.indexOf("^" + KB.services.settings.DEFAULT_LEGACY) >= 0, "B：排除规则含「历史存档库」");
  ok(EX.indexOf("^" + KB.services.settings.DEFAULTS.rebuild.rollbackKeepName) >= 0,
    "B：排除规则含「回滚收容区」（R9 新增：回滚收容时不许被路由抢回去）");
  ok(EX.indexOf("(^|/)\\.") >= 0, "B：排除规则含「点开头目录」");
  eq(EX.length, 4, "B：默认排除规则共 4 条");
  ok(D.wizardDone === false, "B：向导默认未走过");

  /* ================= C. 中心表按真实路径回构（库根改名自动跟随） ================= */
  util.setCenters(null);                    /* 回到默认表 */
  const R0 = P.knowledgeBase;
  eq(util.centerFor(R0 + "/00_Inbox"), R0 + "/00_Inbox/_收件箱", "C：收件箱中心页");
  eq(util.centerFor(R0 + "/02_Areas/内容创作"), R0 + "/02_Areas/_领域中心", "C：子目录回构到领域中心");
  eq(util.centerFor(R0 + "/01_Projects/01_执行中"), R0 + "/01_Projects/_项目中心", "C：项目子目录回构");
  eq(util.centerFor(R0 + "/02_Areas"), R0 + "/02_Areas/_领域中心", "C：中心目录自身");
  eq(util.centerFor(R0 + "/98_其它"), null, "C：非中心目录 → null");
  eq(util.centerFor(R0 + "/02_AreasX"), null, "C：目录名边界（不误吃长名）");
  eq(util.centerFor(R0 + "/x02_Areas"), null, "C：子串不误伤");
  eq(util.centerFor(""), null, "C：空路径 → null");
  /* 改名后回构 */
  const R1 = "我的知识库";
  eq(util.centerFor(R1 + "/02_Areas/内容创作"), R1 + "/02_Areas/_领域中心", "C：换库根后中心链自动跟随");
  eq(util.centerFor(R1 + "/02_Areas/内容创作"), R0.replace(R0, R1) + "/02_Areas/_领域中心", "C：前缀就是新库根");

  /* 模板推导 == 内置默认表 */
  const derived = util.specsFromTemplate(D.rebuild.template);
  eq(derived.length, util.CENTER_SPEC_DEFAULT.length, "C：模板推出的中心数 = 默认表数");
  eq(JSON.stringify(derived), JSON.stringify(util.CENTER_SPEC_DEFAULT), "C：模板推导与默认表逐字段一致");
  eq(derived.map(c => c.dir).every((d, i) => D.rebuild.template.seedFiles.some(s => s.indexOf(d + "/_") === 0)), true,
    "C：每个中心目录都能在 seedFiles 里找到中心页");

  /* ================= D. reapplyPaths 的保守性 ================= */
  const mkSettings = () => JSON.parse(JSON.stringify(D));
  let S = mkSettings();
  let prev = { knowledgeBase: S.paths.knowledgeBase, metaDir: S.paths.metaDir, legacyDirs: S.paths.legacyDirs.slice() };
  S.paths.knowledgeBase = R1;
  KB.services.settings.reapplyPaths(S, prev);
  ok(S.automation.routes.every(r => r.folder.indexOf(R1 + "/") === 0), "D：改库根 → 默认路由全部换前缀");
  eq(S.automation.excluded[0], "^" + R1 + "/" + S.paths.metaDir, "D：改库根 → 排除规则①跟随");
  eq(S.paths.mocLink, R1 + "/" + S.paths.metaDir + "/04_索引与地图/MOC_知识地图", "D：改库根 → mocLink 跟随");

  S = mkSettings();
  prev = { knowledgeBase: S.paths.knowledgeBase, metaDir: S.paths.metaDir, legacyDirs: S.paths.legacyDirs.slice() };
  const custom = [{ folder: "自留地/随笔", values: ["随笔"] }];
  S.automation.routes = JSON.parse(JSON.stringify(custom));
  S.automation.excluded = ["^我自己写的$"];
  S.paths.knowledgeBase = R1;
  KB.services.settings.reapplyPaths(S, prev);
  eq(JSON.stringify(S.automation.routes), JSON.stringify(custom), "D：用户手改过的路由表不被覆盖");
  eq(JSON.stringify(S.automation.excluded), JSON.stringify(["^我自己写的$"]), "D：用户手改过的排除规则不被覆盖");

  S = mkSettings();
  prev = { knowledgeBase: S.paths.knowledgeBase, metaDir: S.paths.metaDir, legacyDirs: S.paths.legacyDirs.slice() };
  const newMeta = "98_系统";
  const oldMeta = S.paths.metaDir;
  S.paths.metaDir = newMeta;
  KB.services.settings.reapplyPaths(S, prev);
  ok(S.rebuild.template.dirs.every(d => d !== oldMeta && d.indexOf(oldMeta + "/") !== 0), "D：元目录改名 → 模板目录不留旧名");
  ok(S.rebuild.template.dirs.some(d => d === newMeta), "D：元目录改名 → 模板顶层目录换成新名");
  ok(S.rebuild.template.seedFiles.some(f => f.indexOf(newMeta + "/") === 0), "D：元目录改名 → 模板种子路径跟随");
  eq(S.rebuild.template.dirs.length, D.rebuild.template.dirs.length, "D：改名不改变目录数量");

  /* ================= E. Router 读配置（不再兜底硬编码） ================= */
  const app = STUB.makeApp();
  const plugin = new KBplugin(app, { id: "kb-toolkit" });
  plugin.data = { modules: { rebuild: true, automation: true }, wizardDone: true, paths: { knowledgeBase: R0 } };
  await plugin.onload();
  const auto = plugin.registry.active.automation;
  ok(!!auto && !!auto.router, "E：automation 模块启用并拿到 Router");
  eq(auto.router.root, R0, "E：Router.root 来自 settings.paths.knowledgeBase");
  /* 直接用一份自定义 settings 重建 Router，验证前缀跟随 */
  const R2 = "自定义库";
  const r2 = new KB.services.router({ root: R2, property: "文件位置",
    routes: KB.services.settings.withRoot(R2, KB.services.settings.REL_ROUTES),
    excluded: KB.services.settings.defaultExcluded({ knowledgeBase: R2, metaDir: D.paths.metaDir, legacyDirs: [] }) });
  const hit = r2.resolveTarget({ "文件位置": "02_Areas/游戏研究" }, [], R2 + "/00_Inbox", app);
  ok(hit && hit.folder === R2 + "/02_Areas/游戏研究", "E：换库根后路由目标落在新库根下");
  eq(r2.isExcluded(R2 + "/" + D.paths.metaDir + "/02_模板库"), true, "E：换库根后排他规则仍生效");
  eq(r2.isExcluded(R0 + "/" + D.paths.metaDir), false, "E：旧库根不再被本 Router 排除");

  /* ================= F. 首次使用向导 ================= */
  const app2 = STUB.makeApp();
  const p2 = new KBplugin(app2, { id: "kb-toolkit" });
  p2.data = { modules: { rebuild: false, automation: false, base: true } };   /* 没走过向导 */
  await p2.onload();
  eq(p2.settings.wizardDone, false, "F：onload 不替用户标记向导已完成");
  eq(KB.modules.maybeShowWizard(p2), true, "F：未走过 → 会自动弹向导");
  eq(KB.modules.maybeShowWizard(p2), true, "F：未确认前可重复弹（不静默吞掉）");

  const d0 = KB.modules.wizardDetect(p2);
  ok(typeof d0.rootExists === "boolean" && typeof d0.oldExists === "boolean" && Array.isArray(d0.tops),
    "F：现场检测返回结构完整");
  const sum = KB.modules.wizardSummary(p2);
  eq(sum.knowledgeBase, p2.settings.paths.knowledgeBase, "F：摘要里的库根 = 当前设置");
  eq(sum.topCount, d0.tops.length, "F：摘要顶层项数 = 检测结果");

  const modal = new KB.modules.WizardModal(app2, p2);
  modal.open();
  ok(modal.opened === true, "F：向导可打开");
  const txt = modal.contentEl.textContent || "";
  ok(txt.indexOf("初次设置") >= 0, "F：向导标题");
  ok(txt.indexOf("知识库根目录") >= 0 && txt.indexOf("元数据目录名") >= 0, "F：含两个目录名输入项");
  ok(txt.indexOf("现场检测") >= 0, "F：含现场检测段");
  const buttons = modal.contentEl.querySelectorAll("button");
  eq(buttons.length, 2, "F：向导两个按钮（保存并完成 / 以后再说）");
  eq(buttons[buttons.length - 1].textContent, "以后再说", "F：末位是「以后再说」");

  /* 改草稿 → 保存：路径换代 + wizardDone */
  const NEWROOT = "老板的知识库";
  modal.draft.knowledgeBase = NEWROOT;
  modal.draft.metaDir = "97_Meta";
  modal.draft.modules.rebuild = true;
  modal.save();
  await new Promise(r => setTimeout(r, 10));
  eq(p2.settings.paths.knowledgeBase, NEWROOT, "F：保存写入新库根");
  eq(p2.settings.paths.metaDir, "97_Meta", "F：保存写入新元目录");
  eq(p2.settings.wizardDone, true, "F：保存后向导标记完成");
  ok(p2.settings.automation.routes.every(r => r.folder.indexOf(NEWROOT + "/") === 0), "F：保存后路由表换代");
  ok(p2.settings.rebuild.template.dirs.some(d => d === "97_Meta"), "F：保存后模板元目录换代");
  eq(KB.modules.maybeShowWizard(p2), false, "F：走过向导后不再自动弹");
  eq(p2.settings.modules.rebuild, true, "F：保存写入模块开关");
  /* 🔴 回归守卫：settings 曾经与 DEFAULTS 共享引用，向导一改路径就把默认值就地改了 */
  eq(D.paths.knowledgeBase, KB.services.settings.DEFAULT_ROOT, "F：向导改路径不污染 DEFAULTS.paths");
  eq(D.rebuild.template.dirs.indexOf(KB.services.settings.DEFAULT_META) >= 0, true,
    "F：向导改元目录不污染 DEFAULTS.rebuild.template");
  ok(p2.settings.rebuild.template !== D.rebuild.template, "F：settings.rebuild.template 不是 DEFAULTS 的同一个对象");
  ok(p2.settings.automation.routes !== D.automation.routes, "F：settings.automation.routes 不是 DEFAULTS 的同一个数组");
  ok(STUB.Notice.all.some(m => m.indexOf("初次设置已保存") >= 0), "F：保存给出提示");

  /* 「以后再说」路径 */
  const app3 = STUB.makeApp();
  const p3 = new KBplugin(app3, { id: "kb-toolkit" });
  p3.data = {};
  await p3.onload();
  const m3 = new KB.modules.WizardModal(app3, p3);
  m3.open();
  const b3 = m3.contentEl.querySelectorAll("button");
  b3[b3.length - 1].dispatchEvent(new dom.window.Event("click"));
  eq(p3.settings.wizardDone, true, "F：「以后再说」也会标记已读（不再骚扰）");
  eq(m3.opened, false, "F：「以后再说」关闭弹窗");
  eq(p3.settings.paths.knowledgeBase, D.paths.knowledgeBase, "F：「以后再说」不擅自改路径");

  /* ================= G. 设置页 ================= */
  const tab = new KB.modules.SettingTab(app2, p2);
  tab.containerEl = dom.window.document.createElement("div");
  let threw = null;
  try { tab.display(); } catch (e) { threw = e; }
  eq(threw, null, "G：设置页渲染不抛异常");
  const tabTxt = tab.containerEl.textContent || "";
  ok(tabTxt.indexOf("知识库根目录") >= 0, "G：设置页有路径组（R18 起「高级」组内 = 知识库根目录 / 元数据目录名）");
  ok(tabTxt.indexOf("首次使用向导") >= 0, "G：设置页有向导入口");
  const btnTexts = [];
  (function collect(el) {
    for (const b of el.querySelectorAll("button")) btnTexts.push(b.textContent);
    for (const c of el.children) collect(c);
  })(tab.containerEl);
  ok(btnTexts.indexOf("打开向导") >= 0, "G：向导按钮存在");
  ok(btnTexts.indexOf("执行") >= 0 && btnTexts.indexOf("回滚") >= 0, "G：①组三个危险按钮仍在（R4b 未回归）");

  /* ================= H. 版本与文档 ================= */
  const man = JSON.parse(fs.readFileSync(path.join(PLUG, "manifest.json"), "utf8"));
  eq(man.id, "kb-toolkit", "H：插件 id 未变");
  eq(man.version, "1.0.0", "H：版本升到 1.0.0");
  const vers = JSON.parse(fs.readFileSync(path.join(PLUG, "versions.json"), "utf8"));
  eq(vers[man.version], man.minAppVersion, "H：versions.json 覆盖 1.0.0 且 minAppVersion 一致");
  ok(Object.keys(vers).length >= 1, "H：versions.json 有条目");
  const readme = fs.readFileSync(path.join(PLUG, "README.md"), "utf8");
  ok(readme.indexOf("旧插件迁移") >= 0, "H：README 含旧插件迁移说明");
  ok(readme.indexOf("note-locator") >= 0 && readme.indexOf("creation-board") >= 0, "H：README 列出具体旧插件");
  ok(readme.indexOf("1.0.0") >= 0, "H：README 标注 1.0.0");
  ok(readme.indexOf("示例库.zip") >= 0, "H：README 提到示例库");
  const chg = fs.readFileSync(path.join(PLUG, "CHANGELOG.md"), "utf8");
  ok(/^# Changelog/.test(chg.trim()), "H：CHANGELOG 首行标题");
  ok(chg.indexOf("## 1.0.0") >= 0, "H：CHANGELOG 含 1.0.0 段");
  ok(chg.indexOf("## 0.1.0") >= 0, "H：CHANGELOG 追溯到 0.1.0");

  /* ================= I. 示例库一致性（与插件本体逐字节对齐） ================= */
  const sManPath = path.join(PLUG, "samples", "_sample_manifest.json");
  const sZipPath = path.join(PLUG, "samples", "_sample_zip.json");
  ok(fs.existsSync(sManPath), "I：示例库清单存在");
  ok(fs.existsSync(sZipPath), "I：示例库 zip 清单存在");
  const sMan = JSON.parse(fs.readFileSync(sManPath, "utf8"));
  const sZip = JSON.parse(fs.readFileSync(sZipPath, "utf8"));
  const ZIPFILE = path.join(PLUG, "samples", "示例库.zip");
  ok(fs.existsSync(ZIPFILE), "I：示例库 zip 存在");
  eq(sha256(fs.readFileSync(ZIPFILE)), sZip.sha256, "I：zip 的 sha256 与清单一致");
  eq(fs.statSync(ZIPFILE).size, sZip.bytes, "I：zip 字节数与清单一致");

  /* 关键：示例库种子文件 == 插件 seedContent 现算结果（动态复算，不写死） */
  const svc = new KB.services.rebuild(STUB.makeApp());
  const seedKeys = Object.keys(sMan.seeds);
  eq(seedKeys.length, D.rebuild.template.seedFiles.length, "I：示例库种子数 = 模板种子数");
  let mismatch = [];
  for (const rel of seedKeys) {
    const now = svc.seedContent(sMan.root + "/" + rel, { cfg: D.rebuild });
    if (now !== sMan.seeds[rel]) mismatch.push(rel);
    const onDisk = fs.readFileSync(path.join(PLUG, "samples", "示例库", sMan.root, rel.replace(/\//g, path.sep)), "utf8");
    if (onDisk !== now) mismatch.push(rel + "(磁盘)");
  }
  eq(mismatch.join(","), "", "I：示例库 7 个种子与插件现算结果逐字节一致");
  ok(sMan.seeds["99_Meta/04_索引与地图/MOC_知识地图.md"].indexOf("[[_收件箱]]") >= 0, "I：MOC 含收件箱中心链");
  ok(sMan.seeds["99_Meta/04_索引与地图/知识库目录说明.md"].indexOf("| 00_Inbox |") >= 0, "I：目录说明表由模板目录推导");

  /* 空目录也进了 zip（20 个模板目录） */
  const dirEntries = sZip.names.filter(n => n.endsWith("/"));
  eq(dirEntries.length, D.rebuild.template.dirs.length, "I：zip 内目录条目数 = 模板目录数");
  ok(dirEntries.every(n => n.indexOf("示例库/" + sMan.root + "/") === 0), "I：目录条目都挂在示例库根下");
  const fileEntries = sZip.names.filter(n => !n.endsWith("/"));
  eq(fileEntries.length, sMan.extraFiles.length + D.rebuild.template.seedFiles.length,
    "I：zip 文件条目 = 附加文件 + 模板种子");
  eq(fileEntries.length, sMan.extraFiles.length + seedKeys.length, "I：文件条目逐类对齐");
  ok(sZip.names.indexOf("示例库/README.md") >= 0, "I：zip 含示例库说明");

  /* 示例 .base 的两个视图类型与插件注册的一致（否则示例打不开） */
  const baseRel = "示例库/01_新知识库/99_Meta/01_仪表盘/示例·看板与内容流.base";
  ok(sZip.names.indexOf(baseRel) >= 0, "I：zip 含示例 .base");
  const baseTxt = fs.readFileSync(path.join(PLUG, "samples", "示例库", "01_新知识库", "99_Meta", "01_仪表盘", "示例·看板与内容流.base"), "utf8");
  ok(baseTxt.indexOf("type: creation-board") >= 0, "I：示例 base 用 creation-board 视图");
  ok(baseTxt.indexOf("type: note-stream") >= 0, "I：示例 base 用 note-stream 视图");
  const registered = [];
  for (const id of ["board", "stream"]) {
    const inst = plugin.registry.active[id] && plugin.registry.active[id].inst;
    if (inst && inst._basesViews) for (const v of inst._basesViews) registered.push(v.id);
  }
  ok(registered.indexOf("creation-board") >= 0 && registered.indexOf("note-stream") >= 0,
    "I：插件注册的 VIEW_TYPE 与示例 base 对得上（" + registered.join("、") + "）");

  /* ================= J. 复现性：重跑生成器应得到同一份示例库 ================= */
  try {
    execFileSync(process.execPath, [path.join(PLUG, "scripts", "make_sample_vault.js")],
      { cwd: PLUG, stdio: "pipe" });
    const sMan2 = JSON.parse(fs.readFileSync(sManPath, "utf8"));
    const diff = [];
    for (const rel of seedKeys) if (sMan2.seeds[rel] !== sMan.seeds[rel]) diff.push(rel);
    eq(diff.join(","), "", "J：重跑生成器 → 种子内容逐字节可复现（无随机/无时间戳泄漏）");
    eq(sMan2.dirs.join(","), sMan.dirs.join(","), "J：重跑生成器 → 目录清单不变");
    eq(sMan2.extraFiles.join(","), sMan.extraFiles.join(","), "J：重跑生成器 → 附加文件清单不变");
    /* 磁盘上的示例库文件数应与 zip 的文件条目对得上（zip 含顶层 README，磁盘树不含） */
    const onDisk = [];
    (function walk(d) {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) walk(p); else onDisk.push(p);
      }
    })(path.join(PLUG, "samples", "示例库"));
    eq(onDisk.length, fileEntries.length, "J：磁盘示例库文件数 = zip 文件条目数（README 也在库内）");
    eq(sMan.root, D.paths.knowledgeBase, "J：示例库结构与默认配置同构（无需改路径）");
  } catch (e) {
    ok(false, "J：生成器复跑失败 → " + (e && e.message));
  }

  await plugin.onunload(); await p2.onunload(); await p3.onunload();
  console.log("R5 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exitCode = 2; });
