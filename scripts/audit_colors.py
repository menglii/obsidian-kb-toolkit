# -*- coding: utf-8 -*-
"""kb-toolkit R3b 颜色审计：统计硬编码色 + 选择器数量（前后对比用证据）"""
import re, sys, io, collections

FILES = ["styles_src/cb.css", "styles_src/ns.css"]
HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")
RGB = re.compile(r"rgba?\([^)]*\)")
SEL = re.compile(r"(^|\})\s*([^{}@]+)\{", re.M)

def audit(tag):
    total_sel = 0
    hexes = collections.Counter()
    rgbs = collections.Counter()
    hsls = collections.Counter()
    for f in FILES:
        s = io.open(f, encoding="utf-8").read()
        total_sel += len([m for m in SEL.finditer(s) if "@" not in m.group(2)])
        for m in HEX.finditer(s): hexes[m.group(0).lower()] += 1
        for m in RGB.finditer(s): rgbs[m.group(0)] += 1
        for m in re.finditer(r"hsla?\([^)]*\)", s): hsls[m.group(0)] += 1
    vars_used = collections.Counter()
    for f in FILES:
        s = io.open(f, encoding="utf-8").read()
        for m in re.finditer(r"var\(\s*(--[a-z0-9-]+)", s): vars_used[m.group(1)] += 1
    print("== %s ==" % tag)
    print("  selectors        : %d" % total_sel)
    print("  hex occurrences  : %d (unique %d)" % (sum(hexes.values()), len(hexes)))
    print("  rgb(a) occurr.   : %d (unique %d)" % (sum(rgbs.values()), len(rgbs)))
    print("  hsl occurr.      : %d" % sum(hsls.values()))
    print("  var() occurrences: %d (unique %d)" % (sum(vars_used.values()), len(vars_used)))
    for k, v in hexes.most_common(20): print("     hex %-10s x%d" % (k, v))
    for k, v in rgbs.most_common(15): print("     rgb %-22s x%d" % (k, v))
    return total_sel, sum(hexes.values()), sum(rgbs.values()), sum(vars_used.values())

if __name__ == "__main__":
    audit(sys.argv[1] if len(sys.argv) > 1 else "当前")
