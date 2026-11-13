# Phone review over the local network — proof

This is an opt-in development proof, not a shipped Studio feature. The fixed-file rehearsal was successfully tested on the user's iPhone. The second mode captures an independent rolling OBS view, exports a silent H.264 MP4, and serves it directly to a paired phone. Neither mode calls Supabase, YouTube, or a media relay. The native fixture is visibly labelled `LOCAL COACH PROOF` with a moving clock; it is not a camera feed.

Run with the repository's Node runtime:

```text
node node_modules/vite-node/vite-node.mjs scripts/coach-local-proof.ts <private LAN IPv4> <120-second MP4 path> <private local status file>
```

The server binds only to that IP on TCP 3188, closes after two hours, and writes its local address, pairing code, PID and expiry to the specified private status file. Do not commit or publish that file. Paired requests use an HttpOnly, SameSite cookie. Only the selected file is served; there is no directory browsing, Studio credential exposure, or broadcast command endpoint. Selections are proof-only memory state; the runner writes local diagnostic counters and the last selection alongside its status file.

On the phone, open the local address in Safari and enter the code. Scrub, preview, move one second at a time, choose Player or Team, add notes, and press Use this start. Player is only a placeholder for the current shooter in this standalone page. No production flags, reports, or timestamp links are changed.

The proof intentionally opens as a top-level local HTTP page to test LAN video without relying on HTTPS-site-to-HTTP mixed-content exceptions. Use a trusted router: HTTP traffic is not encrypted. Production pairing and the return path to HTTPS Shot Tracker still need design and iPhone verification; this proof is not approval to expose the service to the internet. No port forwarding. Firewall access, if necessary, must be limited to the selected local IP, TCP port and local subnet. The initial automatic firewall-rule attempt was denied; no firewall protection was disabled.

## Acceptance checks

- Real iPhone opens and pairs on the same router.
- Local H.264 playback and scrubbing work, including pauses and one-second adjustments.
- Saving includes the selected time, audience and notes.
- No media delivery outside LAN; database receives no scrub events.
- Authentication, single byte ranges, invalid positions and cross-origin write rejection have automated tests.

## Not yet proven

- Continuous two-minute capture from live Studio while broadcasting.
- CPU, memory and Wi-Fi load during a real broadcast.
- Production shooter identity, flag persistence and report routing (coordinated with Shot Tracker work).
- Mapping a locally selected point into the eventual recording/YouTube timeline across pauses and restarts.

Keep the phone connectivity proof isolated until those steps are validated. The existing native replay buffer and its 60-second behaviour are unchanged.

## Rolling native proof

## Studio integration pilot

The optional `coach-review-v1` package capability enables the same buffer in the existing program recorder. The score page exposes **Phone review** only when the running native session reports it. The owner chooses one of the laptop's private LAN addresses; the operator rejects other bind addresses. Closing the game/controller closes phone access. This path does not create extra camera receivers or send scrub traffic to Supabase.

Selecting a start first saves a local JSON recovery record, then returns metadata in the URL fragment to `/shot-tracker/review-import`. No video or credentials are sent to the website. The signed-in account's scoped game read supplies recorded shots; a recent matching charting draft on that phone may preselect one. Otherwise the coach chooses the shot. Save uses an append-only revision-checked command, preserving shooter and scoring fields, and sets the existing Player/Team report routing. Existing review time/audience/notes replacement is shown before confirmation. If no shot is selected, migration 0095 stores a separate, append-only review bookmark. Team flags need no roster or charted attempt; Player flags require a server-validated roster player. Standalone flags appear in the flagged-shots view and the matching reports, never in scoring statistics. The selection page explains any missing player instead of leaving Save silently disabled.

The recording-link estimate uses the laptop capture-request time minus distance from the end of the captured clip. It remains explicitly estimated because encoder delay and broadcast pauses/restarts have not been calibrated. Game/organization authorization is repeated on the server, and retries use the same request ID. Scrubbing itself performs no database calls. The local pilot retains its bounded capture limit and expiry; it is not an internet video server.

Set `COACH_PROOF_CAMERAS=1` for the real-camera variant. It uses the existing IP camera manager and installed receiver, with saved DPAPI-protected settings read through a private child-process pipe. Credentials never reach the HTML or command line. Both JPEG feeds are rendered with `object-fit: contain` inside the loopback-only OBS source. Only the paired snapshot server binds to the LAN. No YouTube broadcast starts, no saved camera configuration changes, and no production shot is written. This proof opens separate camera connections; production integration should reuse Studio's existing live source. Both Tapos and the exported two-feed clip were verified on November 9. Phone usability confirmation remains pending.

Build the recorder with `coach.c`; the feature is opt-in through the private `--coach-control` argument. Installed Studio does not request it. `CCS1` reads buffer state; `CCC1` captures without changing the program. The independent 960×540/15 fps encoder follows the live browser source, not the replay scene. OBS requires a mux audio track; the phone export removes it without touching broadcast audio.

```text
node node_modules/vite-node/vite-node.mjs scripts/coach-rolling-proof.ts <private LAN IPv4> <OBS runtime bin directory> <private status file>
```

The development runner expects the recorder in `work/coach-native-build/Release`, FFmpeg under `work/ffmpeg`, and its bundled ffprobe. It binds port 3189. On the phone, pair and tap **Capture recent video**. The snapshot stays frozen while the live buffer continues. Captures are session-private, immutable, limited to 32 per run and at most two minutes each. Proof files stay under `work/coach-rolling-evidence`; the runner closes after two hours. The full local test recording also remains there for inspection.

`coach-validation.mjs` verifies real native capture, H.264 decoding, capture of the current live source during an on-air replay, and continued main recording. Provider tests verify snapshot ownership and selection bounds; browser checks cover fixed and rolling modes at desktop/phone sizes. Actual camera/broadcast load, iPhone rolling-mode verification, durable flag persistence and exact recording timeline mapping remain separate integration gates. `capturedAt` is the capture request time, not yet a frame-accurate recording timestamp.

Validation on November 9: native build and independent/concurrent-replay capture checks passed; the running LAN exporter produced a 120-second, 960×540/15 fps video-only MP4. Formatting, typecheck, production build, 2,873 unit tests, and four focused browser cases passed. The standard application E2E command could not start because `npm` is unavailable in this shell (build was run directly through Next). A separate legacy replay-validation process timed out at startup while the phone proof was already running; it has not been counted as passing regression coverage. No installed Studio binaries or production deployment were changed.
