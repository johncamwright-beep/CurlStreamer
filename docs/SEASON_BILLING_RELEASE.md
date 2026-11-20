# Seasonal access release

## Agreed product rules

- First verified account sign-in starts one seven-day setup trial. Creating another team or signing in again does not restart it.
- Setup trials permit team management and a published team page, but cannot start a broadcast or unlock Shot Tracker.
- Existing, explicitly granted pilot access keeps its original expiry.
- CurlStreamer costs CAD $89 per season. Shot Tracker costs CAD $39 per assigned team member, in addition to a paid base pass. Current team capacity is two people.
- Purchases end at September 1, 00:00 America/Toronto (through August 31). There is no automatic renewal or stored recurring subscription.
- An expired public page is hidden; account, games and private coaching records are retained.
- The owner assigns/transfers purchased coaching seats under Team access. Purchase alone does not assign anybody.

## Configuration and deployment order

1. Verify the additive 0060 and 0061 migrations in a disposable local PostgreSQL database, including role boundaries, trial expiry, payment idempotency, refunds, and seat assignment. Inspect existing pilot and coaching grants before production migration.
2. Apply those migrations before the web release. Do not replay old migration 0050 on production.
3. Create two active one-time CAD prices in Stripe's sandbox: 8900 cents base and 3900 cents per Shot Tracker seat. No recurring price, coupons, automatic tax, or automatic renewal is used by this checkout.
4. Set STRIPE_SEASON_MODE=test and the STRIPE_SEASON_TEST_* values documented in .env.example. Test mode may reuse existing STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET when dedicated test values are empty; live mode never falls back. Use APP_BASE_URL=https://www.curlstreamer.app for the live site's callbacks. These are server-only settings. Never commit keys.
5. Register /api/stripe/season-webhook (or reuse the existing /api/stripe/webhook destination in sandbox with the same signing secret) for checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, charge.refunded, charge.dispute.created and charge.dispute.closed. Retried deliveries must be enabled.
6. Run format, types, unit tests, production build and both browser suites. Perform a signed sandbox checkout/webhook rehearsal. Test payments are administrator-only and must never grant real public-page, broadcast or coach access.
7. Only after business activation and live-mode approval, configure separate STRIPE_SEASON_LIVE_* values and matching live prices/webhook, then switch mode to live. Do not reuse test customer IDs or signing secrets.

## Operational notes

Returning to the account page from checkout is not proof of payment. Access comes only from a verified, reconciled Stripe payment. Refunds and disputes revoke the purchased order; pilot grants remain separate. The owner must reduce assignments if a refund reduces seat capacity.

Taxes and the refund policy need business review before live launch. Do not enable automatic tax without updating amount verification and tests. Existing recurring sandbox subscriptions are legacy test records and are not seasonal entitlements.

A rollback to the previous web deployment does not undo database access rules. Preserve the additive schema and correct a faulty function with a reviewed forward migration; never drop purchases or coaching records as a rollback.

## Validation status

September 21 evening: formatting, TypeScript and production build passed. Full unit suite passed 1,576 tests (93 environment-dependent skips); subsequent provider/webhook/route changes passed 18 focused tests. Disposable PostgreSQL seasonal integration: 2 passed. Browser suites: 164 + 74 passed, 84 environment-dependent skips. Favicon final fallback changes: 5 focused tests passed.

Sandbox products created in account acct_1UF2oOPgssc0VK35:

- Base: price_1UIJh6Pgssc0VK35XsAh7Vpj, CAD 89 one-time.
- Shot Tracker: price_1UIJi9Pgssc0VK35EISxPuTL, CAD 39 one-time.
- Existing sandbox webhook we_1UF3AKPgssc0VK35D1686VRB now listens to 14 events, preserving its original eight and adding the six required seasonal refund/dispute/checkout events.
- Non-secret mode and two price IDs saved in Vercel scoped only to codex/internal-network-pilot. No keys were copied or revealed. Existing test credentials are reused by the prepared code.

September 22: John explicitly approved both production migrations and a Stripe test-mode release. Migrations 0060 and 0061 applied successfully through Supabase SQL Editor. Postflight: all three pilot grants, one coaching entitlement and two account trial clocks are present; three teams retain page access; no seasonal orders or paid grants exist yet. Billing-table RLS is enabled and anonymous checkout execution is denied.

Release 97022c3 is Ready in Vercel (BTWxFNibnvey2qvBFj8X5o593PXS) and serves www.curlstreamer.app. Hosted Stripe sandbox checkout succeeded for CAD 128 (base plus one coaching seat); the order reconciled to paid with season end 2027-09-01 04:00 UTC. A full sandbox refund reconciled it to revoked. Two webhook events were processed, no live orders or paid-access grants were created, and all three pilot grants plus the existing coaching grant remain. Public-page checks passed. No live payments have been enabled.
