import { expect, it } from "vitest";
import { emptySupplement } from "./enhanced-catalog";
import { readEnhancedDraft, writeEnhancedDraft } from "./enhanced-drafts";
it("retains the draft's original revision across reload and mode changes", () => {
  const cache = new Map<string, string>();
  const storage = {
    getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => {
      cache.set(key, value);
    },
  };
  const value = emptySupplement();
  value.assessments.misses = "assessed"; // Incomplete until explicitly assessed with a value.
  const draft = { revision: 1, value };
  writeEnhancedDraft(storage, "organization:coach-a:game:shot", draft);
  const newerServerRecord = { revision: 2, value: emptySupplement() };
  expect(
    readEnhancedDraft(
      storage,
      "organization:coach-a:game:shot",
      newerServerRecord,
    ),
  ).toEqual(draft);
  expect(
    readEnhancedDraft(
      storage,
      "organization:coach-b:game:shot",
      newerServerRecord,
    ),
  ).toEqual(newerServerRecord);
  cache.set("bad", JSON.stringify({ value, revision: -1 }));
  expect(readEnhancedDraft(storage, "bad", newerServerRecord)).toEqual(
    newerServerRecord,
  );
});
