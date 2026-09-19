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
  var MOD_TIP = {
    rebuild: "预览 → 执行 → 回滚；把库顶层整理成一个结构完整的知识库",
    automation: "新笔记自动补全 · 按标签归位 · 一键补全存量笔记",
    base: "创作看板 + 内容流视图 —— 换个方式看库，不碰文件"
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
      { k: "卡片宽度", v: "160 – 480 px。每个看板视图各存一份，在笔记里打开看板、从视图右上角 ⚙ 调整" },
      { k: "空位铺满整行", v: "开 = 空位撑满一行；关 = 卡片固定为滑杆宽度，排不下才换行（同样在视图 ⚙ 里）" }
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
      var text = field === "knowledgeBase"
        ? "笔记实际存放的顶层目录名（新建时新建的目录也用这个名字）。当前：" + P.knowledgeBase
        : "相对知识库根的名字（模板/指令集/索引/日志），当前：" + P.metaDir;
      setting.setDesc(text);
      return text;
    }
    /** R8：就地刷新「创作看板 · 排除目录」那一行的说明 */
    boardDesc(setting) {
      if (!setting || typeof setting.setDesc !== "function") return null;
      var v = String(this.plugin.settings.modules["base.boardExclude"] || "");
      var text = v
        ? "当前排除：`" + v + "`（按目录段匹配；写了就会从看板里挡掉这些目录）"
        : "当前留空 → 看板默认展示整个笔记库（不排除任何目录）";
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
    function buildPop(host, key, title, items) {
      var wrap = host.createEl("div", { cls: "kbt-pop", attr: { hidden: "" } });
      var mask = wrap.createEl("div", { cls: "kbt-pop-mask" });
      var win = wrap.createEl("div", { cls: "kbt-pop-win" });
      var ph = win.createEl("div", { cls: "kbt-pop-head" });
      ph.createEl("span", { cls: "kbt-pop-title", text: title });
      var x = ph.createEl("button", { cls: "kbt-pop-x", attr: { type: "button", "aria-label": "关闭" } });
      x.textContent = "×";
      var body = win.createEl("div", { cls: "kbt-pop-body" });
      for (var i = 0; i < items.length; i++) {
        if (i) body.createEl("div", { cls: "kbt-help-sep" });
        var it = body.createEl("div", { cls: "kbt-help-item kbt-hrow" });
        it.createEl("span", { cls: "kbt-help-title kbt-hk", text: items[i].k });
        it.createEl("span", { cls: "kbt-help-text kbt-hv setting-item-description", text: items[i].v });
      }
      x.addEventListener("click", function () { closePop(key); });
      mask.addEventListener("click", function () { closePop(key); });
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
    /* R18（效果图 .mstat）：状态行 = 主行 + ⓘ（同一行）；副行留给细节（没有就不占位）。
     * ⓘ 的提示 = 模块总说明 + 下一步引导 —— 效果图把提示放在这一行里。 */
    function statusLine(box, mainText, tip) {
      var el = box.createEl("div", { cls: "kbt-status callout", attr: { "data-callout": "info" } });
      var top = el.createEl("div", { cls: "kbt-status-top" });
      var m = top.createEl("div", { cls: "kbt-status-main" });
      m.textContent = mainText;
      infoDot(top, tip || "提示", function () { tab._openPop(box._kbKey || tab._tab); });
      var sub = el.createEl("div", { cls: "kbt-status-sub setting-item-description" });
      return { el: el, main: m, sub: sub };
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
    /* 每页底部一栏「帮助」：点开悬浮小窗（上下滑动看全部提示） */
    function helpRow(box, key) {
      var card = makeSec(box, "帮助");
      var s = new obsidian.Setting(card)
        .setName("本页提示").setDesc("一行一条 —— 点开可上下滑动看全部");
      s.addButton(function (b) { b.setButtonText("查看提示")
        .onClick(function () { tab._openPop(key); }); });
      var el = s.settingEl || s.el;
      if (el && el.classList) el.classList.add("kbt-help-row");
      return buildPop(box, key, "提示 · " + (TAB_LABEL[key] || ""), HELP[key] || []);
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

    /* R18：状态行（主行 + ⓘ）；副行放细节，没有就不占位。
     * 🔴 文案里**不许出现 Markdown 星号**：setDesc/textContent 都是纯文本，`**` 会原样糊在界面上。 */
    var st0 = statusLine(containerEl, "当前状态：读取中…",
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
        st0.main.textContent = "当前状态：" + main + "（新建根 " + st.root + "）";
        st0.sub.textContent = tail + (st.state === "fresh"
          ? "。下一步：先点「生成预览报告」看看会搬哪些，或用「辅助」里的向导初始化。" : "");
      } catch (e) { st0.main.textContent = "当前状态：读取失败（不影响下方操作）"; }
    })();

    /* R18（效果图 核心操作）：一行一件事，行间一条淡分隔线；预览=主色，执行/回滚=警示色 */
    var coreCard = makeSec(containerEl, "核心操作");
    coreCard.classList.add("kbt-core-actions");
    new obsidian.Setting(coreCard)
      .setName("预览报告")
      .addButton(function (b) { b.setButtonText("生成预览报告").setCta()
        .onClick(async function () { var mod = rebuildModule(); if (mod) await mod.runPreview(); }); });
    new obsidian.Setting(coreCard)
      .setName("执行")
      .addButton(function (b) { b.setButtonText("执行").setWarning()
        .onClick(async function () { var mod = rebuildModule(); if (mod) await mod.startConfirm("execute"); }); });
    new obsidian.Setting(coreCard)
      .setName("回滚")
      .addButton(function (b) { b.setButtonText("回滚").setWarning()
        .onClick(async function () { var mod = rebuildModule(); if (mod) await mod.startConfirm("rollback"); }); });

    /* R18（效果图 辅助）：向导 + 操作日志合成一栏；模块关着也能点（.is-aux 保住指针事件） */
    var auxCard = makeSec(containerEl, "辅助");
    auxCard.classList.add("is-aux");
    new obsidian.Setting(auxCard)
      .setName("首次使用向导").setDesc("重走一遍目录名 / 模块开关的初始化；不改动任何笔记文件")
      .addButton(function (b) { b.setButtonText("打开向导")
        .onClick(function () { if (KB.modules.openWizard) KB.modules.openWizard(plugin); }); });
    new obsidian.Setting(auxCard)
      .setName("操作日志").setDesc("预览 / 执行 / 回滚都会在元数据目录的「05_操作日志」里留一篇可读报告")
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
    helpRow(containerEl, "rebuild");
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
    var stA = statusLine(containerEl, "当前状态：",
      MOD_TIP.automation + "　新建补全 " + (S.automation.createFill !== false ? "开" : "关") +
      "，移动同步 " + (S.automation.fixCenterLink !== false ? "开" : "关") + "。");
    stA.main.textContent = "当前状态：" + (S.modules.automation === true ? "已启用" : "已关闭");
    stA.sub.textContent = "路由 " + routes + " 条 · 模板 " + tplCnt + " 套";

    /* 栏目一：自动补全（两个开关） */
    var fillCard = makeSec(containerEl, "自动补全");
    new obsidian.Setting(fillCard)
      .setName("创建时自动补全")
      .setDesc("只对空白新文件生效，补什么由「当前模板」决定")
      .addToggle(function (t) { t.setValue(S.automation.createFill !== false)
        .onChange(function (v) { S.automation.createFill = v; KB.services.settings.saveSettings(plugin); }); });
    new obsidian.Setting(fillCard)
      .setName("移动后同步")
      .setDesc("移动统一走移动引擎，落位后自动同步 YAML 与尾部双链")
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
      .setDesc("扫描整个知识库补齐缺失项；先出报告再写盘")
      .addButton(function (b) { b.setButtonText("开始扫描").setCta()
        .onClick(async function () {
          var mod = plugin.registry && plugin.registry.active && plugin.registry.active.automation;
          if (!mod) { new obsidian.Notice("知识库工具集：请先打开「笔记自动化」。", 8000); return; }
          var r = await mod.startAutofill();
          if (!r) return;
          if (r.todo === 0) afHint("上次扫描：" + r.scanned + " 篇，没有需要补全的笔记。");
          else afHint("上次扫描：" + r.scanned + " 篇里有 " + r.todo + " 篇待补（已在弹窗里确认）。");
        }); });
    var routesSetting = new obsidian.Setting(batchCard)
      .setName("标签-目录映射表").setDesc("共 " + routes + " 条路由；沿用 note-locator 路由表，R2 首次启动自动迁移")
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
    tplButtons.addButton(function (b) { b.setButtonText("保存模板").setCta()
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
      tplButtons.addButton(function (b) { b.setButtonText("删除此模板").setWarning()
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
      tplButtons.addButton(function (b) { b.setButtonText("恢复内置").setWarning()
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
    addSetting.addButton(function (b) { b.setButtonText("添加").setCta().onClick(function () { addRule(); }); });

    /* R18：帮助（一栏 + 悬浮小窗） */
    helpRow(containerEl, "automation");
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
    var stB = statusLine(containerEl, "当前状态：", MOD_TIP.base);
    stB.main.textContent = "当前状态：" + (S.modules.base === true ? "已启用" : "已关闭");
    stB.sub.textContent = "创作看板 " + (S.modules["base.creationBoard"] !== false ? "开" : "关") +
      " · 内容流 " + (S.modules["base.noteStream"] !== false ? "开" : "关") +
      " · 只读视图，不改动任何笔记";

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

    /* R18：看板显示项（卡片宽度 / 空位铺满整行）在**每个视图自己的 ⚙** 里 ——
     * 它们是视图级配置（存在 .base 的视图块里，跟着笔记走）。这里只放一条指路，不放全局开关：
     * 放全局会把用户为每个看板单独调好的值一把压平。 */
    var adv3 = makeAdv(containerEl);
    new obsidian.Setting(adv3)
      .setName("卡片宽度 / 空位铺满整行")
      .setDesc("按视图设置：在笔记里打开看板 → 视图右上角 ⚙ → 「卡片最小宽度」（160–480 px）与「空位铺满整行」。"
        + "每个看板各存一份，所以这里不放全局开关。");

    /* R18：帮助（一栏 + 悬浮小窗） */
    helpRow(containerEl, "base");
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
