import { describe, expect, it, vi } from "vitest";
import {
  fetchGameWithSelectedAccess,
  fetchLiveKitSubscriberCredentials,
} from "./media-access-client";

function token(payload: object) {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

const storage = (value?: string) => ({
  getItem: (key: string) =>
    key === "curlcast-access-game-1" ? (value ?? null) : null,
});

describe("media access requests", () => {
  it.each([200, 410, 503])(
    "does not public-retry an authorized, terminal, or unavailable state response: %s",
    async (status) => {
      const scorer = token({
        purpose: "participant",
        gameId: "game-1",
        role: "scorer",
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));

      await fetchGameWithSelectedAccess(
        "game-1",
        "broadcast",
        undefined,
        storage(scorer),
        fetcher,
      );

      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][1]).toMatchObject({
        headers: { authorization: `Bearer ${scorer}` },
      });
    },
  );

  it("retries public Broadcast state without authorization or cookies", async () => {
    const stale = token({
      purpose: "organizer",
      gameId: "other-game",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const response = await fetchGameWithSelectedAccess(
      "game-1",
      "broadcast",
      undefined,
      storage(stale),
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
    expect(fetcher.mock.calls[1]).toEqual([
      "/api/games/game-1?view=broadcast",
      { cache: "no-store", credentials: "omit" },
    ]);
  });

  it("uses scorer authority for preview then falls back credential-free", async () => {
    const scorer = token({
      purpose: "participant",
      gameId: "game-1",
      role: "scorer",
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await fetchLiveKitSubscriberCredentials("game-1", storage(scorer), fetcher);

    expect(fetcher.mock.calls[0]).toEqual([
      "/api/games/game-1/livekit-token?capability=preview-subscribe",
      {
        method: "POST",
        headers: { authorization: `Bearer ${scorer}` },
      },
    ]);
    expect(fetcher.mock.calls[1]).toEqual([
      "/api/games/game-1/livekit-token?capability=public-viewer",
      { method: "POST", credentials: "omit" },
    ]);
  });

  it.each([200, 410, 503])(
    "does not public-retry an authorized, terminal, or unavailable media response: %s",
    async (status) => {
      const scorer = token({
        purpose: "participant",
        gameId: "game-1",
        role: "scorer",
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));

      await fetchLiveKitSubscriberCredentials(
        "game-1",
        storage(scorer),
        fetcher,
      );

      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toContain(
        "capability=preview-subscribe",
      );
    },
  );
});
