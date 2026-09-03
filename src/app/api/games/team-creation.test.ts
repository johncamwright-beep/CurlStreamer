import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createLegacy: vi.fn(),
  createTeam: vi.fn(),
  issueToken: vi.fn().mockResolvedValue("organizer-token"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/store", () => ({ createGame: mocks.createLegacy }));
vi.mock("@/lib/team-games", () => ({
  createAuthenticatedTeamGame: mocks.createTeam,
}));
vi.mock("@/lib/tokens", () => ({ issueOrganizerToken: mocks.issueToken }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
import { POST } from "./route";

const config = {
  eventName: "Club Night",
  homeName: "Granite",
  awayName: "Glaciers",
  homeColor: "#ef4444",
  awayColor: "#2563eb",
  scheduledEnds: 8,
  youtubeTitle: "Club Night Live",
  youtubeVisibility: "unlisted",
};
const request = (extra = {}) =>
  new Request("http://localhost/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...config, ...extra }),
  });

describe("POST /api/games team ownership", () => {
  beforeEach(() => vi.clearAllMocks());
  it("preserves anonymous legacy creation and organizer token", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.createLegacy.mockResolvedValue({ id: "legacy-game", config });
    const response = await POST(request());
    expect(mocks.createLegacy).toHaveBeenCalledWith(config);
    expect(await response.json()).toMatchObject({
      id: "legacy-game",
      organizerToken: "organizer-token",
    });
  });
  it.each(["owner", "team_admin", "scorer"])(
    "creates for a signed-in %s",
    async (role) => {
      const user = { id: "server-user", email_confirmed_at: "now" };
      mocks.getUser.mockResolvedValue({ data: { user }, error: null });
      mocks.createTeam.mockResolvedValue({
        kind: "created",
        game: { id: `${role}-game`, config },
      });
      const response = await POST(request({ userId: "browser-attacker" }));
      expect(mocks.createTeam).toHaveBeenCalledWith(user, config);
      expect(mocks.createLegacy).not.toHaveBeenCalled();
      expect((await response.json()).organizerToken).toBe("organizer-token");
    },
  );
  it("does not trust a failed server identity verification", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid session" },
    });
    expect((await POST(request({ userId: "browser-attacker" }))).status).toBe(
      401,
    );
    expect(mocks.createTeam).not.toHaveBeenCalled();
    expect(mocks.createLegacy).not.toHaveBeenCalled();
  });
  it.each([
    ["forbidden", 403],
    ["inactive", 403],
    ["no-team", 409],
    ["multiple-teams", 409],
  ])("rejects %s without legacy fallback", async (kind, status) => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified", email_confirmed_at: "now" } },
      error: null,
    });
    mocks.createTeam.mockResolvedValue({ kind });
    expect((await POST(request())).status).toBe(status);
    expect(mocks.createLegacy).not.toHaveBeenCalled();
  });
});
