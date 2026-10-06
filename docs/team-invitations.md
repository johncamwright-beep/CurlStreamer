# Team invitations

The owner enters a contact email and chooses an access level in Team access.
Send invitation creates a seven-day, single-use bearer link and attempts to send
it through Zoho. The recipient creates their own account with any email, verifies
that address, and explicitly joins the existing team. Google sign-in also returns
to the invitation. They do not create a second team or purchase a separate team
subscription. The current two-login limit and one-team-per-account rule remain.

Apply `supabase/migrations/0078_team_invitation_links.sql` before releasing the UI.
Existing pending invitation links also become email-independent. The contact
email remains in the invitation record; membership identifies the actual account.
Expiry, revocation, inviter authority, verified/active accounts, seat limits,
single-use claiming, and audit events remain enforced in PostgreSQL.

## Outgoing mail

Configure these server-only Vercel variables on the deployment environment that
serves the live domain, then redeploy:

- `ZOHO_SMTP_HOST`: use the exact outgoing server shown in Zoho Mail's account settings.
- `ZOHO_SMTP_PORT`: 465 for implicit TLS or 587 for required STARTTLS.
- `ZOHO_SMTP_USER`: full mailbox login address.
- `ZOHO_SMTP_PASSWORD`: dedicated Zoho application-specific password.
- `INVITATION_FROM_EMAIL`: mailbox address or an authorized alias.
- `APP_BASE_URL`: canonical public HTTPS website for invitation links.

Requested sender: hello@curlstreamer.app. Verified in this mailbox’s settings:
outgoing host smtp.zohocloud.ca, port 465 (SSL/TLS). Do not put passwords in this file,
source control, chat, client variables, or logs. SMTP errors are not logged.
See https://www.zoho.com/mail/help/zoho-smtp.html for account/datacenter settings.

Email success means Zoho accepted the message, not verified inbox delivery.
If sending fails or settings are absent, the invitation stays valid and the owner
gets an honest status plus a copyable link. Revoke the invitation to invalidate
it. No automatic retry sends duplicate email after an ambiguous SMTP timeout.
At most ten invitations can be created per team per hour, including revoked
ones. No invitation is emailed on page load. This integration does not change
Supabase's separate signup-confirmation email service.

Validation: unit tests cover TLS, recipient input, provider failures, and missing
configuration. `scripts/check-team-invitations.mjs` exercises the SQL against an
isolated PGlite database (pass the installed PGlite module path as argument).
