import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL("./0010_add_recoverable_game_deletion.sql", import.meta.url),
  ),
  "utf8",
)
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("recoverable game deletion migration", () => {
  it("adds soft-deletion data and efficient active/deleted indexes without deleting related data", () => {
    expect(sql).toContain("add column deleted_at timestamptz");
    expect(sql).toContain(
      "deleted_by_user_id uuid references auth.users(id) on delete set null",
    );
    expect(sql).toContain("where deleted_at is null");
    expect(sql).toContain("where deleted_at is not null");
    expect(sql).not.toMatch(
      /delete from public\.(games|game_states|score_events)/,
    );
  });
  it("limits deletion and restoration to a verified owner or team administrator", () => {
    expect(sql).toContain("verified_team_for_operation(p_user_id, false)");
    expect(
      sql.match(/role in \('owner','team_admin'\)/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("g.organization_id=v_org");
  });
  it("is service-only, hardened, idempotent, and auditable", () => {
    expect(
      sql.match(/security definer set search_path = ''/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("and deleted_at is null");
    expect(sql).toContain("and deleted_at is not null");
    expect(sql).toContain("'game.deleted'");
    expect(sql).toContain("'game.restored'");
  });
  it("blocks reliable live state and keeps deleted games out of normal listings", () => {
    expect(sql).toContain("gs.state->>'broadcast'='live'");
    expect(sql).toContain("stop the live session before deleting this game");
    expect(sql).toContain("g.deleted_at is null");
  });
});
