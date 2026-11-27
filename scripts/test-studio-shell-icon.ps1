param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
  [string]$CompilerPath
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $root) { throw 'Use a new isolated test directory.' }
$assembly = Join-Path $root 'synthetic-assembly'
New-Item -ItemType Directory -Path $assembly | Out-Null
$required = @('CurlStreamer Studio.exe','studio.json','node/node.exe','app/studio.mjs','native/m4_studio_host.exe','native/m4_studio_recorder.exe','native/m4_ip_camera.exe','native/default/curlstreamer-m4-memory.dll','native/production/curlstreamer-m4-memory.dll','renderer/m4-program-renderer.js','renderer/m4-program-renderer.css','obs/bin/64bit/obs.dll','THIRD_PARTY_NOTICES.json','STUDIO-LICENSE.md','WebView2Loader.dll')
foreach ($path in $required) {
  $target = Join-Path $assembly $path
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  [IO.File]::WriteAllText($target,'Synthetic topology fixture; never executed.')
}
Copy-Item -LiteralPath $Executable -Destination (Join-Path $assembly 'CurlStreamer Studio.exe') -Force
[ordered]@{version=1;website='https://studio.example';realtimeUrl='https://studio.example';realtimeKey='sb_publishable_fixture';streamingEnabled=$false}|ConvertTo-Json|Set-Content (Join-Path $assembly 'studio.json') -Encoding utf8NoBOM
$icon = & (Join-Path $PSScriptRoot 'stage-studio-shell-icon.ps1') -SourceIcon (Join-Path (Split-Path -Parent $PSScriptRoot) 'public/branding/curlstreamer.ico') -StudioSource $assembly
function WriteManifest {
  $files = @(Get-ChildItem -LiteralPath $assembly -File -Recurse | Where-Object {$_.Name -ne 'manifest.json'} | ForEach-Object {[ordered]@{path=[IO.Path]::GetRelativePath($assembly,$_.FullName).Replace('\','/');sha256=(Get-FileHash $_.FullName).Hash.ToLowerInvariant()}})
  [ordered]@{version=1;release='0.0.0-fixture';files=$files}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $assembly 'manifest.json') -Encoding utf8NoBOM
}
function Verify { & (Join-Path $PSScriptRoot 'build-m5-installer.ps1') -StudioSource $assembly -InstallerOutput (Join-Path $root 'never-built-installer') -VerifyOnly }
function Reject([scriptblock]$action,[string]$expected) { $failed=$false;try{& $action}catch{if(!$_.Exception.Message.Contains($expected)){throw};$failed=$true};if(!$failed){throw "Accepted invalid shell icon: $expected"} }
WriteManifest
Verify
& (Join-Path $PSScriptRoot 'check-studio-shell-icon.ps1') -StudioSource $assembly -EvidenceDirectory (Join-Path $root 'shell-images')
$original = [IO.Path]::GetFullPath((Join-Path $assembly $icon))
$wrong = [IO.Path]::GetFullPath((Join-Path $assembly ('icons/curlstreamer-shell-'+('a'*64)+'.ico')))
foreach ($path in @($original,$wrong)) {
  if (!$path.StartsWith([IO.Path]::GetFullPath($assembly)+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Icon mutation path escapes the synthetic assembly.' }
}
Move-Item -LiteralPath $original -Destination $wrong
WriteManifest
Reject { Verify } 'Shell icon filename must match'
Move-Item -LiteralPath $wrong -Destination $original
Copy-Item -LiteralPath $original -Destination $wrong
WriteManifest
Reject { Verify } 'ambiguous shell icons'
Remove-Item -LiteralPath $wrong
WriteManifest
$bytes = [IO.File]::ReadAllBytes($original)
[IO.File]::WriteAllText($original,'Damaged synthetic icon')
Reject { Verify } 'Studio component is damaged'
WriteManifest
Reject { Verify } 'Shell icon filename must match'
[IO.File]::WriteAllBytes($original,$bytes)
Remove-Item -LiteralPath $original
WriteManifest
Verify
[IO.File]::WriteAllBytes($original,$bytes)
WriteManifest
if ($CompilerPath) {
  & (Join-Path $PSScriptRoot 'build-m5-installer.ps1') -StudioSource $assembly -InstallerOutput (Join-Path $root 'compiled-fixture-not-for-installation') -CompilerPath $CompilerPath
}
Write-Output 'PASS: new ICO assembly, wrong hash filename, duplicate ICO and changed contents checked; legacy assembly without ICO remains verifiable. Synthetic files and isolated shortcuts only.'
