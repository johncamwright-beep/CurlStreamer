"use client";
import React, { useEffect, useState } from "react";
import { Scoreboard } from "./Scoreboard";
import type { GameState } from "@/lib/types";
import { LiveKitCameraFeed } from "./LiveKitCameraFeed";
import { isScorerAudioEffectivelyMuted } from "@/lib/sponsor-audio";
function Camera({
  side,
  gameId,
  role,
  framing,
}: {
  side: "CAMERA 1" | "CAMERA 2";
  gameId: string;
  role: "camera-home" | "camera-away";
  framing: "fill" | "contain";
}) {
  return (
    <div
      data-testid={`camera-panel-${role}`}
      className="portrait-camera-panel broadcast-camera-panel rounded-2xl border border-white/20 bg-gradient-to-b from-cyan-950 via-slate-700 to-blue-950"
    >
      <span className="absolute left-4 top-4 rounded bg-slate-950/70 px-3 py-2 font-bold">
        {side}
      </span>
      <LiveKitCameraFeed
        gameId={gameId}
        role={role}
        framing={framing}
        showPlaceholderGuides
      />
    </div>
  );
}
export function BroadcastCanvas({ game }: { game: GameState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  const sponsors = game.sponsors.filter((s) => s.enabled);
  const m = game.sponsorMode;
  const elapsed =
    m.startedAt && !m.paused
      ? Math.floor((Date.now() - m.startedAt) / (m.intervalSeconds * 1000))
      : 0;
  const idx = sponsors.length
    ? (((m.rotationOffset + elapsed) % sponsors.length) + sponsors.length) %
      sponsors.length
    : 0;
  const sponsor = sponsors[idx];
  const visibleSponsorOverlay = Boolean(
    m.active && m.style === "overlay" && sponsor,
  );
  const effectiveMute = isScorerAudioEffectivelyMuted(game);
  const showHome = game.layout !== "away",
    showAway = game.layout !== "home";
  const cameraCount = showHome && showAway ? 2 : 1;
  return (
    <div
      data-testid="broadcast-canvas"
      className="relative aspect-video w-full overflow-hidden bg-[radial-gradient(circle_at_top,#164e63,#07111f_55%)]"
      style={{ containerType: "inline-size" }}
    >
      <div className="broadcast-program-layout absolute inset-[3%]">
        <div
          data-testid="camera-deck"
          data-camera-count={cameraCount}
          className="broadcast-camera-deck"
        >
          {showHome && (
            <Camera
              side="CAMERA 1"
              gameId={game.id}
              role="camera-home"
              framing={game.cameraFraming?.["camera-home"] ?? "fill"}
            />
          )}
          {showAway && (
            <Camera
              side="CAMERA 2"
              gameId={game.id}
              role="camera-away"
              framing={game.cameraFraming?.["camera-away"] ?? "fill"}
            />
          )}
          {visibleSponsorOverlay && sponsor && (
            <div data-testid="sponsor-overlay" className="sponsor-deck-overlay">
              <img
                src={sponsor.dataUrl}
                alt={sponsor.name}
                className="safe-video"
                style={{ transform: `rotate(${sponsor.rotation}deg)` }}
              />
            </div>
          )}
        </div>
        <aside
          data-testid="program-side-rail"
          className="broadcast-information-rail flex min-w-0 flex-col rounded-2xl border border-white/10 bg-slate-950/45"
        >
          <div>
            <p className="text-[1.25cqw] font-bold tracking-[.25em] text-cyan-300">
              CURLCAST
            </p>
            <h1 className="mt-[.45cqw] truncate text-[1.75cqw] font-black leading-tight">
              {game.config.eventName}
            </h1>
            <Scoreboard game={game} compact broadcast />
          </div>
          {m.active && m.style === "fullscreen" && sponsor && (
            <div
              data-testid="sponsor-sidebar"
              className="sponsor-sidebar rounded-2xl bg-white p-[1cqw]"
            >
              <p className="mb-2 text-center text-[.8cqw] font-bold text-slate-700">
                PRESENTED BY
              </p>
              <img
                src={sponsor.dataUrl}
                alt={sponsor.name}
                className="safe-video h-full w-full"
                style={{ transform: `rotate(${sponsor.rotation}deg)` }}
              />
            </div>
          )}
          <div
            className="mt-auto pt-[.6cqw] text-[.9cqw] leading-tight"
            aria-label="Program status"
          >
            <span
              className={
                game.broadcast === "live" ? "text-red-300" : "text-slate-300"
              }
            >
              ● {game.broadcast.toUpperCase()}
            </span>
            <p>{effectiveMute ? "Audio muted" : "Scorer audio live"}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
