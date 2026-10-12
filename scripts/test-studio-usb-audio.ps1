param([Parameter(Mandatory = $true)][string]$NoiseReductionDll)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$dll = (Resolve-Path -LiteralPath $NoiseReductionDll).Path
$testRoot = Join-Path $repository ('work/audio-native-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = Join-Path $repository 'native/m5-studio-launcher'
$captureTests = Join-Path $testRoot 'UsbAudioTests.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$captureTests" (Join-Path $source 'UsbAudio.cs') (Join-Path $source 'UsbAudioProcessing.cs') (Join-Path $source 'UsbAudioTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native capture tests failed to compile.' }
& $captureTests $dll
if ($LASTEXITCODE -ne 0) { throw 'Native capture integration tests failed.' }
$processingTests = Join-Path $testRoot 'UsbAudioProcessingTests.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$processingTests" (Join-Path $source 'UsbAudioProcessing.cs') (Join-Path $source 'UsbAudioProcessingTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native processing tests failed to compile.' }
& $processingTests $dll
if ($LASTEXITCODE -ne 0) { throw 'Native processing tests failed.' }
Write-Output 'Native microphone checks passed without opening a capture endpoint.'
