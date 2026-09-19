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
