#!/usr/bin/env bash
# Bundles and minifies scripts/ into dist/main.js (plus a source map) for releases.
# Run by .github/workflows/release.yml; run it locally to check a release build.
# The repo's module.json keeps loading scripts/main.js, so development works without building.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist
npx -y esbuild@0.28.2 scripts/main.js \
    --bundle --format=esm --platform=browser --target=es2022 \
    --minify --keep-names --sourcemap --legal-comments=none \
    --log-level=warning --outfile=dist/main.js
