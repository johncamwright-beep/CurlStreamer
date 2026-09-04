"use client";

import Link from "next/link";
import { selectCurrentGame } from "@/lib/current-game";
export function TeamGameLinks({
  gameId,
  title,
  scheduledLabel = "Schedule not set",
  role = "scorer",
  opponentTbd = false,
}: {
  gameId: string;
  title: string;
  scheduledLabel?: string;
  role?: string;
  opponentTbd?: boolean;
}) {
  const access = ["owner", "team_admin"].includes(role)
    ? "organizer"
    : "scorer";
  const select = () =>
    selectCurrentGame(localStorage, {
      id: gameId,
      title,
      scheduledLabel,
      access,
    });
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/games/${gameId}`}
        aria-label={`Open Game: ${title}`}
        onClick={select}
      >
        Open Game
      </Link>
      {["owner", "team_admin"].includes(role) && (
        <Link
          className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
          href={`/games/${gameId}/edit`}
          aria-label={`Edit Schedule: ${title}`}
          onClick={select}
        >
          Edit Schedule
        </Link>
      )}
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={opponentTbd ? `/games/${gameId}/edit` : `/score/${gameId}`}
        aria-label={`${opponentTbd ? "Assign Opponent" : "Scoring"}: ${title}`}
        onClick={select}
      >
        {opponentTbd ? "Assign Opponent" : "Scoring"}
      </Link>
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={`/broadcast/${gameId}`}
        aria-label={`Broadcast: ${title}`}
        onClick={select}
      >
        Broadcast
      </Link>
    </div>
  );
}
