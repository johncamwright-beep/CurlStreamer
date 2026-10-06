import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  credentials: vi.fn(),
  refresh: vi.fn(),
  decrypt: vi.fn(),
  broadcast: vi.fn(),
  thumbnail: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("./scheduled-youtube-credentials", () => ({
  getScheduledYouTubeCredentials: mocks.credentials,
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
    const updateQuery = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      then: (resolve: (value: { error: null }) => void) =>
        resolve({ error: null }),
    };
    mocks.from.mockReturnValue({ update: vi.fn(() => updateQuery) });
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
  it("creates Public using canonical saved privacy", async () => {
    mocks.credentials.mockResolvedValue({
      encrypted_credentials: "encrypted",
      organization_id: "11111111-1111-4111-8111-111111111111",
      channel_id: "channel",
      connection_version: 1,
      youtube_visibility: "public",
    });
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ action: "run", youtube_visibility: "public" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            status: "ready",
            watch_url: "https://www.youtube.com/watch?v=abcdefghijk",
          },
        ],
        error: null,
      });
    await provisionScheduledYouTubeBroadcast({ id: "user" } as never, {
      gameId: "game",
      title: "Final",
      scheduledStart: "2026-11-01T06:30:00Z",
      visibility: "public",
    });
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "public", manualLifecycle: true }),
      expect.any(Function),
      true,
      expect.any(Function),
    );
  });
  it("rejects stale route privacy before OAuth and provider intent", async () => {
    await expect(
      provisionScheduledYouTubeBroadcast({ id: "user" } as never, {
        gameId: "game",
        title: "Final",
        scheduledStart: "2026-11-01T06:30:00Z",
        visibility: "public",
      }),
    ).resolves.toMatchObject({
      status: "pending",
      errorCode: "youtube_manual_configuration_mismatch",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses claim privacy when a legitimate edit wins after credential preflight", async () => {
    mocks.credentials.mockResolvedValue({
      encrypted_credentials: "encrypted",
      organization_id: "11111111-1111-4111-8111-111111111111",
      channel_id: "channel",
      connection_version: 1,
      youtube_visibility: "public",
    });
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ action: "run", youtube_visibility: "unlisted" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            status: "ready",
            watch_url: "https://www.youtube.com/watch?v=abcdefghijk",
          },
        ],
        error: null,
      });
    await provisionScheduledYouTubeBroadcast({ id: "user" } as never, {
      gameId: "game",
      title: "Final",
      scheduledStart: "2026-11-01T06:30:00Z",
      visibility: "public",
    });
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "unlisted" }),
      expect.any(Function),
      true,
      expect.any(Function),
    );
  });
  it.each([null, [], [{ action: "run", youtube_visibility: "invalid" }]])(
    "fails closed on invalid claim metadata: %j",
    async (data) => {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(
        provisionScheduledYouTubeBroadcast({ id: "user" } as never, {
          gameId: "game",
          title: "Final",
          scheduledStart: "2026-11-01T06:30:00Z",
          visibility: "unlisted",
        }),
      ).resolves.toMatchObject({
        status: "failed",
        errorCode: "youtube_manual_configuration_mismatch",
      });
      expect(mocks.broadcast).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it("updates Public on the saved watch page and retries without recreation", async () => {
    mocks.credentials.mockResolvedValue({
      encrypted_credentials: "encrypted",
      organization_id: "11111111-1111-4111-8111-111111111111",
      channel_id: "channel",
      connection_version: 1,
      youtube_visibility: "public",
    });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          action: "none",
          youtube_visibility: "public",
          watch_url: "https://www.youtube.com/watch?v=abcdefghijk",
        },
      ],
      error: null,
    });
    mocks.update.mockRejectedValueOnce(
      new Error("youtube_provider_unavailable"),
    );
    const values = {
      gameId: "game",
      title: "Final",
      scheduledStart: "2026-11-01T06:30:00Z",
      visibility: "public" as const,
    };
    await expect(
      provisionScheduledYouTubeBroadcast({ id: "user" } as never, values),
    ).resolves.toMatchObject({
      status: "pending",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    await expect(
      provisionScheduledYouTubeBroadcast({ id: "user" } as never, values),
    ).resolves.toMatchObject({
      status: "ready",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    expect(mocks.update).toHaveBeenCalledWith(
      "access",
      "abcdefghijk",
      "game",
      "Final",
      values.scheduledStart,
      "public",
      fetch,
      "channel",
    );
    expect(mocks.broadcast).not.toHaveBeenCalled();
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
      visibility: "unlisted" as const,
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
    expect(mocks.credentials).toHaveBeenCalledWith(user, values.gameId);
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
        visibility: "unlisted" as const,
      },
    );
    expect(result.status).toBe("pending");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("releases an intent when discovery fails before any YouTube insert", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [{ action: "run" }], error: null })
      .mockResolvedValueOnce({ data: [{ action: "run" }], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            status: "ready",
            watch_url: "https://www.youtube.com/watch?v=abcdefghijk",
          },
        ],
        error: null,
      });
    mocks.broadcast.mockRejectedValueOnce(
      new Error("youtube_provider_unavailable"),
    );
    const user = { id: "22222222-2222-4222-8222-222222222222" } as never;
    const values = {
      gameId: "33333333-3333-4333-8333-333333333333",
      title: "Final",
      scheduledStart: "2026-11-01T06:30:00.000Z",
      visibility: "unlisted" as const,
    };
    await expect(
      provisionScheduledYouTubeBroadcast(user, values),
    ).resolves.toMatchObject({
      status: "pending",
      errorCode: "youtube_provider_unavailable",
    });
    expect(mocks.from).toHaveBeenCalledWith("games");
    await expect(
      provisionScheduledYouTubeBroadcast(user, values),
    ).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("keeps an intent when a YouTube insert may have started", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ action: "run" }], error: null });
    mocks.broadcast.mockImplementationOnce(
      async (_values, _fetcher, _allowCreate, onBeforeInsert) => {
        onBeforeInsert();
        throw new Error("youtube_provider_unavailable");
      },
    );
    await expect(
      provisionScheduledYouTubeBroadcast(
        { id: "22222222-2222-4222-8222-222222222222" } as never,
        {
          gameId: "33333333-3333-4333-8333-333333333333",
          title: "Final",
          scheduledStart: "2026-11-01T06:30:00.000Z",
          visibility: "unlisted" as const,
        },
      ),
    ).resolves.toMatchObject({ status: "pending" });
    expect(mocks.from).not.toHaveBeenCalled();
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
      visibility: "unlisted" as const,
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
          visibility: "unlisted" as const,
        },
      ),
    ).resolves.toEqual({
      status: "ready",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
