/* 生成 samples/示例库（R5 分享用）。
 * 关键点：种子文件的正文由插件自己的 RebuildService.seedContent() 产出 →
 * 示例库与「重建」生成的结果**字节一致**，run_r5.js 会重新算一遍比对。
 * 用法: node scripts/make_sample_vault.js
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "samples", "示例库");
const STUB = require(path.join(ROOT, "tests", "stub_obsidian.js"));

const dom = require("jsdom");
const d = new dom.JSDOM("<body></body>");
global.document = d.window.document;
d.window.Element.prototype.createEl = function (tag, opts) {
  opts = opts || {};
  const el = document.createElement(tag);
  if (opts.text != null) el.textContent = opts.text;
  if (opts.cls) el.className = opts.cls;
  this.appendChild(el);
  return el;
};
d.window.Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };

const origLoad = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return STUB;
  return origLoad.apply(this, arguments);
};

require(path.join(ROOT, "main.js"));
const KB = globalThis.KB;

const write = (rel, content) => {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return rel;
};
const mkdir = (rel) => fs.mkdirSync(path.join(OUT, rel), { recursive: true });

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const S = KB.services.settings.DEFAULTS;
  const tpl = S.rebuild.template;
  const app = STUB.makeApp();
  const svc = new KB.services.rebuild(app);
  const ROOTDIR = "01_新知识库";
  const made = [];

  /* 1) 目录（空目录在 Obsidian 里不显示，故操作日志目录留一个占位说明） */
  for (const dir of tpl.dirs) { mkdir(ROOTDIR + "/" + dir); made.push(ROOTDIR + "/" + dir + "/"); }
  write(ROOTDIR + "/99_Meta/05_操作日志/README.txt",
    "这个目录用于放操作日志；Obsidian 不会显示空目录，故留此占位文件。\n");

  /* 2) 种子文件：正文来自插件本体（seedContent），保证与「重建」产出一致 */
  const seeds = {};
  for (const rel of tpl.seedFiles) {
    const content = svc.seedContent(ROOTDIR + "/" + rel, { cfg: S.rebuild });
    seeds[rel] = content;
    made.push(write(ROOTDIR + "/" + rel, content));
  }

  /* 3) 两篇示例笔记（让看板/内容流有东西可看） */
  const noteA = [
    "---", "类型: 内容作品", "领域: 内容创作", "主题: 示例·三分钟讲清 PARA", "状态: 3-撰写中",
    "创建日期: 2026-09-17", "平台: 公众号", "目标发布日: 2026-09-25", "tags:", "  - 内容创作",
    "文件位置:", "  - 02_Areas/内容创作", "---", "", "# 示例·三分钟讲清 PARA", "",
    "这是一篇示例笔记，用来演示看板分组、卡片属性与内容流预览。", "",
    "## 大纲", "- 为什么需要分类", "- 四类各自的边界", "- 常见误用", "",
    "## 关联笔记", "- 所属中心：[[_领域中心]]", "- 返回 [[MOC_知识地图]]", ""
  ].join("\n");
  const noteB = [
    "---", "类型: 速记", "领域: 未分类", "主题: 示例·随手记", "状态: 待整理",
    "创建日期: 2026-09-17", "tags:", "  - 待整理", "文件位置:", "  - 00_Inbox", "---", "",
    "# 示例·随手记", "", "一条还没整理的灵感。看板里它会出现在收件箱板块。", "",
    "## 关联笔记", "- 所属中心：[[_收件箱]]", "- 返回 [[MOC_知识地图]]", ""
  ].join("\n");
  made.push(write(ROOTDIR + "/02_Areas/内容创作/示例_三分钟讲清PARA.md", noteA));
  made.push(write(ROOTDIR + "/00_Inbox/示例_随手记.md", noteB));

  /* 4) 示例 .base：一个文件装两个视图（看板 + 内容流），VIEW_TYPE 与插件注册的一致 */
  const base = [
    "filters:",
    "  and:",
    "    - file.inFolder(\"01_新知识库\")",
    "views:",
    "  - type: creation-board",
    "    name: ①创作看板",
    "    filters:",
    "      and:",
    "        - file.inFolder(\"01_新知识库\")",
    "        - not:",
    "            - file.inFolder(\"01_新知识库/99_Meta\")",
    "    卡片最小宽度: 240",
    "    允许重复: true",
    "    板块:",
    "      - 名称: 内容创作",
    "        数据源: folder",
    "        路径: 01_新知识库/02_Areas/内容创作",
    "        递归深度: 1",
    "        上限: 50",
    "      - 名称: 收件箱",
    "        数据源: folder",
    "        路径: 01_新知识库/00_Inbox",
    "        递归深度: 1",
    "        上限: 50",
    "    只读: false",
    "    显正文: true",
    "  - type: note-stream",
    "    name: ②笔记内容流",
    "    filters:",
    "      and:",
    "        - file.inFolder(\"01_新知识库\")",
    "        - not:",
    "            - file.inFolder(\"01_新知识库/99_Meta\")",
    "    order:",
    "      - file.name",
    "      - 状态",
    "      - 文件位置",
    "    sort:",
    "      - property: file.mtime",
    "        direction: DESC",
    "newItemFolder: 01_新知识库/00_Inbox",
    ""
  ].join("\n");
  made.push(write(ROOTDIR + "/99_Meta/01_仪表盘/示例·看板与内容流.base", base));

  /* 5) 示例库说明 */
  const readme = [
    "# 示例库（kb-toolkit）",
    "",
    "一个空壳 PARA 知识库，用来试插件、也用来对照「知识库重建」会生成什么。",
    "",
    "## 怎么用",
    "1. 把 `01_新知识库/` 整个目录拷进你自己的库（或另存为一个新 vault 直接用）。",
    "2. 开启插件，做一遍首次使用向导，目录名保持默认（`01_新知识库` / `99_Meta`）即可。",
    "3. 打开 `01_新知识库/99_Meta/01_仪表盘/示例·看板与内容流.base`，就能看到创作看板与内容流两个视图。",
    "",
    "## 里面有什么",
    "- `01_新知识库/` 六个业务目录 + `99_Meta` 系统目录",
    "- 7 个索引种子文件（各中心页 + MOC + 目录说明）",
    "- 2 篇示例笔记 + 1 个双视图 `.base`",
    "",
    "注意：本示例库**不含** `.obsidian/` 配置，Obsidian 打开时会自己建一份。",
    ""
  ].join("\n");
  made.push(write("README.md", readme));

  /* 6) 清单：给 run_r5.js 做一致性断言 */
  const manifest = {
    root: ROOTDIR,
    generated: new Date().toISOString(),
    dirs: tpl.dirs.slice(),
    seeds: seeds,
    extraFiles: ["README.md", "01_新知识库/99_Meta/05_操作日志/README.txt",
      "01_新知识库/02_Areas/内容创作/示例_三分钟讲清PARA.md",
      "01_新知识库/00_Inbox/示例_随手记.md",
      "01_新知识库/99_Meta/01_仪表盘/示例·看板与内容流.base"]
  };
  fs.writeFileSync(path.join(ROOT, "samples", "_sample_manifest.json"),
    JSON.stringify(manifest, null, 1), "utf8");

  const files = [];
  (function walk(dir) {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else files.push(path.relative(OUT, p).replace(/\\/g, "/"));
    }
  })(OUT);
  console.log("SAMPLE-OK dirs=" + tpl.dirs.length + " seeds=" + tpl.seedFiles.length +
    " files=" + files.length + " -> " + OUT);
}

main();
