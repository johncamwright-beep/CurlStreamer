"use client";
import React, { useEffect, useState } from "react";
import { TeamLogo } from "./TeamLogo";
import { Scoreboard } from "./Scoreboard";
import type { GameState } from "@/lib/types";
import type { BroadcastGame } from "@/lib/game-projection";
import { formatBroadcastRailTitle } from "@/lib/game-title";
import { cameraIsShown } from "@/lib/camera-layout";
import {
  portraitCameraAspect,
  programCameraLayout,
} from "@/lib/program-camera-layout";

import { SponsorFrame } from "./SponsorFrame";
export type ProgramCameraRole = "camera-home" | "camera-away";
export interface ProgramCanvasProps {
  game: GameState | BroadcastGame;
  renderCamera: (role: ProgramCameraRole) => React.ReactNode;
  cameraAspects?: Partial<Record<ProgramCameraRole, number>>;
  audioStatus?: string;
  statusLabel?: string;
}

/** Full-frame by default; an explicit portrait layout crops cameras only. */
export function ProgramCanvas(props: ProgramCanvasProps) {
  return <ProgramComposition {...props} containMedia showStatus={false} />;
}

/** Shared composition; the preserved LiveKit wrapper retains its legacy framing. */
export function ProgramComposition({
  game,
  renderCamera,
  cameraAspects,
  audioStatus = "Video only",
  statusLabel = "Local program",
  containMedia = false,
  showStatus = true,
}: ProgramCanvasProps & { containMedia?: boolean; showStatus?: boolean }) {
  const visibleRoles: ProgramCameraRole[] = (
    ["camera-home", "camera-away"] as const
  ).filter((role) =>
    cameraIsShown(game.layout, role === "camera-home" ? "home" : "away"),
  );
  const composition = programCameraLayout(
    visibleRoles.map((role) => cameraAspects?.[role] ?? portraitCameraAspect),
    game.programCameraMode,
  );
  const arranged =
    containMedia ||
    (game.programCameraMode && game.programCameraMode !== "auto");
  const camera = (role: ProgramCameraRole, index: number) => (
    <div
      data-testid={`camera-panel-${role}`}
      data-crop={game.programCameraMode === "portrait" ? "portrait" : undefined}
      style={
        arranged
          ? {
              position: "absolute",
              aspectRatio: "auto",
              ...composition.cells[index],
            }
          : undefined
      }
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
  let scheduleLabel = "";
  if (game.broadcastSchedule) {
    try {
      scheduleLabel = new Intl.DateTimeFormat("en-US", {
        timeZone: game.broadcastSchedule.timezone,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(game.broadcastSchedule.scheduledStart));
    } catch {
      /* Older or unscheduled games do not invent a date. */
    }
  }
  return (
    <div
      data-testid="broadcast-canvas"
      className={`relative aspect-video w-full overflow-hidden bg-[radial-gradient(circle_at_top,#164e63,#07111f_55%)] ${containMedia ? "[&_video]:!object-contain [&_img]:!object-contain" : ""}`}
      style={{ containerType: "inline-size" }}
    >
      <div
        className="broadcast-program-layout absolute inset-[3%]"
        data-camera-layout={arranged ? composition.mode : undefined}
        style={
          arranged
            ? {
                gridTemplateColumns: composition.deckFraction
                  ? `minmax(0, ${composition.deckFraction}fr) minmax(0, ${1 - composition.deckFraction}fr)`
                  : "minmax(0, 1fr)",
              }
            : undefined
        }
      >
        <div
          data-testid="camera-deck"
          data-camera-count={cameraCount}
          className="broadcast-camera-deck"
          style={arranged && !cameraCount ? { display: "none" } : undefined}
        >
          {visibleRoles.map((role, index) => (
            <React.Fragment key={role}>{camera(role, index)}</React.Fragment>
          ))}
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
          <div className="broadcast-rail-heading">
            <Scoreboard game={game} compact broadcast />
            <TeamLogo
              teamName={game.config.homeName}
              imageUrl={game.config.homeLogoUrl}
              className="broadcast-team-logo"
            />
          </div>
          {scheduleLabel && (
            <p
              data-testid="broadcast-schedule"
              className="mt-[.3cqw] text-[1cqw] leading-snug text-slate-300"
            >
              {scheduleLabel}
            </p>
          )}
          {eventTitle && (
            <h1 className="mt-[.6cqw] text-[1.75cqw] font-black leading-tight">
              {eventTitle}
            </h1>
          )}
          {m.active &&
            (m.style === "fullscreen" || !cameraCount) &&
            sponsor && (
              <SponsorFrame
                sponsors={sponsors}
                desiredIndex={idx}
                mode="sidebar"
                teamName={game.config.homeName}
              />
            )}
          <div
            className="relative mt-auto w-full shrink-0 overflow-hidden"
            style={{ aspectRatio: "1558 / 340" }}
          >
            {/* Exclude only the source asset's transparent margins. */}
            <svg
              viewBox="35 79 1558 340"
              role="img"
              aria-label="Curl Streamer"
              className="h-full w-full"
            >
              <image
                href="/branding/curlstreamer-logo.png"
                width="1975"
                height="500"
              />
            </svg>
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
