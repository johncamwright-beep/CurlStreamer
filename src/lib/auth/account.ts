import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ensureOwnProfile } from "./profile";

export type AccountContext = {
  profile: { display_name: string; status: string };
  membership: null | {
    organization_id: string;
    role: "owner" | "team_admin" | "scorer" | "viewer";
    teamName: string;
  };
};

export async function getAccountContext(user: User): Promise<AccountContext> {
  await ensureOwnProfile(user);
  const db = createAdminSupabaseClient();
  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("display_name,status")
    .eq("user_id", user.id)
    .single();
  if (profileError || !profile) throw new Error("Account could not be loaded");

  const { data: memberships, error: membershipError } = await db
    .from("team_memberships")
    .select("organization_id,role,organizations(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at")
    .limit(1);
  if (membershipError) throw new Error("Team membership could not be loaded");
  const membership = memberships?.[0];
  const organization = membership?.organizations as unknown as {
    name: string;
  } | null;
  return {
    profile,
    membership:
      membership && organization
        ? {
            organization_id: membership.organization_id,
            role: membership.role,
            teamName: organization.name,
          }
        : null,
  };
}

export const readableTeamRole = (role: string) =>
  ({
    owner: "Owner",
    team_admin: "Team administrator",
    scorer: "Scorer",
    viewer: "Viewer",
  })[role] ?? role;
