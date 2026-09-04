import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { EventForm } from "@/components/EventForm";
import { TeamGameLinks } from "@/components/TeamGameLinks";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";
import { formatScheduledStart } from "@/lib/team-hierarchy";
import { formatCanonicalGameTitle } from "@/lib/game-title";

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const data = await loadTeamHierarchyData(user);
  if (!data.ok)
    return (
      <main className="p-5" role="alert">
        Event could not be loaded.
      </main>
    );
  const event = data.events.find((item) => item.id === id);
  if (!event) notFound();
  const season = data.seasons.find((item) => item.id === event.seasonId)!;
  const games = data.games.filter((game) => game.eventId === id);
  const canEdit =
    data.role !== "viewer" && !event.archivedAt && season.status !== "archived";
  return (
    <main className="mx-auto min-h-screen max-w-4xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <header className="panel mb-5">
        <Link href={`/seasons/${season.id}`} className="text-cyan-300">
          ← {season.name}
        </Link>
        <h1 className="mt-2 text-3xl font-black">{event.name}</h1>
        <p>
          {event.startDate} – {event.endDate} · {event.timezone}
        </p>
        {event.location && <p>{event.location}</p>}
        {event.archivedAt && (
          <p className="mt-2 rounded bg-slate-700 p-2">
            Archived event — historical games remain available.
          </p>
        )}
      </header>
      {canEdit && (
        <div className="mb-5">
          <EventForm seasonId={season.id} event={event} />
        </div>
      )}
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Scheduled games</h2>
          {canEdit && (
            <Link className="btn" href={`/games/new?eventId=${event.id}`}>
              Add game
            </Link>
          )}
        </div>
        {games.length === 0 ? (
          <div className="panel">
            <p>No games scheduled for this event.</p>
            {canEdit && (
              <Link
                className="mt-2 inline-block min-h-11 py-3 text-cyan-300"
                href={`/games/new?eventId=${event.id}`}
              >
                Schedule the first game
              </Link>
            )}
          </div>
        ) : (
          games.map((game) => {
            const title = formatCanonicalGameTitle({
              homeName: game.config.homeName,
              awayName: game.opponentId ? game.config.awayName : null,
              eventName: game.config.eventName,
            });
            return (
              <article className="panel" key={game.id}>
                <h3 className="font-bold">{title}</h3>
                {game.gameNumber && (
                  <p className="text-sm text-slate-400">
                    Game {game.gameNumber}
                  </p>
                )}
                {game.scheduledStart && (
                  <p className="text-slate-300">
                    {formatScheduledStart(game.scheduledStart, event.timezone)}{" "}
                    · {game.status}
                  </p>
                )}
                {data.role !== "viewer" && (
                  <TeamGameLinks gameId={game.id} title={title} />
                )}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
