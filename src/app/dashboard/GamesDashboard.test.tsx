import React from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only", () => ({}));
vi.mock("@/components/AppNavigation", () => ({ AppNavigation: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
import { GamesDashboard } from "./GamesDashboard";
import { gameFixture } from "@/test/game-fixture";
import type { AccountContext } from "@/lib/auth/account";
import type { ScheduledGameRecord } from "@/lib/team-hierarchy-data";
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
function render(role: NonNullable<AccountContext["membership"]>["role"]) {
  return renderToStaticMarkup(
    <GamesDashboard
      account={{
        profile: { display_name: "User", status: "active" },
        membership: { role, organization_id: "org", teamName: "Club" },
      }}
      games={[game]}
      events={[]}
      seasons={[]}
      tab="upcoming"
      broadcasts={{ available: false, sessions: [] }}
    />,
  );
}
describe("dashboard role controls", () => {
  it("keeps viewer access read-only while status failure leaves games readable", () => {
    const html = render("viewer");
    expect(html).toContain('href="/games/one"');
    expect(html).toContain("Broadcast status is temporarily unavailable");
    expect(html).not.toContain('href="/score/one"');
    expect(html).not.toContain('href="/games/new"');
    expect(html).not.toContain("More actions");
    expect(html).not.toContain('href="/dashboard/trash"');
  });
  it("gives scorers scoring access and reserves administrative actions for admins", () => {
    const scorer = render("scorer");
    expect(scorer).toContain('href="/score/one"');
    expect(scorer).not.toContain("More actions");
    const admin = render("team_admin");
    expect(admin).toContain("More actions");
    expect(admin).toContain('href="/dashboard/trash"');
  });
});
