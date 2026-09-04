import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  fileURLToPath(
    new URL("./0012_support_flexible_game_scheduling.sql", import.meta.url),
  ),
  "utf8",
);
const sql = raw.replace(/\s+/g, " ").toLowerCase();

describe("flexible game scheduling migration", () => {
  it("adds playoff and supports real season-only/TBD games", () => {
    expect(sql).toContain(
      "alter type public.event_type add value if not exists 'playoff'",
    );
    expect(sql).toContain("p_event_id is null");
    expect(sql).toContain("p_opponent_id is not null");
    expect(sql).toContain("'single_game'");
    expect(sql).not.toContain("opponent record named");
  });
  it("keeps the deployed create RPC and adds a service-only overload and editor", () => {
    expect(sql).not.toContain(
      "drop function public.create_scheduled_team_game",
    );
    expect(sql).toContain("create function public.update_scheduled_team_game");
    expect(sql).toContain("security definer set search_path=''");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("to service_role");
  });
  it("validates tenant boundaries, archives, scoring lifecycle, and audits", () => {
    expect(sql).toContain("public.verified_team_for_operation(p_user_id,true)");
    expect(sql).toContain("organization_id=v_org");
    expect(sql).toContain("status<>'archived'");
    expect(sql).toContain("archived_at is null");
    expect(sql).toContain("event_type='end'");
    expect(sql).toContain("'game.schedule_updated'");
    expect(sql).toContain("'game.opponent_assigned'");
  });
});
