import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));
import { rateLimit } from "./rate-limit";
describe("shared request limits", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("uses a stable hashed identity shared by requests without storing the IP", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await rateLimit("claim:192.0.2.1", 20);
    await rateLimit("claim:192.0.2.1", 20);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0][1]).toEqual({
      p_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_limit: 20,
      p_window_ms: 60000,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("192.0.2.1");
  });
  it("honors exhausted shared counters", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await rateLimit("create:user")).toBe(false);
  });
  it.each([
    { data: null, error: null },
    { data: true, error: { message: "offline" } },
  ])("fails closed for invalid responses", async (response) => {
    rpc.mockResolvedValue(response);
    await expect(rateLimit("create:user")).rejects.toThrow("unavailable");
  });
  it("rejects missing credentials and invalid limits before making a request", async () => {
    await expect(rateLimit("x", 0)).rejects.toThrow();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await expect(rateLimit("x")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
