# YouTube recovery — September 18, 2026

Confirmed production symptoms:
- Disconnect is rejected by the existing database guard: an unfinished broadcast still requires the original channel credentials.
- Windows Studio cancels external navigation, preventing Google OAuth from opening.
- Native broadcast preparation discarded the safe provider error code and advised restarting Studio.

Fix:
- Intercept only the same-origin YouTube OAuth start route and open the fixed Account/YouTube settings page in the system browser. Never transfer Studio cookies, tokens or OAuth state.
- Preserve safe error codes through the native handoff and map them to fixed recovery instructions.
- Explain the unfinished-broadcast disconnect restriction, preserving the database guard.
- Explain expired/revoked Google authorization when testing the connection.

The local installed launcher was backed up, replaced, and its SHA256 verified. Existing controller, recording runtime and public configuration are unchanged. The reusable installer has not been rebuilt.

Validation: native policy executable passed; launcher compiled; connection tests passed. Full web checks are recorded in work-youtube-*.log. Existing format issue in docs/CURLCOACH_INTEGRATION.md is unrelated. Live OAuth still requires the account owner's Google sign-in/consent. No broadcast was started or forcibly cleared.
