/* kb-toolkit R12 断言：老板第七轮 7 条的修复证据。
 *   ① 第 1 条 —— 看板普通拖动 = 搬文件（Alt 退役成「强制纯排序」逃生阀）：vendor 源级断言。
 *   ②③ 第 2/3 条 —— 板块 ⚙ 设置入口 + 板块级「显示 YAML / 显示结尾双链」三态 + 视图级默认。
 *   ④ 第 4 条 —— 板块标题拖动排序（配置板块）。
 *   ⑤⑥ 第 5/6 条 —— 移动端审计：无未守卫的桌面专属 API（本文件 E 段复扫一遍防回归）。
 *   ⑦ 第 7 条 —— 幽灵「创作看板」设置页：内嵌实例 addSettingTab 被禁（真因）+
 *      内嵌 data.json 桥挪进 kb-toolkit 目录（复活目录的根因）。 */
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
const ROOT = KB.services.settings.DEFAULTS.paths.knowledgeBase;
const PLUG = path.join(__dirname, "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(app, modules, extra) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit", dir: ".obsidian/plugins/kb-toolkit" });
  plugin.data = Object.assign({ modules: modules, wizardDone: true }, extra || {});
  await plugin.onload();
  return plugin;
}
function stripComments(s) { return String(s).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1"); }

(async function main() {
  /* ================= A. ⑦ 内嵌实例：设置页禁注册 + data.json 桥挪家 ================= */
  {
    const app = STUB.makeApp();
    const plugin = await boot(app, { rebuild: false, automation: false, base: true });
    const board = plugin.registry.active.board;
    const stream = plugin.registry.active.stream;
    ok(!!board && !!board.inst, "A1：内嵌看板实例已加载");
    eq(board.inst.__kbNoTab, true, "A2：内嵌看板的 addSettingTab 已被禁（幽灵设置页的根因）");
    eq(board.inst._tabs.length, 0, "A3：内嵌看板没有注册任何设置页（第三方插件列表只剩本插件）");
    eq(board.inst.manifest.dir, ".obsidian/plugins/kb-toolkit/embed-creation-board",
      "A4：data.json 桥落点挪进本插件目录（不再复活 .obsidian/plugins/creation-board/）");
    eq(stream.inst.manifest.dir, ".obsidian/plugins/kb-toolkit/embed-bases-preview", "A5：内容流实例同样内收");
    eq(stream.inst._tabs.length, 0, "A6：内嵌内容流同样不注册设置页");
    const excl = await board.inst.loadData();
    ok(excl && typeof excl === "object" && Object.prototype.hasOwnProperty.call(excl, "excludeFolders"),
      "A7：「排除目录」桥在新落点可读可写（loadData 回读）");
    await plugin.onunload();
  }

  /* ================= B. ① 拖动 = 搬文件（vendor 源级） ================= */
  {
    const cb = stripComments(fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8"));
    ok(/crossFolder && !evt\.altKey\)\s*\{\s*this\.moveCardToFolderOfCard\(src, card\)/.test(cb),
      "B1：普通拖动跨目录 → 直接搬文件（不再需要 Alt）");
    ok(/if \(from < to\) to -= 1;/.test(cb) && /this\.reorder\(from, to\)/.test(cb),
      "B2：板块标题拖动 → reorder 落配置");
    ok(cb.indexOf("this.secDrag") >= 0 && /head\.setAttr\("draggable", "true"\)/.test(cb),
      "B3：板块标题可拖（secDrag 上下文独立于卡片拖拽）");
    ok(cb.indexOf("cb-sec-gear") >= 0 && /this\.editIdx = sec\.isCatch \? this\.secs\.length - 1 : sec\.srcIndex/.test(cb),
      "B4：板块标题 ⚙ → 打开面板并定位到该板块编辑行");
    ok(cb.indexOf("cb-drop-move") >= 0, "B5：跨目录悬停整卡高亮（区别于左右插入条）");
    ok(/dragleave[\s\S]{0,200}cb-drop-move/.test(cb), "B6：拖放离开时高亮清理干净");
  }

  /* ================= C. ②③ 板块级 显示 YAML / 显示结尾双链 ================= */
  {
    const cb = stripComments(fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8"));
    ok(/const K_YAML = "显示 YAML"/.test(cb) && /const K_LINKS = "显示结尾双链"/.test(cb),
      "C1：两个新配置键（视图级默认）");
    ok(/"属性", "显正文", "显示 YAML", "显示结尾双链", "拖动搬文件", "排序", "sort"/.test(cb),
      "C2：KNOWN_KEYS 收编新键（板块级写回不丢）");
    ok(/yaml: tri\(o, "显示 YAML", "yaml"\)/.test(cb) && /links: tri\(o, "显示结尾双链", "links"\)/.test(cb),
      "C3：板块 spec 三态解析（true/false/继承）");
    ok(/if \(sec\.yaml === true \|\| sec\.yaml === false\) o\["显示 YAML"\] = sec\.yaml;/.test(cb)
      && /if \(sec\.links === true \|\| sec\.links === false\) o\["显示结尾双链"\] = sec\.links;/.test(cb),
      "C4：写回只在「显式设过」时落键（不污染手写配置）");
    ok(/function cutLinksTail\(/.test(cb) && /if \(item\.showLinks === false\) body = cutLinksTail\(body\);/.test(cb),
      "C5：loadBody 按开关掐掉结尾「关联笔记」段（切最后一处标题到文末）");
    ok(/stripForPreview\(raw, file\.basename, item\.showYaml\)/.test(cb),
      "C6：keepYaml 透传（板块要看 YAML 就不剥前言）");
    ok(/showYaml: this\.yamlOn\(sec\), showLinks: this\.linksOn\(sec\)/.test(cb),
      "C7：懒加载项带上两开关（板块三态优先，视图默认兜底）");
    ok(/mkTri\("显示 YAML"/.test(cb) && /mkTri\("显示结尾双链"/.test(cb),
      "C8：板块编辑行里有两个三态下拉（继承/开/关）");
    ok(/addToggle\((optRow|advBody), K_YAML, false,/.test(cb) && /addToggle\((optRow|advBody), K_LINKS, true,/.test(cb),
      "C9：视图级默认进面板（YAML 默认关 = 老行为；双链默认开 = 老行为；R13 收进高级组）");
    ok(/view\[K_YAML\] = this\.optBool\(K_YAML, false\);/.test(cb), "C10：配置导出带上新键");
    /* C11~C14：K_MOVE「拖动搬文件」视图级开关（默认开 = R12 行为；关 = 退回 Alt 搬文件） */
    ok(/const K_MOVE = "拖动搬文件"/.test(cb), "C11：K_MOVE 配置键存在");
    ok(/moveMode = cross && !evt\.altKey && this\.optBool\(K_MOVE, true\)/.test(cb)
      && /optBool\(K_MOVE, true\) && crossFolder && !evt\.altKey/.test(cb),
      "C12：dragover 高亮与 drop 搬文件都过开关（默认开，关掉退回纯排序）");
    ok(/view\[K_MOVE\] = this\.optBool\(K_MOVE, true\);/.test(cb), "C13：配置导出带 K_MOVE");
    ok(/addToggle\((optRow|advBody), K_MOVE, true,/.test(cb), "C14：视图面板有「拖动搬文件」开关（默认开；R13 收进高级组）");
  }

  /* ================= D. ⑤⑥ 移动端审计（防回归复扫） ================= */
  {
    const files = ["62_services_vaultops.js", "80_modules_automation.js", "85_modules_base.js"];
    let bad = [];
    for (const f of files) {
      const s = fs.readFileSync(path.join(PLUG, "src", f), "utf8");
      if (/[^.\w](require\("crypto"\))/.test(s) && !/try \{ crypto = require\("crypto"\); \} catch/.test(s)) bad.push(f + ":crypto 未守卫");
    }
    for (const v of ["creation-board.js", "bases-preview.js"]) {
      const s = stripComments(fs.readFileSync(path.join(PLUG, "vendor", v), "utf8"));
      for (const api of ["openWithDefaultApp", "showInFolder", "openPopoutLeaf", "revealInFolder", "navigator.clipboard"]) {
        const re = new RegExp("(?<!typeof )(?<!\\.)" + api.replace(/\./g, "\\.") + "\\s*\\(");
        if (re.test(s) && !new RegExp("typeof " + api.replace(/\./g, "\\.") + " === \"function\"").test(s)
          && !new RegExp("try\\s*\\{[^{}]*" + api.replace(/\./g, "\\.")).test(s)) bad.push(v + ":" + api);
      }
    }
    eq(bad.length, 0, "D：桌面专属 API 全部有守卫或回退（移动端不会崩在这类调用上）" + (bad.length ? " → " + bad.join("; ") : ""));
    const man = JSON.parse(fs.readFileSync(path.join(PLUG, "manifest.json"), "utf8"));
    eq(man.isDesktopOnly, false, "D2：manifest.isDesktopOnly = false（手机可装）");
  }

  console.log("\nR12 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
})().catch(e => { console.error("FATAL", e); process.exit(2); });
