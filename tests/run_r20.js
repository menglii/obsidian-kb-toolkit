/* kb-toolkit R20 断言：boss 四条（设置页精简 + 看板设置界面重做）。
 *   ① 状态行小字通通去掉 —— 只留「圆点 + 已启用 / 未启用」，细节全在悬浮窗里
 *   ② 每页底部那栏「帮助」撤掉 —— 入口挪到顶部标签行「日志 / 关于」右边
 *   ③ 创作看板的齿轮不再用 emoji「⚙」—— 自绘极简线条图标（stroke=currentColor）
 *   ④ 三个设置入口职责分开、界面大幅简化成开关样式：
 *      4-① 点标题进来的「视图配置」只留显示类必要项
 *      4-② 顶栏齿轮 = 整个看板（看板行为 / 板块 / 高级 三段，开关化，说明进 title）
 *      4-③ 板块边上齿轮 = 单个板块（三态改并排按钮组，标签去冗长）
 * 机制类回归在 r12/r13/r14/r16/r18/r19。 */
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
dom.window.Element.prototype.createSpan = function (opts) { return this.createEl("span", opts || {}); };

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
const PLUG = path.join(__dirname, "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); }

const cbSrc = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8");
const cb = stripComments(cbSrc);
const src75 = fs.readFileSync(path.join(PLUG, "src", "75_core_settingTab.js"), "utf8");
const kbtCss = fs.readFileSync(path.join(PLUG, "styles_src", "kbt.css"), "utf8");
const cbCss = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
/** 取一个方法/函数的函数体文本（按大括号配平），用来把断言限定在这段里 */
function bodyOf(text, header) {
  const i = text.indexOf(header);
  if (i < 0) return "";
  /* header 允许自带结尾的「{」——所以从 header 末字符开始找，别越过它 */
  let j = text.indexOf("{", i + header.length - 1), depth = 0, k = j;
  for (; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}") { depth--; if (depth === 0) { k++; break; } }
  }
  return text.slice(j, k);
}

async function boot(app, modules) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit", dir: ".obsidian/plugins/kb-toolkit" });
  plugin.data = { modules: modules, wizardDone: true };
  await plugin.onload();
  return plugin;
}

(async function main() {
  /* ================= A. 需求1：状态行只留「是否启用」 ================= */
  {
    ok(/function statusLine\(box, tip\)/.test(src75),
      "A1（需求1）：statusLine 不再收「主行文案」（小字副行整条删掉）");
    ok(src75.indexOf("kbt-status-sub") < 0 && kbtCss.indexOf("kbt-status-sub") < 0,
      "A2（需求1）：src 与样式里都不再有 .kbt-status-sub（小字栏彻底断根）");
    ok(/var led = top\.createEl\("span", \{ cls: "kbt-led" \}\)/.test(src75)
      && /m\.textContent = on \? "已启用" : "未启用"/.test(src75),
      "A3（需求1）：状态行 = 一颗状态圆点 + 「已启用 / 未启用」");
    ok(/\.kbt-status \.kbt-led\s*{/.test(kbtCss) && /\.kbt-led\.is-on\s*{[^}]*var\(--color-green\)/.test(kbtCss),
      "A4（需求1）：圆点样式在（马卡龙绿走白名单变量 --color-green，零裸色）");
    ok(/\.kbt-status-more\s*{/.test(kbtCss) && src75.indexOf("kbt-status-more") >= 0,
      "A5（需求1）：「详情 ›」入口保留（页内只留一行，细节仍可点开看）");

    const app = STUB.makeApp();
    const plugin = await boot(app, { rebuild: true, automation: true, base: true });
    const tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();
    await sleep(150);
    const cards = [...tab.containerEl.querySelectorAll(".kbt-sec.kbt-status-card")];
    eq(cards.length, 3, "A6（需求1）：三页各一栏「当前状态」（R19 结构不破）");
    ok(cards.every(c => {
      const m = c.querySelector(".kbt-status-main");
      return m && /^(已启用|未启用)$/.test(m.textContent) && !!c.querySelector(".kbt-led");
    }), "A7（需求1）：三页都只报「是否启用」+ 圆点，没有第二行小字");
    ok(cards.every(c => !c.querySelector(".kbt-status-sub") && c.querySelectorAll(".kbt-status-main").length === 1),
      "A8（需求1）：副行不存在，主行也只有一条");
    /* 状态小窗（细节的家）仍在，且条目没少 */
    const pop = tab._pops["rebuild:status"];
    ok(!!pop && !!pop.querySelector(".kbt-pop-body") && pop.querySelectorAll(".kbt-help-item").length >= 3,
      "A9（需求1）：细节挪进的状态小窗还在（条目 " +
      (pop ? pop.querySelectorAll(".kbt-help-item").length : 0) + " 条）");
    await plugin.onunload();
  }

  /* ================= B. 需求2：帮助入口挪到顶栏 ================= */
  {
    ok(/var helpBtn = ghostBtns\.createEl\("button", \{ cls: "kbt-ghost-btn", attr: \{ type: "button" \}, text: "帮助" \}\)/.test(src75)
      && /tab\._openPop\(\(tab\._tab \|\| "rebuild"\) \+ ":help"\)/.test(src75),
      "B1（需求2）：顶栏「帮助」按钮存在，且按**当前**标签页拼键（不串页）");
    ok(/function helpPop\(key\)/.test(src75) && src75.indexOf("function helpRow") < 0,
      "B2（需求2）：每页那栏 helpRow 已撤，只保留 helpPop（小窗本体）");
    ok((src75.match(/helpPop\("/g) || []).length === 3,
      "B3（需求2）：三页各建一个小窗（rebuild / automation / base）");
    ok(kbtCss.indexOf(".kbt-help-row") < 0,
      "B4（需求2）：样式源里 .kbt-help-row 规则一并删干净（不留死代码）");

    const app = STUB.makeApp();
    const plugin = await boot(app, { rebuild: true, automation: true, base: true });
    const tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();
    await sleep(150);

    eq([...tab.containerEl.querySelectorAll(".kbt-help-row")].length, 0,
      "B5（需求2）：页内不再有任何「帮助」栏");
    const ghs = tab.containerEl.querySelector(".kbt-tabs .kbt-ghost-btns");
    ok(!!ghs, "B6（需求2）：顶栏入口容器在（标签行右端）");
    const btns = [...ghs.querySelectorAll(".kbt-ghost-btn")];
    eq(btns.map(b => b.textContent).join(","), "日志,关于,帮助",
      "B7（需求2）：顺序 = 日志 / 关于 / 帮助（帮助在「关于」右边）");

    const helpBtn = btns[2];
    tab._activateTab("rebuild");
    const pR = tab._pops["rebuild:help"];
    ok(!!pR && pR.hasAttribute("hidden"), "B8（需求2）：三个小窗各自独立，默认都收着");
    helpBtn.click();
    ok(!pR.hasAttribute("hidden"), "B9（需求2）：点「帮助」→ 当前页小窗打开");
    ok(!!pR.querySelector(".kbt-pop-mask") && !!pR.querySelector(".kbt-pop-x")
      && !!pR.querySelector(".kbt-pop-body") && pR.querySelectorAll(".kbt-help-item").length >= 3,
      "B10（需求2）：小窗结构照旧（遮罩 + 关闭钮 + 可滚正文 + 多条提示）");
    tab._activateTab("base");
    helpBtn.click();
    ok(!tab._pops["base:help"].hasAttribute("hidden") && pR.hasAttribute("hidden"),
      "B11（需求2）：换页后点同一个按钮 → 开的是那一页的窗（互斥，只留一个）");
    tab._closePop("base:help");
    tab._activateTab("rebuild");
    tab._openPop("about");
    ok(!tab._pops.about.hasAttribute("hidden") && pR.hasAttribute("hidden"),
      "B12（需求2）：「关于」与「帮助」仍共用一套小窗、互斥");
    await plugin.onunload();
  }

  /* ================= C. 需求3：自绘极简齿轮图标 ================= */
  {
    ok(/^function gearIcon\(parent\) \{/m.test(cb), "C1（需求3）：gearIcon 帮助函数在（模块级）");
    const gb = bodyOf(cb, "function gearIcon(parent)");
    ok(/const NS = "http:\/\/www\.w3\.org\/2000\/svg"/.test(gb)
      && /doc\.createElementNS\(NS, "svg"\)/.test(gb)
      && /doc\.createElementNS\(NS, "circle"\)/.test(gb),
      "C2（需求3）：用 createElementNS 造 SVG（createEl 造不出真 svg 元素）");
    ok(/svg\.setAttribute\("stroke", "currentColor"\)/.test(gb) && /"viewBox"/.test(gb)
      && /svg\.setAttribute\("width", "14"\)/.test(gb),
      "C3（需求3）：线条图标 —— stroke=currentColor（跟文字色走）+ viewBox + 14px 固定");
    ok(/const ring = /.test(gb) && /const teeth = /.test(gb)
      && /svg\.appendChild\(ring\)/.test(gb) && /svg\.appendChild\(teeth\)/.test(gb),
      "C4（需求3）：环 + 轮齿都自己画出来（不依赖字体里的 ⚙ 字形）");
    eq((cb.match(/⚙/g) || []).length, 0,
      "C5（需求3）：出货代码里不再有任何 emoji「⚙」（只允许出现在注释，注释已剥）");
    ok(/this\.gearBtn = bar\.createEl\("button", \{ cls: "cb-gear" \}\);/.test(cb)
      && /gearIcon\(this\.gearBtn\);/.test(cb)
      && /this\.gearBtn\.createSpan\(\{ cls: "cb-gear-text", text: "板块" \}\)/.test(cb),
      "C6（需求3）：顶栏按钮 = 自绘图标 + 「板块」文字");
    ok(/const gear = head\.createEl\("button", \{ cls: "cb-sec-gear" \}\);\s*\n\s*gearIcon\(gear\);/.test(cb),
      "C7（需求3）：板块标题旁的按钮也是自绘图标");
    ok(cbCss.indexOf(".cb-gear-icon") >= 0 && cbCss.indexOf(".cb-gear-text") >= 0
      && /\.cb-gear\s*{[^}]*display:\s*inline-flex/.test(cbCss)
      && /\.cb-sec-gear\s*{[^}]*display:\s*inline-flex/.test(cbCss),
      "C8（需求3）：图标/文字样式齐（按钮改 flex 对齐，不再靠 font-size 撑字形）");
  }

  /* ================= D. 需求4-①：视图配置面板只留必要项 ================= */
  {
    const vo = bodyOf(cb, "static getViewOptions(config)");
    ok(vo.length > 0, "D1（需求4-①）：getViewOptions 还是静态方法（Bases 视图选项入口）");
    ["K_PROPS", "K_BODY", "K_CHARS"].forEach(k => {
      ok(vo.indexOf("key: " + k) >= 0, "D2（需求4-①）：视图配置保留显示类项 " + k);
    });
    /* R21：宽度 + 自动也从原生面板挪走了 —— 那边一条 descriptor 只能占一行，
     * 合不成「文件宽度 [拉杆] 240 px  自动 [开关]」；键一个没删，只是换了台面。 */
    ["K_WIDTH", "K_FILL"].forEach(k => {
      ok(vo.indexOf("key: " + k) < 0,
        "D2b（R21）：" + k + " 已从原生视图选项面板挪进顶栏「卡片」组（一行合得成）");
    });
    /* R23（boss：加一个开关控制笔记的属性是否默认展开）：控件挪进顶栏「看板行为」组 */
    ok(vo.indexOf("key: K_PROS_OPEN") < 0,
      "D2c（R23）：K_PROS_OPEN 已从原生视图选项面板挪进顶栏「看板行为」组");
    ["K_RO", "K_DUP", "K_CATCH", "K_EXCLUDE", "K_CAP"].forEach(k => {
      ok(vo.indexOf(k) < 0, "D3（需求4-①）：行为/范围类项 " + k + " 已从视图配置移走（归顶栏整板设置）");
    });
    /* 移走不等于删掉 —— 键仍被顶栏面板读写，配置兼容 */
    ok(/K_RO, false, "只读"/.test(cb) && /K_DUP, true, "允许重复"/.test(cb)
      && /K_CATCH, this\.pluginCatchDefault\(\), "显示收容所"/.test(cb),
      "D4（需求4-①）：移走的键仍在顶栏面板里可读可写（老 .base 配置不失效）");
    ok(/view\[K_RO\] = this\.readonly\(\);/.test(cb) && /view\[K_EXCLUDE\] = this\.cfgGet\(K_EXCLUDE, ""\);/.test(cb),
      "D5（需求4-①）：配置导出照旧带上全部键（搬运不丢）");
  }

  /* ================= E. 需求4-②：顶栏面板 = 三段式开关 ================= */
  {
    ok(/^  addGroup\(label\) \{/m.test(cb), "E1（需求4-②）：addGroup 分段帮助函数在");
    const rp = bodyOf(cb, "renderPanel() {");
    eq((rp.match(/this\.addGroup\(/g) || []).length, 3,
      "E2（需求4-②／R21）：renderPanel 分成「卡片」「看板行为」「板块」三组（高级第四组走 details）");
    ok(/this\.addGroup\("卡片"\)/.test(rp) && /this\.addGroup\("看板行为"\)/.test(rp) && /this\.addGroup\("板块"\)/.test(rp),
      "E3（需求4-②／R21）：段落名就是这三个（极简，不加小字说明）");
    ok(/advRow\.createEl\("summary", \{ text: "高级" \}\)/.test(rp)
      && /const advBody = advRow\.createDiv\(\{ cls: "cb-opt-row" \}\);/,
      "E4（需求4-②）：高级折叠组 summary 只留「高级」两字");
    ok(/const list = secBox\.createDiv\(\{ cls: "cb-panel-list" \}\);/,
      "E5（需求4-②）：板块列表挂在「板块」段里（不再和开关平铺）");

    ok(/addToggle\(parent, key, dflt, label, tip\)/.test(cb),
      "E6（需求4-②）：addToggle 多了 tip 参数（说明走悬浮提示）");
    const at = bodyOf(cb, "addToggle(parent, key, dflt, label, tip) {");
    ok(/const sw = row\.createEl\("label", \{ cls: "checkbox-container" \}\)/.test(at)
      && /const cb = sw\.createEl\("input", \{ cls: "cb-opt-box", type: "checkbox" \}\)/.test(at),
      "E7（需求4-②）：开关走 Obsidian 原生胶囊 .checkbox-container（标签包输入框）");
    ok(/if \(tip\) row\.setAttr\("title", tip\);/.test(at),
      "E8（需求4-②）：说明落到 title（面板正文里不铺小字）");
    ok(/cb\.addEventListener\("change", \(\) => apply\(!!cb\.checked\)\)/.test(at)
      && /lab\.addEventListener\("click", \(\) => \{/.test(at),
      "E9（需求4-②）：点开关、点标签都能切（交互不变）");

    /* 开关标签必须短 —— 不许再把括号解释塞进 label */
    const labels = [...cb.matchAll(/addToggle\(\s*\w+,\s*(K_\w+),\s*[^,]+,\s*"([^"]*)"/g)]
      .map(m => m[2]);
    ok(labels.length >= 6, "E10（需求4-②）：面板开关共 " + labels.length + " 个（4 行为 + 3 高级）");
    ok(labels.every(t => t.length <= 12 && t.indexOf("（") < 0 && t.indexOf("(") < 0),
      "E11（需求4-②）：开关标签全是短词、零括号说明（实到 " + labels.join(" / ") + "）");
    ok(/this\.renderIoBox\(advRow\);/.test(rp),
      "E12（需求4-②）：配置搬运折进「高级」里（不再单独占一段）");
    ok(/\.cb-grp-lb\s*{/.test(cbCss) && /\.cb-opt \.checkbox-container\s*{/.test(cbCss)
      && /\.cb-opt \.checkbox-container:has\(input:checked\)/.test(cbCss),
      "E13（需求4-②）：段落标签 + 胶囊开关样式在（含 :has 兜底 —— 主题不给 is-enabled 也能变色）");
  }

  /* ================= F. 需求4-③：板块级三态改按钮组 ================= */
  {
    const row = bodyOf(cb, "renderEditRow(parent, i) {");
    ok(/const seg = r\.createDiv\(\{ cls: "cb-seg " \+ cls \}\)/.test(row),
      "F1（需求4-③）：三态容器 = .cb-seg");
    ok(/const b = seg\.createEl\("button", \{ cls: "cb-seg-btn", text: pair\[1\] \}\)/.test(row)
      && /b\.setAttr\("data-value", pair\[0\]\);/.test(row)
      && /b\.addClass\("is-on"\)/.test(row),
      "F2（需求4-③）：每个状态一个小按钮，当前态 is-on（一眼可见）");
    ok(/\["", "继承", "跟随视图默认（现在 = "/.test(row)
      && /\["true", "开", /.test(row) && /\["false", "关", /.test(row),
      "F3（需求4-③）：三态 = 继承 / 开 / 关（语义与原先的下拉完全一致）");
    eq((row.match(/mkTri\("/g) || []).length, 3,
      "F4（需求4-③）：显正文 / 显示 YAML / 显示结尾双链 都改成按钮组");
    ok(/^    const mkTri = \(label, cls, key, viewOn\) => \{/m.test(row)
      && /this\.secs\[i\]\[key\] = nv;/.test(row),
      "F5（需求4-③）：mkTri 仍按同一个键写回（null = 继承，不污染手写配置）");
    ["cb-select-body", "cb-select-yaml", "cb-select-links"].forEach(cls => {
      eq(cb.indexOf(cls), -1, "F6（需求4-③）：旧的 " + cls + " 下拉已删除");
    });
    eq((row.match(/cb-edit-sep/g) || []).length, 2,
      "F7（需求4-③）：仍分「基础 / 显示」两段（R14 分段不丢）");
    ok(/text: "目录" \}\)/.test(row) && row.indexOf("目录（点选）") < 0,
      "F8（需求4-③）：长标签「目录（点选）」砍成「目录」");
    ok(/const rpl = rp\.createSpan\(\{ cls: "cb-field-label", text: "属性" \}\);\s*\n\s*rpl\.setAttr\("title"/.test(row),
      "F9（需求4-③）：「属性」长说明挪进 title，标签只留两个字");
    ok(/const done = foot\.createEl\("button", \{ cls: "cb-btn-done", text: "完成" \}\)/.test(row)
      && /cls: "cb-btn-del2", text: "删除此板块"/.test(row),
      "F10（需求4-③）：完成 / 删除此板块 两个出口还在（这一块的操作全在手边）");
    ok(/\.cb-seg\s*{/.test(cbCss) && /\.cb-seg-btn\.is-on\s*{[^}]*var\(--interactive-accent\)/.test(cbCss),
      "F11（需求4-③）：按钮组样式在，当前态用主题强调色（零裸色）");
  }

  /* ================= G. 三个入口职责分开（需求4 分类） ================= */
  {
    const vo = bodyOf(cb, "static getViewOptions(config)");
    const rp = bodyOf(cb, "renderPanel() {");
    const row = bodyOf(cb, "renderEditRow(parent, i) {");
    ok(vo.indexOf("K_DUP") < 0 && rp.indexOf("K_DUP") >= 0 && row.indexOf("K_DUP") < 0,
      "G1（需求4）：看板级行为（允许重复）只在顶栏面板 —— 视图配置与板块编辑都不管");
    ok(vo.indexOf("K_PROPS") >= 0 && rp.indexOf("K_PROPS") < 0
      && row.indexOf("cb-input-props") >= 0 && row.indexOf("parseNameList") >= 0,
      "G2（需求4）：显示类（属性）= 视图给默认值 + 板块可单独覆盖，顶栏面板不掺和");
    ok(row.indexOf("cb-seg") >= 0 && rp.indexOf("cb-seg") < 0,
      "G3（需求4）：板块级三态按钮只在板块编辑行里（顶栏不出现）");
    eq((cb.match(/gearIcon\(/g) || []).length, 3,
      "G4（需求4）：两处齿轮用同一个图标函数（顶栏 + 板块标题），只画一份");
  }

  console.log("\nR20 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
})();
