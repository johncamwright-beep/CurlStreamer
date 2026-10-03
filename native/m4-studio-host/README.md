# M4 Studio parent/child topology proof

This isolated headless host proves the Node-parent/native-child bootstrap direction. It is not an operator launcher and cannot stream or record. It loads only a plugin without the test ARM export; the current default plugin denies every ARM request.

The parent launches `m4_studio_host.exe --parent-pid PID --plugin ABSOLUTE_DLL --runtime ABSOLUTE_OBS_BIN` with stdout connected to a private anonymous pipe. Arguments contain only public paths and a process ID. The trusted pinned OBS runtime must also be on the child's minimal PATH because Windows resolves the executable's libobs import before `main`.

The host checks its actual parent PID, creates a first-instance duplex overlapped named pipe with a current-user-only DACL and remote-client rejection, writes exactly 296 versioned bootstrap bytes to stdout, then closes stdout. It checks the connecting process through the plugin's authenticated attachment function. No capability is written to a file, command line, environment variable, or log.

Connection startup is limited to five seconds. After attachment the host waits for parent death or a 15-second proof lifetime, then releases the service and shuts down libobs. The parent may terminate its owned proof child earlier. This timeout is deliberately unsuitable for production streaming; a future managed host needs the full output lifecycle and recording integration.

Build with CMake 4.2, the pinned OBS 32.2.2 development SDK and matching obs-deps in `CMAKE_PREFIX_PATH`. From the repository root, with the toolchain on PATH:

```powershell
cmake -S native/m4-studio-host -B C:/private-build/m4-studio-host -A x64 '-DCMAKE_PREFIX_PATH=C:/pinned/obs-sdk-32.2.2;C:/pinned/obs-deps-2026-07-15-x64'
cmake --build C:/private-build/m4-studio-host --config Release
```

Replace the three example absolute directories with the pinned SDK, dependencies and private build directories. The build uses `/W4 /WX` and control-flow protection. No DLL is installed into the user's OBS profile.

For the real child-process integration test, set `CURLCAST_TEST_STUDIO_HOST` to the resulting executable, `CURLCAST_TEST_DEFAULT_PLUGIN` to the default-deny DLL and `CURLCAST_TEST_OBS_RUNTIME` to the pinned runtime directory, then run `src/lib/providers/m4-studio-host.test.ts` with Vitest. That test uses simulated server replies and a synthetic key with the real native bootstrap and pipe. Default ARM rejection is the required result; it does not contact YouTube.

The application keeps desktop pairing and its bearer in the Node parent. This proof validates that process topology and the authenticated native handoff, but the operator UI, packaged launcher, actual media outputs and real RTMPS rehearsal remain separate work.
