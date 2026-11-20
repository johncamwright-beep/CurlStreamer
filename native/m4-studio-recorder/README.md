# Managed Studio recording and optional stream channel

The native host owns the browser ProgramCanvas, its video/audio encoders and an
independent MKV recording. Black/silent mode remains available. Recording starts
before READY and remains active until the Node parent closes stdin, sends input,
or exits. READY proves active recording with file bytes; it does not prove browser,
camera, streaming output or provider readiness.

The Node owner is `src/lib/providers/m4-studio-recorder.ts`. Arguments contain only
its PID and public runtime/recording/cache/plugin paths. The host verifies its
actual parent PID. The destination must be a new absolute MKV path; existing files
are refused. A bounded private stdin frame carries the initial program URL before
stdin becomes the shutdown channel. The inherited environment excludes parent
credentials and Node overrides.

## Optional independent streaming channel

Append `--stream-plugin ABSOLUTE_DLL` after the existing recording/program
arguments to create an RTMP output sharing the ProgramCanvas video/audio encoder
objects. This path rejects DLLs exposing test ARM controls. The production plugin
denies ARM by default. Production admission requires the separate, default-OFF
native build gate plus the application's independent authorization gates.

Without streaming, readiness is exactly `READY\n` and EOF. With streaming it is
`READY\n`, the existing 296-byte `StudioBootstrap`, then EOF. The private frame
contains a random capability and a SID-only, local-only named pipe. The Node parent
must connect within five seconds; the plugin verifies its exact PID and
impersonated user SID. A connected channel can wait indefinitely for the operator
before its first header byte. Partial frames remain bounded to two seconds.

The host polls the plugin's one-shot authorized start every 50 ms. ARM replies
mean authority only; they do not prove output activity or provider receipt.
STOP, disconnect, denied ARM, malformed frames and lease expiry revoke only the
bound RTMP output. They never close recorder stdin or stop the ProgramCanvas/MKV.
A missed attachment deadline also leaves the recording active. Closing stdin
still requests application shutdown and successful MKV finalization.

The authenticated opcode-4 observation reports local output activity and bounded
bytes separately from authority. STOP retains this read-only channel until its
owner disconnects. No observation renews authority or proves provider receipt.

## Program and shutdown containment

Browser mode accepts exactly `http://127.0.0.1:PORT/` and a fresh isolated cache
directory. Private invitation URLs are rejected. This initial-URL check is not a
redirect or subresource policy; use the owned loopback program bridge or public
fixtures. CEF cache, logging and authenticated navigation containment remain
separate concerns. Rendering uses GPU video conversion and software CEF textures,
with `object-fit: contain` for media. No active OBS profile is changed.

Graceful finalization requires the successful OBS stop signal and inactive MKV
output. `stop()` is idempotent; `closed` reports unexpected recorder termination.
The native shutdown watchdog exits unsuccessfully after eight seconds if library
teardown hangs, including after parent death. Node also bounds shutdown. Forced
exit never proves finalization. The process-lifetime OBS log guard retains no raw
diagnostics; independent CEF/helper output is a separate containment surface.

## Validation

Configure with the pinned OBS 32.2.2 SDK/dependencies and `M4_RUNTIME_BIN`; build
`m4_studio_recorder` with MSVC `/W4 /WX` in a separate directory. Never replace a
running recorder executable. The build stages the pinned `obs-ffmpeg-mux.exe`
beside the new host executable.

`stream-validation.mjs HOST RUNTIME DEFAULT_PLUGIN FFMPEG EVIDENCE_DIR` runs real
recording checks for browser-program/default ARM denial, disconnect, a stalled
partial frame, and idle attachment for 32 seconds followed by STOP. Each case
requires continuing MKV growth, successful native finalization and audio/video
decode. Optional trailing scenario names select focused checks. Configure
`M4_STREAM_PLUGIN`, `M4_FFMPEG`, and `M4_NODE` to register the suite with CTest.

The Node integration tests use `CURLCAST_TEST_RECORDER_HOST`,
`CURLCAST_TEST_OBS_RUNTIME` and `CURLCAST_TEST_FFMPEG`. They are skipped without the
native setup. Synthetic bound-start/watchdog tests live in
`native/m4-obs-validation`; they cannot connect to a public destination.
The `job-kill` scenario observes actual CEF/mux descendants, forcibly ends only
its recorder, and requires every observed descendant to exit. Forced termination
never claims MKV finalization. The private cache ownership marker is checked.
Production admission remains separately gated, and neither these isolated tests nor
an accepted ARM reply establishes YouTube delivery or dual-output performance.

## Browser paint recovery control

Program callers may append `--program-control` after all other arguments. In this mode the inherited readiness stdout stays open after the existing READY/bootstrap bytes; callers must consume exactly those startup bytes without waiting for EOF. Legacy callers retain the original EOF readiness behavior.

The parent-only stdin accepts exactly eight bytes: ASCII `RFR1` (queue browser refresh) or `RFS1` (query program health), followed by a nonzero uint32 little-endian request ID. Partial commands have a two-second native deadline; malformed input fails closed. EOF still finalizes recording. Control never contains a URL, grant, key or free-form diagnostic string.

Refresh returns eight bytes: `RFA1` when the pinned `refreshnocache` browser property was invoked, or `RFF1` when unavailable, then the matching request ID. Acceptance proves only a queued reload. It does not prove recovered media. Recording, encoders, RTMP authority and camera-helper ownership remain intact.

Health returns 24 bytes: `RFP1`, request ID, raw preview sequence, painted-marker change counter, milliseconds since the last marker change, and active status (0 or 1); all numeric fields are uint32 little-endian. Unknown/no marker age is UINT32_MAX. The program renderer supplies a 12×12 bottom-right grayscale marker alternating RGB 8/40 every 500 ms. The 1280×720 raw preview callback samples its scaled interior at (1276,716), counting changes of at least eight grayscale levels. This distinguishes repeated OBS output from fresh browser painting without relying on motion in the cameras or sponsor content. A renderer heartbeat must also remain fresh.

Run the actual isolated test against a newly built recorder and pinned OBS runtime:

```powershell
node native/m4-studio-recorder/program-recovery-validation.mjs <absolute-recorder.exe> <absolute-OBS-bin-directory>
```

It deliberately stops marker changes, verifies continued raw OBS frames and stale painting, refreshes the browser, checks actual recovered paint, retains the native PID and growing MKV, then gracefully finalizes its own recording. It does not touch an installed Studio session.
