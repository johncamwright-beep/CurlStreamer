param(
  [Parameter(Mandatory = $true)][string]$SourceIcon,
  [Parameter(Mandatory = $true)][string]$StudioSource
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourceIcon).Path
$root = [IO.Path]::GetFullPath($StudioSource)
$hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$relative = "icons/curlstreamer-shell-$hash.ico"
$destination = Join-Path $root $relative
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Staged shell icon differs from branding.' }
Write-Output $relative
