import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0016_add_end_game_flow.sql",
  "utf8",
)
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("End Game migration", () => {
  it("stores only validated optional YouTube watch links with the review", () => {
    expect(sql).toContain("create function public.is_valid_youtube_watch_url");
    expect(sql).toContain("review_game_completion_with_link");
    expect(sql).toContain("copy_review_watch_url_to_completion");
    expect(sql).toContain("invalid_youtube_watch_url");
  });

  it("exposes an allowlisted summary without authority or internal identities", () => {
    const summary = sql.slice(
      sql.indexOf("create function public.read_game_completion_summary"),
      sql.indexOf("create function public.get_game_completion_cleanup"),
    );
    for (const field of [
      "'eventname'",
      "'homename'",
      "'awayname'",
      "'result'",
      "'youtubewatchurl'",
      "'completedat'",
    ])
      expect(summary).toContain(field);
    for (const secret of [
      "reviewer_user_id",
      "completed_by_user_id",
      "review_id",
      "claims",
    ])
      expect(summary).not.toContain(secret);
    expect(summary).toContain("g.deleted_at is null");
  });

  it("records durable cleanup attempts without downgrading complete cleanup", () => {
    expect(sql).toContain("status in ('pending', 'failed', 'complete')");
    expect(sql).toContain("attempts = c.attempts + 1");
    expect(sql).toContain("c.status <> 'complete'");
    expect(sql).toContain("last_error");
  });

  it("adds immutable results to the existing team schedule RPC", () => {
    expect(sql).toContain(
      "drop function public.list_team_hierarchy_games(uuid)",
    );
    expect(sql).toContain("completion_result jsonb, youtube_watch_url text");
    expect(sql).toContain("left join public.game_completions c");
  });

  it("keeps every mutation and cleanup read service-role-only", () => {
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/to anon|to authenticated/);
  });
});
