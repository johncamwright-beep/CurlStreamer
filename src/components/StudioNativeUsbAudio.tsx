"use client";
import { useEffect, useId, useState } from "react";
import { z } from "zod";

const MIN_DBFS = -60;

/** Converts the unmodified capture peak to the display range used by the meter. */
export function peakToDbfs(peak: number) {
  if (!Number.isFinite(peak) || peak <= 0) return MIN_DBFS;
  return Math.max(MIN_DBFS, Math.min(0, 20 * Math.log10(peak)));
}

export function dbfsMeterFill(peak: number) {
  return ((peakToDbfs(peak) - MIN_DBFS) / -MIN_DBFS) * 100;
}

function dbfsText(peak: number) {
  if (peak <= 0) return "Silent";
  const value = peakToDbfs(peak);
  if (value <= MIN_DBFS) return "≤ -60 dBFS";
  return `${value.toFixed(1)} dBFS`;
}

function meterColor(peak: number, clipped: boolean) {
  if (clipped || peak >= 1) return "bg-red-500";
  if (peakToDbfs(peak) >= -6) return "bg-amber-400";
  return "bg-emerald-500";
}

const statusSchema = z.object({
  gameId: z.string(),
  devices: z.array(z.object({ id: z.string(), name: z.string() })).max(128),
  running: z.boolean(),
  allMuted: z.boolean().default(false),
  error: z.string().nullable(),
  processing: z
    .object({
      noiseReduction: z.enum(["off", "gentle", "strong"]),
      humFrequency: z.union([z.literal(0), z.literal(50), z.literal(60)]),
      available: z.boolean(),
      error: z.string().nullable(),
    })
    .optional(),
  channels: z
    .array(
      z.object({
        peak: z.number().min(0).max(1),
        rms: z.number().min(0).max(1),
        clipped: z.boolean().optional(),
        muted: z.boolean(),
        level: z.number().min(0).max(1),
      }),
    )
    .max(32),
});
export function StudioNativeUsbAudio({ gameId }: { gameId: string }) {
  const [state, setState] = useState<z.infer<typeof statusSchema>>();
  const [device, setDevice] = useState("");
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const controlsId = useId();
  useEffect(() => {
    if (state?.running) setExpanded(true);
  }, [state?.running]);
  useEffect(() => {
    if (!pending) return;
    const timeout = setTimeout(() => {
      setPending(false);
      setStale(true);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [pending]);
  const send = (type: string, fields = {}) => {
    const host = (
      window as unknown as {
        chrome?: { webview?: { postMessage: (value: unknown) => void } };
      }
    ).chrome?.webview;
    host?.postMessage({ type, gameId, ...fields });
  };
  useEffect(() => {
    let expiry: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      const parsed = statusSchema.safeParse((event as CustomEvent).detail);
      if (!parsed.success || parsed.data.gameId !== gameId) return;
      setState(parsed.data);
      setPending(false);
      setStale(false);
      clearTimeout(expiry);
      expiry = setTimeout(() => setStale(true), 5000);
    };
    window.addEventListener("studio-usb-status", receive);
    return () => {
      clearTimeout(expiry);
      window.removeEventListener("studio-usb-status", receive);
    };
  }, [gameId]);
  const channels = state?.channels.slice(0, 4) ?? [];
  const processing = state?.processing;
  return (
    <section
      aria-label="USB microphones"
      className="studio-usb-audio space-y-2"
    >
      <header className="flex min-h-11 flex-wrap items-center gap-2">
        <h2 className="mr-auto font-bold">Audio</h2>
        <button
          type="button"
          className="min-h-11 rounded px-2 text-sm hover:bg-slate-800"
          aria-expanded={expanded}
          aria-controls={controlsId}
          onClick={() => setExpanded(!expanded)}
        >
          USB setup
        </button>
        {state?.running && (
          <button
            type="button"
            className="btn min-h-11 shrink-0"
            aria-pressed={state.allMuted}
            disabled={pending || stale}
            onClick={() =>
              send("studio-usb-mute-all", { muted: !state.allMuted })
            }
          >
            {state.allMuted ? "Unmute all" : "Mute all"}
          </button>
        )}
        {state?.running && (
          <button
            type="button"
            className="btn min-h-11 shrink-0"
            disabled={pending}
            onClick={() => {
              setPending(true);
              send("studio-usb-stop");
            }}
          >
            Disconnect
          </button>
        )}
      </header>
      <div id={controlsId} hidden={!expanded} className="space-y-2">
        {!state?.running && (
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="USB audio device"
              className="min-h-11 min-w-0 flex-1 rounded bg-slate-900 p-2"
              value={device}
              disabled={pending}
              onChange={(e) => setDevice(e.target.value)}
            >
              <option value="">Select USB receiver</option>
              {state?.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn min-h-11"
              disabled={pending}
              onClick={() => {
                setPending(true);
                send("studio-usb-list");
              }}
            >
              Find microphones
            </button>
            <button
              type="button"
              className="btn min-h-11"
              disabled={pending || !device}
              onClick={() => {
                setPending(true);
                send("studio-usb-start", { deviceId: device });
              }}
            >
              Use USB audio
            </button>
          </div>
        )}
        {state?.running && (
          <div className="space-y-2">
            {processing && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-semibold">Audio cleanup</legend>
                <div className="flex flex-wrap gap-2">
                  <label className="flex min-w-0 flex-1 flex-col text-xs">
                    Noise reduction
                    <select
                      className="min-h-11 rounded bg-slate-900 p-2 text-sm"
                      value={processing.noiseReduction}
                      disabled={pending || stale || !processing.available}
                      onChange={(event) =>
                        send("studio-usb-processing", {
                          noiseReduction: event.target.value,
                          humFrequency: processing.humFrequency,
                        })
                      }
                    >
                      <option value="off">Off</option>
                      <option value="gentle">Gentle</option>
                      <option value="strong">Strong</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col text-xs">
                    Hum filter
                    <select
                      className="min-h-11 rounded bg-slate-900 p-2 text-sm"
                      value={processing.humFrequency}
                      disabled={pending || stale}
                      onChange={(event) =>
                        send("studio-usb-processing", {
                          noiseReduction: processing.noiseReduction,
                          humFrequency: Number(event.target.value),
                        })
                      }
                    >
                      <option value={0}>Off</option>
                      <option value={50}>50 Hz</option>
                      <option value={60}>60 Hz</option>
                    </select>
                  </label>
                </div>
                <p className="text-xs text-slate-300">
                  Noise reduction can soften quiet speech. Hum filter targets
                  electrical buzz.
                </p>
                {(processing.error || !processing.available) && (
                  <p role="status" className="text-xs text-amber-200">
                    {processing.error ||
                      "Noise reduction unavailable in this Studio version."}
                  </p>
                )}
              </fieldset>
            )}
            <p className="text-xs text-slate-300">
              Receiver input · before mute and stream level. Amber means low
              headroom; red means full scale reached (held for 3 seconds). Lower
              receiver gain if this repeats; stream level cannot repair
              distorted input.
            </p>
            <div className="studio-usb-channels">
              {channels.map((channel, index) => {
                const meterPeak = stale ? 0 : channel.peak;
                const clipped = !stale && channel.clipped === true;
                const dbfs = stale ? "Unavailable" : dbfsText(meterPeak);
                const inputStatus = stale
                  ? "Input unavailable"
                  : clipped
                    ? "Full scale reached"
                    : meterPeak >= 1
                      ? "Full scale"
                      : peakToDbfs(meterPeak) >= -6
                        ? "Low headroom"
                        : "Receiver input";
                return (
                  <div
                    key={index}
                    className="min-w-0 rounded bg-slate-900 p-2 text-sm"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span>Mic {index + 1}</span>
                      <span className="text-xs text-slate-300">{dbfs}</span>
                    </div>
                    <div
                      role="meter"
                      aria-label={`Mic ${index + 1} receiver input`}
                      aria-valuemin={MIN_DBFS}
                      aria-valuemax={0}
                      aria-valuenow={peakToDbfs(meterPeak)}
                      aria-valuetext={`${dbfs}; ${inputStatus.toLowerCase()}`}
                      className="h-2 overflow-hidden rounded bg-slate-700"
                    >
                      <div
                        className={`h-full ${meterColor(meterPeak, clipped)}`}
                        style={{ width: `${dbfsMeterFill(meterPeak)}%` }}
                      />
                    </div>
                    <p
                      className={`mt-1 text-xs ${clipped || meterPeak >= 1 ? "text-red-300" : "text-slate-300"}`}
                    >
                      {inputStatus}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="btn min-h-11 min-w-11 !px-2 text-xs"
                        aria-pressed={channel.muted}
                        disabled={stale}
                        onClick={() =>
                          send("studio-usb-channel", {
                            channel: index,
                            muted: !channel.muted,
                            level: channel.level,
                          })
                        }
                      >
                        {channel.muted ? "Unmute" : "Mute"}
                      </button>
                      <input
                        aria-label={`Mic ${index + 1} stream level`}
                        aria-valuetext={`${Math.round(channel.level * 100)} percent`}
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={channel.level}
                        className="min-h-11 min-w-11 flex-1 w-11"
                        disabled={stale}
                        onChange={(e) =>
                          send("studio-usb-channel", {
                            channel: index,
                            muted: channel.muted,
                            level: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <p className="text-xs text-slate-300">
                      Stream{" "}
                      {channel.muted || state.allMuted
                        ? "muted"
                        : `${Math.round(channel.level * 100)}%`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-amber-200">
          {state.error}
        </p>
      )}
      {stale && (
        <p role="status">Audio status unavailable. Keep Studio open.</p>
      )}
    </section>
  );
}
