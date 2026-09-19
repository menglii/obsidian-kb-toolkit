/* kb-toolkit R7 断言：老板第二轮真机反馈（7 条）的修复证据。
 *   ① 向导保存 → 当场生效（不再要求重载）
 *   ② ②③ 模块关掉后栏目收起（与 ① 一个规矩）
 *   ③ 「查看路由条数」真响应（弹表 + 体检前缀/目标目录）
 *   ④ 拨开关不再甩滚动位置（锚点补偿）
 *   ⑤ 自定义知识库名称真的生效（新建根名 = 库根名，单一真源）
 *   ⑥ 新建笔记真的自动补全（事件按种类合并，create 不被 changed 吞掉）
 *   ⑦ 模板系统（内置四套 + 可改可另存 + 从笔记提取）
 * 期望值一律动态推算：根名/路由数/模板数/目录名都从 settings 与 DEFAULTS 现算，不写死。 */
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
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => sleep(20);

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
function clickAll(setting) {
  const bs = setting && setting._buttons || [];
  for (const b of bs) for (const fn of (b._clicks || [])) fn();
}

(async function main() {
  const KBplugin = require("../main.js");
  const KB = globalThis.KB;
  const D = KB.services.settings.DEFAULTS;
  const KBR = D.paths.knowledgeBase;
  const META = D.paths.metaDir;
  const T = KB.services.templates;
  const src = {};
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith(".js")).sort())
    src[f] = fs.readFileSync(path.join(SRC, f), "utf8");

  /* ================= A. 反馈①：向导保存 → 当场生效（不用重载） ================= */
  let app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/" + META + "/05_操作日志"], []);
  let plugin = await boot(app, { rebuild: false, automation: false, base: false });
  eq(plugin._commands.map(c => c.id).filter(id => id !== "open-settings").length, 0,
    "A：默认没开 ① → 除「打开设置」总入口外 0 条命令（R13）");
  ok(!plugin.registry.active.automation, "A：默认没开 ② → 模块没在跑（断言没空跑）");

  const m1 = new KB.modules.WizardModal(app, plugin);
  m1.open();
  m1.draft.knowledgeBase = "老板的知识库";
  m1.draft.modules.rebuild = true;
  m1.draft.modules.automation = true;
  await m1.save();
  const S = plugin.settings;
  eq(S.paths.knowledgeBase, "老板的知识库", "A：向导保存 → 库根名写进配置");
  eq(S.rebuild.rootName, "老板的知识库", "A：新建根名跟随库根（派生字段，单一真源）");
  ok(S.automation.routes.every(r => r.folder.indexOf("老板的知识库/") === 0), "A：路由前缀整体跟着换");
  eq(S.automation.excluded[0], "^老板的知识库/" + META, "A：排除规则跟着换");
  eq(S.paths.mocLink, "老板的知识库/" + META + "/04_索引与地图/MOC_知识地图", "A：mocLink 跟着换");
  ok(!!plugin.registry.active.automation, "A：② 当场起来了（旧版要重载才生效）");
  ok(plugin.eventBus.started === true, "A：事件总线当场开始监听");
  ok(!!plugin.registry.active.rebuild, "A：① 当场起来了");
  eq(plugin.registry.active.rebuild._cmdIds.length, 3, "A：① 的 3 条命令当场注册（R13：预览/回滚/打开日志；不等重载）");
  ok(!plugin._commands.some(c => c.id === "autofill-scan"),
    "A：② 的「一键补全」命令 R13 起收进设置页（不再进命令面板）");
  const nA = STUB.Notice.all[STUB.Notice.all.length - 1];
  ok(nA.indexOf("已生效") >= 0, "A：Notice 明确说「已生效」");
  ok(!/重载|重新打开/.test(nA), "A：不再要求用户重载 / 重新打开插件");
  eq(plugin.data.wizardDone, true, "A：wizardDone 落盘");
  eq(plugin.data.paths.knowledgeBase, "老板的知识库", "A：落盘的配置就是新库根");
  eq(plugin.data.rebuild.rootName, "老板的知识库", "A：落盘的派生字段也对齐（下次启动不打架）");
  eq(S.automation.templates.activeId, T.DEFAULT_ID, "A：模板配置随默认值一起落盘");

  /* 反向：向导里把 ② 关掉 → 当场停 */
  const m2 = new KB.modules.WizardModal(app, plugin);
  m2.open();
  m2.draft.modules.automation = false;
  await m2.save();
  ok(!plugin.registry.active.automation, "A：向导里关掉 ② → 模块当场停");
  eq(plugin.eventBus.started, false, "A：事件总线停止（不再监听 create）");

  /* 设置页改库根 → 在跑的模块就地重配（不是只有下一次启动才认） */
  m2.draft.modules.automation = true; await m2.save();
  ok(plugin.registry.active.automation.router.root === "老板的知识库", "A：② 的路由器用当前库根");
  let tab = renderTab(plugin);
  /* R8 ③：输入框改成「按键只记草稿、失焦才落库」——按键期间绝不能重画设置页（那会丢焦点） */
  const rootText = findSetting(tab.containerEl, "知识库根目录")._text;
  rootText.typeFire("换个名字");
  await tick();
  eq(plugin.settings.paths.knowledgeBase, "老板的知识库",
    "A：按键期间不落库（R8 ③：不再每敲一个字就把整页重画一遍）");
  ok(findSetting(tab.containerEl, "知识库根目录")._text === rootText,
    "A：设置页没有被重画（还是同一个输入框对象——重画就会换成新的）");
  rootText.blurFire();
  await tick();
  eq(plugin.registry.active.automation.router.root, "换个名字",
    "A：改「知识库根目录」→ 在跑的 ② 路由器就地重配（不再攥着老路径）");
  eq(plugin.settings.rebuild.rootName, "换个名字", "A：新建根名同步（这就是反馈⑤的落点）");
  await plugin.onunload();

  /* ================= B. 反馈⑤：自定义知识库名称真的落到重建上 ================= */
  app = await freshApp([".obsidian", KBR, KBR + "/已存在.md", "02_旧知识库"], []);
  plugin = await boot(app, { rebuild: true, base: false }, { rebuild: { rootName: "知识库" } });  /* 老 data.json：写死的「知识库」 */
  eq(plugin.settings.rebuild.rootName, KBR, "B：老配置里的写死根名在 load 时被对齐到库根名");
  const bsvc = new KB.services.rebuild(app);
  let bplan = await bsvc.plan(plugin.settings.rebuild);
  eq(bplan.root, KBR, "B：重建计划的根名 = 库根名（不再是写死的「知识库」）");
  ok(bplan.creates.every(c => c.indexOf(KBR + "/") === 0), "B：新建目录都挂在库根名之下");
  ok(bplan.moves.some(m => m.from === KBR), "B：同名旧库本身被列入搬运（归档到旧文件区）");
  const bst = await bsvc.detectState(plugin.settings.rebuild);
  eq(bst.rootWillMove, true, "B：状态里标明「旧库将整体归档、再建同名空库」");
  eq(bst.state, "fresh", "B：还没建过（旧文件区不存在）→ fresh");

  /* 向导里改个名字 → 计划立刻跟着变 */
  plugin.settings.paths.knowledgeBase = "我的知识库";
  KB.services.settings.reapplyPaths(plugin.settings, { knowledgeBase: KBR, metaDir: META, legacyDirs: [D.paths.legacyDirs[0]] });
  bplan = await bsvc.plan(plugin.settings.rebuild);
  eq(bplan.root, "我的知识库", "B：向导改名后，重建就建「我的知识库」（反馈⑤：自定义名称生效）");
  await plugin.onunload();

  /* ================= C. 反馈⑥：新建笔记真的自动补全 ================= */
  /* C1 事件语义：同一路径 create 之后紧跟 changed，不能把 create 顶掉 */
  app = await freshApp([".obsidian"], [{ path: "x.md", content: "" }, { path: "y.md", content: "" }]);
  plugin = await boot(app, { base: false });
  const bus = new KB.services.eventBus(plugin);
  const seen = [];
  bus.on((kind, file) => seen.push(kind + ":" + file.path));
  const fx = app.vault.getAbstractFileByPath("x.md"), fy = app.vault.getAbstractFileByPath("y.md");
  bus.enqueue("create", fx, 40);
  bus.enqueue("changed", fx, 1);          /* 真机顺序：create → metadataCache.changed */
  await sleep(70);
  eq(seen.join("|"), "create:x.md", "C：create 不会被随后的 changed 顶掉，且只派发一次");
  bus.enqueue("changed", fy, 1);
  await sleep(20);
  eq(seen[1], "changed:y.md", "C：只有 changed 时照旧派发 changed（合并逻辑没吃掉正常路径）");
  eq(bus.pending.x && bus.pending.x.delay, undefined, "C：派发后 pending 表清空（无悬挂计时器）");
  bus.stop();

  /* C2 真链路：4 篇 0 字节新笔记（正是老板看到的现场）全部补上 */
  app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/01_Projects",
    KBR + "/01_Projects/01_执行中", KBR + "/02_Areas/每日任务", KBR + "/" + META + "/05_操作日志"], []);
  plugin = await boot(app, { automation: true, base: false });
  const targets = ["00_Inbox", "01_Projects", "01_Projects/01_执行中", "02_Areas/每日任务"];
  const made = [];
  for (const d of targets) made.push(await app.vault.create(KBR + "/" + d + "/未命名.md", ""));
  for (const f of made) { app.vault.fire("create", f); app.metadataCache.fire("changed", f); }
  await sleep(1000);
  const filled = made.filter(f => f.content.length > 0);
  eq(filled.length, made.length, "C：4 篇 0 字节新笔记全部被补全（反馈⑥ 的现场复现）");
  const c0 = made[0].content;
  ok(c0.indexOf("主题: 未命名") >= 0, "C：补了主题字段");
  ok(c0.indexOf("文件位置:") >= 0 && c0.indexOf("  - 00_Inbox") >= 0, "C：文件位置 = 相对库根的目录");
  ok(c0.indexOf("- 所属中心：[[") >= 0 && c0.indexOf("/00_Inbox/_收件箱]]") >= 0, "C：尾部双链指向所属中心（带真实前缀）");
  ok(c0.indexOf("[[01_新知识库/" + META + "/04_索引与地图/MOC_知识地图]]".replace("01_新知识库", KBR)) >= 0,
    "C：再链回 MOC_知识地图（不成孤岛）");
  eq((c0.match(/^---$/gm) || []).length, 2, "C：只写了一份前言（没有重复补）");
  eq(plugin.registry.active.automation.stats.filled >= 4, true, "C：模块自己记了账（filled ≥ 4）");

  /* 反例：开关关掉就不补；非空白文件不碰；认不出中心的目录不补 */
  plugin.settings.automation.createFill = false;
  const off = await app.vault.create(KBR + "/00_Inbox/关了开关.md", "");
  app.vault.fire("create", off); app.metadataCache.fire("changed", off);
  await sleep(950);
  eq(off.content, "", "C：createFill=false → 一个字都不写");

  plugin.settings.automation.createFill = true;
  const pasted = await app.vault.create(KBR + "/00_Inbox/粘贴的.md", "# 我自己写的\n");
  app.vault.fire("create", pasted); app.metadataCache.fire("changed", pasted);
  const loose = await app.vault.create(KBR + "/散在库根.md", "");
  app.vault.fire("create", loose); app.metadataCache.fire("changed", loose);
  await sleep(950);
  eq(pasted.content, "# 我自己写的\n", "C：非空白文件原样不动（避开粘贴场景）");
  eq(loose.content, "", "C：认不出中心（库根散文件）→ 宁可不补，绝不乱写");
  await plugin.onunload();

  /* ================= D. 反馈②：②③ 关掉后栏目收起 ================= */
  app = await freshApp([".obsidian", KBR], []);
  plugin = await boot(app, { rebuild: true, automation: false, base: false });
  tab = renderTab(plugin);
  ok(!!findSetting(tab.containerEl, "创建时自动补全"), "D（R11）：② 关掉 → 「创建补全」开关照常渲染（占位置灰）");
  ok(!!findSetting(tab.containerEl, "标签-目录映射表"), "D（R11）：② 关掉 → 选项照常渲染（占位置灰，不收起）");
  ok(!!findSetting(tab.containerEl, "模板正文"), "D（R11）：模板编辑区照常渲染");
  ok(!!findSetting(tab.containerEl, "创作看板") && !!findSetting(tab.containerEl, "内容流视图"),
    "D（R11）：③ 关掉 → 两个子开关照常渲染");
  ok(tab._sectionBoxes.automation.classList.contains("kb-module-disabled")
    && tab._sectionBoxes.base.classList.contains("kb-module-disabled"),
    "D（R11）：关掉的段落置灰禁用（点不动）");
  ok(!!findSetting(tab.containerEl, "新建知识库"), "D：① 开着 → 它的开关照旧在");
  const dTxt = tab.containerEl.textContent || "";
  const offCount = [plugin.settings.modules.rebuild, plugin.settings.modules.automation, plugin.settings.modules.base]
    .filter(v => v !== true).length;
  eq((dTxt.match(/模块已关闭/g) || []).length, offCount,
    "D：每个「关掉的」模块各留一句说明（动态：" + offCount + " 个关着）");
  ok((dTxt.match(/笔记自动化/g) || []).length >= 1,
    "D：模块名仍在（R16 去掉 ①②③ 序号，由标题行点名）");

  /* 拨开 → 当场展开 */
  findSetting(tab.containerEl, "笔记自动化")._toggle.onChange(true);
  await tick();
  ok(!!findSetting(tab.containerEl, "标签-目录映射表"), "D：拨开 ② → 选项当场展开（不用重载）");
  findSetting(tab.containerEl, "更多的 Base")._toggle.onChange(true);
  await tick();
  ok(!!findSetting(tab.containerEl, "创作看板"), "D：拨开 ③ → 子开关当场展开");
  await plugin.onunload();

  /* ================= E. 反馈③：「查看路由条数」真响应 ================= */
  app = await freshApp([KBR + "/00_Inbox", KBR + "/02_Areas/内容创作"], []);
  plugin = await boot(app, { automation: true, base: false });
  tab = renderTab(plugin);
  const RealRoutes = KB.modules.RoutesModal;
  let openedRoutes = 0, lastRoutesModal = null;
  KB.modules.RoutesModal = class extends RealRoutes {
    constructor(a, b) { super(a, b); lastRoutesModal = this; }
    open() { openedRoutes++; return super.open(); }
  };
  clickAll(findSetting(tab.containerEl, "标签-目录映射表"));
  KB.modules.RoutesModal = RealRoutes;
  eq(openedRoutes, 1, "E：点「查看路由条数」真的弹出路由表（老板反馈③：以前点了没反应）");
  const audit = KB.modules.routesAudit(plugin);
  eq(audit.count, plugin.settings.automation.routes.length, "E：条数 = 配置里的路由条数（动态）");
  eq(audit.stale.length, 0, "E：默认路由前缀与库根一致 → 无「陈旧前缀」");
  ok(audit.rows.every(r => r.keys.length > 0), "E：每条路由都算得出可识别写法");
  const rTxt = lastRoutesModal.contentEl.textContent || "";
  ok(rTxt.indexOf(String(audit.count) + " 条") >= 0, "E：弹窗标题写明条数");
  ok(rTxt.indexOf("可识别写法") >= 0, "E：弹窗列出可识别写法（标签/属性值）");
  ok(rTxt.indexOf("✅") >= 0, "E：干净时给一句「前缀一致」的结论");

  /* 换库根却保留老路由 → 体检要点名（这正是老板踩的坑的探针） */
  plugin.settings.paths.knowledgeBase = "换名库";
  const audit2 = KB.modules.routesAudit(plugin);
  eq(audit2.stale.length, audit.count, "E：路由前缀全不是当前库根 → 逐条点名");
  /* 目标目录在不在取决于库里真实有什么 → 期望值现算 */
  const existNow = audit.rows.filter(r => !!app.vault.getAbstractFileByPath(r.folder)).length;
  eq(audit2.missing.length, audit.count - existNow,
    "E：目标目录不存在的那些条被点名（" + (audit.count - existNow) + "/" + audit.count + "）");
  const rm2 = new RealRoutes(app, plugin); rm2.open();
  const r2Txt = rm2.contentEl.textContent || "";
  ok(r2Txt.indexOf("前缀不是当前库根") >= 0, "E：把「路由指着一个不存在的库」写在脸上");
  ok(r2Txt.indexOf("换名库") >= 0, "E：点名当前库根，方便对照");
  rm2.close(); lastRoutesModal.close();
  plugin.settings.paths.knowledgeBase = KBR;
  await plugin.onunload();

  /* ================= F. 反馈④：拨开关不甩滚动位置 ================= */
  app = await freshApp([".obsidian", KBR], []);
  plugin = await boot(app, { rebuild: true, base: false });
  tab = renderTab(plugin);
  ok(!!tab.containerEl.querySelector("." + KB.modules.ANCHOR_CLS), "F：页面里有「启用模块」锚点");
  /* 模拟真机：拨开关 → 整页重画 → 浏览器把 scrollTop 甩回 0 */
  const sc = { scrollTop: 200, scrollHeight: 2000, clientHeight: 400 };
  const DOC_TOP = 500;                        /* 锚点在文档里的固定位置 */
  let rectCalls = 0;
  tab._anchorApi = {
    rect: () => { rectCalls++; return { top: DOC_TOP - sc.scrollTop }; },
    scroller: () => sc
  };
  const origDisplay = tab.display.bind(tab);
  tab.display = function () { sc.scrollTop = 0; return origDisplay(); };   /* 注入「甩位置」的浏览器行为 */
  findSetting(tab.containerEl, "新建知识库")._toggle.onChange(false);
  await tick();
  /* R10-③：拨开关**不再整页重画** —— 只重画本模块那一段。
   * 于是「甩位置 + 锚点补偿」这条根本不会被触发（scrollTop 压根没被动过），
   * 锚点补偿也就没有空跑的必要（rectCalls 应为 0）。 */
  eq(sc.scrollTop, 200, "F：拨开关后位置纹丝不动（不再整页重画）");
  eq(rectCalls, 0, "F：拨开关不再走锚点补偿（因为根本没有整页重画）");
  ok(tab.containerEl.textContent.indexOf("模块已关闭") >= 0, "F：本段给出「已关闭」说明（① 已关）");
  ok(!!tab._sectionBoxes && tab._sectionBoxes.rebuild.classList.contains("kb-module-disabled"),
    "F（R11）：关闭后本段置灰禁用 —— 不收起、布局零变化，绝不跳位");
  /* R16：段内多了 ⓘ 与「查看提示」按钮 → 不写死个数，只认关键按钮照常占位（布局零变化） */
  const fBtns = Array.from(tab._sectionBoxes.rebuild.querySelectorAll("button")).map(b => b.textContent);
  ok(["生成预览报告", "执行", "回滚", "打开最近一篇"].every(t => fBtns.indexOf(t) >= 0),
    "F（R11/R13+R16）：按钮照常占位（开/关布局一致；R16 另加 ⓘ 与「查看提示」）");
  /* 锚点补偿机制本身仍然在线（按钮触发的整页重画用它）：直接调一次验证不空跑 */
  tab.keepAnchor(function () { tab.display(); });
  ok(rectCalls >= 2, "F：keepAnchor 仍会量「重画前 / 重画后」两次（机制不空跑）");
  eq(sc.scrollTop, 200, "F：整页重画路径仍能把位置补回来");
  await plugin.onunload();

  /* ================= G. 反馈⑦：模板系统 ================= */
  app = await freshApp([".obsidian", KBR + "/00_Inbox", KBR + "/02_Areas/游戏研究",
    KBR + "/" + META + "/05_操作日志"], [{ path: KBR + "/02_Areas/游戏研究/样板.md", content:
    ["---", "类型: 资料", "领域: 游戏研究", "主题: 样板", "状态: 已整理", "来源:", "创建日期: 2020-01-02",
     "tags:", "  - 资料", "文件位置:", "  - 02_Areas/游戏研究", "---", "", "# 样板", "",
     "正文第一段。", "", "## 关联笔记", "- 所属中心：[[X/02_Areas/_领域中心]]",
     "- 返回 [[X/99_Meta/04_索引与地图/MOC_知识地图]]", ""].join("\n") }]);
  plugin = await boot(app, { automation: true, base: false });
  const PS = plugin.settings;

  /* G1 内置四套 + 默认渲染与 R2~R6 写死版逐字节一致（回归护栏） */
  ok(T.BUILTIN.length >= 4, "G：内置模板 ≥ 4 套（" + T.BUILTIN.map(b => b.name).join(" / ") + "）");
  eq(T.active(PS).id, T.DEFAULT_ID, "G：默认生效的是内置默认模板");
  const ctx = { title: "甲", date: "2026-09-17", folder: "00_Inbox",
    center: KBR + "/00_Inbox/_收件箱", moc: PS.paths.mocLink, kb: KBR };
  const expectYaml = ["---", "类型: 待整理", "领域: 未分类", "主题: 甲", "状态: 待整理", "创建日期: 2026-09-17",
    "tags:", "  - 待整理", "文件位置:", "  - 00_Inbox", "---", "", "# 甲", "", "## 关联笔记",
    "- 所属中心：[[" + KBR + "/00_Inbox/_收件箱]]", "- 返回 [[" + PS.paths.mocLink + "]]", ""].join("\n");
  eq(T.render(T.active(PS).text, ctx), expectYaml, "G：默认模板渲染 == R2~R6 写死的那份（逐字节）");
  eq(T.render("{{title}}|{{date}}|{{不认识的}}", ctx), "甲|2026-09-17|{{不认识的}}\n",
    "G：只替换认识的六个；写错的占位符原样留着（看得见才好修）");
  eq(T.render("没有占位符", ctx), "没有占位符\n", "G：无占位符时原样 + 补尾换行");

  /* G2 切换 / 改内置 / 恢复内置 / 自建 */
  T.setActive(PS, "builtin/light");
  eq(T.active(PS).id, "builtin/light", "G：切到「轻量收件」生效");
  T.save(PS, "builtin/light", null, "我改过的 {{title}}\n");
  ok(T.get(PS, "builtin/light").overridden === true, "G：改内置 → 标记为「覆盖」");
  eq(T.list(PS).length, T.BUILTIN.length, "G：覆盖内置不会多出一套（列表长度不变）");
  T.remove(PS, "builtin/light");
  ok(T.get(PS, "builtin/light").overridden !== true, "G：删掉覆盖条目 = 恢复内置");
  const mine = T.save(PS, null, "我的模板", "A {{title}}\n");
  ok(mine.id.indexOf("user/") === 0, "G：自建模板落在 user/ 命名空间（" + mine.id + "）");
  ok(T.isCustom(PS, mine.id) === true, "G：自建模板被认作自定义");
  eq(T.list(PS).length, T.BUILTIN.length + 1, "G：自建后列表多一套（动态推算）");
  eq(T.setActive(PS, "不存在/id").id, T.get(PS, "不存在/id").id, "G：activeId 失效时回落，不会返回空模板");

  /* G3 从笔记提取 */
  const sample = STUB.VIRTUAL.get(KBR + "/02_Areas/游戏研究/样板.md").content;
  const ex = T.extract(sample, { title: "样板" });
  ok(ex.indexOf("主题: {{title}}") >= 0, "G：提取 → 标题换占位符");
  ok(ex.indexOf("创建日期: {{date}}") >= 0, "G：提取 → 日期换占位符");
  ok(ex.indexOf("  - {{folder}}") >= 0, "G：提取 → 文件位置列表换占位符");
  ok(ex.indexOf("# {{title}}") >= 0, "G：提取 → 正文标题也换");
  ok(ex.indexOf("- 所属中心：[[{{center}}]]") >= 0, "G：提取 → 中心链换占位符");
  ok(ex.indexOf("- 返回 [[{{moc}}]]") >= 0, "G：提取 → 返回链换占位符");
  ok(ex.indexOf("类型: 资料") >= 0 && ex.indexOf("  - 资料") >= 0 && ex.indexOf("正文第一段。") >= 0,
    "G：提取 → 非私有字段与正文原样保留");
  ok(ex.indexOf("样板") < 0, "G：提取结果里不再残留原笔记名（套到别的笔记上也对）");

  /* G4 UI（R8 起：模板以模板库里的 .md 文件为准 —— 设置页「保存」= 写文件） */
  PS.automation.templates.items = [];      /* 清掉 G3 留在配置里的自建条目，让计数干净 */
  T.setActive(PS, T.DEFAULT_ID);
  T.invalidate();
  const tplDir = T.dirFor(PS);
  eq(tplDir, KBR + "/" + PS.paths.metaDir + "/" + PS.automation.templates.subDir,
    "G4：模板目录由库根 + 元目录派生（换库根自动跟随，源码里没有写死路径）");

  tab = renderTab(plugin);
  eq(T.scan(plugin.app, PS).items.length, 0, "G4：模板库目录此刻还没有 .md");
  let dd = findSetting(tab.containerEl, "当前模板")._dropdown;
  eq(dd.options.length, T.BUILTIN.length, "G4：空目录 → 候选 = 内置四套（标注「未落盘」）");

  /* 内置模板写入模板库 */
  findSetting(tab.containerEl, "模板操作")._buttons
    .find(b => b.text === "内置模板写入模板库")._clicks[0]();
  await tick();
  const sc1 = T.scan(plugin.app, PS, { force: true });
  eq(sc1.items.length, T.BUILTIN.length, "G4：内置四套已落盘成文件");
  ok(sc1.items.every(x => x.path.indexOf(tplDir + "/") === 0), "G4：落点就是模板库目录");
  ok(!!STUB.VIRTUAL.get(tplDir + "/" + T.BUILTIN[0].name + ".md"),
    "G4：磁盘上真有这个 .md（在 Obsidian 里能直接打开改）");

  tab = renderTab(plugin);
  dd = findSetting(tab.containerEl, "当前模板")._dropdown;
  eq(dd.options.length, T.BUILTIN.length, "G4：文件模板顶替内置候选（同名的不会列两遍）");
  ok(dd.options.every(o => o.value.indexOf(T.FILE_PREFIX) === 0), "G4：候选 id 全是 file: 前缀");
  const activeFileId = PS.automation.templates.activeId;
  eq(activeFileId.indexOf(T.FILE_PREFIX), 0, "G4：当前模板自动落到第一套文件");

  /* 改正文 → 保存模板 → 真的写回那个 .md */
  const fname = T.nameOfPath(activeFileId.slice(T.FILE_PREFIX.length));
  const ta = findSetting(tab.containerEl, "模板正文")._textarea;
  await tick();
  eq(ta.value, T.BUILTIN[0].text, "G4：正文框显示文件模板内容（异步读回来的）");
  ta.setValueAndFire("R8 改过的 {{title}}\n");
  findSetting(tab.containerEl, "模板操作")._buttons.find(b => b.text === "保存模板")._clicks[0]();
  await tick();
  const savedEl = STUB.VIRTUAL.get(tplDir + "/" + fname + ".md");
  eq(savedEl && savedEl.content, "R8 改过的 {{title}}\n", "G4：「保存模板」把编辑内容写回模板库文件");

  /* 另存为新模板 → 模板库多一个 .md */
  tab = renderTab(plugin);
  const RealName = KB.modules.NameModal;
  let lastModal = null;
  KB.modules.NameModal = class extends RealName { constructor(a, b) { super(a, b); lastModal = this; } };
  findSetting(tab.containerEl, "模板操作")._buttons.find(b => b.text === "另存为新模板")._clicks[0]();
  KB.modules.NameModal = RealName;
  ok(!!lastModal && lastModal.opened, "G4：「另存为新模板」弹出命名框");
  lastModal.value = "我的一套";
  lastModal.submit();
  await tick();
  ok(!!STUB.VIRTUAL.get(tplDir + "/我的一套.md"), "G4：另存为 → 模板库真的多一个 .md");
  eq(PS.automation.templates.activeId, T.idForName("我的一套"), "G4：另存后自动切到新模板");

  /* 从笔记提取 → 直接落成模板文件 */
  tab = renderTab(plugin);
  const RealEx = KB.modules.ExtractModal;
  let exModal = null;
  KB.modules.ExtractModal = class extends RealEx { constructor(a, b) { super(a, b); exModal = this; } };
  findSetting(tab.containerEl, "模板操作")._buttons.find(b => b.text === "从笔记提取…")._clicks[0]();
  KB.modules.ExtractModal = RealEx;
  ok(!!exModal && exModal.opened, "G4：「从笔记提取…」弹出提取框");
  ok(exModal.candidates().indexOf(KBR + "/02_Areas/游戏研究/样板.md") >= 0, "G4：候选笔记里能选到样板（排除目录已剔除）");
  await exModal.pick(KBR + "/02_Areas/游戏研究/样板.md");
  ok(exModal.text.indexOf("主题: {{title}}") >= 0, "G4：选笔记后当场出提取结果");
  exModal.value = "提取来的一套";
  exModal.submit();
  await tick();
  const exEl = STUB.VIRTUAL.get(tplDir + "/提取来的一套.md");
  ok(!!exEl && exEl.content.indexOf("{{center}}") >= 0, "G4：提取结果直接落成模板文件并切换");

  /* 套用规则：文件夹 / 标签 → 模板（在设置页上真的能加） */
  tab = renderTab(plugin);
  const mkRule = async (kind, value) => {
    const add = findSetting(tab.containerEl, "新增规则");
    add._dropdown.setValueAndFire(kind);
    add._text.typeFire(value);
    add._text.blurFire();
    add._buttons.find(b => b.text === "添加")._clicks[0]();
    await tick();
    tab = renderTab(plugin);
  };
  await mkRule("folder", KBR + "/02_Areas/游戏研究");
  await mkRule("tag", "#灵感杂记");
  const rules = T.rulesList(PS);
  eq(rules.length, 2, "G4：两条套用规则落进配置");
  eq(rules[0].kind, "folder", "G4：规则 1 是文件夹");
  eq(rules[1].kind, "tag", "G4：规则 2 是标签（# 可省）");
  const hitDir = T.ruleFor(PS, KBR + "/02_Areas/游戏研究/内容创作", []);
  ok(!!hitDir && hitDir.templateId === T.idForName("提取来的一套"), "G4：文件夹规则命中子目录（前缀匹配）");
  const hitTag = T.ruleFor(PS, KBR + "/00_Inbox", ["灵感杂记"]);
  ok(!!hitTag && hitTag.why.indexOf("标签") === 0, "G4：标签规则优先于文件夹规则");
  eq(T.ruleFor(PS, KBR + "/00_Inbox", []), null, "G4：都不中 → null（落到「当前模板」兜底）");
  ok(!!findSetting(tab.containerEl, "🏷 标签 #灵感杂记"), "G4：规则在设置页里逐条列出");

  findSetting(tab.containerEl, "🏷 标签 #灵感杂记")._buttons.find(b => b.text === "删除")._clicks[0]();
  await tick();
  eq(T.rulesList(PS).length, 1, "G4：删除规则生效");

  /* 删除文件模板 → 走回收站，不硬删 */
  T.setActive(PS, T.idForName("我的一套"));
  tab = renderTab(plugin);
  findSetting(tab.containerEl, "模板操作")._buttons.find(b => b.text === "删除此模板")._clicks[0]();
  await tick();
  ok(!STUB.VIRTUAL.get(tplDir + "/我的一套.md"), "G4：「删除此模板」把模板文件移走");
  ok(plugin.app.__trashed.indexOf(tplDir + "/我的一套.md") >= 0, "G4：走的是回收站不是硬删");
  await plugin.onunload();

  /* ================= H. 静态守卫（防以后又踩回去） ================= */
  const r20 = strip(src["20_core_eventbus.js"]);
  ok(/pickKind/.test(r20) && /kinds\[kind\] = true/.test(r20),
    "H：事件总线按种类合并（create 不会被 changed 顶掉）");
  const r65 = strip(src["65_services_rebuild.js"]);
  ok(!/ROOT_RE/.test(r65), "H：65 里不再有写死的根名正则");
  ok(/sameName/.test(r65) && /rootWillMove/.test(r65), "H：同名旧库复用名字 + 状态里标明");
  const r70 = strip(src["70_core_settings.js"]);
  ok(/rootName: DEFAULT_ROOT/.test(r70) && /rebuild\.rootName = s\.paths\.knowledgeBase/.test(r70),
    "H：新建根名由库根名派生（唯一真源）");
  const r75 = strip(src["75_core_settingTab.js"]);
  ok(/S\.modules\.automation !== true/.test(r75) && /S\.modules\.base !== true/.test(r75),
    "H：②③ 组也受模块开关包裹（关掉即收起）");
  ok(/keepAnchor/.test(r75) && /ANCHOR_CLS/.test(r75), "H：拨开关走锚点补偿（位置不跳）");
  ok(/查看 \/ 编辑[\s\S]{0,120}onClick/.test(r75), "H：「查看 / 编辑」（原「查看路由条数」）挂了 onClick（不再是死按钮）");
  ok(!/01_新知识库|02_旧知识库|99_Meta\s*\//.test(r75 + src["76_core_settingModals.js"] + src["36_services_templates.js"]),
    "H：R7 新代码没引入顶层路径字面量");
  const r90 = strip(src["90_entry.js"]);
  ok(/applySettingsChange/.test(r90) && /refreshSettingTab/.test(r90),
    "H：入口提供「配置变更统一收口」（refresh + reapply + 重画设置页）");
  const r87 = strip(src["87_modules_wizard.js"]);
  ok(/applySettingsChange/.test(r87), "H：向导保存也走同一个收口（不会再各写各的）");
  ok(!/重载 Obsidian 生效|重新打开插件/.test(src["87_modules_wizard.js"].replace(/\/\*[\s\S]*?\*\//g, "")),
    "H：向导里不再有「请重载才生效」的文案");

  /* ================= I. 文档（本轮不改版本号：收尾轮才 bump） ================= */
  const man = JSON.parse(fs.readFileSync(path.join(PLUG, "manifest.json"), "utf8"));
  eq(man.version, "1.0.0", "I：非收尾轮不动版本号（避免与 R5 断言打架）");
  const chg = fs.readFileSync(path.join(PLUG, "CHANGELOG.md"), "utf8");
  ok(/R7/.test(chg), "I：CHANGELOG 记下 R7 的改动");

  console.log("R7 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("测试崩溃:", e); process.exitCode = 2; });
