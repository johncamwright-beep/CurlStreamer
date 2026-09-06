# Isolated camera processor prototype

This lab receives two camera tracks through the existing LiveKit transport and
composes a private HLS preview with FFmpeg/NVENC. It does not call managed LiveKit
Egress, write production game state, capture microphone audio, or publish to
YouTube. Test scores are disposable. Production streaming is unchanged.

The default is **720p60 at 6 Mbps**, following the product owner's preference for
smooth rock movement. **1080p30 at 8 Mbps** is available for comparison. Camera
capture requests 720×1280 portrait at the selected frame rate, capped at 4 Mbps.
The UI reports actual device capture settings and recently received frame rate.
A 60 fps output cannot add motion detail missing from a 30 fps camera.

## Architecture and measurement boundary

- The LiveKit Python SDK supplies decoded camera frames. Pillow rotates and contains
  each frame without cropping, using a bounded latest-frame slot per camera.
- FFmpeg uploads normalized frames, uses CUDA composition and NVENC H.264 encoding,
  and produces a short rolling HLS preview. Its AAC track is silence.
- A camera older than three seconds is replaced by a blank panel. A reconnect can
  replace its track without restarting the encoder.
- The processor stops after ten minutes or when temporary access expires. Stop
  disconnects the receiver and stops FFmpeg; camera pages observe status and stop
  their local tracks. This is **not** a server-side revocation of publisher tokens.
  An unresponsive publisher may remain connected until it disconnects. Production
  completion must retain its existing administrative room teardown.
- Active camera/control pages poll every three seconds. If all pages close, Modal
  can shut down the idle web container; this prototype is not a durable service.

The earlier sixteen-game file benchmark does not establish this receiver's
capacity. This path adds WebRTC, CPU decode/copies and, by default, 60 fps capture.
It needs a new density benchmark and a full-game soak. Real USB audio, YouTube
delivery, app-state authorization and durable start/stop remain integration work.

## Setup

Use Python 3.12 and the pinned `requirements.txt`, plus Modal 1.5.5. After installing
the repository's existing Node dependencies, run:

```sh
node tools/media-prototype/prepare-assets.mjs
```

This stages the installed LiveKit browser bundle and pinned HLS.js 1.7.2. Generated
third-party bundles are ignored by Git. Deploy only this folder to Modal. No
production app environment values are needed.

Create three temporary LiveKit tokens for **one separate test room**:

- `prototype-home`: publish only, no data publishing.
- `prototype-away`: publish only, no data publishing.
- `prototype-processor`: subscribe only, no publishing or data publishing.

Store a JSON object in the `PROTOTYPE_CONFIG` field of the Modal secret named
`curlstreamer-camera-prototype`. It contains `url`, `home`, `away`, `subscriber`,
`expires` (Unix seconds no later than the earliest token expiry), and `code` (a
cryptographically random private access code, at least 32 characters). Keep the
source file outside the repository. Never use project admin keys here, print
tokens, or include secret files in an evidence archive.

```sh
modal deploy tools/media-prototype/modal_app.py
```

One L4, four physical cores, 16 GiB RAM, zero minimum containers and a thirty-second
idle scale-down are configured. Loading the lab can start the GPU container even
before the encoder is started. Close the pages when finished. Keep account usage
and out-of-pocket spend caps enabled; do not upgrade plans as part of this test.

The private access code is exchanged for a Secure, HttpOnly, same-site cookie.
Media and APIs require it. Writes require the page's own origin. Temporary access
expiry is enforced server-side. The frontend never receives the subscriber token.
The lab is for trusted testers sharing one room; it is not multi-tenant production
authentication. Reloaded pages may require the private code again.

## Verification

```sh
python -m unittest discover -s tools/media-prototype -p test_prototype.py
modal run tools/media-prototype/modal_app.py --output /private/work/smoke.zip
python tools/media-prototype/test_transport.py --config /private/work/config.json --url https://YOUR-LAB.modal.run --output /private/work/evidence
```

The last command explicitly publishes **synthetic** cameras into the separate
room, checks both feeds, disconnects/reconnects one, updates the score, downloads
the encoded preview and confirms Stop. It does not open physical cameras. Close
any phone publishers before running it because test identities are shared.

For the phone test: start a test on the control page, open the private link on two
phones, connect Camera 1 and Camera 2, and load the processed preview. Move an
object, check actual frame rates, turn one camera off/on, update the test score,
and stop. Confirm camera indicators turn off. There is no YouTube broadcast yet.

Before production use, add durable session ownership and cancellation, per-camera
authorization and token revocation, worker lifecycle independent of preview HTTP,
safe real audio, authenticated game-state updates, RTMPS/YouTube lifecycle and
cleanup, operational telemetry, and representative long-running load tests.

## Recorded diagnostics and unattended endurance

Every ten seconds the processor writes an allowlisted metric to `samples.jsonl`
and the Modal function log: received camera rates, encoded rate, FFmpeg drop/dup
counters, elapsed time, and combined processor/encoder memory. `result.json`
contains the final summary and samples. No tokens, destination keys, or raw
provider errors enter these reports. Encoded output rate is not unique camera
motion rate: the latest-frame feeder can repeat input images without incrementing
FFmpeg's duplicate counter. Compare input and output rates separately.

The phone lab offers a report download for its current session; download it before
the container scales down. Its files remain ephemeral. Structured Modal logs
outlive the container subject to the workspace's log retention, and the CLI runner
saves its final allowlisted ZIP locally. This is not permanent product analytics.

For the separate CLI-only test, create a fresh room and the same three narrowly
scoped tokens, with enough lifetime for the run plus three minutes. Save them as
`PROTOTYPE_CONFIG` in a separate Modal secret, `curlstreamer-endurance`. This app
has no browser endpoint, no production credentials and no microphone or YouTube
output. First run a 90-second preflight, then explicitly request 9,000 seconds:

```sh
modal run tools/media-prototype/modal_endurance.py --seconds 90 --output /private/work/preflight.zip
modal run --detach tools/media-prototype/modal_endurance.py --seconds 9000 --output /private/work/endurance.zip
```

The synthetic camera publisher uses its own four-core CPU container; its cost is
test-generation overhead, not the per-game processor cost. The receiver uses one
L4, four cores and 16 GiB. Both have hard deadlines and no retries. Camera 1
disconnects for 15 seconds early in the test and about every 15 minutes thereafter;
scores change throughout. The report checks elapsed duration, shutdown, both
feeds, observed recovery, score changes and sampled output pacing (54 fps minimum,
90% of target, after startup). A pass is not a zero-frame-loss claim, proof of
phone endurance, real-audio validation, YouTube delivery or multi-game capacity.

## Output adapter preparation

`youtube_output.py` is a server-only, currently unwired packet-copy relay. It takes
the already encoded HLS program and sends H264/AAC in FLV without a second encode.
Only validated YouTube RTMPS destinations are accepted by its public class. Obtain
the URL from YouTube's `rtmpsIngestionAddress` API field; do not rewrite an RTMP
hostname by guesswork. Raw FFmpeg errors and command lines must never be logged.
The caller must poll status, stop failed/stalled relays, and coordinate processor
and broadcast shutdown. `sending` does not mean YouTube has confirmed `live`.

The isolated loopback smoke test exercises packet copy and decoding without
creating a broadcast, using credentials, or contacting YouTube:

```sh
modal run tools/media-prototype/modal_output_smoke.py --output /private/work/output-smoke.json
```

The relay adds the rolling HLS delay. Native direct muxing may be preferable once
the pipeline is integrated. Real RTMPS/TLS delivery, authenticated app controls,
YouTube lifecycle reconciliation and real audio remain required before release.
