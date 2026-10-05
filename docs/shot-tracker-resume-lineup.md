# Shot Tracker resume and game lineup

`Resume tracking` appears in the Shot Tracker top bar on scoring and statistics pages. It returns to the actively tracked game and its parked current attempt, even after selecting another game or event. Historical corrections preserve that parked attempt. Saving a current attempt advances the anchor to the next available rock.

Incomplete drafts and the active anchor persist in browser storage scoped to the signed-in actor and organization. Restoration waits for authorized game data, validates the roster and revision, and skips slots that have since been saved. Browser storage is optional; if it is unavailable or cleared, the tracker infers the next available rock from recorded attempts. The browser draft does not synchronize across devices.

`Set lineup` assigns each of the eight team rocks independently to a known roster member. The ordered lineup is stored in the private game session, so three players can throw 3/3/2 without inventing another player or overwriting earlier player statistics. The next rock uses the saved assignment. Changing the lineup during a historical correction updates the parked current attempt and preserves the visible correction.

Lineup saves use revision checks and idempotent request IDs. A retry after a lost response uses the original request. If that original result predates a newer loaded revision, it acknowledges the save without replacing newer state. Lineup audit entries and recorded shot events remain append-only. The private lineup does not change the shared CurlStreamer score or season roster.

## Release requirements

Apply `0071_curlcoach_lineups.sql` before enabling this website revision. The accompanying game-creation/opponent changes also require `0070_opponent_details.sql`. Neither migration was applied to production during this implementation, and the website has not been deployed from this branch.

## Validation

- Final full unit suite: 1,756 passed, 99 skipped. Skipped database/native checks require their configured services or equipment.
- Resume/lineup browser fixtures: 14 passed across phone and tablet, including stale idempotent responses, private account isolation, reloads, event/game browsing, historical corrections, and all eight rocks with a three-player lineup.
- Styled Next.js lab page: eight-rock 3/3/2 lineups saved and reloaded through the local route on phone and tablet. Modal bounds, horizontal overflow, 44px controls and scrolling to Save were checked; phone and tablet screenshots were inspected.
- Final full Shot Tracker browser suite: 30 passed, zero skipped. The styled case passed again on both devices after strengthening test cleanup.
- Final formatting, TypeScript and production build checks passed. The build used test configuration rather than production credentials.
- Actual lineup migration executed against a PostgreSQL-compatible fixture: 13 checks passed, including authorization, immutable history, revision conflicts, and retry identity. This is fixture validation rather than a production migration.
- Shared application and navigation browser results are recorded in `game-creation-navigation.md`.
