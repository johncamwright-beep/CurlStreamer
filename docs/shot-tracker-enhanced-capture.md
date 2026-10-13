# Enhanced Metrics — Prompt 1

Implementation specification: `Shot_Tracker_Codex_Build_Prompts.txt`, Master prompt and Prompt 1 (October 12, 2026).

Base: `origin/codex/internal-network-pilot` at `0709dc6acdcf1935dc389cc83f4882ae8b6042cd`, which includes the integrated Shot Tracker and flagged-shot work. The older reviewed technical-review commit is not used as the integration tip. Feature branch: `codex/shot-enhanced-capture`.

## Delivered workflow

- Options defaults to **Standard Curl Canada**. Mode and automatic-season-report preference are stored for the authenticated coach within the active organization. They are independent of game, event, sporting season and browser. Switching mode preserves both recorded data and local Enhanced drafts.
- Enhanced live entry adds detailed shot, intended weight, contact plan, guard context, explicit weight/miss assessment and broad path in the specified order. Optional review groups expose called context, contact/roll/removal/tolerance, delivery/deficiency assessments, named ice paths, conditions, observation source and adjustment references.
- New-shot detail suggests a Standard category only when that category is empty. Saved records are never remapped. The Standard type remains authoritative, including historical double-peel classifications.
- Enhanced review works on recorded shots after scoring closes. Standard corrections continue through the existing reopen/correct/finish lifecycle. Review retains Standard notes and video links and does not alter either.
- Options includes the field reference and versioned team call definitions. Game context is a separate revisioned record; each supplement captures a specific context revision and snapshot. Review can explicitly adopt a newer context, while old observations retain their historical definition/context references.
- Blank historical observations remain unknown. Assessment states are `not_assessed`, `assessed`, and `not_applicable`. Empty assessed lists explicitly record no listed issue. No grade, outcome or prose is used to infer missing observations.
- Flash/wreck/thickness and roll observations are validated together. Contradictions receive explicit errors. Missing source observations, stale revisions and changed source identities cannot silently become successful saves. Source identity reconciliation requires a recorded explanation.

The existing ten Standard categories, eight turns, independent outcome and 0–5 grade, exclusions, release/technical controls, calculations, historical JSON, report generation and PDF/email exports are unchanged. The original workbook mapping remains documented in `curlcoach-shot-tracker-mapping.md`; this phase does not change discrepancies or introduce a new scoring model.

## Storage and authorization

Apply **0086_enhanced_shot_capture.sql** after the current migrations through 0085, in a separately authorized release. It adds `shot_tracker_enhanced_commands` and scoped read/save RPCs. No migration has been applied to a hosted database for this task.

The append-only records carry organization, authenticated actor, kind, game/shot identity, request ID, Enhanced revision, source shot revision, immutable input/result, and timestamp. Kinds are preferences, game context and shot supplement. Current documents are projected from their latest revisions. Preferences revisions also retain the call definitions referenced by shots. There is no new Standard payload field or profile version.

The combined save RPC calls the existing Standard command RPC inside one PostgreSQL transaction. It enforces both revision checks, serializes first insertion, preserves the exact committed response for retries, and rejects reusing a request ID with changed input. Any supplemental failure rolls back the Standard change. Standalone review locks the source session and verifies the exact current source-shot revision. A deleted game or deleted source shot cannot receive new observations.

Reads and writes repeat the existing coach-access and organization/game checks. Client identities are rejected; the route derives actor/organization from the authenticated account. The table is inaccessible directly to anonymous, authenticated and service roles; the service role can call only the scoped functions. Updates/deletes are rejected by the existing append-only guard. HTTP responses use private/no-store caching and writes require same origin.

The synthetic local lab uses an atomic file envelope containing the unchanged Standard state plus Enhanced audit documents. Older lab files are read without conversion requirements; Standard-only writes preserve the envelope's Enhanced records. This is visibly synthetic development storage, not a replacement production backend.

## Compatibility and conflict projection

`loadEnhanced` exposes conflicts when an old client changes the Standard observations underlying an assessment. Grade-only corrections do not invalidate unrelated observations. `eligibleSupplement` returns the original value plus `unavailableGroups` and conflict reasons: Prompt 2 must exclude these groups from rates, while still showing their recorded history. A deleted or ambiguously re-identified source makes every assessment group unavailable.

Direction is derived only from a recorded first-end direction, or an audited explicit override with a reason. Named path labels are interpreted within recorded venue, sheet and direction; broad path labels alone never establish the same ice line. Actual delivered-slot coverage is unknown unless entered. Snapshot references do not infer unthrown stones from game completion.

Review edits are marked retrospective by storage, independently of the coach's observation-source label. Detailed shot/weight codes are nominal categories, not values suitable for averaging.

## Prompt 2 handoff

- Use the versioned catalogue and scoped supplement provider alongside the existing source-coach Standard projection. Retain source game/shot/revision IDs and context/definition versions in metric evidence.
- Historical definition revisions are retained in the audit table. Add a scoped historical-definition reader when Prompt 2 needs to display or compare an older definition; the current read RPC returns current documents.
- Implement S01–S05 and E01–E13 with exact denominators, eligibility and assessment coverage. Use `unavailableGroups`; do not count a conflicting or unassessed observation as an absence or success.
- Keep recorded positive tags separate from fully assessed opportunity rates. Deduplicate primary/additional observations per shot. Preserve the Standard arithmetic and export representation.
- Add Event analysis filters and supporting/comparison shot lists. No new Enhanced rates or season conclusions are claimed in this capture phase.
- Adjustment decisions/references are captured now; sequence evaluation belongs to Prompt 3. Completed-event snapshots belong to Prompt 4. Season comparisons, continuing findings, goals/practice records, published Team editions and AI evidence/generation belong to Prompts 5–7.
- The saved automatic-report preference is inert until the later entitlement/job implementation. No AI calls are made on entry or review; no reports are sent. An unset or zero future generation-pair allowance must disable automatic narratives. Existing event-report allowances are unchanged.

## Validation

Focused tests cover catalogue choices, unknown versus assessed-empty data, contradictions, category suggestion, unchanged Standard values, private preferences, old-client corrections, metadata retention and exact request retries. The in-memory PostgreSQL suite executes the real Standard lifecycle and new migration, including atomic rollback, revision races, closed-game review, all catalogue-choice persistence/corrections, private coach reads and denied direct table access. It never opens a network database connection.

Browser coverage exercises the real Options → Enhanced capture → Standard grade correction → Enhanced review workflow on phone and tablet. The final delivery records the actual full formatting, typecheck, unit, build and E2E results.

New development-only dependency: `@electric-sql/pglite` 0.5.9 for reproducible PostgreSQL tests. No new runtime service, environment variable, login, team ownership rule, billing configuration or deployment setting is introduced. Existing environment-variable names remain `CURLCOACH_ENABLED`, and, for the synthetic lab only, `CURLCOACH_LOCAL_LAB`, `CURLCOACH_LAB_SECRET`, `CURLCOACH_LAB_STORAGE`.

## Changed files

| Area                         | Files                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue and draft storage  | `src/lib/curlcoach/enhanced-catalog.ts`, `enhanced-drafts.ts`                                                                                                                     |
| Capture and Options UI       | `src/app/curlcoach/EnhancedMetrics.tsx`, `CoachLab.tsx`, `EventWorkspace.tsx`, `coach.css`                                                                                        |
| Authorized persistence       | `src/lib/providers/shot-tracker-enhanced.ts`, `curlcoach-local.ts`; `src/app/api/curlcoach/enhanced/route.ts`, `workspace/route.ts`                                               |
| Database                     | `supabase/migrations/0086_enhanced_shot_capture.sql`                                                                                                                              |
| Unit and database validation | Catalogue/draft/provider/route test files; `src/test/enhanced-fixtures.ts`; `supabase/migrations/enhanced_capture.integration.test.ts`                                            |
| Browser validation           | `tests/curlcoach/enhanced.spec.ts`; existing event, charting and flagged-shot assertions updated for the Options link, current no-recording UI and asynchronous fixture readiness |
| Tooling and handoff          | `package.json`, `package-lock.json`, this document                                                                                                                                |

Live Enhanced drafts retain their original supplement revision in coach/org/game/shot-scoped session storage. Normal authenticated Standard resume continues to restore the active turn. The anonymous synthetic lab has no account-scoped Standard resume store, so its browser test reselects the same slot after reload before verifying the retained Enhanced draft.

## Actual validation results — October 12, 2026

- `npm run format:check`: passed.
- `npm run typecheck`: passed.
- `npm test -- --reporter=dot`: 315 files passed, 22 skipped; 2,551 tests passed, 143 skipped.
- `npm run test:e2e`: passed; main configuration 366 passed / 162 skipped; additional configuration 122 passed. Skips are configuration-gated tests, not reported as passes.
- `playwright test --config playwright.curlcoach.config.ts`: all 40 phone/tablet tests passed, including the new Enhanced workflow. Phone and tablet report-review screenshots were inspected for layout/overflow.
- Production build was validated with synthetic local configuration, without copying production credentials. An initial build without configuration stopped at missing Supabase configuration; the configured build passed. Required build variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and `ROLE_TOKEN_SECRET`.

The full Shot Tracker run initially exposed an obsolete video-review text assertion and a fixture-readiness race in the flagged-shot test. Both assertions were corrected and the complete 40-test suite passed. Standard behavior was not changed to satisfy either assertion. Non-blocking lint warnings remain in the repository, including the generation-counter cleanup warning in the new data-loading hook; no validation failure remains.

No migration was applied to a hosted database. No merge, push, deployment, report send, billing change or production record modification was performed.
