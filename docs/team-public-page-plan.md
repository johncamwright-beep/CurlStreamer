# Team public page — initial prototype

Open `prototypes/team-page.html` for the interactive design. All game results, news and schedule entries are explicitly sample content. Controls change the preview only; the save button stores visibility preferences locally. No domain, account, subscription or public content is created by this prototype.

## Requested experience

- Each purchased team may claim a unique subdomain under curlstreamer.app.
- Private by default. Team administrators can publish the page and independently expose upcoming games, final results and YouTube replay links, news, photos, sponsors and social profiles.
- Prominent team logo and sponsor artwork, with a small Curl Streamer attribution.
- News appears newest first. Results use saved game records and their saved YouTube links, with event and optional game number.
- Social profile links are distinct from authenticated social posting connectors. The initial prototype supports profile links only.

## Implementation boundaries for the next phase

Store unique, normalized team slugs and publication settings under organization authorization. Reserve application hostnames such as www, api, auth and admin. Verify a team's purchase entitlement before provisioning or publishing a subdomain. Resolve the hostname to a team server-side and expose only explicitly selected public fields; never expose device invitations, microphone controls, credentials, private media or operator routes. Public media must have explicit publication permission and use contained images. Revoking visibility must invalidate cached public pages.

Before activating wildcard team hosts, verify Vercel domain ownership, wildcard DNS/TLS, and host routing. Keep account sign-in and YouTube OAuth on the canonical application host. Public team pages must not require broad wildcard OAuth callbacks. Unknown, unpaid or unpublished slugs should show a neutral unavailable page.

## Related work still tracked

Game creation and opponent saving; removal of legacy route flashes; scoreboard-only remote scoring; clean game completion messaging; individual phone microphone volume; optional game numbers in headings, tiles, results and new YouTube broadcasts; team logo in Studio and broadcast; canonical curlstreamer.app authentication and native Studio configuration; final application checks, deployment and pending desktop installation.

The supplied transparent artwork was found as `C:/GITHuB/CurlStreamer/Team Benning Logo transparent.png`, rather than the dictated filename TeamBanningTransparent.png. Existing game data uses Team Benning, which the prototype preserves. The team slug remains editable in the prototype.
