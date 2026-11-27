import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gameFixture } from "@/test/game-fixture";

const mocks = vi.hoisted(() => ({
  hierarchy: vi.fn(),
  result: vi.fn(),
  navigation: vi.fn(),
  user: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/AppNavigation", () => ({
  AppNavigation: mocks.navigation,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock("@/lib/team-hierarchy-data", () => ({
  loadTeamHierarchyData: mocks.hierarchy,
}));
vi.mock("@/lib/team-hierarchy-service", () => ({
  listOpponents: async () => ({ ok: true, value: [] }),
}));
vi.mock("@/lib/providers/completed-result", () => ({
  readCompletedResult: mocks.result,
}));
vi.mock("../../new/GameCreationForm", () => ({
  GameCreationForm: () => <p>Schedule details editor</p>,
}));
vi.mock("@/components/CompletedResultEditor", () => ({
  CompletedResultEditor: ({ gameId }: { gameId: string }) => (
    <p>Final result editor: {gameId}</p>
  ),
}));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

import EditGamePage from "./page";

const game = {
  id: "one",
  config: gameFixture().config,
  status: "completed",
  seasonId: "season",
  eventId: null,
  opponentId: "opponent",
  scheduledStart: null,
  gameNumber: null,
};
function hierarchy(
  role: string,
  status = "completed",
  seasonId: string | null = "season",
) {
  return {
    ok: true,
    role,
    teamName: "Club",
    seasons: [],
    events: [],
    games: [{ ...game, status, seasonId }],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.navigation.mockReturnValue(null);
  mocks.user.mockResolvedValue({
    data: { user: { email_confirmed_at: "2026-01-01" } },
  });
  mocks.hierarchy.mockResolvedValue(hierarchy("owner"));
  mocks.result.mockResolvedValue({
    ok: true,
    value: {
      revision: 0,
      completion: {
        status: "completed",
        eventName: "Club",
        homeName: "Home",
        awayName: "Away",
        completedAt: "2026-10-05",
        youtubeWatchUrl: null,
        result: {
          outcome: "no_result",
          label: "No result recorded",
          totals: null,
          ends: [],
        },
      },
    },
  });
});

describe("completed game edit page", () => {
  it.each(["owner", "team_admin"])(
    "permits %s to edit only the completed result and disables active game navigation",
    async (role) => {
      mocks.hierarchy.mockResolvedValue(hierarchy(role));
      const html = renderToStaticMarkup(
        await EditGamePage({ params: Promise.resolve({ id: "one" }) }),
      );
      expect(html).toContain("Final result editor: one");
      expect(html).not.toContain("Schedule details editor");
      expect(
        mocks.navigation.mock.calls[0][0].gameContext.capabilities,
      ).toMatchObject({
        control: false,
        scoring: false,
        broadcast: false,
        assignOpponent: false,
      });
      expect(mocks.result).toHaveBeenCalledWith("one");
    },
  );

  it.each(["viewer", "scorer", "game_operator"])(
    "denies %s completed-result editing before its private snapshot is read",
    async (role) => {
      mocks.hierarchy.mockResolvedValue(hierarchy(role));
      await expect(
        EditGamePage({ params: Promise.resolve({ id: "one" }) }),
      ).rejects.toThrow("redirect:/dashboard");
      expect(mocks.result).not.toHaveBeenCalled();
    },
  );

  it("allows an owner to correct a legacy completed game without a season", async () => {
    mocks.hierarchy.mockResolvedValue(hierarchy("owner", "completed", null));
    expect(
      renderToStaticMarkup(
        await EditGamePage({ params: Promise.resolve({ id: "one" }) }),
      ),
    ).toContain("Final result editor: one");
  });

  it("retains the details editor for an active game without calling the completion API", async () => {
    mocks.hierarchy.mockResolvedValue(hierarchy("owner", "active"));
    const html = renderToStaticMarkup(
      await EditGamePage({ params: Promise.resolve({ id: "one" }) }),
    );
    expect(html).toContain("Schedule details editor");
    expect(html).not.toContain("Final result editor");
    expect(mocks.result).not.toHaveBeenCalled();
  });

  it("fails closed if the authoritative result denies the account", async () => {
    mocks.result.mockResolvedValue({ ok: false, kind: "authorization" });
    await expect(
      EditGamePage({ params: Promise.resolve({ id: "one" }) }),
    ).rejects.toThrow("redirect:/dashboard");
  });
});
