import { redirect } from "next/navigation";

import { YouTubeSettingsControls } from "@/components/YouTubeSettingsControls";
import { getAccountContext } from "@/lib/auth/account";
import { youtubeConfigurationStatus } from "@/lib/providers/youtube";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getYouTubeConnection } from "@/lib/youtube-connection";

const resultMessages: Record<string, string> = {
  connected: "YouTube channel connected.",
  cancelled: "YouTube connection was cancelled.",
  oauth_expired: "The connection attempt expired. Please try again.",
  reconnect_required:
    "Google did not return reusable authorization. Please reconnect.",
  scope_missing: "The required YouTube permission was not granted.",
  channel_selection_required:
    "A single owned YouTube channel could not be selected for this account.",
  forbidden: "Team administrator access is required.",
  connection_failed: "YouTube connection failed. Please try again.",
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
      {result && resultMessages[result] && (
        <p role="status" className="rounded-lg bg-slate-800 p-3">
          {resultMessages[result]}
        </p>
      )}
      <YouTubeSettingsControls
        connection={connection}
        configured={youtubeConfigurationStatus()}
        canManage={canManage}
      />
    </section>
  );
}
