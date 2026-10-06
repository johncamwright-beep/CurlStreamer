"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SafeConnection = {
  channelId: string;
  channelTitle: string;
  status: "connected" | "reconnect_required";
  connectedAt: string | null;
  testedAt: string | null;
  lastErrorCode: string | null;
};

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not yet tested";
}

export function YouTubeSettingsControls({
  connection,
  configured,
  canManage,
}: {
  connection: SafeConnection | null;
  configured: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"test" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const disconnectPending = connection?.lastErrorCode === "disconnect_pending";

  async function mutate(action: "test" | "disconnect") {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(
        action === "test"
          ? "/api/settings/youtube/test"
          : "/api/settings/youtube",
        {
          signal: AbortSignal.timeout(15_000),
          method: action === "test" ? "POST" : "DELETE",
          headers: { "x-curlstreamer-request": "youtube-settings" },
        },
      );
      const body = (await response.json()) as {
        message?: string;
        error?: string;
      };
      setMessage(
        body.message ??
          body.error ??
          (response.ok
            ? "YouTube settings updated"
            : "The request failed. Your channel has not been changed. Please try again."),
      );
      if (response.ok) setConfirmDisconnect(false);
      router.refresh();
    } catch {
      setMessage(
        "The request timed out or could not reach CurlStreamer. Refresh this page to check the current channel status before trying again.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!configured)
    return (
      <p
        role="status"
        className="rounded-lg bg-amber-950/50 p-4 text-amber-100"
      >
        YouTube connection is not available yet. Please contact CurlStreamer
        support.
      </p>
    );

  return (
    <div className="grid gap-4">
      <p className="text-sm text-slate-300">
        Before connecting, read the{" "}
        <a className="text-cyan-300 underline" href="/privacy">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a className="text-cyan-300 underline" href="/terms">
          Terms of Service
        </a>
        . By connecting, you accept these policies and the{" "}
        <a
          className="text-cyan-300 underline"
          href="https://www.youtube.com/t/terms"
        >
          YouTube Terms of Service
        </a>
        . CurlStreamer will use the channel you choose to manage your game
        broadcasts and thumbnails. Google authorization is stored encrypted on
        our server. You can withdraw access here or in{" "}
        <a
          className="text-cyan-300 underline"
          href="https://myaccount.google.com/permissions"
        >
          Google Account permissions
        </a>
        .
      </p>
      {connection ? (
        <div className="grid gap-3 rounded-lg border border-slate-700 p-4">
          <dl>
            <dt className="text-sm text-slate-400">Connected channel</dt>
            <dd className="font-bold">{connection.channelTitle}</dd>
            <dt className="mt-3 text-sm text-slate-400">Channel ID</dt>
            <dd className="break-all font-mono text-sm">
              {connection.channelId}
            </dd>
            <dt className="mt-3 text-sm text-slate-400">
              Last connection test
            </dt>
            <dd>{dateLabel(connection.testedAt)}</dd>
          </dl>
          {connection.status === "reconnect_required" && (
            <p role="alert" className="text-amber-200">
              {disconnectPending
                ? "Disconnection is pending. This channel is blocked from further use. Select Retry disconnect to finish revoking access with Google, or contact hello@curlstreamer.app."
                : "YouTube authorization needs attention. Reconnect this channel before a future broadcast."}
            </p>
          )}
          {canManage && confirmDisconnect && (
            <div
              className="rounded-lg border border-amber-700 p-3 space-y-3"
              role="group"
              aria-label="Confirm channel disconnection"
            >
              <p>
                Disconnect {connection.channelTitle} and revoke CurlStreamer’s
                Google access? You will need to reconnect before creating or
                starting broadcasts. Your scores and game records remain, but
                automatically created YouTube links and stored channel details
                will be removed. Recordings remain on YouTube. Unfinished
                broadcasts may prevent disconnection.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn-secondary min-h-11"
                  disabled={busy !== null}
                  onClick={() => setConfirmDisconnect(false)}
                >
                  Keep channel
                </button>
                <button
                  className="btn-secondary min-h-11"
                  disabled={busy !== null}
                  onClick={() => void mutate("disconnect")}
                >
                  Confirm disconnect
                </button>
              </div>
            </div>
          )}
          {canManage && (
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                className="btn-secondary min-h-11"
                disabled={busy !== null || disconnectPending}
                onClick={() => void mutate("test")}
              >
                {busy === "test" ? "Testing…" : "Test connection"}
              </button>
              <a
                className="btn min-h-11 text-center"
                href="/api/settings/youtube/oauth/start"
                aria-disabled={busy !== null || disconnectPending}
                onClick={(event) => {
                  if (busy !== null || disconnectPending)
                    event.preventDefault();
                }}
              >
                Reconnect
              </a>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-red-500 px-4 py-2 text-red-200"
                disabled={busy !== null}
                onClick={() =>
                  disconnectPending
                    ? void mutate("disconnect")
                    : setConfirmDisconnect(true)
                }
              >
                {busy === "disconnect"
                  ? "Disconnecting…"
                  : disconnectPending
                    ? "Retry disconnect"
                    : "Disconnect"}
              </button>
            </div>
          )}
        </div>
      ) : canManage ? (
        <a
          className="btn min-h-11 text-center"
          href="/api/settings/youtube/oauth/start"
        >
          Connect YouTube channel
        </a>
      ) : (
        <p className="text-slate-300">
          A team owner or administrator must connect the team&apos;s YouTube
          channel.
        </p>
      )}
      <p className="text-sm text-slate-400">
        Checks that CurlStreamer can access your saved YouTube channel. No live
        broadcast is started.
      </p>
      <p className="text-sm text-slate-400">
        In Windows Studio, connect or reconnect through this settings page in
        Edge or Chrome. Return to Studio after Google confirms the connection.
      </p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
