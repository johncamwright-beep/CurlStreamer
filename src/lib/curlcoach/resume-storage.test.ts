import { describe, expect, it } from "vitest";
import { append, emptyState, type Shot } from "./model";
import {
  emptyResumeStore,
  readResumeStore,
  reconcileResume,
  rememberResume,
  resumeId,
  writeResumeStore,
  type ResumeSnapshot,
} from "./resume-storage";

const scope = {
  actorId: "coach-one",
  organizationId: "curlcoach-synthetic-org",
};
const draft: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: null,
  execution: null,
  grade: 4,
  deficiency: null,
  review: null,
  excluded: null,
  note: "Private draft",
};
const snapshot = (gameId = "curlcoach-synthetic-game"): ResumeSnapshot => ({
  source: "streamer",
  eventId: "event-one",
  gameId,
  stateRevision: 0,
  updatedAt: 1,
  draft,
  editing: null,
  current: draft,
});
function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}
describe("private tracking resume", () => {
  it("persists a bounded unsaved grade before a shot type has been chosen", () => {
    const storage = memoryStorage();
    const incomplete = {
      ...snapshot(),
      draft: { ...draft, grade: 5, type: null },
    };
    writeResumeStore(
      storage,
      rememberResume(emptyResumeStore(scope), incomplete, true),
    );
    const reloaded = readResumeStore(storage, scope);
    expect(
      reconcileResume(reloaded.drafts[0], emptyState(), scope)?.draft,
    ).toMatchObject({ grade: 5, type: null });
  });
  it("keeps the active game while browsing drafts from other games and events", () => {
    let store = rememberResume(emptyResumeStore(scope), snapshot(), true);
    store = rememberResume(store, {
      ...snapshot("game-two"),
      eventId: "event-two",
    });
    expect(store.active?.gameId).toBe("curlcoach-synthetic-game");
    expect(store.drafts[0].gameId).toBe("game-two");
    expect(resumeId(store.drafts[0])).not.toBe(resumeId(store.active!));
  });
  it("restores an unsaved private draft after browser reload, isolated by actor and organization", () => {
    const storage = memoryStorage();
    const store = rememberResume(emptyResumeStore(scope), snapshot(), true);
    writeResumeStore(storage, store);
    const reloaded = readResumeStore(storage, scope);
    expect(
      reconcileResume(reloaded.drafts[0], emptyState(), scope)?.draft.note,
    ).toBe("Private draft");
    expect(
      readResumeStore(storage, { ...scope, actorId: "coach-two" }).active,
    ).toBeNull();
    expect(
      readResumeStore(storage, { ...scope, organizationId: "other-team" })
        .active,
    ).toBeNull();
  });
  it("ignores corrupt, mismatched, oversized and unavailable storage", () => {
    const storage = memoryStorage();
    writeResumeStore(
      storage,
      rememberResume(emptyResumeStore(scope), snapshot(), true),
    );
    const key = [...storage.entries.keys()][0];
    for (const raw of [
      "{broken",
      "x".repeat(120_001),
      JSON.stringify({ ...emptyResumeStore(scope), actorId: "other-coach" }),
    ]) {
      storage.setItem(key, raw);
      expect(readResumeStore(storage, scope).active).toBeNull();
    }
    expect(
      readResumeStore(
        {
          getItem() {
            throw new Error("blocked");
          },
          setItem() {},
        },
        scope,
      ).active,
    ).toBeNull();
  });
  it("bounds the number of remembered games", () => {
    let store = emptyResumeStore(scope);
    for (let i = 0; i < 20; i++)
      store = rememberResume(store, snapshot("game-" + i), true);
    expect(store.drafts).toHaveLength(12);
    expect(store.active?.gameId).toBe("game-19");
  });
  it("keeps unsaved tracking and review drafts separate across multiple-game reloads", () => {
    const storage = memoryStorage();
    let store = rememberResume(emptyResumeStore(scope), snapshot(), true);
    store = rememberResume(store, {
      ...snapshot(),
      draft: { ...draft, end: 8, note: "Historical review" },
      editing: "20000000-0000-4000-8000-000000000000",
      current: { ...draft, stone: 2, note: "Unsaved tracking turn" },
    });
    store = rememberResume(store, snapshot("browsed-game"));
    writeResumeStore(storage, store);
    const reloaded = readResumeStore(storage, scope);
    expect(reloaded.active?.gameId).toBe("curlcoach-synthetic-game");
    const trackedDraft = reloaded.drafts.find(
      (entry) => resumeId(entry) === resumeId(reloaded.active!),
    )!;
    expect(reconcileResume(trackedDraft, emptyState(), scope)).toMatchObject({
      editing: null,
      draft: { stone: 2, note: "Unsaved tracking turn" },
    });
  });
  it("moves past a confirmed turn instead of restoring stale evaluation over it", () => {
    const state = append(
      emptyState(),
      {
        requestId: "10000000-0000-4000-8000-000000000000",
        expectedRevision: 0,
        shotId: "20000000-0000-4000-8000-000000000000",
        shot: draft,
      },
      "coach",
    );
    expect(reconcileResume(snapshot(), state, scope)).toMatchObject({
      editing: null,
      draft: { stone: 2, grade: null, note: "" },
    });
    expect(
      reconcileResume(snapshot(), state, {
        ...scope,
        organizationId: "other-team",
      }),
    ).toBeUndefined();
    expect(
      reconcileResume(snapshot("another-game"), state, scope),
    ).toBeUndefined();
  });
  it("resumes review drafts only at the matching authoritative revision", () => {
    const shotId = "20000000-0000-4000-8000-000000000000";
    const state = append(
      emptyState(),
      {
        requestId: "10000000-0000-4000-8000-000000000000",
        expectedRevision: 0,
        shotId,
        shot: draft,
      },
      "coach",
    );
    const review = {
      ...snapshot(),
      stateRevision: 1,
      editing: shotId,
      current: { ...draft, stone: 2, note: "Tracking turn" },
    };
    expect(reconcileResume(review, state, scope)?.editing).toBe(shotId);
    expect(
      reconcileResume({ ...review, stateRevision: 0 }, state, scope),
    ).toMatchObject({
      editing: null,
      draft: { stone: 2, note: "Tracking turn" },
    });
  });
});
