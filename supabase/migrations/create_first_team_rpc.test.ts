import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("./0006_create_first_team_rpc.sql", import.meta.url)),
  "utf8",
)
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("first-team RPC migration contract", () => {
  it("atomically creates an organization, active owner membership, and sanitized audit event", () => {
    expect(sql).toContain("insert into public.organizations (name)");
    expect(sql).toMatch(
      /insert into public\.team_memberships .*'owner', 'active'/,
    );
    expect(sql).toContain("'team.created', 'organization'");
    expect(sql).toContain("jsonb_build_object('initial_role', 'owner')");
  });
  it("serializes by verified server-supplied user and safely returns an existing membership", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(
      /where tm\.user_id = p_user_id and tm\.status = 'active'/,
    );
    expect(sql).toContain("if found then return query");
  });
  it("rejects inactive accounts and is service-role only", () => {
    expect(sql).toMatch(/where user_id = p_user_id and status = 'active'/);
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain(
      "grant execute on function public.create_first_team(uuid, text) to service_role",
    );
  });
  it("does not touch games, legacy organizers, or existing authorization RPCs", () => {
    expect(sql).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:games|organizer_users)/,
    );
    expect(sql).not.toMatch(
      /(?:alter|grant|revoke).*public\.(?:create_game|append_score_event)/,
    );
  });
});
