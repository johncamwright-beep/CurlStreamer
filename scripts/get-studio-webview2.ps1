param([Parameter(Mandatory = $true)][string]$CacheRoot)
$ErrorActionPreference = 'Stop'
$version = '1.0.4022.49'
$expected = 'ee9de67e5bb9ef3a96c5689b2efc8188e2df160a0e79234c0404243782fde5fb'
$directory = Join-Path ([IO.Path]::GetFullPath($CacheRoot)) "webview2-$version"
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$archive = Join-Path $directory 'sdk.zip'
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg" -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'WebView2 SDK package hash mismatch.' }
$package = Join-Path $directory 'package'
Expand-Archive -LiteralPath $archive -DestinationPath $package -Force
Write-Output $package
