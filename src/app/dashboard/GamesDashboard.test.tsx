import React from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only", () => ({}));
vi.mock("@/components/AppNavigation", () => ({ AppNavigation: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
import { GamesDashboard } from "./GamesDashboard";
import { gameFixture } from "@/test/game-fixture";
import type { AccountContext } from "@/lib/auth/account";
import type { ScheduledGameRecord } from "@/lib/team-hierarchy-data";
import type { DashboardBroadcast } from "@/lib/dashboard-broadcasts";
const game: ScheduledGameRecord = {
  id: "one",
  config: gameFixture().config,
  status: "active",
  seasonId: "season",
  eventId: null,
  opponentId: "opp",
  scheduledStart: "2099-01-01T00:00:00Z",
  timezone: "UTC",
  gameNumber: null,
  gameLabel: null,
  createdAt: "2026-09-01T00:00:00Z",
};
function render(
  role: NonNullable<AccountContext["membership"]>["role"],
  games: ScheduledGameRecord[] = [game],
  sessions: DashboardBroadcast[] = [],
) {
  return renderToStaticMarkup(
    <GamesDashboard
      account={{
        profile: { display_name: "User", status: "active" },
        membership: { role, organization_id: "org", teamName: "Club" },
      }}
      games={games}
      events={[]}
      seasons={[]}
      tab={
        games.some((g) => g.status === "completed" || g.status === "closed")
          ? "past"
          : "upcoming"
      }
      broadcasts={{ available: false, sessions }}
    />,
  );
}
describe("dashboard role controls", () => {
  it.each(["owner", "team_admin"] as const)(
    "offers completed Edit game to %s beside its inline result",
    (role) => {
      const html = render(role, [{ ...game, status: "completed" }]);
      expect(html).toContain('href="/games/one/edit"');
      expect(html).toContain("Edit game");
      expect(html).not.toContain("View result");
    },
  );
  it.each(["viewer", "scorer", "game_operator"] as const)(
    "hides completed result editing from %s",
    (role) => {
      expect(render(role, [{ ...game, status: "completed" }])).not.toContain(
        'href="/games/one/edit"',
      );
    },
  );
  it("shows the completed score in the row with team links to details and no View result button", () => {
    const html = render("viewer", [
      {
        ...game,
        status: "completed",
        completionResult: {
          outcome: "home_win",
          label: "Home won",
          totals: { home: 8, away: 6 },
          ends: [],
        },
      },
    ]);
    expect(html).toContain("final score: 8");
    expect(html).toContain("final score: 6");
    expect(html).toContain('href="/games/one"');
    expect(html).not.toContain("View result");
  });
  it.each(["shared", "completion", "scheduled", "broadcast"] as const)(
    "offers a replay for a completed game with a saved %s watch URL",
    (source) => {
      const url = "https://www.youtube.com/watch?v=abcdefghijk";
      const completed = {
        ...game,
        status: "completed",
        config: {
          ...game.config,
          sharedYoutubeWatchUrl: source === "shared" ? url : null,
        },
        youtubeWatchUrl: source === "completion" ? url : null,
        scheduledYouTubeWatchUrl: source === "scheduled" ? url : null,
        scheduledYouTubeStatus: "none" as const,
      };
      const sessions: DashboardBroadcast[] =
        source === "broadcast"
          ? [
              {
                gameId: game.id,
                status: "stopped",
                watchUrl: url,
                updatedAt: null,
              },
            ]
          : [];
      const html = render("viewer", [completed], sessions);
      expect(html).toContain(`href="${url}"`);
      expect(html).toContain("Watch replay");
      expect(html).not.toContain("Watch on YouTube");
    },
  );
  it("falls through invalid saved fields and never shows an unsafe replay link", () => {
    const completed = {
      ...game,
      status: "completed",
      config: { ...game.config, sharedYoutubeWatchUrl: "javascript:alert(1)" },
      youtubeWatchUrl: "https://example.com/watch?v=abcdefghijk",
      scheduledYouTubeWatchUrl: "https://youtu.be/abcdefghijk",
    };
    const html = render("viewer", [completed]);
    expect(html).toContain('href="https://youtu.be/abcdefghijk"');
    expect(html).toContain("Watch replay");
    expect(html).not.toContain("javascript:");
    expect(
      render("viewer", [{ ...completed, scheduledYouTubeWatchUrl: null }]),
    ).not.toContain("Watch replay");
  });
  it("retains the live/readiness gate for unfinished games and hides closed game links", () => {
    const url = "https://youtu.be/abcdefghijk";
    const active = {
      ...game,
      config: { ...game.config, sharedYoutubeWatchUrl: url },
    };
    const saved: DashboardBroadcast = {
      gameId: game.id,
      status: "stopped",
      watchUrl: url,
      updatedAt: null,
    };
    expect(render("viewer", [active], [saved])).not.toContain(
      'href="' + url + '"',
    );
    const live = render("viewer", [active], [{ ...saved, status: "live" }]);
    expect(live).toContain("Watch on YouTube");
    expect(live).not.toContain("Watch replay");
    expect(
      render(
        "viewer",
        [{ ...active, status: "closed" }],
        [{ ...saved, status: "live" }],
      ),
    ).not.toContain('href="' + url + '"');
  });
  it("keeps viewer access read-only while status failure leaves games readable", () => {
    const html = render("viewer");
    expect(html).toContain('href="/games/one"');
    expect(html).not.toContain("Broadcast status is temporarily unavailable");
    expect(html).not.toContain('href="/score/one"');
    expect(html).not.toContain('href="/games/new"');
    expect(html).not.toContain("More actions");
    expect(html).not.toContain('href="/dashboard/trash"');
  });
  it("gives scorers scoring access and reserves administrative actions for admins", () => {
    const scorer = render("scorer");
    expect(scorer).toContain('href="/score/one"');
    expect(scorer).not.toContain("Season overview");
    expect(scorer).not.toContain("Scoring:");
    expect(scorer).not.toContain("More actions");
    const admin = render("team_admin");
    expect(admin).toContain("More actions");
    expect(admin).toContain("Edit opponent");
    expect(admin).toContain('href="/dashboard/trash"');
  });
  it("only offers opponent editing for a known opponent with a game season", () => {
    expect(render("owner", [{ ...game, opponentId: null }])).not.toContain(
      "Edit opponent",
    );
    expect(render("owner", [{ ...game, seasonId: null }])).not.toContain(
      "Edit opponent",
    );
    expect(render("scorer")).not.toContain("Edit opponent");
  });
  it("falls back to an existing scheduled watch link when the shared field is empty", () => {
    const html = render("owner", [
      {
        ...game,
        config: { ...game.config, sharedYoutubeWatchUrl: "" },
        scheduledYouTubeWatchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        scheduledYouTubeStatus: "ready",
      },
    ]);
    expect(html).toContain(
      'href="https://www.youtube.com/watch?v=abcdefghijk"',
    );
  });
});
