# Private IP camera receiver

This Windows x64 helper uses the pinned OBS runtime's FFmpeg libraries to decode
an actual RTSP/TCP camera stream. It is separate from the composed program
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
interrupt callback also imposes a four-second connection/read deadline. An
incomplete startup line expires after four seconds. The parent remains responsible
for terminating an unresponsive process after its cleanup deadline and restarting
failed receivers with bounded backoff. Production callers validate private IPv4
addresses; the native helper additionally accepts loopback for synthetic tests.

Stdout consists of an ASCII four-byte tag, unsigned uint32 little-endian payload
length, then payload. Tags are `JPEG` (JPEG image), `PCMA` (mono 48 kHz signed
16-bit little-endian PCM), and `STAT` (JSON with an allowlisted `code`: `connecting`,
`streaming`, `auth_failed`, or `unavailable`). Audio is optional. Library logs are
fully disabled and stderr contains no camera diagnostic strings. Native status
alone does not establish that a frame appeared in the program: the parent and
renderer must also verify fresh advancing decoded/presented frames.

Video preserves the entire frame, rotates pixels by 0/90/180/270 degrees, scales
to at most 1280 pixels wide and 1920 high without changing its aspect ratio, and
emits at most 20 frames per second. Renderer media uses `object-fit: contain`.

Actual synthetic RTSP validation:

```powershell
node native/m4-ip-camera/validate.mjs <build>/Release/m4_ip_camera.exe <setup>/obs-m3-32.2.2/bin/64bit
```

The test generates moving H264 using the pinned encoder, serves RTSP/TCP with
PCMU audio, and verifies actual JPEG decoding, PCM resampling, all four rotated
dimensions, sanitized authentication failure and stdin-EOF cleanup. It requires
no physical camera and makes no external network requests.
