import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const teamInvitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export async function readTeamInvitation(token: string, userId?: string) {
  if (!teamInvitationToken.safeParse(token).success) return null;
  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from("team_member_invitations")
    .select(
      "organization_id,role,expires_at,revoked_at,accepted_at,accepted_by",
    )
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (error) throw new Error("Invitation unavailable");
  if (
    !data ||
    data.revoked_at ||
    Date.parse(data.expires_at) <= Date.now() ||
    (data.accepted_at && data.accepted_by !== userId)
  )
    return null;
  const team = await db
    .from("organizations")
    .select("name")
    .eq("id", data.organization_id)
    .single();
  if (team.error) throw new Error("Invitation unavailable");
  return {
    teamName: team.data.name as string,
    role: data.role as string,
    accepted: Boolean(data.accepted_at),
  };
}
