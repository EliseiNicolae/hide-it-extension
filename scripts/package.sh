#!/bin/bash
# Builds the Chrome Web Store upload: dist/hide-it-<version>.zip with only what the extension runs
# (no test/, store/, scripts/). Bump "version" in manifest.json before every new upload.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
out="dist/hide-it-$version.zip"
rm -f "$out"
zip -qrX "$out" manifest.json background.js content.js gate.js popup.html popup.css popup.js shared.js icons -x "*.DS_Store"
echo "$out"
unzip -l "$out"
