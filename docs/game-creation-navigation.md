# Game creation and opponent navigation

The game setup form keeps opponent, scheduling, rock colour and game length drafts while creating a season or event. The event dialog selects its own season, then selects the saved event in the main form. Event game numbers continue above the highest existing or newly scheduled number, while remaining editable and optional.

Opponent selection starts at TBD and uses normalized substring search with keyboard selection and Escape cancellation. Unmatched searches clear the selected opponent so a stale selection cannot be saved. No-match feedback remains visible after blur so following controls do not move between pointer press and release.

One opponent dialog saves the canonical team name and selected season's competition level and roster together. Owners and team administrators can manage these details; game operators can create opponent names without gaining seasonal editing controls. Conflicts preserve unsaved fields until an explicit reload. Archived season history remains visible, with creation and editing disabled.

The server validates route input, checks organization and role access, and uses optimistic name/revision checks. Migration `0070_opponent_details.sql` provides the atomic save operation. No migration was applied to a real database during validation.

## Browser validation, 2026-10-03

- Main Playwright suite: 214 passed, 116 skipped, exit 0 (`work/navigation-e2e-main-final.log`).
- Authenticated fixture suite: 80 passed and 10 failed on its first complete run. Eight failures passed after correcting test selectors and search setup; the remaining two passed after fixing the no-match feedback layout shift. All 90 authenticated cases passed across that run and targeted reruns (`work/navigation-e2e-auth-final.log`, `work/navigation-e2e-auth-retry.log`, `work/navigation-e2e-profile-final.log`).
- Final standalone opponent browser regression: 4 passed across desktop and mobile (`work/navigation-combobox-final.log`).
- Focused opponent component unit tests: 3 passed (`work/navigation-combobox-unit-final.log`).
- Shot Tracker lab browser suite, run sequentially after the authenticated suite: 26 passed (`work/navigation-curlcoach-lab-final.log`).

The first browser startup attempt collided with a concurrent unit-test Next build. Its output was preserved outside the repository and a clean production build succeeded. An older interrupted browser log has no reliable aggregate result and is not included above. The production browser builds and isolated Supabase fixture used no real account data or database mutations.
