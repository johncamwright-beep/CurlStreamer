# Opponent profiles and shared watch links

Teams can explicitly find a published CurlStreamer profile while selecting an opponent, or link an existing opponent later from Opponents. Names are not automatically matched or merged. Local opponent IDs and historical game names remain intact. Public game listings link the opponent name to its published profile.

Game setup accepts an optional shared YouTube watch link. Selecting it disables creation of the team's own scheduled broadcast. Dashboard cards, public upcoming/results listings, and the end-game review use that link. End-game review remains editable and saves the chosen replay link with the completion.

Database migrations 0047 and 0048 were applied to the pilot Supabase project on September 11, 2026. Directory RPCs are service-only, derive the requesting team from verified membership, exclude private and own-team profiles, and authorize local opponent writes. Linking does not grant permissions over the opponent's account or games.

Validation includes route authorization tests, schema round-trip validation, dashboard/public link rendering, shared-link completion validation, desktop/mobile game setup tests, and a rollback-only database check for public search isolation, existing-opponent reuse, duplicate prevention, unauthorized writes, and unlinking. The database check retained no test records.

Shared game invitations, shared ownership, notifications, and automatic stream coordination remain outside this feature.
