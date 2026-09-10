"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useGame } from "@/components/GameSync";
import type { Role } from "@/lib/types";
import { cameraDisplayStatus } from "@/lib/camera-status";
import { AppNavigation } from "@/components/AppNavigation";
import { gameEntryPresentation, gameEntryCapabilities } from "@/lib/game-entry";
import { GameReadScreen } from "@/components/GameReadScreen";
import "@/components/game-entry.css";

import {
  canManageCompletion,
  hasOrganizerAccess,
  hasScoringAccess,
} from "@/lib/access-session";
import { GameInvitations } from "@/components/GameInvitations";
import { EndGameControl } from "@/components/EndGameControl";
import { CompletedGameSummary } from "@/components/CompletedGameSummary";
import type {
  CompletionCleanup,
  SafeGameCompletion,
} from "@/lib/game-completion";
export default function GameLobby({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const {
    game,
    completion,
    error,
    refresh,
    accountRole,
    m1Pilot,
    navigationMetadata,
    refreshContext,
  } = useGame(id, undefined, undefined, true);
  const [finished, setFinished] = useState<SafeGameCompletion>();
  const [finishedCleanup, setFinishedCleanup] = useState<CompletionCleanup>();
  const [organizerAccess, setOrganizerAccess] = useState(false);
  const [scoringAccess, setScoringAccess] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Role>();
  const [cameraActionError, setCameraActionError] = useState("");
  useEffect(() => {
    setDesktop(navigator.userAgent.includes("CurlStreamerStudio/0.3"));
    setOrganizerAccess(hasOrganizerAccess(localStorage, id));
    setScoringAccess(hasScoringAccess(localStorage, id));
  }, [id]);
  useEffect(() => {
    if (
      desktop &&
      game &&
      !completion &&
      (organizerAccess ||
        scoringAccess ||
        ["owner", "team_admin", "scorer"].includes(accountRole))
    )
      router.replace("/score/" + id);
  }, [
    game,
    desktop,
    completion,
    organizerAccess,
    scoringAccess,
    accountRole,
    id,
    router,
  ]);
  async function cameraAction(
    role: "camera-home" | "camera-away",
    release: boolean,
  ) {
    const camera = role === "camera-home" ? "Camera 1" : "Camera 2";
    if (!confirm(`${release ? "Release" : "Disconnect"} ${camera}?`)) return;
    setDisconnecting(role);
    setCameraActionError("");
    try {
      const token = localStorage.getItem(`curlcast-access-${id}`);
      const response = await fetch(
        `/api/games/${id}/${release ? "release-camera" : "disconnect-camera"}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ role }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || "Camera could not be released.");
      }
      if (body?.warning) setCameraActionError(body.warning);
      await refresh();
    } catch (cause) {
      setCameraActionError(
        cause instanceof Error
          ? cause.message
          : "Camera could not be released.",
      );
    } finally {
      setDisconnecting(undefined);
    }
  }
  const completed = completion ?? finished;
  if (
    desktop &&
    game &&
    !completed &&
    (organizerAccess ||
      scoringAccess ||
      ["owner", "team_admin", "scorer"].includes(accountRole))
  )
    return <GameReadScreen label="Opening game" retry={refreshContext} />;
  if (completed)
    return (
      <main className="mx-auto max-w-3xl p-5">
        <CompletedGameSummary
          gameId={id}
          completion={completed}
          cleanupControls={canManageCompletion(accountRole, organizerAccess)}
          initialCleanup={finishedCleanup}
        />
      </main>
    );
  if (error || !game)
    return <GameReadScreen label="Game" error={error} retry={refreshContext} />;
  const { title, scheduledLabel } = gameEntryPresentation(
    game.config,
    navigationMetadata,
  );
  const capabilities = gameEntryCapabilities(
    accountRole,
    organizerAccess,
    scoringAccess,
    game.config.awayName === "Opponent TBD",
  );
  const canInvite =
    organizerAccess || ["owner", "team_admin", "scorer"].includes(accountRole);
  return (
    <main className="game-control-page">
      <div className="game-control-inner">
        <AppNavigation
          signedIn={accountRole ? true : undefined}
          gameContext={{ id, title, scheduledLabel, capabilities }}
        />
        <header className="game-control-heading">
          <p className="game-entry-eyebrow">Game control</p>
          <h1>{title}</h1>
          <p aria-label="Game schedule">
            {scheduledLabel} · {game.config.scheduledEnds} ends
          </p>
          <nav className="game-entry-actions" aria-label="Primary game actions">
            {capabilities.control && (
              <Link className="btn" href={`/games/${id}/studio`}>
                Set up Windows Studio
              </Link>
            )}
            {capabilities.scoring && (
              <Link className="btn" href={`/score/${id}`}>
                Open scoring
              </Link>
            )}
            {capabilities.assignOpponent && (
              <Link className="btn" href={`/games/${id}/edit`}>
                Assign opponent
              </Link>
            )}
            {capabilities.broadcast && (
              <Link className="btn-secondary" href={`/broadcast/${id}`}>
                Broadcast preview
              </Link>
            )}
            {capabilities.editSchedule && !capabilities.assignOpponent && (
              <Link className="btn-secondary" href={`/games/${id}/edit`}>
                Edit game
              </Link>
            )}
            {!capabilities.scoring && !capabilities.assignOpponent && (
              <Link className="btn-secondary" href="/dashboard">
                Back to games
              </Link>
            )}
          </nav>
          {!capabilities.scoring && (
            <p>
              {game.config.awayName === "Opponent TBD"
                ? "An organizer must assign the opponent before scoring can begin."
                : "Scoring and broadcast controls require scorer or organizer access. Use the invitation for your role, or ask the organizer for help."}
            </p>
          )}
        </header>
        <section
          className="game-control-card"
          aria-labelledby="readiness-heading"
        >
          <h2 id="readiness-heading">Device readiness</h2>
          <p>
            Camera reports are separate from the program preview and YouTube
            delivery. Check the picture in Broadcast preview before going live.
          </p>
          <div className="game-readiness-grid">
            {(["camera-home", "camera-away"] as const).map((role) => {
              const directPilot = m1Pilot && role === "camera-home";
              const status = cameraDisplayStatus(game, role);
              const stale =
                game.cameraHealth?.[role] &&
                Date.now() - game.cameraHealth[role]!.updatedAt > 75000;
              const label = stale
                ? "Status out of date"
                : status === "Live"
                  ? "Reporting video"
                  : status;
              const live = (
                ["Connecting", "Live", "Reconnecting"] as string[]
              ).includes(status);
              return (
                <div className="game-readiness-device" key={role}>
                  <h3>{role === "camera-home" ? "Camera 1" : "Camera 2"}</h3>
                  <strong>
                    {directPilot
                      ? game.claims[role]
                        ? "Claimed · see PC receiver"
                        : "Not claimed"
                      : label}
                  </strong>
                  <p>
                    {directPilot
                      ? "The claim shows assignment only. Check the received picture and connection in the PC receiver."
                      : stale
                        ? "Open the camera phone and check its connection. Its last report is no longer current."
                        : status === "Unclaimed"
                          ? canInvite
                            ? "Create an invitation below and open it on the camera phone."
                            : "Ask the organizer for a camera invitation."
                          : status === "Live"
                            ? "Keep the camera page open. Confirm the received picture in the preview."
                            : "Open the camera page on the assigned phone and reconnect. Ask the organizer to release the role if you need a different device."}
                  </p>
                  {directPilot && (
                    <Link
                      className="btn-secondary"
                      href={`/studio-spike/${id}`}
                    >
                      PC receiver
                    </Link>
                  )}
                  {!directPilot && game.cameraHealth?.[role] && (
                    <small>
                      Last report{" "}
                      {new Date(
                        game.cameraHealth[role]!.updatedAt,
                      ).toLocaleTimeString()}
                    </small>
                  )}
                  {canInvite && game.claims[role] && (
                    <button
                      disabled={Boolean(disconnecting)}
                      onClick={() => void cameraAction(role, !live)}
                    >
                      {disconnecting === role
                        ? "Updating…"
                        : live
                          ? "Disconnect camera"
                          : "Release camera"}
                    </button>
                  )}
                </div>
              );
            })}
            <div className="game-readiness-device">
              <h3>Scorekeeper</h3>
              <strong>
                {game.claims.scorer ? "Role claimed" : "Role available"}
              </strong>
              <p>
                A claimed role does not confirm that the phone is online. Audio
                delivery is not verified here.
              </p>
              <p>
                {capabilities.scoring
                  ? "Open scoring above to operate this game."
                  : "Use a scorer invitation or ask the organizer for access."}
              </p>
            </div>
          </div>
          {cameraActionError && (
            <p role="alert" className="mt-4">
              {cameraActionError} Check the latest device status before trying
              the action again.
            </p>
          )}
          <div className="game-entry-actions">
            <button
              className="btn-secondary"
              onClick={() => void refreshContext()}
            >
              Refresh game details
            </button>
          </div>
        </section>
        <details className="game-control-setup">
          <summary>Invite devices & camera setup</summary>
          <p>
            Use a separate phone for each camera. Open the role invitation on
            the device that will do that job.
          </p>
          {canInvite ? (
            <GameInvitations
              id={id}
              enabled
              claims={game.claims}
              connectedDevices={
                <section className="panel">
                  <h2 className="text-xl font-bold">Changing a camera phone</h2>
                  <p className="mt-3 text-slate-300">
                    Release its role above, then create a fresh invitation for
                    the replacement phone. Keep camera video upright; verify the
                    picture in the preview.
                  </p>
                </section>
              }
            />
          ) : (
            <p>
              Only an account scorer or organizer can create invitations. Ask
              them to send the link for your device.
            </p>
          )}
        </details>
        <section className="game-control-card">
          <h2>Game management</h2>
          <p>
            {game.sponsors.filter((sponsor) => sponsor.enabled).length} sponsor
            images enabled. Display settings stay in scoring.
          </p>
          <div className="game-entry-actions">
            {canInvite && accountRole && (
              <Link className="btn-secondary" href="/sponsors">
                Manage sponsors
              </Link>
            )}
            <EndGameControl
              gameId={id}
              homeName={game.config.homeName}
              awayName={game.config.awayName}
              enabled={canManageCompletion(accountRole, organizerAccess)}
              onCompleted={(value, cleanup) => {
                setFinished(value);
                setFinishedCleanup(cleanup);
              }}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
