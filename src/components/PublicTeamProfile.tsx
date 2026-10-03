"use client";
import React, { useState } from "react";
import {
  throwingPositions,
  type TeamPageSettings,
} from "@/lib/team-page-settings";
export type TeamAccomplishment = {
  id: string;
  name: string;
  end_date: string;
  result: "1st" | "2nd" | "3rd" | "qualified";
  level: "U15" | "U18" | "U20" | "U25" | "Men’s" | "Women’s" | null;
  show_level: boolean;
};
const medals = { "1st": "🥇", "2nd": "🥈", "3rd": "🥉", qualified: "★" };
export function PublicTeamProfile({
  settings: s,
  logo,
  accomplishments,
}: {
  settings: TeamPageSettings;
  logo: string | null;
  accomplishments: TeamAccomplishment[];
}) {
  const [expanded, setExpanded] = useState(false);
  const currentYear = new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZone: "America/Toronto",
  }).format(new Date());
  const [year, setYear] = useState(currentYear);
  const years = Array.from(
    new Set([
      currentYear,
      ...accomplishments.map((event) => event.end_date.slice(0, 4)),
    ]),
  ).sort((a, b) => Number(b) - Number(a));
  const visibleAccomplishments = accomplishments.filter(
    (event) => year === "all" || event.end_date.slice(0, 4) === year,
  );
  const long = s.description.length > 220;
  return (
    <aside className="public-team-profile panel" aria-label="Team profile">
      <h2 className="text-center text-2xl font-black">{s.name}</h2>
      {logo && (
        <img
          src={logo}
          alt={s.name + " logo"}
          className="mx-auto my-4 h-36 w-full object-contain"
        />
      )}
      {s.description && (
        <section className="mt-4">
          <h3 className="mb-2 font-bold">About the team</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {long && !expanded
              ? s.description.slice(0, 220) + "…"
              : s.description}
          </p>
          {long && (
            <button
              className="min-h-11 text-cyan-300 underline"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Less" : "More…"}
            </button>
          )}
        </section>
      )}
      {s.photo && (
        <img
          src={s.photo}
          alt={s.name + " team photo"}
          className="mt-5 aspect-video w-full rounded-lg object-cover object-center"
        />
      )}
      {throwingPositions.some((position) => s.roster[position]) && (
        <section className="mt-5 border-t border-slate-700 pt-4">
          <h3 className="mb-3 font-bold">Players</h3>
          <dl className="grid gap-3">
            {throwingPositions
              .filter((position) => s.roster[position])
              .map((position) => (
                <div
                  key={position}
                  className="grid grid-cols-[100px_minmax(0,1fr)] gap-3"
                >
                  <dt className="text-sm text-slate-400">
                    {s.roster.skip === position
                      ? "Skip (" +
                        position[0].toUpperCase() +
                        position.slice(1) +
                        ")"
                      : position[0].toUpperCase() + position.slice(1)}
                  </dt>
                  <dd className="break-words font-semibold">
                    {s.roster[position]}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      )}
      {s.accomplishments && accomplishments.length > 0 && (
        <section className="mt-5 border-t border-slate-700 pt-4">
          <h3 className="mb-3 font-bold">Accomplishments</h3>
          <label className="mb-4 block text-sm">
            Year
            <select
              aria-label="Accomplishments year"
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-500 bg-slate-900 px-3 text-white"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
              <option value="all">All years</option>
            </select>
          </label>
          {visibleAccomplishments.length === 0 && (
            <p className="text-sm" role="status">
              No accomplishments recorded for {year}.
            </p>
          )}
          <ul className="grid gap-4">
            {visibleAccomplishments.map((event) => (
              <li key={event.id} className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden="true">
                  {medals[event.result]}
                </span>
                <div>
                  <strong className="block">
                    {event.name}
                    {event.show_level && event.level ? ` · ${event.level}` : ""}
                  </strong>
                  <span className="text-sm text-slate-300">
                    {event.result === "qualified"
                      ? "Qualified"
                      : event.result + " place"}
                    {event.end_date ? " · " + event.end_date.slice(0, 4) : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.socials && (s.facebook || s.instagram) && (
        <section
          className="mt-5 flex flex-wrap gap-4 border-t border-slate-700 pt-3"
          aria-label="Social profiles"
        >
          {s.facebook && (
            <a
              href={s.facebook}
              className="inline-flex min-h-11 items-center text-cyan-300 underline"
              target="_blank"
              rel="noreferrer"
            >
              Facebook
            </a>
          )}
          {s.instagram && (
            <a
              href={s.instagram}
              className="inline-flex min-h-11 items-center text-cyan-300 underline"
              target="_blank"
              rel="noreferrer"
            >
              Instagram
            </a>
          )}
        </section>
      )}
    </aside>
  );
}
