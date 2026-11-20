# Completed result corrections

Completed games show their saved scores directly in the Games list. Owners and
team administrators can use **Edit game** to correct end scores, add or remove a
last end, or record that no result was played. Each correction requires a reason.
The game remains completed, with its original completion date and YouTube link.

## Data and authorization

Migration `0076_completed_result_corrections.sql` adds an append-only correction
ledger. It preserves `game_completions`, `score_events`, camera assignments and
broadcast cleanup. Current result projections derive from the latest correction,
falling back to the original completion. It also restores the completion score
and replay columns omitted by the hierarchy query in migration 0042.

`GET` and `PATCH /api/games/[id]/result` require a server-verified account. The
service-only database functions independently require an active, verified owner
or team administrator in the game's organization. Scorer, game-operator and
organizer-link credentials cannot correct final results.

A correction supplies ordered end scores, a reason, a request UUID and the
expected result revision. The database validates and derives totals and outcome,
then serializes changes with the existing game lifecycle locks. A stale revision
requires an explicit reload and review of the retained draft. An uncertain save
retries the same request and payload; a committed retry returns the current
canonical result without inserting another correction.

## Deployment and verification

Apply migration 0076 before deploying the editor. Its transaction fails closed
if the completion-summary or public-team result projection differs from the
expected definitions. Prerequisites are migrations through 0075 and the existing
game result revision table. No production score needs to be changed to install it.

Run the repository's five required validation commands. For database behavior,
apply all migrations to a disposable loopback PostgreSQL database and set
`CURLCAST_DISPOSABLE_DATABASE_URL`; then run:

```text
npm test -- supabase/migrations/completed_result_corrections_postgres.integration.test.ts
```

The database cases cover authorization, immutable history, derived projections,
idempotent retry, conflicts and lifecycle lock ordering. The client and route
tests cover validation, uncertain outcomes and preservation of drafts.
