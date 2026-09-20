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
const K_SEC_W = "文件宽度";      // R25：**板块级**卡片最小宽度（写在「板块」项里，不是视图配置）；不写 = 继承 K_WIDTH
const K_SEC_H = "卡片高度";      // R26：**板块级**卡片固定高度；不写 = 同一行拉伸等高、短的留白
const K_CARD_H = "卡片默认高度";  // R27：**视图级**卡片高度默认（板块没单独设 K_SEC_H 时用它）；不写 = 等高留白
const K_GAP = "网格间距";         // R27：卡片之间的空隙（px；不写 = 8）
const K_HIDE_EMPTY = "隐藏空板块"; // R27：一条笔记都没有的板块不渲染（看板更清爽）
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
  "propsOpen", "文件宽度", "卡片高度"];

/** R12：三态字段（true / false / null=继承视图默认）的容错解析 */
function tri(o, zhKey, enKey) {
  const v = o[zhKey] !== undefined ? o[zhKey] : o[enKey];
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return null;
}

/** R25：板块级「文件宽度」容错解析 —— 空 / 非数 → null（= 继承视图默认的 K_WIDTH）；
 *  有值 → 夹到 160–480 并对齐到 10 的整数（跟视图形级那条拉杆同一档）。 */
function secWidth(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;   // 0 / 负数 = 没设（别夹成 160 —— 那是「显式设成最小」）
  return Math.max(160, Math.min(480, Math.round(n / 10) * 10));
}

/** R26：板块级「卡片高度」容错解析 —— 空 / 非数 → null（= 同一行拉伸**等高**、短的留白）；
 *  有值 → 夹到 120–480 并对齐到 10（卡片固定高，正文超出在卡片里滚）。 */
function secHeight(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;
  return Math.max(120, Math.min(480, Math.round(n / 10) * 10));
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
    secW: secWidth(o[K_SEC_W] !== undefined ? o[K_SEC_W] : o.secWidth), // R25：null=继承视图的 K_WIDTH
    secH: secHeight(o[K_SEC_H] !== undefined ? o[K_SEC_H] : o.secHeight), // R26：null=同行拉伸等高
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
  if (sec.secW !== null && sec.secW !== undefined) o[K_SEC_W] = sec.secW;   // R25
  if (sec.secH !== null && sec.secH !== undefined) o[K_SEC_H] = sec.secH;   // R26
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
    /* R27（boss 第 5 条：面板「稍稍有点空」）：头下面加一条**摘要** ——
       一眼看清这份看板现在什么状态，面板也不再是「标题+一堆行」的空架子。 */
    this.panelSubEl = this.panelEl.createDiv({ cls: "cb-panel-sub" });
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
    if (this.flashTimer) {      // R27：新建卡片的描边定时器
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
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
  /** R27：视图级样式变量统一出口 —— 宽度 / 自动铺满 / 卡片默认高度 / 网格间距。
   *  三个调用点：重绘、编辑器保护快路径、面板拉杆拖动中（只写变量、不动 DOM 树）。 */
  applyRootVars() {
    try {
      const minW = num(this.optNum(K_WIDTH, 240), 240);
      this.rootEl.style.setProperty("--cb-card-w", minW + "px");
      /* R15：空位铺满整行开关 —— 开 = 1fr 撑满；关 = 固定为滑杆宽度（滑杆才真的「可调」） */
      this.rootEl.style.setProperty("--cb-card-max", this.optBool(K_FILL, true) ? "1fr" : minW + "px");
      /* R27：没设就**删掉变量**（别把默认值写成硬值，否则改看板默认拉不动板块） */
      const h0 = this.cardHeightDefault();
      if (h0 !== null) this.rootEl.style.setProperty("--cb-card-h", h0 + "px");
      else this.rootEl.style.removeProperty("--cb-card-h");
      const g0 = this.gapOf();
      if (g0 !== null) this.rootEl.style.setProperty("--cb-gap", g0 + "px");
      else this.rootEl.style.removeProperty("--cb-gap");
    } catch (e) {}
  }

  /** R27：看板默认的卡片高度（null = 没设 → 同一行拉伸等高、短的留白） */
  cardHeightDefault() {
    const v = this.cfgGet(K_CARD_H, "");
    if (v === "" || v === null || v === undefined) return null;
    return secHeight(v);
  }

  /** R27：卡片间距（null = 没设 → 用 CSS 里的 8px 兜底） */
  gapOf() {
    const v = this.cfgGet(K_GAP, "");
    if (v === "" || v === null || v === undefined) return null;
    const g = parseInt(v, 10);
    if (!isFinite(g)) return null;
    return Math.max(0, Math.min(24, g));
  }

  /** R27：「隐藏空板块」开关 */
  hideEmpty() {
    return this.optBool(K_HIDE_EMPTY, false);
  }

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
      String(this.optBool(K_HIDE_EMPTY, false)),    /* R27：拨「隐藏空板块」要即时重绘（影响哪些块出现） */
      String(this.cfgGet(K_GAP, "~")),              /* R27：拨「网格间距」同理 */
      String(this.cfgGet(K_CARD_H, "~")),           /* R27：拨「卡片默认高度」同理 */
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
      this.applyRootVars();   /* R27：这类纯样式项要即时生效，但别把编辑器连光标一起拽掉 */
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

    this.applyRootVars();   /* R27：宽度 / 铺满 / 卡片默认高度 / 网格间距 一起写入 */

    /* R27：开着「隐藏空板块」时，一条笔记都没有的板块直接不渲染（省得整屏空壳板块） */
    const hideEmpty = this.hideEmpty();
    let shownSec = 0;
    for (const sec of this.sections) {
      if (hideEmpty && !(sec.total > 0) && !(sec.entries && sec.entries.length)
        && !(sec.children && sec.children.length)) continue;
      shownSec++;
      this.renderSection(this.listEl, sec);
    }
    if (hideEmpty && shownSec === 0) {
      this.listEl.createDiv({ cls: "cb-empty", text: "所有板块都空着（「隐藏空板块」开着，可在顶栏「板块」面板里关）" });
    }

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
    sec.__wrapEl = wrap;      // R25：菜单里拖拉杆要直写这个板块的变量
    /* R25（boss：单个板块内文件宽度）：把 CSS 变量写到 .cb-section 上 —— 后代 .cb-grid
       走 var(--cb-card-w) 自然继承（子板块也在这块里，跟着一起变）。
       没覆盖就**一个字都不写**，保持整板默认（别把继承值写成硬值，否则改看板拉不动它）。 */
    const sw0 = this.secWidthOf(sec);
    if (sw0 !== null) {
      wrap.style.setProperty("--cb-card-w", sw0 + "px");
      if (!this.optBool(K_FILL, true)) wrap.style.setProperty("--cb-card-max", sw0 + "px");
    }
    /* R26（boss 第 1 条）：板块级「卡片高度」—— 设了 = 卡片**固定**这个高度（正文超出在卡片里滚）；
       没设 = 一个字都不写，同一行走 CSS 拉伸**等高**、短的留白（别把默认值写死，铁律同宽度）。 */
    const sh0 = this.secHeightOf(sec);
    if (sh0 !== null) wrap.style.setProperty("--cb-card-h", sh0 + "px");
    const collapsed = this.isCollapsed(sec, null, false);

    const head = wrap.createDiv({ cls: "cb-section-head" });
    const tri = head.createSpan({ cls: "cb-tri", text: collapsed ? "▸" : "▾" });
    const nameEl = head.createSpan({ cls: "cb-section-name", text: sec.name });
    /* R24（boss 第 1 条）：双击板块名 → 就地改名（原来只能去顶栏面板的编辑行里改） */
    if (this.secConfigurable(sec) && !this.readonly()) {
      nameEl.addClass("cb-sec-name-edit");
      nameEl.setAttr("title", "点一下改名；拖动这一行可以给板块排序");
      /* R26（boss 第 5 条）：**单击**就改名（Windows 重命名文件那种手感）——
         拖动排序走 dragstart、不产生 click，互不打架；beginRenameSection 内部
         有 __cbRenaming 防重入，连点也不会开两个输入框。dblclick 保留（老习惯不破）。 */
      nameEl.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.beginRenameSection(sec, nameEl);
      });
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
    /* R26（boss 第 4 条）：手机端没有右键 → 长按板块标题就地呼出**同一份**菜单
       （桌面端没有 touch 事件，完全无感知；拖动排序是 touchmove 超阈值自动取消） */
    this.bindLongPress(head, (x, y) => this.openSecMenu(sec, x, y));

    const body = wrap.createDiv({ cls: "cb-section-body" });

    const grid = body.createDiv({ cls: "cb-grid" });
    sec.__gridEl = grid;      // R25：右键菜单「新建文件」要把临时卡片插进这块的栅格
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
    /* R27：新建后紧跟的重绘（reveal）要把「描边」续上，否则一闪就没了 */
    if (this.flashPath && this.flashPath === file.path) card.addClass("cb-flash");
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
    /* R26（boss 第 4 条）：手机端长按卡片 → 呼出同一份笔记操作菜单。
      链接 / 输入框 / 按钮上不抢（那里长按有系统自己的语义：选择、预览）。 */
    this.bindLongPress(card, (x, y, tgt) => {
      if (tgt && tgt.closest && tgt.closest("a, input, textarea, button, .cb-pros-toggle")) return;
      this.openCardMenu(card, entry, x, y);
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

  /** R25：这个板块自己的「文件宽度」（null = 跟随看板那条拉杆） */
  secWidthOf(sec) {
    const s = (sec && sec.spec) || null;
    if (!s) return null;
    return secWidth(s.secW);
  }

  /** R26：这个板块自己的「卡片高度」（null = 同一行拉伸等高、短的留白） */
  secHeightOf(sec) {
    const s = (sec && sec.spec) || null;
    if (!s) return null;
    return secHeight(s.secH);
  }

  /** 这个板块有没有「板块级覆盖」（决定「重置设置」是否可点） */
  secHasOverride(i) {
    const s = this.secs[i];
    if (!s) return false;
    return s.body === true || s.body === false
      || s.yaml === true || s.yaml === false
      || s.links === true || s.links === false
      || s.propsOpen === true || s.propsOpen === false
      || (s.secW !== null && s.secW !== undefined)
      || (s.secH !== null && s.secH !== undefined)
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
    s.secW = null;
    s.secH = null;
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

  /** R27（boss 第 3 条）：菜单里改完设置**不关窗** —— 按记下的锚点（第几块 + 鼠标处）
   *  就地重开：窗不动、位置不变，只把控件状态重画一遍（重置项该置灰就置灰、
   *  三态该变色就变色、打勾项该打勾就打勾）。「点了没反应」和「没生效」必须分得开，
   *  所以顶上还留一条状态行报最近一次改动（读 saveState）。 */
  refreshSecMenu() {
    const a = this.secMenuAnchor;
    if (!a) return null;
    /* 🔴 别写 this.sections[a.si]：sections 的顺序 ≠ secs 的顺序（收容所 / 公式会另起
       一条），只有 srcIndex 是稳定对应关系。 */
    const sec = this.sections.find((s) => s.srcIndex === a.si) || null;
    if (!sec) { this.closeSecMenu(); return null; }
    return this.openSecMenu(sec, a.x, a.y, true);
  }

  /** R27：右键菜单的「回执」专用通道。
   *  🔴 不能只写 saveState —— afterChange() 里的 persist() 会把它覆写成
   *  「已写入 .base」，回执就成了一句废话（真 DOM 冒烟抓到的）。 */
  note(msg) {
    this.secMenuStatus = msg;
    this.saveState = msg;
  }

  /** R27（boss 第 2 条）：新建之后给那张卡「描边闪一下」——不然一眼找不到新建的那篇。
   *  · flashPath 记在实例上：创建后紧跟的那次重绘（reveal）也会把类补回去
   *  · 时长 ~1.6s 后统一摘掉（定时器挂实例，onunload 清） */
  flashNewCard(path) {
    if (!path) return;
    this.flashPath = path;
    const mark = () => {
      try {
        const root = this.rootEl;
        if (!root || !root.querySelectorAll) return 0;
        const els = root.querySelectorAll(".cb-card");
        let k = 0;
        for (const el of els) {
          if (el.getAttribute && el.getAttribute("data-path") === path) {
            if (el.addClass) el.addClass("cb-flash");
            k++;
          }
        }
        return k;
      } catch (e) { return 0; }
    };
    mark();
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.flashPath = null;
      try {
        const root = this.rootEl;
        if (root && root.querySelectorAll) {
          const els = root.querySelectorAll(".cb-flash");
          for (const el of els) if (el.removeClass) el.removeClass("cb-flash");
        }
      } catch (e) {}
    }, 1600);
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
    this.secMenuAnchor = null;   /* R27：锚点跟着窗一起失效（否则 closeSecMenu 之后还能「就地重开」） */
  }

  /** 右键板块 → 鼠标处弹「板块设置」小窗（跟手弹出、clamp 在视口内、点外面 / Esc 收起） */
  openSecMenu(sec, x, y, keepMsg) {
    this.closeSecMenu();
    this.closeCardMenu();
    const menu = document.body.createDiv({ cls: "cb-ctxmenu cb-secmenu" });
    this.secMenuEl = menu;

    const si = this.secIndexOf(sec);
    const canSec = this.secConfigurable(sec) && si >= 0;
    const secName = sec ? sec.name : "";
    /* R27：记锚点 —— refreshSecMenu 靠它「就地重开」（si 变了就说明这块没了 → 让它关） */
    this.secMenuAnchor = si >= 0 ? { si: si, x: x, y: y } : null;
    if (!keepMsg) this.secMenuStatus = "";
    if (this.secMenuStatus) {
      const st = menu.createDiv({ cls: "cb-ctx-status", text: this.secMenuStatus });
      st.setAttr("title", "刚刚改的那一项");
    }

    const run = (fn) => {
      this.closeSecMenu();
      try { fn(); } catch (e) {}
    };
    const item = (label, fn, disabled, tip) => {
      const el = menu.createDiv({ cls: "cb-ctx-item" + (disabled ? " is-disabled" : "") });
      el.setAttr("data-act", label);
      if (tip) el.setAttr("title", tip);
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
          /* R27：跟 wrowSec / hrowSec / chk 一样记一笔 —— 不然「不关窗 + 顶上回执」
             在三态项上就是空的（老板第 3 条要的就是「点了到底生效没」一眼分得开）。 */
          this.note("「" + secName + "」" + label + " → "
            + (nv === null ? "继承" : nv ? "开" : "关"));
          this.afterChange();
          this.refreshSecMenu();
        });
      }
    };
    /** R25（boss：右键菜单加「单个板块内文件宽度」）：**两行**
     *  ①「文件宽度 [拉杆] NNN px」 ② 打勾项「跟随看板」
     *  🔴 为什么不像顶栏「卡片」那行塞成一行：真引擎量过 —— 232px 的菜单里
     *  「标签 + 拉杆 + px + 胶囊开关」最窄也要约 329px，硬塞会把菜单从 232 撑到
     *  max-width 300（老板夸的就是这个窄窗，不能让它悄悄变宽）。拆两行后菜单宽度原样不动。
     *  · 「跟随看板」勾上 = 不写覆盖（继承视图的 K_WIDTH），拉杆置灰（不做假控件）
     *  · 不勾 = 拉杆生效，值写进本板块的「文件宽度」
     *  · 拖动中只直写**这一个板块**的 CSS 变量（不动 DOM 树，跟视图级那一行一个思路） */
    const wrowSec = (si2, secObj) => {
      const viewW = num(this.optNum(K_WIDTH, 240), 240);
      /* 当前是不是「跟随看板」—— 每次现算（secW 为空即跟随），菜单里不另存一份状态 */
      const isFollow = () => this.secs[si2].secW === null;
      const row = menu.createDiv({ cls: "cb-wrow cb-ctx-wrow" });
      const lb = row.createSpan({ cls: "cb-wlb", text: "文件宽度" });
      lb.setAttr("title", "只对「" + secName + "」：卡片最小宽度（160 – 480 px）");
      const rg = row.createEl("input", { cls: "cb-wrange", type: "range" });
      rg.setAttr("min", "160");
      rg.setAttr("max", "480");
      rg.setAttr("step", "10");
      const W0 = this.secWidthOf(secObj);
      rg.value = String(W0 !== null ? W0 : viewW);
      const val = row.createSpan({ cls: "cb-wval", text: rg.value + " px" });
      /* ②「跟随看板」= 用菜单里**已有的打勾项**语言（与「文件操作」那组同一套），不另造控件 */
      const fk = menu.createDiv({ cls: "cb-ctx-item cb-ctx-chk cb-ctx-follow" });
      fk.setAttr("data-key", "跟随看板");
      fk.setAttr("title", "勾上 = 用看板「卡片」里那条宽度；不勾 = 这个板块单独设一个宽度");
      const tick = fk.createSpan({ cls: "cb-ctx-tick", text: "" });
      fk.createSpan({ cls: "cb-ctx-chk-lb", text: "跟随看板" });
      /* ⚠️ 跟视图级那一行同一个坑：rg.value 是**字符串**，num() 只认 number，
         直接喂会恒回默认值 → 这里用 parseFloat + isFinite 兜底。 */
      const wnum2 = (v) => { const n = parseFloat(v); return isFinite(n) ? n : viewW; };
      const pctOf2 = (v) => (((wnum2(v) - 160) / 320) * 100).toFixed(1) + "%";
      const paint = () => {
        const follow = isFollow();
        rg.disabled = follow;                 /* 跟随看板时拉杆置灰（不做假控件） */
        val.style.opacity = follow ? "0.4" : "1";
        rg.style.setProperty("--cb-wpct", pctOf2(rg.value));
        val.setText(rg.value + " px");
        tick.setText(follow ? "✓" : "");
      };
      /* 菜单里的控件一律别把 mousedown / click 冒泡出去 —— 外层 closer 会把小窗收走 */
      for (const el of [rg, fk]) {
        el.addEventListener("mousedown", (evt) => evt.stopPropagation());
        el.addEventListener("click", (evt) => evt.stopPropagation());
      }
      rg.addEventListener("input", () => {
        val.setText(rg.value + " px");
        rg.style.setProperty("--cb-wpct", pctOf2(rg.value));
        /* 拖动中即时生效：只写这一个板块的 CSS 变量 */
        const we = secObj.__wrapEl;
        if (we) {
          const wpx = wnum2(rg.value) + "px";
          we.style.setProperty("--cb-card-w", wpx);
          if (!this.optBool(K_FILL, true)) we.style.setProperty("--cb-card-max", wpx);
        }
      });
      rg.addEventListener("change", () => {
        const n = Math.max(160, Math.min(480, Math.round(wnum2(rg.value) / 10) * 10));
        this.secs[si2].secW = n;
        this.note("「" + secName + "」文件宽度 → " + n + " px");
        this.afterChange();
        this.refreshSecMenu();
      });
      fk.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (isFollow()) {                    /* 勾 → 不勾：把当前拉杆值写成这一块的覆盖 */
          const n = Math.max(160, Math.min(480, Math.round(wnum2(rg.value) / 10) * 10));
          this.secs[si2].secW = n;
          this.note("「" + secName + "」文件宽度 → " + n + " px");
        } else {                             /* 不勾 → 勾：删掉覆盖，回继承看板 */
          this.secs[si2].secW = null;
          this.note("「" + secName + "」文件宽度 → 跟随看板");
        }
        this.afterChange();
        this.refreshSecMenu();
      });
      paint();
      return row;
    };
    /** R26（boss 第 1 条）：板块级「卡片高度」，跟「文件宽度」同一个两行套路 ——
     *  ①「卡片高度 [拉杆] NNN px」 ② 打勾项「跟随内容」
     *  · 「跟随内容」勾上 = 不写覆盖：同一行卡片 CSS 拉伸**等高**，短的留白（本轮新默认）
     *  · 不勾 = 卡片**固定**这个高度，长文在卡片里滚（--cb-card-h） */
    const hrowSec = (si2, secObj) => {
      const isFollowH = () => this.secs[si2].secH === null;
      const row = menu.createDiv({ cls: "cb-wrow cb-ctx-wrow" });
      const lb = row.createSpan({ cls: "cb-wlb", text: "卡片高度" });
      lb.setAttr("title", "只对「" + secName + "」：卡片固定高度（120 – 480 px）");
      const rg = row.createEl("input", { cls: "cb-wrange", type: "range" });
      rg.setAttr("min", "120");
      rg.setAttr("max", "480");
      rg.setAttr("step", "10");
      const H0 = this.secHeightOf(secObj);
      rg.value = String(H0 !== null ? H0 : 260);
      const val = row.createSpan({ cls: "cb-wval", text: rg.value + " px" });
      const fk = menu.createDiv({ cls: "cb-ctx-item cb-ctx-chk cb-ctx-follow" });
      fk.setAttr("data-key", "跟随内容");
      fk.setAttr("title", "勾上 = 同一行卡片拉伸等高、短的留白；不勾 = 卡片固定这个高度，长文在卡片里滚");
      const tick = fk.createSpan({ cls: "cb-ctx-tick", text: "" });
      fk.createSpan({ cls: "cb-ctx-chk-lb", text: "跟随内容" });
      const hnum2 = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 260; };
      const hpctOf2 = (v) => (((hnum2(v) - 120) / 360) * 100).toFixed(1) + "%";
      const paintH = () => {
        const follow = isFollowH();
        rg.disabled = follow;
        val.style.opacity = follow ? "0.4" : "1";
        rg.style.setProperty("--cb-wpct", hpctOf2(rg.value));
        val.setText(rg.value + " px");
        tick.setText(follow ? "✓" : "");
      };
      for (const el of [rg, fk]) {
        el.addEventListener("mousedown", (evt) => evt.stopPropagation());
        el.addEventListener("click", (evt) => evt.stopPropagation());
      }
      rg.addEventListener("input", () => {
        val.setText(rg.value + " px");
        rg.style.setProperty("--cb-wpct", hpctOf2(rg.value));
        const we = secObj.__wrapEl;
        if (we) we.style.setProperty("--cb-card-h", hnum2(rg.value) + "px");
      });
      rg.addEventListener("change", () => {
        const n = Math.max(120, Math.min(480, Math.round(hnum2(rg.value) / 10) * 10));
        this.secs[si2].secH = n;
        this.note("「" + secName + "」卡片高度 → " + n + " px");
        this.afterChange();
        this.refreshSecMenu();
      });
      fk.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (isFollowH()) {
          const n = Math.max(120, Math.min(480, Math.round(hnum2(rg.value) / 10) * 10));
          this.secs[si2].secH = n;
          this.note("「" + secName + "」卡片高度 → " + n + " px");
        } else {
          this.secs[si2].secH = null;
          this.note("「" + secName + "」卡片高度 → 跟随内容");
        }
        this.afterChange();
        this.refreshSecMenu();
      });
      paintH();
      return row;
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
        const nv = !this.optBool(key, dflt);
        this.cfgSet(key, nv);
        this.note("「" + label + "」→ " + (nv ? "开" : "关"));
        this.repaint(false);
        this.refreshSecMenu();
      });
      return el;
    };

    item("刷新", () => this.refreshBoard());
    /* R27（boss 第 4 条）：刷新下面加「收起 / 展开当前板块」—— 不必去点标题旁那个小三角。
       标签跟着当前折叠状态走；点完**不关窗**（跟第 3 条同一条规矩），就地刷新标签。 */
    if (canSec) {
      const isCol = this.isCollapsed(sec, null, false);
      itemStay(isCol ? "展开本板块" : "收起本板块", () => {
        this.setCollapsed(sec, null, !isCol);
        this.note("「" + secName + "」已" + (isCol ? "展开" : "收起"));
        this.afterChange();
        this.refreshSecMenu();
      });
    }
    menu.createDiv({ cls: "cb-ctx-sep" });

    if (canSec) {
      grp("通用设置", "只对「" + secName + "」");
      triRow("属性展开", "propsOpen", this.propsOpenDefault(), "卡片 / 就地编辑浮层里的属性区默认展开");
      triRow("内容展开", "body", this.viewBodyDefault(), "＝原来的「显正文」；关 = 只显示标题与属性");
      wrowSec(si, sec);   // R25：板块级「文件宽度」（跟随看板 = 不写覆盖）
      hrowSec(si, sec);   // R26：板块级「卡片高度」（跟随内容 = 不写覆盖，同一行拉伸等高）
      const has = this.secHasOverride(si);
      /* R27：重置也**不关窗** —— 重置完这一行立刻变成「已是默认」并置灰，就地看得见结果 */
      const resetEl = menu.createDiv({ cls: "cb-ctx-item" + (has ? "" : " is-disabled") });
      resetEl.setAttr("data-act", "重置设置");
      resetEl.setText(has ? "重置设置" : "重置设置（已是默认）");
      resetEl.setAttr("title", "把这个板块的单独设置全部清掉，回到「跟随看板」默认");
      if (has) {
        resetEl.addEventListener("mousedown", (evt) => evt.stopPropagation());
        resetEl.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.resetSection(si);       /* 内部已经 saveState + afterChange */
          this.note("已重置「" + secName + "」（回继承视图默认）");
          this.refreshSecMenu();
        });
      } else {
        resetEl.setAttr("aria-disabled", "true");
      }
      let helpOpen = false;
      const helpBox = menu.createDiv({ cls: "cb-sec-help" });
      helpBox.toggleClass("is-hidden", true);
      itemStay("显示帮助", () => {
        helpOpen = !helpOpen;
        helpBox.toggleClass("is-hidden", !helpOpen);
        /* R27（boss 第 1 条）：**一条一行** —— 原来整段挤成一坨，断行位置随机、读不动。
           CSS 侧 .cb-sec-help 给了 white-space: pre-line，这里的 \n 才作数。 */
        helpBox.setText(
          "「" + secName + "」　数据源 " + (sec.spec.source || "") + "\n"
          + "· 三态项（继承 / 开 / 关）与「文件宽度 / 卡片高度」只改这一块\n"
          + "· 单击板块名可改名，拖动标题可排序\n"
          + "· 「本板块」组里的新建文件 / 删除也只动这一块\n"
          + "· 「新建板块」与「文件操作」是整个看板共用的"
        );
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

    /* R25（boss：右键菜单里新增 新建文件 / 删除板块 / 新建板块）。
       分两组写，就是为了让**作用范围一眼可见**（R24 立的那条规矩）：
       「本板块」= 新建文件、删除；「看板」= 新建板块。 */
    if (canSec) {
      menu.createDiv({ cls: "cb-ctx-sep" });
      grp("本板块", "只对「" + secName + "」");
      item("新建文件", () => this.createInSection(sec, "", sec.__gridEl), this.readonly(),
        "在这个板块里新建一篇空笔记（落点按数据源算；空文件交给 Templater 目录模板）");
      /* 删除：两下确认 —— 第一下只把这一项变成「再点一次」，**不收起小窗**（收起了就没法点第二下） */
      let armed = false;
      const del = menu.createDiv({ cls: "cb-ctx-item cb-ctx-danger" });
      del.setAttr("data-act", "删除板块");
      del.setText("删除「" + secName + "」");
      del.setAttr("title", "只从这个看板的板块配置里删掉它，笔记一篇都不动（再点一次才真删）");
      del.addEventListener("mousedown", (evt) => evt.stopPropagation());
      del.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (!armed) {
          armed = true;
          del.setText("再点一次确认删除");
          del.addClass("is-armed");
          return;
        }
        const nm = this.deleteSection(si);
        this.closeSecMenu();
        if (nm) {
          try {
            new obsidian.Notice("创作看板：已删除板块「" + nm + "」（笔记一篇没动）");
          } catch (e) {}
        }
      });
    }

    /* R25：新建板块（整个看板）—— 4 个数据源按钮，跟顶栏面板「＋ 添加」同一套 ADDABLE */
    menu.createDiv({ cls: "cb-ctx-sep" });
    /* 组标题**就是**这一项的标签 —— 232px 的菜单里塞不下「新建板块 + 4 个数据源按钮」一行 */
    grp("新建板块", "整个看板");
    const addRow = menu.createDiv({ cls: "cb-ctx-addrow" });
    if (this.readonly()) {
      addRow.createSpan({ cls: "cb-ctx-addrow-note", text: "只读模式：先点工具条 ✎" });
    } else {
      for (const t of ADDABLE) {
        const b = addRow.createEl("button", { cls: "cb-add-type", text: SOURCE_LABEL[t] });
        b.setAttr("type", "button");
        b.setAttr("data-type", t);
        b.setAttr("title", "加一个「" + SOURCE_LABEL[t] + "」板块；加完就地翻开顶栏「板块」面板那一行选目录 / 标签");
        b.addEventListener("mousedown", (evt) => evt.stopPropagation());
        b.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          const idx = this.addSection(t);
          this.closeSecMenu();
          if (typeof idx === "number" && idx >= 0) {
            /* 「新建」之后紧接着就是「配置」—— 翻开顶栏面板并展开新板块那一行 */
            this.panelOpen = true;
            this.addOpen = false;
            this.editIdx = idx;
            this.renderPanel();
            try {
              new obsidian.Notice("创作看板：已新建「" + SOURCE_LABEL[t] + "」板块 —— 在「板块」面板里选目录 / 标签");
            } catch (e) {}
          }
        });
      }
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
  /** R26（boss 第 4 条）：手机端没有右键键 → 长按（约 550ms、位移 ≤ 10px）就地呼出菜单。
   *  桌面端没 touch 事件，零感知；手指动了（滚动/拖动）立刻取消，不会误弹。 */
  bindLongPress(el, onFire) {
    if (!el || typeof onFire !== "function") return;
    let timer = null, sx = 0, sy = 0;
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener("touchstart", (evt) => {
      const te = evt.touches && evt.touches[0];
      if (!te) return;
      sx = te.clientX; sy = te.clientY;
      stop();
      timer = setTimeout(() => {
        timer = null;
        try { evt.preventDefault(); } catch (e) {}   /* 别让它接着变成滚动 / 系统长按 */
        onFire(sx, sy, evt.target);
      }, 550);
    }, { passive: false });
    el.addEventListener("touchmove", (evt) => {
      if (!timer) return;
      const te = evt.touches && evt.touches[0];
      if (te && (Math.abs(te.clientX - sx) > 10 || Math.abs(te.clientY - sy) > 10)) stop();
    }, { passive: true });
    el.addEventListener("touchend", stop, { passive: true });
    el.addEventListener("touchcancel", stop, { passive: true });
  }

  /** R26（boss 第 2 条）：卡片正文里的任务勾选框**直接点**就能勾/取消，不用点进笔记。
   *  原理：MarkdownRenderer 渲出的 .task-list-item-checkbox 自带 disabled（点了没反应，
   *  Chrome 对 disabled 控件连 click 都不发）→ 这里摘掉 disabled 启用它，
   *  第 n 个框 ↔ 全文第 n 个任务行（- [ ] / - [x]），点一下就把笔记里那一行反过来写。
   *  🔴 顺序映射的前提：预览正文是全文的**前缀**（去前言 + 截断都只动头/尾）——
   *  框比任务行还多就是对不上号，宁可不绑也别勾错行。 */
  bindTaskToggles(el, file, raw) {
    if (!el || !file || this.readonly()) return;
    let boxes = [];
    try { boxes = Array.prototype.slice.call(el.querySelectorAll("input.task-list-item-checkbox")); }
    catch (e) { return; }
    if (!boxes.length) return;
    const lines = String(raw == null ? "" : raw).split(/\r?\n/);
    const taskIdx = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^[\s>]*[-*+]\s+\[( |x|X)\]/.test(lines[i])) taskIdx.push(i);
    }
    if (boxes.length > taskIdx.length) return;   /* 对不上号 → 不绑，宁可点不动也别勾错行 */
    for (let k = 0; k < boxes.length; k++) {
      const box = boxes[k];
      try { box.removeAttribute("disabled"); } catch (e) { try { box.disabled = false; } catch (e2) {} }
      /* 点勾选框 ≠ 点正文：别把编辑浮层带出来（正文区 click = 就地编辑） */
      box.addEventListener("click", (evt) => evt.stopPropagation());
      box.addEventListener("mousedown", (evt) => evt.stopPropagation());
      box.addEventListener("change", () => {
        this.toggleTaskLine(file, taskIdx[k], !!box.checked, box);
      });
    }
  }

  /** R26：把笔记里第 li 行的任务标记翻面（原子写走 vault.process，老接口退 read/modify）。 */
  toggleTaskLine(file, li, done, box) {
    const flip = (content) => {
      const lines = String(content == null ? "" : content).split(/\r?\n/);
      const line = lines[li];
      if (line === undefined) return content;
      lines[li] = done ? line.replace(/\[( |x|X)\]/, "[x]") : line.replace(/\[( |x|X)\]/, "[ ]");
      return lines.join("\n");
    };
    const v = this.app && this.app.vault;
    if (v && typeof v.process === "function") {
      Promise.resolve(v.process(file, flip)).catch(() => {});
    } else if (v && typeof v.read === "function" && typeof v.modify === "function") {
      v.read(file).then((c) => v.modify(file, flip(c))).catch(() => {});
    } else {
      try { if (box) box.checked = !box.checked; } catch (e) {}   /* 写不了 → 至少视图别骗人 */
    }
  }

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
    this.bindTaskToggles(el, file, raw);   /* R26：任务勾选框直接点 */
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
    this.flashNewCard(path);      /* R27（boss 第 2 条）：描边闪一下，一眼看见新建的那篇 */
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
    /* R27：三个新键也要跟着搬（这里原本漏了 —— 自检才发现）。
       间距 / 卡片默认高度只在**显式设过**时导出：没设过 = 用 CSS 兜底 8px / 跟随内容，
       把这份「没用过」固化进 .base 反而会掐死以后改看板默认。 */
    if (this.gapOf() !== null) view[K_GAP] = this.gapOf();
    if (this.cardHeightDefault() !== null) view[K_CARD_H] = this.cardHeightDefault();
    view[K_HIDE_EMPTY] = this.optBool(K_HIDE_EMPTY, false);
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
      /* R27：跟导出对称 —— 少了这三行，搬进来的配置会被静默丢掉 */
      kinds[K_GAP] = "num"; kinds[K_CARD_H] = "num"; kinds[K_HIDE_EMPTY] = "bool";
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
    if (this.panelSubEl) this.panelSubEl.setText(this.panelSummary());

    /* R20 需求4-②（boss：重新设计、大幅简化、改成开关样式、无冗余文字说明）：
     * 面板只分三段 —— 「看板行为 / 板块 / 高级」。开关一律原生胶囊
     * （.cb-opt .checkbox-container，样式见 styles_src/cb.css），
     * 所有解释性文字降级成 title 悬浮提示，面板正文里不铺小字。 */
    /* R21（boss 拍板「先做视图级」）：「卡片最小宽度」「空位铺满整行」从 Base 的
     * 视图选项面板挪到这儿、并成一行 —— 原生视图选项面板一条 descriptor 只占一行，
     * 合不成「文件宽度 [拉杆] 240 px  自动 [开关]」。键与语义一个没变（K_WIDTH / K_FILL）。 */
    const cardBox = this.addGroup("卡片");
    this.addWidthRow(cardBox);
    /* R27：跟「文件宽度」同一个台面/同一套语言的两行 —— 间距与默认高度
       （R26 的板块级「卡片高度」是**覆盖**，这里是不覆盖时的**看板默认**） */
    this.addGapRow(cardBox);
    this.addCardHeightRow(cardBox);

    const behBox = this.addGroup("看板行为");
    this.addToggle(behBox, K_DUP, true, "允许重复", "一条笔记可以同时出现在多个板块里");
    this.addToggle(
      behBox, K_CATCH, this.pluginCatchDefault(), "显示收容所",
      "未被任何板块命中的笔记归到「收容所」板块。没单独设过时跟随插件设置（插件里现在=" +
        (this.pluginCatchDefault() ? "显示" : "隐藏") + "）"
    );
    this.addToggle(behBox, K_HIDE_EMPTY, false, "隐藏空板块",
      "一条笔记都没有的板块不显示（右上角「共 N 篇」照旧把全部算在内）");
    this.addToggle(behBox, K_BODY, false, "显正文", "板块没单独指定正文开关时的默认值");
    /* R23（boss：加一个开关控制笔记的属性是否默认展开）：键还是老的 K_PROS_OPEN（R9 就有），
     * 只是从原生视图选项面板挪到这儿 —— 挨着「显正文」（一个管正文、一个管属性）。 */
    this.addToggle(behBox, K_PROS_OPEN, true, "属性默认展开",
      "卡片 / 就地编辑浮层里的属性区默认展开；关 = 默认折叠（每张卡片上的「属性 ▸」仍可单独展开）");
    this.addToggle(behBox, K_RO, false, "只读", "关掉看板上全部就地编辑（＝顶栏那把锁）");

    /* R27（boss 第 5 条）：面板里的「内容」组 —— 这两项原来只在 Bases 原生视图选项里
       （键与语义一个没变，跟 R21 搬宽度、R23 搬属性展开一个套路），现在收进自绘面板：
       「显示属性」是文本，「正文上限」是拉杆（0 = 不截断）。 */
    const contentBox = this.addGroup("内容");
    this.addPropsRow(contentBox);
    this.addCharsRow(contentBox);

    const secBox = this.addGroup("板块");
    /* R27：板块多的时候，一键全收 / 全开（跟右键菜单第 4 条同一个主题） */
    if (this.secs.length > 0) {
      const bulk = secBox.createDiv({ cls: "cb-bulk" });
      const bOpen = bulk.createEl("button", { cls: "cb-mini cb-bulk-open", text: "全部展开" });
      bOpen.setAttr("title", "把所有板块展开");
      bOpen.addEventListener("click", () => this.setAllCollapsed(false));
      const bShut = bulk.createEl("button", { cls: "cb-mini cb-bulk-shut", text: "全部收起" });
      bShut.setAttr("title", "把所有板块收起（只留标题行）");
      bShut.addEventListener("click", () => this.setAllCollapsed(true));
    }
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

  /** R27：面板头的摘要（N 篇 · M 个板块 · 正文开 / 关 · 只读） */
  panelSummary() {
    try {
      const all = this.data && Array.isArray(this.data.data) ? this.data.data : [];
      const bits = [all.length + " 篇笔记", this.secs.length + " 个板块"];
      bits.push(this.optBool(K_BODY, false) ? "正文开" : "正文关");
      if (this.hideEmpty()) bits.push("隐藏空板块");
      bits.push(this.readonly() ? "只读" : "可编辑");
      return bits.join(" · ");
    } catch (e) { return ""; }
  }

  /** R27：一键把所有板块收起 / 展开（写的是同一个 K_FOLD 折叠表，跟点小三角完全等价） */
  setAllCollapsed(v) {
    let k = 0;
    for (let i = 0; i < this.secs.length; i++) {
      const sec = this.sections.find((x) => x.srcIndex === i) || null;
      if (!sec) continue;
      this.setCollapsed(sec, null, v);
      k++;
    }
    this.saveState = (v ? "已收起 " : "已展开 ") + k + " 个板块";
    this.afterChange();
    this.renderPanel();
  }

  /** R27：面板里的「一行拉杆」通用件 —— 左标签 + 原生 range（吃 --cb-wpct 渐变）+ 右侧回显。
   *  返回 {row, rg, val, paint, num}；写盘 / 联动交给调用方（拖动中只写 CSS 变量，不动 DOM）。 */
  _sliderRow(parent, label, tip, min, max, step, value, fmt) {
    const row = parent.createDiv({ cls: "cb-wrow" });
    const lb = row.createSpan({ cls: "cb-wlb", text: label });
    lb.setAttr("title", tip || "");
    const rg = row.createEl("input", { cls: "cb-wrange", type: "range" });
    rg.setAttr("min", String(min));
    rg.setAttr("max", String(max));
    rg.setAttr("step", String(step));
    rg.value = String(value);
    const val = row.createSpan({ cls: "cb-wval", text: fmt(parseFloat(rg.value)) });
    /* ⚠️ 跟 R21/r25 同一个坑：rg.value 是**字符串**，num() 只认 number → 一律 parseFloat 兜底 */
    const rd = () => { const v = parseFloat(rg.value); return isFinite(v) ? v : value; };
    const paint = () => {
      rg.style.setProperty("--cb-wpct", (((rd() - min) / (max - min)) * 100).toFixed(1) + "%");
      val.setText(fmt(rd()));
    };
    paint();
    return { row: row, rg: rg, val: val, paint: paint, read: rd };
  }

  /** R27：网格间距（K_GAP）—— 拖动中直写 --cb-gap，松手落盘 */
  addGapRow(parent) {
    const g0 = this.gapOf();
    const r = this._sliderRow(parent, "网格间距", "卡片之间的空隙（0 – 24 px；默认 8）",
      0, 24, 2, g0 === null ? 8 : g0, (v) => v + " px");
    r.rg.addEventListener("input", () => {
      r.paint();
      this.rootEl.style.setProperty("--cb-gap", r.read() + "px");
    });
    r.rg.addEventListener("change", () => {
      const g = Math.max(0, Math.min(24, Math.round(r.read() / 2) * 2));
      this.cfgSet(K_GAP, g);
      this.saveState = "网格间距 → " + g + " px";
      this.repaint(false);
    });
  }

  /** R27：看板默认卡片高度（K_CARD_H）—— 「跟随内容」勾上 = 不设默认（等高留白） */
  addCardHeightRow(parent) {
    const isFollow = () => this.cardHeightDefault() === null;
    const cur = this.cardHeightDefault();
    const r = this._sliderRow(parent, "卡片高度", "看板默认高度（120 – 480 px）；板块没单独设时用它",
      120, 480, 10, cur === null ? 260 : cur, (v) => v + " px");
    const sw = r.row.createEl("label", { cls: "checkbox-container" });
    const cb = sw.createEl("input", { cls: "cb-opt-box", type: "checkbox" });
    cb.checked = isFollow();
    sw.setAttr("title", "跟随内容 = 看板不设默认高度：同一行卡片拉伸等高、短的留白");
    const lab = r.row.createEl("label", { cls: "cb-opt-label", text: "跟随内容" });
    const paint = () => {
      r.paint();
      const f = isFollow();
      r.rg.disabled = f;
      r.val.style.opacity = f ? "0.4" : "1";
    };
    const face = () => {
      cb.checked = isFollow();
      paint();
    };
    const commit = (v) => {
      if (v === null) this.cfgSet(K_CARD_H, null);
      else this.cfgSet(K_CARD_H, Math.max(120, Math.min(480, Math.round(v / 10) * 10)));
      this.saveState = v === null ? "卡片高度 → 跟随内容（等高留白）" : "卡片高度 → " + v + " px";
      this.repaint(false);
      face();
    };
    r.rg.addEventListener("input", () => {
      if (isFollow()) return;
      r.paint();
      this.rootEl.style.setProperty("--cb-card-h", r.read() + "px");
    });
    r.rg.addEventListener("change", () => commit(r.read()));
    const flip = () => commit(isFollow() ? r.read() : null);
    cb.addEventListener("change", flip);
    lab.addEventListener("click", () => { cb.checked = !cb.checked; flip(); });
    paint();
  }

  /** R27：正文上限（K_CHARS）—— 0 = 不截断（原「正文字数」键，从原生视图选项搬来） */
  addCharsRow(parent) {
    const cur = Math.max(0, Math.floor(this.optNum(K_CHARS, DEFAULT_CHARS)));
    const r = this._sliderRow(parent, "正文上限", "卡片正文最多显示多少字；0 = 不截断（正文区自己滚）",
      0, 400, 20, Math.min(cur, 400), (v) => (v <= 0 ? "不截断" : v + " 字"));
    r.rg.addEventListener("input", () => r.paint());
    r.rg.addEventListener("change", () => {
      const v = Math.max(0, Math.min(400, Math.round(r.read() / 20) * 20));
      this.cfgSet(K_CHARS, v);
      this.saveState = v <= 0 ? "正文上限 → 不截断" : "正文上限 → " + v + " 字";
      this.repaint(false);
    });
  }

  /** R27：显示属性（K_PROPS）—— 逗号分隔；留空 = 每篇前言前 5 个（原键，从原生视图选项搬来） */
  addPropsRow(parent) {
    const row = parent.createDiv({ cls: "cb-field" });
    const lb = row.createSpan({ cls: "cb-field-label", text: "显示属性" });
    lb.setAttr("title", "逗号分隔；留空 = 每篇笔记前言里的前 5 个用户属性");
    const inp = row.createEl("input", { cls: "cb-text cb-props-text", type: "text" });
    inp.value = String(this.cfgGet(K_PROPS, ""));
    inp.setAttr("placeholder", "简介, 平台, 状态");
    const commit = () => {
      const v = String(inp.value == null ? "" : inp.value).trim();
      if (v === String(this.cfgGet(K_PROPS, "")).trim()) return;
      this.cfgSet(K_PROPS, v);
      this.saveState = "显示属性 → " + (v || "（自动：前 5 个）");
      this.repaint(false);
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("blur", commit);
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
    /* R27：这一块被单独调过（宽度 / 高度 / 三态 / 属性 / 排序…）→ 标一下，
       不然「重置设置」为什么可用、别的块为什么不一样，光看列表看不出来 */
    if (this.secHasOverride(i)) {
      const ov = row.createSpan({ cls: "cb-badge cb-badge-ovr", text: "已自定义" });
      ov.setAttr("title", "这一块有自己的设置（右键板块 → 通用设置，可一键重置）");
    }

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
      return -1;
    }
    const base = { name: "新板块", source: type, rawSource: type, path: "", tag: "", formula: "", limit: 50, depth: 1, props: [], body: null, propsOpen: null, secW: null, secH: null, extra: {} };
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
    return idx;      // R25：右键菜单拿它去翻开顶栏面板对应那一行
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
    this.deleteSection(i);
  }

  /** R25（boss：右键菜单「删除板块」）：真的删掉第 i 个板块（只动看板配置，不碰任何笔记）。
   *  面板那两下确认（askDelete）与右键菜单都走这里 —— 删板块的 splice 逻辑只有一份。 */
  deleteSection(i) {
    const s = this.secs[i];
    if (!s) return null;
    const name = s.name;
    this.secs.splice(i, 1);
    if (this.editIdx === i) this.editIdx = -1;
    else if (this.editIdx > i) this.editIdx--;
    this.saveState = "已删除板块「" + name + "」"
      + (this.secs.length === 0 ? "（板块清零 → 看板回退成 base 的自动分组）" : "");
    this.afterChange();
    return name;
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
    /* R27：显示属性 / 正文字数搬进顶栏「内容」组后，原来只给「正文字数上限」的
       shouldHide 用的 readBool 助手就没人用了 —— 一并摘掉，别留死代码。 */
    return [
      { displayName: "显正文（板块没单独指定时的默认）", type: "toggle", key: K_BODY, default: false },
      /* R27：显示属性（K_PROPS）与正文字数（K_CHARS）也搬到顶栏「板块设置」的「内容」组
       * （跟 R21 的宽度、R23 的属性展开一个套路：**键与语义一个没变**，只是台面换了；
       *  自绘面板一条能放「标签 + 拉杆 + 回显」，原生面板一条 descriptor 放不下）。 */
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
