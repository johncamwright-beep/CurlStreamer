# Hobby release plan

## Delivery model

Keep the website on Vercel. Windows Studio bundles the managed OBS/CEF runtime and local controller. Phones use browser cameras and scoring. Supabase carries data and signaling; the PC receives camera media directly over the local network and sends the composed program to YouTube. Recording continues when streaming stops.

Cloudflare was temporary pilot infrastructure. Reuse the existing Vercel project after verifying its configuration.

## 1. Consolidate source

Preserve local source/evidence outside Git; commit publishable M1-M4 code, tests, migrations and build instructions; merge current main without losing newer dashboard/scoring improvements; use the npm lockfile; record validation; open a reviewable PR with activation gates off.

## 2. Assemble Windows Studio

- Choose the desktop shell and installer format; neither has been selected yet.
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
