/* kb-toolkit R8 断言：老板第三轮真机反馈（7 条）的修复证据。
 *   ① 创建补全提速 —— 事件总线自适应延时（180ms 起步 / 800ms 封顶）+ handler 串行
 *   ② 回滚时把「重建后才出现的文件」请进单独的收容文件夹，回滚照旧走完
 *   ③ 设置页输入框不再「一次只能打一个字符」（按键只记草稿，失焦 / 回车才落库）
 *   ④ 再次重建：已有库原地保留 + 并列新库 + 旧文件区「先前已有 / 本次移入」分代
 *   ⑤ 补全模板文件化 + 套用规则（标签优先 → 文件夹最长前缀 → 当前模板兜底）
 *   ⑥ 创作看板默认展示整个笔记库（把 excludeFolders 显式压成空串）
 *   ⑦ 一键补全（只读扫描 → 确认门槛 → 只加不删 → 报告落库 + 命令硬门控）
 * 期望值一律动态推算：库根 / 元目录 / 模板 id / 分代文件夹名都从 settings 与 DEFAULTS 现算，不写死。 */
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
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => sleep(20);
const sha = t => crypto.createHash("sha256").update(String(t), "utf8").digest("hex");

async function freshApp(dirs, files) {
  STUB.VIRTUAL.clear();
  const app = STUB.makeApp();
  for (const d of dirs) await app.vault.createFolder(d);
  for (const f of files) await app.vault.create(f.path, f.content);
  return app;
}
async function boot(app, modules, extra) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit" });
  plugin.data = Object.assign({ modules: modules, wizardDone: true }, extra || {});
  await plugin.onload();
  return plugin;
}
function findSetting(containerEl, name) {
  for (const el of containerEl.querySelectorAll("div")) if (el._setting && el._setting._name === name) return el._setting;
  return null;
}
function renderTab(plugin) {
  const tab = new KB.modules.SettingTab(plugin.app, plugin);
  tab.containerEl = dom.window.document.createElement("div");
  tab.display();
  return tab;
}
function kidsOf(app, folderPath) {
  if (folderPath === "/") return app.__root.children.map(c => c.name).sort().join(",");
  const f = app.vault.getAbstractFileByPath(folderPath);
  return f && f.children ? f.children.map(c => c.name).sort().join(",") : null;
}

/* ---- 虚拟文件树快照 / 报告剥离（与 run_r4b 同口径） ---- */
let META = "99_Meta";
const LOGFOLDER = "05_操作日志";
const isLogPath = k => k.indexOf("/" + META + "/" + LOGFOLDER + "/") >= 0;
function tree() {
  const out = {};
  for (const [k, v] of STUB.VIRTUAL.entries()) out[k] = v.children === undefined ? sha(v.content) : "<dir>";
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
/** 从树里剔掉「报告」与「收容区」（回滚场景里这两类是新出现的、且是被允许的） */
function coreOf(t, keepFolder) {
  const o = {};
  for (const k in t) {
    if (isLogPath(k)) continue;
    if (keepFolder && (k === keepFolder || k.indexOf(keepFolder + "/") === 0)) continue;
    o[k] = t[k];
  }
  return o;
}

(async function main() {
  const KBplugin = require("../main.js");
  const KB = globalThis.KB;
  const D = KB.services.settings.DEFAULTS;
  META = D.paths.metaDir;
  const KBR = D.paths.knowledgeBase;
  const src = {};
  for (const f of fs.readdirSync(path.join(PLUG, "src")).filter(f => f.endsWith(".js")).sort())
    src[f] = fs.readFileSync(path.join(PLUG, "src", f), "utf8");

  let app, plugin, tab;
  const manifestOf = a => a.vault.adapter._files.get(".obsidian/plugins/kb-toolkit/rebuild-manifest.json");

  /* ================= A. ① 创建补全提速 ================= */
  const EB = KB.services.eventBus;
  eq(EB.DEFAULT_DELAY.create, 180, "A：create 起步延时 180ms（旧版写死 800ms，体感就是「半秒到一秒」）");
  eq(EB.MAX_WAIT.create, 800, "A：create 累计封顶仍是 800ms（等得住 Templater）");
  eq(EB.DEFAULT_DELAY.changed, 180, "A：changed 同样自适应，不再一律 800ms");
  ok(!/STEP/.test(strip(src["20_core_eventbus.js"])), "A：旧的 STEP 固定步长已删（续期量改成事件自己的 delay）");

  app = await freshApp([".obsidian"], [{ path: "x.md", content: "" }, { path: "y.md", content: "" }, { path: "z.md", content: "" }]);
  plugin = await boot(app, { base: false });
  const bus = new KB.services.eventBus(plugin);
  const seen = [];
  bus.on((kind, file) => seen.push({ kind: kind, path: file.path, at: Date.now() }));

  /* A1 安静的新建：只有 create → 约 180ms 就派发 */
  const fx = app.vault.getAbstractFileByPath("x.md");
  let t0 = Date.now();
  bus.enqueue("create", fx);
  await sleep(400);
  eq(seen.length, 1, "A：只发 create → 只派发一次");
  eq(seen[0].kind, "create", "A：派发的种类是 create");
  const w1 = seen[0].at - t0;
  ok(w1 >= 150 && w1 < 500, "A：安静的新建 " + w1 + "ms 就派发（旧版恒等 800ms 起）");

  /* A2 热闹的新建：create 紧跟 changed → 续期，但仍早于 800ms，且 kind 仍是 create */
  const fy = app.vault.getAbstractFileByPath("y.md");
  seen.length = 0; t0 = Date.now();
  bus.enqueue("create", fy);
  await sleep(60);
  bus.enqueue("changed", fy);
  await sleep(500);
  eq(seen.length, 1, "A：create + changed 合并成一次派发");
  eq(seen[0].kind, "create", "A：changed 不会把 create 顶掉（R7 那个坑没回来）");
  const w2 = seen[0].at - t0;
  ok(w2 >= 200 && w2 < 800, "A：热闹的新建 " + w2 + "ms（确实续期等到 changed，但没退化成 800ms）");

  /* A3 续期封顶：连续来事件不会无限推迟 */
  const fz = app.vault.getAbstractFileByPath("z.md");
  seen.length = 0;
  for (let i = 0; i < 12; i++) { bus.enqueue("create", fz); await sleep(10); }
  const pend = bus.pending["z.md"];
  ok(!!pend && pend.delay <= EB.MAX_WAIT.create, "A：续期延时封顶在 MAX_WAIT（实测 " + (pend && pend.delay) + "ms）");
  await sleep(900);
  eq(seen.length, 1, "A：封顶之后一定会派发（不会无限推迟）");
  bus.stop();
  await plugin.onunload();

  /* A4 真链路：新建空白笔记 → 补全耗时（端到端，老板真正感受到的那个数） */
  app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/" + META + "/" + LOGFOLDER], []);
  plugin = await boot(app, { automation: true, base: false });
  const amod0 = plugin.registry.active.automation;
  const t1 = Date.now();
  const fnew = await app.vault.create(KBR + "/00_Inbox/未命名.md", "");
  app.vault.fire("create", fnew);
  app.metadataCache.fire("changed", fnew);      /* 真机顺序：create → metadataCache.changed */
  let ms = -1;
  for (let i = 0; i < 80; i++) { if (fnew.content && fnew.content.length > 0) { ms = Date.now() - t1; break; } await sleep(15); }
  ok(ms >= 0, "A：新建的空白笔记被补全（真链路）");
  ok(ms < 760, "A：端到端补全 " + ms + "ms < 760ms（旧版恒定从 800ms 起）");
  ok(fnew.content.indexOf("主题: 未命名") >= 0, "A：补的是正经模板内容（不是空写）");
  eq((fnew.content.match(/^---$/gm) || []).length, 2,
    "A：只写了一份前言（handler 串行之后，补全与路由不再各写一次）");
  ok(amod0.stats.filled >= 1, "A：模块自己记了账（filled ≥ 1）");
  await plugin.onunload();

  /* ================= B. ② 回滚隔离「重建后才出现的文件」 ================= */
  app = await freshApp([".obsidian", KBR, KBR + "/" + META + "/" + LOGFOLDER, D.paths.legacyDirs[0]],
    [{ path: D.paths.legacyDirs[0] + "/旧1.md", content: "旧内容1" }, { path: "散记.md", content: "顶层杂物" }]);
  plugin = await boot(app, { rebuild: true });
  let rmod = plugin.registry.active.rebuild;
  const beforeB = tree();
  await rmod.runPreview();
  const manB = JSON.parse(manifestOf(app));
  const newRoot = manB.root;
  eq((await rmod.runExecute({ confirmed: true, cloudSynced: true })).status, "done", "B：先正常重建一次");
  ok(app.vault.getAbstractFileByPath(newRoot + "/00_Inbox") !== null, "B：新库骨架就位（断言没空跑）");

  /* 老板在新库里又写了东西（重建之后才出现的）→ 回滚时不能丢、也不能卡住回滚 */
  await app.vault.createFolder(newRoot + "/我的画板");
  await app.vault.create(newRoot + "/我的画板/草图.md", "重建之后才写的");
  await app.vault.create(newRoot + "/00_Inbox/老板随手记.md", "重建之后随手记的");

  const rbB = await rmod.runRollback({ confirmed: true, cloudSynced: true });
  eq(rbB.ok, true, "B：回滚走完了（不再因为新库非空而半途而废）");
  eq(rbB.verify.ok, true, "B：回滚自检通过（sha256 + 无残留）");
  eq((rbB.blocked || []).length, 0, "B：没有一条被阻止（旧版这里必然卡在「新根非空」）");
  const qB = rbB.quarantine || {};
  eq((qB.moved || []).length, 2, "B：2 项外来户被请进收容区（1 个文件夹 + 1 篇笔记）");
  ok(String(qB.folder || "").indexOf(D.rebuild.rollbackKeepName + "-") === 0,
    "B：收容文件夹名 = <配置名>-<时间戳>（" + qB.folder + "）");
  eq(qB.errors.length, 0, "B：收容过程没有错误");
  const qMine = STUB.VIRTUAL.get(qB.folder + "/" + newRoot + "/我的画板/草图.md");
  ok(!!qMine && qMine.content === "重建之后才写的",
    "B：整个文件夹被收容 —— 老板的笔记一篇没丢，且保留原相对路径");
  const qLoose = STUB.VIRTUAL.get(qB.folder + "/" + newRoot + "/00_Inbox/老板随手记.md");
  ok(!!qLoose && qLoose.content === "重建之后随手记的", "B：新库子目录里的单篇也捞出来了（收容递归）");
  eq(app.vault.getAbstractFileByPath(newRoot + "/我的画板"), null, "B：外来文件夹已不在新库里（新库这才空得下来）");
  eq(app.vault.getAbstractFileByPath(newRoot + "/00_Inbox"), null, "B：本轮新建的目录被清干净");
  ok(app.vault.getAbstractFileByPath(KBR + "/" + META + "/" + LOGFOLDER) !== null,
    "B：原库的目录连同内容回到原位");
  eq(STUB.VIRTUAL.get("散记.md").content, "顶层杂物", "B：顶层杂物回到原位");
  eq(STUB.VIRTUAL.get(D.paths.legacyDirs[0] + "/旧1.md").content, "旧内容1", "B：旧库回到原位");
  const dB = treeDiff(coreOf(beforeB), coreOf(tree(), qB.folder));
  ok(dB === null, "B：除收容区与报告外，整棵树与执行前完全一致" + (dB ? " → " + dB : ""));
  await plugin.onunload();

  /* ================= C. ③ 输入框一次能打完整串 ================= */
  app = await freshApp([".obsidian", KBR], []);
  plugin = await boot(app, { automation: false, base: true });
  tab = renderTab(plugin);
  const kbSet = findSetting(tab.containerEl, "知识库根目录");
  ok(!!kbSet && !!kbSet._text, "C：找到「知识库根目录」输入框");
  const tC = kbSet._text;
  const wasC = plugin.settings.paths.knowledgeBase;
  for (const v of ["知", "知识", "知识库"]) { tC.typeFire(v); await tick(); }
  eq(plugin.settings.paths.knowledgeBase, wasC,
    "C：连敲 3 个字符期间一次都没落库（旧版每敲一下就重画整页 → 焦点丢 → 只进一个字符）");
  ok(findSetting(tab.containerEl, "知识库根目录")._text === tC,
    "C：输入框还是同一个元素（页面没被重画换掉）");
  tC.blurFire();
  await tick();
  eq(plugin.settings.paths.knowledgeBase, "知识库", "C：失焦才落库，且是完整字符串（不是最后一个字符）");

  tab = renderTab(plugin);
  const bsSet = findSetting(tab.containerEl, "排除目录");
  ok(!!bsSet && !!bsSet._text, "C：找到「排除目录」输入框（R18 起挪进「看板范围」栏）");
  for (const v of ["a", "ab", "abc"]) { bsSet._text.typeFire(v); await tick(); }
  eq(String(plugin.settings.modules["base.boardExclude"] || ""), "",
    "C：③ 组的输入框同样「按键期间不落库」（同一个 commitOnBlur）");
  bsSet._text.blurFire();
  await tick();
  eq(plugin.settings.modules["base.boardExclude"], "abc", "C：失焦落库 = abc（完整串，不是最后一个字符）");
  await plugin.onunload();

  /* ================= D. ④ 再次重建的分代归档 ================= */
  /* D1 首次重建（旧文件区不存在）→ 不分代，直接搬进「旧文件/」 */
  app = await freshApp([".obsidian", KBR, KBR + "/" + META + "/" + LOGFOLDER],
    [{ path: "散A.md", content: "首建待搬" }]);
  plugin = await boot(app, { rebuild: true });
  rmod = plugin.registry.active.rebuild;
  const pD1 = await rmod.runPreview();
  eq(pD1.reRebuild, false, "D1：旧文件区不存在 → 不是再次重建");
  eq(pD1.archive.prior, null, "D1：首建不建「先前已有」子文件夹");
  eq(pD1.archive.incoming, null, "D1：首建不建「本次移入」子文件夹");
  eq(pD1.moves.filter(m => m.from === "散A.md")[0].to, "旧文件/散A.md",
    "D1：搬运目标就是「旧文件/<原名>」（不分代）");
  await plugin.onunload();

  /* D2 再次重建（旧文件区有内容 + 已有知识库在顶层）→ 两个分代子文件夹，内容各就各位 */
  app = await freshApp([".obsidian", "旧文件", KBR, "杂项"],
    [{ path: "旧文件/先前.md", content: "上一轮归档" },
     { path: KBR + "/库内.md", content: "已有库的内容" },
     { path: "散A.md", content: "本次移入A" },
     { path: "散B.md", content: "本次移入B" },
     { path: "杂项/内.md", content: "本次移入（夹内）" }]);
  plugin = await boot(app, { rebuild: true });
  rmod = plugin.registry.active.rebuild;
  const pD2 = await rmod.runPreview();
  eq(pD2.reRebuild, true, "D2：旧文件区有内容 → 再次重建");
  eq(pD2.keepRoot, true, "D2：已有知识库原地保留（不搬走）");
  eq(pD2.root, KBR + "1", "D2：新库与已有库并列（编号命名，不撞车）");
  eq(pD2.counts.priorMoves, 1, "D2：「先前已有」1 项（旧文件区原有内容）");
  eq(pD2.counts.moves - pD2.counts.priorMoves, 3, "D2：本次要移入的顶层杂物 3 项（散A / 散B / 杂项）");
  const priorD = pD2.archive.prior, inD = pD2.archive.incoming;
  ok(priorD.indexOf("旧文件/") === 0 && inD.indexOf("旧文件/") === 0, "D2：两个分代子文件夹都在旧文件区之下");
  ok(priorD !== inD, "D2：装原有内容与装本次搬入是**两个**子文件夹");
  ok(pD2.moves.every(m => m.to.indexOf((m.archive === "prior" ? priorD : inD) + "/") === 0),
    "D2：每条搬运都进了对应的分代文件夹（一条不漏）");
  ok(!pD2.moves.some(m => m.from === KBR), "D2：已有知识库不在搬运清单里");
  ok(pD2.excluded.some(e => e.path === KBR && e.reason.indexOf("原地保留") > 0), "D2：明确记为「原地保留」");
  ok(pD2.excluded.some(e => e.path === "旧文件"), "D2：旧文件区本身不进搬运清单");

  const rD2 = await rmod.runExecute({ confirmed: true, cloudSynced: true });
  eq(rD2.status, "done", "D2：执行完成");
  eq(rD2.blocked.length, 0, "D2：没有一条被阻止");
  eq(kidsOf(app, "/"), [".obsidian", "旧文件", KBR, pD2.root].sort().join(","),
    "D2：顶层 = 系统目录 + 旧文件区 + 两个并列的库目录");
  eq(STUB.VIRTUAL.get(KBR + "/库内.md").content, "已有库的内容", "D2：已有库一个字没动");
  eq(kidsOf(app, "旧文件"), [priorD.split("/").pop(), inD.split("/").pop()].sort().join(","),
    "D2：旧文件区下正好两个分代子文件夹");
  eq(STUB.VIRTUAL.get(priorD + "/先前.md").content, "上一轮归档", "D2：上一轮内容进「先前已有」");
  eq(STUB.VIRTUAL.get(inD + "/散A.md").content, "本次移入A", "D2：散A 进「本次移入」");
  eq(STUB.VIRTUAL.get(inD + "/散B.md").content, "本次移入B", "D2：散B 进「本次移入」");
  eq(STUB.VIRTUAL.get(inD + "/杂项/内.md").content, "本次移入（夹内）", "D2：文件夹整搬进「本次移入」（子孙完好）");
  eq(app.vault.getAbstractFileByPath("散A.md"), null, "D2：顶层杂物已不在原位");
  await plugin.onunload();

  /* ================= E. ⑤ 模板文件化 + 套用规则（端到端） ================= */
  app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/01_Projects",
    KBR + "/02_Areas/游戏研究", KBR + "/" + META + "/" + LOGFOLDER], []);
  plugin = await boot(app, { automation: true, base: false });
  const S = plugin.settings, T = KB.services.templates;
  const tplDir = T.dirFor(S);
  eq(tplDir, KBR + "/" + META + "/02_模板库/Templater", "E：模板库目录由库根 + 元目录派生（无硬编码）");
  await T.writeFile(app, S, "通用套",
    "---\n主题: {{title}}\n通用: 是\n---\n\n# {{title}}\n\n## 关联笔记\n- 返回 [[{{moc}}]]\n");
  await T.writeFile(app, S, "游戏套",
    "---\n主题: {{title}}\n游戏: 是\n---\n\n# {{title}}\n\n游戏专用正文\n\n## 关联笔记\n- 返回 [[{{moc}}]]\n");
  T.invalidate();
  ok(!!STUB.VIRTUAL.get(tplDir + "/通用套.md"),
    "E：模板就是模板库里的 .md 文件（设置里改 / 在 Obsidian 里改，都是同一份）");
  S.automation.templateRules = [
    { id: "rule/1", kind: "folder", value: KBR + "/00_Inbox", templateId: T.idForName("通用套") },
    { id: "rule/2", kind: "tag", value: "游戏", templateId: T.idForName("游戏套") },
    { id: "rule/3", kind: "folder", value: KBR + "/02_Areas/游戏研究", templateId: T.idForName("游戏套") }
  ];
  T.setActive(S, T.DEFAULT_ID);        /* 当前模板 = 内置 → 命中一定来自规则，不是兜底 */
  const amod = plugin.registry.active.automation;
  amod.onConfigure();

  const newNote = async (rel, tags) => {
    const f = await app.vault.create(KBR + "/" + rel, "");
    if (tags) f.cache = { tags: tags.map(t => ({ tag: t })) };
    app.vault.fire("create", f);
    app.metadataCache.fire("changed", f);
    await sleep(400);
    return f;
  };
  const nA = await newNote("00_Inbox/甲的.md");
  eq(amod.lastFillTemplate, T.idForName("通用套"), "E：目录规则命中 → 用「通用套」（" + amod.lastFillWhy + "）");
  ok(String(amod.lastFillWhy).indexOf("目录") === 0, "E：why 说清是按目录命中的");
  ok(nA.content.indexOf("通用: 是") >= 0, "E：落进新笔记的正是那套模板的内容");
  ok(nA.content.indexOf("{{") < 0, "E：占位符全部渲染完（没留洞）");

  await newNote("02_Areas/游戏研究/乙.md", ["#游戏"]);
  eq(amod.lastFillTemplate, T.idForName("游戏套"), "E：标签规则命中「游戏套」");
  ok(String(amod.lastFillWhy).indexOf("标签") === 0, "E：标签优先于目录规则");

  await newNote("02_Areas/游戏研究/丙.md");
  eq(amod.lastFillTemplate, T.idForName("游戏套"), "E：没标签 → 目录规则生效")

  await newNote("01_Projects/戊.md");
  eq(amod.lastFillTemplate, T.DEFAULT_ID, "E：都不中 → 落回「当前模板」兜底");
  eq(amod.lastFillWhy, null, "E：兜底时不谎报规则");
  await plugin.onunload();

  /* ================= F. ⑥ 创作看板默认展示整个笔记库 ================= */
  eq(D.modules["base.boardExclude"], "", "F：默认排除目录 = 空串 = 整个笔记库（不再是自带默认）");
  const ownMainPath = legacyMain("creation-board");
  ok(!!ownMainPath, "F：独立版看板原件可取得（原地或退役归档）");
  const ownMain = ownMainPath ? fs.readFileSync(ownMainPath.path, "utf8") : "";
  ok(/excludeFolders:\s*"99_Meta"/.test(ownMain),
    "F：内嵌看板自带的默认确实是 99_Meta → 所以必须**显式写空串压掉它**（否则默认整个库落空）");
  const v85 = strip(src["85_modules_base.js"]);
  ok(/hasOwnProperty\.call\(d,\s*"excludeFolders"\)/.test(v85),
    "F：短路判据看「data.json 里有没有这个键」，不是「读出来的值等不等于」");

  app = await freshApp([".obsidian", KBR], []);
  plugin = await boot(app, { base: true });
  const bm = plugin.registry.active.board;
  ok(!!bm && typeof bm.applyBoardExclude === "function", "F：③ 模块提供「把排除目录推给内嵌看板」的入口");
  let d0 = await bm.inst.loadData();
  ok(!!d0 && Object.prototype.hasOwnProperty.call(d0, "excludeFolders"),
    "F：首次就把 excludeFolders 写进看板自己的 data.json（压掉它的 99_Meta 默认）");
  eq(d0.excludeFolders, "", "F：值为空串 → 不排除任何目录 = 展示整个笔记库");
  eq(await bm.onConfigure(), false, "F：值没变 → 不重复写盘（幂等）");
  plugin.settings.modules["base.boardExclude"] = KBR + "/" + META;
  eq(await bm.onConfigure(), true, "F：设置里填了排除目录 → 当场推给看板（不必重启插件）");
  d0 = await bm.inst.loadData();
  eq(d0.excludeFolders, KBR + "/" + META, "F：看板收到的就是设置里的那个值");
  await plugin.onunload();

  /* ================= G. ⑦ 一键补全 ================= */
  const gDir = KBR + "/00_Inbox";
  app = await freshApp([".obsidian", KBR, gDir, KBR + "/01_Projects", KBR + "/" + META + "/" + LOGFOLDER,
    KBR + "/" + META + "/02_模板库/Templater", D.paths.legacyDirs[0]],
    [{ path: KBR + "/00_Inbox/缺YAML有正文.md", content: "我写的一段正文。\n" },
     { path: KBR + "/00_Inbox/缺尾链.md", content: "---\n主题: 有前言\n---\n\n正文在此。\n" },
     { path: KBR + "/00_Inbox/全空.md", content: "" },
     { path: KBR + "/01_Projects/完整.md",
       content: "---\n主题: 完整\n---\n\n正文\n\n## 关联笔记\n- 返回 [[MOC_知识地图]]\n" },
     { path: KBR + "/" + META + "/02_模板库/Templater/模板不参与.md", content: "模板正文" },
     { path: D.paths.legacyDirs[0] + "/库外.md", content: "旧库里的笔记" }]);
  plugin = await boot(app, { automation: true, base: false });
  const amod2 = plugin.registry.active.automation;
  const gRoot = KBR + "/" + META + "/" + LOGFOLDER;
  const beforeG = tree();
  const scanG = await amod2.scanTodo();
  const hit = scanG.plan.map(p => p.path).sort();
  eq(hit.join("|"), [KBR + "/00_Inbox/缺YAML有正文.md", KBR + "/00_Inbox/缺尾链.md", KBR + "/00_Inbox/全空.md"].sort().join("|"),
    "G：扫描精确命中 3 篇（完整的、模板库里的、排除目录里的一律跳过）");
  eq(scanG.scanned, 6, "G：扫过 6 篇（统计口径 = 全库 .md）");
  const dry = await amod2.runAutofill({ confirmed: false });
  eq(dry.needConfirm, true, "G：未确认 → 只回清单，不动手");
  eq(treeDiff(beforeG, tree()), null, "G：只读预演一个字节都没写");

  const fullSha = sha(STUB.VIRTUAL.get(KBR + "/01_Projects/完整.md").content);
  const real = await amod2.runAutofill({ confirmed: true });
  eq(real.ok, true, "G：批量补全没有失败项");
  eq(real.written.length, 3, "G：3 篇被补");
  eq(real.errors.length, 0, "G：没有错误");
  const yNote = STUB.VIRTUAL.get(KBR + "/00_Inbox/缺YAML有正文.md");
  ok(/^---\n[\s\S]*?\n---\n/.test(yNote.content), "G：缺 YAML 的在**开头**补了完整前言");
  ok(/主题: 缺YAML有正文/.test(yNote.content), "G：前言里带上了本笔记的主题（占位符真渲染了）");
  ok(yNote.content.indexOf("我写的一段正文。") >= 0, "G：原有正文一个字符没动（只加不删）");
  ok(yNote.content.indexOf("## 关联笔记") > 0, "G：同时补了尾部双链");
  const lNote = STUB.VIRTUAL.get(KBR + "/00_Inbox/缺尾链.md");
  eq((lNote.content.match(/^---$/gm) || []).length, 2, "G：已有的前言不重复补（还是那一份）");
  ok(lNote.content.indexOf("主题: 有前言") >= 0 && lNote.content.indexOf("正文在此。") >= 0, "G：已有内容原样");
  ok(lNote.content.indexOf("## 关联笔记") > 0, "G：尾部双链补上");
  const eNote = STUB.VIRTUAL.get(KBR + "/00_Inbox/全空.md");
  ok(eNote.content.indexOf("主题: 全空") >= 0, "G：空笔记套整套模板（有主题）");
  ok(eNote.content.indexOf("## 关联笔记") > 0, "G：空笔记也补了尾部双链");
  eq(sha(STUB.VIRTUAL.get(KBR + "/01_Projects/完整.md").content), fullSha, "G：已经完整的笔记一字未改");
  eq(sha(STUB.VIRTUAL.get(KBR + "/" + META + "/02_模板库/Templater/模板不参与.md").content), sha("模板正文"),
    "G：模板库里的 .md 不参与补全");
  eq(sha(STUB.VIRTUAL.get(D.paths.legacyDirs[0] + "/库外.md").content), sha("旧库里的笔记"),
    "G：排除目录里的笔记不参与补全");
  const again = await amod2.runAutofill({ confirmed: true });
  eq(again.todo, 0, "G：补过之后再扫 → 0 篇待补（幂等）");
  eq(again.written.length, 0, "G：不重复写");

  /* 确认门槛 + 报告落库 + 命令硬门控 */
  const cmdG = plugin._commands.find(c => c.id === "autofill-scan");
  ok(!cmdG, "G：R13 起一键补全命令收进设置页按钮（命令面板不再重复入口）");
  await app.vault.create(gDir + "/再来一篇.md", "");
  const first = await amod2.startAutofill();
  eq(first.needConfirm, true, "G：startAutofill 先只读扫 → 要确认（不许静默批量改库）");
  ok(!!amod2.lastModal && amod2.lastModal.opened === true, "G：弹出确认框");
  ok(amod2.lastModal.contentEl.textContent.indexOf("确认补全") >= 0, "G：确认框有明确的确认按钮文案");
  ok(amod2.lastModal.contentEl.textContent.indexOf("再来一篇.md") >= 0, "G：确认框点名要动的笔记");
  const done = await amod2.lastModal.confirm();
  await tick();
  eq(done.written.length, 1, "G：确认后才真的写（1 篇）");
  ok(STUB.VIRTUAL.get(gDir + "/再来一篇.md").content.length > 0, "G：那篇真的被补上");
  ok(!!amod2.lastLogPath && amod2.lastLogPath.indexOf(gRoot + "/") === 0,
    "G：补全报告落进 <库根>/<元目录>/05_操作日志/（" + amod2.lastLogPath + "）");
  ok(amod2.lastLogPath.indexOf("一键补全") >= 0, "G：报告文件名标明是一键补全");
  ok(STUB.VIRTUAL.get(amod2.lastLogPath).content.indexOf("一键补全报告") >= 0, "G：报告标题正确");

  plugin.settings.modules.automation = false;
  await KB.modules.applySettingsChange(plugin);
  ok(!plugin.registry.active.automation, "G：关掉 ② → 模块当场停");
  ok((plugin.app.commands._removed || []).indexOf("kb-toolkit:autofill-scan") === -1,
    "G：R13 起没有这条命令可摘（入口在设置页：模块关 = 按钮置灰 + startAutofill 拒绝）");
  eq((await amod2.startAutofill()).reason, "module-off", "G：模块关掉后入口自己拒绝（残留回调也堵死）");
  await plugin.onunload();

  /* ================= H. 静态守卫（防以后又踩回去） ================= */
  const r80 = strip(src["80_modules_automation.js"]);
  ok(/this\.handler = async function/.test(r80) && /await self\.tryCreateFill\(file\)[\s\S]{0,80}await self\.handle\(file\)/.test(r80),
    "H：handler 串行 —— 先补全再路由（旧写法并行 → 白写一次 + 两处各写一遍前言）");
  ok(/scanTodo/.test(r80) && /runAutofill/.test(r80) && /reportAutofill/.test(r80),
    "H：一键补全三段（扫描 / 执行 / 报告）都在");
  ok(/opts\.confirmed !== true\)\s*\{\s*res\.needConfirm/.test(r80.replace(/\r/g, "")),
    "H：runAutofill 未确认只回清单（确认门槛写在代码里，不是靠 UI）");
  const r65 = strip(src["65_services_rebuild.js"]);
  ok(/quarantineForeign/.test(r65) && /_sweepForeign/.test(r65) && /_quarantineMove/.test(r65),
    "H：回滚收容三件套在");
  ok(/reRebuild/.test(r65) && /archivePriorName/.test(r65) && /archiveIncomingName/.test(r65),
    "H：再次重建的分代归档在（名字走配置，不写死）");
  ok(/mkdirMoveTarget/.test(r65), "H：执行时会补建搬运目标的父目录（分代子文件夹就靠这一步建出来）");
  const r75 = strip(src["75_core_settingTab.js"]);
  ok(/function commitOnBlur/.test(r75), "H：输入框统一走 commitOnBlur");
  ok(/一键补全/.test(r75) && /模板库/.test(r75) && /套用规则/.test(r75), "H：设置页里三条都在");
  const r85 = strip(src["85_modules_base.js"]);
  ok(/applyBoardExclude/.test(r85) && /onConfigure/.test(r85), "H：③ 模块提供 onConfigure 推送（配置一变就地重配）");
  ok(/base\.boardExclude/.test(strip(src["70_core_settings.js"])), "H：boardExclude 默认值只在这里声明");
  ok(!/01_新知识库|02_旧知识库|99_Meta\s*\//.test(r75 + src["76_core_settingModals.js"] + src["80_modules_automation.js"] + src["85_modules_base.js"] + src["36_services_templates.js"]),
    "H：R8 新代码没引入顶层路径字面量（路径字面量只许在 70_core_settings.js）");
  const r20 = strip(src["20_core_eventbus.js"]);
  ok(/MAX_WAIT/.test(r20) && /capFor/.test(r20), "H：延时封顶机制在（capFor）");

  /* ================= I. vendor 字节等价（铁律 2） ================= */
  const mainTxt = fs.readFileSync(path.join(PLUG, "main.js"), "utf8");
  for (const [vfile, plugdir] of [["creation-board.js", "creation-board"], ["bases-preview.js", "bases-preview"]]) {
    const vend = fs.readFileSync(path.join(PLUG, "vendor", vfile), "utf8");
    ok(mainTxt.indexOf(vend) >= 0, "I：main.js 里的 " + vfile + " 与 vendor/ 字节等价（内嵌未动）");
    const lm = legacyMain(plugdir);
    ok(!!lm, "I：独立版 " + plugdir + " 原件可取得（原地或退役归档）");
    const orig = lm ? fs.readFileSync(lm.path, "utf8") : "";
    if (vfile === "creation-board.js") {
      /* R11：看板 vendor 有意分叉 —— 新增 Alt+拖动搬文件（boss 第 3 条拍板） */
      ok(sha(vend) !== sha(orig), "I（R11）：vendor/creation-board.js 与旧插件已有意分叉（Alt 拖动）");
      ok(vend.indexOf("moveCardToFolderOfCard") >= 0, "I：分叉内容 = R11 的 Alt 拖动实现");
    } else {
      /* R14：内容流 vendor 也**有意分叉** —— 徽章上限 2 个（boss：紧凑密度拍板） */
      ok(sha(vend) !== sha(orig), "I（R14）：vendor/bases-preview.js 与旧插件已有意分叉（徽章上限）");
      ok(vend.indexOf("bns-chip-more") >= 0, "I：分叉内容 = R14 的徽章上限实现");
    }
  }

  /* ================= J. 文档（本轮不 bump 版本号） ================= */
  const man = JSON.parse(fs.readFileSync(path.join(PLUG, "manifest.json"), "utf8"));
  eq(man.version, "1.0.0", "J：非收尾轮不动版本号");
  const chg = fs.readFileSync(path.join(PLUG, "CHANGELOG.md"), "utf8");
  ok(/R8/.test(chg), "J：CHANGELOG 记下 R8 的改动");

  console.log("R8 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exitCode = 2; });
