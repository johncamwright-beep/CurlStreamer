import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0020_add_team_youtube_connection.sql",
  "utf8",
);

describe("team YouTube connection migration", () => {
  it("keeps credentials and OAuth attempts service-only", () => {
    expect(sql).toMatch(
      /alter table public\.youtube_oauth_states enable row level security/,
    );
    expect(sql).toMatch(
      /revoke all on public\.youtube_oauth_states from public, anon, authenticated, service_role/,
    );
    expect(sql).not.toMatch(
      /grant\s+(select|insert|update|delete)[^;]+broadcast_settings/i,
    );
    expect(sql).not.toMatch(
      /grant execute[^;]+youtube_team[^;]+to service_role/i,
    );
  });

  it("requires a verified active owner or administrator for every credential mutation", () => {
    expect(sql).toContain("email_confirmed_at is not null");
    expect(sql).toContain("status = 'active'");
    expect(sql).toMatch(/role in \('owner', 'team_admin'\)/);
    for (const functionName of [
      "begin_youtube_oauth",
      "consume_youtube_oauth",
      "get_youtube_credentials",
      "complete_youtube_connection",
      "finish_youtube_connection_test",
      "disconnect_youtube_connection",
    ]) {
      const body = sql.slice(
        sql.indexOf(`create function public.${functionName}`),
      );
      expect(body.slice(0, body.indexOf("end $$;"))).toContain(
        "public.youtube_team(p_user_id, true)",
      );
    }
  });

  it("binds delayed callback and test writes to organization and version", () => {
    expect(sql).toMatch(/v_org <> p_expected_organization_id/g);
    expect(sql).toMatch(/v_version <> p_expected_version/);
    expect(sql).toMatch(/connection_version = p_expected_version/);
    expect(sql).toMatch(
      /connection_version = broadcast_settings\.connection_version \+ 1/,
    );
    expect(sql).toContain(
      "delete from public.youtube_oauth_states where organization_id = v_org",
    );
  });

  it("returns only a safe connection DTO to ordinary reads", () => {
    const safeRead = sql.slice(
      sql.indexOf("create function public.get_youtube_connection"),
      sql.indexOf("create function public.begin_youtube_oauth"),
    );
    expect(safeRead).not.toContain("encrypted_credentials text");
    expect(safeRead).not.toContain("encode(b.encrypted_credentials");
  });
});
