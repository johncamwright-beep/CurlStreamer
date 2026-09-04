"use client";
import { use, useEffect, useState } from "react";
import { useGame } from "@/components/GameSync";
import { BroadcastCanvas } from "@/components/BroadcastCanvas";
import { BroadcastOperatorNavigation } from "@/components/BroadcastOperatorNavigation";
import { AppNavigation } from "@/components/AppNavigation";
import { hasOrganizerAccess, hasScoringAccess } from "@/lib/access-session";
import { canonicalTitleFromConfig } from "@/lib/game-title";
import { gameCapabilities } from "@/lib/current-game";

const PROGRAM_WIDTH = 1920;
const PROGRAM_HEIGHT = 1080;

function availableViewport() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}
export default function Broadcast({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { game, error, accountOperator, accountRole } = useGame(
    id,
    "broadcast",
  );
  const [scale, setScale] = useState<number>();
  const [operator, setOperator] = useState(false);
  useEffect(() => setOperator(hasScoringAccess(localStorage, id)), [id]);
  useEffect(() => {
    const fit = () => {
      const viewport = availableViewport();
      setScale(
        Math.min(
          viewport.width / PROGRAM_WIDTH,
          viewport.height / PROGRAM_HEIGHT,
        ),
      );
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, []);
  if (error)
    return (
      <main role="alert" className="p-8">
        {error}
      </main>
    );
  if (!game) return <main className="p-8">Loading 1920×1080 program…</main>;
  return (
    <main className="broadcast-viewport">
      <BroadcastOperatorNavigation id={id} accountOperator={accountOperator} />
      {(operator || accountOperator) && (
        <AppNavigation
          className="broadcast-app-navigation"
          gameContext={{
            id,
            title: canonicalTitleFromConfig(game.config),
            scheduledLabel: "Schedule not set",
            capabilities: gameCapabilities(
              accountRole ||
                (hasOrganizerAccess(localStorage, id) ? "organizer" : "scorer"),
              game.config.awayName === "Opponent TBD",
            ),
          }}
        />
      )}
      <div
        data-testid="broadcast-visible-wrapper"
        className="broadcast-visible-wrapper"
        style={
          scale === undefined
            ? { visibility: "hidden" }
            : {
                width: PROGRAM_WIDTH * scale,
                height: PROGRAM_HEIGHT * scale,
              }
        }
      >
        <div
          data-testid="broadcast-fixed-canvas"
          className="broadcast-fixed-canvas"
          style={{ transform: `scale(${scale ?? 1})` }}
        >
          <BroadcastCanvas game={game} />
        </div>
      </div>
    </main>
  );
}
