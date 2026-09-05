import { describe, expect, it } from "vitest";
import {
  CURRENT_GAME_KEY,
  clearCurrentGame,
  clearCurrentGameIfMatching,
  gameCapabilities,
  readCurrentGame,
  selectCurrentGame,
  type CurrentGameSelection,
} from "./current-game";
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const selection = (id: string): CurrentGameSelection => ({
  id,
  title: `Team A vs Team ${id}`,
  scheduledLabel: "Sep 18, 2026, 7:00 PM ET",
  capabilities: gameCapabilities("owner", false),
});
describe("device-local current game", () => {
  it("persists only safe navigation context and survives a new read", () => {
    const storage = new MemoryStorage();
    selectCurrentGame(storage, selection("one"));
    expect(readCurrentGame(storage)).toEqual(selection("one"));
    const serialized = storage.getItem(CURRENT_GAME_KEY)!;
    expect(serialized).not.toMatch(/token|secret|credential|key/i);
  });
  it("replaces a selected game and clears safely", () => {
    const storage = new MemoryStorage();
    selectCurrentGame(storage, selection("one"));
    selectCurrentGame(storage, selection("two"));
    expect(readCurrentGame(storage)?.title).toContain("two");
    clearCurrentGame(storage);
    expect(readCurrentGame(storage)).toBeNull();
  });
  it("clears only a matching completed game without touching account state", () => {
    const storage = new MemoryStorage();
    storage.setItem("curlcast-account-session", "signed-in");
    selectCurrentGame(storage, selection("one"));

    expect(clearCurrentGameIfMatching(storage, "two")).toBe(false);
    expect(readCurrentGame(storage)).toEqual(selection("one"));
    expect(clearCurrentGameIfMatching(storage, "one")).toBe(true);
    expect(readCurrentGame(storage)).toBeNull();
    expect(storage.getItem("curlcast-account-session")).toBe("signed-in");
  });
  it("rejects malformed persisted capabilities", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      CURRENT_GAME_KEY,
      JSON.stringify({
        id: "one",
        title: "Unsafe",
        scheduledLabel: "Today",
        capabilities: { control: true },
      }),
    );
    expect(readCurrentGame(storage)).toBeNull();
  });
  it("derives role and TBD destinations", () => {
    expect(gameCapabilities("owner", true)).toMatchObject({
      control: true,
      assignOpponent: true,
      scoring: false,
      editSchedule: true,
    });
    expect(gameCapabilities("scorer", false)).toMatchObject({
      control: false,
      scoring: true,
      broadcast: true,
      editSchedule: false,
    });
  });
});
