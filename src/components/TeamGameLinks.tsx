"use client";

import Link from "next/link";
export function TeamGameLinks({ gameId }: { gameId: string }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/games/${gameId}`}
      >
        Open Game
      </Link>
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/games/${gameId}/edit`}
      >
        Edit Schedule
      </Link>
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/score/${gameId}`}
      >
        Scoring
      </Link>
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/broadcast/${gameId}`}
      >
        Broadcast
      </Link>
    </div>
  );
}
