# Shot Tracker update — September 19, 2026

- Renamed user-facing CurlCoach labels to Shot Tracker; retained existing URLs, entitlements and private tables.
- Default to scoring and the current tournament/game. Explicit event/game selections still win.
- Current games remain above the main dashboard tabs for their local scheduled day; broadcast activity also appears above the tabs.
- Removed Setup and redundant context paragraphs. Event/game selectors precede entry; refresh is a labelled icon at top right.
- Added return-to-current-shot, private draft restoration when correcting shots, Yes/No review selection, larger notes, newest-first attempts/history, and summaries below entry.
- Session actions are in the scoring menu. Existing private access controls remain enforced.
- Event deletion requires an owner/team administrator and explicit confirmation. Migration 0062 atomically soft-deletes every child game through the existing live-session safeguards, retains audit history, queues provider cleanup, filters deleted events, and prevents new games/restores into deleted events.
- Provider cleanup failures lead to Recently deleted games, where existing cleanup retry controls remain available.
- No existing event or game was deleted to test production.

Validation:

- Formatting and TypeScript checks passed.
- Full unit run: 1,547 passed, 91 environment-dependent skips; additional current-game, deletion-route, default-event and real PostgreSQL deletion tests passed.
- Shot Tracker phone/tablet end-to-end suite: 6 passed.
- Main end-to-end suite: 162 passed.
- Connected suite: the two existing game-setup opponent-edit failures remain. Four stale branding assertions were updated and their desktop/mobile tests passed.
- Production migration 0062 applied successfully through the Supabase SQL editor before website release.

Event dates and local timezone determine a current tournament. A current open game takes priority; otherwise the active event, next game, then recent history are used. Private unsaved drafts remain in memory rather than persistent browser storage.
