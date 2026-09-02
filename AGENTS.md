# CurlCast agent conventions

- Preserve portrait video with `object-fit: contain`; never crop/stretch camera or sponsor media.
- Keep privileged credentials in server-only modules and environment variables. Never log tokens or RTMP keys.
- Validate route input with Zod and preserve organization/game authorization boundaries.
- Scoring changes are append-only events; derive current state so Undo remains auditable.
- Provider boundaries belong under `src/lib/providers`; mock behavior must be visibly labelled.
- Controls must be accessible, mobile-first, and at least 44px high.
- Validate with `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.
