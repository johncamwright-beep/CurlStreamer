import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "11111111-1111-4111-8111-111111111111" };
const organizationId = "22222222-2222-4222-8222-222222222222";
const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  manager: vi.fn(),
  configuration: vi.fn(),
  credentials: vi.fn(),
  decrypt: vi.fn(),
  refresh: vi.fn(),
  channel: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@/lib/youtube-route-auth", () => ({
  isSameOrigin: mocks.sameOrigin,
  requireYouTubeManager: mocks.manager,
}));
vi.mock("@/lib/youtube-connection", () => ({
  getYouTubeCredentials: mocks.credentials,
  finishYouTubeConnectionTest: mocks.finish,
}));
vi.mock("@/lib/providers/youtube", () => ({
  youtubeConfiguration: mocks.configuration,
  refreshYouTubeAccessToken: mocks.refresh,
  loadOwnedYouTubeChannel: mocks.channel,
}));
vi.mock("@/lib/providers/youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: mocks.decrypt,
}));

import { POST } from "./route";

const request = () =>
  new Request("https://example.test/api/settings/youtube/test", {
    method: "POST",
  });

describe("YouTube connection test", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sameOrigin.mockReturnValue(true);
    mocks.manager.mockResolvedValue(user);
    mocks.configuration.mockReturnValue({});
    mocks.credentials.mockResolvedValue({
      organization_id: organizationId,
      encrypted_credentials: "envelope",
      channel_id: "saved-channel",
      connection_version: 8,
    });
    mocks.decrypt.mockReturnValue("refresh");
    mocks.refresh.mockResolvedValue("access");
    mocks.channel.mockResolvedValue({ id: "saved-channel", title: "Club TV" });
    mocks.finish.mockResolvedValue(undefined);
  });

  it("verifies identity without claiming or creating a broadcast", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      message: expect.stringContaining("No broadcast was created or published"),
    });
    expect(mocks.finish).toHaveBeenCalledWith(
      user,
      organizationId,
      8,
      true,
      null,
    );
  });

  it("marks a changed channel as reconnect-required without replacing it", async () => {
    mocks.channel.mockResolvedValue({
      id: "different-channel",
      title: "Other",
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "channel_mismatch" });
    expect(mocks.finish).toHaveBeenCalledWith(
      user,
      organizationId,
      8,
      false,
      "channel_mismatch",
    );
  });

  it("records transient Google failures without labelling credentials revoked", async () => {
    mocks.refresh.mockRejectedValue(new Error("youtube_provider_unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "youtube_provider_unavailable",
      error: expect.stringContaining(
        "could not reach Google's YouTube service",
      ),
    });
    expect(mocks.finish).toHaveBeenCalledWith(
      user,
      organizationId,
      8,
      false,
      "test_unavailable",
    );
  });

  it("marks an invalid grant as requiring reconnect", async () => {
    mocks.refresh.mockRejectedValue(new Error("youtube_reconnect_required"));
    const response = await POST(request());
    expect((await response.json()).error).toContain("Reconnect this channel");
    expect(mocks.finish).toHaveBeenCalledWith(
      user,
      organizationId,
      8,
      false,
      "reconnect_required",
    );
  });

  it.each([
    ["youtube_scope_missing", "approve the requested permissions", true],
    [
      "youtube_channel_selection_required",
      "choose the account that owns the team's channel",
      true,
    ],
    ["youtube_credentials_unavailable", "could not read the saved", true],
    ["youtube_quota_exceeded", "API limit has been reached", false],
    ["youtube_live_permission_blocked", "blocking live broadcasts", false],
    ["youtube_live_streaming_not_enabled", "not enabled", false],
    ["youtube_provider_rejected", "Google rejected", false],
  ])(
    "returns an actionable safe category for %s",
    async (code, message, reconnect) => {
      mocks.channel.mockRejectedValue(new Error(code));
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code,
        error: expect.stringContaining(message),
      });
      expect(mocks.finish).toHaveBeenCalledWith(
        user,
        organizationId,
        8,
        false,
        reconnect ? "reconnect_required" : "test_unavailable",
      );
    },
  );

  it("identifies server configuration failures before loading saved authorization", async () => {
    mocks.configuration.mockImplementation(() => {
      throw new Error("youtube_configuration_unavailable");
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "youtube_configuration_unavailable",
      error: expect.stringContaining("server configuration issue"),
    });
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("never returns or persists arbitrary provider exceptions or credentials", async () => {
    const secret = "Bearer private-token rtmps://private.test/private-key";
    mocks.refresh.mockRejectedValue(new Error(secret));
    const response = await POST(request());
    const body = await response.json();
    expect(body).toEqual({
      code: "youtube_test_unavailable",
      error: expect.stringContaining("could not be completed"),
    });
    expect(JSON.stringify(body)).not.toContain("private");
    expect(JSON.stringify(mocks.finish.mock.calls)).not.toContain("private");
    expect(mocks.finish).toHaveBeenCalledWith(
      user,
      organizationId,
      8,
      false,
      "test_unavailable",
    );
  });

  it("rejects cross-origin and unauthorized calls before loading credentials", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
    mocks.sameOrigin.mockReturnValue(true);
    mocks.manager.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it("does not report success when the versioned completion is stale", async () => {
    mocks.finish.mockRejectedValue(new Error("youtube_test_finish_failed"));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "youtube_test_finish_failed",
      error: expect.stringContaining("could not be saved"),
    });
  });
});
