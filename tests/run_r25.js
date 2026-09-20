/* kb-toolkit R25 断言：右键菜单里再添 4 件事 —— 新建文件 / 新建板块 / 删除板块
 *   + 「单个板块内文件宽度」。
 *
 * 老板原话：
 *   「之前的排版样式非常好！右键菜单里新增新建文件；删除板块；新建板块；
 *     新增对单个板块内文件宽度的设置」
 *
 * 落点（阿盘补的意见）：
 *   · 「文件宽度」做成**板块级覆盖**（写在「板块」项里，键 = 文件宽度）：
 *     不写 = 跟随看板那条拉杆（继承），写了 = 只改这一块。
 *     菜单里那一行**整行复用 .cb-wrow** —— 胶囊开关的几何修正挂在
 *     「.cb-wrow .checkbox-container」上，另起炉灶就是歪的（铁律 50）。
 *   · 「新建文件」复用已有的板块级「＋」（createInSection），落点算法一个字没改；
 *   · 「删除板块」两下确认（第一下只变文案 + 置 is-armed，第二下才真删），
 *     并把它抽成 deleteSection() —— 面板那两下确认与菜单共用一份 splice 逻辑；
 *   · 「新建板块」用 ADDABLE 那 4 个数据源按钮，加完**就地翻开顶栏面板那一行**
 *     （「新建」之后紧接着就是「配置」，不让人自己去翻）。
 *
 * 🔴 本轮要钉的坑：
 *   ① 继承值不许写成硬值：没覆盖时**一个 CSS 变量都不许写**，否则改看板拉杆拉不动这一块；
 *   ② 菜单里的控件必须 stopPropagation，不然外层 closer 会把小窗收走（拉杆拖不动）；
 *   ③ rg.value 是字符串 —— 忘了 parseFloat 就会恒回默认值（r20b 抓过这个真 bug）。
 * 真 DOM 真点那刀在 tests/run_r20b.js 的 R25 段。
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

/* R25 的 CSS 段（从本段标题到**下一段标题**）——
   R27 在后面又追加了一段，所以不能再切到文件尾：那样 R27 的样式会被当成 R25 的
   去体检（G8 零裸色会误报），而 R25 自己的规则漏检也看不出来。
   R27 段的零裸色由 tests/run_r27.js 自己管。 */
const CSS_R25_END = cssRaw.indexOf("R27（boss 5 条 + 延伸）");
const cssSeg = cssRaw.slice(cssRaw.indexOf("R25（boss：右键菜单里新增"),
  CSS_R25_END > 0 ? CSS_R25_END : cssRaw.length);

/* ================= A. 配置层：板块级「文件宽度」这把键 ================= */
console.log("\n== R25 · 配置层：板块级「文件宽度」==");

ok(count(/const K_SEC_W = "文件宽度";/g, cb) === 1, "A1：K_SEC_W = 文件宽度 只定义 1 次（复写病自检）");
ok(/const K_SEC_W = "文件宽度";/.test(cbRaw) && /R25：\*\*板块级\*\*卡片最小宽度/.test(cbRaw),
  "A2：常量带注释说明它是**板块级**（不是视图配置那把 K_WIDTH）");
ok(cb.indexOf('"propsOpen", "文件宽度", "卡片高度"]') >= 0,
  "A3：KNOWN_KEYS 认「文件宽度 / 卡片高度」（R26 连高度键一起认，写回不会漏、也不会被塞进 extra）");

/* —— 真的把 secWidth() 抠出来执行（比正则断言强：能验夹值/对齐/空值语义） —— */
const swM = cbRaw.match(/function secWidth\(v\) \{[\s\S]*?\n\}/);
ok(!!swM, "A4：secWidth() 函数体定位得到");
const secWidth = swM ? new Function(swM[0] + "\nreturn secWidth;")() : (() => null);
eq(secWidth(240), 240, "A5：240 → 240");
eq(secWidth("300"), 300, "A6：字符串 '300' 也认（.base 里手写的值就是字符串）");
eq(secWidth(155), 160, "A7：低于下限 → 夹到 160");
eq(secWidth(999), 480, "A8：高于上限 → 夹到 480");
eq(secWidth(243), 240, "A9：243 → 对齐 10 → 240");
eq(secWidth(245), 250, "A10：245 → 对齐 10 → 250");
eq(secWidth(null), null, "A11：null → 继承（不写覆盖）");
eq(secWidth(undefined), null, "A12：undefined → 继承");
eq(secWidth(""), null, "A13：空串 → 继承");
eq(secWidth("abc"), null, "A14：非数 → 继承（不抛、不写坏值）");
eq(secWidth(0), null, "A15：0 → 继承（不是「设成最小」—— 0 与负数一律当没设）");
eq(secWidth(-50), null, "A16：负数 → 继承");
eq(secWidth(160), 160, "A17：正好下限 → 原样");
eq(secWidth(480), 480, "A18：正好上限 → 原样");

const ns = bodyOf(cb, "function normalizeSection(raw, i) {");
ok(ns.indexOf("secW: secWidth(o[K_SEC_W] !== undefined ? o[K_SEC_W] : o.secWidth)") >= 0,
  "A19：normalizeSection 读「文件宽度」（并留了英文别名 secWidth）");
ok(/propsOpen: tri\(o, "属性展开", "propsOpen"\)[\s\S]{0,120}?secW:/.test(ns),
  "A20：secW 与 body/yaml/links/propsOpen 并排 —— 同样是「null = 继承」那一路");

const st = bodyOf(cb, "function sectionToRaw(sec) {");
ok(st.indexOf("if (sec.secW !== null && sec.secW !== undefined) o[K_SEC_W] = sec.secW;") >= 0,
  "A21：sectionToRaw 只在**有覆盖**时才写这把键（null 不落盘 = 继承）");
ok(/if \(sec\.propsOpen === true \|\| sec\.propsOpen === false\)[\s\S]{0,160}?secW/.test(st),
  "A22：回写顺序跟别的板块级键挨在一起");

const has = bodyOf(cb, "secHasOverride(i) {");
ok(has.indexOf("(s.secW !== null && s.secW !== undefined)") >= 0,
  "A23：secHasOverride 认 secW → 只有宽度覆盖时「重置设置」也该是可点的");

const rst = bodyOf(cb, "resetSection(i) {");
ok(rst.indexOf("s.secW = null;") >= 0, "A24：「重置设置」把宽度覆盖一起清掉");
ok(rst.indexOf("s.propsOpen = null;") >= 0 && rst.indexOf("s.props = [];") >= 0,
  "A25：其它板块级覆盖照旧清（没被这次改动碰坏）");

const swf = bodyOf(cb, "secWidthOf(sec) {");
ok(swf.length > 0, "A26：secWidthOf() 定位得到");
ok(count(/secWidthOf\(sec\) \{/g, cb) === 1, "A27：secWidthOf 只定义 1 次（复写病自检）");
ok(swf.indexOf("sec && sec.spec") >= 0, "A28：宽度挂在板块配置项上（sec.spec），不是渲染出来的那个对象");
ok(swf.indexOf("return secWidth(s.secW);") >= 0, "A29：走同一把夹值函数（不另写一套解析）");

const add = bodyOf(cb, "addSection(type) {");
ok(add.indexOf("secW: null, secH: null, extra: {}") >= 0,
  "A30：新建板块的宽度/高度初值都 = null（R26 连 secH 一起继承）");
ok(add.indexOf("return idx;") >= 0, "A31：addSection 返回新板块下标（菜单要靠它翻开那一行）");
ok(add.indexOf("return -1;") >= 0, "A32：撞收容所时返回 -1（菜单据此不翻面板、不弹「已新建」）");

/* ================= B. 渲染层：只对这一个板块写变量 ================= */
console.log("\n== R25 · 渲染层：把宽度写在 .cb-section 上 ==");

const rs = bodyOf(cb, "renderSection(parentEl, sec) {");
ok(rs.length > 0, "B1：renderSection 定位得到");
ok(count(/sec\.__wrapEl = wrap;/g, cb) === 1, "B2：sec.__wrapEl 只在 renderSection 里挂 1 次");
ok(count(/sec\.__gridEl = grid;/g, cb) === 1, "B3：sec.__gridEl 只在 renderSection 里挂 1 次");
ok(rs.indexOf("const sw0 = this.secWidthOf(sec);") >= 0, "B4：renderSection 先取本板块的宽度覆盖");
ok(/if \(sw0 !== null\) \{[\s\S]{0,200}?--cb-card-w/.test(rs),
  "B5：🔴 只有**有覆盖**时才写变量 —— 无条件写会把继承值钉死（改看板拉杆就拉不动这一块了）");
ok(/if \(!this\.optBool\(K_FILL, true\)\) wrap\.style\.setProperty\("--cb-card-max"/.test(rs),
  "B6：「空位铺满整行」关掉时同步写 max（否则 minmax 会把放大钳在旧 max 上）");
ok(rs.indexOf('wrap.style.setProperty("--cb-card-w", sw0 + "px")') >= 0,
  "B7：变量写在 .cb-section 上 → 后代 .cb-grid 靠继承生效（子板块跟着一起变）");
ok(rs.indexOf("rootEl.style.setProperty") < 0,
  "B8：🔴 renderSection 里不碰 rootEl —— 板块级宽度绝不能染到整个看板");

/* ================= C. 菜单里那一行「文件宽度」 ================= */
console.log("\n== R25 · 右键菜单：「文件宽度」一行 ==");

/* R27：签名多了第 4 个形参 keepMsg（就地重开用）—— 定位串跟着改，意图不变 */
const om = bodyOf(cb, "openSecMenu(sec, x, y, keepMsg) {");
ok(om.length > 0, "C1：openSecMenu 定位得到");
ok(count(/const wrowSec = \(si2, secObj\) => \{/g, cb) === 1, "C2：wrowSec 只定义 1 次（复写病自检）");
ok(om.indexOf("wrowSec(si, sec);") >= 0, "C3：通用设置组里调了它");
ok(om.indexOf('triRow("内容展开", "body"') < om.indexOf("wrowSec(si, sec);"),
  "C4：位置在「内容展开」之后");
ok(om.indexOf("wrowSec(si, sec);") < om.indexOf('"重置设置"'),
  "C5：位置在「重置设置」之前（三板斧挨着，符合原来的排版）");
ok(om.indexOf('grp("通用设置"') < om.indexOf("wrowSec(si, sec);"),
  "C6：它在「通用设置」这一组里（不是夹在笔记内容那组）");

const wr = bodyOf(om, "const wrowSec = (si2, secObj) => {");
ok(wr.length > 0, "C7：wrowSec 函数体定位得到");
ok(wr.indexOf('cls: "cb-wrow cb-ctx-wrow"') >= 0,
  "C8：🔴 行 class 必须带 .cb-wrow —— 胶囊开关的几何修正挂在那条选择器上（铁律 50）");
ok(/rg\.setAttr\("min", "160"\)/.test(wr) && /rg\.setAttr\("max", "480"\)/.test(wr)
  && /rg\.setAttr\("step", "10"\)/.test(wr),
  "C9：拉杆 160–480 / step 10（与看板那条同一档）");
ok(wr.indexOf('text: "跟随看板"') >= 0, "C10：「跟随看板」文案在（说清它在跟随什么）");
ok(wr.indexOf("const isFollow = () => this.secs[si2].secW === null;") >= 0,
  "C11：跟随看板就是「secW 为空」（不另存一份状态，改哪都能对上）");
ok(/tick\.setText\(follow \? "✓" : ""\)/.test(wr),
  "C11b：没覆盖 → 打勾项默认打勾（＝跟随看板）");
ok(wr.indexOf("rg.disabled = follow;") >= 0, "C12：跟随看板时拉杆置灰（不做假控件）");
ok(wr.indexOf('const wnum2 = (v) => { const n = parseFloat(v); return isFinite(n) ? n : viewW; };') >= 0,
  "C13：🔴 parseFloat 兜底 —— rg.value 是字符串，直接喂 num() 会恒回默认值（r20b 抓过的真 bug）");
ok(/for \(const el of \[rg, fk\]\) \{[\s\S]{0,200}?stopPropagation/.test(wr),
  "C14：🔴 拉杆与打勾项都挡住 mousedown/click —— 不挡的话外层 closer 会把小窗收走，拉杆拖不动");
ok(wr.indexOf('cls: "cb-ctx-item cb-ctx-chk cb-ctx-follow"') >= 0,
  "C14b：🔴 跟随看板用**打勾项**语言（与「文件操作」那组同一套），没在菜单里另造控件");
ok(wr.indexOf('cls: "cb-wrow cb-ctx-wrow"') >= 0 && wr.indexOf('cls: "cb-ctx-item cb-ctx-chk') >= 0,
  "C14c：一**两行**结构：拉杆行 + 打勾行（塞成一行会把 232px 的菜单撑到 300 —— 真引擎量过）");

const wrInput = wr.slice(wr.indexOf('rg.addEventListener("input"'), wr.indexOf('rg.addEventListener("change"'));
ok(wrInput.indexOf("secObj.__wrapEl") >= 0, "C15：拖动中直写**这个板块**的 .cb-section");
ok(wrInput.indexOf("this.rootEl") < 0, "C16：🔴 拖动中绝不碰 rootEl（不然就「对整板生效」了）");
ok(wrInput.indexOf("--cb-card-w") >= 0, "C17：拖的是宽度变量");
ok(/if \(!this\.optBool\(K_FILL, true\)\) we\.style\.setProperty\("--cb-card-max"/.test(wrInput),
  "C18：自动关着时 max 一起跟（否则只能缩小、不能放大）");

const wrChange = wr.slice(wr.indexOf('rg.addEventListener("change"'), wr.indexOf("const apply = (follow)"));
ok(/const n = Math\.max\(160, Math\.min\(480, Math\.round\(wnum2\(rg\.value\) \/ 10\) \* 10\)\);\s*\n\s*this\.secs\[si2\]\.secW = n;/.test(wrChange),
  "C19：松手落盘：先夹到 160–480 再写 secW");
/* R27（boss 第 3 条：改完别关窗）：wrowSec 的 change 处理器从「落盘 + 收窗」
   改成「落盘 + refreshSecMenu()」—— 窗留着、控件状态就地重画。
   断言的**意图**仍是「落盘必须走 afterChange 这条唯一通路」，第二半换成新归宿。 */
ok(wrChange.indexOf("this.afterChange();") >= 0 && wrChange.indexOf("this.refreshSecMenu();") >= 0,
  "C20：落盘走 afterChange（persist + repaint）+ 小窗就地刷新（R27 起不关窗）");

const wrApply = wr.slice(wr.indexOf('fk.addEventListener("click"'));
ok(wrApply.length > 0, "C20b：「跟随看板」有 click 处理器");
ok(/this\.secs\[si2\]\.secW = null;/.test(wrApply),
  "C21：勾上「跟随看板」→ secW = null（真删掉覆盖，不是写个等于默认的数）");
ok(/this\.secs\[si2\]\.secW = n;/.test(wrApply),
  "C21b：取消勾 → 把当前拉杆值写成这一块的覆盖（两个方向都通）");
/* R27：回执改走 note()（专门通道）—— 只写 saveState 会被 persist() 覆写成
   「已写入 .base」，等于没回执。意图不变：拨完必须留一句人话。 */
ok(wrApply.indexOf("this.note(") >= 0, "C22：状态行给一句人话（「文件宽度 → 跟随看板 / N px」）");
ok(/fk\.addEventListener\("click", \(evt\) => \{[\s\S]{0,120}?preventDefault\(\);[\s\S]{0,120}?stopPropagation\(\);/.test(wrApply),
  "C23：打勾项自己挡住冒泡（它是菜单项，但别让外层 closer 提前把窗收走）");
ok(wr.indexOf("paint();") >= 0, "C24：建好就 paint 一次（初值不会显示错）");

/* ================= D. 新增的三件事 ================= */
console.log("\n== R25 · 右键菜单：新建文件 / 新建板块 / 删除板块 ==");

ok(om.indexOf('grp("本板块", "只对「" + secName + "」")') >= 0,
  "D1：「本板块」组头写明只对这一块（作用范围一眼可见）");
ok(om.indexOf('item("新建文件", () => this.createInSection(sec, "", sec.__gridEl), this.readonly(),') >= 0,
  "D2：「新建文件」复用已有的板块级「＋」（createInSection），并把本板块的栅格传进去");
ok(om.indexOf('createInSection(sec, "", sec.__gridEl)') >= 0 && om.indexOf("insertTempCard") < 0,
  "D3：菜单里不自己造新建流程（临时卡片 / Notice / 落点算法都在 createInSection 里）");
ok(om.indexOf('item("新建文件"') < om.indexOf('del.setText("删除「"'),
  "D4：顺序 = 新建文件 → 删除（跟老板列的一致）");

const delBlock = om.slice(om.indexOf("let armed = false;"),
  om.indexOf("    /* R25：新建板块（整个看板）"));
ok(delBlock.length > 0, "D5：删除项那段定位得到");
ok(delBlock.indexOf('cls: "cb-ctx-item cb-ctx-danger"') >= 0,
  "D6：删除项用已有的 .cb-ctx-danger（跟卡片菜单「删除文件」同一个红）");
ok(delBlock.indexOf("let armed = false;") >= 0, "D7：两下确认的状态位");
ok(/if \(!armed\) \{[\s\S]{0,200}?del\.setText\("再点一次确认删除"\);[\s\S]{0,120}?del\.addClass\("is-armed"\);[\s\S]{0,60}?return;/.test(delBlock),
  "D8：🔴 第一下只变文案 + is-armed 就 return（不收窗、不删）—— 收窗了就没法点第二下");
ok(delBlock.indexOf("this.closeSecMenu();") > delBlock.indexOf("if (!armed)"),
  "D9：收起小窗发生在**第二下**之后");
ok(delBlock.indexOf("const nm = this.deleteSection(si);") >= 0, "D10：第二下 → deleteSection(si)");
ok(delBlock.indexOf('new obsidian.Notice("创作看板：已删除板块「" + nm + "」（笔记一篇没动）")') >= 0,
  "D11：删完明确说「笔记一篇没动」（删的只是看板配置）");

const dels = bodyOf(cb, "deleteSection(i) {");
ok(dels.length > 0, "D12：deleteSection() 定位得到");
ok(count(/deleteSection\(i\) \{/g, cb) === 1, "D13：deleteSection 只定义 1 次（复写病自检）");
ok(count(/this\.secs\.splice\(i, 1\)/g, cb) === 1,
  "D14：🔴 全文只有一处 splice(i,1) —— 面板与菜单共用这一份删板块逻辑，没有复制品");
ok(dels.indexOf("this.secs.splice(i, 1);") >= 0 && dels.indexOf("this.afterChange();") >= 0,
  "D15：删完走 afterChange（persist + repaint）");
ok(dels.indexOf("if (this.editIdx === i) this.editIdx = -1;") >= 0
  && dels.indexOf("else if (this.editIdx > i) this.editIdx--;") >= 0,
  "D16：编辑行下标跟着修（少了这步面板会指到隔壁板块）");
ok(dels.indexOf("this.secs.length === 0") >= 0,
  "D17：删到最后一个时如实提示「会回退成 base 的自动分组」（别让人以为坏了）");
ok(dels.indexOf("return name;") >= 0, "D18：返回板块名给 Notice 用");

const ad = bodyOf(cb, "askDelete(i) {");
ok(ad.indexOf("this.deleteSection(i);") >= 0, "D19：面板那两下确认改调同一个 deleteSection（铁律 49 的按意图重写）");
ok(ad.indexOf("this.secs.splice") < 0, "D20：askDelete 里不再有自己那份 splice");

ok(om.indexOf('grp("新建板块", "整个看板")') >= 0,
  "D21：「新建板块」组头同时说明它属于整个看板（它不是只改这一块）");
ok(/for \(const t of ADDABLE\) \{[\s\S]{0,300}?SOURCE_LABEL\[t\]/.test(om),
  "D22：4 个数据源按钮复用 ADDABLE / SOURCE_LABEL（跟顶栏面板「＋ 添加」同一套）");
ok(om.indexOf('b.setAttr("data-type", t);') >= 0, "D23：按钮带 data-type（可点、可断言）");
ok(om.indexOf("const idx = this.addSection(t);") >= 0, "D24：点了就 addSection(t)");
ok(/const idx = this\.addSection\(t\);[\s\S]{0,400}?this\.panelOpen = true;[\s\S]{0,200}?this\.editIdx = idx;[\s\S]{0,100}?this\.renderPanel\(\);/.test(om),
  "D25：加完就地翻开顶栏面板那一行 —— 「新建」紧接着「配置」，不让人自己翻");
ok(om.indexOf("if (this.readonly())") >= 0 && om.indexOf("只读模式：先点工具条") >= 0,
  "D26：只读模式下不摆那排按钮，如实说明");

/* ================= E. 铁律 56：签名覆盖 ================= */
console.log("\n== R25 · 铁律 56：板块级键必须能进 computeSig ==");
const sig = bodyOf(cb, "computeSig() {");
ok(sig.indexOf("JSON.stringify(this.cfgGet(CONFIG_KEY, null))") >= 0,
  "E1：🔴 整份板块配置进签名 —— secW 存在 CONFIG_KEY 里，所以拨宽度一定会重画（不会「拨了不生效但全绿」）");
ok(/const CONFIG_KEY = /.test(cb), "E2：CONFIG_KEY 常量在（板块数组就存在这把键下）");
ok(count(/CONFIG_KEY, null\)\)/g, cb) >= 1, "E3：读的就是那一份原样配置（字符串化后逐字比）");

/* ================= F. 复写病自检 ================= */
console.log("\n== R25 · 复写病自检（同一方法只许定义一次）==");
const METHODS = ["secWidthOf", "openSecMenu", "closeSecMenu", "deleteSection", "askDelete",
  "addSection", "renderSection", "refreshBoard", "resetSection", "beginRenameSection",
  "renameSection", "propsOpenOn", "secHasOverride", "secIndexOf", "secConfigurable"];
const dup = METHODS.filter((m) => count(new RegExp("\\n  " + m + "\\(", "g"), cb) !== 1);
ok(dup.length === 0, "F1：" + METHODS.length + " 个方法各自恰好定义 1 次"
  + (dup.length ? "（重复：" + dup.join(",") + "）" : ""));

/* ================= G. CSS ================= */
console.log("\n== R25 · CSS ==");
ok(cssSeg.length > 0, "G1：cb.css 里有 R25 段落");
ok(/\.cb-ctxmenu\.cb-secmenu \{[\s\S]{0,160}?max-height: calc\(100vh - 16px\);[\s\S]{0,80}?overflow-y: auto;/.test(cssSeg),
  "G2：菜单变长后内部滚动兜底（clamp 只挪位置、不缩小 → 窗比屏高时下面点不到）");
ok(/\.cb-ctx-wrow \{[\s\S]{0,120}?padding: 3px 10px;/.test(cssSeg), "G3：菜单里那行有自己的内边距");
ok(/\.cb-ctx-wrow \.cb-wlb \{[\s\S]{0,160}?width: auto;/.test(cssSeg),
  "G4：标签不再吃 4.5em（232px 的菜单里放不下）");
ok(cssSeg.indexOf(".cb-ctx-addrow") >= 0 && /flex-wrap: wrap/.test(cssSeg),
  "G5：数据源按钮那行允许换行（窄了不撑破菜单）");
ok(/\.cb-ctxmenu \.cb-ctx-danger\.is-armed \{[\s\S]{0,160}?--background-modifier-error/.test(cssSeg),
  "G6：待确认态用主题的红底变量（不是裸色）");
ok(cssSeg.indexOf("font-weight: var(--font-semibold)") >= 0,
  "G7：待确认态字重也变（红底 + 加粗，跟第一下看得出区别）");
ok(/\.cb-ctx-wrow \.cb-wrange \{[\s\S]{0,120}?flex: 1 1 80px;/.test(cssSeg),
  "G7b：🔴 菜单里那条拉杆给了小 basis —— 原生 range 的 intrinsic 宽约 129px，会把菜单撑到 300");
ok(/\.cb-ctx-follow \.cb-ctx-chk-lb \{[\s\S]{0,120}?font-size/.test(cssSeg),
  "G7c：跟随看板那项的字号跟别的菜单项一个样（不是临时糊的）");

/* 零裸色：R25 段里所有颜色值都必须走 var() */
(function () {
  const s = cssSeg.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(?:^|[;{])\s*(color|background|background-color|border[a-z-]*-color|outline-color)\s*:\s*([^;}]+)/g;
  const bad = [];
  let m;
  while ((m = re.exec(s))) {
    const v = m[2].trim();
    if (/^var\(/.test(v)) continue;
    if (/^(transparent|none|inherit|currentcolor|unset|initial|auto)$/i.test(v)) continue;
    bad.push(m[1] + ":" + v);
  }
  ok(bad.length === 0, "G8：R25 段零裸色（全走主题变量）" + (bad.length ? " 违规：" + bad.join(" | ") : ""));
})();

/* ================= H. 出货产物 ================= */
console.log("\n== R25 · 出货 main.js ==");
ok(mainJs.indexOf('const K_SEC_W = "文件宽度";') >= 0, "H1：main.js 里有 K_SEC_W（构建产物与源一致）");
ok(mainJs.indexOf("cb-ctx-addrow") >= 0, "H2：main.js 里有新建板块那行");
ok(mainJs.indexOf("secWidthOf(sec) {") >= 0, "H3：main.js 里有 secWidthOf");
ok(mainJs.indexOf("deleteSection(i) {") >= 0, "H4：main.js 里有 deleteSection");
ok(mainJs.indexOf("再点一次确认删除") >= 0, "H5：main.js 里有两下确认的文案");
ok(mainJs.indexOf("--cb-card-w") >= 0, "H6：main.js 里有宽度变量写入");
ok(Buffer.byteLength(mainJs, "utf8") > 500000,
  "H7：main.js 已重新构建（体量 " + Buffer.byteLength(mainJs, "utf8") + " 字节）");

/* ================= I. 兼容性 ================= */
console.log("\n== R25 · 老配置不被碰坏 ==");
ok(ns.indexOf("sec.extra[k] = o[k]") >= 0,
  "I1：未知键仍进 extra 原样保留（手写的未来字段不会被这次改动吃掉）");
ok(st.indexOf("for (const k of Object.keys(ex))") >= 0, "I2：extra 仍会写回");
ok(om.indexOf('grp("通用设置", "只对「" + secName + "」")') >= 0
  && om.indexOf('grp("笔记内容", "只对「" + secName + "」")') >= 0,
  "I3：R24 那两组一个字没动（老板说「之前的排版样式非常好」）");
ok(om.indexOf('chk("拖动搬文件", K_MOVE') >= 0 && om.indexOf('chk("文件隐藏显示", K_HIDDEN_ON') >= 0
  && om.indexOf('chk("查看隐藏的文件", K_HIDDEN_SHOW') >= 0,
  "I4：文件操作那三个打勾项照旧（视图级）");
ok(om.indexOf('triRow("属性展开", "propsOpen"') >= 0 && om.indexOf('triRow("显示 YAML", "yaml"') >= 0
  && om.indexOf('triRow("显示双链", "links"') >= 0,
  "I5：4 个三态行照旧（属性展开 / 内容展开 / 显示 YAML / 显示双链）");
ok(om.indexOf('item("刷新"') >= 0, "I6：「刷新」照旧在第一项");

/* ================= 汇总 ================= */
console.log("\nR25 结果: " + pass + " 通过 / " + fail + " 失败");
if (fail) {
  console.log("失败项：");
  for (const f of fails) console.log("  - " + f);
  process.exitCode = 1;
}
