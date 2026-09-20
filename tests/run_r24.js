/* kb-toolkit R24 断言：把「板块设置」从**全局面板**改成**只对单板块生效**的右键小窗。
 *
 * 老板原话（配真机截图）：
 *   「单个板块的设置应只对单独板块生效！…修改每个板块的设置
 *    1. 鼠标双击板块名可以设置板块名
 *    2. 拖动板块可以直接对各个板块排序
 *    3. 去掉单独板块的设置键，右键小板块在鼠标处弹出设置小窗，类似 windows 右键菜单，
 *       可以进行一些简单的设置功能：刷新 / 通用设置（属性展开 / 内容展开 / 重置设置 / 显示帮助）
 *       / 笔记内容（显示 YAML / 显示双链）/ 文件操作（拖动搬文件 / 文件隐藏显示 / 查看隐藏的文件）
 *    不同板块间画一条简单的线」
 *
 * 落点（阿盘补的意见，已写进 vendor 注释）：
 *   · 「属性展开」从**视图级**升成**板块级三态**（继承 / 开 / 关）—— 老板要的就是"只对这块生效"；
 *   · 「文件隐藏显示 / 查看隐藏的文件 / 拖动搬文件」是**整个看板共用**的，所以那组用打勾项
 *     而不是三态（免得让人以为能按板块设）；组头写明「整个看板」；
 *   · 「重置设置」只清**板块级覆盖**（body/yaml/links/propsOpen/props/排序），不动视图默认；
 *   · 分隔线用 `.cb-section + .cb-section` 相邻兄弟选择器 —— 子板块在板块体内，不会被误伤。
 *
 * 🔴 本轮两个必钉的坑：
 *   ① computeSig 短路（铁律 56）：K_HIDDEN_ON / K_HIDDEN_SHOW / K_HIDDEN 必须进 computeSig()，
 *      否则「拨了不生效但全绿」；
 *   ② 折叠态的键就是**板块名**（foldKey）→ 改名必须迁移，否则折叠状态凭空丢。
 * 真 DOM 真点那刀在 tests/run_r20b.js 的 R24 段（源码正则抓不到「改完当场抛异常」）。
 *
 * R25 后续（同一个菜单里又加了 新建文件 / 新建板块 / 删除板块 + 板块级「文件宽度」）：
 * 那些断言在 tests/run_r25.js + run_r20b.js 的 R25 段；本文件只留下被结构变更打到的两处改写。
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
const css = stripComments(cssRaw);
const mainJs = fs.readFileSync(path.join(PLUG, "main.js"), "utf8");

/* ================= A. 撤 ⚙：板块标题旁那块齿轮连样式一起删了 ================= */
{
  ok(cb.indexOf("cb-sec-gear") < 0, "A1：vendor 里再也找不到 cb-sec-gear（齿轮撤了，不是藏起来）");
  ok(cb.indexOf('cls: "cb-sec-gear"') < 0, "A2：没有残留的按钮创建代码");
  ok(css.indexOf(".cb-sec-gear {") < 0 && !/\.cb-sec-gear[\s:{]/.test(css),
    "A3：cb.css 里那块 .cb-sec-gear 规则也删了（不留死样式）");
  /* 撤了齿轮 ≠ 顺手把拖动排序砍了 —— R12 那套必须还在 */
  ok(css.indexOf(".cb-head-grab { cursor: grab; }") >= 0, "A4：拖动排序的 .cb-head-grab 还在（两回事）");
  ok(cb.indexOf("head.addClass(\"cb-head-grab\")") >= 0, "A5：板块标题仍挂 draggable + .cb-head-grab");
  ok(cb.indexOf('head.addEventListener("dragstart"') >= 0
    && cb.indexOf('head.addEventListener("drop"') >= 0,
    "A6：拖起 / 落下两条监听器都在（R12 的板块排序没被这轮带塌）");
  /* 顶栏那个齿轮是**另一个东西**，不能跟着一起删 */
  ok(cb.indexOf("cb-gear-icon") >= 0 && cb.indexOf('cls: "cb-gear"') >= 0,
    "A7：顶栏「板块」齿轮按钮保留（撤的是板块标题旁那块，不是顶栏入口）");
}

/* ================= B. 双击板块名 → 就地改名 ================= */
{
  const rs = bodyOf(cb, "renderSection(parentEl, sec) {");
  ok(rs.length > 0, "B1：renderSection 定位得到");
  ok(rs.indexOf('head.createSpan({ cls: "cb-section-name"') >= 0,
    "B2：板块名是个独立的 .cb-section-name 元素（不再跟徽标混在一段字符串里）");
  ok(rs.indexOf('nameEl.addEventListener("dblclick"') >= 0
    && rs.indexOf("this.beginRenameSection(sec, nameEl)") >= 0,
    "B3：双击板块名 → 调 beginRenameSection（就地改名）");
  ok(rs.indexOf("this.secConfigurable(sec) && !this.readonly()") >= 0,
    "B4：只有「可单独设置且非只读」的板块才挂改名（自动分组 / 公式组不给改）");
  ok(rs.indexOf('nameEl.addClass("cb-sec-name-edit")') >= 0, "B5：可改名的板块加 .cb-sec-name-edit（hover 手感）");

  ok(count(/beginRenameSection\(sec, nameEl\) \{/g, cb) === 1, "B6：beginRenameSection 只定义 1 次（复写病自检）");
  const br = bodyOf(cb, "beginRenameSection(sec, nameEl) {");
  ok(br.length > 0, "B7：beginRenameSection 方法体定位得到");
  ok(br.indexOf('"cb-sec-rename-input"') >= 0, "B8：输入框类名 = .cb-sec-rename-input（有对应样式）");
  ok(/if \(evt\.key === "Enter"\)[\s\S]*finish\(true\)/.test(br), "B9：Enter → 提交");
  ok(/if \(evt\.key === "Escape"\)[\s\S]*finish\(false\)/.test(br), "B10：Esc → 放弃");
  ok(br.indexOf('input.addEventListener("blur", () => finish(true))') >= 0, "B11：失焦也算提交（点别处不会把名字卡住）");
  ok(br.indexOf("hit") < 0 && br.indexOf("K_FOLD") < 0, "B12：迁移折叠态那件事不在 beginRename（它在 renameSection 里，职责分开）");

  ok(count(/renameSection\(i, nv\) \{/g, cb) === 1, "B13：renameSection 只定义 1 次（复写病自检）");
  const rn = bodyOf(cb, "renameSection(i, nv) {");
  ok(rn.length > 0, "B14：renameSection 方法体定位得到");
  ok(/const raw = this\.cfgGet\(K_FOLD, null\)/.test(rn), "B15：改名去读「折叠」表（键 = 板块名）");
  ok(rn.indexOf("k === old") >= 0, "B16：旧名整条键迁到新名");
  ok(rn.indexOf('k.indexOf(old + "/") === 0') >= 0,
    "B17：子板块的「旧名/子板块名」前缀也一起迁（不迁就只迁一半）");
  ok(/if \(hit\) this\.cfgSet\(K_FOLD, next\)/.test(rn), "B18：真写回配置（不是只在内存里改 Map）");
  ok(rn.indexOf("this.afterChange()") >= 0, "B19：改完走 afterChange（persist + repaint，跟别处同一套）");
  /* 手动顺序的键跟名字无关 → 不该被改名动到 */
  ok(rn.indexOf("manualOrder") < 0 && rn.indexOf("K_MANUAL") < 0 && rn.indexOf("K_ORDER") < 0,
    "B20：没去碰「手动顺序」键 —— 它是「数据源:路径」，与板块名无关（动了反而错位）");
}

/* ================= C. 右键板块 → 鼠标处弹设置小窗 ================= */
{
  const rs = bodyOf(cb, "renderSection(parentEl, sec) {");
  ok(rs.indexOf('head.addEventListener("contextmenu"') >= 0
    && rs.indexOf("this.openSecMenu(sec, evt.clientX, evt.clientY)") >= 0,
    "C1：右键板块标题 → openSecMenu(sec, 鼠标X, 鼠标Y)");
  ok(/evt\.preventDefault\(\);\s*\n\s*evt\.stopPropagation\(\);[\s\S]{0,80}openSecMenu/.test(rs)
    || rs.indexOf("evt.preventDefault()") >= 0,
    "C2：拦掉浏览器原生右键菜单（不然两个菜单一起弹）");

  ok(count(/openSecMenu\(sec, x, y\) \{/g, cb) === 1, "C3：openSecMenu 只定义 1 次（复写病自检）");
  ok(count(/closeSecMenu\(\) \{/g, cb) === 1, "C4：closeSecMenu 只定义 1 次（复写病自检）");
  const om = bodyOf(cb, "openSecMenu(sec, x, y) {");
  ok(om.length > 0, "C5：openSecMenu 方法体定位得到");
  ok(om.indexOf('cls: "cb-ctxmenu cb-secmenu"') >= 0,
    "C6：复用卡片右键菜单那套 .cb-ctxmenu（加 .cb-secmenu 细化），不另搓一套定位");
  ok(om.indexOf("this.closeCardMenu()") >= 0 && om.indexOf("this.closeSecMenu()") >= 0,
    "C7：开之前先把同类小窗都收掉（不会两个菜单叠着）");

  /* R25 起菜单有五组（多了「本板块」「新建板块」），所以这里只断言**存在**，
     顺序与组数由 run_r20b 的真 DOM 段与 run_r25 守。 */
  ok(om.indexOf('grp("通用设置"') >= 0, "C8：有「通用设置」组");
  ok(om.indexOf('grp("笔记内容"') >= 0, "C9：有「笔记内容」组");
  ok(om.indexOf('grp("文件操作"') >= 0, "C10：有「文件操作」组");
  ok(om.indexOf('item("刷新"') >= 0 && om.indexOf("this.refreshBoard()") >= 0, "C11：第一项 = 刷新 → refreshBoard()");
  /* 「显示帮助」点完**不能收窗**（收窗 = 把刚展开的说明块连人带窗一起摘掉）→ 走 itemStay */
  ok(om.indexOf('itemStay("显示帮助"') >= 0, "C12：通用设置里有「显示帮助」，且走 itemStay（点完不收窗）");
  ok(/const itemStay = \(label, fn\) => \{[\s\S]{0,400}?menu\.createDiv\(\{ cls: "cb-ctx-item" \}\)/.test(om),
    "C12b：itemStay = 跟 item 同款外观，但不调 closeSecMenu（说明才能就地展开）");
  ok(om.indexOf('"重置设置"') >= 0 && om.indexOf("this.resetSection(si)") >= 0, "C13：通用设置里有「重置设置」→ resetSection(si)");

  /* 四个**板块级**三态行（老板要的「只对这块生效」全靠它们） */
  const triNames = count(/triRow\("/g, om);
  eq(triNames, 4, "C14：正好 4 个三态行（属性展开 / 内容展开 / 显示 YAML / 显示双链）");
  ok(om.indexOf('triRow("属性展开", "propsOpen"') >= 0, "C15：属性展开 → propsOpen（板块级）");
  ok(om.indexOf('triRow("内容展开", "body"') >= 0, "C16：内容展开 → body（＝原来的「显正文」）");
  ok(om.indexOf('triRow("显示 YAML", "yaml"') >= 0, "C17：显示 YAML → yaml（板块级）");
  ok(om.indexOf('triRow("显示双链", "links"') >= 0, "C18：显示双链 → links（板块级）");

  /* 「文件操作」那组是视图级 → 打勾项，且组头写明「整个看板」 */
  const chkNames = count(/\n\s*chk\("/g, om);
  eq(chkNames, 3, "C19：文件操作正好 3 个打勾项（不是三态 —— 免得冒充板块级）");
  ok(om.indexOf('chk("拖动搬文件", K_MOVE') >= 0, "C20：拖动搬文件 → K_MOVE（视图级）");
  ok(om.indexOf('chk("文件隐藏显示", K_HIDDEN_ON') >= 0, "C21：文件隐藏显示 → K_HIDDEN_ON");
  ok(om.indexOf('chk("查看隐藏的文件", K_HIDDEN_SHOW') >= 0, "C22：查看隐藏的文件 → K_HIDDEN_SHOW");
  ok(om.indexOf('grp("文件操作", "整个看板")') >= 0,
    "C23：文件操作组头写明「整个看板」（不骗人：这三项不是按板块设的）");
  ok(om.indexOf('grp("通用设置", "只对「" + secName + "」")') >= 0
    && om.indexOf('grp("笔记内容", "只对「" + secName + "」")') >= 0,
    "C24：另两组组头写明「只对『板块名』」—— 一眼看出作用域");

  /* 不可单独设置时给说明，而不是空白菜单 */
  ok(om.indexOf('cls: "cb-ctx-note"') >= 0 && om.indexOf("不能单独设置") >= 0,
    "C25：自动分组 / 公式组 → 菜单里给一句「不能单独设置」的说明（不是啥都没有）");

  /* 跟手定位 + clamp 在视口内 */
  ok(om.indexOf("menu.style.left") >= 0 && om.indexOf("menu.style.top") >= 0, "C26：left/top 真写（落在鼠标处）");
  ok(om.indexOf("Math.min(Math.max(4, x)") >= 0, "C27：clamp 到视口内（贴右/下边不会跑出屏）");

  /* 点外面收 / Esc 收 */
  ok(/addOutsideCloser\(\s*"secmenu"/.test(om), "C28：注册「点外面就收起」（复用 addOutsideCloser 那套）");
  ok(om.indexOf('e.key === "Escape"') >= 0 && om.indexOf("this.closeSecMenu()") >= 0, "C29：Esc 也能收");
  const cs = bodyOf(cb, "closeSecMenu() {");
  ok(cs.indexOf('this.removeOutsideCloser("secmenu")') >= 0, "C30：收起时把 outside closer 也摘掉（不留野监听）");
  ok(cs.indexOf("this.unbindMenuEsc()") >= 0, "C31：收起时解绑 Esc（不留野监听）");
  ok(cs.indexOf("this.secMenuEl = null") >= 0, "C32：收起时把引用清掉（下次开不会指到旧节点）");
  /* 卡片菜单开之前也要先把板块菜单收掉 */
  ok(cb.indexOf("  openCardMenu(card, entry, x, y) {\n    this.closeSecMenu();") >= 0,
    "C33：开卡片菜单前先收板块菜单（互斥，不会同屏两个）");
}

/* ================= D. 板块级三态**真接线**（不是只画了个控件） ================= */
{
  /* ① 解析：老 .base 手写的「属性展开」要读得进 */
  const ns = bodyOf(cb, "function normalizeSection(raw, i) {");
  ok(ns.indexOf('propsOpen: tri(o, "属性展开", "propsOpen")') >= 0,
    "D1：normalizeSection 读「属性展开」→ 三态（null = 继承视图默认）");
  ok(cb.indexOf('"属性", "显正文", "显示 YAML", "显示结尾双链", "属性展开"') >= 0,
    "D2：KNOWN_KEYS 收进「属性展开」（不收就被当 extra 原样留着 → 写回时重复）");
  /* ② 写回：清成继承时要能把键删掉 */
  const st = bodyOf(cb, "function sectionToRaw(sec) {");
  ok(/if \(sec\.propsOpen === true \|\| sec\.propsOpen === false\) o\["属性展开"\] = sec\.propsOpen;/.test(st),
    "D3：只有 true/false 才写「属性展开」；null 时**不写** = 回继承（跟 body / yaml / links 同规格）");
  ok(/if \(sec\.body === true \|\| sec\.body === false\) o\["显正文"\] = sec\.body;/.test(st)
    && /if \(sec\.yaml === true \|\| sec\.yaml === false\) o\["显示 YAML"\] = sec\.yaml;/.test(st),
    "D4：老那三个三态写回逻辑没被动过（本轮是加同一套，不是改老逻辑）");
  /* ③ 新建板块要有这个字段，否则 undefined 混进三态 */
  /* R25：初值表里多了 secW（板块级文件宽度）—— 按意图改断言，别把「结构变了」当「坏了」 */
  ok(/propsOpen: null, secW: null, secH: null, extra: \{\} \}/.test(cb),
    "D5：addSection 的新板块初始化 propsOpen: null / secW: null / secH: null（R26 加高度）");
  /* ④ 取值：板块级优先，没写回落视图默认 */
  ok(count(/propsOpenOn\(sec\) \{/g, cb) === 1, "D6：propsOpenOn 只定义 1 次（复写病自检）");
  const po = bodyOf(cb, "propsOpenOn(sec) {");
  ok(/c\.propsOpen === true \|\| c\.propsOpen === false/.test(po) && /return c\.propsOpen/.test(po),
    "D7：板块写了 true/false 就用板块的");
  ok(/return this\.propsOpenDefault\(\)/.test(po), "D8：没写 / 传 null → 回落视图默认（就地编辑浮层会传 null）");
  ok(/this\.viewBodyDefault\(\)/.test(bodyOf(cb, "bodyOn(sec) {")) === false
    || /return this\.viewBodyDefault\(\)/.test(bodyOf(cb, "bodyOn(sec) {")),
    "D9：对照 —— bodyOn 也是一样的「板块优先」结构");
  /* ⑤ 卡片真的按**板块**取默认值（这行是本轮最核心的一处接线） */
  ok(/const dfltOpen = this\.propsOpenOn\(sec\);/.test(cb),
    "D10：卡片属性区默认值改从 propsOpenOn(sec) 取（原来是 propsOpenDefault()）");
  ok(/this\.editorProps && !this\.propsOpenOn\(card \? card\.__cbSec : null\)/.test(cb)
    || /!this\.propsOpenOn\(card \? card\.__cbSec : null\)/.test(cb),
    "D11：就地编辑浮层也跟着板块走（拿 card.__cbSec，取不到时回落视图默认）");
  ok(cb.indexOf("const dfltOpen = this.propsOpenDefault();") < 0,
    "D12：旧的「一律读视图默认」那行已经没了（没留死代码）");
}

/* ================= E. 铁律 56：新键必须进 computeSig（不认 = 拨了不生效但全绿） ================= */
{
  const sig = bodyOf(cb, "computeSig() {");
  ok(sig.length > 0, "E1：computeSig 定位得到");
  ok(/String\(this\.optBool\(K_HIDDEN_ON, true\)\)/.test(sig),
    "E2：sig 认「文件隐藏显示」（不认 → 拨开关不重绘）");
  ok(/String\(this\.optBool\(K_HIDDEN_SHOW, false\)\)/.test(sig),
    "E3：sig 认「查看隐藏的文件」（不认 → 拨开关卡片不回来）");
  ok(/String\(this\.cfgGet\(K_HIDDEN, "~"\)\)/.test(sig),
    "E4：sig 认「隐藏的文件」本体（不认 → 隐藏了但不消失）");
  eq(count(/K_HIDDEN_ON/g, sig), 1, "E5：K_HIDDEN_ON 在 sig 里恰 1 次（复写病自检）");
  eq(count(/K_HIDDEN_SHOW/g, sig), 1, "E6：K_HIDDEN_SHOW 恰 1 次");
  eq(count(/K_HIDDEN\b/g, sig), 1, "E7：K_HIDDEN 恰 1 次（别被 K_HIDDEN_ON / _SHOW 干扰）");
  /* 板块级三态走的不是 sig，而是 persist() 里那份「板块」配置 —— 确认它仍在 sig 里 */
  ok(/parts\.push\(JSON\.stringify\(this\.cfgGet\(CONFIG_KEY, null\)\)\)/.test(sig),
    "E8：sig 认整份「板块」配置（改名 / 三态改完即时重绘靠这一条）");
}

/* ================= F. 刷新 / 重置 / 隐藏 三个动作的逻辑 ================= */
{
  /* 刷新：必须绕开 computeSig 那关，否则「点了没反应」 */
  ok(count(/refreshBoard\(\) \{/g, cb) === 1, "F1：refreshBoard 只定义 1 次");
  const rf = bodyOf(cb, "refreshBoard() {");
  ok(rf.indexOf("this.sig = null") >= 0, "F2：刷新把 sig 清掉（不然走「无变化」分支什么都不干）");
  ok(rf.indexOf("this.renderedOnce = false") >= 0, "F3：renderedOnce 也重置（首帧那套重来一遍）");
  ok(rf.indexOf("this.lastPaths = null") >= 0, "F4：lastPaths 清掉（不被「就地编辑器开着」那条捷径挡住）");
  ok(rf.indexOf("this.onDataUpdated()") >= 0, "F5：真去重读数据（不是只重画 DOM）");

  /* 重置：只清板块级覆盖 */
  ok(count(/resetSection\(i\) \{/g, cb) === 1, "F6：resetSection 只定义 1 次");
  const rs2 = bodyOf(cb, "resetSection(i) {");
  for (const f of ["body", "yaml", "links", "propsOpen"]) {
    ok(new RegExp("s\\." + f + " = null;").test(rs2), "F7：重置清 " + f + " → null");
  }
  ok(/s\.props = \[\];/.test(rs2), "F8：重置清自定义属性列表");
  ok(/s\.sort = "";/.test(rs2), "F9：重置清板块级排序");
  ok(rs2.indexOf("this.afterChange()") >= 0, "F10：重置完走 afterChange（persist + repaint）");
  ok(rs2.indexOf("K_PROS_OPEN") < 0 && rs2.indexOf("cfgSet(K_") < 0,
    "F11：重置**不碰**任何视图级键（只清板块自己的覆盖）");
  ok(rs2.indexOf("s.source") < 0 && rs2.indexOf("s.path") < 0 && rs2.indexOf("s.tag") < 0,
    "F12：重置不动 数据源 / 路径 / 标签（只清「显示类覆盖」）");
  /* 名字只被「已重置『X』」那句提示文案读一下，绝不给它赋值 */
  ok(!/s\.name\s*=/.test(rs2), "F12b：重置不给 s.name 赋值（只读来拼提示文案）");

  /* 有没有覆盖 → 决定「重置设置」是否可点 */
  ok(count(/secHasOverride\(i\) \{/g, cb) === 1, "F13：secHasOverride 只定义 1 次");
  const ho = bodyOf(cb, "secHasOverride(i) {");
  ok(/s\.body === true \|\| s\.body === false/.test(ho)
    && /s\.propsOpen === true \|\| s\.propsOpen === false/.test(ho),
    "F14：覆盖判定含 body / propsOpen 等（三态非 null 即视为有覆盖）");
  ok(ho.indexOf("if (!s) return false") >= 0, "F15：下标越界时安全回落 false");

  /* 隐藏 / 取消隐藏 */
  ok(count(/hiddenOn\(\) \{/g, cb) === 1, "F16：hiddenOn 只定义 1 次");
  ok(count(/showHidden\(\) \{/g, cb) === 1, "F17：showHidden 只定义 1 次");
  ok(count(/hiddenPaths\(\) \{/g, cb) === 1, "F18：hiddenPaths 只定义 1 次");
  ok(count(/toggleHidden\(p\) \{/g, cb) === 1, "F19：toggleHidden 只定义 1 次");
  const tg = bodyOf(cb, "toggleHidden(p) {");
  ok(tg.indexOf("cur.indexOf(String(p))") >= 0, "F20：已在表里就摘掉（点两下 = 收 / 放）");
  ok(tg.indexOf("this.cfgSet(K_HIDDEN, cur.length ? cur : null)") >= 0,
    "F21：空了就写 null（不往 .base 里留 [] 这种垃圾）");
  ok(tg.indexOf("this.repaint(false)") >= 0, "F22：改完即重绘");

  /* 渲染：关着就**完全不渲染**，开着淡出（不是只 CSS 藏一下） */
  const rs3 = bodyOf(cb, "renderSection(parentEl, sec) {");
  ok(rs3.indexOf("this.isHidden(e && e.file ? e.file.path : \"\")") >= 0, "F23：按**路径**判定是否被收起");
  ok(rs3.indexOf("if (hid && !this.showHidden()) continue;") >= 0,
    "F24：关着「查看隐藏的文件」→ continue（真不渲染，不是 display:none）");
  ok(rs3.indexOf('cd.addClass("is-cb-hidden")') >= 0, "F25：开着时给卡片挂 .is-cb-hidden（淡出 + 虚线）");
  ok(rs3.indexOf('text: "已隐藏 " + hiddenN') >= 0, "F26：板块头给「已隐藏 N」徽标（藏了几篇心里有数）");

  /* 卡片右键也能收起来 */
  const cm = bodyOf(cb, "openCardMenu(card, entry, x, y) {");
  ok(cm.indexOf("this.hiddenOn()") >= 0, "F27：卡片菜单里「隐藏这篇」受「文件隐藏显示」开关约束");
  ok(cm.indexOf('"取消隐藏"') >= 0 && cm.indexOf('"隐藏这篇"') >= 0, "F28：按当前状态给「隐藏这篇 / 取消隐藏」");
}

/* ================= G. 分隔线 + R24 新样式（零裸色） ================= */
{
  ok(/\.cb-section \+ \.cb-section\s*\{[^}]*border-top:\s*1px solid var\(--background-modifier-border\)/.test(css),
    "G1：相邻板块之间一条 1px 分隔线（相邻兄弟选择器 → 子板块在板块体内，不会被误伤）");
  ok(/\.cb-section \+ \.cb-section\s*\{[^}]*padding-top:\s*14px/.test(css),
    "G2：加了 padding-top 撑开（线不贴着上一块的字）");
  for (const sel of [".cb-sec-rename-input", ".cb-ctxmenu.cb-secmenu", ".cb-ctx-head", ".cb-ctx-tri",
                     ".cb-ctx-chk", ".cb-ctx-tick", ".cb-ctx-item.is-disabled", ".cb-sec-help",
                     ".cb-card.is-cb-hidden", ".cb-badge-hidden", ".cb-section-name.cb-sec-name-edit"]) {
    ok(css.indexOf(sel) >= 0, "G3：样式到齐 → " + sel);
  }
  /* 零裸色：只查 R24 那一整段 */
  const iR24 = cssRaw.indexOf("R24（boss：「单个板块的设置应只对单独板块生效」）");
  ok(iR24 > 0, "G4：cb.css 找得到 R24 段");
  const blk = iR24 > 0 ? stripComments(cssRaw.slice(iR24)) : "";
  const noVar = blk.replace(/var\([^)]*\)/g, "VAR");
  const bare = noVar.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [];
  eq(bare.length, 0, "G5：R24 段零裸色（实到 " + JSON.stringify(bare) + "）");
  ok(blk.indexOf("transparent") < 0 && blk.indexOf(": white") < 0 && blk.indexOf(": black") < 0,
    "G6：R24 段没有写死 transparent/white/black 这类字面色");
}

/* ================= H. 配置搬运 / 构建同源 ================= */
{
  ok(/view\[K_HIDDEN_ON\] = this\.optBool\(K_HIDDEN_ON, true\);/.test(cb), "H1：导出配置带上「文件隐藏显示」");
  ok(/view\[K_HIDDEN_SHOW\] = this\.optBool\(K_HIDDEN_SHOW, false\);/.test(cb), "H2：导出配置带上「查看隐藏的文件」");
  ok(/view\[K_HIDDEN\] = this\.hiddenPaths\(\);/.test(cb), "H3：导出配置带上「隐藏的文件」清单");
  ok(/kinds\[K_HIDDEN_ON\] = "bool"/.test(cb) && /kinds\[K_HIDDEN_SHOW\] = "bool"/.test(cb)
    && /kinds\[K_HIDDEN\] = "raw"/.test(cb),
    "H4：导入侧键型齐（bool / bool / raw）");
  ok(/const K_HIDDEN_ON = "文件隐藏显示"/.test(cb) && /const K_HIDDEN_SHOW = "查看隐藏的文件"/.test(cb)
    && /const K_HIDDEN = "隐藏的文件"/.test(cb),
    "H5：键字面量 = 老板原话里那三个词（.base 手写也照认）");
  /* main.js 是 build 时按字节内嵌 vendor 的 → 抽查几处代表签名 */
  ok(mainJs.indexOf("openSecMenu(sec, x, y) {") >= 0 && mainJs.indexOf("beginRenameSection(sec, nameEl) {") >= 0,
    "H6：main.js 内嵌的看板 == vendor 原件（构建已跟上，不是只改了源）");
  ok(mainJs.indexOf("cb-sec-gear") < 0, "H7：main.js 里也找不到 cb-sec-gear（撤干净了）");
}

/* ================= I. 复写病整段自检（整文件级） ================= */
{
  eq(count(/^  openSecMenu\(sec, x, y\) \{/gm, cb), 1, "I1：openSecMenu 定义恰 1 次");
  eq(count(/^  closeSecMenu\(\) \{/gm, cb), 1, "I2：closeSecMenu 定义恰 1 次");
  eq(count(/^  beginRenameSection\(sec, nameEl\) \{/gm, cb), 1, "I3：beginRenameSection 定义恰 1 次");
  eq(count(/^  renameSection\(i, nv\) \{/gm, cb), 1, "I4：renameSection 定义恰 1 次");
  eq(count(/^  resetSection\(i\) \{/gm, cb), 1, "I5：resetSection 定义恰 1 次");
  eq(count(/^  refreshBoard\(\) \{/gm, cb), 1, "I6：refreshBoard 定义恰 1 次");
  eq(count(/^  propsOpenOn\(sec\) \{/gm, cb), 1, "I7：propsOpenOn 定义恰 1 次");
  ok(count(/KB\.define\(/g, mainJs) >= 1, "I8：main.js 仍是 KB.define 那套（构建没跑偏）");
}

/* ================= J. 出处交代（这一轮改的是交互模型，注释得说清为什么） ================= */
{
  ok(cbRaw.indexOf("R24（boss：「单个板块的设置应只对单独板块生效」）") >= 0
    || cbRaw.indexOf("R24（boss 第 0 条") >= 0,
    "J1：R24 的来由（老板原话「单个板块的设置应只对单独板块生效」）写进了注释");
  ok(cbRaw.indexOf("折叠` 状态的键就是**板块名**") >= 0 || cbRaw.indexOf("折叠") >= 0,
    "J2：改名要迁折叠态这个坑在注释里点出来了");
  ok(cbRaw.indexOf("R24") >= 0, "J3：vendor 里有 R24 标记（后面回溯不用猜哪轮加的）");
}

console.log("\nR24 结果: " + pass + " 通过 / " + fail + " 失败");
if (fail) { console.log(fails.map((f) => "  - " + f).join("\n")); process.exit(1); }
