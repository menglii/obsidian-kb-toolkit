/* kb-toolkit R21 断言：boss 拍板 —— 「卡片最小宽度」「空位铺满整行」从 Base 的**原生视图选项
 * 面板**挪进看板**顶栏齿轮 → 「卡片」组**，并成一行：「文件宽度 [拉杆] 240 px  自动 [开关]」。
 *
 * 为什么挪：原生视图选项面板一条 descriptor 只能占一行（已核实核心 cards/list/table 写法），
 *   合不成「拉杆 + 开关同一行」。顶栏齿轮面板是自绘 DOM，想怎么排怎么排。
 *
 * 硬约束（一条都不能破）：
 *   · 键名与语义**一个不许变** —— K_WIDTH「卡片最小宽度」/ K_FILL「空位铺满整行」，
 *     老 .base 视图块里存过的值必须照旧被读到（D 组守这个）。
 *   · 「自动」开 = 卡片铺满整行、拉杆置灰（不做假控件）；关 = 固定为拉杆宽度。
 *   · 零裸色 + --cb-wpct 必须在 CSS 里声明（r3b 的变量白名单从 CSS 的 `--x:` 定义拼出来，
 *     只在 JS 里 setProperty 会判未知变量）。
 *
 * ⚠️ 本套件是**源码级**的（正则抓不到「改完当场抛异常」，见铁律 53）——
 *   运行时兜底在 tests/run_r20b.js 的 R21 段（真 DOM 起视图、真点开关与拉杆）。
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
/** 取 header 起的那段 `{...}`（与 run_r20.js 同款，用于把断言圈在某个方法体里） */
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

const cbRaw = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8");
const cb = stripComments(cbRaw);
const cbCssRaw = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
const cbCss = stripComments(cbCssRaw);
const src75 = stripComments(fs.readFileSync(path.join(PLUG, "src", "75_core_settingTab.js"), "utf8"));

/* ================= A. 顶栏面板：新落点 + 并成一行 ================= */
{
  const rp = bodyOf(cb, "renderPanel() {");
  ok(rp.length > 0, "A1：renderPanel 定位得到（顶栏齿轮面板）");
  ok(/this\.addGroup\("卡片"\)/.test(rp) && /this\.addWidthRow\(cardBox\)/.test(rp),
    "A2：renderPanel 里新开「卡片」组，并把宽度行挂进去");
  ok(rp.indexOf('this.addGroup("卡片")') < rp.indexOf('this.addGroup("看板行为")'),
    "A3：「卡片」组排在「看板行为」前面（外观在前、行为在后）");
  eq((cb.match(/addWidthRow\(/g) || []).length, 2,
    "A4：addWidthRow 恰好 2 处（1 处定义 + 1 处调用）—— 复写病自检，多一处就是叠写");
  ok(/^  addWidthRow\(parent\) \{/m.test(cb), "A5：addWidthRow 是正规方法定义（顶格缩进两格）");
}

/* ================= B. 那一行的组成：拉杆 + 数值 + 自动开关 ================= */
{
  const fn = bodyOf(cb, "addWidthRow(parent) {");
  ok(fn.length > 0, "B1：addWidthRow 方法体取得到");
  ok(/parent\.createDiv\(\{ cls: "cb-wrow" \}\)/.test(fn) && /cls: "cb-wlb", text: "文件宽度"/.test(fn),
    "B2：行 = .cb-wrow，行首标签「文件宽度」");
  ok(/createEl\("input", \{ cls: "cb-wrange", type: "range" \}\)/.test(fn),
    "B3：拉杆 = input[type=range].cb-wrange");
  ok(/setAttr\("min", "160"\)/.test(fn) && /setAttr\("max", "480"\)/.test(fn) && /setAttr\("step", "10"\)/.test(fn),
    "B4：范围 160–480 step 10（键语义与 r15 完全一致）");
  ok(/rg\.value = String\(this\.optNum\(K_WIDTH, 240\)\)/.test(fn),
    "B5：初值从 K_WIDTH 读（没设过 = 240）");
  ok(/cls: "cb-wval", text: rg\.value \+ " px"/.test(fn), "B6：右侧数值回显 x px");
  ok(/cls: "cb-wauto" \}/.test(fn) && /cls: "cb-wauto-lb", text: "自动"/.test(fn),
    "B7：「空位铺满整行」缩成「自动」两个字（行尾）");
  ok(/cls: "checkbox-container" \}/.test(fn) && /cls: "cb-opt-box", type: "checkbox"/.test(fn),
    "B8：开关走原生胶囊 .checkbox-container + input.cb-opt-box（与看板行为那排同款）");
  ok(/ib\.checked = this\.optBool\(K_FILL, true\)/.test(fn),
    "B9：「自动」默认开（＝R14 铺满整行行为，键还是 K_FILL）");
  ok(/color/.test("") === false && fn.indexOf("自动") < fn.indexOf("checkbox-container"),
    "B10：「自动」标签在开关左边（跟拉杆同一行、同一 flex 轴）");
}

/* ================= C. 交互：置灰 / 即时生效 / 松手落盘 ================= */
{
  const fn = bodyOf(cb, "addWidthRow(parent) {");
  ok(/const on = this\.optBool\(K_FILL, true\);/.test(fn) && /rg\.disabled = on;/.test(fn),
    "C1：铺满时拉杆置灰 —— 不做假控件");
  ok(/val\.style\.opacity = on \? "0\.4" : "1";/.test(fn), "C2：数值回显跟着一起变淡");
  ok(/rg\.style\.setProperty\("--cb-wpct", pctOf\(rg\.value\)\)/.test(fn)
    && /\(\(wnum\(v\) - 160\) \/ 320\) \* 100/.test(fn),
    "C3：轨道已填充比例算得对（(w-160)/320，喂给 --cb-wpct）");
  ok(/addEventListener\("input"/.test(fn) && /setProperty\("--cb-card-w", wpx\)/.test(fn),
    "C4：拖动中即时改宽度（只写 CSS 变量，不动 DOM 树 —— 同 r15 编辑器保护思路）");
  ok(/if \(!this\.optBool\(K_FILL, true\)\) this\.rootEl\.style\.setProperty\("--cb-card-max", wpx\);/.test(fn),
    "C5：「自动」关着时 max 也同步 —— 否则 minmax(w,max) 只让缩不让放（R21 实修的一处）");
  ok(/addEventListener\("change"/.test(fn)
    && /Math\.max\(160, Math\.min\(480, Math\.round\(wnum\(rg\.value\) \/ 10\) \* 10\)\)/.test(fn),
    "C6：松手时夹到 160–480 并对齐 10 的整数倍（拖动越界也不会写脏值）");
  ok(/this\.cfgSet\(K_WIDTH, n\);/.test(fn) && /this\.cfgSet\(K_FILL, v\);/.test(fn),
    "C7：两个键都照旧写进 .base 视图配置（键名一个没改）");
  ok((fn.match(/this\.repaint\(false\);/g) || []).length >= 2,
    "C8：写完都重绘（刷新栅格），面板不关");
  ok(/const apply = \(v\) => \{/.test(fn) && /ib\.addEventListener\("change", \(\) => apply\(!!ib\.checked\)\)/.test(fn)
    && /alb\.addEventListener\("click", \(\) => \{/.test(fn),
    "C9：点胶囊、点「自动」文字都能切（与看板行为那排行为一致）");
  ok(/paint\(\);\s*\n\s*return row;/.test(fn), "C10：建完就 paint 一次（首次进来状态就对）");
  /* 回归钉：rg.value 永远是字符串，绝不能直接喂 num()（只认 typeof === number → 恒回 dflt），
   * 否则拖动预览 / 百分比 / 松手落盘全被钉死在 240 —— r20b 真 DOM 冒烟实抓过一次。 */
  ok(/const wnum = \(s\) => \{ const n = parseFloat\(s\); return isFinite\(n\) \? n : 240; \};/.test(fn)
    && !/[^a-zA-Z]num\(rg\.value/.test(fn),
    "C11：数值入口走 wnum(parseFloat) —— 直接喂 num() 会把拉杆钉死在 240");
}

/* ================= D. 原生视图选项面板：摘干净但不删键 ================= */
{
  const vo = bodyOf(cb, "static getViewOptions(config)");
  ok(vo.length > 0, "D1：getViewOptions 定位得到");
  ok(vo.indexOf("key: K_WIDTH") < 0, "D2：K_WIDTH 已从原生视图选项面板挪走");
  ok(vo.indexOf("key: K_FILL") < 0, "D3：K_FILL 已从原生视图选项面板挪走");
  ok(vo.indexOf("displayName: \"空位铺满整行") < 0 && vo.indexOf("displayName: \"卡片最小宽度") < 0,
    "D4：两个描述项一行不剩（不是靠 shouldHide 藏起来）");
  /* R27：K_PROPS / K_CHARS 也挪进顶栏「内容」组（跟 R21 的宽度、R23 的属性展开一个套路） */
  ok(vo.indexOf("key: K_PROPS") < 0 && vo.indexOf("key: K_CHARS") < 0,
    "D5：显示属性 / 正文字数已从原生面板挪走（键没删，只换台面）");
  ok(vo.indexOf("key: K_BODY") >= 0, "D5b：显正文（K_BODY）照旧留在原生面板");
  /* R23：K_PROS_OPEN 也挪进顶栏面板了（「看板行为」组） */
  ok(vo.indexOf("key: K_PROS_OPEN") < 0,
    "D5b（R23）：K_PROS_OPEN 已从原生面板挪进顶栏「看板行为」组");

  /* 键与语义一个没变 —— 老 .base 配置照旧被读到 */
  ok(cb.indexOf('const K_WIDTH = "卡片最小宽度"') >= 0, "D6：K_WIDTH 键名字面量原样（老配置照认）");
  ok(cb.indexOf('const K_FILL = "空位铺满整行"') >= 0, "D7：K_FILL 键名字面量原样（老配置照认）");
  ok(cb.indexOf("String(this.optNum(K_WIDTH, 240))") >= 0
    && cb.indexOf("String(this.optBool(K_FILL, true))") >= 0,
    "D8：computeSig 两个键都还在认（改了值才会重绘）");
  ok(/view\[K_WIDTH\] = this\.optNum\(K_WIDTH, 240\);/.test(cb)
    && /view\[K_FILL\] = this\.optBool\(K_FILL, true\);/.test(cb),
    "D9：配置搬运导出照旧带上两个键");
  ok(/kinds\[K_WIDTH\]\s*=\s*"num"/.test(cb) && /kinds\[K_FILL\]\s*=\s*"bool"/.test(cb),
    "D10：配置搬运导入的键型也没变（number / bool）");
  /* R27：两条路统一走 applyRootVars() —— 意图不变（--cb-card-max 必须真被写） */
  ok((cb.match(/\? "1fr" : minW \+ "px"/g) || []).length >= 1
    && (cb.match(/this\.applyRootVars\(\);/g) || []).length >= 2,
    "D11（R27）：--cb-card-max 由 applyRootVars() 统一写，重绘 + 编辑器保护两条路都调它");
  ok(cb.indexOf("deferRepaintUntilBlur") >= 0, "D12：输入框保护（deferRepaintUntilBlur）没被这轮碰掉");
}

/* ================= E. CSS：零裸色 + --cb-wpct 必须在 CSS 里声明 ================= */
{
  /* 锚点是 .cb-wrow 而不是注释里的 "R21" —— 注释已被剥掉，抓不到（R21 段追加在文件末尾） */
  const i = cbCssRaw.indexOf(".cb-wrow");
  ok(i >= 0, "E1：cb.css 里有 .cb-wrow 段（R21 新样式）");
  const block = i >= 0 ? stripComments(cbCssRaw.slice(i)) : cbCss;
  ok(/\.cb-wrow\s*{[^}]*display:\s*flex/.test(block) && /\.cb-wrow\s*{[^}]*align-items:\s*center/.test(block),
    "E2：.cb-wrow 是 flex + 垂直居中（拉杆和开关才在同一行对齐）");
  ok(/\.cb-wrange\s*{[^}]*--cb-wpct:\s*50%/.test(block),
    "E3：--cb-wpct 在 CSS 里声明（r3b 白名单从 CSS 的 --x: 定义拼出来，只在 JS 里 set 会判未知）");
  ok(/-webkit-slider-runnable-track\s*{[^}]*linear-gradient/.test(block)
    && /var\(--interactive-accent\) var\(--cb-wpct\)/.test(block)
    && /var\(--background-modifier-border\) var\(--cb-wpct\)/.test(block),
    "E4：轨道已填充段 / 未填充段都是主题变量（零裸色）");
  ok(/\.cb-wrange::-webkit-slider-thumb/.test(block) && /\.cb-wrange::-moz-range-thumb/.test(block)
    && /\.cb-wrange::-moz-range-progress/.test(block),
    "E5：WebKit 与 Firefox 两套拇指 / 进度都写了（Chromium 系与 Firefox 都不裸奔）");
  ok(/\.cb-wrange:disabled\s*{[^}]*opacity:\s*0\.4/.test(block) && /\.cb-wrange:disabled\s*{[^}]*cursor:\s*not-allowed/.test(block),
    "E6：置灰态有明确视觉（0.4 + not-allowed）");
  const cap = block.indexOf(".cb-wrow .checkbox-container {");
  const capBlock = cap >= 0 ? block.slice(cap) : "";
  ok(/width:\s*34px/.test(capBlock) && /height:\s*19px/.test(capBlock),
    "E7：「自动」胶囊与看板行为那排同尺寸（34×19）");
  ok(/\.cb-wrow \.checkbox-container::after\s*{[^}]*margin:\s*0/.test(capBlock)
    && /\.cb-wrow \.checkbox-container::after\s*{[^}]*transform:\s*none/.test(capBlock),
    "E8：::after 的 margin / transform 显式清掉（铁律 50：不清就是歪的）");
  ok(/\.cb-wrow \.checkbox-container:has\(input:checked\)/.test(capBlock),
    "E9：补 :has(input:checked) 兜底（铁律 54：主题不给 is-enabled 也能变色）");
  /* 零裸色：R21 段里不许出现 hex / rgb() / hsl() 字面量（var(...) 里不算） */
  const noVar = block.replace(/var\([^)]*\)/g, "VAR");
  const bare = noVar.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [];
  eq(bare.length, 0, "E10：R21 段零裸色（实到 " + JSON.stringify(bare) + "）");
}

/* ================= F. 设置页指引文案跟进（R18 那条指路要改口） ================= */
{
  ok(src75.indexOf('{ k: "文件宽度 / 自动"') >= 0,
    "F1：帮助条目改成「文件宽度 / 自动」（把两个键并成一条讲）");
  ok(src75.indexOf('{ k: "卡片宽度"') < 0 && src75.indexOf('{ k: "空位铺满整行"') < 0,
    "F2：老的两条帮助条目已撤（不给用户指错地方）");
  ok(/k: "文件宽度 \/ 自动"[^}]*顶栏齿轮/.test(src75) || /文件宽度 \/ 自动[\s\S]{0,200}顶栏齿轮/.test(src75),
    "F3：帮助条目说清去哪调（顶栏齿轮 → 「卡片」组）");
  ok(/\.setName\("文件宽度 \/ 自动"\)/.test(src75), "F4：③ 高级里那条指路的标题也改口了");
  ok(/\.setDesc\("在笔记里打开看板 → 顶栏齿轮 → 「卡片」组里调，每个看板各存一份"\)/.test(src75),
    "F5：描述点明「视图级、每个看板各存一份」（不放全局开关）");
  /* 搜索占位 / 空结果提示不去动它 —— 那两句是 R20 定稿，改了口径会连带 r18 ② -4 */
  ok(src75.indexOf("试试 模板 / 回滚 / 排除 / 卡片宽度") >= 0,
    "F6：搜索占位文案保持 R20 定稿（不动，免得连带 r18 ② -4）");
}

console.log("\nR21 结果: " + pass + " 通过 / " + fail + " 失败");
if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
