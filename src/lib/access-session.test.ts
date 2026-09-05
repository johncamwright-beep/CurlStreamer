import { describe, expect, it } from "vitest";
import {
  cameraPublishAccessToken,
  canManageCompletion,
  gameAccessToken,
  hasOrganizerAccess,
  hasScoringAccess,
  organizerAccessToken,
  previewSubscribeAccessToken,
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
  it("selects the preserved matching camera token instead of organizer authority", () => {
    const organizer = token({ purpose: "organizer", gameId: "game-1" });
    const camera = token({
      purpose: "participant",
      gameId: "game-1",
      role: "camera-home",
    });
    const store = storage({
      "curlcast-access-game-1": organizer,
      "curlcast-participant-access-game-1": camera,
    });

    expect(cameraPublishAccessToken(store, "game-1", "camera-home")).toBe(
      camera,
    );
    expect(cameraPublishAccessToken(store, "game-1", "camera-away")).toBe(
      undefined,
    );
    expect(previewSubscribeAccessToken(store, "game-1")).toBe(organizer);
  });

  it("ignores expired and cross-game credentials", () => {
    const expired = token({
      purpose: "participant",
      gameId: "game-1",
      role: "scorer",
      exp: 1,
    });
    const otherGame = token({ purpose: "organizer", gameId: "game-2" });
    const store = storage({
      "curlcast-access-game-1": expired,
      "curlcast-organizer-access-game-1": otherGame,
    });

    expect(gameAccessToken(store, "game-1")).toBeUndefined();
    expect(previewSubscribeAccessToken(store, "game-1")).toBeUndefined();
  });

  it.each([
    ["owner", false, true],
    ["team_admin", false, true],
    ["scorer", false, false],
    ["viewer", false, false],
    ["", true, true],
  ])(
    "derives completion cleanup authority for %s with organizer=%s",
    (role, organizer, expected) => {
      expect(canManageCompletion(role, organizer)).toBe(expected);
    },
  );

  it("recognizes only same-game organizer and scorer sessions as scoring access", () => {
    const organizer = token({ purpose: "organizer", gameId: "game-1" });
    const scorer = token({
      purpose: "participant",
      gameId: "game-1",
      role: "scorer",
    });
    const camera = token({
      purpose: "participant",
      gameId: "game-1",
      role: "camera-home",
    });

    expect(
      hasScoringAccess(
        storage({ "curlcast-access-game-1": organizer }),
        "game-1",
      ),
    ).toBe(true);
    expect(
      hasScoringAccess(
        storage({ "curlcast-participant-access-game-1": scorer }),
        "game-1",
      ),
    ).toBe(true);
    expect(
      hasScoringAccess(storage({ "curlcast-access-game-1": camera }), "game-1"),
    ).toBe(false);
    expect(
      hasScoringAccess(
        storage({ "curlcast-access-game-2": organizer }),
        "game-2",
      ),
    ).toBe(false);
  });

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
    expect(organizerAccessToken(store, "game-1")).toBe(organizer);
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
