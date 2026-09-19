/* kb-toolkit R15 断言：①卡片宽度真可调 ②bug 排查修复 15 处。
 *   A. 宽度可调 —— 「空位铺满整行」开关（默认开 = R14 行为；关 = 固定滑杆宽度）
 *      / 滑杆范围放宽到 480 / 编辑器开着时宽度变更仍生效 / 配置搬运带上新键
 *      ⚠️ R21 起：滑杆与开关**并成一行**搬进看板顶栏齿轮的「卡片」组（原生视图选项面板
 *      一条 descriptor 只能占一行，合不成）—— 键与语义一个没变，A2/A3 按新落点重写。
 *   B. vendor 修复 —— 拖动搬文件同目录 ReferenceError / 公式分组手动顺序键同源
 *      / 输入框开着不重绘 / lastDraggedPath 用完即清 / 锚点记板块名 / 还原预览带 sourcePath
 *      / detach 前先保存 / reveal 定时器可清 / 配置搬运补 K_PROS_OPEN / 围栏分开数
 *   C. src 修复 —— 路由正则转义 / 模板占位符原型链 / 回滚阶段 B 收容开关 / 报告撞名循环
 *      / 事件总线总期限 / mover 语义写明 / 收编停用 await / tags 兜底 / routes·excluded 归一 */
const path = require("path");
const fs = require("fs");

const PLUG = path.join(__dirname, "..");
let pass = 0, fail = 0; const fails = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; fails.push(name); console.log("  FAIL " + name); }
}
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); }

const cbRaw = fs.readFileSync(path.join(PLUG, "vendor", "creation-board.js"), "utf8");
const bpRaw = fs.readFileSync(path.join(PLUG, "vendor", "bases-preview.js"), "utf8");
const cb = stripComments(cbRaw);
const router = stripComments(fs.readFileSync(path.join(PLUG, "src", "40_services_router.js"), "utf8"));
const tpl = stripComments(fs.readFileSync(path.join(PLUG, "src", "36_services_templates.js"), "utf8"));
const rebuild = stripComments(fs.readFileSync(path.join(PLUG, "src", "65_services_rebuild.js"), "utf8"));
const automation = stripComments(fs.readFileSync(path.join(PLUG, "src", "80_modules_automation.js"), "utf8"));
const baseMod = stripComments(fs.readFileSync(path.join(PLUG, "src", "85_modules_base.js"), "utf8"));
const moverRaw = fs.readFileSync(path.join(PLUG, "src", "60_services_mover.js"), "utf8");
const mover = stripComments(moverRaw);
const eventbus = stripComments(fs.readFileSync(path.join(PLUG, "src", "20_core_eventbus.js"), "utf8"));
const cbCss = fs.readFileSync(path.join(PLUG, "styles_src", "cb.css"), "utf8");

/* ================= A. 卡片宽度可调 ================= */
{
  ok(cb.indexOf('const K_FILL = "空位铺满整行"') >= 0, "A1：新视图选项键 K_FILL「空位铺满整行」");
  /* R21：滑杆与开关并成一行搬进顶栏「卡片」组 —— 范围 / 语义不变，只是换了台面 */
  ok(cb.indexOf('rg.setAttr("min", "160")') >= 0 && cb.indexOf('rg.setAttr("max", "480")') >= 0
    && cb.indexOf('rg.setAttr("step", "10")') >= 0,
    "A2：宽度拉杆范围 160–480 step 10（原 360 放宽；R21 起在顶栏「卡片」组一行里）");
  ok(cb.indexOf('cls: "cb-wauto-lb", text: "自动"') >= 0
    && /ib\.checked = this\.optBool\(K_FILL, true\)/.test(cb)
    && cb.indexOf("this.cfgSet(K_FILL, v)") >= 0,
    "A3：「空位铺满整行」缩成「自动」+ 胶囊开关，与拉杆同一行（默认开 = R14 行为）");
  ok((cb.match(/--cb-card-max/g) || []).length >= 2
    && (cb.match(/\? "1fr" : minW \+ "px"/g) || []).length >= 2,
    "A4：渲染与编辑器保护两条路都写 --cb-card-max（1fr / 滑杆宽度）");
  ok(/minmax\(var\(--cb-card-w\),\s*var\(--cb-card-max,\s*1fr\)\)/.test(cbCss)
    && /--cb-card-max:\s*1fr;/.test(cbCss), "A5：cb.css 栅格吃 --cb-card-max 且有默认值");
  ok(cb.indexOf("String(this.optBool(K_FILL, true))") >= 0, "A6：computeSig 认 K_FILL（拨开关即重绘）");
  ok(cb.indexOf("view[K_FILL] = this.optBool(K_FILL, true)") >= 0
    && /kinds\[K_FILL\]\s*=\s*"bool"/.test(cb), "A7：配置搬运导出/导入都认 K_FILL");
  ok(cb.indexOf("deferRepaintUntilBlur") >= 0
    && cb.indexOf("this.deferRepaintUntilBlur(ae)") >= 0
    && /INPUT\|SELECT\|TEXTAREA/.test(cb), "A8：输入框开着 → 暂缓重绘、blur 后补（自写属性不再毁输入框）");
  ok(cb.indexOf("const minW = num(this.optNum(K_WIDTH, 240), 240);") >= 0
    && (cb.match(/rootEl.style\.setProperty\("--cb-card-w"/g) || []).length >= 2,
    "A9：编辑器开着时宽度变更仍即时生效（CSS 变量直写，不动编辑器 DOM）");
}

/* ================= B. vendor 修复 ================= */
{
  ok(cb.indexOf("async moveFileToFolder(file, tgtFolder, srcCard, targetCard)") >= 0
    && cb.indexOf("if (srcCard && targetCard && srcCard.parentElement === targetCard.parentElement)") >= 0,
    "B1：拖动搬文件同目录退化分支不再引用不存在的 srcCard/targetCard（原 ReferenceError 被吞）");
  ok(cb.indexOf("moveFileToFolder(file, tgtFolder, srcCard, targetCard)") >= 2,
    "B1b：两个调用方都把卡片透传进 moveFileToFolder");
  ok(cb.indexOf("applyManualOrder(entries, this.manualOrder ? this.manualOrder[this.manualKeyOfSpec(sec)] : null)") >= 0
    && cb.indexOf('this.manualOrder["s" + i + "_" + k]') === -1,
    "B2：公式分组手动顺序键与写侧同源（废弃 s<i>_<k> 位置键；渲染 id 保留不算）");
  ok(cb.indexOf("this.lastDraggedPath = null") >= 0, "B3：dragend 清 lastDraggedPath（原来只设不清，锚点永久失效）");
  ok((cb.match(/anchor\.sec/g) || []).length >= 2 && cb.indexOf("nEl.textContent === anchor.sec") >= 0,
    "B4：滚动锚点连板块名一起记/匹配（允许重复时不再钉错副本）");
  ok(cb.indexOf("renderBodyInto(el, text, srcPath)") >= 0 && cb.indexOf("this.renderBodyInto(host, t2, srcPath)") >= 0,
    "B5：还原预览显式传 sourcePath（异步链里 editorFor 已空，相对链接不再按库根解析）");
  ok(/mv\.save\(\)/.test(cb) && cb.indexOf("ed.leaf.detach()") >= 0
    && cb.indexOf("mv.save()") < cb.indexOf("ed.leaf.detach()"),
    "B6：detach 前先冲一次编辑器保存（防抖窗口内关视图不丢字）");
  ok((cb.match(/this\.revealTimer/g) || []).length >= 4 && cb.indexOf("this.__cbUnloaded = true") >= 0,
    "B7：reveal 轮询定时器挂实例、onunload 清 + 止跑标记（关视图不再弹假 Notice）");
  ok(cb.indexOf("view[K_PROS_OPEN] = this.optBool(K_PROS_OPEN, true)") >= 0
    && /kinds\[K_PROS_OPEN\]\s*=\s*"bool"/.test(cb), "B8：配置搬运补回「属性默认展开」");
  ok((bpRaw.match(/tilde % 2 === 1/g) || []).length === 1 && (cbRaw.match(/tilde % 2 === 1/g) || []).length === 1
    && bpRaw.indexOf("~~~\\n\";\n  return md;") >= 0,
    "B9：balanceFences 把 ``` 与 ~~~ 分开数（两份同源实现都修）");
}

/* ================= C. src 修复 ================= */
{
  ok((router.match(/escRe\(/g) || []).length >= 4,
    "C1：router 的 norm/canonical 用 escRe 转义库根再拼正则（路径含括号不再崩模块）");
  ok(tpl.indexOf("Object.prototype.hasOwnProperty.call(map, key)") >= 0,
    "C2：模板占位符用 hasOwnProperty（{{constructor}} 不再写入函数源码）");
  ok(tpl.indexOf("return out.replace(/\\[\\[[^\\]|]*\\|[^\\]]*\\]\\]/g, function (m) { return m; })") === -1,
    "C3：删掉 extract 里的 no-op replace（死代码）");
  ok((rebuild.match(/opts\.quarantine !== false/g) || []).length >= 2,
    "C4：回滚阶段 B 与阶段 A 同口径尊重 quarantine 开关");
  ok(automation.indexOf("while (app.vault.getAbstractFileByPath") >= 0,
    "C5：补全报告撞名按序号循环找空位（第三次同分钟不再丢报告）");
  ok(eventbus.indexOf("var firstAt = (old && old.firstAt) || now;") >= 0
    && eventbus.indexOf("remain > 0 ? remain : 0") >= 0,
    "C6：事件总线 MAX_WAIT 封「从首次入队算起」的总期限（持续写入不再无限推迟）");
  ok(moverRaw.indexOf("合法别名") >= 0, "C7：mover 注明 overwrite:\"skip\" 语义（撞名即 blocked）");
  ok(/retireLegacy = async function/.test(automation) && /try \{ await r; \} catch/.test(automation),
    "C8：retireLegacy await disablePlugin（压缩双跑窗口）");
  ok(/async function retire\(plugin, id\)/.test(baseMod) && /try \{ await r; \} catch/.test(baseMod),
    "C8b：③ 模块的 retire 同样 await");
  ok(router.indexOf("tags = tags || [];") >= 0, "C9：resolveTarget 的 tags 参数兜底");
  ok(router.indexOf("Array.isArray(routesIn)") >= 0 && router.indexOf("Array.isArray(exclIn)") >= 0,
    "C10：routes/excluded 非数组时归一（手编 data.json 不再崩模块）");
  ok(router.indexOf("rawClean") >= 0 && router.indexOf("this.root + \"/\" + rawClean") >= 0,
    "C11：文件位置认路补原始大小写候选（精确匹配不再必 miss）");
}

console.log("\nR15 结果: " + pass + " 通过 / " + fail + " 失败");
if (fail) { console.log(fails.map(f => "  - " + f).join("\n")); process.exit(1); }
