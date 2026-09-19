# -*- coding: utf-8 -*-
"""把 samples/示例库 打包成 samples/示例库.zip（确定性：固定时间戳 + 排序 + 不写压缩源路径）。
用法: python scripts/zip_sample_vault.py
"""
import os, sys, zipfile, json, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "samples", "示例库")
ZIP = os.path.join(ROOT, "samples", "示例库.zip")
FIXED = (2026, 9, 17, 0, 0, 0)

TOP = "示例库"


def main():
    if not os.path.isdir(SRC):
        print("SAMPLE-ZIP-FAIL 源目录不存在:", SRC); sys.exit(2)
    rels = []
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames.sort(); filenames.sort()
        for n in filenames:
            rel = os.path.relpath(os.path.join(dirpath, n), SRC).replace("\\", "/")
            rels.append(rel)
    rels.sort()
    # 空目录不会被 os.walk 的 filenames 带出来 → 按 manifest 的 dirs 补目录条目
    man_path = os.path.join(ROOT, "samples", "_sample_manifest.json")
    dirs = []
    if os.path.exists(man_path):
        man = json.load(open(man_path, encoding="utf-8"))
        for d in man.get("dirs", []):
            dirs.append(man.get("root", "01_新知识库") + "/" + d)
    dirs.sort()
    if os.path.exists(ZIP):
        os.remove(ZIP)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in rels:
            info = zipfile.ZipInfo(TOP + "/" + rel, date_time=FIXED)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(os.path.join(SRC, rel.replace("/", os.sep)), "rb") as f:
                z.writestr(info, f.read())
        for d in dirs:
            info = zipfile.ZipInfo(TOP + "/" + d + "/", date_time=FIXED)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = (0o40755 << 16) | 0x10   # 目录位
            z.writestr(info, b"")
    h = hashlib.sha256()
    with open(ZIP, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    with zipfile.ZipFile(ZIP) as z:
        names = z.namelist()
    meta = {"entries": len(names), "bytes": os.path.getsize(ZIP), "sha256": h.hexdigest(),
            "names": names}
    with open(os.path.join(ROOT, "samples", "_sample_zip.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print("SAMPLE-ZIP-OK entries=%d bytes=%d sha256=%s -> %s"
          % (len(names), meta["bytes"], meta["sha256"][:12], ZIP.replace("\\", "/")))
    sys.exit(0)


if __name__ == "__main__":
    main()
