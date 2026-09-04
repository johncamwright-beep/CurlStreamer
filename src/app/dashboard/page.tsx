import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext, readableTeamRole } from "@/lib/auth/account";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { listDeletedTeamGames } from "@/lib/team-games";
import { TeamGameLinks } from "@/components/TeamGameLinks";
import { AppNavigation } from "@/components/AppNavigation";
import { GameDeletionControl } from "@/components/GameDeletionControl";
import {
  loadTeamHierarchyData,
  type ScheduledGameRecord,
} from "@/lib/team-hierarchy-data";
import { formatScheduledStart } from "@/lib/team-hierarchy";

export default async function DashboardPage() {
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
  const context = result;
  if (context.account.profile.status !== "active")
    return (
      <main className="mx-auto max-w-xl p-5">
        <section className="panel" role="alert">
          <h1 className="text-3xl font-black">Account access denied</h1>
          <p>This account is not currently active.</p>
        </section>
      </main>
    );
  const membership = context.account.membership;
  if (!membership) redirect("/onboarding");
  const canSchedule = membership.role !== "viewer";
  const administrator = ["owner", "team_admin"].includes(membership.role);
  const deleted = administrator ? await listDeletedTeamGames(user) : null;
  const active = hierarchy.seasons.find((season) => season.status === "active");
  const events = active
    ? hierarchy.events.filter((event) => event.seasonId === active.id)
    : [];
  const upcoming = hierarchy.games
    .filter(
      (game) =>
        game.scheduledStart &&
        game.seasonId === active?.id &&
        new Date(game.scheduledStart).getTime() >= Date.now(),
    )
    .slice(0, 5);
  const singleGames = active
    ? hierarchy.games.filter(
        (game) => game.seasonId === active.id && !game.eventId,
      )
    : [];
  const legacy = hierarchy.games.filter((game) => !game.seasonId);
  return (
    <main className="mx-auto min-h-screen max-w-5xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <header className="panel mb-5">
        <p className="text-cyan-300">TEAM DASHBOARD</p>
        <h1 className="text-3xl font-black">{membership.teamName}</h1>
        <p>
          {context.account.profile.display_name} ·{" "}
          {readableTeamRole(membership.role)}
        </p>
      </header>
      <section className="panel mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-slate-400">Current season</p>
            <h2 className="text-2xl font-bold">
              {active?.name ?? "No active season"}
            </h2>
            {active && (
              <p>
                {active.startDate} – {active.endDate}
              </p>
            )}
          </div>
          <Link className="btn-secondary" href="/seasons">
            Manage seasons &amp; events
          </Link>
        </div>
        {!active && canSchedule && (
          <Link
            className="mt-3 inline-block min-h-11 py-3 text-cyan-300"
            href="/seasons"
          >
            Create a season first
          </Link>
        )}
      </section>
      {active && (
        <>
          <section className="mb-5 grid gap-3">
            <h2 className="text-2xl font-bold">Upcoming games</h2>
            {upcoming.length ? (
              <ol className="grid gap-2">
                {upcoming.map((game) => {
                  const event = events.find((item) => item.id === game.eventId);
                  return (
                    <li className="rounded-lg bg-slate-800 p-4" key={game.id}>
                      <Link
                        className="font-bold text-cyan-300"
                        href={`#game-${game.id}`}
                      >
                        {game.gameLabel || `Game ${game.gameNumber}`} ·{" "}
                        {game.config.awayName}
                      </Link>
                      <p>
                        {formatScheduledStart(
                          game.scheduledStart!,
                          event?.timezone ?? game.timezone ?? "UTC",
                        )}{" "}
                        · {event?.name ?? "Single Game"}
                      </p>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="panel">No upcoming games in the current season.</p>
            )}
          </section>
          <section className="mb-5 grid gap-3">
            <h2 className="text-2xl font-bold">Single Games</h2>
            {singleGames.length ? (
              singleGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  teamName={membership.teamName}
                  timezone={game.timezone ?? "UTC"}
                  role={membership.role}
                />
              ))
            ) : (
              <p className="panel">No single games in this season.</p>
            )}
          </section>
          <section className="mb-5 grid gap-4">
            <h2 className="text-2xl font-bold">Events in {active.name}</h2>
            {events.length ? (
              events.map((event) => {
                const games = hierarchy.games.filter(
                  (game) => game.eventId === event.id,
                );
                return (
                  <article className="panel" key={event.id}>
                    <header>
                      <span className="text-sm uppercase text-cyan-300">
                        {event.eventType}
                        {event.archivedAt ? " · Archived" : ""}
                      </span>
                      <h3 className="text-xl font-bold">
                        <Link href={`/events/${event.id}`}>{event.name}</Link>
                      </h3>
                      <p>
                        {event.startDate} – {event.endDate}
                      </p>
                      <p className="text-slate-300">
                        {[event.location, event.timezone]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </header>
                    <div className="mt-4 grid gap-3">
                      {games.length ? (
                        games.map((game) => (
                          <GameCard
                            key={game.id}
                            game={game}
                            teamName={membership.teamName}
                            timezone={event.timezone}
                            role={membership.role}
                          />
                        ))
                      ) : (
                        <p>
                          No games scheduled.{" "}
                          {canSchedule && (
                            <Link
                              className="text-cyan-300"
                              href={`/games/new?eventId=${event.id}`}
                            >
                              Add a game
                            </Link>
                          )}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="panel">
                <p>No events in the current season.</p>
                {canSchedule && (
                  <Link
                    className="inline-block min-h-11 py-3 text-cyan-300"
                    href={`/seasons/${active.id}`}
                  >
                    Create an event first
                  </Link>
                )}
              </div>
            )}
          </section>
        </>
      )}
      <section className="mb-5 grid gap-3">
        <h2 className="text-2xl font-bold">Legacy / Unassigned Games</h2>
        {legacy.length ? (
          legacy.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              teamName={membership.teamName}
              role={membership.role}
            />
          ))
        ) : (
          <p className="panel">No unassigned games.</p>
        )}
      </section>
      {administrator && deleted?.ok && deleted.games.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-2xl font-bold">Recently Deleted</h2>
          {deleted.games.map((game) => (
            <article className="panel" key={game.game_id}>
              <h3 className="font-bold">{game.event_name}</h3>
              <p>
                {game.home_name} vs. {game.away_name}
              </p>
              <GameDeletionControl
                restore
                gameId={game.game_id}
                title={game.event_name}
                matchup={`${game.home_name} vs. ${game.away_name}`}
              />
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function GameCard({
  game,
  teamName,
  timezone,
  role,
}: {
  game: ScheduledGameRecord;
  teamName: string;
  timezone?: string;
  role: string;
}) {
  const administrator = ["owner", "team_admin"].includes(role);
  return (
    <article
      id={`game-${game.id}`}
      className="rounded-lg border border-slate-700 p-4"
    >
      <h4 className="font-bold">
        {game.gameLabel ||
          (game.gameNumber ? `Game ${game.gameNumber}` : game.config.eventName)}
      </h4>
      <p>
        {teamName} vs. {game.opponentId ? game.config.awayName : "Opponent TBD"}
      </p>
      <p className="text-sm text-slate-300">
        {game.scheduledStart && timezone
          ? formatScheduledStart(game.scheduledStart, timezone)
          : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
              new Date(game.createdAt),
            )}{" "}
        · {game.status}
      </p>
      {role !== "viewer" && <TeamGameLinks gameId={game.id} />}{" "}
      {administrator && (
        <GameDeletionControl
          gameId={game.id}
          title={game.gameLabel || game.config.eventName}
          matchup={`${teamName} vs. ${game.config.awayName}`}
        />
      )}
    </article>
  );
}
