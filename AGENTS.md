# CurlCast agent conventions

- Preserve portrait video with `object-fit: contain`; never crop/stretch camera or sponsor media.
- Keep privileged credentials in server-only modules and environment variables. Never log tokens or RTMP keys.
- Validate route input with Zod and preserve organization/game authorization boundaries.
- Scoring changes are append-only events; derive current state so Undo remains auditable.
- Provider boundaries belong under `src/lib/providers`; mock behavior must be visibly labelled.
- Controls must be accessible, mobile-first, and at least 44px high.
- Validate with `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.

## Usage-conscious director policy (user requested September 8)

- Director: GPT-5.6 Sol, medium reasoning by default. Use judgment rather than escalating every decision.
- Before each substantive task, state the task and its recommended reasoning level, then proceed with authorized work. Do not imply that a model or reasoning setting changed unless it was actually set.
- Delegate only bounded work that saves total effort. Prefer GPT-5.6 Terra medium for ordinary implementation and GPT-5.6 Luna medium for simple edits/documentation. Reserve GPT-6 Astra high for genuinely difficult native/CEF/WebRTC debugging or consequential authorization/concurrency review.
- Explicitly select those models for new workers using a short task brief and limited/no history fork; do not reuse inherited Astra workers for routine work.
- Work toward useful integrated outcomes, not a long series of tiny foundation-only checkpoints. Continue authorized next steps without repeatedly asking the user to say go.
- Run focused checks while iterating, then required full checks once per coherent integration. Do not rerun unchanged suites or known occupied-port E2E merely to repeat an existing failure. Retain honest baseline/blocked evidence.
- Keep progress, delegation responses and documentation concise. Update current state in place instead of adding another lengthy historical preamble each turn.
