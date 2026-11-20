import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(
  new URL("./0073_bounded_game_completion_closing.sql", import.meta.url),
  "utf8",
)
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .toLowerCase();
describe("bounded terminal output authority", () => {
  it("retains only an existing delivered output, with matching organization, desktop and broadcast generation", () => {
    expect(sql).toContain(
      "v_output.delivery_recorded_at is null or v_output.phase<>'quarantined'",
    );
    expect(sql).toContain("v_output.organization_id<>v_game.organization_id");
    expect(sql).toContain("v_output.session_id<>v_desktop.session_id");
    expect(sql).toContain(
      "v_output.broadcast_generation<>v_broadcast.operation_generation",
    );
    expect(sql).toContain("v_desktop.generation<>(select max(generation)");
    expect(sql).toContain(
      "authorize_game_completion_actor(p_game_id,p_actor_user_id,p_verified_organizer)",
    );
    expect(sql).toContain(
      "authorize_game_broadcast_actor(p_game_id,v_desktop.approved_by,false)",
    );
  });
  it("creates no new scope and derives an immutable bounded deadline on the server", () => {
    expect(sql).toContain(
      "check(deadline_at = created_at + interval '15 seconds')",
    );
    expect(sql).toContain(
      "if not exists(select 1 from public.game_completions where game_id=p_game_id) then",
    );
    expect(sql).not.toMatch(
      /create (or replace )?function public\.(validate_m4_output_authority|consume_m4_output_delivery|assert_m4_output_delivery|approve_m4_desktop_pairing|write_game_state|append_score_event)/,
    );
    expect(sql).not.toContain("p_deadline");
    expect(sql).not.toContain("update public.game_completion_closing");
    expect(sql).toContain(
      "revoke all on public.game_completion_closing from public,anon,authenticated,service_role",
    );
  });
  it("delete, revoked desktop, stop-requested output and deadline override the terminal exception", () => {
    expect(sql).toContain("new.deleted_at is null and new.status='completed'");
    expect(sql).toContain(
      "v_closing.deadline_at>now() and v_row.status='active' and v_game.deleted_at is null",
    );
    expect(sql).toContain(
      "intent_id=v_closing.intent_id and phase='quarantined'",
    );
    expect(sql).toContain(
      "if v_row.approved_by is not null then begin perform 1 from public.authorize_game_broadcast_actor",
    );
    expect(sql).toContain(
      "exception when insufficient_privilege then v_terminal:=true",
    );
    expect(sql).toContain(
      "case when v_closing_valid then v_closing.deadline_at else now()+interval '30 seconds' end",
    );
  });
  it("requires database-recorded native stop or expiry before provider cleanup", () => {
    expect(sql).toContain(
      "v_grant.deadline_at>now() and v_game.deleted_at is null and v_desktop.status='active'",
    );
    expect(sql).toContain("then return false; end if");
    expect(sql).not.toContain("p_stopped");
  });
  it("desktop grant recovery is read-only and requires current bearer, unrevoked authority and committed terminal state", () => {
    const reader = sql.slice(
      sql.indexOf("create function public.read_m4_completion_closing"),
      sql.indexOf("revoke all on function public.read_m4_completion_closing"),
    );
    expect(reader).toContain(
      "v_desktop.bearer_hash is distinct from p_bearer_hash",
    );
    expect(reader).toContain(
      "v_desktop.status<>'active' or v_desktop.revoked_at is not null",
    );
    expect(reader).toContain(
      "v_game.deleted_at is not null or v_game.completed_at is null or v_game.status<>'completed'",
    );
    expect(reader).toContain("v_grant.deadline_at<=clock_timestamp()");
    expect(reader).toContain(
      "i.phase='quarantined' and i.delivery_recorded_at is not null",
    );
    expect(reader).toContain(
      "authorize_game_broadcast_actor(p_game_id,v_desktop.approved_by,false)",
    );
    expect(reader).toContain(
      "authorize_game_completion_actor(p_game_id,v_completion.completed_by_user_id,false)",
    );
    expect(reader).not.toContain("update public.");
    expect(reader).not.toContain("insert into");
    expect(sql).toContain(
      "revoke all on function public.read_m4_completion_closing(uuid,uuid,bigint,text) from public,anon,authenticated,service_role",
    );
  });
});
