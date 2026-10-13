# Enhanced Metrics — Prompt 1

Implementation specification: `Shot_Tracker_Codex_Build_Prompts.txt`, Master prompt and Prompt 1 (October 12, 2026).

Base: `origin/codex/internal-network-pilot` at `0709dc6acdcf1935dc389cc83f4882ae8b6042cd`, which includes the integrated Shot Tracker and flagged-shot work. The older reviewed technical-review commit is not used as the integration tip. Feature branch: `codex/shot-enhanced-capture`.

## Delivered workflow

- Options defaults to **Standard Curl Canada**. Mode and automatic-season-report preference are stored for the authenticated coach within the active organization. They are independent of game, event, sporting season and browser. Switching mode preserves both recorded data and local Enhanced drafts.
- Enhanced live entry uses one Shot selector with Curling Canada and Enhanced groups. Compact dropdowns are grouped in expandable Shot selection, Execution and Observed misses sections. Primary/additional misses replace the duplicate checkbox and primary-picker interface. Contact/roll results are inside Execution; optional review retains delivery assessments, named ice paths, conditions, observation source and adjustment references.
- Explicit Enhanced selection on a new attempt stores its detail and mapped Standard compatibility category. Selecting a classic shot stores the Standard choice and removes the prior supplemental detail. Supplemental reclassification of an existing attempt preserves its historical Standard type; explicit Standard corrections retain the existing audited correction workflow. Standard values, calculations and exports remain authoritative, including historical double-peel classifications.
- Enhanced review works on recorded shots after scoring closes. Standard corrections continue through the existing reopen/correct/finish lifecycle. Review retains Standard notes and video links and does not alter either.
- Options includes the field reference and versioned team call definitions. Game context is a separate revisioned record; each supplement captures a specific context revision and snapshot. Review can explicitly adopt a newer context, while old observations retain their historical definition/context references.
- Blank historical observations remain unknown. Assessment states are `not_assessed`, `assessed`, and `not_applicable`. Empty assessed lists explicitly record no listed issue. No grade, outcome or prose is used to infer missing observations.
- Flash/wreck/thickness and roll observations are validated together. Contradictions receive explicit errors. Missing source observations, stale revisions and changed source identities cannot silently become successful saves. Source identity reconciliation requires a recorded explanation.

The existing ten Standard categories, eight turns, independent outcome and 0–5 grade, exclusions, release/technical controls, calculations, historical JSON, report generation and PDF/email exports are unchanged. The original workbook mapping remains documented in `curlcoach-shot-tracker-mapping.md`; this phase does not change discrepancies or introduce a new scoring model.

## Storage and authorization

**0086_enhanced_shot_capture.sql** adds `shot_tracker_enhanced_commands` and scoped read/save RPCs after migration 0085. It was applied during the separately authorized October 12 release (PR #129). Subsequent entry-interface refinements require no new migration.

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

At the initial implementation checkpoint above, no hosted migration, merge, deployment, report send, billing change or production record modification had been performed. Prompt 1 was subsequently released through PR #129 on October 12; compact entry was released through PR #130 on October 13.

## Compact entry follow-up

Branch `codex/compact-enhanced-entry`, based on integrated commit `0314251f5b6575b1b33607151d210dd6b488ff05`. No new migration, dependency or production data change. `EntryControls.tsx` and `entry-selection.ts` implement the combined shot selector and dropdown miss controls. Removing a miss clears its dependent contact/roll result while preserving unrelated observations. Unit tests cover classification preservation and assessment states; phone/tablet tests cover section toggling, single-picker capture, miss removal, reload, persistence and Standard-only corrections. Prompt 2 continues to consume the same versioned storage contract.

Follow-up validation (October 13): formatting and typecheck passed; full unit suite 2,555 passed / 143 skipped, followed by all 5 entry-selection tests passing after the unmapped-Other safeguard. Both production builds within `test:e2e` passed; main browser suite 366 passed / 162 skipped and configured integration suite 122 passed. Shot Tracker browser suite initially passed 39/40; the phone PDF download timed out. That PDF test and Enhanced entry passed on phone and tablet in the targeted retry (4/4). Final compact phone/tablet screenshots were visually inspected. No report was sent and no production team data was modified.

## Simplified result-entry follow-up — October 13, 2026

Branch `codex/simplified-result-entry`, based on `d47bc6343cbf7289406794fc91f76e4a0128c5e0`. No migration, dependency, Standard payload, scoring arithmetic, historical-record rewrite, or AI-report change.

- Shot selection keeps the combined picker, Called weight and optional Guard to clear prominent. Other call details are collapsed. Execution keeps Observed weight visible; a collapsed More details section exposes first contact, roll and Target stones removed only for explicit applicable calls. Shot categories do not establish opportunities.
- What happened? offers every existing miss choice plus explicit No observed miss, Not assessed and Not applicable. It starts unassessed. Result selections directly set their assessment state; clearing returns them to unassessed. Matching contact/roll observations are reused and corrected together, without inventing a cause, grade or technique. Clearing the last positive miss does not establish that no miss occurred.
- Separate contact/roll/removal/tolerance assessment dropdowns are removed. Weight basis, tolerance and historical results remain accessible in optional detailed review. An unrelated edit preserves hidden values, historical not-applicable states, source metadata and definition references. Enhanced review includes a collapsed readout of all saved observations.
- Assessment coverage shows assessed versus known opportunities for included recorded attempts in the selected game, separating unassessed observations, not-applicable cases, missing calls and conflicts. It does not claim success rates, complete game coverage, or unthrown-stone counts. Prompt 2 still owns the specified S/E performance metrics and event analysis.
- Existing event AI reports, PDFs, email delivery and allowances are unchanged. Season Development AI generation remains a later phase; the automatic-season-report preference remains inert.

Implementation: `result-entry.ts` owns explicit result transitions and call relevance; `assessment-coverage.ts` owns coverage; `EnhancedMetrics.tsx`, `EntryControls.tsx`, `AssessmentCoverage.tsx`, `CoachLab.tsx` and `coach.css` render the workflow. The catalogue changes display labels only. Unit and phone/tablet browser tests cover capture, correction, clearing, Standard/Enhanced switching and hidden-history preservation.

Validation: formatting and typecheck passed; full unit suite 2,563 passed / 143 skipped; standalone production build passed using synthetic configuration. Focused Enhanced phone/tablet workflow passed (2/2); screenshots inspected. Full browser regressions passed: main suite 366 passed / 162 configuration-gated skips; additional integration suite 122 passed; Shot Tracker suite all 40 phone/tablet tests passed, including PDF/report tests. Initial focused browser assertions matched a hidden, mounted Charting control while reviewing a shot; selectors now target the visible controls. Non-blocking repository lint and Browserslist warnings remain. No merge, deployment, production data write or real report send was performed for this follow-up.

## Responsive interface first pass — October 13, 2026

Branch `codex/shot-tracker-ui-refresh`, based on integrated `df4a4fb6b5712351e9eb6fec86484f8b5dd181f3`.

- New SVG house/target mark and Shot Tracker header. Desktop shortcuts lead to Charting, Analysis, Flagged shots, Reports and Options; the overlay menu retains every existing page and account link.
- Quick entry separates the call from execution. Desktop uses a companion game-context column; phones use a single-column entry flow, 48px inputs and a pinned save/next action bar. Native selects keep the existing complete Standard and Enhanced option lists and mobile OS pickers.
- Optional call/result details, observed miss details, notes/review, detailed historical review and the turn guide use modal overlays. Phone overlays are bottom sheets. Dialogs keep their controls mounted, preserve unsaved changes, support Escape/Done/Close and return focus to the trigger. Their opening does not reflow the form.
- No new dependencies or migration. No scoring, append-only event, persistence contract, report-generation, PDF, export, or historical-record change. These are presentation changes; existing event AI report content is unchanged.

Validation: format and typecheck passed; unit suite 2,563 passed / 143 skipped; isolated Shot Tracker suite 42/42 passed on phone and tablet. The new UI test also checks a 1440px desktop layout, overlay draft retention, focus return, stable page height and no horizontal overflow. An initial concurrent unit/browser run collided because middleware tests start Next in the same build directory; browser tests were rerun in isolation. Wider build/browser release checks are recorded in the local work logs.

Final release checks: `npm run test:e2e` passed (366 main browser tests, 164 configuration-gated skips; 122 configured integration tests). Both `npm run build` invocations in the browser configurations passed using synthetic local environment values. Final responsive visual checks passed 2/2 after the phone sheet-width and desktop-spacing adjustments. Desktop and phone screenshots were inspected. No unresolved test failures remain. Work is local only, not merged or deployed.
