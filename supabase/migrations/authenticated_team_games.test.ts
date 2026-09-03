import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL("./0008_create_authenticated_team_games.sql", import.meta.url),
  ),
  "utf8",
)
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("authenticated team game migration", () => {
  it("keeps the legacy RPC and existing games untouched", () => {
    expect(sql).not.toContain("create or replace function public.create_game(");
    expect(sql).not.toMatch(/update public\.games|delete from public\.games/);
    expect(sql).not.toContain("insert into public.organizations");
  });

  it("enforces account, membership, role, and organization boundaries", () => {
    expect(sql).toContain("user_profiles");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("role in ('owner', 'team_admin', 'scorer')");
    expect(sql).toContain("organization_id = p_organization_id");
    expect(sql).toContain("active_membership_count > 1");
  });

  it("atomically creates compatibility, game, state, and audit records", () => {
    expect(sql).toContain("insert into public.organizer_users");
    expect(sql).toContain("insert into public.games");
    expect(sql).toContain("insert into public.game_states");
    expect(sql).toContain("'game.created'");
  });

  it("is retry-safe, cross-organization safe, and service-role-only", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("existing_organization_id <> p_organization_id");
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain("from public, anon, authenticated, service_role;");
    expect(sql).toContain("to service_role;");
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });

  it("lists only games in the verified active membership organization", () => {
    expect(sql).toContain("create function public.list_team_games");
    expect(sql).toContain("where g.organization_id = active_organization_id");
  });
});
