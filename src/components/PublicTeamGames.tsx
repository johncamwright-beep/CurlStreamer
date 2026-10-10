"use client";
import React, { useState } from "react";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";
import { formatScheduledStart, isIanaTimezone } from "@/lib/team-hierarchy";

export type PublicGame = {
  id: string;
  home: string;
  away: string;
  opponent_slug?: string | null;
  opponent_logo?: string | null;
  event: string | null;
  event_id?: string | null;
  number: number | null;
  scheduled: string | null;
  timezone?: string | null;
  completed: string | null;
  result: { home: number; away: number } | null;
  youtube: string | null;
};
export function publicGamePlayedDate(game: PublicGame) {
  return [game.scheduled, game.completed].find(
    (date) => date && Number.isFinite(Date.parse(date)),
  );
}
export function publicGameScheduleLabel(game: PublicGame) {
  const scheduled =
    game.scheduled && /T\d{2}:\d{2}/.test(game.scheduled)
      ? new Date(game.scheduled)
      : null;
  if (scheduled && Number.isFinite(scheduled.getTime())) {
    const timezone =
      game.timezone && isIanaTimezone(game.timezone) ? game.timezone : "UTC";
    return formatScheduledStart(game.scheduled!, timezone);
  }
  const recordedDate = publicGamePlayedDate(game);
  if (recordedDate) {
    const date = new Date(recordedDate);
    if (Number.isFinite(date.getTime()))
      return `${date.toLocaleDateString("en-CA", { timeZone: "UTC" })} · Start time not recorded`;
  }
  return "Date and time to be announced";
}
export function filterPublicGames(
  games: PublicGame[],
  mode: string,
  event: string,
  now = Date.now(),
) {
  const played = (game: PublicGame) => {
    const date = publicGamePlayedDate(game);
    return date ? Date.parse(date) : undefined;
  };
  return games
    .filter((g) => {
      if (event && g.event_id !== event) return false;
      if (mode === "recent") {
        const stamp = played(g);
        return (
          stamp !== undefined &&
          stamp >= now - 14 * 24 * 60 * 60 * 1000 &&
          stamp <= now
        );
      }
      return Boolean(g.completed) === (mode === "results");
    })
    .sort((a, b) => {
      const stamp = (g: PublicGame) =>
        mode === "recent"
          ? (played(g) ?? 0)
          : Date.parse(
              (mode === "results" ? g.completed : g.scheduled) || "",
            ) || 0;
      return mode === "upcoming" ? stamp(a) - stamp(b) : stamp(b) - stamp(a);
    });
}
export function PublicTeamGames({
  games,
  teamName = "Team",
  upcoming,
  results,
  now = Date.now(),
}: {
  games: PublicGame[];
  teamName?: string;
  upcoming: boolean;
  results: boolean;
  now?: number;
}) {
  const [mode, setMode] = useState("recent");
  const [event, setEvent] = useState("");
  if (!upcoming && !results) return null;
  const allowed = games.filter((g) => (g.completed ? results : upcoming));
  const events = [
    ...new Map(
      allowed
        .filter((g) => g.event_id && g.event)
        .map((g) => [g.event_id!, g.event!]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const selectedMode =
    (mode === "upcoming" && !upcoming) || (mode === "results" && !results)
      ? "recent"
      : mode;
  const filtered = filterPublicGames(allowed, selectedMode, event, now);
  return (
    <section id="games" className="panel mb-5" aria-label="Team games">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <h2 className="mr-auto self-center text-2xl font-black">
          {teamName} Games
        </h2>
        <label className="grid gap-1 text-sm">
          Show games
          <select
            className="input min-h-11"
            value={selectedMode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="recent">Recent · Last 14 days</option>
            {upcoming && <option value="upcoming">Upcoming</option>}
            {results && <option value="results">Results</option>}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Event
          <select
            className="input min-h-11 max-w-full"
            aria-label="Event"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
          >
            <option value="">All events</option>
            {events.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        key={`${mode}-${event}`}
        className="public-games-scroll"
        tabIndex={filtered.length > 5 ? 0 : undefined}
        role="region"
        aria-label="Filtered games"
      >
        {filtered.map((g) => (
          <article key={g.id} id={`game-${g.id}`} className="public-game-row">
            <div className="min-w-0">
              <strong className="line-clamp-2" title={`${g.home} vs ${g.away}`}>
                {g.home} vs{" "}
                {g.opponent_slug &&
                /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(g.opponent_slug) ? (
                  <a
                    className="inline-flex min-h-11 items-center gap-2 underline"
                    href={`https://${g.opponent_slug}.curlstreamer.app`}
                  >
                    {g.opponent_logo && (
                      <img
                        src={g.opponent_logo}
                        alt=""
                        className="h-6 w-6 object-contain"
                      />
                    )}
                    {g.away}
                  </a>
                ) : (
                  g.away
                )}
              </strong>
              <p className="truncate">
                {g.event || "Single game"}
                {g.number ? ` · Game ${g.number}` : ""}
              </p>
              <time
                className="text-sm"
                dateTime={publicGamePlayedDate(g) || undefined}
              >
                {publicGameScheduleLabel(g)}
              </time>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              {g.result && (
                <strong>
                  {g.result.home} – {g.result.away}
                </strong>
              )}
              {g.youtube &&
                youtubeWatchUrlSchema.safeParse(g.youtube).success && (
                  <a
                    className="inline-flex min-h-11 items-center underline"
                    href={g.youtube}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {g.completed ? "Watch replay" : "Watch on YouTube"}
                  </a>
                )}
            </div>
          </article>
        ))}
        {!filtered.length && (
          <p className="py-4">
            No{" "}
            {selectedMode === "results"
              ? "results"
              : selectedMode === "recent"
                ? "recent games"
                : "upcoming games"}{" "}
            for this selection.
          </p>
        )}
      </div>
    </section>
  );
}
