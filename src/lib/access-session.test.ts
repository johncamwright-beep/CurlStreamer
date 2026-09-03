import { describe, expect, it } from "vitest";
import {
  hasOrganizerAccess,
  preserveAndStoreParticipantAccess,
} from "./access-session";

function token(payload: object) {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("browser access sessions", () => {
  it("preserves an organizer session when a participant role is claimed", () => {
    const organizer = token({ purpose: "organizer", gameId: "game-1" });
    const scorer = token({ purpose: "participant", gameId: "game-1" });
    const store = storage({ "curlcast-access-game-1": organizer });
    preserveAndStoreParticipantAccess(store, "game-1", scorer);
    expect(store.values.get("curlcast-access-game-1")).toBe(organizer);
    expect(store.values.get("curlcast-organizer-access-game-1")).toBe(
      organizer,
    );
    expect(store.values.get("curlcast-participant-access-game-1")).toBe(scorer);
    expect(hasOrganizerAccess(store, "game-1")).toBe(true);
  });

  it("does not mistake participant or another game's token for organizer access", () => {
    const store = storage({
      "curlcast-access-game-1": token({
        purpose: "participant",
        gameId: "game-1",
      }),
      "curlcast-organizer-access-game-2": token({
        purpose: "organizer",
        gameId: "game-2",
      }),
    });
    expect(hasOrganizerAccess(store, "game-1")).toBe(false);
  });
});
