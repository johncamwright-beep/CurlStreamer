# Completion foundation writer coverage

Migration `0015` installs an internal, service-role-only review and completion
transaction. It does not add a route, server action, page, control, or client
export. Existing `close-game` remains a legacy access-closing state mutation and
does not create a completion, snapshot, or completion audit.

## Writer map

| Writer                                                                                                                            | Records affected                                                                           | Completion protection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_game`, `create_team_game`, and both `create_scheduled_team_game` signatures                                               | `games`, `game_states`, creation audit                                                     | Initial state inserts create a database-issued result revision. New games are not completed.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `write_game_state` via ordinary PATCH, disconnect, layout/audio/broadcast/sponsor/camera/connection/health, and legacy Close Game | Whole `game_states.state` and `version`                                                    | Every current write supplies the version it read. Participant writes also require the trusted token role, device claim, and assignment generation to match that snapshot before mutation. PostgreSQL preserves server-owned assignment generations, permits an older application to introduce only a generation-zero legacy claim, advances the generation when an older application explicitly removes a claim, and rejects direct replacement or post-release re-claim. Stale snapshots conflict and the terminal trigger remains authoritative. |
| `prepare_game_role_invitation`, `claim_game_role`, and `release_game_role`                                                        | `game_invitations`, claims/generations and runtime camera state in `game_states`           | All three lock state then game and require the active lifecycle for invitation/claim. Issuance advances the role generation and revokes older unused invitations. Claim atomically consumes exactly that invitation; only a retry by its original device is idempotent. Release must match both the observed device and generation, then clears the assignment, advances generation, and revokes pending links before provider cleanup begins.                                                                                                     |
| `append_score_event` via score, hammer, and Undo                                                                                  | `game_states` plus append-only `score_events`                                              | The application validates coherent score payloads and binds each intent UUID to its expected end or Undo target. A matching persisted intent is an idempotent retry; a reused or stale intent conflicts before it can affect a later end. The deployed RPC signature is preserved. It locks `game_states` and then `games` before updating state, retains the state-version predicate, and inserts the uniquely identified event. Inserts advance the result revision; updates/deletes remain rejected.                                            |
| `update_scheduled_team_game`                                                                                                      | Schedule/config columns on `games`, mirrored config in `game_states`, state version, audit | Both deployed and config-snapshot signatures lock `game_states` before `games`, commit both config representations together, and advance the state version. The snapshot overload changes only `state.config`, so concurrent score and heartbeat fields are preserved.                                                                                                                                                                                                                                                                             |
| `soft_delete_team_game` and `restore_team_game`                                                                                   | Retained state/version, deletion metadata, deletion cleanup status, audit                  | Both lock state then game. Deletion closes non-completed state, clears claims/media, advances the shared version, writes metadata and one audit atomically, and records LiveKit cleanup only as pending. Repeated deletion and restore also repair a legacy partially deleted active state; completed state and frozen results remain unchanged.                                                                                                                                                                                                   |
| Completion transaction                                                                                                            | `game_states`, `games`, one `game_completions` row, one cleanup row, one audit             | Locks `game_states` and then `games`, re-authorizes, validates the immutable review, clears runtime state, freezes the result, and records LiveKit cleanup only as pending. Concurrent/repeated authorized calls return the first completion and its stored review identity.                                                                                                                                                                                                                                                                       |
| YouTube Start/Stop claim and provider checkpoint                                                                                  | `game_states`, `games`, `broadcast_sessions`                                               | Migration `0021` locks `game_states`, then `games`, then the durable broadcast session. Short transactions claim a generation/token or compare-and-set provider evidence; no database lock is held during YouTube or LiveKit calls. Completion/deletion fence an in-flight Start by advancing the generation before cleanup.                                                                                                                                                                                                                       |

`game_states` is the canonical first lock for every operation that also needs a
`games` lock: review, completion, scoring, schedule editing, deletion, and
restoration. A row trigger
cannot establish this order because PostgreSQL locks its target row before
running a `BEFORE ROW` trigger. Direct state writes from the previously deployed
application remain supported and terminal-guarded without acquiring a parent
lock. Requests already holding the state lock finish before completion;
requests that wait behind completion re-evaluate the locked completed row and
are rejected. Migration `0017` adds optimistic concurrency to the current
application without changing that lock order.

Every participant-authorized mutation validates the trusted token role, device
claim, and assignment generation against the state snapshot before applying the
action. Actions carrying a role must name that same trusted role. This covers
camera framing as well as scorer score, hammer, and Undo commands; a stale
same-device credential cannot mutate a later assignment generation.

Only absolute `camera-health` and `connection` updates are retried after a CAS
conflict. Each retry reloads the latest state and repeats the participant check,
or requires the organizer-observed claim/generation pair captured when the
operation began. Reusing the same device ID after release does not satisfy this
check. A release or reassignment therefore stops the retry instead of letting a
heartbeat revive the camera. Scoring, Undo, and other operator intent are never
automatically rebased.

Scoring controls allow one in-flight intent at a time and retain the same intent
identifier for an explicit retry after failure. Score payloads cannot combine a
blank with points or a team, and a non-blank score requires both a team and at
least one point. Every scoring intent carries the exact last persisted event ID
observed by the client. Score and hammer also carry the displayed end, while
Undo carries the exact active event it intends to reverse. The provider checks
both positions against freshly loaded state, including at the scheduled-end cap
and after Undo. Undo appends a compensating event and never removes its target
or rewrites history.

Deploy migration `0019` before the application version that issues
generation-bound invitations. Generationless participant and invitation JWTs
from the previous application remain usable only while that role is still at
generation zero. Creating a new role invitation or explicitly releasing the
role advances its generation; from that point, the database refuses an
unregistered generationless claim for that role. This is the bounded rolling
transition and the fail-closed boundary after release. The migration is
additive and does not alter migrations `0013` or `0014`.

JWT verification proves the credential was signed, scoped, and unexpired; it
does not make the JWT itself revocable. CurlCast checks the stored claim and
generation before participant writes and LiveKit issuance, then checks again
after LiveKit signing so a release that wins that race prevents the credential
from being returned. LiveKit participant removal is separate evidence: a
committed database release succeeds even if provider cleanup is unconfirmed,
and the organizer sees that warning. Self-hosted or cached already-issued
LiveKit tokens are not claimed to be invalidated; generation-specific identity
and application authorization prevent future authority, while provider
disconnect remains independently observable.

Consumed invitation rows retain each assigned positive generation as durable,
non-secret provider-identity evidence. End Game and deletion cleanup read that
history after application claims are cleared, explicitly remove every recorded
generation identity plus both legacy identities, and only then request room
deletion. A retry repeats the same complete identity set; already-missing
participants and an already-deleted room are successful provider responses.
`DeleteRoom` alone is not treated as proof that cached credentials were revoked.

Deploy migration `0017` before the application version that calls
`write_game_state` or the config-snapshot schedule overload. The deployed
nine-argument schedule signature remains executable and now advances the same
state version. During a rolling migration-first transition, older application
instances can still issue legacy direct active-state updates; those writes
remain terminal-protected but do not gain expected-version conflict protection
until all application instances are updated.

Deploy migration `0018` before the deletion route that reads and records its
cleanup status. The existing boolean delete/restore RPC signatures remain
compatible during migration-first rollout, and the existing deleted-game list
RPC remains available. Migration `0018` backfills pending cleanup rows for
legacy deletions; its new enriched, service-only trash-list RPC makes pending or
failed cleanup reachable after a reload. Database deletion never claims that
LiveKit teardown succeeded: it creates a separate pending record, and only a
successful provider call can advance that record to complete. A committed
deletion with unconfirmed provider cleanup returns an accepted response rather
than being reported as an uncommitted failure. The trash retry control uses a
cleanup-only PATCH operation which never calls the deletion mutation or changes
deletion metadata/audit. Cleanup reads and writes require the game to remain
deleted. If restore commits first, a stale retry is rejected before provider
cleanup; if cleanup begins first, restore still exposes only the already-closed
terminal state and the final cleanup write cannot update a restored game.
Repeating DELETE retains its normal delete semantics.

The legacy `camera_assignments`, `sponsor_display_sessions`,
`sponsor_display_settings`, and `game_sponsors` tables have no application
writer in this baseline. Migration `0021` activates `broadcast_sessions` as a
service-only provider-operation journal. The user-visible broadcast flag is
still mirrored into `game_states.state` only after provider evidence reaches
live or stopped. Completion also creates the separate pending cleanup record;
provider cleanup is retried without changing the frozen result.

## Result and authorization contract

The result is derived only from `score_events`, excluding events targeted by
append-only Undo records. With no active scored ends it stores `no_result` and
`No result recorded`, with `totals: null`; equal scored totals are a reviewed,
confirmable tie. The snapshot stores names and schedule identifiers needed by a
later summary, but no tokens, claims, device identifiers, provider credentials,
RTMP keys, or LiveKit participant data.

Each review is bound to a monotonic PostgreSQL sequence revision. Relevant
score, participant/config, or schedule changes advance that revision. Completion
rechecks both the revision and derived result while holding the game lock, so a
conflict rolls back without partial state.

Account credentials can only be constructed by the server-side boundary after
Supabase `auth.getUser()` validates the session and the user has a confirmed
email. SQL independently requires that same verified auth user to have an
active profile and active same-organization owner or team-admin membership. A
server assertion for a cryptographically verified same-game organizer token is
also accepted. Scorers, inactive or unverified accounts, cross-organization
accounts, participant tokens, cameras, invitations, invalid tokens, and
cross-game tokens are denied. Authorization runs before the idempotent lookup,
so legitimate retries work without making completion public.

## Disposable PostgreSQL verification

The transaction integration suite requires `psql` and a disposable local
database with migrations `0001` through `0019` already applied. For plain local
PostgreSQL, apply `supabase/test-support/completion_postgres_prerequisites.sql`
first. That test-only bootstrap creates only the `anon`, `authenticated`, and
`service_role` roles (including Supabase's `BYPASSRLS` property for the latter)
plus the `auth.users` and `storage.buckets` catalog surface needed by these
migrations. It does not emulate Supabase Auth, Storage object policies,
PostgREST, or hosted infrastructure and must never be applied to a shared or
production database.
The database hostname must be `localhost`, `127.0.0.1`, or `::1`, and its name
must contain `test` or `disposable`; otherwise every integration case is
skipped.

One reproducible PowerShell setup, run from the repository root with either an
existing local PostgreSQL installation or an extracted official binary archive,
is:

```powershell
$curlcastPgRoot = "C:\path\to\isolated-postgresql"
$curlcastPgBin = Join-Path $curlcastPgRoot "pgsql\bin"
$curlcastPgData = Join-Path $curlcastPgRoot "completion-data"

& (Join-Path $curlcastPgBin "initdb.exe") -D $curlcastPgData -U postgres -A trust --encoding=UTF8 --locale=C
& (Join-Path $curlcastPgBin "pg_ctl.exe") -D $curlcastPgData -l (Join-Path $curlcastPgRoot "completion-postgres.log") -o "-h 127.0.0.1 -p 55439" start
& (Join-Path $curlcastPgBin "createdb.exe") -h 127.0.0.1 -p 55439 -U postgres curlcast_disposable_test
& (Join-Path $curlcastPgBin "psql.exe") -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55439 -U postgres -d curlcast_disposable_test -f supabase/test-support/completion_postgres_prerequisites.sql
Get-ChildItem supabase/migrations/*.sql | Sort-Object Name | ForEach-Object {
  & (Join-Path $curlcastPgBin "psql.exe") -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55439 -U postgres -d curlcast_disposable_test -f $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" }
}

$env:Path = "$curlcastPgBin;$env:Path"
$env:CURLCAST_DISPOSABLE_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/curlcast_disposable_test"
npm test -- supabase/migrations/game_completion_postgres.integration.test.ts supabase/migrations/claim_generation_postgres.integration.test.ts

& (Join-Path $curlcastPgBin "dropdb.exe") -h 127.0.0.1 -p 55439 -U postgres curlcast_disposable_test
& (Join-Path $curlcastPgBin "pg_ctl.exe") -D $curlcastPgData stop
```

The integration command is:

```text
npm test -- supabase/migrations/game_completion_postgres.integration.test.ts supabase/migrations/claim_generation_postgres.integration.test.ts
```

The tests create durable fixture rows, so discard or reset the database after
the run. Interactive transactions hold row locks until the test explicitly
releases them, while separate observer connections verify blocked lock state in
`pg_stat_activity`. This deterministically covers writer-first and
completion-first ordering, concurrent completion retries, and both orderings of
ordinary state writes and schedule/revision writes against
`append_score_event`. The claim-generation suite additionally holds one claim
transaction at its synchronization marker, observes the competing session
waiting on a PostgreSQL lock, then proves single-winner consumption,
same-device retry idempotency, replacement invalidation, release/reclaim, and
closed/completed/deleted refusal.

Product backlog order is scoring and sponsor reliability first, followed by the
YouTube integration, then broader UI polish. YouTube implementation is outside
this scoring-integrity slice.
