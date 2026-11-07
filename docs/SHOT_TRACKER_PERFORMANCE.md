# Shot Tracker loading

Updated September 22, 2026.

- Selected-event statistics use the scoring response immediately. A season read runs in the background for the All events selector; game/player/shot filters use loaded data.
- Confirmed saves patch the loaded event and season by organization, game and revision. A late response cannot replace a newer saved revision. Data remains component-local, without localStorage or a shared private-data cache.
- Event changes retain an already loaded season for the same organization/source. Refresh explicitly reloads data. Initial URL selection is resolved before starting the workspace request, and aborted/superseded responses cannot replace the selection.
- The workspace route passes its freshly verified account to the provider instead of repeating authentication and team lookup. Every request still authorizes, and private database reads/writes retain their access checks.
- Settings and hierarchy reads overlap. Authorized active score reads run at most four at once and retain game ordering; video timing lookup overlaps that work.

Validation: 1,583 unit tests passed (93 environment-dependent skips). Six dedicated phone/tablet cases passed, including a deliberately held season response, local filters, draft preservation, and no additional season download after a save. Both production builds passed, with 164 main and 74 connected-account browser tests passing. Formatting and typecheck passed. Logs are in work/workspace-speed-*.log.

Scope: this changes the Shot Tracker loading path, not every website route. Unloaded seasons/events and confirmed saves still require the server. YouTube timing lookups remain an external dependency on uncached reads. No schema migration or payment configuration change is needed.
