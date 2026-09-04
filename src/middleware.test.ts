import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
import { middleware } from "./middleware";

describe("middleware configuration boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reaches verified session refresh with explicitly supplied public configuration", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/api/games/game-1"),
    );
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "public-test-key",
      expect.any(Object),
    );
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])(
    "fails closed before refresh when %s is absent",
    async (name) => {
      vi.stubEnv(name, undefined);
      vi.stubEnv("SUPABASE_SECRET_KEY", "server-only-test-value");
      await expect(
        middleware(new NextRequest("http://localhost/games/game-1")),
      ).rejects.toThrow(`Missing environment variable: ${name}`);
      expect(mocks.createServerClient).not.toHaveBeenCalled();
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );

  it("propagates refreshed cookies to the request and response", async () => {
    const request = new NextRequest("http://localhost/auth/confirm", {
      headers: { cookie: "session=old" },
    });
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      expect(options.cookies.getAll()).toEqual([
        { name: "session", value: "old" },
      ]);
      return {
        auth: {
          getUser: async () => {
            options.cookies.setAll([
              {
                name: "session",
                value: "refreshed",
                options: { httpOnly: true, sameSite: "lax", path: "/" },
              },
            ]);
          },
        },
      };
    });
    const response = await middleware(request);
    expect(request.cookies.get("session")?.value).toBe("refreshed");
    expect(response.cookies.get("session")).toMatchObject({
      value: "refreshed",
      httpOnly: true,
      sameSite: "lax",
    });
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "session=refreshed",
    );
  });
});
