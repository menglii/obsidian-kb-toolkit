/* kb-toolkit R3 离线断言：字节级内嵌等价 + VIEW_TYPE 原样 + ③级联 + 开新停旧。
 * 关键证明：从 main.js 抽回内嵌字节 == vendor 原件 == 旧插件 main.js，则旧 729 断言套件的结论对内嵌副本同样成立。 */
const fs = require("fs");
const path = require("path");
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

const ROOT = path.join(__dirname, "..");
const PLUGINS = path.join(ROOT, "..");
/* R17：三个自研插件已退役（归档在 .workbuddy/backup/retired-plugins-2026-09-19/）。
 * 与「独立版原件」做字节对照的断言改成：先在原地找 → 找不到找归档（冻结基线）→
 * 两处都没有才跳过（跳过会显式报 FAIL，不静默假绿）。 */
const RETIRE_ARCHIVE = path.join(PLUGINS, "..", "..", ".workbuddy", "backup", "retired-plugins-2026-09-19");
function legacyMain(name) {
  const live = path.join(PLUGINS, name, "main.js");
  if (fs.existsSync(live)) return { path: live, where: "live" };
  const arch = path.join(RETIRE_ARCHIVE, name, "main.js");
  if (fs.existsSync(arch)) return { path: arch, where: "archive" };
  return null;
}

(async function main() {
  /* 1. 字节级等价：内嵌段抽回 == vendor == 旧插件原件 */
  const bundle = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  for (const [name, vendorFile, legacyName] of [
    ["CreationBoardPlugin", "creation-board.js", "creation-board"],
    ["BasesPreviewPlugin", "bases-preview.js", "bases-preview"]
  ]) {
    const begin = "/* ===== KB-EMBED:" + name + " BEGIN";
    const end = "/* ===== KB-EMBED:" + name + " END ===== */";
    const i = bundle.indexOf(begin), j = bundle.indexOf(end);
    ok(i >= 0 && j > i, name + " 内嵌标记存在");
    const seg = bundle.slice(i, j);
    const prefix = "var module = { exports: {} };\n";
    const head = seg.indexOf(prefix);
    const tailMark = "\nKB.modules." + name + " = module.exports;";
    const tail = seg.lastIndexOf(tailMark);
    ok(head >= 0 && tail > head, name + " 内嵌段包裹结构完整");
    const extracted = seg.slice(head + prefix.length, tail);
    const vendor = fs.readFileSync(path.join(ROOT, "vendor", vendorFile), "utf8");
    const lm = legacyMain(legacyName);
    ok(!!lm, name + " 独立版原件可取得（原地或归档 " + RETIRE_ARCHIVE + "）");
    const orig = lm ? fs.readFileSync(lm.path, "utf8") : "";
    ok(extracted === vendor, name + " 内嵌字节 == vendor");
    if (name === "CreationBoardPlugin") {
      /* R11：看板 vendor 有意分叉 —— 新增 Alt+拖动搬文件（boss 第 3 条拍板） */
      ok(lm && vendor !== orig, name + " vendor 与旧插件 main.js 已有意分叉（R11 Alt 拖动）");
      ok(vendor.indexOf("moveCardToFolderOfCard") >= 0, name + " vendor 含 R11 Alt 拖动实现");
    } else {
      /* R14：内容流 vendor 也**有意分叉** —— 徽章上限 2 个（boss：界面很丑 · 紧凑密度拍板） */
      ok(lm && vendor !== orig, name + " vendor 与旧插件 main.js 已有意分叉（R14 徽章上限）");
      ok(vendor.indexOf("bns-chip-more") >= 0, name + " vendor 含 R14 徽章上限实现");
    }
  }

  /* 2. VIEW_TYPE 原样（源码级断言：剥注释后匹配，照方抓药 m 标志） */
  const cb = fs.readFileSync(path.join(ROOT, "vendor", "creation-board.js"), "utf8");
  const bp = fs.readFileSync(path.join(ROOT, "vendor", "bases-preview.js"), "utf8");
  ok(/const VIEW_TYPE = "creation-board"/.test(cb), "creation-board VIEW_TYPE 原样");
  ok(/const VIEW_TYPE = "note-stream"/.test(bp), "note-stream VIEW_TYPE 原样");

  /* 3. 加载 + ③ 全开 → 两视图注册、旧插件停用 */
  const KBplugin = require("../main.js");
  const app = STUB.makeApp();
  app.plugins.enabledPlugins.add("creation-board");
  app.plugins.enabledPlugins.add("bases-preview");
  const plugin = new KBplugin(app, { id: "kb-toolkit" });
  plugin.data = { modules: { base: true } };   /* automation 默认关，聚焦 ③ */
  await plugin.onload();

  const board = plugin.registry.active.board, stream = plugin.registry.active.stream;
  ok(!!board && !!stream, "③ 开 → board/stream 都启用");
  ok(!!board.inst && !!stream.inst, "内嵌插件已实例化");
  const views = [].concat(board.inst._basesViews, stream.inst._basesViews);
  eq(views.map(v => v.id).sort().join(","), "creation-board,note-stream", "两个 VIEW_TYPE 原样注册");
  ok(typeof views.find(v => v.id === "creation-board").def.factory === "function", "看板 factory 就位");
  ok(typeof views.find(v => v.id === "note-stream").def.factory === "function", "内容流 factory 就位");
  ok(app.__disabled.indexOf("creation-board") >= 0, "旧 creation-board 已自动停用");
  ok(app.__disabled.indexOf("bases-preview") >= 0, "旧 bases-preview 已自动停用");

  /* 4. ③ 总闸关 → 两视图都不注册 */
  await plugin.onunload();
  const app2 = STUB.makeApp();
  const plugin2 = new KBplugin(app2, { id: "kb-toolkit" });
  plugin2.data = { modules: { base: false } };
  await plugin2.onload();
  ok(!plugin2.registry.active.board && !plugin2.registry.active.stream, "③ 关 → 不注册");

  /* 5. 子开关单独控制 */
  await plugin2.onunload();
  const app3 = STUB.makeApp();
  const plugin3 = new KBplugin(app3, { id: "kb-toolkit" });
  plugin3.data = { modules: { base: true, "base.noteStream": false } };
  await plugin3.onload();
  ok(!!plugin3.registry.active.board && !plugin3.registry.active.stream, "子开关：board 开 / stream 关");
  await plugin3.onunload();

  /* 6. automation 关闭时 ③ 模块启用不误停 note-locator（retire 范围隔离） */
  const app4 = STUB.makeApp();
  app4.plugins.enabledPlugins.add("note-locator");
  const plugin4 = new KBplugin(app4, { id: "kb-toolkit" });
  plugin4.data = { modules: { base: true, automation: false } };
  await plugin4.onload();
  ok(app4.__disabled.indexOf("note-locator") === -1, "automation 关 → note-locator 不被动");
  await plugin4.onunload();

  /* 7. styles.css 已合并全部样式源（R13 起动态枚举 styles_src/*.css） */
  const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  const styleNames = fs.readdirSync(path.join(ROOT, "styles_src")).filter(f => f.endsWith(".css")).sort();
  ok(styleNames.every(f => styles.indexOf(f) >= 0), "styles 头注释标注全部样式源（" + styleNames.join("+") + "）");
  ok(styles.length > 20000, "styles 体量正常（" + styles.length + " 字符）");

  console.log("R3 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exit(2); });
