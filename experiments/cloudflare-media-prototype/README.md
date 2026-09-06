# Isolated camera cancellation and ownership work

This source-only experiment is not imported by the CurlStreamer application and
is not deployed. It was copied from the private Cloudflare camera scratch lab
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

Use Node's built-in test runner: `node --test test_camera_session.cjs test_client.cjs`.
With FastAPI, HTTPX and their dependencies available, run
`python -m unittest test_server test_ownership test_cloudflare_api test_processor`.
All provider calls in these tests are mocked. The processor deadline test uses
only a local temporary directory and timer. No GPU or network is required.

## Remaining gates

The processor is deliberately unchanged. Its external calls under the lifecycle
lock, partial-failure cleanup, and packet-based rather than decoded-picture
freshness remain follow-up work. Failed cleanup requests remain best effort;
server expiry is the final backstop, not proof of immediate provider teardown.
Claiming a camera position intentionally replaces its previous connection; a
production takeover policy and authenticated game boundaries are still needed.

One user-reported phone connection with a good picture is not two-phone,
teardown, Safari/rotation, adaptive-dimension, cellular, full-match, microphone,
YouTube, or multi-game capacity qualification. None is claimed here.
