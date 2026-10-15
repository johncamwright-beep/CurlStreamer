# Coming-soon homepage

The root page is a public product page; existing users sign in at `/login`. Team subdomain routing and authenticated game pages are unchanged. The marketing page uses fictional examples, requires a travel router in its equipment guidance and invites visitors to the pilot waitlist. No trial, payment, social login or public installer is activated.

## Waitlist operation

- Requests are stored in `public.pilot_waitlist` in the existing Supabase project. Authorized project administrators can view them using the Table Editor. No public listing or export endpoint exists.
- Fields: normalized email, optional team name, consent copy version and signup time. Repeated signups do not overwrite the original entry.
- `/api/pilot-waitlist` validates email, consent, origin and body size, and ignores the honeypot field. A service-only RPC enforces five attempts per fingerprint per hour across server instances. Fingerprints use keyed hashes; raw network addresses are not stored in the table. Expired throttle records are removed on subsequent submissions.
- Migration `0046_pilot_waitlist.sql` creates the tables and service-only write function. RLS is enabled and anonymous/authenticated access is revoked. Applied to `hoogvyhuxevihttbutwl` on September 11, 2026.
- The form confirms only a saved request. It does not send confirmation email, create an account, reserve a subdomain or start a subscription. Duplicate submissions receive the same public response.
- No public mailbox is configured yet. The owner is choosing an email provider for the domain. Before sending invitations, configure a monitored sender/reply address and a withdrawal mechanism. Include withdrawal instructions in every pilot email and honor requests against the stored list. Do not send unrelated campaigns using this consent.

The earlier `docs/homepage-concept` is a design artifact. The launched source is `src/components/MarketingHome.tsx`; it deliberately removes the real team screenshot and names used in the earlier wireframe.
