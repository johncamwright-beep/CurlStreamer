import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const migration = source("./0011_fix_team_hierarchy_game_listing.sql")
  .replace(/\s+/g, " ")
  .toLowerCase();
const loader = source("../../src/lib/team-hierarchy-data.ts");
const service = source("../../src/lib/team-hierarchy-service.ts");

describe("team hierarchy game listing repair", () => {
  it("uses a permitted RPC instead of selecting the hardened games table", () => {
    expect(loader).toContain("listTeamHierarchyGames(user)");
    expect(loader).not.toMatch(/\.from\(["']games["']\)/);
    expect(service).toContain('rpc<unknown[]>("list_team_hierarchy_games"');
  });

  it("derives the organization and returns all hierarchy fields for active games", () => {
    expect(migration).toContain(
      "verified_team_for_operation(p_user_id, false)",
    );
    for (const field of [
      "season_id",
      "event_id",
      "opponent_id",
      "scheduled_start",
      "game_number",
      "game_label",
      "game_status",
      "config",
    ])
      expect(migration).toContain(field);
    expect(migration).toContain("g.organization_id = v_org");
    expect(migration).toContain("g.deleted_at is null");
  });

  it("keeps table access deny-by-default and permits only service-role execution", () => {
    expect(migration).toContain("security definer set search_path = ''");
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.list_team_hierarchy_games(uuid) to service_role",
    );
    expect(migration).not.toMatch(/grant select on (table )?public\.games/);
  });
});
