/* obsidian 桩：实现 kb-toolkit 用到的 API 子集。测试通过覆写 Module._load 注入。
 * R4b 增补：create / createFolder / delete / getFiles / getMarkdownFiles / adapter.exists
 *          文件夹递归 renameFile / Modal / Notice.setMessage / Button.setWarning。 */
/* 🔴 Node 22 自带全局 Event（undici 的），jsdom 的 dispatchEvent 不认它 →
 *    一律从元素所在的 document 造事件。 */
function mkEvent(el, type) {
  const win = (el.ownerDocument && el.ownerDocument.defaultView) || globalThis;
  return new win.Event(type);
}
class Plugin {
  constructor(app, manifest) {
    this.app = app; this.manifest = manifest;
    this._events = []; this._commands = []; this._tabs = []; this.data = null;
    this._basesViews = [];
  }
  /* 🔴 R9 保真修正（asar 取证）：真机生命周期在 Component 上 ——
   *    load()   : 未 _loaded → _loaded=true、执行 onload()
   *    unload() : 已 _loaded → _loaded=false、依次执行 this.register() 收集的 disposer、最后 onunload()
   *  `registerBasesView` 的「注销视图」正是挂在 this.register() 上的！旧桩没有 load/unload/register，
   *  于是「只调 onload/onunload ⇒ deregisterView 永不执行 ⇒ 再注册撞名弹错」在桩里完全不可见。 */
  register(cb) { if (typeof cb === "function") this._events.push(cb); return cb; }
  registerEvent(ev) { this._events.push(ev); return ev; }
  load() {
    const self = this;
    if (self._loaded) return Promise.resolve();
    self._loaded = true;
    const r = (typeof self.onload === "function") ? self.onload() : undefined;
    return (r && typeof r.then === "function") ? r : Promise.resolve();
  }
  unload() {
    const self = this;
    if (!self._loaded) return;
    self._loaded = false;
    while (self._events.length) { const cb = self._events.pop(); try { cb(); } catch (e) { /* 桩里静默 */ } }
    if (typeof self.onunload === "function") self.onunload();
  }
  /* 真机里命令表以 id 为键（同 id 重复注册 = 覆盖），桩照此办理，避免「关掉再打开」变成重复堆叠 */
  addCommand(c) {
    const i = this._commands.findIndex(x => x.id === c.id);
    if (i >= 0) this._commands[i] = c; else this._commands.push(c);
    return c;
  }
  addSettingTab(t) { this._tabs.push(t); return t; }
  /* R9（asar 取证原文）：
   *   registerBasesView=function(e,t){var n=app.internalPlugins.getEnabledPluginById("bases");
   *     return !!n && (n.registerView(e,t), this.register(()=>n.deregisterView(e)), true)} */
  registerBasesView(id, def) {
    this._basesViews.push({ id: id, def: def });
    const bases = (this.app && this.app.internalPlugins && typeof this.app.internalPlugins.getEnabledPluginById === "function")
      ? this.app.internalPlugins.getEnabledPluginById("bases") : null;
    if (!bases) return false;
    bases.registerView(id, def);
    this.register(() => bases.deregisterView(id));
    return true;
  }
  registerDomEvent() {}
  registerInterval(id) { return id; }
  registerEditorExtension() {}
  addStatusBarItem() { return { setText() {}, remove() {}, setAttribute() {} }; }
  /* R6：记住侧边栏图标（icon / title / 回调），供断言「装上就有入口」 */
  addRibbonIcon(icon, title, cb) {
    const el = { icon: icon, title: title, click: cb, hidden: false,
      setAttribute() {}, remove() { this.hidden = true; } };
    this._ribbons = this._ribbons || [];
    this._ribbons.push(el);
    Plugin.lastRibbons = this._ribbons;
    return el;
  }
  loadData() { return Promise.resolve(this.data); }
  saveData(d) { this.data = d; return Promise.resolve(); }
}
class Notice {
  constructor(msg, ttl) {
    this.message = String(msg); this.ttl = ttl; this.hidden = false;
    Notice.last = String(msg); Notice.all.push(String(msg));
  }
  setMessage(m) { this.message = String(m); Notice.last = String(m); Notice.all.push(String(m)); }
  hide() { this.hidden = true; }
  setMessageAsync() { return Promise.resolve(); }
}
Notice.all = [];
class Modal {
  constructor(app) {
    this.app = app; this.opened = false; this.shouldClose = false;
    this.contentEl = document.createElement("div");
    this.titleEl = document.createElement("div");
    this.modalEl = document.createElement("div");
  }
  open() { this.opened = true; if (this.onOpen) this.onOpen(); return this; }
  close() {
    this.opened = false;
    if (this.onClose) this.onClose();
    if (this.onClosed) this.onClosed();
    return this;
  }
}
class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = null; }
}
class Setting {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.el = document.createElement("div");
    this.el.className = "setting-item";   /* R13 保真：真机 Setting 的根元素就带 setting-item 类 */
    this.el._setting = this;          /* R6：让测试能从 DOM 反查 Setting（按名字取开关） */
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.el.appendChild(this.nameEl);
    this.el.appendChild(this.descEl);
    containerEl.appendChild(this.el);
  }
  setName(v) { this._name = v; this.nameEl.textContent = typeof v === "string" ? v : ""; return this; }
  setDesc(v) { this._desc = v; this.descEl.textContent = typeof v === "string" ? v : ""; return this; }
  setHeading() { return this; }
  addToggle(fn) {
    const t = { value: null, onChange: null,
      setValue(v) { this.value = v; return this; },
      onChange(cb) { this.onChange = cb; return this; } };
    fn(t); this._toggle = t; return this;
  }
  addButton(fn) {
    const buttonEl = document.createElement("button");
    const b = {
      text: null, warning: false, cta: false, _clicks: [],
      setButtonText(v) { this.text = v; buttonEl.textContent = v; return this; },
      setCta() { this.cta = true; return this; },
      setWarning() { this.warning = true; return this; },
      setTooltip(v) { this.tooltip = v; return this; },
      setDisabled(v) { this.disabled = v; buttonEl.disabled = !!v; return this; },
      onClick(cb) { this._clicks.push(cb); buttonEl.addEventListener("click", cb); return this; }
    };
    fn(b);
    this._buttons = this._buttons || [];
    this._buttons.push(b);
    this.el.appendChild(buttonEl);
    return this;
  }
  /* R5：向导与路径设置用到的文本输入
   * 🔴 R8 保真修正：真机的 TextComponent.onChange 挂在 **input 事件**上（每按一个键都回调，
   *    obsidian.asar 取证：`t.addEventListener("input", n.onChanged.bind(n))`）。
   *    桩原来只挂 change，掩盖了「每敲一个字就重画设置页」这个 bug。
   *    现在 input + change 都挂（既保真、又兼容老用例里 dispatch("change") 的写法）。 */
  addText(fn) {
    const inputEl = document.createElement("input");
    const t = {
      value: null, placeholder: null, _change: null, inputEl,
      setValue(v) { this.value = v == null ? "" : String(v); inputEl.value = this.value; return this; },
      setPlaceholder(v) { this.placeholder = v; inputEl.placeholder = v; return this; },
      onChange(cb) {
        this._change = cb;
        inputEl.addEventListener("input", cb);
        inputEl.addEventListener("change", cb);
        return this;
      },
      /* 测试里模拟用户输入：改值 + 触发 input/change */
      setValueAndFire(v) { this.setValue(v); if (this._change) this._change(this.value); return this; },
      /* R8：模拟「敲键盘」——只让它走 onChange（不改 DOM 值），用来验「按键期间不落库」 */
      typeFire(v) { inputEl.value = String(v); if (this._change) this._change(inputEl.value); return this; },
      /* R8：模拟「失焦」——真机在 blur 时才落库 */
      blurFire() { inputEl.dispatchEvent(mkEvent(inputEl, "blur")); return this; }
    };
    fn(t);
    this._text = t;
    this.el.appendChild(inputEl);
    return this;
  }
  /* R7：模板正文用多行输入 */
  addTextArea(fn) {
    const inputEl = document.createElement("textarea");
    const t = {
      value: null, placeholder: null, _change: null, inputEl,
      setValue(v) { this.value = v == null ? "" : String(v); inputEl.value = this.value; return this; },
      setPlaceholder(v) { this.placeholder = v; inputEl.placeholder = v; return this; },
      onChange(cb) {
        this._change = cb;
        inputEl.addEventListener("input", cb);
        inputEl.addEventListener("change", cb);
        return this;
      },
      setValueAndFire(v) { this.setValue(v); if (this._change) this._change(this.value); return this; },
      typeFire(v) { inputEl.value = String(v); if (this._change) this._change(inputEl.value); return this; },
      blurFire() { inputEl.dispatchEvent(mkEvent(inputEl, "blur")); return this; }
    };
    fn(t);
    this._textarea = t;
    this.el.appendChild(inputEl);
    return this;
  }
  addExtraButton(fn) {
    const b = { setIcon(v) { this.icon = v; return this; }, setTooltip(v) { this.tooltip = v; return this; },
      onClick(cb) { this.cb = cb; return this; } };
    fn(b); this._extraButton = b; return this;
  }
  /* R7：模板选择用下拉 */
  addDropdown(fn) {
    const selectEl = document.createElement("select");
    const d = {
      value: null, options: [], _change: null, selectEl,
      addOption(v, label) {
        this.options.push({ value: v, label: label });
        const o = document.createElement("option");
        o.value = v; o.textContent = label;
        selectEl.appendChild(o);
        return this;
      },
      addOptions(obj) { for (const k in obj) this.addOption(k, obj[k]); return this; },
      setValue(v) { this.value = v == null ? "" : String(v); selectEl.value = this.value; return this; },
      getValue() { return this.value; },
      setDisabled(v) { this.disabled = !!v; return this; },
      onChange(cb) { this._change = cb; selectEl.addEventListener("change", cb); return this; },
      setValueAndFire(v) { this.setValue(v); if (this._change) this._change(this.value); return this; }
    };
    fn(d);
    this._dropdown = d;
    this.el.appendChild(selectEl);
    return this;
  }
}
class TFolder {
  constructor(path) {
    this.path = path;
    this.children = [];
    this.name = path.split("/").pop();
    this.parent = null;
  }
}
class TFile {
  constructor(path, content) {
    this.path = path;
    this.name = path.split("/").pop();
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.indexOf(".") >= 0 ? this.name.split(".").pop() : "";
    this.content = content === undefined ? "" : String(content);
    this.parent = null;
    this.stat = { size: Buffer.byteLength(this.content, "utf8") };
  }
}
function normalizePath(p) { return String(p).replace(/\\/g, "/"); }
function getAllTags(cache) {
  if (!cache || !cache.tags) return [];
  return cache.tags.map(t => String(t.tag || t).replace(/^#/, ""));
}

/* ---- 虚拟文件系统（只认 VIRTUAL 注册/创建的路径） ---- */
const VIRTUAL = new Map();
function attachTo(parent, child) {
  if (parent && Array.isArray(parent.children) && parent.children.indexOf(child) < 0) {
    parent.children.push(child);
    if (!child.parent) child.parent = parent;
  }
}
function detachFrom(parent, child) {
  if (parent && Array.isArray(parent.children)) {
    const i = parent.children.indexOf(child);
    if (i >= 0) parent.children.splice(i, 1);
  }
}
function makeApp() {
  const adapterFiles = new Map();          /* adapter 层（.obsidian/ 下配置等） */
  const disabled = [];                     /* disablePlugin 记录 */
  const saves = [];                        /* disablePluginAndSave 落盘记录（R10） */
  const trashed = [];                      /* trashFile 走的路径（回滚删除必须走这条） */
  const enabled = new Set();               /* enabledPlugins（可被 disablePlugin 移除） */
  const rootFolder = new TFolder("/");     /* 库根；测试往 children 里塞顶层条目 */
  /* R7：事件可被测试主动触发（fire）。真机里 create → metadataCache.changed 是连续两条，
   * 这正是「创建补全被 changed 吞掉」那个 bug 的现场，桩必须能复现它。 */
  const handlers = { create: [], rename: [], changed: [] };
  function onOf(kind) {
    return function (name, cb) {
      const slot = handlers[name] || (handlers[name] = []);
      slot.push(cb);
      return { type: "stub", name: name, cb: cb };
    };
  }
  function fire(name, file) {
    const slot = handlers[name] || [];
    for (const cb of slot.slice()) cb(file);
    return slot.length;
  }
  const vault = {
    on: onOf("vault"),
    getRoot() { return rootFolder; },
    getAbstractFileByPath(path) { return VIRTUAL.get(normalizePath(path)) || null; },
    fire(name, file) { return fire(name, file); },
    _handlers: handlers,
    getFiles() { return Array.from(VIRTUAL.values()).filter(f => f.children === undefined); },
    getMarkdownFiles() {
      return Array.from(VIRTUAL.values()).filter(f => f.children === undefined && f.extension === "md");
    },
    async process(file, fn) {
      const res = fn(file.content);
      if (res !== undefined && res !== file.content) {
        file.content = res;
        file.stat = { size: Buffer.byteLength(String(res), "utf8") };
      }
    },
    cachedRead: async (file) => file.content,
    async create(path, content) {
      path = normalizePath(path);
      if (VIRTUAL.has(path)) throw new Error("File already exists: " + path);
      const dir = path.indexOf("/") >= 0 ? path.slice(0, path.lastIndexOf("/")) : "";
      const parent = dir ? VIRTUAL.get(dir) : rootFolder;
      if (!parent || parent.children === undefined) throw new Error("Parent folder missing: " + dir);
      const f = new TFile(path, content);
      f.parent = parent;
      parent.children.push(f);
      VIRTUAL.set(path, f);
      return f;
    },
    async createFolder(path) {
      path = normalizePath(path);
      const segs = path.split("/").filter(s => s.length > 0);
      let cur = "", folder = null;
      for (const seg of segs) {
        cur = cur ? cur + "/" + seg : seg;
        let f = VIRTUAL.get(cur);
        if (!f) {
          f = new TFolder(cur);
          const parentPath = cur.indexOf("/") >= 0 ? cur.slice(0, cur.lastIndexOf("/")) : "";
          f.parent = parentPath ? (VIRTUAL.get(parentPath) || null) : rootFolder;
          VIRTUAL.set(cur, f);
          attachTo(f.parent, f);
        }
        folder = f;
      }
      return folder;
    },
    async delete(file, force) {
      if (!file) return;
      if (file.children !== undefined) {
        if (file.children.length && !force) throw new Error("Folder not empty: " + file.path);
        for (const c of file.children.slice()) await vault.delete(c, force);
      }
      VIRTUAL.delete(file.path);
      detachFrom(file.parent, file);
    },
    adapter: {
      async read(p) {
        if (!adapterFiles.has(p)) throw new Error("file not found: " + p);
        return adapterFiles.get(p);
      },
      async write(p, data) { adapterFiles.set(p, String(data)); },
      async exists(p) { return VIRTUAL.has(normalizePath(p)) || adapterFiles.has(p); },
      async remove(p) { adapterFiles.delete(p); },
      _files: adapterFiles
    }
  };
  const metadataCache = {
    on: onOf("metadataCache"),
    fire(name, file) { return fire(name, file); },
    _handlers: handlers,
    getFileCache(f) { return f.cache || {}; },
    /* R10：真机行为（asar：getFrontmatterPropertyValuesForKey 从库内笔记收集属性值候选）。
     * 桩等价实现：扫全部 .md 的 cache.frontmatter[key]。属性候选值补丁的测试都压在这上面。 */
    getFrontmatterPropertyValuesForKey(key) {
      const out = [];
      for (const f of VIRTUAL.values()) {
        if (f.children !== undefined || f.extension !== "md") continue;
        const fm = f.cache && f.cache.frontmatter;
        if (!fm || fm[key] == null) continue;
        const v = fm[key];
        if (Array.isArray(v)) for (const x of v) { if (x != null) out.push(String(x)); }
        else out.push(String(v));
      }
      return out;
    }
  };
  const fileManager = {
    /* 真机里 trashFile 按 trashOption 分流到系统回收站/本地 .trash/永久删；桩等价于删除并记账 */
    async trashFile(file) { trashed.push(file.path); return vault.delete(file, true); },
    async processFrontMatter(file, fn) {
      /* 简化桩：frontmatter 以对象形式挂在 file.fm 上，fn 就地改 */
      file.fm = file.fm || {};
      fn(file.fm);
    },
    async renameFile(file, newPath) {
      newPath = normalizePath(newPath);
      const oldPath = file.path;
      const wasFolder = file.children !== undefined;
      const oldParent = file.parent;
      VIRTUAL.delete(oldPath);
      if (wasFolder) {
        /* 文件夹改名：子孙路径整体跟随（与真机 fileManager 行为一致） */
        for (const [k, v] of Array.from(VIRTUAL.entries())) {
          if (k.indexOf(oldPath + "/") !== 0) continue;
          VIRTUAL.delete(k);
          v.path = newPath + k.slice(oldPath.length);
          v.name = v.path.split("/").pop();
          if (v.basename !== undefined) v.basename = v.name.replace(/\.[^.]+$/, "");
          VIRTUAL.set(v.path, v);
        }
      }
      file.path = newPath;
      file.name = newPath.split("/").pop();
      if (file.basename !== undefined) file.basename = file.name.replace(/\.[^.]+$/, "");
      VIRTUAL.set(newPath, file);
      /* 维护父级 children（真机里文件树就是这么走的；顶层枚举/断言依赖它） */
      detachFrom(oldParent, file);
      const dir = newPath.indexOf("/") >= 0 ? newPath.slice(0, newPath.lastIndexOf("/")) : "";
      const newParent = dir ? VIRTUAL.get(dir) : rootFolder;
      if (newParent && newParent.children !== undefined) {
        file.parent = newParent;
        attachTo(newParent, file);
      } else if (newParent === null || newParent === undefined) {
        file.parent = null;
      }
      return file;
    }
  };
  const settingApi = {
    _opened: 0, _lastTab: null,
    open() { this._opened++; },
    openTabById(id) { this._lastTab = id; }
  };
  /* R9（asar 取证）：核心插件 Bases 的视图注册表 ——
   *   registerView(id,reg): registrations 里已有该 id ⇒ **不覆盖**，只弹
   *     `msgErrorRegisterView`（"Unable to add new Bases view \"<id>\". A view with this ID already exists."）
   *   deregisterView(id)  : delete registrations[id]
   * 桩必须照此办理，否则「双注册」这条 bug 在离线套件里永远测不出来。 */
  const bases = {
    registrations: {}, _errors: [],
    registerView(id, reg) {
      if (Object.prototype.hasOwnProperty.call(this.registrations, id)) {
        const msg = 'Unable to add new Bases view "' + id + '". A view with this ID already exists.';
        this._errors.push(msg);
        try { new Notice(msg); } catch (e) { /* 无 Notice 时忽略 */ }
        return false;
      }
      this.registrations[id] = reg;
      return true;
    },
    deregisterView(id) { delete this.registrations[id]; },
    getRegistration(id) {
      return Object.prototype.hasOwnProperty.call(this.registrations, id) ? this.registrations[id] : null;
    },
    getRegistrations() { return this.registrations; },
    onDisable() { for (const k in this.registrations) delete this.registrations[k]; }
  };
  const internalPlugins = {
    _bases: bases,
    getEnabledPluginById(id) { return id === "bases" ? bases : null; },
    getPluginById(id) { return id === "bases" ? bases : null; }
  };
  const app = { vault, metadataCache, fileManager, internalPlugins,
    plugins: { enabledPlugins: enabled,
      disablePlugin(id) { disabled.push(id); enabled.delete(id); },
      /* R10：真机（asar）有 disablePluginAndSave = 停用 + 持久化 community-plugins.json。
       * 旧插件收编按钮走这条；桩记 _saves 供断言。 */
      async disablePluginAndSave(id) {
        this.disablePlugin(id); saves.push(id); return true;
      },
      _saves: saves },
    /* R6：命令表（addCommand 走 plugin，移除走 app.commands.removeCommand） */
    commands: { _removed: [],
      removeCommand(id) { this._removed.push(id); return true; } },
    setting: settingApi,
    workspace: { on() { return { type: "stub" }; }, getActiveFile() { return null; } } };
  app.__root = rootFolder;
  app.__disabled = disabled;
  app.__saves = saves;
  app.__trashed = trashed;
  app.__bases = bases;
  return app;
}

module.exports = { Plugin, Notice, Modal, PluginSettingTab, Setting, TFolder, TFile,
  normalizePath, getAllTags, makeApp, VIRTUAL, mkEvent };
