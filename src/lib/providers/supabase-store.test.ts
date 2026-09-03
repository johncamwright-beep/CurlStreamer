import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameConfig } from "../types";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

import { createGame } from "./supabase-store";

const config: GameConfig = {
  eventName: "Club final",
  homeName: "Rocks",
  awayName: "Stones",
  homeColor: "#000000",
  awayColor: "#ffffff",
  scheduledEnds: 8,
  initialHammer: "home",
  youtubeTitle: "Club final",
  youtubeVisibility: "unlisted",
};

describe("Supabase game creation", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    vi.restoreAllMocks();
  });

  it("uses the transactional database function with matching arguments", async () => {
    mocks.rpc.mockResolvedValue({ error: null });

    const game = await createGame(config);

    expect(mocks.rpc).toHaveBeenCalledWith("create_game", {
      p_game_id: game.id,
      p_config: config,
      p_state: game,
    });
  });

  it("redacts credentials from logged database errors", async () => {
    process.env.SUPABASE_SECRET_KEY = "server-secret-value";
    mocks.rpc.mockResolvedValue({
      error: {
        code: "42501",
        message: "request server-secret-value was rejected",
      },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(createGame(config)).rejects.toThrow(
      "Supabase game creation failed",
    );
    expect(consoleError).toHaveBeenCalledWith("Supabase game creation failed", {
      code: "42501",
      message: "request [redacted] was rejected",
    });
  });
});
