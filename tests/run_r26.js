/* kb-toolkit R26 断言：① 同一行卡片等高（短的留白）+ 板块级「卡片高度」
 *   ② 任务勾选框直接点（不用点进笔记）  ③ 滑块圆圈歪了（真机原生 CSS 压制）
 *   ④ 手机端长按呼出右键菜单  ⑤ 板块名单击改名。
 *
 * 老板原话（2026-09-20，4 张截图）：
 *   「笔记长度如果不够，会导致窗格显示不够长……统一窗格上下高度，笔记不够长就留白。
 *     并在右键菜单中新增对窗口显示高度的设置」
 *   「像这种可以勾选的框框，我希望可以直接操作是否勾选，而不必点进去才能勾」
 *   「滑块的圆圈图标歪了，修一下」
 *   「手机端长按任务栏可以自动呼出右键菜单，我要确保手机端体验」
 *   「板块重命名……鼠标悬停在名字那一栏，左键按一下即可开始修改名字」
 *
 * 🔴 本轮要钉的坑：
 *   ① 滑块歪的真因 = 原生 `input[type=range]`（0,1,1）压制裸 `.cb-wrange`（0,1,0）：
 *     height 被压成 6px、thumb 吃原生 top + 我们的 margin-top 双重偏移。
 *     选择器必须升到 input.cb-wrange + thumb top:0（harness 正、真机歪，正则看不见）。
 *   ② 勾选框映射是「第 n 个框 ↔ 全文第 n 个任务行」—— 框比任务行多 = 对不上号，
 *     宁可不绑（点不动）也别勾错行（写错文件）。
 *   ③ 点勾选框 ≠ 点正文：正文区 click = 就地编辑，必须 stopPropagation 拦住。
 *   ④ 继承值不写死：secH 为 null 时一个 CSS 变量都不写（同 R25 宽度那把尺子）。
 * 真引擎几何那刀在 tmp/render_r26.py（卡片等高 / thumb 对齐）。
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
  const j = text.indexOf("{", i + header.length - 1);
  if (j < 0) return "";
  let depth = 0, k = j;
  for (; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}") { depth--; if (depth === 0) { k++; break; } }
  }
  return text.slice(j, k);
}
function count(re, s) { return (s.match(re) || []).length; }

const cbRaw = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8");
const cb = stripComments(cbRaw);
const cssRaw = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
const mainJs = fs.readFileSync(path.join(PLUG, "main.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(PLUG, "styles.css"), "utf8");

/* ================= A. 配置层：板块级「卡片高度」 ================= */
console.log("\n== R26 · 配置层：板块级「卡片高度」 ==");

ok(count(/const K_SEC_H = "卡片高度";/g, cb) === 1, "A1：K_SEC_H = 卡片高度 只定义 1 次（复写病自检）");
ok(cb.indexOf('"propsOpen", "文件宽度", "卡片高度"]') >= 0,
  "A2：KNOWN_KEYS 连「卡片高度」一起认（写回不会漏、也不进 extra）");

/* 真的把 secHeight() 抠出来执行（比正则断言强：能验夹值/对齐/空值语义） */
const shM = cbRaw.match(/function secHeight\(v\) \{[\s\S]*?\n\}/);
ok(!!shM, "A3：secHeight() 函数体定位得到");
const secHeight = shM ? new Function(shM[0] + "\nreturn secHeight;")() : (() => null);
eq(secHeight(260), 260, "A4：260 → 260");
eq(secHeight("300"), 300, "A5：字符串 '300' 也认（.base 里手写的值就是字符串）");
eq(secHeight(null), null, "A6：null → null（同行拉伸等高）");
eq(secHeight(""), null, "A7：空串 → null");
eq(secHeight(0), null, "A8：0 = 没设（别夹成 120 —— 那是「显式设成最小」）");
eq(secHeight(-5), null, "A9：负数同上");
eq(secHeight(90), 120, "A10：90 → 夹到下限 120");
eq(secHeight(500), 480, "A11：500 → 夹到上限 480");
eq(secHeight(333), 330, "A12：333 → 对齐到 10（330）");

ok(cb.indexOf("secH: secHeight(o[K_SEC_H] !== undefined ? o[K_SEC_H] : o.secHeight)") >= 0,
  "A13：normalizeSection 读「卡片高度 / secHeight」两个名字");
ok(cb.indexOf("if (sec.secH !== null && sec.secH !== undefined) o[K_SEC_H] = sec.secH;") >= 0,
  "A14：sectionToRaw 只在非 null 时写回（老配置一个字不动）");

const ovf = bodyOf(cb, "secHasOverride(i) {");
ok(ovf.indexOf("s.secH !== null && s.secH !== undefined") >= 0,
  "A15：secHasOverride 认 secH（有覆盖 → 「重置设置」才可点）");
const rsf = bodyOf(cb, "resetSection(i) {");
ok(rsf.indexOf("s.secH = null;") >= 0, "A16：resetSection 连 secH 一起清");
ok(cb.indexOf("secW: null, secH: null, extra: {}") >= 0,
  "A17：addSection 底座带 secH: null（新建板块 = 继承）");

const shof = bodyOf(cb, "secHeightOf(sec) {");
ok(shof.indexOf("sec && sec.spec") >= 0, "A18：高度挂在板块配置项上（sec.spec）");
ok(shof.indexOf("return secHeight(s.secH);") >= 0, "A19：走同一把夹值函数（不另写一套解析）");

/* ================= B. 渲染层：只在这个板块有覆盖时写变量 ================= */
console.log("\n== R26 · 渲染层：卡片高度写在 .cb-section 上 ==");

const rs = bodyOf(cb, "renderSection(parentEl, sec) {");
ok(rs.indexOf('const sh0 = this.secHeightOf(sec);') >= 0, "B1：renderSection 里取板块高度");
ok(/if \(sh0 !== null\) wrap\.style\.setProperty\("--cb-card-h", sh0 \+ "px"\);/.test(rs),
  "B2：🔴 有覆盖才写 --cb-card-h（没覆盖一个字不写，别把继承值写死）");
ok(rs.indexOf('--cb-card-w', 0) < rs.indexOf('--cb-card-h'), "B3：宽度行在前、高度行在后（同一处逻辑）");
ok(rs.indexOf("sec.__wrapEl = wrap;") >= 0, "B4：写在本板块容器上（子板块的卡片跟着继承）");

/* ================= C. 右键菜单：卡片高度两行版 ================= */
console.log("\n== R26 · 右键菜单：「卡片高度」两行版 ==");

ok(count(/const hrowSec = \(si2, secObj\) => \{/g, cb) === 1, "C1：hrowSec 只定义 1 次（复写病自检）");
const hr = bodyOf(cbRaw, "const hrowSec = (si2, secObj) => {");
ok(hr.indexOf('text: "卡片高度"') >= 0, "C2：行首标签 = 卡片高度");
ok(hr.indexOf('"min", "120"') >= 0 && hr.indexOf('"max", "480"') >= 0 && hr.indexOf('"step", "10"') >= 0,
  "C3：拉杆 120–480 / step 10");
ok(hr.indexOf("isFollowH = () => this.secs[si2].secH === null") >= 0,
  "C4：「跟随内容」现算（secH 为空即跟随），菜单里不另存状态");
ok(hr.indexOf('text: "跟随内容"') >= 0 && hr.indexOf('"data-key", "跟随内容"') >= 0,
  "C5：打勾项 = 跟随内容（跟「文件操作」组同一套打勾语言）");
ok(hr.indexOf("rg.disabled = follow;") >= 0, "C6：跟随时拉杆置灰（不做假控件）");
ok(hr.indexOf('we.style.setProperty("--cb-card-h", hnum2(rg.value) + "px")') >= 0,
  "C7：拖动中直写本板块的 --cb-card-h（不动 DOM 树）");
ok(hr.indexOf("this.secs[si2].secH = n;") >= 0, "C8：change → 写进板块配置");
ok(hr.indexOf("this.secs[si2].secH = null;") >= 0, "C9：取消跟随 → 删覆盖回继承");
ok(hr.indexOf("」卡片高度 → ") >= 0, "C10：状态栏文案报「卡片高度」");
ok(hr.indexOf("parseFloat(v)") >= 0, "C11：🔴 rg.value 是字符串 —— 忘了 parseFloat 就恒回默认值");
ok(/for \(const el of \[rg, fk\]\) \{/.test(hr) && hr.indexOf('el.addEventListener("mousedown", (evt) => evt.stopPropagation())') >= 0,
  "C12：🔴 控件 stopPropagation —— 不然外层 closer 把小窗收走");
ok(cb.indexOf("hrowSec(si, sec);") >= 0, "C13：菜单里真的调了 hrowSec（光定义不接 = 死代码）");
ok(cb.indexOf("三态项（继承 / 开 / 关）与「文件宽度 / 卡片高度」都只改这一块") >= 0,
  "C14：「显示帮助」的说明把高度也算进板块级清单");

/* ================= D. 任务勾选框直接点 ================= */
console.log("\n== R26 · 任务勾选框直接点 ==");

ok(count(/bindTaskToggles\(el, file, raw\) \{/g, cb) === 1, "D1：bindTaskToggles 只定义 1 次");
ok(cb.indexOf("this.bindTaskToggles(el, file, raw);") >= 0,
  "D2：loadBody 渲染完真的调了（raw = 全文，供行号映射）");
const bt = bodyOf(cbRaw, "bindTaskToggles(el, file, raw) {");
ok(bt.indexOf('querySelectorAll("input.task-list-item-checkbox")') >= 0,
  "D3：只认 Obsidian 渲出来的任务框");
ok(bt.indexOf('box.removeAttribute("disabled")') >= 0,
  "D4：🔴 摘 disabled —— Chrome 对 disabled 控件连 click 都不发（这就是「点不动」的根因）");
ok(bt.indexOf("taskIdx.push(i)") >= 0 && bt.indexOf("taskIdx[k]") >= 0,
  "D5：第 n 个框 ↔ 全文第 n 个任务行（顺序映射）");
ok(bt.indexOf("if (boxes.length > taskIdx.length) return;") >= 0,
  "D6：🔴 框比任务行多 = 对不上号 → 宁可不绑也别勾错行");
ok(bt.indexOf("if (!el || !file || this.readonly()) return;") >= 0, "D7：只读模式不绑（不写文件）");
ok(count(/box\.addEventListener\("click", \(evt\) => evt\.stopPropagation\(\)\)/g, bt) === 1
   && bt.indexOf('box.addEventListener("mousedown", (evt) => evt.stopPropagation())') >= 0,
  "D8：🔴 点框 ≠ 点正文 —— 不拦住会把就地编辑浮层带出来");
ok(bt.indexOf('box.addEventListener("change"') >= 0, "D9：写文件挂在 change（勾了才写）");

const tt = bodyOf(cbRaw, "toggleTaskLine(file, li, done, box) {");
ok(tt.indexOf("v.process(file, flip)") >= 0, "D10：原子写走 vault.process");
ok(tt.indexOf('v.read(file).then((c) => v.modify(file, flip(c)))') >= 0,
  "D11：老接口退 read/modify（不至一行写不了）");
ok(tt.indexOf('line.replace(/\\[( |x|X)\\]/, "[x]")') >= 0
   && tt.indexOf('line.replace(/\\[( |x|X)\\]/, "[ ]")') >= 0,
  "D12：翻转 = 把那一行的任务标记 [ ]↔[x]");

/* ================= E. 长按呼出菜单（手机端） ================= */
console.log("\n== R26 · 长按呼出菜单（手机端） ==");

ok(count(/bindLongPress\(el, onFire\) \{/g, cb) === 1, "E1：bindLongPress 只定义 1 次");
const bl = bodyOf(cbRaw, "bindLongPress(el, onFire) {");
ok(bl.indexOf('el.addEventListener("touchstart"') >= 0
   && bl.indexOf('el.addEventListener("touchmove"') >= 0
   && bl.indexOf('el.addEventListener("touchend", stop') >= 0
   && bl.indexOf('el.addEventListener("touchcancel", stop') >= 0,
  "E2：四件套齐 —— start 起表 / move 取消 / end·cancel 收表");
ok(bl.indexOf("}, 550);") >= 0, "E3：长按时长 550ms（系统长按要抢不过它）");
ok(bl.indexOf("Math.abs(te.clientX - sx) > 10 || Math.abs(te.clientY - sy) > 10") >= 0,
  "E4：位移 > 10px = 在滚动/拖动 → 立刻取消（不误弹）");
ok(bl.indexOf("try { evt.preventDefault(); } catch (e) {}") >= 0,
  "E5：触发时 preventDefault（别接着变成滚动 / 系统长按菜单）");
ok(bl.indexOf("onFire(sx, sy, evt.target)") >= 0, "E6：把触点坐标与目标元素都交出去");
ok(bl.indexOf("{ passive: false }") >= 0, "E7：touchstart 非 passive（preventDefault 才有效）");

ok(cb.indexOf('this.bindLongPress(head, (x, y) => this.openSecMenu(sec, x, y));') >= 0,
  "E8：板块标题长按 → 同一份右键小窗（手机端没有右键）");
ok(cb.indexOf("this.bindLongPress(card, (x, y, tgt) => {") >= 0, "E9：卡片长按 → 笔记操作菜单");
ok(cb.indexOf('tgt.closest("a, input, textarea, button, .cb-pros-toggle")') >= 0,
  "E10：🔴 链接/输入框/按钮上不抢（那里长按有系统自己的语义）");

/* ================= F. 板块名单击改名 ================= */
console.log("\n== R26 · 板块名单击改名 ==");

ok(cbRaw.indexOf('nameEl.setAttr("title", "点一下改名；拖动这一行可以给板块排序")') >= 0,
  "F1：tooltip 改口「点一下改名」（截图里那条「双击改名」气泡）");
ok(/nameEl\.addEventListener\("click", \(evt\) => \{\s*evt\.stopPropagation\(\);\s*this\.beginRenameSection\(sec, nameEl\);/.test(cb),
  "F2：单击板块名 → 就地改名");
ok(cb.indexOf('nameEl.addEventListener("dblclick"') >= 0, "F3：dblclick 保留（老习惯不破）");
ok(cb.indexOf("nameEl.__cbRenaming") >= 0, "F4：beginRenameSection 有防重入（连点不开两个输入框）");
ok(rs.indexOf("secConfigurable(sec) && !this.readonly()") >= 0,
  "F5：仍是「配置给的板块 + 非只读」才给入口（自动分组/公式组不冒充）");

/* ================= G. CSS：等高 / 固定高 / 滑块修歪 ================= */
console.log("\n== R26 · CSS ==");

ok(/\.cb-grid \{[\s\S]*?align-items: stretch;/.test(cssRaw),
  "G1：🔴 栅格 align-items: stretch —— 同一行卡片拉伸等高（原来是 start，参差的根因）");
ok(/--cb-card-h: auto;/.test(cssRaw), "G2：--cb-card-h 有默认声明（auto = 不固定）");
ok(/\.cb-card \{[\s\S]*?height: var\(--cb-card-h, auto\);/.test(cssRaw),
  "G3：卡片吃 --cb-card-h（没设 = auto，设了 = 固定高）");
ok(/\.cb-body \{[\s\S]*?min-height: 0;/.test(cssRaw),
  "G4：正文 min-height:0 —— 固定高时能被压缩、长文在卡片里滚");
ok(cssRaw.indexOf("input.cb-wrange {") >= 0, "G5：🔴 拉杆选择器升到 input.cb-wrange（0,1,1）");
ok(cssRaw.indexOf("input.cb-wrange::-webkit-slider-runnable-track {") >= 0
   && cssRaw.indexOf("input.cb-wrange::-webkit-slider-thumb {") >= 0
   && cssRaw.indexOf("input.cb-wrange::-moz-range-track {") >= 0
   && cssRaw.indexOf("input.cb-wrange::-moz-range-progress {") >= 0
   && cssRaw.indexOf("input.cb-wrange::-moz-range-thumb {") >= 0
   && cssRaw.indexOf("input.cb-wrange:disabled {") >= 0,
  "G6：六段选择器全升（漏一段就被原生压一段）");
const thumbSeg = cssRaw.slice(cssRaw.indexOf("input.cb-wrange::-webkit-slider-thumb {"));
ok(/top: 0;\s*\/\* 🔴 R26/.test(thumbSeg),
  "G7：🔴 thumb 显式 top:0 压掉原生 top: var(--slider-thumb-y)（双重偏移 = 圆圈上天）");
ok(/margin-top: -5px;\s*\/\* \(轨道5 - 滑块15\) \/ 2/.test(thumbSeg),
  "G8：margin-top 公式留在盘上（(5-15)/2，harness 像素实测圆环中心 = 轨道中心）");
ok(cssRaw.indexOf("background: transparent;   /* 压掉原生 background-color") >= 0,
  "G9：input 自己的灰底压掉（否则 16px 高的灰条穿帮）");
ok(cssRaw.indexOf(".cb-body input.task-list-item-checkbox {") >= 0
   && cssRaw.indexOf("cursor: pointer;") >= 0,
  "G10：勾选框摘了 disabled 后手感 = 能点的框");
ok(!/^\s*\.cb-wrange \{/m.test(cssRaw),
  "G11：裸 .cb-wrange 本体选择器不再出现（残留 = 又被原生压回去；.cb-ctx-wrow 的覆盖不算）");

/* ================= H. main.js 内嵌一致 ================= */
console.log("\n== R26 · 构建产物 ==");

ok(mainJs.indexOf('const K_SEC_H = "卡片高度";') >= 0, "H1：main.js 内嵌了 R26 的键");
ok(mainJs.indexOf("bindTaskToggles") >= 0 && mainJs.indexOf("bindLongPress") >= 0
   && mainJs.indexOf("hrowSec") >= 0, "H2：三个新能力都进了出货代码");
ok(stylesCss.indexOf("input.cb-wrange::-webkit-slider-thumb {") >= 0
   && stylesCss.indexOf("align-items: stretch;") >= 0,
  "H3：styles.css 同步（改了源没 build = 老板真机上什么都没变）");
ok(Buffer.byteLength(mainJs, "utf8") > 500000, "H4：main.js 体积合理（>500KB）");

/* ================= I. 兼容（R25 那套不能被碰坏） ================= */
console.log("\n== R26 · 兼容 ==");

ok(count(/const K_SEC_W = "文件宽度";/g, cb) === 1, "I1：K_SEC_W 仍只定义 1 次");
ok(count(/const wrowSec = \(si2, secObj\) => \{/g, cb) === 1, "I2：wrowSec（宽度行）原样在");
ok(count(/const hrowSec = \(si2, secObj\) => \{/g, cb) === 1
   && count(/const wrowSec = \(si2, secObj\) => \{/g, cb) === 1,
  "I3：宽 / 高两行并存，谁也没覆盖谁");
ok(cb.indexOf('this.secs[si2].secW = n;') >= 0 && cb.indexOf('this.secs[si2].secW = null;') >= 0,
  "I4：宽度的写/清两条路没被动过");
ok(cb.indexOf("deleteSection(i) {") >= 0 && cb.indexOf("createInSection(sec, \"\", sec.__gridEl)") >= 0,
  "I5：R25 的删除/新建文件照旧");
ok(count(/addEventListener\("dblclick", \(evt\) => \{\s*evt\.preventDefault\(\);\s*evt\.stopPropagation\(\);\s*this\.cancelClick\(\);\s*this\.beginRenameSection/g, cb) === 1,
  "I6：板块名 dblclick 仍恰 1 处（单击改名没把它挤掉）");

/* ================= 汇总 ================= */
console.log("\nR26 结果: " + pass + " 通过 / " + fail + " 失败");
if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exitCode = 1; }
