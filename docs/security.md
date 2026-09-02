# Security and privacy

- Shareable mock invitations expire after 30 minutes and exchange for role/game/device-scoped six-hour sessions. Closing a game rejects claims and updates. Production issuance requires an authenticated organizer and distributed rate limiting; store invitation hashes, consume claims atomically, revoke all sessions on close, and mint least-privilege LiveKit grants.
- All privileged provider code runs server-side. Stream keys, service-role keys, token secrets, and encryption keys must never reach browser props, bundles, logs, telemetry, or errors.
- Encrypt future Google refresh tokens using envelope encryption (KMS-held KEK, per-record DEK, authenticated ciphertext), rotate keys, and audit decryptions.
- Sponsor assets are private organization data. Validate magic bytes server-side, decode/re-encode JPEG/PNG/WebP to strip metadata, reject SVG/executables, cap 12 MB input by default, issue short-lived signed uploads/reads, and enforce organization RLS. Delete derived and original objects within 30 days of a deletion request; retain audit tombstones without names for 90 days.
- Treat youth names and player audio as sensitive. Obtain consent, default sponsor-break output audio to muted, publish no camera audio, minimize retention, and provide an incident/deletion path.
- The MVP client validator improves feedback only; it is not a production trust boundary. Process-local claims and mock authentication are expressly not production security.

The development signing fallback is rejected when `NODE_ENV=production`. No route logs bearer or invitation tokens. Camera clients request `audio: false`; the future LiveKit grant must enforce video-only publication. The future scorer grant must enforce audio-only publication. YouTube variables are referenced only by the server provider module and must never be imported into client components.
