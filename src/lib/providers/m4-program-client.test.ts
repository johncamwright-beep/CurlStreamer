import { createM4ProgramBridge } from "./m4-program-bridge";
import sharp from "sharp";
import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { M4ProgramClient } from "./m4-program-client";
import { StudioTransportUnavailable } from "./studio-transport-error";
const notices = vi.hoisted(() => ({
  changed: undefined as (() => void) | undefined,
  ready: undefined as ((ready: boolean) => void) | undefined,
  close: vi.fn(),
}));
vi.mock("./game-change-subscription", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./game-change-subscription")>()),
  subscribeGameChanges: (
    _notice: unknown,
    changed: () => void,
    ready: (ready: boolean) => void,
  ) => {
    notices.changed = changed;
    notices.ready = ready;
    return notices.close;
  },
}));
const game = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const origin = "https://pilot.invalid";
const cookie = `curlcast_m3_program=aaa.bbb.ccc; Path=/api/games/${game}/studio-m3; HttpOnly; Secure; SameSite=Strict; Max-Age=14400`;
const exchange = (value = cookie) =>
  new Response('{"ok":true}', {
    headers: { "set-cookie": value, date: new Date().toUTCString() },
  });
const ticket = {
  cameraRole: "camera-home",
  sessionId: session,
  generation: 1,
  negotiationId: null,
  assignmentGeneration: null,
  expiresAt: Date.now() + 10000,
};
const projected = {
  id: game,
  config: {
    eventName: "Final",
    homeName: "Home",
    awayName: "Away",
    homeColor: "#000000",
    awayColor: "#ffffff",
  },
  score: { hammer: "home", totals: { home: 2, away: 1 }, currentEnd: 3 },
  layout: "split",
  broadcast: "idle",
  audioMuted: true,
  cameraFraming: { "camera-home": "contain", "camera-away": "contain" },
  sponsors: [
    {
      id: "broadcast-sponsor-0",
      name: "Community",
      altText: "Community sponsor",
      dataUrl: "/sponsors/community.svg",
      enabled: true,
      rotation: 0,
    },
  ],
  sponsorMode: {
    active: false,
    style: "overlay",
    intervalSeconds: 4,
    startedAt: null,
    rotationOffset: 0,
    paused: false,
  },
};
describe("Node program authority", () => {
  it("carries an explicit celebration Stop to the native renderer", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ game: { ...projected, celebrationStopped: true } }),
        ),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    expect((await client.readGame()).celebrationStopped).toBe(true);
    client.close();
  });
  it.each([-5000, -2500, 0, 5000])(
    "retains signed microphone sync adjustment %s for its authorized game",
    async (programAudioDelayMs) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(exchange())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ game: { ...projected, programAudioDelayMs } }),
          ),
        );
      const client = new M4ProgramClient(game, origin, fetcher);
      await client.exchange("a".repeat(43));
      expect((await client.readGame()).programAudioDelayMs).toBe(
        programAudioDelayMs,
      );
      client.close();
    },
  );
  it.each([-5001, 5001, -0.5, 0.5])(
    "rejects invalid microphone sync adjustment %s in a game projection",
    async (programAudioDelayMs) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(exchange())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ game: { ...projected, programAudioDelayMs } }),
          ),
        );
      const client = new M4ProgramClient(game, origin, fetcher);
      await client.exchange("a".repeat(43));
      await expect(client.readGame()).rejects.toThrow("m4_program_unavailable");
      expect(client.active).toBe(false);
    },
  );
  it("retains public uploaded team artwork through the strict projection", async () => {
    const homeLogoUrl =
      "https://storage.invalid/storage/v1/object/public/team-public-media/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            game: {
              ...projected,
              config: {
                ...projected.config,
                homeLogoUrl,
                privateKey: "hidden",
              },
            },
          }),
        ),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    expect((await client.readGame()).config).toEqual({
      ...projected.config,
      homeLogoUrl,
    });
    client.close();
  });
  it.each([
    "http://storage.invalid/logo.png",
    "https://user:password@storage.invalid/logo.png",
    "https://storage.invalid/logo.png?token=secret",
    "https://storage.invalid/logo.png#secret",
  ])("rejects unsafe team logo source %s", async (homeLogoUrl) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            game: {
              ...projected,
              config: { ...projected.config, homeLogoUrl },
            },
          }),
        ),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    await expect(client.readGame()).rejects.toThrow("m4_program_unavailable");
    client.close();
  });
  it("retains the checked private native audio intent without enabling phone audio", async () => {
    const privateGame = {
      ...projected,
      cameraAudio: { "camera-home": { enabled: false, volume: 0.4 } },
      nativeCameraAudio: { "camera-home": { enabled: true, volume: 0.4 } },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ game: privateGame })),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    expect(await client.readGame()).toEqual(privateGame);
    client.close();
  });
  it("reports an exhausted temporary outage as retryable and logs recovery without credentials", async () => {
    const trace = "33333333-3333-4333-8333-333333333333";
    const diagnostic = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(
        new Response("private token body", {
          status: 503,
          headers: { "x-curlstreamer-trace": trace },
        }),
      )
      .mockRejectedValueOnce(new TypeError("private URL"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ game: projected })));
    const client = new M4ProgramClient(game, origin, fetcher, diagnostic);
    await client.exchange("a".repeat(43));
    await expect(client.readGame()).rejects.toBeInstanceOf(
      StudioTransportUnavailable,
    );
    expect(client.active).toBe(true);
    expect(await client.readGame()).toEqual(projected);
    expect(diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: "http",
        code: "network_unavailable",
        status: 503,
        trace,
      }),
    );
    expect(diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: "http",
        code: "recovered",
        action: "read",
      }),
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(
      /private|aaa\.bbb|pilot\.invalid/,
    );
    client.close();
  });
  it("recovers a temporary server failure without replacing program authority", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ game: projected })));
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    expect(await client.readGame()).toEqual(projected);
    expect(client.active).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.close();
  });
  it("keeps the existing credential after a bounded outage but still rejects revocation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockRejectedValueOnce(new TypeError("network"))
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response("revoked", { status: 403 }));
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    await expect(client.readGame()).rejects.toThrow();
    expect(client.active).toBe(true);
    await expect(client.readGame()).rejects.toThrow();
    expect(client.active).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("reads only its fixed game and strips unknown fields at every projection level", async () => {
    const upstream = {
      ...projected,
      broadcastSchedule: {
        scheduledStart: "2026-10-20T22:30:00Z",
        timezone: "America/Toronto",
        private: "not for the renderer",
      },
      secret: "private",
      config: { ...projected.config, youtubeTitle: "private" },
      score: {
        ...projected.score,
        history: "private",
        totals: { ...projected.score.totals, secret: "private" },
      },
      cameraFraming: { ...projected.cameraFraming, secret: "private" },
      sponsors: [{ ...projected.sponsors[0], storagePath: "private" }],
      sponsorMode: { ...projected.sponsorMode, muteDuring: true },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ game: upstream, secret: "private" })),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    expect(await client.readGame()).toEqual({
      ...projected,
      broadcastSchedule: {
        scheduledStart: "2026-10-20T22:30:00Z",
        timezone: "America/Toronto",
      },
    });
    expect(fetcher.mock.calls[1][0]).toBe(
      `${origin}/api/games/${game}/studio-m3`,
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { origin, cookie: "curlcast_m3_program=aaa.bbb.ccc" },
    });
    expect(fetcher.mock.calls[1][1]).not.toHaveProperty("body");
    client.close();
  });
  it("accepts a saved layout with both camera pictures hidden", async () => {
    const hidden = { ...projected, layout: "none" };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(new Response(JSON.stringify({ game: hidden })));
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    expect(await client.readGame()).toEqual(hidden);
    expect(client.active).toBe(true);
    client.close();
  });

  it.each([
    { ...projected, id: session, programAudioDelayMs: -2500 },
    { ...projected, score: { ...projected.score, currentEnd: "3" } },
    {
      ...projected,
      sponsors: [{ ...projected.sponsors[0], dataUrl: "javascript:alert(1)" }],
    },
  ])("rejects a mismatched or unsafe game projection", async (value) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(new Response(JSON.stringify({ game: value })));
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    await expect(client.readGame()).rejects.toThrow(/^m4_program_unavailable$/);
    expect(client.active).toBe(false);
  });
  it("does not release a late game response after close", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    const pending = client.readGame();
    client.close();
    resolve(new Response(JSON.stringify({ game: projected })));
    await expect(pending).rejects.toThrow(/^m4_program_unavailable$/);
    await expect(client.readGame()).rejects.toThrow(/^m4_program_unavailable$/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("treats failed whole-program GET as terminal rather than a waiting camera", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(
        new Response("private-server-error", { status: 409 }),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    await expect(client.readGame()).rejects.toThrow(/^m4_program_unavailable$/);
    expect(client.active).toBe(false);
  });
  it("keeps a healthy camera available when the other camera is unpaired", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(new Response("unpaired", { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ticket)));
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    await expect(
      client.action({ action: "ticket", cameraRole: "camera-away" }),
    ).rejects.toThrow("m4_program_unavailable");
    expect(client.active).toBe(true);
    await expect(
      client.action({ action: "check", cameraRole: "camera-home" }),
    ).resolves.toEqual(ticket);
    client.close();
  });
  it("keeps cookie private and uses only the fixed authorized endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...ticket, secret: "must not escape" })),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    expect(JSON.stringify(client)).toBe("{}");
    expect(
      await client.action({ action: "check", cameraRole: "camera-home" }),
    ).toEqual(ticket);
    expect(fetcher.mock.calls[1][0]).toBe(
      `${origin}/api/games/${game}/studio-m3`,
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      redirect: "error",
      headers: { origin, cookie: "curlcast_m3_program=aaa.bbb.ccc" },
    });
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty("cookie");
    client.close();
    expect(client.active).toBe(false);
    await expect(
      client.action({ action: "stop", cameraRole: "camera-home" }),
    ).rejects.toThrow("m4_program_unavailable");
  });
  it.each([
    cookie.replace("HttpOnly; ", ""),
    cookie.replace("Secure; ", ""),
    cookie + "; Domain=pilot.invalid",
    cookie.replace("14400", "14401"),
    cookie.replace(game, session),
  ])("rejects malformed cookie scope %s", async (bad) => {
    const client = new M4ProgramClient(
      game,
      origin,
      vi.fn<typeof fetch>().mockResolvedValue(exchange(bad)),
    );
    await expect(client.exchange("a".repeat(43))).rejects.toThrow(
      "m4_program_unavailable",
    );
    expect(client.active).toBe(false);
  });
  it("does not install a late exchange after close or retry a consumed invitation", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const client = new M4ProgramClient(game, origin, fetcher);
    const pending = client.exchange("a".repeat(43));
    client.close();
    resolve(exchange());
    await expect(pending).rejects.toThrow("m4_program_unavailable");
    await expect(client.exchange("a".repeat(43))).rejects.toThrow(
      "m4_program_unavailable",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects redirect responses without exposing provider content", async () => {
    const client = new M4ProgramClient(
      game,
      origin,
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("private-provider-error", {
          status: 302,
          headers: { location: "https://elsewhere.invalid" },
        }),
      ),
    );
    await expect(client.exchange("a".repeat(43))).rejects.toThrow(
      /^m4_program_unavailable$/,
    );
  });
  it("fences an in-flight response when the client closes", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    const pending = client.action({
      action: "check",
      cameraRole: "camera-home",
    });
    client.close();
    resolve(new Response(JSON.stringify(ticket)));
    await expect(pending).rejects.toThrow("m4_program_unavailable");
  });
  it("rejects privileged actions and oversized upstream data", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockResolvedValueOnce(new Response("x".repeat(65537)));
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    await expect(client.action({ action: "prepare" } as never)).rejects.toThrow(
      "m4_program_unavailable",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      client.action({ action: "check", cameraRole: "camera-home" }),
    ).rejects.toThrow("m4_program_unavailable");
    expect(client.active).toBe(false);
  });
});

it("keeps the program local between changes and resumes fresh reads after disconnect", async () => {
  const changeNotice = {
    url: "https://example.supabase.co",
    key: "public-key",
    topic: "game-change-" + "a".repeat(64),
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(exchange())
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ game: projected, changeNotice })),
    );
  const client = new M4ProgramClient(game, origin, fetcher);
  await client.exchange("a".repeat(43));
  await client.readGame();
  notices.ready!(true);
  await client.readGame(); // Close the subscribe/read race with a fresh snapshot.
  const before = fetcher.mock.calls.length;
  for (let i = 0; i < 8; i++) expect((await client.readGame()).id).toBe(game);
  expect(fetcher).toHaveBeenCalledTimes(before);
  notices.changed!();
  await client.readGame();
  expect(fetcher).toHaveBeenCalledTimes(before + 1);
  notices.ready!(false);
  await client.readGame();
  await client.readGame();
  expect(fetcher).toHaveBeenCalledTimes(before + 3);
  client.close();
  await expect(client.readGame()).rejects.toThrow();
  expect(notices.close).toHaveBeenCalled();
});

it("receives a celebration within one second even when its change notice is lost", async () => {
  let clock = 0;
  const time = vi.spyOn(performance, "now").mockImplementation(() => clock);
  let celebration: object | undefined;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(exchange())
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            game: { ...projected, celebration },
            changeNotice: {
              url: "https://example.supabase.co",
              key: "public-key",
              topic: "game-change-" + "a".repeat(64),
            },
          }),
        ),
    );
  const client = new M4ProgramClient(game, origin, fetcher);
  try {
    await client.exchange("a".repeat(43));
    await client.readGame();
    notices.ready!(true);
    await client.readGame();
    const startedAt = Date.now() + 5000;
    celebration = {
      id: "33333333-3333-4333-8333-333333333333",
      templateId: "cat-dance",
      playerId: "player",
      playerName: "Sam",
      startedAt,
      expiresAt: startedAt + 9700,
      volume: 0.6,
      muted: false,
    };
    clock = 999;
    expect((await client.readGame()).celebration).toBeUndefined();
    clock = 1000;
    expect((await client.readGame()).celebration).toMatchObject(celebration);
    celebration = undefined; // Stop must propagate without a notice too.
    clock = 2000;
    expect((await client.readGame()).celebration).toBeUndefined();
  } finally {
    client.close();
    time.mockRestore();
  }
});

it.each(["lightsaber", "cat-dance"])(
  "carries %s through the real native client and authenticated local artwork bridge",
  async (templateId) => {
    const organizationId = "22222222-2222-4222-8222-222222222222";
    const bytes = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const now = Date.now();
    const cue = {
      id: "33333333-3333-4333-8333-333333333333",
      templateId,
      playerId: "roster-1",
      playerName: "Sam",
      startedAt: now + 2500,
      expiresAt: now + 2500 + (templateId === "cat-dance" ? 9700 : 6167),
      volume: 0.6,
      muted: false,
      headshotUrl:
        "https://storage.invalid/storage/v1/object/sign/celebration-headshots/" +
        organizationId +
        "/44444444-4444-4444-8444-444444444444.png?token=short",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(exchange())
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              organizationId,
              game: {
                ...projected,
                celebration: { ...cue, privateStoragePath: "private" },
              },
            }),
          ),
      );
    const client = new M4ProgramClient(game, origin, fetcher);
    await client.exchange("a".repeat(43));
    const assets = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array(bytes), {
        headers: { "content-type": "image/png" },
      }),
    );
    const bridge = await createM4ProgramBridge(client, undefined, {
      directory: ".",
      sponsorStorageOrigin: "https://storage.invalid",
      celebrationFetcher: assets,
    });
    try {
      const page = await fetch(bridge.rendererUrl);
      const headers = {
        origin: bridge.address,
        cookie: page.headers.get("set-cookie")!.split(";")[0],
      };
      expect(page.headers.get("content-security-policy")).toContain(
        "img-src 'self' data: blob:",
      );
      const response = await fetch(bridge.address + "/program", { headers });
      const value = (await response.json()).game;
      expect(value.celebration).toMatchObject({
        ...cue,
        headshotUrl: expect.stringMatching(
          /^\/celebrations\/headshot\/[a-f0-9]{32}$/,
        ),
      });
      expect(JSON.stringify(value)).not.toContain("storage.invalid");
      expect(value.celebration).not.toHaveProperty("privateStoragePath");
      const image = await fetch(
        bridge.address + value.celebration.headshotUrl,
        {
          headers,
        },
      );
      expect(image.status).toBe(200);
      expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
      expect(
        (await fetch(bridge.address + value.celebration.headshotUrl)).status,
      ).toBe(403);
      expect(assets).toHaveBeenCalledWith(
        new URL(cue.headshotUrl),
        expect.objectContaining({ redirect: "error", cache: "no-store" }),
      );
    } finally {
      await bridge.close();
    }
  },
);
