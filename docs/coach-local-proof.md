# Phone review over the local network — proof

This is an opt-in development proof, not a shipped Studio feature. It serves one fixed H.264 MP4 directly from the laptop to a paired phone. It never calls Supabase, YouTube, or a media relay and cannot control the broadcast. The current rehearsal uses a generated, visibly labelled `LOCAL SCRUB TEST` video (120 seconds).

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
- Independent coaching buffer retention across on-air replays.
- Production shooter identity, flag persistence and report routing (coordinated with Shot Tracker work).
- Mapping a locally selected point into the eventual recording/YouTube timeline across pauses and restarts.

Keep the phone connectivity proof isolated until those steps are validated. The existing native replay buffer and its 60-second behaviour are unchanged.
