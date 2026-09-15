# Platform administration and team access

The platform administrator opens **Account & Settings → Platform administration**. This role is stored in `user_platform_roles`, requires an active profile and confirmed email, and is checked on the server and again inside administrative database functions. It is never inferred from a browser flag or a hard-coded email address.

Administrators can search teams and accounts, suspend/reactivate ordinary accounts, adjust team trial expiry, generate single-use trial codes, and revoke unused codes. Dates entered as “valid through” include that day in Toronto. Raw trial codes are returned once when generated; only hashes are stored. Paid checkout remains pending the business and payment-provider setup described in [Trial operations](TRIAL_OPERATIONS.md).

**View as / support** opens a team's settings in a read-only support view. The administrator can explicitly enable edits to team information, public-page settings, social profile links, photos, team access and trial expiry. This does not impersonate a user, replace the administrator's login, or open the entire game dashboard as that user. Administrative views and changes are audited using the administrator's actual identity. Published subdomain addresses remain permanent.

## Team invitations

A team has two login seats: its owner and one additional teammate. Active and suspended memberships occupy seats; removing the teammate frees the seat. An outstanding invitation reserves the second seat until it is accepted, revoked or expires after seven days. The owner cannot be removed or demoted through these controls.

- **Full access:** team settings, team access and subscription controls, plus game operations.
- **Game operations:** schedule/edit games, add opponents while scheduling, score, connect cameras, broadcast and end games. No subscription, team-settings, sponsor-library, YouTube-connection or game-deletion administration.

Create an invitation under **Account & Settings → Team access**. Share the generated link privately with the invited person. Automatic invitation email delivery is not configured; the interface explicitly provides a copyable link. A working Zoho mailbox alone does not configure the application's transactional email provider.

The recipient signs in or creates an account using the invited email and explicitly accepts. Only a verified, active account matching that email can accept, and an account already assigned to another team cannot join. Raw invitation tokens are not stored; the database holds SHA-256 hashes. Acceptance and membership changes lock the organization row; changes recheck the actor's permissions after waiting for that lock.

## Deployment

Apply migration 0051 and commit its enum addition before applying the subsequent migrations. The new role remains unused until an owner creates an invitation. Bootstrap the first platform administrator privately by resolving the explicitly authorized, verified account to its user ID and adding `super_admin`; never put a production email or account ID into a shared migration. Record the grant in `audit_events`.

Use `scripts/check-platform-access.sql` after the migrations for rollback-only checks of role boundaries, recipient matching, invitation seat reservation and the two-login limit. It creates disposable accounts inside a transaction and rolls back all test data. Browser tests use isolated fixtures and do not send real invitations.

Authenticated game creation no longer issues or stores organizer bearer tokens. Game access uses the signed-in membership so removing or suspending a teammate takes effect on subsequent authorized requests.

Validation on September 12, 2026: formatting, TypeScript and production builds passed. The full unit run passed 1,418 tests with one obsolete token-storage assertion; that assertion was corrected and its two-test file passed. Main browser checks passed 160 tests (56 fixture-specific skips), and authenticated account checks passed all 56 tests. Database rollback checks passed before migrations 0051–0055 and the authorized first-administrator grant were applied.
