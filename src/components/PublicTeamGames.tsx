"use client";
import React, { useState } from "react";

export type PublicGame = {
  id: string;
  home: string;
  away: string;
  event: string | null;
  event_id?: string | null;
  number: number | null;
  scheduled: string | null;
  completed: string | null;
  result: { home: number; away: number } | null;
  youtube: string | null;
};
export function filterPublicGames(
  games: PublicGame[],
  mode: string,
  event: string,
) {
  return games
    .filter(
      (g) =>
        Boolean(g.completed) === (mode === "results") &&
        (!event || g.event_id === event),
    )
    .sort((a, b) => {
      const stamp = (g: PublicGame) =>
        Date.parse((mode === "results" ? g.completed : g.scheduled) || "") || 0;
      return mode === "results" ? stamp(b) - stamp(a) : stamp(a) - stamp(b);
    });
}
export function PublicTeamGames({
  games,
  teamName = "Team",
  upcoming,
  results,
}: {
  games: PublicGame[];
  teamName?: string;
  upcoming: boolean;
  results: boolean;
}) {
  const [mode, setMode] = useState(upcoming ? "upcoming" : "results");
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
  const filtered = filterPublicGames(allowed, mode, event);
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
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
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
          <article key={g.id} className="public-game-row">
            <div className="min-w-0">
              <strong className="line-clamp-2" title={`${g.home} vs ${g.away}`}>
                {g.home} vs {g.away}
              </strong>
              <p className="truncate">
                {g.event || "Single game"}
                {g.number ? ` · Game ${g.number}` : ""}
              </p>
              <time className="text-sm">
                {g.completed || g.scheduled
                  ? new Date((g.completed || g.scheduled)!).toLocaleDateString(
                      "en-CA",
                      { timeZone: "UTC" },
                    )
                  : "Date to be announced"}
              </time>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              {g.result && (
                <strong>
                  {g.result.home} – {g.result.away}
                </strong>
              )}
              {g.youtube &&
                /^https:\/\/www.youtube.com\/watch\?v=/.test(g.youtube) && (
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
            No {mode === "results" ? "results" : "upcoming games"} for this
            selection.
          </p>
        )}
      </div>
    </section>
  );
}
