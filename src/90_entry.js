/* 入口：KbToolkitPlugin。onload 第一件事不 await 重量级操作；
 * R1 阶段只装设置页 + 事件总线 + 模块注册表（automation 默认关）。
 * R6：加侧边栏图标（boss 要求「装上就该在侧栏看到入口」），点击 = 打开设置控制台。 */
KB.define("entry", function () {
  var P = KB.services;
  var RIBBON_ICON = "library";
  var RIBBON_TITLE = "知识库工具集：打开控制台";

  /** 打开本插件的设置页；拿不到设置页 API 就退回提示（绝不静默失败） */
  function openSettings(plugin) {
    var app = plugin.app;
    try {
      var st = app && app.setting;
      if (st && typeof st.open === "function" && typeof st.openTabById === "function") {
        st.open();
        st.openTabById(plugin.manifest && plugin.manifest.id ? plugin.manifest.id : "kb-toolkit");
        return true;
      }
    } catch (e) { console.warn("[kb-toolkit] 打开设置页失败", e); }
    new obsidian.Notice("知识库工具集：请到「设置 → 第三方插件 → 知识库工具集」打开控制台。", 9000);
    return false;
  }
  KB.modules.openSettings = openSettings;
  KB.modules.RIBBON_ICON = RIBBON_ICON;

  /**
   * R7：别处（向导、命令）改了配置之后，把**正开着的设置页**重画一遍。
   * 不重画的话页面还显示着老库根名 / 老开关位置，用户以为没保存。
   */
  function refreshSettingTab(plugin) {
    try {
      var tab = plugin && plugin.settingTab;
      if (tab && typeof tab.display === "function" && tab.containerEl) { tab.display(); return true; }
    } catch (e) { console.warn("[kb-toolkit] 重画设置页失败", e); }
    return false;
  }
  KB.modules.refreshSettingTab = refreshSettingTab;

  /**
   * R7：配置落地后的统一收口 —— 落盘 + 让模块真起/真停（refresh）+ 让在跑的模块换脑子（reapply）+ 重画设置页。
   * 向导保存、设置页改路径、拨开关三条路都走这一个函数，避免「有的地方同步了、有的地方忘了」。
   * R8：opts.repaint === false 时**不重画设置页** —— 文本框失焦落库时重画会把正在输入的框换掉
   *     （这就是「一次只能输一个字符」的根因）。此时由调用方就地更新那一行的说明文案。
   * R10-⑤：**必须在这里落盘**。旧版只 refresh+reapply，而设置页三处（路径 / 模块开关 /
   *     看板排除目录）都因本函数存在而跳过了自己的 saveSettings → 改动只活在内存里，
   *     重载插件就丢（boss 第 5 条排查实锤）。落盘失败不阻断模块重配。 */
  function applySettingsChange(plugin, opts) {
    opts = opts || {};
    var reg = plugin && plugin.registry, changed = [];
    /* R32 ⑤：中央表重算**收口到这里**。以前 87（向导保存）/ 75（改路径）两处各自手写
     * `router.util.applySettings(S)`，任何**新的**配置改动调用点都极易漏（漏了 = 中心页
     * 双链仍按老库根推导，得重载插件才对）。现在调用方只管改 settings，这里统一重算。
     * 🔴 onload 那条（本文件下面）留着不动 —— 那是开机路径，没有「配置变更」可收口，
     *    走这里会白白多一次 saveSettings。 */
    if (P["router.util"] && plugin && plugin.settings) P["router.util"].applySettings(plugin.settings);
    return KB.services.settings.saveSettings(plugin).catch(function (e) {
      console.warn("[kb-toolkit] 配置落盘失败", e);
      return null;
    }).then(function () {
      return (reg && reg.refresh) ? reg.refresh() : [];
    }).then(function (c) {
      changed = c || [];
      return (reg && reg.reapply) ? reg.reapply() : [];
    }).then(function (reconfigured) {
      if (opts.repaint !== false) refreshSettingTab(plugin);
      return { changed: changed, reconfigured: reconfigured || [], repainted: opts.repaint !== false, saved: true };
    });
  }
  KB.modules.applySettingsChange = applySettingsChange;

  class KbToolkitPlugin extends obsidian.Plugin {
    async onload() {
      var S = P.settings;
      await S.loadSettings(this);
      /* R5：中心表由结构模板推导（库根改名后自动跟随），必须先应用再起模块 */
      if (P["router.util"]) P["router.util"].applySettings(this.settings);

      this.eventBus = new P.eventBus(this);
      var Registry = P.registry;
      this.registry = new Registry(this);
      this.registry.define("automation", KB.modules.AutomationModule);
      this.registry.define("rebuild", KB.modules.RebuildModule);
      this.registry.define("board", KB.modules.BoardModule);
      this.registry.define("stream", KB.modules.StreamModule);

      this.settingTab = new KB.modules.SettingTab(this.app, this);
      this.addSettingTab(this.settingTab);

      /* R6：侧边栏图标（点击 → 设置控制台） */
      try {
        if (typeof this.addRibbonIcon === "function") {
          this.ribbonEl = this.addRibbonIcon(RIBBON_ICON, RIBBON_TITLE, function () { openSettings(this); }.bind(this));
        }
      } catch (e) { console.warn("[kb-toolkit] 加侧边栏图标失败", e); }

      /* R13（boss：界面翻新）：命令面板只留 4 条高频，这条是插件的总入口（不随模块开关变化）；
       * 其余 3 条由 ① 模块按硬门控注册（预览 / 回滚 / 打开报告），操作按钮都在设置页。 */
      try {
        var self0 = this;
        this.addCommand({ id: "open-settings", name: "打开知识库工具集设置",
          callback: function () { openSettings(self0); } });
      } catch (e) { console.warn("[kb-toolkit] 注册打开设置命令失败", e); }

      await this.registry.enableConfigured();
      this.checkLegacy();
      /* R5：没走过向导就弹一次（用户点「以后再说」后不再自动弹） */
      try { if (KB.modules.maybeShowWizard) KB.modules.maybeShowWizard(this); }
      catch (e) { console.warn("[kb-toolkit] 向导打开失败", e); }
    }

    async onunload() {
      if (this.registry) await this.registry.disableAll();
    }

    checkLegacy() {
      if (!this.settings.legacyCheck) return;
      this.legacyFound = KB.modules.detectLegacy(this);
      if (this.legacyFound.length) {
        var names = this.legacyFound.map(function (l) { return l.id; }).join("、");
        new obsidian.Notice("知识库工具集：检测到旧插件（" + names + "）仍在启用，详见设置页顶部提示。", 8000);
      }
    }
  }
  module.exports = KbToolkitPlugin;
  KB.modules.PluginClass = KbToolkitPlugin;
  return KbToolkitPlugin;
});
