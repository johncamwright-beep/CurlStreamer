import { describe, expect, it, vi } from "vitest";
import { M4ProgramClient } from "./m4-program-client";
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
    { ...projected, id: session },
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
