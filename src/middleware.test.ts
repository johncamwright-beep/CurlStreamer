import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { indexNowKey, indexNowKeyPath } from "@/lib/indexnow";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
import { middleware } from "./middleware";

describe("middleware configuration boundary", () => {
  it.each(["", "/exchange", "/target", "/output-intent", "/observe"])(
    "native desktop %s skips cookie refresh; bearer validation belongs to the route",
    async (suffix) => {
      await middleware(
        new NextRequest(
          `https://www.curlstreamer.app/api/games/11111111-1111-4111-8111-111111111111/studio-m4/desktop${suffix}`,
        ),
      );
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );
  it.each(["desktop-pairing", "desktop/unknown"])(
    "keeps browser-auth route %s behind refresh",
    async (suffix) => {
      await middleware(
        new NextRequest(
          `https://www.curlstreamer.app/api/games/11111111-1111-4111-8111-111111111111/studio-m4/${suffix}`,
        ),
      );
      expect(mocks.getUser).toHaveBeenCalledOnce();
    },
  );
  it("ships the exact public IndexNow ownership key", () => {
    expect(indexNowKey).toMatch(/^[a-f0-9]{32}$/);
    expect(
      readFileSync(
        new URL(`../public${indexNowKeyPath}`, import.meta.url),
        "utf8",
      ).trim(),
    ).toBe(indexNowKey);
  });
  it.each([
    "teambenning.curlstreamer.app",
    "www.curlstreamer.app",
    "curlstreamer.app",
  ])(
    "serves the exact IndexNow file on %s without authentication",
    async (host) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
      const response = await middleware(
        new NextRequest(`https://${host}${indexNowKeyPath}`, {
          headers: { host },
        }),
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(mocks.createServerClient).not.toHaveBeenCalled();
    },
  );
  it.each([
    "/other.txt",
    `${indexNowKeyPath}.txt`,
    `/nested${indexNowKeyPath}`,
    "/account",
    "/api/games/game-1",
  ])("keeps team-host nonroot path %s unavailable", async (path) => {
    const response = await middleware(
      new NextRequest(`https://teambenning.curlstreamer.app${path}`, {
        headers: { host: "teambenning.curlstreamer.app" },
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
  it("keeps unrelated text files on the main host behind session refresh", async () => {
    await middleware(
      new NextRequest("https://www.curlstreamer.app/other.txt", {
        headers: { host: "www.curlstreamer.app" },
      }),
    );
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
  it.each(["robots.txt", "sitemap.xml"])(
    "serves team %s without an authentication request",
    async (path) => {
      const response = await middleware(
        new NextRequest(`https://teambenning.curlstreamer.app/${path}`, {
          headers: { host: "teambenning.curlstreamer.app" },
        }),
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );
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

  it("serves the public download without an authentication request", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    const response = await middleware(
      new NextRequest("https://www.curlstreamer.app/download"),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

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
