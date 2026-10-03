# Hobby release plan

## Delivery model

Keep the website on Vercel. Windows Studio bundles the managed OBS/CEF runtime and local controller. Phones use browser cameras and scoring. Supabase carries data and signaling; the PC receives camera media directly over the local network and sends the composed program to YouTube. Recording continues when streaming stops.

Cloudflare was temporary pilot infrastructure. Reuse the existing Vercel project after verifying its configuration.

## Confirmed user experience — September 9

Studio is the main Windows application, with account access, seasons, schedules, game creation, scoring, sponsor uploads and camera/scorer QR invitations in one window. The current launcher and separate local controls are a development harness, not the intended finished interface. Stop treating repeated link copying as an acceptable operator workflow.

Reuse the hosted account/game interface inside the desktop application so the website and desktop share data and behavior. Keep camera reception, composition, recording and streaming in the managed local runtime. Desktop-to-website authorization and private recording-source handoff should happen automatically after the user signs in and selects a game; do not expose source codes, OBS setup or developer controls in routine use.

The normal flow is: open Studio, sign in, choose or create a game, scan camera QR codes, confirm camera readiness, then use clear recording and live controls. Background operation must still show whether recording is active, whether YouTube reception is confirmed, where recordings are saved and any actionable failure. Starting a public broadcast remains an explicit user action.

Remote scoring is a first-class option: a tablet or phone opens a scoped scorer QR invitation and updates the same game's score. The operator can also score from Studio. Keep existing append-only scoring and concurrency protections. The website remains available for planning and administration away from the recording PC. Internet access is required for the initial shared-data workflow; offline synchronization is a separate future feature, not implied by the desktop shell.

Next product milestone: integrate the full hosted workspace into Studio and automate the authorized game/recording handoff before asking the user for more manual multi-link rehearsals. Continue focused developer verification of the underlying recording connection as needed.

## 1. Consolidate source

Preserve local source/evidence outside Git; commit publishable M1-M4 code, tests, migrations and build instructions; merge current main without losing newer dashboard/scoring improvements; use the npm lockfile; record validation; open a reviewable PR with activation gates off.

## 2. Assemble Windows Studio

See the [component layout and first packaging slice](studio-packaging.md).

- Windows Forms launch window and Inno Setup installer recipe are selected; the compiled private launcher opens local browser controls.
- Provide one launch entry point, PC readiness, pairing and game selection.
- Show camera pictures, recording destination and independent recording/streaming controls.
- Bundle pinned dependencies; remove developer paths and manual commands.
- Define exit, crash recovery, redacted logs, upgrades and honest stale/unknown status.
- Complete dependency licensing/notices and redistribution review before shipping binaries.

## 3. Integrate website and desktop

- Connect normal game pages to Studio; replace pilot setup with desktop pairing and camera QR invitations.
- Finish YouTube diagnostics, readiness messages and end-game cleanup.
- Use a stable Vercel origin for production OAuth and participant links.
- Check preview builds using test configuration and disabled activation gates.
- Verify production configuration independently of preview success.

## 4. Publish a hobby beta

Publish the website through the existing Vercel project and a versioned Windows installer through GitHub Releases after review. Include installation/use/update instructions and known issues. Run focused installation, two-camera, recording, stream-stop and cleanup checks; refine through real games with long rink/endurance testing deferred.

Acceptance: no routine PowerShell/OBS setup, recordings retained, honest status and bounded cleanup. Cosmetic bugs may remain documented. Audio needs separate acceptance if included in the first release.
