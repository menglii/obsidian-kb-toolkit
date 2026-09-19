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
