/* 模块注册制：可分享 / 可扩展 / 可维护的核心。
 * 新功能 = 写一个模块类 {id, onEnable(), onDisable()} → registry.define() 即接入设置页与生命周期。 */
KB.define("core/registry", function () {
  function ModuleRegistry(plugin) {
    this.plugin = plugin;
    this.defs = [];        // [{id, modClass}]
    this.active = {};      // id -> instance
  }
  ModuleRegistry.prototype.define = function (id, modClass) {
    this.defs.push({ id: id, modClass: modClass });
  };
  /** 按 settings.modules 开关启用；③ 更多的 Base 是总闸，其子开关见 base.* */
  ModuleRegistry.prototype.isEnabled = function (id) {
    var m = this.plugin.settings.modules;
    if (id === "automation") return m.automation === true;
    if (id === "rebuild") return m.rebuild === true;
    if (id === "board") return m.base === true && m["base.creationBoard"] !== false;
    if (id === "stream") return m.base === true && m["base.noteStream"] !== false;
    return false;
  };
  ModuleRegistry.prototype.defById = function (id) {
    for (var i = 0; i < this.defs.length; i++) if (this.defs[i].id === id) return this.defs[i];
    return null;
  };
  ModuleRegistry.prototype.enableConfigured = async function () {
    for (var i = 0; i < this.defs.length; i++) {
      var d = this.defs[i];
      if (!this.isEnabled(d.id)) continue;
      var inst = new d.modClass(this.plugin);
      await inst.onEnable();
      this.active[d.id] = inst;
    }
  };
  /** 单个模块启停（设置页拨开关后即时生效，不必重载插件） */
  ModuleRegistry.prototype.enable = async function (id) {
    if (this.active[id]) return false;
    var d = this.defById(id);
    if (!d) return false;
    var inst = new d.modClass(this.plugin);
    await inst.onEnable();
    this.active[id] = inst;
    return true;
  };
  ModuleRegistry.prototype.disable = async function (id) {
    var inst = this.active[id];
    if (!inst) return false;
    try { await inst.onDisable(); } catch (e) { console.error("[kb-toolkit] 停用模块失败", id, e); }
    delete this.active[id];
    return true;
  };
  /**
   * R6：把「在跑的模块」对齐到「settings.modules 现状」。
   * 🔴 设置页拨开关只改了 settings，模块实例还活着 → 关了开关命令照样能执行（boss 报的 bug）。
   * 返回变更清单（"‑rebuild" 之类）供断言与调试。
   */
  ModuleRegistry.prototype.refresh = async function () {
    var changed = [];
    for (var i = 0; i < this.defs.length; i++) {
      var id = this.defs[i].id;
      var want = this.isEnabled(id);
      var has = !!this.active[id];
      if (want && !has) { if (await this.enable(id)) changed.push("+" + id); }
      else if (!want && has) { if (await this.disable(id)) changed.push("-" + id); }
    }
    return changed;
  };
  ModuleRegistry.prototype.isActive = function (id) { return !!this.active[id]; };
  /**
   * R7：配置变了（库根名 / 路由表 / 模板 / 排除规则）→ 让**在跑的模块**就地重建自己的运行时。
   * 与 refresh() 的分工：refresh 管「该不该跑」，reapply 管「跑着的那个该不该换脑子」。
   * 不重启命令、不换实例，所以不会丢监听；模块没实现 onConfigure 就跳过。
   */
  ModuleRegistry.prototype.reapply = async function () {
    var changed = [];
    for (var id in this.active) {
      var inst = this.active[id];
      if (!inst || typeof inst.onConfigure !== "function") continue;
      try { await inst.onConfigure(); changed.push(id); }
      catch (e) { console.error("[kb-toolkit] 重配模块失败", id, e); }
    }
    return changed;
  };
  ModuleRegistry.prototype.disableAll = async function () {
    for (var id in this.active) {
      try { await this.active[id].onDisable(); } catch (e) { console.error("[kb-toolkit] 停用模块失败", id, e); }
    }
    this.active = {};
  };
  KB.service("registry", ModuleRegistry);
  return ModuleRegistry;
});
