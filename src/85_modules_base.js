/* ③ 更多的 Base：两个 Bases 视图模块 —— 内嵌原件字节不变，VIEW_TYPE 原样保留。
 * onEnable：先停用同名旧插件（防同一视图类型双注册）→ 以隔离 manifest 实例化内嵌插件。
 *
 * 🔴 R9：视图注册必须是**幂等**的，否则「拨一次 ③ 的开关」就弹错（老板报的第 3 条）。
 * 证据链（obsidian.asar 取证）：
 *   ① Plugin.registerBasesView(id,reg) = bases.registerView(id,reg) + this.register(()=>bases.deregisterView(id))
 *      → **注销动作是挂在 Component 的 _events 上的**，只有 load()/unload() 生命周期才会执行它；
 *   ② BasesView.registerView(id) 发现 registrations 里已有该 id 时，只弹
 *      `msgErrorRegisterView`（"Unable to add new Bases view \"<id>\". A view with this ID already exists."），
 *      **不覆盖**原有注册 —— 于是那个视图永远绑在旧的死实例上；
 *   ③ 旧实现只调 inst.onload() / inst.onunload()，**从不走 load()/unload()** →
 *      _loaded 恒为 false、_events 里的 disposer 永不执行 → deregisterView 永远不被调用
 *      → registry.refresh() 重启用（或手动拨开关）时撞名弹错。
 * 双保险：① 生命周期改走 load()/unload()（会跑 disposer，顺带收掉设置页等泄漏）；
 *         ② 注册前先注销同名 id（哪怕某条路径漏了，也不会再弹错）。 */
KB.define("modules/base", function () {
  /* R15 修：disablePlugin 异步不等 → 改为内部 await（本函数变 async，调用侧不变），
   * 压缩「旧插件还没卸干净、新视图已注册」的窗口 */
  async function retire(plugin, id) {
    try {
      var pm = plugin.app.plugins;
      if (!pm || !pm.enabledPlugins || !pm.enabledPlugins.has(id)) return false;
      var r = pm.disablePlugin(id);
      if (r && typeof r.then === "function") { try { await r; } catch (e2) {} }
      plugin.retiredLegacy = plugin.retiredLegacy || [];
      plugin.retiredLegacy.push(id);
      new obsidian.Notice("知识库工具集：「" + id + "」功能已内置，旧插件已自动停用（可在第三方插件列表重新打开）。", 8000);
      return true;
    } catch (e) { console.warn("[kb-toolkit] 停用旧插件失败", id, e); return false; }
  }
  function makeManifest(id, dir, name, version) {
    return { id: id, dir: dir, name: name, version: version, minAppVersion: "1.9.0", author: "阿盘（自研·内嵌）" };
  }
  /**
   * R12（boss 第 7 条）：第三方插件列表多出「创作看板（Bases 视图）」一栏的真根因 ——
   * 内嵌看板 onload 里 `this.addSettingTab(...)`（vendor 3943 行），PluginSettingTab 的
   * 导航名取自内嵌 manifest.name → 设置页左侧栏多出一个幽灵入口。
   * 内嵌实例的功能入口是本插件的设置页，自己那份不许再注册。
   */
  function suppressSettingTab(inst) {
    if (!inst || inst.__kbNoTab) return inst;
    inst.__kbNoTab = true;
    inst.addSettingTab = function () { return null; };
    return inst;
  }
  /** 拿到核心插件 Bases 的视图注册表（拿不到返回 null） */
  function basesOf(app) {
    try {
      var ip = app && app.internalPlugins;
      return (ip && typeof ip.getEnabledPluginById === "function")
        ? ip.getEnabledPluginById("bases") : null;
    } catch (e) { return null; }
  }
  /** 把要注销的视图 id 记在 plugin 上，onDisable 时兜底再注销一次 */
  function rememberView(plugin, id) {
    if (!plugin.kbRegisteredViews) plugin.kbRegisteredViews = [];
    if (plugin.kbRegisteredViews.indexOf(id) < 0) plugin.kbRegisteredViews.push(id);
  }
  /** 幂等化 registerBasesView：注册前先注销同名 id（不覆盖别人的注册，只是给路） */
  function patchViewRegistration(inst, plugin) {
    if (!inst || inst.__kbSafeReg || typeof inst.registerBasesView !== "function") return inst;
    var orig = inst.registerBasesView;
    inst.__kbSafeReg = true;
    inst.registerBasesView = function (vid, reg) {
      try {
        var bases = basesOf(this.app);
        if (bases && typeof bases.deregisterView === "function") {
          var regs = bases.registrations || (typeof bases.getRegistrations === "function" ? bases.getRegistrations() : {}) || {};
          if (Object.prototype.hasOwnProperty.call(regs, vid)) bases.deregisterView(vid);
        }
      } catch (e) { console.warn("[kb-toolkit] 注销同名 Bases 视图失败（继续注册）", vid, e); }
      var r = null;
      try { r = orig.call(this, vid, reg); } catch (e2) { console.error("[kb-toolkit] 注册 Bases 视图失败", vid, e2); }
      rememberView(plugin, vid);
      return r;
    };
    return inst;
  }
  /** 生命周期：优先 load()/unload()（会执行 this.register 收集的 disposer），退回 onload()/onunload() */
  async function loadInstance(inst) {
    if (!inst) return false;
    if (typeof inst.load === "function") {
      try { await inst.load(); return true; }
      catch (e) { console.warn("[kb-toolkit] 内嵌插件 load() 失败，退回 onload()", e); }
    }
    if (typeof inst.onload === "function") { await inst.onload(); return true; }
    return false;
  }
  async function unloadInstance(inst) {
    if (!inst) return false;
    if (typeof inst.unload === "function") {
      try { inst.unload(); return true; }
      catch (e) { console.warn("[kb-toolkit] 内嵌插件 unload() 失败，退回 onunload()", e); }
    }
    if (typeof inst.onunload === "function") { await inst.onunload(); return true; }
    return false;
  }
  /** 兜底：把本模块注册过的视图 id 显式注销（unload 的 disposer 万一没跑到） */
  function deregisterRemembered(plugin) {
    var ids = plugin.kbRegisteredViews || [];
    if (!ids.length) return 0;
    var bases = basesOf(plugin.app), n = 0;
    for (var i = 0; i < ids.length; i++) {
      try {
        if (bases && typeof bases.deregisterView === "function") { bases.deregisterView(ids[i]); n++; }
      } catch (e) { /* 注销失败不致命 */ }
    }
    plugin.kbRegisteredViews = [];
    return n;
  }

  /** 创作看板：VIEW_TYPE = creation-board（原样） */
  function BoardModule(plugin) { this.plugin = plugin; }
  /**
   * R8：创作看板「默认展示整个笔记库」。
   * 看板自己的「排除目录」来自它的插件级设置（自带默认写死 `excludeFolders: "99_Meta"`，
   * 于是默认就挡掉元目录）。我们**不改 vendor 一个字节**，改成：把 kb-toolkit 设置里的值
   * 推给这个内嵌实例（写它自己的 data.json → 重载它的设置）。默认值是空串 = 不排除 = 整个笔记库。
   * 🔴 短路判据必须看「data.json 里有没有这个键」，不能看"取出来的值等于不想要的值"：
   *    没有这个键时读出来也是空串，若就此 return，看板的内部默认 `"99_Meta"` 根本没被压掉，
   *    老板要的「默认整个库」就会落空（这里踩过一次）。
   * 🔴 R9：`saveData` 在目标插件目录**不存在**时会静默失败（asar 取证：writePluginData →
   *    writeJson → adapter.write → fsPromises.writeFile，**不 mkdir** 且 writeJson 吞 ENOENT）。
   *    所以写前先确保 `.obsidian/plugins/<id>/` 存在，写完**回读核对**。
   */
  BoardModule.prototype.applyBoardExclude = async function () {
    var inst = this.inst;
    if (!inst || typeof inst.saveData !== "function") return false;
    var want = this.plugin.settings.modules["base.boardExclude"];
    if (typeof want !== "string") want = "";
    try {
      var d = (typeof inst.loadData === "function") ? await inst.loadData() : null;
      var had = !!(d && typeof d === "object" && !Array.isArray(d)
        && Object.prototype.hasOwnProperty.call(d, "excludeFolders"));
      if (had && String(d.excludeFolders) === want) return false;   /* 已一致 → 不重复写盘 */
      if (!had || !d || typeof d !== "object" || Array.isArray(d)) d = {};
      d.excludeFolders = want;
      await this.ensurePluginDir(inst);
      await inst.saveData(d);
      if (typeof inst.loadSettings === "function") await inst.loadSettings();
      return true;
    } catch (e) {
      console.warn("[kb-toolkit] 同步创作看板「排除目录」失败", e);
      return false;
    }
  };
  /** R9：saveData 不会帮你建目录 —— 目标插件目录不存在时先建出来，否则写盘静默失败 */
  BoardModule.prototype.ensurePluginDir = async function (inst) {
    try {
      var dir = inst && inst.manifest && inst.manifest.dir;
      if (!dir) return false;
      var ad = this.plugin.app.vault.adapter;
      if (!ad || typeof ad.exists !== "function" || typeof ad.mkdir !== "function") return false;
      if (await ad.exists(dir)) return false;
      await ad.mkdir(dir);
      return true;
    } catch (e) { console.warn("[kb-toolkit] 建内嵌插件目录失败", e); return false; }
  };
  /** 配置一变就地重配（设了排除目录 / 改了值 → 立刻推给看板） */
  BoardModule.prototype.onConfigure = function () { return this.applyBoardExclude(); };
  BoardModule.prototype.onEnable = async function () {
    var Old = KB.modules.CreationBoardPlugin;
    if (typeof Old !== "function") throw new Error("内嵌 creation-board 缺失");
    retire(this.plugin, "creation-board");
    this.inst = new Old(this.plugin.app, makeManifest(
      "creation-board", ".obsidian/plugins/kb-toolkit/embed-creation-board", "创作看板（Bases 视图）", "0.1.0"));
    /* R12：data.json 桥不再写 `.obsidian/plugins/creation-board/` —— 那个目录每次启用都被
     * ensureFolder 建回来（OneDrive 还会把它同步复活），看起来就像「删不掉的幽灵插件」。
     * 挪进本插件目录下（内嵌实例的 loadData/saveData 都按 manifest.dir 走）。 */
    suppressSettingTab(this.inst);
    patchViewRegistration(this.inst, this.plugin);
    await loadInstance(this.inst);
    await this.applyBoardExclude();
  };
  BoardModule.prototype.onDisable = async function () {
    var inst = this.inst;
    this.inst = null;
    await unloadInstance(inst);
    deregisterRemembered(this.plugin);
  };

  /** 内容流视图：VIEW_TYPE = note-stream（原样） */
  function StreamModule(plugin) { this.plugin = plugin; }
  StreamModule.prototype.onEnable = async function () {
    var Old = KB.modules.BasesPreviewPlugin;
    if (typeof Old !== "function") throw new Error("内嵌 bases-preview 缺失");
    retire(this.plugin, "bases-preview");
    this.inst = new Old(this.plugin.app, makeManifest(
      "bases-preview", ".obsidian/plugins/kb-toolkit/embed-bases-preview", "笔记内容流（Bases 预览）", "1.0.0"));
    suppressSettingTab(this.inst);
    patchViewRegistration(this.inst, this.plugin);
    await loadInstance(this.inst);
  };
  StreamModule.prototype.onDisable = async function () {
    var inst = this.inst;
    this.inst = null;
    await unloadInstance(inst);
    deregisterRemembered(this.plugin);
  };

  KB.modules.BoardModule = BoardModule;
  KB.modules.StreamModule = StreamModule;
  return { BoardModule: BoardModule, StreamModule: StreamModule };
});
