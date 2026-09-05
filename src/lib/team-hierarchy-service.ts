import "server-only";
import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  eventInputSchema,
  opponentInputSchema,
  scheduledGameInputSchema,
  seasonInputSchema,
  type EventInput,
  type OpponentInput,
  type ScheduledGameInput,
  type SeasonInput,
} from "@/lib/team-hierarchy";
import type { GameConfig, GameState } from "@/lib/types";
import { issueOrganizerToken } from "@/lib/tokens";

type Result<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      kind: "authorization" | "validation" | "conflict" | "service";
      issues?: unknown;
    };

function diagnostic(
  operation: string,
  error: { code?: string; message?: string },
) {
  console.error("Team hierarchy service unavailable", {
    operation,
    code: error.code ?? "unknown",
    message: error.message?.replace(/\s+/g, " ").slice(0, 160),
  });
}

function failure(
  error: { code?: string; message?: string },
  operation: string,
): Result<never> {
  diagnostic(operation, error);
  if (error.code === "42501") return { ok: false, kind: "authorization" };
  if (["23505", "23514", "40001", "P0001", "P0002"].includes(error.code ?? ""))
    return { ok: false, kind: "conflict" };
  if (error.code === "22023" || error.code === "22P02")
    return { ok: false, kind: "validation" };
  return { ok: false, kind: "service" };
}

async function rpc<T>(
  operation: string,
  parameters: Record<string, unknown>,
): Promise<Result<T>> {
  const { data, error } = await createAdminSupabaseClient().rpc(
    operation,
    parameters,
  );
  return error ? failure(error, operation) : { ok: true, value: data as T };
}

export function createSeason(user: User, input: SeasonInput) {
  const parsed = seasonInputSchema.safeParse(input);
  if (!parsed.success)
    return Promise.resolve({
      ok: false as const,
      kind: "validation" as const,
      issues: parsed.error.issues,
    });
  return rpc<string>("create_season", {
    p_user_id: user.id,
    p_season_id: randomUUID(),
    p_name: parsed.data.name,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
  });
}

export const listSeasons = (user: User) =>
  rpc<unknown[]>("list_seasons", { p_user_id: user.id });
export const setCurrentSeason = (user: User, seasonId: string) =>
  rpc<null>("set_current_season", {
    p_user_id: user.id,
    p_season_id: seasonId,
  });
export const archiveSeason = (user: User, seasonId: string) =>
  rpc<null>("archive_season", { p_user_id: user.id, p_season_id: seasonId });

export function createEvent(user: User, input: EventInput) {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success)
    return Promise.resolve({
      ok: false as const,
      kind: "validation" as const,
      issues: parsed.error.issues,
    });
  const value = parsed.data;
  return rpc<string>("create_event", {
    p_user_id: user.id,
    p_event_id: randomUUID(),
    p_season_id: value.seasonId,
    p_name: value.name,
    p_event_type: value.eventType,
    p_start_date: value.startDate,
    p_end_date: value.endDate,
    p_location: value.location ?? "",
    p_timezone: value.timezone,
  });
}

export const listEvents = (user: User, seasonId?: string) =>
  rpc<unknown[]>("list_events", {
    p_user_id: user.id,
    p_season_id: seasonId ?? null,
  });
export function updateEvent(user: User, eventId: string, input: EventInput) {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success)
    return Promise.resolve({
      ok: false as const,
      kind: "validation" as const,
      issues: parsed.error.issues,
    });
  const value = parsed.data;
  return rpc<null>("update_event", {
    p_user_id: user.id,
    p_event_id: eventId,
    p_name: value.name,
    p_event_type: value.eventType,
    p_start_date: value.startDate,
    p_end_date: value.endDate,
    p_location: value.location ?? "",
    p_timezone: value.timezone,
  });
}
export const archiveEvent = (user: User, eventId: string) =>
  rpc<null>("archive_event", { p_user_id: user.id, p_event_id: eventId });

export function findOrCreateOpponent(user: User, input: OpponentInput) {
  const parsed = opponentInputSchema.safeParse(input);
  if (!parsed.success)
    return Promise.resolve({
      ok: false as const,
      kind: "validation" as const,
      issues: parsed.error.issues,
    });
  return rpc<unknown[]>("find_or_create_opponent", {
    p_user_id: user.id,
    p_opponent_id: randomUUID(),
    p_display_name: parsed.data.displayName,
  });
}
export const listOpponents = (user: User, includeArchived = false) =>
  rpc<unknown[]>("list_opponents", {
    p_user_id: user.id,
    p_include_archived: includeArchived,
  });
export const setOpponentArchived = (
  user: User,
  opponentId: string,
  archived: boolean,
) =>
  rpc<null>("set_opponent_archived", {
    p_user_id: user.id,
    p_opponent_id: opponentId,
    p_archived: archived,
  });
export const archiveOpponent = (user: User, opponentId: string) =>
  setOpponentArchived(user, opponentId, true);
export const restoreOpponent = (user: User, opponentId: string) =>
  setOpponentArchived(user, opponentId, false);
export const listTeamHierarchy = (user: User) =>
  rpc<unknown>("list_team_hierarchy", { p_user_id: user.id });
export const listTeamHierarchyGames = (user: User) =>
  rpc<unknown[]>("list_team_hierarchy_games", { p_user_id: user.id });

export async function createScheduledTeamGame(
  user: User,
  input: ScheduledGameInput,
  config: GameConfig,
  state: GameState,
) {
  const parsed = scheduledGameInputSchema.safeParse(input);
  if (!parsed.success)
    return Promise.resolve({
      ok: false as const,
      kind: "validation" as const,
      issues: parsed.error.issues,
    });
  const value = parsed.data;
  const created = await rpc<null>("create_scheduled_team_game", {
    p_user_id: user.id,
    p_game_id: state.id,
    p_season_id: value.seasonId,
    p_event_id: value.eventId,
    p_opponent_id: value.opponentId,
    p_scheduled_start: value.scheduledStart,
    p_timezone: value.timezone,
    p_game_number: value.gameNumber,
    p_game_label: "",
    p_config: config,
    p_state: state,
  });
  if (!created.ok) return created;
  return {
    ok: true as const,
    value: { game: state, organizerToken: await issueOrganizerToken(state.id) },
  };
}

export function updateScheduledTeamGame(
  user: User,
  gameId: string,
  input: ScheduledGameInput,
  configSnapshot?: GameConfig,
) {
  const parsed = scheduledGameInputSchema.safeParse(input);
  if (!parsed.success)
    return Promise.resolve({
      ok: false as const,
      kind: "validation" as const,
      issues: parsed.error.issues,
    });
  return rpc<null>("update_scheduled_team_game", {
    p_user_id: user.id,
    p_game_id: gameId,
    p_season_id: parsed.data.seasonId,
    p_event_id: parsed.data.eventId,
    p_opponent_id: parsed.data.opponentId,
    p_scheduled_start: parsed.data.scheduledStart,
    p_game_number: parsed.data.gameNumber,
    p_timezone: parsed.data.timezone,
    p_game_label: "",
    ...(configSnapshot ? { p_config_snapshot: configSnapshot } : {}),
  });
}
