export function YouTubeConnectionGuide({
  channelTitle,
}: {
  channelTitle?: string;
}) {
  return (
    <section
      aria-label="YouTube connection instructions"
      className="rounded-lg border border-slate-700 p-4 space-y-3"
    >
      <h3 className="font-bold text-lg">Connect YouTube in four steps</h3>
      <ol className="list-decimal pl-5 space-y-3 text-sm text-slate-300">
        <li>
          <strong className="text-white">Check your channel.</strong> Open{" "}
          <a
            className="underline"
            href="https://www.youtube.com/account"
            target="_blank"
            rel="noopener noreferrer"
          >
            YouTube account settings
          </a>{" "}
          and check the channel name and the Google email shown there. Your
          channel may use a different email from your CurlStreamer login. Enable
          live streaming in YouTube before your first game.{" "}
          <a
            className="underline"
            href="https://support.google.com/youtube/answer/2474026"
            target="_blank"
            rel="noopener noreferrer"
          >
            YouTube setup help
          </a>
          .
        </li>
        <li>
          <strong className="text-white">
            Choose the correct Google account.
          </strong>{" "}
          Use Connect or Reconnect below. If Google shows the wrong email,
          choose <strong>Use another account</strong>.{" "}
          {channelTitle ? (
            <>
              For this reconnect, select the account and channel for{" "}
              <strong className="text-white">{channelTitle}</strong>.
            </>
          ) : (
            <>Select the channel your team will broadcast on.</>
          )}
        </li>
        <li>
          <strong className="text-white">Approve YouTube access.</strong> Review
          the requested YouTube permissions, then continue in Google.
          CurlStreamer needs this access to create and manage your broadcasts.
          Enter your Google password only on Google’s sign-in page.
        </li>
        <li>
          <strong className="text-white">Return and verify.</strong> Wait until
          CurlStreamer says the channel is connected. Check its name, then press{" "}
          <strong>Test connection</strong>. A successful test confirms account
          access; it does not check cameras or start a stream. Return to Windows
          Studio and refresh its settings when finished.
        </li>
      </ol>
      <p className="text-sm text-cyan-200">
        Using Windows Studio? Complete Google sign-in in Edge or Chrome, signed
        into the same CurlStreamer account. If no browser opens, open
        curlstreamer.app → Account & Settings → YouTube Settings in your
        browser.
      </p>
      <details className="text-sm text-slate-300">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold text-white">
          Need help connecting?
        </summary>
        <div className="space-y-3 pb-2">
          <p>
            <strong>Channel missing or wrong channel:</strong> check the owning
            Google email in YouTube account settings. For a Brand Account, check
            that your Google account manages that channel.{" "}
            <a
              className="underline"
              href="https://support.google.com/youtube/answer/3046478"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google’s channel-selection help
            </a>
            .
          </p>
          <p>
            <strong>Google says the app is unverified:</strong> pilot users may
            see this while Google’s review is incomplete. Confirm the app is
            CurlStreamer / curlstreamer.app and review the permissions. If
            Google blocks access, contact support rather than repeatedly
            retrying.
          </p>
          <p>
            <strong>Cancelled or expired:</strong> return here and start a fresh
            reconnect. Finish in the same browser without opening several
            connection attempts at once.
          </p>
          <p>
            <strong>Live streaming not enabled:</strong> enable it in YouTube
            Studio ahead of your first game; first-time activation can take up
            to 24 hours. Connection verification alone does not confirm
            live-stream eligibility.
          </p>
          <p>
            <strong>Changing channels:</strong> Reconnect restores the channel
            shown here. To use another channel, resolve unfinished broadcasts,
            disconnect, then connect the new channel. Saved games are not
            deleted.
          </p>
          <a
            className="inline-flex min-h-11 items-center underline"
            href="mailto:support@curlstreamer.app"
          >
            Contact CurlStreamer support
          </a>
        </div>
      </details>
    </section>
  );
}
