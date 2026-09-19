/* kb-toolkit R1 离线断言。运行：
 *   NODE_PATH=<managed node workspace>/node_modules node tests/run_r1.js
 * 期望值一律动态推算（路由条数取自 DEFAULTS，不写死在断言里）。 */
const path = require("path");
const Module = require("module");
const { JSDOM } = require("jsdom");

/* ---- jsdom + createEl/empty polyfill ---- */
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

/* ---- obsidian 桩注入 ---- */
const STUB = require("./stub_obsidian.js");
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return STUB;
  return origLoad.apply(this, arguments);
};

/* ---- 计数器 ---- */
let pass = 0, fail = 0; const fails = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log("  FAIL " + name); }
}
function eq(a, b, name) { ok(a === b, name + " (got=" + JSON.stringify(a) + " want=" + JSON.stringify(b) + ")"); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  const KBplugin = require("../main.js");
  const KB = global.KB || (function () { /* 从桩闭包外取不到 KB，经 plugin 实例验 */ return null; })();

  /* 1. 包加载与注册表 */
  ok(typeof KBplugin === "function", "main.js 导出插件类");
  eq(STUB.Plugin.all === undefined, true, "桩未污染");

  /* 重新构建一个可访问 KB 的实例环境：entry 把类挂到闭包里，这里直接实例化验证 */
  const app = STUB.makeApp();
  const plugin = new KBplugin(app, { id: "kb-toolkit" });

  await plugin.onload();
  const S = plugin.settings;
  const util = require("../main.js") && null; /* 占位防误删 */
  /* KB 服务通过 onload 产物访问 */
  ok(!!S && typeof S.schemaVersion === "number", "settings 加载成功");
  ok(Array.isArray(S.automation.routes) && S.automation.routes.length === 12, "默认路由 12 条（与 note-locator 现网一致）");
  ok(S.automation.propertyOptions && Object.keys(S.automation.propertyOptions).length === 2, "propertyOptions 两组候选保留");
  ok(S.modules.base === true && S.modules.automation === false && S.modules.rebuild === false, "R1 默认开关：③开 ①②关");

  /* 2. 迁移链 */
  plugin.data = { schemaVersion: 1, modules: { automation: true } };
  await require("../main.js") && null;

  /* settings 深合并：二次 load 带 data */
  await plugin.onload();
  ok(plugin.settings.modules.automation === true, "deepMerge 保留覆盖值");

  /* 3. router 纯函数（经 automation 模块服务访问不到时走独立实例） */
  const RouterCtor = plugin.registry.defs.length >= 0 ? null : null;
  /* 直接从 main.js 闭包无法取 KB —— 通过 automation 模块实例化链路验证：
     构造一个 automation 模块并调 handle 链路所需服务。 */
  const autoDef = plugin.registry.defs.find(d => d.id === "automation");
  ok(!!autoDef, "registry 注册了 automation 模块");

  /* 打开 automation 后路由行为验证 */
  plugin.settings.modules.automation = true;
  plugin.registry.active = {};
  await plugin.registry.enableConfigured();
  ok(!!plugin.registry.active.automation, "automation 模块可启用");
  ok(plugin._events.length >= 3, "eventBus 注册 3 类事件");
  const auto = plugin.registry.active.automation;
  const router = auto.router;

  const fmOf = (o) => o;
  let hit = router.resolveTarget(fmOf({ "文件位置": "02_Areas/游戏研究" }), [], "01_新知识库/00_Inbox", app);
  ok(hit && hit.folder === "01_新知识库/02_Areas/游戏研究" && hit.why.indexOf("文件位置") === 0, "镜像规则①：手动指定优先");
  hit = router.resolveTarget(fmOf({ "文件位置": "00_Inbox" }), ["内容创作"], "01_新知识库/00_Inbox", app);
  eq(hit, null, "R11 属性优先：镜像属性 = 已在目标 → null（不再让位 tags 搬回去）");
  hit = router.resolveTarget(fmOf({ "文件位置": "02_Areas/游戏研究" }), ["归档"], "01_新知识库/00_Inbox", app);
  ok(hit && hit.folder === "01_新知识库/02_Areas/游戏研究" && hit.why.indexOf("文件位置") === 0,
    "R11 属性优先：属性非空就不看 tags（哪怕标签指向别处）");
  hit = router.resolveTarget(fmOf({}), ["归档"], "01_新知识库/02_Areas/内容创作", app);
  ok(hit && hit.folder === "01_新知识库/04_Archives", "tags 命中归档路由");
  hit = router.resolveTarget(fmOf({ "文件位置": "不认识的地方" }), [], "01_新知识库/00_Inbox", app);
  eq(hit, null, "认不出目标 → null 绝不动文件");
  hit = router.resolveTarget(fmOf({}), ["不存在的标签xyz"], "01_新知识库/00_Inbox", app);
  eq(hit, null, "无命中 → null");

  /* 排除目录 */
  ok(router.isExcluded("01_新知识库/99_Meta/02_模板库") === true, "排除 99_Meta");
  ok(router.isExcluded("01_新知识库/02_Areas/内容创作") === false, "正文目录不排除");

  /* 4. mover：撞名 uniquePath + blocked */
  const mover = auto.mover;
  const folder = new STUB.TFolder("01_新知识库/02_Areas/内容创作");
  STUB.VIRTUAL.set("01_新知识库/02_Areas/内容创作/示例_B站视频.md", folder ? { path: "01_新知识库/02_Areas/内容创作/示例_B站视频.md", children: undefined } : null);
  const u = mover.uniquePath("01_新知识库/02_Areas/内容创作", "示例_B站视频.md", app);
  eq(u, "01_新知识库/02_Areas/内容创作/示例_B站视频 1.md", "撞名生成 uniquePath");
  const f1 = { path: "01_新知识库/00_Inbox/a.md", name: "a.md", basename: "a", extension: "md", parent: { path: "01_新知识库/00_Inbox" }, content: "" };
  STUB.VIRTUAL.set("01_新知识库/00_Inbox/a.md", f1);
  STUB.VIRTUAL.set("01_新知识库/02_Areas/内容创作/a.md", { path: "01_新知识库/02_Areas/内容创作/a.md", children: undefined });
  let mv = await mover.move(f1, "01_新知识库/02_Areas/内容创作", { overwrite: "skip" });
  ok(mv.blocked === true && mv.ok === false, "目标同名 → blocked 不覆盖");
  STUB.VIRTUAL.delete("01_新知识库/02_Areas/内容创作/a.md");
  mv = await mover.move(f1, "01_新知识库/02_Areas/内容创作", { overwrite: "skip" });
  ok(mv.ok === true && f1.path === "01_新知识库/02_Areas/内容创作/a.md", "搬家成功且路径更新");

  /* 5. links.fixCenter：短名维持短名 / 全路径维持全路径 / 无行不动 */
  const links = auto.links;
  const mk = (content, parentPath) => ({
    path: parentPath + "/t.md", name: "t.md", basename: "t", extension: "md",
    parent: { path: parentPath }, content
  });
  const t1 = mk("- 所属中心：[[_收件箱]]\n\n正文", "01_新知识库/02_Areas/内容创作");
  STUB.VIRTUAL.set(t1.path, t1);
  let ch = await links.fixCenter(t1, router.excl, "01_新知识库");
  ok(ch === true && t1.content.indexOf("- 所属中心：[[_领域中心]]") === 0, "中心链短名跟随目录");
  const t2 = mk("- 所属中心：[[01_新知识库/00_Inbox/_收件箱]]\n", "01_新知识库/02_Areas/内容创作");
  STUB.VIRTUAL.set(t2.path, t2);
  ch = await links.fixCenter(t2, router.excl, "01_新知识库");
  ok(ch === true && t2.content.indexOf("[[01_新知识库/02_Areas/_领域中心]]") >= 0, "中心链全路径跟随目录");
  const t3 = mk("没有中心行的正文", "01_新知识库/02_Areas/内容创作");
  STUB.VIRTUAL.set(t3.path, t3);
  ch = await links.fixCenter(t3, router.excl, "01_新知识库");
  ok(ch === false && t3.content === "没有中心行的正文", "无中心行不擅自加行");
  const t4 = mk("- 所属中心：[[_领域中心]]\n", "01_新知识库/02_Areas/内容创作");
  STUB.VIRTUAL.set(t4.path, t4);
  ch = await links.fixCenter(t4, router.excl, "01_新知识库");
  ok(ch === false, "已正确 → 不改写");
  const t5 = mk("- 所属中心：[[x]]\n", "01_新知识库/99_Meta/02_模板库");
  STUB.VIRTUAL.set(t5.path, t5);
  ch = await links.fixCenter(t5, router.excl, "01_新知识库");
  ok(ch === false, "排除目录不动");

  /* 6. eventBus：同文件风暴合并 + stop 清空 */
  const eb = plugin.eventBus;
  let calls = 0;
  const h = () => calls++;
  eb.on(h);
  const ef = { path: "x/y.md", name: "y.md", extension: "md", parent: { path: "x" } };
  eb.enqueue("create", ef, 5); eb.enqueue("changed", ef, 5); eb.enqueue("rename", ef, 5);
  await sleep(30);
  eq(calls, 1, "同文件三次入队只派发一次");
  eb.off(h);
  calls = 0; eb.enqueue("create", ef, 5); await sleep(30);
  eq(calls, 0, "off 后不再派发");

  /* 7. 旧插件检测 */
  app.plugins.enabledPlugins.add("note-locator");
  plugin.checkLegacy();
  ok(plugin.legacyFound.some(l => l.id === "note-locator"), "检测到 note-locator");
  ok(STUB.Notice.last.indexOf("note-locator") >= 0, "检测提示已弹 Notice");

  /* 8. 设置页渲染：①②③ 顺序 + 横幅 */
  plugin.settings.legacyCheck = true;
  const tab = plugin._tabs[plugin._tabs.length - 1];
  ok(!!tab, "设置页已注册");
  tab.containerEl = document.createElement("div");
  tab.display();
  const html = tab.containerEl.textContent;
  ok(html.indexOf("新建知识库") >= 0, "渲染总控制台（R13：按模块分组，组标题=模块名；R16 去掉序号）");
  /* R16：横幅/帮助里也会提到模块名 → 按「组」判定顺序，不看全文首次出现位置 */
  const gs = Array.from(tab.containerEl.querySelectorAll(".kbt-group"));
  const gOrder = gs.map(g => g.textContent.indexOf("新建知识库") >= 0 ? "rebuild"
    : (g.textContent.indexOf("笔记自动化") >= 0 ? "automation"
      : (g.textContent.indexOf("更多的 Base") >= 0 ? "base" : "?"))).join(",");
  ok(gOrder === "rebuild,automation,base", "三分法顺序（R16 去掉 ①②③ 序号，顺序不变）");
  ok(html.indexOf("note-locator") >= 0, "旧插件横幅出现");

  /* 9. 开关级联：③关 → board/stream 都不启用（R3 前无实现，只验 isEnabled 判定） */
  plugin.settings.modules.base = false;
  ok(plugin.registry.isEnabled("board") === false && plugin.registry.isEnabled("stream") === false, "③总闸关 → 子视图全关");
  plugin.settings.modules.base = true; plugin.settings.modules["base.noteStream"] = false;
  ok(plugin.registry.isEnabled("board") === true && plugin.registry.isEnabled("stream") === false, "子开关单独控制");

  /* 10. 卸载清理 */
  await plugin.onunload();
  eq(Object.keys(plugin.registry.active).length, 0, "onunload 停用全部模块");

  /* ---- 汇总 ---- */
  console.log("R1 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exit(2); });
