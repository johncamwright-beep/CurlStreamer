"use client";
import { useEffect, useState } from "react";
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
  const value = peakToDbfs(peak);
  return `${value === 0 ? 0 : Math.round(value)} dBFS`;
}

function meterColor(peak: number) {
  const value = peakToDbfs(peak);
  if (value >= -6) return "bg-red-500";
  if (value >= -18) return "bg-amber-400";
  return "bg-emerald-500";
}

const statusSchema = z.object({
  gameId: z.string(),
  devices: z.array(z.object({ id: z.string(), name: z.string() })).max(128),
  running: z.boolean(),
  error: z.string().nullable(),
  channels: z
    .array(
      z.object({
        peak: z.number().min(0).max(1),
        rms: z.number().min(0).max(1),
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
  return (
    <section aria-label="USB microphones" className="space-y-2">
      <p className="text-sm">
        USB microphones · mixed to mono for the broadcast
      </p>
      {state?.running ? (
        <div className="flex min-h-11 items-center justify-between gap-2 rounded bg-slate-900 px-3 text-sm">
          <span>USB audio connected · {channels.length} mics · mono mix</span>
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
        </div>
      ) : (
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
      {state?.error && (
        <p role="alert" className="text-sm text-amber-200">
          {state.error}
        </p>
      )}
      {stale && (
        <p role="status">Audio status unavailable. Keep Studio open.</p>
      )}
      {state?.running && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {channels.map((channel, index) => {
            const meterPeak = stale ? 0 : channel.peak;
            const dbfs = dbfsText(meterPeak);
            return (
              <div key={index} className="rounded bg-slate-900 p-2 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span>Mic {index + 1}</span>
                  <span className="text-[10px] text-slate-300">{dbfs}</span>
                </div>
                <div
                  role="meter"
                  aria-label={`Mic ${index + 1} level`}
                  aria-valuemin={MIN_DBFS}
                  aria-valuemax={0}
                  aria-valuenow={peakToDbfs(meterPeak)}
                  aria-valuetext={dbfs}
                  className="h-2 overflow-hidden rounded bg-slate-700"
                >
                  <div
                    className={`h-full ${meterColor(meterPeak)}`}
                    style={{ width: `${dbfsMeterFill(meterPeak)}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    className="btn min-h-11 px-2 text-xs"
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
                    aria-label={`Mic ${index + 1} volume`}
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={channel.level}
                    className="min-h-11 min-w-0 flex-1 w-8"
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
