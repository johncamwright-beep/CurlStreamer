# Private child-process pipe only: do not run with console output or log stdout.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$cameraSettingsPath = Join-Path $userProfile '.curlstreamer/Studio/CameraInputs.dat'
if (-not (Test-Path -LiteralPath $cameraSettingsPath)) {
    $cameraSettingsPath = Join-Path $env:LOCALAPPDATA 'CurlStreamer/Studio/CameraInputs.dat'
}
$cameraBytes = [System.Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($cameraSettingsPath), [Text.Encoding]::UTF8.GetBytes('CurlStreamer.Studio.CameraInputs.v1'), [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    [Console]::Write([Text.Encoding]::UTF8.GetString($cameraBytes))
} finally { [Array]::Clear($cameraBytes, 0, $cameraBytes.Length) }
