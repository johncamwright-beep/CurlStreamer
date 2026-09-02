import { deriveScore } from "@/lib/scoring";
import type { GameState } from "@/lib/types";
export function Scoreboard({
  game,
  compact = false,
}: {
  game: GameState;
  compact?: boolean;
}) {
  const s = deriveScore(game);
  return (
    <div className={compact ? "rounded-xl bg-slate-950/90 p-3" : "panel"}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-widest text-cyan-300">
          END {s.currentEnd}
        </span>
        <span className="text-xs">HAMMER · {s.hammer.toUpperCase()}</span>
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
          <strong className={compact ? "text-lg" : "text-2xl"}>
            {t === "home" ? game.config.homeName : game.config.awayName}
          </strong>
          <strong className={compact ? "text-2xl" : "text-4xl"}>
            {s.totals[t]}
          </strong>
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
