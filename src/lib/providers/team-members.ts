import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
export const memberActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("invite"),
      email: z.string().trim().email().max(254),
      role: z.enum(["team_admin", "game_operator"]),
    })
    .strict(),
  z
    .object({ action: z.literal("revokeInvite"), invitationId: z.uuid() })
    .strict(),
  z.object({ action: z.literal("remove"), membershipId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("role"),
      membershipId: z.uuid(),
      role: z.enum(["team_admin", "game_operator"]),
    })
    .strict(),
]);
export async function manageMember(
  userId: string,
  body: z.infer<typeof memberActionSchema>,
  baseUrl: string,
  organizationId?: string,
) {
  const token =
    body.action === "invite"
      ? randomBytes(32).toString("base64url")
      : undefined;
  const { error } = await createAdminSupabaseClient().rpc(
    "manage_team_member",
    {
      p_user: userId,
      p_action: body.action,
      ...(organizationId ? { p_org: organizationId } : {}),
      ...(body.action === "invite"
        ? {
            p_email: body.email,
            p_role: body.role,
            p_hash: createHash("sha256").update(token!).digest("hex"),
          }
        : body.action === "revokeInvite"
          ? { p_id: body.invitationId }
          : {
              p_id: body.membershipId,
              ...(body.action === "role" ? { p_role: body.role } : {}),
            }),
    },
  );
  if (error)
    throw Object.assign(Error("Member change failed"), { code: error.code });
  if (!token) return { saved: true };
  const url = new URL("/join-team", baseUrl);
  url.searchParams.set("token", token);
  // A copyable link is always available; transactional invitation email is not configured yet.
  return { inviteUrl: url.toString(), emailSent: false };
}
