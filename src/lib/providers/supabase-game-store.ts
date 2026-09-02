import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameState } from "../types";
import {
  applyGameAction,
  invitationHash,
  newGame,
  type GameStore,
} from "../store";

function configuredClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url && !secret) return undefined;
  if (!url || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !secret)
    throw new Error(
      "Supabase mode requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY",
    );
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseGameStore(client: SupabaseClient): GameStore {
  async function getVersioned(id: string) {
    const { data, error } = await client
      .from("game_states")
      .select("state, version")
      .eq("game_id", id)
      .maybeSingle();
    if (error) throw error;
    return data as { state: GameState; version: number } | null;
  }
  return {
    async createGame(config) {
      const game = newGame(config);
      const { error } = await client.rpc("create_curlcast_game", {
        p_game_id: game.id,
        p_config: config,
        p_state: game,
      });
      if (error) throw error;
      return game;
    },
    async getGame(id) {
      return (await getVersioned(id))?.state;
    },
    async registerInvitation(gameId, token, role) {
      const { error } = await client.from("game_invitations").insert({
        game_id: gameId,
        role: role.replace("-", "_"),
        token_hash: invitationHash(token),
        expires_at: new Date(Date.now() + 1_800_000).toISOString(),
      });
      if (error) throw error;
    },
    async claimRole(id, role, claimant, token) {
      const { data, error } = await client.rpc("claim_game_role", {
        p_game_id: id,
        p_role: role.replace("-", "_"),
        p_claimant: claimant,
        p_token_hash: invitationHash(token),
      });
      if (error) {
        if (error.code === "P0001") return { error: error.message };
        throw error;
      }
      return { game: data as GameState };
    },
    async updateGame(id, action) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await getVersioned(id);
        if (!current) return undefined;
        const next = applyGameAction(current.state, action);
        const added = next.scoreEvents.at(-1);
        const scoreEvent =
          added && current.state.scoreEvents.length < next.scoreEvents.length
            ? added
            : null;
        const { data, error } = await client.rpc("update_curlcast_game", {
          p_game_id: id,
          p_expected_version: current.version,
          p_state: next,
          p_status: next.status,
          p_connection_role:
            action.type === "connection" ? action.role.replace("-", "_") : null,
          p_connected: action.type === "connection" ? action.connected : null,
          p_event_id: scoreEvent?.id ?? null,
          p_event_type: scoreEvent?.type ?? null,
          p_event_payload: scoreEvent ?? null,
        });
        if (!error) return data as GameState;
        if (error.code !== "40001") throw error;
      }
      throw new Error("Concurrent game update could not be committed");
    },
  };
}

export function getSupabaseGameStore() {
  const client = configuredClient();
  return client ? createSupabaseGameStore(client) : undefined;
}
