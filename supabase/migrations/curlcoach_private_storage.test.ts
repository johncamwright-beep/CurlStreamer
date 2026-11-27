import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0058_curlcoach.sql", "utf8");

describe("CurlCoach private storage migration", () => {
  it("requires a live entitlement and an explicit per-user grant", () => {
    expect(sql).toContain("create table public.curlcoach_module_entitlements");
    expect(sql).toContain("create table public.curlcoach_coach_access");
    expect(sql).toContain("expires_at is null or expires_at > now()");
    expect(sql).toContain(
      "raise exception 'explicit curlcoach access required'",
    );
    expect(sql).toContain("public.assert_curlcoach_access");
    expect(sql).not.toContain("team_test_billing");
    expect(sql).not.toContain("stripe_test_events");
  });

  it("keeps coach sessions private and commands durable", () => {
    expect(sql).toContain("unique (organization_id, game_id, actor_user_id)");
    expect(sql).toContain("curlcoach_commands_append_only");
    expect(sql).toContain("curlcoach roster snapshot is immutable");
    expect(sql).toContain("v_session.status <> 'open'");
    expect(sql).toContain("unique (session_id, request_id)");
    expect(sql).toContain("curlcoach revision conflict");
    expect(sql).toContain("return v_command.result_state");
    expect(sql).toContain("command_type in ('command', 'finish', 'reopen')");
  });

  it("permits only trusted server RPC calls and does not touch game scoring", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("grant execute on function");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("score_events");
    expect(sql).not.toContain("game_states");
    expect(sql).not.toContain("game_completions");
  });
});
