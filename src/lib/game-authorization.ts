import "server-only";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  listDeletedTeamGames,
  listTeamGames,
  loadActiveTeam,
  type ActiveTeam,
} from "@/lib/team-games";
import { getGame } from "@/lib/store";
import { readAccessToken } from "@/lib/tokens";

export type GameAccountRole = ActiveTeam["role"];
export type ExistingAccess = Awaited<ReturnType<typeof readAccessToken>>;
export type GameAuthorization =
  | { ok: true; via: "account"; role: GameAccountRole; organizationId: string }
  | { ok: true; via: "token"; access: ExistingAccess }
  | {
      ok: false;
      reason:
        | "not-found"
        | "deleted"
        | "closed"
        | "released"
        | "unauthorized"
        | "unavailable";
      /** Only a successfully checked, credential-free request may read Broadcast. */
      anonymous?: true;
    };

/** One authority for the verified-account OR existing-token decision. */
export async function authorizeGame(
  request: Request,
  gameId: string,
  options: {
    accountRoles: readonly GameAccountRole[];
    tokenAllowed: (access: ExistingAccess) => boolean;
  },
): Promise<GameAuthorization> {
  let user;
  let anonymous = false;
  let accountUnavailable = false;
  try {
    const { data, error } = await (
      await createServerSupabaseClient()
    ).auth.getUser();
    user = data.user;
    anonymous = !user && (!error || isAuthSessionMissingError(error));
    accountUnavailable = Boolean(error && !isAuthSessionMissingError(error));
    const accountUser = data.user;
    if (accountUser) {
      const team = await loadActiveTeam(accountUser);
      if (team.kind === "unavailable")
        return { ok: false, reason: "unavailable" };
      if (
        team.kind === "ready" &&
        options.accountRoles.includes(team.team.role)
      ) {
        // Use the existing SECURITY DEFINER account boundary. Direct reads of
        // `games` are intentionally revoked from every API role.
        const active = await listTeamGames(accountUser);
        if (!active.ok) return { ok: false, reason: "unavailable" };
        const game = active.games.find(
          (candidate) => candidate.game_id === gameId,
        );
        if (game?.game_status === "closed")
          return { ok: false, reason: "closed" };
        if (game) {
          return {
            ok: true,
            via: "account",
            role: team.team.role,
            organizationId: team.team.organizationId,
          };
        }
        if (["owner", "team_admin"].includes(team.team.role)) {
          const deleted = await listDeletedTeamGames(accountUser);
          if (!deleted.ok) return { ok: false, reason: "unavailable" };
          if (deleted.games.some((candidate) => candidate.game_id === gameId))
            return { ok: false, reason: "deleted" };
        }
      }
    }
  } catch {
    // An independently signed organizer or participant token does not depend
    // on the optional account cookie being readable.
    accountUnavailable = true;
  }

  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    let access;
    try {
      access = await readAccessToken(bearer);
    } catch {
      // Invalid credentials must not be downgraded to an anonymous read.
    }
    if (access?.gameId === gameId && options.tokenAllowed(access)) {
      try {
        const game = await getGame(gameId);
        if (!game) return { ok: false, reason: "not-found" };
        if (game.status === "closed") return { ok: false, reason: "closed" };
        if (
          access.purpose === "participant" &&
          (!access.role ||
            !access.deviceId ||
            game.claims[access.role] !== access.deviceId)
        )
          return { ok: false, reason: "released" };
        return { ok: true, via: "token", access };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    }
  }
  if (accountUnavailable) return { ok: false, reason: "unavailable" };
  // A same-team miss must not reveal a cross-organization game. A truly
  // absent state can still be reported accurately to a verified account.
  if (user) {
    try {
      if (!(await getGame(gameId))) return { ok: false, reason: "not-found" };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }
  return {
    ok: false,
    reason: "unauthorized",
    ...(anonymous && !request.headers.has("authorization")
      ? { anonymous: true as const }
      : {}),
  };
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
  if (result.reason === "closed")
    return { error: "This game is closed", status: 410 };
  if (result.reason === "unavailable")
    return { error: "Game service is temporarily unavailable", status: 503 };
  if (result.reason === "released")
    return { error: "This camera assignment has been released", status: 401 };
  return { error: "Game access is required", status: 401 };
}

export const operatorRoles = ["owner", "team_admin", "scorer"] as const;
