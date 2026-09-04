import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  fileURLToPath(
    new URL("./0009_add_seasons_events_opponents.sql", import.meta.url),
  ),
  "utf8",
);
const sql = raw.replace(/\s+/g, " ").toLowerCase();

describe("season, event, and opponent migration", () => {
  it("is one additive migration that leaves existing games and RPC contract intact", () => {
    expect(sql).toContain("alter table public.games add column season_id uuid");
    expect(sql).not.toMatch(/update public\.games|delete from public\.games/);
    expect(sql).not.toContain(
      "create or replace function public.create_team_game",
    );
    expect(sql).toContain("create function public.create_scheduled_team_game");
  });

  it("enforces dates, current-season concurrency, and tenant-consistent references", () => {
    expect(sql).toContain("check (end_date >= start_date)");
    expect(sql).toContain("seasons_one_active_per_organization");
    expect(sql).toContain(
      "pg_advisory_xact_lock(hashtextextended(v_org::text, 9))",
    );
    expect(sql).toContain("foreign key (season_id, organization_id)");
    expect(sql).toContain("foreign key (event_id, organization_id, season_id)");
    expect(sql).toContain("foreign key (opponent_id, organization_id)");
  });

  it("normalizes opponent uniqueness, preserves history, and derives statistics", () => {
    expect(sql).toContain(
      "lower(regexp_replace(btrim(display_name), '\\s+', ' ', 'g'))",
    );
    expect(sql).toContain("unique (organization_id, normalized_name)");
    expect(sql).toContain(
      "references public.opponents (id, organization_id) on delete restrict",
    );
    expect(sql).toContain("count(g.id),max(g.scheduled_start)");
    expect(sql).toContain("'opponent.restored'");
  });

  it("protects scheduling conflicts and timestamptz values", () => {
    expect(sql).toContain("scheduled_start timestamptz");
    expect(sql).toContain("games_event_game_number_unique");
    expect(sql).toContain("game_number is null or game_number > 0");
    expect(sql).toContain("archived_at is null");
  });

  it("uses service-only hardened RPCs and append-only sanitized audits", () => {
    expect(
      sql.match(/security definer set search_path\s*=\s*''/g)?.length,
    ).toBeGreaterThanOrEqual(14);
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("to service_role");
    for (const action of [
      "season.created",
      "season.activated",
      "season.archived",
      "event.created",
      "event.updated",
      "event.archived",
      "opponent.created",
      "opponent.archived",
      "opponent.restored",
      "game.created",
    ])
      expect(sql).toContain(`'${action}'`);
    expect(sql).not.toMatch(/token|secret|credential/);
  });

  it("validates accounts, exact membership cardinality, and permitted roles", () => {
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("if v_count = 0");
    expect(sql).toContain("if v_count > 1");
    expect(sql).toContain("role in ('owner', 'team_admin', 'scorer')");
  });
});
