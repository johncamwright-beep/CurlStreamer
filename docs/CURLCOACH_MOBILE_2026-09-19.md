# CurlCoach navigation and mobile fixes — September 19, 2026

- Keep the scoring form mounted when viewing stats. Retain unsaved drafts and correction selection per game in workspace memory, without storing private coaching notes in browser storage.
- On a full reload, resume after the furthest recorded shot. Unsaved drafts survive in-app view/game switches, not a browser restart.
- Remove automatic event refetches caused by changing React context objects. A confirmed shot save already returns the authoritative state.
- Restrict production save preparation to the selected game after existing account, team and event validation; avoid serial scoreboard reads for every other game.
- Replace the fixed sidebar with a compact hamburger disclosure, scrollable choices, Escape handling and owner/admin account links.
- Show table rows as labelled cards on phones and narrow tablets; retain every stat value and minimum 44px controls.

Validation: native browser CurlCoach scenarios pass on phone and tablet, including retained unsaved notes and zero extra workspace GETs after navigation or save. Unit tests cover selected-game read scope and denied unknown game IDs. Saving still requires internet confirmation; no offline-save claim is made.
