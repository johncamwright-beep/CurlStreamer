# M4 native toolchain

The tested Windows x64 development baseline uses OBS 32.2.2, Visual Studio Build Tools 18.9.2, MSVC toolset 14.51.36231, Windows SDK 10.0.26100.0 and CMake 4.2.8. This records the tested setup, not automatic dependency installation.

Stage the runtime, SDK, source and build output in an explicit setup directory outside Git. Native components have individual CMakeLists.txt and README files under `native/`. Do not replace pinned runtime DLLs with SDK-built binaries.

## Acquisition/build record

The OBS 32.2.2 source release digest was verified as SHA-256 `ec81fb66b03e75ddb3076b576f62679c39262e0e9960cef3e17a40dc5d68e6b4`. Its x64 dependency bundle 2026-07-15 digest was `6f90e9598fa10cff5ad23cdcfae49b87868c07bf896b02cd464582b4ce2f2ba9`. Private acquisition manifests retain the source artifacts and hashes.

For development libraries, configure the pinned source with frontend, plugins, browser and scripting disabled, then build/stage libobs and obs-frontend-api. Explicitly set `-DOBS_VERSION_OVERRIDE=32.2.2` for source archives without Git metadata and `-DCMAKE_SYSTEM_VERSION=10.0.26100.0`. Quote complete `-D` arguments in PowerShell. Upstream configuration may still acquire auxiliary Qt/x86 dependencies.

The standalone harness, native service, recorder and actual camera/YouTube program have subsequent successful evidence; see [rehearsal](m4-controlled-rehearsal.md) and [integration](m4-program-stream-integration.md). Native fixture tests remain separate from real provider evidence.

## Packaging boundary

The default service denies ARM. The production-admission DLL is a separate explicitly selected build; synthetic test gates cannot be combined with production admission. Studio packaging must retain that separation, pin the runtime and include dependency licenses/notices. One distributable installer is future work, not an artifact currently provided by these source directories.
