# Shot Tracker event reports

Shot Tracker's **Event reports** navigation and /shot-tracker/reports show an event library with Generate reports for completed events without saved reports and View reports for saved sets. Opening an event only loads its status; the explicit Generate reports button requests the missing audiences in sequence, sharing one event reservation. There is no automatic generation or user prompt. The report viewer has a left-hand list and one selected report:

- **Coach report:** private team analysis, with player follow-up and named evidence available to the coach.
- **Team report:** collective performance, shared strengths and shared improvement. The model receives no player names, positions, notes, shot records or individual aggregates. Output checks reject names and positional commentary.
- **Individual reports:** one separate report per recorded roster member, based only on that athlete's shooting evidence. Team results provide context, not individual responsibility for outcomes.

No user prompt or custom instructions are accepted. Reports remain private to the generating coach; selecting a team or player audience does not grant access, send or publish anything. The top-right Download PDF button exports only the selected report locally using jsPDF, without another model request. The presentation shows overall/category shooting percentages and four narrative sections: Overall, What went well, Where to improve, and Next practice. Source counts, coverage, exclusions and evidence references remain internal.

## Evidence policy

`src/lib/curlcoach/reports.ts` contains the versioned instructions, calculations and output schemas. Current shots are derived from append-only history. Zero grades count; missing and excluded grades do not enter the shooting percentage. Numbers are computed in code and attached to narrative through validated evidence references. Models produce qualitative observations, not calculations. Schema/reference/identity checks do not prove every interpretation correct: drafts require coach review and representative evaluations before paid production enablement.

All shared games must be completed. Concessions are valid early finishes. A private shot session remaining open does not invalidate a completed shared game, and remains in the internal evidence. Recorded shots beyond the final line score count toward shooting; an unfinished end is not invented or counted as a blank. Missing/gapped scoreboards are excluded from outcome totals. Unknown hammer ends are excluded from hammer denominators and retained in the internal evidence. Later hammer follows scoring and blanks; the multiple-with-hammer denominator includes blanks. No undefined advantage metric or official grading benchmark is invented.

Team evidence is built independently, never by redacting a coach narrative. Raw names, notes and video links are not sent to the model. Individual reports use separate provider calls. The reports do not claim video inspection or official Curling Canada matrix compatibility.

## Setup and integration

1. Apply `supabase/migrations/0074_shot_tracker_reports.sql`, then `0075_shot_tracker_report_allowance.sql` through the normal migration process. Do not replay 0074 in an environment where the report table already exists.
2. Configure server-only `OPENAI_API_KEY`, `SHOT_TRACKER_AI_MODEL` and `SHOT_TRACKER_AI_ENABLED`. The model must support strict structured outputs in the Responses API. Existing `CURLCOACH_ENABLED`, team entitlement and coach grants remain required. No model is silently selected.
3. Review generated drafts with a coach against labelled examples for all audiences, sparse data, concessions, unknown hammer and conflicting grades before enabling paid production use.

Missing AI configuration disables generation while leaving saved reports accessible. The provider lives under `src/lib/providers/shot-tracker-ai.ts`: fixed endpoint, `store: false`, strict JSON schema, bounded output and deadline. Upstream bodies and credentials are never logged. Official reference: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses

No replacement login, teams, subscriptions or billing. Shot Tracker remains an optional paid module; CurlStreamer works independently. Legacy `curlcoach` route, environment and database identifiers remain for compatibility, while product language is **Shot Tracker**. The jsPDF browser dependency supports local PDF export. No new bucket permissions or automatic sharing paths.

## Storage and recovery

Private reports are scoped by organisation, authenticated coach, event and audience. RLS and revoked direct table privileges leave only service-role RPCs. Each RPC repeats membership, entitlement and coach-grant checks. Routes validate with Zod and require same-origin writes.

Fingerprints include shot state/roster, games and completion, line scores, initial hammer, event title, policy and configured model. Changed data marks reports stale but never enables regeneration after success. Repeated clicks reopen the saved snapshot, including when AI configuration is disabled or the event later reopens. Sources are checked again before saving. Different coaches do not share report contents.

Each team has twenty event reservations per billing season (September 1 through August 31, America/Toronto). The first accepted generation reserves one slot, including if generation subsequently fails. Coach, team and individual packets plus failed-attempt retries all use that slot. Successful packets cannot be regenerated, even after source/model/policy changes or season rollover. Renaming or moving a scheduled event cannot reset the allowance. The reservation ledger survives deletion of an event or originating user, preventing delete-and-recreate allowance resets. Deleting the entire team deletes its ledger through the existing organization lifecycle.

The first coach to reserve an event owns its private report set; another coach cannot create another set for that event or read the first coach's reports. The migration backfills existing attempted events, preferring the earliest successful author, and preserves existing private successes. Existing usage above twenty is retained but no additional events can be reserved that season. It does not change login, memberships, subscriptions, prices, entitlement checks, Stripe configuration or deployment configuration.

An organisation-wide database claim lock prevents concurrent requests from exceeding the final available slot. Failed/abandoned claims recover after three minutes, including after source changes. The existing thirty-attempt daily guard remains. At most eight individual narratives run with two workers; each narrative permits one validation-only repair, for at most sixteen provider requests per individual-packet attempt. Billing/network/refusal failures are not automatically retried. Output is bounded at 3,200 tokens for the event narrative plus 240 per individual game, capped at 12,000, with the same shared 110-second packet deadline. Game summaries use the existing individual request, not one request per game. The deployment must permit the route's declared maximum duration. Streaming settings are unchanged.

Validation failure, refusal, timeout or persistence failure never publishes a partial packet. Existing saved reports remain reviewable. A failed request gives a fixed error and a retry after cooldown. In-progress requests are polled; abandoned leases become retryable.

## Verification

- Focused tests cover audience isolation, exclusions/zeros, concessions, request validation, privacy checks, provider failures and permanent cache reuse.
- PostgreSQL tests execute both migrations against a dedicated local cluster: private access, duplicate claims, leases, existing-data backfill, two requests racing for the twentieth slot, season boundary/rollover, deletion persistence, completed-packet immutability and teammate isolation.
- Phone/tablet tests cover allowance exhaustion, reserved-event continuation, another author's reservation, stale saved reopening and completion gating. Default E2E has a known occupied-port baseline; preserve the user's server.
- Live isolated-preview tests generated and reopened coach, collective team and four individual reports. These remain review drafts. Policy v4 adds a short game-by-game interpretation to individual reports. Each game retains overall shooting, all ten shot categories, all eight turn variants, execution-label distribution and result/miss-label distribution. Missing measurements display as a dash; zeros remain zeros. Label distributions use nonexcluded shots with that label; shooting percentages use numeric grades only. Each game paragraph is limited to sixty-five words and must cite evidence scoped to that game. No teammate evidence enters an individual input. The UI keeps detailed statistics expandable; the PDF includes them. Plain-language coaching instructions and practical drills remain in the event overview. Previously saved narratives retain their original wording under the permanent-cache rule; the redesigned presentation applies to both old and new reports. Validation is not proof of factual interpretation; coach review remains required.
- Production release and migration are separate approval steps. The isolated test database must be removed after validation; never remove the parent production project.

PostgreSQL tests opt in with `SHOT_TRACKER_TEST_DATABASE_URL` (localhost disposable/test database) and `CURLCAST_PSQL`. They create/drop an isolated database and use the existing real access-check function against minimal fixtures. Do not target application storage.
