import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  remove: vi.fn(),
  channel: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    channel: mocks.channel.mockReturnValue({ httpSend: mocks.send }),
    removeChannel: mocks.remove,
  }),
}));
import { gameChangeNotice, publishGameChange } from "./game-change-notice";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function config() {
  vi.stubEnv(
    "ROLE_TOKEN_SECRET",
    "test-secret-that-has-at-least-32-characters",
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
}
it("provides opaque game-isolated hints without server credentials or game data", async () => {
  config();
  const notice = gameChangeNotice("game-one")!;
  expect(notice.topic).toMatch(/^game-change-[a-f0-9]{64}$/);
  expect(notice.topic).not.toBe(gameChangeNotice("game-two")!.topic);
  expect(JSON.stringify(notice)).not.toContain("test-secret");
  await publishGameChange("game-one");
  expect(mocks.channel).toHaveBeenCalledWith(notice.topic);
  expect(mocks.send).toHaveBeenCalledWith("changed", {}, { timeout: 1000 });
  expect(mocks.remove).toHaveBeenCalledTimes(1);
});
it("keeps committed writes successful when notices fail", async () => {
  config();
  mocks.send.mockRejectedValueOnce(Error("offline"));
  await expect(publishGameChange("game")).resolves.toBeUndefined();
  expect(mocks.remove).toHaveBeenCalledTimes(1);
});
it("falls back without valid public service configuration", () => {
  config();
  vi.stubEnv("ROLE_TOKEN_SECRET", "");
  expect(gameChangeNotice("game")).toBeUndefined();
});
