# M3 local OBS recording proof

> Historical implementation notes. Runtime state, pending approvals and milestone status below are superseded by [current project state](PROJECT_STATE.md) and [rehearsal results](m4-controlled-rehearsal.md). Local paths are illustrative; private artifacts are not distributed.

This is the founder-operated local proof, not the finished Studio installer. The desired final experience is one installer with OBS managed behind the Studio interface. Packaging remains later work. M2 and M3 physical endurance gates remain outstanding; the user deferred endurance and authorized this local recording implementation. No YouTube broadcast or streaming command has been run. The isolated portable runtime and short diagnostic recordings are described below.

## Host readiness

### Local proof update — 2026-09-08

The official OBS 32.2.2 Windows x64 archive was downloaded, SHA-256 checked against the official release (`4d6e40e3ab155f56b30de517380566a206d74b63cdf5ad49aa596924768f97e1`), and extracted to `C:/CurlStreamer-setup\obs-m3-32.2.2`. Its portable configuration has a dedicated profile/scene collection and current-user/SYSTEM-only credentials. No system-wide installer, existing OBS profile or firewall exception was changed.

The portable runtime is running. The authenticated adapter reports OBS 32.2.2 / WebSocket 5.7.4, 1080p30, Browser Source available, Standard MKV and AMD `h264_texture_amf`. NVIDIA driver 555.97 is below the release's NVENC requirement, so NVIDIA encoding was not selected or upgraded.

Two short diagnostic recordings exercised the actual private program, AMD encoding and local MKV output. Decoding the first clip verified H.264 High, 1920×1080, 30 fps and the correct scoreboard with waiting-camera placeholders. No physical camera footage was used. The silent AAC track measured at the volume detector's -91 dB floor. OBS reported zero rendering/encoding skips. The second run verified the corrected stop behavior: StopRecord acknowledgment alone is insufficient; the adapter now waits until OBS confirms recording inactive before reporting success.

Evidence: `CurlStreamer-M1-setup/m3-recording-smoke.json`, `m3-recording-frame.png`, and `m3-recordings/`. This is a short engine/composition proof, not physical-camera or endurance acceptance. The user's real test game is now prepared in a separate owned OBS scene with recording off; the camera devices must reconnect. Its scene identity is in `m3-camera-program-ready.json`.

The first real-camera short recording (`2026-09-08 00-03-03.mkv`, ten seconds) decoded at H.264 High / 1920×1080 / 30 fps. Camera 1 and the saved scoreboard were visible with the full portrait frame; Camera 2 had stopped. Two-camera physical acceptance is therefore still pending. The user was asked to reconnect Camera 2 and report the device error. Recording was stopped and confirmed inactive; the preview remains running for recovery.

Read-only inspection found no OBS executable in standard Program Files / per-user Programs locations, no running `obs64`, and no listener on port 4455. This does not exclude a portable install elsewhere. Windows reports AMD Radeon 780M Graphics and NVIDIA GeForce RTX 4060 Laptop GPU. These are hardware candidates, not proof that OBS can initialize or sustain an H.264 encoder.

## Isolated manual setup

For a fresh host, use a separate supported OBS runtime for the M3 proof. The current laptop already has the isolated portable setup described above. Do not overwrite an existing recording/streaming setup. In OBS create a **new profile** and a **new scene collection**, both named **CurlStreamer M3**. Select both before using this CLI; it refuses mutations elsewhere and never changes existing profile, video, audio, recording-directory, or encoder settings.

1. Set base canvas and output to **1920 × 1080**, **30 fps**.
2. In Output, use Advanced mode, Standard recording, a local recording folder with ample free space, and MKV. Disable recording rescaling. Select an available **hardware H.264** recording encoder explicitly, not “use stream encoder.” A configured encoder remains unverified until recording succeeds. The adapter conservatively recognizes known NVENC, AMF and QSV H.264 IDs and fails closed on unknown/new IDs. Its recording checks target current OBS profiles (`RecFormat2=mkv`, `RecRescaleFilter=0`); an older profile that cannot prove those settings needs manual inspection, not a bypass.
3. This proof is video only. Disable global desktop/microphone devices in this dedicated profile and confirm OBS meters are silent. No simulated audio qualifies as audio acceptance.
4. In Tools → WebSocket Server Settings, enable the v5 server and authentication. Keep access local; do not add firewall or router WAN exceptions. The client accepts only literal loopback `ws://127.0.0.1:4455` or IPv6 `ws://[::1]:4455` (TLS variants also accepted), not LAN addresses or DNS hostnames.
5. Obtain a fresh private program invitation from the M3 controller. It must have the form `https://<test-origin>/studio-m3/<game-id>/program#code=<one-time-code>`. Never substitute an organizer, camera-role, Supabase or YouTube credential. Store it briefly in a user-private text file outside the repository or pipe through stdin. Do not paste it into command arguments, shell history, screenshots or support reports. OBS retains Browser Source settings locally, so the redemption code must be one-use and short-lived.

## Commands

Requires the repository's installed dependencies and Node with built-in WebSocket. The CLI bundles the TypeScript adapter in memory with the existing esbuild dependency; no package or bundle installation is performed. Password comes only from the current process environment. In PowerShell, a masked prompt avoids putting it in shell history:

```powershell
$m3Password = Read-Host 'OBS WebSocket password' -AsSecureString
$env:OBS_WEBSOCKET_PASSWORD = [System.Net.NetworkCredential]::new('', $m3Password).Password
node scripts/m3-obs.mjs status
```

The child deletes its inherited password environment entry after reading it. Clear the parent's environment variable after commands with `Remove-Item Env:OBS_WEBSOCKET_PASSWORD`; do not use `setx` or write the password to `.env`.

```powershell
node scripts/m3-obs.mjs prepare 'C:\private\m3-program-url.txt'
node scripts/m3-obs.mjs start 'CurlStreamer M3 <returned-scene-uuid>'
node scripts/m3-obs.mjs status
node scripts/m3-obs.mjs stop 'CurlStreamer M3 <returned-scene-uuid>'
```

`prepare` creates a uniquely named new scene and a 1920 × 1080, 30 fps Browser Source. The source stays loaded when inactive and does not restart when activated. It does not select the scene or record. The program renderer, not an OBS crop/scale, preserves both portrait feeds with contain. Partial failure may leave the new dedicated scene behind; inspect/remove that scene manually, never a pre-existing scene.

`start` checks the dedicated configuration, idle recording/streaming outputs, canvas and selected H.264 hardware encoder, then selects only its owned scene and starts local recording. It does not prove the remote browser page is ready: inspect the OBS preview for both complete portrait cameras, score and sponsors first. `stop` refuses a different current scene, and returns the local file path after OBS completes its stop response. If OBS disconnects during a command, outcome is uncertain: inspect OBS and use its manual Stop Recording control before retrying. The CLI has no automatic retry of mutations.

`status` returns versions, isolation/readiness flags, recording state, CPU, memory, FPS, skipped/total rendering and output frames, available disk space and recording bytes/duration. It does not fetch or print source URLs, stream settings, OBS passwords, organizer credentials, or raw OBS error comments. It reads stream activity solely to refuse interference with an active output; no start/stop/toggle streaming request exists in the adapter.

## Evidence still required

Camera 2 initially stopped with host/prflx and unavailable addresses. Edge's local-IP policy does not configure OBS's separate CEF profile. For this isolated CEF 127 runtime, `Set-M3CefAddressPreference.ps1` in the local setup folder preserves `UserPrefs.json` and sets `webrtc.local_ips_allowed_urls` to only `https://pilot.example.test`. The helper requires OBS and its browser subprocesses stopped and supports `-Mode Restore`. No global mDNS disable or verifier relaxation was applied. A different tunnel origin requires explicitly updating this allowlist.

CEF [registers the preference](https://github.com/chromiumembedded/cef/blob/6533/libcef/browser/prefs/browser_prefs.cc), and Chromium 127 [copies it into renderer preferences](https://github.com/chromium/chromium/blob/127.0.6533.120/chrome/browser/renderer_preferences_util.cc). After applying it, the user confirmed both physical cameras connected and verified. The 10-second local file `m3-recordings/2026-09-08 00-14-52.mkv` contains both portrait feeds and scoreboard at 1920x1080, 30 fps, H.264 High, with zero additional OBS rendering/encoding skipped frames. Camera 2 is dark/blurred but present. Recording and streaming are confirmed off. This is a basic recording check; endurance and live score/sponsor changes remain unverified.

Use the OBS windowed program projector to view the feeds after M3 preparation; do not register receivers on the old M2 laptop page, which replaces OBS sessions. `ObsLocal.showProgram` opens only the current owned M3 scene, without recording, and `snapshot` captures the owned scene for local inspection. The setup helper `m3-show-program.cjs --show` opens the projector and saves a private local snapshot.

The controlled restart used process termination while recording/streaming were confirmed inactive. Its startup sentinel files were retained under `intentional-restart-backup_` names after confirming the resulting unclean-shutdown prompt; normal future crash detection remains enabled. Fresh one-use program invitations were prepared after restart. Managed graceful runtime shutdown and reload-safe invitation handling remain follow-up work.

First make a short local recording with both physical cameras, real score/sponsor updates, full portrait frames and verified direct paths. Play the file and verify 1920 × 1080 at 30 fps, correct composition, no cropping and no sustained rendering/encoding lag. Record OBS version, actual encoder, browser runtime, output file and sanitized before/after health. Then, when the user schedules it, run the roadmap's **2.5-hour M3 recording** and measure dropped frames and memory growth. A selected encoder, passing mocks, or a short clip is not that endurance gate.

Protocol implementation follows the [official obs-websocket v5 protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md), including authenticated Hello/Identify, correlated Request/RequestResponse, and bounded timeout handling. Browser Source configuration is documented in [OBS Browser Source](https://obsproject.com/kb/browser-source).

## Live control check — 2026-09-08

`m3-control-check.json` and recording `2026-09-08 00-18-14.mkv` capture a test score (1-0, end 2), home-only and away-only layouts, and split restoration. The recorded score frame was decoded and inspected. Original derived score, end and hammer were restored with append-only Undo; both feeds returned in the split snapshot. OBS recorded zero additional render/encode skipped frames and confirmed recording inactive.

The sponsor check using existing enabled bundled images failed visually in both modes. M3 had cleared all stored sponsor metadata before projection. The fix permits only the two exact bundled image paths after a successful library lookup; current library images still take precedence, and failures/private paths do not fall back. Seven route tests, TypeScript, build, focused formatting and six browser checks pass. Physical sponsor retest awaits the existing server restart. Sponsor display was turned off and original style/interval restored; no sponsor assets were modified. The mode API resets rotation timing, so this is not a claim of exact timing-phase restoration.

Physical sponsor retest passed after server restart: both cameras were present throughout overlay/sidebar display and restoration. Evidence `m3-sponsor-check.json`, `m3-sponsor-recorded.png`, and recording `2026-09-08 00-24-39.mkv`. Zero additional render/encode skips; recording and streaming inactive. This supersedes the pending sponsor result above; long endurance remains outstanding.
# Vercel recording-link deployment (September 9, 2026)

Apply `0031_add_m3_program_grants.sql` alongside the M2 camera schema before deploying the durable program-link provider. The table is server-only with RLS and no anonymous/authenticated privileges. It retains one pending grant per game, stores only a SHA-256 digest of the code, and consumes it using a single `DELETE RETURNING` operation. Links expire after five minutes; preparing another replaces the pending link. Session checks still fence replaced, stopped or completed games.

Set `APP_BASE_URL` to the exact HTTPS origin opened by the recording PC, including a branch-specific override for a Vercel preview. Set a stable, server-only `ROLE_TOKEN_SECRET` (at least 32 characters). The provider derives a separate-purpose cookie signing key from that secret so cookies work across instances and restarts. Rotating the secret invalidates existing program cookies. Cookies remain restricted to the game’s prepared sessions and expire after four hours.

The main pilot database received migration 0031 on September 9. Database checks verified one-use consumption, no anonymous/client privileges, enabled RLS, and no retained test rows. This is not an end-to-end camera/recording result.
