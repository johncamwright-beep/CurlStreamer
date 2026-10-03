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

Released September 14, 2026: migration `supabase/migrations/0058_curlcoach.sql` was applied transactionally to the shared Supabase database. RLS and denial of authenticated direct table reads were verified. Commit `34f48f2` was deployed through `codex/internal-network-pilot`, which serves www and team subdomains. Vercel deployment `6ZtpntpmRTb6eiJZKYx8JskJiNew` is Ready. `CURLCOACH_ENABLED=true` is scoped only to that preview branch; local lab mode remains disabled. Team Benning and its existing owner received explicit pilot entitlement/access through December 31, 2026 (expiry January 1, 2027 05:00 UTC).

Live smoke checks confirmed the existing owner can load real events, games, roster and charting controls, and sees Private coaching in the main menu. Anonymous access returns disabled/403 with private, no-store responses. No sample attempts were written to production. Two-coach isolation and finish/reopen were tested against the isolated PostgreSQL clone; a two-account live pilot walkthrough remains outstanding. Native Studio was not rebuilt for this web release.

Stripe test payments do not grant a paid CurlCoach entitlement. Commercial Stripe product/pricing and live webhook entitlement fulfillment remain a later billing rollout; manual entitlement grants support the pilot.

Local lab mode remains explicitly labeled and requires `CURLCOACH_LOCAL_LAB=true`, the feature flag, a lab secret, and a nonproduction runtime. It uses only local practice files. No prototype data or service credentials were copied into this integration.

## Validation recorded September 13, 2026

- Full unit suite: 1,513 passed; 85 optional/native/environment-dependent checks skipped. Final focused access, storage, roster, API and UI checks: 30 passed.
- Required browser suites: 160 core desktop/mobile checks and 66 connected-account checks passed. Local coaching phone/tablet suite: 4 passed.
- Actual PostgreSQL clone: 2 integration tests passed after applying missing 0051/0052 prerequisites and 0058 to the clone only. Private coach isolation (including platform admin), finish/reopen non-interference with game state, entitlement expiry and CAS were verified. The clone was dropped and the local runtime stopped.
- Formatting and TypeScript passed. Production builds passed as part of the required browser runs; final build also recorded in the local ignored `work-final-build.log`.

Database test entry: `supabase/migrations/curlcoach_private_storage_postgres.integration.test.ts`, opt-in via `CURLCAST_DISPOSABLE_DATABASE_URL` and `CURLCAST_PSQL`. It requires a loopback disposable/test database and creates an isolated clone. No production credentials or data were copied to this integration.

## Licensed seats and dashboard branding — September 14, 2026

Prepared migration 0059 adds an explicit licensed seat count (one by default). Team owners assign those seats to accepted, active team members under Account & Settings → Team access. Two licences allow two assigned coaches; the existing owner-plus-one team login limit is unchanged. Assignments replace access grants only, never move or expose private sessions. Menu access is checked when the menu opens and is labelled CurlCoach. Platform administrators set purchased or pilot seat counts; team owners cannot increase capacity. Reductions below active assignments are rejected until excess seats are unassigned.

The database serializes grants using the entitlement row, validates membership/ownership, and records assignment and capacity changes in the audit log. Migration preflight refuses to guess purchased quantities for existing teams with multiple coaches. Stripe checkout quantities do not yet provision these seats automatically; paid product/pricing and webhook fulfillment remain outstanding. Existing explicit pilot entitlements continue to work.

The dashboard includes the team's logo in its initial server response, avoiding a second account-appearance request after login. Other pages retain an authenticated fallback that reads only the logo instead of all team settings. No persistent identity cache was introduced.

Validation: licence API authorization and input tests; real PostgreSQL tests for transfer, one/two seats, expired entitlements, outsider/non-owner denial, note ownership, and competing grants; desktop/mobile owner assignment and transfer controls. Required browser run: 162 core and 66 connected-account passes, with two unchanged game-edit baseline failures at tests/game-setup.spec.ts:281. Formatting, TypeScript, 1,534 unit tests, and the final production build passed. The standalone build uses isolated placeholder Supabase configuration; an earlier attempt without that required configuration failed. Both real PostgreSQL seat tests passed, including simultaneous grants, and the disposable runtime was stopped. Production read-only preflight found one entitled team and no multi-coach conflicts. Released with user approval: migration 0059 applied successfully to hoogvyhuxevihttbutwl; server-only assignment execution confirmed (authenticated=false, service_role=true). Commit ad776a0 is live through codex/internal-network-pilot in Vercel deployment 3wNdsQJe9Nrta8hKW9RgXbjfc7wz (Ready). The signed-in Team access page shows the existing owner assigned to one licensed seat. Anonymous licence requests return 403 with private/no-store caching.
