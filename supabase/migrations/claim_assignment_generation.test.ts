import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./0019_add_claim_assignment_generations.sql", import.meta.url),
  "utf8",
)
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("claim assignment generation migration", () => {
  it.each([
    "prepare_game_role_invitation",
    "claim_game_role",
    "release_game_role",
  ])("locks state before game in %s", (name) => {
    const start = sql.indexOf(`create function public.${name}`);
    const next = sql.indexOf("create function public.", start + 20);
    const body = sql.slice(start, next < 0 ? undefined : next);
    expect(body.indexOf("from public.game_states")).toBeGreaterThan(0);
    expect(body.indexOf("from public.games")).toBeGreaterThan(
      body.indexOf("from public.game_states"),
    );
  });

  it("binds consumption and release to the stored generation", () => {
    expect(sql).toContain("expected_generation bigint");
    expect(sql).toContain("consumed_by_device_id uuid");
    expect(sql).toContain("v_invitation.expected_generation <> v_generation");
    expect(sql).toContain("v_generation <> p_expected_generation");
    expect(sql).toContain("claim_generation_required");
    expect(sql).toContain("array['claimgenerations', p_role::text]");
    expect(sql).toContain("list_game_camera_identity_generations");
    expect(sql).toContain("i.assigned_generation > 0");
  });

  it("keeps all mutation functions service-role only", () => {
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("to authenticated");
    expect(sql).not.toContain("to anon");
  });
});
