import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0053_game_operator_access.sql",
  "utf8",
);

describe("game operator access migration", () => {
  it("scopes operator authority to game operations", () => {
    expect(sql).toContain("create function public.verified_game_operator");
    expect(sql).toContain("'game_operator'");
    expect(sql).toContain("public.create_scheduled_team_game");
    expect(sql).toContain("public.update_scheduled_team_game");
    expect(sql).toContain("public.claim_scheduled_youtube_broadcast");
    expect(sql).toContain("public.record_scheduled_youtube_broadcast");
    expect(sql).toContain("public.create_team_game");
    expect(sql).toContain("public.find_or_create_opponent");
    expect(sql).not.toContain(
      "create or replace function public.verified_team_for_operation",
    );
  });

  it("does not let an operator restore an archived opponent", () => {
    expect(sql).toContain(
      "if v_role = 'game_operator'::public.team_membership_role then",
    );
    expect(sql).toContain("raise exception 'opponent_unavailable'");
  });

  it("admits the role to broadcast and end-game authorization", () => {
    expect(sql).toContain("m.role in ('owner', 'team_admin', 'game_operator')");
    expect(sql).toContain("authorize_game_completion_actor");
  });
});
