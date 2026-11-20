# Private IP camera receiver

This Windows x64 helper uses the pinned OBS runtime's FFmpeg libraries to decode
an actual RTSP camera stream. It is separate from the composed program
recorder. Its JPEG frames enter the existing renderer and therefore appear in
Studio preview, local output and streaming output.

Build into a workspace staging directory:

```powershell
./scripts/build-m4-ip-camera.ps1 -SetupRoot <existing-setup-root> -Destination <new-build-directory>
```

The matching dependency bundle lives under
`native-toolchain/obs-studio-32.2.2-sources/.deps/obs-deps-2026-07-15-x64`.
The helper links `avformat`, `avcodec`, `avutil`, `swscale`, `swresample` and
static `jansson`. Only `Release/m4_ip_camera.exe` belongs in the Studio package;
`m4_ip_camera_fixture.exe` is an explicitly synthetic validation encoder.

Run the helper with exactly one argument: the pinned OBS runtime directory.
The parent must set its working directory and normalized `Path` to include that
runtime, because imported DLLs are loaded before `main`. Credentials never belong
in command arguments, environment variables, profile files or diagnostic logs.

Send one bounded UTF-8 JSON line through stdin:

```json
{
  "version": 1,
  "host": "192.168.1.20",
  "port": 554,
  "username": "camera-account",
  "password": "camera-password",
  "stream": "stream1",
  "rotation": 90
}
```

Keep stdin open during reception. Close it to cancel network I/O; the decoder's
interrupt callback imposes a four-second startup deadline and a three-second
read deadline, with a four-second socket timeout as a backup. An
incomplete startup line expires after four seconds. The parent remains responsible
for terminating an unresponsive process after its cleanup deadline and restarting
failed receivers with bounded backoff. Production callers validate private IPv4
addresses; the native helper additionally accepts loopback for synthetic tests.

Generic IP cameras use version 2 with `path` instead of `stream`, for example
`{"version":2,"host":"192.168.1.20","port":8554,"username":"","password":"","path":"/live?channel=2","rotation":0}`.
Empty credentials omit URL user information for anonymous access. Custom paths
start with `/`, contain at most 1024 UTF-16 units, and reject controls, whitespace,
fragments and backslashes. Credentials are bounded UTF-8, escaped only inside the
helper; custom paths and query strings remain private and are never logged or
returned in status snapshots. Legacy version 1 and saved Tapo sources still use
`stream1` or `stream2`. Both versions have exactly seven fields. Only `127.0.0.1`
is additionally accepted by the helper for the synthetic fixture; production
schemas reject loopback.

Saved Tapo sources (version 1) prefer UDP media, accepting packets only from the
negotiated source. TCP is retried when UDP setup is rejected or startup receives
no usable video. Both attempts share an eight-second startup budget. Generic
RTSP sources (version 2) retain TCP. Existing camera credentials and addresses
are unchanged; transport selection is private to the receiver.
Version 2 rejects credential user information longer than 127 encoded bytes,
including the separating colon, before starting network access. RFC3986
unreserved UTF-8 bytes count as one byte; every other byte counts as three
(`%HH`). This matches the pinned FFmpeg RTSP authentication buffer and avoids
silently truncated credentials. Legacy version 1 limits remain compatible.

Stdout consists of an ASCII four-byte tag, unsigned uint32 little-endian payload
length, then payload. Tags are `JPEG` (JPEG image), `PCMA` (mono 48 kHz signed
16-bit little-endian PCM), and `STAT` (JSON with an allowlisted `code`: `connecting`,
`streaming`, `auth_failed`, `unavailable`, `read_timeout`, `connection_closed`,
`decode_failed`, or `pipe_failed`). These are fixed categories; no library error
message, URL, path or credential is emitted. Audio is optional. Library logs are
fully disabled and stderr contains no camera diagnostic strings. Native status
alone does not establish that a frame appeared in the program: the parent and
renderer must also verify fresh advancing decoded/presented frames.

Video preserves the entire frame, rotates pixels by 0/90/180/270 degrees, scales
to at most 1280 pixels wide and 1920 high without changing its aspect ratio, and
emits at most 30 frames per second using stream timestamps and a scheduled cadence.
Rotation zero scales directly into the JPEG encoder's YUV format. A separate
writer paces camera video and audio from capture timestamps with a one-second
buffer, capped at 192 records and 64 MiB per camera. Clock discontinuities rebase
playback. Media over 200 ms late after consumer backpressure is discarded rather
than accumulating delay. Status and diagnostics bypass the buffer, and shutdown
discards pending media. External microphones are outside this camera delay.
Stdout backpressure cannot block
RTSP reads or session keepalives or grow a queue without bound. Renderer media
uses `object-fit: contain`.

The bounded `DIAG` record reports cumulative decoded frames/errors and the last
JPEG conversion time in milliseconds every two seconds. Studio additionally
measures received frame rate, inter-frame gaps and reconnects. These are frame
delivery diagnostics, not RTP packet-loss measurements.
Malformed audio packets flush only the audio decoder instead of restarting video.

Actual synthetic RTSP validation:

```powershell
node native/m4-ip-camera/validate.mjs <build>/Release/m4_ip_camera.exe <setup>/obs-m3-32.2.2/bin/64bit
```

The test generates moving H264 using the pinned encoder, serves RTSP/TCP and UDP with
PCMU audio, and verifies actual JPEG decoding, PCM resampling, all four rotated
dimensions, sanitized authentication failure and stdin-EOF cleanup. It requires
no physical camera and makes no external network requests.
It also checks version 2 custom paths and queries on a nondefault local port,
anonymous access, UTF-8/reserved-character Basic authentication and rejection of
oversized encoded credentials without diagnostics.
It additionally measures real 30fps capture, enforces a six-second RTSP session
timeout, verifies repeated keepalives while stdout is blocked, recovers a short
transport gap on the same helper, and proves a genuine stall exits within five
seconds with `read_timeout`. An optional final duration argument extends the
sustained run from the default 20000ms up to 600000ms, for example `180000`.
