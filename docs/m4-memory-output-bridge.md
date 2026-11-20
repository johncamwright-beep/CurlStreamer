# M4 memory-only encoder bridge

Status: September 8, 2026. A native memory-only service and independent watchdog are implemented and validated with the real OBS runtime and local test outputs. Production target delivery and network streaming remain disabled; the active pilot OBS profile has no plugin installed.

Authenticated local IPC is now connected to that service. The native bootstrap verifies the expected peer process and private server pipe; framed requests additionally verify client user SID, a random capability and strict sequence numbers. A separate synthetic controller transferred a canary, renewed authority and exercised disconnect, kill, replay, invalid-token, oversized-frame and stalled-message cases. Recording continued when the bound output stopped. The default build rejects ARM, including through IPC; the Node pipe client and server-authorized handoff are implemented behind disabled flags. The production Studio launcher remains unwired.

See the [plugin](../native/m4-obs-plugin/README.md) and [real-libobs validation](../native/m4-obs-validation/README.md). Lease expiry, explicit revoke and deliberately late activation stop only the bound stream output while a separate raw recording continues. The default build has no arming exports and denies start. All 18 CTest cases passed, including five using the actual Node pipe client and one native-produced versioned bootstrap; settings/captured-log canary checks passed. This does not yet prove frontend MKV recording or RTMPS transport.

The earlier standalone [Windows IPC harness](../native/m4-bridge/README.md) passed seven child-process failure scenarios using simulated output. The newer plugin tests add independent expiry enforcement and real-libobs local output/recording evidence. Frontend and actual transport persistence checks remain necessary.

The portable OBS 32.2.2 build pins obs-websocket 5.7.4. Its `SetStreamServiceSettings` handler calls `obs_frontend_save_streaming_service()`. OBS serializes the service settings to `service.json` with temporary and backup files. Clearing the key after streaming would not satisfy the pilot's memory-only destination boundary. Sending a key through `CallVendorRequest` is also unsuitable: WebSocket debug logging can serialize incoming requests.

Sources:

- [Pinned WebSocket configuration handler](https://github.com/obsproject/obs-websocket/blob/1ef34bf48110c2a18184e50e41cd0b1a855e2147/src/requesthandler/RequestHandler_Config.cpp)
- [OBS 32.2.2 service persistence](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/widgets/OBSBasic_Service.cpp)
- [WebSocket message logging](https://github.com/obsproject/obs-websocket/blob/5.7.4/src/websocketserver/WebSocketServer.cpp)
- [OBS service API](https://docs.obsproject.com/reference-services)

## Proposed bridge

Use a small native OBS service plugin whose serialized settings contain no credential. Deliver the destination through an authenticated, same-user Windows named pipe into private plugin memory. Supply server and key separately through the service connection API. Keep keys out of `obs_data_t`, WebSocket requests, process arguments, logs, environment and exported diagnostics.

The plugin needs its own bounded authority watchdog: if the Node controller crashes, a Node timer cannot stop an independently running OBS process. Preserve local recording when stopping the streaming output. Local observations and provider ingest observations remain separate evidence. Do not permit automatic replacement after target delivery until the old provider target is retired and cleanup is confirmed.

The existing `ObsLocal` allowlist still excludes stream configuration and start; it remains the M3 inspection/recording adapter. `m4-local-output.ts` is a one-shot controller core with an injected encoder port and mock tests, not a working OBS bridge or authentication boundary. It bounds pending operations, stops on lease expiry, reconciles uncertain start/stop, and exposes only redacted local state. No route instantiates it. A new controller must not be used as a workaround for server takeover quarantine.

## Required native validation

Build a test harness with a synthetic credential canary. Exercise profile save/switch, ordinary shutdown, rejected starts, pending starts, IPC loss, controller crash and enabled debug logging. Search profile files, backups, logs and exported diagnostics for the canary. Verify that plugin authority expiry stops sending while recording continues. This establishes application-level containment, not immunity from memory inspection, crash dumps or paging.

The compiler and matching OBS SDK are now established; see [toolchain evidence](m4-native-toolchain.md). The application coordinator now binds delivery to the server's reserved output intent through migration 0028 and a restricted desktop target route. Consumption precedes decrypt/provider work; a final assertion checks authority and unchanged resource bindings. Lost or failed delivery cannot retry or clear quarantine. Remaining work includes the production Studio launcher, provider retirement, and actual transport/profile persistence validation. The current native framing accepts keys up to 255 ASCII bytes and fails closed on longer keys. Native renewal must receive the remaining server-authorized lease with a stop margin; it must not blindly grant a fresh duration without a successful server renewal. Do not enable real target delivery on the strength of synthetic local output tests alone.

## Managed Studio lifetime — September 8

`m4-studio-output.ts` connects the production bootstrap reader, paired desktop client, application coordinator and pipe client. `m4-studio-runtime.ts` schedules one renewal at a time after successful startup and stops both authorities on cancellation/failure. Cleanup is shared across races; no automatic handoff retry is permitted. Bootstrap reads and pipe connection each have a two-second bound; cancellation during those steps waits for that bound and cannot deliver a target. Three seconds are subtracted from remaining server authority to cover the two-second IPC response bound and stop scheduling. This is not a hard real-time guarantee.

The 296-byte bootstrap contains a magic/version, zero-padded pipe name and 32-byte capability only. All consumed byte buffers are wiped; the adapter wipes the returned capability after connecting and on failure. The trusted native producer for this new format and the operator-facing Studio launcher remain to be wired. Existing native tests still use their separately labelled synthetic bootstrap.

The native validation launcher now gives Node a minimal environment and absolute executable/script paths. Five real Node/libobs tests prove parent preload variables and a harmless parent marker do not reach the child. Production distribution still requires a pinned prebuilt bundle; the validation script's in-memory esbuild step is development tooling.

## Actual local transport and MKV evidence

The isolated [RTMP/MKV host](../native/m4-transport-validation/README.md) passed STOP and lease expiry with the shipped OBS RTMP output, x264/AAC encoders and MKV muxer. The local receiver obtained encoded media and both finalized recordings decoded. The independent recording output kept producing encoded packets after streaming stopped. This uses a separate test DLL allowing only a fixed loopback RTMP endpoint through its test arm API; default ARM and IPC destination policies are unchanged.

Actual TLS success remains pending. Windows OBS validates against the Windows root store; the next TLS harness should use an isolated test-build CA input rather than changing the machine trust store. Server rejection must deliberately echo the synthetic key: the pinned `plugins/obs-outputs/librtmp/rtmp.c` logs server-provided error descriptions, so successful-stream log checks cannot prove rejection-path containment. Frontend service-save/profile replacement remains separate from the headless MKV test. No live provider target should be enabled until those paths are addressed.

## TLS, diagnostics and operator controls

The [isolated RTMPS validation](../native/m4-tls-validation/README.md) now passes successful STOP/expiry and wrong-host/invalid-signature rejection. The separate test OBS output module changes only CA loading for these tests, keeping required verification and hostname checks. Decoded receiver media and independently controlled MKVs establish encrypted local transport. This does not prove the deployed Windows-root configuration against YouTube.

The [native log guard](../native/m4-log-guard/README.md) drops raw log formats and arguments instead of trying to redact arbitrary remote text. The default Studio host installs it before OBS startup and retains it through shutdown. Fixed numeric severity counts are available; they are not detailed diagnoses. Real libobs callback tests cover hostile formats, split/encoded synthetic secrets and concurrent logging. Actual server rejection and other direct stdout/crash/plugin logging paths still require their own evidence.

`m4-operator-server.ts` serves a temporary local operator window on a random loopback port. Exact Host, HttpOnly SameSite cookie, same-origin JSON POST, bounded strict command parsing and no-store/CSP headers protect its controls. Check this PC invokes the real native channel without an ARM or server request. Pairing controls and backend command are off by default until pilot server setup is deliberately enabled; streaming commands do not exist. The packaged Studio shell and production output activation remain future integration work. The browser check passed using installed Edge, including a 390px layout.
