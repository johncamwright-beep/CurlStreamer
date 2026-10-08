"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/types";
import { clampZoom } from "@/lib/providers/livekit-client";
import { useGame } from "@/components/GameSync";
import { previewSubscribeAccessToken } from "@/lib/access-session";
import {
  cameraInputNativeZoom,
  useStudioCameraInputs,
  type StudioCameraInput,
} from "./StudioCameraInputs";

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
  game: Pick<GameState, "cameraZoom" | "programCameraMode"> &
    Partial<Pick<GameState, "id">>;
  act: (action: unknown) => Promise<void>;
}) {
  const cameraInputs = useStudioCameraInputs(game.id);
  const [changing, setChanging] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  async function changeLayout(mode: string) {
    setChanging(true);
    setLayoutError("");
    try {
      await act({ type: "camera-composition", mode });
    } catch {
      setLayoutError("Could not change camera layout. Try again.");
    } finally {
      setChanging(false);
    }
  }
  return (
    <aside
      data-testid="camera-zoom-rail"
      className="camera-zoom-rail"
      aria-label="Camera Settings"
    >
      <h2>Camera Settings</h2>
      <label className="camera-layout-control">
        Layout
        <select
          aria-label="Camera layout"
          value={game.programCameraMode ?? "auto"}
          disabled={changing}
          onChange={(event) => void changeLayout(event.target.value)}
        >
          <option value="auto">Automatic</option>
          <option value="stacked">Widescreen · stacked</option>
          <option value="portrait">Portrait · side by side</option>
        </select>
      </label>
      {layoutError && <p role="alert">{layoutError}</p>}
      <div className="camera-settings-cameras">
        {(["camera-home", "camera-away"] as const).map((role) =>
          cameraInputs[role] && cameraInputs[role].kind !== "phone" ? (
            <IpCameraZoomControl
              key={`${game.id}:${role}:${cameraInputs[role].kind}:${cameraInputs[role].generation}`}
              id={game.id}
              role={role}
              source={cameraInputs[role]}
            />
          ) : (
            <CameraZoomControl key={role} game={game} role={role} act={act} />
          ),
        )}
      </div>
    </aside>
  );
}

function IpCameraZoomControl({
  id,
  role,
  source,
}: {
  id?: string;
  role: Role;
  source: StudioCameraInput;
}) {
  const label = role === "camera-home" ? "Camera 1" : "Camera 2";
  const [confirmed, setConfirmed] = useState(source.zoom ?? 1);
  const [draft, setDraft] = useState<number>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef<number | undefined>(undefined);
  const desired = useRef<number | undefined>(undefined);
  const sending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!sending.current && desired.current === undefined)
      setConfirmed(source.zoom ?? 1);
  }, [source.zoom]);
  const clamp = (value: number) =>
    Math.round(Math.max(1, Math.min(4, value)) * 10) / 10;
  const send = async () => {
    if (sending.current || !id) return;
    sending.current = true;
    setPending(true);
    setError("");
    try {
      while (latest.current !== undefined && active.current) {
        const value = latest.current;
        latest.current = undefined;
        const applied = await cameraInputNativeZoom(
          id,
          role,
          source.generation,
          value,
        );
        if (!active.current) return;
        setConfirmed(applied);
        if (desired.current === value) {
          desired.current = undefined;
          setDraft(undefined);
        }
      }
    } catch (reason) {
      if (!active.current) return;
      latest.current = undefined;
      desired.current = undefined;
      setDraft(undefined);
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not change IP camera zoom. Try again.",
      );
    } finally {
      sending.current = false;
      if (active.current) setPending(false);
    }
  };
  const edit = (value: number) => {
    const next = clamp(value);
    desired.current = next;
    latest.current = next;
    setDraft(next);
  };
  const request = (value: number) => {
    edit(value);
    void send();
  };
  const displayed = draft ?? confirmed;
  const enabled = Boolean(id && source.configured);
  return (
    <section className="camera-zoom-control" aria-label={`${label} zoom`}>
      <h3>{label}</h3>
      <p aria-live="polite">
        {confirmed.toFixed(1)}× digital zoom{pending ? " · sending…" : ""}
      </p>
      <div className="camera-zoom-buttons">
        <button
          className="min-h-11"
          type="button"
          disabled={!enabled || displayed <= 1}
          aria-label={`${label} zoom out`}
          onClick={() => request((desired.current ?? confirmed) - 0.1)}
        >
          −
        </button>
        <button
          className="min-h-11"
          type="button"
          disabled={!enabled || displayed >= 4}
          aria-label={`${label} zoom in`}
          onClick={() => request((desired.current ?? confirmed) + 0.1)}
        >
          +
        </button>
      </div>
      <input
        className="min-h-11"
        aria-label={`${label} zoom level`}
        type="range"
        min="1"
        max="4"
        step="0.1"
        value={displayed}
        disabled={!enabled}
        onChange={(event) => edit(Number(event.target.value))}
        onPointerUp={() => void send()}
        onKeyUp={() => void send()}
        onBlur={() => void send()}
      />
      <button
        className="camera-zoom-reset secondary min-h-11"
        type="button"
        disabled={!enabled}
        aria-label={`${label} reset zoom`}
        onClick={() => request(1)}
      >
        Reset 1×
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
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
