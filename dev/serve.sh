#!/bin/bash
# Serves the repo at http://localhost:8765/grind-and-flow/ (mirrors the GitHub Pages path,
# so the service-worker scope matches). Used by dev/smoke.cjs.
ROOT="$(mktemp -d)"; ln -s "$(cd "$(dirname "$0")/.." && pwd)" "$ROOT/grind-and-flow"
cd "$ROOT" && exec python3 -m http.server 8765
