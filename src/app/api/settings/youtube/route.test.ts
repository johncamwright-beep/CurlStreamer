import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  manager: vi.fn(),
  origin: vi.fn(),
  decrypt: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/youtube-route-auth", () => ({
  requireYouTubeManager: mocks.manager,
  isSameOrigin: mocks.origin,
}));
vi.mock("@/lib/providers/youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: mocks.decrypt,
}));
vi.mock("@/lib/providers/youtube-revocation", () => ({
  revokeYouTubeRefreshToken: mocks.revoke,
}));
import { DELETE } from "./route";
const org = "f0eabf43-6442-4ca7-a1c7-b3d9a0378c14",
  operation = "462a4808-8ff5-4e29-aa68-c2e4b9cfc9b7";
const receipt = {
  organization_id: org,
  encrypted_credentials: "encrypted",
  connection_version: 2,
  disconnect_operation_id: operation,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.origin.mockReturnValue(true);
  mocks.manager.mockResolvedValue({ id: "owner" });
  mocks.decrypt.mockReturnValue("fixture-refresh");
  mocks.revoke.mockResolvedValue(undefined);
});
const request = () =>
  new Request("https://example.test/api/settings/youtube", {
    method: "DELETE",
  });
it("preserves the unfinished-broadcast fence before contacting Google", async () => {
  mocks.rpc.mockResolvedValue({
    data: null,
    error: {
      code: "55000",
      message: "youtube connection has an unfinished broadcast",
    },
  });
  const response = await DELETE(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Reconnect the same channel");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    "begin_youtube_disconnect",
    { p_user_id: "owner" },
  );
  expect(mocks.decrypt).not.toHaveBeenCalled();
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it("reports success only after authorization fence, Google revocation and matching cleanup", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: [receipt], error: null })
    .mockResolvedValueOnce({ data: 3, error: null });
  expect(await (await DELETE(request())).json()).toEqual({ ok: true });
  expect(mocks.decrypt).toHaveBeenCalledExactlyOnceWith("encrypted", org);
  expect(mocks.revoke).toHaveBeenCalledWith(
    "fixture-refresh",
    expect.any(Function),
  );
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "finish_youtube_disconnect", {
    p_user_id: "owner",
    p_expected_organization_id: org,
    p_expected_version: 2,
    p_disconnect_operation_id: operation,
  });
  expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.revoke.mock.invocationCallOrder[0],
  );
  expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.rpc.mock.invocationCallOrder[1],
  );
});
it("retains the pending credential after failed revocation and lets Disconnect retry", async () => {
  mocks.rpc.mockResolvedValue({ data: [receipt], error: null });
  mocks.revoke.mockRejectedValueOnce(new Error("provider-secret"));
  const response = await DELETE(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Try Disconnect again");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  mocks.rpc
    .mockResolvedValueOnce({ data: [receipt], error: null })
    .mockResolvedValueOnce({ data: 3, error: null });
  expect(await (await DELETE(request())).json()).toEqual({ ok: true });
});
it("retains a retryable pending operation after cleanup failure", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: [receipt], error: null })
    .mockResolvedValueOnce({
      data: null,
      error: { code: "PT409", message: "internal-details" },
    });
  const response = await DELETE(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("disconnect is pending");
});
it("keeps undecryptable credentials fenced without attempting Google", async () => {
  mocks.rpc.mockResolvedValue({ data: [receipt], error: null });
  mocks.decrypt.mockImplementation(() => {
    throw new Error("private-envelope");
  });
  const response = await DELETE(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Try Disconnect again");
  expect(mocks.revoke).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("treats an already disconnected team as an idempotent success", async () => {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        ...receipt,
        encrypted_credentials: null,
        disconnect_operation_id: null,
      },
    ],
    error: null,
  });
  expect(await (await DELETE(request())).json()).toEqual({ ok: true });
  expect(mocks.revoke).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("rejects malformed credential receipts before decrypting or revoking", async () => {
  mocks.rpc.mockResolvedValue({
    data: [{ ...receipt, disconnect_operation_id: null }],
    error: null,
  });
  expect((await DELETE(request())).status).toBe(409);
  expect(mocks.decrypt).not.toHaveBeenCalled();
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it("rejects cross-origin and non-manager requests before accessing credentials", async () => {
  mocks.origin.mockReturnValue(false);
  expect((await DELETE(request())).status).toBe(403);
  mocks.origin.mockReturnValue(true);
  mocks.manager.mockResolvedValue(null);
  expect((await DELETE(request())).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.revoke).not.toHaveBeenCalled();
});
