# Team public page — initial prototype

Open `prototypes/team-page.html` for the interactive design. All game results, news and schedule entries are explicitly sample content. Controls change the preview only; the save button stores visibility preferences locally. No domain, account, subscription or public content is created by this prototype.

## Requested experience

- Each purchased team may claim a unique subdomain under curlstreamer.app.
- Private by default. Team administrators can publish the page and independently expose upcoming games, final results and YouTube replay links, news, photos, sponsors and social profiles.
- Prominent team logo and sponsor artwork, with a small Curl Streamer attribution.
- News appears newest first. Results use saved game records and their saved YouTube links, with event and optional game number.
- Social profile links are distinct from authenticated social posting connectors. The initial prototype supports profile links only.

## Saved-page navigation

The account settings link opens `/teams/<saved-slug>` on the current application host in the same tab. It appears only after publication has been saved successfully, and unsaved slug or visibility edits do not change its destination. This route does not depend on wildcard DNS/TLS or opening a new window. The branded subdomain remains subject to the infrastructure checks below.

## News editor rollout

Migration `supabase/migrations/0038_team_news_rich_content.sql` was applied to the pilot database on September 10, with transactional checks for legacy-post compatibility, rich content, duplicate retries, stale and cross-team writes, and removal. Test rows were rolled back. It adds nullable structured content and an atomic revision-aware write overload; existing plain-text posts and cover photos continue to render. The composer supports headings, bold, italic, lists, links, photos between paragraphs, undo/redo and preview. Photo uploads require team administrator access, accept validated PNG/JPEG/WebP files up to 4 MB, and use organization-scoped public storage paths. Draft text stays unpublished; uploaded image URLs are public.

The server validates the structured document and the public page renders supported React elements without accepting raw HTML. Preview and public rendering share the same component. Applying database migrations and deploying the website are separate steps.

## Implementation boundaries for the next phase

Store unique, normalized team slugs and publication settings under organization authorization. Reserve application hostnames such as www, api, auth and admin. Verify a team's purchase entitlement before provisioning or publishing a subdomain. Resolve the hostname to a team server-side and expose only explicitly selected public fields; never expose device invitations, microphone controls, credentials, private media or operator routes. Public media must have explicit publication permission and use contained images. Revoking visibility must invalidate cached public pages.

Before activating wildcard team hosts, verify Vercel domain ownership, wildcard DNS/TLS, and host routing. Keep account sign-in and YouTube OAuth on the canonical application host. Public team pages must not require broad wildcard OAuth callbacks. Unknown, unpaid or unpublished slugs should show a neutral unavailable page.

## Related work still tracked

Game creation and opponent saving; removal of legacy route flashes; scoreboard-only remote scoring; clean game completion messaging; individual phone microphone volume; optional game numbers in headings, tiles, results and new YouTube broadcasts; team logo in Studio and broadcast; canonical curlstreamer.app authentication and native Studio configuration; final application checks, deployment and pending desktop installation.

The supplied transparent artwork was found as `C:/GITHuB/CurlStreamer/Team Benning Logo transparent.png`, rather than the dictated filename TeamBanningTransparent.png. Existing game data uses Team Benning, which the prototype preserves. The team slug remains editable in the prototype.
