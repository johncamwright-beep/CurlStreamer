import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  fileURLToPath(
    new URL("./0015_add_game_completion_foundation.sql", import.meta.url),
  ),
  "utf8",
);
const sql = raw
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("game completion foundation migration", () => {
  it("uses database-issued result revisions and validates the reviewed revision", () => {
    expect(sql).toContain("create sequence public.game_result_revision_seq");
    expect(sql).toContain("nextval('public.game_result_revision_seq')");
    expect(sql).toContain(
      "v_revision is distinct from v_review.input_revision",
    );
    expect(sql).toContain("completion_review_conflict");
    expect(sql).not.toContain("date.now");
  });

  it("derives the immutable result from append-only score rows", () => {
    expect(sql).toContain(
      "create function public.derive_game_completion_result",
    );
    expect(sql).toContain("from public.score_events e");
    expect(sql).toContain("e.event_type = 'undo'");
    expect(sql).toContain("e.event_type = 'end'");
    expect(sql).toContain("'no_result'");
    expect(sql).toContain("'no result recorded'");
    expect(sql).toContain("'tie'");
    expect(sql).toContain("create trigger prevent_completion_changes");
  });

  it("serializes every state and score writer with completion", () => {
    expect(sql).toContain(
      "before insert or update or delete on public.game_states",
    );
    expect(sql).toContain(
      "before insert or update or delete on public.score_events",
    );
    const guard = sql.slice(
      sql.indexOf("create function public.guard_game_state_write"),
      sql.indexOf(
        "create function public.track_game_state_result_input_change",
      ),
    );
    expect(guard).not.toContain("for update");
    expect(guard).toContain("old.state->>'status' = 'completed'");
    for (const operation of [
      "create function public.review_game_completion",
      "create function public.complete_reviewed_game",
      "create or replace function public.update_scheduled_team_game",
    ]) {
      const body = sql.slice(sql.indexOf(operation));
      expect(body.indexOf("from public.game_states")).toBeLessThan(
        body.indexOf("from public.games"),
      );
      expect(body.indexOf("from public.game_states")).toBeGreaterThan(-1);
    }
    expect(sql).toContain("completed_game_terminal");
    expect(sql).toContain("score_events_append_only");
    expect(sql).toContain(
      "create or replace function public.append_score_event",
    );
    const append = sql.slice(
      sql.indexOf("create or replace function public.append_score_event"),
      sql.indexOf(
        "create or replace function public.update_scheduled_team_game",
      ),
    );
    expect(append).toContain(
      "from public.game_states gs where gs.game_id = p_game_id for update",
    );
    expect(append).toContain(
      "from public.games g where g.id = p_game_id for update",
    );
    expect(append.indexOf("from public.game_states")).toBeLessThan(
      append.indexOf("from public.games"),
    );
  });

  it("clears access and media state while recording unproven cleanup as pending", () => {
    for (const fragment of [
      "'{claims}', '{}'::jsonb",
      "'{connections}'",
      "'{camerahealth}', '{}'::jsonb",
      "'{broadcast}', '\"idle\"'::jsonb",
      "'{audiomuted}', 'true'::jsonb",
      '\'{"active":false,"paused":false,"startedat":null,"mutedprevious":false}\'::jsonb',
    ])
      expect(sql).toContain(fragment);
    expect(sql).toContain("values (p_game_id, 'livekit', 'pending'");
  });

  it("authorizes only administrators or a server-verified organizer", () => {
    expect(sql).toContain("join public.user_profiles p on p.user_id = u.id");
    expect(sql).toContain("u.email_confirmed_at is not null");
    expect(sql).toContain("m.role in ('owner', 'team_admin')");
    expect(sql).toContain("m.organization_id = v_org");
    expect(sql).toContain("if p_verified_organizer then");
    expect(sql).not.toMatch(/m\.role in \([^)]*scorer/);
  });

  it("checks authorization before returning an idempotent completion", () => {
    const complete = sql.slice(
      sql.indexOf("create function public.complete_reviewed_game"),
    );
    expect(complete.indexOf("authorize_game_completion_actor")).toBeLessThan(
      complete.indexOf("from public.game_completions c"),
    );
    expect(sql).toContain("game_id uuid primary key references public.games");
    expect(sql).toContain("'game.completed'");
    expect(sql).toContain(
      "returns table (completion_id uuid, review_id uuid, input_revision bigint",
    );
  });

  it("keeps the new boundary service-role-only and the search path empty", () => {
    for (const signature of [
      "public.review_game_completion(uuid, uuid, uuid, boolean)",
      "public.complete_reviewed_game(uuid, uuid, uuid, uuid, boolean)",
    ]) {
      expect(sql).toContain(signature);
    }
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(raw.match(/security definer/gi)?.length).toBeGreaterThanOrEqual(10);
    expect(raw.match(/set search_path = ''/gi)?.length).toBeGreaterThanOrEqual(
      13,
    );
  });

  it("does not classify historical Close Game rows as completed", () => {
    expect(sql).toContain("historical_closed_game");
    expect(sql).toContain("v_state_status = 'closed'");
    expect(sql).toContain("g.completed_at is not null or g.status = 'closed'");
  });
});
