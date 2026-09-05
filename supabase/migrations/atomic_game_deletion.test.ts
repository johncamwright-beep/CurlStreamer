import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./0018_add_atomic_game_deletion.sql", import.meta.url),
  "utf8",
)
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("atomic game deletion migration", () => {
  it("locks state before game and atomically revokes retained runtime state", () => {
    const deletion = sql.indexOf(
      "create or replace function public.soft_delete_team_game",
    );
    const stateLock = sql.indexOf("from public.game_states gs", deletion);
    const gameLock = sql.indexOf("from public.games g", stateLock);
    const stateUpdate = sql.indexOf("update public.game_states", gameLock);
    const gameUpdate = sql.indexOf("update public.games", stateUpdate);
    const audit = sql.indexOf("'game.deleted'", gameUpdate);
    expect(stateLock).toBeGreaterThan(deletion);
    expect(gameLock).toBeGreaterThan(stateLock);
    expect(stateUpdate).toBeGreaterThan(gameLock);
    expect(gameUpdate).toBeGreaterThan(stateUpdate);
    expect(audit).toBeGreaterThan(gameUpdate);
    expect(sql).toContain("'{status}', '\"closed\"'::jsonb");
    expect(sql).toContain("'{claims}', '{}'::jsonb");
    expect(sql).toContain("version = greatest( version + 1");
  });

  it("repairs legacy retained state before restoring metadata", () => {
    const restore = sql.indexOf(
      "create or replace function public.restore_team_game",
    );
    const cleanupRead = sql.indexOf(
      "create function public.get_game_deletion_cleanup",
      restore,
    );
    const body = sql.slice(restore, cleanupRead);
    expect(body).toContain("set deleted_at = null");
    expect(body).toContain("deleted_by_user_id = null");
    expect(body).toContain("if v_game.completed_at is null then");
    expect(body).toContain("update public.game_states");
    expect(body).toContain("'{claims}', '{}'::jsonb");
    expect(body).not.toContain("'{status}', '\"active\"'");
  });

  it("records provider cleanup separately without granting browser access", () => {
    expect(sql).toContain("create table public.game_deletion_cleanup");
    expect(sql).toContain("where g.deleted_at is not null");
    expect(sql).toContain(
      "create function public.list_deleted_team_games_with_cleanup",
    );
    expect(sql).toContain("left join public.game_deletion_cleanup c");
    expect(sql).toContain("status in ('pending', 'failed', 'complete')");
    expect(sql).toContain("c.status <> 'complete'");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("to authenticated");
    expect(sql).not.toContain("to anon");
  });

  it("preserves the previous deployed deletion function signatures", () => {
    expect(sql).toContain(
      "create or replace function public.soft_delete_team_game( p_user_id uuid, p_game_id uuid )",
    );
    expect(sql).toContain(
      "create or replace function public.restore_team_game( p_user_id uuid, p_game_id uuid )",
    );
    expect(sql).not.toContain(
      "create or replace function public.list_deleted_team_games(",
    );
  });
});
