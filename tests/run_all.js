/* 全量回归 runner：顺序跑 r1~r24
 *（R19 = 五条需求：文件位置属性 / 开关扶正 / 状态成栏 / 按钮素色 / 提示精简；
 *  R20 = 四条需求：状态只留是否启用 / 帮助入口挪顶栏 / 自绘齿轮图标 / 看板设置界面重做；
 *  R20b = 看板「真 DOM 冒烟」——源码级正则抓不到的运行时错在这里兜底；
 *  R21 = 「卡片最小宽度」+「空位铺满整行」并成一行「文件宽度 [拉杆] 自动 [开关]」
 *         搬进顶栏齿轮「卡片」组 —— 键与语义不变，只换台面；
 *  R22 = 「板块设置」面板改**悬浮小窗**（遮罩 + 居中窗 + ✕ + 正文自己滚）；
 *  R23 = 顶栏面板加「属性默认展开」开关（K_PROS_OPEN 从原生视图选项挪进
 *         「看板行为」组、紧跟「显正文」，并进 computeSig 保证拨完即时重绘）；
 *  R24 = 「单个板块的设置只对单独板块生效」：撤掉板块标题旁的 ⚙ → 双击改名 +
 *         右键鼠标处弹设置小窗（刷新 / 通用设置 / 笔记内容 / 文件操作三组），
 *         「属性展开」升成板块级三态、板块之间加一条分隔线），
 * 聚合两代输出格式（PASS/FAIL 与 通过/失败）。 */
const { execFileSync } = require("child_process");
const path = require("path");
const NODE = process.execPath;
const FILES = ["run_r1", "run_r2", "run_r3", "run_r3b", "run_r4", "run_r4b", "run_r5",
  "run_r6", "run_r7", "run_r8", "run_r9", "run_r10", "run_r11", "run_r12", "run_r13", "run_r14", "run_r15", "run_r16", "run_r17", "run_r18", "run_r19", "run_r20", "run_r20b", "run_r21", "run_r22", "run_r23", "run_r24"];

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
