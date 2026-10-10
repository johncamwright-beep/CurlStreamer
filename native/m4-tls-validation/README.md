# Isolated RTMPS validation

This is a **test-only source rebuild**, not the shipped OBS output module or a production trust configuration. It exercises pinned OBS 32.2.2 RTMP code over TLS to a Node TLS listener bound only to `127.0.0.1:19360`; the listener forwards decrypted bytes to an FFmpeg RTMP receiver on `127.0.0.1:19359`. Synthetic black video and silent audio use real x264/AAC encoders and an independent MKV output.

The reproducible source difference is retained in `isolated-ca.patch`. The CMake source transformation replaces only CA loading in a generated copy of `librtmp/rtmp.c` with the explicit `M4_CA_FILE`. The upstream `MBEDTLS_SSL_VERIFY_REQUIRED` and `mbedtls_ssl_set_hostname` checks remain intact. No Windows ROOT certificate changes, insecure TLS switches, real provider destinations, or active OBS runtime/profile writes are used. The test DLL must never be distributed. The generated copy of the memory service allows only fixed `rtmps://localhost:19360/live2` through its test API; production IPC/default ARM policy is unchanged.

The standalone source build also compiles upstream HEVC parsing into the test output module because the existing development SDK omitted that export; exercised media remains H.264. It builds the ordinary OBS output module sources and dependencies, using the installed libobs SDK and pinned dependency bundle.

## Reproduction

1. Run `generate-certificates.py ABSOLUTE_PRIVATE_CERT_DIRECTORY` with Python plus cryptography. It creates a two-day CA, valid localhost leaf, a trusted wrong-host leaf, and a leaf with an invalid issuer signature. All keys are disposable synthetic test keys. Nothing is installed into a trust store.
2. Configure this directory with the pinned CMake/MSVC tools, `CMAKE_PREFIX_PATH` containing the pinned libobs SDK and OBS dependency prefix, `OBS_SOURCE` pointing to verified OBS 32.2.2 sources, and `M4_CA_FILE` pointing to the generated ca.pem. Build Release.
3. Copy the pinned shipped `obs-ffmpeg-mux.exe` beside the new host executable only.
4. Run `scripts/m4-loopback-rtmps-proof.mjs` using seven absolute arguments: host executable, m4-tls-memory.dll, shipped OBS bin/64bit directory, pinned ffmpeg.exe, private evidence directory, m4-test-outputs.dll, certificate directory.

The four cases are STOP, lease expiry, trusted wrong hostname, and untrusted signature. The first two require real TLS handshakes and transmitted RTMPS media, followed by stream shutdown while MKV bytes continue. The latter two require TLS rejection, no successful server TLS handshake, zero transmitted media, stopped stream output, and continued recording. All four MKVs must finalize and decode. The two received RTMPS media files must also decode. These four cases passed on September 8, 2026; the persisted log/settings scan found no canary. Each host also checks that the synthetic stream-key canary is absent from service settings and every captured raw OBS log message.

The host now installs the production count-only OBS log guard before startup;
raw logs are never formatted or persisted. Only numeric log counts and fixed
result text leave the process. These cases do not establish YouTube behavior,
public certificate chain compatibility, physical camera media or OBS profiles.

`hostile-rejection.mjs` takes the same seven tooling paths and binds a TLS RTMP
peer only at `127.0.0.1:19360`. It completes RTMP connection/stream creation,
receives the actual synthetic publish key, then echoes that key in an AMF
`NetStream.Publish.BadName` rejection description. The test requires no stream
media, actual guarded OBS errors, continued independent MKV recording and decode,
and absence of the canary from stdout, stderr and persisted diagnostics. It
passed using the separate `m4-readiness-tls-build` artifact/evidence directory.
This is an actual hostile-server rejection through the transport, not injected
logger text. No certificate or active OBS installation is modified.
