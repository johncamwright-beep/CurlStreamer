import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth/account";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";
import type { GamesTab } from "@/lib/game-hub";
import { loadDashboardBroadcasts } from "@/lib/dashboard-broadcasts";
import { GamesDashboard } from "./GamesDashboard";
import "./dashboard.css";
import Link from "next/link";
import { readSetupProgress } from "@/lib/onboarding";

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; season?: string; event?: string }>;
}) {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const result = await getAccountContext(user);
  if (!result.ok) return <AccountServiceUnavailable />;
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
  const hierarchy = await loadTeamHierarchyData(user);
  if (!hierarchy.ok) return <AccountServiceUnavailable />;
  const {
    tab: requestedTab,
    season: requestedSeason,
    event: requestedEvent,
  } = await searchParams;
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
    <>
      {membership.role === "owner" &&
        (() => {
          const setup = readSetupProgress(
            user.user_metadata?.team_setup,
            membership.organization_id,
          );
          return setup && !setup.complete ? (
            <aside
              className="mx-auto mt-4 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-600 bg-cyan-950 p-4"
              aria-label="Team setup"
            >
              <p>Finish setting up your team · Step {setup.step} of 6</p>
              <Link className="btn" href="/onboarding">
                Resume team setup
              </Link>
            </aside>
          ) : null;
        })()}
      <GamesDashboard
        account={result.account}
        games={games}
        events={events}
        seasons={hierarchy.seasons}
        season={season}
        tab={tab}
        selectedEvent={requestedEvent}
        broadcasts={broadcasts}
      />
    </>
  );
}
