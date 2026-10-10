import "server-only";
import { randomUUID } from "crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { GameConfig, GameState } from "@/lib/types";

export type ActiveTeam = {
  organizationId: string;
  role: "owner" | "team_admin" | "game_operator" | "scorer" | "viewer";
};

export type TeamGameSummary = {
  game_id: string;
  event_name: string;
  home_name: string;
  away_name: string;
  created_at: string;
  game_status: string;
  deleted_at?: string;
  cleanup_status?: "pending" | "failed" | "complete";
  cleanup_attempts?: number;
  cleanup_last_error?: string | null;
};

function safeDiagnostic(operation: string, error: unknown) {
  const value = error as { code?: unknown } | null;
  console.error("Team game service unavailable", {
    operation,
    code: typeof value?.code === "string" ? value.code : "unknown",
  });
}

export async function loadActiveTeam(
  user: User,
): Promise<
  | { kind: "ready"; team: ActiveTeam }
  | { kind: "inactive" | "no-team" | "multiple-teams" | "unavailable" }
> {
  const db = createAdminSupabaseClient();
  // Both reads are scoped to the verified user and remain fresh per request.
  // Settle both before deciding so membership failures cannot shadow an
  // inactive/unavailable profile or leave an unhandled rejection behind.
  const [profileResult, membershipResult] = await Promise.allSettled([
    Promise.resolve().then(() =>
      db
        .from("user_profiles")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle(),
    ),
    Promise.resolve().then(() =>
      db
        .from("team_memberships")
        .select("organization_id,role")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(2),
    ),
  ]);
  if (profileResult.status === "rejected") {
    safeDiagnostic("profile", profileResult.reason);
    return { kind: "unavailable" };
  }
  const { data: profile, error: profileError } = profileResult.value;
  if (profileError) {
    safeDiagnostic("profile", profileError);
    return { kind: "unavailable" };
  }
  if (!profile || profile.status !== "active") return { kind: "inactive" };
  if (membershipResult.status === "rejected") {
    safeDiagnostic("membership", membershipResult.reason);
    return { kind: "unavailable" };
  }
  const { data, error } = membershipResult.value;
  if (error) {
    safeDiagnostic("membership", error);
    return { kind: "unavailable" };
  }
  if (!data?.length) return { kind: "no-team" };
  if (data.length > 1) return { kind: "multiple-teams" };
  return {
    kind: "ready",
    team: { organizationId: data[0].organization_id, role: data[0].role },
  };
}

export function initialGameState(id: string, config: GameConfig): GameState {
  return {
    id,
    config,
    createdAt: Date.now(),
    scoreEvents: [],
    layout: "split",
    broadcast: "idle",
    status: "active",
    audioMuted: false,
    connections: { "camera-home": false, "camera-away": false, scorer: false },
    claims: {},
    sponsors: [
      {
        id: "sample-ice",
        name: "Community Ice",
        dataUrl: "/sponsors/community.svg",
        enabled: true,
        rotation: 0,
      },
      {
        id: "sample-rock",
        name: "Rock Solid",
        dataUrl: "/sponsors/rock.svg",
        enabled: true,
        rotation: 0,
      },
    ],
    sponsorMode: {
      active: false,
      style: "fullscreen",
      intervalSeconds: 4,
      startedAt: null,
      rotationOffset: 0,
      paused: false,
      mutedPrevious: false,
      muteDuring: true,
    },
  };
}

export async function createAuthenticatedTeamGame(
  user: User,
  config: GameConfig,
) {
  const lookup = await loadActiveTeam(user);
  if (lookup.kind !== "ready") return lookup;
  if (lookup.team.role === "viewer") return { kind: "forbidden" as const };
  const id = randomUUID();
  const game = initialGameState(id, config);
  const { error } = await createAdminSupabaseClient().rpc("create_team_game", {
    p_user_id: user.id,
    p_organization_id: lookup.team.organizationId,
    p_game_id: id,
    p_config: config,
    p_state: game,
  });
  if (error) {
    safeDiagnostic("create", error);
    return { kind: "unavailable" as const };
  }
  return { kind: "created" as const, game };
}

export async function listTeamGames(user: User) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "list_team_games",
    {
      p_user_id: user.id,
    },
  );
  if (error) {
    safeDiagnostic("list", error);
    return { ok: false as const };
  }
  return { ok: true as const, games: (data ?? []) as TeamGameSummary[] };
}

export async function listDeletedTeamGames(user: User) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "list_deleted_team_games_with_cleanup",
    { p_user_id: user.id },
  );
  if (error) {
    safeDiagnostic("list_deleted", error);
    return { ok: false as const };
  }
  return { ok: true as const, games: (data ?? []) as TeamGameSummary[] };
}
