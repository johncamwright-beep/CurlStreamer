import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { exchangeCodeForSession, verifyOtp } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { exchangeCodeForSession, verifyOtp },
  }),
}));
import { GET } from "./route";

describe("confirmation behind a reverse proxy", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "https://test.example.com");
    exchangeCodeForSession.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  it("returns successful code confirmation to the configured public origin", async () => {
    const response = await GET(
      new Request(
        "https://localhost:3000/auth/confirm?code=test&next=/account",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://test.example.com/account",
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("test");
  });
  it("returns failed confirmation to the public login page", async () => {
    const response = await GET(
      new Request("https://localhost:3000/auth/confirm"),
    );
    expect(response.headers.get("location")).toBe(
      "https://test.example.com/login?confirmation=invalid",
    );
  });
  it("ignores an external next URL and untrusted forwarded host", async () => {
    const response = await GET(
      new Request(
        "https://localhost:3000/auth/confirm?token_hash=test&type=signup&next=https://evil.example",
        { headers: { "x-forwarded-host": "evil.example" } },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://test.example.com/account",
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "test",
      type: "signup",
    });
  });
});
