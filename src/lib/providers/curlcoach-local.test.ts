import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCoachState, writeCoachEvent } from "./curlcoach-local";
import { currentShots, type Command } from "@/lib/curlcoach/model";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("CURLCOACH_LOCAL_LAB", "true");
  vi.stubEnv(
    "CURLCOACH_LAB_SECRET",
    "provider-test-only-secret-more-than-32-characters",
  );
  vi.stubEnv("CURLCOACH_LAB_STORAGE", `provider-test-${crypto.randomUUID()}`);
});
afterEach(() => vi.unstubAllEnvs());
const command = (): Command => ({
  requestId: crypto.randomUUID(),
  expectedRevision: 0,
  shotId: crypto.randomUUID(),
  shot: {
    playerId: "lead",
    position: "Lead",
    end: 1,
    stone: 1,
    type: "Draw",
    turn: null,
    execution: null,
    grade: 0,
    deficiency: null,
    review: null,
    excluded: null,
    note: "Synthetic test",
  },
});
it("persists revisions, keeps retries idempotent and rejects stale writes", () => {
  const first = command();
  writeCoachEvent(first);
  writeCoachEvent(first);
  expect(readCoachState().events).toHaveLength(1);
  expect(currentShots(readCoachState().events)[0].grade).toBe(0);
  expect(() => writeCoachEvent(command())).toThrow();
  expect(readCoachState().events).toHaveLength(1);
});
it("does not reset corrupt or foreign-scoped data", () => {
  const state = writeCoachEvent(command());
  const path = join(
    process.cwd(),
    ".curlcoach-local",
    process.env.CURLCOACH_LAB_STORAGE!,
    "shot-events.json",
  );
  writeFileSync(
    path,
    JSON.stringify({ ...state, organizationId: "foreign-org" }),
  );
  expect(() => readCoachState()).toThrow();
  expect(() => writeCoachEvent(command())).toThrow();
});
it("rejects disabled access and paths outside the local directory", () => {
  vi.stubEnv("CURLCOACH_ENABLED", "false");
  expect(() => readCoachState()).toThrow();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("CURLCOACH_LAB_STORAGE", "../outside");
  expect(() => readCoachState()).toThrow();
});
