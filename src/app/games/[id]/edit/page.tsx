import { notFound, redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";
import { listOpponents } from "@/lib/team-hierarchy-service";
import { GameCreationForm } from "../../new/GameCreationForm";
import { formatCanonicalGameTitle } from "@/lib/game-title";

export default async function EditGamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const [data, opponents] = await Promise.all([
    loadTeamHierarchyData(user),
    listOpponents(user),
  ]);
  if (!data.ok || !opponents.ok) return <AccountServiceUnavailable />;
  if (data.role === "viewer") redirect("/dashboard");
  const game = data.games.find((item) => item.id === id);
  if (!game?.seasonId) notFound();
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn gameId={game.id} />
      </div>
      <GameCreationForm
        teamName={data.teamName}
        seasons={data.seasons}
        events={data.events}
        opponents={opponents.value as never[]}
        games={data.games}
        editing={game}
        editingTitle={formatCanonicalGameTitle({
          homeName: game.config.homeName,
          awayName: game.opponentId ? game.config.awayName : null,
          eventName: game.eventId ? game.config.eventName : null,
        })}
      />
    </main>
  );
}
