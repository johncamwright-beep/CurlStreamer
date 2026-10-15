# CurlCast agent conventions

- Preserve portrait video with `object-fit: contain`; never crop/stretch camera or sponsor media.
- Keep privileged credentials in server-only modules and environment variables. Never log tokens or RTMP keys.
- Validate route input with Zod and preserve organization/game authorization boundaries.
- Scoring changes are append-only events; derive current state so Undo remains auditable.
- Provider boundaries belong under `src/lib/providers`; mock behavior must be visibly labelled.
- Controls must be accessible, mobile-first, and at least 44px high.
- Validate with `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.

## Usage-conscious director policy (user requested September 8)

- Use GPT-6.1 Sol (`gpt-6.1-sol`) with `medium` reasoning for coding tasks, and `low` reasoning (light) for easy routine tasks (user updated September 29).
- Before each substantive task, state the task and its recommended reasoning level, then proceed with authorized work. Do not imply that a model or reasoning setting changed unless it was actually set.
- Delegate only when explicitly requested by the user or applicable instructions. Use the same GPT-6.1 Sol preferences for any authorized workers.
- Work toward useful integrated outcomes, not a long series of tiny foundation-only checkpoints. Continue authorized next steps without repeatedly asking the user to say go.
- Run focused checks while iterating, then required full checks once per coherent integration. Do not rerun unchanged suites or known occupied-port E2E merely to repeat an existing failure. Retain honest baseline/blocked evidence.
- Keep progress, delegation responses and documentation concise. Update current state in place instead of adding another lengthy historical preamble each turn.
