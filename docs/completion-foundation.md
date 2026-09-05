# Completion foundation writer coverage

Migration `0015` installs an internal, service-role-only review and completion
transaction. It does not add a route, server action, page, control, or client
export. Existing `close-game` remains a legacy access-closing state mutation and
does not create a completion, snapshot, or completion audit.

## Writer map

| Writer                                                                                                                                                        | Records affected                                                                           | Completion protection                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_game`, `create_team_game`, and both `create_scheduled_team_game` signatures                                                                           | `games`, `game_states`, creation audit                                                     | Initial state inserts create a database-issued result revision. New games are not completed.                                                                                                                                                                                                                           |
| `write_game_state` via PATCH, claim, release, disconnect, deletion revocation, layout/audio/broadcast/sponsor/camera/connection/health, and legacy Close Game | Whole `game_states.state` and `version`                                                    | Every write supplies the version it read. PostgreSQL conditionally replaces the state and advances the opaque version with the same monotonic rule as scoring. Stale snapshots conflict instead of restoring scores, claims, or other newer state. The terminal trigger remains authoritative.                         |
| `append_score_event` via score, hammer, and Undo                                                                                                              | `game_states` plus append-only `score_events`                                              | The deployed RPC signature is preserved. It locks `game_states` and then `games` before updating state, so result-revision triggers cannot create a game/revision lock cycle. It retains the state-version predicate and then inserts the event. Inserts advance the result revision; updates/deletes remain rejected. |
| `update_scheduled_team_game`                                                                                                                                  | Schedule/config columns on `games`, mirrored config in `game_states`, state version, audit | Both deployed and config-snapshot signatures lock `game_states` before `games`, commit both config representations together, and advance the state version. The snapshot overload changes only `state.config`, so concurrent score and heartbeat fields are preserved.                                                 |
| `soft_delete_team_game` and `restore_team_game`                                                                                                               | `games.deleted_at`, deletion actor, audit; deletion also invokes legacy Close Game         | Completed rows may only change the two deletion fields. Their status, snapshot, result and cleared state remain terminal. Hard deletion of a completed `games` row is rejected.                                                                                                                                        |
| Completion transaction                                                                                                                                        | `game_states`, `games`, one `game_completions` row, one cleanup row, one audit             | Locks `game_states` and then `games`, re-authorizes, validates the immutable review, clears runtime state, freezes the result, and records LiveKit cleanup only as pending. Concurrent/repeated authorized calls return the first completion and its stored review identity.                                           |

`game_states` is the canonical first lock for every operation that also needs a
`games` lock: review, completion, scoring, and schedule editing. A row trigger
cannot establish this order because PostgreSQL locks its target row before
running a `BEFORE ROW` trigger. Direct state writes from the previously deployed
application remain supported and terminal-guarded without acquiring a parent
lock. Requests already holding the state lock finish before completion;
requests that wait behind completion re-evaluate the locked completed row and
are rejected. Migration `0017` adds optimistic concurrency to the current
application without changing that lock order.

Deploy migration `0017` before the application version that calls
`write_game_state` or the config-snapshot schedule overload. The deployed
nine-argument schedule signature remains executable and now advances the same
state version. During a rolling migration-first transition, older application
instances can still issue legacy direct active-state updates; those writes
remain terminal-protected but do not gain expected-version conflict protection
until all application instances are updated.

The legacy `camera_assignments`, `broadcast_sessions`,
`sponsor_display_sessions`, `sponsor_display_settings`, and `game_sponsors`
tables have no application writer in this baseline. Current claims, camera
health, broadcast, sponsor display, and simulated audio state all live in
`game_states.state`. Completion does not mark any dormant provider-session row
as stopped; it creates the separate pending LiveKit cleanup record instead.

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
database with migrations `0001` through `0017` already applied. For plain local
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
npm test -- supabase/migrations/game_completion_postgres.integration.test.ts

& (Join-Path $curlcastPgBin "dropdb.exe") -h 127.0.0.1 -p 55439 -U postgres curlcast_disposable_test
& (Join-Path $curlcastPgBin "pg_ctl.exe") -D $curlcastPgData stop
```

The integration command is:

```text
npm test -- supabase/migrations/game_completion_postgres.integration.test.ts
```

The tests create durable fixture rows, so discard or reset the database after
the run. Interactive transactions hold row locks until the test explicitly
releases them, while separate observer connections verify blocked lock state in
`pg_stat_activity`. This deterministically covers writer-first and
completion-first ordering, concurrent completion retries, and both orderings of
ordinary state writes and schedule/revision writes against
`append_score_event`.
