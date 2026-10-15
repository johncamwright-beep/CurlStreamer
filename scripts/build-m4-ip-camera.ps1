param(
  [Parameter(Mandatory=$true)][string]$SetupRoot,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$cmake = Join-Path $SetupRoot 'native-toolchain/cmake-4.2.8-windows-x86_64/bin/cmake.exe'
$deps = Join-Path $SetupRoot 'native-toolchain/obs-studio-32.2.2-sources/.deps/obs-deps-2026-07-15-x64'
$destinationPath = [IO.Path]::GetFullPath($Destination)
$node = (Get-Command node -ErrorAction Stop).Source
# Some desktop hosts supply both Path and PATH. MSBuild rejects that duplicate.
# Normalize only the child process environment, preserving this shell's settings.
$runner = @'
const cp = require("node:child_process");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
env.Path = process.env.Path || process.env.PATH || "";
const result = cp.spawnSync(process.argv[1], process.argv.slice(2), { env, stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
'@
& $node -e $runner $cmake -S (Join-Path $repository 'native/m4-ip-camera') -B $destinationPath '-G' 'Visual Studio 18 2026' '-A' 'x64' "-DM4_AV_DEPS=$deps"
if ($LASTEXITCODE -ne 0) { throw 'IP camera receiver configuration failed.' }
& $node -e $runner $cmake --build $destinationPath --config Release
if ($LASTEXITCODE -ne 0) { throw 'IP camera receiver compilation failed.' }
Write-Output (Join-Path $destinationPath 'Release/m4_ip_camera.exe')
