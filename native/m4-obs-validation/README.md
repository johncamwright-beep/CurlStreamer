# OBS service validation host

IPC validations now exercise the production `m4_bind_output` and
`m4_start_if_authorized` exports with the separately built synthetic plugin.
They reject binding the recording output, repeated binding and repeated start.
The STOP case accepts an IPC ARM, starts a delayed local output and sends STOP
before that output activates; the watchdog stops the observed late activation.
Cases 10 and 11 verify that output-start failure and expiry before the first
start remain terminal and preserve the independent recording. These custom
outputs never open a network connection.

The separate `M4_PRODUCTION_PLUGIN` artifact adds cases 12–15: accepted strict
YouTube-shaped authority to a custom local sink, invalid key, lookalike hostname,
and excessive lease. Default denial and absence of test exports remain checked.
Authenticated opcode-4 checks cover connecting, active, failed start and stopped
after STOP without reviving authority. The 18-case suite passed; the strengthened
connecting/failed-observation cases also passed independently.

This Windows host loads the new service DLL into the pilot's actual OBS 32.2.2 libobs runtime, outside the active OBS application. It creates a 64 × 64, 30 fps D3D11 video pipeline. A custom local stream sink receives frames without networking; a separate raw I420 output writes real frames to `recording.yuv`.

This is actual libobs output/recording evidence, not a test of RTMPS, YouTube, the frontend MKV recorder, physical cameras or OBS WebSocket. No plugin is installed into the active pilot profile.

## Results — September 8, 2026

Release x64 compiled with `/W4 /WX` and Control Flow Guard. All 17 CTest cases passed: two service cases, ten IPC cases exercising a separate native controller, and five cases exercising the actual Node pipe client.

- `service_watchdog`: a one-shot synthetic grant expires, explicit revocation stops output, and capture deliberately starts after expiration then gets stopped. The delayed callback must actually succeed, not merely attempt activation. In each case, the stream stops receiving frames and the separate raw recording continues receiving frames. Revoked restart and subsequent key access are denied.
- `default_closed`: the default plugin exports no test controls and denies unarmed output start.

| IPC case | Evidence                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------- |
| 0        | Authenticated canary transfer followed by lease expiry.                                         |
| 1        | Controller disconnect stops the bound output.                                                   |
| 2        | Actual `TerminateProcess` of the controller stops output while recording continues.             |
| 3        | A valid renewal keeps output active past the original deadline, then the renewed lease expires. |
| 4        | Explicit STOP revokes output.                                                                   |
| 5        | Incorrect capability never arms output.                                                         |
| 6        | Oversized declared payload never arms output.                                                   |
| 7        | Replayed sequence number revokes the armed output.                                              |
| 8        | A partial stalled header does not prevent the independent watchdog from stopping output.        |
| 9        | The default build refuses ARM even over an authenticated channel.                               |

Every IPC case rejects an incorrect expected process ID before correct attachment, checks saved settings, and confirms the separate raw recording continues after the stream is stopped or denied. The trusted test host creates a first-instance local duplex pipe with a protected user-only DACL and remote clients disabled. A random capability and canary travel to the controller through an anonymous inherited pipe; only its handle number appears in process arguments. Explicit handle inheritance and a kill-on-close job constrain the test child. The plugin receives the already-connected server handle through a native in-process bootstrap API, with ownership transferred only on success.

The native standalone controller uses synchronous I/O and is bounded by the test job/process timeout. It is test tooling, not the production Node controller or Studio launcher. The plugin's IPC worker is separate from its watchdog. No test arm function is called in the IPC cases.

Both variants exercise the eight-worker limit and reuse after release. OBS retains a placeholder when a service implementation fails to create; its callbacks return safe inactive results. The test variant confirms the ninth worker cannot be armed. Normal shutdown unloads the module and joins workers.

The synthetic destination and per-run random canary key are absent from saved service settings before/after stopping. The host scans all captured libobs messages for the key, including debug messages, and tests safe settings saves/backups. The target is never placed in settings by the plugin. Arbitrary secrets supplied to OBS settings by some other caller are not protected by this design.

These are short observation windows, not a hard real-time latency guarantee. IPC/controller-death evidence now runs end-to-end through the actual plugin, using a synthetic target and local output. Frontend profile switching, RTMP transport logging, actual MKV recording and crash-path persistence remain untested. No separate-user or remote-computer intrusion test was performed.

## Reproduce

Build with the installed CMake/MSVC/Windows SDK using `find_package(libobs 32.2.2 EXACT)` and the staged SDK plus pinned obs-deps in `CMAKE_PREFIX_PATH`. Set `M4_RUNTIME_BIN`, `M4_TEST_PLUGIN` and `M4_DEFAULT_PLUGIN` to the absolute pinned runtime and separately built DLL paths. CTest configures separate evidence directories, prepends the runtime DLL path, and imposes 30/15-second service-case timeouts and 20-second IPC-case timeouts.

Private build/evidence root: `C:/CurlStreamer-setup\native-toolchain\m4-obs-validation-build`. Run `ctest --test-dir <build-directory> -C Release --output-on-failure`. Build artifacts, raw recording, service JSON/backup and captured logs stay outside Git. `m4-obs-plugin-validation.json` in the private toolchain directory records the final hashes and result.

## Node controller proof

`scripts/m4-node-ipc-proof.mjs` bundles the real TypeScript pipe client in memory. The trusted validation host supplies a 384-byte bootstrap on inherited stdin; no capability or destination appears in arguments or environment. Node scenarios 0–4 cover expiry, disconnect, process death, renewal and STOP while raw recording continues. Configure `M4_NODE_EXECUTABLE` and `M4_NODE_SCRIPT` as absolute public paths to enable these cases. This proof uses a synthetic destination and does not launch the production Studio application or call YouTube.

### Child environment isolation

The Node path now uses an explicitly constructed minimal environment. Parent `NODE_OPTIONS`, `NODE_PATH`, esbuild overrides and application credentials are not inherited. CTest supplies harmless parent override values and a marker; the Node proof rejects their presence. All five Node cases passed after this change. The native C controller remains test tooling with its earlier environment behavior. This host still sends the synthetic test bootstrap; production Studio's versioned 296-byte bootstrap is a separate format.
