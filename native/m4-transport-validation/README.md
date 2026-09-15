# Isolated RTMP and MKV validation

September 8, 2026: STOP and lease-expiry rehearsals passed using the actual pinned OBS 32.2.2 `rtmp_output`, x264/AAC encoders, and `ffmpeg_muxer` MKV output. The fixed receiver binds only `127.0.0.1:19359`. No TLS, provider calls, production credentials, active OBS profile changes, or trust-store changes occur.

The host verifies at least 1,000 RTMP bytes were sent, the watchdog stops streaming, the independent MKV output stays active and its encoded byte count increases afterward, revoked key access closes, and saved service settings and all captured OBS messages omit the synthetic canary. Both finalized MKVs decode successfully with the pinned FFmpeg executable. The encoders are shared by the two independently controlled outputs; this is not proof of separate encoder isolation. Synthetic black video and silent audio exercise media transport, not physical cameras.

Build this directory with CMake and the existing pinned `libobs` SDK/dependency prefix. Build `native/m4-obs-plugin` into a **separate** directory with both `M4_OBS_TEST_API=ON` and `M4_OBS_LOOPBACK_TEST=ON`. The extra option only permits `rtmp://127.0.0.1:19359/live2` through the native test arm function. IPC destination policy and default ARM behavior remain unchanged. The test rejects another loopback address before arming the allowed destination.

Stage the shipped `obs-ffmpeg-mux.exe` beside the new validation executable; OBS resolves the helper relative to its host executable. Do not alter the active OBS runtime or install the test plugin there.

Run `scripts/m4-loopback-rtmp-proof.mjs` with five absolute arguments: validation executable, separate loopback test DLL, pinned OBS runtime `bin/64bit`, pinned FFmpeg executable, and private evidence directory. Children run hidden. The receiver uses a visibly synthetic constant canary in its command line; never pass a real key to this proof. STOP here uses the native test revocation hook, not the application IPC STOP command (covered by separate IPC tests).

Private evidence is under `CurlStreamer-M1-setup/native-toolchain/m4-transport-build/evidence/{stop,expiry}`. Each case saves `independent.mkv`, receiver `received.flv`, `service.json`, `transport.log`, and `host-result.txt`. This validation does not establish frontend MKV/profile switching, real RTMPS trust, server-rejection secret redaction, or YouTube behavior. Server-echoed errors remain an explicit pending transport logging check.
