import Link from "next/link";
import { AppNavigation } from "@/components/AppNavigation";
import { TeamGameLinks } from "@/components/TeamGameLinks";
import { GameDeletionControl } from "@/components/GameDeletionControl";
import { readableTeamRole, type AccountContext } from "@/lib/auth/account";
import type {
  EventRecord,
  ScheduledGameRecord,
  SeasonRecord,
} from "@/lib/team-hierarchy-data";
import type { DashboardBroadcast } from "@/lib/dashboard-broadcasts";
import { groupGames, type GamesTab } from "@/lib/game-hub";
import { formatScheduledStart } from "@/lib/team-hierarchy";
import { formatCanonicalGameTitle } from "@/lib/game-title";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";

export function GamesDashboard({
  account,
  games,
  events,
  seasons,
  season,
  tab,
  broadcasts,
}: {
  account: AccountContext;
  games: ScheduledGameRecord[];
  events: EventRecord[];
  seasons: SeasonRecord[];
  season?: SeasonRecord;
  tab: GamesTab;
  broadcasts: { available: boolean; sessions: DashboardBroadcast[] };
}) {
  const membership = account.membership!;
  const administrator = ["owner", "team_admin"].includes(membership.role);
  const activityIds = new Set(
    broadcasts.sessions
      .filter((s) => ["live", "preparing", "stopping"].includes(s.status))
      .map((s) => s.gameId),
  );
  const groups = groupGames(games, events, Date.now(), activityIds);
  const href = (next: GamesTab) =>
    `/dashboard?${new URLSearchParams({ tab: next, ...(season ? { season: season.id } : {}) })}`;
  const rows = (values: ScheduledGameRecord[]) => (
    <ul className="dashboard-game-grid">
      {values.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          events={events}
          role={membership.role}
          administrator={administrator}
          broadcast={broadcasts.sessions.find((s) => s.gameId === game.id)}
        />
      ))}
    </ul>
  );
  const results = [...groups.completed, ...groups.closed];
  const shown =
    tab === "past"
      ? results
      : tab === "unfinished"
        ? groups.unfinished
        : tab === "single"
          ? groups.singleGames
          : groups.upcoming;
  return (
    <main className="games-dashboard">
      <div className="dashboard-topbar">
        <AppNavigation signedIn />
        <span>
          {account.profile.display_name} · {readableTeamRole(membership.role)}
        </span>
      </div>
      <header className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">{membership.teamName}</p>
          <h1>Games</h1>
          <p className="dashboard-subtitle">
            Your schedule, match controls and results in one place.
          </p>
        </div>
        {membership.role !== "viewer" && (
          <Link className="btn dashboard-schedule" href="/games/new">
            ＋ Schedule a game
          </Link>
        )}
      </header>
      <div className="dashboard-season-bar">
        <div>
          <span className="dashboard-eyebrow">Season</span>
          <strong>{season?.name ?? "No season set up"}</strong>
        </div>
        {seasons.length > 1 && (
          <form action="/dashboard" className="dashboard-season-form">
            <label className="sr-only" htmlFor="dashboard-season">
              Choose season
            </label>
            <select
              id="dashboard-season"
              name="season"
              defaultValue={season?.id}
            >
              {seasons.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.status === "active" ? " · Current" : ""}
                </option>
              ))}
            </select>
            <input type="hidden" name="tab" value={tab} />
            <button className="btn-secondary">View season</button>
          </form>
        )}
        {administrator && (
          <Link href="/seasons">Manage seasons &amp; events →</Link>
        )}
      </div>
      <div className="dashboard-overview" aria-label="Season overview">
        <Link href={href("upcoming")}>
          <strong>{groups.upcoming.length}</strong>
          <span>Upcoming games</span>
        </Link>
        <Link href={href("past")}>
          <strong>{groups.completed.length}</strong>
          <span>Completed games</span>
        </Link>
        <Link href={href("events")}>
          <strong>{events.length}</strong>
          <span>Events</span>
        </Link>
      </div>
      {!broadcasts.available && (
        <p className="dashboard-notice" role="status">
          Broadcast status is temporarily unavailable. Your schedule and saved
          results are still available. <a href={href(tab)}>Refresh status</a>
        </p>
      )}
      {!!groups.broadcasting.length && (
        <section
          className="dashboard-activity"
          aria-labelledby="broadcast-activity"
        >
          <div className="dashboard-section-heading">
            <div>
              <h2 id="broadcast-activity">Broadcast activity</h2>
              <p>
                Last saved YouTube status. Open game controls for the latest
                status.
              </p>
            </div>
            <a className="btn-secondary" href={href(tab)}>
              Refresh
            </a>
          </div>
          {rows(groups.broadcasting)}
        </section>
      )}
      {!!groups.unfinished.length && tab !== "unfinished" && (
        <div className="dashboard-unfinished">
          <div>
            <strong>
              {groups.unfinished.length} unfinished{" "}
              {groups.unfinished.length === 1 ? "game" : "games"}
            </strong>
            <p>Past the scheduled start, or still waiting for a date.</p>
          </div>
          <Link href={href("unfinished")}>Review games →</Link>
        </div>
      )}
      <section aria-label="Browse games">
        <nav className="dashboard-tabs" aria-label="Browse games">
          {(
            [
              ["upcoming", "Upcoming", groups.upcoming.length],
              ["events", "Events", events.length],
              ["past", "Results", results.length],
              ["unfinished", "Unfinished", groups.unfinished.length],
            ] as const
          ).map(([key, label, count]) => (
            <Link
              key={key}
              href={href(key)}
              aria-current={
                tab === key || (key === "upcoming" && tab === "single")
                  ? "page"
                  : undefined
              }
            >
              {label}
              <span>{count}</span>
            </Link>
          ))}
        </nav>
        <div className="dashboard-section-heading dashboard-list-heading">
          <div>
            <h2>
              {tab === "events"
                ? "Events this season"
                : tab === "past"
                  ? "Results & history"
                  : tab === "unfinished"
                    ? "Unfinished games"
                    : tab === "single"
                      ? "Single games"
                      : "Upcoming games"}
            </h2>
            <p>
              {tab === "past"
                ? "Final scores and saved YouTube links."
                : tab === "unfinished"
                  ? "These games have no final result yet. Review them before finishing or changing the schedule."
                  : tab === "events"
                    ? "Open an event to see its games."
                    : "Scheduled games, in date order."}
            </p>
          </div>
        </div>
        {tab === "events" ? (
          groups.eventSummaries.length ? (
            <ul className="dashboard-event-grid">
              {groups.eventSummaries.map(({ event, gameCount, nextGame }) => (
                <li key={event.id}>
                  <Link
                    className="dashboard-event-card"
                    href={`/events/${event.id}`}
                  >
                    <span className="dashboard-eyebrow">
                      {event.eventType === "league" ? "League" : "Event"}
                    </span>
                    <h3>{event.name}</h3>
                    <p>
                      {event.startDate} – {event.endDate}
                    </p>
                    {event.location && <p>{event.location}</p>}
                    <div>
                      <strong>
                        {gameCount} {gameCount === 1 ? "game" : "games"}
                      </strong>
                      <span aria-hidden="true">→</span>
                    </div>
                    <p className="dashboard-event-next">
                      {nextGame?.scheduledStart
                        ? `Next: ${formatScheduledStart(nextGame.scheduledStart, event.timezone)}`
                        : "No upcoming games"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No events this season"
              text="Individual games still appear under Upcoming. Create events to group league nights or tournaments."
            />
          )
        ) : shown.length ? (
          rows(shown)
        ) : (
          <EmptyState
            title={
              tab === "past"
                ? "Results will appear here"
                : tab === "unfinished"
                  ? "No unfinished games"
                  : "No upcoming games"
            }
            text={
              tab === "past"
                ? "End a game to save its final score and YouTube link."
                : tab === "unfinished"
                  ? "There are no unscheduled games or past starts waiting for a result."
                  : "Schedule your next game to get its cameras, scoring and broadcast ready."
            }
          />
        )}
      </section>
      {administrator && (
        <footer className="dashboard-footer">
          <Link href="/dashboard/trash">Recently deleted games →</Link>
        </footer>
      )}
    </main>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="dashboard-empty">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function GameCard({
  game,
  events,
  role,
  administrator,
  broadcast,
}: {
  game: ScheduledGameRecord;
  events: EventRecord[];
  role: string;
  administrator: boolean;
  broadcast?: DashboardBroadcast;
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
  const completed = game.status === "completed";
  const closed = game.status === "closed";
  const parsedWatch = youtubeWatchUrlSchema.safeParse(
    completed ? (game.youtubeWatchUrl ?? "") : (broadcast?.watchUrl ?? ""),
  );
  const watchUrl = parsedWatch.success ? parsedWatch.data : null;
  const label = completed
    ? game.completionResult?.outcome === "no_result"
      ? "Completed"
      : "Final"
    : closed
      ? "Closed · no final result"
      : broadcast?.status === "live"
        ? "YouTube · reported live"
        : broadcast?.status === "preparing"
          ? "YouTube · starting"
          : broadcast?.status === "stopping"
            ? "YouTube · stopping"
            : broadcast?.status === "failed"
              ? "Broadcast needs attention"
              : !game.opponentId
                ? "Opponent needed"
                : !game.scheduledStart
                  ? "Schedule needed"
                  : Date.parse(game.scheduledStart) < Date.now()
                    ? "Awaiting result"
                    : "Scheduled";
  return (
    <li className="dashboard-game-card">
      <div className="dashboard-card-meta">
        <span>{event?.name ?? "Single game"}</span>
        <span
          className={`dashboard-status ${completed ? "is-final" : !closed && broadcast?.status === "live" ? "is-live" : ""}`}
        >
          {label}
        </span>
      </div>
      <h3 className="sr-only">{title}</h3>
      <div className="dashboard-matchup">
        {(["home", "away"] as const).map((side) => (
          <div key={side}>
            <span
              className="dashboard-rock"
              style={{ backgroundColor: game.config[`${side}Color`] }}
              aria-hidden="true"
            />
            <strong>
              {side === "away" && !game.opponentId
                ? "Opponent TBD"
                : game.config[`${side}Name`]}
            </strong>
            {completed && game.completionResult?.totals && (
              <b
                aria-label={`${game.config[`${side}Name`]} final score: ${game.completionResult.totals[side]}`}
              >
                {game.completionResult.totals[side]}
              </b>
            )}
          </div>
        ))}
      </div>
      {completed && game.completionResult?.label && (
        <p className="dashboard-outcome">
          {game.completionResult.outcome === "home_win"
            ? `${game.config.homeName} won`
            : game.completionResult.outcome === "away_win"
              ? `${game.config.awayName} won`
              : game.completionResult.label}
        </p>
      )}
      <p className="dashboard-game-date">{scheduledLabel}</p>
      {!completed &&
        !closed &&
        broadcast?.updatedAt &&
        ["live", "preparing", "stopping", "failed"].includes(
          broadcast.status,
        ) && (
          <p className="dashboard-saved-status">
            Status saved {formatScheduledStart(broadcast.updatedAt, timezone)}
          </p>
        )}
      <div className="dashboard-actions">
        {completed || closed || role === "viewer" ? (
          <Link className="btn-secondary" href={`/games/${game.id}`}>
            {completed ? "View result" : "View game"}
          </Link>
        ) : (
          <TeamGameLinks
            compact
            gameId={game.id}
            title={title}
            scheduledLabel={scheduledLabel}
            role={role}
            opponentTbd={!game.opponentId}
          />
        )}
        {watchUrl &&
          (completed || (!closed && broadcast?.status === "live")) && (
            <a
              className="dashboard-youtube-link"
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg aria-hidden="true" viewBox="0 0 24 18">
                <rect width="24" height="18" rx="5" fill="#ff0033" />
                <path d="m10 5 7 4-7 4Z" fill="white" />
              </svg>
              {completed ? "Watch replay" : "Open YouTube"}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
      </div>
      {administrator && (
        <details className="dashboard-more">
          <summary>More actions</summary>
          <div>
            {!completed && !closed && (
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
