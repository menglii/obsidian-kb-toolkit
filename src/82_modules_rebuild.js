/* ① 新建知识库模块。
 * R4a：只读预览（plan → rebuild-preview.json + rebuild-manifest.json）
 * R4b：执行 / 回滚 / 状态，全部走「二次确认弹窗 → 确认后才动库」；执行过程写 rebuild-journal.json。
 * R6：三种操作都落一篇**可读的操作日志笔记**（见 66_services_report.js），Notice 改成多行明细，
 *     并给一条「打开最近一次报告」命令。
 * 危险操作一律不自动触发：命令 → 弹窗 → 勾选坚果云已同步 → 点确认。 */
KB.define("modules/rebuild", function () {
  var DIR = KB.PLUGIN_DIR + "/";   /* R31：字面量收回 00_prelude.js 的唯一出口 */
  var PLUGDIR = KB.PLUGIN_DIR;
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
