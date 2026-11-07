# Studio pilot release

The Windows desktop source is licensed as described in STUDIO-LICENSE.md. The hosted web service and customer data are outside that grant. Third-party components retain their own licenses.

## Build inputs

- Node 24.19.0 and the checked-in package-lock.json (run npm ci).
- Windows x64, .NET Framework 4.8 compiler, WebView2 SDK 1.0.4022.49 (the acquisition script pins its checksum).
- Visual Studio Build Tools 18.9.2, MSVC 14.51.36231, Windows SDK 10.0.26100.0, CMake 4.2.8.
- OBS Studio 32.2.2 official Windows x64 runtime and full Sources release. The source archive includes OBS browser, websocket and capture submodule sources.
- OBS dependency recipes dated 2026-07-15, including patches and source revisions; Qt 6.11.1. Corresponding source archives accompany the release.
- Inno Setup 6.7.3; its license accompanies the installer.

See m4-native-toolchain.md and the README files under native/ for native component build instructions. Build the OBS SDK separately from the pinned runtime; do not replace the runtime DLLs with SDK build outputs.

## Native build layout

The build script expects an explicit SetupRoot with obs-m3-32.2.2 containing the official OBS runtime, and native-toolchain containing these Release builds:

| Directory                     | Source                    | Options                                                                                     |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| m4-studio-host-build          | native/m4-studio-host     | CMAKE_PREFIX_PATH points to OBS SDK and x64 dependencies                                    |
| m4-readiness-recorder-build   | native/m4-studio-recorder | same prefix, M4_RUNTIME_BIN points to official OBS bin/64bit; M4_MEDIA_BUILD_VALIDATION=OFF |
| m4-readiness-default-build    | native/m4-obs-plugin      | OBS_SDK_ROOT; all test and production admission options OFF                                 |
| m4-readiness-production-build | native/m4-obs-plugin      | OBS_SDK_ROOT; M4_OBS_PRODUCTION_ADMISSION=ON; test options OFF                              |

Use the Visual Studio 18 2026 generator and Release configuration. The recorder copies obs-ffmpeg-mux.exe from the pinned OBS runtime.

## Assembly and installer

1. Write a public-only configuration JSON with version: 1, website, realtimeUrl, realtimeKey (Supabase publishable key only), and streamingEnabled. Never include a server key, account session, OBS profile or RTMP key.
2. Run scripts/build-m5-studio.ps1 with SetupRoot, a new Destination, Configuration and Release.
3. Run scripts/prepare-studio-notices.mjs with the assembled directory, SetupRoot and the versioned GitHub release URL. This copies notices, inventories bundled JavaScript dependencies and rehashes the component manifest. It fails on missing required notices.
4. Run scripts/check-m5-studio.mjs against the assembly for the isolated offline smoke test.
5. Run scripts/build-m5-installer.ps1 with StudioSource, a new InstallerOutput and CompilerPath. Streaming-enabled pilot configuration requires the explicit AllowStreamingPreview flag. Publish its Inno-Setup-LICENSE.txt with the installer.
6. Publish the installer, matching source, third-party source, notices and SHA-256 checksums together as a GitHub prerelease. Verify the public asset before setting src/lib/studio-release.ts to published.

The source package supplies code and build instructions; byte-for-byte reproducibility of native compiler outputs is not asserted. The installer is unsigned. Offline smoke checks do not replace a clean Windows install/update test or an actual camera/audio/broadcast rehearsal.

## Updates

Website updates deploy independently. Native Studio updates require a new version and installer. Close Studio before updating; the installer preserves recordings and per-user application data. Never reuse a published version or replace its assets silently.
