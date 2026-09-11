import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  credentials: vi.fn(),
  refresh: vi.fn(),
  decrypt: vi.fn(),
  broadcast: vi.fn(),
  thumbnail: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/youtube-connection", () => ({
  getYouTubeCredentials: mocks.credentials,
}));
vi.mock("./youtube", () => ({ refreshYouTubeAccessToken: mocks.refresh }));
vi.mock("./youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: mocks.decrypt,
}));
vi.mock("./youtube-live", () => ({
  findOrCreateYouTubeBroadcast: mocks.broadcast,
  updateScheduledYouTubeTime: mocks.update,
}));
vi.mock("./youtube-thumbnail", () => ({
  uploadScheduledThumbnail: mocks.thumbnail,
}));

import { provisionScheduledYouTubeBroadcast } from "./scheduled-youtube";

describe("scheduled YouTube provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.thumbnail.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue(undefined);
    mocks.credentials.mockResolvedValue({
      encrypted_credentials: "encrypted",
      organization_id: "11111111-1111-4111-8111-111111111111",
      channel_id: "channel",
      connection_version: 1,
    });
    mocks.decrypt.mockReturnValue("refresh");
    mocks.refresh.mockResolvedValue("access");
    mocks.broadcast.mockResolvedValue({
      id: "broadcast",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
  });

  it("retries a persistence failure by discovery only", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [{ action: "run" }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "08006" } })
      .mockResolvedValueOnce({ data: [{ action: "discover" }], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            status: "ready",
            watch_url: "https://www.youtube.com/watch?v=abcdefghijk",
          },
        ],
        error: null,
      });
    const user = { id: "22222222-2222-4222-8222-222222222222" } as never;
    const values = {
      gameId: "33333333-3333-4333-8333-333333333333",
      title: "Final",
      scheduledStart: "2026-11-01T06:30:00.000Z",
    };
    await expect(
      provisionScheduledYouTubeBroadcast(user, values),
    ).resolves.toMatchObject({ status: "pending" });
    await expect(
      provisionScheduledYouTubeBroadcast(user, values),
    ).resolves.toMatchObject({ status: "ready" });
    expect(mocks.broadcast.mock.calls.map((call) => call[2])).toEqual([
      true,
      false,
    ]);
    expect(mocks.broadcast.mock.calls[0][0]).toMatchObject({
      sessionKey: values.gameId,
      scheduledStartTime: values.scheduledStart,
    });
  });

  it("does not claim a provider intent when YouTube preflight fails", async () => {
    mocks.credentials.mockRejectedValue(
      new Error("youtube_reconnect_required"),
    );
    const result = await provisionScheduledYouTubeBroadcast(
      { id: "22222222-2222-4222-8222-222222222222" } as never,
      {
        gameId: "33333333-3333-4333-8333-333333333333",
        title: "Final",
        scheduledStart: "2026-11-01T06:30:00.000Z",
      },
    );
    expect(result.status).toBe("pending");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("retains a ready watch page when thumbnail upload fails and retries without another broadcast", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          action: "none",
          watch_url: "https://www.youtube.com/watch?v=abcdefghijk",
        },
      ],
      error: null,
    });
    mocks.thumbnail.mockRejectedValueOnce(
      new Error("youtube_provider_rejected"),
    );
    const values = {
      gameId: "game",
      title: "Game",
      scheduledStart: "2026-10-20T22:30:00Z",
      thumbnail: {
        homeName: "Team A",
        awayName: "Team B",
        eventName: "Orion · Game 1",
        scheduledStart: "2026-10-20T22:30:00Z",
        timezone: "America/Toronto",
      },
    };
    const user = { id: "user" } as never;
    await expect(
      provisionScheduledYouTubeBroadcast(user, values),
    ).resolves.toMatchObject({ status: "ready", thumbnailStatus: "pending" });
    await expect(
      provisionScheduledYouTubeBroadcast(user, values),
    ).resolves.toMatchObject({ status: "ready", thumbnailStatus: "ready" });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.thumbnail).toHaveBeenCalledWith(
      "access",
      "abcdefghijk",
      values.thumbnail,
    );
  });

  it("returns the saved URL without another provider call when ready", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          action: "none",
          watch_url: "https://www.youtube.com/watch?v=abcdefghijk",
        },
      ],
      error: null,
    });
    await expect(
      provisionScheduledYouTubeBroadcast(
        { id: "22222222-2222-4222-8222-222222222222" } as never,
        {
          gameId: "33333333-3333-4333-8333-333333333333",
          title: "Final",
          scheduledStart: "2026-11-01T06:30:00.000Z",
        },
      ),
    ).resolves.toEqual({
      status: "ready",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
