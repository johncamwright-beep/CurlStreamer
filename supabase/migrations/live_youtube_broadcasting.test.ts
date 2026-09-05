import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0021_add_live_youtube_broadcasting.sql",
  "utf8",
).toLowerCase();

describe("live YouTube broadcasting migration", () => {
  it("keeps lifecycle state and provider credentials service-only", () => {
    expect(sql).toContain("alter table public.broadcast_sessions");
    expect(sql).toContain("operation_generation");
    expect(sql).toContain("operation_token");
    expect(sql).toContain("uncertain_since");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
  });

  it("uses state then game then session locks and fences terminal starts", () => {
    const claim = sql.slice(
      sql.indexOf("create function public.claim_game_broadcast_operation"),
      sql.indexOf("create function public.record_game_broadcast_operation"),
    );
    expect(claim.indexOf("from public.game_states")).toBeLessThan(
      claim.indexOf("from public.games"),
    );
    expect(claim.indexOf("from public.games")).toBeLessThan(
      claim.indexOf("from public.broadcast_sessions"),
    );
    expect(sql).toContain("create trigger fence_terminal_game_broadcast");
    expect(sql).toContain("operation_generation = operation_generation + 1");
  });

  it("preserves the provider watch URL in immutable completion storage", () => {
    expect(sql).toContain("coalesce(s.watch_url, r.youtube_watch_url)");
  });

  it("prevents channel replacement while cleanup is unfinished", () => {
    expect(sql).toContain("create trigger guard_youtube_connection_in_use");
    expect(sql).toContain("youtube connection has an unfinished broadcast");
  });
});
