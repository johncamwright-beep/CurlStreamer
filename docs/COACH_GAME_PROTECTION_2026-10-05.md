# Rideau Trillium coaching game investigation

Read-only production audit on October 5, 2026 found that the third scheduled
game retained both the morning and evening coaching attempts. The morning shots
were not overwritten. Following the user's explicit request to separate the games,
the recovery and database protection below were applied to production.

## Evidence

Team Benning, Rideau Trillium, event starting October 2. All times below are
America/Toronto on October 3, 2026.

| Record                                | Observed evidence                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Third scheduled game vs Team Mercedes | Scheduled 11:15 a.m.; current game number is null. Game ID `d4909708-4e33-4ed6-8909-2b3d4d3b12e3`.                                                 |
| Morning scoring                       | Revisions 1–57, 56 distinct shot IDs, ends 1–7; last save 1:42:48 p.m.                                                                             |
| Evening scoring on the same game      | Revisions 58–120, 63 distinct shot IDs, ends 8–15; first save 6:00:28 p.m. None reused the morning shot IDs. No removal commands in either period. |
| Private lifecycle                     | Only one lifecycle command: finish at revision 121, 8:17:31 p.m. No earlier finish or reopen recorded for this session.                            |
| Game four vs Team Noseworthy          | Scheduled 5:15 p.m.; game ID `c8b19da4-cb4f-402e-ae0c-428d4eff459b`. No private coaching session present.                                          |
| Shared game status                    | Both game records remain active, without shared completion timestamps. Shared status is independent of the private coaching finish action.         |

Evidence source: narrowly scoped SELECT queries against `events`, `games`,
`curlcoach_sessions`, and `curlcoach_commands`, through the signed-in Supabase
SQL editor. Private note text and credentials were not exported. Session under
review: `5a673cef-fec2-43ab-b79d-d32fc64c2e3b`.

The pattern strongly supports game four being charted as a continuation of game
three. It does not establish which browser clicks occurred or whether a finish
attempt failed before reaching the backend. Missing game number is observed,
but its cause was not established. Revision 57 preserves the morning snapshot.
The evening sequence has eight attempts in each of ends 8–14 and seven in end 15. The authorized recovery maps these to game four, ends 1–8.

## Completed production recovery

`scripts/repair-rideau-coach-games.sql` and the closed-game trigger were executed
together in one transaction through the signed-in SQL editor. Preconditions
checked the exact source revision, target absence, event/team boundary, and
non-overlapping shot IDs. Both records were locked for the repair.

- Game three: closed, revision 186, 56 current shots, ends 1–7.
- Game four: closed, revision 64, 63 current shots, ends 1–8.
- All 121 original source commands and snapshots remain immutable. Removal
  commands supersede only the 63 evening attempts in game three. New game-four
  commands retain shot IDs, original attempt times, notes, grades and other
  shot fields, with only the end number offset by seven. No evening video flags
  or video metadata were present.
- Immutable lifecycle payloads record repair ID `rideau-games-3-4-2026-10-05`,
  reason, source/target IDs and source revision interval. The maintenance action
  retains the original private coach scope and explicitly identifies its repair
  provenance; it is not represented as ordinary newly entered scoring.
- The transaction compared all derived morning shots with revision 57 and all
  evening shots with the original commands before committing. Post-commit SELECT
  verified the counts, end ranges, closed states and enabled database trigger.
- No shared Streamer game, broadcast, account, billing or deployment state changed.
  The repair refuses to run twice or after unexpected concurrent changes.

The database guard is live, including for older browser clients. An administrative
correction now requires a deliberately reviewed maintenance procedure; ordinary
reopen requests cannot bypass the lock. Migration 0072 safely reapplies the guard.

## Prepared protection changes

Separate worktree `C:/Users/john/.codex/worktrees/coach-game-protection/CurlStreamer`,
branch `codex/coach-game-protection`, based on
`bfe038575791a0a01f2f55c047e6df91e398abc7`. Original prototype and other active
Streamer worktrees remain unchanged.

- Closed private sessions remain review-only, with no ordinary reopen control.
  API rejects reopen and writes against a completed/closed/deleted shared game.
- Migration 0072 adds a database trigger preventing writes against
  completed shared games or closed private sessions. It locks the shared game
  row while checking, so a concurrent completion cannot race past the guard.
  Existing immutable command history remains intact. This guard is live.
- On opening production scoring, prefer the nearest open scheduled game within
  the last four hours or next hour, otherwise the earliest upcoming game. Closed
  private sessions are excluded. No mid-draft automatic switch is performed.
- Browser tracking resumes older than four hours do not choose the initial
  event. Recent/unscheduled tracking retains its existing resume behavior.
- While a later scheduled game is due, the earlier selection becomes review-only
  in the UI. The selector remains available to move to the intended game.
- Existing independent Streamer scheduling, scoring, billing, ownership, and
  broadcasting are unchanged. The old prototype is not the deployment source.

The application changes remain unmerged and undeployed, respecting the earlier
explicit instruction to preserve work without merging or deploying yet. The live
database protection and record separation were authorized by the later request
to separate the games and prevent recurrence. Schedule selection and the clearer
read-only screen require an application release.

## Validation

Formatting, TypeScript, and `git diff --check` passed. Full unit suite:
1,819 passed, 99 environment-dependent checks skipped. Dedicated Shot Tracker
phone/tablet suite: 32 passed, including approaching-game selection, earlier-game
write controls, closed-session controls, and existing draft/lineup resume flows.
The repair and trigger also passed disposable PostgreSQL WASM validation using
the real 0058 and 0071 migrations and synthetic records. Checks cover exact shot
preservation, atomic abort on changed preconditions, duplicate repair rejection,
immutable history, closed-session rejection, completed-game rejection, ordinary
open-game saves and finishing, and repeatable migration application. Run with
`npm install --prefix work/coach-sql-validation --no-audit --no-fund @electric-sql/pglite`
then `node scripts/validate-coach-repair.mjs`. This optional local validation adds
no production dependency. Multi-connection locking was not simulated by WASM.

Required full browser command also passed: core suite 220 passed / 122 skipped;
connected-account suite 90 passed. Their production builds succeeded. Together
with the dedicated suite, 342 browser tests passed. No existing Streamer
functionality was intentionally disabled or reconfigured by these changes.
