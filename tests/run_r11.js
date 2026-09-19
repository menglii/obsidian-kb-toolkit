/* kb-toolkit R11 断言：老板第六轮 4 条的修复证据。
 *   ① 第 1 条 —— 目录里拖动笔记拖不动：根因 = rename 事件也被喂给路由 handle()，
 *      属性还写着旧目录 → 拖完立刻被搬回原位。
 *      修法 = rename 走「手动搬移」handleManualMove（属性跟随新目录，永不回弹）
 *      + 路由改「属性优先」（镜像属性不再让位 tags）。
 *   ③ 第 3 条 —— 看板 Alt+拖动搬文件（boss 拍板方案）在 r3/r8/r9 的 vendor 断言里验。
 *   ② 第 2 条 —— 设置页不自动收起（置灰禁用）在 r6/r7/r10 的段落断言里验。
 * 期望值一律动态推算，不写死。 */
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
const D = KB.services.settings.DEFAULTS;
const ROOT = D.paths.knowledgeBase;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(app, modules, extra) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit", dir: ".obsidian/plugins/kb-toolkit" });
  plugin.data = Object.assign({ modules: modules, wizardDone: true }, extra || {});
  await plugin.onload();
  return plugin;
}
/** 丢掉 setup 期间排进总线的事件（不然 create 会先跑一遍，验不到目标场景） */
function dropPending(plugin) {
  for (const k in plugin.eventBus.pending) clearTimeout(plugin.eventBus.pending[k].timer);
  plugin.eventBus.pending = {};
}

(async function main() {
  /* ================= A. 事件总线：rename 的 oldPath 要透传到处理端 ================= */
  {
    const app = STUB.makeApp();
    await app.vault.createFolder(ROOT + "/00_Inbox");
    const f = await app.vault.create(ROOT + "/00_Inbox/a.md", "# a\n");
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    dropPending(plugin);
    let seen = null;
    plugin.eventBus.on(function (kind, file, oldPath) { seen = { kind, oldPath }; });
    /* 桩的 fire 只带 file；真机 vault.on("rename", (f, oldPath) => …) 会带第二个参数 ——
     * 直呼事件总线注册进 vault 的那个回调，模拟真机签名。 */
    const vaultRenameCb = app.vault._handlers.rename[app.vault._handlers.rename.length - 1];
    vaultRenameCb(f, ROOT + "/01_Projects/a.md");
    await sleep(120);
    eq(seen && seen.kind, "rename", "A1：rename 事件派发到处理端");
    eq(seen && seen.oldPath, ROOT + "/01_Projects/a.md", "A2：oldPath 原样透传（手动拖动的判据）");
    await plugin.onunload();
  }

  /* ================= B. 库根内拖动：属性跟随新目录，文件绝不回弹 ================= */
  {
    const app = STUB.makeApp();
    await app.vault.createFolder(ROOT + "/00_Inbox");
    await app.vault.createFolder(ROOT + "/01_Projects/01_执行中");
    const f = await app.vault.create(ROOT + "/01_Projects/01_执行中/a.md", "# a\n");
    f.cache = { frontmatter: { "文件位置": ["01_Projects/01_执行中"] } };
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    dropPending(plugin);
    /* 老板的动作：把 a.md 拖进 00_Inbox（fileManager.renameFile = 真机拖动落盘） */
    await app.fileManager.renameFile(f, ROOT + "/00_Inbox/a.md");
    app.vault.fire("rename", f);
    await sleep(300);
    ok(!!app.vault.getAbstractFileByPath(ROOT + "/00_Inbox/a.md"), "B1：拖到哪就留在哪（不回弹）");
    ok(!app.vault.getAbstractFileByPath(ROOT + "/01_Projects/01_执行中/a.md"), "B2：原位置不再有这份文件");
    eq(JSON.stringify(f.fm && f.fm["文件位置"]), JSON.stringify(["00_Inbox"]),
      "B3：「文件位置」自动同步成新目录（属性跟随人的意图）");
    await plugin.onunload();
  }

  /* ================= C. 拖出库根：不写属性、更不搬回 ================= */
  {
    const app = STUB.makeApp();
    await app.vault.createFolder(ROOT + "/01_Projects/01_执行中");
    await app.vault.createFolder("旧文件");
    const f = await app.vault.create(ROOT + "/01_Projects/01_执行中/b.md", "# b\n");
    f.cache = { frontmatter: { "文件位置": ["01_Projects/01_执行中"] } };
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    dropPending(plugin);
    await app.fileManager.renameFile(f, "旧文件/b.md");
    app.vault.fire("rename", f);
    await sleep(300);
    ok(!!app.vault.getAbstractFileByPath("旧文件/b.md"), "C1：拖出库根 → 留在外面");
    eq(f.fm && f.fm["文件位置"], undefined, "C2：库根外不回写属性（不污染）");
    ok(!app.vault.getAbstractFileByPath(ROOT + "/01_Projects/01_执行中/b.md"), "C3：也没被搬回去");
    await plugin.onunload();
  }

  /* ================= D. 位置锁定的笔记：拖动也一根手指不动 ================= */
  {
    const app = STUB.makeApp();
    await app.vault.createFolder(ROOT + "/00_Inbox");
    await app.vault.createFolder(ROOT + "/01_Projects/01_执行中");
    const f = await app.vault.create(ROOT + "/01_Projects/01_执行中/c.md", "# c\n");
    f.cache = { frontmatter: { "文件位置": ["01_Projects/01_执行中"], "位置锁定": true } };
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    dropPending(plugin);
    await app.fileManager.renameFile(f, ROOT + "/00_Inbox/c.md");
    app.vault.fire("rename", f);
    await sleep(300);
    eq(f.fm && f.fm["文件位置"], undefined, "D1：锁定 → 属性不被回写");
    await plugin.onunload();
  }

  /* ================= E. changed 通道照旧自动归位（回归守卫） ================= */
  {
    const app = STUB.makeApp();
    await app.vault.createFolder(ROOT + "/00_Inbox");
    await app.vault.createFolder(ROOT + "/04_Archives");
    const f = await app.vault.create(ROOT + "/00_Inbox/e.md", "# e\n");
    /* 桩的 getAllTags 读 cache.tags（真机里由 metadataCache 从正文/前言汇总） */
    f.cache = { tags: ["归档"] };
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    dropPending(plugin);
    app.metadataCache.fire("changed", f);
    await sleep(400);
    ok(!!app.vault.getAbstractFileByPath(ROOT + "/04_Archives/e.md"), "E1：属性为空 + 标签命中 → 照旧自动归位");
    eq(JSON.stringify(f.fm && f.fm["文件位置"]), JSON.stringify(["04_Archives"]), "E2：归位后属性照旧回填");
    await plugin.onunload();
  }

  /* ================= F. 属性镜像 + 路由标签 → 不再让位 tags（新语义核心） ================= */
  {
    const app = STUB.makeApp();
    await app.vault.createFolder(ROOT + "/00_Inbox");
    await app.vault.createFolder(ROOT + "/04_Archives");
    const f = await app.vault.create(ROOT + "/00_Inbox/f.md", "# f\n");
    f.cache = { frontmatter: { "文件位置": ["00_Inbox"] }, tags: ["归档"] };
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    dropPending(plugin);
    app.metadataCache.fire("changed", f);
    await sleep(400);
    ok(!!app.vault.getAbstractFileByPath(ROOT + "/00_Inbox/f.md"), "F1：属性说它在 00_Inbox → 就留在 00_Inbox（旧镜像规则会被标签拖走）");
    ok(!app.vault.getAbstractFileByPath(ROOT + "/04_Archives/f.md"), "F2：没有被标签搬去归档");
    await plugin.onunload();
  }

  /* ================= G. 属性指向别处 → 属性优先（手动改下拉 = 立刻搬家） ================= */
  {
    const app = STUB.makeApp();
    await app.vault.createFolder(ROOT + "/00_Inbox");
    await app.vault.createFolder(ROOT + "/02_Areas/游戏研究");
    const f = await app.vault.create(ROOT + "/00_Inbox/g.md", "# g\n");
    f.cache = { frontmatter: { "文件位置": ["02_Areas/游戏研究"] } };
    const plugin = await boot(app, { automation: true, rebuild: false, base: false });
    dropPending(plugin);
    app.metadataCache.fire("changed", f);
    await sleep(400);
    ok(!!app.vault.getAbstractFileByPath(ROOT + "/02_Areas/游戏研究/g.md"), "G1：属性指向别处 → 按属性搬（R10-① 下拉改位置的通路）");
    await plugin.onunload();
  }

  console.log("\nR11 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
})().catch(e => { console.error("FATAL", e); process.exit(2); });
