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
