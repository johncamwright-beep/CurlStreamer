param([Parameter(Mandatory = $true)][string]$StudioSource)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$workRoot = Join-Path $repository 'work'
$studioRoot = (Resolve-Path -LiteralPath $StudioSource).Path
if (-not $studioRoot.StartsWith($workRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source snapshots belong to a staged package beneath work.' }
$manifest = Get-Content -LiteralPath (Join-Path $studioRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.release -notmatch '^\d+\.\d+\.\d+(-[a-z0-9.]+)?$') { throw 'Invalid Studio release.' }
$snapshotRoot = Join-Path $workRoot ('studio-source-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $snapshotRoot | Out-Null
Push-Location $repository
try {
  $files = @(git -c "safe.directory=$repository" ls-files --cached --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) { throw 'Source inventory failed.' }
  $inventory = @()
  foreach ($relativeSource in $files) {
    if ($relativeSource -match '(^|/)\.env($|\.)' -and $relativeSource -ne '.env.example') { throw 'Private environment files cannot enter a source snapshot.' }
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $repository $relativeSource))
    if (-not $sourcePath.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source path escapes checkout.' }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
    if ((Get-Item -LiteralPath $sourcePath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked source files cannot enter a snapshot.' }
    $target = Join-Path $snapshotRoot $relativeSource
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $target
    $inventory += [ordered]@{ path = $relativeSource; sha256 = (Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() }
  }
  [ordered]@{ version = 1; gitHead = (git -c "safe.directory=$repository" rev-parse HEAD); scope = 'Current working tree, including uncommitted and untracked source; excludes ignored build outputs and private settings.'; files = $inventory } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $snapshotRoot 'SOURCE-SNAPSHOT.json') -Encoding utf8NoBOM
  $archiveDirectory = Join-Path $studioRoot 'source'
  New-Item -ItemType Directory -Force -Path $archiveDirectory | Out-Null
  $archive = Join-Path $archiveDirectory "CurlStreamer-Studio-$($manifest.release)-source.zip"
  Compress-Archive -Path (Join-Path $snapshotRoot '*') -DestinationPath $archive -CompressionLevel Optimal -Force
  Write-Output "source/CurlStreamer-Studio-$($manifest.release)-source.zip"
} finally { Pop-Location }
