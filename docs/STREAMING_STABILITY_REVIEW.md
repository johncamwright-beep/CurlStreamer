# Streaming stability review — September 29, 2026

The review found software failure paths that can explain abrupt disconnections
and misleading status changes. They are reproducible code defects; they do not
prove which one caused every interruption in the earlier physical rehearsal.
Review and implementation use the current `codex/internal-network-pilot` worktree.
The older `main` checkout is not the current Studio product.

## Fixes

| Finding                                                                                    | Change                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One failed desktop heartbeat permanently failed the session and stopped OBS.               | Temporary transport failures retain only the previously acknowledged lease. A later successful heartbeat can recover. Failed requests never renew native authority. Revocation, expiry, changed identity, and malformed replies still stop output. Target delivery remains once only. |
| One failed camera ticket renewal tore down working capture and private signaling.          | Phone and native receiver distinguish temporary transport errors from authority rejection. They keep the existing connection only until its original ticket expires. An incoming message whose authority check fails is dropped, never forwarded unchecked.                           |
| Camera event drains issued frequent database checks that lock game/session rows.           | Local drain polling falls from four times per second to once. Empty drains reuse the last verified authority for at most five seconds; ticket renewal validates it independently. Queued signals still get a fresh check immediately before release.                                  |
| Native scoreboard polled twice a second throughout the game.                               | Poll once a second, cutting that polling rate in half.                                                                                                                                                                                                                                |
| Any scoring read error replaced the whole page, unmounting the preview and controls.       | Brief server failures keep the last loaded score with a connection warning. Access denial or terminal game state still clears the active controls. Recovery immediately restores the normal polling interval.                                                                         |
| A failed preview image request hid the previous successful picture.                        | Double-buffer local preview frames and keep the last successful picture while reconnecting. Waiting instructions now refer to connecting the game, since a preview does not require recording.                                                                                        |
| A normal heartbeat renewal during a YouTube status check was treated as a changed session. | Accept an extended lease on the same independently authorized session. Reject shortened/expired authority, revocation, and changed account/resource bindings.                                                                                                                         |
| Previously prepared watch-page recovery work was still local.                              | Include the bounded stale-reservation recovery and lifecycle checks with this release; do not create another broadcast after an uncertain provider insert.                                                                                                                            |

No database migration, live payment activation, or real broadcast is required by
these code changes. Camera and sponsor media retain `object-fit: contain`.

## Validation

- Formatting and TypeScript checks passed.
- Unit suite: 1,636 passed; 93 database/environment-dependent tests skipped.
- Production build passed. Browser suites: 246 passed, 92 skipped, including
  desktop/mobile scoring recovery, access revocation, and preview recovery.
- Packaged Studio check passed: relocated bundle, empty profile, unarmed native
  readiness, and graceful controller exit. Redistribution notices and component
  hashes were prepared; installer `0.4.0-pilot.2` compiled successfully.
- An earlier browser run was invalidated by a concurrent unit test starting
  Next.js development mode in the same build directory. The clean rerun runs
  those checks sequentially; its results supersede that run.

## Release status

The fixes and installer are prepared locally. Publishing, public-domain
verification, and updating the installed Studio copy are not yet confirmed.
Website deployment alone cannot update the native controller or camera renderer.

## Remaining work

- Run a 45–60 minute unlisted broadcast using two physical phones and this exact
  installer. Watch the actual YouTube picture, switch scoring/settings pages,
  check audio, stop normally, and verify the recording and replay link.
- Test install/update on another Windows PC. Offline startup is not a camera or
  network endurance test.
- Restarting a consumed/stopped broadcast currently rebuilds the Studio program
  because output grants and native sinks are single use. Keeping cameras alive
  across a replacement output session needs a separate lifecycle change.
- Provider observations still refresh Google access tokens frequently. A bounded,
  server-only token cache with connection-version invalidation could reduce
  provider traffic, but is outside this stability patch.
- Private signaling websocket loss and a direct WebRTC transport that fails to
  recover still require reconnecting. The patch does not remove direct-path
  checks or permit cameras to outlive revoked access.
