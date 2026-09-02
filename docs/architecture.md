# Architecture

## Vertical slice

The App Router serves organizer, join, camera, scorer, and fixed-aspect program pages. Route handlers validate commands with Zod. A development-only JSON file in the operating system temporary directory is the mock authority; a lock directory serializes mutations so separate Next.js workers and browser contexts see the same state. Clients poll it and use `BroadcastChannel` only as a low-latency refresh hint. Score history is append-only, including compensating Undo events. Sponsor timing derives from the server-stamped `startedAt`, interval, and offset—not a scorer-local index.

The 1920×1080 canvas places two equal-height 9:16 sources in a central safe area with `object-fit: contain`; purpose-built side rails carry score, state, warnings, and sponsors. Full-screen sponsor mode overlays rather than unmounting camera sources.

## Production boundary

Replace `store.ts` with a Supabase repository and Realtime channel. Supabase RLS scopes every record to organization membership. Server routes mint least-privilege LiveKit tokens: home/away publish one video track and no audio; scorer publishes audio and no video; viewers subscribe only. Web Egress loads the composition and `StreamingProvider` supplies a server-only RTMP target. The schema is in `supabase/migrations`.

Mock state is host-local, resets when its temporary file is removed, and remains unsuitable for multi-host/serverless production. Upload data URLs are deliberately a development convenience, not cloud storage.

## Mock shortcut audit

| Shortcut or risk                                                                  | Classification                               | Required follow-up                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Temporary-file games are host-local and have no retention guarantees              | Must be replaced during Supabase integration | Durable tables, transactions, RLS, and Realtime                                              |
| Polling/`BroadcastChannel` only synchronizes one host                             | Must be replaced during Supabase integration | Realtime persisted version stream                                                            |
| Role claims use a host-local filesystem lock but do not consume invitation tokens | Must be replaced during Supabase integration | Unique constraint plus transactional invitation consumption                                  |
| In-memory IP counters                                                             | Must be replaced during Supabase integration | Trusted-proxy-aware distributed limiter                                                      |
| Sponsor data URLs live in process/browser memory                                  | Must be replaced during Supabase integration | Signed private storage and server image pipeline                                             |
| Carousel index is derived from a server timestamp by client clocks                | Acceptable mock behaviour                    | Persist authoritative epochs; production clients periodically reconcile server time          |
| Browser battery/device APIs vary, especially iOS                                  | Requires physical-device testing             | Capability detection and rink matrix                                                         |
| Development signing fallback                                                      | Acceptable mock behaviour                    | Production startup already fails without a 32+ character secret; use managed secret rotation |
| JWT module is referenced only by route handlers                                   | Acceptable mock behaviour                    | Preserve `server-only` provider/token boundaries during integration                          |
| Read/modify/write score and sponsor commands can race                             | Must be replaced during Supabase integration | Optimistic versions, idempotency keys, and database transactions                             |
| Mock broadcast start/stop only writes a flag                                      | Must be replaced during LiveKit integration  | Idempotent session commands and Egress reconciliation                                        |
| CSS camera simulations do not prove media orientation metadata                    | Requires physical-device testing             | iOS/Android publish-subscribe and Web Egress matrix                                          |

The mock implementation is useful only as a UX/state-model demonstrator. It is not safe for horizontal scaling or a public production deployment.
