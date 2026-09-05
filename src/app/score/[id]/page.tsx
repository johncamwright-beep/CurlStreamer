"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useGame } from "@/components/GameSync";
import { Scoreboard } from "@/components/Scoreboard";
import { GameSetupNavigation } from "@/components/GameSetupNavigation";
import { deriveScore } from "@/lib/scoring";
import type { Team } from "@/lib/types";
import { hasVisibleSponsorOverlay } from "@/lib/sponsor-audio";
import { AppNavigation } from "@/components/AppNavigation";
import { canonicalTitleFromConfig } from "@/lib/game-title";
import { gameCapabilities } from "@/lib/current-game";
import { hasOrganizerAccess } from "@/lib/access-session";
import { CompletedGameSummary } from "@/components/CompletedGameSummary";
export default function Scorer({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { game, completion, error, act, accountOperator, accountRole } =
    useGame(id);
  const [points, setPoints] = useState(1);
  const [team, setTeam] = useState<Team>("home");
  const [hammerBusy, setHammerBusy] = useState(false);
  const [hammerError, setHammerError] = useState("");
  const [correctingHammer, setCorrectingHammer] = useState(false);
  if (completion)
    return (
      <main className="mx-auto max-w-3xl p-5">
        <CompletedGameSummary gameId={id} completion={completion} />
      </main>
    );
  if (error)
    return (
      <main role="alert" className="p-8">
        {error}
      </main>
    );
  if (!game) return <main className="p-8">Loading controls…</main>;
  if (game.config.awayName === "Opponent TBD")
    return (
      <main className="mx-auto max-w-xl p-5">
        <div className="mb-4">
          <AppNavigation
            gameContext={{
              id,
              title: canonicalTitleFromConfig(game.config),
              scheduledLabel: "Schedule not set",
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
        <section className="panel" role="alert">
          <h1 className="text-3xl font-black">
            Assign opponent before scoring
          </h1>
          <p className="mt-3">
            This game is scheduled with Opponent TBD. Assign the actual opponent
            before scoring begins.
          </p>
          <Link className="btn mt-4 inline-flex" href={`/games/${id}/edit`}>
            Edit Schedule
          </Link>
        </section>
      </main>
    );
  if (game.status === "closed")
    return (
      <main className="mx-auto max-w-lg p-5">
        <div className="mb-3">
          <AppNavigation
            gameContext={{
              id,
              title: canonicalTitleFromConfig(game.config),
              scheduledLabel: "Schedule not set",
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
  const enabled = game.sponsors.filter((s) => s.enabled);
  const title = canonicalTitleFromConfig(game.config);
  const score = deriveScore(game);
  async function saveHammer(next: Team) {
    setHammerBusy(true);
    setHammerError("");
    try {
      await act({ type: "hammer", team: next });
      setCorrectingHammer(false);
    } catch (error) {
      setHammerError(
        error instanceof Error ? error.message : "Hammer could not be saved.",
      );
    } finally {
      setHammerBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-6xl p-4">
      <div className="mb-3">
        <AppNavigation
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
      </div>
      <div className="mb-3">
        <GameSetupNavigation id={id} accountOperator={accountOperator} />
      </div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-cyan-300">SCORER · MOCK MODE</p>
          <h1 className="text-3xl font-black">{title}</h1>
        </div>
        <Link
          className="btn-secondary"
          href={`/broadcast/${id}`}
          aria-label={`Broadcast: ${title}`}
        >
          Open program preview
        </Link>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-4">
          <Scoreboard game={game} />
          {!score.hammer ? (
            <div className="panel" aria-labelledby="initial-hammer-heading">
              <h2 id="initial-hammer-heading" className="text-xl font-bold">
                Who has hammer in End 1?
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {(["home", "away"] as const).map((side) => (
                  <button
                    key={side}
                    disabled={hammerBusy}
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
              {hammerError && (
                <p role="alert" className="mt-3 text-red-300">
                  {hammerError}
                </p>
              )}
            </div>
          ) : (
            <div className="panel">
              <h2 className="text-xl font-bold">Record this end</h2>
              <div className="my-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTeam("home")}
                  className={team === "home" ? "btn" : "btn-secondary"}
                >
                  {game.config.homeName}
                </button>
                <button
                  onClick={() => setTeam("away")}
                  className={team === "away" ? "btn" : "btn-secondary"}
                >
                  {game.config.awayName}
                </button>
              </div>
              <label>
                Points
                <select
                  value={points}
                  onChange={(e) => setPoints(+e.target.value)}
                  className="ml-3 rounded-lg bg-slate-800 px-4"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="btn"
                  onClick={() =>
                    act({ type: "score", team, points, blank: false })
                  }
                >
                  Save {points} point{points > 1 ? "s" : ""}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    act({ type: "score", team: null, points: 0, blank: true })
                  }
                >
                  Blank end
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => act({ type: "undo" })}
                >
                  ↶ Undo
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setCorrectingHammer(true)}
                >
                  Correct Hammer
                </button>
              </div>
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
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(["home", "away"] as const).map((side) => (
                      <button
                        key={side}
                        disabled={hammerBusy}
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
                  {hammerError && (
                    <p role="alert" className="mt-3 text-red-300">
                      {hammerError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="panel">
            <h2 className="font-bold">Program controls</h2>
            <div className="my-3 grid grid-cols-3 gap-2">
              {(["split", "home", "away"] as const).map((x) => (
                <button
                  className={game.layout === x ? "btn" : "btn-secondary"}
                  onClick={() => act({ type: "layout", layout: x })}
                  key={x}
                >
                  {x}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => act({ type: "audio", muted: !game.audioMuted })}
                className={
                  game.audioMuted ? "btn-secondary flex-1" : "btn flex-1"
                }
              >
                {game.audioMuted ? "Audio muted" : "MICROPHONES LIVE"}
              </button>
              <button
                onClick={() =>
                  game.broadcast === "live"
                    ? confirm("Stop the live broadcast?") &&
                      act({ type: "broadcast", value: "idle" })
                    : act({ type: "broadcast", value: "live" })
                }
                className="btn-secondary flex-1"
              >
                {game.broadcast === "live"
                  ? "Stop Broadcast"
                  : "Start Broadcast"}
              </button>
            </div>
            <p className="mt-2 text-sm text-amber-200">
              External USB audio is simulated. Never assume the phone microphone
              is safe.
            </p>
          </div>
        </section>
        <section className="space-y-4">
          <div className="panel">
            <div className="flex justify-between">
              <div>
                <h2 className="text-xl font-bold">Sponsor carousel</h2>
                <p className="text-sm text-slate-300">
                  {enabled.length} active organization sponsor
                  {enabled.length === 1 ? "" : "s"}
                </p>
              </div>
              <span
                className={
                  game.sponsorMode.active
                    ? "text-emerald-300"
                    : "text-slate-400"
                }
              >
                {game.sponsorMode.active ? "● LIVE" : "Off"}
              </span>
            </div>
            <div className="my-3 grid grid-cols-2 gap-2">
              <select
                value={game.sponsorMode.style}
                onChange={(e) =>
                  act({
                    type: "sponsor-mode",
                    active: game.sponsorMode.active,
                    style: e.target.value,
                  })
                }
                className="rounded-lg bg-slate-800 p-3"
              >
                <option value="fullscreen">Sponsors Sidebar</option>
                <option value="overlay">Sponsors Overlay</option>
              </select>
              <label className="rounded-lg bg-slate-800 px-3">
                Seconds{" "}
                <input
                  type="number"
                  min="3"
                  max="10"
                  value={game.sponsorMode.intervalSeconds}
                  onChange={(e) =>
                    act({
                      type: "sponsor-mode",
                      active: false,
                      intervalSeconds: +e.target.value,
                    })
                  }
                  className="w-12 bg-transparent"
                />
              </label>
            </div>
            <button
              disabled={!enabled.length}
              onClick={() =>
                act({ type: "sponsor-mode", active: !game.sponsorMode.active })
              }
              className="btn w-full text-lg"
            >
              {game.sponsorMode.active ? "Stop carousel" : "Start carousel"}
            </button>
            {!enabled.length && (
              <p className="mt-2 text-amber-200">
                No active organization sponsors are available. Manage sponsors
                from Plan &amp; Schedule.
              </p>
            )}
            {game.sponsorMode.active && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  className="btn-secondary"
                  onClick={() => act({ type: "sponsor-nav", direction: -1 })}
                >
                  Previous
                </button>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    act({
                      type: "sponsor-nav",
                      paused: !game.sponsorMode.paused,
                    })
                  }
                >
                  {game.sponsorMode.paused ? "Resume" : "Pause"}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => act({ type: "sponsor-nav", direction: 1 })}
                >
                  Next
                </button>
              </div>
            )}
            {hasVisibleSponsorOverlay(game) && (
              <p className="mt-2 font-bold text-amber-300">
                Sponsor Overlay is temporarily muting scorer audio. A manual
                mute will remain in place after it closes.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
