/* kb-toolkit R27 断言：① 帮助文字一条一行  ② 新建文件后卡片描边闪一下
 *   ③ 菜单里改完设置**不关窗**（就地刷新 + 顶上一条回执）  ④ 刷新下面加「收起 / 展开本板块」
 *   ⑤ 全体板块设置面板「稍稍有点空」→ 填空 + 新增优化
 *
 * 老板原话（2026-09-20，2 张截图）：
 *   「右键菜单里的提示文字展开显示后加个换行」
 *   「右键新建文件后，新建的文件加一小段时间的描边」
 *   「右键菜单里进行设置后，界面自动刷新挺好，但是右键菜单别关闭了」
 *   「右键菜单的刷新下面加个收起当前板块」
 *   「对于全体板块的设置界面稍稍有点空，在简洁有层次的排版基础上，对全体板块的设置选项进行新增优化」
 *   「在以上建议的基础上延伸，加入你自己的优化方案，开始优化」
 *
 * 🔴 本轮要钉的坑：
 *   ① **回执会被 persist() 吃掉**：afterChange() → persist() 把 saveState 覆写成
 *     「已写入 .base」→ 顶上那条回执成废话。所以另开 note() 专用通道
 *     （真 DOM 冒烟先抓到的，正则看不见这个）。
 *   ② **「换台面」的键必须进 computeSig()**（铁律 56）：K_GAP / K_CARD_H / K_HIDE_EMPTY
 *     三个新键只要能在 ⚙ 面板改，就必须进 sig 的 parts，否则「拨了不生效但全绿」。
 *   ③ **别写 this.sections[si]**：sections 的顺序 ≠ secs（收容所 / 公式另起一条），
 *     就地重开菜单必须按 srcIndex 找。
 *   ④ **不改 .cb-panel-head**：它的 border-bottom 被 r22 钉着，R27 的摘要条另起一层浅底，
 *     不能又画一条线（否则窗头出现双线）。
 *   ⑤ 新键漏了「配置搬运」→ 复制 / 导入静默丢设置（本轮自检发现的真缺口，已补）。
 * 真引擎几何 / 像素那两刀在 tmp/render_r27.py 与 tmp/check_r27_shots.py。
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

/* R27 的 CSS 段（从本段标题到文件尾 —— 它现在是最后一段） */
const cssSeg = cssRaw.slice(cssRaw.indexOf("R27（boss 5 条 + 延伸）"));

/* ================= A. 配置层：三个新键 ================= */
console.log("\n== R27 · 配置层：网格间距 / 卡片默认高度 / 隐藏空板块 ==");

ok(count(/const K_CARD_H = "卡片默认高度";/g, cbRaw) === 1, "A1：K_CARD_H = 卡片默认高度 只定义 1 次（复写病自检）");
ok(/const K_CARD_H = "卡片默认高度";\s*\/\/ R27：\*\*视图级\*\*/.test(cbRaw),
  "A2：注释写明它是**视图级**默认（板块级那把是 K_SEC_H「卡片高度」，别混）");
ok(count(/const K_GAP = "网格间距";/g, cb) === 1, "A3：K_GAP = 网格间距 只定义 1 次");
ok(count(/const K_HIDE_EMPTY = "隐藏空板块";/g, cb) === 1, "A4：K_HIDE_EMPTY = 隐藏空板块 只定义 1 次");

ok(count(/^  cardHeightDefault\(\) \{/m, cb) === 1, "A5：cardHeightDefault() 只定义 1 次");
const chd = bodyOf(cb, "cardHeightDefault() {");
ok(chd.indexOf("return null") >= 0 && chd.indexOf("secHeight(v)") >= 0,
  "A6：没设过 → null（＝跟随内容，同一行拉伸等高）；设过 → 走 secHeight 夹范围");
ok(count(/^  gapOf\(\) \{/m, cb) === 1, "A7：gapOf() 只定义 1 次");
const go = bodyOf(cb, "gapOf() {");
ok(go.indexOf("Math.max(0, Math.min(24, g))") >= 0,
  "A8：间距夹在 0–24（跟面板拉杆的 min/max 同一档，手改 .base 也越不出去）");
ok(go.indexOf("return null") >= 0, "A9：没设过 → null（＝让 CSS 的 8px 兜底，不写硬值）");
const he = bodyOf(cb, "hideEmpty() {");
ok(he.indexOf("this.optBool(K_HIDE_EMPTY, false)") >= 0, "A10：hideEmpty() 默认关（不偷偷改老板现在的看板）");

console.log("\n== R27 · applyRootVars：视图级样式变量一个出口 ==");
ok(count(/^  applyRootVars\(\) \{/m, cb) === 1, "A11：applyRootVars() 只定义 1 次（复写病自检）");
const arv = bodyOf(cb, "applyRootVars() {");
["--cb-card-w", "--cb-card-max", "--cb-card-h", "--cb-gap"].forEach(v => {
  ok(arv.indexOf("--" + v.replace(/^--/, "")) >= 0, "A12：一个出口写 " + v);
});
ok(arv.indexOf('this.rootEl.style.setProperty("--cb-gap", g0 + "px")') >= 0
  && arv.indexOf('this.rootEl.style.removeProperty("--cb-gap")') >= 0,
  "A13：🔴 没设过就 removeProperty —— 把默认值写成硬值会掐死「以后改看板默认」");
ok(arv.indexOf('this.rootEl.style.removeProperty("--cb-card-h")') >= 0,
  "A14：卡片默认高度同理（没设 = 删变量，不是写 auto）");
const arvCalls = count(/this\.applyRootVars\(\);/g, cb);
ok(arvCalls >= 2, "A15：重绘 + 编辑器保护两条路都调它（原来各写一遍，改一处漏一处）(got=" + arvCalls + ")");

console.log("\n== R27 · computeSig：三个新键都得在（铁律 56）==");
const sig = bodyOf(cb, "computeSig() {");
ok(sig.indexOf("String(this.optBool(K_HIDE_EMPTY, false))") >= 0, "A16：🔴 K_HIDE_EMPTY 在 sig 里（否则开开关不重绘）");
ok(sig.indexOf('String(this.cfgGet(K_GAP, "~"))') >= 0, "A17：🔴 K_GAP 在 sig 里");
ok(sig.indexOf('String(this.cfgGet(K_CARD_H, "~"))') >= 0, "A18：🔴 K_CARD_H 在 sig 里");

console.log("\n== R27 · 隐藏空板块：真跳过 + 万一全空给人话 ==");
const rp = bodyOf(cb, "repaint(", );
ok(cb.indexOf("const hideEmpty = this.hideEmpty();") >= 0, "A19：重绘时先取一次开关（别在循环里反复读配置）");
ok(/if \(hideEmpty && !\(sec\.total > 0\)/.test(cb), "A20：空的板块真的 continue 掉（不只是加个 class）");
ok(cb.indexOf('cls: "cb-empty"') >= 0 && /所有板块都空着/.test(cb),
  "A21：全空时给一句人话（别留一片白，让人以为坏了）");

console.log("\n== R27 · 配置搬运：新键一个都不能丢 ==");
const ec = bodyOf(cb, "exportConfig() {");
ok(ec.indexOf("if (this.gapOf() !== null) view[K_GAP] = this.gapOf();") >= 0,
  "A22：导间距 —— 只在显式设过时导出（没设过固化进 .base 会掐死看板默认）");
ok(ec.indexOf("if (this.cardHeightDefault() !== null) view[K_CARD_H] = this.cardHeightDefault();") >= 0,
  "A23：导卡片默认高度，同样只导设过的");
ok(ec.indexOf("view[K_HIDE_EMPTY] = this.optBool(K_HIDE_EMPTY, false);") >= 0, "A24：导隐藏空板块");
ok(cb.indexOf('kinds[K_GAP] = "num"; kinds[K_CARD_H] = "num"; kinds[K_HIDE_EMPTY] = "bool";') >= 0,
  "A25：🔴 导入的键型表也有这三个（少了就静默丢设置 —— 本轮自检发现的真缺口）");

/* ================= B. 面板填空（boss 第 5 条） ================= */
console.log("\n== R27 · 面板：摘要条 ==");

ok(count(/^  panelSummary\(\) \{/m, cb) === 1, "B1：panelSummary() 只定义 1 次");
const ps = bodyOf(cb, "panelSummary() {");
["篇笔记", "个板块", "正文开", "可编辑"].forEach(t => {
  ok(ps.indexOf(t) >= 0, "B2：摘要里有「" + t + "」");
});
ok(ps.indexOf("隐藏空板块") >= 0 && ps.indexOf("只读") >= 0,
  "B3：开着才报的两个状态（隐藏空板块 / 只读）也在");
ok(/try \{/.test(ps) && /catch \(e\) \{ return ""; \}/.test(ps),
  "B4：摘要出错也不能把面板带崩（返回空串，头还在）");
ok(cb.indexOf('this.panelSubEl = this.panelEl.createDiv({ cls: "cb-panel-sub" });') >= 0,
  "B5：摘要条真建在窗头上（.cb-panel-sub）");
ok(cb.indexOf("if (this.panelSubEl) this.panelSubEl.setText(this.panelSummary());") >= 0,
  "B6：每次 renderPanel 都重算（改了开关摘要立刻跟上）");

console.log("\n== R27 · 面板：新增「内容」组 ==");
ok(cb.indexOf('this.addGroup("内容")') >= 0, "B7：多出一段「内容」（原来只有 卡片 / 看板行为 / 板块）");
ok(count(/this\.addGroup\(/g, bodyOf(cb, "renderPanel() {")) === 4,
  "B8：正好 4 组（卡片 / 看板行为 / 内容 / 板块），高级仍是 details 不算组");
ok(cb.indexOf("this.addPropsRow(contentBox)") >= 0 && cb.indexOf("this.addCharsRow(contentBox)") >= 0,
  "B9：两个新行真接进「内容」组（光定义不接 = 死代码）");
const apr = bodyOf(cb, "addPropsRow(parent) {");
ok(apr.indexOf("cfgGet(K_PROPS") >= 0 && apr.indexOf("cfgSet(K_PROPS, v)") >= 0,
  "B10：「显示属性」读写都是老键 K_PROPS（键与语义一个没变，只换台面）");
ok(apr.indexOf('setAttr("placeholder"') >= 0, "B11：给了示例 placeholder（空的时候知道该填什么）");
const acr = bodyOf(cb, "addCharsRow(parent) {");
ok(acr.indexOf("K_CHARS") >= 0 && acr.indexOf("不截断") >= 0,
  "B12：「正文上限」0 = 不截断（说清楚，别让人以为是没生效）");

console.log("\n== R27 · 面板：「卡片」组两行 + 板块组一键全收 ==");
ok(cb.indexOf("this.addGapRow(cardBox)") >= 0 && cb.indexOf("this.addCardHeightRow(cardBox)") >= 0,
  "B13：间距 / 卡片高度两行接进「卡片」组（跟宽度同一套语言）");
ok(count(/^  _sliderRow\(parent, label, tip, min, max, step, value, fmt\) \{/m, cb) === 1,
  "B14：_sliderRow 一行拉杆通用件只定义 1 次（三行共用，不再各抄一遍）");
const sr = bodyOf(cb, "_sliderRow(parent, label, tip, min, max, step, value, fmt) {");
ok(sr.indexOf("parseFloat(rg.value)") >= 0,
  "B15：🔴 parseFloat 兜底 —— rg.value 是字符串，直接喂 num() 会恒回默认值（r20b 抓过的真 bug）");
ok(sr.indexOf("--cb-wpct") >= 0, "B16：拉杆吃 --cb-wpct 渐变（跟宽度那条同一个观感）");
const achr = bodyOf(cb, "addCardHeightRow(parent) {");
ok(achr.indexOf("跟随内容") >= 0, "B17：卡片默认高度有「跟随内容」打勾项（跟宽度的「跟随看板」同一套语言）");
ok(achr.indexOf("cfgSet(K_CARD_H, null)") >= 0,
  "B18：勾上 → 真删掉覆盖（不写一个「等于默认」的数，否则改看板默认它不动）");
ok(achr.indexOf("rg.disabled = f") >= 0, "B19：跟随内容时拉杆置灰（不做假控件）");

ok(count(/^  setAllCollapsed\(v\) \{/m, cb) === 1, "B20：setAllCollapsed() 只定义 1 次");
const sac = bodyOf(cb, "setAllCollapsed(v) {");
ok(sac.indexOf("this.setCollapsed(sec, null, v)") >= 0,
  "B21：走的是同一个 setCollapsed（跟点小三角完全等价，不另存一份状态）");
ok(sac.indexOf("this.afterChange()") >= 0, "B22：全收 / 全开真落盘 + 重绘（不是只改内存）");
ok(sac.indexOf('this.sections.find((x) => x.srcIndex === i)') >= 0,
  "B23：🔴 按 srcIndex 找板块（sections 的顺序 ≠ secs）");
ok(cb.indexOf('cls: "cb-mini cb-bulk-open"') >= 0 && cb.indexOf('cls: "cb-mini cb-bulk-shut"') >= 0,
  "B24：两个按钮（全部展开 / 全部收起）都在");
eq(count(/this\.setAllCollapsed\(/g, cb), 2,
  "B25：两个按钮各接 1 次（定义处是裸 setAllCollapsed，不算 this.）—— 光定义不接 = 死代码");

console.log("\n== R27 · 面板：板块行标出「已自定义」 ==");
ok(cb.indexOf('cls: "cb-badge cb-badge-ovr", text: "已自定义"') >= 0,
  "B26：行上有「已自定义」徽标（不然「重置设置」为什么亮着看不出来）");
ok(cb.indexOf("if (this.secHasOverride(i)) {") >= 0, "B27：判据就是 secHasOverride（不另造一套判定）");

console.log("\n== R27 · 原生视图选项：内容类也搬走 ==");
const vo = bodyOf(cb, "static getViewOptions(config) {");
ok(vo.length > 0, "B28：getViewOptions 还是静态方法（Bases 视图选项入口）");
const voKeys = (vo.match(/key: K_\w+/g) || []).map(s => s.replace("key: ", "")).sort();
eq(voKeys.join(","), "K_BODY",
  "B29（R27）：原生面板只剩「显正文」（显示属性 / 正文字数搬进顶栏「内容」组）");
ok(vo.indexOf("readBool") < 0, "B30：原来只给它俩用的 readBool 助手已摘掉（不留死代码）");

/* ================= C. 右键菜单（boss 第 1~4 条） ================= */
console.log("\n== R27 · 帮助文字一条一行（boss 第 1 条） ==");

const hb = cbRaw.slice(cbRaw.indexOf("helpBox.setText("), cbRaw.indexOf("是整个看板共用的"));
ok(hb.length > 0, "C1：帮助文案那一坨定位得到");
/* 注意：只有第一行是 `+ "\\n"`（前后都有引号），后三行是长字符串尾巴上的 `…块\\n"`
   —— 所以数「反斜杠 + n」这个两字符序列，别数带引号的。 */
eq(count(/\\n/g, hb), 4, "C2：🔴 5 条说明之间正好 4 个 \\n（一条一行，不再挤成一坨）");
ok(/^ *"「" \+ secName \+ "」　数据源 "/m.test(cbRaw), "C3：第一行仍是「板块名 + 数据源」（老信息没丢）");
ok(hb.indexOf("· ") >= 0, "C4：每行以「·」起头（pre-line 之下看得出层级）");
ok(/\.cb-sec-help \{[\s\S]{0,80}?white-space: pre-line;/.test(cssRaw),
  "C5：🔴 CSS 侧给了 white-space: pre-line —— 没有它 \\n 根本不换行（改了等于没改）");
/* C5b（真引擎几何抓到的回归）：开了 pre-line 之后「最长那一行」成了菜单 max-content 的新
   驱动者 —— 不封顶时菜单从 232 被撑到 278（老板认可的那个窄窗胖了）。必须给 max-width。 */
ok(/\.cb-sec-help \{[\s\S]{0,200}?max-width: \d+px;/.test(cssRaw),
  "C5b：🔴 说明块必须 max-width 封顶（铁律 60：菜单宽 = 最宽子行 max-content，不封顶就撑胖窄窗）");
ok(!/\.cb-sec-help \{[\s\S]{0,200}?max-width: (2[4-9]\d|[3-9]\d\d)px;/.test(cssRaw),
  "C5c：封顶值要小于既有最宽行（219.2），别写 240+ 等于没封");

console.log("\n== R27 · 新建文件后描边闪一下（boss 第 2 条） ==");

ok(count(/^  flashNewCard\(path\) \{/m, cb) === 1, "C6：flashNewCard() 只定义 1 次");
const fc = bodyOf(cb, "flashNewCard(path) {");
ok(fc.indexOf('el.getAttribute("data-path") === path') >= 0,
  "C7：按 data-path 认卡片（不靠下标 —— 重绘后顺序会变）");
ok(fc.indexOf('el.addClass("cb-flash")') >= 0, "C8：真挂 .cb-flash 类");
ok(fc.indexOf("this.flashTimeout") < 0 && /setTimeout\(\(\) => \{[\s\S]{0,200}?flashPath = null;/.test(fc),
  "C9：~1.6s 后统一摘掉（顺带把 flashPath 清掉，不留脏状态）");
ok(/}, 1600\);/.test(fc), "C10：闪的时长就是 1600ms（跟 CSS 动画时长对齐）");
ok(cb.indexOf("this.flashNewCard(path);") >= 0, "C11：createInSection 建完真调它（光定义不接 = 死代码）");
ok(cb.indexOf("if (this.flashPath && this.flashPath === file.path) card.addClass(\"cb-flash\");") >= 0,
  "C12：renderCard 也认 flashPath —— 建完紧跟的那次重绘会把类补回去（否则闪一下就被重绘吃掉）");
ok(/if \(this\.flashTimer\) \{[\s\S]{0,160}?clearTimeout\(this\.flashTimer\)/.test(cb),
  "C13：onunload 清定时器（插件关了还回调 = 报错）");

console.log("\n== R27 · 改完不关窗 + 顶上一条回执（boss 第 3 条） ==");

ok(count(/^  refreshSecMenu\(\) \{/m, cb) === 1, "C14：refreshSecMenu() 只定义 1 次");
const rsm = bodyOf(cb, "refreshSecMenu() {");
ok(rsm.indexOf("const a = this.secMenuAnchor;") >= 0 && rsm.indexOf("if (!a) return null;") >= 0,
  "C15：靠记下的锚点就地重开（没记过就什么都不做，不瞎弹）");
ok(rsm.indexOf("this.sections.find((s) => s.srcIndex === a.si)") >= 0,
  "C16：🔴 按 srcIndex 找板块 —— 写 sections[a.si] 会抓错（sections 顺序 ≠ secs）");
ok(rsm.indexOf("this.closeSecMenu(); return null;") >= 0,
  "C17：板块没了就干脆收窗（别把一个指向空气的菜单留着）");
ok(cb.indexOf("this.secMenuAnchor = si >= 0 ? { si: si, x: x, y: y } : null;") >= 0,
  "C18：开窗时记锚点（第几块 + 鼠标处）");
ok(cb.indexOf("this.secMenuAnchor = null;") >= 0, "C19：closeSecMenu 里把锚点一并作废（否则关完还能「就地重开」）");

ok(count(/^  note\(msg\) \{/m, cb) === 1, "C20：note() 只定义 1 次");
const nt = bodyOf(cb, "note(msg) {");
ok(nt.indexOf("this.secMenuStatus = msg;") >= 0 && nt.indexOf("this.saveState = msg;") >= 0,
  "C21：🔴 回执走专用通道 —— 只写 saveState 会被 persist() 覆写成「已写入 .base」（真 DOM 冒烟抓到的）");
ok(cb.indexOf('cls: "cb-ctx-status"') >= 0, "C22：菜单顶上真建了那条回执");
ok(cb.indexOf('if (!keepMsg) this.secMenuStatus = "";') >= 0,
  "C23：新一次右键（keepMsg=false）把上一条回执清掉（回执说的是「这一次」）");
ok(cb.indexOf("openSecMenu(sec, x, y, keepMsg) {") >= 0, "C24：openSecMenu 多了第 4 个形参 keepMsg");

const noteUse = count(/this\.note\(/g, cb);
ok(noteUse >= 8, "C25：菜单里的设置项都改走 note（三态 / 宽度 / 高度 / 文件操作 / 重置 / 收起）(got=" + noteUse + ")");
ok(!/this\.saveState = "「" \+ secName/.test(cb),
  "C26：🔴 菜单里不再直接写 saveState（写了也会被 persist 吃掉 —— 一律走 note）");
const rsmPairs = count(/this\.afterChange\(\);\s*\n\s*this\.refreshSecMenu\(\);/g, cb);
ok(rsmPairs >= 5, "C27：改完一律「落盘 + 就地刷新」，不再 closeSecMenu()(got=" + rsmPairs + ")");

console.log("\n== R27 · 刷新下面加「收起 / 展开本板块」（boss 第 4 条） ==");

const iRefresh = cb.indexOf('item("刷新", () => this.refreshBoard());');
const iCollapse = cb.indexOf('itemStay(isCol ? "展开本板块" : "收起本板块"');
ok(iRefresh > 0 && iCollapse > iRefresh, "C28：位置就在「刷新」下面（老板点名的顺序）");
ok(cb.indexOf('const isCol = this.isCollapsed(sec, null, false);') >= 0,
  "C29：标签跟着当前折叠状态走（收起 / 展开两个文案，不是写死一个）");
const colBlk = cb.slice(iCollapse, iCollapse + 400);
ok(colBlk.indexOf("this.setCollapsed(sec, null, !isCol)") >= 0,
  "C30：走的是同一个 setCollapsed（跟点小三角完全等价）");
ok(colBlk.indexOf("this.afterChange()") >= 0, "C31：真落盘（K_FOLD 折叠表）+ 重绘");
ok(colBlk.indexOf("this.note(") >= 0, "C32：点了留一条回执（「已收起 / 已展开」）");
ok(cb.indexOf("if (canSec) {") >= 0, "C33：不可单独设的板块不摆这一项（别给人假按钮）");

console.log("\n== R27 · 重置设置也不关窗 ==");
const rstIdx = cb.indexOf('resetEl.setAttr("data-act", "重置设置");');
const rstBlk = cb.slice(rstIdx, rstIdx + 700);
ok(rstBlk.indexOf("this.refreshSecMenu();") >= 0 && rstBlk.indexOf("this.closeSecMenu();") < 0,
  "C34：重置完就地刷新（重置后那一行立刻变「已是默认」并置灰，看得见结果）");
ok(rstBlk.indexOf("this.note(") >= 0, "C35：重置也留回执");

/* ================= D. CSS ================= */
console.log("\n== R27 · CSS ==");

ok(cssSeg.length > 0, "D1：cb.css 里有 R27 段落");
ok(/--cb-gap:\s*8px;/.test(cssRaw), "D2：--cb-gap 有声明（默认 8，跟 gapOf() 的兜底一致，r3b 白名单也认它）");
ok(/\.cb-grid \{[\s\S]{0,400}?gap: var\(--cb-gap, 8px\);/.test(cssRaw),
  "D3：🔴 栅格 gap 吃变量（写死的 8px 已经就地改掉，不是新加一条覆盖）");
ok(cssSeg.indexOf(".cb-grid") < 0,
  "D4：R27 段里没有第二条 .cb-grid（两条规则打架 = 以后改哪条都失效）");
ok(/\.cb-ctx-status \{[\s\S]{0,260}?border-left: 2px solid var\(--interactive-accent\);/.test(cssSeg),
  "D5：回执那条左边一道强调色竖条（一眼认出是回执，不是新的设置项）");
ok(/\.cb-card\.cb-flash \{[\s\S]{0,200}?border-color: var\(--interactive-accent\);/.test(cssSeg),
  "D6：描边闪的类自带强调色描边（关掉动画也留得住）");
ok(/@keyframes cb-flash-ring \{/.test(cssSeg), "D7：有 keyframes（动效只是让它动起来）");
ok(/@keyframes cb-flash-ring \{[\s\S]{0,600}?border-color \/ box-shadow/.test(cssSeg) === false
  && /100% \{\s*\n\s*border-color: var\(--background-modifier-border\);/.test(cssSeg),
  "D8：动画只碰 border-color / box-shadow（不碰尺寸 —— 卡片绝不能跳一下）");
ok(/\.cb-panel-sub \{[\s\S]{0,300}?background-color: var\(--background-secondary\);/.test(cssSeg),
  "D9：摘要条自己一层浅底（跟标题连成一个块，把正文分开）");
ok(!/\.cb-panel-head\s*[,{]/.test(cssSeg.replace(/\/\*[\s\S]*?\*\//g, "")),
  "D10：🔴 R27 没有给 .cb-panel-head 立新规矩（注释里提到不算）—— 它的 border-bottom 被 r22 钉着，再画一条就是双线");
ok(/\.cb-bulk \{/.test(cssSeg) && /\.cb-bulk \.cb-mini \{/.test(cssSeg),
  "D11：一键全开 / 全收那行有自己的排版（复用 .cb-mini，没另造按钮样式）");
ok(/\.cb-badge-ovr \{/.test(cssSeg), "D12：「已自定义」徽标有专属样式（跟普通属性徽标分得开）");

/* 零裸色：R27 段里所有颜色值都必须走 var()（color-mix 只许用主题变量调） */
(function () {
  const s = cssSeg.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(?:^|[;{])\s*(color|background|background-color|border[a-z-]*-color|outline-color)\s*:\s*([^;}]+)/g;
  const bad = [];
  let m;
  while ((m = re.exec(s))) {
    const v = m[2].trim();
    if (/^var\(/.test(v)) continue;
    if (/^color-mix\(/.test(v) && !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(v)) continue;
    if (/^(transparent|none|inherit|currentcolor|unset|initial|auto)$/i.test(v)) continue;
    bad.push(m[1] + ":" + v);
  }
  ok(bad.length === 0, "D13：R27 段零裸色（全走主题变量 / 只用主题色 color-mix）" + (bad.length ? " 违规：" + bad.join(" | ") : ""));
})();
ok(/background-color: var\(--background-secondary\);\s*\n\s*background-color: color-mix\(/.test(cssSeg),
  "D14：淡底色 color-mix 前留了 var() 兜底行（老引擎不认 color-mix 也不至于没底）");

/* ================= E. 出货产物 ================= */
console.log("\n== R27 · 出货产物 ==");

ok(mainJs.indexOf("const K_GAP = \"网格间距\";") >= 0 && mainJs.indexOf("const K_CARD_H = \"卡片默认高度\";") >= 0,
  "E1：main.js 里三个新键都在（改了源没 build = 老板真机上什么都没变）");
ok(mainJs.indexOf("cb-panel-sub") >= 0 && mainJs.indexOf("cb-ctx-status") >= 0
  && mainJs.indexOf("cb-flash") >= 0 && mainJs.indexOf("cb-badge-ovr") >= 0,
  "E2：四个新外观件都进了出货代码");
ok(stylesCss.indexOf(".cb-badge-ovr {") >= 0 && stylesCss.indexOf("--cb-gap: 8px;") >= 0
  && stylesCss.indexOf("@keyframes cb-flash-ring {") >= 0,
  "E3：styles.css 同步（含 keyframes）");
ok(mainJs.indexOf(cbRaw) >= 0, "E4：main.js 里内嵌的看板 == vendor 原件（字节级，不是抄了一份）");
ok(stylesCss.indexOf(cssRaw) >= 0, "E5：styles.css 里 cb.css 是原样合并的");
ok(Buffer.byteLength(mainJs, "utf8") > 500000, "E6：main.js 体积合理（>500KB）");

/* ================= F. 复写病自检 ================= */
console.log("\n== R27 · 复写病自检（新方法各只许定义一次）==");

const METHODS = ["refreshSecMenu", "flashNewCard", "note", "applyRootVars", "cardHeightDefault",
  "gapOf", "hideEmpty", "panelSummary", "setAllCollapsed", "_sliderRow", "addGapRow",
  "addCardHeightRow", "addCharsRow", "addPropsRow", "secHasOverride"];
const dup = METHODS.filter((m) => count(new RegExp("\\n  " + m + "\\(", "g"), cb) !== 1);
ok(dup.length === 0, "F1：" + METHODS.length + " 个方法各自恰好定义 1 次"
  + (dup.length ? "（重复/缺失：" + dup.join(",") + "）" : ""));

/* ================= G. 兼容（老能力不能被碰坏） ================= */
console.log("\n== R27 · 兼容 ==");

ok(count(/const K_SEC_W = "文件宽度";/g, cb) === 1 && count(/const K_SEC_H = "卡片高度";/g, cb) === 1,
  "G1：R25 / R26 的板块级键仍在，各只定义 1 次");
ok(cb.indexOf('grp("通用设置", "只对「" + secName + "」")') >= 0
  && cb.indexOf('grp("新建板块", "整个看板")') >= 0
  && cb.indexOf('grp("文件操作", "整个看板")') >= 0,
  "G2：R24 / R25 那五组的组头（作用域一眼可见）一个字没动");
ok(count(/const triRow = \(label, field, viewOn, tip\) => \{/g, cb) === 1, "G3：四个三态行那套原样在");
ok(cb.indexOf("beginRenameSection(sec, nameEl) {") >= 0 && cb.indexOf("bindLongPress(head,") >= 0,
  "G4：双击 / 单击改名 + 长按呼出（R24 / R26）都还在");
ok(count(/this\.applyRootVars\(\);/g, cb) >= 2 && cb.indexOf("deferRepaintUntilBlur") >= 0,
  "G5：编辑器输入保护没被这轮收口碰坏");
ok(cb.indexOf("openSecMenu(sec, x, y, keepMsg) {") >= 0 && count(/openSecMenu\(sec, x, y, keepMsg\) \{/g, cb) === 1,
  "G6：openSecMenu 仍只定义 1 次（签名变了，复写病自检照旧）");

console.log("\nR27 结果: " + pass + " 通过 / " + fail + " 失败"
  + (fail ? "\n  - " + fails.join("\n  - ") : ""));
process.exit(fail ? 1 : 0);
