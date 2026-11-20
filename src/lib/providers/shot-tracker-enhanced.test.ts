import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { emptyState, currentShots, report } from "@/lib/curlcoach/model";
import {
  emptySupplement,
  defaultPreferences,
  validateShotReferences,
} from "@/lib/curlcoach/enhanced-catalog";
import { standardShot } from "@/test/enhanced-fixtures";
import {
  readCoachState,
  readLocalEnhanced,
  writeCoachEvent,
  writeLocalEnhanced,
} from "./curlcoach-local";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("CURLCOACH_LOCAL_LAB", "true");
  vi.stubEnv(
    "CURLCOACH_LAB_SECRET",
    "enhanced-test-only-thirty-two-character-secret",
  );
  vi.stubEnv("CURLCOACH_LAB_STORAGE", `enhanced-${randomUUID()}`);
});
afterEach(() => vi.unstubAllEnvs());
it("keeps Standard exports byte-identical after Enhanced review, and survives an old-client correction", () => {
  const initial = emptyState(),
    command = {
      requestId: randomUUID(),
      expectedRevision: 0,
      shotId: randomUUID(),
      shot: standardShot,
    };
  const value = {
    ...emptySupplement(),
    values: { intendedWeight: "back_button" },
  };
  const write = {
    kind: "supplement" as const,
    requestId: command.requestId,
    expectedRevision: 0,
    sourceRevision: 1,
    shotId: command.shotId,
    value,
  };
  const saved = writeLocalEnhanced(initial, write, "synthetic-coach", command);
  expect(
    writeLocalEnhanced(initial, write, "synthetic-coach", command).state,
  ).toEqual(saved.state);
  const original = JSON.stringify(readCoachState(initial));
  const revised = {
    ...write,
    requestId: randomUUID(),
    expectedRevision: 1,
    value: { ...value, values: { intendedWeight: "back_line" } },
  };
  writeLocalEnhanced(initial, revised);
  expect(JSON.stringify(readCoachState(initial))).toBe(original);
  const before = readLocalEnhanced(initial);
  writeCoachEvent(
    {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 1,
      shot: { ...standardShot, grade: 5 },
    },
    initial,
  );
  expect(readLocalEnhanced(initial)).toEqual(before);
  expect(report(currentShots(readCoachState(initial).events)).percent).toBe(
    100,
  );
  expect(currentShots(readCoachState(initial).events)[0].videoReview).toEqual(
    standardShot.videoReview,
  );
  expect(() => writeLocalEnhanced(initial, { ...revised, value })).toThrow(
    "Request ID already used",
  );
  expect(() =>
    writeLocalEnhanced(initial, { ...revised, requestId: randomUUID() }),
  ).toThrow("Enhanced revision conflict");
});
it("does not leave a partial Standard save when supplemental validation fails", () => {
  const initial = emptyState(),
    command = {
      requestId: randomUUID(),
      expectedRevision: 0,
      shotId: randomUUID(),
      shot: standardShot,
    };
  expect(() =>
    writeLocalEnhanced(
      initial,
      {
        kind: "supplement",
        requestId: command.requestId,
        expectedRevision: 0,
        sourceRevision: 99,
        shotId: command.shotId,
        value: emptySupplement(),
      },
      "synthetic-coach",
      command,
    ),
  ).toThrow("Source shot revision conflict");
  expect(readCoachState(initial)).toEqual(initial);
  expect(readLocalEnhanced(initial)).toEqual([]);
});
it("persists private coach preferences independently of game state and rejects stale revisions", () => {
  const initial = { ...emptyState(), gameId: "enhanced-preferences" };
  const input = {
    kind: "preferences" as const,
    requestId: randomUUID(),
    expectedRevision: 0,
    sourceRevision: 0,
    value: { ...defaultPreferences, mode: "enhanced" },
  };
  writeLocalEnhanced(initial, input, "coach-a");
  expect(readLocalEnhanced(initial, "coach-a")[0].value).toEqual(input.value);
  expect(readLocalEnhanced(initial, "coach-b")).toEqual([]);
  expect(() =>
    writeLocalEnhanced(
      initial,
      { ...input, requestId: randomUUID() },
      "coach-a",
    ),
  ).toThrow("Enhanced revision conflict");
  writeLocalEnhanced(
    initial,
    {
      ...input,
      requestId: randomUUID(),
      expectedRevision: 1,
      value: defaultPreferences,
    },
    "coach-a",
  );
  expect(readLocalEnhanced(initial, "coach-a")[0].revision).toBe(2);
});
it("rejects nonexistent or nonpreceding adjustment references", () => {
  const sourceId = randomUUID(),
    earlierId = randomUUID();
  const s = emptySupplement();
  s.values.earlierShotId = earlierId;
  expect(() =>
    validateShotReferences(s, sourceId, [{ ...standardShot, id: sourceId }]),
  ).toThrow();
  expect(() =>
    validateShotReferences(s, sourceId, [
      { ...standardShot, id: sourceId },
      { ...standardShot, id: earlierId, end: 2 },
    ]),
  ).toThrow();
  expect(() =>
    validateShotReferences(s, sourceId, [
      { ...standardShot, id: sourceId, end: 2 },
      { ...standardShot, id: earlierId },
    ]),
  ).not.toThrow();
});
