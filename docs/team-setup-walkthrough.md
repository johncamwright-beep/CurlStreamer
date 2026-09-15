# First-team setup

New owners enter a six-step walkthrough after creating their first team: team profile, public page, season, event, broadcast equipment and YouTube, then first game. Existing users and members joining teams retain their dashboard flow.

The walkthrough uses the existing profile/public-page editors and schedule APIs. Profile steps save before advancing. Public-page publication remains a separate explicit permanent-address confirmation. Event creation defaults to Eastern (Toronto). The selected season/event carries into game creation; scheduling does not start a broadcast.

Progress is saved in the authenticated user's `team_setup` preference in Supabase Auth metadata, scoped to the organization ID. It is not an authorization claim. Each write rechecks verified identity, active profile, current organization membership, and owner role. Actual team data continues to use the existing authorized team APIs. No schema migration is needed.

Back, Skip for now, and Save progress and exit preserve already-saved details. Unsaved form edits are not saved by those buttons; the UI says to save the current form first. An unfinished setup displays Resume team setup on the dashboard. YouTube's existing callback returns to Account & Settings; the dashboard resume link returns to the saved broadcast step.

Owners can deliberately open `/onboarding?start=1` to try or restart the walkthrough on an existing team. This edits their real team settings. It never automatically republishes a page or creates a second team.

Completing game creation offers a link to the newly created game. Skipping the final step finishes setup without creating a game. Skipped details remain editable through the normal account and scheduling pages.

## Browser and Windows Studio

Browser users can manage accounts, public team pages, sponsors, seasons, events, games, and scoring. The game operator sidebar shows **Requires Windows Studio** in place of the old browser stream-start control. It links to the existing game-specific Studio setup page with travel-router, camera-phone, and internet guidance. Remote scorers keep their score-only view.

There is no public installer URL configured yet. The UI accurately says the pilot Windows installer is supplied separately. When a distributable installer is published, replace that guidance with the real download link.

Studio's YouTube UI requires the native WebView bridge. That is a capability check, not an authorization claim: existing server authorization remains in force. The legacy broadcast API is unchanged; the browser scoring page no longer invokes it. Reserving a scheduled YouTube watch link remains available during browser game creation.

## Validation

September 11, 2026: formatting and TypeScript pass; 1,382 unit tests pass (85 database integration tests skipped by their existing environment gates). Account/browser suite: 46 pass. Main browser suite: 156 pass initially, with the four failed browser-handoff/native-YouTube cases passing on focused rerun after the test selector and standalone-link dependency fixes. Both desktop and mobile are covered. New setup tests cover saved profile details, resume, no implicit public-page publication, and retry-safe current-season activation. No live stream or real-team profile changes were used for testing.
