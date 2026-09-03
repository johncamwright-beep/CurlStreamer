import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "./0007_allow_service_role_organization_reads.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("service-role organization read migration", () => {
  it("adds the select privilege required by the membership organization join", () => {
    expect(sql).toBe(
      "grant select on table public.organizations to service_role;",
    );
  });

  it("does not grant browser roles or organization mutations", () => {
    expect(sql).not.toMatch(/\bto\s+(?:public|anon|authenticated)\b/);
    expect(sql).not.toMatch(/\b(insert|update|delete|all)\b/);
  });
});
