/* kb-toolkit R23 断言：给顶栏齿轮面板加一个「属性默认展开」开关。
 *
 * 老板原话：「加一个开关控制笔记的属性是否默认展开」（配一张真机截图 —— 面板已经是
 * R22 那个居中悬浮小窗，卡片 / 看板行为 / 板块 / 高级 四段）。
 *
 * 这活儿**不需要新造能力**：键 `属性默认展开`（K_PROS_OPEN）R9 就有，
 * `propsOpenDefault()` 也一直在（默认 true）。
 * 只是它原来藏在 **Bases 原生视图选项面板**里 —— 那条路要"点视图标题 → 找选项"，
 * 老板找不到。R23 = 把它挪到 ⚙ 面板「看板行为」组，**紧挨「显正文」**
 * （v2 效果图里「属性展开」和「内容展开」本来就是一对：一个管属性区、一个管正文区）。
 *
 * 🔴 本轮的真正风险点（正则容易漏）：挪台面后，拨开关的触发路径从
 *   「原生面板 → Bases 改 config → 视图重渲染」变成「面板 → cfgSet + repaint(false)」，
 *   而 `onDataUpdated()` 里 `sig === this.sig` 会**短路**（第 1062 行）。
 *   所以 K_PROS_OPEN **必须进 computeSig()** —— 否则"改了不生效但全绿"。
 *   C 组就是钉这一条；真 DOM 真拨一下那刀在 tests/run_r20b.js 的 R23 段。
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

const cbRaw = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8");
const cb = stripComments(cbRaw);
const cssRaw = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");
const css = stripComments(cssRaw);
const mainJs = fs.readFileSync(path.join(PLUG, "main.js"), "utf8");

/* ================= A. 落点：进 ⚙ 面板「看板行为」组，紧挨「显正文」 ================= */
{
  ok(cb.indexOf('this.addToggle(behBox, K_PROS_OPEN, true, "属性默认展开"') >= 0,
    "A1：「看板行为」组里出现「属性默认展开」开关（走统一的 addToggle，不另搓控件）");

  const iBody = cb.indexOf('this.addToggle(behBox, K_BODY, false, "显正文"');
  const iPros = cb.indexOf("this.addToggle(behBox, K_PROS_OPEN");
  const iRo = cb.indexOf('this.addToggle(behBox, K_RO, false, "只读"');
  ok(iBody >= 0 && iPros >= 0 && iRo >= 0, "A2：三个开关都定位得到（显正文 / 属性默认展开 / 只读）");
  ok(iBody < iPros && iPros < iRo,
    "A3：顺序 = 显正文 → 属性默认展开 → 只读（一个管正文、一个管属性，挨着放）");

  ok(/this\.addToggle\(behBox, K_PROS_OPEN, true,\s*\n?\s*"属性默认展开"/.test(cb)
    || cb.indexOf("this.addToggle(behBox, K_PROS_OPEN, true, \"属性默认展开\"") >= 0,
    "A4：默认值 = true（＝属性区默认展开，R9 以来的行为）");

  ok(cb.indexOf('"属性默认展开"') >= 0, "A5：标签就写「属性默认展开」");
  /* 面板正文不铺小字：标签要短（「看板行为」那排全都是 ≤6 字） */
  ok("属性默认展开".length <= 6, "A6：标签 6 字，跟「看板行为」那排同规格（说明全进 title）");

  const iLine = cb.indexOf("this.addToggle(behBox, K_PROS_OPEN");
  const call = cb.slice(iLine, cb.indexOf(");", iLine));
  const strs = call.match(/"[^"]*"/g) || [];
  eq(strs.length, 2, "A7：这一行传了 2 个字符串（标签 + title 说明）—— 说明文字没丢");
  ok(strs.length === 2 && strs[1].indexOf("属性区") >= 0,
    "A8：title 说的是属性区的事（不是从别行复制来的）");
}

/* ================= B. 原生视图选项面板：摘干净 ≠ 删键 ================= */
{
  const vo = bodyOf(cb, "static getViewOptions(config)");
  ok(vo.length > 0, "B1：getViewOptions 定位得到");
  ok(vo.indexOf("key: K_PROS_OPEN") < 0,
    "B2：原生视图选项面板里不再有「属性默认展开」（挪走了，不是靠 shouldHide 藏）");
  ok(vo.indexOf("属性默认展开") < 0, "B3：连 displayName 残留都没有");

  const keys = (vo.match(/key: K_\w+/g) || []).map((s) => s.replace("key: ", "")).sort();
  eq(keys.join(","), "K_BODY,K_CHARS,K_PROPS",
    "B4：原生面板只剩 3 个显示类项（「显示属性 / 显正文 / 正文字数上限」）");

  ok(/const K_PROS_OPEN = "属性默认展开"/.test(cb),
    "B5：键字面量原样保留（老 .base 写过「属性默认展开」的照认）");
  /* 摘项别把助手变成死代码 */
  ok(/shouldHide:\s*\(\)\s*=>\s*!readBool\(K_BODY\)/.test(vo),
    "B6：readBool 助手仍被「正文字数上限」的 shouldHide 用着（没摘成死代码）");
}

/* ================= C. computeSig 认它 → 拨完即时重绘（本轮真正的坑） ================= */
{
  const sig = bodyOf(cb, "computeSig() {");
  ok(sig.length > 0, "C1：computeSig 定位得到");
  ok(/String\(this\.optBool\(K_PROS_OPEN, true\)\)/.test(sig),
    "C2：computeSig 认「属性默认展开」—— 不认的话 onDataUpdated 会短路、拨了不重绘");
  eq((sig.match(/K_PROS_OPEN/g) || []).length, 1, "C3：sig 里恰好出现 1 次（复写病自检）");

  const iChars = sig.indexOf("String(this.optNum(K_CHARS, DEFAULT_CHARS))");
  const iPros = sig.indexOf("String(this.optBool(K_PROS_OPEN, true))");
  const iRo = sig.indexOf("String(this.optBool(K_RO, false))");
  ok(iChars >= 0 && iChars < iPros && iPros < iRo,
    "C4：它排在 K_CHARS 与 K_RO 之间（跟先前那几项同一段，没插错地方）");

  /* 面板控件统一路径：cfgSet 落盘 + repaint 立刻重画 */
  const at = bodyOf(cb, "addToggle(parent, key, dflt, label, tip) {");
  ok(/this\.cfgSet\(key, v\);\s*\n\s*this\.repaint\(false\);/.test(at),
    "C5：addToggle 的 apply 走 cfgSet + repaint(false)（「看板行为」那排统一路径）");
}

/* ================= D. 键与语义一个没变（老 .base 配置不失效） ================= */
{
  ok(/propsOpenDefault\(\)\s*\{\s*return this\.optBool\(K_PROS_OPEN, true\);/.test(cb),
    "D1：propsOpenDefault() 照旧读同一个键、默认 true");
  ok(/const open = dfltOpen \? !this\.prosToggledPaths\.has\(file\.path\) : this\.prosToggledPaths\.has\(file\.path\);/.test(cb),
    "D2：卡片属性区「与默认不同才记」的算法没动");
  /* R24：这就地编辑浮层也改成「板块级优先」（拿 card.__cbSec，取不到回落视图默认） */
  ok(/!this\.editorProps && !this\.propsOpenOn\(card \? card\.__cbSec : null\)/.test(cb),
    "D3（R24）：就地编辑浮层改走 propsOpenOn —— 板块级优先，拿不到才回落视图默认");
  ok(/view\[K_PROS_OPEN\] = this\.optBool\(K_PROS_OPEN, true\);/.test(cb),
    "D4：配置搬运导出照旧带上这个键（换台面不丢配置）");
  ok(/kinds\[K_PROS_OPEN\]\s*=\s*"bool"/.test(cb),
    "D5：配置搬运导入的键型也没变（bool）");
  /* R24 之后 `"属性展开"` 这个字面量**合法存在**了 —— 但它是**板块级**三态键，
     跟视图级的 K_PROS_OPEN（"属性默认展开"）是两个键、两层。这里核的就是"别混用"。 */
  ok(cb.indexOf('triRow("属性展开", "propsOpen"') >= 0,
    "D6（R24）：`属性展开` 唯一出处 = 板块级三态行（不冒充视图默认）");
  ok(cb.indexOf('propsOpen: tri(o, "属性展开", "propsOpen")') >= 0
    && cb.indexOf('o["属性展开"] = sec.propsOpen') >= 0,
    "D6b（R24）：`属性展开` 只作板块级解析 / 写回，走的是 secs[i] 那一层");
  ok(cb.indexOf('const K_PROS_OPEN = "属性默认展开"') >= 0
    && cb.indexOf('"属性默认展开"') >= 0,
    "D6c（R24）：视图级键名仍是「属性默认展开」，两个键分得开（不混用）");
  ok(mainJs.indexOf("const K_PROS_OPEN = \"属性默认展开\"") >= 0
    && mainJs.indexOf("this.addToggle(behBox, K_PROS_OPEN, true, \"属性默认展开\"") >= 0,
    "D7：main.js 内嵌的看板字节 == vendor 原件（构建已跟上）");
}

/* ================= E. 注释/出处交代（这一轮换的是"台面"，得说清从哪搬到哪） ================= */
{
  ok(cbRaw.indexOf("由顶栏面板「看板行为」组的「属性默认展开」控制") >= 0,
    "E1：propsOpenDefault 的注释改成「由顶栏面板…控制」（不再说「视图选项」）");
  ok(cbRaw.indexOf("顶栏面板「看板行为」组的「属性默认展开」关掉即可退回旧的「默认折叠」") >= 0,
    "E2：卡片属性区那段注释同口径改掉");
  ok(cbRaw.indexOf("R23（boss：加一个开关控制笔记的属性是否默认展开）") >= 0,
    "E3：getViewOptions 尾部注释交代了 R23 把 K_PROS_OPEN 挪去哪");
}

/* ================= F. 样式：这轮没动 cb.css，开关复用「看板行为」那排的既有样式 ================= */
{
  ok(/\.cb-opt\s*{[^}]*display:\s*flex/.test(css), "F1：.cb-opt 是 flex 行（面板开关统一长相）");
  ok(/\.checkbox-container/.test(css), "F2：胶囊开关样式沿用原生 .checkbox-container");
  ok(/\.cb-opt-label\s*{/.test(css), "F3：.cb-opt-label 存在（标签与胶囊同排）");

  const iOpt = cssRaw.indexOf(".cb-opt {");
  const blk = iOpt >= 0 ? stripComments(cssRaw.slice(iOpt, iOpt + 1200)) : "";
  const noVar = blk.replace(/var\([^)]*\)/g, "VAR");
  const bare = noVar.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [];
  eq(bare.length, 0, "F4：.cb-opt 段零裸色（实到 " + JSON.stringify(bare) + "）");
}

console.log("\nR23 结果: " + pass + " 通过 / " + fail + " 失败");
if (fail) { console.log(fails.map((f) => "  - " + f).join("\n")); process.exit(1); }
