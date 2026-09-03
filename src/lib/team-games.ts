import "server-only";
import { randomUUID } from "crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { GameConfig, GameState } from "@/lib/types";

export type ActiveTeam = {
  organizationId: string;
  role: "owner" | "team_admin" | "scorer" | "viewer";
};

export type TeamGameSummary = {
  game_id: string;
  event_name: string;
  home_name: string;
  away_name: string;
  created_at: string;
  game_status: string;
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
  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) {
    safeDiagnostic("profile", profileError);
    return { kind: "unavailable" };
  }
  if (!profile || profile.status !== "active") return { kind: "inactive" };
  const { data, error } = await db
    .from("team_memberships")
    .select("organization_id,role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(2);
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

function initialState(id: string, config: GameConfig): GameState {
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
  const game = initialState(id, config);
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
