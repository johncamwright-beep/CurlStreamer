"use client";
import { useEffect, useRef, useState } from "react";
import {
  CELEBRATION_TEMPLATES,
  type CelebrationCue,
  type CelebrationTemplateId,
} from "@/lib/player-celebrations";
import { StudioOverlay } from "./StudioOverlay";
import { PlayerCelebration } from "./PlayerCelebration";
import { CelebrationHeadshotSetup } from "./celebrations/celebration-headshot-setup";
import { gameAccessToken } from "@/lib/access-session";
import { currentCelebration } from "@/lib/celebration-state";
import type { GameState } from "@/lib/types";

type RosterPlayer = { id: string; name: string; position: string };
type Headshot = {
  id: string;
  rosterPlayerId: string;
  playerName: string;
  imageUrl: string;
};
export function StudioCelebrations({
  game,
  act,
  displayMode = "disclosure",
}: {
  game: GameState;
  act: (action: unknown) => Promise<void>;
  displayMode?: "disclosure" | "dialog";
}) {
  const scope = useRef(game.id);
  scope.current = game.id;
  const requestEpoch = useRef(0);
  const loadedAt = useRef(0);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [open, setOpen] = useState(false);
  const [headshots, setHeadshots] = useState<Headshot[]>([]);
  const [selected, setSelected] = useState("");
  const [templateId, setTemplate] =
    useState<CelebrationTemplateId>("lightsaber");
  const [volume, setVolume] = useState(0.65);
  const [muted, setMuted] = useState(false);
  const [preview, setPreview] = useState<CelebrationCue>();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 250);
    return () => clearInterval(timer);
  }, []);
  const activeCue = currentCelebration(game);
  const [error, setError] = useState("");
  const refresh = () => {
    const gameId = game.id;
    if (scope.current !== gameId) return Promise.resolve();
    const epoch = ++requestEpoch.current;
    const current = () =>
      scope.current === gameId && requestEpoch.current === epoch;
    setError("");
    setPhotosLoading(true);
    return fetch(
      "/api/celebrations/headshots?gameId=" + encodeURIComponent(game.id),
      {
        cache: "no-store",
        headers: gameAccessToken(localStorage, game.id)
          ? {
              authorization: "Bearer " + gameAccessToken(localStorage, game.id),
            }
          : undefined,
      },
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((value) => {
        if (!current()) return;
        if (!Array.isArray(value.players) || !Array.isArray(value.headshots))
          throw Error("Invalid player photo library");
        loadedAt.current = Date.now();
        setHeadshots(value.headshots ?? []);
        setPlayers(value.players ?? []);
      })
      .catch(() => {
        if (current()) setError("Player photos could not be loaded.");
      })
      .finally(() => {
        if (current()) setPhotosLoading(false);
      });
  };
  useEffect(() => {
    setPlayers([]);
    setHeadshots([]);
    setSelected("");
    setPreview(undefined);
    void refresh();
    return () => {
      requestEpoch.current++;
    };
  }, [game.id]);
  useEffect(() => {
    if (!open) return;
    if (Date.now() - loadedAt.current > 60000) void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => clearInterval(timer);
  }, [open, game.id]);
  const player = players.find((p) => p.id === selected);
  const photo = headshots.find((p) => p.rosterPlayerId === selected);
  async function update(action: unknown) {
    setBusy(true);
    setError("");
    try {
      await act(action);
    } catch {
      setError("Celebration could not be updated. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function showPreview() {
    if (!player || !photo) return;
    const now = Date.now();
    setPreview({
      id: crypto.randomUUID(),
      templateId,
      playerId: player!.id,
      playerName: player!.name,
      headshotUrl: photo!.imageUrl,
      startedAt: now + 2500,
      expiresAt:
        now +
        2500 +
        CELEBRATION_TEMPLATES.find((t) => t.id === templateId)!.durationMs,
      volume,
      muted,
    });
  }
  const content = (
    <section className="scoring-card" aria-labelledby="celebrations-heading">
      <h2 id="celebrations-heading">Celebrations</h2>
      <div className="flex flex-wrap gap-3">
        <label>
          Player
          <select
            className="min-h-11 block"
            aria-label="Player"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="" disabled>
              Choose player
            </option>
            {players.map((p) => (
              <option
                key={p.id}
                value={p.id}
                disabled={
                  !headshots.some((head) => head.rosterPlayerId === p.id)
                }
              >
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Celebration
          <select
            className="min-h-11 block"
            aria-label="Celebration"
            value={templateId}
            onChange={(e) =>
              setTemplate(e.target.value as CelebrationTemplateId)
            }
          >
            {CELEBRATION_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Volume
          <input
            className="min-h-11 block"
            aria-label="Celebration volume"
            type="range"
            min="0"
            max="1"
            step=".05"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        <label className="min-h-11 inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={muted}
            onChange={(e) => setMuted(e.target.checked)}
          />
          Mute
        </label>
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        <button
          className="btn-secondary min-h-11"
          type="button"
          disabled={!photo || photosLoading}
          onClick={showPreview}
        >
          Preview
        </button>
        <button
          className="btn min-h-11"
          type="button"
          disabled={busy || Boolean(activeCue) || !photo || photosLoading}
          onClick={() =>
            update({
              type: "celebration-play",
              triggerId: crypto.randomUUID(),
              templateId,
              ...(player ? { playerId: player.id } : {}),
              volume,
              muted,
            })
          }
        >
          Play on stream
        </button>
        <button
          className="btn-secondary min-h-11"
          type="button"
          onClick={() => {
            setPreview(undefined);
            void update({
              type: "celebration-stop",
              triggerId: crypto.randomUUID(),
            });
          }}
        >
          Stop
        </button>
      </div>
      {activeCue && (
        <p role="status">
          {Date.now() < activeCue.startedAt ? "Starting…" : "Playing"}
        </p>
      )}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button
            className="btn-secondary min-h-11"
            type="button"
            onClick={() => void refresh()}
          >
            Retry player photos
          </button>
        </div>
      )}
      {preview && (
        <div
          className="relative aspect-video mt-3 overflow-hidden rounded-xl bg-slate-900"
          aria-label="Celebration preview"
        >
          <PlayerCelebration
            key={preview.id}
            cue={preview}
            onError={setError}
          />
        </div>
      )}
      <CelebrationHeadshotSetup
        gameId={game.id}
        token={
          typeof localStorage !== "undefined"
            ? (gameAccessToken(localStorage, game.id) ?? undefined)
            : undefined
        }
        onSaved={() => void refresh()}
      />
    </section>
  );
  const close = () => {
    setOpen(false);
    setPreview(undefined);
  };
  if (displayMode === "dialog")
    return (
      <>
        <button
          type="button"
          className="btn-secondary min-h-11"
          onClick={() => setOpen(true)}
        >
          Celebrations
        </button>
        <StudioOverlay title="Celebrations" open={open} onClose={close}>
          {content}
        </StudioOverlay>
      </>
    );
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="btn-secondary min-h-11 cursor-pointer">
        Celebrations
      </summary>
      {content}
    </details>
  );
}
