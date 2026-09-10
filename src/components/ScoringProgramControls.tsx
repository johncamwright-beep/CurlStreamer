"use client";

import { useRef, useState } from "react";
import type { GameState } from "@/lib/types";
import { cameraDisplayStatus } from "@/lib/camera-status";
import {
  hasVisibleSponsorOverlay,
  isScorerAudioEffectivelyMuted,
} from "@/lib/sponsor-audio";

export function ScoringProgramControls({
  game,
  act,
  compact = false,
}: {
  game: GameState;
  act: (action: unknown) => Promise<void>;
  compact?: boolean;
}) {
  const flight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sponsors = game.sponsors.filter((sponsor) => sponsor.enabled);
  const overlay = hasVisibleSponsorOverlay(game);
  const muted = isScorerAudioEffectivelyMuted(game);
  async function update(action: unknown) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await act(action);
    } catch {
      setError(
        "That control could not be updated. Check its current setting, then try again.",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {!compact && (
        <section
          className="scoring-card scoring-camera-controls"
          aria-labelledby="camera-controls-heading"
        >
          <div className="scoring-section-heading">
            <h2 id="camera-controls-heading">Cameras</h2>
            <span className="scoring-eyebrow">Program picture</span>
          </div>
          {!compact && (
            <div className="scoring-camera-grid">
              {(["camera-home", "camera-away"] as const).map((role, index) => {
                const status = cameraDisplayStatus(game, role);
                return (
                  <div className="scoring-camera" key={role}>
                    <span className="scoring-camera-icon" aria-hidden="true">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <rect x="3" y="6" width="12" height="12" rx="3" />
                        <path d="m15 10 6-3v10l-6-3" />
                      </svg>
                    </span>
                    <strong>Camera {index + 1}</strong>
                    <span
                      className={
                        status === "Live"
                          ? "scoring-health-connected"
                          : "scoring-muted"
                      }
                    >
                      {status === "Live"
                        ? "Connected"
                        : status === "Unclaimed"
                          ? "Not joined"
                          : status === "Claimed but offline"
                            ? "Offline"
                            : status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {!compact && (
            <p className="scoring-field-label">Show in the broadcast</p>
          )}
          <div
            className="scoring-segmented"
            role="group"
            aria-label="Program camera layout"
          >
            {(["split", "home", "away"] as const).map((layout) => (
              <button
                key={layout}
                disabled={busy}
                aria-pressed={game.layout === layout}
                onClick={() => update({ type: "layout", layout })}
              >
                {layout === "split"
                  ? "Both cameras"
                  : layout === "home"
                    ? "Camera 1"
                    : "Camera 2"}
              </button>
            ))}
          </div>
        </section>
      )}
      {!compact && (
        <section
          className="scoring-card"
          aria-labelledby="audio-controls-heading"
        >
          <div className="scoring-section-heading">
            <h2 id="audio-controls-heading">Audio</h2>
            <span className="scoring-badge scoring-badge-demo">Demo only</span>
          </div>
          <div className="scoring-audio-row">
            <div>
              <strong>{muted ? "Demo audio muted" : "Demo audio on"}</strong>
              <p className="scoring-muted">
                {overlay
                  ? "Sponsor overlay is keeping demo audio muted."
                  : "Manual demo setting"}
              </p>
            </div>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => update({ type: "audio", muted: !game.audioMuted })}
            >
              {game.audioMuted ? "Turn demo audio on" : "Mute demo audio"}
            </button>
          </div>
          <p className="scoring-explanation">
            These controls are simulated and do not control sound on your
            YouTube stream.
          </p>
        </section>
      )}
      <section
        className="scoring-card scoring-sponsor-controls"
        aria-labelledby="sponsor-controls-heading"
      >
        <div className="scoring-section-heading">
          <h2 id="sponsor-controls-heading">Sponsors</h2>
          <button
            className="btn-secondary scoring-sponsor-toggle"
            disabled={busy || (!sponsors.length && !game.sponsorMode.active)}
            onClick={() =>
              update({ type: "sponsor-mode", active: !game.sponsorMode.active })
            }
          >
            {game.sponsorMode.active ? "Stop sponsors" : "Start sponsors"}
          </button>
        </div>
        {!compact && (
          <p className="scoring-muted">
            {sponsors.length} active organization sponsor
            {sponsors.length === 1 ? "" : "s"}
          </p>
        )}
        <div
          className="scoring-segmented"
          role="group"
          aria-label="Sponsor placement"
        >
          {(["overlay", "fullscreen"] as const).map((style) => (
            <button
              key={style}
              disabled={busy}
              aria-pressed={game.sponsorMode.style === style}
              onClick={() =>
                update({
                  type: "sponsor-mode",
                  active: game.sponsorMode.active,
                  style,
                })
              }
            >
              {style === "overlay" ? "Overlay" : "Side panel"}
            </button>
          ))}
        </div>
        {!sponsors.length && (
          <p className="scoring-explanation">
            Add organization sponsors in Sponsor Library to use the carousel.
          </p>
        )}
        {!compact && (
          <details className="scoring-details">
            <summary>Carousel settings</summary>
            <div className="scoring-sponsor-settings">
              <label>
                Seconds per sponsor
                <select
                  disabled={busy}
                  value={game.sponsorMode.intervalSeconds}
                  onChange={(event) =>
                    update({
                      type: "sponsor-mode",
                      active: false,
                      intervalSeconds: Number(event.target.value),
                    })
                  }
                >
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((seconds) => (
                    <option key={seconds}>{seconds}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="scoring-muted">
              Changing the timing stops the carousel.
            </p>
          </details>
        )}
      </section>
      {error && (
        <p
          role="alert"
          aria-label="Program control error"
          className="scoring-feedback scoring-feedback-error"
        >
          {error}
        </p>
      )}
    </>
  );
}
