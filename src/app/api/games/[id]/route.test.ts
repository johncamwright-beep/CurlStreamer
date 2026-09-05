import { createServer, type Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { gameFixture, testGameId } from "@/test/game-fixture";
import {
  issueOrganizerToken,
  issueParticipantToken,
  issueChooserToken,
} from "@/lib/tokens";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loadActiveTeam: vi.fn(),
  listTeamGames: vi.fn(),
  listDeletedTeamGames: vi.fn(),
  getGame: vi.fn(),
  readGame: vi.fn(),
  gameBroadcastSponsors: vi.fn(),
  gameLibrarySponsors: vi.fn(),
  updateGame: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/team-games", () => ({
  loadActiveTeam: mocks.loadActiveTeam,
  listTeamGames: mocks.listTeamGames,
  listDeletedTeamGames: mocks.listDeletedTeamGames,
}));
vi.mock("@/lib/store", () => ({
  getGame: mocks.getGame,
  updateGame: mocks.updateGame,
}));
vi.mock("@/lib/providers/game-read", () => ({ readGame: mocks.readGame }));
vi.mock("@/lib/providers/sponsor-library", () => ({
  gameBroadcastSponsors: mocks.gameBroadcastSponsors,
  gameLibrarySponsors: mocks.gameLibrarySponsors,
}));
import { GET, PATCH } from "./route";
import { GameStateConflictError } from "@/lib/game-state-conflict";

// Real loopback HTTP transport, route, authorization and signed tokens.
// Only external account, persistence, and sponsor providers are replaced.
describe("GET /api/games/[id] over HTTP", () => {
  let server: Server;
  let origin: string;
  let game: ReturnType<typeof gameFixture>;
  beforeAll(async () => {
    vi.stubEnv(
      "ROLE_TOKEN_SECRET",
      "curlcast-local-route-test-secret-32-characters",
    );
    server = createServer(async (incoming, outgoing) => {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const response = await GET(
          new Request(`${origin}${incoming.url}`, { headers }),
          {
            params: Promise.resolve({
              id: incoming.url!.split("?")[0].split("/").at(-1)!,
            }),
          },
        );
        outgoing.writeHead(
          response.status,
          Object.fromEntries(response.headers),
        );
        outgoing.end(await response.text());
      } catch {
        outgoing.writeHead(500);
        outgoing.end("Unhandled route failure");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing local test listener");
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  beforeEach(() => {
    vi.resetAllMocks();
    game = gameFixture();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "other-team-user" } },
    });
    mocks.loadActiveTeam.mockResolvedValue({
      kind: "ready",
      team: { organizationId: "other-team", role: "owner" },
    });
    mocks.listTeamGames.mockResolvedValue({ ok: true, games: [] });
    mocks.listDeletedTeamGames.mockResolvedValue({ ok: true, games: [] });
    mocks.getGame.mockImplementation(async () => game);
    mocks.readGame.mockImplementation(async () => ({ kind: "active", game }));
    mocks.gameBroadcastSponsors.mockResolvedValue([]);
    mocks.gameLibrarySponsors.mockResolvedValue([]);
    mocks.updateGame.mockResolvedValue(game);
  });
  function anonymous() {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
  }
  async function request(view = "", token?: string, id = testGameId) {
    const response = await fetch(
      `${origin}/api/games/${id}${view ? `?view=${view}` : ""}`,
      {
        headers:
          token === undefined
            ? {}
            : {
                authorization: token.startsWith("Basic")
                  ? token
                  : `Bearer ${token}`,
              },
      },
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    return response;
  }
  async function failure(
    response: Response,
    status: number,
    error: string,
    extra = {},
  ) {
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error,
      ...(status === 410
        ? {
            lifecycle: error.includes("deleted") ? "deleted" : "closed",
          }
        : {}),
      ...extra,
    });
    expect(response.headers.has("x-curlcast-account-role")).toBe(false);
    expect(response.headers.has("x-curlcast-operator")).toBe(false);
    expect(mocks.gameLibrarySponsors).not.toHaveBeenCalled();
  }

  it.each(["", "broadcast", "join"])(
    "denies a verified cross-team caller, including view=%s",
    async (view) => {
      await failure(await request(view), 401, "Game access is required");
      expect(mocks.readGame).not.toHaveBeenCalled();
    },
  );
  it("requires access for the default game read", async () => {
    anonymous();
    await failure(await request(), 401, "Game access is required");
  });
  it("returns only the safe stored result for a completed game", async () => {
    const completion = {
      status: "completed",
      eventName: "Club final",
      homeName: "Rocks",
      awayName: "Stones",
      result: {
        outcome: "home_win",
        label: "Home win",
        totals: { home: 4, away: 2 },
        ends: [],
      },
      youtubeWatchUrl: "https://youtu.be/abcdefghijk",
      completedAt: "2026-09-05T00:00:00Z",
    };
    mocks.listTeamGames.mockResolvedValue({
      ok: true,
      games: [{ game_id: testGameId, game_status: "completed" }],
    });
    mocks.readGame.mockResolvedValue({ kind: "completed", completion });
    const accountResponse = await request();
    expect(await accountResponse.json()).toEqual(completion);
    expect(JSON.stringify(completion)).not.toMatch(
      /reviewId|completionId|claims|actor|credential/i,
    );

    anonymous();
    const publicResponse = await request("broadcast");
    expect(await publicResponse.json()).toEqual(completion);
  });
  it.each([
    ["owner", "true"],
    ["team_admin", "true"],
    ["scorer", "true"],
    ["viewer", "false"],
  ] as const)(
    "returns safe completed state and authority headers to same-team %s",
    async (role, operator) => {
      const completion = {
        status: "completed",
        eventName: "Club final",
        homeName: "Rocks",
        awayName: "Stones",
        result: { label: "Home win", totals: { home: 4, away: 2 } },
        youtubeWatchUrl: null,
        completedAt: "2026-09-05T00:00:00Z",
      };
      mocks.loadActiveTeam.mockResolvedValue({
        kind: "ready",
        team: { organizationId: "same-team", role },
      });
      mocks.listTeamGames.mockResolvedValue({
        ok: true,
        games: [{ game_id: testGameId, game_status: "completed" }],
      });
      mocks.readGame.mockResolvedValue({ kind: "completed", completion });

      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(completion);
      expect(response.headers.get("x-curlcast-account-role")).toBe(role);
      expect(response.headers.get("x-curlcast-operator")).toBe(operator);
      expect(mocks.gameLibrarySponsors).not.toHaveBeenCalled();
    },
  );
  it("does not reveal a completed result to a signed-in cross-team account", async () => {
    mocks.readGame.mockResolvedValue({
      kind: "completed",
      completion: { status: "completed" },
    });
    await failure(await request(), 401, "Game access is required");
    expect(mocks.readGame).not.toHaveBeenCalled();
  });
  it("returns exactly the public Broadcast allowlist, even with unexpected stored fields", async () => {
    anonymous();
    delete game.cameraFraming;
    Object.assign(game, {
      credentials: "private",
      organizationId: "private",
      legacy: "private",
    });
    Object.assign(game.config, { streamKey: "private" });
    Object.assign(game.sponsors[0], {
      storage_path: "private",
      token: "private",
    });
    Object.assign(game.sponsorMode, { authorization: "private" });
    const response = await request("broadcast");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: testGameId,
      config: {
        eventName: "Club final",
        homeName: "Rocks",
        awayName: "Stones",
        homeColor: "#000000",
        awayColor: "#ffffff",
      },
      score: { hammer: "away", totals: { home: 2, away: 0 }, currentEnd: 2 },
      layout: "split",
      broadcast: "live",
      audioMuted: false,
      cameraFraming: { "camera-home": "contain", "camera-away": "contain" },
      sponsors: [
        {
          id: "broadcast-sponsor-0",
          name: "Community",
          dataUrl: "/sponsors/community.svg",
          enabled: true,
          rotation: 0,
        },
      ],
      sponsorMode: {
        active: true,
        style: "overlay",
        intervalSeconds: 4,
        startedAt: 1000,
        rotationOffset: 1,
        paused: true,
      },
    });
    expect(response.headers.has("x-curlcast-operator")).toBe(false);
    expect(response.headers.has("x-curlcast-account-role")).toBe(false);
    expect(mocks.gameBroadcastSponsors).toHaveBeenCalledWith(testGameId);
    expect(mocks.gameLibrarySponsors).not.toHaveBeenCalled();
  });
  it("publishes short-lived renderable sponsor output without stored sponsor metadata", async () => {
    anonymous();
    mocks.gameBroadcastSponsors.mockResolvedValue([
      {
        id: "internal-library-id",
        name: "Club sponsor",
        altText: "Club sponsor logo",
        dataUrl:
          "https://storage.example/object/sign/logo.png?token=short-lived-signature",
        enabled: true,
        rotation: 0,
        storage_path: "private/internal/logo.png",
      },
    ]);
    const response = await request("broadcast");
    const body = await response.json();
    expect(body.sponsors).toEqual([
      {
        id: "broadcast-sponsor-0",
        name: "Club sponsor",
        altText: "Club sponsor logo",
        dataUrl:
          "https://storage.example/object/sign/logo.png?token=short-lived-signature",
        enabled: true,
        rotation: 0,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("private/internal/logo.png");
    expect(JSON.stringify(body)).not.toContain("internal-library-id");
  });
  it.each(["invalid-token", "Basic credentials"])(
    "does not downgrade invalid credentials to public Broadcast: %s",
    async (token) => {
      anonymous();
      await failure(
        await request("broadcast", token),
        401,
        "Game access is required",
      );
    },
  );
  it.each(["owner", "team_admin", "scorer"])(
    "preserves authorized %s account state and headers",
    async (role) => {
      mocks.loadActiveTeam.mockResolvedValue({
        kind: "ready",
        team: { organizationId: "same-team", role },
      });
      mocks.listTeamGames.mockResolvedValue({
        ok: true,
        games: [{ game_id: testGameId, game_status: "active" }],
      });
      for (const view of ["", "broadcast"]) {
        const response = await request(view);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(game);
        expect(response.headers.get("x-curlcast-operator")).toBe("true");
        expect(response.headers.get("x-curlcast-account-role")).toBe(role);
        expect(mocks.gameLibrarySponsors).toHaveBeenCalledWith(
          testGameId,
          "same-team",
        );
      }
    },
  );
  it("does not grant an account viewer operator access", async () => {
    mocks.loadActiveTeam.mockResolvedValue({
      kind: "ready",
      team: { organizationId: "same-team", role: "viewer" },
    });
    mocks.listTeamGames.mockResolvedValue({
      ok: true,
      games: [{ game_id: testGameId, game_status: "active" }],
    });
    await failure(await request(), 401, "Game access is required");
    expect(mocks.readGame).toHaveBeenCalledWith(testGameId);
  });
  it.each(["organizer", "participant"] as const)(
    "does not let a viewer account shadow a valid same-game %s bearer",
    async (credential) => {
      mocks.loadActiveTeam.mockResolvedValue({
        kind: "ready",
        team: { organizationId: "same-team", role: "viewer" },
      });
      mocks.listTeamGames.mockResolvedValue({
        ok: true,
        games: [{ game_id: testGameId, game_status: "active" }],
      });
      const token =
        credential === "organizer"
          ? await issueOrganizerToken(testGameId)
          : await issueParticipantToken(
              testGameId,
              "scorer",
              game.claims.scorer!,
            );

      const response = await request("", token);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(game);
      expect(response.headers.get("x-curlcast-operator")).toBe("true");
      expect(response.headers.get("x-curlcast-account-role")).toBe("");
    },
  );
  it("preserves organizer tokens and authorized sponsor hydration", async () => {
    anonymous();
    const sponsors = [{ ...game.sponsors[1], enabled: true }];
    mocks.gameLibrarySponsors.mockResolvedValue(sponsors);
    const response = await request("", await issueOrganizerToken(testGameId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...game, sponsors });
    expect(mocks.gameLibrarySponsors).toHaveBeenCalledWith(
      testGameId,
      undefined,
    );
  });
  it.each(["camera-home", "camera-away", "scorer"] as const)(
    "preserves the current %s participant",
    async (role) => {
      anonymous();
      const response = await request(
        "",
        await issueParticipantToken(testGameId, role, game.claims[role]!),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(game);
    },
  );
  it.each(["", "broadcast"])(
    "rejects a released participant for view=%s",
    async (view) => {
      anonymous();
      await failure(
        await request(
          view,
          await issueParticipantToken(
            testGameId,
            "camera-home",
            "released-device",
          ),
        ),
        401,
        "This camera assignment has been released",
        { code: "camera_assignment_released" },
      );
    },
  );
  it("rechecks release against the final state snapshot", async () => {
    anonymous();
    mocks.readGame.mockResolvedValue({
      kind: "active",
      game: { ...game, claims: {} },
    });
    await failure(
      await request(
        "",
        await issueParticipantToken(
          testGameId,
          "camera-home",
          game.claims["camera-home"]!,
        ),
      ),
      401,
      "This camera assignment has been released",
      { code: "camera_assignment_released" },
    );
  });
  it("denies a token for a different game", async () => {
    anonymous();
    await failure(
      await request("broadcast", await issueOrganizerToken("other-game")),
      401,
      "Game access is required",
    );
  });
  it("limits invitations to a chooser projection with booleans instead of device identifiers", async () => {
    anonymous();
    const token = await issueChooserToken(testGameId);
    await failure(await request("", token), 401, "Game access is required");
    await failure(
      await request("broadcast", token),
      401,
      "Game access is required",
    );
    const response = await request("join", token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      config: { eventName: "Club final" },
      claimedRoles: { "camera-home": true, "camera-away": true, scorer: true },
    });
    expect(mocks.gameLibrarySponsors).not.toHaveBeenCalled();
  });
  it.each([
    ["not-found", 404, "Game not found"],
    ["deleted", 410, "This game has been deleted and is unavailable."],
    ["closed", 410, "This game is closed"],
  ] as const)("rejects %s Broadcast state", async (kind, status, error) => {
    anonymous();
    mocks.readGame.mockResolvedValue({ kind });
    await failure(await request("broadcast"), status, error);
  });
  it("rejects deleted account games at the authorization boundary", async () => {
    mocks.listDeletedTeamGames.mockResolvedValue({
      ok: true,
      games: [{ game_id: testGameId }],
    });
    await failure(
      await request(),
      410,
      "This game has been deleted and is unavailable.",
    );
    expect(mocks.readGame).not.toHaveBeenCalled();
  });
  it("rejects a deleted organizer game even when retained state is active", async () => {
    anonymous();
    mocks.readGame.mockResolvedValue({ kind: "deleted" });
    await failure(
      await request("", await issueOrganizerToken(testGameId)),
      410,
      "This game has been deleted and is unavailable.",
    );
  });
  it("rejects closed participant games", async () => {
    anonymous();
    game.status = "closed";
    await failure(
      await request(
        "",
        await issueParticipantToken(testGameId, "scorer", game.claims.scorer!),
      ),
      410,
      "This game is closed",
    );
  });
  it("reports a verified account's missing game", async () => {
    mocks.getGame.mockResolvedValue(undefined);
    await failure(await request(), 404, "Game not found");
  });
  it.each(["account", "state", "token-state", "auth"])(
    "reports %s service failure without leaking provider errors",
    async (boundary) => {
      if (boundary === "account")
        mocks.listTeamGames.mockResolvedValue({ ok: false });
      else anonymous();
      if (boundary === "auth")
        mocks.getUser.mockRejectedValue(
          new Error("private service configuration"),
        );
      if (boundary === "state")
        mocks.readGame.mockRejectedValue(new Error("private storage path"));
      if (boundary === "token-state")
        mocks.getGame.mockRejectedValue(new Error("private credential"));
      const token =
        boundary === "token-state"
          ? await issueOrganizerToken(testGameId)
          : undefined;
      await failure(
        await request("broadcast", token),
        503,
        "Game service is temporarily unavailable",
      );
    },
  );
  it("keeps independent organizer access when account cookies cannot be read", async () => {
    mocks.getUser.mockRejectedValue(new Error("Account unavailable"));
    const response = await request("", await issueOrganizerToken(testGameId));
    expect(response.status).toBe(200);
  });
  it("reports sponsor service failure for an authorized read", async () => {
    anonymous();
    mocks.gameLibrarySponsors.mockRejectedValue(
      new Error("private provider details"),
    );
    const response = await request("", await issueOrganizerToken(testGameId));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Sponsor library is temporarily unavailable",
    });
  });
  it("validates the view and route id before provider access", async () => {
    expect((await request("unknown")).status).toBe(400);
    expect((await request("broadcast", undefined, "invalid$id")).status).toBe(
      400,
    );
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.readGame).not.toHaveBeenCalled();
  });
  it("keeps PATCH authorization denials non-cacheable", async () => {
    const response = await PATCH(
      new Request(`${origin}/api/games/${testGameId}`, { method: "PATCH" }),
      { params: Promise.resolve({ id: testGameId }) },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 409 when an ordinary state write loses its version race", async () => {
    anonymous();
    mocks.updateGame.mockRejectedValue(new GameStateConflictError());
    const response = await PATCH(
      new Request(`${origin}/api/games/${testGameId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${await issueOrganizerToken(testGameId)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "layout", layout: "home" }),
      }),
      { params: Promise.resolve({ id: testGameId }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "The game changed before this update was saved. Try again.",
    });
  });

  it("binds participant camera updates to the verified device claim", async () => {
    anonymous();
    const claimant = game.claims["camera-home"]!;
    const response = await PATCH(
      new Request(`${origin}/api/games/${testGameId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${await issueParticipantToken(
            testGameId,
            "camera-home",
            claimant,
          )}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "camera-health",
          role: "camera-home",
          phase: "live",
        }),
      }),
      { params: Promise.resolve({ id: testGameId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateGame).toHaveBeenCalledWith(
      testGameId,
      { type: "camera-health", role: "camera-home", phase: "live" },
      {
        role: "camera-home",
        claim: claimant,
        generation: undefined,
      },
    );
  });

  it("binds scorer writes to the trusted token role and generation", async () => {
    anonymous();
    const claimant = game.claims.scorer!;
    game.claimGenerations = { scorer: 5 };
    const response = await PATCH(
      new Request(`${origin}/api/games/${testGameId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${await issueParticipantToken(
            testGameId,
            "scorer",
            claimant,
            5,
          )}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "score",
          intentId: "10000000-0000-4000-8000-000000000012",
          expectedEnd: 1,
          expectedLastEventId: null,
          team: "home",
          points: 1,
          blank: false,
        }),
      }),
      { params: Promise.resolve({ id: testGameId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateGame).toHaveBeenCalledWith(
      testGameId,
      {
        type: "score",
        intentId: "10000000-0000-4000-8000-000000000012",
        expectedEnd: 1,
        expectedLastEventId: null,
        team: "home",
        points: 1,
        blank: false,
      },
      { role: "scorer", claim: claimant, generation: 5 },
    );
  });

  it.each([
    ["blank points", { team: null, points: 2, blank: true }],
    ["blank team", { team: "home", points: 0, blank: true }],
    ["score without points", { team: "home", points: 0, blank: false }],
    ["score without a team", { team: null, points: 1, blank: false }],
  ])("rejects contradictory scoring payloads: %s", async (_name, score) => {
    anonymous();
    const claimant = game.claims.scorer!;
    const response = await PATCH(
      new Request(`${origin}/api/games/${testGameId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${await issueParticipantToken(
            testGameId,
            "scorer",
            claimant,
          )}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "score",
          intentId: "10000000-0000-4000-8000-000000000018",
          expectedEnd: 1,
          expectedLastEventId: null,
          ...score,
        }),
      }),
      { params: Promise.resolve({ id: testGameId }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid update" });
    expect(mocks.updateGame).not.toHaveBeenCalled();
  });
});
