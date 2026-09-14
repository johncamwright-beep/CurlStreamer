# CurlCoach isolated development

Status: first local shot-charting slice implemented, September 13, 2026.
This is a synthetic local lab, not a production coaching service.

## Isolation

- Worktree: `C:/Users/john/.codex/worktrees/e76d/CurlStreamer`.
- Branch: `codex/curlcoach`; baseline: `6ced1d19f9a486058cc23535480f3cd570985946`.
- The shipping checkout at `C:/GITHuB/CurlStreamer` remains on `main`. Never
  switch, edit, clean, or install dependencies there for CurlCoach work.
- [Module plan](curlcoach-plan.md) and [tracker mapping](curlcoach-shot-tracker-mapping.md)
  remain byte-for-byte copies of the original untracked documents. The workbook
  has not been copied or opened during development. Do not commit workbooks,
  completed trackers, private event data, or credentials.
- No shared migrations, database links, broadcasts, deployments, pushes, or
  merges. Future database work must use a disposable local service.

## Run the local lab

Dependencies are installed in this worktree. Node is available through the
bundled desktop runtime; a local npm launcher is in the ignored
`.curlcoach-local` directory. For this machine:

```powershell
Set-Location 'C:/Users/john/.codex/worktrees/e76d/CurlStreamer'
$env:PATH = 'C:/Users/john/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin;C:/Users/john/.codex/worktrees/e76d/CurlStreamer/.curlcoach-local;' + $env:PATH
$env:CURLCOACH_ENABLED = 'true'
$env:CURLCOACH_LOCAL_LAB = 'true'
# Choose your own local-only key, at least 32 characters; enter it in the lab.
$env:CURLCOACH_LAB_SECRET = 'replace-with-your-local-only-key-at-least-32-characters'
npm run dev -- --hostname 127.0.0.1 --port 3010
```

Open `http://127.0.0.1:3010/curlcoach` and enter the local key. On another
machine, install a compatible Node.js LTS/npm and run `npm ci` first; omit the
machine-specific PATH line. Do not copy shipping `.env.local`, pull deployment
variables, or use real service credentials. Use a fresh terminal without
inherited service configuration. The CurlCoach route bypasses Supabase Auth
and uses its own signed local session, scoped to the synthetic organization,
game, and coach. Other application routes retain their existing authentication.

`CURLCOACH_ENABLED` and `CURLCOACH_LOCAL_LAB` must both be exactly `true`, and
the key must contain at least 32 characters. Missing or invalid configuration
returns 404 before reading/writing coaching data. Production always returns
404, even if flags are enabled. No navigation or invitations are added to the
shipping application. This local key is not a replacement for real coach
membership authorization; that remains a later milestone.

## What works

- Four named synthetic players plus an alternate, with throwing position stored
  on each attempt for substitutions; ends 1–20 and two stones per position.
- Workbook vocabulary for one shot type, turn/target, independent execution and
  nullable numeric 0–5 grade, deficiency, review category, and private note.
- Explicit picks, burnt rocks, and throw-through exclusions.
- Player/team percentages, graded/recorded counts, missing grades, exclusions,
  corrections, removals, and Undo through append-only revisions.
- Stable request IDs in the API and revision conflict checks prevent duplicate
  retries or stale overwrites. A lost response requires reload before retrying;
  there is no offline queue in this slice.

Data stays under ignored `.curlcoach-local/practice/shot-events.json` with
local lock and temporary files. Malformed stored data fails closed; it is not
silently reset. A crash can leave `shot-events.lock`; stop only this worktree's
lab, inspect the directory, and remove that specific stale lock before retrying.
Never clear a lock while a local writer is running. `CURLCOACH_LAB_STORAGE`
may select a subdirectory within `.curlcoach-local`; paths outside it are rejected.

The roster/profile are fixed synthetic fixtures, not an editable roster service.
Reports use underlying grades, not averages of rounded percentages. Numeric
zero counts; missing grades, exclusions, and unthrown stones are not misses.
A review category is metadata only; replay flags, audio mute, exports, and
season reports are not implemented. The provisional scoring profile does not
claim native workbook parity.

## Validation

Stop this worktree's dev server before builds or browser tests: they share
`.next`. Required repository commands:

```powershell
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

For a credential-free build, set `NEXT_PUBLIC_SUPABASE_URL` to
`http://127.0.0.1:9`, both Supabase key variables to local placeholders, and
`ROLE_TOKEN_SECRET` to a local-only string of at least 32 characters. Production
selects the Supabase provider; the old example's `CURLCAST_MODE` flags do not
select storage. Do not run a production build with shared credentials.

The existing full E2E command needs ports 3000 and 3101; it refuses existing
servers. Do not stop the shipping application to free them. Defer that suite
if those ports are occupied. The independent CurlCoach test uses port 3012 and
a fresh ignored synthetic data directory on each run:

```powershell
node node_modules/@playwright/test/cli.js test --config playwright.curlcoach.config.ts
```

The dedicated test is skipped in the shipping E2E configuration. It covers
session denial, charting, corrections, revision history, Undo, reload persistence,
phone/tablet overflow, and minimum control heights.
Unit tests cover denominators, zero/missing/excluded grades, duplicate slots,
extra ends, substitutions, retries, stale corrections, disabled flags,
production denial, cross-organization/game/role denial, and same-origin writes.

The initial repository format check reports widespread pre-existing formatting
issues (including CRLF files); keep unrelated reformatting out of this branch.
The copied mapping is preserved exactly even though its table is not Prettier
formatted. See [validation results](curlcoach-validation.md).

## Next milestone

Replace synthetic access with authenticated, persistent coach memberships in a
**disposable local database**. Add editable roster snapshots, scoped coach
invitation claims, durable audited shot records, and explicit cross-team RLS
checks. Preserve default-disabled server gates and public-response privacy.
Validate a completed reference game and numeric grading guidance before claiming
workbook compatibility. Replay calibration and acknowledged real broadcast
mute remain separate later milestones.

## Event workspace (September 13 update)

The left navigation now contains Setup, Scoring, Data tables, Scoreboard analysis,
Team, and Game analysis. Choose **Shorty Jenkins · example** for seven synthetic
eight-end games (448 recorded attempts), or **My practice session** for the
original saved practice data. Existing practice records are preserved.

Data tables and Team combine every game with the selected event ID. Player
filters apply across the event. Game analysis and Scoring select one game;
changing games does not change the event-wide tables. Selection survives reload
through the URL. Corrections and Undo update the event aggregates from current
shot revisions. Per-game data files are namespaced by organization and game.

Workbook sections reproduced include turn/deficiency, family/execution, total
execution, draw/hit deficiencies, subtype shooting, execution distributions,
turn frequencies, shot-by-shot execution and severity/deficiency combinations.
The Team page includes a per-game shooting trend for each player. The workbook's
category denominator includes typed but ungraded attempts; it is shown in a
separate **Workbook category %** column alongside the graded-attempt percentage.
Overall shooting always uses numeric grades. Both methods exclude explicitly
excluded attempts. These are principal-report adaptations, not full Excel
recalculation parity or a copy of every embedded chart.

Scoreboard analysis includes event-wide score-difference/hammer observations
and per-game end scores/timelines. Four or more points are grouped as 4+ and
extra ends are retained. The workbook's 70% advantage target is displayed, but
no advantage percentage is fabricated: its rule and opportunity denominator
remain unconfirmed. The user does not yet have a definition to supply.

### Read-only Streamer connection

Choose **Streamer · local connection** and Refresh event to load event/game
metadata and scoreboard results through the existing account-scoped services.
The adapter requires a loopback Supabase URL (excluding the unavailable port-9
placeholder), a verified signed-in owner/team administrator, and that account's
event and game membership. Production/shared Supabase URLs are rejected before
Auth is contacted. No database is provisioned or migrated automatically.

The same worktree must be configured for a disposable local Streamer service;
sign in through its existing login page. No real service is configured in the
preview today, so this option intentionally displays an unavailable state.
It never silently substitutes the sample results for Streamer data.

Reads use `list_events`, `list_team_hierarchy_games`, and `read_game_state`
through existing service functions; completed results come from the scoped
listing. The adapter exposes only game metadata and scoreboard projections.
Every read/write revalidates the signed-in account. Local shot records are
namespaced per organization/game; the adapter never writes Streamer points.

Charting currently uses the Streamer **home team** and provisional position
identities. Streamer game configuration does not contain a player roster;
Setup explains this instead of presenting the example names as real players.
Editable roster snapshots and full coach memberships remain the next milestone.
