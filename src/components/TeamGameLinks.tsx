"use client";

import Link from "next/link";
export function TeamGameLinks({
  gameId,
  title,
}: {
  gameId: string;
  title: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/games/${gameId}`}
        aria-label={`Open Game: ${title}`}
      >
        Open Game
      </Link>
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/games/${gameId}/edit`}
        aria-label={`Edit Schedule: ${title}`}
      >
        Edit Schedule
      </Link>
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/score/${gameId}`}
        aria-label={`Scoring: ${title}`}
      >
        Scoring
      </Link>
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/broadcast/${gameId}`}
        aria-label={`Broadcast: ${title}`}
      >
        Broadcast
      </Link>
    </div>
  );
}
