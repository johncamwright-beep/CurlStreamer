import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext, readableTeamRole } from "@/lib/auth/account";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { TeamGameLinks } from "@/components/TeamGameLinks";
import { AppNavigation } from "@/components/AppNavigation";
import { GameDeletionControl } from "@/components/GameDeletionControl";
import {
  loadTeamHierarchyData,
  type ScheduledGameRecord,
} from "@/lib/team-hierarchy-data";
import { formatScheduledStart } from "@/lib/team-hierarchy";
import { formatCanonicalGameTitle } from "@/lib/game-title";
import { groupGames, type GamesTab } from "@/lib/game-hub";

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
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
  const administrator = ["owner", "team_admin"].includes(membership.role);
  const active = hierarchy.seasons.find((s) => s.status === "active");
  const activeGames = hierarchy.games.filter((g) => g.seasonId === active?.id);
  const events = hierarchy.events.filter((e) => e.seasonId === active?.id);
  const groups = groupGames(activeGames, events);
  const requested = (await searchParams).tab;
  const tab: GamesTab =
    requested === "single" || requested === "past" ? requested : "events";
  return (
    <main className="mx-auto min-h-screen max-w-5xl p-5 md:py-10">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <header className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-cyan-300">
          {membership.teamName}
        </p>
        <h1 className="text-4xl font-black">Games</h1>
        <p className="text-slate-400">
          {result.account.profile.display_name} ·{" "}
          {readableTeamRole(membership.role)}
        </p>
      </header>
      <section className="mb-8" aria-labelledby="next-up">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-cyan-300">
              Schedule
            </p>
            <h2 id="next-up" className="text-2xl font-bold">
              Next up
            </h2>
          </div>
          {membership.role !== "viewer" && (
            <Link className="btn-secondary" href="/games/new">
              Schedule a game
            </Link>
          )}
        </div>
        {groups.nextUp.length ? (
          <ol className="panel divide-y divide-slate-700 !p-0">
            {groups.nextUp.map((game) => (
              <GameRow
                key={game.id}
                game={game}
                events={events}
                role={membership.role}
                administrator={administrator}
              />
            ))}
          </ol>
        ) : (
          <p className="panel text-slate-300">No upcoming games scheduled.</p>
        )}
      </section>
      <section aria-labelledby="browse-games">
        <h2 id="browse-games" className="text-2xl font-bold">
          Browse games
        </h2>
        <nav className="games-tabs mt-3" aria-label="Browse games">
          <Tab href="/dashboard?tab=events" active={tab === "events"}>
            Events
          </Tab>
          <Tab href="/dashboard?tab=single" active={tab === "single"}>
            Single games
          </Tab>
          <Tab href="/dashboard?tab=past" active={tab === "past"}>
            Past games
          </Tab>
        </nav>
        <div className="mt-4 grid gap-3">
          {tab === "events"
            ? groups.eventSummaries.map(({ event, gameCount, nextGame }) => (
                <Link
                  key={event.id}
                  className="panel block hover:border-cyan-500"
                  href={`/events/${event.id}`}
                >
                  <h3 className="text-lg font-bold text-cyan-300">
                    {event.name}
                  </h3>
                  <p>
                    {event.startDate} – {event.endDate}
                  </p>
                  <p className="text-sm text-slate-400">
                    {gameCount} {gameCount === 1 ? "game" : "games"} ·{" "}
                    {nextGame?.scheduledStart
                      ? `Next: ${formatScheduledStart(nextGame.scheduledStart, event.timezone)}`
                      : "No upcoming games"}
                  </p>
                </Link>
              ))
            : tab === "single"
              ? groups.singleGames.map((game) => (
                  <GameRow
                    key={game.id}
                    game={game}
                    events={events}
                    role={membership.role}
                    administrator={administrator}
                  />
                ))
              : groups.past.map((game) => (
                  <GameRow
                    key={game.id}
                    game={game}
                    events={events}
                    role={membership.role}
                    administrator={administrator}
                  />
                ))}
          {((tab === "events" && !groups.eventSummaries.length) ||
            (tab === "single" && !groups.singleGames.length) ||
            (tab === "past" && !groups.past.length)) && (
            <p className="panel text-slate-400">No games to show here.</p>
          )}
        </div>
      </section>
      {administrator && (
        <footer className="mt-10 border-t border-slate-800 pt-4">
          <Link
            className="inline-flex min-h-11 items-center text-sm text-slate-400 hover:text-cyan-300"
            href="/dashboard/trash"
          >
            Recently deleted games
          </Link>
        </footer>
      )}
    </main>
  );
}
function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      className="games-tab"
      href={href}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
function GameRow({
  game,
  events,
  role,
  administrator,
}: {
  game: ScheduledGameRecord;
  events: { id: string; name: string; timezone: string }[];
  role: string;
  administrator: boolean;
}) {
  const event = events.find((e) => e.id === game.eventId);
  const title = formatCanonicalGameTitle({
    structured: Boolean(game.seasonId),
    legacyTitle: game.config.eventName,
    homeName: game.config.homeName,
    awayName: game.opponentId ? game.config.awayName : null,
    eventName: event?.name,
  });
  const timezone = event?.timezone ?? game.timezone ?? "UTC";
  const scheduledLabel = game.scheduledStart
    ? formatScheduledStart(game.scheduledStart, timezone)
    : "Schedule not set";
  const totals = game.completionResult?.totals;
  return (
    <li className="list-none p-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="font-bold">{title}</h3>
          <p className="text-sm text-slate-300">{scheduledLabel}</p>
          <p className="text-sm text-slate-500">
            {event?.name ?? "Single Game"}
          </p>
          {game.status === "completed" && (
            <p className="mt-1 font-bold text-cyan-200">
              Final:{" "}
              {totals
                ? `${totals.home} – ${totals.away}`
                : game.completionResult?.label}
            </p>
          )}
        </div>
        {game.status === "completed" ? (
          <Link className="btn-secondary" href={`/games/${game.id}`}>
            View result
          </Link>
        ) : role !== "viewer" ? (
          <TeamGameLinks
            gameId={game.id}
            title={title}
            scheduledLabel={scheduledLabel}
            role={role}
            opponentTbd={!game.opponentId}
          />
        ) : null}
      </div>
      {administrator && (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-slate-400">
            More actions
          </summary>
          <div className="flex flex-wrap gap-2">
            {game.status !== "completed" && (
              <Link className="btn-secondary" href={`/games/${game.id}/edit`}>
                Edit schedule
              </Link>
            )}
            <GameDeletionControl gameId={game.id} title={title} matchup="" />
          </div>
        </details>
      )}
    </li>
  );
}
