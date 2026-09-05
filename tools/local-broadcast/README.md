# Local broadcast lab

An isolated proof of the scoring-computer route. No production routes, game
records, LiveKit room, cloud GPU or app credentials are used.

Two camera browsers connect to the host browser using direct WebRTC. A small
loopback Node helper exchanges signaling messages. The host canvas contains each
portrait feed without cropping and adds editable team names/scores at 1280×720.
MediaRecorder sends a bounded stream of WebM chunks to FFmpeg on the same computer;
FFmpeg encodes H.264 and AAC into a local MP4. The target is 60 fps; measure the
file and received-frame stats rather than assuming the target was reached.

This is a browser-assisted helper prototype, not an installed/packaged app.
MediaRecorder currently introduces an intermediate VP8 encode/decode. Hardware
encoding is selected explicitly, never assumed available. The host browser must
remain active; production packaging must handle sleep, background throttling and
device loss. A headless operator is available for a bounded remote phone test.

## Running

Requires Node 22+, Chrome/Edge and an FFmpeg binary. The test scripts also use the
repository's installed Playwright dependency. No additional npm dependencies.

Set `FFMPEG_PATH` to the installed binary and `LOCAL_LAB_OUTPUT` to a **private
directory outside the repository**. Optionally set `LOCAL_LAB_ENCODER` to
`h264_nvenc` (Nvidia), `h264_qsv` (Intel) or `h264_videotoolbox` (Mac). Default is
`libx264`. Encoder support must be tested on the host; only Nvidia/Windows has
been exercised in this lab so far.

Run `node tools/local-broadcast/server.mjs`. Open the private `open-host.url`
file on that computer. `access.private.json` contains separate host and camera
capabilities, valid for two hours; never commit or share the host key. Server binds
only to loopback. Camera pages need HTTPS when reached from a phone.

`node tools/local-broadcast/smoke.mjs` starts its own helper and three isolated
browser contexts. It checks access boundaries, two direct synthetic cameras,
reconnect, score updates, silent recording and fake computer microphone capture.
Outputs and private access files go to `LOCAL_LAB_OUTPUT`.

For a remote phone test, install the official Cloudflare `cloudflared` executable
outside the repository, verify its release checksum, and set `CLOUDFLARED_PATH`.
Run `node tools/local-broadcast/phone-session.mjs`. It creates an ephemeral HTTPS
tunnel for **pages/signaling only**, tests remote host-control rejection, and saves
two private phone links. A headless host on the scoring computer automatically
records locally once a camera connects. No physical microphone is requested. The
recording stops after ten minutes and the session closes after at most 45 minutes.
Keep phone pages open. Do not open a second host page during this operator test.

## Boundaries and remaining work

- No TURN relay is configured yet. Same-LAN/direct connections can work; restrictive
  Wi-Fi/mobile networks may fail. A real separate-network test and authenticated
  TURN fallback are needed before claiming connectivity or per-account costs.
- Connection diagnostics classify the **selected** ICE candidates, not location or
  IP guesses. Current tests are on one machine, not proof of club/mobile routing.
- Phone capture is video-only. The host can explicitly select a computer microphone;
  default output contains silence. Fake audio tests do not prove USB-device routing,
  acoustic quality, sync over a full game or phone audio privacy under all failures.
- Host output APIs require the host capability, a loopback request, the local Host
  header and no proxy headers. Cameras can signal only their own peer. Requests,
  message queues, upload buffering and recording duration are bounded. Output
  stops on missing chunks; camera pages stop if the host heartbeat disappears.
- A private `LOCAL_LAB_YOUTUBE_URL` environment variable can enable the separate
  test-output button. Only YouTube RTMPS hosts are accepted; keys are not returned
  to browsers or written to logs. **Do not configure it for routine tests.** Actual
  YouTube delivery/lifecycle is unverified; “sending” does not mean “live”.
- Account pairing, authorization, sponsor assets, completion cleanup, installer
  signing, auto-updates, reliable audio, TURN and real YouTube lifecycle remain
  integration work. Production streaming is unchanged.

Sources: [Canvas capture](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream),
[MediaRecorder capability detection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static),
[Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
