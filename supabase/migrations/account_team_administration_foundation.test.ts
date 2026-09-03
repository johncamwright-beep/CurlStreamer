import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("./0005_account_team_administration_foundation.sql", import.meta.url),
);
const sql = readFileSync(migrationPath, "utf8")
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const newTables = [
  "user_profiles",
  "team_memberships",
  "platform_roles",
  "platform_permissions",
  "platform_role_permissions",
  "user_platform_roles",
  "audit_events",
] as const;

describe("account and team administration migration contract", () => {
  it("adds profiles and memberships with auth-user and organization foreign keys", () => {
    expect(sql).toMatch(
      /create table public\.user_profiles \( user_id uuid primary key references auth\.users \(id\)/,
    );
    expect(sql).toMatch(
      /create table public\.team_memberships .* organization_id uuid not null references public\.organizations \(id\).* user_id uuid not null references auth\.users \(id\)/,
    );
    expect(sql).not.toMatch(/insert into public\.team_memberships/);
  });

  it("constrains account, team role, and membership status values", () => {
    expect(sql).toContain(
      "create type public.account_status as enum ( 'active', 'suspended', 'deletion_pending' );",
    );
    expect(sql).toContain(
      "create type public.team_membership_role as enum ( 'owner', 'team_admin', 'scorer', 'viewer' );",
    );
    expect(sql).toContain(
      "create type public.team_membership_status as enum ( 'active', 'suspended', 'removed' );",
    );
  });

  it("allows only one active membership per user and organization", () => {
    expect(sql).toContain(
      "create unique index team_memberships_one_active_per_user_organization on public.team_memberships (organization_id, user_id) where status = 'active';",
    );
  });

  it("transactionally protects the final active owner", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(
      /create trigger protect_final_active_team_owner before update or delete on public\.team_memberships/,
    );
    expect(sql).toContain(
      "raise exception 'an organization cannot lose its final active owner'",
    );
  });

  it("keeps platform roles separate and seeds only the requested roles", () => {
    expect(sql).toContain("create table public.platform_roles");
    expect(sql).toContain("create table public.platform_permissions");
    expect(sql).toContain("create table public.platform_role_permissions");
    expect(sql).toContain("create table public.user_platform_roles");
    const membershipDefinition = sql.match(
      /create table public\.team_memberships \((.*?)\);/,
    )?.[1];
    expect(membershipDefinition).not.toContain("platform_role");
    expect(sql.match(/\('(?:super_admin|support_admin)'/g)).toHaveLength(2);
    expect(sql).not.toMatch(/insert into public\.user_platform_roles/);
  });

  it("enables RLS and denies browser roles on every new table", () => {
    for (const table of newTables) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security;`,
      );
      expect(sql).toMatch(
        new RegExp(
          `revoke all privileges on table .*public\\.${table}(?:,| from)`,
        ),
      );
    }
    expect(sql).not.toMatch(/grant .* to (?:public|anon|authenticated)/);
  });

  it("makes audit events append-only for normal application access", () => {
    expect(sql).toMatch(
      /create trigger prevent_audit_event_changes before update or delete on public\.audit_events/,
    );
    expect(sql).toContain(
      "grant select, insert on table public.audit_events to service_role;",
    );
    expect(sql).not.toMatch(
      /grant [^;]*(?:update|delete)[^;]*public\.audit_events/,
    );
  });

  it("does not modify existing schema objects or RPC permissions", () => {
    expect(sql).not.toMatch(
      /alter table public\.(?:organizations|games|organizer_users)/,
    );
    expect(sql).not.toMatch(
      /(?:alter|revoke|grant).*function public\.(?:create_game|append_score_event)/,
    );
    expect(sql).not.toMatch(
      /(?:update|delete from) public\.(?:organizations|games|organizer_users)/,
    );
  });
});
