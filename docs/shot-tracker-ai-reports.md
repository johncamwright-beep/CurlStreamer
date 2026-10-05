# Shot Tracker event reports

The event detail page and Shot Tracker's **Event reports** navigation offer three fixed actions after all scheduled, nondeleted games are completed:

- **Coach report:** private team analysis, with player follow-up and named evidence available to the coach.
- **Team report:** collective performance, shared strengths and shared improvement. The model receives no player names, positions, notes, shot records or individual aggregates. Output checks reject names and positional commentary.
- **Individual reports:** one separate report per recorded roster member, based only on that athlete's shooting evidence. Team results provide context, not individual responsibility for outcomes.

No user prompt or custom instructions are accepted. Reports remain private to the generating coach; selecting a team or player audience does not grant access, send or publish anything. The coach can print the selected packet or save it as PDF using the browser.

## Evidence policy

`src/lib/curlcoach/reports.ts` contains the versioned instructions, calculations and output schemas. Current shots are derived from append-only history. Zero grades count; missing and excluded grades do not enter the shooting percentage. Numbers are computed in code and attached to narrative through validated evidence references. Models produce qualitative observations, not calculations. Schema/reference/identity checks do not prove every interpretation correct: drafts require coach review and representative evaluations before paid production enablement.

All shared games must be completed. Concessions are valid early finishes. A private shot session remaining open does not invalidate a completed shared game, but is disclosed. Recorded shots beyond the final line score count toward shooting; an unfinished end is not invented or counted as a blank. Missing/gapped scoreboards are excluded from outcome totals. Unknown hammer ends are excluded from hammer denominators and disclosed. Later hammer follows scoring and blanks; the multiple-with-hammer denominator includes blanks. No undefined advantage metric or official grading benchmark is invented.

Team evidence is built independently, never by redacting a coach narrative. Raw names, notes and video links are not sent to the model. Individual reports use separate provider calls. The reports do not claim video inspection or official Curling Canada matrix compatibility.

## Setup and integration

1. Apply `supabase/migrations/0074_shot_tracker_reports.sql` through the normal migration process.
2. Configure server-only `OPENAI_API_KEY`, `SHOT_TRACKER_AI_MODEL` and `SHOT_TRACKER_AI_ENABLED`. The model must support strict structured outputs in the Responses API. Existing `CURLCOACH_ENABLED`, team entitlement and coach grants remain required. No model is silently selected.
3. Review generated drafts with a coach against labelled examples for all audiences, sparse data, concessions, unknown hammer and conflicting grades before enabling paid production use.

Missing AI configuration disables generation while leaving saved reports accessible. The provider lives under `src/lib/providers/shot-tracker-ai.ts`: fixed endpoint, `store: false`, strict JSON schema, bounded output and deadline. Upstream bodies and credentials are never logged. Official reference: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses

No replacement login, teams, subscriptions or billing. Shot Tracker remains an optional paid module; CurlStreamer works independently. Legacy `curlcoach` route, environment and database identifiers remain for compatibility, while product language is **Shot Tracker**. No new npm dependencies, bucket permissions or automatic sharing paths.

## Storage and recovery

Private reports are scoped by organisation, authenticated coach, event and audience. RLS and revoked direct table privileges leave only service-role RPCs. Each RPC repeats membership, entitlement and coach-grant checks. Routes validate with Zod and require same-origin writes.

Fingerprints include shot state/roster, games and completion, line scores, initial hammer, event title, policy and configured model. Changed data marks reports stale; repeated clicks reopen saved content. Sources are checked again before saving. Content is retained across versions; cache access updates recency. Different coaches do not share report caches.

An organisation-wide claim lock prevents duplicate or simultaneous generation. Failed/abandoned claims recover after three minutes. Thirty generation attempts across recently updated report records limit distinct requests and retries; an individual packet has at most eight model calls, two at a time. This is an initial operational allowance, not a billing plan. The deployment must permit the route's declared maximum duration. Streaming deployment settings are unchanged.

Validation failure, refusal, timeout or persistence failure never publishes a partial packet. Existing saved reports remain reviewable. A failed request gives a fixed error and a retry after cooldown. In-progress requests are polled; abandoned leases become retryable.

## Verification

- Main suite: 1,882 tests passed; 100 existing opt-in tests skipped.
- Focused tests cover audience isolation, exclusions/zeros, concessions, request validation, privacy checks, provider failures, cache reuse and invalidation.
- Migration executed in a dedicated local PostgreSQL cluster: private access, duplicate claims, lease ownership, cached success, audience separation, completion and entitlement checks passed.
- Production build passed with placeholder test configuration; pre-existing unrelated lint warnings remain.
- Phone/tablet report and event navigation tests passed. Default E2E is blocked by the existing user server on port 3000, which was preserved.
- No production migration, deployment, live model call or credential configuration was performed.

PostgreSQL tests opt in with `SHOT_TRACKER_TEST_DATABASE_URL` (localhost disposable/test database) and `CURLCAST_PSQL`. They create/drop an isolated database and use the existing real access-check function against minimal fixtures. Do not target application storage.
