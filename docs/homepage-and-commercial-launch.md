# CurlStreamer homepage and customer journey

Design proposal · September 10, 2026. This is a plan, not a claim that public signup, billing, trials or social publishing are live.

## Review the concept

Open `docs/homepage-concept/index.html` in this checkout. It is a responsive, clickable local homepage concept, with a five-step signup preview and team-feature buttons. It does not collect data, create accounts, take payments or replace the live homepage.

The direction: light, spacious product storytelling with CurlStreamer's dark broadcast surface and cyan branding. Lead with what a supporter sees, explain the equipment, then show the operator experience. Use the actual logo and a real Studio screenshot. The camera diagram and small team-page preview are explicitly illustrative.

## Homepage order and purpose

1. **Header:** CurlStreamer logo at left; How it works, Equipment, Team pages, Get started; Log in at the top right. Once launched, Sign up is the primary button. Signed-in visitors get Open Studio/dashboard instead of losing access to the product website through an automatic redirect.
2. **Hero:** “Bring the rink to everyone.” Explain phones → composed curling broadcast → YouTube. Primary CTA Get started; secondary See how it works. Use a real short, silent rink clip in a broadcast frame with a static fallback. No autoplay sound.
3. **Product overview:** two camera views, live scoring, microphone control, sponsors and the team page. Avoid unsupported reliability, audience or cost claims.
4. **Three-step workflow:** Plan the game → Connect and check → Broadcast and score. Show that reserving a scheduled YouTube link does not start a broadcast.
5. **Equipment diagram:** phone cameras on a reachable local network → Windows Studio → internet upload → YouTube viewers. Include mounts, power, a live-enabled YouTube channel, optional USB receiver/player microphones and optional scorer device. Publish exact hardware/network requirements only after validation; no invented minimum bandwidth or supported receiver list.
6. **Studio tour:** authentic screenshot plus short callouts for score, sponsors, audio and camera controls. Keep the website separate from the native broadcast runtime in the explanation.
7. **Team website:** preview a branded subdomain, games and replays, bio/photo/players, accomplishments, expandable news, photo carousel and sponsor business links. Show visibility controls and explain the permanent subdomain choice before publication.
8. **Social:** profile links are available; Meta account connection, embedded feeds and direct Facebook/Instagram publishing remain planned. Never label planned integrations as available. Google search presentation is controlled by Google, not guaranteed by CurlStreamer.
9. **Get started / pricing:** initially explain the setup journey without a fabricated price or trial promise. When commercial onboarding is ready, this becomes the plan selector and signup CTA.
10. **FAQ and footer:** equipment, network, viewers, remote score, social roadmap, downloads, setup guide, support, privacy and terms. Do not use dead links disguised as working support/legal pages.

## Visual assets for the finished page

- Hero: real game broadcast with both portrait views fully contained, score and sponsor visible. Secure permission for any player imagery used in marketing, especially youth players.
- Equipment: clean diagram, plus actual photos of the tested computer/phone mount/receiver setup. Avoid implying that hardware is included in the subscription.
- Studio: fresh capture with a representative game, connected cameras and readable controls. The prototype uses an existing development capture; it is not a final marketing image.
- Team page: full desktop and mobile capture using approved team content. Sample scores/news in the wireframe are illustrative.
- Workflow: three concise annotated screen captures, not a wall of feature text.
- Compress assets, reserve dimensions to prevent layout jumps, lazy-load below the fold and use a poster for the hero video. Preserve camera and sponsor proportions.

## Sign-in and identity

Offer **Continue with Google**, **Continue with Apple**, and the existing email method on both signup and login. These are alternative ways into the same CurlStreamer account, not separate product editions. Existing Supabase Auth supports these providers; implementation needs provider credentials, registered callback URLs and tested account linking.

Proposed flow:

`Homepage → Sign up → Google / Apple / email → verified identity → create or join team → trial or plan → onboarding checklist`

- Preserve the current email sign-in and recovery path.
- Apple private relay addresses must work. Do not assume Apple returns a name on every login. Ask for the team name explicitly.
- Use provider-supported verified identity linking; do not merge team ownership or subscriptions based on an unverified email. Handle existing invitations and already-signed-in users without creating duplicate organizations.
- Use one canonical auth origin with allowlisted return destinations. Test website, mobile browser and Windows Studio handoff. Avoid trying to set separate authentication on every public team subdomain.
- **Google sign-in does not connect YouTube for broadcasting.** Connect the team's YouTube channel separately during setup, with the appropriate permissions. The same distinction applies to future Meta publishing connections.
- Apple setup requires the relevant Apple identifiers/key and operational credential rotation. Show the live button only when the provider works; prototype buttons are labeled simulations.

References: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase Apple sign-in](https://supabase.com/docs/guides/auth/social-login/auth-apple).

## Trial proposal

Recommend starting with one team subscription rather than charging each scorer or camera device. A possible initial offer is a **14-day trial without a card**, explicitly a proposal to decide after operating costs and testing needs are understood. Keep the trial duration configurable; the homepage must not promise it before policy is approved.

- Start the trial once the verified owner creates the team, and display the exact expiry date in Account & Settings and the setup checklist. Do not restart it on logout, provider changes, reinstall, repeat checkout, subdomain changes or republishing.
- Explain whether the trial includes broadcast access and public-page publication before enrollment. Recommended: include the core workflow so the team can rehearse a real game.
- Before expiry, show a reminder and Choose a plan. Without a card, do not automatically bill. At expiry, retain team data and allow billing/sign-in access; restrict starting new paid operations. Define retention separately.
- Do not cut off an ongoing match in the middle of an end due solely to a trial or renewal boundary. Design an explicit, bounded in-progress-game grace policy and enforce it server-side, rather than permitting indefinite access.
- Decide public-page behaviour after expiry: proposed retain a read-only page for a defined grace period. Do not delete content or release the team's permanent subdomain automatically.
- Trial-abuse controls should be proportionate and server-enforced. Owner/organization history prevents simple resets; email alone does not prove a genuinely new team. Avoid collecting extra personal information without need.

## Subscription & Billing location

Add **Subscription & Billing** to the static Account & Settings menu. Owners manage billing; other roles see only appropriate access information.

Panel layout:

- Current plan and state: Trial, Active, Payment needs attention, Cancels on [date], Expired.
- Trial end or next renewal date, price, billing interval and currency.
- Primary action: Choose plan / Manage subscription / Fix payment.
- Payment method summary and receipt/invoice links from the billing provider; do not store card data in CurlStreamer.
- Cancel subscription with an explicit effective date; cancellation is separate from deleting the team or account.
- Billing contact and ownership transfer need distinct controls and authorization.

## Payment integration proposal

Stripe Checkout + Billing + Customer Portal is a reasonable first candidate: hosted purchase and account management instead of writing our own card form. Final provider, currency, monthly/annual terms, prices, tax handling and refund policy remain decisions; no live Stripe account or products have been created for this proposal.

Architecture:

`Authenticated team owner → server-created Checkout session → provider checkout → signed webhook → subscription record → team feature access`

`Account & Settings → server-created customer portal session → provider-managed billing changes → webhook → updated account state`

- Keep a provider boundary under `src/lib/providers`. Server-only credentials; authorize every checkout/portal action against the current organization and owner role.
- Store provider customer/subscription IDs, organization ID, plan mapping, status, trial end, billing period and cancel-at-period-end. One current entitlement per team; displayed labels are not the authority.
- Use idempotency to avoid duplicate subscriptions. Handle duplicate and out-of-order webhooks by checking authoritative provider state. Never activate solely because the browser reached a success URL.
- Cover unpaid/incomplete checkout, additional payment authentication, renewals, failed payments, retries, cancellation, trial expiry and resubscription.
- Display a pending confirmation state when checkout returns before its webhook. Keep cancellation and failed checkout resumable.
- Choose a grace policy for failed renewal. Existing data and account recovery remain available; billing failures should not silently destroy games or public content.
- Trial end without a payment method must have an explicit pause/cancel policy. Decide when payment details are requested, and describe it in the UI.
- Test with provider sandbox and test clocks before exposing live checkout. Include signature rejection, webhook replay, cross-team access, concurrent checkout and entitlement recovery tests.

References: [Stripe trials](https://docs.stripe.com/billing/subscriptions/trials), [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [customer portal](https://docs.stripe.com/customer-management), [billing testing](https://docs.stripe.com/billing/testing).

## Delivery sequence

1. **Now:** review the local visual concept and proposed journey. The live product continues working.
2. **Marketing foundation:** implement responsive homepage, real visuals, equipment/setup content, accessible navigation and search/share metadata. Keep login top right; public homepage does not depend on an auth service request succeeding.
3. **Identity:** configure Google and Apple, test returning accounts and Studio callback behaviour, retain email fallback.
4. **Commercial sandbox:** implement billing state and trial rules, hosted checkout, portal and webhook handling. Add Subscription & Billing panel. No live charges yet.
5. **Launch readiness:** decide offer, limits, privacy/terms/support, tax/refund policies; publish tested installer with requirements; complete end-to-end purchase → setup → broadcast → renew/cancel rehearsals.
6. **Release:** activate signup/payment CTAs only after that flow is verified. Release Meta integrations separately when approved.

## Decisions for a later review

Price and currency; monthly/annual options; trial length and card policy; feature limits and storage allowance; subscription expiry/grace behaviour; legal business/payment account; support contact; approved marketing footage. These do not block sketching or building the marketing page, but they do block making commercial promises or accepting real payments.
