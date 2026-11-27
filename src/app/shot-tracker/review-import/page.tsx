"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { localReviewSchema } from "@/lib/curlcoach/local-review";
import { readResumeStore } from "@/lib/curlcoach/resume-storage";

const importPath = "/shot-tracker/review-import";
const storageKey = (id: string) => `curlcoach-review-import:${id}`;
const shotsSchema = z.object({
  revision: z.number().int(),
  eventId: z.string().optional(),
  players: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  accountScope: z
    .object({ actorId: z.string(), organizationId: z.string() })
    .optional(),
  shots: z.array(
    z.object({
      id: z.uuid(),
      playerId: z.string().optional(),
      end: z.number(),
      stone: z.number(),
      position: z.string(),
      player: z.string(),
      note: z.string(),
      flagged: z.boolean().optional(),
    }),
  ),
});
const problemSchema = z.object({ error: z.string().min(1).max(300) });
export default function LocalReviewImport() {
  const [review, setReview] = useState<z.infer<
    typeof localReviewSchema
  > | null>(null);
  const [data, setData] = useState<z.infer<typeof shotsSchema> | null>(null);
  const [shotId, setShotId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  async function responseError(response: Response, fallback: string) {
    const problem = problemSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (response.status === 403 && !problem.success) {
      setData(null);
      setNeedsSignIn(true);
      return Error("Sign in with access to this game to continue.");
    }
    return Error(problem.success ? problem.data.error : fallback);
  }
  async function load(gameId: string) {
    setNeedsSignIn(false);
    const response = await fetch(
      `/api/curlcoach/local-review?game=${encodeURIComponent(gameId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      setData(null);
      throw await responseError(
        response,
        "Could not load this game's shots. Tap Reload shots to retry.",
      );
    }
    const loaded = shotsSchema.parse(await response.json());
    setData(loaded);
    if (loaded.accountScope) {
      const stored = readResumeStore(localStorage, loaded.accountScope);
      const current = stored.drafts.find(
        (draft) => draft.gameId === gameId && draft.source === "streamer",
      );
      if (current && Date.now() - current.updatedAt < 2 * 60 * 60 * 1000) {
        const match = loaded.shots.find((shot) =>
          current.editing
            ? shot.id === current.editing
            : shot.playerId === current.draft.playerId &&
              shot.end === current.draft.end &&
              shot.stone === current.draft.stone &&
              shot.position === current.draft.position,
        );
        if (match) setShotId((existing) => existing || match.id);
      }
    }
  }
  useEffect(() => {
    try {
      if (location.hash.length > 16000) throw Error();
      const resume = new URLSearchParams(location.search).get("resume");
      const raw = location.hash
        ? decodeURIComponent(location.hash.slice(1))
        : sessionStorage.getItem(storageKey(z.uuid().parse(resume)));
      if (!raw || raw.length > 16000) throw Error();
      const parsed = localReviewSchema.parse(JSON.parse(raw));
      if (!location.hash && parsed.id !== resume) throw Error();
      setReview(parsed);
      void load(parsed.gameId).catch((e) => setError(e.message));
    } catch {
      setError(
        "This review link is incomplete. Return to the local phone page and select the start again.",
      );
    }
  }, []);
  const shot = data?.shots.find((shot) => shot.id === shotId);
  const player = data?.players.find((p) => p.id === playerId);
  const canSave =
    !!data && (shotId ? !!shot : review?.audience === "team" || !!player);
  async function save() {
    if (!review || !data || !canSave) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/curlcoach/local-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review,
          shotId: shotId || null,
          ...(!shotId && review.audience === "player" ? { playerId } : {}),
          expectedRevision: data.revision,
        }),
      });
      if (!response.ok)
        throw await responseError(response, "Could not save flag.");
      setSaved(true);
      history.replaceState(null, "", location.pathname);
      try {
        sessionStorage.removeItem(storageKey(review.id));
      } catch {
        // Browser storage may be unavailable when saving directly from the link.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save flag.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl p-4 space-y-4">
      <h1 className="text-2xl font-bold">Save shot review</h1>
      {saved ? (
        <>
          <p>
            Flag saved for the{" "}
            {review?.audience === "team"
              ? "team"
              : (shot?.player ?? player?.name)}
            . It will appear with the available recording link in the
            appropriate report.
          </p>
          <a
            className="btn min-h-11"
            href={`/shot-tracker?${new URLSearchParams({ source: "streamer", event: data?.eventId ?? "standalone", game: review!.gameId })}#analysis/flagged`}
          >
            View saved flags
          </a>
        </>
      ) : (
        <>
          {review && (
            <>
              <p>
                Selected camera moment:{" "}
                {new Date(review.selectedAt).toLocaleTimeString()}.
                Recording-link timing is estimated.
              </p>
              {needsSignIn && (
                <a
                  className="btn min-h-11"
                  href={`/login?${new URLSearchParams({ next: `${importPath}?resume=${review.id}` })}`}
                  onClick={(event) => {
                    try {
                      sessionStorage.setItem(
                        storageKey(review.id),
                        JSON.stringify(review),
                      );
                    } catch {
                      event.preventDefault();
                      setError(
                        "Sign in in another tab, then return here and tap Reload shots.",
                      );
                    }
                  }}
                >
                  Sign in to continue
                </a>
              )}
              <label className="block">
                Recorded shot
                <select
                  className="block w-full min-h-11"
                  value={shotId}
                  onChange={(e) => setShotId(e.target.value)}
                >
                  <option value="">
                    Standalone video flag (no charted shot)
                  </option>
                  {data?.shots.map((shot) => (
                    <option key={shot.id} value={shot.id}>
                      {shot.player} · End {shot.end} · Rock {shot.stone}
                    </option>
                  ))}
                </select>
              </label>
              {data && !data.shots.length && (
                <p>
                  No shots have been charted. You can still save a Team flag or
                  choose a player below.
                </p>
              )}
              <label className="block">
                Review for
                <select
                  className="block w-full min-h-11"
                  value={review.audience}
                  onChange={(e) =>
                    setReview({
                      ...review,
                      audience: e.target.value as "player" | "team",
                    })
                  }
                >
                  <option value="player">{shot?.player ?? "Player"}</option>
                  <option value="team">Team</option>
                </select>
              </label>
              {!shotId && review.audience === "player" && (
                <label className="block">
                  Player
                  <select
                    className="block w-full min-h-11"
                    value={playerId}
                    aria-label="Player"
                    onChange={(e) => setPlayerId(e.target.value)}
                  >
                    <option value="">Choose player</option>
                    {data?.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {data && !data.players.length && (
                    <p>
                      No players are configured. Choose Team, or add your roster
                      in Account &amp; Settings.
                    </p>
                  )}
                </label>
              )}
              {!canSave && data && !shotId && review.audience === "player" && (
                <p role="status">
                  Choose a player, or switch Review for to Team, to save.
                </p>
              )}
              <label className="block">
                Notes
                <textarea
                  className="block w-full min-h-24"
                  maxLength={2000}
                  value={review.notes}
                  onChange={(e) =>
                    setReview({ ...review, notes: e.target.value })
                  }
                />
              </label>
              {(shot?.note || shot?.flagged) && (
                <p>
                  This replaces the selected shot’s review time, audience and
                  notes. Existing note: {shot.note || "None"}. Its score stays
                  unchanged.
                </p>
              )}
              <button
                className="btn min-h-11"
                disabled={busy || !canSave}
                onClick={save}
              >
                {busy ? "Saving…" : "Save flag"}
              </button>
              <button
                className="btn min-h-11"
                disabled={busy}
                onClick={() => {
                  setError("");
                  void load(review.gameId).catch((e) => setError(e.message));
                }}
              >
                Reload shots
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </main>
  );
}
