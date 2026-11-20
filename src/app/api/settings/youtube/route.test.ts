import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  manager: vi.fn(),
  origin: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/youtube-route-auth", () => ({
  requireYouTubeManager: mocks.manager,
  isSameOrigin: mocks.origin,
}));
import { DELETE } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.origin.mockReturnValue(true);
  mocks.manager.mockResolvedValue({ id: "owner" });
});
const request = () =>
  new Request("https://example.test/api/settings/youtube", {
    method: "DELETE",
  });
it("preserves the unfinished-broadcast fence and explains recovery without exposing database details", async () => {
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
    "disconnect_youtube_connection",
    { p_user_id: "owner" },
  );
});
it("reports successful disconnect only after the database succeeds", async () => {
  mocks.rpc.mockResolvedValue({ data: 3, error: null });
  expect(await (await DELETE(request())).json()).toEqual({ ok: true });
});
it("rejects cross-origin and non-manager requests before changing credentials", async () => {
  mocks.origin.mockReturnValue(false);
  expect((await DELETE(request())).status).toBe(403);
  mocks.origin.mockReturnValue(true);
  mocks.manager.mockResolvedValue(null);
  expect((await DELETE(request())).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
