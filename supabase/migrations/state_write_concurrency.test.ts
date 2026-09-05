import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./0017_add_state_write_concurrency.sql", import.meta.url),
  "utf8",
)
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("state-write concurrency migration", () => {
  it("adds a service-only expected-version state writer", () => {
    expect(sql).toContain(
      "create function public.write_game_state( p_game_id uuid, p_expected_version bigint, p_state jsonb )",
    );
    expect(sql).toContain(
      "where gs.game_id = p_game_id and gs.version = p_expected_version",
    );
    expect(sql).toContain("raise exception 'stale game state for %'");
    expect(sql).toContain("using errcode = '40001'");
    expect(sql).toContain("greatest( gs.version + 1");
    expect(sql).toContain(
      "grant execute on function public.write_game_state(uuid, bigint, jsonb)",
    );
  });

  it("keeps both schedule signatures and commits config through one writer", () => {
    expect(sql).toContain(
      "public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb)",
    );
    expect(sql).toContain("null::jsonb");
    const schedule = sql.indexOf(
      "create function public.update_scheduled_team_game(",
    );
    const stateLock = sql.indexOf(
      "from public.game_states where game_id = p_game_id for update",
      schedule,
    );
    const gameLock = sql.indexOf("from public.games", stateLock);
    expect(stateLock).toBeGreaterThan(schedule);
    expect(gameLock).toBeGreaterThan(stateLock);
    expect(sql).toContain("config = v_new_config");
    expect(sql).toContain("v_new_config := p_config_snapshot");
    expect(sql).toContain(
      "else jsonb_set(state, '{config}', v_new_config, true)",
    );
    expect(sql).toContain("version = greatest( version + 1");
  });

  it("revokes browser database roles from both new RPC surfaces", () => {
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("to authenticated");
    expect(sql).not.toContain("to anon");
  });
});
