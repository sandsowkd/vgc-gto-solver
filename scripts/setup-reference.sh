#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/.cache/reference"
mkdir -p "$CACHE"
# The upstream harness is CommonJS. Isolate it from any enclosing ESM workspace.
cat > "$CACHE/package.json" <<'JSON'
{"private":true,"type":"commonjs"}
JSON
if [ ! -d "$CACHE/ninjask/.git" ]; then
  git clone https://github.com/dcabatin/Ninjask.git "$CACHE/ninjask"
fi
git -C "$CACHE/ninjask" checkout --detach 8a59175f3915771285cd16fce5d7f788610ff242
NINJASK_SHOWDOWN="$CACHE/showdown" bash "$CACHE/ninjask/scripts/setup_showdown.sh"
NINJASK_SHOWDOWN="$CACHE/showdown" node "$CACHE/ninjask/refsim/export_format.js" gen9championsvgc2026regmc > "$CACHE/export.json"
cmp "$ROOT/data/gen9championsvgc2026regmc.json" "$CACHE/export.json"
echo "Reference paths: $CACHE/ninjask and $CACHE/showdown"
