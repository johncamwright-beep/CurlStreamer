# Historical difficulty calibration

An optional `difficultyEstimate` on an Enhanced supplement records a frozen reference distribution for a shot type: its method, reference event IDs and observed Easy/Moderate/Difficult counts. This is retrospective calibration using later observations, not a historical prediction. Do not refit it automatically when new shots are entered.

Only explicitly selected historical inferred records should receive an estimate. Append a new supplement revision through `save_shot_tracker_enhanced`, using the current source and document revisions. Preserve all other fields, and remove the inferred `values.difficulty`. Never replace a coach-entered rating or an edited record without checking its provenance. The November 16 backfill can be identified by its deterministic request IDs; it is not equivalent to all retrospective entries.

Difficulty projection validates source identity and shot type. An observed difficulty always takes precedence over an estimate. Selecting or clearing difficulty in the editor removes the estimate. Editing notes alone preserves it.

For reference counts A, B, C, expected difficulty weight is `(A + 2B + 3C) / (A + B + C)`. The original raw 0–100 mix is `(weight - 1) * 50`; the displayed season index is defined below. Expected shooting uses the same distribution over the configured A/B/C benchmarks. Neither calculation rounds estimates to a categorical rating. Excluded and ungraded shots remain excluded. Unmapped shots remain unrated.

Routine shooting and routine baseline comparisons use only observed Easy ratings. Estimates do not count as Easy shots, even when the reference distribution contains Easy observations. Counts of estimates accompany report and analytics summary metrics. Categorical mix rows represent observed ratings only.

Saved report difficulty summaries are refreshed from the authorized current event projection at read time; stored AI narratives are not regenerated. If difficulty loading fails, the saved summary remains available. This change requires no database schema migration or additional AI request.

## Shared season difficulty index (replaces capped relative score)

The displayed index is `100 * averageDifficulty / seasonDifficulty`, with Easy=1, Moderate=2, Difficult=3. The reference pools eligible rated shots for the same organization, season and player/team across the comparison dataset. All displayed events and games use that same reference, including Event 1. Report datasets include events through the report event; season analytics includes the loaded season. The reference updates when data is added. There is no clipping or forced ranking. Routine baselines remain strictly earlier completed events and exclude estimated ratings. Routine gap charts now show actual observed Easy-shot counts even when no prior baseline exists; estimated-only counts display a dash. Shooting and difficulty charts are separate, with explicit units.
