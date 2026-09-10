# Meta connection setup

Created a separate **Curl Streamer** business portfolio (2171994666680935) and **Curl Streamer** developer app (1397984978367536) on 2026-09-10. The app contact retains the Facebook account's prefilled address, ringowright@hotmail.com. The app is unpublished.

Enabled use cases: Manage messaging & content on Instagram, Manage everything on your Page, and Embed Facebook, Instagram and Threads content in other websites. Facebook Login for Business appears in the app dashboard.

Dashboard: https://developers.facebook.com/apps/1397984978367536/dashboard/
Business settings: https://business.facebook.com/latest/settings/?business_id=2171994666680935

## Still required

- Business verification and App Review; Meta also displays a Tech Provider access-verification path for serving other businesses.
- Configure a server-side OAuth start/callback flow with short-lived, single-use state tied to the signed-in team administrator. Store encrypted account tokens server-side; never expose them to the browser.
- Let each team choose its permitted Facebook Page and professional Instagram account after consent; support disconnect and revoked/expired permissions.
- Add a reviewed privacy policy/data-deletion flow and configure allowed app domains/redirects.
- Implement feed retrieval and publishing with explicit user confirmation, idempotent post records, photo processing, provider errors and status recovery.

The current account controls save social **profile links only**. Disabled connector buttons are intentional. Game summaries currently post to the team's own news page, not Facebook or Instagram. No Meta tokens or secrets have been retrieved or installed.

## Public team page foundation

Migration 0036 was applied to the active Supabase project. Account settings and logo upload are restricted to active owner/team-admin membership. Public pages are private by default, under `/teams/{slug}` and `{slug}.curlstreamer.app`, with section visibility controls. Wildcard DNS/TLS and the narrow wildcard deployment-protection exception are configured for the pilot deployment. Public pages expose selected summaries, never camera invitations or controls.

Payment/subscription entitlement checks remain a future commercial-release requirement; the pilot currently uses team administrator authorization. Logo and posted photo assets use the public team-media bucket; unpublishing a page hides the page but does not revoke already shared media URLs.
