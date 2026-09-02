# CurlCast

CurlCast is a production-minded, three-phone curling broadcast MVP. Milestones 1–3 are implemented as a credential-free vertical slice: create a game, assign scoped phone roles, score ends, manage sponsors, and view a synchronized 1920×1080 composition.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`, create a game, and use the role links. Open scorer and broadcast pages in separate browser contexts to see polling-based updates. Mock state is kept in a host-local temporary JSON file so Next.js workers agree; it is not durable production storage.

## What is real vs mocked

- **Implemented in the mock slice:** validated creation; 30-minute invitation exchange for a six-hour device session; close-game revocation; event-based scoring/Undo; hammer rules; responsive camera capture preview (video only); sponsor optimization/management; server-anchored carousel; and full-screen/overlay composition.
- **Mock-only:** organizer identity, host-local temporary-file state/claims, in-process rate limits, polling plus `BroadcastChannel` refresh hints, browser image processing, simulated participants/audio/broadcast state, and CSS camera sources in the composition.
- **Scaffolded, not implemented:** Supabase repository/RLS, LiveKit publication and Egress, external DJI audio diagnostics, private sponsor storage, and YouTube RTMP start/stop. Provider stubs fail closed.
- **Next credentials:** LiveKit Cloud URL/key/secret, Supabase project URL/anon/service key, a 32+ byte token secret, and YouTube RTMP URL/key. Never prefix server secrets with `NEXT_PUBLIC_`.

## Validation

`npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`. See the rink/device plans before production use.

Deploy behind HTTPS (required for camera/wake lock), replace the temporary-file store with the Supabase repository, require Supabase organizer sessions, implement distributed rate limiting, and configure LiveKit before pilot use.

## Access lifecycle

An organizer creates 30-minute QR/direct invitations. Claiming one exchanges it for a device-bound six-hour participant session, long enough for pregame setup and at least four hours of active play/reconnects. Closing the game rejects subsequent claims and updates. These JWTs are a mock transport: production stores invitation hashes, consumes/revokes them transactionally, and validates the game lifecycle in Supabase.
