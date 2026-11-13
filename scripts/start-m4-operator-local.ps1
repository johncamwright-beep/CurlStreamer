param(
  [Parameter(Mandatory = $true)][uri]$Origin,
  [Parameter(Mandatory = $true)][guid]$GameId,
  [switch]$IntegratedStream,
  [switch]$Readiness,
  [switch]$Rehearsal,
  [Parameter(Mandatory = $true)][string]$SetupRoot
)

$ErrorActionPreference = "Stop"
if ($Rehearsal) { $Readiness = $true }
if ($Origin.Scheme -ne "https" -or $Origin.AbsoluteUri.TrimEnd("/") -ne $Origin.GetLeftPart("Authority")) {
  throw "Origin must be an HTTPS origin without a path."
}

$repository = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repository ".env.local"
$settings = @{}
foreach ($line in Get-Content -LiteralPath $environmentFile) {
  if ($line -notmatch "^([A-Z0-9_]+)=(.*)$") { continue }
  $value = $matches[2].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  $settings[$matches[1]] = $value
}
if (-not $settings["NEXT_PUBLIC_SUPABASE_URL"] -or
    -not $settings["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
  throw "Supabase public configuration is incomplete."
}

$node = (Get-Command node -ErrorAction Stop).Source
$bundle = Join-Path $SetupRoot $(if ($Readiness) { "m4-operator-ready.mjs" } elseif ($IntegratedStream) { "m4-operator-stream.mjs" } else { "m4-operator.mjs" })
$recorder = Join-Path $SetupRoot $(if ($Readiness) { "native-toolchain\m4-readiness-recorder-build\Release\m4_studio_recorder.exe" } elseif ($IntegratedStream) { "native-toolchain\m4-studio-recorder-stream-build\Release\m4_studio_recorder.exe" } else { "native-toolchain\m4-studio-recorder-build\Release\m4_studio_recorder.exe" })
$plugin = Join-Path $SetupRoot $(if ($Readiness) { "native-toolchain\m4-readiness-default-build\Release\curlstreamer-m4-memory.dll" } elseif ($IntegratedStream) { "native-toolchain\m4-obs-plugin-stream-build\Release\curlstreamer-m4-memory.dll" } else { "native-toolchain\m4-obs-plugin-build\Release\curlstreamer-m4-memory.dll" })
if ($Rehearsal) { $plugin = Join-Path $SetupRoot "native-toolchain\m4-readiness-production-build\Release\curlstreamer-m4-memory.dll" }
$runtime = Join-Path $SetupRoot "obs-m3-32.2.2\bin\64bit"
$arguments = @(
  $bundle,
  $Origin.GetLeftPart("Authority"),
  $GameId.ToString(),
  (Join-Path $SetupRoot "native-toolchain\m4-studio-host-build\Release\m4_studio_host.exe"),
  $plugin,
  $runtime
)
foreach ($path in @($node, $bundle, $runtime, $arguments[3], $arguments[4],
    $recorder,
    (Join-Path $SetupRoot "m4-program-assets\m4-program-renderer.js"),
    (Join-Path $SetupRoot "m4-program-assets\m4-program-renderer.css"))) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Studio component is missing." }
}

$env:NEXT_PUBLIC_SUPABASE_URL = $settings["NEXT_PUBLIC_SUPABASE_URL"]
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $settings["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
$env:CURLCAST_M4_RECORDER_HOST = $recorder
$env:CURLCAST_M4_STREAM_PLUGIN = if ($IntegratedStream -or $Readiness) { $plugin } else { $null }
# Rehearsal is an explicit opt-in after the scoped deployment approval.
$env:CURLCAST_M4_PAIRING_ENABLED = if ($Rehearsal) { "1" } else { "0" }
$env:CURLCAST_M4_STREAMING_ENABLED = if ($Rehearsal) { "1" } else { "0" }
$env:CURLCAST_M4_RECORDING_ROOT = Join-Path $SetupRoot "m4-program-recordings"
$env:CURLCAST_M4_CACHE_ROOT = Join-Path $SetupRoot "m4-program-cache"
$env:CURLCAST_M4_RENDERER_ROOT = Join-Path $SetupRoot "m4-program-assets"

$process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $SetupRoot -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $SetupRoot "m4-operator-live.out.log") `
  -RedirectStandardError (Join-Path $SetupRoot "m4-operator-live.err.log") -PassThru
$listener = $null
for ($attempt = 0; $attempt -lt 25; $attempt++) {
  Start-Sleep -Milliseconds 200
  $listener = Get-NetTCPConnection -OwningProcess $process.Id -State Listen -ErrorAction SilentlyContinue |
    Where-Object LocalAddress -eq "127.0.0.1" | Select-Object -First 1
  if ($listener) { break }
}
if (-not $listener) { throw "Studio operator did not start." }
Write-Output "http://127.0.0.1:$($listener.LocalPort)/"
