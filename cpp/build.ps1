# Build SGP4 WASM module using Emscripten.
# Prerequisites:
#   1. Install Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html
#   2. Activate it:  & "C:\emsdk\emsdk_env.ps1"   (adjust path as needed)
#   3. Run this script from any directory.

$ErrorActionPreference = 'Stop'

$SrcDir = $PSScriptRoot
$OutDir = Join-Path $PSScriptRoot "..\frontend\public"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# PowerShell 5.1 doesn't auto-quote args with spaces when splatting to native
# executables — embed the double-quotes directly in each path string.
function Q { param($p) "`"$p`"" }

$args_ = @(
    '-O3',
    '-std=c++17',
    (Q (Join-Path $SrcDir 'sgp4.cpp')),
    (Q (Join-Path $SrcDir 'bindings.cpp')),
    '-I', (Q $SrcDir),
    '-lembind',
    '-s', 'MODULARIZE=1',
    '-s', 'EXPORT_ES6=1',
    '-s', 'EXPORT_NAME=createSGP4Module',
    '-s', 'ALLOW_MEMORY_GROWTH=1',
    '-s', 'EXPORTED_FUNCTIONS=_malloc,_free',
    '-s', 'EXPORTED_RUNTIME_METHODS=HEAP32,HEAPF64',
    '-s', 'ENVIRONMENT=web,worker',
    '-s', 'SINGLE_FILE=0',
    '--closure', '0',
    '-o', (Q (Join-Path $OutDir 'sgp4.js'))
)

Write-Host "Running emcc..." -ForegroundColor Cyan
& emcc @args_
if ($LASTEXITCODE -ne 0) { throw "emcc failed with exit code $LASTEXITCODE" }

Write-Host "Done: $OutDir\sgp4.js  +  $OutDir\sgp4.wasm" -ForegroundColor Green
