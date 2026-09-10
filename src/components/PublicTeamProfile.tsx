"use client";
import { useState } from "react";
import {
  throwingPositions,
  type TeamPageSettings,
} from "@/lib/team-page-settings";
export type TeamAccomplishment = {
  id: string;
  name: string;
  end_date: string;
  result: "1st" | "2nd" | "3rd" | "qualified";
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
                      ? "Skip (" + position + ")"
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
          <ul className="grid gap-4">
            {accomplishments.map((event) => (
              <li key={event.id} className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden="true">
                  {medals[event.result]}
                </span>
                <div>
                  <strong className="block">{event.name}</strong>
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
