# M2 two-camera browser pilot

> Historical implementation notes. Runtime state, pending approvals and milestone status below are superseded by [current project state](PROJECT_STATE.md) and [rehearsal results](m4-controlled-rehearsal.md). Local paths are illustrative; private artifacts are not distributed.

Status: implemented for physical validation; not yet accepted as a two-camera endurance pass.

## Scope

Two independent direct video slots reuse the existing Camera 1 (`camera-home`) and Camera 2 (`camera-away`) assignments. Each slot has its own PC registration, negotiation, private Realtime topic, scoped credentials, stop control, and evidence recorder. Replacing or releasing one slot must not affect the other. Game completion/deletion invalidates both.

The receiver is `/studio-m2/<game-id>`. Publisher pages are `/studio-m2/<game-id>/camera/camera-home` and `/studio-m2/<game-id>/camera/camera-away`. New invitations carry a one-use token in the URL fragment. Existing camera access remains usable in the same device/browser; an already claimed role must be explicitly released before creating a replacement invitation.

Capture uses the M1 native-HD rear-camera mode (ideal width 1280, without forcing height/aspect). Both previews use `object-fit: contain`. Actual received width/height are displayed and included in timed checkpoints. There is no OBS, YouTube, desktop packaging, media recording, rotation, or crop in this milestone.

## Isolation and deployment

Migration `0024_add_m2_direct_studio.sql` adds separate M2 objects and leaves the M1 session model intact. Sessions are keyed by game and camera role. API requests, tickets, envelopes, JWTs and channel topics include the role. Browser credentials cannot execute the service RPC or publish Realtime messages directly. Existing organization, role generation, terminal-game and session expiry checks remain enforced.

The existing explicit `CURLCAST_M1_DIRECT_SPIKE=disposable` production-runtime gate is reused. Migration 0024 was applied transactionally to the approved disposable Supabase project `example-pilot-project` on 2026-09-07 after local SQL validation. The original LiveKit version remains preserved; no shared/production Supabase migration was made.

## Physical run

1. Keep the laptop on the GL-AXT1800 LAN and the iPad/iPhone on its main Wi-Fi. Use the tested Edge Guest browser with the existing exact-origin local-IP policy.
2. Restart the laptop Next server to load the M2 build, then open the M2 receiver in that Guest window.
3. Register PC separately in both slots. On the previously paired iPad, open the Camera 1 publisher URL in the same Safari browser and start it. For Camera 2, create its invitation and scan it on the second device; claim and start there.
4. Connect each receiver and confirm both are verified, frame counters advance, relay bytes remain zero, and full upright frames are visible.
5. Interrupt/reconnect only one camera, confirming the other remains live. Repeat for the other camera. A stop clears that slot's PC registration; register it again before restarting its publisher.
6. Once both slots are verified, select **Start both 2.5-hour tests**. Each recorder checkpoints every 15 seconds and stops its own session at its deadline. One failed slot does not stop the other. Download both role-labelled result files.

Both physical streams must overlap for the complete 2.5 hours with independently verified recovery before M2 acceptance. Synthetic browser pairs and mobile emulation are software checks only. A failed/restarted run does not count as uninterrupted endurance. Browser-local evidence includes no raw SDP, ICE addresses, tokens or media.

## Validation

- Production build and TypeScript check passed.
- 672 unit tests passed in the broad run; 40 database tests were skipped there. The separate local database run passed all 15 M1/M2 integration checks (7 M1, 8 M2).
- Eight focused M2 browser checks passed on desktop and mobile Chromium emulation, including two real synthetic WebRTC pairs and replacement isolation.
- Six focused M2 browser/recorder unit tests cover role fencing, independent credentials/timers, 2.5-hour deadlines, dimensions and timer suspension.
- 22 actual disposable Supabase checks passed, including private Realtime subscriptions for both slots/sides, wrong-role denial, independent replacement/release, and both terminal stop revocations. A separate diagnostic game was used and both diagnostic sessions were stopped.
- Focused M2 formatting passes. Full-repository formatting reported 263 files; after formatting the one new test, the remaining 262 are outside M2.
- A separate source copy without environment secrets built successfully with mock-only E2E configuration, but automatic approval review blocked starting its isolated test server. Full regression E2E therefore remains outstanding; the eight focused M2 browser checks above did run. Do not count the historical full-suite results as a current full pass.
- Live disposable authorization evidence is recorded in `CurlStreamer-M1-setup/m2-live-authority-audit.json`. Physical two-device validation is outstanding.
