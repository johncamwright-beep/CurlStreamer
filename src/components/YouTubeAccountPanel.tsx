import { YouTubeConnectionGuide } from "./YouTubeConnectionGuide";
import { redirect } from "next/navigation";

import { YouTubeSettingsControls } from "@/components/YouTubeSettingsControls";
import { getAccountContext } from "@/lib/auth/account";
import { youtubeConfigurationStatus } from "@/lib/providers/youtube";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getYouTubeConnection } from "@/lib/youtube-connection";

const resultMessages: Record<string, string> = {
  connected:
    "YouTube channel connected. Check the channel name below, then select Test connection.",
  cancelled: "YouTube connection was cancelled.",
  oauth_expired: "The connection attempt expired. Please try again.",
  reconnect_required:
    "Google authorization needs renewing. Start Reconnect again and approve the requested YouTube access.",
  scope_missing:
    "YouTube permission was not granted. Reconnect and approve the requested YouTube access in Google.",
  channel_selection_required:
    "Google did not return one YouTube channel. Check the Google email in YouTube account settings, then reconnect with the account that owns or manages your channel.",
  forbidden: "Team administrator access is required.",
  channel_mismatch:
    "The Google account selected a different YouTube channel. Your existing channel was kept. Reconnect using the Google account for the channel shown below; choose Use another account if needed.",
  connection_in_use:
    "This channel is still linked to unfinished broadcasts. Reconnect the same channel to restore access. Resolve unfinished broadcasts before disconnecting or changing channels.",
  configuration_unavailable:
    "YouTube sign-in is temporarily unavailable because CurlStreamer needs a configuration update. Contact support; changing your Google password will not fix this.",
  start_failed:
    "YouTube sign-in could not start. Refresh this page and try again. If it keeps happening, contact support.",
  provider_unavailable:
    "Google could not be reached. Your existing channel was kept. Wait a moment, then start a fresh reconnect.",
  provider_rejected:
    "Google could not complete this connection. Check the selected account and permissions, then reconnect. Contact support if it repeats.",
  quota_exceeded:
    "YouTube’s request limit has been reached. Try later; you do not need to disconnect your channel.",
  connection_failed:
    "The connection could not be confirmed. Check the channel shown below and test it before starting a fresh reconnect. Contact support if the problem repeats.",
};

const withdrawalMessages: Record<string, string> = {
  revocation_unconfirmed_data_removed:
    "CurlStreamer removed the stored YouTube authorization and automatically created video links after an interrupted disconnect. Google-side revocation could not be confirmed. Remove CurlStreamer in Google Account permissions or contact hello@curlstreamer.app.",
  authorization_revoked_use_youtube_studio:
    "Your YouTube authorization is no longer valid. CurlStreamer removed the stored channel data and automatically created video links. If a broadcast is still running, finish it in YouTube Studio and resolve the unfinished broadcast in CurlStreamer before reconnecting.",
  authorization_unverified_data_removed:
    "CurlStreamer could not reconfirm your YouTube connection within its retention period and removed the stored channel data and automatically created video links. Check Google Account permissions, then reconnect when the connection is available. If a broadcast is still running, finish it in YouTube Studio and resolve the unfinished broadcast in CurlStreamer first.",
};

export async function YouTubeAccountPanel({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const accountResult = await getAccountContext(user);
  if (!accountResult.ok)
    return (
      <p role="alert">
        YouTube settings are temporarily unavailable. Please refresh to try
        again.
      </p>
    );
  const membership = accountResult.account.membership;
  if (!membership || accountResult.account.profile.status !== "active")
    redirect("/account");
  const canManage = ["owner", "team_admin"].includes(membership.role);
  let row: Awaited<ReturnType<typeof getYouTubeConnection>> = null;
  try {
    row = await getYouTubeConnection(user);
  } catch {
    return (
      <p role="alert">
        YouTube settings are temporarily unavailable. Please refresh to try
        again.
      </p>
    );
  }
  const connection =
    row?.channel_id &&
    row.channel_title &&
    row.connection_status !== "disconnected"
      ? {
          channelId: row.channel_id,
          channelTitle: row.channel_title,
          status: row.connection_status,
          connectedAt: row.connected_at,
          testedAt: row.tested_at,
          lastErrorCode: row.last_error_code,
        }
      : null;
  const result = (await searchParams).result;
  return (
    <section className="grid gap-5">
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-cyan-300">
          Team settings
        </p>
        <h2 className="text-xl font-bold">YouTube Settings</h2>
        <p className="mt-2 text-slate-300">
          Connect one YouTube channel for {membership.teamName}. Future games
          will use this team-owned connection.
        </p>
      </div>
      {result &&
        resultMessages[result] &&
        (result !== "connected" || connection?.status === "connected") && (
          <p role="status" className="rounded-lg bg-slate-800 p-3">
            {resultMessages[result]}
          </p>
        )}
      {canManage && (
        <YouTubeConnectionGuide channelTitle={connection?.channelTitle} />
      )}
      {row?.last_error_code && withdrawalMessages[row.last_error_code] && (
        <div
          role="alert"
          className="grid gap-2 rounded-lg bg-amber-950/50 p-4 text-amber-100"
        >
          <p>{withdrawalMessages[row.last_error_code]}</p>
          <div className="flex flex-wrap gap-4">
            <a
              className="inline-flex min-h-11 items-center underline"
              href="https://myaccount.google.com/permissions"
            >
              Google Account permissions
            </a>
            <a
              className="inline-flex min-h-11 items-center underline"
              href="https://studio.youtube.com"
            >
              YouTube Studio
            </a>
          </div>
        </div>
      )}
      <YouTubeSettingsControls
        connection={connection}
        configured={youtubeConfigurationStatus()}
        canManage={canManage}
      />
    </section>
  );
}
