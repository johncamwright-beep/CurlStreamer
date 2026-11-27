import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "./0044_expose_game_schedule_to_service_reads.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("game schedule service read migration", () => {
  it("extends the service-only lifecycle snapshot with canonical schedule fields", () => {
    expect(sql).toContain("drop function public.read_game_state(uuid)");
    expect(sql).toContain("scheduled_start timestamptz");
    expect(sql).toContain("schedule_timezone text");
    expect(sql).toContain("g.scheduled_start");
    expect(sql).toContain("g.schedule_timezone");
  });

  it("keeps the function restricted to the service role", () => {
    expect(sql).toContain(
      "revoke all privileges on function public.read_game_state(uuid)",
    );
    expect(sql).toContain(
      "grant execute on function public.read_game_state(uuid) to service_role",
    );
  });
});
