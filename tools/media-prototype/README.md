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

- The LiveKit Python SDK decodes camera frames on CPU. Pillow rotates and contains
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
