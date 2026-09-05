"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useGame } from "@/components/GameSync";
import type { Role } from "@/lib/types";
import { cameraDisplayStatus } from "@/lib/camera-status";
import { AppNavigation } from "@/components/AppNavigation";
import { canonicalTitleFromConfig } from "@/lib/game-title";
import { gameCapabilities } from "@/lib/current-game";
import { canManageCompletion, hasOrganizerAccess } from "@/lib/access-session";
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
  const { game, completion, error, refresh, accountOperator, accountRole } =
    useGame(id);
  const [finished, setFinished] = useState<SafeGameCompletion>();
  const [finishedCleanup, setFinishedCleanup] = useState<CompletionCleanup>();
  const [organizerAccess, setOrganizerAccess] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Role>();
  const [cameraActionError, setCameraActionError] = useState("");
  useEffect(
    () => setOrganizerAccess(hasOrganizerAccess(localStorage, id)),
    [id],
  );
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
  if (error) return <main className="p-8">{error}</main>;
  if (!game) return <main className="p-8">Loading game…</main>;
  const title = canonicalTitleFromConfig(game.config);
  return (
    <main className="mx-auto max-w-5xl p-5">
      <div className="mb-4">
        <AppNavigation
          gameContext={{
            id,
            title,
            scheduledLabel: "Schedule not set",
            capabilities: gameCapabilities(
              accountRole || (organizerAccess ? "organizer" : "scorer"),
              game.config.awayName === "Opponent TBD",
            ),
          }}
        />
      </div>
      <p className="text-cyan-300">GAME CONTROL</p>
      <h1 className="text-4xl font-black">{title}</h1>
      <p className="text-slate-300">
        {game.config.homeName} vs {game.config.awayName} ·{" "}
        {game.config.scheduledEnds} ends
      </p>
      <GameInvitations
        id={id}
        enabled={accountOperator || organizerAccess}
        claims={game.claims}
        connectedDevices={
          <section className="panel min-w-0">
            <h2 className="mb-3 text-xl font-bold">Connected devices</h2>
            <div className="grid gap-3">
              {(["camera-home", "camera-away", "scorer"] as const).map(
                (role) => (
                  <div
                    key={role}
                    className="btn-secondary flex min-h-11 items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <strong>
                        {role === "camera-home"
                          ? "Camera 1"
                          : role === "camera-away"
                            ? "Camera 2"
                            : "Scorekeeper + Audio"}
                      </strong>
                      <span className="ml-3 text-cyan-200">
                        {role === "scorer"
                          ? game.claims.scorer
                            ? "Claimed"
                            : "Not connected"
                          : cameraDisplayStatus(game, role)}
                      </span>
                      {role !== "scorer" && game.cameraHealth?.[role] && (
                        <small className="block overflow-hidden text-ellipsis text-slate-400">
                          {game.cameraHealth[role]?.diagnostic
                            ? `${game.cameraHealth[role]?.diagnostic} · `
                            : ""}
                          Updated{" "}
                          {new Date(
                            game.cameraHealth[role]!.updatedAt,
                          ).toLocaleTimeString()}
                        </small>
                      )}
                    </div>
                    {role !== "scorer" && game.claims[role] && (
                      <button
                        className="min-h-11 shrink-0 rounded-lg border border-red-700 px-3 text-red-200"
                        disabled={disconnecting === role}
                        onClick={() => {
                          const live = (
                            ["Connecting", "Live", "Reconnecting"] as string[]
                          ).includes(cameraDisplayStatus(game, role));
                          void cameraAction(role, !live);
                        }}
                      >
                        {(
                          ["Connecting", "Live", "Reconnecting"] as string[]
                        ).includes(cameraDisplayStatus(game, role))
                          ? "Disconnect Camera"
                          : "Release Camera"}
                      </button>
                    )}
                  </div>
                ),
              )}
            </div>
            {cameraActionError && (
              <p role="alert" className="mt-3 text-amber-300">
                {cameraActionError}
              </p>
            )}
          </section>
        }
      />
      <section className="panel mt-5">
        <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Active Sponsor Library</h2>
            <p className="text-slate-300">
              {game.sponsors.filter((sponsor) => sponsor.enabled).length} images
              available for display and rotation.
            </p>
          </div>
          {accountOperator && (
            <Link className="btn-secondary" href="/sponsors">
              Manage Sponsors
            </Link>
          )}
        </div>
        <h2 className="text-xl font-bold">Game actions</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {accountOperator && (
            <Link
              className="btn-secondary"
              href={`/games/${id}/edit`}
              aria-label={`Edit Schedule: ${title}`}
            >
              Edit Schedule
            </Link>
          )}
          <Link
            className="btn"
            href={`/score/${id}`}
            aria-label={`Scoring: ${title}`}
          >
            Open scoring
          </Link>
          <Link
            className="btn-secondary"
            href={`/broadcast/${id}`}
            aria-label={`Broadcast: ${title}`}
          >
            Broadcast preview
          </Link>
          <EndGameControl
            gameId={id}
            homeName={game.config.homeName}
            awayName={game.config.awayName}
            enabled={
              ["owner", "team_admin"].includes(accountRole) || organizerAccess
            }
            onCompleted={(value, cleanup) => {
              setFinished(value);
              setFinishedCleanup(cleanup);
            }}
          />
        </div>
      </section>
    </main>
  );
}
