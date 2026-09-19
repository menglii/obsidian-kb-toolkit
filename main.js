/* kb-toolkit main.js — 由 scripts/build.js 生成，勿手改；源码在 src/ 与 vendor/ */

/* ===== 00_prelude.js ===== */
/* kb-toolkit 前奏：命名空间 + 注册器。
 * 构建方式 = 按文件名序拼接（scripts/build.js），无外部依赖。
 * 每个源文件用 KB.define(id, factory) 注册，entry 在最后实例化。 */
var obsidian = require("obsidian");
var KB = { reg: [], services: {}, modules: {} };
KB.define = function (id, factory) { KB.reg.push({ id: id, factory: factory }); };
KB.service = function (id, obj) { KB.services[id] = obj; };
KB.get = function (id) {
  for (var i = 0; i < KB.reg.length; i++) if (KB.reg[i].id === id) return KB.reg[i].factory;
  throw new Error("kb-toolkit: 未注册的模块 " + id);
};
/* 供离线断言直接访问内部服务（真机无副作用） */
if (typeof globalThis !== "undefined") globalThis.KB = KB;
/* ===== KB-EMBED:CreationBoardPlugin BEGIN（字节级原样内嵌，勿改） ===== */
(function () {
var module = { exports: {} };
/*
 * creation-board — 创作看板（Bases 视图）
 * ==================================================================
 * 第 4 轮（能长 + 收口）：**能长**的部分 ——
 *   · 板块级「＋」新建：按板块类型算落点（文件夹源→板块目录；标签源→查 `标签-目录映射.json`；
 *     其余→base 的 `newItemFolder` / 插件默认）→ `vault.create(path, "")` 建**空**文件
 *     → Templater 的目录模板在 create 事件里接管 → 立刻插一张临时卡片 → 轮询到真卡片后滚过去
 *   · 折叠状态写回 `.base` 的 `折叠` 键（切视图 / 重启后还在）
 *   · 板块级 `排序`（名称 / 改动时间 / 创建时间 × 升降）
 *   · 性能护栏：`排除目录`（按**目录段**匹配）/ `总条数上限`，两个数都写进工具条，不做静默截断
 *   · 「复制配置 / 从剪贴板填入 / 应用这段配置」（纯文本框 → 不依赖剪贴板权限，可离线验）
 *   · **外部改动冲突提示**：排队期间文件 mtime 变了 → 只覆盖自己改的那几个键 + 明确告知
 *   · 插件设置页（收容所全局默认 / 「＋」落点与文件名 / 两个护栏的全局值）
 *
 * 第 3 轮（卡片能读能改）：卡片从「只有标题」变成「**能读属性 + 能读正文 + 能就地改**」。
 *
 * ── 第 1 轮已有 ──────────────────────────────────────────────────
 *   · 注册 Bases 视图类型 `creation-board`（「视图布局」下拉里的「🗂 创作看板」）
 *   · 从 `.base` 视图块读 `板块` 配置；文件夹源（子文件夹→子板块，默认收起）/ 标签源；
 *     「无配置」时三级降级（原生 groupBy → 全部）
 *   · 板块标题行 + 卡片只出标题；顶部工具条
 *
 * ── 第 2 轮已有 ──────────────────────────────────────────────────
 *   · 「⚙ 板块」内嵌管理面板（不用 Modal → 100% 可在 jsdom 里验）
 *       每行：[⣿拖动柄] 名称  [数据源] 明细  N 条  [▲][▼][✎][✕]
 *       拖动排序（HTML5 DnD）+ ▲▼ 走**同一条** reorder 代码路径；顺序 = 优先级
 *       双击名称 = 打开编辑行；✎ 展开编辑行（名称/数据源/明细/上限/递归深度）
 *       ✕ 需要**点两次**确认（第一次变「确认?」，3 秒后自动撤回）
 *   · 「＋ 添加板块」→ 选类型（文件夹 / 标签 / 公式 / 收容所）→ 建默认配置
 *   · 两个开关：`允许重复`（默认 true）、`显示收容所`（默认 false）
 *   · 分组引擎补齐：**公式源**（保留你现在的自动分组）、**收容所**（未被任何板块命中的）
 *   · 写回：`config.set("板块", next)` → 官方内部就是 `data[k]=v` + `query.save()`
 *
 * ── 第 3 轮新增 ──────────────────────────────────────────────────
 *   · 属性排版：**名在上（muted 小字）/ 值在下**；空值 `—`；默认取该笔记前言
 *     **前 5 个用户属性**；视图级 `显示属性` 可配，**板块级 `属性` 可覆盖**
 *   · 正文区（`显正文` 开关，视图级默认 + 板块级覆盖）：
 *       懒加载（`IntersectionObserver`，`root` 指自己的滚动容器 `.cb-root`）
 *       剥前言 / 去与标题重复的 H1 / 按字数截断 / **代码围栏配平** / max-height + 可滚动
 *   · 就地编辑：
 *       点属性值 → 按类型给控件（文本 / 数字 / 日期 / 复选 / 列表胶囊）→ `processFrontMatter`
 *       点标题 → 就地改名（`renameFile`，双链自动更新）
 *       点正文 → 就地挂**真编辑器**（`WorkspaceLeaf` + `MarkdownView`）
 *       双击任意处 / 空白 → 打开笔记；Ctrl/Cmd + 单击 → 新标签打开
 *   · 写盘防抖：静默 **1.5 秒**（或失焦）才落盘；`processFrontMatter` 走 vault 队列（原子）
 *   · 逃生阀 `只读: true`（工具条 🔒 一键切换）关掉全部就地编辑
 *   · 卡片左上「**未落盘**」小圆点（有排队中的写入时亮起）
 *
 * ── 读写契约（已在 obsidian.asar 1.13.7 逐句核实，不是猜的）────────
 *   【配置读写】
 *   @3056537  function dQ(e,t,n){ ... default: a.data||(a.data={}), a.data[c]=i[c] }
 *     → 视图块里**所有非已知键**原样存进 `config.data[key]`（值不做任何转换）
 *       已知键只有：type name filters groupBy summaries order sort limit
 *   @3048504  e.prototype.serialize=function(){ ... if(this.data)for(...){
 *                 var s=a[o]; this.hasOwnProperty(s)||(e[s]=this.data[s]) } return e }
 *     → 自定义键**原样写回** .base（这就是「配置存 .base」的官方依据）
 *   @3048863  e.prototype.set=function(e,t){ this.data||(this.data={}),
 *               null===t?delete this.data[e]:this.data[e]=t, this.query.save() }
 *     → **config.set(k,v) 自带保存**；传 null 就是删键
 *
 *   【视图选项描述项 —— 拍平结构】
 *   @3087355  T5.getViewOptions=function(){return[{displayName:...,type:"slider",key:"cardSize",
 *               min:50,max:800,step:10,default:200},{displayName:...,type:"property",key:"image",
 *               filter:function(e){...},placeholder:...},{displayName:...,type:"dropdown",
 *               key:"imageFit",options:{"":...,contain:...}}]}
 *   @3092900  H5.getViewOptions=function(e){return[{displayName:...,key:B5,type:"dropdown",...},
 *               {displayName:...,key:R5,type:"text",default:", ",
 *                shouldHide:function(){return!!e.get(N5)}}]}
 *     → ① 描述项是**扁平**的：{displayName,type,key,default,min,max,step,options,placeholder,filter,shouldHide}
 *       ② `getViewOptions(config)` **会收到 config**；`shouldHide` 用闭包吃它（核心 list 视图就这么写）
 *   @2738884  switch(t.type){case"toggle":...case"dropdown":...case"text":...case"textarea":...
 *               case"number":...case"file":...case"folder":...case"slider":...case"color":...case"secret":...}
 *     → **可用的控件类型只有这 10 种 + "property"（单选属性选择器）**
 *       ⚠️ **没有多选控件** → 「显示属性」只能用 `text`（逗号分隔）
 *   @2738343  o=n.getControlBinding(t.key), a=(o.value!==undefined?o.value:t.defaultValue)
 *     → 描述项里的默认值字段名是 `default`（而插件设置面板那条路是 `control.defaultValue`，别混）
 *
 *   【条目与属性】
 *   @3040188  this.frontmatter = metadataCache.getFileCache(file)?.frontmatter ?? {}
 *   @3040551  _X.prototype.getValue=function(e){ var t=qX(e),n=t.type,i=t.name;
 *               switch(n){ case "note":... case "file":... case "formula":... } return null }
 *     → `entry.getValue("note.<k>"|"file.<k>"|"formula.<名>")` 合法；取不到 → null
 *   @3041354  _X.FILE_PROPERTIES = 14 个 file.* —— **没有「正文」**
 *   @3041605  KX.getFormulaValue: Object.hasOwn(i,e) ? i[e].getValue(ctx) : null
 *   @3052551  cQ.getSerializable: Object.keys(this.formulas) → 公式名列表（枚举公式用这个）
 *
 *   【写入 / 改名 / 原子写】
 *   @2353061  fileManager.processFrontMatter(file, fn)   ← 官方属性写回（内部走 vault 队列）
 *   @2224826  fileManager.renameFile(file, absNewPath)   ← 官方改名（自动更新双链）
 *   @1289286  vault.process(file, text=>newText, opts)   ← 原子 read-modify-write
 *   @2467771  MetadataTypeManager.getPropertyInfo(name).widget
 *   @2490037  metadataCache.getAllPropertyInfos() → { lowercasename: {name, occurrences, widget} }
 *     → widget ∈ text|number|checkbox|date|datetime|tags|aliases|multitext|file|folder
 *
 *   【正文渲染 / 就地编辑器】
 *   @2736963  MarkdownRenderer.render(app, markdown, el, sourcePath, component)
 *     → 第 5 个参数**必须是 Component**，否则核心会从 `plugin:<name>` 栈帧报内存泄漏告警
 *   @2732156  getFrontMatterInfo(markdown) → {frontmatter, contentStart}   （公开导出）
 *   @3764425  MarkdownView 构造函数收 leaf：new MarkdownView(leaf); view.loadFile(file)
 *     → 小窗里能放真编辑器：new WorkspaceLeaf(app) + new MarkdownView(leaf)
 *        + leaf.open(view) + view.loadFile(file) → appendChild(view.containerEl)
 *   ⚠️ 公式**求值**是 Obsidian 的活，不是本插件的活 —— 本插件只用 `formula.<名>` 去取值再分组。
 *   ⚠️ 正文就地编辑在**真机上的手感必须实测**：源码这条路可行，但焦点/快捷键/滚动只能在真 Obsidian 里看。
 * ==================================================================
 */
"use strict";

const obsidian = require("obsidian");
const { Plugin, Notice, TFolder, MarkdownRenderer } = obsidian;

/* BasesView 在 1.9+ 才导出；拿不到时退化成一个空实现，保证插件不至于加载即崩 */
const BasesViewBase =
  obsidian.BasesView ||
  class {
    constructor(controller) {
      this.app = controller && controller.app;
      this.queryController = controller;
    }
  };

const VIEW_TYPE = "creation-board";
const VIEW_NAME = "🗂 创作看板";
const CONFIG_KEY = "板块";

/* 视图级配置键（全部走 .base 视图块，见文件头契约） */
const K_DUP = "允许重复";
const K_CATCH = "显示收容所";
const K_WIDTH = "卡片最小宽度";
const K_FILL = "空位铺满整行";   // R15：默认开（R14 行为，1fr 撑满）；关 = 卡片固定为滑杆宽度
const K_PROPS = "显示属性";     // 字符串（逗号分隔）；空 → 每篇前言前 5 个用户属性
const K_PROS_OPEN = "属性默认展开";  // R9 键（卡片 / 就地编辑浮层里的属性区是否默认展开，默认 true）；R23 起控件在顶栏面板「看板行为」组；R24 起**板块可各自覆盖**（右键板块 → 通用设置）
const K_BODY = "显正文";        // boolean；板块未单独指定时的默认
const K_CHARS = "正文字数";     // number；正文截断字数
const K_RO = "只读";            // boolean；关掉全部就地编辑
const K_YAML = "显示 YAML";     // R12（boss 第 3 条）：卡片正文是否保留 YAML 前言（默认关）
const K_LINKS = "显示结尾双链"; // R12：卡片正文是否显示结尾「关联笔记」双链段（默认开）
const K_MOVE = "拖动搬文件";    // R12：跨目录拖卡片是否默认搬文件（默认开；关 = 恢复「Alt 搬文件」旧行为）
const K_SORT = "排序";          // 板块级：卡片排序方式（空 = 沿用 base 给过来的顺序）
const K_FOLD = "折叠";          // 对象：{"板块名":true,"板块名/子板块名":true}；只存「收起」的，省体积
const K_EXCLUDE = "排除目录";    // 字符串（逗号分隔）——按**目录段**匹配，所以写 99_Meta 就够
const K_CAP = "总条数上限";      // number；0 = 不限
/* R24（boss 第 3 条·文件操作）：把某篇笔记「收起来」的三件套 —— 都是**视图级**的。
 * 为什么不做成板块级：一篇笔记属于哪个板块会随数据源变，隐藏状态得跟着**笔记**走，
 * 挂在某个板块上会「一改数据源就漏出来」。所以这三项在右键菜单里被归到
 * 「文件操作 · 整个看板」那一组，不冒充板块级。 */
const K_HIDDEN_ON = "文件隐藏显示";     // boolean；能不能在卡片上收起某篇（默认开）
const K_HIDDEN_SHOW = "查看隐藏的文件"; // boolean；把收起来的显示出来（淡出、仍可恢复；默认关）
const K_HIDDEN = "隐藏的文件";          // 数组：被收起来的笔记路径

/* 第 6 轮：正文截断**默认关掉**（0 = 不截断）。
   正文区本来就是「限高 + 自己滚」，截断只会让人看不到全文、还多一行「已截断」提示。
   老板明确要求「笔记视窗不要截断」→ 默认 0；想要截断的自己把这项填个数字。 */
const DEFAULT_CHARS = 0;

const NO_VALUE = "（空值）";
const EMPTY_MARK = "—";
const DEBOUNCE_MS = 1500;       // 静默多久才落盘（双同步库：坚果云 + OneDrive）
const CLICK_DELAY_MS = 250;     // 单击标题 = 改名 → 双击判定要等这么久
const REVEAL_DELAY_MS = 300;    // 「＋」建完后，多久轮询一次真卡片
const REVEAL_TRIES = 10;        // 最多轮询几次（≈3 秒）

/* 板块级 `排序` 的取值；认不出的值一律当「默认」（不报错、不改用户数据） */
const SORT_LABEL = {
  "": "默认（沿用 base 的顺序）",
  "name": "名称 A→Z",
  "name-desc": "名称 Z→A",
  "mtime-desc": "改动时间 新→旧",
  "mtime-asc": "改动时间 旧→新",
  "ctime-desc": "创建时间 新→旧",
  "ctime-asc": "创建时间 旧→新",
};
const SORT_KEYS = Object.keys(SORT_LABEL);

/* 标签路由表（「＋」给标签板块算落点用；与 note-locator / Auto Note Mover 同源） */
const MAPPING_PATH = "01_新知识库/99_Meta/02_模板库/标签-目录映射.json";
const MAP_TAG = "标签";        // 路由表的「标签」段（精确匹配 + 逐级前缀回退）
const MAP_DOMAIN = "领域";      // 路由表的「领域」段
/* ⚠️ 路由表里还有「领域兜底」（现指 01_新知识库/02_Areas）—— 那是**归位脚本**的最后一档，
 *    新建落点**不**用它：老板的计划写的是「标签源查不到 → 落 00_Inbox」。
 *    （真要用，把下面这个开关打开，一行的事。） */
const USE_DOMAIN_FALLBACK = false;

/* 插件级设置（存 data.json）——视图选项 / 板块配置显式写过时，以那边为准 */
const DEFAULT_SETTINGS = {
  catchAllDefault: false,                      // 收容所默认显示
  newNoteFolder: "01_新知识库/00_Inbox",        // 「＋」的兜底落点（相对库根）
  newNoteName: "未命名",                        // 「＋」的默认文件名（撞名自动加序号）
  excludeFolders: "99_Meta",                   // 性能护栏：按目录段排除
  totalCap: 0,                                 // 性能护栏：0 = 不限
};
let PLUGIN_SETTINGS = Object.assign({}, DEFAULT_SETTINGS);

/* ============================================================
 * 小工具
 * ============================================================ */
function num(v, dflt) {
  return typeof v === "number" && isFinite(v) ? v : dflt;
}

function str(v) {
  return v === null || v === undefined ? "" : String(v);
}

/** "#选题/视频" → "选题/视频"；两边空白也去掉 */
function normTag(t) {
  return String(t === null || t === undefined ? "" : t)
    .trim()
    .replace(/^#+/, "");
}

function cleanFolder(f) {
  const s = str(f).trim().replace(/\/+$/, "");
  return s === "/" ? "" : s;
}

function inFolder(filePath, folder) {
  const f = cleanFolder(folder);
  if (!f) return true;
  const p = str(filePath);
  return p === f || p.startsWith(f + "/");
}

function relPath(filePath, folder) {
  const f = cleanFolder(folder);
  const p = str(filePath);
  if (!f) return p;
  if (p === f) return "";
  return p.startsWith(f + "/") ? p.slice(f.length + 1) : null;
}

/** 中文按拼音序（和 Obsidian Bases 的 locale 排序一致） */
function zhSort(a, b) {
  return String(a).localeCompare(String(b), "zh-CN");
}

/** 取笔记标签（归一化、无 #）—— 先走 getAllTags，拿不到再退回前言 */
function tagsOf(app, entry) {
  try {
    const cache = app && app.metadataCache ? app.metadataCache.getFileCache(entry.file) : null;
    if (cache && typeof obsidian.getAllTags === "function") {
      const t = obsidian.getAllTags(cache);
      if (Array.isArray(t)) return t.map(normTag).filter(Boolean);
    }
  } catch (e) {
    /* 继续走前言 */
  }
  const fm = entry && entry.frontmatter ? entry.frontmatter : {};
  let raw = fm.tags;
  if (raw === undefined) raw = fm["标签"];
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") raw = raw.split(/[,\s]+/), arr = raw;
  return arr.map(normTag).filter(Boolean);
}

/** 公式值 → 字符串；取不到 / 空值 → null（公式求值归 Obsidian，这里只做接线） */
function formulaValueOf(entry, name) {
  if (!entry || typeof entry.getValue !== "function") return null;
  let v;
  try {
    v = entry.getValue("formula." + name);
  } catch (e) {
    return null;
  }
  if (v === null || v === undefined) return null;
  let s;
  try {
    s = String(v);
  } catch (e) {
    return null;
  }
  if (!s || s === "null" || s === "undefined") return null;
  return s;
}

/* ============================================================
 * 属性（第 3 轮）
 * ============================================================ */
/** 不是「用户属性」的键（Obsidian 内部用的，别当内容显示） */
const NON_USER_KEYS = ["position", "embed"];

function isUserKey(k) {
  return NON_USER_KEYS.indexOf(String(k)) < 0;
}

/** 读某条目的前言对象 */
function fmOf(app, entry) {
  try {
    const f = entry && entry.frontmatter;
    if (f && typeof f === "object") return f;
  } catch (e) {}
  try {
    const c = app && app.metadataCache ? app.metadataCache.getFileCache(entry.file) : null;
    return (c && c.frontmatter) || {};
  } catch (e) {
    return {};
  }
}

/** 该条目前言的用户属性名（**保持文件里的书写顺序**；别排序，用户是故意的） */
function propNamesOf(app, entry) {
  let keys = [];
  try {
    if (entry && typeof entry.getPropertyKeys === "function") keys = entry.getPropertyKeys() || [];
    else keys = Object.keys(fmOf(app, entry));
  } catch (e) {
    keys = [];
  }
  if (!Array.isArray(keys) || keys.length === 0) keys = Object.keys(fmOf(app, entry));
  return keys.map(str).filter((k) => k && isUserKey(k));
}

function isBlank(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0 || v.every(isBlank);
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/** 值 → 显示文本 */
function fmtProp(v) {
  if (isBlank(v)) return { text: EMPTY_MARK, empty: true };
  if (Array.isArray(v)) return { text: v.map(fmtScalar).join(" · "), empty: false };
  return { text: fmtScalar(v), empty: false };
}

function fmtScalar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }
  return String(v);
}

/** "简介, 平台，状态" → ["简介","平台","状态"]（中英文逗号 / 换行 / 顿号都认） */
function parseNameList(v) {
  return String(v === null || v === undefined ? "" : v)
    .split(/[,，\n、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 问 metadataCache 这个属性该用什么控件（拿不到 → 空串，靠值类型兜底推断） */
function propWidgetOf(app, key) {
  try {
    const mc = app && app.metadataCache;
    if (mc && typeof mc.getAllPropertyInfos === "function") {
      const all = mc.getAllPropertyInfos() || {};
      const lower = String(key).toLowerCase();
      const info = all[lower] || all[key];
      if (info && info.widget) return String(info.widget);
    }
  } catch (e) {}
  return "";
}

/* widget / 值类型 → 控件形态 */
function controlFor(widget, val) {
  const w = String(widget || "");
  if (w === "checkbox") return { tag: "input", type: "checkbox", kind: "bool" };
  if (w === "number") return { tag: "input", type: "number", kind: "num" };
  if (w === "date") return { tag: "input", type: "date", kind: "date" };
  if (w === "datetime") return { tag: "input", type: "datetime-local", kind: "date" };
  if (w === "tags" || w === "aliases" || w === "multitext" || w === "list")
    return { tag: "input", type: "text", kind: "list" };
  /* 推断 */
  if (typeof val === "boolean") return { tag: "input", type: "checkbox", kind: "bool" };
  if (typeof val === "number") return { tag: "input", type: "number", kind: "num" };
  if (Array.isArray(val)) return { tag: "input", type: "text", kind: "list" };
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val))
    return { tag: "input", type: "date", kind: "date" };
  return { tag: "input", type: "text", kind: "text" };
}

function controlValue(kind, input, oldVal) {
  if (kind === "bool") return !!input.checked;
  if (kind === "num") {
    const n = parseFloat(input.value);
    return isFinite(n) ? n : null;
  }
  if (kind === "date") {
    const s = str(input.value).trim();
    return s || null;
  }
  if (kind === "list") {
    const arr = String(input.value || "")
      .split(/[,，\n、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!arr.length) return null;
    /* 原来就是字符串（有些库把 tags 写成 "a, b"）→ 保持字符串，少改格式 */
    if (typeof oldVal === "string") return arr.join(", ");
    return arr;
  }
  const s = str(input.value).trim();
  return s || null;
}

/* ============================================================
 * 第 4 轮：排序 / 护栏 / 文件名 —— 纯函数，好离线验
 * ============================================================ */
/** 按 `排序` 值排。认不出的值 → 原样返回（绝不猜、绝不改用户顺序） */
function sortEntries(list, mode) {
  const m = str(mode).trim();
  if (!m || !Array.isArray(list) || list.length < 2) return list;
  if (SORT_KEYS.indexOf(m) < 0) return list;
  const arr = list.slice();
  const t = (e, k) => {
    try {
      return e && e.file && e.file.stat ? num(e.file.stat[k], 0) : 0;
    } catch (x) {
      return 0;
    }
  };
  const nm = (e) => str(e && e.file ? e.file.basename : "");
  /* Array#sort 在 V8 里是稳定排序 → 同键的条目保持 base 给的顺序 */
  if (m === "name") arr.sort((a, b) => zhSort(nm(a), nm(b)));
  else if (m === "name-desc") arr.sort((a, b) => zhSort(nm(b), nm(a)));
  else if (m === "mtime-desc") arr.sort((a, b) => t(b, "mtime") - t(a, "mtime"));
  else if (m === "mtime-asc") arr.sort((a, b) => t(a, "mtime") - t(b, "mtime"));
  else if (m === "ctime-desc") arr.sort((a, b) => t(b, "ctime") - t(a, "ctime"));
  else if (m === "ctime-asc") arr.sort((a, b) => t(a, "ctime") - t(b, "ctime"));
  return arr;
}

/** 第 10 轮：手动顺序（拖动排序的结果）**优先于**「排序」——拖是明确的用户意图。
 *  列表里没点名的路径 → 排在点过名的后面，**保持原相对顺序**（V8 稳定排序） */
function applyManualOrder(list, order) {
  if (!Array.isArray(list) || !Array.isArray(order) || order.length === 0) return list;
  const idx = new Map();
  for (let i = 0; i < order.length; i++) {
    const p = str(order[i]);
    if (p && !idx.has(p)) idx.set(p, i);
  }
  if (idx.size === 0) return list;
  const BIG = Number.MAX_SAFE_INTEGER;
  const arr = list.slice();
  arr.sort((a, b) => {
    const pa = str(a && a.file ? a.file.path : "");
    const pb = str(b && b.file ? b.file.path : "");
    return (idx.has(pa) ? idx.get(pa) : BIG) - (idx.has(pb) ? idx.get(pb) : BIG);
  });
  return arr;
}

/** 是否落在某个「排除目录」里 —— **按目录段**匹配：
 *  写 `99_Meta` 就能命中 `01_新知识库/99_Meta/…`（不用写全路径） */
function isExcludedPath(filePath, folder) {
  const f = cleanFolder(folder);
  if (!f) return false;
  const p = str(filePath);
  if (!p) return false;
  if (p === f || p.indexOf(f + "/") === 0) return true;       // 从库根算的完整路径
  return ("/" + p + "/").indexOf("/" + f + "/") >= 0;         // 任意层级的同名目录
}

/** 文件名净化：Obsidian 与 Windows 都不认的字符一律换成空格 */
function sanitizeName(v) {
  return str(v)
    .replace(/[\\/:*?"<>|#^\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80);
}

/** 逗号 / 换行 / 分号 / 顿号 → 目录数组（默认值可能来自插件设置里的一个字符串） */
function folderListOf(v) {
  const s = typeof v === "string" ? v.replace(/[;；]/g, ",") : v;
  return parseNameList(s).map(cleanFolder).filter(Boolean);
}

/* ============================================================
 * 正文（第 3 轮）—— 逻辑与 bases-preview 的 note-stream 同源
 * ============================================================ */
/** 截断可能切在代码块中间 —— 围栏数奇数就补一个收尾围栏，避免整段被吞。
 *  R15 修：``` 与 ~~~ 分开数 —— 原来混着数，奇数落在这边时补的是另一种，收不住 */
function balanceFences(md) {
  const backtick = (md.match(/^[ \t]*```/gm) || []).length;
  const tilde = (md.match(/^[ \t]*~~~/gm) || []).length;
  if (backtick % 2 === 1) return md + "\n\n```\n";
  if (tilde % 2 === 1) return md + "\n\n~~~\n";
  return md;
}

/** 原文 → 可预览正文：剥前言（keepYaml 时保留）→ 去掉与标题重复的首个 H1 → 去掉开头空行 */
function stripForPreview(raw, basename, keepYaml) {
  let body = String(raw === null || raw === undefined ? "" : raw);
  if (!keepYaml) {
    try {
      let info = null;
      if (typeof obsidian.getFrontMatterInfo === "function") info = obsidian.getFrontMatterInfo(body);
      if (info && typeof info.contentStart === "number") body = body.slice(info.contentStart);
      else body = body.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    } catch (e) {
      /* 保持原样 */
    }
  }
  const h1 = body.match(/^\s*#\s+(.+?)[ \t]*\r?\n/);
  if (h1 && h1[1].trim() === String(basename).trim()) body = body.slice(h1[0].length);
  return body.replace(/^\s+/, "");
}

/** R12（boss 第 3 条）：掐掉结尾「关联笔记」双链段 —— 从**最后一处**「关联笔记」标题切到文末。
 *  只切最后一段（模板固定把双链放结尾），正文中间提到「关联笔记」的标题不受影响。 */
function cutLinksTail(md) {
  const s = String(md === null || md === undefined ? "" : md);
  const re = /\n#{1,6}[^\n]*关联笔记[^\n]*(\r?\n|$)/g;
  let m, last = null;
  while ((m = re.exec(s))) last = m;
  if (!last) return s;
  return s.slice(0, last.index).replace(/\s*$/, "") + "\n";
}

/* 数据源别名 → 归一化类型（YAML 里中英文都认） */
const SOURCE_ALIAS = {
  folder: "folder", "文件夹": "folder", "目录": "folder",
  tag: "tag", "标签": "tag",
  formula: "formula", "公式": "formula",
  catchall: "catchall", "收容所": "catchall", "其它": "catchall", "其他": "catchall",
  all: "all", "全部": "all",
  property: "unsupported", "属性": "unsupported", "属性值": "unsupported",
};
const SOURCE_LABEL = { folder: "文件夹", tag: "标签", formula: "公式", catchall: "收容所", all: "全部", unsupported: "未支持" };
const ADDABLE = ["folder", "tag", "formula", "catchall"];

/* R20 需求3（老板截图3）：看板上那两处齿轮原来是 emoji「⚙」—— 颜色/字形/大小全由
 * 系统字体决定（截图里是淡紫色，跟界面不搭，还随平台变）。改成**自绘的线描齿轮**：
 * stroke = currentColor → 跟着按钮文字色走（浅色主题下就是极简黑），14px 固定尺寸。
 * 用 createElementNS 建 SVG（不是 createEl，原生不支持 svg 命名空间），jsdom 也能跑。 */
function gearIcon(parent) {
  const NS = "http://www.w3.org/2000/svg";
  const doc = (parent && parent.ownerDocument)
    || (typeof document !== "undefined" ? document : null);
  if (!doc || !doc.createElementNS) return null;
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("class", "cb-gear-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  const ring = doc.createElementNS(NS, "circle");
  ring.setAttribute("cx", "12");
  ring.setAttribute("cy", "12");
  ring.setAttribute("r", "4.1");
  svg.appendChild(ring);
  const teeth = doc.createElementNS(NS, "path");
  teeth.setAttribute("d",
    "M12 2.9V5.1M12 18.9v2.2M2.9 12h2.2M18.9 12h2.2" +
    "M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6");
  svg.appendChild(teeth);
  parent.appendChild(svg);
  return svg;
}

/* 板块项的已知键（写回只写这些 + 各类型专属键，其余原样保留 → 不破坏手写的未来字段） */
const KNOWN_KEYS = ["名称", "name", "数据源", "source", "路径", "path", "标签", "tag",
  "公式", "formula", "上限", "limit", "递归深度", "depth",
  "属性", "显正文", "显示 YAML", "显示结尾双链", "属性展开", "拖动搬文件", "排序", "sort",
  "propsOpen"];

/** R12：三态字段（true / false / null=继承视图默认）的容错解析 */
function tri(o, zhKey, enKey) {
  const v = o[zhKey] !== undefined ? o[zhKey] : o[enKey];
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return null;
}

function normalizeSection(raw, i) {
  const o = raw && typeof raw === "object" ? raw : {};
  const rawSrc = str(o["数据源"] !== undefined ? o["数据源"] : o.source !== undefined ? o.source : "folder");
  const key = rawSrc.trim();
  const source = SOURCE_ALIAS[key] || SOURCE_ALIAS[key.toLowerCase()] || "unsupported";
  const propRaw = o["属性"] !== undefined ? o["属性"] : o.props;
  let props = [];
  if (Array.isArray(propRaw)) props = propRaw.map(str).filter(Boolean);
  else if (typeof propRaw === "string") props = parseNameList(propRaw);
  const bodyRaw = o["显正文"] !== undefined ? o["显正文"] : o.body;
  const body = typeof bodyRaw === "boolean" ? bodyRaw : bodyRaw === "true" ? true : bodyRaw === "false" ? false : null;
  const sec = {
    name: str(o["名称"] !== undefined ? o["名称"] : o.name) || "板块 " + (i + 1),
    source,
    rawSource: rawSrc || "folder",
    path: cleanFolder(o["路径"] !== undefined ? o["路径"] : o.path),
    tag: normTag(o["标签"] !== undefined ? o["标签"] : o.tag),
    formula: str(o["公式"] !== undefined ? o["公式"] : o.formula),
    limit: num(o["上限"] !== undefined ? o["上限"] : o.limit, 50),
    depth: Math.max(0, Math.floor(num(o["递归深度"] !== undefined ? o["递归深度"] : o.depth, 1))),
    props,           // [] = 继承视图默认
    body,            // null = 继承视图默认；true/false = 本板块显式指定
    yaml: tri(o, "显示 YAML", "yaml"),      // R12：null=继承视图；true=保留 YAML 前言
    links: tri(o, "显示结尾双链", "links"), // R12：null=继承视图；false=掐掉结尾「关联笔记」段
    propsOpen: tri(o, "属性展开", "propsOpen"), // R24：null=继承视图；true/false = 本板块属性区默认展开/折叠
    sort: str(o[K_SORT] !== undefined ? o[K_SORT] : o.sort),   // "" = 沿用 base 顺序
    extra: {},
  };
  for (const k of Object.keys(o)) if (KNOWN_KEYS.indexOf(k) < 0) sec.extra[k] = o[k];
  return sec;
}

function sectionToRaw(sec) {
  const o = {};
  o["名称"] = sec.name;
  o["数据源"] = sec.source;
  if (sec.source === "folder") {
    o["路径"] = sec.path;
    o["递归深度"] = sec.depth;
  } else if (sec.source === "tag") {
    o["标签"] = sec.tag;
  } else if (sec.source === "formula") {
    o["公式"] = sec.formula;
  }
  if (sec.source !== "catchall") o["上限"] = sec.limit;
  if (sec.props && sec.props.length) o["属性"] = sec.props.slice();
  if (sec.body === true || sec.body === false) o["显正文"] = sec.body;
  if (sec.yaml === true || sec.yaml === false) o["显示 YAML"] = sec.yaml;
  if (sec.links === true || sec.links === false) o["显示结尾双链"] = sec.links;
  if (sec.propsOpen === true || sec.propsOpen === false) o["属性展开"] = sec.propsOpen;
  if (sec.sort) o[K_SORT] = sec.sort;
  const ex = sec.extra || {};
  for (const k of Object.keys(ex)) if (!Object.prototype.hasOwnProperty.call(o, k)) o[k] = ex[k];
  return o;
}

/* ============================================================
 * 视图
 * ============================================================ */
class CreationBoardView extends BasesViewBase {
  constructor(controller, containerEl) {
    super(controller);
    this.type = VIEW_TYPE;

    this.sections = [];   // 本次渲染出来的板块（含公式展开 / 收容所）
    this.secs = [];       // 配置里的板块（规范化的编辑模型）
    this.catchPreview = null;
    this.sig = "";
    this.renderedOnce = false;
    this.mode = "";
    this.fold = Object.create(null);   // "板块名" / "板块名/子板块名" → 是否收起

    this.panelOpen = false;
    this.editIdx = -1;
    this.addOpen = false;
    this.confirmIdx = -1;
    this.confirmTimer = null;
    this.dragFrom = null;
    this.saveState = "";

    /* —— 第 3 轮状态 —— */
    this.cardEls = new Map();       // path → Set<卡片元素>（同一篇可进多个板块）
    this.bodyItems = [];            // 正文懒加载项
    this.bodyQueue = [];
    this.bodyPumping = false;
    this.pending = new Map();       // path → { file, props:{}, timer }
    this.writeCount = 0;            // 真正落盘次数（断言用）
    this.lastWrite = null;          // 最近一次写入的 { path, props }（断言用）
    this.lastRename = null;         // 最近一次改名（断言用）
    this.lastOpen = null;           // 最近一次「打开笔记」（断言用）
    this.lastEditorMount = null;    // 最近一次「挂编辑器」（断言用）
    this.debounceMsValue = DEBOUNCE_MS;
    this.clickDelayValue = CLICK_DELAY_MS;   // 单击标题 → 等这么久才认成「改名」
    this.editorFor = null;          // 正在就地编辑的 path
    this.editorHost = null;         // 编辑器所在容器
    this.clickTimer = null;
    this.clickAction = null;
    this.lastPaths = "";

    /* —— 第 4 轮状态 —— */
    this.excludedCount = 0;         // 被「排除目录」挡掉几条（护栏要可见，不静默）
    this.cappedCount = 0;           // 被「总条数上限」砍掉几条
    this.conflicts = new Set();     // 编辑期间被外部改过的 path
    this.lastConflict = null;       // 最近一次冲突（断言用）
    this.lastCreate = null;         // 最近一次「＋」新建（断言用）
    this.revealPath = null;         // 正在等「真卡片出现」的 path
    this.revealTries = 0;
    this.revealDelayValue = REVEAL_DELAY_MS;   // 可被覆盖 → 测试不用真等 3 秒
    this.revealTriesMax = REVEAL_TRIES;
    this.ioText = "";               // 「复制 / 导入配置」文本框的内容
    this.ioState = "";              // 文本框下面那行提示
    this.mappingCache = null;       // 标签路由表（懒加载一次）

    /* —— 第 5 轮状态（就地编辑收口 + 「点外面就收起」）—— */
    this.outsiders = new Map();     // id → { test(target)=>bool, close(evt) }
    this.editorText = null;         // 打开编辑器之前那份预览正文（收起时还原回去）
    this.editorProps = false;       // 卡片是否已显示属性（决定要不要藏掉编辑器自带的属性块）
    this.closedEditor = null;       // 最近一次「收起编辑器」的 path（断言用）
    this.escHandler = null;
    this.docDownHandler = (evt) => this.handleOutside(evt);
    try {
      document.addEventListener("mousedown", this.docDownHandler, true);
    } catch (e) {}

    /* —— 顶部工具条 —— */
    this.rootEl = containerEl.createDiv({ cls: "cb-root" });
    const bar = this.rootEl.createDiv({ cls: "cb-bar" });
    this.modeEl = bar.createSpan({ cls: "cb-mode", text: "…" });
    this.countEl = bar.createSpan({ cls: "cb-count", text: "" });
    this.roBtn = bar.createEl("button", { cls: "cb-ro", text: "✎ 可编辑" });
    this.roBtn.setAttr("title", "只读模式：关掉全部就地编辑（= 视图配置里的「只读」）");
    this.roBtn.addEventListener("click", () => {
      this.cfgSet(K_RO, !this.optBool(K_RO, false));
      this.repaint(false);
    });
    this.gearBtn = bar.createEl("button", { cls: "cb-gear" });
    gearIcon(this.gearBtn);
    this.gearBtn.createSpan({ cls: "cb-gear-text", text: "板块" });
    this.gearBtn.addEventListener("click", () => {
      /* R22：开着就关（走同一套 closePanel），关着才开 */
      if (this.panelOpen) {
        this.closePanel();
        return;
      }
      this.panelOpen = true;
      this.editIdx = -1;
      this.addOpen = false;
      this.renderPanel();
    });
    const btn = bar.createEl("button", { cls: "cb-refresh", text: "↻ 重载" });
    btn.addEventListener("click", () => this.repaint(true));

    /* —— 板块设置面板（内嵌 DOM，不用 Modal → 可离线验）
     * R22：改成**悬浮小窗**（老板指 v2 效果图）—— 遮罩 + 居中窗 + 头部 ✕ + 正文自己滚。
     * 好处：不再在工具条与看板之间占一行、把看板往下挤；板块多时正文内部滚动，窗高封顶。
     * 仍留在 rootEl 里（不是 Obsidian Modal），所以离线套件照旧能查能点。 */
    this.maskEl = this.rootEl.createDiv({ cls: "cb-mask is-hidden" });
    this.panelEl = this.rootEl.createDiv({ cls: "cb-panel is-hidden" });
    this.panelEl.setAttr("role", "dialog");
    this.panelEl.setAttr("aria-label", "板块设置");
    const ph = this.panelEl.createDiv({ cls: "cb-panel-head" });
    ph.createSpan({ cls: "cb-panel-title", text: "板块设置" });
    this.panelMsgEl = ph.createSpan({ cls: "cb-panel-msg", text: "" });
    const px = ph.createEl("button", { cls: "cb-panel-x", text: "✕" });
    px.setAttr("title", "关闭");
    px.addEventListener("click", () => this.closePanel());
    this.panelBodyEl = this.panelEl.createDiv({ cls: "cb-panel-body" });

    /* 第 5 轮：点面板外面就收起来（⚙ 按钮本身除外，否则会「点了不关」）
     * R22：遮罩盖住整块可视区 → 点遮罩就是「点外面」，这套机制直接复用，不必另绑 */
    this.addOutsideCloser(
      "panel",
      (t) => {
        if (!this.panelOpen) return true;   // 本来就没开 → 与我无关
        if (t.closest && (t.closest(".cb-panel") || t.closest(".cb-gear"))) return true;
        return false;
      },
      () => this.closePanel()
    );

    /* —— 看板列表 —— */
    this.listEl = this.rootEl.createDiv({ cls: "cb-list" });

    /* —— 正文懒加载观察者（root = 自己的滚动容器） —— */
    try {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            const item = en.target.__cbItem;
            try {
              this.observer.unobserve(en.target);
            } catch (e) {}
            if (item) this.enqueueBody(item);
          }
        },
        { root: this.rootEl, rootMargin: "600px 0px 600px 0px" }
      );
    } catch (e) {
      this.observer = null;
    }
  }

  /* ---------- Component 生命周期 ---------- */
  onload() {}
  onunload() {
    this.__cbUnloaded = true;   // R15：给自续定时器（reveal 等）一个统一的止跑标记
    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
    if (this.revealTimer) {     // R15：新建笔记的 reveal 轮询一并清
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    this.cancelClick();
    this.unmountEditor(false);
    this.closeCardMenu();   // 第 10 轮：右键菜单连 DOM 带监听一起收
    if (this.boardScrollTimer) {   // 第 12 轮：滚动回填定时器一并清
      clearInterval(this.boardScrollTimer);
      this.boardScrollTimer = null;
    }
    this.dragCtx = null;
    try {
      document.removeEventListener("mousedown", this.docDownHandler, true);
    } catch (e) {}
    this.unbindEsc();
    this.outsiders.clear();
    this.flushAll();
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (e) {}
    }
    this.bodyQueue.length = 0;
    this.sections.length = 0;
  }
  focus() {
    try {
      this.rootEl.focus({ preventScroll: true });
    } catch (e) {}
  }
  onResize() {}

  /* ============================================================
   * 配置读写（契约见文件头）
   * ============================================================ */
  cfgGet(key, dflt) {
    const c = this.config;
    if (!c || typeof c.get !== "function") return dflt;
    let v;
    try {
      v = c.get(key);
    } catch (e) {
      return dflt;
    }
    return v === undefined || v === null ? dflt : v;
  }

  /** 官方 set 内部 = data[key]=val + query.save()；传 null = 删键 */
  cfgSet(key, val) {
    const c = this.config;
    if (!c || typeof c.set !== "function") {
      this.saveState = "当前上下文不能保存";
      return false;
    }
    try {
      c.set(key, val === undefined ? null : val);
      this.saveState = "已写入 .base";
      return true;
    } catch (e) {
      this.saveState = "保存失败：" + (e && e.message ? e.message : String(e));
      console.error("[creation-board] 写入配置失败：", e);
      return false;
    }
  }

  /** 读 + 规范化成编辑模型 */
  loadSecs() {
    const raw = this.cfgGet(CONFIG_KEY, null);
    this.secs = Array.isArray(raw) ? raw.map((r, i) => normalizeSection(r, i)) : [];
    return this.secs;
  }

  /** 编辑模型 → 写回；收容所固定排最后；全删则删掉该键 */
  persist() {
    const list = this.secs.slice();
    const ci = list.findIndex((s) => s.source === "catchall");
    if (ci >= 0 && ci !== list.length - 1) list.push(list.splice(ci, 1)[0]);
    this.secs = list;
    const raw = list.map(sectionToRaw);
    return this.cfgSet(CONFIG_KEY, raw.length ? raw : null);
  }

  /* ---------- 选项（boolean 容错：原生面板可能写成字符串） ---------- */
  optBool(key, dflt) {
    const v = this.cfgGet(key, dflt);
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
    return dflt;
  }
  optNum(key, dflt) {
    const v = this.cfgGet(key, dflt);
    if (typeof v === "number" && isFinite(v)) return v;
    const n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }
  optStr(key, dflt) {
    const v = this.cfgGet(key, dflt);
    return typeof v === "string" ? v : dflt;
  }

  /* ---------- 第 3 轮的语义读取 ----------
   * ⚠️ 传进来的可能是**渲染板块**（带 .spec）也可能是**配置板块** —— 统一在这里落地，
   *    否则板块级「属性 / 显正文」会被静默忽略（渲染板块上没有这两个字段）。 */
  specOf(sec) {
    return sec && sec.spec ? sec.spec : sec;
  }
  readonly() {
    return this.optBool(K_RO, false);
  }
  /** 视图级「显示属性」（逗号分隔）→ 数组；空 → 空数组（＝每篇取前 5） */
  optPropList() {
    const v = this.cfgGet(K_PROPS, "");
    if (Array.isArray(v)) return v.map(str).filter(Boolean);
    return parseNameList(v);
  }
  viewBodyDefault() {
    return this.optBool(K_BODY, false);
  }
  /** R9：属性区默认展开？由顶栏面板「看板行为」组的「属性默认展开」控制（默认 true；R23 起从原生视图选项挪来）。
   *  想回到第 8/9 轮的「默认折叠」，把这个开关关掉即可（两处都跟随）。 */
  propsOpenDefault() {
    return this.optBool(K_PROS_OPEN, true);
  }
  /** R24（boss 第 0 条「单个板块的设置应只对单独板块生效」）：板块级 `属性展开` 优先，
   *  没写 → 视图默认。传 null/undefined 时直接回落视图默认（就地编辑浮层会这么调）。 */
  propsOpenOn(sec) {
    const c = sec ? this.specOf(sec) : null;
    if (c && (c.propsOpen === true || c.propsOpen === false)) return c.propsOpen;
    return this.propsOpenDefault();
  }
  charsOf(sec) {
    return Math.max(0, Math.floor(this.optNum(K_CHARS, DEFAULT_CHARS)));
  }
  /** 板块级 `显正文` 优先；没写 → 视图默认 */
  bodyOn(sec) {
    const c = this.specOf(sec);
    if (c && (c.body === true || c.body === false)) return c.body;
    return this.viewBodyDefault();
  }
  /* R12（boss 第 3 条）：正文里 YAML 前言 / 结尾「关联笔记」双链的显示开关
     —— 板块三态优先，未指定时跟视图默认（YAML 默认关、双链默认开 = 老版行为） */
  yamlOn(sec) {
    const c = this.specOf(sec);
    if (c && (c.yaml === true || c.yaml === false)) return c.yaml;
    return this.optBool(K_YAML, false);
  }
  linksOn(sec) {
    const c = this.specOf(sec);
    if (c && (c.links === true || c.links === false)) return c.links;
    return this.optBool(K_LINKS, true);
  }
  /** 属性名列表：板块级 `属性` 优先 → 视图级 `显示属性` → null（＝每篇前 5） */
  propListFor(sec) {
    const c = this.specOf(sec);
    if (c && c.props && c.props.length) return c.props.slice();
    const v = this.optPropList();
    return v.length ? v : null;
  }

  /* ---------- 折叠状态（第 4 轮：写回 `.base` 的 `折叠` 键 → 切视图 / 重启后还在） ----------
   * 只存「收起」的键（展开 = 删键），体积可控；键名 = 板块名，子板块 = "板块名/子板块名" */
  foldKey(sec, child) {
    return child ? sec.name + "/" + child.name : sec.name;
  }
  loadFold() {
    const raw = this.cfgGet(K_FOLD, null);
    const o = Object.create(null);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const k of Object.keys(raw)) if (raw[k]) o[k] = true;
    } else if (Array.isArray(raw)) {
      for (const k of raw) if (k) o[str(k)] = true;
    }
    this.fold = o;
    return o;
  }
  saveFold() {
    const keys = Object.keys(this.fold).filter((k) => this.fold[k]).sort();
    if (!keys.length) return this.cfgSet(K_FOLD, null);
    const o = {};
    for (const k of keys) o[k] = true;
    return this.cfgSet(K_FOLD, o);
  }
  isCollapsed(sec, child, dflt) {
    const k = this.foldKey(sec, child);
    /* 第 11 轮：本会话里展开过的子栏优先记住「展开」——
       折叠键只存「收起」，重画时不在键里就回默认（子栏=收起），拖动一次就把子栏收回去了 */
    if (this.foldOpen && this.foldOpen.has(k)) return false;
    return k in this.fold ? !!this.fold[k] : dflt;
  }
  setCollapsed(sec, child, v) {
    const k = this.foldKey(sec, child);
    if (!this.foldOpen) this.foldOpen = new Set();
    if (v) this.foldOpen.delete(k);
    else this.foldOpen.add(k);
    if (!!this.fold[k] === !!v) return;
    if (v) this.fold[k] = true;
    else delete this.fold[k];
    this.saveFold();
  }
  /** 第 11 轮：重画前把 DOM 里当前展开着的子栏记进 foldOpen（拖动/刷新不许把子栏收回去） */
  snapshotOpenSubs() {
    if (!this.foldOpen) this.foldOpen = new Set();
    try {
      const root = this.rootEl;
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll(".cb-sub").forEach((sub) => {
        const body = sub.querySelector ? sub.querySelector(".cb-sub-body") : null;
        if (!body || body.hasClass("is-collapsed")) return;   // 只记**展开**的（收起态在 .cb-sub-body 上）
        const nameEl = sub.querySelector(".cb-sub-name");
        const secEl = sub.closest ? sub.closest(".cb-section") : null;
        const secNameEl = secEl ? secEl.querySelector(".cb-section-name") : null;
        if (nameEl && secNameEl) this.foldOpen.add(secNameEl.textContent + "/" + nameEl.textContent);
      });
    } catch (e) {}
  }

  /* ============================================================
   * 刷新入口
   * ============================================================ */
  computeSig() {
    const d = this.data;
    const parts = [
      VIEW_TYPE,
      String(this.optBool(K_DUP, true)),
      String(this.cfgGet(K_CATCH, "~")),          // 原始值：区分「没写过」和「写了 false」
      String(this.optNum(K_WIDTH, 240)),
      String(this.optBool(K_FILL, true)),   /* R15：拨「空位铺满整行」即时重绘 */
      String(this.cfgGet(K_PROPS, "")),
      String(this.optBool(K_BODY, false)),
      String(this.optNum(K_CHARS, DEFAULT_CHARS)),
      String(this.optBool(K_PROS_OPEN, true)),   /* R23：拨「属性默认展开」要即时重绘卡片属性区（原来在原生面板、靠那边触发） */
      String(this.optBool(K_RO, false)),
      String(this.cfgGet(K_EXCLUDE, "~")),
      String(this.cfgGet(K_CAP, "~")),
      String(this.optBool(K_HIDDEN_ON, true)),      /* R24：拨「文件隐藏显示」即时重绘 */
      String(this.optBool(K_HIDDEN_SHOW, false)),   /* R24：拨「查看隐藏的文件」同理 */
      String(this.cfgGet(K_HIDDEN, "~")),           /* R24：隐藏 / 取消隐藏某篇 */
      String(this.panelOpen),
      String(this.editIdx),
      String(this.addOpen),
      String(this.confirmIdx),
      String(this.ioState),
    ];
    try {
      parts.push(JSON.stringify(this.cfgGet(CONFIG_KEY, null)));
    } catch (e) {
      parts.push("");
    }
    if (d && Array.isArray(d.data)) {
      for (const e of d.data) {
        const st = e && e.file && e.file.stat ? e.file.stat.mtime : "";
        parts.push((e && e.file ? e.file.path : "?") + "@" + st);
      }
    }
    return parts.join("\u0001");
  }

  pathList() {
    const d = this.data;
    if (!d || !Array.isArray(d.data)) return "";
    return d.data.map((e) => (e && e.file ? e.file.path : "?")).join("\u0001");
  }

  onDataUpdated() {
    const sig = this.computeSig();
    const paths = this.pathList();
    /* R15：输入框开着时别整页重绘 —— 自己写属性落盘 → mtime 变 → sig 变 → 重绘会把
     * 正在敲字的输入框连人带字拽掉（元素被移除不触发 blur，commit 永远不执行）。
     * 暂缓到 blur 再补一次 onDataUpdated；sig 不动，落盘的那次变化不会丢。 */
    try {
      const ae = document.activeElement;
      if (ae && this.listEl && this.listEl.contains(ae)
        && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) {
        this.deferRepaintUntilBlur(ae);
        return;
      }
    } catch (e) {}
    /* 就地编辑器开着、且条目集合没变 → 别重建，否则会把编辑器连人带光标一起拽掉。
     * R15：但**宽度/铺满这类纯样式选项**要即时生效 —— 只改 CSS 变量，不动编辑器 DOM */
    if (this.editorFor && this.lastPaths && paths === this.lastPaths) {
      const minW = num(this.optNum(K_WIDTH, 240), 240);
      this.rootEl.style.setProperty("--cb-card-w", minW + "px");
      this.rootEl.style.setProperty("--cb-card-max", this.optBool(K_FILL, true) ? "1fr" : minW + "px");
      this.sig = sig;
      this.renderedOnce = true;
      this.updateBar();
      return;
    }
    if (sig && sig === this.sig && this.renderedOnce) {
      this.updateBar();
      return;
    }
    this.sig = sig;
    this.renderedOnce = true;
    this.repaint(false);
  }

  /** R15：焦点在输入框里 → 重绘延到 blur（一次性；视图关了随元素一起回收，无需清） */
  deferRepaintUntilBlur(el) {
    if (this.__blurRepaintArmed) return;
    this.__blurRepaintArmed = true;
    const view = this;
    el.addEventListener("blur", function h() {
      el.removeEventListener("blur", h);
      view.__blurRepaintArmed = false;
      view.onDataUpdated();
    });
  }

  /** 面板 + 看板一起重画（先算 sections，面板要用条数） */
  repaint(force) {
    this.loadSecs();
    this.loadFold();          // 折叠状态从 .base 读回来
    this.manualOrder = this.loadManualOrder();   // 第 10 轮：手动顺序（拖动排序）从 .base 读回来
    this.sections = this.buildSections();
    this.renderPanel();
    this.renderBoard(force);
  }

  /* ============================================================
   * 第 4 轮：护栏（排除目录 / 总条数上限）+ 收容所全局默认
   * ============================================================ */
  pluginCatchDefault() {
    return !!PLUGIN_SETTINGS.catchAllDefault;
  }
  /** 视图级 `排除目录` 优先；没写过 → 插件设置；两个都没有 → 不排除 */
  excludeList() {
    const v = this.cfgGet(K_EXCLUDE, PLUGIN_SETTINGS.excludeFolders);
    if (Array.isArray(v)) return folderListOf(v.join(","));
    return folderListOf(v);
  }
  totalCap() {
    return Math.max(0, Math.floor(this.optNum(K_CAP, PLUGIN_SETTINGS.totalCap)));
  }
  /** 交给分组引擎的条目池：先按「排除目录」过滤 → 再按「总条数上限」截断
   *  两个数都记下来给工具条显示（**不做静默截断**，看不到就说明它被挡在哪了） */
  visibleEntries() {
    const raw = this.data && Array.isArray(this.data.data) ? this.data.data.slice() : [];
    const ex = this.excludeList();
    let list = raw;
    let dropped = 0;
    if (ex.length) {
      const keep = [];
      for (const e of list) {
        const p = e && e.file ? e.file.path : "";
        if (p && ex.some((f) => isExcludedPath(p, f))) dropped++;
        else keep.push(e);
      }
      list = keep;
    }
    this.excludedCount = dropped;
    const cap = this.totalCap();
    this.cappedCount = 0;
    if (cap > 0 && list.length > cap) {
      this.cappedCount = list.length - cap;
      list = list.slice(0, cap);
    }
    return list;
  }

  /* ============================================================
   * 分组引擎
   * ============================================================ */
  buildSections() {
    const all = this.visibleEntries();
    const allowDup = this.optBool(K_DUP, true);
    const showCatch = this.optBool(K_CATCH, this.pluginCatchDefault());

    /* ① 没有配置 → 降级（第 1 轮行为，保住现有自动分组） */
    if (!this.secs.length) {
      const native = this.nativeGroups();
      if (native) {
        this.mode = "自动分组（沿用 base 的 groupBy）";
        return native;
      }
      this.mode = "未配置板块 · 显示全部";
      this.catchPreview = null;
      return [{ id: "all", srcIndex: -1, name: "全部", source: "all", entries: all, children: [], total: all.length }];
    }

    this.mode = "板块配置 " + this.secs.length + " 个";

    const out = [];
    const used = new Set();
    const matched = new Set();
    let catchSec = null;

    for (let i = 0; i < this.secs.length; i++) {
      const sec = this.secs[i];
      if (sec.source === "catchall") {
        if (!catchSec) catchSec = sec;
        continue;
      }
      for (const s of this.produce(sec, i, all, used, allowDup, matched)) out.push(s);
    }

    /* 收容所：面板里始终可见，看板上由「显示收容所」开关决定 */
    if (catchSec) {
      const rest = all.filter((e) => e && e.file && !matched.has(e.file.path));
      const rendered = {
        id: "catch",
        srcIndex: this.secs.indexOf(catchSec),
        name: catchSec.name || "其它",
        source: "catchall",
        isCatch: true,
        spec: catchSec,
        entries: rest,
        children: [],
        total: rest.length,
      };
      this.catchPreview = rendered;
      if (showCatch) out.push(rendered);
    } else {
      this.catchPreview = null;
    }

    return out;
  }

  /** 降级：base 自带 groupBy → 直接把原生分组当板块 */
  nativeGroups() {
    let groups = [];
    try {
      groups = (this.data && this.data.groupedData) || [];
    } catch (e) {
      groups = [];
    }
    const real = (Array.isArray(groups) ? groups : []).filter((g) => g && typeof g.hasKey === "function" && g.hasKey());
    if (real.length === 0) return null;
    return real.map((g, i) => {
      const entries = Array.isArray(g.entries) ? g.entries : [];
      let name;
      try {
        name = g.key === null || g.key === undefined ? NO_VALUE : String(g.key);
      } catch (e) {
        name = NO_VALUE;
      }
      return {
        id: "g" + i,
        srcIndex: -1,
        name,
        source: "formula",
        native: true,
        entries,
        children: [],
        total: entries.length,
      };
    });
  }

  /** 一个配置板块 → 一到多个渲染板块（公式源会展开成多个） */
  produce(sec, i, all, used, allowDup, matched) {
    if (sec.source === "formula") return this.produceFormula(sec, i, all, used, allowDup, matched);
    return [this.produceOne(sec, i, all, used, allowDup, matched)];
  }

  produceOne(sec, i, all, used, allowDup, matched) {
    const rendered = {
      id: "s" + i,
      srcIndex: i,
      name: sec.name,
      source: sec.source,
      spec: sec,
      entries: [],
      children: [],
      total: 0,
    };

    if (sec.source === "unsupported") {
      rendered.error = sec.rawSource + " 暂未支持（现在只做 文件夹 / 标签 / 公式 / 收容所）";
      rendered.unsupported = true;
      return rendered;
    }

    let hits = this.rawHits(sec, all);
    if (sec.error) {
      rendered.error = sec.error;
      return rendered;
    }
    if (!allowDup) hits = hits.filter((e) => !used.has(e.file.path));
    /* 先排序再截断 → 「按改动时间取前 N 条」才有意义 */
    hits = sortEntries(hits, sec.sort);
    hits = applyManualOrder(hits, this.manualOrder ? this.manualOrder[this.manualKeyOfSpec(sec)] : null);
    if (sec.limit > 0 && hits.length > sec.limit) hits = hits.slice(0, sec.limit);
    if (!allowDup) hits.forEach((e) => used.add(e.file.path));

    rendered.total = hits.length;
    hits.forEach((e) => matched.add(e.file.path));

    if (sec.source === "folder") {
      const folder = sec.path;
      const direct = [];
      const subs = new Map();
      const baseKey = this.manualKeyOfSpec(sec);
      for (const e of hits) {
        const rel = relPath(e.file.path, folder);
        const segs = rel === null ? [] : rel.split("/");
        if (rel && segs.length > 1 && sec.depth >= 1) {
          const top = segs[0];
          if (!subs.has(top)) subs.set(top, []);
          subs.get(top).push(e);
        } else {
          direct.push(e);
        }
      }
      rendered.entries = direct;
      /* 子板块各自吃自己那份手动顺序（键 = 板块键 + "#子板块名"） */
      rendered.children = [...subs.entries()].map(([n, list]) => ({
        name: n,
        entries: applyManualOrder(list, this.manualOrder ? this.manualOrder[baseKey + "#" + n] : null),
      }));
    } else {
      rendered.entries = hits;
    }

    return rendered;
  }

  /** 公式源：按 formula.<名> 的取值**展开成多个顶层板块**（= 保住你现在的自动分组） */
  produceFormula(sec, i, all, used, allowDup, matched) {
    if (!sec.formula) {
      return [{ id: "s" + i, srcIndex: i, name: sec.name, source: "formula", spec: sec, entries: [], children: [], total: 0, error: "缺少「公式」名" }];
    }
    /* 公式名写错时给提示 —— 否则所有笔记会静默掉进「（空值）」，看起来像看板坏了。
       只在**读得到公式清单**时校验；读不到（老版本 / 无 query）就不拦，避免误报。 */
    const known = this.collectFormulas();
    if (known.length && known.indexOf(sec.formula) < 0) {
      return [{
        id: "s" + i, srcIndex: i, name: sec.name, source: "formula", spec: sec,
        entries: [], children: [], total: 0,
        error: "公式「" + sec.formula + "」不存在，可选：" + known.join(" / "),
      }];
    }
    const buckets = new Map();
    for (const e of all) {
      const v = formulaValueOf(e, sec.formula);
      const key = v === null ? NO_VALUE : v;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
    }
    const keys = [...buckets.keys()].filter((k) => k !== NO_VALUE).sort(zhSort);
    if (buckets.has(NO_VALUE)) keys.push(NO_VALUE);

    const out = [];
    let k = 0;
    for (const key of keys) {
      let entries = buckets.get(key);
      if (!allowDup) entries = entries.filter((e) => !used.has(e.file.path));
      /* 板块级 `排序` 作用在「每个值分组内部」；分组本身的顺序仍按取值拼音序 */
      entries = sortEntries(entries, sec.sort);
      /* R15 修：手动顺序键与拖放写侧（secKeyOfCard）同源 —— 原来读 "s<i>_<k>" 位置键，
       * 写侧写 "formula:<公式名>"，两套键永不相等 → 公式分组内拖动排序落盘后被重算打回。
       * 各值分组条目本就不相交（allowDup 关时），共用一个键互不干扰。 */
      entries = applyManualOrder(entries, this.manualOrder ? this.manualOrder[this.manualKeyOfSpec(sec)] : null);
      if (sec.limit > 0 && entries.length > sec.limit) entries = entries.slice(0, sec.limit);
      if (!allowDup) entries.forEach((e) => used.add(e.file.path));
      entries.forEach((e) => matched.add(e.file.path));
      out.push({
        id: "s" + i + "_" + k,
        srcIndex: i,
        name: key,
        source: "formula",
        spec: sec,
        entries,
        children: [],
        total: entries.length,
        isFormulaValue: true,
      });
      k++;
    }
    if (out.length === 0) {
      out.push({ id: "s" + i, srcIndex: i, name: sec.name, source: "formula", spec: sec, entries: [], children: [], total: 0, error: "公式没有产出任何分组" });
    }
    return out;
  }

  rawHits(sec, all) {
    if (sec.source === "folder") {
      if (!sec.path) {
        sec.error = "缺少「路径」";
        return [];
      }
      return all.filter((e) => e && e.file && inFolder(e.file.path, sec.path));
    }
    if (sec.source === "tag") {
      if (!sec.tag) {
        sec.error = "缺少「标签」";
        return [];
      }
      const want = sec.tag;
      return all.filter((e) => e && e.file && tagsOf(this.app, e).some((t) => t === want || t.startsWith(want + "/")));
    }
    if (sec.source === "all") return all.slice();
    return [];
  }

  /* ============================================================
   * 看板渲染
   * ============================================================ */
  renderBoard(force) {
    this.unmountEditor(false);
    if (this.observer) {
      for (const it of this.bodyItems) {
        try {
          this.observer.unobserve(it.bodyEl);
        } catch (e) {}
      }
    }
    this.bodyQueue.length = 0;
    this.bodyItems = [];
    this.cardEls = new Map();
    /* 上一轮的滚动回填定时器作废（别叠着转） */
    if (this.boardScrollTimer) {
      clearInterval(this.boardScrollTimer);
      this.boardScrollTimer = null;
    }

    const keepScroll = force ? 0 : this.listEl.scrollTop;
    /* 第 13 轮：像素回填治不了「上面的懒加载内容长高把视口顶跑」——
       改用**元素锚点**：记下视口顶上第一张卡（避开正在拖的那张）+ 它离容器顶的距离，
       重画后把这张卡钉回原位。锚点拿不到（jsdom/空视图）才退回像素回填 */
    const anchor = force ? null : this.scrollAnchorOf();
    this.snapshotOpenSubs();   // 第 11 轮：先记住哪些子栏开着，再清 DOM
    this.listEl.empty();

    const all = this.data && Array.isArray(this.data.data) ? this.data.data : [];
    if (all.length === 0) {
      this.listEl.createDiv({ cls: "cb-empty", text: "没有匹配的笔记（检查这个视图的过滤条件）" });
      this.lastPaths = this.pathList();
      this.updateBar();
      return;
    }

    const minW = num(this.optNum(K_WIDTH, 240), 240);
    this.rootEl.style.setProperty("--cb-card-w", minW + "px");
    /* R15：空位铺满整行开关 —— 开 = 1fr 撑满（R14 行为）；关 = 固定为滑杆宽度（滑杆真正「可调」） */
    this.rootEl.style.setProperty("--cb-card-max", this.optBool(K_FILL, true) ? "1fr" : minW + "px");

    for (const sec of this.sections) this.renderSection(this.listEl, sec);

    /* 重建后把「未落盘」圆点补回来（写入还在队列里的那些） */
    for (const path of this.pending.keys()) this.markDirty(path, true);

    this.lastPaths = this.pathList();
    this.updateBar();
    if (anchor) this.restoreScrollAnchor(anchor, keepScroll);
    else this.restoreBoardScroll(keepScroll);
  }

  /** 第 13 轮：抓滚动锚点 —— 视口顶部附近第一张可见卡（**避开正在拖的那张**，
   *  它要么换位要么搬家，钉它等于跳到新位置去）+ 它相对容器顶的像素距离 */
  scrollAnchorOf() {
    try {
      if (this.anchorTriesMax == null) this.anchorTriesMax = 80;
      if (this.anchorFbTries == null) this.anchorFbTries = 10;
      const lc = this.listEl.getBoundingClientRect();
      if (!lc || !(lc.height > 0)) return null;
      let best = null;
      const cards = this.listEl.querySelectorAll(".cb-card");
      for (const c of cards) {
        if (this.lastDraggedPath && c.getAttribute("data-path") === this.lastDraggedPath) continue;
        const r = c.getBoundingClientRect();
        if (!(r.height > 0)) continue;
        if (r.bottom < lc.top + 24) continue;   // 整张都在视口上方的不管
        if (!best || r.top < best.top) {
          /* R15：连板块名一起记 —— 「允许重复」时同一篇会出现在多个板块，恢复时只按
           * path 取第一张会钉错副本 */
          const secEl = c.closest ? c.closest(".cb-section") : null;
          const nEl = secEl ? secEl.querySelector(".cb-section-name") : null;
          best = { top: r.top, path: c.getAttribute("data-path"), sec: nEl ? nEl.textContent : "" };
        }
      }
      if (!best) return null;
      return { path: best.path, off: best.top - lc.top };
    } catch (e) {
      return null;
    }
  }

  /** 第 13 轮：把锚卡钉回原来的视口位置（轮询——等懒加载把高度铺出来）。
   *  一段时间还找不到锚卡（被过滤/搬家出视图）→ 退回第 12 轮的像素回填 */
  restoreScrollAnchor(anchor, fallback) {
    if (!anchor || !anchor.path) return;
    if (this.anchorTriesMax == null) this.anchorTriesMax = 80;
    if (this.anchorFbTries == null) this.anchorFbTries = 10;
    if (this.boardScrollTimer) {
      clearInterval(this.boardScrollTimer);
      this.boardScrollTimer = null;
    }
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      let done = false;
      try {
        let card = null;
        const all = this.listEl.querySelectorAll(".cb-card");
        /* R15：优先在同板块内找（允许重复时同名卡有多张）；板块找不到再退回全局第一张 */
        if (anchor.sec) {
          for (const c of all) {
            if (c.getAttribute("data-path") !== anchor.path) continue;
            const secEl = c.closest ? c.closest(".cb-section") : null;
            const nEl = secEl ? secEl.querySelector(".cb-section-name") : null;
            if (nEl && nEl.textContent === anchor.sec) { card = c; break; }
          }
        }
        if (!card) {
          for (const c of all) {
            if (c.getAttribute("data-path") === anchor.path) { card = c; break; }
          }
        }
        if (card) {
          const lc = this.listEl.getBoundingClientRect();
          const rc = card.getBoundingClientRect();
          if (rc.height > 0 && lc.height > 0) {
            const diff = (rc.top - lc.top) - anchor.off;
            if (Math.abs(diff) > 1) this.listEl.scrollTop += diff;   // 差多少补多少
            else done = true;
          }
        } else if (tries > this.anchorFbTries) {
          clearInterval(t);
          if (this.boardScrollTimer === t) this.boardScrollTimer = null;
          this.restoreBoardScroll(fallback);
          return;
        }
      } catch (e) {}
      if (done || tries > this.anchorTriesMax) {
        clearInterval(t);
        if (this.boardScrollTimer === t) this.boardScrollTimer = null;
      }
    }, 25);
    this.boardScrollTimer = t;
  }

  /** 第 12 轮：重画后滚动位置别丢（老板：拖动移动后界面会一定程度上翻）。
   *  根因跟第 11 轮「编辑器跳顶」同款：正文是懒加载，刚 rebuild 完 scrollHeight 偏小，
   *  一次性赋值 scrollTop 会被 clamp 到半截 → 落点乱跳。改成轮询回填：
   *  每拍都把目标值压回去，直到真顶到位（或 ~1s 超时）。 */
  restoreBoardScroll(target) {
    if (!(target > 0)) return;
    if (this.boardScrollTimer) {
      clearInterval(this.boardScrollTimer);
      this.boardScrollTimer = null;
    }
    try { this.listEl.scrollTop = target; } catch (e) {}
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      let el = null;
      try { el = this.listEl; el.scrollTop = target; } catch (e) {}
      const done = el && (el.scrollTop >= target - 1 || el.scrollHeight <= el.clientHeight);
      if (done || tries > 40) {
        clearInterval(t);
        if (this.boardScrollTimer === t) this.boardScrollTimer = null;
      }
    }, 25);
    this.boardScrollTimer = t;
  }

  renderSection(parentEl, sec) {
    const wrap = parentEl.createDiv({ cls: "cb-section" });
    const collapsed = this.isCollapsed(sec, null, false);

    const head = wrap.createDiv({ cls: "cb-section-head" });
    const tri = head.createSpan({ cls: "cb-tri", text: collapsed ? "▸" : "▾" });
    const nameEl = head.createSpan({ cls: "cb-section-name", text: sec.name });
    /* R24（boss 第 1 条）：双击板块名 → 就地改名（原来只能去顶栏面板的编辑行里改） */
    if (this.secConfigurable(sec) && !this.readonly()) {
      nameEl.addClass("cb-sec-name-edit");
      nameEl.setAttr("title", "双击改名；拖动这一行可以给板块排序");
      nameEl.addEventListener("dblclick", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.cancelClick();
        this.beginRenameSection(sec, nameEl);
      });
    }
    head.createSpan({ cls: "cb-section-count", text: sec.total + " 条" });
    if (sec.isCatch) head.createSpan({ cls: "cb-badge", text: "收容所" });
    else if (sec.native) head.createSpan({ cls: "cb-badge", text: "自动" });
    else if (sec.isFormulaValue) head.createSpan({ cls: "cb-badge", text: "公式" });
    else if (sec.unsupported) head.createSpan({ cls: "cb-badge cb-badge-warn", text: "未支持" });
    if (this.bodyOn(sec)) head.createSpan({ cls: "cb-badge", text: "正文" });
    const pl = this.propListFor(sec);
    if (pl) head.createSpan({ cls: "cb-badge", text: "属性 " + pl.length });
    const sp = this.specOf(sec);
    if (sp && sp.sort) head.createSpan({ cls: "cb-badge", text: "排序 " + (SORT_LABEL[sp.sort] || sp.sort) });

    /* R12（boss 第 4 条）：板块标题可拖动排序 —— 只对「配置给的板块」（文件夹/标签）开放；
     * 自动分组与公式组的顺序不是配置定的，拖了也会被重算覆盖。左右半边决定插到目标前/后。 */
    const cfgIdx = (!sec.native && !sec.isFormulaValue && !sec.isCatch && sec.spec
      && ["folder", "tag"].indexOf(sec.spec.source) >= 0 && typeof sec.srcIndex === "number")
      ? sec.srcIndex : null;
    if (cfgIdx !== null && !this.readonly()) {
      head.setAttr("draggable", "true");
      head.addClass("cb-head-grab");
      head.addEventListener("dragstart", (evt) => {
        this.secDrag = { idx: cfgIdx, el: head };
        try {
          if (evt.dataTransfer) {
            evt.dataTransfer.effectAllowed = "move";
            evt.dataTransfer.setData("text/plain", sec.name);
          }
        } catch (e) {}
        head.addClass("cb-sec-dragging");
      });
      head.addEventListener("dragover", (evt) => {
        if (!this.secDrag || this.secDrag.el === head) return;
        evt.preventDefault();
        try { if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move"; } catch (e) {}
        head.addClass("cb-sec-drop");
      });
      head.addEventListener("dragleave", () => head.removeClass("cb-sec-drop"));
      head.addEventListener("drop", (evt) => {
        evt.preventDefault();
        head.removeClass("cb-sec-drop");
        const from = this.secDrag ? this.secDrag.idx : null;
        this.secDrag = null;
        head.removeClass("cb-sec-dragging");
        if (from === null || from === cfgIdx) return;
        const r = head.getBoundingClientRect();
        const after = (evt.clientX - r.left) >= r.width / 2;
        let to = after ? cfgIdx + 1 : cfgIdx;
        if (from < to) to -= 1;   /* reorder 是先摘再插：摘掉自己后目标左移一格 */
        this.reorder(from, to);
      });
      head.addEventListener("dragend", () => {
        head.removeClass("cb-sec-dragging");
        this.secDrag = null;
      });
    }
    /* R24（boss 第 3 条）：板块标题旁那个 ⚙ **撤掉了** —— 改成「右键板块 → 鼠标处弹设置小窗」
       （Windows 右键菜单那种）。原来那块齿轮看着更像全局设置（跟顶栏面板各写一份），
       而且每次都要「开面板 → 找到这块的编辑行」；右键是「就地、只对这块」的语义。
       双击改名与整行拖动排序都保留（拖动是 R12 就有的，不用重做）。 */
    head.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.openSecMenu(sec, evt.clientX, evt.clientY);
    });

    const body = wrap.createDiv({ cls: "cb-section-body" });

    const grid = body.createDiv({ cls: "cb-grid" });
    /* 第 12 轮：板块三角只折「自己这一层的笔记」（老板：收起后别把下面的子栏目一起带走）。
       折叠态落在 grid 上，子板块（.cb-sub）在外面，各自管各自的折叠 */
    if (collapsed) grid.addClass("is-collapsed");
    /* R24（boss 第 3 条·文件操作）：被「收起来」的笔记 —— 「查看隐藏的文件」关着就**完全不渲染**；
       开着则渲染成淡出、仍可右键恢复（`.cb-card.is-cb-hidden`）。条数上照旧给个「已隐藏 N」。 */
    let hiddenN = 0;
    for (const e of sec.entries) {
      const hid = this.isHidden(e && e.file ? e.file.path : "");
      if (hid) hiddenN++;
      if (hid && !this.showHidden()) continue;
      const cd = this.renderCard(grid, e, sec);
      if (hid && cd) cd.addClass("is-cb-hidden");
    }
    if (hiddenN > 0) head.createSpan({ cls: "cb-badge cb-badge-hidden", text: "已隐藏 " + hiddenN });

    if (sec.entries.length === 0 && sec.children.length === 0) {
      body.createDiv({ cls: "cb-hint", text: sec.error ? "（" + sec.error + "）" : "这个板块还没有笔记" });
    }

    for (const child of sec.children) this.renderSubSection(body, sec, child);

    /* 第 4 轮：板块级「＋」新建（放在徽标之后 = 行末） */
    if (!sec.unsupported) this.renderAddBtn(head, sec, grid, "");

    tri.addEventListener("click", (evt) => {
      evt.stopPropagation();
      const now = !grid.hasClass("is-collapsed");
      grid.toggleClass("is-collapsed", now);
      tri.setText(now ? "▸" : "▾");
      this.setCollapsed(sec, null, now);
    });
  }

  renderSubSection(body, sec, child) {
    const sub = body.createDiv({ cls: "cb-sub" });
    const collapsed = this.isCollapsed(sec, child, true);   // 子板块默认收起

    const head = sub.createDiv({ cls: "cb-sub-head" });
    const tri = head.createSpan({ cls: "cb-tri", text: collapsed ? "▸" : "▾" });
    head.createSpan({ cls: "cb-sub-name", text: child.name });
    head.createSpan({ cls: "cb-sub-count", text: child.entries.length + " 条" });

    const subBody = sub.createDiv({ cls: "cb-sub-body" });
    if (collapsed) subBody.addClass("is-collapsed");
    const grid = subBody.createDiv({ cls: "cb-grid" });
    for (const e of child.entries) this.renderCard(grid, e, sec, child.name);

    /* 子板块也能新建（落点仍按父板块算，只是 Notice 里会带上子板块名） */
    this.renderAddBtn(head, sec, grid, child.name);

    head.addEventListener("click", () => {
      const now = !subBody.hasClass("is-collapsed");
      subBody.toggleClass("is-collapsed", now);
      tri.setText(now ? "▸" : "▾");
      this.setCollapsed(sec, child, now);
    });
  }

  /* ============================================================
   * 第 3 轮：卡片（属性 + 正文 + 就地编辑）
   * ============================================================ */
  renderCard(parentEl, entry, sec, childName) {
    const file = entry.file;
    const card = parentEl.createDiv({ cls: "cb-card" });
    if (childName) card.__cbChildName = childName;   // 第 10 轮：手动顺序的键要区分到子板块
    card.setAttr("data-path", file.path);
    card.__cbEntry = entry;
    card.__cbSec = sec;

    let set = this.cardEls.get(file.path);
    if (!set) {
      set = new Set();
      this.cardEls.set(file.path, set);
    }
    set.add(card);

    /* 左上「未落盘」小圆点 */
    const dot = card.createSpan({ cls: "cb-dirty", text: "●" });
    dot.setAttr("title", "有改动还没落盘（静默 1.5 秒或失焦后自动写入）");

    /* 第 4 轮：这篇在你编辑期间被外部改过（同步客户端 / 别的编辑器） */
    if (this.conflicts.has(file.path)) {
      const cf = card.createSpan({ cls: "cb-conflict", text: "⚠ 外部已改" });
      cf.setAttr("title", "编辑期间这篇被外部改动过；写回时只覆盖你自己改的那几个属性，其余保持外部那一版");
    }

    /* 标题行（第 9 轮：标题 + 旁边的「属性」展开钮）—— 单击标题 = 改名；Ctrl/Cmd+单击 = 新标签打开；双击 = 打开笔记 */
    const titleRow = card.createDiv({ cls: "cb-title-row" });
    const titleEl = titleRow.createEl("a", { cls: "internal-link cb-title", text: file.basename });
    titleEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      if (evt.ctrlKey || evt.metaKey) {
        this.cancelClick();
        this.openNote(entry, true);
        return;
      }
      if (evt.detail && evt.detail > 1) return;   // 第二次点击别排改名
      this.cancelClick();
      this.clickAction = () => {
        if (this.readonly()) this.openNote(entry, false);
        else this.beginRename(card, entry);
      };
      this.clickTimer = setTimeout(() => {
        this.clickTimer = null;
        const fn = this.clickAction;
        this.clickAction = null;
        if (fn) fn();
      }, this.clickDelayValue);
    });
    titleEl.addEventListener("dblclick", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.cancelClick();
      this.openNote(entry, false);
    });
    titleEl.addEventListener("mouseover", (evt) => {
      /* source:"bases" → 官方预览小窗；⚠️ 该源 defaultMod:true，需按住 Ctrl/Cmd 才弹 */
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: "bases",
        hoverParent: this,
        targetEl: titleEl,
        linktext: file.path,
      });
    });

    /* 属性区（第 9 轮：默认折叠 ⇒ 🔴 R9 改成**默认展开**：老板「我需要属性是默认展开的」。
       顶栏面板「看板行为」组的「属性默认展开」关掉即可退回旧的「默认折叠」。） */
    const propsBox = this.renderProps(card, entry, sec);
    card.__cbHasProps = !!propsBox;   // 第 5 轮：卡片已显示属性 → 编辑器里那份就藏掉（免得两套属性上下打架）
    if (propsBox) {
      /* 只记「与默认不同」的路径（重渲染不丢）。默认值本身可切换，所以不能只存一份展开集合 ——
         存展开集合的话，「默认展开」时集合为空就永远全展开，用户手收起的会被重渲染吃掉。 */
      if (!this.prosToggledPaths) this.prosToggledPaths = new Set();
      const dfltOpen = this.propsOpenOn(sec);
      const open = dfltOpen ? !this.prosToggledPaths.has(file.path) : this.prosToggledPaths.has(file.path);
      propsBox.toggleClass("cb-pros-fold", !open);
      const tg = titleRow.createEl("button", { cls: "cb-pros-toggle", text: open ? "属性 ▾" : "属性 ▸" });
      tg.setAttr("title", "展开 / 收起属性");
      tg.addEventListener("mousedown", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
      });
      tg.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const nowOpen = propsBox.hasClass("cb-pros-fold");   // 现在折着的 → 点一下变展开
        propsBox.toggleClass("cb-pros-fold", !nowOpen);
        tg.setText(nowOpen ? "属性 ▾" : "属性 ▸");
        if (nowOpen === dfltOpen) this.prosToggledPaths.delete(file.path);
        else this.prosToggledPaths.add(file.path);
      });
    }

    /* 正文区（板块/视图开关决定是否出现） */
    if (this.bodyOn(sec)) this.renderBodyLazy(card, entry, sec);

    /* 双击卡片空白 / 任意非输入处 → 打开笔记 */
    card.addEventListener("dblclick", (evt) => {
      const t = evt.target;
      if (t && t.closest && t.closest(".cb-prop, input, textarea, select, .cb-body.is-editing, .cb-rename-input, .cb-pros-toggle")) return;
      evt.preventDefault();
      this.cancelClick();
      this.openNote(entry, false);
    });

    /* 第 10 轮：右键 → 笔记操作菜单 */
    card.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.openCardMenu(card, entry, evt.clientX, evt.clientY);
    });

    /* 第 10 轮：拖动排序（HTML5 DnD，同板块内） */
    card.setAttr("draggable", this.readonly() ? "false" : "true");
    card.addEventListener("dragstart", (evt) => {
      if (this.readonly()) return;
      this.dragCtx = { path: file.path, card };
      this.lastDraggedPath = file.path;   // 第 13 轮：滚动锚点要避开这张（它要搬家/换位）
      try {
        if (evt.dataTransfer) {
          evt.dataTransfer.effectAllowed = "move";
          evt.dataTransfer.setData("text/plain", file.path);
        }
      } catch (e) {}
      card.addClass("cb-dragging");
    });
    card.addEventListener("dragover", (evt) => {
      const src = this.dragCtx && this.dragCtx.card;
      if (!src || src === card) return;
      evt.preventDefault();
      try {
        if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      } catch (e) {}
      /* 第 13 轮：落在目标卡**左半边还是右半边**要区分（老板：停留位置要能分左右）。
         悬停时算好插到哪侧，高亮条也跟着标在那侧；drop 时按同一侧插入 */
      let side = this.dragCtx.side === "right" ? "right" : "left";
      try {
        const r = card.getBoundingClientRect();
        if (r && r.width > 0 && typeof evt.clientX === "number" && isFinite(evt.clientX)) {
          side = (evt.clientX - r.left) < r.width / 2 ? "left" : "right";
        }
      } catch (e) {}
      this.dragCtx.side = side;
      /* R12（boss 第 1 条）：悬停在「另一个目录」的卡上时，整卡高亮（这是搬文件，不是插位） */
      try {
        const srcE = this.dragCtx.card.__cbEntry, tgtE = card.__cbEntry;
        const cross = !!(srcE && tgtE && srcE.file && tgtE.file
          && cleanFolder(str(srcE.file.path).replace(/\/[^/]+$/, ""))
            !== cleanFolder(str(tgtE.file.path).replace(/\/[^/]+$/, "")));
        const moveMode = cross && !evt.altKey && this.optBool(K_MOVE, true);
        card.toggleClass("cb-drop-move", moveMode);
        if (moveMode) {
          card.removeClass("cb-drop-left");
          card.removeClass("cb-drop-right");
        }
      } catch (e) {}
      card.addClass("cb-drop-target");
    });
    card.addEventListener("dragleave", () => {
      card.removeClass("cb-drop-target");
      card.removeClass("cb-drop-left");
      card.removeClass("cb-drop-right");
      card.removeClass("cb-drop-move");
    });
    card.addEventListener("drop", (evt) => {
      evt.preventDefault();
      const src = this.dragCtx && this.dragCtx.card;
      const side = this.dragCtx && this.dragCtx.side === "right" ? "right" : "left";
      card.removeClass("cb-drop-target");
      card.removeClass("cb-drop-left");
      card.removeClass("cb-drop-right");
      this.dragCtx = null;
      if (!src || src === card || !src.isConnected) return;
      /* R12（boss 第 1 条，第 1 条反馈升级）：**普通拖动 = 搬文件**，Alt 退役成「强制纯排序」——
       * 目标卡所在目录 ≠ 源目录 → 文件搬进目标卡的目录（板块内外一个逻辑）；
       * 同目录 → 照旧左右插入排序；按住 Alt → 跨目录也只排序、不搬文件。 */
      const srcE = src.__cbEntry, tgtE = card.__cbEntry;
      const crossFolder = !!(srcE && tgtE && srcE.file && tgtE.file
        && cleanFolder(str(srcE.file.path).replace(/\/[^/]+$/, ""))
          !== cleanFolder(str(tgtE.file.path).replace(/\/[^/]+$/, "")));
      if (this.optBool(K_MOVE, true) && crossFolder && !evt.altKey) { this.moveCardToFolderOfCard(src, card); return; }
      if (this.secKeyOfCard(src) === this.secKeyOfCard(card)) {
        if (src.parentElement === card.parentElement) this.onCardDrop(src, card, side);   // 同板块 → 排序（分左右）
      } else {
        this.moveCardToSection(src, card);   // 第 11 轮：跨板块 → 移动文件 + 同步 YAML/双链
      }
    });
    card.addEventListener("dragend", () => {
      card.removeClass("cb-dragging");
      this.dragCtx = null;
      /* R15 修：lastDraggedPath 原来只设不清 → 这张卡在余生所有重绘里都被滚动
       * 锚点排除（设计意图只是避开「拖动那一把」），锚点退化成像素回填会跳。 */
      this.lastDraggedPath = null;
      try {
        const root = this.rootEl;
        if (root) {
          root.querySelectorAll(".cb-drop-target").forEach((el) => {
            el.removeClass("cb-drop-target");
            el.removeClass("cb-drop-left");
            el.removeClass("cb-drop-right");
            el.removeClass("cb-drop-move");
          });
        }
      } catch (e) {}
    });

    return card;
  }

  /* ============================================================
   * 第 10 轮：拖动排序 + 右键菜单
   * ============================================================ */

  /** 一个卡片列表的稳定标识（手动顺序的键）：板块源 + 路径/标签/公式（+ 子板块名） */
  secKeyOfCard(card) {
    const sec = card.__cbSec || {};
    const sp = sec.spec || {};
    const base = (sp.source || sec.source || "") + ":" + (sp.path || sp.tag || sp.formula || sec.name || "");
    return card.__cbChildName ? base + "#" + card.__cbChildName : base;
  }

  /** 产出阶段的手动顺序键（spec 级；公式分组在调用处用渲染 id） */
  manualKeyOfSpec(sec) {
    return (sec.source || "") + ":" + (sec.path || sec.tag || sec.formula || "");
  }

  /* ---------- 第 11 轮：跨板块拖动 = 移动文件 + 同步 YAML/结尾双链 ---------- */

  /** 板块（+子栏）对应的落盘目录；非文件夹源 → null */
  sectionFolderOfCard(card) {
    const sec = card.__cbSec || {};
    const sp = sec.spec || {};
    if (sp.source !== "folder" || !sp.path) return null;
    let f = cleanFolder(sp.path);
    if (card.__cbChildName) f = f + "/" + card.__cbChildName;
    return f;
  }

  /** 领域名：路径里 02_Areas/ 的下一段（老板的库：01_新知识库/02_Areas/<领域>）；不是领域目录 → null */
  areaNameOf(folderPath) {
    const m = /02_Areas\/([^/]+)/.exec(str(folderPath));
    return m ? m[1] : null;
  }

  async moveCardToSection(srcCard, targetCard) {
    const entry = srcCard.__cbEntry;
    const file = entry && entry.file;
    const tgtFolder = this.sectionFolderOfCard(targetCard);
    if (!entry || !file || !tgtFolder) {
      try { new obsidian.Notice("目标板块不是文件夹源，拖动移动只在文件夹板块之间生效"); } catch (e) {}
      return;
    }
    await this.moveFileToFolder(file, tgtFolder, srcCard, targetCard);
  }

  /* ============================================================
   * R11（boss 第 3 条）：Alt + 拖动 = 把文件搬进**目标卡片**所在的目录。
   * 背景：看板只有一个「全部」板块（无文件夹板块）时，板块级拖动表达不了
   * 「搬去哪个目录」—— 卡片本身就是目录的化身，拖到谁身上就进谁的家。
   * 普通拖动行为一字不变（同板块排序 / 跨板块搬文件）。
   * ============================================================ */
  async moveCardToFolderOfCard(srcCard, targetCard) {
    const entry = srcCard.__cbEntry;
    const file = entry && entry.file;
    const tEntry = targetCard.__cbEntry;
    const tFile = tEntry && tEntry.file;
    const tgtFolder = tFile ? str(tFile.path).replace(/\/[^/]+$/, "") : "";
    if (!file || !tFile || !tgtFolder) {
      try { new obsidian.Notice("按住 Alt 拖到另一张笔记卡上松手，文件就搬进它的目录"); } catch (e) {}
      return;
    }
    await this.moveFileToFolder(file, tgtFolder, srcCard, targetCard);
  }

  /* moveCardToSection / moveCardToFolderOfCard 共用的落库段：搬文件 + 同步 YAML/双链 + 重画 */
  async moveFileToFolder(file, tgtFolder, srcCard, targetCard) {
    try {
      const curFolder = str(file.path).replace(/\/[^/]+$/, "");
      /* 同一个目录 → 退化为排序（不动文件）。R15 修：原来这里引用了不存在的
       * srcCard/targetCard（ReferenceError 被兜底 catch 吞成「移动失败」）——
       * 同目录跨板块拖动（如两个标签板块的笔记同住一个目录）从此白拖。 */
      if (cleanFolder(curFolder) === cleanFolder(tgtFolder)) {
        if (srcCard && targetCard && srcCard.parentElement === targetCard.parentElement) this.onCardDrop(srcCard, targetCard);
        return;
      }
      const target = await this.uniquePath(tgtFolder, file.basename);
      await this.app.fileManager.renameFile(file, target);
      const oldArea = this.areaNameOf(curFolder);
      const newArea = this.areaNameOf(tgtFolder);
      if (oldArea && newArea && oldArea !== newArea) {
        const f2 = this.app.vault.getAbstractFileByPath(target);
        if (f2) {
          /* YAML：领域 / tags 同名项 / 文件位置 —— 只改跟旧领域挂钩的，其余一字不动 */
          await this.app.fileManager.processFrontMatter(f2, (fm) => {
            if (fm["领域"] === oldArea) fm["领域"] = newArea;
            if (Array.isArray(fm["tags"])) fm["tags"] = fm["tags"].map((t) => (t === oldArea ? newArea : t));
            if (Array.isArray(fm["文件位置"])) {
              fm["文件位置"] = fm["文件位置"].map((p) => {
                const s = str(p);
                if (s === "02_Areas/" + oldArea) return "02_Areas/" + newArea;
                if (s === oldArea) return newArea;
                return s;
              });
            }
          });
          /* 结尾双链：正文里指向旧板块路径的链接（[[...02_Areas/<旧>/...]]）改到新板块
             —— 只动含 [[ 的行，且只换 02_Areas/<旧> 这一段 */
          try {
            const changed = await this.rewriteAreaLinks(f2, oldArea, newArea);
            if (changed) {
              try { new obsidian.Notice("已同步正文里的旧板块链接（" + oldArea + " → " + newArea + "）"); } catch (e) {}
            }
          } catch (e) {}
        }
      }
      try { new obsidian.Notice("已移动到 " + tgtFolder); } catch (e) {}
      /* 强制重画（computeSig 不认文件路径以外的变化，保险起见跟拖动排序同一套） */
      this.sig = null;
      this.renderedOnce = false;
      this.onDataUpdated();
    } catch (e) {
      try { new obsidian.Notice("移动失败：" + (e && e.message ? e.message : String(e))); } catch (e2) {}
    }
  }

  /** 正文里 02_Areas/<旧> → 02_Areas/<新>：只改含 [[ 的行（双链），用 vault.process 原子写 */
  async rewriteAreaLinks(file, oldArea, newArea) {
    const vault = this.app.vault;
    const from = "02_Areas/" + oldArea;
    const to = "02_Areas/" + newArea;
    if (typeof vault.process === "function") {
      return Promise.resolve(vault.process(file, (txt) => this.rewriteAreaLinksIn(txt, from, to))).then((r) => !!r);
    }
    const txt = await vault.read(file);
    const next = this.rewriteAreaLinksIn(txt, from, to);
    if (next === txt) return false;
    await vault.modify(file, next);
    return true;
  }
  rewriteAreaLinksIn(txt, from, to) {
    return str(txt).split("\n").map((line) => {
      if (line.indexOf("[[") < 0 || line.indexOf(from) < 0) return line;
      return line.split(from).join(to);
    }).join("\n");
  }

  /** 拖放落定：把该列表的新顺序写进视图块顶层键「手动顺序」（自定义键原样回写，已核实）。
   *  第 13 轮：side = "left"/"right" —— 停在目标卡**左半边**插到它前面，**右半边**插到它后面 */
  onCardDrop(draggedCard, targetCard, side) {
    try {
      const container = draggedCard.parentElement;
      if (!container) return;
      const dragPath = draggedCard.getAttribute("data-path");
      const tgtPath = targetCard.getAttribute("data-path");
      const paths = [...container.querySelectorAll(".cb-card")].map((c) => c.getAttribute("data-path"));
      const from = paths.indexOf(dragPath);
      let to = paths.indexOf(tgtPath);
      if (from < 0 || to < 0) return;
      paths.splice(from, 1);
      to = paths.indexOf(tgtPath);          // 删掉被拖的之后重算目标位置
      if (to < 0) return;
      if (side === "right") to += 1;
      paths.splice(to, 0, dragPath);
      const key = this.secKeyOfCard(draggedCard);
      if (!this.manualOrder) this.manualOrder = this.loadManualOrder();
      this.manualOrder[key] = paths;
      try {
        if (this.config && typeof this.config.set === "function") this.config.set("手动顺序", this.manualOrder);
      } catch (e) {}
      this.manualOrderDirty = key;   // 诊断用：最近一次拖动写了哪个键
      /* computeSig 不认「手动顺序」这个新键 → 不清签名就会走「无变化」分支不重画 */
      this.sig = null;
      this.renderedOnce = false;
      this.onDataUpdated();          // 重新渲染，吃进新顺序
    } catch (e) {}
  }

  /** 读视图块顶层键「手动顺序」（config.get → config.data → query.data，三路都试） */
  loadManualOrder() {
    const c = this.config;
    const cands = [];
    try { if (c && typeof c.get === "function") cands.push(c.get("手动顺序")); } catch (e) {}
    try { if (c && c.data) cands.push(c.data["手动顺序"]); } catch (e) {}
    try { if (c && c.query && c.query.data) cands.push(c.query.data["手动顺序"]); } catch (e) {}
    for (const v of cands) {
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    }
    return {};
  }

  /** 右键菜单打开时的 Esc 监听 */
  unbindMenuEsc() {
    if (!this.menuEscHandler) return;
    try {
      document.removeEventListener("keydown", this.menuEscHandler, true);
    } catch (e) {}
    this.menuEscHandler = null;
  }

  closeCardMenu() {
    if (this.cardMenuEl) {
      try {
        if (this.cardMenuEl.parentNode) this.cardMenuEl.parentNode.removeChild(this.cardMenuEl);
      } catch (e) {}
      this.cardMenuEl = null;
    }
    this.removeOutsideCloser("ctxmenu");
    this.unbindMenuEsc();
  }

  /* ============================================================
   * R24（boss：「单个板块的设置应只对单独板块生效」）
   *   · 板块标题旁的 ⚙ 撤掉 → 右键板块弹「设置小窗」（Windows 右键菜单那种）
   *   · 板块级项一律**三态**（继承 / 开 / 关）：继承 = 跟视图默认，开/关 = 只改这一块
   *   · 「文件操作」那三项本质是**整个看板**的，照老板要求放在这张菜单里，
   *     分组标题上写明「整个看板」，不让它冒充板块级
   * ============================================================ */

  /** 这个板块能不能「单独设置」—— 自动分组 / 公式产出的子分组不行（名字与顺序都是算出来的） */
  secConfigurable(sec) {
    return !!(sec && sec.spec && typeof sec.srcIndex === "number" && !sec.native && !sec.isFormulaValue);
  }

  /** built section → 它在 `this.secs` 里的下标（catchall 在 persist 时被挪到最后，按 source 找） */
  secIndexOf(sec) {
    if (!sec) return -1;
    if (sec.isCatch) return this.secs.findIndex((s) => s.source === "catchall");
    if (typeof sec.srcIndex === "number" && sec.srcIndex >= 0) return sec.srcIndex;
    if (sec.spec) {
      const i = this.secs.indexOf(sec.spec);
      if (i >= 0) return i;
    }
    return -1;
  }

  /** 这个板块有没有「板块级覆盖」（决定「重置设置」是否可点） */
  secHasOverride(i) {
    const s = this.secs[i];
    if (!s) return false;
    return s.body === true || s.body === false
      || s.yaml === true || s.yaml === false
      || s.links === true || s.links === false
      || s.propsOpen === true || s.propsOpen === false
      || (s.props && s.props.length > 0)
      || !!s.sort;
  }

  /** R24（boss 第 3 条·通用设置）：「重置设置」= 把这个板块的**全部板块级覆盖**清掉 → 回继承视图默认 */
  resetSection(i) {
    const s = this.secs[i];
    if (!s) return;
    s.body = null;
    s.yaml = null;
    s.links = null;
    s.propsOpen = null;
    s.props = [];
    s.sort = "";
    this.saveState = "已重置「" + s.name + "」（回继承视图默认）";
    this.afterChange();
  }

  /** R24（boss 第 3 条·菜单第一项）：「刷新」—— 绕开 `computeSig` 那关强制重画并重读当前数据 */
  refreshBoard() {
    this.sig = null;
    this.renderedOnce = false;
    this.lastPaths = null;
    this.saveState = "已刷新";
    try {
      this.onDataUpdated();
    } catch (e) {
      this.repaint(true);
    }
  }

  /* ---------- R24（boss 第 3 条·文件操作）：把某篇笔记「收起来」 ---------- */
  hiddenOn() {
    return this.optBool(K_HIDDEN_ON, true);
  }
  showHidden() {
    return this.optBool(K_HIDDEN_SHOW, false);
  }
  hiddenPaths() {
    const v = this.cfgGet(K_HIDDEN, null);
    if (Array.isArray(v)) return v.map(str).filter(Boolean);
    return parseNameList(v);
  }
  isHidden(p) {
    return !!p && this.hiddenPaths().indexOf(String(p)) >= 0;
  }
  toggleHidden(p) {
    if (!p) return;
    const cur = this.hiddenPaths();
    const i = cur.indexOf(String(p));
    if (i >= 0) cur.splice(i, 1);
    else cur.push(String(p));
    this.cfgSet(K_HIDDEN, cur.length ? cur : null);
    this.repaint(false);
  }

  closeSecMenu() {
    if (this.secMenuEl) {
      try {
        if (this.secMenuEl.parentNode) this.secMenuEl.parentNode.removeChild(this.secMenuEl);
      } catch (e) {}
      this.secMenuEl = null;
    }
    this.removeOutsideCloser("secmenu");
    this.unbindMenuEsc();
  }

  /** 右键板块 → 鼠标处弹「板块设置」小窗（跟手弹出、clamp 在视口内、点外面 / Esc 收起） */
  openSecMenu(sec, x, y) {
    this.closeSecMenu();
    this.closeCardMenu();
    const menu = document.body.createDiv({ cls: "cb-ctxmenu cb-secmenu" });
    this.secMenuEl = menu;

    const si = this.secIndexOf(sec);
    const canSec = this.secConfigurable(sec) && si >= 0;
    const secName = sec ? sec.name : "";

    const run = (fn) => {
      this.closeSecMenu();
      try { fn(); } catch (e) {}
    };
    const item = (label, fn, disabled) => {
      const el = menu.createDiv({ cls: "cb-ctx-item" + (disabled ? " is-disabled" : "") });
      el.setAttr("data-act", label);
      el.setText(label);
      if (disabled) {
        el.setAttr("aria-disabled", "true");
        return el;
      }
      el.addEventListener("mousedown", (evt) => evt.stopPropagation());
      el.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        run(fn);
      });
      return el;
    };
    /** 跟 item 一样，只是**点完不收起小窗** —— 「显示帮助」要就地展开说明，
      *  收起小窗 = 把刚展开的说明块连人带窗一起摘掉（那就白点了）。 */
    const itemStay = (label, fn) => {
      const el = menu.createDiv({ cls: "cb-ctx-item" });
      el.setAttr("data-act", label);
      el.setText(label);
      el.addEventListener("mousedown", (evt) => evt.stopPropagation());
      el.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        try { fn(); } catch (e) {}
      });
      return el;
    };
    const grp = (label, hint) => {
      const h = menu.createDiv({ cls: "cb-ctx-head" });
      h.createSpan({ cls: "cb-ctx-head-lb", text: label });
      if (hint) h.createSpan({ cls: "cb-ctx-head-hint", text: hint });
      return h;
    };
    /** 板块级三态一行：左标签 + 右「继承 / 开 / 关」（复用面板那套 .cb-seg） */
    const triRow = (label, field, viewOn, tip) => {
      const row = menu.createDiv({ cls: "cb-ctx-tri" });
      row.setAttr("data-field", field);
      const lb = row.createSpan({ cls: "cb-ctx-tri-lb", text: label });
      lb.setAttr("title", tip || "");
      const seg = row.createDiv({ cls: "cb-seg cb-seg-" + field });
      const cur = this.secs[si][field];
      const curVal = cur === true ? "true" : cur === false ? "false" : "";
      const opts = [
        ["", "继承", "跟随视图默认（现在 = " + (viewOn ? "开" : "关") + "）"],
        ["true", "开", "这一块一定显示"],
        ["false", "关", "这一块一定不显示"],
      ];
      for (const pair of opts) {
        const b = seg.createEl("button", { cls: "cb-seg-btn", text: pair[1] });
        b.setAttr("type", "button");
        b.setAttr("data-value", pair[0]);
        b.setAttr("title", pair[2]);
        if (pair[0] === curVal) b.addClass("is-on");
        b.addEventListener("mousedown", (evt) => evt.stopPropagation());
        b.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          const nv = pair[0] === "" ? null : pair[0] === "true";
          if (this.secs[si][field] === nv) return;
          this.secs[si][field] = nv;
          this.afterChange();
          this.closeSecMenu();
        });
      }
    };
    /** 「文件操作」那组是**视图级**的 → 用 Windows 那种打勾项，不用三态（免得冒充板块级） */
    const chk = (label, key, dflt, tip) => {
      const el = menu.createDiv({ cls: "cb-ctx-item cb-ctx-chk" });
      el.setAttr("data-key", key);
      el.setAttr("title", tip || "");
      el.createSpan({ cls: "cb-ctx-tick", text: this.optBool(key, dflt) ? "✓" : "" });
      el.createSpan({ cls: "cb-ctx-chk-lb", text: label });
      el.addEventListener("mousedown", (evt) => evt.stopPropagation());
      el.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.cfgSet(key, !this.optBool(key, dflt));
        this.repaint(false);
        this.closeSecMenu();
      });
      return el;
    };

    item("刷新", () => this.refreshBoard());
    menu.createDiv({ cls: "cb-ctx-sep" });

    if (canSec) {
      grp("通用设置", "只对「" + secName + "」");
      triRow("属性展开", "propsOpen", this.propsOpenDefault(), "卡片 / 就地编辑浮层里的属性区默认展开");
      triRow("内容展开", "body", this.viewBodyDefault(), "＝原来的「显正文」；关 = 只显示标题与属性");
      const has = this.secHasOverride(si);
      item(has ? "重置设置" : "重置设置（已是默认）", () => this.resetSection(si), !has);
      let helpOpen = false;
      const helpBox = menu.createDiv({ cls: "cb-sec-help" });
      helpBox.toggleClass("is-hidden", true);
      itemStay("显示帮助", () => {
        helpOpen = !helpOpen;
        helpBox.toggleClass("is-hidden", !helpOpen);
        helpBox.setText("「" + secName + "」：数据源 " + (sec.spec.source || "") + "，"
          + "三态项（继承 / 开 / 关）只改这一块；双击板块名可改名，拖动标题可排序；"
          + "「文件操作」那组是整个看板共用的。");
      });

      menu.createDiv({ cls: "cb-ctx-sep" });
      grp("笔记内容", "只对「" + secName + "」");
      triRow("显示 YAML", "yaml", this.optBool(K_YAML, false), "卡片正文保留笔记前言（frontmatter）");
      triRow("显示双链", "links", this.optBool(K_LINKS, true), "卡片正文显示结尾「关联笔记」段");
    } else {
      menu.createDiv({ cls: "cb-ctx-note", text: sec && sec.native
        ? "「自动分组」的板块不能单独设置（名字与分组都是看板配置算出来的）"
        : "这个板块不支持单独设置" });
    }

    menu.createDiv({ cls: "cb-ctx-sep" });
    grp("文件操作", "整个看板");
    chk("拖动搬文件", K_MOVE, true, "跨板块拖动 = 直接搬文件；关 = 需要按住 Alt");
    chk("文件隐藏显示", K_HIDDEN_ON, true, "允许在卡片上把某篇笔记收起来（卡片右键 → 隐藏这篇）");
    chk("查看隐藏的文件", K_HIDDEN_SHOW, false, "把收起来的笔记显示出来（淡出，仍可右键恢复）");

    /* 位置：跟手弹出，clamp 在视口内。
       🔴 尺寸兜底：真浏览器里刚 append 就能读到真 rect（同步布局），走到兜底只在
       「量出来是 0」的退化情形（比如视图此刻 display:none）。R24 真引擎实测窗高 390.6，
       原来估 380 会让窗底探出屏 11px → 兜底值抬到 420。 */
    try {
      const r = menu.getBoundingClientRect();
      const w = r.width || 250;
      const h = r.height || 420;
      const vw = (typeof window !== "undefined" && window.innerWidth) || 1200;
      const vh = (typeof window !== "undefined" && window.innerHeight) || 800;
      menu.style.left = Math.min(Math.max(4, x), Math.max(4, vw - w - 8)) + "px";
      menu.style.top = Math.min(Math.max(4, y), Math.max(4, vh - h - 8)) + "px";
    } catch (e) {}

    this.addOutsideCloser(
      "secmenu",
      (t) => (menu.contains ? menu.contains(t) : false),
      () => this.closeSecMenu()
    );
    this.menuEscHandler = (e) => {
      if (e && e.key === "Escape") this.closeSecMenu();
    };
    try {
      document.addEventListener("keydown", this.menuEscHandler, true);
    } catch (e) {}
    return menu;
  }

  /* ============================================================
   * R24（boss 第 1 条）：双击板块名 → 就地改名
   *   🔴 坑：`折叠` 状态的键就是**板块名**（`foldKey`）：改名不迁移 = 折叠状态凭空丢。
   *   手动顺序的键是「数据源:路径/标签」，跟名字无关，不用动。
   * ============================================================ */
  beginRenameSection(sec, nameEl) {
    if (this.readonly() || !nameEl || nameEl.__cbRenaming) return null;
    const i = this.secIndexOf(sec);
    if (i < 0) return null;
    const old = sec.name;

    nameEl.__cbRenaming = true;
    const input = document.createElement("input");
    if (input.addClass) input.addClass("cb-sec-rename-input");
    else input.classList.add("cb-sec-rename-input");
    input.setAttribute("type", "text");
    input.value = old;
    nameEl.setText("");
    nameEl.appendChild(input);

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const nv = String(input.value || "").trim();
      try { input.remove(); } catch (e) {}
      nameEl.__cbRenaming = false;
      nameEl.setText(old);
      if (!commit || !nv || nv === old) return;
      this.renameSection(i, nv);
    };
    input.addEventListener("click", (evt) => evt.stopPropagation());
    input.addEventListener("dblclick", (evt) => evt.stopPropagation());
    input.addEventListener("mousedown", (evt) => evt.stopPropagation());
    input.addEventListener("keydown", (evt) => {
      evt.stopPropagation();
      if (evt.key === "Enter") { evt.preventDefault(); finish(true); }
      else if (evt.key === "Escape") { evt.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
    try { input.focus(); if (input.select) input.select(); } catch (e) {}
    return input;
  }

  /** 改名 + 把以旧名作键的 `折叠` 状态迁到新名（不迁移 = 改个名折叠全乱） */
  renameSection(i, nv) {
    const sec = this.secs[i];
    if (!sec) return;
    const old = sec.name;
    if (old === nv) return;
    sec.name = nv;
    try {
      const raw = this.cfgGet(K_FOLD, null);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const next = {};
        let hit = false;
        for (const k of Object.keys(raw)) {
          if (k === old) { next[nv] = raw[k]; hit = true; }
          else if (k.indexOf(old + "/") === 0) { next[nv + k.slice(old.length)] = raw[k]; hit = true; }
          else next[k] = raw[k];
        }
        if (hit) this.cfgSet(K_FOLD, next);
      }
    } catch (e) {}
    this.saveState = "板块已改名 → " + nv;
    this.afterChange();
  }

  openCardMenu(card, entry, x, y) {
    this.closeSecMenu();
    this.closeCardMenu();
    const ro = this.readonly();
    const file = entry.file;
    const menu = document.body.createDiv({ cls: "cb-ctxmenu" });
    this.cardMenuEl = menu;

    const run = (fn) => {
      this.closeCardMenu();
      try { fn(); } catch (e) {}
    };
    const item = (label, fn, danger) => {
      const el = menu.createDiv({ cls: "cb-ctx-item" + (danger ? " cb-ctx-danger" : "") });
      el.setText(label);
      el.addEventListener("mousedown", (evt) => evt.stopPropagation());
      el.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        run(fn);
      });
      return el;
    };

    item("在新标签页中打开", () => this.openNote(entry, true));
    item("在新窗口中打开", () => {
      let done = false;
      try {
        const ws = this.app.workspace;
        if (ws && typeof ws.openPopoutLeaf === "function") {
          const leaf = ws.openPopoutLeaf();
          if (leaf && typeof leaf.openFile === "function") {
            leaf.openFile(file);
            done = true;
          }
        }
      } catch (e) {}
      if (!done) this.openNote(entry, true);   // 弹不出窗口就退成新标签
    });
    if (!ro) item("重命名", () => {
      this.cancelClick();
      this.beginRename(card, entry);
    });
    if (!ro) item("将文件移动到…", () => this.promptMoveTo(entry));
    /* R24（boss 第 3 条·文件操作）：把这篇「收起来」/ 放出来（只改视图配置，不动笔记本身） */
    if (this.hiddenOn()) {
      item(this.isHidden(file.path) ? "取消隐藏" : "隐藏这篇", () => this.toggleHidden(file.path));
    }

    const sys = menu.createDiv({ cls: "cb-ctx-sep" });
    item("使用默认应用打开", () => {
      try {
        if (this.app && typeof this.app.openWithDefaultApp === "function") this.app.openWithDefaultApp(file.path);
      } catch (e) {}
    });
    item("在系统资源管理器中显示", () => {
      try {
        if (this.app && typeof this.app.showInFolder === "function") this.app.showInFolder(file.path);
      } catch (e) {}
    });
    item("在文件列表中显示", () => {
      try {
        const ip = this.app && this.app.internalPlugins;
        const fe = ip && typeof ip.getEnabledPluginById === "function" ? ip.getEnabledPluginById("file-explorer") : null;
        if (fe && typeof fe.revealInFolder === "function") fe.revealInFolder(file);
      } catch (e) {}
    });
    if (!ro) item("删除文件（移入系统回收站）", () => {
      try {
        Promise.resolve(this.app.vault.trash(file, true)).then(() => {
          try { new obsidian.Notice("已移入系统回收站：" + file.basename); } catch (e) {}
        }).catch(() => {});
      } catch (e) {}
    }, true);

    const sys2 = menu.createDiv({ cls: "cb-ctx-sep" });
    item("复制路径", () => {
      try {
        Promise.resolve(navigator.clipboard.writeText(file.path)).then(() => {
          try { new obsidian.Notice("已复制路径"); } catch (e) {}
        }).catch(() => {});
      } catch (e) {}
    });

    /* 位置：跟手弹出，clamp 在视口内（尺寸拿不到就按经验值 240×360 估） */
    try {
      const r = menu.getBoundingClientRect();
      const w = r.width || 240;
      const h = r.height || 360;
      const vw = (typeof window !== "undefined" && window.innerWidth) || 1200;
      const vh = (typeof window !== "undefined" && window.innerHeight) || 800;
      menu.style.left = Math.min(Math.max(4, x), Math.max(4, vw - w - 8)) + "px";
      menu.style.top = Math.min(Math.max(4, y), Math.max(4, vh - h - 8)) + "px";
    } catch (e) {}

    /* 点外面 / Esc → 收起（与板块面板同一套机制） */
    this.addOutsideCloser(
      "ctxmenu",
      (t) => (menu.contains ? menu.contains(t) : false),
      () => this.closeCardMenu()
    );
    this.menuEscHandler = (e) => {
      if (e && e.key === "Escape") this.closeCardMenu();
    };
    try {
      document.addEventListener("keydown", this.menuEscHandler, true);
    } catch (e) {}
    return menu;
  }

  /** 「将文件移动到…」：菜单原地变成一行输入（目录必须已存在，不静默建目录） */
  promptMoveTo(entry) {
    const menu = this.cardMenuEl;
    if (!menu) return;
    const file = entry.file;
    menu.empty();
    const row = menu.createDiv({ cls: "cb-ctx-move" });
    row.createSpan({ cls: "cb-ctx-move-hint", text: "移动到目录（须已存在）：" });
    const input = row.createEl("input", { cls: "cb-ctx-move-input", type: "text" });
    input.setAttr("placeholder", cleanFolder(this.defaultFolder()) || "01_新知识库/00_Inbox");
    const done = (commit) => {
      const v = String(input.value || "").trim();
      this.closeCardMenu();
      if (!commit || !v) return;
      const folder = cleanFolder(v);
      const target = folder + "/" + file.name;
      try {
        const exists = this.app.vault.getAbstractFileByPath(folder);
        if (!exists) {
          try { new obsidian.Notice("目录不存在，没动：" + folder); } catch (e) {}
          return;
        }
        Promise.resolve(this.app.fileManager.renameFile(file, target)).then(() => {
          try { new obsidian.Notice("已移动到 " + folder); } catch (e) {}
        }).catch((e2) => {
          try { new obsidian.Notice("移动失败：" + (e2 && e2.message ? e2.message : String(e2))); } catch (e) {}
        });
      } catch (e) {
        try { new obsidian.Notice("移动失败：" + (e && e.message ? e.message : String(e))); } catch (e2) {}
      }
    };
    input.addEventListener("keydown", (evt) => {
      evt.stopPropagation();
      if (evt.key === "Enter") {
        evt.preventDefault();
        done(true);
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        done(false);
      }
    });
    try {
      input.focus();
    } catch (e) {}
  }

  /* ---------- 属性排版：名在上（muted 小字）/ 值在下 ---------- */
  renderProps(card, entry, sec) {
    const names = this.propListFor(sec) || propNamesOf(this.app, entry).slice(0, 5);
    if (!names.length) return null;
    const fm = fmOf(this.app, entry);
    const box = card.createDiv({ cls: "cb-props" });
    for (const key of names) {
      const raw = Object.prototype.hasOwnProperty.call(fm, key) ? fm[key] : undefined;
      const f = fmtProp(raw);
      const row = box.createDiv({ cls: "cb-prop" });
      row.setAttr("data-key", key);
      row.createSpan({ cls: "cb-prop-name", text: key });
      const valEl = row.createSpan({ cls: "cb-prop-val", text: f.text });
      if (f.empty) valEl.addClass("is-empty");
      valEl.setAttr("title", this.readonly() ? "" : "点一下就地改这个属性");
      valEl.addEventListener("click", (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        this.editPropValue(card, entry, key, raw, valEl, row);
      });
    }
    return box;
  }

  /* ---------- 正文懒加载 ---------- */
  renderBodyLazy(card, entry, sec) {
    const chars = this.charsOf(sec);
    const el = card.createDiv({ cls: "cb-body cb-body-loading", text: "滚动到此处自动加载正文…" });
    el.setAttr("title", this.readonly() ? "" : "点一下就地编辑正文");
    const item = { file: entry.file, bodyEl: el, chars, state: "pending", card,
      showYaml: this.yamlOn(sec), showLinks: this.linksOn(sec) };   // R12：YAML / 结尾双链开关
    el.__cbItem = item;
    this.bodyItems.push(item);

    el.addEventListener("click", (evt) => {
      const t = evt.target;
      if (t && t.closest && t.closest("a")) return;    // 正文里的链接照常跳
      if (this.readonly()) return;
      evt.preventDefault();
      evt.stopPropagation();
      /* 第 7 轮：记住点在正文的哪个位置（纵向比例 0~1）
         → 编辑器打开后要滚回同一位置，不许跳到最顶上 */
      let ratio = null;
      try {
        const r = el.getBoundingClientRect();
        if (r && r.height > 0) {
          const v = (evt.clientY - r.top) / r.height;
          if (typeof v === "number" && isFinite(v)) ratio = Math.min(1, Math.max(0, v));
        }
      } catch (e) {}
      /* 第 12 轮：光按比例回滚在长文/复杂排版下偏差大（老板实测点「默认项目」
         却停在旧任务那段）——预览是排版后的 HTML，高度和源码行数**不成比例**。
         改成先取点击处的**文字片段**当锚点，打开后回源码里找这句话，光标直接落上去；
         找不到再退回比例方案。 */
      const anchor = this.textAnchorAt(evt.clientX, evt.clientY);
      /* 第 10 轮：把点击坐标也带上 —— 浮层要在**点的位置附近**弹出，别老在屏幕正中 */
      const pt = {
        x: evt && typeof evt.clientX === "number" && isFinite(evt.clientX) ? evt.clientX : null,
        y: evt && typeof evt.clientY === "number" && isFinite(evt.clientY) ? evt.clientY : null,
      };
      this.mountEditor(card, entry, el, ratio, (pt.x != null || pt.y != null) ? pt : null, anchor);
    });

    if (this.observer) {
      try {
        this.observer.observe(el);
      } catch (e) {}
    }
    return el;
  }

  /** 第 12 轮：取屏幕坐标处的文字片段（caretRangeFromPoint，Electron/Chromium 自带）。
   *  第 13 轮升级：除了片段，还带回**点击处落在片段里的字符偏移**（delta）——
   *  老板要的是「点了 o 的前面，光标就停在 o 前面」，不能只落到行/段开头。
   *  返回 {snippet, delta}；取不出 → null（调用方退回比例方案） */
  textAnchorAt(x, y) {
    try {
      if (typeof x !== "number" || !isFinite(x) || typeof y !== "number" || !isFinite(y)) return null;
      const doc = document;
      let node = null;
      let offset = 0;
      if (typeof doc.caretRangeFromPoint === "function") {
        const r = doc.caretRangeFromPoint(x, y);
        if (r) { node = r.startContainer; offset = r.startOffset; }
      } else if (typeof doc.caretPositionFromPoint === "function") {
        const p = doc.caretPositionFromPoint(x, y);
        if (p) { node = p.offsetNode; offset = p.offset; }
      }
      if (!node) return null;
      if (node.nodeType === 1) {           /* 点在元素边上 → 落到它的文字里 */
        node = node.firstChild || node;
        offset = 0;
      }
      if (node.nodeType !== 3) return null;  /* 不是文本节点 → 放弃 */
      const txt = String(node.textContent || "");
      if (!txt.trim()) return null;
      const WIN = 20;   /* 两侧各最多 20 字 —— 够定位，又不容易撞上源码里的格式符 */
      let a = Math.min(offset, txt.length);
      let b = a;
      while (a > 0 && b - a < WIN * 2 && !/\s/.test(txt.charAt(a - 1))) a--;
      while (b < txt.length && b - a < WIN * 2 && !/\s/.test(txt.charAt(b))) b++;
      const raw = txt.slice(a, b);
      const lead = raw.length - raw.replace(/^\s+/, "").length;   /* 剥掉的前导空白长度 */
      const snip = raw.trim();
      if (snip.length < 2) return null;
      /* 点击字符在**剥完空白后的片段**里的位置（钳在片段内）——源码定位 = 片段起点 + delta */
      const delta = Math.max(0, Math.min(snip.length, offset - a - lead));
      return { snippet: snip, delta };
    } catch (e) {
      return null;
    }
  }

  /** 第 12 轮：把锚点片段落到编辑器 —— 在源码里找这句话（多处命中取最接近比例估计位置的），
   *  光标 + 居中滚动。第 13 轮：光标落在 `片段起点 + delta`（= 点击的那个字符前面）。
   *  找不到 → false（调用方退回比例滚动） */
  applyEditorAnchor(ed, snippet, ratio, delta) {
    if (!ed || typeof ed.getValue !== "function" || typeof ed.scrollIntoView !== "function") return false;
    const val = String(ed.getValue() || "");
    const snip = String(snippet || "");
    if (!val || snip.length < 2) return false;
    const d = Math.max(0, Math.min(snip.length, delta | 0));
    const est = (typeof ratio === "number" && isFinite(ratio))
      ? Math.min(1, Math.max(0, ratio)) * val.length
      : null;
    let best = -1;
    let bestDist = Infinity;
    let i = val.indexOf(snip);
    while (i >= 0) {
      const dist = est == null ? 0 : Math.abs(i - est);
      if (dist < bestDist) { bestDist = dist; best = i; }
      if (est == null) break;
      i = val.indexOf(snip, i + 1);
    }
    if (best < 0) return false;
    let pos = null;
    try { pos = ed.offsetToPos(best + d); } catch (e) { pos = null; }
    if (!pos) return false;
    try { if (typeof ed.setCursor === "function") ed.setCursor(pos); } catch (e) {}
    try { ed.scrollIntoView({ from: pos, to: pos }, true); } catch (e) { return false; }
    return true;
  }

  enqueueBody(item) {
    if (!item || item.state !== "pending") return;
    item.state = "queued";
    this.bodyQueue.push(item);
    this.pumpBody();
  }

  async pumpBody() {
    if (this.bodyPumping) return;
    this.bodyPumping = true;
    try {
      while (this.bodyQueue.length) {
        const item = this.bodyQueue.shift();
        if (!item || item.state !== "queued") continue;
        item.state = "rendering";
        await this.loadBody(item);
        item.state = "done";
        this.updateBar();
      }
    } finally {
      this.bodyPumping = false;
    }
  }

  async loadBody(item) {
    const file = item.file;
    let raw = "";
    try {
      raw = await this.app.vault.cachedRead(file);
    } catch (e) {
      raw = "";
    }
    let body = stripForPreview(raw, file.basename, item.showYaml);
    if (item.showLinks === false) body = cutLinksTail(body);   // R12：板块选择不显示结尾双链
    const rawLen = body.length;
    let truncated = false;
    if (item.chars > 0 && body.length > item.chars) {
      body = body.slice(0, item.chars);
      truncated = true;
    }
    body = balanceFences(body);

    const el = item.bodyEl;
    el.removeClass("cb-body-loading");
    el.empty();
    item.rendered = body;
    el.__cbText = body;   // 第 5 轮：收起编辑器时用它把预览还原回来

    if (!body.trim()) {
      el.createDiv({ cls: "cb-body-empty", text: "（正文为空）" });
      return;
    }
    try {
      if (MarkdownRenderer && typeof MarkdownRenderer.render === "function") {
        await MarkdownRenderer.render(this.app, body, el, file.path, this);
      } else {
        el.createDiv({ cls: "cb-body-error", text: "正文渲染不可用（MarkdownRenderer.render 缺失）" });
      }
    } catch (e) {
      el.empty();
      el.createDiv({ cls: "cb-body-error", text: "正文渲染失败：" + (e && e.message ? e.message : String(e)) });
    }
    if (truncated) {
      el.createDiv({ cls: "cb-body-more", text: "…（已截断 " + item.chars + " 字 / 全文约 " + rawLen + " 字 · 双击卡片看全文）" });
    }
  }

  /* ============================================================
   * 第 3 轮：就地编辑
   * ============================================================ */
  cancelClick() {
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
    this.clickAction = null;
  }

  markDirty(path, on) {
    const set = this.cardEls.get(path);
    if (!set) return;
    for (const card of set) {
      const dot = card.querySelector ? card.querySelector(".cb-dirty") : null;
      if (dot) dot.toggleClass("is-on", !!on);
    }
  }

  /* ---------- 属性：排队 + 防抖 + 原子写 + 冲突提示 ---------- */
  mtimeOf(file) {
    try {
      return file && file.stat ? num(file.stat.mtime, 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  queuePropWrite(entry, key, value) {
    if (this.readonly()) return;
    const path = entry.file.path;
    let p = this.pending.get(path);
    if (!p) {
      /* baseMtime = 排队那一刻的 mtime；落盘前再比一次 → 能看出「编辑期间被外部改过」 */
      p = { file: entry.file, props: {}, timer: null, baseMtime: this.mtimeOf(entry.file) };
      this.pending.set(path, p);
    }
    p.props[key] = value;
    this.markDirty(path, true);
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      p.timer = null;
      this.flushPath(path);
    }, this.debounceMsValue);
    this.updateBar();
    return path;
  }

  async flushPath(path) {
    const p = this.pending.get(path);
    if (!p) return;
    if (p.timer) {
      clearTimeout(p.timer);
      p.timer = null;
    }
    const keys = Object.keys(p.props);
    if (!keys.length) {
      this.pending.delete(path);
      this.updateBar();
      return;
    }
    const props = p.props;
    p.props = {};
    this.pending.delete(path);

    /* 第 4 轮：冲突提示 —— 排队期间文件被外部（坚果云 / OneDrive / 别的编辑器）动过。
       仍然照写，但只覆盖**你改的那几个键**（processFrontMatter 是读最新内容再改），写完明确告知。 */
    const nowM = this.mtimeOf(p.file);
    const conflict = !!(p.baseMtime && nowM && nowM !== p.baseMtime);

    const fmApi = this.app && this.app.fileManager;
    if (!fmApi || typeof fmApi.processFrontMatter !== "function") {
      this.markDirty(path, false);
      this.saveState = "当前版本没有 processFrontMatter，属性改不了";
      new Notice("创作看板：当前 Obsidian 版本没有 fileManager.processFrontMatter，属性改不了");
      this.updateBar();
      return;
    }
    this.writeCount++;
    try {
      /* processFrontMatter 内部走 vault 队列（原子 read-modify-write），双同步库安全 */
      await fmApi.processFrontMatter(p.file, (fm) => {
        if (!fm || typeof fm !== "object") return;
        for (const k of keys) {
          const v = props[k];
          if (v === null || v === undefined) delete fm[k];
          else fm[k] = v;
        }
      });
      this.lastWrite = { path, props: JSON.parse(JSON.stringify(props)), conflict };
      this.markDirty(path, false);
      if (conflict) {
        this.conflicts.add(path);
        this.lastConflict = { path, baseMtime: p.baseMtime, nowMtime: nowM, written: keys.slice() };
        this.saveState = "冲突：" + path + " 编辑期间被外部改过，只覆盖了 " + keys.length + " 个属性";
        new Notice(
          "创作看板：" + str(path).split("/").pop() + " 在你编辑期间被外部改动过（同步客户端？）。\n" +
          "已只覆盖你改的 " + keys.length + " 个属性（" + keys.join(" / ") + "），其余保持外部那一版。",
          8000
        );
      }
      this.updateBar();
    } catch (e) {
      this.markDirty(path, false);
      this.saveState = "属性写入失败：" + (e && e.message ? e.message : String(e));
      console.error("[creation-board] 属性写入失败：", e);
      new Notice("创作看板：属性写入失败（" + (e && e.message ? e.message : e) + "）");
      this.updateBar();
    }
  }

  /** 立刻把所有排队中的写入落盘（onunload 用） */
  flushAll() {
    for (const path of Array.from(this.pending.keys())) {
      try {
        this.flushPath(path);
      } catch (e) {}
    }
  }

  /** 点属性值 → 按类型给控件 → 提交进防抖队列（不立刻写盘） */
  editPropValue(card, entry, key, oldVal, valEl, row) {
    if (this.readonly()) {
      new Notice("创作看板：当前是只读模式（点工具条的 ✎ 打开就地编辑）");
      return null;
    }
    if (row.__cbEditing) return null;
    row.__cbEditing = true;
    this.cancelClick();

    const widget = propWidgetOf(this.app, key);
    const spec = controlFor(widget, oldVal);
    const input = document.createElement(spec.tag);
    input.addClass ? input.addClass("cb-prop-input") : input.classList.add("cb-prop-input");
    input.setAttr ? input.setAttr("type", spec.type) : input.setAttribute("type", spec.type);
    input.setAttr ? input.setAttr("data-kind", spec.kind) : input.setAttribute("data-kind", spec.kind);
    if (spec.kind === "bool") input.checked = !!oldVal;
    else if (spec.kind === "list") input.value = Array.isArray(oldVal) ? oldVal.join(", ") : str(oldVal);
    else input.value = isBlank(oldVal) ? "" : fmtScalar(oldVal);

    const orig = valEl.textContent;
    valEl.empty();
    valEl.appendChild(input);
    row.addClass("is-editing");
    let done = false;

    const commit = () => {
      if (done) return;
      done = true;
      const v = controlValue(spec.kind, input, oldVal);
      row.__cbEditing = false;
      row.removeClass("is-editing");
      const f = fmtProp(v);
      valEl.empty();
      valEl.setText(f.text);
      valEl.toggleClass("is-empty", f.empty);
      this.queuePropWrite(entry, key, v);
    };
    const revert = () => {
      if (done) return;
      done = true;
      row.__cbEditing = false;
      row.removeClass("is-editing");
      valEl.empty();
      valEl.setText(orig);
    };

    /* change 对文本控件＝失焦/回车提交；对复选框＝切换即提交 */
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        revert();
      }
    });
    try {
      input.focus();
      if (input.select) input.select();
    } catch (e) {}
    return input;
  }

  /* ---------- 标题：就地改名 ---------- */
  beginRename(card, entry) {
    if (this.readonly()) {
      this.openNote(entry, false);
      return null;
    }
    const titleEl = card.querySelector ? card.querySelector(".cb-title") : null;
    if (!titleEl || titleEl.__cbRenaming) return null;
    titleEl.__cbRenaming = true;
    const old = entry.file.basename;

    const input = document.createElement("input");
    if (input.addClass) input.addClass("cb-rename-input");
    else input.classList.add("cb-rename-input");
    input.setAttribute("type", "text");
    input.value = old;
    titleEl.style.display = "none";
    if (titleEl.parentNode) titleEl.parentNode.insertBefore(input, titleEl.nextSibling);

    let done = false;
    const cleanup = () => {
      done = true;
      try {
        input.remove();
      } catch (e) {}
      titleEl.style.display = "";
      titleEl.__cbRenaming = false;
    };
    const commit = async () => {
      if (done) return;
      const nv = String(input.value || "").trim();
      if (!nv || nv === old) {
        cleanup();
        return;
      }
      if (/[\\/:*?"<>|#^\[\]]/.test(nv)) {
        new Notice('创作看板：文件名不能包含 \\ / : * ? " < > | # ^ [ ]');
        cleanup();
        return;
      }
      cleanup();
      const parent = entry.file.parent ? entry.file.parent.path : "";
      const newPath = (parent ? parent + "/" : "") + nv + ".md";
      if (newPath === entry.file.path) return;
      try {
        await this.app.fileManager.renameFile(entry.file, newPath);
        this.lastRename = { from: entry.file.path, to: newPath };
        this.saveState = "已改名 → " + newPath;
      } catch (e) {
        new Notice("创作看板：改名失败（" + (e && e.message ? e.message : e) + "）");
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
      }
    });
    try {
      input.focus();
      if (input.select) input.select();
    } catch (e) {}
    return input;
  }

  /* ============================================================
   * 第 5 轮：统一的「点外面就收起」
   * 板块面板 与 就地编辑器 共用一套（登记 → 文档 mousedown 分发）
   * ============================================================ */
  addOutsideCloser(id, test, close) {
    this.outsiders.set(id, { test, close });
    return id;
  }
  removeOutsideCloser(id) {
    this.outsiders.delete(id);
  }
  handleOutside(evt) {
    const t = evt && evt.target;
    if (!t || t.nodeType !== 1) return;
    for (const pair of Array.from(this.outsiders.entries())) {
      const o = pair[1];
      let inside = true;
      try {
        inside = !!o.test(t);
      } catch (e) {
        inside = true;   // 判断本身出错就别乱收
      }
      if (!inside) {
        try {
          o.close(evt);
        } catch (e) {}
      }
    }
  }

  /* ---------- 正文：就地挂真编辑器（第 7 轮：做成脱离卡片的浮层小窗） ---------- */
  async mountEditor(card, entry, hostEl, yRatio, openPt, anchor) {
    if (this.readonly()) return null;
    const host = hostEl || (card && card.querySelector ? card.querySelector(".cb-body") : null);
    if (!host) return null;
    if (host.__cbEditor) return host.__cbEditor;

    this.unmountEditor(false);
    const WS = obsidian.WorkspaceLeaf;
    const MV = obsidian.MarkdownView;
    if (!WS || !MV) {
      this.lastEditorMount = "unsupported:" + entry.file.path;
      this.openNote(entry, false);
      return null;
    }

    let leaf = null;
    let view = null;
    try {
      leaf = new WS(this.app);
      view = new MV(leaf);
      if (typeof leaf.open === "function") await leaf.open(view);
      if (typeof view.loadFile === "function") await view.loadFile(entry.file);

      this.editorText = typeof host.__cbText === "string" ? host.__cbText : null;
      this.editorProps = !!(card && card.__cbHasProps);
      /* 第 7 轮：卡片预览**保留**（不再 empty），只调淡 + 停掉点击 —— 编辑都去浮层里做 */

      /* ① 浮层本体：挂在 document.body 上，position:fixed
            （.cb-root 自己在滚，卡片里放绝对定位会被裁掉 —— 所以必须脱离文档流挂到顶层） */
      const pop = document.body.createDiv({ cls: "cb-ed-pop" });

      /* ② 小标题条：说明挂的是谁 + 一个明确的「收起」 */
      const bar = pop.createDiv({ cls: "cb-ed-bar" });
      bar.createSpan({ cls: "cb-ed-name", text: "✎ " + entry.file.basename });
      const x = bar.createEl("button", { cls: "cb-ed-close", text: "✕ 收起" });
      x.setAttr("title", "收起编辑器（按 Esc 也行）");
      x.addEventListener("mousedown", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
      });
      x.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.closeEditor();
      });

      /* ③ 内容盒：占满浮层剩余高度，自己上下滚 */
      const box = pop.createDiv({ cls: "cb-ed-box" });
      /* containerEl 自带 .view-header（← → 🔗 ⋮）→ 交给 CSS 藏掉，别占地方 */
      if (view.containerEl) box.appendChild(view.containerEl);

      if (this.editorProps) pop.addClass("cb-hidepros");   // 卡片上已有属性 → 浮层里那份不再重复显示
      host.addClass("is-editing");

      /* ③½ 第 10 轮：浮层**在点击位置附近**弹出（中心=点击点，clamp 在视口内）；
            坐标推不出（jsdom / 键盘触发）→ 保持样式里的居中不动 */
      try {
        if (openPt && openPt.x != null && openPt.y != null) {
          const r = pop.getBoundingClientRect();
          const w = r.width || 0;
          const h = r.height || 0;
          const vw = (typeof window !== "undefined" && window.innerWidth) || 1200;
          const vh = (typeof window !== "undefined" && window.innerHeight) || 800;
          const cx = Math.min(Math.max(openPt.x, w / 2 + 8), Math.max(vw - w / 2 - 8, w / 2 + 8));
          const cy = Math.min(Math.max(openPt.y, h / 2 + 8), Math.max(vh - h / 2 - 8, h / 2 + 8));
          pop.style.left = cx + "px";
          pop.style.top = cy + "px";
          this.editorOpenPt = { x: cx, y: cy };
        } else {
          this.editorOpenPt = null;
        }
      } catch (e) {
        this.editorOpenPt = null;
      }

      host.__cbEditor = { leaf, view, box, bar, pop };
      this.editorFor = entry.file.path;
      this.editorHost = host;
      this.lastEditorMount = entry.file.path;

      /* ⑦ 第 8 轮：浮层里「笔记属性」默认折叠（老板：这个视角下属性默认折叠）
            原生机制已在 asar 核实：.metadata-container 的 is-collapsed 类由原生 CSS
            隐藏属性行（.metadata-container.is-collapsed .metadata-property{display:none}），
            标题条点击 → 内部 setCollapse 翻转。这里等属性块渲染出来后**替用户点一下
            原生标题钮**——状态与内部标志同步，之后点标题可正常展开/收起，不吃两下。
            （卡片已显示属性时整块被 cb-hidepros 藏掉，没必要折）。 */
      /* 🔴 R9：属性默认展开 → 这段「替用户折一下」只在把视图选项「属性默认展开」关掉时才跑。 */
      if (!this.editorProps && !this.propsOpenOn(card ? card.__cbSec : null)) {
        try {
          let tries = 0;
          const foldTimer = setInterval(() => {
            tries++;
            let meta = null;
            try { meta = box.querySelector(".metadata-container"); } catch (e) {}
            if (meta && !(meta.hasClass && meta.hasClass("is-collapsed"))) {
              clearInterval(foldTimer);
              const head = meta.querySelector(".metadata-properties-heading");
              if (head) {
                try {
                  head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                } catch (e2) {
                  meta.addClass && meta.addClass("is-collapsed");   /* 兜底：直接上原生类 */
                }
              } else {
                meta.addClass && meta.addClass("is-collapsed");     /* 没找到标题 → 兜底 */
              }
            } else if (meta || tries > 40) {   /* 折好了 / ~2s 还没渲染（可能没属性）→ 收工 */
              clearInterval(foldTimer);
            }
          }, 50);
          host.__cbEditor.foldTimer = foldTimer;
        } catch (e) {}
      }

      /* ④ 别跳顶：按点击位置把编辑器滚回去，再把焦点放进去
            （老板：点开编辑会先跳到文本最顶上，没法从点的位置接着写）
            🔴 第 11 轮改轮询：loadFile 返回时 CodeMirror 往往还没排版完，
            scrollHeight≈0 → 一次设置等于没设（真机上就是「跳回开头」的根因）。
            等它量出高度（scrollHeight > clientHeight）再设，最多等 ~1s。
            🔴 第 12 轮升级：比例对齐在长文/复杂排版下偏差大（预览高度 ≠ 源码高度），
            优先用**文字锚点**——在源码里找点击处那句话，光标直接落上去（居中滚动）；
            锚点落空才退回比例方案。 */
      try {
        const ratio = (typeof yRatio === "number" && isFinite(yRatio))
          ? Math.min(1, Math.max(0, yRatio))
          : null;
        /* 第 13 轮：anchor 变成 {snippet, delta}（带点击字符偏移）；旧的纯字符串照吃（delta=0） */
        const aObj = anchor && typeof anchor === "object"
          ? anchor
          : (typeof anchor === "string" && anchor.length >= 2 ? { snippet: anchor, delta: 0 } : null);
        const anchorTxt = aObj && aObj.snippet && String(aObj.snippet).length >= 2 ? String(aObj.snippet) : null;
        const anchorDelta = aObj ? (aObj.delta | 0) : 0;
        this.editorOpenRatio = ratio;
        this.editorAnchorUsed = null;   // 诊断/测试：最终用的锚点（落空为 null）
        if (ratio != null || anchorTxt) {
          let tries = 0;
          const scrollTimer = setInterval(() => {
            tries++;
            let sd = null;
            try {
              const ed = view.editor;
              sd = ed && ed.cm && ed.cm.scrollDOM;
            } catch (e) {}
            if (sd && sd.scrollHeight > sd.clientHeight) {
              clearInterval(scrollTimer);
              try {
                if (host.__cbEditor) host.__cbEditor.scrollTimer = null;
              } catch (e) {}
              let done = false;
              if (anchorTxt) {
                try { done = this.applyEditorAnchor(view.editor, anchorTxt, ratio, anchorDelta); } catch (e) { done = false; }
                if (done) this.editorAnchorUsed = anchorTxt;
              }
              if (!done && ratio != null) {
                sd.scrollTop = Math.round(ratio * (sd.scrollHeight - sd.clientHeight));
              }
              try {
                const ed2 = view.editor;
                if (ed2 && typeof ed2.focus === "function") ed2.focus();
              } catch (e) {}
            } else if (tries > 40) {
              clearInterval(scrollTimer);
              try {
                if (host.__cbEditor) host.__cbEditor.scrollTimer = null;
              } catch (e) {}
            }
          }, 25);
          if (host.__cbEditor) host.__cbEditor.scrollTimer = scrollTimer;
          const ed0 = view.editor;
          if (ed0 && typeof ed0.focus === "function") {
            try { ed0.focus(); } catch (e2) {}
          }
        }
      } catch (e) {}

      /* ⑤ Esc 收起 */
      this.escHandler = (e) => {
        if (e && e.key === "Escape") this.closeEditor();
      };
      try {
        document.addEventListener("keydown", this.escHandler, true);
      } catch (e) {}

      /* ⑥ 点浮层外面也收起（与板块面板同一套机制）。
            「里面」的判定 = 浮层本体。卡片预览那会儿已被 pointer-events 关掉，
            点它等于点浮层外面 → 收起，行为符合直觉 */
      this.addOutsideCloser(
        "editor",
        (t) => (pop.contains ? pop.contains(t) : false),
        () => this.closeEditor()
      );
      return host.__cbEditor;
    } catch (e) {
      console.warn("[creation-board] 就地编辑器挂载失败，降级为打开笔记：", e);
      if (leaf && typeof leaf.detach === "function") {
        try {
          leaf.detach();
        } catch (e2) {}
      }
      this.lastEditorMount = "fallback:" + entry.file.path;
      this.openNote(entry, false);
      return null;
    }
  }

  unbindEsc() {
    if (!this.escHandler) return;
    try {
      document.removeEventListener("keydown", this.escHandler, true);
    } catch (e) {}
    this.escHandler = null;
  }

  /** ✕ / Esc / 点外面 → 收起编辑器，并把正文预览还原回来 */
  closeEditor() {
    if (!this.editorHost) return false;
    const path = this.editorFor;
    this.unmountEditor(true);
    this.closedEditor = path;
    return true;
  }

  /** restore=true 才还原预览（收起编辑器用）；拆视图/重渲染传 false */
  unmountEditor(restore) {
    const host = this.editorHost;
    const text = this.editorText;
    this.removeOutsideCloser("editor");
    this.unbindEsc();
    if (host) {
      const ed = host.__cbEditor;
      try {
        if (ed && ed.leaf && typeof ed.leaf.detach === "function") {
          /* R15 修：detach 前把编辑器缓冲冲一次盘 —— MarkdownView 自带防抖保存，
           * 恰好在窗口内拆视图会丢最后几秒输入（fire-and-forget，不阻塞收尾） */
          try {
            const mv = ed.leaf.view;
            if (mv && typeof mv.save === "function") Promise.resolve(mv.save()).catch(() => {});
          } catch (e0) {}
          ed.leaf.detach();
        }
      } catch (e) {}
      /* 第 7 轮：浮层挂在 document.body 上 → 收起时要亲手摘掉，别留孤儿 */
      try {
        if (ed && ed.pop && ed.pop.parentNode) ed.pop.parentNode.removeChild(ed.pop);
      } catch (e) {}
      /* 第 8 轮：「默认折叠属性」的轮询定时器也一并清掉（不留悬挂） */
      try {
        if (ed && ed.foldTimer) clearInterval(ed.foldTimer);
      } catch (e) {}
      /* 第 11 轮：「滚回点击位置」的轮询定时器同样清掉 */
      try {
        if (ed && ed.scrollTimer) clearInterval(ed.scrollTimer);
      } catch (e) {}
      try {
        delete host.__cbEditor;
      } catch (e) {}
      host.removeClass && host.removeClass("is-editing");
      if (restore) {
        if (text == null) {
          /* 正文本来还没懒加载出来 → 还原成「待加载」，并重新挂上观察者 */
          try {
            host.setText("滚动到此处自动加载正文…");
            host.addClass && host.addClass("cb-body-loading");
          } catch (e) {}
          const item = host.__cbItem;
          if (item && item.state !== "done") {
            item.state = "pending";
            item.bodyEl = host;
            if (this.observer) {
              try {
                this.observer.observe(host);
              } catch (e) {}
            }
          }
        } else {
          /* 第 7 轮：浮层里可能已经改过字 —— 异步重读**落盘后的最新内容**
             覆盖回预览（编辑器自动保存有延迟，读不到就维持现状，不吃报错） */
          let askedFresh = false;
          try {
            const item = host.__cbItem;
            const f = item && item.file;
            const srcPath = f ? f.path : "";
            if (f && this.app && this.app.vault && typeof this.app.vault.cachedRead === "function") {
              Promise.resolve(this.app.vault.cachedRead(f)).then((t2) => {
                try {
                  if (typeof t2 === "string") {
                    host.empty();
                    this.renderBodyInto(host, t2, srcPath);
                  }
                } catch (e3) {}
              }).catch(() => {});
              askedFresh = true;
            }
          } catch (e) {}
          /* 预览在编辑期间本来就没被清掉 → 不重渲染也不会开天窗 */
          if (!askedFresh) {
            try {
              host.removeClass && host.removeClass("cb-body-loading");
            } catch (e) {}
          }
        }
      }
    }
    this.editorHost = null;
    this.editorFor = null;
    this.editorText = null;
    this.editorProps = false;
    this.editorOpenRatio = null;
    this.editorOpenPt = null;
  }

  /** 把一段正文重新渲染进容器（收起编辑器后还原预览） */
  renderBodyInto(el, text, srcPath) {
    if (!el) return;
    if (text == null || !String(text).trim()) {
      try {
        el.createDiv({ cls: "cb-body-empty", text: "（正文为空）" });
      } catch (e) {}
      return;
    }
    /* R15 修：sourcePath 由调用方显式传 —— 还原预览走异步 cachedRead，resolve 时
     * editorFor 已被清空，相对链接会按库根解析（点错/破图） */
    const path = srcPath || this.editorFor || "";
    try {
      if (MarkdownRenderer && typeof MarkdownRenderer.render === "function") {
        Promise.resolve(MarkdownRenderer.render(this.app, text, el, path, this)).catch((e) => {
          try {
            el.empty();
            el.createDiv({ cls: "cb-body-error", text: "正文渲染失败：" + (e && e.message ? e.message : String(e)) });
          } catch (e2) {}
        });
        return;
      }
    } catch (e) {}
    try {
      el.createDiv({ cls: "cb-body-error", text: "正文渲染不可用（MarkdownRenderer.render 缺失）" });
    } catch (e) {}
  }

  openNote(entry, newTab) {
    try {
      this.app.workspace.openLinkText(entry.file.path, "", newTab ? "tab" : false);
      this.lastOpen = entry.file.path;
    } catch (e) {}
  }

  updateBar() {
    const total = this.data && Array.isArray(this.data.data) ? this.data.data.length : 0;
    const nSec = this.sections.length;
    const nSub = this.sections.reduce((a, s) => a + s.children.length, 0);
    const catchOn = this.optBool(K_CATCH, this.pluginCatchDefault());
    const nCatch = this.secs.filter((s) => s.source === "catchall").length;
    const ro = this.readonly();
    this.modeEl.setText(this.mode || "");
    if (this.roBtn) {
      this.roBtn.setText(ro ? "🔒 只读" : "✎ 可编辑");
      this.roBtn.toggleClass("is-on", ro);
    }
    let txt =
      "共 " + total + " 篇 · " + nSec + " 个板块" +
      (nSub ? "（含 " + nSub + " 个子板块）" : "") +
      (nCatch && !catchOn ? " · 收容所已隐藏" : "");
    /* 护栏可见化：不静默截断，被挡掉多少篇直接写出来 */
    if (this.excludedCount) txt += " · 排除目录挡掉 " + this.excludedCount + " 篇";
    if (this.cappedCount) txt += " · 超总上限截断 " + this.cappedCount + " 篇";
    if (this.bodyItems.length) {
      const done = this.bodyItems.filter((i) => i.state === "done").length;
      txt += " · 正文 " + done + "/" + this.bodyItems.length;
    }
    const pendingN = this.pending ? this.pending.size : 0;
    if (pendingN) txt += " · 待落盘 " + pendingN;
    if (this.conflicts && this.conflicts.size) txt += " · ⚠外部改动 " + this.conflicts.size;
    if (ro) txt += " · 只读";
    this.countEl.setText(txt);
  }

  /* ============================================================
   * 第 4 轮：板块级「＋」新建
   * ------------------------------------------------------------
   * 契约（逐条核实过，不是猜的）：
   *   · vault.create(path, "") —— 建一个**空** .md。Templater 的目录模板只在
   *     「新建 + 剥前言后正文为空」时套用 → 这里**必须**给空串，给了字就套不上了
   *   · 目标目录不存在要先 createFolder，vault.create 不会替你建目录（会直接抛）
   *   · `newItemTemplate`（base 顶层）只抄 frontmatter、正文永远为空
   *     → 套哪个模板 100% 由**落点目录**决定（这正是我们要的效果）
   * ============================================================ */
  defaultFolder() {
    const fromBase = this.baseNewItemFolder();
    if (fromBase) return fromBase;
    return cleanFolder(PLUGIN_SETTINGS.newNoteFolder) || "";
  }

  /** base 顶层的 `newItemFolder`（老板的库在 .base 里写了 01_新知识库/00_Inbox）
   *  三个来源都试一遍：视图 config.get → config.data → config.query.data */
  baseNewItemFolder() {
    const c = this.config;
    const cands = [];
    try { if (c && typeof c.get === "function") cands.push(c.get("newItemFolder")); } catch (e) {}
    try { if (c && c.data) cands.push(c.data.newItemFolder); } catch (e) {}
    try { if (c && c.query && c.query.data) cands.push(c.query.data.newItemFolder); } catch (e) {}
    for (const v of cands) if (typeof v === "string" && v.trim()) return cleanFolder(v);
    return "";
  }

  /** 标签路由表（懒加载一次）。返回 {folder, why}
   *  命中顺序 = 标签段（逐级前缀回退）→ 领域段 →（可选）领域兜底 → 空（调用方用默认落点） */
  async mappingForTag(tag) {
    const t = normTag(tag);
    if (!t) return "";
    if (this.mappingCache === null) {
      let txt = "";
      try {
        const f = this.app.vault.getAbstractFileByPath(MAPPING_PATH);
        if (f) txt = await this.app.vault.cachedRead(f);
        else if (this.app.vault.adapter && typeof this.app.vault.adapter.read === "function") {
          txt = await this.app.vault.adapter.read(MAPPING_PATH);
        }
      } catch (e) {
        txt = "";
      }
      let obj = null;
      try {
        obj = txt ? JSON.parse(txt) : null;
      } catch (e) {
        obj = null;
      }
      this.mappingCache = obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
    }
    const m = this.mappingCache;
    const table = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});
    const take = (o, k) => (typeof o[k] === "string" && o[k].trim() ? cleanFolder(o[k]) : "");
    /* ① 标签段（逐级回退：#内容创作/视频 → #内容创作） */
    const tagTable = table(m[MAP_TAG]);
    const segs = t.split("/").filter(Boolean);
    for (let n = segs.length; n >= 1; n--) {
      const key = segs.slice(0, n).join("/");
      const hit = take(tagTable, key);
      if (hit) return { folder: hit, why: "标签段 " + key };
    }
    /* ② 领域段 */
    const domHit = take(table(m[MAP_DOMAIN]), t);
    if (domHit) return { folder: domHit, why: "领域段 " + t };
    /* ③ 「领域兜底」默认**不**用（见文件头 USE_DOMAIN_FALLBACK 的说明） */
    if (USE_DOMAIN_FALLBACK) {
      const fb = take(m, "领域兜底");
      if (fb) return { folder: fb, why: "领域兜底 " + fb };
    }
    return { folder: "", why: "" };
  }

  /** 这个板块该把新笔记放哪 —— 返回 {folder, why}；why 会进 Notice，便于当场核对 */
  async targetFolderOf(sec, childName) {
    const c = this.specOf(sec) || {};
    const dflt = this.defaultFolder();
    if (c.source === "folder" && c.path) return { folder: c.path, why: "板块目录" };
    if (c.source === "tag" && c.tag) {
      const hit = await this.mappingForTag(c.tag);
      if (hit && hit.folder) return { folder: hit.folder, why: "标签路由表 · " + hit.why };
      return { folder: dflt, why: "标签 #" + c.tag + " 不在路由表 → 默认落点" };
    }
    if (c.source === "folder") return { folder: dflt, why: "板块没选目录 → 默认落点" };
    if (c.source === "formula") {
      return { folder: dflt, why: "公式板块「" + (childName || c.formula || "") + "」定位不到目录 → 默认落点" };
    }
    return { folder: dflt, why: "默认落点" };
  }

  /** 撞名就加序号（未命名.md → 未命名 2.md → …） */
  async uniquePath(folder, baseName) {
    const name = sanitizeName(baseName) || "未命名";
    const pre = folder ? folder + "/" : "";
    let p = pre + name + ".md";
    let n = 1;
    while (n < 200 && this.app.vault.getAbstractFileByPath(p)) {
      n++;
      p = pre + name + " " + n + ".md";
    }
    return p;
  }

  /** 「＋」入口：算落点 → 建空文件 → 插临时卡片 → 轮询等真卡片 */
  async createInSection(sec, childName, gridEl) {
    if (this.readonly()) {
      new Notice("创作看板：只读模式下不能新建（点工具条 ✎ 打开就地编辑）");
      return null;
    }
    const res = await this.targetFolderOf(sec, childName);
    let folder = res.folder || "";
    try {
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    } catch (e) {
      folder = this.defaultFolder();
    }
    const path = await this.uniquePath(folder, PLUGIN_SETTINGS.newNoteName || "未命名");
    try {
      /* 空内容 → Templater 的目录模板会在 create 事件里套上 */
      await this.app.vault.create(path, "");
    } catch (e) {
      this.lastCreate = { path, folder, ok: false, error: String(e && e.message ? e.message : e) };
      new Notice("创作看板：新建失败（" + (e && e.message ? e.message : e) + "）");
      this.updateBar();
      return null;
    }
    this.lastCreate = { path, folder, why: res.why, ok: true, bytes: 0 };
    new Notice("创作看板：已新建 " + path + "\n落点依据：" + res.why, 5000);
    this.insertTempCard(gridEl, path);
    this.scheduleReveal(path);
    this.updateBar();
    return path;
  }

  renderAddBtn(headEl, sec, gridEl, childName) {
    const spec = this.specOf(sec);
    const btn = headEl.createEl("button", { cls: "cb-plus", text: "＋" });
    btn.setAttr("data-sec", spec ? spec.name : "");
    if (childName) btn.setAttr("data-child", childName);
    const ro = this.readonly();
    btn.toggleClass("is-off", ro);
    btn.setAttr(
      "title",
      ro
        ? "只读模式：先点工具条的 ✎ 才能新建"
        : "在这个板块新建一篇（新建" + (spec ? "「" + spec.name + "」" : "") +
          "：" + (spec && spec.source === "folder" && spec.path ? "落板块目录" :
            spec && spec.source === "tag" && spec.tag ? "查标签路由表 #" + spec.tag : "落默认目录") +
          "；空文件交给 Templater 目录模板）"
    );
    btn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      this.createInSection(sec, childName, gridEl);
    });
    return btn;
  }

  insertTempCard(gridEl, path) {
    if (!gridEl) return null;
    const base = str(path).split("/").pop().replace(/\.md$/, "");
    const el = gridEl.createDiv({ cls: "cb-card cb-card-temp" });
    el.setAttr("data-path", path);
    el.createEl("a", { cls: "internal-link cb-title", text: base });
    el.createDiv({ cls: "cb-hint", text: "刚建好 · 等 Obsidian 刷新成正式卡片" });
    try {
      if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
    } catch (e) {}
    return el;
  }

  /** 轮询：真条目出现 → 高亮 + 滚过去；超时如实说「这个视图的过滤条件不显示它」。
   *  R15：定时器 id 挂实例（revealTimer），onunload 清掉 —— 原来关视图后 tick 还会
   *  跑满 10 轮，超时分支对着已关闭的视图弹假 Notice。 */
  scheduleReveal(path) {
    this.revealPath = path;
    this.revealTries = 0;
    if (this.revealTimer) { clearTimeout(this.revealTimer); this.revealTimer = null; }
    const tick = () => {
      this.revealTimer = null;
      if (this.revealPath !== path || this.__cbUnloaded) return;
      this.revealTries++;
      const set = this.cardEls.get(path);
      if (set && set.size) {
        for (const el of set) {
          el.addClass("is-new");
          try {
            if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
          } catch (e) {}
        }
        this.revealPath = null;
        const clear = () => {
          for (const el of set) el.removeClass("is-new");
        };
        setTimeout(clear, 6000);
        return;
      }
      if (this.revealTries >= this.revealTriesMax) {
        this.revealPath = null;
        this.saveState = "刚建：" + path + "（当前过滤条件不显示它）";
        new Notice("创作看板：笔记已建好（" + path + "），但这个视图现在的过滤条件不显示它 —— 去文件树能看到。", 8000);
        this.updateBar();
        return;
      }
      this.revealTimer = setTimeout(tick, this.revealDelayValue);
    };
    this.revealTimer = setTimeout(tick, this.revealDelayValue);
  }

  /* ============================================================
   * 第 4 轮：配置复制 / 导入
   * 走**文本框**而不是纯剪贴板：不依赖剪贴板权限，且 100% 可离线验
   * ============================================================ */
  exportConfig() {
    const view = {};
    view[K_WIDTH] = this.optNum(K_WIDTH, 240);
    view[K_FILL] = this.optBool(K_FILL, true);
    view[K_DUP] = this.optBool(K_DUP, true);
    /* 只导出「显式设过」的收容所开关，避免把插件默认误固化进 .base */
    if (this.cfgGet(K_CATCH, undefined) !== undefined) view[K_CATCH] = this.optBool(K_CATCH, this.pluginCatchDefault());
    view[K_PROPS] = this.cfgGet(K_PROPS, "");
    view[K_BODY] = this.optBool(K_BODY, false);
    view[K_YAML] = this.optBool(K_YAML, false);
    view[K_LINKS] = this.optBool(K_LINKS, true);
    view[K_MOVE] = this.optBool(K_MOVE, true);
    view[K_CHARS] = this.optNum(K_CHARS, DEFAULT_CHARS);
    view[K_RO] = this.readonly();
    view[K_PROS_OPEN] = this.optBool(K_PROS_OPEN, true);   /* R15 修：原来配置搬运会丢这一项 */
    view[K_EXCLUDE] = this.cfgGet(K_EXCLUDE, "");
    view[K_CAP] = this.optNum(K_CAP, 0);
    view[K_HIDDEN_ON] = this.optBool(K_HIDDEN_ON, true);
    view[K_HIDDEN_SHOW] = this.optBool(K_HIDDEN_SHOW, false);
    view[K_HIDDEN] = this.hiddenPaths();
    return JSON.stringify({ _版本: 4, 视图: view, 板块: this.secs.map(sectionToRaw) }, null, 2);
  }

  copyConfig() {
    const txt = this.exportConfig();
    this.ioText = txt;
    this.ioState = "已生成 " + txt.length + " 字符（剪贴板不可用时，手动全选复制这段）";
    let clip = null;
    try {
      clip = navigator.clipboard;
    } catch (e) {
      clip = null;
    }
    if (clip && typeof clip.writeText === "function") {
      try {
        const p = clip.writeText(txt);
        if (p && typeof p.then === "function") {
          p.then(
            () => {
              this.ioState = "已复制到剪贴板 + 文本框";
              this.renderPanel();
            },
            () => {
              this.renderPanel();
            }
          );
        } else {
          this.ioState = "已复制到剪贴板 + 文本框";
        }
      } catch (e) {
        /* 保持 ioState */
      }
    } else {
      this.ioState = "当前环境没有剪贴板 API → 已放进下面的文本框";
    }
    this.renderPanel();
    return txt;
  }

  async pasteConfig() {
    let clip = null;
    try {
      clip = navigator.clipboard;
    } catch (e) {
      clip = null;
    }
    if (!clip || typeof clip.readText !== "function") {
      this.ioState = "当前环境没有剪贴板 API → 请手动粘贴到下面的文本框";
      this.renderPanel();
      return "";
    }
    try {
      const t = await clip.readText();
      this.ioText = str(t);
      this.ioState = "已从剪贴板填入 " + this.ioText.length + " 字符";
    } catch (e) {
      this.ioState = "读剪贴板失败：" + (e && e.message ? e.message : e);
    }
    this.renderPanel();
    return this.ioText;
  }

  /** 应用文本框里的配置 —— 认 {板块:[…]} 或裸数组；**任何一项不合格就整批不写** */
  applyConfig() {
    const txt = str(this.ioText).trim();
    if (!txt) {
      this.ioState = "文本框是空的";
      this.renderPanel();
      return 0;
    }
    let obj = null;
    try {
      obj = JSON.parse(txt);
    } catch (e) {
      this.ioState = "不是合法 JSON：" + (e && e.message ? e.message : e);
      this.renderPanel();
      return 0;
    }
    let rawSecs = null;
    let view = null;
    if (Array.isArray(obj)) rawSecs = obj;
    else if (obj && typeof obj === "object" && Array.isArray(obj["板块"])) {
      rawSecs = obj["板块"];
      view = obj["视图"] && typeof obj["视图"] === "object" ? obj["视图"] : null;
    }
    if (!rawSecs) {
      this.ioState = "不认这个结构（要 {板块:[…]} 或直接给数组）";
      this.renderPanel();
      return 0;
    }
    for (let i = 0; i < rawSecs.length; i++) {
      const r = rawSecs[i];
      if (!r || typeof r !== "object" || Array.isArray(r)) {
        this.ioState = "第 " + (i + 1) + " 项不是对象 → 整批不写";
        this.renderPanel();
        return 0;
      }
    }
    const secs = rawSecs.map((r, i) => normalizeSection(r, i));
    const nCatch = secs.filter((s) => s.source === "catchall").length;
    if (nCatch > 1) {
      this.ioState = "有 " + nCatch + " 个收容所（只能一个）→ 整批不写";
      this.renderPanel();
      return 0;
    }
    this.secs = secs;
    this.editIdx = -1;
    this.confirmIdx = -1;
    this.persist();
    if (view) {
      const kinds = {};
      kinds[K_WIDTH] = "num"; kinds[K_DUP] = "bool"; kinds[K_CATCH] = "bool"; kinds[K_PROPS] = "raw";
      kinds[K_BODY] = "bool"; kinds[K_CHARS] = "num"; kinds[K_RO] = "bool";
      kinds[K_EXCLUDE] = "raw"; kinds[K_CAP] = "num"; kinds[K_FILL] = "bool"; kinds[K_PROS_OPEN] = "bool";
      kinds[K_HIDDEN_ON] = "bool"; kinds[K_HIDDEN_SHOW] = "bool"; kinds[K_HIDDEN] = "raw";
      for (const k of Object.keys(view)) {
        const kind = kinds[k];
        if (!kind) continue;
        const v = view[k];
        if (kind === "bool") this.cfgSet(k, v === true || v === "true");
        else if (kind === "num") {
          const n = parseFloat(v);
          if (isFinite(n)) this.cfgSet(k, n);
        } else this.cfgSet(k, str(v));
      }
    }
    this.ioState = "已应用 " + secs.length + " 个板块" + (view ? " + 视图选项" : "");
    this.repaint(false);
    return secs.length;
  }

  /* ============================================================
   * 板块设置面板
   * ============================================================ */
  /** R22：收起悬浮设置窗 —— ✕ / 点遮罩 / 点窗外 / 再点一下 ⚙，四条路都走这儿 */
  closePanel() {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    this.editIdx = -1;
    this.addOpen = false;
    this.confirmIdx = -1;
    this.renderPanel();
  }

  renderPanel() {
    if (!this.panelEl) return;
    this.panelEl.toggleClass("is-hidden", !this.panelOpen);
    if (this.maskEl) this.maskEl.toggleClass("is-hidden", !this.panelOpen);
    if (!this.panelOpen) return;
    this.panelBodyEl.empty();
    this.panelMsgEl.setText(this.saveState || "");
    this.panelMsgEl.toggleClass("is-err", /失败|不能|冲突/.test(this.saveState || ""));

    /* R20 需求4-②（boss：重新设计、大幅简化、改成开关样式、无冗余文字说明）：
     * 面板只分三段 —— 「看板行为 / 板块 / 高级」。开关一律原生胶囊
     * （.cb-opt .checkbox-container，样式见 styles_src/cb.css），
     * 所有解释性文字降级成 title 悬浮提示，面板正文里不铺小字。 */
    /* R21（boss 拍板「先做视图级」）：「卡片最小宽度」「空位铺满整行」从 Base 的
     * 视图选项面板挪到这儿、并成一行 —— 原生视图选项面板一条 descriptor 只占一行，
     * 合不成「文件宽度 [拉杆] 240 px  自动 [开关]」。键与语义一个没变（K_WIDTH / K_FILL）。 */
    const cardBox = this.addGroup("卡片");
    this.addWidthRow(cardBox);

    const behBox = this.addGroup("看板行为");
    this.addToggle(behBox, K_DUP, true, "允许重复", "一条笔记可以同时出现在多个板块里");
    this.addToggle(
      behBox, K_CATCH, this.pluginCatchDefault(), "显示收容所",
      "未被任何板块命中的笔记归到「收容所」板块。没单独设过时跟随插件设置（插件里现在=" +
        (this.pluginCatchDefault() ? "显示" : "隐藏") + "）"
    );
    this.addToggle(behBox, K_BODY, false, "显正文", "板块没单独指定正文开关时的默认值");
    /* R23（boss：加一个开关控制笔记的属性是否默认展开）：键还是老的 K_PROS_OPEN（R9 就有），
     * 只是从原生视图选项面板挪到这儿 —— 挨着「显正文」（一个管正文、一个管属性）。 */
    this.addToggle(behBox, K_PROS_OPEN, true, "属性默认展开",
      "卡片 / 就地编辑浮层里的属性区默认展开；关 = 默认折叠（每张卡片上的「属性 ▸」仍可单独展开）");
    this.addToggle(behBox, K_RO, false, "只读", "关掉看板上全部就地编辑（＝顶栏那把锁）");

    const secBox = this.addGroup("板块");
    const list = secBox.createDiv({ cls: "cb-panel-list" });
    if (this.secs.length === 0) {
      list.createDiv({ cls: "cb-hint", text: "还没有板块，点「＋ 添加」开始；不配板块时沿用 base 的自动分组。" });
    }
    for (let i = 0; i < this.secs.length; i++) this.renderRow(list, i);

    const addWrap = secBox.createDiv({ cls: "cb-add-wrap" });
    if (!this.addOpen) {
      const b = addWrap.createEl("button", { cls: "cb-add-btn", text: "＋ 添加" });
      b.setAttr("title", "添加一个板块");
      b.addEventListener("click", () => {
        this.addOpen = true;
        this.editIdx = -1;
        this.renderPanel();
      });
    } else {
      addWrap.createSpan({ cls: "cb-add-label", text: "数据源" });
      for (const t of ADDABLE) {
        const b = addWrap.createEl("button", { cls: "cb-add-type", text: SOURCE_LABEL[t] });
        b.setAttr("data-type", t);
        b.addEventListener("click", () => this.addSection(t));
      }
      const c = addWrap.createEl("button", { cls: "cb-add-cancel", text: "取消" });
      c.addEventListener("click", () => {
        this.addOpen = false;
        this.renderPanel();
      });
    }

    /* R13 起：低频项收进默认折叠的「高级」组（原生 <details>）。
     * 键与语义不变（r12 C 组断言守着）。 */
    const advRow = this.panelBodyEl.createEl("details", { cls: "cb-panel-adv" });
    advRow.createEl("summary", { text: "高级" });
    const advBody = advRow.createDiv({ cls: "cb-opt-row" });
    this.addToggle(advBody, K_YAML, false, "显示 YAML 前言", "板块可单独覆盖");
    this.addToggle(advBody, K_LINKS, true, "显示结尾双链", "底部「关联笔记」段；板块可单独覆盖");
    this.addToggle(advBody, K_MOVE, true, "拖动搬文件", "关 = 恢复旧版：Alt + 拖动才搬文件");
    this.renderIoBox(advRow);
  }

  /** R20 需求4-②：分段 —— 一个小标签 + 一组控件（段落名保持极简） */
  addGroup(label) {
    const grp = this.panelBodyEl.createDiv({ cls: "cb-grp" });
    grp.createDiv({ cls: "cb-grp-lb", text: label });
    return grp.createDiv({ cls: "cb-grp-body" });
  }

  /** R21：一行搞定宽度 —— 「文件宽度 [拉杆] 240 px  自动 [开关]」。
   *  · 拉杆 = K_WIDTH（160–480，step 10）；拖动中只直写 CSS 变量（不重绘、不动 DOM 树）
   *  · 「自动」= 原「空位铺满整行」K_FILL：开 = 卡片铺满整行、拉杆置灰；关 = 固定为拉杆宽度
   *  开关样式复用 .cb-opt 那套原生胶囊（见 styles_src/cb.css 的 .cb-wrow 段）。 */
  addWidthRow(parent) {
    const row = parent.createDiv({ cls: "cb-wrow" });
    row.createSpan({ cls: "cb-wlb", text: "文件宽度" });

    const rg = row.createEl("input", { cls: "cb-wrange", type: "range" });
    rg.setAttr("min", "160");
    rg.setAttr("max", "480");
    rg.setAttr("step", "10");
    rg.value = String(this.optNum(K_WIDTH, 240));
    rg.setAttr("title", "卡片最小宽度（160 – 480 px）");
    const val = row.createSpan({ cls: "cb-wval", text: rg.value + " px" });

    /* 「自动」：缩成一个词 + 一个胶囊开关，跟拉杆同一行 */
    const auto = row.createSpan({ cls: "cb-wauto" });
    const alb = auto.createEl("label", { cls: "cb-wauto-lb", text: "自动" });
    const sw = auto.createEl("label", { cls: "checkbox-container" });
    const ib = sw.createEl("input", { cls: "cb-opt-box", type: "checkbox" });
    ib.checked = this.optBool(K_FILL, true);
    sw.setAttr("title", "自动：卡片铺满整行（关 = 固定为拉杆宽度，排不下才换行）");

    /* ⚠️ rg.value 永远是**字符串** —— 上面那个 num() 只认 typeof === "number"，
     * 直接喂会恒回 dflt（r20b 真 DOM 冒烟抓到的真 bug：拖动预览 / 百分比 / 松手落盘
     * 全被钉死在 240）。这里照 optNum 的写法：parseFloat + isFinite 兜底。 */
    const wnum = (s) => { const n = parseFloat(s); return isFinite(n) ? n : 240; };
    const pctOf = (v) => (((wnum(v) - 160) / 320) * 100).toFixed(1) + "%";
    const paint = () => {
      const on = this.optBool(K_FILL, true);
      rg.disabled = on;                       /* 铺满时宽度拉杆不生效 —— 置灰，别做假控件 */
      val.style.opacity = on ? "0.4" : "1";
      rg.style.setProperty("--cb-wpct", pctOf(rg.value));
      val.setText(rg.value + " px");
    };

    rg.addEventListener("input", () => {
      val.setText(rg.value + " px");
      rg.style.setProperty("--cb-wpct", pctOf(rg.value));
      /* 拖动中即时生效：只直写 CSS 变量（同 r15 编辑器保护思路：不动 DOM 树）
       * 「自动」关着时 minmax(w, max) 的 max 也得同步 —— 否则只写 min，往上拖会被
       * minmax 钳在旧 max（表现为只能缩小、不能放大）。 */
      const wpx = wnum(rg.value) + "px";
      this.rootEl.style.setProperty("--cb-card-w", wpx);
      if (!this.optBool(K_FILL, true)) this.rootEl.style.setProperty("--cb-card-max", wpx);
    });
    rg.addEventListener("change", () => {
      const n = Math.max(160, Math.min(480, Math.round(wnum(rg.value) / 10) * 10));
      this.cfgSet(K_WIDTH, n);
      this.repaint(false);
    });

    const apply = (v) => {
      this.cfgSet(K_FILL, v);
      this.repaint(false);
    };
    ib.addEventListener("change", () => apply(!!ib.checked));
    alb.addEventListener("click", () => {
      ib.checked = !ib.checked;
      apply(!!ib.checked);
    });

    paint();
    return row;
  }

  renderIoBox(parent) {
    /* R20 需求4-②：裸 JSON 不占台面 —— 收进「高级」组里再折一层，summary 只说做什么 */
    const wrap = parent.createEl("details", { cls: "cb-io" });
    wrap.createEl("summary", { text: "配置搬运（复制 / 导入）" });
    const box = wrap.createDiv({ cls: "cb-io-body" });
    const head = box.createDiv({ cls: "cb-io-head" });
    head.createSpan({ cls: "cb-field-label", text: "整块复制 / 导入这份看板的配置" });
    const btns = head.createDiv({ cls: "cb-io-btns" });
    const b1 = btns.createEl("button", { cls: "cb-mini cb-io-copy", text: "复制配置" });
    b1.setAttr("title", "把当前视图选项 + 全部板块导出成 JSON（同时尽力写进剪贴板）");
    b1.addEventListener("click", () => this.copyConfig());
    const b2 = btns.createEl("button", { cls: "cb-mini cb-io-paste", text: "从剪贴板填入" });
    b2.setAttr("title", "读剪贴板 → 填进下面的文本框（读不到就手动粘贴）");
    b2.addEventListener("click", () => this.pasteConfig());
    const b3 = btns.createEl("button", { cls: "cb-mini cb-io-apply", text: "应用这段配置" });
    b3.setAttr("title", "整批替换板块配置；任何一项不合格就整批不写");
    b3.addEventListener("click", () => this.applyConfig());

    const ta = box.createEl("textarea", { cls: "cb-io-text" });
    ta.value = this.ioText || "";
    ta.setAttr("rows", "6");
    ta.setAttr("spellcheck", "false");
    ta.setAttr(
      "placeholder",
      '{"_版本":4,"视图":{…},"板块":[{"名称":"…","数据源":"folder","路径":"…"}]}　或直接给数组'
    );
    const sync = () => {
      this.ioText = ta.value;
    };
    ta.addEventListener("input", sync);
    ta.addEventListener("change", sync);
    if (this.ioState) box.createDiv({ cls: "cb-io-msg", text: this.ioState });
  }

  /* R20 需求4-②：一行开关 = 「短标签 + 原生胶囊」；解释文字走 title，面板里不铺小字 */
  addToggle(parent, key, dflt, label, tip) {
    const row = parent.createDiv({ cls: "cb-opt" });
    row.setAttr("data-key", key);
    if (tip) row.setAttr("title", tip);
    const on = this.optBool(key, dflt);
    const sw = row.createEl("label", { cls: "checkbox-container" });
    const cb = sw.createEl("input", { cls: "cb-opt-box", type: "checkbox" });
    cb.checked = on;
    const lab = row.createEl("label", { cls: "cb-opt-label", text: label });
    const apply = (v) => {
      this.cfgSet(key, v);
      this.repaint(false);
    };
    cb.addEventListener("change", () => apply(!!cb.checked));
    lab.addEventListener("click", () => {
      cb.checked = !cb.checked;
      apply(!!cb.checked);
    });
  }

  /* ---------- 一行板块 ---------- */
  renderRow(parent, i) {
    const sec = this.secs[i];
    const row = parent.createDiv({ cls: "cb-row" });
    row.setAttr("data-idx", String(i));
    if (i === this.editIdx) row.addClass("is-editing");
    if (this.confirmIdx === i) row.addClass("is-confirming");

    /* ⣿ 拖动手柄（真 DnD） */
    const grip = row.createSpan({ cls: "cb-grip", text: "⣿" });
    grip.setAttr("draggable", "true");
    grip.setAttr("title", "拖动排序（顺序 = 优先级）");

    /* 名称（双击打开编辑行） */
    const nameEl = row.createSpan({ cls: "cb-row-name", text: sec.name });
    nameEl.addEventListener("dblclick", () => {
      this.editIdx = i;
      this.addOpen = false;
      this.renderPanel();
    });

    /* 数据源徽标 + 明细 */
    const src = row.createSpan({ cls: "cb-row-src" });
    src.createSpan({ cls: "cb-src-tag", text: SOURCE_LABEL[sec.source] || sec.rawSource });
    const detail =
      sec.source === "folder" ? (sec.path || "（未选目录）")
        : sec.source === "tag" ? (sec.tag ? "#" + sec.tag : "（未选标签）")
          : sec.source === "formula" ? (sec.formula ? "公式 · " + sec.formula : "（未选公式）")
            : sec.source === "catchall" ? "未被其他板块命中"
              : sec.rawSource;
    src.createSpan({ cls: "cb-src-detail", text: detail });

    /* 第 3 轮：板块级的 正文 / 属性 标记 */
    if (sec.body === true) row.createSpan({ cls: "cb-badge", text: "正文" });
    else if (sec.body === false) row.createSpan({ cls: "cb-badge", text: "无正文" });
    /* R12：板块级 YAML / 双链覆盖的徽标（跟视图默认不同才标） */
    if (sec.yaml === true) row.createSpan({ cls: "cb-badge", text: "YAML" });
    if (sec.links === false) row.createSpan({ cls: "cb-badge", text: "无双链" });
    if (sec.props && sec.props.length) row.createSpan({ cls: "cb-badge", text: "属性 " + sec.props.length });
    /* 第 4 轮：板块级排序 */
    if (sec.sort) row.createSpan({ cls: "cb-badge", text: "排序 " + (SORT_LABEL[sec.sort] || sec.sort) });

    /* 条数（面板先算 sections，所以这里拿得到） */
    const hit = this.sections.reduce((a, s) => a + (s.srcIndex === i ? s.total : 0), 0);
    let cntText = hit + " 条";
    if (sec.source === "catchall") {
      const shown = this.optBool(K_CATCH, this.pluginCatchDefault());
      const n = shown ? hit : (this.catchPreview ? this.catchPreview.total : hit);
      cntText = n + (shown ? " 条" : " 条（未显示）");
    }
    row.createSpan({ cls: "cb-row-count", text: cntText });

    /* 按钮 */
    const btns = row.createDiv({ cls: "cb-row-btns" });
    const mk = (label, cls, title, fn) => {
      const b = btns.createEl("button", { cls: "cb-mini " + cls, text: label });
      b.setAttr("title", title);
      b.addEventListener("click", (evt) => {
        evt.stopPropagation();
        fn();
      });
      return b;
    };
    const up = mk("▲", "cb-up", "上移", () => this.reorder(i, i - 1));
    const dn = mk("▼", "cb-down", "下移", () => this.reorder(i, i + 1));
    up.disabled = i === 0;
    dn.disabled = i === this.secs.length - 1;
    /* ⚠️ ✎ 的类名不能叫 cb-edit —— 那会和「编辑行」容器的 .cb-edit 撞名，
       把编辑行的 margin/padding/左边框套到小按钮上 */
    mk("✎", "cb-editbtn", "编辑", () => {
      this.editIdx = this.editIdx === i ? -1 : i;
      this.addOpen = false;
      this.renderPanel();
    });
    if (sec.source !== "unsupported") {
      const plus = mk("＋", "cb-plus-mini", "在这个板块新建一篇（落点按板块类型算，不动其他笔记）", () =>
        this.createInSection(sec, "", null)
      );
      if (this.readonly()) plus.toggleClass("is-off", true);
    }
    mk(this.confirmIdx === i ? "确认?" : "✕", "cb-del", "删除这个板块（不动任何笔记）", () => this.askDelete(i));

    this.bindDrag(row, grip, i);

    if (this.editIdx === i) this.renderEditRow(parent, i);
    return row;
  }

  /* ---------- 编辑行（✎） ---------- */
  renderEditRow(parent, i) {
    const sec = this.secs[i];
    const box = parent.createDiv({ cls: "cb-edit" });
    box.setAttr("data-idx", String(i));

    /* R14（boss：界面很丑）：表单分两段，「基础」= 名字与数据源，「显示」= 其余 —— 不再 9 行平铺 */
    box.createDiv({ cls: "cb-edit-sep", text: "基础" });

    const r1 = box.createDiv({ cls: "cb-field" });
    r1.createSpan({ cls: "cb-field-label", text: "名称" });
    const nameInput = r1.createEl("input", { cls: "cb-input cb-input-name", type: "text" });
    nameInput.value = sec.name;
    this.hookEl(nameInput, (v) => {
      const nv = str(v).trim();
      if (!nv || nv === this.secs[i].name) return false;
      this.secs[i].name = nv;
      return true;
    });

    const r2 = box.createDiv({ cls: "cb-field" });
    r2.createSpan({ cls: "cb-field-label", text: "数据源" });
    const sel = r2.createEl("select", { cls: "cb-input cb-select-src" });
    for (const t of ADDABLE.concat(["unsupported"])) {
      const o = sel.createEl("option", { text: SOURCE_LABEL[t] || t });
      o.value = t;
    }
    sel.value = sec.source;
    sel.addEventListener("change", () => {
      const s = this.secs[i];
      const next = sel.value;
      if (next === s.source) return;
      if (next === "catchall" && this.secs.some((x, j) => j !== i && x.source === "catchall")) {
        new Notice("收容所只能有一个");
        this.renderPanel();
        return;
      }
      s.source = next;
      s.error = null;
      this.afterChange();
    });

    if (sec.source === "folder") {
      const r = box.createDiv({ cls: "cb-field cb-field-col" });
      r.createSpan({ cls: "cb-field-label", text: "目录" });
      this.renderFolderTree(r, sec.path, (p) => {
        if (cleanFolder(p) === this.secs[i].path) return;
        this.secs[i].path = cleanFolder(p);
        this.afterChange();
      });
      const rr = box.createDiv({ cls: "cb-field" });
      rr.createSpan({ cls: "cb-field-label", text: "递归深度" });
      const di = rr.createEl("input", { cls: "cb-input cb-input-depth", type: "number" });
      di.value = String(sec.depth);
      this.hookEl(di, (v) => {
        const n = Math.max(0, Math.floor(parseFloat(v)));
        if (!isFinite(n) || n === this.secs[i].depth) return false;
        this.secs[i].depth = n;
        return true;
      });
    } else if (sec.source === "tag") {
      const r = box.createDiv({ cls: "cb-field cb-field-col" });
      r.createSpan({ cls: "cb-field-label", text: "标签" });
      this.renderTagPicker(r, sec.tag, i);
    } else if (sec.source === "formula") {
      const r = box.createDiv({ cls: "cb-field" });
      r.createSpan({ cls: "cb-field-label", text: "公式" });
      this.renderFormulaPicker(r, sec.formula, i);
    } else if (sec.source === "catchall") {
      box.createDiv({ cls: "cb-hint", text: "收容所固定排最后；是否出现由「看板行为 → 显示收容所」控制。" });
    } else {
      box.createDiv({ cls: "cb-hint", text: "这个数据源还不支持（可在 YAML 里手写成 folder / tag / formula / catchall）。" });
    }

    if (sec.source !== "catchall") {
      box.createDiv({ cls: "cb-edit-sep", text: "显示" });
      const r = box.createDiv({ cls: "cb-field" });
      r.createSpan({ cls: "cb-field-label", text: "上限" });
      const li = r.createEl("input", { cls: "cb-input cb-input-limit", type: "number" });
      li.value = String(sec.limit);
      this.hookEl(li, (v) => {
        const n = Math.floor(parseFloat(v));
        if (!isFinite(n) || n < 0 || n === this.secs[i].limit) return false;
        this.secs[i].limit = n;
        return true;
      });
    }

    /* —— 第 4 轮：板块级排序（排序在前、再截断 → 「按改动时间取前 N 条」才成立） —— */
    const rs = box.createDiv({ cls: "cb-field" });
    rs.createSpan({ cls: "cb-field-label", text: "排序" });
    const ss = rs.createEl("select", { cls: "cb-input cb-select-sort" });
    for (const k of SORT_KEYS) {
      const o = ss.createEl("option", { text: SORT_LABEL[k] || k });
      o.value = k;
    }
    ss.value = SORT_KEYS.indexOf(sec.sort) >= 0 ? sec.sort : "";
    ss.addEventListener("change", () => {
      this.secs[i].sort = SORT_KEYS.indexOf(ss.value) >= 0 ? ss.value : "";
      this.afterChange();
    });

    /* R20 需求4-③（boss：板块边上的设置只管这一块，界面要清晰简洁）：
     * 三态（继承 / 开 / 关）从下拉换成并排小按钮 —— 当前态一眼可见、改一下点一下。
     * 键与语义完全不变（r12 C 组断言守着）：null = 继承视图默认。 */
    const mkTri = (label, cls, key, viewOn) => {
      const r = box.createDiv({ cls: "cb-field" });
      r.createSpan({ cls: "cb-field-label", text: label });
      const seg = r.createDiv({ cls: "cb-seg " + cls });
      const cur = this.secs[i][key];
      const curVal = cur === true ? "true" : cur === false ? "false" : "";
      const opts = [
        ["", "继承", "跟随视图默认（现在 = " + (viewOn ? "开" : "关") + "）"],
        ["true", "开", "这一块一定显示"],
        ["false", "关", "这一块一定不显示"],
      ];
      for (const pair of opts) {
        const b = seg.createEl("button", { cls: "cb-seg-btn", text: pair[1] });
        b.setAttr("type", "button");
        b.setAttr("data-value", pair[0]);
        b.setAttr("title", pair[2]);
        if (pair[0] === curVal) b.addClass("is-on");
        b.addEventListener("click", () => {
          const nv = pair[0] === "" ? null : pair[0] === "true";
          if (this.secs[i][key] === nv) return;
          this.secs[i][key] = nv;
          this.afterChange();
        });
      }
    };
    /* R24：既然右键小窗把「属性展开」升成了板块级三态，编辑行这边也得有 ——
       同一件事两个台面能力不一致，老板一定会撞上「这边怎么没有」。 */
    mkTri("属性展开", "cb-seg-propsopen", "propsOpen", this.propsOpenDefault());
    mkTri("显正文", "cb-seg-body", "body", this.viewBodyDefault());
    mkTri("显示 YAML", "cb-seg-yaml", "yaml", this.optBool(K_YAML, false));
    mkTri("显示结尾双链", "cb-seg-links", "links", this.optBool(K_LINKS, true));

    const rp = box.createDiv({ cls: "cb-field cb-field-col" });
    const rpl = rp.createSpan({ cls: "cb-field-label", text: "属性" });
    rpl.setAttr("title", "逗号分隔。留空 = 继承视图；视图也留空则取每篇笔记前 5 个属性");
    const pi = rp.createEl("input", { cls: "cb-input cb-input-props", type: "text" });
    pi.value = (sec.props || []).join(", ");
    pi.setAttr("placeholder", "例：简介, 平台, 状态, 目标发布日, 文件位置");
    this.hookEl(pi, (v) => {
      const arr = parseNameList(v);
      const cur = this.secs[i].props || [];
      if (arr.join("\u0001") === cur.join("\u0001")) return false;
      this.secs[i].props = arr.length ? arr : [];
      return true;
    });

    const foot = box.createDiv({ cls: "cb-edit-foot" });
    const done = foot.createEl("button", { cls: "cb-btn-done", text: "完成" });
    done.addEventListener("click", () => {
      this.editIdx = -1;
      this.renderPanel();
    });
    const del = foot.createEl("button", { cls: "cb-btn-del2", text: "删除此板块" });
    del.addEventListener("click", () => this.askDelete(i));
  }

  /** 输入框：change / blur / Enter 提交；Esc 关掉编辑行 */
  hookEl(el, apply) {
    const commit = () => {
      if (apply(el.value)) this.afterChange();
    };
    el.addEventListener("change", commit);
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        this.editIdx = -1;
        this.renderPanel();
      }
    });
  }

  /* ---------- 目录树 ---------- */
  collectFolders() {
    const set = new Set([""]);
    try {
      const all = this.app && this.app.vault && this.app.vault.getAllLoadedFiles
        ? this.app.vault.getAllLoadedFiles()
        : [];
      for (const f of all) {
        if (!f) continue;
        const isFolder = TFolder ? f instanceof TFolder : f.children !== undefined;
        if (!isFolder) continue;
        set.add(cleanFolder(f.path));
      }
    } catch (e) {}
    return [...set].sort(zhSort);
  }

  renderFolderTree(parent, current, onPick) {
    const paths = this.collectFolders();
    const cur = cleanFolder(current);
    const tree = parent.createDiv({ cls: "cb-tree" });
    const rootNode = tree.createDiv({ cls: "cb-tree-node" });
    rootNode.setAttr("data-path", "");
    rootNode.createSpan({ cls: "cb-tree-name", text: "（库根）" });
    if (cur === "") rootNode.addClass("is-picked");
    rootNode.addEventListener("click", () => onPick(""));

    let n = 0;
    for (const p of paths) {
      if (!p) continue;
      const segs = p.split("/");
      const el = tree.createDiv({ cls: "cb-tree-node" });
      el.setAttr("data-path", p);
      el.style.paddingLeft = 6 + (segs.length - 1) * 12 + "px";
      el.createSpan({ cls: "cb-tree-name", text: segs[segs.length - 1] });
      if (cur === p) el.addClass("is-picked");
      el.addEventListener("click", () => onPick(p));
      n++;
    }
    if (n === 0) tree.createDiv({ cls: "cb-hint", text: "（读不到目录列表）" });
  }

  /* ---------- 标签候选（全库聚合 + 次数） ---------- */
  collectTags() {
    const map = new Map();
    try {
      const files = this.app && this.app.vault && this.app.vault.getMarkdownFiles
        ? this.app.vault.getMarkdownFiles()
        : [];
      for (const f of files) {
        const cache = this.app.metadataCache ? this.app.metadataCache.getFileCache(f) : null;
        if (!cache) continue;
        let tags = [];
        try {
          tags = (typeof obsidian.getAllTags === "function" ? obsidian.getAllTags(cache) : null) || [];
        } catch (e) {
          tags = [];
        }
        for (const t of tags) {
          const nm = normTag(t);
          if (nm) map.set(nm, (map.get(nm) || 0) + 1);
        }
      }
    } catch (e) {}
    return [...map.entries()].sort((a, b) => b[1] - a[1] || zhSort(a[0], b[0]));
  }

  renderTagPicker(parent, current, i) {
    const tags = this.collectTags();
    const row = parent.createDiv({ cls: "cb-picker-row" });
    const sel = row.createEl("select", { cls: "cb-input cb-select-tag" });
    const o0 = sel.createEl("option", { text: "（或从右边输入框手输）" });
    o0.value = "";
    for (const [t, cnt] of tags) {
      const o = sel.createEl("option", { text: "#" + t + " (" + cnt + ")" });
      o.value = t;
    }
    sel.value = tags.some(([t]) => t === current) ? current : "";
    const inp = row.createEl("input", { cls: "cb-input cb-input-tag", type: "text" });
    inp.value = current || "";
    inp.setAttr("placeholder", "标签（不带 #）");

    const apply = () => {
      const manual = normTag(inp.value);
      const next = manual || normTag(sel.value);
      if (!next || next === this.secs[i].tag) return false;
      this.secs[i].tag = next;
      return true;
    };
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      inp.value = sel.value;
      if (apply()) this.afterChange();
    });
    this.hookEl(inp, apply);
    if (tags.length === 0) parent.createDiv({ cls: "cb-hint", text: "（全库还没扫到标签）" });
  }

  /* ---------- 公式候选 ---------- */
  collectFormulas() {
    const out = [];
    try {
      const q = this.config && this.config.query;
      const f = q && q.formulas;
      if (f) for (const k of Object.keys(f)) out.push(k);
    } catch (e) {}
    if (out.length === 0) {
      /* 兜底：从条目身上问（BasesEntry 内部持有 formula 表） */
      try {
        const d = this.data && Array.isArray(this.data.data) ? this.data.data[0] : null;
        const keys = d && d.formula && typeof d.formula.keys === "function" ? d.formula.keys() : null;
        if (Array.isArray(keys)) out.push(...keys);
      } catch (e) {}
    }
    return [...new Set(out)].sort(zhSort);
  }

  renderFormulaPicker(parent, current, i) {
    const names = this.collectFormulas();
    const sel = parent.createEl("select", { cls: "cb-input cb-select-formula" });
    const o0 = sel.createEl("option", { text: names.length ? "（未选）" : "（读不到公式列表，请右边手输）" });
    o0.value = "";
    for (const nm of names) {
      const o = sel.createEl("option", { text: nm });
      o.value = nm;
    }
    sel.value = names.indexOf(current) >= 0 ? current : "";
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      if (this.secs[i].formula === sel.value) return;
      this.secs[i].formula = sel.value;
      this.afterChange();
    });
    const inp = parent.createEl("input", { cls: "cb-input cb-input-formula", type: "text" });
    inp.value = current || "";
    inp.setAttr("placeholder", "公式名（对应 base 的 formulas: 段）");
    this.hookEl(inp, (v) => {
      const nv = str(v).trim();
      if (!nv || nv === this.secs[i].formula) return false;
      this.secs[i].formula = nv;
      return true;
    });
  }

  /* ============================================================
   * 编辑动作（全部走 afterChange → 写盘 + 重画）
   * ============================================================ */
  afterChange() {
    this.persist();
    this.repaint(false);
  }

  reorder(from, to) {
    const s = this.secs;
    if (!s.length) return;
    if (from < 0 || from >= s.length || to < 0 || to >= s.length || from === to) return;
    const item = s.splice(from, 1)[0];
    s.splice(to, 0, item);
    if (this.editIdx === from) this.editIdx = to;
    this.afterChange();
  }

  addSection(type) {
    if (type === "catchall" && this.secs.some((x) => x.source === "catchall")) {
      new Notice("收容所只能有一个");
      this.addOpen = false;
      this.renderPanel();
      return;
    }
    const base = { name: "新板块", source: type, rawSource: type, path: "", tag: "", formula: "", limit: 50, depth: 1, props: [], body: null, propsOpen: null, extra: {} };
    if (type === "catchall") base.name = "其它";
    if (type === "formula") {
      const names = this.collectFormulas();
      base.name = names.length ? "自动分组 · " + names[0] : "自动分组";
      base.formula = names.length ? names[0] : "";
    }
    /* 新板块插到收容所之前 */
    const ci = this.secs.findIndex((x) => x.source === "catchall");
    const idx = ci >= 0 ? ci : this.secs.length;
    this.secs.splice(idx, 0, base);
    this.addOpen = false;
    this.editIdx = idx;
    this.afterChange();
  }

  askDelete(i) {
    if (this.confirmIdx !== i) {
      this.confirmIdx = i;
      this.renderPanel();
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => {
        this.confirmTimer = null;
        if (this.confirmIdx === i) {
          this.confirmIdx = -1;
          this.renderPanel();
        }
      }, 3000);
      return;
    }
    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
    this.confirmIdx = -1;
    this.secs.splice(i, 1);
    if (this.editIdx === i) this.editIdx = -1;
    else if (this.editIdx > i) this.editIdx--;
    this.afterChange();
  }

  /* ---------- 拖动排序（与 ▲▼ 同一条 reorder 路径） ---------- */
  bindDrag(row, grip, i) {
    grip.addEventListener("dragstart", (evt) => {
      this.dragFrom = i;
      row.addClass("is-dragging");
      try {
        if (evt.dataTransfer) {
          evt.dataTransfer.effectAllowed = "move";
          evt.dataTransfer.setData("text/plain", String(i));
        }
      } catch (e) {}
    });
    grip.addEventListener("dragend", () => {
      this.dragFrom = null;
      this.clearDropMarks();
    });
    row.addEventListener("dragover", (evt) => {
      if (this.dragFrom === null || this.dragFrom === undefined) return;
      evt.preventDefault();
      try {
        if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      } catch (e) {}
      if (this.dragFrom !== i) row.addClass("is-drop");
    });
    row.addEventListener("dragleave", () => row.removeClass("is-drop"));
    row.addEventListener("drop", (evt) => {
      evt.preventDefault();
      const from = this.dragFrom;
      this.dragFrom = null;
      this.clearDropMarks();
      if (from === null || from === undefined || from === i) return;
      this.reorder(from, i);
    });
  }

  clearDropMarks() {
    if (!this.panelBodyEl) return;
    for (const el of Array.from(this.panelBodyEl.querySelectorAll(".cb-row.is-drop"))) el.removeClass("is-drop");
    for (const el of Array.from(this.panelBodyEl.querySelectorAll(".cb-row.is-dragging"))) el.removeClass("is-dragging");
  }

  /* ---------- 视图选项（必须是**函数**；Bases 会 options(config) 调用） ----------
   * R20 需求4-①（老板截图6）：点击「创作看板」标题进的就是这个面板 —— 它只负责**快速调节
   * 这个视图长什么样**，所以这里**只留显示外观类必要项**：
   *   卡片最小宽度 / 空位铺满整行 / 显示属性 / 显正文 / 正文字数上限 / 属性默认展开。
   * 「看板行为与范围」那几项（只读 / 允许重复 / 显示收容所 / 排除目录 / 总条数上限）
   * 已统一收到顶栏「板块」面板（唯一入口）—— 两处写的是**同一份** .base 视图配置，
   * 老配置照旧被读到，不会因为这里少了几项就失效。
   * 描述项是**扁平**结构（已核实核心 cards/list/table 的写法）：
   *   {displayName, type, key, default, min, max, step, options, placeholder, filter, shouldHide}
   * 可用 type 只有：toggle / dropdown / text / textarea / number / file / folder / slider / color / secret / property
   * ⚠️ 没有多选控件 → 「显示属性」用 text（逗号分隔）
   */
  static getViewOptions(config) {
    const readBool = (key) => {
      try {
        const v = config && typeof config.get === "function" ? config.get(key) : undefined;
        return v === true || v === "true";
      } catch (e) {
        return false;
      }
    };
    return [
      { displayName: "显示属性（逗号分隔；留空 = 每篇前言前 5 个）", type: "text", key: K_PROPS, default: "", placeholder: "简介, 平台, 状态" },
      { displayName: "显正文（板块没单独指定时的默认）", type: "toggle", key: K_BODY, default: false },
      { displayName: "正文字数上限（0 = 不截断，正文区自己滚）", type: "number", key: K_CHARS, min: 0, max: 50000, step: 50, default: DEFAULT_CHARS, instant: true, shouldHide: () => !readBool(K_BODY) },
      /* R20：以上是「显示外观」。只读 / 允许重复 / 显示收容所 / 排除目录 / 总条数上限
       * 已移出本面板 —— 在顶栏「板块」里改（同一份 .base 配置，键名一个没变）。
       * R21：卡片最小宽度 + 空位铺满整行（K_WIDTH / K_FILL）也移走了 —— 顶栏「卡片」组里
       * 合成一行「文件宽度 [拉杆] 240 px 自动 [开关]」（原生面板一条只占一行，合不成）。
       * R23（boss：加一个开关控制笔记的属性是否默认展开）：属性默认展开（K_PROS_OPEN）
       * 也移走了 —— 顶栏「看板行为」组，和「显正文」挨着。 */
    ];
  }
}

/* ============================================================
 * 插件
 * ============================================================ */

/** PluginSettingTab 在极老版本上没有 → 给个空壳基类，避免 `extends undefined` 直接崩在模块加载期 */
const PluginSettingTabBase =
  obsidian.PluginSettingTab ||
  class {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = document.createElement("div");
    }
    display() {}
  };

/** 设置页（第 4 轮）——只放**全局默认**；视图选项 / 板块配置显式写过的以那边为准 */
class CreationBoardSettingTab extends PluginSettingTabBase {
  constructor(app, plugin) {
    super(app, plugin);
    this.app = app;
    this.plugin = plugin;
  }

  display() {
    const c = this.containerEl;
    if (!c) return;
    c.empty();
    c.createEl("h2", { text: "创作看板（全局默认）" });
    c.createDiv({
      cls: "setting-item-description",
      text: "这里的值是全局默认。视图选项 / 板块配置里显式写过时，以那边为准。改完立刻生效（回到看板点一下 ↻ 重载）。",
    });

    const Setting = obsidian.Setting;
    const field = (name, desc, kind, key) => {
      const read = () => PLUGIN_SETTINGS[key];
      const write = (v) => {
        PLUGIN_SETTINGS[key] = v;
        this.plugin.saveSettings();
      };
      if (Setting) {
        const s = new Setting(c).setName(name).setDesc(desc);
        if (kind === "bool") {
          s.addToggle((t) => t.setValue(!!read()).onChange((v) => write(!!v)));
        } else if (kind === "int") {
          s.addText((t) => {
            if (t.inputEl) t.inputEl.type = "number";
            t.setValue(String(read()));
            t.onChange((v) => {
              const n = Math.max(0, Math.floor(parseFloat(v)));
              write(isFinite(n) ? n : 0);
            });
          });
        } else {
          s.addText((t) => t.setPlaceholder(str(DEFAULT_SETTINGS[key])).setValue(str(read())).onChange((v) => write(str(v).trim())));
        }
        return;
      }
      /* 没有 Setting 类的环境：只把说明写出来，不假装能改 */
      const box = c.createDiv({ cls: "cb-set-row" });
      box.createDiv({ cls: "cb-set-name", text: name });
      box.createDiv({ cls: "cb-set-desc", text: desc });
    };

    field("收容所默认显示", "视图选项「显示收容所」没设过时用这个。收容所 = 没被任何板块命中的笔记。", "bool", "catchAllDefault");
    field("「＋」默认落点", "板块算不出目录时的兜底目录（相对库根）。文件夹源用板块目录；标签源查标签路由表。", "text", "newNoteFolder");
    field("「＋」默认文件名", "不带 .md；撞名自动加序号（未命名 → 未命名 2）。", "text", "newNoteName");
    field("性能护栏 · 排除目录", "逗号分隔，按**目录段**匹配 —— 写 99_Meta 就能命中 01_新知识库/99_Meta/…。", "text", "excludeFolders");
    field("性能护栏 · 总条数上限", "0 = 不限。超了会在工具条上如实写「超总上限截断 N 篇」，不静默。", "int", "totalCap");
  }
}

class CreationBoardPlugin extends Plugin {
  async onload() {
    /* ① 注册视图：**放在任何 await 之前** —— 视图类型要尽早挂上，
       也避免「注册被排在微任务里」这种看不见的时序坑 */
    if (typeof this.registerBasesView !== "function") {
      new Notice("创作看板：这个 Obsidian 版本没有 registerBasesView（需 1.9+）");
    } else {
      try {
        this.registerBasesView(VIEW_TYPE, {
          name: VIEW_NAME,
          icon: "lucide-layout-dashboard",
          factory: (controller, containerEl) => new CreationBoardView(controller, containerEl),
          options: CreationBoardView.getViewOptions,
        });
      } catch (e) {
        console.error("[creation-board] 注册 Bases 视图失败：", e);
        new Notice("创作看板：注册视图失败 —— 核心插件「Bases」是否已启用？");
      }
    }

    /* ② 再把插件级设置读进来（Obsidian 会 await onload()，所以视图一定在设置之后才建） */
    await this.loadSettings();

    /* ③ 设置页注册失败不该拖垮主功能（老版本 / API 变动） */
    try {
      this.addSettingTab(new CreationBoardSettingTab(this.app, this));
    } catch (e) {
      console.warn("[creation-board] 设置页注册失败（不影响看板）：", e);
    }
  }

  /** 插件级设置存 data.json；字段缺失自动补默认值（老版本升级上来不会缺字段） */
  async loadSettings() {
    let d = null;
    try {
      d = await this.loadData();
    } catch (e) {
      d = null;
    }
    PLUGIN_SETTINGS = Object.assign({}, DEFAULT_SETTINGS, d && typeof d === "object" && !Array.isArray(d) ? d : {});
    const n = Math.floor(num(PLUGIN_SETTINGS.totalCap, 0));
    PLUGIN_SETTINGS.totalCap = isFinite(n) && n > 0 ? n : 0;
    PLUGIN_SETTINGS.catchAllDefault = !!PLUGIN_SETTINGS.catchAllDefault;
    if (typeof PLUGIN_SETTINGS.newNoteFolder !== "string") PLUGIN_SETTINGS.newNoteFolder = DEFAULT_SETTINGS.newNoteFolder;
    if (typeof PLUGIN_SETTINGS.newNoteName !== "string" || !PLUGIN_SETTINGS.newNoteName.trim())
      PLUGIN_SETTINGS.newNoteName = DEFAULT_SETTINGS.newNoteName;
    if (typeof PLUGIN_SETTINGS.excludeFolders !== "string") PLUGIN_SETTINGS.excludeFolders = DEFAULT_SETTINGS.excludeFolders;
    return PLUGIN_SETTINGS;
  }

  async saveSettings() {
    try {
      await this.saveData(PLUGIN_SETTINGS);
    } catch (e) {
      console.error("[creation-board] 保存插件设置失败：", e);
    }
  }
}

module.exports = CreationBoardPlugin;

KB.modules.CreationBoardPlugin = module.exports;
})();
/* ===== KB-EMBED:CreationBoardPlugin END ===== */
/* ===== KB-EMBED:BasesPreviewPlugin BEGIN（字节级原样内嵌，勿改） ===== */
(function () {
var module = { exports: {} };
/*
 * bases-preview — 笔记内容流（Bases 视图）
 * ------------------------------------------------------------------
 * 补 Obsidian Bases 原生给不了的一件事：**在看板里直接读笔记正文**。
 *   Bases 的卡片/表格只能显示 14 个 file.* 属性 + 前言属性，
 *   **没有「正文」这个属性**，所以原生永远预览不到内容。
 *   本插件用 `Plugin.registerBasesView()` 自注册一个视图类型 `note-stream`，
 *   于是「视图布局」下拉里多出一个「📖 笔记内容流」。
 *
 * 视图行为：
 *   - 按视图的 groupBy 分组；每篇一张卡：标题（内部链接，悬浮即预览）+ 属性胶囊 + 正文
 *   - 正文懒加载：用 IntersectionObserver，滚到附近才读盘 + 渲染（不会一次渲染几百篇）
 *   - 正文来自 vault.cachedRead()，剥掉前言、去掉与标题重复的首个 H1、按选项截断
 *   - 渲染走公开 API MarkdownRenderer.render(app, md, el, sourcePath, component)
 *
 * 视图选项（视图面板里可调）：
 *   正文预览字数 / 最多预览条数 / 显示属性行
 *
 * 全部 API 名已对 obsidian.asar（1.13.x）核实：
 *   Plugin.registerBasesView(id, {name, icon, factory, options})   @3628911
 *     内部: internalPlugins.getEnabledPluginById("bases").registerView(id, reg)
 *   工厂签名: factory(controller, containerEl) -> BasesView          @3234252
 *   控制器在数据刷新时: view.allProperties / view.data = new BasesQueryResult(...) / view.onDataUpdated()
 *   BasesView(公开导出, 内部 XZ): this.app / this.queryController / this.config
 *     this.data 是 BasesQueryResult：.data = BasesEntry[]，getter .groupedData = BasesEntryGroup[]
 *     BasesEntryGroup: { entries, key, hasKey() }
 *     BasesEntry: { file: TFile, frontmatter, getValue(prop) }
 *     辅助方法: this.createGroupHeadingEl(group) / this.createFileForView(group)
 *   视图选项面板会调用 registration.options(config) —— **必须是函数**，返回描述数组
 *     描述项: {displayName, type: "slider"|"toggle"|"text"|"dropdown"|... , key, default, min, max, step}
 *   链接悬浮预览: workspace.trigger("hover-link", {event, source:"bases", hoverParent, targetEl, linktext})
 *     —— "bases" 这个 hover 源由核心 Bases 注册为 defaultMod:true；
 *        defaultMod:true 的含义是「**默认需要按住 Ctrl/Cmd**」才弹（不是免按）；
 *        只有阅读视图的 "preview" 源注册成 false（免按）。
 *   MarkdownRenderer.render(app, markdown, el, sourcePath, component)   @2732156
 *   getFrontMatterInfo(markdown) -> {frontmatter, contentStart}         同上，公开导出
 * ------------------------------------------------------------------
 */
"use strict";

const obsidian = require("obsidian");
const { Plugin, MarkdownRenderer, Notice } = obsidian;

/* BasesView 在 1.9+ 才导出；拿不到时退化成一个空实现，保证插件不至于加载即崩 */
const BasesViewBase =
  obsidian.BasesView ||
  class {
    constructor(controller) {
      this.app = controller && controller.app;
      this.queryController = controller;
    }
  };

const VIEW_TYPE = "note-stream";
const VIEW_NAME = "📖 笔记内容流";
const META_KEYS = ["状态", "领域", "类型", "平台"];

function num(v, dflt) {
  return typeof v === "number" && isFinite(v) ? v : dflt;
}

function humanAgo(ts) {
  const diff = Date.now() - ts;
  if (!isFinite(diff) || diff < 0) return "";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  if (d < 30) return d + " 天前";
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo + " 个月前";
  return Math.floor(mo / 12) + " 年前";
}

/* 截断可能切在代码块中间 —— 围栏数奇数就补一个收尾围栏，避免整段被吞。
 * R15 修：``` 与 ~~~ 分开数 —— 原来混着数，奇数落在这边时补的是另一种，收不住 */
function balanceFences(md) {
  const backtick = (md.match(/^[ \t]*```/gm) || []).length;
  const tilde = (md.match(/^[ \t]*~~~/gm) || []).length;
  if (backtick % 2 === 1) return md + "\n\n```\n";
  if (tilde % 2 === 1) return md + "\n\n~~~\n";
  return md;
}

class NoteStreamView extends BasesViewBase {
  constructor(controller, containerEl) {
    super(controller);
    this.type = VIEW_TYPE;
    this.items = [];
    this.queue = [];
    this.pumping = false;
    this.sig = "";
    this.renderedOnce = false;

    this.rootEl = containerEl.createDiv({ cls: "bases-note-stream" });
    const bar = this.rootEl.createDiv({ cls: "bns-bar" });
    this.countEl = bar.createSpan({ cls: "bns-count", text: "…" });
    const btn = bar.createEl("button", { cls: "bns-refresh", text: "↻ 重载" });
    btn.addEventListener("click", () => this.rebuild(true));
    this.listEl = this.rootEl.createDiv({ cls: "bns-list" });

    try {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            const item = en.target.__bnsItem;
            try {
              this.observer.unobserve(en.target);
            } catch (e) {}
            if (item) this.enqueue(item);
          }
        },
        { root: this.rootEl, rootMargin: "800px 0px 0px 0px" }
      );
    } catch (e) {
      this.observer = null;
    }
  }

  /* ---------- Component 生命周期 ---------- */
  onload() {}
  onunload() {
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (e) {}
    }
    this.queue.length = 0;
  }
  focus() {
    try {
      this.rootEl.focus({ preventScroll: true });
    } catch (e) {}
  }
  onResize() {}

  /* ---------- 选项读取 ---------- */
  optNum(key, dflt) {
    const c = this.config;
    if (!c) return dflt;
    try {
      return num(c.get(key), dflt);
    } catch (e) {
      return dflt;
    }
  }
  optBool(key, dflt) {
    const c = this.config;
    if (!c) return dflt;
    try {
      const v = c.get(key);
      return typeof v === "boolean" ? v : dflt;
    } catch (e) {
      return dflt;
    }
  }

  /* ---------- 数据刷新 ---------- */
  computeSig() {
    const d = this.data;
    if (!d || !Array.isArray(d.data)) return "";
    const out = [this.optNum("chars", 600), this.optNum("maxNotes", 40), this.optBool("showMeta", true)];
    for (const en of d.data) {
      out.push(en.file.path + "@" + en.file.stat.mtime);
    }
    return out.join("\u0001");
  }

  onDataUpdated() {
    const sig = this.computeSig();
    if (sig && sig === this.sig && this.renderedOnce) {
      this.updateBar();
      return; // 数据/选项都没变 —— 别整块重建（会闪、会丢滚动位置）
    }
    this.sig = sig;
    this.renderedOnce = true;
    this.rebuild(false);
  }

  getFm(entry) {
    try {
      const f = entry.frontmatter;
      if (f && typeof f === "object") return f;
    } catch (e) {}
    try {
      const c = this.app.metadataCache.getFileCache(entry.file);
      return (c && c.frontmatter) || {};
    } catch (e) {
      return {};
    }
  }

  rebuild(force) {
    if (this.observer) {
      for (const it of this.items) {
        try {
          this.observer.unobserve(it.bodyEl);
        } catch (e) {}
      }
    }
    this.queue.length = 0;
    this.items = [];
    const keepScroll = force ? 0 : this.rootEl.scrollTop;
    this.listEl.empty();

    const d = this.data;
    if (!d || !Array.isArray(d.data) || d.data.length === 0) {
      this.listEl.createDiv({ cls: "bns-empty", text: "没有匹配的笔记（检查这个视图的过滤条件）" });
      this.updateBar();
      return;
    }

    const chars = this.optNum("chars", 600);
    const maxNotes = this.optNum("maxNotes", 40);
    const showMeta = this.optBool("showMeta", true);

    let idx = 0;
    let groups = [];
    try {
      groups = d.groupedData || [];
    } catch (e) {
      groups = [];
    }
    if (groups.length === 0) groups = [{ entries: d.data, key: null, hasKey: () => false }];

    for (const g of groups) {
      const gEl = this.listEl.createDiv({ cls: "bns-group" });
      let heading = null;
      try {
        if (g && typeof g.hasKey === "function" && g.hasKey()) heading = this.createGroupHeadingEl(g);
      } catch (e) {
        heading = null;
      }
      if (heading) gEl.appendChild(heading);

      const entries = (g && g.entries) || [];
      for (const entry of entries) {
        const file = entry.file;
        const itemEl = gEl.createDiv({ cls: "bns-item" });
        const headEl = itemEl.createDiv({ cls: "bns-head" });

        const titleEl = headEl.createEl("a", { cls: "internal-link bns-title", text: file.basename });
        titleEl.addEventListener("click", (evt) => {
          evt.preventDefault();
          const mod = evt.ctrlKey || evt.metaKey;
          this.app.workspace.openLinkText(file.path, "", mod ? "tab" : false);
        });
        titleEl.addEventListener("mouseover", (evt) => {
          this.app.workspace.trigger("hover-link", {
            event: evt,
            source: "bases",
            hoverParent: this,
            targetEl: titleEl,
            linktext: file.path,
          });
        });

        if (showMeta) {
          /* R14（boss：界面很丑）：徽章最多 2 个，其余收进「+N」—— 中心类笔记一排徽章是纯噪声 */
          const fm = this.getFm(entry);
          const vals = [];
          for (const k of META_KEYS) {
            const v = fm[k];
            if (v === null || v === undefined || v === "") continue;
            vals.push(Array.isArray(v) ? v.join(" · ") : String(v));
          }
          for (let ci = 0; ci < vals.length && ci < 2; ci++)
            headEl.createSpan({ cls: "bns-chip", text: vals[ci] });
          if (vals.length > 2)
            headEl.createSpan({ cls: "bns-chip bns-chip-more", text: "+" + (vals.length - 2) });
        }
        headEl.createSpan({ cls: "bns-mtime", text: humanAgo(file.stat.mtime) });

        idx++;
        if (idx > maxNotes) {
          itemEl.createDiv({ cls: "bns-placeholder", text: "…（超出「最多预览条数」上限，点标题打开）" });
          continue;
        }

        const bodyEl = itemEl.createDiv({ cls: "bns-body bns-loading", text: "滚动到此处自动加载正文…" });
        const item = { file, bodyEl, chars, state: "pending" };
        bodyEl.__bnsItem = item;
        this.items.push(item);
        if (this.observer) this.observer.observe(bodyEl);
      }
    }

    this.updateBar();
    if (keepScroll) {
      try {
        this.rootEl.scrollTop = keepScroll;
      } catch (e) {}
    }
  }

  updateBar() {
    const total = this.data && Array.isArray(this.data.data) ? this.data.data.length : 0;
    const done = this.items.filter((i) => i.state === "done").length;
    const cap = this.optNum("maxNotes", 40);
    this.countEl.setText(
      "共 " + total + " 篇 · 已渲染 " + done + " 篇" + (total > cap ? "（前 " + cap + " 篇）" : "")
    );
  }

  /* ---------- 懒加载队列 ---------- */
  enqueue(item) {
    if (!item || item.state !== "pending") return;
    item.state = "queued";
    this.queue.push(item);
    this.pump();
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift();
        if (!item || item.state !== "queued") continue;
        item.state = "rendering";
        await this.renderBody(item);
        item.state = "done";
        this.updateBar();
      }
    } finally {
      this.pumping = false;
    }
  }

  async renderBody(item) {
    const file = item.file;
    let raw = "";
    try {
      raw = await this.app.vault.cachedRead(file);
    } catch (e) {
      raw = "";
    }

    let body = raw;
    try {
      let info = null;
      if (typeof obsidian.getFrontMatterInfo === "function") info = obsidian.getFrontMatterInfo(raw);
      if (info && typeof info.contentStart === "number") body = raw.slice(info.contentStart);
      else body = raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    } catch (e) {
      body = raw;
    }

    /* 正文开头的 H1 常与文件名重复，去掉一个更省纵向空间 */
    const h1 = body.match(/^\s*#\s+(.+?)[ \t]*\r?\n/);
    if (h1 && h1[1].trim() === String(file.basename).trim()) body = body.slice(h1[0].length);
    body = body.replace(/^\s+/, "");

    let truncated = false;
    if (body.length > item.chars) {
      body = body.slice(0, item.chars);
      truncated = true;
    }
    body = balanceFences(body);

    const el = item.bodyEl;
    el.removeClass("bns-loading");
    el.empty();
    try {
      await MarkdownRenderer.render(this.app, body, el, file.path, this);
    } catch (e) {
      el.empty();
      el.createDiv({ cls: "bns-error", text: "正文渲染失败：" + (e && e.message ? e.message : String(e)) });
    }
    if (truncated) {
      el.createDiv({ cls: "bns-more", text: "…（已截断，全文约 " + raw.length + " 字 · 点标题看全文）" });
    }
  }

  /* ---------- 视图选项 ---------- */
  static getViewOptions() {
    return [
      {
        displayName: "正文预览字数",
        type: "slider",
        key: "chars",
        min: 100,
        max: 3000,
        step: 50,
        default: 600,
        instant: true,
      },
      {
        displayName: "最多预览条数",
        type: "slider",
        key: "maxNotes",
        min: 5,
        max: 300,
        step: 5,
        default: 40,
      },
      {
        displayName: "显示属性行",
        type: "toggle",
        key: "showMeta",
        default: true,
      },
    ];
  }
}

class BasesPreviewPlugin extends Plugin {
  async onload() {
    const ok = this.registerBasesView(VIEW_TYPE, {
      name: VIEW_NAME,
      icon: "lucide-scroll-text",
      factory: (controller, containerEl) => new NoteStreamView(controller, containerEl),
      options: NoteStreamView.getViewOptions,
    });
    if (!ok) {
      console.warn("[bases-preview] 注册 Bases 视图失败：核心插件 Bases 似乎没启用。");
    }
  }
}

module.exports = BasesPreviewPlugin;

KB.modules.BasesPreviewPlugin = module.exports;
})();
/* ===== KB-EMBED:BasesPreviewPlugin END ===== */

/* ===== 10_core_registry.js ===== */
/* 模块注册制：可分享 / 可扩展 / 可维护的核心。
 * 新功能 = 写一个模块类 {id, onEnable(), onDisable()} → registry.define() 即接入设置页与生命周期。 */
KB.define("core/registry", function () {
  function ModuleRegistry(plugin) {
    this.plugin = plugin;
    this.defs = [];        // [{id, modClass}]
    this.active = {};      // id -> instance
  }
  ModuleRegistry.prototype.define = function (id, modClass) {
    this.defs.push({ id: id, modClass: modClass });
  };
  /** 按 settings.modules 开关启用；③ 更多的 Base 是总闸，其子开关见 base.* */
  ModuleRegistry.prototype.isEnabled = function (id) {
    var m = this.plugin.settings.modules;
    if (id === "automation") return m.automation === true;
    if (id === "rebuild") return m.rebuild === true;
    if (id === "board") return m.base === true && m["base.creationBoard"] !== false;
    if (id === "stream") return m.base === true && m["base.noteStream"] !== false;
    return false;
  };
  ModuleRegistry.prototype.defById = function (id) {
    for (var i = 0; i < this.defs.length; i++) if (this.defs[i].id === id) return this.defs[i];
    return null;
  };
  ModuleRegistry.prototype.enableConfigured = async function () {
    for (var i = 0; i < this.defs.length; i++) {
      var d = this.defs[i];
      if (!this.isEnabled(d.id)) continue;
      var inst = new d.modClass(this.plugin);
      await inst.onEnable();
      this.active[d.id] = inst;
    }
  };
  /** 单个模块启停（设置页拨开关后即时生效，不必重载插件） */
  ModuleRegistry.prototype.enable = async function (id) {
    if (this.active[id]) return false;
    var d = this.defById(id);
    if (!d) return false;
    var inst = new d.modClass(this.plugin);
    await inst.onEnable();
    this.active[id] = inst;
    return true;
  };
  ModuleRegistry.prototype.disable = async function (id) {
    var inst = this.active[id];
    if (!inst) return false;
    try { await inst.onDisable(); } catch (e) { console.error("[kb-toolkit] 停用模块失败", id, e); }
    delete this.active[id];
    return true;
  };
  /**
   * R6：把「在跑的模块」对齐到「settings.modules 现状」。
   * 🔴 设置页拨开关只改了 settings，模块实例还活着 → 关了开关命令照样能执行（boss 报的 bug）。
   * 返回变更清单（"‑rebuild" 之类）供断言与调试。
   */
  ModuleRegistry.prototype.refresh = async function () {
    var changed = [];
    for (var i = 0; i < this.defs.length; i++) {
      var id = this.defs[i].id;
      var want = this.isEnabled(id);
      var has = !!this.active[id];
      if (want && !has) { if (await this.enable(id)) changed.push("+" + id); }
      else if (!want && has) { if (await this.disable(id)) changed.push("-" + id); }
    }
    return changed;
  };
  ModuleRegistry.prototype.isActive = function (id) { return !!this.active[id]; };
  /**
   * R7：配置变了（库根名 / 路由表 / 模板 / 排除规则）→ 让**在跑的模块**就地重建自己的运行时。
   * 与 refresh() 的分工：refresh 管「该不该跑」，reapply 管「跑着的那个该不该换脑子」。
   * 不重启命令、不换实例，所以不会丢监听；模块没实现 onConfigure 就跳过。
   */
  ModuleRegistry.prototype.reapply = async function () {
    var changed = [];
    for (var id in this.active) {
      var inst = this.active[id];
      if (!inst || typeof inst.onConfigure !== "function") continue;
      try { await inst.onConfigure(); changed.push(id); }
      catch (e) { console.error("[kb-toolkit] 重配模块失败", id, e); }
    }
    return changed;
  };
  ModuleRegistry.prototype.disableAll = async function () {
    for (var id in this.active) {
      try { await this.active[id].onDisable(); } catch (e) { console.error("[kb-toolkit] 停用模块失败", id, e); }
    }
    this.active = {};
  };
  KB.service("registry", ModuleRegistry);
  return ModuleRegistry;
});

/* ===== 15_core_quiet.js ===== */
/* 静默窗口（R9）：重建 / 回滚这类「成批搬文件」的操作期间，② 笔记自动化必须让路。
 *
 * 🔴 起因（实验库真机实证，老板报的 5/6/7 条）：
 *   回滚阶段 A 把「本轮新建目录里的外来户」rename 进 `回滚保留-<戳>/`，这会触发 vault 的
 *   rename 事件 → ② 的路由读到那篇笔记的「文件位置」属性 → 算出目标目录就在新知识库里
 *   → 立刻又把它搬回去。结果收容文件夹空了、新库目录仍旧「非空」→ 回滚 blocked
 *   「目录非空 → 保留」、自检报「新建根仍存在」→ 老板看到「回滚无法完成」。
 *   执行时同理：manifest 的搬运会被路由再抢一次，出现「有文件没有成功迁移整理」。
 *
 * 做法：一个挂在 plugin 上的**时间窗**（不是布尔），开了之后
 *   · 事件总线 enqueue 直接丢弃新事件；
 *   · 派发回调**再校验一次**（事件可能在关窗前排队、关窗后才到点）；
 *   · 自动化 handler / handle / tryCreateFill 首段各挡一道（防御性）。
 * 🔴 关窗必须**晚于事件总线的封顶延时**才放行，否则最后一批排队事件会在关窗后落地。
 * 🔴 不用定时器：靠 `until` 时间戳判定，可以注入 now 做确定性断言。
 */
KB.define("core/quiet", function () {
  /* 事件总线的封顶延时是 800ms（20_core_eventbus.js 的 MAX_WAIT.changed），
   * 关窗后要留出比它更大的余量，让排队中的事件先自然过期。 */
  var SETTLE_MS = 1200;
  var KEY = "__kbQuiet";

  function box(plugin) {
    if (!plugin) return null;
    if (!plugin[KEY] || typeof plugin[KEY] !== "object") {
      plugin[KEY] = { active: false, reason: "", until: 0, hits: 0, lastReason: "" };
    }
    return plugin[KEY];
  }

  /** 现在是否处于静默窗口；now 可注入（测试用） */
  function isQuiet(plugin, now) {
    var b = box(plugin);
    if (!b || !b.active) return false;
    var t = (now === undefined) ? Date.now() : now;
    return t < b.until;
  }

  /** 开窗：ms 默认 SETTLE_MS */
  function begin(plugin, reason, ms) {
    var b = box(plugin);
    if (!b) return false;
    b.active = true;
    b.reason = reason || "";
    b.lastReason = b.reason;
    b.until = Date.now() + ((typeof ms === "number") ? ms : SETTLE_MS);
    b.hits = 0;
    return true;
  }

  /** 收工：把放行时刻推到 now + ms（默认 SETTLE_MS），让排队事件先过期 */
  function end(plugin, ms) {
    var b = box(plugin);
    if (!b) return false;
    var wait = (typeof ms === "number") ? ms : SETTLE_MS;
    if (!b.active) { b.active = true; b.reason = b.reason || "settle"; }
    b.until = Date.now() + wait;
    return true;
  }

  /** 立刻放行（异常兜底 / 测试用） */
  function clear(plugin) {
    var b = box(plugin);
    if (!b) return false;
    b.active = false; b.reason = ""; b.until = 0;
    return true;
  }

  /** 记一次「本可以动库、被静默挡住」的调用（诊断用） */
  function note(plugin) {
    var b = box(plugin);
    if (b) b.hits++;
    return b ? b.hits : 0;
  }

  function state(plugin) {
    var b = box(plugin);
    return b ? { active: b.active, reason: b.reason, until: b.until, hits: b.hits,
      lastReason: b.lastReason } : null;
  }

  /** 包一层：静默期内跳过 fn，返回 {skipped:true}（给自动化入口用，读起来一目了然） */
  function guard(plugin, fn) {
    return function () {
      if (isQuiet(plugin)) { note(plugin); return { skipped: true, reason: "quiet" }; }
      return fn.apply(this, arguments);
    };
  }

  KB.service("quiet", { SETTLE_MS: SETTLE_MS, isQuiet: isQuiet, begin: begin, end: end,
    clear: clear, note: note, state: state, guard: guard });
  return { SETTLE_MS: SETTLE_MS, isQuiet: isQuiet, begin: begin, end: end, clear: clear, state: state };
});

/* ===== 20_core_eventbus.js ===== */
/* 事件总线：vault/metadataCache 事件统一分发，按文件 debounce 去重。
 * 取代 note-locator 时代的 setTimeout(500) 补丁；批量移动（新建知识库）时天然合并风暴。
 * 🔴 R7 修的坑：同一条路径的事件必须**按种类合并**，不能后来者覆盖前者。
 *   真机新建一篇笔记的顺序是 create → metadataCache.changed（同一路径）。旧实现里
 *   changed 会把还没到点的 create 计时器清掉、把自己排进去，结果 kind 变成 "changed"，
 *   `tryCreateFill` 那一支永远不执行 —— 4 篇 0 字节的「未命名.md」就是这么来的。
 *   现在改成 kinds 集合累积 + 取最长延时 + 派发时按 create > rename > changed 取优先级。
 * 🔴 R8 提速：原来 create 写死等 800ms（怕 Templater 还没落笔），用户体感「新建要等半秒到一秒」。
 *   改成**自适应**：起步只等 180ms（无干扰就直接补全）；这期间只要同一条路径又来事件
 *   （Templater 落笔 → metadataCache.changed），就再续 180ms，累计不超过 800ms。
 *   于是「安静的新建」快到 180ms，「热闹的新建」照样等得住。 */
KB.define("core/eventBus", function () {
  var DEFAULT_DELAY = { create: 180, rename: 0, changed: 180 };
  /* 单条路径最多等多久（防止持续写入把补全无限期推迟） */
  var MAX_WAIT = { create: 800, rename: 0, changed: 800 };
  /* 派发优先级：create 最重（它带着「是否要补全」的判断），其余只需触发一次 reroute */
  var KIND_ORDER = ["create", "rename", "changed"];

  function EventBus(plugin) {
    this.plugin = plugin;
    this.handlers = [];
    this.pending = {};     // path -> {kinds, file, delay, timer}
    this.started = false;
  }
  /** R9：重建/回滚期间整条总线静默（KB.services.quiet 的开窗期）。
   *  这类操作一次要搬几十个文件，事件全喂给 ② 只会造成「搬完又被搬回去」。 */
  EventBus.prototype.quiet = function () {
    var q = KB.services.quiet;
    return !!(q && q.isQuiet && q.isQuiet(this.plugin));
  };
  EventBus.prototype.on = function (h) { this.handlers.push(h); return h; };
  EventBus.prototype.off = function (h) {
    var i = this.handlers.indexOf(h);
    if (i >= 0) this.handlers.splice(i, 1);
  };
  /** 合并后的实际派发种类（不从 kinds 里删，便于重复调用时结果稳定） */
  function pickKind(kinds) {
    for (var i = 0; i < KIND_ORDER.length; i++) if (kinds[KIND_ORDER[i]]) return KIND_ORDER[i];
    return "changed";
  }
  /** 这堆种类允许的最长等待（取其中最大的那个上限） */
  function capFor(kinds) {
    var cap = 0;
    for (var k in kinds) if (kinds[k]) cap = Math.max(cap, MAX_WAIT[k] || 800);
    return cap || 800;
  }
  EventBus.prototype.enqueue = function (kind, file, delay, oldPath) {
    if (!file || file.extension !== "md" || !this.handlers.length) return;
    /* R9：静默窗口内进来的事件直接丢弃（重建/回滚一次要搬几十个文件）。 */
    if (this.quiet()) { var q = KB.services.quiet; if (q && q.note) q.note(this.plugin); return; }
    var self = this;
    var path = file.path;
    var old = this.pending[path];
    var kinds = old ? old.kinds : {};
    kinds[kind] = true;
    /* R11（boss 第 1 条）：rename 要带上 oldPath —— 手动拖动是一次「跨目录 rename」，
     * 处理端要靠它区分「用户在拖」和「插件自己在搬」。 */
    var op = oldPath || (old && old.oldPath) || null;
    var d = (delay === undefined ? DEFAULT_DELAY[kind] : delay) || 0;
    /* R8 自适应续期：起步 180ms；每来一个同路径事件就按它自己的延时再续一截，累计不超过 capFor。
     * 旧实现是 max(old.delay, d) —— 每个事件都把 deadline 重新推 800ms，白等。
     * 注意续期量用**事件自己的 delay**（不是固定步长），这样显式传小延时的调用方行为可预期。 */
    var wait;
    /* R15 修：MAX_WAIT 封的本该是「从**第一次入队**算起的总时长」—— 原来只封单次
     * 续期量，而 old.delay 不随时间衰减，持续写入每个事件都能把完整 800ms 重推，
     * 注释承诺的「防止无限期推迟」从未生效。现记录 firstAt，总期限到了立即派发。 */
    var now = Date.now();
    var firstAt = (old && old.firstAt) || now;
    var remain = firstAt + capFor(kinds) - now;
    if (old) wait = Math.min(old.delay + d, remain > 0 ? remain : 0);
    else wait = Math.min(d, capFor(kinds));
    if (old && old.timer) clearTimeout(old.timer);
    var entry = { kinds: kinds, file: file, delay: wait, timer: null, oldPath: op, firstAt: firstAt };
    entry.timer = setTimeout(function () {
      delete self.pending[path];
      /* R9：事件可能在**关窗之前**排队、**关窗之后**才到点 —— 到点必须再校验一次，
       * 否则最后一批（≤800ms）事件会漏过闸门，等于没静默。 */
      if (self.quiet()) { var q2 = KB.services.quiet; if (q2 && q2.note) q2.note(self.plugin); return; }
      var k = pickKind(kinds);
      for (var i = 0; i < self.handlers.length; i++) {
        try { self.handlers[i](k, entry.file, entry.oldPath); }
        catch (e) { console.error("[kb-toolkit] 事件处理失败", path, e); }
      }
    }, wait);
    this.pending[path] = entry;
  };
  EventBus.prototype.start = function () {
    if (this.started) return;
    var self = this;
    var p = this.plugin;
    p.registerEvent(p.app.vault.on("create", function (f) { self.enqueue("create", f); }));
    /* R11：rename 的第二个参数 oldPath 是「手动拖动」的判据，透传给处理端 */
    p.registerEvent(p.app.vault.on("rename", function (f, oldPath) { self.enqueue("rename", f, undefined, oldPath); }));
    p.registerEvent(p.app.metadataCache.on("changed", function (f) { self.enqueue("changed", f); }));
    this.started = true;
  };
  EventBus.prototype.stop = function () {
    for (var path in this.pending) if (this.pending[path].timer) clearTimeout(this.pending[path].timer);
    this.pending = {};
    this.started = false;
  };
  KB.service("eventBus", EventBus);
  EventBus.DEFAULT_DELAY = DEFAULT_DELAY;
  EventBus.MAX_WAIT = MAX_WAIT;
  return EventBus;
});

/* ===== 30_services_frontmatter.js ===== */
/* frontmatter 服务：processFrontMatter 原子读写封装（内部走 vault 队列，双同步库安全）。 */
KB.define("services/frontmatter", function () {
  function FmService(app) { this.app = app; }
  FmService.prototype.read = function (file) {
    if (!file || file.extension !== "md") return {};
    var cache = this.app.metadataCache.getFileCache(file);
    return (cache && cache.frontmatter) || {};
  };
  /** 原子改写 frontmatter；fn(fm) 就地改键。文件不存在/非 md 静默跳过。 */
  FmService.prototype.update = async function (file, fn) {
    if (!file || file.extension !== "md") return false;
    if (typeof this.app.fileManager.processFrontMatter !== "function") {
      console.warn("[kb-toolkit] 当前版本没有 fileManager.processFrontMatter");
      return false;
    }
    await this.app.fileManager.processFrontMatter(file, fn);
    return true;
  };
  KB.service("fm", FmService);
  return FmService;
});

/* ===== 36_services_templates.js ===== */
/* R7 模板服务：把「创建补全」从写死的一段 YAML 变成**可选的模板**。
 * 三件事：① 内置几套（PARA / 轻量 / 项目 / 资料）② 用户可改可另存 ③ 从已有笔记提取模板。
 * 占位符只有六个，一律 {{name}} 形式；渲染是纯字符串替换，模板里写不出副作用。
 * 存储：settings.automation.templates = { activeId, items:[{id,name,text}] }
 *   - items 里 id 与内置同名 → 那是**覆盖**（删掉该条 = 恢复内置）
 *   - items 里其它 id（user/…）→ 自建模板
 * 与 70_core_settings.js 的分工：这里只做「取/换/算」，不碰路径字面量，不自己落盘。 */
KB.define("services/templates", function () {
  var PLACEHOLDERS = [
    { key: "{{title}}",  desc: "笔记名（不含 .md）" },
    { key: "{{date}}",   desc: "创建日期 YYYY-MM-DD" },
    { key: "{{folder}}", desc: "所在目录（相对库根）" },
    { key: "{{center}}", desc: "所属中心页双链目标（按所在目录推）" },
    { key: "{{moc}}",    desc: "MOC 知识地图的链接" },
    { key: "{{kb}}",     desc: "库根目录名" }
  ];

  /* 内置模板：全部由占位符写成 —— 库根改名 / 换元目录都不需要动这里 */
  var BUILTIN = [
    {
      id: "builtin/para", name: "PARA 待整理（默认）",
      desc: "完整的八字段前言 + 关联笔记；不确定用哪套时用这套",
      text: [
        "---",
        "类型: 待整理",
        "领域: 未分类",
        "主题: {{title}}",
        "状态: 待整理",
        "创建日期: {{date}}",
        "tags:",
        "  - 待整理",
        "文件位置:",
        "  - {{folder}}",
        "---",
        "",
        "# {{title}}",
        "",
        "## 关联笔记",
        "- 所属中心：[[{{center}}]]",
        "- 返回 [[{{moc}}]]",
        ""
      ].join("\n")
    },
    {
      id: "builtin/light", name: "轻量收件",
      desc: "只要 tags 与日期，正文留够空白 —— 适合速记",
      text: [
        "---",
        "tags:",
        "  - 待整理",
        "创建日期: {{date}}",
        "---",
        "",
        "# {{title}}",
        "",
        "- 所属中心：[[{{center}}]]",
        ""
      ].join("\n")
    },
    {
      id: "builtin/project", name: "项目笔记",
      desc: "状态直接置为「进行中」，带目标 / 下一步两栏",
      text: [
        "---",
        "类型: 项目",
        "领域: 未分类",
        "主题: {{title}}",
        "状态: 进行中",
        "创建日期: {{date}}",
        "tags:",
        "  - 项目",
        "文件位置:",
        "  - {{folder}}",
        "---",
        "",
        "# {{title}}",
        "",
        "## 目标",
        "",
        "## 下一步",
        "",
        "## 关联笔记",
        "- 所属中心：[[{{center}}]]",
        "- 返回 [[{{moc}}]]",
        ""
      ].join("\n")
    },
    {
      id: "builtin/source", name: "资料收集",
      desc: "带「来源 / 摘要 / 我的想法」三段，适合剪藏后补",
      text: [
        "---",
        "类型: 资料",
        "领域: 未分类",
        "主题: {{title}}",
        "状态: 待整理",
        "来源:",
        "创建日期: {{date}}",
        "tags:",
        "  - 资料",
        "文件位置:",
        "  - {{folder}}",
        "---",
        "",
        "# {{title}}",
        "",
        "## 摘要",
        "",
        "## 我的想法",
        "",
        "## 关联笔记",
        "- 所属中心：[[{{center}}]]",
        "- 返回 [[{{moc}}]]",
        ""
      ].join("\n")
    }
  ];

  var DEFAULT_ID = BUILTIN[0].id;

  /** 模板表：内置（可被 items 覆盖）+ 自建，顺序 = 内置在前、自建按加入顺序 */
  function list(settings) {
    var t = cfg(settings);
    var items = (t && t.items) || [];
    var out = [];
    for (var i = 0; i < BUILTIN.length; i++) {
      var b = BUILTIN[i], ov = null;
      for (var j = 0; j < items.length; j++) if (items[j] && items[j].id === b.id) ov = items[j];
      out.push(ov ? { id: b.id, name: ov.name || b.name, desc: b.desc, text: ov.text, overridden: true }
                  : { id: b.id, name: b.name, desc: b.desc, text: b.text, overridden: false });
    }
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      if (it && it.id && !builtinById(it.id)) out.push({ id: it.id, name: it.name || it.id, desc: "自建", text: it.text || "" });
    }
    return out;
  }
  function builtinById(id) {
    for (var i = 0; i < BUILTIN.length; i++) if (BUILTIN[i].id === id) return BUILTIN[i];
    return null;
  }
  function get(settings, id) {
    var all = list(settings);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    for (var j = 0; j < all.length; j++) if (all[j].id === DEFAULT_ID) return all[j];
    return all[0];
  }
  /** 当前生效模板（activeId 失效 → 回落到默认内置，绝不返回空模板） */
  function active(settings) {
    var id = (cfg(settings) || {}).activeId || DEFAULT_ID;
    return get(settings, id);
  }
  function cfg(settings) {
    return (settings && settings.automation && settings.automation.templates) || null;
  }
  function ensure(settings) {
    if (!settings.automation) settings.automation = {};
    if (!settings.automation.templates || typeof settings.automation.templates !== "object")
      settings.automation.templates = { activeId: DEFAULT_ID, items: [] };
    var t = settings.automation.templates;
    if (!Array.isArray(t.items)) t.items = [];
    if (!t.activeId) t.activeId = DEFAULT_ID;
    return t;
  }
  function setActive(settings, id) { ensure(settings).activeId = id; return active(settings); }
  function items(settings) { return ensure(settings).items; }
  function findItem(settings, id) {
    var arr = items(settings);
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function nextId(settings) {
    var arr = items(settings), n = 1;
    for (; n < 1000; n++) {
      var id = "user/" + n, dup = false;
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) dup = true;
      if (!dup) return id;
    }
    return "user/" + Date.now();
  }
  /**
   * 保存一份模板。id 命中已有条目 → 覆盖；命中内置 id → 覆盖该内置；都不中 → 新建（分配 user/N）。
   * 返回落定后的条目。
   */
  function save(settings, id, name, text) {
    var t = ensure(settings);
    var target = id || nextId(settings);
    var it = findItem(settings, target);
    if (!it) {
      it = { id: target, name: "", text: "" };
      t.items.push(it);
    }
    if (name) it.name = String(name);
    it.text = String(text == null ? "" : text);
    if (!it.name) {
      var b = builtinById(target);
      it.name = (b ? b.name : "我的模板 " + target.split("/").pop());
    }
    if (!t.activeId || get(settings, t.activeId) === undefined) t.activeId = target;
    return it;
  }
  /** 删除一条：内置 id = 恢复内置；自建 = 真的删掉。若删的是 active → 回落默认 */
  function remove(settings, id) {
    var t = ensure(settings), arr = t.items, hit = -1;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) hit = i;
    if (hit < 0) return false;
    arr.splice(hit, 1);
    if (t.activeId === id) t.activeId = DEFAULT_ID;
    return true;
  }
  function isCustom(settings, id) { return !builtinById(id) && !!findItem(settings, id); }

  /**
   * 渲染：只替换**内置的六个**占位符，其余原样落笔。
   * 故意不把「不认识的 {{xxx}}」清成空串 —— 模板里写错了要看得见（否则新笔记里凭空多个洞）。
   */
  function render(text, ctx) {
    ctx = ctx || {};
    var map = { title: ctx.title, date: ctx.date, folder: ctx.folder,
      center: ctx.center, moc: ctx.moc, kb: ctx.kb };
    var s = String(text == null ? "" : text)
      .replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, function (m, k) {
        var key = String(k).toLowerCase();
        /* R15 修：用 hasOwnProperty —— `in` 沿原型链，{{constructor}} 之类会把
         * Object 内置方法的源码替换进新笔记（违背「不认识的占位符原样保留」） */
        if (!Object.prototype.hasOwnProperty.call(map, key)) return m;   /* 不认识的 → 原样留着 */
        var v = map[key];
        return (v === undefined || v === null) ? "" : String(v);
      });
    if (s.length && s.charAt(s.length - 1) !== "\n") s += "\n";
    return s;
  }

  /* ---- 从已有笔记反推模板 ----
   * 规则刻意保守：只把「明显是这篇笔记私有」的字段换成占位符，其余原样保留。
   * 值里出现原笔记标题的地方也换成 {{title}}，这样同一套模板套到新笔记上就对。 */
  var RE_TITLE_KEY = /^(主题|标题|title|name|名称)$/i;
  var RE_DATE_KEY = /^(创建日期|更新日期|日期|date|created|created_date|updated)$/i;
  var RE_LOC_KEY = /^(文件位置|位置|folder|path|路径)$/i;

  function extract(rawText, opts) {
    opts = opts || {};
    var raw = String(rawText == null ? "" : rawText).replace(/^\uFEFF/, "");
    var title = String(opts.title || "").trim();
    function subTitle(s) {
      if (!title) return s;
      /* R15 修：删掉原来的 no-op replace（回调原样返回 m，什么都不做）——
       * 245 行的 split/join 已把别名链接里的标题一并换掉，原注释声称的保护从未生效 */
      return String(s).split(title).join("{{title}}");
    }
    var m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    var fmText = m ? m[1] : "";
    var body = m ? raw.slice(m[0].length) : raw;

    var fmLines = [];
    var inLoc = false;
    if (fmText) {
      var lines = fmText.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var kv = line.match(/^([^:\s][^:]*):(.*)$/);
        if (kv) {
          var key = kv[1].trim(), val = kv[2].trim();
          inLoc = RE_LOC_KEY.test(key);
          if (inLoc) val = "";
          else if (val && RE_TITLE_KEY.test(key)) val = "{{title}}";
          else if (val && RE_DATE_KEY.test(key)) val = "{{date}}";
          else if (val) val = subTitle(val);
          fmLines.push(key + ":" + (val ? " " + val : ""));
          continue;
        }
        var li = line.match(/^(\s*-\s+)(.*)$/);
        if (li) {
          fmLines.push(li[1] + (inLoc ? "{{folder}}" : subTitle(li[2].trim())));
          continue;
        }
        fmLines.push(inLoc ? line : subTitle(line));
      }
    }

    /* 正文：中心链 / MOC 返回链换成占位符，其余原样 */
    var bodyLines = String(body).split(/\r?\n/).map(function (line) {
      if (/^\s*[-*]\s*.*所属中心/.test(line)) return "- 所属中心：[[{{center}}]]";
      if (/^\s*[-*]\s*.*返回\s*\[\[/.test(line)) return "- 返回 [[{{moc}}]]";
      return subTitle(line);
    });

    var out = [];
    if (fmLines.length) out.push("---", fmLines.join("\n"), "---");
    out.push(bodyLines.join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n"));
    var text = out.join("\n");
    if (text.charAt(text.length - 1) !== "\n") text += "\n";
    return text;
  }

  /* ================= R8：模板以「文件为准」 =================
   * 落点：<库根>/<元目录>/02_模板库/Templater/*.md（老板指定的位置）
   *   一个 .md = 一套模板：文件名 = 模板名，正文 = 模板正文。
   * 于是「在 Obsidian 里直接改」和「在设置页里改」是同一份东西，不会各说各话。
   * id 约定："file:<文件名不含 .md>"（带前缀，与内置 id 天然不撞车）。
   * 目录里已经有 .md 时，内置四套不再出现在候选里（避免和文件重名两套东西）；
   * 目录还是空的 → 内置四套作为候选项出现，**点保存时才落盘**成文件。 */
  var FILE_PREFIX = "file:";
  var CACHE_TTL = 2000;
  var cache = { dir: null, at: 0, res: null };

  /** 模板目录（默认由 paths 派生 → 换库根/元目录自动跟随；配置写了 dir 就用写的） */
  function dirFor(settings) {
    var t = cfg(settings) || {};
    if (t.dir) return String(t.dir).replace(/\/+$/, "");
    var paths = (settings && settings.paths) || {};
    return [paths.knowledgeBase, paths.metaDir, t.subDir]
      .filter(function (x) { return !!x; }).join("/");
  }
  function isFileId(id) { return String(id == null ? "" : id).indexOf(FILE_PREFIX) === 0; }
  function nameOfPath(p) { return String(p || "").split("/").pop().replace(/\.md$/i, ""); }
  function idForName(name) { return FILE_PREFIX + String(name || "").trim(); }

  /** 扫描模板目录（2s 缓存 —— 批量补全时不会每篇都读盘）。返回 {dir, items, error} */
  function scan(app, settings, opts) {
    opts = opts || {};
    var dir = dirFor(settings);
    var now = Date.now();
    if (!opts.force && cache.dir === dir && cache.res && (now - cache.at) < CACHE_TTL) return cache.res;
    var items = [], err = null;
    try {
      var folder = app && app.vault ? app.vault.getAbstractFileByPath(dir) : null;
      if (folder && folder.children) {
        for (var i = 0; i < folder.children.length; i++) {
          var c = folder.children[i];
          if (!c || c.children !== undefined) continue;      /* 子目录里的不算模板 */
          if (!/\.md$/i.test(c.path || "")) continue;
          items.push({ id: idForName(nameOfPath(c.path)), name: nameOfPath(c.path),
            path: c.path, file: c, text: null });
        }
        items.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
      }
    } catch (e) { err = String((e && e.message) || e); }
    var res = { dir: dir, items: items, error: err };
    cache = { dir: dir, at: now, res: res };
    return res;
  }
  function invalidate() { cache = { dir: null, at: 0, res: null }; }

  /** 读某个文件模板的正文（懒加载 + 缓存） */
  async function readFileText(app, settings, id) {
    var sc = scan(app, settings);
    for (var i = 0; i < sc.items.length; i++) {
      if (sc.items[i].id !== id) continue;
      if (sc.items[i].text === null) {
        var f = sc.items[i].file;
        try {
          sc.items[i].text = app.vault.cachedRead ? await app.vault.cachedRead(f) : (f.content || "");
        } catch (e) { sc.items[i].text = f.content || ""; }
      }
      return sc.items[i].text;
    }
    return null;
  }

  /**
   * 候选模板全表（设置页下拉用）：
   *   模板库文件 → 设置里的自建（R7 遗留，不让人丢） → 目录为空时补上内置四套。
   */
  function listAll(settings, sc) {
    sc = sc || { items: [] };
    var files = sc.items || [], out = [], haveName = {}, i;
    for (i = 0; i < files.length; i++) {
      haveName[files[i].name] = true;
      out.push({ id: files[i].id, name: files[i].name, desc: "模板库文件", path: files[i].path,
        source: "file", text: files[i].text });
    }
    var arr = items(settings);
    for (i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (it && it.id && !builtinById(it.id))
        out.push({ id: it.id, name: it.name || it.id, desc: "自建（存在配置里）",
          source: "settings", text: it.text == null ? "" : it.text });
    }
    if (!files.length) {
      for (i = 0; i < BUILTIN.length; i++) {
        var b = BUILTIN[i], ov = findItem(settings, b.id);
        if (haveName[b.name]) continue;
        out.push({ id: b.id, name: (ov && ov.name) || b.name,
          desc: b.desc + "（内置 · 还没落盘成文件）", source: "builtin",
          text: (ov && ov.text != null) ? ov.text : b.text, overridden: !!ov });
      }
    }
    return out;
  }

  /** 按 id 解析出一套模板（文件 → 设置自建 → 内置）；找不到返回 null。
   *  R17：文件模板额外带上 `file`（交给 Templater 求值时要当 template_file 用）。 */
  async function resolveText(app, settings, id) {
    if (isFileId(id)) {
      var t = await readFileText(app, settings, id);
      if (t !== null) {
        var sc = scan(app, settings), tf = null;
        for (var k = 0; k < sc.items.length; k++) if (sc.items[k].id === id) tf = sc.items[k].file;
        return { id: id, name: nameOfPath(String(id).slice(FILE_PREFIX.length)),
          text: t, source: "file", file: tf };
      }
    }
    var arr = items(settings);
    for (var i = 0; i < arr.length; i++)
      if (arr[i] && arr[i].id === id)
        return { id: id, name: arr[i].name || id, text: arr[i].text == null ? "" : arr[i].text, source: "settings" };
    var b = builtinById(id);
    if (b) return { id: b.id, name: b.name, text: b.text, source: "builtin" };
    return null;
  }

  /**
   * 当前生效模板。activeId 指向的东西被改名/删掉了 → 依次退到
   * 「模板库第一套文件」→「内置默认」，**绝不返回空模板**（否则新笔记会是空文件）。
   */
  async function activeTemplate(app, settings) {
    var id = (cfg(settings) || {}).activeId || DEFAULT_ID;
    var t = await resolveText(app, settings, id);
    if (t) return t;
    var sc = scan(app, settings);
    if (sc.items && sc.items.length) {
      var first = await resolveText(app, settings, sc.items[0].id);
      if (first) return first;
    }
    return { id: DEFAULT_ID, name: BUILTIN[0].name, text: BUILTIN[0].text, source: "builtin" };
  }

  /* ---- 套用规则：哪个文件夹 / 标签下的新笔记用哪套模板 ---- */
  function rulesList(settings) {
    var a = settings && settings.automation;
    if (!a) return [];
    if (!Array.isArray(a.templateRules)) a.templateRules = [];
    return a.templateRules;
  }
  function nextRuleId(settings) {
    var arr = rulesList(settings), n = 1;
    for (; n < 1000; n++) {
      var id = "rule/" + n, dup = false;
      for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) dup = true;
      if (!dup) return id;
    }
    return "rule/" + Date.now();
  }
  function normTag(s) { return String(s == null ? "" : s).replace(/^#/, "").trim().toLowerCase(); }
  /**
   * 解析该用哪套模板：**标签规则优先 → 文件夹规则（最长前缀）→ null（= 用 activeId）**。
   * 返回 { templateId, why, ruleId } 或 null。
   */
  function ruleFor(settings, folderPath, tags) {
    var list = rulesList(settings), i;
    var tg = [];
    for (i = 0; i < (tags || []).length; i++) tg.push(normTag(tags[i]));
    for (i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || r.kind !== "tag" || !r.value || !r.templateId) continue;
      if (tg.indexOf(normTag(r.value)) >= 0)
        return { templateId: r.templateId, why: "标签 " + r.value, ruleId: r.id };
    }
    var fp = String(folderPath == null ? "" : folderPath), best = null, bestLen = -1;
    for (i = 0; i < list.length; i++) {
      var r2 = list[i];
      if (!r2 || r2.kind !== "folder" || !r2.value || !r2.templateId) continue;
      var v = String(r2.value).replace(/\/+$/, "");
      if (!v) continue;
      if ((fp === v || fp.indexOf(v + "/") === 0) && v.length > bestLen) { best = r2; bestLen = v.length; }
    }
    if (best) return { templateId: best.templateId, why: "目录 " + best.value, ruleId: best.id };
    return null;
  }

  /* ---- 写盘：模板文件 ---- */
  function safeName(name) {
    var s = String(name == null ? "" : name).trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "");
    return s || "未命名模板";
  }
  async function ensureDir(v, dir) {
    var segs = String(dir).split("/").filter(function (s) { return s.length > 0; });
    var cur = "";
    for (var i = 0; i < segs.length; i++) {
      cur = cur ? cur + "/" + segs[i] : segs[i];
      if (v.getAbstractFileByPath(cur)) continue;
      await v.createFolder(cur);
    }
    return true;
  }
  /** 建/改一套模板文件。返回 {ok, path, name} 或 {ok:false, reason} */
  async function writeFile(app, settings, name, text) {
    var v = app && app.vault;
    if (!v) return { ok: false, reason: "no-vault" };
    var clean = safeName(name);
    var dir = dirFor(settings);
    var path = dir + "/" + clean + ".md";
    var body = String(text == null ? "" : text);
    try {
      await ensureDir(v, dir);
      var f = v.getAbstractFileByPath(path);
      if (f) {
        if (typeof v.process === "function") await v.process(f, function () { return body; });
        else if (typeof v.modify === "function") await v.modify(f, body);
        else await v.adapter.write(path, body);
      } else {
        f = await v.create(path, body);
      }
      invalidate();
      return { ok: true, path: path, name: clean, file: f };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
  }
  /** 删除一套模板文件（走回收站，不硬删） */
  async function removeFile(app, settings, id) {
    var v = app && app.vault;
    if (!v) return { ok: false, reason: "no-vault" };
    var sc = scan(app, settings);
    for (var i = 0; i < sc.items.length; i++) {
      if (sc.items[i].id !== id) continue;
      var f = sc.items[i].file;
      try {
        var fm = app.fileManager;
        if (fm && typeof fm.trashFile === "function") await fm.trashFile(f);
        else await v.delete(f, true);
        invalidate();
        return { ok: true, path: sc.items[i].path };
      } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
    }
    return { ok: false, reason: "not-found" };
  }
  /** 把内置四套落盘成文件（目录里已有 .md 时不动，除非 opts.force） */
  async function seedBuiltins(app, settings, opts) {
    opts = opts || {};
    var sc = scan(app, settings, { force: true });
    if ((sc.items || []).length && !opts.force)
      return { ok: true, created: [], skipped: sc.items.length };
    var created = [], failed = [], i;
    for (i = 0; i < BUILTIN.length; i++) {
      var b = BUILTIN[i];
      var r = await writeFile(app, settings, b.name, b.text);
      if (r.ok) created.push(r.path); else failed.push(b.name + "：" + r.reason);
    }
    invalidate();
    return { ok: failed.length === 0, created: created, failed: failed };
  }

  /* ================= R17：Templater 桥 =================
   * 背景（2026-09-19 报障「新建笔记标签没成功创建」）：老板把「当前模板」指到了
   * 模板库（Templater 子目录）里的 T_*.md —— 那是 **Templater 脚本模板**，首行是
   * `<%* … %>---`。本插件只会替换 {{占位符}}，于是把 Templater 语法**原样写进新笔记**：
   * `---` 不在第 1 行 → Obsidian 不认前言 → 标签/属性全废（文件开头就是 `<%*`）。
   * 对策两条：
   *   ① 模板含 Templater 语法 → **先求值再落盘**；求不到就拒写（宁可空着，不写脏数据）；
   *   ② 该目录已被 Templater 的「目录模板」接管 → 本插件让路，不跟它抢同一篇新笔记。
   * 取证（Templater 2.18.1 main.js）：parse_template(runningConfig, content)，
   * runningConfig = {template_file, target_file, run_mode, active_file}，
   * RunMode.CreateNewFromTemplate = 0。 */

  var RE_TPL_SYNTAX = /<%[-_*]?[\s\S]*?[-_]?%>/;

  /** 文本里有没有 Templater 语法（粗判即可，目的是「别原样落盘」） */
  function hasTemplaterSyntax(text) {
    return RE_TPL_SYNTAX.test(String(text == null ? "" : text));
  }

  /** 取 Templater 实例；没装 / 没启用 / 结构变了 → null（调用方必须兜住） */
  function templaterApi(app) {
    var store = app && app.plugins && app.plugins.plugins;
    var p = store ? store["templater-obsidian"] : null;
    var t = p && p.templater;
    return (t && typeof t.parse_template === "function")
      ? { inst: t, plugin: p, settings: p.settings || {} } : null;
  }

  /**
   * 该目录是否被 Templater 的「目录模板」接管（最长前缀胜出）。
   * Templater 没开「新建文件触发」或没配目录模板 → 返回 null（它不会动手，本插件照常干活）。
   */
  function templaterFolderRule(app, folderPath) {
    var api = templaterApi(app);
    if (!api) return null;
    var st = api.settings;
    if (st.trigger_on_file_creation === false || st.enable_folder_templates === false) return null;
    var list = st.folder_templates || [], fp = String(folderPath == null ? "" : folderPath);
    var best = null, bestLen = -1;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || !r.folder || !r.template) continue;
      var v = String(r.folder).replace(/\/+$/, "");
      if (!v) continue;
      if ((fp === v || fp.indexOf(v + "/") === 0) && v.length > bestLen) { best = r; bestLen = v.length; }
    }
    return best ? { folder: best.folder, template: best.template } : null;
  }

  /** 交给 Templater 求值：成功 → {ok:true,text}；有异常 → {ok:false,reason}（绝不往外抛） */
  async function evalTemplater(app, tplFile, targetFile, text) {
    var api = templaterApi(app);
    if (!api) return { ok: false, reason: "templater-unavailable" };
    try {
      var active = null;
      try {
        active = (app.workspace && app.workspace.getActiveFile) ? app.workspace.getActiveFile() : null;
      } catch (e) { active = null; }
      var cfg = { template_file: tplFile || null, target_file: targetFile || null, run_mode: 0, active_file: active };
      var out = await api.inst.parse_template(cfg, String(text == null ? "" : text));
      if (typeof out !== "string") return { ok: false, reason: "templater-bad-output" };
      return { ok: true, text: out };
    } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
  }

  /**
   * 落盘前的唯一收口：模板文本 → 可以安全写进笔记的文本。
   * 返回 {ok:true, text, via:"plain"|"templater"} 或 {ok:false, reason}。
   * 底线：产出的文本里**不许再有 <% %>**（有就拒写 —— 绝不把 Templater 语法灌进笔记）。
   */
  async function materialize(app, tplFile, targetFile, text, ctx) {
    var raw = String(text == null ? "" : text);
    if (hasTemplaterSyntax(raw)) {
      var ev = await evalTemplater(app, tplFile, targetFile, raw);
      if (!ev.ok) return { ok: false, reason: ev.reason };
      if (hasTemplaterSyntax(ev.text)) return { ok: false, reason: "templater-output-has-syntax" };
      return { ok: true, text: render(ev.text, ctx), via: "templater" };
    }
    var out = render(raw, ctx);
    if (hasTemplaterSyntax(out)) return { ok: false, reason: "templater-syntax-not-evaluated" };
    return { ok: true, text: out, via: "plain" };
  }

  KB.service("templates", {
    PLACEHOLDERS: PLACEHOLDERS, BUILTIN: BUILTIN, DEFAULT_ID: DEFAULT_ID,
    /* R7 设置层 API（保持原样，别的地方还在用） */
    list: list, get: get, active: active, setActive: setActive, save: save, remove: remove,
    items: items, nextId: nextId, isCustom: isCustom, render: render, extract: extract,
    /* R8 文件层 */
    FILE_PREFIX: FILE_PREFIX, dirFor: dirFor, isFileId: isFileId, nameOfPath: nameOfPath,
    idForName: idForName, scan: scan, invalidate: invalidate, readFileText: readFileText,
    listAll: listAll, resolveText: resolveText, activeTemplate: activeTemplate,
    rulesList: rulesList, nextRuleId: nextRuleId, ruleFor: ruleFor, safeName: safeName,
    writeFile: writeFile, removeFile: removeFile, seedBuiltins: seedBuiltins,
    /* R17 · Templater 桥 */
    hasTemplaterSyntax: hasTemplaterSyntax, templaterApi: templaterApi,
    templaterFolderRule: templaterFolderRule, evalTemplater: evalTemplater, materialize: materialize
  });
  return { render: render, extract: extract, active: active };
});

/* ===== 40_services_router.js ===== */
/* 标签-目录路由服务：从 note-locator 原样移植（镜像规则逐字保留），仅两点改造：
 * ① 库根路径改为可配置（settings.paths.knowledgeBase），不再硬编码 01_新知识库；
 * ② 纯函数与 app 解耦，便于离线断言。 */
KB.define("services/router", function () {
  function firstProp(v) {
    if (Array.isArray(v)) v = v[0];
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    return String(v).trim();
  }
  /** R15 修：库根名拼正则前必须转义 —— 用户路径含 ( ) + [ ] 等字符时
   *  new RegExp 直接 SyntaxError，模块启用即崩（rebuild/settings 侧早有 escRe，这里补齐） */
  function escRe(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  /** 归一化：去 #、统一斜杠、去首尾斜杠、去库根前缀、小写 */
  function norm(s, root) {
    return String(s === null || s === undefined ? "" : s)
      .trim().replace(/^#+/, "").replace(/\\/g, "/")
      .replace(/^\/+/, "").replace(/\/+$/, "")
      .replace(new RegExp("^" + escRe(root) + "/"), "")
      .trim().toLowerCase();
  }
  /** 属性里显示的值：相对库根的路径 */
  function canonical(folderPath, root) {
    return String(folderPath).replace(new RegExp("^" + escRe(root) + "/"), "");
  }
  function isFolderFile(f) { return !!f && f.children !== undefined; }
  /** 一条路由能接受的写法：目录路径（含简写/末级名）+ 自定义值 */
  function routeKeys(route, root) {
    var keys = new Set();
    function add(v) { var n = norm(v, root); if (n) keys.add(n); }
    add(route.folder); add(canonical(route.folder, root));
    add(String(route.folder).split("/").pop());
    (route.values || []).forEach(add);
    return keys;
  }
  /* ---- R5：区域中心表配置化（此前把 01_新知识库/ 写死在这里） ----
   * 只登记「中心目录名 + 中心页文件名」，库根前缀一律从**真实路径**回构，
   * 所以 01_新知识库/02_Areas/内容创作 → 01_新知识库/02_Areas/_领域中心，
   * 换成「我的知识库/02_Areas/内容创作」就自动得到「我的知识库/02_Areas/_领域中心」，代码零改动。 */
  var CENTER_SPEC_DEFAULT = [
    { dir: "00_Inbox",     page: "_收件箱" },
    { dir: "01_Projects",  page: "_项目中心" },
    { dir: "02_Areas",     page: "_领域中心" },
    { dir: "03_Resources", page: "_资源中心" },
    { dir: "04_Archives",  page: "_归档中心" }
  ];
  var centerSpec = CENTER_SPEC_DEFAULT.slice();

  function slashes(p) {
    return String(p === null || p === undefined ? "" : p)
      .replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  }
  /** 从结构模板推导中心表：种子文件 `<顶层目录>/_中心页.md`（下划线开头即中心页约定） */
  function specsFromTemplate(template) {
    var seeds = (template && template.seedFiles) || [];
    var out = [];
    for (var i = 0; i < seeds.length; i++) {
      var parts = slashes(seeds[i]).split("/");
      if (parts.length !== 2) continue;
      var page = parts[1].replace(/\.md$/, "");
      if (page.charAt(0) !== "_") continue;
      var dup = false;
      for (var j = 0; j < out.length; j++) if (out[j].dir === parts[0]) dup = true;
      if (!dup) out.push({ dir: parts[0], page: page });
    }
    return out;
  }
  /** 设置中心表（传空 = 恢复默认）；返回生效值 */
  function setCenters(list) {
    centerSpec = (list && list.length) ? list.slice() : CENTER_SPEC_DEFAULT.slice();
    return centerSpec;
  }
  /** 按 settings 应用一次（entry / 模块 onEnable 调用） */
  function applySettings(settings) {
    var tpl = settings && settings.rebuild && settings.rebuild.template;
    var derived = specsFromTemplate(tpl);
    return setCenters(derived.length ? derived : null);
  }
  /**
   * 目录 → 中心页双链。命中中心目录（含其子目录）才返回；前缀取真实路径片段。
   * 长的目录名优先（层级更深者优先），避免短名误吃长名。
   */
  function centerFor(folderPath) {
    var p = slashes(folderPath);
    if (!p) return null;
    var best = null;
    for (var i = 0; i < centerSpec.length; i++) {
      var c = centerSpec[i];
      var hit = -1;
      if (p === c.dir) hit = 0;
      else {
        var idx = p.indexOf("/" + c.dir);
        while (idx >= 0) {
          var after = idx + 1 + c.dir.length;
          if (after === p.length || p.charAt(after) === "/") { hit = idx; break; }
          idx = p.indexOf("/" + c.dir, idx + 1);
        }
      }
      if (hit < 0) continue;
      if (!best || c.dir.length > best.dir.length)
        best = { dir: c.dir, link: (hit > 0 ? p.slice(0, hit) + "/" : "") + c.dir + "/" + c.page };
    }
    return best ? best.link : null;
  }
  /** 双链只比末级名 */
  function linkName(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/^\[\[/, "").replace(/\]\]$/, "")
      .replace(/\|.*$/, "").replace(/\\/g, "/")
      .split("/").pop().trim().toLowerCase();
  }
  function isLocked(fm) {
    var keys = ["位置锁定", "AutoNoteMover"];
    for (var i = 0; i < keys.length; i++) {
      var v = firstProp(fm[keys[i]]);
      if (v && /^(true|yes|是|1|disable)$/i.test(v)) return true;
    }
    return false;
  }

  /** Router：读 settings.automation（property/routes/excluded）+ settings.paths.knowledgeBase */
  function Router(cfg) { this.configure(cfg); }
  Router.prototype.configure = function (cfg) {
    /* R5：库根不再硬编码 —— 兜底取默认配置里的 paths.knowledgeBase（仍是配置，不是字面量） */
    var fallback = (KB.services.settings && KB.services.settings.DEFAULTS
      && KB.services.settings.DEFAULTS.paths.knowledgeBase) || "";
    this.root = (cfg && cfg.root) || fallback;
    this.property = (cfg && cfg.property) || "文件位置";
    /* R15 修：routes/excluded 被手编 data.json 或旧版本写成非数组时，.map 直接 TypeError、
     * 模块启用即崩 —— 归一成数组（字符串按逗号拆）。 */
    var routesIn = (cfg && cfg.routes);
    if (!Array.isArray(routesIn)) routesIn = typeof routesIn === "string" && routesIn ? routesIn.split(",") : [];
    var exclIn = (cfg && cfg.excluded);
    if (!Array.isArray(exclIn)) exclIn = typeof exclIn === "string" && exclIn ? exclIn.split(",") : [];
    var routes = routesIn;
    var self = this;
    this.routes = routes.filter(function (r) { return r && r.folder; })
      .map(function (r) { return Object.assign({}, r, { keys: routeKeys(r, self.root) }); });
    this.excl = exclIn.map(function (s) {
      try { return new RegExp(s); } catch (e) { return null; }
    }).filter(Boolean);
    /* 中心表：显式传 centers 优先，其次由结构模板推导 */
    if (cfg && cfg.centers) setCenters(cfg.centers);
    else if (cfg && cfg.template) setCenters(specsFromTemplate(cfg.template));
  };
  Router.prototype.isExcluded = function (parentPath) {
    for (var i = 0; i < this.excl.length; i++) if (this.excl[i].test(parentPath)) return true;
    return false;
  };
  /**
   * 解析目标目录；认不出返回 null。R11 改版（boss 第 1 条：手动拖动优先）：
   * ① 文件位置 非空 → 以它为准 —— 哪怕它只是当前目录的镜像也不再退回标签。
   *    旧「镜像规则」会跟手动拖动打架：用户把笔记拖进 00_Inbox，属性还写着旧目录，
   *    rename 事件一到就被按属性搬回去，表现就是「拖不动」。
   *    现在手动拖动后属性会同步成新目录（见 automation.handleManualMove），
   *    属性永远反映「人最后一次的意图」。
   * ② 文件位置 为空 → 以 tags 为准。
   * ③ 认不出 → 绝不动文件。
   */
  Router.prototype.resolveTarget = function (fm, tags, currentFolder, app) {
    var raw = firstProp(fm[this.property]);
    var n = raw ? norm(raw, this.root) : "";
    if (n) {
      var here = norm(canonical(currentFolder || "", this.root), this.root);
      for (var i = 0; i < this.routes.length; i++)
        if (this.routes[i].keys.has(n)) {
          if (norm(this.routes[i].folder, this.root) === here) return null;   /* 已在目标目录 → 不动 */
          return { folder: this.routes[i].folder, why: "文件位置=" + raw };
        }
      /* R15 修：cands 原来全是小写化后的路径，而 getAbstractFileByPath 是精确匹配 ——
       * 属性值大小写与真实目录不一致时永远认不出。补一版保原始大小写的候选。 */
      var rawClean = String(raw).trim().replace(/^#+/, "").replace(/\\/g, "/")
        .replace(/^\/+/, "").replace(/\/+$/, "")
        .replace(new RegExp("^" + escRe(this.root) + "/"), "");
      var cands = [n, this.root + "/" + n, rawClean, this.root + "/" + rawClean];
      for (var j = 0; j < cands.length; j++) {
        if (isFolderFile(app.vault.getAbstractFileByPath(cands[j]))) {
          if (norm(cands[j], this.root) === here) return null;
          return { folder: cands[j], why: "文件位置=" + raw };
        }
      }
      return null;    /* 属性写了但认不出 → 宁可不动，不退回标签 */
    }
    tags = tags || [];   /* R15 修：公开 API 的裸解引用兜底 */
    for (var t = 0; t < tags.length; t++) {
      var tn = norm(tags[t], this.root);
      for (var k = 0; k < this.routes.length; k++)
        if (this.routes[k].keys.has(tn)) return { folder: this.routes[k].folder, why: "标签=" + tags[t] };
    }
    return null;
  };
  KB.service("router", Router);
  KB.service("router.util", { firstProp: firstProp, norm: norm, canonical: canonical,
    centerFor: centerFor, linkName: linkName, isLocked: isLocked,
    /* R5 配置化入口：中心表推导 / 设置 / 应用 */
    CENTER_SPEC_DEFAULT: CENTER_SPEC_DEFAULT, specsFromTemplate: specsFromTemplate,
    setCenters: setCenters, applySettings: applySettings,
    centers: function () { return centerSpec.slice(); } });
  return Router;
});

/* ===== 50_services_links.js ===== */
/* 双链服务：「所属中心」跟随目录（原样移植 note-locator.fixCenter）+ 尾部双链解析基础。 */
KB.define("services/links", function () {
  /** 正文里「所属中心」那一行的正则（中英文冒号都认，只改这一行） */
  var CENTER_LINE = /^(-[ \t]*所属中心[ \t]*[：:][ \t]*)\[\[([^\[\]]*)\]\]/m;

  function LinksService(app) { this.app = app; }
  /**
   * 更正「- 所属中心：[[…]]」。返回是否改动。
   * 目录认不出区域 / 没有这一行 / 已经对了 → 不动（不擅自加行）。
   * 短名写法维持短名，全路径写法维持全路径。
   */
  LinksService.prototype.fixCenter = async function (file, exclRegexes, root) {
    var util = KB.services["router.util"];
    var live = this.app.vault.getAbstractFileByPath(file.path) || file;
    var parent = live.parent;
    if (!parent) return false;
    var parentPath = parent.path;
    if (exclRegexes) for (var i = 0; i < exclRegexes.length; i++) if (exclRegexes[i].test(parentPath)) return false;
    var want = util.centerFor(parentPath);
    if (!want) return false;
    var changed = false;
    await this.app.vault.process(live, function (data) {
      var m = CENTER_LINE.exec(data);
      if (!m) return data;
      if (util.linkName(m[2]) === util.linkName(want)) return data;
      var shortStyle = String(m[2]).indexOf("/") < 0;
      var target = shortStyle ? util.linkName(want) : want;
      changed = true;
      return data.slice(0, m.index) + m[1] + "[[" + target + "]]" + data.slice(m.index + m[0].length);
    });
    return changed;
  };
  /** 尾部双链行扫描（供 R2 创建补全 / R4 重建使用）：返回正文里所有 [[…]] 目标名 */
  LinksService.prototype.extractTargets = function (body) {
    var out = [], re = /\[\[([^\[\]]+)\]\]/g, m;
    while ((m = re.exec(body))) out.push(m[1].split("|")[0]);
    return out;
  };
  KB.service("links", LinksService);
  return LinksService;
});

/* ===== 60_services_mover.js ===== */
/* 移动引擎：renameFile + 撞名 uniquePath + 属性回填。
 * R3 起成为全插件唯一搬家入口（看板拖动 / 标签路由 / 知识库重建共用）。 */
KB.define("services/mover", function () {
  function MoverService(app) { this.app = app; }
  /** 目标撞名时生成不冲突路径：name.md → name 1.md → name 2.md … */
  MoverService.prototype.uniquePath = function (folder, name, app) {
    var dot = name.lastIndexOf(".");
    var base = dot < 0 ? name : name.slice(0, dot);
    var ext = dot < 0 ? "" : name.slice(dot);
    var cand = folder + "/" + name;
    var n = 1;
    while (app.vault.getAbstractFileByPath(cand)) {
      cand = folder + "/" + base + " " + n + ext;
      n++;
    }
    return cand;
  };
  /**
   * 搬一篇笔记。返回 {ok, file, blocked}：
   * blocked=true 表示目标已有同名文件（与 note-locator 行为一致：跳过 + 上报，不覆盖）。
   * overwrite 语义：只有 "unique" 走改名避让；其余任何值（含调用方传的 "skip"）
   * 都是「撞名即 blocked、不覆盖」—— R15 起在注释里写明，"skip" 是合法别名。
   */
  MoverService.prototype.move = async function (file, destFolder, opts) {
    opts = opts || {};
    var app = this.app;
    var destPath = opts.overwrite === "unique"
      ? this.uniquePath(destFolder, file.name, app)
      : (destFolder + "/" + file.name);
    if (destPath === file.path) return { ok: true, file: file, blocked: false, unchanged: true };
    var blocker = app.vault.getAbstractFileByPath(destPath);
    if (blocker) return { ok: false, file: file, blocked: true, dest: destPath };
    var newFile = await app.fileManager.renameFile(file, destPath);
    return { ok: true, file: newFile || file, blocked: false, dest: destPath };
  };
  KB.service("mover", MoverService);
  return MoverService;
});

/* ===== 62_services_vaultops.js ===== */
/* 库操作服务（R4b）：带「可逆条目 + sha256 守卫」的原子文件操作。
 * 执行与回滚共用同一套原语，保证「每个正向操作都有一条对应的逆操作记录」。
 * 对外契约：所有方法失败不抛（除 rename/create 的底层异常由调用方 catch），返回 {ok, blocked?, dest?}。 */
KB.define("services/vaultops", function () {
  var crypto = null;
  try { crypto = require("crypto"); } catch (e) { crypto = null; }

  function sha256(text) {
    try {
      if (crypto) return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
    } catch (e) { /* 落到退化分支 */ }
    var s = String(text);
    return "len" + s.length + ":" + s.slice(0, 8) + s.slice(-8);
  }

  function VaultOps(app) { this.app = app; }

  VaultOps.prototype.sha256 = function (text) { return sha256(text); };
  VaultOps.prototype.isFolder = function (f) { return !!(f && f.children !== undefined); };
  VaultOps.prototype.exists = function (path) {
    return !!this.app.vault.getAbstractFileByPath(path);
  };
  VaultOps.prototype.isEmptyFolder = function (f) {
    return this.isFolder(f) && (!f.children || f.children.length === 0);
  };
  VaultOps.prototype.readText = async function (file) {
    var v = this.app.vault;
    if (v.cachedRead) return await v.cachedRead(file);
    return file.content;
  };
  VaultOps.prototype.shaOf = async function (file) {
    if (this.isFolder(file)) return null;
    try { return sha256(await this.readText(file)); } catch (e) { return null; }
  };
  /**
   * 逐级建目录（存在即跳过）。返回**本次新建**的路径数组（升序），
   * 回滚时按倒序删除即可保证先删子后删父。
   */
  VaultOps.prototype.ensureFolder = async function (path) {
    var app = this.app;
    var segs = String(path).split("/").filter(function (s) { return s.length > 0; });
    var created = [], cur = "";
    for (var i = 0; i < segs.length; i++) {
      cur = cur ? cur + "/" + segs[i] : segs[i];
      if (app.vault.getAbstractFileByPath(cur)) continue;
      await app.vault.createFolder(cur);
      created.push(cur);
    }
    return created;
  };
  /** 建文本文件；目标已存在 → blocked（绝不覆盖）。返回 {ok, file, sha256, bytes} 或 {ok:false, blocked, reason} */
  VaultOps.prototype.createText = async function (path, content) {
    var app = this.app;
    if (app.vault.getAbstractFileByPath(path))
      return { ok: false, blocked: true, dest: path, reason: "目标已存在" };
    var f = await app.vault.create(path, content);
    return { ok: true, file: f, dest: path, sha256: sha256(content), bytes: String(content).length };
  };
  /** 改路径/移动；目标已存在 → blocked（绝不覆盖）；原地不动 → unchanged */
  VaultOps.prototype.rename = async function (file, newPath) {
    var app = this.app;
    if (!file) return { ok: false, blocked: true, dest: newPath, reason: "源不存在" };
    if (file.path === newPath) return { ok: true, unchanged: true, file: file, dest: newPath };
    if (app.vault.getAbstractFileByPath(newPath))
      return { ok: false, blocked: true, dest: newPath, reason: "目标已存在" };
    var nf = await app.fileManager.renameFile(file, newPath);
    return { ok: true, file: nf || file, dest: newPath };
  };
  /** 删除（仅用于回滚删掉本轮自己建的目录/文件，调用方必须先做 sha256 守卫）。
   * 优先走 fileManager.trashFile：1.13.7 实现体读 vault.getConfig("trashOption") 分流到
   * 系统回收站 / 本地 .trash / 永久删除，且不弹确认框（obsidian.asar 取证）。
   * 无该 API 的老版本退回 vault.delete。 */
  VaultOps.prototype.remove = async function (file, force) {
    if (!file) return { ok: true, skipped: true };
    if (this.isFolder(file) && !this.isEmptyFolder(file))
      return { ok: false, blocked: true, reason: "目录非空，拒绝删除" };
    var fm = this.app.fileManager;
    if (fm && typeof fm.trashFile === "function") {
      await fm.trashFile(file);
      return { ok: true, via: "trashFile" };
    }
    await this.app.vault.delete(file, true);
    return { ok: true, via: "vault.delete" };
  };
  VaultOps.sha256 = sha256;          /* 静态：供其他服务直接复用（原型上也有一份） */
  KB.service("vaultops", VaultOps);
  return VaultOps;
});

/* ===== 65_services_rebuild.js ===== */
/* 新建知识库服务。
 * R4a：纯规划（只读）—— dry-run 预览 + manifest 生成。
 * R4b：执行 / 回滚 / 幂等 —— 按 manifest 落库，全程写 journal（可逆条目 + sha256 守卫）。
 * 规划规则（boss 定版）：
 *   ① 顶层旧文件/文件夹全部搬入「旧文件」（已存在则并入，撞名记 conflict）
 *   ② 新建一个空的库根目录，**名字 = 配置里的库根名（paths.knowledgeBase）**
 *   ③ 按结构模板在建目录 + 种子文件
 *   ④ 系统目录（.obsidian/.trash/.workbuddy）与 keepTop 不动
 *   ⑤ 同名编号残留（<库根名>1、<库根名>2…）不搬 —— 那是上一次中断留下的空壳
 * R7：② 的名字不再写死成「知识库」。旧版把 rootName 与 paths.knowledgeBase 分成两个概念，
 *     重建出来的库叫「知识库」而插件自己认的是「01_新知识库」→ 插件认不出自己的库（boss 报的⑤⑥）。
 * 安全底线：执行失败即停（不自动回滚，交人决定）；回滚绝不覆盖、绝不删非本轮产物。 */
KB.define("services/rebuild", function () {
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /** 顶层条目的归类：null = 可搬；字符串 = 排除原因
   *  🔴 同名本体（= 旧库）必须**可搬**：搬走它、再新建同名新库，正是这套流程的本意。
   *     只有带编号的同名兄弟（知识库1 / 01_新知识库1…）才是「上一次中断的产物」，不搬。 */
  function classify(name, cfg) {
    if ((cfg.excludedTop || []).indexOf(name) >= 0) return "系统目录";
    if ((cfg.keepTop || []).indexOf(name) >= 0) return "keepTop 保留";
    var root = cfg.rootName || "";
    if (root && name !== root && new RegExp("^" + esc(root) + "\\d+$").test(name))
      return "同名编号残留（上次中断留下的空壳）";
    if (name === (cfg.oldFolderName || "旧文件")) return "旧文件区本身";
    return null;
  }

  function RebuildService(app) { this.app = app; }

  RebuildService.prototype.sha256 = function (text) { return KB.services.vaultops.sha256(text); };

  /* ---------- 顶层扫描（plan 与 detectState 共用） ---------- */
  RebuildService.prototype.topChildren = function () {
    var app = this.app;
    var rootFolder = app.vault.getRoot ? app.vault.getRoot() : null;
    if (rootFolder && rootFolder.children) return rootFolder.children.slice();
    /* 兜底：从全量文件推顶层条目 */
    var seen = {}, out = [];
    (app.vault.getMarkdownFiles ? app.vault.getMarkdownFiles() : []).forEach(function (f) {
      var top = f.path.split("/")[0];
      if (!seen[top]) { seen[top] = true; out.push({ path: top, name: top, children: undefined, __guess: true }); }
    });
    return out;
  };

  /** 顶层可搬项 [{name, isFolder, file}]
   *  opts.excludeRoot=true 时把「库根名本体」也算作非杂物 —— 判断「是否已完成重建」用 */
  RebuildService.prototype.movableTop = function (cfg, opts) {
    opts = opts || {};
    var out = [];
    var root = cfg.rootName || "";
    var kids = this.topChildren();
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      var name = c.name || String(c.path).split("/").pop();
      if (classify(name, cfg)) continue;
      if (opts.excludeRoot && root && name === root) continue;
      out.push({ name: name, isFolder: c.children !== undefined, file: c });
    }
    return out;
  };

  /** 顶层唯一根名：<base> → <base>1 → <base>2 …（base 被腾空时直接用 base） */
  RebuildService.prototype.uniqueRoot = function (baseName) {
    var app = this.app;
    if (!app.vault.getAbstractFileByPath(baseName)) return baseName;
    var n = 1;
    while (app.vault.getAbstractFileByPath(baseName + n)) n++;
    return baseName + n;
  };

  /** R8：分代归档 / 收容文件夹名用的时间戳（20260917-1305） */
  RebuildService.prototype.stampNow = function (now) {
    var d = (now instanceof Date) ? now : new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  };
  /** 顶层唯一名字：<base> → <base>-2 → <base>-3 …（同名就编号，绝不覆盖） */
  RebuildService.prototype.uniqueTopName = function (base) {
    var app = this.app;
    if (!app.vault.getAbstractFileByPath(base)) return base;
    var n = 2;
    while (app.vault.getAbstractFileByPath(base + "-" + n)) n++;
    return base + "-" + n;
  };
  /** 回滚收容文件夹名（默认「回滚保留-<戳>」） */
  RebuildService.prototype.quarantineName = function (cfg, stamp) {
    var base = (cfg && cfg.rollbackKeepName) || "回滚保留";
    return this.uniqueTopName(stamp ? base + "-" + stamp : base);
  };

  /**
   * R8 阶段 A：把「本轮新建目录里**不属于本轮**的东西」整体挪到顶层一个单独文件夹里。
   * 为什么需要：老板在重建之后往新库里写了笔记，回滚时那些笔记让目录「非空」→ 删不掉 →
   * 旧实现只能 blocked 掉，回滚半途而废。现在先把它们请进 `回滚保留-<戳>/`（保留原相对路径），
   * 目录空了继续删，回滚能一路走完；用户的东西一篇不丢。
   * 🔴 只扫 op:"mkdir" 的目录（＝新建根下的）。**不扫旧文件区** —— 那里是本轮搬过去的老库，
   *    正等着被搬回原位，扫了就把老库也收容走了。
   */
  RebuildService.prototype.quarantineForeign = async function (journal, opts) {
    opts = opts || {};
    var app = this.app;
    var vop = new KB.services.vaultops(app);
    var madeFile = {}, madeDir = {};
    var entries = (journal && journal.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e) continue;
      if ((e.op === "create" || e.op === "log") && e.path) madeFile[e.path] = true;
      if (e.op === "mkdir" && e.path) madeDir[e.path] = true;
    }
    var roots = Object.keys(madeDir).filter(function (p) {
      var par = p.slice(0, p.lastIndexOf("/"));
      return !par || !madeDir[par];
    }).sort();
    var out = { folder: null, moved: [], errors: [], scannedDirs: roots.length };
    for (var r = 0; r < roots.length; r++)
      await this._sweepForeign(app, vop, roots[r], madeDir, madeFile, opts, out);
    return out;
  };
  /** 一个本轮新建目录 → 逐个子项分类：本轮目录递归、本轮文件跳过、其余请进收容区 */
  RebuildService.prototype._sweepForeign = async function (app, vop, dirPath, madeDir, madeFile, opts, out) {
    var folder = app.vault.getAbstractFileByPath(dirPath);
    if (!folder || folder.children === undefined) return;
    var kids = folder.children.slice();
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i], cp = c.path;
      if (c.children !== undefined) {
        if (madeDir[cp]) { await this._sweepForeign(app, vop, cp, madeDir, madeFile, opts, out); continue; }
        await this._quarantineMove(app, vop, c, opts, out);
        continue;
      }
      if (madeFile[cp]) continue;                 /* 本轮种子 → 交给正常回滚删掉 */
      await this._quarantineMove(app, vop, c, opts, out);
    }
  };
  /** 把一项挪进收容文件夹（保留它在库里的相对路径），目标重名自动加序号
   *  🔴 必须逐级建出目标的父目录：收容区是**新建**的顶层文件夹，`<收容区>/<库根>/<子目录>/…`
   *     这条路径上除了收容区本身全都不存在。jsdom 桩的 rename 不校验父目录，会把这个洞盖住 ——
   *     真文件沙盒一跑就现形（回滚整条半途而废 + 4 条 blocked）。 */
  RebuildService.prototype._quarantineMove = async function (app, vop, file, opts, out) {
    var name = opts.keepName;
    if (!name || !file) return false;
    /* 🔴 R9：先把原位路径抄下来再 rename —— Obsidian 的 `renameFile` 会**就地把同一个 TFile
     * 实例的 path 改掉**，所以 await 之后再读 `file.path` 拿到的是**目标**路径。
     * 旧实现把「原位置」记成了保留位置（报告里两列一模一样，真机实测如此），
     * 既误导人、也没法据此把东西搬回原位。 */
    var fromPath = file.path;
    var dest = name + "/" + fromPath;
    if (vop.exists(dest)) {
      var n = 2, cand = "";
      do { cand = name + "/" + fromPath.replace(/(\.[^./\\]+)?$/, " (" + n + ")$1"); n++; }
      while (vop.exists(cand) && n < 500);
      dest = cand;
    }
    try {
      await vop.ensureFolder(name);
      var par = dest.slice(0, dest.lastIndexOf("/"));
      if (par) await vop.ensureFolder(par);
      if (!out.folder) out.folder = name;
      var r = await vop.rename(file, dest);
      if (!r.ok) { out.errors.push({ path: fromPath, reason: r.reason }); return false; }
      out.moved.push({ from: fromPath, to: dest,
        kind: file.children !== undefined ? "folder" : "file" });
      return true;
    } catch (e) {
      out.errors.push({ path: fromPath, reason: String((e && e.message) || e) });
      return false;
    }
  };
  /**
   * R9 收尾：把 journal 里「本轮新建的目录」**再扫一遍**，为空就删（深 → 浅）。
   * 为什么倒序撤销之后还要补这一遍：阶段 A 收容与阶段 B 撤销之间只要有一个目录因为
   * 顺序 / 外来户而没能当场删掉，它的**父目录就跟着删不动**（目录非空），整条链断在中间
   * → 自检报「新建根仍存在: 新知识库」（老板报的第 5/7 条）。补一遍深→浅扫描，能把
   * 「当场被卡住、随后其实已经空了」的目录收干净。
   * 🔴 只碰 journal 里记过 mkdir / mkdirOld 的目录，绝不扫旧文件区、绝不扫别人的目录。
   */
  RebuildService.prototype.sweepEmptyDirs = async function (journal) {
    var app = this.app;
    var vop = new KB.services.vaultops(app);
    var dirs = [], seen = {};
    var entries = (journal && journal.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || (e.op !== "mkdir" && e.op !== "mkdirOld") || !e.path) continue;
      if (seen[e.path]) continue;
      seen[e.path] = true; dirs.push(e.path);
    }
    dirs.sort(function (a, b) {
      var d = b.split("/").length - a.split("/").length;
      return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
    });
    var removed = [], kept = [];
    for (var j = 0; j < dirs.length; j++) {
      var f = app.vault.getAbstractFileByPath(dirs[j]);
      if (!f || f.children === undefined) continue;      /* 已不在 / 不是目录 → 跳过 */
      if (!vop.isEmptyFolder(f)) { kept.push(dirs[j]); continue; }
      try { await vop.remove(f); removed.push(dirs[j]); }
      catch (err) { kept.push(dirs[j]); }
    }
    return { removed: removed, kept: kept };
  };

  /**
   * R7 幂等状态判定。旧语义用「新建根在不在」判「重建过」，与「根名=库根名」冲突（真库里库根本来就在）。
   * 新判据：
   *   fresh   旧文件区不存在（没走过重建）或新库根不存在（重建没做完）
   *   partial 旧文件区在 + 库根在 + 顶层仍有杂物（除库根之外）
   *   done    旧文件区在 + 库根在 + 顶层干净
   * R8 追加：reRebuild（旧文件区已有内容 → 会走「库根保留 + 并列新建」）也一并返回，供 UI 说人话。
   */
  RebuildService.prototype.detectState = async function (cfg) {
    cfg = cfg || {};
    var app = this.app;
    var root = cfg.rootName || "";
    var oldName = cfg.oldFolderName || "旧文件";
    var movable = this.movableTop(cfg, { excludeRoot: true });
    var rootExists = !!app.vault.getAbstractFileByPath(root);
    var oldFolder = app.vault.getAbstractFileByPath(oldName);
    var oldExists = !!(oldFolder && oldFolder.children !== undefined);
    var oldHasKids = !!(oldExists && oldFolder.children.length > 0);
    var state = (!oldExists || !rootExists) ? "fresh" : (movable.length === 0 ? "done" : "partial");
    return {
      state: state, root: root, rootExists: rootExists, oldFolderExists: oldExists,
      movable: movable.map(function (m) { return m.name; }),
      movableCount: movable.length,
      /* R8：旧文件区已有内容 → 再次执行（库根原地保留，新库与它并列） */
      reRebuild: oldHasKids,
      keepRoot: !!(oldHasKids && rootExists && !classify(root, cfg)),
      /* 库根本体是否也在搬运清单里（= 老库要被归档进旧文件区，执行后会新建一个同名的空库） */
      rootWillMove: !!(root && rootExists && !classify(root, cfg) && !oldHasKids)
    };
  };

  /**
   * 生成重建计划（只读）。返回：
   * { root, oldFolder, mergeOld, reRebuild, keepRoot, archive{prior,incoming}, moves[], creates[],
   *   seeds[], conflicts[], excluded[], counts, manifest }
   * R8 的两种形态：
   *   首次  —— 旧文件区不存在：把顶层杂物（含旧库根本体）搬进「旧文件」，再建一个同名的空库。
   *   再次  —— 旧文件区**已存在且有内容**：已有的知识库**原地保留**（不搬），新库取编号名与它并列；
   *            旧文件区下分两代子文件夹：「先前已有-<戳>」装旧文件区原有内容、「本次移入-<戳>」装本次搬的。
   */
  RebuildService.prototype.plan = async function (cfg, opts) {
    opts = opts || {};
    var app = this.app;
    var baseName = cfg.rootName || "知识库";
    var oldName = cfg.oldFolderName || "旧文件";
    var stamp = this.stampNow(opts.now);
    var topChildren = this.topChildren();
    var oldFolder = app.vault.getAbstractFileByPath(oldName);
    var mergeOld = !!(oldFolder && oldFolder.children !== undefined);
    var oldChildren = mergeOld ? oldFolder.children.slice() : [];

    /* R8：旧文件区已有内容 = 这不是第一次重建 → 走「并列新建 + 分代归档」 */
    var reRebuild = !!(mergeOld && oldChildren.length > 0);
    var baseFolder = app.vault.getAbstractFileByPath(baseName);
    var keepRoot = !!(reRebuild && baseFolder && baseFolder.children !== undefined && !classify(baseName, cfg));

    /* R7：顶层若有同名项，且它是要被搬走的（= 老库本身），执行后名字自然腾空 → 直接复用该名字。
     * 否则（真·重名残留 / R8 的保留态）才顺次编号。
     * 不这么做就会出现「01_新知识库 被搬进旧文件、新库却叫 01_新知识库1」。 */
    var sameName = null, s0;
    for (s0 = 0; s0 < topChildren.length; s0++) {
      var nm = topChildren[s0].name || String(topChildren[s0].path).split("/").pop();
      if (nm === baseName) sameName = nm;
    }
    var root = keepRoot ? this.uniqueRoot(baseName)
      : ((sameName && !classify(sameName, cfg)) ? baseName : this.uniqueRoot(baseName));

    var archive = reRebuild
      ? { prior: oldName + "/" + ((cfg.archivePriorName || "先前已有") + "-" + stamp),
          incoming: oldName + "/" + ((cfg.archiveIncomingName || "本次移入") + "-" + stamp),
          stamp: stamp }
      : { prior: null, incoming: null, stamp: stamp };
    var destPrefix = archive.incoming ? archive.incoming + "/" : oldName + "/";

    var moves = [], conflicts = [], excluded = [];
    var oldChildNames = mergeOld ? oldChildren.map(function (c) { return c.name; }) : [];

    /* ---- R8 第 0 批：旧文件区原有内容 → 「先前已有-<戳>」（仅在再次执行时） ---- */
    if (reRebuild) {
      for (var p = 0; p < oldChildren.length; p++) {
        var oc = oldChildren[p];
        var on = oc.name || String(oc.path).split("/").pop();
        moves.push({ from: oldName + "/" + on, to: archive.prior + "/" + on,
          type: oc.children !== undefined ? "folder" : "file", sha256: null, archive: "prior" });
      }
    }

    /* ---- 第 1 批：顶层项 → 旧文件区（再次执行时进「本次移入-<戳>」） ---- */
    for (var i = 0; i < topChildren.length; i++) {
      var c = topChildren[i];
      var name = c.name || c.path.split("/").pop();
      if (keepRoot && name === baseName) {
        excluded.push({ path: name, reason: "已有知识库（本次原地保留，新库「" + root + "」与它并列）" });
        continue;
      }
      var why = classify(name, cfg);
      if (why) {
        if (name === oldName) why += "（" + (mergeOld ? "并入模式" : "将新建") + "）";
        excluded.push({ path: name, reason: why });
        continue;
      }
      var isFolder = c.children !== undefined;
      var entry = { from: name, to: destPrefix + name, type: isFolder ? "folder" : "file", sha256: null };
      if (!isFolder && app.vault.cachedRead) {
        try { entry.sha256 = this.sha256(await app.vault.cachedRead(c)); } catch (e) { entry.sha256 = null; }
      }
      /* R8：撞名判据改成「目标位此刻存不存在」——
       * 再次执行时本次搬入走独立子文件夹，与旧文件区里原有的同名**不再冲突**（两篇都留住）。 */
      if (app.vault.getAbstractFileByPath(entry.to)) {
        conflicts.push({ from: name, to: entry.to, reason: "目标位已有同名" + (isFolder ? "文件夹" : "文件") + "（执行时跳过该条，不覆盖）" });
      }
      moves.push(entry);
    }
    oldChildNames = null;

    var tpl = cfg.template || { dirs: [], seedFiles: [] };
    var creates = (tpl.dirs || []).map(function (d) { return root + "/" + d; });
    var seeds = (tpl.seedFiles || []).map(function (p) { return root + "/" + p; });

    var plan = {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      root: root,
      oldFolder: oldName,
      mergeOld: mergeOld,
      reRebuild: reRebuild,
      keepRoot: keepRoot,
      archive: archive,
      moves: moves,
      creates: creates,
      seeds: seeds,
      conflicts: conflicts,
      excluded: excluded,
      counts: {
        moves: moves.length, fileMoves: moves.filter(function (m) { return m.type === "file"; }).length,
        folderMoves: moves.filter(function (m) { return m.type === "folder"; }).length,
        priorMoves: moves.filter(function (m) { return m.archive === "prior"; }).length,
        creates: creates.length, seeds: seeds.length, conflicts: conflicts.length, excluded: excluded.length
      }
    };
    plan.manifest = {
      version: 1,
      generatedAt: plan.generatedAt,
      cfgFingerprint: this.cfgFingerprint(cfg),
      root: root,
      oldFolder: oldName,
      reRebuild: reRebuild,
      keepRoot: keepRoot,
      archive: archive,
      moves: moves,
      creates: creates,
      seeds: seeds
    };
    return plan;
  };

  /**
   * R10-②：配置指纹。boss 第 2 条的根因 = 预览落盘的 manifest 被「执行」原样复用 ——
   * 预览后改了库根名，执行仍按旧 manifest 建出旧名字的库。执行前把当前配置的指纹
   * 与 manifest 里记的比对，不一致就整体作废重算。只取影响计划形状的字段。 */
  RebuildService.prototype.cfgFingerprint = function (cfg) {
    cfg = cfg || {};
    var tpl = cfg.template || {};
    var basis = {
      rootName: cfg.rootName || "", oldFolderName: cfg.oldFolderName || "",
      archivePriorName: cfg.archivePriorName || "", archiveIncomingName: cfg.archiveIncomingName || "",
      keepTop: cfg.keepTop || [], excludedTop: cfg.excludedTop || [],
      dirs: tpl.dirs || [], seedFiles: tpl.seedFiles || []
    };
    var json = JSON.stringify(basis);
    try { return this.sha256(json); } catch (e) { return json; }
  };

  /** manifest 校验（执行前的安全检查）：结构完整 + 去向不越界 + 无重复目标 */
  RebuildService.prototype.validateManifest = function (m) {
    var errs = [];
    if (!m || m.version !== 1) errs.push("version 必须为 1");
    if (!m.root || !m.oldFolder) errs.push("缺 root/oldFolder");
    var seen = {};
    (m && m.moves || []).forEach(function (mv) {
      if (!mv.from || !mv.to) { errs.push("move 缺 from/to: " + JSON.stringify(mv)); return; }
      if (m.oldFolder && String(mv.to).indexOf(m.oldFolder + "/") !== 0)
        errs.push("move 目标不在旧文件区内: " + mv.to);
      if (seen[mv.to]) errs.push("重复目标: " + mv.to);
      seen[mv.to] = true;
    });
    (m && m.creates || []).forEach(function (d) {
      if (m.root && String(d).indexOf(m.root + "/") !== 0)
        errs.push("create 不在新建根下: " + d);
      if (seen[d]) errs.push("目录与移动目标重复: " + d);
      seen[d] = true;
    });
    return { ok: errs.length === 0, errors: errs };
  };

  /** 执行前检查（只读）：硬门槛 blocking + 提醒 warnings，供确认弹窗展示 */
  RebuildService.prototype.preflight = async function (manifest, cfg) {
    var app = this.app;
    cfg = cfg || {};
    var v = this.validateManifest(manifest);
    var blocking = v.ok ? [] : v.errors.slice();
    var warnings = [];
    var st = await this.detectState({ rootName: manifest.root, oldFolderName: manifest.oldFolder,
      excludedTop: cfg.excludedTop, keepTop: cfg.keepTop });

    var planned = {};
    (manifest.moves || []).forEach(function (m) { planned[m.from] = true; });
    var stale = st.movable.filter(function (n) { return !planned[n]; });
    if (stale.length)
      warnings.push("预览之后顶层多了 " + stale.length + " 项未列入 manifest（" + stale.slice(0, 3).join("、") +
        (stale.length > 3 ? "…" : "") + "），建议重新生成预览");

    var moves = manifest.moves || [];
    var missing = moves.filter(function (m) { return !app.vault.getAbstractFileByPath(m.from); });
    if (moves.length && missing.length === moves.length)
      warnings.push("manifest 里的搬运源已全部不在原位（本次执行过或已回滚）");

    var zero = [];
    if (app.vault.getMarkdownFiles) {
      app.vault.getMarkdownFiles().forEach(function (f) {
        var size = (f.stat && typeof f.stat.size === "number") ? f.stat.size
          : (typeof f.content === "string" ? f.content.length : null);
        if (size === 0) zero.push(f.path);
      });
    }
    if (zero.length)
      warnings.push("存在 " + zero.length + " 篇 0 字节笔记（R1 清障项）：" + zero.slice(0, 3).join("、"));

    /* R8：再次执行（旧文件区已有内容）→ 说清楚这次会怎么落 */
    if (manifest.reRebuild) {
      var ar = manifest.archive || {};
      warnings.push("这是**再次执行**：旧文件区已有内容 → 已有知识库**原地保留**，" +
        "新库「" + manifest.root + "」与它并列（顶层会同时存在两个库目录）；" +
        "旧文件区下新建「" + String(ar.prior || "").split("/").pop() + "」（装原有内容）与「" +
        String(ar.incoming || "").split("/").pop() + "」（装本次搬入）两个子文件夹。");
    }

    return {
      ok: blocking.length === 0, blocking: blocking, warnings: warnings, state: st,
      alreadyDone: st.state === "done",
      summary: { root: manifest.root, oldFolder: manifest.oldFolder, moves: moves.length,
        creates: (manifest.creates || []).length, seeds: (manifest.seeds || []).length,
        reRebuild: !!manifest.reRebuild, keepRoot: !!manifest.keepRoot, archive: manifest.archive || null,
        priorMoves: moves.filter(function (m) { return m.archive === "prior"; }).length }
    };
  };

  /* ---- R5：种子内容全部由结构模板推导，不再写死 00_Inbox / 99_Meta ----
   * 两个标签表只影响说明文字；未登记的目录回落成目录名本身。 */
  var DIR_LABEL_SHORT = { "00_Inbox": "收件箱", "01_Projects": "项目", "02_Areas": "领域",
                          "03_Resources": "资源", "04_Archives": "归档", "99_Meta": "系统与模板" };
  var DIR_LABEL_DESC = { "00_Inbox": "未整理的速记入口", "01_Projects": "有明确产出的项目",
                         "02_Areas": "长期维护的领域", "03_Resources": "可复用资料",
                         "04_Archives": "结束的项目与旧笔记", "99_Meta": "模板、指令集、索引、操作日志" };

  /** 从结构模板拆出：中心页表 / 顶层目录清单 / 原始种子清单 */
  RebuildService.prototype.structure = function (template) {
    var tpl = template || (KB.services.settings && KB.services.settings.DEFAULTS
      && KB.services.settings.DEFAULTS.rebuild.template) || { dirs: [], seedFiles: [] };
    var util = KB.services["router.util"];
    var dirs = tpl.dirs || [], tops = [];
    for (var i = 0; i < dirs.length; i++) {
      var p = String(dirs[i]).replace(/\\/g, "/");
      if (p.indexOf("/") >= 0) continue;                 /* 只要顶层 */
      if (tops.indexOf(p) < 0) tops.push(p);
    }
    tops.sort();
    return { centers: util.specsFromTemplate(tpl), tops: tops, seeds: (tpl.seedFiles || []).slice() };
  };

  /** 种子文件内容（确定性：同一 date + 同一模板必得同一字节 → 可 sha256 断言、可 diff） */
  RebuildService.prototype.seedContent = function (seedPath, opts) {
    opts = opts || {};
    var date = opts.date || "";
    var st = this.structure(opts.template || (opts.cfg && opts.cfg.template));
    var path = String(seedPath).replace(/\\/g, "/");
    var name = path.split("/").pop().replace(/\.md$/, "");
    var lines = ["---", "类型: 索引", "主题: " + name, "状态: 持续更新"];
    if (date) lines.push("创建日期: " + date);
    lines.push("tags:", "  - 索引", "---", "", "# " + name, "");
    if (name === "MOC_知识地图") {
      lines.push("知识库总索引：", "");
      lines = lines.concat(st.centers.map(function (c) { return "- [[" + c.page + "]]"; }));
      lines = lines.concat(["", "## 目录", ""]);
      lines = lines.concat(st.tops.map(function (d) {
        return "- `" + d + "` " + (DIR_LABEL_SHORT[d] || d);
      }), [""]);
    } else if (name === "知识库目录说明") {
      lines = lines.concat(["| 目录 | 用途 |", "| --- | --- |"]);
      lines = lines.concat(st.tops.map(function (d) {
        return "| " + d + " | " + (DIR_LABEL_DESC[d] || d) + " |";
      }), [""]);
    } else {
      var hit = null;
      for (var i = 0; i < st.centers.length; i++) {
        if (path.indexOf("/" + st.centers[i].dir + "/") >= 0) { hit = st.centers[i]; break; }
      }
      lines.push("本中心汇总 `" + (hit ? hit.dir : "") + "` 下的笔记。", "",
        "## 关联笔记", "- 返回 [[MOC_知识地图]]", "");
    }
    return lines.join("\n");
  };

  /**
   * 按 manifest 执行（写库 · 最危险的一步）。
   * 顺序：建旧文件区 → 搬顶层项 → 建目录 → 写种子；每步写 journal，失败即停。
   * opts: { cfg, journal, idempotent(默认 true), date, onProgress, onLog, saveJournal }
   * 返回 { ok, status, state?, skipped, blocked, counts, journal, error? }
   */
  RebuildService.prototype.execute = async function (manifest, opts) {
    opts = opts || {};
    var app = this.app;
    var vop = new KB.services.vaultops(app);
    var cfg = opts.cfg || {};
    var idem = opts.idempotent !== false;
    var progress = opts.onProgress || function () {};
    var save = opts.saveJournal || function () { return Promise.resolve(); };
    var journal = opts.journal || {
      version: 1, root: manifest.root, oldFolder: manifest.oldFolder,
      startedAt: new Date().toISOString(), status: "running",
      entries: [], log: [], failedAt: null, error: null
    };
    var out = { ok: false, status: "invalid", journal: journal, skipped: [], blocked: [] };

    /* R9：**继承同一轮重建里上一份未回滚的记录**（按 op+路径 去重）。
     * 起因：第一次执行中途失败 → 第二次执行会新建一份 journal 把上一份覆盖掉，于是第一次
     * 记下的「旧文件区是本轮建的（mkdirOld）」就丢了 → 回滚删不掉那个空目录，留下残渣。
     * 判据：carry 存在、没被回滚过、库根一致。重复条目以**先到的**为准（第一次的记录带
     * 真搬的 from/to，比第二次的 preexisting 更完整）。 */
    var entryKey = function (e) { return String((e && e.op) || "") + ":" + String((e && (e.path || e.from)) || ""); };
    var seenEntries = {};
    (journal.entries || []).forEach(function (e) { seenEntries[entryKey(e)] = true; });
    var pushEntry = function (e) {
      var k = entryKey(e);
      if (seenEntries[k]) return false;
      seenEntries[k] = true;
      journal.entries.push(e);
      return true;
    };
    (function seedCarry() {
      var prev = opts.carry;
      if (!prev || !Array.isArray(prev.entries)) return;
      if (prev.status === "rolled-back") return;
      if (prev.root && manifest.root && prev.root !== manifest.root) return;
      for (var ic = 0; ic < prev.entries.length; ic++) pushEntry(prev.entries[ic]);
    })();

    var v = this.validateManifest(manifest);
    if (!v.ok) { out.errors = v.errors; journal.status = "invalid"; await save(journal); return out; }

    if (idem) {
      var st = await this.detectState({ rootName: manifest.root, oldFolderName: manifest.oldFolder,
        excludedTop: cfg.excludedTop, keepTop: cfg.keepTop });
      out.state = st;
      if (st.state === "done") {
        out.ok = true; out.skipped = []; out.reason = "already-rebuilt"; out.status = "already-rebuilt";
        journal.status = "already-rebuilt";
        journal.log.push("已是已完成态（顶层无待搬项）→ 不做任何事");
        return out;                                    /* 不落盘：没动库就不覆盖上一份有效日志 */
      }
    }

    var fail = async function (e, label) {
      journal.status = "failed";
      journal.failedAt = label;
      journal.error = String((e && e.message) || e);
      journal.log.push("FAIL " + label + " :: " + journal.error);
      await save(journal);
      out.status = "failed"; out.error = journal.error; out.failedAt = label;
      return out;
    };

    /* ---- 0) 旧文件区（已存在 = 并入模式，不记逆操作 → 回滚不会删掉它） ---- */
    if (!vop.exists(manifest.oldFolder)) {
      var made0 = null;
      try { made0 = await vop.ensureFolder(manifest.oldFolder); }
      catch (e) { return await fail(e, "mkdirOld"); }
      for (var i0 = 0; i0 < made0.length; i0++) pushEntry({ op: "mkdirOld", path: made0[i0] });
      await save(journal);
    }

    /* ---- 0.5) 搬运目标的父目录（R8：旧文件区下的「先前已有-<戳>/本次移入-<戳>」就是这类） ----
     * 记成 mkdirOld（= 「不在新建根下、本轮新建的目录」）→ 回滚时统一「空了就删」。 */
    var parents = {};
    (manifest.moves || []).forEach(function (m) {
      var to = String(m && m.to || "");
      var cut = to.lastIndexOf("/");
      if (cut > 0) parents[to.slice(0, cut)] = true;
    });
    var plist = Object.keys(parents).sort(function (a, b) {
      var d = a.split("/").length - b.split("/").length;
      return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
    });
    for (var ip = 0; ip < plist.length; ip++) {
      if (vop.exists(plist[ip])) continue;
      var madeMT = null;
      try { madeMT = await vop.ensureFolder(plist[ip]); }
      catch (e) { return await fail(e, "mkdirMoveTarget:" + plist[ip]); }
      for (var kt = 0; kt < madeMT.length; kt++) pushEntry({ op: "mkdirOld", path: madeMT[kt] });
      await save(journal);
    }

    /* ---- 1) 搬运顶层项 ----
     * 🔴 R9：这里有一条**必须写进 journal** 的分支。旧实现遇到「源已不在原位、
     *    但目标位已经有这个文件」（= 上一次执行搬过了，这次是幂等重跑）只记一条
     *    skipped 就 continue —— journal 里没有逆操作，于是**回滚搬不回来**，
     *    自检报「缺件 R7-试玩说明.md」（老板报的第 5 条的真根因）。
     *    现在照样登记为可逆 move，回滚就能原样搬回原位。 */
    var moves = manifest.moves || [];
    for (var i1 = 0; i1 < moves.length; i1++) {
      var mv = moves[i1];
      var src = app.vault.getAbstractFileByPath(mv.from);
      var dstExists = vop.exists(mv.to);
      if (!src) {
        if (dstExists) {
          var tsha = mv.sha256 || null;
          if (!tsha) {
            var df0 = app.vault.getAbstractFileByPath(mv.to);
            if (df0 && !vop.isFolder(df0)) { try { tsha = await vop.shaOf(df0); } catch (e0) { tsha = null; } }
          }
          pushEntry({ op: "move", from: mv.from, to: mv.to, kind: mv.type,
            sha256: tsha, preexisting: true, at: new Date().toISOString() });
          out.skipped.push({ from: mv.from, to: mv.to, reversible: true,
            reason: "已在目标位（上一次执行搬过）→ 不再动它，但已记入可逆日志，回滚会搬回原位" });
          await save(journal);
          continue;
        }
        out.skipped.push({ from: mv.from, reason: "源不存在（已搬或已删）" });
        continue;
      }
      if (dstExists) {
        /* 源还在 + 目标位已有同名：内容与 manifest 记的 sha 一致 → 视作重复副本，保留源不动；
         * 内容不同 → 一律不让路。⚠️ 这两种情况**本轮确实没搬过它**，所以不写逆操作。 */
        var same = false;
        if (mv.sha256) {
          var tf = app.vault.getAbstractFileByPath(mv.to);
          if (tf && !vop.isFolder(tf)) same = ((await vop.shaOf(tf)) === mv.sha256);
        }
        if (same) { out.skipped.push({ from: mv.from, to: mv.to, reason: "目标位已有同内容副本 → 保留源，本轮未搬运" }); continue; }
        out.blocked.push({ from: mv.from, to: mv.to, reason: "目标同名且内容不同 → 跳过，不覆盖" });
        journal.log.push("BLOCKED move " + mv.from + " -> " + mv.to);
        await save(journal);
        continue;
      }
      var r = null;
      try { r = await vop.rename(src, mv.to); }
      catch (e) { return await fail(e, "move:" + mv.from); }
      if (!r.ok) {
        out.blocked.push({ from: mv.from, to: mv.to, reason: r.reason });
        journal.log.push("BLOCKED move " + mv.from + " -> " + r.reason);
        await save(journal);
        continue;
      }
      pushEntry({ op: "move", from: mv.from, to: mv.to, kind: mv.type,
        sha256: mv.sha256 || null, at: new Date().toISOString() });
      progress({ phase: "move", done: i1 + 1, total: moves.length, item: mv.to });
      await save(journal);
    }

    /* ---- 2) 建目录（父先于子） ---- */
    var dirs = (manifest.creates || []).slice().sort(function (a, b) {
      var d = a.split("/").length - b.split("/").length;
      return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
    });
    for (var i2 = 0; i2 < dirs.length; i2++) {
      var dir = dirs[i2];
      if (vop.exists(dir)) { out.skipped.push({ path: dir, reason: "目录已存在" }); continue; }
      var madeD = null;
      try { madeD = await vop.ensureFolder(dir); }
      catch (e) { return await fail(e, "mkdir:" + dir); }
      for (var k2 = 0; k2 < madeD.length; k2++) pushEntry({ op: "mkdir", path: madeD[k2] });
      progress({ phase: "mkdir", done: i2 + 1, total: dirs.length, item: dir });
      await save(journal);
    }

    /* ---- 3) 种子文件 ---- */
    var seeds = manifest.seeds || [];
    for (var i3 = 0; i3 < seeds.length; i3++) {
      var sp = seeds[i3];
      if (vop.exists(sp)) { out.skipped.push({ path: sp, reason: "文件已存在" }); continue; }
      var parent = sp.slice(0, sp.lastIndexOf("/"));
      if (parent && !vop.exists(parent)) {
        var madeP = null;
        try { madeP = await vop.ensureFolder(parent); }
        catch (e) { return await fail(e, "mkdir:" + parent); }
        for (var k3 = 0; k3 < madeP.length; k3++) pushEntry({ op: "mkdir", path: madeP[k3] });
      }
      var content = this.seedContent(sp, opts);
      var cr = null;
      try { cr = await vop.createText(sp, content); }
      catch (e) { return await fail(e, "create:" + sp); }
      if (!cr.ok) { out.blocked.push({ path: sp, reason: cr.reason }); continue; }
      pushEntry({ op: "create", path: sp, sha256: cr.sha256, bytes: cr.bytes });
      progress({ phase: "seed", done: i3 + 1, total: seeds.length, item: sp });
      await save(journal);
    }

    /* ---- 3b) 默认模板（R10-④）----
     * boss 第 4 条：新建知识库要**自带默认模板**。内置四套（PARA/轻量/项目/资料）在这里
     * 落盘成模板库文件；目录里已有模板文件时整段跳过（绝不覆盖用户改过的东西）。
     * 与普通种子同渠道落 journal（op:"create"）→ 回滚时一并清掉，不留残渣。 */
    try {
      var T = KB.services.templates;
      var tplSettings = opts.settings || {};
      var tplDir = T.dirFor(tplSettings);
      /* 目录要挂在**本轮新建的根**下：再次重建时新库是「<库根>1」，而 settings 里的
       * 库根名还是被原地保留的那个旧库 —— 直接用 settings 算会写到旧库去，父目录
       * 还可能根本不存在（r8 D2 现场：执行直接失败）。 */
      if (tplDir && manifest.root) {
        var kb = tplSettings.paths && tplSettings.paths.knowledgeBase;
        if (kb && tplDir.indexOf(kb + "/") === 0)
          tplDir = manifest.root + tplDir.slice(kb.length);
      }
      var tplScan = T.scan(this.app, tplSettings, { force: true });
      if (tplDir && !(tplScan.items || []).length) {
        for (var i4 = 0; i4 < T.BUILTIN.length; i4++) {
          var tb = T.BUILTIN[i4];
          var tp = tplDir + "/" + T.safeName(tb.name) + ".md";
          if (vop.exists(tp)) continue;
          var tParent = tp.slice(0, tp.lastIndexOf("/"));
          if (tParent && !vop.exists(tParent)) {
            try { var madeT = await vop.ensureFolder(tParent); }
            catch (e) { return await fail(e, "mkdir:" + tParent); }
            for (var k4 = 0; k4 < madeT.length; k4++) pushEntry({ op: "mkdir", path: madeT[k4] });
          }
          var tc = null;
          try { tc = await vop.createText(tp, tb.text); }
          catch (e) { return await fail(e, "create:" + tp); }
          if (!tc.ok) { out.blocked.push({ path: tp, reason: tc.reason }); continue; }
          pushEntry({ op: "create", path: tp, sha256: tc.sha256, bytes: tc.bytes });
          if (!out.templates) out.templates = [];
          out.templates.push(tp);
          progress({ phase: "template", done: i4 + 1, total: T.BUILTIN.length, item: tp });
          await save(journal);
        }
      }
      T.invalidate();
    } catch (eTpl) {
      console.warn("[kb-toolkit] 默认模板落盘失败（不影响重建主体）", eTpl);
    }

    journal.status = "done";
    journal.finishedAt = new Date().toISOString();
    await save(journal);
    out.ok = true; out.status = "done";
    out.counts = { entries: journal.entries.length, skipped: out.skipped.length, blocked: out.blocked.length };
    return out;
  };

  /**
   * 逆 journal 回滚（倒序执行逆操作）。
   * 底线：绝不覆盖原位置已有内容、绝不删内容被改过的文件、目录非空则保留。
   * R8：**回滚不再被「目录非空」卡住**——
   *   ① 先做一轮「收容」：本轮新建目录里那些**不属于本轮**的文件/文件夹，整体挪进
   *      顶层 `回滚保留-<戳>/`（保留原相对路径），于是目录空了、回滚继续走完，用户的东西一篇不丢；
   *   ② 本轮种子被用户改过（sha256 不符）→ 也不删，同样请进收容区。
   * 收尾结果 = 原样笔记回到原位 + 一个装「回滚时保留」的文件夹。
   * opts: { force, onProgress, saveJournal, now, keepName, cfg, quarantine:false 可关 }
   */
  RebuildService.prototype.rollback = async function (journal, opts) {
    opts = opts || {};
    var app = this.app;
    var vop = new KB.services.vaultops(app);
    var save = opts.saveJournal || function () { return Promise.resolve(); };
    var progress = opts.onProgress || function () {};
    var force = opts.force === true;
    var entries = (journal && journal.entries ? journal.entries : []).slice().reverse();
    var out = { ok: true, restored: [], skipped: [], blocked: [], errors: [], total: entries.length,
      changed: [], quarantine: { folder: null, moved: [], errors: [], scannedDirs: 0 } };

    /* 收容文件夹名只算一次，两个阶段共用（阶段 A 建了它之后就不再另起名字） */
    var keepName = opts.keepName || this.quarantineName(opts.cfg, this.stampNow(opts.now));

    /* ---- 阶段 A：本轮新建目录里的「外来户」→ 收容区 ---- */
    if (opts.quarantine !== false) {
      try {
        out.quarantine = await this.quarantineForeign(journal, { keepName: keepName });
        if (out.quarantine.folder) out.keepFolder = out.quarantine.folder;
      } catch (e) {
        out.errors.push({ entry: { op: "quarantine" }, error: String((e && e.message) || e) });
        out.ok = false;
      }
    }

    /* ---- 阶段 B：倒序撤销 ---- */
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      try {
        if (e.op === "create") {
          var f = app.vault.getAbstractFileByPath(e.path);
          if (!f) { out.skipped.push({ path: e.path, reason: "已不存在" }); continue; }
          if (e.sha256 && !force && (await vop.shaOf(f)) !== e.sha256) {
            /* R8：内容被改过 → 不删（原底线），但别让整条回滚卡死在这儿：挪进收容区。
             * 挪成功 = 文件保住了、目录也让开了；挪不动才退回收容前的 blocked 行为。
             * R15 修：opts.quarantine === false 时与阶段 A 同口径 —— 收容整体关掉，
             * 直接走 blocked，不再偷偷建收容目录挪文件。 */
            var moved = false;
            if (opts.quarantine !== false) {
              moved = await this._quarantineMove(app, vop, f, { keepName: keepName }, out.quarantine);
            }
            if (moved) {
              out.changed.push(e.path);
              out.keepFolder = out.quarantine.folder || keepName;
              progress({ phase: "quarantine", done: i + 1, total: entries.length, item: e.path });
              continue;
            }
            out.blocked.push({ path: e.path, reason: "内容已被改动且挪不进收容区 → 不删（force 才删）" });
            continue;
          }
          await vop.remove(f, force);
          out.restored.push(e.path);
        } else if (e.op === "log") {
          /* R6：操作日志笔记（执行后写进新建根下）→ 回滚先删它，
           * 否则它会让新建根的 rmdir 因「目录非空」而保留 → 自检报「新建根仍存在」。 */
          var lf = app.vault.getAbstractFileByPath(e.path);
          if (!lf) { out.skipped.push({ path: e.path, reason: "已不存在" }); continue; }
          await vop.remove(lf, force);
          out.restored.push(e.path);
        } else if (e.op === "mkdir" || e.op === "mkdirOld") {
          var d = app.vault.getAbstractFileByPath(e.path);
          if (!d) { out.skipped.push({ path: e.path, reason: "已不存在" }); continue; }
          if (!vop.isEmptyFolder(d)) { out.blocked.push({ path: e.path, reason: "目录非空 → 保留" }); continue; }
          await vop.remove(d);
          out.restored.push(e.path);
        } else if (e.op === "move") {
          var cur = app.vault.getAbstractFileByPath(e.to);
          if (!cur) { out.skipped.push({ path: e.to, reason: "已不在目标位" }); continue; }
          if (app.vault.getAbstractFileByPath(e.from)) {
            out.blocked.push({ path: e.from, reason: "原位置已有同名 → 不覆盖" }); continue;
          }
          if (e.sha256 && !force && e.kind !== "folder" && (await vop.shaOf(cur)) !== e.sha256) {
            out.blocked.push({ path: e.to, reason: "目标位内容已被改动 → 不搬回" }); continue;
          }
          var rr = await vop.rename(cur, e.from);
          if (!rr.ok) { out.blocked.push({ path: e.to, reason: rr.reason }); continue; }
          out.restored.push(e.from);
        } else {
          out.skipped.push({ path: e.path || e.to || "?", reason: "未知条目" });
          continue;
        }
        progress({ phase: "rollback", done: i + 1, total: entries.length, item: e.path || e.to });
      } catch (err) {
        out.errors.push({ entry: e, error: String((err && err.message) || err) });
        out.ok = false;
      }
    }

    /* ---- R9 收尾：空目录二次清理 ----
     * 倒序撤销里「目录非空 → 保留」的那些，只要上层先空了，这里就能补删掉 ——
     * 否则新建根永远留着、自检报「新建根仍存在: 新知识库」，老板看到的就是「回滚无法完成」。
     * 已经补删成功的项从 blocked 挪到 restored（它其实已经解决，不该再算「阻止」）。 */
    try {
      out.cleanup = await this.sweepEmptyDirs(journal);
    } catch (e2) {
      out.cleanup = { removed: [], kept: [], error: String((e2 && e2.message) || e2) };
    }
    if (out.cleanup.removed.length && out.blocked.length) {
      var doneSet = {};
      out.cleanup.removed.forEach(function (p) { doneSet[p] = true; });
      var stillBlocked = [];
      for (var ib = 0; ib < out.blocked.length; ib++) {
        var bp = out.blocked[ib].path;
        if (bp && doneSet[bp]) { out.restored.push(bp); continue; }
        stillBlocked.push(out.blocked[ib]);
      }
      out.blocked = stillBlocked;
    }

    journal.status = (out.blocked.length || out.errors.length) ? "rolled-back-partial" : "rolled-back";
    journal.rolledBackAt = new Date().toISOString();
    if (out.quarantine && out.quarantine.moved.length) journal.keptFolder = out.quarantine.folder;
    await save(journal);
    if (out.blocked.length || out.errors.length) out.ok = false;
    return out;
  };

  /** 回滚后自证：搬运源回到原位且 sha256 一致、目标位无残留、本轮新造的根已消失 */
  RebuildService.prototype.verifyRestored = async function (manifest) {
    var app = this.app;
    var vop = new KB.services.vaultops(app);
    var bad = [];
    var moves = (manifest && manifest.moves) || [];
    /* R7：库根名 = 新建根名之后，库根**本身就是搬运源**（旧库被归档）。
     * 它「回到原位」正是回滚成功的标志 —— 这时再拿「根必须消失」当判据就是自造假警报。
     * 只有本轮真·新造出来的根（uniqueRoot 编号那种）才要求消失。 */
    var rootIsMoved = false;
    for (var m = 0; m < moves.length; m++) if (manifest && moves[m].from === manifest.root) rootIsMoved = true;
    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i];
      var f = app.vault.getAbstractFileByPath(mv.from);
      if (!f) { bad.push("缺件: " + mv.from); continue; }
      if (mv.sha256 && (await vop.shaOf(f)) !== mv.sha256) bad.push("内容不符: " + mv.from);
      if (app.vault.getAbstractFileByPath(mv.to)) bad.push("目标位残留: " + mv.to);
    }
    /* R8/R9：三种「根留着也不算失败」的情形，任一成立就不该报「新建根仍存在」——
     *   · rootIsMoved：库根本身就是搬运源（老库被归档进旧文件区），它回原位正是成功标志；
     *   · manifest.keepRoot：再次执行时「已有的知识库原地保留」，回滚本就不该把它删掉。 */
    if (manifest && !rootIsMoved && !manifest.keepRoot && app.vault.getAbstractFileByPath(manifest.root))
      bad.push("新建根仍存在: " + manifest.root);
    return { ok: bad.length === 0, bad: bad, rootIsMoved: rootIsMoved,
      rootKept: !!(manifest && manifest.keepRoot) };
  };

  KB.service("rebuild", RebuildService);
  return RebuildService;
});

/* ===== 66_services_report.js ===== */
/* 操作日志报告（R6）：把重建的预览/执行/回滚变成**可读的笔记实体**，而不是只躺在 json 里。
 * 挂在 RebuildService 上（增量文件，不动 65 的正逻辑），内容是确定性的 —— 同一输入 + 同一时刻必得同一字节。
 * 注意：日志笔记一律落在「操作日志」目录，且调用方负责挑一个**当前安全**的库根（见 82 的 writeLogNote）。 */
KB.define("services/report", function () {
  var RebuildService = KB.services.rebuild;
  var LOG_SUBDIR = "05_操作日志";

  var KINDS = {
    preview:  { title: "新建知识库 · 预览报告", action: "生成预览报告（只读：不搬不改任何已有笔记，仅写本报告）", file: "新建知识库·预览" },
    execute:  { title: "新建知识库 · 执行报告", action: "执行（按 manifest 落库）",           file: "新建知识库·执行" },
    rollback: { title: "新建知识库 · 回滚报告", action: "回滚（按 journal 逆序撤销）",        file: "新建知识库·回滚" },
    autofill: { title: "笔记自动化 · 一键补全报告", action: "一键补全（扫描缺 YAML / 缺尾部双链并补齐）", file: "笔记自动化·一键补全" }
  };

  function p2(n) { return (n < 10 ? "0" : "") + n; }
  /** 2026-09-17 11:52 */
  function stamp(d) {
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
      " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }
  /** 2026-09-17 1152（文件名用，不含冒号） */
  function fileStamp(d) {
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
      " " + p2(d.getHours()) + p2(d.getMinutes());
  }
  function dateOnly(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function bytes(n) {
    if (n === null || n === undefined) return "—";
    if (n < 1024) return n + " B";
    return (n / 1024).toFixed(1) + " KB";
  }
  /** 现读文件大小（plan 里不带 bytes，报告里补上；读不到就 —） */
  function sizeOf(app, path) {
    try {
      var f = app && app.vault && app.vault.getAbstractFileByPath(path);
      return (f && f.stat && typeof f.stat.size === "number") ? f.stat.size : null;
    } catch (e) { return null; }
  }
  function cell(s) { return "`" + String(s).replace(/\|/g, "\\|") + "`"; }
  function shortHash(h) { return h ? "`" + String(h).slice(0, 8) + "…`" : "—"; }
  function bulletOrNone(list, render, empty) {
    if (!list || !list.length) return [empty || "无。", ""];
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(render(list[i], i));
    out.push("");
    return out;
  }
  /** 操作日志目录（相对库根）：<root>/<metaDir>/05_操作日志 */
  function logFolder(paths, rootPath) {
    var meta = (paths && paths.metaDir) || "99_Meta";
    var base = rootPath || (paths && paths.knowledgeBase) || "";
    return (base ? base + "/" : "") + meta + "/" + LOG_SUBDIR;
  }

  /**
   * 生成报告。kind: preview | execute | rollback
   * payload:
   *   preview  → { plan, state }
   *   execute  → { manifest, result, journalPath, manifestPath }
   *   rollback → { journal, result, verify }
   * opts: { now: Date, paths, pluginDir, logDir }
   * 返回 { title, fileName, markdown }
   */
  RebuildService.prototype.reportMarkdown = function (kind, payload, opts) {
    opts = opts || {};
    payload = payload || {};
    var now = (opts.now instanceof Date) ? opts.now : new Date();
    var k = KINDS[kind] || KINDS.preview;
    var DIR = opts.pluginDir || ".obsidian/plugins/kb-toolkit";
    var L = [];

    L.push("---");
    L.push("类型: 操作日志");
    L.push("主题: " + k.title);
    L.push("状态: 已整理");
    L.push("创建日期: " + dateOnly(now));
    L.push("tags:");
    L.push("  - 操作日志");
    L.push("---", "");
    L.push("# " + k.title, "");

    if (kind === "execute") this._reportExecute(L, payload, now, DIR);
    else if (kind === "rollback") this._reportRollback(L, payload, now, DIR);
    else if (kind === "autofill") this._reportAutofill(L, payload, now, DIR);
    else this._reportPreview(L, payload, now, DIR);

    L.push("## 关联笔记", "");
    L.push("- 所属中心：[[MOC_知识地图]]");
    L.push("- 返回 [[MOC_知识地图]]");
    L.push("");

    return { title: k.title, fileName: fileStamp(now) + " " + k.file + ".md", markdown: L.join("\n") };
  };

  /* ---------------- 预览报告 ---------------- */
  RebuildService.prototype._reportPreview = function (L, payload, now, DIR) {
    var plan = payload.plan || {};
    var st = payload.state || {};
    var c = plan.counts || {};
    var STATE = { fresh: "未创建（顶层还有待归拢的文件）", partial: "半成品（新建根已存在，顶层仍有待搬项）", done: "已是已完成态" };

    L.push("| 项 | 值 |");
    L.push("| --- | --- |");
    L.push("| 操作 | " + KINDS.preview.action + " |");
    L.push("| 时间 | " + stamp(now) + " |");
    L.push("| 当前状态 | " + (STATE[st.state] || st.state || "未知") + " |");
    L.push("| 新建根 | " + cell(plan.root) + " |");
    L.push("| 旧文件区 | " + cell(plan.oldFolder) + (plan.mergeOld ? "（已存在 → 并入模式）" : "（不存在，执行时新建）") + " |");
    L.push("| manifest 自校验 | " + (plan.manifestValid === false ? "**未通过**：" + (plan.manifestErrors || []).join("；") : "通过") + " |");
    L.push("| 机器可读报告 | " + cell(DIR + "/rebuild-preview.json") + " · " + cell(DIR + "/rebuild-manifest.json") + " |");
    L.push("");

    L.push("## 1. 计划搬运（" + (c.moves || 0) + " 项：文件 " + (c.fileMoves || 0) + " + 文件夹 " + (c.folderMoves || 0) + "）", "");
    if (c.moves) {
      L.push("| # | 源 | → 目标 | 类型 | 字节 | sha256 |");
      L.push("| --- | --- | --- | --- | --- | --- |");
      var moves = plan.moves || [];
      var self = this;
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        L.push("| " + (i + 1) + " | " + cell(m.from) + " | " + cell(m.to) + " | " + (m.type === "folder" ? "文件夹" : "文件") +
          " | " + (m.type === "folder" ? "—" : bytes(sizeOf(self.app, m.from))) + " | " + shortHash(m.sha256) + " |");
      }
      L.push("");
      L.push("> 搬运是**库内改名**（Obsidian `renameFile`），不复制、不丢内容；目标位已有同名 → **跳过且绝不覆盖**。", "");
    } else {
      L.push("顶层没有需要搬走的项。", "");
    }

    L.push("## 2. 将新建目录（" + (c.creates || 0) + "）", "");
    if (c.creates) { L.push("```"); (plan.creates || []).forEach(function (d) { L.push(d); }); L.push("```", ""); }
    else L.push("无。", "");

    L.push("## 3. 将写入种子文件（" + (c.seeds || 0) + "）", "");
    if (c.seeds) {
      L.push("| # | 路径 |");
      L.push("| --- | --- |");
      (plan.seeds || []).forEach(function (s, i) { L.push("| " + (i + 1) + " | " + cell(s) + " |"); });
      L.push("");
      L.push("> 种子内容确定性（同一结构模板 → 同一字节），可 sha256 校验；已存在的文件一律跳过。", "");
    } else L.push("无。", "");

    L.push("## 4. 冲突（" + (c.conflicts || 0) + "）", "");
    var conflictLines = bulletOrNone(plan.conflicts, function (x) {
      return "- " + cell(x.from) + " → " + cell(x.to) + "： " + x.reason;
    });
    for (var ci = 0; ci < conflictLines.length; ci++) L.push(conflictLines[ci]);

    L.push("## 5. 排除（" + (c.excluded || 0) + "）", "");
    if ((plan.excluded || []).length) {
      L.push("| 路径 | 原因 |");
      L.push("| --- | --- |");
      (plan.excluded || []).forEach(function (x) { L.push("| " + cell(x.path) + " | " + x.reason + " |"); });
      L.push("");
    } else L.push("无。", "");

    L.push("## 6. 下一步", "");
    L.push("1. **执行**：设置页 → ① 新建知识库 → 执行（弹窗里勾选「我已确认坚果云同步完成」才解锁）");
    L.push("2. **回滚**：设置页 → ① 新建知识库 → 回滚（按 `rebuild-journal.json` 逆序撤销，绝不覆盖原位置已有内容）");
    L.push("3. **复核**：随时再点一次「生成预览报告」，本报告会被重新生成", "");
  };

  /* ---------------- 执行报告 ---------------- */
  RebuildService.prototype._reportExecute = function (L, payload, now, DIR) {
    var man = payload.manifest || {};
    var res = payload.result || {};
    var okDone = res.status === "done";
    /* R9：把「计划搬运」与**实际结果**对账。
     * 旧报告把 manifest 里所有 move 都当成已搬列出 —— 真机实测「2 项全被跳过，报告却写着
     * 计划搬运 2 项 + 表格 2 行」→ 老板报的第 6 条「执行时，有文件没有成功迁移整理」。
     * 现在按 journal 的 op:"move" 条目分出「真搬成」，再单列「已在目标位」与「未搬成」。 */
    var jmoves = [];
    var jentries = (res.journal && res.journal.entries) || [];
    for (var ji = 0; ji < jentries.length; ji++) {
      var je = jentries[ji];
      if (je && je.op === "move") jmoves.push(je);
    }
    var skipped = res.skipped || [], blocked = res.blocked || [];
    var alreadySkipped = skipped.filter(function (s) { return s.reversible === true; });
    var otherSkipped = skipped.filter(function (s) { return s.reversible !== true; });
    var notMoved = otherSkipped.length + blocked.length;
    var planned = (man.moves || []).length;
    /* R9：journal 里的 move 条目有两类 —— 本次**真搬**的，和「执行前就已在目标位、本次没动」的
     * （preexisting:true）。后者只写进日志以便回滚，不能算进「真搬成」，否则又变成把「计划」说成「已搬」。
     * 「已在目标位」那批单独在下面第 2 节列。 */
    var reallyMoved = jmoves.filter(function (m) { return !m.preexisting; });

    L.push("| 项 | 值 |");
    L.push("| --- | --- |");
    L.push("| 操作 | " + KINDS.execute.action + " |");
    L.push("| 时间 | " + stamp(now) + " |");
    L.push("| 结果 | " + (okDone ? "**完成**" : res.status === "failed" ? "**中断**（失败即停）" : String(res.status || "未知")) + " |");
    L.push("| 新建根 | " + cell(man.root) + " |");
    L.push("| 旧文件区 | " + cell(man.oldFolder) + " |");
    L.push("| 计划搬运 | " + planned + " 项（本次**真搬成 " + reallyMoved.length + "** 项）|");
    L.push("| 已在目标位 | " + alreadySkipped.length + " 项（上一次执行搬过 → 不再动，但已记入可逆日志）|");
    L.push("| 未搬成 | " + notMoved + " 项（跳过 " + otherSkipped.length + " + 阻止 " + blocked.length + "）|");
    L.push("| 新建目录 | " + ((man.creates || []).length) + " 个 |");
    L.push("| 写入种子 | " + ((man.seeds || []).length) + " 篇 |");
    L.push("| 默认模板 | " + ((res.templates || []).length) + " 套（PARA / 轻量收件 / 项目 / 资料，目录已有模板时自动跳过）|");
    L.push("| 可逆日志 | " + cell(DIR + "/rebuild-journal.json") + " |");
    L.push("");
    if (res.status === "failed") {
      L.push("> ⚠️ 中断于 **" + (res.failedAt || "?") + "**：" + (res.error || "") + "");
      L.push("> 已执行的部分**不回滚**（失败现场要留着）；看过上面的明细后再决定是否点「回滚」。", "");
    }

    L.push("## 1. 搬运 · 真搬成（" + reallyMoved.length + " / 计划 " + planned + "）", "");
    if (planned && !reallyMoved.length)
      L.push("> ⚠️ 计划里的搬运项**本次一项都没搬**。原因见下方第 2、3 节（不是静默失败，是真没搬）。", "");
    if (reallyMoved.length) {
      L.push("| # | 源 | → 目标 | 类型 |");
      L.push("| --- | --- | --- | --- |");
      reallyMoved.forEach(function (m, i) {
        L.push("| " + (i + 1) + " | " + cell(m.from) + " | " + cell(m.to) + " | " +
          (m.kind === "folder" ? "文件夹" : "文件") + " |");
      });
      L.push("");
      L.push("> 搬运是**库内改名**（Obsidian `renameFile`），不复制、不丢内容；目标位已有同名 → **跳过且绝不覆盖**。", "");
    } else L.push("本次没有真正搬动的条目。", "");

    L.push("## 2. 已在目标位（" + alreadySkipped.length + "）", "");
    if (alreadySkipped.length) {
      L.push("> 这些在执行前就已经躺在目标位（上一次执行搬过）→ 本次不再动它们，"
        + "但**已写进可逆日志**，所以回滚照样能把它们搬回原位（R9 修的「缺件」就是这条）。", "");
      L.push("| # | 源（回滚会搬回这里）| 现在的位置 |");
      L.push("| --- | --- | --- |");
      alreadySkipped.forEach(function (s, i) {
        L.push("| " + (i + 1) + " | " + cell(s.from || "?") + " | " + cell(s.to || "?") + " |");
      });
      L.push("");
    } else L.push("无。", "");

    L.push("## 3. 未搬成（" + notMoved + "）", "");
    if (notMoved) {
      L.push("| # | 源 / 路径 | 结果 | 原因 |");
      L.push("| --- | --- | --- | --- |");
      otherSkipped.forEach(function (s, i) {
        L.push("| " + (i + 1) + " | " + cell(s.from || s.path || "?") + " | 跳过 | " + (s.reason || "") + " |");
      });
      var n0 = otherSkipped.length;
      blocked.forEach(function (s, i) {
        L.push("| " + (n0 + i + 1) + " | " + cell(s.from || s.path || "?") + " | **阻止** | " + (s.reason || "") + " |");
      });
      L.push("");
      if (blocked.length)
        L.push("> 阻止 = 目标位已有同名且内容不同 → **保持原样，绝不覆盖**。这些项需要手工确认。", "");
    } else L.push("无（没有发生任何「让路」）。", "");

    L.push("## 4. 下一步", "");
    L.push("- 不满意？**回滚**：设置页 → ① 新建知识库 → 回滚，会把搬走的整体搬回、删掉本轮新建的目录与种子。");
    L.push("- 满意？新库在 " + cell(man.root) + "，旧内容整体躺在 " + cell(man.oldFolder) + "，可自行整理。", "");
  };

  /* ---------------- 回滚报告 ---------------- */
  RebuildService.prototype._reportRollback = function (L, payload, now, DIR) {
    var j = payload.journal || {};
    var res = payload.result || {};
    var verify = payload.verify || {};
    var q = res.quarantine || {};
    L.push("| 项 | 值 |");
    L.push("| --- | --- |");
    L.push("| 操作 | " + KINDS.rollback.action + " |");
    L.push("| 时间 | " + stamp(now) + " |");
    L.push("| 结果 | " + (res.ok && verify.ok !== false ? "**完成**" : "**部分完成**") + " |");
    L.push("| 撤销条目 | " + (res.total || 0) + " 条 |");
    L.push("| 已还原 | " + ((res.restored || []).length) + " 项 |");
    L.push("| 跳过 | " + ((res.skipped || []).length) + " 项 |");
    L.push("| 阻止（未动） | " + ((res.blocked || []).length) + " 项 |");
    L.push("| 错误 | " + ((res.errors || []).length) + " 项 |");
    L.push("| 收容保留 | " + (q.folder ? cell(q.folder) + "（" + (q.moved || []).length + " 项）" : "无") + " |");
    var cl = res.cleanup || {};
    L.push("| 收尾补删空目录 | " + ((cl.removed || []).length) + " 个" +
      ((cl.kept || []).length ? "（另有 " + cl.kept.length + " 个仍非空 → 保留）" : "") + " |");
    L.push("| 自检 | " + (verify.ok === false ? "**未通过**：" + (verify.bad || []).join("；") : "通过（源已回原位、目标位无残留、新建根已消失）") + " |");
    L.push("| 原重建日志 | " + cell(DIR + "/rebuild-journal.json") + " |");
    L.push("");

    L.push("## 1. 已还原（" + ((res.restored || []).length) + "）", "");
    if ((res.restored || []).length) {
      L.push("```");
      res.restored.forEach(function (p) { L.push(p); });
      L.push("```", "");
    } else L.push("无。", "");

    if (q.folder && (q.moved || []).length) {
      L.push("## 2. 回滚时保留（" + q.moved.length + "）→ " + cell(q.folder), "");
      L.push("> 这些是**回滚前才出现在新库里**的东西（或者被改动过的本轮种子）。");
      L.push("> 删掉目录前先把它们请到一个单独的文件夹里 —— 回滚才能一路走完，而你的笔记一篇不丢。", "");
      L.push("| # | 原位置 | → 保留位置 | 类型 |");
      L.push("| --- | --- | --- | --- |");
      q.moved.forEach(function (m, i) {
        L.push("| " + (i + 1) + " | " + cell(m.from) + " | " + cell(m.to) + " | " +
          (m.kind === "folder" ? "文件夹" : "文件") + " |");
      });
      L.push("");
    }

    L.push("## 3. 阻止（" + ((res.blocked || []).length) + "）", "");
    if ((res.blocked || []).length) {
      L.push("| 路径 | 原因 |");
      L.push("| --- | --- |");
      res.blocked.forEach(function (b) { L.push("| " + cell(b.path || "?") + " | " + (b.reason || "") + " |"); });
      L.push("");
      L.push("> 回滚的底线：**原位置已有内容就不搬回、内容被改动过就不删、目录非空就保留**。上面这些需要手工处理。", "");
    } else L.push("无。", "");

    L.push("## 4. 自检结论", "");
    L.push(verify.ok === false
      ? "未通过：" + (verify.bad || []).join("；")
      : (verify.rootKept
        ? "搬运源已回到原位且内容 sha256 一致；旧文件区无残留。（本轮是「再次执行」，**原有知识库本来就该保留**，所以不要求它消失。）"
        : verify.rootMoved
          ? "搬运源已回到原位且内容 sha256 一致；旧文件区无残留。（库根本轮就是搬运源，回到原位即成功。）"
          : "搬运源已回到原位且内容 sha256 一致；旧文件区无残留；新建根已消失。")); L.push("");
  };

  /* ---------------- 一键补全报告（R8） ---------------- */
  RebuildService.prototype._reportAutofill = function (L, payload, now, DIR) {
    var res = payload.result || {};
    L.push("| 项 | 值 |");
    L.push("| --- | --- |");
    L.push("| 操作 | " + KINDS.autofill.action + " |");
    L.push("| 时间 | " + stamp(now) + " |");
    L.push("| 结果 | " + (res.ok === false ? "**有失败项**" : "**完成**") + " |");
    L.push("| 扫过 | " + (res.scanned || 0) + " 篇 |");
    L.push("| 需要补全 | " + (res.todo || 0) + " 篇 |");
    L.push("| 实际写入 | " + ((res.written || []).length) + " 篇 |");
    L.push("| 补 YAML 头 | " + (res.yaml || 0) + " 篇 |");
    L.push("| 补尾部双链 | " + (res.links || 0) + " 篇 |");
    L.push("| 空笔记整套模板 | " + (res.full || 0) + " 篇 |");
    L.push("| 失败 | " + ((res.errors || []).length) + " 项 |");
    L.push("");

    L.push("## 1. 逐篇明细（" + ((res.written || []).length) + "）", "");
    if ((res.written || []).length) {
      L.push("| # | 笔记 | 用的模板 | 命中规则 | 补了什么 |");
      L.push("| --- | --- | --- | --- | --- |");
      (res.written || []).forEach(function (w, i) {
        var what = [];
        if (w.full) what.push("整套模板");
        else { if (w.yaml) what.push("YAML 头"); if (w.links) what.push("尾部双链"); }
        L.push("| " + (i + 1) + " | " + cell(w.path) + " | " + cell(w.template || "—") + " | " +
          (w.rule || "当前模板") + " | " + (what.join(" + ") || "—") + " |");
      });
      L.push("");
      L.push("> 只**加**不删：有正文的笔记只在缺的位置补一段，原有内容一个字符没动。", "");
    } else L.push("没有需要补全的笔记。", "");

    L.push("## 2. 失败（" + ((res.errors || []).length) + "）", "");
    var el2 = bulletOrNone(res.errors, function (x) { return "- " + cell(x.path) + "： " + x.error; });
    for (var ei = 0; ei < el2.length; ei++) L.push(el2[ei]);

    L.push("## 3. 下一步", "");
    L.push("- 补完的笔记可以到创作看板里继续整理；缺属性的会落在「待整理」分组。");
    L.push("- 想改补全内容 → 设置页 ② 笔记自动化 →「创建补全模板」改模板正文（模板就是模板库里的 .md）。", "");
  };

  KB.service("report", { logFolder: logFolder, KINDS: KINDS, stamp: stamp, fileStamp: fileStamp });
  return { logFolder: logFolder };
});

/* ===== 70_core_settings.js ===== */
/* 设置：三分法总控制台（顺序 = boss 定版：① 新建知识库 → ② 笔记自动化 → ③ 更多的 Base）。
 * 配置带 schemaVersion 迁移链；默认路由表 = note-locator 现网表（R2 切换时做 data.json 迁移覆盖）。 */
KB.define("core/settings", function () {
  /* ---- R5：路径命名唯一的「默认值」出口 -------------------------------------------------
   * 全插件只在这里出现一次顶层目录字面量；routes / excluded / mocLink 一律由它们派生，
   * 新用户改 paths.knowledgeBase 一个字段，路由与排除规则自动跟随。 */
  var DEFAULT_ROOT = "01_新知识库";
  var DEFAULT_META = "99_Meta";
  var DEFAULT_LEGACY = "02_旧知识库";
  /* 相对库根的路由表（老板现网表；A 类目录照旧全路径派生前缀） */
  var REL_ROUTES = [
    { folder: "00_Inbox", values: ["收件箱", "Inbox"] },
    { folder: "01_Projects/01_执行中", values: ["01_执行中", "执行中"] },
    { folder: "01_Projects/02_待跟进", values: ["02_待跟进", "待跟进"] },
    { folder: "01_Projects/03_孵化箱", values: ["03_孵化箱", "孵化箱"] },
    { folder: "01_Projects", values: ["项目"] },
    { folder: "02_Areas/内容创作", values: ["内容创作"] },
    { folder: "02_Areas/游戏研究", values: ["游戏研究"] },
    { folder: "02_Areas/每日任务", values: ["每日任务"] },
    { folder: "02_Areas/灵感杂记", values: ["灵感杂记"] },
    { folder: "03_Resources", values: ["资源"] },
    { folder: "04_Archives", values: ["归档"] },
    { folder: "02_Areas", values: ["领域"] }
  ];
  /** 相对路由 → 全路径路由（前缀 = 库根名） */
  function withRoot(root, rel) {
    return rel.map(function (r) { return { folder: root + "/" + r.folder, values: r.values.slice() }; });
  }
  var DEFAULT_KEEP = "回滚保留";     /* 与 rebuild.rollbackKeepName 的默认值保持一致 */
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  /** 排除规则（库内元数据目录 + 历史存档库 + 回滚收容区 + 点开头目录），由路径配置派生。
   *  🔴 R9 加「回滚收容区」那一条：回滚阶段 A 把外来户 rename 进 `回滚保留-<戳>/`，
   *     这条 rename 事件会喂给 ② 的路由 —— 不排除它，路由就照着笔记的「文件位置」
   *     把它搬回新库：收容白做、目录仍旧非空、回滚卡在「目录非空」（老板报的第 5/7 条）。
   *  keepName 传 null = 不生成这一条（专门用来识别「用户没手改过」的旧默认值）。 */
  function defaultExcluded(paths, keepName) {
    var p = paths || { knowledgeBase: DEFAULT_ROOT, metaDir: DEFAULT_META, legacyDirs: [DEFAULT_LEGACY] };
    var out = ["^" + p.knowledgeBase + "/" + p.metaDir];
    (p.legacyDirs || []).forEach(function (d) { if (d) out.push("^" + d); });
    var k = (keepName === undefined) ? DEFAULT_KEEP : keepName;
    if (k) out.push("^" + escRe(k));
    out.push("(^|/)\\.");
    return out;
  }

  var DEFAULTS = {
    schemaVersion: 1,
    /* ①②在 R2/R4 切换轮才默认打开，避免与线上插件双跑；③视图类无事件冲突可先开 */
    /* R8：base.boardExclude = 创作看板的「排除目录」默认值。
     *   boss 要「默认展示整个笔记库」→ 默认留空；写了目录段（如 99_Meta）才挡。 */
    modules: { rebuild: false, automation: false, base: true, "base.creationBoard": true,
               "base.noteStream": true, "base.boardExclude": "" },
    legacyCheck: true,
    wizardDone: false,          /* R5：首次使用向导是否已走过 */
    paths: { knowledgeBase: DEFAULT_ROOT, metaDir: DEFAULT_META,
             legacyDirs: [DEFAULT_LEGACY],
             mocLink: DEFAULT_ROOT + "/" + DEFAULT_META + "/04_索引与地图/MOC_知识地图" },
    rebuild: {
      /* R7：新建根名 = 库根名（唯一真源 = paths.knowledgeBase）。这里只是**派生的默认值**，
       * normalize() 每次加载/改路径都会把它对齐回 paths.knowledgeBase ——
       * 旧版把它写死成「知识库」且跟库根脱钩，导致「重建出来的库插件自己认不出」。 */
      rootName: DEFAULT_ROOT,
      oldFolderName: "旧文件",
      /* R8：旧文件区**已存在**时（= 这不是第一次重建）旧文件区下要分代建子文件夹 */
      archivePriorName: "先前已有",     /* 存放「再次创建前已有」的文件 */
      archiveIncomingName: "本次移入",  /* 存放「本次新移入」的文件 */
      /* R8：回滚时把「本轮之外的新建文件」单独收进这个顶层文件夹，再继续回滚 */
      rollbackKeepName: "回滚保留",
      excludedTop: [".obsidian", ".trash", ".workbuddy"],
      keepTop: [],              /* 顶层保留不搬的条目（boss 可手动加） */
      requireCloudSynced: true, /* R4b：执行/回滚前必须勾选「坚果云已同步完成」 */
      seedDate: "",             /* R4b：种子文件「创建日期」；空 = 不写，保持内容确定性 */
      /* 结构模板：照 01_新知识库 现状提炼；可导出导入（R4a 只读） */
      template: {
        schemaVersion: 1,
        dirs: [
          "00_Inbox",
          "01_Projects", "01_Projects/01_执行中", "01_Projects/02_待跟进", "01_Projects/03_孵化箱",
          "02_Areas", "02_Areas/内容创作", "02_Areas/游戏研究", "02_Areas/每日任务", "02_Areas/灵感杂记",
          "03_Resources", "04_Archives",
          "99_Meta", "99_Meta/01_仪表盘", "99_Meta/02_模板库", "99_Meta/02_模板库/Templater",
          "99_Meta/03_AI指令集", "99_Meta/04_索引与地图", "99_Meta/05_操作日志"
        ],
        seedFiles: [
          "00_Inbox/_收件箱.md",
          "01_Projects/_项目中心.md",
          "02_Areas/_领域中心.md",
          "03_Resources/_资源中心.md",
          "04_Archives/_归档中心.md",
          "99_Meta/04_索引与地图/MOC_知识地图.md",
          "99_Meta/04_索引与地图/知识库目录说明.md"
        ]
      }
    },
    automation: {
      property: "文件位置",
      writeBack: true,
      fixCenterLink: true,
      createFill: true,          /* R2：创建空白新文件时自动补 YAML 头 + 尾部关联笔记 */
      migrated: false,           /* R2：note-locator data.json 一次性迁移标记 */
      /* R7：创建补全用哪套模板。text 里只有 {{占位符}}，渲染在 36_services_templates.js；
       * items 为空 = 全用内置四套。id 与内置同名即「覆盖内置」。
       * R8：模板**以文件为准** —— <库根>/<元目录>/02_模板库/Templater/*.md；
       * dir 留空 = 按 paths 派生（换库根/元目录自动跟随）。items 保留是为了兼容 R7 的旧配置。 */
      templates: { activeId: "builtin/para", items: [], dir: "", subDir: "02_模板库/Templater" },
      /* R8：套用规则 —— 哪些文件夹 / 标签下的新笔记用哪套模板。
       * 命中优先级：标签规则 → 文件夹规则（最长前缀）→ activeId 兜底。 */
      templateRules: [],
      excluded: defaultExcluded(),
      routes: withRoot(DEFAULT_ROOT, REL_ROUTES),
      propertyOptions: {
        "文件位置": ["00_Inbox", "01_Projects", "01_Projects/01_执行中", "01_Projects/02_待跟进",
          "01_Projects/03_孵化箱", "02_Areas", "02_Areas/内容创作", "02_Areas/游戏研究",
          "02_Areas/每日任务", "02_Areas/灵感杂记", "03_Resources", "04_Archives"],
        "状态": ["1-灵感", "2-选题", "3-撰写中", "4-待发布", "5-已发布", "进行中",
          "待整理", "已整理", "持续更新", "已完成", "归档"]
      }
    }
  };

  /** 深拷贝（R5 必须：settings 绝不能与 DEFAULTS 共享引用，否则改配置会污染默认值） */
  function clone(v) {
    if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(clone(v[i])); return a; }
    if (v && typeof v === "object") { var o = {}; for (var k in v) o[k] = clone(v[k]); return o; }
    return v;
  }
  /** 深合并：以 base 为底、extra 覆盖；数组整体替换（不逐项合并）；结果全为新对象 */
  function deepMerge(base, extra) {
    if (Array.isArray(extra)) return clone(extra);
    if (!extra || typeof extra !== "object") return clone(base);
    if (Array.isArray(base)) return clone(extra);
    var out = clone(base);
    for (var k in extra) {
      if (extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k]) &&
          out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
        out[k] = deepMerge(out[k], extra[k]);
      } else {
        out[k] = clone(extra[k]);
      }
    }
    return out;
  }

  /** schemaVersion 迁移链：后续版本追加 migrate_2 等，逐级升级 */
  var MIGRATIONS = { 1: function (s) { return s; } };

  /**
   * R7：把「派生字段」对齐到真源。目前只有一项 —— 新建根名 = 库根名。
   * 旧 data.json 里可能躺着 rootName:"知识库"（R6 之前的写死值），一律以 paths.knowledgeBase 为准。
   * 没有 UI 也没有 override 出口：一个概念一个名字，避免「库在 A、重建却建出 B」这种静默错位。
   */
  function normalize(s) {
    if (!s || !s.paths || !s.rebuild) return s;
    s.rebuild.rootName = s.paths.knowledgeBase;
    /* R9：老 data.json 里的 excluded 是 R9 之前那版默认值（没有「回滚收容区」那一条）。
     * 判据 = **逐字等于旧默认值** ⇒ 说明用户没手改过 ⇒ 就地升级成新默认值。
     * 手改过的一律原样保留（绝不覆盖用户的规则）。幂等：升级后再跑就相等了。 */
    try {
      var a = s.automation;
      if (a && Array.isArray(a.excluded) &&
          JSON.stringify(a.excluded) === JSON.stringify(defaultExcluded(s.paths, null))) {
        a.excluded = defaultExcluded(s.paths);
      }
    } catch (e) { /* 升级出问题就保持原值，不阻断加载 */ }
    return s;
  }

  function loadSettings(plugin) {
    var raw = plugin.loadData ? plugin.loadData() : {};
    return Promise.resolve(raw).then(function (data) {
      var s = deepMerge(DEFAULTS, data || {});
      var v = s.schemaVersion;
      while (MIGRATIONS[v + 1]) { v++; s = MIGRATIONS[v](s); s.schemaVersion = v; }
      normalize(s);
      plugin.settings = s;
      return s;
    });
  }
  function saveSettings(plugin) {
    return Promise.resolve(plugin.saveData(plugin.settings));
  }

  /**
   * R5：改了库根名 / 元目录名之后，把「派生字段」一起重算。
   * 只重算**仍是默认值**的字段 —— 用户手工改过的 routes / excluded 一律保留原样。
   * R7：新建根名（rebuild.rootName）是无条件重算的派生字段。
   */
  function reapplyPaths(settings, prevPaths) {
    var s = settings, prev = prevPaths || {};
    normalize(s);
    s.paths.mocLink = s.paths.knowledgeBase + "/" + s.paths.metaDir + "/04_索引与地图/MOC_知识地图";
    var oldRoutes = JSON.stringify(withRoot(prev.knowledgeBase || DEFAULT_ROOT, REL_ROUTES));
    if (JSON.stringify(s.automation.routes) === oldRoutes)
      s.automation.routes = withRoot(s.paths.knowledgeBase, REL_ROUTES);
    var oldExcl = JSON.stringify(defaultExcluded(prev));
    if (JSON.stringify(s.automation.excluded) === oldExcl)
      s.automation.excluded = defaultExcluded(s.paths);
    /* 结构模板里的目录是**相对**名字（挂在新库根下），元目录改名要跟着换 */
    if (prev.metaDir && prev.metaDir !== s.paths.metaDir) {
      var oldMeta = prev.metaDir, newMeta = s.paths.metaDir;
      var fix = function (p) {
        if (p === oldMeta) return newMeta;
        if (p.indexOf(oldMeta + "/") === 0) return newMeta + p.slice(oldMeta.length);
        return p;
      };
      s.rebuild.template.dirs = s.rebuild.template.dirs.map(fix);
      s.rebuild.template.seedFiles = s.rebuild.template.seedFiles.map(fix);
    }
    return s;
  }

  KB.service("settings", { DEFAULTS: DEFAULTS, deepMerge: deepMerge, loadSettings: loadSettings, saveSettings: saveSettings,
    DEFAULT_ROOT: DEFAULT_ROOT, DEFAULT_META: DEFAULT_META, DEFAULT_LEGACY: DEFAULT_LEGACY,
    REL_ROUTES: REL_ROUTES, withRoot: withRoot, defaultExcluded: defaultExcluded,
    normalize: normalize, reapplyPaths: reapplyPaths });
  return { DEFAULTS: DEFAULTS, deepMerge: deepMerge, loadSettings: loadSettings, saveSettings: saveSettings };
});

/* ===== 75_core_settingTab.js ===== */
/* 设置页：三分法总控制台。全部用 Obsidian 原生 Setting 组件，与本体风格一致。
 * R13（boss：界面翻新）按「核心 → 常用 → 高级」三级分层。
 * R16（boss：三标签改版）：三标签 + 栏目卡片 + 帮助悬浮小窗 + 马卡龙低饱和配色。
 * R18（boss：照《设置页排版方案v3-交互效果图》重做显示效果；交互不变 —— 帮助仍是「一栏 + 点开悬浮小窗」）：
 *   ① 页头：标题 + 右上角版本号；「日志 / 关于」挪到标签行右端（效果图 .tbs 里的 .ghs）；
 *   ② 搜索框：整行输入框，不再带「搜索设置」标题行（效果图 .sr）；
 *      命中他页不再自动跳走，改成提示「当前页无命中，其他页：X 处」+ 可点链接（效果图 .hint）；
 *   ③ 模块头：一行「标题 + 滑动开关」→ 左边一小条短横 → 状态行（主行 + ⓘ，ⓘ 带「下一步」提示）；
 *   ④ 栏目 = 小标签（卡片外）+ 卡片（卡片内每项一行、行间一条淡分隔线）；
 *   ⑤ 「高级」折叠组：summary 只有「高级」两字，符号由 CSS 画（› 收起 / ⌄ 展开），内容同样进卡片；
 *   ⑥ 帮助栏：页底一栏「帮助」入口 → 点开悬浮小窗；小窗里条目是「键 + 说明」一行一条（效果图 .hrow）；
 *   ⑦ 模块头不再挂 ⓘ（效果图把提示放在状态行里），故每页恰 1 个 ⓘ。
 * 不变的机制：R10 拨开关只重画本段（sectionBoxes）、R11 关=整段渲染+置灰不收起、
 *   R8 commitOnBlur（输入框失焦才落库）、R7 锚点补偿（keepAnchor）。
 * 顶部旧插件检测横幅 → 标签组；命令面板只留 4 条高频（见 82/80/90）。 */
KB.define("core/settingTab", function () {
  var LEGACY = [
    { id: "note-locator",     why: "其路由逻辑已内置（笔记自动化），双开会重复监听事件" },
    { id: "creation-board",   why: "创作看板已内置（更多的 Base）" },
    { id: "bases-preview",    why: "内容流视图已内置（更多的 Base）" },
    { id: "auto-note-mover",  why: "搬家已由笔记自动化接管" }
  ];
  /* 拨开关重画时要钉住的锚点（见 SettingTab.keepAnchor）；R13 起钉在第一个模块标题上 */
  var ANCHOR_CLS = "kb-modules-anchor";
  var VER_CLS = "kbt-ver";

  /* R16：三标签。dot = 小圆点用的主题色代号（样式里映射成 --color-*，不写裸色值） */
  var TABS = [
    { key: "rebuild",    label: "知识库", dot: "mint" },
    { key: "automation", label: "笔记",   dot: "cream" },
    { key: "base",       label: "Base",   dot: "taro" }
  ];
  /* R19 需求5：模块说明一句话就够 —— 细节全在各页的「帮助」小窗 / 状态小窗里 */
  var MOD_TIP = {
    rebuild: "预览 → 执行 → 回滚，全程可撤销",
    automation: "新笔记自动补全 · 按标签归位",
    base: "两个只读看板视图，不改文件"
  };
  /* R18：每页的「帮助」小窗内容 —— 照效果图的「键 + 说明」结构：{ k: 键, v: 说明 }。
   * 值里需要动态数字（路由条数 / 元目录名）的条目，用 HELP_OF() 现算。 */
  var HELP = {
    rebuild: [
      { k: "预览报告", v: "不搬不改，只生成一份报告告诉你「执行」会发生什么；第一次先点它" },
      { k: "执行", v: "真的开始搬文件；弹窗里需勾选「坚果云已同步完成」才会放行" },
      { k: "回滚", v: "按操作日志把上一次执行整体退回，搬走的文件原路返回" },
      { k: "首次使用向导", v: "重走一遍目录名 / 模块开关的初始化，不改动任何笔记文件" },
      { k: "操作日志", v: "每步报告都写在「元数据目录 / 05_操作日志」里，每篇含可回滚明细" },
      { k: "根目录 / 元数据目录", v: "笔记实际存放的顶层目录名；模板 / 指令集 / 索引 / 日志的存放目录" }
    ],
    automation: [
      { k: "创建时自动补全", v: "仅对空白新文件生效（避开粘贴与 Templater）；补什么由「当前模板」决定" },
      { k: "Templater 模板也能用", v: "模板正文含 <% %> 时先把模板交给 Templater 求值再写；求不到值就跳过不动手 —— 宁可不补，也不会把模板语法写进笔记" },
      { k: "被 Templater 接管的目录", v: "目录已配在 Templater 的「目录模板」里 → 这篇新笔记整个让给它，本插件不插手（避免两边互写）" },
      { k: "移动后同步", v: "移动统一走移动引擎，落位后自动同步 YAML 与尾部双链" },
      { k: "一键补全", v: "扫描整个知识库补齐缺失项；先出报告再写盘，只加不删" },
      { k: "标签-目录映射表", v: "沿用 note-locator 的映射表做落点；只用「标签」段定目录，「领域兜底」段不参与" }
    ],
    base: [
      { k: "创作看板", v: "视图类型 creation-board；配置存在 .base 的视图块里，跟着文件走" },
      { k: "内容流视图", v: "视图类型 note-stream；懒加载正文预览，长库也不卡" },
      { k: "排除目录", v: "按目录段匹配；留空 = 看板展示整个笔记库" },
      { k: "文件宽度 / 自动", v: "看板顶栏齿轮 → 「卡片」组：拉杆 160 – 480 px；「自动」开 = 卡片铺满整行（拉杆置灰）。每个看板视图各存一份" }
    ]
  };

  /**
   * 找这个元素所在的**可滚动祖先**（设置面板的滚动容器是本体给的，类名不保证）。
   * 判据用「overflow-y 是 auto/scroll」+「内容比视口高」，比写死类名稳。
   */
  function findScroller(el) {
    var p = el;
    while (p && p.nodeType === 1) {
      var ov = null;
      try {
        var win = p.ownerDocument && p.ownerDocument.defaultView;
        ov = win && win.getComputedStyle ? win.getComputedStyle(p).overflowY : null;
      } catch (e) { ov = null; }
      if ((ov === "auto" || ov === "scroll") && p.scrollHeight > p.clientHeight) return p;
      p = p.parentElement;
    }
    return null;
  }

  /**
   * R8 修「输入框一次只能打进一个字符」：
   * Obsidian 的 `TextComponent.onChange` 是**每次按键**都回调；旧实现一回调就走
   * applySettingsChange() → refreshSettingTab() → 整个设置页重画 → 输入框元素被换掉、焦点丢了
   * → 下一个按键落空。所以：**按键期间只记草稿，失焦 / 回车才落库**。
   * 返回一个可手动触发的 commit（测试用）。
   */
  function commitOnBlur(t, apply) {
    var latest = null;
    t.onChange(function (v) { latest = String(v == null ? "" : v); });
    var commit = function () {
      if (latest === null) return false;
      var v = latest; latest = null;
      return apply(v);
    };
    var el = t.inputEl;
    if (el && el.addEventListener) {
      el.addEventListener("blur", commit);
      el.addEventListener("keydown", function (ev) {
        if (ev && (ev.key === "Enter" || ev.keyCode === 13)) { commit(); if (el.blur) el.blur(); }
      });
    }
    commit.peek = function () { return latest; };
    return commit;
  }

  function detectLegacy(plugin) {
    var found = [];
    try {
      var enabled = plugin.app.plugins && plugin.app.plugins.enabledPlugins;
      if (enabled) for (var i = 0; i < LEGACY.length; i++) if (enabled.has(LEGACY[i].id)) found.push(LEGACY[i]);
    } catch (e) { /* 检测失败不阻塞 */ }
    return found;
  }

  /* R18：ⓘ 小圆钮 —— 悬停出提示（title + CSS tooltip）；点一下开本页帮助小窗。
   * 宿主由调用方给（效果图里它紧跟状态文字），不再固定往 Setting 的控件区塞。 */
  function infoDot(host, tip, onClick) {
    if (!host || !host.createEl) return null;
    var b = host.createEl("button", {
      cls: "kbt-info", attr: { type: "button", "aria-label": "操作提示", title: tip, "data-tip": tip }
    });
    b.textContent = "i";
    if (onClick) b.addEventListener("click", function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); onClick(); });
    return b;
  }

  class SettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
      super(app, plugin);
      this.plugin = plugin;
      /* 模板编辑草稿：同一次打开期间的改动要能扛住重画（拨别的开关不动它） */
      this._tplDraft = null;
      /* 测试可注入 { rect(el), scroller(el) } —— jsdom 里量不出真实矩形 */
      this._anchorApi = null;
      /* R16：当前标签页（rebuild / automation / base） */
      this._tab = "rebuild";
    }
    /**
     * R7（老板反馈④）：拨开关后整页重画，浏览器会把滚动位置甩到别处。
     * 做法 = 把锚点标题当基准：重画前记住它在屏幕上的 y，重画后把滚动容器
     * 补一个差值回去 —— 于是这一块前后的位置**一个像素都不动**。
     * 幂等：补完再量一次，差值已是 0 就什么都不做。
     */
    keepAnchor(fn) {
      var el = this.containerEl;
      var api = this._anchorApi;
      var q = function () { return (el && el.querySelector) ? el.querySelector("." + ANCHOR_CLS) : null; };
      var rect = (api && api.rect) ? api.rect : function (n) {
        return (n && typeof n.getBoundingClientRect === "function") ? n.getBoundingClientRect() : null;
      };
      var scroller = (api && api.scroller) ? api.scroller : findScroller;
      var a0 = q(), r0 = a0 ? rect(a0) : null;
      fn();
      var restore = function () {
        var a1 = q();
        if (!a1 || !r0) return 0;
        var r1 = rect(a1);
        if (!r1) return 0;
        var d = (r1.top - r0.top);
        if (!d) return 0;
        var sc = scroller(a1) || (a0 ? scroller(a0) : null);
        if (sc) sc.scrollTop = (sc.scrollTop || 0) + d;
        return d;
      };
      var moved = restore();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(function () { restore(); });
      return moved;
    }
    /** R8：就地刷新「路径」那一行的说明文案 —— 不重画整页，免得打断正在输入的框 */
    pathDesc(setting, field) {
      if (!setting || typeof setting.setDesc !== "function") return null;
      var P = this.plugin.settings.paths;
      /* R19 需求5：一句话说清「它是什么 + 当前值」 */
      var text = field === "knowledgeBase"
        ? "笔记存放的顶层目录名，当前：" + P.knowledgeBase
        : "元数据目录名（相对库根），当前：" + P.metaDir;
      setting.setDesc(text);
      return text;
    }
    /** R8：就地刷新「创作看板 · 排除目录」那一行的说明 */
    boardDesc(setting) {
      if (!setting || typeof setting.setDesc !== "function") return null;
      var v = String(this.plugin.settings.modules["base.boardExclude"] || "");
      /* R19 需求5：顺手去掉原来的 Markdown 反引号 —— setDesc 是纯文本，反引号会原样显示出来 */
      var text = v
        ? "排除：" + v
        : "留空 —— 看板展示整个笔记库";
      setting.setDesc(text);
      return text;
    }
    display() {
    var containerEl = this.containerEl;
    var plugin = this.plugin, S = plugin.settings, tab = this;
    containerEl.empty();

    /* ================= R18：页头（标题 + 右上角版本号） ================= */
    var head = containerEl.createEl("div", { cls: "kbt-head" });
    head.createEl("h3", { text: "知识库工具集" });
    head.createEl("span", { cls: VER_CLS,
      text: "v" + ((plugin.manifest && plugin.manifest.version) || "1.0.0") });

    /* 旧插件检测横幅。R10-⑤ 修正：旧代码 `plugin.legacyFound || 现查` —— onload 存下的
     * **空数组也是真值**，短路之后用户回头再开旧插件，横幅永远不出现。改成
     * legacyCheck 开着就每次现查（检测只是读 enabledPlugins，开销可忽略）。 */
    var legacy = S.legacyCheck ? detectLegacy(plugin) : (plugin.legacyFound || []);
    plugin.legacyFound = legacy;
    if (legacy.length) {
      var banner = containerEl.createEl("div", { cls: "kb-legacy-banner callout", attr: { "data-callout": "warning" } });
      banner.createEl("p", { text: "检测到旧插件仍在启用，为避免同一事件被处理两遍，建议停用：" });
      var ul = banner.createEl("ul");
      for (var i = 0; i < legacy.length; i++)
        ul.createEl("li", { text: legacy[i].id + " — " + legacy[i].why });
      /* R10-⑥（boss 第 6 条）：旧插件收编一键化 —— 功能已全部由本模块接管
       * （note-locator → 笔记（含属性候选值补丁）、creation-board/bases-preview → Base），
       * 停用即可，文件保留在插件目录里，随时可手动开回来。 */
      var absorbBtn = new obsidian.Setting(banner)
        .setName("一键停用并收编").setDesc("本插件已完整接管上面这些插件的功能；停用后此横幅消失")
        .addButton(function (b) {
          b.setButtonText("全部停用").setWarning();
          b.onClick(async function () {
            var pl = plugin.app && plugin.app.plugins, n = 0, errs = [];
            for (var k = 0; k < legacy.length; k++) {
              try {
                if (pl && typeof pl.disablePluginAndSave === "function") { await pl.disablePluginAndSave(legacy[k].id); n++; }
                else if (pl && typeof pl.disablePlugin === "function") { await pl.disablePlugin(legacy[k].id); n++; }
              } catch (e) { errs.push(legacy[k].id + "：" + String((e && e.message) || e)); }
            }
            plugin.legacyFound = plugin.legacyCheck ? detectLegacy(plugin) : [];
            new obsidian.Notice(errs.length
              ? "知识库工具集：停用 " + n + " 个成功，失败 —— " + errs.join("；")
              : "知识库工具集：已停用 " + n + " 个旧插件，功能由本插件接管。", 9000);
            tab.keepAnchor(function () { tab.display(); });
          });
        });
    }

    /* ================= R18：标签行（三个标签 + 右端 日志 / 关于） ================= */
    var groups = {}, renderFns = {}, sectionBoxes = {};
    var tabBar = containerEl.createEl("div", { cls: "kbt-tabs", attr: { role: "tablist" } });
    var tabBtns = {};
    function activateTab(key) {
      tab._tab = key;
      for (var k in tabBtns) {
        if (!tabBtns[k].classList) continue;
        if (k === key) tabBtns[k].classList.add("is-active");
        else tabBtns[k].classList.remove("is-active");
      }
      for (var g in groups) {
        if (!groups[g].classList) continue;
        /* 只切显示，不用 hidden 属性 —— hidden 留给搜索过滤（r13 B 段按属性断言） */
        if (g === key) groups[g].classList.remove("kbt-hidden");
        else groups[g].classList.add("kbt-hidden");
      }
    }
    tab._activateTab = activateTab;
    for (var ti = 0; ti < TABS.length; ti++) {
      (function (t) {
        var b = tabBar.createEl("button", {
          cls: "kbt-tab kbt-dot-" + t.dot, attr: { type: "button", role: "tab" }
        });
        b.createEl("span", { cls: "kbt-tab-dot" });
        b.createEl("span", { cls: "kbt-tab-label", text: t.label });
        b.addEventListener("click", function () { activateTab(t.key); });
        tabBtns[t.key] = b;
      })(TABS[ti]);
    }
    /* R18（效果图 .ghs）：日志 / 关于 靠右并排在标签行里，不再单独占页头一行 */
    var ghostBtns = tabBar.createEl("div", { cls: "kbt-ghost-btns" });
    var logBtn = ghostBtns.createEl("button", { cls: "kbt-ghost-btn", attr: { type: "button" }, text: "日志" });
    logBtn.addEventListener("click", async function () {
      var mod = plugin.registry && plugin.registry.active && plugin.registry.active.rebuild;
      if (mod && mod.openLog) await mod.openLog();
      else new obsidian.Notice("知识库工具集：还没有生成过操作日志。", 8000);
    });
    var aboutBtn = ghostBtns.createEl("button", { cls: "kbt-ghost-btn", attr: { type: "button" }, text: "关于" });
    aboutBtn.addEventListener("click", function () { tab._openPop("about"); });
    /* R20 需求2：帮助入口就放这儿（点开的是**当前标签页**的帮助小窗） */
    var helpBtn = ghostBtns.createEl("button", { cls: "kbt-ghost-btn", attr: { type: "button" }, text: "帮助" });
    helpBtn.addEventListener("click", function () {
      tab._openPop((tab._tab || "rebuild") + ":help");
    });

    /* ================= R18：搜索框（整行输入框，无标题行） ================= */
    var searchInput = containerEl.createEl("input", { cls: "kbt-search-input",
      attr: { type: "search", spellcheck: "false",
        placeholder: "搜索设置：试试 模板 / 回滚 / 排除 / 卡片宽度" } });
    var emptyHint = containerEl.createEl("div", { cls: "kbt-search-empty", attr: { hidden: "" } });
    var searchWrap = containerEl.createEl("div", { cls: "kbt-search" });
    searchWrap.appendChild(searchInput);
    containerEl.insertBefore(searchWrap, emptyHint);
    /* R18：命中他页时给可点链接（效果图 .hint a），**不再自动跳页** —— 自动跳会打断手上这一屏 */
    var otherNames = {};
    for (var on = 0; on < TABS.length; on++) otherNames[TABS[on].key] = TABS[on].label;
    function hintOthers(counts) {
      emptyHint.empty();
      var others = [];
      for (var k = 0; k < TABS.length; k++) {
        var kk = TABS[k].key;
        if (kk !== tab._tab && counts[kk] > 0) others.push(kk);
      }
      emptyHint.createEl("span", { text: "当前页无命中，其他页：" });
      for (var j = 0; j < others.length; j++) {
        (function (key) {
          var a = emptyHint.createEl("button", { cls: "kbt-hint-link", attr: { type: "button" },
            text: "「" + otherNames[key] + "」" + counts[key] + " 处" });
          a.addEventListener("click", function () { activateTab(key); searchInput.focus && searchInput.focus(); });
        })(others[j]);
      }
    }
    tab._applyFilter = function (raw) {
      var q = String(raw == null ? "" : raw).trim().toLowerCase();
      var items = containerEl.querySelectorAll(".setting-item");
      var counts = {}, i, it, k;
      for (i = 0; i < TABS.length; i++) counts[TABS[i].key] = 0;
      if (!q) {
        for (i = 0; i < items.length; i++) items[i].hidden = false;
        var det0 = containerEl.querySelectorAll("details.kbt-adv");
        for (i = 0; i < det0.length; i++) { det0[i].hidden = false; det0[i].open = false; }  /* 复位：高级组回到默认折叠 */
        var gs0 = containerEl.querySelectorAll(".kbt-group");
        for (i = 0; i < gs0.length; i++) gs0[i].hidden = false;
        var sec0 = containerEl.querySelectorAll(".kbt-sec");
        for (i = 0; i < sec0.length; i++) sec0[i].hidden = false;
        emptyHint.hidden = true;
        return 0;
      }
      for (i = 0; i < items.length; i++) {
        it = items[i];
        if (it.classList.contains("kbt-search")) { it.hidden = false; continue; }
        var hit = String(it.textContent || "").toLowerCase().indexOf(q) >= 0;
        it.hidden = !hit;
        if (hit) {
          var g = it.closest ? it.closest(".kbt-group") : null;
          for (var gk in groups) if (groups[gk] === g) counts[gk]++;
        }
      }
      var det = containerEl.querySelectorAll("details.kbt-adv");
      for (i = 0; i < det.length; i++) {
        var has = det[i].querySelector(".setting-item:not([hidden])");
        det[i].hidden = !has;
        det[i].open = !!has;     /* 命中高级组里的项 → 自动展开 */
      }
      var sec = containerEl.querySelectorAll(".kbt-sec");
      for (i = 0; i < sec.length; i++)
        sec[i].hidden = !sec[i].querySelector(".setting-item:not([hidden])");
      var gs = containerEl.querySelectorAll(".kbt-group");
      for (i = 0; i < gs.length; i++) gs[i].hidden = !gs[i].querySelector(".setting-item:not([hidden])");
      var n = counts[tab._tab] || 0;
      if (n > 0) emptyHint.hidden = true;
      else {
        hintOthers(counts);
        if (!emptyHint.textContent || emptyHint.querySelectorAll(".kbt-hint-link").length === 0)
          emptyHint.textContent = "没有找到相关设置。试试这些词：模板 / 回滚 / 排除 / 卡片宽度。";
        emptyHint.hidden = false;
      }
      return n;
    };
    searchInput.addEventListener("input", function () { tab._applyFilter(searchInput.value); });

    /* ================= R16：悬浮小窗（帮助 / 关于，点开可上下滑动） ================= */
    var pops = {};
    tab._pops = pops;
    function closePop(key) {
      var p = pops[key];
      if (p && p.setAttribute) p.setAttribute("hidden", "");
    }
    function openPop(key) {
      for (var k in pops) if (k !== key) closePop(k);
      var p = pops[key];
      if (!p) return null;
      p.removeAttribute("hidden");
      var body = p.querySelector ? p.querySelector(".kbt-pop-body") : null;
      if (body && body.scrollTop !== undefined) body.scrollTop = 0;
      return p;
    }
    tab._openPop = openPop;
    tab._closePop = closePop;
    /* R18：条目 = { k: 键, v: 说明 } —— 小窗里一行一条（效果图 .hrow：键粗、说明灰） */
    function fillPop(body, items) {
      if (!body) return body;
      body.empty();
      var list = items || [];
      for (var i = 0; i < list.length; i++) {
        if (i) body.createEl("div", { cls: "kbt-help-sep" });
        var it = body.createEl("div", { cls: "kbt-help-item kbt-hrow" });
        it.createEl("span", { cls: "kbt-help-title kbt-hk", text: list[i].k });
        it.createEl("span", { cls: "kbt-help-text kbt-hv setting-item-description", text: list[i].v });
      }
      return body;
    }
    function buildPop(host, key, title, items) {
      var wrap = host.createEl("div", { cls: "kbt-pop", attr: { hidden: "" } });
      var mask = wrap.createEl("div", { cls: "kbt-pop-mask" });
      var win = wrap.createEl("div", { cls: "kbt-pop-win" });
      var ph = win.createEl("div", { cls: "kbt-pop-head" });
      var phText = ph.createEl("span", { cls: "kbt-pop-title", text: title });
      var x = ph.createEl("button", { cls: "kbt-pop-x", attr: { type: "button", "aria-label": "关闭" } });
      x.textContent = "×";
      var body = win.createEl("div", { cls: "kbt-pop-body" });
      fillPop(body, items);
      x.addEventListener("click", function () { closePop(key); });
      mask.addEventListener("click", function () { closePop(key); });
      /* R19：状态小窗的内容是**异步算出来的**（要读文件系统才知道「未创建/半成品」），
       * 所以这里留一个「就地换内容」的口子，调用方算完直接填。 */
      wrap._kbFill = function (list) { fillPop(body, list); };
      wrap._kbTitle = function (t) { if (phText) phText.textContent = t; };
      wrap._kbBody = body;
      pops[key] = wrap;
      return wrap;
    }

    /* ================= 分组骨架（每组 = 模块头 + 短横 + 段落） ================= */
    function makeGroup(key) {
      var g = containerEl.createEl("div", { cls: "kbt-group" });
      groups[key] = g;
      return g;
    }
    function makeSection(key) {
      var box = groups[key].createEl("div", { cls: "kb-module-section" });
      sectionBoxes[key] = box;
      return box;
    }
    /* R11（boss 第 2 条：拨开关还是跳 → 不做自动收起）：段落**永远整段渲染**，
     * 模块关了就整段置灰禁用（.kb-module-disabled，CSS：透明度 + pointer-events:none），
     * 例外：辅助栏与帮助栏用 CSS 保住可点（见 kbt.css 的 .is-aux / .kbt-help-row）。
     * 开与关布局零变化 → 拨开关一个像素都不跳。硬门控不变：命令照旧不注册、按钮点不动。 */
    function paintSection(key) {
      var box = sectionBoxes[key];
      if (!box || !renderFns[key]) return;
      try { box.empty(); renderFns[key](box); } catch (e) { console.warn("[kb-toolkit] 重画模块段落失败", key, e); }
      try {
        if (S.modules[key] !== true) box.classList.add("kb-module-disabled");
        else box.classList.remove("kb-module-disabled");
      } catch (e2) { /* 样式失败不影响功能 */ }
      /* 标签上的小圆点：模块开 = 马卡龙色，关 = 灰（class 在标签按钮上，样式里映射颜色） */
      try {
        if (tabBtns[key] && tabBtns[key].classList) {
          if (S.modules[key] === true) tabBtns[key].classList.remove("is-off");
          else tabBtns[key].classList.add("is-off");
        }
      } catch (e3) { /* 同上 */ }
    }
    var applyModule = function (key, v) {
      S.modules[key] = v;
      var done = function () { paintSection(key); };
      var apply = KB.modules.applySettingsChange;
      var p = apply ? apply(plugin) : (plugin.registry && plugin.registry.refresh
        ? plugin.registry.refresh() : KB.services.settings.saveSettings(plugin));
      Promise.resolve(p).then(done, done);
    };
    /* R18（效果图 .mrow）：模块头 = 标题 + 滑动开关，一行；下面一条左边短横。 */
    function moduleHead(key, name) {
      var head2 = new obsidian.Setting(groups[key]);
      head2.setHeading().setName(name);
      var hEl = head2.settingEl || head2.el;
      if (hEl && hEl.classList) hEl.classList.add("kbt-switch");
      if (key === "rebuild") {
        if (hEl && hEl.classList) hEl.classList.add(ANCHOR_CLS);
      }
      head2.addToggle(function (t) { t.setValue(S.modules[key] === true)
        .onChange(function (v) { applyModule(key, v); }); });
      groups[key].createEl("div", { cls: "kbt-rule" });      /* 短横：只占左边一小条 */
    }
    /* R20 需求1（老板截图1）：「当前状态的小字部分通通去掉，只留下是否启用的信息」。
     * 所以 **不再有副行小字** —— 主行只报「已启用 / 未启用」（前面一颗状态圆点），
     * 其余一切细节仍旧全部进 statusPop（调用方用 setItems 塞；整栏可点、ⓘ 也开同一个窗）。
     * 注意：openStatus 是函数声明（会提升），可以先用后定义。 */
    function statusLine(box, tip) {
      var key = box._kbKey || tab._tab || "";
      var popKey = key + ":status";
      var wrap = buildPop(box, popKey, "当前状态 · " + (TAB_LABEL[key] || ""), []);
      var sec = box.createEl("div", { cls: "kbt-sec kbt-status-card" });
      sec.createEl("div", { cls: "kbt-lb", text: "当前状态" });
      var card = sec.createEl("div", { cls: "kbt-card" });
      var el = card.createEl("div", { cls: "kbt-status callout", attr: { "data-callout": "info" } });
      var top = el.createEl("div", { cls: "kbt-status-top" });
      var led = top.createEl("span", { cls: "kbt-led" });
      var m = top.createEl("div", { cls: "kbt-status-main" });
      var on = S.modules[key] === true;
      m.textContent = on ? "已启用" : "未启用";
      if (on && led.classList) led.classList.add("is-on");
      infoDot(top, tip || "提示", openStatus);
      top.createEl("span", { cls: "kbt-status-more", text: "详情 ›" });
      var st = {
        el: el, main: m, led: led, sec: sec, card: card, open: openStatus, items: [],
        setItems: function (list) {
          st.items = list || [];
          if (wrap && wrap._kbFill) wrap._kbFill(st.items);
          return st;
        }
      };
      function openStatus() { return tab._openPop(popKey); }
      /* 整栏可点（ⓘ 自己会开，别重复触发） */
      sec.addEventListener("click", function (ev) {
        var t = ev && ev.target;
        if (t && t.closest && t.closest(".kbt-info")) return;
        openStatus();
      });
      return st;
    }
    /* R18（效果图 .sec > .lb + .card）：栏目 = 卡片外一个小标签 + 卡片本体 */
    function makeSec(box, label) {
      var sec = box.createEl("div", { cls: "kbt-sec" });
      sec.createEl("div", { cls: "kbt-lb", text: label });
      var card = sec.createEl("div", { cls: "kbt-card" });
      sec._kbCard = card;
      return card;
    }
    /* 「高级」折叠组：summary 只有「高级」两字，箭头交给 CSS；内容同样进卡片 */
    function makeAdv(box) {
      var d = box.createEl("details", { cls: "kbt-adv" });
      d.createEl("summary", { text: "高级" });
      return d.createEl("div", { cls: "kbt-card" });
    }
    /* R20 需求2（老板截图2）：每页底部那栏「帮助」整栏撤掉 —— 入口挪到顶部标签行
     * 「日志 / 关于」右边的「帮助」按钮。这里只把**悬浮小窗**建出来（挂 containerEl、
     * 默认隐藏），内容仍取 HELP[key]；键 = key + ":help"，按钮按**当前**标签页拼同一个键，
     * 所以一份内容一个窗、不会串页。 */
    function helpPop(key) {
      return buildPop(containerEl, key + ":help", "帮助 · " + (TAB_LABEL[key] || ""), HELP[key] || []);
    }
    var TAB_LABEL = {};
    for (var li = 0; li < TABS.length; li++) TAB_LABEL[TABS[li].key] = TABS[li].label;

    /* ================= ① 知识库 ================= */
    makeGroup("rebuild");
    moduleHead("rebuild", "新建知识库");

    var rebuildModule = function () {
      var mod = plugin.registry && plugin.registry.active.rebuild;
      if (!mod) new obsidian.Notice("新建知识库：请先在上方打开「新建知识库」开关。", 8000);
      return mod;
    };
    renderFns.rebuild = function (containerEl) {   /* 参数名遮蔽外层 containerEl —— 段内代码零改动 */
    containerEl._kbKey = "rebuild";
    if (S.modules.rebuild !== true) {
      /* R11：不再收起 —— 只加一行说明，下面照常渲染（整段由 kb-module-disabled 置灰禁用）。
       * 命令面板那几条命令的硬门控不受影响（照旧不注册）。 */
      containerEl.createEl("p", { cls: "setting-item-description",
        text: "模块已关闭 —— 下面这些只是摆出来占位（点不动）；打开上方开关即可启用。" });
    }

    /* R20：状态栏只留「是否启用」（见 statusLine）；重建进度等细节全进悬浮窗。 */
    var st0 = statusLine(containerEl,
      MOD_TIP.rebuild + "　下一步：先「生成预览报告」看看会搬哪些；或用「打开向导」初始化。");
    (async function () {
      try {
        var svc = new KB.services.rebuild(plugin.app);
        var st = await svc.detectState(plugin.settings.rebuild);
        var tail = st.rootWillMove
          ? "旧库「" + st.root + "」将连同顶层其它项一起归档进「" + S.rebuild.oldFolderName + "」，再新建一个同名的空库"
          : (st.keepRoot
            ? "旧文件区已有内容 → 再次执行：已有知识库原地保留，新库与它并列（下一个编号名），" +
              "旧文件区下分建「" + S.rebuild.archivePriorName + "-<时间戳>」（装原有内容）与「" +
              S.rebuild.archiveIncomingName + "-<时间戳>」（装本次移入）"
            : "顶层待搬 " + st.movableCount + " 项" + (st.oldFolderExists ? "（旧文件区已存在 → 并入模式）" : ""));
        var main = st.state === "fresh"
          ? (st.oldFolderExists ? "还没建出库根" : "未创建")
          : (st.state === "done" ? "已是已完成态" : "半成品（顶层仍有待搬项）");
        st0.setItems([
          { k: "状态", v: main },
          { k: "新建根", v: st.root },
          { k: "旧文件区", v: st.oldFolderExists ? "已存在 —— 本次走「并入模式」" : "还没有，本次会新建" },
          { k: "顶层待搬", v: st.movableCount + " 项" },
          { k: "这次执行会发生什么", v: tail },
          { k: "下一步", v: "先点「生成预览报告」看看会搬哪些，或用「辅助」里的向导初始化" }
        ]);
      } catch (e) {
        st0.setItems([
          { k: "状态", v: "读取失败（不影响下方操作）" },
          { k: "可能原因", v: "库根还没建、或元数据目录被改名。可在「高级」里核对两个路径" }
        ]);
      }
    })();

    /* R19 需求4：三个按钮去掉彩色底（setCta 紫 / setWarning 红），统一素色 —— 样式见 kbt.css。 */
    var coreCard = makeSec(containerEl, "核心操作");
    coreCard.classList.add("kbt-core-actions");
    new obsidian.Setting(coreCard)
      .setName("预览报告")
      .addButton(function (b) { b.setButtonText("生成预览报告")
        .onClick(async function () { var mod = rebuildModule(); if (mod) await mod.runPreview(); }); });
    new obsidian.Setting(coreCard)
      .setName("执行")
      .addButton(function (b) { b.setButtonText("执行")
        .onClick(async function () { var mod = rebuildModule(); if (mod) await mod.startConfirm("execute"); }); });
    new obsidian.Setting(coreCard)
      .setName("回滚")
      .addButton(function (b) { b.setButtonText("回滚")
        .onClick(async function () { var mod = rebuildModule(); if (mod) await mod.startConfirm("rollback"); }); });

    /* R18（效果图 辅助）：向导 + 操作日志合成一栏；模块关着也能点（.is-aux 保住指针事件）
     * R19 需求5：说明文字统一精简成一句话。 */
    var auxCard = makeSec(containerEl, "辅助");
    auxCard.classList.add("is-aux");
    new obsidian.Setting(auxCard)
      .setName("首次使用向导").setDesc("重走初始化，不动笔记文件")
      .addButton(function (b) { b.setButtonText("打开向导")
        .onClick(function () { if (KB.modules.openWizard) KB.modules.openWizard(plugin); }); });
    new obsidian.Setting(auxCard)
      .setName("操作日志").setDesc("每次预览 / 执行 / 回滚都留一篇报告")
      .addButton(function (b) { b.setButtonText("打开最近一篇")
        .onClick(async function () { var mod = rebuildModule(); if (mod) await mod.openLog(); }); });

    /* R13：路径收进「高级」（低频；本插件唯一的顶层路径出口，铁律 9 不变） */
    var applyPaths = function (field, value, setting) {
      var prev = { knowledgeBase: S.paths.knowledgeBase, metaDir: S.paths.metaDir,
                   legacyDirs: (S.paths.legacyDirs || []).slice() };
      var v = String(value || "").trim();
      if (!v || v === S.paths[field]) { if (setting) tab.pathDesc(setting, field); return false; }
      S.paths[field] = v;
      KB.services.settings.reapplyPaths(S, prev);
      KB.services["router.util"].applySettings(S);
      /* R8：这里**不重画整页**（重画会把正在输入的框换掉）。改完只就地更新这一行的说明文案；
       * 模块那边照样当场重配（reapply），所以行为立刻生效。 */
      var apply = KB.modules.applySettingsChange;
      var p = apply ? apply(plugin, { repaint: false }) : KB.services.settings.saveSettings(plugin);
      Promise.resolve(p).then(function () { if (setting) tab.pathDesc(setting, field); },
        function () { if (setting) tab.pathDesc(setting, field); });
      return true;
    };
    var adv1 = makeAdv(containerEl);
    var kbSetting = new obsidian.Setting(adv1)
      .setName("知识库根目录").setDesc("")
      .addText(function (t) {
        t.setPlaceholder(S.paths.knowledgeBase).setValue(S.paths.knowledgeBase);
        commitOnBlur(t, function (v) { return applyPaths("knowledgeBase", v, kbSetting); });
      });
    var metaSetting = new obsidian.Setting(adv1)
      .setName("元数据目录名").setDesc("")
      .addText(function (t) {
        t.setPlaceholder(S.paths.metaDir).setValue(S.paths.metaDir);
        commitOnBlur(t, function (v) { return applyPaths("metaDir", v, metaSetting); });
      });
    tab.pathDesc(kbSetting, "knowledgeBase");
    tab.pathDesc(metaSetting, "metaDir");

    /* R18：帮助（一栏 + 悬浮小窗） */
    helpPop("rebuild");
    };
    makeSection("rebuild"); paintSection("rebuild");

    /* ================= ② 笔记 ================= */
    makeGroup("automation");
    moduleHead("automation", "笔记自动化");
    renderFns.automation = function (containerEl) {
    containerEl._kbKey = "automation";
    if (S.modules.automation !== true) {
      /* R11：同 ① —— 不收起，占位置灰 */
      containerEl.createEl("p", { cls: "setting-item-description",
        text: "模块已关闭 —— 下面这些只是摆出来占位（点不动）；打开上方开关即可启用。" });
    }
    var routes = (S.automation.routes || []).length;
    var tplSvc0 = KB.services.templates;
    var tplCnt = 0;
    try { tplCnt = tplSvc0.listAll(S, tplSvc0.scan(plugin.app, S)).length; } catch (e) { tplCnt = 0; }
    var propKey = S.automation.property || "文件位置";
    var propOpts = (S.automation.propertyOptions || {})[propKey] || [];
    var stA = statusLine(containerEl,
      MOD_TIP.automation + "　新建补全 " + (S.automation.createFill !== false ? "开" : "关") +
      "，移动同步 " + (S.automation.fixCenterLink !== false ? "开" : "关") + "。");
    stA.setItems([
      { k: "模块开关", v: S.modules.automation === true ? "打开着" : "关着" },
      { k: "标签-目录映射", v: routes + " 条路由 —— 决定新笔记按标签落到哪个目录" },
      { k: "创建补全模板", v: tplCnt + " 套可选；新建笔记时按目录挑一套（模板库里的 .md）" },
      { k: "创建时自动补全", v: S.automation.createFill !== false ? "开 —— 空白新笔记自动补 YAML 头与尾部双链" : "关" },
      { k: "移动后同步", v: S.automation.fixCenterLink !== false ? "开 —— 落位后自动同步 YAML 与尾部双链" : "关" },
      { k: "属性候选值下拉", v: "「" + propKey + "」可选 " + propOpts.length + " 个落点。Obsidian 原生只收库里已用过的值，" +
          "空目录（如「01_执行中」）永远不出现在下拉里 —— 这里把候选值补齐" },
      { k: "被 Templater 接管的目录", v: "那些目录的新笔记由 Templater 模板落盘，本插件只补「" + propKey + "」这一个键" }
    ]);

    /* 栏目一：自动补全（两个开关）—— R19 需求5：说明精简 */
    var fillCard = makeSec(containerEl, "自动补全");
    new obsidian.Setting(fillCard)
      .setName("创建时自动补全")
      .setDesc("只对空白新笔记生效")
      .addToggle(function (t) { t.setValue(S.automation.createFill !== false)
        .onChange(function (v) { S.automation.createFill = v; KB.services.settings.saveSettings(plugin); }); });
    new obsidian.Setting(fillCard)
      .setName("移动后同步")
      .setDesc("落位后自动同步 YAML 与双链")
      .addToggle(function (t) { t.setValue(S.automation.fixCenterLink !== false)
        .onChange(function (v) { S.automation.fixCenterLink = v; KB.services.settings.saveSettings(plugin); }); });

    /* 栏目二：批量操作（一键补全 + 路由表 —— 效果图把路由表放在这一栏） */
    var batchCard = makeSec(containerEl, "批量操作");
    var afEl = batchCard.createEl("p", { cls: "setting-item-description" });
    var afHint = function (extra) {
      afEl.textContent = extra || "扫描整个知识库；补法只加不删。";
    };
    afHint("");
    new obsidian.Setting(batchCard)
      .setName("一键补全")
      .setDesc("扫描全库补齐缺失项；先出报告再写盘")
      .addButton(function (b) { b.setButtonText("开始扫描")
        .onClick(async function () {
          var mod = plugin.registry && plugin.registry.active && plugin.registry.active.automation;
          if (!mod) { new obsidian.Notice("知识库工具集：请先打开「笔记自动化」。", 8000); return; }
          var r = await mod.startAutofill();
          if (!r) return;
          if (r.todo === 0) afHint("上次扫描：" + r.scanned + " 篇，没有需要补全的笔记。");
          else afHint("上次扫描：" + r.scanned + " 篇里有 " + r.todo + " 篇待补（已在弹窗里确认）。");
        }); });
    var routesSetting = new obsidian.Setting(batchCard)
      .setName("标签-目录映射表").setDesc("共 " + routes + " 条路由")
      .addButton(function (b) { b.setButtonText("查看 / 编辑")
        .onClick(function () {
          if (KB.modules.RoutesModal) new KB.modules.RoutesModal(plugin.app, plugin).open();
          else new obsidian.Notice("知识库工具集：这条路由共 " + (S.automation.routes || []).length + " 条。", 8000);
        }); });

    /* ---- R13：模板 / 套用规则收进「高级」（配置好之后很少再动） ---- */
    var adv2 = makeAdv(containerEl);

    /* ---- R8：创建补全模板（模板 = 模板库里的 .md 文件） ---- */
    var tplSvc = KB.services.templates;
    var sc = tplSvc.scan(plugin.app, S);
    var all = tplSvc.listAll(S, sc);
    var configuredId = (S.automation.templates && S.automation.templates.activeId) || tplSvc.DEFAULT_ID;
    var inList = false, ai0;
    for (ai0 = 0; ai0 < all.length; ai0++) if (all[ai0].id === configuredId) inList = true;
    var activeId = inList ? configuredId : (all.length ? all[0].id : tplSvc.DEFAULT_ID);
    if (!inList) tplSvc.setActive(S, activeId);          /* 只改内存：下拉里没有的 id 说明它没了 */
    var activeName = function () {
      for (var i = 0; i < all.length; i++) if (all[i].id === activeId) return all[i].name;
      return tplSvc.isFileId(activeId)
        ? tplSvc.nameOfPath(String(activeId).slice(tplSvc.FILE_PREFIX.length)) : "未命名模板";
    };

    adv2.createEl("p", { cls: "setting-item-description",
      text: "占位符：" + tplSvc.PLACEHOLDERS.map(function (p) { return p.key + " " + p.desc; }).join(" ｜ ") });
    adv2.createEl("p", { cls: "setting-item-description",
      text: "模板就是模板库里的 .md 文件：" + tplSvc.dirFor(S) +
        " —— 在这里改、在 Obsidian 里直接改，都是同一份。" +
        (sc.items.length ? "（现有 " + sc.items.length + " 套）" : "（目录还是空的，保存时会自动建）") });

    new obsidian.Setting(adv2)
      .setName("当前模板").setDesc("换模板 = 之后新建的空白笔记按这一套补全；已存在的笔记不动")
      .addDropdown(function (d) {
        for (var i = 0; i < all.length; i++) {
          var tag = all[i].source === "file" ? "" :
            (all[i].source === "settings" ? "（存在配置里）" : (all[i].overridden ? "（已改过）" : "（内置 · 未落盘）"));
          d.addOption(all[i].id, all[i].name + tag);
        }
        d.setValue(activeId);
        d.onChange(function (v) {
          tplSvc.setActive(S, v);
          tab._tplDraft = null;
          KB.services.settings.saveSettings(plugin).then(function () { tab.keepAnchor(function () { tab.display(); }); },
            function () { tab.keepAnchor(function () { tab.display(); }); });
        });
      });

    var taEl = null;
    new obsidian.Setting(adv2)
      .setName("模板正文").setDesc("只有 {{占位符}} 会被替换，其余原样落进新笔记；改完点「保存模板」写回模板库")
      .addTextArea(function (a) {
        taEl = a;
        var draft = (tab._tplDraft && tab._tplDraft.id === activeId) ? tab._tplDraft.text : null;
        if (draft === null && tplSvc.isFileId(activeId) && tplSvc.scan(plugin.app, S).items.length) {
          a.setValue("（正在读取模板库…）");
        } else {
          a.setValue(draft !== null ? draft : tab.draftTemplate(activeId));
        }
        a.onChange(function (v) { tab._tplDraft = { id: activeId, text: String(v == null ? "" : v) }; });
      });
    /* 文件模板要异步读正文 —— 读完回填；期间用户已经动过编辑框就不覆盖 */
    if (tplSvc.isFileId(activeId) && !(tab._tplDraft && tab._tplDraft.id === activeId)) {
      (async function () {
        var txt = await tplSvc.readFileText(plugin.app, S, activeId);
        if (typeof txt === "string" && taEl && !(tab._tplDraft && tab._tplDraft.id === activeId))
          taEl.setValue(txt);
      })();
    }

    var tplButtons = new obsidian.Setting(adv2)
      .setName("模板操作").setDesc("保存 / 另存为 / 从已有笔记提取");
    tplButtons.addButton(function (b) { b.setButtonText("保存模板")
      .onClick(async function () {
        var text = tab.draftTemplate(activeId);
        var r = await tplSvc.writeFile(plugin.app, S, activeName(), text);
        if (!r.ok) { new obsidian.Notice("知识库工具集：模板保存失败 —— " + r.reason, 9000); return; }
        tplSvc.setActive(S, tplSvc.idForName(r.name));
        tab._tplDraft = null;
        await KB.services.settings.saveSettings(plugin);
        new obsidian.Notice("知识库工具集：模板已保存到 " + r.path, 9000);
        tab.keepAnchor(function () { tab.display(); });
      }); });
    tplButtons.addButton(function (b) { b.setButtonText("另存为新模板")
      .onClick(function () {
        if (!KB.modules.NameModal) return;
        var text = tab.draftTemplate(activeId);
        var m = new KB.modules.NameModal(plugin.app, { title: "另存为新模板", label: "模板名",
          value: activeName() + " 副本", desc: "会存成模板库里的一个新 .md，原有模板不受影响。" });
        m.onSubmit = async function (name) {
          var r = await tplSvc.writeFile(plugin.app, S, name, text);
          if (!r.ok) { new obsidian.Notice("知识库工具集：新建模板失败 —— " + r.reason, 9000); return; }
          tplSvc.setActive(S, tplSvc.idForName(r.name));
          tab._tplDraft = null;
          await KB.services.settings.saveSettings(plugin);
          new obsidian.Notice("知识库工具集：已新建模板「" + r.name + "」并切到它。", 9000);
          tab.keepAnchor(function () { tab.display(); });
        };
        m.open();
      }); });
    tplButtons.addButton(function (b) { b.setButtonText("从笔记提取…")
      .onClick(function () {
        if (!KB.modules.ExtractModal) return;
        var m = new KB.modules.ExtractModal(plugin.app, plugin);
        m.onSubmit = async function (res) {
          var r = await tplSvc.writeFile(plugin.app, S, res.name, res.text);
          if (!r.ok) { new obsidian.Notice("知识库工具集：提取模板失败 —— " + r.reason, 9000); return; }
          tplSvc.setActive(S, tplSvc.idForName(r.name));
          tab._tplDraft = null;
          await KB.services.settings.saveSettings(plugin);
          new obsidian.Notice("知识库工具集：已从笔记提取模板「" + r.name + "」并切到它。", 9000);
          tab.keepAnchor(function () { tab.display(); });
        };
        m.open();
      }); });
    tplButtons.addButton(function (b) { b.setButtonText("内置模板写入模板库")
      .onClick(async function () {
        var r = await tplSvc.seedBuiltins(plugin.app, S, { force: true });
        await KB.services.settings.saveSettings(plugin);
        new obsidian.Notice(r.ok
          ? "知识库工具集：已把 " + r.created.length + " 套内置模板写成文件（" + tplSvc.dirFor(S) + "）。"
          : "知识库工具集：部分内置模板写入失败 —— " + (r.failed || []).join("；"), 10000);
        tab.keepAnchor(function () { tab.display(); });
      }); });
    if (tplSvc.isFileId(activeId)) {
      tplButtons.addButton(function (b) { b.setButtonText("删除此模板")
        .onClick(async function () {
          var r = await tplSvc.removeFile(plugin.app, S, activeId);
          if (!r.ok) { new obsidian.Notice("知识库工具集：删除失败 —— " + r.reason, 9000); return; }
          tplSvc.setActive(S, tplSvc.DEFAULT_ID);
          tab._tplDraft = null;
          await KB.services.settings.saveSettings(plugin);
          new obsidian.Notice("知识库工具集：模板文件已移入回收站（" + r.path + "）。", 9000);
          tab.keepAnchor(function () { tab.display(); });
        }); });
    } else if (tplSvc.isCustom(S, activeId) || (tplSvc.get(S, activeId) || {}).overridden) {
      tplButtons.addButton(function (b) { b.setButtonText("恢复内置")
        .onClick(async function () {
          tplSvc.remove(S, activeId);
          tab._tplDraft = null;
          await KB.services.settings.saveSettings(plugin);
          new obsidian.Notice("知识库工具集：已恢复内置模板。", 9000);
          tab.keepAnchor(function () { tab.display(); });
        }); });
    }

    /* ---- R8：套用规则 —— 哪个文件夹 / 标签下的新笔记用哪套模板 ---- */
    adv2.createEl("h5", { text: "套用规则（文件夹 / 标签 → 模板）" });
    adv2.createEl("p", { cls: "setting-item-description",
      text: "命中优先级：标签规则 → 文件夹规则（最长前缀优先） → 上面「当前模板」兜底。" +
        "只对新建的空白笔记生效，已有笔记不动。" });
    var tplNameOf = function (id) {
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].name;
      return id;
    };
    var rules = tplSvc.rulesList(S);
    if (!rules.length) {
      adv2.createEl("p", { cls: "setting-item-description", text: "还没有规则 —— 所有新建笔记都用「当前模板」。" });
    }
    for (var ri = 0; ri < rules.length; ri++) {
      (function (r) {
        new obsidian.Setting(adv2)
          .setName((r.kind === "folder" ? "📁 目录 " : "🏷 标签 ") + (r.value || "?"))
          .setDesc("→ 套用「" + tplNameOf(r.templateId) + "」")
          .addButton(function (b) { b.setButtonText("删除")
            .onClick(async function () {
              var arr = tplSvc.rulesList(S), k = -1;
              for (var i = 0; i < arr.length; i++) if (arr[i].id === r.id) k = i;
              if (k >= 0) arr.splice(k, 1);
              await KB.services.settings.saveSettings(plugin);
              tab.keepAnchor(function () { tab.display(); });
            }); });
      })(rules[ri]);
    }
    var newKind = "folder", newValue = "", addInput = null;
    var addRule = async function () {
      var v = String((addInput && addInput.getValue) ? addInput.getValue() : newValue || "").trim();
      if (!v) { new obsidian.Notice("知识库工具集：先填一个目录或标签。", 7000); return false; }
      var arr = tplSvc.rulesList(S);
      arr.push({ id: tplSvc.nextRuleId(S), kind: newKind, value: v, templateId: activeId });
      await KB.services.settings.saveSettings(plugin);
      new obsidian.Notice("知识库工具集：已新增规则 —— " + (newKind === "folder" ? "目录 " : "标签 ") +
        v + " → 「" + activeName() + "」。", 9000);
      tab.keepAnchor(function () { tab.display(); });
      return true;
    };
    tab.addRule = addRule;
    var addSetting = new obsidian.Setting(adv2)
      .setName("新增规则").setDesc("「值」填目录路径（库根起，含子目录也行）或标签名（# 可省略）；模板 = 上面选中的那套");
    addSetting.addDropdown(function (d) {
      d.addOption("folder", "文件夹"); d.addOption("tag", "标签");
      d.setValue("folder");
      d.onChange(function (v) { newKind = v; });
    });
    addSetting.addText(function (t) {
      addInput = t;
      t.setPlaceholder("如 " + S.paths.knowledgeBase + "/00_Inbox 或 灵感杂记");
      commitOnBlur(t, function (v) { newValue = String(v || ""); return true; });
    });
    addSetting.addButton(function (b) { b.setButtonText("添加").onClick(function () { addRule(); }); });

    /* R18：帮助（一栏 + 悬浮小窗） */
    helpPop("automation");
    };
    makeSection("automation"); paintSection("automation");

    /* ================= ③ Base ================= */
    makeGroup("base");
    moduleHead("base", "更多的 Base");
    renderFns.base = function (containerEl) {
    containerEl._kbKey = "base";
    if (S.modules.base !== true) {
      /* R11：同 ① —— 不收起，占位置灰 */
      containerEl.createEl("p", { cls: "setting-item-description",
        text: "模块已关闭 —— 下面这些只是摆出来占位（点不动）；打开上方开关即可启用。" });
    }
    var stB = statusLine(containerEl, MOD_TIP.base);
    var boardEx0 = String(S.modules["base.boardExclude"] || "");
    stB.setItems([
      { k: "模块开关", v: S.modules.base === true ? "打开着" : "关着" },
      { k: "创作看板", v: S.modules["base.creationBoard"] !== false ? "开 —— 按板块排布，卡片可拖动搬文件" : "关" },
      { k: "内容流视图", v: S.modules["base.noteStream"] !== false ? "开 —— 时间线预览正文，长库也不卡" : "关" },
      { k: "看板范围", v: boardEx0 ? "排除：" + boardEx0 : "整个笔记库（没排除任何目录）" },
      { k: "这两个视图", v: "只读 —— 不改动任何笔记文件" },
      { k: "配置存在哪", v: "存在 .base 文件的视图块里，跟着笔记走；换主题 / 换机器都还在" }
    ]);

    /* 栏目：内嵌视图 */
    var viewCard = makeSec(containerEl, "内嵌视图");
    new obsidian.Setting(viewCard)
      .setName("创作看板")
      .setDesc("按板块排布，卡片可拖动搬文件")
      .addToggle(function (t) { t.setValue(S.modules["base.creationBoard"] !== false)
        .onChange(function (v) { S.modules["base.creationBoard"] = v; KB.services.settings.saveSettings(plugin); }); });
    new obsidian.Setting(viewCard)
      .setName("内容流视图")
      .setDesc("时间线预览正文，长库也不卡")
      .addToggle(function (t) { t.setValue(S.modules["base.noteStream"] !== false)
        .onChange(function (v) { S.modules["base.noteStream"] = v; KB.services.settings.saveSettings(plugin); }); });

    /* R18（效果图 看板范围）：排除目录从「高级」提上来（R8：默认留空 = 整个笔记库） */
    var scopeCard = makeSec(containerEl, "看板范围");
    var boardSetting = new obsidian.Setting(scopeCard)
      .setName("排除目录")
      .setDesc("")
      .addText(function (t) {
        t.setPlaceholder("留空 = 整个笔记库");
        t.setValue(String(S.modules["base.boardExclude"] || ""));
        commitOnBlur(t, function (v) {
          S.modules["base.boardExclude"] = String(v || "").trim();
          var apply = KB.modules.applySettingsChange;
          var p = apply ? apply(plugin, { repaint: false }) : KB.services.settings.saveSettings(plugin);
          Promise.resolve(p).then(function () { tab.boardDesc(boardSetting); },
            function () { tab.boardDesc(boardSetting); });
          return true;
        });
      });
    tab.boardDesc(boardSetting);

    /* R18：看板显示项是**视图级配置**（存在 .base 的视图块里，跟着笔记走）。这里只放一条
     * 指路，不放全局开关 —— 放全局会把用户为每个看板单独调好的值一把压平。
     * R21：「卡片宽度」「空位铺满整行」（后者现已缩成「自动」）从 Base 的视图选项面板
     * 挪进了**看板顶栏齿轮 → 「卡片」组**（那边才合成得了一行）。 */
    var adv3 = makeAdv(containerEl);
    new obsidian.Setting(adv3)
      .setName("文件宽度 / 自动")
      .setDesc("在笔记里打开看板 → 顶栏齿轮 → 「卡片」组里调，每个看板各存一份");

    /* R18：帮助（一栏 + 悬浮小窗） */
    helpPop("base");
    };
    makeSection("base"); paintSection("base");

    /* ================= R16：关于（悬浮小窗，挂在页面末尾） ================= */
    (function () {
      var ver = (plugin.manifest && plugin.manifest.version) || "1.0.0";
      var items = [
        { k: "版本", v: "知识库工具集 " + ver + " —— 一个插件管三件事：建知识库、管笔记、换种看法。" },
        { k: "三个模块",
          v: "知识库：预览 / 执行 / 回滚，全链路可撤销。笔记：新建补全、按标签归位、存量一键补全。" +
             "Base：创作看板与内容流两个只读视图。" },
        { k: "安全底线",
          v: "执行前必须勾选「坚果云已同步完成」；回滚只删本轮自己新建、且内容没被改动过的文件；" +
             "预览/执行/回滚都会在库里留一篇可读报告。" },
        { k: "旧插件",
          v: "note-locator / creation-board / bases-preview / auto-note-mover 的功能已全部内置；" +
             "R17 起这三个自研旧插件已退役留档，检测到还在启用时页头会给一条收编提示。" }
      ];
      buildPop(containerEl, "about", "关于 · 知识库工具集", items);
    })();

    /* 初始标签：默认停在「知识库」；测试/跳转可用 tab._activateTab(key) */
    activateTab(tab._tab && groups[tab._tab] ? tab._tab : "rebuild");
    tab._renderFns = renderFns;          /* 测试可直呼：拨开关后只重画对应段落 */
    tab._sectionBoxes = sectionBoxes;
    tab._paintSection = paintSection;
    tab._searchInput = searchInput;
  }
    /** 当前编辑框里的模板正文（没动过编辑框就取配置 / 模板库里的） */
    draftTemplate(id) {
      if (this._tplDraft && (!id || this._tplDraft.id === id)) return this._tplDraft.text;
      var S = this.plugin.settings, T = KB.services.templates;
      var all = T.listAll(S, T.scan(this.plugin.app, S));
      for (var i = 0; i < all.length; i++)
        if (all[i].id === id && all[i].text != null) return String(all[i].text);
      if (T.isFileId(id)) return "";           /* 文件还没读进来 —— 别编内容 */
      return T.get(S, id).text;
    }
  }
  KB.modules.SettingTab = SettingTab;
  KB.modules.detectLegacy = detectLegacy;
  KB.modules.findScroller = findScroller;
  KB.modules.ANCHOR_CLS = ANCHOR_CLS;
  KB.modules.TABS = TABS;
  KB.modules.HELP = HELP;
  return SettingTab;
});

/* ===== 76_core_settingModals.js ===== */
/* 设置页的辅助弹窗（R7）：都不改库文件，只读 + 回填配置。
 *   ① RoutesModal  「查看路由条数」的真响应：把 12 条路由连同**可识别写法**列出来，
 *                  并顺手体检「前缀是不是当前库根 / 目标目录在不在」——
 *                  这正是「路由此刻指着一个不存在的库」时最该看到的话。
 *   ② NameModal    另存为新模板 / 重命名，只要一个名字。
 *   ③ ExtractModal 从任意一篇已有笔记反推模板（剥前言 → 换占位符），结果可手改再存。
 * 全部走原生 Modal + Setting，无自定义 CSS。 */
KB.define("core/settingModals", function () {
  var util = function () { return KB.services["router.util"]; };

  /* ---------------- ① 路由表 ---------------- */
  /**
   * 路由体检（只读）。返回 { root, count, rows:[{folder, keys:[]}], stale:[], missing:[] }
   *   stale  = folder 前缀不是当前库根（换过库根名又手改过路由表 → 会指到不存在的目录）
   *   missing= folder 在当前库里找不到
   */
  function routesAudit(plugin) {
    var S = plugin.settings, app = plugin.app;
    var root = S.paths.knowledgeBase;
    var routes = (S.automation && S.automation.routes) || [];
    var R = new KB.services.router({ root: root, property: S.automation.property,
      routes: routes, excluded: S.automation.excluded });
    var rows = [], stale = [], missing = [];
    for (var i = 0; i < R.routes.length; i++) {
      var r = R.routes[i];
      var keys = [];
      r.keys.forEach(function (k) { keys.push(k); });
      rows.push({ folder: r.folder, keys: keys.sort() });
      if (String(r.folder).indexOf(root + "/") !== 0) stale.push(r.folder);
      var exists = false;
      try { exists = !!app.vault.getAbstractFileByPath(r.folder); } catch (e) { exists = false; }
      if (!exists) missing.push(r.folder);
    }
    return { root: root, count: rows.length, rows: rows, stale: stale, missing: missing };
  }

  class RoutesModal extends obsidian.Modal {
    constructor(app, plugin) { super(app); this.plugin = plugin; }
    onOpen() {
      var el = this.contentEl, a = routesAudit(this.plugin);
      el.empty();
      el.createEl("h3", { text: "标签-目录映射表 · " + a.count + " 条" });
      el.createEl("p", { cls: "setting-item-description",
        text: "标签与「" + this.plugin.settings.automation.property + "」属性命中哪条写法，笔记就落到哪个目录。" +
          "前缀由「知识库根目录」（当前：" + a.root + "）派生 —— 手改过这张表就不再自动跟随。" });

      if (a.stale.length) {
        var w = el.createEl("div", { cls: "kb-legacy-banner callout", attr: { "data-callout": "warning" } });
        w.createEl("p", { text: "有 " + a.stale.length + " 条路由的前缀不是当前库根，多半指向一个不存在的目录：" });
        var ul1 = w.createEl("ul");
        for (var i = 0; i < a.stale.length; i++) ul1.createEl("li", { text: a.stale[i] });
      } else {
        el.createEl("p", { cls: "setting-item-description", text: "✅ " + a.count + " 条路由的前缀都与当前库根一致。" });
      }
      if (a.missing.length) {
        el.createEl("p", { cls: "setting-item-description",
          text: "另有 " + a.missing.length + " 条路由的目标目录在当前库里找不到（可能只是还没建出目录）：" +
            a.missing.slice(0, 5).join("、") + (a.missing.length > 5 ? "…" : "") });
      }

      var table = el.createEl("table", { cls: "kb-routes-table" });
      var head = table.createEl("tr");
      head.createEl("th", { text: "目录" });
      head.createEl("th", { text: "可识别写法（标签 / 属性值）" });
      for (var k = 0; k < a.rows.length; k++) {
        var tr = table.createEl("tr");
        tr.createEl("td", { text: a.rows[k].folder });
        tr.createEl("td", { text: a.rows[k].keys.filter(function (x) { return x; }).join(" · ") || "（无）" });
      }

      var row = el.createEl("div", { cls: "kb-rebuild-btns" });
      var b = row.createEl("button", { text: "知道了" });
      b.addEventListener("click", function () { this.close(); }.bind(this));
      b.className = "mod-cta";
      b.focus();
    }
    onClose() { this.contentEl.empty(); }
  }

  /* ---------------- ② 命名 ---------------- */
  class NameModal extends obsidian.Modal {
    constructor(app, opts) {
      super(app);
      this.opts = opts || {};
      this.value = this.opts.value || "";
      this.onSubmit = null;
    }
    onOpen() {
      var self = this, el = this.contentEl;
      el.empty();
      el.createEl("h3", { text: this.opts.title || "命名" });
      if (this.opts.desc) el.createEl("p", { cls: "setting-item-description", text: this.opts.desc });
      new obsidian.Setting(el).setName(this.opts.label || "名称")
        .addText(function (t) { t.setValue(self.value).onChange(function (v) { self.value = String(v || ""); }); });
      var row = el.createEl("div", { cls: "kb-rebuild-btns" });
      var bOk = row.createEl("button", { text: this.opts.okText || "确定", cls: "mod-cta" });
      bOk.addEventListener("click", function () { self.submit(); });
      var bNo = row.createEl("button", { text: "取消" });
      bNo.addEventListener("click", function () { self.close(); });
    }
    submit() {
      var v = String(this.value || "").trim();
      if (!v) { new obsidian.Notice("请先填一个名字。", 6000); return false; }
      var cb = this.onSubmit;
      this.close();
      if (cb) cb(v);
      return true;
    }
    onClose() { this.contentEl.empty(); }
  }

  /* ---------------- ③ 从笔记提取模板 ---------------- */
  class ExtractModal extends obsidian.Modal {
    constructor(app, plugin) {
      super(app);
      this.plugin = plugin;
      this.srcPath = "";
      this.value = "";
      this.text = "";
      this.onSubmit = null;
    }
    /** 候选笔记：全库 md，剔掉排除目录（元数据目录 / 历史存档库 / 点开头目录） */
    candidates() {
      var app = this.plugin.app, S = this.plugin.settings, out = [];
      var files = app.vault.getMarkdownFiles ? app.vault.getMarkdownFiles() : [];
      var R = new KB.services.router({ root: S.paths.knowledgeBase, property: S.automation.property,
        routes: [], excluded: S.automation.excluded });
      for (var i = 0; i < files.length; i++) {
        var f = files[i], p = f.parent ? f.parent.path : "";
        if (R.isExcluded(p)) continue;
        out.push(f.path);
      }
      out.sort();
      return out;
    }
    /** 读一篇笔记 → 反推模板文本（异步；返回提取结果） */
    async pick(path) {
      this.srcPath = path;
      var app = this.plugin.app;
      var f = path ? app.vault.getAbstractFileByPath(path) : null;
      if (!f) { this.text = ""; this.setPreview(""); return ""; }
      var raw = "";
      try {
        raw = app.vault.cachedRead ? await app.vault.cachedRead(f) : (f.content || "");
      } catch (e) { raw = f.content || ""; }
      this.text = KB.services.templates.extract(raw, { title: f.basename });
      this.setPreview(this.text);
      return this.text;
    }
    setPreview(v) {
      if (this.textEl) this.textEl.value = v === undefined ? this.text : v;
      if (this.hintEl) this.hintEl.textContent = this.srcPath ? "来源：" + this.srcPath : "还没选笔记";
    }
    onOpen() {
      var self = this, el = this.contentEl;
      var cands = this.candidates();
      el.empty();
      el.createEl("h3", { text: "从笔记提取模板" });
      el.createEl("p", { cls: "setting-item-description",
        text: "拿一篇已经写好的笔记当样板：前言里的标题 / 日期 / 文件位置会换成占位符，" +
          "正文原样保留（中心链与「返回」链也会换成占位符）。提取结果可以再改。" });

      var active = null;
      try { active = this.plugin.app.workspace.getActiveFile(); } catch (e) { /* 没活动文件就取第一篇 */ }
      var def = (active && cands.indexOf(active.path) >= 0) ? active.path : (cands[0] || "");

      new obsidian.Setting(el).setName("选择笔记").setDesc("共 " + cands.length + " 篇可选（已剔除元数据目录）")
        .addDropdown(function (d) {
          for (var i = 0; i < cands.length; i++) d.addOption(cands[i], cands[i]);
          if (!cands.length) d.addOption("", "（库里没有可选笔记）");
          d.setValue(def);
          d.onChange(function (v) { self.pick(v); });
        });
      new obsidian.Setting(el).setName("模板名")
        .addText(function (t) {
          var base = def ? def.split("/").pop().replace(/\.md$/, "") : "";
          t.setValue(base ? base + " · 模板" : "我的模板")
            .onChange(function (v) { self.value = String(v || ""); });
          self.value = base ? base + " · 模板" : "我的模板";
        });

      this.hintEl = el.createEl("p", { cls: "setting-item-description", text: "还没选笔记" });
      this.textEl = el.createEl("textarea", { cls: "kb-tpl-text" });
      this.textEl.style.width = "100%";
      this.textEl.style.minHeight = "240px";
      this.textEl.addEventListener("input", function () { self.text = self.textEl.value; });

      var row = el.createEl("div", { cls: "kb-rebuild-btns" });
      var bOk = row.createEl("button", { text: "保存为新模板", cls: "mod-cta" });
      bOk.addEventListener("click", function () { self.submit(); });
      var bNo = row.createEl("button", { text: "取消" });
      bNo.addEventListener("click", function () { self.close(); });

      if (def) this.pick(def);
    }
    submit() {
      var name = String(this.value || "").trim();
      var text = String(this.textEl ? this.textEl.value : this.text || "");
      if (!name) { new obsidian.Notice("请先给模板起个名字。", 6000); return false; }
      if (!text.trim()) { new obsidian.Notice("模板正文是空的 —— 先选一篇有内容的笔记。", 6000); return false; }
      var cb = this.onSubmit;
      this.close();
      if (cb) cb({ name: name, text: text });
      return true;
    }
    onClose() { this.contentEl.empty(); }
  }

  /* ---------------- ④ 通用确认（R8：一键补全这类批量写库前的门槛） ---------------- */
  class ConfirmModal extends obsidian.Modal {
    constructor(app, opts) {
      super(app);
      this.opts = opts || {};
      this.onConfirm = null;
    }
    onOpen() {
      var self = this, el = this.contentEl, o = this.opts;
      el.empty();
      el.createEl("h3", { text: o.title || "确认" });
      var lines = o.lines || [];
      for (var i = 0; i < lines.length; i++) el.createEl("p", { text: lines[i] });
      var bullets = o.bullets || [];
      if (bullets.length) {
        var ul = el.createEl("ul");
        for (var j = 0; j < bullets.length; j++) ul.createEl("li", { text: bullets[j] });
      }
      if (o.more) el.createEl("p", { cls: "setting-item-description", text: o.more });
      if (o.note) el.createEl("p", { cls: "setting-item-description", text: o.note });
      var row = el.createEl("div", { cls: "kb-rebuild-btns" });
      var bOk = row.createEl("button", {
        text: o.okText || "确定", cls: o.warning === false ? "mod-cta" : "mod-warning" });
      bOk.addEventListener("click", function () { self.confirm(); });
      var bNo = row.createEl("button", { text: "取消" });
      bNo.addEventListener("click", function () { self.close(); });
      bNo.focus();
    }
    /** 供按钮与测试调用：关闭 + 触发回调 */
    confirm() {
      var cb = this.onConfirm;
      this.close();
      if (cb) return cb();
      return true;
    }
    onClose() { this.contentEl.empty(); }
  }

  KB.modules.routesAudit = routesAudit;
  KB.modules.RoutesModal = RoutesModal;
  KB.modules.NameModal = NameModal;
  KB.modules.ExtractModal = ExtractModal;
  KB.modules.ConfirmModal = ConfirmModal;
  return { routesAudit: routesAudit, RoutesModal: RoutesModal, NameModal: NameModal,
    ExtractModal: ExtractModal, ConfirmModal: ConfirmModal };
});

/* ===== 80_modules_automation.js ===== */
/* 笔记自动化模块：事件订阅 → 路由解析 → 移动/回填/中心链（note-locator handle 原样移植到服务层组合）。
 * R1 仅注册不启用（settings.modules.automation 默认 false，避免与线上插件双跑）；R2 切换轮打开。 */
KB.define("modules/automation", function () {
  function AutomationModule(plugin) {
    this.plugin = plugin;
    this.busy = new Set();
    this.stats = { moved: 0, filled: 0, blocked: 0, center: 0, deferred: 0, refused: 0,
      patched: 0, kept: 0 };
    /* R19：等 Templater 把模板整篇落盘之后，再补「文件位置」的等待时长（毫秒）。
     * 做成实例字段 → 测试里设 0 就不用真等。 */
    this.tplDeferMs = 800;
  }
  AutomationModule.prototype.onEnable = async function () {
    var P = KB.services;
    var cfg = this.plugin.settings.automation;
    this.onConfigure();
    this.fm = new P.fm(this.plugin.app);
    this.links = new P.links(this.plugin.app);
    this.mover = new P.mover(this.plugin.app);
    /* R13（boss：界面翻新）：一键补全命令收进设置页按钮（② 组「开始扫描」），
     * 命令面板不再重复入口。扫描/确认/报告逻辑原样（runAutofill 三段不变）。 */
    this._cmdIds = [];
    var self = this;
    /**
     * R8：改成 **await 串行**（原来是 tryCreateFill 不 await、handle 立刻并行跑）。
     * 旧写法有两笔账：① 补全还在写文件时 handle 已经把文件搬走 → 白写一次；
     * ② 两处各写一遍前言（processFrontMatter）→ 新建一篇笔记要写 2~3 次盘，体感慢。
     * 串行之后 handle 看到的是**补全后**的前言，绝大多数情况直接判定「已经是想要的样子」→ 不再写。
     * 另外顺手把模板缓存失效挂在事件上：模板文件被改动 → 立刻重扫。
     */
    this.handler = async function (kind, file, oldPath) {
      /* R9：重建/回滚期间让路。这是自动化唯一的事件入口 —— 挡住它，路由就不会
       * 把回滚刚收容走的笔记又搬回新库（老板报的第 5/6/7 条的真根因）。 */
      var Q = KB.services.quiet;
      if (Q && Q.isQuiet(self.plugin)) { Q.note(self.plugin); return; }
      try {
        var tdir = KB.services.templates.dirFor(self.plugin.settings);
        if (tdir && file && file.path && file.path.indexOf(tdir + "/") === 0)
          KB.services.templates.invalidate();
      } catch (e) { /* 缓存失效失败不影响主流程 */ }
      /* R11（boss 第 1 条）：rename = 有人在拖/搬文件 → 走「手动搬移」处理：
       * 属性跟随新目录、中心链跟着修，**绝不按路由把文件搬回去**。
       * 旧实现把 rename 也喂给 handle()，属性还写着旧目录 → 拖完立刻被弹回原位，
       * 表现就是「在目录里拖动笔记，拖不动」。 */
      if (kind === "rename") { await self.handleManualMove(file, oldPath); return; }
      if (kind === "create") await self.tryCreateFill(file);
      await self.handle(file);
    };
    this.migrateFromNoteLocator();
    this.retireLegacy();
    this.plugin.eventBus.on(this.handler);
    this.plugin.eventBus.start();
  };
  /**
   * R7：路由器的 root / routes / excluded 都是**启动那一刻**从 settings 拷进实例的。
   * 用户在向导或设置页改了库根名，模块不重启就等于还在按老库根算 —— 这就是
   * 「改了知识库名称没生效 / 新笔记不补全」的第二条根因。所以配置一变就地重配。
   */
  AutomationModule.prototype.onConfigure = function () {
    var cfg = this.plugin.settings.automation;
    var root = this.plugin.settings.paths.knowledgeBase;
    this.router = new KB.services.router({ root: root, property: cfg.property,
      routes: cfg.routes, excluded: cfg.excluded });
    /* R10-①：候选值表可能随配置改动（或首次启用）变化 → 就地刷新（幂等） */
    this.patchPropertySuggestions();
    return true;
  };
  /* ---- R10-①：属性候选值下拉 -----------------------------------------------------
   * boss 第 1 条：「像主库一样能直接在属性里选文件存储位置」。主库能做到是因为旧
   * note-locator 给 `metadataCache.getFrontmatterPropertyValuesForKey` 打了补丁 ——
   * Obsidian 原生只从「库内已有笔记的属性值」收集候选，空目录落点（01_执行中…）和
   * 没用过的状态永远不出现在下拉里。收编后这层补丁由本模块自己提供：候选 =
   * 原生收集值 ∪ settings.automation.propertyOptions[key]。幂等、只做并集、不写任何笔记。 */
  AutomationModule.prototype.patchPropertySuggestions = function () {
    var mc = this.plugin.app && this.plugin.app.metadataCache;
    if (!mc || typeof mc.getFrontmatterPropertyValuesForKey !== "function") return false;
    if (!mc.__kbPropOptions) mc.__kbPropOptions = { options: {} };
    mc.__kbPropOptions.options = this.plugin.settings.automation.propertyOptions || {};
    if (mc.__kbPropPatched) return true;
    var orig = mc.getFrontmatterPropertyValuesForKey.bind(mc);
    mc.__kbPropOrig = orig;
    mc.getFrontmatterPropertyValuesForKey = function (key) {
      var base = orig(key) || [];
      var extra = (mc.__kbPropOptions && mc.__kbPropOptions.options[key]) || [];
      if (!extra.length) return base;
      var seen = new Set(base.map(String)), out = [];
      base.forEach(function (v) { out.push(String(v)); });
      for (var i = 0; i < extra.length; i++) {
        var s = String(extra[i] == null ? "" : extra[i]);
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
      }
      out.sort(function (a, b) { return a.localeCompare(b, "zh-Hans-CN", { numeric: true }); });
      return out;
    };
    mc.__kbPropPatched = true;
    return true;
  };
  /** 模块停用 → 摘补丁（恢复原函数；若旧 note-locator 的补丁在我们之前装，恢复出来的就是它的包装） */
  AutomationModule.prototype.unpatchPropertySuggestions = function () {
    var mc = this.plugin.app && this.plugin.app.metadataCache;
    if (mc && mc.__kbPropPatched && mc.__kbPropOrig) {
      mc.getFrontmatterPropertyValuesForKey = mc.__kbPropOrig;
      mc.__kbPropPatched = false;
    }
  };
  AutomationModule.prototype.onDisable = async function () {
    if (this.handler) this.plugin.eventBus.off(this.handler);
    this.plugin.eventBus.stop();
    this.unpatchPropertySuggestions();
    this.removeCommands();
  };
  /** R8：模块关掉 → 摘掉一键补全命令（与 ① 同一个硬门控规矩） */
  AutomationModule.prototype.removeCommands = function () {
    var cmds = this.plugin.app && this.plugin.app.commands;
    var ids = this._cmdIds || [];
    if (!cmds || typeof cmds.removeCommand !== "function") return 0;
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
      try { cmds.removeCommand("kb-toolkit:" + ids[i]); n++; } catch (e) { /* 摘不掉也不致命 */ }
    }
    return n;
  };
  AutomationModule.prototype.isOn = function () { return this.plugin.settings.modules.automation === true; };
  /** 与 ① 同样的守卫：模块关着时任何残留入口都不许动库 */
  AutomationModule.prototype.requireOn = function () {
    if (this.isOn()) return true;
    new obsidian.Notice("笔记自动化已关闭 → 该操作不可用。\n请到「设置 → 知识库工具集 → 启用模块」打开「② 笔记自动化」。", 9000);
    return false;
  };
  /**
   * R8 一键补全入口：先只读扫一遍 → 弹确认框（列条数与前几篇路径）→ 确认后才逐篇写。
   * 不许静默批量改库。
   */
  AutomationModule.prototype.startAutofill = async function (opts) {
    opts = opts || {};
    if (!this.requireOn()) return { ok: false, reason: "module-off" };
    var self = this, app = this.plugin.app, S = this.plugin.settings;
    var preview = await this.runAutofill({ confirmed: false });
    if (preview.needConfirm && opts.confirmed !== true) {
      if (!KB.modules.ConfirmModal) return preview;
      var m = new KB.modules.ConfirmModal(app, {
        title: "一键补全 · 确认",
        lines: [
          "扫过 " + preview.scanned + " 篇，其中 " + preview.todo + " 篇需要补全。",
          "补法：只补齐缺的部分 —— 空笔记套整套模板；有正文的只在开头补 YAML、在结尾补「关联笔记」双链。",
          "原有正文一个字符都不会动；排除目录与模板库一律跳过。"
        ],
        bullets: preview.plan.slice(0, 8).map(function (p) {
          return p.path + "  →  " + [p.empty ? "整篇套模板" : null, p.needYaml ? "补 YAML" : null,
            p.needLinks ? "补尾部双链" : null].filter(Boolean).join(" + ");
        }),
        more: preview.todo > 8 ? "…另有 " + (preview.todo - 8) + " 篇" : null,
        okText: "确认补全"
      });
      m.onConfirm = function () { return self.runAutofill({ confirmed: true }).then(function (r) {
        self.reportAutofill(r);
        return r;
      }); };
      m.open();
      this.lastModal = m;
      return preview;
    }
    if (opts.confirmed === true) return this.runAutofill({ confirmed: true });
    new obsidian.Notice("知识库工具集：扫描完 " + preview.scanned + " 篇，没有需要补全的笔记。", 9000);
    return preview;
  };
  /** 补完写一篇操作日志（尽力而为，失败只告警） */
  AutomationModule.prototype.reportAutofill = async function (res) {
    var app = this.plugin.app, S = this.plugin.settings;
    var ls = ["笔记自动化 · 一键补全"];
    ls.push("扫过 " + res.scanned + " 篇 · 需补 " + res.todo + " 篇 · 实际写入 " + res.written.length + " 篇");
    ls.push("补 YAML " + res.yaml + " · 补尾部双链 " + res.links + " · 空笔记整套模板 " + res.full +
      (res.errors.length ? " · 失败 " + res.errors.length : ""));
    var self = this;
    for (var i = 0; i < Math.min(res.written.length, 6); i++) {
      var w = res.written[i];
      ls.push("  · " + w.path + (w.rule ? "（规则：" + w.rule + "）" : ""));
    }
    if (res.written.length > 6) ls.push("  · …另有 " + (res.written.length - 6) + " 篇（见操作日志）");
    new obsidian.Notice(ls.join("\n"), 15000);
    try {
      var svc = new KB.services.rebuild(app);
      var rep = svc.reportMarkdown("autofill", { result: res }, {
        now: new Date(), paths: S.paths, pluginDir: ".obsidian/plugins/kb-toolkit" });
      var folder = KB.services.report.logFolder(S.paths, S.paths.knowledgeBase);
      if (!app.vault.getAbstractFileByPath(folder)) await this.ensureFolder(folder);
      var path = folder + "/" + rep.fileName;
      /* R15 修：撞名只试 (2) 一次 → 同一分钟第三次补全时 create 抛错、报告静默丢。
       * 跟 rebuild 的 writeLogNote 同款：序号递增到空位为止 */
      if (app.vault.getAbstractFileByPath(path)) {
        var n = 2;
        while (app.vault.getAbstractFileByPath(folder + "/" + rep.fileName.replace(/\.md$/, " (" + n + ").md"))) n++;
        path = folder + "/" + rep.fileName.replace(/\.md$/, " (" + n + ").md");
      }
      await app.vault.create(path, rep.markdown);
      this.lastLogPath = path;
      ls.push("📄 报告：" + path);
    } catch (e) { console.warn("[kb-toolkit] 写补全报告失败", e); return null; }
    return this.lastLogPath;
  };
  /** 逐级建目录（报告落点用） */
  AutomationModule.prototype.ensureFolder = async function (path) {
    var app = this.plugin.app;
    var segs = String(path).split("/").filter(function (s) { return s.length > 0; });
    var cur = "";
    for (var i = 0; i < segs.length; i++) {
      cur = cur ? cur + "/" + segs[i] : segs[i];
      if (app.vault.getAbstractFileByPath(cur)) continue;
      try { await app.vault.createFolder(cur); } catch (e) { return false; }
    }
    return true;
  };
  /* ---- R2：note-locator data.json 一次性迁移（routes/excluded/propertyOptions 全量继承） ---- */
  AutomationModule.prototype.migrateFromNoteLocator = async function () {
    var plugin = this.plugin;
    if (plugin.settings.automation.migrated) return;
    try {
      var adapter = plugin.app.vault.adapter;
      if (!adapter || typeof adapter.read !== "function") return;
      var raw = await adapter.read(".obsidian/plugins/note-locator/data.json");
      var old = JSON.parse(raw);
      var a = plugin.settings.automation;
      if (old.property) a.property = old.property;
      if (Array.isArray(old.routes) && old.routes.length) a.routes = old.routes;
      if (Array.isArray(old.excluded) && old.excluded.length) a.excluded = old.excluded;
      if (old.propertyOptions && Object.keys(old.propertyOptions).length) a.propertyOptions = old.propertyOptions;
      if (typeof old.writeBack === "boolean") a.writeBack = old.writeBack;
      if (typeof old.fixCenterLink === "boolean") a.fixCenterLink = old.fixCenterLink;
      a.migrated = true;
      this.router.configure({ root: plugin.settings.paths.knowledgeBase, property: a.property,
        routes: a.routes, excluded: a.excluded });
      await KB.services.settings.saveSettings(plugin);
      new obsidian.Notice("知识库工具集：已迁移 note-locator 配置（路由 " + a.routes.length + " 条），原插件可停用。", 8000);
    } catch (e) {
      /* data.json 不存在（未装过旧插件）→ 静默跳过，用默认路由表 */
    }
  };
  /* ---- R2：开新停旧，避免同一事件被两套逻辑各处理一遍 ----
   * R15 修：disablePlugin 是异步的，原来不 await —— 旧插件 onunload 还没跑完，
   * 同一事件可能被新旧两套逻辑各处理一遍。改为内部逐个 await（本函数变 async，
   * 调用侧保持 fire-and-forget，不拖慢 onEnable）。 */
  AutomationModule.prototype.retireLegacy = async function () {
    try {
      var pm = this.plugin.app.plugins;
      if (!pm || !pm.enabledPlugins) return;
      var self = this;
      var ids = ["note-locator", "auto-note-mover"];
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (!pm.enabledPlugins.has(id)) continue;
        var r = pm.disablePlugin(id);
        /* R15：Promise 落地前旧插件还活着 —— await 它，压缩「两套逻辑同跑」的窗口 */
        if (r && typeof r.then === "function") { try { await r; } catch (e2) {} }
        self.plugin.retiredLegacy = self.plugin.retiredLegacy || [];
        self.plugin.retiredLegacy.push(id);
        new obsidian.Notice("知识库工具集：「笔记自动化」已接管，旧插件 " + id + " 已自动停用（可在第三方插件列表重新打开）。", 8000);
      }
    } catch (e) { console.warn("[kb-toolkit] 停用旧插件失败", e); }
  };
  /* ---- R2：创建补全 —— 仅空白新文件（剥前言后正文为空），避开粘贴与 Templater 场景 ---- */
  AutomationModule.prototype.todayStr = function (now) {
    var d = (now instanceof Date) ? now : new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  };
  /** 渲染上下文（模板占位符的取值口径只在这一个地方） */
  AutomationModule.prototype.ctxFor = function (file, parentPath) {
    var S = this.plugin.settings;
    var util = KB.services["router.util"];
    return {
      title: file ? file.basename : "",
      date: this.todayStr(),
      folder: util.canonical(parentPath, S.paths.knowledgeBase),
      center: util.centerFor(parentPath) || "",
      moc: S.paths.mocLink,
      kb: S.paths.knowledgeBase
    };
  };
  /**
   * R8：挑模板 —— **套用规则优先（标签 → 文件夹最长前缀），都不中才用「当前模板」**。
   * 返回 { id, name, text, why, ruleId }
   */
  AutomationModule.prototype.pickTemplate = async function (file, parentPath) {
    var S = this.plugin.settings, T = KB.services.templates;
    var tags = [];
    try {
      tags = (typeof obsidian.getAllTags === "function")
        ? (obsidian.getAllTags(this.plugin.app.metadataCache.getFileCache(file)) || [])
        : [];
    } catch (e) { tags = []; }
    var hit = T.ruleFor(S, parentPath, tags);
    if (hit) {
      var t = await T.resolveText(this.plugin.app, S, hit.templateId);
      /* R17：带上模板文件本身（t.file）—— 含 Templater 语法时要拿它当 template_file 求值 */
      if (t) return { id: t.id, name: t.name, text: t.text, why: hit.why, ruleId: hit.ruleId, file: t.file };
    }
    var a = await T.activeTemplate(this.plugin.app, S);
    return { id: a.id, name: a.name, text: a.text, why: null, ruleId: null, file: a.file };
  };

  /** R17：模板没能安全落盘时只提醒一次（批量补全刷屏很烦），并把原因带到操作日志 */
  AutomationModule.prototype.warnTemplateRefused = function (reason, tpl) {
    this.lastRefuseReason = reason;
    if (this._warnedTplRefuse) return;
    this._warnedTplRefuse = true;
    try {
      new obsidian.Notice("知识库工具集：当前模板「" + ((tpl && tpl.name) || "未命名") +
        "」是 Templater 模板，但没能求值（" + reason + "）→ 已跳过，没有往笔记里写。" +
        "请确认 Templater 插件已启用；或把「创建补全模板」换成普通模板。", 12000);
    } catch (e) { /* Notice 失败也不该影响主流程 */ }
  };
  AutomationModule.prototype.tryCreateFill = async function (file) {
    var S = this.plugin.settings;
    if (S.automation.createFill === false) return false;
    /* R9：重建/回滚期间不做创建补全（新库的种子文件是插件自己写的，不该被再改一遍）。 */
    var Q = KB.services.quiet;
    if (Q && Q.isQuiet(this.plugin)) { Q.note(this.plugin); return false; }
    if (!file || file.extension !== "md" || !(file.parent)) return false;
    var app = this.plugin.app;
    var kbRoot = S.paths.knowledgeBase;
    var parentPath = file.parent.path;
    if (this.router.isExcluded(parentPath)) return false;
    if (!KB.services["router.util"].centerFor(parentPath)) return false;  /* 认不出中心 → 不动手 */
    try {
      var content = app.vault.cachedRead
        ? await app.vault.cachedRead(file)
        : file.content;
      if (content === null || content === undefined) return false;
      /* 空白判定：剥掉 YAML 前言后正文只剩空白 → 才补；Templater 已注入 → 不碰 */
      var body = String(content).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
      if (body.length > 0) return false;
      /* R17：该目录已被 Templater 的「目录模板」接管 → **正文**让路，不抢着写。
       * 依据：Templater 只在「剥前言后正文为空」时才套它的模板，两个插件都写必互相覆盖。
       * R19（boss 第 1 条）：「让路」不等于撒手 —— note-locator 时代新笔记默认就带
       * 「文件位置」属性，在属性面板里点一下就把它发到对应目录；让路之后这一项没人补，
       * 功能就整个消失了。所以改成：正文让给 Templater，本插件只补「文件位置」这一个键。 */
      var TPL = KB.services.templates;
      if (TPL.templaterFolderRule(app, parentPath)) {
        this.stats.deferred++;
        this.patchLocationKey(file);
        return false;
      }
      var tpl = await this.pickTemplate(file, parentPath);
      /* R17：模板含 Templater 语法 → 先求值再落盘；求不到就拒写（宁可空着，不写脏数据） */
      var made = await TPL.materialize(app, tpl.file, file, tpl.text, this.ctxFor(file, parentPath));
      if (!made.ok) { this.stats.refused++; this.warnTemplateRefused(made.reason, tpl); return false; }
      await app.vault.process(file, function () { return made.text; });
      this.lastFillTemplate = tpl.id;
      this.lastFillWhy = tpl.why;
      this.lastFillVia = made.via;
      this.stats.filled++;
      return true;
    } catch (e) { console.error("[kb-toolkit] 创建补全失败", file && file.path, e); return false; }
  };
  /**
   * R19 需求1：给「已被 Templater 接管的目录」里的新笔记补上「文件位置」属性。
   *
   * 为什么单独走一条路：Templater 是**整篇落盘**（含前言），所以这里
   *   ① 先等它写完（this.tplDeferMs，实例字段 → 测试设 0 就不用真等）；
   *   ② 再拿 fileManager.processFrontMatter **原子**地只加这一个键 —— 只加不覆盖，
   *      已有就跳过（幂等），因此永远不会把 Templater 写进去的内容冲掉；
   *   ③ 值**留空**：路由判定是「文件位置非空 → 以它为准；为空 → 按标签归位」，
   *      要是填成当前目录，新笔记会原地不动、不再按标签归位 —— 那不是旧插件的行为。
   *
   * 效果：属性面板里从此有「文件位置」这一行，点开即是我们补的候选值下拉；
   * 选一个目录 → 文件自动搬过去，并同步更新 YAML 与尾部双链。
   */
  AutomationModule.prototype.patchLocationKey = async function (file) {
    var self = this;
    var S = this.plugin.settings;
    if (!file || file.extension !== "md") return false;
    if (S.automation && S.automation.writeBack === false) return false;   /* 关掉写回就不碰前言 */
    var app = this.plugin.app;
    if (!app || !app.fileManager || typeof app.fileManager.processFrontMatter !== "function") return false;
    var key = (S.automation && S.automation.property) || "文件位置";
    try {
      if (this.tplDeferMs) {
        await new Promise(function (res) { setTimeout(res, self.tplDeferMs); });
      }
      /* 等这段时间里文件可能已被改名/删除 → 按路径重新取一次 */
      var af = file;
      if (app.vault.getAbstractFileByPath) {
        var re = app.vault.getAbstractFileByPath(file.path);
        if (re) af = re;
      }
      var cache = (app.metadataCache && app.metadataCache.getFileCache)
        ? app.metadataCache.getFileCache(af) : null;
      var fm = cache && cache.frontmatter;
      if (fm && Object.prototype.hasOwnProperty.call(fm, key)) {
        this.stats.kept = (this.stats.kept || 0) + 1;
        return false;                       /* 已经有了（Templater 模板自带）→ 不碰 */
      }
      await app.fileManager.processFrontMatter(af, function (o) {
        if (!Object.prototype.hasOwnProperty.call(o, key)) o[key] = "";
      });
      this.stats.patched = (this.stats.patched || 0) + 1;
      return true;
    } catch (e) { this.stats.blocked++; return false; }
  };

  /* ================= R8：一键补全（扫描全库 → 批量补 YAML / 尾部双链） ================= */
  /** 把模板正文切成「前言 / 主体 / 关联笔记尾巴」三段（供只缺一段的笔记按需补） */
  function splitTemplate(text) {
    var s = String(text == null ? "" : text);
    var m = s.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/);
    var yaml = m ? m[1] : "";
    var body = m ? s.slice(m[0].length) : s;
    var cut = body.search(/\n#{1,6}\s*关联笔记/);
    var tail = "";
    if (cut >= 0) { tail = body.slice(cut).replace(/^\n+/, ""); body = body.slice(0, cut); }
    if (!tail) tail = "## 关联笔记\n- 所属中心：[[{{center}}]]\n- 返回 [[{{moc}}]]";
    return { yaml: yaml, body: body, tail: tail };
  }
  /** 体检一篇：缺前言 / 缺尾部双链 / 正文是否为空 */
  AutomationModule.prototype.analyze = function (content) {
    var raw = String(content == null ? "" : content);
    var hasYaml = /^---\r?\n/.test(raw);
    var hasLinks = /所属中心[：:]\s*\[\[/.test(raw) || /返回\s*\[\[/.test(raw);
    var body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    return { hasYaml: hasYaml, hasLinks: hasLinks, needYaml: !hasYaml, needLinks: !hasLinks,
      empty: body.length === 0 };
  };
  /** 该被补全的笔记清单（只读；排除目录 / 模板目录一律跳过） */
  AutomationModule.prototype.scanTodo = async function () {
    var app = this.plugin.app, S = this.plugin.settings;
    var T = KB.services.templates;
    var tplDir = T.dirFor(S);
    var files = app.vault.getMarkdownFiles ? app.vault.getMarkdownFiles() : [];
    var plan = [], i;
    for (i = 0; i < files.length; i++) {
      var f = files[i], parentPath = f.parent ? f.parent.path : "";
      if (this.router.isExcluded(parentPath)) continue;
      if (tplDir && (f.path === tplDir || f.path.indexOf(tplDir + "/") === 0)) continue;
      var content = "";
      try { content = app.vault.cachedRead ? await app.vault.cachedRead(f) : (f.content || ""); }
      catch (e) { content = f.content || ""; }
      var st = this.analyze(content);
      if (!st.needYaml && !st.needLinks) continue;
      plan.push({ path: f.path, file: f, needYaml: st.needYaml, needLinks: st.needLinks, empty: st.empty });
    }
    plan.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    return { scanned: files.length, plan: plan };
  };
  /**
   * 一键补全：先只读扫一遍（不落任何字），确认后逐篇补。
   * opts: { confirmed, onProgress, now }
   * 底线：只**加**不删 —— 有正文的笔记只补缺的那段，原有内容一个字符不动。
   */
  AutomationModule.prototype.runAutofill = async function (opts) {
    opts = opts || {};
    var app = this.plugin.app, S = this.plugin.settings, self = this;
    var T = KB.services.templates;
    var todo;
    try { todo = await this.scanTodo(); }
    catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
    var res = { ok: true, scanned: todo.scanned, todo: todo.plan.length,
      yaml: 0, links: 0, full: 0, written: [], skipped: [], errors: [], byTemplate: {} };
    if (opts.confirmed !== true) { res.needConfirm = true; res.plan = todo.plan; return res; }

    var progress = opts.onProgress || function () {};
    for (var i = 0; i < todo.plan.length; i++) {
      var it = todo.plan[i];
      var f = it.file;
      try {
        if (!app.vault.getAbstractFileByPath(it.path)) { res.skipped.push({ path: it.path, reason: "已不存在" }); continue; }
        var raw = app.vault.cachedRead ? await app.vault.cachedRead(f) : (f.content || "");
        raw = String(raw == null ? "" : raw);
        var st = this.analyze(raw);
        if (!st.needYaml && !st.needLinks) { res.skipped.push({ path: it.path, reason: "已被处理过" }); continue; }
        var parentPath = f.parent ? f.parent.path : "";
        var tpl = await this.pickTemplate(f, parentPath);
        /* R17：含 Templater 语法的模板先求值；求不到 → 这篇跳过并记账，不写脏数据 */
        var made = await T.materialize(app, tpl.file, f, tpl.text, this.ctxFor(f, parentPath));
        if (!made.ok) {
          res.refused = (res.refused || 0) + 1;
          res.errors.push({ path: it.path, reason: "模板含 Templater 语法且求值失败：" + made.reason });
          this.warnTemplateRefused(made.reason, tpl);
          continue;
        }
        var rendered = made.text;
        var parts = splitTemplate(rendered);
        var next;
        if (st.empty) {
          next = rendered;                                   /* 空笔记 = 直接套整套模板 */
          res.full++;
        } else {
          next = raw;
          if (st.needYaml) {
            next = parts.yaml + next.replace(/^\uFEFF/, "").replace(/^\n+/, "");
            res.yaml++;
          }
          if (st.needLinks) {
            next = next.replace(/\s*$/, "") + "\n\n" + parts.tail.replace(/^\n+/, "").replace(/\s*$/, "") + "\n";
            res.links++;
          }
        }
        await app.vault.process(f, function () { return next; });
        var key = tpl.id || "builtin";
        res.byTemplate[key] = (res.byTemplate[key] || 0) + 1;
        res.written.push({ path: it.path, template: key, rule: tpl.why || null,
          yaml: st.needYaml, links: st.needLinks, full: st.empty });
        progress({ phase: "autofill", done: i + 1, total: todo.plan.length, item: it.path });
      } catch (e) {
        res.errors.push({ path: it.path, error: String((e && e.message) || e) });
      }
    }
    res.ok = res.errors.length === 0;
    self.lastAutofill = res;
    return res;
  };
  /**
   * R11（boss 第 1 条）：手动拖动 / 搬文件（vault rename 事件）专用处理。
   * 语义 = 「人最后一次的意图说了算」：目录是事实，属性跟随目录 ——
   *   ① 锁定 / 排除目录 / 静默窗口照旧让路；
   *   ② 新目录仍在库根内 → 把「文件位置」同步成新目录（writeBack 开着时），
   *      中心链跟着修（fixCenterLink 开着时）；
   *   ③ 拖出库根 / 认不出 → 什么都不写，更不搬回。
   * 绝不调用路由搬家 —— 那正是「拖完被弹回去」的根源。
   */
  AutomationModule.prototype.handleManualMove = async function (file, oldPath) {
    if (!file || file.extension !== "md" || !(file.parent)) return;
    var Q = KB.services.quiet;
    if (Q && Q.isQuiet(this.plugin)) { Q.note(this.plugin); return; }
    if (this.busy.has(file)) return;
    this.busy.add(file);
    try {
      var S = this.plugin.settings;
      var util = KB.services["router.util"];
      var kbRoot = S.paths.knowledgeBase;
      var parentPath = file.parent.path;
      var inRoot = parentPath === kbRoot || parentPath.indexOf(kbRoot + "/") === 0;
      if (!inRoot) return;                       /* 拖出库根 → 不动也不回写 */
      if (this.router.isExcluded(parentPath)) return;
      var fm = this.fm.read(file);
      if (util.isLocked(fm)) return;             /* 位置锁定 → 一根手指都不动 */
      if (S.automation.writeBack !== false) {
        var want = util.canonical(parentPath, kbRoot);
        var prop = S.automation.property;
        var cur = util.firstProp(this.fm.read(file)[prop]);
        if (util.norm(cur, kbRoot) !== util.norm(want, kbRoot)) {
          await this.fm.update(file, function (f) { f[prop] = [want]; });
          this.stats.filled++;
        }
      }
      if (S.automation.fixCenterLink !== false) {
        var changed = await this.links.fixCenter(file, this.router.excl, kbRoot);
        if (changed) this.stats.center++;
      }
    } finally { this.busy.delete(file); }
  };
  /** handle：与 note-locator 语义一致（锁定 → 排除 → 解析 → 搬家 → 回填 → 中心链） */
  AutomationModule.prototype.handle = async function (file) {
    if (!file || file.extension !== "md" || !(file.parent)) return;
    /* R9：静默窗口内绝不动库（这是真正执行「搬家」的那一段）。 */
    var Q = KB.services.quiet;
    if (Q && Q.isQuiet(this.plugin)) { Q.note(this.plugin); return; }
    if (this.busy.has(file)) return;
    this.busy.add(file);
    try {
      var app = this.plugin.app;
      var util = KB.services["router.util"];
      var kbRoot = this.plugin.settings.paths.knowledgeBase;
      var fm = this.fm.read(file);
      if (util.isLocked(fm)) return;
      var parentPath = file.parent.path;
      if (this.router.isExcluded(parentPath)) return;

      var tags = (typeof obsidian.getAllTags === "function")
        ? (obsidian.getAllTags(app.metadataCache.getFileCache(file)) || [])
        : [];
      var hit = this.router.resolveTarget(fm, tags, parentPath, app);
      if (!hit) return;

      /* ---- 搬家 ---- */
      var res = await this.mover.move(file, hit.folder, { overwrite: "skip" });
      if (res.blocked) { this.stats.blocked++; return; }
      if (res.ok && !res.unchanged) this.stats.moved++;
      file = res.file;

      /* ---- 回填「文件位置」（列表值 → 胶囊） ---- */
      if (this.plugin.settings.automation.writeBack) {
        var want = util.canonical(hit.folder, kbRoot);
        var prop = this.plugin.settings.automation.property;
        var cur = util.firstProp(this.fm.read(file)[prop]);
        if (util.norm(cur, kbRoot) !== util.norm(want, kbRoot)) {
          await this.fm.update(file, function (f) { f[prop] = [want]; });
          this.stats.filled++;
        }
      }

      /* ---- 正文「所属中心」双链跟随目录 ---- */
      if (this.plugin.settings.automation.fixCenterLink) {
        var changed = await this.links.fixCenter(file, this.router.excl, kbRoot);
        if (changed) this.stats.center++;
      }
    } finally { this.busy.delete(file); }
  };
  KB.modules.AutomationModule = AutomationModule;
  return AutomationModule;
});

/* ===== 82_modules_rebuild.js ===== */
/* ① 新建知识库模块。
 * R4a：只读预览（plan → rebuild-preview.json + rebuild-manifest.json）
 * R4b：执行 / 回滚 / 状态，全部走「二次确认弹窗 → 确认后才动库」；执行过程写 rebuild-journal.json。
 * R6：三种操作都落一篇**可读的操作日志笔记**（见 66_services_report.js），Notice 改成多行明细，
 *     并给一条「打开最近一次报告」命令。
 * 危险操作一律不自动触发：命令 → 弹窗 → 勾选坚果云已同步 → 点确认。 */
KB.define("modules/rebuild", function () {
  var DIR = ".obsidian/plugins/kb-toolkit/";
  var PLUGDIR = DIR.replace(/\/+$/, "");
  var PREVIEW = DIR + "rebuild-preview.json";
  var MANIFEST = DIR + "rebuild-manifest.json";
  var JOURNAL = DIR + "rebuild-journal.json";

  var STATE_TEXT = { fresh: "未创建（顶层还有待归拢的文件）", partial: "半成品（新建根已存在，顶层仍有待搬项）", done: "已是已完成态" };

  class RebuildConfirmModal extends obsidian.Modal {
    constructor(plugin, mod, kind, pre) {
      super(plugin.app);
      this.plugin = plugin;
      this.mod = mod;
      this.kind = kind;                 /* "execute" | "rollback" */
      this.pre = pre || {};
      this.cloudSynced = false;
      this.onConfirm = null;
    }
    onOpen() {
      var self = this;
      var el = this.contentEl;
      var isRollback = this.kind === "rollback";
      var s = this.pre.summary || {};
      el.empty();
      el.createEl("h3", { text: "新建知识库 · " + (isRollback ? "回滚" : "执行") + "确认" });
      if (isRollback) {
        el.createEl("p", { text: "将按 rebuild-journal.json 逆序撤销 " + (s.entries || 0) + " 条记录：删除本轮新建的目录与种子文件，并把搬进「" + (s.oldFolder || KB.services.settings.DEFAULTS.rebuild.oldFolderName) + "」的内容搬回原位。" });
        el.createEl("p", { text: "底线：绝不覆盖原位置已有内容。**回滚前才出现在新库里的笔记不会丢** —— 会被请进一个单独的「" +
          (KB.services.settings.DEFAULTS.rebuild.rollbackKeepName || "回滚保留") + "-<时间戳>/」文件夹里，回滚照旧走完。" });
      } else {
        var arch = s.archive || {};
        var extra = s.reRebuild
          ? "这是**再次执行**：已有知识库原地保留（不搬），新库与它并列；旧文件区下分建「" +
            String(arch.prior || "").split("/").pop() + "」（装原有内容）与「" +
            String(arch.incoming || "").split("/").pop() + "」（装本次搬入）。"
          : "";
        el.createEl("p", { text: "将新建「" + s.root + "」；把顶层 " + s.moves + " 项搬进「" + s.oldFolder +
          "」；建 " + s.creates + " 个目录、" + s.seeds + " 篇种子文件。" });
        if (extra) el.createEl("p", { text: extra });
        el.createEl("p", { text: "本操作会移动库内文件（Obsidian 内部改名，不丢内容），执行失败即停，可用「回滚」还原。" });
      }
      var warn = this.pre.warnings || [];
      if (warn.length) {
        var wrap = el.createEl("div", { cls: "kb-rebuild-warn" });
        wrap.createEl("p", { text: "执行前请注意：" });
        var ul = wrap.createEl("ul");
        for (var i = 0; i < warn.length; i++) ul.createEl("li", { text: warn[i] });
      }
      var row = el.createEl("div", { cls: "kb-rebuild-confirm" });
      this.checkEl = row.createEl("input", { attr: { type: "checkbox" } });
      this.checkEl.addEventListener("change", function () {
        self.cloudSynced = !!self.checkEl.checked;
        self.syncButton();
      });
      row.createEl("span", { text: " 我已确认坚果云同步完成，并知晓本操作会移动库内文件" });
      var btns = el.createEl("div", { cls: "kb-rebuild-btns" });
      this.cancelEl = btns.createEl("button", { text: "取消" });
      this.cancelEl.addEventListener("click", function () { self.close(); });
      this.okEl = btns.createEl("button", { text: isRollback ? "确认回滚" : "确认执行", cls: "mod-warning" });
      this.okEl.addEventListener("click", function () { self.confirm(); });
      this.syncButton();
    }
    syncButton() {
      if (this.okEl) this.okEl.disabled = !this.cloudSynced;
    }
    /** 供按钮与测试调用：未勾选 → 拒绝并提示；勾选 → 关闭 + 触发 onConfirm */
    confirm() {
      if (!this.cloudSynced) {
        new obsidian.Notice("新建知识库：请先勾选「我已确认坚果云同步完成」。", 6000);
        return false;
      }
      var cb = this.onConfirm;
      this.close();
      if (cb) cb(true);
      return true;
    }
    onClose() { this.contentEl.empty(); }
  }

  function RebuildModule(plugin) {
    this.plugin = plugin;
    this.lastPlan = null;
    this.lastResult = null;
    this.lastPreflight = null;
    this.pendingManifest = null;
    this.pendingJournal = null;
    this.lastNotice = null;
    this.lastLogPath = null;      /* R6：最近一次操作日志笔记 */
  }

  RebuildModule.prototype.onEnable = async function () {
    /* R6 守卫：模块没开就不注册任何命令（设置页/命令面板两条路同时断掉） */
    if (this.plugin.settings.modules.rebuild !== true) return;
    var self = this;
    this._cmdIds = [];
    var add = function (id, name, cb) {
      self.plugin.addCommand({ id: id, name: name, callback: cb });
      self._cmdIds.push(id);
    };
    /* R13（boss：界面翻新）：命令面板只留高频 3 条 —— 预览 / 回滚 / 打开报告。
     * 「执行」必须走设置页（危险操作要在弹窗里勾选确认，不该从命令面板一键触发）；
     * 「查看状态」并入设置页状态横幅（自动读取）。 */
    add("rebuild-preview", "新建知识库：生成预览报告（只读）", async function () { await self.runPreview(); });
    add("rebuild-rollback", "新建知识库：回滚（按 journal）", async function () { await self.startConfirm("rollback"); });
    add("rebuild-open-report", "新建知识库：打开最近一次操作日志", async function () { await self.openLog(); });
  };
  RebuildModule.prototype.onDisable = async function () {
    this.pendingManifest = null;
    this.pendingJournal = null;
    this.removeCommands();
  };
  /** 停用模块时把命令摘掉（真机 API 在 app.commands.removeCommand；桩/旧版没有就跳过） */
  RebuildModule.prototype.removeCommands = function () {
    var cmds = this.plugin.app && this.plugin.app.commands;
    var ids = this._cmdIds || [];
    if (!cmds || typeof cmds.removeCommand !== "function") return 0;
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
      try { cmds.removeCommand("kb-toolkit:" + ids[i]); n++; } catch (e) { /* 摘不掉也不致命 */ }
    }
    return n;
  };
  RebuildModule.prototype.cfg = function () { return this.plugin.settings.rebuild; };
  RebuildModule.prototype.svc = function () { return new KB.services.rebuild(this.plugin.app); };
  RebuildModule.prototype.isOn = function () { return this.plugin.settings.modules.rebuild === true; };
  /**
   * R6 守卫：模块被关掉后，任何残留入口（命令面板、设置页残留回调、其它代码）都不许动库。
   * 一律 Notice 说明原因并返回 false，调用方直接 return。
   */
  RebuildModule.prototype.requireOn = function () {
    if (this.isOn()) return true;
    new obsidian.Notice("新建知识库已关闭 → 该操作不可用。\n请到「设置 → 知识库工具集 → 启用模块」打开「① 新建知识库」。", 9000);
    return false;
  };

  /* ---------- 落盘（全部写在插件目录，不碰笔记） ---------- */
  RebuildModule.prototype.writeJson = async function (path, obj) {
    var a = this.plugin.app.vault.adapter;
    if (!a || typeof a.write !== "function") return false;
    await a.write(path, JSON.stringify(obj, null, 1));
    return true;
  };
  RebuildModule.prototype.readJson = async function (path) {
    var a = this.plugin.app.vault.adapter;
    if (!a || typeof a.read !== "function") return null;
    try { return JSON.parse(await a.read(path)); } catch (e) { return null; }
  };
  RebuildModule.prototype.saveJournal = function (j) { return this.writeJson(JOURNAL, j); };

  /* ---------- R6：操作日志笔记 ---------- */
  RebuildModule.prototype.ensureFolder = async function (path) {
    var app = this.plugin.app;
    var segs = String(path).split("/").filter(function (s) { return s.length > 0; });
    var cur = "";
    for (var i = 0; i < segs.length; i++) {
      cur = cur ? cur + "/" + segs[i] : segs[i];
      if (app.vault.getAbstractFileByPath(cur)) continue;
      try { await app.vault.createFolder(cur); }
      catch (e) { return false; }
    }
    return true;
  };
  /**
   * 写一篇操作日志笔记。**尽力而为**：任何失败只告警，绝不影响重建主流程。
   * opts: { rootPath（写到哪个库根下，必须当前存在）, now }
   */
  RebuildModule.prototype.writeLogNote = async function (kind, payload, opts) {
    opts = opts || {};
    var app = this.plugin.app;
    try {
      if (opts.rootPath && !app.vault.getAbstractFileByPath(opts.rootPath))
        return { ok: false, reason: "root-missing" };
      var svc = this.svc();
      var rep = svc.reportMarkdown(kind, payload, {
        now: opts.now instanceof Date ? opts.now : new Date(),
        paths: this.plugin.settings.paths, pluginDir: PLUGDIR
      });
      var folder = KB.services.report.logFolder(this.plugin.settings.paths, opts.rootPath);
      if (!(await this.ensureFolder(folder))) return { ok: false, reason: "mkdir-failed" };
      var path = folder + "/" + rep.fileName;
      if (app.vault.getAbstractFileByPath(path)) {          /* 同一分钟重复触发 → 加序号，不覆盖 */
        var n = 2, cand = "";
        do { cand = folder + "/" + rep.fileName.replace(/\.md$/, " (" + n + ").md"); n++; }
        while (app.vault.getAbstractFileByPath(cand));
        path = cand;
      }
      var file = await app.vault.create(path, rep.markdown);
      this.lastLogPath = path;
      return { ok: true, path: path, file: file, report: rep };
    } catch (e) {
      console.warn("[kb-toolkit] 写操作日志失败", kind, e);
      return { ok: false, reason: String((e && e.message) || e) };
    }
  };
  /** 打开最近一次操作日志（命令入口） */
  RebuildModule.prototype.openLog = async function (path) {
    if (!this.requireOn()) return false;
    var app = this.plugin.app;
    var p = path || this.lastLogPath;
    if (!p) {
      new obsidian.Notice("新建知识库：还没有生成过操作日志。先执行「生成预览报告」或「查看状态」。", 9000);
      return false;
    }
    var f = app.vault.getAbstractFileByPath(p);
    if (!f) { new obsidian.Notice("新建知识库：找不到日志 " + p, 9000); return false; }
    try {
      var leaf = app.workspace && app.workspace.getLeaf ? app.workspace.getLeaf(false) : null;
      if (leaf && typeof leaf.openFile === "function") { await leaf.openFile(f); return true; }
    } catch (e) { /* 打不开就退回提示路径 */ }
    new obsidian.Notice("新建知识库：操作日志在 " + p, 9000);
    return false;
  };

  /** 原库根被搬进旧文件区之后的落点：<旧文件>/<库根> */
  RebuildModule.prototype.legacyRootPath = function () {
    var old = (this.cfg() && this.cfg().oldFolderName) || "旧文件";
    return old + "/" + this.plugin.settings.paths.knowledgeBase;
  };
  /**
   * R6：挑一个**当前真实存在**的库根来写报告（笔记在哪，报告就写哪）。
   * 按传入顺序取第一个存在的候选 —— 调用方决定优先级（预览偏好原库根，执行偏好新建根）。
   */
  RebuildModule.prototype.pickLogRoot = function (cands) {
    var app = this.plugin.app;
    for (var i = 0; i < (cands || []).length; i++) {
      var p = cands[i];
      if (p && app.vault.getAbstractFileByPath(p)) return p;
    }
    return null;
  };
  /** 预览/回滚：笔记此刻在原库根；原库根被搬走则去旧文件区找它；最后才是新建根 */
  RebuildModule.prototype.logRootPreferLive = function (newRoot) {
    return this.pickLogRoot([this.plugin.settings.paths.knowledgeBase, this.legacyRootPath(), newRoot]);
  };

  /* ---------- R4a：只读预览 ---------- */
  RebuildModule.prototype.runPreview = async function () {
    if (!this.requireOn()) return { ok: false, reason: "module-off" };
    var app = this.plugin.app;
    var svc = this.svc();
    var plan = await svc.plan(this.cfg());
    this.lastPlan = plan;
    var valid = svc.validateManifest(plan.manifest);
    plan.manifestValid = valid.ok;
    if (!valid.ok) plan.manifestErrors = valid.errors;
    var st = await svc.detectState({ rootName: plan.root, oldFolderName: plan.oldFolder,
      excludedTop: this.cfg().excludedTop, keepTop: this.cfg().keepTop });
    plan.state = st;
    await this.writeJson(PREVIEW, plan);
    await this.writeJson(MANIFEST, plan.manifest);       /* 执行只认这份 manifest */

    /* R6：落一篇可读的操作日志（写进「笔记当前实际所在」的库根） */
    var rootForLog = this.logRootPreferLive(plan.root);
    var log = rootForLog ? await this.writeLogNote("preview", { plan: plan, state: st }, { rootPath: rootForLog })
      : { ok: false, reason: "no-root" };

    var c = plan.counts;
    var lines = [];
    lines.push("新建知识库预览（只读：不搬不改，仅写报告）· 当前" + STATE_TEXT[st.state]);
    lines.push("新建根 " + plan.root + " ｜ 旧文件区 " + plan.oldFolder + (plan.mergeOld ? "（已存在 → 并入）" : "（将新建）"));
    if (plan.reRebuild) {
      var ar = plan.archive || {};
      lines.push("⚠️ 再次执行：已有知识库**原地保留**，新库与它并列；旧文件区分建「" +
        String(ar.prior || "").split("/").pop() + "」（原有内容 " + c.priorMoves + " 项）与「" +
        String(ar.incoming || "").split("/").pop() + "」（本次搬入）");
    }
    lines.push("计划搬运 " + c.moves + " 项（文件 " + c.fileMoves + " / 文件夹 " + c.folderMoves + "）");
    lines.push("新建目录 " + c.creates + " 个 · 种子 " + c.seeds + " 篇 · 冲突 " + c.conflicts + " · 排除 " + c.excluded);
    lines.push(plan.manifestValid ? "✅ manifest 自校验通过" : "❌ manifest 自校验未通过：" + (plan.manifestErrors || []).slice(0, 2).join("；"));
    if (log.ok) lines.push("📄 报告已写入：" + log.path);
    else lines.push("📄 完整报告：" + PREVIEW + "（未能写操作日志：" + log.reason + "）");
    new obsidian.Notice(lines.join("\n"), 15000);
    return plan;
  };

  /* ---------- R4b：执行（无 confirmed → 只返回预检结果，由命令层弹确认框） ---------- */
  RebuildModule.prototype.runExecute = async function (opts) {
    opts = opts || {};
    if (!this.requireOn()) return { ok: false, reason: "module-off" };
    var self = this, plugin = this.plugin;
    var svc = this.svc();
    var manifest = opts.manifest || await this.readJson(MANIFEST);
    var regenerated = false;

    /* R10-② 配置指纹比对：预览之后配置变过（典型：改了库根名）→ 旧 manifest 整体作废，
     * 按当前配置现算一份。旧版直接照旧 manifest 落库 → 改名后建出来的还是旧库名
     * （boss 第 2 条的真根因）。
     * 🔴 顺序：**先验结构、再比指纹**。反过来的话，坏 manifest（结构都不对）会被当成
     *     「配置变了」去重算一份新的，于是「坏 manifest 必须拒绝执行」这条硬门槛失效
     *     （r4b D 段抓到的就是这个）。指纹缺失（老 manifest / 上轮旧数据）= 不一致 → 重算。 */
    if (!manifest) {                                   /* 没预览过 → 现算一份（等价于自动预览） */
      var plan = await svc.plan(this.cfg());
      manifest = plan.manifest;
      await this.writeJson(MANIFEST, manifest);
      regenerated = true;
    } else {
      var mv = svc.validateManifest(manifest);
      if (!mv.ok) {                                    /* 有 manifest 但结构不对 → 不执行，让人重新预览 */
        new obsidian.Notice("新建知识库：rebuild-manifest.json 校验未通过 → 未执行，请重新生成预览。\n" +
          mv.errors.slice(0, 3).join("；"), 12000);
        return { ok: false, reason: "invalid-manifest", blocking: mv.errors };
      }
      var fpNow = svc.cfgFingerprint(this.cfg());
      if (manifest.cfgFingerprint !== fpNow) {
        var plan2 = await svc.plan(this.cfg());
        manifest = plan2.manifest;
        await this.writeJson(MANIFEST, manifest);
        regenerated = true;
        try { new obsidian.Notice("新建知识库：配置与上次预览不一致 → 已按当前配置重新生成计划。", 8000); }
        catch (e) { /* 测试环境无 Notice */ }
      }
    }
    var pre = await svc.preflight(manifest, this.cfg());
    this.lastPreflight = pre;

    if (!pre.ok) {
      new obsidian.Notice("新建知识库：manifest 校验未通过 → 未执行。\n" + pre.blocking.slice(0, 3).join("；"), 12000);
      return { ok: false, reason: "invalid-manifest", preflight: pre };
    }
    if (pre.alreadyDone) {
      new obsidian.Notice("新建知识库：已是完成态（新建根存在、顶层无待搬项）→ 不做任何事。", 8000);
      this.lastResult = { ok: true, reason: "already-rebuilt", preflight: pre };
      return this.lastResult;
    }
    if (opts.confirmed !== true || opts.cloudSynced !== true) {
      this.pendingManifest = manifest;
      return { ok: false, needConfirm: true, preflight: pre, regenerated: regenerated, manifest: manifest };
    }

    var notice = null;
    try { notice = new obsidian.Notice("新建知识库：开始执行…", 0); } catch (e) { notice = null; }
    var onProgress = function (p) {
      if (notice && typeof notice.setMessage === "function")
        notice.setMessage("新建知识库：" + p.phase + " " + p.done + "/" + p.total);
    };
    /* R9：整段执行期间开**静默窗口** —— ② 笔记自动化必须让路。不静默的话，它会把
     * manifest 刚搬进「旧文件」的东西按笔记里的「文件位置」属性再搬回新库
     * （老板报的第 6 条：有文件没有成功迁移整理）。 */
    KB.services.quiet.begin(plugin, "rebuild-execute");
    /* R9：把上一份**没被回滚过**的 journal 交给服务层继承（去重合并）。
     * 起因：第一次执行中途失败 → 第二次执行会新建一份 journal 覆盖它，第一次记下的
     * 「旧文件区是本轮建的」就丢了 → 回滚删不掉那个空目录，留下残渣（回滚不干净）。 */
    var prior = await this.readJson(JOURNAL);
    var res = null;
    try {
      res = await svc.execute(manifest, {
        cfg: this.cfg(),
        settings: this.plugin.settings,   /* R10-④：默认模板要按当前配置算模板库目录 */
        idempotent: opts.idempotent !== false,
        carry: prior,
        date: opts.date || this.cfg().seedDate || "",
        saveJournal: function (j) { return self.saveJournal(j); },
        onProgress: onProgress
      });
    } finally {
      /* 收工不能立刻放行：事件总线里可能还排着 ≤800ms 的批次，关窗后落地照样出错。
       * end() 把放行时刻推到 now + SETTLE_MS(1200ms)，给它们留出过期时间。 */
      KB.services.quiet.end(plugin);
      if (notice && typeof notice.hide === "function") notice.hide();
    }
    this.lastResult = res;
    this.lastManifest = manifest;
    this.pendingManifest = null;

    /* R6：执行报告优先写进**新建根**（原库已被搬走，这里才安全）；
     * 新建根还没建出来（早期就中断）→ 退回**原库根**，让中断现场留个记录。
     * 只有写在新建根里的那份才登记为可逆（op:"log"）—— 它不删掉，新建根就删不干净；
     * 写在原库根的属于**留档**，回滚不该把它抹掉。 */
    var log = { ok: false, reason: "skipped" };
    if (res.status === "done" || res.status === "failed") {
      /* 执行完成后笔记己经在新库 → 优先进新库；早期中断（新库还没建出来）→ 退回原库根 / 旧文件区 */
      var logRoot = this.pickLogRoot([manifest.root,
        this.plugin.settings.paths.knowledgeBase, this.legacyRootPath()]);
      if (!logRoot) log = { ok: false, reason: "no-root" };
      else {
        log = await this.writeLogNote("execute", { manifest: manifest, result: res },
          { rootPath: logRoot, now: opts.now });
        var insideNewRoot = log.ok && log.path.indexOf(manifest.root + "/") === 0;
        if (insideNewRoot && res.journal && res.journal.entries) {
          res.journal.entries.push({ op: "log", path: log.path });
          await this.saveJournal(res.journal);
        }
      }
    }

    if (res.status === "done") {
      var ls = [];
      ls.push("新建知识库完成 · 新建 " + manifest.root);
      ls.push("搬运 " + (manifest.moves || []).length + " 项 · 建目录 " + (manifest.creates || []).length +
        " · 种子 " + (manifest.seeds || []).length);
      ls.push("跳过 " + res.skipped.length + " · 阻止 " + res.blocked.length);
      ls.push(log.ok ? "📄 执行报告：" + log.path : "📄 日志：" + JOURNAL);
      ls.push("不满意可「回滚」（设置页 ① → 回滚）");
      new obsidian.Notice(ls.join("\n"), 15000);
    } else if (res.status === "failed") {
      new obsidian.Notice("新建知识库中断于「" + res.failedAt + "」：" + res.error +
        "\n已执行的部分**不会**自动回滚（失败现场留着）；看过日志后再决定是否回滚。" +
        (log.ok ? "\n📄 中断报告：" + log.path : "\n📄 日志：" + JOURNAL), 18000);
    }
    return res;
  };

  /* ---------- R4b：回滚 ---------- */
  RebuildModule.prototype.runRollback = async function (opts) {
    opts = opts || {};
    if (!this.requireOn()) return { ok: false, reason: "module-off" };
    var self = this;
    var svc = this.svc();
    var journal = opts.journal || await this.readJson(JOURNAL);
    if (!journal || !journal.entries || !journal.entries.length) {
      new obsidian.Notice("新建知识库：没有可回滚的记录（rebuild-journal.json 不存在或为空）。", 8000);
      return { ok: false, reason: "no-journal" };
    }
    if (journal.status === "rolled-back") {
      new obsidian.Notice("新建知识库：该记录已回滚过 → 不做任何事。", 8000);
      return { ok: true, reason: "already-rolled-back" };
    }
    var summary = { root: journal.root, oldFolder: journal.oldFolder,
      entries: journal.entries.length, status: journal.status };
    if (opts.confirmed !== true || opts.cloudSynced !== true) {
      this.pendingJournal = journal;
      return { ok: false, needConfirm: true, kind: "rollback", summary: summary, journal: journal };
    }

    /* R9：回滚全程开**静默窗口**。不静默的话，阶段 A 把外来户 rename 进
     * 「回滚保留-<戳>/」会触发 rename 事件 → ② 的路由按笔记里的「文件位置」属性
     * 立刻把它搬回新库 → 收容白做、目录仍旧非空 → 回滚卡在「目录非空」
     * （老板报的第 5/7 条的真根因）。 */
    KB.services.quiet.begin(this.plugin, "rebuild-rollback");
    var res = null;
    try {
      res = await svc.rollback(journal, {
        force: opts.force === true,
        cfg: this.cfg(),
        now: opts.now,
        keepName: opts.keepName,
        saveJournal: function (j) { return self.saveJournal(j); }
      });
    } finally {
      KB.services.quiet.end(this.plugin);   /* 再挂 SETTLE_MS，让排队中的事件过期 */
    }
    var manifest = this.lastManifest || await this.readJson(MANIFEST) || { moves: [], root: journal.root };
    var verify = await svc.verifyRestored(manifest);
    res.verify = verify;
    this.lastResult = res;
    this.pendingJournal = null;

    /* R6：回滚报告写回**原库根**（此时它已恢复存在） */
    var logRoot = this.logRootPreferLive(journal.root);
    var log = logRoot ? await this.writeLogNote("rollback", { journal: journal, result: res, verify: verify },
      { rootPath: logRoot, now: opts.now }) : { ok: false, reason: "no-root" };

    if (res.ok && verify.ok) {
      var ls = [];
      ls.push("新建知识库回滚完成");
      ls.push("还原 " + res.restored.length + " 项 · 跳过 " + res.skipped.length + " · 阻止 " + res.blocked.length);
      ls.push("已逐篇 sha256 核对搬运内容一致");
      var q = res.quarantine || {};
      if (q.moved && q.moved.length)
        ls.push("📦 回滚前才出现的 " + q.moved.length + " 项已保留在「" + q.folder + "/」（一篇没丢）");
      if (log.ok) ls.push("📄 回滚报告：" + log.path);
      new obsidian.Notice(ls.join("\n"), 16000);
    } else {
      new obsidian.Notice("新建知识库回滚未完全成功：还原 " + res.restored.length + "，阻止 " +
        res.blocked.length + "，错误 " + res.errors.length +
        (verify.bad.length ? "\n自检：" + verify.bad.slice(0, 3).join("；") : "") +
        (log.ok ? "\n📄 回滚报告：" + log.path : ""), 18000);
    }
    return res;
  };

  /* ---------- 状态 ---------- */
  RebuildModule.prototype.runStatus = async function (verbose) {
    if (!this.requireOn()) return { ok: false, reason: "module-off" };
    var svc = this.svc();
    var st = await svc.detectState(this.cfg());
    var journal = await this.readJson(JOURNAL);
    var manifest = await this.readJson(MANIFEST);
    var info = {
      state: st,
      journal: journal ? { status: journal.status, entries: (journal.entries || []).length,
        failedAt: journal.failedAt || null, error: journal.error || null } : null,
      manifest: manifest ? { root: manifest.root, moves: (manifest.moves || []).length,
        creates: (manifest.creates || []).length, seeds: (manifest.seeds || []).length,
        generatedAt: manifest.generatedAt } : null
    };
    if (verbose) {
      var txt = "新建知识库状态：" + STATE_TEXT[st.state] + "（顶层待搬 " + st.movableCount + " 项）";
      if (info.manifest) txt += "\nmanifest：→ " + info.manifest.root + "，搬 " + info.manifest.moves + " 项";
      else txt += "\n尚未生成 manifest";
      if (info.journal) txt += "\n上次日志：" + info.journal.status +
        (info.journal.failedAt ? "（中断于 " + info.journal.failedAt + "）" : "");
      txt += "\n最近报告：" + (this.lastLogPath || "（本次会话内还没生成过）");
      new obsidian.Notice(txt, 14000);
    }
    return info;
  };

  /* ---------- 命令入口：先预检，再弹确认框 ---------- */
  RebuildModule.prototype.startConfirm = async function (kind) {
    if (!this.requireOn()) return { ok: false, reason: "module-off" };
    var self = this;
    var pre, summary;
    if (kind === "rollback") {
      var r = await this.runRollback();
      if (!r.needConfirm) return r;
      summary = r.summary;
      pre = { summary: summary, warnings: [] };
    } else {
      var e = await this.runExecute();
      if (!e.needConfirm) return e;
      pre = e.preflight;
    }
    var modal = new RebuildConfirmModal(this.plugin, this, kind, pre);
    modal.onConfirm = function (cloudSynced) {
      if (kind === "rollback") return self.runRollback({ confirmed: true, cloudSynced: cloudSynced, journal: self.pendingJournal });
      return self.runExecute({ confirmed: true, cloudSynced: cloudSynced, manifest: self.pendingManifest });
    };
    modal.open();
    this.lastModal = modal;
    return { ok: true, opened: true, preflight: pre };
  };
  RebuildModule.prototype.buildConfirmModal = function (kind, pre) {
    return new RebuildConfirmModal(this.plugin, this, kind, pre);
  };

  KB.modules.RebuildModule = RebuildModule;
  KB.modules.RebuildConfirmModal = RebuildConfirmModal;
  KB.modules.REBUILD_FILES = { PREVIEW: PREVIEW, MANIFEST: MANIFEST, JOURNAL: JOURNAL };
  return RebuildModule;
});

/* ===== 85_modules_base.js ===== */
/* ③ 更多的 Base：两个 Bases 视图模块 —— 内嵌原件字节不变，VIEW_TYPE 原样保留。
 * onEnable：先停用同名旧插件（防同一视图类型双注册）→ 以隔离 manifest 实例化内嵌插件。
 *
 * 🔴 R9：视图注册必须是**幂等**的，否则「拨一次 ③ 的开关」就弹错（老板报的第 3 条）。
 * 证据链（obsidian.asar 取证）：
 *   ① Plugin.registerBasesView(id,reg) = bases.registerView(id,reg) + this.register(()=>bases.deregisterView(id))
 *      → **注销动作是挂在 Component 的 _events 上的**，只有 load()/unload() 生命周期才会执行它；
 *   ② BasesView.registerView(id) 发现 registrations 里已有该 id 时，只弹
 *      `msgErrorRegisterView`（"Unable to add new Bases view \"<id>\". A view with this ID already exists."），
 *      **不覆盖**原有注册 —— 于是那个视图永远绑在旧的死实例上；
 *   ③ 旧实现只调 inst.onload() / inst.onunload()，**从不走 load()/unload()** →
 *      _loaded 恒为 false、_events 里的 disposer 永不执行 → deregisterView 永远不被调用
 *      → registry.refresh() 重启用（或手动拨开关）时撞名弹错。
 * 双保险：① 生命周期改走 load()/unload()（会跑 disposer，顺带收掉设置页等泄漏）；
 *         ② 注册前先注销同名 id（哪怕某条路径漏了，也不会再弹错）。 */
KB.define("modules/base", function () {
  /* R15 修：disablePlugin 异步不等 → 改为内部 await（本函数变 async，调用侧不变），
   * 压缩「旧插件还没卸干净、新视图已注册」的窗口 */
  async function retire(plugin, id) {
    try {
      var pm = plugin.app.plugins;
      if (!pm || !pm.enabledPlugins || !pm.enabledPlugins.has(id)) return false;
      var r = pm.disablePlugin(id);
      if (r && typeof r.then === "function") { try { await r; } catch (e2) {} }
      plugin.retiredLegacy = plugin.retiredLegacy || [];
      plugin.retiredLegacy.push(id);
      new obsidian.Notice("知识库工具集：「" + id + "」功能已内置，旧插件已自动停用（可在第三方插件列表重新打开）。", 8000);
      return true;
    } catch (e) { console.warn("[kb-toolkit] 停用旧插件失败", id, e); return false; }
  }
  function makeManifest(id, dir, name, version) {
    return { id: id, dir: dir, name: name, version: version, minAppVersion: "1.9.0", author: "阿盘（自研·内嵌）" };
  }
  /**
   * R12（boss 第 7 条）：第三方插件列表多出「创作看板（Bases 视图）」一栏的真根因 ——
   * 内嵌看板 onload 里 `this.addSettingTab(...)`（vendor 3943 行），PluginSettingTab 的
   * 导航名取自内嵌 manifest.name → 设置页左侧栏多出一个幽灵入口。
   * 内嵌实例的功能入口是本插件的设置页，自己那份不许再注册。
   */
  function suppressSettingTab(inst) {
    if (!inst || inst.__kbNoTab) return inst;
    inst.__kbNoTab = true;
    inst.addSettingTab = function () { return null; };
    return inst;
  }
  /** 拿到核心插件 Bases 的视图注册表（拿不到返回 null） */
  function basesOf(app) {
    try {
      var ip = app && app.internalPlugins;
      return (ip && typeof ip.getEnabledPluginById === "function")
        ? ip.getEnabledPluginById("bases") : null;
    } catch (e) { return null; }
  }
  /** 把要注销的视图 id 记在 plugin 上，onDisable 时兜底再注销一次 */
  function rememberView(plugin, id) {
    if (!plugin.kbRegisteredViews) plugin.kbRegisteredViews = [];
    if (plugin.kbRegisteredViews.indexOf(id) < 0) plugin.kbRegisteredViews.push(id);
  }
  /** 幂等化 registerBasesView：注册前先注销同名 id（不覆盖别人的注册，只是给路） */
  function patchViewRegistration(inst, plugin) {
    if (!inst || inst.__kbSafeReg || typeof inst.registerBasesView !== "function") return inst;
    var orig = inst.registerBasesView;
    inst.__kbSafeReg = true;
    inst.registerBasesView = function (vid, reg) {
      try {
        var bases = basesOf(this.app);
        if (bases && typeof bases.deregisterView === "function") {
          var regs = bases.registrations || (typeof bases.getRegistrations === "function" ? bases.getRegistrations() : {}) || {};
          if (Object.prototype.hasOwnProperty.call(regs, vid)) bases.deregisterView(vid);
        }
      } catch (e) { console.warn("[kb-toolkit] 注销同名 Bases 视图失败（继续注册）", vid, e); }
      var r = null;
      try { r = orig.call(this, vid, reg); } catch (e2) { console.error("[kb-toolkit] 注册 Bases 视图失败", vid, e2); }
      rememberView(plugin, vid);
      return r;
    };
    return inst;
  }
  /** 生命周期：优先 load()/unload()（会执行 this.register 收集的 disposer），退回 onload()/onunload() */
  async function loadInstance(inst) {
    if (!inst) return false;
    if (typeof inst.load === "function") {
      try { await inst.load(); return true; }
      catch (e) { console.warn("[kb-toolkit] 内嵌插件 load() 失败，退回 onload()", e); }
    }
    if (typeof inst.onload === "function") { await inst.onload(); return true; }
    return false;
  }
  async function unloadInstance(inst) {
    if (!inst) return false;
    if (typeof inst.unload === "function") {
      try { inst.unload(); return true; }
      catch (e) { console.warn("[kb-toolkit] 内嵌插件 unload() 失败，退回 onunload()", e); }
    }
    if (typeof inst.onunload === "function") { await inst.onunload(); return true; }
    return false;
  }
  /** 兜底：把本模块注册过的视图 id 显式注销（unload 的 disposer 万一没跑到） */
  function deregisterRemembered(plugin) {
    var ids = plugin.kbRegisteredViews || [];
    if (!ids.length) return 0;
    var bases = basesOf(plugin.app), n = 0;
    for (var i = 0; i < ids.length; i++) {
      try {
        if (bases && typeof bases.deregisterView === "function") { bases.deregisterView(ids[i]); n++; }
      } catch (e) { /* 注销失败不致命 */ }
    }
    plugin.kbRegisteredViews = [];
    return n;
  }

  /** 创作看板：VIEW_TYPE = creation-board（原样） */
  function BoardModule(plugin) { this.plugin = plugin; }
  /**
   * R8：创作看板「默认展示整个笔记库」。
   * 看板自己的「排除目录」来自它的插件级设置（自带默认写死 `excludeFolders: "99_Meta"`，
   * 于是默认就挡掉元目录）。我们**不改 vendor 一个字节**，改成：把 kb-toolkit 设置里的值
   * 推给这个内嵌实例（写它自己的 data.json → 重载它的设置）。默认值是空串 = 不排除 = 整个笔记库。
   * 🔴 短路判据必须看「data.json 里有没有这个键」，不能看"取出来的值等于不想要的值"：
   *    没有这个键时读出来也是空串，若就此 return，看板的内部默认 `"99_Meta"` 根本没被压掉，
   *    老板要的「默认整个库」就会落空（这里踩过一次）。
   * 🔴 R9：`saveData` 在目标插件目录**不存在**时会静默失败（asar 取证：writePluginData →
   *    writeJson → adapter.write → fsPromises.writeFile，**不 mkdir** 且 writeJson 吞 ENOENT）。
   *    所以写前先确保 `.obsidian/plugins/<id>/` 存在，写完**回读核对**。
   */
  BoardModule.prototype.applyBoardExclude = async function () {
    var inst = this.inst;
    if (!inst || typeof inst.saveData !== "function") return false;
    var want = this.plugin.settings.modules["base.boardExclude"];
    if (typeof want !== "string") want = "";
    try {
      var d = (typeof inst.loadData === "function") ? await inst.loadData() : null;
      var had = !!(d && typeof d === "object" && !Array.isArray(d)
        && Object.prototype.hasOwnProperty.call(d, "excludeFolders"));
      if (had && String(d.excludeFolders) === want) return false;   /* 已一致 → 不重复写盘 */
      if (!had || !d || typeof d !== "object" || Array.isArray(d)) d = {};
      d.excludeFolders = want;
      await this.ensurePluginDir(inst);
      await inst.saveData(d);
      if (typeof inst.loadSettings === "function") await inst.loadSettings();
      return true;
    } catch (e) {
      console.warn("[kb-toolkit] 同步创作看板「排除目录」失败", e);
      return false;
    }
  };
  /** R9：saveData 不会帮你建目录 —— 目标插件目录不存在时先建出来，否则写盘静默失败 */
  BoardModule.prototype.ensurePluginDir = async function (inst) {
    try {
      var dir = inst && inst.manifest && inst.manifest.dir;
      if (!dir) return false;
      var ad = this.plugin.app.vault.adapter;
      if (!ad || typeof ad.exists !== "function" || typeof ad.mkdir !== "function") return false;
      if (await ad.exists(dir)) return false;
      await ad.mkdir(dir);
      return true;
    } catch (e) { console.warn("[kb-toolkit] 建内嵌插件目录失败", e); return false; }
  };
  /** 配置一变就地重配（设了排除目录 / 改了值 → 立刻推给看板） */
  BoardModule.prototype.onConfigure = function () { return this.applyBoardExclude(); };
  BoardModule.prototype.onEnable = async function () {
    var Old = KB.modules.CreationBoardPlugin;
    if (typeof Old !== "function") throw new Error("内嵌 creation-board 缺失");
    retire(this.plugin, "creation-board");
    this.inst = new Old(this.plugin.app, makeManifest(
      "creation-board", ".obsidian/plugins/kb-toolkit/embed-creation-board", "创作看板（Bases 视图）", "0.1.0"));
    /* R12：data.json 桥不再写 `.obsidian/plugins/creation-board/` —— 那个目录每次启用都被
     * ensureFolder 建回来（OneDrive 还会把它同步复活），看起来就像「删不掉的幽灵插件」。
     * 挪进本插件目录下（内嵌实例的 loadData/saveData 都按 manifest.dir 走）。 */
    suppressSettingTab(this.inst);
    patchViewRegistration(this.inst, this.plugin);
    await loadInstance(this.inst);
    await this.applyBoardExclude();
  };
  BoardModule.prototype.onDisable = async function () {
    var inst = this.inst;
    this.inst = null;
    await unloadInstance(inst);
    deregisterRemembered(this.plugin);
  };

  /** 内容流视图：VIEW_TYPE = note-stream（原样） */
  function StreamModule(plugin) { this.plugin = plugin; }
  StreamModule.prototype.onEnable = async function () {
    var Old = KB.modules.BasesPreviewPlugin;
    if (typeof Old !== "function") throw new Error("内嵌 bases-preview 缺失");
    retire(this.plugin, "bases-preview");
    this.inst = new Old(this.plugin.app, makeManifest(
      "bases-preview", ".obsidian/plugins/kb-toolkit/embed-bases-preview", "笔记内容流（Bases 预览）", "1.0.0"));
    suppressSettingTab(this.inst);
    patchViewRegistration(this.inst, this.plugin);
    await loadInstance(this.inst);
  };
  StreamModule.prototype.onDisable = async function () {
    var inst = this.inst;
    this.inst = null;
    await unloadInstance(inst);
    deregisterRemembered(this.plugin);
  };

  KB.modules.BoardModule = BoardModule;
  KB.modules.StreamModule = StreamModule;
  return { BoardModule: BoardModule, StreamModule: StreamModule };
});

/* ===== 87_modules_wizard.js ===== */
/* R5：首次使用向导。目标 = 让一个陌生人（或换库的老板）在 30 秒内把「库根名 / 元目录名 / 开哪几个模块」定下来，
 * 而不是去 data.json 里翻字段。只在 settings.wizardDone !== true 时自动弹一次，设置页可随时重开。
 * 全部用原生组件，无自定义 CSS。 */
KB.define("modules/wizard", function () {

  /** 现场检测：库根在不在、旧文件区在不在、顶层有多少待搬项 */
  function detect(plugin) {
    var app = plugin.app, S = plugin.settings;
    var root = null, old = null, tops = [];
    try {
      root = app.vault.getAbstractFileByPath(S.paths.knowledgeBase);
      old = app.vault.getAbstractFileByPath(S.rebuild.oldFolderName);
      var kids = (app.vault.getRoot() && app.vault.getRoot().children) || [];
      var skip = (S.rebuild.excludedTop || []).concat([S.rebuild.oldFolderName, "旧文件"]);
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i].name || kids[i].path;
        if (skip.indexOf(n) >= 0) continue;
        if (n.charAt(0) === ".") continue;
        tops.push(n);
      }
    } catch (e) { /* 检测失败不影响向导可用 */ }
    return { rootExists: !!root, oldExists: !!old, tops: tops };
  }

  function summary(plugin) {
    var S = plugin.settings, d = detect(plugin);
    return {
      knowledgeBase: S.paths.knowledgeBase,
      metaDir: S.paths.metaDir,
      rootExists: d.rootExists,
      oldExists: d.oldExists,
      topCount: d.tops.length,
      topSample: d.tops.slice(0, 5)
    };
  }

  class WizardModal extends obsidian.Modal {
    constructor(app, plugin) {
      super(app);
      this.plugin = plugin;
      this.draft = {
        knowledgeBase: plugin.settings.paths.knowledgeBase,
        metaDir: plugin.settings.paths.metaDir,
        modules: {
          rebuild: plugin.settings.modules.rebuild === true,
          automation: plugin.settings.modules.automation === true,
          base: plugin.settings.modules.base !== false
        }
      };
    }
    onOpen() {
      var self = this, el = this.contentEl;
      var D = KB.services.settings.DEFAULTS.paths;
      el.empty();
      el.createEl("h2", { text: "知识库工具集 · 初次设置" });
      el.createEl("p", { cls: "setting-item-description",
        text: "三步定好：知识库叫什么、开哪几个模块、现在库里是什么状况。全程只读，点「保存」才会写入配置。" });

      /* ① 目录名 */
      el.createEl("h3", { text: "① 知识库叫什么" });
      el.createEl("p", { cls: "setting-item-description",
        text: "「知识库根目录」= 笔记实际存放的顶层目录，也是「新建知识库」建出来的那个目录的名字 —— " +
          "两处共用一个名字，不会各说各话。以后在设置页改它也随时生效。" });
      new obsidian.Setting(el)
        .setName("知识库根目录").setDesc("笔记实际存放的顶层目录，如 " + D.knowledgeBase)
        .addText(function (t) { t.setPlaceholder(D.knowledgeBase)
          .setValue(self.draft.knowledgeBase)
          .onChange(function (v) { self.draft.knowledgeBase = String(v || "").trim(); }); });
      new obsidian.Setting(el)
        .setName("元数据目录名（相对知识库根）").setDesc("模板、指令集、索引所在目录，如 " + D.metaDir)
        .addText(function (t) { t.setPlaceholder(D.metaDir)
          .setValue(self.draft.metaDir)
          .onChange(function (v) { self.draft.metaDir = String(v || "").trim(); }); });

      /* ② 模块 */
      el.createEl("h3", { text: "② 开哪几个模块" });
      var MODS = [
        { key: "rebuild",    name: "① 新建知识库", desc: "预览 · 执行 · 回滚。默认关：它会搬动库里的文件，先看预览再开。" },
        { key: "automation", name: "② 笔记自动化", desc: "新笔记自动补全 · 按属性/标签归位 · 属性下拉候选（启用后旧的 note-locator 会被自动停用，避免双跑）。" },
        { key: "base",       name: "③ 更多的 Base", desc: "创作看板 + 内容流视图。只是换个看法，不动文件，默认开。" }
      ];
      for (var i = 0; i < MODS.length; i++) {
        (function (m) {
          new obsidian.Setting(el).setName(m.name).setDesc(m.desc)
            .addToggle(function (t) { t.setValue(self.draft.modules[m.key] === true)
              .onChange(function (v) { self.draft.modules[m.key] = v; }); });
        })(MODS[i]);
      }

      /* ③ 现场检测 */
      var d = detect(this.plugin);
      var box = el.createEl("div", { cls: "setting-item-description" });
      box.createEl("h3", { text: "③ 现场检测（只读，不改任何文件）" });
      var ul = box.createEl("ul");
      ul.createEl("li", { text: "知识库根「" + this.plugin.settings.paths.knowledgeBase + "」：" + (d.rootExists ? "已存在" : "不存在（新建时新建）") });
      ul.createEl("li", { text: "旧文件区「" + this.plugin.settings.rebuild.oldFolderName + "」：" + (d.oldExists ? "已存在 → 执行走并入模式" : "不存在") });
      ul.createEl("li", { text: "顶层待搬 " + d.tops.length + " 项" + (d.tops.length ? "（" + d.tops.slice(0, 5).join("、") + (d.tops.length > 5 ? "…" : "") + "）" : "") });

      /* 按钮 */
      var row = el.createEl("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.justifyContent = "flex-end";
      row.style.marginTop = "16px";
      var bOk = row.createEl("button", { text: "保存并立即生效", cls: "mod-cta" });
      bOk.addEventListener("click", function () { self.save(); });
      var bLater = row.createEl("button", { text: "以后再说" });
      bLater.addEventListener("click", function () {
        self.plugin.settings.wizardDone = true;          /* 不再自动弹；设置页仍可重开 */
        KB.services.settings.saveSettings(self.plugin);
        self.close();
      });
    }
    save() {
      var self = this;
      var S = this.plugin.settings;
      var prev = { knowledgeBase: S.paths.knowledgeBase, metaDir: S.paths.metaDir,
                   legacyDirs: (S.paths.legacyDirs || []).slice() };
      if (this.draft.knowledgeBase) S.paths.knowledgeBase = this.draft.knowledgeBase;
      if (this.draft.metaDir) S.paths.metaDir = this.draft.metaDir;
      KB.services.settings.reapplyPaths(S, prev);
      KB.services["router.util"].applySettings(S);
      S.modules.rebuild = this.draft.modules.rebuild;
      S.modules.automation = this.draft.modules.automation;
      S.modules.base = this.draft.modules.base;
      S.wizardDone = true;
      this.close();
      /* R7：向导保存**必须当场生效**。旧版只写 settings，模块实例与设置页都还是老的 →
       * 老板看到的是「存了像没存，得重载一次」。现在统一走 applySettingsChange：
       * 模块真起/真停 + 在跑的模块按新库根重配 + 正开着的设置页重画。 */
      var apply = KB.modules.applySettingsChange;
      var p = apply ? apply(this.plugin) : KB.services.settings.saveSettings(this.plugin);
      return Promise.resolve(p).then(function () {
        return KB.services.settings.saveSettings(self.plugin);
      }).then(function () {
        new obsidian.Notice("知识库工具集：初次设置已保存并已生效（库根 " + S.paths.knowledgeBase +
          "，模块开关已即时切换）。", 9000);
        return true;
      }, function (e) {
        new obsidian.Notice("知识库工具集：设置已写入，但生效过程出错：" + ((e && e.message) || e), 9000);
        return false;
      });
    }
  }

  function openWizard(plugin) { new WizardModal(plugin.app, plugin).open(); }
  /** 仅在没走过向导时自动弹（onload 调用） */
  function maybeShowWizard(plugin) {
    if (plugin.settings.wizardDone === true) return false;
    openWizard(plugin);
    return true;
  }

  KB.modules.WizardModal = WizardModal;
  KB.modules.openWizard = openWizard;
  KB.modules.maybeShowWizard = maybeShowWizard;
  KB.modules.wizardDetect = detect;
  KB.modules.wizardSummary = summary;
  return WizardModal;
});

/* ===== 90_entry.js ===== */
/* 入口：KbToolkitPlugin。onload 第一件事不 await 重量级操作；
 * R1 阶段只装设置页 + 事件总线 + 模块注册表（automation 默认关）。
 * R6：加侧边栏图标（boss 要求「装上就该在侧栏看到入口」），点击 = 打开设置控制台。 */
KB.define("entry", function () {
  var P = KB.services;
  var RIBBON_ICON = "library";
  var RIBBON_TITLE = "知识库工具集：打开控制台";

  /** 打开本插件的设置页；拿不到设置页 API 就退回提示（绝不静默失败） */
  function openSettings(plugin) {
    var app = plugin.app;
    try {
      var st = app && app.setting;
      if (st && typeof st.open === "function" && typeof st.openTabById === "function") {
        st.open();
        st.openTabById(plugin.manifest && plugin.manifest.id ? plugin.manifest.id : "kb-toolkit");
        return true;
      }
    } catch (e) { console.warn("[kb-toolkit] 打开设置页失败", e); }
    new obsidian.Notice("知识库工具集：请到「设置 → 第三方插件 → 知识库工具集」打开控制台。", 9000);
    return false;
  }
  KB.modules.openSettings = openSettings;
  KB.modules.RIBBON_ICON = RIBBON_ICON;

  /**
   * R7：别处（向导、命令）改了配置之后，把**正开着的设置页**重画一遍。
   * 不重画的话页面还显示着老库根名 / 老开关位置，用户以为没保存。
   */
  function refreshSettingTab(plugin) {
    try {
      var tab = plugin && plugin.settingTab;
      if (tab && typeof tab.display === "function" && tab.containerEl) { tab.display(); return true; }
    } catch (e) { console.warn("[kb-toolkit] 重画设置页失败", e); }
    return false;
  }
  KB.modules.refreshSettingTab = refreshSettingTab;

  /**
   * R7：配置落地后的统一收口 —— 落盘 + 让模块真起/真停（refresh）+ 让在跑的模块换脑子（reapply）+ 重画设置页。
   * 向导保存、设置页改路径、拨开关三条路都走这一个函数，避免「有的地方同步了、有的地方忘了」。
   * R8：opts.repaint === false 时**不重画设置页** —— 文本框失焦落库时重画会把正在输入的框换掉
   *     （这就是「一次只能输一个字符」的根因）。此时由调用方就地更新那一行的说明文案。
   * R10-⑤：**必须在这里落盘**。旧版只 refresh+reapply，而设置页三处（路径 / 模块开关 /
   *     看板排除目录）都因本函数存在而跳过了自己的 saveSettings → 改动只活在内存里，
   *     重载插件就丢（boss 第 5 条排查实锤）。落盘失败不阻断模块重配。 */
  function applySettingsChange(plugin, opts) {
    opts = opts || {};
    var reg = plugin && plugin.registry, changed = [];
    return KB.services.settings.saveSettings(plugin).catch(function (e) {
      console.warn("[kb-toolkit] 配置落盘失败", e);
      return null;
    }).then(function () {
      return (reg && reg.refresh) ? reg.refresh() : [];
    }).then(function (c) {
      changed = c || [];
      return (reg && reg.reapply) ? reg.reapply() : [];
    }).then(function (reconfigured) {
      if (opts.repaint !== false) refreshSettingTab(plugin);
      return { changed: changed, reconfigured: reconfigured || [], repainted: opts.repaint !== false, saved: true };
    });
  }
  KB.modules.applySettingsChange = applySettingsChange;

  class KbToolkitPlugin extends obsidian.Plugin {
    async onload() {
      var S = P.settings;
      await S.loadSettings(this);
      /* R5：中心表由结构模板推导（库根改名后自动跟随），必须先应用再起模块 */
      if (P["router.util"]) P["router.util"].applySettings(this.settings);

      this.eventBus = new P.eventBus(this);
      var Registry = P.registry;
      this.registry = new Registry(this);
      this.registry.define("automation", KB.modules.AutomationModule);
      this.registry.define("rebuild", KB.modules.RebuildModule);
      this.registry.define("board", KB.modules.BoardModule);
      this.registry.define("stream", KB.modules.StreamModule);

      this.settingTab = new KB.modules.SettingTab(this.app, this);
      this.addSettingTab(this.settingTab);

      /* R6：侧边栏图标（点击 → 设置控制台） */
      try {
        if (typeof this.addRibbonIcon === "function") {
          this.ribbonEl = this.addRibbonIcon(RIBBON_ICON, RIBBON_TITLE, function () { openSettings(this); }.bind(this));
        }
      } catch (e) { console.warn("[kb-toolkit] 加侧边栏图标失败", e); }

      /* R13（boss：界面翻新）：命令面板只留 4 条高频，这条是插件的总入口（不随模块开关变化）；
       * 其余 3 条由 ① 模块按硬门控注册（预览 / 回滚 / 打开报告），操作按钮都在设置页。 */
      try {
        var self0 = this;
        this.addCommand({ id: "open-settings", name: "打开知识库工具集设置",
          callback: function () { openSettings(self0); } });
      } catch (e) { console.warn("[kb-toolkit] 注册打开设置命令失败", e); }

      await this.registry.enableConfigured();
      this.checkLegacy();
      /* R5：没走过向导就弹一次（用户点「以后再说」后不再自动弹） */
      try { if (KB.modules.maybeShowWizard) KB.modules.maybeShowWizard(this); }
      catch (e) { console.warn("[kb-toolkit] 向导打开失败", e); }
    }

    async onunload() {
      if (this.registry) await this.registry.disableAll();
    }

    checkLegacy() {
      if (!this.settings.legacyCheck) return;
      this.legacyFound = KB.modules.detectLegacy(this);
      if (this.legacyFound.length) {
        var names = this.legacyFound.map(function (l) { return l.id; }).join("、");
        new obsidian.Notice("知识库工具集：检测到旧插件（" + names + "）仍在启用，详见设置页顶部提示。", 8000);
      }
    }
  }
  module.exports = KbToolkitPlugin;
  KB.modules.PluginClass = KbToolkitPlugin;
  return KbToolkitPlugin;
});

/* ===== 工厂实例化 ===== */
KB.reg.forEach(function (r) { r.factory(); });
