# Connection reliability review — October 1, 2026

## Recommendation

The focused connection-management redesign is implemented: each phone and native receiver camera has one connection owner, one retry policy, and explicit states. Retain the existing camera capture, portrait rendering, OBS recording, and microphone components while collecting synchronized logs from a sustained physical run. Rewriting the entire video transport would not address a server outage or a phone browser being suspended.

This review does **not** certify uninterrupted physical-device broadcasting. Automated tests and an offline native check cannot establish that. A sustained two-phone test with the matching Studio package is still required.

## Evidence observed

At approximately 1:50 PM Toronto time on October 1, a read-only inspection of the Team Benning vs TEAM TEST game showed:

- Both camera assignments still matched their current device and assignment generation.
- Both receiver sessions were active and within their absolute expiry.
- Studio's receiver heartbeats were about 37 minutes old. Phone heartbeats were older still.
- The Studio launcher, Node controller, and native recorder were running. The lifecycle journal contained no corresponding controller/native exit.
- Local output reported recording with an unknown output state; both cameras were absent, pairing was unpaired, and streaming was idle.

The immediate failure was an abandoned Studio session renewal, despite a surviving process. The evidence does not establish that the router or Wi-Fi caused it. A current provider latency notice was also visible, but that is not proof of the initiating cause.

## Confirmed defects and changes

| Defect                                                                                                              | Effect                                                                                                | Change                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole-program authorization converted two temporary database failures into a revoked-scope response.                | The local program client permanently discarded its credential. Keeping Studio open did not repair it. | Preserve the temporary-unavailable classification and return 503; genuinely rejected scopes still fail closed.                                                                                                  |
| A receiver heartbeat older than 30 seconds could not renew itself.                                                  | Both phones entered recovery while Studio could never resume the original session.                    | Allow only an authenticated receiver check for the exact current, active, unexpired session to renew. Fence the old negotiation and require fresh camera negotiation. No expiry extension or claim replacement. |
| Local program reads converted exhausted network retries into a generic authority error.                             | The renderer could not distinguish a temporary server outage from revoked access.                     | Preserve a retryable transport error and return 503 through the local bridge.                                                                                                                                   |
| A camera could stop before its asynchronous setup returned, after which the renderer saved the already-dead handle. | Later retries found a handle and did nothing.                                                         | Track early termination and never retain a stopped handle.                                                                                                                                                      |
| The initial phone claim had no request deadline.                                                                    | Connect could remain pending during an unresponsive request.                                          | Add an eight-second deadline and record the failure without replaying a potentially completed claim automatically.                                                                                              |
| Lifecycle logs mostly explained starts/exits, not connection failures.                                              | Screens showed generic statuses without evidence of the first failure.                                | Add bounded, structured connection diagnostics at the phone, renderer, Studio controller, and server boundaries.                                                                                                |

The recovery migration preserves organization/game authorization, absolute session expiry, assignment generation, camera release, game completion, and private channel restrictions. It does not allow a phone to revive an offline receiver or reuse an old negotiation.

## Connection path and remaining design risks

1. A QR invitation claims one camera role for a particular device and generation.
2. Studio holds a signed program scope and independently maintains the two receiver sessions.
3. The phone begins a negotiation, obtains short-lived channel authority, and exchanges signaling through the cloud.
4. WebRTC verifies the direct media path; the native renderer receives the video and microphone tracks.
5. OBS records the program and sends a separate authorized output to YouTube.

These are separate failure domains, but the current UI often compresses them into “status unavailable.” A surviving phone capture does not prove Studio is renewing; a missing live badge does not prove OBS stopped sending; a healthy LAN media path does not prove cloud authority can renew.

The main architectural risk is the dependency of ongoing local media on frequent cloud authorization. Camera channel authority is limited to approximately 20 seconds and normally renewed every five seconds. This is intentional revocation protection, but a cloud outage can interrupt otherwise healthy LAN video. Removing the checks would compromise access boundaries. Any redesign needs an explicit, bounded revocation model.

The phone now uses one scoped, single-flight read every two seconds for microphone intent, reconnect commands, and zoom commands, replacing two overlapping polling loops. Native media observations are single-flight with a five-second deadline, and unchanged connection phases no longer republish UI/status diagnostics. The renderer still reads the program about once per second, and each read checks both receiver roles; channel renewal and direct-path checks remain independent. These are code-derived rates, not a measured production request profile. Profile remaining server work before changing authorization timing. Do not cache authorization merely to conceal an outage.

## Logs now available

| Location                                                         | Captures                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone camera page: **Download connection log**                   | Setup attempts, capture/permission failures, page visibility, wake-lock outcomes, HTTP status and duration, server trace IDs, retry scheduling, peer stop reasons, and periodic aggregate media samples. |
| `%LOCALAPPDATA%\CurlStreamer\Studio\connection-diagnostics.json` | Program requests, recovery, private-channel status, lease expiry, renderer camera failures, aggregate received-video samples, USB audio state, and desktop/YouTube request failures and recovery.        |
| `%LOCALAPPDATA%\CurlStreamer\Studio\controller-diagnostics.json` | Existing controller/native lifecycle and output diagnostics. Keep this alongside the new connection journal.                                                                                             |
| Hosting logs: `CurlStreamer connection`                          | Failed or slow camera/program/YouTube control requests, safe error codes, fixed stage labels, and `x-curlstreamer-trace` correlation IDs.                                                                |

Phone history persists across a page reload where browser storage is available; otherwise the current page can still export its in-memory history. Studio history persists across restart. Each journal retains at most 512 events and coalesces repeated failures within a 15-second window. This is diagnostic history, not permanent telemetry; export promptly after a failure. The logs use a strict allowlist and never record credentials, RTMP keys, raw error messages, request/response bodies, SDP, ICE addresses, camera device identifiers, or audio/video content. Media samples contain only aggregate frame/byte counters and connection state. Logging failure cannot stop capture or media.

Server tracing adds a correlation ID even to successful responses, but logs only errors and slow requests. Successful ticket and output-target bodies are not inspected by the logger. The diagnostics do not upload phone journals automatically.

## How to identify the initiating failure

Read the first failure before repeated retries, using UTC timestamps and server trace IDs:

| Sequence                                                                             | Interpretation / next action                                                                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Server timeout or database 503, followed by authority expiry while media was healthy | Control-plane failure. Prioritize consolidated renewal and a carefully authorized local recovery design.                                     |
| Cloud checks succeed, then ICE fails or received frames stop                         | Media-path failure. Inspect direct-path verification, receiver ownership, and transport behavior before replacing capture.                   |
| `camera_released` or an actual authority rejection                                   | Check role/generation and game lifecycle. Do not silently bypass release or expiry.                                                          |
| Page becomes hidden, wake is released/denied, then capture stops                     | Browser/OS suspension. Retry logic cannot guarantee foreground behavior for a locked or suspended phone.                                     |
| YouTube control fails but local video/OBS delivery continues                         | Separate the status display from transport evidence. Preserve the saved broadcast; do not create another link as a status-recovery shortcut. |
| Native/controller exits                                                              | Use the existing lifecycle journal and local output diagnostics together with the new connection history.                                    |

Wake lock is best effort. Browsers can deny it or release it when a document becomes hidden, the battery is low, or power-saving restrictions apply. The camera page should continue requesting wake while it is foregrounded during recovery, but a web page cannot promise an unlocked device indefinitely. See [MDN's wake-lock request requirements](https://developer.mozilla.org/en-US/docs/Web/API/WakeLock/request) and [release behavior](https://developer.mozilla.org/en-US/docs/Web/API/WakeLockSentinel/release_event).

YouTube disconnect/reconnect should retain the current saved broadcast while it remains reusable. A broadcast explicitly transitioned to complete has ended; that is distinct from pausing transport. See [Google's broadcast transition API](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition).

## Implemented connection coordinator

`CameraConnectionCoordinator` owns one reserved setup operation and one current handle per camera. Its states are idle, connecting, capturing, waiting for Studio, negotiating, streaming, retrying, blocked, and stopped. It invalidates the old attempt before aborting or releasing resources. Manual reconnect, remote reconnect, and scheduled retries coalesce; a replacement cannot start until an unfinished setup settles. Late handles are stopped, and retired callbacks cannot alter current capture, status, audio, or metrics.

Recovery uses typed failure classifications rather than a shared retry flag or parsing human messages. Temporary transport, Studio availability, and verified media-path failures use capped backoff; permission denial, missing devices, release, and explicit authority rejection require operator action. A ten-second continuously verified media interval resets backoff. Phone consent and page wake-lock ownership remain separate from the connection: a disconnected foreground camera page keeps requesting wake, but page closure clears capture consent.

Claims capture the invitation and attempt epoch, have an eight-second deadline covering the response body, and cannot overwrite a newer invitation. Cancel remains available while setup is pending. A cancelled permission rejection cannot start a second capture request. Delayed receiver heartbeats cannot discard a valid successor. Temporary heartbeats do not become permanent revocation. Provider renewal and ready announcements are single-flight, and their late callbacks are fenced.

Native event reads now carry the exact session, negotiation, receiver generation, and assignment generation. The bridge validates all four fields with a strict schema. A retired request is rejected before queue consumption and cannot close or drain the successor subscription. This matters because aborting a browser fetch alone cannot guarantee that a request has not reached the server.

Game state, camera claims, absolute authority expiry, direct-path verification limits, OBS output ownership, and the saved YouTube broadcast remain governed by their existing boundaries. Camera recovery does not dispatch a game reset, camera release, YouTube completion, or broadcast creation.

Remaining design work should follow evidence: profile program projection and cloud renewal latency, distinguish status polling from actual OBS delivery, and consider authenticated local signaling only if synchronized logs show cloud renewal is still the recurring bottleneck. Any local design needs an explicit bounded revocation model.

## Validation and rollout

Validation completed so far:

- Full unit suite: 1,688 passed; 95 conditional database integration tests skipped. The live PostgreSQL recovery fixture below was run separately.
- Type checking and formatting passed. The production build passed with the browser suite's explicit test configuration. An initial unconfigured build failed because the required Supabase URL was absent; no credentials were added to the repository.
- Main browser suite: 168 passed and 92 skipped initially; four failures came from two test fixtures affected by the new diagnostic button and renderer mock. Both affected files were corrected and rerun: all 10 desktop/mobile checks passed, including early camera failure and independent camera recovery.
- Pilot 7 native package: relocated bundle, empty profile, unarmed native check, and graceful controller exit passed. The package was staged without changing the running Studio instance.
- Live database: migration 0069 was installed and verified. Its isolated recovery fixture passed inside a savepoint and all fixture data was rolled back. Existing games and camera assignments were not changed.
- Separate YouTube/settings browser fixture suite: all 78 desktop/mobile checks passed, with a second successful production build.

Website deployment verified at 2:34 PM Toronto time: commit `f8a2c0b`, Vercel deployment `dpl_C4pYvXvQwNP7ixtBzxjGjLERVDhw`, Ready and assigned to `www.curlstreamer.app`. Public asset verification found the phone diagnostic export and persistent-history code. Harmless invalid-game requests to the M2, M3, and M4 desktop routes each returned 400 with a valid correlation ID. Evidence is saved locally under `work/connection-diagnostics-deployment-proof.json`, `work/connection-diagnostics-vercel-ready.png`, and `work/receiver-recovery-installed.png`.

Pilot 7 was installed after Studio closed, with all 2,247 manifest components verified and a rollback backup. The coordinator replaces it with a matching pilot 8 package; its final validation, installation, and deployment evidence are recorded below when confirmed. The Windows Start menu shortcut targets the installed package. The public installer download has not been republished by this change.

Required physical verification: a 45–60 minute run with both phones, then controlled interruption of one phone, Studio restart/resume, scoring navigation, and YouTube disconnect/reconnect on the same saved broadcast. Collect both phone exports and both Studio journals immediately after any interruption.

No real broadcast, camera release, or game reset was initiated during this review. Studio must remain closed during package replacement; reopening it can resume recording and camera connections.

### Coordinator validation and rollout

- Formatting and type checking passed.
- Full unit suite: 1,709 passed, with 95 conditional database integration tests skipped. This includes 64 focused coordinator/provider/bridge checks covering cancellation, stale work, typed failures, strict event scope, and successor queue preservation.
- Pilot 8 package: relocated bundle, empty profile, unarmed native check, and graceful controller exit passed.
- Main desktop/mobile browser suite: 182 passed, 92 conditional fixture checks skipped. Separate YouTube/settings fixture suite: all 78 passed. Both suites built the production app successfully with explicit test configuration.
- Installed Studio: `0.4.0-pilot.8`; all 2,247 installed component hashes match its manifest. Five files replaced; rollback backup is `work/studio-before-coordinator-20261001-151946`. The Windows Start menu shortcut was verified to target the installed executable. Studio was left closed.
- Final native adapter regression: two more desktop/mobile checks passed, proving 403 blocks one camera without retrying while the other recovers independently from 503. An additional production build and type check passed.
- Production deployment verification: pending at this report revision.
