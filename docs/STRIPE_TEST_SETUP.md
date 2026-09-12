# Stripe sandbox setup

This release supports **test billing only**. It rejects live API keys, prices,
Checkout Sessions and webhook events. Only a platform administrator who also has
full team access can open test checkout or the customer portal. Regular teams
continue to use trial codes without supplying a card.

Test subscriptions are stored in `team_test_billing`, separately from
`team_access`. They never grant, extend or revoke broadcast access. Paid access
and live payments need a separate release and explicit approval. No subscription
price has been selected for launch.

## Connect a Stripe sandbox

1. Sign into or create the business's Stripe account and select its sandbox/test
   environment. Do not activate live payments or choose a paid monthly Billing
   contract for this work.
2. Create a test product and one CAD recurring price (monthly or annual, quantity
   one, fixed amount). Use an explicitly named test product, not an announced
   launch price.
3. Configure the sandbox customer portal to allow payment-method updates,
   invoice history and cancellation at the end of the billing period. Keep plan
   switching disabled for this single-price test.
4. Add an HTTPS webhook destination at
   `https://www.curlstreamer.app/api/stripe/webhook`. Subscribe to
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`
   and `invoice.payment_failed`. Match the API version to the installed Stripe
   SDK when configuring the endpoint.
5. Apply migration `0056_stripe_test_billing.sql`. In Vercel's server environment,
   set `STRIPE_SECRET_KEY` to the **test** secret key,
   `STRIPE_TEST_PRICE_ID` to the test price ID and `STRIPE_WEBHOOK_SECRET` to the
   signing secret for that webhook endpoint. These are server-only values; never
   use a `NEXT_PUBLIC_` prefix or commit credentials.
6. Set `STRIPE_TEST_ENABLED=true`, ensure `APP_BASE_URL` is the canonical app
   origin, and redeploy. Leave the flag false until all configuration is ready.
7. Open Account & Settings → Trial & subscription using the platform administrator
   account. Use Stripe's documented test card details only.

The account page displays the configured test price, subscription status and
period end. Returning from Checkout does not imply success: the UI asks the user
to refresh, and only a signature-verified webhook reconciles stored status.
Stripe is queried for current subscription state under a database lease, so
duplicate and older events cannot blindly restore a stale status. Failed
processing returns a retryable error; expired leases recover after two minutes.

Checkout conservatively refuses a new subscription while an earlier session or
payment is unresolved. Immediate resubscription after cancellation can remain
blocked until Stripe expires its original idempotency response. A test account
with more than 100 subscription/session records requires review rather than
silently ignoring older records.

## Acceptance checks before enabling real payments

- Complete test checkout and verify the webhook records the subscription.
- Repeat checkout clicks and verify there is only one subscription.
- Use the portal to schedule cancellation and verify the period-end indicator.
- Simulate renewal success and payment failure; confirm the status updates.
- Retry duplicate and out-of-order webhook events.
- Verify a game operator and a different team's account cannot manage billing.
- Verify live keys/events are rejected and test payments never alter trial access.

Before launch, choose pricing and taxes, complete Stripe business/payout setup,
define the failed-payment/grace-period policy, implement verified **live** paid
entitlements and reconciliation, then explicitly enable real checkout. Trial
codes do not authorize automatic charges; teams must choose a paid subscription.

References: [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks),
[testing](https://docs.stripe.com/billing/testing),
[customer portal](https://docs.stripe.com/customer-management/integrate-customer-portal),
[signature verification](https://docs.stripe.com/webhooks/signature).

## Validation — September 12, 2026

Formatting, TypeScript and production builds passed. Unit checks passed 1,442
tests (85 environment-dependent skips). Main browser checks passed 160 tests
(64 authenticated-fixture skips). The account suite passed 62 tests initially;
two new tests had a locale-specific currency assertion, which was corrected,
then all eight billing browser tests passed on desktop and mobile. Rollback-only
database checks passed before migration 0056 was applied. No real Stripe account
or sandbox credentials were connected during these checks; checkout and portal
browser tests use explicit fixtures, while webhook tests verify real signatures
using the Stripe SDK.
