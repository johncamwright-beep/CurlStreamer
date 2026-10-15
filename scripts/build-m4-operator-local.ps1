param(
  [Parameter(Mandatory = $true)][string]$SetupRoot,
  [switch]$Readiness
)

$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$operatorName = if ($Readiness) { "m4-operator-ready.mjs" } else { "m4-operator.mjs" }
Push-Location $repository
try {
  # DirectPeer executes in the renderer. Always rebuild both local artifacts.
  & $node node_modules/esbuild/bin/esbuild src/lib/providers/m4-program-renderer-browser.tsx --bundle --platform=browser --format=iife --target=chrome120 --jsx=automatic --minify --outfile=public/m4-program-renderer.js
  if ($LASTEXITCODE -ne 0) { throw "Renderer build failed." }
  & $node node_modules/tailwindcss/lib/cli.js -i src/app/globals.css -o public/m4-program-renderer.css --minify
  if ($LASTEXITCODE -ne 0) { throw "Renderer stylesheet build failed." }
  & $node node_modules/esbuild/bin/esbuild scripts/m4-operator.ts --bundle --platform=node --format=esm --minify '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' "--outfile=$SetupRoot/$operatorName"
  if ($LASTEXITCODE -ne 0) { throw "Operator build failed." }
  $assets = Join-Path $SetupRoot "m4-program-assets"
  New-Item -ItemType Directory -Path $assets -Force | Out-Null
  Copy-Item -LiteralPath public/m4-program-renderer.js, public/m4-program-renderer.css -Destination $assets
  Write-Output "Operator and renderer rebuilt. Finalize any active recording before restarting."
} finally {
  Pop-Location
}
