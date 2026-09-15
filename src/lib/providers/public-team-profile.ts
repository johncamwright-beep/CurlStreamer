import "server-only";
import { cache } from "react";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { teamPageSettingsSchema } from "@/lib/team-page-settings";

export const readPublishedTeamProfile = cache(async (slug: string) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const { data, error } = await createAdminSupabaseClient()
    .from("team_public_profiles")
    .select("organization_id,settings,logo_url")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = teamPageSettingsSchema.safeParse(data.settings);
  if (!parsed.success || !parsed.data.published) return null;
  return {
    organization_id: data.organization_id as string,
    logo_url: data.logo_url as string | null,
    settings: parsed.data,
  };
});
