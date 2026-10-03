# CurlCoach local milestone validation

September 13, 2026. Branch `codex/curlcoach`, baseline
`6ced1d19f9a486058cc23535480f3cd570985946`.

## Completed checks

- TypeScript: passed, including the new routes, model, provider, UI and tests.
- Event-workspace full unit run: 647 passed, 25 skipped (optional PostgreSQL
  integration tests have no disposable database configured). A subsequent
  focused Streamer check also passed, including no-result handling.
- Production build: passed. Existing camera/media lint warnings remain.
- Independent CurlCoach browser suite: 4 passed (phone and tablet), including
  charting, correction, readable history, removal, audited Undo, persistence
  after reload, no horizontal overflow, controls at least 44px high, six-page
  navigation, all-seven-game aggregation, player/game filters, and an explicit
  unavailable state for the disconnected Streamer source.
- Separate YouTube/dashboard/game-setup fixture suite: 18 passed.
- Changed CurlCoach files and middleware: Prettier check passed.
- `git diff --check`: passed.
- Both copied planning document hashes still match the original checkout.

## Repository baseline issues

`npm run format:check` reports 287 files, predominantly existing CRLF/style
issues. The original tracker mapping is also unformatted and is intentionally
preserved byte-for-byte. No broad reformatting was performed.

The earlier `npm run test:e2e` completed its first configuration with 84 passed, 22 skipped,
and 10 failed. Every failure is in `tests/vertical-slice.spec.ts` or
`tests/broadcast-layout.spec.ts`, on desktop and mobile. They navigate to `/`
and wait for an anonymous **Create game** button, while the app renders
**Sign in**. These unchanged tests still assume the older anonymous mock flow.
The new middleware branch applies only to `/curlcoach` and `/api/curlcoach/`.
The combined command uses `&&`, so its YouTube configuration was then run
separately. These failures mean the repository suite is not fully green.

The event-workspace regression rerun again passed the 84 active modern tests
and reproduced the old anonymous Create game timeouts. It was interrupted
after those known failures, before repeating every remaining timeout. The
YouTube/dashboard/game-setup configuration was run separately and passed all
18 tests. A first concurrent unit/browser attempt collided in `.next`; the
subsequent serialized full unit run passed. Run those suites sequentially.

## Compact scoring follow-up

Scoring fields now use a tighter responsive grid while retaining 44px touch
targets. Next turn saves the current attempt before advancing through both
stones for each throwing position, then to the next end. A failed save keeps
the draft in place; an already recorded next slot opens for correction.
The full unit suite passed 649 tests (25 skipped), and all four CurlCoach
phone/tablet browser checks passed, including save failure and advancement.

## Scope limits

### Real-time review flags

Each shot can now retain a flag timestamp captured at the coach's tap, a
look-back duration, and notes in the existing append-only shot history.
Next turn clears the flag and notes. Scoring and Game analysis show the current
game's review list. Older records remain readable. Flag timestamps currently
use the coach device clock; there is no calibrated source clock in this lab.

Automatic real-world-to-YouTube synchronization is **not implemented**. The
current broadcast session exposes a watch URL but no verified camera-capture
timestamp to recording-position mapping. Broadcast start time or a player's
distance from the live edge alone cannot establish that mapping. The UI does
not ask the coach to estimate latency and does not fabricate review links.
Unmapped flags show synchronization pending. A production integration needs
clock synchronization plus source timing references matched to the recording,
including separate timeline segments after stream restarts. The review-link
helper accepts recording positions once such a mapping exists; it is covered
by tests but is not supplied live timing by this preview.

This milestone uses synthetic identities and a local signed coach session.
The read-only Streamer adapter uses verified local owner/team-admin access and
account-scoped event/game listings; it is tested with mocks, but no actual local
Streamer database is configured. Shared service URLs are refused. Streamer game
records do not provide a player roster, so identities remain provisional.
Real coach memberships/invitations, editable rosters, database RLS, offline syncing,
replay timing, broadcast audio, and workbook recalculation parity are future
work. No shared database, deployment, real credentials, or workbook/event data
was used. All changes remain in this worktree and have not been pushed or merged.
