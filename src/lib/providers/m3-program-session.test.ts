import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ studioAction: vi.fn() }));
vi.mock("./m2-studio-session", () => ({
  ...mocks,
  StudioRejected: class extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }));
import {
  createProgramGrant,
  exchangeProgramGrant,
  readProgramScope,
  programCookieName,
  checkAvailableProgramScope,
} from "./m3-program-session";
const gameId = "00000000-0000-4000-8000-000000000001";
const scope = {
  gameId,
  organizationId: "00000000-0000-4000-8000-000000000002",
  sessions: {
    "camera-home": "00000000-0000-4000-8000-000000000003",
    "camera-away": "00000000-0000-4000-8000-000000000004",
  },
};
function request(value: string) {
  return new Request("https://test", {
    headers: { cookie: `${programCookieName}=${value}` },
  });
}
describe("M3 one-use program grants", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.studioAction.mockReset().mockResolvedValue({});
  });
  it("exchanges once under concurrent requests and restricts cookie to the game", async () => {
    const code = createProgramGrant(scope);
    const results = await Promise.allSettled([
      exchangeProgramGrant(gameId, code),
      exchangeProgramGrant(gameId, code),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const success = results.find(
      (result) => result.status === "fulfilled",
    ) as PromiseFulfilledResult<string>;
    expect(await readProgramScope(request(success.value), gameId)).toEqual(
      scope,
    );
    await expect(
      readProgramScope(request(success.value), scope.organizationId),
    ).rejects.toThrow();
    await expect(
      readProgramScope(request(success.value + "x"), gameId),
    ).rejects.toThrow();
  });
  it("expires unconsumed grants after five minutes", async () => {
    const now = Date.now();
    const code = createProgramGrant(scope);
    vi.spyOn(Date, "now").mockReturnValue(now + 300_001);
    await expect(exchangeProgramGrant(gameId, code)).rejects.toThrow();
    expect(mocks.studioAction).not.toHaveBeenCalled();
  });
  it("retains the canvas with one valid slot but refuses two stale slots", async () => {
    mocks.studioAction.mockRejectedValueOnce(new Error("released"));
    await expect(checkAvailableProgramScope(scope)).resolves.toBeUndefined();
    mocks.studioAction.mockRejectedValue(new Error("stale"));
    await expect(checkAvailableProgramScope(scope)).rejects.toThrow();
  });
  it("expires program cookies after four hours", async () => {
    const value = await exchangeProgramGrant(gameId, createProgramGrant(scope));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 14_401_000);
      await expect(readProgramScope(request(value), gameId)).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
  it("wrong game cannot consume a grant; terminal authority consumes and refuses it", async () => {
    const code = createProgramGrant(scope);
    await expect(
      exchangeProgramGrant(scope.organizationId, code),
    ).rejects.toThrow();
    mocks.studioAction.mockRejectedValue(new Error("terminal"));
    await expect(exchangeProgramGrant(gameId, code)).rejects.toThrow();
    mocks.studioAction.mockResolvedValue({});
    await expect(exchangeProgramGrant(gameId, code)).rejects.toThrow();
  });
});
