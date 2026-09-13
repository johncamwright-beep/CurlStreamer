# Pilot hardening release

## September 13, 2026 changes

- Pin PostCSS 8.5.28 and override Next's older nested copy. Keep Next 15.5.25;
  a major framework upgrade is not needed for these runtime audit findings.
- Run the existing web and Windows checks on pilot-branch pushes as well as main
  and pull requests. Audit runtime dependencies at moderate severity or higher.
- Replace per-process request limits on game creation and participant claims with
  atomic Supabase counters. Game creation uses verified account identity; claims
  aggregate by client rather than attacker-supplied game ID. Identities are HMAC
  hashed using the server secret. Missing/erroring counters fail closed with 503;
  exhausted counters return 429 with Retry-After. This is not yet rate limiting
  for every write endpoint or protection against large distributed attacks.
- Decode/re-encode sponsor, team and news uploads on the server. Reject malformed,
  animated/multipage, over-4-MB inputs and images over 40 million decoded pixels.
  Store images strictly below 300,000 bytes, no side over 1600 pixels, without
  EXIF metadata. Opaque photos use JPEG; transparent logos use WebP. Preserve
  proportions without cropping or enlargement. Existing stored images are not
  rewritten. Aggregate storage quotas and abandoned-upload cleanup remain open.

## Deployment order and rollback

1. Apply `0057_shared_request_limits.sql` before deploying the web changes.
   Applied to project `hoogvyhuxevihttbutwl` with transaction-isolated assertions
   for exhaustion, expiry reset and service-only permissions on September 13.
   `scripts/verify-shared-request-limits.sql` repeats those assertions without
   keeping test counters. Cross-connection stress testing remains outstanding.
2. Pass format, types, unit tests, production build and both browser suites.
3. Deploy the tested pilot commit; verify Vercel readiness and the public domain.
4. To roll back the web release, restore the previous known-good deployment.
   Leave the additive 0057 migration in place; it does not change existing data
   or old application behavior. Do not drop its table during an incident.

## Release environment follow-up

The public domains still follow a pilot Preview deployment; Vercel's default
Production branch was older main at review time. Adding CI coverage does **not**
make Vercel wait for those checks or enforce a branch protection rule.

Before changing that arrangement, inventory names/scopes (never secret values)
of required environment variables, compare callback URLs and database migration
versions, choose the production branch, and require successful checks before
domain promotion. Use an isolated database and provider sandbox for staging.
Verify a reversible domain/deployment rollback before public self-service launch.
Do not promote the older main build simply because it is labelled Production.

Stripe remains sandbox-only. Meta approval and integration do not block this work.

## Validation

Runtime dependency audit: zero reported vulnerabilities. Format, type checking
and production build passed. Unit suite: 1,458 passed and 85 skipped; the four
additional route outage/exhaustion cases passed in focused runs. Browser suites:
226 passed, 66 skipped (existing environment-dependent skips). New image tests
cover noisy portrait compression, transparency, metadata removal, forged headers
and excessive decoded dimensions. These checks do not replace a full-game test
with physical cameras and microphones or a backup-restore rehearsal.
