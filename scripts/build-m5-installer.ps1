param(
  [Parameter(Mandatory = $true)][string]$StudioSource,
  [Parameter(Mandatory = $true)][string]$InstallerOutput,
  [Parameter(Mandatory = $true)][string]$CompilerPath
)
$ErrorActionPreference = "Stop"
$sourceRoot = (Resolve-Path -LiteralPath $StudioSource).Path
$outputRoot = [IO.Path]::GetFullPath($InstallerOutput)
if ($outputRoot.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $outputRoot -eq $sourceRoot) {
  throw "Installer output must be outside the assembled Studio directory."
}
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne 1 -or $manifest.release -notmatch '^\d+\.\d+\.\d+(-[a-z0-9.]+)?$') { throw "Invalid Studio manifest." }
$expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
[void]$expected.Add('manifest.json')
foreach ($file in $manifest.files) {
  $invalidParts = @($file.path.Split('/') | Where-Object { $_ -in @('', '.', '..') -or $_.EndsWith('.') -or $_.EndsWith(' ') })
  if ($file.path -notmatch '^[A-Za-z0-9_. /-]+$' -or $invalidParts.Count) { throw "Invalid component path." }
  if (-not $expected.Add($file.path) -or $file.sha256 -notmatch '^[a-f0-9]{64}$') { throw "Invalid component manifest." }
  $path = [IO.Path]::GetFullPath((Join-Path $sourceRoot $file.path))
  if (-not $path.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Component escapes Studio directory." }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "Studio component is damaged." }
}
# Avoid accidentally shipping developer notes, environments, profiles or build scratch.
foreach ($item in Get-ChildItem -LiteralPath $sourceRoot -Recurse -Force) {
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked files/directories are not package components." }
  if (-not $item.PSIsContainer -and -not $expected.Contains([IO.Path]::GetRelativePath($sourceRoot, $item.FullName).Replace('\', '/'))) { throw "Unexpected file in Studio assembly." }
}
foreach ($required in @('CurlStreamer Studio.exe', 'studio.json', 'node/node.exe', 'app/studio.mjs', 'native/m4_studio_host.exe', 'native/m4_studio_recorder.exe', 'obs/bin/64bit/obs.dll')) {
  if (-not $expected.Contains($required)) { throw "Incomplete Studio assembly." }
}
$configuration = Get-Content -LiteralPath (Join-Path $sourceRoot 'studio.json') -Raw | ConvertFrom-Json
if ($configuration.version -ne 1 -or $configuration.realtimeKey -notmatch '^sb_publishable_[A-Za-z0-9_-]+$' -or $configuration.streamingEnabled -ne $false) { throw "Installer preparation currently accepts only a disabled private preview." }
if (@($configuration.PSObject.Properties.Name | Where-Object { $_ -notin @('version','website','realtimeUrl','realtimeKey','streamingEnabled') }).Count) { throw "Unexpected Studio configuration." }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$installerPath = Join-Path $outputRoot "CurlStreamer-Studio-$($manifest.release)-Setup.exe"
if (Test-Path -LiteralPath $installerPath) { throw "Use a new output directory; existing installers are never overwritten." }
& $CompilerPath "/DStudioSource=$sourceRoot" "/DStudioVersion=$($manifest.release)" "/DInstallerOutput=$outputRoot" (Join-Path $PSScriptRoot '../native/m5-studio-launcher/installer.iss') *> (Join-Path $outputRoot 'compile.log')
if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed. See compile.log." }
$compilerLog = Get-Content -LiteralPath (Join-Path $outputRoot 'compile.log') -Raw
$compilerVersion = [regex]::Match($compilerLog, 'Compiler engine version: Inno Setup ([0-9.]+)').Groups[1].Value
if (-not $compilerVersion) { throw "Compiler version was not reported in compile.log." }
[ordered]@{ release = $manifest.release; installerSha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant(); manifestSha256 = (Get-FileHash -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant(); compilerVersion = $compilerVersion; compilerSha256 = (Get-FileHash -LiteralPath $CompilerPath -Algorithm SHA256).Hash.ToLowerInvariant(); privatePreview = $true } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'installer-evidence.json') -Encoding utf8NoBOM
Write-Output "Private Studio installer compiled and hashed. Distribution readiness remains separate."
