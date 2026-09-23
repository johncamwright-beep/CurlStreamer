import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  hierarchy: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(path);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "new-user", email_confirmed_at: "now" } },
      }),
    },
  }),
}));
vi.mock("@/lib/auth/account", () => ({
  getAccountContext: async () => ({
    ok: true,
    account: { profile: { status: "active" }, membership: null },
  }),
}));
vi.mock("@/lib/team-hierarchy-data", () => ({
  loadTeamHierarchyData: mocks.hierarchy,
}));
vi.mock("@/lib/dashboard-broadcasts", () => ({
  loadDashboardBroadcasts: vi.fn(),
}));
vi.mock("./GamesDashboard", () => ({ GamesDashboard: () => null }));
import GamesPage from "./page";
it("sends a first login to setup before querying a nonexistent team's games", async () => {
  await expect(
    GamesPage({ searchParams: Promise.resolve({}) }),
  ).rejects.toThrow("/onboarding");
  expect(mocks.hierarchy).not.toHaveBeenCalled();
});
