import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth/account";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";
import type { GamesTab } from "@/lib/game-hub";
import { loadDashboardBroadcasts } from "@/lib/dashboard-broadcasts";
import { GamesDashboard } from "./GamesDashboard";
import "./dashboard.css";

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; season?: string }>;
}) {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const [result, hierarchy] = await Promise.all([
    getAccountContext(user),
    loadTeamHierarchyData(user),
  ]);
  if (!result.ok) return <AccountServiceUnavailable />;
  if (!hierarchy.ok) return <AccountServiceUnavailable />;
  if (result.account.profile.status !== "active")
    return (
      <main className="mx-auto max-w-xl p-5">
        <section className="panel" role="alert">
          <h1 className="text-3xl font-black">Account access denied</h1>
          <p>This account is not currently active.</p>
        </section>
      </main>
    );
  const membership = result.account.membership;
  if (!membership) redirect("/onboarding");
  const { tab: requestedTab, season: requestedSeason } = await searchParams;
  const season =
    hierarchy.seasons.find((s) => s.id === requestedSeason) ??
    hierarchy.seasons.find((s) => s.status === "active") ??
    hierarchy.seasons[0];
  const games = hierarchy.games.filter((g) => g.seasonId === season?.id);
  const events = hierarchy.events.filter((e) => e.seasonId === season?.id);
  const tab: GamesTab = ["events", "single", "past", "unfinished"].includes(
    requestedTab ?? "",
  )
    ? (requestedTab as GamesTab)
    : "upcoming";
  const broadcasts = await loadDashboardBroadcasts(
    result.account,
    games
      .filter((g) => g.status !== "completed" && g.status !== "closed")
      .map((g) => g.id),
  );
  return (
    <GamesDashboard
      account={result.account}
      games={games}
      events={events}
      seasons={hierarchy.seasons}
      season={season}
      tab={tab}
      broadcasts={broadcasts}
    />
  );
}
