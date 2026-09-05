import React from "react";
import { deriveScore } from "@/lib/scoring";
import type { GameState } from "@/lib/types";
import type { BroadcastGame } from "@/lib/game-projection";
import { HammerIcon } from "./HammerIcon";
export function Scoreboard({
  game,
  compact = false,
  broadcast = false,
}: {
  game: GameState | BroadcastGame;
  compact?: boolean;
  broadcast?: boolean;
}) {
  const s = "score" in game ? { ...game.score, ends: [] } : deriveScore(game);
  return (
    <div
      data-testid={broadcast ? "broadcast-scoreboard" : undefined}
      className={`${compact ? "rounded-xl bg-slate-950/90 p-3" : "panel"} ${broadcast ? "broadcast-scoreboard" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-widest text-cyan-300">
          END {s.currentEnd}
        </span>
      </div>
      {(["home", "away"] as const).map((t) => (
        <div
          key={t}
          className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3 border-l-4 pl-3"
          style={{
            borderColor:
              t === "home" ? game.config.homeColor : game.config.awayColor,
          }}
        >
          <strong
            className={`${compact ? "text-lg" : "text-2xl"} min-w-0 truncate`}
          >
            {t === "home" ? game.config.homeName : game.config.awayName}
          </strong>
          <span className="flex items-center gap-2">
            {s.hammer === t && (
              <HammerIcon
                compact={compact}
                label={`${
                  t === "home" ? game.config.homeName : game.config.awayName
                }: Last stone advantage (Hammer)`}
              />
            )}
            <strong className={compact ? "text-2xl" : "text-4xl"}>
              {s.totals[t]}
            </strong>
          </span>
        </div>
      ))}
      {!compact && (
        <div className="mt-3 flex gap-1 overflow-hidden text-xs">
          {s.ends.map((e) => (
            <span key={e.end} className="rounded bg-slate-800 px-2 py-1">
              {e.end}:{" "}
              {e.blank ? "–" : `${e.team?.[0].toUpperCase()} ${e.points}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
