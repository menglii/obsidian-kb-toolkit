/* 笔记自动化模块：事件订阅 → 路由解析 → 移动/回填/中心链（note-locator handle 原样移植到服务层组合）。
 * R1 仅注册不启用（settings.modules.automation 默认 false，避免与线上插件双跑）；R2 切换轮打开。 */
KB.define("modules/automation", function () {
  function AutomationModule(plugin) {
    this.plugin = plugin;
    this.busy = new Set();
    this.stats = { moved: 0, filled: 0, blocked: 0, center: 0, deferred: 0, refused: 0 };
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
      /* R17：该目录已被 Templater 的「目录模板」接管 → 让路，不抢着写。
       * 依据：Templater 只在「剥前言后正文为空」时才套它的模板，两个插件都写必互相覆盖。 */
      var TPL = KB.services.templates;
      if (TPL.templaterFolderRule(app, parentPath)) { this.stats.deferred++; return false; }
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
