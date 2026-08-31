#!/usr/bin/env bash
# Regenerate the app icons from assets/icon.svg into the platform formats
# Electron Forge consumes: icon.icns (macOS), icon.ico (Windows), icon.png (Linux).
# Requires: rsvg-convert, sips, iconutil, python3 (all present on macOS + Homebrew librsvg).
set -euo pipefail

cd "$(dirname "$0")/.."
SVG=assets/icon.svg
OUT=assets
SET=assets/icon.iconset

command -v rsvg-convert >/dev/null || { echo "need rsvg-convert (brew install librsvg)"; exit 1; }

png() { rsvg-convert -w "$1" -h "$1" "$SVG" -o "$2"; }

# --- macOS .icns via iconset ---
mkdir -p "$SET"
png 16   "$SET/icon_16x16.png"
png 32   "$SET/icon_16x16@2x.png"
png 32   "$SET/icon_32x32.png"
png 64   "$SET/icon_32x32@2x.png"
png 128  "$SET/icon_128x128.png"
png 256  "$SET/icon_128x128@2x.png"
png 256  "$SET/icon_256x256.png"
png 512  "$SET/icon_256x256@2x.png"
png 512  "$SET/icon_512x512.png"
png 1024 "$SET/icon_512x512@2x.png"
iconutil -c icns "$SET" -o "$OUT/icon.icns"

# --- Linux .png (512) ---
png 512 "$OUT/icon.png"

# --- Windows .ico (multi-size, PNG-compressed entries) ---
tmp=$(mktemp -d)
for s in 16 24 32 48 64 128 256; do png "$s" "$tmp/$s.png"; done
python3 - "$tmp" "$OUT/icon.ico" <<'PY'
import struct, sys, os
tmp, out = sys.argv[1], sys.argv[2]
sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = []
for s in sizes:
    with open(os.path.join(tmp, f"{s}.png"), "rb") as f:
        imgs.append((s, f.read()))
hdr = struct.pack("<HHH", 0, 1, len(imgs))
entries, blob, offset = b"", b"", 6 + 16 * len(imgs)
for s, data in imgs:
    d = 0 if s >= 256 else s
    entries += struct.pack("<BBBBHHII", d, d, 0, 0, 1, 32, len(data), offset)
    blob += data
    offset += len(data)
with open(out, "wb") as f:
    f.write(hdr + entries + blob)
PY

rm -rf "$tmp"
echo "Wrote $OUT/icon.icns, $OUT/icon.ico, $OUT/icon.png"
