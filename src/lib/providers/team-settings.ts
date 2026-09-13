import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadActiveTeam } from "@/lib/team-games";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  defaultTeamPageSettings,
  teamPageSettingsSchema,
} from "@/lib/team-page-settings";
export async function teamSettingsContext(write = false) {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) return null;
  const result = await loadActiveTeam(user);
  if (
    result.kind !== "ready" ||
    (write && !["owner", "team_admin"].includes(result.team.role))
  )
    return null;
  return { user, ...result.team };
}
export async function readTeamSettings(organizationId: string) {
  const db = createAdminSupabaseClient();
  const [profile, organization] = await Promise.all([
    db
      .from("team_public_profiles")
      .select("settings,logo_url")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    db.from("organizations").select("name").eq("id", organizationId).single(),
  ]);
  if (profile.error || organization.error)
    throw Error("Team settings are temporarily unavailable.");
  return {
    settings: profile.data
      ? teamPageSettingsSchema.parse(profile.data.settings)
      : defaultTeamPageSettings(organization.data.name),
    logo: profile.data?.logo_url ?? null,
  };
}
