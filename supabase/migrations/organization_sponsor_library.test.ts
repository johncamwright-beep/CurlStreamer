import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const directory = join(process.cwd(), "supabase/migrations");
const migration = readFileSync(
  join(directory, "0013_add_organization_sponsor_library.sql"),
  "utf8",
).toLowerCase();

describe("organization sponsor library migration", () => {
  it("is the next sequential migration", () => {
    const numbered = readdirSync(directory)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    expect(numbered.at(-1)).toBe("0013_add_organization_sponsor_library.sql");
  });

  it("uses private storage and an organization-bound server path", () => {
    expect(migration).toContain(
      "'organization-sponsors', 'organization-sponsors', false",
    );
    expect(migration).toContain(
      "storage_path = 'organizations/' || organization_id::text",
    );
    expect(migration).toContain("on delete restrict");
    expect(migration).not.toContain("image/svg+xml");
  });

  it("keeps mutations service-role-only and hardened", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toMatch(
      /revoke all privileges[\s\S]+from public, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(/grant execute[\s\S]+to service_role/);
    expect(migration).not.toMatch(
      /grant (select|insert|update|delete)[^;]+to authenticated/,
    );
  });

  it("checks an active account, exactly one active team, and manager roles", () => {
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain("having count(*) = 1");
    expect(migration).toContain("v_role not in ('owner', 'team_admin')");
  });

  it("supports append-only audited lifecycle operations", () => {
    for (const action of ["create", "replace", "reorder", "archive", "restore"])
      expect(migration).toContain(`'${action}'`);
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain(
      "jsonb_build_object('source', 'sponsor_library')",
    );
  });
});
