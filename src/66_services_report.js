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
  /** R31：默认路径配置的**唯一真源**在 70_core_settings.js（DEFAULTS.paths）。
   *  本文件编号 66 < 70，定义时拿不到那份常量 → 只在**调用时**读（运行时必然已注册）。
   *  🔴 交叉评审抓出：原来这里写死 `"99_Meta"`，而 run_r5 的硬编码守卫要求
   *     `99_Meta/`（**带斜杠**）→ 裸字面量正好从缝里漏过去，等于默认值在两处各写一遍，
   *     用户改了元目录名之后，只有一处跟着变。守卫的缝由 run_r5 的 A2 断言补上。 */
  function defaultPaths() {
    var S = KB.services && KB.services.settings;
    return (S && S.DEFAULTS && S.DEFAULTS.paths) || null;
  }
  /** 操作日志目录（相对库根）：<root>/<metaDir>/05_操作日志 */
  function logFolder(paths, rootPath) {
    var p = paths || defaultPaths() || {};
    var meta = p.metaDir || "";
    var base = rootPath || p.knowledgeBase || "";
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
    var DIR = opts.pluginDir || KB.PLUGIN_DIR;
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
