# Streaming stability review — October 1, 2026

## Camera reconnection follow-up

John reported an access-denied QR after restart, then camera recovery loops after
releasing and reclaiming both roles. Confirmed defects and implemented fixes:

- A fresh participant claim could leave the preferred participant-storage key
  pointing at an older assignment. Every successful claim now replaces that key
  while retaining organizer access separately.
- Reconnect QR previously contained only a page address. The new operator-only
  route and migration `0068` prepare a ten-minute invitation bound to the existing
  device and assignment generation. Existing claim exchange permits the original
  browser to renew its six-hour participant session without releasing the camera.
  Wrong-device, expired, released, completed and publicly callable cases remain
  rejected. No camera session or game state changes during renewal.
- Phone automatic recovery omitted several actual transport failure messages,
  including the 45-second direct-path timeout. Those now retry with bounded
  backoff; duplicate timers are cleared and late failures from replaced requests
  cannot clear the successor's capture consent. Reconnect status includes the last
  failure reason. Missing/expired local access is detected before capture.
- Camera controls move into the scoring column above expanded USB audio, avoiding
  the gap caused by the height of the program-preview column. Fresh native video
  evidence remains visible when cloud device-status polling fails; its existing
  six-second expiry is unchanged.

Read-only live checks found the controller running and receiver sessions fresh,
with both assignments current but phone heartbeats stale. This does not establish
the physical transport failure's root cause. Supabase's October 1 status page
reports unresolved Eastern US API latency since September 29; it is a possible
contributor, not a confirmed explanation for this game's interruptions.

Migration `0068` is installed and verified in the live database. A corrected
rollback-only fixture passed the existing-device, response-loss retry, wrong-device,
expired, released, completed-game and private-RPC checks. Its fixture rows were
rolled back; no live camera was released or reset. The corrected editor submission
ran without the earlier warning, so the additional confirmation request was
withdrawn. Code commit `3807cba` is deployed and verified on `www.curlstreamer.app`.
Vercel deployment `489BbaxPEciAXVHQyWGuYW9PMTBY` is Ready with the custom domain
assigned. Anonymous score/camera asset checks confirmed the new renewal endpoint,
access-expiry message and replaced-request guard in that deployment. Remote web
CI was still running at verification; Windows launcher CI passed.

Validation: formatting, TypeScript, production build and 1,671 unit tests passed
with 95 environment-dependent skips. The full main browser run passed 169 checks;
its one layout failure was corrected and all 42 affected desktop/mobile checks
passed on the final code. All 78 account/YouTube checks passed (248 unique browser
checks in total, 92 skips). No native installer change is required. A physical
camera/YouTube endurance test after refreshing the phone pages remains necessary;
these automated checks do not establish that every live interruption is fixed.

## October 1 close and restart recovery

- Closing an active game in Windows Studio asks whether to end the game.
  **Yes** opens the existing final-score review and confirmation. Studio closes
  only after the game is saved as completed and the local controller stops.
  **No** stops the local sender without completing the game or YouTube broadcast,
  remembers the game, and returns to its scoring page on reopening. **Cancel**
  keeps Studio open; cancelling the web review cancels the pending close.
- Studio's menu includes **Reload scoring screen** (`Ctrl+R`), which leaves
  healthy camera and output processes running.
- A full restart obtains fresh, one-use output authority for the same saved
  broadcast/stream IDs. Migration `0067` waits until the old sender's enforced
  lease expires, plus three seconds, before allowing another pairing. Stop alone
  is insufficient. Old credentials remain spent; channel, membership, game,
  generation and entitlement checks are preserved. Native preparation retries
  the temporary expiry wait for up to 35 seconds. A completed YouTube broadcast
  remains terminal; this flow does not create a replacement watch page.
- An already-exited controller no longer traps the user in a cleanup dialog.
  Unconfirmed cleanup is retained as a recording warning, and the Saved videos
  menu flags that the previous recording should be checked.

Validation: formatting, TypeScript, production builds and the full unit suite
passed (1,662 passed; 95 environment-dependent skips). Browser suites passed
248 checks with 92 skips. The real WebView2 fixture verified scoped review/cancel,
remembered-game origin validation, and dead-controller recovery with retained
cleanup evidence. Rollback-only PostgreSQL fixtures verified same provider IDs,
unexpired-sender rejection, fresh one-use delivery, replay rejection, revoked
owner rejection and terminal-game rejection before migration `0067` was applied.
Fixture teams and users were rolled back; no real provider was invoked.

Studio `0.4.0-pilot.6` was installed locally after confirming Studio was closed:
2,247 component hashes verified, four files replaced with a rollback backup.
The staged and installed packages passed offline native startup/shutdown checks.
Matching source is commit `c82b60e`; third-party notices are included. The public
installer remains `0.4.0-pilot.2`. These checks do not prove physical endurance:
the remaining test is closing with **No**, reopening, and reconnecting the same
watch link with both phones and USB audio.

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

The follow-up desktop package is installed locally as `0.4.0-pilot.4`. All 2,247
installed component hashes and the relocated-bundle, empty-profile, unarmed
native readiness and graceful-controller-exit smoke checks passed. Commit
`8e93e0f` is pushed, and the matching website deployment is verified: the live
`m4-program-renderer.js` SHA-256 matches the tested asset
`8ea3728fcc7dfc7d4b42d8fbf08c57eb6118c0afe4504234e523ad94ce84c4d1`.
The updated installer has not been publicly released. Formatting, typechecking,
production build, 1,649 unit tests and 246 browser
tests passed (94 unit and 92 browser tests skipped for unavailable fixtures).
Real synthetic portrait WebRTC also confirmed local path proofs, audio delivery,
bounded mute settling and relay rejection. The packaged renderer check and
offline startup/shutdown smoke passed. The renderer check previously waited for
an internal camera status phrase that was not rendered; it now checks actual
retry requests and both video elements. Physical live endurance remains
unverified. Reconnect once after the coordinated update, then test the actual
YouTube picture and sound for 5–10 minutes before a longer 45–60 minute run.

### Follow-up to cycling YouTube status

John's five-minute camera/USB check passed with `0.4.0-pilot.4`. During the
subsequent live run, the status badge and watch link cycled, with one brief
camera flicker reported. John confirms that the actual YouTube picture and
sound subsequently stay continuous. This does not establish long-run camera
endurance or explain all earlier failures.

A public, read-only local operator sample reproduced live/unknown confirmation
while output stayed active and byte counts increased. A later 90-second sample
recorded 45 active-output checks, 44 live confirmations and one unknown
confirmation, with no unavailable reads or camera drops. The lifecycle journal
contains a stream start at 12:29:41 PM EDT and no subsequent stream failure or
controller/native exit in that sample.

The status path checks the owned Google channel, stream and broadcast
sequentially within a five-second desktop request deadline, in addition to OAuth
and database calls. A failed poll clears confirmation immediately even when
local output keeps working. Cloud latency is a potential contributor; these
samples alone do not identify which individual external call was slow.

- Keep the owned-channel check first, then read stream and broadcast concurrently.
  All ownership, channel, resource-binding and desktop authority checks remain.
- Keep the verified watch destination available during the same armed output
  session. Do not discard it on each provider confirmation fluctuation. Clear it
  on stopped/failed output, game changes or loss of fresh Studio status.
- Show `Checking status…` for an armed output with missing provider confirmation,
  and `Status unavailable` when Studio updates stop. Neither claims that an
  unconfirmed stream is live or that a lost status read stopped video.
- Once native/provider evidence confirms live, do not request another automatic
  go-live transition because a later status sample loses confirmation. A new
  output session resets that guard; initial go-live retries remain bounded.
- Allow the compact tile heading to wrap its status label without squeezing out
  the title or making the action tile unnecessarily tall.

Formatting, final typechecking, production builds and 1,651 unit tests passed
(94 skipped). The initial full main browser run passed 165 checks and failed
three: the longer unavailable label expanded a compact tile, and the old desktop
and mobile link assertions expected it to disappear during missing confirmation.
The heading layout and assertions were corrected; all 24 scoring/YouTube checks
passed on rerun. All 78 account/provider browser checks also passed. In total,
246 distinct browser checks are covered, with 92 environment-specific skips.
An intermediate typecheck overlapped Next.js regenerating its types; the final
check after the build completed passed. This follow-up is a website/provider
change and does not replace the running Studio binaries.

Commit `3e51747` is pushed and the website deployment is verified anonymously:
the live scoring bundle contains both new status labels, and its stylesheet
contains the compact heading wrap. The deployed scoring bundle SHA-256 is
`4c1e29b15fcfc8e7b823b9db45632c0edf2ecec89a849697f61f1286e8245c93`.
The running installation remains `0.4.0-pilot.4`; no new installer is required
for this website follow-up. Refresh the scoring page after finishing the current
live test to load the new display.

## Same-link recovery and phone wake follow-up

- The camera page owns its screen wake lock independently of its connection.
  Disconnect and automatic retries leave it held; closing the page releases it.
  Returning to a visible page reacquires it. Browser denial and repeated system
  release remain bounded and show an unlocked-phone instruction. A browser cannot
  override manual locking, background suspension or operating-system power policy.
- Camera recovery retries continue with a capped delay while the prior capture
  consent and assignment remain valid. Scoring has a role-scoped **Reconnect
  camera** request, consumed once by an already connected, unlocked phone. New
  invitations, explicit phone Disconnect and rejected access require fresh consent.
- Studio's **Disconnect** pauses only the already bound native stream. **Reconnect**
  resumes that output and its existing watch page without another target handoff,
  provider creation or camera-program restart. Independent authority renewals
  continue while paused; Stop, lease expiry, output failure and End Game stay
  terminal. Older launchers do not advertise recovery, so the website disables
  Disconnect rather than accidentally completing their broadcasts.
- A failed UI command no longer changes actual native/provider output evidence.
  Active local output with unavailable Google confirmation says it is sending video
  and checking YouTube. The verified watch destination survives status loss and is
  displayed as a compact label. Sponsor placement controls divide the tile evenly.
- Preparation no longer automatically retires quarantined output or replaces an
  already completed watch page. Completed YouTube broadcasts cannot reopen.
  Recovery after loss of native authority is still blocked; this patch implements
  pause/resume of valid authority, not replay of a consumed grant.

Validation: the full unit suite passed 1,659 tests with 94 environment-dependent
skips; added cleanup and late-Stop regressions passed in focused checks. Production
builds passed. The main browser suite passed 167 checks with one compact-height
failure and 92 skips; the height was corrected without reducing 44px controls.
The repaired desktop/mobile checks and all 78 account/provider checks passed.
All 26 phone/scoring/YouTube checks passed together on the final functional patch.
Native OBS validation passed all 20 checks, including pause/resume, recording
continuity, expiry and terminal Stop. The real WebView2 fixture passed with mocked
resources and no accounts or live media. Studio `0.4.0-pilot.5` is staged locally;
the running `0.4.0-pilot.4` installation has not been changed. Physical same-link
disconnect/reconnect and phone screen-timeout testing remain required.

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
- October 1 adds fresh authority on a full restart after the old lease expires.
  Physical same-link restart and long-run camera/audio continuity still need
  testing on the installed `0.4.0-pilot.6` package.
- Provider observations still refresh Google access tokens frequently. A bounded,
  server-only token cache with connection-version invalidation could reduce
  provider traffic, but is outside this stability patch.
- Private signaling websocket loss and a direct WebRTC transport that fails to
  recover still require reconnecting. The patch does not remove direct-path
  checks or permit cameras to outlive revoked access.
