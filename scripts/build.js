/* 构建脚本：
 * 1) vendor/creation-board.js 与 vendor/bases-preview.js **字节级原样内嵌**（IIFE 隔离作用域，
 *    VIEW_TYPE 不变；BEGIN/END 标记供测试抽回字节比对证明 内嵌==原件）
 * 2) src/*.js 按文件名序拼接（KB 命名空间）
 * 3) styles.css = styles_src/*.css 动态枚举合并
 * 用法: node scripts/build.js */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const VENDOR = path.join(ROOT, "vendor");
const PLUGINS = path.join(ROOT, "..");

function embed(name, vendorFile) {
  const bytes = fs.readFileSync(path.join(VENDOR, vendorFile), "utf8");
  return "/* ===== KB-EMBED:" + name + " BEGIN（字节级原样内嵌，勿改） ===== */\n"
    + "(function () {\nvar module = { exports: {} };\n"
    + bytes
    + "\nKB.modules." + name + " = module.exports;\n"
    + "})();\n/* ===== KB-EMBED:" + name + " END ===== */\n";
}

const files = fs.readdirSync(SRC).filter(f => f.endsWith(".js")).sort();
const prelude = "00_prelude.js";
if (!files.includes(prelude)) throw new Error("缺 00_prelude.js");
let out = "/* kb-toolkit main.js — 由 scripts/build.js 生成，勿手改；源码在 src/ 与 vendor/ */\n";
out += "\n/* ===== " + prelude + " ===== */\n";
out += fs.readFileSync(path.join(SRC, prelude), "utf8");
out += embed("CreationBoardPlugin", "creation-board.js");
out += embed("BasesPreviewPlugin", "bases-preview.js");
for (const f of files) {
  if (f === prelude) continue;
  out += "\n/* ===== " + f + " ===== */\n";
  out += fs.readFileSync(path.join(SRC, f), "utf8");
}

/* 所有工厂实例化（entry 里 module.exports = 插件类） */
out += "\n/* ===== 工厂实例化 ===== */\nKB.reg.forEach(function (r) { r.factory(); });\n";

const dest = path.join(ROOT, "main.js");
fs.writeFileSync(dest, out, "utf8");

/* styles.css 由自包含的 styles_src/ 合并（R13 起动态枚举：cb=创作看板, ns=内容流, kbt=设置页/面板） */
const styleFiles = fs.readdirSync(path.join(ROOT, "styles_src")).filter(f => f.endsWith(".css")).sort();
const styles = [
  "/* kb-toolkit styles.css — styles_src/*.css 合并产物（勿手改；源：" + styleFiles.join(" + ") + "） */",
  ...styleFiles.map(f => fs.readFileSync(path.join(ROOT, "styles_src", f), "utf8"))
].join("\n");
fs.writeFileSync(path.join(ROOT, "styles.css"), styles, "utf8");

console.log("BUILD-OK src=" + files.length
  + " bytes=" + Buffer.byteLength(out)
  + " styles=" + Buffer.byteLength(styles) + " -> " + dest);
