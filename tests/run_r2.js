/* kb-toolkit R2 离线断言：创建补全 / note-locator 迁移 / 开新停旧。
 * 运行方式同 run_r1.js。期望值动态推算（路由条数取迁移文件实际值、日期取当天）。 */
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

(async function main() {
  const KBplugin = require("../main.js");
  const app = STUB.makeApp();
  const plugin = new KBplugin(app, { id: "kb-toolkit" });

  /* 迁移源：note-locator 真实 data.json 的浓缩版（结构一致，期望值动态取） */
  const NL_DATA = JSON.stringify({
    property: "文件位置", writeBack: true, fixCenterLink: true, retireAutoNoteMover: true,
    excluded: ["^01_新知识库/99_Meta", "^02_旧知识库", "(^|/)\\."],
    routes: [
      { folder: "01_新知识库/00_Inbox", values: ["收件箱", "Inbox"] },
      { folder: "01_新知识库/02_Areas/内容创作", values: ["内容创作"] }
    ],
    propertyOptions: { "文件位置": ["00_Inbox", "02_Areas/内容创作"] }
  });
  app.vault.adapter._files.set(".obsidian/plugins/note-locator/data.json", NL_DATA);
  const NL_ROUTES = JSON.parse(NL_DATA).routes.length;
  const NL_OPTS = Object.keys(JSON.parse(NL_DATA).propertyOptions).length;

  /* 开启 automation 模拟 R2 切换 */
  plugin.data = { modules: { automation: true } };
  await plugin.onload();
  const auto = plugin.registry.active.automation;
  ok(!!auto, "automation 模块已启用");

  /* 1. 迁移：routes/excluded/propertyOptions 继承自 note-locator */
  ok(plugin.settings.automation.migrated === true, "迁移标记置位");
  eq(plugin.settings.automation.routes.length, NL_ROUTES, "路由条数继承自 note-locator");
  eq(Object.keys(plugin.settings.automation.propertyOptions).length, NL_OPTS, "propertyOptions 继承");
  ok(plugin.settings.automation.property === "文件位置", "属性名继承");

  /* 2. 二次启动不重复迁移（幂等） */
  const routesBefore = plugin.settings.automation.routes.length;
  await plugin.onload();
  eq(plugin.settings.automation.routes.length, routesBefore, "二次启动路由不变");
  ok(plugin.settings.automation.migrated === true, "迁移标记保持");

  /* 3. 开新停旧 */
  app.plugins.enabledPlugins.add("note-locator");
  app.plugins.enabledPlugins.add("auto-note-mover");
  await plugin.onunload();
  await plugin.onload();
  ok(app.__disabled.indexOf("note-locator") >= 0, "note-locator 已被自动停用");
  ok(app.__disabled.indexOf("auto-note-mover") >= 0, "auto-note-mover 已被自动停用");
  ok(!app.plugins.enabledPlugins.has("note-locator"), "enabledPlugins 中已移除 note-locator");

  /* 4. 创建补全：空白新文件 → YAML + 尾部关联笔记 */
  const auto2 = plugin.registry.active.automation;
  const blank = {
    path: "01_新知识库/02_Areas/内容创作/新笔记.md", name: "新笔记.md", basename: "新笔记",
    extension: "md", parent: { path: "01_新知识库/02_Areas/内容创作" }, content: ""
  };
  STUB.VIRTUAL.set(blank.path, blank);
  await auto2.tryCreateFill(blank);
  const c = blank.content;
  const today = new Date();
  const pad = n => (n < 10 ? "0" : "") + n;
  const dateStr = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
  ok(c.indexOf("---") === 0, "补出了 YAML 头");
  ok(c.indexOf("主题: 新笔记") >= 0, "主题=文件名");
  ok(c.indexOf("创建日期: " + dateStr) >= 0, "创建日期=今天(" + dateStr + ")");
  ok(c.indexOf("- 02_Areas/内容创作") >= 0, "文件位置=当前目录（canonical）");
  ok(c.indexOf("- 所属中心：[[01_新知识库/02_Areas/_领域中心]]") >= 0, "所属中心跟随目录");
  ok(c.indexOf("MOC_知识地图]]") >= 0, "返回 MOC 双链");
  ok(/^---\n[\s\S]*\n---\n\n# 新笔记\n[\s\S]*## 关联笔记/.test(c), "整体结构 YAML+标题+关联笔记");

  /* 5. 非空白文件不动（Templater 场景 / 粘贴场景） */
  const hasFm = {
    path: "01_新知识库/00_Inbox/有前言.md", name: "有前言.md", basename: "有前言",
    extension: "md", parent: { path: "01_新知识库/00_Inbox" },
    content: "---\ntags: [x]\n---\n\n# 有前言\n"
  };
  STUB.VIRTUAL.set(hasFm.path, hasFm);
  await auto2.tryCreateFill(hasFm);
  ok(!hasFm.content.includes("类型: 待整理"), "有前言 → 不补");
  const hasBody = {
    path: "01_新知识库/00_Inbox/有正文.md", name: "有正文.md", basename: "有正文",
    extension: "md", parent: { path: "01_新知识库/00_Inbox" }, content: "# 手写内容\n"
  };
  STUB.VIRTUAL.set(hasBody.path, hasBody);
  await auto2.tryCreateFill(hasBody);
  ok(hasBody.content === "# 手写内容\n", "有正文 → 不碰");

  /* 6. 排除目录 / 认不出中心 → 不补 */
  const inMeta = {
    path: "01_新知识库/99_Meta/02_模板库/Templater/T_新模板.md", name: "T_新模板.md", basename: "T_新模板",
    extension: "md", parent: { path: "01_新知识库/99_Meta/02_模板库/Templater" }, content: ""
  };
  STUB.VIRTUAL.set(inMeta.path, inMeta);
  await auto2.tryCreateFill(inMeta);
  ok(inMeta.content === "", "排除目录（99_Meta）不补");
  const atRoot = {
    path: "01_新知识库/散文件.md", name: "散文件.md", basename: "散文件",
    extension: "md", parent: { path: "01_新知识库" }, content: ""
  };
  STUB.VIRTUAL.set(atRoot.path, atRoot);
  await auto2.tryCreateFill(atRoot);
  ok(atRoot.content === "", "库根认不出中心 → 不补");

  /* 7. 创建补全后 handle() 不误搬：补出的 tags=[待整理] 无路由命中 */
  await auto2.handle(blank);
  ok(blank.path === "01_新知识库/02_Areas/内容创作/新笔记.md", "补全文件不被误搬");
  ok(STUB.Notice.all.join("").indexOf("已迁移 note-locator 配置") >= 0, "迁移 Notice 已弹");

  /* 8. 设置页含创建补全开关 */
  const tab = plugin._tabs[plugin._tabs.length - 1];
  tab.containerEl = document.createElement("div");
  tab.display();
  const txt = tab.containerEl.textContent;
  ok(txt.indexOf("创建时自动补全") >= 0, "设置页含创建补全开关（R18 起行名精简）");

  await plugin.onunload();

  console.log("R2 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exit(2); });
