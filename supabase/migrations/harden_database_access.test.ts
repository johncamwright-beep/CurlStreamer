import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("./0004_harden_database_access.sql", import.meta.url),
);
const sql = readFileSync(migrationPath, "utf8")
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const tables = [
  "organizations",
  "organizer_users",
  "broadcast_settings",
  "games",
  "game_invitations",
  "camera_assignments",
  "score_events",
  "game_states",
  "broadcast_sessions",
  "health_events",
  "sponsor_assets",
  "sponsor_libraries",
  "game_sponsors",
  "sponsor_display_settings",
  "sponsor_display_sessions",
  "sponsor_audit_events",
] as const;

const functions = [
  "public.create_game(uuid, jsonb, jsonb)",
  "public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb)",
] as const;

const sequences = [
  "score_events_sequence_seq",
  "health_events_id_seq",
  "sponsor_audit_events_id_seq",
] as const;

describe("database access hardening migration contract", () => {
  it("enables RLS on every application table from the initial migration", () => {
    for (const table of tables) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("removes all table grants before restoring only server store access", () => {
    expect(sql).toMatch(
      /revoke all privileges on table .* from public, anon, authenticated, service_role;/,
    );
    for (const table of tables) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all privileges on table .*public\\.${table}(?:,| from)`,
        ),
      );
    }
    expect(sql).toContain(
      "grant select, update on table public.game_states to service_role;",
    );
    expect(sql).not.toMatch(/grant .* on table .* to (?:anon|authenticated)/);

    expect(sql).toMatch(
      /revoke all privileges on sequence .* from public, anon, authenticated, service_role;/,
    );
    for (const sequence of sequences) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all privileges on sequence .*public\\.${sequence}(?:,| from)`,
        ),
      );
    }
  });

  it("hardens both SECURITY DEFINER RPCs and grants only service execution", () => {
    for (const fn of functions) {
      expect(sql).toContain(`alter function ${fn} security definer;`);
      expect(sql).toContain(`alter function ${fn} set search_path = '';`);
      expect(sql).toContain(
        `revoke all privileges on function ${fn} from public, anon, authenticated, service_role;`,
      );
      expect(sql).toContain(`grant execute on function ${fn} to service_role;`);
    }
    expect(sql).not.toMatch(
      /grant execute on function .* to (?:public|anon|authenticated)/,
    );
  });
});
