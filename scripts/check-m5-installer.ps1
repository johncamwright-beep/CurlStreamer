param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$TestRoot
)
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($TestRoot)
if (Test-Path -LiteralPath $root) { throw "Use a new test directory." }
$registration = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{C13ED906-44B5-493A-AF70-81BE409EF911}_is1'
if (Test-Path -LiteralPath $registration) { throw "Studio is already installed; use an isolated test account." }
$mutex = $null
try { $mutex = [Threading.Mutex]::OpenExisting('Local\CurlStreamerStudio') } catch [Threading.WaitHandleCannotBeOpenedException] {}
if ($mutex) { $mutex.Dispose(); throw "Finish and close Studio before this check." }
New-Item -ItemType Directory -Path $root | Out-Null
$installation = Join-Path $root 'Installed Studio'
$recordings = Join-Path $env:LOCALAPPDATA 'CurlStreamer/Studio/Recordings'
New-Item -ItemType Directory -Path $recordings -Force | Out-Null
$sentinel = Join-Path $recordings ("installer-preservation-" + [guid]::NewGuid().ToString() + '.txt')
[IO.File]::WriteAllText($sentinel, 'Preserve recording data across installation changes.')
function RunInstaller([string]$executable, [string[]]$arguments) {
  $child = Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $child.WaitForExit(120000)) { throw "Installer did not finish; inspect its log before retrying." }
  if ($child.ExitCode -ne 0) { throw "Installer exited with $($child.ExitCode)." }
}
try {
  foreach ($step in @('install', 'reinstall')) {
    RunInstaller $Installer @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS',('/DIR="' + $installation + '"'),('/LOG="' + (Join-Path $root "$step.log") + '"'))
    if (-not (Test-Path -LiteralPath (Join-Path $installation 'CurlStreamer Studio.exe'))) { throw "Launch executable missing." }
    $registered = (Get-ItemProperty -LiteralPath $registration).InstallLocation.TrimEnd('\')
    if ($registered -ine $installation) { throw "Installer registered an unexpected location." }
    & node (Join-Path $PSScriptRoot 'check-m5-studio.mjs') $installation
    if ($LASTEXITCODE -ne 0) { throw "Installed controller failed its offline check." }
    if (-not (Test-Path -LiteralPath $sentinel)) { throw "Recording preservation check failed." }
  }
  $uninstaller = Join-Path $installation 'unins000.exe'
  # The only uninstaller invoked belongs to this freshly installed test location.
  if (-not ([IO.Path]::GetFullPath($uninstaller)).StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe uninstall path." }
  RunInstaller $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="' + (Join-Path $root 'uninstall.log') + '"'))
  if ((Test-Path -LiteralPath (Join-Path $installation 'CurlStreamer Studio.exe')) -or (Test-Path -LiteralPath $registration)) { throw "Uninstall left executable or registration behind." }
  if (-not (Test-Path -LiteralPath $sentinel)) { throw "Uninstall removed recording data." }
  [ordered]@{ install = 'passed'; reinstall = 'passed'; installedController = 'passed'; uninstall = 'passed'; recordingsPreserved = $true; cleanWindowsMachine = $false } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'result.json') -Encoding utf8NoBOM
  Write-Output 'PASS: install, reinstall, installed controller/native check, uninstall and recording preservation.'
} finally {
  # Remove only the exact synthetic marker created above, never user recordings.
  if (Test-Path -LiteralPath $sentinel) { Remove-Item -LiteralPath $sentinel }
}
