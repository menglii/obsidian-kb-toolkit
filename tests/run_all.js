/* 全量回归 runner：顺序跑 r1~r20b
 *（R19 = 五条需求：文件位置属性 / 开关扶正 / 状态成栏 / 按钮素色 / 提示精简；
 *  R20 = 四条需求：状态只留是否启用 / 帮助入口挪顶栏 / 自绘齿轮图标 / 看板设置界面重做；
 *  R20b = 看板「真 DOM 冒烟」——源码级正则抓不到的运行时错在这里兜底），
 * 聚合两代输出格式（PASS/FAIL 与 通过/失败）。 */
const { execFileSync } = require("child_process");
const path = require("path");
const NODE = process.execPath;
const FILES = ["run_r1", "run_r2", "run_r3", "run_r3b", "run_r4", "run_r4b", "run_r5",
  "run_r6", "run_r7", "run_r8", "run_r9", "run_r10", "run_r11", "run_r12", "run_r13", "run_r14", "run_r15", "run_r16", "run_r17", "run_r18", "run_r19", "run_r20", "run_r20b"];

const rounds = parseInt(process.argv[2] || "3", 10);
let grandTotal = 0, grandFail = 0;
for (let round = 1; round <= rounds; round++) {
  let total = 0, failed = 0;
  for (const f of FILES) {
    let out = "";
    try {
      out = execFileSync(NODE, [path.join(__dirname, f + ".js")], {
        encoding: "utf8", timeout: 120000, env: process.env,
      });
    } catch (e) {
      out = (e.stdout || "") + "\n[runner] exit=" + e.status + " " + (e.stderr || "").slice(-500);
    }
    const pm = out.match(/(\d+)\s*通过/) || out.match(/PASS\s*(\d+)/);
    const fn = out.match(/(\d+)\s*失败/) || out.match(/FAIL\s*(\d+)/);
    if (!pm || !fn) {
      console.log("ROUND" + round + " " + f + ": 无法解析 -> " + out.slice(-200).replace(/\n/g, " | "));
      failed++; continue;
    }
    const p = parseInt(pm[1], 10), fl = parseInt(fn[1], 10);
    total += p; failed += fl;
    if (fl > 0) console.log("ROUND" + round + " " + f + ": PASS " + p + " / FAIL " + fl + "\n" + out.split("\n").filter(l => l.indexOf("FAIL ") === 0 || l.indexOf("  - ") === 0).join("\n"));
  }
  grandTotal += total; grandFail += failed;
  console.log("ROUND" + round + " 总计: " + total + " 通过 / " + failed + " 失败");
}
console.log("ALL: " + grandTotal + " 通过 / " + grandFail + " 失败（" + rounds + " 轮合计）");
process.exit(grandFail ? 1 : 0);
