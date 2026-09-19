/* 事件总线：vault/metadataCache 事件统一分发，按文件 debounce 去重。
 * 取代 note-locator 时代的 setTimeout(500) 补丁；批量移动（新建知识库）时天然合并风暴。
 * 🔴 R7 修的坑：同一条路径的事件必须**按种类合并**，不能后来者覆盖前者。
 *   真机新建一篇笔记的顺序是 create → metadataCache.changed（同一路径）。旧实现里
 *   changed 会把还没到点的 create 计时器清掉、把自己排进去，结果 kind 变成 "changed"，
 *   `tryCreateFill` 那一支永远不执行 —— 4 篇 0 字节的「未命名.md」就是这么来的。
 *   现在改成 kinds 集合累积 + 取最长延时 + 派发时按 create > rename > changed 取优先级。
 * 🔴 R8 提速：原来 create 写死等 800ms（怕 Templater 还没落笔），用户体感「新建要等半秒到一秒」。
 *   改成**自适应**：起步只等 180ms（无干扰就直接补全）；这期间只要同一条路径又来事件
 *   （Templater 落笔 → metadataCache.changed），就再续 180ms，累计不超过 800ms。
 *   于是「安静的新建」快到 180ms，「热闹的新建」照样等得住。 */
KB.define("core/eventBus", function () {
  var DEFAULT_DELAY = { create: 180, rename: 0, changed: 180 };
  /* 单条路径最多等多久（防止持续写入把补全无限期推迟） */
  var MAX_WAIT = { create: 800, rename: 0, changed: 800 };
  /* 派发优先级：create 最重（它带着「是否要补全」的判断），其余只需触发一次 reroute */
  var KIND_ORDER = ["create", "rename", "changed"];

  function EventBus(plugin) {
    this.plugin = plugin;
    this.handlers = [];
    this.pending = {};     // path -> {kinds, file, delay, timer}
    this.started = false;
  }
  /** R9：重建/回滚期间整条总线静默（KB.services.quiet 的开窗期）。
   *  这类操作一次要搬几十个文件，事件全喂给 ② 只会造成「搬完又被搬回去」。 */
  EventBus.prototype.quiet = function () {
    var q = KB.services.quiet;
    return !!(q && q.isQuiet && q.isQuiet(this.plugin));
  };
  EventBus.prototype.on = function (h) { this.handlers.push(h); return h; };
  EventBus.prototype.off = function (h) {
    var i = this.handlers.indexOf(h);
    if (i >= 0) this.handlers.splice(i, 1);
  };
  /** 合并后的实际派发种类（不从 kinds 里删，便于重复调用时结果稳定） */
  function pickKind(kinds) {
    for (var i = 0; i < KIND_ORDER.length; i++) if (kinds[KIND_ORDER[i]]) return KIND_ORDER[i];
    return "changed";
  }
  /** 这堆种类允许的最长等待（取其中最大的那个上限） */
  function capFor(kinds) {
    var cap = 0;
    for (var k in kinds) if (kinds[k]) cap = Math.max(cap, MAX_WAIT[k] || 800);
    return cap || 800;
  }
  EventBus.prototype.enqueue = function (kind, file, delay, oldPath) {
    if (!file || file.extension !== "md" || !this.handlers.length) return;
    /* R9：静默窗口内进来的事件直接丢弃（重建/回滚一次要搬几十个文件）。 */
    if (this.quiet()) { var q = KB.services.quiet; if (q && q.note) q.note(this.plugin); return; }
    var self = this;
    var path = file.path;
    var old = this.pending[path];
    var kinds = old ? old.kinds : {};
    kinds[kind] = true;
    /* R11（boss 第 1 条）：rename 要带上 oldPath —— 手动拖动是一次「跨目录 rename」，
     * 处理端要靠它区分「用户在拖」和「插件自己在搬」。 */
    var op = oldPath || (old && old.oldPath) || null;
    var d = (delay === undefined ? DEFAULT_DELAY[kind] : delay) || 0;
    /* R8 自适应续期：起步 180ms；每来一个同路径事件就按它自己的延时再续一截，累计不超过 capFor。
     * 旧实现是 max(old.delay, d) —— 每个事件都把 deadline 重新推 800ms，白等。
     * 注意续期量用**事件自己的 delay**（不是固定步长），这样显式传小延时的调用方行为可预期。 */
    var wait;
    /* R15 修：MAX_WAIT 封的本该是「从**第一次入队**算起的总时长」—— 原来只封单次
     * 续期量，而 old.delay 不随时间衰减，持续写入每个事件都能把完整 800ms 重推，
     * 注释承诺的「防止无限期推迟」从未生效。现记录 firstAt，总期限到了立即派发。 */
    var now = Date.now();
    var firstAt = (old && old.firstAt) || now;
    var remain = firstAt + capFor(kinds) - now;
    if (old) wait = Math.min(old.delay + d, remain > 0 ? remain : 0);
    else wait = Math.min(d, capFor(kinds));
    if (old && old.timer) clearTimeout(old.timer);
    var entry = { kinds: kinds, file: file, delay: wait, timer: null, oldPath: op, firstAt: firstAt };
    entry.timer = setTimeout(function () {
      delete self.pending[path];
      /* R9：事件可能在**关窗之前**排队、**关窗之后**才到点 —— 到点必须再校验一次，
       * 否则最后一批（≤800ms）事件会漏过闸门，等于没静默。 */
      if (self.quiet()) { var q2 = KB.services.quiet; if (q2 && q2.note) q2.note(self.plugin); return; }
      var k = pickKind(kinds);
      for (var i = 0; i < self.handlers.length; i++) {
        try { self.handlers[i](k, entry.file, entry.oldPath); }
        catch (e) { console.error("[kb-toolkit] 事件处理失败", path, e); }
      }
    }, wait);
    this.pending[path] = entry;
  };
  EventBus.prototype.start = function () {
    if (this.started) return;
    var self = this;
    var p = this.plugin;
    p.registerEvent(p.app.vault.on("create", function (f) { self.enqueue("create", f); }));
    /* R11：rename 的第二个参数 oldPath 是「手动拖动」的判据，透传给处理端 */
    p.registerEvent(p.app.vault.on("rename", function (f, oldPath) { self.enqueue("rename", f, undefined, oldPath); }));
    p.registerEvent(p.app.metadataCache.on("changed", function (f) { self.enqueue("changed", f); }));
    this.started = true;
  };
  EventBus.prototype.stop = function () {
    for (var path in this.pending) if (this.pending[path].timer) clearTimeout(this.pending[path].timer);
    this.pending = {};
    this.started = false;
  };
  KB.service("eventBus", EventBus);
  EventBus.DEFAULT_DELAY = DEFAULT_DELAY;
  EventBus.MAX_WAIT = MAX_WAIT;
  return EventBus;
});
