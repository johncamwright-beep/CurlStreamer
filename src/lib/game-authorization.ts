import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadActiveTeam, type ActiveTeam } from "@/lib/team-games";
import { readAccessToken } from "@/lib/tokens";

export type GameAccountRole = ActiveTeam["role"];
export type ExistingAccess = Awaited<ReturnType<typeof readAccessToken>>;
export type GameAuthorization =
  | { ok: true; via: "account"; role: GameAccountRole; organizationId: string }
  | { ok: true; via: "token"; access: ExistingAccess; organizationId: string }
  | { ok: false; reason: "not-found" | "deleted" | "unauthorized" };

/** One authority for the verified-account OR existing-token decision. */
export async function authorizeGame(
  request: Request,
  gameId: string,
  options: {
    accountRoles: readonly GameAccountRole[];
    tokenAllowed: (access: ExistingAccess) => boolean;
  },
): Promise<GameAuthorization> {
  const { data: game, error } = await createAdminSupabaseClient()
    .from("games")
    .select("organization_id,deleted_at")
    .eq("id", gameId)
    .maybeSingle();
  if (error || !game) return { ok: false, reason: "not-found" };
  if (game.deleted_at) return { ok: false, reason: "deleted" };

  try {
    const { data } = await (await createServerSupabaseClient()).auth.getUser();
    if (data.user && game.organization_id) {
      const team = await loadActiveTeam(data.user);
      if (
        team.kind === "ready" &&
        team.team.organizationId === game.organization_id &&
        options.accountRoles.includes(team.team.role)
      ) {
        return {
          ok: true,
          via: "account",
          role: team.team.role,
          organizationId: team.team.organizationId,
        };
      }
    }
  } catch {
    // A missing account session may still use an independently verified token.
  }

  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    try {
      const access = await readAccessToken(bearer);
      if (access.gameId === gameId && options.tokenAllowed(access))
        return {
          ok: true,
          via: "token",
          access,
          organizationId: game.organization_id,
        };
    } catch {
      // Return the same public denial for invalid and inappropriate credentials.
    }
  }
  return { ok: false, reason: "unauthorized" };
}

export function authorizationError(
  result: Extract<GameAuthorization, { ok: false }>,
) {
  if (result.reason === "deleted")
    return {
      error: "This game has been deleted and is unavailable.",
      status: 410,
    };
  if (result.reason === "not-found")
    return { error: "Game not found", status: 404 };
  return { error: "Game access is required", status: 401 };
}

export const operatorRoles = ["owner", "team_admin", "scorer"] as const;
