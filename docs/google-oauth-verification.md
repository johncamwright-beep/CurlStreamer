# Google OAuth verification preparation

Status: preparation only. Policies require operator review before publication;
OAuth is still Testing and no verification submission has been sent.

## Application and contacts

- Operator: John Wright; public support/privacy/deletion: hello@curlstreamer.app.
- Google Cloud project: project-a70a5792-ff44-4341-aae.
- Homepage: https://www.curlstreamer.app.
- Intended public policy URLs: https://www.curlstreamer.app/privacy and https://www.curlstreamer.app/terms.
- Actual OAuth support email currently selected: john.cam.wright@gmail.com.
  Google only permits an eligible account/group in that selector. Do not claim
  hello@curlstreamer.app is selected until the console confirms it.
- Identity login uses openid, userinfo.email and userinfo.profile. YouTube
  authorization is a separate explicit team-administrator action.
- YouTube uses youtube.force-ssl (Sensitive). No Restricted scope is configured.

## Scope justification draft

CurlStreamer helps curling teams schedule games and broadcast them on their own
YouTube channel. A team owner or administrator separately connects YouTube,
chooses the channel, and authorizes CurlStreamer to reserve a watch page, create
and bind a live stream, update the game's title/start time/privacy, upload its
team thumbnail, and start/end the broadcast at the user's direction. These are
write operations; youtube.readonly cannot perform them. youtube.upload does not
cover live broadcast and live stream lifecycle operations. youtube.force-ssl is
the documented shared scope for the required liveBroadcasts/liveStreams and
thumbnails operations. The app does not use the permission to manage comments,
ratings or unrelated channel content. Viewer access to a public team page does
not expose Google credentials or require this permission.

Credentials are encrypted on the server and organization-bound. Only authorized
team members can operate the team's broadcasts. The app displays the connected
channel and supports revocation through Disconnect and Google Account permissions.
Disconnect fences further use before revocation and retains an encrypted receipt
only while an interrupted revocation is pending, so the same operation can be
retried safely. Migration 0082 must be applied before releasing this flow.

## Demo recording checklist

Google requires an unlisted YouTube video link showing the complete English
OAuth consent flow and the actual features using each requested permission.
Record with a designated test team/channel and no unrelated personal data.
Do not show passwords, access/refresh tokens, stream keys or developer secrets.
The public OAuth client ID in the browser address bar is required evidence;
it is not a client secret.

1. Show the public homepage and linked Privacy Policy, including the Google-data
   disclosure and withdrawal/deletion instructions.
2. Sign in to CurlStreamer (demonstrate Google identity login if reviewing its branding).
3. Open Account & Settings → YouTube Settings. Show the permission explanation
   and the privacy/terms links before choosing Connect.
4. Use the channel owner's Google account. Show the English Google consent screen,
   app name and requested YouTube permission, and the browser address bar/client ID.
5. Return to CurlStreamer; show the correct connected channel and Test connection.
6. Create an Unlisted demonstration game, reserve its watch page and show the team
   thumbnail. Scheduling alone must not start broadcasting.
7. Open Windows Studio, connect the test camera, prepare/start the broadcast,
   and show the same YouTube watch page receiving the program feed.
8. End that demonstration broadcast, then Disconnect in settings and show the
   disconnected state. Explain Google's alternative permissions-page withdrawal.
9. Upload the screen recording as Unlisted and use that watch URL in the submission.

## Before publishing or submitting

1. Operator reviews and approves the public policy wording. Publish the approved
   pages and verify HTTP 200 without login from the canonical domain.
2. Complete Branding with those URLs and the navy CurlStreamer icon. Check the
   support-email selector and developer contact mailboxes are monitored.
3. Search Console confirmed John Wright's OAuth-project account is a verified
   owner of curlstreamer.app on October 6, 2026. This requirement is satisfied;
   preserve the existing domain verification.
4. Review legacy vercel.app/trycloudflare callback entries against actual running
   environments before removing them. Do not break a running authentication flow.
5. At action time, obtain approval before Audience → Publish app (Testing →
   In production). This materially expands app access beyond the tester list.
6. Submit brand verification and, when approved, publish branding. Complete the
   data-access verification fields with the scope justification and demo link.
   Review all final declarations before Submit for verification.
7. Keep answering Google's review emails. Publishing alone leaves unapproved
   sensitive-scope warnings and the unverified-user cap in place.

## Operator retention and support procedure

See [YouTube authorized-data retention](youtube-authorized-data-retention.md) for
the exact field inventory, migration 0083, daily cron configuration, deadlines,
replay/reservation consequences and production monitoring prerequisites. Complete
those prerequisites before stating retention readiness in the submission.

Monitor hello@curlstreamer.app for deletion/revocation requests and connection
support. Verify the requester's account/team authority before data changes.
Prioritize pending Disconnect operations; finish them or investigate promptly
so authorized Google data is deleted within seven days of an in-app withdrawal.
Google Account permission revocations must also be honored; review invalid-grant
connection failures and remove the affected authorized data within thirty days.
Document completed requests without retaining tokens or private report contents
in diagnostics. Preserve only independently supplied game records or information
required for legal/security/accounting purposes; explain any retention to the requester.

## Official references

- [Google app branding](https://support.google.com/cloud/answer/15549049?hl=en)
- [Google audience and publishing](https://support.google.com/cloud/answer/15549945?hl=en)
- [Sensitive-scope verification and demonstration](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
