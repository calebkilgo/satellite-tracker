#!/usr/bin/env bash
# Requires Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html
# After install: source /path/to/emsdk/emsdk_env.sh
set -e

OUT="$(dirname "$0")/../frontend/public"
mkdir -p "$OUT"

emcc -O3 \
    -std=c++17 \
    "$(dirname "$0")/sgp4.cpp" \
    "$(dirname "$0")/bindings.cpp" \
    -I "$(dirname "$0")" \
    -lembind \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME=createSGP4Module \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT=web,worker \
    -s SINGLE_FILE=0 \
    --closure 0 \
    -o "$OUT/sgp4.js"

echo "Built: $OUT/sgp4.js  +  $OUT/sgp4.wasm"
