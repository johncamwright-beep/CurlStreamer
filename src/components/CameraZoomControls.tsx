"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/types";
import { clampZoom } from "@/lib/providers/livekit-client";
import { useGame } from "@/components/GameSync";
import { previewSubscribeAccessToken } from "@/lib/access-session";

const FRESH_MS = 75_000;
type Role = "camera-home" | "camera-away";

/** Uses the authorized game projection; public broadcast data never exposes control state. */
export function BroadcastCameraZoomControls({ id }: { id: string }) {
  const { game } = useGame(id);
  if (!game) return null;
  return (
    <CameraZoomControls
      game={game}
      act={async (action) => {
        const token = previewSubscribeAccessToken(localStorage, id);
        const response = await fetch(`/api/games/${id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(action),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw Error(body?.error ?? "That zoom command could not be sent.");
        }
      }}
    />
  );
}

export function CameraZoomControls({
  game,
  act,
}: {
  game: Pick<GameState, "cameraZoom">;
  act: (action: unknown) => Promise<void>;
}) {
  return (
    <aside
      data-testid="camera-zoom-rail"
      className="camera-zoom-rail"
      aria-label="Camera zoom controls"
    >
      <h2>Camera zoom</h2>
      {(["camera-home", "camera-away"] as const).map((role) => (
        <CameraZoomControl key={role} game={game} role={role} act={act} />
      ))}
    </aside>
  );
}

function CameraZoomControl({
  game,
  role,
  act,
}: {
  game: Pick<GameState, "cameraZoom">;
  role: Role;
  act: (action: unknown) => Promise<void>;
}) {
  const label = role === "camera-home" ? "Camera 1" : "Camera 2";
  const status = game.cameraZoom?.[role];
  const fresh = Boolean(status && Date.now() - status.updatedAt <= FRESH_MS);
  const enabled = Boolean(
    fresh &&
    status?.supported &&
    status.min !== undefined &&
    status.max !== undefined &&
    status.step !== undefined &&
    status.value !== undefined,
  );
  const range = enabled
    ? { min: status!.min!, max: status!.max!, step: status!.step! }
    : undefined;
  const [desired, setDesired] = useState<number>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const desiredRef = useRef<number | undefined>(undefined);
  const targetRef = useRef<number | undefined>(undefined);
  const sending = useRef(false);
  useEffect(() => {
    if (
      enabled &&
      targetRef.current !== undefined &&
      status!.value === targetRef.current
    ) {
      targetRef.current = undefined;
      setDesired(undefined);
      setConfirming(false);
      setError("");
    }
  }, [desired, enabled, status]);
  useEffect(() => {
    if (targetRef.current === undefined) return;
    setConfirming(true);
    const timer = setTimeout(() => {
      if (targetRef.current !== undefined) {
        setError("Phone did not confirm the requested zoom");
        setConfirming(false);
      }
    }, 8_000);
    return () => clearTimeout(timer);
  }, [desired]);
  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setError("");
    try {
      while (desiredRef.current !== undefined) {
        const value = desiredRef.current;
        desiredRef.current = undefined;
        await act({
          type: "camera-zoom",
          role,
          commandId: crypto.randomUUID(),
          value,
        });
      }
    } catch {
      desiredRef.current = undefined;
      targetRef.current = undefined;
      setDesired(undefined);
      setConfirming(false);
      setError("Could not send zoom command");
    } finally {
      sending.current = false;
      setPending(false);
    }
  };
  const request = (value: number) => {
    if (!range) return;
    const next = clampZoom(value, range);
    desiredRef.current = next;
    targetRef.current = next;
    setDesired(next);
    void send();
  };
  const requestRelative = (delta: number) =>
    request((targetRef.current ?? status!.value!) + delta);
  const displayed = desired ?? status?.value;
  const increment = range ? Math.max(range.step, 0.1) : 0;
  const reason = !status
    ? "Waiting for phone capability"
    : !fresh
      ? "Phone status out of date"
      : !status.supported
        ? "Hardware zoom unavailable"
        : "";
  return (
    <section className="camera-zoom-control" aria-label={`${label} zoom`}>
      <h3>{label}</h3>
      <p aria-live="polite">
        {enabled
          ? `${status!.value!.toFixed(1)}× hardware zoom${pending ? " · sending…" : confirming ? " · awaiting phone" : ""}`
          : reason}
      </p>
      <div className="camera-zoom-buttons">
        <button
          type="button"
          disabled={!enabled}
          onClick={() => requestRelative(-increment)}
          aria-label={`${label} zoom out`}
        >
          −
        </button>
        <button
          type="button"
          disabled={!enabled}
          onClick={() => requestRelative(increment)}
          aria-label={`${label} zoom in`}
        >
          +
        </button>
      </div>
      <input
        aria-label={`${label} zoom level`}
        type="range"
        disabled={!enabled}
        min={range?.min}
        max={range?.max}
        step={range?.step}
        value={enabled ? displayed! : 0}
        onChange={(event) => {
          const next = clampZoom(Number(event.target.value), range!);
          desiredRef.current = next;
          targetRef.current = next;
          setDesired(next);
        }}
        onPointerUp={() => void send()}
        onKeyUp={() => void send()}
        onBlur={() => void send()}
      />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
