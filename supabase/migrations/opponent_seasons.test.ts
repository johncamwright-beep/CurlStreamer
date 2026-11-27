import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./0063_opponent_seasons.sql", import.meta.url),
  "utf8",
)
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("opponent season profiles migration", () => {
  it("keeps opponent identity and season history tenant-consistent", () => {
    expect(sql).toContain("create table public.opponent_seasons");
    expect(sql).toContain("foreign key (opponent_id, organization_id)");
    expect(sql).toContain(
      "references public.opponents (id, organization_id) on delete restrict",
    );
    expect(sql).toContain("foreign key (season_id, organization_id)");
    expect(sql).toContain(
      "references public.seasons (id, organization_id) on delete restrict",
    );
    expect(sql).toContain("unique (opponent_id, season_id)");
    expect(sql).toContain(
      "revision integer not null default 1 check (revision >= 1)",
    );
    expect(sql).toContain(
      "from public.games g where g.opponent_id is not null and g.season_id is not null",
    );
    expect(sql).toContain("on conflict (opponent_id, season_id) do nothing");
    expect(sql).not.toMatch(
      /alter table public\.games|update public\.games|delete from public\.games/,
    );
  });

  it("allows only optional canonical roster names and the event-level vocabulary", () => {
    expect(sql).toContain("jsonb_typeof(roster) = 'object'");
    expect(sql).toContain(
      "array['lead', 'second', 'third', 'fourth', 'alternate', 'coach']",
    );
    expect(sql).toContain("jsonb_typeof(value) <> 'string'");
    expect(sql).toContain("length(btrim(value #>> '{}')) > 100");
    expect(sql).toContain("'u15', 'u18', 'u20', 'u25', 'men’s', 'women’s'");
  });

  it("uses server-only organization-scoped reads and compare-and-swap writes", () => {
    expect(sql).toContain("create function public.list_opponent_seasons(");
    expect(sql).toContain("create function public.save_opponent_season(");
    expect(sql).toContain(
      "public.verified_team_for_operation(p_user_id, false)",
    );
    expect(sql).toContain(
      "public.verified_team_for_operation(p_user_id, true)",
    );
    expect(sql).toContain("and os.revision = p_expected_revision");
    expect(sql).toContain("revision = os.revision + 1");
    expect(sql).toContain("p_expected_revision = 0");
    expect(sql).toContain(
      "values (v_org, p_opponent_id, p_season_id, p_level, v_roster, 1)",
    );
    expect(sql).toContain(
      "on conflict on constraint opponent_seasons_opponent_id_season_id_key do nothing",
    );
    expect(sql).toContain(
      "returning opponent_seasons.revision into v_revision",
    );
    expect(sql).toContain("using errcode = '40001'");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("to authenticated");
  });

  it("audits profile changes without recording roster names", () => {
    expect(sql).toContain("'opponent_season.saved'");
    expect(sql).toContain("'has_level', p_level is not null");
    expect(sql).toContain("'revision', v_revision");
    const auditStart = sql.indexOf("'opponent_season.saved'");
    const auditEnd = sql.indexOf("return query", auditStart);
    expect(sql.slice(auditStart, auditEnd)).not.toMatch(
      /lead|second|third|fourth|alternate|coach|roster/,
    );
  });
});
