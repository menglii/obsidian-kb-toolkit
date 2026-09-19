/*
 * bases-preview — 笔记内容流（Bases 视图）
 * ------------------------------------------------------------------
 * 补 Obsidian Bases 原生给不了的一件事：**在看板里直接读笔记正文**。
 *   Bases 的卡片/表格只能显示 14 个 file.* 属性 + 前言属性，
 *   **没有「正文」这个属性**，所以原生永远预览不到内容。
 *   本插件用 `Plugin.registerBasesView()` 自注册一个视图类型 `note-stream`，
 *   于是「视图布局」下拉里多出一个「📖 笔记内容流」。
 *
 * 视图行为：
 *   - 按视图的 groupBy 分组；每篇一张卡：标题（内部链接，悬浮即预览）+ 属性胶囊 + 正文
 *   - 正文懒加载：用 IntersectionObserver，滚到附近才读盘 + 渲染（不会一次渲染几百篇）
 *   - 正文来自 vault.cachedRead()，剥掉前言、去掉与标题重复的首个 H1、按选项截断
 *   - 渲染走公开 API MarkdownRenderer.render(app, md, el, sourcePath, component)
 *
 * 视图选项（视图面板里可调）：
 *   正文预览字数 / 最多预览条数 / 显示属性行
 *
 * 全部 API 名已对 obsidian.asar（1.13.x）核实：
 *   Plugin.registerBasesView(id, {name, icon, factory, options})   @3628911
 *     内部: internalPlugins.getEnabledPluginById("bases").registerView(id, reg)
 *   工厂签名: factory(controller, containerEl) -> BasesView          @3234252
 *   控制器在数据刷新时: view.allProperties / view.data = new BasesQueryResult(...) / view.onDataUpdated()
 *   BasesView(公开导出, 内部 XZ): this.app / this.queryController / this.config
 *     this.data 是 BasesQueryResult：.data = BasesEntry[]，getter .groupedData = BasesEntryGroup[]
 *     BasesEntryGroup: { entries, key, hasKey() }
 *     BasesEntry: { file: TFile, frontmatter, getValue(prop) }
 *     辅助方法: this.createGroupHeadingEl(group) / this.createFileForView(group)
 *   视图选项面板会调用 registration.options(config) —— **必须是函数**，返回描述数组
 *     描述项: {displayName, type: "slider"|"toggle"|"text"|"dropdown"|... , key, default, min, max, step}
 *   链接悬浮预览: workspace.trigger("hover-link", {event, source:"bases", hoverParent, targetEl, linktext})
 *     —— "bases" 这个 hover 源由核心 Bases 注册为 defaultMod:true；
 *        defaultMod:true 的含义是「**默认需要按住 Ctrl/Cmd**」才弹（不是免按）；
 *        只有阅读视图的 "preview" 源注册成 false（免按）。
 *   MarkdownRenderer.render(app, markdown, el, sourcePath, component)   @2732156
 *   getFrontMatterInfo(markdown) -> {frontmatter, contentStart}         同上，公开导出
 * ------------------------------------------------------------------
 */
"use strict";

const obsidian = require("obsidian");
const { Plugin, MarkdownRenderer, Notice } = obsidian;

/* BasesView 在 1.9+ 才导出；拿不到时退化成一个空实现，保证插件不至于加载即崩 */
const BasesViewBase =
  obsidian.BasesView ||
  class {
    constructor(controller) {
      this.app = controller && controller.app;
      this.queryController = controller;
    }
  };

const VIEW_TYPE = "note-stream";
const VIEW_NAME = "📖 笔记内容流";
const META_KEYS = ["状态", "领域", "类型", "平台"];

function num(v, dflt) {
  return typeof v === "number" && isFinite(v) ? v : dflt;
}

function humanAgo(ts) {
  const diff = Date.now() - ts;
  if (!isFinite(diff) || diff < 0) return "";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  if (d < 30) return d + " 天前";
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo + " 个月前";
  return Math.floor(mo / 12) + " 年前";
}

/* 截断可能切在代码块中间 —— 围栏数奇数就补一个收尾围栏，避免整段被吞。
 * R15 修：``` 与 ~~~ 分开数 —— 原来混着数，奇数落在这边时补的是另一种，收不住 */
function balanceFences(md) {
  const backtick = (md.match(/^[ \t]*```/gm) || []).length;
  const tilde = (md.match(/^[ \t]*~~~/gm) || []).length;
  if (backtick % 2 === 1) return md + "\n\n```\n";
  if (tilde % 2 === 1) return md + "\n\n~~~\n";
  return md;
}

class NoteStreamView extends BasesViewBase {
  constructor(controller, containerEl) {
    super(controller);
    this.type = VIEW_TYPE;
    this.items = [];
    this.queue = [];
    this.pumping = false;
    this.sig = "";
    this.renderedOnce = false;

    this.rootEl = containerEl.createDiv({ cls: "bases-note-stream" });
    const bar = this.rootEl.createDiv({ cls: "bns-bar" });
    this.countEl = bar.createSpan({ cls: "bns-count", text: "…" });
    const btn = bar.createEl("button", { cls: "bns-refresh", text: "↻ 重载" });
    btn.addEventListener("click", () => this.rebuild(true));
    this.listEl = this.rootEl.createDiv({ cls: "bns-list" });

    try {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            const item = en.target.__bnsItem;
            try {
              this.observer.unobserve(en.target);
            } catch (e) {}
            if (item) this.enqueue(item);
          }
        },
        { root: this.rootEl, rootMargin: "800px 0px 0px 0px" }
      );
    } catch (e) {
      this.observer = null;
    }
  }

  /* ---------- Component 生命周期 ---------- */
  onload() {}
  onunload() {
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (e) {}
    }
    this.queue.length = 0;
  }
  focus() {
    try {
      this.rootEl.focus({ preventScroll: true });
    } catch (e) {}
  }
  onResize() {}

  /* ---------- 选项读取 ---------- */
  optNum(key, dflt) {
    const c = this.config;
    if (!c) return dflt;
    try {
      return num(c.get(key), dflt);
    } catch (e) {
      return dflt;
    }
  }
  optBool(key, dflt) {
    const c = this.config;
    if (!c) return dflt;
    try {
      const v = c.get(key);
      return typeof v === "boolean" ? v : dflt;
    } catch (e) {
      return dflt;
    }
  }

  /* ---------- 数据刷新 ---------- */
  computeSig() {
    const d = this.data;
    if (!d || !Array.isArray(d.data)) return "";
    const out = [this.optNum("chars", 600), this.optNum("maxNotes", 40), this.optBool("showMeta", true)];
    for (const en of d.data) {
      out.push(en.file.path + "@" + en.file.stat.mtime);
    }
    return out.join("\u0001");
  }

  onDataUpdated() {
    const sig = this.computeSig();
    if (sig && sig === this.sig && this.renderedOnce) {
      this.updateBar();
      return; // 数据/选项都没变 —— 别整块重建（会闪、会丢滚动位置）
    }
    this.sig = sig;
    this.renderedOnce = true;
    this.rebuild(false);
  }

  getFm(entry) {
    try {
      const f = entry.frontmatter;
      if (f && typeof f === "object") return f;
    } catch (e) {}
    try {
      const c = this.app.metadataCache.getFileCache(entry.file);
      return (c && c.frontmatter) || {};
    } catch (e) {
      return {};
    }
  }

  rebuild(force) {
    if (this.observer) {
      for (const it of this.items) {
        try {
          this.observer.unobserve(it.bodyEl);
        } catch (e) {}
      }
    }
    this.queue.length = 0;
    this.items = [];
    const keepScroll = force ? 0 : this.rootEl.scrollTop;
    this.listEl.empty();

    const d = this.data;
    if (!d || !Array.isArray(d.data) || d.data.length === 0) {
      this.listEl.createDiv({ cls: "bns-empty", text: "没有匹配的笔记（检查这个视图的过滤条件）" });
      this.updateBar();
      return;
    }

    const chars = this.optNum("chars", 600);
    const maxNotes = this.optNum("maxNotes", 40);
    const showMeta = this.optBool("showMeta", true);

    let idx = 0;
    let groups = [];
    try {
      groups = d.groupedData || [];
    } catch (e) {
      groups = [];
    }
    if (groups.length === 0) groups = [{ entries: d.data, key: null, hasKey: () => false }];

    for (const g of groups) {
      const gEl = this.listEl.createDiv({ cls: "bns-group" });
      let heading = null;
      try {
        if (g && typeof g.hasKey === "function" && g.hasKey()) heading = this.createGroupHeadingEl(g);
      } catch (e) {
        heading = null;
      }
      if (heading) gEl.appendChild(heading);

      const entries = (g && g.entries) || [];
      for (const entry of entries) {
        const file = entry.file;
        const itemEl = gEl.createDiv({ cls: "bns-item" });
        const headEl = itemEl.createDiv({ cls: "bns-head" });

        const titleEl = headEl.createEl("a", { cls: "internal-link bns-title", text: file.basename });
        titleEl.addEventListener("click", (evt) => {
          evt.preventDefault();
          const mod = evt.ctrlKey || evt.metaKey;
          this.app.workspace.openLinkText(file.path, "", mod ? "tab" : false);
        });
        titleEl.addEventListener("mouseover", (evt) => {
          this.app.workspace.trigger("hover-link", {
            event: evt,
            source: "bases",
            hoverParent: this,
            targetEl: titleEl,
            linktext: file.path,
          });
        });

        if (showMeta) {
          /* R14（boss：界面很丑）：徽章最多 2 个，其余收进「+N」—— 中心类笔记一排徽章是纯噪声 */
          const fm = this.getFm(entry);
          const vals = [];
          for (const k of META_KEYS) {
            const v = fm[k];
            if (v === null || v === undefined || v === "") continue;
            vals.push(Array.isArray(v) ? v.join(" · ") : String(v));
          }
          for (let ci = 0; ci < vals.length && ci < 2; ci++)
            headEl.createSpan({ cls: "bns-chip", text: vals[ci] });
          if (vals.length > 2)
            headEl.createSpan({ cls: "bns-chip bns-chip-more", text: "+" + (vals.length - 2) });
        }
        headEl.createSpan({ cls: "bns-mtime", text: humanAgo(file.stat.mtime) });

        idx++;
        if (idx > maxNotes) {
          itemEl.createDiv({ cls: "bns-placeholder", text: "…（超出「最多预览条数」上限，点标题打开）" });
          continue;
        }

        const bodyEl = itemEl.createDiv({ cls: "bns-body bns-loading", text: "滚动到此处自动加载正文…" });
        const item = { file, bodyEl, chars, state: "pending" };
        bodyEl.__bnsItem = item;
        this.items.push(item);
        if (this.observer) this.observer.observe(bodyEl);
      }
    }

    this.updateBar();
    if (keepScroll) {
      try {
        this.rootEl.scrollTop = keepScroll;
      } catch (e) {}
    }
  }

  updateBar() {
    const total = this.data && Array.isArray(this.data.data) ? this.data.data.length : 0;
    const done = this.items.filter((i) => i.state === "done").length;
    const cap = this.optNum("maxNotes", 40);
    this.countEl.setText(
      "共 " + total + " 篇 · 已渲染 " + done + " 篇" + (total > cap ? "（前 " + cap + " 篇）" : "")
    );
  }

  /* ---------- 懒加载队列 ---------- */
  enqueue(item) {
    if (!item || item.state !== "pending") return;
    item.state = "queued";
    this.queue.push(item);
    this.pump();
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift();
        if (!item || item.state !== "queued") continue;
        item.state = "rendering";
        await this.renderBody(item);
        item.state = "done";
        this.updateBar();
      }
    } finally {
      this.pumping = false;
    }
  }

  async renderBody(item) {
    const file = item.file;
    let raw = "";
    try {
      raw = await this.app.vault.cachedRead(file);
    } catch (e) {
      raw = "";
    }

    let body = raw;
    try {
      let info = null;
      if (typeof obsidian.getFrontMatterInfo === "function") info = obsidian.getFrontMatterInfo(raw);
      if (info && typeof info.contentStart === "number") body = raw.slice(info.contentStart);
      else body = raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    } catch (e) {
      body = raw;
    }

    /* 正文开头的 H1 常与文件名重复，去掉一个更省纵向空间 */
    const h1 = body.match(/^\s*#\s+(.+?)[ \t]*\r?\n/);
    if (h1 && h1[1].trim() === String(file.basename).trim()) body = body.slice(h1[0].length);
    body = body.replace(/^\s+/, "");

    let truncated = false;
    if (body.length > item.chars) {
      body = body.slice(0, item.chars);
      truncated = true;
    }
    body = balanceFences(body);

    const el = item.bodyEl;
    el.removeClass("bns-loading");
    el.empty();
    try {
      await MarkdownRenderer.render(this.app, body, el, file.path, this);
    } catch (e) {
      el.empty();
      el.createDiv({ cls: "bns-error", text: "正文渲染失败：" + (e && e.message ? e.message : String(e)) });
    }
    if (truncated) {
      el.createDiv({ cls: "bns-more", text: "…（已截断，全文约 " + raw.length + " 字 · 点标题看全文）" });
    }
  }

  /* ---------- 视图选项 ---------- */
  static getViewOptions() {
    return [
      {
        displayName: "正文预览字数",
        type: "slider",
        key: "chars",
        min: 100,
        max: 3000,
        step: 50,
        default: 600,
        instant: true,
      },
      {
        displayName: "最多预览条数",
        type: "slider",
        key: "maxNotes",
        min: 5,
        max: 300,
        step: 5,
        default: 40,
      },
      {
        displayName: "显示属性行",
        type: "toggle",
        key: "showMeta",
        default: true,
      },
    ];
  }
}

class BasesPreviewPlugin extends Plugin {
  async onload() {
    const ok = this.registerBasesView(VIEW_TYPE, {
      name: VIEW_NAME,
      icon: "lucide-scroll-text",
      factory: (controller, containerEl) => new NoteStreamView(controller, containerEl),
      options: NoteStreamView.getViewOptions,
    });
    if (!ok) {
      console.warn("[bases-preview] 注册 Bases 视图失败：核心插件 Bases 似乎没启用。");
    }
  }
}

module.exports = BasesPreviewPlugin;
