import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { GameDeletionControl } from "@/components/GameDeletionControl";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { getAccountContext } from "@/lib/auth/account";
import { formatCanonicalGameTitle } from "@/lib/game-title";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listDeletedTeamGames } from "@/lib/team-games";
export default async function TrashPage() {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const context = await getAccountContext(user);
  if (!context.ok) return <AccountServiceUnavailable />;
  if (
    !context.account.membership ||
    !["owner", "team_admin"].includes(context.account.membership.role)
  )
    redirect("/dashboard");
  const deleted = await listDeletedTeamGames(user);
  if (!deleted.ok) return <AccountServiceUnavailable />;
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-5 md:py-10">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <nav aria-label="Breadcrumb">
        <Link className="text-cyan-300" href="/dashboard">
          Games
        </Link>{" "}
        → Trash
      </nav>
      <h1 className="my-5 text-3xl font-black">Recently deleted games</h1>
      <p className="mb-5 text-slate-400">
        Restore a game with its configuration, scoring history, and audit trail
        intact.
      </p>
      <div className="grid gap-3">
        {deleted.games.map((game) => {
          const title = formatCanonicalGameTitle({
            structured: false,
            legacyTitle: game.event_name,
            homeName: game.home_name,
            awayName: game.away_name,
          });
          return (
            <article className="panel" key={game.game_id}>
              <h2 className="font-bold">{title}</h2>
              <p className="text-sm text-slate-400">
                Deleted{" "}
                {game.deleted_at
                  ? new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                    }).format(new Date(game.deleted_at))
                  : "recently"}
              </p>
              <div className="mt-3">
                <GameDeletionControl
                  restore
                  gameId={game.game_id}
                  title={title}
                  matchup=""
                />
              </div>
            </article>
          );
        })}
        {!deleted.games.length && <p className="panel">Trash is empty.</p>}
      </div>
    </main>
  );
}
