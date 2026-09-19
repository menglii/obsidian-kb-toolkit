/* kb-toolkit R22 断言：看板「板块设置」面板 → **悬浮小窗**。
 *
 * 老板原话：「继续弄完，弄成悬浮窗，参考 html」（指 桌面/看板设置界面设计v2-效果图.html）。
 * 效果图那套 = `.mask`（inset:0 + --background-modifier-cover）+ `.win`
 *   （居中 / 宽 min(520px,94vw) / 高封顶 84vh / 头 + 标题 + ✕ / 正文自己滚）。
 *
 * 换台面的收益：面板**不再在工具条与看板之间占一行把看板往下挤**，浮在看板上；
 *   板块多时正文内部滚动，窗高封顶（效果图里就是这个观感）。
 *
 * ⚠️ 运行时的坑（正则抓不到）在 tests/run_r20b.js 的 R22 段兜底：
 *   真起视图 → 真点齿轮 → 真点 ✕ → 真点遮罩，逐项核「窗与遮罩同开同关」。
 */
const path = require("path");
const fs = require("fs");

const PLUG = path.join(__dirname, "..");
let pass = 0, fail = 0; const fails = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; fails.push(name); console.log("  FAIL " + name); }
}
function eq(a, b, name) {
  ok(a === b, name + " (got=" + JSON.stringify(a) + " want=" + JSON.stringify(b) + ")");
}
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function bodyOf(text, header) {
  const i = text.indexOf(header);
  if (i < 0) return "";
  let j = text.indexOf("{", i + header.length - 1), depth = 0, k = j;
  for (; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}") { depth--; if (depth === 0) { k++; break; } }
  }
  return text.slice(j, k);
}

const cb = stripComments(fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8"));
const cssRaw = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
const css = stripComments(cssRaw);

/* ================= A. DOM 结构：遮罩 + 窗 + ✕，都还在 rootEl 里（不是 Obsidian Modal） ================= */
{
  ok(cb.indexOf('this.maskEl = this.rootEl.createDiv({ cls: "cb-mask is-hidden" });') >= 0,
    "A1：遮罩挂在 rootEl 里（内嵌 DOM，离线套件照旧能查——不是 Obsidian 的 Modal）");
  ok(cb.indexOf('this.panelEl = this.rootEl.createDiv({ cls: "cb-panel is-hidden" });') >= 0,
    "A2：窗本体也挂在 rootEl 里");
  ok(/this\.panelEl\.setAttr\("role", "dialog"\)/.test(cb)
    && /this\.panelEl\.setAttr\("aria-label", "板块设置"\)/.test(cb),
    "A3：窗有 role=dialog + aria-label（无障碍名说清是什么窗）");
  /* 顺序：工具条 → 遮罩 → 窗 → 看板列表（遮罩在窗前面，z-index 才压得住） */
  const iBar = cb.indexOf("const bar = this.rootEl.createDiv");
  const iMask = cb.indexOf("this.maskEl = this.rootEl.createDiv");
  const iPanel = cb.indexOf("this.panelEl = this.rootEl.createDiv");
  const iList = cb.indexOf("this.listEl = this.rootEl.createDiv");
  ok(iBar >= 0 && iBar < iMask && iMask < iPanel && iPanel < iList,
    "A4：DOM 顺序 = 工具条 → 遮罩 → 窗 → 看板列表");
  ok(/cls: "cb-panel-x", text: "✕"/.test(cb), "A5：窗头有关闭按钮 .cb-panel-x（✕）");
  ok(/px\.setAttr\("title", "关闭"\);/.test(cb), "A6：✕ 有悬浮说明");
  ok(/px\.addEventListener\("click", \(\) => this\.closePanel\(\)\);/.test(cb),
    "A7：点 ✕ 走 closePanel（不留第二套收起逻辑）");
}

/* ================= B. 收起路径收敛：✕ / 遮罩 / 点窗外 / 再点齿轮 都走 closePanel ================= */
{
  ok(/^  closePanel\(\) \{/m.test(cb), "B1：closePanel 是正规方法定义");
  eq((cb.match(/closePanel\(\)\s*\{/g) || []).length, 1,
    "B2：closePanel 只定义一次（复写病自检）");
  const fn = bodyOf(cb, "closePanel() {");
  ok(/this\.panelOpen = false;/.test(fn), "B3：closePanel 把 panelOpen 置 false");
  ok(/this\.editIdx = -1;/.test(fn) && /this\.addOpen = false;/.test(fn) && /this\.confirmIdx = -1;/.test(fn),
    "B4：closePanel 顺手复位编辑行 / 添加面板 / 删除确认（不再各写一份）");
  ok(/this\.renderPanel\(\);/.test(fn), "B5：closePanel 末尾重绘（窗与遮罩一起收）");

  const rp = bodyOf(cb, "renderPanel() {");
  ok(/this\.panelEl\.toggleClass\("is-hidden", !this\.panelOpen\);/.test(rp),
    "B6：renderPanel 管窗的显隐");
  ok(/if \(this\.maskEl\) this\.maskEl\.toggleClass\("is-hidden", !this\.panelOpen\);/.test(rp),
    "B7：**遮罩跟着窗一起开关**（否则收起后留一层灰罩住看板，点哪儿都没反应）");
  ok(rp.indexOf("toggleClass(\"is-hidden\", !this.panelOpen)") < rp.indexOf("if (!this.panelOpen) return;"),
    "B8：两个 toggle 都在早退之前（收起来时也得把遮罩藏掉）");

  ok(/if \(this\.panelOpen\) \{\s*\n\s*this\.closePanel\(\);\s*\n\s*return;\s*\n\s*\}/.test(cb),
    "B9：齿轮开着时再点是「关」（走同一个 closePanel）");
  /* ⚠️ bodyOf 只认 `{}` 块 —— addOutsideCloser(...) 是圆括号调用，用 bodyOf 会抓到
     里面那段箭头函数体。这里直接从锚点切到该调用自己的 `);` 为止。 */
  const iOC = cb.indexOf('this.addOutsideCloser(\n      "panel",');
  const oc = iOC >= 0 ? cb.slice(iOC, cb.indexOf(");", iOC)) : "";
  ok(oc.indexOf("() => this.closePanel()") >= 0,
    "B10：点窗外那条路也改成调 closePanel（三处共用一条路）");
  ok(/t\.closest\("\.cb-panel"\)/.test(oc) && /t\.closest\("\.cb-gear"\)/.test(oc),
    "B11：点窗里 / 点齿轮本身不算「外面」（不动的那半个判断）");
  ok(iOC >= 0, "B12：outside-closer 仍以 panel 为 id 注册（遮罩点击即「点外面」，不必另绑）");
}

/* ================= C. CSS：遮罩 + 居中悬浮窗 ================= */
{
  /* 锚点必须用**未剥注释**的原文找 —— 结束标记 `/* ---------- 开关` 本身就是注释，
     剥完就找不到了（r21 的 E 组踩过同一个坑）。切片之后再剥。 */
  const i0 = cssRaw.indexOf(".cb-mask {");
  const i1 = cssRaw.indexOf("/* ---------- 开关");
  ok(i0 >= 0 && i1 > i0, "C1：R22 样式段落定位得到（.cb-mask → 开关段之前）");
  const blk = i0 >= 0 && i1 > i0 ? stripComments(cssRaw.slice(i0, i1)) : "";

  ok(/\.cb-mask\s*{[^}]*position:\s*fixed/.test(blk) && /\.cb-mask\s*{[^}]*inset:\s*0/.test(blk),
    "C2：遮罩铺满（fixed + inset:0）");
  ok(/\.cb-mask\s*{[^}]*z-index:\s*40/.test(blk), "C3：遮罩 z-index:40");
  ok(/\.cb-mask\s*{[^}]*background-color:\s*var\(--background-modifier-cover\)/.test(blk),
    "C4：遮罩用主题的 cover 变量（零裸色，明暗都合适）");
  ok(/\.cb-mask\.is-hidden\s*{\s*display:\s*none/.test(blk), "C5：遮罩也有 is-hidden 收起态");

  ok(/\.cb-panel\s*{[^}]*position:\s*fixed/.test(blk), "C6：窗本体 fixed（浮在看板上，不再占一行、不把看板挤下去）");
  ok(/\.cb-panel\s*{[^}]*z-index:\s*41/.test(blk), "C7：窗 z-index 高于遮罩（41 > 40，窗才在遮罩上面）");
  ok(/\.cb-panel\s*{[^}]*left:\s*50%/.test(blk) && /\.cb-panel\s*{[^}]*top:\s*50%/.test(blk)
    && /\.cb-panel\s*{[^}]*transform:\s*translate\(-50%,\s*-50%\)/.test(blk),
    "C8：居中（left/top 50% + translate(-50%,-50%)，同效果图）");
  ok(/\.cb-panel\s*{[^}]*width:\s*min\(520px,\s*94vw\)/.test(blk),
    "C9：宽度 min(520px, 94vw)（窄视图里也不会溢出）");
  ok(/\.cb-panel\s*{[^}]*max-height:\s*min\(84vh,\s*720px\)/.test(blk),
    "C10：高度封顶 min(84vh, 720px)");
  ok(/\.cb-panel\s*{[^}]*overflow:\s*hidden/.test(blk), "C11：窗本体 overflow:hidden（圆角才切得干净）");
  ok(/\.cb-panel\s*{[^}]*border-radius:\s*var\(--radius-l\)/.test(blk),
    "C12：圆角走 --radius-l（比原来内嵌的 --radius-m 更大，像张浮窗）");
  ok(/\.cb-panel\s*{[^}]*background-color:\s*var\(--background-primary\)/.test(blk),
    "C13：窗底 = --background-primary（浮在灰板上面，与效果图一致）");
  ok(/\.cb-panel\s*{[^}]*box-shadow:\s*var\(--shadow-s\)/.test(blk),
    "C14：投影 --shadow-s（脱离板面才看得出来是浮的）");
  ok(/\.cb-panel\s*{[^}]*display:\s*flex/.test(blk) && /\.cb-panel\s*{[^}]*flex-direction:\s*column/.test(blk),
    "C15：窗是列向 flex（头固定 + 正文伸缩）");

  ok(/\.cb-panel-head\s*{[^}]*flex:\s*0 0 auto/.test(blk), "C16：窗头不参与伸缩");
  ok(/\.cb-panel-head\s*{[^}]*padding:\s*var\(--size-4-2\)\s*var\(--size-4-3\)/.test(blk),
    "C17：窗头内边距走 --size-4-*（与设置页同一套间距）");
  ok(/\.cb-panel-head\s*{[^}]*border-bottom:\s*1px solid var\(--background-modifier-border\)/.test(blk),
    "C18：窗头与正文之间有分隔线");
  ok(/\.cb-panel-head\s*{[^}]*align-items:\s*center/.test(blk),
    "C19：窗头改成 center 对齐（原来 baseline —— ✕ 按钮按 baseline 会飘）");
  ok(css.indexOf("align-items: baseline") < 0 || !/\.cb-panel-head\s*{[^}]*baseline/.test(blk),
    "C20：旧的内嵌态 baseline 对齐已撤（✕ 是按钮，不是文字）");

  ok(/\.cb-panel-msg\s*{[^}]*margin-left:\s*auto/.test(blk),
    "C21：状态字 margin-left:auto —— 把 ✕ 顶到窗头最右");
  ok(/\.cb-panel-msg\s*{[^}]*white-space:\s*nowrap/.test(blk), "C22：状态字不换行（「已写入 .base」不折成两行）");

  ok(/\.cb-panel-x\s*{[^}]*border:\s*none/.test(blk) && /\.cb-panel-x\s*{[^}]*background:\s*transparent/.test(blk),
    "C23：✕ 是素色按钮（无边框、透明底，同栏内按钮风格）");
  ok(/\.cb-panel-x:hover\s*{[^}]*background-color:\s*var\(--background-modifier-hover\)/.test(blk),
    "C24：✕ hover 有反馈");

  ok(/\.cb-panel-body\s*{[^}]*flex:\s*1 1 auto/.test(blk) && /\.cb-panel-body\s*{[^}]*min-height:\s*0/.test(blk),
    "C25：正文区伸缩 + min-height:0（不加这条 flex 子项不肯缩，滚不出滚动条）");
  ok(/\.cb-panel-body\s*{[^}]*overflow-y:\s*auto/.test(blk), "C26：正文自己滚（板块多时窗高封顶）");
  ok(/\.cb-panel-body\s*{[^}]*overscroll-behavior:\s*contain/.test(blk),
    "C27：滚到底不再带动看板一起滚（overscroll-behavior:contain）");
  ok(/\.cb-panel-body\s*{[^}]*padding:\s*var\(--size-4-3\)/.test(blk), "C28：正文内边距 --size-4-3");

  /* 零裸色：R22 段里不许出现 hex / rgb() / hsl() 字面量（var(...) 里不算） */
  const noVar = blk.replace(/var\([^)]*\)/g, "VAR");
  const bare = noVar.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [];
  eq(bare.length, 0, "C29：R22 段零裸色（实到 " + JSON.stringify(bare) + "）");
}

console.log("\nR22 结果: " + pass + " 通过 / " + fail + " 失败");
if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
