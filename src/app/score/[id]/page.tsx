"use client";
import { TeamLogo } from "@/components/TeamLogo";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useGame } from "@/components/GameSync";
import { ScoringSummary } from "@/components/ScoringSummary";
import { ScoringProgramControls } from "@/components/ScoringProgramControls";
import "./scoring.css";
import { GameSetupNavigation } from "@/components/GameSetupNavigation";
import { activeEvents, deriveScore, type ScoringAction } from "@/lib/scoring";
import type { Team } from "@/lib/types";
import { AppNavigation } from "@/components/AppNavigation";
import { gameEntryPresentation } from "@/lib/game-entry";
import { gameCapabilities } from "@/lib/current-game";
import { canManageCompletion, hasOrganizerAccess } from "@/lib/access-session";
import { CompletedGameSummary } from "@/components/CompletedGameSummary";
import { EndGameControl } from "@/components/EndGameControl";
import type {
  CompletionCleanup,
  SafeGameCompletion,
} from "@/lib/game-completion";
import { StudioDeviceCards } from "@/components/StudioDeviceCards";
import { StudioYouTube } from "@/components/StudioYouTube";
import { StudioAudio } from "@/components/StudioAudio";
import { cameraAudioEnabled } from "@/lib/camera-audio";
import { BroadcastControl } from "@/components/BroadcastControl";
export default function Scorer({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    game,
    completion,
    error,
    act,
    accountOperator,
    m1Pilot,
    accountRole,
    navigationMetadata,
    refreshContext,
    refresh,
  } = useGame(id, undefined, undefined, true);
  const [points, setPoints] = useState(1);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(navigator.userAgent.includes("CurlStreamerStudio/0.3"));
  }, []);
  const [team, setTeam] = useState<Team>("home");
  const scoringFlight = useRef(false);
  const [scoringBusy, setScoringBusy] = useState(false);
  const [scoringError, setScoringError] = useState("");
  const [scoringNotice, setScoringNotice] = useState("");
  const [failedAction, setFailedAction] = useState<ScoringAction>();
  const [correctingHammer, setCorrectingHammer] = useState(false);
  const [organizerAccess, setOrganizerAccess] = useState(false);
  const [finished, setFinished] = useState<SafeGameCompletion>();
  const [finishedCleanup, setFinishedCleanup] = useState<CompletionCleanup>();
  useEffect(
    () => setOrganizerAccess(hasOrganizerAccess(localStorage, id)),
    [id],
  );
  const completed = completion ?? finished;
  useEffect(() => {
    if (
      (!game && !completed) ||
      !desktop ||
      !m1Pilot ||
      (!accountOperator && !organizerAccess)
    )
      return;
    const shell = (
      window as unknown as {
        chrome?: { webview?: { postMessage(value: unknown): void } };
      }
    ).chrome?.webview;
    shell?.postMessage({
      type: completed ? "studio-game-ended" : "studio-game-ready",
      gameId: id,
    });
  }, [
    id,
    Boolean(game),
    Boolean(completed),
    desktop,
    m1Pilot,
    accountOperator,
    organizerAccess,
  ]);
  const canEndGame = canManageCompletion(accountRole, organizerAccess);
  if (completed)
    return (
      <main className="mx-auto max-w-3xl p-5">
        <CompletedGameSummary
          gameId={id}
          completion={completed}
          cleanupControls={canEndGame}
          initialCleanup={finishedCleanup}
        />
      </main>
    );
  if (error)
    return (
      <main className="scoring-workspace mx-auto max-w-xl">
        <AppNavigation />
        <section className="scoring-card mt-5" role="alert">
          <h1 className="text-xl font-bold">Scoring unavailable</h1>
          <p className="mt-3 text-slate-300">{error}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="btn" onClick={() => void refreshContext()}>
              Try again
            </button>
            <Link
              className="btn-secondary inline-flex min-h-11 items-center"
              href="/dashboard"
            >
              Back to games
            </Link>
          </div>
        </section>
      </main>
    );
  if (!game) return <main className="p-8">Loading controls…</main>;
  const cameraAudio = Object.fromEntries(
    (["camera-home", "camera-away"] as const).map((role) => [
      role,
      {
        ...game.cameraAudio?.[role],
        enabled: cameraAudioEnabled(game, role),
        status: game.cameraAudio?.[role]?.status ?? "off",
        updatedAt: game.cameraAudio?.[role]?.updatedAt ?? 0,
      },
    ]),
  );
  if (game.config.awayName === "Opponent TBD")
    return (
      <main className="scoring-workspace mx-auto max-w-3xl p-5">
        <div className="mb-4">
          <AppNavigation
            signedIn={accountRole ? true : undefined}
            gameContext={{
              id,
              title: gameEntryPresentation(game.config, navigationMetadata)
                .title,
              scheduledLabel: gameEntryPresentation(
                game.config,
                navigationMetadata,
              ).scheduledLabel,
              capabilities: gameCapabilities(
                accountRole ||
                  (hasOrganizerAccess(localStorage, id)
                    ? "organizer"
                    : "scorer"),
                game.config.awayName === "Opponent TBD",
              ),
            }}
          />
        </div>
        <section className="scoring-card" role="alert">
          <h1 className="text-xl font-bold">
            {gameEntryPresentation(game.config, navigationMetadata).title}
          </h1>
          <p className="mt-2 text-slate-300">
            Game saved. Assign the opponent when ready to begin scoring.
          </p>
          {canManageCompletion(accountRole, organizerAccess) ? (
            <Link className="btn mt-4 inline-flex" href={`/games/${id}/edit`}>
              Assign opponent
            </Link>
          ) : (
            <p className="mt-4">
              Ask the organizer to assign the opponent. You can return to your
              games while they update it.
            </p>
          )}
          <Link
            className="btn-secondary mt-4 ml-2 inline-flex min-h-11 items-center"
            href="/dashboard"
          >
            Back to games
          </Link>
        </section>
      </main>
    );
  if (game.status === "closed")
    return (
      <main className="mx-auto max-w-lg p-5">
        <div className="mb-3">
          <AppNavigation
            signedIn={accountRole ? true : undefined}
            gameContext={{
              id,
              title: gameEntryPresentation(game.config, navigationMetadata)
                .title,
              scheduledLabel: gameEntryPresentation(
                game.config,
                navigationMetadata,
              ).scheduledLabel,
              capabilities: gameCapabilities(
                accountRole ||
                  (hasOrganizerAccess(localStorage, id)
                    ? "organizer"
                    : "scorer"),
                game.config.awayName === "Opponent TBD",
              ),
            }}
          />
        </div>
        <div role="alert" className="panel text-center">
          <h1 className="text-2xl font-black">This game is closed</h1>
          <p className="mt-2 text-slate-300">
            Scoring and audio access have been revoked.
          </p>
        </div>
      </main>
    );
  const title = gameEntryPresentation(game.config, navigationMetadata).title;
  const score = deriveScore(game);
  const undoTarget = activeEvents(game.scoreEvents).at(-1);
  const expectedLastEventId = game.scoreEvents.at(-1)?.id ?? null;
  const scoringLocked = scoringBusy || Boolean(failedAction);
  function successMessage(action: ScoringAction) {
    if (action.type === "undo")
      return "Undo saved. The prior change remains in history and is no longer active.";
    if (action.type === "hammer") return "Hammer saved.";
    return `End ${action.expectedEnd} saved.`;
  }
  async function runScoringAction(action: ScoringAction) {
    if (scoringFlight.current) return;
    scoringFlight.current = true;
    setScoringBusy(true);
    setScoringError("");
    setScoringNotice("");
    try {
      await act(action);
      setFailedAction(undefined);
      setScoringNotice(successMessage(action));
      if (action.type === "hammer") setCorrectingHammer(false);
    } catch (error) {
      setFailedAction(action);
      setScoringError(
        error instanceof Error
          ? error.message
          : "The scoring change could not be saved.",
      );
    } finally {
      scoringFlight.current = false;
      setScoringBusy(false);
    }
  }
  function newIntent() {
    return crypto.randomUUID();
  }
  function saveHammer(next: Team) {
    return runScoringAction({
      type: "hammer",
      team: next,
      intentId: newIntent(),
      expectedEnd: score.currentEnd,
      expectedLastEventId,
    });
  }
  return (
    <main
      className={
        "scoring-workspace mx-auto max-w-6xl" +
        (desktop ? " scoring-desktop" : "") +
        (!canEndGame ? " scoring-remote" : "")
      }
    >
      <header className="scoring-page-heading">
        <div className="scoring-navigation">
          <AppNavigation
            signedIn={accountRole ? true : undefined}
            gameContext={{
              id,
              title: gameEntryPresentation(game.config, navigationMetadata)
                .title,
              scheduledLabel: gameEntryPresentation(
                game.config,
                navigationMetadata,
              ).scheduledLabel,
              capabilities: gameCapabilities(
                accountRole ||
                  (hasOrganizerAccess(localStorage, id)
                    ? "organizer"
                    : "scorer"),
                game.config.awayName === "Opponent TBD",
              ),
            }}
          />
          {!desktop && (
            <GameSetupNavigation id={id} accountOperator={accountOperator} />
          )}
        </div>
        <div className="scoring-title-block">
          <p className="scoring-eyebrow">
            {desktop ? "Selected game" : "Match control"}
          </p>
          <h1>
            {desktop
              ? `${game.config.homeName} vs ${game.config.awayName} — ${game.config.eventName || "Single Game"}`
              : "Scoring"}
            <TeamLogo
              teamName={game.config.homeName}
              imageUrl={game.config.homeLogoUrl}
              className="ml-3 inline-block h-10 w-10 align-middle"
            />
          </h1>
          {!desktop && <p className="scoring-match-title">{title}</p>}
          <p className="text-sm text-slate-300" aria-label="Game schedule">
            {
              gameEntryPresentation(game.config, navigationMetadata)
                .scheduledLabel
            }
          </p>
        </div>
        {canEndGame && (
          <div className="scoring-page-actions">
            <Link
              className="btn-secondary"
              href={`/broadcast/${id}`}
              aria-label={`Broadcast: ${title}`}
            >
              Show broadcast
            </Link>
            {desktop && canEndGame && (
              <div className="scoring-header-finish">
                <EndGameControl
                  gameId={id}
                  homeName={game.config.homeName}
                  awayName={game.config.awayName}
                  enabled
                  disabled={scoringLocked}
                  onCompleted={(value, cleanup) => {
                    setFinished(value);
                    setFinishedCleanup(cleanup);
                  }}
                />
              </div>
            )}
            {!desktop && (
              <a className="btn-secondary" href="#program-controls">
                Broadcast controls ↓
              </a>
            )}
          </div>
        )}
      </header>
      <div className="scoring-columns">
        <div className="scoring-main">
          <ScoringSummary game={game} />
          {!score.hammer ? (
            <section
              className="scoring-card scoring-entry"
              aria-labelledby="initial-hammer-heading"
            >
              <h2 id="initial-hammer-heading" className="text-xl font-bold">
                Who has hammer in End 1?
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {(["home", "away"] as const).map((side) => (
                  <button
                    key={side}
                    disabled={scoringLocked}
                    className="min-h-14 rounded-lg border-2 px-4 py-3 text-lg font-bold disabled:opacity-50"
                    style={{
                      borderColor:
                        side === "home"
                          ? game.config.homeColor
                          : game.config.awayColor,
                    }}
                    onClick={() => saveHammer(side)}
                  >
                    {side === "home"
                      ? game.config.homeName
                      : game.config.awayName}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section
              className="scoring-card scoring-entry"
              aria-labelledby="record-end-heading"
            >
              <div className="scoring-section-heading">
                <h2 id="record-end-heading">Record End {score.currentEnd}</h2>
                <span className="scoring-eyebrow">Score entry</span>
              </div>
              <p className="scoring-field-label">Which team scored?</p>
              <div
                className="scoring-team-picker"
                role="group"
                aria-label="Scoring team"
              >
                <button
                  disabled={scoringLocked}
                  onClick={() => setTeam("home")}
                  aria-pressed={team === "home"}
                  className="scoring-team-choice"
                >
                  {game.config.homeName}
                </button>
                <button
                  disabled={scoringLocked}
                  onClick={() => setTeam("away")}
                  aria-pressed={team === "away"}
                  className="scoring-team-choice"
                >
                  {game.config.awayName}
                </button>
              </div>
              <p className="scoring-field-label">Points scored</p>
              <div
                className="scoring-points"
                role="group"
                aria-label="Points scored"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                  <button
                    key={value}
                    disabled={scoringLocked}
                    aria-pressed={points === value}
                    aria-label={`${value} point${value === 1 ? "" : "s"}`}
                    onClick={() => setPoints(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <p className="scoring-save-preview">
                {game.config[`${team}Name`]} · {points} point
                {points === 1 ? "" : "s"}
              </p>
              <div className="scoring-action-row mt-3 grid grid-cols-2 gap-2">
                <button
                  disabled={scoringLocked}
                  className="btn"
                  onClick={() =>
                    runScoringAction({
                      type: "score",
                      intentId: newIntent(),
                      expectedEnd: score.currentEnd,
                      expectedLastEventId,
                      team,
                      points,
                      blank: false,
                    })
                  }
                >
                  Save {points} point{points > 1 ? "s" : ""}
                </button>
                <button
                  disabled={scoringLocked}
                  className="btn-secondary"
                  onClick={() =>
                    runScoringAction({
                      type: "score",
                      intentId: newIntent(),
                      expectedEnd: score.currentEnd,
                      expectedLastEventId,
                      team: null,
                      points: 0,
                      blank: true,
                    })
                  }
                >
                  Blank end
                </button>
                <button
                  disabled={scoringLocked || !undoTarget}
                  className="btn-secondary"
                  onClick={() =>
                    undoTarget &&
                    runScoringAction({
                      type: "undo",
                      intentId: newIntent(),
                      expectedLastEventId,
                      expectedTargetId: undoTarget.id,
                    })
                  }
                >
                  Undo last scoring change
                </button>
                <button
                  disabled={scoringLocked}
                  className="btn-secondary"
                  aria-expanded={correctingHammer}
                  onClick={() => setCorrectingHammer(!correctingHammer)}
                >
                  Correct Hammer
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-300">
                {undoTarget?.type === "end"
                  ? `Undo will reverse End ${undoTarget.score.end} while keeping its history.`
                  : undoTarget?.type === "hammer"
                    ? "Undo will reverse the latest hammer selection while keeping its history."
                    : "There is no scoring change to undo."}
              </p>
              {correctingHammer && (
                <div
                  className="mt-4 rounded-lg border border-slate-600 p-3"
                  role="group"
                  aria-labelledby="correct-hammer-heading"
                >
                  <h3 id="correct-hammer-heading" className="font-bold">
                    Confirm which team has hammer
                  </h3>
                  <p className="mt-1 text-sm text-slate-300">
                    This correction does not change the score or end.
                  </p>
                  <div className="scoring-action-row mt-3 grid grid-cols-2 gap-2">
                    {(["home", "away"] as const).map((side) => (
                      <button
                        key={side}
                        disabled={scoringLocked}
                        className="btn-secondary"
                        onClick={() => saveHammer(side)}
                      >
                        Confirm{" "}
                        {side === "home"
                          ? game.config.homeName
                          : game.config.awayName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
          {scoringBusy && (
            <p
              role="status"
              aria-label="Scoring update"
              className="scoring-feedback"
            >
              Saving scoring change…
            </p>
          )}
          {scoringError && (
            <div
              role="alert"
              aria-label="Scoring error"
              className="scoring-feedback scoring-feedback-error"
            >
              <p>{scoringError}</p>
              <p className="mt-2 text-sm">
                Retry will safely repeat this same scoring change.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  disabled={scoringBusy}
                  className="btn-secondary"
                  onClick={() => failedAction && runScoringAction(failedAction)}
                >
                  {scoringBusy ? "Retrying…" : "Retry same change"}
                </button>
                <button
                  disabled={scoringBusy}
                  className="btn-secondary"
                  onClick={() => {
                    setFailedAction(undefined);
                    setScoringError("");
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {scoringNotice && (
            <p
              role="status"
              aria-label="Scoring update"
              className="scoring-feedback scoring-feedback-success"
            >
              {scoringNotice}
            </p>
          )}
        </div>
        {canEndGame && (
          <aside
            id="program-controls"
            tabIndex={-1}
            className="scoring-sidebar"
            aria-label="Broadcast and program controls"
          >
            {desktop ? (
              <>
                {desktop && (
                  <div className="scoring-control-tiles">
                    <ScoringProgramControls game={game} act={act} compact />
                    {canEndGame && <StudioYouTube id={id} />}
                  </div>
                )}
              </>
            ) : (
              <>
                {canEndGame && <BroadcastControl gameId={id} enabled />}
                <ScoringProgramControls game={game} act={act} />
              </>
            )}
            {desktop && canEndGame && <StudioAudio id={id} />}
            {!desktop && canEndGame && (
              <div className="scoring-card scoring-finish">
                {!desktop && (
                  <>
                    <h2 className="font-bold">Finish the game</h2>
                    <p className="mb-3 mt-2 text-sm text-slate-300">
                      Review and confirm the saved final score before ending the
                      game.
                    </p>
                  </>
                )}
                <EndGameControl
                  gameId={id}
                  homeName={game.config.homeName}
                  awayName={game.config.awayName}
                  enabled
                  disabled={scoringLocked}
                  onCompleted={(value, cleanup) => {
                    setFinished(value);
                    setFinishedCleanup(cleanup);
                  }}
                />
              </div>
            )}
          </aside>
        )}
      </div>
      {desktop && (
        <div className="scoring-device-dock">
          {canEndGame && m1Pilot && (
            <section id="devices" aria-label="Connected devices">
              <StudioDeviceCards
                id={id}
                claims={game.claims}
                cameraAudio={cameraAudio}
                layout={game.layout}
                onLayout={async (layout) => {
                  await act({ type: "layout", layout });
                }}
                onAudio={async (role, enabled, volume) => {
                  await act({ type: "camera-audio", role, enabled, volume });
                }}
                onChanged={refresh}
                enabled
              />
            </section>
          )}
        </div>
      )}
    </main>
  );
}
