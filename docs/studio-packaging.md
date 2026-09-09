# Windows Studio assembly plan

This is the next implementation boundary after source consolidation. There is no
finished installer yet. The recording/streaming engine has real rehearsal evidence;
the remaining work is to make it installable and usable without developer setup.

## Reproducible JavaScript build

From the source repository, with Node.js on PATH and npm dependencies installed:

```powershell
./scripts/build-m4-operator-local.ps1 -SetupRoot C:/CurlStreamer-setup -Readiness
```

This creates `m4-operator-ready.mjs` and `m4-program-assets` in the explicit staging
directory. It also rebuilds the repository's generated renderer assets. It does
not copy native dependencies, launch recording, pair a desktop or contact YouTube.
Build into a separate staging directory while any operator is active.

## Components to assemble

| Component                      | Source / responsibility                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| App launcher and UI shell      | New M5 work; start the local controller and show its controls. Shell framework is not selected.           |
| Node runtime and operator      | Pinned Node runtime plus bundled `scripts/m4-operator.ts`; private authority remains in Node.             |
| Program renderer               | Generated JS/CSS, shared ProgramCanvas, scoped local bridge.                                              |
| Native recorder                | `native/m4-studio-recorder`; owns composition, encoding and independent MKV finalization.                 |
| Native PC check                | `native/m4-studio-host` and its private IPC contract.                                                     |
| OBS/CEF runtime                | Pinned OBS 32.2.2 distribution and required resource/plugin/helper files.                                 |
| Service DLLs                   | Separate default-deny and production-admission builds; never ship synthetic test admission as production. |
| Notices and installer metadata | Versions, source/license notices, install/uninstall and upgrade behavior.                                 |

## First implementation slice

1. Define a relocatable install layout and manifest with component versions/hashes.
2. Replace the development CLI argument list with app configuration containing the
   stable Vercel origin; do not bundle account tokens or a particular game's IDs.
3. Create per-user recording/cache paths and a one-click launch/exit experience.
4. Expose existing readiness, pairing, recording and streaming controls together.
5. Validate startup on a clean Windows profile, missing/corrupt components and
   normal exit while recording. Package only after those checks pass.

The installer must not require the user to install Node, find DLLs, configure OBS
profiles or run PowerShell. Ordinary Stop Streaming must continue recording;
closing Studio must finalize it and handle uncertain provider cleanup explicitly.

## Deployment separation

The website remains on Vercel. Desktop releases are versioned separately and can
be distributed through GitHub Releases. Neither building this layout nor opening
a source PR authorizes a new broadcast or changes the connected YouTube channel.
