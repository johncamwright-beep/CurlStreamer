# Easy-shot equivalent index

Traditional shooting remains the primary statistic. `model.report`, Standard Curl Canada categories, workbook calculations, CSV exports and append-only shot events are unchanged.

## Recorded difficulty

The existing optional call difficulty is reused in both Standard and Enhanced entry:

| Display                        | Stored value     | Provisional expected shooting |
| ------------------------------ | ---------------- | ----------------------------- |
| A — Easy (Routine)             | `routine`        | 85%                           |
| B — Moderate (Demanding)       | `demanding`      | 70%                           |
| C — Difficult (Very demanding) | `very_demanding` | 55%                           |

Difficulty describes the intended call, not its outcome. Nothing is inferred from shot type, position, execution, grade or missing observations. No migration or historical backfill is required. Existing supplemental storage and correction controls save and clear this field.

## Calculation and configuration

`src/lib/curlcoach/difficulty.ts` is the shared calculation and formatting utility. `difficulty-benchmarks.json` defines one versioned set for every player, using the 85% easy-shot expectation as the reference. Future competition-derived sets can use the same validated configuration contract.

- Eligible: nonexcluded shots with a valid recorded 0–5 grade.
- Classified: eligible shots with a valid current A/B/C call observation.
- Expected points: sum of each classified shot's expected percentage × 5.
- Above expected (pp): `(actual points − expected points) / (5 × classified shots) × 100`.
- Easy-shot equivalent: 85 + above expected. This is the classified shooting percentage plus 0 points for each easy shot, 15 for each moderate shot, and 30 for each difficult shot, averaged over the classified shots.
- No cap; rounding to one decimal occurs only for display. No classified shots means N/A.
- Coverage uses classified / eligible graded shots. Missing or unavailable difficulty never becomes a success, failure or A classification.

Counts, mix, classified-subset actual and expected percentages accompany detailed views. Fewer than ten classified shots is a small sample; fewer than twenty is tentative. Comparisons are descriptive, not significance tests. These illustrative assumptions are not official Curling Canada averages; the adjusted percentage is an index, not a probability.

## Integration and compatibility

- Charting's existing player/team summaries show a smaller secondary figure.
- Shot performance and game analysis use existing event, game, season, player and shot filters. Detailed tables include player and game/event/end context and season comparison.
- Analytics load minimal difficulty projections only when requested, using authorized organization/actor/game scopes and bounded concurrency. A supplemental read failure leaves Standard statistics usable and identifies unavailable coverage.
- `difficultyGameShots` / `difficultyEventShots` are separate analytical projections. Original `gameShots`, `eventShots`, strict shot schemas and export shapes remain unchanged.
- Source identity and reconciliation conflicts prevent stale observations being attributed to a different player or shot. Grade edits, exclusions and deletion use current append-only state. Leaving an editing view or saving a shot invalidates cached analytics.
- Event coach, team and individual AI inputs include aggregate difficulty evidence, including per-level performance and game context. Player inputs include game-by-game snapshots. No raw notes, shot IDs or private identities are added to AI evidence.
- Traditional shooting remains first in AI instructions, report UI and PDF cards. Provisional status, sample size, coverage and the same-subset comparison rule constrain interpretation. A separate season AI generator does not exist; season coverage is provided through existing analytics.
- Newly generated reports save their calculated snapshot and benchmark set. Saved reports with a difficulty snapshot use its easy-shot expectation and above-expected result to display the revised index on reopen and export. The reference change preserves the report fingerprint. Charting changes and changes to expected rates still affect it.

No deployment, production report generation, report email, or production team-data mutation is part of this change.

## Validation (October 14, 2026)

- `npm run format:check`, `npm run typecheck` and `npm run build` passed.
- Full `npm test`: 2,656 passed, 143 environment-dependent tests skipped. After adding the explicit three-player example, the focused difficulty suite passed all 10 tests.
- `npm run test:e2e`: 366 passed / 170 configuration-specific skips, then 122 passed in the account/YouTube mock suite.
- Focused Shot Tracker browser runs: 4 passed across phone/tablet, covering persisted difficulty, filtered analytics, unchanged primary shooting, corrections, and Standard/Enhanced switching.
- A synthetic individual PDF was rendered and all 12 pages visually inspected. No live AI request or production report was generated.

The tests also cover missing/unavailable classifications, zero grades, exclusions, source identity conflicts, deletion and append-only restoration, configuration validation, uncapped results, rounding, report snapshot invalidation, legacy fingerprints, authorization and supplemental-service outages.
