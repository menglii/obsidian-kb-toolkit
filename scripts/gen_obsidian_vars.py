# -*- coding: utf-8 -*-
"""从 obsidian.asar 抽出所有 CSS 变量名 → scripts/obsidian_vars.txt（用于校验样式里没写错变量名）"""
import re, io, os
ASAR = r"D:/01_ProgramFiles/办公效率/obsidian/resources/obsidian.asar"
s = io.open(ASAR, encoding="utf-8", errors="ignore").read()
names = set(re.findall(r"(--[a-zA-Z0-9_-]+)\s*:", s))
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "obsidian_vars.txt")
io.open(out, "w", encoding="utf-8").write("\n".join(sorted(names)) + "\n")
print("VARS-OK unique=%d -> %s" % (len(names), out))
