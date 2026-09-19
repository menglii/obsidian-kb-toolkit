/* kb-toolkit R17 断言：Templater 模板不再被原样倒进笔记（2026-09-19 报障「新建笔记标签没成功创建」）
 *
 * 病根：老板把「创建补全模板」指到了模板库里的 T_*.md —— 那是 **Templater 脚本模板**，
 *      首行是 `<%* … %>---`。本插件只替换 {{占位符}}，于是把 Templater 语法原样写进新笔记：
 *      `---` 不在第 1 行 → Obsidian 不认前言 → 标签 / 属性全废。
 * 修法（两条，缺一不可）：
 *   ① 模板含 Templater 语法 → 先求值再落盘；求不到就**拒写**（宁可空着，不写脏数据）
 *   ② 该目录已被 Templater 的「目录模板」接管 → 本插件让路，不跟它抢同一篇新笔记
 * 期望值一律动态推算：库根 / 元目录 / 模板路径都从 settings 现算，不写死。 */
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
const src = {};
for (const f of fs.readdirSync(path.join(PLUG, "src"))) if (f.endsWith(".js"))
  src[f] = fs.readFileSync(path.join(PLUG, "src", f), "utf8");

const META = "99_Meta", KBR = "01_测试库", TPLDIR = "02_模板库/Templater";

/* 一套「长得像 T_内容作品」的 Templater 模板：<%= 语法 + 自带前言 */
const TPL_TXT = [
  "<%*",
  "const title = tp.file.title;",
  'const today = tp.date.now("YYYY-MM-DD");',
  "%>---",
  "类型: 内容作品",
  "tags: [内容创作]",
  "主题: <% title %>",
  "创建日期: <% today %>",
  "---",
  "",
  "# <% title %>",
  "",
  "正文占位。",
  ""
].join("\n");

/* 极简 Templater 模拟器：只认本测试用到的三件事（块 / title / today），够证伪「原样落盘」 */
function fakeTemplater(opts) {
  opts = opts || {};
  return {
    settings: opts.settings || {},
    templater: {
      parse_template: async function (cfg, text) {
        if (opts.throwAt) throw new Error(opts.throwAt);
        if (opts.echoRaw) return String(text);
        const title = (cfg && cfg.target_file && cfg.target_file.basename) || "";
        return String(text)
          .replace(/<%\*[\s\S]*?%>/g, "")
          .replace(/<%\s*title\s*%>/g, title)
          .replace(/<%\s*today\s*%>/g, opts.date || "2026-09-19");
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

(async function main() {
  const KBplugin = require("../main.js");
  void KBplugin;

  /* ================= A. 源码级：桥在、拒写在、让路在 ================= */
  {
    const t36 = strip(src["36_services_templates.js"]);
    ok(/hasTemplaterSyntax:\s*hasTemplaterSyntax/.test(t36)
      && /templaterFolderRule:\s*templaterFolderRule/.test(t36)
      && /evalTemplater:\s*evalTemplater/.test(t36)
      && /materialize:\s*materialize/.test(t36),
      "A1：模板服务导出 Templater 桥四件套（识别 / 目录规则 / 求值 / 落盘收口）");
    ok(/templater-output-has-syntax/.test(t36) && /templater-syntax-not-evaluated/.test(t36),
      "A2：materialize 有「产出里还带 <% → 拒写」两条兜底（绝不写脏数据）");
    ok(/RunMode|run_mode:\s*0/.test(t36) && /template_file/.test(t36) && /target_file/.test(t36),
      "A3：求值走 Templater 的 parse_template(runningConfig, content)（run_mode=CreateNewFromTemplate=0）");

    const t80 = strip(src["80_modules_automation.js"]);
    ok(/templaterFolderRule\(app,\s*parentPath\)/.test(t80) && /stats\.deferred\+\+/.test(t80),
      "A4：tryCreateFill 里「目录已被 Templater 接管 → 让路」");
    ok(/TPL\.materialize\(/.test(t80) && /stats\.refused\+\+/.test(t80),
      "A5：tryCreateFill 走 materialize 收口 + 拒写计数");
    ok(/T\.materialize\(app,\s*tpl\.file,\s*f,/.test(t80) && /res\.refused/.test(t80),
      "A6：一键补全也走同一收口，求值失败 → 记账跳过（不写半成品）");
    ok(!/templates\.render\(tpl\.text/.test(t80),
      "A7：旧的「render 后直接落盘」写法已彻底移除（不给脏数据留后门）");
  }

  /* ================= B. 语法识别 ================= */
  {
    const app = await freshApp([".obsidian", KBR], []);
    const plugin = await boot(app, { automation: true, base: false });
    const T = KB.services.templates;
    ok(T.hasTemplaterSyntax("<%* const a = 1; %>") === true, "B1：认得 <%* %> 块");
    ok(T.hasTemplaterSyntax("主题: <% title %>") === true, "B2：认得 <% 表达式 %>");
    ok(T.hasTemplaterSyntax("<%_  trim  _%>") === true, "B3：认得 <%_ _%> 变体");
    ok(T.hasTemplaterSyntax("普通模板 {{title}}，正文里有 1 < 2 和 50% 的折扣") === false,
      "B4：普通模板 / 正文里的 < 与 % 不误伤（不误判成 Templater）");
    eq(T.templaterApi(app), null, "B5：没装 Templater → templaterApi 返回 null（调用方兜得住）");
    eq(T.templaterFolderRule(app, KBR + "/00_Inbox"), null, "B6：没装 Templater → 让路判定为 null");
    await plugin.onunload();
  }

  /* ================= C. 端到端：没有 Templater → 拒写，不留脏数据 ================= */
  {
    const app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/" + META + "/" + TPLDIR], []);
    const plugin = await boot(app, { automation: true, base: false });
    const S = plugin.settings, T = KB.services.templates;
    await T.writeFile(app, S, "内容作品套", TPL_TXT);
    T.invalidate();
    T.setActive(S, T.idForName("内容作品套"));
    S.automation.templateRules = [];
    const amod = plugin.registry.active.automation;
    amod.onConfigure();

    const nBefore = STUB.Notice.all.length;
    const f = await app.vault.create(KBR + "/00_Inbox/丙.md", "");
    app.vault.fire("create", f);
    app.metadataCache.fire("changed", f);
    await sleep(400);

    eq(f.content, "", "C1：求不到值的 Templater 模板 → 新笔记**一个字都没写**（不是写一半）");
    ok(amod.stats.refused >= 1, "C2：算进「拒写」计数（stats.refused=" + amod.stats.refused + "）");
    ok(STUB.Notice.all.length > nBefore && STUB.Notice.all[STUB.Notice.all.length - 1].indexOf("Templater") >= 0,
      "C3：弹了提示说清「这是 Templater 模板、已跳过」（不静默失败）");
    await plugin.onunload();
  }

  /* ================= D. 端到端：有 Templater → 求值后落盘（标签真的进了前言） ================= */
  {
    const app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/" + META + "/" + TPLDIR], []);
    const plugin = await boot(app, { automation: true, base: false });
    const S = plugin.settings, T = KB.services.templates;
    await T.writeFile(app, S, "内容作品套", TPL_TXT);
    T.invalidate();
    T.setActive(S, T.idForName("内容作品套"));
    S.automation.templateRules = [];
    /* 装上「Templater」，但**不**配目录规则 → 这是求值路径（不是让路路径） */
    app.plugins.plugins = { "templater-obsidian": fakeTemplater({ date: "2026-09-19" }) };
    const amod = plugin.registry.active.automation;
    amod.onConfigure();

    const f = await app.vault.create(KBR + "/00_Inbox/丁.md", "");
    app.vault.fire("create", f);
    app.metadataCache.fire("changed", f);
    await sleep(400);

    const txt = String(f.content || "");
    ok(txt.length > 0, "D1：求值成功 → 笔记确实被写了");
    ok(txt.indexOf("<%") < 0, "D2：写进去的文本里**再没有** Templater 语法");
    eq(txt.split(/\r?\n/)[0], "---", "D3：前言落在第 1 行（标签/属性才认得出来 —— 这就是报障的根因）");
    ok(/^tags:\s*\[内容创作\]/m.test(txt), "D4：tags 真的写进了前言（老板报的「标签没创建」直接对症）");
    ok(/^主题:\s*丁$/m.test(txt) || /^主题:\s*丁\s*$/m.test(txt),
      "D5：<% title %> 被求值成文件名（模板里的动态量不再漏成字面量）");
    ok(/^创建日期:\s*2026-09-19$/m.test(txt), "D6：<% today %> 被求值成日期");
    eq(amod.lastFillVia, "templater", "D7：记录这次是「经 Templater 求值」落盘的（可追溯）");
    eq(amod.stats.deferred, 0, "D8：没有目录规则 → 不该误让路");
    await plugin.onunload();
  }

  /* ================= E. 端到端：Templater 目录规则覆盖 → 让路 ================= */
  {
    const app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/" + META + "/" + TPLDIR], []);
    const plugin = await boot(app, { automation: true, base: false });
    const S = plugin.settings, T = KB.services.templates;
    await T.writeFile(app, S, "内容作品套", TPL_TXT);
    T.invalidate();
    T.setActive(S, T.idForName("内容作品套"));
    S.automation.templateRules = [];
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
    amod.onConfigure();

    ok(!!T.templaterFolderRule(app, KBR + "/00_Inbox"), "E1：认得出「该目录归 Templater 管」");
    eq(T.templaterFolderRule(app, KBR + "/03_别处"), null, "E2：别的目录不受影响");

    const f = await app.vault.create(KBR + "/00_Inbox/戊.md", "");
    app.vault.fire("create", f);
    app.metadataCache.fire("changed", f);
    await sleep(400);

    eq(f.content, "", "E3：让路 → 本插件一个字不写（把新笔记留给 Templater 处置）");
    ok(amod.stats.deferred >= 1, "E4：算进「让路」计数（stats.deferred=" + amod.stats.deferred + "）");
    eq(amod.stats.filled, 0, "E5：让路时不算「已补全」（不虚报功）");
    await plugin.onunload();
  }

  /* ================= F. 求值抛异常 / 求值后仍带语法 → 都拒写，且只提醒一次 ================= */
  {
    const app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/" + META + "/" + TPLDIR], []);
    const plugin = await boot(app, { automation: true, base: false });
    const S = plugin.settings, T = KB.services.templates;
    await T.writeFile(app, S, "内容作品套", TPL_TXT);
    T.invalidate();
    T.setActive(S, T.idForName("内容作品套"));
    S.automation.templateRules = [];
    app.plugins.plugins = { "templater-obsidian": fakeTemplater({ throwAt: "boom" }) };
    const amod = plugin.registry.active.automation;
    amod.onConfigure();

    const n0 = STUB.Notice.all.length;
    const f1 = await app.vault.create(KBR + "/00_Inbox/己.md", "");
    app.vault.fire("create", f1);
    app.metadataCache.fire("changed", f1);
    await sleep(400);
    eq(f1.content, "", "F1：Templater 求值抛异常 → 拒写（笔记仍是空的）");
    eq(STUB.Notice.all.length - n0, 1, "F2：第一回失败弹一次提示");

    const f2 = await app.vault.create(KBR + "/00_Inbox/庚.md", "");
    app.vault.fire("create", f2);
    app.metadataCache.fire("changed", f2);
    await sleep(400);
    eq(f2.content, "", "F3：第二篇同样拒写");
    eq(STUB.Notice.all.length - n0, 1, "F4：同一次会话只提醒一次（批量补全不刷屏）");

    /* 求值器原样返回（含 <% ）→ 也要拒写 */
    app.plugins.plugins = { "templater-obsidian": fakeTemplater({ echoRaw: true }) };
    amod._warnedTplRefuse = false;
    const f3 = await app.vault.create(KBR + "/00_Inbox/辛.md", "");
    app.vault.fire("create", f3);
    app.metadataCache.fire("changed", f3);
    await sleep(400);
    eq(f3.content, "", "F5：求值结果里仍带 <% → 照样拒写（兜底那条断言真的在拦）");
    await plugin.onunload();
  }

  /* ================= G. 回归：普通模板照旧（别把主路径修坏） ================= */
  {
    const app = await freshApp([".obsidian", KBR, KBR + "/00_Inbox", KBR + "/" + META + "/" + TPLDIR], []);
    const plugin = await boot(app, { automation: true, base: false });
    const S = plugin.settings, T = KB.services.templates;
    await T.writeFile(app, S, "普通套",
      "---\n主题: {{title}}\n类型: 普通\n---\n\n# {{title}}\n\n## 关联笔记\n- 返回 [[{{moc}}]]\n");
    T.invalidate();
    T.setActive(S, T.idForName("普通套"));
    S.automation.templateRules = [];
    app.plugins.plugins = { "templater-obsidian": fakeTemplater({}) };
    const amod = plugin.registry.active.automation;
    amod.onConfigure();

    const f = await app.vault.create(KBR + "/00_Inbox/壬.md", "");
    app.vault.fire("create", f);
    app.metadataCache.fire("changed", f);
    await sleep(400);
    ok(/^类型:\s*普通$/m.test(String(f.content)) && String(f.content).indexOf("{{") < 0,
      "G1：普通模板照旧补全（占位符渲染完，没被 Templater 分支影响）");
    eq(amod.lastFillVia, "plain", "G2：记录为「普通路径」（不谎报走了 Templater）");
    await plugin.onunload();
  }

  console.log("\nR17 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exitCode = 1; }
})();
