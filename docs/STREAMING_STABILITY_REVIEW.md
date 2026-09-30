# Streaming stability review — September 30, 2026

## September 30 recovery

The September 29 release did not pass John's physical camera test. Cameras
dropped even with YouTube off. In one earlier failure the local controller
stopped; its original exit cause was not captured. Later camera failures happened
while the controller and native renderer were still running.

- Camera path inspections now run independently of cloud event polling. A
  stalled event read cannot starve the local ten-second verification watchdog.
- Sending receiver path confirmation no longer blocks local statistics or
  presenting verified video/audio. Only one confirmation can be outstanding.
  Temporary transport failures are distinguished from rejected authority.
  Camera-side proof freshness, ticket expiry and direct-path checks remain.
- Studio keeps reading local status during YouTube preparation, publishes the
  final pending/live state, and clears stale preview/audio/YouTube status if its
  controller exits. Process callbacks cannot settle a replacement controller.
- A bounded local lifecycle journal records startup, shutdown, native exits and
  whitelisted failure codes. It excludes credentials, URLs and raw errors.
- The production scheduled-broadcast adoption function no longer treats a
  pending or failed reservation as an uncertain YouTube creation. Actual intents
  remain quarantined and recently started reservations remain fenced. Database
  fixtures validated none, pending, failed, stale intent, ready and recent intent
  cases in a transaction; fixture rows were rolled back. The function change is
  recorded in migration `0065_pending_youtube_adoption.sql`.

The update is installed locally as `0.4.0-pilot.3`; all 2,247 installed component
hashes and the offline startup/shutdown check passed. This is a local patch, not
a published installer. The native WebView2 fixture also passed pending/live and
unexpected-controller-exit checks. The final unit suite passed 1,643 tests with
93 skips; formatting, typechecking and the production build passed. Browser
regression checks passed 246 tests with 92 skips. John reports both cameras stable
for over two minutes after the renderer update, with YouTube and USB audio off.
A local read confirms both cameras receiving and the controller/native renderer
still running, with no new exit in the lifecycle journal. This passes the initial
camera-only check. John also reports the subsequent two-minute camera/USB-audio
check stable. A local read confirms both cameras receiving, USB samples delivered
and drained, microphone levels present and the audio renderer running. The live
YouTube test subsequently failed at approximately 11:12:53 AM EDT: cameras cycled
through reconnects and the local output failed. The controller, native renderer
and USB sample delivery stayed running. The server desktop Stop was recorded
about 20 seconds before its lease deadline, so expiry alone does not explain
this failure. The prior two-minute checks are not evidence of live endurance.

### Follow-up to the failed live test

- Separate and coalesce read-only YouTube observations so a slow Google/server
  response cannot hold the desktop heartbeat or Stop queue. Successful late
  observations remain fenced by session, intent, expiry and cancellation.
- Migration `0066_camera_authority_shared_locks.sql` is applied to production.
  Camera actions take shared locks on game/assignment authority and still take
  an exclusive lock on their own session row. Independent camera roles no longer
  serialize every check on a whole-game exclusive lock. Release, completion and
  deletion continue to conflict with the shared authority locks. Transactional
  fixtures passed both roles, organization, assignment, negotiation, expiry,
  completion and RPC permission checks; all fixture changes were rolled back.
  The added multi-session concurrency test requires a disposable local database
  and is skipped in this environment; it has not been presented as executed.
- Add nonce-bound path confirmations over the existing peer's encrypted DTLS
  data channel. This removes routine internet confirmation round trips from
  redacted phone path statistics. Only independently verified receivers answer;
  nonce/proof freshness stays five seconds and consumed proof replay is rejected.
  Authorization tickets, role release and negotiation teardown remain separate.
  Older peers retain cloud confirmation, and stale local proof restores fallback.
- Record fixed stream failure reasons before cleanup can erase native output
  evidence. An observed output failure remains failed rather than becoming an
  ordinary stopped stream after cleanup. No raw errors, tokens or target values
  are logged.

Production logs include `peer_stale`, game-state conflicts and statement
timeouts around the drop. A later snapshot showed valid assignments, fresh
heartbeats and no blocked requests. Supabase also reports an ongoing Eastern US
latency incident affecting clients/serverless functions regardless of project
region: <https://status.supabase.com/>. These are potential contributors, not a
confirmed explanation of every disconnect. Do not clear or replay the delivered
output intent's quarantine to restart this failed broadcast.

The follow-up desktop package is prepared as `0.4.0-pilot.4` and is not installed
yet. Formatting, typechecking, production build, 1,649 unit tests and 246 browser
tests passed (94 unit and 92 browser tests skipped for unavailable fixtures).
Real synthetic portrait WebRTC also confirmed local path proofs, audio delivery,
bounded mute settling and relay rejection. The packaged renderer check and
offline startup/shutdown smoke passed. The renderer check previously waited for
an internal camera status phrase that was not rendered; it now checks actual
retry requests and both video elements. Physical live endurance remains
unverified. Reconnect once after the coordinated update, then test the actual
YouTube picture and sound for 5–10 minutes before a longer 45–60 minute run.

## September 29 baseline

The review found software failure paths that can explain abrupt disconnections
and misleading status changes. They are reproducible code defects; they do not
prove which one caused every interruption in the earlier physical rehearsal.
Review and implementation use the current `codex/internal-network-pilot` worktree.
The older `main` checkout is not the current Studio product.

## Fixes

| Finding                                                                                    | Change                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One failed desktop heartbeat permanently failed the session and stopped OBS.               | Temporary transport failures retain only the previously acknowledged lease. A later successful heartbeat can recover. Failed requests never renew native authority. Revocation, expiry, changed identity, and malformed replies still stop output. Target delivery remains once only. |
| One failed camera ticket renewal tore down working capture and private signaling.          | Phone and native receiver distinguish temporary transport errors from authority rejection. They keep the existing connection only until its original ticket expires. An incoming message whose authority check fails is dropped, never forwarded unchecked.                           |
| Camera event drains issued frequent database checks that lock game/session rows.           | Local drain polling falls from four times per second to once. Empty drains reuse the last verified authority for at most five seconds; ticket renewal validates it independently. Queued signals still get a fresh check immediately before release.                                  |
| Native scoreboard polled twice a second throughout the game.                               | Poll once a second, cutting that polling rate in half.                                                                                                                                                                                                                                |
| Any scoring read error replaced the whole page, unmounting the preview and controls.       | Brief server failures keep the last loaded score with a connection warning. Access denial or terminal game state still clears the active controls. Recovery immediately restores the normal polling interval.                                                                         |
| A failed preview image request hid the previous successful picture.                        | Double-buffer local preview frames and keep the last successful picture while reconnecting. Waiting instructions now refer to connecting the game, since a preview does not require recording.                                                                                        |
| A normal heartbeat renewal during a YouTube status check was treated as a changed session. | Accept an extended lease on the same independently authorized session. Reject shortened/expired authority, revocation, and changed account/resource bindings.                                                                                                                         |
| Previously prepared watch-page recovery work was still local.                              | Include the bounded stale-reservation recovery and lifecycle checks with this release; do not create another broadcast after an uncertain provider insert.                                                                                                                            |

No database migration, live payment activation, or real broadcast is required by
these code changes. Camera and sponsor media retain `object-fit: contain`.

## Validation

- Formatting and TypeScript checks passed.
- Unit suite: 1,636 passed; 93 database/environment-dependent tests skipped.
- Production build passed. Browser suites: 246 passed, 92 skipped, including
  desktop/mobile scoring recovery, access revocation, and preview recovery.
- Packaged Studio check passed: relocated bundle, empty profile, unarmed native
  readiness, and graceful controller exit. Redistribution notices and component
  hashes were prepared; installer `0.4.0-pilot.2` compiled successfully.
- An earlier browser run was invalidated by a concurrent unit test starting
  Next.js development mode in the same build directory. The clean rerun runs
  those checks sequentially; its results supersede that run.

## Release status

The fixes are committed in `1ec14e9` and deployed to `curlstreamer.app`; the live
site's scoring and preview assets were checked for the new recovery behavior.
Studio `0.4.0-pilot.2` is published on GitHub with matching source and notices.
An anonymous full installer download matched its published size and SHA-256.
The September 29 installation was `0.4.0-pilot.2`; its component hashes and
offline startup check passed. The website download descriptor points to
that same release. Physical camera/broadcast endurance is still unverified.

## Remaining work

- Run a 45–60 minute unlisted broadcast using two physical phones and this exact
  installer. Watch the actual YouTube picture, switch scoring/settings pages,
  check audio, stop normally, and verify the recording and replay link.
- Test install/update on another Windows PC. Offline startup is not a camera or
  network endurance test.
- Restarting a consumed/stopped broadcast currently rebuilds the Studio program
  because output grants and native sinks are single use. Keeping cameras alive
  across a replacement output session needs a separate lifecycle change.
- Provider observations still refresh Google access tokens frequently. A bounded,
  server-only token cache with connection-version invalidation could reduce
  provider traffic, but is outside this stability patch.
- Private signaling websocket loss and a direct WebRTC transport that fails to
  recover still require reconnecting. The patch does not remove direct-path
  checks or permit cameras to outlive revoked access.
