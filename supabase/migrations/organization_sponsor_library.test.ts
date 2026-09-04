import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0013_add_organization_sponsor_library.sql",
  "utf8",
);

describe("organization sponsor library migration", () => {
  it("keeps tables and privileged boundaries inaccessible to browser roles", () => {
    expect(sql).toMatch(
      /revoke all on public\.organization_sponsors from public,\s*anon,\s*authenticated/,
    );
    expect(sql).toContain("grant execute on function");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(
      /grant\s+select[^;]+games\s+to\s+(anon|authenticated)/i,
    );
  });

  it("uses empty search paths on every security definer function", () => {
    const functions = sql.split(/create function /i).slice(1);
    expect(functions.length).toBeGreaterThanOrEqual(9);
    for (const fn of functions)
      expect(fn.slice(0, fn.indexOf("$$"))).toMatch(
        /security definer set search_path\s*=\s*''/i,
      );
  });

  it("enforces private constrained storage and deterministic active ordering", () => {
    expect(sql).toMatch(/false,\s*12582912/);
    expect(sql).toMatch(/'image\/jpeg',\s*'image\/png',\s*'image\/webp'/);
    expect(sql).toMatch(/order by s\."position",\s*s\.id/g);
    expect(sql).toMatch(/role in \('owner',\s*'team_admin'\)/);
    expect(sql).toContain("exactly one active team required");
  });

  it("quotes the position output contract and qualifies every column reference", () => {
    expect(sql).not.toMatch(/returns table\([^)]*\bposition integer/i);
    expect(sql.match(/"position" integer/g)).toHaveLength(4);
    expect(sql).not.toMatch(/\b(max|set|by)\s*\(?(position)\b/i);
    expect(sql).not.toMatch(/\belse\s+position\b/i);
    expect(sql).toContain('max(s."position")');
    expect(sql).toContain('set "position"=s."position"+1000000');
  });

  it("resolves token games through a narrow definer boundary", () => {
    expect(sql).toContain("list_game_organization_sponsors");
    expect(sql).toMatch(
      /join public\.games g on g\.organization_id\s*=\s*s\.organization_id/,
    );
  });
});
