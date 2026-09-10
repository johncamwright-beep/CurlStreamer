"use client";
import React, { useEffect, useState } from "react";
import { TeamLogo } from "./TeamLogo";
import { Scoreboard } from "./Scoreboard";
import type { GameState } from "@/lib/types";
import type { BroadcastGame } from "@/lib/game-projection";
import { formatBroadcastRailTitle } from "@/lib/game-title";
import { cameraIsShown } from "@/lib/camera-layout";

import { SponsorFrame } from "./SponsorFrame";
export type ProgramCameraRole = "camera-home" | "camera-away";
export interface ProgramCanvasProps {
  game: GameState | BroadcastGame;
  renderCamera: (role: ProgramCameraRole) => React.ReactNode;
  audioStatus?: string;
  statusLabel?: string;
}

/** Direct program output always contains complete camera and sponsor frames. */
export function ProgramCanvas(props: ProgramCanvasProps) {
  return <ProgramComposition {...props} containMedia showStatus={false} />;
}

/** Shared composition; the preserved LiveKit wrapper retains its legacy framing. */
export function ProgramComposition({
  game,
  renderCamera,
  audioStatus = "Video only",
  statusLabel = "Local program",
  containMedia = false,
  showStatus = true,
}: ProgramCanvasProps & { containMedia?: boolean; showStatus?: boolean }) {
  const camera = (role: ProgramCameraRole) => (
    <div
      data-testid={`camera-panel-${role}`}
      className="portrait-camera-panel broadcast-camera-panel rounded-2xl border border-white/20 bg-gradient-to-b from-cyan-950 via-slate-700 to-blue-950"
    >
      {renderCamera(role)}
    </div>
  );
  const [, tick] = useState(0);
  useEffect(() => {
    if (
      !game.sponsorMode.active ||
      game.sponsorMode.paused ||
      game.sponsors.filter((s) => s.enabled).length <= 1
    )
      return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [game.sponsorMode.active, game.sponsorMode.paused, game.sponsors]);
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

  const showHome = cameraIsShown(game.layout, "home"),
    showAway = cameraIsShown(game.layout, "away");
  const cameraCount = Number(showHome) + Number(showAway);
  const eventTitle = formatBroadcastRailTitle(game.config.eventName);
  return (
    <div
      data-testid="broadcast-canvas"
      className={`relative aspect-video w-full overflow-hidden bg-[radial-gradient(circle_at_top,#164e63,#07111f_55%)] ${containMedia ? "[&_video]:!object-contain [&_img]:!object-contain" : ""}`}
      style={{ containerType: "inline-size" }}
    >
      <div className="broadcast-program-layout absolute inset-[3%]">
        <div
          data-testid="camera-deck"
          data-camera-count={cameraCount}
          className="broadcast-camera-deck"
        >
          {showHome && camera("camera-home")}
          {showAway && camera("camera-away")}
          {visibleSponsorOverlay && sponsor && (
            <SponsorFrame
              sponsors={sponsors}
              desiredIndex={idx}
              mode="overlay"
            />
          )}
        </div>
        <aside
          data-testid="program-side-rail"
          className="broadcast-information-rail flex min-w-0 flex-col rounded-2xl border border-white/10 bg-slate-950/45"
        >
          <div>
            <div className="mb-[.6cqw] flex items-center justify-between gap-[.8cqw]">
              {eventTitle && (
                <h1 className="min-w-0 flex-1 text-[1.75cqw] font-black leading-tight">
                  {eventTitle}
                </h1>
              )}
              <TeamLogo
                teamName={game.config.homeName}
                className="ml-auto h-[5.5cqw] w-[5.5cqw] rounded-lg"
              />
            </div>
            <Scoreboard game={game} compact broadcast />
          </div>
          {m.active && m.style === "fullscreen" && sponsor && (
            <SponsorFrame
              sponsors={sponsors}
              desiredIndex={idx}
              mode="sidebar"
            />
          )}
          <div
            className="relative mt-auto w-full shrink-0 overflow-hidden"
            style={{ aspectRatio: "4 / 1" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/branding/curlstreamer-logo.png"
              alt="Curl Streamer"
              className="h-full w-full object-contain"
            />
          </div>
          {showStatus && (
            <div
              className="mt-auto pt-[.6cqw] text-[.9cqw] leading-tight"
              aria-label="Program status"
            >
              <span
                className={
                  statusLabel === "LIVE" ? "text-red-300" : "text-slate-300"
                }
              >
                ● {statusLabel}
              </span>
              <p>{audioStatus}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
