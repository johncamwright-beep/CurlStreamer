param(
  [Parameter(Mandatory = $true)][string]$SetupRoot,
  [Parameter(Mandatory = $true)][string]$Destination,
  [Parameter(Mandatory = $true)][string]$Configuration,
  [string]$Release = "0.3.0-preview.1"
)
$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw "Use a new staging directory; existing installs are never overwritten." }
if ($Release -notmatch '^\d+\.\d+\.\d+(-[a-z0-9.]+)?$') { throw "Invalid release version." }
$settings = Get-Content -LiteralPath $Configuration -Raw | ConvertFrom-Json
if ($settings.version -ne 1 -or $settings.realtimeKey -notmatch '^sb_publishable_[A-Za-z0-9_-]+$') { throw "Provide public Studio configuration, never a server key." }
$node = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = & $node --version
if ($nodeVersion -notmatch '^v(22|24)\.\d+\.\d+$') { throw "This preview requires a pinned Node 22 or 24 runtime." }
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw "Windows .NET Framework compiler is required to build the launcher." }
New-Item -ItemType Directory -Path $destinationPath | Out-Null
foreach ($directory in @("app", "node", "native/default", "native/production", "renderer", "obs")) {
  New-Item -ItemType Directory -Path (Join-Path $destinationPath $directory) -Force | Out-Null
}
Push-Location $repository
try {
  & $node node_modules/esbuild/bin/esbuild scripts/m5-studio.ts --bundle --platform=node --format=esm --minify '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' "--outfile=$destinationPath/app/studio.mjs"
  if ($LASTEXITCODE -ne 0) { throw "Studio controller build failed." }
  & $node node_modules/esbuild/bin/esbuild src/lib/providers/m4-program-renderer-browser.tsx --bundle --platform=browser --format=iife --target=chrome120 --jsx=automatic --minify "--outfile=$destinationPath/renderer/m4-program-renderer.js"
  if ($LASTEXITCODE -ne 0) { throw "Renderer build failed." }
  & $node node_modules/tailwindcss/lib/cli.js -i src/app/globals.css -o "$destinationPath/renderer/m4-program-renderer.css" --minify
  if ($LASTEXITCODE -ne 0) { throw "Stylesheet build failed." }
  Copy-Item -LiteralPath $node -Destination (Join-Path $destinationPath "node/node.exe")
  # Re-serialize only the public allowlist. No environment file or OBS profile is copied.
  [ordered]@{ version = 1; website = $settings.website; realtimeUrl = $settings.realtimeUrl; realtimeKey = $settings.realtimeKey; streamingEnabled = ($settings.streamingEnabled -eq $true) } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destinationPath "studio.json") -Encoding utf8NoBOM
  $components = @{
    "native/m4_studio_host.exe" = "native-toolchain/m4-studio-host-build/Release/m4_studio_host.exe"
    "native/m4_studio_recorder.exe" = "native-toolchain/m4-readiness-recorder-build/Release/m4_studio_recorder.exe"
    "native/obs-ffmpeg-mux.exe" = "native-toolchain/m4-readiness-recorder-build/Release/obs-ffmpeg-mux.exe"
    "native/default/curlstreamer-m4-memory.dll" = "native-toolchain/m4-readiness-default-build/Release/curlstreamer-m4-memory.dll"
    "native/production/curlstreamer-m4-memory.dll" = "native-toolchain/m4-readiness-production-build/Release/curlstreamer-m4-memory.dll"
  }
  foreach ($entry in $components.GetEnumerator()) {
    Copy-Item -LiteralPath (Join-Path $SetupRoot $entry.Value) -Destination (Join-Path $destinationPath $entry.Key)
  }
  foreach ($directory in @("bin", "data", "obs-plugins")) {
    Copy-Item -LiteralPath (Join-Path $SetupRoot "obs-m3-32.2.2/$directory") -Destination (Join-Path $destinationPath "obs") -Recurse
  }
  $nodeHash = (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant()
  $controllerHash = (Get-FileHash -LiteralPath (Join-Path $destinationPath "app/studio.mjs") -Algorithm SHA256).Hash.ToLowerInvariant()
  $configurationHash = (Get-FileHash -LiteralPath (Join-Path $destinationPath "studio.json") -Algorithm SHA256).Hash.ToLowerInvariant()
  $sdk = & (Join-Path $PSScriptRoot 'get-studio-webview2.ps1') -CacheRoot (Join-Path $SetupRoot 'build-dependencies')
  foreach ($dll in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $sdk "lib/net462/$dll") -Destination (Join-Path $destinationPath $dll)
  }
  Copy-Item -LiteralPath (Join-Path $sdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $destinationPath
  Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $destinationPath 'WebView2-LICENSE.txt')
  $source = (Get-Content -LiteralPath native/m5-studio-launcher/Studio.cs -Raw).Replace("@NODE_SHA256@", $nodeHash).Replace("@CONTROLLER_SHA256@", $controllerHash).Replace("@CONFIGURATION_SHA256@", $configurationHash)
  $sourcePath = Join-Path $destinationPath "Studio.build.cs"
  [IO.File]::WriteAllText($sourcePath, $source)
  & $compiler /nologo /target:winexe /platform:x64 /optimize+ /define:WORKSPACE /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll "/reference:$destinationPath/Microsoft.Web.WebView2.Core.dll" "/reference:$destinationPath/Microsoft.Web.WebView2.WinForms.dll" "/out:$destinationPath/CurlStreamer Studio.exe" $sourcePath (Join-Path $repository 'native/m5-studio-launcher/Workspace.cs') (Join-Path $repository 'native/m5-studio-launcher/WorkspacePolicy.cs')
  if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed." }
  Remove-Item -LiteralPath $sourcePath
  $files = @(Get-ChildItem -LiteralPath $destinationPath -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = [IO.Path]::GetRelativePath($destinationPath, $_.FullName).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  [ordered]@{ version = 1; release = $Release; obsVersion = "32.2.2"; nodeVersion = $nodeVersion; files = $files } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destinationPath "manifest.json") -Encoding utf8NoBOM
  Write-Output "Studio preview assembled. This is private staging, pending distribution notices and installer verification."
} finally { Pop-Location }
