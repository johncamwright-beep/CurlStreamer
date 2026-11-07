"use client";

import Link from "next/link";
import { selectCurrentGame } from "@/lib/current-game";
export function TeamGameLinks({
  gameId,
  title,
  scheduledLabel = "Schedule not set",
  role = "scorer",
  opponentTbd = false,
  compact = false,
}: {
  gameId: string;
  title: string;
  scheduledLabel?: string;
  role?: string;
  opponentTbd?: boolean;
  compact?: boolean;
}) {
  const gameOperator = ["owner", "team_admin", "game_operator"].includes(role);
  const select = () =>
    selectCurrentGame(localStorage, {
      id: gameId,
      title,
      scheduledLabel,
      capabilities: {
        control: gameOperator,
        scoring: !opponentTbd,
        broadcast: true,
        editSchedule: gameOperator,
        assignOpponent: opponentTbd && gameOperator,
      },
    });
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link
        className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
        href={compact && !opponentTbd ? `/score/${gameId}` : `/games/${gameId}`}
        aria-label={`Open Game: ${title}`}
        onClick={select}
      >
        Open Game
      </Link>
      {gameOperator && !compact && (
        <Link
          className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
          href={`/games/${gameId}/edit`}
          aria-label={`Edit game: ${title}`}
          onClick={select}
        >
          Edit game
        </Link>
      )}
      {!compact && (!opponentTbd || gameOperator) && (
        <Link
          className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
          href={opponentTbd ? `/games/${gameId}/edit` : `/score/${gameId}`}
          aria-label={`${opponentTbd ? "Assign Opponent" : "Scoring"}: ${title}`}
          onClick={select}
        >
          {opponentTbd ? "Assign Opponent" : "Scoring"}
        </Link>
      )}
      {!compact && (
        <Link
          className="min-h-11 rounded-lg bg-slate-700 px-3 py-3"
          href={`/broadcast/${gameId}`}
          aria-label={`Broadcast: ${title}`}
          onClick={select}
        >
          Broadcast
        </Link>
      )}
    </div>
  );
}
