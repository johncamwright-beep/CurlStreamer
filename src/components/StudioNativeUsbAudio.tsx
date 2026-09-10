"use client";
import { useEffect, useState } from "react";
import { z } from "zod";

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
  return (
    <section aria-label="USB microphones" className="space-y-2">
      <p className="text-sm">
        USB microphones · mixed to mono for the broadcast
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="USB audio device"
          className="min-h-11 min-w-0 flex-1 rounded bg-slate-900 p-2"
          value={device}
          disabled={state?.running || pending}
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
          className="btn"
          disabled={pending || state?.running}
          onClick={() => {
            setPending(true);
            send("studio-usb-list");
          }}
        >
          Find microphones
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending || (!state?.running && !device)}
          onClick={() => {
            setPending(true);
            send(
              state?.running ? "studio-usb-stop" : "studio-usb-start",
              state?.running ? {} : { deviceId: device },
            );
          }}
        >
          {state?.running ? "Turn off USB audio" : "Use USB audio"}
        </button>
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-amber-200">
          {state.error}
        </p>
      )}
      {stale && (
        <p role="status">Audio status unavailable. Keep Studio open.</p>
      )}
      {state?.running && (
        <p className="text-sm">
          {state.channels.length} input channels · mono mix enabled
        </p>
      )}
      {state?.channels.map((channel, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <span className="w-16">Mic {index + 1}</span>
          <meter
            aria-label={`Mic ${index + 1} level`}
            min={0}
            max={1}
            value={stale ? 0 : channel.peak}
            className="flex-1 min-w-0"
          />
          <input
            aria-label={`Mic ${index + 1} volume`}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={channel.level}
            className="min-h-11 w-24"
            disabled={stale}
            onChange={(e) =>
              send("studio-usb-channel", {
                channel: index,
                muted: channel.muted,
                level: Number(e.target.value),
              })
            }
          />
          <button
            type="button"
            className="btn"
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
        </div>
      ))}
    </section>
  );
}
