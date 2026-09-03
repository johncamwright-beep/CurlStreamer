import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("./0002_create_game_rpc.sql", import.meta.url),
);
const sql = readFileSync(migrationPath, "utf8")
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const signature = "public.create_game(uuid, jsonb, jsonb)";

describe("create_game migration contract", () => {
  it("defines the provider RPC signature and void response", () => {
    expect(sql).toMatch(
      /create or replace function public\.create_game\( p_game_id uuid, p_config jsonb, p_state jsonb \) returns void/,
    );
    expect(sql).toContain("security definer set search_path = ''");
  });

  it("limits execution to the service role", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sql).toContain(
        `revoke all on function ${signature} from ${role};`,
      );
    }
    expect(sql).toContain(
      `grant execute on function ${signature} to service_role;`,
    );
  });

  it("atomically inserts the game and initial state and reloads PostgREST", () => {
    expect(sql).toContain("insert into public.games");
    expect(sql).toContain("insert into public.game_states");
    expect(sql).toContain("values (p_game_id, p_state)");
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });
});
