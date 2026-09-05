import "server-only";

import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadActiveTeam } from "@/lib/team-games";

export async function requireYouTubeManager(): Promise<User | null> {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) return null;
  const team = await loadActiveTeam(user);
  if (
    team.kind !== "ready" ||
    !["owner", "team_admin"].includes(team.team.role)
  )
    return null;
  return user;
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin;
  return (
    request.headers.get("sec-fetch-site") === "same-origin" ||
    request.headers.get("x-curlstreamer-request") === "youtube-settings"
  );
}
