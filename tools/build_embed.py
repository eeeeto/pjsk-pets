#!/usr/bin/env python3
"""生成 assets/embed.js —— 把模型资源内嵌为 dataURI，
让用户直接双击 index.html（file:// 协议）也能玩。
用法：python3 tools/build_embed.py
每次更新 assets/ 下的资源后需要重新运行一次。
"""
import base64
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def main():
    chibis_dir = os.path.join(ASSETS, "chibis")
    decos_dir = os.path.join(ASSETS, "decos")
    if not os.path.isdir(chibis_dir):
        print("找不到 assets/chibis", file=sys.stderr)
        sys.exit(1)

    out = ["/* 本文件由 tools/build_embed.py 自动生成：内嵌全部模型资源，供 file:// 离线使用 */",
           "window.PJSK_EMBED = {"]
    out.append('  skel: "%s",' % b64(os.path.join(ASSETS, "sd_main.skel")))

    # chibis
    out.append("  chibis: {")
    for name in sorted(os.listdir(chibis_dir)):
        d = os.path.join(chibis_dir, name)
        atlas = os.path.join(d, "sekai_atlas.atlas.txt")
        png = os.path.join(d, "sekai_atlas.png")
        if not (os.path.isfile(atlas) and os.path.isfile(png)):
            continue
        with open(atlas, "r", encoding="utf-8") as f:
            atlas_text = f.read()
        png_uri = "data:image/png;base64," + b64(png)
        out.append('    %s: { atlas: %s, png: "%s" },'
                   % (json.dumps(name), json.dumps(atlas_text), png_uri))
        print("  chibi:", name)
    out.append("  },")

    # decos（目录可选，默认涂鸦已移除）
    out.append("  decos: {}")
    if os.path.isdir(decos_dir):
        deco_lines = []
        for name in sorted(os.listdir(decos_dir)):
            if not name.lower().endswith(".png"):
                continue
            key = name[:-4]
            deco_lines.append('    %s: "data:image/png;base64,%s",' % (json.dumps(key), b64(os.path.join(decos_dir, name))))
            print("  deco:", key)
        if deco_lines:
            out[-1] = "  decos: {"
            out.extend(deco_lines)
            out.append("  }")
    out.append("};")

    dst = os.path.join(ASSETS, "embed.js")
    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print("OK ->", dst, "%.1f MB" % (os.path.getsize(dst) / 1048576))


if __name__ == "__main__":
    main()
