import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./0014_read_game_state.sql", import.meta.url),
  "utf8",
)
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("read_game_state migration boundary", () => {
  it("keeps the SECURITY DEFINER function service-role-only", () => {
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain(
      "revoke all privileges on function public.read_game_state(uuid) from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.read_game_state(uuid) to service_role",
    );
    expect(sql).not.toMatch(/grant execute[^;]+to (public|anon|authenticated)/);
  });

  it("exposes one lifecycle outcome and state only for active games", () => {
    expect(sql).toContain("returns table (outcome text, state jsonb)");
    expect(sql).toContain("when g.deleted_at is not null then 'deleted'");
    expect(sql).toContain(
      "when g.status = 'closed' or gs.state->>'status' = 'closed' then 'closed'",
    );
    expect(sql).toContain(
      "when gs.state is null or gs.state->>'status' is distinct from 'active' then 'unavailable'",
    );
    expect(sql).toContain(
      "when g.deleted_at is null and g.status <> 'closed' and gs.state->>'status' = 'active' then gs.state else null",
    );
    expect(sql).toContain("where g.id = p_game_id");
  });
});
