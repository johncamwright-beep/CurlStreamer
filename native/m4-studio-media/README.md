# Managed local recording foundation

This static library owns one isolated libobs 32.2.2 instance and one independent
MKV output. It fixes video at 1920×1080, 30 fps, NV12/Rec.709 limited range, x264
CBR 6000 kbps with the veryfast preset and a two-second keyframe interval. Audio
is stereo 48 kHz AAC at 160 kbps. The initial output is explicitly **black video
and silent audio**, not connected cameras or a finished production scene.

An optional independent RTMP output now shares these exact program encoders.
It uses the production memory service and grants no authority at preparation;
default ARM remains denied. There is no provider connection or OBS profile.
No active OBS installation is modified.

Before OBS startup the process joins a noninherited, process-lifetime Windows
job with `KILL_ON_JOB_CLOSE` and no breakaway permission. Its handle is retained
until OS process exit, containing CEF and mux descendants even after forced
termination. Assignment failure aborts initialization. A fresh private browser
cache receives `.m4-owner.json` via `CREATE_NEW` and flushed write before CEF:
`{"schema":"m4-cef-owner-v1","pid":DWORD,"jobBound":true}`. This contains no
credentials. Recovery must retain active or uncertain owner PIDs and older
directories without this ownership evidence; PID reuse is conservatively retained.

## API

Include `m4-studio-media.h` and link the `m4_studio_media` CMake target. Another
native host can use `add_subdirectory` with `M4_MEDIA_BUILD_VALIDATION=OFF`.

- `m4_media_initialize(runtime_bin, absolute_mkv, &media)` requires a null output
  pointer and absolute local Windows paths. The destination must end in `.mkv`.
- `m4_media_start(media)` starts once. A finalized recording cannot restart.
- `m4_media_prepare_stream(media, runtime_bin, absolute_plugin)` loads the default
  memory-service DLL, rejects test-control exports, creates an independent RTMP
  output and binds the same video/audio encoder objects used by the MKV output.
- `m4_media_attach_stream(media, pipe, capability, parent_pid)` transfers only a
  successfully authenticated overlapped pipe. `m4_media_poll_stream(media)`
  attempts the plugin's one-shot start only after accepted IPC authority.
- `m4_media_active(media)` and `m4_media_bytes(media)` expose activity and actual
  file bytes; muxer buffering can delay byte growth.
- `m4_media_finalize(media, timeout_ms)` requests graceful Stop and waits for
  both the successful OBS stop signal and inactive output, using one 1–30,000 ms
  wait deadline. OBS emits the stop signal before clearing its active flag.
- `m4_media_release(&media)` releases encoders/output and shuts down this owned
  OBS instance. It refuses a live output or a started output whose stop signal
  has not arrived. Successful release nulls the pointer.

Serialize calls on the owning host thread. This library must not share ownership
of a process with another libobs owner. Callback storage remains alive through
output release. Partial initialization releases acquired resources. A failed
initialization can leave its newly created empty reservation file for diagnosis;
choose another unique name for a later attempt.

The destination is reserved with `CREATE_NEW`, so a pre-existing destination is
never opened for writing. A retained file handle denies deletion/replacement
while allowing the pinned OBS muxer to write the reserved file. This prevents
accidental overwrite and name replacement; it does not prevent another process
of the same user from deliberately writing that same file.

The owning process must stage the pinned runtime's `obs-ffmpeg-mux.exe` beside
its executable. OBS resolves that helper relative to the host executable, not
from the runtime argument. The validation target stages it in its private build
output automatically. Runtime DLLs must be discoverable before process entry
(e.g. a narrowly configured host DLL search path); initialization configures the
runtime directory for module dependencies afterward.

The process-wide count-only OBS log guard is installed before startup and kept
through shutdown. No raw OBS error string is returned. Independent library
stderr and helper-process output are separate surfaces; the owning host must
contain them. The library never adds a streaming credential to those surfaces.

A timeout is a failure to prove finalization, not permission to claim a saved
recording. Native library release/shutdown involves OBS joins and filesystem or
OS calls; these are not a hard process deadline. The owning process must enforce
its final containment deadline and report unsuccessful finalization honestly.

## Validation

Configure with the pinned libobs 32.2.2 SDK/dependency prefix, `M4_RUNTIME_BIN`, and
`M4_FFMPEG`; build Release and run `ctest -C Release --output-on-failure`.

The real native validation verifies fixed video/audio settings, records for
2.6 seconds, requires successful stop completion, refuses release while live,
rejects restarting the same output, and verifies that a repeated destination
request preserves the completed file's checksum. A separate FFmpeg process then
decodes both the H.264 video and AAC audio tracks with errors treated as failures.
Each run receives a fresh evidence filename, preserving previous recordings.

September 8, 2026: MSVC `/W4 /WX` Release build and the real recording/decode test
passed (4.43 seconds). Evidence lives in the private
`native-toolchain/m4-studio-media-build/evidence` directory. This is a local
black/silent recording proof, not a physical-camera or YouTube acceptance test.

## Optional public browser program proof

`m4_media_initialize_program(runtime_bin, absolute_mkv, fresh_cache_root,
public_loopback_url, &media)` replaces the black source with the pinned
`browser_source`, before recording starts. The URL must be exactly
`http://127.0.0.1:<port>/`: credentials, query strings, fragments, remote hosts and
other paths are rejected. This API is currently for a trusted public loopback
fixture only; it does not accept a private camera grant or a hosted program URL.
The initial-URL check is not a browser network sandbox or redirect policy.

The cache root must be an unused absolute local directory. It is created with a
protected, inheritable DACL granting the current user access, then passed as
`obs_startup`'s module-configuration root. Pinned browser code derives its CEF
cache and fatal `debug.log` from `obs_module_config_path`, so they stay under
`<fresh_cache_root>/obs-browser`. Existing cache directories are rejected and
never reused or deleted by this library. Retaining isolated cache evidence is
intentional. It is not a promise of memory-only storage.

Windows OBS browser uses its dedicated CEF manager thread, not the macOS Qt
message pump. The shipped `obs-browser-page.exe` and its CEF dependencies resolve
from the plugin directory; the active runtime is read but not modified. Browser
frontend bridge dependencies may load, but webpage control is explicitly None,
and this host never installs a frontend or saves a profile. CEF independently
uses files and stderr outside the OBS log guard; its stock sandbox is disabled.
Private-grant integration remains deferred until that containment is verified.

The source is 1920×1080 at 30 fps with media `object-fit: contain`; it is attached
directly to the matching output canvas without scene cropping or stretching.
The working pinned-runtime configuration uses GPU NV12 conversion with software
CEF texture rendering (`BrowserHWAccel=false`). Hardware browser textures
produced black frames in this isolated host and remain disabled.

With `M4_NODE` configured, a second native test serves four public color
quadrants on an ephemeral loopback port, records and finalizes the source, then
decodes and checks pixels in all four quadrants at the actual 1920×1080 size. It
also decodes both media tracks, verifies cache creation, and exercises URL/cache
reuse rejection. This proves local browser rendering, not connected cameras.
