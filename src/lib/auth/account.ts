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

export type AccountContextResult =
  { ok: true; account: AccountContext } | { ok: false };

function logAccountReadFailure(operation: string, error: unknown) {
  const databaseError = error as { code?: unknown; message?: unknown } | null;
  const code =
    typeof databaseError?.code === "string" ? databaseError.code : "unknown";
  const message =
    typeof databaseError?.message === "string"
      ? databaseError.message.replace(/[\r\n\t]/g, " ").slice(0, 160)
      : "unavailable";
  console.error("Account service read failed", { operation, code, message });
}

export async function getAccountContext(
  user: User,
): Promise<AccountContextResult> {
  await ensureOwnProfile(user);
  const db = createAdminSupabaseClient();
  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("display_name,status")
    .eq("user_id", user.id)
    .single();
  if (profileError || !profile) {
    logAccountReadFailure("load_profile", profileError);
    return { ok: false };
  }

  const { data: memberships, error: membershipError } = await db
    .from("team_memberships")
    .select("organization_id,role,organizations(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at")
    .limit(1);
  if (membershipError) {
    logAccountReadFailure("load_membership", membershipError);
    return { ok: false };
  }
  const membership = memberships?.[0];
  const organization = membership?.organizations as unknown as {
    name: string;
  } | null;
  return {
    ok: true,
    account: {
      profile,
      membership:
        membership && organization
          ? {
              organization_id: membership.organization_id,
              role: membership.role,
              teamName: organization.name,
            }
          : null,
    },
  };
}

export const readableTeamRole = (role: string) =>
  ({
    owner: "Owner",
    team_admin: "Team administrator",
    scorer: "Scorer",
    viewer: "Viewer",
  })[role] ?? role;
