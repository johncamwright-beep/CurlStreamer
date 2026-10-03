# CurlCoach → CurlStreamer integration handoff

Prepared September 13, 2026 from the current local worktree. This document
describes implemented code separately from proposed production integration.
Environment variable names are included without values.

## Ownership and preservation instructions

- Worktree: `C:/Users/john/.codex/worktrees/e76d/CurlStreamer`.
- Branch: `codex/curlcoach`.
- Base commit and current HEAD: `6ced1d19f9a486058cc23535480f3cd570985946`.
- Original shipping checkout: `C:/GITHuB/CurlStreamer`. This task has not changed
  that checkout. Do not switch, clean, reset, or install into it to retrieve this work.
- All CurlCoach implementation is uncommitted. Checking out or cherry-picking
  this branch alone will **not** transfer the implementation. Inspect the working
  tree and include both modified tracked files and untracked additions when
  preparing a future reviewed integration. A normal `git diff` omits new files.
- Preserve source files and ignored local practice records. Do not merge, push,
  deploy, apply shared database migrations, or copy service credentials as part
  of this handoff. No commit, merge, or deployment was made for the handoff.
- CurlStreamer must remain independently usable. CurlCoach is an optional paid
  module, not a prerequisite for login, team setup, scoring, or broadcasting.

## Implemented features

The development-only `/curlcoach` workspace has six pages: Setup, Scoring,
Data tables, Scoreboard analysis, Team, and Game analysis. Desktop/tablet use
left navigation; narrow phones use a compact menu. Event/game selection survives
reload through the URL.

- Synthetic practice game plus a visibly labeled seven-game Shorty Jenkins
  example: eight ends per game and 448 example attempts. Local corrections
  overlay the fixtures without altering Streamer score events.
- Data tables and Team aggregate the selected event's games, including individual
  player filters. Scoring and Game analysis select one game. Player analysis
  includes a per-game trend.
- Compact shot entry: player, throwing position, end, stone, shot type,
  turn/target, execution category, nullable numeric grade, deficiency, review
  category, exclusions, and notes. Fixed synthetic roster includes an alternate.
- Next turn saves before advancing through two stones per position, then the
  next end. Failed saves retain the draft; an already recorded next slot opens
  for correction. The schema permits ends through 20.
- Corrections, removals, and Undo append events. Current shots and percentages
  derive from revisions. API commands have request IDs, revision checks, and
  duplicate position/end/stone protection. This is not an offline queue.
- Reports distinguish numeric zero, missing grades, and excluded attempts.
  Workbook category percentages use a separately labeled denominator. Principal
  tables are adapted from the tracker; complete Excel recalculation parity is
  not claimed. Scoreboard analysis derives score/hammer timelines and extra ends.
  The workbook's advantage target is shown, but its percentage remains uncomputed
  because the advantage rule and denominator are unconfirmed.
- Review checkbox captures `flaggedAt` when tapped, with look-back duration and
  notes. The timestamp currently uses the device clock, without calibration.
  It becomes durable when Save/Next turn succeeds, **not immediately on tap**.
  Next turn clears the flag and note. Current-game review summaries appear on
  Scoring and Game analysis; unmapped flags explicitly show synchronization pending.
- Read-only local Streamer adapter loads authorized event/game metadata and
  scoreboard projections using existing services. No real Streamer database or
  live broadcast has been connected to this preview.

## Uncommitted inventory

Modified tracked files:

| File                | Change                                                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`        | Ignores `.curlcoach-local/` and `.pnpm-store/`.                                                                                                                                                                                                 |
| `src/middleware.ts` | Imports the CurlCoach gate and intercepts only `/curlcoach`, its subpaths, and `/api/curlcoach/` subpaths. Enabled lab requests bypass the normal Supabase middleware path; disabled requests return 404. Other paths retain their prior logic. |

Untracked additions before this handoff:

- `docs/curlcoach-development.md`, `docs/curlcoach-plan.md`,
  `docs/curlcoach-shot-tracker-mapping.md`, `docs/curlcoach-validation.md`.
- `playwright.curlcoach.config.ts`.
- `src/app/api/curlcoach/game/route.ts` and `route.test.ts`;
  `src/app/api/curlcoach/session/route.ts`;
  `src/app/api/curlcoach/workspace/route.ts` and `route.test.ts`.
- `src/app/curlcoach/CoachLab.tsx`, `EventWorkspace.tsx`, `ReviewSummary.tsx`,
  `coach.css`, and `page.tsx`.
- `src/lib/curlcoach/access.ts` and `access.test.ts`; `config.ts`;
  `event.ts` and `event.test.ts`; `model.ts` and `model.test.ts`;
  `next-turn.ts` and `next-turn.test.ts`; `review.ts` and `review.test.ts`.
- `src/lib/providers/curlcoach-local.ts` and `curlcoach-local.test.ts`;
  `curlcoach-streamer.ts` and `curlcoach-streamer.test.ts`.
- `tests/curlcoach/charting.spec.ts` and `event.spec.ts`.
- This handoff adds `docs/curlcoach-integration-handoff.md`.

Ignored files include installed dependencies, Next build output, test output,
local tooling, and `.curlcoach-local/` practice/test storage. They are not a
production artifact. Do not transfer that directory wholesale: it mixes tooling
and saved data. Preserve local practice data in place. The two copied planning
documents were preserved byte-for-byte; older development notes describe earlier
milestones and are superseded by this handoff where they differ.

## Setup and dependencies

1. Work only in the worktree named above. Dependencies are already installed on
   this machine. For a separately prepared checkout, use its existing lockfile
   and `npm ci`; do not add packages merely to run this slice.
2. Use a compatible Node.js/npm runtime. This machine's Node directory is
   `C:/Users/john/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`;
   an npm launcher exists under the ignored `.curlcoach-local` directory.
3. Configure the local lab through `CURLCOACH_ENABLED`, `CURLCOACH_LOCAL_LAB`, and
   `CURLCOACH_LAB_SECRET`. Inspect `src/lib/curlcoach/config.ts` for the gate
   contract. The signing key must be locally generated and at least 32 characters.
   Production is always denied by the current implementation.
4. Optional `CURLCOACH_LAB_STORAGE` chooses a subdirectory beneath
   `.curlcoach-local`; paths outside that root are rejected.
5. Run `npm run dev -- --hostname 127.0.0.1 --port 3010`, then open
   `http://127.0.0.1:3010/curlcoach`. Enter the locally configured key through the
   unlock form. The preview was restored on this address after the latest tests;
   check whether the port is already occupied before starting another instance.
6. Sample mode needs no Supabase, YouTube, or LiveKit service. For the separate
   read-only Streamer option, provision a disposable local Supabase instance,
   configure existing Streamer variables, and sign in through Streamer's existing
   login. The adapter rejects non-loopback services and the unavailable build
   placeholder endpoint before contacting Auth. Do not import shipping credentials.

Environment names relevant to this handoff:

| Names                                                                                     | Purpose                                                                                   |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `CURLCOACH_ENABLED`, `CURLCOACH_LOCAL_LAB`, `CURLCOACH_LAB_SECRET`                        | Development gate and separate synthetic session.                                          |
| `CURLCOACH_LAB_STORAGE`                                                                   | Worktree-local data namespace.                                                            |
| `CURLCOACH_E2E`                                                                           | Dedicated browser test selection.                                                         |
| `NODE_ENV`                                                                                | Production denial and normal application runtime behavior.                                |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Existing Streamer Supabase configuration; only disposable local service for this adapter. |
| `ROLE_TOKEN_SECRET`                                                                       | Existing Streamer build/application configuration.                                        |

No package manifest or lockfile changed. The module reuses Next.js/React,
TypeScript, Zod, JOSE, existing Supabase helpers, and Node filesystem/crypto APIs.
Tests reuse Vitest, Playwright, and Prettier. The browser config uses installed
Microsoft Edge on Windows and Chromium elsewhere, with phone/tablet emulation.
No YouTube player SDK, OCR service, timing worker, billing SDK, or recording
download dependency was added. Local file storage requires a Node runtime and
is unsuitable for a stateless production deployment.

## Authentication, ownership, and duplication audit

| Area                  | Current behavior and required integration boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                 | A **separate lab-only** key exchange issues a four-hour signed JWT cookie named `curlcoach-lab-session`, scoped to synthetic identity/organization/game/coach role. It has no users, passwords, invitations, or account recovery. Its cookie path is application-wide, but its checks are confined to Coach code. No Streamer login/signup page changed. Replace this synthetic access path with Streamer's existing session in production; do not establish a second production identity system. |
| Teams                 | No team or membership writes or duplicated database tables. The adapter reuses `loadActiveTeam` and existing account-scoped hierarchy services. It requires an active user and exactly one active team membership, with owner or team-admin role. Scorers/viewers and ambiguous multiple memberships are refused. This is a prototype restriction, not a completed coach-role policy.                                                                                                             |
| Team side and players | The adapter assumes the charted side is home. That is not sufficient to prove the customer's team is always home. Roster IDs/names are provisional fixtures, not Streamer players. Integration must resolve the authorized team's actual side and store per-game roster snapshots with stable player IDs.                                                                                                                                                                                         |
| Subscriptions         | No paid entitlement checks, prices, checkout, billing records, or subscription changes exist. An enabled lab flag is not proof of payment. Integrate with Streamer's canonical commercial entitlement source; confirm its current schema before designing additions. Do not confuse LiveKit media subscriptions with billing.                                                                                                                                                                     |
| Storage               | Separate **development-only** append-only JSON coaching store. No writes to Streamer game scores. Replace the file provider with organization/team/game-scoped durable storage and database authorization. Keep coaching notes out of public scoreboard/broadcast responses.                                                                                                                                                                                                                      |
| Deployment            | No deployment files, Next configuration, package scripts, or production environment files changed. Current middleware deliberately returns 404 for Coach in production. A production paid module needs a new authorization/entitlement gate, not removal of the guard alone.                                                                                                                                                                                                                      |

Every workspace read/write revalidates source selection and, for Streamer mode,
the signed-in account and scoped event/game membership. Reads reuse
`listEvents`, `listTeamHierarchyGames`, and `read_game_state`; completed results
come from the authorized listing. The privileged client stays server-side.
Writes use Zod validation, same-origin checks, and per-game revision checks.
The legacy `/api/curlcoach/game` remains a synthetic practice endpoint, whereas
`/api/curlcoach/workspace` carries source/event/game selection. Consolidate that
duplication during production integration rather than retaining two authorities.

## Database migrations

**None added or applied.** Existing Supabase migrations are unchanged. No new
coaching tables, RLS policies, RPCs, entitlement tables, or synchronization tables
exist. Sample mode does not need migrations. A disposable Streamer database
must use that project's established setup; this handoff does not authorize
running its migrations against a shared environment.

Proposed additive schema work, subject to the current Streamer schema:

- Coach permission/entitlement linkage to existing organizations and memberships;
  avoid duplicating accounts, teams, or subscription ownership.
- Game roster snapshots and append-only shot/flag revisions with stable request
  IDs, revision concurrency, and organization/team/game foreign keys and RLS.
- Broadcast timing anchors/segments and versioned flag resolutions, with source
  provenance and uncertainty. Keep original flag timestamps immutable.
- Explicit retention/export/access policy when a paid entitlement expires;
  expiry must not delete coaching data or disable core Streamer capabilities.

## Tests and known failures

Latest shot-review implementation validation, before this documentation-only handoff:

- `npm run typecheck`: passed.
- `npm test`: **652 passed, 25 skipped**, across 111 passing test files. Optional
  PostgreSQL integration tests lack a disposable database.
- Dedicated CurlCoach browser config: **4 passed**, phone and tablet. Covers
  charting, corrections, audited Undo, persistence, compact controls, Next turn,
  failed-save behavior, review timestamp/notes/look-back persistence, event
  navigation/aggregation, and unavailable Streamer source.
- `npm run build`: passed; existing camera hook, image element, and unused media
  variable warnings remain.
- `npm run format:check`: **287 files reported**, existing repository CRLF/style
  issues including the intentionally preserved tracker mapping. No broad format
  changes were made. `git diff --check` passed.
- Earlier full `npm run test:e2e`: first configuration had **84 passed, 22 skipped,
  10 failed**. Failures were `tests/vertical-slice.spec.ts` and
  `tests/broadcast-layout.spec.ts`, which wait for anonymous Create game while
  the app shows Sign in. A later rerun reproduced those failures and was stopped
  before all repeated timeouts. The separate YouTube/dashboard/game-setup
  configuration passed **18 tests** earlier. These are historical results,
  not a claim that the complete suite passed after the latest changes.
- No actual YouTube broadcast, timing calibration, paid entitlement, production
  coach membership, or real database integration has been verified.

Run required commands sequentially. Unit HTTP tests, builds, and browser servers
share `.next`; concurrent runs previously collided. Stop only this worktree's
preview first. The dedicated browser command is:

```sh
node node_modules/@playwright/test/cli.js test --config playwright.curlcoach.config.ts
```

It uses port 3012 and an isolated synthetic storage directory. The normal E2E
configs use ports 3000 and 3101; do not stop an independently running Streamer
instance to free them. For builds, use disposable/local placeholder configuration
for the existing Supabase and role-token variable names, never production secrets.

## Real-time flag timing: required mapping

**User requirement:** the coach watches the ice in person and taps a flag as the
shot happens. The coach must not watch a delayed player, enter video seconds,
estimate latency, or calibrate a delay. The summary should open the corresponding
recording moment, beginning the requested number of seconds before the flag.

Current `flaggedAt` is a client ISO timestamp captured on the checkbox event.
`videoReview` holds a URL, nullable position, and look-back duration. A leftover
optional `delaySeconds` field and corresponding helper arithmetic exist from an
earlier manual-delay approach; there is **no manual-delay control in the final
UI**. Do not adopt that field as the synchronization design or add delay twice
when consuming an already resolved position. The current UI does not populate
verified video positions, and new flags remain pending. Older review categories
can appear in the summary without timestamps and require separate handling.

The existing pipeline has LiveKit web egress in
`src/lib/providers/livekit-egress.ts`, broadcast lifecycle/session information
in `src/lib/broadcast-session.ts`, YouTube integration in
`src/lib/providers/youtube-live.ts`, and scoped watch URL reads in
`src/lib/dashboard-broadcasts.ts`. Session/watch URL records do **not** currently
provide a verified source-capture-time to archived-video-position mapping.

Implement source timing references and match them to the recording timeline.
Investigate synchronized capture timestamps or machine-readable timing markers
and their recoverability through this actual pipeline. A timestamp added only
at broadcast render time must account for upstream camera/transport delay;
server arrival time is not automatically scene capture time. A YouTube start
timestamp or player distance from the live edge is not sufficient evidence of
the correspondence. Player timing API reference:
https://developers.google.com/youtube/iframe_api_reference

Streamer should own and persist verified timing anchors by organization, game,
broadcast session, video ID, and uninterrupted segment. Include source UTC,
recording offset, valid range, measurement method, uncertainty, verification
status, and mapping version. Synchronize the coach clock with a server reference,
record the estimate/error bound, and distinguish original tap time from server
receipt time. Resolve pending flags when their footage arrives. Handle stream
restart/gaps, camera changes, replacement videos, and the final archive without
extrapolating an old mapping across unverified segments.

Proposed authenticated contract (new, not implemented):

- Clock reference endpoint for client/server offset and round-trip estimation.
- Game-scoped resolution request: `gameId`, `flagId`, `flaggedAtUtc`,
  `lookBackSeconds`, clock-calibration reference and uncertainty. Resolve tenant
  authority from the authenticated session, not a caller-supplied organization.
- Response: `status` (ready/pending/unavailable), `reason`, `videoId`,
  `broadcastSessionId`, `segmentId`, `shotPositionSeconds`,
  `reviewStartSeconds`, `reviewUrl`, `mappingVersion`, `accuracyMs`, `resolvedAt`.
  Pending/unavailable responses must not supply a plausible-looking fake URL.
- Once mapped, review start is mapped shot position minus look-back, clamped
  within a verified playable segment. Report gaps or unavailable pre-roll.
- Persist versioned resolutions separately from original shot/flag revisions.
  Supply polling or an existing subscription mechanism to update pending flags;
  revalidate against the final archived timeline. Do not mutate the tap time.

Acceptance requires an actual instrumented broadcast: compare visible known
events with flag links and report measured error. Automated tests must also
cover clock skew, changing latency, paused/buffered viewers, restart gaps,
multiple videos, flags preceding available footage, archive changes, and tenant
isolation. Label synthetic timing tests as simulated. If reliable anchors cannot
be recovered with current infrastructure, document the exact missing capability.

## Proposed integration sequence and paid-module boundary

1. Preserve and review this uncommitted work alongside the current Streamer
   baseline. Resolve overlapping changes explicitly; do not replace Streamer
   middleware wholesale or transfer local data/configuration.
2. Reuse Streamer authentication and membership selection. Add a server-side
   optional CurlCoach entitlement plus explicit coach permissions. Hide or offer
   upgrade navigation when appropriate, and enforce access on every Coach API.
3. Move the file provider behind durable scoped storage. Resolve team side and
   roster identities from canonical ownership; do not turn sample identities into
   production members. Keep synthetic mode clearly separate.
4. Connect event/game/scoreboard reads through existing provider boundaries.
   Preserve standalone Streamer scoring, Undo, cameras, sponsors, and broadcasts.
5. Add Streamer's timing mapping contract, then wire CurlCoach flags and summaries
   to it. Consider immediate durable flag capture so a tap survives navigation
   before the rest of the shot is saved; use idempotency and auditable revisions.
6. Test enabled, disabled, unpaid, expired, and cross-team states. Core Streamer
   must work without Coach migrations/services/workers or a Coach subscription;
   Coach failure must not interrupt a broadcast. Private notes stay private.
7. Return a reviewed API/schema handoff and validation evidence. Merging,
   production migration, and deployment remain separate future actions.
