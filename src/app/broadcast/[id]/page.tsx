"use client";
import { use, useEffect, useState } from "react";
import { useGame } from "@/components/GameSync";
import { BroadcastCanvas } from "@/components/BroadcastCanvas";
import { useStudioPreviewMode } from "@/components/StudioPreviewMode";
import { StudioProgramPreview } from "@/components/StudioProgramPreview";
import { BroadcastOperatorNavigation } from "@/components/BroadcastOperatorNavigation";
import { AppNavigation } from "@/components/AppNavigation";
import { BroadcastCameraZoomControls } from "@/components/CameraZoomControls";
import { hasOrganizerAccess, hasScoringAccess } from "@/lib/access-session";
import { gameEntryPresentation, gameEntryCapabilities } from "@/lib/game-entry";
import { GameReadScreen } from "@/components/GameReadScreen";
import "@/components/game-entry.css";

import { CompletedGameSummary } from "@/components/CompletedGameSummary";

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
  const directPreview = useStudioPreviewMode();
  const {
    game,
    completion,
    error,
    accountRole,
    navigationMetadata,
    refreshContext,
  } = useGame(id, "broadcast", undefined, true);
  const [scale, setScale] = useState<number>();
  const [compact, setCompact] = useState(false);
  const [operator, setOperator] = useState(false);
  const zoomRail =
    Boolean(game) &&
    (operator || ["owner", "team_admin", "scorer"].includes(accountRole));
  useEffect(() => setOperator(hasScoringAccess(localStorage, id)), [id]);
  useEffect(() => {
    const fit = () => {
      const viewport = availableViewport();
      const narrow = viewport.width <= 700;
      setCompact(narrow);
      setScale(
        Math.min(
          Math.max(1, viewport.width - (zoomRail && !narrow ? 272 : 0)) /
            PROGRAM_WIDTH,
          Math.max(1, viewport.height - (zoomRail && narrow ? 300 : 0)) /
            PROGRAM_HEIGHT,
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
  }, [zoomRail]);
  if (error || (!game && !completion))
    return (
      <GameReadScreen
        label="Broadcast preview"
        error={error}
        retry={refreshContext}
      />
    );
  const presentation = game
    ? gameEntryPresentation(game.config, navigationMetadata)
    : undefined;
  const capabilities = gameEntryCapabilities(
    accountRole,
    operator && hasOrganizerAccess(localStorage, id),
    operator,
    game?.config.awayName === "Opponent TBD",
  );
  return (
    <main className="broadcast-viewport">
      <BroadcastOperatorNavigation
        id={id}
        accountOperator={capabilities.scoring}
      />
      {game && presentation && capabilities.broadcast && (
        <>
          <AppNavigation
            signedIn={accountRole ? true : undefined}
            className="broadcast-app-navigation"
            gameContext={{ id, ...presentation, capabilities }}
          />
        </>
      )}
      {zoomRail && <BroadcastCameraZoomControls id={id} />}
      <div
        data-testid="broadcast-visible-wrapper"
        className="broadcast-visible-wrapper"
        style={
          scale === undefined
            ? { visibility: "hidden" }
            : {
                width: PROGRAM_WIDTH * scale,
                height: PROGRAM_HEIGHT * scale,
                marginLeft: zoomRail && !compact ? 272 : 0,
                marginBottom: zoomRail && compact ? 300 : 0,
              }
        }
      >
        <div
          data-testid="broadcast-fixed-canvas"
          className="broadcast-fixed-canvas"
          style={{ transform: `scale(${scale ?? 1})` }}
        >
          {completion ? (
            <div
              data-testid="broadcast-canvas"
              className="flex aspect-video w-full items-center justify-center bg-[radial-gradient(circle_at_top,#164e63,#07111f_55%)] p-24"
            >
              <div className="w-full max-w-4xl">
                <CompletedGameSummary gameId={id} completion={completion} />
              </div>
            </div>
          ) : game ? (
            directPreview ? (
              <StudioProgramPreview gameId={id} />
            ) : (
              <BroadcastCanvas game={game} />
            )
          ) : null}
        </div>
      </div>
    </main>
  );
}
