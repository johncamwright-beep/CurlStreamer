import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { AppNavigation } from "@/components/AppNavigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";
import { listOpponents } from "@/lib/team-hierarchy-service";
import { loadActiveTeam } from "@/lib/team-games";
import { GameCreationForm } from "./GameCreationForm";

export default async function NewGamePage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login?next=%2Fgames%2Fnew");
  const team = await loadActiveTeam(user);
  if (team.kind === "no-team") redirect("/onboarding");
  if (team.kind === "inactive")
    return <Denied>This account is not currently active.</Denied>;
  if (team.kind === "multiple-teams")
    return <Denied>Choose an active team before scheduling a game.</Denied>;
  if (team.kind === "unavailable") return <AccountServiceUnavailable />;
  const [data, opponents] = await Promise.all([
    loadTeamHierarchyData(user),
    listOpponents(user),
  ]);
  if (!data.ok || !opponents.ok) return <AccountServiceUnavailable />;
  if (data.role === "viewer")
    return <Denied>Viewers cannot schedule games for this team.</Denied>;
  const selected = (await searchParams).eventId;
  const preselected =
    selected &&
    data.events.some((event) => event.id === selected && !event.archivedAt)
      ? selected
      : undefined;
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <GameCreationForm
        teamName={data.teamName}
        seasons={data.seasons}
        events={data.events}
        opponents={opponents.value as never[]}
        games={data.games}
        preselectedEventId={preselected}
      />
    </main>
  );
}
function Denied({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-xl p-5">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <section className="panel grid gap-3" role="alert">
        <h1 className="text-3xl font-black">Game creation unavailable</h1>
        {children}
        <Link className="min-h-11 py-3 text-cyan-300" href="/dashboard">
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}
