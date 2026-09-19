/* kb-toolkit R9 断言：老板第四轮真机反馈（第 3/4/5/6/7/8 条）的修复证据。
 *   ① 第 3 条 —— 「似乎会自动创建数据库，然后报出提示」
 *      根因：视图注册的双注册告警。asar 取证：Plugin.registerBasesView 的**注销动作**挂在
 *      Component 的 `_events` 上（只有 load()/unload() 才会执行）；BasesView.registerView
 *      遇到同名 id **不覆盖**、只弹 `Unable to add new Bases view "<id>". A view with this ID already exists.`。
 *      旧实现只调 inst.onload()/inst.onunload() → deregisterView 永不执行 → 拨一次 ③ 的开关就撞名弹错。
 *   ② 第 5/6/7 条 —— 回滚不是「无法完成」就是「有文件没迁移整理」
 *      根因：重建/回滚期间 ② 的路由在抢文件（回滚刚把外来户 rename 进「回滚保留-<戳>/」，
 *      路由读到笔记的「文件位置」就把它搬回新库 → 目录仍旧非空 → 回滚 blocked）。
 *      修法：静默窗口 + 默认排除收容区 + 幂等搬运照样写可逆日志 + 空目录二次清理。
 *   ③ 第 8 条 —— 属性默认展开（看板卡片 + 就地编辑浮层）
 * ⚠️ 诚实声明：jsdom 桩的 await 链只走微任务，**复现不了真机那条「回滚中途被路由抢走」的时序**。
 *    所以这里走「机制级」证明（C 段：同一个 rename 事件，开/关闸门两组的落点差异），
 *    再加真机现场证据（实验库回滚报告里 from==to 的收容表 + 3 条 blocked）。
 *    真文件沙盒另有覆盖（.workbuddy/tmp/sandbox_r4b）。 */
const path = require("path");
const fs = require("fs");
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

const PLUG = path.join(__dirname, "..");
/* R17：三个自研插件已退役（归档 .workbuddy/backup/retired-plugins-2026-09-19/）。
 * 「与独立版原件对照」的断言：原地找不到 → 找归档（冻结基线）→ 都没有则 FAIL，不静默跳过。 */
const RETIRE_ARCHIVE = path.join(PLUG, "..", "..", "..", ".workbuddy", "backup", "retired-plugins-2026-09-19");
function legacyMain(name) {
  const live = path.join(PLUG, "..", name, "main.js");
  if (fs.existsSync(live)) return { path: live, where: "live" };
  const arch = path.join(RETIRE_ARCHIVE, name, "main.js");
  if (fs.existsSync(arch)) return { path: arch, where: "archive" };
  return null;
}
const PLUGINS = path.join(PLUG, "..");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = t => crypto.createHash("sha256").update(String(t), "utf8").digest("hex");
const read = p => fs.readFileSync(path.join(PLUG, p), "utf8");

/* 触发加载 + 拿到全局 KB（prelude 会把 KB 挂到 globalThis） */
require("../main.js");
const KB = globalThis.KB;
const P = KB.services;
const S = P.settings;
const D = S.DEFAULTS;
const KBROOT = D.paths.knowledgeBase;
const OBJ = "02_Areas/内容创作";

async function boot(app, modules, extra) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit", dir: ".obsidian/plugins/kb-toolkit" });
  plugin.data = Object.assign({ modules: modules, wizardDone: true }, extra || {});
  await plugin.onload();
  return plugin;
}
/** 让桩像真机一样在 rename/create 之后广播事件（自动化的入口就是这些事件） */
function wireEvents(app) {
  const rf = app.fileManager.renameFile.bind(app.fileManager);
  app.fileManager.renameFile = async (f, p) => { const r = await rf(f, p); app.vault.fire("rename", r); return r; };
  const cr = app.vault.create.bind(app.vault);
  app.vault.create = async (p, c) => { const f = await cr(p, c); app.vault.fire("create", f); return f; };
}

(async function main() {
  /* ================= A. 静默窗口服务（15_core_quiet.js） ================= */
  {
    const q = P.quiet;
    ok(!!q && typeof q.isQuiet === "function", "A：quiet 服务已注册");
    const box = {};
    eq(q.isQuiet(box), false, "A：没开窗时不静默");
    q.begin(box, "unit", 100);
    ok(q.isQuiet(box), "A：begin 后进入静默");
    const t0 = Date.now();
    ok(q.isQuiet(box, t0 + 50), "A：窗口内（+50ms）仍静默");
    ok(!q.isQuiet(box, t0 + 200), "A：过窗（+200ms）即放行（不靠定时器，可注入 now）");
    q.end(box);
    ok(q.isQuiet(box), "A：end() 把放行时刻往后推（收工余量）");
    q.clear(box);
    ok(!q.isQuiet(box), "A：clear() 立刻放行");
    ok(q.SETTLE_MS > P.eventBus.MAX_WAIT.changed,
      "A：关窗余量 SETTLE_MS(" + q.SETTLE_MS + "ms) > 事件总线封顶延时(" + P.eventBus.MAX_WAIT.changed + "ms)");
    const boom = {};
    q.begin(boom, "unit", 100);
    const r = q.guard(boom, () => "ran")();
    eq(r && r.skipped, true, "A：guard() 在静默期直接跳过");
    eq(q.state(boom).hits, 1, "A：跳过会计数（可诊断）");
    q.clear(boom);
  }

  /* ================= B. 事件总线的静默闸门 ================= */
  {
    STUB.VIRTUAL.clear();
    const app = STUB.makeApp();
    wireEvents(app);
    await app.vault.createFolder(KBROOT + "/" + OBJ);
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    const f = await app.vault.create(KBROOT + "/" + OBJ + "/x.md",
      "---\n文件位置: " + OBJ + "\n---\n\n# x\n");
    await sleep(300);
    eq(Object.keys(plugin.eventBus.pending).length, 0, "B：安静下来后队列为空（基线）");

    P.quiet.begin(plugin, "unit", 500);
    const hits0 = P.quiet.state(plugin).hits;
    app.vault.fire("rename", f);
    app.vault.fire("create", f);
    await sleep(60);
    eq(Object.keys(plugin.eventBus.pending).length, 0, "B1：静默期内事件一律不进队列");
    ok(P.quiet.state(plugin).hits > hits0, "B1：丢弃有计数（可诊断）");

    P.quiet.clear(plugin);
    app.vault.fire("create", f);
    await sleep(20);
    eq(Object.keys(plugin.eventBus.pending).length, 1, "B2：非静默时事件正常排队");
    P.quiet.begin(plugin, "unit", 500);
    await sleep(280);
    eq(Object.keys(plugin.eventBus.pending).length, 0, "B2：到点后被丢弃（dispatch 二次校验）");
    P.quiet.clear(plugin);
    await sleep(250);
  }

  /* ================= C. 自动化让路：真机那次「搬走又被搬回来」 ================= */
  {
    async function hostileMove(gatesOpen) {
      STUB.VIRTUAL.clear();
      const app = STUB.makeApp();
      wireEvents(app);
      await app.vault.createFolder(KBROOT + "/" + OBJ);
      const plugin = await boot(app, { automation: true, rebuild: false, base: false });
      /* 用「临时区」而不是收容区名，是为了**隔离变量**：这里只验静默闸门，不验排除规则。 */
      await app.vault.createFolder("临时区");
      const at = "临时区/x.md";
      const f = await app.vault.create(at, "---\n文件位置: " + OBJ + "\n---\n\n# x\n");
      /* 桩的 metadataCache 不解析正文 YAML：路由读的是 cache.frontmatter，得手工挂上，
       * 否则 resolveTarget 拿到空属性 → 永远不会搬（会把这个对照组验成假阴性）。 */
      f.cache = { frontmatter: { "文件位置": OBJ } };
      /* setup 用的 create 事件会先把文件按属性搬走（那就验不到 rename 那一刻了）→ 丢掉它。
       * 直接清 pending 计时器，不用 stop()/start()（那样会把 vault 监听器注册两遍）。 */
      for (const k in plugin.eventBus.pending) clearTimeout(plugin.eventBus.pending[k].timer);
      plugin.eventBus.pending = {};
      eq(!!app.vault.getAbstractFileByPath(at), true, "C-前置：丢弃 setup 的 create 事件后，笔记仍在原处");

      const orig = P.quiet.isQuiet;
      if (gatesOpen) P.quiet.isQuiet = () => false;      /* 对照组：还原 R9 之前的行为 */
      P.quiet.begin(plugin, "test", 800);
      /* R11 改线：rename 已改为「手动搬移」—— 属性跟随新目录、**永不回弹**（boss 第 1 条）。
       * 「搬回去」的通道只剩 changed（真机里 = 任何一次改动触发重路由），闸门要挡的就是它。 */
      app.metadataCache.fire("changed", f);
      await sleep(400);
      const stayed = app.vault.getAbstractFileByPath(at);
      const inLib = app.vault.getAbstractFileByPath(KBROOT + "/" + OBJ + "/x.md");
      P.quiet.isQuiet = orig;
      P.quiet.clear(plugin);
      return { stayedAt: stayed ? stayed.path : null, inLib: !!inLib };
    }
    const ctl = await hostileMove(true);
    eq(ctl.inLib, true, "C-对照（闸门关）：changed 事件按文件位置把笔记搬回知识库 —— 闸门要挡的就是它");
    const fix = await hostileMove(false);
    eq(fix.inLib, false, "C-修复（闸门开）：同一条 rename 事件被挡下，笔记不会被搬回去");
    eq(fix.stayedAt, "临时区/x.md", "C-修复：笔记原地不动");
  }

  /* ================= D. 排除规则：回滚收容区默认排除 ================= */
  {
    const EX = S.defaultExcluded(D.paths);
    ok(EX.indexOf("^" + D.rebuild.rollbackKeepName) >= 0, "D：默认排除规则含「回滚保留」");
    eq(S.defaultExcluded(D.paths, null).indexOf("^" + D.rebuild.rollbackKeepName), -1,
      "D：defaultExcluded(paths,null) 不生成收容区那条（用来识别旧默认值）");
    const legacy = S.defaultExcluded(D.paths, null);
    const up = S.normalize({ paths: JSON.parse(JSON.stringify(D.paths)), rebuild: { rootName: "x" },
      automation: { excluded: legacy.slice() } });
    eq(up.automation.excluded.length, 4, "D：旧版 3 条默认值 → normalize 就地升级成 4 条");
    ok(up.automation.excluded.indexOf("^" + D.rebuild.rollbackKeepName) >= 0, "D：升级后含收容区");
    const mine = ["^我自己的$"];
    const up2 = S.normalize({ paths: JSON.parse(JSON.stringify(D.paths)), rebuild: { rootName: "x" },
      automation: { excluded: mine.slice() } });
    eq(JSON.stringify(up2.automation.excluded), JSON.stringify(mine), "D：用户手改过的排除规则不被覆盖");
  }

  /* ================= E. 幂等搬运照样写可逆日志 + 全流程回滚能走完 ================= */
  {
    STUB.VIRTUAL.clear();
    const app = STUB.makeApp();
    wireEvents(app);
    const plugin = await boot(app, { rebuild: true, automation: true, base: false });
    const svc = new KB.services.rebuild(app);
    const cfg = plugin.settings.rebuild;
    const OLD = cfg.oldFolderName;
    const mod = new KB.modules.RebuildModule(plugin);

    /* ① 预览那一刻：顶层有两个待搬文件（旧文件区还不存在） */
    await app.vault.create("R7-试玩说明.md", "R7");
    await app.vault.create("R6-试玩说明.md", "R6");
    const plan = await svc.plan(cfg, { now: new Date(2026, 8, 17, 14, 0) });
    eq(plan.counts.moves, 2, "E：计划搬运 2 项（R7/R6）");
    eq(!!plan.manifest.keepRoot, false, "E：这是首次重建（不保留旧库）");

    /* ② 到了执行那一刻：这两个文件**已经在目标位**了（= 上一次执行搬过）→ 幂等重跑 */
    await app.vault.createFolder(OLD);
    await app.vault.create(OLD + "/R7-试玩说明.md", "R7");
    await app.vault.create(OLD + "/R6-试玩说明.md", "R6");
    await app.vault.delete(app.vault.getAbstractFileByPath("R7-试玩说明.md"));
    await app.vault.delete(app.vault.getAbstractFileByPath("R6-试玩说明.md"));

    const res = await svc.execute(plan.manifest, { cfg: cfg, saveJournal: function (j) { return mod.saveJournal(j); } });
    eq(res.status, "done", "E：执行完成");
    const jmoves = (res.journal.entries || []).filter(e => e.op === "move");
    eq(jmoves.length, 2, "E：两条「已在目标位」的幂等跳过**照样写进了可逆日志**（R9 修的第 5 条）");
    ok(jmoves.every(m => m.preexisting === true), "E：标记 preexisting=true（回滚据此搬回原位）");
    ok(jmoves.every(m => m.from && m.to && m.to === OLD + "/" + m.from.split("/").pop()),
      "E：from/to 记录完整正确");
    eq(res.skipped.filter(s => s.reversible === true).length, 2, "E：跳过清单里标记了可逆");

    /* ③ 往新库里放一篇「老板手写的笔记」，再回滚 —— 真机就是这一步把回滚卡住的 */
    const foreign = KBROOT + "/" + OBJ + "/未命名.md";
    await app.vault.createFolder(KBROOT + "/" + OBJ);
    const ff = await app.vault.create(foreign, "---\n文件位置: " + OBJ + "\n---\n\n# 未命名\n");
    ff.cache = { frontmatter: { "文件位置": OBJ } };   /* 桩不解析正文 YAML，手工挂上（见 C 段说明） */

    await app.vault.adapter.write(".obsidian/plugins/kb-toolkit/rebuild-manifest.json",
      JSON.stringify(plan.manifest));
    const rres = await mod.runRollback({ confirmed: true, cloudSynced: true, now: new Date(2026, 8, 17, 14, 13) });
    const quietInSettle = P.quiet.isQuiet(plugin);   /* 必须在 sleep 之前取：余量只有 SETTLE_MS */
    await sleep(1500);      /* 让关窗余量里的排队事件有机会落地（它们不该再动库） */

    eq(rres.blocked.length, 0, "E：回滚**零阻止**（不再出现「目录非空 → 保留」）");
    eq(rres.errors.length, 0, "E：回滚零错误");
    ok(!app.vault.getAbstractFileByPath(KBROOT), "E：新建根已被删干净（不再「新建根仍存在」）");
    ok(!!app.vault.getAbstractFileByPath("R7-试玩说明.md"), "E：R7-试玩说明.md 已搬回原位");
    ok(!!app.vault.getAbstractFileByPath("R6-试玩说明.md"), "E：R6-试玩说明.md 已搬回原位");
    eq(rres.verify.ok, true, "E：回滚自检通过（R9 修的第 5/7 条）");
    eq(rres.verify.bad.length, 0, "E：自检零缺件");
    const q = rres.quarantine || {};
    eq(q.moved.length, 1, "E：收容了 1 项（老板手写的那篇）");
    eq(q.moved[0].from, foreign, "E：收容记录里的「原位置」是**原位**（不是保留位置）—— R9 修的取值 bug");
    eq(q.moved[0].to, q.folder + "/" + foreign, "E：保留位置 = 收容区 + 原相对路径");
    ok(!!app.vault.getAbstractFileByPath(q.moved[0].to), "E：那篇笔记确实躺在收容区里（一篇没丢）");
    eq((rres.cleanup.removed || []).length + (rres.cleanup.kept || []).length, 0,
      "E：收尾扫描发现已无可补删（倒序撤销本身就干净）");
    eq(quietInSettle, true, "E：回滚收工后仍在关窗余量内（排队事件来不及作恶）");
    P.quiet.clear(plugin);
  }

  /* ================= E2. sweepEmptyDirs 单独验（补删「当场被卡住、事后已空」的目录） ================= */
  {
    STUB.VIRTUAL.clear();
    const app = STUB.makeApp();
    const svc = new KB.services.rebuild(app);
    await app.vault.createFolder("新库");
    await app.vault.createFolder("新库/子");
    const r = await svc.sweepEmptyDirs({ entries: [{ op: "mkdir", path: "新库" }, { op: "mkdir", path: "新库/子" }] });
    eq(r.removed.length, 2, "E2：空目录被补删（深→浅）");
    ok(!app.vault.getAbstractFileByPath("新库"), "E2：父目录也删掉了");
    await app.vault.createFolder("新库2");
    await app.vault.create("新库2/keep.md", "x");
    const r2 = await svc.sweepEmptyDirs({ entries: [{ op: "mkdir", path: "新库2" }] });
    eq(r2.removed.length, 0, "E2：非空目录绝不删");
    eq(r2.kept.length, 1, "E2：非空目录计入 kept（报告里如实写）");
    eq((await svc.sweepEmptyDirs({ entries: [{ op: "mkdirOld", path: "旧文件" }] })).removed.length, 0,
      "E2：不存在的目录直接跳过");
  }

  /* ================= F. 执行报告如实反映「计划 vs 真搬成」 ================= */
  {
    STUB.VIRTUAL.clear();
    const app = STUB.makeApp();
    const plugin = await boot(app, { rebuild: true, automation: false, base: false });
    const svc = new KB.services.rebuild(app);
    const cfg = plugin.settings.rebuild;
    const OLD = cfg.oldFolderName;
    await app.vault.create("R7-试玩说明.md", "R7");
    await app.vault.create("R6-试玩说明.md", "R6");
    const plan = await svc.plan(cfg, { now: new Date(2026, 8, 17, 14, 16) });
    await app.vault.createFolder(OLD);
    await app.vault.create(OLD + "/R7-试玩说明.md", "R7");
    await app.vault.create(OLD + "/R6-试玩说明.md", "R6");
    await app.vault.delete(app.vault.getAbstractFileByPath("R7-试玩说明.md"));
    await app.vault.delete(app.vault.getAbstractFileByPath("R6-试玩说明.md"));
    const res = await svc.execute(plan.manifest, { cfg: cfg, saveJournal: async () => {} });
    const md = svc.reportMarkdown("execute", { manifest: plan.manifest, result: res },
      { now: new Date(2026, 8, 17, 14, 16), paths: plugin.settings.paths, pluginDir: ".obsidian/plugins/kb-toolkit" }).markdown;
    ok(md.indexOf("真搬成 0") >= 0, "F：报告写明「本次真搬成 0 项」（不再把「计划」说成「已搬」）");
    ok(md.indexOf("## 2. 已在目标位（2）") >= 0, "F：单列「已在目标位」节并说明已记入可逆日志");
    ok(md.indexOf("## 3. 未搬成（0）") >= 0, "F：单列「未搬成」节（跳过 + 阻止）");
    ok(md.indexOf("计划搬运 | 2 项 |") < 0, "F：旧那句会误导的写法已消失");
    ok(md.indexOf("本次一项都没搬") >= 0, "F：计划有搬运项但一项没搬时，报告显式警示");
  }

  /* ================= G. 回滚报告：收容表两列不再相同 ================= */
  {
    const src = strip(read("src/66_services_report.js"));
    ok(src.indexOf("cell(m.from)") >= 0 && src.indexOf("cell(m.to)") >= 0,
      "G：收容表分别渲染「原位置 / 保留位置」两列");
    const svcSrc = strip(read("src/65_services_rebuild.js"));
    ok(/var fromPath = file\.path;/.test(svcSrc),
      "G：_quarantineMove 在 rename **之前**抄下原位路径（renameFile 会就地把 path 改成目标）");
  }

  /* ================= H. 第 3 条：视图注册幂等（拨开关不再弹「已存在同名视图」） ================= */
  {
    STUB.VIRTUAL.clear();
    const app = STUB.makeApp();
    const plugin = await boot(app, { base: true, "base.creationBoard": true, "base.noteStream": false,
      rebuild: false, automation: false });
    const bases = app.__bases;
    const VID = "creation-board";
    ok(!!bases.getRegistration(VID), "H：创作看板视图已注册到 Bases");
    eq(bases._errors.length, 0, "H：首轮注册无误（基线）");
    eq(plugin.registry.active.board.inst._loaded, true,
      "H：内嵌插件走的是 load()（_loaded=true）——旧实现只调 onload()，_loaded 恒 false");

    plugin.settings.modules["base.creationBoard"] = false;
    await KB.modules.applySettingsChange(plugin);
    eq(bases.getRegistration(VID), null, "H：关掉创作看板 → 视图注册被摘掉（deregisterView 真跑了）");
    eq(plugin.registry.active.board, undefined, "H：模块实例已停");

    plugin.settings.modules["base.creationBoard"] = true;
    await KB.modules.applySettingsChange(plugin);
    ok(!!bases.getRegistration(VID), "H：打开创作看板 → 视图重新注册成功");
    eq(bases._errors.length, 0, "H：**没有任何「已存在同名视图」报错**（老板报的第 3 条）");

    plugin.settings.modules["base.creationBoard"] = false;
    await KB.modules.applySettingsChange(plugin);
    plugin.settings.modules["base.creationBoard"] = true;
    await KB.modules.applySettingsChange(plugin);
    eq(bases._errors.length, 0, "H：连拨两轮仍然零报错（幂等）");
    eq(Object.keys(bases.registrations).length, 1, "H：注册表里始终只有一份");

    const bsrc = strip(read("src/85_modules_base.js"));
    ok(/loadInstance/.test(bsrc) && /inst\.load\(\)/.test(bsrc), "H：onEnable 走 load()");
    ok(/unloadInstance/.test(bsrc) && /inst\.unload\(\)/.test(bsrc), "H：onDisable 走 unload()（跑 disposer）");
    ok(/deregisterView/.test(bsrc), "H：注册前先 deregisterView 同名 id（双保险）");
  }

  /* ================= I. 第 8 条：属性默认展开 ================= */
  {
    const vend = read("vendor/creation-board.js");
    const lm = legacyMain("creation-board");
    ok(!!lm, "I：独立版看板原件可取得（原地或退役归档）");
    const orig = lm ? fs.readFileSync(lm.path, "utf8") : "";
    /* R11：看板 vendor 有意分叉 —— 新增 Alt+拖动搬文件（boss 第 3 条拍板） */
    ok(sha(vend) !== sha(orig), "I（R11）：vendor/creation-board.js 与独立插件已有意分叉（Alt 拖动）");
    ok(vend.indexOf("moveCardToFolderOfCard") >= 0 && vend.indexOf("evt.altKey") >= 0,
      "I：分叉内容 = R11 的 Alt 拖动实现（moveCardToFolderOfCard + drop altKey 分支）");
    ok(read("main.js").indexOf(vend) >= 0, "I：main.js 内嵌的看板字节 == vendor 原件");

    const vs = strip(vend);
    ok(/const K_PROS_OPEN = "属性默认展开"/.test(vs), "I：新增视图选项键「属性默认展开」");
    ok(/propsOpenDefault\(\)\s*\{\s*return this\.optBool\(K_PROS_OPEN, true\);/.test(vs),
      "I：propsOpenDefault() 默认 true（= 默认展开）");
    ok(/const open = dfltOpen \? !this\.prosToggledPaths\.has\(file\.path\) : this\.prosToggledPaths\.has\(file\.path\);/.test(vs),
      "I：卡片属性区按「与默认不同」记忆，默认展开");
    /* R24：「默认展开」升成了**两层**（板块级优先 → 视图默认）→ 这里改走 propsOpenOn。
       浮层拿的是 card.__cbSec；拿不到（比如从别处调）就回落视图默认，语义与旧版一致。 */
    ok(/!this\.editorProps && !this\.propsOpenOn\(card \? card\.__cbSec : null\)/.test(vs),
      "I（R24）：就地编辑浮层只在「默认展开」关掉时才替用户折叠（板块级优先，回落视图默认）");
    eq(/this\.prosOpenPaths/.test(vs), false, "I：旧的「只存展开集合」写法已彻底移除");

    const cbApp = STUB.makeApp();
    const CbPlugin = require(path.join(PLUG, "vendor", "creation-board.js"));
    const cb = new CbPlugin(cbApp, { id: "creation-board", dir: ".obsidian/plugins/creation-board",
      name: "创作看板（Bases 视图）", version: "0.1.0" });
    await cb.load();
    const reg = cbApp.__bases.getRegistration("creation-board");
    ok(!!reg && typeof reg.options === "function", "I：视图注册项带 options（原生面板据此出控件）");
    const opts = reg.options({ get: () => undefined });
    const pe = opts.filter(o => o.key === "属性默认展开")[0];
    /* R23（boss：加一个开关控制笔记的属性是否默认展开）：控件从原生视图选项面板
       挪进顶栏齿轮面板「看板行为」组 —— 键与语义一个没变，只是换了台面。 */
    eq(!!pe, false, "I（R23）：原生视图选项面板里不再有「属性默认展开」（已挪进顶栏面板）");
    ok(vs.indexOf('this.addToggle(behBox, K_PROS_OPEN, true, "属性默认展开"') >= 0,
      "I（R23）：顶栏面板「看板行为」组里出现了「属性默认展开」开关");
  }

  /* ================= J. 第 4 条：文件位置搬运能力与重建解耦（只开 ② 就能用） ================= */
  {
    STUB.VIRTUAL.clear();
    const app = STUB.makeApp();
    wireEvents(app);
    await app.vault.createFolder(KBROOT + "/00_Inbox");
    await app.vault.createFolder(KBROOT + "/" + OBJ);
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    const f = await app.vault.create(KBROOT + "/00_Inbox/随笔.md",
      "---\n文件位置: " + OBJ + "\n---\n\n# 随笔\n");
    f.cache = { frontmatter: { "文件位置": OBJ } };    /* 桩不解析正文 YAML，手工挂上（见 C 段说明） */
    await sleep(60);
    app.vault.fire("rename", f);
    await sleep(320);
    ok(!!app.vault.getAbstractFileByPath(KBROOT + "/" + OBJ + "/随笔.md"),
      "J：只开 ② 时，按「文件位置」也能把笔记搬进目标目录");
    eq(plugin.settings.automation.routes.length, S.REL_ROUTES.length, "J：路由表仍是完整一套（由相对表派生）");
    eq(P.quiet.isQuiet(plugin), false, "J：正常操作期间不静默（静默只属于重建/回滚）");
  }

  /* ================= K. R9：execute 继承上一份「未回滚」journal 的记录（去重合并） ================= */
  {
    STUB.VIRTUAL.clear();
    const app = STUB.makeApp();
    const plugin = await boot(app, { rebuild: true, automation: false, base: false });
    const svc = new KB.services.rebuild(app);
    const root = plugin.settings.paths.knowledgeBase;
    await app.vault.create("x.md", "X");
    const man = { version: 1, root: root, oldFolder: "旧文件",
      moves: [{ from: "x.md", to: "旧文件/x.md", type: "file", sha256: sha("X") }],
      creates: [], seeds: [] };
    /* 第一次执行中途失败留下的那份：已建旧文件区 + 已真搬 x.md（含完整 from/to） */
    const prev = { version: 1, root: root, oldFolder: "旧文件", status: "failed", log: [],
      failedAt: "move:b.md", error: "boom",
      entries: [{ op: "mkdirOld", path: "旧文件" },
        { op: "move", from: "x.md", to: "旧文件/x.md", kind: "file", sha256: sha("X"), at: "T1" }] };
    await app.vault.createFolder("旧文件");
    await app.fileManager.renameFile(app.vault.getAbstractFileByPath("x.md"), "旧文件/x.md");

    const r = await svc.execute(man, { cfg: plugin.settings.rebuild, carry: prev });
    eq(r.status, "done", "K：重跑执行完成");
    const ops = r.journal.entries.map(e => e.op + ":" + (e.path || e.from));
    eq(ops.filter(k => k === "mkdirOld:旧文件").length, 1, "K：mkdirOld 被继承且不重复");
    eq(ops.filter(k => k === "move:x.md").length, 1, "K：move:x.md 只有一条（去重；继承的先到为准）");
    ok(r.journal.entries.some(e => e.op === "move" && e.from === "x.md" && !e.preexisting),
      "K：保留的是继承来的**真搬**记录（from/to 完整 → 回滚搬得回来）");
    eq(r.skipped.filter(s => s.reversible === true).length, 1, "K：本次仍如实记为可逆跳过");

    /* 已回滚过的 journal 不许继承（否则会把已经还回去的记录再拿回来） */
    STUB.VIRTUAL.clear();
    const app2 = STUB.makeApp();
    const svc2 = new KB.services.rebuild(app2);
    await app2.vault.create("y.md", "Y");
    const r2 = await svc2.execute({ version: 1, root: root, oldFolder: "旧文件",
      moves: [{ from: "y.md", to: "旧文件/y.md", type: "file", sha256: sha("Y") }],
      creates: [], seeds: [] }, { cfg: plugin.settings.rebuild,
      carry: { version: 1, root: root, oldFolder: "旧文件", status: "rolled-back", log: [],
        entries: [{ op: "mkdirOld", path: "只存在于旧 journal 的目录" }] } });
    ok(!(r2.journal.entries || []).some(e => e.path === "只存在于旧 journal 的目录"),
      "K：已回滚过的 journal 不继承");

    /* 库根不一致的 journal 不许继承 */
    STUB.VIRTUAL.clear();
    const app3 = STUB.makeApp();
    const svc3 = new KB.services.rebuild(app3);
    await app3.vault.create("z.md", "Z");
    const r3 = await svc3.execute({ version: 1, root: root, oldFolder: "旧文件",
      moves: [{ from: "z.md", to: "旧文件/z.md", type: "file", sha256: sha("Z") }],
      creates: [], seeds: [] }, { cfg: plugin.settings.rebuild,
      carry: { version: 1, root: "别的库", oldFolder: "旧文件", status: "failed", log: [],
        entries: [{ op: "mkdirOld", path: "别的东西" }] } });
    ok(!(r3.journal.entries || []).some(e => e.path === "别的东西"), "K：库根不一致的 journal 不继承");
  }

  console.log("R9 断言: PASS " + pass + " / FAIL " + fail);
  if (fail) { console.log(fails.join("\n")); process.exit(1); }
})();
