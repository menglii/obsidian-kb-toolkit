/* kb-toolkit R16 断言：设置页三标签改版（boss 四轮截图意见逐条落地）
 *   A. 页头 —— 标题 + 右上角版本号；日志 / 关于 挂在标签行右端（R18 调整）
 *   B. 三标签 —— 知识库 / 笔记 / Base，各带一颗马卡龙小圆点；点标签切页（切页不用 hidden，hidden 留给搜索）
 *   C. 模块头三层 —— 标题（无 ①②③）+ 滑块开关 → 左边一小条短横 → 状态行（主行 + ⓘ）
 *   D. 栏目卡片 —— 核心操作 / 辅助 / 看板范围 …（R18：栏目名 = 卡片外的小标签 .kbt-lb）
 *   E. 帮助 —— 每页一栏入口，点开可上下滑动的悬浮小窗；条目是「键 + 说明」一行一条
 *   F. 手机端 —— 窄窗媒体查询 + 触控尺寸 + 触屏不叠 tooltip
 *   G. 配色降饱和 —— 马卡龙色取自主题色变量、按钮改淡底、样式零裸色
 *   H. 搜索 —— 本页无命中时提示「其他页 N 处」（可点跳转），不打断当前页（R18 调整） */
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

async function boot(app, modules, extra) {
  const KBplugin = require("../main.js");
  const plugin = new KBplugin(app, { id: "kb-toolkit", dir: ".obsidian/plugins/kb-toolkit" });
  plugin.data = Object.assign({ modules: modules, wizardDone: true }, extra || {});
  await plugin.onload();
  return plugin;
}
function findSettingEl(containerEl, name) {
  for (const el of containerEl.querySelectorAll("*")) {
    const s = el._setting;
    if (s && s._name === name) return el;
  }
  return null;
}

(async function main() {
  /* ================= A~E：设置页本体 ================= */
  {
    const app = STUB.makeApp();
    const plugin = await boot(app, { rebuild: true, automation: true, base: true });
    const tab = plugin.settingTab;
    tab.containerEl = document.createElement("div");
    document.body.appendChild(tab.containerEl);
    tab.display();

    /* ---- A. 页头（R18：标题 + 版本号；两个入口挪到标签行） ---- */
    const head = tab.containerEl.querySelector(".kbt-head");
    ok(!!head && !!head.querySelector("h3"), "A1：页头有标题（知识库工具集）");
    const verEl = head.querySelector(".kbt-ver");
    ok(!!verEl && /^v\d/.test(verEl.textContent || ""),
      "A2：页头右上角是版本号（" + (verEl && verEl.textContent) + "）");
    const ghostWrap = tab.containerEl.querySelector(".kbt-tabs .kbt-ghost-btns");
    ok(!!ghostWrap, "A3：日志 / 关于 挂在标签行里（效果图 .tbs > .ghs）");
    const headBtns = ghostWrap ? [...ghostWrap.querySelectorAll(".kbt-ghost-btn")] : [];
    eq(headBtns.length, 2, "A4：日志 / 关于 两个入口");
    eq(headBtns.map(b => b.textContent).join(","), "日志,关于", "A5：顺序 = 日志 → 关于（靠右）");

    /* ---- B. 三标签 ---- */
    const tabs = [...tab.containerEl.querySelectorAll(".kbt-tab")];
    eq(tabs.length, 3, "B1：三个标签（知识库 / 笔记 / Base）");
    eq(tabs.map(t => t.textContent).join(","), "知识库,笔记,Base", "B2：标签名（R16 去掉 ①②③ 序号）");
    ok(tabs[0].classList.contains("kbt-dot-mint")
      && tabs[1].classList.contains("kbt-dot-cream")
      && tabs[2].classList.contains("kbt-dot-taro"),
      "B3：三个标签各一种马卡龙圆点（薄荷 / 奶油 / 藕荷）");
    ok(tabs[0].classList.contains("is-active") && !tabs[1].classList.contains("is-active"),
      "B4：默认停在第一个标签");
    const gs = [...tab.containerEl.querySelectorAll(".kbt-group")];
    eq(gs.length, 3, "B5：三组都渲染（切页只切显示，不影响既有断言）");
    ok(!gs[0].classList.contains("kbt-hidden") && gs[1].classList.contains("kbt-hidden")
      && gs[2].classList.contains("kbt-hidden"), "B6：只有当前标签页的组可见");
    tabs[2].click();
    ok(tabs[2].classList.contains("is-active") && !tabs[0].classList.contains("is-active")
      && !gs[2].classList.contains("kbt-hidden") && gs[0].classList.contains("kbt-hidden"),
      "B7：点「Base」→ 切过去（激活态 + 组显隐同步）");
    const headMod = findSettingEl(tab.containerEl, "新建知识库");
    headMod._setting._toggle.onChange(false);
    await sleep(30);
    ok(tabs[0].classList.contains("is-off"), "B8：模块关 → 标签圆点转灰（is-off）");
    headMod._setting._toggle.onChange(true);
    await sleep(30);
    ok(!tabs[0].classList.contains("is-off"), "B9：模块开 → 圆点回到马卡龙色");

    /* ---- C. 模块头三层 ---- */
    ok(headMod.classList.contains("kbt-switch"), "C1：模块开关是滑动长条（kbt-switch，不是打勾）");
    ok(headMod.classList.contains(KB.modules.ANCHOR_CLS), "C2：锚点仍在第一个模块标题行（keepAnchor 不空跑）");
    ok(!!gs[0].querySelector(".kbt-rule"), "C3：标题下一条左边短横");
    const infos = tab.containerEl.querySelectorAll(".kbt-info");
    eq(infos.length, KB.modules.TABS.length,
      "C4：每页状态行 1 个 ⓘ（R18：模块头不再挂 ⓘ，提示挪进状态行）");
    ok([...infos].every(b => (b.getAttribute("data-tip") || "").length > 0),
      "C5：每个 ⓘ 都带提示文案（悬停可见）");
    const st = tab._sectionBoxes.rebuild.querySelector(".kbt-status");
    ok(!!st && !!st.querySelector(".kbt-status-main") && !!st.querySelector(".kbt-status-sub"),
      "C6：短横下面是状态行（主行 + 副行）");
    ok(!!st.querySelector(".kbt-status-top .kbt-info"),
      "C6b：ⓘ 与状态文字同一行（效果图 .mstat）");
    await sleep(30);
    ok((st.querySelector(".kbt-status-main").textContent || "").indexOf("当前状态") === 0,
      "C7：状态自动读取（不用按钮触发）");

    /* ---- D. 栏目卡片 ---- */
    const cards = [...tab.containerEl.querySelectorAll(".kbt-card")];
    const labels = [...tab.containerEl.querySelectorAll(".kbt-lb")].map(e => e.textContent);
    ok(cards.length >= 4, "D1：页内分栏目卡片（不再堆在一起）");
    ok(labels.indexOf("核心操作") >= 0 && labels.indexOf("辅助") >= 0,
      "D2：核心操作与辅助分成两栏（R18：栏目名 = 卡片外的小标签）");
    ok(labels.indexOf("自动补全") >= 0 && labels.indexOf("批量操作") >= 0,
      "D3：笔记页分「自动补全 / 批量操作」");
    ok(labels.indexOf("内嵌视图") >= 0 && labels.indexOf("看板范围") >= 0,
      "D4：Base 页有「内嵌视图」与「看板范围」");
    ok(labels.indexOf("帮助") >= 0, "D5：每页底部一栏「帮助」");

    /* ---- E. 帮助（一栏入口 + 悬浮小窗） ---- */
    const helpRows = [...tab.containerEl.querySelectorAll(".kbt-help-row")];
    eq(helpRows.length, 3, "E1：每页底部各一栏「帮助」");
    const popR = tab._pops.rebuild;
    ok(!!popR && popR.hasAttribute("hidden"), "E2：帮助小窗默认收起");
    const items = popR.querySelectorAll(".kbt-help-item");
    const seps = popR.querySelectorAll(".kbt-help-sep");
    ok(items.length >= 3, "E3：小窗里有多条提示");
    eq(seps.length, items.length - 1, "E4：条目之间只用分隔线（条数 = 分隔线 + 1，不分栏）");
    ok([...items].every(it => it.querySelector(".kbt-hk") && it.querySelector(".kbt-hv")),
      "E4b：R18 起条目是「键 + 说明」一行一条（效果图 .hrow）");
    ok(!popR.querySelector(".kbt-pop-body [class*=col]"), "E5：正文里没有多列容器（单栏）");
    const helpBtn = [...helpRows[0].querySelectorAll("button")].find(b => b.textContent === "查看提示");
    ok(!!helpBtn, "E6：帮助栏有「查看提示」按钮");
    helpBtn.click();
    ok(!popR.hasAttribute("hidden"), "E7：点开 → 悬浮小窗显示");
    ok(!!popR.querySelector(".kbt-pop-mask") && !!popR.querySelector(".kbt-pop-x") && !!popR.querySelector(".kbt-pop-body"),
      "E8：小窗 = 遮罩 + 关闭钮 + 可滚动正文");
    ok((popR.textContent || "").indexOf("坚果云已同步完成") >= 0,
      "E9：安全门槛文案收进帮助（页面清爽但说明没丢）");
    popR.querySelector(".kbt-pop-x").click();
    ok(popR.hasAttribute("hidden"), "E10：点 × → 关闭");
    tab._openPop("about");
    ok(!tab._pops.about.hasAttribute("hidden") && popR.hasAttribute("hidden"),
      "E11：「关于」走同一套小窗，且打开时互斥（只留一个）");

    /* ---- H. 搜索：不打断当前页，命中他页给可点提示 ---- */
    tab._activateTab("rebuild");
    const nH = tab._applyFilter("排除目录");
    eq(nH, 0, "H1：命中在别的标签页时，本页计数 0");
    eq(tab._tab, "rebuild", "H2：不自动跳页 —— 停在当前屏（效果图 .hint）");
    const hintEl = tab.containerEl.querySelector(".kbt-search-empty");
    ok(hintEl.hidden === false, "H3：给出一条提示（不是静默空结果）");
    ok(hintEl.querySelectorAll(".kbt-hint-link").length >= 1, "H4：提示里列出「其他页 N 处」");
    hintEl.querySelector(".kbt-hint-link").click();
    eq(tab._tab, "base", "H5：点提示里的链接才跳过去");
    tab._applyFilter("");
    ok(!tab.containerEl.querySelector(".kbt-group[hidden]"), "H6：清空关键字 → 全部恢复");

    await plugin.onunload();
  }

  /* ================= F~G：样式源（手机端 + 配色） ================= */
  {
    const kbt = fs.readFileSync(path.join(PLUG, "styles_src", "kbt.css"), "utf8");
    ok(/@media \(max-width: 700px\)/.test(kbt), "F1：窄窗媒体查询在（卡片/标签/按钮重排）");
    ok(/\.is-mobile \.kbt-switch \.checkbox-container\s*{[^}]*width:\s*42px/.test(kbt),
      "F2：移动端触控开关加大（滑块更好按）");
    ok(/\.kbt-pop-body\s*{[^}]*overflow-y:\s*auto/.test(kbt)
      && /\.kbt-pop-body\s*{[^}]*-webkit-overflow-scrolling:\s*touch/.test(kbt),
      "F3：小窗正文可上下滑动（overflow-y:auto + 惯性滚动）");
    ok(/\.kbt-pop-win\s*{[^}]*max-height/.test(kbt) && /\.kbt-pop-win\s*{[^}]*min\(/.test(kbt),
      "F4：小窗限高 + 宽度自适应（min(460px, 92vw)）");
    ok(/\.kbt-tabs\s*{[^}]*overflow-x:\s*auto/.test(kbt) && /\.kbt-tab\s*{[^}]*white-space:\s*nowrap/.test(kbt),
      "F5：窄屏标签可横向滑动、不被压折行");
    ok(/@media \(hover: none\)[\s\S]*?\.kbt-info::after[\s\S]*?display:\s*none/.test(kbt),
      "F6：触屏不叠 tooltip（改成点 ⓘ 或看帮助栏）");
    ok(/\.is-mobile \.kbt-pop-win\s*{[^}]*96vw/.test(kbt), "F7：手机端小窗铺满可用宽度");

    eq((kbt.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0, "G1：kbt.css 零裸 hex（铁律 6）");
    ok(kbt.indexOf("var(--color-green)") >= 0 && kbt.indexOf("var(--color-yellow)") >= 0
      && kbt.indexOf("var(--color-purple)") >= 0,
      "G2：马卡龙三色取自主题色变量（薄荷/奶油/藕荷，不另造高饱和色）");
    ok(/\.kbt-switch \.checkbox-container\.is-enabled\s*{[^}]*var\(--interactive-accent\)/.test(kbt),
      "G3：滑块开态用主题强调色（降饱和：opacity）");
    ok(/\.kbt-group \.mod-cta,[\s\S]*?\.kbt-card \.mod-cta\s*{[\s\S]*?color-mix\(in srgb, var\(--color-purple\)/.test(kbt),
      "G4：主按钮降饱和为淡紫底（color-mix 调主题色，上一行留主题色兜底，零裸色）");
    ok(/\.kbt-status\.callout\s*{[\s\S]*?background:\s*transparent/.test(kbt),
      "G5：状态行去掉 callout 背景（素色，只留两行字）");
    ok(/\.kbt-rule\s*{[\s\S]*?width:\s*26px/.test(kbt), "G6：短横只占左边一小条（26px）");
    ok(/@media \(hover: none\)/.test(kbt) && kbt.indexOf("data-tip") >= 0,
      "G7：ⓘ 的提示挂在 data-tip 上（悬停显示）");
  }

  /* ============ I：复写病守卫（2026-09-18 抓到现行：36/60 被整份叠写两遍） ============ */
  {
    const srcDir = path.join(PLUG, "src");
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith(".js"));
    const marks = files.map(f => ({
      f: f,
      n: (fs.readFileSync(path.join(srcDir, f), "utf8").match(/KB\.define\("/g) || []).length
    }));
    const bad = marks.filter(m => m.n > 1);
    eq(bad.length, 0, "I1：src 每个文件只有 1 个 KB.define（叠写会出现 2 份）"
      + (bad.length ? " → " + bad.map(b => b.f + " x" + b.n).join(", ") : ""));

    const total = marks.reduce((s, m) => s + m.n, 0);
    eq(total, files.length - 1,
      "I2：define 总数 = 文件数 - 1（00_prelude 只定义注册器、自己不注册）");

    const dup = files.filter(f => {
      const t = fs.readFileSync(path.join(srcDir, f), "utf8");
      return t.indexOf(t.slice(0, 120), 1) > 0;   /* 开头 120 字符第二次出现 = 整段复写 */
    });
    eq(dup.length, 0, "I3：没有整份复写（头部片段只出现一次）"
      + (dup.length ? " → " + dup.join(", ") : ""));

    const junk = fs.readdirSync(srcDir).filter(f => !f.endsWith(".js"));
    eq(junk.length, 0, "I4：src 目录无残留临时文件" + (junk.length ? " → " + junk.join(", ") : ""));

    const mainPath = path.join(PLUG, "main.js");
    const mainTxt = fs.readFileSync(mainPath, "utf8");
    eq((mainTxt.match(/KB\.define\("/g) || []).length, total,
      "I5：main.js 里 define 次数与 src 一致（构建没漏拼、也没重复拼）");
    eq((mainTxt.match(/\/\* ===== 工厂实例化 ===== \*\//g) || []).length, 1,
      "I6：main.js 只实例化一次");

    const sumDir = d => fs.readdirSync(path.join(PLUG, d))
      .reduce((s, f) => s + fs.statSync(path.join(PLUG, d, f)).size, 0);
    const gap = fs.statSync(mainPath).size - (sumDir("src") + sumDir("vendor"));
    ok(gap >= 0 && gap < 4096,
      "I7：main.js ≈ src + vendor（差 " + gap + " 字节，超出 4KB 说明产物也被复写）");
  }

  console.log("\nR16 结果: " + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exitCode = 1; }
})();
