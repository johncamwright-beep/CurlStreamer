# CurlCoach integrated private sessions

Integration branch: `codex/curlcoach-integration`, based on the current internal-network pilot (3196e19). The prototype was preserved in ef01aa1; its original worktree and local practice data remain untouched.

## Product behavior

CurlCoach is an optional module of CurlStreamer. Existing users, active team memberships, events, games, and score events remain authoritative. There is no second team/account/game database. The coach opens an existing event or Single games, selects a game, and charts private attempts. Completed scores are read from the existing game completion; live scores are projected from existing append-only scoring events.

**Finish private coaching session** closes charting for that coach and game. The notes and reports remain private and can be reviewed. **Reopen coaching session** permits corrections again. Neither action completes the shared game, changes scoring, stops broadcasting, or publishes any coaching content. Corrections and lifecycle changes retain an append-only command history.

## Privacy and access

`CURLCOACH_ENABLED=true` controls rollout; omit it to leave the existing product unchanged. A verified, active account must have exactly one active team, a nonexpired team module entitlement, and an explicit nonexpired coach grant. Owners and platform administrators have no automatic right to another coach's private session. The platform admin panel controls entitlement/grant metadata only.

Private sessions are keyed by organization, existing game ID, and authenticated coach user ID. API requests never accept an actor or organization supplied by the browser. Server-only RPCs repeat membership, entitlement, coach grant, and game ownership checks. Private tables have RLS enabled, no browser table grants, and no public policies. Public team pages, score payloads and broadcast payloads do not read these tables.

Roster names come from existing team settings and are snapshotted with the first saved session. IDs are scoped hashes of organization, position and name, preserving the current roster model without inventing a separate player directory. Existing session snapshots do not change when names are edited later. Cross-season player identity reconciliation is not included. Empty rosters prompt account setup and disable charting.

Writes use UUID request IDs and expected revisions; concurrent changes fail safely. Refresh after a conflict. Stream review flags retain pending synchronization rather than claiming an accurate video timestamp.

## Rollout and remaining validation

Migration `supabase/migrations/0058_curlcoach.sql` is prepared locally and has not been applied to a shared database. It adds only linked private module tables and service-only RPCs. Its PostgreSQL integration suite passed on an isolated clone, including two-coach isolation. Before activation, apply the migration through the normal reviewed release path and validate the deployed UI with two separate coach accounts. Confirm that each can access only their own notes, then enable the flag for the pilot. Grant the pilot team entitlement and each intended coach's explicit access in Platform administration.

Stripe test payments do not grant a paid CurlCoach entitlement. Commercial Stripe product/pricing and live webhook entitlement fulfillment remain a later billing rollout; manual entitlement grants support the pilot.

Local lab mode remains explicitly labeled and requires `CURLCOACH_LOCAL_LAB=true`, the feature flag, a lab secret, and a nonproduction runtime. It uses only local practice files. No prototype data or service credentials were copied into this integration.

## Validation recorded September 13, 2026

- Full unit suite: 1,513 passed; 85 optional/native/environment-dependent checks skipped. Final focused access, storage, roster, API and UI checks: 30 passed.
- Required browser suites: 160 core desktop/mobile checks and 66 connected-account checks passed. Local coaching phone/tablet suite: 4 passed.
- Actual PostgreSQL clone: 2 integration tests passed after applying missing 0051/0052 prerequisites and 0058 to the clone only. Private coach isolation (including platform admin), finish/reopen non-interference with game state, entitlement expiry and CAS were verified. The clone was dropped and the local runtime stopped.
- Formatting and TypeScript passed. Production builds passed as part of the required browser runs; final build also recorded in the local ignored `work-final-build.log`.

Database test entry: `supabase/migrations/curlcoach_private_storage_postgres.integration.test.ts`, opt-in via `CURLCAST_DISPOSABLE_DATABASE_URL` and `CURLCAST_PSQL`. It requires a loopback disposable/test database and creates an isolated clone. No production credentials or data were copied to this integration.
