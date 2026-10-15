# Team pilot trials

Teams redeem a single-use code under Account & Settings → Trial & subscription. Access belongs to the organization, not the individual account. Owners and team administrators can redeem codes. Codes require no card and never authorize automatic charges.

The first batch expires at midnight after December 31, 2026, in Toronto (`2027-01-01T05:00:00Z`). Expiry is fixed, not a duration starting at redemption. Current pilot organizations receive that year-end access when migration 0050 is applied; new organizations need a code. Existing data and public pages remain accessible after expiry. Broadcast preparation, going live and delivering a new desktop streaming target require active access. Stops and cleanup remain available; an already-running encoder is not forcibly interrupted at midnight.

## Issue codes manually

Run `node scripts/issue-trial-codes.mjs 10 2026` from the repository. It creates an ignored `work/trial-codes-<timestamp>/` directory containing:

- `register.sql`: apply this in the production Supabase SQL editor to register the hashes and expiry.
- `codes.txt`: hand these codes out privately, one per team, after registration succeeds. Do not commit this file, paste it into public issues or publish it on the website.

The script does not send messages or connect to the database. Raw codes are not stored in the database. Re-running the script creates different codes. A team cannot redeem multiple codes to extend its trial; re-submitting its original code is idempotent. Redemption locks the organization and code rows to prevent concurrent reuse. Revoking an unused code uses its `id` in `team_trial_codes` and sets `revoked_at=now()`; that action does not revoke access already granted to a team.

## Paid subscriptions — pending business setup

Paid checkout and automatic billing are not enabled. An administrator-only Stripe test integration is available once sandbox credentials and a test price are configured; see [Stripe sandbox setup](STRIPE_TEST_SETUP.md). Sandbox subscriptions are stored separately and do not change trial access. Launch pricing and live payment setup remain pending. Live paid access must use verified server-side payment events and handle cancellation and failed renewals, never a browser redirect alone.

## Validation

Migration 0050 was exercised in a rollback transaction against the pilot database: expiry persistence, idempotent redemption, rejection of stacked/expired codes, access rejection at expiry, and private table/function privileges. Test mutations were rolled back. Automated checks cover authenticated redemption, normalized code hashing, safe failures and access denial, plus desktop/mobile account redemption UI.
