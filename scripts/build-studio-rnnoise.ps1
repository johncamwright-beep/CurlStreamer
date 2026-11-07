param(
  [Parameter(Mandatory = $true)][string]$SetupRoot,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $SetupRoot 'native-toolchain/obs-studio-32.2.2-sources/plugins/obs-filters/rnnoise'
$cmake = Join-Path $SetupRoot 'native-toolchain/cmake-4.2.8-windows-x86_64/bin/cmake.exe'
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw 'Use a fresh RNNoise build directory.' }
# Exact embedded-model RNNoise shipped in the verified OBS 32.2.2 source tree.
# Never fetch model weights or source during a Studio build or at runtime.
$pinned = [ordered]@{
  'src/_kiss_fft_guts.h' = '0214dfe2aabb3b81d88fe814b8253fc2ec6da12bbbc98e08c1011a5bd60e3b29'
  'src/arch.h' = '1686a3ca5817bb7d99049a1801c6ab3a7e91a5d0a6804b1c1cafb36e5eeb62f8'
  'src/celt_lpc.c' = '2dfc97b9546f7b03b3cba126f897fdb7ca5e8f471657649fb5a0d4e481ba87ff'
  'src/celt_lpc.h' = '7729cea359579ad962c8b50d0e3b9ff9203a3e6a549040e2440e4f4722805c03'
  'src/common.h' = 'fa6069db8f7fd18d79d5bea55cded6f9019570b2886908323270d07225c7c0ce'
  'src/denoise.c' = 'd12a93858d263f54f30961c6048a92ab5f5e8884ae4d033416b129c35a1bb747'
  'src/kiss_fft.c' = 'b9ad10cb0a55d74df6a9e0f8bc7e932a85457baccf9029bddec1846c34ce51b6'
  'src/kiss_fft.h' = 'ae7f295d1eebb0d19312934de91659b1e852fc8bb433402d4b3146037cb32f0a'
  'src/opus_types.h' = 'e2c1075e26567b8d57706d2f0042e36d5d440721fc3fd27a6fce9f0fc8a31557'
  'src/pitch.c' = '62a14ab50a007c6f6d09c759895820aa127f41be6cdb13f4e9af060cc4a17d31'
  'src/pitch.h' = 'f6939f0b88052506cbe7b1d6b4afd4ead41bedbab80183ec0c4672df0bfae9c2'
  'src/rnn_data.c' = '7b90ed18f065a34597d80b4c00e140a7c5eb6380ef8c9c6bf265384c944ae708'
  'src/rnn_data.h' = 'e756aad79f6f0710cd1fa4abfd9db3da693e92ac3a3a90051e2c969578452653'
  'src/rnn_reader.c' = '8e6cbb1e0ecdfcf800765fc5685d4fb1d239f104b6e7be94a4b71a3d5d8f6bd1'
  'src/rnn.c' = 'dd997af02246ad1dcf577d458369e67a88b8d44d1df43edd224a3c930ce5aeed'
  'src/rnn.h' = '69f64f0fa4485b37d0a5d4d481bf7a5e1dbb24db1a5eb0c44593da59a703bc91'
  'src/tansig_table.h' = '835fcdf08d5b92e249fbe9ba6cdd9758688a5fdf134efb9da0e42989e8c18b8a'
  'include/rnnoise.h' = '739d2144be7f121c66ccbd919a6ec7a51abd494c4d46558671c80b940728969a'
  'COPYING' = 'e2f59ff41d9d03adc3dcf3deff170f8c8cf4a6eb4a9b174762a7656d23200ffa'
}
foreach ($entry in $pinned.GetEnumerator()) {
  if ((Get-FileHash -LiteralPath (Join-Path $source $entry.Key) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw "Pinned RNNoise source mismatch: $($entry.Key)" }
}
New-Item -ItemType Directory -Path $destinationPath | Out-Null
foreach ($entry in $pinned.GetEnumerator()) {
  $target = Join-Path $destinationPath "source/$($entry.Key)"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath (Join-Path $source $entry.Key) -Destination $target
}
Copy-Item -LiteralPath (Join-Path $source 'COPYING') -Destination (Join-Path $destinationPath 'RNNoise-COPYING.txt')
$project = @'
cmake_minimum_required(VERSION 3.28)
project(CurlStreamerRNNoise C)
add_library(curlstreamer_rnnoise SHARED source/src/celt_lpc.c source/src/denoise.c source/src/kiss_fft.c source/src/pitch.c source/src/rnn.c source/src/rnn_data.c source/src/rnn_reader.c)
target_include_directories(curlstreamer_rnnoise PRIVATE source/src source/include)
target_compile_definitions(curlstreamer_rnnoise PRIVATE COMPILE_OPUS RNNOISE_BUILD DLL_EXPORT)
set_property(TARGET curlstreamer_rnnoise PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
'@
Set-Content -LiteralPath (Join-Path $destinationPath 'CMakeLists.txt') -Value $project -Encoding utf8
# Normalize PATH casing for MSBuild; never mutate the parent shell environment.
$runner = @'
const cp = require("node:child_process");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
env.Path = process.env.Path || process.env.PATH || "";
const result = cp.spawnSync(process.argv[1], process.argv.slice(2), { env, stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
'@
$node = (Get-Command node -ErrorAction Stop).Source
& $node -e $runner $cmake -S $destinationPath -B (Join-Path $destinationPath 'build') -G 'Visual Studio 18 2026' -A x64
if ($LASTEXITCODE -ne 0) { throw 'RNNoise configuration failed.' }
& $node -e $runner $cmake --build (Join-Path $destinationPath 'build') --config Release
if ($LASTEXITCODE -ne 0) { throw 'RNNoise build failed.' }
$dll = Join-Path $destinationPath 'build/Release/curlstreamer_rnnoise.dll'
[ordered]@{ component = 'RNNoise'; source = 'OBS Studio 32.2.2/plugins/obs-filters/rnnoise'; license = 'BSD-3-Clause'; sources = $pinned; dllSha256 = (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destinationPath 'rnnoise-provenance.json') -Encoding utf8
Write-Output $dll
