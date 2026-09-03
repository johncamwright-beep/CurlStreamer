# CurlCast

CurlCast is a production-minded, three-phone curling broadcast MVP. Milestones 1–3 are implemented as a credential-free vertical slice: create a game, assign scoped phone roles, score ends, manage sponsors, and view a synchronized 1920×1080 composition.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`, create a game, and use the role links. Open scorer and broadcast pages in separate browser contexts to see polling-based updates. Without Supabase variables, mock state uses an explicitly local, host-temporary JSON fallback. When all three Supabase variables are present, server routes use the database-backed game store instead.

## What is real vs mocked

- **Implemented in the mock slice:** validated creation; 30-minute invitation exchange for a six-hour device session; close-game revocation; event-based scoring/Undo; hammer rules; responsive camera capture preview (video only); sponsor optimization/management; server-anchored carousel; and full-screen/overlay composition.
- **Mock-only:** organizer identity, the no-configuration host-local temporary-file fallback, in-process rate limits, polling plus `BroadcastChannel` refresh hints, browser image processing, simulated media/broadcast state, and CSS camera sources in the composition. A filesystem lock lets Next.js workers share fallback state, but it is not durable production storage.
- **Supabase-backed:** games, current state, append-only score events, hashed invitations, atomic role claims, participant connection status, and closure/revocation. Database access uses the server-only secret key; the publishable key is configuration readiness metadata until organizer authentication is implemented.
- **Scaffolded, not implemented:** LiveKit publication and Egress, external DJI audio diagnostics, private sponsor storage, and YouTube RTMP start/stop. Provider stubs fail closed.
- **Next credentials:** LiveKit Cloud URL/key/secret, Supabase project URL/anon/service key, a 32+ byte token secret, and YouTube RTMP URL/key. Never prefix server secrets with `NEXT_PUBLIC_`.

## Validation

`npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`. See the rink/device plans before production use.

Deploy behind HTTPS (required for camera/wake lock), apply the Supabase migration, require Supabase organizer sessions, implement distributed rate limiting, and configure LiveKit before pilot use.

## Access lifecycle

An organizer creates 30-minute QR/direct invitations. Claiming one exchanges it for a device-bound six-hour participant session, long enough for pregame setup and at least four hours of active play/reconnects. Closing the game rejects subsequent claims and updates. With Supabase configured, invitation hashes are consumed transactionally and the game lifecycle is validated in the database; organizer identity and durable participant sessions remain future production work.
