# M1 direct media spike

> Historical implementation notes. Runtime state, pending approvals and milestone status below are superseded by [current project state](PROJECT_STATE.md) and [rehearsal results](m4-controlled-rehearsal.md). Local paths are illustrative; private artifacts are not distributed.

## Latest physical evidence — 7 September 2026

Remaining database gates CLOSED: located the retained original test cluster and original seven-test pass log. A separate copy was started on loopback 55488 (original retained cluster untouched) and all seven current M1 PostgreSQL tests passed, including the real two-connection completion/signaling lock race and restrictive-policy enforcement alongside a permissive policy. Log: `C:/CurlStreamer-setup/m1-current-database-tests.log`. Copied cluster stopped after validation. Earlier statements that these checks lacked evidence were incorrect: subsequent skipped runs did not invalidate the original pass; they now also have a fresh pass. This complements actual Supabase/Realtime audits rather than replacing them (the local Realtime catalog is a test shim). M1 evidence is ready for acceptance review with documented Edge Guest/exact-origin privacy exception, operator-confirmed 720×1280 prior to timed run, and existing unrelated baseline validation failures. No M2 implementation, commit, push, or deployment was performed.

Additional live heartbeat audit passed (`live-heartbeat-audit.json`): a fresh receiver check succeeds; after 31 seconds without heartbeat, the old session is rejected with studio-stale, and a repeated check cannot resurrect it. The separate diagnostic studio was re-registered and stopped for cleanup. This closes the live receiver-heartbeat expiry item listed below; concurrent completion serialization and restrictive-policy coexistence tests remain outstanding.

Live disposable authorization audit: 17 checks passed against example-pilot-project using a separate diagnostic game; user test game/claim untouched. Evidence `live-authority-audit.json` and script `audit-live-authority.cjs` in setup directory. Live predicate accepts valid scope and denies wrong topic/game/assignment/negotiation/side; expired JWT denied; authenticated browser denied service-only RPC; wrong organization/duplicate claim denied; real private Realtime subscription accepts valid and rejects wrong topic; PC replacement revokes old receive/session while fresh authority works; release revokes receive and prevents restart. Diagnostic studio stopped. This does not cover real heartbeat-timeout, concurrent completion-versus-signal serialization, or restrictive-policy coexistence with an injected permissive policy; the seven local PostgreSQL tests remain skipped, not passed.

Pilot device status disposition: authorized full game GET exposes an M1-only display flag; game hook consumes/resets it. In disposable pilot mode Camera 1 displays claim status with a link to the PC receiver for actual video/path status, rather than legacy camera-health "offline". It does not claim live from a heartbeat. Legacy mode and shared release authority remain intact. Fifty-five route/game-hook/release regressions plus TypeScript passed. Final rendered lobby check requires loading the built app.

The bedtime endurance run completed 7200.001 seconds and persisted successfully (`portrait-two-hour-completed.json` in the setup directory, supplied as `m1-two-hour-test (5).json`). All 472 checkpoints were verified succeeded host/host paths with zero relay bytes, visible/online receiver, 29–31 fps. Frames advanced 215,714 and received bytes 2,335,787,279; no checkpoint-to-checkpoint frame stalls or frame/byte regressions. Maximum checkpoint gap 16.010 seconds, maximum metrics age 0.521 seconds; RTT average 4.51 ms, maximum 27 ms. Packet-loss counter increased by ten, with no denominator for a loss percentage. The transport endurance gate passes for the operator's current setup. 720×1280 was confirmed by the operator before this run; timed checkpoints do not store dimensions and cannot independently establish unchanged resolution throughout. Final checkpoint precedes stop, so this file alone does not confirm remote camera shutdown at the deadline. Full M1 acceptance still needs outstanding database/Realtime authorization evidence and resolution or explicit disposition of the legacy connected-device status mismatch. Do not begin M2 from this run alone.

Operator confirms PC-session replacement and camera release both stop the old feed, and released camera access cannot reconnect. Existing connected-device status did not reflect the M1 live stream; this status mismatch remains open. Subsequent reclaim exposed a UI defect: a saved released participant token disabled Claim Camera 1 even with a fresh invitation. Camera initialization now prioritizes the incoming invitation over cached access and observes hash changes for invitations opened in the same tab. Claim still goes through the existing one-use, generation-validated server route; no token or authorization validation is bypassed. Reclaim requires a fresh invitation link after loading the update.

Operator confirms native-hd produces upright 720×1280 portrait. The earlier two-hour run does not cover this capture configuration; repeat endurance deferred until bedtime. Authorization review reran Studio route, scoped JWT, and browser lifecycle suites: 19 passed. Seven M1 PostgreSQL integration cases were skipped because the required local disposable database/psql gate is unavailable. Those tests cover real database replacement, release, heartbeat expiry, private-topic denial, restrictive policies, completion serialization, and terminal games; source coverage is not equivalent to a live pass. Next physical drill: while streaming, Register PC to replace its session, verify camera stops, then reuse the current device-bound claim to reconnect; release drill follows after recovery.

Next resolution trial selects native-hd for M1: ideal width 1280 only, no requested height/aspect ratio and no portrait re-constraint. The working native mode remains available in the provider; LiveKit default remains unchanged. Actual output size, portrait orientation, full-frame appearance, and sustained performance must be checked physically; the ideal request guarantees none of those. Seventeen existing capture/LiveKit regressions and TypeScript passed.

Native portrait trial passed: `ipad-native-portrait-pass.json` reports camera track and preview 480×640, devicePortrait=true, portrait=true, constraintsApplied=false. Operator confirms the laptop matched dimensions and stayed verified for one minute. Export contains 70 samples/61 verified, final connected succeeded host/host, zero relay bytes. This is a 3:4 portrait result at low resolution, not proof of 720×1280 capture or a new endurance pass. Camera-side zero decoded frames/fps are receive-only counters and do not establish zero camera frame rate.

Operator clarified that the iPad's landscape image is upright (not sideways), and turning the device sideways changes the frame to portrait on both endpoints. Rotation of pixels is therefore not an established correction. M1 now tests native capture without width/height/aspectRatio requests or subsequent portrait constraint adjustment; exports mark captureMode=native. LiveKit retains the existing portrait-constraints default. This isolates capture constraints from device orientation and preserves the full raw frame. Seventeen capture/LiveKit tests and type checking passed; native portrait behavior awaits the iPad trial. Native resolution may differ from the prior 1280×720 run, so earlier endurance measurements do not validate its bandwidth/performance.

Portrait/remote-stop evidence: `ipad-portrait-and-remote-stop.json` records camera track and displayed dimensions 1280×720 while devicePortrait=true, portrait=false, constraintsApplied=true. Native portrait capture therefore FAILED on this iPad configuration; frame preservation remains separate from portrait capture. Operator reports laptop Stop disconnected the iPad within three seconds; the export confirms stateAfterStop=ended. Remote-stop check passes for this trial (latency is operator-reported, not a synchronized measurement). The final metrics precede shutdown and show a succeeded connected host/host pair, zero relay bytes. Remaining next check: with iPad Rotation Lock off and Safari full-screen, rotate landscape then portrait and restart capture upright to distinguish capture orientation state from the supplied dimension constraints. Historical WebKit orientation/constraint reports do not establish this device's cause.

Operator reports two successful ten-second Wi-Fi interruptions followed by verified reconnection without page refresh after enabling the exact-origin WebRtcLocalIpsAllowedUrls exception and switching the receiver to Edge Guest, where the policy status was OK. The personal profile ignored the policy. This is a conditional physical recovery pass based on operator observation, not a new exported endurance run. Address hiding is supported as the cause of the verification rejection. The policy/Guest combination is a pilot workaround, not a validated future Studio deployment configuration. Preserve the rollback script and remove the exception after pilot use; do not broaden it to all sites. Portrait dimensions and remote shutdown remain to be checked.

Endpoint diagnostics v2 now distinguish unavailable addresses, mDNS, IPv6, invalid/non-private IPv4, missing/invalid port, missing/unsupported protocol, and unmatched host endpoints. Only fixed labels are exported, never addresses or ports. The on-screen rejection includes these labels; DirectPeer metrics include camera/receiver side. Thirty-eight focused tests and type checking passed, including redaction and continued rejection across each unsupported endpoint class. This diagnostic change does not relax path acceptance or claim a Wi-Fi recovery fix. Existing exports cannot retrospectively resolve which endpoint class failed; the physical iPad must run v2 to identify it.

Physical result after gathered-candidate change: FAILED with the same iPad rejection. Evidence `ipad-gathered-candidates-failed.json` in the setup directory: 13 samples, zero verified; succeeded host/prflx pair, connected ICE and transport, remote endpoint unproven, neither endpoint established as private IPv4, zero recorded relay bytes. The signaling-ordering change did not resolve this reproduction. Do not present it as a recovery fix. The boolean endpoint fields cannot distinguish withheld addresses, IPv6, or another endpoint-validation failure. Full-page reset remains the observed recovery workaround; M1 Wi-Fi recovery acceptance remains open.

Latest candidate recovery change: offer/answer signaling now waits for complete local ICE gathering (maximum eight seconds) and sends the final localDescription SDP with all host candidates. Separate outgoing trickle broadcasts are removed; incoming trickle support remains. The final SDP is checked for host-only candidates and size before sending; missing candidates, timeout, close, or invalid SDP prevent sending. This eliminates application-level ordering between separate candidate and SDP messages without admitting unproven prflx paths. W3C permits withholding remote prflx addresses, so masked stats remain a possible explanation, not established fact. No physical recovery pass is claimed.

Validation for gathered candidates: 29 focused tests; broader unit suite 650 passed/32 skipped (middleware HTTP suite excluded to avoid its conflicting live build server); typecheck and changed-file formatting passed. Four M1 Edge browser tests passed using the existing local server and freshly bundled DirectPeer code: synthetic 720×1280 video, host-path verification, relay rejection, and frame-preserving UI in desktop/mobile emulation. Mobile emulation is not iPad Safari. Test config and logs are in the setup directory (`playwright-gathered.cjs`, `gathered-browser.log`, `gathered-candidates-unit.log`).

The next Wi-Fi retry still failed: operator saw host/prflx rejection with zero relay bytes. `ipad-wifi-recovery-second-failure.json` in the setup directory contains 16 samples, one verified, three decoded frames, and a last host/host pair in-progress with disconnected ICE/transport. That export missed the terminal rejected sample because shutdown preceded recording. The recorder callback now receives the rejected aggregate before shutdown; boolean endpoint-proof fields identify missing proof without exposing addresses. This repairs evidence collection only; network recovery remains unresolved. Twenty-four focused tests and type checking passed.

The iPad subsequently passed a fresh one-minute connection and manual stop/reconnect. Briefly switching to Settings interrupted media but recovered on return. Turning Wi-Fi off for ten seconds then rejoining produced repeated transport recovery failures; refreshing both pages and registering the PC restored verification. This is an open M1 recovery issue. The candidate fix fences old component callbacks by attempt, cancels pending signaling setup, and prevents closed peers from publishing late SDP. Aggregate exports now include selected-pair, ICE, and transport states without addresses or credentials. The physical Wi-Fi drill must be repeated after loading this build; no root cause or recovery pass is claimed. Validation: 23 focused tests; broader unit suite 644 passed/32 skipped, excluding the middleware HTTP suite that starts a conflicting server in the live build directory. TypeScript passed. Browser suites were not rerun against the occupied live server.

The subsequent iPad reconnect trial displayed the combined WebRTC disconnected/failed error after briefly showing video. The implementation now allows five seconds for a transient disconnected transport to return to connected; repeated events cannot extend that deadline. Terminal failure remains immediate, with a distinct message. Closing the peer cancels the timer. Path verification and session-expiry enforcement remain active. Twenty focused peer, signaling, and recorder tests and TypeScript validation passed. Physical recovery on the iPad remains unverified; this change does not establish the cause of the observed network failure.

The travel-router run completed two hours (15:11:16–17:11:16 America/Toronto). All 470 saved checkpoints show verified host-to-host media, zero relay bytes and 29–31 fps. The laptop used 1 Gbps Ethernet to a GL-AXT1800 Slate AX; the operator confirmed the iPhone on its main 5 GHz Wi-Fi. Maximum checkpoint gap was 16.014 seconds and maximum metrics age was 1.015 seconds. Decoded frames increased by 215,975. The timed recorder reports completed and persistence ok.

Evidence: `C:/CurlStreamer-setup/router-two-hour-completed.json`. Setup and subsequent implementation changes are recorded in that directory's README.md; earlier sections below retain the original implementation handoff history.

The recorded transport-duration check passes. Full M1 acceptance remains pending: actual portrait capture/receive dimensions, operator temperature/intervention observations, deliberate network and lifecycle failure drills, real Realtime denial/expiry checks, and confirmation of camera shutdown. Periodic checkpoint evidence does not prove every intervening packet or resolve earlier intermittent peer-reflexive failures. M2 has not started.

Authorized scope: M1 only. One browser camera and one PC browser receiver through private Supabase signaling. Preserve LiveKit, existing migrations, scoring, and all .codex metadata. No M2, OBS, packaging, YouTube changes, shared migration, deployment, commit, or push.

## Baseline before changes

- Revamp workspace: <private-workspace>
- Branch: codex/internal-network-pilot
- HEAD: 190ddd02cec8ab5e09baa85afb5d8f06a8cd9479
- git status --short: empty
- package-lock.json Git object: 832699c38f957145887eb5f0d187d8d6a3ac219c
- Preserved branch: codex/youtube-broadcast-panel at the same HEAD
- Local preservation tag: livekit-poc-2026-09-06 resolves to the same HEAD
- Original status: only untracked .codex/; unchanged by this milestone
- Canonical roadmap: <private-workspace>
- AGENTS.md and complete roadmap read before implementation.
- Prior open baseline gates: formatting, browser failures, production build configuration, disposable PostgreSQL evidence. Unrelated failures must not be repaired here.

## Implementation and acceptance status

M1 software is implemented and tested. The milestone is NOT accepted yet: real private Supabase Realtime delivery and a physical phone-to-PC two-hour LAN test remain unverified. M2 has not started.

- PC page: /studio-spike/<game UUID>. Camera page: /studio-spike/<game UUID>/camera.
- One Camera 1 track, no audio, OBS, YouTube output, Electron packaging, or second-camera flow.
- Raw capture lives in providers/camera-capture.ts. The existing LiveKit wrapper still wraps the same acquired track and preserves its existing report/presentation contract. No LiveKit transport or cleanup implementation was removed.
- DirectPeer uses empty ICE servers, filters host candidates, rejects embedded relay candidates, and accepts received video only after selected-pair statistics report two host candidates and zero relay bytes. The sender requests detail and maintain-resolution encoding; this fixed observed synthetic-test downscaling.
- Every new video surface uses object-fit: contain. Controls are at least 44px. Camera access requires an explicit user action, with wake lock and cancellation/cleanup handling.
- Reconnect is manual: restart Camera 1, then reconnect the receiver. Reuse the valid device-bound claim; a new camera negotiation fences the previous peer. This is the bounded M1 spike, not M2 recovery automation.

## Authorization and signaling

The studio route reuses authorizeGame for verified active owner/team-admin access or a same-game organizer token. Camera access requires the claimed Camera 1 participant token, device identity, and assignment generation. Scorers, Camera 2, raw invitations, cross-game actors, and unauthorized accounts cannot act as the studio or Camera 1.

Migration 0023 adds server-only studio records and RPCs. Operations lock game_states, games, then the studio record, matching existing lifecycle lock order. They check current game state, deletion/completion, organization, studio identity, negotiation, role generation, and device claim. Replacement studios, released roles, expired heartbeats, and completed/deleted/closed games cannot resume old writes. Existing migrations remain unchanged.

The server broadcasts only ephemeral signaling through the private Realtime REST endpoint. It does not use realtime.send(), so it creates no SDP/ICE history in realtime.messages. Application tables retain session metadata, never media or signaling payloads. Short-lived JWTs authorize one receive topic, game, session generation, camera assignment, negotiation, and side. Private RLS policies include restrictive fences against unrelated permissive policies. Browsers cannot send directly on M1 channels.

Realtime caches channel permissions. For that reason every outgoing signal is authorized against current database state, and every incoming message is checked against current authority before applying it. Replay IDs and negotiation scopes reject duplicate/stale messages. Credentials renew every five seconds, expire after at most twenty seconds, and foreground clients stop if renewal fails or the authority deadline passes. Studio and camera heartbeats are fenced after thirty seconds. Shutdown is bounded by these checks, not instantaneous remote hardware revocation.

Support export contains aggregate metrics only: direct/path status, byte/frame counters, frame rate, packet loss, round-trip time, timestamps, and sample counts. It excludes SDP, local addresses, tokens, device identity, and provider credentials. QR invitations use the existing one-use claim service and are removed from the URL fragment on the phone.

Reference behavior checked against [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) and [Supabase broadcast](https://supabase.com/docs/guides/realtime/broadcast), plus the locked SDK source. The Realtime REST httpSend endpoint requires a compatible server (v2.97.0 or later).

## Validation evidence

- npm run format:check: fails on 266 untouched baseline files. Changed TypeScript, TSX, Markdown, and configuration files were formatted separately; unrelated files were not reformatted.
- npm run typecheck: passes, including the final source changes.
- npm test: 107 test files and 660 tests passed, with disposable PostgreSQL integration enabled. The final targeted rerun of camera, direct-peer, and browser-lifetime tests also passed (24 tests).
- npm run build without service environment: compilation succeeds, then page-data collection fails because NEXT_PUBLIC_SUPABASE_URL is absent. This configuration baseline was not changed. The browser runner builds the application successfully with its existing test-only service placeholders.
- node node_modules/@playwright/test/cli.js test --config playwright.m1.config.ts: all four focused checks pass on desktop and mobile Chromium emulation. They exercise real DirectPeer WebRTC with a clearly synthetic 720x1280 canvas track, verify decoded portrait dimensions and zero relay bytes, inject a relay candidate and observe shutdown, and check contain/control sizing/no automatic capture.
- npm run test:e2e: the first attempt could not start through this runtime's packaged npm.cmd. A task-local npm launcher corrected the runner environment without changing repository configuration. The rerun reached all ordinary browser tests; its summary is recorded below. The chained YouTube suite was then run separately.

Ordinary browser suite:

```text
  16 failed
  4 skipped
  54 passed (5.2m)
```

Separate YouTube browser suite:

```text
  2 passed (27.1s)
```

Unrelated browser failures are recorded in the validation logs and left unrepaired. M1 browser checks passed within the full ordinary suite as well as in isolation. No test broadcast or provider account mutation occurred; the YouTube suite uses its existing local HTTP mock.

Logs: <private-workspace>

## Disposable PostgreSQL evidence

A new PostgreSQL 16.15 cluster was created for this task on loopback port 55487, database curlcast_m1_disposable. The original PostgreSQL instance on port 55439 was left untouched. Existing migrations 0001 through 0022 and the new 0023 migration were applied only to this new database. The test-only Realtime catalog shim does not simulate an actual Realtime service and must never be applied to a Supabase project.

Seven new database tests prove browser RPC denial, organization mismatch denial, one-use claims, studio/negotiation/generation fencing, role release, heartbeat expiry, private receive scope, restrictive RLS behavior, terminal state denial, and a real two-connection completion/signaling lock race. All existing disposable PostgreSQL suites also passed in the 660-test run.

To reproduce, use a new loopback-only test database, apply supabase/test-support/completion_postgres_prerequisites.sql and supabase/test-support/m1_realtime_catalog.sql, then all numbered migrations. Put psql on PATH, set CURLCAST_DISPOSABLE_DATABASE_URL to that disposable database, and run npm test. The integration test refuses non-loopback hosts and database names without test or disposable. The task-created cluster is stopped after validation; its data and logs are retained as evidence.

## Physical test setup still required

Use an explicitly disposable Supabase project with private Realtime enabled and the existing migration sequence plus 0023. Never apply the Realtime test catalog shim to that project. This task did not create or modify an external project, apply a shared migration, or deploy an HTTPS endpoint.

The real spike requires a production-mode local build because this repository intentionally uses its local game store in development mode. Configure the existing service environment for the disposable project and set CURLCAST_M1_DIRECT_SPIKE=disposable. Required names are NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, ROLE_TOKEN_SECRET, and SUPABASE_JWT_SECRET. The last name must be the server-only legacy HS256 JWT signing secret accepted by that disposable project. Modern asymmetric-key-only projects need a separately reviewed signer adaptation; do not silently switch keys or fall back to public signaling. No secret values belong in Git, screenshots, QR payloads, or support exports.

Run npm run build and npm start with that environment. The phone needs an already approved, trusted HTTPS endpoint reaching the application; plain LAN HTTP cannot capture a camera. No hosting or certificate setup was performed by this task.

1. Connect the PC by Ethernet and the phone to the same dedicated router Wi-Fi. Disable client isolation and verify the actual network path; a host candidate alone does not identify which physical adapter/router carries traffic.
2. Open /studio-spike/<active game UUID> under a verified owner/team-admin account or an existing same-game organizer session. Register the PC and create the Camera 1 invitation.
3. Scan the QR on the phone, claim once, and start the camera. On the PC, connect the receiver. Keep the phone upright, powered, unlocked, and foregrounded.
4. Confirm the whole portrait frame, record actual capture/receive dimensions, and verify Direct host path plus zero relay bytes. Export aggregate evidence without capturing the QR or credentials.
5. Sustain a physical two-hour connection and record start/end times, samples, temperatures, frame behavior, and interventions. Then exercise Wi-Fi loss/reconnect, page closure, camera release, session replacement, game completion, and rejection of late reconnect attempts.
6. Record private Supabase channel denial and token-expiry behavior against the real disposable Realtime service. Automated database policy tests and synthetic WebRTC do not substitute for this integration gate.

PC observed during this task: Windows 11 Home 10.0.26200; Ryzen 7 8845HS; Radeon 780M and RTX 4060 Laptop GPU; approximately 32 GB RAM; approximately 236 GB free on a 995 GB C: drive. The physical Ethernet adapter was disabled and Wi-Fi was active at a reported 780 Mbps link rate. Phone model/OS/browser, router, actual LAN path, venue uplink, and disposable Supabase project remain pending operator information. OBS and YouTube rehearsal decisions are outside M1.

## Exact files changed

- docs/m1-direct-media-spike.md
- playwright.m1.config.ts
- src/app/api/games/[id]/studio/route.test.ts
- src/app/api/games/[id]/studio/route.ts
- src/app/studio-spike/[id]/camera/page.tsx
- src/app/studio-spike/[id]/page.tsx
- src/components/DirectMediaSpike.tsx
- src/lib/providers/camera-capture.ts
- src/lib/providers/direct-peer.test.ts
- src/lib/providers/direct-peer.ts
- src/lib/providers/studio-browser.test.ts
- src/lib/providers/studio-browser.ts
- src/lib/providers/studio-session.test.ts
- src/lib/providers/studio-session.ts
- src/lib/studio-protocol.ts
- supabase/migrations/0023_add_m1_direct_studio.sql
- supabase/migrations/m1_direct_studio_postgres.integration.test.ts
- supabase/test-support/m1_realtime_catalog.sql
- tests/m1-direct-spike.spec.ts
- src/lib/providers/livekit-client.ts

## Context handoff

- Authorized milestone: M1 only; software implementation delivered, physical and real Realtime acceptance pending. M2 remains unstarted.
- Revamp workspace: <private-workspace>
- Current branch: codex/internal-network-pilot
- Current HEAD: 190ddd02cec8ab5e09baa85afb5d8f06a8cd9479
- Lockfile object: 832699c38f957145887eb5f0d187d8d6a3ac219c
- Working tree: only the M1 files listed above are modified/untracked; no commit was created.
- Preserved branch: codex/youtube-broadcast-panel at 190ddd02cec8ab5e09baa85afb5d8f06a8cd9479
- Preservation tag: livekit-poc-2026-09-06 resolves to 190ddd02cec8ab5e09baa85afb5d8f06a8cd9479
- Original status: ?? .codex/
- Canonical roadmap: <private-workspace>
- Preserve LiveKit and all original .codex metadata. Do not repair unrelated baseline failures.
- Before further milestone work, reread AGENTS.md and the complete canonical roadmap, record branch/HEAD/status/lockfile, state the single authorized milestone and exclusions, retain unrelated changes, run focused and required gates, and update this handoff.
- Next permitted action: review this M1 implementation and collect the outstanding M1 evidence. Do not begin M2, commit, push, create a PR, apply a shared migration, deploy, purchase, or broadcast without separate authorization.
