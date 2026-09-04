import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameFixture, testGameId } from "@/test/game-fixture";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getGame: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("./local-store", () => ({ getGame: mocks.getGame }));
import { readGame } from "./game-read";

describe("game read provider lifecycle boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-placeholder");
    vi.stubEnv("SUPABASE_SECRET_KEY", "server-placeholder");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads lifecycle and state through the service-only RPC", async () => {
    const game = gameFixture();
    mocks.rpc.mockResolvedValue({
      data: [{ outcome: "active", state: game }],
      error: null,
    });
    expect(await readGame(testGameId)).toEqual({ kind: "active", game });
    expect(mocks.rpc).toHaveBeenCalledWith("read_game_state", {
      p_game_id: testGameId,
    });
    expect(mocks.getGame).not.toHaveBeenCalled();
  });
  it.each(["deleted", "closed"] as const)(
    "discards any retained state for %s games",
    async (kind) => {
      mocks.rpc.mockResolvedValue({
        data: [{ outcome: kind, state: gameFixture() }],
        error: null,
      });
      expect(await readGame(testGameId)).toEqual({ kind });
    },
  );
  it("distinguishes a missing row from an unavailable state", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await readGame(testGameId)).toEqual({ kind: "not-found" });
    mocks.rpc.mockResolvedValue({
      data: [{ outcome: "unavailable", state: null }],
      error: null,
    });
    await expect(readGame(testGameId)).rejects.toThrow("Game read unavailable");
  });
  it.each([
    { data: null, error: { message: "private provider detail" } },
    { data: null, error: null },
    { data: [{ outcome: "active", state: null }], error: null },
  ])("fails closed on malformed or failed RPC results", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(readGame(testGameId)).rejects.toThrow("Game read unavailable");
  });
  it("does not send legacy mock ids to the production UUID RPC", async () => {
    expect(await readGame("deadbeef")).toEqual({ kind: "not-found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed without production configuration", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", undefined);
    await expect(readGame(testGameId)).rejects.toThrow(
      "Missing environment variable: SUPABASE_SECRET_KEY",
    );
    expect(mocks.getGame).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retains explicitly local development reads without contacting Supabase", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const game = gameFixture();
    mocks.getGame.mockReturnValue(game);
    expect(await readGame("deadbeef")).toEqual({ kind: "active", game });
    mocks.getGame.mockReturnValue({ ...game, status: "closed" });
    expect(await readGame("deadbeef")).toEqual({ kind: "closed" });
    mocks.getGame.mockReturnValue(undefined);
    expect(await readGame("deadbeef")).toEqual({ kind: "not-found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
