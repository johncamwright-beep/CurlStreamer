# CurlStreamer

CurlStreamer combines a website with a Windows recording and streaming companion. The next release targets personal/hobby use.

## Product shape

- **Website on Vercel:** accounts, scheduling, invitations, scoring, sponsors, YouTube connection and broadcast authorization.
- **Phone browsers:** camera/scorer QR joining without installing a phone app.
- **Windows Studio:** local-network camera reception, composition, MKV recording and YouTube streaming. The target is one installer with a managed OBS runtime and no routine OBS setup.
- **Supabase:** authentication, durable data, storage and private signaling. Camera video travels directly to the PC, not through Supabase or Vercel.
- **YouTube:** viewer delivery. Local recording has an independent lifetime from streaming.

The Windows components currently run through development scripts; the finished Studio shell/installer remains to be built. A temporary Cloudflare HTTPS tunnel supported the pilot, not a permanent hosting migration.

## Current evidence

The September 2026 controlled rehearsal verified two portrait cameras, scoring, sponsor rendering, local recording, real unlisted YouTube reception, manual live controls and owned-resource retirement. This is short functional evidence, not audio, endurance or rink acceptance.

See [project state](docs/PROJECT_STATE.md), [rehearsal results](docs/m4-controlled-rehearsal.md), and the [hobby release plan](docs/hobby-release-plan.md). Older LiveKit code remains a reference path; direct-network Studio is the release direction. Mock fixtures are not real media evidence.

## Development

Use Node.js 22 and npm. Copy `.env.example` to `.env.local`, then run:

```sh
npm ci
npm run dev
```

The example defaults to mock mode and contains no usable credentials. Real mode requires existing Supabase/YouTube configuration with server-only secrets. Cameras require HTTPS. See [Vercel deployment](docs/vercel-deployment.md).

Native source/build instructions are under `native/`. Stage the pinned OBS/CEF runtime, toolchain and binaries outside this repository. See [native setup](docs/m4-native-toolchain.md) and [integration](docs/m4-program-stream-integration.md).

The build/start scripts accept a setup directory. `start-m4-operator-local.ps1 -Readiness` selects default-deny with pairing/streaming disabled. Rehearsal opt-in is a developer control, not the future user experience.

## Validation

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Database/native integration tests need their documented local dependencies. Skips are not acceptance evidence. Compare applied schema before running migrations; pilot migrations 0025-0030 have already been deployed to the pilot and must not be reapplied there.

## Distribution

GitHub stores source and is the proposed Windows release download location. Vercel hosts the website. Source PRs, website deployments and installer releases are separate steps. Credentials, stream keys, private source links, camera signaling payloads and recordings must stay outside Git.
