import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  requireStudioConfiguration: vi.fn(),
  studioAction: vi.fn(),
  issueStudioTicket: vi.fn(),
  broadcastStudioSignal: vi.fn(),
  prepareProgramScope: vi.fn(),
  createProgramGrant: vi.fn(),
  exchangeProgramGrant: vi.fn(),
  readProgramScope: vi.fn(),
  checkProgramScope: vi.fn(),
  checkAvailableProgramScope: vi.fn(),
  readGame: vi.fn(),
  gameBroadcastSponsors: vi.fn(),
  broadcastGame: vi.fn(),
}));
vi.mock("@/lib/game-authorization", () => ({
  ...mocks,
  authorizationError: () => ({ error: "Denied", status: 401 }),
}));
vi.mock("@/lib/providers/m2-studio-session", () => ({
  ...mocks,
  StudioRejected: class extends Error {},
}));
vi.mock("@/lib/providers/m3-program-session", () => ({
  ...mocks,
  programCookieName: "curlcast_m3_program",
  programCookieSeconds: 14400,
}));
vi.mock("@/lib/providers/game-read", () => mocks);
vi.mock("@/lib/providers/sponsor-library", () => mocks);
vi.mock("@/lib/game-projection", () => mocks);
import { POST, GET } from "./route";
import { StudioRejected } from "@/lib/providers/m2-studio-session";
import { gameFixture } from "@/test/game-fixture";
const id = "00000000-0000-4000-8000-000000000001",
  home = "00000000-0000-4000-8000-000000000002",
  away = "00000000-0000-4000-8000-000000000003";
const scope = {
  gameId: id,
  organizationId: id,
  sessions: { "camera-home": home, "camera-away": away },
};
const params = { params: Promise.resolve({ id }) };
function call(body: unknown, headers?: HeadersInit) {
  return POST(
    new Request(`https://test/api/games/${id}/studio-m3`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    params,
  );
}
describe("M3 restricted program route", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    mocks.readProgramScope.mockResolvedValue(scope);
    mocks.studioAction.mockResolvedValue({});
  });
  it("uses the configured HTTPS origin through an HTTP loopback proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://pilot.example");
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "account",
      organizationId: id,
    });
    mocks.prepareProgramScope.mockResolvedValue({ scope, sessions: {} });
    mocks.createProgramGrant.mockReturnValue("a".repeat(43));
    mocks.exchangeProgramGrant.mockResolvedValue("restricted");
    const proxied = (body: unknown, origin = "https://pilot.example") =>
      POST(
        new Request(`http://127.0.0.1:3000/api/games/${id}/studio-m3`, {
          method: "POST",
          headers: {
            origin,
            "x-forwarded-host": "attacker.example",
            "x-forwarded-proto": "http",
          },
          body: JSON.stringify(body),
        }),
        params,
      );
    const prepared = await proxied({ action: "prepare" });
    expect(prepared.status).toBe(200);
    expect((await prepared.json()).sourceUrl).toBe(
      `https://pilot.example/studio-m3/${id}/program#code=${"a".repeat(43)}`,
    );
    const exchanged = await proxied({
      action: "exchange",
      code: "a".repeat(43),
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("set-cookie")).toContain("Secure");
    expect(
      (
        await proxied(
          { action: "check", cameraRole: "camera-home" },
          "https://attacker.example",
        )
      ).status,
    ).toBe(400);
    vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:3000");
    expect((await proxied({ action: "prepare" })).status).toBe(503);
  });
  it("never lets program cookie register or create invitations", async () => {
    expect(
      (await call({ action: "register", cameraRole: "camera-home" })).status,
    ).toBe(400);
    expect((await call({ action: "prepare" })).status).toBe(503);
    expect(mocks.prepareProgramScope).not.toHaveBeenCalled();
    mocks.authorizeGame.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
    });
    expect((await call({ action: "prepare" })).status).toBe(401);
    expect(mocks.prepareProgramScope).not.toHaveBeenCalled();
  });
  it("uses fixed receiver session and org; refuses cross-slot session override", async () => {
    expect(
      (
        await call({
          action: "check",
          cameraRole: "camera-home",
          sessionId: away,
        })
      ).status,
    ).toBe(409);
    expect(mocks.studioAction).not.toHaveBeenCalled();
    expect(
      (await call({ action: "check", cameraRole: "camera-home" })).status,
    ).toBe(200);
    expect(mocks.studioAction).toHaveBeenCalledWith(
      id,
      {
        action: "check",
        cameraRole: "camera-home",
        side: "receiver",
        sessionId: home,
      },
      { organizationId: id },
    );
    expect(
      (
        await call({
          action: "check",
          cameraRole: "camera-home",
          side: "camera",
        })
      ).status,
    ).toBe(400);
  });
  it("rejects cross-origin mutations and malformed receiver signals", async () => {
    expect(
      (
        await call(
          { action: "check", cameraRole: "camera-home" },
          { origin: "https://other" },
        )
      ).status,
    ).toBe(400);
    expect(
      (await call({ action: "signal", cameraRole: "camera-home" })).status,
    ).toBe(400);
    expect(mocks.studioAction).not.toHaveBeenCalled();
  });
  it("exchanges into a scoped secure HttpOnly cookie", async () => {
    mocks.exchangeProgramGrant.mockResolvedValue("restricted");
    const result = await call({ action: "exchange", code: "a".repeat(43) });
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain(`Path=/api/games/${id}/studio-m3`);
    expect(cookie).toContain("Max-Age=14400");
    expect(await result.json()).toEqual({ ok: true });
  });
  it("refuses terminal state without returning a projection", async () => {
    mocks.readGame.mockResolvedValue({ kind: "completed" });
    expect((await GET(new Request("https://test"), params)).status).toBe(409);
    expect(mocks.broadcastGame).not.toHaveBeenCalled();
    mocks.studioAction.mockRejectedValue(new StudioRejected());
    expect(
      (await call({ action: "ticket", cameraRole: "camera-away" })).status,
    ).toBe(409);
    expect(mocks.issueStudioTicket).not.toHaveBeenCalled();
  });
  it("renders only bundled fallback after a successful empty library lookup", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/game-projection")
    >("@/lib/game-projection");
    mocks.broadcastGame.mockImplementation(actual.broadcastGame);
    const sponsor = (dataUrl: string, enabled = true) => ({
      id: dataUrl,
      name: "Demo",
      dataUrl,
      enabled,
      rotation: 0,
    });
    mocks.readGame.mockResolvedValue({
      kind: "active",
      game: {
        id,
        config: { scheduledEnds: 8 },
        scoreEvents: [],
        layout: "split",
        broadcast: "idle",
        audioMuted: false,
        sponsorMode: {
          active: true,
          style: "overlay",
          intervalSeconds: 4,
          startedAt: 0,
          rotationOffset: 0,
          paused: false,
        },
        sponsors: [
          sponsor("/sponsors/community.svg"),
          sponsor("/sponsors/rock.svg"),
          sponsor("/sponsors/community.svg", false),
          sponsor("private/archived-upload.png"),
          sponsor("https://old.example/signed-archived.png"),
          sponsor("data:image/png;base64,AAAA"),
        ],
      },
    });
    mocks.gameBroadcastSponsors.mockResolvedValue([]);
    const result = await GET(new Request("https://test"), params);
    expect(result.status).toBe(200);
    const projected = (await result.json()).game;
    expect(
      projected.sponsors.map((item: { dataUrl: string }) => item.dataUrl),
    ).toEqual(["/sponsors/community.svg", "/sponsors/rock.svg"]);
    expect(projected.sponsorMode).toMatchObject({
      active: true,
      style: "overlay",
    });
    mocks.gameBroadcastSponsors.mockResolvedValue([
      sponsor("https://verified.example/current.png"),
    ]);
    const library = await GET(new Request("https://test"), params);
    expect(
      (await library.json()).game.sponsors.map(
        (item: { dataUrl: string }) => item.dataUrl,
      ),
    ).toEqual(["https://verified.example/current.png"]);
    mocks.broadcastGame.mockClear();
    mocks.gameBroadcastSponsors.mockRejectedValue(
      new Error("Lookup unavailable"),
    );
    expect((await GET(new Request("https://test"), params)).status).toBe(503);
    expect(mocks.broadcastGame).not.toHaveBeenCalled();
  });
  it("retains a matching library UUID only in the private program projection", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/game-projection")
    >("@/lib/game-projection");
    mocks.broadcastGame.mockImplementation(actual.broadcastGame);
    const sponsorId = "11111111-1111-4111-8111-111111111111";
    const dataUrl = `https://example-pilot-project.supabase.co/storage/v1/object/sign/organization-sponsors/${id}/${sponsorId}.webp?token=renderable`;
    const sponsor = {
      id: sponsorId,
      name: "Uploaded rock",
      altText: "Rock logo",
      dataUrl,
      enabled: true,
      rotation: 0,
    };
    const activeGame = gameFixture();
    activeGame.id = id;
    activeGame.sponsors = [];
    mocks.readGame.mockResolvedValue({
      kind: "active",
      game: activeGame,
    });
    mocks.gameBroadcastSponsors.mockResolvedValue([sponsor]);

    const response = await GET(new Request("https://test"), params);
    const programSponsor = (await response.json()).game.sponsors[0];
    expect(programSponsor).toMatchObject({ id: sponsorId, dataUrl });
    expect(actual.broadcastGame(activeGame, [sponsor]).sponsors[0].id).toBe(
      "broadcast-sponsor-0",
    );
  });
});
