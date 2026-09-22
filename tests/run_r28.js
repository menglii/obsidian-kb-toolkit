/* kb-toolkit R28 断言：兜底「全部」板块默认上限 50 + 「显示全部（慎用）」；正文渲染限并发。
 *
 * 老板原话（2026-09-20，报障截图）：
 *   「当删除看板后，默认显示的全部看板会导致整个数据库卡住，各类操作都变得很卡甚至不响应」
 * 老板拍板（R28 两个问题）：
 *   ① 兜底「全部」板块 → **默认上限 50 + 显示全部**
 *   ② 卡片正文里的内嵌看板（```base）→ **照渲但限并发**
 *
 * 🔴 本轮要钉的坑：
 *   ① **兜底分支绕开一切护栏**：`buildSections()` 没配置时 return 的「全部」把 `all`
 *      原样丢进去 —— 没有 limit、也不吃 `totalCap()`（默认 0）。板块被删空 = 直接裸奔。
 *      所以这里既要**加限**，也要**如实报**（工具条写截断数），还要给**看得见的门**
 *      （标题旁的「显示全部」按钮），三件缺一不可 —— 少最后一件就是「把笔记藏起来」。
 *   ② **「换台面」的键必须进 computeSig()**（铁律 56）：K_ALL 能在看板上被点着改，
 *      不进 sig 的 parts 就是「点了不生效但全绿」。
 *   ③ **并发上限不能是 0**：`batch.length < conc` 里 conc=0 会让内层 while 一次不跑
 *      → 外层 while 拿不掉队列 → **活锁**（不是卡死，是空转）。必须 `Math.max(1, …)`。
 *   ④ **出错也要把状态推到 done**：原来 `await this.loadBody(item)` 抛了就直接跳出 try，
 *      队列里那一篇永远停在 "rendering" → 工具条「正文 N/M」永远差一个。runBodyJob 兜住。
 *   ⑤ **CSS 浅底要留兜底行**：color-mix 老引擎不认（铁律：前一行必须留 background-secondary）。
 * 真 DOM 那一刀加在 tests/run_r20b.js 的 R28 段（源码正则抓不到「点了没反应」）。
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
function count(re, s) { return (s.match(re) || []).length; }
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

const cbRaw = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8");
const cb = stripComments(cbRaw);
const cssRaw = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
const mainJs = fs.readFileSync(path.join(PLUG, "main.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(PLUG, "styles.css"), "utf8");

const R28_MARK = "R28（老板报障：删空板块后";
/* 🔴 R33 修（同 R29 修 r27 那次，铁律 49）：原来一路切到**文件尾**，后面每一轮追加的
 * CSS 都被算进「R28 段」—— R33 在触控兜底 :is() 里点了 .cb-sec-allbtn，F2 立刻假红。
 * 段就是段：切到**下一个轮次横幅**为止。 */
function segToNext(s, mark, nextMark) {
  const a = s.indexOf(mark);
  const b = s.indexOf(nextMark, a + 1);
  return s.slice(a, b < 0 ? s.length : s.lastIndexOf("/*", b));
}
const cssSeg = segToNext(cssRaw, R28_MARK, "R29（");
const builtSeg = segToNext(stylesCss, R28_MARK, "R29（");

/* ================= A. 配置层：新键 / 新常量 ================= */
console.log("\n== R28 · 配置层：全部板块上限 ==");

eq(count(/const K_ALL = "全部板块上限";/g, cbRaw), 1, "A1：K_ALL 只定义 1 次（复写病自检）");
ok(count(/const K_ALL = "全部板块上限";/g, cbRaw) === count(/const K_ALL = /g, cbRaw),
  "A2：没有第二处 K_ALL 常量（别被重复定义悄悄覆盖）");
ok(/const K_ALL = "全部板块上限";\s*\n?/.test(cbRaw) && /const K_CAP = "总条数上限";/.test(cbRaw),
  "A3：K_ALL 与 K_CAP（总条数上限）并存 —— 一个是全局池、一个是兜底块，别合并");
eq(count(/const DEFAULT_ALL_CAP = 50;/g, cb), 1, "A4：DEFAULT_ALL_CAP = 50（老板拍板的默认值）");
eq(count(/allCap: 50,/g, cb), 1, "A5：DEFAULT_SETTINGS.allCap = 50（插件级默认，设置页能改）");
ok(/const na = Math\.floor\(num\(PLUGIN_SETTINGS\.allCap, DEFAULT_ALL_CAP\)\);/.test(cb),
  "A6：loadSettings 把 allCap 归一（脏值不落地）");
ok(/PLUGIN_SETTINGS\.allCap = isFinite\(na\) && na > 0 \? na : 0;/.test(cb),
  "A7：归一规则 = 正整数保留，其余归 0（0 = 不限，不许负/NaN）");

const allCapBody = bodyOf(cb, "allCap()");
ok(!!allCapBody, "A8：allCap() 方法存在");
ok(/optNum\(K_ALL, dflt\)/.test(allCapBody), "A9：视图级 K_ALL 优先");
ok(/PLUGIN_SETTINGS\.allCap/.test(allCapBody) && /DEFAULT_ALL_CAP/.test(allCapBody),
  "A10：没写过视图键 → 回落到插件设置 → 再回落常量 50");

/* ================= B. 兜底「全部」板块真的被限住 ================= */
console.log("\n== R28 · 兜底「全部」加限 + 如实报 ==");

const bsBody = bodyOf(cb, "  buildSections() {");
ok(!!bsBody, "B1：buildSections() 可定位");
ok(bsBody.indexOf("this.sections") < 0, "B1b：抓到的是**定义**不是调用点（this.sections = this.buildSections() 在前面）");
ok(/this\.allCappedCount = 0;/.test(bsBody), "B2：进 buildSections 先重置 allCappedCount（每次重算不吃旧值）");
ok(/const lim = this\.allCap\(\);/.test(bsBody), "B3：兜底分支读 allCap()");
ok(/if \(lim > 0 && all\.length > lim\)/.test(bsBody), "B4：lim = 0 时**不截断**（「显示全部」那条路走得通）");
ok(/this\.allCappedCount = all\.length - lim;/.test(bsBody), "B5：截断数如实记账");
ok(/shown = all\.slice\(0, lim\);/.test(bsBody), "B6：只截 entries");
ok(/entries: shown, children: \[\], total: all\.length, shownCount: shown\.length/.test(bsBody),
  "B7：total 报**真实总数**、shownCount 报**实际渲染数**（标题写 50 / 120 条才有依据）");
ok(/name: "全部", source: "all"/.test(bsBody), "B8：兜底块的 source 仍是 \"all\"（按钮的判据）");

ok(/if \(this\.allCappedCount\) txt \+= " · 全部板块超上限截断 " \+ this\.allCappedCount \+ " 篇";/.test(cb),
  "B9：工具条如实写「全部板块超上限截断 N 篇」（不静默截断）");
ok(!/allCappedCount/.test(bodyOf(cb, "totalCap()")),
  "B10：allCappedCount 不混进 totalCap()（一个是池上限、一个是块上限）");

/* ================= C. 「显示全部（慎用）」按钮 ================= */
console.log("\n== R28 · 「显示全部（慎用）」按钮 ==");

const rsBody = bodyOf(cb, "renderSection(parentEl, sec)");
ok(!!rsBody, "C1：renderSection() 可定位");
ok(/if \(sec\.source === "all" && !this\.readonly\(\)\)/.test(rsBody),
  "C2：按钮只在兜底「全部」块上出现，且只读模式不给（它要写配置）");
ok(/cls: "cb-sec-allbtn"/.test(rsBody), "C3：按钮类名 = .cb-sec-allbtn");
ok(/ab\.setText\("显示全部 " \+ sec\.total \+ " 篇（慎用）"\);/.test(rsBody),
  "C4：上限生效时 → 文案带**真实总数**（「显示全部 120 篇（慎用）」）");
ok(/ab\.setText\("恢复上限 " \+ DEFAULT_ALL_CAP \+ " 篇"\);/.test(rsBody),
  "C5：不限时 → 按钮变成「恢复上限 50 篇」（可逆，不是单向门）");
ok(/this\.cfgSet\(K_ALL, 0\);/.test(rsBody), "C6：点「显示全部」→ 视图键写 0（不限）");
ok(/this\.cfgSet\(K_ALL, null\);/.test(rsBody), "C7：点「恢复上限」→ 删键（回到插件默认，不是写死 50）");
ok(/this\.sig = null;/.test(rsBody), "C8：改完清签名（铁律 56 —— 不清就点了不生效）");
ok(/this\.repaint\(true\);/.test(rsBody), "C9：清签名后**强制**重画");
ok(/evt\.preventDefault\(\);\s*\n\s*evt\.stopPropagation\(\);/.test(rsBody),
  "C10：stopPropagation —— 别顺手触发板块标题的单击改名 / 右键菜单");

const sigBody = bodyOf(cb, "computeSig()");
ok(/String\(this\.cfgGet\(K_ALL, "~"\)\)/.test(sigBody),
  "C11：K_ALL 进 computeSig（铁律 56：能在看板上改、又影响渲染的键一个都不能漏）");

const cntTxtOk = /sec\.shownCount \+ " \/ " \+ sec\.total \+ " 条"/.test(rsBody);
ok(cntTxtOk, "C12：标题条数写「显示 / 总数」（50 / 120 条），别让人数着 50 张卡看标题写 120");

/* ================= D. 配置搬运 + 设置页 ================= */
console.log("\n== R28 · 搬运 / 设置页 ==");

ok(/if \(this\.cfgGet\(K_ALL, undefined\) !== undefined\) view\[K_ALL\] = this\.optNum\(K_ALL, DEFAULT_ALL_CAP\);/.test(cb),
  "D1：导出只在**显式设过**时带 K_ALL（没拨过别把默认固化进 .base）");
ok(/kinds\[K_ALL\] = "num";/.test(cb), "D2：导入认 K_ALL（跟导出对称，否则搬过去静默丢）");
ok(/field\("性能护栏 · 全部板块上限",[^\n]*"int", "allCap"\);/.test(cb),
  "D3：设置页有「性能护栏 · 全部板块上限」且落的是 allCap");
ok(/性能护栏 · 全部板块上限[\s\S]{0,220}显示全部（慎用）/.test(cbRaw),
  "D4：那条设置项的说明里写清了逃生门在哪（用户不用翻代码）");

/* ================= E. 正文渲染限并发 ================= */
console.log("\n== R28 · 正文渲染限并发 ==");

const pumpBody = bodyOf(cb, "async pumpBody()");
ok(!!pumpBody, "E1：pumpBody() 可定位");
eq(count(/const BODY_CONCURRENCY = 2;/g, cb), 1, "E2：BODY_CONCURRENCY 只定义 1 次");
eq(count(/const BODY_YIELD_MS = 16;/g, cb), 1, "E3：BODY_YIELD_MS 只定义 1 次");
ok(/this\.bodyConcurrency = BODY_CONCURRENCY;/.test(cb) && /this\.bodyYieldMs = BODY_YIELD_MS;/.test(cb),
  "E4：两个值都做成**实例字段**（测试才能设 0，不用真等）");
ok(/const conc = Math\.max\(1, Math\.floor\(this\.bodyConcurrency\) \|\| 1\);/.test(pumpBody),
  "E5：conc 兜底 ≥1 —— conc=0 会让内层 while 一次不跑、队列拿不掉 → **活锁**");
ok(/while \(batch\.length < conc && this\.bodyQueue\.length\)/.test(pumpBody),
  "E6：一批最多 conc 篇");
ok(/await Promise\.all\(batch\.map\(\(it\) => this\.runBodyJob\(it\)\)\);/.test(pumpBody),
  "E7：批内并发、批间串（Promise.all 一批，跑完才拿下一批）");
ok(/if \(this\.bodyQueue\.length\) await this\.bodyYield\(\);/.test(pumpBody),
  "E8：批与批之间**让出一帧**（治的是「主线程被连成一片」）");
ok(/item\.state = "rendering";/.test(pumpBody) && /batch\.push\(item\);/.test(pumpBody),
  "E9：进批即置 rendering（工具条计数才有中间态）");

const jobBody = bodyOf(cb, "async runBodyJob(item)");
ok(!!jobBody, "E10：runBodyJob() 存在（把单篇渲染从队列里拆出来）");
ok(/try \{[\s\S]*await this\.loadBody\(item\);[\s\S]*\} catch \(e\) \{/.test(jobBody),
  "E11：单篇抛异常被兜住（原来一抛就跳出 try → 那篇永远停在 rendering）");
ok(/item\.state = "done";/.test(jobBody), "E12：无论成败都推进到 done（工具条「正文 N/M」不会永远差一个）");

const yieldBody = bodyOf(cb, "  bodyYield() {");
ok(!!yieldBody, "E13：bodyYield() 存在（且抓到的是定义，不是 pumpBody 里的调用点）");
ok(/if \(!ms\) return Promise\.resolve\(\);/.test(yieldBody),
  "E14：ms = 0 直接 resolve（测试设 0 时不让帧，跑得快）");
ok(/setTimeout\(r, ms\)/.test(yieldBody),
  "E15：用 setTimeout 不用 requestAnimationFrame（jsdom 没 rAF，后台标签页也不出帧）");

/* ================= F. CSS ================= */
console.log("\n== R28 · 样式 ==");

ok(cssSeg.indexOf("R28") === 0, "F1：cb.css 里有 R28 段（本文件最后一段）");
eq(count(/\.cb-sec-allbtn\b/g, cssSeg), 2, "F2：恰好两条规则（本体 + :hover）");
ok(/\.cb-sec-allbtn\s*\{/.test(cssSeg) && /\.cb-sec-allbtn:hover\s*\{/.test(cssSeg), "F3：两条都是 .cb-sec-allbtn");
ok(/color-mix\(in srgb, var\(--color-yellow\) 16%, var\(--background-primary\)\)/.test(cssSeg),
  "F4：浅底走主题色 mix（不是硬编码色）");
ok(/background-color: var\(--background-secondary\);\s*\n\s*background-color: color-mix\(/.test(cssSeg),
  "F5：color-mix 的**前一行**是 background-secondary 兜底（老引擎不认 mix，顺序不能颠倒）");
ok(/cursor: pointer;/.test(cssSeg), "F6：按钮是真可点的（cursor: pointer）");
ok(/white-space: nowrap;/.test(cssSeg), "F7：文案不折行（标题行是 flex，折了会把板块头撑高）");
{
  /* 零裸色：剥掉 var(...) 后不许剩 hex / rgb / 具名色 */
  function stripVarFallbacks(s) {
    let out = "", i = 0;
    while (i < s.length) {
      const rest = s.slice(i);
      const open = rest.indexOf("var(");
      if (open < 0) { out += rest; break; }
      out += rest.slice(0, open);
      let j = i + open + 4, level = 1;
      while (j < s.length && level > 0) {
        if (s[j] === "(") level++;
        else if (s[j] === ")") level--;
        j++;
      }
      i = j;
    }
    return out;
  }
  const bare = stripVarFallbacks(cssSeg);
  eq(count(/#[0-9a-fA-F]{3,8}\b/g, bare), 0, "F8：R28 段零裸 hex");
  eq(count(/rgba?\([^)]*\)/g, bare), 0, "F9：R28 段零裸 rgb");
  eq(count(/:\s*(white|black|red|green|blue|yellow|orange|gray|grey)\b/gi, bare), 0, "F10：R28 段零裸具名色");
}
ok(builtSeg.length > 0 && builtSeg.indexOf(".cb-sec-allbtn") >= 0,
  "F11：构建产物 styles.css 真带上了这段（不是只改了源）");
{
  const vars = ["--font-ui-smaller", "--radius-s", "--background-modifier-border",
    "--background-secondary", "--color-yellow", "--background-primary", "--text-muted", "--text-normal"];
  const wl = new Set(fs.readFileSync(path.join(PLUG, "scripts", "obsidian_vars.txt"), "utf8")
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  const bad = vars.filter(v => !wl.has(v));
  eq(bad.length, 0, "F12：用到的变量全在 obsidian_vars.txt 白名单里" + (bad.length ? " → " + bad.join(",") : ""));
}

/* ================= G. 内嵌一致性（出货代码 == 源） ================= */
console.log("\n== R28 · 出货一致性 ==");

ok(mainJs.indexOf('const K_ALL = "全部板块上限";') >= 0, "G1：main.js 里真有 K_ALL（构建真跑过）");
ok(mainJs.indexOf('" · 全部板块超上限截断 "') >= 0, "G2：main.js 里有那句工具条文案");
ok(/const BODY_CONCURRENCY = 2;/.test(mainJs), "G3：main.js 里有并发常量");
eq(count(/KB\.define\(/g, mainJs) >= 1, true, "G4：KB.define 仍在（构建产物结构没坏）");
ok(mainJs.indexOf("cb-sec-allbtn") >= 0, "G5：main.js 里按钮类名与 CSS 对得上（不会「有样式没元素」）");

console.log("\nR28: " + pass + " 通过 / " + fail + " 失败"
  + (fail ? "\n" + fails.join("\n") : ""));
process.exit(fail ? 1 : 0);
