import Link from "next/link";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/AppIcon";
import { AppNavigation } from "@/components/AppNavigation";
import { TeamGameLinks } from "@/components/TeamGameLinks";
import { GameDeletionControl } from "@/components/GameDeletionControl";
import { ReopenGameControl } from "@/components/ReopenGameControl";
import { type AccountContext } from "@/lib/auth/account";
import type {
  EventRecord,
  ScheduledGameRecord,
  SeasonRecord,
} from "@/lib/team-hierarchy-data";
import type { DashboardBroadcast } from "@/lib/dashboard-broadcasts";
import { groupGames } from "@/lib/game-hub";
import { formatScheduledStart } from "@/lib/team-hierarchy";
import {
  formatCanonicalGameTitle,
  formatEventGameLabel,
} from "@/lib/game-title";
import { firstValidYoutubeWatchUrl } from "@/lib/youtube-watch";
import { OpponentEditControl } from "@/components/OpponentEditControl";
import { DashboardRefresh } from "@/components/DashboardRefresh";
import { YouTubeThumbnailUpdate } from "@/components/YouTubeThumbnailUpdate";
import { ShotTrackerIcon } from "@/app/curlcoach/ShotTrackerBrand";
import { DashboardFilters, DashboardSeasonSelect } from "./DashboardFilters";
import { GameActionsMenu } from "./GameActionsMenu";
import {
  dashboardHref,
  type DashboardQuery,
  type GameView,
} from "./dashboard-query";

export function GamesDashboard({
  account,
  accountLogo,
  games,
  events,
  seasons,
  season,
  tab = "all",
  sort = "newest",
  search = "",
  broadcasts,
  selectedEvent,
  setupWalkthrough,
}: {
  account: AccountContext;
  accountLogo?: string | null;
  games: ScheduledGameRecord[];
  events: EventRecord[];
  seasons: SeasonRecord[];
  season?: SeasonRecord;
  tab?: GameView;
  sort?: DashboardQuery["sort"];
  search?: string;
  broadcasts: { available: boolean; sessions: DashboardBroadcast[] };
  selectedEvent?: string;
  setupWalkthrough?: ReactNode;
}) {
  const membership = account.membership!;
  const administrator = ["owner", "team_admin"].includes(membership.role);
  const sessions = new Map(
    broadcasts.sessions.map((session) => [session.gameId, session]),
  );
  const activityIds = new Set(
    broadcasts.sessions
      .filter((session) =>
        ["live", "preparing", "stopping"].includes(session.status),
      )
      .map((session) => session.gameId),
  );
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const eventFilter =
    selectedEvent === "single" ||
    (selectedEvent && eventsById.has(selectedEvent))
      ? selectedEvent
      : undefined;
  const query = { tab, sort, search, season: season?.id, event: eventFilter };
  const searchTerms = search.toLocaleLowerCase().split(" ").filter(Boolean);
  const filteredGames = games.filter((game) => {
    if (
      eventFilter &&
      (eventFilter === "single" ? game.eventId : game.eventId !== eventFilter)
    )
      return false;
    const eventName = game.eventId
      ? eventsById.get(game.eventId)?.name
      : "Single game";
    const searchableText = [
      game.config.homeName,
      game.config.awayName,
      game.config.eventName,
      eventName,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchTerms.every((term) => searchableText.includes(term));
  });
  const filteredEvents = events.filter(
    (event) =>
      (!eventFilter || event.id === eventFilter) &&
      (!searchTerms.length ||
        searchTerms.every((term) =>
          event.name.toLocaleLowerCase().includes(term),
        ) ||
        filteredGames.some((game) => game.eventId === event.id)),
  );
  const groups = groupGames(
    filteredGames,
    filteredEvents,
    Date.now(),
    activityIds,
  );
  const currentGames = new Set(groups.current);
  const shown = (
    tab === "past"
      ? [...groups.completed, ...groups.closed]
      : tab === "unfinished"
        ? groups.unfinished
        : tab === "single"
          ? groups.singleGames
          : tab === "upcoming"
            ? [
                ...new Set([
                  ...groups.broadcasting,
                  ...groups.current,
                  ...groups.upcoming,
                ]),
              ]
            : filteredGames
  ).toSorted((a, b) => {
    const first = Date.parse(a.scheduledStart ?? a.createdAt);
    const second = Date.parse(b.scheduledStart ?? b.createdAt);
    return sort === "newest" ? second - first : first - second;
  });
  const eventSummaries = groups.eventSummaries.toSorted((a, b) => {
    const order = a.event.startDate.localeCompare(b.event.startDate);
    return sort === "newest" ? -order : order;
  });
  const count = tab === "events" ? eventSummaries.length : shown.length;
  const eventLabel =
    eventFilter === "single"
      ? "Standalone games"
      : eventFilter && eventsById.get(eventFilter)?.name;
  return (
    <main className="games-dashboard">
      <DashboardRefresh organizationId={membership.organization_id} />
      <header className="dashboard-heading">
        <AppNavigation signedIn accountLogo={accountLogo} />
        <div className="dashboard-title">
          <p className="dashboard-team-title">{membership.teamName}</p>
          <p className="dashboard-team-section">Games</p>
        </div>
        <div className="dashboard-season-bar">
          <DashboardSeasonSelect query={query} seasons={seasons} />
        </div>
        {membership.role !== "viewer" && (
          <Link className="btn dashboard-schedule" href="/games/new">
            ＋ Create game
          </Link>
        )}
      </header>
      {setupWalkthrough}
      <section aria-label="Browse games">
        <div className="dashboard-toolbar">
          <div className="dashboard-list-title">
            <h1>Games</h1>
            <span className="dashboard-game-count" aria-live="polite">
              {count}
              <span className="sr-only">
                {tab === "events"
                  ? count === 1
                    ? " event"
                    : " events"
                  : count === 1
                    ? " game"
                    : " games"}
              </span>
            </span>
          </div>
          <DashboardFilters query={query} events={events} />
        </div>
        {eventLabel && (
          <div className="dashboard-active-event">
            <Link
              href={dashboardHref({ ...query, event: undefined })}
              aria-label="Clear event filter"
            >
              {eventLabel} <span aria-hidden="true">×</span>
            </Link>
          </div>
        )}
        {tab === "events" ? (
          eventSummaries.length ? (
            <ul className="dashboard-event-grid">
              {eventSummaries.map(({ event, gameCount, nextGame }) => (
                <li key={event.id}>
                  <Link
                    className="dashboard-event-card"
                    href={`/events/${event.id}`}
                  >
                    <span className="dashboard-eyebrow">
                      {event.eventType === "league" ? "League" : "Event"}
                    </span>
                    <h2>{event.name}</h2>
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
                        ? `Next: ${formatScheduledStart(nextGame.scheduledStart, nextGame.timezone ?? event.timezone)}`
                        : "No upcoming games"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={
                search ? "No events match your search" : "No events this season"
              }
              text={
                search
                  ? "Try a different team or event name."
                  : "Create events to group league nights or tournaments."
              }
            />
          )
        ) : shown.length ? (
          <ul className="dashboard-game-grid">
            {shown.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                event={game.eventId ? eventsById.get(game.eventId) : undefined}
                eventHref={dashboardHref({
                  ...query,
                  tab: "all",
                  event: game.eventId ?? "single",
                  search: "",
                })}
                seasons={seasons}
                role={membership.role}
                administrator={administrator}
                broadcast={sessions.get(game.id)}
                current={currentGames.has(game)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title={
              search
                ? "No games match your search"
                : tab === "past"
                  ? "Results will appear here"
                  : tab === "unfinished"
                    ? "No unfinished games"
                    : tab === "all"
                      ? "No games to show"
                      : "No upcoming games"
            }
            text={
              search
                ? "Try a different team or event name."
                : eventFilter
                  ? "No games match this event in this view."
                  : tab === "past"
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
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function GameCard({
  game,
  event,
  eventHref,
  seasons,
  role,
  administrator,
  broadcast,
  current,
}: {
  game: ScheduledGameRecord;
  event?: EventRecord;
  eventHref: string;
  seasons: SeasonRecord[];
  role: string;
  administrator: boolean;
  broadcast?: DashboardBroadcast;
  current: boolean;
}) {
  const title = formatCanonicalGameTitle({
    structured: Boolean(game.seasonId),
    legacyTitle: game.config.eventName,
    homeName: game.config.homeName,
    awayName: game.opponentId ? game.config.awayName : null,
    eventName: event?.name,
    gameNumber: game.gameNumber,
  });
  const timezone = game.timezone ?? event?.timezone ?? "America/Toronto";
  const scheduledLabel = game.scheduledStart
    ? formatScheduledStart(game.scheduledStart, timezone)
    : "Schedule not set";
  const completed = game.status === "completed";
  const closed = game.status === "closed";
  const eventLabel = game.eventId
    ? (event?.name ??
      (formatEventGameLabel(game.config.eventName, null) || "Event"))
    : "Single game";
  const totals = completed ? game.completionResult?.totals : undefined;
  const watchUrl = firstValidYoutubeWatchUrl(
    game.config.sharedYoutubeWatchUrl,
    ...(completed ? [game.youtubeWatchUrl] : []),
    broadcast?.watchUrl,
    game.scheduledYouTubeWatchUrl,
  );
  const shotTrackerQuery = new URLSearchParams({
    source: "streamer",
    event: game.eventId ?? "standalone",
    game: game.id,
  });
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
                  : current
                    ? "Current game"
                    : Date.parse(game.scheduledStart) < Date.now()
                      ? "Awaiting result"
                      : "Scheduled";
  const team = (side: "home" | "away") => {
    const name = game.config[`${side}Name`];
    return (
      <div className={`dashboard-team dashboard-team-${side}`}>
        <span
          className="dashboard-rock"
          style={{ backgroundColor: game.config[`${side}Color`] }}
          aria-hidden="true"
        />
        <strong>
          {completed ? (
            <Link
              href={`/games/${game.id}`}
              aria-label={`${name} game details`}
            >
              {name}
            </Link>
          ) : side === "away" && !game.opponentId ? (
            "Opponent TBD"
          ) : (
            name
          )}
        </strong>
      </div>
    );
  };
  return (
    <li className="dashboard-game-card">
      <h2 className="sr-only">{title}</h2>
      <div className="dashboard-card-meta">
        <div className="dashboard-card-tags">
          {!game.eventId || event ? (
            <Link
              className="dashboard-event-link"
              href={eventHref}
              prefetch={false}
            >
              {eventLabel} <span aria-hidden="true">↗</span>
            </Link>
          ) : (
            <span className="dashboard-event-link">{eventLabel}</span>
          )}
          <span
            className={`dashboard-status ${completed ? "is-final" : !closed && broadcast?.status === "live" ? "is-live" : ""}`}
          >
            {label}
          </span>
        </div>
        {game.scheduledStart ? (
          <time className="dashboard-game-date" dateTime={game.scheduledStart}>
            {scheduledLabel}
          </time>
        ) : (
          <span className="dashboard-game-date">{scheduledLabel}</span>
        )}
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
      </div>
      <div className="dashboard-matchup">
        {team("home")}
        {totals ? (
          <div className="dashboard-score">
            <b
              aria-label={`${game.config.homeName} final score: ${totals.home}`}
            >
              {totals.home}
            </b>
            <span aria-hidden="true">:</span>
            <b
              aria-label={`${game.config.awayName} final score: ${totals.away}`}
            >
              {totals.away}
            </b>
          </div>
        ) : (
          <span className="dashboard-versus">vs</span>
        )}
        {team("away")}
        {completed && game.completionResult?.label && (
          <p className="dashboard-outcome">
            {game.completionResult.outcome === "home_win"
              ? `${game.config.homeName} won`
              : game.completionResult.outcome === "away_win"
                ? `${game.config.awayName} won`
                : game.completionResult.label}
          </p>
        )}
      </div>
      <div className="dashboard-actions">
        {!completed &&
          (closed || role === "viewer" ? (
            <Link className="btn-secondary" href={`/games/${game.id}`}>
              View game
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
          ))}
        <div className="dashboard-media-actions">
          <Link
            className="dashboard-shot-tracker-link"
            href={`/shot-tracker?${shotTrackerQuery}#charting`}
            prefetch={false}
            aria-label={`ShotTracker: ${title}`}
          >
            <ShotTrackerIcon size={20} />
            ShotTracker
          </Link>
          {watchUrl &&
            (completed ||
              (!closed &&
                (broadcast?.status === "live" ||
                  game.scheduledYouTubeStatus === "ready"))) && (
              <a
                className="dashboard-youtube-link"
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={
                  completed
                    ? undefined
                    : "Watch on YouTube (opens in a new tab)"
                }
              >
                <svg aria-hidden="true" viewBox="0 0 24 18">
                  <rect width="24" height="18" rx="5" fill="#ff0033" />
                  <path d="m10 5 7 4-7 4Z" fill="white" />
                </svg>
                {completed ? "Replay" : "Watch"}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
        </div>
        {administrator && (
          <GameActionsMenu>
            {!closed && (
              <Link
                className="dashboard-menu-item"
                href={`/games/${game.id}/edit`}
              >
                <AppIcon name="edit" /> Edit game
              </Link>
            )}
            {game.opponentId && game.seasonId && (
              <div className="dashboard-menu-item">
                <AppIcon name="opponent" />
                <OpponentEditControl
                  opponentId={game.opponentId}
                  opponentName={game.config.awayName}
                  seasonId={game.seasonId}
                  seasonName={
                    seasons.find((item) => item.id === game.seasonId)?.name ??
                    "Game season"
                  }
                />
              </div>
            )}
            {completed && (
              <div className="dashboard-menu-item">
                <span aria-hidden="true">↶</span>
                <ReopenGameControl gameId={game.id} compact />
              </div>
            )}
            {game.config.youtubeEnabled &&
              !game.config.sharedYoutubeWatchUrl &&
              game.scheduledYouTubeWatchUrl &&
              !completed &&
              !closed && (
                <div className="dashboard-menu-item">
                  <YouTubeThumbnailUpdate gameId={game.id} />
                </div>
              )}
            <div className="dashboard-menu-item dashboard-delete">
              <span className="dashboard-delete-icon" aria-hidden="true" />
              <GameDeletionControl gameId={game.id} title={title} matchup="" />
            </div>
          </GameActionsMenu>
        )}
      </div>
    </li>
  );
}
