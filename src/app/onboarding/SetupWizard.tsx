"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TeamSettings } from "@/components/TeamSettings";
import { OnboardingSeasonEvent } from "@/components/OnboardingSeasonEvent";
import { GameCreationForm } from "@/app/games/new/GameCreationForm";
import type {
  SeasonRecord,
  EventRecord,
  ScheduledGameRecord,
} from "@/lib/team-hierarchy-data";
import type { SetupProgress } from "@/lib/onboarding";
import { saveSetupProgress } from "./actions";

const steps = [
  "Your team",
  "Your public page",
  "Your season",
  "Your first event",
  "Broadcast setup",
  "Your first game",
];
export function SetupWizard({
  initial,
  teamName,
  seasons,
  events,
  games,
  opponents,
  youtube,
}: {
  initial: SetupProgress;
  teamName: string;
  seasons: SeasonRecord[];
  events: EventRecord[];
  games: ScheduledGameRecord[];
  opponents: { id: string; display_name: string }[];
  youtube: ReactNode;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(next: SetupProgress, leave = false) {
    setBusy(true);
    setError("");
    try {
      const result = await saveSetupProgress(next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setProgress(next);
      if (leave) router.push("/dashboard");
      else {
        if (!next.complete) router.refresh();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Progress could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const next = (extra: Partial<SetupProgress> = {}) =>
    void save({
      ...progress,
      ...(extra.seasonId && extra.seasonId !== progress.seasonId
        ? { eventId: undefined }
        : {}),
      ...extra,
      step: Math.min(6, progress.step + 1),
    });
  if (progress.complete)
    return (
      <section className="panel grid gap-4">
        <h1 className="text-3xl font-black">Ready to get started</h1>
        <p>
          Your saved settings are available in Account &amp; Settings. You can
          add more games and finish any skipped details whenever you are ready.
        </p>
        {progress.gameId && (
          <Link className="btn text-center" href={`/score/${progress.gameId}`}>
            Open your first game
          </Link>
        )}
        <Link className="btn-secondary text-center" href="/dashboard">
          Go to your games
        </Link>
      </section>
    );
  return (
    <div className="grid gap-5">
      <header className="panel grid gap-3">
        <p className="font-bold text-cyan-300">
          Welcome to CurlStreamer · Step {progress.step} of 6
        </p>
        <h1 className="text-3xl font-black">{steps[progress.step - 1]}</h1>
        <ol
          className="flex flex-wrap gap-3 text-sm"
          aria-label="Setup progress"
        >
          {steps.map((label, i) => (
            <li
              key={label}
              aria-current={progress.step === i + 1 ? "step" : undefined}
              className={
                progress.step === i + 1
                  ? "font-bold text-cyan-300"
                  : "text-slate-300"
              }
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>
        <p className="text-slate-300">
          Save each step to keep your changes. You can leave and resume this
          walkthrough from your dashboard.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg bg-red-950 p-4 text-red-200">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="panel min-w-0 grid gap-5">
        {progress.step <= 2 && (
          <>
            {progress.step === 2 && (
              <p>
                Choose your team address and colours. Preview before publishing:
                once published, the subdomain address cannot be changed.
                Publishing is optional during setup.
              </p>
            )}
            <TeamSettings
              key={progress.step}
              name={teamName}
              section={progress.step === 1 ? "team" : "public"}
              onSaved={() => next()}
            />
          </>
        )}
        {(progress.step === 3 || progress.step === 4) && (
          <OnboardingSeasonEvent
            key={progress.step}
            step={progress.step === 3 ? "season" : "event"}
            seasons={seasons}
            events={events}
            seasonId={progress.seasonId}
            eventId={progress.eventId}
            onSaved={(value) => next(value)}
          />
        )}
        {progress.step === 5 && (
          <>
            <h2 className="text-xl font-bold">What you need at the rink</h2>
            <p className="rounded-xl border border-cyan-700 bg-cyan-950 p-4">
              You can manage your account, public team page, sponsors, and game
              schedule in any browser. To start a broadcast, install
              CurlStreamer Studio on a Windows PC and connect your rink network.
              You can skip this step until that computer is ready.
            </p>
            <p>
              During the pilot, your CurlStreamer contact supplies the Windows
              installer. There is no public download yet. You can finish your
              team setup and schedule games before installing Studio.
            </p>
            <ul className="list-disc space-y-3 pl-5">
              <li>A Windows computer running CurlStreamer Studio.</li>
              <li>
                A travel router to connect the computer and camera phones on the
                same local network, with internet access for YouTube.
              </li>
              <li>
                One or two camera phones, stable mounts, and power for the game.
              </li>
              <li>
                Optional microphones and a compatible USB receiver for player
                audio.
              </li>
            </ul>
            <p>
              Connect your YouTube channel below. After connecting, use Resume
              team setup on your dashboard to return here. Camera pairing and
              audio checks happen from the game screen in Studio.
            </p>
            {youtube}
            <button className="btn" onClick={() => next()}>
              Continue to your first game
            </button>
          </>
        )}
        {progress.step === 6 && (
          <>
            <p>
              Schedule your first game. Eastern (Toronto) is the default
              timezone. Creating a scheduled YouTube link does not start
              broadcasting.
            </p>
            <GameCreationForm
              teamName={teamName}
              seasons={seasons}
              events={events}
              opponents={opponents}
              games={games}
              preselectedEventId={progress.eventId}
              preselectedSeasonId={progress.seasonId}
              onCreated={(gameId) =>
                void save({ ...progress, gameId, complete: true })
              }
            />
          </>
        )}
      </fieldset>
      <footer className="flex flex-wrap gap-3">
        <button
          className="btn-secondary"
          disabled={busy || progress.step === 1}
          onClick={() => void save({ ...progress, step: progress.step - 1 })}
        >
          Back
        </button>
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() =>
            progress.step === 6
              ? void save({ ...progress, complete: true })
              : next()
          }
        >
          Skip for now
        </button>
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() => void save(progress, true)}
        >
          {busy ? "Saving progress…" : "Save progress and exit"}
        </button>
      </footer>
      <p className="text-sm text-slate-400">
        Back, Skip, and Exit keep previously saved details; save any changes in
        the current form first.
      </p>
    </div>
  );
}
