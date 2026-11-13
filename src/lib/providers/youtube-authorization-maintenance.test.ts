import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  decrypt: vi.fn(),
  revoke: vi.fn(),
  refresh: vi.fn(),
  channel: vi.fn(),
  resources: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("./youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: mocks.decrypt,
}));
vi.mock("./youtube-revocation", () => ({
  revokeYouTubeRefreshToken: mocks.revoke,
}));
vi.mock("./youtube", () => ({
  refreshYouTubeAccessToken: mocks.refresh,
  loadOwnedYouTubeChannel: mocks.channel,
}));
vi.mock("./youtube-resource-retention", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifyRetainedYouTubeResources: mocks.resources,
}));
import { maintainYouTubeAuthorizations } from "./youtube-authorization-maintenance";
const row = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  connection_version: 1,
  encrypted_credentials: "fixture-ciphertext",
  channel_id: "team",
  disconnect_pending: false,
  withdrawal_requested_at: null,
  maintenance_claim_id: "22222222-2222-4222-8222-222222222222",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.decrypt.mockReturnValue("fixture-refresh");
  mocks.refresh.mockResolvedValue("fixture-access");
  mocks.channel.mockResolvedValue({ id: "team", title: "Team" });
  mocks.resources.mockResolvedValue({
    missingBroadcasts: [],
    missingStreams: [],
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "claim_youtube_authorization_maintenance"
        ? [row]
        : name === "get_youtube_maintenance_resources"
          ? []
          : name === "record_youtube_resource_verification"
            ? true
            : "verified",
    error: null,
  }));
});
it("verifies the grant, owned channel and retained resource cache before advancing the date", async () => {
  expect((await maintainYouTubeAuthorizations()).verified).toBe(1);
  expect(mocks.resources).toHaveBeenCalledWith(
    "fixture-access",
    "team",
    [],
    expect.any(Function),
  );
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_youtube_authorization_maintenance",
    expect.objectContaining({
      p_expected_version: 1,
      p_claim_id: row.maintenance_claim_id,
      p_result: "valid",
      p_channel_title: "Team",
    }),
  );
});
it("resumes pending revocation directly without refreshing authorization", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "claim_youtube_authorization_maintenance"
        ? [{ ...row, disconnect_pending: true }]
        : "removed",
    error: null,
  }));
  expect((await maintainYouTubeAuthorizations()).removed).toBe(1);
  expect(mocks.revoke).toHaveBeenCalledWith(
    "fixture-refresh",
    expect.any(Function),
  );
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_youtube_authorization_maintenance",
    expect.objectContaining({ p_result: "revocation_confirmed" }),
  );
});
it("classifies explicit refresh invalid_grant as revoked", async () => {
  mocks.refresh.mockRejectedValue(new Error("youtube_reconnect_required"));
  await maintainYouTubeAuthorizations();
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_youtube_authorization_maintenance",
    expect.objectContaining({ p_result: "revoked" }),
  );
});
it("retains retry during resource failures even if they report unauthorized", async () => {
  mocks.resources.mockRejectedValue(new Error("youtube_reconnect_required"));
  await maintainYouTubeAuthorizations();
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_youtube_authorization_maintenance",
    expect.objectContaining({ p_result: "unavailable" }),
  );
});
it("does not overwrite a newer grant when recording returns stale", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "claim_youtube_authorization_maintenance"
        ? [row]
        : name === "get_youtube_maintenance_resources"
          ? []
          : name === "record_youtube_resource_verification"
            ? false
            : "stale",
    error: null,
  }));
  expect((await maintainYouTubeAuthorizations()).stale).toBe(1);
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_youtube_authorization_maintenance",
    expect.objectContaining({ p_result: "unavailable" }),
  );
});
it("isolates failures and returns only aggregate counts", async () => {
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "claim_youtube_authorization_maintenance"
      ? { data: [row], error: null }
      : { data: null, error: { message: "fixture-secret" } },
  );
  const summary = await maintainYouTubeAuthorizations();
  expect(summary.failed).toBe(1);
  expect(JSON.stringify(summary)).not.toContain("fixture");
});
it("rejects malformed service receipts without exposing their content", async () => {
  mocks.rpc.mockResolvedValue({
    data: [{ encrypted_credentials: "secret" }],
    error: null,
  });
  await expect(maintainYouTubeAuthorizations()).rejects.toThrow(
    "youtube_maintenance_unavailable",
  );
  expect(mocks.decrypt).not.toHaveBeenCalled();
});
