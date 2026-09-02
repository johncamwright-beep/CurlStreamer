import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/0001_initial.sql", import.meta.url),
  "utf8",
);

describe("Supabase game persistence migration", () => {
  it("defines atomic claim and versioned game-update functions", () => {
    expect(migration).toContain("create function claim_game_role");
    expect(migration).toContain("for update");
    expect(migration).toContain("create function update_curlcast_game");
    expect(migration).toContain("version = p_expected_version");
    expect(migration).toContain("errcode = '40001'");
  });

  it("enables RLS and prevents browser roles from executing game functions", () => {
    for (const table of [
      "games",
      "game_states",
      "game_invitations",
      "game_role_claims",
      "participant_connections",
      "score_events",
    ])
      expect(migration).toContain(
        `alter table ${table} enable row level security`,
      );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });
});
