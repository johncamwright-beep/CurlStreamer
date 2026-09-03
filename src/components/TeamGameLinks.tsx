"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { hasOrganizerAccess } from "@/lib/access-session";

export function TeamGameLinks({ gameId }: { gameId: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(
    () => setAvailable(hasOrganizerAccess(localStorage, gameId)),
    [gameId],
  );
  if (!available) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/games/${gameId}`}
      >
        Setup
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
