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
