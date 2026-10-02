param(
  [Parameter(Mandatory = $true)][string]$SetupRoot,
  [Parameter(Mandatory = $true)][string]$Destination,
  [Parameter(Mandatory = $true)][string]$Configuration,
  [string]$Release = "0.5.0-pilot.1",
  [string]$IpCameraHelper,
  [string]$BaselineStudio,
  [string]$BaselineManifestSha256
)
$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
if (-not $IpCameraHelper) {
  $IpCameraHelper = & (Join-Path $PSScriptRoot 'build-m4-ip-camera.ps1') -SetupRoot $SetupRoot -Destination (Join-Path $repository 'build/ip-camera') | Select-Object -Last 1
}
if (-not (Test-Path -LiteralPath $IpCameraHelper -PathType Leaf)) { throw "Build the IP camera receiver before packaging Studio." }
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw "Use a new staging directory; existing installs are never overwritten." }
if ($Release -notmatch '^\d+\.\d+\.\d+(-[a-z0-9.]+)?$') { throw "Invalid release version." }
$settings = Get-Content -LiteralPath $Configuration -Raw | ConvertFrom-Json
if ($settings.version -ne 1 -or $settings.realtimeKey -notmatch '^sb_publishable_[A-Za-z0-9_-]+$') { throw "Provide public Studio configuration, never a server key." }
$node = (Get-Command node -ErrorAction Stop).Source
if ($BaselineStudio) {
  $BaselineStudio = (Resolve-Path -LiteralPath $BaselineStudio).Path
  $baselineManifestPath = Join-Path $BaselineStudio 'manifest.json'
  if ($BaselineManifestSha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $baselineManifestPath).Hash -ne $BaselineManifestSha256) { throw 'Pin the verified baseline manifest SHA-256.' }
  $baseline = Get-Content -LiteralPath $baselineManifestPath -Raw | ConvertFrom-Json
  if ($baseline.version -ne 1 -or $baseline.obsVersion -ne '32.2.2') { throw 'Unsupported Studio baseline.' }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($component in $baseline.files) {
    $path = [IO.Path]::GetFullPath((Join-Path $BaselineStudio $component.path))
    if ($component.path -notmatch '^[A-Za-z0-9_. /-]+$' -or @($component.path.Split('/') | Where-Object { $_ -in @('', '.', '..') -or $_.EndsWith('.') -or $_.EndsWith(' ') }).Count -or -not $path.StartsWith($BaselineStudio + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($component.path) -or $component.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid baseline component path or hash.' }
    if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked baseline components are not supported.' }
    if ((Get-FileHash -LiteralPath $path).Hash -ne $component.sha256) { throw 'Baseline component hash mismatch.' }
  }
  foreach ($required in @('node/node.exe', 'native/m4_studio_host.exe', 'native/m4_studio_recorder.exe', 'native/obs-ffmpeg-mux.exe', 'native/default/curlstreamer-m4-memory.dll', 'native/production/curlstreamer-m4-memory.dll', 'obs/bin/64bit/obs.dll', 'THIRD_PARTY_NOTICES.json', 'STUDIO-LICENSE.md', 'WebView2-LICENSE.txt', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) {
    if (-not $seen.Contains($required)) { throw 'Incomplete Studio baseline.' }
  }
  $node = Join-Path $BaselineStudio 'node/node.exe'
}
$nodeVersion = & $node --version
if ($nodeVersion -notmatch '^v(22|24)\.\d+\.\d+$') { throw "This preview requires a pinned Node 22 or 24 runtime." }
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw "Windows .NET Framework compiler is required to build the launcher." }
New-Item -ItemType Directory -Path $destinationPath | Out-Null
foreach ($directory in @("app", "node", "native/default", "native/production", "renderer", "obs")) {
  New-Item -ItemType Directory -Path (Join-Path $destinationPath $directory) -Force | Out-Null
}
if ($BaselineStudio) {
  foreach ($component in $baseline.files) {
    $target = Join-Path $destinationPath $component.path
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $BaselineStudio $component.path) -Destination $target
  }
}
Push-Location $repository
try {
  & $node node_modules/esbuild/bin/esbuild scripts/m5-studio.ts --bundle --platform=node --format=esm --minify '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' "--outfile=$destinationPath/app/studio.mjs" "--metafile=$destinationPath/app/studio-metafile.json"
  if ($LASTEXITCODE -ne 0) { throw "Studio controller build failed." }
  & $node node_modules/esbuild/bin/esbuild src/lib/providers/m4-program-renderer-browser.tsx --bundle --platform=browser --format=iife --target=chrome120 --jsx=automatic --minify "--outfile=$destinationPath/renderer/m4-program-renderer.js" "--metafile=$destinationPath/renderer/m4-program-renderer-metafile.json"
  if ($LASTEXITCODE -ne 0) { throw "Renderer build failed." }
  & $node node_modules/tailwindcss/lib/cli.js -i src/app/globals.css -o "$destinationPath/renderer/m4-program-renderer.css" --minify
  if ($LASTEXITCODE -ne 0) { throw "Stylesheet build failed." }
  New-Item -ItemType Directory -Path "$destinationPath/renderer/branding" -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repository 'public/branding/curlstreamer-logo.png') -Destination "$destinationPath/renderer/branding/curlstreamer-logo.png"
  Copy-Item -LiteralPath (Join-Path $repository "public/branding/team-benning.png") -Destination "$destinationPath/renderer/branding/team-benning.png"
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
    if ($BaselineStudio) { continue }
    Copy-Item -LiteralPath (Join-Path $SetupRoot $entry.Value) -Destination (Join-Path $destinationPath $entry.Key)
  }
  Copy-Item -LiteralPath $IpCameraHelper -Destination (Join-Path $destinationPath 'native/m4_ip_camera.exe')
  foreach ($directory in @("bin", "data", "obs-plugins")) {
    if ($BaselineStudio) { continue }
    Copy-Item -LiteralPath (Join-Path $SetupRoot "obs-m3-32.2.2/$directory") -Destination (Join-Path $destinationPath "obs") -Recurse
  }
  $nodeHash = (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant()
  $controllerHash = (Get-FileHash -LiteralPath (Join-Path $destinationPath "app/studio.mjs") -Algorithm SHA256).Hash.ToLowerInvariant()
  $configurationHash = (Get-FileHash -LiteralPath (Join-Path $destinationPath "studio.json") -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $BaselineStudio) {
  $sdk = & (Join-Path $PSScriptRoot 'get-studio-webview2.ps1') -CacheRoot (Join-Path $SetupRoot 'build-dependencies')
  foreach ($dll in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $sdk "lib/net462/$dll") -Destination (Join-Path $destinationPath $dll)
  }
  Copy-Item -LiteralPath (Join-Path $sdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $destinationPath
  Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $destinationPath 'WebView2-LICENSE.txt')
  }
  $source = (Get-Content -LiteralPath native/m5-studio-launcher/Studio.cs -Raw).Replace("@NODE_SHA256@", $nodeHash).Replace("@CONTROLLER_SHA256@", $controllerHash).Replace("@CONFIGURATION_SHA256@", $configurationHash)
  $sourcePath = Join-Path $destinationPath "Studio.build.cs"
  [IO.File]::WriteAllText($sourcePath, $source)
  & $compiler /nologo /target:winexe "/win32icon:$repository/public/branding/curlstreamer.ico" /platform:x64 /optimize+ /define:WORKSPACE /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll "/reference:$destinationPath/Microsoft.Web.WebView2.Core.dll" "/reference:$destinationPath/Microsoft.Web.WebView2.WinForms.dll" "/out:$destinationPath/CurlStreamer Studio.exe" $sourcePath (Join-Path $repository 'native/m5-studio-launcher/Workspace.cs') (Join-Path $repository 'native/m5-studio-launcher/WorkspacePolicy.cs') (Join-Path $repository 'native/m5-studio-launcher/UsbAudio.cs') (Join-Path $repository 'native/m5-studio-launcher/CameraInputs.cs')
  if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed." }
  Remove-Item -LiteralPath $sourcePath
  if ($BaselineStudio) {
    $baselineNotices = Get-Content -LiteralPath (Join-Path $BaselineStudio 'THIRD_PARTY_NOTICES.json') -Raw | ConvertFrom-Json
    [ordered]@{ version = 1; release = $baseline.release; manifestSha256 = $BaselineManifestSha256.ToLowerInvariant(); retainedNative = @($baseline.files | Where-Object { $_.path.StartsWith('native/') }); sourcePointers = @($baselineNotices.sourcePointers | Where-Object { $_.component.StartsWith('CurlStreamer Studio') }) } |
      ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $destinationPath 'baseline-provenance.json') -Encoding utf8NoBOM
  }
  $files = @(Get-ChildItem -LiteralPath $destinationPath -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = [IO.Path]::GetRelativePath($destinationPath, $_.FullName).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  $manifest = [ordered]@{ version = 1; release = $Release; obsVersion = "32.2.2"; nodeVersion = $nodeVersion; files = $files }
  $manifest |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destinationPath "manifest.json") -Encoding utf8NoBOM
  Write-Output "Studio preview assembled. This is private staging, pending distribution notices and installer verification."
} finally { Pop-Location }
