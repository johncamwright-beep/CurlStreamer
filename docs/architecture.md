# Architecture

## Vertical slice

The App Router serves organizer, join, camera, scorer, and fixed-aspect program pages. Route handlers validate commands with Zod. With complete Supabase configuration, a server-only repository stores games, state, invitations, claims, connections, closure, and append-only score events, including compensating Undo events. Database functions lock games and use optimistic state versions for concurrency-safe claims and scoring. Without Supabase variables, an explicitly local JSON file in the operating system temporary directory preserves credential-free mock mode; a lock directory serializes mutations so separate Next.js workers and browser contexts see the same state. Clients poll and use `BroadcastChannel` only as a low-latency refresh hint. Sponsor timing derives from the server-stamped `startedAt`, interval, and offset—not a scorer-local index.

The 1920×1080 canvas places two equal-height 9:16 sources in a central safe area with `object-fit: contain`; purpose-built side rails carry score, state, warnings, and sponsors. Full-screen sponsor mode overlays rather than unmounting camera sources.

## Production boundary

The database schema and atomic functions are in `supabase/migrations`. RLS exposes no game data to browser roles in this milestone; all access flows through server routes using `SUPABASE_SECRET_KEY`. Organizer authentication and organization policies remain a later milestone. Future server routes will mint least-privilege LiveKit tokens; Egress and RTMP output remain unimplemented.

The fallback state is host-local and resets when its temporary file is removed. Sponsor data URLs remain a development convenience and are not Supabase sponsor storage.

## Mock shortcut audit

| Shortcut or risk                                                         | Classification                              | Required follow-up                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Temporary-file fallback is host-local and has no retention guarantees    | Local mock only                             | Configure Supabase for persistent game state                                                 |
| Polling/`BroadcastChannel` has no Realtime subscription                  | Must be replaced in a later milestone       | Supabase Realtime persisted version stream                                                   |
| Production claims consume hashed invitations under a database game lock  | Implemented for this milestone              | Add organizer identity and organization authorization later                                  |
| In-memory IP counters                                                    | Must be replaced in a later milestone       | Trusted-proxy-aware distributed limiter                                                      |
| Sponsor data URLs remain embedded in current state                       | Must be replaced in a later milestone       | Signed private storage and server image pipeline                                             |
| Carousel index is derived from a server timestamp by client clocks       | Acceptable mock behaviour                   | Persist authoritative epochs; production clients periodically reconcile server time          |
| Browser battery/device APIs vary, especially iOS                         | Requires physical-device testing            | Capability detection and rink matrix                                                         |
| Development signing fallback                                             | Acceptable mock behaviour                   | Production startup already fails without a 32+ character secret; use managed secret rotation |
| JWT module is referenced only by route handlers                          | Acceptable mock behaviour                   | Preserve `server-only` provider/token boundaries during integration                          |
| Game and score updates use optimistic versions and database transactions | Implemented for this milestone              | Add idempotency keys before unreliable-network production use                                |
| Mock broadcast start/stop only writes a flag                             | Must be replaced during LiveKit integration | Idempotent session commands and Egress reconciliation                                        |
| CSS camera simulations do not prove media orientation metadata           | Requires physical-device testing            | iOS/Android publish-subscribe and Web Egress matrix                                          |

The fallback implementation is useful only as a UX/state-model demonstrator. It is not safe for horizontal scaling or a public production deployment.
