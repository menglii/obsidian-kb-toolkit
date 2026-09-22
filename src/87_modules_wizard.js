/* R5：首次使用向导。目标 = 让一个陌生人（或换库的老板）在 30 秒内把「库根名 / 元目录名 / 开哪几个模块」定下来，
 * 而不是去 data.json 里翻字段。只在 settings.wizardDone !== true 时自动弹一次，设置页可随时重开。
 * 全部用原生组件，无自定义 CSS。 */
KB.define("modules/wizard", function () {

  /** 现场检测：库根在不在、旧文件区在不在、顶层有多少待搬项 */
  function detect(plugin) {
    var app = plugin.app, S = plugin.settings;
    var root = null, old = null, tops = [];
    try {
      root = app.vault.getAbstractFileByPath(S.paths.knowledgeBase);
      old = app.vault.getAbstractFileByPath(S.rebuild.oldFolderName);
      var kids = (app.vault.getRoot() && app.vault.getRoot().children) || [];
      var skip = (S.rebuild.excludedTop || []).concat([S.rebuild.oldFolderName, "旧文件"]);
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i].name || kids[i].path;
        if (skip.indexOf(n) >= 0) continue;
        if (n.charAt(0) === ".") continue;
        tops.push(n);
      }
    } catch (e) { /* 检测失败不影响向导可用 */ }
    return { rootExists: !!root, oldExists: !!old, tops: tops };
  }

  function summary(plugin) {
    var S = plugin.settings, d = detect(plugin);
    return {
      knowledgeBase: S.paths.knowledgeBase,
      metaDir: S.paths.metaDir,
      rootExists: d.rootExists,
      oldExists: d.oldExists,
      topCount: d.tops.length,
      topSample: d.tops.slice(0, 5)
    };
  }

  class WizardModal extends obsidian.Modal {
    constructor(app, plugin) {
      super(app);
      this.plugin = plugin;
      this.draft = {
        knowledgeBase: plugin.settings.paths.knowledgeBase,
        metaDir: plugin.settings.paths.metaDir,
        modules: {
          rebuild: plugin.settings.modules.rebuild === true,
          automation: plugin.settings.modules.automation === true,
          base: plugin.settings.modules.base !== false
        }
      };
    }
    onOpen() {
      var self = this, el = this.contentEl;
      var D = KB.services.settings.DEFAULTS.paths;
      el.empty();
      el.createEl("h2", { text: "知识库工具集 · 初次设置" });
      el.createEl("p", { cls: "setting-item-description",
        text: "三步定好：知识库叫什么、开哪几个模块、现在库里是什么状况。全程只读，点「保存」才会写入配置。" });

      /* ① 目录名 */
      el.createEl("h3", { text: "① 知识库叫什么" });
      el.createEl("p", { cls: "setting-item-description",
        text: "「知识库根目录」= 笔记实际存放的顶层目录，也是「新建知识库」建出来的那个目录的名字 —— " +
          "两处共用一个名字，不会各说各话。以后在设置页改它也随时生效。" });
      new obsidian.Setting(el)
        .setName("知识库根目录").setDesc("笔记实际存放的顶层目录，如 " + D.knowledgeBase)
        .addText(function (t) { t.setPlaceholder(D.knowledgeBase)
          .setValue(self.draft.knowledgeBase)
          .onChange(function (v) { self.draft.knowledgeBase = String(v || "").trim(); }); });
      new obsidian.Setting(el)
        .setName("元数据目录名（相对知识库根）").setDesc("模板、指令集、索引所在目录，如 " + D.metaDir)
        .addText(function (t) { t.setPlaceholder(D.metaDir)
          .setValue(self.draft.metaDir)
          .onChange(function (v) { self.draft.metaDir = String(v || "").trim(); }); });

      /* ② 模块 */
      el.createEl("h3", { text: "② 开哪几个模块" });
      var MODS = [
        { key: "rebuild",    name: "① 新建知识库", desc: "预览 · 执行 · 回滚。默认关：它会搬动库里的文件，先看预览再开。" },
        { key: "automation", name: "② 笔记自动化", desc: "新笔记自动补全 · 按属性/标签归位 · 属性下拉候选（启用后旧的 note-locator 会被自动停用，避免双跑）。" },
        { key: "base",       name: "③ 更多的 Base", desc: "创作看板 + 内容流视图。只是换个看法，不动文件，默认开。" }
      ];
      for (var i = 0; i < MODS.length; i++) {
        (function (m) {
          new obsidian.Setting(el).setName(m.name).setDesc(m.desc)
            .addToggle(function (t) { t.setValue(self.draft.modules[m.key] === true)
              .onChange(function (v) { self.draft.modules[m.key] = v; }); });
        })(MODS[i]);
      }

      /* ③ 现场检测 */
      var d = detect(this.plugin);
      var box = el.createEl("div", { cls: "setting-item-description" });
      box.createEl("h3", { text: "③ 现场检测（只读，不改任何文件）" });
      var ul = box.createEl("ul");
      ul.createEl("li", { text: "知识库根「" + this.plugin.settings.paths.knowledgeBase + "」：" + (d.rootExists ? "已存在" : "不存在（新建时新建）") });
      ul.createEl("li", { text: "旧文件区「" + this.plugin.settings.rebuild.oldFolderName + "」：" + (d.oldExists ? "已存在 → 执行走并入模式" : "不存在") });
      ul.createEl("li", { text: "顶层待搬 " + d.tops.length + " 项" + (d.tops.length ? "（" + d.tops.slice(0, 5).join("、") + (d.tops.length > 5 ? "…" : "") + "）" : "") });

      /* 按钮 */
      var row = el.createEl("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.justifyContent = "flex-end";
      row.style.marginTop = "16px";
      var bOk = row.createEl("button", { text: "保存并立即生效", cls: "mod-cta" });
      bOk.addEventListener("click", function () { self.save(); });
      var bLater = row.createEl("button", { text: "以后再说" });
      bLater.addEventListener("click", function () {
        self.plugin.settings.wizardDone = true;          /* 不再自动弹；设置页仍可重开 */
        KB.services.settings.saveSettings(self.plugin);
        self.close();
      });
    }
    save() {
      var self = this;
      var S = this.plugin.settings;
      var prev = { knowledgeBase: S.paths.knowledgeBase, metaDir: S.paths.metaDir,
                   legacyDirs: (S.paths.legacyDirs || []).slice() };
      if (this.draft.knowledgeBase) S.paths.knowledgeBase = this.draft.knowledgeBase;
      if (this.draft.metaDir) S.paths.metaDir = this.draft.metaDir;
      KB.services.settings.reapplyPaths(S, prev);
      /* R32 ⑤：中央表重算已收进 applySettingsChange（下面那个 apply），这里不再手写 */
      S.modules.rebuild = this.draft.modules.rebuild;
      S.modules.automation = this.draft.modules.automation;
      S.modules.base = this.draft.modules.base;
      S.wizardDone = true;
      this.close();
      /* R7：向导保存**必须当场生效**。旧版只写 settings，模块实例与设置页都还是老的 →
       * 老板看到的是「存了像没存，得重载一次」。现在统一走 applySettingsChange：
       * 模块真起/真停 + 在跑的模块按新库根重配 + 正开着的设置页重画。 */
      var apply = KB.modules.applySettingsChange;
      var p = apply ? apply(this.plugin) : KB.services.settings.saveSettings(this.plugin);
      return Promise.resolve(p).then(function () {
        return KB.services.settings.saveSettings(self.plugin);
      }).then(function () {
        new obsidian.Notice("知识库工具集：初次设置已保存并已生效（库根 " + S.paths.knowledgeBase +
          "，模块开关已即时切换）。", 9000);
        return true;
      }, function (e) {
        new obsidian.Notice("知识库工具集：设置已写入，但生效过程出错：" + ((e && e.message) || e), 9000);
        return false;
      });
    }
  }

  function openWizard(plugin) { new WizardModal(plugin.app, plugin).open(); }
  /** 仅在没走过向导时自动弹（onload 调用） */
  function maybeShowWizard(plugin) {
    if (plugin.settings.wizardDone === true) return false;
    openWizard(plugin);
    return true;
  }

  KB.modules.WizardModal = WizardModal;
  KB.modules.openWizard = openWizard;
  KB.modules.maybeShowWizard = maybeShowWizard;
  KB.modules.wizardDetect = detect;
  KB.modules.wizardSummary = summary;
  return WizardModal;
});
