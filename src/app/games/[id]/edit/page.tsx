import "../../new/setup.css";
import { notFound, redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";
import { listOpponents } from "@/lib/team-hierarchy-service";
import { GameCreationForm } from "../../new/GameCreationForm";
import { formatCanonicalGameTitle } from "@/lib/game-title";
import { formatScheduledStart } from "@/lib/team-hierarchy";
import { gameCapabilities } from "@/lib/current-game";
import { CompletedResultEditor } from "@/components/CompletedResultEditor";
import { readCompletedResult } from "@/lib/providers/completed-result";
import { completedResultReplySchema } from "@/lib/completed-result-client";

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
  if (!game) notFound();
  const completed = game.status === "completed";
  const administrator = data.role === "owner" || data.role === "team_admin";
  if (completed && !administrator) redirect("/dashboard");
  if (!completed && !game.seasonId) notFound();
  const result = completed ? await readCompletedResult(game.id) : null;
  if (result && !result.ok) {
    if (result.kind === "authorization") redirect("/dashboard");
    return <AccountServiceUnavailable />;
  }
  const initialResult = result?.ok
    ? completedResultReplySchema.safeParse(result.value)
    : null;
  const title = formatCanonicalGameTitle({
    homeName: game.config.homeName,
    awayName: game.opponentId ? game.config.awayName : null,
    eventName: game.eventId ? game.config.eventName : null,
    gameNumber: game.gameNumber,
  });
  return (
    <main className="game-setup-page">
      <div className="mb-4">
        <AppNavigation
          signedIn
          gameContext={{
            id: game.id,
            title,
            scheduledLabel: game.scheduledStart
              ? formatScheduledStart(
                  game.scheduledStart,
                  game.timezone ?? "UTC",
                )
              : "Schedule not set",
            capabilities: completed
              ? {
                  control: false,
                  scoring: false,
                  broadcast: false,
                  editSchedule: administrator,
                  assignOpponent: false,
                }
              : gameCapabilities(data.role, !game.opponentId),
          }}
        />
      </div>
      {completed ? (
        <CompletedResultEditor
          gameId={game.id}
          initialSnapshot={
            initialResult?.success ? initialResult.data : undefined
          }
        />
      ) : (
        <GameCreationForm
          teamName={data.teamName}
          seasons={data.seasons}
          events={data.events}
          opponents={opponents.value as never[]}
          games={data.games}
          canManageTeamDetails={
            data.role === "owner" || data.role === "team_admin"
          }
          editing={game}
          editingTitle={title}
        />
      )}
    </main>
  );
}
