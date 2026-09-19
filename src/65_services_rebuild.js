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
