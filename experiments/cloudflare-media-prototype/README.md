# Isolated camera ownership, control recovery and evidence

This source-only experiment is not imported by the CurlStreamer application and
is not itself a deployment package. It was copied from the private Cloudflare camera scratch lab
using an individually reviewed allowlist: `client.js`, `server.py`,
`processor.py`, `cloudflare_api.py`, `index.html`, `style.css`,
`test_server.py`, `test_processor.py`, and `test_cloudflare_api.py`.

No private access files, credentials, deployment configuration, evidence,
generated binaries, or third-party browser bundles were imported. In particular,
the HLS.js asset and native receiver executable referenced by the inherited lab
are not bundled. This directory is for local review and tests; it is not a
standalone deployable camera service.

## Changes

- Each camera attempt owns its media tracks, peer, wake lock, and server lease.
  Disconnect invalidates the attempt immediately, aborts pending requests,
  cancels retries, and disposes of resources returned after cancellation.
- Each authenticated page receives a random identity bound to its role. API
  calls explicitly present that identity; another tab's authentication cannot
  silently switch this page's camera slot. Identities and the next attempt
  sequence are stored in tab-scoped session storage for reloads.
- A camera claim returns a random connection ID. Start, attach, receive, and
  disconnect require both the page identity and current connection ID. A newer
  claim supersedes the previous owner; delayed cleanup cannot detach it.
  Monotonically increasing per-page claim sequences reject reordered requests.
- Native HLS playback retains a separate control-preview cookie scoped to `/hls`.
  That cookie cannot authorize any API operation. API page identities are capped
  at 64 per expiring lab instance.

## Offline checks

From this directory, use Node's built-in test runner:
`node --test test_camera_session.mjs test_client.mjs`.
With FastAPI, HTTPX and their dependencies available, run
`python -m unittest discover -p "test_*.py"`.
All provider calls in these tests are mocked. The processor deadline test uses
only a local temporary directory and timer. No GPU or network is required.

## Remaining gates

External calls under the processor lifecycle lock, partial-negotiation cleanup, and
packet-based rather than decoded-picture freshness remain follow-up work. Failed cleanup requests remain best effort;
server expiry is the final backstop, not proof of immediate provider teardown.
Claiming a camera position intentionally replaces its previous connection; a
production takeover policy and authenticated game boundaries are still needed.

One user-reported phone connection with a good picture is not two-phone,
teardown, Safari/rotation, adaptive-dimension, cellular, full-match, microphone,
YouTube, or multi-game capacity qualification. None is claimed here.

## Explicit control recovery

Control authentication issues a signed control-only recovery ticket stored in the
same tab's sessionStorage. Its absolute expiry matches the private link and its
signature is tied to the deployment key/expiry. It never grants camera identity
or a connection lease. Hidden, unstarted-idle (60 seconds), failed and expired
control pages stop polling and disable actions. Resume is an explicit bounded
reauthentication/read sequence; it never repeats Start, Stop, score or camera
writes. Pausing aborts and generation-fences pending reads. HTTP 410 is terminal
expiry regardless of browser clock.

Recovered control can read the current instance/preview and explicitly Stop or
score an existing run, including a replacement instance already started by phones.
It cannot Start or retrieve original camera links: both are server restrictions.
The preview cookie has a distinct HMAC purpose and cannot authenticate an original
control page. Changed-instance UI does not claim the earlier run was restored.
A fresh original private link is required to regain Start authority.

Run state remains process-local. A fresh original camera/control link can start a
different instance after process death; there is no durable global one-run ledger.
Each instance retains its 600-second cap, shortened by absolute link expiry.
Recovery cannot extend it. Automatic monitoring is bounded by the observed run
and absolute deadlines. A user explicitly resuming a paused control can cold-start
the existing deployment; there is no automatic recovery or GPU wakeup loop.

## Retained minimal evidence

`evidence.py` emits flushed `PRIVATE_LAB_EVIDENCE` JSON lines to existing Modal
stdout logs, retained after container exit without a new store/service. A random,
non-authorizing instance ID plus wall/monotonic timestamps correlates events.
An allowlist accepts only known events, numeric/boolean fields and enumerated
reasons. No video/audio, SDP, capabilities, page IDs, leases, provider session IDs,
private links or raw exception messages are included. Limit: 512 ordinary events
plus one final end event; periodic samples every 10 seconds, plus cleanup samples.

Events cover publish/reconnect attempts, receiver negotiation, packet-freshness
transitions/counters/age, encoder generation/output frame count/average fps,
playlist freshness, start/end reason and cleanup. A waited local process exit is
confirmed. Provider API acknowledgement still leaves durable cleanup unknown.
An abrupt kill may omit the final event: absence is unknown, never success.

RTP packets/markers are not decoded frames or visually verified motion. Dimensions
and target fps are explicitly configured values, not measured input/output
qualification. No decoded-frame detector was added. Shared provider-lock waits can
delay telemetry and short packet gaps can be missed. Partial-failure cleanup and
freshness remain separate gates.

## Teardown fault isolation

Retained measurements from the latest private run identified two unacknowledged
subscriber-track closes after acknowledged publisher-track closes. The previous
logs did not retain their error categories; the root cause remains unknown.
Cloudflare documents track closure as a per-session operation in its
[Connection API](https://developers.cloudflare.com/realtime/sfu/https-api/).
The forced-close payload and local-first cleanup order are unchanged here.

Cleanup requests alone use a five-second socket timeout; negotiation requests
retain fifteen seconds. There are no automatic retries. This is not a hard
wall-clock deadline: DNS and response reads can exceed a socket timeout.
Each provider outcome includes a fixed publisher/subscriber label, duration and
allowlisted failure category. Arbitrary provider error codes and raw exceptions
are never logged. An acknowledged close still has durable outcome unknown.

Local processes get their existing terminate grace (receiver three seconds,
encoder four), then a kill wait capped at three seconds. Expected process errors
or kill timeouts record unknown, allow remaining teardown to proceed, and never
emit a successful encoder-stop event. If encoder or receiver termination is
uncertain during an ordinary disconnect, the test ends instead of starting a
replacement process that could conflict with the old one.
An encoder log close I/O error is recorded separately and cannot skip resource cleanup.
Repeated stop/disconnect does not replay completed cleanup. Individual provider
failures remain isolated so the other tracks and final end event are attempted.
Partial setup/negotiation cleanup and a strict overall teardown deadline remain
separate follow-ups; this does not prove provider resource deletion.

`test_cleanup.py` exercises process timeouts, partial provider failures, repeated
teardown, failure redaction and cleanup-only timeout selection without networking
or subprocess creation. This cleanup revision has not been deployed or live-tested.

Future packaging must include `evidence.py` alongside existing reviewed files,
including `camera-session.js`. Preserve key/expiry for recovery in the same private
window; rotating either revokes old tickets. Native receiver, HLS bundle, private
access and Modal configuration stay outside Git. Do not deploy tests or the fake
browser server. This new revision has not been deployed or run on GPUs/phones.

## Preview playback status and bounded retry

The supervised cloud run delivered authenticated playlist/segment HTTP 206
responses but showed a black desktop player. Its cause remains unknown. The same
native-first player and authenticated route played a local CPU-generated HLS
pattern in installed Edge and the desktop browser. HTTP 206 alone is expected
for accepted Range requests and does not demonstrate a defect.

Preview status now separately reports loading, playing, paused, ended and failure.
A continuous loading/buffering episode gets one 15-second deadline; repeated
waiting events cannot extend it. Failure disposes of media and latches the
generation so ordinary status polling cannot restart it. Retry preview reloads
only media and requires an active, visible, unexpired control page. It never
reauthenticates or repeats Start, score or Stop. Hide/pagehide, pause of control,
Stop and retry invalidate old media callbacks and pending play rejections.
Native pause stays paused until the user presses Play.

Up to 24 `PRIVATE_LAB_PREVIEW` console records expose only fixed state, selected
native/MSE mode and failure category. No URL, raw media/Hls error, token or video
is recorded. These are browser-local diagnostics, not retained server telemetry.
Playing is browser playback state, not proof that either camera image is fresh.
No player-selection or codec change is claimed to fix the cloud black picture.

`test_preview_http.py` checks the actual authenticated HLS route's MIME, byte
ranges, invalid ranges and camera/page-only access rejection using synthetic
bytes. It does not decode video. The existing JavaScript tests exercise actual
client timeout, explicit retry, pause/pagehide and stale callback behavior.

## Local control fixture

Run `node browser-fixture.mjs` from this directory; open
`http://127.0.0.1:3310/#offline-control`. An optional numeric argument changes the
port. Click Replace server (running), wait for disconnection, then Resume: Start
stays disabled; Stop/score are available for the fake current run. Replace server
(idle) then Resume keeps all mutation controls disabled. Expire link removes Resume
and shows fresh-link guidance. All API replies are fake; media and writes are
disabled. Only loopback is bound, with no Modal/provider/outbound calls. Ctrl+C
stops the fixture.
