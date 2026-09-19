/* 静默窗口（R9）：重建 / 回滚这类「成批搬文件」的操作期间，② 笔记自动化必须让路。
 *
 * 🔴 起因（实验库真机实证，老板报的 5/6/7 条）：
 *   回滚阶段 A 把「本轮新建目录里的外来户」rename 进 `回滚保留-<戳>/`，这会触发 vault 的
 *   rename 事件 → ② 的路由读到那篇笔记的「文件位置」属性 → 算出目标目录就在新知识库里
 *   → 立刻又把它搬回去。结果收容文件夹空了、新库目录仍旧「非空」→ 回滚 blocked
 *   「目录非空 → 保留」、自检报「新建根仍存在」→ 老板看到「回滚无法完成」。
 *   执行时同理：manifest 的搬运会被路由再抢一次，出现「有文件没有成功迁移整理」。
 *
 * 做法：一个挂在 plugin 上的**时间窗**（不是布尔），开了之后
 *   · 事件总线 enqueue 直接丢弃新事件；
 *   · 派发回调**再校验一次**（事件可能在关窗前排队、关窗后才到点）；
 *   · 自动化 handler / handle / tryCreateFill 首段各挡一道（防御性）。
 * 🔴 关窗必须**晚于事件总线的封顶延时**才放行，否则最后一批排队事件会在关窗后落地。
 * 🔴 不用定时器：靠 `until` 时间戳判定，可以注入 now 做确定性断言。
 */
KB.define("core/quiet", function () {
  /* 事件总线的封顶延时是 800ms（20_core_eventbus.js 的 MAX_WAIT.changed），
   * 关窗后要留出比它更大的余量，让排队中的事件先自然过期。 */
  var SETTLE_MS = 1200;
  var KEY = "__kbQuiet";

  function box(plugin) {
    if (!plugin) return null;
    if (!plugin[KEY] || typeof plugin[KEY] !== "object") {
      plugin[KEY] = { active: false, reason: "", until: 0, hits: 0, lastReason: "" };
    }
    return plugin[KEY];
  }

  /** 现在是否处于静默窗口；now 可注入（测试用） */
  function isQuiet(plugin, now) {
    var b = box(plugin);
    if (!b || !b.active) return false;
    var t = (now === undefined) ? Date.now() : now;
    return t < b.until;
  }

  /** 开窗：ms 默认 SETTLE_MS */
  function begin(plugin, reason, ms) {
    var b = box(plugin);
    if (!b) return false;
    b.active = true;
    b.reason = reason || "";
    b.lastReason = b.reason;
    b.until = Date.now() + ((typeof ms === "number") ? ms : SETTLE_MS);
    b.hits = 0;
    return true;
  }

  /** 收工：把放行时刻推到 now + ms（默认 SETTLE_MS），让排队事件先过期 */
  function end(plugin, ms) {
    var b = box(plugin);
    if (!b) return false;
    var wait = (typeof ms === "number") ? ms : SETTLE_MS;
    if (!b.active) { b.active = true; b.reason = b.reason || "settle"; }
    b.until = Date.now() + wait;
    return true;
  }

  /** 立刻放行（异常兜底 / 测试用） */
  function clear(plugin) {
    var b = box(plugin);
    if (!b) return false;
    b.active = false; b.reason = ""; b.until = 0;
    return true;
  }

  /** 记一次「本可以动库、被静默挡住」的调用（诊断用） */
  function note(plugin) {
    var b = box(plugin);
    if (b) b.hits++;
    return b ? b.hits : 0;
  }

  function state(plugin) {
    var b = box(plugin);
    return b ? { active: b.active, reason: b.reason, until: b.until, hits: b.hits,
      lastReason: b.lastReason } : null;
  }

  /** 包一层：静默期内跳过 fn，返回 {skipped:true}（给自动化入口用，读起来一目了然） */
  function guard(plugin, fn) {
    return function () {
      if (isQuiet(plugin)) { note(plugin); return { skipped: true, reason: "quiet" }; }
      return fn.apply(this, arguments);
    };
  }

  KB.service("quiet", { SETTLE_MS: SETTLE_MS, isQuiet: isQuiet, begin: begin, end: end,
    clear: clear, note: note, state: state, guard: guard });
  return { SETTLE_MS: SETTLE_MS, isQuiet: isQuiet, begin: begin, end: end, clear: clear, state: state };
});
