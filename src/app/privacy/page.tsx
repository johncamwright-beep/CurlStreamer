import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | CurlStreamer",
  description:
    "How CurlStreamer handles account, team and Google/YouTube information, and how to withdraw access or request deletion.",
  alternates: { canonical: "https://www.curlstreamer.app/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <section>
        <h2>Who operates CurlStreamer</h2>
        <p>
          CurlStreamer is provided under the registered Ontario business name
          CURL STREAMER, a sole proprietorship. For privacy questions,
          corrections, support or deletion requests, email{" "}
          <a href="mailto:hello@curlstreamer.app">hello@curlstreamer.app</a>.
          This policy covers the CurlStreamer website, Windows Studio and
          connected team features.
        </p>
      </section>
      <section>
        <h2>Information we handle</h2>
        <ul>
          <li>
            Account details such as your name, email address, sign-in identity,
            team membership and access permissions.
          </li>
          <li>
            Team information you provide, including players, coaches, optional
            player email addresses, logos, photos, sponsors, events, games,
            scores, shot records, coaching reports and news.
          </li>
          <li>
            Connection and technical information needed to operate and
            troubleshoot the service, such as device/session identifiers,
            connection status and error categories. Camera diagnostics are not
            intended to include account passwords, Google tokens or YouTube
            stream keys.
          </li>
          <li>
            Contact details and information you submit when joining the
            waitlist, requesting support, inviting members or sending reports.
          </li>
        </ul>
        <p>
          Studio receives camera and microphone media when you connect devices
          and enable their feeds. Broadcasting sends the selected program video
          and audio to YouTube. A connected IP camera may require local
          credentials stored on the Studio computer.
        </p>
      </section>
      <section>
        <h2>Google sign-in and YouTube access</h2>
        <p>
          Optional Google sign-in provides your Google account identifier, name,
          profile image and email to establish your CurlStreamer account.
          Connecting YouTube is a separate authorization and uses YouTube API
          Services. It lets CurlStreamer identify the selected channel, create
          and update game broadcasts, upload thumbnails, configure streams, and
          start or end broadcasts at your direction.
        </p>
        <p>
          We retain the connected channel identifier/name, authorization status,
          encrypted refresh credentials, and the broadcast identifiers, watch
          links and settings needed for your games. Refresh credentials are kept
          on the server and are not provided to viewers or team members. Google
          permission descriptions may cover additional YouTube actions;
          CurlStreamer uses the permission for its channel and broadcast
          features.
        </p>
        <p>
          CurlStreamer does not sell Google user data, use it for advertising,
          or send it to the coaching report AI. Its use and transfer of
          information received from Google APIs follows the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements. Google and YouTube also
          handle information under the{" "}
          <a href="https://policies.google.com/privacy">
            Google Privacy Policy
          </a>
          .
        </p>
      </section>
      <section>
        <h2>How information is used and shared</h2>
        <p>
          We use information to sign you in, apply team permissions, manage
          games, display team pages, produce broadcasts and reports, send
          requested emails, and maintain and support the service. We do not sell
          personal information.
        </p>
        <p>
          Service providers process information for these functions: Supabase
          for accounts, databases and uploaded media; Vercel for website
          hosting; Google/YouTube for sign-in and broadcasts; LiveKit when its
          media connection features are used; and Zoho for application email.
          Payment features, when offered, use Stripe; CurlStreamer does not
          store full card numbers.
        </p>
        <p>
          When AI coaching reports are enabled and requested, selected shot
          statistics and evidence are sent to OpenAI to generate report
          commentary. Google authorization credentials and YouTube account data
          are not part of that request. An emailed team report goes to the
          recipients selected for that report; an individual report is addressed
          to the selected player. Review recipients before sending.
        </p>
        <p>
          Providers may process information outside your country. We may
          disclose information when required by law or to address misuse and
          protect the service. Access by the operator is limited to service
          administration, support, security and these purposes.
        </p>
      </section>
      <section>
        <h2>Public team pages and recordings</h2>
        <p>
          A published team page can expose team and roster names, coach names,
          photos, news, sponsors, schedules, scores and video links. Player
          email addresses and Google credentials are not shown on public team
          pages. Team administrators choose what to publish and should obtain
          permission from the people shown, including a parent or guardian where
          appropriate for minors.
        </p>
        <p>
          YouTube viewing and recording access depend on the video&apos;s
          visibility settings and YouTube&apos;s own controls. Disconnecting
          CurlStreamer does not delete videos from YouTube. Copies, search
          results, shared links and recordings held by viewers or other services
          may remain after content is removed from CurlStreamer.
        </p>
      </section>
      <section>
        <h2>Cookies and local device storage</h2>
        <p>
          The website uses cookies and local storage to maintain sign-in,
          security, preferences and scoring/connection continuity. Studio stores
          connection preferences and local camera setup on its computer.
          Following links to Google, YouTube or other sites, and using embedded
          third-party content, may let those services collect browser, device
          and usage information under their own policies.
        </p>
      </section>
      <section>
        <h2>Retention, withdrawal and deletion</h2>
        <p>
          We retain account and team records while they are needed to provide
          the service, maintain your team&apos;s history and resolve support
          requests. Google/YouTube credentials are retained while the channel is
          connected. Authorized Google data is deleted when no longer needed,
          and no later than seven calendar days after you revoke consent through
          CurlStreamer. We periodically recheck connected authorizations and
          refresh or remove retained YouTube API information within thirty days.
          Other records may need to be retained for legal, security or
          accounting obligations; backups can remain until they rotate out.
        </p>
        <p>
          A team owner or administrator can withdraw YouTube access in Account
          &amp; Settings → YouTube Settings → Disconnect. Finish any active
          broadcast first. Disconnect requests revocation with Google and
          removes the stored channel authorization. If completion cannot be
          confirmed, CurlStreamer blocks further use of the pending connection
          and offers a retry. If Google remains unreachable, we remove the
          retained authorization data within seven days; you may still need to
          withdraw the Google-side grant yourself. You can also revoke access
          directly in{" "}
          <a href="https://myaccount.google.com/permissions">
            Google Account permissions
          </a>
          .
        </p>
        <p>
          Withdrawal removes stored channel details, provider identifiers and
          automatically created YouTube links from CurlStreamer. Your scores,
          independently entered game information and independently supplied
          video links remain. Links matching videos created by CurlStreamer are
          removed even if you entered them manually. Videos remain on YouTube.
          During a prolonged verification outage, we remove unverified YouTube
          API information to meet the same retention limits; reconnect when the
          connection is available. If you revoke Google access during a live
          broadcast, CurlStreamer may no longer be able to control that
          broadcast; use YouTube Studio to finish it.
        </p>
        <p>
          To request access, correction, account deletion or removal of personal
          information, contact{" "}
          <a href="mailto:hello@curlstreamer.app">hello@curlstreamer.app</a>{" "}
          from your account email. Tell us the account/team and information
          involved; do not send passwords or stream keys. We verify authority
          before processing a request. Removing an individual account does not
          automatically erase another team member&apos;s records or their
          independently supplied game information.
        </p>
      </section>
      <section>
        <h2>Changes and questions</h2>
        <p>
          We will update this page when these practices change and identify the
          revision date above. Contact{" "}
          <a href="mailto:hello@curlstreamer.app">hello@curlstreamer.app</a>{" "}
          with any questions or concerns.
        </p>
      </section>
    </LegalPage>
  );
}
