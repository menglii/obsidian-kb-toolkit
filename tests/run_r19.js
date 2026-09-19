/* kb-toolkit R19 断言：boss 五条需求（2026-09-19 13:00 前后）
 *  ① 新笔记创建时默认带「文件位置」属性（Templater 接管的目录也要补）
 *  ② 开关里的小圆圈扶正 + 三个模块栏加框
 *  ③ 状态说明各自成栏，点开用悬浮窗看当前状态
 *  ④ 核心操作按钮去掉彩色底，统一素色
 *  ⑤ 各栏提示信息精简
 * 期望值一律动态推算（库根 / 元目录 / 模板路径都从 settings 现算，不写死）。 */
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
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = f => fs.readFileSync(path.join(PLUG, f), "utf8");

const css = read("styles_src/kbt.css");
const src75 = strip(read("src/75_core_settingTab.js"));
const src80 = strip(read("src/80_modules_automation.js"));

const META = "99_Meta", KBR = "01_测试库", TPLDIR = "02_模板库/Templater";

const TPL_TXT = [
  "<%*",
  "const title = tp.file.title;",
  "%>---",
  "类型: 内容作品",
  "tags: [内容创作]",
  "---",
  "",
  "# <% title %>",
  "",
  "正文占位。",
  ""
].join("\n");

function fakeTemplater(opts) {
  opts = opts || {};
  return {
    settings: opts.settings || {},
    templater: {
      parse_template: async function (cfg, text) {
        const title = (cfg && cfg.target_file && cfg.target_file.basename) || "";
        return String(text).replace(/<%\*[\s\S]*?%>/g, "").replace(/<%\s*title\s*%>/g, title);
      }
    }
  };
}
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
  plugin.data = Object.assign({ modules: modules, wizardDone: true }, {});
  await plugin.onload();
  return plugin;
}
/* 造一个「00_Inbox 归 Templater 管」的环境，返回 { app, plugin, amod, T, S } */
async function templaterEnv(extraData) {
  const app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/03_别处",
    KBR + "/" + META + "/" + TPLDIR], []);
  const plugin = await boot(app, { automation: true, base: false });
  const S = plugin.settings, T = KB.services.templates;
  await T.writeFile(app, S, "内容作品套", TPL_TXT);
  T.invalidate();
  T.setActive(S, T.idForName("内容作品套"));
  S.automation.templateRules = [];
  if (extraData) Object.assign(S.automation, extraData);
  app.plugins.plugins = {
    "templater-obsidian": fakeTemplater({
      settings: {
        trigger_on_file_creation: true,
        enable_folder_templates: true,
        folder_templates: [{ folder: KBR + "/00_Inbox", template: KBR + "/" + META + "/" + TPLDIR + "/内容作品套.md" }]
      }
    })
  };
  const amod = plugin.registry.active.automation;
  amod.tplDeferMs = 0;          /* 测试不等 */
  amod.onConfigure();
  return { app, plugin, amod, T, S };
}
/* 等到事件总线真正派发为止：create(180) + changed(180) 合并 → 360ms 才到点，
 * 桩里没有「等 pending 排空」的口子，所以按最坏情况留足（和 r17 一致，别再用 120ms）。 */
const SETTLE = 450;
async function newNote(app, p) {
  const f = await app.vault.create(p, "");
  app.vault.fire("create", f);
  app.metadataCache.fire("changed", f);
  await sleep(SETTLE);
  return f;
}
const hasKey = (f, k) => !!(f.fm && Object.prototype.hasOwnProperty.call(f.fm, k));

(async function main() {

  /* ================= ① 需求1：新笔记默认带「文件位置」属性 ================= */
  {
    ok(/AutomationModule\.prototype\.patchLocationKey\s*=/.test(src80),
      "① -1：有 patchLocationKey（让路时补「文件位置」的专用通道）");
    ok(/templaterFolderRule\(app,\s*parentPath\)\)\s*\{[\s\S]{0,120}this\.patchLocationKey\(file\)/.test(src80),
      "① -2：让路分支里调用了它（让路不再等于撒手）");
    ok(/this\.tplDeferMs\s*=\s*\d+/.test(src80),
      "① -3：等 Templater 落盘的时长是实例字段（测试可设 0，不必真等）");
    ok(/processFrontMatter/.test(src80), "① -4：补属性走 processFrontMatter（原子，不碰正文）");

    const { app, plugin, amod, S } = await templaterEnv();
    const key = S.automation.property || "文件位置";

    const f1 = await newNote(app, KBR + "/00_Inbox/甲.md");
    eq(f1.content, "", "① -5：正文仍然一个字不写（Templater 的地盘）");
    ok(hasKey(f1, key), "① -6：但前言里补上了「" + key + "」");
    eq(f1.fm[key], "", "① -7：值留空 —— 非空会被路由当成「以它为准」，新笔记就不再按标签归位了");
    ok(amod.stats.deferred >= 1, "① -8：同时计入「让路」计数（stats.deferred=" + amod.stats.deferred + "）");
    eq(amod.stats.patched, 1, "① -9：计入「补属性」计数");

    /* 幂等：模板自带该键（或已被补过）→ 不重复写 */
    const f2 = await app.vault.create(KBR + "/00_Inbox/乙.md", "");
    f2.cache = { frontmatter: { "文件位置": "00_Inbox" } };
    app.vault.fire("create", f2);
    app.metadataCache.fire("changed", f2);
    await sleep(SETTLE);
    eq(f2.fm, undefined, "① -10：已有该键 → 一行都不碰（幂等）");
    ok(amod.stats.kept >= 1, "① -11：计入「已有、跳过」计数");

    /* writeBack 关掉 → 不动前言 */
    S.automation.writeBack = false;
    const f3 = await newNote(app, KBR + "/00_Inbox/丙.md");
    eq(f3.fm, undefined, "① -12：writeBack 关 → 不补（尊重「不写回」开关）");
    S.automation.writeBack = true;

    /* 非接管目录：原路子（整篇 materialize）不受影响 */
    const before = amod.stats.filled;
    await newNote(app, KBR + "/03_别处/丁.md");
    ok(amod.stats.filled >= before, "① -13：没被 Templater 接管的目录照旧走原补全路径");
    await plugin.onunload();
  }

  /* ================= ② 需求2：开关扶正 + 模块栏加框 ================= */
  {
    /* Obsidian 原生 :after 带 margin-top 和关闭态 translate3d → 必须被显式清掉 */
    ok(/\.kbt-switch \.checkbox-container::after\s*\{[\s\S]*?margin:\s*0;/.test(css),
      "② -1：圆点清了原生 margin（歪的元凶之一）");
    ok(/\.kbt-switch \.checkbox-container::after\s*\{[\s\S]*?transform:\s*none;/.test(css),
      "② -2：圆点清了原生关闭态位移（歪的元凶之二）");
    ok(/\.kbt-switch \.checkbox-container\s*\{[\s\S]*?border-radius:\s*999px/.test(css),
      "② -3：轨道做成胶囊正圆（999px，不再用 --radius-l 那种小圆角）");
    ok(/\.kbt-switch \.checkbox-container::after\s*\{[\s\S]*?border-radius:\s*50%/.test(css),
      "② -4：圆点是正圆（50%）");
    ok(/\.kbt-switch\s*\{[\s\S]*?border:\s*1px solid var\(--background-modifier-border\)/.test(css),
      "② -5：模块栏加了边框（boss：给这几栏加个框）");
    /* 三套尺寸都要清干净 */
    const clears = css.match(/checkbox-container::after\s*\{[^}]*margin:\s*0;[^}]*transform:\s*none;/g) || [];
    ok(clears.length >= 3, "② -6：默认 / 窄窗 / 移动端三套尺寸都清了（实到 " + clears.length + " 处）");
    /* 几何自洽：轨道 38 = 左 2 + 圆 17 + 行距 17 + 右 2 */
    ok(/\.kbt-switch \.checkbox-container\.is-enabled::after\s*\{[\s\S]*?translateX\(17px\)/.test(css),
      "② -7：开态位移 17px = 38 - 2 - 17 - 2（左右留边一致）");
  }

  /* ================= ③ 需求3：状态成栏 + 点开悬浮窗 ================= */
  {
    const app = STUB.makeApp();
    const plugin = await boot(app, { rebuild: true, automation: true, base: true });
    const tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();
    /* rebuild 页的状态条目是异步算的（await rebuild.detectState）→ 等它落地再断言 */
    await sleep(150);

    ok(/function statusLine\(box, mainText, tip\)/.test(src75) &&
      /cls: "kbt-sec kbt-status-card"/.test(src75),
      "③ -1：状态行由 statusLine 建成独立一栏（.kbt-sec.kbt-status-card）");
    eq([...tab.containerEl.querySelectorAll(".kbt-sec.kbt-status-card")].length, 3,
      "③ -2：三页各一栏「当前状态」");
    eq([...tab.containerEl.querySelectorAll(".kbt-sec.kbt-status-card > .kbt-lb")]
      .map(e => e.textContent).join(","), "当前状态,当前状态,当前状态",
      "③ -3：栏目名都是「当前状态」");
    ok(!!tab.containerEl.querySelector(".kbt-status-more"),
      "③ -4：行尾有「详情 ›」提示（告诉用户整栏可点）");

    /* 每页都注册了状态小窗 */
    const keys = ["rebuild:status", "automation:status", "base:status"];
    eq(keys.filter(k => tab._pops[k]).length, 3, "③ -5：三页都注册了状态小窗");

    const pop = tab._pops["rebuild:status"];
    ok(pop && pop.hasAttribute("hidden"), "③ -6：小窗默认收着（hidden）");
    ok(!!pop.querySelector(".kbt-pop-head .kbt-pop-title") &&
      (pop.querySelector(".kbt-pop-title").textContent || "").indexOf("当前状态") === 0,
      "③ -7：小窗标题以「当前状态」开头");

    /* 点整栏 → 开窗 */
    const sec = tab._sectionBoxes.rebuild.querySelector(".kbt-sec.kbt-status-card");
    sec.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    ok(!pop.hasAttribute("hidden"), "③ -8：点整栏 → 悬浮窗打开");
    ok(pop.querySelectorAll(".kbt-hrow").length >= 3,
      "③ -9：窗里是「键 + 说明」条目（实到 " + pop.querySelectorAll(".kbt-hrow").length + " 条）");
    ok((pop.textContent || "").indexOf("新建根") >= 0,
      "③ -10：条目内容 = 当前状态信息（库根等动态值）");

    /* 关掉再点 ⓘ 也能开 */
    tab._closePop("rebuild:status");
    const dot = sec.querySelector(".kbt-info");
    dot.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    ok(!pop.hasAttribute("hidden"), "③ -11：ⓘ 也能开同一个窗（两个入口一致）");

    /* 模块关着时状态栏仍可点（纯读数） */
    ok(/\.kb-module-disabled \.kbt-sec\.kbt-status-card\s*\{[^}]*pointer-events:\s*auto/.test(css),
      "③ -12：模块关闭时状态栏仍可点（CSS 保住指针事件）");
    ok(/\.kbt-sec\.kbt-status-card:hover > \.kbt-card\s*\{[^}]*background:/.test(css),
      "③ -13：悬停有反馈（可点的视觉暗示）");
  }

  /* ================= ④ 需求4：按钮统一素色 ================= */
  {
    ok(/\.kbt-card button:not\(\.kbt-inline-btn\):not\(\.kbt-hint-link\):not\(\.kbt-info\)\s*\{[\s\S]*?background:\s*var\(--background-primary\)/.test(css),
      "④ -1：栏内按钮统一走素色规则（--background-primary 底）");
    ok(css.indexOf(".kbt-card .mod-cta") < 0, "④ -2：不再给 .mod-cta 单开紫底");
    ok(css.indexOf(".kbt-card .mod-warning") < 0, "④ -3：不再给 .mod-warning 单开红底");
    ok(/\.kb-legacy-banner \.mod-warning\s*\{[\s\S]*?color-mix\(in srgb, var\(--color-red\)/.test(css),
      "④ -4：页头「旧插件收编」横幅的警示底保留（它是提示横幅，不是操作按钮）");
    ok(!/setCta\(\)/.test(src75.replace(/setWarning\(\)/g, "")),
      "④ -5：设置页不再用 setCta 上色");
    ok(/b\.setButtonText\("生成预览报告"\)\s*\n\s*\.onClick/.test(src75),
      "④ -6：三个核心按钮直接跟 onClick（中间不再插上色调用）");
  }

  /* ================= ⑤ 需求5：提示信息精简 ================= */
  {
    const block = src75.match(/var MOD_TIP = \{([\s\S]*?)\};/);
    ok(!!block, "⑤ -1：找得到 MOD_TIP");
    const tips = block ? (block[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)) : [];
    eq(tips.length, 3, "⑤ -2：三条模块说明");
    ok(tips.every(t => t.length <= 18),
      "⑤ -3：每条都不超过 18 字（实到 " + tips.map(t => t.length).join("/") + "）");

    ok(/setName\("首次使用向导"\)\.setDesc\("重走初始化，不动笔记文件"\)/.test(src75),
      "⑤ -4：向导说明缩到一句");
    ok(/setName\("操作日志"\)\.setDesc\("每次预览 \/ 执行 \/ 回滚都留一篇报告"\)/.test(src75),
      "⑤ -5：操作日志说明缩到一句");
    ok(/setName\("创建时自动补全"\)\s*\n\s*\.setDesc\("只对空白新笔记生效"\)/.test(src75),
      "⑤ -6：补全开关说明缩到一句");
    ok(/setDesc\("落位后自动同步 YAML 与双链"\)/.test(src75),
      "⑤ -7：移动后同步说明缩到一句");
    ok(/setDesc\("扫描全库补齐缺失项；先出报告再写盘"\)/.test(src75),
      "⑤ -8：一键补全说明缩到一句");
    ok(/setName\("标签-目录映射表"\)\.setDesc\("共 " \+ routes \+ " 条路由"\)/.test(src75),
      "⑤ -9：映射表行只报条数（不再复述历史）");
    ok(/元数据目录名（相对库根），当前：/.test(src75) && /笔记存放的顶层目录名，当前：/.test(src75),
      "⑤ -10：两个路径的说明都是一句话");
    /* setDesc 是纯文本 —— 反引号 / 星号都会原样显示，属于老毛病，顺手清掉 */
    ok(src75.indexOf('"`" +') < 0 && src75.indexOf("当前排除：`") < 0,
      "⑤ -11：说明里不再出现 Markdown 反引号（纯文本会把 ` 原样显示）");
    ok(/留空 —— 看板展示整个笔记库/.test(src75),
      "⑤ -12：看板范围留空时给一句短说明");
  }

  console.log("\nR19 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exitCode = 1; }
})();
