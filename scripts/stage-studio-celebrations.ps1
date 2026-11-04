param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [Parameter(Mandatory = $true)][string]$StudioSource
)
$ErrorActionPreference = 'Stop'
function Get-CelebrationHash([string]$Path) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)) }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
$sourceDirectory = Join-Path (Resolve-Path -LiteralPath $SourceRoot).Path 'celebrations'
$rendererDirectory = Join-Path ([IO.Path]::GetFullPath($StudioSource)) 'renderer/celebrations'
$assets = @('lightsaber.mp4', 'cat-dance.mp4', 'lightsaber-foreground-0.png', 'lightsaber-foreground-1.png', 'lightsaber-foreground-2.png')
New-Item -ItemType Directory -Path $rendererDirectory -Force | Out-Null
foreach ($asset in $assets) {
  $source = Join-Path $sourceDirectory $asset
  $item = Get-Item -LiteralPath $source
  if ($item.PSIsContainer -or $item.Length -le 0 -or $item.Length -gt 32MB -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid bundled celebration asset.' }
  $destination = Join-Path $rendererDirectory $asset
  Copy-Item -LiteralPath $source -Destination $destination -Force
  if ((Get-CelebrationHash $source) -ne (Get-CelebrationHash $destination)) { throw 'Staged celebration asset differs from source.' }
  Write-Output "renderer/celebrations/$asset"
}
