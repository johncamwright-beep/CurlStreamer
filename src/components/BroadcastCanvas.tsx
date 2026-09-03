"use client";
import { useEffect, useState } from "react";
import { Scoreboard } from "./Scoreboard";
import type { GameState } from "@/lib/types";
import { LiveKitCameraFeed } from "./LiveKitCameraFeed";
function Camera({
  side,
  gameId,
  role,
}: {
  side: "HOME" | "AWAY";
  gameId: string;
  role: "camera-home" | "camera-away";
}) {
  return (
    <div className="portrait-camera-panel mx-auto h-full max-w-full rounded-2xl border border-white/20 bg-gradient-to-b from-cyan-950 via-slate-700 to-blue-950">
      <span className="absolute left-4 top-4 rounded bg-slate-950/70 px-3 py-2 font-bold">
        {side} END
      </span>
      <LiveKitCameraFeed gameId={gameId} role={role} showPlaceholderGuides />
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
  const showHome = game.layout !== "away",
    showAway = game.layout !== "home";
  return (
    <div
      data-testid="broadcast-canvas"
      className="relative aspect-video w-full overflow-hidden bg-[radial-gradient(circle_at_top,#164e63,#07111f_55%)]"
      style={{ containerType: "inline-size" }}
    >
      <div className="absolute inset-[3%] grid grid-cols-[25%_1fr_25%] gap-[2%]">
        <div className="flex flex-col justify-between">
          <div>
            <p className="text-[1.2cqw] font-bold tracking-[.25em] text-cyan-300">
              CURLCAST
            </p>
            <h1 className="mt-[1cqw] text-[2cqw] font-black leading-tight">
              {game.config.eventName}
            </h1>
          </div>
          <Scoreboard game={game} compact />
          <div className="text-[1cqw]">
            <span
              className={
                game.broadcast === "live" ? "text-red-300" : "text-slate-300"
              }
            >
              ● {game.broadcast.toUpperCase()}
            </span>
            <p>{game.audioMuted ? "Audio muted" : "Scorer audio live"}</p>
          </div>
        </div>
        <div className="grid h-full grid-cols-2 items-center gap-[2%]">
          {showHome && (
            <Camera side="HOME" gameId={game.id} role="camera-home" />
          )}{" "}
          {showAway && (
            <Camera side="AWAY" gameId={game.id} role="camera-away" />
          )}
        </div>
        <div className="flex flex-col justify-between">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-[1.2cqw]">
            <p className="text-[1cqw] text-slate-300">PROGRAM LAYOUT</p>
            <strong className="text-[1.6cqw] uppercase">{game.layout}</strong>
          </div>
          {m.active && m.style === "overlay" && sponsor && (
            <div className="rounded-2xl bg-white p-[1cqw]">
              <p className="mb-2 text-center text-[.8cqw] font-bold text-slate-700">
                PRESENTED BY
              </p>
              <img
                src={sponsor.dataUrl}
                alt={sponsor.name}
                className="safe-video h-[10cqw] w-full"
                style={{ transform: `rotate(${sponsor.rotation}deg)` }}
              />
            </div>
          )}
          <div className="text-right text-[.9cqw] text-slate-400">
            Portrait feeds shown complete
            <br />
            Broadcast safe area
          </div>
        </div>
      </div>
      {m.active && m.style === "fullscreen" && sponsor && (
        <div className="absolute inset-0 z-20 grid place-content-center bg-[radial-gradient(circle,#f8fafc,#cbd5e1)] p-[8%] transition-opacity">
          <img
            src={sponsor.dataUrl}
            alt={sponsor.name}
            className="safe-video h-[60vh] max-h-[650px] w-[70vw] max-w-[1300px]"
            style={{ transform: `rotate(${sponsor.rotation}deg)` }}
          />
          <div className="absolute bottom-[3%] left-[3%] rounded-xl bg-slate-950/90 p-[1cqw]">
            <Scoreboard game={game} compact />
          </div>
          <span className="absolute right-[3%] top-[3%] rounded-full bg-slate-950 px-[1cqw] py-[.5cqw] text-[1cqw] font-bold">
            SPONSOR BREAK
          </span>
        </div>
      )}
    </div>
  );
}
