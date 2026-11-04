"use client";
import { useEffect, useRef, useState } from "react";
import type { CelebrationHeadshotLibrary } from "@/lib/celebration-headshots";
import {
  prepareHeadshot,
  renderHeadshot,
  headshotPng,
  type PreparedHeadshot,
  type HeadshotAdjustment,
} from "@/lib/prepare-celebration-headshot";
export function CelebrationHeadshotSetup({
  onSaved,
  gameId,
  token,
}: {
  onSaved?: (library: CelebrationHeadshotLibrary) => void;
  gameId?: string;
  token?: string;
} = {}) {
  const [library, setLibrary] = useState<CelebrationHeadshotLibrary | null>(
    null,
  );
  const [playerId, setPlayerId] = useState("");
  const [coachName, setCoachName] = useState("");
  const selectedPerson = library?.players.find(
    (player) => player.id === playerId,
  );
  const isCoach = playerId === "new-coach" || selectedPerson?.kind === "coach";
  const [prepared, setPrepared] = useState<PreparedHeadshot | null>(null);
  const [adjustment, setAdjustment] = useState<HeadshotAdjustment>({
    x: 0.5,
    y: 0.4,
    size: 0.7,
    rotation: 0,
  });
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const preview = useRef<HTMLCanvasElement>(null);
  const mounted = useRef(true);
  const scope = `${gameId ?? "team"}:${token ?? ""}:${playerId}:${coachName}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setPrepared(null);
    setBusy(false);
    setLibrary(null);
    setMessage("");
    void fetch(
      "/api/celebrations/headshots" +
        (gameId ? "?gameId=" + encodeURIComponent(gameId) : ""),
      {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw Error(body.error);
        if (!Array.isArray(body.players) || !Array.isArray(body.headshots))
          throw Error("Player photos are unavailable.");
        if (active) {
          setLibrary(body);
          setPlayerId(body.players[0]?.id ?? "new-coach");
          setCoachName(
            body.players[0]?.kind === "coach" ? body.players[0].name : "",
          );
        }
      })
      .catch(() => {
        if (active)
          setMessage("Player photos are unavailable. Refresh to try again.");
      });
    return () => {
      active = false;
    };
  }, [gameId, token]);
  useEffect(() => {
    if (!prepared || !preview.current) return;
    const result = renderHeadshot(prepared, adjustment, manual);
    const ctx = preview.current.getContext("2d")!;
    ctx.clearRect(0, 0, 512, 512);
    ctx.drawImage(result, 0, 0);
  }, [prepared, adjustment, manual]);
  async function choose(file: File | undefined) {
    if (!file) return;
    const startedScope = currentScope.current;
    const valid = () =>
      mounted.current && startedScope === currentScope.current;
    setBusy(true);
    setMessage("Preparing the face on this device…");
    setPrepared(null);
    try {
      const result = await prepareHeadshot(file);
      if (!valid()) return;
      setPrepared(result);
      setAdjustment(result.adjustment);
      setManual(!result.cutout);
      setMessage(result.message);
    } catch (error) {
      if (!valid()) return;
      setMessage(
        error instanceof Error ? error.message : "Photo could not be opened.",
      );
    } finally {
      if (valid()) setBusy(false);
    }
  }
  async function save() {
    if (!prepared || !playerId) return;
    const startedScope = currentScope.current;
    const valid = () =>
      mounted.current && startedScope === currentScope.current;
    setBusy(true);
    setMessage("Saving approved cutout…");
    try {
      const form = new FormData();
      if (playerId !== "new-coach") form.append("playerId", playerId);
      form.append("kind", isCoach ? "coach" : "roster");
      if (isCoach) form.append("playerName", coachName);
      if (gameId) form.append("gameId", gameId);
      form.append(
        "image",
        await headshotPng(renderHeadshot(prepared, adjustment, manual)),
        "headshot.png",
      );
      if (!valid()) return;
      const response = await fetch("/api/celebrations/headshots", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!valid()) return;
      if (!response.ok) throw Error(body.error ?? "Photo could not be saved.");
      setLibrary(body);
      setPrepared(null);
      if (isCoach) {
        const coach = body.players.find(
          (person: { kind?: string }) => person.kind === "coach",
        );
        if (coach) {
          setPlayerId(coach.id);
          setCoachName(coach.name);
        }
      }
      setMessage("Face saved for the celebration clip.");
      onSaved?.(body);
    } catch (error) {
      if (!valid()) return;
      setMessage(
        error instanceof Error ? error.message : "Photo could not be saved.",
      );
    } finally {
      if (valid()) setBusy(false);
    }
  }
  async function remove(headshotId: string) {
    const startedScope = currentScope.current;
    const valid = () =>
      mounted.current && startedScope === currentScope.current;
    setBusy(true);
    try {
      const response = await fetch("/api/celebrations/headshots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headshotId, ...(gameId ? { gameId } : {}) }),
      });
      const body = await response.json();
      if (!valid()) return;
      if (!response.ok) throw Error(body.error);
      setLibrary(body);
      if (
        !body.players.some((person: { id: string }) => person.id === playerId)
      ) {
        const next = body.players[0];
        setPlayerId(next?.id ?? "new-coach");
        setCoachName(next?.kind === "coach" ? next.name : "");
        setPrepared(null);
      }
      setMessage("Player photo removed from future celebrations.");
      onSaved?.(body);
    } catch {
      if (!valid()) return;
      setMessage("Player photo could not be removed. Try again.");
    } finally {
      if (valid()) setBusy(false);
    }
  }
  const control =
    "min-h-11 w-full rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm";
  return (
    <details className="rounded-xl border border-white/15 bg-slate-950/60 p-3">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">
        People photos
      </summary>
      <p className="mb-3 text-sm text-slate-300">
        Upload a clear, front-facing photo.
      </p>
      {library?.headshots.length ? (
        <div className="mb-3 flex flex-wrap gap-3">
          {library.headshots.map((shot) => (
            <figure key={shot.id} className="w-20 text-center">
              <img
                src={shot.imageUrl}
                alt={`${shot.playerName} celebration face`}
                className="h-20 w-20 rounded-lg bg-slate-800 object-contain"
              />
              <figcaption className="text-xs">{shot.playerName}</figcaption>
              {library.canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 px-2 text-xs text-slate-300 underline"
                  aria-label={`Remove ${shot.playerName} photo`}
                  onClick={() => void remove(shot.id)}
                >
                  Remove photo
                </button>
              )}
            </figure>
          ))}
        </div>
      ) : null}
      {library?.canEdit && (
        <div className="space-y-3">
          {
            <>
              <label className="block text-sm">
                Person
                <select
                  className={control}
                  value={playerId}
                  disabled={busy}
                  onChange={(event) => {
                    setPlayerId(event.target.value);
                    setCoachName(
                      library.players.find(
                        (player) => player.id === event.target.value,
                      )?.kind === "coach"
                        ? library.players.find(
                            (player) => player.id === event.target.value,
                          )!.name
                        : "",
                    );
                    setPrepared(null);
                    setMessage("");
                  }}
                >
                  {library.players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name} · {player.position}
                    </option>
                  ))}
                  {!library.players.some(
                    (player) => player.kind === "coach",
                  ) && <option value="new-coach">Add coach</option>}
                </select>
              </label>
              {isCoach && (
                <label className="block text-sm">
                  Coach name
                  <input
                    type="text"
                    value={coachName}
                    maxLength={100}
                    disabled={busy}
                    className={control}
                    onChange={(event) => setCoachName(event.target.value)}
                  />
                </label>
              )}
              <label className="block text-sm">
                Face photo
                <input
                  key={playerId}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className={control}
                  disabled={busy}
                  onChange={(event) => void choose(event.target.files?.[0])}
                />
              </label>
            </>
          }
          {prepared && (
            <>
              <canvas
                ref={preview}
                width={512}
                height={512}
                aria-label="Approved head cutout preview"
                className="mx-auto aspect-square w-full max-w-64 rounded-xl border border-white/20 bg-slate-700"
              />
              {prepared.cutout && (
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={manual}
                    disabled={busy}
                    onChange={(event) => setManual(event.target.checked)}
                  />
                  Use manual oval crop instead
                </label>
              )}
              {manual && (
                <p className="text-xs text-amber-200">
                  Manual oval crop keeps the photo background inside the oval.
                  Choose a plain background for the cleanest result.
                </p>
              )}
              {(
                [
                  {
                    key: "x",
                    label: "Horizontal alignment",
                    min: 0,
                    max: 1,
                    step: 0.005,
                  },
                  {
                    key: "y",
                    label: "Vertical alignment",
                    min: 0,
                    max: 1,
                    step: 0.005,
                  },
                  {
                    key: "size",
                    label: "Head size",
                    min: 0.1,
                    max: Math.max(3, adjustment.size),
                    step: 0.01,
                  },
                  {
                    key: "rotation",
                    label: "Head tilt",
                    min: -45,
                    max: 45,
                    step: 1,
                  },
                ] as const
              ).map((slider) => (
                <label key={slider.key} className="block text-sm">
                  {slider.label}
                  <input
                    className="block min-h-11 w-full"
                    type="range"
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={adjustment[slider.key]}
                    disabled={busy}
                    onChange={(event) =>
                      setAdjustment((current) => ({
                        ...current,
                        [slider.key]: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              ))}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || (isCoach && !coachName.trim())}
                  className={control + " bg-emerald-800"}
                  onClick={() => void save()}
                >
                  Save face
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={control}
                  onClick={() => setPrepared(null)}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {library && !library.canEdit && (
        <p className="text-sm text-slate-300">
          A team administrator can add or update player faces.
        </p>
      )}
      <p role="status" className="mt-2 text-sm text-slate-300">
        {message}
      </p>
    </details>
  );
}
