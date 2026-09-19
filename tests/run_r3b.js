/* kb-toolkit R3b 样式断言：
 * ① 样式源自包含（不再依赖旧插件目录）
 * ② 没有「裸」硬编码色（出现在 var(...) 之外的色值 = 0 处）
 * ③ 所有 var(--x) 的变量名都在 obsidian.asar 抽出的真实变量白名单里（防写错）
 * ④ 改造前后选择器数量一致（186，不允许丢规则） */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0; const fails = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; fails.push(name); console.log("  FAIL " + name); }
}
function eq(a, b, name) { ok(a === b, name + " (got=" + a + " want=" + b + ")"); }

const ROOT = path.join(__dirname, "..");
const cbSrc = fs.readFileSync(path.join(ROOT, "styles_src", "cb.css"), "utf8");
const nsSrc = fs.readFileSync(path.join(ROOT, "styles_src", "ns.css"), "utf8");
const kbtSrc = fs.readFileSync(path.join(ROOT, "styles_src", "kbt.css"), "utf8");
/* R18 补洞：原先只查 cb+ns 两份，kbt.css（设置页样式）漏在检查外 —— 零裸色/白名单一起管住 */
const all = cbSrc + "\n" + nsSrc + "\n" + kbtSrc;
const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const whitelist = new Set(
  fs.readFileSync(path.join(ROOT, "scripts", "obsidian_vars.txt"), "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean)
);
/* 样式里自定义的局部变量（如 --cb-card-w）也算合法：凡在本样式中有 `--x:` 声明的 */
for (const m of all.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) whitelist.add(m[1]);

/* ① 自包含 */
ok(fs.existsSync(path.join(ROOT, "styles_src", "cb.css")), "样式源已入驻 styles_src/cb.css");
ok(fs.existsSync(path.join(ROOT, "styles_src", "ns.css")), "样式源已入驻 styles_src/ns.css");
ok(/源：.*cb\.css/.test(styles.slice(0, 300)), "styles.css 标注来源为自包含源（R13 起头注释动态列源文件）");
ok(styles.indexOf("creation-board + bases-preview 原样合并") < 0, "产物不再标注依赖旧插件目录");

/* ② 裸硬编码色 = 0（var(...) 内部的兜底值不算） */
function stripVarFallbacks(s) {
  let out = "", depth = 0, i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const open = rest.indexOf("var(");
    if (open < 0) { out += rest; break; }
    out += rest.slice(0, open);
    let j = i + open + 4, level = 1;
    while (j < s.length && level > 0) {
      if (s[j] === "(") level++;
      else if (s[j] === ")") level--;
      j++;
    }
    i = j;
  }
  return out;
}
const bare = stripVarFallbacks(all);
const hexes = bare.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
const rgbs = bare.match(/rgba?\([^)]*\)/g) || [];
const named = bare.match(/:\s*(white|black|red|green|blue|yellow|orange|gray|grey)\b/gi) || [];
eq(hexes.length, 0, "裸 hex 色值（改造前 1 处 #d08b2c 属兜底）");
eq(rgbs.length, 0, "裸 rgba 色值（卡片 hover 黑影已换 var(--shadow-xs)）");
eq(named.length, 0, "裸具名颜色");

/* ③ 变量名白名单校验 */
const used = new Set((all.match(/var\(\s*(--[a-zA-Z0-9_-]+)/g) || []).map(s => s.replace(/var\(\s*/, "")));
const unknown = [...used].filter(v => !whitelist.has(v));
eq(unknown.length, 0, "未知 CSS 变量（白名单 " + whitelist.size + " 个）" + (unknown.length ? " → " + unknown.join(", ") : ""));

/* ④ 选择器数量守恒 */
const SEL = /(^|\})\s*([^{}@]+)\{/g;
function selCount(s) {
  let n = 0, m;
  while ((m = SEL.exec(s))) { if (!m[2].includes("@")) n++; }
  return n;
}
/* R12 起改为动态守恒；R13 起样式源动态枚举 styles_src/*.css（新加 kbt.css 不用改断言，丢规则必红） */
const styleDir = path.join(ROOT, "styles_src");
const styleSrcs = fs.readdirSync(styleDir).filter(f => f.endsWith(".css")).sort()
  .map(f => fs.readFileSync(path.join(styleDir, f), "utf8"));
const prodStyles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
eq(selCount(prodStyles), styleSrcs.reduce((a, s) => a + selCount(s), 0),
  "选择器守恒（styles.css 产物 == styles_src/ 全部源之和，一条没丢）");
ok((nsSrc + cbSrc).indexOf("kb-module-disabled") >= 0, "R11：置灰禁用规则真的在样式源里");
ok(cbSrc.indexOf("cb-head-grab") >= 0 && cbSrc.indexOf("cb-drop-move") >= 0,
  "R12/R24：板块标题拖动排序 + 拖动搬文件高亮规则在样式源里");
ok(styleSrcs.some(s => s.indexOf(".kbt-search-input") >= 0) && cbSrc.indexOf(".cb-panel-adv") >= 0,
  "R13：设置页搜索框与面板「高级」折叠组样式都在源里");

/* ⑤ 关键变量确实在用 */
["--shadow-xs", "--radius-s", "--background-primary", "--background-modifier-hover", "--text-normal"].forEach(v => {
  ok(all.indexOf("var(" + v) >= 0, "仍在使用 " + v);
});
/* ⑥ 产物包含改造痕迹 */
ok(styles.indexOf("var(--shadow-xs") >= 0, "产物含 --shadow-xs（阴影改造成生效）");
const stylesBytes = Buffer.byteLength(styles);
ok(stylesBytes > 28000, "产物字节量正常（" + stylesBytes + " 字节 / " + styles.length + " 字符）");

console.log("R3b 断言: PASS " + pass + " / FAIL " + fail + (fail ? "\n" + fails.join("\n") : ""));
process.exitCode = fail ? 1 : 0;
