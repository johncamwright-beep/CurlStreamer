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
  const [message, setMessage] = useState<string | null>(null);

  async function mutate(action: "test" | "disconnect") {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(
        action === "test"
          ? "/api/settings/youtube/test"
          : "/api/settings/youtube",
        {
          method: action === "test" ? "POST" : "DELETE",
          headers: { "x-curlstreamer-request": "youtube-settings" },
        },
      );
      const body = (await response.json()) as {
        message?: string;
        error?: string;
      };
      setMessage(body.message ?? body.error ?? "YouTube settings updated");
      router.refresh();
    } catch {
      setMessage("YouTube settings are temporarily unavailable");
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
              YouTube authorization needs attention. Reconnect this channel
              before a future broadcast.
            </p>
          )}
          {canManage && (
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                className="btn-secondary min-h-11"
                disabled={busy !== null}
                onClick={() => void mutate("test")}
              >
                {busy === "test" ? "Testing…" : "Test connection"}
              </button>
              <a
                className="btn min-h-11 text-center"
                href="/api/settings/youtube/oauth/start"
              >
                Reconnect
              </a>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-red-500 px-4 py-2 text-red-200"
                disabled={busy !== null}
                onClick={() => void mutate("disconnect")}
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
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
      {message && <p role="status">{message}</p>}
    </div>
  );
}
