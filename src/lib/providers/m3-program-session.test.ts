import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ studioAction: vi.fn(), from: vi.fn() }));
vi.mock("./m2-studio-session", () => ({
  ...mocks,
  StudioRejected: class extends Error {},
  StudioUnavailable: class extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: mocks.from }),
}));
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
    vi.stubEnv("ROLE_TOKEN_SECRET", "test-program-cookie-secret-32-characters");
    mocks.studioAction.mockReset().mockResolvedValue({});
    const rows = new Map<
      string,
      { game_id: string; code_hash: string; scope: unknown; expires_at: string }
    >();
    mocks.from.mockReset().mockImplementation(() => ({
      upsert: async (row: {
        game_id: string;
        code_hash: string;
        scope: unknown;
        expires_at: string;
      }) => {
        rows.set(row.game_id, row);
        return { error: null };
      },
      delete: () => {
        const filters: Record<string, string> = {};
        const query = {
          eq: (key: string, value: string) => {
            filters[key] = value;
            return query;
          },
          gt: (_key: string, value: string) => {
            filters.after = value;
            return query;
          },
          select: () => query,
          maybeSingle: async () => {
            const row = rows.get(filters.game_id);
            if (
              !row ||
              row.code_hash !== filters.code_hash ||
              row.expires_at <= filters.after
            )
              return { data: null, error: null };
            rows.delete(filters.game_id);
            return { data: { scope: row.scope }, error: null };
          },
        };
        return query;
      },
    }));
  });
  it("exchanges once under concurrent requests and restricts cookie to the game", async () => {
    const code = await createProgramGrant(scope);
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
    const code = await createProgramGrant(scope);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 300_001);
      await expect(exchangeProgramGrant(gameId, code)).rejects.toThrow();
      expect(mocks.studioAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("retains the canvas with one valid slot but refuses two stale slots", async () => {
    mocks.studioAction.mockRejectedValueOnce(new Error("released"));
    await expect(checkAvailableProgramScope(scope)).resolves.toBeUndefined();
    mocks.studioAction.mockRejectedValue(new Error("stale"));
    await expect(checkAvailableProgramScope(scope)).rejects.toThrow();
  });
  it("expires program cookies after four hours", async () => {
    const value = await exchangeProgramGrant(
      gameId,
      await createProgramGrant(scope),
    );
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 14_401_000);
      await expect(readProgramScope(request(value), gameId)).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
  it("wrong game cannot consume a grant; terminal authority consumes and refuses it", async () => {
    const code = await createProgramGrant(scope);
    await expect(
      exchangeProgramGrant(scope.organizationId, code),
    ).rejects.toThrow();
    mocks.studioAction.mockRejectedValue(new Error("terminal"));
    await expect(exchangeProgramGrant(gameId, code)).rejects.toThrow();
    mocks.studioAction.mockResolvedValue({});
    await expect(exchangeProgramGrant(gameId, code)).rejects.toThrow();
  });
  it("exchanges and verifies across fresh server module instances", async () => {
    const code = await createProgramGrant(scope);
    vi.resetModules();
    const second = await import("./m3-program-session");
    const value = await second.exchangeProgramGrant(gameId, code);
    vi.resetModules();
    const third = await import("./m3-program-session");
    expect(await third.readProgramScope(request(value), gameId)).toEqual(scope);
    await expect(third.exchangeProgramGrant(gameId, code)).rejects.toThrow();
  });
  it("replacing a pending link invalidates the previous link", async () => {
    const old = await createProgramGrant(scope);
    const current = await createProgramGrant(scope);
    await expect(exchangeProgramGrant(gameId, old)).rejects.toThrow();
    await expect(exchangeProgramGrant(gameId, current)).resolves.toBeTypeOf(
      "string",
    );
  });
  it("fails closed when database or stable signing configuration is unavailable", async () => {
    vi.stubEnv("ROLE_TOKEN_SECRET", "");
    await expect(createProgramGrant(scope)).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
    vi.stubEnv("ROLE_TOKEN_SECRET", "test-program-cookie-secret-32-characters");
    mocks.from.mockReturnValue({
      upsert: async () => ({ error: { message: "private provider detail" } }),
    });
    await expect(createProgramGrant(scope)).rejects.toThrow();
  });
});
